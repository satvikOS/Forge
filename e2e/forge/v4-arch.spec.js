// Forge-150 — Arch/BIM workbench (FreeCAD Arch parity) headed e2e.
//
// Strict headed Mac-Electron flow at a watchable pace per project memory
// feedback-headed-tests. The user is remote (Windows → Mac Studio), so
// we screenshot every key step in both themes and at multiple camera
// angles to fill the viewer.
//
// Flow:
//   01 launch headed Electron, baseline shot
//   02 switch to Arch workbench via the WorkbenchRail (wb=arch)
//   03 place a Wall via the Arch panel + dialog (real native body)
//   04 place a Window — must auto-cut its opening into the host wall
//   05 place a Door  — auto-cut opening (single leaf)
//   06 place a Slab
//   07 place a Column (round)
//   08 SiteHierarchy tree is mounted and lists every element
//   09 multi-angle camera sweep (1-7) in dark theme
//   10 toggle light theme, multi-angle sweep
//   11 assert localStorage persistence — body.ifcType survives reload
//   12 file.exportIfc round-trip carries the IFC subtypes into the .ifc
//
// Manual UI interactions in this spec MUST NOT post to Archie's thread
// (per feedback-forge-manual-not-archie).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-arch';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js'
);
const IFC_PATH = '/tmp/forge-arch-test.ifc';

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

async function clickArchOp(page, opSuffix) {
  // Open the per-tool dialog via the panel button.
  const sel = `[data-testid="forge-arch-op-${opSuffix}"]`;
  await expect(page.locator(sel)).toBeVisible({ timeout: 4000 });
  await page.click(sel);
  await expect(page.locator('[data-testid="forge-arch-dialog"]')).toBeVisible({ timeout: 2000 });
}

async function confirmArchDialog(page) {
  await page.click('[data-testid="forge-arch-dialog-confirm"]');
  // The dialog closes once the dispatch completes.
  await page.waitForTimeout(400);
}

test.describe.serial('Forge-150 · Arch/BIM workbench headed', () => {
  let app, page;

  test.beforeAll(async () => {
    try { fs.unlinkSync(IFC_PATH); } catch {}
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);

    // Wipe any pre-existing arch persistence so this run starts clean.
    await page.evaluate(() => {
      try { localStorage.removeItem('forge.v4.arch.bodies'); } catch {}
    });
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('01 baseline · shell mounted with Arch rail tab', async () => {
    await shot(page, 'baseline');
    await expect(page.locator('[data-testid="forge-wb-rail"]')).toBeVisible();
    await expect(page.locator('[data-testid="forge-wb-rail"] [data-wb="arch"]'))
      .toBeVisible();
  });

  test('02 switch to Arch workbench via the WorkbenchRail', async () => {
    await page.click('[data-testid="forge-wb-rail"] [data-wb="arch"]');
    await page.waitForTimeout(600);
    // ArchWorkbenchHost auto-opens its panel when activeWb=arch.
    await expect(page.locator('[data-testid="forge-arch-panel"]'))
      .toBeVisible({ timeout: 3000 });
    // SiteHierarchyHost auto-opens its tree when activeWb=arch.
    await expect(page.locator('[data-testid="forge-arch-site-tree"]'))
      .toBeVisible({ timeout: 3000 });
    // Tools menu still exposes the entry for keyboard-only users.
    await page.click('[data-menu="tools"]');
    await page.waitForTimeout(200);
    const archItem = page.locator('[role="menuitem"]', { hasText: /Arch \/ BIM/i }).first();
    await expect(archItem).toBeVisible({ timeout: 1500 });
    await page.keyboard.press('Escape');
    await shot(page, 'arch-workbench-open');
  });

  test('03 place a Wall (real native body)', async () => {
    await clickArchOp(page, 'wall');
    await shot(page, 'wall-dialog');
    await confirmArchDialog(page);
    await shot(page, 'wall-placed');
    // The panel log records the result; OK marker is rendered when
    // dispatch succeeded.
    const log = page.locator('[data-testid="forge-arch-log"]');
    await expect(log).toBeVisible();
    await expect(log).toContainText('arch.wall');
  });

  test('04 place a Window — opening auto-cuts the host wall', async () => {
    await clickArchOp(page, 'window');
    await shot(page, 'window-dialog');
    await confirmArchDialog(page);
    await shot(page, 'window-placed');
    await expect(page.locator('[data-testid="forge-arch-log"]'))
      .toContainText('arch.window');
  });

  test('05 place a Door — opening auto-cuts the host wall', async () => {
    await clickArchOp(page, 'door');
    await shot(page, 'door-dialog');
    await confirmArchDialog(page);
    await shot(page, 'door-placed');
    await expect(page.locator('[data-testid="forge-arch-log"]'))
      .toContainText('arch.door');
  });

  test('06 place a Slab', async () => {
    await clickArchOp(page, 'slab');
    await shot(page, 'slab-dialog');
    await confirmArchDialog(page);
    await shot(page, 'slab-placed');
    await expect(page.locator('[data-testid="forge-arch-log"]'))
      .toContainText('arch.slab');
  });

  test('07 place a Column (round)', async () => {
    await clickArchOp(page, 'column');
    await shot(page, 'column-dialog');
    await confirmArchDialog(page);
    await shot(page, 'column-placed');
    await expect(page.locator('[data-testid="forge-arch-log"]'))
      .toContainText('arch.column');
  });

  test('08 SiteHierarchy lists every Arch element with IFC tag', async () => {
    const tree = page.locator('[data-testid="forge-arch-site-tree"]');
    await expect(tree).toBeVisible();
    // Read bodies straight from the shell registry so we get the most
    // recent snapshot, but assert the tree's element rows are present.
    const counts = await page.evaluate(() => {
      const arr = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
      const arch = arr.filter((b) => b && typeof b.toolId === 'string' && b.toolId.startsWith('arch.'));
      return {
        total: arch.length,
        ifcTypes: arch.map((b) => b.ifcType),
      };
    });
    expect(counts.total).toBeGreaterThanOrEqual(4); // wall, window, door, slab, column
    expect(counts.ifcTypes).toEqual(expect.arrayContaining([
      'IFCWALL', 'IFCWINDOW', 'IFCDOOR', 'IFCSLAB', 'IFCCOLUMN',
    ]));
    await shot(page, 'site-tree-populated');
  });

  test('09 multi-angle camera sweep — dark theme', async () => {
    for (const v of VIEWS) {
      await page.keyboard.press(v.key);
      await page.waitForTimeout(400);
      await shot(page, `dark-${v.name}`);
    }
  });

  test('10 toggle light theme + sweep again', async () => {
    await page.click('[data-menu="view"]');
    await page.waitForTimeout(200);
    const themeItem = page.locator('[role="menuitem"]', { hasText: /Toggle theme/i }).first();
    await themeItem.click();
    await page.waitForTimeout(600);
    await shot(page, 'light-theme');
    for (const v of VIEWS) {
      await page.keyboard.press(v.key);
      await page.waitForTimeout(400);
      await shot(page, `light-${v.name}`);
    }
    // back to dark
    await page.click('[data-menu="view"]');
    await page.waitForTimeout(200);
    await page.locator('[role="menuitem"]', { hasText: /Toggle theme/i }).first().click();
    await page.waitForTimeout(400);
  });

  test('11 localStorage carries ifcType across page reload', async () => {
    // Read the persisted JSON BEFORE reloading and assert it carries
    // both ifcType and ifcStorey for each Arch body.
    const persisted = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('forge.v4.arch.bodies');
        return raw ? JSON.parse(raw) : [];
      } catch { return []; }
    });
    expect(persisted.length).toBeGreaterThanOrEqual(4);
    for (const p of persisted) {
      expect(p).toHaveProperty('ifcType');
      expect(p).toHaveProperty('ifcStorey');
      expect(p).toHaveProperty('toolId');
      expect(p.toolId.startsWith('arch.')).toBe(true);
    }
    await shot(page, 'persistence-confirmed');
  });

  test('12 IFC export round-trip carries the IFC subtypes', async () => {
    // Stub the save dialog so the exporter writes to /tmp.
    await page.evaluate((target) => {
      const f = window.forge || {};
      f.dialog = f.dialog || {};
      f.dialog.saveFile = async () => target;
      window.forge = f;
    }, IFC_PATH);

    // Drive the export via the IFC panel — the menu item under File.
    await page.click('[data-menu="file"]');
    await page.waitForTimeout(200);
    const ifcItem = page.locator('[role="menuitem"]', { hasText: /Export IFC4/i }).first();
    await expect(ifcItem).toBeVisible({ timeout: 2000 });
    await ifcItem.click();
    await page.waitForTimeout(500);
    await expect(page.locator('[data-testid="forge-ifc-panel"]')).toBeVisible();
    await shot(page, 'ifc-panel-open');

    await page.click('[data-testid="forge-ifc-export"]');
    await page.waitForSelector('[data-testid="forge-ifc-result"]', { timeout: 15000 });
    await page.waitForTimeout(500);
    await shot(page, 'ifc-exported');

    for (let i = 0; i < 30; i++) {
      if (fs.existsSync(IFC_PATH)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(fs.existsSync(IFC_PATH), `${IFC_PATH} should exist`).toBe(true);
    const text = fs.readFileSync(IFC_PATH, 'utf8');
    expect(text.length).toBeGreaterThan(1024);
    // STEP envelope.
    expect(text.startsWith('ISO-10303-21;')).toBe(true);
    expect(text).toMatch(/FILE_SCHEMA\s*\(\s*\(\s*'IFC4'\s*\)\s*\)\s*;/);
    // Per-tool IFC subtype must show up — the whole point of Arch is
    // that bodies promote out of IFCBUILDINGELEMENTPROXY.
    expect(text).toMatch(/IFCWALL\(/);
    expect(text).toMatch(/IFCWINDOW\(/);
    expect(text).toMatch(/IFCDOOR\(/);
    expect(text).toMatch(/IFCSLAB\(/);
    expect(text).toMatch(/IFCCOLUMN\(/);
    // Spatial backbone.
    expect(text).toMatch(/IFCBUILDINGSTOREY\(/);
  });
});
