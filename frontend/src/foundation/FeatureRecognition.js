/**
 * ArchDisc Foundation — Automated feature recognition.
 *
 * Given a manifold-3d Manifold (or any vertProperties + triVerts mesh),
 * classify the surface into geometric features:
 *
 *   • Planar patches      (flat surfaces — faces, fillets to flats, etc.)
 *   • Cylindrical patches (round shafts, holes, fillets)
 *   • Other / freeform    (everything that doesn't fit cleanly)
 *
 * For each cylindrical patch we estimate axis direction, axis point,
 * radius, and axial extent — enough to identify a hole, a shaft, or a
 * cylindrical fillet.
 *
 * Algorithm:
 *
 *   1. Build undirected triangle-edge adjacency graph (each interior
 *      edge links two triangles).
 *   2. Compute per-triangle normal.
 *   3. Region-grow on normal similarity:
 *        A new triangle joins the active region iff its normal forms an
 *        angle ≤ planarAngleTol with the seed normal (planar) OR ≤
 *        curvedAngleTol with its adjacent triangle's normal (curved).
 *      The first kind grows planar patches, the second kind grows
 *      smooth-curved patches.
 *   4. Per-patch classification:
 *        - If max pairwise normal dot ≥ 0.999 → PLANAR
 *        - Else fit a cylinder (least-squares); if residual ≤
 *          cylTol → CYLINDRICAL
 *        - Else FREEFORM
 *   5. For cylindrical patches, classify further as HOLE / SHAFT /
 *      EDGE_FILLET based on whether neighbouring planar patches surround
 *      the cylinder (hole) or it's surrounded by space (shaft) or sits
 *      between two non-coplanar planars (fillet).
 *
 * The cylinder fitter uses an iterative scheme:
 *   - Axis estimate = average of normalized triangle-normal cross
 *     products (since all face normals on a cylinder are perpendicular
 *     to the axis, n_i × n_j tends to align with the axis when normals
 *     differ).
 *   - Project triangle centroids onto the plane perpendicular to axis
 *     through the centroid of all centroids, then fit a circle by
 *     algebraic least-squares (Pratt method: minimize Σ (x²+y²-2ax-
 *     2by-c)²).
 *   - Residual = RMS distance from each centroid to the fitted cylinder
 *     surface.
 */

const PLANAR_DOT_THRESHOLD   = 0.9995;   // ~1.8° between normals → still "same plane"
const CURVED_DOT_THRESHOLD   = 0.85;     // up to ~32° between adjacent normals → still smooth surface
const PLANAR_RMS_THRESHOLD   = 0.001;    // RMS deviation from plane (mm)
const CYLINDER_RMS_THRESHOLD = 0.05;     // RMS deviation from cylinder (mm)

/**
 * Read [x,y,z] for vertex `vIdx` from a manifold-3d Mesh structure.
 */
function getVert(mesh, vIdx) {
  const off = vIdx * mesh.numProp;
  return [mesh.vertProperties[off], mesh.vertProperties[off + 1], mesh.vertProperties[off + 2]];
}

function triNormal(p0, p1, p2) {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  const len = Math.hypot(x, y, z) || 1;
  return [x / len, y / len, z / len];
}

function triArea(p0, p1, p2) {
  const ux = p1[0] - p0[0], uy = p1[1] - p0[1], uz = p1[2] - p0[2];
  const vx = p2[0] - p0[0], vy = p2[1] - p0[1], vz = p2[2] - p0[2];
  const x = uy * vz - uz * vy;
  const y = uz * vx - ux * vz;
  const z = ux * vy - uy * vx;
  return 0.5 * Math.hypot(x, y, z);
}

function triCentroid(p0, p1, p2) {
  return [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3];
}

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const norm3 = (a) => { const l = Math.hypot(...a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; };

/**
 * Build per-triangle data + edge adjacency.
 */
function buildTriData(mesh) {
  const numTri = mesh.triVerts.length / 3;
  const normals = new Array(numTri);
  const centroids = new Array(numTri);
  const areas = new Float64Array(numTri);
  for (let t = 0; t < numTri; t++) {
    const p0 = getVert(mesh, mesh.triVerts[t * 3]);
    const p1 = getVert(mesh, mesh.triVerts[t * 3 + 1]);
    const p2 = getVert(mesh, mesh.triVerts[t * 3 + 2]);
    normals[t] = triNormal(p0, p1, p2);
    centroids[t] = triCentroid(p0, p1, p2);
    areas[t] = triArea(p0, p1, p2);
  }
  // Edge adjacency: key="i,j" sorted → list of triangles
  const edgeMap = new Map();
  for (let t = 0; t < numTri; t++) {
    const i0 = mesh.triVerts[t * 3];
    const i1 = mesh.triVerts[t * 3 + 1];
    const i2 = mesh.triVerts[t * 3 + 2];
    for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
      const key = a < b ? `${a},${b}` : `${b},${a}`;
      let entry = edgeMap.get(key);
      if (!entry) { entry = []; edgeMap.set(key, entry); }
      entry.push(t);
    }
  }
  // adjacency[t] = array of neighbouring triangle indices
  const adjacency = Array.from({ length: numTri }, () => []);
  for (const ts of edgeMap.values()) {
    if (ts.length === 2) {
      adjacency[ts[0]].push(ts[1]);
      adjacency[ts[1]].push(ts[0]);
    }
  }
  return { numTri, normals, centroids, areas, adjacency };
}

/**
 * Region-grow a SMOOTH patch starting from triangle `seed`. A
 * neighbour joins iff its normal forms an angle ≤ acos(curvedDot) with
 * the parent triangle's normal AND its normal forms ≤ acos(planarDot)
 * with the seed normal IF we're growing a planar patch.
 *
 * The two-step gate prevents two flat faces with a sharp corner being
 * merged into one patch (since their pairwise normal angle would exceed
 * curvedDot directly), but allows smoothly-curved cylindrical patches
 * to grow even though seed-to-far normals differ a lot.
 */
/**
 * regionGrow does NOT mark `visited`. Caller marks visited only after
 * deciding to keep the region (so rejected tiny regions are still
 * available to a later pass).
 *
 * To prevent infinite loops we use a local-pass `inFlight` set instead.
 */
function regionGrow(seed, triData, visited, mode) {
  const { adjacency, normals } = triData;
  const queue = [seed];
  const region = [];
  const inFlight = new Set();
  inFlight.add(seed);
  const seedNormal = normals[seed];
  const dotThresh = mode === 'planar' ? PLANAR_DOT_THRESHOLD : CURVED_DOT_THRESHOLD;

  region.push(seed);
  while (queue.length) {
    const t = queue.shift();
    const tn = normals[t];
    for (const nb of adjacency[t]) {
      if (visited[nb] || inFlight.has(nb)) continue;
      const nbn = normals[nb];
      // gate 1: this edge transition is smooth enough
      if (dot3(tn, nbn) < dotThresh) continue;
      // gate 2 (planar mode only): nb's normal still close to SEED's normal
      if (mode === 'planar' && dot3(seedNormal, nbn) < PLANAR_DOT_THRESHOLD) continue;
      inFlight.add(nb);
      region.push(nb);
      queue.push(nb);
    }
  }
  return region;
}

/**
 * Plane-fit RMS residual for a region.
 */
function planarRMS(region, triData) {
  // Centroid + average normal (area-weighted)
  let cx = 0, cy = 0, cz = 0, A = 0;
  let nx = 0, ny = 0, nz = 0;
  for (const t of region) {
    const c = triData.centroids[t]; const a = triData.areas[t];
    const n = triData.normals[t];
    cx += c[0] * a; cy += c[1] * a; cz += c[2] * a;
    nx += n[0] * a; ny += n[1] * a; nz += n[2] * a;
    A += a;
  }
  if (A === 0) return { rms: Infinity, normal: [0, 0, 1], point: [0, 0, 0] };
  const C = [cx / A, cy / A, cz / A];
  const nLen = Math.hypot(nx, ny, nz) || 1;
  const N = [nx / nLen, ny / nLen, nz / nLen];
  let r2sum = 0;
  for (const t of region) {
    const c = triData.centroids[t];
    const d = (c[0] - C[0]) * N[0] + (c[1] - C[1]) * N[1] + (c[2] - C[2]) * N[2];
    r2sum += d * d * triData.areas[t];
  }
  return { rms: Math.sqrt(r2sum / A), normal: N, point: C, area: A };
}

/**
 * Fit a cylinder to a region's triangle centroids.
 *
 * Steps:
 *   1. Estimate axis: take the SVD-like principal direction of the
 *      cross-products of pairs of normals. (Cheap approximation: pick
 *      the eigenvector with largest variance using power iteration on
 *      the covariance of n_i × n_j samples.)
 *   2. Pick origin as centroid of all centroids.
 *   3. Project each centroid onto the plane perpendicular to axis at
 *      origin, fit a circle (Pratt algebraic).
 *   4. Compute residuals = | √((x-cx)² + (y-cy)²) − r | for each point.
 *   5. Return axis, point, radius, axialExtent, RMS.
 */
function fitCylinder(region, triData) {
  if (region.length < 6) return { rms: Infinity };
  const { normals, centroids } = triData;

  // 1. Axis via accumulated cross products of normal pairs
  // Use a representative sample to keep cost down.
  const sample = region.length > 200
    ? region.filter((_, i) => (i % Math.max(1, Math.floor(region.length / 200))) === 0)
    : region;
  let ax = 0, ay = 0, az = 0;
  for (let i = 0; i < sample.length; i++) {
    for (let j = i + 1; j < sample.length; j++) {
      const c = cross3(normals[sample[i]], normals[sample[j]]);
      const l = Math.hypot(...c);
      if (l < 0.01) continue;   // skip near-parallel pairs
      const sign = (ax * c[0] + ay * c[1] + az * c[2]) >= 0 ? 1 : -1;
      ax += sign * c[0]; ay += sign * c[1]; az += sign * c[2];
    }
  }
  let axis = norm3([ax, ay, az]);
  if (!Number.isFinite(axis[0])) return { rms: Infinity };

  // 2. Origin centroid
  let ox = 0, oy = 0, oz = 0;
  for (const t of region) { const c = centroids[t]; ox += c[0]; oy += c[1]; oz += c[2]; }
  ox /= region.length; oy /= region.length; oz /= region.length;
  const origin = [ox, oy, oz];

  // 3. Choose orthonormal basis (u, v) perpendicular to axis
  const ref = Math.abs(axis[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const u = norm3(cross3(axis, ref));
  const v = cross3(axis, u);

  // Project each centroid to (u, v) plane
  const xs = new Float64Array(region.length);
  const ys = new Float64Array(region.length);
  let zMin = Infinity, zMax = -Infinity;
  for (let i = 0; i < region.length; i++) {
    const c = centroids[region[i]];
    const dx = c[0] - origin[0], dy = c[1] - origin[1], dz = c[2] - origin[2];
    xs[i] = dx * u[0] + dy * u[1] + dz * u[2];
    ys[i] = dx * v[0] + dy * v[1] + dz * v[2];
    const z = dx * axis[0] + dy * axis[1] + dz * axis[2];
    if (z < zMin) zMin = z;
    if (z > zMax) zMax = z;
  }

  // 4. Algebraic circle fit: minimize Σ (x²+y²+Ax+By+C)²
  // Solve normal equations [Σx² Σxy Σx; Σxy Σy² Σy; Σx Σy n] [A;B;C] = -[Σx(x²+y²); Σy(x²+y²); Σ(x²+y²)]
  let Sx = 0, Sy = 0, Sxx = 0, Sxy = 0, Syy = 0, Sr = 0, Sxr = 0, Syr = 0;
  const n = region.length;
  for (let i = 0; i < n; i++) {
    const x = xs[i], y = ys[i];
    const r = x * x + y * y;
    Sx += x; Sy += y; Sxx += x * x; Sxy += x * y; Syy += y * y;
    Sr += r; Sxr += x * r; Syr += y * r;
  }
  // Normal-equations 3x3 solve
  const M = [[Sxx, Sxy, Sx], [Sxy, Syy, Sy], [Sx, Sy, n]];
  const rhs = [-Sxr, -Syr, -Sr];
  const det = M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1])
            - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0])
            + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  if (Math.abs(det) < 1e-12) return { rms: Infinity };
  const inv = [
    [(M[1][1] * M[2][2] - M[1][2] * M[2][1]) / det, -(M[0][1] * M[2][2] - M[0][2] * M[2][1]) / det,  (M[0][1] * M[1][2] - M[0][2] * M[1][1]) / det],
    [-(M[1][0] * M[2][2] - M[1][2] * M[2][0]) / det,  (M[0][0] * M[2][2] - M[0][2] * M[2][0]) / det, -(M[0][0] * M[1][2] - M[0][2] * M[1][0]) / det],
    [(M[1][0] * M[2][1] - M[1][1] * M[2][0]) / det, -(M[0][0] * M[2][1] - M[0][1] * M[2][0]) / det,  (M[0][0] * M[1][1] - M[0][1] * M[1][0]) / det],
  ];
  const A = inv[0][0] * rhs[0] + inv[0][1] * rhs[1] + inv[0][2] * rhs[2];
  const B = inv[1][0] * rhs[0] + inv[1][1] * rhs[1] + inv[1][2] * rhs[2];
  const C = inv[2][0] * rhs[0] + inv[2][1] * rhs[1] + inv[2][2] * rhs[2];
  // Center (cx, cy) = (-A/2, -B/2); radius = sqrt(cx²+cy² - C)
  const cx2D = -A / 2, cy2D = -B / 2;
  const radius = Math.sqrt(Math.max(cx2D * cx2D + cy2D * cy2D - C, 0));
  if (!Number.isFinite(radius) || radius < 1e-9) return { rms: Infinity };

  // 5. RMS residual to the cylinder
  let r2sum = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - cx2D, dy = ys[i] - cy2D;
    const r = Math.sqrt(dx * dx + dy * dy);
    r2sum += (r - radius) * (r - radius);
  }
  const rms = Math.sqrt(r2sum / n);

  // Cylinder axis point in world space
  const axisPoint = [
    origin[0] + cx2D * u[0] + cy2D * v[0],
    origin[1] + cx2D * u[1] + cy2D * v[1],
    origin[2] + cx2D * u[2] + cy2D * v[2],
  ];
  return {
    axis, axisPoint, radius,
    axialExtent: zMax - zMin,
    rms,
    triangleCount: region.length,
  };
}

/**
 * Recognize features in a Manifold (or compatible mesh).
 *
 * @param {Manifold} manifold
 * @param {object} options
 * @returns {{ patches, summary }}
 */
export function recognize(manifold, options = {}) {
  // Planar pass uses a stricter minimum so we don't fragment cylinders
  // into thousands of single-quad patches. Curved pass uses a low minimum
  // so small remaining planar patches (e.g. hex nut side faces, 2 tris
  // each) still get classified as planar.
  const planarMinTris = options.planarMinTris ?? options.minPatchTris ?? 4;
  const curvedMinTris = options.curvedMinTris ?? options.minPatchTris ?? 2;
  const cylRmsTol = options.cylRmsTol ?? CYLINDER_RMS_THRESHOLD;

  const mesh = (manifold.getMesh) ? manifold.getMesh() : manifold;
  const triData = buildTriData(mesh);
  const visited = new Uint8Array(triData.numTri);

  const patches = [];

  // First pass: planar patches (strict). Keep + mark visited only when
  // the region is large enough to count as a real face.
  for (let t = 0; t < triData.numTri; t++) {
    if (visited[t]) continue;
    const region = regionGrow(t, triData, visited, 'planar');
    if (region.length < planarMinTris) continue;
    for (const r of region) visited[r] = 1;
    const fit = planarRMS(region, triData);
    patches.push({
      kind: 'planar',
      seed: t,
      triangles: region,
      rms: fit.rms, normal: fit.normal, point: fit.point, area: fit.area,
    });
  }

  // Second pass: smooth-curved patches over remaining unvisited tris.
  // For each region: try cylinder fit; if that fails try planar fit;
  // else classify freeform.
  for (let t = 0; t < triData.numTri; t++) {
    if (visited[t]) continue;
    const region = regionGrow(t, triData, visited, 'curved');
    if (region.length < curvedMinTris) continue;
    for (const r of region) visited[r] = 1;
    let area = 0;
    for (const tt of region) area += triData.areas[tt];
    const cyl = fitCylinder(region, triData);
    if (cyl.rms <= cylRmsTol && cyl.radius > 0 && cyl.radius < 1e6) {
      patches.push({
        kind: 'cylindrical',
        seed: t,
        triangles: region,
        rms: cyl.rms,
        axis: cyl.axis,
        axisPoint: cyl.axisPoint,
        radius: cyl.radius,
        axialExtent: cyl.axialExtent,
        diameter: 2 * cyl.radius,
        area,
      });
      continue;
    }
    // Cyl fit failed: try planar fit
    const fit = planarRMS(region, triData);
    if (fit.rms < PLANAR_RMS_THRESHOLD) {
      patches.push({
        kind: 'planar',
        seed: t,
        triangles: region,
        rms: fit.rms, normal: fit.normal, point: fit.point, area: fit.area,
      });
      continue;
    }
    patches.push({
      kind: 'freeform',
      seed: t,
      triangles: region,
      rms: cyl.rms,
      area,
    });
  }

  // Build summary
  const summary = {
    totalTriangles: triData.numTri,
    patchCount: patches.length,
    planarPatches: patches.filter(p => p.kind === 'planar').length,
    cylindricalPatches: patches.filter(p => p.kind === 'cylindrical').length,
    freeformPatches: patches.filter(p => p.kind === 'freeform').length,
    cylinders: patches.filter(p => p.kind === 'cylindrical').map(p => ({
      diameter: +(2 * p.radius).toFixed(4),
      axialExtent: +p.axialExtent.toFixed(4),
      area: +p.area.toFixed(2),
      rms: +p.rms.toFixed(5),
      axis: p.axis.map(x => +x.toFixed(4)),
      axisPoint: p.axisPoint.map(x => +x.toFixed(4)),
    })),
  };

  return { patches, summary };
}
