// PUSH-19d — Ford 6.7L Power Stroke V8 (CGI block, 8 bores at 90° bank).

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(180000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-19d-ford-v8');

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

test('FordV8-A — front view: kernel ready', async () => {
    const ok = await page.evaluate(() => !!(window.forge && typeof window.forge.makeCylinder === 'function'));
    expect(ok).toBe(true);
    await shot('A-front-ready');
});

test('FordV8-B — top view: build 8 cylinder bores at 90° bank', async () => {
    const a0 = await archieCount();
    const built = await page.evaluate(() => {
        const f = window.forge;
        const BORE_R = 49.5, STROKE = 108, PITCH = 122, BANK = Math.PI / 4;
        const handles = [];
        for (let bank = 0; bank < 2; bank += 1) {
            const ang = bank === 0 ? -BANK : +BANK;
            for (let i = 0; i < 4; i += 1) {
                const h = f.makeCylinder(BORE_R, STROKE + 100);
                f.translate(h, Math.cos(ang) * 60, Math.sin(ang) * 60, i * PITCH);
                handles.push(h);
            }
        }
        return handles.length;
    });
    expect(built).toBe(8);
    await page.waitForTimeout(800);
    await shot('B-top-block');
    expect(await archieCount()).toBe(a0);
});

test('FordV8-C — right view', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeSetViewCube && window.__forgeSetViewCube('right'));
    await page.waitForTimeout(800);
    await shot('C-right-block');
    expect(await archieCount()).toBe(a0);
});

test('FordV8-D — iso view: matelib concentric on 4 bank-A cyls', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeSetViewCube && window.__forgeSetViewCube('iso'));
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
        const poses = [
            { id: 1, fixed: 1,  t: [0,0,0], q: [0,0,0,1] },
            { id: 2, fixed: 0, t: [0.005,0,0], q: [0,0,0,1] },
            { id: 3, fixed: 0, t: [-0.003,0,0], q: [0,0,0,1] },
            { id: 4, fixed: 0, t: [0.001,0,0], q: [0,0,0,1] },
        ];
        const mates = [];
        for (let i = 2; i <= 4; i += 1) {
            mates.push({
                kind: 1,
                a: { inst: 1, origin: [0,0,0], axis: [0,0,1] },
                b: { inst: i, origin: [0,0,0], axis: [0,0,1] },
                value: 0,
            });
        }
        return window.forge.matelib.solve(poses, mates);
    });
    expect(r.converged).toBe(true);
    await shot('D-iso-mates');
    expect(await archieCount()).toBe(a0);
});

test('FordV8-E — close view', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeSetViewCube && window.__forgeSetViewCube('top'));
    await page.waitForTimeout(800);
    await shot('E-close-block');
    expect(await archieCount()).toBe(a0);
});

test('FordV8-F — PDM check-in', async () => {
    const a0 = await archieCount();
    const r = await page.evaluate(async () => {
        await window.forge.pdm.init();
        const docId = await window.forge.pdm.add({ name: 'ford-67l-v8-block', kind: 'part', content: 'block-v1' });
        return { docId, count: (await window.forge.pdm.list()).length };
    });
    expect(r.docId).toBeTruthy();
    await shot('F-front-pdm');
    expect(await archieCount()).toBe(a0);
});

test('FordV8-G — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
