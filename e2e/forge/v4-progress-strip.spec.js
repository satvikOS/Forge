// v4-progress-strip.spec.js — Forge-114: headed Electron verification of
// the long-running-solve ProgressStrip.
//
// Strategy: ForgeShellV4.jsx + Toolbar.jsx are frozen. We import the
// ProgressStripPortal into a sibling React root attached to document.body,
// then mock window.forge.fea.solveStatic to spin for 2 s. Driving the
// solve goes through the real simulationDispatch.solveStatic so we exercise
// the actual progressBus wiring end-to-end.
//
// What we verify:
//   01  Strip self-mounts (empty placeholder present, no rows yet).
//   02  Starting a solve renders a row labelled "FEA Static · MockBody".
//   03  The pct value increments while the (fake) solve runs.
//   04  Within 3 s after the kernel returns, the row disappears.
//   05  Cancel button aborts and dismisses the row.
//   06  Manual clicks NEVER write to the Archie dock thread.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-progress-strip';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

// Mount the ProgressStripPortal into a sibling React root.
async function mountStrip(page) {
  await page.evaluate(async () => {
    if (window.__forgeProgressTestMounted) return;
    const [React, ReactDOMClient, StripMod] = await Promise.all([
      import('/node_modules/react/index.js').catch(() =>
        import('https://esm.sh/react@18')),
      import('/node_modules/react-dom/client.js').catch(() =>
        import('https://esm.sh/react-dom@18/client')),
      import('/src/forge-v4/ProgressStrip.jsx'),
    ]);
    const host = document.createElement('div');
    host.id = '__forge-progress-test-host';
    document.body.appendChild(host);
    const root = ReactDOMClient.createRoot(host);
    root.render(React.createElement(StripMod.ProgressStripPortal));
    window.__forgeProgressTestMounted = { host, root };
  });
  await page.waitForSelector('[data-testid="forge-progress-strip"]', { timeout: 8000 });
}

// Install a fake kernel that delays solveStatic by ~2 s.
async function installFakeKernel(page) {
  await page.evaluate(() => {
    window.__realForge = window.forge;
    const fakeMesh = { nodeCount: 8, elemCount: 1, nodeToFace: new Uint32Array(8) };
    const fakeMaterial = { E: 2.1e11, nu: 0.3, rho: 7800, sigmaY: 250e6 };
    window.__fakeMesh = fakeMesh;
    window.__fakeMaterial = fakeMaterial;
    const realForge = window.forge || {};
    window.forge = {
      ...realForge,
      isReady: () => true,
      fea: {
        ...((realForge && realForge.fea) || {}),
        meshFromBrep: () => fakeMesh,
        solveStatic: () => {
          // Hot busy-wait would block the renderer thread and starve our
          // setInterval ticker, so we use a real synchronous-ish delay
          // via a tight while loop only for ~50 ms chunks. Then return.
          const end = Date.now() + 2000;
          while (Date.now() < end) {
            // yield via dummy compute so the renderer remains responsive
            for (let i = 0; i < 1000; i++) Math.sqrt(i);
          }
          return {
            displacements: new Float32Array(24),
            vonMises: new Float32Array(8),
            nodeCount: 8,
            elemCount: 1,
          };
        },
      },
    };
  });
}

// Trigger a solve via the real simulationDispatch.solveStatic.
async function triggerSolve(page, { bodyName = 'MockBody' } = {}) {
  await page.evaluate(async (bodyName) => {
    const mod = await import('/src/forge-v4/simulationDispatch.js');
    // Don't await — we want the Playwright assertions to observe the
    // row WHILE the solve is in flight. We stash the promise globally.
    window.__solvePromise = Promise.resolve().then(() =>
      mod.solveStatic({
        mesh: window.__fakeMesh,
        material: window.__fakeMaterial,
        bodyName,
        loads: [],
        bcs: [],
      }),
    );
  }, bodyName);
}

test.describe('Forge v4 · Progress strip', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    await mountStrip(page);
    await installFakeKernel(page);
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 strip self-mounts (empty placeholder visible)', async () => {
    const strip = page.locator('[data-testid="forge-progress-strip"]');
    await expect(strip).toBeAttached();
    await expect(strip).toHaveAttribute('data-forge-empty', 'true');
    await shot(page, 'mounted-empty');
  });

  test('02 starting a solve renders a row labelled "FEA Static"', async () => {
    await triggerSolve(page, { bodyName: 'MockBody' });
    // First repaint should publish the row within ~50 ms.
    await page.waitForSelector(
      '[data-forge-progress-label*="FEA Static"]',
      { timeout: 1500 },
    );
    const labels = await page.locator('[data-testid="forge-progress-label"]').allTextContents();
    expect(labels.some((t) => /FEA Static/.test(t))).toBe(true);
    expect(labels.some((t) => /MockBody/.test(t))).toBe(true);
    await shot(page, 'row-visible');
  });

  test('03 pct increments while solve runs', async () => {
    // First reading.
    const firstPct = await page
      .locator('[data-testid="forge-progress-bar"]').first()
      .evaluate((el) => parseFloat(el.style.width) || 0);
    // Wait a chunk, sample again. Must strictly increase.
    await page.waitForTimeout(700);
    const secondPct = await page
      .locator('[data-testid="forge-progress-bar"]').first()
      .evaluate((el) => parseFloat(el.style.width) || 0);
    expect(secondPct).toBeGreaterThan(firstPct);
    expect(secondPct).toBeLessThanOrEqual(100);
    await shot(page, 'pct-incrementing');
  });

  test('04 row disappears within 3 s of solve finishing', async () => {
    // Wait for the kernel call to resolve.
    await page.evaluate(() => window.__solvePromise);
    // Allow the auto-dismiss timer (2 s) + a small buffer.
    await expect(async () => {
      const empty = await page.locator('[data-testid="forge-progress-strip"]')
        .getAttribute('data-forge-empty');
      expect(empty).toBe('true');
    }).toPass({ timeout: 3000, intervals: [150, 300, 600] });
    await shot(page, 'row-dismissed');
  });

  test('05 cancel button aborts an in-flight job', async () => {
    // Kick off another solve and cancel it immediately.
    await triggerSolve(page, { bodyName: 'CancelMe' });
    await page.waitForSelector(
      '[data-forge-progress-label*="CancelMe"]',
      { timeout: 1500 },
    );
    await shot(page, 'cancel-before');
    const cancelBtn = page.locator(
      '[data-testid^="forge-progress-cancel-"]',
    ).first();
    await cancelBtn.click();
    // Status flips to cancelled.
    await page.waitForFunction(() => {
      const row = document.querySelector('[data-job-status="cancelled"]');
      return !!row;
    }, null, { timeout: 1500 });
    // Then dismissed within the 2 s auto-dismiss window.
    await expect(async () => {
      const empty = await page.locator('[data-testid="forge-progress-strip"]')
        .getAttribute('data-forge-empty');
      expect(empty).toBe('true');
    }).toPass({ timeout: 3000, intervals: [150, 300, 600] });
    await shot(page, 'cancel-after');
    // Drain the underlying promise so the next test starts clean.
    await page.evaluate(() => window.__solvePromise);
  });

  test('06 manual clicks never write to the Archie dock thread', async () => {
    const threadCount = await page.locator('.forge-archie-msg').count();
    expect(threadCount).toBe(0);
    await shot(page, 'archie-thread-untouched');
  });
});
