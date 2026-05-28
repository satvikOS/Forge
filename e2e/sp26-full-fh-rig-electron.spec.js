import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-26 CAPSTONE — the COMPLETE Volvo FH rig (the Video-21 target): the
 * SP-19 Class-A tractor coupled at the fifth wheel to the SP-25 box-van
 * trailer, built entirely through the ribbon. The trailer reuses SP-25's
 * proven geometry shifted in Z so its king-pin mates the tractor's fifth
 * wheel. ~80 sculpted bodies + instanced fasteners across the whole rig.
 *
 * Tractor: crowned cab + curved doors + windshield, perforated grille +
 * embossed VOLVO/FH, fender arches, engine + turbo, steer + dual-drive
 * tread tyres, exhaust/intake lofts, fuel tanks, fifth wheel + bolts.
 * Trailer: box van + crowned roof, tri-axle tread tyres, landing gear,
 * rear underrun + mud flaps + lights.
 *
 * Per [[project_video21_parity_bible]] + [[feedback_omni_coherence_law]].
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp26-full-fh-rig');
fs.mkdirSync(OUT, { recursive: true });

const czc = (cz, d) => cz - d / 2;
const T = {
  halfW: 1230, floorY: 950, roofY: 3150, frontZ: 150, rearZ: -2250, wallT: 70,
  frameY: 750, railX: 450, steerZ: -150, driveZ: -3500, axleY: 537,
};
T.cabMidZ = (T.frontZ + T.rearZ) / 2;
T.cabDepth = T.frontZ - T.rearZ;
const DZ = -3950;          // trailer Z offset: king-pin (z=150) → fifth wheel (z=-3800)
const TAXY = 560;
const C = {
  cab: 0x33597a, roof: 0x2c4d6a, glass: 0x10181f, frame: 0x26292e, tyre: 0x141414,
  rim: 0x8a8d92, grille: 0x191c1f, bumper: 0x33373c, light: 0xc6cace, chrome: 0xc8ccd0,
  badge: 0xd2d6da, engine: 0x53585f, alloy: 0xa6abb0, fifth: 0x3a3e44, van: 0xb8bcc0,
};

test.describe.configure({ timeout: 60 * 60 * 1000 });

test('SP-26 — full Volvo FH rig (tractor + trailer)', async () => {
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
    await win.waitForTimeout(60);
    for (const [name, val] of Object.entries(fields)) {
      const inp = dlg.locator(`[data-field="${name}"]`).first();
      if (await inp.count() === 0) continue;
      const tag = await inp.evaluate((el) => el.tagName.toLowerCase());
      if (tag === 'select') await inp.selectOption(String(val));
      else { await inp.fill(''); await inp.fill(String(val)); }
    }
    await win.locator('.tpd-btn-run').dispatchEvent('click');
    await dlg.waitFor({ state: 'hidden', timeout: 120000 });
    await win.waitForTimeout(60);
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
  const crown = async (f) => addsOneBody(() => runTool('Sculpt Crown Panel', f));
  const emboss = async (f) => addsOneBody(() => runTool('Sculpt Embossed Text', f));

  const tgt = { x: 0, y: 2.0, z: -5.5 };
  const capture = async (label) => {
    const angles = [
      { name: 'side',   az:  90, el:  5, dist: 30 },
      { name: 'iso',    az:  40, el: 15, dist: 34 },
      { name: 'rear3q', az: 150, el: 15, dist: 33 },
      { name: 'top',    az:  14, el: 58, dist: 33 },
    ];
    for (const a of angles) {
      await win.evaluate(({ az, el, dist, tx, ty, tz }) => {
        const vp = window.__archdiscViewport;
        if (!vp?.camera) return;
        if (vp.orbitControls) { vp.orbitControls.maxDistance = 4000; vp.orbitControls.minDistance = 0.05; }
        if (vp.camera.far < 9000) { vp.camera.far = 12000; vp.camera.updateProjectionMatrix(); }
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
      await win.waitForTimeout(120);
      await win.screenshot({ path: path.join(OUT, `${label}-${a.name}.png`) });
    }
  };

  await capture('00-empty');

  // ════════════ TRACTOR (SP-19 layout) ════════════════════════════════
  const railD = 5650, railCz = -2175;
  await box({ w: 90, h: 300, d: railD, x: -T.railX, y: T.frameY, z: czc(railCz, railD), color: C.frame });
  await box({ w: 90, h: 300, d: railD, x: T.railX, y: T.frameY, z: czc(railCz, railD), color: C.frame });
  await box({ w: 1900, h: 150, d: 170, x: 0, y: T.axleY, z: T.steerZ - 85, color: C.frame });
  for (const x of [-1080, 1080]) {
    await cyl({ r: 286, d: 300, ry: 90, x, y: T.axleY, z: T.steerZ, color: C.rim });
    await tire({ rimR: 286, outerR: 537, width: 315, treadCount: 26, treadDepth: 22, axis: 'X', x, y: T.axleY, z: T.steerZ, color: C.tyre });
  }
  await box({ w: 1850, h: 160, d: 190, x: 0, y: T.axleY, z: T.driveZ - 95, color: C.frame });
  await cyl({ r: 250, d: 360, ry: 90, x: 0, y: T.axleY, z: T.driveZ, color: C.engine });
  for (const x of [-900, -1230, 900, 1230]) {
    await cyl({ r: 286, d: 300, ry: 90, x, y: T.axleY, z: T.driveZ, color: C.rim });
    await tire({ rimR: 286, outerR: 537, width: 315, treadCount: 26, treadDepth: 22, axis: 'X', x, y: T.axleY, z: T.driveZ, color: C.tyre });
  }
  await box({ w: 660, h: 600, d: 1000, x: 0, y: 700, z: -1200, color: C.engine });
  await loft({ r1: 150, r2: 105, height: 200, rx: -90, x: 360, y: 760, z: -360, color: 0x6b5a4a });
  await capture('01-tractor-gear');
  // cab
  await box({ w: 2440, h: T.cabDepth, d: T.wallT, x: 0, y: T.floorY, z: T.cabMidZ, rx: 90, color: C.frame });
  await crown({ width: 2460, length: 2520, crownX: 120, crownZ: 90, thickness: 60, nu: 30, nv: 26, x: 0, y: T.roofY, z: T.cabMidZ - 1260, color: C.roof });
  await crown({ width: 1750, length: 1650, crownX: 65, crownZ: 38, thickness: 48, nu: 24, nv: 20, rz: 90, x: -T.halfW, y: 1900, z: T.cabMidZ - 825, color: C.cab });
  await crown({ width: 1750, length: 1650, crownX: 65, crownZ: 38, thickness: 48, nu: 24, nv: 20, rz: -90, x: T.halfW, y: 1900, z: T.cabMidZ - 825, color: C.cab });
  await box({ w: 2440, h: 2300, d: T.wallT, x: 0, y: T.floorY + 1150, z: T.rearZ, color: C.cab });
  await crown({ width: 2300, length: 1500, crownX: 85, crownZ: 55, thickness: 40, nu: 28, nv: 20, rx: -56, x: 0, y: 2120, z: T.frontZ + 30, color: C.glass });
  await capture('02-cab');
  // fascia + VOLVO
  await perf({ w: 1700, h: 760, t: 46, holeR: 16, cols: 24, rows: 12, spacing: 62, x: 0, y: 1500, z: T.frontZ + 20, color: C.grille });
  await box({ w: 1820, h: 130, d: 40, x: 0, y: 1560, z: T.frontZ + 75, rz: 13, color: C.chrome });
  await emboss({ text: 'VOLVO', size: 300, depth: 45, curveSegments: 9, x: 0, y: 1760, z: T.frontZ + 60, color: C.badge });
  await emboss({ text: 'FH', size: 210, depth: 42, curveSegments: 9, x: 0, y: 1230, z: T.frontZ + 60, color: C.badge });
  await box({ w: 2560, h: 360, d: 340, x: 0, y: 820, z: T.frontZ + 250, color: C.bumper });
  await box({ w: 440, h: 300, d: 200, x: -980, y: 1180, z: T.frontZ + 180, color: C.light });
  await box({ w: 440, h: 300, d: 200, x: 980, y: 1180, z: T.frontZ + 180, color: C.light });
  for (const fx of [-1180, 1180]) {
    await addsOneBody(() => runTool('Sculpt Fender Arch', { archRadius: 620, archSpan: 196, width: 440, section: 150, thickness: 36, ry: 90, x: fx, y: T.axleY, z: T.steerZ, color: C.cab }));
  }
  await box({ w: 150, h: 560, d: 230, x: -T.halfW - 150, y: 2360, z: T.frontZ - 120, color: C.frame });
  await box({ w: 150, h: 560, d: 230, x: T.halfW + 150, y: 2360, z: T.frontZ - 120, color: C.frame });
  await loft({ r1: 95, r2: 80, height: 2350, rx: -90, x: 1190, y: 900, z: -2380, color: C.chrome });
  await loft({ r1: 135, r2: 158, height: 1550, rx: -90, x: -1190, y: 950, z: -2230, color: 0x44484e });
  await cyl({ r: 320, d: 1150, x: 820, y: 600, z: -2625, color: C.alloy });
  await cyl({ r: 320, d: 1150, x: -820, y: 600, z: -2625, color: C.alloy });
  await box({ w: 1000, h: 70, d: 1000, x: 0, y: 905, z: -4300, color: C.fifth });
  await bolts({ count: 120, layout: 'grid', spacing: 58, headR: 15, headH: 12, shankR: 8, shankLen: 30, rx: 90, x: 0, y: 945, z: -3800, color: C.alloy });
  await capture('03-tractor-done');

  // ════════════ TRAILER (SP-25 layout, shifted by DZ) ══════════════════
  await box({ w: 2480, h: 120, d: 8800, x: 0, y: 1290, z: czc(-4000 + DZ, 8800), color: C.frame });
  await box({ w: 80, h: 2600, d: 8600, x: -1240, y: 2700, z: czc(-4100 + DZ, 8600), color: C.van });
  await box({ w: 80, h: 2600, d: 8600, x: 1240, y: 2700, z: czc(-4100 + DZ, 8600), color: C.van });
  await box({ w: 2480, h: 2600, d: 90, x: 0, y: 2700, z: czc(420 + DZ, 90), color: C.van });
  await box({ w: 1230, h: 2600, d: 90, x: -620, y: 2700, z: czc(-8400 + DZ, 90), color: 0xa6abb0 });
  await box({ w: 1230, h: 2600, d: 90, x: 620, y: 2700, z: czc(-8400 + DZ, 90), color: 0xa6abb0 });
  await crown({ width: 2500, length: 8600, crownX: 90, crownZ: 25, thickness: 90, nu: 22, nv: 34, x: 0, y: 4010, z: czc(-4100 + DZ, 8600), color: C.chrome });
  await cyl({ r: 70, d: 200, rx: 90, x: 0, y: 1050, z: 150 + DZ, color: 0x2a2e34 });   // king pin → on fifth wheel
  await box({ w: 130, h: 820, d: 130, x: -680, y: 870, z: czc(-1500 + DZ, 130), color: 0x3a3e44 });
  await box({ w: 130, h: 820, d: 130, x: 680, y: 870, z: czc(-1500 + DZ, 130), color: 0x3a3e44 });
  await capture('04-trailer-body');
  for (const az of [-6000, -6900, -7800]) {
    await box({ w: 2000, h: 150, d: 170, x: 0, y: TAXY, z: czc(az + DZ, 170), color: C.frame });
    for (const wx of [-1040, 1040]) {
      await cyl({ r: 286, d: 300, ry: 90, x: wx, y: TAXY, z: az + DZ, color: C.rim });
      await tire({ rimR: 286, outerR: 545, width: 360, treadCount: 24, treadDepth: 22, axis: 'X', x: wx, y: TAXY, z: az + DZ, color: C.tyre });
    }
  }
  await box({ w: 2400, h: 130, d: 130, x: 0, y: 520, z: czc(-8520 + DZ, 130), color: C.frame });
  await box({ w: 420, h: 520, d: 40, x: -1060, y: 290, z: czc(-8150 + DZ, 40), color: 0x16191c });
  await box({ w: 420, h: 520, d: 40, x: 1060, y: 290, z: czc(-8150 + DZ, 40), color: 0x16191c });
  await box({ w: 200, h: 360, d: 90, x: -980, y: 760, z: czc(-8470 + DZ, 90), color: 0x7a2a2a });
  await box({ w: 200, h: 360, d: 90, x: 980, y: 760, z: czc(-8470 + DZ, 90), color: 0x7a2a2a });
  await capture('99-final');

  const n = await bodyCount();
  console.log(`SP-26 full FH rig — sculpted bodies: ${n}`);
  expect(n).toBeGreaterThanOrEqual(70);

  await app.close();
});
