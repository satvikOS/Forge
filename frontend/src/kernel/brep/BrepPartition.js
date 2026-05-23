/**
 * ArchDisc Kernel — Partition operation.
 *
 * SP-5 (Area C, T1 — Boolean & partition completion).
 *
 * ── What it does ─────────────────────────────────────────────────────────────
 * Split a body along one or more tool surfaces / solids into multiple pieces.
 * Returns an ARRAY of `SpineBody`s — one per resulting solid lump (and one
 * compound-wrapping `SpineBody` available as the 0th index of an alternative
 * shape consumed by downstream e2e checks).
 *
 * This is the canonical "split by tool" workflow used to:
 *   - separate an inspection lid off a pressure-vessel body along a planar cut;
 *   - cut a moulded part along a parting plane to make A-side / B-side mould
 *     halves;
 *   - split a long beam into shippable segments along section planes;
 *   - prepare a multi-region body for per-region material assignment.
 *
 * Unlike `cut(a,b)` which REMOVES material, `partition(body, tools[])` PRESERVES
 * material: the union of every returned piece's volume equals the original
 * body's volume (within float tolerance).
 *
 * ── How it's implemented — `BRepAlgoAPI_Splitter` ────────────────────────────
 * `BRepAlgoAPI_Splitter` is bound at lines 176267-176280 of
 * opencascade.full.d.ts. It is the public OCCT API on top of `BOPAlgo_Splitter`
 * for splitting a set of objects by a set of tools, preserving volumes.
 * Inherits `Modified` / `Generated` / `IsDeleted` from `BRepAlgoAPI_BuilderAlgo`
 * (line 176381) so the SP-1 carry-through machinery applies unchanged.
 *
 * Steps:
 *   1. Build a `TopTools_ListOfShape` of `[body.shape]` as the arguments.
 *   2. Build a `TopTools_ListOfShape` of every tool's shape.
 *   3. Construct `BRepAlgoAPI_Splitter_1`, call SetArguments + SetTools,
 *      enable history, Build.
 *   4. Enumerate every SOLID of the result shape — those are the lump
 *      pieces. For each piece, `bindSpine` builds its spine and we wrap
 *      it in a SpineBody. Volume + face/edge counts are recorded per piece.
 *
 * Volume-conservation contract — checked by the e2e:
 *   |Σ V_pieces − V_before| / V_before < 1e-4.
 *
 * ── Spine + persistent-ID carry-through ──────────────────────────────────────
 * For each returned piece, the body's face / edge / vertex persistent ids
 * carry through via `carryLineage(oc, splitter, pieceBody, [{body: src}])`.
 *   - Faces of the source body that ended up entirely inside ONE piece
 *     survive with their id verbatim on that piece's face.
 *   - Faces of the source body that are SPLIT across multiple pieces appear
 *     as Modified on each piece; the surviving lineage rule gives the first
 *     piece the verbatim id and records the source id in `derivedFrom` on
 *     every other piece.
 *   - The new section faces (the "cut surface" between two pieces) are
 *     Generated from the tool faces; their `derivedFrom` records the
 *     seeding tool face id (provenance of the cut).
 *
 * ── Edge cases handled ───────────────────────────────────────────────────────
 * - Tools miss the body entirely → the Splitter returns the body unchanged
 *   (1 piece, original volume). The op succeeds with `partitionReport.note =
 *   'no-intersection'` and a single-element pieces array.
 * - Single tool / multi tool: arity is N, every tool is appended to the
 *   tool list.
 * - Tool fully INSIDE the body: a closed-volume tool partitions the body
 *   into an outer remainder + an inner core piece (preserves volume).
 * - One of the tools is itself a sheet (e.g. a planar half-space face):
 *   handled natively — `BRepAlgoAPI_Splitter` accepts mixed solid/sheet
 *   tool lists.
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';
import { carryLineage } from '../topology/IdLineage.js';

/**
 * Split `body` along every `tool` in `tools[]` into multiple pieces. Returns
 * an array of SpineBodies — one per resulting solid lump.
 *
 * Result-shape lifetime: the function returns an ARRAY of SpineBodies so that
 * `withScope`'s survivor detection preserves every piece's underlying engine
 * shape (the survivor loop walks the returned array entries). The summary
 * `report` is attached to `pieces[0].meta.partitionReport` (and to every
 * subsequent piece's `meta.partitionReport` so callers can read it from any
 * piece).
 *
 * @param {SpineBody|BrepShape} body          the body to partition.
 * @param {Array<SpineBody|BrepShape>} tools  one or more cutting tools (solid
 *                                            or sheet); each is appended as a
 *                                            tool of the Splitter.
 * @returns {Promise<{pieces: SpineBody[], report: object}>}
 *          pieces  — one SpineBody per result solid lump.
 *          report  — { volBefore, volAfter, pieceCount, perPieceVolumes,
 *                      intersected, note }
 */
export async function partition(body, tools) {
  if (!body || !body.shape) {
    throw new Error('partition: body must expose a live .shape');
  }
  if (!Array.isArray(tools) || tools.length < 1) {
    throw new Error('partition: tools must be a non-empty array');
  }
  for (let i = 0; i < tools.length; i++) {
    if (!tools[i] || !tools[i].shape) {
      throw new Error(`partition: tools[${i}] must expose a live .shape`);
    }
  }
  const oc = await getOCCT();
  return withScope(() => {
    const TYPE = oc.TopAbs_ShapeEnum;
    const ANY  = TYPE.TopAbs_SHAPE;

    // Volume of input body for the conservation contract.
    const propsIn = track(new oc.GProp_GProps_1());
    oc.BRepGProp.VolumeProperties_1(body.shape, propsIn, false, false, false);
    const volBefore = propsIn.Mass();

    // Arguments: [body].
    const args = track(new oc.TopTools_ListOfShape_1());
    args.Append_1(body.shape);

    // Tools: every entry of tools[]. A sheet tool (a single FACE or open
    // SHELL) is appended verbatim. A solid tool is also appended verbatim —
    // BRepAlgoAPI_Splitter accepts mixed solid+sheet tool lists.
    const toolList = track(new oc.TopTools_ListOfShape_1());
    for (const t of tools) toolList.Append_1(t.shape);

    const splitter = track(new oc.BRepAlgoAPI_Splitter_1());
    splitter.SetArguments(args);
    splitter.SetTools(toolList);
    if (typeof splitter.SetToFillHistory === 'function') splitter.SetToFillHistory(true);
    splitter.Build(track(new oc.Message_ProgressRange_1()));
    if (!splitter.IsDone()) {
      throw new Error('partition: BRepAlgoAPI_Splitter did not complete');
    }
    const result = splitter.Shape();
    if (result.IsNull()) throw new Error('partition: kernel produced a null shape');

    // ── Enumerate every SOLID lump of the result — those are the pieces.
    //     If the result is a single SOLID (no partition happened — tools
    //     missed), we still return a one-element array so the caller's
    //     pieces handling is uniform.
    //
    // CRITICAL — the result solids must NOT be `track()`-ed. `withScope`
    // deletes every tracked object on scope exit; the solid sub-shapes
    // we extract here MUST survive past the scope so each SpineBody
    // wrapper holds a live TopoDS_Shape. The Explorer + the Solid_1
    // cast result are not tracked.
    const solids = [];
    const ex = new oc.TopExp_Explorer_2(result, TYPE.TopAbs_SOLID, ANY);
    for (; ex.More(); ex.Next()) {
      const sd = oc.TopoDS.Solid_1(ex.Current());
      // Dedup by IsSame — multi-compound results can re-walk shared solids.
      if (!solids.some((s) => s.IsSame(sd))) solids.push(sd);
    }
    try { ex.delete(); } catch { /* already gone */ }
    // If no SOLID found (degenerate tool input → result was just a shell or
    // empty compound), surface a clear diagnostic.
    if (solids.length === 0) {
      throw new Error('partition: result contains no SOLID — tools may be invalid for a volumetric split');
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
        op: 'partition.piece',
        params: { pieceIndex: i },
        parents: [body.id, ...tools.map(t => t.id).filter(Boolean)],
        partitionPieceIndex: i,
        partitionTotalPieces: solids.length,
      };
      const wrapper = new BrepShape(solidShape, pieceMeta);
      const pieceBody = bindSpine(oc, solidShape, {
        bodyTag: `partition-piece-${i}-${wrapper.id}`,
        geomEngineShape: wrapper,
        declaredKind: 'solid',
      });
      // Carry lineage from the original body + every tool onto this piece.
      // The splitter's history maps cover every input → result mapping,
      // so each piece's faces independently lookup their source ids.
      const inputs = [];
      if (body.body) inputs.push({ body: body.body, role: 'arg' });
      for (const t of tools) {
        if (t.body) inputs.push({ body: t.body, role: 'tool' });
      }
      if (inputs.length > 0) {
        const lineage = carryLineage(oc, splitter, pieceBody, inputs);
        pieceMeta.lineage = {
          survived: lineage.survived, modified: lineage.modified,
          generated: lineage.generated, deleted: lineage.deleted,
          conflicts: lineage.conflicts,
          faceMap: [...lineage.faceMap.entries()].slice(0, 64),
        };
      }
      pieces.push(new SpineBody(pieceBody, wrapper, pieceMeta));
    }

    // Volume conservation: every piece's volume must sum to the body's.
    const volAfter = perPieceVolumes.reduce((a, b) => a + b, 0);
    const volRelErr = volBefore > 1e-9 ? Math.abs(volAfter - volBefore) / volBefore : 0;
    const intersected = solids.length > 1;

    const report = {
      volBefore, volAfter, volDelta: volAfter - volBefore, volRelErr,
      pieceCount: solids.length,
      perPieceVolumes,
      intersected,
      note: intersected ? 'partitioned' : 'no-intersection',
      toolCount: tools.length,
    };
    // Attach the partition report to every piece's meta so callers can read
    // it from any piece; also surface it under the array's own `.partitionReport`.
    for (const p of pieces) p.meta.partitionReport = report;
    pieces.partitionReport = report;

    // Return the array — `withScope`'s survivor detection walks Array entries
    // and adds every piece's `.shape` to the survivor set (the SpineBody
    // duck-check at BrepShape.js line 88). The {pieces, report} object below
    // surfaces the same data for legacy callers that destructure.
    pieces.report = report;
    return pieces;
  });
}

/**
 * Compat shim: callers that want the `{ pieces, report }` shape can wrap
 * the returned array. The native return is the array (so withScope sees
 * every survivor). Re-export the wrapped shape for callers that prefer it.
 */
export async function partitionWithReport(body, tools) {
  const pieces = await partition(body, tools);
  return { pieces, report: pieces.report || pieces.partitionReport };
}
