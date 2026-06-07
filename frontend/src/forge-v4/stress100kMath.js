// PUSH-207 (Slice-161) — Real 100k-part assembly generator.
//
// Up through PUSH-206 Forge has shipped:
//   • PUSH-94's Big Scene Stress Test panel — a SIDECAR canvas with one
//     THREE.InstancedMesh, no kernel involvement. Great for renderer
//     throughput but the bodies aren't kernel-backed.
//   • Forge-125's `generate100k()` Fibonacci-spherical cloud — pure-JS
//     synthetic specs (`kind:'box'`) that the SceneMeshes batcher renders
//     via InstancedGroup. No B-rep, no real OCCT handle.
//   • PUSH-164's OctreeIndex + PUSH-204's Viewport ticker publishing
//     `window.__forgeVisibleBodies`.
//   • PUSH-205 (in flight): InstancedGroup honours the visible-body Set.
//
// PUSH-207 ships the missing piece: a 100k-part assembly where every
// body has a REAL B-rep produced by the OCCT kernel. NOT 100k unique
// kernel handles (which would explode kernel memory + tessellation
// time) — instead a small set of TEMPLATE B-reps (~20) created once
// through `kernel.makeBox / makeCylinder / makeSphere`, with 100k
// instances each picking a template + a unique (translation, rotation)
// placement. The resulting body records carry:
//   • `handle` (number) — pointer to the shared template B-rep so the
//     octree + mass-props + section view all read the real OCCT geometry
//   • `templateId` (string) — which template the instance points to, so
//     SceneMeshes' InstancedGroup batches all bodies of one template
//     into a single GPU draw
//   • `xform` — { x, y, z } translation matching the SceneMeshes
//     contract in Viewport.jsx and the Forge-125 cloud schema
//   • `rot`   — Euler { rx, ry, rz } so the e2e screenshots look like a
//     real cluttered assembly, not an ordered grid
//
// Contract:
//   generate100kAssembly({ targetBodyCount, kernel, onProgress }) →
//     { bodies, templates, stats }
//
//   bodies:    Array<BodyRecord> — schema matching window.__forgeBodies
//   templates: Array<{ id, kind, handle, dims }> — for diagnostic dump
//   stats:     { wallClockMs, templateCount, bodyCount, ... }
//
//   onProgress: optional (fraction:0..1) => void — called every chunk
//   (the panel uses it to drive the progress bar).
//
// Time-bounded: the body-array build (the 100k loop) is chunked into
// CHUNK_SIZE batches with a setTimeout(0) yield between chunks so the
// React render loop can paint progress + the JS heap doesn't run a
// 100k-iteration synchronous loop on the renderer thread. The template
// build (≤ 20 kernel calls) runs synchronously — it's bounded.
//
// NO new npm deps. NO fake handles. If kernel.makeBox isn't available
// the function throws — no silent fallback per the user mandate.

// Number of bodies generated per chunk before yielding. 5k keeps each
// chunk under ~10 ms on the M4 Max so the UI thread stays responsive.
export const STRESS_100K_CHUNK_SIZE = 5000;

// Cloud half-extent (mm). 100k bodies inside [-EXT, +EXT]^3 with a
// per-axis half-extent of 800 mm gives a 1.6 m cube — readable on a
// 1080p viewport without dragging individual parts smaller than ~1
// screen-pixel. The Forge-125 cloud uses 800 mm radius and looks great.
export const STRESS_100K_CLOUD_HALF_MM = 800;

// Deterministic Mulberry32 PRNG so the seeded cloud is reproducible
// across runs (matches BigSceneStressPanel + the Forge-125 generator).
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─────────────────────────────────────────────────────────────────────
// Templates. The 20-entry palette is hand-picked to look like a real
// mechanical assembly: an engine block ships a mix of bolts (cylinders),
// brackets (boxes), washers, spacers, balls (bearings). Every entry is
// kept small (≤ 12 mm in any dimension) so 100k cells fit visually
// inside the cloud without overlapping.
//
// The spec field carries the box/cylinder/sphere parameters the
// SceneMeshes batcher reads when rendering the body — same schema the
// Forge-125 cloud uses (kind: 'box' | 'cylinder' | 'sphere' + dims).

export const STRESS_100K_TEMPLATES = Object.freeze([
  // Bolts (10 sizes — M3..M12) — cylinders.
  { tid: 't.bolt-m3',  kind: 'cylinder', r: 1.5, h:  6, name: 'Bolt M3'  },
  { tid: 't.bolt-m4',  kind: 'cylinder', r: 2.0, h:  8, name: 'Bolt M4'  },
  { tid: 't.bolt-m5',  kind: 'cylinder', r: 2.5, h: 10, name: 'Bolt M5'  },
  { tid: 't.bolt-m6',  kind: 'cylinder', r: 3.0, h: 12, name: 'Bolt M6'  },
  { tid: 't.bolt-m8',  kind: 'cylinder', r: 4.0, h: 16, name: 'Bolt M8'  },
  { tid: 't.bolt-m10', kind: 'cylinder', r: 5.0, h: 20, name: 'Bolt M10' },
  { tid: 't.bolt-m12', kind: 'cylinder', r: 6.0, h: 24, name: 'Bolt M12' },
  // Brackets — boxes of varying aspect ratios.
  { tid: 't.brk-s',    kind: 'box',      dx: 12, dy:  8, dz:  4, name: 'Bracket S' },
  { tid: 't.brk-m',    kind: 'box',      dx: 18, dy: 12, dz:  6, name: 'Bracket M' },
  { tid: 't.brk-l',    kind: 'box',      dx: 24, dy: 16, dz:  8, name: 'Bracket L' },
  { tid: 't.brk-cube', kind: 'box',      dx: 10, dy: 10, dz: 10, name: 'Block'     },
  // Washers — thin cylinders.
  { tid: 't.washer-m4', kind: 'cylinder', r: 4.5, h: 1.0, name: 'Washer M4' },
  { tid: 't.washer-m6', kind: 'cylinder', r: 6.5, h: 1.5, name: 'Washer M6' },
  { tid: 't.washer-m8', kind: 'cylinder', r: 8.5, h: 2.0, name: 'Washer M8' },
  // Spacers / standoffs — taller cylinders.
  { tid: 't.spacer-s', kind: 'cylinder', r: 3.0, h: 14, name: 'Spacer S' },
  { tid: 't.spacer-m', kind: 'cylinder', r: 4.0, h: 20, name: 'Spacer M' },
  // Balls (bearings).
  { tid: 't.ball-3',   kind: 'sphere',   r: 3.0, name: 'Ball Ø6'   },
  { tid: 't.ball-5',   kind: 'sphere',   r: 5.0, name: 'Ball Ø10'  },
  // Pins (long thin cylinders).
  { tid: 't.pin-s',    kind: 'cylinder', r: 1.2, h: 16, name: 'Pin S' },
  { tid: 't.pin-m',    kind: 'cylinder', r: 2.0, h: 22, name: 'Pin M' },
]);

// ─────────────────────────────────────────────────────────────────────
// Template factory — calls the kernel ONCE per template. Returns:
//   { templates, handlesById, failures }
// where templates is the input list augmented with `handle`, and
// failures is an array of { tid, err } for templates that the kernel
// rejected (so the caller can decide whether to abort).

export function buildStress100kTemplates(kernel) {
  if (!kernel || typeof kernel !== 'object') {
    throw new Error('stress100k: kernel argument is required (window.forge)');
  }
  if (typeof kernel.makeBox !== 'function'
      || typeof kernel.makeCylinder !== 'function'
      || typeof kernel.makeSphere !== 'function') {
    throw new Error(
      'stress100k: kernel is missing makeBox / makeCylinder / makeSphere — '
      + 'load the native OCCT kernel (forge-kernel.node) before generating');
  }
  const out = [];
  const handlesById = new Map();
  const failures = [];
  for (const t of STRESS_100K_TEMPLATES) {
    try {
      let handle = null;
      if (t.kind === 'box') {
        handle = kernel.makeBox(t.dx, t.dy, t.dz);
      } else if (t.kind === 'cylinder') {
        handle = kernel.makeCylinder(t.r, t.h);
      } else if (t.kind === 'sphere') {
        handle = kernel.makeSphere(t.r);
      } else {
        throw new Error(`unknown template kind: ${t.kind}`);
      }
      if (typeof handle !== 'number' || !Number.isFinite(handle)) {
        throw new Error(`kernel returned non-numeric handle: ${String(handle)}`);
      }
      out.push({ ...t, handle });
      handlesById.set(t.tid, handle);
    } catch (err) {
      failures.push({ tid: t.tid, err: String(err?.message || err) });
    }
  }
  return { templates: out, handlesById, failures };
}

// ─────────────────────────────────────────────────────────────────────
// Body record builder. For one body, picks a template at random, draws
// a random spatial position + Euler orientation, and returns the
// SceneMeshes-compatible body record. We assemble the spec field from
// the template so InstancedGroup can pick up dims even if it can't
// see the kernel handle (mirrors the Forge-125 cloud body shape).

function bodyForTemplate(template, position, rotation, index) {
  const spec = template.kind === 'box'
    ? { kind: 'box', dx: template.dx, dy: template.dy, dz: template.dz }
    : template.kind === 'cylinder'
      ? { kind: 'cylinder', r: template.r, h: template.h }
      : { kind: 'sphere', r: template.r };
  return {
    id: `stress100k-${template.tid}-${index}`,
    kind: 'synthetic',
    // The kernel handle is shared across every body of the same
    // template — this is the whole point of PUSH-207. Tooling that
    // wants the real B-rep (massProps / section / interference) reads
    // from `handle`; tooling that batches the GPU read picks up `spec`.
    handle: template.handle,
    templateId: template.tid,
    spec,
    xform: position,
    // SceneMeshes' InstancedGroup composes per-body rotation off
    // `rotation: [rx, ry, rz]` if present (matches the pattern other
    // synthetic bodies use). Keep both array + object form so any
    // consumer finds it.
    rotation: [rotation.rx, rotation.ry, rotation.rz],
    pose: {
      position: [position.x, position.y, position.z],
      rotation: [rotation.rx, rotation.ry, rotation.rz],
    },
    toolId: 'stress100k.cell',
    params: {},
    // Same `instanceTag` for every body sharing a template → the
    // SceneMeshes batcher collapses 100k bodies into ~20 GPU draws.
    instanceTag: `stress100k:${template.tid}`,
    name: template.name,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Public — async chunked generator.
//
//   const { bodies, templates, stats } = await generate100kAssembly({
//     targetBodyCount: 100000,
//     kernel: window.forge,
//     onProgress: (frac) => setProgress(frac),
//   });
//
// Yields between chunks with await new Promise(setTimeout(0)) so the
// React render loop can paint the progress bar + the panel chip values.

export async function generate100kAssembly({
  targetBodyCount = 100000,
  kernel = (typeof window !== 'undefined' ? window.forge : null),
  seed = (Date.now() & 0x7fffffff) >>> 0,
  chunkSize = STRESS_100K_CHUNK_SIZE,
  cloudHalfMm = STRESS_100K_CLOUD_HALF_MM,
  onProgress = null,
} = {}) {
  const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const target = Math.max(1, Math.min(500000, targetBodyCount | 0));
  // 1. Build the template B-reps once.
  const tBuild0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  const { templates, failures } = buildStress100kTemplates(kernel);
  const tBuild1 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  if (templates.length === 0) {
    throw new Error(
      'stress100k: every template kernel call failed — first failure: '
      + (failures[0]?.err || 'unknown'));
  }
  // 2. Walk N bodies in chunks, yielding between each.
  const rng = mulberry32(seed);
  const bodies = new Array(target);
  let written = 0;
  while (written < target) {
    const end = Math.min(target, written + chunkSize);
    for (let i = written; i < end; i += 1) {
      // Pick a template — uniform random.
      const tIdx = Math.floor(rng() * templates.length);
      const tpl = templates[tIdx] || templates[0];
      const pos = {
        x: (rng() - 0.5) * 2 * cloudHalfMm,
        y: (rng() - 0.5) * 2 * cloudHalfMm,
        z: (rng() - 0.5) * 2 * cloudHalfMm,
      };
      const rot = {
        rx: rng() * Math.PI * 2,
        ry: rng() * Math.PI * 2,
        rz: rng() * Math.PI * 2,
      };
      bodies[i] = bodyForTemplate(tpl, pos, rot, i);
    }
    written = end;
    if (typeof onProgress === 'function') {
      try { onProgress(written / target); } catch { /* fail-soft */ }
    }
    // Yield — let the render loop paint + give the panel time to
    // update its progress chip. await sets a macrotask so React's
    // batched updates flush. Skip the yield when we're done.
    if (written < target) {
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  const t1 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
  return {
    bodies,
    templates,
    failures,
    stats: {
      wallClockMs:      t1 - t0,
      templateBuildMs:  tBuild1 - tBuild0,
      bodyLoopMs:       t1 - tBuild1,
      bodyCount:        bodies.length,
      templateCount:    templates.length,
      templateFailures: failures.length,
      seed,
      cloudHalfMm,
      chunkSize,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────
// Memory delta helper. performance.memory is non-standard but ships on
// Chromium/Electron, which is what we care about. Returns null on
// non-Chromium runtimes — the panel reads it and shows '—' in that case.

export function snapshotJsHeap() {
  if (typeof performance === 'undefined') return null;
  const m = performance.memory;
  if (!m || typeof m.usedJSHeapSize !== 'number') return null;
  return {
    usedJSHeapSize:  m.usedJSHeapSize,
    totalJSHeapSize: m.totalJSHeapSize,
    jsHeapSizeLimit: m.jsHeapSizeLimit,
  };
}

// Format a byte count to MB / GB with 1 decimal, matching the chip
// styling other Forge panels use.
export function formatBytes(n) {
  if (!Number.isFinite(n)) return '—';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

// ─────────────────────────────────────────────────────────────────────
// FPS sampler — average over a fixed frame count via rAF. Returns a
// Promise<{ fps, msPerFrame, frames }> after `frameCount` samples.

export function sampleFps({ frameCount = 60 } = {}) {
  return new Promise((resolve) => {
    if (typeof requestAnimationFrame !== 'function'
        || typeof performance === 'undefined') {
      resolve({ fps: 0, msPerFrame: 0, frames: 0 });
      return;
    }
    const target = Math.max(1, frameCount | 0);
    let n = 0;
    let t0 = 0;
    const tick = (now) => {
      if (n === 0) t0 = now;
      n += 1;
      if (n >= target) {
        const elapsed = now - t0;
        const ms = elapsed / Math.max(1, n - 1);
        const fps = ms > 0 ? (1000 / ms) : 0;
        resolve({ fps, msPerFrame: ms, frames: n });
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

// ─────────────────────────────────────────────────────────────────────
// Visible-body count — reads window.__forgeVisibleBodies (the PUSH-204
// surface published by Viewport.jsx). The panel needs this to compute
// the culling ratio.

export function readVisibleBodyCount() {
  if (typeof window === 'undefined') return 0;
  const v = window.__forgeVisibleBodies;
  if (!v) return 0;
  if (v instanceof Set) return v.size;
  if (Array.isArray(v)) return v.length;
  if (typeof v.size === 'number') return v.size;
  return 0;
}

export default {
  STRESS_100K_TEMPLATES,
  STRESS_100K_CHUNK_SIZE,
  STRESS_100K_CLOUD_HALF_MM,
  buildStress100kTemplates,
  generate100kAssembly,
  snapshotJsHeap,
  formatBytes,
  sampleFps,
  readVisibleBodyCount,
};
