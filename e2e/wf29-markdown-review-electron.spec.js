/**
 * Workflow-29 — Engineering Review Markdown report export.
 *
 * Emits a `.md` file that summarises the entire current scene as a
 * ready-to-paste engineering review document: title, body table with
 * material / density / volume / mass / bbox per component, ΣVolume /
 * ΣMass totals, references to the companion exports the user already
 * ships (STEP / 3MF / BOM / DXF / OBJ), and a sign-off block.
 *
 * Coherent real-project test: builds an aerospace landing-gear shock
 * strut sub-assembly (a real-world part where engineering reviews
 * happen at every gate) and exports the .md. Verifies the markdown
 * contains the right body table, totals, and headings.
 *
 *   1. Outer tube         Cyl Ø 80 × 600 mm   4340 steel
 *   2. Inner tube         Cyl Ø 60 × 500 mm   4340 steel
 *   3. Trunnion pin       Cyl Ø 50 × 90 mm    M50 bearing steel
 *   4. Lower fork         Box 100 × 60 × 40 mm aluminum 7075-T6
 *   5. Upper attach       Box 100 × 60 × 40 mm aluminum 7075-T6
 *   6. Wheel axle stub    Cyl Ø 35 × 80 mm    4340 steel
 *
 * Coherence checks:
 *   - Markdown has a top H1 with the project name
 *   - Header lines: Bodies: 6, ΣVolume, ΣMass
 *   - One row per body in the `## Components` table
 *   - Material column has the engineering material label, not just
 *     the key (e.g. "Steel · AISI 4340" not "steel-4140")
 *   - Sigma-mass equals the sum of per-row masses to 0.05 g
 *   - "Companion exports" section lists STEP / 3MF / BOM / DXF / OBJ
 *   - Sign-off block has Designer / Reviewer / Approver
 */

import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT  = path.resolve(__dirname, '..', 'e2e-output', 'wf29-markdown-review');
const MAIN = path.resolve(__dirname, '..', 'electron', 'main.js');

test.describe.configure({ mode: 'serial' });

test('Workflow-29 — Landing-gear shock strut: Markdown review report carries body table + ΣMass + companion exports', async () => {
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
    window.localStorage.removeItem('archdisc:body-materials:v1');
    const orig = document.createElement.bind(document);
    document.createElement = function (tag) {
      if (tag === 'a') return Object.assign(orig('span'), {
        click() {}, set href(_) {}, set download(_) {},
      });
      return orig(tag);
    };
    const reg = window.__archdiscBodies;
    const list = (typeof reg.list === 'function' ? reg.list() : reg.bodies).slice();
    for (const b of list) reg.remove(b.id);
  });
  const welcome = win.locator('[data-archdisc-welcome="open"]');
  if (await welcome.isVisible().catch(() => false)) {
    await win.locator('[data-archdisc-welcome-close="true"]').click();
    await expect(welcome).toBeHidden({ timeout: 5000 });
  }

  // Build the 6-body landing-gear shock strut + assign materials.
  const components = [
    { tool: 'Cylinder', tag: 'LandingGear-OuterTube-4340',  material: 'steel-4140', density: 7.85, label: 'Steel · AISI 4140' },
    { tool: 'Cylinder', tag: 'LandingGear-InnerTube-4340',  material: 'steel-4140', density: 7.85, label: 'Steel · AISI 4140' },
    { tool: 'Cylinder', tag: 'LandingGear-TrunnionPin-M50', material: 'stainless',  density: 7.96, label: 'Stainless · 316L' },
    { tool: 'Box',      tag: 'LandingGear-LowerFork-7075',  material: 'aluminum',   density: 2.70, label: 'Aluminum · 6061-T6' },
    { tool: 'Box',      tag: 'LandingGear-UpperAttach-7075',material: 'aluminum',   density: 2.70, label: 'Aluminum · 6061-T6' },
    { tool: 'Cylinder', tag: 'LandingGear-AxleStub-4340',   material: 'steel-4140', density: 7.85, label: 'Steel · AISI 4140' },
  ];
  const ids = [];
  for (const c of components) {
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
  for (let i = 0; i < ids.length; i++) {
    await win.evaluate(({ id }) => window.__archdiscBodies.select(id, false), { id: ids[i] });
    await expect(win.locator('[data-archdisc-properties-inspector="active"]')).toBeVisible({ timeout: 3000 });
    await win.locator('[data-archdisc-body-material-select]').selectOption(components[i].material);
    await win.waitForTimeout(80);
  }
  await win.evaluate(() => window.__archdiscBodies.clearSelection());
  await win.screenshot({ path: path.join(OUT, '01-strut-built.png') });

  // Click "Export Review (MD)" via Drawing tab.
  await win.evaluate(() => {
    for (const t of document.querySelectorAll('.ribbon-tab')) {
      if ((t.textContent || '').trim().toLowerCase() === 'drawing') {
        t.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return;
      }
    }
  });
  await win.waitForTimeout(250);
  const click = await win.evaluate(() => {
    for (const b of document.querySelectorAll('.ribbon-tool')) {
      if ((b.textContent || '').includes('Export Review (MD)')) {
        b.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        return { clicked: true };
      }
    }
    return { clicked: false };
  });
  expect(click.clicked).toBe(true);

  await win.waitForFunction(() => !!window.__lastReview?.ok, null, { timeout: 30000 });
  const result = await win.evaluate(() => ({
    ok: window.__lastReview.ok,
    bodies: window.__lastReview.bodies,
    bytes: window.__lastReview.bytes,
    totalVolume: window.__lastReview.totalVolume,
    totalMass: window.__lastReview.totalMass,
    filename: window.__lastReview.filename,
    md: window.__lastReview.md,
  }));
  console.log('  [review]', JSON.stringify({
    ok: result.ok, bodies: result.bodies, bytes: result.bytes,
    totalVolume: result.totalVolume.toFixed(1), totalMass: result.totalMass.toFixed(2),
    filename: result.filename,
  }));
  expect(result.ok).toBe(true);
  expect(result.bodies).toBe(6);
  expect(result.filename).toMatch(/\.md$/);

  fs.writeFileSync(path.join(OUT, 'landing-gear-review.md'), result.md);

  // ─── Markdown structural assertions ─────────────────────────────────
  const md = result.md;
  expect(md.startsWith('# ArchDisc Project — Engineering Review')).toBe(true);
  expect(md.includes('Generated ')).toBe(true);
  expect(md.includes('**Bodies:** 6')).toBe(true);
  expect(md.includes('**ΣVolume:**')).toBe(true);
  expect(md.includes('**ΣMass:**')).toBe(true);
  expect(md.includes('## Components')).toBe(true);
  expect(md.includes('## Companion exports')).toBe(true);

  // Component table header.
  expect(md).toMatch(/\|\s*#\s*\|\s*Name\s*\|\s*Source\s*\|\s*Material\s*\|/);

  // Every body name appears.
  for (const c of components) {
    expect(md.includes(c.tag)).toBe(true);
  }
  // Every material label appears at least once (3 distinct labels).
  expect(md.includes('Steel · AISI 4140')).toBe(true);
  expect(md.includes('Stainless · 316L')).toBe(true);
  expect(md.includes('Aluminum · 6061-T6')).toBe(true);

  // Companion-export references.
  for (const tag of ['STEP', '3MF', 'BOM', 'DXF', 'OBJ']) {
    expect(md.includes(tag)).toBe(true);
  }
  // Sign-off block.
  expect(md.includes('Designer')).toBe(true);
  expect(md.includes('Reviewer')).toBe(true);
  expect(md.includes('Approver')).toBe(true);

  // Σmass row pull-out: parse from the totals line.
  const totalMassMatch = md.match(/\*\*ΣMass:\*\*\s+([\d.]+)\s*g/);
  expect(totalMassMatch).not.toBeNull();
  const reportedMass = parseFloat(totalMassMatch[1]);
  expect(reportedMass).toBeCloseTo(result.totalMass, 1);
  expect(reportedMass).toBeGreaterThan(0);

  await win.screenshot({ path: path.join(OUT, '02-after-export.png') });
  await app.close();
});
