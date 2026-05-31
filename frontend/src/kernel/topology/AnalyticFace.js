/**
 * ArchDisc Topology Spine — AnalyticFace builder (S6)
 *
 * SP-1 Stage S6. The new builder that produces a spine-native analytic
 * `Face` on a NURBS surface — replacing the legacy `meta.analyticFace`
 * side-car (`AnalyticNurbsFace.buildAnalyticNurbsFace`, which built a
 * pre-spine `TopoFace`).
 *
 * Why this exists separately from `AnalyticNurbsFace.js`:
 *   - `AnalyticNurbsFace.js` builds `TopoFace` instances (the pre-spine
 *     model). It is kept until §S7 quarantines Model C; the `NurbsSurfaceAdapter`
 *     and `Pcurve` classes living there are still the surface / pcurve carriers.
 *   - `AnalyticFace.js` builds the spine entities — `Face`/`Loop`/`Coedge`/
 *     `Edge`/`Vertex` from `kernel/topology/*` — wired into a complete spine
 *     `Body{kind:'sheet'}` whose primary face IS the analytic NURBS face.
 *
 * The resulting body is heterogeneous-ready: it has the same shape as any
 * engine-backed spine Body, but its primary face's `geomRef` is null and its
 * `surface` is the `NurbsSurfaceAdapter` (`face.isAnalytic === true`). This is
 * what SP-1 §2.7 calls for — "a unified Face contract regardless of which
 * engine backs the geometry."
 *
 * The accompanying B-rep engine wrapper (the sewn-mesh `TopoDS_Shell` used for
 * rendering / measure / volume) is recorded on `body.geomEngineShape` exactly
 * as a normal `bindSpine` body would — so `brepToMesh`, `measure`, and the
 * scene path see no difference.
 */

import Body from './Body.js';
import Lump from './Lump.js';
import Shell from './Shell.js';
import Face from './Face.js';
import Loop from './Loop.js';
import Coedge from './Coedge.js';
import Edge from './Edge.js';
import Vertex from './Vertex.js';
import { NurbsSurfaceAdapter } from './AnalyticNurbsFace.js';
import { LinearPcurve } from './Pcurve.js';

/**
 * Build a complete spine `Body{kind:'sheet'}` whose primary spine `Face` is a
 * spine-native analytic NURBS face (the §2.7 unified-face contract).
 *
 * Topology:
 *   Body → Lump → Shell(role='peripheral') → Face[analytic]
 *           Face's outerLoop has 4 Coedges along the four domain borders
 *             Coedges use 4 Edges between 4 corner Vertices
 *           Each Coedge carries a LinearPcurve along its parametric border.
 *
 * The analytic surface's natural rectangular trim (uMin/uMax/vMin/vMax) is the
 * face's boundary — the 4 corners are the surface points at the domain corners
 * (a clamped B-spline's corner CPs ARE the surface corners exactly).
 *
 * @param {import('../../foundation/NURBSSurface.js').NURBSSurface} nurbs
 *   the analytic surface to wrap.
 * @param {object} [opts]
 * @param {object} [opts.geomEngineShape]   the OCCT wrapper (BrepShape) used
 *   for tessellation / volume / scene rendering — recorded on the body, never
 *   used as the analytic face's geomRef (which stays null — analytic-native).
 * @param {string} [opts.bodyTag]           explicit body tag for the IdAllocator.
 * @param {Array<string>} [opts.derivedFromIds] persistent ids of seed entities
 *   (e.g. the two edges that fed a G2 blend) — recorded on the analytic face's
 *   `derivedFrom` for the SP-1 §2.3 lineage contract.
 * @param {string} [opts.faceName]   optional human-readable name for the face
 *   (lands in `face.userData.name`).
 * @param {string} [opts.kind]       declared body kind. Default 'sheet' (one
 *   analytic face, open boundary). The 3 S6 ops are sheet bodies.
 * @returns {{body: import('./Body.js').default,
 *           face: import('./Face.js').default,
 *           loop: import('./Loop.js').default,
 *           edges: import('./Edge.js').default[],
 *           vertices: import('./Vertex.js').default[]}}
 *   the spine body + the analytic face + its boundary entities.
 */
export function buildAnalyticSpineBody(nurbs, opts = {}) {
  if (!nurbs || typeof nurbs.eval !== 'function') {
    throw new Error('buildAnalyticSpineBody: needs a NURBSSurface');
  }
  const body = new Body({
    bodyTag: opts.bodyTag,
    geomEngineShape: opts.geomEngineShape || null,
    declaredKind: opts.kind || 'sheet',
  });

  // ── 1. Build the surface adapter — the unified Face Surface contract ───────
  const adapter = new NurbsSurfaceAdapter(nurbs);

  // ── 2. The four corner vertices at the four parametric corners ─────────────
  // For a clamped B-spline the 4 corner control points lie EXACTLY on the
  // surface — use the surface eval as the authoritative corner point.
  const u0 = nurbs.uMin, u1 = nurbs.uMax;
  const v0 = nurbs.vMin, v1 = nurbs.vMax;
  const cornersUV = [
    [u0, v0],  // 0 — bottom-left
    [u1, v0],  // 1 — bottom-right
    [u1, v1],  // 2 — top-right
    [u0, v1],  // 3 — top-left
  ];
  const cornerXYZ = cornersUV.map(([u, v]) => nurbs.eval(u, v));
  const verts = cornerXYZ.map((p) => new Vertex(
    { x: p[0], y: p[1], z: p[2] },
    { persistentId: body.allocId('vertex') },
  ));

  // ── 3. The four boundary edges — a curve adapter per edge ──────────────────
  // Each edge runs along ONE parametric domain border (an isoline in (u,v)
  // space — the surface evaluated at constant u or constant v). The Curve
  // adapter samples the surface at param t∈[0,1] along its isoline so
  // `pointAt(t)` is exact, not chord-linear.
  const edges = [];
  for (let i = 0; i < 4; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % 4];
    const [uvA, uvB] = [cornersUV[i], cornersUV[(i + 1) % 4]];
    const curve = new SurfaceBorderCurve(nurbs, uvA, uvB);
    const edge = new Edge(a, b, curve, {
      persistentId: body.allocId('edge'),
      geomRef: null,
    });
    edges.push(edge);
  }

  // ── 4. The outer loop — four coedges around the domain rectangle ──────────
  const loop = new Loop([], {
    persistentId: body.allocId('loop'),
    isOuter: true,
  });
  for (let i = 0; i < 4; i++) {
    const ce = new Coedge(edges[i], false, {
      persistentId: body.allocId('coedge'),
      pcurve: new LinearPcurve(cornersUV[i], cornersUV[(i + 1) % 4]),
    });
    loop.addCoedge(ce);
  }

  // ── 5. The face — primary entity, surface = NurbsSurfaceAdapter ────────────
  const face = new Face(adapter, loop, [], {
    persistentId: body.allocId('face'),
    geomRef: null,         // SPINE-NATIVE — no engine sub-shape.
  });
  face.userData.analyticNurbs = true;
  if (opts.faceName) face.userData.name = opts.faceName;
  // SP-1 §2.3 — lineage: the seed entities the analytic face is derived from.
  if (Array.isArray(opts.derivedFromIds) && opts.derivedFromIds.length > 0) {
    face.derivedFrom = opts.derivedFromIds.slice();
  }

  // ── 6. Shell + Lump (sheet body — one open analytic surface) ───────────────
  const shell = new Shell([face], {
    persistentId: body.allocId('shell'),
    role: 'peripheral',
  });
  const lump = new Lump([shell], { persistentId: body.allocId('lump') });
  body.addLump(lump);

  // ── 7. Body kind + diagnostics ─────────────────────────────────────────────
  body.diagnostics.bind = {
    adjacencyStrategy: 'analytic-spine-native',
    degenerateEdges: 0,
    openShells: 1,
    coedgePartners: { manifold: 0, nonManifold: 0, free: 4 },
    radialOrdering: { ordered: 0, skipped: 0 },
  };
  body.assertKind();

  return { body, face, loop, edges, vertices: verts };
}

/**
 * A Curve adapter that samples a NURBS surface along one of its domain borders
 * (a u-isoline or v-isoline). The border between (uA, vA) and (uB, vB) is a
 * straight line in parametric (u,v) space; in 3-D space it is the surface's
 * exact isoline curve. `pointAt(t)` interpolates linearly in (u,v) from t=0
 * to t=1 and evaluates the surface there — exact for a domain border on a
 * clamped B-spline.
 *
 * Contract matches `OcctCurveAdapter`: `pointAt(t)`, `tangentAt(t)`, `length()`.
 */
class SurfaceBorderCurve {
  constructor(nurbs, uvA, uvB) {
    this._nurbs = nurbs;
    this._a = [uvA[0], uvA[1]];
    this._b = [uvB[0], uvB[1]];
    this.type = 'analytic-surface-border';
  }

  pointAt(t) {
    const s = Math.min(1, Math.max(0, t));
    const u = this._a[0] + (this._b[0] - this._a[0]) * s;
    const v = this._a[1] + (this._b[1] - this._a[1]) * s;
    const p = this._nurbs.eval(u, v);
    return { x: p[0], y: p[1], z: p[2] };
  }

  tangentAt(t) {
    // Numerical derivative — a 2-point central difference along the (u,v)
    // border is sufficient for radial-ordering tangent use; an analytic
    // derivative via `evalDerivatives` would be more precise but is not
    // exposed uniformly across all NURBSSurface builds.
    const h = 1e-4;
    const ta = Math.max(0, Math.min(1, t - h));
    const tb = Math.max(0, Math.min(1, t + h));
    const a = this.pointAt(ta), b = this.pointAt(tb);
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const len = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (len < 1e-12) return null;
    return { x: dx / len, y: dy / len, z: dz / len };
  }

  length() {
    // 16-segment chord-length integration along the analytic isoline.
    const N = 16;
    let total = 0;
    let prev = this.pointAt(0);
    for (let i = 1; i <= N; i++) {
      const cur = this.pointAt(i / N);
      total += Math.hypot(cur.x - prev.x, cur.y - prev.y, cur.z - prev.z);
      prev = cur;
    }
    return total;
  }
}
