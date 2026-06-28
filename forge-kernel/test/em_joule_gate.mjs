// forge-kernel — current-conduction + Joule→thermal coupling gate (Elmer-track E3)
//
// Forge's FIRST native multiphysics coupling. forge.em.currentConduction solves
// the steady current-conservation law −∇·(σ∇V)=0 (the SAME scalar-elliptic
// operator as conduction, c = σ — solved by REUSING forge.fea.solveThermal with
// k := σ), forms the volumetric Joule source q''' = σ|∇V|² per element, and
// INJECTS it as a thermal element source back into the SAME (byte-unchanged)
// forge.fea.solveThermal to obtain the coupled temperature — a one-way V→q→T
// staggered coupling.
//
// Known-answer checks (uniform bar, current ∥ x, ends at T₀, sides insulated):
//   1. Power balance (Joule's law):  ∫σ|∇V|² dV = I²R ,  R = L/(σA) ,  I = V/R.
//   2. 1-D Joule-heated bar (closed form):  with uniform q''' and both ends held
//      at T₀, −k T'' = q''' gives the parabola  T(x) = T₀ + q'''/(2k)·x(L−x),
//      peak ΔT at mid-span = q'''L²/(8k).
//
// HONEST ACCURACY NOTE — the bar field is uniform/linear (V) and the heat
// equation has a constant source with a parabolic solution that 1-D linear FEM
// reproduces nodally exact, so both checks are met to ~machine/round-off level on
// a modest grid; the gate prints the real % error all the same.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

if (!(forge.em && forge.em.currentConduction)) {
  console.error('forge.em.currentConduction missing');
  process.exit(1);
}

const fail = [];
const report = (got, want, tolPct, label) => {
  const err = Math.abs(got - want) / Math.abs(want) * 100;
  const ok = err <= tolPct;
  if (!ok) fail.push(label);
  console.log(`[joule-gate] ${ok ? 'PASS' : 'FAIL'} ${label}`);
  console.log(`             measured ${got.toExponential(6)} vs ${want.toExponential(6)}  (err ${err.toFixed(4)} % / band ${tolPct} %)`);
  return err;
};

// ---- bar spec --------------------------------------------------------------
const Lx = 0.10, Ly = 0.01, Lz = 0.01;   // 100 × 10 × 10 mm bar
const A  = Ly * Lz;                       // cross-section 1e-4 m²
const sigma = 1.0e6;                      // S/m
const V = 0.1;                            // applied voltage
const k = 50;                             // W/(m·K)
const T0 = 0;                             // both ends held at 0 °C

const cfg = { Lx, Ly, Lz, nx: 40, ny: 4, nz: 4, sigma, V, k, T0 };
const r = forge.em.currentConduction(cfg);
console.log(`[joule-gate] bar ${cfg.nx}×${cfg.ny}×${cfg.nz} = ${r.nElems} elements, ${r.nNodes} nodes`);
console.log(`[joule-gate] residual V=${r.residualV.toExponential(2)}  T=${r.residualT.toExponential(2)}`);
console.log(`[joule-gate] R = L/(σA) = ${r.resistance.toExponential(5)} Ω,  I = V/R = ${r.current.toExponential(5)} A`);

// ---- (1) power balance  ∫σ|∇V|² dV = I²R -----------------------------------
const I2R = r.current * r.current * r.resistance;   // = V²/R
report(r.dissipation, I2R, 0.1, 'Joule dissipation ∫σ|∇V|²dV = I²R');

// ---- (2) 1-D Joule-heated bar peak ΔT = q'''L²/(8k) ------------------------
// q''' is uniform across the bar; take it from any element.
const q3 = r.joule[0];
let qmin = Infinity, qmax = -Infinity;
for (const q of r.joule) { if (q < qmin) qmin = q; if (q > qmax) qmax = q; }
console.log(`[joule-gate] volumetric Joule source q''' = ${q3.toExponential(5)} W/m³  (uniformity: min ${qmin.toExponential(5)}, max ${qmax.toExponential(5)})`);
const dTmeas = r.maxT - T0;
const dTana  = q3 * Lx * Lx / (8 * k);
console.log(`[joule-gate] coupled T range [${r.minT.toFixed(4)}, ${r.maxT.toFixed(4)}] (peak at mid-span)`);
report(dTmeas, dTana, 0.5, "1-D Joule bar peak ΔT = q'''L²/(8k)");

console.log('');
if (fail.length) {
  console.log('[joule-gate] FAILURES: ' + fail.join('; '));
  process.exit(1);
}
console.log('[joule-gate] ALL PASS');
