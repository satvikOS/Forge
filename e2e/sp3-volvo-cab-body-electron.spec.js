import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-3 — Volvo FH cab body (Video-21 parity reference, sub-project 3).
 *
 * Builds the cab BOX (side panels, rear panel, roof, floor, doors,
 * windshield, side windows, A/B pillars, air-deflector spoiler,
 * wheel-arch covers, marker lights, exhaust stacks) on top of the
 * SP-2 fascia. Empty viewport → fascia → cab box → final assembly,
 * entirely through Standards Library dialog clicks. No imports.
 *
 * Per the universal feedback_one_to_one_parity_loop bar — UI-only,
 * multi-angle adversarial review, side-dock dialog so the viewport
 * stays visible the entire time.
 */

const OUT_DIR = path.resolve(__dirname, 'screenshots', 'sp3-volvo-cab-body');
fs.mkdirSync(OUT_DIR, { recursive: true });

// Cab coordinate system: +X right, +Y up, +Z forward (away from cab
// rear toward the road in front). Fascia at z=0, cab extends in −Z to
// z=−2200 (cab depth 2.2 m).
const CAB = {
  width_mm: 2500,
  height_mm: 2400,
  depth_mm: 2200,
  // Vertical centre of the cab — origin sits at the floor-front
  // corner; positive Y rises through the cab height.
  floorY: -900,
  roofY:   1500,
  fasciaZ: 0,
  rearZ:  -2200,
};

test.describe.configure({ timeout: 30 * 60 * 1000 });

test('SP-3 — Volvo FH cab body built UI-only at Video-21 fidelity', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (err) => console.error('[pageerror]', err.message));
  win.on('console', (msg) => {
    if (msg.type() === 'error') console.log(`[renderer:error] ${msg.text()}`);
  });

  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscRegistry, null, { timeout: 60000 });
  await win.evaluate(() => { window.__archdiscBypassDialog = false; });

  const welcomeClose = win.locator('[data-archdisc-welcome-close="true"]').first();
  if (await welcomeClose.count() > 0) {
    await welcomeClose.dispatchEvent('click');
    await win.locator('[data-archdisc-welcome="open"]').waitFor({ state: 'hidden', timeout: 5000 });
  }

  const bodyCount = () =>
    win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);

  // ─── Helpers (mirror SP-2 e2e shape) ──────────────────────────────────
  const clickRibbonTab = async (tabKey) => {
    await win.locator(`[data-ribbon-tab-key="${tabKey}"]`).dispatchEvent('click');
    await win.waitForTimeout(80);
  };
  const clickRibbonTool = async (toolName) => {
    const btn = win.locator(`[data-ribbon-tool-name="${toolName}"]`).first();
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.dispatchEvent('click');
  };

  await win.evaluate(() => {
    if (typeof window.__archdiscFrameAll === 'function') window.__archdiscFrameAll();
    if (typeof window.__archdiscSetOrbitBase === 'function') window.__archdiscSetOrbitBase();
  });

  const captureAllAngles = async (label) => {
    await win.evaluate(() => {
      if (typeof window.__archdiscFrameAll === 'function') window.__archdiscFrameAll();
      if (typeof window.__archdiscSetOrbitBase === 'function') window.__archdiscSetOrbitBase();
    });
    await win.waitForTimeout(150);
    const angles = [
      { name: 'iso-front',  az:  35, el:  20, zoom: 1.0 },
      { name: 'iso-rear',   az: 145, el:  20, zoom: 1.0 },
      { name: 'side-right', az:  90, el:   8, zoom: 1.0 },
      { name: 'side-left',  az: -90, el:   8, zoom: 1.0 },
      { name: 'front',      az:   0, el:   0, zoom: 1.0 },
      { name: 'back',       az: 180, el:   0, zoom: 1.0 },
      { name: 'top-down',   az:   0, el:  85, zoom: 1.0 },
      { name: 'wide',       az:  35, el:  20, zoom: 1.8 },
      { name: 'driver-pov', az:  60, el:  -5, zoom: 0.5 },
    ];
    for (const a of angles) {
      await win.evaluate((cam) => window.__archdiscOrbitView?.(cam.az, cam.el, cam.zoom), a);
      await win.waitForTimeout(180);
      await win.screenshot({ path: path.join(OUT_DIR, `${label}-${a.name}.png`) });
    }
  };

  const openStandards = async (mode) => {
    await clickRibbonTool(mode === 'pattern' ? 'Pattern Standards' : 'Standards Library');
    await win.locator('[data-testid="standards-library-dialog"]').waitFor({ state: 'visible', timeout: 10000 });
    await win.waitForTimeout(180);
  };
  const stdSelectCategory = (cat) =>
    win.locator(`.standards-library-dialog .category-tree .cat button:text-is("${cat}")`).first().dispatchEvent('click');
  const stdSelectLeaf = (leafName) =>
    win.locator(`.standards-library-dialog .category-tree li button:text-is("${leafName}")`).first().dispatchEvent('click');
  const stdSetPosition = async (x, y, z) => {
    const rows = win.locator('.standards-library-dialog .position-row');
    const pos = rows.nth(0).locator('input');
    await pos.nth(0).fill(String(x));
    await pos.nth(1).fill(String(y));
    await pos.nth(2).fill(String(z));
  };
  const stdSetRotation = async (rx, ry, rz) => {
    const rows = win.locator('.standards-library-dialog .position-row');
    const rot = rows.nth(1).locator('input');
    await rot.nth(0).fill(String(rx));
    await rot.nth(1).fill(String(ry));
    await rot.nth(2).fill(String(rz));
  };
  const stdPlace = async () => {
    const before = await bodyCount();
    const clicked = await win.evaluate(() => {
      const btn = document.querySelector('[data-testid="sl-place-btn"]');
      if (!btn) return false;
      btn.click();
      return true;
    });
    if (!clicked) throw new Error('stdPlace: place button missing');
    await win.locator('[data-testid="standards-library-dialog"]').waitFor({ state: 'hidden', timeout: 120000 });
    await win.waitForFunction(
      ([prev]) => (window.__archdiscRegistry?.list?.() || []).length > prev,
      [before],
      { timeout: 120000 },
    );
    return (await bodyCount()) - before;
  };
  const place = async (leafName, x, y, z, rx = 0, ry = 0, rz = 0) => {
    await openStandards('single');
    await stdSelectCategory('Automotive');
    await stdSelectLeaf(leafName);
    await stdSetPosition(x, y, z);
    await stdSetRotation(rx, ry, rz);
    return stdPlace();
  };

  await captureAllAngles('00-empty');
  await clickRibbonTab('part');

  // ─── Phase 1: floor + roof slabs ──────────────────────────────────────
  // Floor placed at floorY, extends across X by width, Z by depth (-Z direction).
  await place('Cab Floor Panel', -CAB.width_mm / 2, CAB.floorY, -CAB.depth_mm);
  await place('Cab Roof Panel',  -CAB.width_mm / 2, CAB.roofY,  -CAB.depth_mm);
  await captureAllAngles('01-floor-roof');

  // ─── Phase 2: cab side panels (left + right) ──────────────────────────
  // Side panel built as flat rect (depth × height) extruded in +Z by
  // thickness. Mounted at x=-1250 (left) and +1240 (right) — slightly
  // inset from the floor edge.
  // Place with rotation 0,90,0 so the panel face is in YZ (normal=+X).
  await place('Cab Side Panel', -CAB.width_mm / 2,        CAB.floorY, -CAB.depth_mm,  0, 90, 0);
  await place('Cab Side Panel',  CAB.width_mm / 2 - 10,   CAB.floorY, -CAB.depth_mm,  0, 90, 0);
  await captureAllAngles('02-sides');

  // ─── Phase 3: rear panel ──────────────────────────────────────────────
  await place('Cab Rear Panel', -CAB.width_mm / 2, CAB.floorY, CAB.rearZ);
  await captureAllAngles('03-rear');

  // ─── Phase 4: windshield (front, angled slightly) ─────────────────────
  // Windshield slightly angled back for aero — rotation rx=-15° tilts
  // top backward. Placed at fascia front, just above the dome.
  await place('Windshield', -1150, 200, -50, -15, 0, 0);
  await captureAllAngles('04-windshield');

  // ─── Phase 5: side windows (driver + passenger) ───────────────────────
  await place('Side Window', -CAB.width_mm / 2 - 5, 200, -800, 0, 90, 0);
  await place('Side Window',  CAB.width_mm / 2 - 1, 200, -800, 0, 90, 0);

  // ─── Phase 6: cab doors (driver + passenger) ──────────────────────────
  await place('Cab Door', -CAB.width_mm / 2 - 60, -400, -1100, 0, 90, 0);
  await place('Cab Door',  CAB.width_mm / 2,      -400, -1100, 0, 90, 0);
  await captureAllAngles('06-doors');

  // ─── Phase 7: A-pillars (front corners) + B-pillars (mid) ─────────────
  await place('A Pillar', -CAB.width_mm / 2 + 60, -400,  -60);
  await place('A Pillar',  CAB.width_mm / 2 - 170, -400,  -60);
  await place('B Pillar', -CAB.width_mm / 2 + 60, -400, -1700);
  await place('B Pillar',  CAB.width_mm / 2 - 170, -400, -1700);
  await captureAllAngles('07-pillars');

  // ─── Phase 8: roof air-deflector ──────────────────────────────────────
  await place('Roof Air Deflector', -1200, CAB.roofY + 12, -1900);
  await captureAllAngles('08-air-deflector');

  // ─── Phase 9: roof marker lights (5 across the top of the windshield) ─
  await openStandards('pattern');
  await stdSelectCategory('Automotive');
  await stdSelectLeaf('Roof Marker Light');
  await stdSetPosition(-400, 1380, 100);
  await stdSetRotation(0, 0, 0);
  await win.locator('.standards-library-dialog select#sl-pattern').selectOption('linear');
  await win.locator('.standards-library-dialog input#sl-count').fill('5');
  await win.locator('.standards-library-dialog input#sl-dx').fill('200');
  await win.locator('.standards-library-dialog input#sl-dy').fill('0');
  const markersAdded = await stdPlace();
  expect(markersAdded).toBe(5);

  // ─── Phase 10: wheel-arch covers (4 — fender wells) ───────────────────
  // Curved half-pipes over the wheel positions.
  await place('Wheel Arch Cover', -1300, -900, -500,  0, 90, 0);
  await place('Wheel Arch Cover',  1300, -900, -500,  0, 90, 0);
  await place('Wheel Arch Cover', -1300, -900, -1800, 0, 90, 0);
  await place('Wheel Arch Cover',  1300, -900, -1800, 0, 90, 0);
  await captureAllAngles('10-wheel-arches');

  // ─── Phase 11: twin vertical exhaust stacks (Euro-truck style) ────────
  await place('Exhaust Stack', -1180, -200, -2150);
  await place('Exhaust Stack',  1180, -200, -2150);
  await captureAllAngles('11-exhaust-stacks');

  // ─── Phase 12: structural ISO 4014 bolts along the cab floor edge ─────
  // Re-uses Standards Library Fasteners catalog — proves cross-category
  // integration still works after the cab body is in.
  await openStandards('pattern');
  await stdSelectCategory('Fasteners');
  await stdSelectLeaf('Hex Bolt partial-thread (ISO 4014)');
  await win.locator('.standards-library-dialog select#sl-size').selectOption('M16');
  await win.locator('.standards-library-dialog input#sl-length').fill('45');
  await win.locator('.standards-library-dialog select#sl-grade').selectOption('10.9');
  await stdSetPosition(-1200, CAB.floorY - 20, -200);
  await stdSetRotation(0, 0, 0);
  await win.locator('.standards-library-dialog select#sl-pattern').selectOption('linear');
  await win.locator('.standards-library-dialog input#sl-count').fill('11');
  await win.locator('.standards-library-dialog input#sl-dx').fill('240');
  await win.locator('.standards-library-dialog input#sl-dy').fill('0');
  const cabBoltsAdded = await stdPlace();
  expect(cabBoltsAdded).toBe(11);

  // ─── Final ────────────────────────────────────────────────────────────
  const finalCount = await bodyCount();
  console.log(`SP-3 — final body count: ${finalCount}`);
  expect(finalCount).toBeGreaterThanOrEqual(25);

  await captureAllAngles('99-final');
  await app.close();
});
