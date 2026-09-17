# ArchDisc Convergence Execution Program

**Date:** 2026-09-17  
**Status:** Proposed execution constitution for Forge, Archie, kernel, and simulation convergence

## Purpose

ArchDisc is no longer blocked by lack of scope. It is blocked by too many partially overlapping implementation paths.

The program from this point forward is convergence, not horizontal expansion.

The four authoritative programs are:

1. Archie model and reasoning
2. Forge native C++ application
3. Forge native geometry kernel
4. Simulation and verification engines

No new workbench, product surface, or architectural generation should be added unless it is required to close one of these four programs.

---

# 1. Canonical system architecture

The product contract is:

`USER INTENT / DRAWING / IMPORT / PROJECT STATE`
`-> Archie reasoning`
`-> IntentGraph`
`-> Engineering Plan`
`-> versioned typed Forge IR`
`-> validation`
`-> transaction`
`-> authoritative Project Graph`
`-> Forge Native API`
`-> geometry / assembly / CAE / CAM execution`
`-> independent validation`
`-> evidence`
`-> Archie critic / repair`
`-> commit`

The central rule is:

> Archie does not create geometry directly. Archie produces engineering intent. Forge converts that intent into deterministic engineering state. The kernel constructs and proves geometry.

Every meaningful operation, regardless of origin, must use the same execution spine:

- GUI
- Archie
- keyboard command
- import
- macro
- automation
- future plugins

must all become:

`EngineeringCommand -> Typed IR mutation -> Transaction -> Project Graph -> Native Forge API -> Derived state`

There must not be separate semantic execution systems for the GUI and Archie.

---

# 2. Program A — Archie

## 2.1 Current correction

The active Archie development target is a 30B-class local engineering model. Any 14B-specific architecture, corpus program, memory budget, adapter topology, serving assumption, or training script must be treated as legacy unless explicitly retained for fallback or comparative evaluation.

The canonical Archie program must be updated around the current 30B model.

## 2.2 What Archie must learn

Do not optimize Archie primarily for vocabulary recall or domain trivia.

The target capability is:

`natural human request -> engineering interpretation -> executable typed design program -> verified geometry -> repair`

The training distribution must contain five layers:

### L1 — Natural human language

Train on:

- messy prompts
- incomplete prompts
- colloquial engineering language
- follow-up corrections
- implicit references
- ambiguous objectives
- everyday vocabulary mixed with CAD terminology
- users who do not know engineering terminology
- professional engineering language

### L2 — Engineering interpretation

Train:

- requirement extraction
- assumptions
- constraint extraction
- functional intent
- manufacturing intent
- material reasoning
- unit reasoning
- safety margins
- tolerance reasoning

### L3 — Design decomposition

Train mappings into:

- parts
- bodies
- assemblies
- sketches
- features
- dimensions
- constraints
- reference geometry
- materials
- manufacturing processes
- simulation studies

### L4 — Typed Forge IR

Every executable training sample should terminate in schema-valid typed Forge IR rather than ad-hoc text or JavaScript tool calls.

Use constrained decoding so malformed command structures are impossible where technically practical.

### L5 — Execution, critique, and repair

Every important CAD generation record should be capable of producing:

`prompt -> candidate IR -> Forge execution -> generated B-Rep -> ground truth comparison -> diagnosis -> corrected IR`

The repair pair is a primary training asset.

## 2.3 Geometry-truth reward

Forge should become the reward environment for Archie.

At minimum record:

- schema validity
- rebuild success
- B-Rep validity
- exact dimensions
- feature count
- feature order
- sketch constraint satisfaction
- volume error
- area error
- bounding-box error
- center-of-mass error
- face/edge/vertex counts
- topology / genus
- semantic-reference correctness
- manufacturability
- rendered-view similarity
- repair count

Adapters or checkpoints are not accepted because training loss decreased. They are accepted only because held-out engineering evaluation improves.

## 2.4 Model-facing tool surface

Do not allow the model-facing API to expand indefinitely into hundreds or thousands of flat verbs.

Converge toward hierarchical semantic operations such as:

- `geometry.create_feature`
- `geometry.modify_feature`
- `geometry.boolean`
- `geometry.pattern`
- `geometry.reference`
- `geometry.measure`
- `sketch.create`
- `sketch.geometry`
- `sketch.constraint`
- `sketch.solve`
- `assembly.component`
- `assembly.constraint`
- `analysis.define`
- `analysis.solve`
- `manufacturing.define`
- `manufacturing.verify`
- `document.query`
- `document.modify`

Feature subtypes belong in typed schemas.

## 2.5 Archie release gates

Track independently:

- prompt-comprehension benchmark
- CAD generation benchmark
- CAD editing benchmark
- first-pass executable IR validity
- dimension correctness
- feature correctness
- topology correctness
- tool hallucination rate
- self-repair success rate
- ground-truth geometry score

Do not report an aggregate alone. Every major axis must meet its own minimum.

---

# 3. Program B — Forge native C++ application

## 3.1 Authority rule

JavaScript and TypeScript may remain temporarily as presentation or compatibility clients during migration, but they must not own engineering truth.

The following must be native and authoritative:

- document state
- transactions
- feature definitions
- topology ownership
- dependencies
- incremental recompute
- parameters
- units
- persistent references
- selection identity
- assembly constraints
- CAE state
- CAM state
- project persistence

## 3.2 Canonical native application stack

Forge Desktop

- native C++ application shell
- Metal-first renderer on macOS
- viewport
- picking / selection
- panels
- command system
- property editor
- sketch environment
- feature tree
- drawing environment
- Archie workspace

Forge Document Engine

- transactions
- undo / redo
- stable IDs
- persistent topology references
- dependency DAG
- incremental recompute
- configurations
- autosave
- crash recovery
- revision history
- versioned native project format

## 3.3 JS/TS deletion policy

Do not delete legacy capability merely because it is old.

Each old path must be classified as:

- CANONICAL
- TRANSITIONAL
- TEST-ONLY
- GENERATED
- DEAD

A file may be marked DEAD only when it has:

- zero static imports
- zero dynamic imports
- zero package-script references
- zero build references
- zero runtime-path references
- zero test references
- a native replacement where capability still matters

The same PR that proves the path dead should remove it.

## 3.4 Native parity gate

A legacy JS feature is retired only after:

`legacy capability -> mapped native C++ command -> same typed IR -> same native kernel -> acceptance tests -> legacy deletion`

The native app must reach functional parity before blanket deletion of the legacy surface.

---

# 4. Program C — Forge native geometry kernel

## 4.1 Primary architectural correction

The kernel must stop using OCCT as its internal interchange representation.

The target is:

`Forge native algorithm -> Forge-owned Shape/B-Rep representation -> Forge-owned topology/geometry/persistence`

OCCT belongs outside this boundary as:

- compatibility adapter
- import/export reference
- differential oracle
- regression reference
- temporary fallback only where explicitly allowed

## 4.2 Highest-leverage kernel task

Prioritize an owning, lifetime-safe, OCCT-free Forge shape representation and migrate production consumers onto it.

The representation must support:

- stable ownership
- safe lifetime
- explicit shape kind
- topology traversal
- native B-Rep payload
- native mesh payload
- stable IDs
- conversion only at adapters

Do not continue creating native algorithms that immediately reconstruct their outputs back into OCCT types as the normal internal path.

## 4.3 OCCT symbol ratchet

The default shipping configuration must maintain a monotonic OCCT symbol ceiling.

Rule:

> OCCT symbol demand may stay equal or decrease. It may never increase.

A PR that increases the global production OCCT undefined-symbol count fails CI unless the increase is explicitly approved as a temporary emergency migration with a scheduled rollback. Normal feature work receives no exception.

Track at least:

- total production OCCT undefined symbols
- per-toolkit production symbol count
- direct linked toolkit count
- transitive closure toolkit count
- phantom/mis-accounted dependencies

Moving a symbol between files is not progress.

Delisting a library while symbols still resolve elsewhere is not progress.

## 4.4 Capability replacement protocol

For every OCCT capability family:

1. enumerate production call sites
2. enumerate exact OCCT symbols
3. map user-visible capability
4. identify required lower-level native primitives
5. implement native counterpart
6. differential-test against independent oracles and OCCT where useful
7. include adversarial and degenerate geometry
8. validate topology, not only volume
9. redirect production execution
10. remove corresponding OCCT call sites
11. run full regression
12. prove the symbol count decreased or stayed constant for a representation-only prerequisite
13. delete toolkit dependency only after reachable production-symbol count is zero

A blocker report is not completion. If blocked, implement the lowest-level missing native primitive required to unblock the capability.

## 4.5 Kernel representation stack

Converge on one coherent engine containing:

Math

- vectors
- matrices
- transforms
- quaternions
- robust predicates
- numerical solvers
- dimensional/tolerance policy

Geometry

- lines
- circles
- ellipses
- Bezier
- B-splines / NURBS
- analytic surfaces
- NURBS surfaces
- intersections
- projection
- trimming

Topology

- vertex
- edge
- wire
- face
- shell
- solid
- compound
- persistent identity

Features

- extrusion
- revolution
- sweep
- loft
- Boolean
- offset
- shell
- fillet
- chamfer
- draft
- patterns

Discrete / alternate representations

- half-edge mesh
- robust mesh Boolean
- implicit / SDF
- voxel / lattice

These representations require one explicit identity/type/conversion system rather than disconnected mini-kernels.

## 4.6 Kernel correctness gates

Every major operation should be checked using several independent observables where applicable:

- B-Rep validity
- volume
- area
- centroid
- bounding box
- topology counts
- Euler characteristic / genus
- surface type census
- persistent-reference behavior
- dimensional constraints
- exact or closed-form oracle where available
- differential result against reference engine
- fuzz / property tests

Coverage alone is not parity.

`IsDone()` alone is never a correctness oracle.

---

# 5. Program D — Simulation and verification

Simulation truth must remain deterministic and independently verifiable.

The canonical path is:

`Geometry -> mesh -> material/model -> loads/BCs -> solver -> convergence -> results -> verification`

Archie may:

- define studies
- select solver families
- configure meshes
- configure loads and constraints
- interpret results
- propose refinements

Archie must not fabricate numerical truth.

Physics ML may accelerate, initialize, approximate, or create surrogates, but release-critical simulation results require validated numerical paths and declared confidence/verification status.

Each solver family needs:

- analytical fixtures where possible
- manufactured-solution tests where applicable
- convergence studies
- regression fixtures
- unit/scale tests
- failure-mode tests
- numerical conditioning reporting
- independent benchmark validation

---

# 6. Scope freeze

Until the convergence gates materially improve, freeze routine addition of:

- new workbenches
- duplicate UI generations
- new flat Archie tool verbs
- parallel state systems
- new fallback engines without canonical ownership
- new compatibility layers without deletion plans

Exceptions require a direct dependency on one of the four convergence programs.

---

# 7. Claude Code execution mode

Broad missions are prohibited as the default unit of work.

Do not assign:

- "drop OCCT"
- "rewrite the kernel"
- "make Forge CATIA-grade"
- "train Archie massively"

Instead assign measurable deltas with termination conditions.

Example kernel task:

```
OBJECTIVE:
Reduce production OCCT_SYMBOLS by at least 10 without losing capability.

PROHIBITED:
- adding unrelated features
- moving symbols between files and counting that as progress
- hiding dependencies
- delisting a library while still using its symbols
- widening tolerances to pass a fixture
- deleting capability merely to satisfy the count

REQUIRED:
1. Identify the highest-value representation or call-site boundary.
2. Implement the native prerequisite.
3. Migrate production consumers.
4. Differential-test results.
5. Run full regression.
6. Run production symbol census.
7. Commit only if acceptance gates pass.

IF BLOCKED:
Implement the lowest-level missing Forge primitive. Do not stop at a blocker report.
```

Example Archie task:

```
OBJECTIVE:
Improve held-out prompt-to-ground-truth CAD score on the designated evaluation set.

REQUIRED:
1. Freeze the evaluation set.
2. Categorize current failures.
3. Add data only for observed failure classes.
4. Train one bounded experiment.
5. Replay every candidate through Forge.
6. Compare per-axis metrics against baseline.
7. Keep only if no protected metric regresses and target axes improve.
```

---

# 8. Definition of progress

Do not measure progress primarily by:

- lines of code
- number of workbenches
- number of tools
- number of adapters
- number of documents
- number of native files
- number of successful builds

Measure:

## Archie

- ground-truth CAD accuracy
- executable IR validity
- semantic prompt understanding
- repair success

## Forge application

- percent of user capability on canonical native command/document path
- percent of legacy surface safely retired

## Kernel

- production OCCT symbol count
- number of capabilities fully native
- persistent-reference stability
- geometry correctness under adversarial cases

## Simulation

- benchmark accuracy
- convergence quality
- verified study coverage

The north-star metric for the repository as a whole is:

> What percentage of shipping Forge runs through the single canonical engineering spine with no hidden legacy authority?

That percentage should move monotonically toward 100%.
