/**
 * VoronoiPanel — irregular cellular-pattern panel via 2D Voronoi
 * tessellation. Generative-design firms (nTopology, Autodesk Generative
 * Design, Frustum) ship Voronoi infills as the natural-looking
 * counterpart to regular hex honeycomb (SP-38). Each cell is the
 * convex region of all points closer to its seed than to any other.
 * Visually like a sea sponge, an aerogel slice, or basalt columns.
 *
 * Pipeline (all pure-math, no kernel imports):
 *   1. Poisson-disk seed sampling on the W × H rectangle so cells are
 *      well-spaced and roughly equal-sized (no clusters of tiny cells).
 *   2. For each seed, compute its Voronoi cell as a convex polygon by
 *      iteratively clipping the panel rectangle with the half-plane
 *      "closer to this seed than seed j" for every other seed j
 *      (Sutherland–Hodgman convex clipping).
 *   3. Inset each cell by `wallT / 2` so the wall network appears
 *      between adjacent cells with the requested thickness.
 *
 * The handler subtracts the inset cells from the panel slab via the
 * usual Manifold boolean, so cell boundaries that meet the panel rim
 * are clipped naturally (matching real panel terminations).
 *
 * Determinism: a 32-bit Mulberry-style PRNG seeded by the caller so
 * the same `seed` always gives the same layout — important for
 * regression tests.
 */

const EPS = 1e-9;

/** Deterministic 32-bit PRNG (Mulberry32) — same input seed → same stream. */
export function makeRng(seed) {
  let s = (seed | 0) || 0x9e3779b9;
  return function rng() {
    s = (s + 0x6d2b79f5) | 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Poisson-disk-like seed sampler ("Bridson's algorithm" simplified).
 * Returns seeds inside [-W/2, W/2] × [-H/2, H/2] separated by ≥ minDist.
 * The "k" parameter is the per-active-seed attempt count; 30 is a
 * Bridson default that converges quickly.
 *
 * @param {number} W      panel width  (mm)
 * @param {number} H      panel height (mm)
 * @param {number} minDist minimum centre-to-centre distance (mm)
 * @param {number} seed   PRNG seed
 * @param {number=} k     samples per active point (default 30)
 */
export function poissonDiskSeeds(W, H, minDist, seed, k = 30) {
  const rng = makeRng(seed);
  const cell = minDist / Math.SQRT2;                          // grid cell side
  const cols = Math.max(1, Math.ceil(W / cell));
  const rows = Math.max(1, Math.ceil(H / cell));
  const grid = new Array(cols * rows).fill(-1);
  const pts = [], active = [];
  const idxAt = (cx, cy) => cy * cols + cx;
  const tryInsert = (x, y) => {
    const cx = Math.floor((x + W / 2) / cell);
    const cy = Math.floor((y + H / 2) / cell);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return false;
    // Reject if any nearby cell already has a seed within minDist.
    for (let i = Math.max(0, cx - 2); i <= Math.min(cols - 1, cx + 2); i++) {
      for (let j = Math.max(0, cy - 2); j <= Math.min(rows - 1, cy + 2); j++) {
        const k2 = grid[idxAt(i, j)];
        if (k2 === -1) continue;
        const dx = pts[k2][0] - x, dy = pts[k2][1] - y;
        if (dx * dx + dy * dy < minDist * minDist) return false;
      }
    }
    const id = pts.length;
    pts.push([x, y]);
    active.push(id);
    grid[idxAt(cx, cy)] = id;
    return true;
  };
  // Seed the algorithm with one random point inside the panel.
  tryInsert((rng() - 0.5) * W, (rng() - 0.5) * H);
  while (active.length) {
    const ai = Math.floor(rng() * active.length);
    const [x0, y0] = pts[active[ai]];
    let placed = false;
    for (let attempt = 0; attempt < k; attempt++) {
      const ang = rng() * 2 * Math.PI;
      const r = minDist * (1 + rng());                       // in [d, 2d]
      const x = x0 + r * Math.cos(ang), y = y0 + r * Math.sin(ang);
      if (tryInsert(x, y)) { placed = true; break; }
    }
    if (!placed) { active.splice(ai, 1); }
  }
  return pts;
}

/**
 * Clip a CCW convex polygon by one half-plane defined as
 *   { p | dot(p − origin, normal) ≥ 0 }
 * (so `normal` points INTO the half-plane to keep).
 *
 * Sutherland–Hodgman with 1 clipping plane per call.
 */
export function clipPolygonByHalfPlane(poly, origin, normal) {
  if (poly.length === 0) return poly;
  const out = [];
  const inside = (p) => (p[0] - origin[0]) * normal[0] + (p[1] - origin[1]) * normal[1] >= -EPS;
  const intersect = (a, b) => {
    // line a→b, plane through origin with `normal`. t = (origin − a)·n / (b − a)·n
    const dnx = (b[0] - a[0]) * normal[0] + (b[1] - a[1]) * normal[1];
    if (Math.abs(dnx) < EPS) return [...a];
    const t = ((origin[0] - a[0]) * normal[0] + (origin[1] - a[1]) * normal[1]) / dnx;
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  };
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const aIn = inside(a), bIn = inside(b);
    if (aIn && bIn) { out.push(b); }
    else if (aIn && !bIn) { out.push(intersect(a, b)); }
    else if (!aIn && bIn) { out.push(intersect(a, b)); out.push(b); }
    // else: both out — skip
  }
  return out;
}

/**
 * Compute the Voronoi cell polygon for `seeds[i]` by clipping the panel
 * rectangle with every "perpendicular bisector" half-plane between
 * seed i and every other seed. The kept half-plane is the one closer
 * to seed i. Returns a CCW convex polygon (possibly empty if the seed
 * is degenerate).
 */
export function voronoiCellPolygon(seeds, i, W, H) {
  const halfW = W / 2, halfH = H / 2;
  // Start with the panel rectangle CCW.
  let cell = [[-halfW, -halfH], [halfW, -halfH], [halfW, halfH], [-halfW, halfH]];
  const si = seeds[i];
  for (let j = 0; j < seeds.length; j++) {
    if (j === i || cell.length === 0) continue;
    const sj = seeds[j];
    // Bisector midpoint + normal pointing from sj → si (= toward "keep" side).
    const mx = (si[0] + sj[0]) / 2, my = (si[1] + sj[1]) / 2;
    const nx = si[0] - sj[0], ny = si[1] - sj[1];
    const n = Math.hypot(nx, ny);
    if (n < EPS) continue;
    cell = clipPolygonByHalfPlane(cell, [mx, my], [nx / n, ny / n]);
  }
  return cell;
}

/** Signed area (CCW positive) of a polygon. */
export function polygonSignedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i], [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/**
 * Inset a convex CCW polygon inward by `d` (mm). Each edge is offset
 * inward by `d`; vertices are the intersections of adjacent offset
 * lines. For sharp acute corners this can over-shoot, so we drop any
 * resulting polygon with non-positive signed area (degenerate cell).
 */
export function insetConvexPolygon(poly, d) {
  if (poly.length < 3 || d <= 0) return poly;
  const n = poly.length;
  // Per-edge outward normals (CCW polygon → inward normal is (-dy, dx) reversed).
  const insetLines = [];
  for (let i = 0; i < n; i++) {
    const a = poly[i], b = poly[(i + 1) % n];
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const len = Math.hypot(ex, ey);
    if (len < EPS) continue;
    // Inward normal for CCW polygon: rotate edge direction 90° CCW =
    // (-ey, ex) / len.  (90° CW = (ey, -ex) would point OUT.)
    const inx = -ey / len, iny = ex / len;
    insetLines.push({
      px: a[0] + inx * d, py: a[1] + iny * d,
      dx: ex / len, dy: ey / len,                              // direction along edge
    });
  }
  const out = [];
  const m = insetLines.length;
  for (let i = 0; i < m; i++) {
    const L1 = insetLines[i], L2 = insetLines[(i + 1) % m];
    // Intersect lines L1 and L2: solve (px1 + t·dx1, py1 + t·dy1) = (px2 + s·dx2, py2 + s·dy2)
    const denom = L1.dx * (-L2.dy) - L1.dy * (-L2.dx);
    if (Math.abs(denom) < EPS) continue;
    const dxp = L2.px - L1.px, dyp = L2.py - L1.py;
    const t = (dxp * (-L2.dy) - dyp * (-L2.dx)) / denom;
    out.push([L1.px + t * L1.dx, L1.py + t * L1.dy]);
  }
  return polygonSignedArea(out) > EPS ? out : [];
}
