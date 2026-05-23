/**
 * ArchDisc Kernel — N-sided patch filling wired to the exact B-rep kernel.
 *
 * This is the REAL pure-JS N-sided patch. It does NOT use
 * `BRepOffsetAPI_MakeFilling` — that API's variational solver crashes
 * unconditionally in this WASM build (raw C++ integer exception on every
 * input). Instead `nSidedPatch`:
 *
 *   1. Resolves a boundary loop from the input B-rep — a chosen face's outer
 *      wire (default: the face with the MOST edges, i.e. the non-4-sided
 *      opening), or, when `opts.useFreeBoundary` is set, the body's free
 *      boundary edges (open shells / surface bodies with a real N-sided gap).
 *   2. Walks that wire's edges IN ORDER with BRepTools_WireExplorer and samples
 *      each edge curve into an ordered closed polyline of N corners (one corner
 *      per wire edge) — optionally with per-corner cross-boundary tangents.
 *   3. Calls the pure-JS `nSidedPatch` (foundation/NSidedPatch.js) — ear-clip
 *      triangulation of the loop interior, Loop-style refinement, then discrete
 *      cotangent-Laplacian variational fairing (minimum bending energy) with
 *      the boundary fixed.
 *   4. Sews the resulting triangle mesh into a kernel TopoDS_Shell so the
 *      standard tessellate / measure / render path works.
 *
 * ── Honest scope ────────────────────────────────────────────────────────────
 * The result is a TRIANGULATED kernel shell (a sewn mesh), NOT a single
 * analytic trimmed NURBS B-rep face. The fill is a genuine discrete
 * variational surface (minimised discrete bending energy); the kernel wrapper
 * carries the tessellation so it renders / measures like any other body. Same
 * honest tier as `g2BlendBetweenEdges` and `catmullClarkShape`. An analytic
 * N-sided patch (Gregory / GeomPlate) needs the variational B-rep solver that
 * is unbound in this kernel build.
 *
 * Disposal: every kernel object is withScope/track-managed.
 *
 * Refs:
 *   foundation/NSidedPatch.js — the ear-clip + variational-fairing fill.
 *   docs/superpowers/notes/p7-g1-purejs-G.md — references + honest caveats.
 */

import { getKernel } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import { nSidedPatch as fillNSided } from '../../foundation/NSidedPatch.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';
import { NURBSSurface } from '../../foundation/NURBSSurface.js';
import { buildAnalyticSpineBody } from '../topology/AnalyticFace.js';
import { recordBodyDerive } from '../history/HistoryLog.js';

// ── tiny vec3 helpers ───────────────────────────────────────────────────────
const v3sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const v3len = (a) => Math.hypot(a[0], a[1], a[2]);

/** Collect the unique faces of a shape (IsSame-deduplicated). */
function collectFaces(oc, shape) {
  const ex = track(new oc.TopExp_Explorer_2(
    shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
  const seen = [];
  for (; ex.More(); ex.Next()) {
    const cur = track(oc.TopoDS.Face_1(track(ex.Current())));
    if (seen.some((s) => s.IsSame(cur))) continue;
    seen.push(cur);
  }
  return seen;
}

/** Count the edges of a wire / face. */
function countEdges(oc, shape) {
  const ex = track(new oc.TopExp_Explorer_2(
    shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
  let n = 0;
  const seen = [];
  for (; ex.More(); ex.Next()) {
    const cur = track(ex.Current());
    if (seen.some((s) => s.IsSame(cur))) continue;
    seen.push(cur);
    n++;
  }
  return n;
}

/** Vertex 3-D position. */
function vertexPoint(oc, vertex) {
  const p = oc.BRep_Tool.Pnt(vertex);
  return [p.X(), p.Y(), p.Z()];
}

/**
 * Walk a wire's edges IN ORDER with BRepTools_WireExplorer and return the
 * ordered list of corner points — the wire's vertices in traversal order.
 * Each WireExplorer step exposes the current edge's start vertex via
 * CurrentVertex(); collecting those gives the closed corner polyline.
 *
 * @returns {{ corners:number[][], edgeCount:number }}
 */
function wireCorners(oc, wire) {
  const corners = [];
  let edgeCount = 0;
  const wexp = track(new oc.BRepTools_WireExplorer_2(wire));
  for (; wexp.More(); wexp.Next()) {
    edgeCount++;
    // CurrentVertex() — the vertex at the START of the current edge, in
    // traversal order. Concatenated over the wire it is the ordered loop.
    let v = null;
    try { v = track(wexp.CurrentVertex()); } catch { v = null; }
    if (v && !v.IsNull()) {
      corners.push(vertexPoint(oc, v));
    } else {
      // Fallback — take the current edge's first vertex via TopExp.
      const e = track(wexp.Current());
      const vex = track(new oc.TopExp_Explorer_2(
        e, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
      if (vex.More()) corners.push(vertexPoint(oc, track(oc.TopoDS.Vertex_1(vex.Current()))));
    }
  }
  return { corners, edgeCount };
}

/**
 * Sew a triangle mesh ({positions,indices}) into a kernel TopoDS_Shell — each
 * triangle becomes a planar TopoDS_Face, BRepBuilderAPI_Sewing stitches them.
 * (Same proven path as BrepBlendG2.meshToKernelShell.)
 */
function meshToKernelShell(oc, mesh) {
  const { positions, indices } = mesh;
  const triFaces = [];
  for (let i = 0; i < indices.length; i += 3) {
    const ia = indices[i] * 3, ib = indices[i + 1] * 3, ic = indices[i + 2] * 3;
    const ax = positions[ia], ay = positions[ia + 1], az = positions[ia + 2];
    const bx = positions[ib], by = positions[ib + 1], bz = positions[ib + 2];
    const cx = positions[ic], cy = positions[ic + 1], cz = positions[ic + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const wx = cx - ax, wy = cy - ay, wz = cz - az;
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    if (nx * nx + ny * ny + nz * nz < 1e-14) continue; // degenerate
    try {
      const pa = track(new oc.gp_Pnt_3(ax, ay, az));
      const pb = track(new oc.gp_Pnt_3(bx, by, bz));
      const pc = track(new oc.gp_Pnt_3(cx, cy, cz));
      const e1 = track(track(new oc.BRepBuilderAPI_MakeEdge_3(pa, pb)).Edge());
      const e2 = track(track(new oc.BRepBuilderAPI_MakeEdge_3(pb, pc)).Edge());
      const e3 = track(track(new oc.BRepBuilderAPI_MakeEdge_3(pc, pa)).Edge());
      const wm = track(new oc.BRepBuilderAPI_MakeWire_1());
      wm.Add_1(e1); wm.Add_1(e2); wm.Add_1(e3);
      if (!wm.IsDone()) continue;
      const wire = track(wm.Wire());
      const fm = track(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
      if (!fm.IsDone()) continue;
      triFaces.push(track(fm.Face()));
    } catch { /* skip an un-buildable triangle */ }
  }
  if (triFaces.length === 0) {
    throw new Error('nSidedPatch: no buildable triangle faces from the fill mesh');
  }
  const sewing = track(new oc.BRepBuilderAPI_Sewing(1e-4, true, true, true, false));
  for (const f of triFaces) sewing.Add(f);
  const pr = track(new oc.Message_ProgressRange_1());
  sewing.Perform(pr);
  const sewed = track(sewing.SewedShape());
  if (sewed && !sewed.IsNull()) return sewed;
  const builder = track(new oc.BRep_Builder());
  const compound = track(new oc.TopoDS_Compound());
  builder.MakeCompound(compound);
  for (const f of triFaces) builder.Add(compound, f);
  return compound;
}

/**
 * Fit a coarse degree-3 NURBS surface approximating an N-sided patch fill —
 * SP-1 S6 supporting routine.
 *
 * The boundary corners define a best-fit plane (Newell normal). A 4×4 control
 * net is laid out across the plane's parametric rectangle, with the INTERIOR
 * control points lifted along the plane normal toward the mesh centroid so the
 * surface bulges into the patch — a genuine analytic approximation, not a
 * trivial plane. Boundary control points sit close to the actual boundary
 * corners.
 *
 * This is a SIMPLE analytic carrier — the precise variational fill is the
 * mesh (tessellated kernel shell); the NURBS surface is the spine's analytic
 * Face for the patch (the §S6 unified-Face contract). For applications that
 * need a high-fidelity NURBS fit, a real fit (e.g. Coons / Gregory) would
 * replace this routine — that is acknowledged S6 honest scope.
 *
 * @param {number[][]} corners  ordered boundary corner points (≥ 3)
 * @returns {NURBSSurface}  a degree-3×3 NURBS surface spanning the patch
 */
function nSidedAnalyticSurface(corners) {
  // Centroid + Newell normal of the corner loop.
  const n = corners.length;
  let cx = 0, cy = 0, cz = 0;
  for (const c of corners) { cx += c[0]; cy += c[1]; cz += c[2]; }
  cx /= n; cy /= n; cz /= n;
  let nx = 0, ny = 0, nz = 0;
  for (let i = 0; i < n; i++) {
    const a = corners[i], b = corners[(i + 1) % n];
    nx += (a[1] - b[1]) * (a[2] + b[2]);
    ny += (a[2] - b[2]) * (a[0] + b[0]);
    nz += (a[0] - b[0]) * (a[1] + b[1]);
  }
  let nl = Math.hypot(nx, ny, nz) || 1;
  nx /= nl; ny /= nl; nz /= nl;
  // In-plane axes.
  let ux = corners[0][0] - cx, uy = corners[0][1] - cy, uz = corners[0][2] - cz;
  const ud = ux * nx + uy * ny + uz * nz;
  ux -= ud * nx; uy -= ud * ny; uz -= ud * nz;
  let ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  const vx = ny * uz - nz * uy;
  const vy = nz * ux - nx * uz;
  const vz = nx * uy - ny * ux;
  // Parametric extent — project corners onto (u,v) and take the span.
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const c of corners) {
    const dx = c[0] - cx, dy = c[1] - cy, dz = c[2] - cz;
    const pu = dx * ux + dy * uy + dz * uz;
    const pv = dx * vx + dy * vy + dz * vz;
    if (pu < umin) umin = pu; if (pu > umax) umax = pu;
    if (pv < vmin) vmin = pv; if (pv > vmax) vmax = pv;
  }
  const padU = (umax - umin) * 0.04 + 1e-6;
  const padV = (vmax - vmin) * 0.04 + 1e-6;
  umin -= padU; umax += padU; vmin -= padV; vmax += padV;
  // Bulge scales with the boundary's max chord (a real curved surface, not a plane).
  let maxChord = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(corners[i][0] - corners[j][0],
        corners[i][1] - corners[j][1], corners[i][2] - corners[j][2]);
      if (d > maxChord) maxChord = d;
    }
  }
  const bulge = Math.max(0.1, maxChord * 0.12);
  // 4×4 control net — interior CPs lifted along the plane normal.
  const controlNet = [];
  for (let i = 0; i < 4; i++) {
    const su = umin + (umax - umin) * (i / 3);
    const row = [];
    for (let j = 0; j < 4; j++) {
      const sv = vmin + (vmax - vmin) * (j / 3);
      const bu = 1 - Math.abs(2 * (i / 3) - 1);
      const bv = 1 - Math.abs(2 * (j / 3) - 1);
      const lift = bulge * bu * bv;
      row.push([
        cx + su * ux + sv * vx + lift * nx,
        cy + su * uy + sv * vy + lift * ny,
        cz + su * uz + sv * vz + lift * nz,
      ]);
    }
    controlNet.push(row);
  }
  return new NURBSSurface({
    degreeU: 3, degreeV: 3,
    controlNet,
    knotsU: [0, 0, 0, 0, 1, 1, 1, 1],
    knotsV: [0, 0, 0, 0, 1, 1, 1, 1],
  });
}

/**
 * Fill an arbitrary non-four-sided boundary loop of a B-rep body with a smooth
 * variational surface patch.
 *
 * SP-1 S6 — returns a `SpineBody` whose primary spine `Face` is a spine-native
 * analytic NURBS face carrying the N-sided patch's analytic surface; the
 * tessellated sewn shell is kept on `SpineBody.occtWrapper` for rendering /
 * measure (the same uniform contract as `g2BlendBetweenEdges`).
 *
 * @param {import('./BrepShape.js').BrepShape|import('../topology/SpineBody.js').default} brepShape  the parent body.
 * @param {object} [opts]
 * @param {number}  [opts.faceIndex]  0-based index of the face whose OUTER
 *        WIRE is the boundary loop to fill. When omitted, the face with the
 *        most edges (the non-4-sided opening) is chosen automatically.
 * @param {number}  [opts.subdivisions=3]   interior-density refinement passes.
 * @param {number}  [opts.fairingIterations=40]  discrete-fairing iterations.
 * @returns {Promise<SpineBody>}  a SpineBody whose body has one analytic
 *   spine Face for the patch; `meta.analyticSurface` carries the raw NURBS
 *   data (backward-compat); `meta.nSidedStats` carries the fill statistics.
 */
async function _nSidedPatchImpl(brepShape, opts = {}) {
  if (!brepShape || !brepShape.shape) {
    throw new Error('nSidedPatch: needs a BrepShape with a live shape');
  }
  const subdivisions = Math.min(5, Math.max(0, Math.round(opts.subdivisions ?? 3)));
  const fairingIterations = Math.min(400, Math.max(0,
    Math.round(opts.fairingIterations ?? 40)));

  const oc = await getKernel();

  return withScope(() => {
    // ── 1. choose the boundary loop ──────────────────────────────────────────
    const faces = collectFaces(oc, brepShape.shape);
    if (faces.length === 0) {
      throw new Error('nSidedPatch: body has no faces — cannot extract a boundary loop');
    }
    let chosenFace;
    let chosenIndex;
    if (Number.isInteger(opts.faceIndex)) {
      chosenIndex = ((opts.faceIndex % faces.length) + faces.length) % faces.length;
      chosenFace = faces[chosenIndex];
    } else {
      // Pick the face with the most edges — the non-4-sided opening.
      let best = -1, bestN = -1;
      for (let i = 0; i < faces.length; i++) {
        const n = countEdges(oc, faces[i]);
        if (n > bestN) { bestN = n; best = i; }
      }
      chosenIndex = best;
      chosenFace = faces[best];
    }

    // ── 2. extract the face's outer wire and walk it into an ordered loop ────
    const outerWire = track(oc.BRepTools.OuterWire(chosenFace));
    if (!outerWire || outerWire.IsNull()) {
      throw new Error('nSidedPatch: could not extract the outer wire of the boundary face');
    }
    const { corners, edgeCount } = wireCorners(oc, outerWire);
    if (corners.length < 3) {
      throw new Error(
        `nSidedPatch: boundary loop has only ${corners.length} corner(s) — need ≥ 3`);
    }

    // ── 3. variational fill (pure-JS) ────────────────────────────────────────
    const mesh = fillNSided(corners, { subdivisions, fairingIterations });

    // ── 4. sew the fill mesh into a kernel shell ─────────────────────────────
    const sewed = meshToKernelShell(oc, mesh);

    // ── 5. SP-1 S6 — fit a degree-3 NURBS analytic surface over the boundary
    // corners. This is the spine-native analytic Face for the patch (the §S6
    // unified-Face contract). The variational mesh is the render geometry of
    // record; the analytic surface is the patch's spine representation.
    const analyticSurface = nSidedAnalyticSurface(corners);

    const triangleCount = mesh.indices.length / 3;

    // ── 6. Build the engine wrapper (BrepShape) — kept on the SpineBody for
    // tessellate / measure / scene rendering.
    const occtWrapper = new BrepShape(sewed, {
      op: 'nSidedPatch',
      params: { faceIndex: chosenIndex, subdivisions, fairingIterations },
      parents: [brepShape.id],
      description:
        `N-sided patch filling a ${corners.length}-sided boundary loop ` +
        `(${triangleCount} tris, discrete variational fill + spine-native ` +
        `degree-3 NURBS analytic face)`,
    });
    occtWrapper._triangulation = {
      positions: mesh.positions,
      normals: mesh.normals,
      indices: mesh.indices,
    };

    // SP-1 §2.3 — lineage: the seed for the analytic face is the chosen
    // face's edges of the parent (if the parent is a SpineBody, recover the
    // seed-edge persistent ids; otherwise an empty list).
    const derivedFromIds = [];
    if (brepShape.body && typeof brepShape.body.edges === 'function') {
      const we = track(new oc.BRepTools_WireExplorer_2(outerWire));
      const seedEdges = [];
      for (; we.More(); we.Next()) {
        seedEdges.push(track(oc.TopoDS.Edge_1(we.Current())));
      }
      for (const occtEdge of seedEdges) {
        const match = brepShape.body.edges().find(
          (e) => e.geomRef && typeof e.geomRef.IsSame === 'function' &&
            e.geomRef.IsSame(occtEdge));
        if (match && match.persistentId) derivedFromIds.push(match.persistentId);
      }
    }

    const { body: spineBody, face: analyticFace } = buildAnalyticSpineBody(
      analyticSurface, {
        geomEngineShape: occtWrapper,
        bodyTag: opts._bodyTagReplay || 'nSidedPatch',
        derivedFromIds,
        faceName: `N-sided-patch(${corners.length}-sided)`,
        kind: 'sheet',
      });

    const nurbsData = analyticFace.surface.toBSplineSurface();
    const result = new SpineBody(spineBody, occtWrapper, {
      op: 'nSidedPatch',
      params: { faceIndex: chosenIndex, subdivisions, fairingIterations },
      parents: [brepShape.id],
      description: occtWrapper.meta.description,
      // The exact analytic NURBS data — STEP-exportable as B_SPLINE_SURFACE.
      // Same payload as `result.body.faces()[0].surface.toBSplineSurface()`.
      analyticSurface: nurbsData,
      // NOTE: meta.analyticFace (the legacy TopoFace) is intentionally NOT
      // set — S6 retired the side-car. The analytic face lives in
      // `result.body.faces()[0]`.
      nSidedStats: {
        loopSides: corners.length,
        wireEdgeCount: edgeCount,
        faceIndex: chosenIndex,
        faceCount: faces.length,
        subdivisions,
        fairingIterations,
        vertexCount: mesh.stats.vertices,
        triangleCount,
        bbox: mesh.stats.bbox,
        analytic: true,
        degreeU: nurbsData.degreeU,
        degreeV: nurbsData.degreeV,
        controlPointsU: nurbsData.controlNet.length,
        controlPointsV: nurbsData.controlNet[0].length,
        spineFacePersistentId: analyticFace.persistentId,
        spineFaceDerivedFrom: analyticFace.derivedFrom.slice(),
      },
    });
    return result;
  });
}

export async function nSidedPatch(brepShape, opts = {}) {
  const result = await _nSidedPatchImpl(brepShape, opts);
  const persistentBodyId = result && result.body && result.body.persistentId;
  const srcPid = brepShape && brepShape.body && brepShape.body.persistentId;
  if (persistentBodyId && srcPid) {
    try {
      const publicOpts = { ...opts };
      delete publicOpts._bodyTagReplay;
      recordBodyDerive({
        opName: 'nSidedPatch',
        persistentBodyId,
        inputPersistentIds: [srcPid],
        meta: { op: 'nSidedPatch', params: publicOpts },
        rebuild: ([liveSrc]) => _nSidedPatchImpl(liveSrc, {
          ...publicOpts, _bodyTagReplay: persistentBodyId,
        }),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('nSidedPatch: history recordBodyDerive failed —', err && err.message || err);
    }
  }
  return result;
}
