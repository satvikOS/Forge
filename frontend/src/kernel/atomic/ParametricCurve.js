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

/**
 * Archimedean spiral r = a + b·θ, sampled over θ ∈ [theta0, theta1].
 * Used for hairspring profiles.
 *
 * @param {number} a         radius at θ = 0
 * @param {number} b         radial growth per radian
 * @param {number} theta0    start angle (radians)
 * @param {number} theta1    end angle (radians)
 * @param {number} segments  positive integer, number of segments (>= 1); returns segments+1 pts
 * @returns {Array<[number,number]>}
 */
export function archimedeanSpiral(a, b, theta0, theta1, segments = 128) {
  if (!(segments >= 1)) throw new Error('archimedeanSpiral: segments must be >= 1');
  if (a + b * theta0 < 0 || a + b * theta1 < 0) {
    throw new Error('archimedeanSpiral: r = a + b·θ must stay non-negative over [theta0, theta1]');
  }
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const th = theta0 + (theta1 - theta0) * (i / segments);
    const r = a + b * th;
    pts.push([r * Math.cos(th), r * Math.sin(th)]);
  }
  return pts;
}

/**
 * Ellipse arc centred at the origin, semi-axes rx and ry, over [a0, a1].
 *
 * @param {number} rx        semi-axis along x (> 0)
 * @param {number} ry        semi-axis along y (> 0)
 * @param {number} a0        start angle (radians, assumed finite)
 * @param {number} a1        end angle (radians, assumed finite)
 * @param {number} segments  positive integer, number of segments (>= 1); returns segments+1 pts
 * @returns {Array<[number,number]>}
 */
export function ellipseArc(rx, ry, a0, a1, segments = 64) {
  if (!(rx > 0) || !(ry > 0)) throw new Error('ellipseArc: rx and ry must be > 0');
  if (!(segments >= 1)) throw new Error('ellipseArc: segments must be >= 1');
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = a0 + (a1 - a0) * (i / segments);
    pts.push([rx * Math.cos(a), ry * Math.sin(a)]);
  }
  return pts;
}

/**
 * Full circle as a closed polyline of exactly `segments` points (the first
 * point is NOT repeated at the end — the loop closes implicitly).
 *
 * @param {number} radius    circle radius (> 0)
 * @param {number} segments  positive integer, number of points (>= 3)
 * @param {number} cx        centre x (default 0)
 * @param {number} cy        centre y (default 0)
 * @returns {Array<[number,number]>}
 */
export function circlePolyline(radius, segments = 64, cx = 0, cy = 0) {
  if (!(radius > 0)) throw new Error('circlePolyline: radius must be > 0');
  if (!(segments >= 3)) throw new Error('circlePolyline: segments must be >= 3');
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI) * (i / segments);
    pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return pts;
}
