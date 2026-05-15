/**
 * ArchDisc Foundation — pure 2D polygon geometry.
 *
 * Kernel-free (no manifold-3d / WASM dependency) so it can be unit-
 * tested in plain Node and reused anywhere. EdgeFillet imports the
 * fillet routine here for its extrude variant.
 */

/**
 * Fillet the corners of a closed 2D polygon with constant-radius
 * circular arcs tangent to both adjacent edges. Works on any
 * profile — convex or concave (L-bracket, gear root, plate).
 *
 * For a corner with interior angle θ between the two edges:
 *   • tangent set-back along each edge:  t = r / tan(θ/2)
 *   • arc-centre offset from the vertex: d = r / sin(θ/2)
 * The radius auto-clamps so a fillet never overruns half of
 * either adjacent edge.
 *
 * @param {Array<[number,number]>} points  closed polygon (no repeat)
 * @param {number} radius                  nominal fillet radius
 * @param {number} arcSegs                 line segments per arc
 * @returns {{ points: Array<[number,number]>, filletedCorners: number }}
 */
export function filletPolygon2D(points, radius, arcSegs = 8) {
  const n = points.length;
  if (n < 3 || radius <= 0) return { points: points.slice(), filletedCorners: 0 };
  const out = [];
  let filleted = 0;

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const cur  = points[i];
    const next = points[(i + 1) % n];

    // Edge unit vectors pointing AWAY from the corner.
    let i1x = prev[0] - cur[0], i1y = prev[1] - cur[1];
    let i2x = next[0] - cur[0], i2y = next[1] - cur[1];
    const l1 = Math.hypot(i1x, i1y), l2 = Math.hypot(i2x, i2y);
    if (l1 < 1e-9 || l2 < 1e-9) { out.push([cur[0], cur[1]]); continue; }
    i1x /= l1; i1y /= l1; i2x /= l2; i2y /= l2;

    let cosT = i1x * i2x + i1y * i2y;
    cosT = Math.max(-1, Math.min(1, cosT));
    const theta = Math.acos(cosT);
    if (theta > Math.PI - 1e-3 || theta < 1e-3) { out.push([cur[0], cur[1]]); continue; }

    const half = theta / 2;
    let t = radius / Math.tan(half);
    t = Math.min(t, l1 / 2, l2 / 2);
    const rEff = t * Math.tan(half);
    const d = rEff / Math.sin(half);

    const tp1 = [cur[0] + i1x * t, cur[1] + i1y * t];
    const tp2 = [cur[0] + i2x * t, cur[1] + i2y * t];
    let bx = i1x + i2x, by = i1y + i2y;
    const bl = Math.hypot(bx, by) || 1;
    bx /= bl; by /= bl;
    const cx = cur[0] + bx * d, cy = cur[1] + by * d;

    let a1 = Math.atan2(tp1[1] - cy, tp1[0] - cx);
    const a2 = Math.atan2(tp2[1] - cy, tp2[0] - cx);
    let da = a2 - a1;
    while (da >  Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    for (let s = 0; s <= arcSegs; s++) {
      const a = a1 + da * (s / arcSegs);
      out.push([cx + Math.cos(a) * rEff, cy + Math.sin(a) * rEff]);
    }
    filleted++;
  }
  return { points: out, filletedCorners: filleted };
}

/**
 * Chamfer the corners of a closed 2D polygon — replace each sharp
 * vertex with a straight cut between two set-back points, `dist`
 * back along each adjacent edge. Auto-clamps to half the shorter
 * edge. Works on convex and concave corners alike.
 *
 * @param {Array<[number,number]>} points  closed polygon
 * @param {number} dist                    chamfer set-back
 * @returns {{ points: Array<[number,number]>, chamferedCorners: number }}
 */
export function chamferPolygon2D(points, dist) {
  const n = points.length;
  if (n < 3 || dist <= 0) return { points: points.slice(), chamferedCorners: 0 };
  const out = [];
  let chamfered = 0;
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const cur  = points[i];
    const next = points[(i + 1) % n];
    let i1x = prev[0] - cur[0], i1y = prev[1] - cur[1];
    let i2x = next[0] - cur[0], i2y = next[1] - cur[1];
    const l1 = Math.hypot(i1x, i1y), l2 = Math.hypot(i2x, i2y);
    if (l1 < 1e-9 || l2 < 1e-9) { out.push([cur[0], cur[1]]); continue; }
    i1x /= l1; i1y /= l1; i2x /= l2; i2y /= l2;
    let cosT = i1x * i2x + i1y * i2y;
    cosT = Math.max(-1, Math.min(1, cosT));
    const theta = Math.acos(cosT);
    if (theta > Math.PI - 1e-3 || theta < 1e-3) { out.push([cur[0], cur[1]]); continue; }
    const t = Math.min(dist, l1 / 2, l2 / 2);
    out.push([cur[0] + i1x * t, cur[1] + i1y * t]);
    out.push([cur[0] + i2x * t, cur[1] + i2y * t]);
    chamfered++;
  }
  return { points: out, chamferedCorners: chamfered };
}

/** Signed area of a 2D polygon (shoelace). Positive = CCW. */
export function polygonArea(points) {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}
