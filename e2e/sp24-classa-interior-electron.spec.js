import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-24 — CLASS-A CAB INTERIOR (Video-21 bible callout: full interior).
 * A standalone, fully-visible LHD driver compartment built through the
 * ribbon: floor pan, two seats (Class-A crown-panel cushions + reclined
 * backrests), a curved sloped dashboard, steering wheel + column,
 * instrument cluster, centre console + gear shifter, three pedals and two
 * curved door cards. Composition of existing Sculpt tools — no new tool.
 * Adversarial hero / top / side / rear audit checks the cabin layout is
 * coherent (seats face the dash, wheel at the driver, console between).
 * Per [[project_video21_parity_bible]] + [[feedback_omni_coherence_law]].
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp24-classa-interior');
fs.mkdirSync(OUT, { recursive: true });

// floor y=0, X side-to-side, Z front(+)/rear(−). LHD driver at x=−580.
const czc = (centerZ, d) => centerZ - d / 2;

test.describe.configure({ timeout: 30 * 60 * 1000 });

test('SP-24 — Class-A cab interior', async () => {
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
  const crown = async (f) => addsOneBody(() => runTool('Sculpt Crown Panel', f));

  const tgt = { x: 0, y: 0.66, z: 0.0 };
  const capture = async (label) => {
    const angles = [
      { name: 'hero', az:  28, el: 46, dist: 5.2 },   // look down-forward into the cabin over the door cards
      { name: 'top',  az:  18, el: 70, dist: 5.0 },
      { name: 'side', az:  90, el: 12, dist: 5.0 },
      { name: 'rear', az: 162, el: 26, dist: 5.0 },
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

  await capture('00-empty');

  // ─── floor pan ──────────────────────────────────────────────────────
  await box({ w: 2300, h: 60, d: 1700, x: 0, y: 30, z: czc(0, 1700), color: 0x26292e });
  // ─── seats — Class-A crown cushions + reclined backrests (L + R) ────
  for (const sx of [-580, 580]) {
    await crown({ width: 640, length: 640, crownX: 34, crownZ: 26, thickness: 150, nu: 18, nv: 16, x: sx, y: 430, z: czc(-300, 640), color: 0x3a3e44 }); // cushion
    await crown({ width: 640, length: 920, crownX: 44, crownZ: 30, thickness: 140, nu: 18, nv: 18, rx: -78, x: sx, y: 940, z: -640, color: 0x3a3e44 });    // backrest
  }
  await capture('01-seats');

  // ─── dashboard (curved, sloped) + instrument cluster ────────────────
  await crown({ width: 2280, length: 560, crownX: 50, crownZ: 75, thickness: 150, nu: 30, nv: 18, rx: -42, x: 0, y: 1010, z: 600, color: 0x2c3036 });
  await box({ w: 640, h: 280, d: 180, rx: -42, x: -580, y: 1180, z: 470, color: 0x16191c });   // instrument binnacle
  await capture('02-dash');

  // ─── steering wheel + column ────────────────────────────────────────
  await cyl({ r: 215, d: 48, rx: 66, x: -580, y: 1060, z: 290, color: 0x16191c });
  await cyl({ r: 46, d: 330, rx: 66, x: -580, y: 950, z: 430, color: 0x2a2e34 });
  // ─── centre console + gear shifter ──────────────────────────────────
  await box({ w: 340, h: 520, d: 880, x: 0, y: 400, z: czc(-120, 880), color: 0x2a2e34 });
  await cyl({ r: 30, d: 250, x: 0, y: 720, z: 170, color: 0x16191c });                          // shifter stalk
  await cyl({ r: 48, d: 70, x: 0, y: 900, z: 170, color: 0x16191c });                           // shifter knob
  // ─── pedals (clutch / brake / accelerator) ─────────────────────────
  for (const px of [-700, -580, -460]) await box({ w: 105, h: 40, d: 180, rx: -22, x: px, y: 150, z: 660, color: 0x16191c });
  // ─── door cards (curved, vertical) ─────────────────────────────────
  await crown({ width: 620, length: 1500, crownX: 50, crownZ: 30, thickness: 80, nu: 16, nv: 18, rz: 90, x: -1130, y: 560, z: czc(-200, 1500), color: 0x33597a });
  await crown({ width: 620, length: 1500, crownX: 50, crownZ: 30, thickness: 80, nu: 16, nv: 18, rz: -90, x: 1130, y: 560, z: czc(-200, 1500), color: 0x33597a });
  await capture('99-final');

  const n = await bodyCount();
  console.log(`SP-24 interior — bodies: ${n}`);
  // floor + 4 seat panels + dash + binnacle + wheel + column + console
  // + shifter stalk + knob + 3 pedals + 2 door cards = 17
  expect(n).toBeGreaterThanOrEqual(15);

  await app.close();
});
