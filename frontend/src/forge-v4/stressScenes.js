// Forge-111 — stress-test scene generators.
//
// 20,000-component scenes that exercise the THREE.InstancedMesh batching
// wired into Viewport.SceneMeshes by Forge-106. Every body shares the
// same synthetic spec (`kind:'box'` or `'cylinder'`) and the same
// `instanceTag`, so SceneMeshes' `instanceKeyFor()` groups them into a
// single InstancedGroup → a single GPU draw call regardless of count.
//
// The generators here are pure — no React, no DOM, no kernel. They
// return plain-array body records the ForgeShellV4 body registry (or
// the StressTestPanel overlay) can ingest verbatim. Layouts are
// computed so the eye can read instancing visually (a grid stretching
// across the viewport, with z stagger to break up the plane).
//
// Used by:
//   - StressTestPanel.jsx (the in-app load buttons)
//   - e2e/forge/v4-stress-20k.spec.js (the 30 fps assertion)
//
// Manual UI never writes to Archie's thread; these helpers don't touch
// the runner.

/* =====================================================================
 * Layout helpers.
 * ===================================================================== */

// Lay N points on a cols×rows grid (centred on origin), with a small
// per-row z stagger so the layout reads as a checkerboard-of-heights
// from the side — no two rows share a z plane. This breaks the
// degenerate "all at z=0" case the task warns about.
function gridLayout(n, cols, rows, spacingX, spacingY, stagger) {
  const out = new Array(n);
  const w = (cols - 1) * spacingX;
  const h = (rows - 1) * spacingY;
  for (let i = 0; i < n; i++) {
    const ix = i % cols;
    const iy = Math.floor(i / cols) % rows;
    const layer = Math.floor(i / (cols * rows));
    // Per-row staircase + overflow layering. (iy % 4) gives a 4-tier
    // checker so a side view shows depth + (ix % 2) jitters odd columns
    // up so neighbouring bolts never share Z exactly. Layer stride
    // dominates for any overflow beyond cols*rows.
    out[i] = {
      x: ix * spacingX - w / 2,
      y: iy * spacingY - h / 2,
      z: layer * stagger * 4
       + (iy % 4) * stagger
       + (ix % 2) * (stagger * 0.5),
    };
  }
  return out;
}

// Deterministic PRNG (mulberry32) so the mixed scene is reproducible
// across runs — important for the 30fps assertion's stability.
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* =====================================================================
 * Synthetic specs. Same `instanceKey` for every member of a generator
 * batch → single InstancedMesh in SceneMeshes.
 * ===================================================================== */

// The exact synthetic spec the task specifies. `cells:[{x,y,z}]` carries
// this instance's grid position so the body record satisfies the
// schema; InstancedGroup picks per-instance positions out of
// `body.spec.cells[i]` (see Viewport.jsx line 431). cells is a
// 1-element array — index-0 of every body — matching the v4 schema.
function boltSpec(pos) {
  return { kind: 'box', dx: 8, dy: 8, dz: 12, cells: [pos] };
}
function bracketSpec(pos) {
  // Slightly different box dims so brackets read distinctly from bolts
  // when both scenes are loaded back-to-back. Still a single 'box'
  // primitive so instanceKey collapses to one group.
  return { kind: 'box', dx: 14, dy: 10, dz: 4, cells: [pos] };
}

/* =====================================================================
 * Public generators.
 * ===================================================================== */

// 20,000 bolts on a 200 × 100 grid (= 20,000 cells exactly). 8mm × 8mm
// footprint + 12mm spacing → ~2.6m × 1.3m grid, comfortably inside the
// camera's far-plane (5000 mm in Viewport.jsx).
export function generateBolts20k() {
  const total = 20000;
  const cols = 200;
  const rows = 100;
  const spacing = 12;     // mm — clears 8mm footprint with margin
  const stagger = 6;      // mm — z step (only matters if layer > 0)
  const positions = gridLayout(total, cols, rows, spacing, spacing, stagger);
  const out = new Array(total);
  for (let i = 0; i < total; i++) {
    const pos = positions[i];
    out[i] = {
      id: `stress-bolt-${i}`,
      kind: 'synthetic',
      spec: boltSpec(pos),
      toolId: 'stress.bolt',
      params: {},
      instanceTag: 'bolt20k',
      name: 'Bolt',
    };
  }
  return out;
}

// 5,000 brackets on a 100 × 50 grid.
export function generateBrackets5k() {
  const total = 5000;
  const cols = 100;
  const rows = 50;
  const spacing = 18;
  const stagger = 5;
  const positions = gridLayout(total, cols, rows, spacing, spacing, stagger);
  const out = new Array(total);
  for (let i = 0; i < total; i++) {
    const pos = positions[i];
    out[i] = {
      id: `stress-bracket-${i}`,
      kind: 'synthetic',
      spec: bracketSpec(pos),
      toolId: 'stress.bracket',
      params: {},
      instanceTag: 'bracket5k',
      name: 'Bracket',
    };
  }
  return out;
}

// `n` bodies sprinkled with random tool IDs and a small palette of
// synthetic specs so several InstancedGroups co-exist (each spec
// produces its own instance key). Deterministic via seeded PRNG so
// repeated test runs measure the same scene.
export function generateMixedScene(n) {
  const rng = mulberry32(0xF0FE111);
  const cols = Math.ceil(Math.sqrt(n));
  const rows = Math.ceil(n / cols);
  const spacing = 14;
  const stagger = 4;
  const positions = gridLayout(n, cols, rows, spacing, spacing, stagger);
  // A small palette so SceneMeshes ends up with ~6 InstancedGroups
  // sharing the n-body load. Each kind defines its own instanceTag so
  // instanceKeyFor() collapses correctly.
  const PALETTE = [
    { tag: 'mix.bolt',    toolId: 'stress.bolt',
      build: (pos) => ({ kind: 'box', dx: 8, dy: 8, dz: 12, cells: [pos] }),
      name: 'Bolt' },
    { tag: 'mix.bracket', toolId: 'stress.bracket',
      build: (pos) => ({ kind: 'box', dx: 14, dy: 10, dz: 4, cells: [pos] }),
      name: 'Bracket' },
    { tag: 'mix.washer',  toolId: 'stress.washer',
      build: (pos) => ({ kind: 'cylinder', r: 6, h: 1.6, cells: [pos] }),
      name: 'Washer' },
    { tag: 'mix.nut',     toolId: 'stress.nut',
      build: (pos) => ({ kind: 'cylinder', r: 5, h: 6, cells: [pos] }),
      name: 'Nut' },
    { tag: 'mix.spacer',  toolId: 'stress.spacer',
      build: (pos) => ({ kind: 'box', dx: 6, dy: 6, dz: 18, cells: [pos] }),
      name: 'Spacer' },
    { tag: 'mix.pin',     toolId: 'stress.pin',
      build: (pos) => ({ kind: 'cylinder', r: 2.4, h: 22, cells: [pos] }),
      name: 'Pin' },
  ];
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const pos = positions[i];
    const p = PALETTE[Math.floor(rng() * PALETTE.length)];
    out[i] = {
      id: `stress-mix-${i}`,
      kind: 'synthetic',
      spec: p.build(pos),
      toolId: p.toolId,
      params: {},
      instanceTag: p.tag,
      name: p.name,
    };
  }
  return out;
}

// Forge-125 — 100,000-body spherical cloud.
//
// Generates 100k box bodies positioned on a Fibonacci-sphere-like
// distribution around the origin out to radius ≈ 800 mm. Every body
// shares the same `instanceTag` so SceneMeshes batches them into a
// single InstancedMesh; the `xform` field carries the per-body
// translation so InstancedGroup picks up unique positions.
//
// Why a sphere?
//   - It guarantees the LOD scheduler sees the full distance gamut
//     each frame: bodies behind the camera are frustum-culled, bodies
//     close to the camera (50 mm) get High, the rest fall to Med/Low.
//   - The Fibonacci spiral gives uniform angular density so any view
//     direction has roughly the same on-screen count → predictable
//     frame budget.
//
// Body shape: 4×4×4 mm cubes — the smallest visible footprint that
// still survives 1080p downsampling at 800 mm camera distance.
export function generate100k() {
  const total = 100000;
  const radius = 800;          // mm
  const out = new Array(total);
  // Fibonacci spiral on a unit sphere. ϕ = π · (3 − √5) is the golden
  // angle; for k=0..N−1, (y, θ) with y = 1 − 2k/(N−1) and
  // θ = ϕ · k gives a quasi-uniform sampling of S².
  const phi = Math.PI * (3 - Math.sqrt(5));
  // We push each layer onto a *shell-of-shells* — radius modulated by
  // a small jitter so the cloud has depth rather than a hollow sphere
  // look. Three concentric shells at 0.45R, 0.75R, 1.0R.
  const SHELLS = [0.45, 0.75, 1.0];
  for (let i = 0; i < total; i++) {
    const shellIdx = i % SHELLS.length;
    const r = radius * SHELLS[shellIdx];
    const k = Math.floor(i / SHELLS.length);
    const layerN = Math.ceil(total / SHELLS.length);
    const y = 1 - (2 * k) / Math.max(1, layerN - 1);
    const sinTheta = Math.sqrt(Math.max(0, 1 - y * y));
    const angle = phi * k;
    const x = Math.cos(angle) * sinTheta;
    const z = Math.sin(angle) * sinTheta;
    const px = r * x;
    const py = r * y;
    const pz = r * z;
    out[i] = {
      id: `stress-cloud-${i}`,
      kind: 'synthetic',
      // Use the same spec for every body so the instanceKey collapses.
      // The xform field carries the unique translation so InstancedGroup
      // produces 100k distinct world-space matrices off one geometry.
      spec: { kind: 'box', dx: 4, dy: 4, dz: 4 },
      xform: { x: px, y: py, z: pz },
      toolId: 'stress.cloud',
      params: {},
      instanceTag: 'cloud100k',
      name: 'Cloud',
    };
  }
  return out;
}

/* =====================================================================
 * Auto-register a window-level hook so the scenes are reachable from
 * DevTools and from the e2e spec without importing the module.
 *
 *   window.__forgeStressScene.bolts20k()
 *   window.__forgeStressScene.brackets5k()
 *   window.__forgeStressScene.mixed(25000)
 *   window.__forgeStressScene.cloud100k()
 *
 * The functions return body arrays — they don't push to the viewport
 * on their own. Use window.__forgeSetBodies (registered by
 * StressTestPanel) to actually swap in a scene.
 * ===================================================================== */

if (typeof window !== 'undefined') {
  window.__forgeStressScene = {
    bolts20k: generateBolts20k,
    brackets5k: generateBrackets5k,
    mixed: generateMixedScene,
    cloud100k: generate100k,
  };
}

export default {
  generateBolts20k, generateBrackets5k, generateMixedScene, generate100k,
};
