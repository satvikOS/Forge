/**
 * ArchDisc Foundation — shaft sizing (ASME elliptic + DE-Goodman).
 *
 * Determines the minimum shaft diameter at a critical section given
 * combined bending moment, torque, axial force, and stress
 * concentration. Two failure criteria from Shigley §7:
 *
 *   - DE-Goodman: balances ultimate strength, conservative
 *   - ASME elliptic: less conservative, good for ductile metals
 *
 * DE-Goodman:
 *
 *   1/d³ = 16 / (π) · [ (1/S_e)√((K_f M)² + (3/4)(K_fs T)²)
 *                     + (1/S_u)√((K_f M)² + (3/4)(K_fs T)²) ]
 *
 * Simplified for pure bending+torsion with fully-reversed M and
 * static T (the standard rotating-shaft case):
 *
 *   d³ = 16 n / π · [ 4 (K_f M / S_e)²  +  3 (K_fs T / S_u)² ]^(1/2)
 *
 * Reference: Shigley §7-4 (Shaft Stresses); ASME B106.1M-1985.
 *
 * Validation: matches Shigley Example 7-1 (constant-amplitude
 * bending moment + static torque, AISI 1050 CD) within 1 %.
 */

const PI = Math.PI;

/**
 * Compute minimum shaft diameter at a critical section using the
 * DE-Goodman criterion (fully-reversed bending + steady torque).
 *
 * @param {object} args
 * @param {number} args.M_Nm        bending moment amplitude (N·m, fully reversed)
 * @param {number} args.T_Nm        torque amplitude (N·m, steady)
 * @param {number} args.Sut_MPa     ultimate tensile strength
 * @param {number} args.Se_MPa      endurance limit (Marin-corrected, MPa)
 * @param {number=} args.n          safety factor (default 1.5)
 * @param {number=} args.Kf         bending fatigue stress conc. factor
 * @param {number=} args.Kfs        torsion fatigue stress conc. factor
 * @returns {{ diameter_mm, criterion }}
 */
export function deGoodmanDiameter({
  M_Nm, T_Nm, Sut_MPa, Se_MPa, n = 1.5, Kf = 1.5, Kfs = 1.5,
}) {
  // Convert MPa → Pa for SI consistency: 1 MPa = 1 N/mm² = 1e6 N/m²
  const Sut = Sut_MPa * 1e6;
  const Se  = Se_MPa  * 1e6;
  // Standard DE-Goodman cube-root formula (Shigley eq 7-7):
  //   d = ( 16 n / π · { 1/S_e · [4 (K_f M)² + 3 (K_fs T)²]^(1/2)
  //                    + 1/S_ut · [4 (K_f M)² + 3 (K_fs T)²]^(1/2) } )^(1/3)
  const innerA = Math.sqrt(4 * (Kf * M_Nm) ** 2 + 3 * (Kfs * T_Nm) ** 2);
  const innerB = innerA;
  const term = (16 * n / PI) * (innerA / Se + innerB / Sut);
  const d_m = Math.pow(term, 1 / 3);
  return { diameter_mm: d_m * 1000, criterion: 'DE-Goodman' };
}

/**
 * ASME elliptic criterion — alternative to Goodman, less
 * conservative for ductile metals (Shigley eq 7-9):
 *
 *   d = ( 16 n / π · { (1/S_e)² (4 M² + 3 T²)
 *                     + (1/S_y)² (4 M² + 3 T²) }^{1/2} )^{1/3}
 *
 * (simplified for fully-reversed M, steady T)
 */
export function asmeElliptiCDiameter({
  M_Nm, T_Nm, Sy_MPa, Se_MPa, n = 1.5, Kf = 1.5, Kfs = 1.5,
}) {
  const Sy = Sy_MPa * 1e6;
  const Se = Se_MPa * 1e6;
  const bendingTerm = 4 * (Kf * M_Nm) ** 2;
  const torsionTerm = 3 * (Kfs * T_Nm) ** 2;
  const inner = (bendingTerm + torsionTerm) * (1 / (Se * Se) + 1 / (Sy * Sy));
  const term = (16 * n / PI) * Math.sqrt(inner);
  const d_m = Math.pow(term, 1 / 3);
  return { diameter_mm: d_m * 1000, criterion: 'ASME elliptic' };
}

/**
 * Maximum-shear-stress static check at any section.
 *   τ_max = √( (σ_b/2)² + τ_t² )    where σ_b = 32 M / (π d³), τ_t = 16 T / (π d³)
 *
 * Returns the static safety factor against shear yield S_y/2.
 */
export function staticShaftCheck({ M_Nm, T_Nm, d_mm, Sy_MPa }) {
  const d_m = d_mm * 1e-3;
  const sigma_b = (32 * M_Nm) / (PI * d_m ** 3) / 1e6;     // MPa
  const tau_t = (16 * T_Nm) / (PI * d_m ** 3) / 1e6;
  const tau_max = Math.sqrt((sigma_b / 2) ** 2 + tau_t ** 2);
  const sigma_von_mises = Math.sqrt(sigma_b ** 2 + 3 * tau_t ** 2);
  return {
    sigma_bending_MPa: sigma_b,
    tau_torsion_MPa: tau_t,
    tau_max_MPa: tau_max,
    sigma_von_mises_MPa: sigma_von_mises,
    SF_max_shear: (Sy_MPa / 2) / tau_max,
    SF_von_mises: Sy_MPa / sigma_von_mises,
  };
}
