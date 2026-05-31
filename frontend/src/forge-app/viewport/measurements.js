/**
 * measurements — pure geometry for the on-screen ruler.
 *
 * The MeasurementTool collects 1–4 picked points and turns them into
 * an annotation. Computing the actual scalar (distance / angle / area)
 * is pure-vector math, so it lives here (no React, no Three) and gets
 * a tight headless test.
 *
 * Picked points are `[x, y, z]` triples (world space, units = project
 * units; mm by default).
 *
 * Snap targets (vertex / edge-midpoint / face-centre) come from the
 * native kernel via `ForgeBodyMesh.userData.snapHints`; we don't
 * resolve them here — the caller passes the already-snapped point.
 * That keeps this module 100% deterministic.
 */

const EPS = 1e-12;

/**
 * Distance between two picked points. Returns 0 if either is missing.
 */
export function distance(a, b) {
  if (!a || !b) return 0;
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  const dz = a[2] - b[2];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Angle at vertex `b` of triangle a-b-c, in radians.
 * Returns 0 if any side has zero length (degenerate).
 */
export function angleAt(a, b, c) {
  if (!a || !b || !c) return 0;
  const u = [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const v = [c[0] - b[0], c[1] - b[1], c[2] - b[2]];
  const lu = Math.hypot(u[0], u[1], u[2]);
  const lv = Math.hypot(v[0], v[1], v[2]);
  if (lu < EPS || lv < EPS) return 0;
  const dot = u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
  const c01 = Math.max(-1, Math.min(1, dot / (lu * lv)));
  return Math.acos(c01);
}

/**
 * Polygon area of a (planar-ish) sequence of points via the shoelace
 * formula on the projection that maximises area. Robust against
 * misorientation; good enough for the UI ruler readout.
 */
export function polygonArea(points) {
  if (!points || points.length < 3) return 0;
  let area = 0;
  // Compute normal as ½ |Σ (p[i] × p[i+1])|.
  const n = points.length;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    nx += a[1] * b[2] - a[2] * b[1];
    ny += a[2] * b[0] - a[0] * b[2];
    nz += a[0] * b[1] - a[1] * b[0];
  }
  area = 0.5 * Math.hypot(nx, ny, nz);
  return area;
}

/**
 * Summarise a measurement given the picked points. Returns an
 * annotation `{ kind, value, label, points }` suitable for the
 * on-screen sticky label.
 */
export function summarise(points, opts = {}) {
  const units = opts.units || 'mm';
  const angleUnits = opts.angleUnits || 'deg';
  const n = (points || []).length;
  if (n < 2) {
    return { kind: 'incomplete', value: 0, label: 'pick a point…', points };
  }
  if (n === 2) {
    const d = distance(points[0], points[1]);
    return { kind: 'distance', value: d,
             label: `${d.toFixed(3)} ${units}`,
             points };
  }
  if (n === 3) {
    const rad = angleAt(points[0], points[1], points[2]);
    const deg = (rad * 180) / Math.PI;
    const v = angleUnits === 'rad' ? rad : deg;
    return { kind: 'angle', value: v,
             label: angleUnits === 'rad'
                    ? `${rad.toFixed(4)} rad`
                    : `${deg.toFixed(2)}°`,
             points };
  }
  // 4 or more points — polygon area.
  const a = polygonArea(points);
  return { kind: 'area', value: a,
           label: `${a.toFixed(3)} ${units}²`,
           points };
}

/**
 * Snap a raw pick to the nearest hint (vertex / edge midpoint / face
 * centre). `hints` is a flat list of `{ point: [x,y,z], kind, weight }`.
 * Returns the snapped point + which hint won. If no hint is within
 * `pixelTolerance` (approximated as `radius`), returns the raw point.
 */
export function snapToHints(rawPoint, hints, radius = 5.0) {
  if (!rawPoint) return { point: rawPoint, snapped: null };
  if (!hints || hints.length === 0) return { point: rawPoint, snapped: null };
  let best = null;
  let bestD = Infinity;
  for (const h of hints) {
    if (!h || !h.point) continue;
    const d = distance(rawPoint, h.point);
    // Weight prefers higher-confidence hints (vertex > edge > face).
    const w = h.weight || 1;
    const score = d / w;
    if (score < bestD) { bestD = score; best = h; }
  }
  if (best && bestD <= radius) {
    return { point: [...best.point], snapped: best };
  }
  return { point: rawPoint, snapped: null };
}
