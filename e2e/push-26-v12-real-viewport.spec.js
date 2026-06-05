// PUSH-26 — M120 V12 built into the Forge-v4 viewport.
// Single persistent session, pure mouse + keyboard, geometry actually
// lands as Three.js meshes in window.__forgeScene so the user SEES
// block + crank + 12 bores + 12 pistons + 2 heads + 4 cams + 48 valves
// + oil pan + intake plenum. Three simulations animate on the mesh.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(360000);
test.describe.configure({ mode: 'serial' });

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-26-v12-viewport');

async function shot(name) {
    fs.mkdirSync(SHOTDIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOTDIR, `${name}.png`), fullPage: true });
}
async function pause(ms = 800) { await page.waitForTimeout(ms); }

test.beforeAll(async () => {
    app = await electron.launch({ args: [path.resolve(__dirname, '..')], timeout: 60000 });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    await pause(1200);
});

test.afterAll(async () => {
    try { await pause(4000); } catch {}
    if (app) {
        try { await app.close({ timeout: 6000 }); }
        catch { try { (await app.process()).kill('SIGKILL'); } catch {} }
    }
});

test('00 — empty viewport ready, scene exposed', async () => {
    await shot('00-empty-viewport');
    const sceneOk = await page.evaluate(() => !!window.__forgeScene);
    expect(sceneOk).toBe(true);
});

test('01 — open V12 real builder via Cmd-K', async () => {
    await page.keyboard.press('Meta+K');
    await pause(600);
    await page.keyboard.type('V12 real build IN VIEWPORT', { delay: 50 });
    await pause(700);
    await shot('01a-palette-typed');
    await page.keyboard.press('Enter');
    await page.waitForSelector('[data-testid="forge-v12real-panel"]', { timeout: 8000 });
    await pause(800);
    await shot('01b-panel-open');
});

test('02 — click Build V12 → geometry lands in viewport', async () => {
    await page.locator('[data-testid="forge-v12real-build"]').click();
    await page.waitForSelector('[data-testid="forge-v12real-built"]', { timeout: 8000 });
    await pause(1500);
    await shot('02-v12-built');
    const parts = parseInt(await page.locator('[data-testid="forge-v12real-parts"]').innerText(), 10);
    expect(parts).toBeGreaterThan(70);          // 1+7+6+12+12+12+12+2+4+48+1+1 ≈ 118 parts
});

test('03 — verify meshes are actually in __forgeScene', async () => {
    const count = await page.evaluate(() => {
        if (!window.__forgeScene) return 0;
        let n = 0;
        window.__forgeScene.traverse((o) => { if (o.isMesh && o.userData?.v12) n += 1; });
        return n;
    });
    expect(count).toBeGreaterThan(70);
    await shot('03-meshes-in-scene');
});

test('04 — rotate camera for iso view (drag in viewport)', async () => {
    // simulate orbit by pressing keyboard view shortcut
    await page.keyboard.press('5');             // ISO
    await pause(800);
    await shot('04-iso-view');
});

test('05 — sim 1: crank torsional vibration animation', async () => {
    await page.locator('[data-testid="forge-v12real-sim-crank"]').click();
    await pause(1500);
    await shot('05a-crank-vib-1');
    await pause(2000);
    await shot('05b-crank-vib-2');
    await pause(2000);
    await shot('05c-crank-vib-3');
    await pause(3000);          // total ~8 s
    await shot('05d-crank-vib-end');
});

test('06 — sim 2: combustion 9.5 MPa stress contour', async () => {
    await page.locator('[data-testid="forge-v12real-sim-combustion"]').click();
    await pause(1500);
    await shot('06a-combustion-1');
    await pause(2000);
    await shot('06b-combustion-2');
    await pause(2000);
    await shot('06c-combustion-3');
    await pause(3000);
    await shot('06d-combustion-end');
});

test('07 — sim 3: block bending first mode', async () => {
    await page.locator('[data-testid="forge-v12real-sim-bending"]').click();
    await pause(1500);
    await shot('07a-bending-1');
    await pause(2000);
    await shot('07b-bending-2');
    await pause(2000);
    await shot('07c-bending-3');
    await pause(3000);
    await shot('07d-bending-end');
});

test('08 — final wide shot, V12 visible', async () => {
    await pause(1500);
    await shot('08-final-wide');
});

test('09 — zero Archie posts in the full build session', async () => {
    const archie = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archie).toBe(0);
});
