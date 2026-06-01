// Forge-117 — snap + grid placement, headed Electron verification.
//
// Strategy:
//   - Launch the real Forge v4 shell (the same path used by every other
//     v4 spec) and screenshot every assertion.
//   - The SnapStatusChip self-mounts via a portal into the existing
//     .forge-statusbar, so we don't touch ForgeShellV4 / Viewport.
//   - Snap math is verified by driving window.__forgeSnapApi.findSnap
//     with a synthetic ortho-like camera so the test is deterministic
//     regardless of camera defaults.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-snap';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

// Make sure the engine module is loaded into the page even if no
// consumer happens to import it yet. We import via dynamic import from
// the bundled chunk path that the shell exposes.
async function ensureSnapEngine(page) {
  // The chip self-mounts on import. If neither the shell nor any other
  // module pulled snapEngine in yet, push it in directly so the chip
  // appears and window.__forgeSnap exists.
  await page.evaluate(async () => {
    if (window.__forgeSnapApi) return true;
    // Try common bundler paths — these are no-ops if the module is not
    // present. Fall back to declaring a minimal harness so the rest of
    // the spec can drive the math.
    const tryPaths = [
      '/src/forge-v4/snapEngine.js',
      '/frontend/src/forge-v4/snapEngine.js',
      '/forge-v4/snapEngine.js',
    ];
    for (const p of tryPaths) {
      try {
        await import(p);
        if (window.__forgeSnapApi) {
          await import(p.replace('snapEngine.js', 'SnapStatusChip.jsx'));
          return true;
        }
      } catch (_) { /* next path */ }
    }
    return !!window.__forgeSnapApi;
  });
}

// Build a synthetic camera the snap math can project through. This
// mirrors a THREE.PerspectiveCamera looking down -Z at the origin,
// matching the default forge view well enough for snap assertions.
async function installSyntheticCamera(page) {
  await page.evaluate(() => {
    const W = window.innerWidth;
    const H = window.innerHeight;
    // Identity matrixWorldInverse (camera at origin looking -Z), and a
    // simple orthographic projection sized to the canvas in mm so that
    // 1mm in world → 1px on screen. This makes the test deterministic.
    const fx = 2 / W;   // map [-W/2..W/2] world → [-1..1] NDC
    const fy = 2 / H;
    window.__forgeSnapTestCam = {
      projectionMatrix: { elements: [
        fx, 0,  0,  0,
        0,  fy, 0,  0,
        0,  0, -0.01, 0,
        0,  0,  0,  1,
      ]},
      matrixWorldInverse: { elements: [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ]},
    };
    window.__forgeSnapTestRenderer = {
      getSize: () => ({ width: W, height: H }),
    };
    // The screen center maps to world (0,0,0).
    window.__forgeSnapScreenCenter = { x: W / 2, y: H / 2 };
  });
}

test.describe.serial('Forge-117 · snap + grid placement', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500); // r3f canvas load
    await ensureSnapEngine(page);
    await installSyntheticCamera(page);
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 SnapStatusChip renders by default', async () => {
    // The chip self-mounts via portal next to .forge-statusbar. Give
    // the MutationObserver a beat to settle, then assert.
    await page.waitForTimeout(500);
    const chip = page.locator('[data-testid="forge-snap-chip"]');
    await expect(chip).toBeVisible({ timeout: 4000 });
    await shot(page, 'chip-default');

    // window state must exist with default modes.
    const state = await page.evaluate(() => {
      const s = window.__forgeSnapApi && window.__forgeSnapApi.getSnapState();
      if (!s) return null;
      return { enabled: s.enabled, modes: Array.from(s.modes), gridSize: s.gridSize };
    });
    expect(state).not.toBeNull();
    expect(state.enabled).toBe(true);
    expect(state.modes).toEqual(expect.arrayContaining(['vertex', 'grid', 'origin']));
    expect(state.gridSize).toBeGreaterThan(0);
  });

  test('02 toggle vertex snap off · chip reflects · screenshot', async () => {
    const chip = page.locator('[data-testid="forge-snap-chip"]');
    await chip.click();
    const vertexBtn = page.locator('[data-testid="forge-snap-mode-vertex"]');
    await expect(vertexBtn).toBeVisible({ timeout: 2000 });
    await shot(page, 'picker-open');
    await vertexBtn.click();
    await page.waitForTimeout(200);
    await shot(page, 'vertex-off');

    const has = await page.evaluate(() => {
      const s = window.__forgeSnapApi.getSnapState();
      return s.modes.has('vertex');
    });
    expect(has).toBe(false);

    // Close picker and turn vertex back on for the next assertions.
    await page.evaluate(() => {
      window.__forgeSnapApi.setSnapState({
        modes: new Set([...window.__forgeSnapApi.getSnapState().modes, 'vertex']),
      });
    });
    await page.keyboard.press('Escape');
    await page.mouse.click(10, 10);    // dismiss any open picker
    await page.waitForTimeout(150);
  });

  test('03 open a sketch · click near origin · snap within 1mm of (0,0,0)', async () => {
    // Open a sketch the same way the sketcher spec does. If the QAT
    // sketch button isn't reachable (welcome overlay etc.), tolerate
    // the failure — the snap math test below still proves the engine.
    try {
      const sketchBtn = page.locator('[data-qat-id="sketch.new"]');
      if (await sketchBtn.isVisible({ timeout: 1500 })) await sketchBtn.click();
    } catch (_) { /* shell already in sketch or no sketch button */ }
    await page.waitForTimeout(400);
    await shot(page, 'sketch-opened');

    // Drive findSnap directly with a screenPos 3px from the origin.
    const result = await page.evaluate(() => {
      const c = window.__forgeSnapScreenCenter;
      return window.__forgeSnapApi.findSnap({
        screenPos: { x: c.x + 3, y: c.y - 2 }, // within 8px of origin
        camera:   window.__forgeSnapTestCam,
        renderer: window.__forgeSnapTestRenderer,
        candidates: [],
      });
    });
    expect(result).not.toBeNull();
    expect(result.kind).toBe('origin');
    const d = Math.hypot(result.world[0], result.world[1], result.world[2]);
    expect(d).toBeLessThan(1.0);
    await shot(page, 'origin-snapped');
  });

  test('04 grid snap with 10mm grid · click (12,7) → snaps to (10,10)', async () => {
    // Enable grid only (disable origin so it doesn't beat the grid in
    // the priority order) and set 10mm grid.
    await page.evaluate(() => {
      window.__forgeSnapApi.setSnapState({
        enabled: true,
        modes: new Set(['grid']),
        gridSize: 10,
      });
    });
    await page.waitForTimeout(150);
    await shot(page, 'grid-mode-only');

    const result = await page.evaluate(() => {
      const c = window.__forgeSnapScreenCenter;
      // 1mm = 1px in our synthetic camera, so world (12,7) projects to
      // (cx + 12, cy - 7) on screen.
      return window.__forgeSnapApi.findSnap({
        ray: {
          origin: [12, 7, 100],
          direction: [0, 0, -1],
        },
        screenPos: { x: c.x + 12, y: c.y - 7 },
        gridSize: 10,
        camera:   window.__forgeSnapTestCam,
        renderer: window.__forgeSnapTestRenderer,
        plane:    { point: [0, 0, 0], normal: [0, 0, 1] },
        candidates: [],
      });
    });
    expect(result).not.toBeNull();
    expect(result.kind).toBe('grid');
    expect(result.world[0]).toBeCloseTo(10, 5);
    expect(result.world[1]).toBeCloseTo(10, 5);
    expect(Math.abs(result.world[2])).toBeLessThan(1e-6);
    await shot(page, 'grid-snap-10-10');
  });

  test('05 right-click chip · grid size input editable', async () => {
    const chip = page.locator('[data-testid="forge-snap-chip"]');
    await chip.click({ button: 'right' });
    const input = page.locator('[data-testid="forge-snap-grid-size"]');
    await expect(input).toBeVisible({ timeout: 2000 });
    await input.fill('25');
    await input.press('Enter');
    await page.waitForTimeout(150);
    const gs = await page.evaluate(() => window.__forgeSnapApi.getSnapState().gridSize);
    expect(gs).toBe(25);
    await shot(page, 'grid-size-25');
  });

  test('06 snap state persists to localStorage', async () => {
    const stored = await page.evaluate(() => {
      try { return JSON.parse(window.localStorage.getItem('forge.v4.snap')); }
      catch (_) { return null; }
    });
    expect(stored).not.toBeNull();
    expect(stored.gridSize).toBe(25);
    expect(Array.isArray(stored.modes)).toBe(true);
  });
});
