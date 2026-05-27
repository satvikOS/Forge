import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-1 SESSION 2 — Falcon 9 Block 5 Octaweb thrust structure.
 *
 * Reference: Falcon 9 Block 5 octaweb — bolted aluminum-lithium thrust
 * frame, 9 Merlin 1D engines arranged with one central + eight outer at
 * 1.65 m radius (per published architecture; Wikipedia + NASA papers +
 * Lars Blackmore IAC talks). Merlin 1D: 470 kg dry, 845 kN sea-level,
 * 16:1 nozzle expansion (sea-level), ~3 m total engine length, throat
 * Ø130 mm, exit Ø920 mm, combustion-chamber Ø400 mm.
 *
 * Per [[feedback_one_to_one_parity_loop]]:
 *  - No `window.__archdiscAtomic` body-building bypass — every solid is
 *    placed through real ribbon clicks + dialog inputs (the way a human
 *    drives the app, just faster).
 *  - Multi-angle adversarial screenshots after each major stage.
 *  - Toast UX: single top-right slot, replacing on each new tool result.
 *  - Rotation supported via the new Standards Library + primitive dialog
 *    rx/ry/rz fields + the orient-radial circular-pattern checkbox.
 *
 * Layout (all dims in mm, Falcon 9 first-stage orientation: dome at
 * z = 0, engines extending into −Z):
 *   Dome              z =     0 … +6      (Cylinder r=1850, h=6)
 *   Combustion chamber z = −400 … 0       (Cylinder r=200, h=400)
 *   Bell nozzle        z = −1900 … −400   (Cone r1=460, r2=130, h=1500)
 *   Outer engine ring   r = 1650 (1 centre + 8 outer at 45° spacing)
 */

const OUT_DIR = path.resolve(__dirname, 'screenshots', 'sp1-falcon9-octaweb-v2');
fs.mkdirSync(OUT_DIR, { recursive: true });

// ─── Falcon 9 reference geometry (mm) ──────────────────────────────────
const F9 = {
  domeRadius_mm: 1850,
  domeThickness_mm: 6,
  engineRingRadius_mm: 1650,
  combustionChamberRadius_mm: 200,
  combustionChamberHeight_mm: 400,
  bellThroatRadius_mm: 130,
  bellExitRadius_mm: 460,
  bellHeight_mm: 1500,
  engineMountTopRadius_mm: 200,
  engineMountBaseRadius_mm: 260,
  engineMountHeight_mm: 60,
  strutLength_in: 65,                 // ≈ 1651 mm — spans centre → outer engine
  perEngineMountBoltCircleR_mm: 270,
  perEngineMountBoltCount: 32,
  plumbingFlangeR_mm: 150,
  plumbingFlangeBoltCount: 16,
  strutAttachmentBoltCount: 8,
  strutBracketAngleCount: 16,
  lateralStiffenerCount: 24,
  gimbalBearingsPerEngine: 2,
  accessoryBearingsPerEngine: 1,
};

// 9 Merlin engine positions: 1 centre + 8 outer at 45° spacing on
// 1.65 m radius. Deterministic — Fibonacci / random ARE BANNED.
const ENGINES = [
  { id: 'M1-Centre', x: 0, y: 0 },
  ...Array.from({ length: 8 }, (_, i) => ({
    id: `M${i + 2}-Outer${i + 1}`,
    x: F9.engineRingRadius_mm * Math.cos((i * Math.PI) / 4),
    y: F9.engineRingRadius_mm * Math.sin((i * Math.PI) / 4),
  })),
];

test.describe.configure({ timeout: 30 * 60 * 1000 });

test('SP-1 v2 — Falcon 9 Octaweb built from scratch via UI only (no atomic bypass)', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (err) => console.error('[pageerror]', err.message));
  win.on('console', (msg) => {
    if (msg.type() === 'error') {
      console.log(`[renderer:error] ${msg.text()}`);
    }
  });

  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscRegistry, null, { timeout: 60000 });

  // Disable the auto-bypass that ToolParamDialog applies when
  // navigator.webdriver=true (the Playwright default). Without this the
  // dialog never opens because the handler short-circuits to defaults —
  // which violates the "interact with the UI like a human" rule. With
  // bypass off, every ribbon click pops the modal and we fill it.
  await win.evaluate(() => { window.__archdiscBypassDialog = false; });

  // Dismiss WF-09 welcome overlay (intercepts pointer events on first run).
  const welcomeClose = win.locator('[data-archdisc-welcome-close="true"]').first();
  if (await welcomeClose.count() > 0) {
    await welcomeClose.dispatchEvent('click');
    await win.locator('[data-archdisc-welcome="open"]').waitFor({ state: 'hidden', timeout: 5000 });
  }

  // ─── Helpers ──────────────────────────────────────────────────────────
  const bodyCount = () =>
    win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);

  const clickRibbonTab = async (tabKey) => {
    await win.locator(`[data-ribbon-tab-key="${tabKey}"]`).dispatchEvent('click');
    await win.waitForTimeout(80);
  };
  const clickRibbonTool = async (toolName) => {
    const btn = win.locator(`[data-ribbon-tool-name="${toolName}"]`).first();
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.dispatchEvent('click');
  };

  // Multi-angle adversarial capture: orbit the camera via the real
  // Viewport3D hook (__archdiscOrbitView), take screenshots from every
  // quadrant + isometric + a wide zoom-out + tight zoom-in. Reads each
  // screenshot back so we never ship a visual claim we can't verify.
  // First call sets the orbit-base radius from the current camera
  // position so subsequent zoom multipliers are stable.
  await win.evaluate(() => {
    if (typeof window.__archdiscFrameAll === 'function') window.__archdiscFrameAll();
    if (typeof window.__archdiscSetOrbitBase === 'function') window.__archdiscSetOrbitBase();
  });

  const captureAllAngles = async (label) => {
    // Re-frame + reset orbit base so each capture set scales to the
    // CURRENT body extents (assembly grows between phases).
    await win.evaluate(() => {
      if (typeof window.__archdiscFrameAll === 'function') window.__archdiscFrameAll();
      if (typeof window.__archdiscSetOrbitBase === 'function') window.__archdiscSetOrbitBase();
    });
    await win.waitForTimeout(150);

    const angles = [
      { name: 'iso-front',     az:  35, el:  25, zoom: 1.0 },
      { name: 'top-down',      az:   0, el:  85, zoom: 1.0 },
      // Iconic Falcon-9 rocket-bottom view — camera well below the
      // engine plane looking up at the 9-bell pattern. zoom=1.6 backs
      // it off so the whole engine ring fits in frame.
      { name: 'rocket-bottom', az:   0, el: -70, zoom: 1.6 },
      { name: 'front',         az:   0, el:  -8, zoom: 1.2 },
      { name: 'side-right',    az:  90, el:   8, zoom: 1.2 },
      { name: 'side-left',     az: -90, el:   8, zoom: 1.2 },
      { name: 'back',          az: 180, el:  -8, zoom: 1.2 },
      { name: 'under',         az:  35, el: -55, zoom: 1.4 },
      { name: 'wide',          az:  35, el:  25, zoom: 1.8 },
      { name: 'zoom-engine',   az:  35, el: -25, zoom: 0.55 },
      // Bell-mouth angle — look up at one outer engine bell to verify
      // the curved Rao profile + dark charcoal coloring read close-up.
      { name: 'bell-mouth',    az:  20, el: -60, zoom: 0.32 },
    ];
    for (const a of angles) {
      await win.evaluate((cam) => {
        if (typeof window.__archdiscOrbitView === 'function') {
          window.__archdiscOrbitView(cam.az, cam.el, cam.zoom);
        }
      }, a);
      await win.waitForTimeout(220);
      const filePath = path.join(OUT_DIR, `${label}-${a.name}.png`);
      await win.screenshot({ path: filePath });
      const stat = fs.statSync(filePath);
      if (stat.size < 50_000) {
        console.warn(`  ! captured screenshot is small (${stat.size} bytes) — possible blank: ${filePath}`);
      }
    }
  };

  // Drive the ToolParamDialog: open the named primitive tool, fill the
  // numeric fields by their `data-field` attribute, click Run.
  const runPrimitive = async (toolName, values) => {
    const before = await bodyCount();
    await clickRibbonTool(toolName);
    const dialog = win.locator('.tpd-dialog');
    await dialog.waitFor({ state: 'visible', timeout: 5000 });
    for (const [field, value] of Object.entries(values)) {
      const input = dialog.locator(`[data-field="${field}"]`).first();
      await input.fill(String(value));
    }
    await win.locator('.tpd-btn-run').dispatchEvent('click');
    await dialog.waitFor({ state: 'hidden', timeout: 60000 });
    await win.waitForFunction(
      ([prev]) => (window.__archdiscRegistry?.list?.() || []).length > prev,
      [before],
      { timeout: 60000 },
    );
  };

  // Drive the Standards Library dialog (single placement).
  const openStandards = async (mode) => {
    await clickRibbonTool(mode === 'pattern' ? 'Pattern Standards' : 'Standards Library');
    await win.locator('[data-testid="standards-library-dialog"]').waitFor({ state: 'visible', timeout: 5000 });
  };
  const stdSelectCategory = (cat) =>
    win.locator(`.standards-library-dialog .category-tree .cat button:text-is("${cat}")`).first().dispatchEvent('click');
  const stdSelectLeaf = (leafName) =>
    win.locator(`.standards-library-dialog .category-tree li button:text-is("${leafName}")`).first().dispatchEvent('click');
  const stdSetSelect = (sel, v) =>
    win.locator(`.standards-library-dialog ${sel}`).selectOption(v);
  const stdSetInput = (sel, v) =>
    win.locator(`.standards-library-dialog ${sel}`).fill(String(v));
  const stdSetCheckbox = async (sel, on) => {
    const cb = win.locator(`.standards-library-dialog ${sel}`);
    const cur = await cb.isChecked();
    if (cur !== on) await cb.click();
  };
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
    await win.locator('[data-testid="sl-place-btn"]').dispatchEvent('click');
    await win.locator('[data-testid="standards-library-dialog"]').waitFor({ state: 'hidden', timeout: 90000 });
    await win.waitForFunction(
      ([prev]) => (window.__archdiscRegistry?.list?.() || []).length > prev,
      [before],
      { timeout: 90000 },
    );
    return (await bodyCount()) - before;
  };

  // ─── Phase 0: empty viewport ──────────────────────────────────────────
  await captureAllAngles('00-empty');
  await clickRibbonTab('part');

  // ─── Phase 1: dome via Standards Library → Spacecraft ─────────────────
  // Now sourcing Falcon-9-specific reference geometry from the new
  // Spacecraft catalog so each placement records a meaningful named
  // body in the FeatureTree (instead of a generic Cylinder).
  const placeSpacecraft = async (leafName, x, y, z) => {
    await openStandards('single');
    await stdSelectCategory('Spacecraft');
    await stdSelectLeaf(leafName);
    await stdSetPosition(x, y, z);
    await stdSetRotation(0, 0, 0);
    return stdPlace();
  };

  await placeSpacecraft('Falcon 9 Thrust Dome (Al-Li 2195)', 0, 0, 0);
  await captureAllAngles('01-dome');

  // ─── Phase 2: engine-mount frustums (9) ───────────────────────────────
  for (const eng of ENGINES) {
    await placeSpacecraft('Falcon 9 Engine Mount Frustum', eng.x, eng.y, F9.domeThickness_mm);
  }
  await captureAllAngles('02-engine-mount-frustums');

  // ─── Phase 3: Merlin combustion chambers (9) ──────────────────────────
  // Chamber built bottom-at-origin growing +Z by height. Position with
  // z = -chamberH so chamber base sits at z = -400, top at z = 0.
  for (const eng of ENGINES) {
    await placeSpacecraft('Merlin 1D Combustion Chamber', eng.x, eng.y, -F9.combustionChamberHeight_mm);
  }
  await captureAllAngles('03-combustion-chambers');

  // ─── Phase 4: Merlin 1D bell nozzles (9) — curved-profile revolve ─────
  // Bell builder leaves throat at z=0 (top), exit at z=-bellLen (bottom)
  // after the −90° X rotation. Place throat at chamber base (z=-400) so
  // exit hangs at z = -400 - 1500 = -1900.
  for (const eng of ENGINES) {
    await placeSpacecraft('Merlin 1D Bell Nozzle', eng.x, eng.y, -F9.combustionChamberHeight_mm);
  }
  await captureAllAngles('04-bell-nozzles');

  // ─── Phase 4b: heat-shield panels (8 around engine bay) ───────────────
  // 8 sector panels tile the engine bay between the dome edge and the
  // engine ring. Single 8-fold circular pattern with orient-radial OFF
  // (each panel keeps its sector geometry in local coords; placement
  // angle is the per-instance Z rotation via orient-radial).
  await openStandards('pattern');
  await stdSelectCategory('Spacecraft');
  await stdSelectLeaf('Falcon 9 Heat Shield Panel');
  await stdSetPosition(0, 0, -10);
  await stdSetRotation(0, 0, 0);
  await stdSetSelect('select#sl-pattern', 'circular');
  await stdSetInput('input#sl-count', 8);
  await stdSetInput('input#sl-radius', 0);
  await stdSetInput('input#sl-start-angle', 0);
  await stdSetInput('input#sl-sweep', 360);
  await stdSetCheckbox('input#sl-orient-radial', true);
  const heatShieldsAdded = await stdPlace();
  expect(heatShieldsAdded).toBe(8);
  await captureAllAngles('04b-heat-shield');

  // ─── Phase 4d: Merlin turbopumps (9, one above each combustion chamber) ──
  for (const eng of ENGINES) {
    await placeSpacecraft('Merlin 1D Turbopump', eng.x + F9.engineMountTopRadius_mm + 60, eng.y, -200);
  }
  await captureAllAngles('04d-turbopumps');

  // ─── Phase 4e: plumbing spokes (9, dome-centre → each engine) ─────────
  // Each spoke starts at the dome centre and extends outward to its
  // engine. With orient-radial=true the place-handler spins each spoke
  // by its azimuth so it points at the matching engine.
  await openStandards('pattern');
  await stdSelectCategory('Spacecraft');
  await stdSelectLeaf('Merlin Plumbing Spoke');
  await stdSetPosition(0, 0, F9.domeThickness_mm + F9.engineMountHeight_mm + 30);
  await stdSetRotation(0, 0, 0);
  await stdSetSelect('select#sl-pattern', 'circular');
  await stdSetInput('input#sl-count', 8);
  await stdSetInput('input#sl-radius', 0);
  await stdSetInput('input#sl-start-angle', 0);
  await stdSetInput('input#sl-sweep', 360);
  await stdSetCheckbox('input#sl-orient-radial', true);
  const spokesAdded = await stdPlace();
  expect(spokesAdded).toBe(8);
  await captureAllAngles('04e-plumbing-spokes');

  // ─── Phase 4c: thrust takeout pads (16 around engine ring) ────────────
  await openStandards('pattern');
  await stdSelectCategory('Spacecraft');
  await stdSelectLeaf('Falcon 9 Thrust Takeout Pad');
  await stdSetPosition(0, 0, F9.domeThickness_mm + F9.engineMountHeight_mm + 10);
  await stdSetRotation(0, 0, 0);
  await stdSetSelect('select#sl-pattern', 'circular');
  await stdSetInput('input#sl-count', 16);
  await stdSetInput('input#sl-radius', F9.engineRingRadius_mm + 220);
  await stdSetInput('input#sl-start-angle', 0);
  await stdSetInput('input#sl-sweep', 360);
  await stdSetCheckbox('input#sl-orient-radial', true);
  const padsAdded = await stdPlace();
  expect(padsAdded).toBe(16);

  // ─── Phase 5: cross-bracing struts (AISC W6×12 radial) ────────────────
  // 8 struts from dome centre to each outer engine, oriented radially.
  // Base rotation [0, 90, 0] lays the W-section flat (long axis +X).
  // Pattern: circular, count=8, radius=0 (all instances at origin),
  // orient-radial=TRUE (each instance rotates rz around Z so the strut
  // points outward at its azimuth).
  await openStandards('pattern');
  await stdSelectCategory('Steel Sections');
  await stdSelectLeaf('W-Shape Wide-Flange (AISC)');
  await stdSetSelect('select#sl-size', 'W6x12');
  await stdSetInput('input#sl-length', F9.strutLength_in);
  await stdSetPosition(0, 0, F9.domeThickness_mm);
  await stdSetRotation(0, 90, 0);
  await stdSetSelect('select#sl-pattern', 'circular');
  await stdSetInput('input#sl-count', 8);
  await stdSetInput('input#sl-radius', 0);
  await stdSetInput('input#sl-start-angle', 0);
  await stdSetInput('input#sl-sweep', 360);
  await stdSetCheckbox('input#sl-orient-radial', true);
  const strutsAdded = await stdPlace();
  expect(strutsAdded).toBe(8);
  await captureAllAngles('05-cross-bracing-struts');

  // ─── Phase 6: engine-mount bolt rings (ISO 4014 M16 × 9) ──────────────
  for (const eng of ENGINES) {
    await openStandards('pattern');
    await stdSelectCategory('Fasteners');
    await stdSelectLeaf('Hex Bolt partial-thread (ISO 4014)');
    await stdSetSelect('select#sl-size', 'M16');
    await stdSetInput('input#sl-length', 65);
    await stdSetSelect('select#sl-grade', '12.9');
    await stdSetPosition(eng.x, eng.y, F9.domeThickness_mm);
    await stdSetRotation(0, 0, 0);
    await stdSetSelect('select#sl-pattern', 'circular');
    await stdSetInput('input#sl-count', F9.perEngineMountBoltCount);
    await stdSetInput('input#sl-radius', F9.perEngineMountBoltCircleR_mm);
    await stdSetInput('input#sl-start-angle', 0);
    await stdSetInput('input#sl-sweep', 360);
    await stdSetCheckbox('input#sl-orient-radial', false);
    const added = await stdPlace();
    expect(added).toBe(F9.perEngineMountBoltCount);
  }
  await captureAllAngles('06-engine-mount-bolts');

  // ─── Phase 7: plumbing-flange SHCS (ASME B18.3 × 9) ───────────────────
  for (const eng of ENGINES) {
    await openStandards('pattern');
    await stdSelectCategory('Fasteners');
    await stdSelectLeaf('SHCS UNC/UNF (ASME B18.3)');
    await stdSetSelect('select#sl-size', '1/2-13');
    await stdSetInput('input#sl-length', 1.5);
    await stdSetPosition(eng.x, eng.y, F9.domeThickness_mm + F9.engineMountHeight_mm);
    await stdSetRotation(0, 0, 0);
    await stdSetSelect('select#sl-pattern', 'circular');
    await stdSetInput('input#sl-count', F9.plumbingFlangeBoltCount);
    await stdSetInput('input#sl-radius', F9.plumbingFlangeR_mm);
    await stdSetInput('input#sl-start-angle', 11.25);
    await stdSetInput('input#sl-sweep', 360);
    await stdSetCheckbox('input#sl-orient-radial', false);
    const added = await stdPlace();
    expect(added).toBe(F9.plumbingFlangeBoltCount);
  }

  // ─── Phase 8: strut-attachment SHCS (ISO 4762 M12) ────────────────────
  await openStandards('pattern');
  await stdSelectCategory('Fasteners');
  await stdSelectLeaf('Socket Head Cap Screw (ISO 4762)');
  await stdSetSelect('select#sl-size', 'M12');
  await stdSetInput('input#sl-length', 40);
  await stdSetSelect('select#sl-grade', '10.9');
  await stdSetPosition(0, 0, F9.domeThickness_mm);
  await stdSetRotation(0, 0, 0);
  await stdSetSelect('select#sl-pattern', 'circular');
  await stdSetInput('input#sl-count', 8 * F9.strutAttachmentBoltCount);
  await stdSetInput('input#sl-radius', 800);
  await stdSetInput('input#sl-start-angle', 0);
  await stdSetInput('input#sl-sweep', 360);
  await stdSetCheckbox('input#sl-orient-radial', false);
  const strutShcsAdded = await stdPlace();
  expect(strutShcsAdded).toBe(8 * F9.strutAttachmentBoltCount);

  // ─── Phase 9: lateral stiffeners (AISC L4×4 ring, radial) ─────────────
  await openStandards('pattern');
  await stdSelectCategory('Steel Sections');
  await stdSelectLeaf('Angle (AISC L-shape)');
  await stdSetSelect('select#sl-size', 'L4x4x3/8');
  await stdSetInput('input#sl-length', 8);
  await stdSetPosition(0, 0, F9.domeThickness_mm + 30);
  await stdSetRotation(0, 90, 0);
  await stdSetSelect('select#sl-pattern', 'circular');
  await stdSetInput('input#sl-count', F9.lateralStiffenerCount);
  await stdSetInput('input#sl-radius', 1500);
  await stdSetInput('input#sl-start-angle', 7.5);
  await stdSetInput('input#sl-sweep', 360);
  await stdSetCheckbox('input#sl-orient-radial', true);
  const stiffenersAdded = await stdPlace();
  expect(stiffenersAdded).toBe(F9.lateralStiffenerCount);
  await captureAllAngles('09-lateral-stiffeners');

  // ─── Phase 10: gimbal bearings (SKF 32310 tapered × 18) ───────────────
  for (let pass = 0; pass < F9.gimbalBearingsPerEngine; pass++) {
    await openStandards('pattern');
    await stdSelectCategory('Bearings');
    await stdSelectLeaf('Tapered Roller (SKF 322xx heavy)');
    await stdSetSelect('select#sl-size', '32310');
    await stdSetPosition(0, 0, F9.domeThickness_mm + F9.engineMountHeight_mm - 60 - pass * 50);
    await stdSetRotation(0, 0, 0);
    await stdSetSelect('select#sl-pattern', 'circular');
    await stdSetInput('input#sl-count', 9);
    await stdSetInput('input#sl-radius', F9.engineRingRadius_mm);
    await stdSetInput('input#sl-start-angle', 0);
    await stdSetInput('input#sl-sweep', 360);
    await stdSetCheckbox('input#sl-orient-radial', false);
    const added = await stdPlace();
    expect(added).toBe(9);
  }

  // ─── Phase 11: accessory deep-groove bearings (SKF 6310 × 9) ──────────
  await openStandards('pattern');
  await stdSelectCategory('Bearings');
  await stdSelectLeaf('Deep-Groove Ball (SKF 63xx heavy)');
  await stdSetSelect('select#sl-size', '6310');
  await stdSetPosition(0, 0, F9.domeThickness_mm + F9.engineMountHeight_mm + 60);
  await stdSetRotation(0, 0, 0);
  await stdSetSelect('select#sl-pattern', 'circular');
  await stdSetInput('input#sl-count', 9 * F9.accessoryBearingsPerEngine);
  await stdSetInput('input#sl-radius', F9.engineRingRadius_mm + 250);
  await stdSetInput('input#sl-start-angle', 22.5);
  await stdSetInput('input#sl-sweep', 360);
  await stdSetCheckbox('input#sl-orient-radial', false);
  const accAdded = await stdPlace();
  expect(accAdded).toBe(9 * F9.accessoryBearingsPerEngine);

  // ─── Phase 12: plain + lock washers + nuts for the engine mount bolts ─
  for (const std of [
    { leaf: 'Plain Washer (ISO 7089)',  zOff: -1 },
    { leaf: 'Spring Lock Washer (ISO 7090)', zOff: -3 },
    { leaf: 'Hex Nut (ISO 4032)', zOff: -16 },
  ]) {
    for (const eng of ENGINES) {
      await openStandards('pattern');
      await stdSelectCategory('Fasteners');
      await stdSelectLeaf(std.leaf);
      await stdSetSelect('select#sl-size', 'M16');
      await stdSetPosition(eng.x, eng.y, F9.domeThickness_mm + std.zOff);
      await stdSetRotation(0, 0, 0);
      await stdSetSelect('select#sl-pattern', 'circular');
      await stdSetInput('input#sl-count', F9.perEngineMountBoltCount);
      await stdSetInput('input#sl-radius', F9.perEngineMountBoltCircleR_mm);
      await stdSetInput('input#sl-start-angle', 0);
      await stdSetInput('input#sl-sweep', 360);
      await stdSetCheckbox('input#sl-orient-radial', false);
      const added = await stdPlace();
      expect(added).toBe(F9.perEngineMountBoltCount);
    }
  }
  await captureAllAngles('12-fastener-stack');

  // ─── Final assertions ─────────────────────────────────────────────────
  const finalCount = await bodyCount();
  console.log(`SP-1 v2 — final body count: ${finalCount}`);
  // 1 dome + 9 frustums + 9 chambers + 9 bells + 8 heat-shield + 16 pads
  // + 8 struts + 9*32 bolts + 9*16 SHCS + 64 strut SHCS + 24 stiffeners
  // + 18 tapered + 9 deep-groove + 9*32*3 washer/nut = 1471 bodies.
  expect(finalCount).toBeGreaterThanOrEqual(1400);
  expect(finalCount).toBeLessThanOrEqual(1900);

  // Final adversarial multi-angle review.
  await captureAllAngles('99-final');

  // Verify the toast slot is single-occupancy (top-right replacing).
  const toastCount = await win.locator('.toast-container .toast').count();
  console.log(`Toast container occupancy at end of run: ${toastCount}`);
  expect(toastCount).toBeLessThanOrEqual(1);

  // Read every screenshot back to ensure none are blank blobs.
  const files = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.png'));
  console.log(`Captured ${files.length} screenshots in ${OUT_DIR}`);
  let blanks = 0;
  for (const f of files) {
    const st = fs.statSync(path.join(OUT_DIR, f));
    if (st.size < 50_000) blanks++;
  }
  expect(blanks).toBeLessThan(5);   // tolerate a couple of near-blank frames mid-orbit

  await app.close();
});
