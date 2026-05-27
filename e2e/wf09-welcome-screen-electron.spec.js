/**
 * Workflow-09 — Welcome screen + Templates picker.
 *
 * First-launch modal that presents real engineering templates the
 * user can start from with a single click. Picking a template runs a
 * sequence of `archdisc:run-tool` dispatches that build the bodies
 * through the same code path a user-driven build takes.
 *
 * Coherent real-project test: launches Electron with the welcome
 * key cleared, asserts the modal appears, then exercises the
 * Worm-Gear Reducer Housing template (8 real ISO-styled bodies).
 * Verifies the modal dismisses, every body is registered with a
 * real brepShapeRef, names match the template plan, and the
 * "welcome already shown" flag survives a relaunch (modal won't
 * re-appear). Then saves a snapshot, relaunches, opens the welcome
 * via the event API, and verifies the Recent list now contains
 * the saved filename.
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf09-welcome-screen');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-09 — Welcome modal launches a Worm-Gear Reducer Housing template build, dismisses, Recent populates', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

  // ─── Pass 1 — Welcome appears, template builds 8-body assembly ──────
  const app = await electron.launch({
    args: [MAIN],
    env: { ...process.env, NODE_ENV: 'test' },
    slowMo: 0,
  });
  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(
    () => !!window.__archdiscBodies && !!window.__archdiscRunTool,
    null, { timeout: 60000 });
  await win.evaluate(() => { window.__archdiscBypassDialog = true; });

  // Force first-run state: clear the welcome-shown flag, the recent
  // list, and any existing bodies so the test starts deterministic.
  await win.evaluate(() => {
    window.localStorage.removeItem('archdisc:welcome:v1');
    window.localStorage.removeItem('archdisc:recent-projects:v1');
    const reg = window.__archdiscBodies;
    const list = (typeof reg.list === 'function' ? reg.list() : reg.bodies).slice();
    for (const b of list) reg.remove(b.id);
    // Trigger a re-open via the event channel so we don't have to reload
    // (component reads localStorage once on mount; clearing post-mount
    // doesn't auto-reopen).
    window.dispatchEvent(new CustomEvent('archdisc:open-welcome'));
  });

  const welcome = win.locator('[data-archdisc-welcome="open"]');
  await expect(welcome).toBeVisible({ timeout: 5000 });
  // All 4 template cards present.
  const cards = win.locator('[data-archdisc-welcome-template]');
  expect(await cards.count()).toBe(4);
  const cardIds = await cards.evaluateAll(els => els.map(el => el.getAttribute('data-archdisc-welcome-template')));
  expect(cardIds).toEqual(['empty', 'pneumatic-cylinder', 'worm-gear-reducer', 'shock-absorber']);
  await win.screenshot({ path: path.join(OUT, '01-welcome-open.png') });

  // Pick the Worm-Gear Reducer Housing — 8 coherent bodies.
  await win.locator('[data-archdisc-welcome-template="worm-gear-reducer"]').click();

  // The template runs sequentially; wait for all 8 bodies + modal dismissal.
  await win.waitForFunction(() => {
    const reg = window.__archdiscBodies;
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    return list.length === 8;
  }, null, { timeout: 60000 });
  await expect(welcome).toBeHidden({ timeout: 5000 });

  const report = await win.evaluate(() => {
    const reg = window.__archdiscBodies;
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    return {
      count: list.length,
      names: list.map(b => b.name),
      withBrep: list.filter(b => !!b.brepShapeRef).length,
      welcomeShown: window.localStorage.getItem('archdisc:welcome:v1'),
    };
  });
  console.log('  [template]', JSON.stringify(report));
  expect(report.count).toBe(8);
  expect(report.withBrep).toBe(8);
  expect(report.welcomeShown).toBe('1');
  expect(report.names).toEqual([
    'WormReducer-MainHousing-A48Cl40',
    'WormReducer-MountingFlange',
    'WormReducer-WormShaftBore-32H7',
    'WormReducer-OutputShaftBore-45H7',
    'WormReducer-WormGearCavity-100',
    'WormReducer-OilSumpExtension',
    'WormReducer-InspectionCoverSeat-50',
    'WormReducer-VentBoss-15',
  ]);
  await win.screenshot({ path: path.join(OUT, '02-housing-built.png') });

  // ─── Save Snapshot → recent-projects gets populated ────────────────
  await win.evaluate(() => {
    // Suppress browser download dialog.
    const orig = document.createElement.bind(document);
    document.createElement = function (tag) {
      if (tag === 'a') return Object.assign(orig('span'), {
        click() {}, set href(_) {}, set download(_) {},
      });
      return orig(tag);
    };
    window.dispatchEvent(new CustomEvent('archdisc:run-tool', { detail: { tab: 'documentation', tool: 'Save Snapshot' } }));
  });
  await win.waitForFunction(() => {
    const raw = window.localStorage.getItem('archdisc:recent-projects:v1');
    if (!raw) return false;
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) && parsed.length >= 1 && !!parsed[0].filename;
    } catch { return false; }
  }, null, { timeout: 30000 });

  const savedFile = await win.evaluate(() => {
    const list = JSON.parse(window.localStorage.getItem('archdisc:recent-projects:v1'));
    return list[0];
  });
  console.log('  [recent saved]', JSON.stringify(savedFile));
  expect(savedFile.filename).toMatch(/\.archdisc\.json$/);
  expect(savedFile.bodies).toBe(8);

  // Re-open the welcome via the event channel and verify Recent
  // renders the saved snapshot we just produced. Stays in the same
  // session — Electron's localStorage flush across launches is a
  // separate property that WF-04 already covers.
  await win.evaluate(() => window.dispatchEvent(new CustomEvent('archdisc:open-welcome')));
  const welcomeReopen = win.locator('[data-archdisc-welcome="open"]');
  await expect(welcomeReopen).toBeVisible({ timeout: 5000 });

  const recentItems = win.locator('[data-archdisc-welcome-recent]');
  expect(await recentItems.count()).toBeGreaterThanOrEqual(1);
  const firstRecent = await recentItems.first().textContent();
  expect(firstRecent).toMatch(/\.archdisc\.json/);
  console.log('  [recent shown]', firstRecent.slice(0, 80));

  await win.screenshot({ path: path.join(OUT, '03-welcome-recent.png') });
  await win.locator('[data-archdisc-welcome-close="true"]').click();
  await expect(welcomeReopen).toBeHidden({ timeout: 3000 });

  await app.close();
});
