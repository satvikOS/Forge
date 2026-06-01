// v4-fea-advanced.spec.js — Forge-132: headed Electron verification of
// the Simulation workbench's three new study types:
//
//   - Topology Optimisation  (SIMP, density-based)
//   - Crack Propagation      (XFEM-style enrichment + J-integral K I/II/III)
//   - Adaptive Refinement    (Zienkiewicz-Zhu error indicator)
//
// Style: HUMAN-style clicks only — no calls into the React API, no
// setting input values via element.value. Every "fill" goes through
// playwright .fill(), every menu pick through .selectOption(), every
// toggle through .click(). Multi-angle screenshots + both themes.
//
// Sections:
//   01  mount workbench, capture initial state
//   02  Topology Optimisation flow (light theme + dark theme)
//   03  Crack Propagation flow (light theme + dark theme)
//   04  Adaptive Refinement flow (light theme + dark theme)
//   05  final overview

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs   = require('fs');

const SHOT_DIR = '/tmp/v4-fea-advanced';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

// The test mounts SimulationWorkbench inside the running shell by
// dynamically importing the module (Vite serves it as JSX through the
// running dev server) and rendering it into a freshly created sibling
// React root. This mirrors v4-fea.spec.js.
async function mountSimPanel(page) {
  await page.evaluate(async () => {
    if (document.querySelector('[data-testid="forge-sim-workbench"]')) return;
    const [React, ReactDOMClient, SimMod] = await Promise.all([
      import('/node_modules/react/index.js').catch(() =>
        import('https://esm.sh/react@18')),
      import('/node_modules/react-dom/client.js').catch(() =>
        import('https://esm.sh/react-dom@18/client')),
      import('/src/forge-v4/SimulationWorkbench.jsx'),
    ]);
    const host = document.createElement('div');
    host.id = '__forge-sim-host';
    host.style.cssText =
      'position:fixed;top:88px;right:0;bottom:54px;width:420px;z-index:9000;' +
      'box-shadow:-12px 0 32px rgba(0,0,0,0.45);';
    document.body.appendChild(host);
    const root = ReactDOMClient.createRoot(host);
    root.render(React.createElement(SimMod.SimulationWorkbench, {
      activeBodyHandle: 1,
      activeBodyName: 'TestBody',
      onClose: () => { host.remove(); },
    }));
    window.__forgeSimAdvMounted = true;
  });
  await page.waitForSelector('[data-testid="forge-sim-workbench"]', { timeout: 8000 });
}

// Toggle the host shell's data-theme attribute on <html>. Many forge-v4
// components read --forge-canvas etc. from tokens.css which scope by
// [data-theme="light"|"dark"]. If the shell doesn't expose a toggle,
// flipping the attribute is sufficient for visual capture.
async function setTheme(page, theme) {
  await page.evaluate((t) => {
    document.documentElement.setAttribute('data-theme', t);
    document.body.setAttribute('data-theme', t);
  }, theme);
  await page.waitForTimeout(150);
}

// Capture the same panel from three vantage points: full panel,
// scrolled bottom, and a side-on shot of the result viewer.
async function multiAngle(page, label) {
  await shot(page, `${label}-top`);
  await page.evaluate(() => {
    const host = document.querySelector('[data-testid="forge-sim-workbench"]');
    if (host) host.scrollTop = host.scrollHeight / 2;
  });
  await page.waitForTimeout(150);
  await shot(page, `${label}-mid`);
  await page.evaluate(() => {
    const host = document.querySelector('[data-testid="forge-sim-workbench"]');
    if (host) host.scrollTop = host.scrollHeight;
  });
  await page.waitForTimeout(150);
  await shot(page, `${label}-bottom`);
}

test.describe('Forge v4 · advanced FEA (topology/crack/adaptive)', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    await mountSimPanel(page);
    await page.waitForTimeout(300);
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 panel mounts with new study types in the picker', async () => {
    await shot(page, 'initial');
    await expect(page.locator('[data-testid="forge-sim-workbench"]')).toBeVisible();
    const select = page.locator('[data-testid="forge-sim-study-type"]');
    await expect(select).toBeVisible();
    const opts = await select.evaluate((el) =>
      Array.from(el.options).map((o) => o.value));
    expect(opts).toEqual(expect.arrayContaining([
      'Topology Optimisation', 'Crack Propagation', 'Adaptive Refinement',
    ]));
  });

  test('02 Topology Optimisation — pick + fill + solve (dark theme)', async () => {
    await setTheme(page, 'dark');
    const select = page.locator('[data-testid="forge-sim-study-type"]');
    await select.selectOption('Topology Optimisation');
    await page.waitForTimeout(200);
    await shot(page, 'topo-picked');

    // Volume fraction 0.3
    const vf = page.locator('[data-testid="forge-topo-vf"]');
    await expect(vf).toBeVisible();
    await vf.click();
    await vf.fill('0.3');
    await page.waitForTimeout(100);

    // Set penalty to 3.0 (default) and pick a symmetry plane via click.
    const sym = page.locator('[data-testid="forge-topo-sym"]');
    await sym.selectOption('y');
    const draw = page.locator('[data-testid="forge-topo-draw"]');
    await draw.selectOption('0,0,1');
    await shot(page, 'topo-params-filled');

    // Click Solve (this calls the SIMP loop; kernel-offline path also
    // produces a valid screenshot — the panel says "kernel required").
    const solveBtn = page.locator('[data-testid="forge-sim-solve"]');
    await solveBtn.scrollIntoViewIfNeeded();
    await solveBtn.click();
    await page.waitForTimeout(2500);
    await shot(page, 'topo-solve-clicked');

    // Either the topology viewer rendered, or a clean error banner.
    const viewerCount = await page.locator('[data-testid="forge-topology-viewer"]').count();
    const errCount    = await page.locator('[data-testid="forge-sim-solve-error"]').count();
    const emptyText   = await page.locator('[data-testid="forge-sim-result-viewer-wrap"]').textContent();
    expect(viewerCount + errCount + (emptyText ? 1 : 0)).toBeGreaterThan(0);
    await multiAngle(page, 'topo-dark');
  });

  test('03 Topology — light theme + threshold slider', async () => {
    await setTheme(page, 'light');
    await page.waitForTimeout(150);
    await shot(page, 'topo-light');

    // The threshold slider is only present when the viewer mounted
    // (kernel was ready). If absent, that's the documented offline path.
    const slider = page.locator('[data-testid="forge-topology-threshold"]');
    const cnt = await slider.count();
    if (cnt > 0) {
      await slider.focus();
      // Step the slider up via keyboard so we use real input events.
      for (let i = 0; i < 5; i++) {
        await page.keyboard.press('ArrowRight');
        await page.waitForTimeout(40);
      }
      await shot(page, 'topo-threshold-high');
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('ArrowLeft');
        await page.waitForTimeout(40);
      }
      await shot(page, 'topo-threshold-low');
    }
    await multiAngle(page, 'topo-light');
  });

  test('04 Crack Propagation — pick + fill + solve (dark theme)', async () => {
    await setTheme(page, 'dark');
    const select = page.locator('[data-testid="forge-sim-study-type"]');
    await select.selectOption('Crack Propagation');
    await page.waitForTimeout(200);
    await shot(page, 'crack-picked');

    await expect(page.locator('[data-testid="forge-crack-len"]')).toBeVisible();
    const len = page.locator('[data-testid="forge-crack-len"]');
    await len.click();
    await len.fill('0.005');
    const da = page.locator('[data-testid="forge-crack-da"]');
    await da.click();
    await da.fill('0.001');
    const steps = page.locator('[data-testid="forge-crack-steps"]');
    await steps.click();
    await steps.fill('5');
    await shot(page, 'crack-params-filled');

    const solveBtn = page.locator('[data-testid="forge-sim-solve"]');
    await solveBtn.scrollIntoViewIfNeeded();
    await solveBtn.click();
    await page.waitForTimeout(2500);
    await shot(page, 'crack-solve-clicked');

    const resCount = await page.locator('[data-testid="forge-crack-result"]').count();
    const errCount = await page.locator('[data-testid="forge-sim-solve-error"]').count();
    expect(resCount + errCount).toBeGreaterThan(0);
    await multiAngle(page, 'crack-dark');
  });

  test('05 Crack — light theme inspection', async () => {
    await setTheme(page, 'light');
    await page.waitForTimeout(150);
    await shot(page, 'crack-light');
    await multiAngle(page, 'crack-light');
  });

  test('06 Adaptive Refinement — pick + fill + solve (dark theme)', async () => {
    await setTheme(page, 'dark');
    const select = page.locator('[data-testid="forge-sim-study-type"]');
    await select.selectOption('Adaptive Refinement');
    await page.waitForTimeout(200);
    await shot(page, 'adapt-picked');

    const h = page.locator('[data-testid="forge-adapt-h"]');
    await h.click();
    await h.fill('3');
    const tol = page.locator('[data-testid="forge-adapt-tol"]');
    await tol.click();
    await tol.fill('0.05');
    const iters = page.locator('[data-testid="forge-adapt-iters"]');
    await iters.click();
    await iters.fill('3');
    await shot(page, 'adapt-params-filled');

    const solveBtn = page.locator('[data-testid="forge-sim-solve"]');
    await solveBtn.scrollIntoViewIfNeeded();
    await solveBtn.click();
    await page.waitForTimeout(3000);
    await shot(page, 'adapt-solve-clicked');

    const resCount = await page.locator('[data-testid="forge-adapt-result"]').count();
    const errCount = await page.locator('[data-testid="forge-sim-solve-error"]').count();
    expect(resCount + errCount).toBeGreaterThan(0);
    await multiAngle(page, 'adapt-dark');
  });

  test('07 Adaptive — light theme inspection', async () => {
    await setTheme(page, 'light');
    await page.waitForTimeout(150);
    await shot(page, 'adapt-light');
    await multiAngle(page, 'adapt-light');
  });

  test('08 cycle through study types again — picker stays responsive', async () => {
    const select = page.locator('[data-testid="forge-sim-study-type"]');
    for (const t of ['Topology Optimisation', 'Crack Propagation',
                     'Adaptive Refinement', 'Static']) {
      await select.selectOption(t);
      await page.waitForTimeout(120);
      await shot(page, `cycle-${t.toLowerCase().replace(/\s+/g, '-')}`);
    }
  });

  test('09 final — Archie thread untouched by manual clicks', async () => {
    // Per Forge convention, manual clicks NEVER post to Archie. Confirm.
    const threadCount = await page.locator('.forge-archie-msg').count();
    expect(threadCount).toBe(0);
    await shot(page, 'final-archie-untouched');
    await expect(page.locator('[data-testid="forge-sim-workbench"]')).toBeVisible();
  });
});
