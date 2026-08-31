# Family census — ASSEMBLY, and PMI / GD&T

Branch `census/assembly-pmi`, base `origin/claude/sacrosanct-execution-20260828` @ `a457bea2`.
Every number below was measured in this session from the files cited. Nothing is carried
forward from a prior report.

## What I VERIFIED vs what I could NOT

**Verified by reading real implementations with bodies and following them to a call site:**
the IR value model and op table; the 18/22 allowed/forbidden split and the exact argument
forms each UI command emits; the assembly kernel modules (ComponentRegistry, AssemblySolver,
AssemblyHierarchy, InterferenceDetection, MotionStudy, MateLibrary) including their CMake
membership and N-API exports; the composite scorer and the interface metric it calls; the
GD&T modules and their CMake membership; the MUSE rubric corpus.

**Verified by measurement, not by reading:** the per-family interface table and the emitted-op
histogram, both computed over the same 600 records of the composite anchor run
`axis_named_v7_e600` (`runs/composite_anchor/scored/v7_s{0..9}.json` and
`runs/composite_anchor/axis_named_v7_e600/emissions.jsonl` in `archdisc-Models`).

**Could NOT verify:** nothing here was executed. There is no built `forge-kernel.node`
anywhere in this worktree (`find . -name '*.node'` → empty), so every claim about assembly
and GD&T runtime behaviour is a claim about **source that is compiled into the build graph**,
not about a binary I ran. Where a file is *not* in the build graph I say so explicitly,
because that is the whole finding in two places.

---

## 1. The 40% question, answered first — because it changes the priority of everything else

**The brief asks whether `interface` — 40% of the composite — is about mating, and therefore
whether assembly capability is 40% of the score. The answer is: interface is entirely about
MATING FEATURES, and entirely about ONE SOLID. Assembly modelling earns zero of it.**

There are two live definitions of `interface` in this programme and neither needs a component,
an instance, a transform stack or a mate:

| | definition | measured on | source |
|---|---|---|---|
| The scorer this programme actually reports | six mating-feature families recovered from the pinned verifier's per-face census: `bore`, `counterbore`, `bolt_circle`, `bolt_pattern`, `mating_face`, `shaft_land`; scored as F1 of matched-vs-expected | **one built solid** | `archdisc-Models/scripts/interface_metrics.py:418` `extract_interface`, `:953` `score_interface`; weights at `scripts/composite_score.py:2` |
| CADGenBench's own published interface | per-feature keep-in / keep-out sub-volume jigs, volumetric IoU `tp/(tp+fp+fn)` through the ramp `IoU≥0.95→1, ≤0.80→0, linear` | **one candidate solid against a fixture's jig volumes** | `forge-kernel/test/cadscore_harness.mjs:630` `scoreInterface`, ramp at `:393`; reconciliation at `CADGENBENCH_SPEC.md:284` |

`CADGENBENCH_SPEC.md:290-300` states the boundary in the repo's own words: the one
multi-body scorer that exists, `scoreMate()` (`cadscore_harness.mjs:692`, which really does
place two instances via `forge.addInstance` and run `forge.assembly.detectInterference`), is
"a Forge-specific assembly-context extension, **not** in CADGenBench's published rubric
(CADGenBench interface jigs are single-candidate keep-in/keep-out)." Its only caller is a
verification script, `forge-kernel/test/verify_gdt_assembly_bridge.mjs:94`. It has never
contributed to a reported score.

### So interface is not assembly. But it IS the largest measured hole in the project.

Measured over the 600 records of the composite anchor (`v7_s0..s9`, 527 `ok`, 0 vacuous):

```
mean shape 0.2842   mean interface 0.2470   mean topology 0.4547   mean composite 0.3034
```

Interface is the *worst* of the three components, and it carries the joint-largest weight.
Per family, summed over all 600 records:

| family | expected | found | matched | spurious | recall | precision |
|---|---:|---:|---:|---:|---:|---:|
| bore | 4891 | 2885 | 1896 | 989 | 0.388 | 0.657 |
| counterbore | 541 | 10 | **0** | 10 | **0.000** | 0.000 |
| bolt_circle | 273 | 98 | 76 | 22 | 0.278 | 0.776 |
| bolt_pattern | 559 | 330 | 105 | 225 | 0.188 | 0.318 |
| mating_face | 688 | 668 | 203 | 465 | 0.295 | 0.304 |
| shaft_land | 931 | 90 | 19 | 71 | **0.020** | 0.211 |
| **total** | **7883** | **4081** | **2299** | | | |

### And the cause of the two zeros is not a missing kernel op. It is that the model never emits the op.

Parsing every `%id = OP(` in the *same* 600 emissions that produced the table above:

| op | occurrences | rows (of 600) |
|---|---:|---:|
| HOLE | 15454 | 538 |
| EXTRUDE | 1314 | 505 |
| TRANSLATE | 1044 | 216 |
| POLY | 892 | 503 |
| FUSE | 723 | 63 |
| PATTERN | 640 | 40 |
| VERIFY | 533 | 416 |
| CIRCLE | 343 | 19 |
| ROTATE | 231 | 107 |
| CYL | 225 | 79 |
| CUT | 195 | 24 |
| RECT | 123 | 51 |
| *(non-ops: PLY 41, FST 13, CONE 9, POISSON 8, PUSH 3)* | | |

**`CBORE` occurs zero times in 600 emissions.** So do `FILLET`, `CHAMFER`, `SHELL`, `LOFT`,
`REVOLVE`, `MIRROR`, `BLEND`, `RING`, `WIRE`, `SWEEP`, `SPHERE`, `TORUS`, `TUBE`, `SLOT`,
`RRECT`, `REGPOLY`, `PRISM`. The model's *effective* vocabulary is 12 ops, not 18 and not 40.
Against 541 expected counterbores it emitted the op zero times and matched zero; the 10 it
"found" are accidental — two stacked `HOLE`s of different radius on one axis.

There is a second, smaller gate stacked behind that one, and it is a real capability gate.
`part.counterbore` (`ui/src/PartCommands.cpp:757-785`) pushes exactly six parameters and emits
**exactly 7 arguments** — `CBORE(%body, dia, cboreDia, cboreDepth, cx, cy, cz)` — with no
axis. The vocabulary records this as the op's only emittable form
(`ArchieOpVocabulary.hpp:153` `OpRow{"CBORE", … kernelMin 7, kernelMax 10, form {7,7}}`),
while the kernel signature is `CBORE(%body, dia, cboreDia, cboreDepth, cx, cy, cz [, axx, axy,
axz])` (`FeatureTree.hpp:116`). **The kernel can cut a counterbore on any axis; the app can
only cut one along +Z.** Fixing the emission without fixing the form buys Z-axis counterbores
only.

`shaft_land` — an *external* convex cylindrical land, the male half of a fit — is the same
story from the other side. It needs an external cylinder. `CYL` is a **forbidden** op
(`ArchieOpVocabulary.hpp:181`), and the model emits it anyway, 225 times across 79 rows: it is
already producing IR that no user of the app could have produced. (`CYL` is assigned to
another agent; I note it only because it is the numerator of a 0.020 recall.)

**The strategic consequence.** Assembly-adjacent capability is *not* 40% of the score. But
interface *fidelity on a single part* is, it is the weakest of the three components, and its
two total failures are op-emission problems on ops the kernel already has, not missing
families. That is the cheapest 0.4-weighted point in the project and it sits outside my two
families. **I state it here because the brief asked me to establish it either way, and the
honest answer redirects effort away from assembly.**

---

## 2. ASSEMBLY

The IR value model is three kinds — `PROFILE`, `WIRE`, `SOLID` — stated at
`forge-kernel/include/forge/ft/FeatureTree.hpp:26-33` and repeated in
`forge-kernel/docs/feature_tree_ir.md:30-36`. `compile()` binds one result:
`FeatureTreeCompiler.cpp:2247-2255` resolves `RESULT(%id)` to a single SOLID or falls back to
`lastSolid`. There is no ASSEMBLY kind, no instance, no transform stack, and no multi-body
result. The `bodies` hint in the brief is `shellCount`, defined at
`forge-kernel/include/forge/Topology.hpp:30` as "connected components of the welded mesh" and
computed by union-find at `src/TopologySignature.cpp:93` — it is a *topology invariant of one
shape*, not an assembly.

| op / capability | exists in kernel? (file:line) | reachable from IR? | user-invocable? | value kinds needed | what it would take | benchmark that scores it |
|---|---|---|---|---|---|---|
| component instance (shape + 4×4) | **YES** `ComponentRegistry.hpp:60,65`, impl `src/ComponentRegistry.cpp` (296 L), CMake `forge-kernel/CMakeLists.txt:1294` | **NO** | app: **NO** (no `forge::ui` command); Archie JS tools: **YES** `ForgeToolBridge.js:1958` `assembly.add-instance` | **ASSEMBLY** | one IR op + one value kind; the store exists | MUSE (rubric 1) |
| sub-assembly tree / world transform | **YES** `AssemblyHierarchy.hpp:31,50`, impl 124 L, CMake `:1298` | **NO** | app: **NO**; JS: partial (`assemblyDispatch.js:238` `setParent`) | ASSEMBLY | one op `PARENT(%asm,%child,%parent)` | MUSE (rubric 1) |
| mates: coincident / concentric / parallel / perpendicular / distance / angle / tangent / fixed | **YES** `AssemblySolver.hpp:50` (8 kinds), solver `src/AssemblySolver.cpp:435` (sparse-QR damped Gauss-Newton, 661 L), CMake `:1297` | **NO** | app: **NO**; JS: **YES** `ForgeToolBridge.js:1967,1982` | ASSEMBLY | one `MATE` op + one `SOLVE`; solver exists | MUSE (rubric 2 Joint Design) |
| mates: gear / rack-pinion / cam / slot / width (12 total) | **YES** `MateLibrary.hpp:73-88`, impl 811 L, CMake `:1577`, N-API `forge.matelib.solve` (smoke `test/matelib_smoke.js:66`) | **NO** | app: **NO**; JS: reachable only via raw `forge.matelib` | ASSEMBLY | same op, wider `kind` keyword set | MUSE (rubric 2) |
| component pattern (linear / circular / mirror / on-curve) | **JS only** `frontend/src/kernel/forge/Assembly.js:296` `ComponentPattern` — returns transform plans; **no C++ equivalent** | **NO** | app: **NO**; JS: yes, by composing with `addInstance` | ASSEMBLY | `ASMPATTERN` op; ~a day on top of the ASSEMBLY kind | MUSE (rubric 1) |
| interference detection | **YES** `InterferenceDetection.hpp:37`, impl `src/InterferenceDetection.cpp:210` (BVH broad phase + exact boolean narrow phase), CMake `:1299`. Native narrow phase is **default-ON** and A/B-gated against OCCT (`test/native_vs_occt_interference.cpp:1-36`) | **NO** | app: **NO** (`interference` is a docked panel with no content — see below); JS: **YES** `ForgeToolBridge.js:3496` | ASSEMBLY | a `CLASH` pass-through op in the `VERIFY` shape | not scored by any benchmark I can find |
| motion study | **YES** `MotionStudy.hpp:47` `runMotionStudy`, impl 87 L, CMake `:1300` | **NO** | app: **NO**; JS: **YES** `ForgeToolBridge.js:2436` | ASSEMBLY | out of scope for a census — no benchmark scores it | none |
| BOM rollup | **JS only** `frontend/src/kernel/forge/Assembly.js:253` `BomRollup` (walks `assembly.getChildren`, aggregates qty/mass/cost); unit test `drawings/__tests__/BomRollup.test.mjs`; e2e `e2e/push-116-bom-aggregator.spec.js`, `push-60-bom-csv.spec.js`, `push-93-bom-balloons.spec.js`. **No C++ `BomRollup` exists** — the name appears in `AssemblyHierarchy.hpp:13` only as a comment about a helper that walks children | **NO** | app: **NO**; JS: yes | ASSEMBLY | derived from the tree; trivial once the kind exists | none |
| multi-body / compound RESULT | substrate **YES** `native/shape/Compound.hpp:33` (ordered heterogeneous child list, nestable) | **NO** — `compile()` binds one SOLID (`FeatureTreeCompiler.cpp:2247-2255`) | n/a | ASSEMBLY, or a compound SOLID | export path also needed: `IoExchange.hpp:38` `exportStep(ShapeHandle,…)` takes one handle; no assembly/product-structure STEP writer exists | MUSE (rubrics 1,2,3); indirectly the composite's `shellCount` term |

### The Assembly workspace exists as a layout with zero commands behind it

`ui/include/forge/ui/WorkspaceProfile.hpp:3-4` names eight workspaces including Assembly;
`ui/src/WorkspaceProfile.cpp:83-84` gives Assembly a dock layout of `assembly_tree` +
`component_filter`. `forge-desktop/src/ForgeFrame.cpp:65-67` gives friendly names to
`assembly_tree`, `component_filter`, `mates`, `interference`, `bom`. But
`ForgeFrame.cpp:1406-1429` routes `assembly_tree` into the generic *feature-tree* panel, and
`mates` / `interference` / `bom` fall through to `drawGenericPanel`
(`ForgeFrame.cpp:2134-2154`), which honestly prints "Its content is not implemented in this
segment" and then lists the commands the workspace owns. Those commands are the 21 `part.*`
commands — grepping every `"<word>.<word>"` literal in `ui/src/` returns only `part.*`,
`app.command_palette`, `edit.*`, `file.*`, `view.*`, `workspace.next`. **There is not one
assembly command in the `forge::ui` registry.**

### Two apps, and only one of them has assembly

The C++ ImGui app (`forge-desktop` over `ui/`) has none of it. The JS/Electron app
(`frontend/`) has most of it: 8 `assembly.*` Archie verbs
(`ForgeToolBridge.js:1958,1967,1982,1987,1996,2006,2016,3496`), a 350-line dispatch layer
(`frontend/src/forge-v4/assemblyDispatch.js`) exposing 12 mate kinds split into native and
JS-solved sets, and e2e specs that click real panels: `push-04-mate-solver`,
`push-37-assembly-mates`, `push-59-interference`, `push-116-bom-aggregator`,
`push-207-100k-assembly`. **The assembly capability is real, it is wired to a UI, and the
feature-tree IR — the format Archie is actually trained to emit — cannot address any of it.**

---

## 3. PMI / GD&T

| op / capability | exists in kernel? (file:line) | reachable from IR? | user-invocable? | value kinds needed | what it would take | benchmark that scores it |
|---|---|---|---|---|---|---|
| datum declaration (A/B/C on a face) | **no kernel op.** JS verb `ForgeToolBridge.js:3378` `gdt.datum` | **NO** | app (ImGui): **NO**; JS app: **YES** | **none** — pass-through on SOLID, exactly like `TAG` | one op `DATUM(%body,"A","sel")` returning `%body` | none |
| feature control frame (author) | **no kernel op.** JS: `ForgeToolBridge.js:3396` `gdt.feature-control-frame`, `:3424` position-relative-to-mate, `:3449` concentric-to-mate; string legality in `frontend/src/forge-v4/asmeY145Rules.js` | **NO** | app: **NO**; JS: **YES** | **none** — pass-through on SOLID | one op `FCF(%body, CHAR, tol, "A","B", "sel")` | none |
| FCF string legality (Y14.5 well-formedness) | **YES, compiled** `native/gdt/Gdt.hpp:435` `checkFcfLegality`, impl in `src/native/gdt/Gdt.cpp` (38 KB), CMake `:1592` | **NO** | **NO** — not among the N-API exports | none | expose it; it is already built | none |
| GD&T geometric math on a POINT SET (DRF, true position + MMC/LMC bonus, flatness, orientation, circularity, cylindricity, profile) | **YES, compiled** `native/gdt/Gdt.hpp` — 22 public functions, CMake `:1592` | **NO** | **2 of 22** reach JS: `binding.cpp:17194` `gdtTruePosition`, `:17238` `gdtFlatness` | none | expose the other 20 | none |
| GD&T geometric evaluation on a BUILT B-REP (sample the native surface, fit the substitute feature, build the DRF, evaluate 11 characteristics) | **the code exists and is 849 lines** — `src/native/gdt/FcfEvaluator.cpp`, header `include/forge/native/gdt/FcfEvaluator.hpp` (18 KB of specification) — **but it is NOT in `forge-kernel/CMakeLists.txt`, has no call site anywhere in the repo, and the gate its own header names (`test/native/gdt/fcf_evaluator_test.cpp`) does not exist.** It has never been compiled. | **NO** | **NO** | none | add it to CMake, write the gate it already names, expose it | none |
| PMI → STEP AP242, C++ path | **YES but text-only** `IoExchange.cpp:487` `exportStepWithPmi` writes a vanilla STEP and then appends the FCFs as ISO-10303-21 `/* PMI_FCF: … */` **comments**. A conforming AP242 reader sees nothing. N-API at `binding.cpp:6599` | **NO** | app: **NO**; JS: via `part.annotate-pmi` (`ForgeToolBridge.js:3331`) | none | see below | none |
| PMI → STEP AP242, JS path | **YES and semantic** `frontend/src/forge-v4/ap242Export.js` (293 L) emits real EXPRESS entities — 14 `AP242_TOL_KINDS`, material-condition modifiers, `SEMANTIC_TEXT_OBJECT` chain, `FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING'))` | **NO** | JS: **YES** `gdt.write-step` (`:3475`); e2e `push-111-ap242-pmi.spec.js` | none | — | none |
| GD&T frames panel, surface finish, MBD annotation | **JS** `kernel/forge/specialty/MBDAnnotation.js:46`, `Ap242PmiEntities.js:84`; drawing FCF boxes `forge-v4/drawing/autoDrawing.js:488-534`; e2e `push-92-gdt-frames`, `push-78-pmi-annotations`, `push-12-pmi` | **NO** | JS: **YES** | none | — | none |
| tolerance stack-up | **YES, compiled** `native/tolstack/Tolstack.hpp`, CMake `:1742` | **NO** | not checked | none | — | none |

### The `fcf` tool in the verified tool-suite is `archdisc-Models/scripts/fcf_evaluator.py`

1135 lines, pure Python stdlib. It is a **measurement** tool, not a modelling capability: it
takes a built STEP's per-face census (via `scripts/inv_of_step.mjs`) plus a datum/feature spec
and computes real geometric values for POSITION, FLATNESS, PERPENDICULARITY / PARALLELISM and
RUNOUT off the face normals, centroids, radii and areas, returning
`{feature, characteristic, glyph, datums, measured, tolerance, pass, unit, n_features, detail}`.
Its own docstring states the gap it closes: the stack "could DECLARE feature-control-frames …
but had NO way to MEASURE whether the built B-Rep actually satisfies them."

**Note the collision.** `fcf_evaluator.py` (Python, offline, census-based, in use) and
`FcfEvaluator.cpp` (C++, native-B-rep, 849 lines, **never compiled**) are two independent
answers to the same problem. The C++ one is strictly more capable — it samples the kernel's own
analytic `Surface::evaluate(u,v)` rather than reading a face summary, and covers 11
characteristics rather than 4 — and it is the one that is dead. Its header even claims a gate
that was never written. This is the "a file nothing compiles cannot break" pattern exactly.

---

## 4. Which benchmarks score assembly or PMI

**PMI / GD&T: none. Plainly and completely none.** I checked the composite scorer
(shape / interface / topology only), the CADGenBench spec (four axes: validity gate, shape,
interface, topology — `CADGENBENCH_SPEC.md:405`), and all 106 MUSE rubrics: **0 of 106 mention
GD&T, a datum, or a feature control frame.** Every PMI capability in this repo — the compiled
`Gdt.cpp`, the dead `FcfEvaluator.cpp`, `ap242Export.js`, the `gdt.*` verbs,
`fcf_evaluator.py` — is scored by nothing. That is a legitimate finding and it should
de-prioritise the whole family relative to its apparent size.

**Assembly: exactly one benchmark, and it scores it hard.**

MUSE (`archdisc-Models/data/muse`, 106 cases, `metadata.jsonl`) gives every case a six-axis
rubric. All 106 cases carry all six axes:

`Assembly Readiness` · `Joint Design` · `Tolerance` · `Functional Adaptation` ·
`Usage Stability` · `Manufacturability`

- **Axis 1 is a component graph.** All 106 rubrics contain the phrase "Component Assembly
  Graph" and instruct the judge to infer it by "treating each visible component as a graph
  node and each physical connection relationship as an edge."
- **34 of 106 rubrics name an explicit N-component target**, ranging from 2 to 44
  (the modal value is 9).
- **29 of 106 make illegal fusion an explicit 0-point criterion** — e.g. "seams disappearing
  entirely because separate boards are illegally fused into monolithic solids",
  "shelf slats … fused into one continuous board".
- Axis 2 (Joint Design) judges pinned / interlocking / snap-fit connection semantics between
  components and their assembly directions.
- Axis 3 (Tolerance) fails a model whose contact interfaces have vanished into a single solid.

So **2 of 6 MUSE axes are directly assembly, and a third penalises fusion.** A pipeline whose
emission format can produce exactly one welded solid is capped on roughly a third of MUSE
before the geometry is even looked at. (Separately: the standing measured result is that the
MUSE *gate* floor is 100% — a box passes 106/106 — so the gate is not the discriminator; the
rubric is, and the rubric is where assembly lives.)

**The composite, obliquely.** `shellCount` is half of the topology term, which is 0.2 of the
composite, so 0.1 rides on matching the reference's connected-component count
(`composite_score.py:366-386`, `0.5*genus + 0.5*shell`, each `max(0, 1-|d|/max(1,ref))`).
Measured over the anchor's 600 references: **264 are single-shell (44%), 263 are 2-shell (44%),
73 are 3-or-more-shell (12%, up to 36).** The candidate is single-shell in 404 of 430 scored
rows. Mean shell score is 0.664 overall but **0.435 on the 236 scored rows whose reference has
more than one shell** — about 0.056 of composite left on the table there. I will not overclaim
this: `shellCount` counts *connected components of the welded tessellation*, so a hollow part
with one enclosed void also reads as 2. The 2-shell half of that distribution is genuinely
ambiguous. The 73 references at 3+ shells are not — whatever they are, a single fused solid
cannot reach them.

---

## 5. The four questions, per family

### ASSEMBLY

**1. What is ALREADY BUILT and merely unreachable — the cheapest capability in the project.**

Loudly: **~2,300 lines of compiled, CMake-linked, N-API-exported C++ assembly kernel, plus
~1,050 lines of JS on top of it, are invisible to the IR.**

| module | lines | in CMake | exported to JS |
|---|---:|---|---|
| `src/AssemblySolver.cpp` — 8 mate kinds, sparse-QR damped Gauss-Newton, fixed-instance pinning, driving-mate lookup | 661 | `:1297` | `forge.assembly.addMate/solve/setFixed/…` (`binding.cpp:6372-6398`) |
| `src/MateLibrary.cpp` — 12 SolidWorks-equivalent mate kinds incl. gear / rack-pinion / cam / slot / width, damped Gauss-Seidel on quaternion poses | 811 | `:1577` | `forge.matelib.solve` |
| `src/ComponentRegistry.cpp` — instance store, world AABBs, BVH, ray + frustum + AABB queries, bulk reserve for 100k instances | 296 | `:1294` | `forge.addInstance/removeInstance` |
| `src/InterferenceDetection.cpp` — BVH broad phase + exact-boolean narrow phase; **native narrow phase default-ON**, A/B-gated against OCCT | 279 | `:1299` | `forge.assembly.detectInterference` |
| `src/AssemblyHierarchy.cpp` — parent/child tree, cycle rejection, recursive world transform | 124 | `:1298` | `forge.assembly.setParent/getChildren/worldTransform` |
| `src/MotionStudy.cpp` — drive a mate value through a sweep, re-solving each frame | 87 | `:1300` | `forge.assembly.runMotionStudy` |

Plus, JS-only: `ComponentPattern` (4 pattern kinds) and `BomRollup` (qty/mass/cost aggregation
over the hierarchy), both in `frontend/src/kernel/forge/Assembly.js`.

Nothing on this list needs to be written. **All of it needs is a name in the IR.** That is a
sharper version of the 22-forbidden-ops finding: those 22 ops at least exist *in the IR* and
are merely refused; this whole family does not exist in the IR at all.

**2. What new IR value kind does this family require?**

One: **`ASSEMBLY`** — an ordered set of component instances, each `{SOLID, 4×4 transform,
parent}`. It is backed one-to-one by `ComponentRegistry` + `AssemblyHierarchy`, which already
hold exactly that. Everything else in the family (mates, patterns, clash, BOM, motion) is an op
over that kind, not a new kind.

Mates do **not** need a kind of their own: like `TAG` and `VERIFY` they are pass-through —
`MATE(%asm, …)` returns `%asm`. Nor does an "instance" need one, if `INSTANCE` returns a
one-member ASSEMBLY and `ASM` concatenates.

The family is blocked on that kind and on nothing else.

**3. What is genuinely absent, and how long?**

Genuinely absent, in order of size:

- **The `ASSEMBLY` value kind and its ops in `forge::ft`.** New `OpCode`s, a `Val::Assembly`
  variant in the compiler environment, and the builders. Every builder body is a call into an
  existing function. **Days, not weeks** — I would budget one week for the kind + `INSTANCE` /
  `ASM` / `MATE` / `SOLVE` / `CLASH` with tests, because the compiler's value environment and
  the `s0.4` cardinality ledger both have to learn a fourth kind and every `switch` over
  `OpCode` must stay total (`OpCode::Unknown` already enforces that discipline).
- **A multi-solid STEP writer.** `exportStep` takes one `ShapeHandle`
  (`IoExchange.hpp:38`); there is no product-structure / `NEXT_ASSEMBLY_USAGE_OCCURRENCE`
  writer. The `Compound` substrate exists (`native/shape/Compound.hpp:33`). Without this, an
  ASSEMBLY has no export and no way to be scored. **1–2 weeks**, and it is on the critical path
  for MUSE — the rubric is judged from renders of the exported artefact.
- **A component pattern in C++.** JS-only today. **Days** once the kind exists.
- **A BOM rollup in C++.** JS-only today; the C++ `BomRollup` referenced in
  `AssemblyHierarchy.hpp:13` does not exist. **Days.**
- **Assembly commands in the `forge::ui` registry, and content for the `mates` /
  `interference` / `bom` panels.** **Weeks**, and note that `forge-desktop` is not compiled by
  CI, so this work would ship unverified unless that is fixed first.

Not absent, despite appearances: the mate solver, the interference engine, the hierarchy, the
instance store, the motion study.

**4. What would a MINIMAL honest version look like?**

Six ops and one kind, chosen so that every one of them lands on machinery that already exists:

```
%10 = INSTANCE(%body, dx, dy, dz [, rotDeg, axx, axy, axz])   -> ASSEMBLY  (1 member)
%11 = ASM(%10, %9, ...)                                        -> ASSEMBLY  (concatenate/nest)
%12 = MATE(%11, CONCENTRIC, %10, 1, %9, 1 [, value])           -> ASSEMBLY  (pass-through)
%13 = SOLVE(%12)                                               -> ASSEMBLY  (writes transforms back)
%14 = ASMPATTERN(%13, %10, POLAR, 6, 360, ...)                 -> ASSEMBLY
%15 = CLASH(%14 [, tol])                                       -> ASSEMBLY  (pass-through, VERIFY-shaped)
RESULT(%14)                                                    -> multi-solid STEP
```

`MATE`'s second argument is a keyword, so the 8 registry kinds and the 12 matelib kinds are one
op with a widening keyword set — no new op per mate type, ever.

**Honouring "don't gate anything."** The refusal risk in a new value kind is a type error, and
a type error on op 300 of a 400-op tree throws the whole tree away. So the coercions are
mandatory, not optional:

- an **ASSEMBLY where a SOLID is expected** (a boolean, `HOLE`, `FILLET`, `RESULT` in a
  single-body task) implicitly resolves to the fused union of its members, and records that it
  did so. Never a refusal.
- a **SOLID where an ASSEMBLY is expected** implicitly becomes a one-member ASSEMBLY at
  identity. Never a refusal.
- an **unsolvable or over-constrained mate set** keeps the last converged poses, records the
  residual and the offending mate ids, and returns the ASSEMBLY. `AssemblySolver.hpp:75-79`
  already returns `{converged, iterations, residual}` rather than throwing, and
  `MateLibrary.hpp:101` already carries a per-mate anomaly log — the non-gating behaviour is
  the behaviour the existing solvers were written to have. It must not be tightened on the way
  into the IR.
- **`CLASH` reports; it never fails the build.** Interference is a design fact, not a syntax
  error. It names the two instance ids and the overlap volume so a repair loop can act — which
  is exactly what `InterferencePair {instA, instB, volume}` already carries.

That is the smallest thing that makes ASSEMBLY real rather than decorative: it produces a
scorable multi-body artefact, it exercises the solver that already exists, and it cannot make
a long tree fail.

### PMI / GD&T

**1. What is ALREADY BUILT and merely unreachable.**

- `native/gdt/Gdt.cpp` (38 KB) — **compiled and linked** (`CMakeLists.txt:1592`), 22 public
  functions covering DRF construction, true position with MMC/LMC bonus, flatness, orientation,
  circularity, cylindricity, profile, and FCF legality. **2 of 22 reach JS**
  (`gdtTruePosition`, `gdtFlatness`, `binding.cpp:17194,17238`). Twenty compiled, tested-by-hand
  functions are reachable by nothing.
- `native/gdt/FcfEvaluator.cpp` (849 lines) — the B-rep bridge, the piece that turns the point-set
  math into a real GD&T verifier on a built solid. **Not in CMakeLists. No call site. No test —
  the gate its own header names does not exist.** It has never been compiled, so it has never
  been wrong. This one is not "unreachable", it is *unbuilt*, and it should be treated as
  unverified code until it compiles and its named gate is written.
- `test/native/gdt/gdt_test.cpp` and `fcf_validate_test.cpp` (1,161 lines of known-answer
  tests) are invoked by nothing — their headers give a hand `c++ … -o /tmp/gdt_test` command
  line. Neither CMake nor CI builds them.
- `frontend/src/forge-v4/ap242Export.js` — a real semantic AP242 PMI writer, e2e-tested,
  reachable only from the JS app.

**2. What new IR value kind does this family require?**

**None.** This is the most useful thing in this section. Datums and feature control frames are
*annotations on a solid*, and the IR already has the exact mechanism: `TAG` binds a persistent
name and returns `%body` unchanged, with the header stating why — "a naming mechanism that can
alter the solid is a defect generator" (`FeatureTree.hpp:131-134`). `DATUM` and `FCF` are the
same shape. They need a place to *live* in the emitted STEP, not a place to live in the value
system.

PMI is therefore blocked on nothing structural. It is the only family in this census that is
blocked purely on ops.

**3. What is genuinely absent, and how long?**

- **Ops.** `DATUM(%body,"A","sel")` and `FCF(%body, CHAR, tol [, MMC] [,"A","B","C"], "sel")`,
  both pass-through, both reusing `resolveSelector` and the `TAG` precedent. **Days.**
- **A carrier in the C++ export.** Today `exportStepWithPmi` writes STEP *comments*
  (`IoExchange.cpp:487-530`), which no AP242 consumer reads. Porting the semantic entity chain
  from `ap242Export.js` into C++ is **1–2 weeks**.
- **Compiling `FcfEvaluator.cpp` and writing the gate it names.** **Days** to compile,
  **1–2 weeks** to earn trust — 849 lines that have never been through a compiler will not be
  clean, and the whole point of the exercise is a *verified* number.
- **Exposing the other 20 `Gdt.hpp` functions and building the two orphaned test files.**
  **Days.**

Absent and *not worth building on this evidence*: a GD&T authoring UI in `forge::ui`, a
`gdt` panel with content, PMI import from a ground-truth STEP. Nothing scores any of it.

**4. What would a MINIMAL honest version look like?**

```
%20 = DATUM(%body, "A", "face:normal=+Z,extreme")           -> SOLID (pass-through)
%21 = FCF(%20, POSITION, 0.1, MMC, "A", "B", "@bore1")      -> SOLID (pass-through)
```

Two pass-through ops, no new value kind, no new solver, no risk of refusing a long tree
(a pass-through op cannot fail the geometry), and they make the AP242 export carry real PMI
instead of comments. Everything else — the geometric evaluator, the panels, the authoring
UI — should wait for a benchmark that scores it.

**The honest recommendation for this family: build the two ops and the semantic export carrier
because they are cheap and they unblock the AP242 story, and stop there.** Zero benchmarks
score PMI. Compiling `FcfEvaluator.cpp` is worth doing for a different reason — 849 lines of
never-compiled code in the tree is a liability regardless of whether anyone scores it — but it
should be justified as debt repayment, not as capability.

---

## Appendix — the emission histogram is the most actionable artefact here

Restating it because it cuts across every family census, not just mine: over 600 emissions the
model used **12 distinct ops**. The kernel has 40. The app allows 18. The model reaches 12, and
2 of those 12 (`CYL`, `ROTATE`) are ops the app forbids. Adding ops to the kernel, or unlocking
the 22 forbidden ones, changes nothing on its own — the training distribution is the binding
constraint on which ops get used, and it is narrower than either the kernel or the vocabulary.

Reproduce with:

```
python3 -c "$(cat <<'EOF'
import json,re,collections
p='<archdisc-Models>/runs/composite_anchor/axis_named_v7_e600/emissions.jsonl'
ops=collections.Counter(); rows=collections.Counter()
for line in open(p):
    d=json.loads(line); found=set()
    for m in re.finditer(r'%\s*\d+\s*=\s*([A-Z][A-Z0-9_]*)\s*\(', d['ir']):
        ops[m.group(1)]+=1; found.add(m.group(1))
    for f in found: rows[f]+=1
for k,v in ops.most_common(): print(f'{k:<12}{v:>7}  in {rows[k]:>4} rows')
EOF
)"
```
