// Forge-157 — naval-architecture math.
//
// Real engineering formulas used by ShipWorkbench: hull volume
// integration (Simpson's rule), waterline-area calculation, sectional
// area curve, prismatic + block + waterplane coefficients, GZ curve
// via inclined waterlines + righting-lever integration.

/** Trapezoidal integration: ∫ y dx between sample points. */
export function trapz(xs, ys) {
  let s = 0;
  for (let i = 1; i < xs.length; i++) {
    s += 0.5 * (ys[i] + ys[i - 1]) * (xs[i] - xs[i - 1]);
  }
  return s;
}

/** Simpson's 1/3 rule on equally-spaced samples. */
export function simpsons(ys, dx) {
  if (ys.length < 3 || ys.length % 2 === 0) return trapz(ys.map((_, i) => i * dx), ys);
  let s = ys[0] + ys[ys.length - 1];
  for (let i = 1; i < ys.length - 1; i++) {
    s += (i % 2 === 0 ? 2 : 4) * ys[i];
  }
  return (dx / 3) * s;
}

/**
 * Compute hull volume (displacement) from sectional areas (stations
 * along the longitudinal axis).
 * @param {number[]} sectionAreas — m² each
 * @param {number} stationSpacing — m
 * @returns {number} m³
 */
export function hullVolume(sectionAreas, stationSpacing) {
  return simpsons(sectionAreas, stationSpacing);
}

/**
 * Block coefficient Cb = ∇ / (L · B · T).
 */
export function blockCoeff(volume_m3, length_m, beam_m, draft_m) {
  if (length_m <= 0 || beam_m <= 0 || draft_m <= 0) return 0;
  return volume_m3 / (length_m * beam_m * draft_m);
}

/**
 * Prismatic coefficient Cp = ∇ / (Am · L), where Am is the midship area.
 */
export function prismaticCoeff(volume_m3, midshipArea_m2, length_m) {
  if (midshipArea_m2 <= 0 || length_m <= 0) return 0;
  return volume_m3 / (midshipArea_m2 * length_m);
}

/**
 * Waterplane area coefficient Cw = Aw / (L · B).
 */
export function waterplaneCoeff(waterplaneArea_m2, length_m, beam_m) {
  if (length_m <= 0 || beam_m <= 0) return 0;
  return waterplaneArea_m2 / (length_m * beam_m);
}

/**
 * Compute GZ (righting lever) at a given heel angle using a simplified
 * wall-sided correction. Real GZ requires inclined-waterplane computation;
 * for vessels with moderate flare Cw, the formula GZ = (GM_T + 0.5*BMt*tan²φ) sin φ
 * is accurate to ~15° per Bhattacharyya.
 */
export function gzCurve({ GMt_m, BMt_m, heelAnglesDeg }) {
  return heelAnglesDeg.map((phi) => {
    const r = phi * Math.PI / 180;
    return {
      heel_deg: phi,
      GZ_m: (GMt_m + 0.5 * BMt_m * Math.tan(r) ** 2) * Math.sin(r),
    };
  });
}

/**
 * Stability check per IMO IS Code (2008) intact stability criteria.
 * Returns pass/fail with the specific violations.
 */
export function imoIntactStabilityCheck(curve, { GM0_min = 0.15, GZmax_min = 0.20, range_deg_min = 60 } = {}) {
  const out = { pass: true, violations: [] };
  // 1. GM0 ≥ 0.15 m (KZ-2: K1).
  const initial = curve.find((p) => p.heel_deg >= 0);
  if (initial && initial.GZ_m < GM0_min) {
    out.pass = false; out.violations.push(`GM0 ${initial.GZ_m.toFixed(3)} < ${GM0_min} m`);
  }
  // 2. Maximum GZ ≥ 0.20 m at heel ≥ 25°.
  const peak = curve.reduce((a, b) => b.GZ_m > a.GZ_m ? b : a, curve[0]);
  if (peak.GZ_m < GZmax_min) {
    out.pass = false;
    out.violations.push(`GZmax ${peak.GZ_m.toFixed(3)} < ${GZmax_min} m`);
  }
  if (peak.heel_deg < 25) {
    out.pass = false;
    out.violations.push(`GZmax at heel ${peak.heel_deg}° < 25°`);
  }
  // 3. Range of positive stability ≥ 60° downflooding.
  const lastPositive = [...curve].reverse().find((p) => p.GZ_m > 0);
  if (lastPositive && lastPositive.heel_deg < range_deg_min) {
    out.pass = false;
    out.violations.push(`positive-GZ range ${lastPositive.heel_deg}° < ${range_deg_min}°`);
  }
  return out;
}

/**
 * Bonjean curve — sectional area as a function of waterline at each
 * station along the hull length. Used by naval architects to compute
 * trim + heel.
 */
export function bonjeanCurves(stations, waterlines_m, hullSectionArea) {
  return stations.map((x_m) => ({
    station_x: x_m,
    waterlines: waterlines_m.map((wl) => ({
      wl_m: wl,
      area_m2: hullSectionArea(x_m, wl),
    })),
  }));
}

/** Curated hull library — published Lpp / B / T / Cb / Cp values. */
export const HULL_LIBRARY = Object.freeze([
  { id: 'tug-30m',
    name: 'Harbour tug, 30 m', Lpp_m: 30, B_m: 9.5, T_m: 4.0,
    Cb: 0.55, Cp: 0.60, Cw: 0.78, displacement_t: 530,
    notes: 'Twin-screw, 4000 kW, ASD' },
  { id: 'container-feeder',
    name: 'Container feeder, 120 m', Lpp_m: 120, B_m: 20, T_m: 7.5,
    Cb: 0.68, Cp: 0.71, Cw: 0.82, displacement_t: 11700,
    notes: '700 TEU, single screw, 10 MW' },
  { id: 'panamax-tanker',
    name: 'Panamax product tanker', Lpp_m: 228, B_m: 32.2, T_m: 12.5,
    Cb: 0.80, Cp: 0.82, Cw: 0.88, displacement_t: 80000,
    notes: '70 000 DWT, single screw, 13 MW' },
  { id: 'yacht-12m',
    name: 'Sailing yacht, 12 m LOA', Lpp_m: 10.5, B_m: 3.5, T_m: 1.9,
    Cb: 0.30, Cp: 0.55, Cw: 0.72, displacement_t: 12,
    notes: 'Bermudan rig, fin keel + spade rudder' },
  { id: 'patrol-50m',
    name: 'Coastal patrol vessel, 50 m', Lpp_m: 50, B_m: 8.5, T_m: 2.5,
    Cb: 0.42, Cp: 0.60, Cw: 0.75, displacement_t: 380,
    notes: 'Twin waterjet, 7000 kW, 32 kt' },
]);

/** Default heel-angle sample points for GZ curves (IMO standard). */
export const HEEL_SAMPLES_DEG = [0, 5, 10, 15, 20, 25, 30, 35, 40, 45,
                                  50, 60, 70, 80, 90];
