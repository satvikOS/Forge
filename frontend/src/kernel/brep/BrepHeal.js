/**
 * ArchDisc Kernel — geometry healing & simplification.
 *
 * `simplify` runs a two-stage cleanup pass on a solid:
 *   Stage 1 — small-feature removal: `ShapeFix_FixSmallFace` detects and
 *     removes tiny faces — sliver "strip" faces and degenerate "spot" faces
 *     (e.g. micro-fillet bands, sliver faces left by tolerant booleans) whose
 *     size is below the `minFeatureSize` precision threshold. This is the
 *     §3.5 "removing tiny features, sliver faces, small edges automatically"
 *     intent: dropping a tiny face also collapses its small bounding edges.
 *   Stage 2 — same-domain merge: `ShapeUpgrade_UnifySameDomain` merges
 *     adjacent faces lying on the same underlying surface and drops the
 *     now-redundant seam / small edges.
 *
 * Empirically verified in this `opencascade.js@2.0.0-beta.b5ff984` build
 * (e2e recon — see brep-simplify-electron.spec.js):
 *   - `ShapeUpgrade_RemoveInternalWires` is constructible but its `MinArea()`
 *     reference-getter cannot be set from JS (always reads 0), so it removes
 *     nothing — NOT used.
 *   - `ShapeFix_FixSmallFace` IS fully bound and effective: `Init(shape)` +
 *     `SetPrecision(p)` + `Perform()` + `FixShape()` returns the cleaned
 *     shape. `Perform()` returns void; the result is read from `FixShape()`.
 *     Precision-gated: a tiny-fillet box (26 faces) reduces to 6 faces once
 *     the precision exceeds the fillet-face size.
 *   - `ShapeUpgrade_UnifySameDomain_2(shape,true,true,false)` + `Build()` +
 *     `Shape()` merges same-domain faces — kernel-api-A4.md item 2.
 *
 * OCCT refman: `ShapeFix_FixSmallFace` — "fixing faces with small size";
 * `ShapeUpgrade_UnifySameDomain` — "unifies faces / edges of the same
 * geometric domain".
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';
import { carryLineage } from '../topology/IdLineage.js';

/**
 * Wrap a `BRepTools_History` (obtained from `ShapeUpgrade_UnifySameDomain.
 * History_1()`) so `IdLineage.carryLineage` can consume it like a standard
 * `BRepBuilderAPI_MakeShape` algorithm.
 *
 * The history's API surface IS the same shape as the standard contract:
 *   - `Modified(initial) → TopTools_ListOfShape`  ✓
 *   - `Generated(initial) → TopTools_ListOfShape` ✓
 *   - `IsRemoved(initial) → bool`                 (renamed from IsDeleted)
 *
 * We adapt `IsRemoved` to the `IsDeleted` method name. The proxy is what
 * `carryLineage` walks; the underlying history object lives in `history`
 * (the caller owns its lifetime via `withScope` / `track`).
 */
function makeHistoryAlgoProxy(_oc, history) {
  return {
    Modified: (S) => {
      try { return history.Modified(S); } catch (_e) { return null; }
    },
    Generated: (S) => {
      try { return history.Generated(S); } catch (_e) { return null; }
    },
    IsDeleted: (S) => {
      try { return !!history.IsRemoved(S); } catch (_e) { return false; }
    },
  };
}

/** Count members of a shape of a given TopAbs enum. Caller is inside withScope. */
function countSubShapes(oc, shape, enumVal) {
  if (!shape || shape.IsNull()) return 0;
  const ANY = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
  const exp = track(new oc.TopExp_Explorer_2(shape, enumVal, ANY));
  let n = 0;
  for (; exp.More(); exp.Next()) n++;
  return n;
}

/**
 * Simplify a solid: remove tiny / sliver faces below a size threshold, then
 * unify same-domain faces and drop redundant edges.
 *
 * SP-1 S4c — returns a SpineBody. The Stage-2 same-domain merge
 * (`ShapeUpgrade_UnifySameDomain.History_1()`) exposes a
 * `BRepTools_History` with the standard `Modified` / `Generated` /
 * `IsRemoved` surface — wrapped via `makeHistoryAlgoProxy` to fit
 * `IdLineage.carryLineage`'s `IsDeleted` naming. The source body's
 * face / edge / vertex persistent ids carry onto the simplified result:
 * a face whose TShape was preserved by both stages survives verbatim;
 * a face merged with its neighbour into a single same-domain face is
 * Modified, with the source id recorded in the result face's
 * `derivedFrom`; a face dropped by Stage-1 small-feature removal is
 * Removed and its id correctly dies (though `ShapeFix_FixSmallFace`
 * itself does NOT expose a history — Stage-1 deletions are inferred by
 * the absence of the source TShape from the result spine, which the
 * standard lineage pass handles via the same `findBySameShape`
 * mechanism). The Stage-1-removed faces also do not contribute lineage
 * edges (no history), so their ids are simply not carried — a documented
 * honest gap in the `ShapeFix_FixSmallFace` history surface.
 *
 * The returned SpineBody carries `meta.stats` with:
 *   - `removedFeatures`   total tiny features removed (small faces + the
 *                         small edges that vanished with them)
 *   - `removedFaces`      tiny / sliver faces removed
 *   - `removedEdges`      small edges removed (with the faces and by the merge)
 *   - `facesBefore` / `facesAfter` / `edgesBefore` / `edgesAfter`
 *   - `facesMerged` / `edgesMerged`  reductions attributable to Stage 2
 *
 * @param {SpineBody|BrepShape} brepShape
 * @param {{minFeatureSize?:number, tolerance?:number}} [opts]
 *        minFeatureSize  size (mm) below which a face is "tiny" and removed
 *                        (drives `ShapeFix_FixSmallFace` precision).
 *                        Default 1.0 mm.
 *        tolerance       linear tolerance (mm) for the same-domain merge.
 * @returns {Promise<SpineBody>}
 */
export async function simplify(brepShape, opts = {}) {
  if (!brepShape || !brepShape.shape) throw new Error('simplify: needs a SpineBody or BrepShape');
  const oc = await getOCCT();
  const minFeatureSize = opts.minFeatureSize > 0 ? opts.minFeatureSize : 1.0;
  const tolerance = opts.tolerance > 0 ? opts.tolerance : 0;
  return withScope(() => {
    const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
    const EDGE = oc.TopAbs_ShapeEnum.TopAbs_EDGE;

    const facesBefore = countSubShapes(oc, brepShape.shape, FACE);
    const edgesBefore = countSubShapes(oc, brepShape.shape, EDGE);

    // ── Stage 1: small-feature removal — ShapeFix_FixSmallFace ──
    // Init(shape) + SetPrecision(minFeatureSize) + Perform() ; the cleaned
    // shape is read from FixShape() (Perform returns void). Guarded — if the
    // class misbehaves on a given input, Stage 2 still simplifies.
    let stage1Shape = brepShape.shape;
    let facesAfterStage1 = facesBefore;
    let edgesAfterStage1 = edgesBefore;
    try {
      const smallFaceFix = track(new oc.ShapeFix_FixSmallFace());
      smallFaceFix.Init(brepShape.shape);
      if (typeof smallFaceFix.SetPrecision === 'function') {
        smallFaceFix.SetPrecision(minFeatureSize);
      }
      // SetMaxTolerance bounds how far a small face's vertices may be merged.
      if (typeof smallFaceFix.SetMaxTolerance === 'function') {
        try { smallFaceFix.SetMaxTolerance(Math.max(minFeatureSize, 1)); } catch { /* opt */ }
      }
      smallFaceFix.Perform();
      const fixed = smallFaceFix.FixShape();
      if (fixed && !fixed.IsNull()) {
        stage1Shape = track(fixed);
        facesAfterStage1 = countSubShapes(oc, stage1Shape, FACE);
        edgesAfterStage1 = countSubShapes(oc, stage1Shape, EDGE);
      }
    } catch {
      // ShapeFix_FixSmallFace failed on this input — Stage 2 alone still
      // simplifies (no tiny-feature removal this run).
      stage1Shape = brepShape.shape;
      facesAfterStage1 = facesBefore;
      edgesAfterStage1 = edgesBefore;
    }

    // ── Stage 2: same-domain merge — ShapeUpgrade_UnifySameDomain ──
    const unifier = track(new oc.ShapeUpgrade_UnifySameDomain_2(
      stage1Shape, true, true, false));
    if (tolerance > 0 && typeof unifier.SetLinearTolerance === 'function') {
      try { unifier.SetLinearTolerance(tolerance); } catch { /* not bound */ }
    }
    unifier.Build();
    const shape = unifier.Shape();
    if (!shape || shape.IsNull()) throw new Error('simplify: kernel produced a null shape');

    const facesAfter = countSubShapes(oc, shape, FACE);
    const edgesAfter = countSubShapes(oc, shape, EDGE);

    // Stage-1 removed tiny faces; Stage-2 merged same-domain faces.
    const removedFaces = Math.max(0, facesBefore - facesAfterStage1);
    const removedEdges = Math.max(0, edgesBefore - edgesAfter);
    const facesMerged = Math.max(0, facesAfterStage1 - facesAfter);
    const edgesMerged = Math.max(0, edgesAfterStage1 - edgesAfter);

    const meta = {
      op: 'simplify',
      parents: [brepShape.id],
      params: { minFeatureSize, tolerance },
      stats: {
        // "features removed" = tiny faces dropped + the small edges that went
        // with them; this is the headline §3.5 metric the handler reports.
        removedFeatures: removedFaces + Math.max(0, edgesBefore - edgesAfterStage1),
        removedFaces,
        removedEdges,
        facesBefore,
        facesAfter,
        edgesBefore,
        edgesAfter,
        facesMerged,
        edgesMerged,
      },
    };
    const wrapper = new BrepShape(shape, meta);
    const resultBody = bindSpine(oc, shape, {
      bodyTag: `simplify-${wrapper.id}`, geomEngineShape: wrapper,
    });
    if (brepShape.body) {
      // Carry-through via the Stage-2 history. Stage-1's small-face removal
      // has no exposed history — its dropped faces simply won't be findable
      // in the result spine (their TShape is gone), so they receive no
      // lineage edge. This is the honest documented behaviour.
      let historyHandle = null;
      try {
        if (typeof unifier.History_1 === 'function') {
          historyHandle = unifier.History_1();
        } else if (typeof unifier.History_2 === 'function') {
          historyHandle = unifier.History_2();
        }
      } catch (_e) { historyHandle = null; }
      if (historyHandle) {
        try {
          const historyObj = (typeof historyHandle.get === 'function')
            ? historyHandle.get() : historyHandle;
          const proxy = makeHistoryAlgoProxy(oc, historyObj);
          const lineage = carryLineage(oc, proxy, resultBody, [
            { body: brepShape.body, role: 'arg' },
          ]);
          meta.lineage = {
            survived: lineage.survived, modified: lineage.modified,
            generated: lineage.generated, deleted: lineage.deleted,
            conflicts: lineage.conflicts,
            faceMap: [...lineage.faceMap.entries()].slice(0, 64),
            edgeMap: [...lineage.edgeMap.entries()].slice(0, 64),
          };
        } catch (_e) {
          // History handle present but un-usable — documented honest degrade.
          meta.lineage = { historyGap: true };
        }
      }
    }
    return new SpineBody(resultBody, wrapper, meta);
  });
}
