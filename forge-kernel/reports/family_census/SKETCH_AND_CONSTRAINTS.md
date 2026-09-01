# Family census — 2D SKETCHING and the CONSTRAINT SOLVER

**Pinned at** `a457bea2e9e82a129ea7b0b719fb8a4b56ccaad9` (`origin/claude/sacrosanct-execution-20260828`, 2026-08-31).
Every `file:line` below was read at that SHA. Nothing here is recalled.

---

## 0. The headline, stated first because it inverts the brief

The brief says **"Forge has NO SKETCHER. This was recorded as the single biggest gap versus NX."**

That is true of the **app** and true of the **IR**. It is **false of the kernel**.

Forge has a **world-class 2D geometric constraint solver already vendored, already compiled,
already linked, and already exposed to JS** — the FreeCAD **planegcs** engine, verbatim, with a
Forge-native facade over it, complete with rank-based DOF, conflicting-tag identification,
redundancy classification and per-constraint residuals.

I did not infer this from a grep. **I ran it.** Loading the built addon and driving four
scenarios through `forge.sketcher.*` + `forge.sketch.diagnose.*`:

```
A under-constrained rectangle (4 pts, 4 lines, H on one line, V on one line)
  solve = {"status":0,"dof":6}   classification = "under"
  dependentParams = 16 across 6 coupling groups

B over-constrained (two points, COINCIDENT *and* DISTANCE 10)
  solve = {"status":2,"dof":2}   classification = "over"
  conflicting = [1, 2]           <-- the two offending constraint TAGS, by name
  residuals   = [{tag:1, residual:3.5355339059327378}, {tag:2, residual:-5}]

C redundant-but-consistent (H on two lines + PARALLEL between them)
  classification = "under"       redundant = [3]   <-- the PARALLEL tag, removable

D solver-backed audit of a 4-line rectangle with H,H,V,V
  {"totalEntities":4,"totalConstraints":4,"staticEstimate":8,"solverDof":4,"status":"under"}
                                 ^^^ the static counting table says 8. The solver says 4.
```

Scenario **B** is the exact capability the brief's requirement #5 asks for — *"an over-constrained
sketch must be DIAGNOSABLE (name the conflicting constraints), never a hard refusal"*. **It is
already built and it already names them.** Nothing in the IR, the compiler, the app or CI ever
calls it.

> **Provenance caveat, stated because it matters.** The binary I drove is
> `forge-kernel/build/Release/forge-kernel.node` in the shared checkout (built 2026-08-28 00:56).
> Its `sketcher.kinds` exposes **14** constraint kinds; the source at this pinned SHA declares
> **10** (`Sketcher.hpp:59-70`). `git log --all -S PointOnObject -- forge-kernel/src/Sketcher.cpp
> forge-kernel/include/forge/Sketcher.hpp` returns **nothing** — the extra four (`PointOnObject`,
> `Radius`, `Diameter`, `Angle`) exist only as **uncommitted work in the shared checkout**
> (the shared checkout's `forge-kernel/include/forge/Sketcher.hpp:77-84`, mtime 2026-08-28 06:05),
> on no origin branch. Every behaviour I cite above (`solve`, `diagnose`, `audit`, `residuals`,
> conflicting/redundant tags, the classification strings) is present *identically* in the pinned
> source, so the observations hold. The *count* 14 is that binary's, not this SHA's. This is the
> "measure only from a tree pinned to origin" trap, and it caught me — I am reporting both numbers
> rather than the convenient one.

> **RESOLVED 2026-09-01 — the caveat above is now closed, in the repository.**
> The four kinds that existed only as uncommitted work in a shared checkout
> (`PointOnObject`, `Radius`, `Diameter`, `Angle`) are committed, and so are six
> more: `Concentric`, `Collinear`, `Symmetric`, `Midpoint`, `Fix`, `DistanceX`
> and `DistanceY`. `forge::SketchConstraintKind` declares **20** kinds and
> `CON` dispatches all **19** keywords of the table in §4 below — measured by
> PROBING the compiler with each keyword, not by reading a table
> (`forge-kernel/test/ft/sketch_solve_test.cpp`, case M, with an absent keyword
> as the probe's own control). Three refusals went with them: `EQUAL` on arcs,
> `TANG` on anything but line-circle, and `PTON` onto a circle or an arc.
>
> The count discrepancy this caveat recorded (a built binary reporting 14 kinds
> against a source declaring 10) is exactly the trap it named — and the fix was
> not to trust the binary but to WRITE THE SOURCE. Everything the binary could
> do, the repository can now do, and 100 checks in the gate say which.

---

## 1. Census

Legend — **reachable from IR?** means: can a `forge::ft` feature-tree statement cause it.
**user-invocable?** means: does a `forge::ui` registry command emit it.

| op / capability | exists in kernel? (file:line) | reachable from IR? | user-invocable? | value kinds needed | what it would take | benchmark that scores it |
|---|---|---|---|---|---|---|
| **— SOLVER ENGINE —** | | | | | | |
| Newton/DogLeg/LM/BFGS constraint solve | **YES** `3rdParty/planegcs/GCS.cpp` (234 KB), sources listed `CMakeLists.txt:1266-1272`, linked `:1800` (`forge_kernel`) and `:1889` (`forge_kernel_core`) | **no** | **no** | — | **nothing.** It compiles today. | all sketch-shaped |
| Jacobian-rank DOF (`dofsNumber`) | **YES** `GCS.h:636` → surfaced `Sketcher.cpp:771` | no | no | — | nothing | ParaCAD |
| Conflicting-constraint **tag list** | **YES** `GCS.h:640` → `Sketcher.cpp:778, 782` | no | no | — | nothing | — (repair loop) |
| Redundant / partially-redundant tags | **YES** `GCS.h:644, 648` → `Sketcher.cpp:779-780, 783-784` | no | no | — | nothing | — |
| Dependent-param groups ("what is still free") | **YES** `GCS.h:652, 656` → `Sketcher.cpp:787-802` | no | no | — | nothing | — |
| Per-constraint residual by tag | **YES** `GCS.h:603` → `Sketcher.cpp:826-829`, `831-840` | no | no | — | nothing | — |
| under/well/over/redundant classification | **YES** `Sketcher.cpp:811-822` | no | no | — | nothing | ParaCAD |
| Solver-backed DOF audit | **YES** `Sketcher.cpp:842-870` | no | no | — | nothing | — |
| **— SKETCH ENTITIES —** | | | | | | |
| Point | **YES** `Sketcher.cpp:266` | **internally only** — `FeatureTreeCompiler.cpp:797, 829` calls it, but no IR statement addresses a point | no | `SKETCHREF` | new IR op `SPT` | Drawing2CAD |
| Line | **YES** `Sketcher.cpp:277` | internally only (`FeatureTreeCompiler.cpp:802-803`) | no | `SKETCHREF` | new IR op `SLINE` | Drawing2CAD |
| Circle | **YES** `Sketcher.cpp:290` | internally only (`FeatureTreeCompiler.cpp:830`) | no | `SKETCHREF` | new IR op `SCIRC` | Drawing2CAD |
| Arc | **YES** `Sketcher.cpp:302` | internally only (`FeatureTreeCompiler.cpp:819-822`) | no | `SKETCHREF` | new IR op `SARC` | Drawing2CAD |
| Ellipse / ArcOfEllipse | **engine YES** `planegcs/Geo.h:258, 280`; **facade NO** | no | no | `SKETCHREF` | facade ctor + param-pool entry + `mapParamToGeometry` arm + ring sampling | BenchCAD |
| Hyperbola / Parabola (+ arcs) | **engine YES** `Geo.h:296, 318, 332, 344`; **facade NO** | no | no | `SKETCHREF` | same, ×4 | rare |
| **B-spline (2D NURBS curve)** | **engine YES** `Geo.h:358` (poles/weights/knots/degree/periodic); **facade NO** | no | no | `SKETCHREF` | facade ctor + variable-length param pool + `PointOnBSpline`/`TangentAtBSplineKnot`/internal-alignment arms | **BenchCAD, CADGenBench** — GT `archie_edit_214` input is **67 bspline faces** of 430 |
| Construction geometry flag | **ABSENT** everywhere (`grep construction Sketcher.*` = 0 hits) | no | no | `SKETCHREF` | a bool per entity + skip in `extractProfileRings` | Drawing2CAD |
| **— GEOMETRIC CONSTRAINTS —** | | | | | | |
| Coincident, Parallel, Perpendicular, Horizontal, Vertical, PointOnLine, PointOnCircle, Equal, Tangent | **YES** decl `Sketcher.hpp:59-70`, dispatch `Sketcher.cpp:328-419` | **NO — zero IR statements reach `forge::addConstraint`** (verified: 0 hits in `FeatureTreeCompiler.cpp`) | no | `SKETCH`, `SKETCHREF` | new IR op `CON` | Text2CAD-Bench, ParaCAD |
| Concentric | **engine YES** (`P2PCoincident` on centres); facade **NO** | no | no | `SKETCH` | 1 switch arm | ParaCAD |
| Collinear | **engine YES** (`PointOnLine` ×2); facade **NO** | no | no | `SKETCH` | 1 switch arm | ParaCAD |
| Symmetric | **engine YES** `GCS.h addConstraintP2PSymmetric`; facade **NO** | no | no | `SKETCH` | 1 switch arm | ParaCAD |
| Midpoint | **engine YES** `addConstraintMidpointOnLine`; facade **NO** | no | no | `SKETCH` | 1 switch arm | ParaCAD |
| **Fix / lock coordinate** | **engine YES** `addConstraintCoordinateX/Y`; facade **NO** — *there is no way to pin a point today* | no | no | `SKETCH` | 1 switch arm | all |
| Tangent beyond line↔circle | **engine YES** (arc↔arc, circle↔circle, …); facade hard-wires line↔circle with `ccw=true` (`Sketcher.cpp:409-413`) | no | no | `SKETCH` | dispatch on entity-kind pair | BenchCAD |
| **— DIMENSIONAL CONSTRAINTS —** | | | | | | |
| Distance (point↔point, driving) | **YES** `Sketcher.cpp:352-357` | no | no | `SKETCH` | reachable via `CON` | Drawing2CAD, ParaCAD |
| **Radius / Diameter** | **engine YES** `addConstraintCircleRadius/Diameter`, `ArcRadius/Diameter`; facade **NO at this SHA** (present in the uncommitted shared-checkout work) | no | no | `SKETCH` | 1 switch arm each | **Drawing2CAD** (every hole callout) |
| **Angle** (line↔line) | **engine YES** `addConstraintL2LAngle`; facade **NO at this SHA** (same) | no | no | `SKETCH` | 1 switch arm | **Drawing2CAD** |
| Point↔line / point↔circle / circle↔circle distance | **engine YES** `addConstraintP2LDistance`, `P2CDistance`, `C2CDistance`, `C2LDistance`; facade **NO** | no | no | `SKETCH` | 4 switch arms | Drawing2CAD |
| Driving vs **driven** (reference) dimension | **engine YES** `GCS.h:608` `declareDrivenParams`; facade **NO** (0 hits) | no | no | `SKETCH` | facade flag + a second declare pass | — |
| **— OPERATIONAL PARADIGMS —** | | | | | | |
| Drag / move-solve (temp constraint) | **engine YES** (negative-tag temp constraints, `GCS.h:92-104`); facade **NO** — no `dragPoint` (0 hits) | no | no | `SKETCH` | facade entry + `clearByTag` after each drag | — (interactive only) |
| Remove a constraint / `clearByTag` | **engine YES** `GCS.h:266`; facade **NO** — add-only (0 hits) | no | no | `SKETCH` | facade entry | — (**needed by the repair contract, §5**) |
| `undoSolution` / rollback a failed solve | **engine YES** `GCS.h:624`; facade **NO** (0 hits) | no | no | `SKETCH` | facade entry | — |
| Solver tuning (algorithm / maxIter / convergence) | **engine YES**; facade hard-codes `solve(isFine=true, DogLeg)` `Sketcher.cpp:430` | no | no | — | parameter struct | — |
| **— SKETCH → GEOMETRY —** | | | | | | |
| `extractWires` → `TopoDS_Wire` (OCCT) | **YES** `Sketcher.cpp:483-593` | yes (via `extrudeProfile`) | yes | `PROFILE` | — (OCCT-bound; drop-ladder item) | — |
| `extractProfileRings` → native `Point2` rings | **YES** `Sketcher.cpp:602-715`, consumed `Features.cpp:278, 289, 559, 654` | yes | yes | `PROFILE` | extend to ellipse/spline | — |
| **Sketch plane / sketch-on-face** | **ABSENT.** `Sketcher.hpp:159-165` states the sketch *is assumed to live on the XY plane (Z=0)* | no | no | `SKETCH` (a plane field) | plane on the sketch + post-transform of the built solid | **all history-based CAD** |
| **— IR / APP REACHABILITY —** | | | | | | |
| `SKETCH` IR value kind | **ABSENT.** `Val { enum Kind { Profile, Wire, Solid } }` `FeatureTreeCompiler.cpp:593-596` | n/a | n/a | **the new kind** | see §3 | — |
| Any IR op creating a sketch entity or constraint | **ABSENT** — 0 of the 40 `OpCode`s (`FeatureTree.hpp:67-160`) | — | — | `SKETCH`,`SKETCHREF` | 9 new ops (§4) | Text2CAD-Bench |
| Any IR call to `addConstraint` / `solve` | **ABSENT** — verified 0 hits for `forge::addConstraint\|forge::solve` in `FeatureTreeCompiler.cpp` | — | — | — | — | — |
| UI sketch mode / entity tools / constraint tools | **ABSENT.** The registry's only "sketch" commands are `part.sketch_rect` / `part.sketch_circle` — parametric primitives *labelled* sketch (`PartCommands.cpp:466, 504`; node prefix `sketchNodeFor`, `:318`) | — | (rect/circle only) | `SKETCH` | a workspace (§3, months) | all |
| Dock panels `viewport_sketch`, `sketch_tree`, `constraints` | **declared, empty** — `forge-desktop/src/ForgeFrame.cpp:58, 63` names all three as dock ids; nothing renders into them | — | — | — | — | — |
| **Any CI gate on the solver** | **ABSENT.** `.github/workflows/kernel-tests.yml` has no sketcher job; `package.json` `forge:kernel:test` (26 smoke tests) omits `sketcher_smoke.js` and `smoke-sketchdof.js`; `gate` omits the four sketch e2e specs | — | — | — | **one line** | — |

> **Benchmark caveat.** Naming a benchmark is not a claim that it is runnable here. Of the eight
> named 3D benchmarks only two have been shown readable, and MUSE's gate floor is 100% (a box
> passes). Drawing2CAD / ParaCAD / Text2CAD-Bench are named because they are *sketch-shaped by
> construction*, not because a harness for them exists in this repo — none does.

---

## 2. What is ALREADY BUILT and merely unreachable — the cheapest capability in the project

The brief flags 22 ops already in this bucket. **This family has a bigger one.**
`D-035` (`implementation/sacrosanct/DECISIONS.md:1435`) measured the shape of that bucket: the
pinned verifier *accepts 40 ops*, and **95.6% of "illegal" op uses (1890 of 1978) are ops the
kernel implements** — forbidden solely by *"no command in the forge::ui registry emits it."*
That is a UI gap wearing a vocabulary's clothes.

The sketch family is the same defect at a larger scale, because what is stranded is not 22
op *names* but an entire **engine**:

| stranded asset | size | reachable from |
|---|---|---|
| planegcs `GCS.cpp` + `Constraints.cpp` + `Geo.cpp` + `SubSystem.cpp` + `qp_eq.cpp` | ~370 KB of solver source, compiled into **both** `forge_kernel.node` and `forge_kernel_core` | nothing in C++ |
| **67 distinct constraint primitives** (`grep -o 'int addConstraint[A-Za-z0-9_]*' GCS.h \| sort -u` → 67) | — | **10** are wired into the facade |
| **11 curve types** (`Geo.h`: Point, Line, Circle, Arc, Ellipse, ArcOfEllipse, Hyperbola, ArcOfHyperbola, Parabola, ArcOfParabola, BSpline) | — | **4** are wired into the facade |
| Full diagnose pipeline (conflicting / redundant / partially-redundant / dependent-param groups / residuals / rank DOF) | `Sketcher.cpp:757-870`, bound `binding_sketchdiag.cpp:111-198` | **JS only.** Zero C++ consumers; zero IR consumers; zero UI consumers; zero tests in any gate |
| Native OCCT-free profile bridge | `Sketcher.cpp:602-715` | used by `Features.cpp`, so this one *is* live |

Three separate "already built, unreachable" statements, ranked by cheapness:

1. **The solver is reachable from JavaScript and from nowhere else.** `binding.cpp:6418-6451`
   exports `forge.sketcher.*` including `addConstraint` and `solve`; `binding_sketchdiag.cpp:195-198`
   exports `forge.sketch.diagnose.{diagnose,audit,residual,residuals}`. The C++ app
   (`forge-desktop`, `ui/`) and the C++ IR compiler cannot see any of it. The one JS consumer,
   `frontend/src/forge-v4/sketchSession.js:163-311`, drives the real kernel solver — and it lives
   in the Electron frontend that the C++ direction supersedes.

2. **The IR uses the sketcher as a dumb geometry container.** `FeatureTreeCompiler.cpp:36`
   includes `Sketcher.hpp`; `:792-880` builds RECT/RRECT/CIRCLE/SLOT/POLY/REGPOLY by calling
   `createSketch` + `addPoint`/`addLine`/`addCircle`/`addArc` — and then **never adds a single
   constraint and never calls `solve()`**. Every profile in every feature tree Archie has ever
   emitted is a bag of baked coordinates. A `PROFILE` value *is* a `SketchHandle`
   (`FeatureTreeCompiler.cpp:732`) — the plumbing is already the right shape; the sketch is just
   never constrained.

3. **Nothing gates it.** No CI job, no `npm` gate entry, no native C++ test. `sketcher_smoke.js`
   exists and passes-by-construction only if someone runs it by hand. A solver this good being
   ungated is how it silently rots.

**Cheapest single action in this entire document:** add `node forge-kernel/test/sketcher_smoke.js`
to `package.json` `forge:kernel:test`. One line. It gates ~370 KB of numerics that currently has
no gate at all.

---

## 3. What new IR VALUE KIND does this family require?

**Two, and the second one is the honest cost of the first.**

The IR's value model is `Val { enum Kind { Profile, Wire, Solid } }`
(`FeatureTreeCompiler.cpp:593-596`), and the vocabulary's own closure check agrees:
`value_kind_closure.produced_by_allowed_ops = ["PROFILE","SOLID","WIRE"]`, `gaps: []`
(`archie_op_vocabulary.json`).

### `SKETCH` — a sketch under construction

A `SketchHandle` **plus a plane**, in the state *before* solving: mutable, constrainable,
not yet a profile. This is genuinely new; `PROFILE` is the same runtime handle but a different
*contract* (immutable, solved, Z=0, ready for `EXTRUDE`).

### `SKETCHREF` — a point or curve inside a sketch

The IR addresses every value by a `%N` creation id and *"every op produces exactly one value"*
(`FeatureTree.hpp:23-33`). A constraint has to name two entities. There are only two ways to do
that:

* **(a) A second value kind.** `SPT`/`SLINE`/`SCIRC` produce `SKETCHREF`; `CON(%a, %b, PERP)`
  recovers the owning sketch from either operand. **Zero grammar change** — `%N` refs already
  exist, the tokenizer is untouched.
* **(b) One kind + a symbol table.** `CON(%sketch, "p3", "p7", PERP)` using the existing `Str`
  token (`FeatureTree.hpp:164-176`, already carried for face selectors).

**(a) is the right answer.** (b) re-implements, inside quoted strings, exactly the name→value
binding that `%N` already is — and it defeats the `GraphAudit` pass, which checks for unresolved
refs and orphans (`CMakeLists.txt:1778-1781`) and cannot see inside a string. Two kinds is the
honest price of keeping every existing invariant intact.

### What this does **not** require

`EXTRUDE`, `REVOLVE`, `LOFT`, `SWEEP`, every boolean, every feature, every edit op: **unchanged.**
The family terminates in `SOLVE(%sketch) → PROFILE`, and `PROFILE` is what all of them already
consume (`refProfile`, `FeatureTreeCompiler.cpp:724-733`). That is the single most important
structural fact in this design: **the sketch family bolts on in front of the existing IR without
touching one line of it.**

---

## 4. Design — entities, constraints, the solver contract, and the exit to `PROFILE`

Nine new ops. Names are three-to-six characters because a long tree pays for every token.

```
# --- creator (produces SKETCH) ---------------------------------------------
%1 = SKETCH(XY)                        # XY | YZ | XZ
%1 = SKETCH("@top_face")               # sketch-on-face: an existing face selector
%1 = SKETCH(ox,oy,oz, nx,ny,nz, xx,xy,xz)   # explicit plane

# --- entities (produce SKETCHREF) ------------------------------------------
%2 = SPT(%1, 0, 0)                     # point
%3 = SPT(%1, 60, 0)
%4 = SLINE(%2, %3)                     # line through two points
%5 = SCIRC(%2, 12.5)                   # circle: centre point + radius
%6 = SARC(%2, %3, %4)                  # arc: centre + start + end
%7 = SELL(%2, 30, 18, 0)               # ellipse (engine has it; facade does not yet)
%8 = SSPL(%1, [x y; x y; ...], 3)      # 2D B-spline, degree 3 [, PERIODIC]

# --- constraints (PASS THROUGH: return the SKETCH, like TAG and VERIFY) -----
%9  = CON(%4, HORIZ)                   # unary
%10 = CON(%4, %11, PERP)               # binary, no value
%12 = CON(%2, %3, DIST, 60)            # dimensional
%13 = CON(%5, RADIUS, 12.5)
%14 = CON(%4, %11, ANGLE, 30)          # degrees at the IR boundary, radians inside
%15 = CON(%2, FIX)                     # addConstraintCoordinateX/Y -- pins the origin

# --- exit (produces PROFILE) ------------------------------------------------
%16 = SOLVE(%1)                        # <- PROFILE. EXTRUDE/REVOLVE take it unchanged
%17 = EXTRUDE(%16, 20)
```

`CON` is **one op with a keyword mode**, exactly as `PATTERN` already dispatches on
`LINEAR|POLAR|GRID` (`FeatureTree.hpp:110-112`). That keeps the vocabulary from exploding into
25 op names and keeps `kEmittedArgCounts`-style arity checking tractable. The keyword set:

| geometric | `COINC PARA PERP TANG EQUAL CONC COLL SYMM MIDPT HORIZ VERT PTON FIX` |
|---|---|
| dimensional | `DIST DISTX DISTY ANGLE RADIUS DIAM` |

Every one of those routes to a primitive that **already exists** in `GCS.h`. This is facade
exposure, not numerics.

> **SHIPPED 2026-09-01.** All nineteen dispatch. Nine landed with the family; the other ten
> (`CONC COLL SYMM MIDPT FIX DISTX DISTY ANGLE RADIUS DIAM`) are one `forge::Sketcher` switch
> arm each, as this section predicted. `ANGLE` is degrees here and radians in the solver, and
> the conversion sits at the IR boundary — a missing conversion still compiles, solves and
> converges, so it is covered by a positive control that asserts perpendicularity rather than
> convergence.

**Constraint ops are pass-through.** `CON` returns the same `SKETCH` value it was handed —
the pattern `TAG` and `VERIFY` already use (`FeatureTree.hpp:131-141`, *"Pass-through like
VERIFY: it returns %body unchanged. A naming mechanism that can alter the solid is a defect
generator"*). Same reasoning: a constraint statement that could silently move geometry before
the solve is a defect generator.

---

## 5. ★ The solver — named, costed, and not hand-waved

### 5.1 The approach: **I would not write a solver.**

The correct engineering decision here is the one already made two months ago: **vendor planegcs
and expose it.** Concretely, the approach is *sparse-Jacobian Newton with a DogLeg trust region,
subsystem-partitioned, with a full-pivot QR rank analysis for diagnosis* — because that is what
`GCS::System` is, it is compiled into the library right now, and I drove it in §0.

Why this and not the alternatives:

* **Not a from-scratch Newton solver.** The naive version is ~500 lines and works on the demo.
  It falls over on exactly the cases that matter: a closed loop couples parameters so a counting
  DOF is wrong (measured: §0 scenario D, static says 8, rank says 4); a redundant-but-consistent
  system has a rank-deficient Jacobian that plain Newton diverges on; and *identifying which
  constraints conflict* is a rank/QR question, not a residual question. `frontend/src/kernel/sketch/SketchSolver.js`
  is precisely this alternative — 533 lines of pure-JS Newton-Raphson with a richer *nominal*
  constraint list than the kernel facade — and it is the wrong artifact: JS, in the superseded
  frontend, with no rank analysis and therefore no honest diagnosis.
* **Not a from-scratch DCM clone.** Months, minimum, and it competes with an engine already in
  the link line.
* **Not a graph-decomposition / rule-based solver** (Owen / triangle-decomposition). Faster on
  well-formed sketches, materially worse on the ill-formed ones — which, for machine-generated
  trees, is most of them.

### 5.2 What it honestly costs

The numerics are free. **The cost is the facade, the parameter pool, and the UI** — in that order.

| piece | what it actually is | honest size |
|---|---|---|
| `CON` over the **existing 10** kinds + `SPT/SLINE/SCIRC/SARC` + `SKETCH(XY)` + `SOLVE` — IR opcodes, parser arity, `Val::Kind::Sketch`/`SketchRef`, compiler arms, s0.4 census reconciliation | 9 opcode arms + one `Val` kind + a switch. No new math. | **2-4 days** |
| Facade breadth: **10 → ~25** constraint kinds | each is one switch arm calling an existing `GCS.h` primitive. The current 10 arms are ~90 lines total (`Sketcher.cpp:337-418`) — ~9 lines each. | **~3 days** |
| Facade breadth: **4 → 11** entity types (ellipse, conics, **B-spline**) | this is where the real work is, and it is *not* the switch. Each new type needs a parameter-pool layout, an arm in `collectUnknowns`, an arm in `mapParamToGeometry` (`Sketcher.cpp:732-753` currently knows only PointX/Y, CircleRadius, ArcRadius, Arc angles), and chord sampling in `extractProfileRings` (`:602-715`, currently line/arc/circle only). B-spline alone is variable-length (poles + weights + knots), so the pool stops being a flat `double` vector. | **2-3 weeks** |
| Sketch **planes** / sketch-on-face | `Sketcher.hpp:159-165` states the Z=0 assumption as a contract every native consumer relies on. The safe design is: solve on Z=0, then apply the plane as a post-transform of the *built solid*, never inside the sketch. Face selectors already resolve (`resolveSelector`, `FeatureTreeCompiler.cpp`). | **1 week** |
| **UI sketch mode** — plane pick, entity tools, constraint tools, DOF badge, conflict highlighting, drag-to-solve, plus registry commands and the vocabulary regeneration, plus satisfying `app_surface_reachability_test.cpp` (every command must be reachable from every enumerating surface) and `capability_manifest_test.cpp` | the largest single piece, and it is **UI work, not solver work**. `ForgeFrame.cpp:58, 63` already declares `viewport_sketch`, `sketch_tree` and `constraints` dock ids with nothing behind them. Drag-to-solve additionally needs the temp-constraint facade entry that does not exist. | **1-2 months** |

**Summary answer to "days, weeks or months":** the IR half is **days**. The facade half is
**weeks**. The app half is **months** — and it is months of interaction design, not months of
mathematics. Anyone who reports this family as "months" without that split is hiding the fact
that the expensive part is the part with no numerics in it.

### 5.3 What planegcs will **not** give you (say it before someone discovers it)

Nothing in the engine does 3D constraints, assembly mates, or constraint *priorities*. The
temp/driven-constraint machinery exists but is unsurfaced, so "drag" is a facade task, not a free
one. And `Sketcher.cpp` is single-registry with a `std::mutex` (`Sketcher.hpp:98`) — parallel
solves across a 600-part sweep serialize.

---

## 6. ★ The binding constraint: over-constrained must be diagnosed, never refused

> *"dont gate anything if you do that then how will Archie generate ultra long feature trees"*

A `SOLVE` that throws on a conflict is a capability gate wearing a safety hat, and it fires
hardest on the longest, densest trees — a 200-statement tree with one contradictory dimension
would lose all 200. **`SOLVE(%sketch)` must always produce a `PROFILE`.** The contract, in order,
using only machinery that exists:

1. `declareUnknowns` → `initSolution(DogLeg)` → `diagnose(DogLeg)` → `solve(isFine, DogLeg)`.
   (`Sketcher.cpp:422-459` and `:757-824` already do all of this.)
2. **`classification == "over"`** (conflicting tags non-empty, `GCS.h:640`): **demote, do not
   refuse.** For each conflicting set, drop the **latest-declared** member via
   `GCS::clearByTag` (`GCS.h:266` — engine has it, facade must add the entry), re-solve, repeat
   until consistent or nothing is left to drop. *Last-declared loses* makes the repair
   deterministic, which a repair loop needs more than it needs cleverness. Record
   `DEMOTED tag=<n> op=%<id> kind=<KIND>` — the op id and constraint kind, so a repair loop can act.
3. **`classification == "under"`** (`dof > 0`): **this is the normal case and it is not an
   error.** Archie emits coordinates first and constraints second; DogLeg converges to the
   solution nearest the as-drawn seed. Report `dof` and the dependent-param list
   (`Sketcher.cpp:787-802` already maps each free parameter back to its owning point/entity id).
4. **Numeric failure** (`status == Failed`): fall back to the **as-drawn** coordinates — which is
   byte-for-byte what the IR produces today (`FeatureTreeCompiler.cpp:792-880` builds unconstrained
   geometry and never solves). So the floor of the whole family is *exactly the current
   behaviour*. `SOLVE` can never be worse than not having it.
5. Every one of 2/3/4 lands as a line in `CompileResult::verify`
   (`FeatureTree.hpp:285`, `std::vector<std::string>`) — the channel for
   `"PASS <expr>"`/`"FAIL <expr>"` already exists. A sketch diagnosis is a **report**, not a throw.

The one place a refusal is still correct: `SOLVE` on a `%ref` whose value is a `SOLID`. That is a
grammar error, not a geometry outcome, and `refProfile`/`refWire` already refuse it that way
(`FeatureTreeCompiler.cpp:724-744`).

> **Why this family attacks a measured failure mode, not a hypothetical one.** A recorded
> measurement in this program (2026-08-07, *derived placement is the unlearnable sub-task*) found
> **40.4% of train / 48.2% of held-out-B `TRANSLATE` arguments are exact arithmetic** the model
> has to perform in its head, and a follow-up (2026-08-08) removed **3,694 derived constants
> (39.1%)** by relational rewriting. A constraint solver is *the* mechanism that moves that
> arithmetic out of emission and into the kernel: the model states `CON(%a, %b, DIST, 60)` and the
> solver computes the coordinates. **I did not re-verify those two numbers in this session** — they
> are cited as prior recorded results, and the argument stands or falls with them.

---

## 7. What a MINIMAL honest version looks like

Not decorative means: a dimension becomes a **first-class, editable, diagnosable object** instead
of a baked coordinate, and a contradiction becomes a **named report** instead of a dead tree.
The smallest thing that achieves both:

1. **Six ops**, `SKETCH(XY)` · `SPT` · `SLINE` · `SCIRC` · `CON` · `SOLVE`. Plane keyword `XY`
   only. Constraint kinds limited to the **10 the facade already dispatches**. No ellipse, no
   spline, no sketch-on-face, no arcs if they cost a day.
2. **Two value kinds**, `SKETCH` and `SKETCHREF`, in `Val::Kind`. `SOLVE` yields `PROFILE`;
   nothing downstream changes.
3. **The §6 contract, in full.** This is the part that must not be trimmed — a `SOLVE` that
   throws is worse than no `SOLVE`, because it converts a soft failure into a lost tree.
4. **One facade addition**: `clearByTag` exposure, without which step 2 of the contract is
   impossible.
5. **Two gates**, and this is the whole difference between real and decorative:
   * `node forge-kernel/test/sketcher_smoke.js` added to `package.json` `forge:kernel:test` —
     **one line**, and it is the first gate the solver has ever had.
   * a native C++ test that compiles an IR tree containing a **deliberately contradictory**
     sketch, asserts `CompileResult::ok == true`, asserts a solid came out, and asserts
     `CompileResult::verify` **names the demoted tag**. A gate that proves the family does not
     refuse is worth more than a gate that proves it solves.

Explicitly **out** of the minimal version, so nobody reads it as delivered: ellipses, conics,
B-splines, construction geometry, driven dimensions, drag-to-solve, sketch planes other than XY,
sketch-on-face, and any UI at all. Those are §5.2's weeks and months. The minimal version is the
**days** row — and after it, the sentence *"Forge has no sketcher"* stops being true of the IR,
which is the surface Archie actually emits into.

---

## 8. Verification ledger

**VERIFIED by execution** (loaded `forge-kernel/build/Release/forge-kernel.node`, ran four
scenarios): the solver solves; `diagnose` returns real conflicting/redundant tag lists;
`audit` returns a solver DOF that differs from the static estimate; the JS surface is
`{createSketch,destroySketch,addPoint,addLine,addCircle,addArc,addConstraint,solve,readPoint,writePoint,liveCount,entityCount,readEntity,kinds,statuses}`.
**Caveat in §0**: that binary is ahead of this SHA (14 kinds vs 10).

**VERIFIED by reading source at the pinned SHA**: planegcs is genuinely vendored (`UPSTREAM.md`,
FreeCAD `0a45a0a0…`) and genuinely in the link (`CMakeLists.txt:1266-1272, 1800, 1889`);
`Sketcher.cpp` calls real `GCS::System` methods with real bodies (`:328-419`, `:422-459`,
`:757-870`); `FeatureTreeCompiler.cpp` calls `createSketch`/`addPoint`/`addLine`/`addCircle`/`addArc`
(`:792-880`) and **never** `addConstraint` or `solve` (0 hits); the facade has **no** `dragPoint`,
`declareDrivenParams`, `clearByTag`, `removeConstraint`, `undoSolution`, `setReference`,
`construction`, `maxIter` or `autoChooseAlgorithm` (0 hits across `Sketcher.cpp` + `Sketcher.hpp`);
`Val::Kind` is `{Profile, Wire, Solid}` (`:593-596`); the registry's 31 commands (`archie_op_vocabulary.json` `counts.registry_commands`) contain no
sketch-entity or constraint command; `EntityKind::Sketch` appears in `ui/` **only in tests**;
CI and `package.json` contain no reference to `sketcher_smoke.js`, `smoke-sketchdof.js`, or the
four sketch e2e specs; 67 `addConstraint*` primitives and 11 curve classes in the vendored engine.

**NOT VERIFIED, stated as such**: the two derived-placement measurements in §6 (prior recorded
results, not re-run here); every day/week/month estimate in §5.2 (engineering judgement from the
measured line counts cited beside them, not from a completed increment); that any of
Drawing2CAD / ParaCAD / Text2CAD-Bench is runnable in this repo (no harness for any of them
exists here); the claim in the brief that the 18-op vocabulary cannot represent
`archie_edit_214`'s 430-face input (taken as given, not re-derived).

**STALE PRIOR ART**: `docs/SCOPE_2026-06-24/kernel/sketcher-constraints.md` is a thorough
gap analysis of the same engine — but it predates the Phase-A diagnostics landing. Its §2.1 lists
conflicting/redundant/partially-redundant/dependent-params/residuals/classification as missing.
**All six now exist** (`Sketcher.cpp:757-870`, bound `binding_sketchdiag.cpp:195-198`), and I ran
them. Its §2.2-§2.4 (entity breadth, constraint breadth, drag/driven/remove/undo/tuning) are
**still accurate**. It says nothing about IR or app reachability, which is the actual subject of
this census.
