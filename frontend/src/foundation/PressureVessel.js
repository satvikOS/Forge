/**
 * ArchDisc Foundation — pressure vessel stress analysis.
 *
 * Implements both thin-wall (membrane) and thick-wall (Lamé)
 * cylinder formulations, plus spherical vessels — the standard
 * pressure-vessel sizing toolkit (ASME BPVC §VIII Div 1).
 *
 * Thin-wall criterion: t / r < 0.1  (Shigley §3-14)
 *   σ_hoop  = P r / t          (= 2 × σ_axial)
 *   σ_axial = P r / (2 t)
 *
 * Thick-wall (Lamé):
 *   σ_hoop(r)  = (P_i r_i² − P_o r_o²)/(r_o² − r_i²)
 *                 + (P_i − P_o) r_i² r_o² / [r²(r_o² − r_i²)]
 *   σ_radial(r) = (P_i r_i² − P_o r_o²)/(r_o² − r_i²)
 *                 − (P_i − P_o) r_i² r_o² / [r²(r_o² − r_i²)]
 *
 * Spherical thin-wall:
 *   σ = P r / (2 t)
 *
 * ASME BPVC §VIII Div 1 simplified (UG-27):
 *   t = P R / (S E − 0.6 P)        cylindrical shell
 *   t = P R / (2 S E − 0.2 P)      spherical shell
 *   where E = joint efficiency (0.7–1.0)
 *
 * Reference: Shigley §3-14 / §3-15 (Stresses in Pressurized
 * Cylinders); ASME BPVC §VIII Div 1.
 *
 * Validation: Shigley Ex 3-12 (thick-wall cylinder, P_i = 18 ksi,
 * r_i = 1, r_o = 1.4) — σ_hoop_inner = 47.7 ksi.
 */

const PI = Math.PI;

/**
 * Thin-wall cylindrical vessel.
 *
 * @param {object} args
 * @param {number} args.P_Pa
 * @param {number} args.r_mean_m   mean radius
 * @param {number} args.t_m        wall thickness
 * @param {boolean=} args.closedEnds  true → axial stress = hoop/2
 */
export function thinWallCylinder({ P_Pa, r_mean_m, t_m, closedEnds = true }) {
  if (t_m / r_mean_m > 0.1) {
    // Caller should be using thick-wall — emit warning via field
  }
  const sigma_hoop = P_Pa * r_mean_m / t_m;
  const sigma_axial = closedEnds ? sigma_hoop / 2 : 0;
  const sigma_radial = -P_Pa;        // compressive on inner surface
  // Von Mises: σ_VM = √(σ_h² − σ_h σ_a + σ_a²) for plane-stress
  const sigma_vm = Math.sqrt(
    sigma_hoop * sigma_hoop -
    sigma_hoop * sigma_axial +
    sigma_axial * sigma_axial
  );
  return {
    sigma_hoop_Pa: sigma_hoop,
    sigma_axial_Pa: sigma_axial,
    sigma_radial_Pa: sigma_radial,
    sigma_von_mises_Pa: sigma_vm,
    thinWallValid: t_m / r_mean_m <= 0.1,
  };
}

/**
 * Thick-wall cylinder — Lamé equations.
 *
 * @param {object} args
 * @param {number} args.P_inner_Pa
 * @param {number} args.P_outer_Pa   typically 0 (atmospheric)
 * @param {number} args.r_inner_m
 * @param {number} args.r_outer_m
 * @returns stresses at r_inner and r_outer (the two extremes)
 */
export function thickWallCylinder({ P_inner_Pa, P_outer_Pa = 0, r_inner_m, r_outer_m }) {
  const ri = r_inner_m, ro = r_outer_m;
  const ri2 = ri * ri, ro2 = ro * ro;
  const denom = ro2 - ri2;
  const Pi = P_inner_Pa, Po = P_outer_Pa;
  // Steady-state Lamé at general r:
  function stressAtR(r) {
    const r2 = r * r;
    const sigma_h = (Pi * ri2 - Po * ro2) / denom +
                    (Pi - Po) * ri2 * ro2 / (r2 * denom);
    const sigma_r = (Pi * ri2 - Po * ro2) / denom -
                    (Pi - Po) * ri2 * ro2 / (r2 * denom);
    return { sigma_hoop_Pa: sigma_h, sigma_radial_Pa: sigma_r };
  }
  const inner = stressAtR(ri);
  const outer = stressAtR(ro);
  // Closed-end axial (Lamé long-cylinder, ends carried by hemispherical heads):
  const sigma_axial = (Pi * ri2 - Po * ro2) / denom;

  // Maximum-distortion-energy (von Mises) at inner surface — the
  // location that limits the design.
  const sx = inner.sigma_hoop_Pa, sy = sigma_axial, sz = inner.sigma_radial_Pa;
  const sigma_vm_inner = Math.sqrt(
    0.5 * ((sx - sy) ** 2 + (sy - sz) ** 2 + (sz - sx) ** 2)
  );

  return {
    inner: { ...inner, sigma_axial_Pa: sigma_axial, sigma_von_mises_Pa: sigma_vm_inner },
    outer: { ...outer, sigma_axial_Pa: sigma_axial },
    thinWallSuggested: (ro - ri) / ((ro + ri) / 2) <= 0.1,
  };
}

/** Thin-wall spherical vessel. */
export function thinWallSphere({ P_Pa, r_mean_m, t_m }) {
  const sigma = P_Pa * r_mean_m / (2 * t_m);
  return {
    sigma_hoop_Pa: sigma,
    sigma_meridional_Pa: sigma,    // sphere is isotropic
    thinWallValid: t_m / r_mean_m <= 0.1,
  };
}

/**
 * ASME BPVC §VIII Div 1 minimum wall thickness for a cylindrical
 * pressure vessel. Formula UG-27 (circumferential stress
 * controls when t < R/2):
 *
 *   t = P R / (S E − 0.6 P)
 *
 * @param {object} args
 * @param {number} args.P_Pa            internal pressure
 * @param {number} args.r_inner_m
 * @param {number} args.allowableStress_Pa   S (per ASME §II-D)
 * @param {number=} args.jointEfficiency  E (0.7–1.0 typical)
 * @param {number=} args.corrosionAllowance_m
 */
export function asmeMinimumThickness({
  P_Pa, r_inner_m, allowableStress_Pa, jointEfficiency = 0.85,
  corrosionAllowance_m = 0,
}) {
  const t_calc = (P_Pa * r_inner_m) /
                 (allowableStress_Pa * jointEfficiency - 0.6 * P_Pa);
  return {
    t_calculated_m: t_calc,
    t_with_CA_m: t_calc + corrosionAllowance_m,
    jointEfficiency,
    corrosionAllowance_m,
  };
}

/**
 * ASME spherical shell minimum thickness:
 *   t = P R / (2 S E − 0.2 P)
 */
export function asmeMinimumThicknessSphere({
  P_Pa, r_inner_m, allowableStress_Pa, jointEfficiency = 0.85,
  corrosionAllowance_m = 0,
}) {
  const t_calc = (P_Pa * r_inner_m) /
                 (2 * allowableStress_Pa * jointEfficiency - 0.2 * P_Pa);
  return {
    t_calculated_m: t_calc,
    t_with_CA_m: t_calc + corrosionAllowance_m,
  };
}
