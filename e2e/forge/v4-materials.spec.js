// Forge-154 — Material library headed-Electron verification.
//
// Boots the real Forge v4 shell, opens the Material Library via the
// Tools menu, searches for "Ti-6Al-4V", and verifies the detail card
// shows the MMPDS-2024 values for Ti Grade 5:
//   YS  = 880 MPa
//   UTS = 950 MPa
//   ρ   = 4430 kg/m³
//
// Every assertion gets a screenshot.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-materials';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR,
    `${String(++n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-154 · Material Library (Ti-6Al-4V verification)', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // Let the shell + r3f bundle + MaterialPickerHost mount.
    await page.waitForTimeout(3500);
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('01 app boots + catalogue API installed', async () => {
    await shot(page, 'baseline');
    await expect(page.locator('[data-testid="forge-app"]')).toBeVisible();
    await page.waitForFunction(
      () => typeof window.__forgeMaterialCatalogue?.count === 'function' &&
            typeof window.__forgeOpenMaterialPicker === 'function',
      { timeout: 5000 },
    );
    const meta = await page.evaluate(() => ({
      total: window.__forgeMaterialCatalogue.count(),
      cats: window.__forgeMaterialCatalogue.listCategories(),
    }));
    expect(meta.total).toBeGreaterThanOrEqual(200);
    expect(meta.cats).toContain('Metal-Titanium');
    expect(meta.cats).toContain('Metal-Steel');
    expect(meta.cats).toContain('Polymer');
  });

  test('02 open Material Library via Tools menu', async () => {
    // Click Tools menu → tools.materials.
    await page.locator('[data-menu="tools"]').click();
    await shot(page, 'tools-menu-open');
    await page.locator('[data-menu-item="tools.materials"]').click();
    await shot(page, 'material-picker-open');
    await expect(page.locator('[data-testid="forge-material-picker"]'))
      .toBeVisible({ timeout: 3000 });
  });

  test('03 search "Ti-6Al-4V" → row appears', async () => {
    await page.locator('[data-testid="forge-material-search"]').fill('Ti-6Al-4V');
    await page.waitForTimeout(250);
    await shot(page, 'search-ti-6al-4v');
    const row = page.locator('[data-material="Ti Grade 5 (Ti-6Al-4V)"]');
    await expect(row).toBeVisible({ timeout: 2000 });
  });

  test('04 detail card shows the MMPDS values', async () => {
    // The first matching row auto-activates the detail card.
    const detail = page.locator('[data-testid="forge-material-detail"]');
    await expect(detail).toBeVisible({ timeout: 2000 });
    await expect(detail).toHaveAttribute(
      'data-material-name', 'Ti Grade 5 (Ti-6Al-4V)');

    // ρ = 4430 kg/m³.
    const dens = await page.locator('[data-testid="material-density"]')
      .innerText();
    expect(dens).toContain('4430');
    expect(dens).toMatch(/kg\/m/);

    // YS = 880 MPa.
    const ys = await page.locator('[data-testid="material-yield"]')
      .innerText();
    expect(ys).toContain('880');
    expect(ys).toContain('MPa');

    // UTS = 950 MPa.
    const uts = await page.locator('[data-testid="material-uts"]')
      .innerText();
    expect(uts).toContain('950');
    expect(uts).toContain('MPa');

    await shot(page, 'ti-6al-4v-detail');
  });

  test('05 Apply button publishes window.__forgeActiveMaterial', async () => {
    await page.locator('[data-testid="forge-material-apply"]').click();
    await page.waitForTimeout(150);
    const applied = await page.evaluate(
      () => window.__forgeActiveMaterial &&
            { name: window.__forgeActiveMaterial.name,
              ys:   window.__forgeActiveMaterial.yieldStrength,
              uts:  window.__forgeActiveMaterial.ultimateTensile,
              rho:  window.__forgeActiveMaterial.density });
    expect(applied).toBeTruthy();
    expect(applied.name).toBe('Ti Grade 5 (Ti-6Al-4V)');
    expect(applied.ys).toBe(880e6);
    expect(applied.uts).toBe(950e6);
    expect(applied.rho).toBe(4430);
    await shot(page, 'applied');
  });

  test('06 category filter narrows to Metal-Titanium', async () => {
    await page.locator('[data-testid="forge-material-search"]').fill('');
    await page.locator('[data-testid="forge-material-category"]')
      .selectOption('Metal-Titanium');
    await page.waitForTimeout(200);
    await shot(page, 'category-titanium');
    const rows = await page.locator('[data-testid^="forge-material-row-"]').count();
    expect(rows).toBeGreaterThanOrEqual(5);   // 10 Ti grades in catalogue.
  });
});
