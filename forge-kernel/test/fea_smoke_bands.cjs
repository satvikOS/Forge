'use strict';
// Acceptance bands for the Tet4 cantilever smoke test, and the check that applies
// them. Separated from fea_smoke.cjs so the JUDGEMENT can be tested without an
// addon build — the smoke test itself needs forge-kernel.node, which the default
// build does not produce (FORGE_BUILD_NODE_ADDON defaults ON in CMake but the
// checked-in build/ here is configured OFF), so its bands were effectively
// unexaminable.
//
// WHY THEY MOVED
// --------------
// The old bands were disp [0.5, 500] um, vonMises [10, 200] MPa, f1 [50, 5000] Hz.
// The displacement band spanned a factor of 1000 against a 200 um theory, and the
// header explained why: constant-strain Tet4 "suffer severe shear-locking in pure
// bending — typically returning 5–15x under the Bernoulli prediction EVEN ON A
// REFINED MESH", citing a hand-crafted 5-tet box that gave 2.9 um against 200 um.
//
// That conclusion is refuted by measurement. The mesher's boundary densification
// ran in a single pass, so the clamped face of this very beam carried ELEVEN nodes
// at every refinement level and the cantilever was restrained at 11 points instead
// of 51. With that fixed, the SAME element on the SAME beam gives:
//
//     tip displacement  184.146 um  vs 200.0 um theory      (-7.9 %)
//     peak von Mises     56.35 MPa  vs  60.0 MPa            (-6.1 %)
//     first mode        848.6 Hz    vs 815.4 Hz analytic    (+4.1 %)
//
// A 5-tet box does lock — five elements cannot represent bending — but the
// generalisation to "inherent to the element type, even on a refined mesh" was
// wrong, and the bands widened to accommodate it let a -91.2 % displacement and a
// +226 % first mode PASS. This test reported "within engineering plausibility band"
// on the exact defect an entire task existed to fix.
//
// The bands are now +/-40 % of the analytic value. That is deliberately looser than
// the ~8 % now achieved: it absorbs mesh and platform variation while still failing
// an order-of-magnitude error, which is the only thing the old bands could not do.
// Tightening to the measured accuracy would make this an accuracy gate, and it is a
// smoke test — the NAFEMS ratchet is where accuracy is ratcheted.

const THEORY = {
  // Euler-Bernoulli cantilever, 0.1 x 0.010 x 0.010 m, E = 200 GPa, rho = 7850,
  // 100 N at the tip. delta = PL^3/(3EI), sigma = Mc/I,
  // f1 = (1.875104^2 / 2pi) sqrt(EI / rho A L^4).
  maxDisp_m:      200.0e-6,
  maxVonMises_Pa:  60.0e6,
  firstMode_Hz:   815.4,
};

const TOL = 0.40;   // +/-40 % of the analytic value

function band(v) { return [v * (1 - TOL), v * (1 + TOL)]; }

const BANDS = {
  maxDisp_m:      band(THEORY.maxDisp_m),
  maxVonMises_Pa: band(THEORY.maxVonMises_Pa),
  firstMode_Hz:   band(THEORY.firstMode_Hz),
};

/**
 * @param {{maxDisp_m:number, maxVonMises_Pa:number, firstMode_Hz:number}} m
 * @returns {string[]} one message per band violated; empty means in band.
 */
function checkBands(m) {
  const out = [];
  const fmt = {
    maxDisp_m:      v => `${(v * 1e6).toFixed(3)} um`,
    maxVonMises_Pa: v => `${(v / 1e6).toFixed(2)} MPa`,
    firstMode_Hz:   v => `${v.toFixed(1)} Hz`,
  };
  for (const k of Object.keys(BANDS)) {
    const v = m[k];
    if (typeof v !== 'number' || !isFinite(v)) { out.push(`${k}: missing or not finite`); continue; }
    const [lo, hi] = BANDS[k];
    if (v < lo || v > hi) {
      const err = 100 * (v - THEORY[k]) / THEORY[k];
      out.push(`${k} ${fmt[k](v)} is ${err >= 0 ? '+' : ''}${err.toFixed(1)}% off theory ` +
               `${fmt[k](THEORY[k])} — outside [${fmt[k](lo)}, ${fmt[k](hi)}]`);
    }
  }
  return out;
}

module.exports = { THEORY, BANDS, TOL, checkBands };
