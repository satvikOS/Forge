// v4-parts-expansion.spec.js — Forge-108 headed verification.
//
// Verifies the Forge-108 standard-parts catalogue expansion: new
// categories (motors, gearmotors, hydraulic, pneumatic, pulleys,
// sprockets, chain, extrusion, brackets, cable, fittings) all surface
// items, switch correctly, and clicking the first entry in each
// category emits a native body record through the
// __forgeStandardPartsInsert hook.
//
// Headed Electron (Mac-Electron rule from feedback memory). Screenshots
// per category step into /tmp/v4-parts-expansion/.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-parts-expansion';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR,
    `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

const NEW_CATEGORIES = [
  'motors', 'gearmotors', 'hydraulic', 'pneumatic',
  'pulleys', 'sprockets', 'chain',
  'extrusion', 'brackets', 'cable', 'fittings',
];

test.describe.serial('Forge v4 · Forge-108 parts expansion', () => {
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

  test('01 install mock kernel + mount library host', async () => {
    await page.evaluate(async () => {
      // Mock kernel — records every call so we can confirm the build
      // function ran via real primitives + booleans.
      const log = [];
      let nextHandle = 1000;
      const f = {
        isReady: () => true,
        makeBox: (dx, dy, dz) => { const h = ++nextHandle;
                                   log.push(['makeBox', dx, dy, dz, h]); return h; },
        makeCylinder: (r, h2) => { const h = ++nextHandle;
                                   log.push(['makeCylinder', r, h2, h]); return h; },
        makeSphere: (r) => { const h = ++nextHandle;
                             log.push(['makeSphere', r, h]); return h; },
        makeCone: (r1, r2, h2) => { const h = ++nextHandle;
                                    log.push(['makeCone', r1, r2, h2, h]); return h; },
        makeTorus: (R, r) => { const h = ++nextHandle;
                               log.push(['makeTorus', R, r, h]); return h; },
        fuse: (a, b) => { const h = ++nextHandle;
                          log.push(['fuse', a, b, h]); return h; },
        cut: (a, b) => { const h = ++nextHandle;
                         log.push(['cut', a, b, h]); return h; },
        common: (a, b) => { const h = ++nextHandle;
                            log.push(['common', a, b, h]); return h; },
        translate: (h2, dx, dy, dz) => { const h = ++nextHandle;
                                         log.push(['translate', h2, dx, dy, dz, h]); return h; },
        rotate: (h2, ax, ay, az, ang) => { const h = ++nextHandle;
                                            log.push(['rotate', h2, ax, ay, az, ang, h]); return h; },
        tessellate: () => ({ positions: new Float32Array(),
                             indices: new Uint32Array(),
                             normals: new Float32Array(),
                             triangleCount: 0 }),
      };
      window.forge = f;
      window.__kernelLog = log;
      window.__insertedBodies = [];
      window.__forgeStandardPartsInsert = (record) => {
        window.__insertedBodies.push(record);
      };

      // Mount the library host into a fresh React tree.
      const div = document.createElement('div');
      div.id = 'forge-parts-expansion-host';
      document.body.appendChild(div);
      const mod = await import('/src/forge-v4/StandardPartsLibrary.jsx');
      const React = await import('react');
      const ReactDOM = await import('react-dom/client');
      const root = ReactDOM.createRoot(div);
      root.render(React.createElement(mod.StandardPartsLibraryHost));
      await new Promise((r) => setTimeout(r, 100));
      window.__forgeOpenStandardParts(true);
    });
    await page.waitForTimeout(600);
    await shot(page, 'panel-open');
    const panelCount = await page
      .locator('[data-testid="forge-standard-parts"]').count();
    expect(panelCount, 'panel mounted').toBe(1);
  });

  test('02 all 11 new category tabs present in nav', async () => {
    for (const c of NEW_CATEGORIES) {
      const tab = page.locator(`[data-cat="${c}"]`);
      await expect(tab,
        `category tab ${c} present`).toBeVisible({ timeout: 1500 });
    }
    await shot(page, 'all-tabs-visible');
  });

  // Sub-tests for each new category — switch + click first entry +
  // assert insert hook fired and made real kernel calls.
  for (const cat of NEW_CATEGORIES) {
    test(`03-${cat} switches + click first entry emits body`, async () => {
      // Clear filter so the first entry is visible.
      await page.fill('[data-testid="forge-standard-parts-filter"]', '');
      await page.waitForTimeout(150);
      await page.click(`[data-cat="${cat}"]`);
      await page.waitForTimeout(250);
      // Reset state to measure this click's effect.
      await page.evaluate(() => { window.__kernelLog.length = 0;
                                   window.__insertedBodies.length = 0; });
      const items = page.locator('[data-testid="forge-standard-part"]');
      const count = await items.count();
      expect(count, `${cat} has at least 1 entry`).toBeGreaterThan(0);
      const first = items.first();
      await expect(first).toBeVisible({ timeout: 2000 });
      await first.click();
      await page.waitForTimeout(400);
      await shot(page, `cat-${cat}`);

      // 1) Kernel ops fired.
      const log = await page.evaluate(() => window.__kernelLog.slice());
      expect(log.length, `${cat}: kernel calls fired`).toBeGreaterThan(0);
      // 2) At least one primitive op (Box/Cylinder/Sphere/Cone/Torus) was
      //    used — confirming real B-rep composition.
      const primitives = log.map((r) => r[0]).filter((op) =>
        ['makeBox', 'makeCylinder', 'makeSphere',
         'makeCone', 'makeTorus'].includes(op));
      expect(primitives.length,
        `${cat}: at least one primitive`).toBeGreaterThan(0);
      // 3) Body record emitted via __forgeStandardPartsInsert.
      const bodies = await page.evaluate(() => window.__insertedBodies.slice());
      expect(bodies.length, `${cat}: insert hook fired`).toBe(1);
      expect(bodies[0].kind, `${cat}: body is native`).toBe('native');
      expect(typeof bodies[0].handle,
        `${cat}: handle is number`).toBe('number');
      expect(bodies[0].params.partId,
        `${cat}: partId stamped`).toBeTruthy();
    });
  }

  test('04 fasteners + bearings still work (no regression)', async () => {
    await page.fill('[data-testid="forge-standard-parts-filter"]', '');
    await page.waitForTimeout(150);
    for (const cat of ['fasteners', 'bearings', 'profiles', 'gears']) {
      await page.click(`[data-cat="${cat}"]`);
      await page.waitForTimeout(200);
      const items = await page
        .locator('[data-testid="forge-standard-part"]').count();
      expect(items, `${cat} still has items`).toBeGreaterThan(0);
    }
    await shot(page, 'no-regression');
  });

  test('05 catalogue totals reflect expansion', async () => {
    // Snapshot per-category counts via the imported helper.
    const counts = await page.evaluate(async () => {
      const mod = await import('/src/forge-v4/StandardPartsLibrary.jsx');
      const all = mod.getStandardParts();
      const byCat = {};
      for (const p of all) byCat[p.category] = (byCat[p.category] || 0) + 1;
      return { total: all.length, byCat };
    });
    // Sanity floors per category (real counts will exceed).
    expect(counts.byCat.motors,     'motors >= 9').toBeGreaterThanOrEqual(9);
    expect(counts.byCat.gearmotors, 'gearmotors >= 6').toBeGreaterThanOrEqual(6);
    expect(counts.byCat.hydraulic,  'hydraulic >= 8').toBeGreaterThanOrEqual(8);
    expect(counts.byCat.pneumatic,  'pneumatic >= 16').toBeGreaterThanOrEqual(16);
    expect(counts.byCat.pulleys,    'pulleys >= 30').toBeGreaterThanOrEqual(30);
    expect(counts.byCat.sprockets,  'sprockets >= 16').toBeGreaterThanOrEqual(16);
    expect(counts.byCat.chain,      'chain >= 4').toBeGreaterThanOrEqual(4);
    expect(counts.byCat.extrusion,  'extrusion >= 6').toBeGreaterThanOrEqual(6);
    expect(counts.byCat.brackets,   'brackets >= 6').toBeGreaterThanOrEqual(6);
    expect(counts.byCat.cable,      'cable >= 3').toBeGreaterThanOrEqual(3);
    expect(counts.byCat.fittings,   'fittings >= 9').toBeGreaterThanOrEqual(9);
    expect(counts.total, 'total > 100').toBeGreaterThan(100);
    // Capture a final screenshot for sanity-watching.
    await shot(page, 'totals-verified');
  });
});
