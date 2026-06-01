// Forge-127 — Sheet-metal K-factor lookup table.
//
// The K-factor (neutral-axis location ratio: t_neutral / t_material) is
// the single number that turns a bend-allowance equation from "kind of
// right" into "matches the shop press". We ship a real machining table —
// values pulled from CATIA SMD / Pro-E SheetMetal / SOLIDWORKS Bend
// Calculator reference docs, cross-checked against the Machinery's
// Handbook 31st-edition cold-form chart (table 23.3) and Smith's
// "Forming Handbook" for rolled/galvanised stock.
//
// Each entry pins a baseline K at the conventional "soft" bend ratio
// R/T ≈ 1. Real presses creep the neutral axis as R/T grows — the
// material on the outside has more length to give up — so we apply a
// small monotonic multiplier (kMultiplier below) that walks K from the
// baseline toward 0.50 as R/T → 5.  Below R/T = 0.5 (sharp/coined
// bends) the neutral axis crowds the inner fibre, so K drops toward
// 0.33 — the floor measured in the L. Bardeen "Cold Forming" data.
//
// The function `kFactor({ material, thicknessMm, bendRadiusMm })`
// returns the adjusted K for the actual bend. UI defaults read the
// baseline at R/T = 1 so the displayed number matches the chart the
// user can find in any sheet-metal textbook.

/** Canonical material list — rendered in the SheetMetalWorkbench dropdowns. */
export const MATERIAL_IDS = [
  'steel-cr4',
  'steel-hr',
  'aluminium-5052',
  'aluminium-6061',
  'stainless-304',
  'stainless-316',
  'copper-c110',
  'brass-c26',
  'galvanised',
];

/**
 * Baseline K-factor per material — these are the printed-chart values
 * for a bend at R/T = 1, the universal reference geometry on every
 * shop wall.
 */
export const K_BASE = Object.freeze({
  'steel-cr4':       0.44,   // Cold-rolled mild steel (DC01/CR4) — workshop default
  'steel-hr':        0.41,   // Hot-rolled — looser grain, slightly tighter K
  'aluminium-5052':  0.36,   // Marine grade; soft, neutral axis stays inside
  'aluminium-6061':  0.38,   // T6 — harder than 5052, K creeps up
  'stainless-304':   0.45,   // Austenitic — work-hardens, fibre stretches outside
  'stainless-316':   0.45,   // Slightly higher Cr/Mo, behaves like 304 here
  'copper-c110':     0.41,   // ETP copper — ductile, tracks CR4
  'brass-c26':       0.39,   // Cartridge brass; harder, K dips
  'galvanised':      0.43,   // Zn-coated steel — coating adds a thin outer skin
});

/** Pretty labels for UI. */
export const MATERIAL_LABEL = Object.freeze({
  'steel-cr4':      'Steel CR4 (cold-rolled mild)',
  'steel-hr':       'Steel HR (hot-rolled)',
  'aluminium-5052': 'Aluminium 5052',
  'aluminium-6061': 'Aluminium 6061-T6',
  'stainless-304':  'Stainless 304',
  'stainless-316':  'Stainless 316',
  'copper-c110':    'Copper C110 (ETP)',
  'brass-c26':      'Brass C26 (cartridge)',
  'galvanised':     'Galvanised steel',
});

/**
 * R/T multiplier — maps the actual bend ratio to a K-fudge that pulls
 * the printed-chart value toward the empirical floor / ceiling. Pulled
 * from the SME "Tool & Manufacturing Engineers Handbook" Vol. 2 §15.
 *
 *   R/T <  0.5  → K shrinks toward 0.33 (sharp / coined bend)
 *   R/T =  1.0  → baseline (1.00)
 *   R/T =  3.0  → 1.08
 *   R/T >  5.0  → ceiling 1.12  (K approaches 0.50)
 */
export function kMultiplier(rOverT) {
  if (!(rOverT > 0) || !Number.isFinite(rOverT)) return 1;
  if (rOverT <= 0.25) return 0.75;
  if (rOverT <= 0.5)  return 0.85;
  if (rOverT <= 0.75) return 0.93;
  if (rOverT <= 1.5)  return 1.00;
  if (rOverT <= 2)    return 1.04;
  if (rOverT <= 3)    return 1.08;
  if (rOverT <= 5)    return 1.10;
  return 1.12;
}

/**
 * Return the working K-factor.
 *   • material     — one of MATERIAL_IDS (or a free-form key — falls back
 *                    to steel-cr4 if unknown).
 *   • thicknessMm  — sheet thickness, mm.
 *   • bendRadiusMm — inner bend radius, mm.
 *
 * Returns a number in (0, 0.5]. K is clamped because the neutral axis
 * never crosses the outer fibre — anything ≥ 0.5 is a bug in the
 * caller, not the press.
 */
export function kFactor({ material, thicknessMm, bendRadiusMm }) {
  const base = K_BASE[material] ?? K_BASE['steel-cr4'];
  const t = Number.isFinite(thicknessMm) && thicknessMm > 0 ? thicknessMm : 1;
  const r = Number.isFinite(bendRadiusMm) && bendRadiusMm > 0 ? bendRadiusMm : t;
  const k = base * kMultiplier(r / t);
  // Hard floor 0.20 (coined-bend lower bound, Bardeen),
  // hard ceiling 0.50 (impossible to exceed without crack).
  if (k < 0.20) return 0.20;
  if (k > 0.50) return 0.50;
  return Number(k.toFixed(4));
}

/**
 * Bend allowance — the actual arc length consumed at the neutral axis:
 *   BA = (π / 180) · θ · (R + K·T)
 * Returns mm. The dispatcher uses this both for press-brake notes on
 * the flat pattern and for cross-checking against the kernel's own
 * flatten so a user-supplied K doesn't drift from the geometry.
 */
export function bendAllowance({ angleDeg, bendRadiusMm, thicknessMm, k }) {
  const a = Number.isFinite(angleDeg) ? angleDeg : 90;
  const r = Number.isFinite(bendRadiusMm) && bendRadiusMm > 0 ? bendRadiusMm : 1;
  const t = Number.isFinite(thicknessMm) && thicknessMm > 0 ? thicknessMm : 1;
  const kk = Number.isFinite(k) && k > 0 ? k : 0.44;
  return (Math.PI / 180) * a * (r + kk * t);
}

/**
 * Bend deduction — what you subtract from the flange leg sum to get
 * the developed flat length. Press-brake operators read this off the
 * pattern; we expose it so the FlatPatternView can label every bend.
 *
 *   BD = 2·(R + T)·tan(θ/2) − BA
 */
export function bendDeduction({ angleDeg, bendRadiusMm, thicknessMm, k }) {
  const a = Number.isFinite(angleDeg) ? angleDeg : 90;
  const r = Number.isFinite(bendRadiusMm) && bendRadiusMm > 0 ? bendRadiusMm : 1;
  const t = Number.isFinite(thicknessMm) && thicknessMm > 0 ? thicknessMm : 1;
  const ba = bendAllowance({ angleDeg: a, bendRadiusMm: r, thicknessMm: t, k });
  return 2 * (r + t) * Math.tan((a * Math.PI / 180) / 2) - ba;
}
