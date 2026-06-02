// Forge-231 — Fan / blower smoke.
//
// Reference: Q = 2 m³/s air, Δp_s = 500 Pa, ρ = 1.2 kg/m³, outlet
// 0.4 × 0.5 = 0.2 m². η = 0.7.
//   V = 10 m/s
//   Δp_v = ½·1.2·100 = 60 Pa
//   Δp_t = 560 Pa
//   P_hyd = 2·560 = 1120 W
//   P_shaft = 1120 / 0.7 = 1600 W

const kernel = require('../build/Release/forge-kernel.node');
const fb = kernel.fan;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

const r = fb.analyse({
  flowRate: 2.0, deltaPStatic: 500, density: 1.2,
  outletArea: 0.2, fanEfficiency: 0.7,
});
close(r.velocityOutlet, 10, 1e-9, 'V');
close(r.velocityPressure, 60, 1e-9, 'Δp_v');
close(r.totalPressure, 560, 1e-9, 'Δp_t');
close(r.hydraulicPower, 1120, 1e-6, 'P_hyd');
close(r.shaftPower, 1600, 1e-6, 'P_shaft');

// (2) Affinity: double the rpm at same density:
//   Q × 2, Δp × 4, P × 8
const a = fb.scaleByAffinity({
  Q1: 2.0, dP1: 560, P1: 1600, N1: 1500, rho1: 1.2,
  N2: 3000, rho2: 1.2,
});
close(a.Q2, 4, 1e-9, 'Q affinity');
close(a.dP2, 560 * 4, 1e-6, 'Δp affinity');
close(a.P2, 1600 * 8, 1e-6, 'P affinity');

// (3) Density scaling at constant N: Q unchanged, Δp and P scale.
const d = fb.scaleByAffinity({
  Q1: 2.0, dP1: 560, P1: 1600, N1: 1500, rho1: 1.2,
  N2: 1500, rho2: 0.9,        // hotter air
});
close(d.Q2, 2.0, 1e-12, 'Q unchanged');
close(d.dP2, 560 * 0.75, 1e-9, 'Δp · ρ ratio');
close(d.P2, 1600 * 0.75, 1e-9, 'P · ρ ratio');

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-231 fan / blower smoke: OK');
console.log(`  Q=2, Δp_s=500 → V=${r.velocityOutlet}, Δp_t=${r.totalPressure}, shaft P=${r.shaftPower}W`);
console.log(`  Doubling rpm: Q→${a.Q2}, Δp→${a.dP2}, P→${a.P2}`);
