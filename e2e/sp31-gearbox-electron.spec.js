import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-31 — GEARBOX assembly. Puts the Sculpt Gear primitive into a real
 * coherent machinery: an open housing (base + back + side walls) carrying
 * a meshing 2-gear pair (18T input + 30T output, module 10, centre
 * distance 240 = m(z1+z2)/2) on shafts that run through bearing bosses in
 * the back wall. Composition of Sculpt Gear + Circle/Extrude + boxes.
 * Adversarial front / iso / side audit of the transmission.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp31-gearbox');
fs.mkdirSync(OUT, { recursive: true });

const czc = (cz, d) => cz - d / 2;
const M = 10, ZA = 18, ZB = 30, CD = M * (ZA + ZB) / 2;   // 240
const AY = 560, BY = AY - CD, GX = -40;                    // gears stacked, input top

test.describe.configure({ timeout: 30 * 60 * 1000 });

test('SP-31 — gearbox (meshing pair in a housing)', async () => {
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
  const box = async ({ w, h, d, x, y, z, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Rectangle', { cx: 0, cy: 0, w, h, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: d });
      await runTool('Sculpt Place Body', { x, y, z, color });
    });
  const cyl = async ({ r, d, x, y, z, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Circle', { cx: 0, cy: 0, r, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: d });
      await runTool('Sculpt Place Body', { x, y, z, color });
    });
  const gear = async (f) => addsOneBody(() => runTool('Sculpt Gear', f));

  const tgt = { x: 0, y: AY / 1000 - 0.12, z: -0.15 };
  const capture = async (label) => {
    const angles = [
      { name: 'front', az:   3, el:  6, dist: 3.4 },
      { name: 'iso',   az:  34, el: 18, dist: 3.8 },
      { name: 'side',  az:  84, el: 10, dist: 3.6 },
    ];
    for (const a of angles) {
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
      }, { ...a, tx: tgt.x, ty: tgt.y, tz: tgt.z });
      await win.waitForTimeout(150);
      await win.screenshot({ path: path.join(OUT, `${label}-${a.name}.png`) });
    }
  };

  await capture('00-empty');

  // ─── housing: base + back wall + 2 side walls (open top + front) ────
  await box({ w: 820, h: 90, d: 720, x: 0, y: 45, z: czc(-80, 720), color: 0x3a3e44 });
  await box({ w: 820, h: 760, d: 80, x: 0, y: 470, z: czc(-400, 80), color: 0x3a3e44 });
  await box({ w: 80, h: 680, d: 640, x: -410, y: 470, z: czc(-120, 640), color: 0x33373c });
  await box({ w: 80, h: 680, d: 640, x: 410, y: 470, z: czc(-120, 640), color: 0x33373c });
  await capture('01-housing');

  // ─── meshing gear pair (input 18T top, output 30T below) ────────────
  await gear({ module: M, teeth: ZA, thickness: 140, boreR: 56, x: GX, y: AY, z: -150, color: 0x9aa0a6 });
  await gear({ module: M, teeth: ZB, thickness: 140, boreR: 70, rz: 180 / ZB, x: GX, y: BY, z: -150, color: 0x8a8d92 });
  await capture('02-gears');

  // ─── shafts through the bores + bearing bosses at the back wall ─────
  await cyl({ r: 54, d: 520, x: GX, y: AY, z: -400, color: 0x55595f });   // input shaft (protrudes front)
  await cyl({ r: 68, d: 520, x: GX, y: BY, z: -400, color: 0x55595f });   // output shaft
  await cyl({ r: 92, d: 70, x: GX, y: AY, z: -430, color: 0x6a6f76 });    // input bearing boss
  await cyl({ r: 104, d: 70, x: GX, y: BY, z: -430, color: 0x6a6f76 });   // output bearing boss
  await capture('99-final');

  const n = await bodyCount();
  console.log(`SP-31 gearbox — bodies: ${n}; centre distance = ${CD} mm`);
  expect(n).toBeGreaterThanOrEqual(8);

  await app.close();
});
