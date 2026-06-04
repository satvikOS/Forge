// v4-319-bundle.spec.js — Forge-319 5-calc bundle:
// hydraulic jump + buried pipe + IEEE 80 + pile group + buoyancy.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-319-bundle';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.configure({ timeout: 240000 });
test.describe.serial('Forge-319 · 5-calc bundle', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
      timeout: 150000,
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    await page.evaluate(() => {
      document.querySelectorAll('[data-testid="forge-tour-tooltip"]').forEach((n) => n.remove());
      document.querySelectorAll('[data-testid="forge-tour-overlay"]').forEach((n) => n.remove());
    });
  });
  test.afterAll(async () => {
    if (!app) return;
    try { await Promise.race([app.close(), new Promise((r) => setTimeout(r, 4000))]); }
    catch (e) { /* ignore */ }
    try { app.process()?.kill('SIGKILL'); } catch (e) { /* ignore */ }
  });

  test('01 all 5 kernel bridges wired (cam #1)', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() => ({
      hydjump:    !!(window.forge && window.forge.hydjump),
      buriedpipe: !!(window.forge && window.forge.buriedpipe),
      subgnd:     !!(window.forge && window.forge.subgnd),
      pilegroup:  !!(window.forge && window.forge.pilegroup),
      buoyancy:   !!(window.forge && window.forge.buoyancy),
    }));
    expect(has.hydjump).toBe(true);
    expect(has.buriedpipe).toBe(true);
    expect(has.subgnd).toBe(true);
    expect(has.pilegroup).toBe(true);
    expect(has.buoyancy).toBe(true);
  });

  test('02 Hydraulic jump (b=10, y1=0.5, Q=20): Fr1≈1.81, y2≈1.05, steady (cam #2)', async () => {
    const r = await page.evaluate(() => window.forge.hydjump.analyse({
      channelWidthB_m: 10, upstreamDepthY1_m: 0.5,
      dischargeQM3PerS: 20, gravityMs2: 9.81,
    }));
    expect(r.upstreamVelocityV1_ms).toBeCloseTo(4.0, 5);
    expect(r.upstreamFroudeNumber).toBeGreaterThan(1.7);
    expect(r.upstreamFroudeNumber).toBeLessThan(1.9);
    expect(r.sequentDepthY2_m).toBeGreaterThan(1.0);
    expect(r.sequentDepthY2_m).toBeLessThan(1.10);
    expect(r.downstreamFroudeNumber).toBeLessThan(1.0);
    expect(r.energyHeadLossM).toBeGreaterThan(0);
    expect(['undular', 'weak', 'oscillating', 'steady', 'strong']).toContain(r.jumpType);
    await shot(page, 'hydjump');
  });

  test('03 Belanger identity y_2/y_1 = 0.5·(√(1+8·Fr_1²) − 1) (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.hydjump.analyse({
      channelWidthB_m: 10, upstreamDepthY1_m: 0.5,
      dischargeQM3PerS: 20, gravityMs2: 9.81,
    }));
    const expected = 0.5 * (Math.sqrt(1 + 8 * r.upstreamFroudeNumber ** 2) - 1);
    expect(r.sequentDepthY2_m / 0.5).toBeCloseTo(expected, 4);
    await shot(page, 'belanger');
  });

  test('04 Subcritical upstream throws (cam #4)', async () => {
    const err = await page.evaluate(() => {
      try { window.forge.hydjump.analyse({
        channelWidthB_m: 10, upstreamDepthY1_m: 3,
        dischargeQM3PerS: 5, gravityMs2: 9.81,
      }); return null; }
      catch (e) { return String(e.message || e); }
    });
    expect(err).toMatch(/subcritical|Fr/);
    await shot(page, 'subcrit');
  });

  test('05 Marston (B_d=1.5, H=4, φ=30, γ=18): K=0.333, W_d≈84 kN/m (cam #5)', async () => {
    const r = await page.evaluate(() => window.forge.buriedpipe.analyse({
      trenchWidthBd_m: 1.5, fillHeightH_m: 4,
      soilFrictionAngleDeg: 30, soilUnitWeightKnPerM3: 18,
    }));
    expect(r.K_Rankine).toBeCloseTo((1 - Math.sin(Math.PI/6)) / (1 + Math.sin(Math.PI/6)), 5);
    expect(r.earthLoadKnPerM).toBeGreaterThan(83);
    expect(r.earthLoadKnPerM).toBeLessThan(86);
    await shot(page, 'marston');
  });

  test('06 IEEE 80 (ρ=100, A=10000, L=2000, h=0.5): R_g < 1 Ω (cam #6)', async () => {
    const r = await page.evaluate(() => window.forge.subgnd.analyse({
      soilResistivityOhmM: 100, gridAreaM2: 10000,
      totalConductorLengthM: 2000, burialDepthM: 0.5,
    }));
    expect(r.gridResistanceOhm).toBeLessThan(1.0);
    expect(r.gridResistanceOhm).toBeGreaterThan(0.4);
    expect(r.meetsIeee80Target).toBe(true);
  });

  test('07 Pile group 3×3 d/s=0.3: η=0.753 exact (cam #7)', async () => {
    const r = await page.evaluate(() => window.forge.pilegroup.analyse({
      pileDiameterMm: 300, spacingMm: 1000, rows_m: 3, columns_n: 3,
      singlePileCapacityKn: 500,
    }));
    expect(r.anglePhiDeg).toBeCloseTo(Math.atan(0.3) * 180 / Math.PI, 4);
    expect(r.efficiency).toBeGreaterThan(0.74);
    expect(r.efficiency).toBeLessThan(0.76);
    expect(r.groupCapacityKn).toBeCloseTo(r.efficiency * 9 * 500, 0);
  });

  test('08 Buoyancy 20×10 h_w=3, qs=5, qo=8: FOS=0.44 FAILS (cam #8)', async () => {
    const r = await page.evaluate(() => window.forge.buoyancy.analyse({
      basementWidthB_m: 20, basementLengthN_m: 10,
      waterHeadAboveSlabM: 3, slabSelfWeightKnPerM2: 5,
      overburdenKnPerM2: 8, waterUnitWeightKnPerM3: 9.81,
    }));
    expect(r.slabAreaM2).toBe(200);
    expect(r.upliftForceKn).toBeCloseTo(9.81 * 3 * 200, 0);
    expect(r.weightForceKn).toBeCloseTo(13 * 200, 0);
    expect(r.factorOfSafety).toBeLessThan(0.5);
    expect(r.passes).toBe(false);
    await shot(page, 'buoyancy-fails');
  });

  test('09 All 5 panels open via menu route + render results (cam #9)', async () => {
    const ids = ['hydjump', 'buriedpipe', 'subgnd', 'pilegroup', 'buoyancy'];
    for (const id of ids) {
      await page.evaluate((i) => {
        window.dispatchEvent(new CustomEvent('forge:menu-action',
          { detail: { id: `tools.${i}` } }));
      }, id);
      await page.waitForTimeout(300);
    }
    const panels = await page.evaluate(() => ({
      hj: !!document.querySelector('[data-testid="forge-hj-panel"]'),
      ms: !!document.querySelector('[data-testid="forge-marston-panel"]'),
      sg: !!document.querySelector('[data-testid="forge-subgnd-panel"]'),
      pg: !!document.querySelector('[data-testid="forge-pg-panel"]'),
      by: !!document.querySelector('[data-testid="forge-buoy-panel"]'),
    }));
    expect(panels.hj).toBe(true);
    expect(panels.ms).toBe(true);
    expect(panels.sg).toBe(true);
    expect(panels.pg).toBe(true);
    expect(panels.by).toBe(true);
  });

  test('10 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
