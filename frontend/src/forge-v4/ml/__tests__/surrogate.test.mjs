/**
 * Node test for the ML surrogate / ROM — Task #29.
 *   node --test frontend/src/forge-v4/ml/__tests__/surrogate.test.mjs
 *
 * KERNEL-FREE. The surrogate trains on Forge's OWN pure-JS Monte-Carlo
 * tolerance solver (forge-v4/monteCarloMath.js), so the whole test runs with
 * zero native deps. The bridge round-trip uses an empty STUB_FORGE because the
 * ml.* verbs ignore `forge` (mirrors the designRationale test pattern).
 *
 * Coverage (per the brief):
 *   (a) predictions track the REAL solver within the model's validation RMSE on
 *       held-out points (not training samples → no trivial memorisation);
 *   (b) empirical interval coverage on held-out points ≥ the stated confidence;
 *   (c) the error bound WIDENS at an out-of-domain point vs an in-domain one;
 *   (d) the model does NOT memorise — accurate at NEW (non-training) points;
 *   (e) ForgeToolBridge exposes ml.surrogate-train + ml.surrogate-predict and
 *       both round-trip through dispatchToolCall.
 * Plus: honest bounds are data-derived (LOO RMSE finite & reported), the GP
 * interpolates near training points (small σ there), and a custom-solver
 * override path works (surrogating an arbitrary Forge solver).
 *
 * No new npm packages.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import surrogate, {
  trainSurrogate, predictSurrogate, fitSurrogate, crossValidate,
  makeToleranceGroundTruth, latinHypercube, zForConfidence,
} from '../surrogate.js';

// dispatchToolCall resolves a `forge` before running any verb; the ml.* verbs
// ignore it, so an empty stub short-circuits the getForge() (Electron) path.
const STUB_FORGE = {};

// A representative 3-link dimension chain (mm). Nominals fixed; the per-link
// tolerances of links 0/1/2 are the surrogate's 3-D design space. Spec band is
// wide enough that Cpk varies smoothly & non-trivially across the box.
const CHAIN = [
  { nominal: 20, plus: 0.10, minus: 0.10, dist: 'normal' },
  { nominal: 15, plus: 0.10, minus: 0.10, dist: 'normal' },
  { nominal: 10, plus: 0.10, minus: 0.10, dist: 'normal' },
];
const DESIGN_VARS = [
  { index: 0, lo: 0.04, hi: 0.30 },
  { index: 1, lo: 0.04, hi: 0.30 },
  { index: 2, lo: 0.04, hi: 0.30 },
];
const USL = 45 + 1.0;
const LSL = 45 - 1.0;

// Shared trained model + its ground-truth fn, built once (training is the
// expensive step). Modest trial count keeps the test fast while staying a real
// 25k-trial-per-point Monte-Carlo ground truth.
const NTRIALS = 25000;
const TRAIN_ARGS = {
  chain: CHAIN, designVars: DESIGN_VARS, USL, LSL,
  qoi: 'cpk', nSamples: 64, nVal: 30, nTrials: NTRIALS,
  confidence: 0.95, seed: 12345,
};

let MODEL;
let GT; // the deterministic ground-truth fn for fresh-point comparisons

test('surrogate: train on the real Forge Monte-Carlo solver', () => {
  MODEL = trainSurrogate(TRAIN_ARGS);
  GT = makeToleranceGroundTruth({ ...TRAIN_ARGS }).fn;

  assert.equal(MODEL.kind, 'gp-se-ard');
  assert.equal(MODEL.dim, 3);
  assert.equal(MODEL.groundTruth.source, 'monte-carlo-tolerance');
  assert.equal(MODEL.groundTruth.qoi, 'cpk');

  // Honest, data-derived bounds are all present & finite (NOT hard-coded).
  assert.ok(Number.isFinite(MODEL.looRmse) && MODEL.looRmse > 0, 'LOO RMSE finite & positive');
  assert.ok(Number.isFinite(MODEL.valRmse) && MODEL.valRmse > 0, 'validation RMSE finite & positive');
  assert.ok(Number.isFinite(MODEL.coverage), 'empirical coverage measured');
  // A surrogate that learned anything has a far smaller error than the spread of
  // the QoI itself — sanity that it's not noise. Cpk over this box spans ~O(1).
  assert.ok(MODEL.valRmse < 0.5, `validation RMSE ${MODEL.valRmse} should be well below the QoI spread`);
});

// ── (a)+(d) predictions track the solver within valRMSE on NEW points ───────
test('(a)+(d) predictions track the real solver within validation RMSE on NEW (non-training) points', () => {
  // Generate a FRESH Latin-Hypercube set with a seed used by NEITHER the
  // training nor the validation DOE, so these are genuinely unseen points.
  const fresh = latinHypercube(MODEL.lo, MODEL.hi, 40, 0x1234abcd);
  let sse = 0;
  let n = 0;
  let maxAbs = 0;
  for (const x of fresh) {
    const truth = GT(x);
    const { value } = predictSurrogate(MODEL, x);
    const e = value - truth;
    sse += e * e; n++;
    if (Math.abs(e) > maxAbs) maxAbs = Math.abs(e);
  }
  const rmseNew = Math.sqrt(sse / n);

  // The out-of-sample RMSE on brand-new points must be comparable to the model's
  // reported validation RMSE — i.e. the reported bound is HONEST and the model
  // generalises (it did not memorise the training set). Allow a 2.5× slack for
  // sampling variation between the two finite held-out draws.
  assert.ok(
    rmseNew <= MODEL.valRmse * 2.5 + 0.05,
    `new-point RMSE ${rmseNew.toFixed(4)} must be near the reported valRMSE ${MODEL.valRmse.toFixed(4)}`,
  );
  // And it must be genuinely small in absolute terms (tracks the solver).
  assert.ok(rmseNew < 0.5, `new-point RMSE ${rmseNew.toFixed(4)} should track the solver closely`);
});

// ── (b) empirical interval coverage ≥ stated confidence on held-out points ──
test('(b) empirical interval coverage on held-out points ≥ stated confidence', () => {
  // Measure coverage on a FRESH held-out set (independent of the calibration set).
  const held = latinHypercube(MODEL.lo, MODEL.hi, 60, 0x55aa55aa);
  let covered = 0;
  for (const x of held) {
    const truth = GT(x);
    const { interval } = predictSurrogate(MODEL, x);
    if (truth >= interval[0] && truth <= interval[1]) covered++;
  }
  const cov = covered / held.length;

  // The interval was calibrated to attain `confidence`; allow a small sampling
  // tolerance (finite held-out set). The model also CARRIES its measured coverage.
  assert.ok(
    cov >= MODEL.confidence - 0.07,
    `empirical coverage ${cov.toFixed(3)} must meet stated confidence ${MODEL.confidence} (±sampling)`,
  );
  // The shipped model's own measured coverage meets the target by construction.
  assert.ok(
    MODEL.coverage >= MODEL.confidence - 1e-9,
    `model.coverage ${MODEL.coverage} should attain the target on its calibration set`,
  );
});

// ── (c) the error bound WIDENS out-of-domain vs in-domain ────────────────────
test('(c) the error bound widens at an out-of-domain point vs an in-domain point', () => {
  // In-domain: the box centre.
  const mid = MODEL.lo.map((l, d) => (l + MODEL.hi[d]) / 2);
  const inP = predictSurrogate(MODEL, mid);
  assert.equal(inP.inDomain, true, 'box centre is in-domain');

  // Out-of-domain: push every coordinate one full box-width ABOVE the upper edge.
  const out = MODEL.hi.map((h, d) => h + (MODEL.hi[d] - MODEL.lo[d]));
  const outP = predictSurrogate(MODEL, out);
  assert.equal(outP.inDomain, false, 'far point is flagged out-of-domain (extrapolation)');

  // The stdError and the interval half-width must both be STRICTLY WIDER OOD.
  const inHalf = (inP.interval[1] - inP.interval[0]) / 2;
  const outHalf = (outP.interval[1] - outP.interval[0]) / 2;
  assert.ok(outP.stdError > inP.stdError, `OOD stdError ${outP.stdError} must exceed in-domain ${inP.stdError}`);
  assert.ok(outHalf > inHalf, `OOD interval half-width ${outHalf} must exceed in-domain ${inHalf}`);
  assert.ok(outP.extrapolation > 1, 'extrapolation factor > 1 out of domain');
  assert.equal(inP.extrapolation, 1, 'extrapolation factor == 1 in domain');
});

// ── GP interpolates near the data: σ is small at a near-training point ───────
test('GP posterior std is small near the data and grows away from it', () => {
  // A training input → predicted std should be near the noise floor (small).
  const trainX = MODEL.Z[0].map((z, d) => z * MODEL.xStd[d] + MODEL.xMean[d]);
  const atData = predictSurrogate(MODEL, trainX);
  // The box centre is the densest region; the corner-most in-domain point is
  // sparser. Compare a near-data std to a far-but-in-domain std.
  const corner = MODEL.lo.slice(); // a box corner (sparser than the interior)
  const atCorner = predictSurrogate(MODEL, corner);
  assert.ok(atData.stdError >= 0, 'std is a real non-negative number');
  assert.ok(atData.stdError < MODEL.yStd, 'near-data std is below the prior output std');
  // Monotone trend: a point at/near a training sample is no MORE uncertain than
  // a sparse corner (kernel correlation is highest at the data).
  assert.ok(atData.stdError <= atCorner.stdError + 1e-9,
    `near-data std ${atData.stdError} should be ≤ sparse-corner std ${atCorner.stdError}`);
});

// ── crossValidate + zForConfidence sanity ───────────────────────────────────
test('crossValidate surfaces the data-derived bounds; zForConfidence is correct', () => {
  const cv = crossValidate(MODEL);
  assert.ok(Number.isFinite(cv.looRmse) && cv.looRmse > 0);
  assert.ok(Number.isFinite(cv.valRmse) && cv.valRmse > 0);
  assert.equal(cv.confidence, 0.95);
  // Standard z multipliers.
  assert.ok(Math.abs(zForConfidence(0.95) - 1.959963984540054) < 1e-9);
  assert.ok(Math.abs(zForConfidence(0.90) - 1.6448536269514722) < 1e-9);
  // Interpolated/approximated level still monotone & sane.
  assert.ok(zForConfidence(0.975) > zForConfidence(0.95));
});

// ── custom-solver override: surrogate an arbitrary smooth Forge solver ───────
test('trainSurrogate accepts a custom solver override and bounds stay honest', () => {
  // A deterministic, smooth analytic "solver" over a 2-D box. The surrogate
  // must learn it accurately with calibrated coverage — proving the trainer is
  // not hard-wired to the MC engine.
  const solver = (x) => Math.sin(x[0]) * Math.cos(x[1]) + 0.25 * x[0];
  const model = trainSurrogate({
    designVars: [{ index: 0, lo: -2, hi: 2 }, { index: 1, lo: -2, hi: 2 }],
    solver, nSamples: 70, nVal: 30, confidence: 0.9, seed: 999,
  });
  assert.equal(model.groundTruth.source, 'custom-solver');
  assert.ok(model.valRmse < 0.15, `custom-solver valRMSE ${model.valRmse} should be small`);
  assert.ok(model.coverage >= 0.9 - 1e-9, 'custom-solver coverage meets the 0.9 target on its set');

  // Out-of-sample accuracy + coverage on fresh points.
  const fresh = latinHypercube([-2, -2], [2, 2], 50, 0xfeed);
  let sse = 0, covered = 0;
  for (const x of fresh) {
    const truth = solver(x);
    const p = predictSurrogate(model, x);
    sse += (p.value - truth) ** 2;
    if (truth >= p.interval[0] && truth <= p.interval[1]) covered++;
  }
  assert.ok(Math.sqrt(sse / fresh.length) < 0.15, 'accurate on fresh points');
  assert.ok(covered / fresh.length >= 0.9 - 0.08, 'fresh-point coverage near 0.9');
});

// ── fitSurrogate directly with explicit samples (no solver) ──────────────────
test('fitSurrogate works on explicit (x,y) samples with an internal split', () => {
  // A simple 1-D function with explicit samples; exercises the auto-split path.
  const f = (t) => t * t - 0.3 * t;
  const xs = latinHypercube([0], [1], 30, 7);
  const samples = xs.map(([t]) => ({ x: [t], y: f(t) }));
  const model = fitSurrogate({ samples, lo: [0], hi: [1], confidence: 0.95 });
  assert.equal(model.dim, 1);
  assert.ok(model.nVal >= 2, 'auto-split produced a validation set');
  const p = predictSurrogate(model, [0.5]);
  assert.ok(Math.abs(p.value - f(0.5)) < 0.05, 'predicts the simple function');
  assert.ok(p.stdError >= 0 && Number.isFinite(p.stdError));
});

// ── (e) ForgeToolBridge exposes both verbs and they round-trip ──────────────
test('(e) ForgeToolBridge: ml.surrogate-train & ml.surrogate-predict are Archie-drivable and round-trip', async () => {
  const { dispatchToolCall, getToolSpec } = await import('../../../ai/ForgeToolBridge.js');

  // Both verbs are registered with the expected shape.
  const trainSpec = getToolSpec('ml.surrogate-train');
  const predSpec = getToolSpec('ml.surrogate-predict');
  assert.ok(trainSpec, 'ml.surrogate-train registered');
  assert.ok(predSpec, 'ml.surrogate-predict registered');
  assert.equal(trainSpec.discipline, 'simulate');
  assert.equal(predSpec.discipline, 'simulate');
  assert.equal(trainSpec.produces, 'report');

  // Train via the bridge (small/fast settings for the round-trip).
  const trainRes = await dispatchToolCall({ name: 'ml.surrogate-train', arguments: {
    chain: CHAIN, designVars: DESIGN_VARS, USL, LSL,
    qoi: 'cpk', nSamples: 40, nVal: 20, nTrials: 8000, confidence: 0.9, seed: 2024,
  } }, { forge: STUB_FORGE });
  assert.equal(trainRes.ok, true, 'ml.surrogate-train dispatches');
  assert.equal(trainRes.result.op, 'ml.surrogate-train');
  assert.ok(trainRes.result.model && trainRes.result.model.kind === 'gp-se-ard', 'returns a usable model');
  assert.ok(Number.isFinite(trainRes.result.valRmse), 'reports a measured validation RMSE');
  assert.ok(Number.isFinite(trainRes.result.empiricalCoverage), 'reports a measured coverage');

  // Predict via the bridge, feeding the model from the train call back in.
  const model = trainRes.result.model;
  const predRes = await dispatchToolCall({ name: 'ml.surrogate-predict', arguments: {
    model, x: [0.12, 0.12, 0.12],
  } }, { forge: STUB_FORGE });
  assert.equal(predRes.ok, true, 'ml.surrogate-predict dispatches');
  assert.equal(predRes.result.op, 'ml.surrogate-predict');
  assert.ok(Number.isFinite(predRes.result.value), 'returns a predicted value');
  assert.ok(Number.isFinite(predRes.result.stdError), 'returns a real stdError');
  assert.equal(predRes.result.interval.length, 2, 'returns a [lo,hi] interval');
  assert.ok(predRes.result.interval[0] < predRes.result.interval[1], 'interval is ordered');
  assert.equal(predRes.result.inDomain, true, 'centre-ish point is in-domain');

  // Out-of-domain via the bridge widens the band (honest extrapolation).
  const oodRes = await dispatchToolCall({ name: 'ml.surrogate-predict', arguments: {
    model, x: [1.0, 1.0, 1.0], // far above the [0.04,0.30] box
  } }, { forge: STUB_FORGE });
  assert.equal(oodRes.result.inDomain, false, 'far point flagged OOD through the bridge');
  assert.ok(oodRes.result.stdError > predRes.result.stdError, 'OOD stdError widens through the bridge');

  // A missing required arg is rejected by the bridge validator.
  const bad = await dispatchToolCall({ name: 'ml.surrogate-predict', arguments: { x: [0.1, 0.1, 0.1] } }, { forge: STUB_FORGE });
  assert.equal(bad.ok, false, 'missing model arg is rejected');
  assert.match(bad.error, /model/);

  // default-export namespace sanity.
  assert.equal(typeof surrogate.trainSurrogate, 'function');
  assert.equal(typeof surrogate.predictSurrogate, 'function');
});
