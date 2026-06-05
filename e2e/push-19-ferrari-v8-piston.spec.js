// PUSH-19 — Ferrari 308 V8 piston (Ø81 × 71, wrist-pin Ø20, combustion bowl).
// Uses only contextBridge-exposed surface: makeCylinder, cut, translate, pdm.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(180000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-19-ferrari-piston');

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

async function archieCount() {
    return await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
}

test('Ferrari-A — front view: kernel ready', async () => {
    const ok = await page.evaluate(() => !!(window.forge && typeof window.forge.makeCylinder === 'function'));
    expect(ok).toBe(true);
    await shot('A-front-ready');
});

test('Ferrari-B — top view: build crown + wrist-pin bore + combustion bowl', async () => {
    const a0 = await archieCount();
    const built = await page.evaluate(() => {
        const f = window.forge;
        const crown = f.makeCylinder(40.5, 70);
        const pin   = f.makeCylinder(10, 100);
        f.translate(pin, 0, 0, 35);
        const bowl  = f.makeCylinder(25, 8);
        f.translate(bowl, 0, 0, 62);
        const withBore = f.cut(crown, pin);
        const piston   = f.cut(withBore, bowl);
        return { piston, crown, pin, bowl };
    });
    expect(built.piston).toBeTruthy();
    expect(built.crown).toBeTruthy();
    await page.waitForTimeout(800);
    await shot('B-top-piston');
    expect(await archieCount()).toBe(a0);
});

test('Ferrari-C — right view: rotate camera 90° around Y (if controls exposed)', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => {
        if (window.__forgeSetViewCube) window.__forgeSetViewCube('right');
    });
    await page.waitForTimeout(800);
    await shot('C-right-piston');
    expect(await archieCount()).toBe(a0);
});

test('Ferrari-D — iso view', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => {
        if (window.__forgeSetViewCube) window.__forgeSetViewCube('iso');
    });
    await page.waitForTimeout(800);
    await shot('D-iso-piston');
    expect(await archieCount()).toBe(a0);
});

test('Ferrari-E — close view: PDM check-in produces docId', async () => {
    const a0 = await archieCount();
    const status = await page.evaluate(async () => {
        if (!window.forge || !window.forge.pdm) return null;
        await window.forge.pdm.init();
        const docId = await window.forge.pdm.add({
            name: 'ferrari-308-v8-piston', kind: 'part', content: 'piston-v1',
        });
        const list = await window.forge.pdm.list();
        return { docId, count: list.length };
    });
    expect(status).toBeTruthy();
    expect(status.docId).toBeTruthy();
    expect(status.count).toBeGreaterThan(0);
    await shot('E-close-pdm');
    expect(await archieCount()).toBe(a0);
});

test('Ferrari-F — top view final', async () => {
    const a0 = await archieCount();
    await page.evaluate(() => {
        if (window.__forgeSetViewCube) window.__forgeSetViewCube('top');
    });
    await page.waitForTimeout(800);
    await shot('F-top-final');
    expect(await archieCount()).toBe(a0);
});

test('Ferrari-G — no Archie posts', async () => {
    expect(await archieCount()).toBe(0);
});
