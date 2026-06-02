// Forge-212 — fatigue calculator smoke.

const kernel = require('../build/Release/forge-kernel.node');
const fa = kernel.fatigue;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

// (1) Material lookup.
const ms = fa.materialDefaults('mild-steel');
close(ms.sigmaFCoef, 1000, 1e-9, 'mild-steel σf');
close(ms.bExponent, -0.085, 1e-9, 'mild-steel b');

const al = fa.materialDefaults('7075-T6');
ck(al.sigmaFCoef > 1000, `7075 σf ${al.sigmaFCoef}`);

// (2) cyclesToFailure — at σ = σ'f, Nf = 1/2.
//     Basquin: σ_a = σ'f · (2 Nf)^b ⇒ if σ_a = σ'f then (2 Nf)^b = 1 → 2 Nf = 1 → Nf = 0.5.
const Nf_at_sigmaF = fa.cyclesToFailure(1000, 1000, -0.085);
close(Nf_at_sigmaF, 0.5, 1e-9, 'Nf at σa = σf');

// At lower amplitude (say σ_a = 500 MPa with σ'f = 1000, b = -0.085):
//   Nf = 0.5 · (500/1000)^(1/-0.085) = 0.5 · 0.5^(-11.76) = 0.5 · 2^11.76 ≈ 1735
const Nf_500 = fa.cyclesToFailure(500, 1000, -0.085);
ck(Nf_500 > 1000 && Nf_500 < 5000, `Nf at 500 MPa = ${Nf_500}`);

// (3) Miner's rule: 3 blocks. Damage sums.
const r = fa.cumulativeDamage({
  material: ms,
  blocks: [
    { stressAmplitudeMPa: 500, appliedCycles: 100 },
    { stressAmplitudeMPa: 400, appliedCycles: 500 },
    { stressAmplitudeMPa: 300, appliedCycles: 1000 },
  ],
});
ck(r.perBlock.length === 3, `perBlock length ${r.perBlock.length}`);
ck(r.totalDamage > 0, `totalDamage ${r.totalDamage}`);
const sum = r.perBlock.reduce((s, b) => s + b.damageContribution, 0);
close(r.totalDamage, sum, 1e-9, 'damage sum check');

// (4) Pure overload — single block at the fatigue strength coefficient
//     itself: σ_a = σ'f, Nf = 0.5, so 1 applied cycle ⇒ damage = 2 ⇒ failed.
const r2 = fa.cumulativeDamage({
  material: ms,
  blocks: [{ stressAmplitudeMPa: 1000, appliedCycles: 1 }],
});
ck(r2.failed === true, `overload failed ${r2.failed}`);
close(r2.totalDamage, 2, 1e-6, 'overload damage = 2');

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-212 fatigue smoke: OK');
console.log(`  Nf @ 500 MPa = ${Nf_500.toFixed(1)} cycles`);
console.log(`  3-block damage = ${r.totalDamage.toExponential(3)} (failed: ${r.failed})`);
console.log(`  remaining cycles: ${r.cyclesRemaining.toFixed(0)}`);
