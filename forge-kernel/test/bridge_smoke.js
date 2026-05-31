// Bridge smoke — launches Electron headless, waits for the renderer's
// preload to expose `window.forge`, calls `forge.makeBox(1,1,1)`, and
// asserts the round-trip works. Doesn't need the frontend Vite build
// present — we override the load URL to about:blank so the preload runs
// in isolation.

const { _electron: electron } = require('@playwright/test');
const path = require('path');

(async () => {
  const app = await electron.launch({
    args: [
      path.resolve(__dirname, '..', '..', 'electron', 'main.js'),
      '--no-sandbox',
    ],
    env: { ...process.env, FORGE_BRIDGE_SMOKE: '1' },
  });
  const window = await app.firstWindow();

  // The main process loads the production HTML by default; we don't need
  // that for the bridge smoke. Navigate to about:blank and let it settle.
  await window.goto('about:blank');
  await window.waitForLoadState('domcontentloaded');

  const result = await window.evaluate(() => {
    if (!window.forge) return { ok: false, reason: 'window.forge is undefined' };
    if (!window.forge.isReady()) return { ok: false, reason: window.forge.loadError() };
    const v = window.forge.version();
    const h = window.forge.makeBox(1, 1, 1);
    const mp = window.forge.massProps(h);
    window.forge.release(h);
    return { ok: true, version: v, handle: h, volume: mp.volume };
  });

  console.log('[bridge-smoke]', result);
  await app.close();

  if (!result.ok) {
    console.error('[bridge-smoke] FAIL —', result.reason);
    process.exit(1);
  }
  if (Math.abs(result.volume - 1) > 1e-9) {
    console.error('[bridge-smoke] FAIL — unit box volume', result.volume, '!= 1');
    process.exit(1);
  }
  console.log('[bridge-smoke] PASS');
})();
