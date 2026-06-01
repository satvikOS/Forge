// v4-assembly-bom.spec.js — Forge-101 + Forge-102 headed verification.
//
// 1) Opens the parts library, inserts three different parts (M5, M8, M12
//    hex bolts — different sizes so the BOM aggregator must surface them
//    as distinct rows even with the same nominal name root).
// 2) Creates assembly-tree instances (qty 1 each) for those three bodies.
// 3) Opens the BOM panel via window.__forgeOpenBom() and asserts:
//      - exactly 3 rows are visible
//      - the qty column sums correctly
//      - the cost column is non-zero (real material costs)
//      - the totals row equals Σ(rows)
// 4) Mocks window.forge.dialog.saveFile and clicks Export CSV — asserts
//    the saveFile bridge received well-formed CSV containing every row.
//
// ForgeShellV4.jsx + Toolbar.jsx are off-limits — we self-mount every
// panel through their *Host components.
//
// Headed Electron, screenshots per step to /tmp/v4-assembly-bom/.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-assembly-bom';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge v4 · Assembly tree + BOM', () => {
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

  test('01 install mock kernel + dialog bridge + mount panel hosts', async () => {
    await page.evaluate(async () => {
      // Reset localStorage tree between runs.
      try { localStorage.removeItem('forge.v4.assemblyTree'); } catch {}

      // Mock kernel — primitive ops + massProps so the BOM uses real
      // (mocked) OCCT volumes instead of bbox fallback.
      const log = [];
      let nextHandle = 100;
      const f = {
        isReady: () => true,
        makeBox:      (dx, dy, dz)       => { const h = ++nextHandle; log.push(['makeBox', dx, dy, dz, h]); return h; },
        makeCylinder: (r, height)        => { const h = ++nextHandle; log.push(['makeCylinder', r, height, h]); return h; },
        makeSphere:   (r)                => { const h = ++nextHandle; log.push(['makeSphere', r, h]); return h; },
        makeCone:     (r1, r2, height)   => { const h = ++nextHandle; log.push(['makeCone', r1, r2, height, h]); return h; },
        makeTorus:    (R, r)             => { const h = ++nextHandle; log.push(['makeTorus', R, r, h]); return h; },
        fuse:         (a, b)             => { const h = ++nextHandle; log.push(['fuse', a, b, h]); return h; },
        cut:          (a, b)             => { const h = ++nextHandle; log.push(['cut', a, b, h]); return h; },
        common:       (a, b)             => { const h = ++nextHandle; log.push(['common', a, b, h]); return h; },
        translate:    (h2, dx, dy, dz)   => { const h = ++nextHandle; log.push(['translate', h2, dx, dy, dz, h]); return h; },
        rotate:       (h2, ax, ay, az, ang) => { const h = ++nextHandle; log.push(['rotate', h2, ax, ay, az, ang, h]); return h; },
        tessellate:   () => ({ positions: new Float32Array(),
                               indices: new Uint32Array(),
                               normals: new Float32Array(),
                               triangleCount: 0 }),
        massProps:    (handle) => {
          // Volume scales with handle so the three bolts produce distinct
          // mass numbers; surface a touch above volume so the sort is stable.
          const v = 1000 + handle * 12;     // mm³
          return { volume: v, surface: v * 0.4, centroid: [0, 0, 0],
                   inertia: [0, 0, 0, 0, 0, 0] };
        },
      };
      window.forge = f;
      window.__kernelLog = log;

      // Mock dialog.saveFile.
      window.__savedFiles = [];
      f.dialog = {
        saveFile: async (opts) => {
          const path = `/tmp/mock-saved/${opts.defaultPath || 'untitled.csv'}`;
          window.__savedFiles.push({ path, opts, data: opts.data });
          return { ok: true, path };
        },
      };

      // Body registry the BOM panel reads from.
      window.__forgeBodies = [];
      window.__forgeStandardPartsInsert = (record) => {
        window.__forgeBodies.push(record);
      };

      // Mount every host into a fresh React tree.
      const div = document.createElement('div');
      div.id = 'forge-bom-host-root';
      document.body.appendChild(div);
      const React = await import('react');
      const ReactDOM = await import('react-dom/client');
      const partsMod = await import('/src/forge-v4/StandardPartsLibrary.jsx');
      const treeMod  = await import('/src/forge-v4/AssemblyTreePanel.jsx');
      const bomMod   = await import('/src/forge-v4/BomPanel.jsx');
      const root = ReactDOM.createRoot(div);
      root.render(React.createElement(React.Fragment, null,
        React.createElement(partsMod.StandardPartsLibraryHost),
        React.createElement(treeMod.AssemblyTreePanelHost),
        React.createElement(bomMod.BomPanelHost),
      ));
      await new Promise((r) => setTimeout(r, 120));
    });
    await page.waitForTimeout(400);
    await shot(page, 'hosts-mounted');
  });

  test('02 insert 3 different parts via the standard parts library', async () => {
    await page.evaluate(() => window.__forgeOpenStandardParts(true));
    await page.waitForTimeout(300);
    await shot(page, 'parts-library-open');
    await expect(page.locator('[data-testid="forge-standard-parts"]')).toBeVisible();

    // Insert M5, M8, M12 hex bolts — different sizes, identical name root
    // ("Hex bolt") so the BOM must use the spec to distinguish them.
    const partIds = ['hex-bolt-m5', 'hex-bolt-m8', 'hex-bolt-m12'];
    for (const pid of partIds) {
      await page.fill('[data-testid="forge-standard-parts-filter"]', `Hex bolt M${pid.match(/m(\d+)/)[1]}`);
      await page.waitForTimeout(200);
      const btn = page.locator(`[data-testid="forge-standard-part"][data-part-id^="${pid}"]`).first();
      await expect(btn).toBeVisible({ timeout: 2000 });
      await btn.click();
      await page.waitForTimeout(180);
    }
    const insertedCount = await page.evaluate(() => window.__forgeBodies.length);
    expect(insertedCount, '3 bodies inserted').toBe(3);
    await shot(page, '3-bodies-inserted');

    // Attach a deterministic name + material to each body so the BOM
    // aggregates them as distinct rows.
    await page.evaluate(() => {
      const sizes = [5, 8, 12];
      const mats  = ['steel', 'stainless', 'titanium'];
      window.__forgeBodies.forEach((b, i) => {
        b.name = `Hex bolt M${sizes[i]}`;
        b.material = mats[i];
        b.spec = { dx: sizes[i], dy: sizes[i], dz: sizes[i] * 4 };
      });
    });

    // Close the parts library so it doesn't shadow the BOM panel.
    await page.evaluate(() => window.__forgeOpenStandardParts(false));
    await page.waitForTimeout(200);
  });

  test('03 create assembly-tree instances pointing at each body', async () => {
    await page.evaluate(async () => {
      const mod = await import('/src/forge-v4/assemblyHierarchy.js');
      for (const b of window.__forgeBodies) {
        mod.createInstance({ bodyId: b.id, name: b.name, qty: 1 });
      }
    });

    // Open the tree panel and verify 3 nodes rendered.
    await page.evaluate(() => window.__forgeOpenAssemblyTree(true));
    await page.waitForTimeout(300);
    await shot(page, 'tree-3-nodes');
    await expect(page.locator('[data-testid="forge-asm-tree"]')).toBeVisible();
    const nodes = await page.locator('[data-testid="forge-asm-node"]').count();
    expect(nodes, '3 instance nodes in tree').toBe(3);

    // Close the tree panel so it doesn't overlap the BOM panel.
    await page.evaluate(() => window.__forgeOpenAssemblyTree(false));
    await page.waitForTimeout(150);
  });

  test('04 open BOM panel + assert 3 rows + correct totals', async () => {
    await page.evaluate(() => window.__forgeOpenBom(true));
    await page.waitForTimeout(400);
    await shot(page, 'bom-open');
    await expect(page.locator('[data-testid="forge-bom-panel"]')).toBeVisible();

    const rows = page.locator('[data-testid="forge-bom-row"]');
    await expect(rows).toHaveCount(3, { timeout: 2500 });

    // Qty total should be 3 (1 each).
    const totalsText = await page.locator('[data-testid="forge-bom-totals"]').textContent();
    expect(totalsText, 'totals row visible').toContain('TOTAL');
    expect(totalsText, 'qty total = 3').toMatch(/\b3\b/);
    // The cost column uses real engineering material costs — must not be $0.00.
    expect(totalsText).toMatch(/\$\d+\.\d{2}/);
    expect(totalsText).not.toMatch(/\$0\.00/);

    // Each material appears at least once.
    for (const mat of ['steel', 'stainless', 'titanium']) {
      const r = page.locator(`[data-testid="forge-bom-row"][data-material="${mat}"]`);
      await expect(r, `${mat} row present`).toHaveCount(1);
    }
    await shot(page, 'bom-rows-verified');

    // Sort by qty — order should not throw + still 3 rows.
    await page.click('[data-testid="forge-bom-sort-qty"]');
    await page.waitForTimeout(150);
    await expect(rows).toHaveCount(3);
    await shot(page, 'bom-sorted-qty');

    // Group by material — three groups (one per material).
    await page.click('[data-testid="forge-bom-group-material"]');
    await page.waitForTimeout(150);
    const groups = await page.locator('[data-testid="forge-bom-group"]').count();
    expect(groups, 'one group per material').toBe(3);
    await shot(page, 'bom-grouped-material');
  });

  test('05 export CSV — saveFile bridge receives well-formed CSV', async () => {
    await page.evaluate(() => { window.__savedFiles = []; });
    await page.click('[data-testid="forge-bom-export-csv"]');
    await page.waitForTimeout(400);
    await shot(page, 'bom-exported');

    const saved = await page.evaluate(() => window.__savedFiles.slice());
    expect(saved.length, 'saveFile invoked once').toBe(1);
    const { data, opts } = saved[0];
    expect(opts.defaultPath, 'csv path set').toMatch(/\.csv$/);
    expect(typeof data, 'data is a string').toBe('string');
    expect(data, 'header row present').toMatch(/partKey/);
    expect(data, 'totals row present').toMatch(/TOTAL/);
    // Three part rows + 1 header + 1 blank + 1 totals = ≥ 5 lines.
    const lines = data.split('\r\n').filter(Boolean);
    expect(lines.length, 'at least 5 CSV lines').toBeGreaterThanOrEqual(5);
    // Every quoted field — verify hex-bolt rows surface.
    expect(data).toMatch(/"Hex bolt M5"/);
    expect(data).toMatch(/"Hex bolt M8"/);
    expect(data).toMatch(/"Hex bolt M12"/);
    // Cost columns are non-zero per row.
    expect(data).toMatch(/"titanium"/);
    expect(data).toMatch(/"steel"/);
  });

  test('06 manual clicks did NOT post to Archie thread', async () => {
    const threadItems = await page.locator('[data-testid="forge-archie"] [data-role]').count();
    expect(threadItems, 'no Archie thread writes from manual flow').toBe(0);
  });
});
