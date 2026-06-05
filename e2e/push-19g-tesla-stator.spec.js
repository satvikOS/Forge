// PUSH-19g — Tesla Model S Plaid PMSRM rotor + stator workflow.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(180000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-19g-tesla-stator');

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

test('Tesla-A — front view: kernel ready', async () => {
    const ok = await page.evaluate(() => !!(window.forge && typeof window.forge.makeCylinder === 'function'));
    expect(ok).toBe(true);
    await shot('A-front-ready');
});

test('Tesla-B — top view: stator OD Ø254 / ID Ø180 / 153 mm + rotor Ø179.6', async () => {
    const a0 = await archieCount();
    const built = await page.evaluate(() => {
        const f = window.forge;
        const od = f.makeCylinder(127, 153);
        const id = f.makeCylinder(90, 153);
        const stack = f.cut(od, id);
        const rotor = f.makeCylinder(89.8, 153);
        return { stack, rotor };
    });
    expect(built.stack).toBeTruthy();
    expect(built.rotor).toBeTruthy();
    await page.waitForTimeout(800);
    await shot('B-top-stator-rotor');
    expect(await archieCount()).toBe(a0);
});

test('Tesla-C — right view', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeSetViewCube && window.__forgeSetViewCube('right'));
    await page.waitForTimeout(800);
    await shot('C-right-stator');
    expect(await archieCount()).toBe(a0);
});

test('Tesla-D — iso view: matelib rotor concentric in stator (0.4 mm air gap)', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeSetViewCube && window.__forgeSetViewCube('iso'));
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
        const poses = [
            { id: 1, fixed: 1,  t: [0,0,0], q: [0,0,0,1] },
            { id: 2, fixed: 0, t: [0.0001, 0, 0], q: [0,0,0,1] },
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
    expect(Math.abs(r.poses[1].t[0])).toBeLessThan(0.0002);
    await shot('D-iso-mate');
    expect(await archieCount()).toBe(a0);
});

test('Tesla-E — close view', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeSetViewCube && window.__forgeSetViewCube('top'));
    await page.waitForTimeout(800);
    await shot('E-close-stator');
    expect(await archieCount()).toBe(a0);
});

test('Tesla-F — PDM check-in', async () => {
    const a0 = await archieCount();
    const r = await page.evaluate(async () => {
        await window.forge.pdm.init();
        const docId = await window.forge.pdm.add({ name: 'tesla-model-s-plaid-pmsrm', kind: 'assembly', content: 'motor-v1' });
        return { docId, count: (await window.forge.pdm.list()).length };
    });
    expect(r.docId).toBeTruthy();
    await shot('F-front-pdm');
    expect(await archieCount()).toBe(a0);
});

test('Tesla-G — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
