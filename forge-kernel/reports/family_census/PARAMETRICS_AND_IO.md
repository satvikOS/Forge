# Family census — PARAMETRICS / FEATURE-TREE SEMANTICS, and IMPORT / EXPORT

**Measured 2026-08-31 against `a457bea2` (`origin/claude/sacrosanct-execution-20260828`).**
Read-only census. Nothing under `forge-kernel/src`, `forge-kernel/include`, `ui/`,
`forge-desktop/` or `frontend/` was modified. No build was run: every claim below is sourced
from a file:line in this tree, from a checked-in gate baseline, or from a checked-in
measurement record, and each is labelled with which.

## What I VERIFIED vs what I could NOT

**VERIFIED** by reading a named implementation with a body and following it to a call site:
the 40-op IR table and its three value kinds; the 22 forbidden ops and the single reason
carried for each; the `TAG` / `@name` persistent-naming mechanism and its witness check; the
whole face-selector predicate vocabulary; `INPUT` / `PUSHFACE` / `RESIZEBORE` / `DEFEATURE` /
`VERIFY` / `HEAL`; the `forge::io` import/export surface and every stub in it; the native
`MeshExchange` OBJ/OFF/PLY codecs and the fact that nothing exposes them; the desktop app's
document model, its one parametric edit command, and its full-recompile rebuild edge; the
JavaScript parametric stack (feature tree, rebuild engine, configurations, design tables,
persistent topo ids, equation store) and, for each piece, whether a production caller exists.

**NOT verified**, stated as such where it appears: I did not compile or run the s0 acceptance
suite, the L4 `TAG` gate, or any kernel test — I cite the checked-in ratchet baseline and the
checked-in test source instead, and say so at each point. I did not re-run the 600-row
emission census; I cite `DECISIONS.md` D-035, which was recorded today. I did not verify
formats for the seven post-CADGenBench benchmarks: **no format contract for them exists in
this repository**, and I refuse to guess one.

---

# FAMILY 1 — PARAMETRICS / FEATURE-TREE SEMANTICS

## 1.1 The cheapest capability in the project: seven ops already built, already tested, unreachable

Of the 22 forbidden ops (`ui/include/forge/ui/ArchieOpVocabulary.hpp:177`), twelve solid
primitives and two wire ops belong to other agents' censuses. **Seven belong to this one, and
they are the entire edit half of the Unified IR.** Every one has a real implementation with a
body, is dispatched by the compiler's op switch, and is exercised by a checked-in test. Not
one is reachable by a user, for one stated reason: *"no command in the forge::ui registry
emits it, so no user can produce it."*

| op / capability | exists in kernel? (file:line) | reachable from IR? | user-invocable? | value kinds needed | what it would take | benchmark that scores it |
|---|---|---|---|---|---|---|
| `TAG(%body,"@name","sel")` — persistent feature name | **YES** `src/ft/FeatureTreeCompiler.cpp:1747` (impl), `:1406-1470` (`@name` resolution + witness check); declared `include/forge/ft/FeatureTree.hpp:131` | YES — compiler dispatch `:666` | **NO** — forbidden, `ArchieOpVocabulary.hpp:194` | SOLID (pass-through) | one `part.tag_feature` command; a UI affordance to name a picked face | CADGenBench **editing** (32 of 81 samples): any multi-step edit whose second step must re-find the first step's face |
| `VERIFY(%body,"expr",…)` — in-IR do-no-harm gate | **YES** `FeatureTreeCompiler.cpp:1944`; vocabulary = faces/edges/volume/holes/bores/radial/blades/lugs/spokes/genus/shells/`bbox.{x,y,z}{,min,max}`/`±X±Y±Z` | YES — dispatch `:671`; results surface as `CompileResult::verify` (`FeatureTree.hpp:285`) and through the N-API at `src/ft/binding_ft.cpp:78-82` | **NO** — forbidden, `ArchieOpVocabulary.hpp:210` | SOLID (pass-through) | one `part.verify` command, or an assertion row in the feature tree | **Every** benchmark's validity gate. D-035 measured `VERIFY` at **533 uses across 600 emissions**, and **41.3% of all failures** are a failed `VERIFY` assertion — the single largest failure class |
| `INPUT()` — bind the task's input solid | **YES** `FeatureTreeCompiler.cpp:1780`; sniffs CONTENT not extension, accepts STEP / BREP / ASCII+binary STL, then `unifyFaces` | YES — dispatch `:667`; the input path arrives via `forge.ft.compile(ir,{input})` (`binding_ft.cpp:50-57`) or `forge_verify`'s `inputStep` field (`src/tools/forge_verify.cpp:384`) | **NO** — forbidden, `ArchieOpVocabulary.hpp:186`. Worse: the desktop app calls `forge::ft::compile(tree)` with **no input path at all** (`forge-desktop/src/KernelScene.cpp:107`), so `INPUT()` is not merely unexposed, it is unreachable through the app by construction | SOLID | a `file.import` command **plus** threading an input path through `KernelScene::buildFromIr` | **Every editing task in every edit benchmark.** An edit tree that cannot name its input cannot start |
| `RESIZEBORE(%body,"sel",r)` | **YES** `FeatureTreeCompiler.cpp:1860`; refuses an ambiguous selector, refuses a non-cylindrical face, refuses a convex boss | YES — dispatch `:669` | **NO** — `ArchieOpVocabulary.hpp:202` | SOLID | one `part.resize_bore` command driven by a face pick | `archie_edit_214` is *literally* this op |
| `PUSHFACE(%body,"sel",d)` | **YES** `FeatureTreeCompiler.cpp:1837` → `forge::pushPullFace` | YES — dispatch `:668` | **NO** — `ArchieOpVocabulary.hpp:198` | SOLID | one `part.push_face` command | Direct-edit tasks; "move this face to z=40" |
| `DEFEATURE(%body,"sel",…)` | **YES** `FeatureTreeCompiler.cpp:1902`; unions every selector into ONE healing pass, and refuses a removal that leaves volume unchanged | YES — dispatch `:670` | **NO** — `ArchieOpVocabulary.hpp:180` | SOLID | one `part.delete_feature` command | "remove the four small holes" edit tasks |
| `HEAL(%body)` | **YES** `FeatureTreeCompiler.cpp:1322` → `forge::heal::simplifyShape` | YES — dispatch `:664` | **NO** — `ArchieOpVocabulary.hpp:182` | SOLID | one `part.heal` command | Validity gate on every benchmark — a failed validity check zeroes the rest (`CADGENBENCH_SPEC.md:76`) |

Two ops adjacent to this family and in no other agent's list: **`FOLD`** (sheet-metal flange
macro, `FeatureTree.hpp:122`, forbidden at `ArchieOpVocabulary.hpp:188`) and the `RESULT`
terminator, which the emission policy also forbids — `archie_op_vocabulary.json`,
`emission_policy.rules[0]`: *"including … the RESULT terminal, which no forge::ui command can
produce."*

### The refusal path is a capability gate wearing a safety hat, and it is not armed yet

`forge::ui::OpConstraintBridge` is the designated pre-emission check. Handed any statement
using an op from the table above it returns `ForbiddenOp` (`ui/src/OpConstraintBridge.cpp:386`),
and — this is the part that matters for long trees — a refused statement records value kind
`None`, so **every downstream `%N` that referenced it also fails, on the kind**
(`ui/src/OpConstraintBridge.cpp:553-558`). One `INPUT()` at the top of an edit tree therefore
poisons the entire tree beneath it. That is precisely the failure mode the owner named: it
fires hardest on the longest, densest emissions.

**Measured mitigant, stated so nobody over-corrects:** the bridge currently has **zero
production callers**. The only reference outside its own header and source in the whole repo
is `ui/test/op_constraint_bridge_test.cpp:209`. The gate is latent, not active — the kernel
compiler happily builds all 40 ops today. D-035 §5 puts it in the repo's own words: *"A gate's
verdict is not the kernel's verdict."* The risk is that wiring the bridge as written would
turn a 41.5%-ok emission set into a 0%-ok one.

## 1.2 The rest of the parametrics surface, capability by capability

| op / capability | exists in kernel? (file:line) | reachable from IR? | user-invocable? | value kinds needed | what it would take | benchmark that scores it |
|---|---|---|---|---|---|---|
| **Named parameters** (`thk = 4`) | **NO — not in the C++ IR.** A token is `Number \| Ref \| Keyword \| Points \| Str` (`FeatureTree.hpp:164`); the parser turns any unparseable bare token into an upper-cased Keyword (`FeatureTreeCompiler.cpp:544-545`), and `%plate = BOX(...)` is rejected outright as `"bad %id on left side"` (`:431`) — deliberately, so a named binding cannot be silently swallowed. **YES in the JS app**, disjoint: `frontend/src/foundation/EquationStore.js` (526 lines; dependency graph, topological cascade, cycle rejection, localStorage persistence) | **NO** | JS only: `frontend/src/forge-v4/EquationManager.jsx`, menu id `tools.equations` (`frontend/src/forge-v4/Menus.jsx:115`), and sketch dimensions accept `=expr` (`frontend/src/kernel/sketch/InteractiveSketch.js:434`) | needs a new IR *concept*, not a new value kind: a symbol table + a `PARAM` statement | a `PARAM name = <expr>` statement and a Number token that may be a symbol reference: **~1 week** including the emitter and the census reconciliation | Not scored directly — but it is the whole thesis. `derived-placement-is-the-unlearnable-subtask`: 40.4% of train / 48.2% of held-out `TRANSLATE` args are exact arithmetic the model must currently do in its head |
| **Expressions** (`w*0.6`) | **NO in C++**: the only numeric parse is `std::strtod` (`FeatureTreeCompiler.cpp:108`). **YES in JS**: `frontend/src/foundation/ExpressionEvaluator.js`, with `collectVariableReferences` for dependency extraction | NO | JS only, as above. Note `frontend/src/foundation/ParamValueResolver.js` — the bridge from `=expr` into a tool dialog — has **no production caller** (only its own file); the wired path is the sketch-dimension one | none new | same work item as named parameters | same |
| **Driving vs driven (reference) dimensions** | **NO — absent everywhere.** A repo-wide grep for `driven` / `isDriven` / `reference dimension` returns only unrelated prose. The JS sketch solver does compute DOF (`frontend/src/kernel/sketch/SketchSolver.js:473-500`, `signedDOF()`), which is the prerequisite, but nothing consumes it to mark a dimension driven | NO | NO | none new | days on the JS solver (DOF already computed); the IR has no dimension objects at all, so this is meaningless there until sketches become IR values | Drawing/2D benchmarks; nothing currently readable in this repo |
| **Feature suppression** | **Split, and the split is the finding.** *IR:* **NO** — `forge::ft::Op` is `{id, code, name, args, poly, srcLine}` (`FeatureTree.hpp:178-186`), with no suppression field; the s0 acceptance suite asserts the gap explicitly and it FAILS (`forge-kernel/test/ft/s0_acceptance_test.cpp:420`, `carriesSuppression`). *C++ UI:* a **display state only** — `FeatureState::Suppressed` (`ui/include/forge/ui/FeatureTreeModel.hpp:37`), with no setter and no document behind it. *JS:* **real** — `frontend/src/kernel/forge/FeatureTree.js:86` `suppress(id,on)`, honoured by `*buildOrder()` at `:128` | NO | **NO** — the JS `FeatureTree` is imported by exactly one module, `frontend/src/kernel/forge/ForgeProject.js:17`, which itself has **no production consumer** (the only other mention in the repo is a comment at `frontend/src/kernel/forge/drawings/BomRollup.js:16`). `frontend/src/config/menuConfig.js:72-73` offers "Suppress Feature" / "Unsuppress Feature" menu items | none new | a `suppressed` flag on `Op` + a compiler skip + a UI toggle: **days** in the kernel — but the parse/compile census (`Census::declared == parsed`, `FeatureTree.hpp:211`; `nCompiled`, `:279-281`) must be taught that a suppressed op is parsed-but-not-compiled, or every suppressed build hard-fails as a dropped statement | CADGenBench editing ("remove / disable this feature"); configurations depend on it |
| **Feature reorder** | *IR:* **NO** — evaluation order *is* creation order and `%N` must refer to a strictly earlier id (`FeatureTree.hpp:34`, enforced at `ui/src/FeatureIr.cpp:178-182` and in the parser). Reorder therefore means renumbering, which rewrites every reference. *JS:* **real, with a dependency guard** — `frontend/src/kernel/forge/FeatureTree.js:64`, refuses a move that would put a node before its `dependsOn` | NO | NO — same dead end as suppression | none new | topological renumber + reference rewrite: **~1-2 weeks** to do safely, because `TAG` names and face selectors resolve against the *live* inventory at each step, so reordering can silently change what a selector resolves to | CADGenBench editing; no benchmark in this repo isolates it |
| **Rollback bar** | *IR:* **NO**. *JS:* **real** — `frontend/src/kernel/forge/FeatureTree.js:102` `rollbackTo(id)` + `isRolledBack` + `appliedList`, honoured by `buildOrder()`. A **second, weaker** JS implementation exists and is honest about itself: `frontend/src/foundation/DesignHistory.js:250` `rollBackToHere()` returns `{ok, suppressedCount, gap:'no-feature-rollback'}` — it marks later entries suppressed and says in its own return value that it is not a real rollback | NO | NO | none new | trivial once suppression exists: rollback is "suppress everything after N" | none directly |
| **Configurations / design tables** | *IR:* **NO**. *JS:* **class-complete but unusable** — `frontend/src/kernel/forge/Configurations.js`: `Configuration` (`:18`), `ConfigurationSet` (`:48`), `resolveParams` (`:93`), `resolveSuppressed` (`:99`), `DesignTable.fromRows`/`fromCsv` (`:138`). **The integration point does not exist**: the file's own header (`:11-12`) says the feature-tree integration "goes in `frontend/src/kernel/forge/FeatureTree.js` … which adds a `cloneFor(config)` method". A repo-wide grep for `cloneFor` returns **only that comment**. A configuration can be built, serialised and deserialised; it can never be applied to a feature tree | NO | NO | none new | `cloneFor(config)` in JS is a day. In the IR it is the compiler taking a parameter-override map, which presupposes named parameters | Family-parts / variant tasks; nothing in this repo |
| **★ Persistent topological naming** | **YES, and it is the strongest thing in this family.** `TAG` binds `@name` to a `FaceSig` (kind, concavity, axis-or-centroid position, direction, radius); resolution re-finds the nearest signature (`FeatureTreeCompiler.cpp:1406-1470`) with **three** refusals a naive nearest-match would not have: (a) a position tolerance of `max(1, 2·r)` so a deleted feature's name cannot silently retarget to a neighbour (`:1435-1441`); (b) an ambiguity refusal when two faces tie (`:1443-1447`); (c) **Law 6** — an optional witness predicate `@name\|bore:max` whose independent resolution must include the same face, or the compile fails with "the name has retargeted" (`:1450-1459`) | YES | **NO** — `TAG` forbidden | SOLID | one UI command | The whole edit half. Checked-in gate: `forge-kernel/test/ft/ft_unified_edit.mjs:226-276` — four L4 cases including "a name survives an edit that permutes face indices" (which asserts the exact expected volume, so a retarget cannot pass) and "a name whose feature was DELETED must not retarget". *I read these tests; I did not run them.* |
| **Persistent naming, mechanism #2 (lineage)** | **Built, unwired, and disconnected from #1.** C++: `forge::LineageRegistry` (`include/forge/LineageRegistry.hpp`) with survivor/split/merge/birth/death entries. It is populated at **exactly one call site in the entire kernel** — `src/Booleans.cpp:272`, in the OCCT `BRepAlgoAPI` branch only, and only for operand A. It is read only by the N-API shim `forge.lineageFor` (`src/binding.cpp:6274`). JS: `ForgeTopoIdRegistry` (`frontend/src/kernel/forge/PersistentTopoIds.js:51`) — **zero production consumers**; every reference outside the file is a `__tests__` file. `frontend/src/kernel/forge/LineageEmitter.js:1-12` states in its own header that the C++ producer "would need the forge-kernel.node CI build to round-trip … until that pipeline lands", so it re-derives lineage in JS by centroid/area/normal matching instead | NO — the IR's `TAG` does not consult it | NO | none new | wiring lineage through `FILLET`, `HOLE`, `SHELL`, `EXTRUDE` and the *native* boolean path, then teaching `TAG` to prefer lineage over signature re-matching: **weeks**, and it is the correct long-term answer | Nothing scores it today; it is what makes `TAG` robust on parts where two features share a signature |
| **Pattern occurrence addressing** (`hole_pattern.instance[4]`) | **NO.** `PATTERN` produces ONE fused solid handle; the instances are unrecoverable after the call. Recorded as failing s0 checks with the reason spelled out: `s0_acceptance_test.cpp:389` (18 intended occurrences, 0 addressable) and `:466` (no stable child IDs). The only repeated-feature selector is the *geometric* `radial:k` / `radial:all` (`FeatureTreeCompiler.cpp:1512-1607`), which recovers a fold count by angular clustering — a volatile ordering, not an identity. The selector **string** `"%3.instance[4]"` does survive tokenisation (`:449`), so the grammar could carry it | NO | NO | needs `Op` to carry an occurrence table | per-instance handles out of `circularPattern` + an occurrence table on `Op`: **weeks** | Bolt-pattern edits ("remove the two holes on the left") — a common CADGenBench editing shape |
| **Incremental / dirty-propagation rebuild** | *C++:* **NO.** Every parameter edit recompiles the **entire** program from scratch: `ForgeFrame::syncSceneToDocument` compares the whole IR text and calls `scene_.buildFromIr(program)` (`forge-desktop/src/ForgeFrame.cpp:298-305`), which runs `forge::ft::parse` + `forge::ft::compile` over all of it (`forge-desktop/src/KernelScene.cpp:76,107`). No cache, no memo, no dirty set anywhere in `FeatureTreeCompiler.cpp`. *JS:* **real and well-built** — `frontend/src/kernel/forge/RebuildEngine.js`: FNV-1a input hashing that mixes params with upstream `outputHandle`s, downstream dirty propagation, cache-hit stats. Same dead end: its only consumer is the unconsumed `ForgeProject` | NO | NO | none new | port `RebuildEngine`'s hash-and-skip into the C++ compiler: **~1 week**, gated on the compiler being able to hold prior handles across calls | Not scored — but this is the cost model for "ultra long feature trees". A 400-op tree recompiles 400 ops to change one radius |
| **Sketch as a first-class value** | The kernel **has** a real constraint sketcher — `forge::Sketcher` over vendored planegcs (`include/forge/Sketcher.hpp`), included by the IR compiler (`FeatureTreeCompiler.cpp:36`), and a `PROFILE` value **is** a `SketchHandle`. What is missing is any way to *express a constraint*: the IR's profile ops (`RECT`, `CIRCLE`, `SLOT`, `POLY`, `REGPOLY`, `RRECT`) are fully-dimensioned literals. `forge::ui::EntityKind` does carry `Sketch` and `SketchCurve` (`ui/include/forge/ui/Types.hpp:27-28`), but `IrValueKind` is only `{None, Profile, Wire, Solid}` (`ui/include/forge/ui/PartCommands.hpp:54`) | partially | NO | **★ needs a SKETCH value kind** — see Q2 | out of scope for this census; flagged for whoever owns the value-kind work | Drawing→CAD benchmarks |

**Checked-in conformance record, not re-run by me:**
`forge-kernel/test/ft/s0_conformance_baseline.txt` sets `S0_EXPECTED_FAILURES=5` — the s0
acceptance suite deliberately asserts laws the implementation does not satisfy, CI ratchets on
the count rather than the exit code, and three of those five failures are in this family
(pattern occurrence count, pattern suppression map, stable child IDs).

## 1.3 The `archie_edit_214` loop, measured end to end

The task: *"shrink the diameter of the largest bore by 5 mm"* against a 430-face part
(confirmed in this tree: `data/cadgenbench_edit_out/_inv_cache/inv_214.json` reports
`faceCount: 430`, `edgeCount: 1012`, `volume: 1849946.16`).

| stage | state | evidence |
|---|---|---|
| **SELECT by semantic predicate** | **BUILT.** `"bore:max"` *is* "the largest bore": the selector gathers concave cylinders, sorts by radius, takes the largest. The predicate vocabulary is genuinely broad — axis-extreme planes `+Z` / `-X`; `plane:max-area`; `face:N`; `radial\|blade\|lug\|spoke[:k\|:all]` with membership by nearest group centre rather than angular sector (the comment records that sector membership removed 3 blades when asked for 2); the `bore` / `hole` / `boss` / `shaft` / `fillet` / `blend` families; a position filter `at=x,y` that *composes* with a radius filter; `r=` exact (accepting a diameter-shaped value too) and `r<=` bound; and rank forms `max` / `min` / `largest:N` / `smallest:N` / `all` | `FeatureTreeCompiler.cpp:1393` (entry), `:1480-1511` (axis / area / index), `:1512-1607` (radial), `:1610-1737` (bores / bosses / fillets) |
| **MODIFY** | **BUILT.** `RESIZEBORE(%body,"bore:max", r)` sets the radius exactly and refuses rather than guessing when the selector is ambiguous — the comment records that taking `idx[0]` silently resized 1 of 4 identical bolt holes while every assertion still passed | `FeatureTreeCompiler.cpp:1860`, refusal at `:1868-1876` |
| **REBUILD** | **BUILT.** `INPUT()` imports the STEP, unifies faces so "the bore" is one face, and the same walker executes the edit ops | `FeatureTreeCompiler.cpp:1780-1834` |
| **VERIFY** | **BUILT.** A failed assertion is `ok=false`, never a warning. The hole count is keyed on the **axis line** (canonical direction + foot), so a wall split at a seam or a cross-drilled port counts the way `forge_verify` counts it | `FeatureTreeCompiler.cpp:1944`, hole keying `:1975-2040` |
| **SCORE** | **BUILT, native.** `src/tools/forge_verify.cpp` — JSON-per-line protocol taking `ir`, `inputStep`, `outStep`, `refStep`; emits the full 430-face census in the ground-truth schema and a voxel IoU against the reference STEP | `forge_verify.cpp:384-386` (protocol), `:575-624` (census), `:634-650` (IoU) |
| **REACH IT FROM THE APP** | **ABSENT.** Four of the five ops in that loop (`INPUT`, `TAG`, `RESIZEBORE`, `VERIFY`) are forbidden; and even if they were allowed, `KernelScene::buildFromIr` has no parameter for an input STEP, so `INPUT()` could not resolve | `ArchieOpVocabulary.hpp:177-217`; `KernelScene.cpp:107` |

**The honest summary: the select-modify-rebuild-verify loop exists and is good.** The edit
benchmarks are not blocked on it — they run through `forge.ft.compile` / `forge_verify`, which
carry the full 40-op vocabulary. What is blocked is the *app*, and therefore any claim that a
user could have produced these trees.

**The freshest measurement in the repo agrees.** `implementation/sacrosanct/DECISIONS.md`
D-035 (recorded 2026-08-31, retracting D-034 from the same morning): across 600 holdout
emissions scored by the pinned verifier, `ok=true` 249 (41.5%), a solid produced 485 (80.8%),
**true out-of-vocabulary ops 6 (1.0%)** — and **95.6% of "illegal" op uses (1890 of 1978) are
ops the kernel implements**, forbidden only by the UI-registry rule. The largest single failure
class is a failed `VERIFY` at **41.3%** — the model asserting a property its own output does
not satisfy. That is a self-consistency training signal, and it exists *because* `VERIFY`
works.

## 1.4 One concrete defect in this family, already recorded

`edit.delete` declares `featureIrOp = "DELETE"` (`ui/src/ForgeShell.cpp:154`) and its `execute`
body only increments counters — `deletedCount`, `undoDepth` — and never touches the document
(`:160-165`). `DELETE` is not among the kernel's 40 ops. This is **already recorded** in
`implementation/sacrosanct/archie_op_vocabulary.json` under `derived_defects`, as two entries:
`declares_an_op_it_never_emits` and `declares_an_op_the_kernel_does_not_have`. I cite it rather
than claim it. Its consequence for this family: the app's only "delete" affordance is inert,
which is why `DEFEATURE` matters more than its position in the forbidden list suggests.

## 1.5 What the app's document model actually supports

`forge::ui::PartDocument` (`ui/include/forge/ui/PartCommands.hpp:87`) is **append + in-place
parameter edit, and nothing else**:

* `appendFeature` refuses any statement not numbered `nextIrId()` (`:107`).
* `editFeatureArgs` (`:141`) is deliberately narrow, and the narrowness is the safety property:
  the statement's **id** is pinned (renumbering would change what every later `%N` means), its
  **op** is pinned (a different op is a different feature with a different produces-kind), and
  every **`%ref` is pinned by position** (moving a ref is a reparent, not a parameter edit).
  Only numbers, keywords and quoted selectors may change, within the op's documented arity.
* `Snapshot` is a record **count** plus the binding table (`:145-152`), so `restore()` can only
  truncate. There is no delete, no suppress, no reorder, no rollback.
* One command drives it — `part.edit_feature` (`ui/src/PartCommands.cpp:1088`) — and it is the
  21st of 21 Part commands (`:1135-1151`) and the one that emits no IR op, which is why the
  vocabulary counts 31 registry commands but only 20 that emit IR.

This is the closest thing in the C++ app to a driving dimension, and it is a real one: a fillet
can go from r3 to r6 without undoing everything after it. It is also the ceiling.

---

# FAMILY 2 — IMPORT / EXPORT

## 2.1 Format census

`forge::io` (`forge-kernel/include/forge/IoExchange.hpp`) is the whole exchange surface.
"Reachable from IR" means an IR statement can cause it. "User-invocable" is measured against
the `forge::ui` registry (the C++ app) **and** noted separately for the JS/Electron app,
because they are different surfaces with different answers.

| format | read | write | exists in kernel? (file:line) | reachable from IR? | user-invocable? | what it would take | benchmark that scores it |
|---|---|---|---|---|---|---|---|
| **STEP** (AP203/214/242) | **YES** | **YES** | `src/IoExchange.cpp:77` (read) / `:142` (write). The native build reads in three stages: `StepAnalytic` for Forge's own analytic dialect → `readForeignStep` for the full trimmed-NURBS zoo, accepted **only** when complete + watertight + no unsupported entity → honest fall-through to the TKDESTEP-free `foreignStepToOcct` | **YES** — read via `INPUT()`, write via `compileText(..., exportStepPath)` (`FeatureTree.hpp:304`) | **C++ app: NO** (no `file.import`; `file.open` reads only `.fpart`). **JS app: YES** — `io.import` verb (`frontend/src/ai/ForgeToolBridge.js:2783`), `ForgeIo.importStep` / `exportStep` (`frontend/src/kernel/forge/Io.js:23,27`) | a `file.import` / `file.export` pair in `forge::ui`, plus an input path on `KernelScene::buildFromIr` | **Everything.** CADGenBench editing ships `input.step` (`CADGENBENCH_SPEC.md:98-101`); submissions accept `output.step` / `.stp` (`:116`); `forge_verify`'s `refStep` → voxel IoU is a STEP read (`forge_verify.cpp:638`) |
| **BREP** (OCCT binary) | YES | YES | `IoExchange.cpp:249` / `:258` | **YES** — `INPUT()` content-sniffs `DBRep_DrawableShape` / `CASCADE Topology` (`FeatureTreeCompiler.cpp:1795`) | C++ app: NO. JS app: YES (`Io.js:30,34`; `io.import` format `brep`) | as STEP | Accepted as a CADGenBench submission format ("preferably STEP/BREP", `CADGENBENCH_SPEC.md:121`) |
| **STL** | YES | YES | `IoExchange.cpp:266` / `:348`. The native build uses the in-house ASCII codec `MeshExchange::readSTL` / `writeSTL`; **read fails loudly without `FORGE_NATIVE_BREP`** (`:342-345`), and so does write (`:386`) | **YES (read)** — `INPUT()` sniffs both ASCII and binary STL (`FeatureTreeCompiler.cpp:1800-1813`). **NO (write)** — the IR's only export is STEP | C++ app: NO. JS app: YES (`Io.js:37,42`) | expose an STL export path on `compileText`, or a `file.export` command | CADGenBench accepts `output.stl` (`:117`) — not required, STEP suffices |
| **IGES** | **YES** | **NO — honest refusal** | read `IoExchange.cpp:396` (native-only; the OCCT `IGESControl_Reader` path is retired); write `:428` **throws**, with an accurate reason: OCCT 7.9's TKDEIGES ships a reader and no writer package, and no from-scratch IGES 5.3 S/G/D/P/T writer exists here | NO — `INPUT()` does not sniff IGES | C++ app: NO. JS app: YES for read (`Io.js:48`, `io.import` format `iges`) | an IGES 5.3 writer is **months**; adding IGES to `INPUT()`'s sniffer is an hour | Nothing in this repo requires IGES |
| **JT** (Siemens) | **NO — stub that throws** | NO | `IoExchange.cpp:455` | NO | The JS bridge exposes it; it always throws (`Io.js:52-56`) | requires the proprietary Siemens JT Open Toolkit — **not a schedule question, a licensing one** | none |
| **Parasolid** (.x_t / .x_b) | **NO — stub that throws** | NO | `IoExchange.cpp:467`; sniffs the magic (`**` / `0x83`) to give a specific error | NO | The JS bridge exposes it; always throws | requires Siemens' Parasolid kernel — licensing, not schedule | none |
| **DXF** | NO | **YES, but only for a flat sheet-metal pattern** | `include/forge/SheetMetalExtended.hpp:119` / `src/SheetMetalExtended.cpp:570` — a real SECTION/HEADER writer; N-API `forge.sheetextend.exportDxf` (`src/binding.cpp:16321`) | NO | C++ app: NO. JS: via the `sheetextend` namespace | a general 2D drawing→DXF writer is weeks and belongs to the drawings family, not here | Drawing benchmarks (none readable in this repo) |
| **OBJ** | **YES** | **YES** | `MeshExchange::readOBJ` `src/native/brep/MeshExchange.cpp:441` / `writeOBJ` `:391` — real codecs, round-trip-exact coordinates via `to_chars` / `from_chars`, honest `ok=false` on malformed input | **NO** | **NO — and nothing exposes them at all.** `forge::io` has no OBJ entry point, and `binding.cpp` contains **zero** occurrences of `OBJ` or `MeshExchange` | ~20 lines: `forge::io::importObj` / `exportObj` wrapping the existing codec + tessellation, then a binding entry. **Hours, not days** | CADGenBench accepts `output.obj` (`CADGENBENCH_SPEC.md:117`) |
| **OFF** | **YES** | **YES** | `MeshExchange::readOFF` `:538` / `writeOFF` `:495` | NO | NO — unexposed, same as OBJ | same, hours | CADGenBench accepts `output.off` |
| **PLY** | **YES** | **YES** | `MeshExchange::readPLY` `:639` / `writePLY` `:605` | NO | NO — unexposed, same as OBJ | same, hours | CADGenBench accepts `output.ply` |
| **3MF** | **NO** | **NO** | no implementation anywhere in `forge-kernel` | NO | NO | a zip container + XML mesh writer: days | CADGenBench accepts `output.3mf` — optional |
| **glTF / GLB** | NO | **YES** | `include/forge/GltfExport.hpp:51` `writeGlb` + a streaming variant; wired at `src/binding.cpp:7251` as `forge.gltf.exportGlb` | NO | JS: YES via the binding | — | none (viewer format) |
| **STEP AP242 + PMI** | n/a | **YES, as a comment block** | `IoExchange.cpp:487` — writes the AP242 file, then appends an `/* PMI_FCF: … */` ISO-10303-21 comment. The header is explicit that this is a stub "until full representation_item / dimensional_size entity emission lands" | NO | JS: YES (`ForgeToolBridge.js:758`) | real PMI entity emission: weeks | MBD/PMI tasks; nothing in this repo |
| **.fpart** (the app's own document) | YES | YES | `forge-desktop/src/PartFile.hpp` — line-oriented, versioned, storing each record **structurally** (`ARG <kind> <value>`) and *deriving* the IR text via `IrLine::text()`, deliberately not storing the IR text because that would be lossy (labels, bindings) and would need a second parser | n/a | **YES** — `file.open` / `file.save` | — | none |

**One documentation inconsistency worth fixing (not a code defect):** `IoExchange.hpp:47` says
`exportIges` "returns false"; the implementation **throws** (`IoExchange.cpp:428`). And that
throw's message ends *"IGES IMPORT is supported (via OCCT)"*, while `importIges`
(`:396-410`) is native-only and states that the OCCT `IGESControl_Reader` "has been RETIRED
from this kernel". A caller reading either string is misled about which path runs.

## 2.2 Which benchmarks need which formats, and is any a hard blocker

**No. Nothing in this family blocks a benchmark today.**

* **CADGenBench** is the only benchmark with a format contract checked into this repo
  (`CADGENBENCH_SPEC.md`). Editing samples ship `input.step` + an `input.mesh.npz` sidecar +
  renders (`:98-101`); generation samples ship drawing PNGs + text, **not** a partial B-rep
  (`:95-97`). Submissions accept `output.step` / `.stp`, or `output.stl` / `.obj` / `.off` /
  `.3mf` / `.ply` (`:116-117`). **Forge reads STEP and writes STEP — both sides are satisfied
  by the one format it already has.** OBJ / OFF / PLY / 3MF are breadth, never a requirement.
* **The seven post-CADGenBench targets** (BenchCAD, neuralCAD-Edit, Drawing2CAD, ParaCAD,
  Text2CAD-Bench, HistCAD, MUSE): **no format contract for any of them exists in this
  repository.** `docs/SCOPE_2026-06-24/research/cadgen_ecosystem_research_2026-06-24.md:80`
  only records that CadBench / BenchCAD / Text2CAD-Bench are distinct arXiv efforts with no
  link to Mecado. I will not invent input formats for them; that census needs the datasets in
  hand and is separate work.

### The one real IMPORT/EXPORT risk, and it is not a missing format

**A reference STEP is not guaranteed to be the solid its gold tree defines.** Measured and
checked in at `implementation/sacrosanct/findings/THE_STEP_ROUNDTRIP_CHANGES_THE_SOLID.md`
(n=120, every 5th holdout row): `valid` True→False **0 of 120** (Wilson upper bound ~3.1%);
genus **changed 4 of 120 (3.3%, CI [1.3%, 8.3%])** — `ho114` 23→21, `ho214` 23→22, `ho924`
18→17, `ho1195` 21→20. **All four LOSE handles; not one gained**, and the drift is confined to
complex solids (genus 0-10: 0 of 68 drifted; genus 20+: 3 of 44). Topology is 0.2 of the
composite and the drift moves every arm identically, so the *comparison* is safe; what is not
safe is any per-row topology claim on a high-genus part.

**This lands on the edit family directly.** `INPUT()` reads a STEP, so an edit tree may start
from a body that has already lost handles relative to its own ground truth — and a
`VERIFY "genus=N"` written against the gold tree can then fail on a *correct* edit.

### The STEP reader is load-bearing for the OCCT drop, and I confirmed it in this tree

`forge-kernel/reports/TKSHHEALING_DROP_PLAN.md` maps 4 of TKShHealing's 17 call-site statements
onto the STEP-read path. **Verified present today** (the plan's line numbers have shifted;
these are current): `src/native/brep/StepReadOcct.cpp:968` `ShapeAnalysis_Curve` (group G),
`:1238` `ShapeAnalysis_Surface` (group F), `:1683` `ShapeFix_Shape` (group A). The plan's
conclusion stands: dropping TKShHealing takes `otool` 8→7 with no compensating additions, and
the **only** operation with "no peer" is the post-transfer `ShapeFix_Shape` pass in the reader.

The plan also records that **there is no regression gate on the native STEP reader**:
`test/golden_corpus_measure.cpp` reads its STEP with OCCT's own `STEPControl_Reader`, so the
golden-corpus verify "never executes one line of `StepReadOcct.cpp`". That is the single
riskiest fact in this family — the reader that every edit benchmark walks through, and that
gates the whole dependency-drop ladder, is covered by one 10×10×10-box smoke test.

---

# The four questions, answered

## Q1. What is ALREADY BUILT and merely unreachable? ★

**Loudly: the entire edit half of the Unified IR.** Seven ops — `TAG`, `VERIFY`, `INPUT`,
`RESIZEBORE`, `PUSHFACE`, `DEFEATURE`, `HEAL` — are implemented, dispatched, and covered by
checked-in tests, and are reachable by **no user**, for one reason: no `forge::ui` command
emits them.

This is not a partial implementation. `TAG` has a signature model, a position tolerance, an
ambiguity refusal and a witness cross-check. `VERIFY` measures twelve distinct properties
including genus and shell count. `RESIZEBORE` refuses to guess on an ambiguous selector.
`DEFEATURE` refuses a removal that did not change the volume. The face-selector language
handles position, radius, rank, and rotational groups with nearest-centre membership. Each of
those refusals has a comment recording the wrong part it was written to prevent.

Alongside them, **three whole parametric subsystems are built in JavaScript and consumed by
nobody**: `FeatureTree` (suppress / reorder / rollback, with a dependency guard),
`RebuildEngine` (hash-based dirty propagation), and `Configurations` + `DesignTable`. All three
are reached only through `ForgeProject`, which has no production consumer. `Configurations`'
integration hook, `cloneFor(config)`, was specified in a comment and **never written**.
`ForgeTopoIdRegistry` is the same story: real code, tests only.

And **three mesh codecs are already written and exposed nowhere**: `MeshExchange`'s OBJ, OFF
and PLY readers and writers. Wrapping them in `forge::io` is the cheapest breadth in this whole
census — hours of work for three of the five mesh formats CADGenBench accepts.

## Q2. What new IR VALUE KIND does this family require?

**Parametrics needs no new value kind. It needs a new statement class and a symbol table.**
Named parameters, expressions, suppression, reorder and rollback are all properties *of
statements*, not new kinds of value. The concrete missing pieces are: a `PARAM` statement; a
Number token that may be a symbol reference; a `suppressed` bit on `Op`; and an occurrence
table on `Op` so `PATTERN` instances become addressable. None of those is a value kind, and
none is blocked on the SURFACE work another agent is doing.

The one genuine value-kind gap in this family sits at its edge, and is flagged for whoever owns
value kinds: **there is no SKETCH kind.** `IrValueKind` is `{None, Profile, Wire, Solid}`
(`ui/include/forge/ui/PartCommands.hpp:54`), and `forge::ft`'s model has PROFILE / WIRE /
SOLID. The kernel *has* a planegcs constraint sketcher (`include/forge/Sketcher.hpp`), and a
PROFILE *is* a `SketchHandle` — but no constraint can be written in the IR, so
driving-vs-driven dimensions are meaningless there. That capability is blocked on the kind, not
on its own ops.

**Import/export needs no new value kind at all**, with one caveat: `importStl` "returns a
shell, not a solid" (`IoExchange.hpp:26`), and the IR has no MESH kind, so a scanned mesh enters
as a SOLID-shaped handle that may not be one.

## Q3. What is genuinely absent, and is it days, weeks or months?

Plainly:

* **Named parameters + expressions in the IR — ~1 week.** The evaluator, dependency graph and
  cycle detection already exist in JS (`ExpressionEvaluator.js`, `EquationStore.js`) and are
  small enough to port. The work is a `PARAM` statement, a symbol-aware Number token, and
  teaching the s0.4 census that a `PARAM` line is declared-but-produces-no-op.
* **Feature suppression in the IR — days.** A bit on `Op` and a compiler skip. The trap is the
  cardinality ledger: `nDeclared == nParsed == nCompiled` is a hard failure by design
  (`FeatureTree.hpp:196-212`, `:279-281`), so a suppressed op must be counted explicitly or
  every suppressed build fails as a dropped statement.
* **Rollback — days**, once suppression exists.
* **Configurations applied to a tree — days in JS**; in the IR it is downstream of named
  parameters.
* **Feature reorder — 1-2 weeks.** Renumbering rewrites every `%N`, and selectors resolve
  against the *live* inventory at each step, so reorder can silently change what a selector
  means. It needs a re-resolution check — which is what `TAG`'s witness mechanism already is.
* **Pattern occurrence addressing — weeks.** `circularPattern` must return per-instance
  handles and `Op` must carry an occurrence table.
* **Incremental rebuild in C++ — ~1 week.** `RebuildEngine`'s design is right and portable; the
  compiler must be able to hold handles across calls.
* **Lineage-based persistent naming (replacing signature re-matching) — weeks.** Lineage must be
  emitted by fillet, hole, shell, extrude and the *native* boolean path, not just the one OCCT
  boolean site.
* **Driving vs driven dimensions — meaningless until sketches are IR values.** Not schedulable
  in this family.
* **OBJ / OFF / PLY exposure — hours.** The codecs are written and tested.
* **3MF — days.** A zip container plus an XML mesh writer.
* **IGES write — months.** A from-scratch IGES 5.3 S/G/D/P/T writer.
* **JT, Parasolid — not a schedule.** Both require proprietary toolkits. The honest answer is
  "convert to STEP", which is exactly what the errors already say.
* **A regression gate on the native STEP reader — days, and it should be done first.** The
  reader is the door every edit benchmark walks through *and* the last blocker on TKShHealing,
  and its only current coverage is a box.

## Q4. What would a MINIMAL honest version look like?

**One command, and one function parameter.**

1. **Add `file.import` to `forge::ui`, and give `KernelScene::buildFromIr` an input-STEP
   parameter.** This is the smallest change that makes the edit family real rather than
   decorative, because `INPUT()` is unreachable *twice over* — forbidden by the vocabulary,
   *and* structurally impossible in the app, since `KernelScene.cpp:107` calls
   `forge::ft::compile(tree)` with no input path. Fixing only the vocabulary would not work,
   and that is exactly the kind of half-fix a census exists to prevent.

2. **Then legalise the six remaining edit ops** by adding their commands: `part.tag_feature`,
   `part.verify`, `part.resize_bore`, `part.push_face`, `part.delete_feature`, `part.heal`.
   Each is a thin wrapper over an implementation that already refuses bad input with a named
   reason. Regenerate `ArchieOpVocabulary.hpp` in the same commit — the `--check` gate in CI
   and in the CMake build will otherwise fail, which is the correct behaviour.

3. **Do not wire `OpConstraintBridge` until step 2 lands.** As written it refuses `INPUT`,
   `VERIFY`, `TAG`, `RESIZEBORE`, `PUSHFACE`, `DEFEATURE` and `HEAL`, *and* the `RESULT`
   terminator, *and* it poisons every downstream `%N` of a refused statement. Against the
   600-row emission set D-035 measured at 41.5% ok, wiring it as-is would produce 0%. It is a
   correct check of a policy whose policy is currently wrong.

That is the whole minimal version for the edit half: **one command and one function parameter,
then six thin commands.** Nothing needs to be invented.

For **parametrics proper**, the minimal honest version is the `PARAM` statement plus a
symbol-aware Number token — nothing else. That single addition makes "shrink the largest bore
by 5 mm" expressible as an *edit to a parameter* rather than a re-emission of a literal, and it
removes the derived-arithmetic burden that `derived-placement-is-the-unlearnable-subtask`
measured at 40-48% of `TRANSLATE` arguments. Suppression, rollback and configurations are all
downstream of it, and none of them is the first thing to build.

For **import/export**, the minimal honest version is smaller still: **wrap the three mesh
codecs that already exist** (`MeshExchange::read`/`writeOBJ`, `OFF`, `PLY`) in `forge::io` and
the N-API binding, and **put a regression gate on the native STEP reader**. The first is hours
and triples the accepted submission formats; the second protects the one file that both the
edit benchmarks and the OCCT drop ladder stand on.
