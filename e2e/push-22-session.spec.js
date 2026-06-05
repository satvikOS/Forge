// PUSH-22 — Single persistent Forge session. Open the app ONCE, drive it
// through a full engineering tour (V12 build + topology + mates + sketch +
// drawings + materials), close ONCE at the end. The Electron window stays
// on screen the entire time — no flicker between specs.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(900000);                              // 15 min budget
test.describe.configure({ mode: 'serial' });          // strict ordering

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-22-session');

async function shot(name) {
    fs.mkdirSync(SHOTDIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOTDIR, `${name}.png`), fullPage: true });
}
async function pause(ms = 600) { await page.waitForTimeout(ms); }
async function openPalette() { await page.keyboard.press('Meta+K'); await pause(500); }
async function searchOpen(query, selector) {
    await openPalette();
    await page.keyboard.type(query, { delay: 60 });
    await pause(500);
    await page.keyboard.press('Enter');
    await page.waitForSelector(selector, { timeout: 8000 });
    await pause(800);
}
async function closeByX(testid) {
    const btn = page.locator(`[data-testid="${testid}"] button[aria-label^="Close"]`);
    if (await btn.count() > 0) { await btn.first().click({ timeout: 3000 }).catch(() => {}); }
    await pause(400);
}

test.beforeAll(async () => {
    app = await electron.launch({ args: [path.resolve(__dirname, '..')], timeout: 60000 });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    // Dismiss onboarding once.
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    await pause(800);
});

test.afterAll(async () => {
    // Keep the app open for several seconds after the last test for the
    // remote watcher, THEN close cleanly.
    try { await pause(3000); } catch {}
    if (app) {
        try { await app.close({ timeout: 6000 }); }
        catch { try { (await app.process()).kill('SIGKILL'); } catch {} }
    }
});

test('00 — Forge loaded, ready for session', async () => {
    await shot('00-ready');
    expect(await page.evaluate(() => !!window.forge)).toBe(true);
});

// ============================================================ Mercedes V12
test('01 — open V12 builder via palette', async () => {
    await searchOpen('Mercedes M120', '[data-testid="forge-v12-panel"]');
    await shot('01-v12-panel');
});

test('02 — build V12 (25 clicks: 12 bores + 7 mains + 6 throws)', async () => {
    const btn = page.locator('[data-testid="forge-v12-add-one"]');
    for (let i = 0; i < 25; i += 1) {
        await btn.click();
        await pause(400);
        if (i === 5)  await shot('02a-six-bores');
        if (i === 11) await shot('02b-twelve-bores');
        if (i === 18) await shot('02c-mains-done');
    }
    const count = await page.locator('[data-testid="forge-v12-count"]').innerText();
    expect(parseInt(count, 10)).toBe(25);
    await pause(1500);
    await shot('02d-v12-complete');
});

test('03 — close V12 panel', async () => {
    await closeByX('forge-v12-panel');
    await shot('03-after-close');
});

// ============================================================ Topology SIMP
test('04 — open Topology SIMP, run a small optimisation', async () => {
    await searchOpen('topology', '[data-testid="forge-topology-panel"]');
    await page.fill('[data-testid="forge-topo-nx"]', '6');
    await page.fill('[data-testid="forge-topo-ny"]', '4');
    await page.fill('[data-testid="forge-topo-nz"]', '3');
    await page.fill('[data-testid="forge-topo-maxiter"]', '4');
    await pause(500);
    await shot('04a-topology-config');
    await page.locator('[data-testid="forge-topo-run"]').click();
    await page.waitForSelector('[data-testid="forge-topo-report"]', { timeout: 60000 });
    await pause(1500);
    await shot('04b-topology-result');
    await closeByX('forge-topology-panel');
});

// ============================================================ Mate Solver
test('05 — open Mate Solver, solve concentric demo', async () => {
    await searchOpen('mate solver', '[data-testid="forge-mate-solver-panel"]');
    await shot('05a-mate-panel');
    await page.locator('[data-testid="forge-mate-solve"]').click();
    await page.waitForSelector('[data-testid="forge-mate-report"]', { timeout: 8000 });
    await pause(1500);
    await shot('05b-mate-solved');
    await closeByX('forge-mate-solver-panel');
});

// ============================================================ Sketch
test('06 — open Sketch constraints, build + solve rectangle', async () => {
    await searchOpen('sketch constraints', '[data-testid="forge-sketch-panel"]');
    await shot('06a-sketch-panel');
    await page.locator('[data-testid="forge-sketch-solve"]').click();
    await page.waitForSelector('[data-testid="forge-sketch-report"]', { timeout: 8000 });
    await pause(1200);
    await shot('06b-sketch-solved');
    await closeByX('forge-sketch-panel');
});

// ============================================================ Solid Ops
test('07 — open Solid Ops, apply varfillet + loft + tolerant bool', async () => {
    await searchOpen('solid modelling', '[data-testid="forge-solidops-panel"]');
    await shot('07a-solidops-panel');
    await page.locator('[data-testid="forge-solidops-varfillet"]').click();
    await pause(700);
    await page.locator('[data-testid="forge-solidops-loft"]').click();
    await pause(700);
    await page.locator('[data-testid="forge-solidops-tolbool"]').click();
    await pause(1200);
    await shot('07b-solidops-done');
    await closeByX('forge-solidops-panel');
});

// ============================================================ CAM Extended
test('08 — open CAM extended, generate pocket + Fanuc post', async () => {
    await searchOpen('cam extended', '[data-testid="forge-camx-panel"]');
    await shot('08a-cam-panel');
    await page.locator('[data-testid="forge-camx-pocket"]').click();
    await page.waitForSelector('[data-testid="forge-camx-segments-report"]', { timeout: 8000 });
    await pause(700);
    await shot('08b-cam-toolpath');
    await page.locator('[data-testid="forge-camx-postprocess"]').click();
    await page.waitForSelector('[data-testid="forge-camx-gcode"]', { timeout: 8000 });
    await pause(1500);
    await shot('08c-cam-gcode');
    await closeByX('forge-camx-panel');
});

// ============================================================ Final
test('09 — final wide shot of empty Forge after the session', async () => {
    await pause(1500);
    await shot('09-final-wide');
});

test('10 — no Archie posts the entire session', async () => {
    const archie = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archie).toBe(0);
});
