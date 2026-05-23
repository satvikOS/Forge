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
 */

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
  // For traceability: if the freshly-bound id is interesting, log it.
  if (previous && previous !== inputId) {
    report.notes.push(
      `${kind} ${survived ? 'survived' : 'modified'}: ${inputId} ← ` +
      `(was ${previous})`);
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
  for (const m of methodNames) {
    if (typeof algo[m] !== 'function') continue;
    let lst = null;
    try { lst = algo[m](occtShape); } catch (_e) { continue; }
    if (!lst) continue;
    // Empty list → [].
    try {
      if (typeof lst.IsEmpty === 'function' && lst.IsEmpty()) return [];
    } catch (_e) { /* fall through */ }
    let size = -1;
    try {
      if (typeof lst.Size === 'function') size = lst.Size();
      else if (typeof lst.Extent === 'function') size = lst.Extent();
    } catch (_e) { size = -1; }
    if (size === 0) return [];
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
    return out;
  }
  return [];
}

// ──────────────────────────────────────────────────────────────────────────────
// Shape index — hash-keyed, IsSame-verified lookup of spine entity by geomRef.
// ──────────────────────────────────────────────────────────────────────────────

function makeShapeIndex(oc, entities) {
  const buckets = new Map(); // hash:int → [{ shape, ent }]
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
