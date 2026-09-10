'use strict';
// Falsifiable battery for the cantilever acceptance bands.
//
// It needs NO addon build, which is the point: fea_smoke.cjs requires
// forge-kernel.node, so its bands could only ever be exercised by a full build plus
// a 161-second run dominated by a modal eigensolve. That is why they went years
// admitting a -91.2 % displacement.
//
// BOTH DIRECTIONS, against the two REAL measured runs of the same test on the same
// beam — a baseline build (git-pinned at 38177d4b, before the boundary fix) and the
// fixed build. A band that always passes admits the first; a band that always fails
// rejects the second. Only a band that discriminates does both.
//
//   node forge-kernel/test/fea_smoke_band_test.cjs
const assert = require('assert');
const { THEORY, BANDS, TOL, checkBands } = require('./fea_smoke_bands.cjs');

let CHECKS = 0; const FAIL = [];
function check(cond, label, detail) {
  CHECKS++;
  if (!cond) { FAIL.push(label + (detail ? ` — ${detail}` : '')); console.log(`  FAIL ${label}${detail ? `  [${detail}]` : ''}`); }
}

// Measured 2026-09-10, forge-kernel/reports/FEA_BOUNDARY_FIX_MEASURED.md.
const BASELINE = { maxDisp_m: 17.624e-6,  maxVonMises_Pa: 28.70e6, firstMode_Hz: 2661.6 };
const FIXED    = { maxDisp_m: 184.146e-6, maxVonMises_Pa: 56.35e6, firstMode_Hz:  848.6 };

const b = checkBands(BASELINE);
check(b.length > 0, 'the PRE-FIX run is REJECTED (it passed the old bands)', `violations: ${b.length}`);
check(b.some(s => s.startsWith('maxDisp_m')),      'and the -91.2% displacement is named', b.join(' | '));
check(b.some(s => s.startsWith('firstMode_Hz')),   'and the +226% first mode is named',    b.join(' | '));
check(b.some(s => s.startsWith('maxVonMises_Pa')), 'and the -52.2% stress is named',       b.join(' | '));

const f = checkBands(FIXED);
check(f.length === 0, 'the POST-FIX run is ACCEPTED', f.join(' | '));

// The band must not be so tight that it is an accuracy gate in disguise: the fixed
// run sits at ~8% error and must have real headroom on both sides.
for (const k of Object.keys(BANDS)) {
  const [lo, hi] = BANDS[k];
  check(FIXED[k] > lo * 1.05 && FIXED[k] < hi * 0.95,
        `${k}: the accepted run is comfortably inside, not hugging an edge`,
        `${FIXED[k]} in [${lo}, ${hi}]`);
}

// An order-of-magnitude error must fail in EITHER direction — the old bands caught
// neither, and a one-sided band would still miss half of them.
check(checkBands({ ...FIXED, maxDisp_m: FIXED.maxDisp_m / 10 }).length > 0, '10x too stiff fails');
check(checkBands({ ...FIXED, maxDisp_m: FIXED.maxDisp_m * 10 }).length > 0, '10x too soft fails');
check(checkBands({ ...FIXED, firstMode_Hz: FIXED.firstMode_Hz * 3 }).length > 0, '3x mode fails');

// Degenerate inputs are violations, not silent passes.
check(checkBands({}).length === 3, 'missing values are all reported', String(checkBands({}).length));
check(checkBands({ ...FIXED, maxDisp_m: NaN }).length > 0, 'NaN is a violation, not a pass');

// The old bands must be recorded as unable to do the job — this is the regression
// the whole change exists to prevent.
const OLD = { maxDisp_m: [0.5e-6, 5e-4], maxVonMises_Pa: [10e6, 200e6], firstMode_Hz: [50, 5000] };
const oldAdmits = Object.keys(OLD).every(k => BASELINE[k] >= OLD[k][0] && BASELINE[k] <= OLD[k][1]);
check(oldAdmits, 'PREMISE: the OLD bands really did admit the broken run '
                 + '(if this fails, the fix is aimed at nothing)');
const nowRejects = checkBands(BASELINE).length > 0;
check(nowRejects && oldAdmits, 'and the new bands reject exactly what the old ones admitted');

console.log(`[fea-smoke-bands] ${CHECKS} checks, ${FAIL.length} failures  (tolerance ±${(TOL*100).toFixed(0)}%)`);
for (const s of FAIL) console.log(`   - ${s}`);
process.exit(FAIL.length ? 1 : 0);
