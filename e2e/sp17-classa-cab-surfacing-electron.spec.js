import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-17 — Class-A SURFACING on the Volvo FH cab, sculpted through the
 * ribbon. The previous cab was flat extruded boxes; this builds the
 * smooth, doubly-curved exterior skins a Class-A modeller produces:
 *
 *   Sculpt Crown Panel — doubly-curved roof + windshield surround +
 *                        curved door skins (parabolic crown both ways)
 *   Sculpt Fender Arch — swept single-curvature wheel arches
 *   Sculpt Zebra Check — striped reflection-line overlay; smooth, evenly
 *                        flowing stripes confirm curvature continuity
 *
 * Adversarial audit looks for FACETING / staircasing (there should be
 * none — the crown is smooth) and for zebra stripes that flow without
 * kinks across each panel. Per [[feedback_e2e_all_angles]] +
 * [[feedback_fully_sophisticated]] + [[feedback_omni_coherence_law]].
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp17-classa-cab-surfacing');
fs.mkdirSync(OUT, { recursive: true });

// X side-to-side, Y up (ground 0), Z front(+)→rear(−).
const cabMidZ = -1100;

test.describe.configure({ timeout: 30 * 60 * 1000 });

test('SP-17 — Class-A cab surfacing (crown panels + fenders + zebra QC)', async () => {
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
  const crown = async (f) => addsOneBody(() => runTool('Sculpt Crown Panel', f));
  const fender = async (f) => addsOneBody(() => runTool('Sculpt Fender Arch', f));

  const tgt = { x: 0, y: 1.6, z: -1.0 };
  const capture = async (label) => {
    const angles = [
      { name: 'iso',   az:  40, el: 16, dist: 9.0 },
      { name: 'front', az:   3, el: 10, dist: 8.0 },
      { name: 'side',  az:  90, el:  9, dist: 9.0 },
      { name: 'top',   az:  16, el: 52, dist: 9.0 },
      { name: 'reardq',az: 145, el: 18, dist: 9.0 },
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

  // ─── crowned roof — doubly-curved (the Class-A hero) ─────────────────
  await crown({ width: 2350, length: 2500, crownX: 140, crownZ: 95, thickness: 50,
    nu: 34, nv: 30, x: 0, y: 2520, z: cabMidZ - 1250, color: 0x33597a });
  await capture('01-roof');

  // ─── sloped windshield surround (crowned, tilted up at the front) ────
  await crown({ width: 2300, length: 1500, crownX: 90, crownZ: 60, thickness: 45,
    nu: 30, nv: 22, rx: -58, x: 0, y: 1640, z: 360, color: 0x2c4d6a });
  await capture('02-windshield');

  // ─── curved door skins (crowned, vertical, bulging outboard) ─────────
  // rz=+90: width→Y(height), length→Z(cab length), crown→ −X (left door)
  await crown({ width: 1500, length: 1500, crownX: 70, crownZ: 40, thickness: 42,
    nu: 26, nv: 22, rz: 90, x: -1235, y: 1320, z: cabMidZ - 750, color: 0x33597a });
  // rz=−90 → crown bulges +X (right door)
  await crown({ width: 1500, length: 1500, crownX: 70, crownZ: 40, thickness: 42,
    nu: 26, nv: 22, rz: -90, x: 1235, y: 1320, z: cabMidZ - 750, color: 0x33597a });
  await capture('03-doors');

  // ─── front fender arches over the steer wheels (swept Class-A) ───────
  // fenderArch builds in X-Y (opening down); ry=90 turns it over an
  // X-axle wheel (arch now in the Z-Y plane on the cab side).
  await fender({ archRadius: 600, archSpan: 200, width: 440, section: 150, thickness: 36,
    ry: 90, x: -1180, y: 560, z: 120, color: 0x2c4d6a });
  await fender({ archRadius: 600, archSpan: 200, width: 440, section: 150, thickness: 36,
    ry: 90, x: 1180, y: 560, z: 120, color: 0x2c4d6a });
  await capture('04-fenders');

  const builtCount = await bodyCount();
  console.log(`SP-17 Class-A cab — bodies before zebra: ${builtCount}`);
  expect(builtCount).toBeGreaterThanOrEqual(5);

  // ─── Zebra Check — overlay reflection lines (Class-A QC) ─────────────
  await runTool('Sculpt Zebra Check', { stripeFrequency: 20, direction: 'horizontal', sharpness: 0.85 });
  await capture('99-zebra');

  const zebra = await win.evaluate(() => window.__lastZebraCheck || null);
  console.log('SP-17 zebra check:', JSON.stringify(zebra));
  expect(zebra).toBeTruthy();
  expect(zebra.meshes).toBeGreaterThanOrEqual(5);   // striped every Class-A body

  // confirm a zebra ShaderMaterial is actually live in the scene
  const striped = await win.evaluate(() => {
    const vp = window.__archdiscViewport; let n = 0;
    vp.scene.traverse((o) => { if (o.isMesh && o.material?.userData?.archdiscZebra) n++; });
    return n;
  });
  console.log('SP-17 live zebra meshes:', striped);
  expect(striped).toBeGreaterThanOrEqual(5);

  await app.close();
});
