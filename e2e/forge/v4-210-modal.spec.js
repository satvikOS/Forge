// v4-210-modal.spec.js — Forge-210 modal analysis.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-210-modal';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-210 · modal analysis', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 kernel bridge wired', async () => {
    await shot(page, 'baseline');
    const has = await page.evaluate(() =>
      !!(window.forge && window.forge.frame
         && typeof window.forge.frame.modal === 'function'));
    expect(has).toBe(true);
  });

  test('02 single axial bar matches textbook f1 (cam #1)', async () => {
    const r = await page.evaluate(() => window.forge.frame.modal({
      nodes: [
        { position: [0, 0, 0], fixed: [true, true, true] },
        { position: [1, 0, 0], fixed: [false, true, true] },
      ],
      elements: [{ a: 0, b: 1, E: 2e11, A: 1e-4, density: 7800 }],
      kModes: 1,
    }));
    expect(r.frequenciesHz.length).toBe(1);
    expect(r.frequenciesHz[0]).toBeCloseTo(1139, -1);  // ±10 Hz
    await shot(page, 'axial-bar');
  });

  test('03 frequencies are monotonically non-decreasing (cam #2)', async () => {
    const r = await page.evaluate(() => {
      const fix = window.__forgeModalFixture(6);
      return window.__forgeFrameModal(fix);
    });
    expect(r.frequenciesHz.length).toBe(6);
    for (let i = 1; i < r.frequenciesHz.length; ++i) {
      expect(r.frequenciesHz[i]).toBeGreaterThanOrEqual(r.frequenciesHz[i - 1]);
    }
    await shot(page, 'monotone');
  });

  test('04 mode shape normalised — max |entry| = 1 (cam #3)', async () => {
    const r = await page.evaluate(() => {
      const fix = window.__forgeModalFixture(3);
      return window.__forgeFrameModal(fix);
    });
    for (let k = 0; k < r.modeShapes.length; ++k) {
      let mx = 0;
      const m = r.modeShapes[k];
      for (let i = 0; i < m.length; ++i) {
        if (Math.abs(m[i]) > mx) mx = Math.abs(m[i]);
      }
      expect(mx).toBeCloseTo(1, 6);
    }
    await shot(page, 'normalised');
  });

  test('05 open the workbench panel (cam #4)', async () => {
    await page.evaluate(() => { window.__forgeOpenModalWorkbench?.(); });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-modal-panel"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-modal-run"]')).toBeVisible();
    await shot(page, 'panel-open');
  });

  test('06 panel run renders frequency list (cam #5)', async () => {
    await page.locator('[data-testid="forge-modal-k"]').fill('5');
    await page.locator('[data-testid="forge-modal-run"]').click();
    await page.waitForSelector('[data-testid="forge-modal-result"]', { timeout: 10000 });
    const text = await page.locator('[data-testid="forge-modal-result"]').innerText();
    expect(text.split('\n').filter((l) => /\d+\s+\d/.test(l)).length).toBeGreaterThanOrEqual(5);
    await shot(page, 'panel-result');
  });

  test('07 manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
