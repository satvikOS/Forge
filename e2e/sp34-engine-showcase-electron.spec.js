import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-34 — DETAILED ENGINE, the grand consolidation showcasing the whole
 * mechanical-primitive library in ONE coherent machine, built through the
 * ribbon: a crankshaft on two ball BEARINGS (mains), 4 pistons on rods
 * (crank-phase staggered, index-driven), a bedplate + head deck, 4 helical
 * valve SPRINGS on the head, and a CAMSHAFT carrying 4 phased CAMS on top.
 *
 * Composes Sculpt Bearing (SP-32) + Spring (SP-29) + Cam (SP-33) + the
 * piston/crank primitives in a real engine. Side / iso / top audit.
 * Per [[feedback_fully_sophisticated]] + [[feedback_studio_no_randomness]].
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp34-engine-showcase');
fs.mkdirSync(OUT, { recursive: true });

const czc = (cz, d) => cz - d / 2;
const N = 4, BORE = 280, FIRSTZ = -200;
const cylZ = (i) => FIRSTZ - i * BORE;          // -200,-480,-760,-1040
const MIDZ = cylZ((N - 1) / 2);                 // -620
const CRANKY = 140;

test.describe.configure({ timeout: 40 * 60 * 1000 });

test('SP-34 — detailed engine (bearings + springs + cams + pistons)', async () => {
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
    await dlg.waitFor({ state: 'hidden', timeout: 90000 });
    await win.waitForTimeout(70);
  };
  const addsOneBody = async (fn) => {
    const before = await bodyCount();
    await fn();
    await win.waitForFunction(([p]) => (window.__archdiscRegistry?.list?.() || []).length > p, [before], { timeout: 90000 });
  };
  const box = async ({ w, h, d, x, y, z, rx = 0, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Rectangle', { cx: 0, cy: 0, w, h, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: d });
      await runTool('Sculpt Place Body', { rx, x, y, z, color });
    });
  const cyl = async ({ r, d, x, y, z, rx = 0, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Circle', { cx: 0, cy: 0, r, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: d });
      await runTool('Sculpt Place Body', { rx, x, y, z, color });
    });
  const bearing = async (f) => addsOneBody(() => runTool('Sculpt Bearing', f));
  const spring = async (f) => addsOneBody(() => runTool('Sculpt Spring', f));
  const cam = async (f) => addsOneBody(() => runTool('Sculpt Cam', f));

  const tgt = { x: 0, y: 0.6, z: MIDZ / 1000 };
  const capture = async (label) => {
    const angles = [
      { name: 'side', az:  90, el:  8, dist: 5.2 },
      { name: 'iso',  az:  40, el: 18, dist: 5.6 },
      { name: 'top',  az:  16, el: 56, dist: 5.6 },
    ];
    for (const a of angles) {
      await win.evaluate(({ az, el, dist, tx, ty, tz }) => {
        const vp = window.__archdiscViewport;
        if (!vp?.camera) return;
        if (vp.orbitControls) { vp.orbitControls.maxDistance = 2000; vp.orbitControls.minDistance = 0.05; }
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

  // ─── bedplate + crankshaft on 2 main bearings + counterweights ──────
  await box({ w: 440, h: 170, d: 1320, x: 0, y: 85, z: czc(MIDZ, 1320), color: 0x55595f });
  await cyl({ r: 62, d: 1340, x: 0, y: CRANKY, z: czc(MIDZ, 1340), color: 0x60656c });   // crank (axis Z)
  for (let i = 0; i < N; i++) await cyl({ r: 120, d: 44, x: 0, y: CRANKY, z: cylZ(i) - 22, color: 0x4f535a });
  await bearing({ boreR: 66, outerR: 150, width: 80, balls: 9, x: 0, y: CRANKY, z: cylZ(0) + 140 - 40, color: 0x9aa0a6 });
  await bearing({ boreR: 66, outerR: 150, width: 80, balls: 9, x: 0, y: CRANKY, z: cylZ(N - 1) - 140 - 40, color: 0x9aa0a6 });
  await capture('01-crank');

  // ─── pistons (crank-phase staggered, θ=i·90°) + rods ────────────────
  const crownY = (i) => 560 + 150 * Math.sin((i * 90) * Math.PI / 180);
  for (let i = 0; i < N; i++) {
    const cyv = crownY(i);
    await cyl({ r: 100, d: 170, rx: 90, x: 0, y: cyv + 85, z: cylZ(i), color: 0x9398a0 });
    const rc = (CRANKY + cyv) / 2, rh = (cyv - CRANKY) + 170;
    await box({ w: 46, h: rh, d: 78, x: 0, y: rc, z: cylZ(i) - 39, color: 0x70757c });
  }
  await capture('02-pistons');

  // ─── head deck + 4 helical valve springs (axis +Y) ──────────────────
  await box({ w: 470, h: 150, d: 1320, x: 0, y: 830, z: czc(MIDZ, 1320), color: 0x5f636a });
  for (let i = 0; i < N; i++) await spring({ coilR: 58, wireR: 11, pitch: 42, turns: 5, x: 0, y: 905, z: cylZ(i), color: 0x4ebec0 });
  await capture('03-valvetrain');

  // ─── camshaft + 4 phased cams on top ────────────────────────────────
  await cyl({ r: 44, d: 1320, x: 0, y: 1230, z: czc(MIDZ, 1320), color: 0x60656c });
  for (let i = 0; i < N; i++) await cam({ baseR: 88, lift: 46, noseCenter: i * 90, noseWidth: 120, thickness: 80, boreR: 46, x: 0, y: 1230, z: cylZ(i), color: 0x6a6f76 });
  await capture('99-final');

  const n = await bodyCount();
  console.log(`SP-34 engine showcase — bodies: ${n}`);
  // bedplate + crank + 4 cw + 2 bearings + 4 pistons + 4 rods + head
  // + 4 springs + camshaft + 4 cams = 25
  expect(n).toBeGreaterThanOrEqual(22);

  await app.close();
});
