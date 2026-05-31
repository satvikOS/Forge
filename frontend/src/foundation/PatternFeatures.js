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

// manifold-3d objects hold WASM heap memory and are NOT freed by JS
// GC promptly. A pattern that arrays hundreds of copies must dispose
// every intermediate (`.delete()`) or the kernel heap exhausts
// ("RuntimeError: table index out of bounds"). `body` belongs to the
// caller and is never deleted here; every manifold WE create is.
const drop = (m) => { if (m && typeof m.delete === 'function') m.delete(); };

/**
 * Translate by k·spacing·direction.
 */
export async function linearPattern(body, direction, count, spacing) {
  if (count < 1) throw new Error('Pattern count must be >= 1');
  if (count === 1) return body;
  const dir = vnorm(direction);
  let acc = body;
  for (let k = 1; k < count; k++) {
    const copy = body.translate([dir[0] * k * spacing, dir[1] * k * spacing, dir[2] * k * spacing]);
    const next = acc.add(copy);
    drop(copy);
    if (acc !== body) drop(acc);
    acc = next;
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
      const copy = body.translate([
        u[0] * i * s1 + v[0] * j * s2,
        u[1] * i * s1 + v[1] * j * s2,
        u[2] * i * s1 + v[2] * j * s2,
      ]);
      const next = acc.add(copy);
      drop(copy);
      if (acc !== body) drop(acc);
      acc = next;
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

  const hasAnchor = anchor[0] !== 0 || anchor[1] !== 0 || anchor[2] !== 0;
  let acc = body;
  for (let k = 1; k < count; k++) {
    // Build the k-th copy through the transform pipeline, disposing
    // each intermediate. `cur` starts as the caller's `body` (never
    // deleted); `curOwned` marks once `cur` is an intermediate we made.
    let cur = body, curOwned = false;
    const apply = (fn) => {
      const next = fn(cur);
      if (curOwned) drop(cur);
      cur = next; curOwned = true;
    };
    if (hasAnchor) apply((m) => m.translate([-anchor[0], -anchor[1], -anchor[2]]));
    if (alignDeg) apply((m) => rotateAboutAxis(m, alignDeg.axis, alignDeg.deg));
    apply((m) => rotateAboutAxis(m, [0, 0, 1], k * dThetaDeg));
    if (negAlign) apply((m) => rotateAboutAxis(m, negAlign.axis, negAlign.deg));
    if (hasAnchor) apply((m) => m.translate([anchor[0], anchor[1], anchor[2]]));
    // `cur` is the finished copy (curOwned === true — the Z rotate ran).
    const next = acc.add(cur);
    drop(cur);
    if (acc !== body) drop(acc);
    acc = next;
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
  // General axis: spherical-decomposition method. Chain five rotations,
  // disposing each intermediate; the caller's `body` is left intact.
  const beta = Math.acos(Math.max(-1, Math.min(1, ax[2]))) * 180 / Math.PI;
  const alpha = Math.atan2(ax[1], ax[0]) * 180 / Math.PI;
  let m = body.rotate([0, 0, -alpha]);
  let n = m.rotate([0, -beta, 0]); drop(m);
  m = n.rotate([0, 0, deg]); drop(n);
  n = m.rotate([0, beta, 0]); drop(m);
  m = n.rotate([0, 0, alpha]); drop(n);
  return m;
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
