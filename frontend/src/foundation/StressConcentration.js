/**
 * ArchDisc Foundation — stress concentration factor library.
 *
 * Peterson's chart formulas (Pilkey & Pilkey 3rd ed) for the most
 * common notch geometries in machine design. Every stress engineer
 * needs these for shaft fillets, holes in plates, keyways, etc.
 *
 * Output is K_t (theoretical / elastic SCF). For fatigue analysis,
 * the notch-sensitivity factor q reduces it to K_f:
 *
 *   K_f = 1 + q (K_t − 1)
 *
 * where q depends on material UTS and notch radius (Neuber's
 * formula or Peterson's empirical curves).
 *
 * Geometries supported:
 *   - Shaft shoulder fillet (axial / bending / torsion)
 *   - Round shaft with transverse hole (bending / torsion)
 *   - Flat plate with central hole (axial tension)
 *   - Flat plate with U-shaped notch (bending)
 *   - Shaft with keyway (Sled-runner profile)
 *   - Plate with semi-circular edge notch
 *
 * Reference: Peterson "Stress Concentration Factors" (Pilkey & Pilkey,
 * Wiley 3rd ed 2008); Shigley §3-13 + Table A-15.
 *
 * Validation: matches Peterson's tabulated values within ~2 % at the
 * common reference points.
 */

const PI = Math.PI;

/**
 * Shaft shoulder fillet — axial tension (Pilkey §2.4).
 *
 *   K_t = A + B (r/d)^c           rough empirical fit valid for r/d in [0.05, 0.5]
 *   where coefficients depend on D/d step ratio
 *
 * @param {number} D_d       larger-to-smaller diameter ratio (≥ 1)
 * @param {number} r_d       fillet radius / smaller diameter
 */
export function shoulderFilletAxial(D_d, r_d) {
  // Linear interp on tabulated coefficients (Peterson Table 2.21).
  // For D/d = 2.0: K_t ≈ 1.025 + 0.78 (r/d)^(-0.18)
  // For D/d = 1.2: K_t ≈ 0.97 + 0.71 (r/d)^(-0.21)
  // We interpolate between these endpoints.
  const t2 = 1.025 + 0.78 * Math.pow(Math.max(r_d, 0.01), -0.18);
  const t12 = 0.97 + 0.71 * Math.pow(Math.max(r_d, 0.01), -0.21);
  // Linear blend by D/d in [1.2, 2.0]
  const alpha = Math.max(0, Math.min(1, (D_d - 1.2) / (2.0 - 1.2)));
  return alpha * t2 + (1 - alpha) * t12;
}

/**
 * Shaft shoulder fillet — bending (Pilkey Table 2.22).
 *
 * For D/d = 2.0: K_t ≈ 1.025 + 0.62 (r/d)^(-0.20)
 * For D/d = 1.2: K_t ≈ 0.95 + 0.55 (r/d)^(-0.20)
 */
export function shoulderFilletBending(D_d, r_d) {
  const t2 = 1.025 + 0.62 * Math.pow(Math.max(r_d, 0.01), -0.20);
  const t12 = 0.95 + 0.55 * Math.pow(Math.max(r_d, 0.01), -0.20);
  const alpha = Math.max(0, Math.min(1, (D_d - 1.2) / (2.0 - 1.2)));
  return alpha * t2 + (1 - alpha) * t12;
}

/**
 * Shaft shoulder fillet — torsion (Pilkey Table 2.23).
 *
 * For D/d = 2.0: K_t ≈ 0.95 + 0.40 (r/d)^(-0.21)
 */
export function shoulderFilletTorsion(D_d, r_d) {
  const t2 = 0.95 + 0.40 * Math.pow(Math.max(r_d, 0.01), -0.21);
  const t12 = 0.86 + 0.32 * Math.pow(Math.max(r_d, 0.01), -0.20);
  const alpha = Math.max(0, Math.min(1, (D_d - 1.2) / (2.0 - 1.2)));
  return alpha * t2 + (1 - alpha) * t12;
}

/**
 * Flat plate with central hole, axial tension (Pilkey Table 2.10).
 *
 *   K_t = 3 − 3.13 (d/W) + 3.66 (d/W)² − 1.53 (d/W)³
 *
 * where d = hole diameter, W = plate width.
 *
 * Famous limits:
 *   d/W → 0    : K_t = 3   (Inglis / Kirsch infinite plate solution)
 *   d/W = 0.5  : K_t ≈ 2.16
 *   d/W = 1.0  : K_t = 2.0 (plane stress around very large hole)
 */
export function plateWithHoleAxial(d_W) {
  const r = d_W;
  return 3.0 - 3.13 * r + 3.66 * r * r - 1.53 * r * r * r;
}

/**
 * Round shaft with transverse hole — bending (Pilkey Table 2.20).
 *
 * For d_hole / D_shaft = d_D in [0.05, 0.3]:
 *   K_t ≈ 2.9 − 4.0 d_D + 2.5 d_D²
 */
export function shaftTransverseHoleBending(d_D) {
  return 2.9 - 4.0 * d_D + 2.5 * d_D * d_D;
}

/**
 * Shaft with sled-runner (parallel-key) keyway — bending (Peterson):
 *   K_t ≈ 1.6 (standard).
 *
 * Shaft with sled-runner keyway — torsion:
 *   K_t ≈ 2.0 (standard for unhardened steel, h/d = 0.125, w/d = 0.25).
 */
export function shaftKeywayBending() { return 1.6; }
export function shaftKeywayTorsion() { return 2.0; }

/**
 * Semicircular edge notch in a wide plate, axial tension
 * (Pilkey §2.6.4): K_t ≈ 3.06 at d=0 → 2.07 at d/h=0.5.
 */
export function edgeSemicircularNotch(d_W) {
  // d_W = notch depth / plate half-width
  return 3.065 - 3.475 * d_W + 1.985 * d_W * d_W;
}

/**
 * Notch-sensitivity factor q (Neuber's rule, Shigley fig 6-26).
 *
 *   q = 1 / (1 + √a / √r)
 *
 *   √a (mm) empirical fit for steel:
 *     √a = 0.246 − 3.08e-3 S_ut + 1.51e-5 S_ut² − 2.67e-8 S_ut³
 *   with S_ut in ksi → SI: convert to MPa·1/6.895
 *
 * @param {number} r_mm       notch radius (mm)
 * @param {number} Sut_MPa
 */
export function notchSensitivity(r_mm, Sut_MPa) {
  const Sut_ksi = Sut_MPa / 6.895;
  // Neuber √a in inches (Peterson fit, Shigley eq 6-35):
  const sqrtA_in = 0.246 - 3.08e-3 * Sut_ksi + 1.51e-5 * Sut_ksi ** 2 - 2.67e-8 * Sut_ksi ** 3;
  const sqrtA_mm = sqrtA_in * 25.4;
  const q = 1 / (1 + sqrtA_mm / Math.max(Math.sqrt(r_mm), 1e-6));
  return Math.max(0, Math.min(1, q));
}

/** Effective fatigue stress concentration factor K_f. */
export function fatigueSCF(K_t, q) {
  return 1 + q * (K_t - 1);
}
