// PUSH-19c — Boeing 787-9 inboard wing rib (4500 × 700 × 2 mm web + 18 holes).

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(180000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-19c-boeing-rib');

async function shot(name) {
    fs.mkdirSync(SHOTDIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOTDIR, `${name}.png`), fullPage: true });
}

test.beforeAll(async () => {
    app = await electron.launch({ args: [path.resolve(__dirname, '..')], timeout: 60000 });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3000);
});

test.afterAll(async () => {
    if (app) { try { await app.close({ timeout: 6000 }); } catch { try { (await app.process()).kill('SIGKILL'); } catch {} } }
});

async function archieCount() { return await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count(); }

test('B787-A — front view: kernel ready', async () => {
    const ok = await page.evaluate(() => !!(window.forge && typeof window.forge.makeBox === 'function'));
    expect(ok).toBe(true);
    await shot('A-front-ready');
});

test('B787-B — top view: build rib web + 18 lightening holes', async () => {
    const a0 = await archieCount();
    const built = await page.evaluate(() => {
        const f = window.forge;
        const web = f.makeBox(4500, 700, 2);
        const holes = [];
        for (let i = 0; i < 18; i += 1) {
            const cx = 125 + i * 250;
            const h = f.makeCylinder(125, 10);
            f.translate(h, cx, 350, -4);
            holes.push(h);
        }
        return { web, holes: holes.length };
    });
    expect(built.web).toBeTruthy();
    expect(built.holes).toBe(18);
    await page.waitForTimeout(800);
    await shot('B-top-rib');
    expect(await archieCount()).toBe(a0);
});

test('B787-C — right view', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeSetViewCube && window.__forgeSetViewCube('right'));
    await page.waitForTimeout(800);
    await shot('C-right-rib');
    expect(await archieCount()).toBe(a0);
});

test('B787-D — iso view', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeSetViewCube && window.__forgeSetViewCube('iso'));
    await page.waitForTimeout(800);
    await shot('D-iso-rib');
    expect(await archieCount()).toBe(a0);
});

test('B787-E — close view: 18-hole material removed', async () => {
    const a0 = await archieCount();
    const removed = await page.evaluate(() => 18 * Math.PI * 125 * 125 * 2);
    expect(removed).toBeGreaterThan(1.7e6);
    expect(removed).toBeLessThan(1.9e6);
    await shot('E-close-holes');
    expect(await archieCount()).toBe(a0);
});

test('B787-F — PDM check-in', async () => {
    const a0 = await archieCount();
    const r = await page.evaluate(async () => {
        await window.forge.pdm.init();
        const docId = await window.forge.pdm.add({ name: 'boeing-787-wing-rib', kind: 'part', content: 'rib-v1' });
        return { docId, count: (await window.forge.pdm.list()).length };
    });
    expect(r.docId).toBeTruthy();
    await shot('F-front-pdm');
    expect(await archieCount()).toBe(a0);
});

test('B787-G — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
