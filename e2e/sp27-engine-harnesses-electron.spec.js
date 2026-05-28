import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-27 — ENGINE BAY HARNESSES + PLUMBING (final Video-21 bible callout:
 * "full powertrain — engine + harnesses + plumbing"). A detailed engine
 * (block / head / cam cover + accessories) wrapped in a routed web of
 * wiring-harness looms and coolant / oil / fuel hoses (Sculpt Pipe), plus
 * a corrugated air-intake hose (Sculpt Flex Pipe). Every line runs between
 * real component anchor points. Adversarial iso / front / top / detail
 * audit. Per [[project_video21_parity_bible]].
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp27-engine-harnesses');
fs.mkdirSync(OUT, { recursive: true });

const czc = (cz, d) => cz - d / 2;

test.describe.configure({ timeout: 30 * 60 * 1000 });

test('SP-27 — engine bay harnesses + plumbing', async () => {
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
  const box = async ({ w, h, d, x, y, z, rx = 0, ry = 0, rz = 0, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Rectangle', { cx: 0, cy: 0, w, h, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: d });
      await runTool('Sculpt Place Body', { rx, ry, rz, x, y, z, color });
    });
  const cyl = async ({ r, d, x, y, z, rx = 0, ry = 0, rz = 0, color }) =>
    addsOneBody(async () => {
      await runTool('Sculpt Circle', { cx: 0, cy: 0, r, plane: 'XY' });
      await runTool('Sculpt Extrude', { distance: d });
      await runTool('Sculpt Place Body', { rx, ry, rz, x, y, z, color });
    });
  const pipe = async (f) => addsOneBody(() => runTool('Sculpt Pipe', f));
  const flex = async (f) => addsOneBody(() => runTool('Sculpt Flex Pipe', f));
  const loft = async (f) => addsOneBody(() => runTool('Sculpt Loft', f));

  const tgt = { x: 0, y: 0.82, z: -0.15 };
  const capture = async (label) => {
    const angles = [
      { name: 'iso',    az:  38, el: 20, dist: 4.6 },
      { name: 'front',  az:   3, el: 10, dist: 4.0 },
      { name: 'top',    az:  16, el: 60, dist: 4.6 },
      { name: 'detail', az:  60, el: 16, dist: 2.7 },
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
      await win.waitForTimeout(140);
      await win.screenshot({ path: path.join(OUT, `${label}-${a.name}.png`) });
    }
  };

  await capture('00-empty');

  // ─── engine: block + head + cam cover ───────────────────────────────
  await box({ w: 720, h: 620, d: 1150, x: 0, y: 620, z: czc(-150, 1150), color: 0x53585f });
  await box({ w: 740, h: 180, d: 1150, x: 0, y: 1010, z: czc(-150, 1150), color: 0x5f636a });
  await box({ w: 650, h: 150, d: 1080, x: 0, y: 1170, z: czc(-150, 1100), color: 0x33597a });   // cam cover
  // ─── accessories (anchor points for the harness/plumbing) ───────────
  await box({ w: 180, h: 280, d: 900, x: 380, y: 1000, z: czc(-150, 900), color: 0x4a5a66 });    // intake manifold (+X)
  await cyl({ r: 110, d: 200, ry: 90, x: 470, y: 560, z: 250, color: 0x6a6f76 });                 // alternator (front-right)
  await cyl({ r: 120, d: 210, ry: 90, x: -470, y: 540, z: 250, color: 0x6a6f76 });                // AC compressor (front-left)
  await cyl({ r: 90, d: 170, ry: 90, x: -440, y: 820, z: 120, color: 0x6a6f76 });                 // power-steering pump
  await loft({ r1: 150, r2: 105, height: 200, rx: -90, x: -430, y: 700, z: -900, color: 0x6b5a4a }); // turbo turbine
  await loft({ r1: 105, r2: 150, height: 200, rx: -90, x: -430, y: 920, z: -900, color: 0x8a9098 }); // turbo compressor
  await box({ w: 150, h: 150, d: 150, x: 250, y: 1280, z: 420, color: 0x2a2e34 });                 // thermostat/coolant housing (front-top)
  await capture('01-engine');

  // ─── exhaust manifold: 4 primaries (−X) merging to the turbo ────────
  for (const cz of [200, -100, -400, -700]) {
    await pipe({ radius: 40, x1: -360, y1: 980, z1: cz, x2: -430, y2: 820, z2: -880, bend: -50, color: 0x6b5a4a });
  }
  await capture('02-exhaust');

  // ─── wiring-harness looms (thick dark Pipe runs over the engine) ────
  await pipe({ radius: 42, x1: 280, y1: 1270, z1: 400, x2: 280, y2: 1270, z2: -650, bend: 60, color: 0x16191c });   // main loom along cam cover top
  await pipe({ radius: 30, x1: 280, y1: 1250, z1: 250, x2: 470, y2: 620, z2: 250, bend: -120, color: 0x16191c });   // branch → alternator
  await pipe({ radius: 28, x1: 280, y1: 1250, z1: 120, x2: -440, y2: 860, z2: 120, bend: 140, color: 0x16191c });   // branch → PS pump / left
  await pipe({ radius: 26, x1: 280, y1: 1260, z1: -650, x2: -430, y2: 940, z2: -880, bend: -120, color: 0x16191c }); // branch → turbo sensors
  await capture('03-harness');

  // ─── plumbing: coolant + oil + fuel hoses (Sculpt Pipe) ─────────────
  await pipe({ radius: 50, x1: 250, y1: 1280, z1: 420, x2: 620, y2: 900, z2: 500, bend: 180, color: 0x222426 });    // coolant upper → radiator (black)
  await pipe({ radius: 52, x1: 300, y1: 520, z1: 500, x2: 640, y2: 360, z2: 450, bend: 160, color: 0x222426 });     // coolant lower
  await pipe({ radius: 22, x1: 360, y1: 480, z1: 200, x2: 470, y2: 470, z2: 280, bend: 40, color: 0xb9bcc1 });      // oil line → cooler (metal)
  await pipe({ radius: 18, x1: 380, y1: 900, z1: -200, x2: 360, y2: 600, z2: -400, bend: -60, color: 0xc8a23a });   // fuel line (brass)
  // corrugated air-intake hose: air cleaner → turbo compressor inlet
  await flex({ length: 620, radius: 95, amplitude: 22, convolutions: 12, sides: 30, rx: -90, ry: 28, x: -430, y: 1040, z: -900, color: 0x2a2e34 });
  await capture('99-final');

  const n = await bodyCount();
  console.log(`SP-27 engine harnesses+plumbing — bodies: ${n}`);
  // 3 engine + 7 accessories + 4 exhaust + 4 harness + 5 plumbing = 23
  expect(n).toBeGreaterThanOrEqual(20);

  await app.close();
});
