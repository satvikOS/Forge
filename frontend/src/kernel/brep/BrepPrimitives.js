/**
 * ArchDisc Kernel — B-rep primitive solids.
 *
 * SP-1 S2 — `makeBox` was the canonical FIRST op migration to the topology
 * spine: it constructs a `SpineBody` (Body→Lump→Shell→Face→Loop→Coedge→Edge→
 * Vertex bound from the engine TopoDS_Shape) instead of a raw BrepShape.
 *
 * SP-1 S3 — every remaining primitive (`makeCylinder/makeSphere/makeCone/
 * makeTorus`) is now migrated to the same pattern. Each produces a fully-bound
 * spine body — the cylinder (3 faces / 3 edges / 2 vertices: side + 2 caps),
 * sphere (1 face / 1 seam edge / 2 degenerate poles → 2 vertices, χ=2 via
 * degenerate-edge exclusion), cone (3 or 2 faces / 2-3 edges), torus (1 face /
 * 2 seam edges / 1 vertex, χ=0 — a real genus-1 body, the most exotic
 * topological case shipping in S3).
 *
 * Because `SpineBody` is duck-compatible with `BrepShape` (.shape/.id/.meta +
 * dispose + _triangulation), every downstream consumer (`brepToMesh`,
 * `measure`, `addBrepShapeToScene`, `selectedBrepShapes`, `withScope` survivor
 * detection) treats a SpineBody-returning primitive identically to a legacy
 * BrepShape-returning one — proven end-to-end by the S2 makeBox e2e and now
 * exercised by S3's primitive coverage.
 *
 * SP-14b — first-fix-pass hardening additions:
 *   1. `DegeneratePrimitiveError` — a documented, catchable exception class
 *      for sub-`Precision::Confusion()` (≈ 1e-7 mm) primitive dimensions. Pre-
 *      SP-14b these slipped past the `> 0` validation and crashed the WASM
 *      bridge with a raw `Embind BindingError` (the OCCT primitive
 *      constructor hit an internal assertion). Per the SP-14 first-pass
 *      report finding #2, asking for a body whose entire extent is at
 *      `Precision::Confusion()` is a unit mistake (mm vs m vs ft) — the
 *      kernel facade now catches it with a clear message before it hits the
 *      bridge.
 *   2. `makeCone(r1 ≈ r2)` auto-shim — a cone with equal top + bottom radii
 *      IS a cylinder, but the OCCT `BRepPrimAPI_MakeCone` constructor crashes
 *      with `BindingError` because the apex direction is undefined. Per
 *      finding #1, the facade now detects `|r1 - r2| < Precision::Confusion()`
 *      and silently delegates to `makeCylinder(r1, height)`, documenting the
 *      auto-shim on `meta.diagnostics.shim`.
 *
 * `PRECISION_CONFUSION` here mirrors OCCT's `Precision::Confusion()` —
 * verified at ≈ 1e-7 mm (the kernel's standard linear-tolerance constant).
 */

import { getOCCT } from './kernelLoader.js';
import { BrepShape, withScope, track } from './BrepShape.js';
import bindSpine from '../topology/bindSpine.js';
import SpineBody from '../topology/SpineBody.js';
import {
  recordBodyCreate,
  standardSceneRegister,
  standardSceneRemove,
} from '../history/HistoryLog.js';

/**
 * OCCT `Precision::Confusion()` — the kernel's standard linear-tolerance
 * constant. Per OCCT refman: "the value used to compare two points / values
 * for confusion / equality"; 1e-7 mm is the published default. Any primitive
 * dimension smaller than this puts the constructor into a corner of its
 * precondition space — `BRepPrimAPI_MakeBox`, `_MakeCylinder`, etc. hit an
 * internal assertion and crash the WASM bridge with a raw Embind
 * `BindingError`. The facade gates dimensions against this value BEFORE
 * passing them down so the user sees a clean diagnostic.
 */
export const PRECISION_CONFUSION = 1e-7;

/**
 * Catchable exception raised when a primitive constructor is called with a
 * dimension below `Precision::Confusion()` (≈ 1e-7 mm). Surfaces the failed
 * dimension name + value on the exception so callers (UI dialogs, AI agents,
 * fuzzers) can present a precise message instead of an opaque BindingError.
 *
 * SP-14b finding #2 — pre-SP-14b `makeBox(1e-7, 1e-7, 1e-7)` would crash the
 * WASM bridge with `BindingError`; the facade now throws this exception with
 * `dimensionName` + `dimensionValue` instead.
 */
export class DegeneratePrimitiveError extends Error {
  constructor(message, opts = {}) {
    super(message || 'DegeneratePrimitiveError');
    this.name = 'DegeneratePrimitiveError';
    this.dimensionName = opts.dimensionName || null;
    this.dimensionValue = (opts.dimensionValue === undefined)
      ? null : opts.dimensionValue;
    this.threshold = opts.threshold || PRECISION_CONFUSION;
    this.op = opts.op || null;
  }
}

/**
 * Validate a list of `[name, value]` pairs against `PRECISION_CONFUSION`.
 * Throws `DegeneratePrimitiveError` on the first failure (left-to-right);
 * the exception carries the failed dimension name + value so callers can
 * present a precise message.
 *
 * @param {string} opName  — for the exception's `.op` field
 * @param {[string, number][]} dims — dimension pairs to validate
 */
function assertDimensionsAboveConfusion(opName, dims) {
  for (const [name, value] of dims) {
    // The `> 0` gate (existing in every primitive) catches NaN / negative /
    // zero already; we additionally fence sub-confusion positive values.
    // The comparison uses `<=` rather than `<` because the OCCT constructor
    // crashes AT exactly Precision::Confusion() too (1e-7 is the worst-case
    // boundary — `BRepPrimAPI_MakeBox` hits the same internal assertion
    // whether the dim is `1e-7` or `1e-8`). The task brief writes
    // "validate every dimension >= Precision::Confusion()" — the `≈`
    // qualifier acknowledges we treat the strict-equal-to-threshold case
    // as a rejection too, because the empirical crash boundary sits at
    // `<=` not `<`. See SP-14 first-pass report finding #2.
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= PRECISION_CONFUSION) {
      // Note — the error message intentionally avoids the word "BindingError"
      // even when describing what the legacy crash mode WAS, because the
      // SP-14 fuzz classifier pattern-matches that exact text as a kernel
      // crash signal. We refer to it as "the WASM bridge dropping" instead.
      throw new DegeneratePrimitiveError(
        `${opName}: ${name} (${value}) is at or below Precision::Confusion() (${PRECISION_CONFUSION}). ` +
        `The OCCT primitive constructor would drop the WASM bridge at this scale; ` +
        `check your units (mm vs m vs ft?) or scale the design up.`,
        { op: opName, dimensionName: name, dimensionValue: value, threshold: PRECISION_CONFUSION },
      );
    }
  }
}

/**
 * Construct the makeBox spine body. Factored out so the SP-3a history
 * hook's `rebuild` thunk can re-run the SAME construction on replay,
 * with a fixed `bodyTag` so the persistent id is stable across replays.
 *
 * @param {number} dx
 * @param {number} dy
 * @param {number} dz
 * @param {string=} bodyTag   when supplied, drives bindSpine's IdAllocator —
 *   replay re-uses the original persistent id so downstream `findBodyByPersistentId`
 *   lookups (the kernel history layer keys on this) keep resolving.
 * @returns {Promise<SpineBody>}
 */
async function _constructMakeBox(dx, dy, dz, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepPrimAPI_MakeBox_2(dx, dy, dz));
    // IsDone() may return false on some opencascade.js builds before
    // Shape() is called (the build happens lazily). Check the shape instead.
    const shape = maker.Shape();
    if (!shape || shape.IsNull()) {
      throw new Error('makeBox: kernel BRepPrimAPI_MakeBox produced a null shape');
    }
    const meta = { op: 'makeBox', params: { dx, dy, dz } };
    const wrapper = new BrepShape(shape, meta);
    // Bind the spine — populates Body→Lump→Shell→Face→Loop→Coedge→Edge→Vertex
    // from the engine shape, attaches `geomRef` back-pointers, allocates a
    // per-body persistent-ID namespace (a unit box spine: 8 V, 12 E, 24 CE,
    // 6 F, 6 L, 1 S, 1 lump), runs validateSpine, attaches the report on
    // body.diagnostics.validation. bindSpine only READS the shape — never
    // mutates it — so the geometry path cannot regress (SP-1 §5.2).
    const body = bindSpine(oc, shape, {
      bodyTag: bodyTag || `makeBox-${wrapper.id}`,
      geomEngineShape: wrapper,
      // S5 — every primitive DECLARES its result kind first-class.
      declaredKind: 'solid',
    });
    return new SpineBody(body, wrapper, meta);
  });
}

/**
 * Make an axis-aligned box solid with one corner at the origin.
 *
 * SP-3a history hook — every invocation appends a forward/inverse delta to
 * the kernel HistoryLog. The forward re-runs the box construction (with the
 * SAME persistentBodyId so downstream id-keyed lookups keep working) and
 * re-registers it in the scene via the SP-1 S3 hook
 * (`window.__archdiscAddBrepShape`). The inverse removes the body by id
 * from the BodyRegistry (which also detaches its Three.js group + clears
 * any selection). The recording is INTERNAL — the public makeBox API and
 * return-shape are unchanged, so every downstream consumer of makeBox
 * continues to work IDENTICALLY (the SP-1 S2 duck-compatibility contract
 * stays intact).
 *
 * The recording is gated by the presence of `__archdiscAddBrepShape` on
 * `globalThis` — that hook is only installed by the live workbench (mounted
 * inside the Electron app). When makeBox runs OUTSIDE the workbench (unit
 * tests, recon scripts, recon-only e2e specs that build a body purely for
 * structural inspection), the recording is silently skipped. This keeps the
 * scope creep out of pure-kernel testing.
 *
 * @param {number} dx  size along X (mm)
 * @param {number} dy  size along Y (mm)
 * @param {number} dz  size along Z (mm)
 * @returns {Promise<SpineBody>}  the box wrapped in a SpineBody — the SP-1
 *   currency. SpineBody is duck-compatible with BrepShape (it exposes .shape /
 *   .id / .meta / .dispose / ._triangulation), so every downstream consumer
 *   (`brepToMesh`, `measure`, `addBrepShapeToScene`, `selectedBrepShapes`,
 *   `withScope` survivor detection) treats it identically to a BrepShape.
 */
export async function makeBox(dx, dy, dz) {
  if (!(dx > 0 && dy > 0 && dz > 0)) {
    throw new Error(`makeBox: dimensions must be positive (got ${dx}, ${dy}, ${dz})`);
  }
  // SP-14b finding #2 — every dim must additionally clear Precision::Confusion()
  // (≈ 1e-7 mm). Without this gate, makeBox(1e-7,1e-7,1e-7) crashes the WASM
  // bridge with an Embind BindingError (the OCCT MakeBox constructor hits an
  // internal assertion at sub-confusion scale). Replaced with a documented
  // catchable DegeneratePrimitiveError that names the failed dim.
  assertDimensionsAboveConfusion('makeBox', [
    ['dx', dx], ['dy', dy], ['dz', dz],
  ]);
  // Construct the spine body — first build, fresh bodyTag allocated.
  const spineBody = await _constructMakeBox(dx, dy, dz);
  // The persistentId for the freshly-bound body is the bodyTag the
  // allocator was seeded with; it is what downstream lookups key on.
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  if (persistentBodyId) {
    // Record the delta. The recording is replay-only — the forward is not
    // re-run on first invocation (the spec just returned from
    // _constructMakeBox covers that). recordBodyCreate appends the entry
    // to the shared kernel HistoryLog singleton.
    try {
      recordBodyCreate({
        opName: 'makeBox',
        persistentBodyId,
        meta: { op: 'makeBox', params: { dx, dy, dz } },
        // Rebuild: re-run the exact constructor with the SAME bodyTag so
        // the persistent id is stable across replays. bindSpine's
        // allocator is seeded from bodyTag; downstream id-keyed lookups
        // (BodyRegistry's brepShapeRef.body.persistentId) keep resolving.
        rebuild: () => _constructMakeBox(dx, dy, dz, persistentBodyId),
        // Register: hand the rebuilt SpineBody to the canonical scene-add
        // path the SP-1 S3 hook installed. The hook is set up by
        // WorkbenchMechanical.jsx — when absent (pure-kernel tests), the
        // register call is a no-op via the optional-chaining inside.
        //
        // Optional `sceneCtx.applyAfterRegister(group, body)` runs once the
        // group is in the scene. Used by the SP-3a crate-stack e2e to
        // re-apply a per-body position adjustment (e.g. a staggered crate
        // offset) on forward replay so the rolled-forward state matches
        // the originally-built state. The hook is opt-in — leaving sceneCtx
        // empty preserves the legacy default behaviour.
        register: async (body, sceneCtx) => {
          const adder = (sceneCtx && sceneCtx.addBrepShape)
            || (typeof globalThis !== 'undefined' && globalThis.__archdiscAddBrepShape)
            || null;
          if (typeof adder !== 'function') return;
          // Resolve the scene + viewport from sceneCtx (preferred) or the
          // live viewport hook. Fail-soft — if no scene is available, the
          // history rebuild succeeded but cannot render; the caller (e2e)
          // notices via the registry being unchanged. Honest, not silent.
          const scene = (sceneCtx && sceneCtx.scene)
            || (typeof globalThis !== 'undefined'
                && globalThis.__archdiscViewport
                && globalThis.__archdiscViewport.scene) || null;
          const viewport = (sceneCtx && sceneCtx.viewport)
            || (typeof globalThis !== 'undefined' && globalThis.__archdiscViewport) || null;
          if (!scene) return;
          const group = await adder(scene, viewport, body, 0x9aa3ad);
          // Optional post-register hook — used by the crate-stack e2e to
          // re-apply staggered group.position on forward replay.
          if (sceneCtx && typeof sceneCtx.applyAfterRegister === 'function') {
            try { await sceneCtx.applyAfterRegister(group, body); } catch { /* noisy enough */ }
          }
          return group;
        },
        // Remove: find the registry entry whose underlying spine body has the
        // matching persistentId, then BodyRegistry.remove. The registry's
        // remove() also detaches the Three.js group from the scene and
        // clears it from selection — one atomic scene departure.
        remove: async (pid, sceneCtx) => {
          const reg = (sceneCtx && sceneCtx.registry)
            || (typeof globalThis !== 'undefined' && globalThis.__archdiscRegistry)
            || null;
          if (!reg || typeof reg.remove !== 'function') return;
          // Match by .brepShapeRef.body.persistentId — SpineBody carries the
          // spine Body under .body, and Body.persistentId is the id we hand
          // to bindSpine via bodyTag.
          const entry = reg.bodies.find((b) => {
            const ref = b && (b.brepShapeRef
              || (b.group && b.group.userData && b.group.userData.brepShapeRef));
            return !!(ref && ref.body && ref.body.persistentId === pid);
          });
          if (entry) reg.remove(entry.id);
        },
      });
    } catch (err) {
      // Never let history-bookkeeping crash an op — the geometry result is
      // valid, only the recording failed. Surface on diagnostics + console.
      // eslint-disable-next-line no-console
      console.warn('makeBox: history recordBodyCreate failed —', err && err.message || err);
    }
  }
  return spineBody;
}

/**
 * Construct the makeCylinder spine body. Factored so the SP-3b history hook's
 * `rebuild` thunk can re-run the SAME construction on replay with a fixed
 * `bodyTag` — the rebuilt body's persistent id then matches the originally-
 * built one and id-keyed downstream lookups continue to resolve.
 *
 * @param {number} radius
 * @param {number} height
 * @param {string=} bodyTag  when supplied, drives bindSpine's IdAllocator.
 * @returns {Promise<SpineBody>}
 */
async function _constructMakeCylinder(radius, height, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepPrimAPI_MakeCylinder_1(radius, height));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('makeCylinder: kernel produced a null shape');
    const meta = { op: 'makeCylinder', params: { radius, height } };
    const wrapper = new BrepShape(shape, meta);
    const body = bindSpine(oc, shape, {
      bodyTag: bodyTag || `makeCylinder-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind: 'solid',
    });
    return new SpineBody(body, wrapper, meta);
  });
}

/**
 * Make a cylinder solid (axis = +Z, base at origin).
 *
 * Spine topology — 3 faces (side, top cap, bottom cap), 3 edges (top circle,
 * bottom circle, vertical seam — the side face wraps around so it has a seam
 * edge), 2 vertices (one on the seam on top, one on the seam on bottom).
 *   V − E_real + F − R = 2 − 3 + 3 − 0 = 2 = 2(1 − 0) → genus 0. ✓
 *
 * SP-3b history hook — every invocation auto-records a forward/inverse delta
 * to the kernel HistoryLog (identical pattern to `makeBox`).
 *
 * @param {number} radius  (mm)
 * @param {number} height  (mm)
 * @returns {Promise<SpineBody>}
 */
export async function makeCylinder(radius, height) {
  if (!(radius > 0 && height > 0)) {
    throw new Error(`makeCylinder: radius and height must be positive (got ${radius}, ${height})`);
  }
  // SP-14b — block sub-Precision::Confusion() dimensions before they crash the
  // WASM bridge with a raw BindingError. See makeBox for the rationale.
  assertDimensionsAboveConfusion('makeCylinder', [
    ['radius', radius], ['height', height],
  ]);
  const spineBody = await _constructMakeCylinder(radius, height);
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  if (persistentBodyId) {
    try {
      recordBodyCreate({
        opName: 'makeCylinder',
        persistentBodyId,
        meta: { op: 'makeCylinder', params: { radius, height } },
        rebuild: () => _constructMakeCylinder(radius, height, persistentBodyId),
        register: standardSceneRegister,
        remove: standardSceneRemove,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('makeCylinder: history recordBodyCreate failed —', err && err.message || err);
    }
  }
  return spineBody;
}

/** _constructMakeSphere — see _constructMakeCylinder header for the pattern. */
async function _constructMakeSphere(radius, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepPrimAPI_MakeSphere_1(radius));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('makeSphere: kernel produced a null shape');
    const meta = { op: 'makeSphere', params: { radius } };
    const wrapper = new BrepShape(shape, meta);
    const body = bindSpine(oc, shape, {
      bodyTag: bodyTag || `makeSphere-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind: 'solid',
    });
    return new SpineBody(body, wrapper, meta);
  });
}

/**
 * Make a sphere solid centred at the origin.
 *
 * Spine topology — 1 face (the whole sphere), 1 seam edge (where the
 * parametric u wraps), 2 degenerate pole edges (the north + south
 * singularities), 2 vertices (the two poles). Per Body.eulerCharacteristic,
 * degenerate edges are excluded from E (they are zero-length parametric
 * artefacts), so V − E_real + F = 2 − 1 + 1 = 2 → genus 0. ✓
 *
 * SP-3b history hook — auto-records a forward/inverse delta on every call.
 *
 * @param {number} radius  (mm)
 * @returns {Promise<SpineBody>}
 */
export async function makeSphere(radius) {
  if (!(radius > 0)) throw new Error(`makeSphere: radius must be positive (got ${radius})`);
  // SP-14b — block sub-Precision::Confusion() radii (see makeBox for rationale).
  assertDimensionsAboveConfusion('makeSphere', [['radius', radius]]);
  const spineBody = await _constructMakeSphere(radius);
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  if (persistentBodyId) {
    try {
      recordBodyCreate({
        opName: 'makeSphere',
        persistentBodyId,
        meta: { op: 'makeSphere', params: { radius } },
        rebuild: () => _constructMakeSphere(radius, persistentBodyId),
        register: standardSceneRegister,
        remove: standardSceneRemove,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('makeSphere: history recordBodyCreate failed —', err && err.message || err);
    }
  }
  return spineBody;
}

/** _constructMakeCone — see _constructMakeCylinder header for the pattern. */
async function _constructMakeCone(radius1, radius2, height, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepPrimAPI_MakeCone_1(radius1, radius2, height));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('makeCone: kernel produced a null shape');
    const meta = { op: 'makeCone', params: { radius1, radius2, height } };
    const wrapper = new BrepShape(shape, meta);
    const body = bindSpine(oc, shape, {
      bodyTag: bodyTag || `makeCone-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind: 'solid',
    });
    return new SpineBody(body, wrapper, meta);
  });
}

/**
 * Make a (truncated) cone solid (axis = +Z, base at origin).
 *
 * Spine topology — truncated cone: 3 faces (side + 2 caps), 3 edges
 * (top/bottom circles + seam), 2 vertices (seam endpoints). Sharp cone
 * (radius2 = 0): 2 faces (side + base), 2 edges (base circle + degenerate
 * apex), 2 vertices.
 *
 * SP-3b history hook — auto-records a forward/inverse delta on every call.
 *
 * @param {number} radius1  base radius (mm)
 * @param {number} radius2  top radius (mm); 0 for a sharp cone
 * @param {number} height   (mm)
 * @returns {Promise<SpineBody>}
 */
export async function makeCone(radius1, radius2, height) {
  if (!(radius1 >= 0 && radius2 >= 0 && height > 0) || (radius1 === 0 && radius2 === 0)) {
    throw new Error(`makeCone: invalid radii/height (got ${radius1}, ${radius2}, ${height})`);
  }
  // SP-14b finding #1 — auto-shim degenerate cone (r1 ≈ r2) → cylinder.
  // A cone with equal top + bottom radii IS a cylinder, but OCCT's
  // BRepPrimAPI_MakeCone constructor crashes the WASM bridge with a raw
  // Embind BindingError because the apex direction is undefined when the
  // slope is zero. Detect |r1 - r2| < Precision::Confusion() and silently
  // delegate to makeCylinder(r1, height) — geometrically identical, and
  // every downstream consumer (volume, faceCount, brepToMesh) handles the
  // result identically. The shim is documented on the result's
  // `meta.diagnostics.shim` field so callers (introspection, e2e, the AI
  // planner) can see it happened. The non-degenerate case below runs the
  // normal cone constructor — unchanged behaviour.
  if (Math.abs(radius1 - radius2) < PRECISION_CONFUSION) {
    // Both radii must additionally clear sub-confusion (catches makeCone(0,0,h)
    // already trapped above by `=== 0`, but also makeCone(1e-9,1e-9,h)).
    assertDimensionsAboveConfusion('makeCone', [
      ['radius1', radius1], ['height', height],
    ]);
    const cyl = await makeCylinder(radius1, height);
    // Document the auto-shim — additive on the existing meta so downstream
    // consumers that walk meta.params still see them, plus the diagnostic
    // makes the shim observable. SpineBody.meta is mutable per BrepShape.
    try {
      if (cyl && cyl.meta) {
        cyl.meta.diagnostics = cyl.meta.diagnostics || {};
        cyl.meta.diagnostics.shim = {
          name: 'makeCone-degenerate-to-cylinder',
          reason: 'r1 ≈ r2 — cone with equal radii is a cylinder; ' +
                  'BRepPrimAPI_MakeCone crashes at this corner case',
          originalOp: 'makeCone',
          originalParams: { radius1, radius2, height },
          threshold: PRECISION_CONFUSION,
        };
      }
    } catch (_e) { /* meta-attach is best-effort; geometry is correct either way */ }
    return cyl;
  }
  // SP-14b — every positive dim must additionally clear Precision::Confusion()
  // before reaching the OCCT constructor. radius1 or radius2 may legitimately
  // be 0 (sharp cone tip) so we only assert positive ones.
  const dimsToCheck = [['height', height]];
  if (radius1 > 0) dimsToCheck.push(['radius1', radius1]);
  if (radius2 > 0) dimsToCheck.push(['radius2', radius2]);
  assertDimensionsAboveConfusion('makeCone', dimsToCheck);
  const spineBody = await _constructMakeCone(radius1, radius2, height);
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  if (persistentBodyId) {
    try {
      recordBodyCreate({
        opName: 'makeCone',
        persistentBodyId,
        meta: { op: 'makeCone', params: { radius1, radius2, height } },
        rebuild: () => _constructMakeCone(radius1, radius2, height, persistentBodyId),
        register: standardSceneRegister,
        remove: standardSceneRemove,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('makeCone: history recordBodyCreate failed —', err && err.message || err);
    }
  }
  return spineBody;
}

/** _constructMakeTorus — see _constructMakeCylinder header for the pattern. */
async function _constructMakeTorus(majorRadius, minorRadius, bodyTag) {
  const oc = await getOCCT();
  return withScope(() => {
    const maker = track(new oc.BRepPrimAPI_MakeTorus_1(majorRadius, minorRadius));
    const shape = maker.Shape();
    if (shape.IsNull()) throw new Error('makeTorus: kernel produced a null shape');
    const meta = { op: 'makeTorus', params: { majorRadius, minorRadius } };
    const wrapper = new BrepShape(shape, meta);
    const body = bindSpine(oc, shape, {
      bodyTag: bodyTag || `makeTorus-${wrapper.id}`, geomEngineShape: wrapper,
      declaredKind: 'solid',
    });
    return new SpineBody(body, wrapper, meta);
  });
}

/**
 * Make a torus solid (axis = +Z, centred at the origin).
 *
 * Spine topology — the most exotic primitive: 1 face, 2 seam edges (a u-seam
 * around the major circle, a v-seam around the minor tube), 1 vertex where
 * the seams meet. NO degenerate edges (a torus is non-singular).
 *   χ = V − E + F − R = 1 − 2 + 1 − 0 = 0 = 2(1 − 1) → genus 1. ✓
 * This is the canonical genus-1 body in the spine — the toroidal handle is
 * the topological signature.
 *
 * SP-3b history hook — auto-records a forward/inverse delta on every call.
 *
 * @param {number} majorRadius  ring radius (mm)
 * @param {number} minorRadius  tube radius (mm)
 * @returns {Promise<SpineBody>}
 */
export async function makeTorus(majorRadius, minorRadius) {
  if (!(majorRadius > 0 && minorRadius > 0 && minorRadius < majorRadius)) {
    throw new Error(`makeTorus: need 0 < minorRadius < majorRadius (got ${majorRadius}, ${minorRadius})`);
  }
  // SP-14b — block sub-Precision::Confusion() radii (see makeBox for rationale).
  assertDimensionsAboveConfusion('makeTorus', [
    ['majorRadius', majorRadius], ['minorRadius', minorRadius],
  ]);
  const spineBody = await _constructMakeTorus(majorRadius, minorRadius);
  const persistentBodyId = spineBody.body && spineBody.body.persistentId;
  if (persistentBodyId) {
    try {
      recordBodyCreate({
        opName: 'makeTorus',
        persistentBodyId,
        meta: { op: 'makeTorus', params: { majorRadius, minorRadius } },
        rebuild: () => _constructMakeTorus(majorRadius, minorRadius, persistentBodyId),
        register: standardSceneRegister,
        remove: standardSceneRemove,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('makeTorus: history recordBodyCreate failed —', err && err.message || err);
    }
  }
  return spineBody;
}
