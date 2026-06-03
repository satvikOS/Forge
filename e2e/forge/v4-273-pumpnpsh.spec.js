// v4-273-pumpnpsh.spec.js — Forge-273 pump NPSH (ANSI/HI 9.6).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-273-pumpnpsh';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const WATER20 = {
  atmosphericPressurePa: 101325, vapourPressurePa: 2339, densityKgM3: 998,
  staticSuctionHeadM: 3, frictionHeadM: 1.5, requiredNpshM: 4,
};

test.describe.serial('Forge-273 · pump NPSH available', () => {
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

  test('01 kernel bridge wired (cam #1 baseline)', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.pumpnpsh
         && typeof window.forge.pumpnpsh.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 Water 20°C, flooded suction → NPSH_A ≈ 11.6 m, safe (cam #2)', async () => {
    const r = await page.evaluate((base) => window.forge.pumpnpsh.analyse(base), WATER20);
    expect(r.pressureHeadM).toBeCloseTo(10.114, 1);
    expect(r.availableNpshM).toBeCloseTo(11.614, 1);
    expect(r.cavitating).toBe(false);
    expect(r.marginalPerHi).toBe(false);
    await shot(page, 'safe');
  });

  test('03 Suction lift -6 m → cavitating (cam #3)', async () => {
    const r = await page.evaluate((base) => window.forge.pumpnpsh.analyse({
      ...base, staticSuctionHeadM: -6,
    }), WATER20);
    expect(r.cavitating).toBe(true);
    expect(r.marginM).toBeLessThan(0);
    await shot(page, 'cavitating');
  });

  test('04 Hot water 90°C → low pressure head, marginal (cam #4)', async () => {
    const r = await page.evaluate((base) => window.forge.pumpnpsh.analyse({
      ...base, vapourPressurePa: 70140, densityKgM3: 965,
    }), WATER20);
    expect(r.pressureHeadM).toBeLessThan(4);
    expect(r.cavitating || r.marginalPerHi).toBe(true);
    await shot(page, 'hot');
  });

  test('05 Altitude 3000 m (70 kPa) drops NPSH_A (cam #5)', async () => {
    const sea = await page.evaluate((base) => window.forge.pumpnpsh.analyse(base), WATER20);
    const alt = await page.evaluate((base) => window.forge.pumpnpsh.analyse({
      ...base, atmosphericPressurePa: 70000,
    }), WATER20);
    expect(alt.availableNpshM).toBeLessThan(sea.availableNpshM);
    await shot(page, 'altitude');
  });

  test('06 Marginal margin < 1 m triggers HI flag (cam #6)', async () => {
    const r = await page.evaluate((base) => window.forge.pumpnpsh.analyse({
      ...base, staticSuctionHeadM: 0, frictionHeadM: 5.5,
    }), WATER20);
    expect(r.cavitating).toBe(false);
    expect(r.marginalPerHi).toBe(true);
    expect(r.marginM).toBeLessThan(1.0);
    await shot(page, 'marginal');
  });

  test('07 Panel renders NPSH_A + status', async () => {
    await page.evaluate(() => { window.__forgeOpenPumpNpshWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-pumpnpsh-run"]').click();
    await page.waitForSelector('[data-testid="forge-pumpnpsh-result"]', { timeout: 5000 });
    const npsha = await page.locator('[data-testid="forge-pumpnpsh-npsha"]').innerText();
    const status = await page.locator('[data-testid="forge-pumpnpsh-status"]').innerText();
    expect(npsha).toMatch(/NPSH_A/);
    expect(status).toMatch(/SAFE|MARGINAL|CAVITATING/);
  });

  test('08 Menu route opens NPSH panel', async () => {
    await page.evaluate(() => { window.__forgeClosePumpNpshWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.pumpnpsh' } }));
    });
    await page.waitForSelector('[data-testid="forge-pumpnpsh-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
