import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-21 — EDGE-BLEND FILLET. Merge (SP-20) welds panels but leaves the
 * junction sharp; this rounds it. Sculpt Edge Fillet runs a tangent-
 * continuous (G1) rolling-ball quarter-round along the shared edge with
 * an overlap lip, so a following Merge welds a smooth fillet into the
 * concave corner. Demonstrated on an L (a floor panel + a wall panel):
 * sharp inside corner → fillet → merge → one watertight body with a
 * rounded, tangent valley. Zebra QC confirms reflection lines cross the
 * fillet without a kink (G1). Per [[feedback_fully_sophisticated]].
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp21-edge-fillet');
fs.mkdirSync(OUT, { recursive: true });

// X side-to-side, Y up, Z along the edge. Floor top y=1020; wall right
// face x=-720; concave valley edge at (-720, 1020) opening +X+Y.
test.describe.configure({ timeout: 30 * 60 * 1000 });

test('SP-21 — edge-blend fillet welded into an L-junction', async () => {
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

  const main = { x: -0.32, y: 1.5, z: 0 };
  const capture = async (label) => {
    const angles = [
      { name: 'front',  az:   2, el:  4, dist: 4.6, t: main },                 // L cross-section + corner
      { name: 'iso',    az:  40, el: 20, dist: 5.0, t: main },
      { name: 'detail', az:  18, el:  8, dist: 2.2, t: { x: -0.62, y: 1.08, z: 0 } }, // close on the fillet
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

  // ─── L-junction: floor panel + wall panel (sharp inside corner) ─────
  await box({ w: 1800, h: 200, d: 1400, x: 0, y: 920, z: -700, color: 0x33597a });     // floor (top y=1020)
  await box({ w: 180, h: 1300, d: 1400, x: -810, y: 1670, z: -700, color: 0x33597a }); // wall (right face x=-720)
  await capture('01-sharp');

  // ─── edge fillet in the concave valley (edge along Z at (-720,1020)) ─
  await runTool('Sculpt Edge Fillet', { radius: 120, length: 1400, segments: 30, axis: 'Z', quadrant: '0', x: -720, y: 1020, z: -700, color: 0x4ebec0 });
  await win.waitForFunction(() => (window.__archdiscRegistry?.list?.() || []).length === 3, null, { timeout: 60000 });
  await capture('02-fillet');

  // ─── merge → one watertight body with the rounded valley ───────────
  await runTool('Sculpt Merge Bodies', { color: 0x33597a });
  await win.waitForFunction(() => (window.__archdiscRegistry?.list?.() || []).length === 1, null, { timeout: 60000 });
  await capture('03-merged');

  const after = await bodyCount();
  const merge = await win.evaluate(() => window.__lastMerge || null);
  console.log(`SP-21 — bodies after merge: ${after}; merge:`, JSON.stringify(merge));
  expect(after).toBe(1);
  expect(merge && merge.mergedCount).toBe(3);   // floor + wall + fillet

  // ─── zebra — reflection lines cross the fillet without a kink (G1) ──
  await runTool('Sculpt Zebra Check', { stripeFrequency: 24, direction: 'horizontal' });
  await capture('99-zebra');

  await app.close();
});
