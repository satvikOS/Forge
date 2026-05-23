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
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';

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
export async function translate(src, dx, dy, dz) {
  if (!src || !src.shape) throw new Error('translate: needs a body with a live .shape');
  const oc = await getOCCT();
  return withScope(() => {
    // Verified sequence from kernel-api-A3.md Item 3:
    // gp_Trsf_1() no-arg constructor; SetTranslation_1(gp_Vec) takes a gp_Vec
    // gp_Vec_4 = 3-double constructor (verified in A3 recon)
    // BRepBuilderAPI_Transform_2(shape, trsf, copy=true) — copy=true gives
    // a geometry-independent result so disposing the input cannot corrupt it.
    const trsf = track(new oc.gp_Trsf_1());
    const vec = track(new oc.gp_Vec_4(dx, dy, dz));
    trsf.SetTranslation_1(vec);
    const tf = track(new oc.BRepBuilderAPI_Transform_2(src.shape, trsf, true));
    const shape = tf.Shape();
    if (!shape || shape.IsNull()) throw new Error('translate: kernel produced a null shape');
    const meta = { op: 'translate', params: { dx, dy, dz }, parents: [src.id] };
    const wrapper = new BrepShape(shape, meta);
    // S5 — translate preserves the input body's kind (rigid transform). If
    // src is a SpineBody pass its kind through; otherwise default 'solid'.
    const declaredKind = (src.body && src.body.kind) || 'solid';
    const resultBody = bindSpine(oc, shape, {
      bodyTag: `translate-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind,
    });
    // Rigid-transform carry-through. Because copy=true gives the result a fresh
    // set of TShapes, a naive `IsSame` between input and result sub-shapes
    // never matches — so we use the engine's own `ModifiedShape(S)` mapper
    // when available, and fall back to position-pairing otherwise.
    carryRigidTransformLineage(src, resultBody, meta, { algo: tf });
    return new SpineBody(resultBody, wrapper, meta);
  });
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
export async function rotate(src, axis, angleRad, origin = { x: 0, y: 0, z: 0 }) {
  if (!src || !src.shape) throw new Error('rotate: needs a body with a live .shape');
  if (!axis || (axis.x === 0 && axis.y === 0 && axis.z === 0)) {
    throw new Error('rotate: axis must be a non-zero direction');
  }
  if (!Number.isFinite(angleRad)) {
    throw new Error('rotate: angleRad must be a finite number of radians');
  }
  const oc = await getOCCT();
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
    const tf = track(new oc.BRepBuilderAPI_Transform_2(src.shape, trsf, true));
    const shape = tf.Shape();
    if (!shape || shape.IsNull()) throw new Error('rotate: kernel produced a null shape');
    const meta = {
      op: 'rotate',
      params: { axis: { ...axis }, angleRad, origin: { ...origin } },
      parents: [src.id],
    };
    const wrapper = new BrepShape(shape, meta);
    const declaredKind = (src.body && src.body.kind) || 'solid';
    const resultBody = bindSpine(oc, shape, {
      bodyTag: `rotate-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind, // S5 — rotate preserves the input's kind.
    });
    carryRigidTransformLineage(src, resultBody, meta, { algo: tf });
    return new SpineBody(resultBody, wrapper, meta);
  });
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
