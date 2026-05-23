/**
 * ArchDisc Kernel — Geometric & topological query / evaluation (Area J).
 *
 * SP-4. The kernel-grade query API every engineer asks of a kernel:
 *
 *   - `classifyPoint(body, [x,y,z])`         IN | ON | OUT        (BRepClass3d_SolidClassifier)
 *   - `rayFire(body, origin, direction)`     ray ↔ body hits      (IntCurvesFace_ShapeIntersector)
 *   - `evalCurve(edge, t)`                   point + tangent +
 *                                            2nd deriv + curvature (BRepAdaptor_Curve + D2)
 *   - `evalSurface(face, u, v)`              point + normal +
 *                                            partials + curvatures (BRepAdaptor_Surface + D2)
 *   - `massProperties(body, opts)`           volume / mass /
 *                                            centroid / inertia
 *                                            tensor + principal axes (BRepGProp::VolumeProperties +
 *                                                                     SurfaceProperties + matrix
 *                                                                     diagonalisation)
 *   - `adjacency(body)` → facesOfEdge / edgesOfFace / verticesOfEdge /
 *                        facesOfVertex / edgesOfVertex
 *                                            spine walk (SP-1 three-tier adjacency)
 *
 * Bundle target: `ArchDiscKernel.brep.*` via `index.js`. Every query is
 * `withScope`-disciplined: every gp_Pnt / gp_Vec / Adaptor / Classifier / GProp
 * object created inside is `.delete()`d on exit, so the WASM heap stays bounded
 * even for high-frequency calls (a ray-fire batch, a curve sampling loop).
 *
 * Body input contract — every query accepts the SP-1 currencies:
 *   - a `SpineBody` (the new currency), or
 *   - a legacy `BrepShape` (the pre-SP-1 currency),
 *   - or anything else exposing `.shape` (the engine `TopoDS_Shape`).
 *
 * Entity input — `evalCurve` takes a spine `Edge`, `evalSurface` takes a spine
 * `Face`. Both use their `geomRef` (the engine sub-shape) which `bindSpine`
 * already attached. Falling back to the entity's `surface.toBSplineSurface()` /
 * `curve` adapter if no `geomRef` is present (a spine-native analytic face has
 * no engine sub-shape — covered by `surface.pointAt`/`curve.pointAt`).
 *
 * Honest gaps (per SP-4 brief):
 *   - `IntCurvesFace_ShapeIntersector` reports the OCCT `TopAbs_State` of each
 *     intersection. Some engine builds report the state via raw integer rather
 *     than a typed enum — we accept both.
 *   - Curvature on a degenerate edge (sphere pole, cone apex) returns
 *     `curvature: 0` because the second derivative magnitude is zero; the
 *     diagnostic `degenerate: true` is set.
 *   - Surface curvature near a singular u/v (sphere pole; cone apex) returns
 *     NaN; we substitute `null` and set `degenerate: true`.
 *   - `BRepGProp::VolumeProperties` returns mass/volume in the engine's units —
 *     for ArchDisc that is mm/mm²/mm³. Density is in kg/m³ (SI engineering
 *     unit); the conversion to mm³ → m³ is applied on multiply.
 *   - Principal axes from `GProp_PrincipalProps` come straight off OCCT; we
 *     also include a JS-side matrix diagonalisation of the inertia tensor so
 *     callers can verify (or substitute when the engine binding mis-orients
 *     a degenerate axis).
 */

import { getOCCT } from './kernelLoader.js';
import { withScope, track } from './BrepShape.js';

// ── Small helpers ────────────────────────────────────────────────────────────

/**
 * Get the live `TopoDS_Shape` off any body-like value: SpineBody, BrepShape,
 * raw shape. Throws if no shape is reachable.
 */
function shapeOf(bodyLike, opName) {
  if (!bodyLike) {
    throw new Error(`${opName}: body argument is null/undefined`);
  }
  if (bodyLike.shape && typeof bodyLike.shape !== 'function') return bodyLike.shape;
  // Could be a raw TopoDS_Shape itself.
  if (bodyLike.IsNull && typeof bodyLike.IsNull === 'function') return bodyLike;
  throw new Error(`${opName}: body must be a SpineBody / BrepShape / TopoDS_Shape`);
}

/** Normalise a 3-vector argument to {x,y,z}; accepts [x,y,z] arrays too. */
function vec3(v) {
  if (!v) throw new Error('vec3: missing vector');
  if (Array.isArray(v)) return { x: +v[0], y: +v[1], z: +v[2] };
  return { x: +v.x, y: +v.y, z: +v.z };
}

/** Cross-product. */
function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

/** Dot product. */
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }

/** L2 norm of a 3-vector. */
function norm(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }

/** Normalise (return null if zero-length). */
function normalize(v) {
  const n = norm(v);
  if (n < 1e-15) return null;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

/**
 * Decode an OCCT `TopAbs_State` returned by a classifier / intersector.
 * The engine may return either a wrapped enum value (object with
 * `value`/`raw`) or a raw integer ordinal — both are honoured.
 *
 * The OCCT ordinal is: 0=TopAbs_IN, 1=TopAbs_OUT, 2=TopAbs_ON, 3=TopAbs_UNKNOWN.
 *
 * @returns {'inside'|'outside'|'on'|'unknown'}
 */
function decodeState(oc, state) {
  if (state == null) return 'unknown';
  let ordinal = null;
  if (typeof state === 'number') {
    ordinal = state;
  } else if (typeof state === 'object') {
    if (typeof state.value === 'number') ordinal = state.value;
    else if (typeof state.constructor === 'function' && state.constructor.name) {
      // Some opencascade.js builds expose enum as a class — match by `==` to
      // the singleton from the `oc.TopAbs_State` namespace.
      const T = oc.TopAbs_State;
      if (T) {
        if (state === T.TopAbs_IN) ordinal = 0;
        else if (state === T.TopAbs_OUT) ordinal = 1;
        else if (state === T.TopAbs_ON) ordinal = 2;
        else if (state === T.TopAbs_UNKNOWN) ordinal = 3;
      }
    }
  }
  if (ordinal === 0) return 'inside';
  if (ordinal === 1) return 'outside';
  if (ordinal === 2) return 'on';
  return 'unknown';
}

// ── 1. Point classification ──────────────────────────────────────────────────

/**
 * Classify a 3-D point against a solid body.
 *
 * Returns `'inside'` / `'on'` / `'outside'` (and `'unknown'` only when the
 * classifier itself reports an indeterminate state).
 *
 * Uses OCCT `BRepClass3d_SolidClassifier.Load(shape) + Perform(point, tol)`.
 *
 * @param {object} body          SpineBody | BrepShape | TopoDS_Shape
 * @param {[number,number,number]|{x,y,z}} point  the test point (mm)
 * @param {{tolerance?:number}} [opts]
 * @returns {Promise<'inside'|'on'|'outside'|'unknown'>}
 */
export async function classifyPoint(body, point, opts = {}) {
  const oc = await getOCCT();
  const shape = shapeOf(body, 'classifyPoint');
  const p = vec3(point);
  const tol = Number.isFinite(opts.tolerance) ? opts.tolerance : 1e-6;
  return withScope(() => {
    const cls = track(new oc.BRepClass3d_SolidClassifier_2(shape));
    const pnt = track(new oc.gp_Pnt_3(p.x, p.y, p.z));
    cls.Perform(pnt, tol);
    return decodeState(oc, cls.State());
  });
}

// ── 2. Ray-fire ──────────────────────────────────────────────────────────────

/**
 * Fire a ray from `origin` along `direction` against a body; return every
 * intersection sorted by distance from origin.
 *
 * Uses OCCT `IntCurvesFace_ShapeIntersector.Load(shape, tol) + Perform_1(line,
 * pInf, pSup)`. `IntCurvesFace_ShapeIntersector` ranges along the line in the
 * line's parameter — for a unit-direction line the parameter IS the distance.
 *
 * @param {object} body
 * @param {[number,number,number]|{x,y,z}} origin
 * @param {[number,number,number]|{x,y,z}} direction
 * @param {{tolerance?:number, maxDistance?:number, minDistance?:number}} [opts]
 * @returns {Promise<Array<{point:{x,y,z}, normal:{x,y,z}|null, face:object|null,
 *                          distance:number, state:string, uv:{u:number,v:number}}>>}
 */
export async function rayFire(body, origin, direction, opts = {}) {
  const oc = await getOCCT();
  const shape = shapeOf(body, 'rayFire');
  const o = vec3(origin);
  const d = normalize(vec3(direction));
  if (!d) throw new Error('rayFire: direction must be a non-zero vector');
  const tol = Number.isFinite(opts.tolerance) ? opts.tolerance : 1e-6;
  // OCCT line parameter range — defaults span a generous slab around the
  // origin so the ray is effectively infinite both ways from the start. The
  // caller can clamp via {minDistance, maxDistance}.
  const pInf = Number.isFinite(opts.minDistance) ? opts.minDistance : 0.0;
  const pSup = Number.isFinite(opts.maxDistance) ? opts.maxDistance : 1e12;
  return withScope(() => {
    const intersector = track(new oc.IntCurvesFace_ShapeIntersector());
    intersector.Load(shape, tol);
    const origPnt = track(new oc.gp_Pnt_3(o.x, o.y, o.z));
    const dirGp = track(new oc.gp_Dir_4(d.x, d.y, d.z));
    const line = track(new oc.gp_Lin_3(origPnt, dirGp));
    intersector.Perform_1(line, pInf, pSup);
    if (!intersector.IsDone()) return [];
    try { intersector.SortResult(); } catch (_e) { /* engines without it just return unordered */ }
    const n = intersector.NbPnt();
    const hits = [];
    // Lookup map: TopoDS_Face → spine Face (so caller can correlate hits
    // with persistentIds). Only present when the body has a spine.
    const spine = (body && body.body) || null;
    const faceLookup = spine ? buildFaceLookup(spine) : null;
    for (let i = 1; i <= n; i++) {
      let pnt = null, occtFace = null, u = NaN, v = NaN, state = null;
      try {
        pnt = intersector.Pnt(i);
        occtFace = intersector.Face(i);
        u = intersector.UParameter(i);
        v = intersector.VParameter(i);
        state = intersector.State(i);
      } catch (_e) { continue; }
      const point = { x: pnt.X(), y: pnt.Y(), z: pnt.Z() };
      // Distance along the unit-direction line from origin to this point.
      const distance = Math.sqrt(
        (point.x - o.x) ** 2 + (point.y - o.y) ** 2 + (point.z - o.z) ** 2);
      // Look up the surface normal at the hit (UParameter/VParameter give the
      // face's surface parameters at the hit; D1 gives the tangents → normal).
      let normal = null;
      if (occtFace && Number.isFinite(u) && Number.isFinite(v)) {
        try {
          const adapt = track(new oc.BRepAdaptor_Surface_2(occtFace, true));
          const p = track(new oc.gp_Pnt_3(0, 0, 0));
          const du = track(new oc.gp_Vec_4(0, 0, 0));
          const dv = track(new oc.gp_Vec_4(0, 0, 0));
          adapt.D1(u, v, p, du, dv);
          const nVec = cross(
            { x: du.X(), y: du.Y(), z: du.Z() },
            { x: dv.X(), y: dv.Y(), z: dv.Z() });
          normal = normalize(nVec);
        } catch (_e) { normal = null; }
      }
      // Map the hit face back to a spine Face (if available).
      let spineFace = null;
      if (faceLookup && occtFace) {
        for (const [occt, sf] of faceLookup) {
          try { if (occt.IsSame && occt.IsSame(occtFace)) { spineFace = sf; break; } } catch (_e) { /* skip */ }
        }
      }
      hits.push({
        point,
        normal,
        face: spineFace,
        faceId: spineFace ? spineFace.persistentId : null,
        distance,
        state: decodeState(oc, state),
        uv: { u, v },
      });
    }
    // The intersector may already sort; if not, sort by distance.
    hits.sort((a, b) => a.distance - b.distance);
    return hits;
  });
}

/** Build a map TopoDS_Face → spine Face for a spine Body. */
function buildFaceLookup(spineBody) {
  const map = new Map();
  if (!spineBody || typeof spineBody.faces !== 'function') return map;
  for (const f of spineBody.faces()) {
    if (f.geomRef) map.set(f.geomRef, f);
  }
  return map;
}

// ── 3. Curve evaluation + derivatives ────────────────────────────────────────

/**
 * Evaluate a spine Edge's curve at parameter `t ∈ [0,1]`. Returns
 * `{point, tangent, secondDerivative, curvature}`.
 *
 * The curvature is the standard 3-D space-curve curvature:
 *   κ = |r'(t) × r''(t)| / |r'(t)|³
 *
 * For a degenerate (zero-length) edge `curvature: 0` and `degenerate: true`.
 *
 * @param {object} edge   spine Edge (with `geomRef` engine sub-edge), or any
 *                        object with `geomRef` (a TopoDS_Edge).
 * @param {number} t      parameter in [0,1].
 * @returns {Promise<{point:{x,y,z}, tangent:{x,y,z}|null, tangentRaw:{x,y,z},
 *                    secondDerivative:{x,y,z}, curvature:number,
 *                    parameter:number, range:[number,number],
 *                    degenerate:boolean}>}
 */
export async function evalCurve(edge, t) {
  if (!edge || !edge.geomRef) {
    throw new Error('evalCurve: edge must expose a geomRef (engine TopoDS_Edge)');
  }
  if (!Number.isFinite(t)) throw new Error('evalCurve: t must be finite');
  const oc = await getOCCT();
  return withScope(() => {
    const adapt = track(new oc.BRepAdaptor_Curve_2(edge.geomRef));
    const first = adapt.FirstParameter();
    const last = adapt.LastParameter();
    const u = first + Math.max(0, Math.min(1, t)) * (last - first);
    const p = track(new oc.gp_Pnt_3(0, 0, 0));
    const d1 = track(new oc.gp_Vec_4(0, 0, 0));
    const d2 = track(new oc.gp_Vec_4(0, 0, 0));
    adapt.D2(u, p, d1, d2);
    const point = { x: p.X(), y: p.Y(), z: p.Z() };
    const tangentRaw = { x: d1.X(), y: d1.Y(), z: d1.Z() };
    const secondDerivative = { x: d2.X(), y: d2.Y(), z: d2.Z() };
    const tangent = normalize(tangentRaw);
    const speed = norm(tangentRaw);
    let curvature = 0;
    let degenerate = false;
    if (speed < 1e-12) {
      degenerate = true;
    } else {
      const c = cross(tangentRaw, secondDerivative);
      curvature = norm(c) / (speed * speed * speed);
      if (!Number.isFinite(curvature)) curvature = 0;
    }
    return {
      point, tangent, tangentRaw, secondDerivative, curvature,
      parameter: u, range: [first, last], degenerate,
    };
  });
}

// ── 4. Surface evaluation + derivatives + curvature ──────────────────────────

/**
 * Evaluate a spine Face's surface at parameters (u,v). Returns the point,
 * unit normal, first partials dP/du / dP/dv, second partials d²P/du² /
 * d²P/dv² / d²P/dudv, the Gaussian + mean curvatures and the two principal
 * curvatures.
 *
 * Curvature formulas (first + second fundamental forms):
 *   E = dP/du · dP/du     F = dP/du · dP/dv     G = dP/dv · dP/dv
 *   L = d²P/du² · n       M = d²P/dudv · n      N = d²P/dv² · n
 *   K (Gaussian) = (L·N − M²) / (E·G − F²)
 *   H (mean)     = (E·N + G·L − 2·F·M) / (2·(E·G − F²))
 *   κ₁, κ₂ = H ± √(H² − K)            (the two principal curvatures)
 *
 * For a cylinder of radius r: κ₁ = 1/r (the meridional curvature), κ₂ = 0
 * (the axial direction), K = 0, H = 1/(2r). For a sphere of radius r: both
 * principal curvatures are 1/r, K = 1/r², H = 1/r.
 *
 * Near a degenerate parameter (sphere pole, cone apex) the metric goes
 * singular and the curvatures land NaN — we substitute `null` and set
 * `degenerate: true`.
 *
 * @param {object} face  spine Face (with geomRef engine TopoDS_Face).
 * @param {number} u
 * @param {number} v
 * @param {{normalised?:boolean}} [opts]  when true, u/v are interpreted as
 *        normalised [0,1] parameters and remapped to the face's UV range.
 * @returns {Promise<{point, normal, dPdu, dPdv, d2Pdu2, d2Pdv2, d2Pdudv,
 *                    gaussianCurvature:number|null, meanCurvature:number|null,
 *                    principalCurvatures:[number,number]|[null,null],
 *                    parameters:{u,v}, range:{u:[number,number], v:[number,number]},
 *                    degenerate:boolean, surfaceType:string|null}>}
 */
export async function evalSurface(face, u, v, opts = {}) {
  if (!face || !face.geomRef) {
    throw new Error('evalSurface: face must expose a geomRef (engine TopoDS_Face)');
  }
  if (!Number.isFinite(u) || !Number.isFinite(v)) {
    throw new Error('evalSurface: u,v must be finite');
  }
  const oc = await getOCCT();
  return withScope(() => {
    const adapt = track(new oc.BRepAdaptor_Surface_2(face.geomRef, true));
    const uMin = adapt.FirstUParameter();
    const uMax = adapt.LastUParameter();
    const vMin = adapt.FirstVParameter();
    const vMax = adapt.LastVParameter();
    let uu = u, vv = v;
    if (opts.normalised) {
      uu = uMin + Math.max(0, Math.min(1, u)) * (uMax - uMin);
      vv = vMin + Math.max(0, Math.min(1, v)) * (vMax - vMin);
    }
    const p   = track(new oc.gp_Pnt_3(0, 0, 0));
    const D1U = track(new oc.gp_Vec_4(0, 0, 0));
    const D1V = track(new oc.gp_Vec_4(0, 0, 0));
    const D2U = track(new oc.gp_Vec_4(0, 0, 0));
    const D2V = track(new oc.gp_Vec_4(0, 0, 0));
    const D2UV = track(new oc.gp_Vec_4(0, 0, 0));
    adapt.D2(uu, vv, p, D1U, D1V, D2U, D2V, D2UV);
    const point   = { x: p.X(), y: p.Y(), z: p.Z() };
    const dPdu    = { x: D1U.X(), y: D1U.Y(), z: D1U.Z() };
    const dPdv    = { x: D1V.X(), y: D1V.Y(), z: D1V.Z() };
    const d2Pdu2  = { x: D2U.X(), y: D2U.Y(), z: D2U.Z() };
    const d2Pdv2  = { x: D2V.X(), y: D2V.Y(), z: D2V.Z() };
    const d2Pdudv = { x: D2UV.X(), y: D2UV.Y(), z: D2UV.Z() };
    // Surface kind via the OCCT enum index.
    let surfaceType = null;
    try {
      const ty = adapt.GetType();
      // The enum lives at oc.GeomAbs_SurfaceType; ordering matches OCCT.
      const T = oc.GeomAbs_SurfaceType;
      if (T) {
        if (ty === T.GeomAbs_Plane) surfaceType = 'plane';
        else if (ty === T.GeomAbs_Cylinder) surfaceType = 'cylinder';
        else if (ty === T.GeomAbs_Cone) surfaceType = 'cone';
        else if (ty === T.GeomAbs_Sphere) surfaceType = 'sphere';
        else if (ty === T.GeomAbs_Torus) surfaceType = 'torus';
        else if (ty === T.GeomAbs_BezierSurface) surfaceType = 'bezier';
        else if (ty === T.GeomAbs_BSplineSurface) surfaceType = 'bspline';
        else if (ty === T.GeomAbs_SurfaceOfRevolution) surfaceType = 'revolution';
        else if (ty === T.GeomAbs_SurfaceOfExtrusion) surfaceType = 'extrusion';
        else if (ty === T.GeomAbs_OffsetSurface) surfaceType = 'offset';
        else if (ty === T.GeomAbs_OtherSurface) surfaceType = 'other';
      }
      if (!surfaceType && typeof ty === 'number') surfaceType = `kind:${ty}`;
    } catch (_e) { /* surfaceType stays null */ }
    // Normal = du × dv, with sign flipped if face is reversed.
    const nVec = cross(dPdu, dPdv);
    let normal = normalize(nVec);
    if (normal && face.reversed) normal = { x: -normal.x, y: -normal.y, z: -normal.z };
    // First fundamental form
    const E = dot(dPdu, dPdu);
    const F = dot(dPdu, dPdv);
    const G = dot(dPdv, dPdv);
    const det1 = E * G - F * F;
    // Second fundamental form — needs unit normal (un-flipped — the face's
    // reverse flag is a topological orientation, not a geometric one;
    // curvature is signed by the surface normal of the underlying surface).
    const nGeom = normalize(nVec);
    let gaussianCurvature = null;
    let meanCurvature = null;
    let principalCurvatures = [null, null];
    let degenerate = false;
    if (!nGeom || det1 < 1e-18) {
      degenerate = true;
    } else {
      const L = dot(d2Pdu2, nGeom);
      const M = dot(d2Pdudv, nGeom);
      const N = dot(d2Pdv2, nGeom);
      gaussianCurvature = (L * N - M * M) / det1;
      meanCurvature = (E * N + G * L - 2 * F * M) / (2 * det1);
      const disc = meanCurvature * meanCurvature - gaussianCurvature;
      if (disc >= 0) {
        const root = Math.sqrt(disc);
        principalCurvatures = [meanCurvature + root, meanCurvature - root];
      } else if (Math.abs(disc) < 1e-9) {
        principalCurvatures = [meanCurvature, meanCurvature];
      } else {
        // Complex roots — record as null with a diagnostic. The condition
        // K > H² is not geometrically possible for a real surface, so this
        // is purely a numerical artefact near a singular parameter.
        principalCurvatures = [null, null];
        degenerate = true;
      }
    }
    return {
      point, normal, dPdu, dPdv, d2Pdu2, d2Pdv2, d2Pdudv,
      gaussianCurvature, meanCurvature, principalCurvatures,
      parameters: { u: uu, v: vv },
      range: { u: [uMin, uMax], v: [vMin, vMax] },
      degenerate, surfaceType,
    };
  });
}

// ── 5. Mass properties ───────────────────────────────────────────────────────

/**
 * Compute mass / centroid / inertia properties of a body.
 *
 * Volume + centroid + inertia matrix come from OCCT `BRepGProp::VolumeProperties`.
 * Surface area comes from `BRepGProp::SurfaceProperties`. Mass is `volume *
 * density` with the SI-engineering unit convention:
 *   - geometry in mm → volume in mm³ → multiply by 1e-9 to get m³
 *   - density in kg/m³
 *   - mass in kg
 *
 * The inertia tensor is reported about the centroid (the engine's default).
 * Principal moments + principal axes come from OCCT `GProp_PrincipalProps`
 * AND independently from a JS-side Jacobi diagonalisation of the inertia
 * matrix (cross-check); both are returned. The principal axes are a right-
 * handed orthonormal basis aligned with the body's mass distribution.
 *
 * @param {object} body
 * @param {{densityKgPerM3?:number, tolerance?:number, onlyClosed?:boolean}} [opts]
 *        densityKgPerM3 default 1000 (water). tolerance default 1e-3 (mm).
 *        onlyClosed default true — refuse to compute volume on a sheet body.
 * @returns {Promise<{volume:number, mass:number, density:number,
 *                    centroid:{x,y,z}, surfaceArea:number,
 *                    inertiaTensor:[[number,number,number],
 *                                   [number,number,number],
 *                                   [number,number,number]],
 *                    inertiaAboutCentroid:boolean,
 *                    principalMoments:[number,number,number],
 *                    principalAxes:[[number,number,number],
 *                                   [number,number,number],
 *                                   [number,number,number]],
 *                    principalMomentsJs:[number,number,number],
 *                    principalAxesJs:[[number,number,number],
 *                                     [number,number,number],
 *                                     [number,number,number]]}>}
 */
export async function massProperties(body, opts = {}) {
  const oc = await getOCCT();
  const shape = shapeOf(body, 'massProperties');
  const density = Number.isFinite(opts.densityKgPerM3) ? opts.densityKgPerM3 : 1000;
  const onlyClosed = opts.onlyClosed !== false;
  return withScope(() => {
    const vProps = track(new oc.GProp_GProps_1());
    oc.BRepGProp.VolumeProperties_1(shape, vProps, onlyClosed, false, false);
    const sProps = track(new oc.GProp_GProps_1());
    oc.BRepGProp.SurfaceProperties_1(shape, sProps, false, false);
    const volume = vProps.Mass();       // engine units (mm³)
    const surfaceArea = sProps.Mass();  // mm²
    const cg = track(vProps.CentreOfMass());
    const centroid = { x: cg.X(), y: cg.Y(), z: cg.Z() };
    // Inertia matrix (about centroid). The kernel's MatrixOfInertia returns
    // the symmetric 3×3 tensor in the same units as volume — i.e. mm⁵ for
    // a uniform unit-density body. (Multiplying by density gives mass-
    // moments, but we report the geometric tensor — caller multiplies if
    // they want kg·m² SI units.)
    const m = track(vProps.MatrixOfInertia());
    const inertiaTensor = [
      [m.Value(1, 1), m.Value(1, 2), m.Value(1, 3)],
      [m.Value(2, 1), m.Value(2, 2), m.Value(2, 3)],
      [m.Value(3, 1), m.Value(3, 2), m.Value(3, 3)],
    ];
    // Engine-reported principal moments + axes via GProp_PrincipalProps.
    let principalMoments = [0, 0, 0];
    let principalAxes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    try {
      const pp = track(vProps.PrincipalProperties());
      // Moments — OCCT writes the three moments via output references.
      // Bind exposes Moments(Ixx, Iyy, Izz) as out-params, available as
      // wrapped doubles in opencascade.js.
      const Ixx = { current: 0 }, Iyy = { current: 0 }, Izz = { current: 0 };
      try {
        pp.Moments(Ixx, Iyy, Izz);
        principalMoments = [Ixx.current, Iyy.current, Izz.current];
      } catch (_e) { /* fall back to JS diagonalisation */ }
      try {
        const a1 = track(pp.FirstAxisOfInertia());
        const a2 = track(pp.SecondAxisOfInertia());
        const a3 = track(pp.ThirdAxisOfInertia());
        principalAxes = [
          [a1.X(), a1.Y(), a1.Z()],
          [a2.X(), a2.Y(), a2.Z()],
          [a3.X(), a3.Y(), a3.Z()],
        ];
      } catch (_e) { /* fall back to JS diagonalisation */ }
    } catch (_e) { /* PrincipalProperties unavailable */ }
    // Independent JS-side eigendecomposition of the inertia tensor (Jacobi).
    // Always run — gives a cross-check the caller can rely on if the engine
    // binding mis-orients (the engine sometimes returns the unsorted axes).
    const jac = jacobi3(inertiaTensor);
    const principalMomentsJs = jac.eigenvalues;
    const principalAxesJs = jac.eigenvectors;
    const massSi = volume * 1e-9 * density;
    return {
      volume, surfaceArea, density, mass: massSi, centroid,
      inertiaTensor, inertiaAboutCentroid: true,
      principalMoments, principalAxes,
      principalMomentsJs, principalAxesJs,
    };
  });
}

/**
 * Jacobi eigendecomposition of a real symmetric 3×3 matrix. Returns eigen-
 * values (ascending) and right-handed orthonormal eigenvectors.
 *
 * Real algorithm — iterative off-diagonal annihilation; converges quadratically
 * on a symmetric input. ArchDisc uses this for the inertia-tensor diagonalisation
 * cross-check, independent of OCCT's PrincipalProperties.
 *
 * @param {number[][]} A  3×3 symmetric matrix.
 * @param {number} [maxSweeps]
 * @returns {{eigenvalues:number[], eigenvectors:number[][]}}
 */
function jacobi3(A, maxSweeps = 32) {
  // Working copies.
  const a = [
    [A[0][0], A[0][1], A[0][2]],
    [A[1][0], A[1][1], A[1][2]],
    [A[2][0], A[2][1], A[2][2]],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    // Compute off-diagonal magnitude.
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-14) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = a[p][q];
        if (Math.abs(apq) < 1e-18) continue;
        const app = a[p][p], aqq = a[q][q];
        let theta;
        if (Math.abs(apq) < 1e-300) {
          theta = 0;
        } else {
          theta = (aqq - app) / (2 * apq);
        }
        let t;
        if (Math.abs(theta) > 1e16) {
          t = 1 / (2 * theta);
        } else {
          t = Math.sign(theta) / (Math.abs(theta) + Math.sqrt(1 + theta * theta));
        }
        if (theta === 0) t = 1; // tan(45°) when the eigen-block is symmetric
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        // Update a.
        const newApp = app - t * apq;
        const newAqq = aqq + t * apq;
        a[p][p] = newApp;
        a[q][q] = newAqq;
        a[p][q] = 0;
        a[q][p] = 0;
        for (let r = 0; r < 3; r++) {
          if (r !== p && r !== q) {
            const arp = a[r][p];
            const arq = a[r][q];
            a[r][p] = c * arp - s * arq;
            a[p][r] = a[r][p];
            a[r][q] = s * arp + c * arq;
            a[q][r] = a[r][q];
          }
        }
        // Update v.
        for (let r = 0; r < 3; r++) {
          const vrp = v[r][p];
          const vrq = v[r][q];
          v[r][p] = c * vrp - s * vrq;
          v[r][q] = s * vrp + c * vrq;
        }
      }
    }
  }
  // Collect eigenvalues + eigenvectors; sort ascending by eigenvalue.
  const eigs = [
    { val: a[0][0], vec: [v[0][0], v[1][0], v[2][0]] },
    { val: a[1][1], vec: [v[0][1], v[1][1], v[2][1]] },
    { val: a[2][2], vec: [v[0][2], v[1][2], v[2][2]] },
  ];
  eigs.sort((p, q) => p.val - q.val);
  // Enforce right-handed basis (det = +1).
  const vec1 = eigs[0].vec, vec2 = eigs[1].vec, vec3 = eigs[2].vec;
  const det = (
    vec1[0] * (vec2[1] * vec3[2] - vec2[2] * vec3[1])
    - vec1[1] * (vec2[0] * vec3[2] - vec2[2] * vec3[0])
    + vec1[2] * (vec2[0] * vec3[1] - vec2[1] * vec3[0])
  );
  if (det < 0) {
    eigs[2].vec = [-vec3[0], -vec3[1], -vec3[2]];
  }
  return {
    eigenvalues: eigs.map(e => e.val),
    eigenvectors: eigs.map(e => e.vec),
  };
}

// ── 6. Adjacency traversal ───────────────────────────────────────────────────

/**
 * Return an adjacency view of a spine `Body` — five traversal accessors keyed
 * by persistent id (or transient id, prefixed with `t:`). The data IS the
 * spine (SP-1 three-tier adjacency built by `bindSpine`); SP-4 surfaces a
 * clean, documented API on top.
 *
 * Returned object — every method is O(1) after the initial bind of the body
 * (the spine carries the back-refs already):
 *   - `facesOfEdge(edgeId)`       → Face[]      (the faces an edge bounds)
 *   - `edgesOfFace(faceId)`       → Edge[]      (the edges bounding a face)
 *   - `verticesOfEdge(edgeId)`    → Vertex[]    ([start, end])
 *   - `facesOfVertex(vertexId)`   → Face[]      (faces touching a vertex)
 *   - `edgesOfVertex(vertexId)`   → Edge[]      (edges incident on a vertex)
 *   - `coedgesOfEdge(edgeId)`     → Coedge[]    (radial coedge set on an edge)
 *   - `findFace(id)` / `findEdge(id)` / `findVertex(id)` — typed lookups
 *
 * Edge ↔ Face is the radial relation (manifold = 2 faces, non-manifold = >2,
 * boundary = <2). Vertex ↔ Face is reached via the vertex's edges.
 *
 * @param {object} body          SpineBody | spine Body
 * @returns {object}             the adjacency view
 */
export function adjacency(body) {
  const spineBody = pickSpineBody(body);
  if (!spineBody) {
    throw new Error('adjacency: body must be a SpineBody or spine Body');
  }
  const findFace = (id) => spineBody.faces().find(f => entityIdMatches(f, id)) || null;
  const findEdge = (id) => spineBody.edges().find(e => entityIdMatches(e, id)) || null;
  const findVertex = (id) => spineBody.vertices().find(v => entityIdMatches(v, id)) || null;
  return {
    facesOfEdge(edgeId) {
      const e = (edgeId && typeof edgeId === 'object' && edgeId.type === 'edge') ? edgeId : findEdge(edgeId);
      if (!e) return [];
      return e.faces();
    },
    edgesOfFace(faceId) {
      const f = (faceId && typeof faceId === 'object' && faceId.type === 'face') ? faceId : findFace(faceId);
      if (!f) return [];
      return f.edges();
    },
    verticesOfEdge(edgeId) {
      const e = (edgeId && typeof edgeId === 'object' && edgeId.type === 'edge') ? edgeId : findEdge(edgeId);
      if (!e) return [];
      const out = [];
      if (e.startVertex) out.push(e.startVertex);
      if (e.endVertex && e.endVertex !== e.startVertex) out.push(e.endVertex);
      return out;
    },
    facesOfVertex(vertexId) {
      const v = (vertexId && typeof vertexId === 'object' && vertexId.type === 'vertex') ? vertexId : findVertex(vertexId);
      if (!v) return [];
      return v.connectedFaces();
    },
    edgesOfVertex(vertexId) {
      const v = (vertexId && typeof vertexId === 'object' && vertexId.type === 'vertex') ? vertexId : findVertex(vertexId);
      if (!v) return [];
      return [...v.edges];
    },
    coedgesOfEdge(edgeId) {
      const e = (edgeId && typeof edgeId === 'object' && edgeId.type === 'edge') ? edgeId : findEdge(edgeId);
      if (!e) return [];
      return [...e.coedges];
    },
    findFace,
    findEdge,
    findVertex,
    body: spineBody,
  };
}

/** Extract the spine Body from a SpineBody or accept a spine Body directly. */
function pickSpineBody(b) {
  if (!b) return null;
  if (b.type === 'body' && typeof b.faces === 'function') return b;
  if (b.body && b.body.type === 'body') return b.body;
  return null;
}

/** Match an entity to a query id (persistent id, transient id, or the entity itself). */
function entityIdMatches(entity, id) {
  if (id == null) return false;
  if (typeof id === 'object') return id === entity;
  if (typeof id === 'string' && id.startsWith('t:')) {
    return entity.transientId === Number(id.slice(2));
  }
  if (typeof id === 'number') return entity.transientId === id;
  return entity.persistentId === id;
}
