/**
 * ArchDisc Foundation — face-level self-intersection detection.
 *
 * Detects when the faces of ONE solid geometrically cross EACH OTHER — a
 * self-intersecting fillet, a degenerate sweep, an over-offset enclosure, a
 * badly-warped spline patch. This is the §3.6 "scanning highly warped spline
 * surfaces for crossings" capability. It does NOT need the unbound
 * BOPAlgo_CheckerSI / BOPAlgo_PaveFiller — it works directly on the body's
 * tessellation with a genuine computational-geometry algorithm.
 *
 * ── The algorithm ───────────────────────────────────────────────────────────
 * 1. The body arrives as a tessellation: triangle positions + a per-triangle
 *    face id (which B-rep face each triangle belongs to).
 * 2. A triangle-AABB BVH is built over every triangle (median split on the
 *    longest axis — the same top-down scheme as kernel/spatial/BVH.js, but on
 *    triangle AABBs instead of object AABBs).
 * 3. Every triangle is queried against the BVH; for each overlapping AABB pair
 *    we run a proper triangle-triangle intersection test — but ONLY between
 *    triangles whose faces are NON-ADJACENT. Triangles that share a face, or
 *    sit on two faces that share an edge, touch each other legitimately at
 *    that shared boundary; counting those would be a false positive. So a pair
 *    is tested only if faceId differs AND the two faces are not edge-adjacent
 *    (adjacency supplied by the caller, or inferred from shared tessellation
 *    vertices when an explicit adjacency set is not given).
 * 4. The triangle-triangle test is the Möller 1997 test ("A Fast Triangle-
 *    Triangle Intersection Test", Akenine-Möller, Journal of Graphics Tools
 *    2(2):25-30): reject when all vertices of one triangle lie strictly on one
 *    side of the other's plane; otherwise both triangles cross the line where
 *    the two planes meet — compute each triangle's parametric interval on that
 *    line and report an intersection iff the two intervals overlap. Coplanar
 *    triangles fall back to a 2-D edge/containment overlap test.
 *    When the test reports a hit it also returns the intersection SEGMENT (the
 *    overlap of the two intervals lifted back to 3-D) so the caller can render
 *    the exact crossing curve.
 *
 * ── Honest caveat ───────────────────────────────────────────────────────────
 * This is a TESSELLATION-RESOLUTION detector. It operates on the triangle mesh
 * produced at the kernel's tessellation deflection — a finer deflection finds
 * finer crossings. It is a genuine, exact triangle-triangle detector on the
 * mesh it is given; it is NOT an exact-analytic B-rep face/face intersector.
 * Crossings smaller than one triangle can be missed; conversely it never
 * reports a false crossing for a pair it does test.
 *
 * Kernel-free pure math — node-importable for e2e and AI introspection.
 *
 * Refs:
 *   T. Akenine-Möller, "A Fast Triangle-Triangle Intersection Test",
 *     Journal of Graphics Tools 2(2):25-30, 1997.
 *   kernel/spatial/BVH.js — the median-split BVH this mirrors.
 *   docs/superpowers/notes/p7-g1-purejs-G.md — references + honest caveats.
 */

const EPS = 1e-9;
// A crossing whose 3-D intersection segment is shorter than this (mm) is
// treated as a mere TOUCH (shared vertex / grazing contact), not a genuine
// penetration. Finer than any real self-intersection this op targets.
const TOUCH_EPS = 1e-3;

// ── tiny vec3 helpers (flat-array friendly) ─────────────────────────────────
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function addScaled(a, b, s) {
  return [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
}

// ════════════════════════════════════════════════════════════════════════════
// Möller triangle-triangle intersection test
// ════════════════════════════════════════════════════════════════════════════

/**
 * Parametric interval [t0,t1] of a triangle on the line where the two planes
 * meet. `dist` are the signed distances of the three vertices to the OTHER
 * triangle's plane (tiny values already snapped to exactly 0); `proj` are the
 * vertices projected onto the line's dominant axis.
 *
 * The triangle crosses the line wherever an edge straddles the plane (one
 * endpoint on each side) or wherever a vertex lies exactly on the plane. We
 * collect every such crossing parameter — there are always exactly two
 * distinct ones for a non-degenerate triangle that meets the line — and return
 * their sorted span. This formulation is robust to vertices lying ON the plane
 * (a case the classic "lone vertex" sign trick mishandles when a distance is
 * zero).
 *
 * @returns {[number,number]|null}  the sorted interval, or null if degenerate.
 */
function triInterval(proj, dist) {
  const hits = [];
  for (let k = 0; k < 3; k++) {
    const k2 = (k + 1) % 3;
    const da = dist[k], db = dist[k2];
    if (da === 0) {
      // Vertex k lies on the plane — it is itself a crossing point.
      hits.push(proj[k]);
    }
    // Edge (k → k2) straddles the plane: strictly opposite signs.
    if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
      const t = da / (da - db);
      hits.push(proj[k] + (proj[k2] - proj[k]) * t);
    }
  }
  if (hits.length < 2) return null;
  // De-duplicate near-equal hits (an on-plane vertex shared by two edges is
  // collected once per incident edge); keep the extremes.
  let lo = Infinity, hi = -Infinity;
  for (const h of hits) { if (h < lo) lo = h; if (h > hi) hi = h; }
  return [lo, hi];
}

/**
 * 2-D coplanar overlap: project both triangles onto the plane's dominant
 * 2-D axes and test for edge crossings / containment. Used only when the two
 * triangles are coplanar (Möller's degenerate branch).
 */
function coplanarOverlap(A, B, n) {
  // Choose the two axes to drop the largest |normal| component.
  const ax = Math.abs(n[0]), ay = Math.abs(n[1]), az = Math.abs(n[2]);
  let u = 0, v = 1;
  if (ax > ay && ax > az) { u = 1; v = 2; }
  else if (ay > az) { u = 0; v = 2; }
  const p = (t) => t.map((q) => [q[u], q[v]]);
  const a2 = p(A), b2 = p(B);
  const segCross = (p1, p2, p3, p4) => {
    const d = (o, a, b) =>
      (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
    const d1 = d(p3, p4, p1), d2 = d(p3, p4, p2);
    const d3 = d(p1, p2, p3), d4 = d(p1, p2, p4);
    return ((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0));
  };
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      if (segCross(a2[i], a2[(i + 1) % 3], b2[j], b2[(j + 1) % 3])) return true;
    }
  }
  // Containment: a vertex of one triangle inside the other.
  const inside = (q, tri) => {
    const sign = (o, a, b) =>
      (a[0] - o[0]) * (q[1] - o[1]) - (a[1] - o[1]) * (q[0] - o[0]);
    const s0 = sign(tri[0], tri[1]);
    const s1 = sign(tri[1], tri[2]);
    const s2 = sign(tri[2], tri[0]);
    return (s0 >= 0 && s1 >= 0 && s2 >= 0) || (s0 <= 0 && s1 <= 0 && s2 <= 0);
  };
  if (inside(a2[0], b2) || inside(b2[0], a2)) return true;
  return false;
}

/**
 * Möller 1997 triangle-triangle intersection test.
 *
 * @param {number[][]} A  triangle A as [[x,y,z],[x,y,z],[x,y,z]]
 * @param {number[][]} B  triangle B
 * @returns {{hit:boolean, segment?:[number[],number[]], coplanar?:boolean}}
 *   `segment` (when hit and non-coplanar) is the [p,q] crossing segment in 3-D.
 */
export function triTriIntersect(A, B) {
  // ── 1. Plane of B; signed distances of A's vertices to it. ────────────────
  const nB = cross(sub(B[1], B[0]), sub(B[2], B[0]));
  const dB = -dot(nB, B[0]);
  const distA = [
    dot(nB, A[0]) + dB,
    dot(nB, A[1]) + dB,
    dot(nB, A[2]) + dB,
  ];
  // Snap tiny distances to exactly 0 so coplanar / on-plane vertices are
  // handled by the dedicated branches, not as spurious sign changes.
  for (let i = 0; i < 3; i++) if (Math.abs(distA[i]) < EPS) distA[i] = 0;
  // All of A strictly on one side of B's plane → no intersection.
  if ((distA[0] > 0 && distA[1] > 0 && distA[2] > 0) ||
      (distA[0] < 0 && distA[1] < 0 && distA[2] < 0)) {
    return { hit: false };
  }

  // ── 2. Plane of A; signed distances of B's vertices to it. ────────────────
  const nA = cross(sub(A[1], A[0]), sub(A[2], A[0]));
  const dA = -dot(nA, A[0]);
  const distB = [
    dot(nA, B[0]) + dA,
    dot(nA, B[1]) + dA,
    dot(nA, B[2]) + dA,
  ];
  for (let i = 0; i < 3; i++) if (Math.abs(distB[i]) < EPS) distB[i] = 0;
  if ((distB[0] > 0 && distB[1] > 0 && distB[2] > 0) ||
      (distB[0] < 0 && distB[1] < 0 && distB[2] < 0)) {
    return { hit: false };
  }

  // ── 3. Coplanar case (both triangles in the same plane). ──────────────────
  const coplanar = distA[0] === 0 && distA[1] === 0 && distA[2] === 0;
  if (coplanar) {
    const lenNA = Math.hypot(nA[0], nA[1], nA[2]);
    if (lenNA < EPS) return { hit: false }; // degenerate A
    return { hit: coplanarOverlap(A, B, nA), coplanar: true };
  }

  // ── 4. Direction of the line where the two planes meet. ───────────────────
  const D = cross(nA, nB);
  // Project the triangle vertices onto the dominant axis of D (Möller's
  // simplification — projecting onto D itself and onto its largest component
  // give the same interval ordering).
  const adx = Math.abs(D[0]), ady = Math.abs(D[1]), adz = Math.abs(D[2]);
  let axis = 0;
  if (ady > adx && ady > adz) axis = 1;
  else if (adz > adx) axis = 2;
  const projA = [A[0][axis], A[1][axis], A[2][axis]];
  const projB = [B[0][axis], B[1][axis], B[2][axis]];

  // ── 5. Parametric interval of each triangle on the line. ──────────────────
  const intA = triInterval(projA, distA);
  const intB = triInterval(projB, distB);
  if (!intA || !intB) return { hit: false };

  // ── 6. 1-D interval overlap test. ─────────────────────────────────────────
  const lo = Math.max(intA[0], intB[0]);
  const hi = Math.min(intA[1], intB[1]);
  if (lo > hi + EPS) return { hit: false };

  // ── 7. Lift the overlap interval back to a 3-D segment. ───────────────────
  // The line of intersection passes through a point common to both planes;
  // recover it, then walk along D scaled so the `axis` component matches the
  // interval parameters.
  const linePoint = planeIntersectionPoint(nA, dA, nB, dB, D);
  let segment;
  if (linePoint && Math.abs(D[axis]) > EPS) {
    const param = (t) => (t - linePoint[axis]) / D[axis];
    segment = [
      addScaled(linePoint, D, param(lo)),
      addScaled(linePoint, D, param(hi)),
    ];
  }
  return { hit: true, segment, coplanar: false };
}

/**
 * A point lying on the line where planes (nA,dA) and (nB,dB) meet — the
 * standard three-plane intersection with the third plane through the origin
 * normal to D. nA·x = -dA, nB·x = -dB, D·x = 0.
 */
function planeIntersectionPoint(nA, dA, nB, dB, D) {
  // Solve the 3×3 system [nA;nB;D] x = [-dA;-dB;0] by Cramer's rule.
  const m = [nA, nB, D];
  const rhs = [-dA, -dB, 0];
  const det =
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
  if (Math.abs(det) < EPS) return null;
  const col = (c) => [
    [c === 0 ? rhs[0] : m[0][0], c === 1 ? rhs[0] : m[0][1], c === 2 ? rhs[0] : m[0][2]],
    [c === 0 ? rhs[1] : m[1][0], c === 1 ? rhs[1] : m[1][1], c === 2 ? rhs[1] : m[1][2]],
    [c === 0 ? rhs[2] : m[2][0], c === 1 ? rhs[2] : m[2][1], c === 2 ? rhs[2] : m[2][2]],
  ];
  const det3 = (a) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) -
    a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) +
    a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  return [det3(col(0)) / det, det3(col(1)) / det, det3(col(2)) / det];
}

// ════════════════════════════════════════════════════════════════════════════
// Triangle-AABB BVH (median split on the longest axis)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Build a BVH over an array of triangle AABBs. Each leaf holds up to
 * MAX_LEAF triangle indices. Mirrors kernel/spatial/BVH.js: top-down,
 * longest-axis split at the centroid median.
 */
const MAX_LEAF = 6;
const MAX_DEPTH = 28;

function buildTriBVH(boxes) {
  const items = boxes.map((b, i) => ({
    i,
    min: b.min,
    max: b.max,
    cx: (b.min[0] + b.max[0]) * 0.5,
    cy: (b.min[1] + b.max[1]) * 0.5,
    cz: (b.min[2] + b.max[2]) * 0.5,
  }));
  const buildNode = (subset, depth) => {
    const node = {
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
      left: null, right: null, tris: null,
    };
    for (const it of subset) {
      for (let a = 0; a < 3; a++) {
        if (it.min[a] < node.min[a]) node.min[a] = it.min[a];
        if (it.max[a] > node.max[a]) node.max[a] = it.max[a];
      }
    }
    if (subset.length <= MAX_LEAF || depth >= MAX_DEPTH) {
      node.tris = subset.map((it) => it.i);
      return node;
    }
    const size = [
      node.max[0] - node.min[0],
      node.max[1] - node.min[1],
      node.max[2] - node.min[2],
    ];
    let axis = 0;
    if (size[1] > size[0] && size[1] > size[2]) axis = 1;
    else if (size[2] > size[0]) axis = 2;
    const key = axis === 0 ? 'cx' : axis === 1 ? 'cy' : 'cz';
    subset.sort((p, q) => p[key] - q[key]);
    const mid = subset.length >> 1;
    const L = subset.slice(0, mid);
    const R = subset.slice(mid);
    if (L.length === 0 || R.length === 0) {
      node.tris = subset.map((it) => it.i);
      return node;
    }
    node.left = buildNode(L, depth + 1);
    node.right = buildNode(R, depth + 1);
    return node;
  };
  return items.length ? buildNode(items, 0) : null;
}

/** AABB overlap test. */
function boxOverlap(amn, amx, bmn, bmx) {
  return amn[0] <= bmx[0] && amx[0] >= bmn[0] &&
         amn[1] <= bmx[1] && amx[1] >= bmn[1] &&
         amn[2] <= bmx[2] && amx[2] >= bmn[2];
}

/** Collect every triangle index whose AABB overlaps the query box. */
function bvhQuery(node, qmn, qmx, out) {
  if (!node) return;
  if (!boxOverlap(node.min, node.max, qmn, qmx)) return;
  if (node.tris) {
    for (const t of node.tris) out.push(t);
    return;
  }
  bvhQuery(node.left, qmn, qmx, out);
  bvhQuery(node.right, qmn, qmx, out);
}

// ════════════════════════════════════════════════════════════════════════════
// Public — detectSelfIntersection
// ════════════════════════════════════════════════════════════════════════════

/**
 * Detect face-level self-intersection in a tessellated body.
 *
 * @param {object} mesh
 * @param {Float32Array|number[]} mesh.positions   flat [x,y,z,...] vertex array
 * @param {Uint32Array|number[]}  mesh.indices     flat triangle index array
 * @param {Int32Array|number[]}   mesh.faceIds     per-triangle B-rep face id
 *        (length = indices.length/3). Triangles with the same id belong to the
 *        same face. If omitted, every triangle is treated as its own face
 *        (so only geometrically separated faces are tested — still correct,
 *        just stricter about what counts as "non-adjacent").
 * @param {object} [opts]
 * @param {Array<[number,number]>} [opts.faceAdjacency]  pairs of face ids that
 *        share an edge (touch legitimately) — those pairs are skipped. When
 *        omitted, adjacency is inferred from shared tessellation vertices.
 * @param {number} [opts.maxPairs=200000]  safety cap on tested triangle pairs.
 * @returns {{
 *   intersecting:boolean,
 *   pairs:Array<[number,number]>,        intersecting triangle index pairs
 *   facePairs:Array<[number,number]>,    distinct intersecting face-id pairs
 *   segments:Array<[number[],number[]]>, 3-D crossing segments
 *   stats:{ triangles:number, faces:number, testedPairs:number,
 *           coplanarHits:number }
 * }}
 */
export function detectSelfIntersection(mesh, opts = {}) {
  const positions = mesh.positions;
  const indices = mesh.indices;
  const nTri = indices.length / 3;
  const maxPairs = opts.maxPairs || 200000;

  // Per-triangle face id (default: each triangle its own face).
  const faceIds = mesh.faceIds && mesh.faceIds.length === nTri
    ? mesh.faceIds
    : (() => { const a = new Int32Array(nTri); for (let i = 0; i < nTri; i++) a[i] = i; return a; })();

  // Triangle vertex fetch.
  const triVerts = (t) => {
    const a = indices[t * 3] * 3, b = indices[t * 3 + 1] * 3, c = indices[t * 3 + 2] * 3;
    return [
      [positions[a], positions[a + 1], positions[a + 2]],
      [positions[b], positions[b + 1], positions[b + 2]],
      [positions[c], positions[c + 1], positions[c + 2]],
    ];
  };

  // ── Per-triangle AABBs (with a tiny inflation so coincident faces are
  //    caught by the broad phase). ────────────────────────────────────────────
  const PAD = 1e-6;
  const boxes = new Array(nTri);
  for (let t = 0; t < nTri; t++) {
    const v = triVerts(t);
    const mn = [Infinity, Infinity, Infinity];
    const mx = [-Infinity, -Infinity, -Infinity];
    for (const p of v) {
      for (let a = 0; a < 3; a++) {
        if (p[a] < mn[a]) mn[a] = p[a];
        if (p[a] > mx[a]) mx[a] = p[a];
      }
    }
    boxes[t] = {
      min: [mn[0] - PAD, mn[1] - PAD, mn[2] - PAD],
      max: [mx[0] + PAD, mx[1] + PAD, mx[2] + PAD],
    };
  }

  // ── Face adjacency: which face-id pairs touch legitimately. ───────────────
  // Two complementary sources are UNIONED so an incomplete kernel adjacency
  // map can never leave a legitimate edge contact un-excluded:
  //   (a) the caller's explicit faceAdjacency (B-rep edge sharing), and
  //   (b) position-inferred adjacency — faces whose tessellations share an
  //       edge (≥ 2 coincident vertex positions). (b) always runs.
  const adjKey = (i, j) => (i < j ? `${i}|${j}` : `${j}|${i}`);
  const adjacent = new Set();
  if (Array.isArray(opts.faceAdjacency)) {
    for (const [i, j] of opts.faceAdjacency) {
      if (i !== j) adjacent.add(adjKey(i, j));
    }
  }
  {
    // Infer adjacency by POSITION, not vertex index — B-rep tessellation
    // (BRepMesh) duplicates vertices per face, so two faces meeting at a
    // shared edge or vertex have DIFFERENT vertex indices for geometrically
    // coincident points. We snap each vertex to a fine spatial-hash grid: two
    // faces that share even ONE coincident grid cell meet there LEGITIMATELY
    // (a shared B-rep edge OR a shared vertex / fillet-corner) — that is a
    // valid contact, not a crossing. Two genuinely CROSSING faces meet along
    // an interior line and, being independently tessellated, share NO
    // coincident vertices — so a ≥ 1 shared-cell rule excludes every
    // legitimate contact without ever hiding a real penetration.
    const SNAP = 1e-4; // mm — finer than any real crossing this op targets
    const inv = 1 / SNAP;
    const cellToFaces = new Map();
    for (let t = 0; t < nTri; t++) {
      const fid = faceIds[t];
      for (let k = 0; k < 3; k++) {
        const vi = indices[t * 3 + k] * 3;
        const hx = Math.round(positions[vi] * inv);
        const hy = Math.round(positions[vi + 1] * inv);
        const hz = Math.round(positions[vi + 2] * inv);
        const ck = `${hx},${hy},${hz}`;
        let s = cellToFaces.get(ck);
        if (!s) { s = new Set(); cellToFaces.set(ck, s); }
        s.add(fid);
      }
    }
    for (const faces of cellToFaces.values()) {
      if (faces.size < 2) continue;
      const arr = [...faces];
      for (let i = 0; i < arr.length; i++) {
        for (let j = i + 1; j < arr.length; j++) {
          adjacent.add(adjKey(arr[i], arr[j]));
        }
      }
    }
  }

  // ── BVH broad phase + Möller narrow phase. ────────────────────────────────
  const root = buildTriBVH(boxes);
  const pairs = [];
  const segments = [];
  const facePairSet = new Set();
  const facePairs = [];
  let testedPairs = 0;
  let coplanarHits = 0;
  const seenPair = new Set();

  outer:
  for (let t = 0; t < nTri; t++) {
    const fidT = faceIds[t];
    const cand = [];
    bvhQuery(root, boxes[t].min, boxes[t].max, cand);
    const A = triVerts(t);
    for (const u of cand) {
      if (u <= t) continue;                 // unordered pair, test once
      const fidU = faceIds[u];
      if (fidT === fidU) continue;          // same face — legitimate
      if (adjacent.has(adjKey(fidT, fidU))) continue; // edge-adjacent faces
      const pk = t * nTri + u;
      if (seenPair.has(pk)) continue;
      seenPair.add(pk);
      testedPairs++;
      if (testedPairs > maxPairs) break outer; // safety cap
      const B = triVerts(u);
      const res = triTriIntersect(A, B);
      if (res.hit) {
        // Reject a mere TOUCH (shared vertex / collinear edge contact between
        // two faces the adjacency pass did not pair): a genuine crossing
        // produces an intersection segment of real length; an edge/vertex
        // touch produces a degenerate (near-zero) segment. This keeps the
        // detector from flagging legitimate face contacts as crossings while
        // still catching every real penetration. Coplanar overlaps have no
        // segment and are kept (a coplanar face overlap IS a real defect).
        if (!res.coplanar) {
          if (!res.segment) continue;
          const seg = res.segment;
          const segLen = Math.hypot(
            seg[1][0] - seg[0][0], seg[1][1] - seg[0][1], seg[1][2] - seg[0][2]);
          if (segLen < TOUCH_EPS) continue;
        }
        pairs.push([t, u]);
        if (res.coplanar) coplanarHits++;
        if (res.segment) segments.push(res.segment);
        const fk = adjKey(fidT, fidU);
        if (!facePairSet.has(fk)) {
          facePairSet.add(fk);
          facePairs.push(fidT < fidU ? [fidT, fidU] : [fidU, fidT]);
        }
      }
    }
  }

  // Distinct face count.
  const faceSet = new Set();
  for (let t = 0; t < nTri; t++) faceSet.add(faceIds[t]);

  return {
    intersecting: pairs.length > 0,
    pairs,
    facePairs,
    segments,
    stats: {
      triangles: nTri,
      faces: faceSet.size,
      testedPairs,
      coplanarHits,
    },
  };
}

/* ─────────────────────────────────────────────────────────────────────────────
 * SELF-TEST (run by uncommenting under `node`):
 *
 *   import { triTriIntersect, detectSelfIntersection } from './SelfIntersection.js';
 *
 *   // Two triangles that pierce each other (an X cross).
 *   const A = [[-1,0,0],[1,0,0],[0,2,0]];
 *   const B = [[0,1,-1],[0,1,1],[0,-1,0]];
 *   console.assert(triTriIntersect(A,B).hit === true, 'crossing pair must hit');
 *
 *   // Two parallel, separated triangles — must NOT hit.
 *   const C = [[-1,0,0],[1,0,0],[0,2,0]];
 *   const D = [[-1,0,5],[1,0,5],[0,2,5]];
 *   console.assert(triTriIntersect(C,D).hit === false, 'separated must miss');
 *
 *   // detectSelfIntersection over a 2-face mesh: face 0 (one tri) and
 *   // face 1 (one tri) crossing — non-adjacent → reported.
 *   const mesh = {
 *     positions: new Float32Array([
 *       -1,0,0, 1,0,0, 0,2,0,        // tri 0 (face 0)
 *       0,1,-1, 0,1,1, 0,-1,0,       // tri 1 (face 1)
 *     ]),
 *     indices: new Uint32Array([0,1,2, 3,4,5]),
 *     faceIds: new Int32Array([0,1]),
 *   };
 *   const r = detectSelfIntersection(mesh);
 *   console.assert(r.intersecting === true, 'mesh self-intersects');
 *   console.assert(r.facePairs.length === 1, 'one face pair');
 *   console.log('SelfIntersection self-test OK', r.stats);
 * ───────────────────────────────────────────────────────────────────────────── */
