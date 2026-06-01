// Forge-125 — on-demand LOD streaming scheduler.
//
// Goal: drive 100,000 synthetic bodies at 60fps by re-tessellating each
// body only at the LOD level its current screen footprint demands.
//
// The scheduler is camera-aware and re-evaluates which LOD each body
// needs every frame. When the required level changes for a body it
// posts an "upgrade" job onto a worker queue whose concurrency is
// capped at the kernel's `tessellationPoolSize()` so the C++ worker
// pool isn't oversaturated.
//
// Distance buckets (mm from camera to body centre):
//   < 50        → High
//   50 … 200    → Med
//   ≥ 200       → Low
// These thresholds were tuned so the iso view of the 100k cloud (radius
// 800 mm, camera ≈ 1100 mm from origin) lands almost everything on Low
// while the inner shell that the user is actively zoomed into lifts to
// High/Med automatically.
//
// Frustum culling
// ---------------
// Bodies fully outside the camera's frustum are flagged `hidden = true`
// so the Viewport can skip them entirely. (They keep their slot in the
// body-id table so the InstancedMesh batch indices stay stable.) The
// scheduler accepts an externally-built three.Frustum so it doesn't
// have to import three itself — keeps this module pure JS, importable
// from Node tests.
//
// Kernel fallback
// ---------------
// If `window.forge` isn't ready (Vite dev shell without the .node
// binding), the scheduler falls back to a synthetic LOD model: a body
// at Low gets seg=6, at Med gets seg=16, at High gets seg=32. The
// Viewport uses these segments when rebuilding synthetic geometry.
//
// Exposed globals
// ---------------
// `window.__forgeLodMetrics()` returns a snapshot the PerfStatsHUD
// reads each frame:
//   { high, med, low, hidden, total, poolBusy, poolCap, queueDepth,
//     upgradesPerSec, downgradesPerSec, fallback }
//
// Manual UI never writes to Archie's thread; this module is pure
// performance plumbing.

/* eslint-disable no-restricted-globals */

const LEVELS = { LOW: 0, MED: 1, HIGH: 2 };
const LEVEL_NAMES = ['Low', 'Med', 'High'];

const DIST_BUCKETS = {
  highMaxMm: 50,
  medMaxMm:  200,
};

// Per-level synthetic segment counts (cylinder / sphere subdivisions)
// used when the kernel isn't available. Box bodies are unaffected by
// segments but we still tag them so the metrics stay coherent.
export const SYNTH_SEGMENTS = { 0: 6, 1: 16, 2: 32 };

/* =====================================================================
 * State held on the module. There is exactly one scheduler instance
 * — the Viewport's RAF loop tickles it each frame.
 * ===================================================================== */

const state = {
  // per-body-id (string) → { level: 0|1|2, hidden:bool, lastDistMm: number }
  bodyLevels: new Map(),
  // pending tessellation upgrades. Each entry:
  //   { bodyId, handle, level, started:bool, ts:number }
  queue: [],
  inflight: new Set(),         // body-ids currently being tessellated
  poolCap: 4,                  // refreshed from forge.tessellationPoolSize()
  // counters for the rolling per-second telemetry
  upgrades: [],                // timestamps (ms) of recent upgrades
  downgrades: [],
  lastFrameTs: 0,
  // observer the Viewport sets so it knows to rebuild a body's geom
  onLevelChange: null,
  // synthetic fallback flag
  kernelReady: false,
  // last computed counts (for window.__forgeLodMetrics)
  lastCounts: { high: 0, med: 0, low: 0, hidden: 0, total: 0 },
};

function refreshPoolCap() {
  try {
    if (typeof window !== 'undefined' && window.forge?.tessellationPoolSize) {
      const n = window.forge.tessellationPoolSize();
      if (typeof n === 'number' && n > 0) state.poolCap = Math.max(1, Math.min(64, n));
      state.kernelReady = true;
      return;
    }
  } catch { /* fall through to synthetic */ }
  state.kernelReady = false;
  // Sensible default when running synthetic-only.
  if (!state.poolCap) state.poolCap = 4;
}

function pruneTimestamps(arr, now) {
  const cutoff = now - 1000;
  while (arr.length && arr[0] < cutoff) arr.shift();
}

/* =====================================================================
 * Distance-based level picker.
 * ===================================================================== */

export function levelForDistance(distMm) {
  if (distMm < DIST_BUCKETS.highMaxMm) return LEVELS.HIGH;
  if (distMm < DIST_BUCKETS.medMaxMm)  return LEVELS.MED;
  return LEVELS.LOW;
}

/* =====================================================================
 * Public entry — called from Viewport SceneMeshes useFrame.
 *
 * `camera`          three Camera in world space
 * `bodies`          array of { id, kind, handle?, spec?, xform }
 * `frustum`         three.Frustum (already updated with camera.matrixWorldInverse)
 * `THREE`           the three module (caller already has it imported)
 *
 * Returns { decisions } where decisions is a Map<bodyId, { level, hidden,
 * dist }> — the Viewport applies these by selecting which BufferGeometry
 * variant to render and which xform matrix to put in the InstancedMesh.
 * ===================================================================== */

export function tick({ camera, bodies, frustum, THREE, screenH = 1000, fovRad = (Math.PI/4) }) {
  if (!camera || !Array.isArray(bodies) || !THREE) {
    return { decisions: new Map() };
  }
  refreshPoolCap();
  const now = performance.now();
  state.lastFrameTs = now;
  const decisions = new Map();
  const eye = camera.position;
  const tmp = new THREE.Vector3();
  const tmpSphere = new THREE.Sphere();

  let high = 0, med = 0, low = 0, hidden = 0;

  for (const b of bodies) {
    if (!b || !b.id) continue;
    const x = (b.xform?.x) || (b.spec?.cells?.[0]?.x) || 0;
    const y = (b.xform?.y) || (b.spec?.cells?.[0]?.y) || 0;
    const z = (b.xform?.z) || (b.spec?.cells?.[0]?.z) || 0;
    tmp.set(x, y, z);
    // Frustum cull. Use a tiny bounding sphere — bodies are ≤ 12mm so
    // a 12mm radius is generous. (Per-body radius isn't worth caching
    // here for 100k bodies; the false-positive cost is one extra LOD
    // upgrade, no more.)
    tmpSphere.set(tmp, 12);
    const visible = frustum ? frustum.intersectsSphere(tmpSphere) : true;
    const distMm = eye.distanceTo(tmp);
    const need = visible ? levelForDistance(distMm) : LEVELS.LOW;

    const prev = state.bodyLevels.get(b.id);
    const prevLevel = prev?.level;
    const prevHidden = prev?.hidden;
    if (prevLevel !== need || prevHidden !== !visible) {
      state.bodyLevels.set(b.id, { level: need, hidden: !visible, lastDistMm: distMm });
      if (prev) {
        if (need > (prevLevel ?? -1)) state.upgrades.push(now);
        else if (need < (prevLevel ?? Infinity)) state.downgrades.push(now);
      }
      // Queue the kernel re-tess if we have a native handle.
      if (visible && b.kind === 'native' && typeof b.handle === 'number') {
        if (!state.inflight.has(b.id)) {
          state.queue.push({ bodyId: b.id, handle: b.handle, level: need, ts: now });
        }
      }
    } else if (prev) {
      prev.lastDistMm = distMm;
    }

    decisions.set(b.id, { level: need, hidden: !visible, dist: distMm });
    if (!visible) hidden++;
    else if (need === LEVELS.HIGH) high++;
    else if (need === LEVELS.MED) med++;
    else low++;
  }

  state.lastCounts = { high, med, low, hidden, total: bodies.length };
  pruneTimestamps(state.upgrades, now);
  pruneTimestamps(state.downgrades, now);
  drainQueue();

  // Publish decisions globally so InstancedGroup's per-frame visibility
  // loop can read them without an extra subscription path.
  if (typeof window !== 'undefined') {
    window.__forgeLodDecisions = decisions;
  }

  return { decisions };
}

/* =====================================================================
 * Worker queue. We don't use real Web Workers — the kernel's
 * `tessellateAsync` returns a JS Promise that resolves on the main
 * thread once a C++ worker finishes the OCCT meshing. So our "queue"
 * is just a fixed concurrency gate around tessellateAsync.
 *
 * If `tessellateAsync` is missing we fall back to the synchronous
 * `tessellateLOD` call — still useful, just not parallel.
 * ===================================================================== */

function drainQueue() {
  if (state.queue.length === 0) return;
  const cap = state.poolCap;
  while (state.inflight.size < cap && state.queue.length > 0) {
    const job = state.queue.shift();
    if (state.inflight.has(job.bodyId)) continue;
    state.inflight.add(job.bodyId);
    runJob(job);
  }
}

function runJob(job) {
  // Latest desired level may have changed while the job was queued.
  const desired = state.bodyLevels.get(job.bodyId)?.level ?? job.level;
  const f = (typeof window !== 'undefined') ? window.forge : null;
  if (!f) {
    // No kernel — synthetic fallback. Just notify the listener so the
    // Viewport rebuilds with a different segment count.
    state.inflight.delete(job.bodyId);
    state.onLevelChange?.(job.bodyId, desired, null);
    drainQueue();
    return;
  }

  // Prefer async; fall back to sync.
  let p;
  try {
    if (typeof f.tessellateAsync === 'function' && desired === 2 /* High */) {
      // For High we exercise the parallel path explicitly so the pool
      // is actually saturated under stress.
      p = f.tessellateAsync(job.handle, 0.05, 0.5);
    } else if (typeof f.tessellateLOD === 'function') {
      // Synchronous on the main thread — fast for Low/Med (small mesh).
      const m = f.tessellateLOD(job.handle, desired);
      p = Promise.resolve(m);
    } else if (typeof f.tessellate === 'function') {
      const m = f.tessellate(job.handle, desired === 2 ? 0.05 : desired === 1 ? 0.25 : 1.25, 0.5);
      p = Promise.resolve(m);
    } else {
      p = Promise.resolve(null);
    }
  } catch (err) {
    p = Promise.reject(err);
  }

  p.then((mesh) => {
    state.inflight.delete(job.bodyId);
    state.onLevelChange?.(job.bodyId, desired, mesh);
  }).catch(() => {
    state.inflight.delete(job.bodyId);
    // best effort; leave the body at whatever its previous level was.
  }).finally(() => {
    drainQueue();
  });
}

/* =====================================================================
 * Listener registration. The Viewport calls this once on mount with a
 * function that knows how to swap the BufferGeometry on the relevant
 * InstancedMesh.
 * ===================================================================== */

export function setOnLevelChange(fn) {
  state.onLevelChange = typeof fn === 'function' ? fn : null;
}

export function clear() {
  state.bodyLevels.clear();
  state.queue.length = 0;
  state.inflight.clear();
  state.upgrades.length = 0;
  state.downgrades.length = 0;
  state.lastCounts = { high: 0, med: 0, low: 0, hidden: 0, total: 0 };
}

/* =====================================================================
 * Metrics surface for the perf HUD + the e2e spec.
 * ===================================================================== */

export function metrics() {
  const c = state.lastCounts;
  return {
    ...c,
    poolBusy: state.inflight.size,
    poolCap: state.poolCap,
    queueDepth: state.queue.length,
    upgradesPerSec: state.upgrades.length,
    downgradesPerSec: state.downgrades.length,
    fallback: !state.kernelReady,
    levelNames: LEVEL_NAMES,
  };
}

/* =====================================================================
 * Auto-register window-level handles so the perf HUD, the e2e spec,
 * and DevTools can drive / introspect the scheduler without imports.
 * ===================================================================== */

if (typeof window !== 'undefined') {
  window.__forgeLodMetrics = metrics;
  window.__forgeLodTick = tick;
  window.__forgeLodClear = clear;
  window.__forgeLodSetOnLevelChange = setOnLevelChange;
  window.__forgeLodLevels = LEVELS;
}

export const LODLevel = LEVELS;
export const LODBuckets = DIST_BUCKETS;
export default { tick, metrics, clear, setOnLevelChange, levelForDistance, LODLevel, LODBuckets };
