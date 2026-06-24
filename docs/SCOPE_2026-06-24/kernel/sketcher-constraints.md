# Forge Kernel Gap Analysis — 2D Sketcher + Geometric/Dimensional Constraint Solver

> AREA: 2D sketcher + geometric/dimensional constraint solver
> TARGET: full industrial 1:1 parity with **Siemens D-Cubed 2D DCM**
> (constraint diagnostics, DOF, under/over/well-constrained classification,
> drag/move solve, full conic + spline constraint set).
> Grounded in the live kernel at `forge-kernel/` (read 2026-06-24), not recall.
> Discipline (Bible §0): real impl only — no MVP/stub; the vendored planegcs
> engine stays the live solver AND the A/B oracle until each surfaced capability
> is A/B-proven against it; CI-green per increment; dynamic (real solves), not static.

---

## 0. TL;DR — the honest state

Forge has **a world-class 2D constraint solver already compiled into the kernel**
(the full FreeCAD **planegcs** engine, ~280 KLOC of `GCS.cpp` + `Constraints.cpp`
+ `Geo.cpp` + `SubSystem.cpp` + `qp_eq.cpp`, backed by a native Eigen shim). The
engine itself is genuinely capable of **most of D-Cubed 2D DCM's feature set**:
DogLeg/LM/BFGS solvers, QR-based diagnose with conflicting / redundant /
**partially-redundant** tag identification, dependent-parameter groups, DOF count,
~70 constraint primitives over lines/circles/arcs/ellipses/hyperbolas/parabolas/
B-splines, internal-alignment, angle-via-point, Snell's law.

**The gap is almost entirely in the THIN FORGE FACADE, not the engine.** The facade
(`src/Sketcher.cpp`, `include/forge/Sketcher.hpp`) exposes **only 10 constraint
kinds over 3 entity types** and surfaces **none of the diagnostics**. A *separate,
naive, static look-up table* (`src/SketchDof.cpp`) does the "DOF audit" by summing
hard-coded per-kind integers — it never touches the real solver, never detects
*structural* redundancy/conflict, and is wrong the moment a constraint is partially
redundant or a closed loop introduces a coupling. Plus the profile→geometry bridge
(`extractWires`) is still **OCCT-bound** (`BRepBuilderAPI_*`, `gp_*`, `GC_MakeArcOfCircle`).

So the build job is overwhelmingly **"surface what the engine already does + add the
missing entity/constraint plumbing + a real diagnose-driven DOF/conflict report"**,
NOT "write a constraint solver from scratch." This is the rare area where Forge is
*ahead* of where the OCCT_ZERO_ROADMAP implies — the hard numerical core exists.

---

## 1. What Forge has TODAY (grounded)

### 1.1 The solver engine — REAL, compiled, not stubbed
- **`3rdParty/planegcs/GCS.cpp` (234 KB)** — the FreeCAD `GCS::System`. Confirmed
  live (in `CMakeLists.txt` `PLANEGCS_SRC`, lines 124-129; linked into
  `forge-kernel.node`). `System::diagnose()` (GCS.cpp:4776), `makeDenseQRDecomposition`
  (5079), `identifyConflictingRedundantConstraints` (5462), `partiallyRedundantTags`
  (5685-5706), `identifyDependentParameters*` — all present and compiled, **not stubbed**.
- **`3rdParty/planegcs/Constraints.cpp` (91 KB)** — the constraint error/gradient
  functions for the full primitive set.
- **`3rdParty/planegcs/Geo.h` / `Geo.cpp`** — geometry types: `Point`, `Line`,
  `Circle`, `Arc`, `Ellipse`, `ArcOfEllipse`, `Hyperbola`, `ArcOfHyperbola`,
  `Parabola`, `ArcOfParabola`, `BSpline` (poles/weights/knots/degree/periodic),
  each with analytic `Value()` + `CalculateNormal()` + derivatives (`DeriVector2`).
- **`3rdParty/planegcs/SubSystem.cpp`** — subsystem partitioning for the solver.
- **`3rdParty/planegcs/qp_eq.cpp`** — equality-constrained QP for dependent params.
- **`3rdParty/planegcs_eigen_shim/forge_eigen_shim.hpp` (40 KB)** — native Eigen
  drop-in. Provides `FullPivHouseholderQR` (the central diagnose decomposition,
  shim line 766-817, backed by `forge::native::linalg::FullPivHouseholderQR`),
  `ColPivHouseholderQR`, `FullPivLU` (rectangular-aware), and a **dense
  `SparseMatrix<double>` / `SparseQR` adapter** so the `EIGEN_SPARSEQR_COMPATIBLE`
  diagnose branch compiles. Reports `EIGEN_VERSION 3.4.0`. **No external Eigen dep.**
- **`forge_planegcs_stub.h`** — only stubs FreeCAD's `Base::Console`/`Base::TimeElapsed`
  logging+timing helpers (silent in prod). The *math* is untouched.

The engine's public surface (`GCS.h`) that Forge has but does NOT expose includes:
`getConflicting()`, `getRedundant()`, `getPartiallyRedundant()`, `getDependentParams()`,
`getDependentParamsGroups()`, `dofsNumber()`, `isEmptyDiagnoseMatrix()`,
`calculateConstraintErrorByTag()`, `undoSolution()`, `clearByTag()`, driven
(reference/measurement) constraints via `declareDrivenParams()` / `evaluateDrivenConstraints()`.

### 1.2 The Forge facade — what's actually reachable from JS
`src/Sketcher.cpp` (653 LOC) + `include/forge/Sketcher.hpp` + binding `src/binding.cpp:1796-1910`,
exposed as `forge.sketcher.*`:
- **Entities (3):** `addPoint`, `addLine`, `addCircle`, `addArc`
  (`Sketcher.cpp:219-278`). NO ellipse/hyperbola/parabola/b-spline despite the
  engine supporting all of them.
- **Constraints (10):** `Coincident, Parallel, Perpendicular, Distance, Horizontal,
  Vertical, PointOnLine, PointOnCircle, Equal, Tangent` (`SketchConstraintKind`,
  Sketcher.hpp:59-70; dispatch `Sketcher.cpp:281-372`). `Tangent` is hard-wired to
  line↔circle with `ccw=true` only (`Sketcher.cpp:359-366`).
- **Solve:** `solve()` runs `declareUnknowns → initSolution → solve(DogLeg)`
  (`Sketcher.cpp:375-412`); returns `{status, dof, iterations=0}`.
- **Diagnostics surfaced:** only a 3-state `status` (`Success/Failed/Inconsistent`)
  derived from `hasConflicting()` + sign of `dof`. **Conflicting/redundant/
  partially-redundant TAG LISTS and dependent-param groups are computed by the
  engine but DROPPED on the floor** — `grep` of `binding.cpp` for `getConflicting|
  getRedundant|getDependentParams|diagnose(` returns **zero hits**.
- **Read/write:** `readPoint`, `writePoint` (set-then-solve only; no temp/drag constraint).
- **Profile bridge:** `extractWires()` — **OCCT-bound** (`BRepBuilderAPI_MakeEdge/Wire`,
  `GC_MakeArcOfCircle`, `gp_*`, `Sketcher.cpp:20-34, 436-532`). `extractProfileRings()`
  — native, OCCT-free, samples to `Point2` rings (`Sketcher.cpp:540-651`). So the
  facade is half-migrated; OCCT removal of `extractWires` is roadmap item W2.5.

### 1.3 The "DOF audit" — a separate STATIC stand-in (the weakest link)
`src/SketchDof.cpp` (70 LOC) + `include/forge/SketchDof.hpp`, exposed as
`forge.sketchdof.audit` (`binding.cpp:7652+`):
- Sums **hard-coded** per-entity DOF (`point 2, line 4, circle 3, arc 5`) minus
  **hard-coded** per-constraint DOF (`coincident 2, distance 1, tangent 1, …`),
  reports `under/fully/over` from the sign of `freeDof` (`SketchDof.cpp:45-68`).
- **It never runs the solver.** It cannot detect: structural redundancy (two
  constraints that remove the same DOF), partial redundancy, a constraint that's
  satisfiable but locally degenerate, numerically-conflicting-but-dimensionally-
  countable systems, or which *specific* entities/constraints are the offenders.
  It is a counting heuristic, not a constraint-graph analysis. The smoke test
  `test/smoke-sketchdof.js` only checks the arithmetic. This is the *opposite* of
  what D-Cubed DCM does (it diagnoses the actual rank of the Jacobian).

### 1.4 Tests
- `test/sketcher_smoke.js` — 3 scenarios (distance solve; coincident+distance =
  Inconsistent; rectangle horizontal+parallel). Real solves, but tiny.
- `test/smoke-sketchdof.js` — static-arithmetic checks only.
- **No** drag test, no redundancy-identification test, no conic/spline test, no
  large-system / convergence / determinism test, no oracle A/B harness.

---

## 2. The GAP vs Siemens D-Cubed 2D DCM (specific, concrete)

D-Cubed 2D DCM is the industry reference embedded in NX/SolidWorks/Inventor/SpaceClaim.
Parity means matching its **feature set, data structures, and operational paradigms**.
Below, each item is tagged **[ENGINE HAS — SURFACE IT]** (planegcs already implements it;
Forge just needs facade + binding + A/B test) or **[ENGINE LACKS — BUILD IT]** (genuinely
new native code).

### 2.1 Constraint diagnostics & status (DCM's headline feature)
- **No conflicting-constraint report.** [ENGINE HAS — SURFACE IT] `getConflicting(VEC_I&)`
  returns the offending TAG list; Forge never reads it. DCM returns the exact set of
  mutually-inconsistent constraints so the UI can highlight them in red.
- **No redundant-constraint report.** [ENGINE HAS — SURFACE IT] `getRedundant()`.
- **No partially-redundant report.** [ENGINE HAS — SURFACE IT] `getPartiallyRedundant()`
  — DCM distinguishes "redundant (removable, no info lost)" from "partially redundant"
  (over-determines a sub-DOF). planegcs already computes this (`partiallyRedundantTags`).
- **No dependent/under-constrained DOF report.** [ENGINE HAS — SURFACE IT]
  `getDependentParams()` + `getDependentParamsGroups()` tell you *which* geometry is
  still free — DCM's "drag to see what moves" / DOF arrows. Forge returns only a scalar.
- **No well-constrained vs structurally-vs-numerically distinction.** [ENGINE HAS]
  DCM separates *structural* (rank) under/over-constraint from *numeric* failure;
  planegcs's `diagnose()` + `SuccessfulSolutionInvalid` give this, but the facade
  collapses everything to 3 states.
- **No per-constraint residual / "constraint not satisfied" query.** [ENGINE HAS —
  SURFACE IT] `calculateConstraintErrorByTag(tag)`. DCM reports residuals per constraint.
- **Static DOF audit must be replaced by solver-driven diagnose.** [BUILD: replace
  `SketchDof.cpp`] The counting model is structurally wrong for coupled systems.

### 2.2 Missing entity types in the facade
- **No ellipse / arc-of-ellipse.** [ENGINE HAS — SURFACE IT] (`GCS::Ellipse`, `ArcOfEllipse`).
- **No hyperbola / arc-of-hyperbola.** [ENGINE HAS] (`GCS::Hyperbola`, `ArcOfHyperbola`).
- **No parabola / arc-of-parabola.** [ENGINE HAS] (`GCS::Parabola`, `ArcOfParabola`).
- **No B-spline (NURBS curve in 2D).** [ENGINE HAS] (`GCS::BSpline`, poles/weights/
  knots/degree/periodic) — DCM supports rational B-spline constraints; planegcs has
  `addConstraintPointOnBSpline`, `addConstraintTangentAtBSplineKnot`,
  `InternalAlignmentBSplineControlPoint`, `InternalAlignmentKnotPoint`.
- **No standalone point-as-entity / no construction geometry flag.** [BUILD: facade]
  DCM tags geometry as construction (ignored in profile extraction but live in
  constraints). Forge has no construction/normal distinction.

### 2.3 Missing constraints in the facade (engine has the primitive)
[All ENGINE HAS — SURFACE IT, citing `GCS.h`]:
- **Radius / Diameter** (`addConstraintCircleRadius/Diameter`, `addConstraintArcRadius/Diameter`)
  — *fundamental dimensional constraints, currently absent.*
- **Angle** between two lines (`addConstraintL2LAngle`) and **angle-via-point** for
  curve↔curve (`addConstraintAngleViaPoint/TwoPoints`) — *no angle constraint at all today.*
- **Symmetric** about a line/point (`addConstraintP2PSymmetric`).
- **Midpoint** on line (`addConstraintMidpointOnLine`, `addConstraintPointOnPerpBisector`).
- **Concentric** (= coincident centers; DCM treats as first-class).
- **Fix / lock coordinate** (`addConstraintCoordinateX/Y`) — *DCM "fixed" / ground;
  Forge has no way to pin a point.*
- **Point-to-line distance** with side (`addConstraintP2LDistance`, ccw).
- **Point-to-circle / circle-to-circle / circle-to-line distance**
  (`addConstraintP2CDistance`, `addConstraintC2CDistance`, `addConstraintC2LDistance`).
- **Equal-length / equal-radius across mixed types** (line↔line, circle↔arc, arc↔arc,
  ellipse↔ellipse) — facade only does line↔line and circle↔circle, throws on arcs
  (`Sketcher.cpp:355`).
- **Tangent in all flavors** (line↔arc, circle↔circle, circle↔arc, arc↔arc, line↔ellipse,
  perpendicular-line-to-arc, etc. — `GCS.h:453-458, 429-452`). Facade does only line↔circle.
- **Tangent-via-point / endpoint-to-endpoint tangency** (G1 continuity) — DCM core for
  fillets/profiles.
- **Internal-alignment constraints** for conics & splines (focus, major/minor diameter,
  control points, knots) — needed for any real ellipse/spline editing.
- **Snell's law** (`addConstraintSnellsLaw`) — optical layout (DCM has it; niche but real).
- **Arc rules / arc-of-conic rules** (`addConstraintArcRules`, etc.) — the consistency
  constraints that keep arc start/end/angle coherent; currently the facade derives
  angles once at insert and never re-enforces them.

### 2.4 Missing operational paradigms (DCM's *interaction* model)
- **No drag / move-solve.** [ENGINE HAS — SURFACE IT] DCM's primary editing mode:
  apply a *temporary* low-priority constraint (`SpecialTag DefaultTemporaryConstraint
  = -1`, GCS.h:101-104) pulling a point toward the cursor, solve incrementally, keep
  the rest stable. planegcs supports exactly this (negative-tag temp constraints,
  `clearByTag`); the facade has no `dragPoint(handle, x, y)` entry point.
- **No driving vs driven (reference/measurement) constraints.** [ENGINE HAS]
  `declareDrivenParams` / `evaluateDrivenConstraints` — DCM distinguishes a dimension
  that *drives* geometry from one that merely *measures* it. Facade hard-codes `driving=true`.
- **No incremental edit / undo of a solve.** [ENGINE HAS — SURFACE IT] `undoSolution()`,
  `setReference()`/`resetToReference()`. DCM rolls back a failed drag.
- **No constraint/entity removal or replacement.** [ENGINE HAS] `removeConstraint`,
  `clearByTag`. Facade is add-only; you can't delete a constraint and re-diagnose.
- **No solver tuning surface.** [ENGINE HAS] algorithm choice (DogLeg/LM/BFGS),
  `maxIter`, `convergence`, `qrAlgorithm`, `autoChooseAlgorithm` — all hard-coded.
- **No "what-if" / move-and-report-DOF.** DCM lets you query DOF arrows before editing.
- **No persistence / serialization** of a sketch (save/restore the constraint network).

### 2.5 Missing higher-level sketcher features (some BUILD, some glue)
- **No auto-constraint / inference** (snap-to-horizontal, coincident-on-hover) —
  [BUILD] heuristic layer above the solver; DCM/NX has this.
- **No projected / external geometry** (project a 3D edge/face boundary into the
  sketch plane as a constrained reference) — [BUILD: needs the BRep→plane projection;
  related to roadmap HLR/`ProjectSilhouette`]. Core for sketch-on-face workflows.
- **No symmetry/pattern at sketch level** (mirror, linear/circular pattern of
  constrained geometry) — [BUILD: facade-level expansion that re-emits constraints].
- **No offset-curve / equidistant constraint** in 2D — DCM supports it; planegcs
  does not have a native offset entity (the 2D offset is roadmap CAM item W3.7).
- **No trimming/splitting/extending with constraint preservation** — [BUILD].
- **No fillet/chamfer at a sketch corner** (auto-insert arc + tangent constraints) —
  [BUILD: glue, uses existing tangent + coincident].
- **No blocked/rigid sub-group ("block" constraint)** — DCM groups geometry as a
  rigid body; the static SketchDof even *lists* `block` as an override but the solver
  facade can't express it. [BUILD: facade — lock relative transform of a sub-graph].
- **No conic-through-5-points / spline-through-points fitting** — [BUILD].

### 2.6 Robustness / quality gaps
- **No determinism / reproducibility guarantee** across runs (solver seeded from
  current values; fine, but untested).
- **No A/B oracle harness** — there is *no second solver* to validate against, and the
  static DOF audit can't be the oracle. (See §3 on how to get an oracle.)
- **No large-system / performance test** — DCM scales to thousands of constraints;
  Forge's largest test is a 4-line rectangle.
- **`extractWires` still OCCT-bound** — blocks the OCCT-zero goal for the profile
  hand-off (roadmap W2.5).

---

## 3. Prioritized, incremental, A/B-verifiable build plan

**Oracle strategy (Bible §0 compliance).** Unlike booleans (where OCCT is the oracle),
the constraint solver's oracle problem is special: planegcs *is* the engine, so it can't
be its own A/B oracle for the *engine*. But the *gap here is the FACADE*, so the oracle
model is:
1. For **surfaced engine capabilities** (most of §2.1-2.4): the oracle is the engine's
   own internal state cross-checked two ways — (a) `diagnose()` rank vs an independent
   in-house symbolic DOF count, and (b) post-solve **residual = 0** verified by
   `calculateConstraintErrorByTag` AND by an independent constraint-evaluation pass in
   the test. A surfaced "conflicting tag = {3,7}" is A/B-proven when an independent
   minimal-subset search confirms {3,7} is genuinely unsatisfiable.
3. For **new constraints/entities**: the oracle is a **known-answer geometric set**
   (closed-form: e.g. tangent line to a circle has a known foot; symmetric points have a
   known reflection) — assert the solved geometry matches the analytic answer to 1e-9.
4. **Keep a frozen golden corpus** of (sketch JSON → expected solved coords + expected
   diagnose report) so the facade can never silently regress.

Each step ships complete (no stub), CI-green, with a HEADED/real e2e where a UI exists.

---

### PHASE A — Surface the diagnostics the engine already computes (HIGHEST ROI, low risk)

**A1. Real diagnose report out of `solve()`.** ~120 LOC (`Sketcher.cpp` + `Sketcher.hpp`
+ `binding.cpp`). After `solve()`, call `gcs.getConflicting/getRedundant/
getPartiallyRedundant/getDependentParams(Groups)` and return arrays of constraint
tags + dependent-geometry IDs in `SketchSolveResult`. Map dependent params back to
entity/point IDs via the existing param pool.
- *Native subsystem:* planegcs `System` diagnose (already compiled).
- *Verify:* build the canonical over/under/partially-redundant fixtures (e.g. triangle
  with all-three angles + all-three sides = partially redundant), assert the exact tag
  sets; independent minimal-unsat search confirms. Add `test/sketcher_diagnose.spec.js`.
- *Result:* this alone closes the single biggest D-Cubed-parity gap.

**A2. Replace static `SketchDof.cpp` with a solver-backed audit.** ~80 LOC.
Keep the public `forge.sketchdof.audit` signature, but internally build a real
`GCS::System` from the entity/constraint list and return `dofsNumber()` +
conflicting/redundant tags + dependent-param geometry. Keep the static table only as a
*pre-solve estimate* field for UX. Delete the wrong-by-design counting as the source of truth.
- *Verify:* the rectangle and triangle fixtures where the static count and the real rank
  *disagree* (coupled loops) — assert the solver value; A/B the two and document the divergence.

**A3. Per-constraint residual + constraint error query.** ~40 LOC.
Surface `calculateConstraintErrorByTag`. *Verify:* perturb a solved sketch, assert
nonzero residual on exactly the violated tag.

### PHASE B — Drag/move solve + driving/driven + edit lifecycle (the DCM interaction core)

**B1. `dragPoint(handle, pid, x, y)`.** ~100 LOC. Add a temporary
`addConstraintCoordinateX/Y` (or P2P-to-cursor) with tag `-1`, `solve()`, then
`clearByTag(-1)`. *Native:* planegcs temp-constraint paradigm (GCS.h:101). *Verify:*
drag a corner of an under-constrained rectangle, assert constrained edges hold and only
the free DOF moved; `undoSolution` restores on a failed drag.

**B2. Driven (reference/measurement) constraints.** ~80 LOC. Add a `driving` flag to
`addConstraint`; route to `declareDrivenParams` + `evaluateDrivenConstraints`. *Verify:*
a driven distance reports the measured value and does NOT move geometry.

**B3. Constraint/entity removal + re-diagnose.** ~60 LOC. Surface `removeConstraint`/
`clearByTag` keyed on the returned tag. *Verify:* add→over-constrain→remove→diagnose
returns to well-constrained.

**B4. Solver config + undo surface.** ~40 LOC. Expose algorithm, maxIter, convergence,
`undoSolution`, `setReference`. *Verify:* a hard system that fails under default DogLeg
converges under LM; undo restores pre-solve coords.

### PHASE C — Full entity + constraint catalogue (engine has the primitives)

**C1. Dimensional constraints: Radius, Diameter, Angle, Fix/Lock-coordinate.** ~150 LOC.
Route to `addConstraintCircleRadius/Diameter`, `addConstraintArcRadius/Diameter`,
`addConstraintL2LAngle`, `addConstraintCoordinateX/Y`. *Verify:* known-answer (a radius
constraint forces |center-point|=r exactly).

**C2. Geometric constraints: Symmetric, Midpoint, Concentric, P2L/P2C/C2C/C2L distance,
all Tangent flavors, mixed Equal.** ~250 LOC. *Verify:* analytic known-answer per pair.

**C3. New entities: Ellipse + ArcOfEllipse + their internal-alignment constraints.**
~200 LOC. Mirror the Arc plumbing for `GCS::Ellipse`/`ArcOfEllipse`, add focus/major/minor
internal-alignment. Extend `extractProfileRings` to sample ellipses. *Verify:* point-on-
ellipse + radii known-answer; profile ring area vs analytic ellipse area.

**C4. New entities: Parabola, Hyperbola + arcs.** ~200 LOC. Same pattern.

**C5. New entity: 2D B-spline (rational).** ~300 LOC. Plumb `GCS::BSpline`
(poles as points, weights, knots, degree, periodic); add point-on-spline,
tangent-at-knot, control-point/knot internal alignment. Extend ring sampler via the
existing `BSpline::Value`. *Verify:* de Boor evaluation vs an independent NURBS evaluator;
constrained spline endpoint coincidence to 1e-9.

### PHASE D — Sketcher productivity features (mostly facade glue, some new native)

**D1. Construction geometry flag + sketch serialization.** ~120 LOC. Tag entities
construction/normal; exclude construction from `extractProfileRings`; add save/restore
of the full network (JSON). *Verify:* round-trip a sketch, re-solve, identical coords + diagnose.

**D2. Fillet/chamfer at corner + trim/split/extend with constraint preservation.**
~200 LOC. Glue over existing tangent+coincident. *Verify:* fillet two lines → arc tangent
to both, corner DOF unchanged.

**D3. Mirror / linear+circular pattern of constrained geometry.** ~200 LOC. Re-emit
geometry + symmetric/equal constraints. *Verify:* mirrored geometry is exact reflection.

**D4. Auto-constraint inference (snap H/V/coincident/tangent on create).** ~250 LOC.
Heuristic layer; emits real constraints then diagnoses. *Verify:* drawing a near-horizontal
line within tol auto-adds Horizontal and DOF drops by 1.

**D5. Block / rigid sub-group constraint.** ~150 LOC. Lock relative transform of a
sub-graph (compose coincident+fixed-relative). *Verify:* dragging one member rigidly
moves the group.

### PHASE E — Projected/external geometry + OCCT removal of the bridge

**E1. Retire OCCT `extractWires`.** ~80 LOC delete + reroute callers to
`extractProfileRings` (roadmap W2.5; `extractProfileRings` already exists). *Verify:*
A/B the wire-derived vs ring-derived profile area/centroid to 1e-9 across the test corpus,
then delete the OCCT include block (`Sketcher.cpp:20-34`).

**E2. Projected/external geometry.** ~250 LOC. Project a native BRep edge/face boundary
onto the sketch plane → reference (construction) geometry the solver can constrain to.
Depends on the native surface/curve projection (shares substrate with HLR `ProjectSilhouette`).
*Verify:* project a known cylinder edge, assert the projected curve matches the analytic ellipse.

### PHASE F — Scale, determinism, performance, oracle hardening

**F1. Large-system + determinism + perf regression.** ~150 LOC test. 1000+ constraint
sketches (e.g. a gear tooth profile array), assert convergence, deterministic coords across
runs, and a wall-clock budget. *Verify vs* a frozen golden corpus.

**F2. Golden-corpus A/B harness.** ~150 LOC. Freeze (sketch → solved coords + diagnose
report) pairs; CI fails on any drift. This is the standing oracle once OCCT is gone.

---

**Rough total:** ~3.5–4.0 KLOC of facade/binding/test code (the heavy numerical core is
already in-tree). Phase A is ~250 LOC and closes the marquee gap.

---

## 4. The single biggest blocker + critical path

### Biggest blocker — NOT a missing engine; it's the **un-surfaced diagnose pipeline**.
The one capability that *defines* D-Cubed 2D DCM — **constraint diagnostics: telling the
engineer the exact conflicting set, the redundant set, the partially-redundant set, and
which geometry is still free (DOF)** — is **fully computed by the compiled planegcs engine
and thrown away by the Forge facade.** Until that is surfaced (Phase A), Forge's sketcher
reports a single 3-state flag where DCM reports a structured, actionable diagnosis. Every
downstream sketcher UX (red-highlight conflicts, DOF arrows, "remove this redundant
dimension") is blocked on it. The good news: it is the *lowest-effort, highest-value* item
in the entire plan (~120 LOC, the engine already does the math).

### Secondary structural blocker — the **static `SketchDof.cpp` is a false oracle**.
As long as the "DOF audit" is a hard-coded counting table that never runs the solver, any
claim of "constraint health" parity is unfounded — it is wrong for every coupled/looped
sketch (the common case). It must be replaced by the solver-driven diagnose (A2), and it
must not be allowed to remain as a parallel "source of truth."

### Critical path (must-precede order)
```
A1 (surface diagnose)  ──►  A2 (kill static DOF, solver-backed)  ──►  A3 (residuals)
        │
        └─► B1 (drag)  ──►  B2 (driven)  ──►  B3 (remove/re-diagnose)  ──►  B4 (config/undo)
                                                     │
   C1 (radius/dia/angle/fix) ─┐                      │
   C2 (geom constraints)      ├─► C3 (ellipse) ─► C4 (parab/hyperb) ─► C5 (b-spline)
                              │                      │
                              └──────────────────────┴─► D1..D5 (productivity)
                                                              │
   E1 (retire OCCT extractWires) ──► E2 (projected geometry) ─┘
                                                              │
                                              F1/F2 (scale + golden-corpus oracle)
```
**Order rationale:** A1→A2→A3 unlock the diagnostic spine everything else relies on for
verification. B-phase is independent of new entities and delivers the DCM *interaction*
paradigm early. C-phase entities all branch off the diagnose spine. E1 (OCCT removal) can
proceed in parallel once `extractProfileRings` is the sole profile path. F closes with the
standing oracle that lets OCCT be deleted globally without losing a truth source.

### Why this area is *ahead* of the OCCT_ZERO_ROADMAP's framing
The roadmap lists Sketcher as "partial" and "not A/B-testable (2D)". That is true of the
*OCCT profile bridge* (`extractWires`, W2.5) — but it understates that the **constraint
SOLVER itself is already a complete, native, in-house-compiled, dependency-free engine.**
The work here is surfacing + cataloguing + interaction + test, not building a solver. This
is the cheapest path to a genuine 1:1 industrial-parity claim in the whole kernel.
