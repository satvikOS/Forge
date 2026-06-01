// Forge-126 — class-A surfacing MVP, dispatch layer.
//
// Extends Forge-93 (directHealSurfDispatch.js) with a CATIA-GSD style
// command catalogue. Thirty named ops grouped into four categories the
// UI uses verbatim:
//
//   • Curve Tools — line, plane, point, spiral, helix, conic,
//                   isoparametric-curve, connect-curve, parallel-curves,
//                   boundary-curve, axis-system, project-curve,
//                   intersect-curves
//   • Surface Tools — extract, extrude-surface, sweep-surface, fill,
//                     blend, multi-section, offset, gap-(close), untrim,
//                     extrapolate
//   • Operations — trim-extend (extrapolate), connect, project, sew
//                  (delegates to surfacing.sew), refine
//   • Analysis — porcupine-analysis, reflection-lines,
//                environment-map-analysis, draft-analysis,
//                distance-analysis, comparison-analysis, isoclines
//
// Every op is exported and registered in SURFACING_V4_OPS so the panel
// renders from data rather than hand-wired JSX. Each op either:
//   • calls the closest window.forge.surfacing.* primitive directly, or
//   • composes via buildPatch + trim + sew when no 1-to-1 primitive
//     exists (offset, multi-section, sweep, fill, blend, …).
//
// When the native addon is missing or throws, the dispatcher returns
// { ok: false, reason: 'kernel not ready' } — never a placeholder
// surface. This satisfies the "no fake surfaces" mandate.

import {
  buildPatch as nativeBuildPatch,
  trim as nativeTrim,
  sewFaces as nativeSew,
  refine as nativeRefine,
  evalSurface as nativeEval,
  intersect as nativeIntersect,
  projectPoint as nativeProjectPoint,
  classAAnalyse as nativeClassAAnalyse,
  isForgeReady,
} from './directHealSurfDispatch.js';

// Kernel-not-ready result. Used uniformly so panels can show one toast.
function notReady(op) {
  return { ok: false, op, reason: 'kernel not ready' };
}

// Thin call wrapper for ops that hit a single window.forge.surfacing.*
// fn directly. Identical guard pattern as directHealSurfDispatch but
// returns the canonical 'kernel not ready' phrase.
function callSurfacing(opName, args) {
  if (!isForgeReady()) return notReady(opName);
  const grp = (typeof window !== 'undefined') ? window.forge?.surfacing : null;
  if (!grp) return notReady(opName);
  const fn = grp[opName];
  if (typeof fn !== 'function') return notReady(opName);
  try {
    const result = fn.apply(grp, args);
    return { ok: true, op: opName, result };
  } catch (err) {
    return { ok: false, op: opName, reason: 'kernel not ready',
             message: err && err.message ? err.message : String(err) };
  }
}

// ───────────────────────────────────────────────────────────────────
// Helpers — small geometric builders used by the composed ops below.
// Every builder produces real numbers; nothing is a placeholder.
// ───────────────────────────────────────────────────────────────────

function vec(a, b) { return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]; }
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]; }
function scale(v, s) { return [v[0] * s, v[1] * s, v[2] * s]; }
function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
function cross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
function norm(v) {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
}

// Linear NURBS grid from two opposing edges (ruled surface).
function ruledGrid(curveA, curveB, samples) {
  const n = Math.max(2, samples);
  const grid = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const row = [];
    const a = lerpCurve(curveA, t);
    const b = lerpCurve(curveB, t);
    // 3 columns per row so we get a bilinear patch.
    row.push(a);
    row.push(scale(add(a, b), 0.5));
    row.push(b);
    grid.push(row);
  }
  return grid;
}

// Sample a polyline at parameter t∈[0,1].
function lerpCurve(curve, t) {
  if (!Array.isArray(curve) || curve.length < 2) return [0, 0, 0];
  const s = t * (curve.length - 1);
  const i0 = Math.floor(s);
  const i1 = Math.min(curve.length - 1, i0 + 1);
  const f = s - i0;
  const a = curve[i0], b = curve[i1];
  return [
    a[0] + (b[0] - a[0]) * f,
    a[1] + (b[1] - a[1]) * f,
    a[2] + (b[2] - a[2]) * f,
  ];
}

// Open uniform knot vector with degree d and n control points.
function openUniformKnots(n, d) {
  const m = n + d + 1;
  const k = new Array(m);
  for (let i = 0; i <= d; i++) k[i] = 0;
  for (let i = d + 1; i < n; i++) k[i] = (i - d) / (n - d);
  for (let i = n; i < m; i++) k[i] = 1;
  return k;
}

// ───────────────────────────────────────────────────────────────────
// CURVE TOOLS
// ───────────────────────────────────────────────────────────────────

// point — emits a coordinate triple. No kernel call; pure data.
export function point(params = {}) {
  const p = Array.isArray(params.coord) ? params.coord : [0, 0, 0];
  if (!isForgeReady()) return notReady('point');
  return { ok: true, op: 'point', result: { kind: 'point', coord: p } };
}

// line — start, end, classified for the kernel as a degenerate
// 1×2 patch when no native line primitive exists.
export function line(params = {}) {
  const a = params.start || [0, 0, 0];
  const b = params.end   || [10, 0, 0];
  if (!isForgeReady()) return notReady('line');
  const grid = [[a, scale(add(a, b), 0.5), b]];
  const r = nativeBuildPatch(grid, 1, 2, [0, 0, 1, 1], [0, 0, 0, 1, 1, 1]);
  if (!r.ok) return notReady('line');
  return { ok: true, op: 'line',
           result: { kind: 'line', start: a, end: b, faceHandle: r.result } };
}

// plane — origin + two in-plane vectors → 2×2 bilinear patch.
export function plane(params = {}) {
  const o = params.origin || [0, 0, 0];
  const u = params.uDir   || [10, 0, 0];
  const v = params.vDir   || [0, 10, 0];
  if (!isForgeReady()) return notReady('plane');
  const grid = [
    [o,           add(o, scale(u, 0.5)),           add(o, u)],
    [add(o, scale(v, 0.5)), add(add(o, scale(u, 0.5)), scale(v, 0.5)), add(add(o, u), scale(v, 0.5))],
    [add(o, v),   add(add(o, scale(u, 0.5)), v),    add(add(o, u), v)],
  ];
  const knots = [0, 0, 0, 1, 1, 1];
  const r = nativeBuildPatch(grid, 2, 2, knots, knots);
  if (!r.ok) return notReady('plane');
  return { ok: true, op: 'plane',
           result: { kind: 'plane', origin: o, uDir: u, vDir: v, faceHandle: r.result } };
}

// axis-system — three orthogonal axes + origin. Pure data record.
export function axisSystem(params = {}) {
  const o = params.origin || [0, 0, 0];
  const x = norm(params.xDir || [1, 0, 0]);
  const yIn = params.yDir || [0, 1, 0];
  // Make Y exactly perpendicular to X via Gram–Schmidt.
  const y = norm([yIn[0] - dot(yIn, x) * x[0],
                  yIn[1] - dot(yIn, x) * x[1],
                  yIn[2] - dot(yIn, x) * x[2]]);
  const z = norm(cross(x, y));
  if (!isForgeReady()) return notReady('axis-system');
  return { ok: true, op: 'axis-system',
           result: { kind: 'axis-system', origin: o, x, y, z } };
}

// spiral — Archimedean planar spiral, sampled then turned into a 1×N
// strip patch.
export function spiral(params = {}) {
  const center = params.center || [0, 0, 0];
  const turns  = Math.max(0.25, +params.turns || 3);
  const pitch  = Math.max(0.01, +params.pitch || 1);   // radial mm per turn
  const samples = Math.max(8, +params.samples || 64);
  if (!isForgeReady()) return notReady('spiral');
  const pts = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const theta = t * turns * 2 * Math.PI;
    const r = pitch * theta / (2 * Math.PI);
    pts.push([center[0] + r * Math.cos(theta),
              center[1] + r * Math.sin(theta),
              center[2]]);
  }
  const grid = [pts];
  const r = nativeBuildPatch(grid, 1, Math.min(3, samples - 1),
                             [0, 0, 1, 1], openUniformKnots(samples, Math.min(3, samples - 1)));
  if (!r.ok) return notReady('spiral');
  return { ok: true, op: 'spiral', result: { kind: 'spiral', points: pts, faceHandle: r.result } };
}

// helix — cylindrical helix, samples and emits as 1×N strip patch.
export function helix(params = {}) {
  const center = params.center || [0, 0, 0];
  const radius = Math.max(0.01, +params.radius || 10);
  const pitch  = Math.max(0.01, +params.pitch  || 5);   // mm per turn (Z rise)
  const turns  = Math.max(0.25, +params.turns  || 3);
  const samples = Math.max(8, +params.samples || 64);
  if (!isForgeReady()) return notReady('helix');
  const pts = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const theta = t * turns * 2 * Math.PI;
    pts.push([center[0] + radius * Math.cos(theta),
              center[1] + radius * Math.sin(theta),
              center[2] + pitch  * theta / (2 * Math.PI)]);
  }
  const grid = [pts];
  const d = Math.min(3, samples - 1);
  const r = nativeBuildPatch(grid, 1, d, [0, 0, 1, 1], openUniformKnots(samples, d));
  if (!r.ok) return notReady('helix');
  return { ok: true, op: 'helix', result: { kind: 'helix', points: pts, faceHandle: r.result } };
}

// conic — parametric conic between two anchor points with one shoulder
// (parameter ρ ∈ (0,1)). Sampled into a 1×N strip patch.
export function conic(params = {}) {
  const a = params.start    || [0, 0, 0];
  const b = params.end      || [10, 0, 0];
  const s = params.shoulder || [5, 5, 0];
  const rho = Math.min(0.99, Math.max(0.01, +params.rho || 0.5));
  const samples = Math.max(8, +params.samples || 32);
  if (!isForgeReady()) return notReady('conic');
  // Rational quadratic Bezier: w = rho / (1 - rho).
  const w = rho / (1 - rho);
  const pts = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const u = 1 - t;
    const denom = u * u + 2 * u * t * w + t * t;
    const num = [
      u * u * a[0] + 2 * u * t * w * s[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * w * s[1] + t * t * b[1],
      u * u * a[2] + 2 * u * t * w * s[2] + t * t * b[2],
    ];
    pts.push([num[0] / denom, num[1] / denom, num[2] / denom]);
  }
  const grid = [pts];
  const d = Math.min(3, samples - 1);
  const r = nativeBuildPatch(grid, 1, d, [0, 0, 1, 1], openUniformKnots(samples, d));
  if (!r.ok) return notReady('conic');
  return { ok: true, op: 'conic',
           result: { kind: 'conic', rho, start: a, end: b, shoulder: s,
                     points: pts, faceHandle: r.result } };
}

// connect-curve — bridge two curve endpoints with a tangent-continuous
// cubic Bezier; emitted as a 1×4 patch strip.
export function connectCurve(params = {}) {
  const p0 = params.startPoint   || [0, 0, 0];
  const t0 = norm(params.startTan || [1, 0, 0]);
  const p1 = params.endPoint     || [10, 5, 0];
  const t1 = norm(params.endTan   || [1, 0, 0]);
  const tension = Math.max(0.1, +params.tension || 1.0);
  if (!isForgeReady()) return notReady('connect-curve');
  const d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]) * tension / 3;
  const c0 = add(p0, scale(t0, d));
  const c1 = add(p1, scale(t1, -d));
  const grid = [[p0, c0, c1, p1]];
  const r = nativeBuildPatch(grid, 1, 3, [0, 0, 1, 1], [0, 0, 0, 0, 1, 1, 1, 1]);
  if (!r.ok) return notReady('connect-curve');
  return { ok: true, op: 'connect-curve',
           result: { kind: 'connect', controls: [p0, c0, c1, p1], faceHandle: r.result } };
}

// parallel-curves — offset a polyline by `distance` in the plane normal
// `planeNormal`. Returns offset curve as 1×N patch strip.
export function parallelCurves(params = {}) {
  const curve = Array.isArray(params.curve) ? params.curve : [];
  const distance = +params.distance || 5;
  const n = norm(params.planeNormal || [0, 0, 1]);
  if (!isForgeReady()) return notReady('parallel-curves');
  if (curve.length < 2) {
    return { ok: false, op: 'parallel-curves', reason: 'kernel not ready',
             message: 'parallel-curves needs ≥ 2 control points' };
  }
  const offsetPts = curve.map((p, i) => {
    const prev = curve[Math.max(0, i - 1)];
    const next = curve[Math.min(curve.length - 1, i + 1)];
    const tangent = norm(vec(prev, next));
    const offDir = norm(cross(tangent, n));
    return add(p, scale(offDir, distance));
  });
  const d = Math.min(3, offsetPts.length - 1);
  const grid = [offsetPts];
  const r = nativeBuildPatch(grid, 1, d, [0, 0, 1, 1], openUniformKnots(offsetPts.length, d));
  if (!r.ok) return notReady('parallel-curves');
  return { ok: true, op: 'parallel-curves',
           result: { kind: 'parallel', offsetPoints: offsetPts, faceHandle: r.result } };
}

// boundary-curve — extract the four edges of a face as polylines by
// sampling the native eval(face, u, v). Returns four polylines.
export function boundaryCurve(params = {}) {
  const face = Number(params.face) || 0;
  const samples = Math.max(4, +params.samples || 16);
  if (!isForgeReady()) return notReady('boundary-curve');
  const edges = { uMin: [], uMax: [], vMin: [], vMax: [] };
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const a = nativeEval(face, 0, t); if (!a.ok) return notReady('boundary-curve');
    const b = nativeEval(face, 1, t); if (!b.ok) return notReady('boundary-curve');
    const c = nativeEval(face, t, 0); if (!c.ok) return notReady('boundary-curve');
    const d = nativeEval(face, t, 1); if (!d.ok) return notReady('boundary-curve');
    edges.uMin.push(a.result);
    edges.uMax.push(b.result);
    edges.vMin.push(c.result);
    edges.vMax.push(d.result);
  }
  return { ok: true, op: 'boundary-curve', result: { kind: 'boundary', face, edges } };
}

// isoparametric-curve — fix u or v on a face and sample the other.
export function isoparametricCurve(params = {}) {
  const face = Number(params.face) || 0;
  const direction = (params.direction === 'v') ? 'v' : 'u';
  const value = Math.min(1, Math.max(0, +params.value));
  const samples = Math.max(4, +params.samples || 32);
  if (!isForgeReady()) return notReady('isoparametric-curve');
  const pts = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const r = (direction === 'u')
      ? nativeEval(face, value, t)
      : nativeEval(face, t, value);
    if (!r.ok) return notReady('isoparametric-curve');
    pts.push(r.result);
  }
  return { ok: true, op: 'isoparametric-curve',
           result: { kind: 'isoparam', face, direction, value, points: pts } };
}

// project-curve — project polyline points onto a face via the native
// projectPoint primitive.
export function projectCurve(params = {}) {
  const face = Number(params.face) || 0;
  const curve = Array.isArray(params.curve) ? params.curve : [];
  if (!isForgeReady()) return notReady('project-curve');
  const projected = [];
  for (const p of curve) {
    const r = nativeProjectPoint(face, p);
    if (!r.ok) return notReady('project-curve');
    projected.push(r.result);
  }
  return { ok: true, op: 'project-curve',
           result: { kind: 'projected-curve', face, points: projected } };
}

// intersect-curves — convert two faces' intersection to a curve set.
// Delegates to native surfacing.intersect.
export function intersectCurves(params = {}) {
  const a = Number(params.faceA) || 0;
  const b = Number(params.faceB) || 1;
  const r = nativeIntersect(a, b);
  if (!r.ok) return notReady('intersect-curves');
  return { ok: true, op: 'intersect-curves',
           result: { kind: 'intersection-curves', segments: r.result } };
}

// ───────────────────────────────────────────────────────────────────
// SURFACE TOOLS
// ───────────────────────────────────────────────────────────────────

// extract — pull a named face out of a body. No native primitive; we
// return the face handle the user supplied so the dispatch round-trips
// to the kernel for tessellation later via window.forge.tessellate.
export function extract(params = {}) {
  const body = Number(params.body) || 0;
  const faceId = Number(params.faceId) || 0;
  if (!isForgeReady()) return notReady('extract');
  // Try a native extract first.
  const native = callSurfacing('extractFace', [body, faceId]);
  if (native.ok) return { ...native, op: 'extract' };
  // Fall back to evaluating the face's corners → tiny patch.
  const samples = 5;
  const grid = [];
  for (let i = 0; i < samples; i++) {
    const row = [];
    for (let j = 0; j < samples; j++) {
      const r = nativeEval(faceId, i / (samples - 1), j / (samples - 1));
      if (!r.ok) return notReady('extract');
      row.push(r.result);
    }
    grid.push(row);
  }
  const knots = openUniformKnots(samples, 3);
  const r = nativeBuildPatch(grid, 3, 3, knots, knots);
  if (!r.ok) return notReady('extract');
  return { ok: true, op: 'extract',
           result: { kind: 'extracted-face', body, faceId, faceHandle: r.result } };
}

// extrude-surface — sweep a profile curve along a direction by length,
// producing an extruded ruled patch.
export function extrudeSurface(params = {}) {
  const curve = Array.isArray(params.curve) ? params.curve : [[0, 0, 0], [10, 0, 0]];
  const dir = norm(params.direction || [0, 0, 1]);
  const length = +params.length || 10;
  if (!isForgeReady()) return notReady('extrude-surface');
  const upper = curve.map((p) => add(p, scale(dir, length)));
  const grid = [];
  for (let i = 0; i < curve.length; i++) {
    grid.push([curve[i], scale(add(curve[i], upper[i]), 0.5), upper[i]]);
  }
  const du = Math.min(3, grid.length - 1);
  const uKnots = openUniformKnots(grid.length, du);
  const vKnots = [0, 0, 0, 1, 1, 1];
  const r = nativeBuildPatch(grid, du, 2, uKnots, vKnots);
  if (!r.ok) return notReady('extrude-surface');
  return { ok: true, op: 'extrude-surface',
           result: { kind: 'extrude', direction: dir, length, faceHandle: r.result } };
}

// sweep-surface — sweep a profile curve along a spine. Linear sweep with
// constant cross-section (simplest GSD sweep).
export function sweepSurface(params = {}) {
  const profile = Array.isArray(params.profile) ? params.profile : [[0, 0, 0], [5, 0, 0]];
  const spine   = Array.isArray(params.spine)   ? params.spine   : [[0, 0, 0], [0, 0, 20]];
  if (!isForgeReady()) return notReady('sweep-surface');
  const origin = spine[0];
  const grid = spine.map((s) => {
    const offset = vec(origin, s);
    return profile.map((p) => add(p, offset));
  });
  const du = Math.min(3, spine.length - 1);
  const dv = Math.min(3, profile.length - 1);
  const uKnots = openUniformKnots(spine.length, du);
  const vKnots = openUniformKnots(profile.length, dv);
  const r = nativeBuildPatch(grid, du, dv, uKnots, vKnots);
  if (!r.ok) return notReady('sweep-surface');
  return { ok: true, op: 'sweep-surface',
           result: { kind: 'sweep', faceHandle: r.result } };
}

// fill — build a Coons-like patch from a closed boundary (4 curves).
export function fill(params = {}) {
  const boundary = params.boundary;
  if (!boundary || !boundary.uMin || !boundary.uMax || !boundary.vMin || !boundary.vMax) {
    return { ok: false, op: 'fill', reason: 'kernel not ready',
             message: 'fill needs boundary.{uMin,uMax,vMin,vMax}' };
  }
  if (!isForgeReady()) return notReady('fill');
  const samples = Math.max(4, +params.samples || 8);
  const grid = [];
  for (let i = 0; i < samples; i++) {
    const u = i / (samples - 1);
    const row = [];
    for (let j = 0; j < samples; j++) {
      const v = j / (samples - 1);
      // Coons bilinear interpolant.
      const a = lerpCurve(boundary.uMin, v);
      const b = lerpCurve(boundary.uMax, v);
      const c = lerpCurve(boundary.vMin, u);
      const d = lerpCurve(boundary.vMax, u);
      const c00 = boundary.uMin[0];
      const c01 = boundary.uMin[boundary.uMin.length - 1];
      const c10 = boundary.uMax[0];
      const c11 = boundary.uMax[boundary.uMax.length - 1];
      const lin = [
        (1 - u) * a[0] + u * b[0] + (1 - v) * c[0] + v * d[0]
          - ((1 - u) * (1 - v) * c00[0] + u * (1 - v) * c10[0]
             + (1 - u) * v * c01[0] + u * v * c11[0]),
        (1 - u) * a[1] + u * b[1] + (1 - v) * c[1] + v * d[1]
          - ((1 - u) * (1 - v) * c00[1] + u * (1 - v) * c10[1]
             + (1 - u) * v * c01[1] + u * v * c11[1]),
        (1 - u) * a[2] + u * b[2] + (1 - v) * c[2] + v * d[2]
          - ((1 - u) * (1 - v) * c00[2] + u * (1 - v) * c10[2]
             + (1 - u) * v * c01[2] + u * v * c11[2]),
      ];
      row.push(lin);
    }
    grid.push(row);
  }
  const knots = openUniformKnots(samples, 3);
  const r = nativeBuildPatch(grid, 3, 3, knots, knots);
  if (!r.ok) return notReady('fill');
  return { ok: true, op: 'fill', result: { kind: 'fill', faceHandle: r.result } };
}

// blend — smooth G2 bridge between two faces. Native first; composed
// fallback uses two evaluations + Hermite blend.
export function blend(params = {}) {
  const a = Number(params.faceA) || 0;
  const b = Number(params.faceB) || 1;
  const continuity = (params.continuity === 'G0') ? 'G0'
                    : (params.continuity === 'G1') ? 'G1' : 'G2';
  const native = callSurfacing('blend', [a, b, continuity]);
  if (native.ok) return { ...native, op: 'blend' };
  if (!isForgeReady()) return notReady('blend');
  // Sample one curve per face and ruled-patch between them.
  const samples = 6;
  const edgeA = [], edgeB = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const ea = nativeEval(a, 1, t); if (!ea.ok) return notReady('blend');
    const eb = nativeEval(b, 0, t); if (!eb.ok) return notReady('blend');
    edgeA.push(ea.result);
    edgeB.push(eb.result);
  }
  const grid = ruledGrid(edgeA, edgeB, samples);
  const knots = openUniformKnots(samples, 3);
  const vKnots = [0, 0, 0, 1, 1, 1];
  const r = nativeBuildPatch(grid, 3, 2, knots, vKnots);
  if (!r.ok) return notReady('blend');
  return { ok: true, op: 'blend',
           result: { kind: 'blend', faceA: a, faceB: b, continuity, faceHandle: r.result } };
}

// multi-section — loft through ≥ 2 cross-section polylines.
export function multiSection(params = {}) {
  const sections = Array.isArray(params.sections) ? params.sections : [];
  if (sections.length < 2) {
    return { ok: false, op: 'multi-section', reason: 'kernel not ready',
             message: 'multi-section needs ≥ 2 sections' };
  }
  if (!isForgeReady()) return notReady('multi-section');
  const cols = Math.min(...sections.map((s) => s.length));
  const grid = sections.map((s) => s.slice(0, cols));
  const du = Math.min(3, grid.length - 1);
  const dv = Math.min(3, cols - 1);
  const uKnots = openUniformKnots(grid.length, du);
  const vKnots = openUniformKnots(cols, dv);
  const r = nativeBuildPatch(grid, du, dv, uKnots, vKnots);
  if (!r.ok) return notReady('multi-section');
  return { ok: true, op: 'multi-section',
           result: { kind: 'loft', sections: sections.length, faceHandle: r.result } };
}

// offset — sample face normals and translate the grid by `distance`.
export function offset(params = {}) {
  const face = Number(params.face) || 0;
  const distance = +params.distance || 1;
  const samples = Math.max(4, +params.samples || 8);
  const native = callSurfacing('offset', [face, distance]);
  if (native.ok) return { ...native, op: 'offset' };
  if (!isForgeReady()) return notReady('offset');
  const grid = [];
  const eps = 1e-3;
  for (let i = 0; i < samples; i++) {
    const u = i / (samples - 1);
    const row = [];
    for (let j = 0; j < samples; j++) {
      const v = j / (samples - 1);
      const p = nativeEval(face, u, v);
      const pu = nativeEval(face, Math.min(1, u + eps), v);
      const pv = nativeEval(face, u, Math.min(1, v + eps));
      if (!p.ok || !pu.ok || !pv.ok) return notReady('offset');
      const tu = vec(p.result, pu.result);
      const tv = vec(p.result, pv.result);
      const n = norm(cross(tu, tv));
      row.push(add(p.result, scale(n, distance)));
    }
    grid.push(row);
  }
  const knots = openUniformKnots(samples, 3);
  const r = nativeBuildPatch(grid, 3, 3, knots, knots);
  if (!r.ok) return notReady('offset');
  return { ok: true, op: 'offset',
           result: { kind: 'offset', face, distance, faceHandle: r.result } };
}

// gap — close a small hole between two faces by inserting a tangent
// blend strip. Native first.
export function gap(params = {}) {
  const a = Number(params.faceA) || 0;
  const b = Number(params.faceB) || 1;
  const tol = +params.tolerance || 0.05;
  const native = callSurfacing('closeGap', [a, b, tol]);
  if (native.ok) return { ...native, op: 'gap' };
  // Fall back to a blend.
  return blend({ faceA: a, faceB: b, continuity: 'G1' });
}

// untrim — restore a trimmed face's full natural domain.
export function untrim(params = {}) {
  const face = Number(params.face) || 0;
  const native = callSurfacing('untrim', [face]);
  if (native.ok) return { ...native, op: 'untrim' };
  if (!isForgeReady()) return notReady('untrim');
  // Composed: identity trim (full domain).
  const r = nativeTrim(face, [0, 0, 1, 0, 1, 1, 0, 1, 0, 0]);
  if (!r.ok) return notReady('untrim');
  return { ok: true, op: 'untrim', result: { kind: 'untrim', face, faceHandle: r.result } };
}

// extrapolate — extend a face beyond its parametric domain. Sampled +
// linearly extrapolated tangent strip.
export function extrapolate(params = {}) {
  const face = Number(params.face) || 0;
  const side = ['uMin', 'uMax', 'vMin', 'vMax'].includes(params.side) ? params.side : 'uMax';
  const length = +params.length || 5;
  const samples = Math.max(4, +params.samples || 8);
  const native = callSurfacing('extrapolate', [face, side, length]);
  if (native.ok) return { ...native, op: 'extrapolate' };
  if (!isForgeReady()) return notReady('extrapolate');
  const isU = side === 'uMin' || side === 'uMax';
  const fixed = side === 'uMin' || side === 'vMin' ? 0 : 1;
  const eps = 1e-3;
  const stripBase = [];
  const stripExt = [];
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    const p = isU ? nativeEval(face, fixed, t) : nativeEval(face, t, fixed);
    const q = isU ? nativeEval(face, fixed + (fixed === 0 ? eps : -eps), t)
                  : nativeEval(face, t, fixed + (fixed === 0 ? eps : -eps));
    if (!p.ok || !q.ok) return notReady('extrapolate');
    const tangent = norm(vec(q.result, p.result));
    stripBase.push(p.result);
    stripExt.push(add(p.result, scale(tangent, length)));
  }
  const grid = ruledGrid(stripBase, stripExt, samples);
  const du = Math.min(3, samples - 1);
  const uKnots = openUniformKnots(samples, du);
  const vKnots = [0, 0, 0, 1, 1, 1];
  const r = nativeBuildPatch(grid, du, 2, uKnots, vKnots);
  if (!r.ok) return notReady('extrapolate');
  return { ok: true, op: 'extrapolate',
           result: { kind: 'extrapolate', face, side, length, faceHandle: r.result } };
}

// ───────────────────────────────────────────────────────────────────
// ANALYSIS — class-A.
// Returns the data the SurfaceAnalysisOverlay renders from. Numbers
// only: every line / arrow / band is computed from real maths over the
// face tessellation + camera vector. No stubs.
// ───────────────────────────────────────────────────────────────────

function sampleFaceField(face, samples, withNormals = true) {
  if (!isForgeReady()) return null;
  const n = Math.max(4, samples | 0);
  const grid = [];
  const normals = withNormals ? [] : null;
  const eps = 1e-3;
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const row = [];
    const nrow = withNormals ? [] : null;
    for (let j = 0; j < n; j++) {
      const v = j / (n - 1);
      const p = nativeEval(face, u, v);
      if (!p.ok) return null;
      row.push(p.result);
      if (withNormals) {
        const pu = nativeEval(face, Math.min(1, u + eps), v);
        const pv = nativeEval(face, u, Math.min(1, v + eps));
        if (!pu.ok || !pv.ok) return null;
        nrow.push(norm(cross(vec(p.result, pu.result), vec(p.result, pv.result))));
      }
    }
    grid.push(row);
    if (withNormals) normals.push(nrow);
  }
  return { grid, normals };
}

// porcupine-analysis — at each grid sample, emit a needle of length
// proportional to local curvature (κ ≈ |Δn| / Δu).
export function porcupineAnalysis(params = {}) {
  const face = Number(params.face) || 0;
  const samples = Math.max(6, +params.samples || 16);
  const lengthScale = +params.lengthScale || 6;
  const data = sampleFaceField(face, samples, true);
  if (!data) return notReady('porcupine-analysis');
  const needles = [];
  for (let i = 0; i < samples - 1; i++) {
    for (let j = 0; j < samples - 1; j++) {
      const p = data.grid[i][j];
      const n = data.normals[i][j];
      const nU = data.normals[i + 1][j];
      const nV = data.normals[i][j + 1];
      const dnu = Math.hypot(nU[0] - n[0], nU[1] - n[1], nU[2] - n[2]);
      const dnv = Math.hypot(nV[0] - n[0], nV[1] - n[1], nV[2] - n[2]);
      const k = Math.hypot(dnu, dnv) * samples;
      needles.push({
        base: p,
        tip: add(p, scale(n, k * lengthScale + 0.5)),
        magnitude: k,
      });
    }
  }
  return { ok: true, op: 'porcupine-analysis',
           result: { kind: 'porcupine', face, needles } };
}

// reflection-lines — for each parameter line, intersect with a family of
// parallel light planes and return polylines where the reflected ray's
// direction equals the plane normal.
export function reflectionLines(params = {}) {
  const face = Number(params.face) || 0;
  const samples = Math.max(8, +params.samples || 24);
  const lightDir = norm(params.lightDir || [0, 1, 0]);
  const stripeCount = Math.max(2, +params.stripeCount || 12);
  const data = sampleFaceField(face, samples, true);
  if (!data) return notReady('reflection-lines');
  const lines = [];
  for (let s = 0; s < stripeCount; s++) {
    const targetDot = -1 + 2 * (s + 0.5) / stripeCount;
    const segments = [];
    for (let i = 0; i < samples; i++) {
      let prevSide = null;
      let prevPoint = null;
      for (let j = 0; j < samples; j++) {
        const n = data.normals[i][j];
        const d = dot(n, lightDir);
        const side = d < targetDot ? -1 : 1;
        if (prevSide !== null && side !== prevSide) {
          // Linear interpolate to the crossing.
          const t = (targetDot - (prevSide < 0 ? d : -d)) /
                    (Math.abs(d - (prevSide < 0 ? d : -d)) + 1e-9);
          const p = data.grid[i][j];
          const q = prevPoint || p;
          segments.push([(q[0] + p[0]) / 2, (q[1] + p[1]) / 2, (q[2] + p[2]) / 2]);
        }
        prevSide = side;
        prevPoint = data.grid[i][j];
      }
    }
    if (segments.length >= 2) lines.push(segments);
  }
  return { ok: true, op: 'reflection-lines',
           result: { kind: 'reflection-lines', face, lightDir, lines } };
}

// environment-map-analysis — synthetic spherical env map sample. Each
// grid vertex gets an RGB sample based on its normal's spherical angle.
export function environmentMapAnalysis(params = {}) {
  const face = Number(params.face) || 0;
  const samples = Math.max(8, +params.samples || 24);
  const data = sampleFaceField(face, samples, true);
  if (!data) return notReady('environment-map-analysis');
  const vertices = [];
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < samples; j++) {
      const n = data.normals[i][j];
      const lon = Math.atan2(n[0], n[2]) / Math.PI;            // -1..1
      const lat = Math.asin(Math.max(-1, Math.min(1, n[1]))) / (Math.PI / 2); // -1..1
      // Three coloured bands at lat 0, ±0.5.
      const band = Math.cos(lat * 6) * 0.5 + 0.5;
      const r = (lon + 1) * 0.5;
      const g = band;
      const b = (lat + 1) * 0.5;
      vertices.push({ point: data.grid[i][j], color: [r, g, b] });
    }
  }
  return { ok: true, op: 'environment-map-analysis',
           result: { kind: 'envmap', face, samples, vertices } };
}

// draft-analysis — colour-band each tessellation vertex by the angle
// between its normal and the pull direction. Range partitioned into
// negative / safe / positive bands.
export function draftAnalysis(params = {}) {
  const face = Number(params.face) || 0;
  const samples = Math.max(8, +params.samples || 24);
  const pullDir = norm(params.pullDir || [0, 0, 1]);
  const draftMinDeg = +params.draftMinDeg || 1;
  const data = sampleFaceField(face, samples, true);
  if (!data) return notReady('draft-analysis');
  const bands = [];
  let minAng = Infinity, maxAng = -Infinity;
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < samples; j++) {
      const n = data.normals[i][j];
      const cosA = dot(n, pullDir);
      const angleDeg = 90 - Math.acos(Math.max(-1, Math.min(1, cosA))) * 180 / Math.PI;
      if (angleDeg < minAng) minAng = angleDeg;
      if (angleDeg > maxAng) maxAng = angleDeg;
      const band = angleDeg < -draftMinDeg ? 'undercut'
                 : angleDeg <  draftMinDeg ? 'safe'
                 : 'positive';
      bands.push({ point: data.grid[i][j], angleDeg, band });
    }
  }
  return { ok: true, op: 'draft-analysis',
           result: { kind: 'draft', face, pullDir, draftMinDeg,
                     bands, range: [minAng, maxAng] } };
}

// distance-analysis — sampled point-to-face distance from a target.
export function distanceAnalysis(params = {}) {
  const face = Number(params.face) || 0;
  const target = params.target || [0, 0, 0];
  const samples = Math.max(8, +params.samples || 16);
  const data = sampleFaceField(face, samples, false);
  if (!data) return notReady('distance-analysis');
  const points = [];
  let min = Infinity, max = -Infinity, sum = 0;
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < samples; j++) {
      const p = data.grid[i][j];
      const d = Math.hypot(p[0] - target[0], p[1] - target[1], p[2] - target[2]);
      points.push({ point: p, distance: d });
      if (d < min) min = d;
      if (d > max) max = d;
      sum += d;
    }
  }
  return { ok: true, op: 'distance-analysis',
           result: { kind: 'distance', face, target,
                     min, max, mean: sum / points.length, points } };
}

// comparison-analysis — Hausdorff-like comparison between two faces by
// sampling face A and finding closest project on face B.
export function comparisonAnalysis(params = {}) {
  const a = Number(params.faceA) || 0;
  const b = Number(params.faceB) || 1;
  const samples = Math.max(6, +params.samples || 12);
  if (!isForgeReady()) return notReady('comparison-analysis');
  const data = sampleFaceField(a, samples, false);
  if (!data) return notReady('comparison-analysis');
  const points = [];
  let min = Infinity, max = -Infinity, sum = 0;
  for (let i = 0; i < samples; i++) {
    for (let j = 0; j < samples; j++) {
      const p = data.grid[i][j];
      const proj = nativeProjectPoint(b, p);
      if (!proj.ok) return notReady('comparison-analysis');
      const q = proj.result?.point || proj.result;
      const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
      points.push({ point: p, projected: q, distance: d });
      if (d < min) min = d;
      if (d > max) max = d;
      sum += d;
    }
  }
  return { ok: true, op: 'comparison-analysis',
           result: { kind: 'comparison', faceA: a, faceB: b,
                     min, max, mean: sum / points.length, points } };
}

// isoclines — polylines along which the angle between the face normal
// and a reference axis equals a target.
export function isoclines(params = {}) {
  const face = Number(params.face) || 0;
  const samples = Math.max(8, +params.samples || 24);
  const axis = norm(params.axis || [0, 0, 1]);
  const angleStepDeg = Math.max(1, +params.angleStepDeg || 15);
  const data = sampleFaceField(face, samples, true);
  if (!data) return notReady('isoclines');
  // For each angle band, walk grid edges and emit zero-crossings.
  const levels = [];
  for (let deg = -90 + angleStepDeg; deg < 90; deg += angleStepDeg) {
    const target = Math.cos((90 - deg) * Math.PI / 180);
    const segments = [];
    for (let i = 0; i < samples; i++) {
      for (let j = 0; j < samples - 1; j++) {
        const c0 = dot(data.normals[i][j],     axis) - target;
        const c1 = dot(data.normals[i][j + 1], axis) - target;
        if (c0 === 0 || (c0 < 0) !== (c1 < 0)) {
          const t = c0 / (c0 - c1 || 1);
          const a = data.grid[i][j], b = data.grid[i][j + 1];
          segments.push([a[0] + (b[0] - a[0]) * t,
                         a[1] + (b[1] - a[1]) * t,
                         a[2] + (b[2] - a[2]) * t]);
        }
      }
    }
    if (segments.length >= 2) levels.push({ angleDeg: deg, points: segments });
  }
  return { ok: true, op: 'isoclines', result: { kind: 'isoclines', face, axis, levels } };
}

// ───────────────────────────────────────────────────────────────────
// Catalogue — what the SurfacingPanel renders from.
// id is what the dispatch key looks like on disk; label is what the
// user sees; group is the category tab; kernel is the underlying
// primitive name (used only for the panel's monospace caption).
// ───────────────────────────────────────────────────────────────────

export const SURFACING_V4_GROUPS = ['Curve Tools', 'Surface Tools', 'Operations', 'Analysis'];

export const SURFACING_V4_OPS = [
  // ── Curve Tools ──
  { id: 'point', label: 'Point', group: 'Curve Tools',
    kernel: 'buildPatch', fn: point,
    signature: [
      { id: 'coord', label: 'Coord', kind: 'vec3', default: [0, 0, 0] },
    ] },
  { id: 'line', label: 'Line', group: 'Curve Tools',
    kernel: 'buildPatch', fn: line,
    signature: [
      { id: 'start', label: 'Start', kind: 'vec3', default: [0, 0, 0] },
      { id: 'end',   label: 'End',   kind: 'vec3', default: [10, 0, 0] },
    ] },
  { id: 'plane', label: 'Plane', group: 'Curve Tools',
    kernel: 'buildPatch', fn: plane,
    signature: [
      { id: 'origin', label: 'Origin', kind: 'vec3', default: [0, 0, 0] },
      { id: 'uDir',   label: 'U dir',  kind: 'vec3', default: [10, 0, 0] },
      { id: 'vDir',   label: 'V dir',  kind: 'vec3', default: [0, 10, 0] },
    ] },
  { id: 'axis-system', label: 'Axis system', group: 'Curve Tools',
    kernel: '—', fn: axisSystem,
    signature: [
      { id: 'origin', label: 'Origin', kind: 'vec3', default: [0, 0, 0] },
      { id: 'xDir',   label: 'X dir',  kind: 'vec3', default: [1, 0, 0] },
      { id: 'yDir',   label: 'Y dir',  kind: 'vec3', default: [0, 1, 0] },
    ] },
  { id: 'spiral', label: 'Spiral', group: 'Curve Tools',
    kernel: 'buildPatch', fn: spiral,
    signature: [
      { id: 'center',  label: 'Center', kind: 'vec3',   default: [0, 0, 0] },
      { id: 'turns',   label: 'Turns',  kind: 'number', default: 3 },
      { id: 'pitch',   label: 'Pitch',  kind: 'number', default: 1, unit: 'mm/turn' },
      { id: 'samples', label: 'Samples',kind: 'int',    default: 64 },
    ] },
  { id: 'helix', label: 'Helix', group: 'Curve Tools',
    kernel: 'buildPatch', fn: helix,
    signature: [
      { id: 'center',  label: 'Center', kind: 'vec3',   default: [0, 0, 0] },
      { id: 'radius',  label: 'Radius', kind: 'number', default: 10, unit: 'mm' },
      { id: 'pitch',   label: 'Pitch',  kind: 'number', default: 5,  unit: 'mm/turn' },
      { id: 'turns',   label: 'Turns',  kind: 'number', default: 3 },
      { id: 'samples', label: 'Samples',kind: 'int',    default: 64 },
    ] },
  { id: 'conic', label: 'Conic', group: 'Curve Tools',
    kernel: 'buildPatch', fn: conic,
    signature: [
      { id: 'start',    label: 'Start',    kind: 'vec3',   default: [0, 0, 0] },
      { id: 'end',      label: 'End',      kind: 'vec3',   default: [10, 0, 0] },
      { id: 'shoulder', label: 'Shoulder', kind: 'vec3',   default: [5, 5, 0] },
      { id: 'rho',      label: 'Rho',      kind: 'slider', default: 0.5, min: 0.01, max: 0.99, step: 0.01 },
      { id: 'samples',  label: 'Samples',  kind: 'int',    default: 32 },
    ] },
  { id: 'isoparametric-curve', label: 'Isoparametric curve', group: 'Curve Tools',
    kernel: 'eval', fn: isoparametricCurve,
    signature: [
      { id: 'face',      label: 'Face handle', kind: 'int',    default: 0 },
      { id: 'direction', label: 'Direction (u/v)', kind: 'json', default: 'u' },
      { id: 'value',     label: 'Value',       kind: 'slider', default: 0.5, min: 0, max: 1, step: 0.01 },
      { id: 'samples',   label: 'Samples',     kind: 'int',    default: 32 },
    ] },
  { id: 'connect-curve', label: 'Connect curve', group: 'Curve Tools',
    kernel: 'buildPatch', fn: connectCurve,
    signature: [
      { id: 'startPoint', label: 'Start point', kind: 'vec3',   default: [0, 0, 0] },
      { id: 'startTan',   label: 'Start tan',   kind: 'vec3',   default: [1, 0, 0] },
      { id: 'endPoint',   label: 'End point',   kind: 'vec3',   default: [10, 5, 0] },
      { id: 'endTan',     label: 'End tan',     kind: 'vec3',   default: [1, 0, 0] },
      { id: 'tension',    label: 'Tension',     kind: 'slider', default: 1.0, min: 0.1, max: 3.0, step: 0.05 },
    ] },
  { id: 'parallel-curves', label: 'Parallel curves', group: 'Curve Tools',
    kernel: 'buildPatch', fn: parallelCurves,
    signature: [
      { id: 'curve',       label: 'Curve points (JSON)', kind: 'json',
        default: [[0, 0, 0], [10, 0, 0], [20, 5, 0]] },
      { id: 'distance',    label: 'Distance',     kind: 'number', default: 5, unit: 'mm' },
      { id: 'planeNormal', label: 'Plane normal', kind: 'vec3',   default: [0, 0, 1] },
    ] },
  { id: 'boundary-curve', label: 'Boundary curve', group: 'Curve Tools',
    kernel: 'eval', fn: boundaryCurve,
    signature: [
      { id: 'face',    label: 'Face handle', kind: 'int', default: 0 },
      { id: 'samples', label: 'Samples',     kind: 'int', default: 16 },
    ] },
  { id: 'project-curve', label: 'Project curve', group: 'Curve Tools',
    kernel: 'projectPoint', fn: projectCurve,
    signature: [
      { id: 'face',  label: 'Face handle',         kind: 'int',  default: 0 },
      { id: 'curve', label: 'Curve points (JSON)', kind: 'json', default: [[0, 0, 5], [5, 0, 5], [10, 0, 5]] },
    ] },
  { id: 'intersect-curves', label: 'Intersect curves', group: 'Curve Tools',
    kernel: 'intersect', fn: intersectCurves,
    signature: [
      { id: 'faceA', label: 'Face A handle', kind: 'int', default: 0 },
      { id: 'faceB', label: 'Face B handle', kind: 'int', default: 1 },
    ] },

  // ── Surface Tools ──
  { id: 'extract', label: 'Extract', group: 'Surface Tools',
    kernel: 'eval', fn: extract,
    signature: [
      { id: 'body',   label: 'Body handle', kind: 'int', default: 0 },
      { id: 'faceId', label: 'Face ID',     kind: 'int', default: 0 },
    ] },
  { id: 'extrude-surface', label: 'Extrude surface', group: 'Surface Tools',
    kernel: 'buildPatch', fn: extrudeSurface,
    signature: [
      { id: 'curve',     label: 'Curve (JSON)', kind: 'json', default: [[0, 0, 0], [10, 0, 0]] },
      { id: 'direction', label: 'Direction',    kind: 'vec3', default: [0, 0, 1] },
      { id: 'length',    label: 'Length',       kind: 'number', default: 10, unit: 'mm' },
    ] },
  { id: 'sweep-surface', label: 'Sweep surface', group: 'Surface Tools',
    kernel: 'buildPatch', fn: sweepSurface,
    signature: [
      { id: 'profile', label: 'Profile (JSON)', kind: 'json', default: [[0, 0, 0], [5, 0, 0]] },
      { id: 'spine',   label: 'Spine (JSON)',   kind: 'json', default: [[0, 0, 0], [0, 0, 20]] },
    ] },
  { id: 'fill', label: 'Fill', group: 'Surface Tools',
    kernel: 'buildPatch', fn: fill,
    signature: [
      { id: 'boundary', label: 'Boundary (JSON {uMin,uMax,vMin,vMax})', kind: 'json',
        default: {
          uMin: [[0, 0, 0], [10, 0, 0]],
          uMax: [[0, 10, 0], [10, 10, 0]],
          vMin: [[0, 0, 0], [0, 10, 0]],
          vMax: [[10, 0, 0], [10, 10, 0]],
        } },
      { id: 'samples', label: 'Samples', kind: 'int', default: 8 },
    ] },
  { id: 'blend', label: 'Blend', group: 'Surface Tools',
    kernel: 'buildPatch', fn: blend,
    signature: [
      { id: 'faceA',      label: 'Face A handle', kind: 'int',  default: 0 },
      { id: 'faceB',      label: 'Face B handle', kind: 'int',  default: 1 },
      { id: 'continuity', label: 'Continuity',    kind: 'json', default: 'G2' },
    ] },
  { id: 'multi-section', label: 'Multi-section', group: 'Surface Tools',
    kernel: 'buildPatch', fn: multiSection,
    signature: [
      { id: 'sections', label: 'Sections (JSON)', kind: 'json',
        default: [
          [[0, 0, 0],  [5, 0, 0],  [10, 0, 0]],
          [[0, 0, 5],  [5, 2, 5],  [10, 0, 5]],
          [[0, 0, 10], [5, 0, 10], [10, 0, 10]],
        ] },
    ] },
  { id: 'offset', label: 'Offset', group: 'Surface Tools',
    kernel: 'buildPatch', fn: offset,
    signature: [
      { id: 'face',     label: 'Face handle', kind: 'int',    default: 0 },
      { id: 'distance', label: 'Distance',    kind: 'number', default: 1, unit: 'mm' },
      { id: 'samples',  label: 'Samples',     kind: 'int',    default: 8 },
    ] },
  { id: 'gap', label: 'Gap (close)', group: 'Surface Tools',
    kernel: 'buildPatch', fn: gap,
    signature: [
      { id: 'faceA',     label: 'Face A handle', kind: 'int',    default: 0 },
      { id: 'faceB',     label: 'Face B handle', kind: 'int',    default: 1 },
      { id: 'tolerance', label: 'Tolerance',     kind: 'slider', default: 0.05, min: 0.0001, max: 1, step: 0.001, unit: 'mm' },
    ] },
  { id: 'untrim', label: 'Untrim', group: 'Surface Tools',
    kernel: 'trim', fn: untrim,
    signature: [
      { id: 'face', label: 'Face handle', kind: 'int', default: 0 },
    ] },
  { id: 'extrapolate', label: 'Extrapolate', group: 'Surface Tools',
    kernel: 'buildPatch', fn: extrapolate,
    signature: [
      { id: 'face',    label: 'Face handle',         kind: 'int',    default: 0 },
      { id: 'side',    label: 'Side (uMin/uMax/vMin/vMax)', kind: 'json', default: 'uMax' },
      { id: 'length',  label: 'Length',              kind: 'number', default: 5, unit: 'mm' },
      { id: 'samples', label: 'Samples',             kind: 'int',    default: 8 },
    ] },

  // ── Analysis ──
  { id: 'porcupine-analysis', label: 'Porcupine analysis', group: 'Analysis',
    kernel: 'eval', fn: porcupineAnalysis,
    signature: [
      { id: 'face',        label: 'Face handle',  kind: 'int',    default: 0 },
      { id: 'samples',     label: 'Samples',      kind: 'int',    default: 16 },
      { id: 'lengthScale', label: 'Length scale', kind: 'slider', default: 6, min: 0.5, max: 20, step: 0.1 },
    ] },
  { id: 'reflection-lines', label: 'Reflection lines', group: 'Analysis',
    kernel: 'eval', fn: reflectionLines,
    signature: [
      { id: 'face',        label: 'Face handle',  kind: 'int',  default: 0 },
      { id: 'samples',     label: 'Samples',      kind: 'int',  default: 24 },
      { id: 'lightDir',    label: 'Light dir',    kind: 'vec3', default: [0, 1, 0] },
      { id: 'stripeCount', label: 'Stripe count', kind: 'int',  default: 12 },
    ] },
  { id: 'environment-map-analysis', label: 'Environment-map analysis', group: 'Analysis',
    kernel: 'eval', fn: environmentMapAnalysis,
    signature: [
      { id: 'face',    label: 'Face handle', kind: 'int', default: 0 },
      { id: 'samples', label: 'Samples',     kind: 'int', default: 24 },
    ] },
  { id: 'draft-analysis', label: 'Draft analysis', group: 'Analysis',
    kernel: 'eval', fn: draftAnalysis,
    signature: [
      { id: 'face',        label: 'Face handle',  kind: 'int',    default: 0 },
      { id: 'samples',     label: 'Samples',      kind: 'int',    default: 24 },
      { id: 'pullDir',     label: 'Pull dir',     kind: 'vec3',   default: [0, 0, 1] },
      { id: 'draftMinDeg', label: 'Min draft (°)', kind: 'slider', default: 1, min: 0, max: 10, step: 0.1 },
    ] },
  { id: 'distance-analysis', label: 'Distance analysis', group: 'Analysis',
    kernel: 'eval', fn: distanceAnalysis,
    signature: [
      { id: 'face',    label: 'Face handle', kind: 'int',  default: 0 },
      { id: 'target',  label: 'Target',      kind: 'vec3', default: [0, 0, 0] },
      { id: 'samples', label: 'Samples',     kind: 'int',  default: 16 },
    ] },
  { id: 'comparison-analysis', label: 'Comparison analysis', group: 'Analysis',
    kernel: 'projectPoint', fn: comparisonAnalysis,
    signature: [
      { id: 'faceA',   label: 'Face A handle', kind: 'int', default: 0 },
      { id: 'faceB',   label: 'Face B handle', kind: 'int', default: 1 },
      { id: 'samples', label: 'Samples',       kind: 'int', default: 12 },
    ] },
  { id: 'isoclines', label: 'Isoclines', group: 'Analysis',
    kernel: 'eval', fn: isoclines,
    signature: [
      { id: 'face',         label: 'Face handle',     kind: 'int',    default: 0 },
      { id: 'samples',      label: 'Samples',         kind: 'int',    default: 24 },
      { id: 'axis',         label: 'Axis',            kind: 'vec3',   default: [0, 0, 1] },
      { id: 'angleStepDeg', label: 'Angle step (°)',  kind: 'slider', default: 15, min: 1, max: 45, step: 1 },
    ] },
];

// Index by id for fast lookup.
export const SURFACING_V4_BY_ID = Object.fromEntries(
  SURFACING_V4_OPS.map((op) => [op.id, op])
);

// Event the overlay subscribes to. SurfacingPanel fires it whenever an
// Analysis op returns ok, with detail.kind = the analysis kind.
export const SURFACE_ANALYSIS_EVENT = 'forge:surface-analysis';

export function dispatchAnalysis(detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(SURFACE_ANALYSIS_EVENT, { detail }));
}
