// Forge-257 — RC column smoke (Nilson Ch. 9 / PCA Notes).
//
// Square tied column: 400 × 400 mm = 0.16 m²; d = 0.34 m; h = 0.4 m;
// d' = 0.06 m; A_st = 6·#7 bars ≈ 6·387 mm² = 2322 mm² = 2.322e-3 m²;
// f'_c = 28 MPa; f_y = 414 MPa.
//
// Pure compression nominal:
//   concrete area = 0.16 − 0.002322 = 0.157678 m²
//   P_no = 0.85·28e6·0.157678 + 414e6·2.322e-3
//        = 3,753,725 + 961,308 = 4,715,033 N ≈ 4715 kN
//
// Tied: φ = 0.65, max factor = 0.80.
//   φPn_max = 0.65·0.80·4715 = 2452 kN
//
// Balanced (symmetric A_s = A_s' = 1.161e-3 m²):
//   β_1 = 0.85; c_b = 0.6·0.34 = 0.204 m; a_b = 0.85·0.204 = 0.1734 m
//   C_c = 0.85·28e6·0.4·0.1734 = 1,650,792 N
//   C_s = 1.161e-3·(414e6 − 0.85·28e6) = 1.161e-3·390.2e6 = 453,022 N
//   T   = 1.161e-3·414e6 = 480,654 N
//   P_nb = 1650792 + 453022 − 480654 = 1,623,160 N ≈ 1623 kN
//   M_nb = 1650792·(0.2 − 0.0867) + 453022·(0.2−0.06) + 480654·(0.34−0.2)
//        = 1650792·0.1133 + 453022·0.14 + 480654·0.14
//        = 187,034 + 63,423 + 67,292 = 317,749 N·m ≈ 318 kN·m
//
// Spiral version of same column: φ = 0.75, max factor = 0.85 →
//   φPn_max = 0.75·0.85·4715 = 3006 kN (higher than tied).

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const tied = kernel.rccolumn.analyse({
  tieType: 'tied',
  grossAreaM2: 0.16, effectiveDepthM: 0.34, overallDepthM: 0.4,
  widthM: 0.4, coverM: 0.06,
  steelAreaTotalM2: 2.322e-3,
  concreteFcPa: 28e6, steelFyPa: 414e6,
});
console.log('tied:', tied);
if (!approx(tied.nominalAxialN / 1000, 4715, 0.01)) throw new Error('P_no off');
if (!approx(tied.designMaxAxialN / 1000, 2452, 0.01))
  throw new Error('φPn_max off');
if (!approx(tied.balancedAxialN / 1000, 1623, 0.01))
  throw new Error('P_nb off');
if (!approx(tied.balancedMomentNm / 1000, 318, 0.02))
  throw new Error('M_nb off');

const spiral = kernel.rccolumn.analyse({
  tieType: 'spiral',
  grossAreaM2: 0.16, effectiveDepthM: 0.34, overallDepthM: 0.4,
  widthM: 0.4, coverM: 0.06,
  steelAreaTotalM2: 2.322e-3,
  concreteFcPa: 28e6, steelFyPa: 414e6,
});
console.log('spiral:', spiral);
if (!approx(spiral.designMaxAxialN / 1000, 3006, 0.01))
  throw new Error('spiral φPn_max off');
if (!(spiral.designMaxAxialN > tied.designMaxAxialN))
  throw new Error('spiral should give higher φPn_max');

console.log('OK — rccolumn smoke green');
