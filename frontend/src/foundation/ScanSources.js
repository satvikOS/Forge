/**
 * ScanSources — synthetic parametric scan-data generators for the
 * point-cloud reverse-engineering pipeline. Sister module to
 * PointCloudRecon.js (which ships sampleSphere + the density-voxel
 * reconstruct). These functions produce noisy "what a scanner saw"
 * point clouds from known closed-form surfaces so we can validate
 * the reconstruction against ground truth.
 *
 * Coordinate convention: all surfaces are centred on the origin
 * unless `center` is supplied. The output `Float32Array` is flat
 * [x0,y0,z0, x1,y1,z1, …] — the same layout the reconstruct()
 * entry-point expects.
 *
 * The RNG is the same xorshift32 used by sampleSphere so the same
 * seed gives bit-identical streams. Optional Gaussian noise is
 * applied as independent x/y/z perturbations after sampling.
 */

const EPS = 1e-9;

/** Tiny seedable xorshift32 + Box-Muller normal pair, matching PointCloudRecon. */
function makeRng(seed) {
  let state = (seed | 0) || 1;
  const rng = () => {
    state ^= state << 13; state |= 0;
    state ^= state >>> 17;
    state ^= state << 5; state |= 0;
    return ((state >>> 0) % 0xffffffff) / 0xffffffff;
  };
  const gauss = () => {
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  return { rng, gauss };
}

/**
 * Sample N points uniformly on a torus surface. The torus is the
 * locus of points at distance `minorR` from a circle of radius
 * `majorR` lying in the XY plane, centred at `center`.
 *
 * Sampling: pick angles θ (around major) and φ (around minor)
 * proportional to the Jacobian |cos φ + R/r| so the density on the
 * surface is uniform (rejection sampling — fast for any aspect ratio).
 */
export function sampleTorus(majorR, minorR, N, opts = {}) {
  if (!(majorR > 0 && minorR > 0)) throw new Error('sampleTorus: majorR / minorR must be > 0');
  if (minorR >= majorR) throw new Error('sampleTorus: minorR must be < majorR (no self-intersecting tori)');
  const c = opts.center ?? [0, 0, 0];
  const noiseStdMm = opts.noiseStdMm ?? 0;
  const { rng, gauss } = makeRng(opts.seed ?? 1);
  const ratio = majorR / minorR;
  const out = new Float32Array(N * 3);
  let placed = 0;
  while (placed < N) {
    const theta = 2 * Math.PI * rng();                        // around major circle
    const phi   = 2 * Math.PI * rng();                        // around minor circle
    // Rejection on the Jacobian (R + r·cos φ) / (R + r).
    const accept = (ratio + Math.cos(phi)) / (ratio + 1);
    if (rng() > accept) continue;
    const rho = majorR + minorR * Math.cos(phi);
    let x = rho * Math.cos(theta);
    let y = rho * Math.sin(theta);
    let z = minorR * Math.sin(phi);
    x += c[0]; y += c[1]; z += c[2];
    if (noiseStdMm > 0) {
      x += gauss() * noiseStdMm;
      y += gauss() * noiseStdMm;
      z += gauss() * noiseStdMm;
    }
    out[placed * 3] = x; out[placed * 3 + 1] = y; out[placed * 3 + 2] = z;
    placed += 1;
  }
  return out;
}

/**
 * Sample N points uniformly on a closed cylinder (lateral surface
 * plus two end caps) of radius `R` and height `H`, centred on the
 * origin and aligned with +Z. Areas are weighted so the per-region
 * density is uniform.
 *
 *   lateral area = 2·π·R·H
 *   cap area     = π·R² each, two caps
 */
export function sampleCylinder(R, H, N, opts = {}) {
  if (!(R > 0 && H > 0)) throw new Error('sampleCylinder: R / H must be > 0');
  const c = opts.center ?? [0, 0, 0];
  const noiseStdMm = opts.noiseStdMm ?? 0;
  const { rng, gauss } = makeRng(opts.seed ?? 1);
  const lateralA = 2 * Math.PI * R * H;
  const capA     = Math.PI * R * R;
  const totalA   = lateralA + 2 * capA;
  const wLateral = lateralA / totalA;
  const wTop     = capA / totalA;                            // wBottom = same, computed by exclusion
  const out = new Float32Array(N * 3);
  for (let s = 0; s < N; s++) {
    const u = rng();
    let x, y, z;
    if (u < wLateral) {
      const theta = 2 * Math.PI * rng();
      x = R * Math.cos(theta);
      y = R * Math.sin(theta);
      z = (rng() - 0.5) * H;
    } else {
      // pick a uniform point in a disc of radius R (Marsaglia)
      let dx, dy, dw;
      do { dx = 2 * rng() - 1; dy = 2 * rng() - 1; dw = dx * dx + dy * dy; } while (dw >= 1);
      x = R * dx;
      y = R * dy;
      z = (u < wLateral + wTop) ? H / 2 : -H / 2;
    }
    x += c[0]; y += c[1]; z += c[2];
    if (noiseStdMm > 0) {
      x += gauss() * noiseStdMm;
      y += gauss() * noiseStdMm;
      z += gauss() * noiseStdMm;
    }
    out[s * 3] = x; out[s * 3 + 1] = y; out[s * 3 + 2] = z;
  }
  return out;
}

/** Analytic volumes of the source surfaces — for validating reconstruction. */
export function sphereVolume(R) { return (4 / 3) * Math.PI * R * R * R; }
export function torusVolume(majorR, minorR) { return 2 * Math.PI * Math.PI * majorR * minorR * minorR; }
export function cylinderVolume(R, H) { return Math.PI * R * R * H; }
