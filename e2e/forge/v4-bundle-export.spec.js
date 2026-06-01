// v4-bundle-export.spec.js — Forge-103 headed verification of the
// Project Bundle ZIP exporter.
//
// Flow:
//   01 launch headed Electron, confirm window.__forgeOpenProjectBundle exists
//   02 open the panel via window.__forgeOpenProjectBundle()
//   03 stub forge.dialog.saveFile() inside the renderer so the export
//      picks a deterministic path under /tmp/v4-bundle/ instead of
//      showing a native modal
//   04 click "Export Bundle"
//   05 assert the file exists on disk, starts with the ZIP magic
//      bytes (PK\003\004), and parses as a non-empty zip
//
// Manual button clicks must NOT post to Archie's thread — this spec
// runs the panel cold (no Archie input).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-bundle';
fs.mkdirSync(SHOT_DIR, { recursive: true });

const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js'
);
const BUNDLE_PATH = path.join(SHOT_DIR, 'forge-103-test-bundle.zip');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge v4 · Project Bundle exporter (Forge-103) headed', () => {
  let app, page;

  test.beforeAll(async () => {
    // Clean any stale artefact from a previous run so a stale zip can't
    // make a broken export pass.
    try { fs.unlinkSync(BUNDLE_PATH); } catch {}

    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // The shell + every panel host need a beat to mount.
    await page.waitForTimeout(3500);
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('01 host is mounted and __forgeOpenProjectBundle is callable', async () => {
    await shot(page, 'initial');
    const ok = await page.evaluate(
      () => typeof window.__forgeOpenProjectBundle === 'function'
    );
    expect(ok, 'window.__forgeOpenProjectBundle should be installed').toBe(true);
  });

  test('02 open the panel with a minimal payload', async () => {
    await page.evaluate(() => {
      window.__forgeOpenProjectBundle({
        projectName: 'Forge-103 Test',
        bodies:      [],   // empty session is fine — should still emit a valid ZIP
        drawings:    [],
        bom:         [],
        camOps:      [],
        simulations: [],
        configurations: { active: 'default', configs: { default: { overrides: {}, suppress: {} } } },
      });
    });
    await page.waitForTimeout(400);
    await expect(page.locator('[data-testid="forge-bundle-panel"]')).toBeVisible();
    await shot(page, 'panel-open');

    // Confirm the project-name input took our payload value.
    const v = await page.locator('[data-testid="forge-bundle-name"]').inputValue();
    expect(v).toBe('Forge-103 Test');
  });

  test('03 toggle section checkboxes (drawings off, sim off) for coverage', async () => {
    // Click two of the six toggles so we exercise the boolean wiring.
    await page.click('[data-testid="forge-bundle-toggle-drawings"]');
    await page.click('[data-testid="forge-bundle-toggle-sim"]');
    await page.waitForTimeout(150);
    await shot(page, 'sections-toggled');
  });

  test('04 stub saveFile + writeBlob to a deterministic /tmp path, then export', async () => {
    // Bend the dialog so the panel doesn't show a native modal in CI.
    // The writeBlob bridge stays real — we actually want the file on disk.
    await page.evaluate((target) => {
      const f = window.forge || {};
      f.dialog = f.dialog || {};
      f.dialog.saveFile = async () => target;
      window.forge = f;
    }, BUNDLE_PATH);

    // Click Export Bundle and wait for the result panel to render.
    await page.click('[data-testid="forge-bundle-export"]');
    await page.waitForSelector('[data-testid="forge-bundle-result"]', { timeout: 15000 });
    await page.waitForTimeout(400);
    await shot(page, 'exported');

    const resultText = await page
      .locator('[data-testid="forge-bundle-result"]')
      .innerText();
    // Either real OK (writeBlob bridge present + main process wrote bytes) or a
    // clear error from a missing bridge. We accept both — but if it's OK the
    // file must exist; if it's ERR the test fails (we want the bridge to work).
    expect(resultText.startsWith('OK')).toBe(true);
  });

  test('05 ZIP exists on disk + starts with PK\\003\\004 magic bytes', async () => {
    // Give the main-process write a moment to flush.
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(BUNDLE_PATH)) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(fs.existsSync(BUNDLE_PATH), `${BUNDLE_PATH} should exist`).toBe(true);

    const buf = fs.readFileSync(BUNDLE_PATH);
    expect(buf.length, 'bundle must be non-empty').toBeGreaterThan(64);

    // Classic local-file-header magic: 0x50 0x4B 0x03 0x04.
    expect(buf[0]).toBe(0x50);
    expect(buf[1]).toBe(0x4B);
    expect(buf[2]).toBe(0x03);
    expect(buf[3]).toBe(0x04);

    // EOCD signature must be present somewhere in the tail (0x06054b50).
    let eocdAt = -1;
    for (let i = buf.length - 22; i >= Math.max(0, buf.length - 1024); i--) {
      if (buf[i]     === 0x50 && buf[i + 1] === 0x4B
       && buf[i + 2] === 0x05 && buf[i + 3] === 0x06) { eocdAt = i; break; }
    }
    expect(eocdAt, 'EOCD record must be present').toBeGreaterThanOrEqual(0);
  });
});
