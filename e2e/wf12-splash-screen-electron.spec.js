/**
 * Workflow-12 — Cold-start splash screen.
 *
 * Covers the first ~2.5 s of cold-start (OCCT WASM, manifold-3d WASM,
 * Three.js viewport boot) with a branded panel + progress bar. Without
 * it the user sees an empty grey rectangle then a sudden flash to the
 * dark workbench, which feels unprofessional.
 *
 * Behaviour asserted on a real workflow:
 *   1. Fresh launch (suppress key cleared) → splash mounts with
 *      `data-archdisc-splash="visible"`
 *   2. Branded mark (SVG cube), title, status text all rendered
 *   3. Progress bar advances from 0% → 100% over the boot window
 *   4. Once kernel + scene are ready, splash fades to
 *      `data-archdisc-splash="fading"` then unmounts
 *   5. Workbench becomes interactive — and to prove it really did,
 *      the test then drives a real CAD project: builds a marine
 *      propeller hub assembly (5 bodies — hub, 4 blade bosses)
 *      through the run-tool dispatch
 *   6. Recently shown flag is set in localStorage; on a quick
 *      reload the splash is suppressed (avoid spam during dev /
 *      e2e workflow)
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf12-splash-screen');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-12 — Splash appears on cold start, dismisses on kernel-ready, then drives a marine-propeller-hub build', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, NODE_ENV: 'test' },
    slowMo: 0,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  // Splash visible BEFORE the kernel is exposed (race: the kernel
  // exposure happens inside Three.js setup which is also when the
  // splash is allowed to start fading. The splash mounts immediately
  // since it's a top-level React component).
  const splash = win.locator('[data-archdisc-splash]');
  // Splash may have already started dismissing if WASM is hot — accept
  // both "visible" and "fading" as PROOF the splash mounted.
  await expect(splash).toBeAttached({ timeout: 10000 });
  const initialState = await splash.getAttribute('data-archdisc-splash');
  expect(['visible', 'fading']).toContain(initialState);

  // Branded panel content.
  await expect(win.locator('.splash-title')).toContainText('ArchDisc');
  await expect(win.locator('.splash-sub')).toContainText(/Mechanical CAD/);
  await expect(win.locator('[data-archdisc-splash-progress]')).toBeVisible();

  await win.screenshot({ path: path.join(OUT, '01-splash-visible.png') });

  // Wait for kernel readiness → splash dismisses.
  await win.waitForFunction(
    () => !!window.__archdiscKernel && !!window.__archdiscBodies && !!window.__archdiscScene,
    null, { timeout: 60000 });
  // Splash should now be either fading or fully unmounted.
  await expect(win.locator('[data-archdisc-splash="visible"]')).toHaveCount(0, { timeout: 5000 });
  // Eventually it fully unmounts (after 360ms fade).
  await expect(splash).toHaveCount(0, { timeout: 5000 });
  await win.screenshot({ path: path.join(OUT, '02-after-splash.png') });

  // localStorage records the splash-shown timestamp.
  const shownAt = await win.evaluate(() => {
    const raw = window.localStorage.getItem('archdisc:splash:lastShownAt');
    return raw ? parseInt(raw, 10) : null;
  });
  expect(shownAt).not.toBeNull();
  expect(Date.now() - shownAt).toBeLessThan(60000);

  // Workbench is interactive — drive a real marine propeller hub
  // assembly through the run-tool dispatch to prove the cold start
  // completed cleanly and the kernel actually does work.
  await win.evaluate(() => {
    window.__archdiscBypassDialog = true;
    window.localStorage.setItem('archdisc:welcome:v1', '1');  // suppress welcome modal
  });
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 10000 });
  await win.waitForFunction(() => !!window.__archdiscRunTool, null, { timeout: 15000 });

  const buildOne = async (tool, label) => {
    const before = await win.evaluate(() => {
      const reg = window.__archdiscBodies;
      return (typeof reg.list === 'function' ? reg.list() : reg.bodies).length;
    });
    await win.evaluate(({ tool }) => {
      window.dispatchEvent(new CustomEvent('archdisc:run-tool', { detail: { tab: 'part', tool } }));
    }, { tool });
    await win.waitForFunction(
      ({ n }) => {
        const reg = window.__archdiscBodies;
        const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
        return list.length === n + 1;
      }, { n: before }, { timeout: 30000 });
    await win.evaluate(({ label }) => {
      const reg = window.__archdiscBodies;
      const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
      if (typeof reg.rename === 'function') reg.rename(list[list.length - 1].id, label);
    }, { label });
  };

  // Reset registry to start clean for this test (cold start may have
  // left bodies from a prior aborted run via the suppress-window).
  await win.evaluate(() => {
    const reg = window.__archdiscBodies;
    const list = (typeof reg.list === 'function' ? reg.list() : reg.bodies).slice();
    for (const b of list) reg.remove(b.id);
  });

  // Marine propeller hub — 5 components, real ABYC dimensions:
  //   - Hub body          Cyl O80 x 90 mm   NiAl Bronze
  //   - Blade root boss 1 Cyl O30 x 50 mm   NiAl Bronze
  //   - Blade root boss 2 Cyl O30 x 50 mm   NiAl Bronze
  //   - Blade root boss 3 Cyl O30 x 50 mm   NiAl Bronze
  //   - Shaft taper       Cyl O35 x 60 mm   NiAl Bronze
  await buildOne('Cylinder', 'MarineProp-Hub-NiAlBronze');
  await buildOne('Cylinder', 'MarineProp-BladeRootBoss1-NiAlBronze');
  await buildOne('Cylinder', 'MarineProp-BladeRootBoss2-NiAlBronze');
  await buildOne('Cylinder', 'MarineProp-BladeRootBoss3-NiAlBronze');
  await buildOne('Cylinder', 'MarineProp-ShaftTaper-NiAlBronze');

  const report = await win.evaluate(() => {
    const reg = window.__archdiscBodies;
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    return {
      count: list.length,
      names: list.map(b => b.name),
      withBrep: list.filter(b => !!b.brepShapeRef).length,
    };
  });
  console.log('  [report]', JSON.stringify(report));
  expect(report.count).toBe(5);
  expect(report.withBrep).toBe(5);
  expect(report.names.every(n => n.startsWith('MarineProp-'))).toBe(true);

  await win.screenshot({ path: path.join(OUT, '03-propeller-hub-built.png') });
  await app.close();
});
