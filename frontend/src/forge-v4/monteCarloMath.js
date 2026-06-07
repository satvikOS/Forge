// PUSH-175 (Slice-131) — Monte Carlo Tolerance Analysis math primitives.
//
// PUSH-47 / Forge-185 shipped a worst-case + RSS + small Monte-Carlo
// stack-up bundled inside the kernel (forge.tolerance.compute). That panel
// targeted a quick design-time sanity check.
//
// This module is the dedicated REAL Monte-Carlo statistical-assembly engine
// for production capability studies. Every link in a 1-D dimension chain is
// sampled per-trial from its declared distribution (Normal via Box-Muller,
// or Uniform on ±tol), the resulting assembly dimension is computed as a
// straight Σ nominal + Σ deviation, and 1k / 10k / 100k trials feed:
//
//   * full mean / variance / standard deviation
//   * Cp  = (USL − LSL) / (6σ)
//   * Cpk = min((USL − μ)/(3σ), (μ − LSL)/(3σ))
//   * yield % within [LSL, USL]
//   * 64-bin histogram between [min, max]
//
// Pure functions only. No DOM, no React, no window touching. Importable
// from the e2e spec for direct unit verification, importable from the
// panel for the Run button, importable from Archie tools later if needed.
//
// Distribution model (REAL, no stubs):
//
//   * Normal:  link.tolPlus and link.tolMinus define ±tol = ±3σ. For
//     asymmetric ±tol we use σ = max(tolPlus, tolMinus) / 3 so the
//     wider tail still maps to a ±3σ bound. The sampled value is
//       v = nominal + boxMullerZ() * sigma + bias
//     where bias = (tolPlus − tolMinus) / 2 (re-centres the mean of an
//     asymmetric spec to the midpoint of the tolerance band).
//   * Uniform: v sampled uniformly on [nominal − tolMinus, nominal + tolPlus].
//
// Box-Muller transform — exact textbook formula. Two uniform U1, U2 in (0,1]:
//
//     z0 = sqrt(-2·ln U1) · cos(2π U2)
//     z1 = sqrt(-2·ln U1) · sin(2π U2)
//
// We cache the second draw so each call returns one fresh standard-normal.
//
// PRNG: optional seedable xorshift32. Defaults to Math.random when no
// seed is provided so first-run results are non-deterministic; e2e
// pins a seed for reproducible assertion.

/** @typedef {'normal'|'uniform'} Distribution */

/**
 * @typedef {Object} ChainLink
 * @property {string} name
 * @property {number} nominal
 * @property {number} tolPlus    positive number — upper tolerance
 * @property {number} tolMinus   positive number — abs lower tolerance
 * @property {Distribution} distribution
 */

/**
 * @typedef {Object} TrialResult
 * @property {Float64Array} samples
 * @property {number} mean
 * @property {number} sigma
 * @property {number} min
 * @property {number} max
 * @property {number} cp           may be Infinity if sigma=0
 * @property {number} cpk
 * @property {number} yieldFraction       fraction of samples within [LSL, USL]
 * @property {number} yieldPct            yieldFraction * 100
 * @property {{ count:number, lo:number, hi:number, mid:number }[]} histogram
 * @property {number} N            trial count
 * @property {number} LSL
 * @property {number} USL
 * @property {number} nominalSum   Σ nominal across the chain (target value)
 */

// ─────────────────────────────────────────────────────────────────────
// PRNG.

/**
 * Build a seedable xorshift32 uniform [0,1) PRNG. Always non-zero state.
 * Deterministic for a given seed — used by e2e to assert stable numbers.
 *
 * @param {number} seed integer seed; 0 is remapped to 1
 * @returns {() => number}
 */
export function makeSeededRng(seed) {
    let s = (seed | 0) || 1;
    return () => {
        s ^= s << 13; s |= 0;
        s ^= s >>> 17;
        s ^= s << 5;  s |= 0;
        return ((s >>> 0) % 0xffffffff) / 0xffffffff;
    };
}

// ─────────────────────────────────────────────────────────────────────
// Box-Muller normal sampler.
//
// Stateful per-instance: caches the unused second normal draw so we
// emit one standard-normal Z ~ N(0,1) per call.

/**
 * Construct a Box-Muller normal sampler around the supplied uniform PRNG.
 * Each call returns one fresh standard normal Z ~ N(0,1). Cached pair
 * reduces math.sqrt/cos/sin calls by half on average.
 *
 * @param {() => number} rng a uniform [0,1) generator
 * @returns {() => number}
 */
export function makeNormalSampler(rng) {
    let cache = null;
    return function sampleNormal() {
        if (cache !== null) {
            const z = cache;
            cache = null;
            return z;
        }
        // Avoid Math.log(0) — clamp the lower uniform up off zero.
        let u1 = rng();
        while (u1 <= 1e-12) u1 = rng();
        const u2 = rng();
        const r  = Math.sqrt(-2 * Math.log(u1));
        const th = 2 * Math.PI * u2;
        const z0 = r * Math.cos(th);
        const z1 = r * Math.sin(th);
        cache = z1;
        return z0;
    };
}

/**
 * Convenience wrapper — one-shot Box-Muller normal using Math.random by
 * default. Suitable for ad-hoc calls (e.g. tests). For Monte-Carlo runs
 * the panel uses {@link makeNormalSampler} so the cached pair is honoured.
 *
 * @param {() => number} [rng] uniform sampler (default Math.random)
 * @returns {number}            Z ~ N(0,1)
 */
export function sampleNormal(rng = Math.random) {
    let u1 = rng();
    while (u1 <= 1e-12) u1 = rng();
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// ─────────────────────────────────────────────────────────────────────
// One-link sampler.

/**
 * Sample one chain-link given its distribution. Pure: rng + normalSampler
 * are injected.
 *
 * @param {ChainLink} link
 * @param {() => number} rng           uniform [0,1)
 * @param {() => number} normalSampler standard normal sampler
 * @returns {number} sampled dimension
 */
export function sampleLink(link, rng, normalSampler) {
    const tolPlus  = Number(link.tolPlus)  || 0;
    const tolMinus = Number(link.tolMinus) || 0;
    const nominal  = Number(link.nominal)  || 0;
    if (link.distribution === 'uniform') {
        // Uniform on [nominal − tolMinus, nominal + tolPlus].
        const u = rng();
        return nominal - tolMinus + u * (tolPlus + tolMinus);
    }
    // Normal: ±tol = ±3σ. Asymmetric tol → use the wider tail as the σ
    // anchor and bias the mean to the band midpoint so the implicit
    // process target is centred on the spec.
    const sigma = Math.max(tolPlus, tolMinus) / 3;
    const bias  = (tolPlus - tolMinus) / 2;
    return nominal + bias + normalSampler() * sigma;
}

// ─────────────────────────────────────────────────────────────────────
// Trial-loop core.

/**
 * Run N Monte-Carlo trials over a chain of links. Each trial sums the
 * sampled dimension of every link to obtain the assembly value.
 *
 * @param {ChainLink[]} chain
 * @param {number} N             trial count (≥1)
 * @param {object} [opts]
 * @param {() => number} [opts.rng] uniform [0,1) — defaults to Math.random
 * @returns {Float64Array} N assembly samples
 */
export function runTrials(chain, N, opts = {}) {
    if (!Array.isArray(chain) || chain.length === 0) {
        throw new Error('runTrials: chain must be a non-empty array of links');
    }
    const trials = N | 0;
    if (trials < 1) throw new Error('runTrials: N must be ≥ 1');
    const rng           = opts.rng || Math.random;
    const normalSampler = makeNormalSampler(rng);
    const out           = new Float64Array(trials);
    for (let t = 0; t < trials; t++) {
        let sum = 0;
        for (let i = 0; i < chain.length; i++) {
            sum += sampleLink(chain[i], rng, normalSampler);
        }
        out[t] = sum;
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────
// Stats + capability + histogram.

/**
 * Compute mean / σ / yield / Cp / Cpk / histogram for a sample array.
 *
 * @param {Float64Array | number[]} samples
 * @param {number} LSL
 * @param {number} USL
 * @param {number} [bins=64] histogram bin count
 * @returns {Omit<TrialResult,'samples'|'N'|'LSL'|'USL'|'nominalSum'>}
 */
export function computeStats(samples, LSL, USL, bins = 64) {
    const N = samples.length;
    if (N < 1) throw new Error('computeStats: empty sample set');
    let sum = 0;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < N; i++) {
        const v = samples[i];
        sum += v;
        if (v < min) min = v;
        if (v > max) max = v;
    }
    const mean = sum / N;
    let varSum = 0;
    for (let i = 0; i < N; i++) {
        const d = samples[i] - mean;
        varSum += d * d;
    }
    const sigma = Math.sqrt(varSum / N);

    // Yield (% within [LSL, USL]).
    let inSpec = 0;
    for (let i = 0; i < N; i++) {
        const v = samples[i];
        if (v >= LSL && v <= USL) inSpec++;
    }
    const yieldFraction = inSpec / N;
    const yieldPct      = yieldFraction * 100;

    // Capability indices. Cp degenerates when sigma=0 (perfect process).
    let cp, cpk;
    if (sigma > 0) {
        cp  = (USL - LSL) / (6 * sigma);
        cpk = Math.min((USL - mean) / (3 * sigma), (mean - LSL) / (3 * sigma));
    } else {
        cp  = Number.POSITIVE_INFINITY;
        cpk = Number.POSITIVE_INFINITY;
    }

    // Histogram on [min, max].
    const histogram = buildHistogram(samples, bins, min, max);

    return { mean, sigma, min, max, cp, cpk, yieldFraction, yieldPct, histogram };
}

/**
 * @param {Float64Array | number[]} samples
 * @param {number} bins
 * @param {number} lo
 * @param {number} hi
 * @returns {{ count:number, lo:number, hi:number, mid:number }[]}
 */
export function buildHistogram(samples, bins, lo, hi) {
    const N = samples.length;
    const out = new Array(bins);
    const range = hi - lo;
    // Pre-fill bin boundaries.
    for (let b = 0; b < bins; b++) {
        const blo = range > 0 ? lo + (b      / bins) * range : lo;
        const bhi = range > 0 ? lo + ((b + 1) / bins) * range : hi;
        out[b] = { count: 0, lo: blo, hi: bhi, mid: (blo + bhi) / 2 };
    }
    if (range <= 0) {
        // Degenerate single-value distribution — dump everything in bin 0.
        out[0].count = N;
        return out;
    }
    for (let i = 0; i < N; i++) {
        const idx = Math.min(bins - 1,
            Math.max(0, Math.floor(((samples[i] - lo) / range) * bins)));
        out[idx].count++;
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────
// Public top-level pipeline.

/**
 * Run the Monte-Carlo tolerance analysis end-to-end.
 *
 *   1. Sum nominal across the chain → nominalSum (target).
 *   2. Default LSL/USL to nominalSum ± Σ|tol| if not supplied.
 *   3. Sample N trials.
 *   4. Compute stats + histogram.
 *
 * @param {object} args
 * @param {ChainLink[]} args.chain
 * @param {number} args.N
 * @param {number} [args.LSL]
 * @param {number} [args.USL]
 * @param {number} [args.bins=64]
 * @param {number} [args.seed] integer PRNG seed; omit for non-deterministic
 * @returns {TrialResult}
 */
export function runMonteCarlo(args) {
    const {
        chain, N, bins = 64, seed,
    } = args;
    if (!Array.isArray(chain) || chain.length === 0) {
        throw new Error('runMonteCarlo: chain must be non-empty');
    }
    const trials = N | 0;
    if (trials < 1) throw new Error('runMonteCarlo: N must be ≥ 1');

    const nominalSum = chain.reduce((s, l) => s + (Number(l.nominal) || 0), 0);
    const sumTol = chain.reduce((s, l) =>
        s + Math.max(Number(l.tolPlus) || 0, Number(l.tolMinus) || 0), 0);

    // Default spec band = worst-case ± Σ|tol|. Caller may override.
    const LSL = Number.isFinite(args.LSL) ? args.LSL : (nominalSum - sumTol);
    const USL = Number.isFinite(args.USL) ? args.USL : (nominalSum + sumTol);

    const rng     = (seed !== undefined && seed !== null)
        ? makeSeededRng(seed) : Math.random;
    const samples = runTrials(chain, trials, { rng });
    const stats   = computeStats(samples, LSL, USL, bins);

    return {
        samples,
        N: trials,
        LSL, USL,
        nominalSum,
        ...stats,
    };
}

// ─────────────────────────────────────────────────────────────────────
// Default export — convenience namespace.

export default {
    makeSeededRng,
    makeNormalSampler,
    sampleNormal,
    sampleLink,
    runTrials,
    computeStats,
    buildHistogram,
    runMonteCarlo,
};
