import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-13 / SP-14 / SP-15 — instanced fastener sub-assembly, built through
 * the Sculpt ribbon. One coherent Volvo FH fifth-wheel mounting plate:
 *
 *   SP-15 InstancedMesh — Sculpt Bolt Array stamps one sculpted hex bolt
 *         240× (grid) + 36× (circle) into TWO THREE.InstancedMesh groups,
 *         ONE draw call each (276 fasteners total, ~2 draw calls).
 *   SP-14 PBR materials — bolts use MeshStandardMaterial (metalness 0.72,
 *         roughness 0.34); every sculpted body already renders PBR via
 *         manifoldToMesh.
 *   SP-13 sub-assembly hierarchy — each array is a named group flagged
 *         userData.subAssembly.
 *
 * 240+ instanced components in one op finally satisfies the ≥200-component
 * machinery bar via the platform. Index-driven layouts (no randomness).
 * Per [[feedback_studio_no_randomness]] + [[feedback_omni_coherence_law]].
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp13-15-instanced-fasteners');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 30 * 60 * 1000 });

test('SP-13/14/15 — instanced bolted fifth-wheel plate (Sculpt Bolt Array)', async () => {
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
  const sculptBox = async ({ w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Rectangle', { cx: 0, cy: 0, w, h, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: d });
      await runTool('Sculpt Place Body', { rx, ry, rz, x, y, z, color });
    });
  const sculptCylinder = async ({ r, d, x, y, z, rx = 0, ry = 0, rz = 0, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Circle', { cx: 0, cy: 0, r, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: d });
      await runTool('Sculpt Place Body', { rx, ry, rz, x, y, z, color });
    });
  const boltArray = async (f) => addsOneBody(() => runTool('Sculpt Bolt Array', f));

  const tgt = { x: 0, y: 0.66, z: 0.0 };
  const captureAngles = async (label) => {
    const angles = [
      { name: 'front',  az:   0, el:  4, dist: 3.6 },   // the bolt grid face (hero)
      { name: 'iso',    az:  34, el: 18, dist: 4.0 },
      { name: 'detail', az:  22, el: 10, dist: 2.4 },   // close on the heads (PBR specular)
      { name: 'side',   az:  78, el:  8, dist: 3.8 },   // shanks proud of the plate
      { name: 'top',    az:  14, el: 54, dist: 4.0 },
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
      await win.waitForTimeout(140);
      await win.screenshot({ path: path.join(OUT, `${label}-${a.name}.png`) });
    }
  };

  await captureAngles('00-empty');

  // ─── fifth-wheel mounting plate (vertical splice) + king-pin flange ──
  await sculptBox({ w: 1500, h: 900, d: 45, x: 0, y: 800, z: -45, color: 0x44484e });   // plate, front face z=0
  await sculptCylinder({ r: 280, d: 70, x: 0, y: 180, z: -70, color: 0x3e4248 });        // king-pin flange (axis Z)
  await captureAngles('01-structure');

  // ─── SP-15 hero — 240-bolt instanced grid on the plate (1 draw call) ─
  await boltArray({ count: 240, layout: 'grid', spacing: 78, headR: 17, headH: 13, shankR: 9, shankLen: 40,
    x: 0, y: 800, z: 6, color: 0x9aa0a6 });
  await captureAngles('02-grid');

  // ─── circular bolt circle on the king-pin flange (1 draw call) ───────
  await boltArray({ count: 36, layout: 'circle', radius: 215, headR: 15, headH: 12, shankR: 8, shankLen: 34,
    x: 0, y: 180, z: 8, color: 0x9aa0a6 });
  await captureAngles('99-final');

  // ── verify SP-13/14/15 invariants from the live scene ────────────────
  const lastArray = await win.evaluate(() => window.__lastInstancedArray || null);
  console.log('SP-13/14/15 last instanced array:', JSON.stringify(lastArray));
  expect(lastArray).toBeTruthy();
  expect(lastArray.drawCalls).toBe(1);                       // SP-15 one draw call per array
  expect(lastArray.name).toBeTruthy();                        // SP-13 named sub-assembly

  // confirm an InstancedMesh with PBR material is actually in the scene
  const sceneStats = await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    let instanced = 0, pbr = 0, maxCount = 0;
    vp.scene.traverse((o) => {
      if (o.isInstancedMesh) {
        instanced++;
        maxCount = Math.max(maxCount, o.count);
        const m = Array.isArray(o.material) ? o.material[0] : o.material;
        if (m && m.isMeshStandardMaterial && typeof m.metalness === 'number') pbr++;
      }
    });
    return { instanced, pbr, maxCount };
  });
  console.log('SP-13/14/15 scene stats:', JSON.stringify(sceneStats));
  expect(sceneStats.instanced).toBeGreaterThanOrEqual(2);     // SP-15 grid + circle arrays
  expect(sceneStats.pbr).toBeGreaterThanOrEqual(2);           // SP-14 PBR metal material
  expect(sceneStats.maxCount).toBeGreaterThanOrEqual(240);    // 240 instanced fasteners

  const finalCount = await bodyCount();
  console.log(`SP-13/14/15 — registered bodies: ${finalCount}, instanced fasteners: 276`);
  expect(finalCount).toBeGreaterThanOrEqual(4);

  await app.close();
});
