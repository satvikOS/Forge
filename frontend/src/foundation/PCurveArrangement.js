/**
 * ArchDisc Foundation — Planar arrangement build from a set of pcurves in
 * a NURBS surface's (u,v) parameter space.
 *
 * This is the **hard middle piece** of the SP-12 auto-trimming NURBS B-rep
 * pipeline:
 *
 *   Pcurves projected from 3-D SSI curves intersect each other in (u,v)
 *   space — at the SSI intersections in 3-D plus at the original face
 *   boundary edges. To build a self-consistent trimmed face we must:
 *
 *     1. find every pairwise (u,v) intersection between the input pcurves;
 *     2. split each pcurve at its intersection points into "edges" of the
 *        arrangement;
 *     3. assemble the resulting planar subdivision and walk it to find
 *        oriented loops — the outer loop + zero or more inner (hole) loops
 *        of each enclosed face region.
 *
 * Without the planar arrangement step, naively concatenating pcurves yields
 * self-intersecting boundary loops that no kernel will accept. The arrangement
 * algorithm is what makes the pipeline self-consistent.
 *
 * ---
 * Algorithm — segment-arrangement on polyline pcurves
 * ---
 *
 * Input: an array of pcurve POLYLINES in (u,v) space. Each input pcurve is
 * either a face-boundary pcurve (closed loop in (u,v)) or an SSI-projected
 * pcurve (open path in (u,v) terminating at the face boundary OR closed loop
 * on the surface interior). Every input curve is supplied as a polyline —
 * the caller (BrepNurbsAutoTrim) tessellates B-spline pcurves to polylines
 * at a chosen tolerance before invoking buildArrangement.
 *
 * Steps:
 *   1. **Vertex coalescing** — every endpoint and every pairwise segment
 *      intersection becomes an arrangement VERTEX. Endpoints within `tol` of
 *      an existing vertex coalesce.
 *   2. **Edge construction** — each input polyline becomes a chain of
 *      arrangement EDGES (between consecutive arrangement vertices along
 *      the polyline). Pairwise segment-segment intersections inject extra
 *      vertices that split the polyline edges.
 *   3. **Twin-half-edge construction** — every arrangement edge spawns two
 *      directed HALF-EDGES, twins of each other, with `face` pointers
 *      assigned by the loop-walk in step 5.
 *   4. **Vertex incidence ordering** — at each vertex, the incident
 *      half-edges are sorted by their outgoing angle. `next(he)` = the
 *      half-edge AFTER the twin of `he` in clockwise rotation around `he`'s
 *      target vertex (the standard DCEL "next" in a planar embedding).
 *      This is what makes the loop-walk find the boundary of one face.
 *   5. **Face extraction by loop-walk** — starting at any unvisited
 *      half-edge, follow `next` until you cycle back. Each cycle is one
 *      face's boundary loop. The unbounded outer face has the only loop
 *      whose signed area is negative under the canonical orientation; the
 *      bounded faces have positive signed area.
 *   6. **Hole nesting** — for each bounded face, check which other bounded
 *      faces' representative points lie inside it. The minimal-area
 *      enclosing face becomes the outer loop's owner; the inner loops are
 *      its holes.
 *
 * The result is a list of `Face` records, each with one outer loop and
 * zero or more hole loops, each loop = ordered (u,v) polyline along the
 * arrangement half-edges.
 *
 * ---
 * Known scope (honest)
 * ---
 *
 * - **Polyline arrangement, not exact-arithmetic CGAL.** Pairwise segment
 *   intersection is O(n²); robust for tens to a few hundred segments which
 *   is the realistic count for a trimmed-face arrangement. A true exact
 *   Bentley-Ottmann + EPEC kernel would be needed for industrial-scale
 *   automotive class-A workflows.
 * - **Polyline representation of pcurves.** We tessellate B-spline pcurves
 *   to polylines for the arrangement; the trimmed loop's boundary is a
 *   polyline. A production kernel would carry both representations and
 *   re-fit B-splines to the arrangement edges; for SP-12's first delivery
 *   the polyline representation is the genuine arrangement output.
 * - **Two-dimensional only.** The arrangement lives in (u,v); the 3-D
 *   geometry is reconstructed by the caller (BrepNurbsAutoTrim) by pushing
 *   each polyline through the surface's `eval(u,v)`.
 *
 * Refs:
 *   de Berg, Cheong, van Kreveld, Overmars — "Computational Geometry:
 *     Algorithms and Applications" §2 (segment intersection) and §13
 *     (planar arrangements).
 *   Halperin, Sharir — "Arrangements" handbook chapter (the canonical
 *     reference for the DCEL representation used here).
 *
 * Pure-JS, kernel-free, node-importable for e2e.
 */

const EPS = 1e-12;

// ────────────────────────────────────────────────────────────────────────────
// Tiny 2-D vector helpers
// ────────────────────────────────────────────────────────────────────────────

const dist2 = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross2 = (ax, ay, bx, by) => ax * by - ay * bx;

// ────────────────────────────────────────────────────────────────────────────
// Segment-segment intersection in 2-D
// ────────────────────────────────────────────────────────────────────────────

/**
 * Find the intersection of two finite line segments p1->p2 and p3->p4 in 2-D.
 *
 * Returns:
 *   - null  if no intersection (parallel / disjoint)
 *   - { t, u, point } where t∈[0,1] is the param along p1->p2,
 *                                u∈[0,1] is the param along p3->p4,
 *                          point = p1 + t·(p2-p1).
 *
 * Endpoint touches (t∈{0,1} or u∈{0,1}) ARE returned — caller filters by
 * `tol` to avoid double-counting shared endpoints across polylines.
 *
 * @param {[number,number]} p1
 * @param {[number,number]} p2
 * @param {[number,number]} p3
 * @param {[number,number]} p4
 */
export function segmentIntersection(p1, p2, p3, p4) {
  const r = [p2[0] - p1[0], p2[1] - p1[1]];
  const s = [p4[0] - p3[0], p4[1] - p3[1]];
  const denom = cross2(r[0], r[1], s[0], s[1]);
  if (Math.abs(denom) < EPS) return null; // parallel or collinear
  const qp = [p3[0] - p1[0], p3[1] - p1[1]];
  const t = cross2(qp[0], qp[1], s[0], s[1]) / denom;
  const u = cross2(qp[0], qp[1], r[0], r[1]) / denom;
  if (t < -EPS || t > 1 + EPS) return null;
  if (u < -EPS || u > 1 + EPS) return null;
  return {
    t: Math.min(1, Math.max(0, t)),
    u: Math.min(1, Math.max(0, u)),
    point: [p1[0] + t * r[0], p1[1] + t * r[1]],
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Vertex coalescing — a simple grid hash for O(1) lookup of near-duplicates
// ────────────────────────────────────────────────────────────────────────────

/**
 * Vertex store — coalesces 2-D points within `tol` into a single vertex
 * record keyed by an integer index. Uses a hash grid keyed at 4× tol so any
 * two points within `tol` share at least one cell.
 */
class VertexStore {
  constructor(tol = 1e-6) {
    this.tol = tol;
    this.cellSize = Math.max(tol * 4, 1e-9);
    this.grid = new Map();
    this.points = [];   // index → [u,v]
    this.outgoing = []; // index → array of half-edge ids (filled in step 4)
  }

  _key(p) {
    const ix = Math.round(p[0] / this.cellSize);
    const iy = Math.round(p[1] / this.cellSize);
    return `${ix}:${iy}`;
  }

  /**
   * Add a point, returning its vertex index. If within `tol` of an existing
   * vertex, returns that vertex's index — the point is coalesced.
   */
  add(p) {
    const k = this._key(p);
    // Check this cell + 8 neighbours for a near-duplicate.
    const ix = Math.round(p[0] / this.cellSize);
    const iy = Math.round(p[1] / this.cellSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const nk = `${ix + dx}:${iy + dy}`;
        const bucket = this.grid.get(nk);
        if (!bucket) continue;
        for (const idx of bucket) {
          if (dist2(this.points[idx], p) <= this.tol) return idx;
        }
      }
    }
    const idx = this.points.length;
    this.points.push([p[0], p[1]]);
    this.outgoing.push([]);
    let bucket = this.grid.get(k);
    if (!bucket) { bucket = []; this.grid.set(k, bucket); }
    bucket.push(idx);
    return idx;
  }

  point(i) { return this.points[i]; }
  count() { return this.points.length; }
}

// ────────────────────────────────────────────────────────────────────────────
// Polyline pre-processing — chop each input polyline at all intersections
// with every other input polyline, AND with itself (a closed loop's segments
// may cross — though the canonical face boundary should not, and an SSI
// pcurve may genuinely self-intersect).
// ────────────────────────────────────────────────────────────────────────────

/**
 * Split each input polyline into segments at every intersection with every
 * other input polyline, returning an array of `splitPolylines[i]` — the
 * i-th input polyline split into a sequence of vertex indices into the
 * `VertexStore`.
 *
 * @param {Array<Array<[number,number]>>} polylines  input pcurves
 * @param {VertexStore} V                            shared vertex store
 * @returns {Array<Array<number>>}                   vertex-index polylines
 */
function splitPolylines(polylines, V) {
  const n = polylines.length;
  const splits = polylines.map(() => []);

  // For each polyline, collect per-segment intersection points (param along
  // each segment so we can sort them and walk the polyline in order).
  for (let i = 0; i < n; i++) {
    const polyI = polylines[i];
    const segCount = polyI.length - 1;
    // segIntersections[seg] = array of {t, point} for the seg-th segment of polyI.
    const segIntersections = Array.from({ length: segCount }, () => []);

    for (let s = 0; s < segCount; s++) {
      const a = polyI[s], b = polyI[s + 1];

      // Intersect with every segment of every other polyline (and own polyline's
      // non-adjacent segments).
      for (let j = 0; j < n; j++) {
        const polyJ = polylines[j];
        const segCountJ = polyJ.length - 1;
        for (let t = 0; t < segCountJ; t++) {
          if (i === j) {
            // Skip adjacent segments (they share an endpoint by construction).
            if (t === s || t === s - 1 || t === s + 1) continue;
            // Also skip if polyline is closed and end-segments share endpoint.
            if (s === 0 && t === segCountJ - 1 &&
                dist2(polyI[0], polyI[polyI.length - 1]) < V.tol) continue;
            if (s === segCount - 1 && t === 0 &&
                dist2(polyI[0], polyI[polyI.length - 1]) < V.tol) continue;
          }
          const c = polyJ[t], d = polyJ[t + 1];
          const X = segmentIntersection(a, b, c, d);
          if (!X) continue;
          // Endpoint coalescing — endpoints (t∈{0,1}) are already handled by
          // the vertex coalescing in the polyline walk below. Skip a touch
          // that is exactly at one of the segment endpoints (within tol) of
          // the i,s segment — that's a shared vertex, not an interior cross.
          const distToA = dist2(X.point, a);
          const distToB = dist2(X.point, b);
          if (distToA < V.tol || distToB < V.tol) continue;
          segIntersections[s].push({ t: X.t, point: X.point });
        }
      }
    }

    // Walk the polyline, emitting vertex indices in order. For each segment,
    // sort its intersections by parameter, then emit start, intersections,
    // end (the next iteration's start handles dedup).
    const out = splits[i];
    out.push(V.add(polyI[0]));
    for (let s = 0; s < segCount; s++) {
      const list = segIntersections[s].slice().sort((p, q) => p.t - q.t);
      for (const X of list) out.push(V.add(X.point));
      const tailIdx = V.add(polyI[s + 1]);
      // Avoid duplicating the same vertex if an intersection was right at
      // the segment end.
      if (out[out.length - 1] !== tailIdx) out.push(tailIdx);
    }
  }

  return splits;
}

// ────────────────────────────────────────────────────────────────────────────
// Half-edge DCEL — directed edges twinned in pairs; `next` defines a face cycle
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the half-edge graph from the split polylines.
 *
 * Each consecutive (vi, vi+1) pair in a split polyline becomes ONE arrangement
 * EDGE between those vertices, which spawns TWO half-edges (twins). Half-edge
 * ids are even/odd pairs (he, he^1 = twin).
 *
 * @param {Array<Array<number>>} splits
 * @param {VertexStore} V
 * @param {Array<{closed:boolean,sourceIndex:number}>} polyMeta
 * @returns {{
 *   halfEdges: Array<{origin:number, twin:number, next:number|null,
 *                      face:number|null, source:number, isClosed:boolean}>,
 *   edgeKey: Map<string, number>
 * }}
 */
function buildHalfEdges(splits, V, polyMeta) {
  const halfEdges = [];
  const edgeKey = new Map(); // 'u:v' → he-id from u to v (one direction)

  const addHe = (u, v, source) => {
    // Skip degenerate zero-length edges.
    if (u === v) return null;
    // Look for existing he in this direction.
    const key = `${u}:${v}`;
    if (edgeKey.has(key)) {
      // Already added — increment uses (an edge shared between two pcurves).
      return edgeKey.get(key);
    }
    const heId = halfEdges.length;
    const twinId = heId + 1;
    halfEdges.push({
      origin: u, twin: twinId, next: null, face: null,
      source, isClosed: false,
    });
    halfEdges.push({
      origin: v, twin: heId, next: null, face: null,
      source, isClosed: false,
    });
    edgeKey.set(key, heId);
    edgeKey.set(`${v}:${u}`, twinId);
    V.outgoing[u].push(heId);
    V.outgoing[v].push(twinId);
    return heId;
  };

  for (let i = 0; i < splits.length; i++) {
    const chain = splits[i];
    const meta = polyMeta[i] || { closed: false, sourceIndex: i };
    for (let k = 0; k < chain.length - 1; k++) {
      addHe(chain[k], chain[k + 1], meta.sourceIndex);
    }
    // If closed, link end → start.
    if (meta.closed && chain.length >= 3) {
      const first = chain[0];
      const last = chain[chain.length - 1];
      if (first !== last) addHe(last, first, meta.sourceIndex);
    }
  }

  return { halfEdges, edgeKey };
}

// ────────────────────────────────────────────────────────────────────────────
// Angular ordering at each vertex — the heart of the planar embedding
// ────────────────────────────────────────────────────────────────────────────

/**
 * For each vertex, sort the outgoing half-edges by their geometric outgoing
 * direction (atan2 angle). Then for each outgoing half-edge `he` we set
 *
 *   he.next = the half-edge whose origin is the TARGET of he, whose outgoing
 *             direction is the one that comes BEFORE the incoming direction
 *             of he^twin (i.e. the next half-edge ccw around the target).
 *
 * The walk `he → he.next → he.next.next → …` traces the boundary of one
 * face of the planar subdivision in CW order (the face lies to the LEFT of
 * each half-edge under this convention — the de Berg "next = prev rotated
 * around target" rule).
 *
 * @param {VertexStore} V
 * @param {Array} halfEdges
 */
function wireNextPointers(V, halfEdges) {
  // Angle of outgoing he from its origin to the next vertex.
  const heAngle = (he) => {
    const a = V.point(he.origin);
    const b = V.point(halfEdges[he.twin].origin);
    return Math.atan2(b[1] - a[1], b[0] - a[0]);
  };

  // For each vertex, sort outgoing half-edges by angle.
  for (let v = 0; v < V.count(); v++) {
    const outs = V.outgoing[v];
    outs.sort((aId, bId) => heAngle(halfEdges[aId]) - heAngle(halfEdges[bId]));
  }

  // For each half-edge `he` (u → v), `he.next` is the half-edge outgoing
  // from v whose direction is the FIRST one counter-clockwise from the
  // incoming direction (which is the angle of `he` plus π — i.e. the
  // direction at which `he` arrives at v). The half-edge `next` lies on
  // the same face boundary as `he` — the face to the LEFT of `he`.
  for (let h = 0; h < halfEdges.length; h++) {
    const he = halfEdges[h];
    const v = halfEdges[he.twin].origin; // target
    const incoming = heAngle(he) + Math.PI; // direction of he^twin from v
    const outs = V.outgoing[v];
    if (outs.length === 0) continue;
    // Sort once cached; do binary search for the angle just *less than*
    // incoming, going ccw — but with the small counts here a linear scan
    // is fine and avoids the wrap-around edge case.
    // We want the largest angle that is strictly less than `incoming`,
    // wrapping around 2π. We compute the ccw rotation needed for each
    // outgoing half-edge and take the minimum positive rotation.
    let bestId = -1;
    let bestDelta = Infinity;
    const TWO_PI = 2 * Math.PI;
    for (const oId of outs) {
      if (oId === he.twin) continue; // skip going back along the twin — that's a 180° turn
      const oAng = heAngle(halfEdges[oId]);
      // Rotation FROM `incoming` (the arrival direction) TO `oAng`, going
      // CLOCKWISE (right-hand turn). In a planar embedding, the next half-edge
      // on the LEFT face is the one we reach by the SMALLEST CLOCKWISE turn
      // from the incoming direction (equivalently: the largest CCW angle that
      // is <= the incoming angle, modulo 2π).
      let delta = incoming - oAng;
      while (delta < 0) delta += TWO_PI;
      while (delta >= TWO_PI) delta -= TWO_PI;
      if (delta < bestDelta) { bestDelta = delta; bestId = oId; }
    }
    if (bestId === -1 && outs.length === 1 && outs[0] === he.twin) {
      // Dangling endpoint — only the twin is here. The boundary walks back.
      bestId = he.twin;
    }
    he.next = bestId;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Face extraction — walk `next` cycles
// ────────────────────────────────────────────────────────────────────────────

/**
 * Walk the half-edge graph; every `next`-cycle is one face's boundary.
 *
 * @param {VertexStore} V
 * @param {Array} halfEdges
 * @returns {Array<{
 *   halfEdges: number[],         // ordered he-ids around the loop
 *   vertices: number[],          // ordered vertex indices (= origin of each he)
 *   points: number[][],          // (u,v) points (= V.point(vertex))
 *   signedArea: number,          // signed area in (u,v)
 *   isOuter: boolean,            // true iff signedArea < 0 (canonical: outer of unbounded face)
 * }>}
 */
function extractFaceLoops(V, halfEdges) {
  const visited = new Uint8Array(halfEdges.length);
  const loops = [];
  for (let start = 0; start < halfEdges.length; start++) {
    if (visited[start]) continue;
    if (halfEdges[start].next == null) { visited[start] = 1; continue; }
    const loop = [];
    const vertices = [];
    const points = [];
    let h = start;
    let safety = halfEdges.length * 4 + 10; // bound the walk
    while (h !== undefined && h !== null && !visited[h]) {
      if (safety-- <= 0) break;
      visited[h] = 1;
      loop.push(h);
      const he = halfEdges[h];
      vertices.push(he.origin);
      points.push(V.point(he.origin).slice());
      h = he.next;
      if (h === start) break;
    }
    if (loop.length < 3) continue;
    // Signed area via shoelace.
    let A = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      A += (a[0] * b[1] - b[0] * a[1]);
    }
    A *= 0.5;
    loops.push({
      halfEdges: loop, vertices, points,
      signedArea: A,
      isOuter: A < 0, // CW loop = outer face boundary of the unbounded region
    });
  }
  return loops;
}

// ────────────────────────────────────────────────────────────────────────────
// Point-in-polygon — for hole nesting
// ────────────────────────────────────────────────────────────────────────────

/**
 * Even-odd point-in-polygon test for a 2-D ring of (u,v) points.
 */
export function pointInRing(p, ring) {
  let inside = false;
  const n = ring.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const a = ring[i], b = ring[j];
    if (((a[1] > p[1]) !== (b[1] > p[1])) &&
        (p[0] < (b[0] - a[0]) * (p[1] - a[1]) / ((b[1] - a[1]) || EPS) + a[0])) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Pick a representative point STRICTLY inside the ring (the polygon centroid,
 * shifted toward an interior edge midpoint if the centroid happens to be on
 * the boundary or outside a non-convex ring).
 */
export function representativePoint(ring) {
  if (ring.length === 0) return [0, 0];
  let cx = 0, cy = 0;
  for (const p of ring) { cx += p[0]; cy += p[1]; }
  cx /= ring.length; cy /= ring.length;
  if (pointInRing([cx, cy], ring)) return [cx, cy];
  // Fallback — try midpoints between centroid and edge midpoints.
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const mx = (a[0] + b[0]) * 0.5, my = (a[1] + b[1]) * 0.5;
    const px = (cx + mx) * 0.5, py = (cy + my) * 0.5;
    if (pointInRing([px, py], ring)) return [px, py];
  }
  return [cx, cy];
}

// ────────────────────────────────────────────────────────────────────────────
// Public API — buildArrangement
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build a planar arrangement from a set of pcurves in (u,v) space.
 *
 * @param {Array<{points:Array<[number,number]>, closed?:boolean, source?:any}>} pcurves
 *   Input pcurves. Each `points` is a polyline in (u,v). `closed` flags a
 *   closed loop (the face boundary; the boundary of a hole). `source` is
 *   opaque metadata returned per arrangement edge — typically a tag
 *   identifying which input pcurve an edge came from.
 * @param {object} [opts]
 * @param {number} [opts.tol=1e-6]  vertex coalescing tolerance in (u,v).
 * @returns {{
 *   vertices: Array<[number,number]>,
 *   halfEdges: Array<{origin:number, twin:number, next:number|null,
 *                     face:number|null, source:any, isClosed:boolean}>,
 *   loops: Array<{halfEdges:number[], vertices:number[], points:number[][],
 *                 signedArea:number, isOuter:boolean}>,
 *   faces: Array<{
 *     outerLoop: object,     // loop record (from `loops`)
 *     holes: object[],       // loops nested strictly inside outerLoop
 *     area: number,
 *   }>,
 *   stats: { nInputs:number, nSegments:number, nIntersections:number,
 *            nVertices:number, nHalfEdges:number, nLoops:number, nFaces:number }
 * }}
 *
 * The `faces` array lists every BOUNDED face of the planar subdivision —
 * i.e. every connected region with finite area, with hole loops attached
 * via even-odd point-in-polygon nesting. The unbounded outer face is
 * EXCLUDED from `faces` (it has the only CW loop and is never a target).
 */
export function buildArrangement(pcurves, opts = {}) {
  const tol = opts.tol || 1e-6;

  // ── 1. Vertex coalescing + polyline extraction ─────────────────────────
  const V = new VertexStore(tol);
  const polylines = pcurves.map((pc) => pc.points.map((p) => [p[0], p[1]]));
  const polyMeta = pcurves.map((pc, i) => ({
    closed: !!pc.closed, sourceIndex: pc.source !== undefined ? pc.source : i,
  }));

  // Pre-allocate vertices for every polyline endpoint so endpoint coalescing
  // happens immediately (a closed loop's last point coincides with its first).
  let nSegments = 0;
  for (const poly of polylines) nSegments += Math.max(0, poly.length - 1);

  // ── 2. Split polylines at pairwise intersections ───────────────────────
  const splits = splitPolylines(polylines, V);
  let nIntersections = 0;
  for (let i = 0; i < splits.length; i++) {
    nIntersections += splits[i].length - polylines[i].length;
  }

  // ── 3. Build half-edge graph ───────────────────────────────────────────
  const { halfEdges, edgeKey } = buildHalfEdges(splits, V, polyMeta);

  // ── 4. Wire `next` via angular ordering at each vertex ─────────────────
  wireNextPointers(V, halfEdges);

  // ── 5. Extract face loops ──────────────────────────────────────────────
  const loops = extractFaceLoops(V, halfEdges);

  // ── 6. Build bounded-face list with hole nesting ───────────────────────
  // Every CCW loop (signedArea > 0) is a candidate outer boundary; every
  // CW loop (signedArea < 0) is either an outer of the unbounded face OR a
  // hole inside some bounded face. We pick the minimal-area CCW outer for
  // each CW candidate; if no CCW outer encloses it, it's the unbounded face.
  const bounded = loops.filter((lp) => !lp.isOuter); // CCW = bounded face's outer
  const candidates = loops.filter((lp) => lp.isOuter); // CW = either unbounded outer or hole

  // Hole-nesting: each CW candidate has a representative point and the set of
  // CCW outers whose rings contain it. The hole's PARENT is the smallest such
  // CCW (the innermost CCW that encloses it); the CW is filtered out if its
  // OWN ring duplicates an existing CCW outer's ring (the same closed pcurve
  // gets walked in both directions, producing CCW and CW twins of the same
  // boundary — the CW twin is not a hole, it's the unbounded-side walk of
  // its CCW pair).
  //
  // A CW loop is the UNBOUNDED-side walk of its CCW twin iff they enclose
  // the same area (i.e. share the same boundary). We detect that by checking
  // whether the CCW outer's signedArea ≈ |CW's signedArea|.
  const faces = bounded.map((ccw) => ({
    outerLoop: ccw,
    holes: [],
    area: Math.abs(ccw.signedArea),
  }));
  const facesByCcw = new Map();
  for (let i = 0; i < bounded.length; i++) facesByCcw.set(bounded[i], faces[i]);

  for (const cw of candidates) {
    const cwArea = Math.abs(cw.signedArea);
    const rep = representativePoint(cw.points);
    // Find the smallest CCW that contains rep.
    let parent = null;
    let parentArea = Infinity;
    for (const ccw of bounded) {
      const ccwArea = Math.abs(ccw.signedArea);
      if (ccwArea <= cwArea + 1e-9) continue; // skip equal or smaller — twins/equal don't count
      if (!pointInRing(rep, ccw.points)) continue;
      if (ccwArea < parentArea) { parentArea = ccwArea; parent = ccw; }
    }
    if (parent) {
      facesByCcw.get(parent).holes.push(cw);
      facesByCcw.get(parent).area -= cwArea;
    }
    // If no parent, this CW is the unbounded face's outer — discard.
  }
  // Sort faces by area descending — caller usually wants the biggest first.
  faces.sort((a, b) => b.area - a.area);

  return {
    vertices: V.points.map((p) => [p[0], p[1]]),
    halfEdges,
    loops,
    faces,
    stats: {
      nInputs: pcurves.length,
      nSegments,
      nIntersections,
      nVertices: V.count(),
      nHalfEdges: halfEdges.length,
      nLoops: loops.length,
      nFaces: faces.length,
    },
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Pcurve tessellation helper — for callers that have a B-spline pcurve and
// want to feed it to `buildArrangement` as a polyline.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Tessellate a B-spline pcurve `{degree, knots, controlPoints}` (the shape
 * `PCurveProjection.projectCurveOnSurface` returns) to a polyline of
 * `nSamples` (u,v) points.
 *
 * @param {{degree:number, knots:number[], controlPoints:number[][]}} pcurve
 * @param {{nSamples?:number}} [opts]
 * @returns {Array<[number,number]>}
 */
export function tessellatePcurve(pcurve, opts = {}) {
  const n = Math.max(4, opts.nSamples || 32);
  const out = new Array(n + 1);

  // Use evalPCurve from PCurveProjection — but we don't want to take a hard
  // import dependency here (foundation module, must stay kernel-free + light).
  // Re-implement Cox-de Boor inline — same code as PCurveProjection.evalPCurve.
  const evalPCurve = (pc, t) => {
    const p = pc.degree;
    const cp = pc.controlPoints;
    const knots = pc.knots;
    const nCP = cp.length;
    // knot span
    let span;
    if (t >= knots[nCP] - EPS) span = nCP - 1;
    else if (t <= knots[p] + EPS) span = p;
    else {
      let lo = p, hi = nCP;
      let mid = (lo + hi) >> 1;
      while (t < knots[mid] || t >= knots[mid + 1]) {
        if (t < knots[mid]) hi = mid; else lo = mid;
        mid = (lo + hi) >> 1;
      }
      span = mid;
    }
    // basis
    const N = new Array(p + 1).fill(0);
    const left = new Array(p + 1).fill(0);
    const right = new Array(p + 1).fill(0);
    N[0] = 1;
    for (let j = 1; j <= p; j++) {
      left[j] = t - knots[span + 1 - j];
      right[j] = knots[span + j] - t;
      let saved = 0;
      for (let r = 0; r < j; r++) {
        const denom = right[r + 1] + left[j - r];
        const tmp = denom > EPS ? N[r] / denom : 0;
        N[r] = saved + right[r + 1] * tmp;
        saved = left[j - r] * tmp;
      }
      N[j] = saved;
    }
    let u = 0, v = 0;
    for (let r = 0; r <= p; r++) {
      const idx = span - p + r;
      if (idx < 0 || idx >= nCP) continue;
      u += N[r] * cp[idx][0];
      v += N[r] * cp[idx][1];
    }
    return [u, v];
  };

  for (let i = 0; i <= n; i++) out[i] = evalPCurve(pcurve, i / n);
  return out;
}
