/**
 * ArchDisc Kernel — surfacing operations: sweep along a path,
 * loft through sections.
 *
 * SP-1 S4c (surfacing subset) — every op here is spine-aware:
 *   1. Run the engine algorithm (BRepOffsetAPI_MakePipe / ThruSections —
 *      geometry unchanged).
 *   2. Bind the result shape to a spine `Body` via `bindSpine`.
 *   3. Carry persistent-ID lineage through using the algorithm's
 *      `Modified` / `Generated` / `IsDeleted` history maps. Both
 *      `BRepOffsetAPI_MakePipe` (via `BRepPrimAPI_MakeSweep`) and
 *      `BRepOffsetAPI_ThruSections` inherit the full contract from
 *      `BRepBuilderAPI_MakeShape` — confirmed in
 *      `opencascade.full.d.ts` lines 11072-11081 (MakePipe inherits
 *      Modified/IsDeleted from base; declares Generated_1/Generated_2),
 *      lines 11230-11253 (ThruSections extends MakeShape, declares
 *      Generated natively, inherits Modified/IsDeleted), and lines
 *      11768-11774 (MakeShape base).
 *   4. Wrap in a `SpineBody`.
 *
 * Surfacing ops do not consume an existing body — the profile / section
 * wires are constructed internally. To carry persistent ids onto the
 * result we spine the profile face (sweep) and the section wires (loft)
 * as TEMPORARY sheet bodies, then call `carryLineage` consuming the
 * sweep/loft algorithm's history. This mirrors the extrudeRect / revolveRect
 * pattern in BrepFeatures.js. The bottom cap of a sweep is the profile
 * face (`survived-as-id`); the top cap is its `Modified`; the lateral
 * tube faces are `Generated` from each profile edge — the canonical
 * sweep lineage contract.
 *
 * Verified kernel sequences: docs/superpowers/notes/kernel-api-A2.md items 5-6.
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';
import { carryLineage } from '../topology/IdLineage.js';
import {
  recordBodyCreate,
  standardSceneRegister,
  standardSceneRemove,
} from '../history/HistoryLog.js';

/**
 * Shared spine-binding + lineage-carry tail for the surfacing ops. Mirrors the
 * `bindFeatureResult` / `bindLocalOpResult` helpers so all S4 ops follow the
 * same canonical migration shape.
 *
 *   1. Wrap the engine TopoDS_Shape in a heap-managed BrepShape.
 *   2. bindSpine the engine result.
 *   3. If a `profileBody` is provided (the spined profile face / section
 *      sheet), carry its persistent ids through via `carryLineage(oc, algo,
 *      resultBody, [{body: profileBody}])`. Records the lineage report on
 *      `meta.lineage`.
 *   4. Wrap in a SpineBody.
 *
 * @param {object} oc            the engine module
 * @param {string} opName        op tag used in bodyTag + error prefix
 * @param {object[]} profileBodies  list of spined profile bodies whose ids
 *                                  should carry onto the result. Empty list
 *                                  is allowed (no lineage to carry).
 * @param {object} algo          the BRepOffsetAPI_* algorithm instance
 *                               (post-Build, IsDone()=true). Must expose
 *                               Modified(S) / Generated(S) / IsDeleted(S).
 * @param {object} shape         the engine TopoDS_Shape returned by the algo.
 * @param {object} meta          result meta — op + params, parents.
 * @returns {SpineBody}
 */
function bindSurfacingResult(oc, opName, profileBodies, algo, shape, meta, opts = {}) {
  if (shape.IsNull()) throw new Error(`${opName}: kernel produced a null shape`);
  const wrapper = new BrepShape(shape, meta);
  // S5: surfacing ops default to 'solid' (sweep/loft/pipeShellSweep/loftTangent
  // all close a swept profile into a volume). buildNurbsPatch / trimmedNurbsFace
  // explicitly declare 'sheet'.
  const resultBody = bindSpine(oc, shape, {
    bodyTag: opts.bodyTag || `${opName}-${wrapper.id}`, geomEngineShape: wrapper,
    declaredKind: opts.declaredKind || 'solid',
  });
  const inputBodies = profileBodies
    .filter((pb) => !!pb)
    .map((body) => ({ body, role: 'arg' }));
  if (inputBodies.length > 0) {
    const lineage = carryLineage(oc, algo, resultBody, inputBodies);
    meta.lineage = {
      survived: lineage.survived, modified: lineage.modified,
      generated: lineage.generated, deleted: lineage.deleted,
      conflicts: lineage.conflicts,
      faceMap: [...lineage.faceMap.entries()].slice(0, 64),
      edgeMap: [...lineage.edgeMap.entries()].slice(0, 64),
    };
  }
  return new SpineBody(resultBody, wrapper, meta);
}

/**
 * Sweep a circular profile (radius `r`) along a straight path of `length`
 * along +Z, producing a solid rod.
 *
 * SP-1 S4c — returns a SpineBody. The circular profile face is spined as a
 * temporary sheet body so the pipe's `Modified` / `Generated` history can
 * propagate its face / edge / vertex persistent ids onto the resulting
 * solid (bottom cap from the profile face; top cap from its Modified; the
 * tube lateral face Generated from the profile edge).
 *
 * @param {number} r       profile radius (mm)
 * @param {number} length  path length along +Z (mm)
 * @returns {Promise<SpineBody>}
 */
async function _constructSweep(r, length, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    // verified sequence from kernel-api-A2.md item 5

    // Step 1: Build circular profile FACE (disk)
    // gp_Ax2_2(origin, N, Vx) — 3 args: (gp_Pnt, gp_Dir, gp_Dir)
    const circOrigin = track(new oc.gp_Pnt_3(0, 0, 0));
    const circNormal = track(new oc.gp_Dir_4(0, 0, 1));  // Z = sweep direction
    const circXDir   = track(new oc.gp_Dir_4(1, 0, 0));
    const ax2        = track(new oc.gp_Ax2_2(circOrigin, circNormal, circXDir));

    // gp_Circ_2(gp_Ax2, radius)
    const circ = track(new oc.gp_Circ_2(ax2, r));

    // Full circle edge — BRepBuilderAPI_MakeEdge_8(gp_Circ)
    const circEdgeMaker = track(new oc.BRepBuilderAPI_MakeEdge_8(circ));
    const circEdge      = track(circEdgeMaker.Edge());

    // Profile wire
    const profileWM   = track(new oc.BRepBuilderAPI_MakeWire_1());
    profileWM.Add_1(circEdge);
    const profileWire = track(profileWM.Wire());

    // Profile FACE — BRepBuilderAPI_MakeFace_15(wire, isPlanar)
    // IMPORTANT: profile must be a FACE for a solid pipe result.
    // Passing a wire gives a hollow tube shell (wrong volume).
    const profileFM   = track(new oc.BRepBuilderAPI_MakeFace_15(profileWire, true));
    const profileFace = track(profileFM.Face());

    // Spine the profile face into a temporary sheet body so its faces /
    // edges / vertices have persistent ids. This is the input body for
    // the pipe's lineage propagation.
    const profileBody = bindSpine(oc, profileFace, {
      bodyTag: 'sweepProfile', validate: false,
    });

    // Step 2: Build path wire (straight line from z=0 to z=length)
    const pathP0   = track(new oc.gp_Pnt_3(0, 0, 0));
    const pathP1   = track(new oc.gp_Pnt_3(0, 0, length));
    const pathEM   = track(new oc.BRepBuilderAPI_MakeEdge_3(pathP0, pathP1));
    const pathEdge = track(pathEM.Edge());
    const pathWM   = track(new oc.BRepBuilderAPI_MakeWire_1());
    pathWM.Add_1(pathEdge);
    const pathWire = track(pathWM.Wire());

    // Step 3: MakePipe_1(spineWire, profileFace)
    const pipe  = track(new oc.BRepOffsetAPI_MakePipe_1(pathWire, profileFace));
    const shape = pipe.Shape();

    const meta = { op: 'sweep', params: { r, length } };
    return bindSurfacingResult(oc, 'sweep', [profileBody], pipe, shape, meta, { bodyTag });
  });
}

export async function sweep(r, length) {
  if (!(r > 0 && length > 0)) throw new Error(`sweep: r and length must be positive (got ${r}, ${length})`);
  const spineBody = await _constructSweep(r, length);
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  if (persistentBodyId) {
    try {
      recordBodyCreate({
        opName: 'sweep',
        persistentBodyId,
        meta: { op: 'sweep', params: { r, length } },
        rebuild: () => _constructSweep(r, length, persistentBodyId),
        register: standardSceneRegister,
        remove: standardSceneRemove,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('sweep: history recordBodyCreate failed —', err && err.message || err);
    }
  }
  return spineBody;
}

/**
 * Loft a solid through two square section wires: side `bottomSize` at z=0
 * and side `topSize` at z=`height`.
 *
 * SP-1 S4c — returns a SpineBody. Each section wire is spined into a
 * temporary sheet body (the wire is wrapped in a planar face for spining,
 * giving its edges + vertices persistent ids); the loft's `Modified` /
 * `Generated` history then carries those ids onto the cap + lateral faces
 * of the resulting solid.
 *
 * @param {number} bottomSize  bottom square side (mm)
 * @param {number} topSize     top square side (mm)
 * @param {number} height      (mm)
 * @returns {Promise<SpineBody>}
 */
async function _constructLoft(bottomSize, topSize, height, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    // verified sequence from kernel-api-A2.md item 6

    // Step 1: Build section wires (A1 verified chain: gp_Pnt_3 → MakeEdge_3 → MakeWire_1 + Add_1)
    // Helper: build a closed square wire of given side at height z
    function makeSquareWire(side, z) {
      const p0 = track(new oc.gp_Pnt_3(0,    0,    z));
      const p1 = track(new oc.gp_Pnt_3(side, 0,    z));
      const p2 = track(new oc.gp_Pnt_3(side, side, z));
      const p3 = track(new oc.gp_Pnt_3(0,    side, z));
      const em01 = track(new oc.BRepBuilderAPI_MakeEdge_3(p0, p1)); const e01 = track(em01.Edge());
      const em12 = track(new oc.BRepBuilderAPI_MakeEdge_3(p1, p2)); const e12 = track(em12.Edge());
      const em23 = track(new oc.BRepBuilderAPI_MakeEdge_3(p2, p3)); const e23 = track(em23.Edge());
      const em30 = track(new oc.BRepBuilderAPI_MakeEdge_3(p3, p0)); const e30 = track(em30.Edge());
      const wm = track(new oc.BRepBuilderAPI_MakeWire_1());
      wm.Add_1(e01); wm.Add_1(e12); wm.Add_1(e23); wm.Add_1(e30);
      return track(wm.Wire());
    }

    /**
     * Wrap a planar closed wire in a face so it can be spined (the bindSpine
     * adapter wants a face/shell/solid root, not a bare wire — wire-only spines
     * are sheet-bodies but in this build a wire alone produces no face for
     * lineage). We just take the face of the wire and use that as the sheet
     * for spining.
     */
    function spineSectionWire(wire, tag) {
      const fm = track(new oc.BRepBuilderAPI_MakeFace_15(wire, true));
      if (!fm.IsDone()) return null;
      const sectionFace = track(fm.Face());
      try {
        return bindSpine(oc, sectionFace, {
          bodyTag: tag, validate: false,
        });
      } catch (_e) {
        // bindSpine throws on degenerate shapes — surfacing always returns a
        // valid loft regardless, so a degenerate section body just means no
        // lineage edge from that section (honest documented degrade).
        return null;
      }
    }

    const wire0 = makeSquareWire(bottomSize, 0);
    const wire1 = makeSquareWire(topSize, height);

    const sectionBody0 = spineSectionWire(wire0, 'loftSection0');
    const sectionBody1 = spineSectionWire(wire1, 'loftSection1');

    // Step 2: ThruSections (undecorated, NOT _1/_2)
    // Constructor: (isSolid: bool, isRuled: bool, pres3d: Real)
    // isSolid = true → closed solid; isRuled = false → smooth loft
    const loftOp = track(new oc.BRepOffsetAPI_ThruSections(true, false, 1.0e-6));

    // Step 3: AddWire (undecorated) — add each section wire
    loftOp.AddWire(wire0);
    loftOp.AddWire(wire1);

    // Step 4: Build
    const prBuild = track(new oc.Message_ProgressRange_1());
    loftOp.Build(prBuild);

    if (!loftOp.IsDone()) throw new Error('loft: BRepOffsetAPI_ThruSections did not complete');
    const shape = loftOp.Shape();

    const meta = { op: 'loft', params: { bottomSize, topSize, height } };
    return bindSurfacingResult(
      oc, 'loft', [sectionBody0, sectionBody1], loftOp, shape, meta, { bodyTag });
  });
}

export async function loft(bottomSize, topSize, height) {
  if (!(bottomSize > 0 && topSize > 0 && height > 0)) {
    throw new Error(`loft: all params must be positive (got ${bottomSize}, ${topSize}, ${height})`);
  }
  const spineBody = await _constructLoft(bottomSize, topSize, height);
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  if (persistentBodyId) {
    try {
      recordBodyCreate({
        opName: 'loft',
        persistentBodyId,
        meta: { op: 'loft', params: { bottomSize, topSize, height } },
        rebuild: () => _constructLoft(bottomSize, topSize, height, persistentBodyId),
        register: standardSceneRegister,
        remove: standardSceneRemove,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('loft: history recordBodyCreate failed —', err && err.message || err);
    }
  }
  return spineBody;
}
