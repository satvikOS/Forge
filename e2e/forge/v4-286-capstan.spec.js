// v4-286-capstan.spec.js — Forge-286 Eytelwein capstan friction.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-286-capstan';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const REF = {
  holdingForceN: 350, frictionCoefficient: 0.3, wrapAngleDeg: 1080,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-286 · capstan friction', () => {
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

  test('01 kernel bridge wired (cam #1 baseline)', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.capstan
         && typeof window.forge.capstan.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Marine bollard 3 turns μ=0.3 T_2=350 N → T_1 ≈ 100 kN (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.capstan.analyse(b), REF);
    expect(r.wrapAngleRad).toBeCloseTo(1080 * Math.PI / 180, 6);
    expect(r.amplificationRatio).toBeCloseTo(Math.exp(0.3 * 1080 * Math.PI / 180), 4);
    expect(r.maxLoadN).toBeCloseTo(350 * r.amplificationRatio, 4);
    expect(r.maxLoadN).toBeGreaterThan(95000);
    expect(r.maxLoadN).toBeLessThan(105000);
    expect(r.mechanicalAdvantage).toBeCloseTo(r.amplificationRatio - 1, 9);
    await shot(page, 'bollard');
  });

  test('03 Single 360° wrap μ=0.5: amp = e^π (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.capstan.analyse({
      holdingForceN: 100, frictionCoefficient: 0.5, wrapAngleDeg: 360,
    }));
    expect(r.amplificationRatio).toBeCloseTo(Math.exp(Math.PI), 4);
    await shot(page, 'oneturn-piT');
  });

  test('04 Doubling μ doubles ln(amp) (cam #4)', async () => {
    const a = await page.evaluate(() => window.forge.capstan.analyse({
      holdingForceN: 100, frictionCoefficient: 0.25, wrapAngleDeg: 1080,
    }));
    const b = await page.evaluate(() => window.forge.capstan.analyse({
      holdingForceN: 100, frictionCoefficient: 0.50, wrapAngleDeg: 1080,
    }));
    expect(Math.log(b.amplificationRatio)).toBeCloseTo(2 * Math.log(a.amplificationRatio), 6);
    await shot(page, 'mu-double');
  });

  test('05 Halving θ halves ln(amp) (cam #5)', async () => {
    const full = await page.evaluate((b) => window.forge.capstan.analyse(b), REF);
    const half = await page.evaluate((b) => window.forge.capstan.analyse({
      ...b, wrapAngleDeg: 540,
    }), REF);
    expect(Math.log(full.amplificationRatio)).toBeCloseTo(2 * Math.log(half.amplificationRatio), 6);
    await shot(page, 'theta-half');
  });

  test('06 Wrap > 20 turns throws (cam #6)', async () => {
    let threw = false;
    try {
      await page.evaluate((b) => window.forge.capstan.analyse({
        ...b, wrapAngleDeg: 10000,
      }), REF);
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
    await shot(page, 'overwrap');
  });

  test('07 Panel renders T_1 row', async () => {
    await page.evaluate(() => { window.__forgeOpenCapstanFrictionWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-capstan-run"]').click();
    await page.waitForSelector('[data-testid="forge-capstan-result"]', { timeout: 5000 });
    const T1 = await page.locator('[data-testid="forge-capstan-T1"]').innerText();
    expect(T1).toMatch(/Max T_1/);
  });

  test('08 Menu route opens capstan panel', async () => {
    await page.evaluate(() => { window.__forgeCloseCapstanFrictionWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.capstan' } }));
    });
    await page.waitForSelector('[data-testid="forge-capstan-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
