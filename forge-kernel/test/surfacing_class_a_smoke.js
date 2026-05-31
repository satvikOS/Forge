// Forge-36 — Class-A surfacing QA smoke.
//
// Build a unit sphere (an analytical surface whose Gauss curvature is
// constant 1/r²), then run classAAnalyse on its first face. We expect:
//   * (maxK - minK) is small relative to avgK  (constant K ⇒ tight spread)
//   * isophoteCount lands in a small handful of buckets
//
// This is the canonical Class-A reference: a Class-A automotive surface
// asymptotes towards constant curvature continuity; a sphere already lives
// there. The smoke detects regressions in the curvature-sampler / bucket
// math by anchoring on this analytical baseline.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.surfacing, 'forge.surfacing missing');

const R = 5.0;
const sphere = forge.makeSphere(R);
const qa = forge.surfacing.classAAnalyse(sphere, 16);

const expectedK = 1.0 / (R * R);
const spread = qa.maxK - qa.minK;
const avg = qa.avgK;

console.log('[class-a-smoke] sphere R =', R,
            ' minK =', qa.minK.toFixed(5),
            ' maxK =', qa.maxK.toFixed(5),
            ' avgK =', avg.toFixed(5),
            ' isophotes =', qa.isophoteCount);
console.log('[class-a-smoke] expected K =', expectedK.toFixed(5),
            ' spread/avg =', (spread / Math.max(Math.abs(avg), 1e-9)).toFixed(4));

// The OCCT sphere face's UV bounds straddle a singular pole at v=π/2; we
// allow a 20% spread to cover that. A "true" constant-K sphere would
// register zero spread.
assert.ok(spread / Math.max(Math.abs(avg), 1e-9) < 0.20,
  `classAAnalyse: sphere K spread too high (${spread}); avg=${avg}`);
assert.ok(Math.abs(avg - expectedK) / expectedK < 0.20,
  `classAAnalyse: avg K ${avg} not within 20% of analytical ${expectedK}`);
assert.ok(qa.isophoteCount >= 1 && qa.isophoteCount <= 4,
  `classAAnalyse: sphere should map to 1..4 isophote buckets, got ${qa.isophoteCount}`);

console.log('[class-a-smoke] ALL PASS');
