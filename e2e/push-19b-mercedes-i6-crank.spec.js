// PUSH-19b — Mercedes-Benz M256 inline-6 crankshaft (3.0L, bore 83 × stroke 92.4).

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(180000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-19b-mercedes-crank');

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

test('M256-A — front view: kernel ready', async () => {
    const ok = await page.evaluate(() => !!(window.forge && typeof window.forge.makeCylinder === 'function'));
    expect(ok).toBe(true);
    await shot('A-front-ready');
});

test('M256-B — top view: build 7 mains + 6 throws', async () => {
    const a0 = await archieCount();
    const count = await page.evaluate(() => {
        const f = window.forge;
        const built = [];
        for (let i = 0; i < 7; i += 1) {
            const h = f.makeCylinder(30, 25);
            f.translate(h, 0, 0, i * 105);
            built.push(h);
        }
        const ANG = [0, 240, 120, 0, 240, 120];
        for (let i = 0; i < 6; i += 1) {
            const a = (ANG[i] * Math.PI) / 180;
            const h = f.makeCylinder(25, 28);
            f.translate(h, Math.cos(a) * 46.2, Math.sin(a) * 46.2, 25 + i * 105 + 52.5);
            built.push(h);
        }
        return built.length;
    });
    expect(count).toBe(13);
    await page.waitForTimeout(800);
    await shot('B-top-skeleton');
    expect(await archieCount()).toBe(a0);
});

test('M256-C — right view', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeSetViewCube && window.__forgeSetViewCube('right'));
    await page.waitForTimeout(800);
    await shot('C-right-crank');
    expect(await archieCount()).toBe(a0);
});

test('M256-D — iso view', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeSetViewCube && window.__forgeSetViewCube('iso'));
    await page.waitForTimeout(800);
    await shot('D-iso-crank');
    expect(await archieCount()).toBe(a0);
});

test('M256-E — close view: matelib concentric solve converges', async () => {
    const a0 = await archieCount();
    const r = await page.evaluate(() => {
        const poses = [
            { id: 1, fixed: 1,  t: [0, 0, 0], q: [0, 0, 0, 1] },
            { id: 2, fixed: 0, t: [0.005, 0.003, 0], q: [0, 0, 0, 1] },
            { id: 3, fixed: 0, t: [-0.004, 0.002, 0], q: [0, 0, 0, 1] },
        ];
        const mates = [
            { kind: 1, a: { inst: 1, origin: [0,0,0], axis: [0,0,1] }, b: { inst: 2, origin: [0,0,0], axis: [0,0,1] }, value: 0 },
            { kind: 1, a: { inst: 1, origin: [0,0,0], axis: [0,0,1] }, b: { inst: 3, origin: [0,0,0], axis: [0,0,1] }, value: 0 },
        ];
        return window.forge.matelib.solve(poses, mates);
    });
    expect(r.converged).toBe(true);
    await shot('E-close-mates');
    expect(await archieCount()).toBe(a0);
});

test('M256-F — PDM check-in', async () => {
    const a0 = await archieCount();
    const r = await page.evaluate(async () => {
        await window.forge.pdm.init();
        const docId = await window.forge.pdm.add({ name: 'mercedes-m256-crank', kind: 'part', content: 'crank-v1' });
        return { docId, count: (await window.forge.pdm.list()).length };
    });
    expect(r.docId).toBeTruthy();
    expect(r.count).toBeGreaterThan(0);
    await shot('F-front-pdm');
    expect(await archieCount()).toBe(a0);
});

test('M256-G — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
