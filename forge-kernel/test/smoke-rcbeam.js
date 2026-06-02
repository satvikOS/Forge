// Forge-238 — RC beam flexure smoke (ACI 318-19 §22.2).
//
// Textbook example (PCA / Nilson Ch. 4):
//   b = 300 mm, d = 500 mm, A_s = 3·#7 bars ≈ 3·387 mm² = 1161 mm² = 1.161e-3 m².
//   f'_c = 28 MPa, f_y = 414 MPa (Gr 60), E_s = 200 GPa.
//
//   β_1 = 0.85 (f'_c = 28 → at the cap of the table)
//   a   = 1.161e-3 · 414e6 / (0.85 · 28e6 · 0.300) = 480654 / 7140000 = 0.06733 m
//       = 67.3 mm
//   c   = 0.06733 / 0.85 = 0.07921 m = 79.2 mm
//   ε_t = 0.003·(0.500 − 0.07921)/0.07921 = 0.01594  → ε_t » 0.005, tension-controlled
//   φ   = 0.90
//   M_n = 1.161e-3 · 414e6 · (0.500 − 0.06733/2) = 480654 · 0.466335 = 224,165 N·m
//       ≈ 224 kN·m
//   φM_n = 0.90 · 224.2 = 201.7 kN·m
//
//   ρ      = 1.161e-3 / (0.3 · 0.5) = 7.74e-3
//   ρ_min  = max(1.4/414, √28/414/4) ≈ max(0.00338, 0.00319) = 0.00338
//   ρ_b    = 0.85·0.85·28/414·(600/(600+414)) ≈ 0.0285
//   ρ_max  = 0.75·0.0285 ≈ 0.0214

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

const r = kernel.rcbeam.analyse({
  widthM: 0.300, effectiveDepthM: 0.500, steelAreaM2: 1.161e-3,
  concreteFcPa: 28e6, steelFyPa: 414e6, steelEPa: 200e9,
});
console.log(r);

if (!approx(r.beta1, 0.85, 1e-9)) throw new Error('β_1 off');
if (!approx(r.stressBlockDepthM, 0.0673, 5e-4)) throw new Error('a off');
if (!approx(r.neutralAxisDepthM, 0.0792, 5e-4)) throw new Error('c off');
if (!approx(r.phi, 0.90, 1e-9)) throw new Error('φ off');
if (r.tensionControlled !== true) throw new Error('expected tension-controlled');
if (!approx(r.nominalMomentNm / 1000, 224.2, 1.0)) throw new Error('M_n off');
if (!approx(r.designMomentNm / 1000, 201.7, 1.0)) throw new Error('φM_n off');
if (!approx(r.rho, 7.74e-3, 1e-5)) throw new Error('ρ off');
if (!approx(r.rhoMin, 0.00338, 5e-5)) throw new Error('ρ_min off');
if (!approx(r.rhoBalanced, 0.0285, 5e-4)) throw new Error('ρ_b off');
if (r.belowRhoMin !== false) throw new Error('not below ρ_min');
if (r.aboveRhoMax !== false) throw new Error('not above ρ_max');

// β_1 transition: f'_c = 35 MPa → 0.85 − 0.05·7/7 = 0.80.
const r2 = kernel.rcbeam.analyse({
  widthM: 0.300, effectiveDepthM: 0.500, steelAreaM2: 1.161e-3,
  concreteFcPa: 35e6, steelFyPa: 414e6, steelEPa: 200e9,
});
if (!approx(r2.beta1, 0.80, 1e-9)) throw new Error('β_1 transition off');

// β_1 cap: f'_c = 70 MPa → 0.65.
const r3 = kernel.rcbeam.analyse({
  widthM: 0.300, effectiveDepthM: 0.500, steelAreaM2: 1.161e-3,
  concreteFcPa: 70e6, steelFyPa: 414e6, steelEPa: 200e9,
});
if (!approx(r3.beta1, 0.65, 1e-9)) throw new Error('β_1 cap off');

console.log('OK — rcbeam smoke green');
