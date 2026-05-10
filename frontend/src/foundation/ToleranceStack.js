/**
 * ArchDisc Foundation — GD&T tolerance stack analyzer.
 *
 * Tools for stacking parametric dimensions with tolerances and computing
 * the resulting variability of a derived feature. Three methods are
 * provided, all standard:
 *
 *   1. Worst-case stack-up (arithmetic).
 *      Output range = nominal ± Σ |tolerance_i|.
 *      Conservative, assumes all dimensions hit their worst limit
 *      simultaneously. Real failure rate ~1e-12 if inputs are
 *      independent normals — generally over-designs.
 *
 *   2. RSS (Root Sum Square) statistical stack-up.
 *      Output range = nominal ± sqrt(Σ tolerance_i²).
 *      Assumes inputs are independent normals with ±tol = 3σ; output
 *      is also normal. Gives 99.73 % yield (≈ 3σ).
 *
 *   3. Monte Carlo simulation.
 *      Sample each input from a chosen distribution (normal, uniform,
 *      asymmetric), compute the derived value N times, report mean,
 *      std, percentiles (1, 5, 50, 95, 99), Cp / Cpk capability
 *      indices, defect rate vs spec limits.
 *
 * Stack functions are arbitrary callbacks that receive the sampled
 * dimensions and return a derived value or an array of values. So this
 * supports:
 *   - additive chains (clearance = OD − ID)
 *   - multiplicative chains (volume = π·r²·h)
 *   - non-linear chains (interference fit pressure, thread mate, etc.)
 *
 * For real GD&T (positional tolerance with material modifiers, runout,
 * profile of surface) you'd also add:
 *   - feature-of-size LMC/MMC bonus tolerance computations
 *   - datum reference frame relative offsets
 * — those are out of scope for v1 but the stack engine here is the
 * foundation they'd build on.
 */

/**
 * Distribution kinds.
 */
export const DIST = {
  NORMAL: 'normal',     // truncated normal at ±tol = 3σ
  UNIFORM: 'uniform',   // ±tol uniformly
  ASYMMETRIC: 'asymmetric',  // separate plus/minus ranges
  CONSTANT: 'constant', // no variation (for verification)
};

/**
 * A single dimension entry.
 */
export class Dimension {
  /**
   * @param {object} args
   * @param {string} args.name
   * @param {number} args.nominal
   * @param {number} args.tolPlus    - upper tolerance (positive number)
   * @param {number} args.tolMinus   - lower tolerance (positive number, abs)
   * @param {string} args.distribution - one of DIST.*
   * @param {number} args.cp - process capability assumption when normal (default 1.33; tol band = Cp × 6σ)
   */
  constructor({ name, nominal, tolPlus, tolMinus, distribution = DIST.NORMAL, cp = 1.33 }) {
    this.name = name;
    this.nominal = nominal;
    this.tolPlus = tolPlus;
    this.tolMinus = tolMinus ?? tolPlus;
    this.distribution = distribution;
    this.cp = cp;
  }

  /** Nominal + worst-case symmetric tolerance (used in worst-case stack). */
  worstCaseTol() {
    return Math.max(this.tolPlus, this.tolMinus);
  }

  /** σ for the assumed distribution, equating ±tolerance to ±3σ × Cp. */
  sigma() {
    if (this.distribution === DIST.NORMAL) {
      // ±tol = 3σ × Cp typical; for Cp=1.33, σ = tol / (3 × 1.33) = tol/4.0
      return Math.max(this.tolPlus, this.tolMinus) / (3 * this.cp);
    }
    if (this.distribution === DIST.UNIFORM) {
      // σ = (b - a) / sqrt(12); range = ±tol
      return Math.max(this.tolPlus, this.tolMinus) / Math.sqrt(3);
    }
    if (this.distribution === DIST.ASYMMETRIC) {
      // Variance of asymmetric uniform on [-tolMinus, +tolPlus]:
      const a = -this.tolMinus, b = this.tolPlus;
      return (b - a) / Math.sqrt(12);
    }
    return 0;
  }

  /** Sample a value. */
  sample(rng = Math.random) {
    switch (this.distribution) {
      case DIST.CONSTANT:
        return this.nominal;
      case DIST.UNIFORM: {
        const u = rng() * 2 - 1;
        const tol = u >= 0 ? this.tolPlus : this.tolMinus;
        return this.nominal + u * tol;
      }
      case DIST.ASYMMETRIC: {
        // Map uniform [0,1] onto [-tolMinus, +tolPlus]
        const u = rng();
        const range = this.tolPlus + this.tolMinus;
        return this.nominal - this.tolMinus + u * range;
      }
      case DIST.NORMAL:
      default: {
        // Box-Muller
        const u1 = Math.max(rng(), 1e-12);
        const u2 = rng();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
        const sigma = this.sigma();
        const v = this.nominal + z * sigma;
        // Truncate at ±max-tol
        const lo = this.nominal - this.tolMinus;
        const hi = this.nominal + this.tolPlus;
        return Math.max(lo, Math.min(hi, v));
      }
    }
  }

  toString() {
    return `${this.name} = ${this.nominal} +${this.tolPlus} / −${this.tolMinus}`;
  }
}

/**
 * A derived parameter is computed from a set of input dimensions via a
 * function. The set of dimensions + function is the "stack".
 */
export class Stack {
  /**
   * @param {Dimension[]} inputs
   * @param {function(object): number} compute - receives an object
   *        whose keys are dimension names → values; returns the derived
   *        scalar.
   * @param {string} outputName
   * @param {object} spec - { lsl, usl, target } spec limits
   */
  constructor({ inputs, compute, outputName = 'output', spec = {} }) {
    this.inputs = inputs;
    this.compute = compute;
    this.outputName = outputName;
    this.spec = spec;
  }

  evalNominal() {
    const values = {};
    for (const d of this.inputs) values[d.name] = d.nominal;
    return this.compute(values);
  }

  /**
   * Worst-case arithmetic stack-up. Independent ± perturbations of each
   * input. Output bounds = max/min over the 2^n corner combinations
   * (we sample all corners directly for non-monotonic functions; for
   * linear chains this matches the additive Σ|tol| formula).
   *
   * For >12 inputs we fall back to gradient-based sensitivity * sum-tol
   * to avoid 2^n explosion.
   */
  worstCase() {
    const n = this.inputs.length;
    const nominal = this.evalNominal();
    if (n <= 12) {
      let lo = Infinity, hi = -Infinity;
      const total = 1 << n;
      for (let mask = 0; mask < total; mask++) {
        const values = {};
        for (let i = 0; i < n; i++) {
          const d = this.inputs[i];
          values[d.name] = d.nominal + ((mask >> i) & 1 ? d.tolPlus : -d.tolMinus);
        }
        const v = this.compute(values);
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      return { nominal, low: lo, high: hi, range: hi - lo, method: 'enumeration' };
    }
    // Linearized: f(x) ≈ f(x0) + Σ (∂f/∂x_i) Δx_i; bound via sum of |sensitivity_i| × tol_i
    const eps = 1e-6;
    let totalSens = 0;
    for (const d of this.inputs) {
      const valuesP = {}, valuesM = {};
      for (const dd of this.inputs) { valuesP[dd.name] = dd.nominal; valuesM[dd.name] = dd.nominal; }
      valuesP[d.name] = d.nominal + eps;
      valuesM[d.name] = d.nominal - eps;
      const grad = (this.compute(valuesP) - this.compute(valuesM)) / (2 * eps);
      totalSens += Math.abs(grad) * d.worstCaseTol();
    }
    return { nominal, low: nominal - totalSens, high: nominal + totalSens, range: 2 * totalSens, method: 'linearized' };
  }

  /**
   * RSS statistical stack: assumes inputs are independent normals with
   * ±tol = 3σ. Linear sensitivity around nominal; output σ_y = sqrt(Σ
   * (∂f/∂x_i)² σ_x_i²).
   */
  rss() {
    const eps = 1e-6;
    const nominal = this.evalNominal();
    let varSum = 0;
    for (const d of this.inputs) {
      const valuesP = {}, valuesM = {};
      for (const dd of this.inputs) { valuesP[dd.name] = dd.nominal; valuesM[dd.name] = dd.nominal; }
      valuesP[d.name] = d.nominal + eps;
      valuesM[d.name] = d.nominal - eps;
      const grad = (this.compute(valuesP) - this.compute(valuesM)) / (2 * eps);
      const sigma = d.sigma();
      varSum += grad * grad * sigma * sigma;
    }
    const sigma_out = Math.sqrt(varSum);
    return {
      nominal,
      sigma: sigma_out,
      // ±3σ band
      low3sigma: nominal - 3 * sigma_out,
      high3sigma: nominal + 3 * sigma_out,
      // ±6σ band (Cp = 2)
      low6sigma: nominal - 6 * sigma_out,
      high6sigma: nominal + 6 * sigma_out,
    };
  }

  /**
   * Monte Carlo simulation.
   *
   * @param {number} N - number of samples (default 100 000)
   * @param {function} rng - uniform [0,1) sampler (default Math.random)
   */
  monteCarlo(N = 100000, rng = Math.random) {
    const samples = new Float64Array(N);
    for (let s = 0; s < N; s++) {
      const values = {};
      for (const d of this.inputs) values[d.name] = d.sample(rng);
      samples[s] = this.compute(values);
    }
    // Sort copy for percentiles
    const sorted = Float64Array.from(samples).sort();
    const percentile = (p) => sorted[Math.max(0, Math.min(N - 1, Math.floor(p / 100 * (N - 1))))];
    let mean = 0;
    for (let s = 0; s < N; s++) mean += samples[s];
    mean /= N;
    let varSum = 0;
    for (let s = 0; s < N; s++) varSum += (samples[s] - mean) ** 2;
    const stddev = Math.sqrt(varSum / N);

    // Spec limit analysis
    const { lsl, usl, target } = this.spec;
    let outOfSpec = 0;
    if (lsl !== undefined || usl !== undefined) {
      for (let s = 0; s < N; s++) {
        const v = samples[s];
        if ((lsl !== undefined && v < lsl) || (usl !== undefined && v > usl)) outOfSpec++;
      }
    }
    const defectsPerMillion = (outOfSpec / N) * 1_000_000;

    // Capability indices
    let Cp = null, Cpk = null;
    if (lsl !== undefined && usl !== undefined && stddev > 0) {
      Cp = (usl - lsl) / (6 * stddev);
      const targ = target ?? mean;
      Cpk = Math.min((usl - mean) / (3 * stddev), (mean - lsl) / (3 * stddev));
    }

    return {
      N, mean, stddev,
      min: sorted[0], max: sorted[N - 1],
      p1: percentile(1), p5: percentile(5),
      p50: percentile(50), p95: percentile(95), p99: percentile(99),
      outOfSpec, defectsPerMillion, Cp, Cpk,
      spec: this.spec,
      // Histogram (50 bins between min and max)
      histogram: buildHistogram(sorted, 50),
    };
  }
}

function buildHistogram(sortedSamples, bins) {
  const N = sortedSamples.length;
  if (N === 0) return [];
  const lo = sortedSamples[0], hi = sortedSamples[N - 1];
  const range = hi - lo || 1;
  const counts = new Array(bins).fill(0);
  for (let s = 0; s < N; s++) {
    const idx = Math.min(bins - 1, Math.max(0, Math.floor((sortedSamples[s] - lo) / range * bins)));
    counts[idx]++;
  }
  return counts.map((c, i) => ({
    binMid: lo + (i + 0.5) * (range / bins),
    count: c,
    fraction: c / N,
  }));
}

/**
 * Pretty-print a complete tolerance analysis (worst-case + RSS + MC).
 *
 * @param {Stack} stack
 * @param {object} opts
 * @param {number} opts.N - MC samples
 * @returns {object} structured report
 */
export function analyze(stack, opts = {}) {
  const N = opts.N ?? 100000;
  return {
    inputs: stack.inputs.map(d => ({
      name: d.name, nominal: d.nominal,
      tolPlus: d.tolPlus, tolMinus: d.tolMinus,
      distribution: d.distribution, sigma: d.sigma(),
    })),
    output: stack.outputName,
    spec: stack.spec,
    worstCase: stack.worstCase(),
    rss: stack.rss(),
    monteCarlo: stack.monteCarlo(N),
  };
}

/**
 * Build a deterministic seedable PRNG (for reproducible MC). Using a
 * lightweight xorshift32. Pass to .monteCarlo(N, rng) for repeatable
 * runs.
 */
export function seededRng(seed) {
  let state = seed | 0;
  if (state === 0) state = 1;
  return () => {
    state ^= state << 13; state |= 0;
    state ^= state >>> 17;
    state ^= state << 5; state |= 0;
    return ((state >>> 0) % 0xffffffff) / 0xffffffff;
  };
}
