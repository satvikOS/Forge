// PUSH-173 (Slice 129) — Pure-fn inertia tensor math.
//
// Companion module to InertiaTensorPanel. forge.massProps already returns
// { volume, area, centerOfMass } but it stops short of the full rigid-body
// mass moment of inertia tensor — the 3×3 symmetric matrix every dynamics,
// FEA, CFD, multi-body or balance workflow needs to plug a part into an
// equation of motion (Newton-Euler ω̇ = I⁻¹·τ, etc.).
//
// This module computes the inertia tensor from a tessellated triangle mesh
// using the divergence-theorem / tetrahedron-sum formulation:
//
// For a closed surface S enclosing a uniform-density volume V, every volume
// integral can be re-expressed as a surface integral via Gauss' theorem.
// In particular for the second moments:
//
//   Ixx = ρ ∫∫∫_V (y² + z²) dV
//   Iyy = ρ ∫∫∫_V (x² + z²) dV
//   Izz = ρ ∫∫∫_V (x² + y²) dV
//   Ixy = -ρ ∫∫∫_V x·y    dV
//   Iyz = -ρ ∫∫∫_V y·z    dV
//   Ixz = -ρ ∫∫∫_V x·z    dV
//
// The simplest and numerically-clean way to compute the integrals
// ∫_V x²·dV, ∫_V y²·dV, ∫_V z²·dV, ∫_V xy·dV, ∫_V yz·dV, ∫_V xz·dV
// is to decompose V into signed tetrahedra from the origin to each surface
// triangle and sum the closed-form moments of every tetrahedron. The
// signs cancel out the "negative" tetrahedra on the back-facing triangles,
// so the result is exact for any closed orientable mesh — same idea used
// by Mirtich's 1996 polyhedron mass-properties paper but simpler because
// we accept a small triangle count and don't need Mirtich's surface
// reduction tricks.
//
// Tetrahedron-from-origin closed-form moments (uniform density ρ=1):
//   For a tetrahedron with vertices (0, v1, v2, v3), let
//     v1=(x1,y1,z1), v2=(x2,y2,z2), v3=(x3,y3,z3).
//   Signed volume:  Vsig = (v1 · (v2 × v3)) / 6
//
//   ∫_T  x²  dV = Vsig · (x1²+x2²+x3² + x1·x2+x2·x3+x1·x3) / 10
//   ∫_T  xy  dV = Vsig · (2·x1·y1 + 2·x2·y2 + 2·x3·y3
//                       + x1·y2 + x2·y1 + x2·y3 + x3·y2
//                       + x1·y3 + x3·y1) / 20
//
//  (Analogous closed forms for y², z², yz, xz.)
//
// Then sum across every triangle (the negative tets for back-facing
// triangles get correctly subtracted by the signed volume) and apply
// the moment-of-inertia formulas above. Validate by feeding it a 60×40×30
// box (steel ρ=7.85 g/cm³) and asserting the analytic m/12·(b²+c²) etc.
//
// Units: positions in mm, density in g/cm³.
//   volume [mm³] · density [g/cm³] · 1e-3  →  mass [g]
//   ∫ x²·dV [mm⁵] · density [g/cm³] · 1e-3 →  Σmᵢxᵢ² [g·mm²]
//
// Final reported tensor is in g·mm² (small CAD-scale parts). Multiply by
// 1e-9 to convert to kg·m² for SI dynamics solvers. Both forms are
// returned so the panel can display whichever the engineer prefers.

// ─────────────────────────────────────────────────────────────────────
// Tetrahedron moment integrals from the origin.
//
// Returns an object with the six raw second-moment volume integrals over
// the signed tetrahedron (0, v1, v2, v3) for a unit-density body:
//
//   I = { sV, sXX, sYY, sZZ, sXY, sYZ, sXZ }
//
//   sV   = signed volume                  [mm³]
//   sXX  = ∫_T x² dV                       [mm⁵]
//   sYY  = ∫_T y² dV                       [mm⁵]
//   sZZ  = ∫_T z² dV                       [mm⁵]
//   sXY  = ∫_T x·y dV                      [mm⁵]
//   sYZ  = ∫_T y·z dV                      [mm⁵]
//   sXZ  = ∫_T x·z dV                      [mm⁵]
//
// All values are signed — the caller sums across every triangle and the
// negative tets on back-facing triangles cancel naturally.

function tetMoments(v1, v2, v3) {
  const x1 = v1[0], y1 = v1[1], z1 = v1[2];
  const x2 = v2[0], y2 = v2[1], z2 = v2[2];
  const x3 = v3[0], y3 = v3[1], z3 = v3[2];

  // Signed tetrahedron volume = v1 · (v2 × v3) / 6.
  const cx = y2 * z3 - z2 * y3;
  const cy = z2 * x3 - x2 * z3;
  const cz = x2 * y3 - y2 * x3;
  const sV = (x1 * cx + y1 * cy + z1 * cz) / 6;

  // Second moments — closed form for a tet with one vertex at the origin.
  // The cubic coefficient 6·Vsig/60 = Vsig/10 factor comes from integrating
  // the affine map (u·v1 + v·v2 + w·v3) where u+v+w ≤ 1 over the simplex.
  //
  //   ∫ x²·dV = Vsig/10 · (x1²+x2²+x3² + x1·x2+x2·x3+x1·x3)
  //
  // (Equivalent to Tonon 2004 / Mirtich 1996 specialised for tet-from-origin.)
  const sXX = sV * (x1 * x1 + x2 * x2 + x3 * x3
                  + x1 * x2 + x2 * x3 + x1 * x3) / 10;
  const sYY = sV * (y1 * y1 + y2 * y2 + y3 * y3
                  + y1 * y2 + y2 * y3 + y1 * y3) / 10;
  const sZZ = sV * (z1 * z1 + z2 * z2 + z3 * z3
                  + z1 * z2 + z2 * z3 + z1 * z3) / 10;

  // Mixed moments — Vsig/20 prefactor (degree-2 mixed monomials integrate
  // to the same affine combination with the extra symmetry factor).
  //
  //   ∫ x·y dV = Vsig/20 · ( 2·(x1·y1 + x2·y2 + x3·y3)
  //                        + x1·y2 + x2·y1
  //                        + x2·y3 + x3·y2
  //                        + x1·y3 + x3·y1 )
  const sXY = sV * (
      2 * (x1 * y1 + x2 * y2 + x3 * y3)
    + x1 * y2 + x2 * y1
    + x2 * y3 + x3 * y2
    + x1 * y3 + x3 * y1
  ) / 20;
  const sYZ = sV * (
      2 * (y1 * z1 + y2 * z2 + y3 * z3)
    + y1 * z2 + y2 * z1
    + y2 * z3 + y3 * z2
    + y1 * z3 + y3 * z1
  ) / 20;
  const sXZ = sV * (
      2 * (x1 * z1 + x2 * z2 + x3 * z3)
    + x1 * z2 + x2 * z1
    + x2 * z3 + x3 * z2
    + x1 * z3 + x3 * z1
  ) / 20;

  return { sV, sXX, sYY, sZZ, sXY, sYZ, sXZ };
}

// ─────────────────────────────────────────────────────────────────────
// Jacobi eigendecomposition of a real symmetric 3×3 matrix.
//
// Returns eigenvalues (ascending) + right-handed orthonormal eigenvectors.
// Same algorithm as kernel/brep/BrepQuery.js — duplicated locally so this
// pure module has zero kernel imports and runs in any context (Web Worker,
// headless test, etc.). Iterative off-diagonal annihilation; converges
// quadratically on a symmetric input. 32 sweeps is plenty for a 3×3.
//
// @param {number[][]} A   3×3 symmetric matrix
// @returns {{eigenvalues:number[], eigenvectors:number[][]}}

export function jacobi3(A, maxSweeps = 32) {
  const a = [
    [A[0][0], A[0][1], A[0][2]],
    [A[1][0], A[1][1], A[1][2]],
    [A[2][0], A[2][1], A[2][2]],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-14) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = a[p][q];
        if (Math.abs(apq) < 1e-18) continue;
        const app = a[p][p], aqq = a[q][q];
        let theta;
        if (Math.abs(apq) < 1e-300) {
          theta = 0;
        } else {
          theta = (aqq - app) / (2 * apq);
        }
        let t;
        if (Math.abs(theta) > 1e16) {
          t = 1 / (2 * theta);
        } else {
          t = Math.sign(theta) / (Math.abs(theta) + Math.sqrt(1 + theta * theta));
        }
        if (theta === 0) t = 1;
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        const newApp = app - t * apq;
        const newAqq = aqq + t * apq;
        a[p][p] = newApp;
        a[q][q] = newAqq;
        a[p][q] = 0;
        a[q][p] = 0;
        for (let r = 0; r < 3; r++) {
          if (r !== p && r !== q) {
            const arp = a[r][p];
            const arq = a[r][q];
            a[r][p] = c * arp - s * arq;
            a[p][r] = a[r][p];
            a[r][q] = s * arp + c * arq;
            a[q][r] = a[r][q];
          }
        }
        for (let r = 0; r < 3; r++) {
          const vrp = v[r][p];
          const vrq = v[r][q];
          v[r][p] = c * vrp - s * vrq;
          v[r][q] = s * vrp + c * vrq;
        }
      }
    }
  }
  const eigs = [
    { val: a[0][0], vec: [v[0][0], v[1][0], v[2][0]] },
    { val: a[1][1], vec: [v[0][1], v[1][1], v[2][1]] },
    { val: a[2][2], vec: [v[0][2], v[1][2], v[2][2]] },
  ];
  eigs.sort((p, q) => p.val - q.val);
  const vec1 = eigs[0].vec, vec2 = eigs[1].vec, vec3 = eigs[2].vec;
  const det = (
    vec1[0] * (vec2[1] * vec3[2] - vec2[2] * vec3[1])
    - vec1[1] * (vec2[0] * vec3[2] - vec2[2] * vec3[0])
    + vec1[2] * (vec2[0] * vec3[1] - vec2[1] * vec3[0])
  );
  if (det < 0) {
    eigs[2].vec = [-vec3[0], -vec3[1], -vec3[2]];
  }
  return {
    eigenvalues: eigs.map(e => e.val),
    eigenvectors: eigs.map(e => e.vec),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Public surface.
//
// computeInertiaFromMesh(positions, indices, density)
//
//   positions  — Float32Array | number[] of XYZ triples (mm). Length must
//                be a multiple of 3.
//   indices    — Uint32Array  | number[] of triangle vertex indices into
//                positions. Length must be a multiple of 3. If omitted,
//                positions is treated as a flat triangle list (3 verts per
//                triangle).
//   density    — material density in g/cm³ (steel = 7.85, aluminum = 2.70).
//                Defaults to 1 (geometric tensor only).
//
// Returns:
//   {
//     volume:           [mm³]                    ,
//     mass:             [g]                       ,
//     centerOfMass:     [x,y,z] in mm             ,
//     Ixx, Iyy, Izz:    diagonal moments [g·mm²]  ,
//     Ixy, Iyz, Ixz:    products of inertia [g·mm²] (the SIGNED -ρ∫xy form),
//     tensor:           3×3 symmetric matrix      ,
//     principalMoments: ascending eigenvalues    ,
//     principalAxes:    matching unit eigenvectors,
//     tensorSi:         3×3 matrix in [kg·m²]    ,
//     principalMomentsSi: ascending eigenvalues in [kg·m²],
//     aboutCentroid:    boolean — true if the tensor was shifted via the
//                       parallel-axis theorem to the centroid (default: true)
//   }
//
// Tensor convention: the returned 3×3 has the diagonal as the moments
// (positive) and the off-diagonals as the SIGNED products of inertia
// I_xy = -∫xy·dm (the standard rigid-body dynamics form so the tensor is
// positive-semidefinite and can be plugged straight into Newton-Euler).

const G_PER_CC_TO_G_PER_MM3 = 1e-3;     // 1 g/cm³ = 1e-3 g/mm³
const G_MM2_TO_KG_M2        = 1e-9;     // 1 g·mm² = 1e-9 kg·m²

function isFiniteArr(arr) {
  if (!arr) return false;
  if (typeof arr.length !== 'number' || arr.length === 0) return false;
  // Spot-check the first few — full validation would dominate runtime.
  for (let i = 0; i < Math.min(arr.length, 6); i++) {
    if (!Number.isFinite(arr[i])) return false;
  }
  return true;
}

export function computeInertiaFromMesh(positions, indices, density = 1) {
  if (!isFiniteArr(positions)) {
    throw new Error('computeInertiaFromMesh: positions must be a non-empty numeric array of XYZ triples');
  }
  if (positions.length % 3 !== 0) {
    throw new Error(`computeInertiaFromMesh: positions length ${positions.length} is not a multiple of 3`);
  }
  // If no indices provided, treat positions as a flat triangle soup —
  // 3 vertices per triangle, in order.
  let triCount;
  let resolveTriangle;
  if (indices == null) {
    triCount = (positions.length / 3) / 3 | 0;
    resolveTriangle = (t) => {
      const i = t * 9;
      return [
        [positions[i + 0], positions[i + 1], positions[i + 2]],
        [positions[i + 3], positions[i + 4], positions[i + 5]],
        [positions[i + 6], positions[i + 7], positions[i + 8]],
      ];
    };
  } else {
    if (indices.length % 3 !== 0) {
      throw new Error(`computeInertiaFromMesh: indices length ${indices.length} is not a multiple of 3`);
    }
    triCount = (indices.length / 3) | 0;
    resolveTriangle = (t) => {
      const i = t * 3;
      const ia = indices[i + 0] * 3;
      const ib = indices[i + 1] * 3;
      const ic = indices[i + 2] * 3;
      return [
        [positions[ia], positions[ia + 1], positions[ia + 2]],
        [positions[ib], positions[ib + 1], positions[ib + 2]],
        [positions[ic], positions[ic + 1], positions[ic + 2]],
      ];
    };
  }
  if (triCount === 0) {
    throw new Error('computeInertiaFromMesh: no triangles in mesh');
  }
  if (!Number.isFinite(density) || density <= 0) {
    throw new Error(`computeInertiaFromMesh: density must be a positive number (got ${density})`);
  }

  // ── Sum tetrahedron-from-origin moments across every triangle ──────
  // First-moment integrals (volume + COM):
  //   V   = Σ sV
  //   ∫ x dV = Σ (sV · (x1+x2+x3) / 4)     (centroid of tet at avg of 4 verts incl. origin)
  //
  // Second-moment integrals come straight from tetMoments().
  let V = 0;
  let mx = 0, my = 0, mz = 0;
  let IXX = 0, IYY = 0, IZZ = 0;
  let IXY = 0, IYZ = 0, IXZ = 0;

  for (let t = 0; t < triCount; t++) {
    const [v1, v2, v3] = resolveTriangle(t);
    const tm = tetMoments(v1, v2, v3);
    V   += tm.sV;
    // First-moment of a tet with one vertex at origin = sV · (0+v1+v2+v3)/4
    mx += tm.sV * (v1[0] + v2[0] + v3[0]) / 4;
    my += tm.sV * (v1[1] + v2[1] + v3[1]) / 4;
    mz += tm.sV * (v1[2] + v2[2] + v3[2]) / 4;
    IXX += tm.sXX;
    IYY += tm.sYY;
    IZZ += tm.sZZ;
    IXY += tm.sXY;
    IYZ += tm.sYZ;
    IXZ += tm.sXZ;
  }

  // Mesh winding might be reversed → signed volume comes out negative.
  // All the moments are integrated with the same sign so we just take the
  // absolute volume and flip the integrals accordingly.
  let signFlip = 1;
  if (V < 0) {
    signFlip = -1;
    V = -V;
    mx = -mx; my = -my; mz = -mz;
    IXX = -IXX; IYY = -IYY; IZZ = -IZZ;
    IXY = -IXY; IYZ = -IYZ; IXZ = -IXZ;
  }
  if (V < 1e-12) {
    throw new Error(`computeInertiaFromMesh: mesh enclosed volume is effectively zero (${V})`);
  }

  // ── Centroid ───────────────────────────────────────────────────────
  // (Geometric — the centre-of-mass is the same for a uniform-density body.)
  const cx = mx / V;
  const cy = my / V;
  const cz = mz / V;

  // ── About-origin geometric tensor in mm⁵ ────────────────────────────
  // Inertia about the origin (unit density):
  //   Ixx_O = ∫ (y² + z²) dV  = IYY + IZZ
  //   Iyy_O = ∫ (x² + z²) dV  = IXX + IZZ
  //   Izz_O = ∫ (x² + y²) dV  = IXX + IYY
  //   Ixy_O = -∫ xy dV         = -IXY     (negative for the convention)
  //   Iyz_O = -∫ yz dV         = -IYZ
  //   Ixz_O = -∫ xz dV         = -IXZ
  const Ixx_O = IYY + IZZ;
  const Iyy_O = IXX + IZZ;
  const Izz_O = IXX + IYY;
  const Ixy_O = -IXY;
  const Iyz_O = -IYZ;
  const Ixz_O = -IXZ;

  // ── Parallel-axis shift to centroid ─────────────────────────────────
  // I_centroid = I_origin - V · [ centroid-shift terms ]
  //
  //   Ixx_C = Ixx_O - V·(cy² + cz²)
  //   Iyy_C = Iyy_O - V·(cx² + cz²)
  //   Izz_C = Izz_O - V·(cx² + cy²)
  //   Ixy_C = Ixy_O + V·cx·cy
  //   Iyz_C = Iyz_O + V·cy·cz
  //   Ixz_C = Ixz_O + V·cx·cz
  const Ixx_C = Ixx_O - V * (cy * cy + cz * cz);
  const Iyy_C = Iyy_O - V * (cx * cx + cz * cz);
  const Izz_C = Izz_O - V * (cx * cx + cy * cy);
  const Ixy_C = Ixy_O + V * cx * cy;
  const Iyz_C = Iyz_O + V * cy * cz;
  const Ixz_C = Ixz_O + V * cx * cz;

  // ── Multiply by density to get mass-moment of inertia in g·mm² ──────
  const rhoMm3 = density * G_PER_CC_TO_G_PER_MM3;   // g/mm³
  const Ixx = Ixx_C * rhoMm3;
  const Iyy = Iyy_C * rhoMm3;
  const Izz = Izz_C * rhoMm3;
  const Ixy = Ixy_C * rhoMm3;
  const Iyz = Iyz_C * rhoMm3;
  const Ixz = Ixz_C * rhoMm3;

  const mass = V * rhoMm3;

  // Symmetric matrix.
  const tensor = [
    [Ixx, Ixy, Ixz],
    [Ixy, Iyy, Iyz],
    [Ixz, Iyz, Izz],
  ];

  // ── Principal moments + axes via Jacobi ────────────────────────────
  const { eigenvalues, eigenvectors } = jacobi3(tensor);

  // SI cross-check tensor (kg·m²).
  const tensorSi = [
    [tensor[0][0] * G_MM2_TO_KG_M2, tensor[0][1] * G_MM2_TO_KG_M2, tensor[0][2] * G_MM2_TO_KG_M2],
    [tensor[1][0] * G_MM2_TO_KG_M2, tensor[1][1] * G_MM2_TO_KG_M2, tensor[1][2] * G_MM2_TO_KG_M2],
    [tensor[2][0] * G_MM2_TO_KG_M2, tensor[2][1] * G_MM2_TO_KG_M2, tensor[2][2] * G_MM2_TO_KG_M2],
  ];
  const principalMomentsSi = eigenvalues.map((e) => e * G_MM2_TO_KG_M2);

  return {
    volume: V,
    mass,
    centerOfMass: [cx, cy, cz],
    Ixx, Iyy, Izz, Ixy, Iyz, Ixz,
    tensor,
    tensorSi,
    principalMoments: eigenvalues,
    principalAxes: eigenvectors,
    principalMomentsSi,
    aboutCentroid: true,
    triangleCount: triCount,
    windingFlipped: signFlip < 0,
  };
}

// Constants the panel/tests reference directly.
export const INERTIA_UNITS = Object.freeze({
  TENSOR:       'g·mm²',
  TENSOR_SI:    'kg·m²',
  VOLUME:       'mm³',
  MASS:         'g',
  COM:          'mm',
});

export default computeInertiaFromMesh;
