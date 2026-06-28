// forge-kernel — electrostatics known-answer gate (Elmer-track E2)
//
// Validates forge.em.electrostatics against the three textbook capacitor
// closed forms. The solver is native, built on the SHARED scalar-elliptic
// assembler reused from solveThermal / magnetostatics (operator −∇·(ε∇φ)=0,
// coefficient c = ε for the planar gap, c = ε·r for the coaxial radial field,
// c = ε·r² for the spherical radial field — the same coefficient-folding the
// axisymmetric magnetostatics solver uses for its 1/r weighting). Capacitance
// is recovered from the field energy:  C = 2W/V²,  W = ½∫ε|∇φ|² dV.
//
//   1. Parallel plate (Griffiths, Intro to Electrodynamics §2.5.4):
//        C = ε₀ A / d
//   2. Coaxial cable (Griffiths §2.5.4 / Jackson):
//        E(r) = V / (r·ln(b/a)) ,   C' = 2πε₀ / ln(b/a)   (per unit length)
//   3. Isolated conducting sphere (Griffiths §2.5.4):
//        C = 4πε₀ R   (as the outer boundary R_out → ∞; the finite-domain FE
//        value is 4πε₀ / (1/R − 1/R_out), which → 4πε₀R)
//
// HONEST ACCURACY NOTE — the planar gap is a linear field, reproduced EXACTLY by
// the linear hex (machine precision). The coaxial (ln) and spherical (1/r) fields
// are curved, so the uniform-radial linear-element discretisation carries an
// O((Δr/r)²) energy error that concentrates near the inner radius (where the
// field is steepest); the gate prints the real % error and asserts an honest
// band, refining n until each curved case is within a few %.

import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import path from 'path';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

if (!(forge.em && forge.em.electrostatics)) {
  console.error('forge.em.electrostatics missing');
  process.exit(1);
}

const EPS0 = 8.8541878128e-12; // F/m
const fail = [];
const report = (got, want, tolPct, label) => {
  const err = Math.abs(got - want) / Math.abs(want) * 100;
  const ok = err <= tolPct;
  if (!ok) fail.push(label);
  console.log(`[es-gate] ${ok ? 'PASS' : 'FAIL'} ${label}`);
  console.log(`           measured ${got.toExponential(5)} vs ${want.toExponential(5)}  (err ${err.toFixed(3)} % / band ${tolPct} %)`);
  return err;
};

// ---- (1) parallel plate:  C = ε₀ A / d -------------------------------------
{
  const A = 0.01;     // plate area 100 cm² (0.1 m × 0.1 m)
  const d = 0.001;    // gap 1 mm
  const V = 1.0;
  const r = forge.em.electrostatics({
    geometry: 'planar', eps: EPS0, rInner: 0, rOuter: d, V, n: 200, area: A,
  });
  const Cana = EPS0 * A / d;
  console.log(`[es-gate] parallel-plate A=${A} m², d=${d} m  (residual ${r.residual.toExponential(2)})`);
  report(r.capacitance, Cana, 0.5, 'parallel-plate C = ε₀A/d');
}

// ---- (2) coaxial cable:  C' = 2πε₀/ln(b/a),  E(r) = V/(r·ln(b/a)) ----------
{
  const a = 0.001;    // inner conductor radius 1 mm
  const b = 0.003;    // outer conductor radius 3 mm
  const V = 1.0;
  const n = 4000;
  const r = forge.em.electrostatics({
    geometry: 'cylindrical', eps: EPS0, rInner: a, rOuter: b, V, n, length: 1.0,
  });
  const Cana = 2 * Math.PI * EPS0 / Math.log(b / a);
  console.log(`[es-gate] coaxial a=${a} m, b=${b} m, n=${n}  (residual ${r.residual.toExponential(2)})`);
  report(r.capacitance, Cana, 1.0, "coaxial C' = 2πε₀/ln(b/a) (per metre)");
  // field check E(r) at the element nearest r = 2 mm
  const rt = 0.002;
  let be = 0, bd = Infinity;
  for (let e = 0; e < r.n; e++) { const dd = Math.abs(r.elemR[e] - rt); if (dd < bd) { bd = dd; be = e; } }
  const Eana = V / (r.elemR[be] * Math.log(b / a));
  report(r.Efield[be], Eana, 1.0, `coaxial E(r=${r.elemR[be].toFixed(4)}) = V/(r·ln(b/a))`);
}

// ---- (3) isolated sphere:  C = 4πε₀R  (finite domain 4πε₀/(1/R−1/R_out)) ----
{
  const R    = 0.01;   // sphere radius 1 cm
  const Rout = 1.00;   // far-field truncation 100·R
  const V = 1.0;
  const n = 6000;
  const r = forge.em.electrostatics({
    geometry: 'spherical', eps: EPS0, rInner: R, rOuter: Rout, V, n,
  });
  const Cfinite = 4 * Math.PI * EPS0 / (1 / R - 1 / Rout); // exact finite-domain answer
  const Cinf    = 4 * Math.PI * EPS0 * R;                  // isolated-sphere limit
  console.log(`[es-gate] sphere R=${R} m, R_out=${Rout} m (=${(Rout/R).toFixed(0)}·R), n=${n}  (residual ${r.residual.toExponential(2)})`);
  report(r.capacitance, Cfinite, 2.0, 'sphere C = 4πε₀/(1/R−1/R_out) (finite-domain exact)');
  const gapPct = Math.abs(Cfinite - Cinf) / Cinf * 100;
  console.log(`[es-gate] isolated-sphere limit 4πε₀R = ${Cinf.toExponential(5)} F; finite domain is +${gapPct.toFixed(2)} % (the 1/(1−R/R_out) truncation factor) → measured ${(r.capacitance/Cinf).toFixed(4)}·(4πε₀R)`);
}

console.log('');
if (fail.length) {
  console.log('[es-gate] FAILURES: ' + fail.join('; '));
  process.exit(1);
}
console.log('[es-gate] ALL PASS');
