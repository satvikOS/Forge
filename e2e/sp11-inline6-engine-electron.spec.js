import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-11 — Volvo D13-style inline-6 diesel ENGINE, built entirely through
 * the Sculpt ribbon (no catalog recipe, no baked geometry, no import).
 *
 * Escalating-complexity machinery (step up from the 26-body cooling
 * module): ~41 distinct bodies forming a coherent long-block with its
 * INTERNALS exposed — crankshaft + 6 counterweights, 6 pistons staggered
 * by index-driven crank phase (NO randomness), 6 connecting rods — plus
 * crankcase, head deck, cam cover, oil pan, flywheel, front pulley, intake
 * plenum, induction + exhaust runners and a turbocharger.
 *
 * Exercises every Sculpt tool incl. the new ones:
 *   Loft           → turbine + compressor housings
 *   Pipe           → 6 intake runners + 6 exhaust primaries
 *   Circular Pattern → flywheel mounting-bolt circle (8 holes, 1 op)
 *   Linear Pattern → cam-cover bolt strip (12 studs, 1 op)
 *
 * Pistons are placed at crank phases θ_i = (i·120°) so the reciprocating
 * assembly reads correctly — deterministic, per [[feedback_studio_no_randomness]].
 * Per [[feedback_no_hardcoded_catalog_dims]] + [[feedback_omni_coherence_law]]
 * + [[feedback_bespoke_e2e_tests]].
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp11-inline6-engine');
fs.mkdirSync(OUT, { recursive: true });

// Engine coordinate system (mm): crank axis along Z (front 0 → rear −),
// Y up (cylinders vertical), X side-to-side. Crank centreline y=140.
const E = {
  crankY: 140, nCyl: 6, bore: 280, firstZ: -260,
  caseTopY: 420,
};
const cylZ = (i) => E.firstZ - i * E.bore;        // -260,-540,... -1660
const midZ = cylZ((E.nCyl - 1) / 2);              // engine centre in Z

test.describe.configure({ timeout: 40 * 60 * 1000 });

test('SP-11 — inline-6 engine sculpted through the ribbon (internals exposed)', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.error('[pageerror]', e.message));

  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscRegistry, null, { timeout: 60000 });
  await win.evaluate(() => { window.__archdiscBypassDialog = false; });

  const wc = win.locator('[data-archdisc-welcome-close="true"]').first();
  if (await wc.count() > 0) {
    await wc.dispatchEvent('click');
    await win.locator('[data-archdisc-welcome="open"]').waitFor({ state: 'hidden', timeout: 5000 });
  }
  await win.locator('[data-ribbon-tab-key="part"]').dispatchEvent('click');

  const bodyCount = () => win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);

  const runTool = async (toolName, fields) => {
    await win.locator(`[data-ribbon-tool-name="${toolName}"]`).first().dispatchEvent('click');
    const dlg = win.locator('.tpd-dialog');
    await dlg.waitFor({ state: 'visible', timeout: 8000 });
    await win.waitForTimeout(80);
    for (const [name, val] of Object.entries(fields)) {
      const inp = dlg.locator(`[data-field="${name}"]`).first();
      if (await inp.count() === 0) continue;
      const tag = await inp.evaluate((el) => el.tagName.toLowerCase());
      if (tag === 'select') await inp.selectOption(String(val));
      else await inp.fill(String(val));
    }
    await win.locator('.tpd-btn-run').dispatchEvent('click');
    await dlg.waitFor({ state: 'hidden', timeout: 90000 });
    await win.waitForTimeout(80);
  };
  const addsOneBody = async (fn) => {
    const before = await bodyCount();
    await fn();
    await win.waitForFunction(([p]) => (window.__archdiscRegistry?.list?.() || []).length > p, [before], { timeout: 90000 });
  };

  const sculptBox = async ({ w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Rectangle', { cx: 0, cy: 0, w, h, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: d });
      await runTool('Sculpt Place Body', { rx, ry, rz, x, y, z, color });
    });
  // Cylinder built axis-along-Z; rx=90 stands it vertical (axis Y).
  const sculptCylinder = async ({ r, d, x, y, z, rx = 0, ry = 0, rz = 0, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Circle', { cx: 0, cy: 0, r, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: d });
      await runTool('Sculpt Place Body', { rx, ry, rz, x, y, z, color });
    });
  const sculptPipe = async (f) => addsOneBody(() => runTool('Sculpt Pipe', f));
  const sculptLoft = async (f) => addsOneBody(() => runTool('Sculpt Loft', f));

  const tgt = { x: -0.05, y: 0.46, z: -0.96 };
  const captureAngles = async (label) => {
    const angles = [
      { name: 'iso',    az:  42, el: 18, dist: 5.2 },
      { name: 'side',   az:  90, el: 10, dist: 5.4 },
      { name: 'front',  az:   2, el: 12, dist: 4.2 },
      { name: 'rear3q', az: 140, el: 20, dist: 5.4 },
      { name: 'top',    az:  20, el: 54, dist: 5.6 },
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
      await win.waitForTimeout(140);
      await win.screenshot({ path: path.join(OUT, `${label}-${a.name}.png`) });
    }
  };

  await captureAngles('00-empty');

  // ─── crankcase + oil pan ─────────────────────────────────────────────
  // NOTE: sculptBox/sculptCylinder build at local z∈[0,d], so centre a
  // long part on the engine by translating its placement to (centre − d/2).
  // Low bedplate (cradles the crank from below) — keeps the rotating
  // assembly EXPOSED above it instead of enclosing it.
  await sculptBox({ w: 440, h: 170, d: 1700, x: 0, y: 85, z: midZ - 850, color: 0x55595f });   // bedplate
  await sculptBox({ w: 400, h: 240, d: 1500, x: 0, y: -120, z: midZ - 750, color: 0x3a3e44 });   // oil pan
  await captureAngles('01-block');

  // ─── crankshaft (Z axis) + 6 counterweight webs (index-placed) ───────
  await sculptCylinder({ r: 65, d: 1750, x: 0, y: E.crankY, z: midZ - 875, color: 0x60656c }); // shaft (no rx → axis Z)
  for (let i = 0; i < E.nCyl; i++) {
    await sculptCylinder({ r: 120, d: 44, x: 0, y: E.crankY, z: cylZ(i) - 22, color: 0x4f535a });
  }
  await captureAngles('02-crank');

  // ─── 6 pistons + 6 conrods (crank phase θ = i·120°, deterministic) ───
  const crownY = (i) => 560 + 150 * Math.sin((i * 120) * Math.PI / 180);
  for (let i = 0; i < E.nCyl; i++) {
    const cy = crownY(i);
    // piston (vertical cylinder, crown at cy)
    await sculptCylinder({ r: 100, d: 170, rx: 90, x: 0, y: cy + 85, z: cylZ(i), color: 0x9398a0 });
    // conrod (box) — generously overlaps crank (y=140) and piston so the
    // train is always connected (no floating gap).
    const rodCenter = (E.crankY + cy) / 2;
    const rodH = (cy - E.crankY) + 170;
    await sculptBox({ w: 46, h: rodH, d: 78, x: 0, y: rodCenter, z: cylZ(i) - 39, color: 0x70757c });
  }
  await captureAngles('03-pistons');

  // ─── head deck + cam cover + linear-pattern cover bolt strip ─────────
  await sculptBox({ w: 460, h: 150, d: 1700, x: 0, y: 830, z: midZ - 850, color: 0x5f636a });   // head deck
  await sculptBox({ w: 400, h: 150, d: 1650, x: 0, y: 985, z: midZ - 825, color: 0x4a5a66 });   // cam cover
  // cam-cover bolt strip: 12 studs in a row (Sculpt Linear Pattern), then
  // ry=90 to run the row along the engine's Z length, set onto the cover.
  await addsOneBody(async () => {
    await runTool('Sculpt Circle', { cx: 0, cy: 0, r: 17, plane: 'XY' });
    await runTool('Sculpt Linear Pattern', { mode: 'extrude', count: 12, distance: 46, dx: 140, dy: 0 });
    await runTool('Sculpt Place Body', { ry: 90, x: 175, y: 1062, z: midZ + 770, color: 0x80858c });
  });
  await captureAngles('04-head');

  // ─── flywheel (Circular Pattern bolt circle) + front pulley ──────────
  await addsOneBody(async () => {
    await runTool('Sculpt Circle', { cx: 0, cy: 0, r: 240, plane: 'XY' });   // flywheel disk
    await runTool('Sculpt Extrude', { distance: 70 });
    await runTool('Sculpt Circle', { cx: 175, cy: 0, r: 16, plane: 'XY' });  // bolt hole, offset
    await runTool('Sculpt Circular Pattern', { mode: 'cut', count: 8, distance: 90, angle: 360 });
    await runTool('Sculpt Place Body', { x: 0, y: E.crankY, z: midZ - 945, color: 0x4a4e54 });
  });
  await sculptCylinder({ r: 120, d: 80, x: 0, y: E.crankY, z: midZ + 880, color: 0x40444a }); // front damper
  await captureAngles('05-driveline');

  // ─── induction: plenum + 6 intake runners (Sculpt Pipe) ──────────────
  await sculptBox({ w: 170, h: 180, d: 1500, x: 350, y: 880, z: midZ - 750, color: 0x4a5a66 });
  for (let i = 0; i < E.nCyl; i++) {
    await sculptPipe({ radius: 42, x1: 300, y1: 880, z1: cylZ(i), x2: 165, y2: 845, z2: cylZ(i), bend: 34, color: 0x52606b });
  }
  await captureAngles('06-intake');

  // ─── exhaust: 6 primaries (Sculpt Pipe) merging to the turbo collector
  for (let i = 0; i < E.nCyl; i++) {
    await sculptPipe({ radius: 40, x1: -210, y1: 820, z1: cylZ(i), x2: -340, y2: 640, z2: -1520, bend: -60, color: 0x6b5a4a });
  }
  // turbocharger — turbine + compressor housings (Sculpt Loft, vertical).
  await sculptLoft({ r1: 165, r2: 118, height: 210, rx: -90, x: -420, y: 470, z: -1560, color: 0x6b5a4a }); // turbine
  await sculptLoft({ r1: 118, r2: 170, height: 210, rx: -90, x: -420, y: 700, z: -1560, color: 0x8a9098 }); // compressor
  await captureAngles('99-final');

  const finalCount = await bodyCount();
  console.log(`SP-11 inline-6 engine — final body count: ${finalCount}`);
  // crankcase + pan + crank + 6 webs + 6 pistons + 6 rods + head + cover
  // + bolt-strip + flywheel + pulley + plenum + 6 intake + 6 exhaust
  // + 2 turbo = 41 bodies.
  expect(finalCount).toBeGreaterThanOrEqual(38);

  await app.close();
});
