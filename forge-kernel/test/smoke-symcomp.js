// Forge-247 — Symmetrical components smoke (Stevenson example 11-1).
//
// Balanced positive-sequence input: V_a = 1∠0°, V_b = 1∠−120°, V_c = 1∠120°.
//   → V_0 = 0, V_+ = 1∠0°, V_− = 0
//
// Unbalanced fixture: V_a = 1∠0°, V_b = 1∠180°, V_c = 0.
//   V_0 = (1 + (−1) + 0)/3 = 0
//   V_+ = (1 + 1·∠120·∠180 + 1·∠240·0)/3 = (1 + 1∠300°)/3
//       = (1 + (0.5 − j0.866))/3 = (1.5 − j0.866)/3 = 0.5 − j0.2887
//       |V_+| = √(0.25 + 0.0833) = √0.333 = 0.5774; ∠ = atan2(−0.2887, 0.5) = −30°
//   V_− = (1 + 1∠240·∠180 + 1∠120·0)/3 = (1 + 1∠60°)/3
//       = (1 + 0.5 + j0.866)/3 = 0.5 + j0.2887
//       |V_−| = 0.5774; ∠ = +30°
//
// Round-trip: compose(decompose(V_abc)) ≈ V_abc.
//
// Fault: V = 1 p.u., Z_0 = j0.10, Z_1 = j0.15, Z_2 = j0.15.
//   |I_3φ| = 1/0.15 = 6.667
//   |I_LG| = 3/(0.10+0.15+0.15) = 3/0.40 = 7.5
//   |I_LL| = √3/(0.15+0.15) = √3/0.30 = 5.774

const path = require('path');
const kernel = require(path.resolve(__dirname,
    '../build/Release/forge-kernel.node'));

function approx(a, b, rel) { return Math.abs(a - b) <= rel * Math.abs(b); }

const balanced = kernel.symcomp.decompose({
  Va: { magnitude: 1, angleDeg: 0 },
  Vb: { magnitude: 1, angleDeg: -120 },
  Vc: { magnitude: 1, angleDeg: 120 },
});
console.log('balanced:', balanced);
if (balanced.zero.magnitude > 1e-6) throw new Error('V_0 should be ~0');
if (!approx(balanced.positive.magnitude, 1.0, 1e-6)) throw new Error('V_+ should be 1');
if (balanced.negative.magnitude > 1e-6) throw new Error('V_- should be ~0');

const unbal = kernel.symcomp.decompose({
  Va: { magnitude: 1, angleDeg: 0 },
  Vb: { magnitude: 1, angleDeg: 180 },
  Vc: { magnitude: 0, angleDeg: 0 },
});
console.log('unbal:', unbal);
if (unbal.zero.magnitude > 1e-6) throw new Error('V_0 should be ~0');
if (!approx(unbal.positive.magnitude, 0.5774, 0.001)) throw new Error('|V_+| off');
if (!approx(unbal.positive.angleDeg, -30, 0.01)) throw new Error('∠V_+ off');
if (!approx(unbal.negative.magnitude, 0.5774, 0.001)) throw new Error('|V_-| off');
if (!approx(unbal.negative.angleDeg, 30, 0.01)) throw new Error('∠V_- off');

// Round-trip.
const rt = kernel.symcomp.compose(unbal);
console.log('round-trip:', rt);
if (!approx(rt.Va.magnitude, 1.0, 1e-6)) throw new Error('V_a round-trip mag');
if (Math.abs(rt.Va.angleDeg - 0.0) > 1e-6) throw new Error('V_a round-trip angle');
if (!approx(rt.Vb.magnitude, 1.0, 1e-6)) throw new Error('V_b round-trip mag');
if (!approx(Math.abs(rt.Vb.angleDeg), 180, 1e-6)) throw new Error('V_b round-trip angle');
if (rt.Vc.magnitude > 1e-6) throw new Error('V_c should be ~0');

const fault = kernel.symcomp.faultCurrents({
  prefaultPhaseVoltage: 1.0,
  Z0_magnitude: 0.10, Z0_angleDeg: 90,
  Z1_magnitude: 0.15, Z1_angleDeg: 90,
  Z2_magnitude: 0.15, Z2_angleDeg: 90,
});
console.log('fault:', fault);
if (!approx(fault.threePhaseFaultI, 6.667, 0.001)) throw new Error('I_3φ off');
if (!approx(fault.lineToGroundFaultI, 7.5, 0.001)) throw new Error('I_LG off');
if (!approx(fault.lineToLineFaultI, Math.sqrt(3)/0.30, 0.001)) throw new Error('I_LL off');

console.log('OK — symcomp smoke green');
