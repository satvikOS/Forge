/**
 * ArchDisc Topology Spine — geometry adapters
 *
 * SP-1 Stage S1. The Surface / Curve / Point adapters that let a spine
 * `Face` / `Edge` present a UNIFORM geometry contract regardless of which
 * engine backs it (SP-1 §2.4).
 *
 * `OcctSurfaceAdapter` / `OcctCurveAdapter` wrap a B-rep-engine sub-shape
 * (a `TopoDS_Face` / `TopoDS_Edge`) and delegate `pointAt` / `normalAt` /
 * `tangentAt` to `BRep_Tool`. They are LAZY: the engine `Geom_Surface` /
 * `Geom_Curve` handle is fetched on first evaluation and cached. They hold
 * only the sub-shape (a lightweight handle into the parent shape's TShape,
 * which lives as long as the parent shape) plus a reference to the live `oc`
 * module — so they never extend the WASM-heap lifetime of anything.
 *
 * An ArchDisc-analytic face (G2 blend, N-sided, face-replace — S6) instead
 * uses `NurbsSurfaceAdapter` from `AnalyticNurbsFace.js`, which exposes the
 * SAME contract — the spine does not care which adapter a face carries.
 *
 * `analytic` is `false` here (engine-backed) and `true` on the NURBS adapter
 * — `Face.isAnalytic` keys on it.
 */

/**
 * Surface adapter over an engine `TopoDS_Face`.
 * Contract: `type`, `analytic`, `pointAt(u,v)`, `normalAt(u,v)`, `surfaceKind()`.
 */
export class OcctSurfaceAdapter {
  /**
   * @param {object} oc        live B-rep engine module.
   * @param {object} occtFace  the TopoDS_Face this surface belongs to.
   */
  constructor(oc, occtFace) {
    this._oc = oc;
    this._face = occtFace;
    this.analytic = false;      // engine-backed, not a spine-native NURBS face
    this._surfHandle = null;    // cached Handle_Geom_Surface
    this._raw = null;           // cached raw Geom_Surface
    this._kind = null;
    this.type = 'engine-surface';
  }

  /** Lazily fetch + cache the raw Geom_Surface. */
  _rawSurface() {
    if (this._raw) return this._raw;
    const oc = this._oc;
    try {
      this._surfHandle = oc.BRep_Tool.Surface_2(this._face);
      if (this._surfHandle && typeof this._surfHandle.get === 'function') {
        this._raw = this._surfHandle.get();
      }
    } catch (_e) { this._raw = null; }
    return this._raw;
  }

  /**
   * The engine surface class name — 'Geom_Plane', 'Geom_CylindricalSurface',
   * 'Geom_BSplineSurface', … — used as the spine's surface kind.
   */
  surfaceKind() {
    if (this._kind) return this._kind;
    const raw = this._rawSurface();
    this._kind = (raw && raw.constructor && raw.constructor.name) || 'unknown';
    return this._kind;
  }

  /** Evaluate the surface point at parameters (u,v). Returns {x,y,z} or null. */
  pointAt(u, v) {
    const raw = this._rawSurface();
    if (!raw || typeof raw.D0 !== 'function') return null;
    const oc = this._oc;
    let p = null;
    try {
      p = new oc.gp_Pnt_3(0, 0, 0);
      raw.D0(u, v, p);
      const out = { x: p.X(), y: p.Y(), z: p.Z() };
      return out;
    } catch (_e) {
      return null;
    } finally {
      try { if (p && p.delete) p.delete(); } catch (_e) {}
    }
  }

  /** Evaluate the unit surface normal at (u,v). Returns {x,y,z} or null. */
  normalAt(u, v) {
    const raw = this._rawSurface();
    if (!raw || typeof raw.D1 !== 'function') return null;
    const oc = this._oc;
    let p = null, du = null, dv = null;
    try {
      p = new oc.gp_Pnt_3(0, 0, 0);
      du = new oc.gp_Vec_4(0, 0, 0);
      dv = new oc.gp_Vec_4(0, 0, 0);
      raw.D1(u, v, p, du, dv);
      // normal = du × dv, normalised.
      const nx = du.Y() * dv.Z() - du.Z() * dv.Y();
      const ny = du.Z() * dv.X() - du.X() * dv.Z();
      const nz = du.X() * dv.Y() - du.Y() * dv.X();
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len < 1e-12) return null;
      return { x: nx / len, y: ny / len, z: nz / len };
    } catch (_e) {
      return null;
    } finally {
      try { if (p && p.delete) p.delete(); } catch (_e) {}
      try { if (du && du.delete) du.delete(); } catch (_e) {}
      try { if (dv && dv.delete) dv.delete(); } catch (_e) {}
    }
  }
}

/**
 * Curve adapter over an engine `TopoDS_Edge`.
 * Contract: `type`, `length()`, `pointAt(t)`, `tangentAt(t)`.
 */
export class OcctCurveAdapter {
  /**
   * @param {object} oc        live B-rep engine module.
   * @param {object} occtEdge  the TopoDS_Edge this curve belongs to.
   */
  constructor(oc, occtEdge) {
    this._oc = oc;
    this._edge = occtEdge;
    this._raw = null;       // cached raw Geom_Curve
    this._first = 0;
    this._last = 1;
    this._loaded = false;
    this.type = 'engine-curve';
    this._kind = null;
  }

  /** Lazily fetch + cache the raw Geom_Curve and its parametric range. */
  _rawCurve() {
    if (this._loaded) return this._raw;
    this._loaded = true;
    const oc = this._oc;
    for (const m of ['Curve_2', 'Curve_1', 'Curve']) {
      if (typeof oc.BRep_Tool[m] !== 'function') continue;
      try {
        // opencascade.js Curve_2(edge, first, last) — first/last are out-params
        // delivered as wrapped doubles. We read the handle; the range is
        // recovered from the raw curve below.
        const first = { current: 0 }, last = { current: 1 };
        const handle = oc.BRep_Tool[m](this._edge, first, last);
        if (handle && typeof handle.get === 'function') {
          this._raw = handle.get();
        } else if (handle && typeof handle.D0 === 'function') {
          this._raw = handle;
        }
        if (this._raw) {
          try {
            if (typeof this._raw.FirstParameter === 'function') {
              this._first = this._raw.FirstParameter();
              this._last = this._raw.LastParameter();
            }
          } catch (_e) {}
          break;
        }
      } catch (_e) { /* try next overload */ }
    }
    return this._raw;
  }

  /** The engine curve class name ('Geom_Line', 'Geom_Circle', …). */
  curveKind() {
    if (this._kind) return this._kind;
    const raw = this._rawCurve();
    this._kind = (raw && raw.constructor && raw.constructor.name) || 'unknown';
    return this._kind;
  }

  /** Curve length (mm) via the engine's GCPnts/GProp; chord fallback. */
  length() {
    const oc = this._oc;
    // Edge length via BRepGProp linear properties (verified API family).
    let props = null;
    try {
      props = new oc.GProp_GProps_1();
      oc.BRepGProp.LinearProperties(this._edge, props, false, false);
      const m = props.Mass();
      if (Number.isFinite(m) && m > 0) return m;
    } catch (_e) { /* fall through */ }
    finally { try { if (props && props.delete) props.delete(); } catch (_e) {} }
    return 0;
  }

  /** Evaluate the curve point at parameter t∈[0,1] (normalised). */
  pointAt(t) {
    const raw = this._rawCurve();
    if (!raw || typeof raw.D0 !== 'function') return null;
    const oc = this._oc;
    const u = this._first + (this._last - this._first) * Math.min(1, Math.max(0, t));
    let p = null;
    try {
      p = new oc.gp_Pnt_3(0, 0, 0);
      raw.D0(u, p);
      return { x: p.X(), y: p.Y(), z: p.Z() };
    } catch (_e) {
      return null;
    } finally {
      try { if (p && p.delete) p.delete(); } catch (_e) {}
    }
  }

  /** Evaluate the unit tangent at parameter t∈[0,1]. */
  tangentAt(t) {
    const raw = this._rawCurve();
    if (!raw || typeof raw.D1 !== 'function') return null;
    const oc = this._oc;
    const u = this._first + (this._last - this._first) * Math.min(1, Math.max(0, t));
    let p = null, d1 = null;
    try {
      p = new oc.gp_Pnt_3(0, 0, 0);
      d1 = new oc.gp_Vec_4(0, 0, 0);
      raw.D1(u, p, d1);
      const len = Math.sqrt(d1.X() ** 2 + d1.Y() ** 2 + d1.Z() ** 2);
      if (len < 1e-12) return null;
      return { x: d1.X() / len, y: d1.Y() / len, z: d1.Z() / len };
    } catch (_e) {
      return null;
    } finally {
      try { if (p && p.delete) p.delete(); } catch (_e) {}
      try { if (d1 && d1.delete) d1.delete(); } catch (_e) {}
    }
  }
}
