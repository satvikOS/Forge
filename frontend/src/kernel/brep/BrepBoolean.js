/**
 * ArchDisc Kernel — exact boolean operations.
 *
 * SP-1 S3 — booleans are now spine-aware. `fuse/cut/common`:
 *   1. Run the engine boolean (BRepAlgoAPI_* — unchanged geometry).
 *   2. Bind the result shape to a spine `Body` via `bindSpine`.
 *   3. Carry-through every input face/edge/vertex's `persistentId` onto the
 *      corresponding result entity using OCCT's `Modified`/`Generated`/
 *      `IsDeleted` history (the Parasolid PK_TOPOL_track_t contract).
 *   4. Wrap in a `SpineBody`.
 *
 * Input contract: each operand `a`/`b` may be a `SpineBody` (the new currency)
 * or a legacy `BrepShape` (still emitted by S4-pending ops in the mixed-
 * currency interim). When operands are SpineBodies their input persistent IDs
 * carry through; when they are raw BrepShapes the result still spines and
 * validates correctly but the lineage map has no input ids to carry — the
 * result entities receive freshly-allocated ids from bindSpine. This is
 * exactly the SP-1 §5 mixed-currency adapter: ALL combinations work.
 *
 * Verified API (docs/superpowers/notes/kernel-api-A1.md items 5-7):
 * the BRepAlgoAPI_*_3 constructor takes (shape1, shape2, progressRange),
 * and an explicit .Build(progressRange) call is required.
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';
import { carryLineage } from '../topology/IdLineage.js';
import { recordBodyDerive } from '../history/HistoryLog.js';

/**
 * Shared boolean runner. `Ctor` is a kernel BRepAlgoAPI_*_3 class.
 * Both operands accepted as SpineBody or BrepShape (`.shape` getter handles both).
 *
 * SP-3b: `bodyTag` overrides the auto-generated tag — used by the replay
 * `rebuild` thunk so the rebuilt result's persistent id matches the
 * originally-built one.
 *
 * @returns {Promise<SpineBody>}  result wrapped in the SP-1 SpineBody currency.
 */
async function runBoolean(opName, Ctor, a, b, bodyTag) {
  if (!a || !a.shape || !b || !b.shape) {
    throw new Error(`${opName}: both operands must expose a live .shape`);
  }
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new Ctor(
      a.shape, b.shape, track(new oc.Message_ProgressRange_1())));
    // SP-1 S3 — ensure OCCT keeps history maps so we can call Modified/
    // Generated/IsDeleted after Build. Per OCCT refman the algo records history
    // by default but SetToFillHistory(true) is the contractual hook; calling it
    // makes the dependency explicit. Bindings.js lists it on BRepAlgoAPI_*.
    try {
      if (typeof maker.SetToFillHistory === 'function') maker.SetToFillHistory(true);
    } catch (_e) { /* fall through — default is on */ }
    maker.Build(track(new oc.Message_ProgressRange_1()));
    if (!maker.IsDone()) throw new Error(`${opName}: kernel boolean did not complete`);
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error(`${opName}: kernel produced a null shape`);
    const parents = [a.id, b.id].filter(Boolean);
    const meta = { op: opName, parents };
    const wrapper = new BrepShape(shape, meta);
    // Bind the spine — freshly allocated persistent ids for the moment.
    // S5: the result of a solid-solid boolean is itself a solid (the algo's
    // closure invariant; degenerate "boolean produces sheet/empty" cases
    // surface as a kindMismatch diagnostic from the topology-derived kind).
    const resultBody = bindSpine(oc, shape, {
      bodyTag: bodyTag || `${opName}-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind: 'solid',
    });
    // Carry the inputs' persistent ids through the boolean. SpineBody operands
    // contribute their spine bodies; legacy BrepShape operands have no spine to
    // contribute and are skipped (mixed-currency interim).
    const inputs = [];
    if (a.body) inputs.push({ body: a.body, role: 'arg' });
    if (b.body) inputs.push({ body: b.body, role: 'tool' });
    if (inputs.length > 0) {
      const lineage = carryLineage(oc, maker, resultBody, inputs);
      meta.lineage = {
        survived: lineage.survived, modified: lineage.modified,
        generated: lineage.generated, deleted: lineage.deleted,
        conflicts: lineage.conflicts,
        // Compact face id map — useful for e2e assertions; trimmed to keep
        // meta lightweight.
        faceMap: [...lineage.faceMap.entries()].slice(0, 64),
      };
    }
    return new SpineBody(resultBody, wrapper, meta);
  });
}

/**
 * Record a boolean op's SP-3b history delta. The forward thunk re-runs the
 * SAME boolean against the live re-created inputs (looked up by their
 * persistent ids from the registry); the inverse removes the result.
 *
 * Dependency model (DOCUMENTED) — "inverse = remove result". The inputs
 * are NOT re-created by the inverse; the caller rolls back further to undo
 * input-consumption (the input ops' forward deltas then replay them). This
 * matches the SP-3a/Parasolid contract — a single linear cursor over
 * forward/inverse pairs.
 */
function recordBooleanDelta(opName, runFn, a, b, result) {
  const persistentBodyId = result.body && result.body.persistentId;
  if (!persistentBodyId) return;
  const aPid = a && a.body && a.body.persistentId;
  const bPid = b && b.body && b.body.persistentId;
  if (!aPid || !bPid) return; // legacy BrepShape inputs — no replay possible
  try {
    recordBodyDerive({
      opName,
      persistentBodyId,
      inputPersistentIds: [aPid, bPid],
      meta: { op: opName, parents: [a.id, b.id].filter(Boolean) },
      rebuild: ([liveA, liveB]) => runFn(liveA, liveB, persistentBodyId),
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`${opName}: history recordBodyDerive failed —`, err && err.message || err);
  }
}

/** Union of two solids (a ∪ b). */
export async function fuse(a, b) {
  const oc = await getOCCT();
  const result = await runBoolean('fuse', oc.BRepAlgoAPI_Fuse_3, a, b);
  recordBooleanDelta('fuse',
    async (la, lb, tag) => runBoolean('fuse', oc.BRepAlgoAPI_Fuse_3, la, lb, tag),
    a, b, result);
  return result;
}

/** Subtraction (a − b). */
export async function cut(a, b) {
  const oc = await getOCCT();
  const result = await runBoolean('cut', oc.BRepAlgoAPI_Cut_3, a, b);
  recordBooleanDelta('cut',
    async (la, lb, tag) => runBoolean('cut', oc.BRepAlgoAPI_Cut_3, la, lb, tag),
    a, b, result);
  return result;
}

/** Intersection (a ∩ b). */
export async function common(a, b) {
  const oc = await getOCCT();
  const result = await runBoolean('common', oc.BRepAlgoAPI_Common_3, a, b);
  recordBooleanDelta('common',
    async (la, lb, tag) => runBoolean('common', oc.BRepAlgoAPI_Common_3, la, lb, tag),
    a, b, result);
  return result;
}
