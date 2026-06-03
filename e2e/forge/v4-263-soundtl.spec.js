// v4-263-soundtl.spec.js — Forge-263 sound transmission loss.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-263-soundtl';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-263 · sound transmission loss', () => {
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
      !!(window.forge && window.forge.soundtl
         && typeof window.forge.soundtl.massLawTL === 'function'
         && typeof window.forge.soundtl.compositeTL === 'function'));
    expect(has).toBe(true);
  });

  test('02 Mass law: 16 mm gypsum at 500 Hz ≈ 28.9 dB (cam #1)', async () => {
    const tl = await page.evaluate(() => window.forge.soundtl.massLawTL({
      surfaceDensityKgPerM2: 12.5, frequencyHz: 500, coincidenceLossDb: 0,
    }));
    expect(tl).toBeCloseTo(28.92, 1);
    await shot(page, 'mass');
  });

  test('03 Doubling mass adds 6 dB (cam #2)', async () => {
    const tl1 = await page.evaluate(() => window.forge.soundtl.massLawTL({
      surfaceDensityKgPerM2: 12.5, frequencyHz: 500, coincidenceLossDb: 0,
    }));
    const tl2 = await page.evaluate(() => window.forge.soundtl.massLawTL({
      surfaceDensityKgPerM2: 25, frequencyHz: 500, coincidenceLossDb: 0,
    }));
    expect(tl2 - tl1).toBeCloseTo(6.02, 1);
    await shot(page, 'mass-double');
  });

  test('04 Doubling frequency adds 6 dB (cam #3)', async () => {
    const tl1 = await page.evaluate(() => window.forge.soundtl.massLawTL({
      surfaceDensityKgPerM2: 12.5, frequencyHz: 500, coincidenceLossDb: 0,
    }));
    const tl2 = await page.evaluate(() => window.forge.soundtl.massLawTL({
      surfaceDensityKgPerM2: 12.5, frequencyHz: 1000, coincidenceLossDb: 0,
    }));
    expect(tl2 - tl1).toBeCloseTo(6.02, 1);
    await shot(page, 'f-double');
  });

  test('05 Coincidence loss subtracts (cam #4)', async () => {
    const baseline = await page.evaluate(() => window.forge.soundtl.massLawTL({
      surfaceDensityKgPerM2: 12.5, frequencyHz: 500, coincidenceLossDb: 0,
    }));
    const dipped = await page.evaluate(() => window.forge.soundtl.massLawTL({
      surfaceDensityKgPerM2: 12.5, frequencyHz: 500, coincidenceLossDb: 8,
    }));
    expect(dipped).toBeCloseTo(baseline - 8, 6);
    await shot(page, 'coincide');
  });

  test('06 Composite: 8 m² @ 50 dB + 0.5 m² @ 30 dB → ~41.7 dB (cam #5)', async () => {
    const tl = await page.evaluate(() => window.forge.soundtl.compositeTL({
      elements: [
        { areaM2: 8.0, transmissionLossDb: 50 },
        { areaM2: 0.5, transmissionLossDb: 30 },
      ],
    }));
    expect(tl).toBeCloseTo(41.66, 1);
    await shot(page, 'composite');
  });

  test('07 Single-element composite preserves TL', async () => {
    const tl = await page.evaluate(() => window.forge.soundtl.compositeTL({
      elements: [{ areaM2: 5, transmissionLossDb: 45 }],
    }));
    expect(tl).toBeCloseTo(45, 6);
  });

  test('08 Composite dominated by weakest element', async () => {
    const tl = await page.evaluate(() => window.forge.soundtl.compositeTL({
      elements: [
        { areaM2: 100, transmissionLossDb: 60 },
        { areaM2: 1, transmissionLossDb: 20 },
      ],
    }));
    // 100·1e-6 + 1·0.01 = 0.0101; /101 = 1e-4; TL = 40 dB
    expect(tl).toBeCloseTo(40, 0);
  });

  test('09 panel tab-switch renders TL in both modes', async () => {
    await page.evaluate(() => { window.__forgeOpenSoundTLWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-soundtl-run"]').click();
    await page.waitForSelector('[data-testid="forge-soundtl-result"]', { timeout: 5000 });
    await page.locator('[data-testid="forge-soundtl-tab-composite"]').click();
    await page.locator('[data-testid="forge-soundtl-run"]').click();
    const r = await page.locator('[data-testid="forge-soundtl-result"]').innerText();
    expect(r).toMatch(/TL/);
    expect(r).toMatch(/dB/);
  });

  test('10 menu route fires soundtl workbench', async () => {
    await page.evaluate(() => { window.__forgeCloseSoundTLWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.soundtl' } }));
    });
    await page.waitForSelector('[data-testid="forge-soundtl-panel"]', { timeout: 2000 });
  });

  test('11 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
