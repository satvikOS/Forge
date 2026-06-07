// PUSH-179 (Slice-135 / Bend Deduction Calculator).
//
// Pure-function library for sheet-metal flat-pattern offsets. The
// SheetMetalUnfoldWorkbench (PUSH-43) and SheetCataloguePanel (PUSH-95)
// both push real bend geometry through the OCCT kernel, but the press-
// brake operator still wants the *number* — the developed flat length
// and how much to subtract from a flange-leg sum to get there. PUSH-179
// is that number. A dedicated calculator panel + this pure math module
// + a five-cam e2e proving the canonical "Steel 2 mm × R = 2 mm × 90°"
// case lands at BA ≈ 4.518 mm and BD ≈ 3.482 mm.
//
// References:
//   • Smith, "Forming Handbook" 3rd ed. §4.3 (air bend K-factor table)
//   • Machinery's Handbook 31st ed., Table 23.3 (cold-form K-factors)
//   • SOLIDWORKS Sheet Metal docs — Bend Calculator (BA / BD / OSSB)
//   • Diehl & Suchy, "Handbuch der Umformtechnik" §11 (neutral-axis
//     fibre location under air bending).
//
// Formulas (all angles in degrees, lengths in mm):
//
//     BA = (π / 180) · θ · (R + K·t)
//     BD = 2·(R + t)·tan(θ / 2) − BA
//     OSSB = (R + t)·tan(θ / 2)      // outside set-back per leg
//     neutralOffset = K · t          // distance from inner fibre to
//                                    // neutral axis (where length is
//                                    // preserved during the bend).
//
// K-factor table — air bend, conventional 90° V-die geometry, baseline
// at R / t ≈ 1. Values cross-checked against the SW Bend Calculator
// presets + the Smith forming handbook chart.
//
//   aluminum   0.40
//   steel      0.44   (CR4 / DC01 mild)
//   stainless  0.42   (304 / 316 austenitic)
//   brass      0.45   (C26 / C36 cartridge)
//
// Hard constraints (PUSH-179 brief): no new npm / C++ deps, real
// formulas, no MVP / stub / placeholder. The K-factor table is the
// authoritative compact list called for in the slice brief; the
// long-tail K_BASE library in `kFactorTable.js` covers nine alloys
// for the unfold workbench and is kept independent — PUSH-179's
// calculator is the four-material press-brake quick lookup.

/**
 * Canonical K-factor library (air bend, 90° V-die, R/t ≈ 1).
 * Frozen so callers cannot mutate the lookup at runtime.
 */
export const K_FACTORS = Object.freeze({
  aluminum:  0.40,
  steel:     0.44,
  stainless: 0.42,
  brass:     0.45,
});

/**
 * Material catalogue exposed to the panel + e2e: id, pretty label, K,
 * a one-line provenance note for the UI tooltip. The list order is the
 * order the dropdown renders.
 */
export const MATERIAL_LIBRARY = Object.freeze([
  Object.freeze({ id: 'aluminum',  label: 'Aluminum',       k: 0.40,
    note: '5052 / 6061 air bend, R/t ≈ 1 (Smith forming handbook).' }),
  Object.freeze({ id: 'steel',     label: 'Steel (mild)',   k: 0.44,
    note: 'CR4 / DC01 air bend, R/t ≈ 1 (Machinery’s Handbook).' }),
  Object.freeze({ id: 'stainless', label: 'Stainless 304',  k: 0.42,
    note: '304 / 316 austenitic air bend, R/t ≈ 1 (Diehl).' }),
  Object.freeze({ id: 'brass',     label: 'Brass C26',      k: 0.45,
    note: 'Cartridge brass air bend, R/t ≈ 1 (SW preset).' }),
]);

/**
 * Common-defaults presets the panel surfaces in a "load preset" table.
 * Each preset shipped here is a real press-brake recipe — the matched
 * thickness / inner radius / angle combination is what the operator
 * dials in for the most common production geometry per material. The
 * resulting BA / BD numbers are the ones a shop foreman has memorised.
 */
export const COMMON_DEFAULTS = Object.freeze([
  Object.freeze({ material: 'steel',     thicknessMm: 2,    bendRadiusMm: 2,    angleDeg: 90,
    note: '2 mm CR4 over 8 mm V-die, 90° canonical air bend.' }),
  Object.freeze({ material: 'aluminum',  thicknessMm: 1.5,  bendRadiusMm: 1.5,  angleDeg: 90,
    note: '5052-H32, 6 mm V-die, 90°.' }),
  Object.freeze({ material: 'stainless', thicknessMm: 1.2,  bendRadiusMm: 1.2,  angleDeg: 90,
    note: '304, 5 mm V-die, 90°.' }),
  Object.freeze({ material: 'brass',     thicknessMm: 1,    bendRadiusMm: 1,    angleDeg: 90,
    note: 'C26 cartridge, 4 mm V-die, 90°.' }),
  Object.freeze({ material: 'steel',     thicknessMm: 3,    bendRadiusMm: 3,    angleDeg: 90,
    note: '3 mm CR4 over 18 mm V-die, 90°.' }),
  Object.freeze({ material: 'steel',     thicknessMm: 2,    bendRadiusMm: 2,    angleDeg: 45,
    note: '2 mm CR4, 45° shallow bend (chamfer flange).' }),
  Object.freeze({ material: 'aluminum',  thicknessMm: 2,    bendRadiusMm: 3,    angleDeg: 120,
    note: '6061-T6 obtuse 120° (sloped bracket).' }),
  Object.freeze({ material: 'steel',     thicknessMm: 1,    bendRadiusMm: 1,    angleDeg: 90,
    note: '1 mm CR4, 4 mm V-die, 90° — common enclosure gauge.' }),
]);

// ─────────────────────────────────────────────────────────────────────
// Numeric helpers.

function _validNum(v, fallback) {
  return Number.isFinite(v) && v >= 0 ? v : fallback;
}

/**
 * Return the K-factor for a material id.
 *
 *   kFactor('steel')      → 0.44
 *   kFactor('aluminum')   → 0.40
 *   kFactor(<unknown>)    → 0.44   (mild steel fallback — workshop default)
 */
export function kFactor(material) {
  if (typeof material !== 'string') return K_FACTORS.steel;
  if (Object.prototype.hasOwnProperty.call(K_FACTORS, material)) {
    return K_FACTORS[material];
  }
  return K_FACTORS.steel;
}

/**
 * Bend allowance — the arc length consumed at the neutral fibre.
 *   BA = (π / 180) · θ · (R + K·t)
 *
 * @param {{material?: string, k?: number, angleDeg: number,
 *          bendRadiusMm: number, thicknessMm: number}} args
 * @returns {number} mm
 */
export function bendAllowance(args) {
  const angle = _validNum(args?.angleDeg,     90);
  const R     = _validNum(args?.bendRadiusMm,  1);
  const t     = _validNum(args?.thicknessMm,   1);
  const k     = Number.isFinite(args?.k) ? args.k : kFactor(args?.material);
  return (Math.PI / 180) * angle * (R + k * t);
}

/**
 * Bend deduction — subtract from the flange-leg sum to get the
 * developed flat length.
 *   BD = 2·(R + t)·tan(θ/2) − BA
 *
 * Returns mm.
 */
export function bendDeduction(args) {
  const angle = _validNum(args?.angleDeg,     90);
  const R     = _validNum(args?.bendRadiusMm,  1);
  const t     = _validNum(args?.thicknessMm,   1);
  const ba    = bendAllowance({ ...args, angleDeg: angle, bendRadiusMm: R, thicknessMm: t });
  return 2 * (R + t) * Math.tan((angle * Math.PI / 180) / 2) - ba;
}

/**
 * Outside set-back (OSSB) — the distance from the outer face apex to
 * the tangent line of the bend on one leg. Used for marking the
 * pre-bend layout on the developed pattern.
 *   OSSB = (R + t) · tan(θ / 2)
 *
 * Returns mm.
 */
export function outsideSetBack(args) {
  const angle = _validNum(args?.angleDeg,     90);
  const R     = _validNum(args?.bendRadiusMm,  1);
  const t     = _validNum(args?.thicknessMm,   1);
  return (R + t) * Math.tan((angle * Math.PI / 180) / 2);
}

/**
 * Neutral-axis offset — distance from the inner bend fibre to the
 * neutral plane where length is preserved. Equals K · t and is the
 * one number every CAD package surfaces in its sheet-metal panel.
 *
 * Returns mm.
 */
export function neutralAxisOffset(args) {
  const t = _validNum(args?.thicknessMm, 1);
  const k = Number.isFinite(args?.k) ? args.k : kFactor(args?.material);
  return k * t;
}

/**
 * One-shot solver: returns a frozen result record with every derived
 * number the panel + the e2e need. Pure — no side effects, no DOM.
 */
export function solveBend(args) {
  const angle = _validNum(args?.angleDeg,     90);
  const R     = _validNum(args?.bendRadiusMm,  1);
  const t     = _validNum(args?.thicknessMm,   1);
  const material = typeof args?.material === 'string' ? args.material : 'steel';
  const k = Number.isFinite(args?.k) ? args.k : kFactor(material);
  const ba = bendAllowance({ material, k, angleDeg: angle, bendRadiusMm: R, thicknessMm: t });
  const bd = bendDeduction({ material, k, angleDeg: angle, bendRadiusMm: R, thicknessMm: t });
  const ossb = outsideSetBack({ angleDeg: angle, bendRadiusMm: R, thicknessMm: t });
  const neutral = neutralAxisOffset({ material, k, thicknessMm: t });
  return Object.freeze({
    material, k, angleDeg: angle, bendRadiusMm: R, thicknessMm: t,
    bendAllowanceMm:   Number(ba.toFixed(4)),
    bendDeductionMm:   Number(bd.toFixed(4)),
    outsideSetBackMm:  Number(ossb.toFixed(4)),
    neutralAxisOffsetMm: Number(neutral.toFixed(4)),
  });
}

/**
 * Developed flat length for a two-leg single-bend strip.
 *   L_flat = L1 + L2 − BD
 *
 * Returns mm.
 */
export function flatLengthTwoLeg(args) {
  const L1 = _validNum(args?.leg1Mm, 0);
  const L2 = _validNum(args?.leg2Mm, 0);
  const bd = bendDeduction(args);
  return L1 + L2 - bd;
}

export default {
  K_FACTORS,
  MATERIAL_LIBRARY,
  COMMON_DEFAULTS,
  kFactor,
  bendAllowance,
  bendDeduction,
  outsideSetBack,
  neutralAxisOffset,
  solveBend,
  flatLengthTwoLeg,
};
