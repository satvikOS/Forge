import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-20 — STITCH / MERGE into a watertight body. The Class-A panels were
 * separate overlapping skins; Sculpt Merge Bodies boolean-unions them
 * into ONE sealed solid (exact — smooth surfaces preserved, no voxel
 * staircasing). Demonstrated on a cab shell: a flat floor + 4 walls + a
 * crowned roof, each sized to OVERLAP at the seams, welded into a single
 * watertight cab body, then zebra-checked to show reflection lines flow
 * across the whole shell (one continuous surface, no body-boundary seam).
 *
 * Per [[feedback_omni_coherence_law]] + [[feedback_fully_sophisticated]].
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp20-merge-watertight-cab');
fs.mkdirSync(OUT, { recursive: true });

// X side-to-side, Y up (ground 0), Z front(+)→rear(−). Cab depth 2480.
const MZ = -1100, HALF = 1200;
// boxes build at local z∈[0,d]; centre a long box with z = centre − d/2.
const czc = (centerZ, d) => centerZ - d / 2;

test.describe.configure({ timeout: 30 * 60 * 1000 });

test('SP-20 — merge overlapping skins into a watertight cab body', async () => {
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
  const box = async ({ w, h, d, x, y, z, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Rectangle', { cx: 0, cy: 0, w, h, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: d });
      await runTool('Sculpt Place Body', { x, y, z, color });
    });
  const crown = async (f) => addsOneBody(() => runTool('Sculpt Crown Panel', f));

  const tgt = { x: 0, y: 1.85, z: -1.1 };
  const capture = async (label) => {
    const angles = [
      { name: 'iso',   az:  40, el: 17, dist: 7.4 },
      { name: 'front', az:   2, el:  9, dist: 6.6 },
      { name: 'side',  az:  90, el:  9, dist: 7.4 },
      { name: 'top',   az:  18, el: 54, dist: 7.4 },
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
      await win.waitForTimeout(150);
      await win.screenshot({ path: path.join(OUT, `${label}-${a.name}.png`) });
    }
  };

  await capture('00-empty');

  // ─── cab shell — 6 panels sized to OVERLAP at every seam ────────────
  await box({ w: 2480, h: 110, d: 2480, x: 0, y: 965, z: czc(MZ, 2480), color: 0x2c4d6a });          // floor
  await box({ w: 110, h: 1880, d: 2480, x: -HALF, y: 1860, z: czc(MZ, 2480), color: 0x33597a });     // left wall
  await box({ w: 110, h: 1880, d: 2480, x: HALF, y: 1860, z: czc(MZ, 2480), color: 0x33597a });      // right wall
  await box({ w: 2480, h: 1880, d: 110, x: 0, y: 1860, z: czc(-2250, 110), color: 0x33597a });       // rear wall
  await box({ w: 2480, h: 1880, d: 110, x: 0, y: 1860, z: czc(40, 110), color: 0x33597a });          // front wall
  // crowned roof — overlaps the wall tops (Class-A doubly-curved skin)
  await crown({ width: 2480, length: 2480, crownX: 150, crownZ: 100, thickness: 120,
    nu: 32, nv: 28, x: 0, y: 2640, z: czc(MZ, 2480), color: 0x2c4d6a });
  await capture('01-shell');

  const before = await bodyCount();
  console.log(`SP-20 — panels before merge: ${before}`);
  expect(before).toBe(6);

  // ─── MERGE — weld the 6 skins into ONE watertight solid ─────────────
  await runTool('Sculpt Merge Bodies', { color: 0x33597a });
  await win.waitForFunction(() => (window.__archdiscRegistry?.list?.() || []).length === 1, null, { timeout: 60000 });
  await capture('02-merged');

  const after = await bodyCount();
  const merge = await win.evaluate(() => window.__lastMerge || null);
  console.log(`SP-20 — bodies after merge: ${after}; merge:`, JSON.stringify(merge));
  expect(after).toBe(1);                       // 6 panels → 1 sealed body
  expect(merge && merge.mergedCount).toBe(6);
  expect(merge.volume).toBeGreaterThan(0);

  // ─── zebra QC — stripes flow across the whole welded shell ──────────
  await runTool('Sculpt Zebra Check', { stripeFrequency: 22, direction: 'horizontal' });
  await capture('99-zebra');

  await app.close();
});
