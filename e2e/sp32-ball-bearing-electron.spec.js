import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-32 — BALL BEARING. Sculpt Bearing builds a rolling-element bearing
 * (outer race + inner race + a ring of balls at the pitch circle).
 * Demonstrated as a supported shaft (two bearings pressed onto a shaft)
 * plus a larger standalone bearing. Adversarial face / iso / detail audit
 * confirms the two races and the ball ring read correctly.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp32-ball-bearing');
fs.mkdirSync(OUT, { recursive: true });

const czc = (cz, d) => cz - d / 2;
const SY = 420;   // shaft height

test.describe.configure({ timeout: 30 * 60 * 1000 });

test('SP-32 — ball bearing on a shaft', async () => {
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
  const bearing = async (f) => addsOneBody(() => runTool('Sculpt Bearing', f));

  const tgt = { x: 0.2, y: SY / 1000, z: 0 };
  const capture = async (label) => {
    const angles = [
      { name: 'face',   az:   4, el:  8, dist: 2.7 },
      { name: 'iso',    az:  36, el: 18, dist: 3.0 },
      { name: 'detail', az:  26, el: 12, dist: 1.6, t: { x: 0.55, y: SY / 1000, z: 0 } },
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

  // ─── supported shaft: shaft (axis Z) + 2 bearings pressed on ────────
  await cyl({ r: 78, d: 900, x: 0, y: SY, z: czc(0, 900), color: 0x55595f });
  await capture('01-shaft');
  await bearing({ boreR: 80, outerR: 165, width: 95, balls: 11, x: 0, y: SY, z: -300, color: 0x9aa0a6 });
  await bearing({ boreR: 80, outerR: 165, width: 95, balls: 11, x: 0, y: SY, z: 205, color: 0x9aa0a6 });
  await capture('02-bearings');

  // ─── larger standalone bearing (more balls) ─────────────────────────
  await bearing({ boreR: 120, outerR: 250, width: 130, balls: 15, x: 560, y: SY, z: 0, color: 0xb9bcc1 });
  await capture('99-final');

  const n = await bodyCount();
  console.log(`SP-32 ball bearing — bodies: ${n}`);
  expect(n).toBeGreaterThanOrEqual(4);

  const vols = await win.evaluate(() => {
    const list = window.__archdiscRegistry?.list?.() || [];
    return list.map(b => { try { return Math.round(b.manifold?.volume?.() ?? 0); } catch { return 0; } });
  });
  console.log('SP-32 body volumes:', JSON.stringify(vols));
  expect(vols.filter(v => v > 1e6).length).toBeGreaterThanOrEqual(3);   // 3 bearings (+ shaft)

  await app.close();
});
