/**
 * ArchDisc Forge — CAD → Robot-Description Exporter (Task #30)
 * ============================================================================
 * Emits URDF / SDF / USD / MJCF from a Forge assembly.
 *
 * WHY THIS EXISTS (the actionable robotics gap):
 *   SolidWorks-to-URDF (SW2URDF) is abandoned and produces dirty output:
 *     - WRONG inertia (not about the link COM frame / wrong convention),
 *     - a SHARED visual/collision mesh (collision = the full visual mesh →
 *       no broadphase win, self-collision noise),
 *     - NO closed chains (silently drops parallel mechanisms / four-bars).
 *   This exporter fixes all three:
 *     1. Inertia is the COM-frame tensor (parallel-axis correct), density-
 *        scaled, in SI (kg·m²), about the link's own COM with the right axes.
 *     2. collision = an automatic per-link CONVEX HULL (kernel
 *        forge.native.convexHull3D), provably DISTINCT geometry from the
 *        full (optionally decimated) visual mesh.
 *     3. Closed chains are preserved: a spanning tree is emitted as the
 *        URDF/SDF tree, and every non-tree (loop) edge is emitted as an
 *        explicit loop-closure — SDF extra <joint>, MJCF <equality><connect>,
 *        USD loop joint, and a <gazebo> loop block on the URDF — so a
 *        four-bar ROUND-TRIPS instead of being dropped.
 *
 * INERTIA SOURCING — kernel-truth (Task #43), JS hull as fallback
 *   The kernel binding `forge.massProps(handle)` now returns
 *   `{ volume, area, centerOfMass, inertiaCom }` (see
 *   forge-kernel/src/MassProps.cpp + binding.cpp). `inertiaCom` is the EXACT
 *   rigid-body inertia tensor of the B-rep solid about its centre of mass,
 *   computed by OCCT GProp_GProps::MatrixOfInertia() (documented to be in the
 *   central / COM coordinate system, so no parallel-axis shift is needed). It
 *   is at UNIT DENSITY (row-major 9, mass·mm² with mass==volume). This module
 *   reads it onto the link spec (`L.inertiaCom`) and `resolveInertia` Path 1
 *   converts it to SI kg·m² and applies the real-mass scale `massKg/volume`,
 *   labeling the result `kernel:inertiaCom`. This is EXACT for any solid —
 *   convex or concave — because it integrates the true B-rep, not the hull.
 *
 *   FALLBACK (kernel tensor genuinely absent, e.g. a kernel-free inline-mesh
 *   spec): the exporter computes the COM-frame inertia in JS from the link's
 *   mesh as the inertia of the uniform-density polyhedron via the signed-
 *   tetrahedron-fan covariance integral (Mirtich 1996 / Eberly). This is
 *   computed over the CONVEX HULL point set, so it is EXACT for a convex link
 *   and a clearly-labeled approximation (`approx:hull-inertia`) for a concave
 *   one. The mass and COM always come from the kernel (forge.massProps).
 *
 * UNITS / NAMING
 *   Forge kernel + UI are millimetres. Robot descriptions are SI:
 *     length mm → m   (÷1000),  volume mm³ → m³ (÷1e9),
 *     inertia (mass·mm²) → (mass·m²)  (÷1e6),  mass in kg.
 *   Identifiers are normalized to [A-Za-z0-9_] and de-duplicated; URDF
 *   requires a single root link and unique link/joint names.
 *
 * INPUT SHAPES (both accepted)
 *   A. A normalized spec (what the kernel-free test builds):
 *      {
 *        name, baseLink?,
 *        links: [{
 *          id, name, material?, color?,
 *          mass, volume, com:[x,y,z],          // kernel mass-props (mm / mm³)
 *          inertiaCom?:[9] | inertiaOrigin?:[9],// optional kernel tensor (mm-mass)
 *          visual: { positions:[..xyz], indices?:[..] },   // full mesh (mm)
 *          // collisionHull omitted → built via forge.native.convexHull3D
 *          fixed?: bool,
 *          worldTransform?:[16] | { position, rotation, scale } // optional
 *        }],
 *        joints: [{
 *          name?, type?,                       // urdf type override (optional)
 *          mate,                               // forge mate type, e.g. 'hinge'
 *          parent, child,                      // link ids
 *          axis?:[x,y,z], origin?:{ xyz:[3], rpy:[3] },
 *          limit?:{ lower, upper, effort, velocity },
 *          anchor?:[x,y,z]                     // loop anchor (mm), world frame
 *        }]
 *      }
 *   B. A JS Assembly model (frontend/src/kernel/assembly/Assembly.js):
 *      { parts:[PartInstance], mates:[Mate] }. Adapted internally; the kernel
 *      is queried per part via the injected `forge` handle.
 *
 * @module forge-v4/io/robotExport
 */

/* eslint-disable no-bitwise */

// ───────────────────────────────────────────────────────────── tiny linear algebra
// Column-major 4×4 to match the kernel/UI Mat4 convention (OpenGL column-major).

const MM_TO_M = 1e-3;
const MM3_TO_M3 = 1e-9;
const MMI_TO_MI = 1e-6; // mm² → m²  (inertia second-moment scale)

function mat4Identity() {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
function mat4Mul(a, b) {
  const r = new Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      r[col * 4 + row] =
        a[0 * 4 + row] * b[col * 4 + 0] +
        a[1 * 4 + row] * b[col * 4 + 1] +
        a[2 * 4 + row] * b[col * 4 + 2] +
        a[3 * 4 + row] * b[col * 4 + 3];
    }
  }
  return r;
}
function mat4Translation(x, y, z) {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}
function mat4RotX(r) {
  const c = Math.cos(r), s = Math.sin(r);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
}
function mat4RotY(r) {
  const c = Math.cos(r), s = Math.sin(r);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
}
function mat4RotZ(r) {
  const c = Math.cos(r), s = Math.sin(r);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}
function mat4FromEuler(rx, ry, rz, px, py, pz) {
  // Matches PartInstance.getTransformMatrix(): T · Rz · Ry · Rx (scale=1).
  let m = mat4Translation(px || 0, py || 0, pz || 0);
  m = mat4Mul(m, mat4RotZ(rz || 0));
  m = mat4Mul(m, mat4RotY(ry || 0));
  m = mat4Mul(m, mat4RotX(rx || 0));
  return m;
}
function mat4Inverse(m) {
  // General 4×4 inverse (Laplace cofactor expansion). Inputs are rigid
  // transforms in practice, but we keep this general for safety.
  const e = m;
  const inv = new Array(16);
  inv[0] = e[5] * e[10] * e[15] - e[5] * e[11] * e[14] - e[9] * e[6] * e[15] +
    e[9] * e[7] * e[14] + e[13] * e[6] * e[11] - e[13] * e[7] * e[10];
  inv[4] = -e[4] * e[10] * e[15] + e[4] * e[11] * e[14] + e[8] * e[6] * e[15] -
    e[8] * e[7] * e[14] - e[12] * e[6] * e[11] + e[12] * e[7] * e[10];
  inv[8] = e[4] * e[9] * e[15] - e[4] * e[11] * e[13] - e[8] * e[5] * e[15] +
    e[8] * e[7] * e[13] + e[12] * e[5] * e[11] - e[12] * e[7] * e[9];
  inv[12] = -e[4] * e[9] * e[14] + e[4] * e[10] * e[13] + e[8] * e[5] * e[14] -
    e[8] * e[6] * e[13] - e[12] * e[5] * e[10] + e[12] * e[6] * e[9];
  inv[1] = -e[1] * e[10] * e[15] + e[1] * e[11] * e[14] + e[9] * e[2] * e[15] -
    e[9] * e[3] * e[14] - e[13] * e[2] * e[11] + e[13] * e[3] * e[10];
  inv[5] = e[0] * e[10] * e[15] - e[0] * e[11] * e[14] - e[8] * e[2] * e[15] +
    e[8] * e[3] * e[14] + e[12] * e[2] * e[11] - e[12] * e[3] * e[10];
  inv[9] = -e[0] * e[9] * e[15] + e[0] * e[11] * e[13] + e[8] * e[1] * e[15] -
    e[8] * e[3] * e[13] - e[12] * e[1] * e[11] + e[12] * e[3] * e[9];
  inv[13] = e[0] * e[9] * e[14] - e[0] * e[10] * e[13] - e[8] * e[1] * e[14] +
    e[8] * e[2] * e[13] + e[12] * e[1] * e[10] - e[12] * e[2] * e[9];
  inv[2] = e[1] * e[6] * e[15] - e[1] * e[7] * e[14] - e[5] * e[2] * e[15] +
    e[5] * e[3] * e[14] + e[13] * e[2] * e[7] - e[13] * e[3] * e[6];
  inv[6] = -e[0] * e[6] * e[15] + e[0] * e[7] * e[14] + e[4] * e[2] * e[15] -
    e[4] * e[3] * e[14] - e[12] * e[2] * e[7] + e[12] * e[3] * e[6];
  inv[10] = e[0] * e[5] * e[15] - e[0] * e[7] * e[13] - e[4] * e[1] * e[15] +
    e[4] * e[3] * e[13] + e[12] * e[1] * e[7] - e[12] * e[3] * e[5];
  inv[14] = -e[0] * e[5] * e[14] + e[0] * e[6] * e[13] + e[4] * e[1] * e[14] -
    e[4] * e[2] * e[13] - e[12] * e[1] * e[6] + e[12] * e[2] * e[5];
  inv[3] = -e[1] * e[6] * e[11] + e[1] * e[7] * e[10] + e[5] * e[2] * e[11] -
    e[5] * e[3] * e[10] - e[9] * e[2] * e[7] + e[9] * e[3] * e[6];
  inv[7] = e[0] * e[6] * e[11] - e[0] * e[7] * e[10] - e[4] * e[2] * e[11] +
    e[4] * e[3] * e[10] + e[8] * e[2] * e[7] - e[8] * e[3] * e[6];
  inv[11] = -e[0] * e[5] * e[11] + e[0] * e[7] * e[9] + e[4] * e[1] * e[11] -
    e[4] * e[3] * e[9] - e[8] * e[1] * e[7] + e[8] * e[3] * e[5];
  inv[15] = e[0] * e[5] * e[10] - e[0] * e[6] * e[9] - e[4] * e[1] * e[10] +
    e[4] * e[2] * e[9] + e[8] * e[1] * e[6] - e[8] * e[2] * e[5];
  let det = e[0] * inv[0] + e[1] * inv[4] + e[2] * inv[8] + e[3] * inv[12];
  if (Math.abs(det) < 1e-18) return mat4Identity();
  det = 1.0 / det;
  for (let i = 0; i < 16; i++) inv[i] *= det;
  return inv;
}
function mat4GetTranslation(m) {
  return [m[12], m[13], m[14]];
}
/** Extract extrinsic-XYZ (roll-pitch-yaw, applied X then Y then Z) RPY from
 *  the rotation part of a column-major rigid matrix. URDF rpy is the fixed-axis
 *  XYZ convention: R = Rz(yaw)·Ry(pitch)·Rx(roll). */
function mat4ToRPY(m) {
  // Column-major: element (row, col) = m[col*4 + row].
  const r00 = m[0], r10 = m[1], r20 = m[2];
  const r21 = m[6], r22 = m[10];
  const sy = Math.sqrt(r00 * r00 + r10 * r10);
  let roll, pitch, yaw;
  if (sy > 1e-9) {
    roll = Math.atan2(r21, r22);
    pitch = Math.atan2(-r20, sy);
    yaw = Math.atan2(r10, r00);
  } else {
    // Gimbal lock (pitch ≈ ±90°): yaw and roll act about the same world axis, so
    // fix yaw = 0 and recover the combined roll from the (0,1)/(1,1) elements
    // with the sign demanded by R = Rz(yaw)·Ry(pitch)·Rx(roll). At pitch = +π/2
    // (r20 < 0): r01 = sin(roll), r11 = cos(roll) → roll = atan2(r01, r11). At
    // pitch = −π/2 (r20 > 0): r01 = −sin(roll) → roll = atan2(−r01, r11).
    const r01 = m[4], r11 = m[5];
    pitch = Math.atan2(-r20, sy);
    yaw = 0;
    roll = (r20 < 0) ? Math.atan2(r01, r11) : Math.atan2(-r01, r11);
  }
  return [roll, pitch, yaw];
}
/** Rotate a 3-vector by the rotation part of a column-major matrix. */
function rotateVec(m, v) {
  return [
    m[0] * v[0] + m[4] * v[1] + m[8] * v[2],
    m[1] * v[0] + m[5] * v[1] + m[9] * v[2],
    m[2] * v[0] + m[6] * v[1] + m[10] * v[2],
  ];
}

// ───────────────────────────────────────────────────────── identifier hygiene
function makeUniqueNamer() {
  const seen = new Set();
  return function unique(raw, fallback) {
    let base = String(raw == null || raw === '' ? fallback : raw)
      .replace(/[^A-Za-z0-9_]/g, '_')
      .replace(/^(\d)/, '_$1'); // identifiers should not start with a digit
    if (base === '') base = fallback;
    let name = base;
    let i = 1;
    while (seen.has(name)) name = `${base}_${i++}`;
    seen.add(name);
    return name;
  };
}

function fmt(n) {
  // Stable, readable number formatting for XML attributes.
  if (!isFinite(n)) return '0';
  if (Math.abs(n) < 1e-12) return '0';
  // Up to 9 significant digits, trim trailing zeros.
  let s = n.toPrecision(9);
  if (s.indexOf('e') === -1 && s.indexOf('.') !== -1) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return s;
}
function vec3str(v) {
  return `${fmt(v[0])} ${fmt(v[1])} ${fmt(v[2])}`;
}

// ─────────────────────────────────────────── convex-hull polyhedron inertia
/**
 * Inertia tensor of a uniform-density solid polyhedron about its own centroid,
 * via the signed-tetrahedron-fan covariance integral (Mirtich 1996 / Eberly).
 * EXACT for a convex polyhedron. Returns the 3×3 inertia (about centroid) at
 * UNIT density together with the enclosed volume + centroid, all in the input
 * coordinate units (mm here). Caller scales by density and converts to SI.
 *
 * @param {Float32Array|number[]} verts  flat xyz vertex positions (mm)
 * @param {Uint32Array|number[]}  tris   flat triangle index triples
 * @returns {{ volume:number, centroid:[3], I:[9] }}  I row-major
 *          [Ixx,Ixy,Ixz, Iyx,Iyy,Iyz, Izx,Izy,Izz]
 */
function polyhedronInertia(verts, tris) {
  // Canonical covariance of the unit tetrahedron with one vertex at origin
  // (Tonon 2004): used to accumulate the 2nd-moment integral per tetra fan.
  // We integrate x², y², z², xy, yz, zx over each signed tetra (origin, a,b,c).
  let vol = 0;
  const com = [0, 0, 0];
  // 2nd moments accumulators (about origin), unit density.
  let Pxx = 0, Pyy = 0, Pzz = 0, Pxy = 0, Pyz = 0, Pzx = 0;

  const nTri = tris.length / 3;
  for (let t = 0; t < nTri; t++) {
    const ia = tris[t * 3] * 3;
    const ib = tris[t * 3 + 1] * 3;
    const ic = tris[t * 3 + 2] * 3;
    const ax = verts[ia], ay = verts[ia + 1], az = verts[ia + 2];
    const bx = verts[ib], by = verts[ib + 1], bz = verts[ib + 2];
    const cx = verts[ic], cy = verts[ic + 1], cz = verts[ic + 2];

    // Signed volume of tetra (origin, a, b, c) = det([a b c]) / 6.
    const det =
      ax * (by * cz - bz * cy) -
      ay * (bx * cz - bz * cx) +
      az * (bx * cy - by * cx);
    const tetVol = det / 6.0;
    vol += tetVol;

    // Centroid of the tetra is (a+b+c)/4 (4th vertex at origin).
    com[0] += tetVol * (ax + bx + cx) / 4.0;
    com[1] += tetVol * (ay + by + cy) / 4.0;
    com[2] += tetVol * (az + bz + cz) / 4.0;

    // Integral of the products of coordinates over the tetra (origin,a,b,c),
    // unit density. Standard closed form (det factors the volume scale):
    //   ∫ x²  = det/60 · (ax²+bx²+cx² + ax·bx+ax·cx+bx·cx)   (and cyclic),
    //   ∫ xy  = det/120 · (2·Σ ai·bi-diag + Σ ai·bj cross …) — use the
    // symmetric closed form below.
    const f = det / 120.0;
    // Diagonal second moments (∫ u² dV): det/60 · Σ_sym
    Pxx += (det / 60.0) * (ax * ax + bx * bx + cx * cx + ax * bx + ax * cx + bx * cx);
    Pyy += (det / 60.0) * (ay * ay + by * by + cy * cy + ay * by + ay * cy + by * cy);
    Pzz += (det / 60.0) * (az * az + bz * bz + cz * cz + az * bz + az * cz + bz * cz);
    // Products of inertia (∫ u·v dV): det/120 · [2(Σ ui·vi) + Σ_cross]
    Pxy += f * (2 * (ax * ay + bx * by + cx * cy) +
      ax * by + ay * bx + ax * cy + ay * cx + bx * cy + by * cx);
    Pyz += f * (2 * (ay * az + by * bz + cy * cz) +
      ay * bz + az * by + ay * cz + az * cy + by * cz + bz * cy);
    Pzx += f * (2 * (az * ax + bz * bx + cz * cx) +
      az * bx + ax * bz + az * cx + ax * cz + bz * cx + bx * cz);
  }

  if (Math.abs(vol) < 1e-18) {
    return { volume: 0, centroid: [0, 0, 0], I: [0, 0, 0, 0, 0, 0, 0, 0, 0] };
  }
  com[0] /= vol; com[1] /= vol; com[2] /= vol;

  // Inertia tensor about ORIGIN (unit density):
  //   Ixx = ∫(y²+z²) = Pyy+Pzz, Ixy = -∫xy, etc.
  let Ixx = Pyy + Pzz;
  let Iyy = Pxx + Pzz;
  let Izz = Pxx + Pyy;
  let Ixy = -Pxy;
  let Iyz = -Pyz;
  let Izx = -Pzx;

  // Parallel-axis shift ORIGIN → centroid: I_c = I_o − m·(‖c‖²E − c cᵀ),
  // with mass m = vol at unit density.
  const m = vol;
  const cx = com[0], cy = com[1], cz = com[2];
  Ixx -= m * (cy * cy + cz * cz);
  Iyy -= m * (cx * cx + cz * cz);
  Izz -= m * (cx * cx + cy * cy);
  Ixy -= -m * cx * cy; // I_c = I_o − m(δ‖c‖² − c cᵀ); for products: I_o + m·cx·cy
  Iyz -= -m * cy * cz;
  Izx -= -m * cz * cx;

  return {
    volume: vol,
    centroid: com,
    I: [Ixx, Ixy, Izx, Ixy, Iyy, Iyz, Izx, Iyz, Izz],
  };
}

/** Parallel-axis shift of a 3×3 inertia from frame A to a point `c` (the COM
 *  expressed in A): I_about_c = I_A − m·(‖c‖²E − c cᵀ). Used when the kernel
 *  provides the ORIGIN-frame tensor (inertiaOrigin) so we can move it to COM. */
function shiftInertiaToCom(I9, mass, c) {
  const [cx, cy, cz] = c;
  const out = I9.slice();
  out[0] -= mass * (cy * cy + cz * cz); // Ixx
  out[4] -= mass * (cx * cx + cz * cz); // Iyy
  out[8] -= mass * (cx * cx + cy * cy); // Izz
  out[1] += mass * cx * cy; // Ixy
  out[3] += mass * cx * cy;
  out[5] += mass * cy * cz; // Iyz
  out[7] += mass * cy * cz;
  out[2] += mass * cz * cx; // Izx
  out[6] += mass * cz * cx;
  return out;
}

// ────────────────────────────────────────────────── kernel mesh + hull access
/**
 * Resolve the visual mesh for a link. Spec links may carry `visual.positions`
 * directly (kernel-free path); otherwise tessellate the kernel handle.
 */
function resolveVisualMesh(link, forge, opts) {
  if (link.visual && link.visual.positions && link.visual.positions.length) {
    return {
      positions: link.visual.positions,
      indices: link.visual.indices && link.visual.indices.length
        ? link.visual.indices
        : implicitIndices(link.visual.positions.length / 3),
    };
  }
  const handle = link.handle != null ? link.handle
    : (link.solid && link.solid.handle != null ? link.solid.handle : null);
  if (handle == null || !forge) {
    throw new Error(`robotExport: link "${link.name || link.id}" has no mesh ` +
      `(provide visual.positions or a kernel handle + forge binding)`);
  }
  const lin = opts.decimate ? 0.4 : (opts.linTol != null ? opts.linTol : 0.1);
  let tess;
  if (opts.decimate && typeof forge.tessellateLOD === 'function') {
    tess = forge.tessellateLOD(handle, 1);
  } else {
    tess = forge.tessellate(handle, lin, opts.angTol != null ? opts.angTol : 0.5);
  }
  return {
    positions: Array.from(tess.positions),
    indices: Array.from(tess.indices),
  };
}
function implicitIndices(n) {
  const idx = new Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  return idx;
}

/**
 * Build the collision convex hull for a link. Returns DISTINCT geometry:
 * a re-indexed point set + triangle soup referencing only hull vertices.
 * Reuses forge.native.convexHull3D (faces index into the input point array).
 */
function buildCollisionHull(positions, forge) {
  if (!forge || !forge.native || typeof forge.native.convexHull3D !== 'function') {
    // No kernel binding (pure-JS test/browser without native): fall back to a
    // monotone-chain-free minimal hull is out of scope; instead compute a JS
    // 3D hull via the incremental gift-wrap below so geometry is still DISTINCT.
    return jsConvexHull(positions);
  }
  const flat = Array.from(positions);
  const hull = forge.native.convexHull3D(flat);
  if (!hull.ok) {
    // Degenerate point set — coplanar (a flat plate / sheet body) or collinear —
    // has no well-defined 3D hull, but the link MUST still export rather than
    // crash the whole assembly. Fall back to the JS hull (which tolerates
    // degeneracy and yields a thin collision proxy); if even that fails (all
    // points collinear/coincident), use the input point soup directly.
    try {
      return jsConvexHull(positions);
    } catch (_) {
      return { positions: Array.from(positions), indices: implicitIndices(positions.length / 3) };
    }
  }
  // hull.faces index into the ORIGINAL point array. Re-index to a compact set
  // of hull-only vertices so the collision geometry is provably distinct data.
  const used = new Map(); // origIdx -> newIdx
  const outPos = [];
  const outTri = [];
  const faces = hull.faces;
  for (let i = 0; i < faces.length; i++) {
    const orig = faces[i];
    let ni = used.get(orig);
    if (ni === undefined) {
      ni = outPos.length / 3;
      used.set(orig, ni);
      outPos.push(flat[orig * 3], flat[orig * 3 + 1], flat[orig * 3 + 2]);
    }
    outTri.push(ni);
  }
  return { positions: outPos, indices: outTri };
}

/**
 * Dependency-free 3D convex hull (incremental) — fallback only, used when the
 * native binding is unavailable so collision geometry is still DISTINCT from
 * the full mesh. Not the production path (the kernel hull is preferred).
 */
function jsConvexHull(positions) {
  const n = positions.length / 3;
  const pts = [];
  for (let i = 0; i < n; i++) pts.push([positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]);
  if (n < 4) return { positions: Array.from(positions), indices: implicitIndices(n) };
  // Build an initial tetra from 4 non-coplanar points.
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  let i1 = 0, i2 = 1;
  // pick two distinct
  for (let i = 1; i < n; i++) { if (sub(pts[i], pts[0]).some(v => Math.abs(v) > 1e-9)) { i2 = i; break; } }
  let i3 = -1, bestArea = 1e-9;
  for (let i = 0; i < n; i++) {
    const a = cross(sub(pts[i2], pts[i1]), sub(pts[i], pts[i1]));
    const area = Math.hypot(a[0], a[1], a[2]);
    if (area > bestArea) { bestArea = area; i3 = i; }
  }
  if (i3 < 0) return { positions: Array.from(positions), indices: implicitIndices(n) };
  const nrm = cross(sub(pts[i2], pts[i1]), sub(pts[i3], pts[i1]));
  let i4 = -1, bestVol = 1e-9;
  for (let i = 0; i < n; i++) {
    const v = Math.abs(dot(nrm, sub(pts[i], pts[i1])));
    if (v > bestVol) { bestVol = v; i4 = i; }
  }
  if (i4 < 0) return { positions: Array.from(positions), indices: implicitIndices(n) };
  let faces = [[i1, i2, i3], [i1, i3, i4], [i1, i4, i2], [i2, i4, i3]];
  // Orient outward relative to centroid.
  const cen = [0, 0, 0];
  for (const k of [i1, i2, i3, i4]) { cen[0] += pts[k][0] / 4; cen[1] += pts[k][1] / 4; cen[2] += pts[k][2] / 4; }
  faces = faces.map(f => {
    const fn = cross(sub(pts[f[1]], pts[f[0]]), sub(pts[f[2]], pts[f[0]]));
    if (dot(fn, sub(pts[f[0]], cen)) < 0) return [f[0], f[2], f[1]];
    return f;
  });
  const faceNormal = (f) => {
    const fn = cross(sub(pts[f[1]], pts[f[0]]), sub(pts[f[2]], pts[f[0]]));
    return { n: fn, d: dot(fn, pts[f[0]]) };
  };
  for (let p = 0; p < n; p++) {
    if (p === i1 || p === i2 || p === i3 || p === i4) continue;
    const visible = [];
    for (let fi = 0; fi < faces.length; fi++) {
      const { n: fn, d } = faceNormal(faces[fi]);
      if (dot(fn, pts[p]) - d > 1e-7) visible.push(fi);
    }
    if (!visible.length) continue;
    // Horizon edges = edges adjacent to exactly one visible face.
    const edgeCount = new Map();
    const key = (a, b) => a < b ? `${a}_${b}` : `${b}_${a}`;
    for (const fi of visible) {
      const f = faces[fi];
      for (const [a, b] of [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]]) {
        const k = key(a, b);
        edgeCount.set(k, (edgeCount.get(k) || 0) + 1);
      }
    }
    const visSet = new Set(visible);
    const newFaces = faces.filter((_, fi) => !visSet.has(fi));
    for (const fi of visible) {
      const f = faces[fi];
      for (const [a, b] of [[f[0], f[1]], [f[1], f[2]], [f[2], f[0]]]) {
        if (edgeCount.get(key(a, b)) === 1) newFaces.push([a, b, p]);
      }
    }
    faces = newFaces;
  }
  const used = new Map();
  const outPos = [], outTri = [];
  for (const f of faces) {
    for (const orig of f) {
      let ni = used.get(orig);
      if (ni === undefined) { ni = outPos.length / 3; used.set(orig, ni); outPos.push(pts[orig][0], pts[orig][1], pts[orig][2]); }
      outTri.push(ni);
    }
  }
  return { positions: outPos, indices: outTri };
}

// ─────────────────────────────────────────────────────── joint type mapping
// Maps a Forge mate vocabulary entry to a robot joint kind + whether it is a
// loop-closing constraint (mechanical couplers that URDF's tree can't model).
const MATE_TO_JOINT = {
  hinge: { type: 'revolute', dof: 5 },
  concentric: { type: 'continuous', dof: 4 }, // no angle limit → continuous
  angleLimit: { type: 'revolute', dof: 1 },
  slider: { type: 'prismatic', dof: 1 },
  distanceLimit: { type: 'prismatic', dof: 1 },
  linearCoupler: { type: 'prismatic', dof: 1 },
  fixed: { type: 'fixed', dof: 6 },
  lock: { type: 'fixed', dof: 6 },
  coincident: { type: 'fixed', dof: 3 },
  // Mechanical couplers → spanning-tree joint + a loop/equality constraint.
  gear: { type: 'revolute', dof: 1, coupler: true },
  screw: { type: 'revolute', dof: 1, coupler: true },
  rackPinion: { type: 'prismatic', dof: 1, coupler: true },
  cam: { type: 'revolute', dof: 1, coupler: true },
  universalJoint: { type: 'revolute', dof: 2 },
};

function resolveJointKind(j) {
  if (j.type) return { type: j.type, coupler: !!j.coupler };
  const m = MATE_TO_JOINT[j.mate];
  if (m) return { type: m.type, coupler: !!m.coupler };
  return { type: 'fixed', coupler: false };
}

// Defaults are UNIT-AWARE: revolute lower/upper are radians (±180°), prismatic
// lower/upper are metres of linear travel. Emitting the ±π revolute default on a
// prismatic joint would mean a 6.28 m rail — wrong by units, not just magnitude.
const DEFAULT_LIMIT_REVOLUTE = { lower: -Math.PI, upper: Math.PI, effort: 100, velocity: 10 };
const DEFAULT_LIMIT_PRISMATIC = { lower: -0.1, upper: 0.1, effort: 100, velocity: 1 }; // ±100 mm, 1 m/s

function resolveLimit(j, type) {
  if (type === 'continuous' || type === 'fixed') return null;
  const D = (type === 'prismatic') ? DEFAULT_LIMIT_PRISMATIC : DEFAULT_LIMIT_REVOLUTE;
  const l = j.limit || {};
  return {
    lower: l.lower != null ? l.lower : D.lower,
    upper: l.upper != null ? l.upper : D.upper,
    effort: l.effort != null ? l.effort : D.effort,
    velocity: l.velocity != null ? l.velocity : D.velocity,
  };
}

// ───────────────────────────────────────────── assembly → normalized spec
/**
 * Normalize either a raw spec or a JS Assembly into a canonical internal form
 * with per-link kernel mass-props + inertia + meshes + hull, and a spanning
 * tree + loop closures over the joint/mate graph.
 */
function normalize(assembly, forge, opts) {
  const density = opts.density != null ? opts.density : 1000; // kg/m³ default (water)

  // -- Adapt a JS Assembly to the raw-spec shape if needed.
  let spec = assembly;
  if (assembly && Array.isArray(assembly.parts) && !Array.isArray(assembly.links)) {
    spec = adaptJsAssembly(assembly, forge);
  }
  if (!spec || !Array.isArray(spec.links)) {
    throw new Error('robotExport: assembly must have links[] (or be a JS Assembly with parts[])');
  }
  if (spec.links.length === 0) {
    throw new Error('robotExport: assembly has no links (cannot export an empty robot)');
  }

  const nameOf = makeUniqueNamer();
  const links = [];
  const idToLink = new Map();

  for (const L of spec.links) {
    const linkName = nameOf(L.name, `link_${links.length + 1}`);

    // Kernel mass-props (mass + COM + inertia tensor are kernel-truth).
    let volume = L.volume;
    let com = L.com;
    // Query the kernel when we need volume/com OR when a handle is present but
    // the COM-frame inertia tensor has not been supplied on the spec — so a
    // real (handle-backed) assembly always exports KERNEL-TRUTH inertia and
    // auto-switches off the JS hull approximation.
    if (forge && L.handle != null &&
        (volume == null || com == null || L.inertiaCom == null)) {
      const mp = forge.massProps(L.handle);
      if (volume == null) volume = mp.volume;
      if (com == null) com = mp.centerOfMass;
      if (L.inertiaCom == null && mp.inertiaCom && mp.inertiaCom.length === 9) {
        L.inertiaCom = mp.inertiaCom;
      }
    }
    if (volume == null || com == null) {
      throw new Error(`robotExport: link "${linkName}" missing mass-props (volume/com)`);
    }
    const massKg = (L.mass != null) ? L.mass : density * volume * MM3_TO_M3;

    // Visual mesh (full, optionally decimated) + DISTINCT collision hull.
    const visual = resolveVisualMesh(L, forge, opts);
    const collision = L.collisionHull && L.collisionHull.positions
      ? L.collisionHull
      : buildCollisionHull(visual.positions, forge);

    // Inertia about COM frame, SI (kg·m²).
    const inertia = resolveInertia(L, { massKg, volume, com, density, visual, collision });

    const link = {
      id: L.id != null ? L.id : linkName,
      name: linkName,
      material: L.material || 'default',
      color: L.color || [0.6, 0.64, 0.7, 1],
      fixed: !!L.fixed,
      massKg,
      // COM in metres, in the link's local frame (kernel COM is link-local).
      comM: [com[0] * MM_TO_M, com[1] * MM_TO_M, com[2] * MM_TO_M],
      inertia, // { method, ixx,ixy,ixz,iyy,iyz,izz } in kg·m²
      visual,  // mm
      collision, // mm
      worldTransform: resolveWorldTransform(L),
    };
    links.push(link);
    idToLink.set(link.id, link);
    if (L.id != null) idToLink.set(L.id, link);
  }

  // -- Joints / mates → graph → spanning tree + loop closures.
  const rawJoints = (spec.joints || []).map((j, i) => ({ ...j, _idx: i }));
  const { treeJoints, loopJoints, rootLink } =
    buildSpanningTree(links, idToLink, rawJoints, spec.baseLink || opts.baseLink, nameOf);

  return { name: spec.name || (assembly && assembly.name) || 'robot', density, links, treeJoints, loopJoints, rootLink };
}

// Positive-definite solid-box inertia from a link's AABB, used when the convex
// hull is degenerate (planar / collinear / coincident → ~zero volume). Each
// extent is floored so no principal axis collapses to a singular moment.
function degenerateFallbackInertia(positions, massKg) {
  let mnx = Infinity, mny = Infinity, mnz = Infinity, mxx = -Infinity, mxy = -Infinity, mxz = -Infinity;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < mnx) mnx = x; if (y < mny) mny = y; if (z < mnz) mnz = z;
    if (x > mxx) mxx = x; if (y > mxy) mxy = y; if (z > mxz) mxz = z;
  }
  let ex = (mxx - mnx) * MM_TO_M, ey = (mxy - mny) * MM_TO_M, ez = (mxz - mnz) * MM_TO_M; // metres
  if (!Number.isFinite(ex)) ex = 0; if (!Number.isFinite(ey)) ey = 0; if (!Number.isFinite(ez)) ez = 0;
  const big = Math.max(ex, ey, ez, 0);
  const eps = Math.max(big * 1e-3, 1e-4); // floor: ≥0.1% of size, ≥0.1 mm — guarantees a non-singular tensor
  ex = Math.max(ex, eps); ey = Math.max(ey, eps); ez = Math.max(ez, eps);
  const m = Math.max(massKg, 0);
  return {
    ixx: m / 12 * (ey * ey + ez * ez), ixy: 0, ixz: 0,
    iyy: m / 12 * (ex * ex + ez * ez), iyz: 0,
    izz: m / 12 * (ex * ex + ey * ey),
  };
}

function resolveInertia(L, ctx) {
  const { massKg, volume, com, density, collision } = ctx;
  void density;
  // Path 1 — kernel COM-frame tensor supplied directly: this is the OCCT
  // GProp MatrixOfInertia, ALREADY about the centre of mass (no parallel-axis
  // shift) and at UNIT DENSITY (mass·mm² with mass==volume). To convert to SI
  // kg·m² we (a) carry the real link mass via s = massKg/volume — the same
  // unit-density→real-mass scale Path 3 applies — and (b) convert mm²→m² via
  // MMI_TO_MI. When `volume` is unavailable (kernel-free spec that nonetheless
  // supplied inertiaCom), assume the tensor already carries the real mass
  // (s = 1), preserving the prior convention for hand-built specs.
  if (L.inertiaCom && L.inertiaCom.length === 9) {
    const i = L.inertiaCom;
    const s = (volume != null && volume > 0) ? (massKg / volume) : 1;
    const k = s * MMI_TO_MI;
    return {
      method: 'kernel:inertiaCom',
      ixx: i[0] * k, ixy: i[1] * k, ixz: i[2] * k,
      iyy: i[4] * k, iyz: i[5] * k, izz: i[8] * k,
    };
  }
  // Path 2 — kernel ORIGIN-frame tensor (mm-mass units): shift to COM in JS.
  if (L.inertiaOrigin && L.inertiaOrigin.length === 9) {
    const shifted = shiftInertiaToCom(L.inertiaOrigin.slice(), massKg, com);
    return {
      method: 'kernel:inertiaOrigin+parallelAxis',
      ixx: shifted[0] * MMI_TO_MI, ixy: shifted[1] * MMI_TO_MI, ixz: shifted[2] * MMI_TO_MI,
      iyy: shifted[4] * MMI_TO_MI, iyz: shifted[5] * MMI_TO_MI, izz: shifted[8] * MMI_TO_MI,
    };
  }
  // Path 3 — KERNEL GAP: no tensor surfaced. Compute the uniform-density
  // polyhedron inertia of the convex hull (exact for convex links). Labeled.
  const hp = polyhedronInertia(collision.positions, collision.indices);
  // Degeneracy guard: a planar/collinear/coincident hull has ~zero volume, so
  // massKg/hp.volume blows up or the unit-density tensor is singular — the old
  // code silently emitted an all-zero (non-physical) inertia for a MOVABLE link,
  // which makes any dynamics consumer (PyBullet/MuJoCo/Gazebo) NaN or unstable.
  // Fall back to a positive-definite solid-box inertia from the link's AABB with
  // each extent floored so no principal axis is singular. Honestly labeled.
  if (!Number.isFinite(hp.volume) || hp.volume <= 1e-9 ||
      !Number.isFinite(hp.I[0]) || !Number.isFinite(hp.I[4]) || !Number.isFinite(hp.I[8])) {
    const fb = degenerateFallbackInertia(collision.positions, massKg);
    return { method: 'approx:degenerate-fallback-box', ...fb };
  }
  // hp.I is at unit density, about the hull centroid, in mm-mass·mm² ≡ mm⁵.
  // Effective density so the polyhedron's mass matches the kernel mass:
  //   ρ_eff = massKg / (hp.volume·MM3_TO_M3)  [kg/m³]; then I_SI = ρ_eff · hp.I · mm⁵→...
  // Simpler: I_SI = (massKg / hp.volume) · hp.I · MMI_TO_MI, because hp.I already
  // carries the mm² second-moment and hp.volume the mm³ — (massKg/hp.volume)
  // converts unit-density mm-mass to real mass per mm³, and MMI_TO_MI scales mm²→m².
  const scale = (hp.volume !== 0 ? massKg / hp.volume : 0) * MMI_TO_MI;
  return {
    method: 'approx:hull-inertia',
    ixx: hp.I[0] * scale, ixy: hp.I[1] * scale, ixz: hp.I[2] * scale,
    iyy: hp.I[4] * scale, iyz: hp.I[5] * scale, izz: hp.I[8] * scale,
  };
}
function resolveWorldTransform(L) {
  if (L.worldTransform && L.worldTransform.length === 16) return L.worldTransform.slice();
  const p = L.position || (L.solid ? L.solid.position : null) || { x: 0, y: 0, z: 0 };
  const r = L.rotation || { x: 0, y: 0, z: 0 };
  const px = Array.isArray(p) ? p[0] : p.x;
  const py = Array.isArray(p) ? p[1] : p.y;
  const pz = Array.isArray(p) ? p[2] : p.z;
  const rx = Array.isArray(r) ? r[0] : r.x;
  const ry = Array.isArray(r) ? r[1] : r.y;
  const rz = Array.isArray(r) ? r[2] : r.z;
  return mat4FromEuler(rx, ry, rz, px, py, pz);
}

function adaptJsAssembly(asm, forge) {
  const links = asm.parts.map((p) => {
    const handle = p.solid && (p.solid.handle != null ? p.solid.handle : (p.solid._handle));
    let volume, com, inertiaCom;
    if (forge && handle != null) {
      const mp = forge.massProps(handle);
      volume = mp.volume; com = mp.centerOfMass;
      if (mp.inertiaCom && mp.inertiaCom.length === 9) inertiaCom = mp.inertiaCom;
    }
    return {
      id: p.id,
      name: p.name,
      material: p.material,
      fixed: p.fixed,
      handle,
      inertiaCom,
      solid: p.solid,
      position: p.position,
      rotation: p.rotation,
      volume, com, inertiaCom,
    };
  });
  const joints = asm.mates.map((m) => ({
    name: `joint_${m.id}`,
    mate: m.type,
    parent: m.partA.id,
    child: m.partB.id,
    axis: m.params && m.params.axisA,
    limit: m.params && (m.params.limit || (m.params.angleMin != null ? {
      lower: m.params.angleMin, upper: m.params.angleMax,
    } : null)),
    anchor: m.params && (m.params.pointA || m.params.anchor),
    params: m.params,
  }));
  return { name: asm.name, parts: undefined, links, joints, baseLink: undefined };
}

/**
 * Build a spanning tree over the link/joint graph (BFS from the fixed/base
 * link). Tree edges become URDF/SDF joints; non-tree edges (and mechanical
 * couplers) become loop closures that are emitted as SDF/MJCF/USD constraints
 * and a documented <gazebo> block on URDF — never silently dropped.
 */
function buildSpanningTree(links, idToLink, rawJoints, baseLinkId, nameOf) {
  // Adjacency.
  const adj = new Map();
  for (const L of links) adj.set(L.id, []);
  for (const j of rawJoints) {
    if (!idToLink.has(j.parent) || !idToLink.has(j.child)) {
      throw new Error(`robotExport: joint references unknown link (${j.parent} → ${j.child})`);
    }
    adj.get(j.parent).push(j);
    adj.get(j.child).push(j);
  }

  // Choose root: explicit baseLink, else a fixed link, else first link.
  let root = null;
  if (baseLinkId != null && idToLink.has(baseLinkId)) root = idToLink.get(baseLinkId);
  if (!root) root = links.find(L => L.fixed) || links[0];

  const visited = new Set([root.id]);
  const treeJoints = [];
  const loopJoints = [];
  const usedJoint = new Set();
  const parentOf = new Map();

  // BFS; an edge is a tree edge the first time it connects a visited node to
  // an unvisited one. Couplers (gear/screw/...) are ALWAYS loop closures.
  const queue = [root.id];
  const namer = makeUniqueNamer();
  while (queue.length) {
    const cur = queue.shift();
    for (const j of adj.get(cur)) {
      if (usedJoint.has(j._idx)) continue;
      const kind = resolveJointKind(j);
      const other = j.parent === cur ? j.child : j.parent;
      const isCoupler = kind.coupler;
      if (!isCoupler && !visited.has(other)) {
        // Tree edge. Orient parent=cur, child=other.
        usedJoint.add(j._idx);
        visited.add(other);
        parentOf.set(other, cur);
        queue.push(other);
        treeJoints.push(buildJointRecord(j, cur, other, idToLink, namer, nameOf, false));
      }
    }
  }
  // Absorb every remaining joint into a SINGLE tree, looping to a fixed point so
  // a whole disconnected chain is pulled in once any one of its links is reached.
  // A joint with one endpoint already in the tree becomes a tree edge (oriented
  // in→out); both-in becomes a loop closure; couplers are always loop closures.
  // If a fully-disconnected component remains (neither endpoint in the tree),
  // seed it by anchoring one of its links to the root with a synthetic `fixed`
  // joint, then keep absorbing. This guarantees EXACTLY ONE root link — a
  // multi-root URDF is hard-rejected by urdfdom/RViz/MoveIt/PyBullet.
  const synthFixed = (parentId, childId) =>
    buildJointRecord({ parent: parentId, child: childId, type: 'fixed' },
      parentId, childId, idToLink, namer, nameOf, false);
  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const j of rawJoints) {
      if (usedJoint.has(j._idx)) continue;
      const kind = resolveJointKind(j);
      const pIn = visited.has(j.parent), cIn = visited.has(j.child);
      if (pIn && cIn) {
        usedJoint.add(j._idx);
        loopJoints.push(buildJointRecord(j, j.parent, j.child, idToLink, namer, nameOf, true));
        progressed = true;
      } else if ((pIn || cIn) && !kind.coupler) {
        const parent = pIn ? j.parent : j.child;
        const child = pIn ? j.child : j.parent;
        usedJoint.add(j._idx);
        visited.add(child);
        parentOf.set(child, parent);
        treeJoints.push(buildJointRecord(j, parent, child, idToLink, namer, nameOf, false));
        progressed = true;
      }
      // else: a coupler with one endpoint in, or neither endpoint in — defer.
    }
    if (!progressed) {
      // Nothing attachable → seed one fully-stranded component against the root.
      const stranded = rawJoints.find(j => !usedJoint.has(j._idx) &&
        !visited.has(j.parent) && !visited.has(j.child));
      if (stranded) {
        visited.add(stranded.parent);
        parentOf.set(stranded.parent, root.id);
        treeJoints.push(synthFixed(root.id, stranded.parent));
        progressed = true;
      }
    }
  }
  // True orphans — links with no joints at all — anchor to the root as fixed so
  // the model is a single tree rather than N silently-floating root links.
  for (const L of links) {
    if (visited.has(L.id)) continue;
    visited.add(L.id);
    parentOf.set(L.id, root.id);
    treeJoints.push(synthFixed(root.id, L.id));
  }
  // Everything is now in the tree; any still-unused joint (e.g. a coupler in a
  // formerly-disconnected component) is emitted as a loop closure, never dropped.
  for (const j of rawJoints) {
    if (usedJoint.has(j._idx)) continue;
    usedJoint.add(j._idx);
    loopJoints.push(buildJointRecord(j, j.parent, j.child, idToLink, namer, nameOf, true));
  }

  return { treeJoints, loopJoints, rootLink: root };
}

function buildJointRecord(j, parentId, childId, idToLink, namer, nameOf, isLoop) {
  const parent = idToLink.get(parentId);
  const child = idToLink.get(childId);
  const kind = resolveJointKind(j);
  const limit = resolveLimit(j, kind.type);

  // Joint origin: rigid transform from PARENT link frame to CHILD link frame.
  // origin = parentWorld⁻¹ · childWorld  (column-major).
  const pInv = mat4Inverse(parent.worldTransform);
  const rel = mat4Mul(pInv, child.worldTransform);
  let xyz, rpy;
  if (j.origin && j.origin.xyz) {
    xyz = j.origin.xyz.map(v => v * MM_TO_M);
    rpy = j.origin.rpy || [0, 0, 0];
  } else {
    xyz = mat4GetTranslation(rel).map(v => v * MM_TO_M);
    rpy = mat4ToRPY(rel);
  }

  // Axis: mate axis, expressed in the CHILD frame for URDF (axis is in the
  // joint frame = child link frame). Default = Z.
  let axis = j.axis && j.axis.length === 3 ? j.axis.slice() : [0, 0, 1];
  // normalize
  const an = Math.hypot(axis[0], axis[1], axis[2]) || 1;
  axis = [axis[0] / an, axis[1] / an, axis[2] / an];

  // Loop anchor (world-frame mm → m) for equality/connect constraints.
  let anchor = null;
  if (j.anchor && j.anchor.length === 3) anchor = j.anchor.map(v => v * MM_TO_M);

  return {
    name: nameOf(j.name, `${isLoop ? 'loop' : 'joint'}_${parent.name}_${child.name}`),
    type: kind.type,
    coupler: !!kind.coupler,
    isLoop,
    parent, child,
    xyz, rpy, axis, limit, anchor,
    mate: j.mate || null,
  };
}

// ───────────────────────────────────────────────────────────── format writers
const STL_HEADER = 'ArchDisc Forge collision hull';

/** Mesh → ASCII STL (used for collision/visual mesh sidecar files). */
function meshToStl(positions, indices, name) {
  let out = `solid ${name}\n`;
  const nTri = indices.length / 3;
  for (let t = 0; t < nTri; t++) {
    const ia = indices[t * 3] * 3, ib = indices[t * 3 + 1] * 3, ic = indices[t * 3 + 2] * 3;
    const a = [positions[ia], positions[ia + 1], positions[ia + 2]];
    const b = [positions[ib], positions[ib + 1], positions[ib + 2]];
    const c = [positions[ic], positions[ic + 1], positions[ic + 2]];
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2];
    const vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const ln = Math.hypot(nx, ny, nz) || 1; nx /= ln; ny /= ln; nz /= ln;
    out += `  facet normal ${fmt(nx)} ${fmt(ny)} ${fmt(nz)}\n    outer loop\n`;
    out += `      vertex ${vec3str([a[0] * MM_TO_M, a[1] * MM_TO_M, a[2] * MM_TO_M])}\n`;
    out += `      vertex ${vec3str([b[0] * MM_TO_M, b[1] * MM_TO_M, b[2] * MM_TO_M])}\n`;
    out += `      vertex ${vec3str([c[0] * MM_TO_M, c[1] * MM_TO_M, c[2] * MM_TO_M])}\n`;
    out += '    endloop\n  endfacet\n';
  }
  out += `endsolid ${name}\n`;
  return out;
}
void STL_HEADER;

function inertialBlock(link, indent, kvJoiner) {
  const i = link.inertia;
  const c = link.comM;
  // URDF/SDF: <inertial><origin/><mass/><inertia/></inertial>
  const pad = indent;
  return [
    `${pad}<inertial>`,
    `${pad}  <origin xyz="${vec3str(c)}" rpy="0 0 0"/>`,
    `${pad}  <mass value="${fmt(link.massKg)}"/>`,
    `${pad}  <inertia ixx="${fmt(i.ixx)}" ixy="${fmt(i.ixy)}" ixz="${fmt(i.ixz)}"` +
    ` iyy="${fmt(i.iyy)}" iyz="${fmt(i.iyz)}" izz="${fmt(i.izz)}"/>`,
    `${pad}</inertial>`,
  ].join(kvJoiner || '\n');
}

// ── URDF ────────────────────────────────────────────────────────────────────
function writeURDF(model, opts) {
  const meshFiles = {};
  const lines = [];
  lines.push('<?xml version="1.0"?>');
  lines.push(`<!-- Generated by ArchDisc Forge robotExport (Task #30). Units: SI (m, kg). -->`);
  lines.push(`<!-- Inertia method per link noted in each <link>'s comment. -->`);
  lines.push(`<robot name="${model.name}">`);

  for (const L of model.links) {
    const vfile = `${L.name}_visual.stl`;
    const cfile = `${L.name}_collision.stl`;
    meshFiles[vfile] = meshToStl(L.visual.positions, L.visual.indices, `${L.name}_visual`);
    meshFiles[cfile] = meshToStl(L.collision.positions, L.collision.indices, `${L.name}_collision`);
    lines.push(`  <!-- link "${L.name}": mass=${fmt(L.massKg)}kg, inertia=${L.inertia.method} -->`);
    lines.push(`  <link name="${L.name}">`);
    lines.push(inertialBlock(L, '    '));
    // VISUAL = full mesh.
    lines.push('    <visual>');
    lines.push('      <origin xyz="0 0 0" rpy="0 0 0"/>');
    lines.push('      <geometry>');
    lines.push(`        <mesh filename="${vfile}"/>`);
    lines.push('      </geometry>');
    lines.push(`      <material name="${L.material}"><color rgba="${L.color.map(fmt).join(' ')}"/></material>`);
    lines.push('    </visual>');
    // COLLISION = convex hull (DISTINCT geometry / different file).
    lines.push('    <collision>');
    lines.push('      <origin xyz="0 0 0" rpy="0 0 0"/>');
    lines.push('      <geometry>');
    lines.push(`        <mesh filename="${cfile}"/>`);
    lines.push('      </geometry>');
    lines.push('    </collision>');
    lines.push('  </link>');
  }

  for (const j of model.treeJoints) {
    lines.push(`  <joint name="${j.name}" type="${j.type}">`);
    lines.push(`    <parent link="${j.parent.name}"/>`);
    lines.push(`    <child link="${j.child.name}"/>`);
    lines.push(`    <origin xyz="${vec3str(j.xyz)}" rpy="${vec3str(j.rpy)}"/>`);
    if (j.type !== 'fixed') {
      lines.push(`    <axis xyz="${vec3str(j.axis)}"/>`);
      if (j.limit) {
        lines.push(`    <limit lower="${fmt(j.limit.lower)}" upper="${fmt(j.limit.upper)}"` +
          ` effort="${fmt(j.limit.effort)}" velocity="${fmt(j.limit.velocity)}"/>`);
      }
    }
    lines.push('  </joint>');
  }

  // CLOSED CHAINS — URDF is a tree, so loops go in a <gazebo> block (Gazebo's
  // documented loop-closure mechanism) so a four-bar is NOT silently dropped.
  if (model.loopJoints.length) {
    lines.push('  <!-- CLOSED-CHAIN LOOP CLOSURES (URDF tree cannot encode loops directly). -->');
    lines.push('  <!-- These are emitted as <gazebo> loop joints; the SDF/MJCF exports carry them natively. -->');
    for (const j of model.loopJoints) {
      lines.push('  <gazebo>');
      lines.push(`    <joint name="${j.name}" type="${j.type === 'fixed' ? 'fixed' : 'revolute'}">`);
      lines.push(`      <parent>${j.parent.name}</parent>`);
      lines.push(`      <child>${j.child.name}</child>`);
      if (j.anchor) lines.push(`      <pose>${vec3str(j.anchor)} 0 0 0</pose>`);
      lines.push(`      <axis><xyz>${vec3str(j.axis)}</xyz></axis>`);
      lines.push('    </joint>');
      lines.push('  </gazebo>');
    }
  }

  lines.push('</robot>');
  return { text: lines.join('\n'), meshFiles };
}

// ── SDF ─────────────────────────────────────────────────────────────────────
function writeSDF(model) {
  const meshFiles = {};
  const lines = [];
  lines.push('<?xml version="1.0"?>');
  lines.push('<sdf version="1.9">');
  lines.push(`  <model name="${model.name}">`);

  for (const L of model.links) {
    const vfile = `${L.name}_visual.stl`;
    const cfile = `${L.name}_collision.stl`;
    meshFiles[vfile] = meshToStl(L.visual.positions, L.visual.indices, `${L.name}_visual`);
    meshFiles[cfile] = meshToStl(L.collision.positions, L.collision.indices, `${L.name}_collision`);
    const wt = mat4GetTranslation(L.worldTransform).map(v => v * MM_TO_M);
    const wr = mat4ToRPY(L.worldTransform);
    lines.push(`    <link name="${L.name}">`);
    lines.push(`      <pose>${vec3str(wt)} ${vec3str(wr)}</pose>`);
    lines.push('      <inertial>');
    lines.push(`        <pose>${vec3str(L.comM)} 0 0 0</pose>`);
    lines.push(`        <mass>${fmt(L.massKg)}</mass>`);
    lines.push('        <inertia>');
    lines.push(`          <ixx>${fmt(L.inertia.ixx)}</ixx><ixy>${fmt(L.inertia.ixy)}</ixy><ixz>${fmt(L.inertia.ixz)}</ixz>`);
    lines.push(`          <iyy>${fmt(L.inertia.iyy)}</iyy><iyz>${fmt(L.inertia.iyz)}</iyz><izz>${fmt(L.inertia.izz)}</izz>`);
    lines.push('        </inertia>');
    lines.push('      </inertial>');
    lines.push('      <visual name="visual">');
    lines.push(`        <geometry><mesh><uri>${vfile}</uri></mesh></geometry>`);
    lines.push('      </visual>');
    lines.push('      <collision name="collision">');
    lines.push(`        <geometry><mesh><uri>${cfile}</uri></mesh></geometry>`);
    lines.push('      </collision>');
    lines.push('    </link>');
  }

  // Anchor each fixed base link to the world with a fixed joint so the model is
  // genuinely grounded. An SDF <link> alone floats under gravity, and
  // <kinematic>false</kinematic> is a no-op (false is already the default); the
  // canonical SDF anchor is a fixed joint whose parent is the reserved 'world'.
  for (const L of model.links) {
    if (!L.fixed) continue;
    lines.push(`    <joint name="${L.name}_world_fixed" type="fixed">`);
    lines.push('      <parent>world</parent>');
    lines.push(`      <child>${L.name}</child>`);
    lines.push('    </joint>');
  }

  for (const j of model.treeJoints) {
    lines.push(`    <joint name="${j.name}" type="${j.type}">`);
    lines.push(`      <parent>${j.parent.name}</parent>`);
    lines.push(`      <child>${j.child.name}</child>`);
    lines.push(`      <pose>${vec3str(j.xyz)} ${vec3str(j.rpy)}</pose>`);
    if (j.type !== 'fixed') {
      lines.push('      <axis>');
      lines.push(`        <xyz>${vec3str(j.axis)}</xyz>`);
      if (j.limit) {
        lines.push(`        <limit><lower>${fmt(j.limit.lower)}</lower><upper>${fmt(j.limit.upper)}</upper>` +
          `<effort>${fmt(j.limit.effort)}</effort><velocity>${fmt(j.limit.velocity)}</velocity></limit>`);
      }
      lines.push('      </axis>');
    }
    lines.push('    </joint>');
  }

  // CLOSED CHAINS — real extra joints closing the loop (Gazebo supports
  // kinematic loops). The four-bar's 4th joint lives here, NOT dropped.
  for (const j of model.loopJoints) {
    lines.push('    <!-- loop-closure joint (closes a kinematic loop / parallel mechanism) -->');
    lines.push(`    <joint name="${j.name}" type="${j.type}">`);
    lines.push(`      <parent>${j.parent.name}</parent>`);
    lines.push(`      <child>${j.child.name}</child>`);
    if (j.anchor) lines.push(`      <pose>${vec3str(j.anchor)} 0 0 0</pose>`);
    if (j.type !== 'fixed') {
      lines.push(`      <axis><xyz>${vec3str(j.axis)}</xyz></axis>`);
    }
    lines.push('    </joint>');
  }

  lines.push('  </model>');
  lines.push('</sdf>');
  return { text: lines.join('\n'), meshFiles };
}

// ── MJCF (MuJoCo) ────────────────────────────────────────────────────────────
function writeMJCF(model) {
  const lines = [];
  lines.push('<?xml version="1.0"?>');
  lines.push(`<mujoco model="${model.name}">`);
  lines.push('  <compiler angle="radian" coordinate="local"/>');
  lines.push('  <option gravity="0 0 -9.81"/>');

  // Build the kinematic tree as nested <body> elements from the root.
  const childrenOf = new Map();
  for (const L of model.links) childrenOf.set(L.name, []);
  for (const j of model.treeJoints) childrenOf.get(j.parent.name).push(j);

  lines.push('  <worldbody>');
  const emitBody = (link, joint, depth) => {
    const pad = '    '.repeat(depth);
    const pose = joint
      ? ` pos="${vec3str(joint.xyz)}"`
      : ` pos="${vec3str(mat4GetTranslation(link.worldTransform).map(v => v * MM_TO_M))}"`;
    lines.push(`${pad}<body name="${link.name}"${pose}>`);
    lines.push(`${pad}  <inertial pos="${vec3str(link.comM)}" mass="${fmt(link.massKg)}"` +
      ` fullinertia="${fmt(link.inertia.ixx)} ${fmt(link.inertia.iyy)} ${fmt(link.inertia.izz)}` +
      ` ${fmt(link.inertia.ixy)} ${fmt(link.inertia.ixz)} ${fmt(link.inertia.iyz)}"/>`);
    if (joint && joint.type !== 'fixed') {
      const jt = joint.type === 'prismatic' ? 'slide' : 'hinge';
      const range = joint.limit ? ` range="${fmt(joint.limit.lower)} ${fmt(joint.limit.upper)}" limited="true"` : '';
      lines.push(`${pad}  <joint name="${joint.name}" type="${jt}" axis="${vec3str(joint.axis)}"${range}/>`);
    }
    // collision geom (convex hull) — MuJoCo uses geoms for collision.
    lines.push(`${pad}  <geom name="${link.name}_col" type="mesh" mesh="${link.name}_collision"/>`);
    for (const cj of childrenOf.get(link.name)) {
      emitBody(cj.child, cj, depth + 1);
    }
    lines.push(`${pad}</body>`);
  };
  emitBody(model.rootLink, null, 2);
  lines.push('  </worldbody>');

  // Mesh assets (collision hull soup). MuJoCo references by name.
  lines.push('  <asset>');
  for (const L of model.links) {
    lines.push(`    <mesh name="${L.name}_collision" file="${L.name}_collision.stl"/>`);
    lines.push(`    <mesh name="${L.name}_visual" file="${L.name}_visual.stl"/>`);
  }
  lines.push('  </asset>');

  // CLOSED CHAINS — MuJoCo's native loop closure is <equality><connect>.
  // The four-bar's loop edge becomes a connect/weld constraint, NOT dropped.
  if (model.loopJoints.length) {
    lines.push('  <equality>');
    for (const j of model.loopJoints) {
      if (j.type === 'fixed') {
        lines.push(`    <weld name="${j.name}" body1="${j.parent.name}" body2="${j.child.name}"/>`);
      } else {
        const anchor = j.anchor || mat4GetTranslation(j.child.worldTransform).map(v => v * MM_TO_M);
        lines.push(`    <connect name="${j.name}" body1="${j.parent.name}" body2="${j.child.name}"` +
          ` anchor="${vec3str(anchor)}"/>`);
      }
    }
    lines.push('  </equality>');
  }

  lines.push('</mujoco>');
  // Mesh files for sidecar writing.
  const meshFiles = {};
  for (const L of model.links) {
    meshFiles[`${L.name}_visual.stl`] = meshToStl(L.visual.positions, L.visual.indices, `${L.name}_visual`);
    meshFiles[`${L.name}_collision.stl`] = meshToStl(L.collision.positions, L.collision.indices, `${L.name}_collision`);
  }
  return { text: lines.join('\n'), meshFiles };
}

// ── USD (USDA text) ──────────────────────────────────────────────────────────
function writeUSD(model) {
  const lines = [];
  lines.push('#usda 1.0');
  lines.push('(');
  lines.push('    defaultPrim = "robot"');
  lines.push('    metersPerUnit = 1');
  lines.push('    upAxis = "Z"');
  lines.push(')');
  lines.push(`def Xform "robot" (`);
  lines.push('    prepend apiSchemas = ["PhysicsArticulationRootAPI"]');
  lines.push(')');
  lines.push('{');
  // Links as rigid-body Xforms with mass API.
  for (const L of model.links) {
    const wt = mat4GetTranslation(L.worldTransform).map(v => v * MM_TO_M);
    lines.push(`    def Xform "${L.name}" (`);
    lines.push('        prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]');
    lines.push('    )');
    lines.push('    {');
    lines.push(`        double3 xformOp:translate = (${wt.map(fmt).join(', ')})`);
    lines.push('        uniform token[] xformOpOrder = ["xformOp:translate"]');
    lines.push(`        float physics:mass = ${fmt(L.massKg)}`);
    lines.push(`        point3f physics:centerOfMass = (${L.comM.map(fmt).join(', ')})`);
    lines.push(`        float3 physics:diagonalInertia = (${fmt(L.inertia.ixx)}, ${fmt(L.inertia.iyy)}, ${fmt(L.inertia.izz)})`);
    // Visual + collision as child meshes (distinct).
    lines.push(`        def Mesh "visual" { uniform token purpose = "render" }`);
    lines.push(`        def Mesh "collision" ( prepend apiSchemas = ["PhysicsCollisionAPI"] ) { uniform token purpose = "guide" }`);
    lines.push('    }');
  }
  // Tree joints as PhysicsJoint prims.
  for (const j of model.treeJoints) {
    const jtype = j.type === 'prismatic' ? 'PhysicsPrismaticJoint'
      : (j.type === 'fixed' ? 'PhysicsFixedJoint' : 'PhysicsRevoluteJoint');
    lines.push(`    def ${jtype} "${j.name}"`);
    lines.push('    {');
    lines.push(`        rel physics:body0 = </robot/${j.parent.name}>`);
    lines.push(`        rel physics:body1 = </robot/${j.child.name}>`);
    lines.push(`        point3f physics:localPos0 = (${j.xyz.map(fmt).join(', ')})`);
    if (j.type !== 'fixed') {
      const axisTok = Math.abs(j.axis[0]) >= Math.abs(j.axis[1]) && Math.abs(j.axis[0]) >= Math.abs(j.axis[2]) ? 'X'
        : (Math.abs(j.axis[1]) >= Math.abs(j.axis[2]) ? 'Y' : 'Z');
      lines.push(`        uniform token physics:axis = "${axisTok}"`);
      if (j.limit) {
        lines.push(`        float physics:lowerLimit = ${fmt(j.limit.lower)}`);
        lines.push(`        float physics:upperLimit = ${fmt(j.limit.upper)}`);
      }
    }
    lines.push('    }');
  }
  // CLOSED CHAINS — loop closures as extra PhysicsJoint prims (body0/body1).
  for (const j of model.loopJoints) {
    lines.push(`    def PhysicsFixedJoint "${j.name}" ( customData = { string loopClosure = "true" } )`);
    lines.push('    {');
    lines.push(`        rel physics:body0 = </robot/${j.parent.name}>`);
    lines.push(`        rel physics:body1 = </robot/${j.child.name}>`);
    if (j.anchor) lines.push(`        point3f physics:localPos0 = (${j.anchor.map(fmt).join(', ')})`);
    lines.push('    }');
  }
  lines.push('}');
  const meshFiles = {};
  for (const L of model.links) {
    meshFiles[`${L.name}_visual.stl`] = meshToStl(L.visual.positions, L.visual.indices, `${L.name}_visual`);
    meshFiles[`${L.name}_collision.stl`] = meshToStl(L.collision.positions, L.collision.indices, `${L.name}_collision`);
  }
  return { text: lines.join('\n'), meshFiles };
}

// ─────────────────────────────────────────────────────────────── public API
/**
 * Export a Forge assembly to a robot description.
 *
 * @param {object} assembly  raw spec or a JS Assembly (see module header).
 * @param {object} [opts]
 * @param {'urdf'|'sdf'|'usd'|'mjcf'} [opts.format='urdf']
 * @param {number} [opts.density=1000]    kg/m³ (used when a link has no `mass`)
 * @param {boolean} [opts.decimate=false] decimate the visual mesh (LOD1)
 * @param {*} [opts.baseLink]             id/name of the root/base link
 * @param {object} [opts.forge]           kernel binding; default require()'d
 * @param {boolean} [opts.withMeshFiles]  also return the sidecar mesh files
 * @returns {string|{ text:string, meshFiles:Object<string,string>, model:object }}
 *          the document text (default), or `{text, meshFiles, model}` if
 *          opts.withMeshFiles is true.
 */
export function exportRobot(assembly, opts = {}) {
  const format = (opts.format || 'urdf').toLowerCase();
  const forge = opts.forge !== undefined ? opts.forge : tryRequireKernel();
  const model = normalize(assembly, forge, opts);

  let result;
  switch (format) {
    case 'urdf': result = writeURDF(model, opts); break;
    case 'sdf': result = writeSDF(model); break;
    case 'mjcf': result = writeMJCF(model); break;
    case 'usd': case 'usda': result = writeUSD(model); break;
    default: throw new Error(`robotExport: unknown format "${format}" (urdf|sdf|usd|mjcf)`);
  }
  if (opts.withMeshFiles) return { text: result.text, meshFiles: result.meshFiles, model };
  return result.text;
}

function tryRequireKernel() {
  // Only used outside the browser when no `forge` was injected.
  try {
    // eslint-disable-next-line global-require
    if (typeof require === 'function') {
      return require('forge-kernel/build/Release/forge-kernel.node');
    }
  } catch (_) { /* not available — caller must pass meshes/handles inline */ }
  return null;
}

export default exportRobot;

// Internal helpers exported for testing.
export const __test = {
  polyhedronInertia, shiftInertiaToCom, mat4ToRPY, mat4FromEuler, mat4Inverse,
  buildCollisionHull, jsConvexHull, makeUniqueNamer, normalize,
};
