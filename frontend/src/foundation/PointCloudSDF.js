/**
 * PointCloudSDF — direct point-cloud → watertight Manifold via signed
 * distance field. Bypasses the marching-cubes-then-repair pipeline in
 * PointCloudRecon.js, which produces meshes that are NOT generally
 * 2-manifold (the kernel rejects them as "Not manifold"). Instead, we
 * define an SDF that's positive inside a thick tube around the points
 * and feed it to Manifold.levelSet — that op is guaranteed to produce
 * a closed manifold by construction.
 *
 * Algorithm:
 *   thicknessR = thickness of the "tube" wrapped around the points
 *   sdf(q)     = thicknessR − nearestPointDistance(q)
 *                (positive inside the tube, negative outside —
 *                Manifold.levelSet's "positive = inside" convention)
 *
 * Honest about scope:
 *   - This is a CRUDE reverse engineering — the reconstructed surface
 *     is offset from the true surface by ~thicknessR / 2. Volumes
 *     inflate by ~thicknessR · surface_area.
 *   - For thin shells (cylinder lateral, sphere) this gives a thick
 *     shell instead of a solid. To recover the SOLID interior, the
 *     SDF would need to know "inside" vs "outside"; that's exactly
 *     what Hoppe-style oriented-normal SDF gives.
 *   - This pipeline still demonstrates the scan-to-CAD value
 *     proposition end-to-end: noisy scan input → watertight kernel-
 *     ready solid → ready for booleans / FEA / printing.
 *
 * Performance: brute-force nearest-point is O(N · K) where N = sample
 * points and K = levelSet grid samples. For 4 k samples and a 20³ grid
 * that's 32 M distance evaluations — ~100 ms on a modern Mac. A spatial
 * hash gets it down to ~5 ms; not worth the code complexity for the
 * first slice.
 */

const EPS = 1e-9;

/**
 * Build a SDF function suitable for Manifold.levelSet from a flat
 * point cloud + a thickness radius. The returned closure captures the
 * points directly; the caller is responsible for keeping them alive.
 *
 * @param {Float32Array} points flat [x0,y0,z0, x1,…] in mm
 * @param {number}       thicknessR  half-thickness of the wrapped tube (mm)
 */
export function pointCloudSDF(points, thicknessR) {
  const N = points.length / 3;
  if (!(thicknessR > 0)) throw new Error('pointCloudSDF: thicknessR must be > 0');
  if (N === 0) throw new Error('pointCloudSDF: empty point cloud');
  // Bucket the points into a coarse grid so per-query distance search
  // is O(local-bucket). Cell size = 2·thicknessR so any query within
  // thicknessR of a point lands in an adjacent cell.
  const cell = Math.max(thicknessR * 2, EPS);
  let xmin = Infinity, ymin = Infinity, zmin = Infinity;
  let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
  for (let i = 0; i < N; i++) {
    const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    if (z < zmin) zmin = z; if (z > zmax) zmax = z;
  }
  const nx = Math.max(1, Math.ceil((xmax - xmin) / cell) + 1);
  const ny = Math.max(1, Math.ceil((ymax - ymin) / cell) + 1);
  const nz = Math.max(1, Math.ceil((zmax - zmin) / cell) + 1);
  const buckets = new Array(nx * ny * nz).fill(null);
  const bIdx = (i, j, k) => i + j * nx + k * nx * ny;
  for (let i = 0; i < N; i++) {
    const bx = Math.min(nx - 1, Math.max(0, Math.floor((points[i * 3]     - xmin) / cell)));
    const by = Math.min(ny - 1, Math.max(0, Math.floor((points[i * 3 + 1] - ymin) / cell)));
    const bz = Math.min(nz - 1, Math.max(0, Math.floor((points[i * 3 + 2] - zmin) / cell)));
    const k = bIdx(bx, by, bz);
    if (buckets[k] === null) buckets[k] = [];
    buckets[k].push(i);
  }
  // BBox + tube margin: anything farther than thicknessR outside the
  // point bbox is necessarily outside, so we can short-circuit.
  const margin = thicknessR + 1e-6;
  const bxmin = xmin - margin, bxmax = xmax + margin;
  const bymin = ymin - margin, bymax = ymax + margin;
  const bzmin = zmin - margin, bzmax = zmax + margin;

  return function sdf(p) {
    const qx = p[0], qy = p[1], qz = p[2];
    if (qx < bxmin || qx > bxmax || qy < bymin || qy > bymax || qz < bzmin || qz > bzmax) {
      return -margin;                                          // far outside
    }
    const bx = Math.min(nx - 1, Math.max(0, Math.floor((qx - xmin) / cell)));
    const by = Math.min(ny - 1, Math.max(0, Math.floor((qy - ymin) / cell)));
    const bz = Math.min(nz - 1, Math.max(0, Math.floor((qz - zmin) / cell)));
    let best = Infinity;
    for (let ii = Math.max(0, bx - 1); ii <= Math.min(nx - 1, bx + 1); ii++) {
      for (let jj = Math.max(0, by - 1); jj <= Math.min(ny - 1, by + 1); jj++) {
        for (let kk = Math.max(0, bz - 1); kk <= Math.min(nz - 1, bz + 1); kk++) {
          const bucket = buckets[bIdx(ii, jj, kk)];
          if (!bucket) continue;
          for (const idx of bucket) {
            const dx = points[idx * 3]     - qx;
            const dy = points[idx * 3 + 1] - qy;
            const dz = points[idx * 3 + 2] - qz;
            const d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < best) best = d2;
          }
        }
      }
    }
    if (best === Infinity) return -margin;                     // no point in 3×3×3 buckets
    return thicknessR - Math.sqrt(best);                       // + inside tube, − outside
  };
}

/** Return the axis-aligned bounding box of a point cloud, padded by `pad`. */
export function pointCloudBBox(points, pad = 0) {
  const N = points.length / 3;
  let xmin = Infinity, ymin = Infinity, zmin = Infinity;
  let xmax = -Infinity, ymax = -Infinity, zmax = -Infinity;
  for (let i = 0; i < N; i++) {
    const x = points[i * 3], y = points[i * 3 + 1], z = points[i * 3 + 2];
    if (x < xmin) xmin = x; if (x > xmax) xmax = x;
    if (y < ymin) ymin = y; if (y > ymax) ymax = y;
    if (z < zmin) zmin = z; if (z > zmax) zmax = z;
  }
  return {
    min: [xmin - pad, ymin - pad, zmin - pad],
    max: [xmax + pad, ymax + pad, zmax + pad],
  };
}
