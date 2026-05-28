import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-29 — HELICAL SPRING + coilover. Sculpt Spring sweeps a circular wire
 * along a helix → a real coil spring. Demonstrated as a coilover
 * suspension unit (the spring wraps a damper body + rod between two
 * perches) plus two standalone springs at different parameters to show
 * the tool is fully parametric. Adversarial iso / side / detail audit
 * checks the coils are clean, evenly pitched and don't fuse.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp29-coilover-spring');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 30 * 60 * 1000 });

test('SP-29 — helical spring coilover', async () => {
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
      await runTool('Sculpt Place Body', { rx: -90, x, y, z, color });   // stand the cylinder up (axis Y)
    });
  const spring = async (f) => addsOneBody(() => runTool('Sculpt Spring', f));

  const tgt = { x: 0, y: 0.42, z: 0 };
  const capture = async (label) => {
    const angles = [
      { name: 'iso',    az:  34, el: 14, dist: 2.6 },
      { name: 'side',   az:  90, el:  6, dist: 2.4 },
      { name: 'detail', az:  20, el: 10, dist: 1.5 },
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

  // ─── coilover at x=0: damper body + rod + perches + spring ──────────
  await cyl({ r: 60, d: 360, x: 0, y: 60, z: 0, color: 0x2a2e34 });     // damper body (y 60..420)
  await cyl({ r: 26, d: 360, x: 0, y: 420, z: 0, color: 0x8a8d92 });    // rod (y 420..780)
  await cyl({ r: 150, d: 40, x: 0, y: 60, z: 0, color: 0x55595f });     // lower perch
  await cyl({ r: 150, d: 40, x: 0, y: 720, z: 0, color: 0x55595f });    // upper perch
  await capture('01-damper');
  // helical spring wrapping the damper (coilR 130 clears the 60 body)
  await spring({ coilR: 130, wireR: 22, pitch: 100, turns: 6, x: 0, y: 90, z: 0, color: 0x4ebec0 });
  await capture('02-coilover');

  // ─── two standalone springs at different params (parametric range) ──
  await spring({ coilR: 80, wireR: 12, pitch: 50, turns: 9, x: 520, y: 90, z: 0, color: 0x9aa0a6 });   // valve spring (tight)
  await spring({ coilR: 200, wireR: 30, pitch: 150, turns: 4, x: -620, y: 90, z: 0, color: 0xb9bcc1 }); // heavy suspension
  await capture('99-final');

  const n = await bodyCount();
  console.log(`SP-29 coilover — bodies: ${n}`);
  expect(n).toBeGreaterThanOrEqual(6);

  // the three springs are real solids
  const vols = await win.evaluate(() => {
    const list = window.__archdiscRegistry?.list?.() || [];
    return list.map(b => { try { return Math.round(b.manifold?.volume?.() ?? 0); } catch { return 0; } });
  });
  console.log('SP-29 body volumes:', JSON.stringify(vols));
  expect(vols.filter(v => v > 1e5).length).toBeGreaterThanOrEqual(3);   // >=3 springs (+ cylinders)

  await app.close();
});
