// PUSH-172 (Slice-128) — 3D Print Slicing math.
//
// Pure functions. No React, no DOM, no window globals.
//
// Algorithm — for each Z height:
//   1. Walk every triangle of the tessellated mesh.
//   2. Classify the three vertices by sign of (vz - zPlane).
//   3. If the triangle straddles the plane, linearly interpolate the
//      crossing points on the two edges with opposite signs and emit a
//      single 2D segment ([[x1,y1],[x2,y2]]).
//   4. Link segments end-to-end (snap-grid hash on endpoints) into
//      closed polyline contours; open chains are kept too (flagged via
//      `.open = true`) so a non-watertight mesh still surfaces something
//      to the user.
//
// Output shape:
//   contours[zIdx][polyIdx] = Array<[x, y]>     // closed polyline
//                                                // (first point NOT repeated at end)
//
// All polylines are in the slice plane (z is constant within a layer).
//
// The math here is identical in spirit to slicerEngine.js but pared down
// to the brief: no infill, no support, no outer/inner classification, no
// G-code — just contours. Standalone for the PUSH-172 panel.

const EPSILON   = 1e-9;
const SNAP_GRID = 1e-4;   // 0.1 micron

/* =====================================================================
 * AABB
 * ===================================================================== */

export function meshBounds(positions) {
  if (!positions || positions.length === 0) {
    throw new Error('sliceMath: empty positions');
  }
  let minX =  Infinity, minY =  Infinity, minZ =  Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { minX, minY, minZ, maxX, maxY, maxZ };
}

/**
 * Generate Z heights for slicing. First layer sits at minZ + layerHeight/2
 * so the extruded contour straddles the bed plane (matches real FDM /
 * SLA practice — the first deposited bead is half a layer above the
 * build plate).
 */
export function layerZHeights(bounds, layerHeight) {
  if (!(layerHeight > 0)) throw new Error('sliceMath: layerHeight must be > 0');
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
 * Plane-triangle intersection (signed-distance variant)
 * ===================================================================== */

/**
 * Intersect one triangle with a horizontal plane z = zPlane. Returns a
 * single 2D segment ([[x1,y1],[x2,y2]]) when the triangle straddles the
 * plane, otherwise null.
 */
export function intersectTrianglePlane(
  ax, ay, az, bx, by, bz, cx, cy, cz, zPlane,
) {
  const da = az - zPlane;
  const db = bz - zPlane;
  const dc = cz - zPlane;

  // Coplanar triangle — skip. Its three edges should be handled by
  // neighbouring triangles' segments.
  if (Math.abs(da) < EPSILON && Math.abs(db) < EPSILON && Math.abs(dc) < EPSILON) {
    return null;
  }

  // Entirely on one side (with epsilon-tolerant strict inequalities).
  if (da >  EPSILON && db >  EPSILON && dc >  EPSILON) return null;
  if (da < -EPSILON && db < -EPSILON && dc < -EPSILON) return null;

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

  // Deduplicate near-coincident points (vertex-on-plane case yields the
  // same point twice).
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
  return [dedup[0], dedup[1]];
}

/* =====================================================================
 * Edge linking — segments → closed contour polylines
 * ===================================================================== */

function snapKey(x, y) {
  const qx = Math.round(x / SNAP_GRID);
  const qy = Math.round(y / SNAP_GRID);
  return `${qx},${qy}`;
}
function decodeKey(key) {
  const [a, b] = key.split(',');
  return [parseFloat(a) * SNAP_GRID, parseFloat(b) * SNAP_GRID];
}

/**
 * Link 2D segments end-to-end into contour polylines. Each segment is a
 * pair of [x, y] endpoints. Returns an array of polylines; each polyline
 * is a sequence of [x, y] vertices (first vertex NOT repeated at the
 * end). Open chains keep `.open = true`.
 */
export function linkSegmentsToContours(segments) {
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

  const consumed = new Set();
  function edgeId(from, to) { return `${from}|${to}`; }

  const loops = [];
  for (const [startKey, neighbours] of adj.entries()) {
    for (const n of neighbours) {
      if (consumed.has(edgeId(startKey, n.key))) continue;

      const loop = [decodeKey(startKey)];
      let prevKey = startKey;
      let curKey  = n.key;
      let curPoint = n.point;
      let open = false;
      const startK = startKey;

      while (true) {
        consumed.add(edgeId(prevKey, curKey));
        consumed.add(edgeId(curKey, prevKey));
        loop.push(curPoint);
        if (curKey === startK) break;

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
          for (const candidate of nbrs) {
            if (consumed.has(edgeId(curKey, candidate.key))) continue;
            next = candidate;
            break;
          }
        }
        if (!next) { open = true; break; }
        prevKey = curKey;
        curKey  = next.key;
        curPoint = next.point;
        if (loop.length > 200000) { open = true; break; }
      }

      if (loop.length >= 2) {
        // Closed contour: last vertex equals first (snap-grid hash match)
        // — strip the duplicate so callers always see a non-repeating ring.
        if (!open && loop.length >= 3) {
          const first = loop[0], last = loop[loop.length - 1];
          if (Math.abs(first[0] - last[0]) < SNAP_GRID
           && Math.abs(first[1] - last[1]) < SNAP_GRID) {
            loop.pop();
          }
        }
        if (open) loop.open = true;
        loops.push(loop);
      }
    }
  }

  return loops;
}

/* =====================================================================
 * Top-level slice driver
 * ===================================================================== */

/**
 * Slice a tessellated mesh against a list of horizontal planes.
 *
 *   positions: Float32Array | number[]  — packed (x, y, z) triples in mm
 *   indices:   Uint32Array | number[] | null  — triangle vertex offsets
 *                                                (3 per tri); null means
 *                                                positions is already in
 *                                                triangle-soup order
 *   zHeights:  number[]                  — one Z value per layer
 *
 * Returns: contours[zIdx][polyIdx] = Array<[x, y]>
 */
export function sliceMesh(positions, indices, zHeights) {
  if (!positions || positions.length === 0) {
    throw new Error('sliceMath: empty positions');
  }
  if (!Array.isArray(zHeights) || zHeights.length === 0) {
    throw new Error('sliceMath: no z heights');
  }

  const hasIdx = indices && indices.length > 0;
  const triCount = hasIdx
    ? Math.floor(indices.length / 3)
    : Math.floor(positions.length / 9);

  // Pre-compute triangle Z ranges so we can skip non-straddling tris in
  // the inner loop. ~3× speedup on the box-vs-150-layer case.
  const triMinZ = new Float64Array(triCount);
  const triMaxZ = new Float64Array(triCount);
  for (let t = 0; t < triCount; t++) {
    let i0, i1, i2;
    if (hasIdx) {
      i0 = indices[t * 3 + 0];
      i1 = indices[t * 3 + 1];
      i2 = indices[t * 3 + 2];
    } else {
      i0 = t * 3 + 0;
      i1 = t * 3 + 1;
      i2 = t * 3 + 2;
    }
    const z0 = positions[i0 * 3 + 2];
    const z1 = positions[i1 * 3 + 2];
    const z2 = positions[i2 * 3 + 2];
    triMinZ[t] = Math.min(z0, z1, z2);
    triMaxZ[t] = Math.max(z0, z1, z2);
  }

  const contours = new Array(zHeights.length);
  for (let zi = 0; zi < zHeights.length; zi++) {
    const z = zHeights[zi];
    const segments = [];

    for (let t = 0; t < triCount; t++) {
      if (triMinZ[t] > z + EPSILON) continue;
      if (triMaxZ[t] < z - EPSILON) continue;

      let i0, i1, i2;
      if (hasIdx) {
        i0 = indices[t * 3 + 0];
        i1 = indices[t * 3 + 1];
        i2 = indices[t * 3 + 2];
      } else {
        i0 = t * 3 + 0;
        i1 = t * 3 + 1;
        i2 = t * 3 + 2;
      }
      const ax = positions[i0 * 3 + 0];
      const ay = positions[i0 * 3 + 1];
      const az = positions[i0 * 3 + 2];
      const bx = positions[i1 * 3 + 0];
      const by = positions[i1 * 3 + 1];
      const bz = positions[i1 * 3 + 2];
      const cx = positions[i2 * 3 + 0];
      const cy = positions[i2 * 3 + 1];
      const cz = positions[i2 * 3 + 2];

      const seg = intersectTrianglePlane(
        ax, ay, az, bx, by, bz, cx, cy, cz, z,
      );
      if (seg) segments.push(seg);
    }

    contours[zi] = linkSegmentsToContours(segments);
  }

  return contours;
}

/* =====================================================================
 * Metrics
 * ===================================================================== */

/** Perimeter length of one polyline (closed if `.open !== true`). */
export function polylineLength(poly) {
  if (!poly || poly.length < 2) return 0;
  let len = 0;
  for (let i = 0; i < poly.length - 1; i++) {
    const dx = poly[i + 1][0] - poly[i][0];
    const dy = poly[i + 1][1] - poly[i][1];
    len += Math.sqrt(dx * dx + dy * dy);
  }
  if (!poly.open) {
    const dx = poly[0][0] - poly[poly.length - 1][0];
    const dy = poly[0][1] - poly[poly.length - 1][1];
    len += Math.sqrt(dx * dx + dy * dy);
  }
  return len;
}

/** Total perimeter across every contour of every layer (mm). */
export function totalPerimeterLength(contours) {
  let total = 0;
  for (let zi = 0; zi < contours.length; zi++) {
    const polys = contours[zi];
    if (!polys) continue;
    for (let pi = 0; pi < polys.length; pi++) {
      total += polylineLength(polys[pi]);
    }
  }
  return total;
}

/** 2D AABB of the contours at one layer index. */
export function layerBounds2D(layerContours) {
  if (!layerContours || layerContours.length === 0) return null;
  let minX =  Infinity, minY =  Infinity;
  let maxX = -Infinity, maxY = -Infinity;
  for (const poly of layerContours) {
    for (const pt of poly) {
      if (pt[0] < minX) minX = pt[0]; if (pt[0] > maxX) maxX = pt[0];
      if (pt[1] < minY) minY = pt[1]; if (pt[1] > maxY) maxY = pt[1];
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { minX, minY, maxX, maxY };
}

/** Allowed layer heights per the brief. */
export const LAYER_HEIGHTS = Object.freeze([0.1, 0.2, 0.3]);
export const DEFAULT_LAYER_HEIGHT = 0.2;
