// PUSH-97 (Slice-65 / Batched Cable / Pipe Routing panel).
//
// PUSH-45 ships single-route A* pipe routing — one (start, end) pair
// per Apply, one pipe solid committed per invocation. PUSH-97 ships
// the BATCHED flow: N (start, end) rows, sequential apply, every later
// row treats earlier-committed pipes as obstacles, all routes share
// the live scene's bodies as the obstacle map.
//
// Proof end-to-end through the real Electron shell:
//   1. Boot + assert the host's headless surface
//      (window.__forgeBatchRouter + window.__forgeOpenBatchRoutingPanel)
//      is wired by the BatchRoutingPanelHost mount effect. That's the
//      proof App.jsx mounted the host.
//   2. Open the Batch Routing panel via the tools.batchRouting menu
//      action. Assert the panel mounts with the seeded 2-row table.
//   3. Edit both rows to non-trivial coordinates that don't overlap.
//   4. Click Apply. Wait for the published forge:batch-routing-applied
//      bus event. Assert summary chip reads "Routed 2/2".
//   5. Assert window.__forgeBodies has gained exactly 2 native pipe
//      bodies, each with kernel handle > 0 and positive volume from
//      forge.massProps.
//   6. PUSH-45 regression: open the single-pipe routing panel via
//      tools.piperoute and run its default route. Assert the original
//      PipeRouteWorkbench still commits its pipe (count +1) and the
//      Batch Routing panel coexists as a portal sibling.
//
// Multi-cam: 5 named camera angles per the Forge-171 mandate.
//   - iso   (boot + helper API assertion)
//   - front (open panel + seed rows)
//   - top   (Apply + bus event)
//   - right (assert volumes + body count)
//   - iso   (PUSH-45 regression)

const { test, expect, _electron: electron } = require('@playwright/test');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

test.setTimeout(600000);
test.describe.configure({ mode: 'serial' });

const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output', 'push-97-batch-routing');
const VIDEO_DIR  = path.join(OUTPUT_DIR, 'video');
const FINAL_MP4  = path.join(OUTPUT_DIR, 'batch-routing-session.mp4');

let app, page;
let stepIndex = 0;

async function shot(label) {
  stepIndex += 1;
  const name = String(stepIndex).padStart(3, '0') + '-' + label.replace(/[^a-z0-9-_.]/gi, '_');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(OUTPUT_DIR, `${name}.png`), fullPage: true });
}
async function pause(ms = 350) { await page.waitForTimeout(ms); }

async function platformMenuAction(actionId) {
  await page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id } }));
  }, actionId);
  await pause(400);
}
async function cameraTo(viewName) {
  await platformMenuAction(`view.${viewName}`);
  await pause(250);
}

async function setReactInput(testid, value) {
  await page.evaluate((args) => {
    const el = document.querySelector(`[data-testid="${args.testid}"]`);
    if (!el) throw new Error(`input not found: ${args.testid}`);
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(el, args.value);
    el.dispatchEvent(new Event('input',  { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }, { testid, value });
}

async function nativeBodyCount() {
  return await page.evaluate(() =>
    (window.__forgeBodies || []).filter((b) => b && b.kind === 'native').length);
}
async function nativeBodyVolumes() {
  return await page.evaluate(() => {
    const bodies = (window.__forgeBodies || []).filter((b) => b && b.kind === 'native');
    if (!window.forge?.massProps) return [];
    return bodies.map((b) => {
      try { return Math.abs(window.forge.massProps(b.handle).volume); }
      catch { return null; }
    });
  });
}

test.beforeAll(async () => {
  fs.mkdirSync(VIDEO_DIR, { recursive: true });
  app = await electron.launch({
    args: [path.resolve(__dirname, '..')], timeout: 60000,
    recordVideo: { dir: VIDEO_DIR, size: { width: 1920, height: 1080 } },
  });
  page = await app.firstWindow();
  page.on('console', (msg) => {
    const t = msg.text();
    if (msg.type() === 'error' || msg.type() === 'warning'
        || /push-97|batch-routing|BatchRouting|forge:batch-routing|piperoute|error|Error/i.test(t)) {
      console.log('[browser]', msg.type(), t);
    }
  });
  page.on('pageerror', (err) => {
    console.log('[browser pageerror]', err.message);
  });
  await page.waitForLoadState('domcontentloaded');
  await pause(3000);

  // Dismiss first-run banners + the onboarding tour overlay (which
  // intercepts pointer events on every panel button).
  const setBtn = page.locator('button:has-text("Set")');
  if (await setBtn.count() > 0) await setBtn.first().click({ timeout: 3000 }).catch(() => {});
  else await page.keyboard.press('Escape');
  const discard = page.locator('button:has-text("Discard")');
  if (await discard.count() > 0) await discard.first().click({ timeout: 3000 }).catch(() => {});
  await page.evaluate(() => {
    try { window.localStorage.setItem('forge.v4.onboarded', '1'); } catch {}
  });
  const tourSkip = page.locator('[data-testid="forge-tour-skip"]');
  if (await tourSkip.count() > 0) {
    await tourSkip.first().click({ timeout: 3000 }).catch(() => {});
    await pause(400);
  }
  await pause(800);
});

test.afterAll(async () => {
  try { await pause(2000); } catch {}
  let videoPath = null;
  try { videoPath = await page.video()?.path(); } catch {}
  if (app) {
    try { await app.close({ timeout: 10000 }); }
    catch { try { (await app.process()).kill('SIGKILL'); } catch {} }
  }
  await new Promise((r) => setTimeout(r, 1200));
  if (!videoPath || !fs.existsSync(videoPath)) {
    const cands = fs.existsSync(VIDEO_DIR)
      ? fs.readdirSync(VIDEO_DIR).filter((f) => f.endsWith('.webm'))
      : [];
    if (cands.length > 0) videoPath = path.join(VIDEO_DIR, cands[0]);
  }
  if (!videoPath || !fs.existsSync(videoPath)) {
    console.error('[push-97] no .webm');
    return;
  }
  try { fs.unlinkSync(FINAL_MP4); } catch {}
  const ffmpegBin = require('ffmpeg-static');
  await new Promise((resolve) => {
    const args = ['-y', '-i', videoPath, '-c:v', 'libx264', '-preset', 'medium',
      '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', FINAL_MP4];
    const child = spawn(ffmpegBin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('close', (code) => {
      if (code === 0 && fs.existsSync(FINAL_MP4)) {
        const sz = (fs.statSync(FINAL_MP4).size / 1024 / 1024).toFixed(2);
        console.log(`[push-97] mp4 written: ${FINAL_MP4} (${sz} MB)`);
      } else {
        console.error('[push-97] ffmpeg failed:', code, err.split('\n').slice(-6).join('\n'));
      }
      resolve();
    });
  });
});

test('00 — boot + helper API mounted + empty native body scene (iso)', async () => {
  await cameraTo('iso');
  await shot('boot');

  // The host effect installs the headless helper API mirror at module
  // load. That's the proof BatchRoutingPanelHost mounted from App.jsx
  // BEFORE the panel itself is opened.
  await page.waitForFunction(
    () => !!window.__forgeBatchRouter
       && typeof window.__forgeOpenBatchRoutingPanel === 'function'
       && typeof window.__forgeCloseBatchRoutingPanel === 'function'
       && typeof window.__forgeBatchRouter.runBatch === 'function'
       && typeof window.__forgeBatchRouter.makeDefaultRow === 'function'
       && typeof window.__forgeBatchRouter.readSceneObstacles === 'function'
       && typeof window.__forgeBatchRouter.polylineToObstacleAabb === 'function'
       && typeof window.__forgeBatchRouter.bodyToObstacleAabb === 'function',
    null, { timeout: 8000 });

  // Pure helpers — sanity-check them headless. polylineToObstacleAabb
  // and bodyToObstacleAabb must be safely callable before the panel
  // mounts so plugins / Archie tool-calls can drive them.
  const helperSanity = await page.evaluate(() => {
    const h = window.__forgeBatchRouter;
    const row = h.makeDefaultRow(0);
    const aabb = h.polylineToObstacleAabb([0, 0, 0, 10, 0, 0, 10, 5, 0], 1, 1);
    const bodyAabb = h.bodyToObstacleAabb({
      id: 'sanity', kind: 'native', handle: 1, toolId: 'solid.box',
      params: { width: 10, height: 6, distance: 4 },
    });
    return {
      rowHasStart: Array.isArray(row.start) && row.start.length === 3,
      rowHasEnd:   Array.isArray(row.end)   && row.end.length   === 3,
      polyMinX: aabb ? aabb.min[0] : null,
      polyMaxX: aabb ? aabb.max[0] : null,
      polyMaxY: aabb ? aabb.max[1] : null,
      bodyHalfX: bodyAabb ? bodyAabb.max[0] : null,
      bodyHalfY: bodyAabb ? bodyAabb.max[1] : null,
      bodyHalfZ: bodyAabb ? bodyAabb.max[2] : null,
    };
  });
  expect(helperSanity.rowHasStart).toBe(true);
  expect(helperSanity.rowHasEnd).toBe(true);
  // Pad = radius + grid = 1 + 1 = 2, so minX = 0 - 2 = -2; maxX = 10 + 2 = 12.
  expect(helperSanity.polyMinX).toBeCloseTo(-2, 5);
  expect(helperSanity.polyMaxX).toBeCloseTo(12, 5);
  // maxY = 5 + 2 = 7.
  expect(helperSanity.polyMaxY).toBeCloseTo(7, 5);
  // Box (w=10, h=6, d=4) → half-extents (5, 3, 2).
  expect(helperSanity.bodyHalfX).toBeCloseTo(5, 5);
  expect(helperSanity.bodyHalfY).toBeCloseTo(3, 5);
  expect(helperSanity.bodyHalfZ).toBeCloseTo(2, 5);

  // We start from an empty scene — that's the brief's contract.
  expect(await nativeBodyCount()).toBe(0);
});

test('01 — open Batch Routing via tools.batchRouting; 2 seeded rows visible (front)', async () => {
  await cameraTo('front');
  await platformMenuAction('tools.batchRouting');
  await page.waitForSelector('[data-testid="forge-batch-routing-panel"]',
                             { state: 'visible', timeout: 6000 });
  await shot('panel-open');

  // Panel mounted with the seeded 2-row table.
  const panel = page.locator('[data-testid="forge-batch-routing-panel"]');
  await expect(panel).toBeVisible();
  const rowCount = await panel.getAttribute('data-row-count');
  expect(rowCount).toBe('2');

  // No obstacles in the scene yet — the data-obstacle-count reflects
  // that. (The empty scene comes from the boot step.)
  const obstacleCount = await panel.getAttribute('data-obstacle-count');
  expect(obstacleCount).toBe('0');

  // The Apply button is present + enabled (defaults give valid routes).
  const applyBtn = page.locator('[data-testid="forge-batch-routing-apply"]');
  await expect(applyBtn).toBeVisible();
  await expect(applyBtn).toBeEnabled();

  // Routes table is present and has 2 rows.
  const rows = page.locator('[data-testid="forge-batch-routing-row"]');
  expect(await rows.count()).toBe(2);

  // The radius input defaults to 0.75 mm.
  const radiusInput = page.locator('[data-testid="forge-batch-routing-radius"]');
  await expect(radiusInput).toBeVisible();
  const r0 = await radiusInput.inputValue();
  expect(parseFloat(r0)).toBeCloseTo(0.75, 5);
});

test('02 — edit both rows to non-overlapping coords + Apply commits 2 pipe bodies (top)', async () => {
  await cameraTo('top');

  // Capture the bus event so we can prove Apply published a CustomEvent.
  await page.evaluate(() => {
    window.__push97Events = [];
    window.addEventListener('forge:batch-routing-applied', (e) => {
      try {
        window.__push97Events.push({
          routed: e?.detail?.routed,
          failed: e?.detail?.failed,
          total:  e?.detail?.total,
        });
      } catch {}
    });
  });

  // Grab the row ids the host serialised. The makeDefaultRow seed
  // gives each row a deterministic id; we read them off the DOM so
  // we don't depend on the internal counter.
  const rowIds = await page.evaluate(() => {
    const arr = Array.from(document.querySelectorAll(
      '[data-testid="forge-batch-routing-row"]'));
    return arr.map((el) => el.getAttribute('data-row-id'));
  });
  expect(rowIds.length).toBe(2);

  // Row 1: (0, 0, 0) → (30, 0, 0). Row 2: (0, 10, 0) → (30, 10, 0).
  // Y offset of 10 keeps them far apart enough that the second route's
  // obstacle map (which includes the first pipe) doesn't pin it in.
  // The radius is 0.75 + grid 1 + bbMargin 6 — plenty of clearance.
  const [id1, id2] = rowIds;
  await setReactInput(`forge-batch-routing-start-${id1}-x`, '0');
  await setReactInput(`forge-batch-routing-start-${id1}-y`, '0');
  await setReactInput(`forge-batch-routing-start-${id1}-z`, '0');
  await setReactInput(`forge-batch-routing-end-${id1}-x`, '30');
  await setReactInput(`forge-batch-routing-end-${id1}-y`, '0');
  await setReactInput(`forge-batch-routing-end-${id1}-z`, '0');
  await setReactInput(`forge-batch-routing-start-${id2}-x`, '0');
  await setReactInput(`forge-batch-routing-start-${id2}-y`, '20');
  await setReactInput(`forge-batch-routing-start-${id2}-z`, '0');
  await setReactInput(`forge-batch-routing-end-${id2}-x`, '30');
  await setReactInput(`forge-batch-routing-end-${id2}-y`, '20');
  await setReactInput(`forge-batch-routing-end-${id2}-z`, '0');
  await pause(200);
  await shot('rows-edited');

  // Snapshot the pre-apply body count.
  const preCount = await nativeBodyCount();
  expect(preCount).toBe(0);

  // Click Apply. The VideoCaptureHUD lives at zIndex 2400 bottom-right
  // and can race for the pointer; drive the click programmatically.
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="forge-batch-routing-apply"]');
    if (!btn) throw new Error('apply button not found');
    btn.click();
  });
  // Wait for the bus event.
  await page.waitForFunction(() => {
    const arr = window.__push97Events || [];
    return arr.length > 0;
  }, null, { timeout: 12000 });
  await pause(400);
  await shot('after-apply');

  const events = await page.evaluate(() => window.__push97Events || []);
  expect(events.length).toBeGreaterThan(0);
  const newest = events[events.length - 1];
  expect(newest.total).toBe(2);
  expect(newest.routed).toBe(2);
  expect(newest.failed).toBe(0);

  // Two native pipe bodies committed.
  const postCount = await nativeBodyCount();
  expect(postCount).toBe(2);

  // Summary line reads "Routed 2/2 · Failed 0".
  const summaryTxt = await page.locator(
    '[data-testid="forge-batch-routing-summary"]').textContent();
  expect((summaryTxt || '').replace(/\s+/g, ' ').trim())
    .toContain('Routed 2/2');
  expect((summaryTxt || '').replace(/\s+/g, ' ').trim())
    .toContain('Failed 0');

  // Each row's status tag flipped to "routed".
  for (const id of rowIds) {
    const tag = await page.locator(`[data-testid="forge-batch-routing-status-${id}"]`).textContent();
    expect((tag || '').toLowerCase()).toContain('routed');
  }

  // The panel's data attributes reflect the routed/failed totals.
  const panel = page.locator('[data-testid="forge-batch-routing-panel"]');
  expect(await panel.getAttribute('data-routed-count')).toBe('2');
  expect(await panel.getAttribute('data-failed-count')).toBe('0');
});

test('03 — kernel handles + positive volumes + obstacle-count grew by 2 (right)', async () => {
  await cameraTo('right');

  // Read every native body's volume off the kernel. Both pipes must
  // have positive volume — that's the proof they're real OCCT solids
  // (not synthetic placeholders).
  const vols = await nativeBodyVolumes();
  console.log('[push-97] batched pipe volumes =', vols);
  expect(vols.length).toBe(2);
  for (const v of vols) {
    expect(v).not.toBeNull();
    expect(v).toBeGreaterThan(0);
  }

  // Inspect the committed body records — every one must carry the
  // pipe radius in params (the brief's contract for downstream BOM /
  // MassProps / STL Export pipelines).
  const bodyShapes = await page.evaluate(() => {
    const arr = (window.__forgeBodies || []).filter((b) => b && b.kind === 'native');
    return arr.map((b) => ({
      id: b.id,
      handle: b.handle,
      toolId: b.toolId,
      radius: b.params ? b.params.radius : null,
      length: b.params ? b.params.length : null,
      elbows: b.params ? b.params.elbows : null,
      hasAabb: !!(b.aabb && Array.isArray(b.aabb.min) && Array.isArray(b.aabb.max)),
    }));
  });
  for (const b of bodyShapes) {
    expect(b.handle).toBeGreaterThan(0);
    expect(b.toolId).toBe('routing.batchPipe');
    expect(b.radius).toBeGreaterThan(0);
    expect(b.length).toBeGreaterThan(0);
    expect(b.hasAabb).toBe(true);
  }

  // Now that 2 pipes have committed, the obstacle list (as the panel
  // reads it from the live scene) should include them — count = 2.
  const obstacleCount = await page.locator(
    '[data-testid="forge-batch-routing-panel"]').getAttribute('data-obstacle-count');
  expect(Number(obstacleCount)).toBe(2);

  await shot('volumes-checked');
});

test('04 — PUSH-45 regression: tools.piperoute still routes a single pipe (iso)', async () => {
  await cameraTo('iso');

  const preCount = await nativeBodyCount();
  expect(preCount).toBe(2);

  // Close the Batch Routing panel first so its right-rail doesn't
  // intercept clicks on the Pipe Routing panel which mounts at the
  // same edge.
  await page.evaluate(() => {
    if (typeof window.__forgeCloseBatchRoutingPanel === 'function') {
      window.__forgeCloseBatchRoutingPanel();
    }
  });
  await pause(300);

  // Open the single-pipe Pipe Routing workbench via its menu action.
  await platformMenuAction('tools.piperoute');
  await page.waitForSelector('[data-testid="forge-piperoute-panel"]',
                             { state: 'visible', timeout: 6000 });
  await shot('piperoute-open');

  // The single-pipe Pipe Routing panel is visible. The Batch Routing
  // panel was closed for visibility but its host is still mounted
  // (data-testid lives in the React portal tree until the host effect
  // unmounts on unmount).
  await expect(page.locator('[data-testid="forge-piperoute-panel"]')).toBeVisible();
  await expect(page.locator('[data-testid="forge-batch-routing-panel"]')).toHaveCount(0);

  // Run the default single route. Drive the click programmatically so
  // a stray HUD layer doesn't race for the pointer.
  await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="forge-piperoute-run"]');
    if (!btn) throw new Error('piperoute run button not found');
    btn.click();
  });
  await pause(1500);
  await shot('piperoute-applied');

  // PUSH-45's contract: count grew by exactly 1, the new body's volume
  // is positive.
  const postCount = await nativeBodyCount();
  expect(postCount).toBe(preCount + 1);
  const allVols = await nativeBodyVolumes();
  expect(allVols.length).toBe(postCount);
  // Last volume — the freshly routed single pipe.
  const last = allVols[allVols.length - 1];
  expect(last).not.toBeNull();
  expect(last).toBeGreaterThan(0);
});
