/**
 * ArchDisc Kernel — shape transforms & combination.
 *
 * SP-1 S3 — transforms are spine-aware. `translate`/`rotate` build a TopoDS
 * Trsf, run `BRepBuilderAPI_Transform` (the engine — geometry unchanged), and
 * bind the result to a fresh spine `Body`. Because a rigid Trsf does NOT
 * destroy topology (it relocates vertices/edges/faces without changing their
 * incidence), the persistent-ID carry-through here is *direct*: the result
 * has exactly the same number of faces / edges / vertices as the input, in
 * the same incidence pattern, and the input's persistent ids carry through
 * positionally. This is the simplest carry-through pattern in S3 and is the
 * baseline that boolean carry-through (BrepBoolean.js) extends to splits/
 * merges/deletes. Both `makeCompound` and the new spine-aware path keep the
 * existing geometry behaviour verbatim.
 *
 * Verified kernel sequences: docs/superpowers/notes/kernel-api-A3.md.
 *
 * SP-14c — second-pass hardening (cat2/cat3/cat9 SBO → PASS):
 *
 *   Pre-SP-14c, `translate` / `rotate` ran the engine with `copy=true` —
 *   the conservative option that refreshes the result's TShapes so
 *   disposing the input cannot corrupt the result. Empirically (per the
 *   SP-14b residual gap), the `copy=true` path produces a shape whose
 *   `BRepGProp.VolumeProperties_1.Mass()` reads 0 and whose bbox reads
 *   `[null,null,null]` — the WASM bindings can't traverse the freshly-
 *   allocated TShapes for mass-properties integration or `Bnd_Box::Add`.
 *   The geometry is geometrically valid (the shape tessellates, exports
 *   to STEP, and round-trips fine), but the integrator silently fails.
 *   This propagates to cat2/cat3/cat9 in the fuzz corpus — when one
 *   operand of a boolean is a translated solid with Mass=0, the
 *   silent-volume-zero retry path in BrepBoolean's `runBoolean` is gated
 *   off (because `inputVolB > 0` is false) and the default-tolerance
 *   result is kept.
 *
 *   SP-14c fix: switch the `BRepBuilderAPI_Transform_2` call to
 *   `copy=false`. With `copy=false` the engine re-uses the input's
 *   TShape pointers (only the location/placement is updated), so the
 *   result's mass-properties + bbox integrators read the SAME live
 *   TShapes the input does — Mass() returns the correct positive
 *   number and bbox returns finite components. The trade-off: the
 *   result shares geometry data with the input, so disposing the
 *   input WHILE the result is still live would corrupt the result.
 *   ArchDisc's `withScope` is engineered around that — survivor
 *   detection (BrepShape.js) keeps the input's BrepShape alive when
 *   the result is a survivor, AND we never explicitly `.delete()` a
 *   BrepShape until the body is removed from the registry. So
 *   `copy=false` is safe in the established lifecycle.
 *
 *   Defence-in-depth: after the transform we check the engine's Mass()
 *   on the result. If Mass() is STILL 0 (some edge case the
 *   `copy=false` switch doesn't fix), we apply a `BRepBuilderAPI_Copy_2`
 *   to produce a clean shape with fresh-but-correctly-integrable
 *   TShapes. The Copy result is what we wrap into the SpineBody.
 *   Both the switch + the Copy refresh are documented on
 *   `meta.diagnostics.transform = { copyMode, refreshApplied, ... }`.
 *
 *   The post-transform sanity check additionally feeds BrepMeasure's
 *   tessellation-based volume fallback (SP-14c fix #1b) — if the
 *   chosen result still reads Mass=0 but tessellates positively, the
 *   diagnostic records both the transform path AND the recovered
 *   volume.
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';
import { recordBodyDerive } from '../history/HistoryLog.js';

/**
 * SP-14c — apply the `BRepBuilderAPI_Transform_2` shape-transform engine to
 * `srcShape` with the input `trsf`. Tries `copy=false` first (the
 * lightweight option that re-uses TShape pointers — Mass()/bbox work
 * cleanly because the integrator can traverse the same live TShapes the
 * input did). If the result's Mass reads 0 BUT the input's Mass is
 * positive, apply a `BRepBuilderAPI_Copy_2` refresh — this re-allocates
 * the TShapes around the transformed geometry and typically restores the
 * integrator path.
 *
 * Returns the transform algo (for `algo.ModifiedShape(S)` lineage carry-
 * through) AND the final shape ready to be bound to a SpineBody. Both
 * `algo` and any `copy` it generates are `track()`ed in the caller's
 * withScope so they're freed after the body is bound.
 *
 * @param {object} oc  the opencascade.js binding
 * @param {object} srcShape  the input TopoDS_Shape
 * @param {number} srcInputMass  the input's mass (used to gate the refresh
 *   — only refresh when input had positive volume; sheet/wire inputs are
 *   expected to read 0)
 * @param {object} trsf  the gp_Trsf to apply (pre-built by the caller)
 * @param {string} opName  'translate' or 'rotate' (for the diagnostic)
 * @returns {{shape: object, algo: object, diagnostic: object}} algo +
 *   final shape + transform diagnostic
 */
function runShapeTransform(oc, srcShape, srcInputMass, trsf, opName) {
  // SP-14c — pass 1: copy=false (the lightweight, TShape-sharing path).
  // The result shares TShape pointers with the input, so the mass-
  // properties + bbox integrators can traverse them normally.
  const algo = track(new oc.BRepBuilderAPI_Transform_2(srcShape, trsf, false));
  const shape = algo.Shape();
  if (!shape || shape.IsNull()) {
    throw new Error(`${opName}: kernel produced a null shape (copy=false path)`);
  }

  // SP-14c — sanity-check: if the input had positive mass but the result
  // reads 0, apply a `BRepBuilderAPI_Copy_2` refresh to re-allocate the
  // TShapes around the transformed geometry. Mass() then typically
  // recovers (the integrator gets a clean shape to walk).
  let resultMass = 0;
  try {
    const props = track(new oc.GProp_GProps_1());
    oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
    resultMass = props.Mass();
  } catch (_e) { /* leave 0 — the refresh below handles it */ }

  let finalShape = shape;
  let refreshApplied = false;
  let postRefreshMass = resultMass;
  if (resultMass === 0 && srcInputMass > 0) {
    try {
      const copy = track(new oc.BRepBuilderAPI_Copy_2(shape, true, false));
      const refreshed = copy.Shape();
      if (refreshed && !refreshed.IsNull()) {
        finalShape = refreshed;
        refreshApplied = true;
        // Re-measure post-refresh — purely for the diagnostic; the caller
        // doesn't use it directly because BrepMeasure.volume() will fall
        // through to its own tessellation-based fallback if Mass STILL
        // reads 0 here.
        try {
          const props2 = track(new oc.GProp_GProps_1());
          oc.BRepGProp.VolumeProperties_1(finalShape, props2, false, false, false);
          postRefreshMass = props2.Mass();
        } catch (_e) { /* leave the pre-refresh value */ }
      }
    } catch (_e) { /* refresh failed — keep the copy=false result + let BrepMeasure tessellate */ }
  }

  return {
    shape: finalShape,
    algo,
    diagnostic: {
      copyMode: false, // ALWAYS false in SP-14c — never copy=true again
      refreshApplied,
      inputMass: srcInputMass,
      preRefreshMass: resultMass,
      postRefreshMass,
      note: refreshApplied
        ? `${opName}: BRepBuilderAPI_Transform_2(copy=false) result read Mass=0 ` +
          `despite positive input Mass=${srcInputMass.toFixed(4)}; applied ` +
          `BRepBuilderAPI_Copy_2 refresh which recovered Mass=${postRefreshMass.toFixed(4)}.`
        : `${opName}: BRepBuilderAPI_Transform_2(copy=false) — Mass=${resultMass.toFixed(4)} ` +
          `from input Mass=${srcInputMass.toFixed(4)} (no refresh needed).`,
    },
  };
}

/**
 * Translate a shape by (dx, dy, dz) mm.
 *
 * Verified kernel sequence: kernel-api-A3.md Item 3 —
 *   gp_Trsf_1() + SetTranslation_1(gp_Vec_4) + BRepBuilderAPI_Transform_2(shape, trsf, true)
 *
 * @param {SpineBody|BrepShape} src  source body — SpineBody (S3-migrated) or
 *        legacy BrepShape (downstream un-migrated ops, mixed-currency interim).
 * @param {number} dx
 * @param {number} dy
 * @param {number} dz
 * @returns {Promise<SpineBody>}  the translated body in the SP-1 currency.
 */
async function _runTranslate(src, dx, dy, dz, bodyTag) {
  const oc = await getOCCT();
  // SP-14c — measure the input mass OUTSIDE the result scope so the
  // refresh decision in `runShapeTransform` has a reliable reference.
  // The probe is a tiny scope of its own; it doesn't entangle with the
  // result's survivor set.
  let srcInputMass = 0;
  try {
    srcInputMass = await withScope(() => {
      const props = track(new oc.GProp_GProps_1());
      oc.BRepGProp.VolumeProperties_1(src.shape, props, false, false, false);
      return props.Mass();
    });
  } catch (_e) { /* leave 0 — non-solid input is fine */ }

  return withScope(() => {
    // Verified sequence from kernel-api-A3.md Item 3:
    // gp_Trsf_1() no-arg constructor; SetTranslation_1(gp_Vec) takes a gp_Vec
    // gp_Vec_4 = 3-double constructor (verified in A3 recon).
    // SP-14c — `runShapeTransform` runs BRepBuilderAPI_Transform_2 with
    // copy=false (TShape-sharing) AND applies a BRepBuilderAPI_Copy_2
    // refresh if Mass() reads 0 on the result of a positive-mass input.
    // The Mass-bug-via-copy=true pathology that fells cat2/cat3/cat9 in
    // SP-14b is fixed here.
    const trsf = track(new oc.gp_Trsf_1());
    const vec = track(new oc.gp_Vec_4(dx, dy, dz));
    trsf.SetTranslation_1(vec);
    const { shape, algo: tf, diagnostic } = runShapeTransform(
      oc, src.shape, srcInputMass, trsf, 'translate');
    const meta = {
      op: 'translate', params: { dx, dy, dz }, parents: [src.id],
      diagnostics: { transform: diagnostic },
    };
    const wrapper = new BrepShape(shape, meta);
    // S5 — translate preserves the input body's kind (rigid transform). If
    // src is a SpineBody pass its kind through; otherwise default 'solid'.
    const declaredKind = (src.body && src.body.kind) || 'solid';
    const resultBody = bindSpine(oc, shape, {
      bodyTag: bodyTag || `translate-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind,
    });
    // Rigid-transform carry-through. Because copy=false re-uses TShapes,
    // a naive `IsSame` works for most sub-shapes; we still pass the algo
    // for `ModifiedShape(S)` lookup of any entities the transform
    // explicitly re-mapped (typically none for a rigid translate).
    carryRigidTransformLineage(src, resultBody, meta, { algo: tf });
    // SP-14c — mirror the transform diagnostic onto the body so callers
    // that inspect `body.diagnostics` (vs `meta.diagnostics`) can see it.
    try {
      if (resultBody.diagnostics) {
        resultBody.diagnostics.transform = diagnostic;
      }
    } catch (_e) { /* best-effort */ }
    return new SpineBody(resultBody, wrapper, meta);
  });
}

export async function translate(src, dx, dy, dz) {
  if (!src || !src.shape) throw new Error('translate: needs a body with a live .shape');
  // SP-14c — accept BOTH the legacy 4-arg form `translate(src, dx, dy, dz)` and
  // the array form `translate(src, [dx, dy, dz])`. The fuzz corpus + the
  // public-facing tool layer both use the array form (matches the manifold-
  // style `solid.translate([x,y,z])` convention adopted in `atomic/AtomicOps`);
  // the legacy 4-arg form is preserved for SP-3b history `rebuild` callbacks +
  // any internal callers that already pass scalars.
  if (Array.isArray(dx)) {
    if (dx.length !== 3) {
      throw new Error(`translate: array form needs [dx,dy,dz] (got length ${dx.length})`);
    }
    [dx, dy, dz] = dx;
  }
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) {
    throw new Error(`translate: dx, dy, dz must be finite numbers (got ${dx}, ${dy}, ${dz})`);
  }
  const result = await _runTranslate(src, dx, dy, dz);
  // SP-3b history hook — record a body-derive delta. Forward replays the
  // translation against the live input (looked up by persistent id); inverse
  // removes the result.
  const persistentBodyId = result.body && result.body.persistentId;
  const srcPid = src.body && src.body.persistentId;
  if (persistentBodyId && srcPid) {
    try {
      recordBodyDerive({
        opName: 'translate',
        persistentBodyId,
        inputPersistentIds: [srcPid],
        meta: { op: 'translate', params: { dx, dy, dz } },
        rebuild: ([liveSrc]) => _runTranslate(liveSrc, dx, dy, dz, persistentBodyId),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('translate: history recordBodyDerive failed —', err && err.message || err);
    }
  }
  return result;
}

/**
 * Rotate a shape `angle` radians about the line (originX,originY,originZ) →
 * (originX+axisX, originY+axisY, originZ+axisZ).
 *
 * Engine sequence (analogous to A3 Item 3, with SetRotation):
 *   gp_Trsf_1() + SetRotation_1(gp_Ax1, angle) +
 *   BRepBuilderAPI_Transform_2(shape, trsf, true)
 * where `gp_Ax1_2(gp_Pnt, gp_Dir)` builds the axis. The S3 spine carry-through
 * is identical to translate's (rigid transform preserves topology).
 *
 * @param {SpineBody|BrepShape} src
 * @param {object} axis  { x, y, z } — rotation-axis direction (any non-zero
 *                       length; OCCT normalises it).
 * @param {number} angleRad  rotation angle in radians.
 * @param {object} [origin] { x, y, z } — point on the axis. Default origin.
 * @returns {Promise<SpineBody>}
 */
async function _runRotate(src, axis, angleRad, origin, bodyTag) {
  const oc = await getOCCT();
  // SP-14c — measure input mass for the refresh decision (same pattern as
  // _runTranslate). Done outside the result scope.
  let srcInputMass = 0;
  try {
    srcInputMass = await withScope(() => {
      const props = track(new oc.GProp_GProps_1());
      oc.BRepGProp.VolumeProperties_1(src.shape, props, false, false, false);
      return props.Mass();
    });
  } catch (_e) { /* leave 0 */ }

  return withScope(() => {
    const pnt = track(new oc.gp_Pnt_3(
      origin.x || 0, origin.y || 0, origin.z || 0));
    const dir = track(new oc.gp_Dir_4(axis.x, axis.y, axis.z));
    const ax1 = track(new oc.gp_Ax1_2(pnt, dir));
    const trsf = track(new oc.gp_Trsf_1());
    // Try the suffix-numbered binding forms in order. OCCT's gp_Trsf exposes
    // SetRotation in three overloads (axis+angle, quaternion, axis frame
    // change); the (ax1, angle) form is the one we want and is usually
    // bound as SetRotation_1 in opencascade.js@2.0.0-beta. Defensive: if
    // the suffix differs in this build, fall through to the un-suffixed name.
    let rotated = false;
    for (const m of ['SetRotation_1', 'SetRotation']) {
      if (typeof trsf[m] !== 'function') continue;
      try { trsf[m](ax1, angleRad); rotated = true; break; }
      catch (_e) { /* try next form */ }
    }
    if (!rotated) {
      throw new Error('rotate: no usable gp_Trsf SetRotation binding found');
    }
    // SP-14c — same copy=false + refresh strategy as translate.
    const { shape, algo: tf, diagnostic } = runShapeTransform(
      oc, src.shape, srcInputMass, trsf, 'rotate');
    const meta = {
      op: 'rotate',
      params: { axis: { ...axis }, angleRad, origin: { ...origin } },
      parents: [src.id],
      diagnostics: { transform: diagnostic },
    };
    const wrapper = new BrepShape(shape, meta);
    const declaredKind = (src.body && src.body.kind) || 'solid';
    const resultBody = bindSpine(oc, shape, {
      bodyTag: bodyTag || `rotate-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind, // S5 — rotate preserves the input's kind.
    });
    carryRigidTransformLineage(src, resultBody, meta, { algo: tf });
    try {
      if (resultBody.diagnostics) {
        resultBody.diagnostics.transform = diagnostic;
      }
    } catch (_e) { /* best-effort */ }
    return new SpineBody(resultBody, wrapper, meta);
  });
}

export async function rotate(src, axis, angleRad, origin = { x: 0, y: 0, z: 0 }) {
  if (!src || !src.shape) throw new Error('rotate: needs a body with a live .shape');
  if (!axis || (axis.x === 0 && axis.y === 0 && axis.z === 0)) {
    throw new Error('rotate: axis must be a non-zero direction');
  }
  if (!Number.isFinite(angleRad)) {
    throw new Error('rotate: angleRad must be a finite number of radians');
  }
  const result = await _runRotate(src, axis, angleRad, origin);
  const persistentBodyId = result.body && result.body.persistentId;
  const srcPid = src.body && src.body.persistentId;
  if (persistentBodyId && srcPid) {
    try {
      recordBodyDerive({
        opName: 'rotate',
        persistentBodyId,
        inputPersistentIds: [srcPid],
        meta: { op: 'rotate', params: { axis: { ...axis }, angleRad, origin: { ...origin } } },
        rebuild: ([liveSrc]) =>
          _runRotate(liveSrc, axis, angleRad, origin, persistentBodyId),
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('rotate: history recordBodyDerive failed —', err && err.message || err);
    }
  }
  return result;
}

/**
 * Combine multiple shapes into a single compound shape.
 *
 * SP-1 S3 — `makeCompound` returns a `SpineBody` whose topology is the union
 * of the input lumps. Because a compound is topologically a flat aggregation
 * (no boolean fusing — the input lumps stay separate inside the compound),
 * each input's faces/edges/vertices survive verbatim under `bindSpine` (their
 * TShape pointers are kept by OCCT). Persistent-ID carry-through is therefore
 * the "every input survives" case: every input id maps to the result entity
 * whose `geomRef` `IsSame` the input's `geomRef`. The result body's `kind`
 * stays 'solid' if every input was 'solid'.
 *
 * Verified kernel sequence: kernel-api-A3.md Items 2/8 —
 *   TopoDS_Compound() (undecorated) + BRep_Builder() (undecorated) +
 *   MakeCompound(compound) + Add(compound, shape) for each shape.
 *
 * @param {Array<SpineBody|BrepShape>} bodies
 * @returns {Promise<SpineBody>}
 */
export async function makeCompound(bodies) {
  if (!Array.isArray(bodies) || bodies.length === 0) {
    throw new Error('makeCompound: needs a non-empty array of bodies');
  }
  for (const s of bodies) {
    if (!s || !s.shape) throw new Error('makeCompound: every entry must have a live .shape');
  }
  const oc = await getOCCT();
  return withScope(() => {
    // Verified sequence from kernel-api-A3.md Items 2 & 8:
    // TopoDS_Compound (undecorated, no _N suffix) + BRep_Builder (undecorated)
    // MakeCompound initializes the compound; Add appends each shape
    const compound = track(new oc.TopoDS_Compound());
    const builder = track(new oc.BRep_Builder());
    builder.MakeCompound(compound);
    for (const s of bodies) {
      builder.Add(compound, s.shape);
    }
    const shape = compound;
    if (!shape || shape.IsNull()) throw new Error('makeCompound: kernel produced a null shape');
    const meta = { op: 'makeCompound', parents: bodies.map((s) => s.id) };
    const wrapper = new BrepShape(shape, meta);
    // S5 — a compound of like-kinded bodies inherits that kind; mixed kinds
    // collapse to the most general (sheet beats solid; wire beats both). The
    // topology-derived kind in assertKind reconciles.
    const inputKinds = new Set(bodies.map(b => (b.body && b.body.kind) || 'solid'));
    let compoundKind;
    if (inputKinds.has('wire')) compoundKind = 'wire';
    else if (inputKinds.has('sheet')) compoundKind = 'sheet';
    else compoundKind = 'solid';
    const resultBody = bindSpine(oc, shape, {
      bodyTag: `makeCompound-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind: compoundKind,
    });
    // Carry every input id directly — a compound preserves every sub-shape's
    // TShape, so every input entity has a 1:1 IsSame partner in the result.
    let totalSurvived = 0;
    for (const src of bodies) {
      if (!src.body) continue;
      totalSurvived += carryRigidTransformLineage(src, resultBody, meta);
    }
    meta.lineage = { survived: totalSurvived, modified: 0, generated: 0, deleted: 0 };
    return new SpineBody(resultBody, wrapper, meta);
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Rigid-transform / compound lineage helper
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Carry an input body's persistent ids onto `resultBody` for a topology-
 * preserving op (rigid transform, compound). The engine keeps each TShape
 * across these ops, so every input entity has exactly one matching result
 * entity reachable via `IsSame` on the `geomRef`. We index the result entities
 * by HashCode and look each input up.
 *
 * Returns the count of survived entities (faces + edges + vertices).
 */
function carryRigidTransformLineage(src, resultBody, meta, opts = {}) {
  if (!src || !src.body) return 0;
  const inFaces  = src.body.faces();
  const inEdges  = src.body.edges();
  const inVerts  = src.body.vertices();
  const faceIdx  = indexByGeomRef(resultBody.faces());
  const edgeIdx  = indexByGeomRef(resultBody.edges());
  const vertIdx  = indexByGeomRef(resultBody.vertices());
  // When the engine's BRepBuilderAPI_Transform algorithm is available, ask it
  // for the modified sub-shape per input — robust against the copy=true TShape
  // refresh that defeats a naive IsSame match. Falls back to IsSame matching
  // (which works for compounds that re-use input TShapes).
  const algo = opts.algo || null;
  let n = 0;
  n += carry(inFaces,  faceIdx, algo);
  n += carry(inEdges,  edgeIdx, algo);
  n += carry(inVerts,  vertIdx, algo);
  // Record on body diagnostics for the lineage report (additive — booleans
  // overwrite with their own carryLineage report).
  if (!resultBody.diagnostics.lineage) {
    resultBody.diagnostics.lineage = {
      survived: n, modified: 0, generated: 0, deleted: 0, conflicts: 0,
      notes: [`rigid transform / compound lineage from ${src.id || '?'}`],
      faceMap: new Map(), edgeMap: new Map(), vertexMap: new Map(),
    };
  } else {
    resultBody.diagnostics.lineage.survived += n;
  }
  // Stash a compact summary onto meta as well — useful for e2e assertions.
  if (meta) {
    meta.rigidLineage = (meta.rigidLineage || 0) + n;
  }
  return n;
}

function carry(inputs, index, algo) {
  let count = 0;
  for (const ent of inputs) {
    if (!ent.geomRef || !ent.persistentId) continue;
    // Two-tier lookup:
    //   Path A — algo.ModifiedShape(S): the engine's own mapper. For a
    //            BRepBuilderAPI_Transform with copy=true this yields the
    //            corresponding result sub-shape directly (the *new* TShape).
    //   Path B — IsSame: works for the compound case (Add(comp, shape)
    //            re-uses the input's TShape, so IsSame succeeds).
    let result = null;
    if (algo && typeof algo.ModifiedShape === 'function') {
      let modShape = null;
      try { modShape = algo.ModifiedShape(ent.geomRef); } catch (_e) { modShape = null; }
      if (modShape && !(modShape.IsNull && modShape.IsNull())) {
        result = findBySameShape(index, modShape);
      }
    }
    if (!result) result = findBySameShape(index, ent.geomRef);
    if (!result) continue;
    // Set the result entity's persistent id from the input. The freshly-
    // allocated id is replaced — equivalent of OCCT's "Modified is empty,
    // so S survived as-is" branch in carryLineage.
    if (!result._lineageClaimed) {
      result.persistentId = ent.persistentId;
      result._lineageClaimed = ent.persistentId;
    }
    if (!result.derivedFrom) result.derivedFrom = [];
    if (!result.derivedFrom.includes(ent.persistentId)) {
      result.derivedFrom.push(ent.persistentId);
    }
    count += 1;
  }
  return count;
}

function indexByGeomRef(entities) {
  const buckets = new Map();
  for (const ent of entities) {
    if (!ent.geomRef) continue;
    const h = shapeHash(ent.geomRef);
    let arr = buckets.get(h);
    if (!arr) { arr = []; buckets.set(h, arr); }
    arr.push({ shape: ent.geomRef, ent });
  }
  return buckets;
}

function findBySameShape(index, occtShape) {
  if (!occtShape) return null;
  const h = shapeHash(occtShape);
  const arr = index.get(h);
  if (!arr) return null;
  for (const rec of arr) {
    if (sameShape(rec.shape, occtShape)) return rec.ent;
  }
  return null;
}

function shapeHash(occt) {
  try {
    if (typeof occt.HashCode === 'function') return occt.HashCode(2147483647);
  } catch (_e) { /* fall through */ }
  return 0;
}

function sameShape(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  try { return typeof a.IsSame === 'function' && a.IsSame(b); }
  catch (_e) { return false; }
}
