import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-bracket');
fs.mkdirSync(OUT, { recursive: true });

const BRACKETS = [
  { label: '01-small',  params: { width: 50, legA: 60, legB: 40, thickness: 4, x: -120, y: 0, z: 0, color: 0x9aa5b8 } },
  { label: '02-medium', params: { width: 60, legA: 80, legB: 60, thickness: 6, x:    0, y: 0, z: 0, color: 0xb89aa5 } },
  { label: '03-large',  params: { width: 80, legA: 100, legB: 80, thickness: 8, x:  140, y: 0, z: 0, color: 0xa5b89a } },
];

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt L-Bracket — OCCT fuse, 3 sizes', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.error('[pageerror]', e.message));
  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscRegistry, null, { timeout: 60000 });
  await win.evaluate(() => { window.__archdiscBypassDialog = true; });
  const wc = win.locator('[data-archdisc-welcome-close="true"]').first();
  if (await wc.count() > 0) {
    await wc.dispatchEvent('click');
    await win.locator('[data-archdisc-welcome="open"]').waitFor({ state: 'hidden', timeout: 5000 });
  }
  await win.locator('[data-ribbon-tab-key="part"]').dispatchEvent('click');
  await win.waitForTimeout(2000);
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    if (!vp?.camera) return;
    if (vp.orbitControls) { vp.orbitControls.maxDistance = 20; vp.orbitControls.minDistance = 0.05; }
    vp.camera.position.set(0.10, 0.25, 0.45);
    vp.orbitControls.target.set(0, 0.04, 0);
    vp.camera.lookAt(0, 0.04, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '00-before.png') });

  const reports = [];
  for (let i = 0; i < BRACKETS.length; i++) {
    const cfg = BRACKETS[i];
    await win.evaluate((c) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Sculpt L-Bracket'] = c.params;
    }, cfg);
    await win.locator('[data-ribbon-tool-name="Sculpt L-Bracket"]').first().dispatchEvent('click');
    const tmax = i === 0 ? 8 * 60 * 1000 : 60_000;
    await win.waitForFunction(
      (expected) => { const r = window.__lastBracketReport; return !!r && r.width === expected.width && r.thickness === expected.thickness; },
      { width: cfg.params.width, thickness: cfg.params.thickness }, { timeout: tmax }
    );
    const r = await win.evaluate(() => window.__lastBracketReport);
    reports.push({ ...cfg, report: r });
    console.log(`[Sculpt Bracket] ${cfg.label}: W=${r.width} A=${r.legA} B=${r.legB} t=${r.thickness} predicted=${r.predictedVolume.toFixed(0)} actual=${r.actualVolume.toFixed(0)} relErr=${(r.relError*100).toFixed(3)}% faces=${r.faceCount}`);
    await win.waitForTimeout(2500);
    await win.screenshot({ path: path.join(OUT, `${cfg.label}.png`) });
  }

  for (const { report: r } of reports) {
    expect(r.actualVolume).toBeGreaterThan(0);
    expect(r.relError).toBeLessThan(0.005);
    // L-bracket: 8 outer faces (top, bottom, 4 sides of L, 2 inside-corner)
    expect(r.faceCount).toBeGreaterThanOrEqual(8);
  }

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
