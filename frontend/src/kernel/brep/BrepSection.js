/**
 * ArchDisc Kernel — Planar section operation.
 *
 * SP-5 (Area C, T1 — Boolean & partition completion).
 *
 * ── What it does ─────────────────────────────────────────────────────────────
 * Compute the cross-section of `body` by an infinite `plane`. Two output modes:
 *
 *   - `'curves'` (default) — return a WIRE-bearing body containing every
 *     intersection EDGE between the plane and the body. This is the
 *     "drafting section view" workflow: take a 3D solid, cut it by a plane,
 *     get the cross-section outline as a flat wire body that can be
 *     dimensioned, drawn, exported as SVG, etc. The body's geometry is
 *     UNCHANGED — this is a pure query.
 *
 *   - `'split'`  — split `body` into the two half-pieces produced by
 *     intersecting it with the plane (the "section + slice" workflow). The
 *     plane is converted to a sheet large enough to fully bisect the body's
 *     bounding box, then the body is partitioned by that sheet. Returns an
 *     array of SpineBodies — one per resulting solid lump. Volume is
 *     conserved (the union of the pieces equals the original body).
 *
 * ── How it's implemented ─────────────────────────────────────────────────────
 * - `'curves'` mode uses `BRepAlgoAPI_Section` — the OCCT class for boolean
 *   sectioning. Bound at lines 176219-176264 of opencascade.full.d.ts; the
 *   `_5(S1, Pl, PerformNow)` constructor takes the body + a gp_Pln + a
 *   "perform immediately" flag and Build()'s the section directly.
 *   `Approximation(true)` requests B-spline approximation of the section
 *   curves (smoother than the default polyline), `ComputePCurveOn1(true)`
 *   asks the algorithm to attach a 2D pcurve to each section edge on the
 *   body's faces — useful for projection-to-face workflows.
 *
 * - `'split'` mode builds a planar face sized to cover the body's bounding
 *   box (with a comfortable margin), then runs the same `BRepAlgoAPI_Splitter`
 *   used by `partition()` with the planar face as the tool — guarantees a
 *   clean bisection. The result enumeration mirrors `partition()`.
 *
 * ── Spine + persistent-ID carry-through ──────────────────────────────────────
 * - `'curves'`: the result wire-body is bound via `bindSpine` (the binder
 *   recognises a pure-wire body and tags it `kind: 'wire'`). Lineage is
 *   carried from the source body — every section edge is Generated from a
 *   face of the body, so the edge's `derivedFrom` records the face id.
 * - `'split'`: every resulting piece is a SpineBody with full lineage
 *   carry-through from the source body (the planar tool is transient — its
 *   edges only seed the section faces).
 *
 * ── Geometric assertion ──────────────────────────────────────────────────────
 * For `'curves'`, every section vertex satisfies `n · (p − p0) ≈ 0` where
 * `(p0, n)` is the input plane (origin + normal). The e2e checks this to
 * within `1e-3 mm` of the plane.
 *
 * ── Edge cases handled ───────────────────────────────────────────────────────
 * - Plane misses the body (no intersection) → 'curves' mode returns an empty
 *   wire body with `report.note = 'no-intersection'`; 'split' returns a
 *   single-piece array.
 * - Plane tangent to a body face (zero-measure intersection) → BOPAlgo's
 *   tolerant pipeline drops the touch; treated as no-intersection.
 * - Plane passes through a vertex/edge (degenerate touch) → handled tolerant.
 *
 * ── Input contract ───────────────────────────────────────────────────────────
 *   - `body` — `SpineBody` or `BrepShape`.
 *   - `plane` — `{ origin: [x,y,z], normal: [nx,ny,nz] }`. The normal is
 *     normalised; zero-length normal throws.
 *   - `opts.output` — `'curves'` (default) or `'split'`.
 *   - `opts.approximation` — for 'curves' mode, request B-spline approximation
 *     (default `true`).
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';
import { carryLineage } from '../topology/IdLineage.js';

/**
 * Planar section of a body — produce intersection curves OR split the body.
 *
 * @param {SpineBody|BrepShape} body
 * @param {{origin:[number,number,number], normal:[number,number,number]}} plane
 * @param {{output?:('curves'|'split'), approximation?:boolean}} [opts]
 * @returns {Promise<SpineBody|{pieces: SpineBody[], report: object}>}
 *          - 'curves' → a SpineBody wrapping the wire/edge compound of
 *            intersection curves (kind = 'wire').
 *          - 'split'  → { pieces, report } shaped like `partition()`.
 */
export async function planarSection(body, plane, opts = {}) {
  if (!body || !body.shape) {
    throw new Error('planarSection: body must expose a live .shape');
  }
  if (!plane || !Array.isArray(plane.origin) || !Array.isArray(plane.normal)) {
    throw new Error('planarSection: plane must have origin + normal arrays');
  }
  const [ox, oy, oz] = plane.origin;
  let [nx, ny, nz] = plane.normal;
  const nLen = Math.hypot(nx, ny, nz);
  if (!(nLen > 1e-9)) throw new Error('planarSection: plane normal is zero-length');
  nx /= nLen; ny /= nLen; nz /= nLen;
  const output = opts.output === 'split' ? 'split' : 'curves';
  const approximation = opts.approximation !== false;

  const oc = await getOCCT();
  return withScope(() => {
    const TYPE = oc.TopAbs_ShapeEnum;
    const ANY  = TYPE.TopAbs_SHAPE;

    // ── Build the gp_Pln from (origin, normal). gp_Pln_3(gp_Pnt, gp_Dir).
    const origin = track(new oc.gp_Pnt_3(ox, oy, oz));
    const normal = track(new oc.gp_Dir_4(nx, ny, nz));
    const gpPlane = track(new oc.gp_Pln_3(origin, normal));

    if (output === 'curves') {
      return runCurves(oc, body, gpPlane, approximation, { ox, oy, oz, nx, ny, nz });
    }
    return runSplit(oc, body, gpPlane, { ox, oy, oz, nx, ny, nz });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 'curves' — intersection edges as a wire body via BRepAlgoAPI_Section.
// ─────────────────────────────────────────────────────────────────────────────

function runCurves(oc, body, gpPlane, approximation, planeRecord) {
  const TYPE = oc.TopAbs_ShapeEnum;
  const ANY  = TYPE.TopAbs_SHAPE;

  // BRepAlgoAPI_Section_5(S1, Pl, PerformNow) — start the section now.
  const section = track(new oc.BRepAlgoAPI_Section_5(body.shape, gpPlane, false));
  // Request smoother B-spline approximation of section curves; attach 2D
  // pcurves on face 1 (the body) for downstream projection workflows.
  try { section.Approximation(approximation); } catch (_e) { /* default ok */ }
  try { section.ComputePCurveOn1(true); } catch (_e) { /* default ok */ }
  if (typeof section.SetToFillHistory === 'function') section.SetToFillHistory(true);
  section.Build(track(new oc.Message_ProgressRange_1()));
  if (!section.IsDone()) {
    throw new Error('planarSection.curves: BRepAlgoAPI_Section did not complete');
  }
  const sectionShape = section.Shape();
  if (sectionShape.IsNull()) {
    throw new Error('planarSection.curves: kernel produced a null shape');
  }

  // Count section edges + verify each vertex lies on the plane.
  let edgeCount = 0;
  let maxPlaneDev = 0;
  const ex = track(new oc.TopExp_Explorer_2(sectionShape, TYPE.TopAbs_EDGE, ANY));
  const seenEdges = [];
  for (; ex.More(); ex.Next()) {
    const eShape = track(ex.Current());
    if (seenEdges.some((s) => s.IsSame(eShape))) continue;
    seenEdges.push(eShape);
    edgeCount += 1;
    // Endpoint vertices of this edge.
    const vEx = track(new oc.TopExp_Explorer_2(eShape, TYPE.TopAbs_VERTEX, ANY));
    for (; vEx.More(); vEx.Next()) {
      const v = track(oc.TopoDS.Vertex_1(vEx.Current()));
      const p = track(oc.BRep_Tool.Pnt(v));
      const dx = p.X() - planeRecord.ox;
      const dy = p.Y() - planeRecord.oy;
      const dz = p.Z() - planeRecord.oz;
      const planeSignedDist = dx * planeRecord.nx + dy * planeRecord.ny + dz * planeRecord.nz;
      const absDev = Math.abs(planeSignedDist);
      if (absDev > maxPlaneDev) maxPlaneDev = absDev;
    }
  }

  const meta = {
    op: 'planarSection',
    params: {
      output: 'curves',
      origin: [planeRecord.ox, planeRecord.oy, planeRecord.oz],
      normal: [planeRecord.nx, planeRecord.ny, planeRecord.nz],
      approximation,
    },
    parents: [body.id].filter(Boolean),
    sectionReport: {
      edgeCount,
      maxPlaneDeviation: maxPlaneDev,
      intersected: edgeCount > 0,
      note: edgeCount > 0 ? 'curves-extracted' : 'no-intersection',
    },
  };

  const wrapper = new BrepShape(sectionShape, meta);
  // Wire body — bindSpine recognises a pure-wire compound and tags
  // kind='wire'. validate=false because a wire body's Euler characteristic
  // is application-specific (open wires vs closed loops) and the SP-1 binder
  // doesn't enforce a strict invariant here.
  const resultBody = bindSpine(oc, sectionShape, {
    bodyTag: `planarSection-curves-${wrapper.id}`,
    geomEngineShape: wrapper,
    declaredKind: 'wire',
    validate: false,
  });

  // Lineage — every section edge is Generated from a body face; carry
  // through to record the seeding face id on each new edge's derivedFrom.
  if (body.body) {
    const lineage = carryLineage(oc, section, resultBody, [
      { body: body.body, role: 'arg' },
    ]);
    meta.lineage = {
      survived: lineage.survived, modified: lineage.modified,
      generated: lineage.generated, deleted: lineage.deleted,
      conflicts: lineage.conflicts,
      edgeMap: [...lineage.edgeMap.entries()].slice(0, 64),
    };
  }

  return new SpineBody(resultBody, wrapper, meta);
}

// ─────────────────────────────────────────────────────────────────────────────
// 'split' — build a planar face large enough to bisect the body's bbox,
// then run BRepAlgoAPI_Splitter (same as partition()).
// ─────────────────────────────────────────────────────────────────────────────

function runSplit(oc, body, gpPlane, planeRecord) {
  const TYPE = oc.TopAbs_ShapeEnum;
  const ANY  = TYPE.TopAbs_SHAPE;

  // Body bbox to size the planar tool face.
  const bb = track(new oc.Bnd_Box_1());
  oc.BRepBndLib.Add(body.shape, bb, false);
  const mn = track(bb.CornerMin());
  const mx = track(bb.CornerMax());
  const dx = mx.X() - mn.X();
  const dy = mx.Y() - mn.Y();
  const dz = mx.Z() - mn.Z();
  const diag = Math.hypot(dx, dy, dz);
  const margin = Math.max(diag * 1.2, 1.0); // generous margin so the tool fully bisects the body
  const halfSize = margin;

  // Build a bounded planar face: the plane gp_Pln + a parametric rectangle
  // [-halfSize, halfSize] × [-halfSize, halfSize] in the plane's UV.
  // BRepBuilderAPI_MakeFace_9(gp_Pln, UMin, UMax, VMin, VMax) — 5-arg form
  // (verified in opencascade.full.d.ts lines 11880-11882). MakeFace_3 takes
  // just (gp_Pln) and yields an unbounded face that BOP cannot intersect
  // cleanly, so we prefer the bounded form.
  let toolFace;
  try {
    toolFace = track(new oc.BRepBuilderAPI_MakeFace_9(
      gpPlane, -halfSize, halfSize, -halfSize, halfSize)).Face();
  } catch (_e) {
    // Fallback: unbounded MakeFace_3 — works for some plane-on-bbox pairings
    // when the bounded form has a degenerate parameterisation.
    toolFace = track(new oc.BRepBuilderAPI_MakeFace_3(gpPlane)).Face();
  }

  // Run Splitter — same machinery as partition().
  const args = track(new oc.TopTools_ListOfShape_1());
  args.Append_1(body.shape);
  const toolList = track(new oc.TopTools_ListOfShape_1());
  toolList.Append_1(toolFace);

  const splitter = track(new oc.BRepAlgoAPI_Splitter_1());
  splitter.SetArguments(args);
  splitter.SetTools(toolList);
  if (typeof splitter.SetToFillHistory === 'function') splitter.SetToFillHistory(true);
  splitter.Build(track(new oc.Message_ProgressRange_1()));
  if (!splitter.IsDone()) {
    throw new Error('planarSection.split: BRepAlgoAPI_Splitter did not complete');
  }
  const resultShape = splitter.Shape();
  if (resultShape.IsNull()) {
    throw new Error('planarSection.split: kernel produced a null shape');
  }

  // Source-body volume for the conservation contract.
  const propsIn = track(new oc.GProp_GProps_1());
  oc.BRepGProp.VolumeProperties_1(body.shape, propsIn, false, false, false);
  const volBefore = propsIn.Mass();

  // Enumerate every SOLID of the result — those are the pieces.
  // CRITICAL — do NOT track the explored solids; they must survive
  // withScope's disposal pass so each SpineBody holds a live shape.
  const solids = [];
  const ex = new oc.TopExp_Explorer_2(resultShape, TYPE.TopAbs_SOLID, ANY);
  for (; ex.More(); ex.Next()) {
    const sd = oc.TopoDS.Solid_1(ex.Current());
    if (!solids.some((s) => s.IsSame(sd))) solids.push(sd);
  }
  try { ex.delete(); } catch { /* already gone */ }
  if (solids.length === 0) {
    throw new Error('planarSection.split: result contains no SOLID');
  }

  const perPieceVolumes = [];
  const pieces = [];
  for (let i = 0; i < solids.length; i++) {
    const solidShape = solids[i];
    const pieceProps = track(new oc.GProp_GProps_1());
    oc.BRepGProp.VolumeProperties_1(solidShape, pieceProps, false, false, false);
    const pieceVol = pieceProps.Mass();
    perPieceVolumes.push(pieceVol);

    const pieceMeta = {
      op: 'planarSection.split.piece',
      params: { pieceIndex: i },
      parents: [body.id].filter(Boolean),
      sectionPieceIndex: i,
      sectionTotalPieces: solids.length,
    };
    const wrapper = new BrepShape(solidShape, pieceMeta);
    const pieceBody = bindSpine(oc, solidShape, {
      bodyTag: `planarSection-piece-${i}-${wrapper.id}`,
      geomEngineShape: wrapper,
      declaredKind: 'solid',
    });
    if (body.body) {
      const lineage = carryLineage(oc, splitter, pieceBody, [
        { body: body.body, role: 'arg' },
      ]);
      pieceMeta.lineage = {
        survived: lineage.survived, modified: lineage.modified,
        generated: lineage.generated, deleted: lineage.deleted,
        conflicts: lineage.conflicts,
        faceMap: [...lineage.faceMap.entries()].slice(0, 64),
      };
    }
    pieces.push(new SpineBody(pieceBody, wrapper, pieceMeta));
  }

  const volAfter = perPieceVolumes.reduce((a, b) => a + b, 0);
  const volRelErr = volBefore > 1e-9 ? Math.abs(volAfter - volBefore) / volBefore : 0;
  const intersected = solids.length > 1;

  const report = {
    volBefore, volAfter, volDelta: volAfter - volBefore, volRelErr,
    pieceCount: solids.length,
    perPieceVolumes,
    intersected,
    note: intersected ? 'split' : 'no-intersection',
    plane: {
      origin: [planeRecord.ox, planeRecord.oy, planeRecord.oz],
      normal: [planeRecord.nx, planeRecord.ny, planeRecord.nz],
    },
  };
  // Attach the report to every piece's meta, and glue `.report` onto the
  // returned array so callers can read either. The function returns the
  // ARRAY (not an object) so `withScope`'s survivor detection walks every
  // entry and preserves each piece's underlying engine shape.
  for (const p of pieces) p.meta.sectionReport = report;
  pieces.report = report;
  pieces.sectionReport = report;
  return pieces;
}
