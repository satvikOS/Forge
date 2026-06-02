// v4-237-filletweld.spec.js — Forge-237 fillet weld (AISC J2 + AWS D1.1).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-237-filletweld';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-237 · fillet weld AISC J2 / AWS D1.1', () => {
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
      !!(window.forge && window.forge.filletweld
         && typeof window.forge.filletweld.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 textbook 6 mm E70xx 200 mm fillet → φR_n ≈ 183 kN (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.filletweld.analyse({
      legSizeM: 0.006, weldLengthM: 0.200, electrodeFexxPa: 480e6,
      thickerPlateM: 0.012, edgePlateM: 0.010, phi: 0.75,
    }));
    expect(r.effectiveThroatM).toBeCloseTo(Math.SQRT1_2 * 0.006, 9);
    expect(r.designPerUnitNPerM / 1000).toBeCloseTo(916.4, 0); // N/mm
    expect(r.totalDesignN / 1000).toBeCloseTo(183.3, 0);
    expect(r.legBelowAwsMin).toBe(false);
    expect(r.legAboveAiscMax).toBe(false);
    await shot(page, 'textbook');
  });

  test('03 capacity linear in weld length (cam #2)', async () => {
    const single = await page.evaluate(() => window.forge.filletweld.analyse({
      legSizeM: 0.006, weldLengthM: 0.200, electrodeFexxPa: 480e6,
      thickerPlateM: 0.012, edgePlateM: 0.010, phi: 0.75,
    }));
    const dbl = await page.evaluate(() => window.forge.filletweld.analyse({
      legSizeM: 0.006, weldLengthM: 0.400, electrodeFexxPa: 480e6,
      thickerPlateM: 0.012, edgePlateM: 0.010, phi: 0.75,
    }));
    expect(dbl.totalDesignN).toBeCloseTo(2 * single.totalDesignN, 3);
    await shot(page, 'linear-L');
  });

  test('04 capacity linear in leg size (via throat) (cam #3)', async () => {
    const r6 = await page.evaluate(() => window.forge.filletweld.analyse({
      legSizeM: 0.006, weldLengthM: 0.200, electrodeFexxPa: 480e6,
      thickerPlateM: 0.012, edgePlateM: 0.010, phi: 0.75,
    }));
    const r8 = await page.evaluate(() => window.forge.filletweld.analyse({
      legSizeM: 0.008, weldLengthM: 0.200, electrodeFexxPa: 480e6,
      thickerPlateM: 0.012, edgePlateM: 0.010, phi: 0.75,
    }));
    expect(r8.totalDesignN / r6.totalDesignN).toBeCloseTo(8 / 6, 6);
    await shot(page, 'linear-w');
  });

  test('05 AWS minimum-leg table thresholds (cam #4)', async () => {
    const cases = [
      { t: 0.005,  expected: 0.003 },  // ≤ 6 mm
      { t: 0.010,  expected: 0.005 },  // 6-13 mm
      { t: 0.018,  expected: 0.006 },  // 13-19 mm
      { t: 0.025,  expected: 0.008 },  // > 19 mm
    ];
    for (const c of cases) {
      const r = await page.evaluate((t) => window.forge.filletweld.analyse({
        legSizeM: 0.010, weldLengthM: 0.200, electrodeFexxPa: 480e6,
        thickerPlateM: t, edgePlateM: 0.025, phi: 0.75,
      }), c.t);
      expect(r.awsMinLegM).toBeCloseTo(c.expected, 9);
    }
    await shot(page, 'aws-min-table');
  });

  test('06 AISC max-leg flagged when w > t_edge − 1.6 mm', async () => {
    const r = await page.evaluate(() => window.forge.filletweld.analyse({
      legSizeM: 0.012, weldLengthM: 0.200, electrodeFexxPa: 480e6,
      thickerPlateM: 0.020, edgePlateM: 0.010, phi: 0.75,
    }));
    // t_edge = 10 mm → max = 10 − 1.6 = 8.4 mm; w = 12 mm > 8.4 → flag.
    expect(r.aiscMaxLegM).toBeCloseTo(8.4e-3, 9);
    expect(r.legAboveAiscMax).toBe(true);
  });

  test('07 panel renders φR_n and both flag rows (cam #5)', async () => {
    await page.evaluate(() => { window.__forgeOpenFilletWeldWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-filletweld-run"]').click();
    await page.waitForSelector('[data-testid="forge-filletweld-result"]', { timeout: 5000 });
    const total = await page.locator('[data-testid="forge-filletweld-total"]').innerText();
    expect(total).toMatch(/φR_n/);
    expect(total).toMatch(/kN/);
    const aws = await page.locator('[data-testid="forge-filletweld-aws"]').innerText();
    expect(aws).toMatch(/AWS w_min/);
    const aisc = await page.locator('[data-testid="forge-filletweld-aisc"]').innerText();
    expect(aisc).toMatch(/AISC w_max/);
    await shot(page, 'panel');
  });

  test('08 menu route fires filletweld workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseFilletWeldWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.filletweld' } }));
    });
    await page.waitForSelector('[data-testid="forge-filletweld-panel"]', { timeout: 2000 });
  });

  test('09 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
