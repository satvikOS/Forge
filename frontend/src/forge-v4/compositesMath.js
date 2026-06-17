// PUSH-144 (Slice-104) — Composites layup pure math.
//
// Classical Lamination Theory (CLT) for laminated fibre-reinforced
// composites. The standard aerospace ply book (Boeing / Airbus) tracks
// each layer's:
//
//   * material  — Unidirectional CFRP (UD), Woven CFRP / GFRP, or core
//                 (foam / honeycomb). Material picks the orthotropic
//                 stiffness {E1, E2, G12, nu12} for that ply.
//   * orientation — fibre angle in degrees relative to the laminate
//                 reference axis (0 / +45 / -45 / 90 are the common
//                 ones; custom angles are allowed).
//   * thickness — single-ply cured thickness in mm (typical UD prepreg
//                 ply ≈ 0.125 mm; woven ≈ 0.25 mm; core 1..30 mm).
//   * count     — number of identical plies represented by the row.
//   * areaMm2   — planform area (mm²) used for the mass-per-row roll-up.
//
// This module exposes ONLY pure functions — no React, no DOM, no
// localStorage access. The panel hosts the side-effects.
//
// All formulas are textbook CLT (e.g. Jones "Mechanics of Composite
// Materials" §4, Reddy "Mechanics of Laminated Composite Plates and
// Shells" §3). Q-bar (rotated reduced stiffness) is derived directly
// from the orthotropic plane-stress {E1, E2, G12, nu12} for each
// material; A / B / D matrices are the standard integrals through the
// laminate thickness.

// ─────────────────────────────────────────────────────────────────────
// Material reference — aerospace lamina engineering constants.
//
// Values are mid-range "design allowables" for prepreg-grade pre-impreg
// material, from public Hexcel / Toray datasheets and ESDU. We only
// need them for stiffness arithmetic so the precise number isn't
// load-bearing, but the ratios (E1/E2 ≈ 10..20 for UD; ≈ 1 for woven)
// are real and steer the ABD matrix to the right magnitudes.

// Strength allowables (MPa) — fibre / matrix / shear ultimates, used by
// the Tsai-Wu / Tsai-Hill / max-stress polynomial failure criteria below.
// Magnitudes from public Hexcel / Toray data sheets:
//   * UD CFRP T700/M21    : Xt 2100, Xc 1200, Yt 60, Yc 250, S 90 MPa.
//   * Woven CFRP          : Xt = Yt 850, Xc = Yc 700, S 110 MPa.
//   * Nomex honeycomb     : Xt = Yt = 1, Xc = Yc = 1, S = 1 MPa (placeholder
//                           — cores rarely drive ply-level Tsai-Wu, the
//                           skin plies do).
export const COMPOSITE_MATERIALS = Object.freeze({
  'UD CFRP': Object.freeze({
    label: 'UD CFRP (T700/M21)',
    family: 'cfrp-ud',
    density_g_cm3: 1.58,
    E1_GPa: 135,
    E2_GPa: 9.5,
    G12_GPa: 4.5,
    nu12: 0.31,
    nominalPlyThickness_mm: 0.125,
    // Strength allowables (PUSH-223): ultimate tensile / compressive / shear.
    Xt_MPa: 2100, Xc_MPa: 1200,
    Yt_MPa:   60, Yc_MPa:  250,
    S_MPa:    90,
  }),
  'Woven': Object.freeze({
    label: 'Woven CFRP plain weave',
    family: 'cfrp-woven',
    density_g_cm3: 1.50,
    E1_GPa: 60,
    E2_GPa: 60,
    G12_GPa: 4.2,
    nu12: 0.05,
    nominalPlyThickness_mm: 0.25,
    Xt_MPa: 850, Xc_MPa: 700,
    Yt_MPa: 850, Yc_MPa: 700,
    S_MPa:  110,
  }),
  'Core': Object.freeze({
    label: 'Core (Nomex honeycomb 48 kg/m³)',
    family: 'core',
    density_g_cm3: 0.048,
    E1_GPa: 0.06,
    E2_GPa: 0.06,
    G12_GPa: 0.02,
    nu12: 0.30,
    nominalPlyThickness_mm: 10.0,
    Xt_MPa: 1.5, Xc_MPa: 1.5,
    Yt_MPa: 1.5, Yc_MPa: 1.5,
    S_MPa:  0.8,
  }),
});

export const COMPOSITE_MATERIAL_IDS = Object.freeze(
  Object.keys(COMPOSITE_MATERIALS),
);

export const STANDARD_ORIENTATIONS = Object.freeze([0, 45, -45, 90]);

// ─────────────────────────────────────────────────────────────────────
// Default starter layup — empty ply book.

export function makeEmptyPlyBook() {
  return {
    version: 1,
    name: 'Untitled layup',
    plies: [],
  };
}

// Helper — quasi-isotropic [0/+45/-45/90]s symmetric balanced layup.
// 5 unique plies above the midplane, plus their mirror images below
// (symmetric stack -> 10 plies total). This is the canonical
// aerospace stress-engineering proof case.
export function makeQuasiIsoLayup({
  material = 'UD CFRP',
  thickness_mm = COMPOSITE_MATERIALS['UD CFRP'].nominalPlyThickness_mm,
  area_mm2 = 100 * 100,
} = {}) {
  const upper = [0, 45, -45, 90, 0];
  const plies = [];
  // Upper half (top → mid), keep ordering.
  upper.forEach((orient, i) => {
    plies.push({
      id: `ply-up-${i}`,
      material,
      orientation_deg: orient,
      thickness_mm,
      count: 1,
      area_mm2,
    });
  });
  // Mirror (mid → bottom). Symmetric stack mirrors the same orientation
  // sequence below the midplane.
  upper.slice().reverse().forEach((orient, i) => {
    plies.push({
      id: `ply-dn-${i}`,
      material,
      orientation_deg: orient,
      thickness_mm,
      count: 1,
      area_mm2,
    });
  });
  return {
    version: 1,
    name: '[0/45/-45/90]s quasi-iso',
    plies,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Per-ply roll-ups.

export function normalisePly(p) {
  if (!p || typeof p !== 'object') return null;
  const material = COMPOSITE_MATERIALS[p.material] ? p.material : 'UD CFRP';
  const orientation_deg = Number.isFinite(+p.orientation_deg)
    ? +p.orientation_deg : 0;
  const thickness_mm = Math.max(0.001,
    Number.isFinite(+p.thickness_mm) ? +p.thickness_mm
      : COMPOSITE_MATERIALS[material].nominalPlyThickness_mm);
  const count = Math.max(1, Math.floor(+p.count || 1));
  const area_mm2 = Math.max(1, +p.area_mm2 || 1);
  return {
    id: p.id || `ply-${Math.random().toString(36).slice(2, 9)}`,
    material,
    orientation_deg,
    thickness_mm,
    count,
    area_mm2,
  };
}

// Expand a {material, orientation, thickness, count} row into N unit
// plies (one per `count`). Through-thickness order is preserved.
export function expandPlies(book) {
  const out = [];
  const plies = Array.isArray(book?.plies) ? book.plies : [];
  for (const raw of plies) {
    const p = normalisePly(raw);
    if (!p) continue;
    for (let i = 0; i < p.count; i += 1) {
      out.push({
        material: p.material,
        orientation_deg: p.orientation_deg,
        thickness_mm: p.thickness_mm,
        area_mm2: p.area_mm2,
      });
    }
  }
  return out;
}

// Total cured laminate thickness — sum of (count × thickness) over rows.
export function totalThickness_mm(book) {
  let t = 0;
  for (const raw of Array.isArray(book?.plies) ? book.plies : []) {
    const p = normalisePly(raw);
    if (!p) continue;
    t += p.count * p.thickness_mm;
  }
  return t;
}

// Per-row mass (g) = ρ (g/cm³) × thickness (mm = 0.1 cm) × area (mm² =
// 0.01 cm²) × count. We keep units in g so the panel just prints
// numbers directly.
export function rowMass_g(p) {
  const m = COMPOSITE_MATERIALS[p.material] || COMPOSITE_MATERIALS['UD CFRP'];
  const t_cm = p.thickness_mm * 0.1;
  const a_cm2 = p.area_mm2 * 0.01;
  return m.density_g_cm3 * t_cm * a_cm2 * p.count;
}

export function totalMass_g(book) {
  let m = 0;
  for (const raw of Array.isArray(book?.plies) ? book.plies : []) {
    const p = normalisePly(raw);
    if (!p) continue;
    m += rowMass_g(p);
  }
  return m;
}

// ─────────────────────────────────────────────────────────────────────
// Symmetric & balanced checks.
//
// Symmetric: ply k and ply (N - 1 - k) have identical {material,
// orientation, thickness} for every k. Symmetry zeroes the B-matrix
// (no in-plane / bending coupling) — a hard requirement on every
// production aerospace primary structure.
//
// Balanced: for every ply at +θ there is a matching ply at -θ of the
// same material + thickness. Balance zeroes A16 / A26 (no extensional /
// shear coupling). For an aerospace skin you want BOTH symmetric AND
// balanced — that's the textbook definition of a quasi-isotropic stack.

export function isSymmetric(book) {
  const seq = expandPlies(book);
  const N = seq.length;
  if (N === 0) return { ok: false, reason: 'no plies' };
  for (let k = 0; k < Math.floor(N / 2); k += 1) {
    const a = seq[k];
    const b = seq[N - 1 - k];
    if (a.material !== b.material) {
      return { ok: false, reason: `ply ${k + 1} vs ${N - k} material mismatch (${a.material} ≠ ${b.material})` };
    }
    if (a.orientation_deg !== b.orientation_deg) {
      return { ok: false, reason: `ply ${k + 1} vs ${N - k} orientation mismatch (${a.orientation_deg}° ≠ ${b.orientation_deg}°)` };
    }
    if (Math.abs(a.thickness_mm - b.thickness_mm) > 1e-6) {
      return { ok: false, reason: `ply ${k + 1} vs ${N - k} thickness mismatch (${a.thickness_mm} ≠ ${b.thickness_mm})` };
    }
  }
  return { ok: true };
}

export function isBalanced(book) {
  const seq = expandPlies(book);
  if (seq.length === 0) return { ok: false, reason: 'no plies' };
  // Sum thickness at +θ vs -θ buckets, skip 0 / 90 (their own mirrors).
  const buckets = new Map();
  for (const p of seq) {
    const a = p.orientation_deg;
    if (a === 0 || Math.abs(Math.abs(a) - 90) < 1e-6) continue;
    const key = `${p.material}|${Math.abs(a).toFixed(4)}`;
    if (!buckets.has(key)) buckets.set(key, { pos: 0, neg: 0 });
    const slot = buckets.get(key);
    if (a > 0) slot.pos += p.thickness_mm;
    else slot.neg += p.thickness_mm;
  }
  for (const [key, slot] of buckets.entries()) {
    if (Math.abs(slot.pos - slot.neg) > 1e-6) {
      return {
        ok: false,
        reason: `${key} unbalanced (+θ Σ=${slot.pos.toFixed(4)} mm vs -θ Σ=${slot.neg.toFixed(4)} mm)`,
      };
    }
  }
  return { ok: true };
}

// Convenience: both checks plus the total thickness — what the panel
// needs to render its summary row in one call.
export function summarise(book) {
  return {
    plyCount: expandPlies(book).length,
    totalThickness_mm: totalThickness_mm(book),
    totalMass_g: totalMass_g(book),
    symmetric: isSymmetric(book),
    balanced: isBalanced(book),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Classical Lamination Theory ABD matrices.
//
// Plane-stress reduced stiffness for an orthotropic lamina:
//
//   Q11 = E1 / (1 - nu12 * nu21)
//   Q22 = E2 / (1 - nu12 * nu21)
//   Q12 = nu12 * E2 / (1 - nu12 * nu21)
//   Q66 = G12
//   nu21 = nu12 * E2 / E1
//
// We return Q in GPa so the ABD matrices come out in (N·mm / mm)
// units = N/mm for A, N for B, N·mm for D — the aerospace conventional
// units. Numerical magnitude check: for a single 0.125 mm UD CFRP ply
// A11 ≈ Q11_GPa * t_mm * 1e3 = 135 * 0.125 * 1e3 = 16'875 N/mm.

export function reducedStiffness(materialId) {
  const m = COMPOSITE_MATERIALS[materialId] || COMPOSITE_MATERIALS['UD CFRP'];
  const E1 = m.E1_GPa;
  const E2 = m.E2_GPa;
  const G12 = m.G12_GPa;
  const nu12 = m.nu12;
  const nu21 = nu12 * E2 / E1;
  const denom = 1 - nu12 * nu21;
  return {
    Q11: E1 / denom,
    Q22: E2 / denom,
    Q12: nu12 * E2 / denom,
    Q66: G12,
  };
}

// Rotated Q-bar for ply at angle θ (degrees). Standard CLT
// transformation per Jones eq. (2.80–2.84).
export function rotatedQ(materialId, orientation_deg) {
  const Q = reducedStiffness(materialId);
  const theta = orientation_deg * Math.PI / 180;
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const c2 = c * c, s2 = s * s, c4 = c2 * c2, s4 = s2 * s2, c2s2 = c2 * s2;
  const Q11 = Q.Q11, Q22 = Q.Q22, Q12 = Q.Q12, Q66 = Q.Q66;
  return {
    Q11b: Q11 * c4 + 2 * (Q12 + 2 * Q66) * c2s2 + Q22 * s4,
    Q22b: Q11 * s4 + 2 * (Q12 + 2 * Q66) * c2s2 + Q22 * c4,
    Q12b: (Q11 + Q22 - 4 * Q66) * c2s2 + Q12 * (c4 + s4),
    Q66b: (Q11 + Q22 - 2 * Q12 - 2 * Q66) * c2s2 + Q66 * (c4 + s4),
    Q16b: (Q11 - Q12 - 2 * Q66) * c * c * c * s
        - (Q22 - Q12 - 2 * Q66) * s * s * s * c,
    Q26b: (Q11 - Q12 - 2 * Q66) * c * s * s * s
        - (Q22 - Q12 - 2 * Q66) * s * c * c * c,
  };
}

// ABD matrices for the full laminate stack (book).
//
//   A_ij = Σ_k Q-bar_ij^k · (z_k - z_{k-1})
//   B_ij = (1/2) Σ_k Q-bar_ij^k · (z_k² - z_{k-1}²)
//   D_ij = (1/3) Σ_k Q-bar_ij^k · (z_k³ - z_{k-1}³)
//
// z is measured from the laminate midplane. We expand counts so each
// row contributes `count` identical plies in sequence.
//
// Returned matrices are 3×3 row-major arrays. Units (assuming Q in GPa
// and z in mm):
//   * A: GPa·mm = kN/mm — divide by 1e-3 to get N/mm. We return GPa·mm
//        directly so the caller can compose freely; the panel converts
//        to N/mm for display.
//   * B: GPa·mm² = N
//   * D: GPa·mm³ = N·mm
export function computeABD(book) {
  const seq = expandPlies(book);
  const N = seq.length;
  const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const B = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const D = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  if (N === 0) return { A, B, D, totalThickness_mm: 0, plyCount: 0 };
  const tTotal = seq.reduce((s, p) => s + p.thickness_mm, 0);
  let z = -tTotal / 2;
  for (const p of seq) {
    const qbar = rotatedQ(p.material, p.orientation_deg);
    const z_k_1 = z;
    const z_k = z + p.thickness_mm;
    const dz1 = (z_k - z_k_1);
    const dz2 = (z_k * z_k - z_k_1 * z_k_1) / 2;
    const dz3 = (z_k * z_k * z_k - z_k_1 * z_k_1 * z_k_1) / 3;
    const q11 = qbar.Q11b, q12 = qbar.Q12b, q22 = qbar.Q22b;
    const q16 = qbar.Q16b, q26 = qbar.Q26b, q66 = qbar.Q66b;
    A[0][0] += q11 * dz1; A[0][1] += q12 * dz1; A[0][2] += q16 * dz1;
    A[1][0] += q12 * dz1; A[1][1] += q22 * dz1; A[1][2] += q26 * dz1;
    A[2][0] += q16 * dz1; A[2][1] += q26 * dz1; A[2][2] += q66 * dz1;
    B[0][0] += q11 * dz2; B[0][1] += q12 * dz2; B[0][2] += q16 * dz2;
    B[1][0] += q12 * dz2; B[1][1] += q22 * dz2; B[1][2] += q26 * dz2;
    B[2][0] += q16 * dz2; B[2][1] += q26 * dz2; B[2][2] += q66 * dz2;
    D[0][0] += q11 * dz3; D[0][1] += q12 * dz3; D[0][2] += q16 * dz3;
    D[1][0] += q12 * dz3; D[1][1] += q22 * dz3; D[1][2] += q26 * dz3;
    D[2][0] += q16 * dz3; D[2][1] += q26 * dz3; D[2][2] += q66 * dz3;
    z = z_k;
  }
  // Clean ε-noise so {symmetric, balanced} stacks read as clean zeros
  // for the B-matrix and the off-diagonal A16/A26 etc.
  const clean = (M) => M.map((row) => row.map((v) =>
    Math.abs(v) < 1e-9 ? 0 : v));
  return {
    A: clean(A),
    B: clean(B),
    D: clean(D),
    totalThickness_mm: tTotal,
    plyCount: N,
  };
}

// ─────────────────────────────────────────────────────────────────────
// PUSH-223 — Polynomial / max-stress failure criteria per ply.
//
// All criteria operate on the LAMINA stress vector σ_local = {σ1, σ2, τ12}
// in the ply's principal material axes (1 = fibre, 2 = transverse).
// A laminate analyst must first rotate the global laminate stress
// (σx, σy, τxy) into the ply axes via the standard transformation
//     σ_local = T(θ) · σ_global
// with
//     T = [[ c²,  s², 2sc ],
//          [ s²,  c², -2sc ],
//          [-sc, sc,  c² - s² ]]
// where c = cos θ, s = sin θ.
//
// Reserve factor (RF) = "the scalar by which σ can be multiplied before
// failure". For linear scaling σ → R·σ, the criteria become:
//
//   max-stress:  RF = min over fibre / transverse / shear envelopes.
//   Tsai-Hill:   1 = (Rσ1/X)² − (Rσ1·Rσ2/X²) + (Rσ2/Y)² + (Rτ12/S)²
//                  ⇒ RF² = 1 / [(σ1/X)² − σ1σ2/X² + (σ2/Y)² + (τ12/S)²]
//                  (X picks Xt or Xc by sign of σ1; Y picks Yt or Yc.)
//   Tsai-Wu:     F1·σ1 + F2·σ2 + F11·σ1² + F22·σ2² + F66·τ12²
//                     + 2·F12·σ1·σ2 = 1
//                with
//                   F1  = 1/Xt − 1/Xc
//                   F11 = 1/(Xt·Xc)
//                   F2  = 1/Yt − 1/Yc
//                   F22 = 1/(Yt·Yc)
//                   F66 = 1/S²
//                   F12 = −½ √(F11 · F22)        (Tsai-Wu interaction)
//                Solve the quadratic a·R² + b·R − 1 = 0 with
//                   a = F11·σ1² + F22·σ2² + F66·τ12² + 2·F12·σ1·σ2
//                   b = F1·σ1 + F2·σ2
//                ⇒ RF = (−b + √(b² + 4a)) / (2a)
//
// Returns { RF, FI_at_unit_load }. The "failure index" FI is the LHS of
// the Tsai criterion evaluated at the actual stress (FI ≥ 1 ⇒ failed).
// For max-stress, FI = 1/RF.

/**
 * Rotate (σx, σy, τxy) from the laminate axes into the ply principal
 * (1, 2, 12) axes for a ply at angle θ degrees.
 */
export function rotateStressToPly(sigGlobal, orientation_deg) {
  const theta = orientation_deg * Math.PI / 180;
  const c = Math.cos(theta), s = Math.sin(theta);
  const c2 = c * c, s2 = s * s, cs = c * s;
  const sx = sigGlobal[0], sy = sigGlobal[1], sxy = sigGlobal[2];
  return [
    c2 * sx + s2 * sy + 2 * cs * sxy,        // σ1
    s2 * sx + c2 * sy - 2 * cs * sxy,        // σ2
    -cs * sx + cs * sy + (c2 - s2) * sxy,    // τ12
  ];
}

/**
 * Material strength allowables — read from COMPOSITE_MATERIALS or fall
 * back to a UD CFRP placeholder. Units MPa.
 */
export function plyAllowables(materialId) {
  const m = COMPOSITE_MATERIALS[materialId] || COMPOSITE_MATERIALS['UD CFRP'];
  return {
    Xt: +m.Xt_MPa || 1, Xc: +m.Xc_MPa || 1,
    Yt: +m.Yt_MPa || 1, Yc: +m.Yc_MPa || 1,
    S:  +m.S_MPa  || 1,
  };
}

/**
 * Max-stress criterion. Returns { mode, RF, FI }.
 *   mode = 'fibre+' / 'fibre−' / 'matrix+' / 'matrix−' / 'shear'
 */
export function maxStressFailure(sigPly, materialId) {
  const A = plyAllowables(materialId);
  const [s1, s2, t12] = sigPly;
  const eps = 1e-300;
  const RF_f = s1 >= 0 ? (A.Xt / Math.max(Math.abs(s1), eps))
                       : (A.Xc / Math.max(Math.abs(s1), eps));
  const RF_m = s2 >= 0 ? (A.Yt / Math.max(Math.abs(s2), eps))
                       : (A.Yc / Math.max(Math.abs(s2), eps));
  const RF_s = A.S / Math.max(Math.abs(t12), eps);
  const RF_arr = [RF_f, RF_m, RF_s];
  const modes  = [
    s1 >= 0 ? 'fibre+' : 'fibre-',
    s2 >= 0 ? 'matrix+' : 'matrix-',
    'shear',
  ];
  let RF = RF_arr[0], idx = 0;
  for (let i = 1; i < 3; i++) {
    if (RF_arr[i] < RF) { RF = RF_arr[i]; idx = i; }
  }
  return { mode: modes[idx], RF, FI: RF > 0 ? 1 / RF : Infinity };
}

/**
 * Tsai-Hill criterion (interactive but no tension/compression asymmetry
 * encoding). Returns { RF, FI }.
 */
export function tsaiHillFailure(sigPly, materialId) {
  const A = plyAllowables(materialId);
  const [s1, s2, t12] = sigPly;
  const X = s1 >= 0 ? A.Xt : A.Xc;
  const Y = s2 >= 0 ? A.Yt : A.Yc;
  const fi = (s1 / X) * (s1 / X)
           - (s1 * s2) / (X * X)
           + (s2 / Y) * (s2 / Y)
           + (t12 / A.S) * (t12 / A.S);
  if (fi <= 0) return { RF: Infinity, FI: 0 };
  // Tsai-Hill is purely quadratic in σ → RF = 1/√FI.
  return { RF: 1 / Math.sqrt(fi), FI: fi };
}

/**
 * Tsai-Wu polynomial criterion. Returns { RF, FI, coefficients }.
 */
export function tsaiWuFailure(sigPly, materialId) {
  const A = plyAllowables(materialId);
  const [s1, s2, t12] = sigPly;
  const F1  = 1 / A.Xt - 1 / A.Xc;
  const F2  = 1 / A.Yt - 1 / A.Yc;
  const F11 = 1 / (A.Xt * A.Xc);
  const F22 = 1 / (A.Yt * A.Yc);
  const F66 = 1 / (A.S * A.S);
  const F12 = -0.5 * Math.sqrt(F11 * F22);
  const FI = F1 * s1 + F2 * s2
           + F11 * s1 * s1 + F22 * s2 * s2
           + F66 * t12 * t12
           + 2 * F12 * s1 * s2;
  // Reserve factor: solve a·R² + b·R − 1 = 0  (the FI(σ→Rσ) = 1 equation).
  const a = F11 * s1 * s1 + F22 * s2 * s2 + F66 * t12 * t12
          + 2 * F12 * s1 * s2;
  const b = F1 * s1 + F2 * s2;
  let RF;
  if (Math.abs(a) < 1e-300) {
    RF = b !== 0 ? 1 / b : Infinity;
  } else {
    const disc = b * b + 4 * a;
    if (disc < 0) {
      RF = Infinity;
    } else {
      const sqrtD = Math.sqrt(disc);
      // Positive root — the one corresponding to load amplification in
      // the actual loading direction.
      const r1 = (-b + sqrtD) / (2 * a);
      const r2 = (-b - sqrtD) / (2 * a);
      const pos = [r1, r2].filter((r) => Number.isFinite(r) && r > 0);
      if (pos.length === 0) RF = Infinity;
      else RF = Math.min(...pos);
    }
  }
  return {
    RF, FI,
    coefficients: { F1, F2, F11, F22, F66, F12 },
  };
}

/**
 * Convenience — evaluate the three criteria and return whichever gives
 * the lowest RF along with the per-criterion result. The first-ply-
 * failure (FPF) load multiplier is min(RF) over all plies.
 */
export function plyFailureReport(sigPly, materialId) {
  const ms = maxStressFailure(sigPly, materialId);
  const th = tsaiHillFailure(sigPly, materialId);
  const tw = tsaiWuFailure(sigPly, materialId);
  const candidates = [
    { name: 'max-stress', RF: ms.RF, FI: ms.FI, mode: ms.mode },
    { name: 'tsai-hill', RF: th.RF, FI: th.FI },
    { name: 'tsai-wu',   RF: tw.RF, FI: tw.FI },
  ];
  let crit = candidates[0];
  for (let i = 1; i < candidates.length; i++) {
    if (candidates[i].RF < crit.RF) crit = candidates[i];
  }
  return {
    maxStress: ms, tsaiHill: th, tsaiWu: tw,
    criticalCriterion: crit.name,
    RF: crit.RF, FI: crit.FI,
    mode: crit.mode || null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// ASCII ply book export — Boeing / Airbus shop-floor format.
//
// One header block + one line per row (NOT per ply) so the layup
// schedule reads naturally:
//
//   Ply  Material   Orient  Thick(mm)  Count  Area(mm²)
//   ---  ---------  ------  ---------  -----  ---------
//     1  UD CFRP    0          0.125      1     10000
//     2  UD CFRP    +45        0.125      1     10000
//     3  UD CFRP    -45        0.125      1     10000
//     4  UD CFRP    90         0.125      1     10000
//     5  UD CFRP    0          0.125      1     10000
//     6  UD CFRP    0          0.125      1     10000
//     7  UD CFRP    90         0.125      1     10000
//     8  UD CFRP    -45        0.125      1     10000
//     9  UD CFRP    +45        0.125      1     10000
//    10  UD CFRP    0          0.125      1     10000
//
// Plus the schedule short-form "Stack: 0/+45/-45/90/0/0/90/-45/+45/0"
// which is what every stress engineer reads first. The orientation
// uses +/- sign for ±45 (not bare 45) which matches the Boeing /
// Airbus convention.

function formatOrient(deg) {
  const a = Number(deg);
  if (a > 0) return `+${a}`;
  if (a < 0) return `${a}`;
  return '0';
}

export function exportPlyBookAscii(book, opts = {}) {
  const lines = [];
  const name = (opts.name || book?.name || 'Untitled layup').slice(0, 80);
  const generated = opts.generatedAt || new Date().toISOString();
  const sum = summarise(book);
  const seq = expandPlies(book);
  const stackShort = seq.map((p) => formatOrient(p.orientation_deg)).join('/');

  lines.push('=========================================================');
  lines.push(' ArchDisc Forge — Composites Ply Book (PUSH-144)');
  lines.push(`   Layup:        ${name}`);
  lines.push(`   Generated:    ${generated}`);
  lines.push(`   Ply count:    ${sum.plyCount}`);
  lines.push(`   Thickness:    ${sum.totalThickness_mm.toFixed(4)} mm`);
  lines.push(`   Mass:         ${sum.totalMass_g.toFixed(4)} g`);
  lines.push(`   Symmetric:    ${sum.symmetric.ok ? 'YES' : 'NO — ' + sum.symmetric.reason}`);
  lines.push(`   Balanced:     ${sum.balanced.ok ? 'YES' : 'NO — ' + sum.balanced.reason}`);
  lines.push(`   Stack:        [${stackShort}]`);
  lines.push('=========================================================');
  lines.push('');
  lines.push(' Ply  Material   Orient   Thick(mm)   Count   Area(mm²)');
  lines.push(' ---  ---------  -------  ----------  ------  ----------');
  const rows = Array.isArray(book?.plies) ? book.plies : [];
  rows.forEach((raw, idx) => {
    const p = normalisePly(raw);
    if (!p) return;
    const matLabel = (COMPOSITE_MATERIALS[p.material]?.label || p.material).padEnd(9, ' ');
    const orient = formatOrient(p.orientation_deg).padEnd(6, ' ');
    const thick  = p.thickness_mm.toFixed(4).padStart(9, ' ');
    const count  = String(p.count).padStart(5, ' ');
    const area   = String(p.area_mm2).padStart(9, ' ');
    const idxStr = String(idx + 1).padStart(3, ' ');
    lines.push(` ${idxStr}  ${matLabel}  ${orient}  ${thick}  ${count}  ${area}`);
  });
  lines.push('');
  lines.push('   --- end of ply book ---');
  return lines.join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────────────
// Manifest for the panel + headless plugin / Archie integration.

export const COMPOSITES_HELPER_KEYS = Object.freeze([
  'makeEmptyPlyBook', 'makeQuasiIsoLayup', 'normalisePly', 'expandPlies',
  'totalThickness_mm', 'rowMass_g', 'totalMass_g',
  'isSymmetric', 'isBalanced', 'summarise',
  'reducedStiffness', 'rotatedQ', 'computeABD',
  'exportPlyBookAscii',
  // PUSH-223 strength + failure exports.
  'rotateStressToPly', 'plyAllowables',
  'maxStressFailure', 'tsaiHillFailure', 'tsaiWuFailure',
  'plyFailureReport',
  'COMPOSITE_MATERIALS', 'COMPOSITE_MATERIAL_IDS',
  'STANDARD_ORIENTATIONS',
]);

export default {
  makeEmptyPlyBook,
  makeQuasiIsoLayup,
  normalisePly,
  expandPlies,
  totalThickness_mm,
  rowMass_g,
  totalMass_g,
  isSymmetric,
  isBalanced,
  summarise,
  reducedStiffness,
  rotatedQ,
  computeABD,
  exportPlyBookAscii,
  rotateStressToPly,
  plyAllowables,
  maxStressFailure,
  tsaiHillFailure,
  tsaiWuFailure,
  plyFailureReport,
  COMPOSITE_MATERIALS,
  COMPOSITE_MATERIAL_IDS,
  STANDARD_ORIENTATIONS,
};
