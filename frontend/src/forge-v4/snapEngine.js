// Forge-117 — snap + grid placement engine.
//
// Pure JS, no kernel dependency. Operates on candidate snap targets in
// world-space (provided by callers — sketcher, place-part, dimension,
// balloon tools) plus a screen-projected grid. Returns the nearest snap
// within `screenDistPx` (default 8 px) along with the kind so the
// indicator can pick the correct glyph.
//
// State is held on `window.__forgeSnap` so any consumer can read/write
// the current toggles without depending on a React context. Persisted
// to localStorage under `forge.v4.snap`.

export const SNAP_MODES = [
  'vertex',
  'edgeMid',
  'faceCenter',
  'grid',
  'origin',
  'perpendicular',
  'tangent',
];

const STORAGE_KEY = 'forge.v4.snap';
const DEFAULT_STATE = {
  enabled: true,
  modes: new Set(['vertex', 'edgeMid', 'faceCenter', 'grid', 'origin']),
  gridSize: 5,
  // Indicator coordinates the active SnapIndicator renders from.
  active: null,        // { kind, world:[x,y,z], screen:{x,y} } | null
  // Bumped whenever state changes so React listeners can re-render.
  rev: 0,
};

function getGlobal() {
  if (typeof window === 'undefined') return null;
  if (!window.__forgeSnap) window.__forgeSnap = { ...DEFAULT_STATE,
                                                  modes: new Set(DEFAULT_STATE.modes) };
  return window.__forgeSnap;
}

function persist(state) {
  if (typeof window === 'undefined') return;
  try {
    const json = JSON.stringify({
      enabled: state.enabled,
      modes: Array.from(state.modes),
      gridSize: state.gridSize,
    });
    window.localStorage.setItem(STORAGE_KEY, json);
  } catch (_) { /* private mode etc. */ }
}

function hydrate() {
  if (typeof window === 'undefined') return;
  const g = getGlobal();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const obj = JSON.parse(raw);
    if (typeof obj.enabled === 'boolean') g.enabled = obj.enabled;
    if (Array.isArray(obj.modes)) g.modes = new Set(obj.modes.filter(m => SNAP_MODES.includes(m)));
    if (Number.isFinite(obj.gridSize) && obj.gridSize > 0) g.gridSize = obj.gridSize;
  } catch (_) { /* corrupt entry */ }
}
hydrate();

function notify(state) {
  state.rev = (state.rev | 0) + 1;
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
    try { window.dispatchEvent(new CustomEvent('forge-snap-change', { detail: { rev: state.rev } })); }
    catch (_) { /* swallow */ }
  }
}

export function getSnapState() {
  return getGlobal();
}

export function setSnapState(patch = {}) {
  const g = getGlobal();
  if (!g) return null;
  if (typeof patch.enabled === 'boolean') g.enabled = patch.enabled;
  if (patch.modes instanceof Set) g.modes = new Set(patch.modes);
  else if (Array.isArray(patch.modes)) g.modes = new Set(patch.modes.filter(m => SNAP_MODES.includes(m)));
  if (Number.isFinite(patch.gridSize) && patch.gridSize > 0) g.gridSize = patch.gridSize;
  if (patch.active === null || (patch.active && typeof patch.active === 'object')) {
    g.active = patch.active;
  }
  persist(g);
  notify(g);
  return g;
}

export function toggleSnapMode(mode) {
  const g = getGlobal();
  if (!g || !SNAP_MODES.includes(mode)) return g;
  const next = new Set(g.modes);
  if (next.has(mode)) next.delete(mode);
  else next.add(mode);
  return setSnapState({ modes: next });
}

// ── Projection helpers ────────────────────────────────────────────────
// Convert world-space [x,y,z] to screen pixel coordinates relative to
// the renderer canvas. Returns null if behind the camera.
function worldToScreen(world, camera, renderer) {
  if (!world || !camera) return null;
  const x = world[0] ?? world.x ?? 0;
  const y = world[1] ?? world.y ?? 0;
  const z = world[2] ?? world.z ?? 0;
  // Replicate THREE.Vector3.project() math by hand so we don't import THREE.
  // Project into NDC then through the renderer size.
  if (camera && camera.matrixWorldInverse && camera.projectionMatrix && typeof camera.matrixWorldInverse.elements !== 'undefined') {
    const m = mulMat4(camera.projectionMatrix.elements, camera.matrixWorldInverse.elements);
    const w = m[3] * x + m[7] * y + m[11] * z + m[15];
    if (w === 0) return null;
    const ndcX = (m[0] * x + m[4] * y + m[8]  * z + m[12]) / w;
    const ndcY = (m[1] * x + m[5] * y + m[9]  * z + m[13]) / w;
    const ndcZ = (m[2] * x + m[6] * y + m[10] * z + m[14]) / w;
    if (ndcZ < -1 || ndcZ > 1) return null;
    const size = getRendererSize(renderer);
    return {
      x: (ndcX * 0.5 + 0.5) * size.width,
      y: (-ndcY * 0.5 + 0.5) * size.height,
    };
  }
  return null;
}

function getRendererSize(renderer) {
  if (renderer) {
    if (typeof renderer.getSize === 'function') {
      const v = renderer.getSize({ x: 0, y: 0 });
      if (v && Number.isFinite(v.width) && Number.isFinite(v.height)) return { width: v.width, height: v.height };
      if (v && Number.isFinite(v.x) && Number.isFinite(v.y)) return { width: v.x, height: v.y };
    }
    if (renderer.domElement && renderer.domElement.clientWidth) {
      return { width: renderer.domElement.clientWidth, height: renderer.domElement.clientHeight };
    }
  }
  if (typeof window !== 'undefined') return { width: window.innerWidth, height: window.innerHeight };
  return { width: 1, height: 1 };
}

function mulMat4(a, b) {
  // 4×4 column-major multiplication: out = a * b
  const out = new Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[c * 4 + r] = a[r] * b[c * 4]
                     + a[r + 4]  * b[c * 4 + 1]
                     + a[r + 8]  * b[c * 4 + 2]
                     + a[r + 12] * b[c * 4 + 3];
    }
  }
  return out;
}

// Distance in pixels between two screen points.
function dist2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// Snap to the nearest world-space grid intersection inside the active
// sketch plane. By default we assume XY world plane (z=0); callers may
// supply a `plane` candidate with `kind:'plane'` and `point`+`normal`
// to override.
function snapToGrid({ ray, screenPos, gridSize, plane, camera, renderer }) {
  // If we have a ray (mouse picking) we intersect with the active plane.
  // Otherwise we fall back to projecting through the screen point.
  const planePoint  = plane?.point  ?? [0, 0, 0];
  const planeNormal = plane?.normal ?? [0, 0, 1];
  let world = null;
  if (ray && Array.isArray(ray.origin) && Array.isArray(ray.direction)) {
    const denom = ray.direction[0] * planeNormal[0]
                + ray.direction[1] * planeNormal[1]
                + ray.direction[2] * planeNormal[2];
    if (Math.abs(denom) > 1e-6) {
      const ox = planePoint[0] - ray.origin[0];
      const oy = planePoint[1] - ray.origin[1];
      const oz = planePoint[2] - ray.origin[2];
      const t = (ox * planeNormal[0] + oy * planeNormal[1] + oz * planeNormal[2]) / denom;
      if (t >= 0) {
        world = [
          ray.origin[0] + ray.direction[0] * t,
          ray.origin[1] + ray.direction[1] * t,
          ray.origin[2] + ray.direction[2] * t,
        ];
      }
    }
  }
  if (!world) return null;
  // Quantise to grid in the local plane frame. For axis-aligned XY/XZ/YZ
  // planes (the common sketcher case) we can just round per axis.
  const snapped = world.map((v, i) => {
    // Don't quantise components along the normal direction.
    if (Math.abs(planeNormal[i]) > 0.99) return v;
    return Math.round(v / gridSize) * gridSize;
  });
  const screen = worldToScreen(snapped, camera, renderer);
  if (!screen) return null;
  return { kind: 'grid', world: snapped, screen };
}

/**
 * Find the nearest snap target within `screenDistPx` of the cursor.
 *
 * @param {Object} args
 * @param {{origin:number[],direction:number[]}} [args.ray] picking ray
 * @param {{x:number,y:number}} args.screenPos cursor in canvas px
 * @param {Array<{kind:string,world:number[],meta?:any}>} [args.candidates]
 *   world-space targets to score (vertices, edge midpoints, etc.)
 * @param {number} [args.gridSize]
 * @param {number} [args.screenDistPx=8]
 * @param {*} args.camera THREE camera (or duck-typed { projectionMatrix, matrixWorldInverse })
 * @param {*} [args.renderer] THREE WebGLRenderer (for canvas size)
 * @returns {null|{kind:string, world:number[], screenPos:{x:number,y:number}, distancePx:number}}
 */
export function findSnap({ ray, screenPos, candidates = [], gridSize, screenDistPx = 8,
                           camera, renderer, plane } = {}) {
  const state = getSnapState();
  if (!state || !state.enabled) return null;
  if (!screenPos || !camera) return null;
  const cutoff = Math.max(1, screenDistPx);
  const modes = state.modes;
  const effectiveGrid = Number.isFinite(gridSize) && gridSize > 0 ? gridSize : state.gridSize;

  let best = null;

  // 1. World-space candidates supplied by the caller.
  for (const c of candidates) {
    if (!c || !modes.has(c.kind)) continue;
    const screen = worldToScreen(c.world, camera, renderer);
    if (!screen) continue;
    const d = dist2D(screen, screenPos);
    if (d > cutoff) continue;
    if (!best || d < best.distancePx) {
      best = { kind: c.kind, world: c.world.slice(0, 3), screenPos: screen, distancePx: d, meta: c.meta };
    }
  }

  // 2. Implicit origin snap.
  if (modes.has('origin')) {
    const screen = worldToScreen([0, 0, 0], camera, renderer);
    if (screen) {
      const d = dist2D(screen, screenPos);
      if (d <= cutoff && (!best || d < best.distancePx)) {
        best = { kind: 'origin', world: [0, 0, 0], screenPos: screen, distancePx: d };
      }
    }
  }

  // 3. Grid snap — only fires if no closer geometric snap won. The grid
  //    is the lowest-priority snap so vertices etc. always beat it.
  if (modes.has('grid') && !best) {
    const g = snapToGrid({ ray, screenPos, gridSize: effectiveGrid, plane, camera, renderer });
    if (g) {
      const d = dist2D(g.screen, screenPos);
      // Grid is always considered "in range" because it's continuous,
      // but we still report the distance for the indicator.
      best = { kind: 'grid', world: g.world, screenPos: g.screen, distancePx: d };
    }
  }

  // Publish the active snap so SnapIndicator can render it.
  setSnapState({ active: best ? { kind: best.kind, world: best.world, screen: best.screenPos } : null });
  return best;
}

// Expose a tiny manual hook for tests/debug.
if (typeof window !== 'undefined') {
  window.__forgeSnapApi = { SNAP_MODES, getSnapState, setSnapState, toggleSnapMode, findSnap };
}
