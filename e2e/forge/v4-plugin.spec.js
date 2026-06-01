// v4-plugin.spec.js — Forge-134 headed-Electron verification.
//
// HUMAN-STYLE click path:
//   1. Launch the v4 shell in headed Electron.
//   2. Click Tools menu → Plugin Manager menu item.
//   3. Click "Install from String" → paste a real test plugin → Install.
//   4. The plugin registers a Tools-menu item + a tool definition.
//   5. Open Tools menu, assert the new menu item is visible, click it,
//      assert the toast fires from the plugin's action.
//   6. Open Plugin Manager again, click Uninstall, assert the Tools
//      menu no longer contains the entry.
//
// Multi-angle screenshots at each step under /tmp/v4-plugin/.
//
// HARD RULES honoured:
//   - All UI interaction is clicks (textarea fill counts as a paste).
//   - No Archie thread writes during the test.
//   - The plugin runtime evaluates `new Function()` against `window.Forge`,
//     so the assertions also confirm the public API surface is wired.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-plugin';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

// Real plugin source. Uses Forge API to register a tool + a Tools-menu
// item whose action fires Forge.toast (which surfaces the shell's
// showToast → data-testid="forge-toast"). Both contributions get
// itemised in the manifest header so the Plugin Manager UI shows
// non-zero hooks/menus/tools counts.
const TEST_PLUGIN_SOURCE = `
// @name forge-test-greeter
// @version 1.0.0
// @author satvik
// @minApi 0.0.1
// @hooks onStartup
return {
  hooks: ['onStartup'],
  menuContributions: [
    {
      menuId: 'tools',
      item: {
        id: 'greeter.hello',
        label: 'Plugin Hello',
        icon: 'misc.settings',
        action: function () {
          Forge.toast('hello from forge-test-greeter', 'ok');
        },
      },
    },
  ],
  toolContributions: [
    {
      id: 'plugin.greeter.tool',
      label: 'Greeter tool',
      icon: 'misc.kbd',
      run: function (ctx, params) {
        Forge.toast('greeter tool ran', 'ok');
        return { ok: true };
      },
    },
  ],
  onStartup: function (F) {
    F.toast('greeter startup', 'info');
  },
};
`.trim();

test.describe.serial('Forge v4 · Plugin API + Plugin Manager (Forge-134)', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500); // r3f + shell mount settle
    // Wipe any persisted plugin from a previous run so the spec is
    // deterministic. We never assert against this LS state directly.
    await page.evaluate(() => {
      try { localStorage.removeItem('forge.v4.plugins'); } catch {}
    });
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('00 window.Forge surface is published and frozen', async () => {
    await shot(page, 'initial');
    const surface = await page.evaluate(() => {
      const F = window.Forge;
      if (!F) return { hasForge: false };
      return {
        hasForge: true,
        version: F.VERSION,
        capabilities: F.capabilities,
        methods: {
          sceneBodies: Array.isArray(F.scene.bodies),
          addBody: typeof F.scene.addBody === 'function',
          toolsDispatch: typeof F.tools.dispatch === 'function',
          registerTool: typeof F.tools.registerTool === 'function',
          menuAddItem: typeof F.menu.addItem === 'function',
          menuAddMenu: typeof F.menu.addMenu === 'function',
          dialogPrompt: typeof F.dialog.prompt === 'function',
          dialogConfirm: typeof F.dialog.confirm === 'function',
          toast: typeof F.toast === 'function',
          materialSet: typeof F.material.set === 'function',
          workbenchSwitchTo: typeof F.workbench.switchTo === 'function',
          workbenchCurrent: typeof F.workbench.current === 'function',
          workbenchAdd: typeof F.workbench.addWorkbench === 'function',
          viewportCamera: typeof F.viewport.camera === 'function',
          viewportFit: typeof F.viewport.fit === 'function',
          on: typeof F.on === 'function',
          off: typeof F.off === 'function',
        },
        frozen: Object.isFrozen(F),
      };
    });
    expect(surface.hasForge).toBe(true);
    expect(surface.version).toBeTruthy();
    expect(surface.frozen).toBe(true);
    expect(Array.isArray(surface.capabilities)).toBe(true);
    for (const [k, v] of Object.entries(surface.methods)) {
      expect(v, `Forge.${k} is wired`).toBe(true);
    }
  });

  test('01 click Tools menu → Plugin Manager opens the panel', async () => {
    // Open Tools dropdown by clicking the menu button.
    await page.click('[data-menu="tools"]');
    await page.waitForTimeout(150);
    await shot(page, 'tools-menu-open');
    // Plugin Manager entry is in the Tools menu.
    const pluginEntry = page.locator('[data-menu-item="tools.plugins"]');
    await expect(pluginEntry).toBeVisible({ timeout: 2000 });
    await pluginEntry.click();
    await page.waitForTimeout(300);
    await shot(page, 'plugin-manager-opened');
    // Plugin Manager panel modal is visible.
    await expect(page.locator('[data-testid="forge-plugin-manager"]'))
      .toBeVisible({ timeout: 2000 });
    // No plugins installed yet — empty state.
    const list = page.locator('[data-testid="forge-plugin-list"]');
    await expect(list).toContainText(/No plugins installed/i);
  });

  test('02 click Install from String → paste plugin → Install', async () => {
    await page.click('[data-testid="forge-plugin-install-string-btn"]');
    await page.waitForTimeout(200);
    await shot(page, 'install-modal-open');
    await expect(page.locator('[data-testid="forge-plugin-install-modal"]'))
      .toBeVisible({ timeout: 1500 });
    // Paste the plugin source into the textarea (typing simulates a
    // user paste — Playwright's fill() is the canonical click-only way
    // to deliver multi-line text to a textarea).
    const input = page.locator('[data-testid="forge-plugin-install-input"]');
    await input.fill(TEST_PLUGIN_SOURCE);
    await page.waitForTimeout(100);
    await shot(page, 'install-modal-filled');
    await page.click('[data-testid="forge-plugin-install-submit"]');
    await page.waitForTimeout(400);
    await shot(page, 'after-install-submit');
    // The plugin row appears in the manager list with non-zero hooks/menus.
    const row = page.locator('[data-testid="forge-plugin-row-forge-test-greeter"]');
    await expect(row).toBeVisible({ timeout: 2000 });
    const hookCount = await page
      .locator('[data-testid="forge-plugin-hooks-forge-test-greeter"]').innerText();
    const menuCount = await page
      .locator('[data-testid="forge-plugin-menus-forge-test-greeter"]').innerText();
    expect(hookCount).toMatch(/hooks 1/);
    expect(menuCount).toMatch(/menus 1/);
    // Toast confirming install fired from the panel.
    const toast = page.locator('[data-testid="forge-toast"]');
    await expect(toast).toBeVisible({ timeout: 1500 });
  });

  test('03 close Plugin Manager → Tools menu now lists the plugin item', async () => {
    await page.click('[data-testid="forge-plugin-manager-close"]');
    await page.waitForTimeout(200);
    await shot(page, 'plugin-manager-closed');
    // Reopen the Tools menu and confirm the new entry rendered.
    await page.click('[data-menu="tools"]');
    await page.waitForTimeout(200);
    await shot(page, 'tools-menu-with-plugin');
    const pluginItem = page.locator('[data-menu-item="tools.greeter.hello"]');
    await expect(pluginItem).toBeVisible({ timeout: 2000 });
    await expect(pluginItem).toHaveAttribute('data-plugin', 'true');
  });

  test('04 click plugin menu item → plugin toast fires', async () => {
    // Plugin item is already visible from step 03.
    await page.click('[data-menu-item="tools.greeter.hello"]');
    await page.waitForTimeout(300);
    await shot(page, 'after-plugin-menu-click');
    // Toast text comes from the plugin's own Forge.toast call.
    const toast = page.locator('[data-testid="forge-toast"]');
    await expect(toast).toBeVisible({ timeout: 1500 });
    await expect(toast).toContainText(/hello from forge-test-greeter/);
  });

  test('05 tool dispatch through Forge.tools.dispatch hits plugin run()', async () => {
    // This is the API-level confirmation that the plugin's tool
    // registration is live. The click-only chain ran in step 04;
    // here we exercise the dispatch path the way plugin code would.
    const result = await page.evaluate(() => {
      return window.Forge.tools.dispatch('plugin.greeter.tool', {});
    });
    expect(result).toEqual({ ok: true });
    await page.waitForTimeout(400);
    await shot(page, 'after-tool-dispatch');
    const toast = page.locator('[data-testid="forge-toast"]');
    await expect(toast).toContainText(/greeter tool ran/);
  });

  test('06 plugin persists to localStorage', async () => {
    const persisted = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('forge.v4.plugins')); }
      catch { return null; }
    });
    expect(persisted).not.toBeNull();
    expect(persisted['forge-test-greeter']).toBeDefined();
    expect(persisted['forge-test-greeter'].enabled).toBe(true);
  });

  test('07 Tools menu → Plugin Manager → Uninstall removes the plugin', async () => {
    await page.click('[data-menu="tools"]');
    await page.waitForTimeout(150);
    await page.click('[data-menu-item="tools.plugins"]');
    await page.waitForTimeout(250);
    await expect(page.locator('[data-testid="forge-plugin-manager"]'))
      .toBeVisible();
    await shot(page, 'plugin-manager-reopened');
    await page.click('[data-testid="forge-plugin-uninstall-forge-test-greeter"]');
    await page.waitForTimeout(300);
    await shot(page, 'after-uninstall');
    // Row gone from the list.
    await expect(
      page.locator('[data-testid="forge-plugin-row-forge-test-greeter"]')
    ).toHaveCount(0);
    // Empty state restored.
    await expect(page.locator('[data-testid="forge-plugin-list"]'))
      .toContainText(/No plugins installed/i);
  });

  test('08 plugin menu item is gone from Tools after uninstall', async () => {
    await page.click('[data-testid="forge-plugin-manager-close"]');
    await page.waitForTimeout(200);
    await page.click('[data-menu="tools"]');
    await page.waitForTimeout(200);
    await shot(page, 'tools-menu-after-uninstall');
    await expect(
      page.locator('[data-menu-item="tools.greeter.hello"]')
    ).toHaveCount(0);
    // localStorage entry cleared too.
    const persisted = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem('forge.v4.plugins') || '{}'); }
      catch { return {}; }
    });
    expect(persisted['forge-test-greeter']).toBeUndefined();
  });

  test('09 manual clicks did not write to Archie thread', async () => {
    // Forge-83 invariant: no thread messages from menu/panel clicks.
    const threadCount = await page
      .locator('[data-testid="forge-archie"] [data-role]').count();
    await shot(page, 'thread-check');
    expect(threadCount).toBe(0);
  });
});
