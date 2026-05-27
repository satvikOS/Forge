/**
 * Workflow-32 — Body grouping foundation: subassembly folders.
 *
 * BodyRegistry gains a Map of groupId → {name, bodyIds} so bodies can
 * be organised into named subassemblies (real CAD pattern: SolidWorks
 * subassemblies / NX assemblies-of-assemblies / Fusion components).
 * Membership is exclusive: a body lives in at most one group at a time.
 *
 * Coherent real-project test: builds a 9-component centrifugal pump
 * (a real fluid-machinery assembly) and organises it into 3 named
 * subassemblies that mirror typical engineering drawings:
 *
 *   Impeller subassembly (3 bodies)
 *     1. Impeller eye        Cyl Ø 80 × 12 mm    Inconel 718
 *     2. Impeller hub        Cyl Ø 60 × 35 mm    Inconel 718
 *     3. Impeller vane stub  Box  40 × 8 × 20 mm  Inconel 718
 *   Casing subassembly (3 bodies)
 *     4. Volute casing       Cyl Ø 220 × 80 mm   ductile iron
 *     5. Suction flange      Box  140 × 140 × 18 mm
 *     6. Discharge flange    Box  140 × 140 × 18 mm
 *   Bearing-housing subassembly (3 bodies)
 *     7. Bearing housing     Cyl Ø 100 × 80 mm   cast steel
 *     8. Shaft               Cyl Ø 35 × 220 mm   AISI 4340
 *     9. Mechanical seal     Cyl Ø 40 × 15 mm    nitrile / steel
 *
 * Coherence checks:
 *   - createGroup returns a valid group id, group.bodyIds matches input
 *   - Every body in a group reports groupId via getGroupOf
 *   - addToGroup moves a body out of its prior group
 *   - removeFromGroup detaches the body, group still exists
 *   - removeGroup detaches all member bodies + removes the group
 *   - remove(bodyId) also detaches from group cleanly
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf32-body-groups');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-32 — Centrifugal pump: 9 bodies organised into 3 subassembly groups', async () => {
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

  // Build pump components.
  const spec = [
    // Impeller
    { tool: 'Cylinder', tag: 'Pump-ImpellerEye-Inconel' },
    { tool: 'Cylinder', tag: 'Pump-ImpellerHub-Inconel' },
    { tool: 'Box',      tag: 'Pump-ImpellerVaneStub-Inconel' },
    // Casing
    { tool: 'Cylinder', tag: 'Pump-VoluteCasing-DuctileIron' },
    { tool: 'Box',      tag: 'Pump-SuctionFlange-DuctileIron' },
    { tool: 'Box',      tag: 'Pump-DischargeFlange-DuctileIron' },
    // Bearing housing
    { tool: 'Cylinder', tag: 'Pump-BearingHousing-CastSteel' },
    { tool: 'Cylinder', tag: 'Pump-Shaft-4340' },
    { tool: 'Cylinder', tag: 'Pump-MechSeal-Nitrile' },
  ];
  const ids = [];
  for (const c of spec) {
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
  expect(ids.length).toBe(9);
  await win.screenshot({ path: path.join(OUT, '01-pump-built.png') });

  // ─── Create 3 subassembly groups ───────────────────────────────────
  const groupIds = await win.evaluate(({ ids }) => {
    const reg = window.__archdiscBodies;
    return {
      impeller: reg.createGroup('Impeller subassembly', [ids[0], ids[1], ids[2]]),
      casing: reg.createGroup('Casing subassembly', [ids[3], ids[4], ids[5]]),
      bearing: reg.createGroup('Bearing housing subassembly', [ids[6], ids[7], ids[8]]),
    };
  }, { ids });
  console.log('  [groups]', JSON.stringify(groupIds));
  expect(groupIds.impeller).toMatch(/^group-\d{3}$/);
  expect(groupIds.casing).toMatch(/^group-\d{3}$/);
  expect(groupIds.bearing).toMatch(/^group-\d{3}$/);

  // Snapshot getGroups + getGroupOf consistency.
  const groupsSnapshot = await win.evaluate(() => window.__archdiscBodies.getGroups());
  expect(groupsSnapshot.length).toBe(3);
  const byName = Object.fromEntries(groupsSnapshot.map(g => [g.name, g]));
  expect(byName['Impeller subassembly'].bodyIds.length).toBe(3);
  expect(byName['Casing subassembly'].bodyIds.length).toBe(3);
  expect(byName['Bearing housing subassembly'].bodyIds.length).toBe(3);

  // Every body reports its groupId via getGroupOf.
  for (let i = 0; i < 9; i++) {
    const g = await win.evaluate(({ id }) => window.__archdiscBodies.getGroupOf(id), { id: ids[i] });
    expect(g).not.toBeNull();
    if (i < 3) expect(g.name).toBe('Impeller subassembly');
    else if (i < 6) expect(g.name).toBe('Casing subassembly');
    else expect(g.name).toBe('Bearing housing subassembly');
  }

  // ─── Move the impeller-eye into the casing group ───────────────────
  const moved = await win.evaluate(({ groupId, bodyId }) => window.__archdiscBodies.addToGroup(groupId, bodyId), {
    groupId: groupIds.casing, bodyId: ids[0],
  });
  expect(moved).toBe(true);
  const afterMove = await win.evaluate(() => window.__archdiscBodies.getGroups());
  const afterByName = Object.fromEntries(afterMove.map(g => [g.name, g]));
  expect(afterByName['Impeller subassembly'].bodyIds.length).toBe(2);
  expect(afterByName['Casing subassembly'].bodyIds.length).toBe(4);
  expect(afterByName['Casing subassembly'].bodyIds.includes(ids[0])).toBe(true);

  // ─── Remove a body from its group (without deleting the body) ──────
  const detached = await win.evaluate(({ bodyId }) => window.__archdiscBodies.removeFromGroup(bodyId), {
    bodyId: ids[6],   // bearing housing
  });
  expect(detached).toBe(true);
  const ungrouped = await win.evaluate(({ id }) => window.__archdiscBodies.getGroupOf(id), { id: ids[6] });
  expect(ungrouped).toBeNull();
  const stillExists = await win.evaluate(({ id }) => {
    const reg = window.__archdiscBodies;
    return !!(typeof reg.list === 'function' ? reg.list() : reg.bodies).find(b => b.id === id);
  }, { id: ids[6] });
  expect(stillExists).toBe(true);

  // ─── Remove the casing group: 4 bodies become ungrouped ────────────
  await win.evaluate(({ groupId }) => window.__archdiscBodies.removeGroup(groupId), { groupId: groupIds.casing });
  const after = await win.evaluate(() => window.__archdiscBodies.getGroups());
  expect(after.length).toBe(2);
  expect(after.find(g => g.name === 'Casing subassembly')).toBeUndefined();
  // The 4 casing bodies are now ungrouped.
  for (const i of [0, 3, 4, 5]) {
    const g = await win.evaluate(({ id }) => window.__archdiscBodies.getGroupOf(id), { id: ids[i] });
    expect(g).toBeNull();
  }

  // ─── Delete a body that's still in a group: group bodyIds drops it ─
  await win.evaluate(({ id }) => window.__archdiscBodies.remove(id), { id: ids[1] });   // impeller hub
  const remaining = await win.evaluate(() => window.__archdiscBodies.getGroups());
  const impellerAfter = remaining.find(g => g.name === 'Impeller subassembly');
  expect(impellerAfter).not.toBeUndefined();
  expect(impellerAfter.bodyIds.includes(ids[1])).toBe(false);

  await win.screenshot({ path: path.join(OUT, '02-after-group-ops.png') });
  await app.close();
});
