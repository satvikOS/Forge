// v4-project-roundtrip.spec.js — Forge-119 headed verification of the
// `.forge` project-file save/load round-trip.
//
// Flow:
//   01 launch headed Electron, confirm `window.__forgeOpenProjectFile`
//      registered + the loader/saver are reachable
//   02 build a deterministic scene of 2 bodies via __forgeSetBodies (one
//      native handle from forge.io.makeBox if the kernel is up, otherwise
//      a stubbed handle; one synthetic body for spec-coverage)
//   03 mock forge.dialog.saveFile() so the panel resolves to
//      /tmp/forge-test-roundtrip.forge instead of a native modal, click
//      Save Project, assert the file lands on disk + has the ZIP magic
//      bytes
//   04 unzip the archive in-process and assert it contains project.json
//      + bodies/<id>.step (for the native body)
//   05 clear the scene via __forgeSetBodies([])
//   06 mock forge.dialog.openFile() to return the same path, trigger
//      __forgeOpenProjectFile('open'), wait for the toast, then read
//      __forgeBodies back and assert the count + names match
//
// Headed + mac-electron + watchable pace per the user mandate.
// Manual button clicks must NOT post to Archie's thread.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-project-roundtrip';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js'
);
const ROUNDTRIP_PATH = '/tmp/forge-test-roundtrip.forge';

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

// Watchable pacing — the user is remote-desktopping into the Mac, so we
// pause briefly between visible steps so the screenshots are useful and
// the headed UI actually shows progress.
const PACE = 350;

test.describe.serial('Forge v4 · project file round-trip (Forge-119) headed', () => {
  let app, page;

  test.beforeAll(async () => {
    try { fs.unlinkSync(ROUNDTRIP_PATH); } catch {}

    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // Shell + every panel host need a beat to mount.
    await page.waitForTimeout(3500);
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('01 host registered + __forgeOpenProjectFile callable', async () => {
    await shot(page, 'initial');
    const ok = await page.evaluate(
      () => typeof window.__forgeOpenProjectFile === 'function'
    );
    expect(ok, 'window.__forgeOpenProjectFile should be installed').toBe(true);
  });

  test('02 seed a 2-body scene via __forgeSetBodies', async () => {
    // We use the kernel if it's loaded so the STEP round-trip exercises
    // real OCCT marshalling; otherwise we fall back to a stubbed body
    // that saveProject will record as 'skipped' (the test still proves
    // the ZIP + project.json plumbing, just without the STEP file).
    const info = await page.evaluate(async () => {
      const forge = window.forge;
      const ready = !!(forge && typeof forge.isReady === 'function' && forge.isReady());

      let nativeHandle = null;
      if (ready && forge.part?.extrudeProfile && forge.sketch?.newSketch) {
        // Best-effort: build a simple box-like solid. If anything fails
        // we silently fall through to the synthetic-only path.
        try {
          // Some kernels expose a primitives helper directly.
          if (forge.primitives?.box) {
            nativeHandle = forge.primitives.box(20, 20, 20);
          }
        } catch { /* ignore */ }
      }
      // Even more conservative fallback: if kernel publishes a box()
      // utility on the top level (some dev builds do).
      if (nativeHandle == null && forge?.makeBox) {
        try { nativeHandle = forge.makeBox(20, 20, 20); } catch {}
      }

      const bodies = [
        nativeHandle != null
          ? { id: 'body-alpha', kind: 'native',    handle: nativeHandle,
              toolId: 'box', params: { sx: 20, sy: 20, sz: 20 },
              name: 'Alpha Box' }
          : { id: 'body-alpha', kind: 'synthetic',
              spec: { kind: 'box', sx: 20, sy: 20, sz: 20 },
              toolId: 'box', params: { sx: 20, sy: 20, sz: 20 },
              name: 'Alpha Box' },
        { id: 'body-beta', kind: 'synthetic',
          spec: { kind: 'sphere', r: 12 },
          toolId: 'sphere', params: { r: 12 },
          name: 'Beta Sphere' },
      ];

      if (typeof window.__forgeSetBodies === 'function') {
        window.__forgeSetBodies(bodies);
      } else {
        window.__forgeBodies = bodies;
      }
      window.__forgeProjectName = 'Forge-119 Roundtrip';
      return {
        ready, hasNative: nativeHandle != null,
        nativeHandle, count: bodies.length,
      };
    });
    await page.waitForTimeout(PACE);
    await shot(page, 'scene-seeded');
    expect(info.count).toBe(2);
    // Cache for later assertions.
    test.info().annotations.push({ type: 'scene', description: JSON.stringify(info) });
  });

  test('03 save: stub saveFile, open panel, click Save Project', async () => {
    // Bend the save dialog to our deterministic path.
    await page.evaluate((target) => {
      const f = window.forge || {};
      f.dialog = f.dialog || {};
      f.dialog.saveFile = async () => target;
      window.forge = f;
    }, ROUNDTRIP_PATH);

    // Open the panel in 'save' mode.
    await page.evaluate(() => window.__forgeOpenProjectFile('save'));
    await page.waitForSelector('[data-testid="forge-project-file-panel"]',
                               { timeout: 5000 });
    await page.waitForTimeout(PACE);
    await shot(page, 'panel-open-save');

    // The name input should be primed with the published project name.
    const nameVal = await page.locator('[data-testid="forge-project-file-name"]').inputValue();
    expect(nameVal).toBe('Forge-119 Roundtrip');

    // Click Save Project — the panel calls saveProject and writes via
    // the real writeBlob bridge (we only stubbed saveFile).
    await page.click('[data-testid="forge-project-file-save"]');

    // Wait for either the OK toast or the in-panel result box.
    // The panel auto-closes on OK, so we wait for the file to exist.
    let appeared = false;
    for (let i = 0; i < 60; i++) {
      if (fs.existsSync(ROUNDTRIP_PATH)) { appeared = true; break; }
      await new Promise((r) => setTimeout(r, 200));
    }
    await page.waitForTimeout(PACE);
    await shot(page, 'after-save');
    expect(appeared, `${ROUNDTRIP_PATH} should exist after save`).toBe(true);
  });

  test('04 .forge file is a valid ZIP containing project.json (+ STEP for native)', async () => {
    const buf = fs.readFileSync(ROUNDTRIP_PATH);
    expect(buf.length, 'archive must be non-empty').toBeGreaterThan(64);

    // PK\003\004 local-file-header magic.
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4B);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);

    // EOCD record (0x06054b50) somewhere near the tail.
    let eocdAt = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 1024); i--) {
      if (buf[i]     === 0x50 && buf[i + 1] === 0x4B
       && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocdAt = i; break; }
    }
    expect(eocdAt, 'EOCD record must be present').toBeGreaterThanOrEqual(0);

    // Drive the manifest assertion from inside the renderer so JSZip is
    // already loaded — this also confirms project.json round-trips.
    const inventory = await page.evaluate(async (filepath) => {
      const url = filepath.startsWith('file://') ? filepath : `file://${filepath}`;
      const r = await fetch(url);
      const bytes = new Uint8Array(await r.arrayBuffer());
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(bytes);
      const out = { entries: [], hasManifest: false, manifest: null };
      zip.forEach((p) => out.entries.push(p));
      const m = zip.file('project.json');
      if (m) {
        out.hasManifest = true;
        out.manifest = JSON.parse(await m.async('string'));
      }
      return out;
    }, ROUNDTRIP_PATH);

    expect(inventory.hasManifest).toBe(true);
    expect(inventory.manifest.kind).toBe('forge.project');
    expect(inventory.manifest.projectName).toBe('Forge-119 Roundtrip');
    expect(Array.isArray(inventory.manifest.bodies)).toBe(true);
    expect(inventory.manifest.bodies.length).toBe(2);

    // If the seed step landed a native handle we should see a STEP file
    // inside the ZIP for it; otherwise both bodies are synthetic and we
    // just confirm the names round-tripped.
    const stepEntries = inventory.entries.filter((p) => p.startsWith('bodies/')
                                                    && p.endsWith('.step'));
    const nativeBodies = inventory.manifest.bodies.filter((b) => b.kind === 'native'
                                                              && b.status === 'ok');
    expect(stepEntries.length, 'STEP file count matches native-ok body count')
      .toBe(nativeBodies.length);

    // Names must round-trip.
    const names = inventory.manifest.bodies.map((b) => b.name).sort();
    expect(names).toEqual(['Alpha Box', 'Beta Sphere']);
  });

  test('05 clear the scene + verify __forgeBodies is empty', async () => {
    await page.evaluate(() => {
      if (typeof window.__forgeSetBodies === 'function') {
        window.__forgeSetBodies([]);
      } else {
        window.__forgeBodies = [];
      }
    });
    await page.waitForTimeout(PACE);
    await shot(page, 'scene-cleared');
    const count = await page.evaluate(
      () => (window.__forgeBodies || []).length
    );
    expect(count).toBe(0);
  });

  test('06 open: stub openFile, trigger __forgeOpenProjectFile("open")', async () => {
    // Bend the open dialog so it returns our deterministic path.
    await page.evaluate((target) => {
      const f = window.forge || {};
      f.dialog = f.dialog || {};
      f.dialog.openFile = async () => target;
      window.forge = f;
    }, ROUNDTRIP_PATH);

    await page.evaluate(() => window.__forgeOpenProjectFile('open'));

    // Wait for restoreScene → __forgeSetBodies → __forgeBodies repopulation.
    let restored = 0;
    for (let i = 0; i < 60; i++) {
      restored = await page.evaluate(() => (window.__forgeBodies || []).length);
      if (restored >= 2) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    await page.waitForTimeout(PACE);
    await shot(page, 'after-open');
    expect(restored, 'two bodies restored from archive').toBe(2);

    // Names must match what we saved.
    const names = await page.evaluate(
      () => (window.__forgeBodies || []).map((b) => b.name).sort()
    );
    expect(names).toEqual(['Alpha Box', 'Beta Sphere']);

    // Native bodies (if any) must now carry a fresh numeric handle.
    const nativeInfo = await page.evaluate(() => {
      const bodies = window.__forgeBodies || [];
      const native = bodies.filter((b) => b.kind === 'native');
      return {
        count: native.length,
        allHandlesNumeric: native.every((b) => typeof b.handle === 'number'),
      };
    });
    if (nativeInfo.count > 0) {
      expect(nativeInfo.allHandlesNumeric,
             'every restored native body has a numeric handle').toBe(true);
    }
  });
});
