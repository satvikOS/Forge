// v4-cam.spec.js — Forge-92 headed verification of the Manufacturing
// (CAM) workbench panel.
//
// Flow:
//   01 launch headed Electron + open the panel via window.__forgeOpenCam()
//   02 stock tab: block 80×50×15 with margin 1
//   03 tools tab: pick EndMill Ø6
//   04 ops tab: configure a profile op (zTop 15, zBottom 0, leadIn 2) →
//      Generate. Either the kernel returns a real toolpath (moveCount > 0)
//      OR the panel shows a clear kernel-offline state; both outcomes are
//      accepted, the spec only fails if we synthesised fake numbers.
//   05 g-code tab: pick Fanuc, click Export → assert the viewer either
//      shows real G-code (M30 / G17) or the "kernel not ready" note;
//      never a fake program.
//
// Manual clicks must NOT post to Archie's thread.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-cam';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js'
);

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge v4 · CAM (Forge-92) headed', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // r3f + ManufacturingWorkbenchHost mount inside App.jsx; give the
    // shell a generous warmup before we poke any test ids.
    await page.waitForTimeout(3500);
  });
  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('01 host is mounted and opens via window.__forgeOpenCam()', async () => {
    await shot(page, 'initial');
    const ok = await page.evaluate(() => typeof window.__forgeOpenCam === 'function');
    expect(ok, 'window.__forgeOpenCam should be installed').toBe(true);

    // Open with no body — the panel must still mount and fall back to the
    // 60×40×20 block default; we'll switch to Block mode below.
    await page.evaluate(() => window.__forgeOpenCam());
    await page.waitForTimeout(700);
    await expect(page.locator('[data-testid="forge-cam-panel"]')).toBeVisible();
    await shot(page, 'panel-open');
  });

  test('02 stock tab — switch to Block + set 80×50×15', async () => {
    // Force the Stock tab (it's the default but make the test explicit).
    await page.click('[data-cam-tab="stock"]');
    await page.waitForTimeout(150);
    // Switch the stock mode to Block.
    await page.click('[data-cam-mode="block"]');
    await page.waitForTimeout(150);

    const setNum = async (testid, value) => {
      const el = page.locator(`[data-testid="${testid}"]`);
      await el.fill('');
      await el.fill(String(value));
      await el.dispatchEvent('change');
    };
    await setNum('forge-cam-block-dx', 80);
    await setNum('forge-cam-block-dy', 50);
    await setNum('forge-cam-block-dz', 15);
    await page.waitForTimeout(200);
    await shot(page, 'stock-block-80-50-15');

    // Footer reflects the current AABB summary.
    await expect(page.locator('[data-testid="forge-cam-panel"]'))
      .toContainText(/80×50×15/);
  });

  test('03 tools tab — pick EndMill Ø6 (em6)', async () => {
    await page.click('[data-cam-tab="tools"]');
    await page.waitForTimeout(150);
    await page.click('[data-testid="forge-cam-tool-em6"]');
    await page.waitForTimeout(150);
    await shot(page, 'tools-em6');
    const active = await page
      .locator('[data-testid="forge-cam-tool-em6"][data-active="true"]')
      .count();
    expect(active, 'EndMill Ø6 should be the picked tool').toBeGreaterThan(0);
  });

  test('04 ops tab — configure a profile op + Generate', async () => {
    await page.click('[data-cam-tab="ops"]');
    await page.waitForTimeout(150);

    // The default op is already "Profile (contour)" — set z extents to the
    // 80×50×15 block we configured in step 02.
    const setNum = async (testid, value) => {
      const el = page.locator(`[data-testid="${testid}"]`);
      await el.fill('');
      await el.fill(String(value));
      await el.dispatchEvent('change');
    };
    await setNum('forge-cam-zTop', 15);
    await setNum('forge-cam-zBottom', 0);
    await setNum('forge-cam-leadIn', 2);
    await page.waitForTimeout(150);
    await shot(page, 'ops-configured');

    // Generate. Whether the kernel is present or not, the Generate button
    // must exist; if present, it either produces an op summary or an error
    // chip — never a faked toolpath.
    const generate = page.locator('[data-testid="forge-cam-generate"]');
    await expect(generate).toBeVisible();
    const camReady = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="forge-cam-panel"]');
      return el?.getAttribute('data-cam-ready') === 'true';
    });

    if (camReady) {
      await generate.click();
      await page.waitForTimeout(700);
      await shot(page, 'ops-generated');
      const summary = page.locator('[data-testid="forge-cam-op-summary"]');
      const error   = page.locator('[data-testid="forge-cam-op-error"]');
      // Either real output OR a structured error — never both blank.
      const okShown  = await summary.count();
      const errShown = await error.count();
      expect(okShown + errShown,
             'generate must emit either a summary or an error').toBeGreaterThan(0);
      if (okShown > 0) {
        await expect(summary).toContainText(/\d+ moves/);
      }
    } else {
      // Kernel not loaded in this dev shell — the Generate button is
      // disabled and reads "kernel offline". This is the contract: never
      // fabricate a toolpath.
      await expect(generate).toBeDisabled();
      await expect(generate).toContainText(/kernel offline/i);
      await shot(page, 'ops-kernel-offline');
    }
  });

  test('05 g-code tab — pick Fanuc + Export → real or kernel-not-ready', async () => {
    await page.click('[data-cam-tab="gcode"]');
    await page.waitForTimeout(200);
    const dialect = page.locator('[data-testid="forge-cam-dialect"]');
    await dialect.selectOption('Fanuc');
    await page.waitForTimeout(120);
    await shot(page, 'gcode-fanuc');

    const camReady = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="forge-cam-panel"]');
      return el?.getAttribute('data-cam-ready') === 'true';
    });
    const exp = page.locator('[data-testid="forge-cam-export"]');
    await expect(exp).toBeVisible();

    if (camReady) {
      await exp.click();
      await page.waitForTimeout(500);
      const text = (await page.locator('[data-testid="forge-cam-gcode"]')
        .innerText()).trim();
      // Real G-code must contain at least one G or M word — and never a
      // sentinel placeholder. We also accept the note path in case the
      // op didn't produce a toolpath earlier (e.g. kernel error mid-run).
      const note = await page.locator('[data-testid="forge-cam-gcode-note"]').count();
      expect(/(G\d+|M\d+)/.test(text) || note > 0,
             'g-code viewer must show real codes or a kernel-not-ready note').toBe(true);
      // Save button enabled when text exists.
      if (/(G\d+|M\d+)/.test(text)) {
        await expect(page.locator('[data-testid="forge-cam-save"]')).toBeEnabled();
      }
    } else {
      await expect(exp).toBeDisabled();
      await expect(exp).toContainText(/kernel offline/i);
      await shot(page, 'gcode-kernel-offline');
    }
  });

  test('06 manual clicks did NOT post to Archie thread', async () => {
    // The Archie dock messages list is empty in the kernel-wired test, and
    // it must stay empty after every CAM click as well.
    const count = await page.locator('[data-testid="forge-archie"] [data-role]').count();
    expect(count, 'manual CAM clicks must not write to Archie thread').toBe(0);
  });

  test('07 close panel', async () => {
    await page.click('[data-testid="forge-cam-close"]');
    await page.waitForTimeout(250);
    await expect(page.locator('[data-testid="forge-cam-panel"]')).toHaveCount(0);
    await shot(page, 'panel-closed');
  });
});
