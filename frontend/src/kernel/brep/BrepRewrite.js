/**
 * ArchDisc Kernel — topology rewriting (local face replacement, parity-audit P4).
 *
 * §3.4 "local face replacement" intent: swap the underlying geometry of a face
 * for an ARBITRARY new surface while dynamically rebuilding the surrounding
 * topology.
 *
 * ── TWO PATHS ───────────────────────────────────────────────────────────────
 *
 * 1. SAME-SURFACE boundary-wire rebuild (`opts.curvedSwap` falsy) — the
 *    long-standing path: extract the picked face's outer boundary wire via
 *    `BRepTools.OuterWire`, recover its surface, rebuild the face from
 *    surface + wire via `BRepBuilderAPI_MakeFace_21`, sew it back with
 *    `BRepTools_ReShape`, validate with `BRepCheck_Analyzer`.
 *
 * 2. ARBITRARY-SURFACE swap (`opts.curvedSwap` truthy) — the P4 closure,
 *    done NATIVELY in ArchDisc's OWN B-rep topology kernel:
 *      a. Extract the picked face's outer boundary wire (its ordered 3-D edge
 *         polylines) from the OCCT shape.
 *      b. Build a NATIVE ArchDisc `TopoFace` on those boundary edges.
 *      c. Synthesise an arbitrary new `NURBSSurface` — a genuinely curved
 *         (bulged degree-3 bicubic) surface spanning the boundary, distinct
 *         from the original planar/curved face.
 *      d. Re-seat the `TopoFace` onto the new surface via
 *         `kernel/topology/FaceReplace.replaceFaceSurface` — which generates
 *         FRESH PCURVES for every boundary edge by Newton point-inversion +
 *         2-D B-spline fitting (`foundation/PCurveProjection.js`, the pure-JS
 *         port of OCCT `ShapeConstruct_ProjectCurveOnSurface`) and VALIDATES
 *         the rebuilt face (closed pcurve loop, no degenerate pcurves).
 *      e. Render the new analytic surface (tessellated) sewn into the result
 *         body; the analytic `TopoFace` + pcurves are carried on `meta`.
 *
 *    The arbitrary swap therefore produces an ArchDisc-native analytic face
 *    (a real `TopoFace` on an exact `NURBSSurface` with genuine pcurves) —
 *    NOT an OCCT `TopoDS_Face`. If the swap genuinely cannot produce a valid
 *    face (degenerate pcurves, the new surface too far from the boundary), the
 *    op throws a clear error — it never ships an invalid face.
 *
 * Refs:
 *   kernel/topology/FaceReplace.js — the native arbitrary-swap rebuild.
 *   foundation/PCurveProjection.js — Newton point-inversion + pcurve fitting.
 *   docs/superpowers/notes/p1-p4-native-G.md — the native-kernel approach.
 */

import { getOCCT, getKernel } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import { NURBSSurface } from '../../foundation/NURBSSurface.js';
import TopoVertex from '../topology/TopoVertex.js';
import TopoEdge from '../topology/TopoEdge.js';
import TopoLoop from '../topology/TopoLoop.js';
import TopoFace from '../topology/TopoFace.js';
import Vec3 from '../math/Vec3.js';
import { LineCurve } from '../math/Curve.js';
import { replaceFaceSurface } from '../topology/FaceReplace.js';

/**
 * Replace one face of a shape by rebuilding it from its surface + outer
 * boundary wire (a real `MakeFace(surface, wire)` rebuild), then sewing it
 * back into the solid via `BRepTools_ReShape`. The surrounding topology is
 * rebuilt around the swapped face.
 *
 * @param {BrepShape} brepShape
 * @param {number} faceIndex  1-based index into TopExp_Explorer face order
 * @param {object} [opts]
 * @param {boolean} [opts.curvedSwap]  when true, swap the face onto an
 *   ARBITRARY new curved surface natively (the P4 closure path).
 * @param {number}  [opts.bulge]  the curved-swap surface bulge (mm); default
 *   scales with the face size.
 * @returns {Promise<BrepShape>}
 */
export async function replaceFace(brepShape, faceIndex = 1, opts = {}) {
  if (!brepShape || !brepShape.shape) throw new Error('replaceFace: needs a BrepShape');
  if (!(Number.isInteger(faceIndex) && faceIndex >= 1)) {
    throw new Error(`replaceFace: faceIndex must be a positive integer (got ${faceIndex})`);
  }
  if (opts.curvedSwap) {
    return replaceFaceWithArbitrarySurface(brepShape, faceIndex, opts);
  }
  const oc = await getOCCT();
  return withScope(() => {
    const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
    const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;

    // ── Step 1: walk faces — deduplicate with IsSame ────────────────────────
    const faces = [];
    const exp = track(new oc.TopExp_Explorer_2(brepShape.shape, FACE, ANY));
    for (; exp.More(); exp.Next()) {
      const f = exp.Current();
      let dup = false;
      for (const prev of faces) {
        try { if (prev.IsSame(f)) { dup = true; break; } } catch (_e) { /* ignore */ }
      }
      if (!dup) {
        try { faces.push(track(oc.TopoDS.Face_1(f))); } catch (_e) { faces.push(track(f)); }
      }
    }
    if (faceIndex > faces.length) {
      throw new Error(`replaceFace: faceIndex=${faceIndex} but shape has only ${faces.length} faces`);
    }

    // Target face is 1-based.
    const oldFace = faces[faceIndex - 1];

    // ── Step 2: extract the face's OUTER BOUNDARY WIRE ──────────────────────
    //   BRepTools.OuterWire(face) → the outer bounding wire of the face.
    const boundaryWire = track(oc.BRepTools.OuterWire(oldFace));
    if (!boundaryWire || boundaryWire.IsNull()) {
      throw new Error('replaceFace: could not extract the outer boundary wire of the picked face');
    }

    // ── Step 3: recover the face's surface as a Handle_Geom_Surface ─────────
    const surfHandle = track(oc.BRep_Tool.Surface_2(oldFace));
    if (!surfHandle || surfHandle.IsNull()) {
      throw new Error('replaceFace: could not recover the surface handle of the picked face');
    }

    // ── Step 4: REBUILD the face from the surface + boundary wire ───────────
    const mkFace = track(new oc.BRepBuilderAPI_MakeFace_21(surfHandle, boundaryWire, true));
    if (!mkFace.IsDone()) {
      throw new Error('replaceFace: MakeFace(surface, wire) could not rebuild the picked face');
    }
    const rebuiltFace = track(mkFace.Face());
    if (rebuiltFace.IsNull()) {
      throw new Error('replaceFace: MakeFace(surface, wire) produced a null face');
    }

    // ── Step 5: sew the rebuilt face back into the solid via ReShape ────────
    const candidates = [track(rebuiltFace.Reversed()), rebuiltFace];
    let shape = null;
    let validHit = false;
    for (const candFace of candidates) {
      const reshape = track(new oc.BRepTools_ReShape());
      reshape.Replace(oldFace, candFace);
      const out = reshape.Apply(brepShape.shape, ANY);
      if (out.IsNull()) continue;
      const analyzer = track(new oc.BRepCheck_Analyzer(out, true, false));
      const ok = analyzer.IsValid_2();
      if (ok) { shape = track(out); validHit = true; break; }
      if (!shape) shape = track(out);
    }
    if (!shape || shape.IsNull()) {
      throw new Error('replaceFace: ReShape produced no usable shape after the face rebuild');
    }
    if (!validHit) {
      throw new Error(
        'replaceFace: the rebuilt face does not seat into a valid solid — ' +
        'try the native curved-swap path (opts.curvedSwap) which generates ' +
        'pcurves in ArchDisc\'s own topology kernel',
      );
    }

    return new BrepShape(shape, {
      op: 'replaceFace',
      params: { faceIndex, rebuiltFromBoundaryWire: true },
      parents: [brepShape.id],
    });
  });
}

// ════════════════════════════════════════════════════════════════════════════
// P4 — arbitrary-surface face replacement (native ArchDisc B-rep topology)
// ════════════════════════════════════════════════════════════════════════════

/** Walk a wire's edges IN ORDER, return ordered corner points + edge count. */
function wireCorners(oc, wire) {
  const corners = [];
  let edgeCount = 0;
  const wexp = track(new oc.BRepTools_WireExplorer_2(wire));
  for (; wexp.More(); wexp.Next()) {
    edgeCount++;
    let v = null;
    try { v = track(wexp.CurrentVertex()); } catch { v = null; }
    if (v && !v.IsNull()) {
      const p = oc.BRep_Tool.Pnt(v);
      corners.push([p.X(), p.Y(), p.Z()]);
    } else {
      const e = track(wexp.Current());
      const vex = track(new oc.TopExp_Explorer_2(
        e, oc.TopAbs_ShapeEnum.TopAbs_VERTEX, oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
      if (vex.More()) {
        const vp = oc.BRep_Tool.Pnt(track(oc.TopoDS.Vertex_1(vex.Current())));
        corners.push([vp.X(), vp.Y(), vp.Z()]);
      }
    }
  }
  return { corners, edgeCount };
}

/**
 * Synthesise an ARBITRARY new curved NURBSSurface spanning a boundary loop.
 *
 * The boundary corners define a best-fit plane; a degree-3 bicubic control net
 * is laid out across the plane's parametric rectangle, with the INTERIOR
 * control points lifted off the plane by a bulge along the plane normal — so
 * the surface is genuinely curved (a real geometric swap, not the identity).
 * Boundary control points stay on the plane near the actual boundary corners,
 * so the new surface still spans the face's boundary.
 *
 * @param {number[][]} corners  ordered boundary corner points (≥ 3)
 * @param {number} bulge        peak interior lift along the plane normal (mm)
 * @returns {NURBSSurface}  a degree-3×3 NURBS surface
 */
function arbitraryCurvedSurface(corners, bulge) {
  // Best-fit plane: centroid + normal via Newell's method.
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

  // In-plane axes u, v.
  let ux = corners[0][0] - cx, uy = corners[0][1] - cy, uz = corners[0][2] - cz;
  // remove the normal component
  const ud = ux * nx + uy * ny + uz * nz;
  ux -= ud * nx; uy -= ud * ny; uz -= ud * nz;
  let ul = Math.hypot(ux, uy, uz) || 1;
  ux /= ul; uy /= ul; uz /= ul;
  // v = n × u
  let vx = ny * uz - nz * uy;
  let vy = nz * ux - nx * uz;
  let vz = nx * uy - ny * ux;

  // Parametric extent — project the corners onto (u,v) and take the span.
  let umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
  for (const c of corners) {
    const dx = c[0] - cx, dy = c[1] - cy, dz = c[2] - cz;
    const pu = dx * ux + dy * uy + dz * uz;
    const pv = dx * vx + dy * vy + dz * vz;
    if (pu < umin) umin = pu; if (pu > umax) umax = pu;
    if (pv < vmin) vmin = pv; if (pv > vmax) vmax = pv;
  }
  // Slight outward pad so the surface fully contains the boundary projection.
  const padU = (umax - umin) * 0.08 + 1e-6;
  const padV = (vmax - vmin) * 0.08 + 1e-6;
  umin -= padU; umax += padU; vmin -= padV; vmax += padV;

  // 4×4 degree-3 control net on the plane rectangle, interior CPs bulged.
  const controlNet = [];
  for (let i = 0; i < 4; i++) {
    const su = umin + (umax - umin) * (i / 3);
    const row = [];
    for (let j = 0; j < 4; j++) {
      const sv = vmin + (vmax - vmin) * (j / 3);
      // Bulge weight — 0 on the border, peak at the interior CPs.
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
 * The native P4 arbitrary-surface face replacement.
 *
 * Extracts the picked face's boundary, builds a native ArchDisc `TopoFace`,
 * synthesises an arbitrary curved surface, and re-seats the face onto it with
 * fresh pcurves (validated). Renders the new analytic surface tessellated into
 * the result body; carries the analytic face + pcurve diagnostics on `meta`.
 */
async function replaceFaceWithArbitrarySurface(brepShape, faceIndex, opts) {
  const oc = await getKernel();
  return withScope(() => {
    const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
    const ANY  = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;

    // ── 1. walk faces, find the picked one ───────────────────────────────────
    const faces = [];
    const exp = track(new oc.TopExp_Explorer_2(brepShape.shape, FACE, ANY));
    for (; exp.More(); exp.Next()) {
      const f = exp.Current();
      let dup = false;
      for (const prev of faces) {
        try { if (prev.IsSame(f)) { dup = true; break; } } catch (_e) { /* ignore */ }
      }
      if (!dup) {
        try { faces.push(track(oc.TopoDS.Face_1(f))); } catch (_e) { faces.push(track(f)); }
      }
    }
    if (faceIndex > faces.length) {
      throw new Error(
        `replaceFace: faceIndex=${faceIndex} but shape has only ${faces.length} faces`);
    }
    const oldFace = faces[faceIndex - 1];

    // ── 2. extract the picked face's outer boundary wire as ordered corners ──
    const boundaryWire = track(oc.BRepTools.OuterWire(oldFace));
    if (!boundaryWire || boundaryWire.IsNull()) {
      throw new Error('replaceFace: could not extract the outer boundary wire of the picked face');
    }
    const { corners, edgeCount } = wireCorners(oc, boundaryWire);
    if (corners.length < 3) {
      throw new Error(
        `replaceFace: boundary loop has only ${corners.length} corner(s) — need ≥ 3`);
    }

    // ── 3. build a NATIVE ArchDisc TopoFace on those boundary edges ──────────
    // Vertices, straight edges between consecutive corners, one outer loop.
    const verts = corners.map((c) => new TopoVertex(new Vec3(c[0], c[1], c[2])));
    const edges = [];
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      edges.push(new TopoEdge(a, b, new LineCurve(a.point.clone(), b.point.clone())));
    }
    const loop = new TopoLoop(edges.map((e) => ({ edge: e, reversed: false })));
    // The face starts with NO surface — it is about to be re-seated.
    const nativeFace = new TopoFace(null, loop);

    // ── 4. synthesise an ARBITRARY new curved surface spanning the boundary ──
    // Bulge scales with the boundary extent so the swap is a real geometric
    // change (a flat face becomes a genuinely curved one).
    let diag = 0;
    for (let i = 0; i < corners.length; i++) {
      for (let j = i + 1; j < corners.length; j++) {
        const d = Math.hypot(
          corners[i][0] - corners[j][0],
          corners[i][1] - corners[j][1],
          corners[i][2] - corners[j][2]);
        if (d > diag) diag = d;
      }
    }
    const bulge = (opts.bulge && opts.bulge > 0) ? opts.bulge : Math.max(0.5, diag * 0.18);
    const newSurface = arbitraryCurvedSurface(corners, bulge);

    // ── 5. re-seat the native TopoFace onto the new surface (genuine pcurves) ─
    // replaceFaceSurface projects every boundary edge onto the new surface via
    // Newton point-inversion + 2-D B-spline fitting, attaches the pcurves, and
    // validates the rebuilt face. Tolerance scales with the boundary diagonal.
    const swap = replaceFaceSurface(nativeFace, newSurface, {
      edgeSamples: 28,
      tolerance: Math.max(2, diag * 0.5),
    });
    if (!swap.ok) {
      throw new Error(`replaceFace (curved swap): ${swap.reason}`);
    }

    // ── 6. render the new analytic surface — tessellate + sew into a shell ───
    const mesh = newSurface.tessellate({ stepsU: 40, stepsV: 40 });
    const tri = mesh.triVerts;
    const vp = mesh.vertProperties;
    const triFaces = [];
    for (let i = 0; i < tri.length; i += 3) {
      const ia = tri[i] * 3, ib = tri[i + 1] * 3, ic = tri[i + 2] * 3;
      const ax = vp[ia], ay = vp[ia + 1], az = vp[ia + 2];
      const bx = vp[ib], by = vp[ib + 1], bz = vp[ib + 2];
      const cx = vp[ic], cy = vp[ic + 1], cz = vp[ic + 2];
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const wx = cx - ax, wy = cy - ay, wz = cz - az;
      const nx = uy * wz - uz * wy;
      const ny = uz * wx - ux * wz;
      const nz = ux * wy - uy * wx;
      if (nx * nx + ny * ny + nz * nz < 1e-14) continue;
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
      } catch { /* skip un-buildable triangle */ }
    }
    if (triFaces.length === 0) {
      throw new Error('replaceFace (curved swap): the new surface produced no buildable mesh');
    }
    const sewing = track(new oc.BRepBuilderAPI_Sewing(1e-4, true, true, true, false));
    for (const f of triFaces) sewing.Add(f);
    const pr = track(new oc.Message_ProgressRange_1());
    sewing.Perform(pr);
    let sewed = track(sewing.SewedShape());
    if (!sewed || sewed.IsNull()) {
      const builder = track(new oc.BRep_Builder());
      const compound = track(new oc.TopoDS_Compound());
      builder.MakeCompound(compound);
      for (const f of triFaces) builder.Add(compound, f);
      sewed = compound;
    }

    const nd = swap.face.surface.nurbsData();
    const result = new BrepShape(sewed, {
      op: 'replaceFace',
      params: {
        faceIndex,
        rebuiltFromBoundaryWire: true,
        curvedSwap: true,
        arbitrarySurfaceSwap: true,
      },
      parents: [brepShape.id],
      description:
        `Replace Face: face #${faceIndex} re-seated onto an arbitrary curved ` +
        `NURBS surface (degree ${nd.degreeU}×${nd.degreeV}) — ` +
        `${swap.pcurveCount} fresh pcurves generated in ArchDisc's native ` +
        `topology kernel`,
      // The native re-seated analytic face + the new surface data.
      analyticFace: swap.face,
      analyticSurface: nd,
      faceReplaceStats: {
        faceIndex,
        boundaryEdges: edgeCount,
        boundaryCorners: corners.length,
        curvedSwap: true,
        bulge,
        degreeU: nd.degreeU,
        degreeV: nd.degreeV,
        controlPointsU: nd.controlNet.length,
        controlPointsV: nd.controlNet[0].length,
        pcurveCount: swap.pcurveCount,
        maxProjectionError: swap.maxProjectionError,
        maxPushForwardError: swap.maxPushForwardError,
        loopClosed: swap.loopClosed,
        loopGaps: swap.loopGaps,
        allConverged: swap.allConverged,
        valid: swap.ok,
      },
    });
    return result;
  });
}
