// PUSH-19e — Airbus A320 main landing gear strut (Ø260/Ø228 telescoping).

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(180000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-19e-a320-strut');

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

test('A320-A — front view: kernel ready', async () => {
    const ok = await page.evaluate(() => !!(window.forge && typeof window.forge.makeCylinder === 'function'));
    expect(ok).toBe(true);
    await shot('A-front-ready');
});

test('A320-B — top view: build outer Ø260 hollow + inner piston', async () => {
    const a0 = await archieCount();
    const result = await page.evaluate(() => {
        const f = window.forge;
        const outer = f.makeCylinder(130, 1900);
        const bore  = f.makeCylinder(114, 1900);
        const hollow = f.cut(outer, bore);
        const piston = f.makeCylinder(114, 1100);
        f.translate(piston, 0, 0, 800);
        return { hollow, piston };
    });
    expect(result.hollow).toBeTruthy();
    expect(result.piston).toBeTruthy();
    await page.waitForTimeout(800);
    await shot('B-top-strut');
    expect(await archieCount()).toBe(a0);
});

test('A320-C — right view', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeSetViewCube && window.__forgeSetViewCube('right'));
    await page.waitForTimeout(800);
    await shot('C-right-strut');
    expect(await archieCount()).toBe(a0);
});

test('A320-D — iso view: matelib piston concentric in outer', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeSetViewCube && window.__forgeSetViewCube('iso'));
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
        const poses = [
            { id: 1, fixed: 1,  t: [0,0,0], q: [0,0,0,1] },
            { id: 2, fixed: 0, t: [0.003, 0.002, 0], q: [0,0,0,1] },
        ];
        const mates = [{
            kind: 1,
            a: { inst: 1, origin: [0,0,0], axis: [0,0,1] },
            b: { inst: 2, origin: [0,0,0], axis: [0,0,1] },
            value: 0,
        }];
        return window.forge.matelib.solve(poses, mates);
    });
    expect(r.converged).toBe(true);
    await shot('D-iso-mate');
    expect(await archieCount()).toBe(a0);
});

test('A320-E — close view', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeSetViewCube && window.__forgeSetViewCube('top'));
    await page.waitForTimeout(800);
    await shot('E-close-strut');
    expect(await archieCount()).toBe(a0);
});

test('A320-F — PDM check-in', async () => {
    const a0 = await archieCount();
    const r = await page.evaluate(async () => {
        await window.forge.pdm.init();
        const docId = await window.forge.pdm.add({ name: 'airbus-a320-mlg-strut', kind: 'part', content: 'strut-v1' });
        return { docId, count: (await window.forge.pdm.list()).length };
    });
    expect(r.docId).toBeTruthy();
    await shot('F-front-pdm');
    expect(await archieCount()).toBe(a0);
});

test('A320-G — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
