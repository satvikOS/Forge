// v4-264-pidtune.spec.js — Forge-264 PID tuning.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-264-pidtune';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-264 · PID tuning', () => {
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
      !!(window.forge && window.forge.pidtuning
         && typeof window.forge.pidtuning.zieglerNichols === 'function'
         && typeof window.forge.pidtuning.cohenCoon === 'function'));
    expect(has).toBe(true);
  });

  test('02 ZN PID textbook: K_u=4, P_u=6 → Kp=2.4, Ti=3, Td=0.75 (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.pidtuning.zieglerNichols({
      controller: 'PID', ultimateGainKu: 4.0, ultimatePeriodPuSec: 6,
    }));
    expect(r.Kp).toBeCloseTo(2.4, 9);
    expect(r.Ti).toBeCloseTo(3.0, 9);
    expect(r.Td).toBeCloseTo(0.75, 9);
    await shot(page, 'ZN-PID');
  });

  test('03 ZN P/PI/PID consistency (cam #2)', async () => {
    const P = await page.evaluate(() => window.forge.pidtuning.zieglerNichols({
      controller: 'P', ultimateGainKu: 4.0, ultimatePeriodPuSec: 6,
    }));
    const PI = await page.evaluate(() => window.forge.pidtuning.zieglerNichols({
      controller: 'PI', ultimateGainKu: 4.0, ultimatePeriodPuSec: 6,
    }));
    expect(P.Kp).toBeCloseTo(2.0, 9);
    expect(PI.Kp).toBeCloseTo(1.8, 9);
    expect(PI.Ti).toBeCloseTo(5.0, 9);
    expect(P.Ti).toBe(0);
    expect(PI.Td).toBe(0);
    await shot(page, 'ZN-PIs');
  });

  test('04 Cohen-Coon PID textbook (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.pidtuning.cohenCoon({
      controller: 'PID', processGainKp: 2.0, timeConstantTau: 10, deadTimeTheta: 2,
    }));
    expect(r.Kp).toBeCloseTo(3.458, 2);
    expect(r.Ti).toBeCloseTo(4.548, 2);
    expect(r.Td).toBeCloseTo(0.702, 2);
    await shot(page, 'CC-PID');
  });

  test('05 ZN doubles Kp when K_u doubles (cam #4)', async () => {
    const r1 = await page.evaluate(() => window.forge.pidtuning.zieglerNichols({
      controller: 'PID', ultimateGainKu: 4.0, ultimatePeriodPuSec: 6,
    }));
    const r2 = await page.evaluate(() => window.forge.pidtuning.zieglerNichols({
      controller: 'PID', ultimateGainKu: 8.0, ultimatePeriodPuSec: 6,
    }));
    expect(r2.Kp / r1.Kp).toBeCloseTo(2.0, 9);
    expect(r2.Ti).toBeCloseTo(r1.Ti, 9);  // Ti depends on P_u not K_u
    await shot(page, 'ZN-scale');
  });

  test('06 CC doubles τ/θ → larger Kp (cam #5)', async () => {
    const fast = await page.evaluate(() => window.forge.pidtuning.cohenCoon({
      controller: 'PID', processGainKp: 2.0, timeConstantTau: 10, deadTimeTheta: 4,
    }));
    const slow = await page.evaluate(() => window.forge.pidtuning.cohenCoon({
      controller: 'PID', processGainKp: 2.0, timeConstantTau: 10, deadTimeTheta: 2,
    }));
    // τ/θ goes 2.5 → 5; larger τ/θ → more aggressive Kp.
    expect(slow.Kp).toBeGreaterThan(fast.Kp);
    await shot(page, 'CC-ratio');
  });

  test('07 invalid inputs throw', async () => {
    let threw = false;
    try {
      await page.evaluate(() => window.forge.pidtuning.zieglerNichols({
        controller: 'PID', ultimateGainKu: 0, ultimatePeriodPuSec: 6,
      }));
    } catch (e) { threw = true; }
    expect(threw).toBe(true);
  });

  test('08 panel tab-switch renders Kp + Ti + Td rows', async () => {
    await page.evaluate(() => { window.__forgeOpenPIDTuneWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-pidtune-run"]').click();
    await page.waitForSelector('[data-testid="forge-pidtune-Td"]', { timeout: 5000 });
    await page.locator('[data-testid="forge-pidtune-tab-cc"]').click();
    await page.locator('[data-testid="forge-pidtune-run"]').click();
    const Td = await page.locator('[data-testid="forge-pidtune-Td"]').innerText();
    expect(Td).toMatch(/T_d/);
  });

  test('09 menu route fires pidtune workbench', async () => {
    await page.evaluate(() => { window.__forgeClosePIDTuneWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.pidtune' } }));
    });
    await page.waitForSelector('[data-testid="forge-pidtune-panel"]', { timeout: 2000 });
  });

  test('10 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
