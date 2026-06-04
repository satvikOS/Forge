// v4-317-detention.spec.js — Forge-317 stormwater detention basin.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-317-detention';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const STD = {
  areaHa: 10, runoffCoeffPre: 0.30, runoffCoeffPost: 0.75,
  designIntensityMmHr: 50, allowableReleaseRatio: 1.0,
  timeOfConcentrationMin: 20, designStormDurationMin: 60,
};

test.describe.configure({ timeout: 180000 });
test.describe.serial('Forge-317 · detention basin', () => {
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
      !!(window.forge && window.forge.detention
         && typeof window.forge.detention.analyse === 'function'));
    expect(has).toBe(true);
  });

  test('02 10 ha, 0.30→0.75, i=50: V=2250 m³, required (cam #2)', async () => {
    const r = await page.evaluate((b) => window.forge.detention.analyse(b), STD);
    expect(r.areaM2).toBe(100000);
    expect(r.preDevQM3PerS).toBeCloseTo(0.30 * 50 / 3.6e6 * 100000, 5);
    expect(r.postDevQM3PerS).toBeCloseTo(0.75 * 50 / 3.6e6 * 100000, 5);
    expect(r.allowableReleaseQM3PerS).toBeCloseTo(r.preDevQM3PerS, 5);
    expect(r.detentionVolumeM3).toBeCloseTo(2250, 1);
    expect(r.detentionRequired).toBe(true);
    await shot(page, 'standard');
  });

  test('03 No C change → V=0, not required (cam #3)', async () => {
    const r = await page.evaluate(() => window.forge.detention.analyse({
      areaHa: 10, runoffCoeffPre: 0.5, runoffCoeffPost: 0.5,
      designIntensityMmHr: 50, allowableReleaseRatio: 1.0,
      timeOfConcentrationMin: 20, designStormDurationMin: 60,
    }));
    expect(r.detentionVolumeM3).toBe(0);
    expect(r.detentionRequired).toBe(false);
    await shot(page, 'no-detention');
  });

  test('04 Tighter α=0.5 → more storage (cam #4)', async () => {
    const r1 = await page.evaluate((b) => window.forge.detention.analyse(b), STD);
    const r2 = await page.evaluate((b) => window.forge.detention.analyse({
      ...b, allowableReleaseRatio: 0.5,
    }), STD);
    expect(r2.detentionVolumeM3).toBeGreaterThan(r1.detentionVolumeM3);
    expect(r2.allowableReleaseQM3PerS).toBeCloseTo(0.5 * r1.preDevQM3PerS, 5);
    await shot(page, 'tighter');
  });

  test('05 V_storage linear in T_d (cam #5)', async () => {
    const r60  = await page.evaluate((b) => window.forge.detention.analyse(b), STD);
    const r120 = await page.evaluate((b) => window.forge.detention.analyse({
      ...b, designStormDurationMin: 120,
    }), STD);
    expect(r120.detentionVolumeM3 / r60.detentionVolumeM3).toBeCloseTo(2.0, 4);
    await shot(page, 'duration');
  });

  test('06 Higher i scales both Q linearly (cam #6)', async () => {
    const r50  = await page.evaluate((b) => window.forge.detention.analyse(b), STD);
    const r100 = await page.evaluate((b) => window.forge.detention.analyse({
      ...b, designIntensityMmHr: 100,
    }), STD);
    expect(r100.preDevQM3PerS / r50.preDevQM3PerS).toBeCloseTo(2.0, 5);
    expect(r100.postDevQM3PerS / r50.postDevQM3PerS).toBeCloseTo(2.0, 5);
    expect(r100.detentionVolumeM3 / r50.detentionVolumeM3).toBeCloseTo(2.0, 5);
    await shot(page, 'intensity');
  });

  test('07 Panel renders V + required banner', async () => {
    await page.evaluate(() => { window.__forgeOpenDetentionBasinWorkbench?.(); });
    await page.waitForTimeout(300);
    await page.locator('[data-testid="forge-db-run"]').click();
    await page.waitForSelector('[data-testid="forge-db-result"]', { timeout: 5000 });
    const V = await page.locator('[data-testid="forge-db-V"]').innerText();
    const req = await page.locator('[data-testid="forge-db-required"]').innerText();
    expect(V).toMatch(/V_storage/);
    expect(req).toMatch(/Detention|detention/);
  });

  test('08 Menu route opens basin panel', async () => {
    await page.evaluate(() => { window.__forgeCloseDetentionBasinWorkbench?.(); });
    await page.waitForTimeout(200);
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('forge:menu-action',
        { detail: { id: 'tools.detention' } }));
    });
    await page.waitForSelector('[data-testid="forge-db-panel"]', { timeout: 2000 });
  });

  test('09 Manual UI did not post to Archie', async () => {
    const archieMsgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(archieMsgs).toBe(0);
  });
});
