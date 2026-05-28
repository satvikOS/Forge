import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-12 — Volvo FH rear DRIVE AXLE with dual wheels, built entirely
 * through the Sculpt ribbon. The hero is the new Sculpt Tire tool:
 * a tyre carcass revolved from a cross-section, with its TREAD wrapped
 * around the circumference by a circular pattern (deterministic block
 * count, no randomness) — 315/80R22.5 drive tyres.
 *
 * Composed into a coherent axle: 4 tyres (dual wheels per side) on
 * silver rims, wheel hubs, brake drums, the axle beam, the differential
 * pumpkin + pinion nose, and the driveshaft. Tyres spin about X (lateral).
 *
 * Per [[feedback_no_hardcoded_catalog_dims]] + [[feedback_omni_coherence_law]]
 * + [[feedback_bespoke_e2e_tests]] + [[feedback_studio_no_randomness]].
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp12-drive-axle-tires');
fs.mkdirSync(OUT, { recursive: true });

// Axle coordinate system (mm): X side-to-side (= wheel spin axis), Y up
// (ground at 0), Z front(0)→rear(−). Axle centreline at the tyre radius.
const AX = { centerY: 537, ll: -1150, li: -800, ri: 800, rr: 1150 };

test.describe.configure({ timeout: 40 * 60 * 1000 });

test('SP-12 — drive axle with tread-wrapped tyres (Sculpt Tire)', async () => {
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
    await dlg.waitFor({ state: 'hidden', timeout: 120000 });
    await win.waitForTimeout(80);
  };
  const addsOneBody = async (fn) => {
    const before = await bodyCount();
    await fn();
    await win.waitForFunction(([p]) => (window.__archdiscRegistry?.list?.() || []).length > p, [before], { timeout: 120000 });
  };
  const sculptCylinder = async ({ r, d, x, y, z, rx = 0, ry = 0, rz = 0, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Circle', { cx: 0, cy: 0, r, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: d });
      await runTool('Sculpt Place Body', { rx, ry, rz, x, y, z, color });
    });
  const sculptBox = async ({ w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Rectangle', { cx: 0, cy: 0, w, h, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: d });
      await runTool('Sculpt Place Body', { rx, ry, rz, x, y, z, color });
    });
  const sculptTire = async (f) => addsOneBody(() => runTool('Sculpt Tire', f));

  const tgt = { x: 0, y: 0.54, z: -0.05 };
  const captureAngles = async (label) => {
    const angles = [
      { name: 'iso',   az:  34, el: 16, dist: 5.6 },
      { name: 'front', az:   0, el:  6, dist: 5.2 },
      { name: 'tread', az:  62, el: 10, dist: 4.6 },   // looks at the tread face of a dual
      { name: 'rear',  az: 160, el: 14, dist: 5.6 },
      { name: 'top',   az:  18, el: 56, dist: 5.6 },
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

  // ─── axle beam + differential + pinion nose + driveshaft ─────────────
  await sculptBox({ w: 1760, h: 170, d: 190, x: 0, y: AX.centerY, z: 0, color: 0x3a3e44 });          // axle beam
  await sculptCylinder({ r: 270, d: 380, ry: 90, x: 0, y: AX.centerY, z: 0, color: 0x44484e });      // diff pumpkin
  await sculptBox({ w: 220, h: 220, d: 360, x: 0, y: AX.centerY - 40, z: -300, color: 0x44484e });   // pinion nose
  await sculptCylinder({ r: 60, d: 820, x: 0, y: AX.centerY - 40, z: -1180, color: 0x60656c });      // driveshaft (axis Z)
  await captureAngles('01-axle');

  // ─── hubs + brake drums at each wheel end ────────────────────────────
  for (const xs of [-1, 1]) {
    await sculptCylinder({ r: 215, d: 120, ry: 90, x: xs * 880, y: AX.centerY, z: 0, color: 0x4a4040 }); // drum
    await sculptCylinder({ r: 120, d: 400, ry: 90, x: xs * 985, y: AX.centerY, z: 0, color: 0x55595f }); // hub
  }
  await captureAngles('02-hubs');

  // ─── rims (silver) inside each tyre position ─────────────────────────
  for (const x of [AX.ll, AX.li, AX.ri, AX.rr]) {
    await sculptCylinder({ r: 286, d: 300, ry: 90, x, y: AX.centerY, z: 0, color: 0x8a8d92 });
  }
  await captureAngles('03-rims');

  // ─── tyres with wrapped tread (the SP-12 hero) — dual wheels ─────────
  for (const x of [AX.ll, AX.li, AX.ri, AX.rr]) {
    await sculptTire({ rimR: 286, outerR: 537, width: 315, treadCount: 54, treadDepth: 22, axis: 'X',
      x, y: AX.centerY, z: 0, color: 0x161616 });
  }
  await captureAngles('99-final');

  const finalCount = await bodyCount();
  console.log(`SP-12 drive axle — final body count: ${finalCount}`);
  // beam + diff + pinion + driveshaft + 2 drums + 2 hubs + 4 rims + 4 tyres = 16
  expect(finalCount).toBeGreaterThanOrEqual(15);

  await app.close();
});
