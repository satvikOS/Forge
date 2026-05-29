import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-33 — RADIAL CAM + camshaft. Sculpt Cam builds a disc cam with a
 * smooth raised-cosine nose (rise-dwell-fall). Demonstrated as a camshaft:
 * a shaft carrying three cams phased like engine cam timing, with a
 * follower roller riding the first lobe. Adversarial face / iso / side
 * audit confirms the cam lobe profile and the follower contact.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp33-camshaft');
fs.mkdirSync(OUT, { recursive: true });

const czc = (cz, d) => cz - d / 2;
const CY = 520;   // cam-axis height

test.describe.configure({ timeout: 30 * 60 * 1000 });

test('SP-33 — radial cam + camshaft', async () => {
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
  const cam = async (f) => addsOneBody(() => runTool('Sculpt Cam', f));

  const tgt = { x: 0, y: CY / 1000, z: 0 };
  const capture = async (label) => {
    const angles = [
      { name: 'face', az:   3, el:  6, dist: 3.0 },
      { name: 'iso',  az:  36, el: 18, dist: 3.2 },
      { name: 'side', az:  88, el: 10, dist: 3.0 },
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

  // ─── camshaft: shaft + 3 phased cams (nose at 90 / 210 / 330) ───────
  await cyl({ r: 40, d: 980, x: 0, y: CY, z: czc(0, 980), color: 0x55595f });
  await cam({ baseR: 110, lift: 65, noseCenter: 90, noseWidth: 120, thickness: 90, boreR: 42, x: 0, y: CY, z: -300, color: 0x6a6f76 });
  await cam({ baseR: 110, lift: 65, noseCenter: 210, noseWidth: 120, thickness: 90, boreR: 42, x: 0, y: CY, z: -45, color: 0x6a6f76 });
  await cam({ baseR: 110, lift: 65, noseCenter: 330, noseWidth: 120, thickness: 90, boreR: 42, x: 0, y: CY, z: 210, color: 0x6a6f76 });
  await capture('01-camshaft');

  // ─── follower roller riding cam 1's nose (nose points +Y, tip ~y+175)
  await cyl({ r: 46, d: 90, x: 0, y: CY + 110 + 65 + 46, z: -300, color: 0x9aa0a6 });   // roller on the lobe
  await cyl({ r: 22, d: 320, x: 0, y: CY + 110 + 65 + 46 + 200, z: -300, color: 0x33373c }); // pushrod up
  await capture('99-final');

  const n = await bodyCount();
  console.log(`SP-33 camshaft — bodies: ${n}`);
  expect(n).toBeGreaterThanOrEqual(5);

  const vols = await win.evaluate(() => {
    const list = window.__archdiscRegistry?.list?.() || [];
    return list.map(b => { try { return Math.round(b.manifold?.volume?.() ?? 0); } catch { return 0; } });
  });
  console.log('SP-33 body volumes:', JSON.stringify(vols));
  expect(vols.filter(v => v > 1e6).length).toBeGreaterThanOrEqual(3);   // 3 cams

  await app.close();
});
