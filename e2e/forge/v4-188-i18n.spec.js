// v4-188-i18n.spec.js — Forge-188 localisation framework.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-188-i18n';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-188 · localisation', () => {
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

  test('01 i18n APIs installed + 5 locales available', async () => {
    await shot(page, 'baseline');
    const apis = await page.evaluate(() => ({
      t:           typeof window.__forgeT,
      setLocale:   typeof window.__forgeSetLocale,
      getLocale:   typeof window.__forgeGetLocale,
      listLocales: typeof window.__forgeListLocales,
      locales:     window.__forgeListLocales().map((l) => l.id),
    }));
    expect(apis.t).toBe('function');
    expect(apis.setLocale).toBe('function');
    expect(apis.getLocale).toBe('function');
    expect(apis.listLocales).toBe('function');
    expect(apis.locales).toEqual(['en-US', 'de-DE', 'fr-FR', 'es-ES', 'ja-JP']);
  });

  test('02 reset to en-US baseline', async () => {
    await page.evaluate(() => {
      window.localStorage.removeItem('forge.v4.locale');
      window.__forgeSetLocale('en-US');
    });
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid="forge-locale-save"]')).toHaveText('Save');
    await expect(page.locator('[data-testid="forge-locale-cancel"]')).toHaveText('Cancel');
    await expect(page.locator('[data-testid="forge-locale-run"]')).toHaveText('Run');
    await shot(page, 'en-us');
  });

  test('03 switch to de-DE → German strings appear', async () => {
    await page.evaluate(() => window.__forgeSetLocale('de-DE'));
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid="forge-locale-save"]')).toHaveText('Speichern');
    await expect(page.locator('[data-testid="forge-locale-cancel"]')).toHaveText('Abbrechen');
    await expect(page.locator('[data-testid="forge-locale-run"]')).toHaveText('Ausführen');
    await expect(page.locator('[data-testid="forge-locale-tools"]')).toHaveText('Werkzeuge');
    await shot(page, 'de-de');
  });

  test('04 switch via the picker dropdown to fr-FR', async () => {
    await page.locator('[data-testid="forge-locale-select"]').selectOption({ value: 'fr-FR' });
    await page.waitForTimeout(200);
    await expect(page.locator('[data-testid="forge-locale-save"]')).toHaveText('Enregistrer');
    await expect(page.locator('[data-testid="forge-locale-run"]')).toHaveText('Exécuter');
    await shot(page, 'fr-fr');
    // Persistence: the choice should land in localStorage.
    const stored = await page.evaluate(() => window.localStorage.getItem('forge.v4.locale'));
    expect(stored).toBe('fr-FR');
  });

  test('05 es-ES + ja-JP quick switches', async () => {
    await page.evaluate(() => window.__forgeSetLocale('es-ES'));
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid="forge-locale-save"]')).toHaveText('Guardar');
    await shot(page, 'es-es');
    await page.evaluate(() => window.__forgeSetLocale('ja-JP'));
    await page.waitForTimeout(150);
    await expect(page.locator('[data-testid="forge-locale-save"]')).toHaveText('保存');
    await expect(page.locator('[data-testid="forge-locale-tools"]')).toHaveText('ツール');
    await shot(page, 'ja-jp');
  });

  test('06 t() with params interpolates correctly', async () => {
    const sample = await page.evaluate(() => {
      window.__forgeSetLocale('en-US');
      return window.__forgeT('autosave.banner', { min: 7, bodies: 2, feats: 5 });
    });
    expect(sample).toContain('7 min');
    expect(sample).toContain('2 bodies');
    expect(sample).toContain('5 features');
  });

  test('07 unknown locale stays on previous one', async () => {
    await page.evaluate(() => window.__forgeSetLocale('en-US'));
    const result = await page.evaluate(() => window.__forgeSetLocale('xx-XX'));
    expect(result).toBe(false);
    const after = await page.evaluate(() => window.__forgeGetLocale());
    expect(after).toBe('en-US');
  });
});
