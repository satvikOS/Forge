// v4-241-pilecap.spec.js — Forge-241 pile capacity (α + Meyerhof tip).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-241-pilecap';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const DAS = () => ({
  diameterM: 0.5,
  waterTableDepthM: -1,
  factorOfSafety: 3,
  Nq_tip: 100, limitTipBearingPa: 11e6,
  layers: [
    { type: 'clay', thicknessM: 10, effectiveUnitWeightNPerM3: 17000,
      undrainedShearStrengthPa: 50000, alpha: 0.8,
      frictionAngleDeg: 0, beta: 0 },
    { type: 'sand', thicknessM: 5, effectiveUnitWeightNPerM3: 10000,
      undrainedShearStrengthPa: 0, alpha: 0,
      frictionAngleDeg: 36, beta: 0.5 },
  ],
});

test.describe.serial('Forge-241 · pile capacity (α + Meyerhof)', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    await page.evaluate(() => {
      document.querySelectorAll('[data-testid="forge-tour-tooltip"]').forEach((n) => n.remove());
      document.querySelectorAll('[data-testid="forge-tour-overlay"]').forEach((n) => n.remove());
    });
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 kernel bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.pilecap
         && typeof window.forge.pilecap.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Das textbook Q_ult ≈ 3550 kN (cam #1)', async () => {
    const r = await page.evaluate((inp) => window.forge.pilecap.analyse(inp), DAS());
    expect(r.layers).toHaveLength(2);
    // Clay layer: f_s = 0.8·50 = 40 kPa, Q_s,1 = 40e3·π·0.5·10 = 628 kN
    expect(r.layers[0].skinFrictionPa / 1000).toBeCloseTo(40, 0);
    expect(r.layers[0].skinForceN / 1000).toBeCloseTo(628, 0);
    // Sand layer mid σ'_v = 170 + 10·2.5 = 195 kPa; f_s = 0.5·195 = 97.5 kPa
    expect(r.layers[1].effectiveStressAtMidPa / 1000).toBeCloseTo(195, 0);
    expect(r.layers[1].skinFrictionPa / 1000).toBeCloseTo(97.5, 0);
    expect(r.layers[1].skinForceN / 1000).toBeCloseTo(766, 0);
    expect(r.tipBearingPa / 1e6).toBeCloseTo(11.0, 3);  // capped
    expect(r.ultimateCapacityN / 1000).toBeCloseTo(3553, -1);
    expect(r.allowableCapacityN / 1000).toBeCloseTo(1184, -1);
    await shot(page, 'das-textbook');
  });

  test('03 sand tip cap activates (cam #2)', async () => {
    const raw = await page.evaluate((inp) => window.forge.pilecap.analyse(inp),
      { ...DAS(), limitTipBearingPa: 100e6 });   // huge cap → raw used
    expect(raw.tipBearingPa / 1e6).toBeCloseTo(22.0, 3);  // 100·220 kPa
    const capped = await page.evaluate((inp) => window.forge.pilecap.analyse(inp), DAS());
    expect(capped.tipBearingPa).toBeLessThan(raw.tipBearingPa);
    await shot(page, 'sand-tip-cap');
  });

  test('04 clay tip 9·c_u rule (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.pilecap.analyse({
      diameterM: 0.5, waterTableDepthM: -1, factorOfSafety: 3,
      Nq_tip: 100, limitTipBearingPa: 11e6,
      layers: [
        { type: 'clay', thicknessM: 15, effectiveUnitWeightNPerM3: 17000,
          undrainedShearStrengthPa: 80000, alpha: 0.7,
          frictionAngleDeg: 0, beta: 0 },
      ],
    }));
    // q_p = 9·80 kPa = 720 kPa
    expect(r.tipBearingPa / 1000).toBeCloseTo(720, 3);
    await shot(page, 'clay-tip');
  });

  test('05 doubling diameter → 4× tip force, 2× shaft force (cam #4)', async () => {
    const baseInp = DAS();
    const half = await page.evaluate((inp) => window.forge.pilecap.analyse(inp), baseInp);
    const doubled = await page.evaluate((inp) => window.forge.pilecap.analyse(inp),
      { ...baseInp, diameterM: 1.0 });
    // Shaft: π·d·t, linear in d → 2×.
    expect(doubled.shaftForceN / half.shaftForceN).toBeCloseTo(2.0, 6);
    // Tip area π·d²/4 → 4×.
    expect(doubled.tipForceN / half.tipForceN).toBeCloseTo(4.0, 6);
    await shot(page, 'diameter-scaling');
  });

  test('06 FS linear: doubling FS halves Q_allow', async () => {
    const baseInp = DAS();
    const r1 = await page.evaluate((inp) => window.forge.pilecap.analyse(inp), baseInp);
    const r2 = await page.evaluate((inp) => window.forge.pilecap.analyse(inp),
      { ...baseInp, factorOfSafety: 6 });
    expect(r2.allowableCapacityN).toBeCloseTo(0.5 * r1.allowableCapacityN, 3);
  });

  test('07 panel renders Q_ult + Q_allow + per-layer rows (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenPileCapWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-pilecap-run"]').click();
    await page.waitForSelector('[data-testid="forge-pilecap-result"]', { timeout: 5000 });
    const qult = await page.locator('[data-testid="forge-pilecap-Qult"]').innerText();
    const qa = await page.locator('[data-testid="forge-pilecap-Qa"]').innerText();
    expect(qult).toMatch(/Q_ult/);
    expect(qa).toMatch(/Q_allow/);
    await shot(page, 'panel');
  });

  test('08 menu route fires pilecap workbench', async () => {
    await page.evaluate(() => { window.__forgeClosePileCapWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.pilecap' } }));
    });
    await page.waitForSelector('[data-testid="forge-pilecap-panel"]', { timeout: 2000 });
  });

  test('09 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
