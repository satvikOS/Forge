// v4-stress-20k.spec.js — Forge-111 stress benchmark.
//
// Validates that Forge-106's THREE.InstancedMesh batching in
// Viewport.SceneMeshes can actually carry a 20,000-component scene at
// ≥30 FPS. Boots the headed Electron shell, drops a stress scene via
// the StressTestPanel window hooks, lets the renderer warm up, then
// samples FPS via `window.__forgeRenderer.info` + `performance.now()`
// over a 10 second window.
//
// Pass: mean FPS during the sample window is ≥ 30.
// Fail: anything less. The actual numbers (mean, min, max, draw calls,
// triangles) are written to /tmp/v4-stress/metrics.json so the user
// can post-mortem regressions without re-running the spec.
//
// Also captures a screenshot from every one of the 7 named camera views
// (iso, front, back, top, bottom, right, left) for visual sign-off.
//
// Headed-Electron is mandatory (Studio rule applies project-wide for
// any test claiming to validate a real rendering pipeline — see
// MEMORY headed-tests note).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const OUT_DIR = '/tmp/v4-stress';
fs.mkdirSync(OUT_DIR, { recursive: true });
const METRICS_PATH = path.join(OUT_DIR, 'metrics.json');
const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js');

const VIEWS = ['iso', 'front', 'back', 'top', 'bottom', 'right', 'left'];

const MIN_FPS = 30;
const WARMUP_MS = 2000;
const SAMPLE_MS = 10000;

let shotIdx = 0;
async function shot(page, label) {
  const file = path.join(OUT_DIR,
    `${String(++shotIdx).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-111 · 20k-body stress benchmark', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // Allow the shell + ViewportEnvironmentProvider + r3f bundle to settle.
    await page.waitForTimeout(3500);
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('01 app boots + stress hooks register', async () => {
    await shot(page, 'baseline');
    await expect(page.locator('[data-testid="forge-app"]')).toBeVisible();
    // Wait for the StressTestPanelHost to wire its globals.
    await page.waitForFunction(
      () => typeof window.__forgeOpenStressTest === 'function' &&
            typeof window.__forgeSetBodies === 'function' &&
            typeof window.__forgeStressEstimateDrawCalls === 'function',
      { timeout: 5000 },
    );
    const hooks = await page.evaluate(() => ({
      open: typeof window.__forgeOpenStressTest,
      set:  typeof window.__forgeSetBodies,
      clr:  typeof window.__forgeClearBodies,
      est:  typeof window.__forgeStressEstimateDrawCalls,
      scenes: typeof window.__forgeStressScene,
    }));
    expect(hooks.open).toBe('function');
    expect(hooks.set).toBe('function');
    expect(hooks.clr).toBe('function');
    expect(hooks.est).toBe('function');
    expect(hooks.scenes).toBe('object');
  });

  test('02 open stress panel + verify visible', async () => {
    await page.evaluate(() => window.__forgeOpenStressTest(true));
    await page.waitForTimeout(600);
    await shot(page, 'stress-panel-open');
    const panel = page.locator('[data-testid="forge-stress-test-panel"]');
    await expect(panel).toBeVisible({ timeout: 3000 });
    const overlay = page.locator('[data-testid="forge-stress-overlay"]');
    await expect(overlay).toBeVisible({ timeout: 3000 });
  });

  test('03 generator produces exactly 20,000 bolt records', async () => {
    const meta = await page.evaluate(() => {
      const arr = window.__forgeStressScene.bolts20k();
      const first = arr[0];
      const last = arr[arr.length - 1];
      return {
        len: arr.length,
        firstId: first.id,
        firstKind: first.kind,
        firstTag: first.instanceTag,
        firstSpecKind: first.spec.kind,
        firstSpec: { dx: first.spec.dx, dy: first.spec.dy, dz: first.spec.dz },
        firstCells: first.spec.cells,
        lastId: last.id,
        groups: window.__forgeStressEstimateDrawCalls(arr),
      };
    });
    expect(meta.len).toBe(20000);
    expect(meta.firstKind).toBe('synthetic');
    expect(meta.firstSpecKind).toBe('box');
    expect(meta.firstSpec.dx).toBe(8);
    expect(meta.firstSpec.dy).toBe(8);
    expect(meta.firstSpec.dz).toBe(12);
    expect(meta.firstTag).toBe('bolt20k');
    expect(Array.isArray(meta.firstCells)).toBe(true);
    expect(meta.firstCells.length).toBe(1);
    // CRITICAL: all 20k bolts share an instance key → 1 draw group.
    expect(meta.groups).toBe(1);
  });

  test('04 load 20k bolts into overlay', async () => {
    const result = await page.evaluate(() => {
      const arr = window.__forgeStressScene.bolts20k();
      return window.__forgeSetBodies(arr);
    });
    expect(result).toBe(20000);
    await page.waitForTimeout(WARMUP_MS);
    const live = await page.evaluate(() => window.__forgeStressBodyCount);
    expect(live).toBe(20000);
    await shot(page, 'bolts-20k-loaded');
  });

  test('05 sample FPS for 10s · assert mean ≥ 30', async () => {
    // The sampling loop runs entirely in-page so we capture the
    // browser's actual frame cadence, not the Playwright RPC tick.
    const sample = await page.evaluate(async (sampleMs) => {
      // Helper: pull a snapshot of renderer.info.
      function snapshot() {
        const r = window.__forgeRenderer;
        if (!r || !r.info) return { calls: 0, tris: 0 };
        return {
          calls: r.info.render.calls,
          tris:  r.info.render.triangles,
        };
      }
      const start = performance.now();
      let last = start;
      let frames = 0;
      const fpsBuckets = [];      // FPS averaged every ~250ms bucket
      let bucketStart = start;
      let bucketFrames = 0;
      let minFps = Infinity, maxFps = -Infinity;
      let renderCallsSum = 0, triCountSum = 0, sumSamples = 0;
      await new Promise((resolve) => {
        function tick(t) {
          frames++;
          bucketFrames++;
          const elapsedBucket = t - bucketStart;
          if (elapsedBucket >= 250) {
            const fps = (bucketFrames * 1000) / elapsedBucket;
            fpsBuckets.push(fps);
            if (fps < minFps) minFps = fps;
            if (fps > maxFps) maxFps = fps;
            const snap = snapshot();
            renderCallsSum += snap.calls;
            triCountSum += snap.tris;
            sumSamples++;
            bucketFrames = 0;
            bucketStart = t;
          }
          last = t;
          if (t - start >= sampleMs) {
            resolve();
          } else {
            requestAnimationFrame(tick);
          }
        }
        requestAnimationFrame(tick);
      });
      const totalMs = last - start;
      const meanFps = (frames * 1000) / totalMs;
      const avgBucketFps = fpsBuckets.length
        ? fpsBuckets.reduce((a, b) => a + b, 0) / fpsBuckets.length
        : 0;
      return {
        frames,
        totalMs,
        meanFps,
        avgBucketFps,
        minFps: isFinite(minFps) ? minFps : 0,
        maxFps: isFinite(maxFps) ? maxFps : 0,
        buckets: fpsBuckets,
        avgDrawCalls: sumSamples ? renderCallsSum / sumSamples : 0,
        avgTriangles: sumSamples ? triCountSum / sumSamples : 0,
        rendererPresent: typeof window.__forgeRenderer === 'object'
                           && window.__forgeRenderer !== null,
      };
    }, SAMPLE_MS);

    // Persist metrics regardless of pass/fail so regressions are
    // diagnosable from the file alone.
    const summary = {
      ts: new Date().toISOString(),
      scene: 'bolts20k',
      bodyCount: 20000,
      minFpsThreshold: MIN_FPS,
      sampleMs: SAMPLE_MS,
      warmupMs: WARMUP_MS,
      ...sample,
    };
    fs.writeFileSync(METRICS_PATH, JSON.stringify(summary, null, 2));

    // Log for the test runner so the user sees them immediately on fail.
    console.log('[Forge-111] stress sample:', {
      meanFps: sample.meanFps.toFixed(2),
      avgBucketFps: sample.avgBucketFps.toFixed(2),
      minFps: sample.minFps.toFixed(2),
      maxFps: sample.maxFps.toFixed(2),
      avgDrawCalls: Math.round(sample.avgDrawCalls),
      avgTriangles: Math.round(sample.avgTriangles),
      rendererPresent: sample.rendererPresent,
      metricsPath: METRICS_PATH,
    });

    // Assertions.
    expect(sample.rendererPresent,
      'window.__forgeRenderer must be exposed by RendererPublisher')
      .toBe(true);
    expect(sample.frames, 'must have rendered at least one frame').toBeGreaterThan(0);
    // Mean FPS must clear 30. We use meanFps (frames / totalMs * 1000)
    // because it's robust to bucket boundary noise.
    expect(sample.meanFps,
      `Forge-111: mean FPS ${sample.meanFps.toFixed(2)} < ${MIN_FPS}. ` +
      `See ${METRICS_PATH} for full sample.`)
      .toBeGreaterThanOrEqual(MIN_FPS);
    // InstancedMesh batching sanity: 20k bolts share one instance key
    // → renderer.info.render.calls should be tiny (single-digit-ish:
    // 1 InstancedMesh + grid + axes + gizmo ≈ 5-12). If batching is
    // off, this would balloon to 20,000+.
    expect(sample.avgDrawCalls,
      `Forge-111: avgDrawCalls ${sample.avgDrawCalls} suggests instancing ` +
      `is NOT batching — should be < 50, not approaching body count.`)
      .toBeLessThan(50);
  });

  test('06 capture screenshots from every named camera view', async () => {
    for (const v of VIEWS) {
      await page.evaluate((view) => {
        window.__forgeStressSetView?.(view);
        window.__forgeStressCenter?.();
      }, v);
      // Let the camera-recenter ease (CameraCenterEffect uses 280ms)
      // and a couple frames of OrbitControls damping settle.
      await page.waitForTimeout(700);
      await shot(page, `view-${v}`);
    }
    // Sanity-check the final view name made it through.
    const viewName = await page.evaluate(() => window.__forgeStressView);
    expect(VIEWS).toContain(viewName);
  });

  test('07 clear scene returns body count to zero', async () => {
    await page.evaluate(() => window.__forgeClearBodies());
    await page.waitForTimeout(400);
    const live = await page.evaluate(() => window.__forgeStressBodyCount);
    expect(live).toBe(0);
    await shot(page, 'cleared');
  });

  test('08 metrics.json was written and is well-formed', async () => {
    expect(fs.existsSync(METRICS_PATH)).toBe(true);
    const j = JSON.parse(fs.readFileSync(METRICS_PATH, 'utf8'));
    expect(j.bodyCount).toBe(20000);
    expect(j.scene).toBe('bolts20k');
    expect(typeof j.meanFps).toBe('number');
    expect(j.meanFps).toBeGreaterThanOrEqual(MIN_FPS);
    expect(Array.isArray(j.buckets)).toBe(true);
    expect(j.buckets.length).toBeGreaterThan(0);
  });
});
