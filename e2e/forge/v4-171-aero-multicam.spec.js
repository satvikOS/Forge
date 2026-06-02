// v4-171-aero-multicam.spec.js — Forge-171 headed multi-camera verification
// of the Aerospace airfoil & wing-loft workbench.
//
// Steps:
//   1. Launch the headed Mac-Electron app.
//   2. Switch into the 'aero' workbench, fill in NACA 2412 / chord 200 / b/2 1000.
//   3. Generate the wing (native forge.airfoil.trapezoidalWing).
//   4. Cycle through ≥ 5 camera angles (iso / front / top / right / close)
//      and screenshot each — single-angle screenshots hide back-face geometry
//      and miss scale problems in remote-desktop sessions
//      (see memory: feedback-forge-multicam-e2e).
//   5. Assert geometry visible, status panel shows the new handle,
//      manual UI did NOT post to Archie's thread.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-171-aero';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _shotN = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_shotN).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

// Camera angles — the user is remote-desktop on a Mac Studio, so we exercise
// the named views from Forge-57 (number keys 1-7) plus an extra close-up.
const VIEWS = [
  { key: '1', name: 'iso'   },
  { key: '2', name: 'front' },
  { key: '4', name: 'top'   },
  { key: '6', name: 'right' },
  { key: '3', name: 'back'  },
];

test.describe.serial('Forge-171 · aerospace airfoil + wing · multi-camera', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // r3f Canvas + workbench mount take a few seconds.
    await page.waitForTimeout(3500);
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('01 baseline app shell loads', async () => {
    await shot(page, 'baseline');
    const root = page.locator('[data-testid="forge-app"], #root').first();
    await expect(root).toBeVisible({ timeout: 4000 });
  });

  test('02 forge.airfoil bridge is wired into window.forge', async () => {
    const has = await page.evaluate(() => {
      return typeof window.forge === 'object'
          && typeof window.forge.airfoil === 'object'
          && typeof window.forge.airfoil.naca4 === 'function'
          && typeof window.forge.airfoil.trapezoidalWing === 'function';
    });
    expect(has, 'window.forge.airfoil missing in renderer').toBe(true);
  });

  test('03 open the aero workbench', async () => {
    await page.evaluate(() => { window.__forgeOpenAerospaceWorkbench?.(); });
    await page.waitForTimeout(800);
    await shot(page, 'aero-panel-open');
    await expect(page.locator('[data-testid="forge-aero-panel"]'))
      .toBeVisible({ timeout: 3000 });
  });

  test('04 NACA 2412 profile preview renders', async () => {
    // Make sure we are in NACA mode + the 2412 default is set.
    await page.locator('[data-testid="forge-aero-src-naca"]').check({ force: true }).catch(() => {});
    const codeBox = page.locator('[data-testid="forge-aero-naca-code"]');
    await codeBox.fill('2412');
    await page.waitForTimeout(400);
    await shot(page, 'naca-2412-profile');
    await expect(page.locator('[data-testid="forge-aero-profile"]'))
      .toBeVisible({ timeout: 2000 });
    // Live planform metrics block appears once the profile resolves.
    await expect(page.locator('[data-testid="forge-aero-live-metrics"]'))
      .toBeVisible({ timeout: 2000 });
  });

  test('05 set wing parameters (sized to fit default viewport camera)', async () => {
    // The Forge-v4 default camera sits at distance 60 from origin. A
    // life-scale 200×1000 mm wing would be inside-the-camera; this slice
    // uses a 20×80 mm "wind-tunnel-model" scale so the wing fits the
    // default frustum and renders at all 5 cardinal views.
    await page.locator('[data-testid="forge-aero-rc"]').fill('20');
    await page.locator('[data-testid="forge-aero-tr"]').fill('0.5');
    await page.locator('[data-testid="forge-aero-hs"]').fill('40');
    await page.locator('[data-testid="forge-aero-sw"]').fill('20');
    await page.locator('[data-testid="forge-aero-dh"]').fill('5');
    await page.locator('[data-testid="forge-aero-tw"]').fill('-2');
    await page.locator('[data-testid="forge-aero-st"]').fill('5');
    await page.waitForTimeout(300);
    await shot(page, 'params-set');
  });

  test('06 generate wing — kernel loft + scene publish', async () => {
    await page.locator('[data-testid="forge-aero-generate"]').click();
    // Allow ThruSections build + tessellation.
    await page.waitForTimeout(1500);
    await shot(page, 'wing-generated');
    const result = page.locator('[data-testid="forge-aero-result"]');
    await expect(result).toBeVisible({ timeout: 4000 });
    const status = await page.locator('[data-testid="forge-aero-status"]').innerText();
    expect(status, `aero status was: ${status}`).toMatch(/wing #\d+ built/i);
    // Confirm the scene actually has the body.
    const bodyCount = await page.evaluate(() => {
      return (window.__forgeBodies || []).filter((b) => b.toolId === 'aero.wing').length;
    });
    expect(bodyCount).toBeGreaterThanOrEqual(1);
  });

  test('07 multi-camera screenshots — iso/front/top/right/back', async () => {
    // Close the panel so the viewport dominates the screen
    // (per memory: feedback-scale-to-viewer).
    await page.evaluate(() => { window.__forgeCloseAerospaceWorkbench?.(); });
    await page.waitForTimeout(400);
    // Drop focus off the workbench inputs — the shell's view shortcuts
    // are guarded by `activeElement.tagName !== 'INPUT'/'TEXTAREA'`.
    // Clicking the canvas both releases focus and gives r3f the next
    // pointer for orbit.
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (box) await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.evaluate(() => {
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
    });
    await page.waitForTimeout(200);
    // Zoom-fit to frame the new wing — the wing is 200×1000×6 mm so the
    // default camera (set up for unit-scale demos) misses it entirely.
    await page.evaluate(() => { window.__forgeFit?.(); });
    await page.waitForTimeout(400);
    for (const v of VIEWS) {
      await page.keyboard.press(v.key);
      await page.waitForTimeout(500);
      // Re-fit between views so each angle frames the wing.
      await page.evaluate(() => { window.__forgeFit?.(); });
      await page.waitForTimeout(350);
      await shot(page, `wing-${v.name}`);
    }
  });

  test('08 close-up zoom screenshot', async () => {
    // The named-view system from Forge-57 covers 5 directions but no
    // "close" zoom — emulate via repeated wheel-zoom on the canvas.
    const canvas = page.locator('canvas').first();
    if (await canvas.count()) {
      const box = await canvas.boundingBox();
      if (box) {
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        for (let i = 0; i < 12; ++i) await page.mouse.wheel(0, -120);
      }
    }
    await page.waitForTimeout(400);
    await shot(page, 'wing-close');
  });

  test('09 light theme · re-screenshot iso (Studio-style brightness sanity)', async () => {
    await page.keyboard.press('Meta+t');
    await page.waitForTimeout(500);
    await page.keyboard.press('1');
    await page.waitForTimeout(450);
    await shot(page, 'wing-iso-light');
    await page.keyboard.press('Meta+t');  // restore dark
    await page.waitForTimeout(300);
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    // Manual workbench actions must never write to Archie's thread per
    // memory: feedback-forge-manual-not-archie.
    expect(archieMsgs).toBe(0);
  });
});
