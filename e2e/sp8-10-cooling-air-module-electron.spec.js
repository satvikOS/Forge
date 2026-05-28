import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-8 / SP-9 / SP-10 — three new Sculpt-ribbon tools proven on a
 * coherent Volvo FH "Cooling & Air-Management Module", built ENTIRELY
 * through the ribbon (real ToolParamDialog interactions, no catalog
 * recipe, no `__archdiscAtomic` bypass, no baked dim):
 *
 *   SP-8  Sculpt Loft  — Class-A frustum (lofted between 2 circles):
 *                        fan shroud, chrome exhaust stack, intake snorkel
 *   SP-9  Sculpt Perforated Panel — grid of holes through a plate:
 *                        radiator core + charge-air-cooler core
 *   SP-10 Sculpt Pipe   — circle swept along a 3-point path:
 *                        2 charge-air pipes + 2 coolant hoses
 *
 * Composed with the existing Sculpt Rectangle→Extrude→Place (box) and
 * Sculpt Circle→Extrude→Place (cylinder) primitives for the radiator
 * frame, fan hub and 9 index-placed fan blades. Every dimension is
 * typed into a dialog the way a human would, 1000× faster.
 *
 * Per [[feedback_no_hardcoded_catalog_dims]] + [[feedback_omni_coherence_law]]
 * + [[feedback_bespoke_e2e_tests]] + [[feedback_perfectly_viewable_framing]].
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp8-10-cooling-air-module');
fs.mkdirSync(OUT, { recursive: true });

// Module coordinate system (mm): X side-to-side, Y up, Z front(0)→rear(−).
const M = {
  coreY: 1550, coreZ: -250,        // radiator core centre
  fanZ: -500,                      // fan plane (behind radiator)
  hubR: 160, tipR: 540, blades: 9, // cooling fan
};

test.describe.configure({ timeout: 30 * 60 * 1000 });

test('SP-8/9/10 — Volvo FH cooling & air module sculpted via Loft / Pipe / Perforated', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.error('[pageerror]', e.message));

  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscRegistry, null, { timeout: 60000 });
  // Drive the REAL dialogs — disable the navigator.webdriver auto-bypass.
  await win.evaluate(() => { window.__archdiscBypassDialog = false; });

  const wc = win.locator('[data-archdisc-welcome-close="true"]').first();
  if (await wc.count() > 0) {
    await wc.dispatchEvent('click');
    await win.locator('[data-archdisc-welcome="open"]').waitFor({ state: 'hidden', timeout: 5000 });
  }
  await win.locator('[data-ribbon-tab-key="part"]').dispatchEvent('click');

  const bodyCount = () => win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);

  // Run a Sculpt ribbon tool, fill its ToolParamDialog, Run, wait for hide.
  const runTool = async (toolName, fields) => {
    await win.locator(`[data-ribbon-tool-name="${toolName}"]`).first().dispatchEvent('click');
    const dlg = win.locator('.tpd-dialog');
    await dlg.waitFor({ state: 'visible', timeout: 8000 });
    await win.waitForTimeout(100);
    for (const [name, val] of Object.entries(fields)) {
      const inp = dlg.locator(`[data-field="${name}"]`).first();
      if (await inp.count() === 0) continue;
      const tag = await inp.evaluate((el) => el.tagName.toLowerCase());
      if (tag === 'select') await inp.selectOption(String(val));
      else await inp.fill(String(val));
    }
    await win.locator('.tpd-btn-run').dispatchEvent('click');
    await dlg.waitFor({ state: 'hidden', timeout: 90000 });
    await win.waitForTimeout(100);
  };
  // Each tool below adds exactly one body — wait for the registry to grow.
  const addsOneBody = async (fn) => {
    const before = await bodyCount();
    await fn();
    await win.waitForFunction(([p]) => (window.__archdiscRegistry?.list?.() || []).length > p, [before], { timeout: 90000 });
  };

  // ─── primitives (compose Sculpt Rectangle/Circle → Extrude → Place) ──
  const sculptBox = async ({ w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Rectangle', { cx: 0, cy: 0, w, h, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: d });
      await runTool('Sculpt Place Body', { rx, ry, rz, x, y, z, color });
    });
  const sculptCylinder = async ({ r, d, x, y, z, rx = 0, ry = 0, rz = 0, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Circle', { cx: 0, cy: 0, r, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: d });
      await runTool('Sculpt Place Body', { rx, ry, rz, x, y, z, color });
    });
  // ─── the three NEW single-dialog tools ──────────────────────────────
  const sculptLoft = async (f) => addsOneBody(() => runTool('Sculpt Loft', f));
  const sculptPipe = async (f) => addsOneBody(() => runTool('Sculpt Pipe', f));
  const sculptPerforated = async (f) => addsOneBody(() => runTool('Sculpt Perforated Panel', f));

  // ─── adversarial multi-angle capture (whole module, well-framed) ─────
  const tgt = { x: 0, y: 1.58, z: -0.42 };
  const captureAngles = async (label) => {
    // A big opaque radiator dominates the front, so the hero shot looks
    // from behind-above to reveal the fan / shroud / swept pipes / stacks
    // (the SP-8 + SP-10 components). Front view is the SP-9 grille hero.
    const angles = [
      { name: 'rear3q', az: 148, el: 22, dist: 5.2 },
      { name: 'front',  az:   0, el:  6, dist: 4.7 },
      { name: 'right',  az:  90, el:  8, dist: 5.2 },
      { name: 'left',   az: -90, el:  8, dist: 5.2 },
      { name: 'top',    az:  20, el: 56, dist: 5.8 },
    ];
    for (const a of angles) {
      await win.evaluate(({ az, el, dist, tx, ty, tz }) => {
        const vp = window.__archdiscViewport;
        if (!vp?.camera) return;
        const azR = az * Math.PI / 180, elR = el * Math.PI / 180;
        vp.camera.position.set(
          tx + dist * Math.cos(elR) * Math.sin(azR),
          ty + dist * Math.sin(elR),
          tz + dist * Math.cos(elR) * Math.cos(azR));
        vp.orbitControls.target.set(tx, ty, tz);
        vp.camera.lookAt(tx, ty, tz);
        vp.orbitControls.update();
        vp.renderer.render(vp.scene, vp.camera);
      }, { ...a, tx: tgt.x, ty: tgt.y, tz: tgt.z });
      await win.waitForTimeout(150);
      await win.screenshot({ path: path.join(OUT, `${label}-${a.name}.png`) });
    }
  };

  await captureAngles('00-empty');

  // ─── SP-9 — radiator core (perforated grille) ───────────────────────
  await sculptPerforated({ w: 1850, h: 1350, t: 45, holeR: 15, cols: 30, rows: 22, spacing: 58,
    x: 0, y: M.coreY, z: M.coreZ, color: 0x2b2f34 });
  // radiator frame — 4 rails boxing the core (coherent: enclose ±925 × ±675)
  await sculptBox({ w: 1980, h: 90, d: 130, x: 0,     y: 2275, z: -235, color: 0x33373c }); // top
  await sculptBox({ w: 1980, h: 90, d: 130, x: 0,     y: 825,  z: -235, color: 0x33373c }); // bottom
  await sculptBox({ w: 90, h: 1540, d: 130, x: -975, y: M.coreY, z: -235, color: 0x33373c }); // left
  await sculptBox({ w: 90, h: 1540, d: 130, x: 975,  y: M.coreY, z: -235, color: 0x33373c }); // right
  await captureAngles('01-radiator');

  // ─── SP-8 — fan shroud (Class-A loft: wide at radiator → necks to fan)
  // loft builds along +Z (0..height); placed front face (z=height) toward
  // the radiator. r1=rear ring (smaller), r2=front ring (wider).
  await sculptLoft({ r1: 520, r2: 640, height: 420, x: 0, y: M.coreY, z: -750, color: 0x3c424a });
  // fan hub (cylinder, axis along Z = facing forward) at the fan plane
  await sculptCylinder({ r: M.hubR, d: 180, x: 0, y: M.coreY, z: M.fanZ - 90, color: 0x5a5f66 });
  // 9 fan blades, index-placed around the hub (NO randomness — θ = i·40°).
  // Blade sketched along X centred at origin, rotated rz=θ to point
  // radially, then translated to the rim mid-radius point.
  const Rmid = (M.hubR + M.tipR) / 2, L = M.tipR - M.hubR;
  for (let i = 0; i < M.blades; i++) {
    const deg = i * (360 / M.blades);
    const th = deg * Math.PI / 180;
    await sculptBox({ w: L, h: 200, d: 28,
      x: Rmid * Math.cos(th), y: M.coreY + Rmid * Math.sin(th), z: M.fanZ,
      rz: deg, color: 0x515861 });
  }
  await captureAngles('02-fan-shroud');

  // ─── SP-9 #2 — charge-air-cooler core (perforated, DIFFERENT dims) ───
  // proves the tool is parametric, not a baked single-size stamp.
  await sculptPerforated({ w: 1500, h: 460, t: 70, holeR: 9, cols: 38, rows: 8, spacing: 38,
    x: 0, y: 2420, z: -120, color: 0x5f666b });
  await captureAngles('03-intercooler');

  // ─── SP-10 — charge-air pipes + coolant hoses (swept tubes) ──────────
  // Hot-side charge pipe: turbo (lower-right) → intercooler right inlet.
  await sculptPipe({ radius: 75, x1: 650, y1: 950, z1: -820, x2: 700, y2: 2380, z2: -180, bend: 340, color: 0x7d848a });
  // Cold-side charge pipe: intercooler left outlet → engine left.
  await sculptPipe({ radius: 75, x1: -700, y1: 2380, z1: -180, x2: -650, y2: 1050, z2: -820, bend: -340, color: 0x7d848a });
  // Upper coolant hose: radiator top-left → engine (dark rubber).
  await sculptPipe({ radius: 48, x1: -480, y1: 2150, z1: -240, x2: -300, y2: 1500, z2: -900, bend: -180, color: 0x303034 });
  // Lower coolant hose: radiator bottom-right → engine.
  await sculptPipe({ radius: 52, x1: 420, y1: 940, z1: -240, x2: 260, y2: 1180, z2: -950, bend: 200, color: 0x303034 });
  await captureAngles('04-pipes');

  // ─── SP-8 #2,#3 — chrome exhaust stack + air-intake snorkel (lofts) ──
  // Vertical: loft axis (local +Z) stood up to +Y via rx=-90.
  await sculptLoft({ r1: 95, r2: 78, height: 1900, rx: -90, x: 1250, y: 850, z: -420, color: 0xc6cace });   // exhaust
  await sculptLoft({ r1: 130, r2: 162, height: 1400, rx: -90, x: -1250, y: 900, z: -520, color: 0x474c52 }); // intake
  // mounting brackets — tie the radiator frame down to the chassis line.
  await sculptBox({ w: 150, h: 150, d: 420, x: -975, y: 740, z: -235, color: 0x33373c });
  await sculptBox({ w: 150, h: 150, d: 420, x: 975,  y: 740, z: -235, color: 0x33373c });
  await sculptBox({ w: 150, h: 150, d: 420, x: 0,    y: 740, z: -235, color: 0x33373c });
  await captureAngles('99-final');

  const finalCount = await bodyCount();
  console.log(`SP-8/9/10 cooling module — final body count: ${finalCount}`);
  // 2 perforated + 3 loft + 4 pipe + (1 shroud-cyl-hub) + 9 blades
  // + 4 frame + 3 brackets = 26 bodies.
  expect(finalCount).toBeGreaterThanOrEqual(24);

  await app.close();
});
