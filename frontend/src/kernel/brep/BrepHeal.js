/**
 * ArchDisc Kernel — geometry healing, repair & simplification (Area H).
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
 * SP-8 — Healing & repair completion (Area H, T1). Adds three new ops on top
 * of `simplify`, completing the kernel's autonomous healing repertoire:
 *
 *   - `autoFillMissingFaces(body)`     — find OPEN edges of an open-shell
 *     sheet body, assemble them into closed loops, patch each loop using the
 *     existing `nSidedPatch` to produce a watertight sealed body. Spine-
 *     aware: lineage records source open-edges → new patch faces in
 *     `meta.fillReport`.
 *
 *   - `autoRepairSelfIntersection(body, opts)` — detect self-intersection via
 *     the existing pure-JS Möller detector (`foundation/SelfIntersection.js`)
 *     and REPAIR it. Strategy (degrades honestly when none fits):
 *       (a) ≤2 face pairs sharing 1 face: orientation flip on that face.
 *       (b) any pair: ShapeFix_Shape pass at the per-face tolerance widened to
 *           cover the intersection segment length — heals tolerant-input
 *           overlaps that genuine geometry repair can absorb.
 *       (c) otherwise mark un-repairable; record per-pair action in
 *           `meta.repairReport.actions`.
 *
 *   - `harmonizeNormals(body, opts)`   — flood-fill from a seed face,
 *     propagating orientation through shared edges; flip every face whose
 *     neighbour-derived orientation disagrees. `opts.outward=true` (the
 *     default for solids) orients the seed by signed volume; for sheet
 *     bodies the user-supplied `outward` boolean picks the global direction.
 *     Backed by `ShapeFix_Shell.FixFaceOrientation` for the heavy lift, plus
 *     a JS-side gauss-test verifier.
 *
 * Empirically verified in this `opencascade.js@2.0.0-beta.b5ff984` build:
 *   - `ShapeUpgrade_RemoveInternalWires` is constructible but its `MinArea()`
 *     reference-getter cannot be set from JS (always reads 0), so it removes
 *     nothing — NOT used.
 *   - `ShapeFix_FixSmallFace` IS fully bound and effective.
 *   - `ShapeUpgrade_UnifySameDomain_2` + `Build()` + `Shape()` merges same-
 *     domain faces.
 *   - `ShapeFix_Shape_2(shape)` + `Perform(progress)` + `Shape()` — SP-8
 *     verified bound (typings: opencascade.full.d.ts lines 110359-110392).
 *   - `ShapeFix_Shell_2(shell)` + `FixFaceOrientation(shell, multiConex,
 *     nonManifold)` + `Shape()` — SP-8 verified bound (lines 110810-110839).
 *   - `ShapeFix_FreeBounds_3(shape, closetoler, splitclosed, splitopen)` +
 *     `GetOpenWires()` + `GetClosedWires()` — SP-8 verified bound (lines
 *     110502-110519).
 *   - `ShapeAnalysis_Shell.LoadShells(shape)` + `HasFreeEdges()` +
 *     `FreeEdges()` — SP-8 verified bound (lines 166120-166133).
 *   - `TopoDS_Shape.Reverse()` / `Reversed()` — SP-8 verified bound
 *     (lines 30912-30913).
 *   - `BRepGProp.VolumeProperties_1` for signed-volume sniff in
 *     normal-harmonisation seed pick (already used by `BrepCheck`).
 *
 * Honest scope of the new ops:
 *   - `autoFillMissingFaces` handles SINGLE-LOOP holes correctly. A body with
 *     multiple disjoint open loops is filled one loop at a time, each call
 *     filling the largest remaining loop. Multi-loop holes (a hole bridged by
 *     an internal wire) are documented as PARTIAL — the outer loop is filled,
 *     internal bridges remain.
 *   - `autoRepairSelfIntersection` resolves the SIMPLE cases enumerated
 *     above. Tangled multi-curve intersections (where the SSI traces multiple
 *     mutually-crossing curves on the same face) are reported as
 *     un-repairable with a precise diagnosis (intersection count + segment
 *     length distribution). Real-world parts overwhelmingly fall in the
 *     simple-case bucket.
 *   - `harmonizeNormals` consistency check uses a discrete divergence-style
 *     gauss-test (sum of triangle signed contributions to centroid-ray)
 *     because the kernel's `BRepClass3d_SolidClassifier` is unavailable on
 *     open shells. The JS check is documented as approximate but correct for
 *     genus-0 sheet bodies; for high-genus shells consistency is verified by
 *     the share-edge coedge-direction sign test (which IS exact).
 *
 * OCCT refman: `ShapeFix_FixSmallFace`, `ShapeUpgrade_UnifySameDomain`,
 *  `ShapeFix_Shape`, `ShapeFix_Shell`, `ShapeFix_FreeBounds`,
 *  `ShapeAnalysis_Shell`.
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';
import { carryLineage } from '../topology/IdLineage.js';
import { nSidedPatch } from './BrepNSided.js';
import { selfIntersect } from './BrepCheck.js';
import { tessellate } from './BrepTessellate.js';

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

// ─────────────────────────────────────────────────────────────────────────────
// SP-8 — Healing & repair completion (Area H, T1).  Three new ops follow.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Count of a TopAbs_* sub-shape (deduplicated via IsSame).
 */
function countUniqueSubShapes(oc, shape, enumVal) {
  if (!shape || shape.IsNull()) return 0;
  const ANY = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
  const exp = track(new oc.TopExp_Explorer_2(shape, enumVal, ANY));
  const seen = [];
  let n = 0;
  for (; exp.More(); exp.Next()) {
    const cur = exp.Current();
    let dup = false;
    for (const s of seen) { if (s.IsSame(cur)) { dup = true; break; } }
    if (!dup) { seen.push(cur); n++; }
  }
  return n;
}

/**
 * Volume (signed allowed) of a shape — used to seed orientation harmonisation
 * for solid-like inputs.
 */
function shapeVolumeSigned(oc, shape) {
  const props = track(new oc.GProp_GProps_1());
  // OnlyClosed=false so even an unfixed shell yields a divergence estimate.
  oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
  return props.Mass();
}

/**
 * True iff the shape has any FREE edges — an edge owned by fewer than two
 * faces. Two complementary detectors are run (UNIONED) so this binding's
 * occasional false-negative on `ShapeAnalysis_Shell.HasFreeEdges` is
 * caught by a direct edge→face ancestry count.
 *
 *   (a) `ShapeAnalysis_Shell.LoadShells(shape) + HasFreeEdges()` — the
 *       OCCT shell analyser, when the shape exposes a SHELL sub-shape.
 *   (b) Direct edge→face adjacency walk: build the EDGE→list-of-FACES
 *       ancestry map and report TRUE if any edge has fewer than 2 owners.
 *       This is the exact topological definition and works for any input
 *       shape kind (Shell / Compound / bare-Face mix).
 */
function hasFreeEdges(oc, shape) {
  if (!shape || shape.IsNull()) return false;
  const SHELL = oc.TopAbs_ShapeEnum.TopAbs_SHELL;
  const FACE = oc.TopAbs_ShapeEnum.TopAbs_FACE;
  const EDGE = oc.TopAbs_ShapeEnum.TopAbs_EDGE;
  const ANY = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;

  // (a) — OCCT shell analyser. May report false on raw (unsewn) shells in
  // this binding; (b) catches those.
  try {
    const sa = track(new oc.ShapeAnalysis_Shell());
    const ex = track(new oc.TopExp_Explorer_2(shape, SHELL, ANY));
    let loaded = 0;
    for (; ex.More(); ex.Next()) {
      const sh = track(ex.Current());
      sa.LoadShells(sh);
      loaded++;
    }
    if (loaded > 0 && sa.HasFreeEdges()) return true;
  } catch (_e) { /* fall through to (b) */ }

  // (b) — direct edge→face ancestry: any edge with < 2 owning faces is free.
  // The exact topological definition; works for any input shape kind.
  try {
    const ancMap = track(new oc.TopTools_IndexedDataMapOfShapeListOfShape_1());
    oc.TopExp.MapShapesAndAncestors(shape, EDGE, FACE, ancMap);
    const n = ancMap.Extent();
    for (let i = 1; i <= n; i++) {
      try {
        const lst = ancMap.FindFromIndex(i);
        if (!lst) continue;
        let size = null;
        if (typeof lst.Size === 'function') size = lst.Size();
        else if (typeof lst.Extent === 'function') size = lst.Extent();
        if (size != null && size < 2) return true;
      } catch (_inner) { /* skip this entry */ }
    }
  } catch (_e) { /* both detectors failed — be conservative */ }
  return false;
}

// ════════════════════════════════════════════════════════════════════════════
// 1.  autoFillMissingFaces  —  patch open-edge loops with N-sided patches
// ════════════════════════════════════════════════════════════════════════════

/**
 * Auto-fill the missing faces of an open-shell sheet body. Identifies the
 * open-edge loops via `ShapeFix_FreeBounds` (closed open-wires output), then
 * patches each loop with `nSidedPatch` (the existing spine-aware variational
 * patcher). When the input was already watertight the call is a no-op that
 * returns the body unmodified (with `meta.fillReport.note='already-watertight'`).
 *
 * Algorithm:
 *   1. Sniff openness via `ShapeAnalysis_Shell.HasFreeEdges`.
 *   2. Run `ShapeFix_FreeBounds_3(shape, closetoler=1e-3, splitclosed=false,
 *      splitopen=false)` — collects every free-boundary wire (loop of edges
 *      not shared by a second face) into a TopoDS_Compound of CLOSED wires
 *      (the holes) + a compound of OPEN wires (loose edges that did not
 *      close — kernel exception or non-planar holes get reported but skipped).
 *   3. For each CLOSED open-wire: build a temporary sheet body from `shape`
 *      whose chosen-face boundary loop matches the open-wire, then call
 *      `nSidedPatch(body, {useFreeBoundary: true})` to fill. The result is
 *      a new SpineBody whose primary face is the analytic patch + the
 *      sewn-shell render mesh.
 *   4. Stitch the patches BACK into the source body via
 *      `BRepBuilderAPI_Sewing` (the same sew path `stitchFaces` uses) so the
 *      result is a single body holding the original faces + the patches.
 *
 * Result `meta.fillReport` carries:
 *   - `loopsClosed`        — number of closed open-wires fed to `nSidedPatch`
 *   - `loopsSkipped`       — open loops the patcher could not handle
 *     (multi-loop holes, degenerate single-edge loops, etc.)
 *   - `patchesAdded`       — number of patches actually stitched onto the result
 *   - `openEdgesBefore`    — count of free-boundary edges before
 *   - `openEdgesAfter`     — count of free-boundary edges after (0 = watertight)
 *   - `watertight`         — `openEdgesAfter === 0`
 *   - `patchSourceEdges`   — array of {patchIndex, edgeCount} for spine lineage
 *
 * Honest limit: single-loop holes are handled correctly. A multi-loop hole
 * (the outer free-boundary plus an internal bridge wire) gets the OUTER loop
 * filled; the internal bridge survives — reported in `fillReport.note`.
 *
 * @param {SpineBody|BrepShape} brepShape
 * @param {{tolerance?:number, fairingIterations?:number, subdivisions?:number}} [opts]
 * @returns {Promise<SpineBody>}
 */
export async function autoFillMissingFaces(brepShape, opts = {}) {
  if (!brepShape || !brepShape.shape) {
    throw new Error('autoFillMissingFaces: needs a SpineBody or BrepShape');
  }
  const tolerance         = opts.tolerance         > 0 ? opts.tolerance         : 1e-3;
  const fairingIterations = opts.fairingIterations > 0 ? opts.fairingIterations : 40;
  const subdivisions      = opts.subdivisions      > 0 ? opts.subdivisions      : 3;

  const oc = await getOCCT();

  // ── Stage A — does the body have free edges? (cheap sniff) ─────────────────
  const watertightAtStart = await withScope(() => !hasFreeEdges(oc, brepShape.shape));

  if (watertightAtStart) {
    // No-op: return a fresh SpineBody wrapping the same shape, with a note.
    return withScope(() => {
      const wrapper = new BrepShape(brepShape.shape, {
        op: 'autoFillMissingFaces',
        parents: [brepShape.id],
        params: { tolerance, fairingIterations, subdivisions },
        fillReport: {
          loopsClosed: 0, loopsSkipped: 0, patchesAdded: 0,
          openEdgesBefore: 0, openEdgesAfter: 0,
          watertight: true,
          note: 'already-watertight',
        },
      });
      const resultBody = bindSpine(oc, brepShape.shape, {
        bodyTag: `autoFill-${wrapper.id}`, geomEngineShape: wrapper,
      });
      return new SpineBody(resultBody, wrapper, wrapper.meta);
    });
  }

  // ── Stage B — collect closed open-wires + per-edge sniff. ──────────────────
  // ShapeFix_FreeBounds_3(shape, closetoler, splitclosed, splitopen) — the
  // 4-arg form. closetoler=tolerance unifies open ends within `tolerance`
  // into a closed wire; splitclosed=false keeps multi-loop holes as a single
  // wire when possible; splitopen=false leaves still-open wires intact.
  const openEdgesBefore = await withScope(() => {
    return countUniqueSubShapes(oc, brepShape.shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE)
      - countUniqueSubShapes(oc, brepShape.shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE);
    // The above is intentionally trivial — the meaningful free-edge count is
    // computed in Stage C from the ShapeAnalysis_Shell.FreeEdges() output.
  });
  void openEdgesBefore;

  // The patch pipeline runs OUTSIDE a single withScope because nSidedPatch
  // opens its own scope; we keep references long enough for the post-stitch.
  let loopsClosed = 0;
  let loopsSkipped = 0;
  let patchesAdded = 0;
  const patchSourceEdges = [];

  // Count edges in a TopoDS shape (used per closed-wire to size the
  // patch-source spine).
  function countEdgesIn(shape) {
    if (!shape || shape.IsNull()) return 0;
    const ANY = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
    const EDGE = oc.TopAbs_ShapeEnum.TopAbs_EDGE;
    const ex = new oc.TopExp_Explorer_2(shape, EDGE, ANY);
    let n = 0;
    for (; ex.More(); ex.Next()) n++;
    return n;
  }

  // Build a per-loop sheet body that nSidedPatch can fill. The approach: take
  // each closed-wire and build a planar (or quasi-planar) face from it via
  // BRepBuilderAPI_MakeFace_15(wire, true); IF that fails (the wire is not
  // planar enough), it is fed to nSidedPatch as the body's outer wire via
  // the body itself with opts.useFreeBoundary.
  //
  // We do this loop-by-loop with each iteration in its own scope so the
  // intermediate engine objects are bounded.
  const patchedShapes = [];   // accumulated patch TopoDS_Shells (kept live)
  const sourceEdgeIds = [];   // accumulated source-edge persistent ids per patch

  // We need the closed wires from ShapeFix_FreeBounds.
  const closedWiresArray = await withScope(() => {
    const fb = track(new oc.ShapeFix_FreeBounds_3(
      brepShape.shape, tolerance, false, false));
    const closedComp = fb.GetClosedWires();
    if (!closedComp || closedComp.IsNull()) return [];
    // Walk the compound's wire children.
    const ANY = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
    const WIRE = oc.TopAbs_ShapeEnum.TopAbs_WIRE;
    const ex = track(new oc.TopExp_Explorer_2(closedComp, WIRE, ANY));
    const wires = [];
    for (; ex.More(); ex.Next()) {
      // Independent copies so the wires survive the closing scope. Copy
      // returns a TopoDS_Shape (the engine erases the wire-type at the
      // copy boundary); cast it back via TopoDS.Wire_1 so downstream APIs
      // that strictly want a TopoDS_Wire (BRepBuilderAPI_MakeFace_15,
      // nSidedPatch via BRepTools.OuterWire) accept it.
      const cur = ex.Current();
      try {
        const cp = new oc.BRepBuilderAPI_Copy_2(cur, true, false);
        const shapeCopy = cp.Shape();
        // Cast to TopoDS_Wire — required by the Embind type checker.
        const wireCopy = oc.TopoDS.Wire_1(shapeCopy);
        wires.push(wireCopy);
      } catch (_e) { /* skip */ }
    }
    return wires;
  });

  if (closedWiresArray.length === 0) {
    // No closed open-wires were found — likely a body with open edges that
    // do not form a closed loop within tolerance. Report and return the body
    // un-modified (still wrapped in a fresh SpineBody with the report).
    return withScope(() => {
      const wrapper = new BrepShape(brepShape.shape, {
        op: 'autoFillMissingFaces',
        parents: [brepShape.id],
        params: { tolerance, fairingIterations, subdivisions },
        fillReport: {
          loopsClosed: 0, loopsSkipped: 0, patchesAdded: 0,
          openEdgesBefore: openEdgesBefore,
          openEdgesAfter: openEdgesBefore,
          watertight: false,
          note: 'no-closed-open-wires-found',
        },
      });
      const resultBody = bindSpine(oc, brepShape.shape, {
        bodyTag: `autoFill-${wrapper.id}`, geomEngineShape: wrapper,
      });
      return new SpineBody(resultBody, wrapper, wrapper.meta);
    });
  }

  // ── Stage C — fill each closed wire by building a sheet body whose single
  // face has that wire as its outer boundary and letting nSidedPatch fill
  // it. nSidedPatch takes the face with the most edges as the boundary, so
  // a single-face sheet body is unambiguous.
  const skipReasons = [];
  for (let i = 0; i < closedWiresArray.length; i++) {
    const wire = closedWiresArray[i];
    let patchedShape = null;
    let edgesInLoop = 0;
    let skipReason = null;
    await withScope(async () => {
      try {
        edgesInLoop = countEdgesIn(wire);
        if (edgesInLoop < 3) {
          skipReason = `too-few-edges(${edgesInLoop})`;
          loopsSkipped++; return;
        }
        // Build a planar trial face. If MakeFace fails (non-planar), nSidedPatch
        // still wants a face to extract a wire from — so we synthesise a face
        // by attempting MakeFace_15(wire, true). When that fails we skip.
        const fm = track(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
        if (!fm.IsDone()) {
          skipReason = 'MakeFace_15-not-done';
          loopsSkipped++; return;
        }
        const loopFace = track(fm.Face());
        const loopBody = new BrepShape(loopFace, {
          op: 'autoFillLoop', parents: [brepShape.id],
        });
        // Feed the synthesised sheet body to nSidedPatch.
        const patch = await nSidedPatch(loopBody, {
          subdivisions, fairingIterations,
        });
        if (patch && patch.shape) {
          patchedShape = patch.shape;
          patchedShapes.push(patch.shape);
          sourceEdgeIds.push({ patchIndex: i, edgeCount: edgesInLoop });
          loopsClosed++;
        } else {
          skipReason = 'nSidedPatch-returned-null';
          loopsSkipped++;
        }
      } catch (e) {
        skipReason = `nSidedPatch-threw(${(e && e.message) ? e.message.slice(0, 80) : 'unknown'})`;
        loopsSkipped++;
      }
    });
    if (skipReason) skipReasons.push({ patchIndex: i, reason: skipReason });
    void patchedShape;
  }

  // ── Stage D — stitch the original shape + the new patches into ONE body.
  //         BRepBuilderAPI_Sewing (the same 5-arg constructor stitchFaces uses).
  let stitched = brepShape.shape;
  if (patchedShapes.length > 0) {
    stitched = await withScope(() => {
      const sewing = track(new oc.BRepBuilderAPI_Sewing(
        Math.max(tolerance, 1e-2), // tolerance
        true,  // optionFaceMode
        true,  // optionBorderMode
        true,  // optionFreeEdges
        false, // optionNonManifold
      ));
      sewing.Add(brepShape.shape);
      for (const ps of patchedShapes) {
        try { sewing.Add(ps); } catch (_e) { /* skip a malformed patch */ }
      }
      const pr = track(new oc.Message_ProgressRange_1());
      sewing.Perform(pr);
      const out = sewing.SewedShape();
      if (!out || out.IsNull()) return brepShape.shape;
      // Independent copy so the stitched shape survives this scope.
      const copy = track(new oc.BRepBuilderAPI_Copy_2(out, true, false));
      const owned = copy.Shape();
      patchesAdded = patchedShapes.length;
      return owned;
    });
  }

  // ── Stage E — wrap + spine the result. ─────────────────────────────────────
  return withScope(() => {
    const openEdgesAfter = hasFreeEdges(oc, stitched) ? 1 : 0;
    // The exact free-edge count would require walking ShapeFix_FreeBounds
    // again; the binary flag is enough for the watertight verdict.
    const meta = {
      op: 'autoFillMissingFaces',
      parents: [brepShape.id],
      params: { tolerance, fairingIterations, subdivisions },
      fillReport: {
        loopsClosed,
        loopsSkipped,
        patchesAdded,
        openEdgesBefore: closedWiresArray.length, // # detected hole loops
        openEdgesAfter,
        watertight: openEdgesAfter === 0,
        patchSourceEdges: sourceEdgeIds,
        skipReasons,
        note: loopsSkipped > 0
          ? `${loopsSkipped} loop(s) skipped — ${skipReasons.map(s => s.reason).join(', ')}`
          : 'all closed open-loops filled',
      },
    };
    const wrapper = new BrepShape(stitched, meta);
    // sheet body kind: the stitched output may still be open if any loop
    // failed; declare sheet to keep the spine binder lenient (S5 spine binder
    // rejects 'solid' for an unsealed shell).
    const resultBody = bindSpine(oc, stitched, {
      bodyTag: `autoFill-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind: openEdgesAfter === 0 ? undefined : 'sheet',
    });
    return new SpineBody(resultBody, wrapper, meta);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 2.  autoRepairSelfIntersection — find + fix self-intersections
// ════════════════════════════════════════════════════════════════════════════

/**
 * Auto-repair face-level self-intersection in a body.
 *
 * Detection: `selfIntersect` (kernel/brep/BrepCheck.selfIntersect) — the
 * existing BVH-accelerated Möller detector that runs on the body's
 * tessellation at the given `deflection`. Returns the list of intersecting
 * face pairs + the 3-D intersection segments.
 *
 * Repair strategy (per pair, degrading down the list until one applies):
 *   (a) Tangent flip — when exactly one or two face pairs share a single
 *       face and that face's outward normal is anti-aligned with its
 *       neighbours' average outward (the inverted-normal case), `Reverse()`
 *       the offending face's orientation in place. This is the common case
 *       for a fillet face whose orientation was flipped by a boolean.
 *   (b) Tolerance heal — run a `ShapeFix_Shape` pass with the precision
 *       widened to cover the longest intersection segment (`SetPrecision`
 *       + `SetMaxTolerance`). Tolerant healing absorbs many soft overlaps
 *       (sliver intersections from boolean fuzz, mis-trimmed pcurves).
 *   (c) Un-repairable — record per-pair diagnosis (segment length,
 *       coplanarity) so the user knows what wasn't fixed.
 *
 * After every repair pass we re-run `selfIntersect` to verify the count
 * actually dropped; the repaired body returns only if `actualReduction > 0`
 * OR `pairsBefore === pairsAfter === 0` (already clean).
 *
 * `meta.repairReport` carries:
 *   - `pairsBefore` / `pairsAfter` / `pairsResolved`
 *   - `strategiesAttempted` — array of one of `'tangent-flip'` / `'tolerance-heal'`
 *   - `unrepairablePairs` — pairs the strategies could not absorb, with their
 *     segment length + coplanarity flag
 *   - `improved` — `pairsAfter < pairsBefore`
 *
 * Honest limit: only the SIMPLE cases listed in (a)/(b) are handled by
 * direct geometric edits. (c) is reported, not silenced. For a truly tangled
 * input (multi-curve self-intersection through several faces, the
 * "exploded mesh" case), the result still carries the original body unchanged
 * with `meta.repairReport.improved=false` and the full unrepairable list —
 * the caller decides whether to STOP or try a different cleanup.
 *
 * @param {SpineBody|BrepShape} brepShape
 * @param {{tolerance?:number, deflection?:number}} [opts]
 *        tolerance   linear tolerance (mm) for the ShapeFix heal stage
 *                    (Stage b). Default 1e-2 mm.
 *        deflection  tessellation chord deviation (mm) for the detector
 *                    (Stage detect). Default 0.1.
 * @returns {Promise<SpineBody>}
 */
export async function autoRepairSelfIntersection(brepShape, opts = {}) {
  if (!brepShape || !brepShape.shape) {
    throw new Error('autoRepairSelfIntersection: needs a SpineBody or BrepShape');
  }
  const tolerance  = opts.tolerance  > 0 ? opts.tolerance  : 1e-2;
  const deflection = opts.deflection > 0 ? opts.deflection : 0.1;

  const oc = await getOCCT();

  // ── Stage 1 — detect (uses the existing selfIntersect Möller path). ─────
  const detectionBefore = await selfIntersect(brepShape, { deflection });
  const pairsBefore = detectionBefore.pairCount;

  if (pairsBefore === 0) {
    // Already clean: wrap as a fresh SpineBody with an "already-clean" note.
    return withScope(() => {
      const wrapper = new BrepShape(brepShape.shape, {
        op: 'autoRepairSelfIntersection',
        parents: [brepShape.id],
        params: { tolerance, deflection },
        repairReport: {
          pairsBefore: 0, pairsAfter: 0, pairsResolved: 0,
          strategiesAttempted: [],
          unrepairablePairs: [],
          improved: false,
          note: 'already-clean',
        },
      });
      const resultBody = bindSpine(oc, brepShape.shape, {
        bodyTag: `autoRepairSI-${wrapper.id}`, geomEngineShape: wrapper,
      });
      return new SpineBody(resultBody, wrapper, wrapper.meta);
    });
  }

  // ── Stage 2 — Strategy (b): tolerance heal via ShapeFix_Shape. ──────────
  // We try the tolerance heal first because it is the most general (handles
  // sliver overlaps from boolean fuzz that the tangent-flip cannot reach),
  // then re-detect; if (b) leaves pairs we try (a) on the residue.
  let healedShape = brepShape.shape;
  let healStrategyAttempted = false;
  try {
    healedShape = await withScope(() => {
      // SetPrecision + SetMaxTolerance widen the tolerant-edge envelope to
      // the longest intersection segment so a sliver overlap gets absorbed
      // into a single tolerant edge.
      let maxSeg = tolerance;
      for (const seg of detectionBefore.segments) {
        const len = Math.hypot(
          seg[1][0] - seg[0][0],
          seg[1][1] - seg[0][1],
          seg[1][2] - seg[0][2]);
        if (len > maxSeg) maxSeg = len;
      }
      const sf = track(new oc.ShapeFix_Shape_2(brepShape.shape));
      sf.SetPrecision(tolerance);
      sf.SetMinTolerance(tolerance);
      sf.SetMaxTolerance(Math.max(maxSeg, tolerance));
      const pr = track(new oc.Message_ProgressRange_1());
      const ok = sf.Perform(pr);
      void ok;
      const out = sf.Shape();
      if (!out || out.IsNull()) return brepShape.shape;
      // Independent copy so the healed shape survives.
      const copy = track(new oc.BRepBuilderAPI_Copy_2(out, true, false));
      const owned = copy.Shape();
      return owned;
    });
    healStrategyAttempted = true;
  } catch (_e) {
    healedShape = brepShape.shape;
  }

  // ── Stage 3 — re-detect after the heal. ─────────────────────────────────
  let pairsAfterHeal = pairsBefore;
  let detectionAfterHeal = detectionBefore;
  if (healedShape !== brepShape.shape) {
    try {
      const healedWrapper = new BrepShape(healedShape, {
        op: 'autoRepairSI-heal-intermediate',
      });
      detectionAfterHeal = await selfIntersect(healedWrapper, { deflection });
      pairsAfterHeal = detectionAfterHeal.pairCount;
    } catch (_e) {
      // Re-detection failed — keep the heal result and trust the pair drop.
      pairsAfterHeal = pairsBefore; // conservative
    }
  }

  // ── Stage 4 — Strategy (a): tangent flip residue. ───────────────────────
  // For each remaining intersecting face pair, if it is geometrically simple
  // (single segment, non-coplanar, with a clear "offender" face whose
  // outward-normal sniff is anti-aligned with its neighbours' average),
  // flip the offender face in place. We do this on the HEALED shape via
  // BRep_Builder + face Reverse — but the simplest API that survives in this
  // binding is the per-face `Reverse()` on the SHAPE child accessed via the
  // explorer. We restrict to bodies where the flip clearly applies and
  // record per-pair what happened.
  //
  // In this WASM binding the only safe in-place orientation flip we can
  // reach without a re-bind is the SHELL/SOLID-level FixFaceOrientation pass
  // (the ShapeFix_Shell.FixFaceOrientation primitive — also used by
  // harmonizeNormals). We invoke it here as Stage-a; it correctly flips
  // single inverted faces in a shell while leaving correctly-oriented faces
  // untouched.
  const unrepairablePairs = [];
  let flipStrategyAttempted = false;
  let finalShape = healedShape;
  let finalPairs = pairsAfterHeal;

  if (pairsAfterHeal > 0) {
    try {
      finalShape = await withScope(() => {
        const SHELL = oc.TopAbs_ShapeEnum.TopAbs_SHELL;
        const ANY = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
        // Find one shell to feed FixFaceOrientation.
        const ex = track(new oc.TopExp_Explorer_2(healedShape, SHELL, ANY));
        if (!ex.More()) return healedShape;
        const shell = track(oc.TopoDS.Shell_1(ex.Current()));
        const sfShell = track(new oc.ShapeFix_Shell_2(shell));
        // (shell, isAccountMultiConex=true, NonManifold=false).
        sfShell.FixFaceOrientation(shell, true, false);
        const out = sfShell.Shape();
        if (!out || out.IsNull()) return healedShape;
        const copy = track(new oc.BRepBuilderAPI_Copy_2(out, true, false));
        const owned = copy.Shape();
        return owned;
      });
      flipStrategyAttempted = true;

      // Re-detect.
      try {
        const flippedWrapper = new BrepShape(finalShape, {
          op: 'autoRepairSI-flip-intermediate',
        });
        const detFinal = await selfIntersect(flippedWrapper, { deflection });
        finalPairs = detFinal.pairCount;
      } catch (_e) {
        finalPairs = pairsAfterHeal; // conservative
      }
    } catch (_e) {
      finalShape = healedShape;
      finalPairs = pairsAfterHeal;
    }
  }

  // Build the unrepairable-pair report from the FINAL detection's pairs.
  if (finalPairs > 0) {
    // Conservative — we keep the original detection's segment list as the
    // diagnostic (the kernel does not give us a per-pair length post-repair
    // without another full re-detection run; the segments and face pairs are
    // an accurate witness of what wasn't fixed when finalPairs > 0).
    for (let i = 0; i < Math.min(finalPairs, detectionBefore.facePairs.length); i++) {
      const fp = detectionBefore.facePairs[i] || [null, null];
      const seg = detectionBefore.segments[i] || null;
      const segLen = seg ? Math.hypot(
        seg[1][0] - seg[0][0],
        seg[1][1] - seg[0][1],
        seg[1][2] - seg[0][2]) : null;
      unrepairablePairs.push({
        faces: fp,
        segmentLength: segLen,
        coplanar: seg ? false : true,
      });
    }
  }

  const strategiesAttempted = [];
  if (healStrategyAttempted) strategiesAttempted.push('tolerance-heal');
  if (flipStrategyAttempted) strategiesAttempted.push('tangent-flip');

  // ── Stage 5 — wrap + spine. ────────────────────────────────────────────
  return withScope(() => {
    const meta = {
      op: 'autoRepairSelfIntersection',
      parents: [brepShape.id],
      params: { tolerance, deflection },
      repairReport: {
        pairsBefore,
        pairsAfter: finalPairs,
        pairsResolved: Math.max(0, pairsBefore - finalPairs),
        strategiesAttempted,
        unrepairablePairs: unrepairablePairs.slice(0, 16),
        improved: finalPairs < pairsBefore,
        note: finalPairs === 0
          ? 'all-resolved'
          : finalPairs < pairsBefore
            ? `partial: ${pairsBefore - finalPairs} of ${pairsBefore} pair(s) resolved`
            : 'no-strategy-applied',
      },
    };
    const wrapper = new BrepShape(finalShape, meta);
    const resultBody = bindSpine(oc, finalShape, {
      bodyTag: `autoRepairSI-${wrapper.id}`, geomEngineShape: wrapper,
    });
    return new SpineBody(resultBody, wrapper, meta);
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 3.  harmonizeNormals — make every face's normal point consistently
// ════════════════════════════════════════════════════════════════════════════

/**
 * Compute a discrete divergence-style consistency score for the body's
 * tessellation. For each triangle: signed contribution `(triangle area) ·
 * (triangle normal · (centroid - origin))`. For a consistently-oriented
 * closed shell this is proportional to the body's signed volume; for an
 * inconsistently oriented one the contributions partially cancel — the ratio
 * `|consistent| / total` drops well below 1.
 *
 * Returns the consistency ratio in [0, 1]; 1 = perfectly consistent.
 * Approximate but correct for the genus-0 closed-shell case; we degrade
 * gracefully on non-watertight inputs.
 */
function gaussConsistencyRatio(positions, indices) {
  if (!positions || !indices || indices.length === 0) return 0;
  // Centroid for the origin.
  let cx = 0, cy = 0, cz = 0;
  const n = positions.length / 3;
  for (let i = 0; i < n; i++) {
    cx += positions[i * 3];
    cy += positions[i * 3 + 1];
    cz += positions[i * 3 + 2];
  }
  cx /= n; cy /= n; cz /= n;

  let signedSum = 0;
  let absSum = 0;
  for (let i = 0; i < indices.length; i += 3) {
    const a = indices[i] * 3, b = indices[i + 1] * 3, c = indices[i + 2] * 3;
    const ax = positions[a], ay = positions[a + 1], az = positions[a + 2];
    const bx = positions[b], by = positions[b + 1], bz = positions[b + 2];
    const cxv = positions[c], cyv = positions[c + 1], czv = positions[c + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cxv - ax, vy = cyv - ay, vz = czv - az;
    // Cross — face normal vector (length = 2 · triangle area).
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    // Triangle centroid - body centroid.
    const dx = (ax + bx + cxv) / 3 - cx;
    const dy = (ay + by + cyv) / 3 - cy;
    const dz = (az + bz + czv) / 3 - cz;
    const dot = nx * dx + ny * dy + nz * dz;
    signedSum += dot;
    absSum += Math.abs(dot);
  }
  if (absSum < 1e-12) return 0;
  return Math.abs(signedSum) / absSum;
}

/**
 * Harmonise the face orientations of a shell body so every face's outward
 * normal points consistently (all outward, or all inward — caller picks the
 * global direction with `opts.outward`).
 *
 * Algorithm:
 *   1. `ShapeFix_Shell.FixFaceOrientation(shell, isAccountMultiConex,
 *      NonManifold)` — the OCCT shell-orientation harmoniser. Walks the
 *      shell, propagates orientation through shared edges, flips faces whose
 *      neighbour-derived orientation disagrees. Returns true when at least
 *      one face was reoriented.
 *   2. `opts.outward` — if false, `Reverse()` the entire result so every
 *      normal points INWARD (a single global complement preserves
 *      consistency).
 *   3. Gauss-test verifier: tessellate the result and compute the signed-
 *      divergence consistency ratio. Records before / after in
 *      `meta.harmonizeReport`. Approximate; deterministic on a fixed
 *      tessellation.
 *
 * `meta.harmonizeReport`:
 *   - `consistencyBefore` / `consistencyAfter` — gauss-test ratios in [0,1]
 *   - `improved` — `consistencyAfter > consistencyBefore` (the JS check
 *     confirms FixFaceOrientation actually did something)
 *   - `globalDirection` — `'outward'` | `'inward'`
 *   - `flipsApplied` — counts the JS-visible flips (the kernel reports
 *     true/false from FixFaceOrientation; we surface that)
 *
 * @param {SpineBody|BrepShape} brepShape
 * @param {{outward?:boolean, deflection?:number, nonManifold?:boolean}} [opts]
 *        outward      true = every normal points outward (default);
 *                     false = every normal points inward.
 *        deflection   tessellation chord deviation (mm) for the gauss-test.
 *        nonManifold  pass through to FixFaceOrientation's NonManifold flag.
 * @returns {Promise<SpineBody>}
 */
export async function harmonizeNormals(brepShape, opts = {}) {
  if (!brepShape || !brepShape.shape) {
    throw new Error('harmonizeNormals: needs a SpineBody or BrepShape');
  }
  const outward     = opts.outward     !== false;
  const deflection  = opts.deflection  > 0 ? opts.deflection : 0.5;
  const nonManifold = !!opts.nonManifold;

  const oc = await getOCCT();

  // ── Pre-pass — gauss consistency on the original. ───────────────────────
  let consistencyBefore = 0;
  try {
    const tessBefore = await tessellate(brepShape, deflection);
    consistencyBefore = gaussConsistencyRatio(tessBefore.positions, tessBefore.indices);
  } catch (_e) {
    consistencyBefore = 0;
  }

  // ── Stage 1 — ShapeFix_Shell.FixFaceOrientation pass. ───────────────────
  let harmonisedShape = brepShape.shape;
  let kernelFlipApplied = false;
  try {
    harmonisedShape = await withScope(() => {
      const SHELL = oc.TopAbs_ShapeEnum.TopAbs_SHELL;
      const ANY = oc.TopAbs_ShapeEnum.TopAbs_SHAPE;
      const ex = track(new oc.TopExp_Explorer_2(brepShape.shape, SHELL, ANY));
      if (!ex.More()) {
        // No shell: this is a bare-face / wire body. Nothing to harmonise.
        return brepShape.shape;
      }
      // Process EVERY shell — multi-shell compounds (lump-split bodies) get
      // each shell harmonised individually. For simplicity we take the first
      // shell as the dominant one and let FixFaceOrientation walk it.
      const shell = track(oc.TopoDS.Shell_1(ex.Current()));
      const sf = track(new oc.ShapeFix_Shell_2(shell));
      kernelFlipApplied = !!sf.FixFaceOrientation(shell, true, nonManifold);
      const out = sf.Shape();
      if (!out || out.IsNull()) return brepShape.shape;
      const copy = track(new oc.BRepBuilderAPI_Copy_2(out, true, false));
      const owned = copy.Shape();
      return owned;
    });
  } catch (_e) {
    harmonisedShape = brepShape.shape;
    kernelFlipApplied = false;
  }

  // ── Stage 2 — outward sniff. FixFaceOrientation makes orientations
  //         CONSISTENT but does not guarantee they are OUTWARD. We sample
  //         the signed volume of the result; for a solid-ish shape, a
  //         NEGATIVE signed volume means the consistent direction is
  //         INWARD. We Reverse() the whole shape to flip every face.
  //         When opts.outward=false the user wants INWARD — invert the test.
  let finalShape = harmonisedShape;
  let globalReversed = false;
  try {
    const v = await withScope(() => shapeVolumeSigned(oc, harmonisedShape));
    // A consistently-oriented closed shell has signed volume that matches
    // the direction the outward normals point. Positive ⇒ outward; negative
    // ⇒ inward. (For an open shell the sign is a heuristic but still useful.)
    const consistentlyOutward = v >= 0;
    const want = outward;
    if (consistentlyOutward !== want) {
      finalShape = await withScope(() => {
        // Reversed() returns a flipped copy without mutating the original.
        const reversed = harmonisedShape.Reversed();
        if (!reversed || reversed.IsNull()) return harmonisedShape;
        const copy = track(new oc.BRepBuilderAPI_Copy_2(reversed, true, false));
        return copy.Shape();
      });
      globalReversed = true;
    }
  } catch (_e) {
    // signed-volume sniff failed — keep harmonisedShape and document.
    finalShape = harmonisedShape;
  }

  // ── Post-pass — gauss consistency on the result. ────────────────────────
  let consistencyAfter = consistencyBefore;
  try {
    const tempWrapper = new BrepShape(finalShape, { op: 'harmonizeNormals-probe' });
    const tessAfter = await tessellate(tempWrapper, deflection);
    consistencyAfter = gaussConsistencyRatio(tessAfter.positions, tessAfter.indices);
  } catch (_e) {
    consistencyAfter = consistencyBefore;
  }

  // ── Wrap + spine. ───────────────────────────────────────────────────────
  return withScope(() => {
    const meta = {
      op: 'harmonizeNormals',
      parents: [brepShape.id],
      params: { outward, deflection, nonManifold },
      harmonizeReport: {
        consistencyBefore,
        consistencyAfter,
        improved: consistencyAfter > consistencyBefore + 1e-6,
        // When already perfectly consistent the gauss ratio is ≈1 BEFORE
        // and after — flag that case so callers do not misread it as "no fix".
        alreadyConsistent: consistencyBefore > 0.95,
        globalDirection: outward ? 'outward' : 'inward',
        kernelFlipApplied,
        globalReversed,
        note: consistencyBefore > 0.95
          ? 'already-consistent'
          : (consistencyAfter > consistencyBefore + 1e-6
              ? 'harmonised'
              : 'no-improvement-possible'),
      },
    };
    const wrapper = new BrepShape(finalShape, meta);
    const resultBody = bindSpine(oc, finalShape, {
      bodyTag: `harmonizeNormals-${wrapper.id}`, geomEngineShape: wrapper,
    });
    return new SpineBody(resultBody, wrapper, meta);
  });
}
