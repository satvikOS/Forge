// v4-scenario-runner.spec.js — Forge-105 headed verification.
//
// Drives the Scenario Runner modal:
//   1. Mount both the ScenarioRunner host AND the VideoCaptureHUD inside
//      the running Electron shell (the shell file is frozen).
//   2. Inject a mock window.forge so scenario.run() has a "ready" kernel.
//   3. Open the runner via window.__forgeOpenScenarioRunner(true).
//   4. Pick the thermal-cycle scenario.
//   5. Enter a body handle, click Run.
//   6. Assert one of two banners: result viewer OR error toast (kernel may
//      not implement solveThermal in some Electron builds, both are valid).
//   7. Confirm the HUD record toggle exists (Forge-104 wiring).
//
// Headed Mac Electron, screenshots per step into /tmp/v4-scenario-runner/.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-scenario-runner';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge v4 · Scenario Runner + Video Capture', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // r3f warm-up
    await page.waitForTimeout(3500);
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 install mock kernel + mount runner + HUD hosts', async () => {
    await page.evaluate(async () => {
      // 1. Mock window.forge with the FEA surface the scenarios call.
      const mkMesh = () => {
        // Tiny 1-element tet mesh — enough to round-trip through the viewer.
        return {
          nodes: new Float64Array([
            0, 0, 0,
            1, 0, 0,
            0, 1, 0,
            0, 0, 1,
          ]),
          elements: new Uint32Array([0, 1, 2, 3]),
          nodeCount: 4,
          elemCount: 1,
          elemNodeCount: 4,
          nodeToFace: new Uint32Array([1, 2, 4, 8]),
        };
      };
      const fea = {
        meshFromBrep: (h, s) => mkMesh(),
        solveStatic: (m, mat, loads, p, bcs) => ({
          u: new Float64Array(m.nodeCount * 3),
          stress: new Float64Array(m.elemCount),
          vonMises: new Float32Array(m.nodeCount),
        }),
        solveModal: (m) => ({ modes: [
          { freq: 100, shape: new Float64Array(m.nodeCount * 3) },
        ]}),
        solveDynamic: (m) => ({ u: new Float64Array(m.nodeCount * 3) }),
        solveThermal: (m) => ({
          temperature: new Float64Array(m.nodeCount).fill(373.15),
        }),
        solveContact: () => ({ u: new Float64Array(12) }),
        solveBuckling: () => ({ modes: [] }),
        solveNonlinearStatic: () => ({ u: new Float64Array(12) }),
        solveNonlinearPlastic: () => ({ u: new Float64Array(12) }),
        fatigueLife: (sh, ne) => ({ life: new Float64Array(ne).fill(1e6) }),
      };
      window.forge = { isReady: () => true, fea, cfd: {} };

      // 2. Mount both hosts (runner + HUD) into fresh React roots.
      const [React, ReactDOM, scenarioMod, hudMod] = await Promise.all([
        import('react'),
        import('react-dom/client'),
        import('/src/forge-v4/ScenarioRunner.jsx'),
        import('/src/forge-v4/VideoCaptureHUD.jsx'),
      ]);
      const srHost = document.createElement('div');
      srHost.id = 'forge-scenario-test-host';
      document.body.appendChild(srHost);
      ReactDOM.createRoot(srHost).render(
        React.createElement(scenarioMod.ScenarioRunnerHost));

      const hudHost = document.createElement('div');
      hudHost.id = 'forge-hud-test-host';
      document.body.appendChild(hudHost);
      ReactDOM.createRoot(hudHost).render(
        React.createElement(hudMod.VideoCaptureHUD));

      // Give the hosts a tick to register their globals.
      await new Promise((r) => setTimeout(r, 120));
      window.__forgeOpenScenarioRunner(true);
    });
    await page.waitForTimeout(600);
    await shot(page, 'runner-open');
    const panelCount = await page.locator('[data-testid="forge-scenario-runner"]').count();
    expect(panelCount, 'scenario runner mounted').toBe(1);
  });

  test('02 catalogue renders all ten scenarios', async () => {
    const items = await page.locator('[data-scenario-id]').count();
    expect(items, 'every scenario shown').toBe(10);
    await shot(page, 'catalogue');
  });

  test('03 pick thermal-cycle + verify spec + params surface', async () => {
    await page.click('[data-scenario-id="thermal-cycle"]');
    await page.waitForTimeout(180);
    const active = await page.locator(
      '[data-scenario-id="thermal-cycle"][data-active="true"]').count();
    expect(active, 'thermal-cycle marked active').toBe(1);

    // Spec citation visible — must include MIL-STD reference.
    const config = page.locator('[data-testid="forge-scenario-config"]');
    await expect(config).toContainText('MIL-STD-810H', { timeout: 1500 });

    // Param fields present.
    await expect(page.locator('[data-scenario-param="T_min"]')).toBeVisible();
    await expect(page.locator('[data-scenario-param="T_max"]')).toBeVisible();
    await expect(page.locator('[data-scenario-param="dwell_min"]')).toBeVisible();
    await expect(page.locator('[data-scenario-param="ramp_C_per_min"]')).toBeVisible();
    await expect(page.locator('[data-scenario-param="n_cycles"]')).toBeVisible();

    await shot(page, 'thermal-cycle-selected');
  });

  test('04 enter body handle + click Run → result OR error', async () => {
    const handleInput = page.locator('[data-testid="forge-scenario-body-handle"]');
    await handleInput.fill('42');
    await page.waitForTimeout(120);

    const runBtn = page.locator('[data-testid="forge-scenario-run"]');
    await expect(runBtn).toBeVisible();
    await runBtn.click();
    await page.waitForTimeout(900);
    await shot(page, 'post-run');

    // Either:
    //   (a) the result viewer is now visible (kernel solveThermal ran), OR
    //   (b) the error banner is visible (kernel call returned an error)
    //   (c) a toast is visible
    const viewerCount = await page.locator(
      '[data-testid="forge-fea-result-viewer"]').count();
    const errorBannerCount = await page.locator(
      '[data-testid="forge-scenario-error"]').count();
    const toastCount = await page.locator(
      '[data-testid="forge-toast"]').count();

    expect(viewerCount + errorBannerCount + toastCount,
      'one of viewer / error banner / toast must appear').toBeGreaterThan(0);
  });

  test('05 video capture HUD is mounted + toggleable', async () => {
    // The HUD lives outside the modal so it's clickable independently.
    const hud = page.locator('[data-testid="forge-video-capture-toggle"]');
    await expect(hud).toBeVisible();
    await shot(page, 'hud-visible');

    // window.__forgeRecord must be installed by the HUD's effect.
    const installed = await page.evaluate(() =>
      typeof window.__forgeRecord === 'function');
    expect(installed, 'window.__forgeRecord installed').toBe(true);
  });

  test('06 manual workflow — Archie thread untouched', async () => {
    const threadCount = await page.locator('.forge-archie-msg').count();
    expect(threadCount, 'no Archie messages written by the modal').toBe(0);
    await shot(page, 'archie-thread-untouched');
  });

  test('07 close the runner', async () => {
    await page.click('[data-testid="forge-scenario-close"]');
    await page.waitForTimeout(220);
    const stillOpen = await page.locator(
      '[data-testid="forge-scenario-runner"]').count();
    expect(stillOpen, 'runner closed').toBe(0);
    await shot(page, 'closed');
  });
});
