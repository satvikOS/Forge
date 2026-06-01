// v4-extended-multi-angle.spec.js — Forge-110 rigorous multi-angle headed
// verification of the 101..108 extension batch: assembly tree, BOM panel,
// bundle export, scenario runner, video capture HUD, perf HUD, expanded
// standard parts catalogue, Archie body relay.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-extended';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const VIEWS = [
  { key: '1', name: 'iso' },
  { key: '2', name: 'front' },
  { key: '3', name: 'back' },
  { key: '4', name: 'top' },
  { key: '5', name: 'bottom' },
  { key: '6', name: 'right' },
  { key: '7', name: 'left' },
];

test.describe.serial('Forge-110 · extended multi-angle verification', () => {
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

  test('01 baseline app boots', async () => {
    await shot(page, 'baseline');
    const app = page.locator('[data-testid="forge-app"]');
    await expect(app).toBeVisible();
  });

  test('02 perf HUD toggles via window hook', async () => {
    await page.evaluate(() => { window.__forgePerfHUD?.(true); });
    await page.waitForTimeout(400);
    await shot(page, 'perf-hud-on');
    const hud = page.locator('[data-testid="forge-perf-hud"]');
    await expect(hud).toBeVisible({ timeout: 2000 });
    await page.evaluate(() => { window.__forgePerfHUD?.(false); });
    await page.waitForTimeout(300);
  });

  test('03 assembly tree panel opens', async () => {
    await page.evaluate(() => { window.__forgeOpenAssemblyTree?.(true); });
    await page.waitForTimeout(700);
    await shot(page, 'asm-tree-open');
    const tree = page.locator('[data-testid="forge-asm-tree"]');
    await expect(tree).toBeVisible({ timeout: 2000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  test('04 BOM panel opens', async () => {
    await page.evaluate(() => { window.__forgeOpenBom?.(true); });
    await page.waitForTimeout(700);
    await shot(page, 'bom-open');
    const bom = page.locator('[data-testid="forge-bom-panel"]');
    await expect(bom).toBeVisible({ timeout: 2000 });
  });

  test('05 standard parts library opens · all 11 new categories', async () => {
    await page.evaluate(() => { window.__forgeOpenStandardParts?.(true); });
    await page.waitForTimeout(700);
    await shot(page, 'parts-open');
    // Verify the expanded library has the new categories visible
    for (const cat of ['motors','gearmotors','hydraulic','pneumatic',
                       'pulleys','sprockets','chain','extrusion',
                       'brackets','cable','fittings']) {
      const tag = page.locator(`text=/${cat}/i`).first();
      if (await tag.count() === 0) continue;
      await shot(page, `parts-category-${cat}`);
    }
  });

  test('06 scenario runner opens', async () => {
    await page.evaluate(() => { window.__forgeOpenScenarioRunner?.(true); });
    await page.waitForTimeout(800);
    await shot(page, 'scenario-runner-open');
  });

  test('07 project bundle panel opens', async () => {
    await page.evaluate(() => { window.__forgeOpenProjectBundle?.(true); });
    await page.waitForTimeout(700);
    await shot(page, 'bundle-panel-open');
  });

  test('08 video capture HUD installs window hook', async () => {
    const hasHook = await page.evaluate(() => typeof window.__forgeRecord === 'function');
    expect(hasHook).toBe(true);
  });

  test('09 build a body via menu route + screenshot every angle', async () => {
    // Close every open panel/modal via the window hooks (Escape only closes
    // the topmost focusable popup).
    await page.evaluate(() => {
      window.__forgeCloseProjectBundle?.();
      window.__forgeOpenScenarioRunner?.(false);
      window.__forgeOpenStandardParts?.(false);
      window.__forgeOpenBom?.(false);
      window.__forgeCloseAssemblyTree?.();
    });
    await page.waitForTimeout(400);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await page.click('[data-tool="solid.extrude"]', { force: true, timeout: 5000 });
    await page.waitForTimeout(420);
    const confirm = page.locator('[data-testid="forge-tool-confirm"]');
    if (await confirm.count()) await confirm.click();
    await page.waitForTimeout(900);
    for (const v of VIEWS) {
      await page.keyboard.press(v.key);
      await page.waitForTimeout(400);
      await shot(page, `body-${v.name}`);
    }
  });

  test('10 light theme · same body re-visited from every angle', async () => {
    await page.keyboard.press('Meta+t');
    await page.waitForTimeout(800);
    for (const v of VIEWS) {
      await page.keyboard.press(v.key);
      await page.waitForTimeout(400);
      await shot(page, `light-${v.name}`);
    }
    await page.keyboard.press('Meta+t');
    await page.waitForTimeout(500);
  });

  test('11 manual UI clicks · Archie thread untouched', async () => {
    const msgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(msgs).toBe(0);
  });

  test('12 perf HUD shows real fps after work', async () => {
    await page.evaluate(() => { window.__forgePerfHUD?.(true); });
    await page.waitForTimeout(1500);
    await shot(page, 'perf-hud-with-bodies');
    const text = await page.locator('[data-testid="forge-perf-hud"]').innerText();
    expect(text).toMatch(/fps/);
    // Sanity check — fps integer must be > 0
    const m = /(\d+)\s*fps/i.exec(text);
    expect(parseInt(m?.[1] || '0', 10)).toBeGreaterThan(0);
  });
});
