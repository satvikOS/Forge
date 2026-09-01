// Regression: forge.classa.continuityCheck G2 must not run INVERTED.
//
// WHY THIS EXISTS. The G2 branch of continuityCheck compared the two faces'
// mean curvatures without normalising for their outward-normal orientation.
// Adjacent faces on a sewn shell routinely carry opposite normals, and mean
// curvature is signed with respect to the normal, so a PERFECT G2 join was read
// as kA = +k against kB = -k and scored |k - (-k)| / k = 200%. Measured sweep
// on the unfixed kernel (tangent plane matched exactly, g1 = 0.0000 deg):
//
//     curvature ratio    1x     2x     10x     40x    curved-vs-FLAT
//     g2_max_pct        200%   150%   110%    102.5%      100%
//
// Monotonically DECREASING: the perfect join scored worst and the worst join
// scored best. Any acceptance gate of the form "g2 < tol" accepted nothing, and
// a tolerance tuned until parts passed would have selected for FLAT joins.
//
// The push07 smoke test did not catch this because it only asserts that the
// fields are numbers. This test asserts on their VALUES and their ORDER.
//
// Run:  node forge-kernel/test/classa_continuity_orientation_test.js [kernel.node]

const path = require('path');
const assert = require('assert');

const KERNEL = process.argv[2] || (() => {
  const cands = [
    path.resolve(__dirname, '..', 'build', 'forge-kernel.node'),
    path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node'),
  ];
  for (const c of cands) { try { require('fs').statSync(c); return c; } catch (_) {} }
  return null;
})();
assert.ok(KERNEL, 'forge-kernel.node not found');
const forge = require(KERNEL);
assert.ok(forge.classa, 'forge.classa namespace missing');
assert.ok(forge.surfacing, 'forge.surfacing namespace missing');

// A clamped cubic B-spline interpolates its first control row, and its boundary
// tangent runs along (row1 - row0). Driving the join condition from the CONTROL
// NET (rather than sampling an analytic surface into it) is what makes the
// tangent plane exact: both patches put row0 on the line y=0,z=0 and row1 flat
// in the z=0 plane, so the shared edge is G1 by construction and the ONLY thing
// that varies between the two sides is curvature.
function patch(hSign, curv) {
  const zRow = [0.0, 0.0, curv, curv * 2.5, curv * 4.5, curv * 7.0];
  const yRow = [0.0, 2.0, 4.0, 6.0, 8.0, 10.0];
  const uC = 6, vC = 6, xyz = [];
  for (let v = 0; v < vC; v++) {
    for (let u = 0; u < uC; u++) {
      xyz.push((u / (uC - 1)) * 10, yRow[v] * hSign, zRow[v]);
    }
  }
  return { uCount: uC, vCount: vC, xyz: Float64Array.from(xyz) };
}

function joinReport(cA, cB) {
  const fa = forge.surfacing.buildPatch(patch(+1, cA));
  const fb = forge.surfacing.buildPatch(patch(-1, cB));
  const st = forge.classa.stitchG2([fa, fb], 1e-3, true);
  assert.ok(st.reports && st.reports.length >= 1,
    `no shared-edge continuity report (edgeCount=${st.edgeCount})`);
  return st.reports[0];
}

// ---- the join is G0/G1 exact in every case: that is the positive control ----
const sweep = [
  { label: 'identical curvature (exact G2)', cA: 0.5,  cB: 0.5 },
  { label: '2x  curvature ratio',            cA: 1.0,  cB: 0.5 },
  { label: '10x curvature ratio',            cA: 5.0,  cB: 0.5 },
  { label: '40x curvature ratio',            cA: 20.0, cB: 0.5 },
  { label: 'curved meets FLAT',              cA: 5.0,  cB: 0.0 },
].map(c => ({ ...c, r: joinReport(c.cA, c.cB) }));

for (const { label, r } of sweep) {
  assert.ok(r.g0_max_mm < 1e-6,
    `${label}: patches should be position-continuous, g0 = ${r.g0_max_mm}`);
  assert.ok(r.g1_max_deg < 1e-6,
    `${label}: tangent plane is matched by construction, g1 = ${r.g1_max_deg} deg`);
  console.log(`  ${label.padEnd(32)} g1=${r.g1_max_deg.toFixed(4)}deg ` +
              `g2=${r.g2_max_pct.toFixed(2)}%`);
}

// ---- 1. a PERFECT G2 join must score ~0%, not 200% ----
const perfect = sweep[0].r.g2_max_pct;
assert.ok(perfect < 5.0,
  `an exactly curvature-continuous join must score near 0%, got ${perfect.toFixed(2)}% ` +
  `(200% is the signature of the un-normalised orientation bug)`);

// ---- 2. the metric must be MONOTONIC in the size of the defect ----
// This is the property that makes a threshold meaningful at all.
for (let i = 1; i < sweep.length; i++) {
  const prev = sweep[i - 1], cur = sweep[i];
  assert.ok(cur.r.g2_max_pct >= prev.r.g2_max_pct - 1e-9,
    `g2 must not improve as the defect grows: ` +
    `"${prev.label}" scored ${prev.r.g2_max_pct.toFixed(2)}% but ` +
    `"${cur.label}" scored ${cur.r.g2_max_pct.toFixed(2)}%`);
}

// ---- 3. a real curvature break must be clearly separated from a good join ----
const flat = sweep[sweep.length - 1].r.g2_max_pct;
assert.ok(flat > 50.0,
  `curved-meets-flat is a gross G2 break and must score high, got ${flat.toFixed(2)}%`);

console.log('classa continuity orientation: OK ' +
            `(perfect=${perfect.toFixed(2)}%, curved-vs-flat=${flat.toFixed(2)}%)`);
