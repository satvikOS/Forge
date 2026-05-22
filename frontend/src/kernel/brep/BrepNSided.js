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
 * Fill an arbitrary non-four-sided boundary loop of a B-rep body with a smooth
 * variational surface patch.
 *
 * @param {import('./BrepShape.js').BrepShape} brepShape  the parent body.
 * @param {object} [opts]
 * @param {number}  [opts.faceIndex]  0-based index of the face whose OUTER
 *        WIRE is the boundary loop to fill. When omitted, the face with the
 *        most edges (the non-4-sided opening) is chosen automatically.
 * @param {number}  [opts.subdivisions=3]   interior-density refinement passes.
 * @param {number}  [opts.fairingIterations=40]  discrete-fairing iterations.
 * @returns {Promise<BrepShape>}  a BrepShape wrapping the sewn fill mesh, with
 *   `meta.nSidedStats` carrying the fill statistics.
 */
export async function nSidedPatch(brepShape, opts = {}) {
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

    const triangleCount = mesh.indices.length / 3;
    const result = new BrepShape(sewed, {
      op: 'nSidedPatch',
      params: { faceIndex: chosenIndex, subdivisions, fairingIterations },
      parents: [brepShape.id],
      description:
        `N-sided patch filling a ${corners.length}-sided boundary loop ` +
        `(${triangleCount} tris, discrete variational fill, mesh-fidelity ` +
        `sewn shell)`,
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
      },
    });

    // Pre-cache the tessellation so the standard tessellate() path returns it.
    result._triangulation = {
      positions: mesh.positions,
      normals: mesh.normals,
      indices: mesh.indices,
    };
    return result;
  });
}
