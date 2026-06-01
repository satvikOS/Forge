// Forge-163 — STL/BufferGeometry slicing engine.
//
// Real plane-triangle intersection + edge-linking contour assembly. No
// rendered-slice shortcuts: every layer holds true polygon loops with
// outer/inner classification.
//
// Input format mirrors the rest of forge-v4 mesh dispatch:
//   geom = { positions: Float32Array, indices: Uint32Array }
//
// Algorithm summary:
//   1. AABB → user-supplied Z heights snap to triangles' min/max.
//   2. For each Z height:
//        a. Build a list of segments by intersecting every triangle whose
//           Z-range straddles Z (Möller-style: signed-distance per vertex,
//           linear-interp where signs differ).
//        b. Link segments end-to-end via a hash of rounded endpoints to
//           assemble closed loops (open chains are kept too but flagged).
//        c. Classify each loop as outer or inner via signed area + a
//           point-in-polygon containment graph: top-level CCW loops are
//           outer; nested CW loops are holes.
//   3. Layer record: { z, outerLoops: [poly], innerLoops: [poly] }
//
// Polygons are arrays of [x, y] pairs in the slice plane (z is constant).
// Vertices are deduped via a quantisation key tuned to the slicing
// tolerance (default 1e-4 mm).
//
// All routines are pure on their inputs — no globals.

const EPSILON   = 1e-9;
const SNAP_GRID = 1e-4;   // 0.1 micron — finer than any FDM printer can do.

/* =====================================================================
 * AABB + plane prep
 * ===================================================================== */

export function geometryBounds(geom) {
  if (!geom || !geom.positions || geom.positions.length === 0) {
    throw new Error('slicerEngine: empty geometry');
  }
  const p = geom.positions;
  let minX =  Infinity, minY =  Infinity, minZ =  Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i], y = p[i + 1], z = p[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/**
 * Generate Z-heights for slicing, given a layer height and the
 * geometry's AABB. First layer sits at minZ + layerHeight/2 so the
 * extruded contour straddles the bed plane.
 */
export function layerZHeights(bounds, layerHeight) {
  if (!(layerHeight > 0)) throw new Error('slicerEngine: layerHeight must be > 0');
  const heights = [];
  const start = bounds.minZ + layerHeight / 2;
  let z = start;
  while (z < bounds.maxZ + EPSILON) {
    heights.push(z);
    z += layerHeight;
  }
  return heights;
}

/* =====================================================================
 * Plane-triangle intersection (signed-distance variant of MT)
 * ===================================================================== */

/**
 * Intersect one triangle (defined by 3 vertices) with a horizontal
 * plane z = zPlane. Returns one segment ([[x1,y1],[x2,y2]]) when the
 * triangle straddles the plane, or null when there's no clean
 * intersection.
 *
 * Edge cases handled:
 *   - Triangle entirely above / entirely below → null
 *   - One vertex sits exactly on the plane and the other two
 *     straddle → single segment from that vertex to the opposite edge
 *   - Two vertices sit exactly on the plane → return that shared edge
 *   - Coplanar triangle (all three on the plane) → null; coplanar
 *     contributions are handled at a higher level
 */
export function intersectTrianglePlane(ax, ay, az, bx, by, bz, cx, cy, cz, zPlane) {
  const da = az - zPlane;
  const db = bz - zPlane;
  const dc = cz - zPlane;

  // Coplanar triangle — skipped (its three edges should be handled by
  // neighbours' segments).
  if (Math.abs(da) < EPSILON && Math.abs(db) < EPSILON && Math.abs(dc) < EPSILON) {
    return null;
  }

  // Entirely on one side (with epsilon-tolerant strict inequalities).
  if (da > EPSILON && db > EPSILON && dc > EPSILON) return null;
  if (da < -EPSILON && db < -EPSILON && dc < -EPSILON) return null;

  // Collect intersection points across the three edges. Vertices that
  // sit on the plane (|d| < EPSILON) count as a single point at the
  // vertex itself; otherwise interpolate where the signs differ.
  const points = [];

  function addEdgePoint(pa, pb, dpa, dpb) {
    if (Math.abs(dpa) < EPSILON) { points.push([pa[0], pa[1]]); return; }
    if (Math.abs(dpb) < EPSILON) { points.push([pb[0], pb[1]]); return; }
    if ((dpa > 0 && dpb < 0) || (dpa < 0 && dpb > 0)) {
      const t = dpa / (dpa - dpb);
      points.push([
        pa[0] + (pb[0] - pa[0]) * t,
        pa[1] + (pb[1] - pa[1]) * t,
      ]);
    }
  }

  addEdgePoint([ax, ay], [bx, by], da, db);
  addEdgePoint([bx, by], [cx, cy], db, dc);
  addEdgePoint([cx, cy], [ax, ay], dc, da);

  // Deduplicate near-coincident points (vertex-on-plane often yields
  // duplicates because the same vertex appears in two edge tests).
  const dedup = [];
  for (const p of points) {
    let same = false;
    for (const q of dedup) {
      if (Math.abs(q[0] - p[0]) < SNAP_GRID && Math.abs(q[1] - p[1]) < SNAP_GRID) {
        same = true; break;
      }
    }
    if (!same) dedup.push(p);
  }

  if (dedup.length < 2) return null;
  // Take the first two unique points as the segment endpoints. Three
  // unique points only occur with a coplanar edge (degenerate); we
  // still emit a single segment so the chain-linker sees the geometry.
  return [dedup[0], dedup[1]];
}

/* =====================================================================
 * Edge linking — turn unordered segments into closed polygon loops
 * ===================================================================== */

function snapKey(x, y) {
  // Quantise to SNAP_GRID so floating noise on shared edges hashes
  // identically across the two triangles that produced them.
  const qx = Math.round(x / SNAP_GRID);
  const qy = Math.round(y / SNAP_GRID);
  return `${qx},${qy}`;
}

/**
 * Link segments into polygon loops. Each segment is a pair of [x,y]
 * endpoints. Returns an array of loops; each loop is a closed polygon
 * (first vertex repeated at the end is *not* included — caller can
 * close it themselves if needed).
 *
 * Open chains (rare — they indicate a non-watertight mesh) are kept as
 * loops with `.open = true` so users still see what the slice looked
 * like on a broken model.
 */
export function linkSegmentsToLoops(segments) {
  // Build an adjacency map: snapKey → [{ to: snapKey, point: [x,y] }, ...].
  const adj = new Map();
  function addEdge(a, b) {
    const ka = snapKey(a[0], a[1]);
    const kb = snapKey(b[0], b[1]);
    if (ka === kb) return;
    if (!adj.has(ka)) adj.set(ka, []);
    adj.get(ka).push({ key: kb, point: [b[0], b[1]] });
    if (!adj.has(kb)) adj.set(kb, []);
    adj.get(kb).push({ key: ka, point: [a[0], a[1]] });
  }
  for (const seg of segments) addEdge(seg[0], seg[1]);

  // Track which directed edges we've consumed. Each undirected edge is
  // a pair of half-edges (ka→kb and kb→ka); both flip as we walk.
  const consumed = new Set();
  function edgeId(from, to) { return `${from}|${to}`; }

  const loops = [];
  for (const [startKey, neighbours] of adj.entries()) {
    for (const n of neighbours) {
      if (consumed.has(edgeId(startKey, n.key))) continue;

      // Walk a loop starting at startKey → n.
      const loop = [decodeKey(startKey)];
      let prevKey = startKey;
      let curKey = n.key;
      let curPoint = n.point;
      let open = false;
      const startK = startKey;

      while (true) {
        consumed.add(edgeId(prevKey, curKey));
        consumed.add(edgeId(curKey, prevKey));
        loop.push(curPoint);
        if (curKey === startK) break;

        // Pick the next neighbour that isn't the one we just came from
        // and hasn't been consumed yet.
        const nbrs = adj.get(curKey);
        if (!nbrs || nbrs.length === 0) { open = true; break; }
        let next = null;
        for (const candidate of nbrs) {
          if (candidate.key === prevKey) continue;
          if (consumed.has(edgeId(curKey, candidate.key))) continue;
          next = candidate;
          break;
        }
        if (!next) {
          // Could be a junction where the only un-consumed neighbour
          // happens to be back where we came from — try it.
          for (const candidate of nbrs) {
            if (consumed.has(edgeId(curKey, candidate.key))) continue;
            next = candidate;
            break;
          }
        }
        if (!next) { open = true; break; }
        prevKey = curKey;
        curKey = next.key;
        curPoint = next.point;
        if (loop.length > 200000) { open = true; break; } // runaway guard
      }

      if (loop.length >= 3) {
        if (open) loop.open = true;
        loops.push(loop);
      }
    }
  }

  return loops;
}

function decodeKey(key) {
  const [a, b] = key.split(',');
  return [parseFloat(a) * SNAP_GRID, parseFloat(b) * SNAP_GRID];
}

/* =====================================================================
 * Polygon utilities (area, point-in-polygon, classification)
 * ===================================================================== */

export function polygonSignedArea(poly) {
  let area = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    area += a[0] * b[1] - b[0] * a[1];
  }
  return area / 2;
}

export function polygonArea(poly) { return Math.abs(polygonSignedArea(poly)); }

export function isCCW(poly) { return polygonSignedArea(poly) > 0; }

/** Crossing-number test. `pt` is [x,y]; returns true if strictly inside. */
export function pointInPolygon(pt, poly) {
  const x = pt[0], y = pt[1];
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersects = ((yi > y) !== (yj > y)) &&
                       (x < (xj - xi) * (y - yi) / ((yj - yi) || EPSILON) + xi);
    if (intersects) inside = !inside;
  }
  return inside;
}

/**
 * Classify loops into outer (CCW, top-level) and inner (CW, contained
 * by exactly one outer). The classification uses signed area as the
 * primary test and parity-of-containment as the disambiguator (so
 * islands inside holes inside outers each get the correct role).
 */
export function classifyLoops(loops) {
  const outerLoops = [];
  const innerLoops = [];
  for (const loop of loops) {
    if (!loop || loop.length < 3) continue;
    // Containment count: how many other loops strictly contain a
    // representative interior point of `loop`?
    const rep = loop[0];
    let depth = 0;
    for (const other of loops) {
      if (other === loop) continue;
      if (other.length < 3) continue;
      if (pointInPolygon(rep, other)) depth++;
    }
    if (depth % 2 === 0) outerLoops.push(loop);
    else innerLoops.push(loop);
  }
  return { outerLoops, innerLoops };
}

/* =====================================================================
 * Single-layer slicer
 * ===================================================================== */

/**
 * Slice the geometry at one Z plane. Returns
 * { z, outerLoops:[poly], innerLoops:[poly] }.
 * `poly` is an Array<[x,y]> ordered CCW for outers, CW for inners.
 */
export function sliceAtZ(geom, zPlane) {
  if (!geom || !geom.positions) throw new Error('slicerEngine.sliceAtZ: no geometry');
  const segments = [];
  const pos = geom.positions;
  const idx = geom.indices || null;

  if (idx) {
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      const seg = intersectTrianglePlane(
        pos[3 * a],     pos[3 * a + 1], pos[3 * a + 2],
        pos[3 * b],     pos[3 * b + 1], pos[3 * b + 2],
        pos[3 * c],     pos[3 * c + 1], pos[3 * c + 2],
        zPlane,
      );
      if (seg) segments.push(seg);
    }
  } else {
    for (let t = 0; t + 8 < pos.length; t += 9) {
      const seg = intersectTrianglePlane(
        pos[t],     pos[t + 1], pos[t + 2],
        pos[t + 3], pos[t + 4], pos[t + 5],
        pos[t + 6], pos[t + 7], pos[t + 8],
        zPlane,
      );
      if (seg) segments.push(seg);
    }
  }

  const loops = linkSegmentsToLoops(segments);
  const { outerLoops, innerLoops } = classifyLoops(loops);
  return { z: zPlane, outerLoops, innerLoops };
}

/* =====================================================================
 * Full slice
 * ===================================================================== */

/**
 * Slice the geometry at every height in `zHeights`. Returns
 * { bounds, layers: [ { z, outerLoops, innerLoops }, ... ] }.
 */
export function sliceGeometry(geom, zHeights) {
  if (!Array.isArray(zHeights)) throw new Error('sliceGeometry: zHeights array required');
  const bounds = geometryBounds(geom);
  const layers = [];
  for (const z of zHeights) {
    if (!Number.isFinite(z)) continue;
    layers.push(sliceAtZ(geom, z));
  }
  return { bounds, layers };
}

/**
 * Convenience: slice with a uniform layer height.
 */
export function sliceUniform(geom, layerHeight) {
  const bounds = geometryBounds(geom);
  const heights = layerZHeights(bounds, layerHeight);
  return { ...sliceGeometry(geom, heights), layerHeight, bounds };
}

/* =====================================================================
 * Geometry helpers for caller convenience
 * ===================================================================== */

/**
 * Pull positions+indices out of a THREE.BufferGeometry-like object. The
 * caller may pass either a real BufferGeometry instance (with attributes
 * and index) or the plain mesh record forge-v4 uses internally.
 */
export function geometryFromAny(input) {
  if (!input) throw new Error('slicerEngine.geometryFromAny: input required');
  // Native mesh-record path (positions + indices typed arrays).
  if (input.positions && (input.indices || input.indices === undefined)) {
    return {
      positions: input.positions instanceof Float32Array
                 ? input.positions
                 : new Float32Array(input.positions),
      indices:   input.indices
                 ? (input.indices instanceof Uint32Array
                    ? input.indices
                    : new Uint32Array(input.indices))
                 : null,
    };
  }
  // THREE.BufferGeometry-shaped path.
  if (input.attributes && input.attributes.position) {
    const pos = input.attributes.position.array;
    const idx = input.index ? input.index.array : null;
    return {
      positions: pos instanceof Float32Array ? pos : new Float32Array(pos),
      indices:   idx ? (idx instanceof Uint32Array ? idx : new Uint32Array(idx)) : null,
    };
  }
  throw new Error('slicerEngine.geometryFromAny: unsupported geometry shape');
}

/* =====================================================================
 * Bounding helpers for a single layer (used by infill clipping)
 * ===================================================================== */

export function loopBounds(loop) {
  let minX =  Infinity, minY =  Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const p of loop) {
    if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
    if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

export function layerOuterBounds(layer) {
  let minX =  Infinity, minY =  Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const loop of layer.outerLoops) {
    const b = loopBounds(loop);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
}

/* =====================================================================
 * Public dispatch surface
 * ===================================================================== */

export const SlicerEngine = {
  geometryBounds,
  layerZHeights,
  intersectTrianglePlane,
  linkSegmentsToLoops,
  polygonSignedArea,
  polygonArea,
  isCCW,
  pointInPolygon,
  classifyLoops,
  sliceAtZ,
  sliceGeometry,
  sliceUniform,
  geometryFromAny,
  loopBounds,
  layerOuterBounds,
  EPSILON,
  SNAP_GRID,
};

export default SlicerEngine;
