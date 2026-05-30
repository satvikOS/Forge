/**
 * Routing — path-driven harness/pipe/tube smoothing. The first slice of
 * an NX/Creo Routing-class workbench: take a 3D polyline (a hand-drawn
 * harness route) and an enforced minimum bend radius, and produce a
 * SMOOTH centerline whose interior corners are replaced with tangent
 * circular arcs — the same geometric contract a bend tool enforces on
 * real tube benders / wire harnesses. The downstream sweep of a
 * circular cross-section along this centerline is what becomes the
 * actual routed tube body; that part is left to the caller.
 *
 * Math is exact (no fitting, no NURBS yet):
 *   At each interior vertex P_i with incoming unit dir d_in, outgoing
 *   unit dir d_out, and turn angle γ = acos(d_in·d_out):
 *     tangent offset T  = r · tan(γ/2)         (back-off along each leg)
 *     arc radius     r  = bendRadius (clamped if T overruns a leg)
 *     arc center     C  = P_i + b̂ · (r / cos(γ/2))   (b̂ bisects turn,
 *                                                       points inward)
 *     A = P_i − d_in · T,   B = P_i + d_out · T
 *   The arc spans angle γ; we sample it via spherical-linear interp of
 *   the unit vectors (A−C) and (B−C) so we never tangle at small γ.
 *
 * Edge cases handled honestly:
 *   - γ ≈ 0  : collinear segment; vertex passes through.
 *   - γ → π  : 180° reversal; no smooth bend possible — vertex kept sharp
 *              and flagged in the report (caller can warn the user).
 *   - desired T overruns the shorter leg: arc radius is reduced so the
 *     arcs of adjacent corners do not overlap. The achieved radius is
 *     recorded so the caller can surface which bends were clamped.
 *
 * Output is a polyline; the downstream sweep handles the actual tube.
 */

const EPS = 1e-9;

// ─── small vector helpers (avoid pulling Three.js into a pure module) ───
const sub  = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add  = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scl  = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot  = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => Math.hypot(a[0], a[1], a[2]);
const unit = (a) => { const n = norm(a); return n > EPS ? scl(a, 1 / n) : [0, 0, 0]; };
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));

/**
 * Build the smoothed centerline through `path` honouring a minimum
 * `bendRadius` at every interior corner. Returns:
 *   {
 *     centerline:   [[x,y,z], …]   the sampled polyline
 *     bends: [{
 *       index,        // which interior vertex
 *       turnDeg,      // turn angle in degrees (0 = straight, 90 = right-angle)
 *       requestedR,   // bendRadius the user asked for
 *       achievedR,    // bendRadius actually applied (clamped to fit legs)
 *       clamped,      // true if achievedR < requestedR
 *       arcLength,    // arc length in mm (achievedR * γ)
 *       kept,         // false if vertex kept sharp (U-turn / collinear)
 *       note,         // human-readable reason when not honoured
 *     }]
 *     length:       total centerline length in mm
 *   }
 *
 * `samplesPerArc` controls how finely each arc is discretised
 * (default 16); the centerline is fed to a downstream sweep, so denser
 * sampling = rounder tube at the bend.
 */
export function buildRouteCenterline(path, bendRadius, samplesPerArc = 16) {
  if (!Array.isArray(path) || path.length < 2) {
    throw new Error('Routing: path must be an array of at least two [x,y,z] points.');
  }
  const r = Number(bendRadius);
  if (!(r >= 0)) throw new Error('Routing: bendRadius must be ≥ 0.');

  const bends = [];
  const out = [[...path[0]]];

  // Per-leg available length (to clamp the tangent offset). Each interior
  // corner consumes T off the end of its leading leg and T off the start
  // of its trailing leg; adjacent corners can't both take more than half.
  const legLen = [];
  for (let i = 0; i < path.length - 1; i++) legLen.push(norm(sub(path[i + 1], path[i])));

  let pCurrent = [...path[0]];

  for (let i = 1; i < path.length - 1; i++) {
    const p = pCurrent, q = path[i], rNext = path[i + 1];
    const inV = sub(q, p), outV = sub(rNext, q);
    const inLen = norm(inV), outLen = norm(outV);
    if (inLen < EPS || outLen < EPS) {
      // Degenerate leg — skip vertex.
      bends.push({ index: i, turnDeg: 0, requestedR: r, achievedR: 0, clamped: false, arcLength: 0, kept: false, note: 'degenerate leg' });
      pCurrent = q;
      continue;
    }
    const dIn = scl(inV, 1 / inLen), dOut = scl(outV, 1 / outLen);
    const cosG = clamp(dot(dIn, dOut), -1, 1);
    const gamma = Math.acos(cosG);

    // Near-collinear: no bend; pass through.
    if (r < EPS || gamma < 1e-3) {
      bends.push({ index: i, turnDeg: gamma * 180 / Math.PI, requestedR: r, achievedR: 0, clamped: false, arcLength: 0, kept: true, note: 'collinear (no bend needed)' });
      out.push([...q]);
      pCurrent = q;
      continue;
    }

    // Near-reversal: a 180° bend at finite radius needs infinite tangent
    // offset — physically impossible. Keep sharp + flag.
    if (gamma > Math.PI - 1e-3) {
      bends.push({ index: i, turnDeg: gamma * 180 / Math.PI, requestedR: r, achievedR: 0, clamped: false, arcLength: 0, kept: false, note: '180° reversal cannot be smoothed at finite radius' });
      out.push([...q]);
      pCurrent = q;
      continue;
    }

    // Tangent offset for the requested radius.
    const tan_half = Math.tan(gamma / 2);
    const desiredT = r * tan_half;
    // Clamp so both adjacent arcs fit inside their legs. The leading leg
    // already gave up `inLen - |q - pCurrent|` (= 0 on first vertex, the
    // arc end-point of the previous corner thereafter); the trailing leg
    // must reserve room for the NEXT corner's tangent offset (we don't
    // know it yet, so we just cap at half).
    const inAvail  = norm(sub(q, pCurrent));               // already-trimmed leading leg
    const outAvail = (i === path.length - 2) ? outLen : outLen * 0.5;
    const maxT = Math.min(inAvail, outAvail);
    const T = Math.min(desiredT, maxT);
    const achievedR = T / tan_half;
    const clamped = T < desiredT - EPS;

    if (T < EPS) {
      // No room at all (very short leg). Pass vertex through, flag.
      bends.push({ index: i, turnDeg: gamma * 180 / Math.PI, requestedR: r, achievedR: 0, clamped: true, arcLength: 0, kept: false, note: 'no leg headroom for arc' });
      out.push([...q]);
      pCurrent = q;
      continue;
    }

    const A = add(q, scl(dIn,  -T));
    const B = add(q, scl(dOut,  T));

    // Bisector pointing into the inside of the turn (toward the arc center).
    const bRaw = sub(dOut, dIn);
    const bn = norm(bRaw);
    if (bn < EPS) {
      // dIn ≈ dOut (handled above) or dIn ≈ -dOut (handled above) —
      // shouldn't reach here, but bail safely.
      out.push([...q]);
      pCurrent = q;
      continue;
    }
    const bhat = scl(bRaw, 1 / bn);
    const C = add(q, scl(bhat, achievedR / Math.cos(gamma / 2)));

    // SLERP from A to B on the sphere of radius achievedR around C —
    // numerically clean for any γ ∈ (0, π).
    const u = scl(sub(A, C), 1 / achievedR);  // unit
    const v = scl(sub(B, C), 1 / achievedR);  // unit, γ from u
    const sinG = Math.sin(gamma);
    out.push(A);
    for (let k = 1; k < samplesPerArc; k++) {
      const t = k / samplesPerArc;
      const a = Math.sin((1 - t) * gamma) / sinG;
      const b = Math.sin(t       * gamma) / sinG;
      const qpt = add(scl(u, a), scl(v, b));
      out.push(add(C, scl(qpt, achievedR)));
    }
    out.push(B);

    bends.push({
      index: i,
      turnDeg: gamma * 180 / Math.PI,
      requestedR: r,
      achievedR,
      clamped,
      arcLength: achievedR * gamma,
      kept: true,
      note: clamped ? 'radius clamped to fit leg headroom' : 'honoured',
    });

    // Advance — the next leg's leading point is B (the arc end), not q.
    pCurrent = B;
  }

  out.push([...path[path.length - 1]]);

  // Total centerline length (sum of straight + arc samples).
  let length = 0;
  for (let i = 1; i < out.length; i++) length += norm(sub(out[i], out[i - 1]));

  return { centerline: out, bends, length };
}

/**
 * Convenience: theoretical straight-polyline path length (sum of legs).
 * The smoothed centerline is shorter by Σ(2T − r·γ) at each honoured
 * corner; this is how callers report "saved by bends" if they want to.
 */
export function polylinePathLength(path) {
  let s = 0;
  for (let i = 1; i < path.length; i++) {
    const dx = path[i][0] - path[i - 1][0];
    const dy = path[i][1] - path[i - 1][1];
    const dz = path[i][2] - path[i - 1][2];
    s += Math.hypot(dx, dy, dz);
  }
  return s;
}

/**
 * Quick summary string for surfacing in a tool result message:
 * "3 bends honoured, 1 clamped to R=12 mm".
 */
export function summarizeBends(bends) {
  const kept = bends.filter(b => b.kept && b.arcLength > 0);
  const clamped = kept.filter(b => b.clamped);
  const skipped = bends.filter(b => !b.kept);
  const parts = [];
  parts.push(`${kept.length} bend${kept.length === 1 ? '' : 's'} honoured`);
  if (clamped.length) parts.push(`${clamped.length} clamped`);
  if (skipped.length) parts.push(`${skipped.length} skipped`);
  return parts.join(', ');
}
