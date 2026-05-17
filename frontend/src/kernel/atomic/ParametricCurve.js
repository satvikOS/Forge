/**
 * ArchDisc Kernel — Parametric Curve evaluators.
 *
 * Exact point generators for curves that need math: involute, Archimedean
 * spiral, ellipse. Each returns an array of [x, y] points. Kernel-free pure
 * math so e2e specs can import it directly in Node.
 *
 * A curve evaluator is a SKETCH-ENTITY PRIMITIVE — the same atomic level as a
 * line or an arc — not a premade part. It yields a curve, never a component.
 */

/**
 * Involute of a circle of radius `baseRadius`.
 * Parametric form: x = rb(cos t + t sin t), y = rb(sin t − t cos t).
 * Distance from the origin is rb·sqrt(1 + t²) by construction.
 *
 * @param {number} baseRadius  base circle radius (> 0)
 * @param {number} t0          start unrolling parameter (assumed finite)
 * @param {number} t1          end unrolling parameter (assumed finite)
 * @param {number} segments    positive integer, number of segments (>= 1); returns segments+1 pts
 * @returns {Array<[number,number]>}
 */
export function involute(baseRadius, t0, t1, segments = 32) {
  if (!(baseRadius > 0)) throw new Error('involute: baseRadius must be > 0');
  if (!(segments >= 1)) throw new Error('involute: segments must be >= 1');
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = t0 + (t1 - t0) * (i / segments);
    pts.push([
      baseRadius * (Math.cos(t) + t * Math.sin(t)),
      baseRadius * (Math.sin(t) - t * Math.cos(t)),
    ]);
  }
  return pts;
}

/**
 * The unrolling parameter t at which the involute reaches radius `r`.
 * Inverts r = rb·sqrt(1 + t²)  ->  t = sqrt((r/rb)² − 1).
 *
 * @param {number} baseRadius  base circle radius (> 0)
 * @param {number} r           target radius (>= baseRadius)
 * @returns {number}
 */
export function involuteParamAtRadius(baseRadius, r) {
  if (!(baseRadius > 0)) throw new Error('involuteParamAtRadius: baseRadius must be > 0');
  if (r < baseRadius) throw new Error('involuteParamAtRadius: r must be >= baseRadius');
  return Math.sqrt((r / baseRadius) ** 2 - 1);
}
