// Fast isolation of the GPU-render memory hypothesis (task #61).
//
// Drives __forgeRunPathTracedRender N times back-to-back. Before the
// renderer-teardown fix, the offline path tracer's WebGL2 context
// accumulated GPU memory and the ~3rd render crashed the page. If all N
// renders here return a valid PNG data URL, the teardown reclaims GPU
// memory between renders and the full 3-recipe demo will survive.
//
// No serve/Archie needed: harvestScene falls back to a neutral cube when
// the scene is empty, so this tests the render path in isolation.

import { test, expect, _electron as electron } from '@playwright/test';
import path from 'path';
import fs from 'fs';

test('GPU render survives N consecutive calls (memory teardown)', async () => {
  test.setTimeout(8 * 60 * 1000);
  const app = await electron.launch({
    args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 60,
  });
  let page = await app.firstWindow();
  if (page.url().startsWith('devtools://')) {
    page = (await app.windows()).find((w) => !w.url().startsWith('devtools://'))
      || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  }
  page.on('dialog', (d) => d.dismiss().catch(() => {}));
  await page.waitForLoadState('domcontentloaded');
  await page.evaluate(() => { try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch (_) {} });
  await page.reload();
  await page.waitForSelector('[data-testid="forge-app"]', { timeout: 30000 });
  await page.waitForFunction(() => typeof window.__forgeRunPathTracedRender === 'function', { timeout: 15000 });

  const N = 4;
  const results = [];
  for (let i = 0; i < N; i++) {
    const r = await page.evaluate(async (idx) => {
      try {
        const out = await window.__forgeRunPathTracedRender({ samples: 96, resolutionId: '720p', envPresetId: 'studio', denoise: true });
        return { ok: !!(out && out.dataUrl && out.dataUrl.length > 1000), len: out && out.dataUrl ? out.dataUrl.length : 0, w: out && out.width, h: out && out.height, dataUrl: idx === 0 ? out.dataUrl : null };
      } catch (e) { return { ok: false, error: String(e && e.message || e) }; }
    }, i);
    console.log(`[gpu-smoke] render ${i + 1}/${N}: ok=${r.ok} len=${r.len || 0} ${r.w || ''}x${r.h || ''} ${r.error ? 'ERR=' + r.error : ''}`);
    if (r.ok && r.dataUrl) {
      try { fs.writeFileSync(path.join(__dirname, 'shots', 'forge', `smoke-${i + 1}.png`), Buffer.from(r.dataUrl.split(',')[1], 'base64')); } catch (_) {}
    }
    results.push({ ok: r.ok, len: r.len, error: r.error });
    await page.waitForTimeout(600);
  }
  await app.close();

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n=== GPU SMOKE: ${okCount}/${N} consecutive renders succeeded ===`);
  expect(okCount).toBe(N);
});
