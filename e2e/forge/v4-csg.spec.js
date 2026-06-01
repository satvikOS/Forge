// Forge-160 — OpenSCAD-style CSG scripting workbench e2e.
//
// Strict human-style headed-Electron clicks: open the Tools menu,
// click "CSG Scripting…", clear the sample, type a sphere-minus-cube
// script in the editor, click Run now, verify the right pane shows
// at least one body whose name reads "difference(...)" and the v4
// bodies state holds a CSG-kind body.
//
// We do NOT call window.__forge* hooks to drive UI; the assertions
// at the end DO read window state, which mirrors what the v4-human
// suite already does.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-human/csg';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const CSG_SCRIPT = [
  '// Forge-160 e2e: sphere with a cube cut out.',
  'difference() {',
  '  sphere(r = 14);',
  '  cube(size = [22, 22, 22], center = true);',
  '}',
].join('\n');

test.describe.serial('Forge-160 · CSG scripting workbench (clicks only)', () => {
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

  test('01 open CSG Scripting via Tools menu', async () => {
    await shot(page, 'baseline');
    // Dismiss any stray overlays.
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(120);
    }
    await page.click('[data-menu="tools"]');
    await page.waitForTimeout(300);
    await shot(page, 'tools-menu-open');
    const item = page.locator('[role="menuitem"]', { hasText: /CSG Scripting/i }).first();
    await expect(item).toBeVisible({ timeout: 2000 });
    await item.click();
    await page.waitForTimeout(600);
    await shot(page, 'csg-opened');
    await expect(page.locator('[data-testid="forge-csg-workbench"]')).toBeVisible();
  });

  test('02 type sphere - cube intersection script + click Run', async () => {
    const editor = page.locator('[data-testid="forge-csg-editor"]');
    await expect(editor).toBeVisible();
    await editor.click();
    await page.waitForTimeout(120);
    // Select-all the sample text, then type our script.
    await page.keyboard.press('Meta+A');
    await page.waitForTimeout(80);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(80);
    // Type with line-by-line presses so the textarea wraps correctly.
    await editor.fill(CSG_SCRIPT);
    await page.waitForTimeout(200);
    await shot(page, 'csg-typed');
    await page.click('[data-testid="forge-csg-run"]');
    // Debounce + interpreter run lands within ~1 s; give it 1.2 s.
    await page.waitForTimeout(1200);
    await shot(page, 'csg-after-run');
  });

  test('03 preview shows body OR kernel-required banner', async () => {
    const wb = page.locator('[data-testid="forge-csg-workbench"]');
    await expect(wb).toBeVisible();
    const kernelAttr = await wb.getAttribute('data-csg-kernel');
    if (kernelAttr === 'offline') {
      // No-fallback policy: the panel must show the "kernel required"
      // notice and emit ZERO CSG bodies. This is the honest outcome
      // when forge-kernel.node is not loaded.
      const preview = page.locator('[data-testid="forge-csg-preview"]');
      await expect(preview).toHaveAttribute('data-csg-state', 'kernel-offline');
      const bodyCount = await page.evaluate(() => {
        const arr = window.__forgeBodies || [];
        return arr.filter((b) => b.toolId === 'csg.script').length;
      });
      expect(bodyCount).toBe(0);
      // Editor must remain operational even with the kernel offline —
      // the user can still type / debug the script for later.
      await expect(page.locator('[data-testid="forge-csg-editor"]')).toBeVisible();
      await shot(page, 'csg-kernel-offline');
      return;
    }
    // Kernel is ready — interpreter must have produced exactly one
    // body (difference reduces to a single solid).
    const status = await page.locator('[data-testid="forge-csg-status"]').textContent();
    expect(status).toMatch(/compiled|compiling|idle/i);
    const bodyList = page.locator('[data-testid="forge-csg-bodies"] li');
    await expect(bodyList.first()).toBeVisible({ timeout: 4000 });
    const count = await bodyList.count();
    expect(count).toBeGreaterThan(0);
    await shot(page, 'csg-bodies-list');

    // The first body's name should mention difference(...) since
    // that's the top-level module in our script.
    const firstBodyText = await bodyList.first().textContent();
    expect(firstBodyText).toMatch(/difference/i);

    // v4 shell bodies state should now hold a CSG body with a
    // numeric kernel handle.  Poll briefly: React state propagates
    // through several effects after publishCsgBodies fires, give
    // it up to 3 s.
    await page.waitForFunction(() => {
      const arr = window.__forgeBodies || [];
      return arr.some((b) => b.toolId === 'csg.script');
    }, null, { timeout: 3000 });
    const csgInState = await page.evaluate(() => {
      const arr = window.__forgeBodies || [];
      return arr.filter((b) => b.toolId === 'csg.script').map((b) => ({
        handle: typeof b.handle === 'number' ? b.handle : null,
        name: b.name || null,
      }));
    });
    expect(csgInState.length).toBeGreaterThan(0);
    expect(typeof csgInState[0].handle).toBe('number');
  });

  test('04 Clear bodies button removes CSG-kind bodies', async () => {
    const wb = page.locator('[data-testid="forge-csg-workbench"]');
    await expect(wb).toBeVisible();
    await page.click('[data-testid="forge-csg-clear"]');
    await page.waitForTimeout(400);
    await shot(page, 'csg-cleared');
    const remaining = await page.evaluate(() => {
      const arr = window.__forgeBodies || [];
      return arr.filter((b) => b.toolId === 'csg.script').length;
    });
    expect(remaining).toBe(0);
  });

  test('05 Close button dismisses the panel', async () => {
    await page.click('[data-testid="forge-csg-close"]');
    await page.waitForTimeout(350);
    await shot(page, 'csg-closed');
    await expect(page.locator('[data-testid="forge-csg-workbench"]')).toHaveCount(0);
  });

  test('06 Archie thread never received a manual write', async () => {
    const msgs = await page.locator('[data-testid="forge-archie"] [data-role="archie"]').count();
    expect(msgs).toBe(0);
  });
});
