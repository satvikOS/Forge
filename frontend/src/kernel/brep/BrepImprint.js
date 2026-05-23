/**
 * ArchDisc Kernel — Imprint operation.
 *
 * SP-5 (Area C, T1 — Boolean & partition completion).
 *
 * ── What it does ─────────────────────────────────────────────────────────────
 * Project a tool body's boundary edges onto the body's faces as NEW edges,
 * splitting the existing faces along those projection curves. The body's
 * VOLUME is unchanged — the body is the same closed solid, but its face
 * partition is enriched with the imprint footprint (which gives a face the
 * caller can later select to extrude, draft, colour, attribute-tag, etc.).
 *
 * This is the canonical "imprint footprint" workflow used by every parametric
 * CAD kernel for laying out bolt-circle patterns, weld-bead footprints,
 * structural-test load areas, paint-mask outlines — anywhere you want to mark
 * a face without removing material.
 *
 * ── How it's implemented — `BRepAlgoAPI_Splitter` with a sheet-extracted tool ─
 * The classical OCCT call surface for imprint is `BRepFeat_SplitShape`. That
 * class IS bound (lines 140563-140586 of opencascade.full.d.ts) and exposes
 * `Add_2(W, F)` for projecting a wire onto a face — but you must already know
 * which result face each wire lands on, i.e. the caller has to pre-compute the
 * wire→face mapping. That is the very lookup `BOPAlgo_PaveFiller` and the
 * `Splitter` algorithm already do internally.
 *
 * Equivalent, fully-automatic path used here:
 *   1. Extract every FACE (sheets) from the tool body — those become the
 *      cutting surfaces.
 *   2. Feed body as the *argument* and the tool-face shells as the *tools* of
 *      `BRepAlgoAPI_Splitter`. The Splitter intersects the tool surfaces
 *      against the body, computes section curves, projects them onto the
 *      body's faces, and rebuilds the body with the new edges + face splits.
 *   3. The result is a single SOLID whose external boundary is identical to
 *      the input body's (volume preserved) but whose face topology now
 *      includes the imprint edges.
 *
 * Volume-preservation contract — checked by the e2e: `|V_after − V_before| /
 * V_before < 1e-4`. Face count strictly increases (the imprint splits at
 * least one face). Edge count strictly increases (new imprint edges added).
 *
 * ── Spine + persistent-ID carry-through ──────────────────────────────────────
 * SP-1 contract — every body-producing op returns a SpineBody with lineage
 * carried through. `BRepAlgoAPI_Splitter` inherits `Modified` / `Generated` /
 * `IsDeleted` from `BRepAlgoAPI_BuilderAlgo` (lines 176381-176404). After
 * `bindSpine` builds the spine graph from the result shape, `carryLineage`
 * propagates the body's persistent ids:
 *   - faces of the body that were NOT touched by the imprint → survive-as-id
 *   - faces SPLIT by the imprint → the larger fragment inherits the source id,
 *     every other fragment records the source id in `derivedFrom` (the SP-1
 *     deterministic single-survivor rule).
 *   - new imprint EDGES are Generated from the tool faces' edges → their
 *     `derivedFrom` records the seeding tool edge.
 *
 * ── Edge cases handled ───────────────────────────────────────────────────────
 * - Tool fully OUTSIDE the body → the Splitter returns the body unchanged
 *   (no section curves → no new edges; volume preserved trivially). The op
 *   succeeds with a NOTE in meta.imprintReport.note = 'no-intersection'.
 * - Tool tangent to a body face (zero-area intersection) → BOPAlgo's tolerant
 *   pipeline drops the touch; same outcome as no-intersection.
 * - Multiple body lumps → each lump is split independently; the result spine
 *   may carry multiple lumps depending on whether the imprint disconnects.
 *
 * ── Input contract ───────────────────────────────────────────────────────────
 * Both `body` and `tool` may be a `SpineBody` (the SP-1 currency) or a legacy
 * `BrepShape` — the `.shape` getter handles both. Tool can be a solid (its
 * faces are extracted as the cutting surfaces), a sheet body, a single face,
 * or a wire (the wire is used directly as the cutting curve via the
 * Splitter's wire-input path).
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';
import { carryLineage } from '../topology/IdLineage.js';

/**
 * Project the boundary edges of `tool` onto the faces of `body`, splitting
 * existing faces along the projection curves WITHOUT changing the body's
 * volume. Returns a fresh SpineBody.
 *
 * @param {SpineBody|BrepShape} body  the recipient body — its faces will be
 *                                    enriched with imprint edges.
 * @param {SpineBody|BrepShape} tool  the tool whose boundary footprint is
 *                                    imprinted onto `body`.
 * @returns {Promise<SpineBody>}
 */
export async function imprint(body, tool) {
  if (!body || !body.shape) throw new Error('imprint: body must expose a live .shape');
  if (!tool || !tool.shape) throw new Error('imprint: tool must expose a live .shape');
  const oc = await getOCCT();
  return withScope(() => {
    const TYPE = oc.TopAbs_ShapeEnum;
    const ANY  = TYPE.TopAbs_SHAPE;

    // ── Volume of the input body — for the volume-preservation contract.
    const props0 = track(new oc.GProp_GProps_1());
    oc.BRepGProp.VolumeProperties_1(body.shape, props0, false, false, false);
    const volBefore = props0.Mass();
    const faceCountBefore = countSubShapes(oc, body.shape, TYPE.TopAbs_FACE);
    const edgeCountBefore = countSubShapes(oc, body.shape, TYPE.TopAbs_EDGE);

    // ── Extract the tool's cutting surfaces.
    // - SOLID/COMPSOLID/COMPOUND/SHELL → enumerate all FACES (sheets) as the
    //   cutting surfaces, one TopTools_ListOfShape entry per face. Multi-face
    //   tools project their entire face boundary footprint onto the body.
    // - FACE → use the face directly.
    // - WIRE/EDGE → use directly (rare path — caller pre-projected the wire).
    const tools = track(new oc.TopTools_ListOfShape_1());
    const toolType = tool.shape.ShapeType();
    let toolFaceCount = 0;
    if (toolType === TYPE.TopAbs_FACE) {
      tools.Append_1(tool.shape);
      toolFaceCount = 1;
    } else if (toolType === TYPE.TopAbs_WIRE || toolType === TYPE.TopAbs_EDGE) {
      tools.Append_1(tool.shape);
      toolFaceCount = 0;
    } else {
      const faceExp = track(new oc.TopExp_Explorer_2(tool.shape, TYPE.TopAbs_FACE, ANY));
      while (faceExp.More()) {
        const f = track(oc.TopoDS.Face_1(faceExp.Current()));
        tools.Append_1(f);
        toolFaceCount += 1;
        faceExp.Next();
      }
      if (toolFaceCount === 0) {
        throw new Error('imprint: tool has no faces, wires or edges to project');
      }
    }

    // ── Run the Splitter — body is the argument, the tool faces are tools.
    const args = track(new oc.TopTools_ListOfShape_1());
    args.Append_1(body.shape);

    const splitter = track(new oc.BRepAlgoAPI_Splitter_1());
    splitter.SetArguments(args);
    splitter.SetTools(tools);
    if (typeof splitter.SetToFillHistory === 'function') splitter.SetToFillHistory(true);
    splitter.Build(track(new oc.Message_ProgressRange_1()));

    if (!splitter.IsDone()) {
      throw new Error('imprint: BRepAlgoAPI_Splitter did not complete');
    }
    const resultShape = splitter.Shape();
    if (resultShape.IsNull()) throw new Error('imprint: kernel produced a null shape');

    // ── Volume-preservation: by construction, Splitter on a closed body
    //     with sheet tools preserves the body's region partition (the tool
    //     sheets do not enclose volume, so they cannot add/remove regions).
    //     We still verify the contract numerically.
    const props1 = track(new oc.GProp_GProps_1());
    oc.BRepGProp.VolumeProperties_1(resultShape, props1, false, false, false);
    const volAfter = props1.Mass();
    const volDelta = Math.abs(volAfter - volBefore);
    const volRelErr = volBefore > 1e-9 ? volDelta / volBefore : volDelta;

    const faceCountAfter = countSubShapes(oc, resultShape, TYPE.TopAbs_FACE);
    const edgeCountAfter = countSubShapes(oc, resultShape, TYPE.TopAbs_EDGE);

    // No-intersection note: when the tool misses the body entirely, the
    // Splitter returns the body essentially unchanged (no new edges, no new
    // faces). Surface that to the caller via meta so the workflow can
    // distinguish "imprint succeeded with no footprint" from "imprint
    // succeeded with N new edges".
    const intersected = (edgeCountAfter > edgeCountBefore) || (faceCountAfter > faceCountBefore);

    const meta = {
      op: 'imprint',
      params: { toolFaceCount },
      parents: [body.id, tool.id].filter(Boolean),
      imprintReport: {
        volBefore, volAfter, volDelta, volRelErr,
        faceCountBefore, faceCountAfter,
        edgeCountBefore, edgeCountAfter,
        newFaces: faceCountAfter - faceCountBefore,
        newEdges: edgeCountAfter - edgeCountBefore,
        intersected,
        note: intersected ? 'imprinted' : 'no-intersection',
      },
    };

    const wrapper = new BrepShape(resultShape, meta);
    // The body's kind is preserved — splitting a solid by a sheet tool
    // yields a solid; the spine binder verifies via its kind heuristic.
    const resultBody = bindSpine(oc, resultShape, {
      bodyTag: `imprint-${wrapper.id}`,
      geomEngineShape: wrapper,
      declaredKind: 'solid',
    });

    // ── Lineage carry-through.
    //   - body: every original face id should appear on the result — either
    //     as survived (face not touched) or in derivedFrom (face split into
    //     fragments). The volume-preservation contract guarantees the body
    //     side of the lineage map is essentially complete.
    //   - tool: faces of the tool that contributed cutting surfaces seed the
    //     new imprint edges via Generated. Those edges' derivedFrom records
    //     the seeding tool edge id — the imprint provenance.
    const inputs = [];
    if (body.body) inputs.push({ body: body.body, role: 'arg' });
    if (tool.body) inputs.push({ body: tool.body, role: 'tool' });
    if (inputs.length > 0) {
      const lineage = carryLineage(oc, splitter, resultBody, inputs);
      meta.lineage = {
        survived: lineage.survived, modified: lineage.modified,
        generated: lineage.generated, deleted: lineage.deleted,
        conflicts: lineage.conflicts,
        faceMap: [...lineage.faceMap.entries()].slice(0, 64),
        edgeMap: [...lineage.edgeMap.entries()].slice(0, 64),
      };
    }

    return new SpineBody(resultBody, wrapper, meta);
  });
}

/**
 * Count distinct sub-shapes of a given type via TopExp_Explorer + IsSame dedup
 * (TopExp_Explorer double-counts shared sub-shapes; the same pattern as
 * BrepMeasure.countSubShapes / BrepFeatures.forEachUniqueEdge).
 */
function countSubShapes(oc, shape, shapeType) {
  const ANY = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
  const ex = track(new oc.TopExp_Explorer_2(shape, shapeType, ANY));
  const seen = [];
  for (; ex.More(); ex.Next()) {
    const cur = track(ex.Current());
    if (seen.some((s) => s.IsSame(cur))) continue;
    seen.push(cur);
  }
  return seen.length;
}
