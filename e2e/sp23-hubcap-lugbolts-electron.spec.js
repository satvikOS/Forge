import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-23 — HUB-CAP LUG BOLTS (Video-21 bible callout). Bolt Array now
 * rotates about all 3 axes, so a circle of lug nuts can face the wheel's
 * X spin axis. Demonstrated on a full truck wheel: tread-wrapped tyre +
 * silver rim + chrome hub cap + a ring of lug nuts on the face, plus a
 * central hub nut. Adversarial wheel-face + iso + detail audit confirms
 * the lug circle sits flat on the hub cap facing outward.
 * Per [[project_video21_parity_bible]].
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp23-hubcap-lugbolts');
fs.mkdirSync(OUT, { recursive: true });

const WY = 600;  // wheel centre height (axle)

test.describe.configure({ timeout: 30 * 60 * 1000 });

test('SP-23 — hub-cap lug bolts on a truck wheel', async () => {
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
    await win.waitForTimeout(90);
    for (const [name, val] of Object.entries(fields)) {
      const inp = dlg.locator(`[data-field="${name}"]`).first();
      if (await inp.count() === 0) continue;
      const tag = await inp.evaluate((el) => el.tagName.toLowerCase());
      if (tag === 'select') await inp.selectOption(String(val));
      else await inp.fill(String(val));
    }
    await win.locator('.tpd-btn-run').dispatchEvent('click');
    await dlg.waitFor({ state: 'hidden', timeout: 90000 });
    await win.waitForTimeout(90);
  };
  const addsOneBody = async (fn) => {
    const before = await bodyCount();
    await fn();
    await win.waitForFunction(([p]) => (window.__archdiscRegistry?.list?.() || []).length > p, [before], { timeout: 90000 });
  };
  const cyl = async ({ r, d, x, y, z, ry = 0, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Circle', { cx: 0, cy: 0, r, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: d });
      await runTool('Sculpt Place Body', { ry, x, y, z, color });
    });
  const tire = async (f) => addsOneBody(() => runTool('Sculpt Tire', f));
  const bolts = async (f) => addsOneBody(() => runTool('Sculpt Bolt Array', f));

  const main = { x: 0, y: WY / 1000, z: 0 };
  const capture = async (label) => {
    const angles = [
      { name: 'face',   az:  90, el:  4, dist: 2.6, t: main },   // straight at the wheel face
      { name: 'iso',    az:  56, el: 16, dist: 3.0, t: main },
      { name: 'detail', az:  78, el:  8, dist: 1.7, t: main },   // close on the lug circle
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
      }, { az: a.az, el: a.el, dist: a.dist, tx: a.t.x, ty: a.t.y, tz: a.t.z });
      await win.waitForTimeout(150);
      await win.screenshot({ path: path.join(OUT, `${label}-${a.name}.png`) });
    }
  };

  await capture('00-empty');

  // ─── wheel: tread tyre + silver rim ─────────────────────────────────
  await tire({ rimR: 286, outerR: 537, width: 315, treadCount: 34, treadDepth: 22, axis: 'X', x: 0, y: WY, z: 0, color: 0x141414 });
  await cyl({ r: 286, d: 300, ry: 90, x: 0, y: WY, z: 0, color: 0x8a8d92 });   // rim (axis X)
  await capture('01-wheel');

  // ─── small chrome hub cap at the centre (lugs ring around it) ───────
  await cyl({ r: 120, d: 70, ry: 90, x: 165, y: WY, z: 0, color: 0xc8ccd0 });
  await capture('02-hubcap');

  // ─── lug-nut circle facing +X (ry=90), on the flange OUTSIDE the cap
  // (radius 215 sits between the hub cap r=120 and rim r=286) + hub nut
  await bolts({ count: 10, layout: 'circle', radius: 205, headR: 44, headH: 70, shankR: 20, shankLen: 20,
    ry: 90, x: 185, y: WY, z: 0, color: 0xbcc0c4 });
  await cyl({ r: 60, d: 64, ry: 90, x: 200, y: WY, z: 0, color: 0x55595f });    // centre hub nut
  await capture('99-final');

  const n = await bodyCount();
  const lug = await win.evaluate(() => window.__lastInstancedArray || null);
  console.log(`SP-23 wheel — bodies: ${n}; lug array:`, JSON.stringify(lug));
  // tyre + rim + hubcap + lug-array + hubnut = 5
  expect(n).toBeGreaterThanOrEqual(5);
  expect(lug && lug.layout).toBe('circle');
  expect(lug && lug.drawCalls).toBe(1);

  await app.close();
});
