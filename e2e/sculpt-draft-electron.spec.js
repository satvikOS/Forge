import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/* SP-49 — Sculpt Draft Box. OCCT B-rep path. Three tapers. */

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-draft');
fs.mkdirSync(OUT, { recursive: true });

const BOXES = [
  { label: '01-a3',  params: { dx: 80, dy: 60, dz: 40, angleDeg: 3,  x: -150, y: 0, z: 0, color: 0xa56b6b } },
  { label: '02-a8',  params: { dx: 80, dy: 60, dz: 40, angleDeg: 8,  x:    0, y: 0, z: 0, color: 0x6ba56b } },
  { label: '03-a15', params: { dx: 80, dy: 60, dz: 40, angleDeg: 15, x:  150, y: 0, z: 0, color: 0x6b6ba5 } },
];

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Draft Box — OCCT B-rep path, 3 draft angles', async () => {
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
  for (let i = 0; i < BOXES.length; i++) {
    const cfg = BOXES[i];
    await win.evaluate((c) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Sculpt Draft Box'] = c.params;
    }, cfg);
    await win.locator('[data-ribbon-tool-name="Sculpt Draft Box"]').first().dispatchEvent('click');
    const tmax = i === 0 ? 8 * 60 * 1000 : 60_000;
    await win.waitForFunction(
      (expected) => { const r = window.__lastDraftReport; return !!r && r.angleDeg === expected.angleDeg; },
      { angleDeg: cfg.params.angleDeg }, { timeout: tmax }
    );
    const r = await win.evaluate(() => window.__lastDraftReport);
    reports.push({ ...cfg, report: r });
    console.log(`[Sculpt Draft] ${cfg.label}: angle=${r.angleDeg}° top=${r.topDx.toFixed(1)}×${r.topDy.toFixed(1)} predicted=${r.predictedVolume.toFixed(0)} actual=${r.actualVolume.toFixed(0)} relErr=${(r.relError*100).toFixed(3)}% faces=${r.faceCount} ms=${r.elapsedMs}`);
    await win.waitForTimeout(3000);
    await win.screenshot({ path: path.join(OUT, `${cfg.label}.png`) });
  }

  for (const { report: r } of reports) {
    expect(r.actualVolume).toBeGreaterThan(0);
    expect(r.relError).toBeLessThan(0.02);   // analytic frustum volume is exact
    expect(r.faceCount).toBe(6);             // box → 6 faces preserved after draft
  }
  // Larger draft angle ⇒ smaller volume (more material trimmed off the sides).
  expect(reports[1].report.actualVolume).toBeLessThan(reports[0].report.actualVolume);
  expect(reports[2].report.actualVolume).toBeLessThan(reports[1].report.actualVolume);

  await win.waitForTimeout(6000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
