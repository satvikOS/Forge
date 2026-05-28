import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-28 — SPUR GEAR + meshing gear pair. Sculpt Gear builds a parametric
 * spur gear (module / teeth / bore). Demonstrated as a meshing pair: a
 * 30-tooth driver and an 18-tooth pinion, same module 10, set at the
 * standard centre distance m·(z1+z2)/2 = 240 mm, the pinion phase-shifted
 * half a tooth so its teeth sit in the driver's gaps — on shafts, over a
 * mounting plate. Adversarial face / iso / detail audit checks the teeth
 * MESH (interleave) rather than clash. Mechanical-CAD primitive.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp28-gear-pair');
fs.mkdirSync(OUT, { recursive: true });

const GY = 850;        // gear-axis height
const M = 10, ZA = 30, ZB = 18;
const CD = M * (ZA + ZB) / 2;   // centre distance = 240

test.describe.configure({ timeout: 30 * 60 * 1000 });

test('SP-28 — spur gear meshing pair', async () => {
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
  const cyl = async ({ r, d, x, y, z, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Circle', { cx: 0, cy: 0, r, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: d });
      await runTool('Sculpt Place Body', { x, y, z, color });
    });
  const gear = async (f) => addsOneBody(() => runTool('Sculpt Gear', f));

  const tgt = { x: CD / 2 / 1000, y: GY / 1000, z: 0 };
  const capture = async (label) => {
    const angles = [
      { name: 'face',   az:   2, el:  6, dist: 1.45 },  // down the axis: see meshing teeth
      { name: 'iso',    az:  34, el: 22, dist: 1.7 },
      { name: 'detail', az:   6, el:  8, dist: 0.95, t: { x: CD / 1000 * 0.55, y: GY / 1000, z: 0 } }, // mesh point
    ];
    for (const a of angles) {
      const t = a.t || tgt;
      await win.evaluate(({ az, el, dist, tx, ty, tz }) => {
        const vp = window.__archdiscViewport;
        if (!vp?.camera) return;
        if (vp.orbitControls) { vp.orbitControls.maxDistance = 2000; vp.orbitControls.minDistance = 0.02; }
        const azR = az * Math.PI / 180, elR = el * Math.PI / 180;
        vp.camera.position.set(
          tx + dist * Math.cos(elR) * Math.sin(azR),
          ty + dist * Math.sin(elR),
          tz + dist * Math.cos(elR) * Math.cos(azR));
        vp.orbitControls.target.set(tx, ty, tz);
        vp.camera.lookAt(tx, ty, tz);
        vp.orbitControls.update();
        vp.renderer.render(vp.scene, vp.camera);
      }, { az: a.az, el: a.el, dist: a.dist, tx: t.x, ty: t.y, tz: t.z });
      await win.waitForTimeout(150);
      await win.screenshot({ path: path.join(OUT, `${label}-${a.name}.png`) });
    }
  };

  await capture('00-empty');

  // ─── mounting plate (context) ───────────────────────────────────────
  await cyl({ r: 40, d: 40, x: 0, y: GY, z: -260, color: 0x33373c });   // (small standoff hint)
  // ─── driver gear (z=30) + pinion (z=18), meshing at CD=240 ──────────
  await gear({ module: M, teeth: ZA, thickness: 140, boreR: 70, x: 0, y: GY, z: 0, color: 0x8a8d92 });
  // pinion phase-shifted half a tooth (180/z) so teeth sit in the driver's gaps
  await gear({ module: M, teeth: ZB, thickness: 140, boreR: 50, rz: 180 / ZB, x: CD, y: GY, z: 0, color: 0x9aa0a6 });
  await capture('01-gears');

  // ─── shafts through the bores ───────────────────────────────────────
  await cyl({ r: 66, d: 360, x: 0, y: GY, z: -110, color: 0x55595f });
  await cyl({ r: 46, d: 360, x: CD, y: GY, z: -110, color: 0x55595f });
  await capture('99-final');

  const n = await bodyCount();
  console.log(`SP-28 gear pair — bodies: ${n}; centre distance = ${CD} mm`);
  expect(n).toBeGreaterThanOrEqual(4);

  // both gears are real solids with volume
  const vols = await win.evaluate(() => {
    const list = window.__archdiscRegistry?.list?.() || [];
    return list.map(b => { try { return b.manifold?.volume?.() ?? 0; } catch { return 0; } });
  });
  console.log('SP-28 body volumes:', JSON.stringify(vols.map(v => Math.round(v))));
  expect(vols.filter(v => v > 1e6).length).toBeGreaterThanOrEqual(2);   // 2 gears

  await app.close();
});
