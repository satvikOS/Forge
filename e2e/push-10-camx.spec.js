// PUSH-10 — Extended CAM e2e (forge::camx).

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(240000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-10');

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

test('PUSH-10-A — extended CAM panel opens with 7 tools', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeOpenCAMExtendedWorkbench && window.__forgeOpenCAMExtendedWorkbench());
    await page.waitForSelector('[data-testid="forge-camx-panel"]', { timeout: 6000 });
    const rows = await page.locator('[data-testid^="forge-camx-tool-"]').count();
    expect(rows).toBe(7);
    await shot('A-front-tools');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-10-B — generate pocket toolpath returns multiple segments', async () => {
    const a0 = await archieCount();
    await page.click('[data-testid="forge-camx-pocket"]');
    await page.waitForSelector('[data-testid="forge-camx-segments-report"]', { timeout: 6000 });
    const segs = parseInt(await page.locator('[data-testid="forge-camx-seg-count"]').innerText(), 10);
    expect(segs).toBeGreaterThan(5);
    await shot('B-top-toolpath');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-10-C — post-process Fanuc emits valid G-code', async () => {
    const a0 = await archieCount();
    await page.selectOption('[data-testid="forge-camx-post"]', 'fanuc');
    await page.click('[data-testid="forge-camx-postprocess"]');
    await page.waitForSelector('[data-testid="forge-camx-gcode"]', { timeout: 4000 });
    const g = await page.locator('[data-testid="forge-camx-gcode"]').innerText();
    expect(g).toContain('G17');     // working-plane XY
    expect(g).toContain('G21');     // metric
    expect(g).toContain('G90');     // absolute
    expect(g).toContain('M30');     // program end
    expect(g.split('\n').length).toBeGreaterThan(50);
    await shot('C-right-fanuc');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-10-D — post-process Heidenhain emits Klartext', async () => {
    const a0 = await archieCount();
    await page.selectOption('[data-testid="forge-camx-post"]', 'heidenhain');
    await page.click('[data-testid="forge-camx-postprocess"]');
    await page.waitForTimeout(200);
    const g = await page.locator('[data-testid="forge-camx-gcode"]').innerText();
    expect(g).toContain('BEGIN PGM');
    expect(g).toContain('END PGM');
    await shot('D-iso-heidenhain');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-10-E — post-process Siemens emits SinuTrain', async () => {
    const a0 = await archieCount();
    await page.selectOption('[data-testid="forge-camx-post"]', 'siemens');
    await page.click('[data-testid="forge-camx-postprocess"]');
    await page.waitForTimeout(200);
    const g = await page.locator('[data-testid="forge-camx-gcode"]').innerText();
    expect(g).toContain('SIEMENS');
    expect(g).toContain('M30');
    await shot('E-close-siemens');
    expect(await archieCount()).toBe(a0);
});

test('PUSH-10-F — cycle time estimate returns total length + sec', async () => {
    const a0 = await archieCount();
    await page.click('[data-testid="forge-camx-cycle"]');
    await page.waitForSelector('[data-testid="forge-camx-cycle-report"]', { timeout: 4000 });
    const len = parseFloat(await page.locator('[data-testid="forge-camx-total-length"]').innerText());
    const sec = parseFloat(await page.locator('[data-testid="forge-camx-total-time"]').innerText());
    expect(len).toBeGreaterThan(0);
    expect(sec).toBeGreaterThan(0);
    expect(await archieCount()).toBe(a0);
});

test('PUSH-10-G — direct surface drill cycle G83 returns peck pattern', async () => {
    const a0 = await archieCount();
    const result = await page.evaluate(() => {
        const holes = [{x: 10, y: 10}, {x: 30, y: 10}];
        const params = { depth: 8, retract: 2, peck: 2 };
        return window.forge.camx.drillToolpath(holes, 1, 'G83', params);
    });
    expect(result.length).toBe(2);
    const firstHoleZs = result[0].map((p) => p.z);
    expect(firstHoleZs[firstHoleZs.length - 1]).toBe(2);   // retract last
    expect(Math.min(...firstHoleZs)).toBe(-8);             // depth reached
    expect(await archieCount()).toBe(a0);
});

test('PUSH-10-H — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
