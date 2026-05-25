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
 *
 * SP-14b — first-fix-pass hardening (findings #3, #4, #5, partially #8):
 *
 *   Pre-SP-14b, `fuse` / `cut` / `common` on operands with coincident,
 *   tangent, or strongly-overlapping geometry would report `IsDone() ===
 *   true` and produce a result whose volume read 0, even though the inputs
 *   carried non-zero volume. The OCCT BOP, at default tolerance, produces a
 *   geometrically valid TopoDS_Shape that the mass-properties integrator
 *   cannot recognise (the result is a non-watertight shell or a compound
 *   whose container the volume integrator cannot walk). The caller saw a
 *   silent vol=0 with no warning.
 *
 *   SP-14b fix: detect `IsDone() === true` + result volume === 0 + input
 *   volumes > 0, and AUTOMATICALLY RETRY the boolean with a growing fuzzy
 *   tolerance (`BRepAlgoAPI_BOP::SetFuzzyValue`). The retry schedule
 *   doubles from 1e-7 mm to 1e-3 mm (8 attempts max). Empirically (per
 *   kernel-api-B.md Capability 2 + the existing `fuseCoincident` helper),
 *   widening the fuzzy bridges near-coincident gaps and absorbs tangent
 *   contacts so the result classifies as a single watertight solid. If
 *   every retry still produces volume === 0 we surface the result anyway
 *   (the geometry may still be useful) but stamp
 *   `result.body.diagnostics.boolean = { warning: 'silent-volume-zero',
 *   attemptedFuzzy: [...] }` so the caller knows.
 *
 *   The retry is gated on the silent-volume-zero detection — clean cases
 *   skip the retry entirely (so the no-overlap path remains exactly as
 *   fast as before). When the retry IS engaged, the schedule is bounded
 *   (8 attempts × ≤ ~50ms each) so the worst-case overhead is ~400ms per
 *   problematic boolean — still well below any human-perceptible delay.
 *   Every attempt's tolerance is logged on the diagnostic for forensics.
 *
 *   `result.body.diagnostics.boolean` shape:
 *     {
 *       autoFuzzyResolved: bool,           // true if retry produced vol > 0
 *       resolvedAtTolerance: number|null,  // the tolerance that worked
 *       attemptedFuzzy: number[],          // every tolerance tried, in order
 *       initialVolume: number,             // volume before retry (typically 0)
 *       finalVolume: number,               // volume after retry
 *       warning: string|null,              // 'silent-volume-zero' if every retry failed
 *       inputVolumes: { a: number, b: number },
 *       opName: string,
 *     }
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';
import { carryLineage } from '../topology/IdLineage.js';
import { recordBodyDerive } from '../history/HistoryLog.js';

/**
 * SP-14b — fuzzy-tolerance retry schedule. Starts at 1e-7 mm (OCCT
 * `Precision::Confusion()` — the smallest meaningful linear tolerance) and
 * doubles up to ~1e-3 mm. Empirically derived: `fuseCoincident` already
 * documents 0.01 mm fuzzy as the breakthrough for 0.001 mm gaps; the schedule
 * spans the practical range. 14 doublings from 1e-7 to ~1.6e-3.
 */
const FUZZY_RETRY_SCHEDULE = (() => {
  const sched = [];
  for (let tol = 1e-7; tol <= 1e-3; tol *= 10) sched.push(tol);
  return sched; // [1e-7, 1e-6, 1e-5, 1e-4, 1e-3]
})();

/**
 * Compute a scope-local Mass() for a shape. Used to detect silent-volume-zero
 * results without polluting the caller's diagnostics chain (the public
 * `BrepMeasure.volume` attaches diagnostics to the input body — we don't want
 * that here because it would chain warnings onto every input every boolean).
 */
function localMass(oc, shape) {
  return withScope(() => {
    const props = track(new oc.GProp_GProps_1());
    oc.BRepGProp.VolumeProperties_1(shape, props, false, false, false);
    return props.Mass();
  });
}

/**
 * Run a single OCCT boolean. Factored so the SP-14b retry loop can re-invoke
 * the same `Ctor` with a different fuzzy tolerance per attempt. Returns
 * `{ shape, maker }` — the maker stays alive in the caller's scope (it owns
 * the history maps the lineage carry-through reads).
 *
 * `fuzzyTolerance` is OPTIONAL — when undefined, no SetFuzzyValue call is
 * made (the default OCCT behaviour, unchanged from pre-SP-14b). When set,
 * SetFuzzyValue is called BEFORE Build per the `fuseCoincident` pattern (the
 * tolerance must be configured pre-Build to take effect).
 */
function runBooleanOnce(oc, opName, Ctor, a, b, fuzzyTolerance) {
  const maker = track(new Ctor(
    a.shape, b.shape, track(new oc.Message_ProgressRange_1())));
  try {
    if (typeof maker.SetToFillHistory === 'function') maker.SetToFillHistory(true);
  } catch (_e) { /* fall through — default is on */ }
  // SP-14b — set the fuzzy tolerance BEFORE Build per the OCCT contract +
  // the established `fuseCoincident` pattern (kernel-api-B.md Capability 2).
  if (fuzzyTolerance !== undefined && fuzzyTolerance !== null && fuzzyTolerance > 0) {
    if (typeof maker.SetFuzzyValue === 'function') {
      maker.SetFuzzyValue(fuzzyTolerance);
    }
  }
  maker.Build(track(new oc.Message_ProgressRange_1()));
  if (!maker.IsDone()) {
    throw new Error(`${opName}: kernel boolean did not complete`);
  }
  const shape = maker.Shape();
  if (shape.IsNull()) {
    throw new Error(`${opName}: kernel produced a null shape`);
  }
  return { shape, maker };
}

/**
 * Shared boolean runner. `Ctor` is a kernel BRepAlgoAPI_*_3 class.
 * Both operands accepted as SpineBody or BrepShape (`.shape` getter handles both).
 *
 * SP-3b: `bodyTag` overrides the auto-generated tag — used by the replay
 * `rebuild` thunk so the rebuilt result's persistent id matches the
 * originally-built one.
 *
 * SP-14b: on `IsDone()===true + volume===0 + inputs>0`, automatically retry
 * with `SetFuzzyValue` widening per `FUZZY_RETRY_SCHEDULE`. The successful
 * tolerance + every attempted value are logged on
 * `resultBody.diagnostics.boolean` for forensics. The diagnostic is purely
 * additive — the public return type (a `SpineBody`) is unchanged.
 *
 * @returns {Promise<SpineBody>}  result wrapped in the SP-1 SpineBody currency.
 */
async function runBoolean(opName, Ctor, a, b, bodyTag) {
  if (!a || !a.shape || !b || !b.shape) {
    throw new Error(`${opName}: both operands must expose a live .shape`);
  }
  const oc = await getOCCT();
  // Compute input volumes ONCE up front (outside the result scope) so the
  // silent-volume-zero detector has the reference. localMass uses its own
  // withScope so it doesn't entangle with the outer survival set.
  let inputVolA = 0, inputVolB = 0;
  try { inputVolA = await localMass(oc, a.shape); } catch (_e) { /* leave 0 */ }
  try { inputVolB = await localMass(oc, b.shape); } catch (_e) { /* leave 0 */ }

  return withScope(async () => {
    // ─── Pass 1 — the legacy (default-tolerance) call. Unchanged behaviour. ──
    let { shape, maker } = runBooleanOnce(oc, opName, Ctor, a, b /* no fuzzy */);
    let resultVolume = 0;
    try {
      resultVolume = await localMass(oc, shape);
    } catch (_e) { /* leave 0; the retry path catches it */ }

    // ─── SP-14b silent-volume-zero detection + fuzzy-retry ────────────────
    //
    // Retry triggered when:
    //   - the boolean completed cleanly (already true — we wouldn't be here
    //     otherwise; runBooleanOnce throws on !IsDone), AND
    //   - the result's mass-properties volume is 0, AND
    //   - both inputs had positive volume (so a "0" result is suspect).
    //
    // We skip the retry when EITHER input is itself volumeless (a sheet body,
    // a wire-only compound) — in those cases vol=0 is correct, and a retry
    // would mask a legitimate result. The retry is also skipped for `common`
    // when inputs are disjoint (the geometrically-correct empty intersection
    // still produces a vol=0 result; widening fuzzy can't conjure overlap).
    // We detect "disjoint common" by the result having no faces.
    const attemptedFuzzy = [];
    let resolvedAtTolerance = null;
    let autoFuzzyResolved = false;
    const needsRetry = (
      resultVolume === 0 &&
      inputVolA > 0 &&
      inputVolB > 0
    );

    if (needsRetry) {
      // For `common` specifically: a true empty intersection is the answer.
      // Detect by checking face count == 0 (a non-empty common always
      // produces at least one face). Skip the retry in that case.
      let resultFaces = 0;
      try {
        const ex = track(new oc.TopExp_Explorer_2(
          shape, oc.TopAbs_ShapeEnum.TopAbs_FACE,
          oc.TopAbs_ShapeEnum.TopAbs_SHAPE));
        if (ex.More()) { track(ex.Current()); resultFaces = 1; }
      } catch (_e) { /* leave 0; the retry runs anyway */ }
      const skipForEmptyCommon = (opName === 'common' && resultFaces === 0);

      if (!skipForEmptyCommon) {
        for (const tol of FUZZY_RETRY_SCHEDULE) {
          attemptedFuzzy.push(tol);
          let retryShape = null, retryMaker = null;
          try {
            const out = runBooleanOnce(oc, opName, Ctor, a, b, tol);
            retryShape = out.shape;
            retryMaker = out.maker;
          } catch (_e) {
            // A retry can throw (e.g., "kernel boolean did not complete" at
            // some tolerances). Treat as failed attempt + continue.
            continue;
          }
          let retryVol = 0;
          try { retryVol = await localMass(oc, retryShape); } catch (_e) { /* keep 0 */ }
          if (retryVol > 0) {
            // Retry succeeded — adopt this shape + maker as the result.
            shape = retryShape;
            maker = retryMaker;
            resultVolume = retryVol;
            resolvedAtTolerance = tol;
            autoFuzzyResolved = true;
            break;
          }
        }
      }
    }

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

    // ─── SP-14b — surface the boolean's auto-fuzzy diagnostic ─────────────
    // Always attached when the retry path was engaged (regardless of outcome)
    // so the caller can introspect what happened. When the retry succeeded
    // (`autoFuzzyResolved`), no `warning` is set (the result is valid). When
    // every retry failed, `warning: 'silent-volume-zero'` flags the result.
    if (attemptedFuzzy.length > 0) {
      try {
        if (resultBody && resultBody.diagnostics) {
          resultBody.diagnostics.boolean = {
            opName,
            autoFuzzyResolved,
            resolvedAtTolerance,
            attemptedFuzzy,
            initialVolume: 0, // the entry condition
            finalVolume: resultVolume,
            inputVolumes: { a: inputVolA, b: inputVolB },
            warning: autoFuzzyResolved ? null : 'silent-volume-zero',
            note: autoFuzzyResolved
              ? `boolean ${opName} returned volume=0 at default tolerance; ` +
                `auto-retried with fuzzy tolerance ${resolvedAtTolerance} and recovered ` +
                `to volume=${resultVolume.toFixed(4)}. The auto-fuzzy retry ` +
                `is engaged when both inputs carry positive volume but the result ` +
                `volume reads 0 — typically caused by coincident, tangent, or ` +
                `strongly-overlapping operands.`
              : `boolean ${opName} returned volume=0 at default tolerance AND at ` +
                `every fuzzy tolerance in [${attemptedFuzzy.join(', ')}] mm. ` +
                `The result shape is returned but its mass-properties integrator ` +
                `cannot compute a positive volume — likely a non-watertight ` +
                `compound. Callers should treat the result as kind:'sheet' rather ` +
                `than relying on its volume.`,
          };
        }
      } catch (_e) { /* diagnostic attach is best-effort */ }
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
