// Forge-201 — sheet metal flat-pattern smoke.

const kernel = require('../build/Release/forge-kernel.node');
const sm = kernel.sheetmetal;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };
const close = (a, b, tol, msg) => { if (Math.abs(a-b) > tol) errs.push(`${msg}: ${a} vs ${b}`); };

// (1) K-factor table — basic sanity: K rises with R/T.
const kAtSmall = sm.kFactor('mild-steel', 0.5);
const kAtLarge = sm.kFactor('mild-steel', 5.0);
ck(kAtLarge > kAtSmall, `K rises with R/T (small=${kAtSmall}, large=${kAtLarge})`);

// (2) computeBend — a classic 90° bend, R=1.0, T=1.0, K=0.41:
//     BA = (π/2) · (1.0 + 0.41·1.0) = 1.5708 · 1.41 ≈ 2.2148
//     BD = 2·(1+1)·tan(45°) - BA = 4 - 2.2148 ≈ 1.7852
const br = sm.computeBend({
  angleDeg: 90, innerRadius: 1.0, thickness: 1.0, kOverride: 0.41,
});
close(br.bendAllowance, 2.2148, 0.001, 'BA(90°,R=T=1,K=0.41)');
close(br.bendDeduction, 1.7852, 0.002, 'BD(90°,R=T=1,K=0.41)');
close(br.neutralRadius, 1.41,   0.001, 'neutralR');
close(br.effectiveK,    0.41,   1e-9,  'effectiveK');

// (3) unfoldChain — two 90° bends turning a 100 × 50 × 50 channel.
//     Flanges: 50, 100, 50. Bends: two 90°, R=1, T=1.
//     Expected: developedLength = 200 + 2 · BA  ≈ 200 + 4.4296 ≈ 204.43
const r = sm.unfoldChain({
  flangeLengths: [50, 100, 50],
  bends: [
    { angleDeg: 90, innerRadius: 1, kOverride: 0.41 },
    { angleDeg: 90, innerRadius: 1, kOverride: 0.41 },
  ],
  thickness: 1, width: 30,
});
close(r.developedLength, 200 + 2 * 2.2148, 0.005, 'developedLength');
close(r.sheetArea,       (200 + 2 * 2.2148) * 30, 1.0, 'sheetArea');
ck(r.perBend.length === 2,        'perBend length 2');
ck(r.flangeStartX.length === 3,   'flangeStartX length 3');
close(r.flangeStartX[0], 0,                          1e-9,  'flangeStartX[0]');
close(r.flangeStartX[1], 50 + 2.2148,                0.003, 'flangeStartX[1]');
close(r.flangeStartX[2], 50 + 2.2148 + 100 + 2.2148, 0.003, 'flangeStartX[2]');

// (4) Material lookup — aluminium has lower K than steel at large R/T?
// Actually at R/T ≥ 3 they converge — the table puts both at 0.45 / 0.50.
// Just verify the lookup runs without throwing.
const kAl = sm.kFactor('aluminium', 2.0);
ck(kAl > 0 && kAl < 1, `aluminium K plausible: ${kAl}`);

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-201 sheet metal smoke: OK');
console.log(`  BA(90°,R=T=1)=${br.bendAllowance.toFixed(4)}  BD=${br.bendDeduction.toFixed(4)}`);
console.log(`  L_dev=${r.developedLength.toFixed(3)} sheetArea=${r.sheetArea.toFixed(1)} mm²`);
