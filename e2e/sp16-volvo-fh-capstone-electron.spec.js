import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-16 CAPSTONE — full Volvo FH 4x2 tractor, sculpted ENTIRELY through
 * the ribbon (no catalog recipe, no baked geometry, no import, no random).
 * Composes every Sculpt tool built this run into ONE coherent truck:
 *
 *   chassis frame rails + crossmembers                 (box)
 *   steer axle + drive axle, tread-wrapped dual tyres  (Tire)
 *   engine under the cab                               (box + loft)
 *   cab-over cab (proven SP-7 panels) + opaque glazing (box)
 *   fascia: perforated grille, bumper, lights, badge   (Perforated + box)
 *   chrome exhaust stack + air-intake snorkel          (Loft)
 *   fuel tanks                                         (cylinder)
 *   fifth-wheel plate + instanced mount fasteners      (Bolt Array)
 *
 * ~58 sculpted bodies + 164 instanced fasteners = >200 components, the
 * machinery bar met through the platform. Truck axes: X side-to-side,
 * Y up (ground 0), Z front(+)->rear(-). Per [[feedback_omni_coherence_law]]
 * + [[feedback_no_hardcoded_catalog_dims]] + [[feedback_studio_no_randomness]].
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp16-volvo-fh-capstone');
fs.mkdirSync(OUT, { recursive: true });

const T = {
  // cab (proven SP-7 layout, seated on the frame)
  halfW: 1230, floorY: 950, roofY: 3250, frontZ: 150, rearZ: -2250, wallT: 70,
  frameTopY: 900, frameY: 750, railX: 450,
  steerZ: -150, driveZ: -3500, axleY: 537,
};
T.cabMidZ = (T.frontZ + T.rearZ) / 2;     // -1050
T.cabDepth = T.frontZ - T.rearZ;          // 2400

// colours (realistic Volvo FH; model parts may be coloured — UI stays OLED)
const C = {
  cab: 0x33597a, roof: 0x2c4d6a, glass: 0x10181f, frame: 0x26292e,
  tyre: 0x141414, rim: 0x8a8d92, grille: 0x191c1f, bumper: 0x33373c,
  light: 0xc6cace, badge: 0xaeb3b8, alloy: 0xa6abb0, chrome: 0xc8ccd0,
  engine: 0x53585f, fifth: 0x3a3e44,
};

test.describe.configure({ timeout: 60 * 60 * 1000 });

test('SP-16 — full Volvo FH tractor capstone (pure sculpt)', async () => {
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
    await win.waitForTimeout(70);
    for (const [name, val] of Object.entries(fields)) {
      const inp = dlg.locator(`[data-field="${name}"]`).first();
      if (await inp.count() === 0) continue;
      const tag = await inp.evaluate((el) => el.tagName.toLowerCase());
      if (tag === 'select') await inp.selectOption(String(val));
      else await inp.fill(String(val));
    }
    await win.locator('.tpd-btn-run').dispatchEvent('click');
    await dlg.waitFor({ state: 'hidden', timeout: 120000 });
    await win.waitForTimeout(70);
  };
  const addsOneBody = async (fn) => {
    const before = await bodyCount();
    await fn();
    await win.waitForFunction(([p]) => (window.__archdiscRegistry?.list?.() || []).length > p, [before], { timeout: 120000 });
  };
  const box = async ({ w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Rectangle', { cx: 0, cy: 0, w, h, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: d });
      await runTool('Sculpt Place Body', { rx, ry, rz, x, y, z, color });
    });
  const cyl = async ({ r, d, x, y, z, rx = 0, ry = 0, rz = 0, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Circle', { cx: 0, cy: 0, r, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: d });
      await runTool('Sculpt Place Body', { rx, ry, rz, x, y, z, color });
    });
  const tire = async (f) => addsOneBody(() => runTool('Sculpt Tire', f));
  const loft = async (f) => addsOneBody(() => runTool('Sculpt Loft', f));
  const perf = async (f) => addsOneBody(() => runTool('Sculpt Perforated Panel', f));
  const bolts = async (f) => addsOneBody(() => runTool('Sculpt Bolt Array', f));

  const tgt = { x: 0, y: 1.75, z: -2.2 };
  const capture = async (label) => {
    const angles = [
      { name: 'side',   az:  90, el:  6, dist: 14.5 },
      { name: 'iso',    az:  42, el: 16, dist: 17.5 },
      { name: 'front',  az:   4, el:  7, dist: 13.5 },
      { name: 'rear3q', az: 148, el: 17, dist: 17.0 },
      { name: 'top',    az:  18, el: 54, dist: 16.0 },
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
      await win.waitForTimeout(130);
      await win.screenshot({ path: path.join(OUT, `${label}-${a.name}.png`) });
    }
  };

  await capture('00-empty');

  // ═══ CHASSIS — 2 frame rails + 4 crossmembers ════════════════════════
  // long parts build at local z∈[0,d]; centre with z = centre − d/2.
  const railD = 5650, railCz = -2175;
  await box({ w: 90, h: 300, d: railD, x: -T.railX, y: T.frameY, z: railCz - railD / 2, color: C.frame });
  await box({ w: 90, h: 300, d: railD, x:  T.railX, y: T.frameY, z: railCz - railD / 2, color: C.frame });
  for (const cz of [500, -1500, -3400, -4600]) {
    await box({ w: 830, h: 150, d: 130, x: 0, y: T.frameY, z: cz - 65, color: C.frame });
  }
  await capture('01-chassis');

  // ═══ AXLES + TREAD-WRAPPED TYRES ═════════════════════════════════════
  // steer axle
  await box({ w: 1900, h: 150, d: 170, x: 0, y: T.axleY, z: T.steerZ - 85, color: C.frame });
  for (const x of [-1080, 1080]) {
    await cyl({ r: 286, d: 300, ry: 90, x, y: T.axleY, z: T.steerZ, color: C.rim });
    await tire({ rimR: 286, outerR: 537, width: 315, treadCount: 32, treadDepth: 22, axis: 'X', x, y: T.axleY, z: T.steerZ, color: C.tyre });
  }
  // drive axle + diff, dual wheels
  await box({ w: 1850, h: 160, d: 190, x: 0, y: T.axleY, z: T.driveZ - 95, color: C.frame });
  await cyl({ r: 250, d: 360, ry: 90, x: 0, y: T.axleY, z: T.driveZ, color: C.engine });   // diff pumpkin
  for (const x of [-900, -1230, 900, 1230]) {
    await cyl({ r: 286, d: 300, ry: 90, x, y: T.axleY, z: T.driveZ, color: C.rim });
    await tire({ rimR: 286, outerR: 537, width: 315, treadCount: 32, treadDepth: 22, axis: 'X', x, y: T.axleY, z: T.driveZ, color: C.tyre });
  }
  await capture('02-rolling');

  // ═══ ENGINE under the cab (between rails) + driveshaft ═══════════════
  await box({ w: 660, h: 600, d: 1000, x: 0, y: 700, z: -700 - 500, color: C.engine });        // block
  await box({ w: 600, h: 200, d: 900, x: 0, y: 430, z: -700 - 450, color: 0x44484e });          // oil pan
  await loft({ r1: 150, r2: 105, height: 200, rx: -90, x: 360, y: 760, z: -360, color: 0x6b5a4a }); // turbo
  await cyl({ r: 55, d: 2300, x: 0, y: 500, z: T.driveZ, color: 0x60656c });                      // driveshaft (axis Z, engine→diff)
  await capture('03-engine');

  // ═══ CAB (proven SP-7 panels) — opaque glazing ══════════════════════
  await box({ w: 2460, h: T.cabDepth, d: T.wallT, x: 0, y: T.floorY, z: T.cabMidZ, rx: 90, color: C.frame });        // floor
  await box({ w: 2460, h: T.cabDepth, d: T.wallT, x: 0, y: T.roofY, z: T.cabMidZ, rx: 90, color: C.roof });          // roof
  await box({ w: T.cabDepth, h: 2300, d: T.wallT, x: -T.halfW, y: T.floorY + 1150, z: T.cabMidZ, ry: 90, color: C.cab }); // L wall
  await box({ w: T.cabDepth, h: 2300, d: T.wallT, x:  T.halfW, y: T.floorY + 1150, z: T.cabMidZ, ry: 90, color: C.cab }); // R wall
  await box({ w: 2460, h: 2300, d: T.wallT, x: 0, y: T.floorY + 1150, z: T.rearZ, color: C.cab });                   // rear wall
  await box({ w: 2460, h: 360, d: T.wallT, x: 0, y: T.roofY - 230, z: T.frontZ, color: C.roof });                   // front header
  await box({ w: 2280, h: 1450, d: 34, x: 0, y: T.floorY + 1520, z: T.frontZ - 40, rx: -16, color: C.glass });      // windshield
  await box({ w: 980, h: 760, d: 28, x: -T.halfW - 36, y: T.floorY + 1520, z: -780, ry: 90, color: C.glass });      // L window
  await box({ w: 980, h: 760, d: 28, x:  T.halfW + 36, y: T.floorY + 1520, z: -780, ry: 90, color: C.glass });      // R window
  await capture('04-cab');

  // ═══ FASCIA on the cab front (z≈frontZ) ═════════════════════════════
  await perf({ w: 1520, h: 980, t: 46, holeR: 18, cols: 22, rows: 16, spacing: 60, x: 0, y: 2080, z: T.frontZ + 20, color: C.grille }); // grille
  await box({ w: 2560, h: 360, d: 340, x: 0, y: 820, z: T.frontZ + 250, color: C.bumper });                          // bumper
  await box({ w: 440, h: 300, d: 200, x: -980, y: 1420, z: T.frontZ + 180, color: C.light });                        // L headlight
  await box({ w: 440, h: 300, d: 200, x:  980, y: 1420, z: T.frontZ + 180, color: C.light });                        // R headlight
  await box({ w: 280, h: 200, d: 170, x: -780, y: 980, z: T.frontZ + 270, color: C.light });                         // L fog
  await box({ w: 280, h: 200, d: 170, x:  780, y: 980, z: T.frontZ + 270, color: C.light });                         // R fog
  await box({ w: 1500, h: 150, d: 50, x: 0, y: 2860, z: T.frontZ + 25, color: C.badge });                            // VOLVO badge bar
  // mirrors on arms
  await box({ w: 150, h: 560, d: 230, x: -T.halfW - 150, y: 2520, z: T.frontZ - 120, color: C.frame });              // L mirror
  await box({ w: 150, h: 560, d: 230, x:  T.halfW + 150, y: 2520, z: T.frontZ - 120, color: C.frame });              // R mirror
  await capture('05-fascia');

  // ═══ ACCESSORIES — exhaust stack, air intake, fuel tanks ════════════
  await loft({ r1: 95, r2: 80, height: 2350, rx: -90, x: 1190, y: 900, z: -2380, color: C.chrome });                 // exhaust stack
  await loft({ r1: 135, r2: 158, height: 1550, rx: -90, x: -1190, y: 950, z: -2230, color: 0x44484e });              // air intake
  await cyl({ r: 320, d: 1150, x: 820, y: 600, z: -2050 - 575, color: C.alloy });                                    // R fuel tank (axis Z)
  await cyl({ r: 320, d: 1150, x: -820, y: 600, z: -2050 - 575, color: C.alloy });                                   // L fuel tank
  await capture('06-accessories');

  // ═══ FIFTH WHEEL + instanced mount fasteners (SP-13/14/15) ══════════
  // plate is horizontal (thin in Y) → no rotation; centred at z=-3800.
  await box({ w: 1000, h: 70, d: 1000, x: 0, y: 905, z: -4300, color: C.fifth });                                    // fifth-wheel plate
  await cyl({ r: 70, d: 200, rx: 90, x: 0, y: 770, z: -3700, color: 0x2a2e34 });                                     // king pin (vertical, hangs below)
  await bolts({ count: 140, layout: 'grid', spacing: 58, headR: 15, headH: 12, shankR: 8, shankLen: 30, rx: 90,
    x: 0, y: 945, z: -3800, color: C.alloy });                                                                       // mount bolt grid (horizontal)
  await bolts({ count: 24, layout: 'circle', radius: 230, headR: 14, headH: 11, shankR: 7, shankLen: 28, rx: 90,
    x: 0, y: 945, z: -3700, color: C.alloy });                                                                       // king-pin bolt circle
  await capture('99-final');

  const finalCount = await bodyCount();
  const lastArray = await win.evaluate(() => window.__lastInstancedArray || null);
  console.log(`SP-16 Volvo FH capstone — sculpted bodies: ${finalCount}; instanced fasteners last: ${JSON.stringify(lastArray)}`);
  // ~58 sculpted bodies; +164 instanced fasteners → >200 components total.
  expect(finalCount).toBeGreaterThanOrEqual(50);
  expect(lastArray && lastArray.drawCalls).toBe(1);

  await app.close();
});
