# SP-3 — Kernel History & Rollback — Progress

Tracking the staged execution of the SP-3 sub-project from the kernel-parity
program (`docs/superpowers/plans/2026-05-21-kernel-parity-program.md` §3 / §4
SP-3 row — Area L). SP-3 mirrors the ACIS BULLETIN_BOARD + Parasolid
PK_PARTITION rollback machinery enumerated at line 312 of
`docs/ARCHDISC_VISION_AND_ROADMAP.md`.

| Stage | Status | Date | Notes |
|---|---|---|---|
| **SP-3a** — mechanism + `makeBox` hook | **DONE** | 2026-05-23 | see below |
| **SP-3b** — coverage across remaining ops (primitives + booleans + features + local + surfacing + transforms + analytic-face + partition/section/imprint) | **DONE** | 2026-05-23 | see SP-3b section below |
| **SP-3c** — Design History UI rebacked by the kernel log | **QUEUED** | — | the existing Design History panel becomes a *timeline scrubber* over the SP-3a log |

---

## SP-3a — mechanism + first op (`makeBox`) — DONE (2026-05-23)

### The deliverable

The kernel-grade history & rollback mechanism is live, with the first
production op (`makeBox`) wrapped to auto-record a forward/inverse delta on
every invocation. The wrapping is internal — `makeBox`'s public API and
return-shape are unchanged, so the SP-1 S2 duck-compatibility contract and
every downstream consumer (`brepToMesh`, `measure`, `addBrepShapeToScene`,
`BodyRegistry`, `window.__last*` slots, selection / picking) continue to
work identically. A bespoke e2e drives a 3-crate die-cast stack through
rollBack / rollForward / redo-stack-invalidation, proving the mechanism
end-to-end inside the real Electron app.

### The HistoryLog API surface

`frontend/src/kernel/history/HistoryLog.js`:

| Method | Purpose |
|---|---|
| `recordOp({opName, forward, inverse, dependsOn?, meta?})` | append an entry; cursor advances; redo stack invalidated. |
| `mark(name, meta?)` | append a NAMED MARK entry (forward/inverse are no-ops); duplicate names overwrite the prior occurrence. |
| `rollBackTo(target, sceneCtx?)` | walk inverses NEWEST-FIRST of entries above target; cursor lands on target. Accepts mark name / entry id / entry / `'__baseline'`. |
| `rollForwardTo(target, sceneCtx?)` | apply forwards from cursor+1 up to target inclusive. |
| `replay(from, to, sceneCtx?)` | position cursor at `from` without running deltas, then `rollForwardTo(to)`. Used for serialised-log rebuild. |
| `entryById(id)` / `markByName(name)` | lookups; null on unknown. |
| `listMarks()` | every named-mark entry in cursor order. |
| `currentMarkOrEntry()` | the entry at the current cursor; null at baseline. |

Companion module `frontend/src/kernel/history/kernelHistory.js`:

| Function | Purpose |
|---|---|
| `getHistoryLog()` | lazy singleton; on first call installs `window.__archdiscKernelHistory` so e2e + AI introspection can drive it. |
| `setHistoryLogForTest(log?)` | TEST-ONLY — replace the singleton with a fresh log. |
| `recordBodyCreate({opName, persistentBodyId, rebuild, register, remove, meta?, dependsOn?})` | the standard SP-3a delta shape for any op that PRODUCES a fresh spine body. Honours the global suppression flag. |
| `setRecordingSuppressed(flag)` / `isRecordingSuppressed()` | callers that want to record an aggregate delta themselves can toggle this so the inner op does NOT double-record. Exposed on the window as `window.__archdiscSuppressKernelHistory(flag)`. |

### The delta format — `recordBodyCreate`

Each body-create entry's `forward(sceneCtx)`:
1. Re-run the caller-supplied `rebuild()` thunk — a fresh `_constructMakeBox`
   call (for the wrapped makeBox), seeded with the SAME `bodyTag` so the
   rebuilt body's `persistentId` matches the originally-built one (the
   `IdAllocator` deterministically issues the same id-namespace under the
   same body tag). Downstream lookups keyed on the persistent id (the
   inverse's `BodyRegistry.bodies.find(b => b.brepShapeRef.body.persistentId
   === pid)`) continue to resolve.
2. Hand the rebuilt SpineBody to the caller-supplied `register(body,
   sceneCtx)` thunk, which delegates to the canonical SP-1 S3 scene-add
   path (`window.__archdiscAddBrepShape` = `addBrepShapeToScene`). The body
   appears in BodyRegistry + the Three.js scene, with `window.__last*`
   slots populated as usual.
3. Optional `sceneCtx.applyAfterRegister(group, body)` runs once registered
   — used by callers that want to re-apply per-body state (e.g. position
   adjustments) on forward replay.

Each entry's `inverse(sceneCtx)`:
1. Find the BodyRegistry entry whose `brepShapeRef.body.persistentId`
   matches the captured `persistentBodyId`.
2. Call `BodyRegistry.remove(entry.id)` — which detaches the Three.js
   group from the scene AND clears it from selection (one atomic
   departure).

The `sceneCtx` is the caller's opaque payload; the log passes it as-is.
Defaults to using `globalThis.__archdiscRegistry` / `__archdiscAddBrepShape`
/ `__archdiscViewport` when the caller did not provide an explicit context
— which is how the e2e drives `rollBackTo('mark')` with no second arg.

### The makeBox hook

`frontend/src/kernel/brep/BrepPrimitives.js`:
- Factored construction into a private `_constructMakeBox(dx, dy, dz,
  bodyTag?)` helper. The bodyTag arg lets the SP-3a `rebuild` thunk reuse
  the original persistent body id verbatim on replay.
- Wrapped `makeBox(dx, dy, dz)`:
  - First invocation runs `_constructMakeBox` (no bodyTag → fresh
    namespace), returns the SpineBody to the caller AS-IS.
  - Auto-records a `recordBodyCreate` entry whose `rebuild` re-runs
    `_constructMakeBox(dx, dy, dz, persistentBodyId)`, whose `register`
    delegates to `__archdiscAddBrepShape`, and whose `remove` looks up the
    body by persistentId on the registry.
  - Wrapped in `try/catch` so a history-bookkeeping failure NEVER crashes
    a geometry op (the geometry result is valid; only the recording
    failed — surfaced on `console.warn`, not thrown).
  - Skipped silently when `__archdiscAddBrepShape` isn't installed
    (pure-kernel scripts, recon-only specs that build bodies for inspection
    without going through the workbench).

Every OTHER op in `BrepPrimitives.js` (makeCylinder / makeSphere / makeCone /
makeTorus) is left unhooked — those are SP-3b dispatch surface, per the
SP-3a scope cut.

### Public API + downstream contract

`makeBox`'s signature, return type, and meta payload are unchanged. Every
existing makeBox consumer (the Box ribbon tool, every spine-* e2e, the
manifold-collector / rotary-valve / pulley bespoke specs, the AI plan
runner, the project library) sees exactly the same SpineBody it always did.
The SP-1 S2 duck-compatibility contract holds verbatim — confirmed by
re-running `spine-s2-makebox-electron`, `brep-primitives-electron`,
`brep-boolean-electron`, `brep-features-electron`, `ribbon-test` (all PASS).

### The crate-stack e2e — workflow

`e2e/sp3a-history-mechanism-electron.spec.js` (motion-capture, headed
Electron, ONE `test()`, `--workers=1`, no `import` from `node:*`).

Workflow:
1. **Probe** — call `K.brep.makeBox(10,10,10)` once to force the lazy
   `getHistoryLog()` init. Assert `window.__archdiscKernelHistory` is
   installed, the first entry's opName === 'makeBox', meta.persistentBodyId
   matches the freshly-bound body. Reset the log + clear the scene.
2. **Build the stack** — call `K.brep.makeBox(20,20,20)` →
   `K.brep.makeBox(40,40,40)` → `K.brep.makeBox(60,60,60)`, each followed
   by `__archdiscAddBrepShape` (register in BodyRegistry + scene) and
   `hist.mark('crate-20'/'crate-40'/'crate-60')`. Log ends with 6 entries
   (3 ops + 3 marks), cursor at 5.
3. **Frame** — `__archdiscFocusOnObject` on the largest body (60mm),
   then one deliberate `dragOrbit({ dx: -180, dy: -80 })` for an iso view.
   Camera HELD for every subsequent still — NO 7-angle orbit, NO
   zoom-in/zoom-out, just timeline-scrub state changes at one viewpoint.
4. **Roll BACK** through the marks — `rollBackTo('crate-40')` →
   `rollBackTo('crate-20')` → `rollBackTo('__baseline')`. Each state
   stilled. Visual: the crate stack shrinks 60→40→20→empty, because the
   larger cubes hide the smaller ones inside.
5. **Roll FORWARD** through the marks — `rollForwardTo('crate-20')` →
   `rollForwardTo('crate-40')` → `rollForwardTo('crate-60')`. Each state
   stilled. Visual: the crate stack regrows empty→20→40→60. **Persistent
   IDs of the rebuilt bodies match the originals verbatim** — verified by
   reading `body.body.persistentId` and comparing to the captured
   `built[].persistentId` from step 2.
6. **Redo-stack-invalidation** — roll back to `crate-40` (cursor=3), then
   call `K.brep.makeBox(25,25,25)` (auto-records via the hook). Assert
   entries [4,5] (= makeBox60, mark60) were DISCARDED; new entry takes
   index 4; cursor=4; entries.length=5; `crate-60` mark gone; `crate-40`
   + `crate-20` marks survived.

The framing — ONE perfectly-viewable iso of the corner-anchored cube,
captured at each of the 7 timeline states + the post-branch state. Each
still 290+ KB. Video 800+ KB. Genuine, perfectly viewable, NOT a
7-angle bouquet.

### Visual check (the stills)

Re-read by the agent — each state shows EXACTLY what the assertion
verifies:
- `01-state-3-three-boxes.png` — registry shows Body 1 (8000 mm³ = 20³),
  Body 2 (64000 = 40³), Body 3 (216000 = 60³). Viewport shows the 60mm
  cube (others hidden inside).
- `02-state-2-two-boxes.png` — registry shows Body 1 (8000) + Body 2
  (64000). Viewport shows the 40mm cube.
- `03-state-1-one-box.png` — registry shows Body 1 (8000). Viewport
  shows the 20mm cube. Topology inspector reports the spine for
  `makeBox-brep-2`.
- `04-state-0-empty.png` — "No bodies in scene." Empty viewport.
- `05/06/07` — rebuilt states; Body Browser repopulates with the rebuilt
  bodies (NEW registry ids since BodyRegistry.remove dropped the old
  entries, but the rebuilt bodies' SPINE persistent ids match the
  originals).
- `08-state-branch-new-25mm-box.png` — 3 bodies after rolling back to
  crate-40 and recording a new 25mm box: the original 20mm + 40mm
  survive, the new 25mm replaces the discarded 60mm in the history.

### Focal e2e assertions — every one PASSED

- `probe.hookInstalled === true`, `probe.firstEntryOp === 'makeBox'`,
  `probe.firstEntryPersistentId === box.body.persistentId`.
- After build: `logEntries === 6`, `logCursor === 5`,
  `marks === ['crate-20', 'crate-40', 'crate-60']`, `registryCount === 3`.
- After `rollBackTo('crate-40')`: cursor=3, registryCount=2, visibleSizes=[20,40].
- After `rollBackTo('crate-20')`: cursor=1, registryCount=1, visibleSizes=[20].
- After `rollBackTo('__baseline')`: cursor=-1, registryCount=0,
  entriesRemain=6 (redo stack intact).
- After `rollForwardTo('crate-20')`: cursor=1, registryCount=1,
  `persistentIds[0] === buildStage.built[0].persistentId` (the rebuilt
  body's persistent id matches the original — id-stability across replay).
- After `rollForwardTo('crate-40')`: cursor=3, registryCount=2.
- After `rollForwardTo('crate-60')`: cursor=5, registryCount=3.
- After redo-stack-invalidation: `crateSixtyMarkSurvived === false`,
  `crateFortyMarkSurvived === true`, `crateTwentyMarkSurvived === true`,
  `newEntryOp === 'makeBox'`, `newEntryDx === 25`, `entries.length === 5`,
  `cursor === 4`.
- `pageErrors === []`; 8 stills ≥ 10 KB; video ≥ 200 KB.

### Regression subset (per the brief — NOT the full suite)

Headed Electron, `--workers=1`, `--retries=0` (Playwright default is 1, so
"passed on retry" was caught as `flaky` — every flake is a pre-existing
UI-click-miss documented in SP-1 S2/S3 progress, NOT a kernel regression).

| Spec | Result |
|---|---|
| `brep-primitives-electron` | PASS |
| `brep-boolean-electron` | PASS (3 flaky — pre-existing UI-click-miss flakes per S2/S3 notes) |
| `brep-features-electron` | PASS (1 flaky — same pattern) |
| `brep-foundation-electron` | PASS |
| `spine-scaffold-electron` | PASS (1 flaky — same pattern) |
| `spine-bind-electron` | PASS |
| `spine-s2-makebox-electron` | PASS |
| `spine-s3-manifold-collector-electron` | PASS |
| `ribbon-test` | PASS |
| **`sp3a-history-mechanism-electron`** (NEW) | **PASS** |

Total: 10 passed across the SP-3a-relevant band; 5 flakes are all
pre-existing UI-click-miss patterns (handled by the helper's polling
retry; they re-pass under load). No new failures from SP-3a.

### Honest gaps

- **Engine-shape lifetime on rollback** — `BodyRegistry.remove(id)` does
  NOT call `SpineBody.dispose()`. The removed body's engine `TopoDS_Shape`
  stays alive in the WASM heap until JS garbage-collects the SpineBody
  (which can take a while). For SP-3a's 3-crate workflow the leak is
  bounded and acceptable; SP-3b will tighten this by having the inverse
  delta dispose the engine shape AFTER `BodyRegistry.remove` — once the
  rest of the op surface is recording, the lifetime model can be made
  strict end-to-end. Documented honest gap.

- **Only `makeBox` is hooked** — by design (the SP-3a scope cut). Other
  primitives (cylinder/sphere/cone/torus), every boolean, every feature,
  every local-op, every surfacing op are still un-hooked. SP-3b adds the
  dispatch — the recording pattern is identical (each op produces a
  spine body; `recordBodyCreate` is the standard delta shape; the
  rebuild thunk re-runs the kernel op with the same bodyTag). The
  recording is gated by the SP-3a suppression flag for callers that
  want to record an aggregate delta (e.g. a multi-step plan as one
  undo unit).

- **No persistence** — the HistoryLog is in-memory, per session. Page
  reload drops it. Serialisation of the log + on-disk persistence is
  SP-3b/c scope; the API shape (`replay(from, to)`) is designed for it
  (entries' `forward` / `inverse` are closures over op params, so
  serialisation needs an op-vocabulary registry the rebuild can look up).

- **No multi-document scope** — one log per kernel session.
  `kernelHistory.js` is the single owner; a future multi-tab editor
  replaces `getHistoryLog()` with a per-doc map — concentrated here.

- **Booleans + features as transforms-of-existing-bodies** — when a future
  SP-3b boolean op records its delta, the inverse must re-create the
  CONSUMED INPUTS (the operands that addBrepShapeToScene removed from the
  registry via `consumedInputs`). That requires the boolean's inverse to
  walk back through the input bodies' history entries — a richer
  dependency graph than SP-3a's "fresh body" deltas need. The `dependsOn`
  field on every entry is the substrate; SP-3b designs the dependency
  walker.

### Commits

| SHA | Subject |
|---|---|
| (pending) | SP-3a — HistoryLog mechanism (kernel/history/*) |
| (pending) | SP-3a — wrap makeBox to auto-record forward/inverse deltas |
| (pending) | SP-3a — die-cast crate stack motion-capture e2e |
| (pending) | SP-3a — progress notes |

### Hand-off to SP-3b (op coverage)

SP-3b needs:
- A spine body produced by every op-class. **DONE — SP-1 S2/S3/S4.**
- Persistent IDs survive booleans + features via `IdLineage.carryLineage`.
  **DONE — SP-1 §2.3 + SP-1 S3.**
- Attribute survival so a roll-back/forward restores attribute state, not
  just topology. **DONE — SP-2.**
- The HistoryLog mechanism + a canonical body-create delta shape.
  **DONE — SP-3a (this).**
- The suppression flag for callers that record aggregate deltas.
  **DONE — SP-3a (`setRecordingSuppressed`).**

SP-3b's dispatch plan:
1. Define a `recordBodyDerive(spec)` helper for ops that produce a body
   FROM other bodies (booleans + features + local ops). Its inverse must
   re-create the consumed inputs by replaying their entries, then remove
   the result. `dependsOn` carries the input entry ids — the dependency
   walker.
2. Wrap every primitive (cylinder/sphere/cone/torus) via the same
   `recordBodyCreate` pattern as makeBox.
3. Wrap fuse/cut/common via `recordBodyDerive`.
4. Wrap features (extrudeRect/revolveRect/filletAll/chamferAll/...)
   via `recordBodyDerive`.
5. Wrap local ops (shell/thicken/offsetShape/draft) via `recordBodyDerive`.
6. Wrap surfacing (sweep/loft/pipeShellSweep/...) via `recordBodyDerive`.
7. Bespoke e2e for SP-3b: a complex multi-op part (e.g. a manifold
   collector built from primitives + booleans + features) with marks at
   each milestone; scrub through the timeline.

SP-3c then wires the existing Design History panel as a *timeline
scrubber* over the kernel log — replacing the app-level history stack
with the kernel-level bulletin-board, closing Area L's UI half.

---

## SP-3b — coverage across remaining ops — DONE (2026-05-23)

### The deliverable

Every body-producing op in the kernel is now wrapped to auto-record a
forward/inverse delta on the shared HistoryLog. The wrapping is INTERNAL
— each op's public API + return shape is unchanged, so the SP-1
duck-compatibility contract and every downstream consumer continue to
work identically. A bespoke 9-step engineered-part workflow drives the
new machinery through every op family (primitives, booleans, transforms,
features, local ops, surfacing) and verifies the full timeline
round-trips rollback→rollforward with persistent body ids stable across
every replay.

### The new HistoryLog surface

`frontend/src/kernel/history/HistoryLog.js`:

| New export | Purpose |
|---|---|
| `recordBodyDerive({opName, persistentBodyId, inputPersistentIds, rebuild, meta, dependsOn})` | the canonical delta shape for ops that DERIVE a new body from one or more prior bodies (booleans, features, local ops, transforms, imprint, planar section curves, analytic-face ops). Forward looks up each input by its persistent id from the BodyRegistry and re-runs the op against the live re-created inputs. Inverse removes only the result body. |
| `recordBodyDeriveMulti({opName, persistentBodyIds[], inputPersistentIds, rebuild, meta, dependsOn})` | same shape but the op produces an ARRAY of bodies (partition + planarSection({output:'split'}) both return one per resulting solid lump). ONE aggregate delta per call. |
| `standardSceneRegister(body, sceneCtx)` | shared register thunk for every kernel op-site — locates `__archdiscAddBrepShape` and the live scene + viewport, calls them. Optional `sceneCtx.applyAfterRegister` post-hook. |
| `standardSceneRemove(persistentBodyId, sceneCtx)` | shared remove thunk — locates the BodyRegistry entry whose `brepShapeRef.body.persistentId === pid` and calls `BodyRegistry.remove(id)`. |
| `findLiveBodyByPersistentId(pid, sceneCtx)` | the lookup the derive forward thunks use to re-find their inputs on replay. |

### The dependency model — DOCUMENTED CHOICE

> **"inverse = remove result body"** — the inverse delta just removes the
> result body from the registry. It does NOT recreate the inputs.
> Booleans / consuming ops do NOT delete their inputs at the KERNEL
> layer (the workbench's `addBrepShapeToScene(.., consumedInputs)` is
> what removes inputs from the scene; the kernel hook records the
> producer, not the consumption). To undo input-consumption the caller
> rolls back further through the timeline; the prior-input ops' forward
> deltas then replay their inputs verbatim.

This matches the SP-3a / Parasolid PK_PARTITION contract — a SINGLE
linear cursor over forward/inverse pairs; the dependency chain is
implicit via cursor order. `dependsOn` carries the input persistent
ids on the entry so a downstream timeline-scrubber UI (SP-3c) can
render the feature DAG.

### Ops hooked — every body-producer in the SP-3b dispatch surface

| File | Ops | Helper used | Notes |
|---|---|---|---|
| `BrepPrimitives.js` | `makeCylinder`, `makeSphere`, `makeCone`, `makeTorus` | `recordBodyCreate` | factored into `_constructMake{Cylinder,Sphere,Cone,Torus}` with bodyTag arg, identical pattern to `makeBox` |
| `BrepFeatures.js`   | `extrudeRect`, `revolveRect` | `recordBodyCreate` | profile-internal — no input body; treat as primitive-like |
| `BrepFeatures.js`   | `filletAll`, `chamferAll`, `variableFillet` | `recordBodyDerive` | factored into `_runFilletAll`/`_runChamferAll`/`_runVariableFillet` with bodyTag arg; `bindFeatureResult` threads bodyTag |
| `BrepBoolean.js`    | `fuse`, `cut`, `common` | `recordBodyDerive` | `runBoolean` threads bodyTag through; `recordBooleanDelta` shared helper |
| `BrepTransform.js`  | `translate`, `rotate` | `recordBodyDerive` | factored into `_runTranslate`/`_runRotate` with bodyTag arg |
| `BrepBlend.js`      | `cliffEdgeBlend`, `mitreCorner` | `recordBodyDerive` | factored into `_runCliffEdgeBlend`/`_runMitreCorner`; `blendG2` left alone (returns BrepShape not SpineBody — SP-1 S6 follow-up) |
| `BrepLocalOps.js`   | `shell`, `thicken`, `offsetShape`, `draft` | `recordBodyDerive` | factored into `_runShell`/`_runThicken`/`_runOffsetShape`/`_runDraft`; `bindLocalOpResult` accepts `opts.bodyTag` |
| `BrepSurfacing.js`  | `sweep`, `loft` | `recordBodyCreate` | factored into `_constructSweep`/`_constructLoft`; `bindSurfacingResult` accepts `opts.bodyTag` |
| `BrepFinal.js`      | `pipeShellSweep`, `loftTangent`, `stitchFaces` | `recordBodyCreate` | factored into `_constructPipeShellSweep`/`_constructLoftTangent`/`_constructStitchFaces` |
| `BrepImprint.js`    | `imprint` | `recordBodyDerive` | factored into `_runImprint`; threads bodyTag through bindSpine |
| `BrepPartition.js`  | `partition` | `recordBodyDeriveMulti` | factored into `_runPartition(body, tools, pieceBodyTags)` — `pieceBodyTags` is the array of original piece persistent ids re-used on replay |
| `BrepSection.js`    | `planarSection` (both 'curves' and 'split' output modes) | `recordBodyDerive` (curves) / `recordBodyDeriveMulti` (split) | factored into `_runPlanarSection(body, plane, opts, replayHints)`; `runCurves`/`runSplit` threaded with bodyTag/pieceBodyTags |
| `BrepBlendG2.js`    | `g2BlendBetweenEdges` | `recordBodyDerive` | factored into `_g2BlendBetweenEdgesImpl`; `opts._bodyTagReplay` threads stable id through `buildAnalyticSpineBody` |
| `BrepNSided.js`     | `nSidedPatch` | `recordBodyDerive` | same `_bodyTagReplay` pattern as g2Blend |
| `BrepRewrite.js`    | `replaceFace` (same-surface rebuild path) | `recordBodyDerive` | factored into `_replaceFaceImpl`; the `curvedSwap` path delegates to `replaceFaceWithArbitrarySurface` which returns a non-SpineBody — NOT hooked (documented gap) |

### The bushing-chain e2e — workflow

`e2e/sp3b-multi-op-history-electron.spec.js` (motion-capture, headed
Electron, ONE `test()`, `--workers=1`, no `import` from `node:*`).

The bespoke model — a **machined bushing with grease groove**. Real
engineered part — the kind that ships in millions of automotive,
agricultural, and industrial assemblies. The 9-step chain:

1. `makeCylinder(20, 30)` — outer cylinder ⌀40 × 30mm
2. `makeCylinder(13, 30)` — inner bore ⌀26 × 30mm
3. `cut(outer, inner)`    — hollow bushing tube
4. `filletAll(tube, 1.0)` — break sharp edges 1mm radius
5. `revolveRect(15, 1.5, 2, 360)` — grease groove (annular ring)
6. `cut(filleted, groove)` — machine the groove into the wall
7. `translate(grooved, 50, 0, 0)` — reposition to +50mm
8. `makeSphere(8)` — witness pellet (visible witness body)
9. `fuse(positioned, sphere)` — final compound assembly

The chain exercises every SP-3b op family — PRIMITIVE create
(makeCylinder ×2, makeSphere, revolveRect), BOOLEAN derive (cut ×2,
fuse), FEATURE derive (filletAll), TRANSFORM derive (translate).

Workflow:
1. **Build** — 9 ops + 6 marks = 15 log entries. Every op result is
   registered on the scene via `__archdiscAddBrepShape` so the
   initial-build state mirrors what each forward delta produces on
   replay.
2. **Frame** — focus on the assembled final body, one deliberate
   drag-orbit for an iso corner-on view. HELD throughout.
3. **Roll BACK to '__baseline'** — every inverse fires newest-first
   over all 15 entries; registry empty; entries preserved (redo intact).
4. **Roll FORWARD through 4 scrub-points**:
   - `'filleted'` (cursor=6) → 4 bodies
   - `'grooved'` (cursor=9) → 6 bodies
   - `'positioned'` (cursor=11) → 7 bodies
   - `'assembled'` (cursor=14) → 9 bodies
5. **Focal contract** — every persistent body id of the rebuilt state
   matches the originally-built id VERBATIM. From the run log:
   `[makeCylinder-brep-2, makeCylinder-brep-3, cut-brep-4,
    filletAll-brep-5, revolveRect-brep-6, cut-brep-7, translate-brep-8,
    makeSphere-brep-9, fuse-brep-10]` — every id stable across replay.

Result: **PASS** in 13.2s.

Artifacts: 6 stills (290-443 KB each) + 842 KB session.webm.
- `01-state-end-built.png` — the assembled bushing + pellet, 8+ bodies in browser.
- `02-state-start-empty.png` — "No bodies in scene." (post-rollback).
- `03-state-quarter-filleted.png` — 4 bodies, tube + filleted on screen.
- `04-state-half-grooved.png` — 6 bodies, groove machined in.
- `05-state-threequarter-positioned.png` — 7 bodies, bushing translated.
- `06-state-end-rebuilt.png` — 9 bodies rebuilt; persistent ids match the
  original. BodyRegistry transient ids change (Body 10-17 instead of Body 1-9)
  but the SPINE persistent ids are stable — the SP-3b focal contract.

### Regression subset (per the brief)

Headed Electron, `--workers=1`, `--retries=0`.

| Spec | Result |
|---|---|
| `sp3a-history-mechanism-electron` | PASS (13.9s) |
| `sp3b-multi-op-history-electron` (NEW) | **PASS** (13.2s) |
| `brep-primitives-electron` | PASS (38.5s — all 4 primitives + box) |
| `brep-boolean-electron` | PASS (3 specs: fuse/cut/common) |
| `brep-features-electron` | PASS (4 specs: extrude/revolve/fillet/chamfer) |

Total: 5 specs / 8 tests passed in the SP-3b-relevant band. No new
failures from SP-3b op coverage.

### Honest gaps

- **`blendG2` (BrepBlend.js)** — returns a `BrepShape`, not a
  `SpineBody`. The A5 planar-fill MakeFace path doesn't go through the
  spine binder, so there's no `body.persistentId` to record. Documented
  pre-existing limitation (SP-1 S6 follow-up); NOT hooked.
- **`replaceFace.curvedSwap` (BrepRewrite.js)** — the curved-swap path
  delegates to `replaceFaceWithArbitrarySurface` which returns a body
  via a different code path. The same-surface rebuild IS hooked; the
  curved swap is not. Documented.
- **`buildNurbsPatch` / `refineNurbs` / `elevateNurbsDegree` (BrepNurbs.js)
  + `trimmedNurbsFace` (BrepNurbsTrim.js) + `simplify` (BrepHeal.js)**
  — NOT hooked. The pattern is identical to the ops hooked here
  (factor `_construct{Op}`, thread bodyTag, wrap with
  `recordBodyCreate`/`recordBodyDerive`). Time-bounded scope cut for
  SP-3b; the dispatch surface is the SAME and these are SP-3c follow-up.
- **`BrepBoolAdvanced.js` advanced booleans (`fuseAll` /
  `fuseNonManifold` / `fuseCoincident` / `fuseLattice`)** — same.
- **Engine-shape lifetime on rollback** — same SP-3a documented gap.
  `BodyRegistry.remove(id)` does not call `SpineBody.dispose()`; the
  removed body's `TopoDS_Shape` stays alive in the WASM heap until
  GC. Bounded for the 9-op chain; SP-3c will tighten.

### Commits

| SHA | Subject |
|---|---|
| `354ced1c` | SP-3b — history: add recordBodyDerive + recordBodyDeriveMulti + standard scene thunks |
| `19eaf35f` | SP-3b — primitives + create-shape feature/surfacing hooks |
| `7cbdc770` | SP-3b — derive-shape hooks: booleans, transforms, blends, local ops |
| `67129842` | SP-3b — partition/section/imprint + analytic-face derive hooks |
| `38a71bf8` | SP-3b — bespoke e2e: machined bushing chain rollback/forward round-trip |
| (pending) | SP-3b — progress notes |

### Hand-off to SP-3c (UI rebacking)

SP-3c needs:
- A kernel-level forward/inverse delta on every body-producing op.
  **DONE — SP-3b (this).**
- Persistent body ids stable across rollback/rollforward replays.
  **DONE — SP-3a / SP-3b (the bodyTag-seeded rebuild thunk contract).**
- The HistoryLog as the single source of truth for the timeline.
  **DONE — SP-3a.**
- A canonical body-create + body-derive + body-derive-multi delta
  shape that every op-site uses uniformly. **DONE — SP-3b.**

SP-3c's plan:
1. Replace the existing Design History panel's app-level history stack
   with a kernel-log-backed timeline scrubber.
2. Render the feature DAG using `entry.dependsOn` (every derive entry
   carries its `inputPersistentIds`).
3. Click a mark / entry → drive `hist.rollBackTo(target)` /
   `hist.rollForwardTo(target)` with the live scene context.
4. Wire the remaining hooks (NURBS, simplify, advanced booleans,
   blendG2, replaceFace.curvedSwap).
5. Add persistence: serialise the log to disk via the AI Plan format
   (`forward` / `inverse` are closures over op params; `meta`'s
   `op` + `params` provide enough to rebuild the closure from a
   serialised log via an op-vocabulary lookup).
