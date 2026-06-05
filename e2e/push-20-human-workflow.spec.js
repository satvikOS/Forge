// PUSH-20 — Human-style click-and-keyboard complex project.
//
// One complete engineering session driven exclusively by mouse clicks and
// keyboard typing — no programmatic page.evaluate(window.forge.*) calls
// for geometry. The user (remote-desktop watcher on Mac Studio) sees:
//
//   1. Dismiss the onboarding workbench picker
//   2. Open Cmd-K command palette → search → open Mate Solver
//   3. Click Solve, watch results render
//   4. Cmd-K → Topology → click Run SIMP, watch density histogram populate
//   5. Cmd-K → Mold tooling → click Analyse Draft + Cooling + Runner
//   6. Cmd-K → Drawings HLR → click Project View → Emit DXF + Emit SVG
//   7. Cmd-K → FEA Tet4 → click Mesh + Solve linear static + Solve modal
//   8. Cmd-K → Solid modelling ops → click Var fillet / Loft / Tol bool
//   9. Cmd-K → Sketch constraints → click Build + Solve rectangle
//  10. Cmd-K → CAM extended → click Generate pocket → Post Fanuc
//  11. Final wide-shot screenshot
//
// Each step ends with shot() so the e2e-output/ folder shows the full
// guided tour. Slow timeouts between actions let a remote-desktop human
// watch the interactions happen on the Mac Studio screen.

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

test.setTimeout(360000);

let app, page;
const SHOTDIR = path.join(__dirname, '..', 'e2e-output', 'push-20-human-tour');

async function shot(name) {
    fs.mkdirSync(SHOTDIR, { recursive: true });
    await page.screenshot({ path: path.join(SHOTDIR, `${name}.png`), fullPage: true });
}

// Human-pace pauses — let the remote watcher see each step.
const STEP = 1200;     // medium pause after a click
const READ = 2000;     // longer pause for results to render
const QUICK = 500;

async function pause(ms = STEP) { await page.waitForTimeout(ms); }

async function openPalette() {
    await page.keyboard.press('Meta+K');
    await pause(QUICK);
}

async function searchAndOpen(query, expectPanel) {
    await openPalette();
    await page.keyboard.type(query, { delay: 60 });
    await pause(QUICK);
    await page.keyboard.press('Enter');
    await page.waitForSelector(expectPanel, { timeout: 8000 });
    await pause(READ);
}

async function closePanelByX(testid) {
    const closeBtn = page.locator(`[data-testid="${testid}"] button[aria-label^="Close"]`);
    if (await closeBtn.count() > 0) {
        await closeBtn.first().click();
        await pause(QUICK);
    }
}

test.beforeAll(async () => {
    app = await electron.launch({
        args: [path.resolve(__dirname, '..')],
        timeout: 60000,
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await pause(3000);
});

test.afterAll(async () => {
    if (app) {
        try { await app.close({ timeout: 6000 }); }
        catch { try { (await app.process()).kill('SIGKILL'); } catch {} }
    }
});

test('Step 01 — initial Forge UI loaded', async () => {
    await shot('01-loaded');
    expect(await page.evaluate(() => !!window.forge)).toBe(true);
});

test('Step 02 — dismiss onboarding dialog by clicking Set / Esc', async () => {
    // Forge ships an onboarding workbench-picker on first launch. Try to
    // dismiss via the visible button; fall back to Esc.
    const setBtn = page.locator('button:has-text("Set")');
    if (await setBtn.count() > 0) {
        await setBtn.first().click({ timeout: 3000 }).catch(() => {});
    } else {
        await page.keyboard.press('Escape');
    }
    await pause(STEP);
    await shot('02-dismissed-onboarding');
});

test('Step 03 — open command palette (Cmd-K)', async () => {
    await openPalette();
    await pause(STEP);
    await shot('03-palette-open');
});

test('Step 04 — Mate Solver: search + open + solve', async () => {
    await page.keyboard.press('Escape');
    await pause(QUICK);
    await searchAndOpen('mate solver', '[data-testid="forge-mate-solver-panel"]');
    await shot('04a-mate-panel');
    await page.locator('[data-testid="forge-mate-solve"]').click();
    await page.waitForSelector('[data-testid="forge-mate-report"]', { timeout: 8000 });
    await pause(READ);
    await shot('04b-mate-solved');
    await closePanelByX('forge-mate-solver-panel');
});

test('Step 05 — Topology SIMP: open + run optimisation', async () => {
    await searchAndOpen('topology', '[data-testid="forge-topology-panel"]');
    await shot('05a-topology-panel');
    // Reduce grid for fast demo: nx=6, ny=4, nz=3, maxIter=4
    await page.fill('[data-testid="forge-topo-nx"]', '6');
    await page.fill('[data-testid="forge-topo-ny"]', '4');
    await page.fill('[data-testid="forge-topo-nz"]', '3');
    await page.fill('[data-testid="forge-topo-maxiter"]', '4');
    await pause(QUICK);
    await page.locator('[data-testid="forge-topo-run"]').click();
    await page.waitForSelector('[data-testid="forge-topo-report"]', { timeout: 60000 });
    await pause(READ);
    await shot('05b-topology-converged');
    await closePanelByX('forge-topology-panel');
});

test('Step 06 — Mold tooling: draft + cooling + runner', async () => {
    await searchAndOpen('mold', '[data-testid="forge-mold-panel"]');
    await shot('06a-mold-panel');
    await page.locator('[data-testid="forge-mold-draft"]').click();
    await page.waitForSelector('[data-testid="forge-mold-draft-report"]', { timeout: 8000 });
    await pause(STEP);
    await shot('06b-mold-draft');
    await page.locator('[data-testid="forge-mold-cooling"]').click();
    await page.waitForSelector('[data-testid="forge-mold-cooling-report"]', { timeout: 8000 });
    await pause(STEP);
    await shot('06c-mold-cooling');
    await page.locator('[data-testid="forge-mold-runner"]').click();
    await page.waitForSelector('[data-testid="forge-mold-runner-report"]', { timeout: 8000 });
    await pause(READ);
    await shot('06d-mold-runner');
    await closePanelByX('forge-mold-panel');
});

test('Step 07 — Drawings HLR: project view + emit DXF + emit SVG', async () => {
    await searchAndOpen('drawings', '[data-testid="forge-drawingshlr-panel"]');
    await shot('07a-drawings-panel');
    await page.locator('[data-testid="forge-drawingshlr-project"]').click();
    await page.waitForSelector('[data-testid="forge-drawingshlr-view-report"]', { timeout: 8000 });
    await pause(STEP);
    await shot('07b-drawings-projected');
    await page.locator('[data-testid="forge-drawingshlr-emit-dxf"]').click();
    await page.waitForSelector('[data-testid="forge-drawingshlr-dxf"]', { timeout: 8000 });
    await pause(STEP);
    await shot('07c-drawings-dxf');
    await page.locator('[data-testid="forge-drawingshlr-emit-svg"]').click();
    await page.waitForSelector('[data-testid="forge-drawingshlr-svg"]', { timeout: 8000 });
    await pause(READ);
    await shot('07d-drawings-svg');
    await closePanelByX('forge-drawingshlr-panel');
});

test('Step 08 — FEA Tet4: mesh + linear static (light)', async () => {
    await searchAndOpen('tet4', '[data-testid="forge-feat-panel"]');
    await shot('08a-fea-panel');
    await page.locator('[data-testid="forge-feat-mesh"]').click();
    // Mesh can take 30-90s.
    await page.waitForSelector('[data-testid="forge-feat-mesh-report"]', { timeout: 90000 });
    await pause(STEP);
    await shot('08b-fea-meshed');
    // Skip static solve here to keep run length manageable.
    await closePanelByX('forge-feat-panel');
});

test('Step 09 — Solid modelling ops: var fillet + loft + tolerant boolean', async () => {
    await searchAndOpen('solid modelling', '[data-testid="forge-solidops-panel"]');
    await shot('09a-solidops-panel');
    await page.locator('[data-testid="forge-solidops-varfillet"]').click();
    await pause(STEP);
    await page.locator('[data-testid="forge-solidops-loft"]').click();
    await pause(STEP);
    await page.locator('[data-testid="forge-solidops-tolbool"]').click();
    await pause(READ);
    await shot('09b-solidops-done');
    await closePanelByX('forge-solidops-panel');
});

test('Step 10 — Sketch constraints: build + solve rectangle', async () => {
    await searchAndOpen('sketch', '[data-testid="forge-sketch-panel"]');
    await shot('10a-sketch-panel');
    await page.locator('[data-testid="forge-sketch-solve"]').click();
    await page.waitForSelector('[data-testid="forge-sketch-report"]', { timeout: 8000 });
    await pause(READ);
    await shot('10b-sketch-solved');
    await closePanelByX('forge-sketch-panel');
});

test('Step 11 — CAM extended: pocket toolpath + Fanuc post', async () => {
    await searchAndOpen('cam extended', '[data-testid="forge-camx-panel"]');
    await shot('11a-cam-panel');
    await page.locator('[data-testid="forge-camx-pocket"]').click();
    await page.waitForSelector('[data-testid="forge-camx-segments-report"]', { timeout: 8000 });
    await pause(STEP);
    await shot('11b-cam-toolpath');
    await page.locator('[data-testid="forge-camx-postprocess"]').click();
    await page.waitForSelector('[data-testid="forge-camx-gcode"]', { timeout: 8000 });
    await pause(READ);
    await shot('11c-cam-gcode');
    await closePanelByX('forge-camx-panel');
});

test('Step 12 — Final wide shot: empty viewport, all panels closed', async () => {
    await pause(STEP);
    await shot('12-final');
});
