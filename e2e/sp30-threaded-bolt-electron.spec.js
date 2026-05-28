import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-30 — THREADED ROD / BOLT. Sculpt Thread builds a real single-start
 * helical V-thread. Demonstrated as a hex bolt (hex head + threaded
 * shank), a long lead screw, and a threaded stud — showing the thread
 * helix is continuous and parametric. Adversarial iso / side / detail
 * audit checks the thread spirals cleanly with even pitch.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp30-threaded-bolt');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 30 * 60 * 1000 });

test('SP-30 — threaded bolt + lead screw', async () => {
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
  const thread = async (f) => addsOneBody(() => runTool('Sculpt Thread', f));
  const hexHead = async ({ r, h, x, y, z, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Polygon', { cx: 0, cy: 0, r, n: 6, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: h });
      await runTool('Sculpt Place Body', { rx: -90, x, y, z, color });   // hex prism axis +Y
    });

  const tgt = { x: 0, y: 0.33, z: 0 };
  const capture = async (label) => {
    const angles = [
      { name: 'iso',    az:  34, el: 14, dist: 2.4 },
      { name: 'side',   az:  90, el:  4, dist: 2.2 },
      { name: 'detail', az:  18, el:  8, dist: 1.25 },
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

  // ─── hex bolt: threaded shank (y 0..480) + hex head (y 480..580) ────
  await thread({ length: 480, majorR: 70, pitch: 60, threadDepth: 16, sides: 56, x: 0, y: 0, z: 0, color: 0x9aa0a6 });
  await hexHead({ r: 105, h: 100, x: 0, y: 480, z: 0, color: 0x8a8d92 });
  await capture('01-bolt');

  // ─── lead screw (long, finer pitch) + threaded stud (no head) ───────
  await thread({ length: 760, majorR: 55, pitch: 42, threadDepth: 12, sides: 56, x: 520, y: 0, z: 0, color: 0xb9bcc1 });
  await thread({ length: 420, majorR: 48, pitch: 70, threadDepth: 16, sides: 48, x: -480, y: 0, z: 0, color: 0x9aa0a6 });
  await capture('99-final');

  const n = await bodyCount();
  console.log(`SP-30 threaded bolt — bodies: ${n}`);
  expect(n).toBeGreaterThanOrEqual(4);

  const vols = await win.evaluate(() => {
    const list = window.__archdiscRegistry?.list?.() || [];
    return list.map(b => { try { return Math.round(b.manifold?.volume?.() ?? 0); } catch { return 0; } });
  });
  console.log('SP-30 body volumes:', JSON.stringify(vols));
  expect(vols.filter(v => v > 1e5).length).toBeGreaterThanOrEqual(4);

  await app.close();
});
