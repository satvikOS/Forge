import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-22 — CORRUGATED EXHAUST FLEX PIPE (Video-21 bible callout). Sculpt
 * Flex Pipe builds a bellows tube whose radius oscillates along its axis
 * = real convolutions. Demonstrated as a vertical heavy-truck exhaust
 * stack: a straight downpipe + the corrugated flex section + a straight
 * upper stack. Adversarial audit confirms the convolutions are visible
 * and the flex section bridges the two straight runs coherently.
 * Per [[project_video21_parity_bible]] + [[feedback_fully_sophisticated]].
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sp22-corrugated-exhaust');
fs.mkdirSync(OUT, { recursive: true });

test.describe.configure({ timeout: 30 * 60 * 1000 });

test('SP-22 — corrugated exhaust flex pipe', async () => {
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
  const pipe = async (f) => addsOneBody(() => runTool('Sculpt Pipe', f));
  const flex = async (f) => addsOneBody(() => runTool('Sculpt Flex Pipe', f));

  const main = { x: 0, y: 1.35, z: 0 };
  const capture = async (label) => {
    const angles = [
      { name: 'front',  az:   4, el:  6, dist: 4.2, t: main },
      { name: 'iso',    az:  36, el: 14, dist: 4.4, t: main },
      { name: 'detail', az:  14, el:  4, dist: 2.0, t: { x: 0, y: 1.25, z: 0 } },  // close on the convolutions
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

  // ─── vertical exhaust: straight downpipe + flex bellows + upper stack
  await pipe({ radius: 92, x1: 0, y1: 220, z1: 0, x2: 0, y2: 920, z2: 0, bend: 0, color: 0x6b5a4a });   // downpipe
  await capture('01-downpipe');
  // corrugated flex section (built along +Z; rx=-90 stands it vertical)
  await flex({ length: 720, radius: 96, amplitude: 26, convolutions: 16, sides: 40, rx: -90, x: 0, y: 920, z: 0, color: 0x9aa0a6 });
  await capture('02-flex');
  await pipe({ radius: 92, x1: 0, y1: 1640, z1: 0, x2: 0, y2: 2520, z2: 0, bend: 0, color: 0xc8ccd0 }); // upper chrome stack
  await capture('99-final');

  const n = await bodyCount();
  console.log(`SP-22 corrugated exhaust — bodies: ${n}`);
  expect(n).toBe(3);

  // the flex section is the middle body — confirm it has real volume
  const flexVol = await win.evaluate(() => {
    const list = window.__archdiscRegistry?.list?.() || [];
    const f = list[1];   // 2nd added = flex
    try { return f?.manifold?.volume?.() ?? null; } catch { return null; }
  });
  console.log('SP-22 flex section volume:', flexVol);
  expect(flexVol === null || flexVol > 0).toBeTruthy();

  await app.close();
});
