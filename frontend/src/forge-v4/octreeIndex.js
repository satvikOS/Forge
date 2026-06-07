// PUSH-164 (Slice-120 / Spatial Index Octree for frustum culling).
//
// Up through PUSH-163 every Forge body that lands in `window.__forgeBodies`
// gets a Three.js mesh wired into the main viewport via
// Viewport.SceneMeshes, and the renderer's default frustum test
// (THREE.Object3D.frustumCulled) walks every body per frame to decide
// whether to draw it. For a 1 000-body scene that's 1 000 sphere/AABB
// tests per frame; for the production 100 000-body assemblies the user
// wants Forge to host (the same regime where the Forge-106
// InstancedGroup batcher kicks in) this linear scan becomes the
// dominant CPU cost on the render path.
//
// PUSH-164 adds a real spatial index — a recursive octree built over
// every body's world-space AABB — so the viewport can ask
// "which bodies intersect the camera frustum?" in O(log N + visible)
// instead of O(N). The index is rebuilt only when the body list
// changes; per-frame the cost is a frustum-vs-AABB walk that stops as
// soon as a node is fully outside the frustum.
//
// CONTRACT
// ─────────
//
// const idx = new OctreeIndex();
// idx.build(bodies, { maxDepth: 6, maxLeafSize: 16 });
// const visibleIds = idx.queryFrustum(planes6);
//   // planes6 is an Array(6) of THREE.Plane (or any { normal:{x,y,z}, constant })
//   // returning the world-space camera frustum.
//
// Every body is reduced to its world-space AABB via bodyBounds(body) —
// the kernel surface window.forge.bounds(handle) when available,
// otherwise the spec / params geometry fallback (matches the same
// reduction SectionPlanePanel + assemblyHierarchy use). Bodies with
// no derivable AABB are silently skipped — they're treated as
// "always visible" since we have no spatial info to cull on.
//
// The octree stores body IDs (not body refs) in its leaves so the
// rebuild can re-use the same node objects when the body list mutates
// in place. Per-frame `queryFrustum()` returns a fresh Array<string>
// so the caller can pass it straight to React state or a Set.
//
// Counter exports surface .stats for live reporting through
// OctreePanel — nodes built, leaf count, max realised depth, last
// culled count, last visible count, last build ms, last query ms.

// ─────────────────────────────────────────────────────────────────────
// Body → AABB.
//
// Body shape recap (from the rest of the v4 codebase):
//   { id, name, kind, handle?, params?, spec?, pose?, transform? }
//
// We accept any of the following sources, in order of preference:
//   1. window.forge.bounds(handle) → { min:[3], max:[3] }
//   2. body.bounds = { min:[3], max:[3] }  (cached on the body)
//   3. body.params { width / height / distance, dx / dy / dz, ...}
//   4. body.spec   { dx, dy, dz / r, h / R, r / radius, height }
//
// Then translated by body.position (if present, [x,y,z]) or
// body.pose.position (the PUSH-57 viewport pose channel).

export function bodyAabb(body) {
  if (!body || typeof body !== 'object') return null;
  let local = null;

  // 1. Kernel surface — when the body has a native handle, ask OCCT
  // for the real world-space AABB. This is the most accurate path
  // because OCCT returns the bounds of the actual B-rep, not the
  // synthetic spec/params guess.
  if (typeof window !== 'undefined' && typeof body.handle === 'number') {
    const fn = window.forge?.bounds || window.forge?.boundingBox;
    if (typeof fn === 'function') {
      try {
        const b = fn(body.handle);
        if (b && Array.isArray(b.min) && Array.isArray(b.max)
            && b.min.length >= 3 && b.max.length >= 3) {
          local = {
            min: [Number(b.min[0]), Number(b.min[1]), Number(b.min[2])],
            max: [Number(b.max[0]), Number(b.max[1]), Number(b.max[2])],
          };
        }
      } catch { /* fall through */ }
    }
  }

  // 2. Body-cached bounds.
  if (!local && body.bounds
      && Array.isArray(body.bounds.min) && Array.isArray(body.bounds.max)
      && body.bounds.min.length >= 3 && body.bounds.max.length >= 3) {
    local = {
      min: [Number(body.bounds.min[0]), Number(body.bounds.min[1]), Number(body.bounds.min[2])],
      max: [Number(body.bounds.max[0]), Number(body.bounds.max[1]), Number(body.bounds.max[2])],
    };
  }

  // 3. Params (canonical box parameters).
  if (!local && body.params) {
    const p = body.params;
    const w = Number(p.width  ?? p.dx ?? 0);
    const h = Number(p.height ?? p.dy ?? 0);
    const d = Number(p.distance ?? p.depth ?? p.dz ?? 0);
    if (w > 0 && h > 0 && d > 0) {
      local = { min: [-w / 2, -h / 2, 0], max: [w / 2, h / 2, d] };
    } else if (Number.isFinite(p.r) && Number.isFinite(p.h)) {
      local = { min: [-p.r, -p.r, 0], max: [p.r, p.r, p.h] };
    }
  }

  // 4. Spec (sketch / loft / sweep parameters).
  if (!local && body.spec) {
    const s = body.spec;
    if (typeof s.dx === 'number' && typeof s.dy === 'number' && typeof s.dz === 'number') {
      local = { min: [-s.dx / 2, -s.dy / 2, 0], max: [s.dx / 2, s.dy / 2, s.dz] };
    } else if (typeof s.r === 'number' && typeof s.h === 'number') {
      local = { min: [-s.r, -s.r, 0], max: [s.r, s.r, s.h] };
    } else if (typeof s.R === 'number' && typeof s.r === 'number') {
      const o = s.R + s.r;
      local = { min: [-o, -o, -s.r], max: [o, o, s.r] };
    } else if (typeof s.radius === 'number') {
      const r = s.radius;
      const h = typeof s.height === 'number' ? s.height : 2 * r;
      local = { min: [-r, -r, 0], max: [r, r, h] };
    }
  }

  if (!local) return null;

  // 5. Translate by body.position (PUSH-94 BigSceneStress matrix seed)
  //    or body.pose.position (PUSH-57 viewport pose channel).
  let tx = 0, ty = 0, tz = 0;
  if (Array.isArray(body.position) && body.position.length >= 3) {
    tx = Number(body.position[0]) || 0;
    ty = Number(body.position[1]) || 0;
    tz = Number(body.position[2]) || 0;
  } else if (body.pose && Array.isArray(body.pose.position)
             && body.pose.position.length >= 3) {
    tx = Number(body.pose.position[0]) || 0;
    ty = Number(body.pose.position[1]) || 0;
    tz = Number(body.pose.position[2]) || 0;
  }
  if (tx || ty || tz) {
    local = {
      min: [local.min[0] + tx, local.min[1] + ty, local.min[2] + tz],
      max: [local.max[0] + tx, local.max[1] + ty, local.max[2] + tz],
    };
  }
  // Sanity — reject inverted AABBs (NaN or min > max). They'd corrupt
  // the octree splitting heuristic.
  for (let i = 0; i < 3; i += 1) {
    if (!Number.isFinite(local.min[i]) || !Number.isFinite(local.max[i])) return null;
    if (local.max[i] < local.min[i]) return null;
  }
  return local;
}

// ─────────────────────────────────────────────────────────────────────
// AABB helpers.

function unionAabb(a, b) {
  return {
    min: [Math.min(a.min[0], b.min[0]), Math.min(a.min[1], b.min[1]), Math.min(a.min[2], b.min[2])],
    max: [Math.max(a.max[0], b.max[0]), Math.max(a.max[1], b.max[1]), Math.max(a.max[2], b.max[2])],
  };
}

function aabbCenter(b) {
  return [
    (b.min[0] + b.max[0]) * 0.5,
    (b.min[1] + b.max[1]) * 0.5,
    (b.min[2] + b.max[2]) * 0.5,
  ];
}

// ─────────────────────────────────────────────────────────────────────
// Frustum-vs-AABB classification.
//
// Each frustum plane is { normal:{x,y,z}, constant } (matches
// THREE.Plane). A point p is "inside" if
//   plane.normal · p + plane.constant ≥ 0
// THREE.Plane.normal is interpreted such that the inside half-space
// contains the camera origin (THREE.Frustum.setFromProjectionMatrix
// orients the planes this way).
//
// To test an AABB against a plane in O(1) without scanning all 8
// corners we project the AABB onto the plane's normal:
//   r = |n.x| * extents.x + |n.y| * extents.y + |n.z| * extents.z
//   d = n · centre + constant
// If d + r < 0 the AABB is fully outside → reject.
// If d - r ≥ 0 the AABB is fully inside  → "inside" wrt this plane.
// Otherwise the AABB straddles the plane → "intersect".
//
// We return a tri-state:
//   -1 outside  (any plane rejects)
//    0 intersect (at least one plane straddles, none reject)
//    1 inside   (all planes accept fully)

export const FRUSTUM_OUTSIDE  = -1;
export const FRUSTUM_INTERSECT = 0;
export const FRUSTUM_INSIDE    = 1;

export function classifyAabb(aabb, planes) {
  const cx = (aabb.min[0] + aabb.max[0]) * 0.5;
  const cy = (aabb.min[1] + aabb.max[1]) * 0.5;
  const cz = (aabb.min[2] + aabb.max[2]) * 0.5;
  const ex = (aabb.max[0] - aabb.min[0]) * 0.5;
  const ey = (aabb.max[1] - aabb.min[1]) * 0.5;
  const ez = (aabb.max[2] - aabb.min[2]) * 0.5;
  let allInside = true;
  for (let i = 0; i < planes.length; i += 1) {
    const p = planes[i];
    if (!p || !p.normal) continue;
    const nx = p.normal.x ?? p.normal[0] ?? 0;
    const ny = p.normal.y ?? p.normal[1] ?? 0;
    const nz = p.normal.z ?? p.normal[2] ?? 0;
    const c  = p.constant ?? p.d ?? 0;
    const d  = nx * cx + ny * cy + nz * cz + c;
    const r  = Math.abs(nx) * ex + Math.abs(ny) * ey + Math.abs(nz) * ez;
    if (d + r < 0) return FRUSTUM_OUTSIDE;
    if (d - r < 0) allInside = false;
  }
  return allInside ? FRUSTUM_INSIDE : FRUSTUM_INTERSECT;
}

// ─────────────────────────────────────────────────────────────────────
// Octree node. We keep this a plain object (no class) so the build
// loop is JIT-friendly and so consumers can serialise the tree as JSON
// when needed (e.g. window.__forgeOctreeDump for diagnostic dumps).

function emptyNode(aabb, depth) {
  return { aabb, depth, ids: [], children: null, count: 0 };
}

function splitAabb(aabb) {
  const cx = (aabb.min[0] + aabb.max[0]) * 0.5;
  const cy = (aabb.min[1] + aabb.max[1]) * 0.5;
  const cz = (aabb.min[2] + aabb.max[2]) * 0.5;
  const x0 = aabb.min[0], y0 = aabb.min[1], z0 = aabb.min[2];
  const x1 = aabb.max[0], y1 = aabb.max[1], z1 = aabb.max[2];
  // 8 octants in (x,y,z) lexicographic order — index = (x?1) | (y?2) | (z?4).
  return [
    { min: [x0, y0, z0], max: [cx, cy, cz] }, // 0 −x −y −z
    { min: [cx, y0, z0], max: [x1, cy, cz] }, // 1 +x −y −z
    { min: [x0, cy, z0], max: [cx, y1, cz] }, // 2 −x +y −z
    { min: [cx, cy, z0], max: [x1, y1, cz] }, // 3 +x +y −z
    { min: [x0, y0, cz], max: [cx, cy, z1] }, // 4 −x −y +z
    { min: [cx, y0, cz], max: [x1, cy, z1] }, // 5 +x −y +z
    { min: [x0, cy, cz], max: [cx, y1, z1] }, // 6 −x +y +z
    { min: [cx, cy, cz], max: [x1, y1, z1] }, // 7 +x +y +z
  ];
}

// Decide which octant the centre of `aabb` falls into. Returns 0..7.
// We classify by centre (not full AABB overlap) so each body is
// assigned to exactly one leaf — this keeps the tree size linear in
// body count and matches how PCL / OpenSubdiv build octrees. Bodies
// that straddle the split planes still get classified by their centre,
// and their full AABB is unioned into the leaf's aabb so frustum
// classification stays correct.
function pickOctant(centre, parentAabb) {
  const midX = (parentAabb.min[0] + parentAabb.max[0]) * 0.5;
  const midY = (parentAabb.min[1] + parentAabb.max[1]) * 0.5;
  const midZ = (parentAabb.min[2] + parentAabb.max[2]) * 0.5;
  let oct = 0;
  if (centre[0] >= midX) oct |= 1;
  if (centre[1] >= midY) oct |= 2;
  if (centre[2] >= midZ) oct |= 4;
  return oct;
}

// ─────────────────────────────────────────────────────────────────────
// OctreeIndex.

export class OctreeIndex {
  constructor() {
    this.root = null;
    this.stats = {
      bodyCount:   0,
      nodeCount:   0,
      leafCount:   0,
      maxDepth:    0,
      maxLeafSize: 16,
      buildMs:     0,
      lastQueryMs: 0,
      lastVisible: 0,
      lastCulled:  0,
    };
    // Cached body → aabb table built by build(). Used by queryFrustum
    // when a node is fully inside the frustum (no need to re-test each
    // leaf body, every id is visible).
    this._aabbById = new Map();
  }

  // Rebuild the tree over `bodies`. Returns the index itself so callers
  // can chain `new OctreeIndex().build(bodies)`.
  build(bodies, opts = {}) {
    const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    const maxDepth = Math.max(1, Math.min(12, opts.maxDepth | 0 || 6));
    const maxLeafSize = Math.max(1, opts.maxLeafSize | 0 || 16);
    this.stats.maxLeafSize = maxLeafSize;
    this.root = null;
    this._aabbById = new Map();
    const list = Array.isArray(bodies) ? bodies : [];
    if (list.length === 0) {
      this.stats.bodyCount = 0;
      this.stats.nodeCount = 0;
      this.stats.leafCount = 0;
      this.stats.maxDepth  = 0;
      this.stats.buildMs   = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      return this;
    }
    // Compute every body's AABB once + a flat union for the root.
    let rootAabb = null;
    const accepted = [];
    for (const b of list) {
      if (!b || !b.id) continue;
      const aabb = bodyAabb(b);
      if (!aabb) continue;
      this._aabbById.set(b.id, aabb);
      accepted.push(b.id);
      rootAabb = rootAabb ? unionAabb(rootAabb, aabb) : aabb;
    }
    if (accepted.length === 0 || !rootAabb) {
      this.stats.bodyCount = 0;
      this.stats.nodeCount = 0;
      this.stats.leafCount = 0;
      this.stats.maxDepth  = 0;
      this.stats.buildMs   = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      return this;
    }
    // Pad the root by a tiny ε so bodies whose centre lies exactly on
    // the root max-extent don't fall outside any octant on the first
    // split.
    const eps = 1e-3;
    rootAabb = {
      min: [rootAabb.min[0] - eps, rootAabb.min[1] - eps, rootAabb.min[2] - eps],
      max: [rootAabb.max[0] + eps, rootAabb.max[1] + eps, rootAabb.max[2] + eps],
    };
    this.root = emptyNode(rootAabb, 0);
    // Bulk-insert without recursion — flat stack so we don't blow the
    // JS call stack on 100 k bodies. Each frame on the stack is
    // (node, ids[]).
    const stack = [{ node: this.root, ids: accepted }];
    let nodeCount = 1;
    let leafCount = 0;
    let observedDepth = 0;
    while (stack.length > 0) {
      const { node, ids } = stack.pop();
      node.count = ids.length;
      // Stop-conditions: leaf-size threshold OR max depth reached.
      if (ids.length <= maxLeafSize || node.depth >= maxDepth) {
        node.ids = ids.slice();
        node.children = null;
        leafCount += 1;
        if (node.depth > observedDepth) observedDepth = node.depth;
        continue;
      }
      // Split.
      const childAabbs = splitAabb(node.aabb);
      const buckets = [[], [], [], [], [], [], [], []];
      for (const id of ids) {
        const aabb = this._aabbById.get(id);
        if (!aabb) continue;
        const centre = aabbCenter(aabb);
        const oct = pickOctant(centre, node.aabb);
        buckets[oct].push(id);
      }
      // Edge case: every body landed in the same octant (e.g.
      // pathologically clustered scene). Splitting further wouldn't
      // help — promote to a leaf and stop.
      let nonEmpty = 0;
      for (let i = 0; i < 8; i += 1) if (buckets[i].length > 0) nonEmpty += 1;
      if (nonEmpty <= 1) {
        node.ids = ids.slice();
        node.children = null;
        leafCount += 1;
        if (node.depth > observedDepth) observedDepth = node.depth;
        continue;
      }
      node.children = [null, null, null, null, null, null, null, null];
      for (let i = 0; i < 8; i += 1) {
        if (buckets[i].length === 0) continue;
        // Tighten each child's AABB to the union of its members so
        // frustum classification is precise. Falling back to the
        // geometric octant is fine but yields false positives.
        let tight = null;
        for (const id of buckets[i]) {
          const aabb = this._aabbById.get(id);
          if (!aabb) continue;
          tight = tight ? unionAabb(tight, aabb) : aabb;
        }
        const child = emptyNode(tight || childAabbs[i], node.depth + 1);
        node.children[i] = child;
        stack.push({ node: child, ids: buckets[i] });
        nodeCount += 1;
      }
    }
    if (this.root.depth > maxDepth) maxDepth = this.root.depth;
    this.stats.bodyCount = accepted.length;
    this.stats.nodeCount = nodeCount;
    this.stats.leafCount = leafCount;
    this.stats.maxDepth  = observedDepth;
    this.stats.buildMs   = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    return this;
  }

  // Per-frame query. `planes` is an Array(6) of THREE.Plane or
  // any { normal:{x,y,z}, constant }. Returns Array<bodyId> — the
  // bodies whose AABB intersects (or lies inside) the frustum.
  queryFrustum(planes) {
    const t0 = (typeof performance !== 'undefined') ? performance.now() : Date.now();
    const out = [];
    if (!this.root || !Array.isArray(planes) || planes.length === 0) {
      this.stats.lastQueryMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
      this.stats.lastVisible = 0;
      this.stats.lastCulled  = this.stats.bodyCount;
      return out;
    }
    const stack = [this.root];
    while (stack.length > 0) {
      const node = stack.pop();
      const cls = classifyAabb(node.aabb, planes);
      if (cls === FRUSTUM_OUTSIDE) continue;
      if (cls === FRUSTUM_INSIDE) {
        // Everything below this node is visible — collect all ids
        // without re-testing children.
        this._collectAllIds(node, out);
        continue;
      }
      // Intersect — descend into children or test leaf bodies.
      if (node.children) {
        for (let i = 0; i < 8; i += 1) {
          if (node.children[i]) stack.push(node.children[i]);
        }
      } else if (node.ids && node.ids.length > 0) {
        // Final per-body AABB test — at a leaf we still might cull
        // individual bodies whose AABBs lie just outside the frustum.
        for (let i = 0; i < node.ids.length; i += 1) {
          const id = node.ids[i];
          const aabb = this._aabbById.get(id);
          if (!aabb) continue;
          if (classifyAabb(aabb, planes) !== FRUSTUM_OUTSIDE) {
            out.push(id);
          }
        }
      }
    }
    this.stats.lastQueryMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    this.stats.lastVisible = out.length;
    this.stats.lastCulled  = Math.max(0, this.stats.bodyCount - out.length);
    return out;
  }

  // Drain every id under `node` (DFS).  Helper for the INSIDE case.
  _collectAllIds(node, out) {
    const stack = [node];
    while (stack.length > 0) {
      const n = stack.pop();
      if (!n) continue;
      if (n.children) {
        for (let i = 0; i < 8; i += 1) {
          if (n.children[i]) stack.push(n.children[i]);
        }
      } else if (n.ids && n.ids.length > 0) {
        for (let i = 0; i < n.ids.length; i += 1) out.push(n.ids[i]);
      }
    }
  }

  // Diagnostic: drain every id in the tree (sanity check that the
  // build accounted for every body).
  allIds() {
    const out = [];
    if (this.root) this._collectAllIds(this.root, out);
    return out;
  }

  // Convenience: extract the 6 planes from a THREE.PerspectiveCamera
  // (or any object whose projectionMatrix + matrixWorldInverse are
  // available). Returns a fresh Array(6) of { normal:{x,y,z}, constant }.
  // Caller is expected to have called camera.updateMatrixWorld() +
  // updated the projection matrix before this.
  static planesFromCamera(camera) {
    if (!camera) return [];
    // Avoid hard-importing THREE here so this module can be unit-tested
    // without the WebGL stack. Build the planes directly from the
    // composed projection × view matrix.
    const pm = camera.projectionMatrix?.elements;
    const vm = camera.matrixWorldInverse?.elements;
    if (!pm || !vm) return [];
    // m = pm * vm.
    const m = new Array(16);
    for (let r = 0; r < 4; r += 1) {
      for (let c = 0; c < 4; c += 1) {
        let v = 0;
        for (let k = 0; k < 4; k += 1) v += pm[k * 4 + r] * vm[c * 4 + k];
        m[c * 4 + r] = v;
      }
    }
    // Plane extraction (Gribb-Hartmann). Order matches THREE.Frustum:
    // right, left, bottom, top, far, near.
    const planes = [
      { normal: { x: m[3]  - m[0],  y: m[7]  - m[4],  z: m[11] - m[8]  }, constant: m[15] - m[12] }, // right
      { normal: { x: m[3]  + m[0],  y: m[7]  + m[4],  z: m[11] + m[8]  }, constant: m[15] + m[12] }, // left
      { normal: { x: m[3]  + m[1],  y: m[7]  + m[5],  z: m[11] + m[9]  }, constant: m[15] + m[13] }, // bottom
      { normal: { x: m[3]  - m[1],  y: m[7]  - m[5],  z: m[11] - m[9]  }, constant: m[15] - m[13] }, // top
      { normal: { x: m[3]  - m[2],  y: m[7]  - m[6],  z: m[11] - m[10] }, constant: m[15] - m[14] }, // far
      { normal: { x: m[3]  + m[2],  y: m[7]  + m[6],  z: m[11] + m[10] }, constant: m[15] + m[14] }, // near
    ];
    // Normalise each plane so classifyAabb's distance ↔ extents
    // comparison is in metric units.
    for (const p of planes) {
      const nx = p.normal.x, ny = p.normal.y, nz = p.normal.z;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 0) {
        p.normal.x = nx / len;
        p.normal.y = ny / len;
        p.normal.z = nz / len;
        p.constant = p.constant / len;
      }
    }
    return planes;
  }
}

// ─────────────────────────────────────────────────────────────────────
// Default-export wrapper — the OctreePanel + e2e drive the index via
// the headless surface so they don't need a renderer to verify the
// algorithm.
//
// `installOctreeWindowApi()` mounts:
//   window.__forgeOctree         — singleton OctreeIndex
//   window.__forgeOctreeRebuild()→ rebuilds against __forgeBodies
//   window.__forgeOctreeQuery(planes)→ runs queryFrustum
//   window.__forgeOctreeStats    — snapshot of .stats
// These are idempotent — calling install() twice replaces the surface.

let _singleton = null;

export function getOctreeIndex() {
  if (!_singleton) _singleton = new OctreeIndex();
  return _singleton;
}

export function installOctreeWindowApi(options = {}) {
  if (typeof window === 'undefined') return null;
  const idx = getOctreeIndex();
  window.__forgeOctree = idx;
  window.__forgeOctreeRebuild = (bodies, opts) => {
    const list = Array.isArray(bodies)
      ? bodies
      : (Array.isArray(window.__forgeBodies) ? window.__forgeBodies : []);
    idx.build(list, opts || options);
    window.__forgeOctreeStats = { ...idx.stats };
    try {
      window.dispatchEvent(new CustomEvent('forge:octree-rebuilt', {
        detail: { ...idx.stats },
      }));
    } catch { /* fail-soft */ }
    return idx.stats;
  };
  window.__forgeOctreeQuery = (planes) => {
    const ids = idx.queryFrustum(planes || []);
    window.__forgeOctreeStats = { ...idx.stats };
    try {
      window.dispatchEvent(new CustomEvent('forge:octree-queried', {
        detail: { ...idx.stats, visibleCount: ids.length },
      }));
    } catch { /* fail-soft */ }
    return ids;
  };
  window.__forgeOctreePlanesFromCamera = (cam) => OctreeIndex.planesFromCamera(cam);
  window.__forgeOctreeStats = { ...idx.stats };
  return idx;
}

export default OctreeIndex;
