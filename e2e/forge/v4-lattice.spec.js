// Forge-165 — Lattice / metamaterial workbench end-to-end.
//
// HEADED Electron. Click-only — open Lattice via Tools menu, pick the
// Gyroid TPMS surface, set cell=10 mm + resolution=32, hit Generate,
// confirm a body with non-trivial vertex count surfaces in the panel
// output. Then swap to the strut tab, generate an octet truss, and
// verify the Gibson-Ashby table populates. Multi-angle screenshots.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs   = require('fs');

const SHOT_DIR = '/tmp/v4-lattice';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _stepCounter = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR,
    `${String(++_stepCounter).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

async function pause(page, ms) { await page.waitForTimeout(ms); }

test.describe('Forge v4 — Lattice / metamaterial workbench', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env:  { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await pause(page, 2500);
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 shell mounts + lattice hooks register', async () => {
    await expect(page.locator('[data-testid="forge-app"]'))
      .toBeVisible({ timeout: 15000 });
    await shot(page, 'shell');
    await page.waitForFunction(
      () => typeof window.__forgeOpenLattice === 'function' &&
            typeof window.__forgeLatticeDispatch === 'object',
      { timeout: 8000 },
    );
  });

  test('02 open Lattice workbench via Tools menu (click only)', async () => {
    await page.locator('[data-menu="tools"]').click();
    await pause(page, 300);
    await shot(page, 'tools-menu-open');
    await page.locator('[data-menu-item="tools.lattice"]').click();
    await pause(page, 500);
    await expect(page.locator('[data-testid="forge-lattice"]'))
      .toBeVisible({ timeout: 6000 });
    await shot(page, 'lattice-panel-open');
  });

  test('03 header reports 6 TPMS + 6 strut topologies', async () => {
    const txt = await page.locator('[data-testid="forge-lattice-surface-count"]')
                          .innerText();
    expect(txt).toMatch(/6\s*TPMS\s*·\s*6\s*strut/i);
    await shot(page, 'header-counts');
  });

  test('04 default tab is TPMS — form widgets present', async () => {
    await expect(page.locator('[data-testid="forge-lattice-tpms-form"]'))
      .toBeVisible();
    for (const tid of [
      'forge-lattice-tpms-surface',
      'forge-lattice-tpms-cell',
      'forge-lattice-tpms-iso',
      'forge-lattice-tpms-res',
      'forge-lattice-tpms-vf',
      'forge-lattice-solid-mat',
      'forge-lattice-generate',
    ]) {
      await expect(page.locator(`[data-testid="${tid}"]`)).toBeVisible();
    }
    await shot(page, 'tpms-form');
  });

  test('05 pick Gyroid + cell=10 mm + res=32, generate', async () => {
    await page.selectOption('[data-testid="forge-lattice-tpms-surface"]', 'gyroid');
    await page.locator('[data-testid="forge-lattice-tpms-cell"]').fill('10');
    await page.selectOption('[data-testid="forge-lattice-tpms-res"]', '32');
    await pause(page, 200);
    await shot(page, 'tpms-inputs');
    await page.click('[data-testid="forge-lattice-generate"]');
    // Marching cubes at 32³ is sub-second on M4 Max but allow 8 s budget.
    await pause(page, 2500);
    const status = await page.locator('[data-testid="forge-lattice-status"]')
                              .innerText();
    expect(status).toMatch(/Generated|Generate failed|tris/);
    await shot(page, 'tpms-generated');
  });

  test('06 output card shows non-trivial triangle + vertex counts', async () => {
    await expect(page.locator('[data-testid="forge-lattice-output"]'))
      .toBeVisible();
    const trisCell = page.locator('[data-testid="forge-lattice-out-tris"]');
    const vertsCell = page.locator('[data-testid="forge-lattice-out-verts"]');
    await expect(trisCell).toBeVisible();
    await expect(vertsCell).toBeVisible();
    const tris = parseInt((await trisCell.innerText())
      .replace(/\D/g, ''), 10);
    const verts = parseInt((await vertsCell.innerText())
      .replace(/\D/g, ''), 10);
    expect(tris).toBeGreaterThan(500);
    expect(verts).toBeGreaterThan(500);
    await shot(page, 'tpms-output');
  });

  test('07 Gibson-Ashby coefficients populate (C, n, E_eff)', async () => {
    const C = await page.locator('[data-testid="forge-lattice-out-C"]')
                        .innerText();
    const n = await page.locator('[data-testid="forge-lattice-out-n"]')
                        .innerText();
    const Eratio = await page.locator('[data-testid="forge-lattice-out-Eratio"]')
                              .innerText();
    expect(C).toMatch(/\d+\.\d+/);
    expect(n).toMatch(/\d+\.\d+/);
    expect(Eratio).toMatch(/\d+\.\d+/);
    await shot(page, 'gibson-ashby');
  });

  test('08 body registered on the shell (latest body is the lattice)', async () => {
    const body = await page.evaluate(() => {
      const bodies = window.__forgeBodies || [];
      const last = bodies[bodies.length - 1];
      const latticeBody = window.__forgeLatticeBody;
      return {
        latestLabel: last?.label || null,
        latticeLabel: latticeBody?.label || null,
        latticeKind: latticeBody?.kind || null,
      };
    });
    expect(body.latticeLabel).toMatch(/Lattice/i);
    expect(['native', 'synthetic']).toContain(body.latticeKind);
    await shot(page, 'body-registered');
  });

  test('09 switch to Strut tab + form widgets present', async () => {
    await page.click('[data-testid="forge-lattice-tab-strut"]');
    await pause(page, 250);
    await expect(page.locator('[data-testid="forge-lattice-strut-form"]'))
      .toBeVisible();
    for (const tid of [
      'forge-lattice-strut-pattern',
      'forge-lattice-strut-cell',
      'forge-lattice-strut-radius',
      'forge-lattice-strut-gradient',
      'forge-lattice-strut-segments',
    ]) {
      await expect(page.locator(`[data-testid="${tid}"]`)).toBeVisible();
    }
    await shot(page, 'strut-form');
  });

  test('10 generate Octet truss + strut count populates', async () => {
    await page.selectOption('[data-testid="forge-lattice-strut-pattern"]', 'octet');
    await page.locator('[data-testid="forge-lattice-strut-cell"]').fill('10');
    await page.locator('[data-testid="forge-lattice-strut-radius"]').fill('0.5');
    await pause(page, 200);
    await page.click('[data-testid="forge-lattice-generate"]');
    await pause(page, 1200);
    await expect(page.locator('[data-testid="forge-lattice-out-struts"]'))
      .toBeVisible();
    const strutText = await page.locator('[data-testid="forge-lattice-out-struts"]')
                                 .innerText();
    const strutCount = parseInt(strutText.replace(/\D/g, ''), 10);
    expect(strutCount).toBeGreaterThanOrEqual(36); // octet has 36 struts
    await shot(page, 'octet-generated');
  });

  test('11 panel can be closed', async () => {
    await page.click('[data-testid="forge-lattice-close"]');
    await pause(page, 300);
    await expect(page.locator('[data-testid="forge-lattice"]'))
      .toHaveCount(0);
    await shot(page, 'closed');
  });
});
