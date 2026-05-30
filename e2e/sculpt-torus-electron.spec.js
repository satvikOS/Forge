import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/* SP-51 — Sculpt Torus Primitive. OCCT exact analytic surface. */

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-torus');
fs.mkdirSync(OUT, { recursive: true });

const TORI = [
  { label: '01-thin',   params: { majorR: 40, minorR: 5,  x: -150, y: 0, z: 0, color: 0xc6826b } },
  { label: '02-medium', params: { majorR: 40, minorR: 12, x:    0, y: 0, z: 0, color: 0x6bc682 } },
  { label: '03-fat',    params: { majorR: 40, minorR: 20, x:  150, y: 0, z: 0, color: 0x826bc6 } },
];

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Torus Primitive — OCCT exact analytic, 3 aspect ratios', async () => {
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
    vp.camera.position.set(0.10, 0.30, 0.45);
    vp.orbitControls.target.set(0, 0, 0);
    vp.camera.lookAt(0, 0, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '00-before.png') });

  const reports = [];
  for (let i = 0; i < TORI.length; i++) {
    const cfg = TORI[i];
    await win.evaluate((c) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Sculpt Torus Primitive'] = c.params;
    }, cfg);
    await win.locator('[data-ribbon-tool-name="Sculpt Torus Primitive"]').first().dispatchEvent('click');
    const tmax = i === 0 ? 8 * 60 * 1000 : 60_000;
    await win.waitForFunction(
      (expected) => { const r = window.__lastTorusReport; return !!r && r.majorR === expected.majorR && r.minorR === expected.minorR; },
      { majorR: cfg.params.majorR, minorR: cfg.params.minorR }, { timeout: tmax }
    );
    const r = await win.evaluate(() => window.__lastTorusReport);
    reports.push({ ...cfg, report: r });
    console.log(`[Sculpt Torus] ${cfg.label}: R=${r.majorR} r=${r.minorR} predicted=${r.predictedVolume.toFixed(0)} actual=${r.actualVolume.toFixed(0)} relErr=${(r.relError*100).toFixed(3)}% faces=${r.faceCount} ms=${r.elapsedMs}`);
    await win.waitForTimeout(3000);
    await win.screenshot({ path: path.join(OUT, `${cfg.label}.png`) });
  }

  for (const { report: r } of reports) {
    expect(r.actualVolume).toBeGreaterThan(0);
    expect(r.relError).toBeLessThan(0.005);                // exact analytic surface
    expect(r.faceCount).toBeGreaterThanOrEqual(1);
  }
  expect(reports[1].report.actualVolume).toBeGreaterThan(reports[0].report.actualVolume);
  expect(reports[2].report.actualVolume).toBeGreaterThan(reports[1].report.actualVolume);

  await win.waitForTimeout(6000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
