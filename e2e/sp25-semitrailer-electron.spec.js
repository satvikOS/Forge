import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-25 — SEMI-TRAILER, completing the Volvo FH tractor+trailer rig.
 * A box-van trailer built entirely through the ribbon: deck + chassis
 * rails, van body (box sides/front + rear doors + a crowned Class-A roof),
 * king-pin plate + king pin (mates the tractor fifth wheel), a tri-axle
 * bogie on tread-wrapped tyres, landing gear, and a rear underrun bar +
 * mud flaps + tail lights. Composition of existing Sculpt tools.
 * Adversarial side / iso / rear-3q / top audit. Per [[project_video21_parity_bible]].
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp25-semitrailer');
fs.mkdirSync(OUT, { recursive: true });

// ground y=0, X side-to-side, Z front(+ king-pin)/rear(−). Deck top y≈1350.
const czc = (centerZ, d) => centerZ - d / 2;
const AXY = 560;  // trailer axle height (wheel radius)

test.describe.configure({ timeout: 40 * 60 * 1000 });

test('SP-25 — semi-trailer (box van, tri-axle)', async () => {
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
  const crown = async (f) => addsOneBody(() => runTool('Sculpt Crown Panel', f));

  const tgt = { x: 0, y: 2.0, z: -4.0 };
  const capture = async (label) => {
    const angles = [
      { name: 'side',   az:  90, el:  6, dist: 23 },
      { name: 'iso',    az:  40, el: 16, dist: 27 },
      { name: 'rear3q', az: 150, el: 16, dist: 25 },
      { name: 'top',    az:  16, el: 56, dist: 26 },
    ];
    for (const a of angles) {
      await win.evaluate(({ az, el, dist, tx, ty, tz }) => {
        const vp = window.__archdiscViewport;
        if (!vp?.camera) return;
        // orbitControls clamps to maxDistance (~tuned for a ~15m truck);
        // raise it so the 9m trailer can be framed from far enough back.
        if (vp.orbitControls) { vp.orbitControls.maxDistance = 2000; vp.orbitControls.minDistance = 0.05; }
        if (vp.camera.far < 5000) { vp.camera.far = 8000; vp.camera.updateProjectionMatrix(); }
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

  // ─── underframe — deck + 2 chassis rails ────────────────────────────
  await box({ w: 2480, h: 120, d: 8800, x: 0, y: 1290, z: czc(-4000, 8800), color: 0x26292e });
  await box({ w: 120, h: 260, d: 8400, x: -400, y: 1110, z: czc(-4100, 8400), color: 0x26292e });
  await box({ w: 120, h: 260, d: 8400, x: 400, y: 1110, z: czc(-4100, 8400), color: 0x26292e });
  await capture('01-underframe');

  // ─── van body — box sides + front + rear doors + crowned roof ───────
  await box({ w: 80, h: 2600, d: 8600, x: -1240, y: 2700, z: czc(-4100, 8600), color: 0xb8bcc0 });   // L side
  await box({ w: 80, h: 2600, d: 8600, x: 1240, y: 2700, z: czc(-4100, 8600), color: 0xb8bcc0 });    // R side
  await box({ w: 2480, h: 2600, d: 90, x: 0, y: 2700, z: czc(420, 90), color: 0xb8bcc0 });           // front wall
  await box({ w: 1230, h: 2600, d: 90, x: -620, y: 2700, z: czc(-8400, 90), color: 0xa6abb0 });      // rear door L
  await box({ w: 1230, h: 2600, d: 90, x: 620, y: 2700, z: czc(-8400, 90), color: 0xa6abb0 });       // rear door R
  await crown({ width: 2500, length: 8600, crownX: 90, crownZ: 25, thickness: 90, nu: 24, nv: 44, x: 0, y: 4010, z: czc(-4100, 8600), color: 0xc8ccd0 }); // crowned roof
  await capture('02-body');

  // ─── king-pin (mates the tractor fifth wheel) + landing gear ────────
  await box({ w: 900, h: 60, d: 900, x: 0, y: 1225, z: czc(150, 900), color: 0x3a3e44 });
  await cyl({ r: 70, d: 200, rx: 90, x: 0, y: 1050, z: 150, color: 0x2a2e34 });
  await box({ w: 130, h: 820, d: 130, x: -680, y: 870, z: czc(-1500, 130), color: 0x3a3e44 });        // landing leg L
  await box({ w: 130, h: 820, d: 130, x: 680, y: 870, z: czc(-1500, 130), color: 0x3a3e44 });         // landing leg R
  await capture('03-kingpin');

  // ─── tri-axle bogie — 3 beams + 6 tread-wrapped tyres on rims ───────
  for (const az of [-6000, -6900, -7800]) {
    await box({ w: 2000, h: 150, d: 170, x: 0, y: AXY, z: czc(az, 170), color: 0x26292e });
    for (const wx of [-1040, 1040]) {
      await cyl({ r: 286, d: 300, ry: 90, x: wx, y: AXY, z: az, color: 0x8a8d92 });
      await tire({ rimR: 286, outerR: 545, width: 360, treadCount: 26, treadDepth: 22, axis: 'X', x: wx, y: AXY, z: az, color: 0x141414 });
    }
  }
  await capture('04-bogie');

  // ─── rear: underrun bar + mud flaps + tail lights ──────────────────
  await box({ w: 2400, h: 130, d: 130, x: 0, y: 520, z: czc(-8520, 130), color: 0x26292e });          // underrun bar
  await box({ w: 420, h: 520, d: 40, x: -1060, y: 290, z: czc(-8150, 40), color: 0x16191c });          // mud flap L
  await box({ w: 420, h: 520, d: 40, x: 1060, y: 290, z: czc(-8150, 40), color: 0x16191c });           // mud flap R
  await box({ w: 200, h: 360, d: 90, x: -980, y: 760, z: czc(-8470, 90), color: 0x7a2a2a });           // tail light L
  await box({ w: 200, h: 360, d: 90, x: 980, y: 760, z: czc(-8470, 90), color: 0x7a2a2a });            // tail light R
  await capture('99-final');

  const n = await bodyCount();
  console.log(`SP-25 semi-trailer — bodies: ${n}`);
  // underframe(3) + body(6) + kingpin/landing(4) + bogie(3 beams+6 rims+6 tyres=15) + rear(5) = 33
  expect(n).toBeGreaterThanOrEqual(28);

  await app.close();
});
