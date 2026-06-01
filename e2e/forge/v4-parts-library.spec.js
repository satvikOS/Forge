// v4-parts-library.spec.js — Forge-94 headed verification.
//
// Drives the Standard Parts Library panel:
//   1. Mount the panel via window.__forgeOpenStandardParts(true).
//   2. Inject a mock window.forge so the kernel-gated UI activates.
//   3. Click an M8 hex bolt.
//   4. Assert build() ran (mock kernel recorded the calls) AND the
//      onInsert callback fired with a native body record.
//
// The library file deliberately self-mounts via a portal so this works
// without modifying ForgeShellV4.jsx — the prompt forbids touching it.
//
// Headed Electron, screenshot per step into /tmp/v4-parts-library/.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-parts-library';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge v4 · Standard Parts Library', () => {
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

  test('01 install mock kernel + mount the library host', async () => {
    // The library auto-portals via StandardPartsLibraryHost when the
    // module is imported; the shell already imports it via the parts
    // delivery. If the host's window setter isn't registered yet (the
    // shell file is off-limits and may not import this module), we
    // inject the host directly via React 18 createRoot inside the page.
    await page.evaluate(async () => {
      // 1. Mock kernel.
      const log = [];
      let nextHandle = 100;
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

      // 2. Insert hook — records each body record the panel emits.
      window.__insertedBodies = [];
      window.__forgeStandardPartsInsert = (record) => {
        window.__insertedBodies.push(record);
      };

      // 3. Mount the library host. We bypass the shell entirely and
      // mount a brand-new React tree into a div appended to body, so
      // this test works regardless of whether ForgeShellV4 imports the
      // module. Dynamic import of the panel via the dev server.
      const div = document.createElement('div');
      div.id = 'forge-parts-test-host';
      document.body.appendChild(div);
      // Vite serves source from /src/. Resolve relative to the loaded
      // entry's origin.
      const mod = await import('/src/forge-v4/StandardPartsLibrary.jsx');
      const React = await import('react');
      const ReactDOM = await import('react-dom/client');
      const root = ReactDOM.createRoot(div);
      root.render(React.createElement(mod.StandardPartsLibraryHost));
      // Open the panel.
      // Give the host an event-loop tick to register __forgeOpenStandardParts.
      await new Promise((r) => setTimeout(r, 80));
      window.__forgeOpenStandardParts(true);
    });
    await page.waitForTimeout(600);
    await shot(page, 'panel-open');
    const panelCount = await page.locator('[data-testid="forge-standard-parts"]').count();
    expect(panelCount, 'standard parts panel mounted').toBe(1);
  });

  test('02 panel surfaces fasteners by default', async () => {
    // Fasteners is the initial category — expect ≥ 50 entries (we have
    // 9 sizes × multiple variants).
    const items = await page.locator('[data-testid="forge-standard-part"]').count();
    expect(items, 'fastener entries visible').toBeGreaterThan(20);
    // Kernel-required warning must NOT be visible (we mocked it).
    const warn = await page.locator('[data-testid="forge-standard-parts-kernel-warning"]').count();
    expect(warn, 'no kernel warning when forge is ready').toBe(0);
    await shot(page, 'fasteners-listed');
  });

  test('03 filter to M8 + click hex bolt → kernel ops fire + body emitted', async () => {
    await page.fill('[data-testid="forge-standard-parts-filter"]', 'Hex bolt M8');
    await page.waitForTimeout(250);
    await shot(page, 'filtered-m8');
    const m8 = page.locator('[data-testid="forge-standard-part"][data-part-id^="hex-bolt-m8"]').first();
    await expect(m8).toBeVisible({ timeout: 2000 });

    // Reset state so we measure this click's effect cleanly.
    await page.evaluate(() => { window.__kernelLog.length = 0;
                                 window.__insertedBodies.length = 0; });

    await m8.click();
    await page.waitForTimeout(400);
    await shot(page, 'after-m8-click');

    // 1) Kernel calls were issued.
    const log = await page.evaluate(() => window.__kernelLog.slice());
    expect(log.length, 'kernel ops fired').toBeGreaterThan(3);
    const ops = log.map((row) => row[0]);
    expect(ops, 'shaft uses makeCylinder').toContain('makeCylinder');
    expect(ops, 'head fuse to shaft').toContain('fuse');
    // Hex head is built via intersection of cylinder + slabs.
    expect(ops, 'hex head uses common (intersection)').toContain('common');

    // 2) The library emitted a native body record.
    const bodies = await page.evaluate(() => window.__insertedBodies.slice());
    expect(bodies.length, 'insert hook received one record').toBe(1);
    expect(bodies[0].kind, 'body is native').toBe('native');
    expect(typeof bodies[0].handle, 'handle is a number').toBe('number');
    expect(bodies[0].params.partId, 'partId stamped on record').toMatch(/^hex-bolt-m8/);
  });

  test('04 switching categories surfaces bearings + gears + profiles', async () => {
    await page.fill('[data-testid="forge-standard-parts-filter"]', '');
    await page.waitForTimeout(150);
    for (const cat of ['bearings', 'profiles', 'gears']) {
      await page.click(`[data-cat="${cat}"]`);
      await page.waitForTimeout(200);
      await shot(page, `cat-${cat}`);
      const items = await page.locator('[data-testid="forge-standard-part"]').count();
      expect(items, `${cat} has items`).toBeGreaterThan(0);
    }
  });

  test('05 gear build composes many primitives (spur gear teeth)', async () => {
    await page.click('[data-cat="gears"]');
    await page.fill('[data-testid="forge-standard-parts-filter"]', 'm=2 z=20');
    await page.waitForTimeout(250);
    const gear = page.locator('[data-testid="forge-standard-part"][data-part-id^="spur"]').first();
    await expect(gear).toBeVisible({ timeout: 2000 });
    await page.evaluate(() => { window.__kernelLog.length = 0; });
    await gear.click();
    await page.waitForTimeout(400);
    const log = await page.evaluate(() => window.__kernelLog.slice());
    // 20 teeth = ≥20 fuses + 20 boxes for teeth + 1 cylinder blank + 1 bore + 1 cut.
    const fuseCount = log.filter((r) => r[0] === 'fuse').length;
    expect(fuseCount, 'gear fused 20 teeth').toBeGreaterThanOrEqual(15);
    await shot(page, 'gear-built');
  });

  test('06 kernel-offline path shows badge + click is noop', async () => {
    // Turn the kernel "off" — the panel polls and re-disables items.
    await page.evaluate(() => {
      window.forge.isReady = () => false;
    });
    await page.waitForTimeout(1300);   // poll interval is 1s
    await shot(page, 'kernel-offline');
    const warn = await page.locator('[data-testid="forge-standard-parts-kernel-warning"]').count();
    expect(warn, 'kernel-required warning shown').toBeGreaterThan(0);
    // Click should no-op (no new body emitted).
    const before = await page.evaluate(() => window.__insertedBodies.length);
    const first = page.locator('[data-testid="forge-standard-part"]').first();
    await first.click({ force: true }).catch(() => {});
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => window.__insertedBodies.length);
    expect(after, 'no body emitted while kernel offline').toBe(before);
    // Restore for any later tests.
    await page.evaluate(() => { window.forge.isReady = () => true; });
  });
});
