// v4-kernel-introspect.spec.js — Forge-84.
// Boots the Electron app and dumps every property on window.forge with arity
// + a brief signature. Writes the report to /tmp/forge-kernel-surface.json so
// downstream slices can build against ground truth, not against the
// explore-agent's earlier guess.

const { test, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const OUT = '/tmp/forge-kernel-surface.json';
const ELECTRON_MAIN = path.resolve('/Users/account_clawteam1/archdisc-Mech/electron/main.js');

test('Forge-84 · introspect window.forge surface', async () => {
  const app = await _electron.launch({
    args: [ELECTRON_MAIN, '--no-sandbox'],
    env: { ...process.env, FORGE_E2E: '1' },
  });
  const page = await app.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(2500);

  const surface = await page.evaluate(() => {
    function walk(obj, prefix, depth, out) {
      if (depth > 3 || !obj || typeof obj !== 'object') return;
      for (const k of Object.keys(obj)) {
        let v;
        try { v = obj[k]; } catch { continue; }
        const key = prefix ? `${prefix}.${k}` : k;
        if (typeof v === 'function') {
          out[key] = { kind: 'function', arity: v.length };
        } else if (v && typeof v === 'object') {
          out[key] = { kind: 'namespace' };
          walk(v, key, depth + 1, out);
        } else if (v !== undefined) {
          out[key] = { kind: typeof v, value: String(v).slice(0, 80) };
        }
      }
    }
    const out = {};
    if (typeof window !== 'undefined' && window.forge) {
      out['__meta'] = {
        isReady: typeof window.forge.isReady === 'function' ? !!window.forge.isReady() : false,
        version: typeof window.forge.version === 'function' ? window.forge.version() : null,
        loadError: typeof window.forge.loadError === 'function' ? window.forge.loadError() : null,
      };
      walk(window.forge, '', 0, out);
    } else {
      out['__meta'] = { error: 'window.forge undefined' };
    }
    return out;
  });

  fs.writeFileSync(OUT, JSON.stringify(surface, null, 2));
  console.log('[forge-84] wrote', OUT, '— keys:', Object.keys(surface).length);
  await app.close();
});
