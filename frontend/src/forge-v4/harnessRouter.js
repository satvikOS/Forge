// Forge-168 — Harness router.
//
// Catmull-Rom spline routing of cables through user-specified
// waypoints, with real minimum-bend-radius enforcement per cable
// spec (cableLibrary.bendRadiusFor). The router also auto-bundles
// cables that share a path segment — bundle OD is the equivalent
// outer diameter from random round-rod packing.
//
// Inputs:
//   - cables:   [{ id, cableId, fromConnectorId, toConnectorId,
//                  waypoints: [[x,y,z], …] }, …]   (m)
//   - bundleStrategy: 'auto' | 'none'
//
// Outputs:
//   - routes: [{ id, cableId, polyline: [[x,y,z],…], length_m,
//                minRadius_m, violations: [{at,index,r}], bundleId? }]
//   - bundles: [{ id, cableIds, polyline, bundleOD_mm, length_m }]

import { bendRadiusFor, bundleOD_mm } from './cableLibrary.js';

// ─────────────────────────────────────────────────────────────────────
// Catmull-Rom spline (centripetal variant for tension-free splines)
// per Barry & Goldman 1988.  alpha = 0.5 (centripetal).
// ─────────────────────────────────────────────────────────────────────

/**
 * Build a centripetal Catmull-Rom polyline through `points` (>=2).
 * Returns N sampled points along the spline; sample density is
 * `samplesPerSegment` per (P_i, P_i+1) pair.
 */
export function catmullRomSpline(points, samplesPerSegment = 24) {
  if (!Array.isArray(points) || points.length < 2) return [];
  // Pad endpoints by reflection so first/last segment is splined too.
  const pts = [
    reflect(points[0], points[1]),
    ...points,
    reflect(points[points.length - 1], points[points.length - 2]),
  ];
  const out = [];
  for (let i = 1; i < pts.length - 2; i++) {
    const P0 = pts[i - 1], P1 = pts[i], P2 = pts[i + 1], P3 = pts[i + 2];
    const alpha = 0.5;  // centripetal
    const t0 = 0;
    const t1 = t0 + Math.pow(dist(P0, P1), alpha);
    const t2 = t1 + Math.pow(dist(P1, P2), alpha);
    const t3 = t2 + Math.pow(dist(P2, P3), alpha);
    for (let s = 0; s <= samplesPerSegment; s++) {
      // Avoid duplicate endpoints across segments.
      if (i > 1 && s === 0) continue;
      const t = t1 + (s / samplesPerSegment) * (t2 - t1);
      out.push(catmullRomPoint(P0, P1, P2, P3, t0, t1, t2, t3, t));
    }
  }
  return out;
}

function reflect(a, b) {
  return [2*a[0] - b[0], 2*a[1] - b[1], 2*a[2] - b[2]];
}
function dist(a, b) {
  const dx = a[0]-b[0], dy = a[1]-b[1], dz = a[2]-b[2];
  return Math.hypot(dx, dy, dz);
}
function catmullRomPoint(P0, P1, P2, P3, t0, t1, t2, t3, t) {
  const A1 = lerp(P0, P1, (t1 - t) / (t1 - t0), (t - t0) / (t1 - t0));
  const A2 = lerp(P1, P2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1));
  const A3 = lerp(P2, P3, (t3 - t) / (t3 - t2), (t - t2) / (t3 - t2));
  const B1 = lerp(A1, A2, (t2 - t) / (t2 - t0), (t - t0) / (t2 - t0));
  const B2 = lerp(A2, A3, (t3 - t) / (t3 - t1), (t - t1) / (t3 - t1));
  return lerp(B1, B2, (t2 - t) / (t2 - t1), (t - t1) / (t2 - t1));
}
function lerp(P, Q, wp, wq) {
  return [P[0]*wp + Q[0]*wq, P[1]*wp + Q[1]*wq, P[2]*wp + Q[2]*wq];
}

// ─────────────────────────────────────────────────────────────────────
// Bend-radius analysis — for a polyline, the local radius of curvature
// at vertex i is approximated by the radius of the circumscribed
// circle through (P_{i-1}, P_i, P_{i+1}).  Formula:
//   r = (|a| · |b| · |c|) / (4 · A)
// where a = P_{i-1}P_i, b = P_iP_{i+1}, c = P_{i-1}P_{i+1}, A is the
// triangle area (Heron's).
// ─────────────────────────────────────────────────────────────────────

export function localBendRadii_m(polyline) {
  const r = new Array(polyline.length).fill(Infinity);
  for (let i = 1; i < polyline.length - 1; i++) {
    const P0 = polyline[i - 1];
    const P1 = polyline[i];
    const P2 = polyline[i + 1];
    const a = dist(P0, P1);
    const b = dist(P1, P2);
    const c = dist(P0, P2);
    const s = (a + b + c) / 2;
    const A2 = s * (s - a) * (s - b) * (s - c);
    const A = A2 > 0 ? Math.sqrt(A2) : 0;
    r[i] = A > 1e-9 ? (a * b * c) / (4 * A) : Infinity;
  }
  return r;
}

export function polylineLength_m(polyline) {
  let L = 0;
  for (let i = 1; i < polyline.length; i++) L += dist(polyline[i - 1], polyline[i]);
  return L;
}

// ─────────────────────────────────────────────────────────────────────
// Route a single cable through its waypoints.
// ─────────────────────────────────────────────────────────────────────

export function routeCable(cable, opts = {}) {
  const waypoints = cable.waypoints || [];
  const samples = opts.samplesPerSegment ?? 24;
  if (waypoints.length < 2) {
    return {
      id: cable.id,
      cableId: cable.cableId,
      polyline: [],
      length_m: 0,
      minRadius_m: Infinity,
      requiredRadius_m: bendRadiusFor(cable.cableId),
      violations: [],
      ok: false,
      error: 'Need at least 2 waypoints',
    };
  }
  const polyline = waypoints.length === 2
    ? sampleLine(waypoints[0], waypoints[1], samples)
    : catmullRomSpline(waypoints, samples);

  const radii = localBendRadii_m(polyline);
  const required = bendRadiusFor(cable.cableId);
  const violations = [];
  let minR = Infinity;
  for (let i = 1; i < radii.length - 1; i++) {
    const r = radii[i];
    if (r < minR) minR = r;
    if (r < required) {
      violations.push({ at: polyline[i].slice(), index: i, r_m: r });
    }
  }
  return {
    id: cable.id,
    cableId: cable.cableId,
    fromConnectorId: cable.fromConnectorId,
    toConnectorId: cable.toConnectorId,
    polyline,
    length_m: polylineLength_m(polyline),
    minRadius_m: minR,
    requiredRadius_m: required,
    violations,
    ok: violations.length === 0,
  };
}

function sampleLine(A, B, n) {
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    out.push([
      A[0] * (1 - t) + B[0] * t,
      A[1] * (1 - t) + B[1] * t,
      A[2] * (1 - t) + B[2] * t,
    ]);
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Bundle detection — cables that share *all* their waypoints in
// order (or in reverse) are auto-bundled. We hash the waypoint list
// to group cables; reverse-order matches are also grouped.
// ─────────────────────────────────────────────────────────────────────

function waypointKey(wps) {
  return wps.map((p) => `${rnd(p[0])},${rnd(p[1])},${rnd(p[2])}`).join('|');
}
function rnd(x) { return Math.round(x * 1e6) / 1e6; }

function reverseKey(wps) {
  return waypointKey(wps.slice().reverse());
}

export function detectBundles(cables) {
  const groups = new Map();
  for (const c of cables) {
    const k = waypointKey(c.waypoints || []);
    const kr = reverseKey(c.waypoints || []);
    const key = groups.has(k) ? k : (groups.has(kr) ? kr : k);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  const bundles = [];
  let bidx = 0;
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    bidx += 1;
    bundles.push({
      id: `bundle-${bidx}`,
      cableIds: group.map((c) => c.id),
      cableTypes: group.map((c) => c.cableId),
      bundleOD_mm: bundleOD_mm(group.map((c) => c.cableId)),
    });
  }
  return bundles;
}

// ─────────────────────────────────────────────────────────────────────
// Full harness routing — runs each cable then applies bundle grouping
// and tightens the bundle's effective bend radius (= max of any
// constituent cable's requirement).
// ─────────────────────────────────────────────────────────────────────

export function routeHarness(cables, opts = {}) {
  const routes = cables.map((c) => routeCable(c, opts));
  const bundleStrategy = opts.bundleStrategy ?? 'auto';
  const bundles = bundleStrategy === 'auto' ? detectBundles(cables) : [];

  // Annotate routes with bundle membership.
  const cableToBundle = new Map();
  for (const b of bundles) {
    for (const cid of b.cableIds) cableToBundle.set(cid, b.id);
  }
  for (const r of routes) {
    const bid = cableToBundle.get(r.id);
    if (bid) r.bundleId = bid;
  }

  // For each bundle, compute the strictest required radius across its
  // member cables and re-check the route against it.
  for (const b of bundles) {
    const memberCables = cables.filter((c) => b.cableIds.includes(c.id));
    const strictReqR = Math.max(...memberCables.map((c) => bendRadiusFor(c.cableId)));
    b.requiredRadius_m = strictReqR;
    // Pick the canonical polyline from the first member.
    const first = routes.find((r) => r.id === b.cableIds[0]);
    b.polyline  = first?.polyline?.slice() || [];
    b.length_m  = first?.length_m || 0;
    // Bundle-level violations.
    const radii = localBendRadii_m(b.polyline);
    let minR = Infinity;
    const violations = [];
    for (let i = 1; i < radii.length - 1; i++) {
      const r = radii[i];
      if (r < minR) minR = r;
      if (r < strictReqR) violations.push({ at: b.polyline[i].slice(), index: i, r_m: r });
    }
    b.minRadius_m  = minR;
    b.violations   = violations;
    b.ok           = violations.length === 0;
  }

  // Cut-list summary.
  const cutList = routes.map((r) => ({
    id: r.id,
    cableId: r.cableId,
    length_m: r.length_m,
    length_mm: r.length_m * 1000,
    fromConnectorId: r.fromConnectorId,
    toConnectorId: r.toConnectorId,
    bundleId: r.bundleId || null,
    ok: r.ok,
    minRadius_mm: r.minRadius_m === Infinity ? null : r.minRadius_m * 1000,
    requiredRadius_mm: r.requiredRadius_m * 1000,
    violationCount: r.violations.length,
  }));

  return { routes, bundles, cutList };
}
