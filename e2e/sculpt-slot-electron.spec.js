import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-slot');
fs.mkdirSync(OUT, { recursive: true });

const PLATES = [
  { label: '01-short',  params: { plateW: 100, plateH: 50, plateT: 5, slotL: 30, slotR: 4,  x: -130, y: 0, z: 0, color: 0x6ba58a } },
  { label: '02-medium', params: { plateW: 120, plateH: 60, plateT: 6, slotL: 50, slotR: 5,  x:    0, y: 0, z: 0, color: 0x8a6ba5 } },
  { label: '03-long',   params: { plateW: 160, plateH: 70, plateT: 8, slotL: 80, slotR: 7,  x:  150, y: 0, z: 0, color: 0xa58a6b } },
];

test.describe.configure({ timeout: 15 * 60 * 1000 });

test('Sculpt Slotted Plate — OCCT plate + stadium slot cutter', async () => {
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
    vp.camera.position.set(0.05, 0.30, 0.45);
    vp.orbitControls.target.set(0, 0, 0);
    vp.camera.lookAt(0, 0, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '00-before.png') });

  const reports = [];
  for (let i = 0; i < PLATES.length; i++) {
    const cfg = PLATES[i];
    await win.evaluate((c) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Sculpt Slotted Plate'] = c.params;
    }, cfg);
    await win.locator('[data-ribbon-tool-name="Sculpt Slotted Plate"]').first().dispatchEvent('click');
    const tmax = i === 0 ? 8 * 60 * 1000 : 60_000;
    await win.waitForFunction(
      (expected) => { const r = window.__lastSlotPlateReport; return !!r && r.slotL === expected.slotL && r.slotR === expected.slotR; },
      { slotL: cfg.params.slotL, slotR: cfg.params.slotR }, { timeout: tmax }
    );
    const r = await win.evaluate(() => window.__lastSlotPlateReport);
    reports.push({ ...cfg, report: r });
    console.log(`[Sculpt SlotPlate] ${cfg.label}: slot=${r.slotL}×Ø${r.slotR * 2} predicted=${r.predictedVolume.toFixed(0)} actual=${r.actualVolume.toFixed(0)} relErr=${(r.relError*100).toFixed(3)}% faces=${r.faceCount}`);
    await win.waitForTimeout(2500);
    await win.screenshot({ path: path.join(OUT, `${cfg.label}.png`) });
  }

  for (const { report: r } of reports) {
    expect(r.actualVolume).toBeGreaterThan(0);
    expect(r.relError).toBeLessThan(0.005);
    // Plate has 6 faces + slot adds 2 cyl-side halves + 1 flat bottom of slot + slot edges
    expect(r.faceCount).toBeGreaterThanOrEqual(8);
  }

  await win.waitForTimeout(4000);
  await win.screenshot({ path: path.join(OUT, '99-after.png') });
  await app.close();
});
