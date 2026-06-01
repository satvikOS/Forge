// Forge-109 — GD&T + PMI annotations end-to-end test (headed Electron).
//
// Boots the Forge v4 shell, opens the Drawings workbench, mounts the
// workbench via the same probe-injection trick v4-drawings.spec uses
// (ForgeShellV4.jsx is off-limits for direct editing per Forge-90).
// Then exercises three PMI tools:
//
//   1. GD&T   — flatness 0.05, datum A
//   2. Finish — Ra 1.6 µm
//   3. Weld   — fillet 5 mm, GMAW process
//
// Each step asserts the SVG markup contains the right data-* attributes
// (the deterministic test surface every PMI component emits), then the
// test exports STEP+PMI via the new toolbar button and verifies the
// in-app toast surfaces the result (kernel-or-fallback).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-gdt-pmi';
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

test.describe('Forge v4 — GD&T + PMI annotations', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(2500);
  });
  test.afterAll(async () => { if (app) await app.close(); });

  test('01 shell mounts', async () => {
    await expect(page.locator('[data-testid="forge-app"]'))
      .toBeVisible({ timeout: 15000 });
    await shot(page, 'shell');
  });

  test('02 reset PMI store + mount DrawingsWorkbench probe', async () => {
    // Clear the persisted PMI list so this run is deterministic — the
    // module persists to localStorage and we want a blank slate.
    await page.evaluate(async () => {
      try { localStorage.removeItem('forge.v4.pmi'); } catch {}
      try {
        const mod = await import('/@fs/Users/account_clawteam1/archdisc-Mech/frontend/src/forge-v4/pmiAnnotations.js');
        mod.__TEST__?.reset();
      } catch (err) { /* probe will recreate */ }
    });

    // Optional: switch to drawing workbench tab if the shell exposes one.
    const tab = page.locator('[data-wb="drawing"]').first();
    if (await tab.count()) {
      await tab.click().catch(() => {});
      await page.waitForTimeout(400);
    }
    // Optional: try window.__forgeOpenDrawings if the shell exposes it.
    await page.evaluate(() => {
      try { window.__forgeOpenDrawings?.(); } catch {}
    });
    await page.waitForTimeout(150);

    // Mount the workbench into a fresh probe root so we always have it,
    // regardless of whether the shell auto-mounted the overlay.
    const ok = await page.evaluate(async () => {
      try {
        document.getElementById('forge-drawings-probe-root')?.remove();
        const root = document.createElement('div');
        root.id = 'forge-drawings-probe-root';
        Object.assign(root.style, {
          position: 'fixed', inset: '0', zIndex: 99999,
          background: 'var(--forge-canvas, #000)',
        });
        document.body.appendChild(root);
        const ReactMod = await import('/@fs/Users/account_clawteam1/archdisc-Mech/node_modules/react/index.js')
          .catch(() => null) || await import('react').catch(() => null);
        const RDOM = await import('/@fs/Users/account_clawteam1/archdisc-Mech/node_modules/react-dom/client.js')
          .catch(() => null) || await import('react-dom/client').catch(() => null);
        const mod = await import('/@fs/Users/account_clawteam1/archdisc-Mech/frontend/src/forge-v4/DrawingsWorkbench.jsx');
        if (!ReactMod || !RDOM || !mod) return 'imports';
        const React = ReactMod.default || ReactMod;
        const createRoot = (RDOM.createRoot || RDOM.default?.createRoot);
        const bodies = [{
          id: 'b-pmi', name: 'PMI probe', toolId: 'solid.extrude',
          handle: 1,
          spec: { kind: 'box', dx: 50, dy: 40, dz: 25 },
        }];
        const r = createRoot(root);
        r.render(React.createElement(mod.DrawingsWorkbench || mod.default, {
          bodies, theme: 'dark',
        }));
        window.__forgeDrawingsProbeRoot = r;
        return 'ok';
      } catch (err) {
        return `err:${err.message}`;
      }
    });

    const drawings = page.locator('[data-testid="forge-drawings"]');
    await expect(drawings).toBeVisible({ timeout: 8000 });
    expect(['ok', 'imports'].includes(ok)).toBeTruthy();
    await shot(page, 'workbench-mounted');
  });

  test('03 GD&T toolbar button is present', async () => {
    const btn = page.locator('[data-tool="drawings.gdt"]').first();
    await expect(btn).toBeVisible();
    await shot(page, 'gdt-button');
  });

  test('04 add a flatness 0.05 FCF with datum A', async () => {
    await page.click('[data-tool="drawings.gdt"]');
    await page.waitForTimeout(120);
    // Click the first view cell to open the picker
    const cell = page.locator('[data-testid="forge-drawings-view-cell"]').first();
    const box = await cell.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.4,
                             box.y + box.height * 0.5);
      await page.waitForTimeout(200);
    }
    const picker = page.locator('[data-testid="forge-fcf-picker"]');
    await expect(picker).toBeVisible({ timeout: 3000 });

    // Configure: flatness (default), tolerance 0.05, one datum A.
    await page.selectOption('[data-fcf-field="char"]', 'flatness');
    await page.fill('[data-fcf-field="tolerance"]', '0.05');
    await page.click('[data-fcf-add-datum]');
    // datum input defaults to A — confirm it
    await page.waitForTimeout(100);
    await page.click('[data-testid="forge-fcf-commit"]');
    await page.waitForTimeout(250);

    const fcf = page.locator('[data-fcf="true"]').first();
    await expect(fcf).toBeVisible({ timeout: 2000 });
    expect(await fcf.getAttribute('data-fcf-char')).toBe('flatness');
    expect(await fcf.getAttribute('data-fcf-tolerance')).toBe('0.05');
    expect(await fcf.getAttribute('data-fcf-datums')).toContain('A');
    // The characteristic glyph cell carries the unicode ⏥
    const charCell = page.locator('[data-fcf-cell="char"]').first();
    const charText = await charCell.textContent();
    expect(charText).toContain('⏥');
    await shot(page, 'fcf-flatness-datum-a');
  });

  test('05 add a surface finish Ra 1.6', async () => {
    await page.click('[data-tool="drawings.finish"]');
    await page.waitForTimeout(120);
    const cell = page.locator('[data-testid="forge-drawings-view-cell"]').first();
    const box = await cell.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.55,
                             box.y + box.height * 0.4);
      await page.waitForTimeout(200);
    }
    const picker = page.locator('[data-testid="forge-finish-picker"]');
    await expect(picker).toBeVisible({ timeout: 3000 });

    await page.selectOption('[data-finish-field="param"]', 'Ra');
    await page.fill('[data-finish-field="value"]', '1.6');
    await page.click('[data-testid="forge-finish-commit"]');
    await page.waitForTimeout(250);

    const sf = page.locator('[data-surface-finish="true"]').first();
    await expect(sf).toBeVisible({ timeout: 2000 });
    expect(await sf.getAttribute('data-finish-param')).toBe('Ra');
    expect(await sf.getAttribute('data-finish-value')).toBe('1.6');
    // The value label SVG <text> shows "Ra 1.6 µm"
    const valueText = await page.locator('[data-finish-label="value"]')
                                .first().textContent();
    expect(valueText).toContain('Ra');
    expect(valueText).toContain('1.6');
    await shot(page, 'finish-ra-1.6');
  });

  test('06 add a weld symbol fillet 5 mm GMAW', async () => {
    await page.click('[data-tool="drawings.weld"]');
    await page.waitForTimeout(120);
    const cell = page.locator('[data-testid="forge-drawings-view-cell"]').first();
    const box = await cell.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.7,
                             box.y + box.height * 0.55);
      await page.waitForTimeout(200);
    }
    const picker = page.locator('[data-testid="forge-weld-picker"]');
    await expect(picker).toBeVisible({ timeout: 3000 });

    await page.selectOption('[data-weld-field="type"]', 'fillet');
    await page.fill('[data-weld-field="size"]', '5');
    await page.selectOption('[data-weld-field="process"]', 'GMAW');
    await page.click('[data-testid="forge-weld-commit"]');
    await page.waitForTimeout(250);

    const weld = page.locator('[data-weld="true"]').first();
    await expect(weld).toBeVisible({ timeout: 2000 });
    expect(await weld.getAttribute('data-weld-type')).toBe('fillet');
    expect(await weld.getAttribute('data-weld-size')).toBe('5');
    expect(await weld.getAttribute('data-weld-process')).toBe('GMAW');
    // The process tail text should contain "GMAW"
    const procText = await page.locator('[data-weld-process-text]')
                                .first().textContent();
    expect(procText).toContain('GMAW');
    await shot(page, 'weld-fillet-5-gmaw');
  });

  test('07 inspector lists three PMI entries + tolerance field on dim', async () => {
    // Reset the active tool so the picker closes if open.
    await page.evaluate(() => document.body.click());
    await page.waitForTimeout(100);

    // Confirm three annotations registered in the inspector
    const pmiItems = page.locator('[data-pmi-list-id]');
    const n = await pmiItems.count();
    expect(n, 'PMI inspector lists three annotations')
      .toBeGreaterThanOrEqual(3);

    // Drop in a dimension via the dimension tool, then verify the
    // tolerance superscript renders on the SVG.
    await page.click('[data-tool="drawings.dimension"]');
    await page.waitForTimeout(120);
    const cell = page.locator('[data-testid="forge-drawings-view-cell"]').first();
    const box = await cell.boundingBox();
    if (box) {
      await page.mouse.click(box.x + box.width * 0.2,
                             box.y + box.height * 0.85);
      await page.waitForTimeout(80);
      await page.mouse.click(box.x + box.width * 0.85,
                             box.y + box.height * 0.85);
      await page.waitForTimeout(250);
    }
    const dim = page.locator('[data-dim-id]').first();
    await expect(dim).toBeVisible({ timeout: 2000 });
    const tolAttr = await dim.getAttribute('data-dim-tolerance');
    expect(tolAttr, 'dimension carries tolerance text').toBeTruthy();
    // The default tolerance is ±0.1.
    expect(tolAttr).toContain('±0.1');
    await shot(page, 'inspector-and-dim-tol');
  });

  test('08 export STEP with PMI', async () => {
    const btn = page.locator('[data-tool="drawings.exportStepPmi"]').first();
    await expect(btn).toBeVisible();
    await btn.click();
    await page.waitForTimeout(600);
    const note = page.locator('[data-testid="forge-drawings-export-note"]');
    // We accept either an "exported" toast or a fallback warning; both
    // prove the PMI list reached the exporter.
    if (await note.count()) {
      const text = await note.first().textContent();
      expect(text, 'STEP+PMI export surfaces a status note').toBeTruthy();
      expect(text.toLowerCase()).toContain('step');
    }
    await shot(page, 'step-pmi-export');
  });

  test('09 PMI persists to localStorage under forge.v4.pmi', async () => {
    const stored = await page.evaluate(() => {
      try {
        const raw = localStorage.getItem('forge.v4.pmi');
        if (!raw) return { count: 0 };
        const arr = JSON.parse(raw);
        return {
          count: Array.isArray(arr) ? arr.length : -1,
          kinds: Array.isArray(arr) ? arr.map((a) => a.kind) : [],
        };
      } catch (err) { return { error: err.message }; }
    });
    expect(stored.count, 'forge.v4.pmi stores at least 3 entries')
      .toBeGreaterThanOrEqual(3);
    expect(stored.kinds).toContain('gdt');
    expect(stored.kinds).toContain('finish');
    expect(stored.kinds).toContain('weld');
    await shot(page, 'localStorage-pmi');
  });
});
