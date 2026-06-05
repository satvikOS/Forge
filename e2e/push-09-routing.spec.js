// PUSH-09 — Pipe / cable routing workbench e2e.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(180000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-09');

async function shot(name) {
    fs.mkdirSync(SHOTDIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOTDIR, `${name}.png`), fullPage: true });
}

test.beforeAll(async () => {
    app = await electron.launch({ args: [path.resolve(__dirname, '..')], timeout: 60000 });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
});

test.afterAll(async () => {
    if (app) { try { await app.close({ timeout: 6000 }); } catch { try { (await app.process()).kill('SIGKILL'); } catch {} } }
});

async function archieCount() { return await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count(); }

test('PUSH-09-A — routing panel opens with spec selector', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenRoutingWorkbench && window.__forgeOpenRoutingWorkbench());
    await page.waitForSelector('[data-testid="forge-route-panel"]', { timeout: 6000 });
    await shot('A-front-panel');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-09-B — 4-vertex L-shape route on 1" carbon steel Sch40 returns 2 elbows', async () => {
    const a0 = await archieCount();
    await page.click('[data-testid="forge-route-analyse"]');
    await page.waitForSelector('[data-testid="forge-route-report"]', { timeout: 4000 });
    const elbows = await page.locator('[data-testid="forge-route-elbows"]').innerText();
    expect(elbows).toBe('2');
    const length = await page.locator('[data-testid="forge-route-length"]').innerText();
    // 0,0,0 → 200,0,0 (200) → 200,150,0 (150) → 200,150,80 (80) = 430 mm = 0.430 m
    expect(length).toBe('0.430');
    const mass = await page.locator('[data-testid="forge-route-mass"]').innerText();
    expect(parseFloat(mass)).toBeGreaterThan(1.0); // 0.430 m × 2.50 kg/m ≈ 1.075 kg
    expect(parseFloat(mass)).toBeLessThan(1.2);
    await shot('B-top-l-shape');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-09-C — straight 2-vertex route has 0 elbows', async () => {
    const a0 = await archieCount();
    await page.fill('[data-testid="forge-route-nodes"]', '0,0,0\n1000,0,0');
    await page.click('[data-testid="forge-route-analyse"]');
    await page.waitForTimeout(150);
    const elbows = await page.locator('[data-testid="forge-route-elbows"]').innerText();
    expect(elbows).toBe('0');
    const length = await page.locator('[data-testid="forge-route-length"]').innerText();
    expect(length).toBe('1.000');
    await shot('C-right-straight');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-09-D — cable spec ampacity surfaces via window.forge.routing.cableSpecs', async () => {
    const a0 = await archieCount();
    const specs = await page.evaluate(() => window.forge.routing.cableSpecs());
    expect(specs.length).toBe(5);
    expect(specs.find((c) => c.id === 'thwn-4awg').ampacity).toBe(95);
    expect(specs.find((c) => c.id === 'thwn-12awg').od).toBe(3.84);
    expect(await archieCount()).toBe(a0);
});

test('PUSH-09-E — switch to PVC 2" Sch40, mass dropped vs carbon steel', async () => {
    const a0 = await archieCount();
    await page.selectOption('[data-testid="forge-route-spec"]', 'pvc-sch40-2');
    await page.fill('[data-testid="forge-route-nodes"]', '0,0,0\n200,0,0\n200,150,0\n200,150,80');
    await page.click('[data-testid="forge-route-analyse"]');
    await page.waitForTimeout(150);
    const mass = parseFloat(await page.locator('[data-testid="forge-route-mass"]').innerText());
    // 0.430 m × 1.01 kg/m = 0.434 kg
    expect(mass).toBeGreaterThan(0.4);
    expect(mass).toBeLessThan(0.5);
    await shot('D-iso-pvc');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-09-F — analyse() programmatic with custom nodes returns identical report', async () => {
    const a0 = await archieCount();
    const r = await page.evaluate(() => window.forge.routing.analyse(
        [{x:0,y:0,z:0},{x:300,y:0,z:0},{x:300,y:0,z:100}],
        'cu-l-3/4'
    ));
    expect(r.length_m).toBeCloseTo(0.400, 3);
    expect(r.elbows.length).toBe(1);
    expect(r.spec.label).toContain('Copper');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-09-G — insert fires forge:insert-route', async () => {
    const a0 = await archieCount();
    const got = await page.evaluate(() => new Promise((resolve) => {
        let payload = null;
        window.addEventListener('forge:insert-route', (e) => { payload = e.detail; }, { once: true });
        window.forge.routing.insert([{x:0,y:0,z:0},{x:100,y:0,z:0}], 'thwn-12awg');
        setTimeout(() => resolve(payload), 100);
    }));
    expect(got).toBeTruthy();
    expect(got.report.spec.id).toBe('thwn-12awg');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-09-H — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
