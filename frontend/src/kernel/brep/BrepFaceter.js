/**
 * ArchDisc Kernel — Faceter option surface (SP-7, Area I).
 *
 * Parasolid/ACIS faceter parity: a real faceter control surface — chordal
 * (linear) AND angular deflection as independent parameters, distinct render
 * vs analysis mesh quality profiles, and hidden-line / silhouette extraction.
 *
 * ── Recon (e2e/brep-i-faceter-recon-electron.spec.js → kernel-api-I-recon.json)
 * opencascade.js@2.0.0-beta exposes, all verified:
 *   • BRepMesh_IncrementalMesh_2(shape, linDefl, isRelative, angDefl, parallel)
 *   • BRepMesh_IncrementalMesh_3(shape, IMeshTools_Parameters, progressRange)
 *   • IMeshTools_Parameters — Deflection, Angle, DeflectionInterior,
 *     AngleInterior, MinSize, Relative, InParallel, AllowQualityDecrease,
 *     ControlSurfaceDeflection all writable.
 *   • HLRBRep_Algo_1() + HLRAlgo_Projector_2(gp_Ax2) + Add_2(shape,0) +
 *     Update() + Hide_1(); HLRBRep_HLRToShape(Handle_HLRBRep_Algo_2(algo))
 *     with VCompound_1 / OutLineVCompound_1 / HCompound_1 / OutLineHCompound_1.
 *   The HLR pipeline IS fully bound — no binding gap. A pure-JS silhouette
 *   extractor is ALSO provided (mesh-edge view-dot-sign test) as a fast,
 *   kernel-free path used for live viewport silhouette overlays.
 *
 * Positions are in mm throughout (the app wraps meshes in a 0.001 group).
 */

import { getOCCT } from './kernelLoader.js';
import { track, withScope } from './BrepShape.js';

// ─── Quality profiles ────────────────────────────────────────────────────────

/**
 * Faceter quality profiles. Two distinct intents:
 *   • render   — display-tuned: coarser, fast, looks good on screen.
 *   • analysis — simulation/curvature-grade: much finer, ControlSurfaceDeflection
 *     ON so the triangulation tracks the true surface tightly.
 *
 * `chordalScale` / `angularScale` are the per-profile multipliers applied to
 * the model's bounding-box diagonal (chordal) and to a base angular tol. A
 * caller can also pass explicit chordal/angular values to override.
 */
export const FACETER_PROFILES = {
  render: {
    label: 'Render mesh',
    chordalFraction: 1 / 800,   // chordal tol = bboxDiag / 800
    angularDeg: 28,             // ~0.49 rad
    minSizeFraction: 1 / 25000,
    controlSurface: false,
  },
  analysis: {
    label: 'Analysis mesh',
    chordalFraction: 1 / 6000,  // ~7.5× finer than render
    angularDeg: 8,              // ~0.14 rad
    minSizeFraction: 1 / 200000,
    controlSurface: true,
  },
};

// Hard clamps so a deflection value cannot explode the triangle budget or
// collapse to a degenerate mesh. Chordal tol is in mm; angular in radians.
const CHORDAL_MIN_MM = 1e-4;
const CHORDAL_MAX_MM = 1e4;
const ANGULAR_MIN_RAD = 0.02;   // ~1.1°  — finer than this rarely helps
const ANGULAR_MAX_RAD = 1.4;    // ~80°   — coarser makes curves polygonal
// If a requested chordal tol vs the model size would obviously produce a
// runaway mesh we clamp and warn rather than hang the kernel.
const RUNAWAY_RATIO = 2_000_000; // bboxDiag / chordal beyond this → clamp

// ─── Bounding-box helper ─────────────────────────────────────────────────────

/** Axis-aligned bbox of a shape, in mm. Returns {min,max,diag}. */
function shapeBBox(oc, shape) {
  const bb = track(new oc.Bnd_Box_1());
  oc.BRepBndLib.Add(shape, bb, false);
  if (bb.IsVoid()) {
    return { min: [0, 0, 0], max: [0, 0, 0], diag: 1 };
  }
  const mn = track(bb.CornerMin());
  const mx = track(bb.CornerMax());
  const min = [mn.X(), mn.Y(), mn.Z()];
  const max = [mx.X(), mx.Y(), mx.Z()];
  const diag = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) || 1;
  return { min, max, diag };
}

// ─── Deflection resolution ───────────────────────────────────────────────────

/**
 * Resolve the effective chordal + angular deflection for a faceting request.
 *
 * @param {number} bboxDiag           model bounding-box diagonal (mm)
 * @param {object} opts
 * @param {'render'|'analysis'} [opts.profile]   quality profile (default render)
 * @param {number} [opts.chordalMm]   explicit chordal/linear tol (mm) — overrides profile
 * @param {number} [opts.angularDeg]  explicit angular tol (degrees) — overrides profile
 * @param {number} [opts.minSizeMm]   explicit min triangle edge (mm)
 * @returns {{chordalMm:number, angularRad:number, minSizeMm:number,
 *            controlSurface:boolean, profile:string, warnings:string[]}}
 */
export function resolveFaceterParams(bboxDiag, opts = {}) {
  const profileName = FACETER_PROFILES[opts.profile] ? opts.profile : 'render';
  const profile = FACETER_PROFILES[profileName];
  const warnings = [];

  // Chordal (linear) deflection.
  let chordalMm = (opts.chordalMm != null && Number.isFinite(opts.chordalMm) && opts.chordalMm > 0)
    ? opts.chordalMm
    : bboxDiag * profile.chordalFraction;
  // Runaway guard: an absurdly tight tol vs a large model would blow the
  // triangle budget — clamp to the largest tol that still gives a fine mesh.
  if (bboxDiag / chordalMm > RUNAWAY_RATIO) {
    const clamped = bboxDiag / RUNAWAY_RATIO;
    warnings.push(
      `chordal tol ${chordalMm.toExponential(2)} mm vs model ${bboxDiag.toFixed(1)} mm ` +
      `would explode the triangle count — clamped to ${clamped.toExponential(2)} mm`);
    chordalMm = clamped;
  }
  if (chordalMm < CHORDAL_MIN_MM) {
    warnings.push(`chordal tol clamped up to ${CHORDAL_MIN_MM} mm (was ${chordalMm.toExponential(2)})`);
    chordalMm = CHORDAL_MIN_MM;
  }
  if (chordalMm > CHORDAL_MAX_MM) {
    warnings.push(`chordal tol clamped down to ${CHORDAL_MAX_MM} mm`);
    chordalMm = CHORDAL_MAX_MM;
  }

  // Angular deflection.
  const angDeg = (opts.angularDeg != null && Number.isFinite(opts.angularDeg) && opts.angularDeg > 0)
    ? opts.angularDeg
    : profile.angularDeg;
  let angularRad = (angDeg * Math.PI) / 180;
  if (angularRad < ANGULAR_MIN_RAD) {
    warnings.push(`angular tol clamped up to ${(ANGULAR_MIN_RAD * 180 / Math.PI).toFixed(1)}°`);
    angularRad = ANGULAR_MIN_RAD;
  }
  if (angularRad > ANGULAR_MAX_RAD) {
    warnings.push(`angular tol clamped down to ${(ANGULAR_MAX_RAD * 180 / Math.PI).toFixed(1)}°`);
    angularRad = ANGULAR_MAX_RAD;
  }

  // Minimum triangle edge.
  let minSizeMm = (opts.minSizeMm != null && Number.isFinite(opts.minSizeMm) && opts.minSizeMm > 0)
    ? opts.minSizeMm
    : bboxDiag * profile.minSizeFraction;
  // Min-size must stay well below chordal tol or it starves the mesher.
  if (minSizeMm > chordalMm * 0.5) minSizeMm = chordalMm * 0.5;
  if (minSizeMm <= 0) minSizeMm = CHORDAL_MIN_MM * 0.1;

  return {
    chordalMm,
    angularRad,
    minSizeMm,
    controlSurface: opts.controlSurface != null ? !!opts.controlSurface : profile.controlSurface,
    profile: profileName,
    warnings,
  };
}

// ─── Triangle extraction (shared by mesh + analysis paths) ───────────────────

/**
 * Extract triangles + per-vertex normals from an already-meshed shape.
 * Handles non-identity face locations and reversed face orientation.
 * Returns plain typed arrays (mm).
 */
function extractTriangles(oc, shape) {
  const positions = [];
  const indices = [];
  const exp = track(new oc.TopExp_Explorer_2(
    shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
  const loc = track(new oc.TopLoc_Location_1());
  let faceCount = 0;
  let degenerateFaces = 0;
  for (; exp.More(); exp.Next()) {
    const face = track(oc.TopoDS.Face_1(exp.Current()));
    faceCount++;
    const triHandle = oc.BRep_Tool.Triangulation(face, loc, 0);
    if (triHandle) track(triHandle);
    if (!triHandle || triHandle.IsNull()) { degenerateFaces++; continue; }
    const tri = triHandle.get();
    const nbNodes = tri.NbNodes();
    const nbTri = tri.NbTriangles();
    if (nbNodes < 3 || nbTri < 1) { degenerateFaces++; continue; }
    const base = positions.length / 3;
    if (loc.IsIdentity()) {
      for (let i = 1; i <= nbNodes; i++) {
        const p = tri.Node(i);
        positions.push(p.X(), p.Y(), p.Z());
      }
    } else {
      const t = loc.Transformation();
      const m11 = t.Value(1, 1), m12 = t.Value(1, 2), m13 = t.Value(1, 3), m14 = t.Value(1, 4);
      const m21 = t.Value(2, 1), m22 = t.Value(2, 2), m23 = t.Value(2, 3), m24 = t.Value(2, 4);
      const m31 = t.Value(3, 1), m32 = t.Value(3, 2), m33 = t.Value(3, 3), m34 = t.Value(3, 4);
      for (let i = 1; i <= nbNodes; i++) {
        const p = tri.Node(i);
        const px = p.X(), py = p.Y(), pz = p.Z();
        positions.push(
          m11 * px + m12 * py + m13 * pz + m14,
          m21 * px + m22 * py + m23 * pz + m24,
          m31 * px + m32 * py + m33 * pz + m34);
      }
    }
    const oriVal = face.Orientation_1();
    const reversedVal = oc.TopAbs_Orientation.TopAbs_REVERSED;
    const reversed = (typeof oriVal === 'number')
      ? oriVal === reversedVal
      : (oriVal && reversedVal && oriVal.value === reversedVal.value);
    for (let i = 1; i <= nbTri; i++) {
      const t = tri.Triangle(i);
      const a = base + t.Value(1) - 1;
      const b = base + t.Value(2) - 1;
      const c = base + t.Value(3) - 1;
      if (reversed) indices.push(a, c, b);
      else indices.push(a, b, c);
    }
  }
  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    faceCount,
    degenerateFaces,
  };
}

/** Per-vertex normals (area-weighted face-normal accumulation). */
function computeNormals(positions, indices) {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
    const ux = positions[ib] - positions[ia];
    const uy = positions[ib + 1] - positions[ia + 1];
    const uz = positions[ib + 2] - positions[ia + 2];
    const vx = positions[ic] - positions[ia];
    const vy = positions[ic + 1] - positions[ia + 1];
    const vz = positions[ic + 2] - positions[ia + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const idx of [ia, ib, ic]) {
      normals[idx] += nx; normals[idx + 1] += ny; normals[idx + 2] += nz;
    }
  }
  for (let i = 0; i < normals.length; i += 3) {
    const len = Math.hypot(normals[i], normals[i + 1], normals[i + 2]) || 1;
    normals[i] /= len; normals[i + 1] /= len; normals[i + 2] /= len;
  }
  return normals;
}

// ─── Public: controlled-deflection faceting ──────────────────────────────────

/**
 * Facet a BrepShape with full faceter control — independent chordal AND
 * angular deflection, a render-vs-analysis quality profile, edge-case
 * clamping. This is the SP-7 controlled-deflection meshing entry point.
 *
 * Uses the IMeshTools_Parameters constructor when bound (it exposes interior
 * tol independently of boundary tol — the Parasolid-grade path); falls back
 * to the explicit-args BRepMesh_IncrementalMesh_2 form otherwise.
 *
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @param {object} [opts]  see resolveFaceterParams + { profile }
 * @returns {Promise<{positions:Float32Array, normals:Float32Array,
 *   indices:Uint32Array, triangleCount:number, vertexCount:number,
 *   faceCount:number, degenerateFaces:number, params:object}>}
 */
export async function facetShape(brepShape, opts = {}) {
  return withScope(async () => {
    const oc = await getOCCT();
    const shape = brepShape.shape;
    const { diag } = shapeBBox(oc, shape);
    const params = resolveFaceterParams(diag, opts);

    let usedParametersForm = false;
    // Preferred: IMeshTools_Parameters — sets boundary AND interior tol so the
    // face interior is faceted to the same chord/angle as the boundary edges.
    // Recon (kernel-api-I-recon.json): the bound ctor is the UNDECORATED
    // `IMeshTools_Parameters` (no `_1` suffix in opencascade.js@2.0.0-beta).
    try {
      const mp = track(new oc.IMeshTools_Parameters());
      mp.Deflection = params.chordalMm;
      mp.DeflectionInterior = params.chordalMm;
      mp.Angle = params.angularRad;
      mp.AngleInterior = params.angularRad;
      mp.MinSize = params.minSizeMm;
      mp.Relative = false;
      mp.InParallel = true;
      mp.AllowQualityDecrease = true;
      // ControlSurfaceDeflection re-checks each triangle's deviation from the
      // true surface — essential for an analysis-grade mesh, off for render
      // (it costs time and the extra fidelity is invisible on screen).
      mp.ControlSurfaceDeflection = params.controlSurface;
      const pr = track(new oc.Message_ProgressRange_1());
      track(new oc.BRepMesh_IncrementalMesh_3(shape, mp, pr));
      usedParametersForm = true;
    } catch {
      // Fallback: explicit-args form (boundary tol only).
      track(new oc.BRepMesh_IncrementalMesh_2(
        shape, params.chordalMm, false, params.angularRad, false));
    }

    const { positions, indices, faceCount, degenerateFaces } = extractTriangles(oc, shape);
    const normals = computeNormals(positions, indices);

    return {
      positions,
      normals,
      indices,
      triangleCount: indices.length / 3,
      vertexCount: positions.length / 3,
      faceCount,
      degenerateFaces,
      params: { ...params, usedParametersForm },
    };
  });
}

/**
 * Convenience: facet at the render profile (display-tuned).
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @param {object} [opts]
 */
export function facetRenderMesh(brepShape, opts = {}) {
  return facetShape(brepShape, { ...opts, profile: 'render' });
}

/**
 * Convenience: facet at the analysis profile (simulation/curvature-grade —
 * much finer, surface-deflection-controlled).
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @param {object} [opts]
 */
export function facetAnalysisMesh(brepShape, opts = {}) {
  return facetShape(brepShape, { ...opts, profile: 'analysis' });
}

// ─── Hidden-line / silhouette: OCCT HLR path ─────────────────────────────────

/** Collect every TopoDS_EDGE of a (possibly compound) shape as polylines. */
function edgesToPolylines(oc, shape, deflMm) {
  const polylines = [];
  if (!shape || shape.IsNull()) return polylines;
  const exp = track(new oc.TopExp_Explorer_2(
    shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
  for (; exp.More(); exp.Next()) {
    const edge = track(oc.TopoDS.Edge_1(exp.Current()));
    try {
      // Discretise the edge's 3D curve with a uniform deflection.
      // Recon (item 6): GCPnts_UniformDeflection_2(adaptor, defl, withControl)
      // is the bound 3-arg overload.
      const adaptor = track(new oc.BRepAdaptor_Curve_2(edge));
      const gcpnts = track(new oc.GCPnts_UniformDeflection_2(adaptor, deflMm, false));
      if (gcpnts.IsDone() && gcpnts.NbPoints() >= 2) {
        const pts = [];
        for (let i = 1; i <= gcpnts.NbPoints(); i++) {
          const p = gcpnts.Value(i);
          pts.push([p.X(), p.Y(), p.Z()]);
        }
        polylines.push(pts);
      }
    } catch {
      // Some HLR result edges are 2D-only; skip what cannot be discretised.
    }
  }
  return polylines;
}

/**
 * Hidden-line removal + silhouette extraction via OCCT HLRBRep_Algo.
 *
 * Recon-verified pipeline (kernel-api-I-recon.json item 5 — fully bound):
 *   HLRBRep_Algo_1() → Projector_1(HLRAlgo_Projector_2(gp_Ax2))
 *   → Add_2(shape, 0) → Update() → Hide_1()
 *   → HLRBRep_HLRToShape(Handle_HLRBRep_Algo_2(algo))
 *
 * @param {import('./BrepShape.js').BrepShape} brepShape
 * @param {object} opts
 * @param {[number,number,number]} [opts.viewDir]  view direction (default [0,0,1])
 * @param {number} [opts.deflectionMm]             edge discretisation tol
 * @returns {Promise<{visibleSharp:Array, visibleOutline:Array,
 *   hiddenSharp:Array, hiddenOutline:Array, viewDir:number[], method:string}>}
 */
export async function hiddenLineProjection(brepShape, opts = {}) {
  return withScope(async () => {
    const oc = await getOCCT();
    const shape = brepShape.shape;
    const viewDir = normalize(opts.viewDir || [0, 0, 1]);
    const { diag } = shapeBBox(oc, shape);
    const deflMm = (opts.deflectionMm && opts.deflectionMm > 0)
      ? opts.deflectionMm : diag / 600;

    // Orthographic projector along viewDir.
    const origin = track(new oc.gp_Pnt_3(0, 0, 0));
    const dir = track(new oc.gp_Dir_4(viewDir[0], viewDir[1], viewDir[2]));
    const ax2 = track(new oc.gp_Ax2_3(origin, dir));
    const projector = track(new oc.HLRAlgo_Projector_2(ax2));

    const algo = track(new oc.HLRBRep_Algo_1());
    algo.Projector_1(projector);
    algo.Add_2(shape, 0);
    algo.Update();
    algo.Hide_1();

    // HLRBRep_HLRToShape needs a Handle_HLRBRep_Algo, not the raw object.
    const handle = track(new oc.Handle_HLRBRep_Algo_2(algo));
    const toShape = track(new oc.HLRBRep_HLRToShape(handle));

    // Visible: VCompound (sharp edges) + OutLineVCompound (silhouette).
    // Hidden:  HCompound (sharp edges) + OutLineHCompound (silhouette).
    const result = {
      visibleSharp: [], visibleOutline: [],
      hiddenSharp: [], hiddenOutline: [],
      viewDir, method: 'occt-hlr', edgeCount: 0,
    };
    const grab = (fnNames) => {
      for (const fn of fnNames) {
        if (typeof toShape[fn] !== 'function') continue;
        try {
          const comp = track(toShape[fn]());
          if (comp && !comp.IsNull()) return edgesToPolylines(oc, comp, deflMm);
        } catch { /* try next overload */ }
      }
      return [];
    };
    result.visibleSharp = grab(['VCompound_1', 'VCompound_2']);
    result.visibleOutline = grab(['OutLineVCompound_1', 'OutLineVCompound_2']);
    result.hiddenSharp = grab(['HCompound_1', 'HCompound_2']);
    result.hiddenOutline = grab(['OutLineHCompound_1', 'OutLineHCompound_2']);
    result.edgeCount = result.visibleSharp.length + result.visibleOutline.length
      + result.hiddenSharp.length + result.hiddenOutline.length;
    return result;
  });
}

// ─── Silhouette: pure-JS mesh-edge path (fast, kernel-free) ──────────────────

/** Normalize a 3-vector. */
function normalize(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

/**
 * Pure-JS silhouette extraction from a triangle mesh.
 *
 * A silhouette edge is a mesh edge whose two adjacent triangles face
 * OPPOSITE ways relative to the view direction — i.e. one front-facing, one
 * back-facing: `dot(nA,view) * dot(nB,view) < 0`. Boundary edges (only one
 * adjacent triangle) are always silhouette edges. This is the standard
 * real-time silhouette test (Hertzmann 1999) — it needs no B-rep, so it is
 * the path used for the live viewport silhouette overlay where re-running
 * the kernel HLR per camera frame would be too slow.
 *
 * @param {Float32Array|number[]} positions  mm, xyz triplets
 * @param {Uint32Array|number[]} indices     triangle vertex indices
 * @param {[number,number,number]} viewDir   camera→model view direction
 * @returns {{segments:Array<[number[],number[]]>, silhouetteEdges:number,
 *   boundaryEdges:number}}  segments are pairs of mm endpoints.
 */
export function meshSilhouette(positions, indices, viewDir) {
  const view = normalize(viewDir || [0, 0, 1]);
  const triCount = indices.length / 3;

  // Per-triangle face normal + its dot with the view direction.
  const triDot = new Float32Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const ia = indices[t * 3] * 3;
    const ib = indices[t * 3 + 1] * 3;
    const ic = indices[t * 3 + 2] * 3;
    const ux = positions[ib] - positions[ia];
    const uy = positions[ib + 1] - positions[ia + 1];
    const uz = positions[ib + 2] - positions[ia + 2];
    const vx = positions[ic] - positions[ia];
    const vy = positions[ic + 1] - positions[ia + 1];
    const vz = positions[ic + 2] - positions[ia + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    triDot[t] = nx * view[0] + ny * view[1] + nz * view[2];
  }

  // Weld vertices by quantised position so an edge shared by two triangles
  // with distinct (but coincident) vertex indices is still recognised.
  const weld = new Map();
  const weldId = new Int32Array(positions.length / 3);
  const Q = 1e4; // 0.1 µm grid — finer than any real CAD tolerance
  for (let v = 0; v < positions.length / 3; v++) {
    const kx = Math.round(positions[v * 3] * Q);
    const ky = Math.round(positions[v * 3 + 1] * Q);
    const kz = Math.round(positions[v * 3 + 2] * Q);
    const key = `${kx},${ky},${kz}`;
    let id = weld.get(key);
    if (id === undefined) { id = weld.size; weld.set(key, id); }
    weldId[v] = id;
  }

  // Map each welded edge → the triangles touching it.
  const edgeTris = new Map(); // "lo|hi" → [triIdx, ...]
  const edgeRep = new Map();  // "lo|hi" → [endpointA(mm), endpointB(mm)]
  const addEdge = (vA, vB, t) => {
    const a = weldId[vA], b = weldId[vB];
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const key = `${lo}|${hi}`;
    let arr = edgeTris.get(key);
    if (!arr) {
      arr = [];
      edgeTris.set(key, arr);
      edgeRep.set(key, [
        [positions[vA * 3], positions[vA * 3 + 1], positions[vA * 3 + 2]],
        [positions[vB * 3], positions[vB * 3 + 1], positions[vB * 3 + 2]],
      ]);
    }
    arr.push(t);
  };
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3], b = indices[t * 3 + 1], c = indices[t * 3 + 2];
    addEdge(a, b, t); addEdge(b, c, t); addEdge(c, a, t);
  }

  const segments = [];
  let silhouetteEdges = 0;
  let boundaryEdges = 0;
  for (const [key, tris] of edgeTris) {
    let isSilhouette = false;
    if (tris.length === 1) {
      // Open boundary edge — always a silhouette.
      isSilhouette = true;
      boundaryEdges++;
    } else if (tris.length >= 2) {
      // Front/back straddle test across the (first) adjacent pair.
      const dA = triDot[tris[0]];
      const dB = triDot[tris[1]];
      if (dA * dB < 0) { isSilhouette = true; silhouetteEdges++; }
    }
    if (isSilhouette) segments.push(edgeRep.get(key));
  }
  return { segments, silhouetteEdges, boundaryEdges };
}
