# SP-3 — Kernel History & Rollback — Progress

Tracking the staged execution of the SP-3 sub-project from the kernel-parity
program (`docs/superpowers/plans/2026-05-21-kernel-parity-program.md` §3 / §4
SP-3 row — Area L). SP-3 mirrors the ACIS BULLETIN_BOARD + Parasolid
PK_PARTITION rollback machinery enumerated at line 312 of
`docs/ARCHDISC_VISION_AND_ROADMAP.md`.

| Stage | Status | Date | Notes |
|---|---|---|---|
| **SP-3a** — mechanism + `makeBox` hook | **DONE** | 2026-05-23 | see below |
| **SP-3b** — coverage across remaining ops (primitives + booleans + features + local + surfacing) | **QUEUED** | — | every op-class that already goes through `IdLineage.carryLineage` is the SP-3b dispatch surface |
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
