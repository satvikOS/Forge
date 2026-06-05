// PUSH-19f — 3-stage planetary gearbox (industrial drive, 17 bodies).

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(180000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-19f-gearbox');

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

test('Gbox-A — front view: kernel ready', async () => {
    const ok = await page.evaluate(() => !!(window.forge && typeof window.forge.makeCylinder === 'function'));
    expect(ok).toBe(true);
    await shot('A-front-ready');
});

test('Gbox-B — top view: build 17 bodies across 3 stages', async () => {
    const a0 = await archieCount();
    const count = await page.evaluate(() => {
        const f = window.forge;
        const built = [];
        // Stage 1: sun + 4 planets + ring
        built.push(f.makeCylinder(50, 60));
        for (let i = 0; i < 4; i += 1) {
            const a = (i * Math.PI) / 2;
            const h = f.makeCylinder(100, 60);
            f.translate(h, Math.cos(a) * 150, Math.sin(a) * 150, 0);
            built.push(h);
        }
        built.push(f.makeCylinder(250, 60));
        // Stage 2: sun + 4 planets + ring
        const s2 = f.makeCylinder(40, 60); f.translate(s2, 0, 0, 80); built.push(s2);
        for (let i = 0; i < 4; i += 1) {
            const a = (i * Math.PI) / 2 + Math.PI / 4;
            const h = f.makeCylinder(60, 60);
            f.translate(h, Math.cos(a) * 100, Math.sin(a) * 100, 80);
            built.push(h);
        }
        const r2 = f.makeCylinder(160, 60); f.translate(r2, 0, 0, 80); built.push(r2);
        // Stage 3: sun + 3 planets + ring
        const s3 = f.makeCylinder(30, 60); f.translate(s3, 0, 0, 160); built.push(s3);
        for (let i = 0; i < 3; i += 1) {
            const a = (i * 2 * Math.PI) / 3;
            const h = f.makeCylinder(45, 60);
            f.translate(h, Math.cos(a) * 60, Math.sin(a) * 60, 160);
            built.push(h);
        }
        const r3 = f.makeCylinder(90, 60); f.translate(r3, 0, 0, 160); built.push(r3);
        return built.length;
    });
    expect(count).toBe(17);
    await page.waitForTimeout(800);
    await shot('B-top-gearbox');
    expect(await archieCount()).toBe(a0);
});

test('Gbox-C — right view', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeSetViewCube && window.__forgeSetViewCube('right'));
    await page.waitForTimeout(800);
    await shot('C-right-gearbox');
    expect(await archieCount()).toBe(a0);
});

test('Gbox-D — iso view: matelib gear-pair runs', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeSetViewCube && window.__forgeSetViewCube('iso'));
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
        const poses = [
            { id: 1, fixed: 1,  t: [0,0,0], q: [0,0,0,1] },
            { id: 2, fixed: 0, t: [0.15, 0, 0], q: [0,0,0,1] },
        ];
        const mates = [{
            kind: 7,
            a: { inst: 1, origin: [0,0,0], axis: [0,0,1] },
            b: { inst: 2, origin: [0.15, 0, 0], axis: [0,0,1] },
            value: 0.5,
        }];
        return window.forge.matelib.solve(poses, mates);
    });
    expect(r).toBeTruthy();
    expect(r.iterations).toBeGreaterThan(0);
    await shot('D-iso-mate');
    expect(await archieCount()).toBe(a0);
});

test('Gbox-E — close view', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => window.__forgeSetViewCube && window.__forgeSetViewCube('top'));
    await page.waitForTimeout(800);
    await shot('E-close-gearbox');
    expect(await archieCount()).toBe(a0);
});

test('Gbox-F — PDM check-in', async () => {
    const a0 = await archieCount();
    const r = await page.evaluate(async () => {
        await window.forge.pdm.init();
        const docId = await window.forge.pdm.add({ name: '3stage-planetary-gearbox', kind: 'assembly', content: 'gearbox-v1' });
        return { docId, count: (await window.forge.pdm.list()).length };
    });
    expect(r.docId).toBeTruthy();
    await shot('F-front-pdm');
    expect(await archieCount()).toBe(a0);
});

test('Gbox-G — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
