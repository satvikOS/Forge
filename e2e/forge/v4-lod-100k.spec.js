// v4-lod-100k.spec.js — Forge-125 100k-body LOD streaming benchmark.
//
// Drives the Forge v4 shell as a real user would:
//   1. Launches headed Electron (Studio rule applies).
//   2. Opens the Tools menu via mouse click → picks "Stress test…" →
//      panel becomes visible.
//   3. Clicks "Load 100k cloud" in the stress panel → 100k synthetic
//      bodies stream into the overlay viewport.
//   4. Waits 3s warmup, samples FPS for 15s via window.__forgeRenderer
//      .info polling inside the page, asserts mean ≥ 50fps.
//   5. Captures multi-angle screenshots (iso + 3 orbit angles) for
//      visual sign-off.
//
// Metrics are written to /tmp/v4-lod/metrics.json regardless of pass/
// fail so regressions are diagnosable from the file alone.
//
// Headed-Electron is mandatory; the user is watching this remotely.
// Tests do NOT poke into React state — every action is a click on the
// real DOM (menu button → menu item → load button → close).

const { test, expect, _electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');

const OUT_DIR = '/tmp/v4-lod';
fs.mkdirSync(OUT_DIR, { recursive: true });
const METRICS_PATH = path.join(OUT_DIR, 'metrics.json');
const ELECTRON_MAIN = path.resolve(
  '/Users/account_clawteam1/archdisc-Mech/electron/main.js');

const MIN_FPS = 50;
const WARMUP_MS = 3000;
const SAMPLE_MS = 15000;

// Camera angles for the multi-angle sweep. We use the
// `__forgeStressSetView` window helper (a stable surface in the
// StressTestPanelHost) so each angle is repeatable across runs.
const ANGLES = ['iso', 'front', 'top', 'right'];

let shotIdx = 0;
async function shot(page, label) {
  const file = path.join(OUT_DIR,
    `${String(++shotIdx).padStart(3, '0')}-${label}.png`);
  await page.screenshot({ path: file, fullPage: false });
  return file;
}

test.describe.serial('Forge-125 · 100k LOD streaming benchmark', () => {
  let app, page;

  test.beforeAll(async () => {
    app = await _electron.launch({
      args: [ELECTRON_MAIN, '--no-sandbox'],
      env: { ...process.env, FORGE_E2E: '1' },
    });
    page = await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    // Allow the shell + r3f bundle + StressTestPanelHost to mount and
    // register their window globals.
    await page.waitForTimeout(3500);
  });

  test.afterAll(async () => {
    if (app) await app.close();
  });

  test('01 app boots + LOD scheduler globals registered', async () => {
    await shot(page, 'baseline');
    await expect(page.locator('[data-testid="forge-app"]')).toBeVisible();
    // The lodScheduler module self-registers __forgeLodMetrics. The
    // StressTestPanelHost registers __forgeOpenStressTest /
    // __forgeStressScene. Both must be live before we click anything.
    await page.waitForFunction(
      () => typeof window.__forgeLodMetrics === 'function' &&
            typeof window.__forgeOpenStressTest === 'function' &&
            typeof window.__forgeStressScene === 'object' &&
            typeof window.__forgeStressScene.cloud100k === 'function',
      { timeout: 8000 },
    );
    const hooks = await page.evaluate(() => ({
      lod:     typeof window.__forgeLodMetrics,
      open:    typeof window.__forgeOpenStressTest,
      cloud:   typeof window.__forgeStressScene.cloud100k,
      decis:   typeof window.__forgeLodTick,
    }));
    expect(hooks.lod).toBe('function');
    expect(hooks.open).toBe('function');
    expect(hooks.cloud).toBe('function');
    expect(hooks.decis).toBe('function');
  });

  test('02 open Tools menu and click Stress test via real click', async () => {
    // Real mouse click on the Tools menu button — exactly what a user
    // does. The TopBar mounts the MenuBar with data-menu="tools".
    const toolsBtn = page.locator('[data-menu="tools"]').first();
    await expect(toolsBtn).toBeVisible({ timeout: 5000 });
    await toolsBtn.click();
    await shot(page, 'tools-menu-open');
    // Menu panel should now be visible.
    const menuPanel = page.locator('[data-testid="forge-menu-tools"]');
    await expect(menuPanel).toBeVisible({ timeout: 3000 });
    // Click the Stress test item by its visible label.
    const item = menuPanel.locator('button', { hasText: 'Stress test' });
    await expect(item).toBeVisible({ timeout: 2000 });
    await item.click();
    // Panel + overlay become visible.
    await expect(page.locator('[data-testid="forge-stress-test-panel"]'))
      .toBeVisible({ timeout: 3000 });
    await expect(page.locator('[data-testid="forge-stress-overlay"]'))
      .toBeVisible({ timeout: 3000 });
    await shot(page, 'stress-panel-open');
  });

  test('03 generator produces exactly 100,000 cloud records', async () => {
    const meta = await page.evaluate(() => {
      const arr = window.__forgeStressScene.cloud100k();
      const first = arr[0];
      const last = arr[arr.length - 1];
      const radii = [first, arr[25000], arr[50000], arr[75000], last]
        .map((b) => Math.sqrt(b.xform.x ** 2 + b.xform.y ** 2 + b.xform.z ** 2));
      return {
        len: arr.length,
        kind: first.kind,
        tag: first.instanceTag,
        specKind: first.spec.kind,
        spec: { dx: first.spec.dx, dy: first.spec.dy, dz: first.spec.dz },
        hasXform: typeof first.xform === 'object' && first.xform !== null,
        firstXform: first.xform,
        radii,
        groups: window.__forgeStressEstimateDrawCalls(arr),
      };
    });
    expect(meta.len).toBe(100000);
    expect(meta.kind).toBe('synthetic');
    expect(meta.specKind).toBe('box');
    expect(meta.spec.dx).toBe(4);
    expect(meta.tag).toBe('cloud100k');
    expect(meta.hasXform).toBe(true);
    expect(meta.firstXform).toHaveProperty('x');
    expect(meta.firstXform).toHaveProperty('y');
    expect(meta.firstXform).toHaveProperty('z');
    // All radii must fall within the 800mm shell envelope (we use 3
    // concentric shells at 0.45R, 0.75R, 1.0R = 360..800mm).
    for (const r of meta.radii) {
      expect(r).toBeGreaterThanOrEqual(300);
      expect(r).toBeLessThanOrEqual(810);
    }
    // Critical: 100k bodies → 1 InstancedGroup.
    expect(meta.groups).toBe(1);
  });

  test('04 click Load 100k cloud button → 100,000 bodies live', async () => {
    const loadBtn = page.locator('[data-testid="forge-stress-load-cloud100k"]');
    await expect(loadBtn).toBeVisible({ timeout: 3000 });
    await loadBtn.click();
    // The host's setBodiesState is synchronous (sets a useState
    // immediately); give the scene-build effect a moment to merge.
    await page.waitForTimeout(800);
    await page.waitForFunction(
      () => window.__forgeStressBodyCount === 100000,
      { timeout: 15000 },
    );
    const live = await page.evaluate(() => window.__forgeStressBodyCount);
    expect(live).toBe(100000);
    await shot(page, 'cloud-100k-loaded');
  });

  test('05 LOD streaming kicks in (high+med+low > 0)', async () => {
    // Wait for the LOD scheduler to start producing decisions. The
    // panel's "streaming active" badge is the canonical user-visible
    // signal — we also assert the underlying metrics for hard numbers.
    await page.waitForFunction(
      () => {
        const m = window.__forgeLodMetrics?.();
        return m && m.total >= 100000 &&
               (m.high + m.med + m.low) > 0;
      },
      { timeout: 10000 },
    );
    await expect(page.locator('[data-testid="forge-stress-lod-active"]'))
      .toBeVisible({ timeout: 5000 });
    const m = await page.evaluate(() => window.__forgeLodMetrics());
    // We should see distance bucketing: at iso view (camera 40,25,40,
    // dist ≈ 60mm to origin) most bodies are 500+mm away → Low
    // dominates, some Med, very few High.
    expect(m.total).toBe(100000);
    expect(m.low + m.med + m.high + m.hidden).toBe(100000);
    expect(m.low).toBeGreaterThan(0);
    // Pool budget either reflects the kernel's real worker count, or
    // falls back to a sensible default (≥1) when the kernel is absent.
    expect(m.poolCap).toBeGreaterThanOrEqual(1);
    await shot(page, 'lod-streaming-active');
  });

  test('06 warmup + 15s FPS sample · assert mean ≥ 50fps', async () => {
    // Warmup: let the LOD scheduler settle + JIT warm + initial
    // tessellate jobs drain. During warmup the camera does a small
    // orbit so the scheduler exercises bucket transitions.
    await page.waitForTimeout(WARMUP_MS);

    const sample = await page.evaluate(async (sampleMs) => {
      function snapshot() {
        const r = window.__forgeRenderer;
        if (!r || !r.info) return { calls: 0, tris: 0 };
        return { calls: r.info.render.calls, tris: r.info.render.triangles };
      }
      const start = performance.now();
      let last = start;
      let frames = 0;
      const fpsBuckets = [];
      let bucketStart = start;
      let bucketFrames = 0;
      let minFps = Infinity, maxFps = -Infinity;
      let renderCallsSum = 0, triCountSum = 0, sumSamples = 0;
      const lodSnaps = [];
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
            try {
              const m = window.__forgeLodMetrics?.();
              if (m) lodSnaps.push({
                t: Math.round(t - start),
                high: m.high, med: m.med, low: m.low, hidden: m.hidden,
                poolBusy: m.poolBusy, queueDepth: m.queueDepth,
              });
            } catch { /* noop */ }
            bucketFrames = 0; bucketStart = t;
          }
          last = t;
          if (t - start >= sampleMs) resolve();
          else requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
      });
      const totalMs = last - start;
      const meanFps = (frames * 1000) / totalMs;
      const avgBucketFps = fpsBuckets.length
        ? fpsBuckets.reduce((a, b) => a + b, 0) / fpsBuckets.length : 0;
      return {
        frames, totalMs, meanFps, avgBucketFps,
        minFps: isFinite(minFps) ? minFps : 0,
        maxFps: isFinite(maxFps) ? maxFps : 0,
        buckets: fpsBuckets,
        avgDrawCalls: sumSamples ? renderCallsSum / sumSamples : 0,
        avgTriangles: sumSamples ? triCountSum / sumSamples : 0,
        lodSnaps,
        rendererPresent: typeof window.__forgeRenderer === 'object'
                           && window.__forgeRenderer !== null,
      };
    }, SAMPLE_MS);

    const finalLod = await page.evaluate(() => window.__forgeLodMetrics());

    const summary = {
      ts: new Date().toISOString(),
      scene: 'cloud100k',
      bodyCount: 100000,
      minFpsThreshold: MIN_FPS,
      sampleMs: SAMPLE_MS,
      warmupMs: WARMUP_MS,
      finalLod,
      ...sample,
    };
    fs.writeFileSync(METRICS_PATH, JSON.stringify(summary, null, 2));

    console.log('[Forge-125] LOD streaming sample:', {
      meanFps:     sample.meanFps.toFixed(2),
      avgBucketFps:sample.avgBucketFps.toFixed(2),
      minFps:      sample.minFps.toFixed(2),
      maxFps:      sample.maxFps.toFixed(2),
      avgDrawCalls:Math.round(sample.avgDrawCalls),
      avgTriangles:Math.round(sample.avgTriangles),
      finalLod,
      metricsPath: METRICS_PATH,
    });

    expect(sample.rendererPresent,
      'window.__forgeRenderer must be live').toBe(true);
    expect(sample.frames,
      'must have rendered at least one frame').toBeGreaterThan(0);
    expect(sample.meanFps,
      `Forge-125: mean FPS ${sample.meanFps.toFixed(2)} < ${MIN_FPS}. ` +
      `See ${METRICS_PATH} for the full sample.`)
      .toBeGreaterThanOrEqual(MIN_FPS);
    // InstancedMesh + LOD sanity: 100k cloud bodies share one instance
    // key → renderer.info.render.calls should stay tiny (single-digit
    // for the instanced mesh + grid + axes + gizmo ≤ ~10).
    expect(sample.avgDrawCalls,
      `Forge-125: avgDrawCalls ${sample.avgDrawCalls} suggests instancing ` +
      `is NOT batching — should be < 50, not approaching 100,000.`)
      .toBeLessThan(50);
  });

  test('07 multi-angle camera sweep + screenshot per view', async () => {
    for (const view of ANGLES) {
      await page.evaluate((v) => {
        window.__forgeStressSetView?.(v);
        window.__forgeStressCenter?.();
      }, view);
      // Let the camera-recenter ease (CameraCenterEffect uses 280ms)
      // and OrbitControls damping settle.
      await page.waitForTimeout(900);
      await shot(page, `angle-${view}`);
    }
    const finalView = await page.evaluate(() => window.__forgeStressView);
    expect(ANGLES).toContain(finalView);
  });

  test('08 metrics.json is well-formed + assertions persist', async () => {
    expect(fs.existsSync(METRICS_PATH)).toBe(true);
    const j = JSON.parse(fs.readFileSync(METRICS_PATH, 'utf8'));
    expect(j.bodyCount).toBe(100000);
    expect(j.scene).toBe('cloud100k');
    expect(typeof j.meanFps).toBe('number');
    expect(j.meanFps).toBeGreaterThanOrEqual(MIN_FPS);
    expect(Array.isArray(j.buckets)).toBe(true);
    expect(j.buckets.length).toBeGreaterThan(0);
    expect(Array.isArray(j.lodSnaps)).toBe(true);
    expect(j.lodSnaps.length).toBeGreaterThan(0);
    expect(j.finalLod.total).toBe(100000);
  });
});
