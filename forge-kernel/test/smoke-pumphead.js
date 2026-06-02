// Forge-229 — Pump head / pipe flow smoke.
//
// Water at 20°C through 100 m of 50 mm pipe at Q = 10 L/s = 0.010 m³/s.
//   ρ = 998 kg/m³, μ = 1.0e-3 Pa·s, ε = 0.046 mm (commercial steel)
//   A = π·0.05²/4 = 1.963e-3 m²
//   V = 0.010 / 1.963e-3 = 5.09 m/s
//   Re = 998·5.09·0.05 / 1.0e-3 = 254 014 (fully turbulent)
//   ε/D = 4.6e-5 / 0.05 = 9.2e-4
//   Swamee-Jain: f = 0.25 / log10(9.2e-4/3.7 + 5.74/Re^0.9)²
//              ≈ 0.0226
//   h_f = 0.0226 · 100/0.05 · 5.09² / (2·9.80665) ≈ 59.7 m
//   shaft P (η=0.7, static H=0) = 998·9.806·0.01·59.7/0.7 ≈ 8.35 kW

const kernel = require('../build/Release/forge-kernel.node');
const ph = kernel.pumphead;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

const r = ph.analyse({
  flowRate: 0.010, diameter: 0.050, pipeLength: 100,
  roughness: 4.6e-5, density: 998, dynamicViscosity: 1.0e-3,
  staticHead: 0, pumpEfficiency: 0.7,
});

close(r.meanVelocity, 0.010 / (Math.PI * 0.05 * 0.05 / 4), 1e-9, 'V');
close(r.reynolds, 998 * r.meanVelocity * 0.05 / 1.0e-3, 1, 'Re');
ck(r.frictionFactor > 0.02 && r.frictionFactor < 0.025, `f ≈ 0.023 (got ${r.frictionFactor})`);
ck(r.frictionHead > 50 && r.frictionHead < 70, `h_f ≈ 60 m (got ${r.frictionHead})`);
ck(r.shaftPower > 7000 && r.shaftPower < 9000, `shaft P ≈ 8 kW (got ${r.shaftPower})`);

// (2) Laminar: Re < 2300 uses 64/Re
const lam = ph.analyse({
  flowRate: 1e-6, diameter: 0.02, pipeLength: 10,
  roughness: 1e-6, density: 1000, dynamicViscosity: 0.1,
  staticHead: 0, pumpEfficiency: 0.5,
});
ck(lam.reynolds < 2300, `Re laminar (${lam.reynolds})`);
close(lam.frictionFactor, 64 / lam.reynolds, 1e-12, 'f = 64/Re');

// (3) Standalone Re function
const Re = ph.reynoldsNumber(2.0, 0.05, 1000, 1e-3);
close(Re, 1000 * 2 * 0.05 / 1e-3, 1e-9, 'Re standalone');

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-229 pump head smoke: OK');
console.log(`  V = ${r.meanVelocity.toFixed(2)} m/s, Re = ${(r.reynolds/1000).toFixed(1)}k, f = ${r.frictionFactor.toFixed(4)}`);
console.log(`  h_f = ${r.frictionHead.toFixed(1)} m, shaft P = ${(r.shaftPower/1000).toFixed(2)} kW`);
