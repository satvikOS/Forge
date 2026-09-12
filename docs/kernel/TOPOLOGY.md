# The native B-Rep topology graph

Companion to `MIGRATION.md` (which sets the removal order) and
`OCCT_REMOVAL_TRACKER.md` (which is generated). This file is the part of the
topology rung that needs judgement: what the graph in
`forge-kernel/include/forge/native/brep/Topology.hpp` actually is, what it can
and cannot represent, and which gate proves each of those statements.

**Every number below was produced by a command, and the commands are listed in
"Reproducing every number" at the end.** Measured 2026-09-12 in the
`topohonesty` worktree at `ddef657b` ("kernel(math): Point3 had three
declarations, and it is NOT Vec3"). "Clean" needs saying precisely, because this
worktree is shared: at measurement time `git status --porcelain -uno` was empty,
so every file cited below is exactly its committed content at `ddef657b`. Plain
`git status --porcelain` was never empty — it lists untracked `docs/kernel/*.md`,
this file among them, and other agents add to that list while you read.

Two gates were green at that SHA:

```
python3 tools/kernel/topology_honesty_gate.py   -> ok
python3 tools/kernel/occt_dependency_graph.py --check -> GREEN
```

## Why this file exists at all

The header's own scope note went stale and nothing failed. It said *"No
geometry is attached to the topology yet"* while `Edge::curve` and
`Face::surface` were both present and in use, and *"No booleans / sewing /
healing / feature ops"* while `Boolean.hpp` declared
`booleanSolid(const Solid&, const Solid&, BoolOp)` against those very types.
A scope note is read as a **to-do list**, so an under-claim schedules finished
work for re-implementation — which is exactly what nearly happened.

`tools/kernel/topology_honesty_gate.py` now probes the code for each claim and
fails if one drifts. This document inherits that discipline: nothing here is
stated that a command did not produce, and where the gate does *not* cover a
claim, this file says so (see "What the gate does not cover").

## Where the code is

| | |
|---|---:|
| `forge-kernel/include/forge/native/brep/Topology.hpp` | 500 lines |
| `forge-kernel/src/native/brep/Topology.cpp` | 347 lines |
| OCCT `#include` lines in those two files | **0** |
| OCCT identifiers (`gp_*`, `TopoDS*`, `BRep*`, `Handle(`, …) in those two files | **0** |
| files in the repo that `#include` `native/brep/Topology.hpp` | **104** (53 production, 50 test, plus itself) |

There is a second, unrelated `forge-kernel/include/forge/Topology.hpp`. It is
not this graph; do not confuse them.

Zero OCCT here is a real zero, not the "OCCT-free by being unused" kind that
`MIGRATION.md` warns about: the header is included by 104 files and its types
appear in the parameter lists of 21 of the 26 sibling headers in the same
directory. The rest of the B-Rep subsystem is **not** at zero — the generated
tracker puts Topology / B-Rep at **578 OCCT include lines across 31 files**.
`Topology.{hpp,cpp}` contribute none of them.

## The graph

Seven element types, all `struct` with public fields, all in
`namespace forge::native::brep`. The container owns; the cross-links do not.

| type | owns | non-owning links | geometry | `sizeof` |
|---|---|---|---|---:|
| `Vertex` | — | — | `Point3 point`, `double tolerance` | 40 |
| `Edge` | — | `start`, `end`, `coedgeA`, `coedgeB` | `Curve* curve`, `double tolerance` | 56 |
| `Coedge` | — | `edge`, `loop`, `next`, `prev`, `mate` | `PCurve* pcurve`, `double tolerance` | 72 |
| `Loop` | — | `face`, `first` | — (`bool isOuter`, `coedgeCount`) | 40 |
| `Face` | `innerLoops` (ptrs) | `shell`, `outerLoop` | `Surface* surface`, `u0/u1/v0/v1`, `vertexUV` | 168 |
| `Shell` | `faces` (ptrs) | `solid` | — | 40 |
| `Solid` | `shells` (ptrs) | — | — | 32 |

`TopologyBuilder` (288 bytes) owns every element in
`std::vector<std::unique_ptr<T>>` — vertices, edges, coedges, loops, faces,
shells, solids — plus the geometry pools `surfaces_`, `curves_`, `pcurves_`.
Raw pointers above are adjacency only. Element lifetime is the builder's
lifetime; there is no per-element free.

The model is **radial-edge-lite / winged half-edge**: a `Coedge` is one
oriented use of an `Edge` by a `Loop`; `mate` is the opposite-sense use on the
same edge; `next`/`prev` walk the ring.

### Ids

All seven element factories draw from one `nextId_` counter starting at 1
(`nextId_++` appears exactly 7 times in `Topology.cpp`, once per factory). So
ids are unique *across types within one builder* and mean nothing across
builders or across a rebuild. `makeSurface` / `makeCurve` / `makePcurve` mint
no id at all. This is the reason the LineageRegistry denial below is true and
is not a small gap: there is no identity here that survives an edit.

## Geometry IS bound to the topology

This is the claim that went stale. It is present, and it is used:

| | |
|---|---:|
| `Edge::curve` — declared `Curve* curve = nullptr` | yes |
| `Face::surface` — declared `Surface* surface = nullptr` | yes |
| `Coedge::pcurve` — declared `PCurve* pcurve = nullptr` | yes |
| includers of `Topology.hpp` that dereference `->curve` or `->surface` | **32** |
| files calling `TopologyBuilder::makeSurface` | 30 |
| files calling `makeCurve` / `makePcurve` | 8 / 6 |

`Topology.hpp` `#include`s `Surface.hpp` and `Curve.hpp` **fully** (not
forward-declared) because the builder owns `unique_ptr` vectors of them and
every TU that instantiates a builder needs the complete type for the vector
destructor. Neither of those headers includes `Topology.hpp`, so there is no
cycle.

Every geometry pointer defaults to `nullptr`, so a bare-topology solid (the
original box gate) is unaffected by geometry being available.

The geometry is not decorative. `k0_topology_test.cpp` composes each hole
coedge's 2D `PCurve` with its face's `Surface` and compares against the edge's
3D `Curve`. Measured on a live run:

```
circle arcs checked = 12, worst |S(P(t)) - C(t)| = 4.441e-16
outer line edge worst |S(P(t)) - C(t)| = 0.000e+00
bspline edge  worst |S(P(t)) - C(t)| = 0.000e+00
```

The gate probe for this is `probe_geometry_bound`, which requires the literal
declarations `Curve* curve` and `Surface* surface` in the header. It is
falsifiable: the selftest re-adds the stale "No geometry is attached" denial
and the gate goes RED.

## Inner (hole) loops are built

A `Face` carries one `outerLoop` plus `std::vector<Loop*> innerLoops`, and
`loopCount()` returns `(outerLoop ? 1 : 0) + innerLoops.size()`. The inner ring
is assembled by `TopologyBuilder::addInnerLoopToFace`, which shares
`buildCoedgeRing` with the outer path — structurally identical wiring, the only
differences being `isOuter = false` and appending instead of assigning.

`addInnerLoopToFace` is named in 20 files; **16 of them actually call it**
(excluding its own declaration and definition), among them `StepRead.cpp`,
`IgesRead.cpp`, `StepAnalytic.cpp`, `Boolean.cpp`, `Heal.cpp`,
`UnifyFaces.cpp`, `FilletAnalytic.cpp` and `ClassASurfacing.cpp`. This is a
load-bearing path, not a stub.

`Face` also carries three integration markers that downstream mass/tessellation
code branches on. Counting files in the brep tree
(`include/forge/native/brep` + `src/native/brep`): `paramTri` 11, `boolHoled` 9,
`regionUV` with `regionOuterUV`/`regionInnerUV` 6.

The header claims each marker has exactly one producer — `boolHoled` "set ONLY
by the boolean stitch — NEVER by the fillet/copy paths" (`Topology.hpp:256`) and
`regionUV` "Set ONLY by the foreign STEP reader" (`Topology.hpp:271`). **Both
comments are false**, which makes them two more stale header comments on top of
the three listed below. Grepping for the literal `= true` writes:

| marker | files that set it true | sites |
|---|---|---:|
| `paramTri` | `Boolean.cpp:1152` (`sf.paramTri = curved`) — plus `OcctImport.cpp:1584` outside the brep tree | 1 in-tree |
| `boolHoled` | `Boolean.cpp:690`, `StepRead.cpp:2125`, `StepAnalytic.cpp:1374`, `UnifyFaces.cpp:340` | 4 |
| `regionUV` | `StepRead.cpp:2071/2112/2235`, `UnifyFaces.cpp:699/812/939/1157` | 7 |

Only `paramTri` has a single in-tree producer. `boolHoled` is set by both STEP
paths and by the planar-merge path as well as by the boolean, and `regionUV` is
set by `UnifyFaces` at more sites than by the STEP reader. The
"marker isolation" argument the header makes — that every non-producer face
keeps its original integration byte-for-byte — is therefore not established by
producer count; whatever isolation holds has to come from somewhere else, and
nothing here measured it.

**Three further comments inside the header are stale about loops and shells.** At
`ddef657b`: line 57-58 ("faces are simple quads/tris with a single loop — no
inner holes yet"), line 207 ("bounded by exactly one outer loop in this
increment (no inner hole loops yet)"), and line 289 ("Solid — owns one outer
shell (no voids/inner shells yet — TARGETED)"). None of the three is true, and
none is probed — the gate reads only the block after
`What is genuinely NOT built`. See "What the gate does not cover".

The third one needs its own evidence, because multi-shell solids are a
different thing from cavities and both turn out to exist. `Solid::shells` is a
`std::vector<Shell*>`, and **16 call sites** append to it from inside a loop
over another object's shells — 8 in `FilletAnalytic.cpp`, plus
`StepRead.cpp:2269`, `IgesRead.cpp:1299`, `Pattern.cpp:214`,
`OffsetShape.cpp:451`, `Shell.cpp:528` (the hollow-solid path),
`ClassASurfacing.cpp:266`, `Sewing.cpp:153` and `Healing.cpp:350`. (A
seventeenth, `Healing.cpp:273`, appends each distinct `face->shell` behind a
`seen` set.) Cavities are then classified downstream:
`CadScoreGates.cpp` tags a shell `isVoid` when its AABB lies strictly inside
another shell's *and* its centre classifies inside by an even-odd ray cast,
and reports Betti numbers off that (`b0` counts non-void shells).

What is genuinely missing is smaller and worth stating precisely: **`Shell`
itself carries no outer/void flag.** Its three fields are `id`, `solid` and
`faces`. The outer-versus-void distinction is derived by containment in
`CadScoreGates`'s own `ShellMesh`, not stored on the topology, so nothing in
the graph records which shell is the cavity.

## Euler operators: MEV exists, MEF does not

This section corrects the header's own summary line, which reads "The MEV / MEF
Euler-operator mutators used to assemble a valid, orientable, closed 2-manifold
shell from nothing."

Measured over every `.hpp`/`.cpp` in the repository:

| identifier | declarations | definitions | call sites |
|---|---:|---:|---:|
| `mev` | 1 (`Topology.hpp:385`) | 1 (`Topology.cpp:139`) | **0** |
| `mef` | **0** | **0** | **0** |

`mev` is a genuine Euler operator (it raises V by 1 and E by 1, leaving
V-E+F invariant) and it is correct, but nothing in the repository calls it.
No function named `mef` exists: the token occurs only in four comment lines of
the header (`:22`, `:39`, `:387`, `:392`), where a block describing MEF is
followed by a declaration of `addOuterLoopToFace` instead — and that comment
refers to a function `addLoopToFace` which also does not exist.

What actually assembles shells is the ring builder:

- `addOuterLoopToFace(face, ring)` — **42 files**, 140 matching lines
- `addInnerLoopToFace(face, ring)` — named in 20 files; **23 call sites across
  16 files**. (25 non-comment lines match `addInnerLoopToFace(`; two of them are
  its own declaration at `Topology.hpp:414` and definition at `Topology.cpp:211`.)
- both delegate to the private `buildCoedgeRing`, which creates or **shares**
  each edge via an `O(1)` `unordered_map` keyed on the unordered vertex-id pair
  (`edgeIndex_`), and wires `next`/`prev`. `makeCoedge` fills `coedgeA`, then
  `coedgeB`, and mates them.
- `buildBox` is six `addOuterLoopToFace` calls over eight vertices. Not one
  `mev`.

So: **one basic Euler operator is implemented and unused; the graph is built by
direct loop assembly with edge sharing.** That is a working design — it is how
every producer in the tree builds — but "MEV/MEF are how shells are assembled"
is not what the code does.

## `EulerCounts` and `eulerPoincareValid`

`TopologyBuilder::counts()` returns `EulerCounts` (48 bytes): `vertices`,
`edges`, `faces`, `loops` (total, outer + inner), `shells`, and `innerLoops`
(counted by scanning `isOuter == false`).

- `characteristic()` returns the classic `V - E + F`.
- `eulerPoincareValid(shellCount, genus)` returns
  `(V - E + F - R - 2*(S - G)) == 0`, where `R = innerLoops`.

Both forms are exercised. Building and running the two standalone gates at
`ddef657b`:

```
brep_test         -> V=8 E=12 F=6 L=6 Sh=1 (V-E+F)=2     33/33 checks passed
k0_topology_test  -> V=24 E=36 F=14 L=16(R=2) Sh=1        26/26 checks passed
```

`k0_topology_test` asserts the genus term is load-bearing rather than
decorative: the same counts validate at `(shells=1, genus=1)` and **fail** at
`(shells=1, genus=0)`.

These two files are not orphans. `forge-kernel/test/native/run_native.sh`
globs `forge-kernel/test/native/<class>/*.cpp` over 19 class directories,
collecting **142 tests** (61 of them under `brep/`), compiles every
`forge::native` source once and links each test against the whole object set.
CMake registers that script as the CTest case `kernel.native_suite`
(`forge-kernel/CMakeLists.txt:3215`, timeout 3600s). Neither test is named
anywhere in CMake or CI — they are reached by the glob, which is why grepping
for their names finds nothing and is not evidence that they never run.

`isClosedTwoManifold()` is the structural check that the arithmetic cannot
give: every edge has two mutually-mated opposite-sense coedges; every coedge
has a loop and consistent `next`/`prev` with `destVertex() == next->originVertex()`;
every loop returns to `first` after exactly `coedgeCount` steps.

## Operations that consume and produce these types

Of the 26 sibling headers in `forge-kernel/include/forge/native/brep/` that
include `Topology.hpp`, **21 declare at least one function taking a topology
type (`TopologyBuilder&`, `Solid`, `Shell`, `Face`, `Edge`, `Loop`, `Coedge`,
`Vertex`) in a parameter**:

`Aabb` `Boolean` `CadScoreGates` `ChamferAnalytic` `Check` `DraftAnalytic`
`FilletAnalytic` `Heal` `Hlr` `IgesWrite` `MassProps` `NativeRoute`
`OffsetShape` `Query` `Section` `Sew` `Shell` `SolidTessellate` `StepAnalytic`
`StepWatertight` `UnifyFaces`

Concretely: `booleanSolid(const Solid& A, const Solid& B, BoolOp op, …)`
(`Boolean.hpp:155`), `sewFaces(TopologyBuilder&, …)`, `healBRep(TopologyBuilder&, …)`,
`shellSolid(TopologyBuilder&, Solid*, const ShellOptions&)`,
`offsetSolidShape(TopologyBuilder&, Solid*, …)`,
`checkBRep(const Shell*)` / `checkBRep(const Solid*)`.

The gate probe `probe_ops_on_topology` looks for one sibling that includes
`Topology.hpp` and declares something taking `const Solid&`; 15 headers satisfy
that narrower pattern. The scope note must therefore **not** contain the phrase
"No booleans".

## What is genuinely NOT built

Stated as plainly as the section above. The first three are probed by
`tools/kernel/topology_honesty_gate.py`; the fourth is not (see below).

### No general Euler operator completeness — PROBED

Only `mev` exists, and the MEF role is filled by loop assembly (above).
`KEV`, `KEF`, `MEKR`, `KEMR` and `MZEV` appear **nowhere in the repository**
except in the single sentence of the header's scope note that denies them
(`Topology.hpp:39-40`) — measured case-*insensitively* over every `.hpp`/`.cpp`
in the tree, so no lowercase spelling hides either.

`TopologyBuilder` is append-only. Its member definitions in `Topology.cpp` are
ten factories, `findEdge`, `mev`, `buildCoedgeRing`, the two loop builders, the
two attach helpers, `buildBox`, `counts`, `isClosedTwoManifold` and a
`= default` destructor — not one of them erases from an element pool, and no
element is freed before the builder dies.

### …but the graph is not append-only, and `counts()` pays for it

"Nothing retires an element" would be the easy next sentence and it is **false**.
`Sew.cpp`'s `mergeEdges` (`Sew.cpp:341`) welds a duplicate edge away: it re-homes
the dead edge's coedge onto the survivor, mates it there, and then clears both
slots — `dead->coedgeA = nullptr; dead->coedgeB = nullptr` (`Sew.cpp:373-374`).
The `Edge` object itself stays in `edges_` for ever, because there is no way to
take it out.

`counts()` reports **pool sizes** (`c.edges = edges_.size()`), so it keeps
counting what sewing retired. Measured on two quads built from disjoint vertices
and then sewn:

```
before sew                          builder V=8  E=8
after sew  ok=1 mergedEdgePairs=1   counts():              V=8  E=8
                                    diagnoseShell(faces):  V=6  E=7  F=2
```

`Sew::diagnoseShell` recounts V/E/F from the faces' live coedge uses and gets the
true 6/7/2; `TopologyBuilder::counts()` over-reports by the retired edge and its
two now-orphaned vertices. **So `characteristic()` and `eulerPoincareValid()` are
trustworthy on a builder that has only ever been assembled, and not on one that
has been sewn** — the box and block-with-hole gates below are the former case.
Nothing gates that distinction.

Probe: `probe_euler_complete`. Falsifiable — the selftest appends a `KEV()`
function to `Topology.cpp` and the gate goes RED. Note it greps for the five
named operators only: the `Sew.cpp` retirement path above is invisible to it.

### No non-manifold REPRESENTATION — PROBED

`Edge` has exactly two coedge slots, `coedgeA` and `coedgeB`. There is no
container, so an edge shared by three or more faces cannot be represented.
`makeCoedge` handles a third use with
`assert(false && "edge already has two coedges (non-manifold use)")`.

Measured behaviour of that path, both ways:

- asserts on: aborts, `Assertion failed: … function makeCoedge … line 84`, exit 134.
- `-DNDEBUG`: the third coedge is still allocated and pushed into `coedges_`,
  but it is attached to **neither** slot and its `mate` stays `nullptr`. The
  first two coedges keep their correct mates. `isClosedTwoManifold()` then
  returns **false**.

So the limit is enforced structurally in a release build too: the graph reports
itself invalid rather than silently accepting a non-manifold edge. It does not
*represent* one either way.

Detecting and repairing non-manifold input is a different thing and **is**
built: `Check.hpp` raises `CheckStatus::NonManifoldEdge` under the taxonomy id
`T9.NoNonManifoldEdge` (`Check.cpp:609`), and `Heal.hpp` has
`HealOptions::resolveNonManifold` (default `true`) and reports
`unfixedNonManifoldEdgeIds` / `unfixedNonManifoldEdgeReport`. Detecting and
repairing is not supporting.

Probe: `probe_nonmanifold_representation`, which parses the `Edge` struct body
and reports the capability as present if it finds a `vector`/`array` of
`Coedge` or loses the two named slots. Falsifiable — the selftest swaps
`coedgeB` for `std::vector<Coedge*> coedges` and the gate goes RED. If the
`Edge` struct is reshaped so the regex no longer matches, the probe reports
*present* on purpose, so a human has to look.

### No persistent-ID minting via the existing LineageRegistry — PROBED

`LineageRegistry` is real and works: `forge-kernel/include/forge/LineageRegistry.hpp`
declares a thread-safe singleton mapping a `ShapeHandle` to a list of
`Survivor / Split / Merge / Birth / Death` entries, `src/LineageRegistry.cpp`
implements it, `src/Booleans.cpp:290` populates it, and `src/binding.cpp:6274`
exports it to JS as `forge.lineageFor(handle)` (the registry read inside that
lambda is `binding.cpp:6282`). Five files reference it, over 15 lines.

**None of them is in the native B-Rep tree.** `LineageRegistry` appears exactly
once under `forge-kernel/{include/forge,src}/native/brep/`, and that once is the
header sentence denying it. The registry is keyed on `ShapeHandle` and built by
walking OCCT's `BRepAlgoAPI_*::Modified/Generated/IsDeleted`; it has no
connection to the `std::uint32_t id` fields on this graph, which are
builder-local and do not survive a rebuild.

This is the gap `MIGRATION.md` calls the single most important lesson of the
migration: face identity is a first-class acceptance criterion, and the native
graph currently has no identity that persists across an edit.

Probe: `probe_lineage_ids`, which greps the brep tree (past the header's own
prose block) for `LineageRegistry`.

### No genus>0 handle operators — NOT PROBED

Genus-1 solids are produced routinely, but always by *construction* — a hole
ring plus a wall band, as in the `k0_topology_test` block-with-hole or
`Gear.hpp`'s bevel-with-bore — never by an Euler handle operator. Nothing mints
a handle.

`genus` is a parameter to `eulerPoincareValid` and is **computed** downstream:
`Sew.cpp:231` derives `d.genus = (2 - d.eulerCharacteristic) / 2` per shell, and
`CadScoreGates` reports per-shell genus and Betti numbers. `Check.hpp` asserts
`T8 EulerPoincareConsistent` against the reported genus.

This denial is in the header's NOT-built list but it has no probe, so it can go
stale exactly the way the geometry denial did.

## What the gate does not cover

The honesty gate is narrow on purpose, and it is worth being explicit about the
holes so nobody reads a green check as more than it is.

| | |
|---|---:|
| probes defined in the gate | 5 |
| `CLAIMS` entries checked | 5 |
| bullets in the header's NOT-built list | 4 |
| of those bullets, probed | **3** |
| selftest mutations proving a probe can flip | 3 |

1. **The genus-handle-operator denial is unprobed.** Three of the four denials
   have a probe; that one does not.
2. **The gate reads only the text after `What is genuinely NOT built`.** Prose
   anywhere else in the header — including the three stale inline comments about
   single-loop faces and single-shell solids, the two false "set ONLY by …"
   marker comments at `:256` and `:271`, and the "MEV / MEF mutators" summary
   line — is invisible to it. A comment inside the gate's `check()` function
   (`topology_honesty_gate.py:107-110`, not its module docstring) records that a
   whole-preamble search was tried and produced a false positive, which is why it
   was narrowed; the cost of that narrowing is this hole.
3. **`probe_ops_on_topology` matches `const Solid&` only.** Six of the 21
   headers that take a topology type in a parameter fail that narrower pattern
   because their entry points take `TopologyBuilder&`, `Solid*` or `Shell*`:
   `Check`, `DraftAnalytic`, `Heal`, `OffsetShape`, `Sew`, `Shell`. One match is
   enough for the gate to pass, so this does not weaken it today, but it is not
   a census of operations.
4. **The gate checks wording, not behaviour.** It cannot tell whether `mev` is
   called, whether the graph is correct, or whether a loop is wound the right
   way. That evidence is `kernel.native_suite`.
5. **No probe looks for element retirement.** `probe_euler_complete` greps for
   five named Euler operators; `Sew.cpp`'s edge merge retires edges under none of
   those names, and the resulting `counts()` over-report (above) is unprobed.

Where it runs: `tools/gates/preflight.sh:47` and
`.github/workflows/gate-registration.yml:225-226` (which runs the gate and its
`--selftest`).

## Reproducing every number

Run from the worktree root. Each command produced exactly one claim above.

```sh
# pin
git rev-parse HEAD                                  # ddef657b…
git status --porcelain -uno                         # empty at measurement time
git status --porcelain                              # never empty: untracked docs/kernel/*.md
python3 tools/kernel/topology_honesty_gate.py
python3 tools/kernel/topology_honesty_gate.py --selftest
python3 tools/kernel/occt_dependency_graph.py --check

# size and independence
wc -l forge-kernel/include/forge/native/brep/Topology.hpp \
      forge-kernel/src/native/brep/Topology.cpp
grep -nE '\b(gp_[A-Za-z]+|TopoDS[_A-Za-z]*|BRep[A-Za-z_]*|Standard_[A-Za-z]+|TopAbs[_A-Za-z]*|Geom_[A-Za-z]+|Handle\()' \
     forge-kernel/include/forge/native/brep/Topology.hpp \
     forge-kernel/src/native/brep/Topology.cpp          # no output
grep -rl 'native/brep/Topology.hpp' --include='*.hpp' --include='*.cpp' . | wc -l   # 104

# Euler operators
grep -rnE '\bmev\b' --include='*.hpp' --include='*.cpp' .   # 2 lines: decl + def
grep -rniE '\bmef\b' --include='*.hpp' --include='*.cpp' .  # 4 lines, ALL comments
grep -rniE '\b(KEV|KEF|MEKR|KEMR|MZEV)\b' --include='*.hpp' --include='*.cpp' .
                                                            # only Topology.hpp:39-40
grep -rn 'addOuterLoopToFace' --include='*.hpp' --include='*.cpp' . | wc -l   # 140
grep -rn 'addInnerLoopToFace(' --include='*.hpp' --include='*.cpp' . | grep -v '//' | wc -l
                                                 # 25 lines = 23 calls + decl + def

# the integration markers (the header's "set ONLY by …" comments are wrong)
grep -rn 'boolHoled *= *true' --include='*.cpp' .   # 4 files, not 1
grep -rn 'regionUV *= *true'  --include='*.cpp' .   # 7 sites in 2 files, not 1

# element retirement: the builder is append-only, the GRAPH is not
grep -n 'coedgeA = nullptr' forge-kernel/src/native/brep/Sew.cpp   # :373 (mergeEdges)
# probe TU: build two disjoint quads, sewFaces(), then print tb.counts() beside
# diagnoseShell(faces)  ->  counts V=8 E=8 vs diagnose V=6 E=7 F=2

# geometry binding
inc=$(grep -rl 'native/brep/Topology.hpp' --include='*.hpp' --include='*.cpp' . | sed 's|^\./||')
echo "$inc" | xargs grep -lE -- '->(curve|surface)\b' | wc -l                 # 32
grep -rl 'makeSurface' --include='*.hpp' --include='*.cpp' . | wc -l          # 30

# multi-shell solids (the stale "one outer shell" comment)
grep -rnE 'for \(Shell\* [a-z]+ : [^)]*\)[^;]*addShellToSolid' \
     --include='*.cpp' --include='*.hpp' . | wc -l        # 13 one-liners
grep -rn -B2 'addShellToSolid' --include='*.cpp' . | grep -E 'for \(Shell\*'
                                                          # + 3 two-line forms = 16

# lineage  (-rl for the FILE count; -rn counts LINES and gives 15, not 5)
grep -rl 'LineageRegistry' --include='*.hpp' --include='*.cpp' . | wc -l      # 5 files
grep -rn 'LineageRegistry' forge-kernel/include/forge/native/brep \
                           forge-kernel/src/native/brep   # 1 line: the denial

# the two standalone gates (also reached by run_native.sh's glob)
clang++ -std=c++20 -O2 -I forge-kernel/include \
  forge-kernel/src/native/brep/{Topology,Surface,Curve,Nurbs,NurbsSurface}.cpp \
  forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
  forge-kernel/test/native/brep/k0_topology_test.cpp -o /tmp/k0 && /tmp/k0
clang++ -std=c++20 -O2 -I forge-kernel/include \
  forge-kernel/src/native/brep/{Topology,Surface,Curve,Nurbs,NurbsSurface}.cpp \
  forge-kernel/src/native/mesh/HalfEdgeMesh.cpp \
  forge-kernel/test/native/brep/brep_test.cpp -o /tmp/bt && /tmp/bt

# the third-coedge probe (build the same TU twice, with and without -DNDEBUG)
# builds an Edge, three Coedges on it, prints the slots/mate and isClosedTwoManifold()
```
