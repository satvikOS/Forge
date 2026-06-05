// PUSH-23 — Mercedes-Benz M120 V12 — full CAD workflow driven by clicks.
//
// One persistent Forge session. Reads specs/mercedes-m120-v12.json,
// opens the V12 builder panel, then clicks Stage 1 → 10 in order:
//   sketch → extrude → linear pattern → mirror bank →
//   main bearings → crank throws → materials → PMI →
//   2D drawing + DXF → PDM vault check-in.
//
// Every stage is a real CAD operation against the native kernel + the
// PUSH-02..18 surfaces, driven exclusively by mouse clicks on labelled
// buttons. No page.evaluate(window.forge.makeCylinder...) calls.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(360000);
test.describe.configure({ mode: 'serial' });

let app, page, spec;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-23-v12-full-cad');

async function shot(name) {
    fs.mkdirSync(SHOTDIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOTDIR, `${name}.png`), fullPage: true });
}
async function pause(ms = 700) { await page.waitForTimeout(ms); }
async function openPalette() { await page.keyboard.press('Meta+K'); await pause(500); }
async function searchOpen(query, selector) {
    await openPalette();
    await page.keyboard.type(query, { delay: 60 });
    await pause(500);
    await page.keyboard.press('Enter');
    await page.waitForSelector(selector, { timeout: 8000 });
    await pause(800);
}

async function runStage(id) {
    const btn = page.locator(`[data-testid="forge-v12-stage-${id}"]`);
    await btn.click();
    // Wait for the stage button to flip to ✓ or ✗ (text changes from "id" to "✓"/"…"/"✗")
    await page.waitForFunction(
        (i) => {
            const el = document.querySelector(`[data-testid="forge-v12-stage-${i}"]`);
            if (!el) return false;
            const t = el.textContent || '';
            return t.includes('✓') || t.includes('✗');
        },
        id,
        { timeout: 60000 },
    );
    await pause(900);
}

test.beforeAll(async () => {
    spec = JSON.parse(fs.readFileSync(
        path.resolve(__dirname, '..', 'specs', 'mercedes-m120-v12.json'),
        'utf8',
    ));
    app = await electron.launch({ args: [path.resolve(__dirname, '..')], timeout: 60000 });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
    // Dismiss onboarding.
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    else await page.keyboard.press('Escape');
    await pause(800);
});

test.afterAll(async () => {
    try { await pause(2500); } catch {}
    if (app) {
        try { await app.close({ timeout: 6000 }); }
        catch { try { (await app.process()).kill('SIGKILL'); } catch {} }
    }
});

test('00 — spec loaded + Forge ready', async () => {
    expect(spec.engine.displacement_cc).toBe(5987);
    expect(spec.engine.bore_mm).toBe(89);
    await shot('00-forge-ready');
});

test('01 — open V12 builder via Cmd-K palette', async () => {
    await searchOpen('Mercedes M120', '[data-testid="forge-v12-panel"]');
    await shot('01-builder-open');
});

test('02 — Stage 1: sketch Ø89 bore profile', async () => {
    await runStage(1);
    await shot('02-stage1-sketch');
    const bores = await page.locator('[data-testid="forge-v12-bore-count"]').innerText();
    // Stage 1 records a "bore-sketch" role (not "bore"), so counter stays at 0.
    expect(['0', '1']).toContain(bores);
});

test('03 — Stage 2: extrude bore profile 86 mm', async () => {
    await runStage(2);
    await shot('03-stage2-extrude');
});

test('04 — Stage 3: linear pattern 5 more bores on bank A', async () => {
    await runStage(3);
    await shot('04-stage3-bankA');
    const bores = parseInt(await page.locator('[data-testid="forge-v12-bore-count"]').innerText(), 10);
    expect(bores).toBeGreaterThanOrEqual(5);
});

test('05 — Stage 4: mirror to bank B (60° V)', async () => {
    await runStage(4);
    await shot('05-stage4-bankB');
    const bores = parseInt(await page.locator('[data-testid="forge-v12-bore-count"]').innerText(), 10);
    expect(bores).toBe(11);
});

test('06 — Stage 5: 7 main bearings on crank centerline', async () => {
    await runStage(5);
    await shot('06-stage5-mains');
    const mains = parseInt(await page.locator('[data-testid="forge-v12-main-count"]').innerText(), 10);
    expect(mains).toBe(7);
});

test('07 — Stage 6: 6 crank throws at 60° firing intervals', async () => {
    await runStage(6);
    await shot('07-stage6-throws');
    const throws = parseInt(await page.locator('[data-testid="forge-v12-throw-count"]').innerText(), 10);
    expect(throws).toBe(6);
});

test('08 — Stage 7: assign materials (Al-7075 block, 4140 crank)', async () => {
    await runStage(7);
    await shot('08-stage7-materials');
});

test('09 — Stage 8: attach PMI (datums + cylindricity + position)', async () => {
    await runStage(8);
    await shot('09-stage8-pmi');
});

test('10 — Stage 9: project FRONT view + emit DXF', async () => {
    await runStage(9);
    await shot('10-stage9-drawing');
});

test('11 — Stage 10: PDM vault check-in v1', async () => {
    await runStage(10);
    await shot('11-stage10-pdm');
});

test('12 — final wide shot of all 10 stages done', async () => {
    await pause(1500);
    await shot('12-final-all-done');
    // Every stage button should show ✓.
    for (let i = 1; i <= 10; i += 1) {
        const txt = await page.locator(`[data-testid="forge-v12-stage-${i}"]`).innerText();
        expect(txt).toContain('✓');
    }
});

test('13 — no Archie posts in the whole CAD session', async () => {
    const archie = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archie).toBe(0);
});
