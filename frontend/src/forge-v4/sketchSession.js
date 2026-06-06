// Forge-85 — sketcher session state machine.
//
// Wraps window.forge.sketcher.* so the UI can build a real 2D sketch with
// point/line/circle/arc entities + constraints, solve it, and hand the
// resulting handle to part.extrudeProfile / part.revolveProfile / part.sweep.
//
// A session has one OCCT sketch handle plus mirrored JS state used by the
// viewport to draw the sketch entities at the right world position (sketcher
// works in plane-local 2D; the viewport needs a 3D transform).

const PLANES = {
  XY: { origin: [0, 0, 0], normal: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  YZ: { origin: [0, 0, 0], normal: [1, 0, 0], u: [0, 1, 0], v: [0, 0, 1] },
  XZ: { origin: [0, 0, 0], normal: [0, 1, 0], u: [1, 0, 0], v: [0, 0, 1] },
};

// Sketch-on-face (#216) — derive a full orthonormal plane frame
// {origin, normal, u, v} from a named world plane OR a custom face-derived
// frame. A custom frame is any object carrying at least {origin, normal};
// u/v are synthesised when absent so the viewport overlay and the kernel
// agree on the same basis.
function normalize3(a) {
  const m = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / m, a[1] / m, a[2] / m];
}
function cross3(a, b) {
  return [a[1] * b[2] - a[2] * b[1],
          a[2] * b[0] - a[0] * b[2],
          a[0] * b[1] - a[1] * b[0]];
}
function dot3(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }

// Build a stable {origin,normal,u,v} frame from a partial spec. Mirrors the
// kernel's extrudeProfileOnPlane orthonormalisation so JS overlay lift and
// the OCCT placement land in exactly the same spot.
export function frameFromSpec(spec) {
  const origin = spec.origin || [0, 0, 0];
  const normal = normalize3(spec.normal || [0, 0, 1]);
  let u = spec.u;
  if (!u || Math.hypot(...cross3(u, normal)) < 1e-7) {
    const ax = Math.abs(normal[0]), ay = Math.abs(normal[1]), az = Math.abs(normal[2]);
    const seed = (ax <= ay && ax <= az) ? [1, 0, 0]
               : (ay <= az)             ? [0, 1, 0]
                                        : [0, 0, 1];
    const d = dot3(seed, normal);
    u = [seed[0] - normal[0] * d, seed[1] - normal[1] * d, seed[2] - normal[2] * d];
  } else {
    const d = dot3(u, normal);
    u = [u[0] - normal[0] * d, u[1] - normal[1] * d, u[2] - normal[2] * d];
  }
  u = normalize3(u);
  const v = cross3(normal, u); // right-handed, matches gp_Ax3(origin, n, u)
  return { origin, normal, u, v };
}

// Resolve a sketch session's plane (named string OR custom frame object)
// to a full frame for lifting/extruding.
function planeFrame(plane) {
  if (plane && typeof plane === 'object') return frameFromSpec(plane);
  return PLANES[plane] || PLANES.XY;
}

function lift(pt2, plane) {
  const [u, v] = pt2;
  const p = planeFrame(plane);
  return [
    p.origin[0] + p.u[0] * u + p.v[0] * v,
    p.origin[1] + p.u[1] * u + p.v[1] * v,
    p.origin[2] + p.u[2] * u + p.v[2] * v,
  ];
}

// Public: resolve a session's plane to its world frame {origin,normal,u,v}.
// Used by the extrude path to call part.extrudeProfileOnPlane so a
// face-placed sketch produces a solid on that face (not world Z=0).
export function planeFrameOf(session) {
  return planeFrame(session?.plane);
}

// Public: true when the session is sketched on a custom (face-derived)
// plane rather than a named world plane. World XY can use the simple
// extrudeProfile path; everything else must use extrudeProfileOnPlane.
export function isCustomPlane(session) {
  return !!session && typeof session.plane === 'object' && session.plane !== null;
}

// Sketch-on-face (#216) — derive a sketch plane frame from a kernel body's
// face. `faceId` is the 1-based OCCT face index; when omitted we auto-pick
// the body's TOP face (planar, normal closest to +Z, highest centroid Z) —
// the deck-plate-top workflow the user called out. Returns a frame spec
// {origin, normal, u} ready to pass to openSession, or null if the body has
// no usable planar face / the kernel introspection is unavailable.
export function deriveFacePlane(bodyHandle, faceId = null) {
  if (typeof window === 'undefined' || !window.forge?.direct?.inferFeature) return null;
  const D = window.forge.direct;
  try {
    if (faceId != null) {
      const fi = D.inferFeature(bodyHandle, faceId);
      if (!fi || !fi.normal) return null;
      return { origin: fi.centroid, normal: fi.normal, faceId };
    }
    const n = D.faceCount(bodyHandle);
    let best = null, bestScore = -Infinity;
    for (let i = 1; i <= n; i++) {
      let fi;
      try { fi = D.inferFeature(bodyHandle, i); } catch { continue; }
      if (!fi || (fi.label && !/planar/i.test(fi.label))) continue;
      // Prefer faces whose normal points up (+Z) and that sit highest.
      const upDot = fi.normal[2];                 // alignment with +Z
      const score = upDot * 1000 + fi.centroid[2]; // up-facing then highest
      if (upDot > 0.5 && score > bestScore) { bestScore = score; best = { fi, i }; }
    }
    if (!best) return null;
    return { origin: best.fi.centroid, normal: best.fi.normal, faceId: best.i };
  } catch {
    return null;
  }
}

function hasSketcher() {
  return typeof window !== 'undefined' && window.forge && window.forge.sketcher &&
         typeof window.forge.sketcher.createSketch === 'function';
}

let _sid = 0;
function nextId() { return `sk-${++_sid}`; }

export function openSession(plane = 'XY') {
  const session = {
    id: nextId(),
    plane,
    kernel: null,         // OCCT handle when sketcher is available
    points: [],           // { id, pid?, x, y }
    edges: [],            // { id, kind, pts: [pidA, pidB], extra? }
    constraints: [],      // { id, kind, refs, value? }
    status: 'open',
  };
  if (hasSketcher()) {
    try {
      session.kernel = window.forge.sketcher.createSketch();
    } catch (err) {
      console.warn('[forge.v4.sketch] createSketch failed:', err.message);
    }
  }
  return session;
}

export function addPoint(session, x, y) {
  const ptId = `p-${session.points.length}`;
  let pid = null;
  if (hasSketcher() && session.kernel != null) {
    try { pid = window.forge.sketcher.addPoint(session.kernel, x, y); }
    catch (err) { console.warn('[forge.v4.sketch] addPoint:', err.message); }
  }
  session.points.push({ id: ptId, pid, x, y });
  return ptId;
}

function pidOf(session, ptId) {
  const p = session.points.find((q) => q.id === ptId);
  return p ? p.pid : null;
}

export function addLine(session, x0, y0, x1, y1) {
  const a = addPoint(session, x0, y0);
  const b = addPoint(session, x1, y1);
  const id = `e-${session.edges.length}`;
  if (hasSketcher() && session.kernel != null) {
    try { window.forge.sketcher.addLine(session.kernel, pidOf(session, a), pidOf(session, b)); }
    catch (err) { console.warn('[forge.v4.sketch] addLine:', err.message); }
  }
  session.edges.push({ id, kind: 'line', pts: [a, b] });
  return id;
}

export function addRect(session, cx, cy, w, h) {
  // Adds four lines forming a closed rectangle, returns the four edge ids.
  const x0 = cx - w / 2, y0 = cy - h / 2, x1 = cx + w / 2, y1 = cy + h / 2;
  const a = addLine(session, x0, y0, x1, y0);
  const b = addLine(session, x1, y0, x1, y1);
  const c = addLine(session, x1, y1, x0, y1);
  const d = addLine(session, x0, y1, x0, y0);
  return [a, b, c, d];
}

export function addCircle(session, cx, cy, r) {
  const ctr = addPoint(session, cx, cy);
  const id = `e-${session.edges.length}`;
  if (hasSketcher() && session.kernel != null) {
    try { window.forge.sketcher.addCircle(session.kernel, pidOf(session, ctr), r); }
    catch (err) { console.warn('[forge.v4.sketch] addCircle:', err.message); }
  }
  session.edges.push({ id, kind: 'circle', pts: [ctr], r });
  return id;
}

export function addArc(session, cx, cy, x0, y0, x1, y1) {
  const ctr = addPoint(session, cx, cy);
  const p0  = addPoint(session, x0, y0);
  const p1  = addPoint(session, x1, y1);
  const id  = `e-${session.edges.length}`;
  if (hasSketcher() && session.kernel != null) {
    try { window.forge.sketcher.addArc(session.kernel, pidOf(session, ctr),
                                       pidOf(session, p0), pidOf(session, p1)); }
    catch (err) { console.warn('[forge.v4.sketch] addArc:', err.message); }
  }
  session.edges.push({ id, kind: 'arc', pts: [ctr, p0, p1] });
  return id;
}

export function addPolygon(session, cx, cy, sides, r) {
  const ids = [];
  let prev = null;
  let first = null;
  for (let i = 0; i < sides; i++) {
    const ang = (2 * Math.PI * i) / sides - Math.PI / 2;
    const px = cx + r * Math.cos(ang);
    const py = cy + r * Math.sin(ang);
    if (prev) {
      const eid = addLine(session, prev[0], prev[1], px, py);
      ids.push(eid);
    } else {
      first = [px, py];
    }
    prev = [px, py];
  }
  if (prev && first) {
    ids.push(addLine(session, prev[0], prev[1], first[0], first[1]));
  }
  return ids;
}

export function addSpline(session, points) {
  // Native sketcher has no spline primitive; mirror as a polyline so the
  // viewport renders the user's intent. Future kernel slice can swap in
  // a real B-spline edge.
  const ids = [];
  for (let i = 0; i < points.length - 1; i++) {
    ids.push(addLine(session, points[i][0], points[i][1],
                              points[i+1][0], points[i+1][1]));
  }
  return ids;
}

const KIND_BY_NAME = {
  Coincident: 0, Horizontal: 1, Vertical: 2, Parallel: 3, Perpendicular: 4,
  Tangent: 5, Concentric: 6, Equal: 7, Symmetric: 8, Fix: 9, Midpoint: 10,
  Distance: 11, Angle: 12, Radius: 13,
};

export function addConstraint(session, kindName, refs, value) {
  const kind = KIND_BY_NAME[kindName] ?? 0;
  if (hasSketcher() && session.kernel != null) {
    try { window.forge.sketcher.addConstraint(session.kernel, kind, refs, value); }
    catch (err) { console.warn('[forge.v4.sketch] addConstraint:', err.message); }
  }
  const id = `c-${session.constraints.length}`;
  session.constraints.push({ id, kind: kindName, refs, value });
  return id;
}

export function solveSession(session) {
  if (hasSketcher() && session.kernel != null) {
    try {
      const status = window.forge.sketcher.solve(session.kernel);
      session.status = status === 0 ? 'solved' : 'failed';
      // Pull updated point positions back into JS state.
      for (const p of session.points) {
        if (p.pid != null) {
          try {
            const r = window.forge.sketcher.readPoint(session.kernel, p.pid);
            if (r) { p.x = r.x; p.y = r.y; }
          } catch {}
        }
      }
    } catch (err) {
      console.warn('[forge.v4.sketch] solve:', err.message);
      session.status = 'failed';
    }
  } else {
    session.status = 'solved';
  }
  return session.status;
}

export function destroySession(session) {
  if (hasSketcher() && session.kernel != null) {
    try { window.forge.sketcher.destroySketch(session.kernel); }
    catch (err) { console.warn('[forge.v4.sketch] destroy:', err.message); }
  }
  session.kernel = null;
}

export function dof(session) {
  // Each free point contributes 2 DOF, each constraint removes ≈1 (Distance
  // ≈1, Coincident ≈2, etc). This is a useful estimate for the badge.
  const free = session.points.length * 2;
  const reduced = session.constraints.reduce((acc, c) => {
    if (c.kind === 'Coincident') return acc + 2;
    if (c.kind === 'Fix') return acc + 2;
    return acc + 1;
  }, 0);
  return Math.max(0, free - reduced);
}

/** Lift the in-progress sketch entities to 3D positions for the viewport. */
export function entityWorldGeometry(session) {
  const out = { lines: [], circles: [], arcs: [] };
  for (const e of session.edges) {
    if (e.kind === 'line') {
      const [a, b] = e.pts.map((id) => session.points.find((p) => p.id === id));
      if (a && b) {
        out.lines.push({
          id: e.id,
          a: lift([a.x, a.y], session.plane),
          b: lift([b.x, b.y], session.plane),
        });
      }
    } else if (e.kind === 'circle') {
      const c = session.points.find((p) => p.id === e.pts[0]);
      if (c) {
        out.circles.push({
          id: e.id,
          center: lift([c.x, c.y], session.plane),
          r: e.r,
          plane: session.plane,
        });
      }
    } else if (e.kind === 'arc') {
      const [ctr, p0, p1] = e.pts.map((id) => session.points.find((p) => p.id === id));
      if (ctr && p0 && p1) {
        out.arcs.push({
          id: e.id,
          center: lift([ctr.x, ctr.y], session.plane),
          a: lift([p0.x, p0.y], session.plane),
          b: lift([p1.x, p1.y], session.plane),
          plane: session.plane,
        });
      }
    }
  }
  return out;
}
