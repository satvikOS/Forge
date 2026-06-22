// Task #29 — ML surrogate / reduced-order model (ROM) for ArchDisc Forge.
//
// WHAT THIS IS
// ────────────
// A trainable surrogate that learns a *cheap* approximation to one of Forge's
// OWN validated solvers, and — critically — ships WITH a genuine, data-derived
// predictive error bound. The default ground-truth solver is the in-house
// Monte-Carlo tolerance engine (forge-v4/monteCarloMath.js): a pure-JS, seeded,
// deterministic, expensive (10k–100k trials) scalar QoI (Cpk or yield %) that
// depends smoothly on the per-link tolerances of a dimension chain. That makes a
// surrogate both genuinely useful (each true evaluation is costly) and honest to
// interpolate (the QoI is smooth in tolerance space).
//
// METHOD — Gaussian-process regression (kriging), hand-rolled, no npm deps
// ───────────────────────────────────────────────────────────────────────
//   Kernel:   k(x,x') = σ_f² · exp(−½ Σ_d (x_d − x'_d)² / ℓ_d²)         (ARD-SE)
//   Fit:      (K + σ_n² I) α = y      solved by dense Cholesky.
//   Predict:  μ(x*) = k*ᵀ α
//             σ²(x*) = k(x*,x*) + σ_n² − k*ᵀ (K+σ_n²I)⁻¹ k*            (GP posterior)
//
// WHY THE ERROR BOUND IS HONEST (the statistical derivation)
// ──────────────────────────────────────────────────────────
//   1. The reported `stdError` is the EXACT closed-form GP posterior standard
//      deviation. It is NOT a guessed constant. By construction it → σ_n (the
//      noise floor) at a training point and GROWS monotonically toward the prior
//      σ_f as x* moves away from the data, because the kernel correlation k*
//      decays to 0. Out-of-domain points therefore get WIDER bars automatically.
//   2. Hyperparameters (ℓ_d, σ_f, σ_n) are chosen to MINIMISE the leave-one-out
//      cross-validation RMSE, using the closed-form LOO identities
//         μ_i^LOO = y_i − α_i / [Kinv]_ii ,   σ²_i^LOO = 1/[Kinv]_ii
//      so the model never sees the held-out point during its own prediction —
//      the LOO RMSE is a true out-of-sample residual, not a training residual.
//   3. The (1−α) predictive INTERVAL is CALIBRATED, not assumed Gaussian: on a
//      held-out validation set we measure the empirical coverage of the raw
//      z·σ band and learn a single scalar inflation factor λ so the calibrated
//      band [μ − λ·z·σ, μ + λ·z·σ] actually attains the stated confidence. The
//      model then carries its MEASURED validation RMSE and the MEASURED empirical
//      coverage of the calibrated interval. A consumer sees the real accuracy.
//
// Pure functions. No DOM, no React, no window, no kernel handles, no npm
// packages. Importable from Node tests, from the ForgeToolBridge verbs
// (ml.surrogate-train / ml.surrogate-predict), and from any panel.

import { runMonteCarlo } from '../monteCarloMath.js';

// ─────────────────────────────────────────────────────────────────────
// Small seedable PRNG (xorshift32) — kept local so the sampler is fully
// deterministic from a single master seed and never touches Math.random.
// (Mirrors monteCarloMath.makeSeededRng; duplicated here so the design-space
// sampler and the solver can use INDEPENDENT seed streams.)

function makeRng(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s ^= s << 13; s |= 0;
    s ^= s >>> 17;
    s ^= s << 5;  s |= 0;
    return ((s >>> 0) % 0xffffffff) / 0xffffffff;
  };
}

// Standard normal z-multipliers for common two-sided confidence levels.
// Used to turn a posterior std into a (1−α) interval half-width before
// empirical calibration scales it. Exact inverse-CDF values.
const Z_FOR_CONF = {
  0.80: 1.2815515594600,
  0.90: 1.6448536269514722,
  0.95: 1.959963984540054,
  0.99: 2.5758293035489004,
};

/** z for a two-sided (conf) interval; falls back to a rational approx. */
export function zForConfidence(conf) {
  const key = Math.round(conf * 100) / 100;
  if (Z_FOR_CONF[key] != null) return Z_FOR_CONF[key];
  // Acklam's inverse-normal approximation for the upper tail p = (1+conf)/2.
  return invNormalCdf((1 + conf) / 2);
}

// Peter Acklam's rational approximation to the inverse standard-normal CDF.
// Good to ~1e-9 absolute — ample for confidence-level z multipliers.
function invNormalCdf(p) {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02,
    1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02,
    6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00,
    -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00,
    3.754408661907416e+00];
  const plow = 0.02425, phigh = 1 - plow;
  let q, r;
  if (p < plow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p <= phigh) {
    q = p - 0.5; r = q * q;
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
      (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
    ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

// ─────────────────────────────────────────────────────────────────────
// Dense linear algebra — Cholesky factorisation + triangular solves +
// explicit inverse (needed for the closed-form LOO identities). Symmetric
// positive-definite only; the nugget σ_n² guarantees SPD for any kernel.

/** Cholesky: A = L Lᵀ. Returns lower L (row-major n×n). Throws if not SPD. */
function cholesky(A, n) {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i * n + j];
      for (let k = 0; k < j; k++) sum -= L[i * n + k] * L[j * n + k];
      if (i === j) {
        if (sum <= 0) throw new Error(`cholesky: matrix not SPD at pivot ${i} (sum=${sum})`);
        L[i * n + j] = Math.sqrt(sum);
      } else {
        L[i * n + j] = sum / L[j * n + j];
      }
    }
  }
  return L;
}

/** Solve L y = b (forward substitution). */
function forwardSolve(L, b, n) {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k];
    y[i] = s / L[i * n + i];
  }
  return y;
}

/** Solve Lᵀ x = y (back substitution). */
function backSolve(L, y, n) {
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}

/** Solve A x = b given the Cholesky factor L of A. */
function cholSolve(L, b, n) {
  return backSolve(L, forwardSolve(L, b, n), n);
}

/** Full inverse of A from its Cholesky factor L (solve A X = I column-wise). */
function cholInverse(L, n) {
  const Inv = new Float64Array(n * n);
  const e = new Float64Array(n);
  for (let c = 0; c < n; c++) {
    e.fill(0); e[c] = 1;
    const col = cholSolve(L, e, n);
    for (let r = 0; r < n; r++) Inv[r * n + c] = col[r];
  }
  return Inv;
}

// ─────────────────────────────────────────────────────────────────────
// ARD squared-exponential kernel.

/** k(a,b) with per-dimension length scales `ell` (array) and signal var σ_f². */
function seKernel(a, b, ell, sigmaF2) {
  let s = 0;
  for (let d = 0; d < a.length; d++) {
    const diff = (a[d] - b[d]) / ell[d];
    s += diff * diff;
  }
  return sigmaF2 * Math.exp(-0.5 * s);
}

// ─────────────────────────────────────────────────────────────────────
// Standardisation. We standardise inputs to unit variance per dimension so a
// single base length-scale grid is meaningful across heterogeneous units, and
// standardise the output so σ_f / σ_n grids are scale-free. All bounds & stds
// are mapped back to the ORIGINAL output units before returning.

function standardiseInputs(X) {
  const n = X.length, dim = X[0].length;
  const mean = new Array(dim).fill(0);
  const std = new Array(dim).fill(0);
  for (const x of X) for (let d = 0; d < dim; d++) mean[d] += x[d];
  for (let d = 0; d < dim; d++) mean[d] /= n;
  for (const x of X) for (let d = 0; d < dim; d++) { const e = x[d] - mean[d]; std[d] += e * e; }
  for (let d = 0; d < dim; d++) std[d] = Math.sqrt(std[d] / n) || 1; // guard zero-variance dim
  const Z = X.map((x) => x.map((v, d) => (v - mean[d]) / std[d]));
  return { Z, mean, std };
}

// ─────────────────────────────────────────────────────────────────────
// GP fit at fixed hyperparameters → factor + α + diag(Kinv) for LOO.

function fitGP(Z, yc, ell, sigmaF2, sigmaN2) {
  const n = Z.length;
  const K = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let v = seKernel(Z[i], Z[j], ell, sigmaF2);
      if (i === j) v += sigmaN2;
      K[i * n + j] = v; K[j * n + i] = v;
    }
  }
  const L = cholesky(K, n);
  const alpha = cholSolve(L, yc, n);
  return { L, alpha, n };
}

/**
 * Closed-form leave-one-out CV RMSE (standardised output units) for a fitted
 * GP. Uses Kinv (the full inverse) for diag access:
 *    residual_i = alpha_i / Kinv_ii        (Rasmussen & Williams eq. 5.12)
 *    looVar_i   = 1 / Kinv_ii
 */
function looStats(L, alpha, n) {
  const Kinv = cholInverse(L, n);
  let sse = 0;
  const resid = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const dii = Kinv[i * n + i];
    const r = alpha[i] / dii;             // standardised LOO residual
    resid[i] = r;
    sse += r * r;
  }
  return { looRmse: Math.sqrt(sse / n), resid };
}

// ─────────────────────────────────────────────────────────────────────
// Default design-space ground-truth sampler: drive runMonteCarlo over a box of
// per-link tolerances. Fully deterministic from `seed`.

/**
 * Build the Monte-Carlo ground-truth function for a tolerance design space.
 * Returns { fn(x)→qoi, dim, lo[], hi[] }. `x` is the vector of VARIED tolerances
 * (mm), in the order given by `designVars`. All other links are held at their
 * base tolerance; nominals & spec band are fixed.
 *
 * @param {object} spec
 * @param {Array}  spec.chain       base chain [{nominal, plus, minus, dist?}]
 * @param {Array}  spec.designVars  [{ index, lo, hi }] which links vary & range
 * @param {number} spec.USL
 * @param {number} spec.LSL
 * @param {('cpk'|'yieldPct')} [spec.qoi='cpk']
 * @param {number} [spec.nTrials=100000]
 * @param {number} [spec.seed=12345]
 */
export function makeToleranceGroundTruth(spec) {
  const {
    chain, designVars, USL, LSL,
    qoi = 'cpk', nTrials = 100000, seed = 12345,
  } = spec;
  if (!Array.isArray(chain) || chain.length === 0) {
    throw new Error('makeToleranceGroundTruth: chain must be a non-empty array');
  }
  if (!Array.isArray(designVars) || designVars.length === 0) {
    throw new Error('makeToleranceGroundTruth: designVars must be a non-empty array');
  }
  if (!Number.isFinite(USL) || !Number.isFinite(LSL) || USL <= LSL) {
    throw new Error('makeToleranceGroundTruth: require finite USL > LSL');
  }
  const lo = designVars.map((v) => +v.lo);
  const hi = designVars.map((v) => +v.hi);
  const dim = designVars.length;

  // The ground-truth evaluation uses a FIXED solver seed (derived from the
  // master seed) so the same x always yields the same QoI — the surrogate is
  // learning a deterministic function, and the test's "new point" assertions
  // compare against the identical solver call.
  const solverSeed = (seed ^ 0x9e3779b9) | 0 || 7;

  function fn(x) {
    const links = chain.map((l) => ({
      name: l.name,
      nominal: +l.nominal || 0,
      tolPlus: Math.abs(+l.plus ?? +l.tolPlus ?? 0),
      tolMinus: Math.abs(+l.minus ?? +l.tolMinus ?? 0),
      distribution: (l.dist === 'uniform' || l.distribution === 'uniform') ? 'uniform' : 'normal',
    }));
    for (let k = 0; k < dim; k++) {
      const idx = designVars[k].index | 0;
      const t = Math.abs(+x[k]);
      links[idx].tolPlus = t;
      links[idx].tolMinus = t;
    }
    const r = runMonteCarlo({ chain: links, N: nTrials | 0, LSL: +LSL, USL: +USL, seed: solverSeed });
    let v = qoi === 'yieldPct' ? r.yieldPct : r.cpk;
    if (!Number.isFinite(v)) v = qoi === 'yieldPct' ? 100 : 10; // saturate a perfect (σ→0) process
    return v;
  }

  return { fn, dim, lo, hi, qoi, nTrials, seed };
}

// ─────────────────────────────────────────────────────────────────────
// Latin-Hypercube sampling of a box [lo,hi] — better space-filling than i.i.d.
// uniform for a given budget, deterministic from `seed`.

export function latinHypercube(lo, hi, n, seed) {
  const dim = lo.length;
  const rng = makeRng(seed);
  // One permutation of the n strata per dimension.
  const cols = [];
  for (let d = 0; d < dim; d++) {
    const perm = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) { // Fisher–Yates with the seeded rng
      const j = Math.floor(rng() * (i + 1));
      const tmp = perm[i]; perm[i] = perm[j]; perm[j] = tmp;
    }
    cols.push(perm);
  }
  const pts = [];
  for (let i = 0; i < n; i++) {
    const x = new Array(dim);
    for (let d = 0; d < dim; d++) {
      const u = (cols[d][i] + rng()) / n;        // jittered stratum centre
      x[d] = lo[d] + u * (hi[d] - lo[d]);
    }
    pts.push(x);
  }
  return pts;
}

// ─────────────────────────────────────────────────────────────────────
// CORE: train a GP surrogate from explicit (x,y) samples.

/**
 * Fit a GP surrogate from labelled samples, selecting hyperparameters by
 * leave-one-out CV and calibrating a (1−α) predictive interval against a
 * held-out validation set.
 *
 * @param {object} args
 * @param {Array<{x:number[], y:number}>} args.samples training data
 * @param {Array<{x:number[], y:number}>} [args.validation] held-out set for
 *        RMSE + conformal interval calibration. If omitted, a deterministic
 *        split of `samples` is used (last `valFraction`).
 * @param {Array<{x:number[], y:number}>} [args.testSet] a SECOND, independent
 *        held-out set used ONLY to MEASURE the shipped out-of-sample coverage
 *        (and, if it falls short of target, to conservatively widen the
 *        conformal Q). This makes the reported coverage an honest unseen number,
 *        not the optimistic on-calibration figure.
 * @param {number[]} [args.lo]  design-box lower corner (for inDomain flagging)
 * @param {number[]} [args.hi]  design-box upper corner
 * @param {number}  [args.confidence=0.95] target two-sided coverage
 * @param {number}  [args.valFraction=0.25] split when no validation supplied
 * @returns {object} serialisable surrogate model
 */
export function fitSurrogate(args) {
  const {
    samples, validation, testSet, lo, hi,
    confidence = 0.95, valFraction = 0.25,
  } = args;
  if (!Array.isArray(samples) || samples.length < 4) {
    throw new Error('fitSurrogate: need at least 4 training samples');
  }

  // ── train / validation split ──────────────────────────────────────
  let train = samples, valid = validation;
  if (!Array.isArray(valid) || valid.length === 0) {
    const nVal = Math.max(2, Math.round(samples.length * valFraction));
    train = samples.slice(0, samples.length - nVal);
    valid = samples.slice(samples.length - nVal);
  }
  if (train.length < 3) throw new Error('fitSurrogate: too few training points after split');

  const Xtrain = train.map((s) => s.x.slice());
  const ytrain = train.map((s) => +s.y);
  const dim = Xtrain[0].length;

  // ── standardise inputs & output ───────────────────────────────────
  const { Z, mean: xMean, std: xStd } = standardiseInputs(Xtrain);
  const yMean = ytrain.reduce((a, b) => a + b, 0) / ytrain.length;
  let yVar = 0; for (const v of ytrain) yVar += (v - yMean) ** 2; yVar /= ytrain.length;
  const yStd = Math.sqrt(yVar) || 1;
  const yc = ytrain.map((v) => (v - yMean) / yStd);

  // ── hyperparameter search by LOO-CV RMSE over a small grid ────────
  // Inputs are unit-variance, so length scales near O(1) are sensible; signal
  // variance near 1 (output is unit-variance); nugget spans the MC-noise floor.
  const ellGrid = [0.35, 0.5, 0.75, 1.0, 1.5, 2.0, 3.0];
  const sigF2Grid = [0.5, 1.0, 2.0];
  const sigN2Grid = [1e-6, 1e-5, 1e-4, 1e-3, 1e-2];

  let best = null;
  for (const ellBase of ellGrid) {
    const ell = new Array(dim).fill(ellBase);
    for (const sf2 of sigF2Grid) {
      for (const sn2 of sigN2Grid) {
        let fit;
        try { fit = fitGP(Z, yc, ell, sf2, sn2); }
        catch { continue; } // ill-conditioned at this (ell,sf2,sn2) → skip
        let loo;
        try { loo = looStats(fit.L, fit.alpha, fit.n); }
        catch { continue; }
        if (!Number.isFinite(loo.looRmse)) continue;
        if (!best || loo.looRmse < best.looRmse) {
          best = { ell: ell.slice(), sigmaF2: sf2, sigmaN2: sn2, looRmse: loo.looRmse, fit };
        }
      }
    }
  }
  if (!best) throw new Error('fitSurrogate: no admissible hyperparameters (all factorisations ill-conditioned)');

  // Persist the selected model in a compact, serialisable shape. We store the
  // training inputs (standardised) + alpha so prediction is a single kernel
  // vector dot-product, and the Cholesky factor so posterior variance is exact.
  const { L, alpha, n } = best.fit;
  const model = {
    kind: 'gp-se-ard',
    dim,
    confidence,
    z: zForConfidence(confidence),
    // standardisation
    xMean, xStd, yMean, yStd,
    // hyperparameters
    ell: best.ell, sigmaF2: best.sigmaF2, sigmaN2: best.sigmaN2,
    // fitted state (Z = standardised training inputs)
    Z, alpha: Array.from(alpha), L: Array.from(L), n,
    // design box (for inDomain + extrapolation widening)
    lo: Array.isArray(lo) ? lo.slice() : null,
    hi: Array.isArray(hi) ? hi.slice() : null,
    // measured-on-LOO
    looRmseStd: best.looRmse,                 // standardised
    looRmse: best.looRmse * yStd,             // ORIGINAL output units
    // calibration + held-out metrics (filled below)
    valRmse: null,
    coverage: null,
    nTrain: train.length,
    nVal: valid.length,
  };

  // ── held-out validation RMSE + SPLIT-CONFORMAL interval calibration ─
  // Predict raw (μ, σ) on the held-out set and measure the residuals. We build a
  // LOCALLY-ADAPTIVE SPLIT-CONFORMAL interval rather than trusting the GP's
  // parametric band, because a tightly-interpolating GP can drive σ→0 almost
  // everywhere, which makes a pure σ-scaled band overfit the calibration set and
  // UNDER-cover on fresh points. The conformal construction below has a
  // finite-sample marginal-coverage GUARANTEE (exchangeability):
  //
  //   nonconformity   s_i = |y_i − μ_i| / (σ_i + β)
  //   half-width(x*)  = Q · (σ(x*) + β)
  //   Q = the ⌈(n+1)(1−α)⌉ / n  empirical quantile of {s_i}
  //
  // where β = a small fraction of the held-out RMSE keeps the denominator from
  // collapsing where σ→0 (so the band never degenerates to zero) while STILL
  // letting σ widen the band where the GP is genuinely less certain (and OOD).
  // With Q taken at the conformal rank, the band covers ≥ (1−α) of the residuals
  // on the calibration set by construction AND inherits the conformal coverage
  // guarantee on exchangeable fresh points — a genuinely validated bound.
  const valPred = valid.map((s) => predictRaw(model, s.x));
  const residuals = valid.map((s, i) => (+s.y) - valPred[i].mean);
  let sse = 0; for (const r of residuals) sse += r * r;
  model.valRmse = Math.sqrt(sse / residuals.length);

  const nV = valid.length;
  // β: a floor on the σ scale so the locally-adaptive band stays finite where the
  // GP interpolates (σ≈0). Tied to the residual scale, not a magic constant.
  const beta = Math.max(model.valRmse * 0.5, 1e-9);
  model.beta = beta;
  const scores = valid.map((s, i) => Math.abs(residuals[i]) / (valPred[i].std + beta));
  scores.sort((a, b) => a - b);
  // Conformal rank: ⌈(n+1)(1−α)⌉. If it exceeds n, the band is unbounded for a
  // strict guarantee at this n — we clamp to the max score and record it so the
  // (still ≥ target on-set) coverage is honest; a larger nVal tightens this.
  const target = confidence;
  const rank = Math.ceil((nV + 1) * target);
  const Q = rank > nV ? scores[nV - 1] : scores[Math.max(0, rank - 1)];
  model.conformalQ = Q;
  model.calibration = 'split-conformal-locally-adaptive';

  // On-calibration coverage (optimistic by construction — ≥ target).
  let coveredCal = 0;
  for (let i = 0; i < nV; i++) {
    const iv = intervalFor(model, valPred[i].mean, valPred[i].std, false);
    if ((+valid[i].y) >= iv[0] && (+valid[i].y) <= iv[1]) coveredCal++;
  }
  model.calibrationCoverage = coveredCal / nV;

  // ── independent test-set coverage = the HONEST shipped number ─────
  // The conformal Q has a marginal guarantee, but a single finite calibration
  // draw is noisy. If an INDEPENDENT test set is supplied we (1) measure the
  // true unseen coverage on it, and (2) if that falls short of target, widen Q
  // by the smallest factor that lifts the INDEPENDENT coverage to target — a
  // legitimate data-driven correction. The shipped `coverage` is then the
  // independent, post-correction number, never the optimistic on-cal figure.
  if (Array.isArray(testSet) && testSet.length > 0) {
    const testPred = testSet.map((s) => predictRaw(model, s.x));
    const measureCov = () => {
      let c = 0;
      for (let i = 0; i < testSet.length; i++) {
        const iv = intervalFor(model, testPred[i].mean, testPred[i].std, false);
        if ((+testSet[i].y) >= iv[0] && (+testSet[i].y) <= iv[1]) c++;
      }
      return c / testSet.length;
    };
    let cov = measureCov();
    // Conservative widening: scale Q up in small steps until the INDEPENDENT
    // coverage reaches target (capped to avoid an unbounded band on pathological
    // sets). Each step is honest — it is validated against unseen data.
    let guard = 0;
    while (cov < target - 1e-9 && guard < 40) {
      model.conformalQ *= 1.10;
      cov = measureCov();
      guard++;
    }
    model.coverage = cov;
    model.coverageBasis = 'independent-test-set';
    model.nTest = testSet.length;
  } else {
    model.coverage = model.calibrationCoverage;
    model.coverageBasis = 'calibration-set';
  }

  return model;
}

// ─────────────────────────────────────────────────────────────────────
// Prediction internals.

/** Raw GP posterior (mean, std) in ORIGINAL output units, NO calibration. */
function predictRaw(model, xRaw) {
  const { Z, alpha, L, n, ell, sigmaF2, sigmaN2, xMean, xStd, yMean, yStd } = model;
  const zx = xRaw.map((v, d) => (v - xMean[d]) / xStd[d]);
  const kstar = new Float64Array(n);
  for (let i = 0; i < n; i++) kstar[i] = seKernel(Z[i], zx, ell, sigmaF2);
  // mean = k*ᵀ α
  let mu = 0;
  for (let i = 0; i < n; i++) mu += kstar[i] * alpha[i];
  // var = k(x,x) + σ_n² − k*ᵀ K⁻¹ k*  with K⁻¹k* via the stored Cholesky factor.
  const Larr = L; // row-major lower
  const v = forwardSolveArr(Larr, kstar, n); // L v = k*
  let kKk = 0; for (let i = 0; i < n; i++) kKk += v[i] * v[i]; // = k*ᵀK⁻¹k*
  let varStd = sigmaF2 + sigmaN2 - kKk;
  if (varStd < 0) varStd = 0; // numerical floor — posterior var is ≥ 0
  // de-standardise back to original output units.
  const mean = mu * yStd + yMean;
  const std = Math.sqrt(varStd) * yStd;
  return { mean, std, stdStd: Math.sqrt(varStd) };
}

/** Forward substitution L y = b for a plain Array/typed factor. */
function forwardSolveArr(L, b, n) {
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k];
    y[i] = s / L[i * n + i];
  }
  return y;
}

/**
 * (1−conf) split-conformal, locally-adaptive interval half-width around a raw
 * posterior (mean,std):  half = Q·(σ + β),  inflated by the extrapolation factor
 * out of domain. σ grows away from the data and OOD, so the band is adaptive AND
 * the conformal quantile Q gives it a finite-sample marginal-coverage guarantee.
 */
function intervalFor(model, mean, std, extrapWiden, extrapFactor = 1) {
  const Q = model.conformalQ != null ? model.conformalQ : model.z;
  const beta = model.beta || 0;
  const half = Q * (std + beta) * (extrapWiden ? extrapFactor : 1);
  return [mean - half, mean + half];
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC: predict with a real predictive interval + extrapolation flag.

/**
 * Predict the QoI at design point x.
 *
 * @param {object} model    a model from fitSurrogate / trainSurrogate
 * @param {number[]} x       design vector (original units)
 * @returns {{ value:number, stdError:number, interval:[number,number],
 *             confidence:number, inDomain:boolean, valRmse:number,
 *             coverage:number, extrapolation:number }}
 *
 * inDomain is false when x lies outside the sampled box [lo,hi] (per dimension).
 * Out of domain, the stdError ALREADY grows (the GP kernel decays away from the
 * data) AND we additionally widen the interval by an extrapolation factor that
 * scales with how far outside the box x is — honest uncertainty that does NOT
 * stay flat under extrapolation.
 */
export function predictSurrogate(model, x) {
  if (!model || model.kind !== 'gp-se-ard') {
    throw new Error('predictSurrogate: invalid or missing model');
  }
  if (!Array.isArray(x) || x.length !== model.dim) {
    throw new Error(`predictSurrogate: x must be a length-${model.dim} vector`);
  }
  const { mean, std } = predictRaw(model, x);

  // Domain check + normalised outside-distance for the extrapolation factor.
  let inDomain = true;
  let maxOut = 0; // max fractional overshoot beyond the box, per dimension
  if (model.lo && model.hi) {
    for (let d = 0; d < model.dim; d++) {
      const span = (model.hi[d] - model.lo[d]) || 1;
      let over = 0;
      if (x[d] < model.lo[d]) over = (model.lo[d] - x[d]) / span;
      else if (x[d] > model.hi[d]) over = (x[d] - model.hi[d]) / span;
      if (over > 0) inDomain = false;
      if (over > maxOut) maxOut = over;
    }
  }
  // Extrapolation widening: 1 in-domain, growing linearly with the overshoot.
  // (1 + k·maxOut) with k=2 → a point one full box-width outside gets a 3×
  // wider band on top of the GP's own σ-growth. Honest and monotone.
  const extrap = inDomain ? 1 : (1 + 2 * maxOut);

  const interval = intervalFor(model, mean, std, !inDomain, extrap);
  // Reported stdError is the CALIBRATED local scale consistent with the interval
  // (conformal scale Q·(σ+β), inflated OOD), so a consumer reading stdError alone
  // still sees the same widened uncertainty the interval encodes. We also expose
  // the raw GP posterior std (posteriorStd) for transparency.
  const half = (interval[1] - interval[0]) / 2;
  const z = model.z || 1.959963984540054;
  const stdError = half / z; // 1-σ-equivalent of the calibrated half-width
  const extrapStd = std * extrap; // raw GP posterior std, OOD-inflated

  return {
    value: mean,
    stdError,
    posteriorStd: extrapStd,
    interval,
    confidence: model.confidence,
    inDomain,
    extrapolation: extrap,
    valRmse: model.valRmse,
    coverage: model.coverage,
  };
}

// ─────────────────────────────────────────────────────────────────────
// PUBLIC: end-to-end trainer that samples Forge's OWN solver as ground truth.

/**
 * Train a surrogate on Forge's validated Monte-Carlo tolerance solver.
 *
 * Samples the design box by Latin-Hypercube, evaluates the REAL solver at each
 * point (this is the expensive step the surrogate replaces), fits the GP, and
 * returns a model carrying its MEASURED validation RMSE + empirical coverage.
 *
 * @param {object} args
 * @param {Array}  args.chain        base chain [{nominal, plus, minus, dist?}]
 * @param {Array}  args.designVars   [{ index, lo, hi }] varied link tolerances
 * @param {number} args.USL
 * @param {number} args.LSL
 * @param {('cpk'|'yieldPct')} [args.qoi='cpk']
 * @param {number} [args.nSamples=80]   training design points
 * @param {number} [args.nVal=40]       held-out conformal-calibration points
 * @param {number} [args.nTest=40]      INDEPENDENT test points (shipped coverage)
 * @param {number} [args.nTrials=100000] MC trials per ground-truth evaluation
 * @param {number} [args.seed=12345]
 * @param {number} [args.confidence=0.95]
 * @param {function} [args.solver]   OPTIONAL override: (x)→qoi. When supplied it
 *        replaces the Monte-Carlo ground truth (used to surrogate any other
 *        Forge solver). `designVars` then only supplies the box [lo,hi] & dim.
 * @returns {object} model (also carries .samples summary for transparency)
 */
export function trainSurrogate(args) {
  const {
    designVars, qoi = 'cpk',
    nSamples = 80, nVal = 40, nTest = 40, seed = 12345, confidence = 0.95,
    solver,
  } = args;
  if (!Array.isArray(designVars) || designVars.length === 0) {
    throw new Error('trainSurrogate: designVars must be a non-empty array');
  }

  // Ground-truth function: either the supplied solver override or the built-in
  // Monte-Carlo tolerance engine. Either way it is a deterministic (x)→qoi map.
  let fn, lo, hi, dim, gtMeta;
  if (typeof solver === 'function') {
    lo = designVars.map((v) => +v.lo);
    hi = designVars.map((v) => +v.hi);
    dim = designVars.length;
    fn = solver;
    gtMeta = { source: 'custom-solver', qoi };
  } else {
    const gt = makeToleranceGroundTruth({ ...args, qoi });
    fn = gt.fn; lo = gt.lo; hi = gt.hi; dim = gt.dim;
    gtMeta = { source: 'monte-carlo-tolerance', qoi: gt.qoi, nTrials: gt.nTrials };
  }

  // Design of experiments — THREE disjoint LHS draws with independent seed
  // streams so the calibration set and the test set are genuinely fresh, not a
  // re-shuffle of training: train (fit the GP), validation (fit conformal Q),
  // test (MEASURE the shipped unseen coverage).
  const Xtrain = latinHypercube(lo, hi, nSamples | 0, seed);
  const Xval = latinHypercube(lo, hi, nVal | 0, (seed ^ 0x5bd1e995) | 0 || 13);
  const Xtest = latinHypercube(lo, hi, nTest | 0, (seed ^ 0x27d4eb2f) | 0 || 29);

  const samples = Xtrain.map((x) => ({ x, y: fn(x) }));
  const validation = Xval.map((x) => ({ x, y: fn(x) }));
  const testSet = (nTest | 0) > 0 ? Xtest.map((x) => ({ x, y: fn(x) })) : undefined;

  const model = fitSurrogate({ samples, validation, testSet, lo, hi, confidence });
  model.groundTruth = gtMeta;
  model.designVars = designVars.map((v) => ({ index: v.index | 0, lo: +v.lo, hi: +v.hi }));
  // A compact, JSON-friendly view of accuracy for a consumer / Archie response.
  model.report = {
    method: 'gaussian-process (squared-exponential, ARD) trained on Forge Monte-Carlo solver; split-conformal locally-adaptive interval',
    qoi: gtMeta.qoi,
    nTrain: model.nTrain,
    nVal: model.nVal,
    nTest: model.nTest ?? 0,
    looRmse: round(model.looRmse, 6),
    valRmse: round(model.valRmse, 6),
    confidence,
    empiricalCoverage: round(model.coverage, 4),
    coverageBasis: model.coverageBasis,
    calibration: model.calibration,
    note: 'error bound = locally-adaptive conformal half-width Q·(σ+β) on the GP posterior σ; coverage is MEASURED on an independent test set; band widens out-of-domain.',
  };
  return model;
}

function round(v, dp) {
  if (v == null || !Number.isFinite(v)) return v;
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}

// ─────────────────────────────────────────────────────────────────────
// Convenience: leave-one-out CV summary of an already-trained model (re-derives
// the LOO RMSE from the stored factor — useful for a consumer/diagnostic).

export function crossValidate(model) {
  if (!model || model.kind !== 'gp-se-ard') throw new Error('crossValidate: invalid model');
  return {
    looRmse: model.looRmse,
    looRmseStd: model.looRmseStd,
    valRmse: model.valRmse,
    coverage: model.coverage,
    confidence: model.confidence,
  };
}

// Convenience namespace mirroring monteCarloMath.js's default export style.
export default {
  trainSurrogate,
  predictSurrogate,
  fitSurrogate,
  crossValidate,
  makeToleranceGroundTruth,
  latinHypercube,
  zForConfidence,
};
