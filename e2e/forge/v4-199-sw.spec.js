// v4-199-sw.spec.js — Forge-199 service worker offline mode.
//
// In the Electron app the renderer loads from a file:// origin, so the
// service worker doesn't (and shouldn't) register — the SW is for the
// PWA / web variant. We verify that:
//   1. The SW + manifest files are present in the build output.
//   2. The registration code is wired in index.html.
//   3. window.__forgeSwSkipped is set under Electron (file:// path).
//   4. The manifest declares the expected app metadata.

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const SHOT_DIR = '/tmp/v4-199-sw';
fs.mkdirSync(SHOT_DIR, { recursive: true });
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

let _n = 0;
async function shot(page, label) {
  const file = path.join(SHOT_DIR, `${String(++_n).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-199 · service worker offline mode', () => {
  test('01 sw.js + manifest are present in the build', async () => {
    const distDir = path.resolve('/Users/account_clawteam1/archdisc-Mech/frontend/dist');
    const sw = path.join(distDir, 'sw.js');
    const manifest = path.join(distDir, 'manifest.webmanifest');
    expect(fs.existsSync(sw)).toBe(true);
    expect(fs.existsSync(manifest)).toBe(true);
    const swSrc = fs.readFileSync(sw, 'utf8');
    expect(swSrc).toContain('CACHE_VERSION');
    expect(swSrc).toContain('fetch');
    const m = JSON.parse(fs.readFileSync(manifest, 'utf8'));
    expect(m.name).toBe('ArchDisc Forge');
    expect(m.start_url).toBe('/');
    expect(m.display).toBe('standalone');
  });

  test('02 index.html wires the registration block', async () => {
    const indexPath = path.resolve('/Users/account_clawteam1/archdisc-Mech/frontend/dist/index.html');
    const html = fs.readFileSync(indexPath, 'utf8');
    expect(html).toContain('manifest.webmanifest');
    expect(html).toContain('serviceWorker');
    expect(html).toContain('/sw.js');
    expect(html).toContain('forge-sw-disable');   // opt-out flag
  });

  test('03 under Electron (file://) registration is skipped', async () => {
    const app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    const page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    await page.waitForTimeout(3500);
    await shot(page, 'electron-load');
    const probe = await page.evaluate(() => ({
      skipped:    !!window.__forgeSwSkipped,
      registered: !!window.__forgeSwRegistered,
      protocol:   window.location.protocol,
    }));
    expect(probe.protocol).toBe('file:');
    expect(probe.skipped).toBe(true);
    expect(probe.registered).toBe(false);
    await app.close();
  });
});
