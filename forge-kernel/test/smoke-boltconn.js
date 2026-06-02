// Forge-236 — Bolted connection smoke (AISC J3 lap joint).
//
// Bolt: 3/4" A325-N → A_b = π/4·(0.01905)² = 2.850e-4 m², F_ub = 825 MPa.
// Plate: t = 10 mm, F_u = 400 MPa, F_y = 250 MPa.
// L_c = 35 mm, d_b = 19.05 mm.
//
// Bolt shear (1 plane, threads in plane):
//   F_nv = 0.45 · 825 MPa = 371.25 MPa
//   R_n_v = 371.25e6 · 2.850e-4 = 105,806 N = 105.8 kN
//   φR_v  = 0.75 · 105.8 = 79.4 kN
//
// Bearing (J3-6a):
//   1.2·L_c·t·F_u = 1.2 · 0.035 · 0.010 · 400e6 = 168,000 N = 168 kN
//   2.4·d_b·t·F_u = 2.4 · 0.01905 · 0.010 · 400e6 = 182,880 N
//   bearing = min(...) = 168 kN
//   φR_p = 0.75 · 168 = 126 kN
//
// Governed by bolt shear (79.4 kN < 126 kN). governedByShear = true.
//
// Tension: W = 100 mm, t = 10 mm, n = 2 bolts across, d_h = 20.65 mm, U = 1.
//   A_g = 0.100 · 0.010 = 1.0e-3 m²
//   A_n = (0.100 - 2·0.02065)·0.010 = 5.87e-4 m²
//   A_e = 1.0 · A_n = 5.87e-4 m²
//   φ·F_y·A_g  = 0.9·250e6·1e-3 = 225,000 N = 225 kN
//   φ·F_u·A_e  = 0.75·400e6·5.87e-4 = 176,100 N ≈ 176 kN
//   Rupture governs.

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, tol) {
  return Math.abs(a - b) <= tol;
}

const Ab = Math.PI / 4 * Math.pow(0.01905, 2);
const rs = kernel.boltconn.analyseShear({
  boltAreaM2: Ab,
  boltUltimatePa: 825e6,
  plateThicknessM: 0.010,
  boltNominalDiamM: 0.01905,
  edgeClearanceM: 0.035,
  plateUltimatePa: 400e6,
  shearPlanes: 1,
  phiShear: 0.75,
  phiBearing: 0.75,
});
console.log('shear:', rs);
if (!approx(rs.boltShearN / 1000, 105.8, 0.5))
  throw new Error('bolt shear off');
if (!approx(rs.bearingLcN / 1000, 168.0, 1.0))
  throw new Error('bearing L_c branch off');
if (!approx(rs.bearingN / 1000, 168.0, 1.0))
  throw new Error('bearing min off');
if (!approx(rs.designShearN / 1000, 79.4, 0.5))
  throw new Error('φR_v off');
if (rs.governedByShear !== true)
  throw new Error('expected shear-governed');

const rt = kernel.boltconn.analyseTension({
  grossAreaM2: 0.100 * 0.010,
  yieldPa: 250e6, ultimatePa: 400e6,
  plateWidthM: 0.100, plateThicknessM: 0.010,
  boltsAcross: 2, holeDiameterM: 0.02065,
  shearLagU: 1.0, phiYield: 0.9, phiRupture: 0.75,
});
console.log('tension:', rt);
if (!approx(rt.netAreaM2, 5.87e-4, 1e-6))
  throw new Error('A_n off');
if (!approx(rt.designYieldN / 1000, 225.0, 0.5))
  throw new Error('φP_y off');
if (!approx(rt.designRuptureN / 1000, 176.1, 0.5))
  throw new Error('φP_r off');
if (rt.governedByRupture !== true)
  throw new Error('expected rupture-governed');

console.log('OK — boltconn smoke green');
