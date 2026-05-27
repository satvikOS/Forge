/**
 * Workflow-31 — Body locking (prevent destructive ops on fixed bodies).
 *
 * A locked body stays visible, selectable, and measurable but the
 * standard destructive ops (Delete, Fillet, Pattern, Mirror) refuse
 * to run on it. Mini-Toolbar greys out those buttons and shows a
 * lock pill the user clicks to toggle the lock state.
 *
 * Real engineering need: when iterating on Component A, an engineer
 * locks Component B to be sure they don't accidentally edit it. Same
 * pattern SolidWorks and NX both ship.
 *
 * Coherent real-project test: builds a 4-body lathe-chuck assembly
 * (chuck body + 3 jaws). Locks the body, then verifies:
 *
 *   1. Mini-Toolbar shows the lock pill (🔒 emoji + .mt-btn-locked)
 *   2. Delete button is disabled when locked
 *   3. BodyRegistry.remove(id) returns false for locked bodies
 *   4. Unlocking re-enables Delete + permits remove()
 *
 *   1. Chuck body  Cyl Ø 200 × 60 mm   AISI 4140
 *   2. Jaw 1       Box  60 × 30 × 25 mm hardened tool steel
 *   3. Jaw 2       Box  60 × 30 × 25 mm hardened tool steel
 *   4. Jaw 3       Box  60 × 30 × 25 mm hardened tool steel
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf31-body-locking');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-31 — Lathe chuck: lock the body, Delete refuses, unlock restores', async () => {
  test.setTimeout(240000);
  fs.mkdirSync(OUT, { recursive: true });

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
  await win.evaluate(() => {
    window.__archdiscBypassDialog = true;
    window.localStorage.setItem('archdisc:welcome:v1', '1');
    window.localStorage.setItem('archdisc:splash:lastShownAt', String(Date.now()));
    const reg = window.__archdiscBodies;
    const list = (typeof reg.list === 'function' ? reg.list() : reg.bodies).slice();
    for (const b of list) reg.remove(b.id);
  });
  const welcome = win.locator('[data-archdisc-welcome="open"]');
  if (await welcome.isVisible().catch(() => false)) {
    await win.locator('[data-archdisc-welcome-close="true"]').click();
    await expect(welcome).toBeHidden({ timeout: 5000 });
  }

  // Build lathe chuck.
  const tags = [
    { tool: 'Cylinder', tag: 'LatheChuck-Body-4140' },
    { tool: 'Box',      tag: 'LatheChuck-Jaw1-ToolSteel' },
    { tool: 'Box',      tag: 'LatheChuck-Jaw2-ToolSteel' },
    { tool: 'Box',      tag: 'LatheChuck-Jaw3-ToolSteel' },
  ];
  const ids = [];
  for (const c of tags) {
    const before = await win.evaluate(() => {
      const reg = window.__archdiscBodies;
      return (typeof reg.list === 'function' ? reg.list() : reg.bodies).length;
    });
    await win.evaluate(({ tool }) => {
      window.dispatchEvent(new CustomEvent('archdisc:run-tool', { detail: { tab: 'part', tool } }));
    }, { tool: c.tool });
    await win.waitForFunction(
      ({ n }) => {
        const reg = window.__archdiscBodies;
        const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
        return list.length === n + 1;
      }, { n: before }, { timeout: 30000 });
    const id = await win.evaluate(({ tag }) => {
      const reg = window.__archdiscBodies;
      const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
      const last = list[list.length - 1];
      if (typeof reg.rename === 'function') reg.rename(last.id, tag);
      return last.id;
    }, { tag: c.tag });
    ids.push(id);
  }

  // ─── Lock the chuck body via registry API ──────────────────────────
  const chuckId = ids[0];
  const locked = await win.evaluate(({ id }) => window.__archdiscBodies.setLocked(id, true), { id: chuckId });
  expect(locked).toBe(true);

  const isLockedAfter = await win.evaluate(({ id }) => window.__archdiscBodies.isLocked(id), { id: chuckId });
  expect(isLockedAfter).toBe(true);

  // Select the chuck body so the Mini-Toolbar shows.
  await win.evaluate(({ id }) => window.__archdiscBodies.select(id, false), { id: chuckId });
  await win.waitForTimeout(160);

  const miniToolbar = win.locator('[data-archdisc-mini-toolbar="active"]');
  await expect(miniToolbar).toBeVisible({ timeout: 5000 });
  expect(await miniToolbar.getAttribute('data-archdisc-mini-toolbar-locked')).toBe('true');

  // Delete button on the mini-toolbar must be disabled.
  const deleteBtn = miniToolbar.locator('.mt-btn[data-mt-action="delete"]');
  expect(await deleteBtn.isDisabled()).toBe(true);

  // ─── BodyRegistry.remove(id) refuses to remove a locked body ───────
  const removeResult = await win.evaluate(({ id }) => window.__archdiscBodies.remove(id), { id: chuckId });
  expect(removeResult).toBe(false);
  const stillThere = await win.evaluate(({ id }) => {
    const reg = window.__archdiscBodies;
    const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
    return !!list.find(b => b.id === id);
  }, { id: chuckId });
  expect(stillThere).toBe(true);
  await win.screenshot({ path: path.join(OUT, '01-locked-chuck.png') });

  // ─── Click the lock pill on the mini-toolbar to unlock ─────────────
  await miniToolbar.locator('.mt-btn[data-mt-action="lock"]').click();
  await win.waitForTimeout(160);
  expect(await win.evaluate(({ id }) => window.__archdiscBodies.isLocked(id), { id: chuckId })).toBe(false);
  expect(await miniToolbar.getAttribute('data-archdisc-mini-toolbar-locked')).toBe('false');

  // Delete button now enabled.
  expect(await miniToolbar.locator('.mt-btn[data-mt-action="delete"]').isDisabled()).toBe(false);

  // remove() now succeeds.
  const removed = await win.evaluate(({ id }) => window.__archdiscBodies.remove(id), { id: chuckId });
  expect(removed).toBe(true);
  const after = await win.evaluate(() => {
    const reg = window.__archdiscBodies;
    return (typeof reg.list === 'function' ? reg.list() : reg.bodies).length;
  });
  expect(after).toBe(3);

  await win.screenshot({ path: path.join(OUT, '02-unlocked-and-deleted.png') });
  await app.close();
});
