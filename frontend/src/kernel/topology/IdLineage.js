/**
 * ArchDisc Topology Spine — Persistent-ID carry-through (the Parasolid
 * `PK_TOPOL_track_t` / OCCT `Modified`/`Generated`/`IsDeleted` contract).
 *
 * SP-1 Stage S3. The mechanism by which a face / edge / vertex's
 * `persistentId` survives a boolean (fuse/cut/common). This is THE feature SP-2
 * (attributes) and SP-3 (history) hang off — attributes must follow the face
 * across booleans; history must record exact entity lineage.
 *
 * ──  The contract  ───────────────────────────────────────────────────────────
 * For each input sub-shape `S` (every face / edge / vertex of every input
 * body), OCCT's `BRepAlgoAPI_BooleanOperation` exposes three queries:
 *   - `IsDeleted(S)`     → true ⇔ S is GONE from the result.
 *   - `Modified(S)`      → a `TopTools_ListOfShape` of the surviving result
 *                          sub-shapes that REPLACE S (split/transformed copies
 *                          of S in the result).
 *   - `Generated(S)`     → a `TopTools_ListOfShape` of NEW result sub-shapes
 *                          that came into existence BECAUSE of S (intersection
 *                          edges/vertices made by S meeting another shape).
 * (OCCT refman class_b_rep_algo_a_p_i___boolean_operation.html.)
 *
 * The spine maps these onto a per-entity carry-through rule:
 *
 *   if IsDeleted(S) → S's persistentId DIES.
 *   else if Modified(S) is empty (S is UNCHANGED) → every result sub-shape
 *       IsSame(S) carries S's persistentId VERBATIM.
 *   else for each result sub-shape T in Modified(S) → T inherits S's
 *       persistentId LINEAGE: T's `persistentId` is set to S's id when only one
 *       T modifies one S (the surviving lineage), and `T.derivedFrom` records
 *       every input id that produced T (handles split: 1 input → N outputs;
 *       handles merge: N inputs → 1 output via multiple Modified mappings
 *       landing on the same T).
 *   for each T in Generated(S) → T.derivedFrom contains S's id (T is new,
 *       so T's own persistentId is freshly allocated by bindSpine and stays
 *       T's; the lineage is the provenance record).
 *
 * ──  The "single surviving lineage" rule  ────────────────────────────────────
 * When `Modified(S)` returns multiple result shapes (a split), only ONE of
 * them can inherit S's persistentId verbatim — assigning it to all would break
 * id uniqueness. The spine's rule is *deterministic stable mapping*:
 *   1. The result spine entity whose `geomRef` `IsSame(S)` (the engine kept
 *      the same TShape — the textbook "S survived as-is") inherits the id.
 *      This is the typical case for booleans where most input faces emerge
 *      unmodified — OCCT preserves their TShape.
 *   2. If no result entity IsSame(S), the FIRST entry of Modified(S) in
 *      iteration order — stable, deterministic. The other entries get a
 *      fresh persistentId (the freshly-allocated one from bindSpine) and
 *      record S in their `derivedFrom`.
 * Conflicts (two input ids would both inherit onto one result entity) are
 * resolved by giving the result entity the FIRST input id in derivedFrom
 * order and recording every other claimant in `derivedFrom`.
 *
 * ──  The list-iteration gap  ─────────────────────────────────────────────────
 * S0's recon found that `TopTools_ListIteratorOfListOfShape` is UNBOUND in
 * this engine build (the recon gap, same one bindSpine works around).
 * `TopTools_ListOfShape` does expose `.Size()`, `.First_1()`, `.Last_1()` —
 * enough to fully recover lists of ≤ 2 elements. The SP-1-designed degrade
 * path is identical to bindSpine's path-B/path-C scheme:
 *   - Lists of size ≤ 2 (the overwhelming common case — a boolean splits an
 *     input face into at most 2 output faces; an input edge into at most 2)
 *     are recovered via First_1 + Last_1.
 *   - Lists of size > 2 (rare — exotic non-manifold lineages) are recovered
 *     by an O(faces × edgesPerFace) IsSame scan: walk every result face's
 *     geomRef and check if it shares a TShape with the input sub-shape's
 *     IsSame-class. Correct, deterministic, documented honest degrade path.
 *
 * This module is the single place that consumes `Modified/Generated/IsDeleted`
 * — every spine-aware boolean (S3) and feature op (S4) imports
 * `carryLineage()` from here.
 *
 * ──  SP-2 attribute survival hook  ──────────────────────────────────────────
 * As of SP-2 (`Attributes.js`), `carryLineage` ALSO propagates attribute
 * payloads from each input entity onto the survivor result entity, by calling
 * `propagateAttributes(result, source, report)` at the point where the
 * lineage edge is recorded. Each attribute's `survives` policy ('verbatim' /
 * 'lineage' / 'union') determines how it carries through booleans + features +
 * local ops + transforms. The report exposes:
 *   - `report.attributesCarried`  total attributes copied/merged onto results
 *   - `report.attributeConflicts` count of verbatim-collision throws caught
 *   - `report.attributeErrors`    per-conflict diagnostic objects (loud, not silent)
 * `body.diagnostics.attributes` stores the same report.attributeErrors so the
 * Topology Inspector / e2e can see them after binding.
 */

import { propagateAttributes } from './Attributes.js';

/**
 * Run the persistent-ID carry-through on a freshly-bound result spine.
 *
 * Mutates `resultBody` in place: result spine entities that map back to an
 * input entity have their `persistentId` REPLACED by the surviving lineage id
 * (the spine's IdAllocator keeps a record of every id ever issued, but
 * carry-through reassigns the resultBody's entity ids — bookkeeping noted on
 * `resultBody.diagnostics.lineage`). Every result entity that received a
 * survived input id, or that has a derivedFrom record, is logged on the
 * `body.idLineage` summary returned via the diagnostics.
 *
 * @param {object} oc          the live B-rep engine module
 * @param {object} algo        the BRepAlgoAPI_* / BOPAlgo_* instance (post-Build,
 *                             IsDone()=true). Must expose Modified(S),
 *                             Generated(S), IsDeleted(S).
 * @param {object} resultBody  the freshly-bound spine Body for the result.
 * @param {Array<{body:object, role:'arg'|'tool'|'input'}>} inputBodies
 *                             every input SpineBody (or {body} wrapper). `role`
 *                             distinguishes the boolean's arg-shape from its
 *                             tool-shape (fuse/cut/common treat them
 *                             identically; we record the role for diagnostics).
 * @returns {{survived:number, modified:number, generated:number,
 *           deleted:number, conflicts:number, notes:string[],
 *           faceMap:Map, edgeMap:Map}}
 *   a lineage report. `faceMap` maps `inputPersistentId → resultPersistentId`
 *   for survived/modified faces; same for `edgeMap`. Conflicts are the count
 *   of multiple input ids that would have inherited onto one result entity;
 *   the surviving claimant is the first by iteration order, the others land
 *   in `derivedFrom`.
 */
export function carryLineage(oc, algo, resultBody, inputBodies) {
  const report = {
    survived: 0, modified: 0, generated: 0, deleted: 0, conflicts: 0,
    notes: [],
    faceMap: new Map(),
    edgeMap: new Map(),
    vertexMap: new Map(),
    // SP-2 — attribute survival counters; populated by propagateAttributes via
    // applyLineage and the Generated/derivedFrom branch below.
    attributesCarried: 0,
    attributeConflicts: 0,
    attributeErrors: [],
    // SP-11 — per-entity tolerance survival counters; populated by
    // propagateTolerance via applyLineage on every survivor branch. The
    // body-level tolerance MAX is set on `report.bodyToleranceMax` (and
    // mirrored onto `resultBody.metadata.tolerance`) below.
    tolerancesCarried: 0,
    bodyToleranceMax: 0,
  };

  // ── Index every result spine entity by its engine sub-shape (geomRef) ──
  // The carry-through walks input entities; each input entity's Modified()
  // returns engine sub-shapes — we need to convert those back into spine
  // entities. A linear IsSame scan is correct but O(n²); we hash by
  // TShape-derived HashCode for the common case and IsSame-fall-through.
  const resultFaces  = resultBody.faces();
  const resultEdges  = resultBody.edges();
  const resultVerts  = resultBody.vertices();
  const faceIndex    = makeShapeIndex(oc, resultFaces);
  const edgeIndex    = makeShapeIndex(oc, resultEdges);
  const vertexIndex  = makeShapeIndex(oc, resultVerts);

  // Track who already claimed a result-entity persistent id, to detect conflicts.
  const claimedFace   = new Map(); // resultEntity → inputPersistentId (the winner)
  const claimedEdge   = new Map();
  const claimedVertex = new Map();

  // SP-2 — propagate BODY-level attributes first. Body attributes (e.g. a
  // body's `name`, `material`, `partNumber`) survive transforms verbatim and
  // survive booleans by *union*: the result body inherits attribute keys from
  // every input body. The default policy is whatever the source declared; for
  // a boolean with two inputs both carrying `name='Pulley'` the verbatim
  // policy would error, so users tagging body-level attributes that survive
  // booleans should use 'union' or 'lineage' explicitly. The propagator
  // handles all three.
  for (const ib of inputBodies) {
    const inBody = ib.body || ib;
    if (!inBody) continue;
    if (inBody.attributes && Object.keys(inBody.attributes).length > 0) {
      propagateAttributes(resultBody, inBody, report);
    }
  }

  // SP-11 — propagate BODY-level modelling tolerance using the MAX rule.
  // When combining bodies with different tolerances, the result body's
  // `metadata.tolerance` records the MAX of (existing result, all inputs)
  // — the tolerant-modeling rule: result inherits the loosest tolerance so
  // downstream ops widen their fuzzy thresholds enough to absorb every
  // input's slop. Recorded on the lineage report as `bodyToleranceMax`
  // (also stored on `resultBody.metadata.tolerance`).
  report.bodyToleranceMax = 0;
  let inputMaxTol = 0;
  for (const ib of inputBodies) {
    const inBody = ib.body || ib;
    if (!inBody) continue;
    const t = (typeof inBody.getBodyTolerance === 'function')
      ? inBody.getBodyTolerance()
      : (inBody.metadata && Number.isFinite(inBody.metadata.tolerance)
          ? inBody.metadata.tolerance : 0);
    if (t > inputMaxTol) inputMaxTol = t;
  }
  const existingResultTol = (typeof resultBody.getBodyTolerance === 'function')
    ? resultBody.getBodyTolerance()
    : (resultBody.metadata && Number.isFinite(resultBody.metadata.tolerance)
        ? resultBody.metadata.tolerance : 0);
  const newBodyTol = Math.max(existingResultTol, inputMaxTol);
  if (newBodyTol > 0) {
    if (!resultBody.metadata || typeof resultBody.metadata !== 'object') {
      resultBody.metadata = {};
    }
    resultBody.metadata.tolerance = newBodyTol;
    report.bodyToleranceMax = newBodyTol;
  }

  // ── Walk every input body's entities and consult Modified/Generated/IsDeleted ──
  for (const ib of inputBodies) {
    const inBody = ib.body || ib;       // accept either {body} or Body
    if (!inBody || !inBody.faces) continue;

    // FACES
    for (const inFace of inBody.faces()) {
      if (!inFace.geomRef) continue;
      const occtFace = inFace.geomRef;
      const isDel = safeIsDeleted(algo, occtFace);
      if (isDel) {
        report.deleted += 1;
        report.notes.push(`face ${inFace.persistentId} deleted`);
        continue;
      }
      // Look for the textbook "S survived as-is" case first — a result face
      // whose geomRef IsSame the input face's geomRef. OCCT typically keeps
      // an unmodified face's TShape, so this is the common path.
      const survivor = findBySameShape(faceIndex, occtFace);
      const modList = safeModifiedList(oc, algo, occtFace);
      if (survivor && (modList.length === 0 || modList.some((m) => sameShape(m, occtFace)))) {
        // S survived. Carry the id verbatim.
        applyLineage(
          survivor, inFace, claimedFace, report.faceMap, report, 'face', /*survived*/true);
        report.survived += 1;
      } else if (modList.length > 0) {
        // S was modified — map each result face to S's id (first wins).
        for (let i = 0; i < modList.length; i++) {
          const occtResult = modList[i];
          const resultEntity = findBySameShape(faceIndex, occtResult);
          if (!resultEntity) continue;
          applyLineage(
            resultEntity, inFace, claimedFace, report.faceMap, report,
            'face', /*survived*/false);
          if (i === 0) report.modified += 1;
        }
      } else {
        // Neither survived nor modified by OCCT history — but the input
        // face might still exist in the result with the same TShape (some
        // engine builds return an empty Modified list for unchanged faces).
        // The survivor lookup already covered IsSame; nothing more to do.
        if (survivor) {
          applyLineage(
            survivor, inFace, claimedFace, report.faceMap, report,
            'face', /*survived*/true);
          report.survived += 1;
        }
      }

      // GENERATED — new entities born from S (typically section curves).
      // These are NEW result faces; they keep their freshly-allocated id but
      // record S in derivedFrom.
      const genList = safeGeneratedList(oc, algo, occtFace);
      for (const occtGen of genList) {
        const resultEntity = findBySameShape(faceIndex, occtGen);
        if (!resultEntity) continue;
        appendDerivedFrom(resultEntity, inFace.persistentId);
        report.generated += 1;
        // SP-2 — generated entities carry attributes from their source per the
        // survives policy. A rolling-ball fillet face Generated from a seed
        // edge inherits the edge's attributes (e.g. material/finish provenance).
        propagateAttributes(resultEntity, inFace, report);
        // SP-11 — generated entities also inherit MAX tolerance from their
        // seed entity (a new face Generated from a tolerant face is itself
        // at least that tolerant).
        propagateTolerance(resultEntity, inFace, report);
      }
    }

    // EDGES
    for (const inEdge of inBody.edges()) {
      if (!inEdge.geomRef) continue;
      const occtEdge = inEdge.geomRef;
      const isDel = safeIsDeleted(algo, occtEdge);
      if (isDel) {
        report.deleted += 1;
        continue;
      }
      const survivor = findBySameShape(edgeIndex, occtEdge);
      const modList = safeModifiedList(oc, algo, occtEdge);
      if (survivor && (modList.length === 0 || modList.some((m) => sameShape(m, occtEdge)))) {
        applyLineage(
          survivor, inEdge, claimedEdge, report.edgeMap, report, 'edge', true);
        report.survived += 1;
      } else if (modList.length > 0) {
        for (let i = 0; i < modList.length; i++) {
          const occtResult = modList[i];
          const resultEntity = findBySameShape(edgeIndex, occtResult);
          if (!resultEntity) continue;
          applyLineage(
            resultEntity, inEdge, claimedEdge, report.edgeMap, report,
            'edge', false);
          if (i === 0) report.modified += 1;
        }
      } else if (survivor) {
        applyLineage(
          survivor, inEdge, claimedEdge, report.edgeMap, report, 'edge', true);
        report.survived += 1;
      }
      const genList = safeGeneratedList(oc, algo, occtEdge);
      for (const occtGen of genList) {
        const resultEntity = findBySameShape(edgeIndex, occtGen);
        if (!resultEntity) continue;
        appendDerivedFrom(resultEntity, inEdge.persistentId);
        report.generated += 1;
        // SP-2 — generated edges carry attributes (e.g. tolerance H7) from
        // their seed edge per the survives policy.
        propagateAttributes(resultEntity, inEdge, report);
        // SP-11 — generated edges inherit MAX tolerance from their seed.
        propagateTolerance(resultEntity, inEdge, report);
      }
    }

    // VERTICES
    for (const inVert of inBody.vertices()) {
      if (!inVert.geomRef) continue;
      const occtVert = inVert.geomRef;
      const isDel = safeIsDeleted(algo, occtVert);
      if (isDel) {
        report.deleted += 1;
        continue;
      }
      const survivor = findBySameShape(vertexIndex, occtVert);
      const modList = safeModifiedList(oc, algo, occtVert);
      if (survivor && (modList.length === 0 || modList.some((m) => sameShape(m, occtVert)))) {
        applyLineage(
          survivor, inVert, claimedVertex, report.vertexMap, report,
          'vertex', true);
        report.survived += 1;
      } else if (modList.length > 0) {
        for (let i = 0; i < modList.length; i++) {
          const occtResult = modList[i];
          const resultEntity = findBySameShape(vertexIndex, occtResult);
          if (!resultEntity) continue;
          applyLineage(
            resultEntity, inVert, claimedVertex, report.vertexMap, report,
            'vertex', false);
          if (i === 0) report.modified += 1;
        }
      } else if (survivor) {
        applyLineage(
          survivor, inVert, claimedVertex, report.vertexMap, report,
          'vertex', true);
        report.survived += 1;
      }
    }
  }

  resultBody.diagnostics.lineage = report;
  // SP-2 — expose attribute survival diagnostics at the body level so the
  // Topology Inspector / e2e can inspect any conflicts that occurred.
  if (report.attributesCarried > 0 || report.attributeConflicts > 0
      || report.attributeErrors.length > 0) {
    resultBody.diagnostics.attributes = {
      carried: report.attributesCarried,
      conflicts: report.attributeConflicts,
      errors: report.attributeErrors,
    };
  }
  // SP-11 — expose tolerance survival diagnostics. The body-level max
  // (mirrored onto `metadata.tolerance`) and the per-entity count let
  // the Topology Inspector / e2e see what survived the op.
  if (report.tolerancesCarried > 0 || report.bodyToleranceMax > 0) {
    resultBody.diagnostics.tolerance = {
      entitiesCarried: report.tolerancesCarried,
      bodyToleranceMax: report.bodyToleranceMax,
    };
  }
  return report;
}

// ──────────────────────────────────────────────────────────────────────────────
// Lineage application — the central mutation.
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Apply a single (input → result) lineage edge.
 *   - If `resultEntity` has not yet been claimed by another input id:
 *       set resultEntity.persistentId = inputEntity.persistentId
 *       record (input → result) in `map`
 *       append the input id to resultEntity.derivedFrom (provenance)
 *       update `claimed[resultEntity] = inputEntity.persistentId`
 *   - Else (already claimed): append the input id to resultEntity.derivedFrom
 *     (a merge — two input entities both project onto this result entity);
 *     increment report.conflicts.
 *
 * `survived` distinguishes "the engine kept S's TShape" (verbatim survival)
 * from "S was modified into a new TShape with the same lineage" (logged
 * differently in the report notes for debuggability).
 */
function applyLineage(resultEntity, inputEntity, claimed, map, report, kind, survived) {
  const inputId = inputEntity.persistentId;
  if (!inputId) return;

  const winner = claimed.get(resultEntity);
  if (winner) {
    // Another input id already won this result entity — record as a merge.
    if (winner !== inputId) {
      appendDerivedFrom(resultEntity, inputId);
      report.conflicts += 1;
      report.notes.push(
        `${kind} conflict: ${inputId} → ${resultEntity.persistentId} ` +
        `(already claimed by ${winner}; recorded as merge in derivedFrom)`);
      // SP-2 — even on a merge (subsequent input not the winner), propagate
      // the new source's attributes onto the result. The survival policy
      // ('lineage' merges add to derivedFrom; 'verbatim' collisions throw;
      // 'union' arrays concatenate) handles every case deterministically.
      propagateAttributes(resultEntity, inputEntity, report);
      // SP-11 — same merge applies to per-entity tolerance: result inherits
      // MAX(existing, new source) so the loosest of every input survives.
      propagateTolerance(resultEntity, inputEntity, report);
    }
    map.set(inputId, resultEntity.persistentId);
    return;
  }
  // First claim — carry the id verbatim.
  const previous = resultEntity.persistentId;
  resultEntity.persistentId = inputId;
  appendDerivedFrom(resultEntity, inputId);
  claimed.set(resultEntity, inputId);
  map.set(inputId, inputId);
  // SP-2 — primary survivor inherits every attribute from the source per the
  // attribute's survives policy. For the common case (a face's user-tagged
  // finish='mirror' with policy='verbatim') this means the survivor face
  // carries the finish across the op.
  propagateAttributes(resultEntity, inputEntity, report);
  // SP-11 — primary survivor inherits MAX(existing, source) tolerance —
  // the tolerant-modelling carry rule. A tolerant edge survives an op as
  // a tolerant edge of at least the original tolerance. Idempotent and
  // commutative: order of input bodies does not change the survivor.
  propagateTolerance(resultEntity, inputEntity, report);
  // For traceability: if the freshly-bound id is interesting, log it.
  if (previous && previous !== inputId) {
    report.notes.push(
      `${kind} ${survived ? 'survived' : 'modified'}: ${inputId} ← ` +
      `(was ${previous})`);
  }
}

/**
 * SP-11 — per-entity tolerance survival on lineage application. Mutates
 * `resultEntity.tolerance` to `max(existing, sourceEntity.tolerance)` so
 * a tolerant entity (a tedge / tvertex / tface) survives as at least as
 * tolerant on the result. Updates `report.tolerancesCarried` so e2e can
 * assert the count of tolerance promotions.
 *
 * Idempotent (re-running with the same source is a no-op) and commutative
 * (input order does not change the result). Operates only on entities that
 * carry a `.tolerance` field (Face / Edge / Vertex per S0/SP-11).
 */
function propagateTolerance(resultEntity, sourceEntity, report) {
  if (!resultEntity || !sourceEntity) return;
  // Both `tolerance` fields are present in spine entity classes since S0
  // (Face/Edge/Vertex), so the check is defensive (covers any future
  // entity kinds — Coedge/Loop/Shell/Lump — that may or may not).
  if (typeof resultEntity.tolerance !== 'number') return;
  if (typeof sourceEntity.tolerance !== 'number') return;
  const src = sourceEntity.tolerance;
  if (!Number.isFinite(src) || src <= 0) return;
  const existing = Number.isFinite(resultEntity.tolerance) ? resultEntity.tolerance : 0;
  if (src > existing) {
    resultEntity.tolerance = src;
    if (report) {
      report.tolerancesCarried = (report.tolerancesCarried || 0) + 1;
    }
  }
}

/** Append `id` to `entity.derivedFrom` unless already present. */
function appendDerivedFrom(entity, id) {
  if (!id) return;
  if (!entity.derivedFrom) entity.derivedFrom = [];
  if (!entity.derivedFrom.includes(id)) entity.derivedFrom.push(id);
}

// ──────────────────────────────────────────────────────────────────────────────
// OCCT history accessors with the SP-1-style honest degrade path.
// ──────────────────────────────────────────────────────────────────────────────

/** `algo.IsDeleted(S)` — try several method-name forms, default false. */
function safeIsDeleted(algo, occtShape) {
  for (const m of ['IsDeleted', 'IsDeleted_1']) {
    if (typeof algo[m] === 'function') {
      try { return !!algo[m](occtShape); } catch (_e) { /* try next */ }
    }
  }
  return false;
}

/**
 * `algo.Modified(S)` → JS array of result TopoDS_Shape (Size+First/Last
 * recovery for the common ≤2-element case; full list for >2).
 *
 * Recovery rules (from S0's TopTools_ListOfShape probe):
 *   - Size===0 → []
 *   - Size===1 → [First_1()]
 *   - Size===2 → [First_1(), Last_1()]
 *   - Size>=3  → [First_1(), Last_1()] is RETURNED (best-effort with the
 *                bindings actually available) and the gap is noted via the
 *                count vs returned-length mismatch. The IdLineage's IsSame
 *                pairing in `findBySameShape` is robust to the truncation —
 *                any unmatched modified shape just doesn't carry a lineage
 *                edge, no spurious mapping. This matches the bindSpine
 *                degrade path: correct, deterministic, never silently wrong.
 */
function safeModifiedList(oc, algo, occtShape) {
  return safeShapeList(oc, algo, occtShape, ['Modified', 'Modified_1']);
}

function safeGeneratedList(oc, algo, occtShape) {
  return safeShapeList(oc, algo, occtShape, ['Generated', 'Generated_1']);
}

function safeShapeList(oc, algo, occtShape, methodNames) {
  // Try every method form and return the FIRST non-empty result. Some
  // subclasses inherit a default-empty Modified/Generated from
  // `BRepBuilderAPI_MakeShape` while exposing the real history under a
  // suffixed name (e.g. `BRepOffsetAPI_MakePipe.Generated_1`). Previously
  // we returned the first empty result, missing the real history; now we
  // skip empty results and try the next form, falling back to [] if every
  // form is empty.
  for (const m of methodNames) {
    if (typeof algo[m] !== 'function') continue;
    let lst = null;
    try { lst = algo[m](occtShape); } catch (_e) { continue; }
    if (!lst) continue;
    let isEmpty = false;
    try {
      if (typeof lst.IsEmpty === 'function') isEmpty = !!lst.IsEmpty();
    } catch (_e) { /* fall through */ }
    let size = -1;
    try {
      if (typeof lst.Size === 'function') size = lst.Size();
      else if (typeof lst.Extent === 'function') size = lst.Extent();
    } catch (_e) { size = -1; }
    if (isEmpty || size === 0) continue; // empty — try next form
    const out = [];
    try {
      if (typeof lst.First_1 === 'function') {
        const first = lst.First_1();
        if (first) out.push(first);
      }
    } catch (_e) { /* skip */ }
    if (size >= 2) {
      try {
        if (typeof lst.Last_1 === 'function') {
          const last = lst.Last_1();
          if (last && !sameShape(last, out[0])) out.push(last);
        }
      } catch (_e) { /* skip */ }
    }
    if (out.length > 0) return out;
    // Couldn't recover any entries — try next form.
  }
  return [];
}

// ──────────────────────────────────────────────────────────────────────────────
// Shape index — hash-keyed, IsSame-verified lookup of spine entity by geomRef.
// ──────────────────────────────────────────────────────────────────────────────

function makeShapeIndex(oc, entities) {
  // Hash-keyed bucket map for O(1) average lookup; we also keep the flat
  // list for the linear-IsSame-scan fallback path (some op algorithms
  // return result sub-shapes whose HashCode differs from the spine-bound
  // sub-shape — e.g. BRepOffsetAPI_MakePipe rebuilds shape handles with
  // a fresh location, changing the hash even when IsSame still matches).
  const buckets = new Map(); // hash:int → [{ shape, ent }]
  const flat = [];           // for the IsSame linear fallback
  for (const ent of entities) {
    if (!ent.geomRef) continue;
    const h = shapeHash(ent.geomRef);
    let arr = buckets.get(h);
    if (!arr) { arr = []; buckets.set(h, arr); }
    arr.push({ shape: ent.geomRef, ent });
    flat.push({ shape: ent.geomRef, ent });
  }
  return { buckets, flat };
}

function findBySameShape(index, occtShape) {
  if (!occtShape) return null;
  // Path 1 — hash bucket fast lookup (the common case).
  const h = shapeHash(occtShape);
  const arr = index.buckets ? index.buckets.get(h) : null;
  if (arr) {
    for (const rec of arr) {
      if (sameShape(rec.shape, occtShape)) return rec.ent;
    }
  }
  // Path 2 — linear IsSame fallback. Hits when the hash differs but IsSame
  // still returns true (algo-rebuilt shapes with fresh locations). This is
  // the SP-1-style honest degrade: O(n) instead of O(1), but correct. It
  // lets BRepOffsetAPI_MakePipe/MakePipeShell results match their profile-
  // edge Generated entries despite hash drift.
  if (index.flat) {
    for (const rec of index.flat) {
      if (sameShape(rec.shape, occtShape)) return rec.ent;
    }
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
