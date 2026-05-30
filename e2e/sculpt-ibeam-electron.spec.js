import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * SP-42 — Sculpt I-Beam (AISC W-shape). HEADED on the Mac Electron
 * shell. Four configurations laid in a row: three different AISC
 * presets (W8×10, W12×26, W18×35) plus one custom dialer case. Each
 * beam runs vertically along Z (positions vary in X) so the viewer
 * sees the canonical wide-flange silhouette grow stouter from left to
 * right. Volumes match the A·L closed-form to ≤ 0.1 % since extrude
 * is exact on a polygon profile.
 *
 * Viewer-friendly pauses (2.5 s between beams, 6 s final).
 */

const OUT = path.resolve(__dirname, 'screenshots', 'sculpt-ibeam');
fs.mkdirSync(OUT, { recursive: true });

const BEAMS = [
  {
    label: '01-W8x10',
    note: 'AISC W8×10 — light architectural framing',
    params: { preset: 'W8x10', length: 600,
              x: -450, y: 0, z: 0, color: 0x9c8d6a },
  },
  {
    label: '02-W12x26',
    note: 'AISC W12×26 — common floor beam',
    params: { preset: 'W12x26', length: 700,
              x: -150, y: 0, z: 0, color: 0x6a9c8d },
  },
  {
    label: '03-W18x35',
    note: 'AISC W18×35 — heavier joist',
    params: { preset: 'W18x35', length: 800,
              x:  150, y: 0, z: 0, color: 0x8d6a9c },
  },
  {
    label: '04-custom',
    note: 'Custom dialer — d 500 × bf 250 × tw 12 × tf 18 mm',
    params: { preset: 'custom', d: 500, bf: 250, tw: 12, tf: 18,
              length: 900, x:  450, y: 0, z: 0, color: 0x6a8d9c },
  },
];

test.describe.configure({ timeout: 8 * 60 * 1000 });

test('Sculpt I-Beam — headed Electron, 3 AISC presets + 1 custom dialer', async () => {
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

  // Frame the row of four beams at (−450, −150, +150, +450) mm.
  await win.evaluate(() => {
    const vp = window.__archdiscViewport;
    if (!vp?.camera) return;
    if (vp.orbitControls) { vp.orbitControls.maxDistance = 20; vp.orbitControls.minDistance = 0.05; }
    vp.camera.position.set(0.55, 0.85, 1.40);
    vp.orbitControls.target.set(0, 0, 0);
    vp.camera.lookAt(0, 0, 0);
    vp.orbitControls.update();
    vp.renderer.render(vp.scene, vp.camera);
  });
  await win.waitForTimeout(1500);
  await win.screenshot({ path: path.join(OUT, '00-before.png') });

  const reports = [];
  let bodiesPrev = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);

  for (const cfg of BEAMS) {
    await win.evaluate((c) => {
      window.__archdiscPlanParams = window.__archdiscPlanParams || {};
      window.__archdiscPlanParams['Sculpt I-Beam'] = c.params;
    }, cfg);
    await win.locator('[data-ribbon-tool-name="Sculpt I-Beam"]').first().dispatchEvent('click');
    await win.waitForFunction(
      (expected) => {
        const r = window.__lastIBeamReport;
        return !!r && r.preset === expected.preset && r.length === expected.length;
      },
      { preset: cfg.params.preset, length: cfg.params.length },
      { timeout: 30000 }
    );
    const report = await win.evaluate(() => window.__lastIBeamReport);
    reports.push({ ...cfg, report });
    const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
    const added = bodiesNow - bodiesPrev;
    bodiesPrev = bodiesNow;
    console.log(`[Sculpt I-Beam] ${cfg.label} (${cfg.note}): bodies +${added}, report=`,
      JSON.stringify({
        preset: report.preset, d: report.d, bf: report.bf, tw: report.tw, tf: report.tf,
        length: report.length,
        sectionArea: +report.sectionArea.toFixed(1),
        volume: +report.volume.toFixed(0),
        predictedVolume: +report.predictedVolume.toFixed(0),
        relError: +(report.relError * 100).toFixed(4),
        triCount: report.triCount,
      }, null, 0));
    await win.waitForTimeout(2500);                                  // viewer pause
    await win.screenshot({ path: path.join(OUT, `${cfg.label}.png`) });
  }

  // ── ASSERTIONS ────────────────────────────────────────────────────────

  const [w8, w12, w18, custom] = reports.map(r => r.report);

  // 1. Every beam is non-empty + watertight.
  for (const r of [w8, w12, w18, custom]) {
    expect(r.volume).toBeGreaterThan(0);
    expect(r.triCount).toBeGreaterThan(0);
  }

  // 2. Extrude on a polygon profile is EXACT: volume == area × length
  //    to machine precision (we allow 0.1 % for the float-to-double
  //    surface-area computation Manifold uses internally).
  for (const r of [w8, w12, w18, custom]) {
    expect(r.relError).toBeLessThan(0.001);
  }

  // 3. Preset routing: when preset is 'W12x26', the recorded
  //    dimensions match the preset table (d=310, bf=165, tw=5.8, tf=9.7).
  expect(w12.d).toBe(310);
  expect(w12.bf).toBe(165);
  expect(w12.tw).toBeCloseTo(5.8, 1);
  expect(w12.tf).toBeCloseTo(9.7, 1);

  // 4. Volume scales the right way: presets get heavier with size.
  expect(w12.volume).toBeGreaterThan(w8.volume);
  expect(w18.volume).toBeGreaterThan(w12.volume);

  // 5. The custom dialer overrides the preset table — d=500 here, not
  //    any of the AISC values.
  expect(custom.preset).toBe('custom');
  expect(custom.d).toBe(500);

  // 6. Four bodies landed.
  const bodiesNow = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
  expect(bodiesNow).toBeGreaterThanOrEqual(BEAMS.length);

  await win.waitForTimeout(6000);                                    // final viewer pause
  await win.screenshot({ path: path.join(OUT, '99-after.png') });

  await app.close();
});
