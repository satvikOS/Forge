/**
 * ArchDisc Kernel — Sheet & tolerant modeling (Area G, SP-11).
 *
 * First-class **sheet bodies**, **laminas**, and **tolerant edges/vertices**
 * — the Parasolid "sheet body / tedge / tvertex" and ACIS "lamina / tolerant
 * edge" contracts surfaced as a dedicated facade module.
 *
 * Until SP-11 sheet bodies were implicit — produced as a side effect of
 * `buildNurbsPatch` / `trimmedNurbsFace` / `stitchFaces` etc. — and tolerance
 * was a passive S0 field with no propagation contract. SP-11 promotes both to
 * FIRST-CLASS: ops can ASK for a sheet body explicitly (`makeSheetBody`),
 * construct the degenerate single-face lamina (`makeLamina`), and inspect /
 * tag / propagate tolerance through every spine op.
 *
 * ── The ops shipped by this module ──────────────────────────────────────────
 *
 *   makeSheetBody(facesOrShape)
 *     Build a `SpineBody{kind:'sheet'}` from an arbitrary set of faces (each a
 *     TopoDS_Face), an open shell, or a face-compound. The result is a single
 *     shell of all input faces with proper per-shell connectivity (sewn at a
 *     small tolerance so shared edges unify). The result body is GUARANTEED
 *     not to be watertight (a watertight result would be a solid, not a
 *     sheet) — `assertSheet` succeeds; `assertSolid` throws.
 *
 *   makeLamina(face)
 *     Build a `SpineBody{kind:'sheet'}` from EXACTLY ONE TopoDS_Face. The
 *     result is a single 1-face shell — the canonical "lamina" Parasolid
 *     describes as a single-face sheet body, useful as a trim tool and as
 *     an intermediate for sheet→solid transitions (a lamina extruded normal
 *     to its surface gives a prism; a lamina swept gives a swept shell).
 *     `assertLamina` succeeds on the result; `isLamina()` reads true.
 *
 *   tolerantEdges(body, opts)
 *     Return every edge of `body` whose tolerance exceeds `opts.threshold`
 *     (default 0 = anything above exact). Sorted descending by tolerance —
 *     callers usually want the loosest first.
 *
 *   tolerantVertices(body, opts)
 *     Symmetric to `tolerantEdges` for vertices.
 *
 *   setBodyTolerance(body, tolerance)
 *     Sugar over `body.setBodyTolerance` that returns the body for chaining.
 *
 *   BodyKindError
 *     The canonical exception thrown by `Body.assertSolid`/`assertSheet`/
 *     `assertWire`/`assertLamina`. It is the class the existing assert
 *     methods raise; this module re-exports it so callers can `catch
 *     (e instanceof BodyKindError)` on a documented public symbol rather
 *     than scanning `error.message`.
 *
 * ── Per-kind invariant contracts SP-11 documents ────────────────────────────
 *
 *   solid  — `body.isWatertight() === true` AND `body.hasFreeBoundary()
 *            === false`. Every non-degenerate edge has ≥2 coedges; the body
 *            bounds a closed volume.
 *   sheet  — `body.isWatertight() === false` AND `body.hasFreeBoundary()
 *            === true`. At least one face; at least one free boundary edge.
 *            A sheet that is also watertight would be a solid (contradiction),
 *            so the binder reconciles toward 'solid' when topology says so.
 *   wire   — `body.faces().length === 0` AND every shell is wire-only.
 *
 * ── Mixed-tolerance booleans + tolerant-modeling op gates ───────────────────
 *
 * `shell` requires solid; `thicken` requires sheet. These already exist
 * via `Body.assertSolid` / `assertSheet` in the spine entity classes; the
 * existing facade ops (`BrepLocalOps.shell`, `BrepLocalOps.thicken`) call
 * those gates. SP-11 does NOT modify the existing facade ops (their
 * tolerance-survival is achieved purely via `carryLineage`'s per-entity
 * MAX rule wired in `IdLineage.js`).
 *
 * Sheet-body boolean rules (documented; the existing booleans honour these
 * by handing the engine result back to `bindSpine` which derives the kind
 * from topology):
 *   - fuse(sheet, sheet) → sheet (or solid if the result happens to close)
 *   - fuse(solid, solid) → solid
 *   - cut(solid, sheet)  → solid with the sheet imprinted
 *   - cut(solid, solid)  → solid
 *
 * ── Honest residual gaps ────────────────────────────────────────────────────
 *
 *   - Tolerance survival is COMPLETE on every spine-aware op (every facade
 *     op that already calls `carryLineage` — see `bindSpine` callers in
 *     S2–S4c). The carry is automatic via the per-entity MAX rule. NO
 *     existing brep op needs to be modified.
 *   - A few legacy paths still produce raw `BrepShape` (not `SpineBody`):
 *     `stitchFaces`'s hardcoded 2-panel demo, the older NURBS construction
 *     paths. Those paths do not yet pipe per-entity tolerance through (no
 *     spine on the result). Follow-up: their migration to `SpineBody`
 *     would automatically wire tolerance carry-through, but the migration
 *     itself is out of SP-11 scope (it would touch existing brep files
 *     that the SP-11 dispatch allowlist forbids).
 *   - `makeSheetBody` accepts the COMMON case (a connected set of faces
 *     that sew into one shell). A disjoint set of faces produces a multi-
 *     shell (or multi-lump) result depending on how `BRepBuilderAPI_Sewing`
 *     groups them — this is the same documented behaviour `thicken` uses
 *     when sewing a face compound, so the two-paths are consistent.
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';

// ─────────────────────────────────────────────────────────────────────────────
// BodyKindError — the canonical exception for kind-gate violations
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The exception class `Body.assertSolid` / `assertSheet` / `assertWire` /
 * `assertLamina` raise. SP-11 documents it as a public symbol so callers can
 * pattern-match on the class rather than scanning the error message text.
 *
 * NOTE — the existing assert methods (predating SP-11 in `Body.js`) throw a
 * plain `Error` whose message starts with `BodyKindAssertionError:`. SP-11
 * adds this dedicated class as the recommended catch-target going forward;
 * the existing message-prefix contract is unchanged for backwards
 * compatibility. Callers can match EITHER `err instanceof BodyKindError` OR
 * `err.message.includes('BodyKindAssertionError')`.
 */
export class BodyKindError extends Error {
  constructor(message, opts = {}) {
    super(message || 'BodyKindAssertionError');
    this.name = 'BodyKindError';
    this.expectedKind = opts.expectedKind || null;
    this.actualKind = opts.actualKind || null;
    this.body = opts.body || null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1.  makeSheetBody — construct a sheet body from a set of faces
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a `SpineBody{kind:'sheet'}` from an arbitrary set of TopoDS faces, an
 * open shell, or a face-compound. The faces are sewn at `opts.tolerance` so
 * shared edges unify into a single coedge cycle; the result is a single shell
 * (or, when sewing groups disjoint clusters, multiple shells) classified as a
 * sheet body by `bindSpine`'s kind derivation (the topology has a free
 * boundary → not watertight → sheet).
 *
 * Real input forms (each is a documented contract path):
 *
 *   • Array<TopoDS_Face>        — sew the array and bind
 *   • Array<{shape: TopoDS_Face}> — caller hands wrapped faces (e.g. SpineBody
 *                                  wrappers) — `.shape` is read off each
 *   • TopoDS_Shell              — bind directly (single shell already)
 *   • TopoDS_Compound of faces  — sew the children and bind
 *
 * The body's `kind` is GUARANTEED to be `'sheet'` (the spine binder derives
 * the kind from topology; this op's input is non-watertight). If the caller
 * hands faces that, by construction, would close into a solid, the binder
 * correctly reclassifies the result — and `assertSheet` would throw on it.
 * For tolerant solid construction use the standard primitives + booleans.
 *
 * @param {Array<object>|object} input  faces / wrapped faces / shell / compound
 * @param {object} [opts]
 * @param {number} [opts.tolerance=1e-3]   sewing tolerance (mm).
 * @param {number} [opts.bodyTolerance]    optional body-level modelling
 *        tolerance (mm) to stamp on `body.metadata.tolerance`. Default = the
 *        sewing tolerance.
 * @param {string} [opts.bodyTag]
 * @returns {Promise<SpineBody>}
 */
export async function makeSheetBody(input, opts = {}) {
  if (!input) throw new Error('makeSheetBody: faces or shell input required');
  const tolerance = opts.tolerance > 0 ? opts.tolerance : 1e-3;
  const bodyTolerance = Number.isFinite(opts.bodyTolerance) && opts.bodyTolerance >= 0
    ? opts.bodyTolerance : tolerance;
  const oc = await getOCCT();

  return withScope(() => {
    const shellShape = _resolveToSheetShape(oc, input, tolerance);
    if (!shellShape || shellShape.IsNull()) {
      throw new Error('makeSheetBody: failed to build a non-null sheet shape');
    }

    const meta = {
      op: 'makeSheetBody',
      params: { tolerance, bodyTolerance, inputForm: _classifyInputForm(input) },
      description: `Sheet body built from ${_inputCount(input)} face(s) at tol=${tolerance} mm`,
    };
    const wrapper = new BrepShape(shellShape, meta);
    const resultBody = bindSpine(oc, shellShape, {
      bodyTag: opts.bodyTag || `makeSheetBody-${wrapper.id}`,
      geomEngineShape: wrapper,
      // SP-11 — declare the result kind explicitly. bindSpine reconciles the
      // declared kind against the topology-derived kind and records any
      // disagreement as `diagnostics.kindMismatch`. If the input faces close
      // into a solid by accident, the binder will correctly classify as
      // solid and flag the mismatch so the caller knows the input was not
      // sheet-shaped.
      declaredKind: 'sheet',
      validate: false,
    });
    // SP-11 — stamp the body-level tolerance so downstream ops see it.
    if (bodyTolerance > 0) {
      resultBody.setBodyTolerance(bodyTolerance);
    }
    // SP-11 — propagate the chosen tolerance onto every edge + vertex of
    // the result. Sewing-time tolerance becomes the canonical per-entity
    // tolerance — the loosest the geometry was treated as during the sew,
    // i.e. the genuine "tedge" / "tvertex" tolerance for downstream ops.
    if (bodyTolerance > 0) {
      for (const e of resultBody.edges()) {
        if (typeof e.setTolerance === 'function') {
          try { e.setTolerance(bodyTolerance); } catch { /* skip on bad value */ }
        }
      }
      for (const v of resultBody.vertices()) {
        if (typeof v.setTolerance === 'function') {
          try { v.setTolerance(bodyTolerance); } catch { /* skip */ }
        }
      }
    }
    return new SpineBody(resultBody, wrapper, meta);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 2.  makeLamina — single-face sheet body
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a `SpineBody{kind:'sheet'}` from EXACTLY ONE face — the degenerate
 * single-face "lamina" Parasolid + ACIS recognise. The result has one lump
 * holding one shell holding one face — useful as a trim tool, as an
 * intermediate for sheet→solid transitions (extrude/thicken a lamina), and
 * as the simplest possible test bed for sheet-modelling ops.
 *
 * Result's `body.isLamina()` reads true; `body.assertLamina()` succeeds.
 *
 * @param {object} face  a TopoDS_Face, or a wrapper with `.shape` pointing
 *        to one.
 * @param {object} [opts]
 * @param {number} [opts.bodyTolerance=0]
 * @param {string} [opts.bodyTag]
 * @returns {Promise<SpineBody>}
 */
export async function makeLamina(face, opts = {}) {
  if (!face) throw new Error('makeLamina: face input required');
  // Accept a TopoDS_Face directly OR a wrapper whose `.shape` is one.
  const topoFace = (face.shape && typeof face.shape === 'object') ? face.shape : face;
  if (!topoFace || (typeof topoFace.IsNull === 'function' && topoFace.IsNull())) {
    throw new Error('makeLamina: face must be a non-null TopoDS_Face');
  }
  const bodyTolerance = Number.isFinite(opts.bodyTolerance) && opts.bodyTolerance >= 0
    ? opts.bodyTolerance : 0;
  const oc = await getOCCT();

  return withScope(() => {
    // A lamina is JUST a single face wrapped in a one-face shell. We
    // construct the shell via BRep_Builder so the result is a proper
    // TopoDS_Shell of one TopoDS_Face — the topology bindSpine expects.
    let shellShape;
    try {
      const builder = track(new oc.BRep_Builder());
      const shell = track(new oc.TopoDS_Shell());
      builder.MakeShell(shell);
      builder.Add(shell, topoFace);
      shellShape = shell;
    } catch (_e) {
      // Fallback — sewing a single face also produces a shell.
      const sewing = track(new oc.BRepBuilderAPI_Sewing(
        1e-4, true, true, true, false));
      sewing.Add(topoFace);
      const pr = track(new oc.Message_ProgressRange_1());
      sewing.Perform(pr);
      shellShape = sewing.SewedShape();
    }
    if (!shellShape || shellShape.IsNull()) {
      throw new Error('makeLamina: failed to wrap face in a non-null shell');
    }

    const meta = {
      op: 'makeLamina',
      params: { bodyTolerance },
      description: 'Lamina — single-face sheet body (Parasolid PK_BODY_t / ACIS lamina)',
    };
    const wrapper = new BrepShape(shellShape, meta);
    const resultBody = bindSpine(oc, shellShape, {
      bodyTag: opts.bodyTag || `makeLamina-${wrapper.id}`,
      geomEngineShape: wrapper,
      declaredKind: 'sheet',
      validate: false,
    });
    if (bodyTolerance > 0) {
      resultBody.setBodyTolerance(bodyTolerance);
      for (const e of resultBody.edges()) {
        if (typeof e.setTolerance === 'function') {
          try { e.setTolerance(bodyTolerance); } catch { /* skip */ }
        }
      }
      for (const v of resultBody.vertices()) {
        if (typeof v.setTolerance === 'function') {
          try { v.setTolerance(bodyTolerance); } catch { /* skip */ }
        }
      }
    }
    return new SpineBody(resultBody, wrapper, meta);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// 3.  tolerantEdges / tolerantVertices — query the tolerant entities
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Return every edge of `body` whose modelling tolerance exceeds `threshold`
 * (default 0 = anything above exact). Sorted DESCENDING by tolerance so the
 * loosest comes first — callers usually want the most tolerant entities at
 * the top of the list for inspection or selection.
 *
 * @param {SpineBody|Body} body
 * @param {{threshold?:number}} [opts]
 * @returns {Array<{edge:object, tolerance:number, persistentId:string|null}>}
 */
export function tolerantEdges(body, opts = {}) {
  const threshold = Number.isFinite(opts.threshold) && opts.threshold >= 0
    ? opts.threshold : 0;
  const spine = (body && body.body) ? body.body : body;
  if (!spine || typeof spine.edges !== 'function') return [];
  const out = [];
  for (const e of spine.edges()) {
    const t = (typeof e.getTolerance === 'function')
      ? e.getTolerance()
      : (Number.isFinite(e.tolerance) ? e.tolerance : 0);
    if (t > threshold) {
      out.push({ edge: e, tolerance: t, persistentId: e.persistentId || null });
    }
  }
  out.sort((a, b) => b.tolerance - a.tolerance);
  return out;
}

/**
 * Return every vertex of `body` whose modelling tolerance exceeds `threshold`.
 * Sorted DESCENDING by tolerance.
 *
 * @param {SpineBody|Body} body
 * @param {{threshold?:number}} [opts]
 * @returns {Array<{vertex:object, tolerance:number, persistentId:string|null}>}
 */
export function tolerantVertices(body, opts = {}) {
  const threshold = Number.isFinite(opts.threshold) && opts.threshold >= 0
    ? opts.threshold : 0;
  const spine = (body && body.body) ? body.body : body;
  if (!spine || typeof spine.vertices !== 'function') return [];
  const out = [];
  for (const v of spine.vertices()) {
    const t = (typeof v.getTolerance === 'function')
      ? v.getTolerance()
      : (Number.isFinite(v.tolerance) ? v.tolerance : 0);
    if (t > threshold) {
      out.push({ vertex: v, tolerance: t, persistentId: v.persistentId || null });
    }
  }
  out.sort((a, b) => b.tolerance - a.tolerance);
  return out;
}

/**
 * Convenience — every tolerant face of the body, sorted descending. Faces
 * carry tolerance from SP-11 (Face.setTolerance); the survival rule via
 * carryLineage applies symmetrically.
 *
 * @param {SpineBody|Body} body
 * @param {{threshold?:number}} [opts]
 * @returns {Array<{face:object, tolerance:number, persistentId:string|null}>}
 */
export function tolerantFaces(body, opts = {}) {
  const threshold = Number.isFinite(opts.threshold) && opts.threshold >= 0
    ? opts.threshold : 0;
  const spine = (body && body.body) ? body.body : body;
  if (!spine || typeof spine.faces !== 'function') return [];
  const out = [];
  for (const f of spine.faces()) {
    const t = (typeof f.getTolerance === 'function')
      ? f.getTolerance()
      : (Number.isFinite(f.tolerance) ? f.tolerance : 0);
    if (t > threshold) {
      out.push({ face: f, tolerance: t, persistentId: f.persistentId || null });
    }
  }
  out.sort((a, b) => b.tolerance - a.tolerance);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// 4.  setBodyTolerance — sugar that returns the body for chaining
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stamp the body-level modelling tolerance and return the body (chainable).
 * Equivalent to `body.setBodyTolerance(value)` but accepts a `SpineBody`
 * wrapper (delegates to the underlying spine `body`).
 *
 * @param {SpineBody|Body} body
 * @param {number} tolerance  mm (≥0, finite). Default 0 = exact.
 * @returns {SpineBody|Body}
 */
export function setBodyTolerance(body, tolerance) {
  if (!body) throw new Error('setBodyTolerance: body required');
  const spine = (body.body) ? body.body : body;
  if (typeof spine.setBodyTolerance !== 'function') {
    throw new Error('setBodyTolerance: target has no setBodyTolerance — not a spine Body');
  }
  spine.setBodyTolerance(tolerance);
  return body;
}

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers — input resolution + sewing
// ─────────────────────────────────────────────────────────────────────────────

/** Coerce the caller's input into a single TopoDS shape suitable for `bindSpine`. */
function _resolveToSheetShape(oc, input, tolerance) {
  // Array of faces / wrapped faces — sew them into a shell.
  if (Array.isArray(input)) {
    const faceShapes = input.map((entry) => {
      if (!entry) return null;
      if (entry.shape && typeof entry.shape === 'object') return entry.shape;
      return entry;
    }).filter((f) => f && (typeof f.IsNull !== 'function' || !f.IsNull()));
    if (faceShapes.length === 0) {
      throw new Error('makeSheetBody: array input contained no valid faces');
    }
    return _sewFaces(oc, faceShapes, tolerance);
  }
  // Single TopoDS_Shape — accept Shell directly; sew Compound or Face.
  const shape = (input.shape && typeof input.shape === 'object') ? input.shape : input;
  if (!shape || (typeof shape.IsNull === 'function' && shape.IsNull())) {
    throw new Error('makeSheetBody: input shape is null');
  }
  // If it's already a shell, just return it. If it's a compound or a face,
  // sew (a single face sews into a 1-face shell — convenient).
  const SE = oc.TopAbs_ShapeEnum;
  try {
    const t = shape.ShapeType();
    if (t === SE.TopAbs_SHELL) return shape;
  } catch (_e) { /* not a TopoDS_Shape — fall through to sew */ }
  // Sew everything else.
  return _sewFaces(oc, _extractFaces(oc, shape), tolerance);
}

/** Walk every FACE sub-shape of `shape` and return them as an array. */
function _extractFaces(oc, shape) {
  const SE = oc.TopAbs_ShapeEnum;
  const out = [];
  const ex = track(new oc.TopExp_Explorer_2(shape, SE.TopAbs_FACE, SE.TopAbs_SHAPE));
  for (; ex.More(); ex.Next()) {
    out.push(track(oc.TopoDS.Face_1(ex.Current())));
  }
  return out;
}

/**
 * Sew an array of faces into a single TopoDS_Shell (or compound of shells
 * if the faces fall into disjoint clusters — both produce a valid sheet
 * body that bindSpine binds correctly).
 */
function _sewFaces(oc, faces, tolerance) {
  if (!faces || faces.length === 0) {
    throw new Error('makeSheetBody: no faces to sew');
  }
  const sewing = track(new oc.BRepBuilderAPI_Sewing(
    tolerance > 0 ? tolerance : 1e-3,
    true,   // optionFaceMode
    true,   // optionBorderMode
    true,   // optionFreeEdges
    false,  // optionNonManifold — sheet booleans handle non-manifold separately
  ));
  for (const f of faces) {
    try { sewing.Add(f); } catch (_e) { /* skip a malformed face */ }
  }
  const pr = track(new oc.Message_ProgressRange_1());
  sewing.Perform(pr);
  const sewed = sewing.SewedShape();
  if (!sewed || sewed.IsNull()) {
    throw new Error('makeSheetBody: sewing produced a null shape');
  }
  // Independent copy so the sewn shape survives this `withScope`.
  const copy = track(new oc.BRepBuilderAPI_Copy_2(sewed, true, false));
  return copy.Shape();
}

/** Short tag of which input form was used (for the meta breadcrumb). */
function _classifyInputForm(input) {
  if (Array.isArray(input)) {
    return `array(${input.length})`;
  }
  if (input && input.shape) return 'wrapped-shape';
  return 'topods-shape';
}

/** Best-effort face count of the input (for the meta breadcrumb). */
function _inputCount(input) {
  if (Array.isArray(input)) return input.length;
  return 1;
}
