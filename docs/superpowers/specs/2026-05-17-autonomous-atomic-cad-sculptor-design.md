# Autonomous Atomic-CAD Sculptor — Design Spec

**Date:** 2026-05-17
**Status:** Approved design — ready for implementation planning
**Acceptance target:** the AI autonomously builds a complete Swiss mechanical
watch movement, atomically, assembles it, runs it in motion, and renders it.

---

## 1. Problem & Intent

ArchDisc's AI must build any mechanical product the way a human engineer does —
sketch by sketch, feature by feature — but fully autonomous and roughly 1000×
faster. It must use **only** the operations ArchDisc itself exposes, so a human
can open the result, replay it, edit it, and learn from it.

### What this explicitly rejects

- **Premade models / imported geometry.** No model is loaded ready-made.
- **Part generators.** A parametric function such as `involuteGearProfile()`
  that returns a finished gear is, from the user's standpoint, a premade model —
  a canned template. It is rejected. Every component is constructed
  operation-by-operation through the platform's real atomic CAD operations.
- **Hand-authored geometry plans.** The prior GE9X "engine" was hand-authored
  primitives; the 4 autonomous archetypes were primitive blocks. Both are
  rejected as not-real-products.
- **Data-only success claims.** Triangle counts and file sizes passing while the
  result is visually a blob. A result is not "done" until it has been *seen* and
  *measured*.

### Current platform reality (from codebase survey, 2026-05-17)

- `kernel/features/FeatureTree.js` is a **real** parametric, history-based
  kernel: every feature records its operation + params, editing a param
  regenerates downstream features, undo/redo works. This is the construction
  record the vision needs.
- **But the tools do not use it.** The `Line` sketch tool draws a hardcoded
  (0,0)→(3,0) line; `Circle` is always radius 1.5 at origin; `createSketchEntity`
  places entities at random coordinates; `Extrude Boss` ignores the sketch
  entirely and extrudes a canned 80×50×25 box via a direct manifold-3d call. The
  sketch layer and the feature layer are disconnected demo stubs.
- `kernel/sketch/SketchSolver.js` (real constraint solver), the `kernel/topology/`
  Topo* classes, `foundation/KinematicsCore.js`, `MotionStudy.js`,
  `SystemDynamics.js`, `ExplicitDynamics.js`, `JpegEncoder.js`, `VideoMux.js`,
  `ai/Clarifier.js`, and the BYO-LLM provider layer (`ai/PlannerProviders.js`,
  Azure GPT-4.1 wired) all exist as usable building blocks.

So the work is **not** "build a CAD kernel from zero." It is: make every atomic
operation genuinely parametric and precise, wire `sketch → closed profile →
feature → solid` through the one real history tree, and build the AI that
reasons geometrically and sequences those operations.

---

## 2. Chosen Approach

**AI Sculptor strategy (decided): "LLM plans feature-by-feature, deterministic
solver places, LLM verifies renders."**

- The LLM (BYO provider — Azure GPT-4.1 now, a local model later, via the
  existing `PROVIDERS` abstraction) genuinely reasons one feature at a time. No
  canned recipes.
- The LLM expresses each feature as **constraint intent** (entities + geometric
  constraints), never as raw float coordinates.
- A deterministic constraint/geometry solver resolves the intent to exact
  numeric geometry. The LLM never hallucinates coordinates.
- After every feature the LLM is shown the updated geometry **and a render**,
  and must verify it against intent before continuing.

**Scope (decided): the whole vision in one spec**, organised as eight layers
(L0–L7), with the watch movement as the single end-to-end acceptance run.

---

## 3. Architecture — Eight Layers

```
L7  Orchestrator + Clarifying-MCQ Swarm + system closing loop
L6  Render in motion (real Three.js viewport -> .mp4)
L5  System dynamics in motion (mainspring -> train -> escapement -> balance)
L4  Assembly (mate solver, kinematic graph, DOF audit, interference check)
L3  Part verification (manifold, dimensions, mass props, function, vision)
L2  AI Sculptor (LLM feature-by-feature loop)
L1  Geometry introspection (faces/edges/measurements the AI "sees")
L0  Atomic operations (real, parametric, recorded into FeatureTree)
```

### L0 — Atomic Operations (the geometry foundation)

**`kernel/atomic/Part.js`** — one `Part` holds a live sketch graph + a
`FeatureTree` + the resulting `TopoSolid`. It is the unit of construction and
*is* the editable history.

**`kernel/atomic/AtomicOps.js`** — the single canonical operation set, used by
**both** the ribbon tools (humans) and the AI Sculptor. Every operation is
parametric, takes exact inputs, and records a feature.

- *Sketch context:* `startSketch(datumPlane | faceRef)` — sketch on a base plane
  **or on a face of the existing solid** (sketch-on-face is essential to
  sculpt up a part).
- *Sketch entities:* `line, circle, arc, spline, point, polygon, sketchFillet,
  offset, mirror, trim`.
- *Sketch constraints:* `coincident, horizontal, vertical, parallel,
  perpendicular, tangent, concentric, equal, dimension` — resolved by
  `SketchSolver`. This is the "solver places" half of the chosen approach.
- *Features:* `extrude, cut, revolve, revolveCut, sweep, loft, fillet, chamfer,
  shell, hole, draft`.
- *Patterns / multi-body:* `linearPattern, circularPattern, mirrorFeature,
  union, subtract, intersect`.

**`kernel/atomic/SketchProfile.js`** — extracts closed loops from a solved
sketch and hands them to feature operations.

**`kernel/atomic/ParametricCurve.js`** — exact evaluators for curves that need
math: involute, Archimedean/logarithmic spiral (hairspring), ellipse, cam
profiles. Output is a point set that becomes a real spline sketch entity. A
curve evaluator is a sketch-entity primitive at the same atomic level as "arc" —
**not** a premade part. Kept kernel-free pure math so e2e can import it
directly. Each evaluator is verified against its closed-form.

**`kernel/atomic/TopoNaming.js`** — persistent face/edge/vertex IDs that survive
regeneration (deterministic ID = creation order + geometric signature). Honest
limitation: this is the classic topological-naming problem; it is robust but not
perfect. An edit that deletes a referenced face surfaces as a feature error, not
a silent wrong result.

**`FeatureTree.js` extension** — add the feature types it currently lacks:
sketch features, cut features, and pattern features (patterns today exist only
as raw manifold calls in the tool layer, outside history).

**`ToolExecutionEngine.js` rewrite** — the canned `Line`/`Circle`/
`createSketchEntity`/`Extrude Boss`/etc. stubs are replaced by thin wrappers over
`AtomicOps`. Humans and the AI then drive the identical operation set.

### L1 — Geometry Introspection

**`kernel/atomic/GeometryQuery.js`** — returns, for the in-progress part: faces
(id, type, normal, area, centroid, bbox), edges (id, type, length, endpoints),
vertices, the ordered feature tree with params, and measurements (distance
between refs, bounding box, mass properties). This is what the AI "sees" to
choose its next operation, alongside rendered images from L6's render path.

### L2 — AI Sculptor

**`ai/sculptor/PartSculptor.js`** — given a part spec (name, function, key
dimensions, datum frame), runs the LLM feature-by-feature loop:

1. **Decompose** — the LLM produces an ordered list of *feature intents*
   (e.g. "base disc Ø10×0.8", "one involute tooth", "circular-pattern it 15×",
   "bore Ø1 staff hole"). Intent, not coordinates.
2. **Per feature:** the LLM expresses it as a constraint sketch → `SketchSolver`
   resolves exact geometry (under/over-constrained ⇒ hard error fed back, never a
   guess) → `AtomicOps` executes the feature → `FeatureTree` records it →
   `GeometryQuery` + a fresh render go back to the LLM, which verifies against
   intent and, on mismatch, edits the feature's params (a real history edit) or
   adds a corrective op.
3. **Math curves** — the LLM declares curve type + parameters; `ParametricCurve`
   evaluates exact points; the result becomes a real spline sketch entity. The
   gear is still genuinely sculpted: involute curve → tooth profile → pattern →
   extrude → bore.

### L3 — Part Verification

**`ai/sculptor/PartVerifier.js`** — a part is "done" only when **all** pass:

- Manifold validity (watertight, sane genus/component count).
- Dimensional audit — measured vs spec, within tolerances.
- Mass properties — volume, mass, inertia tensor, centre of gravity.
- Functional checks where applicable (gear: module / pressure-angle / tooth-count
  consistency; balance: moment of inertia in band).
- **Vision check** — the LLM views multi-view renders and judges against intent.
  This is the explicit kill for "data passed, result was a blob."

Any failure routes back to the Sculptor loop with the specific defect.

### L4 — Assembly

**`ai/sculptor/AssemblyBuilder.js`** — on `kernel/assembly/Assembly.js` +
`foundation/KinematicsCore.js`. The LLM declares the kinematic graph as mates:
concentric, coincident, distance, parallel, **gear-mesh** (ratio constraint),
cam-follower. The mate solver resolves all positions; a DOF audit
(Grübler/Kutzbach) confirms the mechanism has exactly the expected mobility
(going train driven at 1 DOF, balance its own oscillatory DOF). A full
interference/clearance check confirms no two solids overlap except at intended
contacts.

### L5 — System Dynamics in Motion

**`ai/sculptor/MovementDynamics.js`** — on `SystemDynamics.js`,
`KinematicsCore.js`, `ExplicitDynamics.js`. The movement must genuinely run:

- Mainspring barrel torque → gear train (mesh ratios) → escape wheel.
- The **escapement** is the hard nonlinear core: intermittent pallet-jewel
  contact, lock → unlock → impulse → drop each half-cycle. `ExplicitDynamics.js`
  (impact solver) is the seed; the escapement contact model is new.
- The **balance + hairspring** is a torsional oscillator — hairspring stiffness ×
  balance moment of inertia → natural frequency.
- **Acceptance signal (measured, not asserted):** the train turns, the
  escapement escapes tooth-by-tooth, and the balance sustains oscillation at the
  design beat (e.g. 28,800 vph / 4 Hz) on mainspring energy.

Honest scope: reduced-order rigid-multibody simulation with a lumped hairspring
and a contact/impulse escapement model — not full elastodynamic FEA of every
part. Flagged as reduced-order, same discipline as `SurvivalSim`.

### L6 — Render in Motion

**`ai/sculptor/MovementRender.js`** — render through the **real Three.js
viewport** (capture the `WebGLRenderer`), per the GE9X render decision; not a
synthetic rasterizer. Time-step the L5 simulation, capture frames, encode via the
existing `JpegEncoder.js` + `VideoMux.js` to an `.mp4` of the running movement.
Materials true-colour via `materialColor.js`. The LLM performs a final vision
check on the video frames.

### L7 — Orchestration + Clarifying-MCQ Swarm

**`ai/sculptor/Orchestrator.js`** — the top-level conductor:

1. **Brief intake** — e.g. "build a Swiss watch movement."
2. **Clarifying-MCQ swarm** — `ai/sculptor/ClarificationSwarm.js`, on existing
   `ai/Clarifier.js`. The LLM expands the brief into a branching decision tree
   and asks the user MCQs (caliber size, escapement type, beat rate, jewel count,
   power reserve, hand-wind vs automatic, finishing grade, …); each answer
   unlocks the next batch. Hundreds of MCQs is emergent from tree depth, not a
   hardcoded count. Answers compile into a frozen **design brief**.
3. **Decompose** — the LLM turns the brief into the full part manifest +
   per-part specs + datum scheme + kinematic graph.
4. **Swarm dispatch** — `ai/sculptor/SculptorSwarm.js`. Each part → a
   `PartSculptor` agent. Independent parts run in parallel (concurrency bounded
   by the manifold-3d WASM heap, not by design); dependent parts ordered by the
   dependency graph. Each runs L2→L3 to verification.
5. **Assemble (L4) → run (L5) → render (L6).**
6. **System closing loop** — if the movement does not sustain oscillation, the
   failure is diagnosed to a specific part or mate and routed back for re-sculpt
   / re-solve. This is the design→analyze→redesign loop that genuinely closes —
   the real target from the autonomous-reframe memory.
7. **Deliverable package** — `ai/sculptor/DeliverablePackage.js` collects the
   run's complete output into one ZIP (via the existing `ZipArchive.js`). The
   ZIP **must include, for every part AND for the assembly**: screenshots (the
   multi-view renders / vision-check images), STEP files (ISO 10303-21 CAD
   export), and the motion `.mp4` video(s). Plus the feature-tree JSON of every
   part (the editable construction history) and the design brief. "All" means
   each individual part gets its own screenshots + STEP + any part-level motion
   clip, not only the final assembly — so a human can open, inspect, and edit
   any single component.

---

## 4. Data Flow (the watch run)

```
user brief
  -> ClarificationSwarm  -- MCQs -->  user  -- answers -->  design brief
  -> Orchestrator.decompose  ->  part manifest + kinematic graph
  -> SculptorSwarm  ->  N x PartSculptor   (each: L2 loop -> L3 verify)
        each PartSculptor:  LLM intent -> SketchSolver -> AtomicOps
                            -> FeatureTree -> GeometryQuery + render -> LLM verify
  -> AssemblyBuilder (L4)  ->  assembled movement + DOF audit + interference
  -> MovementDynamics (L5) ->  measured: train turns, escapement escapes,
                               balance sustains beat
  -> MovementRender (L6)   ->  .mp4 of the running movement
  -> if L5 fails: diagnose -> route to a PartSculptor / AssemblyBuilder -> repeat
```

The `FeatureTree` of every part is the deterministic, human-readable, editable
record — the entire point of "the human can replicate/edit/learn."

---

## 5. Error Handling

- Solver failures (under/over-constrained sketch, failed boolean, non-manifold
  result) are **hard errors** with specific diagnostics — never a silent
  fallback, never a guessed coordinate.
- The "data-passed-but-blob" failure is structurally impossible: no part passes
  L3 without the dimensional audit **and** the LLM vision check; the movement
  does not pass without measured sustained oscillation in L5.
- Every failure carries a feature ID / mate ID / part name so the L7 closing
  loop can route it precisely.
- LLM non-determinism is contained: the `FeatureTree` is the deterministic
  record — a built part replays identically from its history regardless of the
  LLM. Sculptor runs are seeded for reproducibility.
- WASM heap discipline: every intermediate manifold is `.delete()`'d (the GE9X
  590-blade heap-exhaustion lesson). Swarm concurrency is bounded accordingly.

---

## 6. Testing Strategy

- **Unit** — each `AtomicOps` operation; `SketchSolver` convergence;
  `ParametricCurve` evaluators (involute verified against closed-form);
  `TopoNaming` stability across regeneration; `GeometryQuery` accuracy. Curve
  math kept kernel-free so e2e can import it directly.
- **Integration** — the sketch→feature→solid pipeline; a `PartSculptor` building
  a known part feature-by-feature; the mate solver + DOF audit.
- **System / e2e** (Playwright, existing harness) — escalating gates:
  1. a machined bracket (sketch, extrude, hole pattern, fillets);
  2. a sculpted involute gear built atomically from sketch curves — no
     generator;
  3. a going-train sub-assembly that meshes and turns;
  4. the full watch movement: run + render.
  The watch movement is the acceptance gate.
- Every claim of "works" is backed by a viewed render or a measured simulation
  quantity — never triangle counts alone.
- e2e gotchas honoured: bare `import fs from 'fs'` (no `node:*` in specs),
  `./node_modules/.bin/playwright`, `dispatchEvent('click')` for in-transcript
  buttons.

---

## 7. Honest Residual Gaps (named, not hidden)

- **Topological naming** is robust-but-imperfect; pathological edit sequences can
  invalidate a face/edge reference — surfaced as an error, never silent.
- **L5 is reduced-order**: rigid multibody + lumped hairspring + contact/impulse
  escapement model, not full elastodynamic FEA. Flagged in all output.
- **LLM spatial reasoning** is the quality ceiling for L2; the deterministic
  solver constrains numeric error but not conceptual modelling mistakes — the L3
  vision check is the backstop.
- The escapement contact model (lock/unlock/impulse/drop) is new work with no
  existing seed beyond the generic impact solver.

---

## 8. New / Modified Files Summary

**New:**
- `kernel/atomic/Part.js`
- `kernel/atomic/AtomicOps.js`
- `kernel/atomic/SketchProfile.js`
- `kernel/atomic/ParametricCurve.js`
- `kernel/atomic/TopoNaming.js`
- `kernel/atomic/GeometryQuery.js`
- `ai/sculptor/PartSculptor.js`
- `ai/sculptor/PartVerifier.js`
- `ai/sculptor/AssemblyBuilder.js`
- `ai/sculptor/MovementDynamics.js`
- `ai/sculptor/MovementRender.js`
- `ai/sculptor/Orchestrator.js`
- `ai/sculptor/ClarificationSwarm.js`
- `ai/sculptor/SculptorSwarm.js`
- `ai/sculptor/DeliverablePackage.js` — bundles per-part + assembly
  screenshots, STEP files, `.mp4` videos, feature-tree JSON, and the design
  brief into one deliverable ZIP.

**Modified:**
- `kernel/features/FeatureTree.js` — add sketch / cut / pattern feature types.
- `workbenches/mechanical-cad/ToolExecutionEngine.js` — replace canned tool
  stubs with thin `AtomicOps` wrappers.

**Reused as-is:** `SketchSolver.js`, `kernel/topology/Topo*`,
`KinematicsCore.js`, `MotionStudy.js`, `SystemDynamics.js`,
`ExplicitDynamics.js`, `Assembly.js`, `JpegEncoder.js`, `VideoMux.js`,
`ZipArchive.js`, the STEP exporter (`kernel/export/`), `Clarifier.js`,
`PlannerProviders.js`, `materialColor.js`.
