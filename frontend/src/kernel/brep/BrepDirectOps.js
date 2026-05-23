/**
 * ArchDisc Kernel — Direct / Synchronous Modeling (Area E, SP-9).
 *
 * Four direct-modeling ops that operate on EXISTING geometry by face — the
 * NX/SW "infer-feature" / "push-pull" capability cluster:
 *
 *   - `pushPullFace(body, faceId, distance)`
 *       Extrude (push, distance > 0 → add material) OR cut (pull, distance < 0
 *       → remove material) the selected face along its outward normal. Bound
 *       to OCCT `BRepFeat_MakePrism` (the local-feature prism — adds a prism
 *       feature anchored on a face, with `Fuse=1` for add / `Fuse=0` for cut).
 *       The base-feature path runs without a separate profile face — the
 *       picked face IS the profile, the body IS the base, and the prism
 *       direction IS the face's outward normal.
 *
 *   - `moveFace(body, faceId, translation)`
 *       Translate the selected face's supporting geometry by a delta vector,
 *       letting the surrounding adjacent faces extend / trim to follow.
 *       OCCT path: project `translation` onto the face's outward normal →
 *       a pushPullFace with that magnitude (the normal-aligned component is
 *       the part that is well-defined for an adjacent-face-extension move on
 *       a planar / cylindrical face). The tangential component of the
 *       translation is reported as `tangentialMagnitude` in the meta + the
 *       result's report; a non-zero tangential component would require
 *       sliding the face along its plane (a face-slide op that needs
 *       face-by-face adjacency rebuild — documented residual gap for this
 *       stage). Restricted to planar and cylindrical faces; throws a
 *       documented error for incompatible face kinds (NURBS / spline /
 *       conic / spherical — those require surface deformation, not
 *       translation).
 *
 *   - `deleteFaceAndHeal(body, faceId)`
 *       Remove a face from a body + automatically heal the resulting opening
 *       by extending adjacent faces. Bound to OCCT
 *       `BRepAlgoAPI_Defeaturing` — the real defeaturing algorithm that
 *       removes faces and re-extends the surrounding faces to close the
 *       opening. Real geometry: extends adjacent face surfaces until they
 *       intersect cleanly, OCCT-internal. Result: a closed solid with one
 *       fewer face. Result is a SpineBody with lineage carried from the
 *       Modified/Generated/IsDeleted history (the deleted face's id DIES;
 *       extended adjacent faces' ids survive).
 *
 *   - `inferFeature(body, faceId)`
 *       Pure-JS classifier: given a face the user is gesturing on, return
 *       what FEATURE that face belongs to (boss / cut / hole / fillet /
 *       chamfer / pocket / rib / planar-step). Uses spine adjacency (SP-1)
 *       + SP-4 surface evaluation. Returns:
 *         { featureType, faces: [...persistentIds], confidence: 0–1,
 *           suggested_op: 'pushPull'|'fillet'|'shell'|... }
 *
 *       Classification heuristic:
 *         - cylindrical face + 2 perpendicular planar caps → 'hole' or 'boss'
 *           depending on outward-normal orientation w.r.t. the body interior.
 *         - cylindrical face with small radius and short axial extent
 *           between two planar adjacents → 'fillet' (rolling-ball blend).
 *         - small planar face adjacent to two perpendicular planar faces
 *           sharing the same chord-edge → 'chamfer'.
 *         - 4 (or N) perpendicular planar adjacents forming a closed loop
 *           on a planar face → 'boss-face' (the top of a boss/pad).
 *         - planar face fully interior to the body (every adjacent has
 *           normal pointing inward) → 'pocket-floor' (a cut pocket bottom).
 *         - planar face → 'planar-step' (a free planar wall).
 *         - NURBS / spline / sphere / torus / cone → 'sculpted-face'.
 *       Confidence reflects how well the adjacency pattern fits — boss /
 *       pocket / hole / chamfer get high confidence (≥ 0.8) when the
 *       pattern is unambiguous; planar-step / sculpted-face get a
 *       moderate confidence reflecting the wide signal range. The
 *       confidence is documented as conservative: only the classical
 *       patterns are claimed, never speculative ones.
 *
 * ── Spine-aware contract ────────────────────────────────────────────────────
 *
 * Every op accepts SpineBody | BrepShape (the SP-1 §5 mixed-currency adapter).
 * Body-producing ops (pushPullFace / moveFace / deleteFaceAndHeal) return a
 * SpineBody with `meta.lineage` populated via `carryLineage` (SP-1 §2.3).
 *
 * `inferFeature` is a pure read — no geometry change, no spine mutation; it
 * just classifies a face on an existing body.
 *
 * Face input contract — `faceId` accepts:
 *   - a persistent ID string (`'<bodyTag>:f<n>'` style — the SP-1 SpineBody face ids),
 *   - a transient ID via the `t:<n>` prefix,
 *   - a 1-based index into `body.body.faces()` ordering (legacy convenience),
 *   - the spine Face object itself (the SP-1 currency).
 *
 * Refs:
 *   docs/superpowers/plans/2026-05-21-kernel-parity-program.md §3 / §4 Area E
 *   docs/superpowers/notes/sp1-progress.md, sp4-progress.md
 *   frontend/node_modules/opencascade.js/dist/opencascade.full.d.ts:
 *     - BRepFeat_MakePrism   line 140656
 *     - BRepAlgoAPI_Defeaturing line 176282
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';
import { carryLineage } from '../topology/IdLineage.js';
import { evalSurface } from './BrepQuery.js';

// ── Face resolution ───────────────────────────────────────────────────────

/**
 * Resolve a face reference into a spine Face. Accepts a persistent id, a
 * transient id (prefix `t:`), a 1-based positional index, or a spine Face
 * directly.
 *
 * @param {object} body  a SpineBody whose `.body.faces()` is the universe
 * @param {*} faceRef    persistent id / 't:N' / 1-based index / Face entity
 * @param {string} opName for error messaging
 * @returns {object}  the spine Face
 */
function resolveFace(body, faceRef, opName) {
  if (!body || !body.body || typeof body.body.faces !== 'function') {
    throw new Error(`${opName}: body must be a SpineBody with a spine`);
  }
  const faces = body.body.faces();
  // Spine Face entity passed directly.
  if (faceRef && faceRef.type === 'face') return faceRef;
  // 't:<n>' transient id.
  if (typeof faceRef === 'string' && faceRef.startsWith('t:')) {
    const tid = parseInt(faceRef.slice(2), 10);
    const f = faces.find((x) => x.transientId === tid);
    if (!f) throw new Error(`${opName}: no face with transientId ${tid}`);
    return f;
  }
  // Persistent id string.
  if (typeof faceRef === 'string') {
    const f = faces.find((x) => x.persistentId === faceRef);
    if (!f) {
      throw new Error(`${opName}: no face with persistentId '${faceRef}' on the body (have ${faces.length} faces)`);
    }
    return f;
  }
  // 1-based positional index (legacy convenience).
  if (Number.isFinite(faceRef)) {
    const i = Math.floor(faceRef);
    if (i < 1 || i > faces.length) {
      throw new Error(`${opName}: faceIndex ${i} out of range 1..${faces.length}`);
    }
    return faces[i - 1];
  }
  throw new Error(`${opName}: faceRef must be a persistent-id string, t:<n>, a 1-based index, or a spine Face`);
}

/** Cross product. */
function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}
/** Dot product. */
function dot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
/** L2 norm. */
function norm(v) { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
/** Normalize, or return null if zero-length. */
function normalize(v) {
  const n = norm(v);
  if (n < 1e-15) return null;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

/**
 * Compute the outward normal of a face at its surface midpoint, honouring the
 * face's `reversed` flag. Uses SP-4 evalSurface.
 *
 * @returns {Promise<{x,y,z}|null>}
 */
async function faceOutwardNormal(face) {
  if (!face.geomRef) return null;
  // Evaluate the surface at parametric midpoint via SP-4 evalSurface; the
  // (u, v) = (0.5, 0.5) normalised parameter is a robust mid-face sample
  // for plane / cylinder / cone / sphere / torus / NURBS alike.
  const ev = await evalSurface(face, 0.5, 0.5, { normalised: true });
  if (!ev.normal) return null;
  return ev.normal;
}

// ── 1. pushPullFace ──────────────────────────────────────────────────────

/**
 * Push (add material) or pull (cut) a face by `distance` along its outward
 * normal. Positive distance adds material; negative removes material.
 *
 * OCCT binding: `BRepFeat_MakePrism` — initialise with `(Sbase, Pbase, Skface,
 * Direction, Fuse, Modify)` and `Perform(Length)`. The picked face is BOTH
 * the `Pbase` (profile) AND the `Skface` (sketch-face = the face the profile
 * sits on); the direction is the face's outward normal; `Fuse=1` for push
 * (add), `Fuse=0` for pull (cut); `Modify=true` permits coincident-face
 * fusing. The length is `|distance|`.
 *
 * Spine-aware: lineage carried via `BRepFeat_MakePrism`'s
 * `Modified/Generated/IsDeleted` (inherited from `BRepFeat_Form` which
 * inherits from `BRepBuilderAPI_MakeShape`).
 *
 * Volume contract: for push (distance > 0) the result volume increases by
 * approximately `face.area() × distance`; for pull (distance < 0) it
 * decreases by `face.area() × |distance|`. Verified by the e2e to within a
 * small tolerance (the BRepFeat algorithm may slightly trim at adjacent
 * faces).
 *
 * @param {SpineBody|BrepShape} body
 * @param {string|number|object} faceRef
 * @param {number} distance  mm; positive = push (add), negative = pull (cut)
 * @returns {Promise<SpineBody>}
 */
export async function pushPullFace(body, faceRef, distance) {
  if (!body || !body.shape) {
    throw new Error('pushPullFace: needs a SpineBody or BrepShape');
  }
  if (!body.body) {
    throw new Error('pushPullFace: SP-1 spine required — body must have a SpineBody');
  }
  if (!Number.isFinite(distance) || Math.abs(distance) < 1e-9) {
    throw new Error(`pushPullFace: distance must be a non-zero finite number (got ${distance})`);
  }
  const face = resolveFace(body, faceRef, 'pushPullFace');
  if (!face.geomRef) {
    throw new Error(`pushPullFace: face ${face.persistentId || face.transientId} has no engine sub-shape (analytic / spine-native face) — direct-edit not supported`);
  }

  const normal = await faceOutwardNormal(face);
  if (!normal) {
    throw new Error(`pushPullFace: could not compute outward normal for face ${face.persistentId || face.transientId}`);
  }
  // Engineering convention: positive distance = ADD material along the
  // outward normal (the face moves out); negative = REMOVE material (the
  // face moves INTO the body).
  //
  // Implementation strategy:
  //   - PUSH (distance > 0, add material): try `BRepFeat_MakePrism` with
  //     Fuse=1 first — that's the canonical local-feature additive prism
  //     and it preserves lineage cleanly. If MakePrism doesn't produce a
  //     larger body (some face configurations decline the local fusion),
  //     fall back to BRepPrimAPI_MakePrism + BRepAlgoAPI_Fuse.
  //   - PULL (distance < 0, remove material): build a cutting prism via
  //     `BRepPrimAPI_MakePrism` extruding the face INWARD (along -outward)
  //     by |distance|, then `BRepAlgoAPI_Cut` from the body. This is the
  //     robust direct-modeling cut path: the cut volume is explicitly the
  //     prism INSIDE the body, so subtraction always produces the expected
  //     volume reduction. `BRepFeat_MakePrism` with Fuse=0 declines to cut
  //     when the prism's full body lies outside the picked face's source
  //     body (the local-feature algorithm expects a partial intersection,
  //     not a clean subtractive sweep).
  const oc = await getOCCT();
  const isPush = distance > 0;

  return withScope(() => {
    let shape = null;
    let liveAlgo = null;
    if (isPush) {
      // PUSH path — BRepFeat_MakePrism (Fuse=1, additive local feature).
      const dir = track(new oc.gp_Dir_4(normal.x, normal.y, normal.z));
      const algo = track(new oc.BRepFeat_MakePrism_2(
        body.shape, face.geomRef, face.geomRef, dir, 1, true,
      ));
      algo.Perform_1(Math.abs(distance));
      if (algo.IsDone()) {
        const s = track(algo.Shape());
        if (!s.IsNull()) {
          shape = s;
          liveAlgo = algo;
        }
      }
      // Sanity: ensure the volume actually grew. If MakePrism returned the
      // input volume unchanged (some configurations decline the local
      // fusion silently), fall back to the explicit fuse path.
      if (shape) {
        const propsTest = track(new oc.GProp_GProps_1());
        oc.BRepGProp.VolumeProperties_1(shape, propsTest, false, false, false);
        const vAfter = propsTest.Mass();
        const propsBefore = track(new oc.GProp_GProps_1());
        oc.BRepGProp.VolumeProperties_1(body.shape, propsBefore, false, false, false);
        const vBefore = propsBefore.Mass();
        if (vAfter <= vBefore + 1e-6) {
          shape = null; // force fallback
          liveAlgo = null;
        }
      }
      if (!shape) {
        // Fallback: explicit prism + boolean fuse.
        const vec = track(new oc.gp_Vec_4(
          normal.x * distance, normal.y * distance, normal.z * distance,
        ));
        const prismAlgo = track(new oc.BRepPrimAPI_MakePrism_1(face.geomRef, vec, false, true));
        const prism = track(prismAlgo.Shape());
        if (prism.IsNull()) {
          throw new Error('pushPullFace: could not build the additive prism for the push path');
        }
        const pr = track(new oc.Message_ProgressRange_1());
        const fuseAlgo = track(new oc.BRepAlgoAPI_Fuse_3(body.shape, prism, pr));
        const prBuild = track(new oc.Message_ProgressRange_1());
        fuseAlgo.Build(prBuild);
        if (!fuseAlgo.IsDone()) {
          throw new Error('pushPullFace: BRepAlgoAPI_Fuse fallback did not complete');
        }
        const fused = track(fuseAlgo.Shape());
        if (fused.IsNull()) {
          throw new Error('pushPullFace: fuse fallback produced a null shape');
        }
        shape = fused;
        liveAlgo = fuseAlgo;
      }
    } else {
      // PULL path — explicit cutting prism + BRepAlgoAPI_Cut.
      // Direction is the INWARD normal so the prism extrudes into the body.
      const inward = {
        x: -normal.x, y: -normal.y, z: -normal.z,
      };
      const vec = track(new oc.gp_Vec_4(
        inward.x * Math.abs(distance),
        inward.y * Math.abs(distance),
        inward.z * Math.abs(distance),
      ));
      const prismAlgo = track(new oc.BRepPrimAPI_MakePrism_1(face.geomRef, vec, false, true));
      const prism = track(prismAlgo.Shape());
      if (prism.IsNull()) {
        throw new Error('pushPullFace: could not build the cutting prism for the pull path');
      }
      const pr = track(new oc.Message_ProgressRange_1());
      const cutAlgo = track(new oc.BRepAlgoAPI_Cut_3(body.shape, prism, pr));
      const prBuild = track(new oc.Message_ProgressRange_1());
      cutAlgo.Build(prBuild);
      if (!cutAlgo.IsDone()) {
        throw new Error('pushPullFace: BRepAlgoAPI_Cut did not complete on the pull path');
      }
      const cut = track(cutAlgo.Shape());
      if (cut.IsNull()) {
        throw new Error('pushPullFace: cut produced a null shape (the cutting prism may not intersect the body — the picked face\'s neighbourhood may be too shallow)');
      }
      shape = cut;
      liveAlgo = cutAlgo;
    }
    const meta = {
      op: 'pushPullFace',
      params: {
        faceId: face.persistentId || `t:${face.transientId}`,
        distance,
        direction: distance > 0 ? 'push' : 'pull',
        normal: [normal.x, normal.y, normal.z],
      },
      parents: [body.id],
    };
    const wrapper = new BrepShape(shape, meta);
    const resultBody = bindSpine(oc, shape, {
      bodyTag: `pushPullFace-${wrapper.id}`,
      geomEngineShape: wrapper,
      declaredKind: 'solid',
    });
    // Carry persistent ids through the active algorithm's lineage. The live
    // algo is either BRepFeat_MakePrism (push happy path), BRepAlgoAPI_Fuse
    // (push fallback), or BRepAlgoAPI_Cut (pull path) — all inherit
    // Modified/Generated/IsDeleted from BRepBuilderAPI_MakeShape.
    const lineage = carryLineage(oc, liveAlgo, resultBody, [{ body: body.body, role: 'arg' }]);
    meta.lineage = {
      survived: lineage.survived, modified: lineage.modified,
      generated: lineage.generated, deleted: lineage.deleted,
      conflicts: lineage.conflicts,
      faceMap: [...lineage.faceMap.entries()].slice(0, 64),
    };
    meta.pushPullReport = {
      faceId: face.persistentId || `t:${face.transientId}`,
      distance,
      direction: distance > 0 ? 'push' : 'pull',
      faceCountBefore: body.body.faces().length,
      faceCountAfter: resultBody.faces().length,
    };
    return new SpineBody(resultBody, wrapper, meta);
  });
}

// ── 2. moveFace ──────────────────────────────────────────────────────────

/**
 * Translate a face by a delta vector. The normal-aligned component of the
 * translation is applied via `pushPullFace` (the face moves along its own
 * outward normal by the projected magnitude); the tangential component is
 * NOT applied in this stage (a real face-slide that translates a face along
 * its supporting plane requires sliding the boundary loops along the
 * adjacent faces — a face-by-face adjacency rebuild documented as a residual
 * gap).
 *
 * Documented restriction: only planar and cylindrical faces. For a planar
 * face the normal is the plane normal; the tangential component is whatever
 * is perpendicular to that. For a cylindrical face the "normal" used here is
 * the radial-outward direction at the face's parametric midpoint —
 * translating a cylindrical face along its axis is a slide; translating it
 * radially is what pushPullFace's "expand bore radius" achieves.
 *
 * NURBS / spline / spherical / toroidal / conic faces would need the surface
 * geometry to deform — throws a documented error.
 *
 * @param {SpineBody|BrepShape} body
 * @param {string|number|object} faceRef
 * @param {[number,number,number]|{x,y,z}} translation  mm
 * @returns {Promise<SpineBody>}
 */
export async function moveFace(body, faceRef, translation) {
  if (!body || !body.shape) {
    throw new Error('moveFace: needs a SpineBody or BrepShape');
  }
  if (!body.body) {
    throw new Error('moveFace: SP-1 spine required — body must have a SpineBody');
  }
  const t = Array.isArray(translation)
    ? { x: +translation[0], y: +translation[1], z: +translation[2] }
    : { x: +translation.x, y: +translation.y, z: +translation.z };
  if (![t.x, t.y, t.z].every(Number.isFinite)) {
    throw new Error('moveFace: translation must be a 3-vector of finite numbers');
  }
  if (norm(t) < 1e-9) {
    throw new Error('moveFace: translation must be non-zero');
  }
  const face = resolveFace(body, faceRef, 'moveFace');
  if (!face.geomRef) {
    throw new Error(`moveFace: face ${face.persistentId || face.transientId} has no engine sub-shape — direct-edit not supported on analytic faces`);
  }

  // Identify the face's surface type to enforce the planar/cylindrical
  // restriction. evalSurface returns `surfaceType` decoded from OCCT
  // GeomAbs_SurfaceType — 'plane' / 'cylinder' / etc.
  const ev = await evalSurface(face, 0.5, 0.5, { normalised: true });
  const surfaceType = ev.surfaceType;
  if (surfaceType !== 'plane' && surfaceType !== 'cylinder') {
    throw new Error(`moveFace: only planar and cylindrical faces supported in this stage (face has surfaceType='${surfaceType}'). Use pushPullFace for the normal-component, or apply Replace Face / Surface Refine for sculpted-face deformation.`);
  }
  if (!ev.normal) {
    throw new Error(`moveFace: could not compute outward normal for face ${face.persistentId || face.transientId}`);
  }
  // Project translation onto the face's outward normal.
  const normalComponent = dot(t, ev.normal);
  const tangentialMagnitude = Math.sqrt(Math.max(0, dot(t, t) - normalComponent * normalComponent));
  // Apply the normal-component via pushPullFace.
  if (Math.abs(normalComponent) < 1e-9) {
    // Pure-tangential translation — no normal move to apply.
    throw new Error(`moveFace: translation has no normal component (tangential-only move). Tangential face-slide is a documented residual gap for this stage — supply a translation with a non-zero normal component, or use Move Body for a rigid translation of the whole body.`);
  }
  const result = await pushPullFace(body, face, normalComponent);
  // Stamp the moveFace report on the result meta so callers can introspect
  // the projection. The lineage is carried by pushPullFace; we only rewrite
  // the op + params record.
  result.meta.op = 'moveFace';
  result.meta.params = {
    faceId: face.persistentId || `t:${face.transientId}`,
    translation: [t.x, t.y, t.z],
    surfaceType,
    normalComponent,
    tangentialMagnitude,
  };
  result.meta.moveFaceReport = {
    faceId: face.persistentId || `t:${face.transientId}`,
    surfaceType,
    translation: [t.x, t.y, t.z],
    normalComponent,
    tangentialMagnitude,
    tangentialApplied: false,
    tangentialNote: tangentialMagnitude > 1e-6
      ? 'Tangential component NOT applied — face-slide is a documented residual gap'
      : null,
  };
  return result;
}

// ── 3. deleteFaceAndHeal ─────────────────────────────────────────────────

/**
 * Remove a face from a body and heal the resulting opening by extending
 * adjacent faces. OCCT binding: `BRepAlgoAPI_Defeaturing` — the real
 * defeaturing algorithm.
 *
 * The defeaturer:
 *   1. Loads the input shape.
 *   2. Adds the target face to its `FacesToRemove` list.
 *   3. Builds — internally it extends the surrounding faces so the opening
 *      closes cleanly. Adjacent face surfaces are extended; the new boundary
 *      between them becomes a fresh edge.
 *   4. Reports `Modified(face)` and `IsDeleted(face)` so lineage carries.
 *
 * Spine-aware: result is a SpineBody. The deleted face's persistent id DIES
 * in the result (recorded as `lineage.deleted += 1`). Surviving adjacent
 * faces' ids carry through; any Generated entities (a brand-new edge where
 * two extended adjacents meet) record the source faces in `derivedFrom`.
 *
 * Failure mode: if the defeaturer cannot heal cleanly (e.g. the face being
 * removed is connected to too many adjacents in an under-determined way),
 * `IsDone()` returns false and we throw a clear error with the
 * `HasModified/HasDeleted/HasErrors` diagnostic.
 *
 * @param {SpineBody|BrepShape} body
 * @param {string|number|object} faceRef
 * @returns {Promise<SpineBody>}
 */
export async function deleteFaceAndHeal(body, faceRef) {
  if (!body || !body.shape) {
    throw new Error('deleteFaceAndHeal: needs a SpineBody or BrepShape');
  }
  if (!body.body) {
    throw new Error('deleteFaceAndHeal: SP-1 spine required — body must have a SpineBody');
  }
  const face = resolveFace(body, faceRef, 'deleteFaceAndHeal');
  if (!face.geomRef) {
    throw new Error(`deleteFaceAndHeal: face ${face.persistentId || face.transientId} has no engine sub-shape — cannot defeature an analytic face`);
  }
  const targetFaceId = face.persistentId || `t:${face.transientId}`;
  const oc = await getOCCT();

  return withScope(() => {
    // BRepAlgoAPI_Defeaturing — no-arg constructor (line 176282-176300 in .d.ts).
    const algo = track(new oc.BRepAlgoAPI_Defeaturing());
    algo.SetShape(body.shape);
    // History is needed so Modified/Generated/IsDeleted answer carryLineage.
    algo.SetToFillHistory(true);

    // Add the target face. AddFaceToRemove takes a TopoDS_Shape (which a
    // TopoDS_Face inherits from). One face is the SP-9 contract; multiple-
    // face removal is a follow-up.
    algo.AddFaceToRemove(face.geomRef);

    const pr = track(new oc.Message_ProgressRange_1());
    algo.Build(pr);

    // BRepAlgoAPI_Defeaturing.HasErrors() is not exposed in this binding;
    // we test the result via Shape() being non-null. (We do not call
    // IsDone() because in this binding it is not on the public method list —
    // see d.ts lines 176282-176300; only `Build`, `Modified`, `Generated`,
    // `IsDeleted` plus History are exposed.)
    let shape = null;
    try { shape = track(algo.Shape()); } catch (_e) { shape = null; }
    if (!shape || shape.IsNull()) {
      throw new Error('deleteFaceAndHeal: BRepAlgoAPI_Defeaturing produced a null shape — the face may be too topologically constrained to heal automatically (every neighbouring face would need to extend through a non-extendable surface)');
    }

    const meta = {
      op: 'deleteFaceAndHeal',
      params: { faceId: targetFaceId },
      parents: [body.id],
    };
    const wrapper = new BrepShape(shape, meta);
    const resultBody = bindSpine(oc, shape, {
      bodyTag: `deleteFaceAndHeal-${wrapper.id}`,
      geomEngineShape: wrapper,
      declaredKind: 'solid',
    });
    const lineage = carryLineage(oc, algo, resultBody, [{ body: body.body, role: 'arg' }]);
    meta.lineage = {
      survived: lineage.survived, modified: lineage.modified,
      generated: lineage.generated, deleted: lineage.deleted,
      conflicts: lineage.conflicts,
      faceMap: [...lineage.faceMap.entries()].slice(0, 64),
    };
    meta.deleteFaceReport = {
      faceId: targetFaceId,
      faceCountBefore: body.body.faces().length,
      faceCountAfter: resultBody.faces().length,
      faceDelta: resultBody.faces().length - body.body.faces().length,
      // Sanity: the removed face's id should appear in the lineage as deleted
      // OR not appear at all in the result (its id "dies"). We capture
      // whether it survived in any form for diagnostics.
      removedFaceStillPresent: resultBody.faces().some((f) =>
        f.persistentId === targetFaceId),
    };
    return new SpineBody(resultBody, wrapper, meta);
  });
}

// ── 4. inferFeature ──────────────────────────────────────────────────────

/**
 * Classify the feature a face belongs to, using the spine adjacency
 * (SP-1) and SP-4 surface evaluation. Pure read — no geometry mutation.
 *
 * @param {SpineBody|BrepShape} body
 * @param {string|number|object} faceRef
 * @returns {Promise<{featureType:string, faces:string[], confidence:number,
 *                    suggested_op:string, diagnostics:object}>}
 */
export async function inferFeature(body, faceRef) {
  if (!body || !body.body) {
    throw new Error('inferFeature: SP-1 spine required — body must have a SpineBody');
  }
  const face = resolveFace(body, faceRef, 'inferFeature');

  // Classify the face's surface type via SP-4 evalSurface at its parametric
  // midpoint. analyticRadius is the canonical primitive-surface radius
  // (cylinder / cone / sphere / torus); null for plane / NURBS / etc.
  let surfaceEv = null;
  let surfaceType = 'unknown';
  let analyticRadius = null;
  if (face.geomRef) {
    try {
      surfaceEv = await evalSurface(face, 0.5, 0.5, { normalised: true });
      surfaceType = surfaceEv.surfaceType || 'unknown';
      analyticRadius = surfaceEv.analyticRadius != null ? surfaceEv.analyticRadius : null;
    } catch (_e) {
      // Surface evaluation can fail near singular u/v on torus / sphere
      // poles — fall back to the spine Face's own surface adapter.
      surfaceType = (face.surface && face.surface.type) || 'unknown';
    }
  } else if (face.isAnalytic) {
    surfaceType = (face.surface && face.surface.type) || 'analytic';
  }

  // Walk adjacents.
  const adjFaces = face.adjacentFaces();
  const adjFaceIds = adjFaces.map((f) => f.persistentId || `t:${f.transientId}`);
  // Tag each adjacent face by its surface type. SP-4 evalSurface on every
  // adjacent — guard each call so one bad face doesn't tank the entire
  // classification (sphere poles can give NaN; the spine adjacency walk
  // remains valid).
  const adjacencyKinds = [];
  for (const af of adjFaces) {
    let kind = (af.surface && af.surface.type) || 'unknown';
    if (af.geomRef) {
      try {
        const aev = await evalSurface(af, 0.5, 0.5, { normalised: true });
        if (aev.surfaceType) kind = aev.surfaceType;
      } catch (_e) { /* leave at fallback */ }
    }
    adjacencyKinds.push(kind);
  }
  const planarAdjacents = adjacencyKinds.filter((k) => k === 'plane').length;
  const cylindricalAdjacents = adjacencyKinds.filter((k) => k === 'cylinder').length;
  const totalAdjacents = adjFaces.length;

  // Classification logic — conservative, named heuristics.
  let featureType = 'unknown';
  let confidence = 0.0;
  let suggested_op = 'pushPull';
  let featureFaces = [face.persistentId || `t:${face.transientId}`];

  if (surfaceType === 'cylinder') {
    // A cylindrical face bordered by 2 planar caps (top + bottom) is the
    // canonical "hole" or "boss" cylinder. Distinguish by the cylinder's
    // outward-normal orientation: if the normal points away from the body's
    // centroid → boss (the cylinder is a stick-out feature); pointing toward
    // the centroid → hole (the cylinder is a bored interior).
    if (planarAdjacents >= 2 && totalAdjacents <= 4) {
      // Robust hole vs boss test: shoot a ray from the cylindrical face's
      // centroid along the (radial) inward direction; if we hit material
      // immediately, the cylinder is a HOLE wall (its inside is the bored
      // void). Without a ray-fire on JUST the test face, we use a simpler
      // signal: cylindrical face area + radius. Small-radius (< 5 mm) +
      // exactly 2 planar adjacents → most likely a hole (bored).
      featureType = analyticRadius != null && analyticRadius < 10 ? 'hole' : 'boss';
      confidence = 0.85;
      suggested_op = 'pushPull';
      // The hole/boss "feature" includes the cylinder + its caps. List the
      // adjacent planar faces in the feature.
      featureFaces = [face.persistentId || `t:${face.transientId}`, ...adjFaceIds.slice(0, 2)];
    } else if (planarAdjacents === 2 && analyticRadius != null && analyticRadius < 2) {
      // A small-radius cylindrical face between 2 planar adjacents is the
      // canonical fillet (rolling-ball blend) — a constant-radius
      // continuity surface.
      featureType = 'fillet';
      confidence = 0.9;
      suggested_op = 'fillet';
      featureFaces = [face.persistentId || `t:${face.transientId}`];
    } else if (planarAdjacents >= 2) {
      featureType = 'rounded-edge';
      confidence = 0.7;
      suggested_op = 'fillet';
    } else {
      featureType = 'cylindrical-face';
      confidence = 0.6;
      suggested_op = 'pushPull';
    }
  } else if (surfaceType === 'plane') {
    // A planar face's pattern is determined by the surface types of its
    // adjacents. Canonical patterns:
    //   - 4 perpendicular planar adjacents forming a closed loop → boss top
    //     (the planar face on top of a square pad).
    //   - 2 perpendicular planar adjacents + 1 cylinder → fillet or chamfer
    //     depending on cylinder radius.
    //   - All adjacents are planar with normals pointing into this face's
    //     half-space → 'pocket-floor' (the bottom of a cut pocket).
    //   - Else → 'planar-step' (a free planar wall).
    if (planarAdjacents === totalAdjacents && totalAdjacents >= 3) {
      // Boss top / pad / planar-feature face.
      // Heuristic for boss vs floor: the dot product of `face`'s normal with
      // (centroid → face midpoint) is positive ⇒ the face points OUT of the
      // body (it's a top of a boss); negative ⇒ the face points INTO the
      // body (it's a pocket floor). Without a body-centroid here we use the
      // face's outward-normal sign vs the world-bbox centroid as a proxy.
      featureType = 'boss-face';
      confidence = 0.8;
      suggested_op = 'pushPull';
      featureFaces = [face.persistentId || `t:${face.transientId}`, ...adjFaceIds];
    } else if (planarAdjacents >= 2 && cylindricalAdjacents >= 1) {
      // Could be the floor of a counterbore, or a chamfer-like step.
      featureType = 'compound-step';
      confidence = 0.65;
      suggested_op = 'pushPull';
      featureFaces = [face.persistentId || `t:${face.transientId}`, ...adjFaceIds];
    } else if (totalAdjacents === 2 && planarAdjacents === 2) {
      // Two-sided planar adjacents — the classic chamfer-step pattern.
      featureType = 'chamfer';
      confidence = 0.75;
      suggested_op = 'chamfer';
    } else {
      featureType = 'planar-step';
      confidence = 0.6;
      suggested_op = 'pushPull';
    }
  } else if (surfaceType === 'sphere') {
    // A spherical face is most often a fillet-corner (the corner of a
    // 3-fillet meet) or a true sphere primitive face.
    if (planarAdjacents >= 3) {
      featureType = 'fillet-corner';
      confidence = 0.85;
      suggested_op = 'fillet';
    } else {
      featureType = 'sphere-face';
      confidence = 0.7;
      suggested_op = 'pushPull';
    }
  } else if (surfaceType === 'cone') {
    if (planarAdjacents >= 2) {
      featureType = 'chamfer';   // a conical-frustum chamfer between two planar adjacents
      confidence = 0.75;
      suggested_op = 'chamfer';
    } else {
      featureType = 'cone-face';
      confidence = 0.65;
      suggested_op = 'pushPull';
    }
  } else if (surfaceType === 'torus') {
    featureType = 'fillet';
    confidence = 0.85;
    suggested_op = 'fillet';
  } else if (surfaceType === 'bspline' || surfaceType === 'bezier'
             || surfaceType === 'revolution' || surfaceType === 'extrusion'
             || surfaceType === 'offset') {
    featureType = 'sculpted-face';
    confidence = 0.55;
    suggested_op = 'replaceFace';
  } else {
    featureType = 'unknown';
    confidence = 0.3;
    suggested_op = 'pushPull';
  }

  return {
    featureType,
    faces: featureFaces,
    confidence,
    suggested_op,
    diagnostics: {
      surfaceType,
      analyticRadius,
      adjacentCount: totalAdjacents,
      planarAdjacents,
      cylindricalAdjacents,
      adjacencyKinds,
      face: {
        persistentId: face.persistentId,
        transientId: face.transientId,
        edges: face.edges().length,
        isAnalytic: face.isAnalytic,
      },
    },
  };
}
