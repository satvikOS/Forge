/**
 * ArchDisc Foundation — Pattern features (linear, circular, mirror).
 *
 * Industry-standard CAD patterning operations, all routed through
 * manifold-3d's robust booleans:
 *
 *   linearPattern(body, direction, count, spacing)
 *     → N copies translated by k·spacing·direction (k = 0..N-1)
 *
 *   linearPattern2D(body, dir1, n1, s1, dir2, n2, s2)
 *     → grid of n1 × n2 copies (e.g. bolt-hole pattern)
 *
 *   circularPattern({body, axis, anchor, count, totalAngle?})
 *     → N copies rotated by k·dθ around an arbitrary axis through
 *       anchor. Default totalAngle = 2π = full revolution.
 *
 *   mirror(body, planeNormal, planeOrigin?)
 *     → reflection of body across the plane (origin + normal)
 *
 *   mirrorAndUnion(body, planeNormal, planeOrigin?)
 *     → original ∪ mirrored — symmetric-part construction.
 *
 * Implementation uses manifold-3d's high-level transformation
 * primitives (translate / rotate / mirror) for axis-aligned cases,
 * and the raw 12-element column-major affine for arbitrary axis
 * rotation (built by composing translate-rotate-translate to keep
 * each step's matrix simple and verifiable).
 */

const EPS = 1e-12;

function vnorm(a) {
  const L = Math.hypot(a[0], a[1], a[2]);
  if (L < EPS) throw new Error('Zero vector');
  return [a[0] / L, a[1] / L, a[2] / L];
}

function vdot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function vcross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Translate by k·spacing·direction.
 */
export async function linearPattern(body, direction, count, spacing) {
  if (count < 1) throw new Error('Pattern count must be >= 1');
  if (count === 1) return body;
  const dir = vnorm(direction);
  let acc = body;
  for (let k = 1; k < count; k++) {
    const tx = dir[0] * k * spacing;
    const ty = dir[1] * k * spacing;
    const tz = dir[2] * k * spacing;
    acc = acc.add(body.translate([tx, ty, tz]));
  }
  return acc;
}

/**
 * Two-axis grid pattern (bolt-hole pattern, façade panels, etc.).
 */
export async function linearPattern2D(body, dir1, n1, s1, dir2, n2, s2) {
  if (n1 < 1 || n2 < 1) throw new Error('Pattern counts must be >= 1');
  const u = vnorm(dir1), v = vnorm(dir2);
  let acc = body;
  for (let i = 0; i < n1; i++) {
    for (let j = 0; j < n2; j++) {
      if (i === 0 && j === 0) continue;
      const tx = u[0] * i * s1 + v[0] * j * s2;
      const ty = u[1] * i * s1 + v[1] * j * s2;
      const tz = u[2] * i * s1 + v[2] * j * s2;
      acc = acc.add(body.translate([tx, ty, tz]));
    }
  }
  return acc;
}

/**
 * Rotate around an arbitrary axis through a given anchor point.
 *
 * Decomposition (avoids hand-built affine layout issues):
 *
 *   1. translate by -anchor    (move axis through origin)
 *   2. rotate-to-Z so axis aligns with +Z
 *   3. rotate by k·dθ about world Z
 *   4. rotate-from-Z (inverse of step 2)
 *   5. translate by +anchor
 *
 * In manifold-3d terms each step is a single primitive call, so the
 * whole pipeline is verifiable. For the common case where axis is
 * already +Z (impellers, fan blades) steps 2/4 are skipped.
 */
export async function circularPattern({ body, axis, anchor = [0, 0, 0], count, totalAngle = 2 * Math.PI }) {
  if (count < 1) throw new Error('Pattern count must be >= 1');
  if (count === 1) return body;
  const ax = vnorm(axis);
  const dThetaDeg = (totalAngle / count) * (180 / Math.PI);

  // Determine alignment from ax to +Z
  const alignDeg = computeAlignToZ(ax);   // {axis: [x,y,z], deg}
  const negAlign = alignDeg ? { axis: alignDeg.axis, deg: -alignDeg.deg } : null;

  let acc = body;
  for (let k = 1; k < count; k++) {
    let copy = body;
    // step 1
    copy = copy.translate([-anchor[0], -anchor[1], -anchor[2]]);
    // step 2 (only if axis isn't already +Z)
    if (alignDeg) copy = rotateAboutAxis(copy, alignDeg.axis, alignDeg.deg);
    // step 3: rotate about Z
    copy = rotateAboutAxis(copy, [0, 0, 1], k * dThetaDeg);
    // step 4
    if (negAlign) copy = rotateAboutAxis(copy, negAlign.axis, negAlign.deg);
    // step 5
    copy = copy.translate([anchor[0], anchor[1], anchor[2]]);
    acc = acc.add(copy);
  }
  return acc;
}

/**
 * Compute (axis, angleDeg) needed to rotate a unit vector `v` to +Z.
 * Returns null if v already equals +Z (no rotation needed).
 * If v is -Z, returns a 180° rotation about the X axis.
 */
function computeAlignToZ(v) {
  const z = [0, 0, 1];
  const cosA = vdot(v, z);
  if (cosA > 1 - 1e-9) return null;          // already +Z
  if (cosA < -1 + 1e-9) return { axis: [1, 0, 0], deg: 180 };
  const ax = vcross(v, z);
  const axLen = Math.hypot(ax[0], ax[1], ax[2]);
  const axN = [ax[0] / axLen, ax[1] / axLen, ax[2] / axLen];
  const ang = Math.acos(Math.max(-1, Math.min(1, cosA))) * 180 / Math.PI;
  return { axis: axN, deg: ang };
}

/**
 * Rotate a manifold body about an arbitrary axis through the origin
 * by an angle in degrees. Implemented as Euler-XYZ via manifold's
 * built-in `rotate(deg, deg, deg)` only when the axis is one of the
 * world axes; otherwise the rotation is decomposed into two
 * world-axis rotations using a tilt frame.
 *
 * For arbitrary axes we use this identity:
 *   R(axis, θ) = Rz(α) Ry(β) Rz(θ) Ry(-β) Rz(-α)
 * where (α, β) are the spherical coords of the axis.
 */
function rotateAboutAxis(body, axis, deg) {
  const ax = vnorm(axis);
  // Common cases — single-axis rotations
  if (Math.abs(ax[0] - 1) < 1e-9) return body.rotate([deg, 0, 0]);
  if (Math.abs(ax[0] + 1) < 1e-9) return body.rotate([-deg, 0, 0]);
  if (Math.abs(ax[1] - 1) < 1e-9) return body.rotate([0, deg, 0]);
  if (Math.abs(ax[1] + 1) < 1e-9) return body.rotate([0, -deg, 0]);
  if (Math.abs(ax[2] - 1) < 1e-9) return body.rotate([0, 0, deg]);
  if (Math.abs(ax[2] + 1) < 1e-9) return body.rotate([0, 0, -deg]);
  // General axis: spherical-decomposition method
  const beta = Math.acos(Math.max(-1, Math.min(1, ax[2]))) * 180 / Math.PI;
  const alpha = Math.atan2(ax[1], ax[0]) * 180 / Math.PI;
  return body
    .rotate([0, 0, -alpha])
    .rotate([0, -beta, 0])
    .rotate([0, 0, deg])
    .rotate([0, beta, 0])
    .rotate([0, 0, alpha]);
}

/**
 * Reflect across a plane defined by (origin, normal). Uses
 * manifold-3d's built-in `mirror([nx, ny, nz])` (which mirrors
 * through a plane THROUGH THE ORIGIN), composed with a translate
 * step so we can mirror across an arbitrary-position plane.
 */
export async function mirror(body, planeNormal, planeOrigin = [0, 0, 0]) {
  const n = vnorm(planeNormal);
  // Translate plane to origin → mirror → translate back
  const t = planeOrigin;
  return body
    .translate([-t[0], -t[1], -t[2]])
    .mirror([n[0], n[1], n[2]])
    .translate([t[0], t[1], t[2]]);
}

/** Mirror + union with original — symmetric-part construction. */
export async function mirrorAndUnion(body, planeNormal, planeOrigin = [0, 0, 0]) {
  const m = await mirror(body, planeNormal, planeOrigin);
  return body.add(m);
}
