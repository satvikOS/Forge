# The complete CAD op-family roadmap for Forge

**Synthesis, 2026-08-31.** Ranked by benchmark value over cost, respecting dependencies.

**Pinned at** `161f1cf6c06f3a74de84aac27d84638df9708ed5` (`origin/claude/sacrosanct-execution-20260828`).
The seven family censuses this document synthesises were pinned at `a457bea2`, which is an
ancestor of this tip — **2 commits behind**, verified with `git merge-base --is-ancestor`.
Every op-table, vocabulary and value-kind claim was re-derived at the tip listed above.

**Inputs.** Seven family censuses (PRs #147–#153) and four parallel design tracks. All four
parallel tracks **have landed as branches** and were read in full, not assumed:

| track | branch | artefact |
|---|---|---|
| SURFACE value kind | `origin/ir/surface-value-kind` @ `6e527cfd` | 24 files, +2043 lines |
| Class A/B/C/D | `origin/design/class-a-surfacing` @ `a65213ae` | `reports/CLASS_A_SURFACING_PROGRAMME.md` (549 L) |
| SubD + free-form | `origin/design/subd-freeform` @ `e6cb756c` | `reports/SUBD_AND_FREEFORM_PROGRAMME.md` (461 L) |
| wireframe / BRep / solid | `origin/design/modelling-op-families` @ `8dbcaa0f` | `reports/MODELLING_OP_FAMILIES.md` (500 L) |
| UI cmds for primitives | `origin/app/kernel-primitives` @ `2587c690` | vocabulary 18→28 invocable |

Nothing is missing. Nothing below is guessed from a branch name.

**A grep hit is not a capability.** §7 states, per claim, what I executed, what I read at a
`file:line`, and what I inherited from another agent without re-deriving. Where a cell in the
map is genuinely unknown it says **UNKNOWN**.

---

## 0. The answer in one page

**The owner's thesis — "all CAD op families is how Archie takes first place" — is right about
the product and wrong about the first move, and the evidence points at different families than
the ones the thesis names.**

Three measurements decide it, and I verified all three myself:

1. **The 40 % interface term reads exactly three face-kind predicates.**
   `archdisc-Models/scripts/interface_metrics.py` is 1141 lines and contains
   `kind != "cylinder"` (l.465), `kind != "plane"` (l.587, l.704) and **nothing else** —
   `grep -cniE "torus|bspline|sphere|cone"` over the whole file returns **0**.
   A B-spline face cannot contribute one interface point. Class A, SubD and free-form
   surfacing cannot move 40 % of the score *by construction*, at any fidelity.
2. **Vocabulary is already 96.3 % sufficient.** Over 1317 harvested BenchCAD GT programs
   (mean voxel IoU 0.9992, inherited from the benchmark census): the 18 user-invocable ops
   express **1.9 %**; adding the primitives already assigned to another agent → **94.5 %**;
   the full 40-op kernel table → **96.3 %**. The residual not already scheduled is **two op
   names, `ARC` and `HELIX`** — and I confirmed both absent
   (`grep -cE "\bDRAFT\b|HELIX" FeatureTree.hpp` = 0, `grep -c ARC FeatureTreeCompiler.cpp` = 0).
3. **The model is not short of ops; it is short of features.** On the BenchCAD holdout
   `expert3d-v1` was asked for 93 interface features, produced 10, and matched **0** — F1
   0.000 on all six families, against an instrument that self-scores 1.000. It emitted zero
   counterbores across 32 parts using `CBORE`, an op it already has and can already invoke.

**So the honest ordering is fidelity → reachability → the two missing kernel ops → the missing
*value kinds* → free-form surfaces last.** And the value-kind argument is the owner's thesis in
its strongest form: **a family whose values cannot be named in the IR cannot exist at any
fidelity.** That argument is true. It just points at **SKETCH** and **ASSEMBLY**, not at
Class A or SubD.

**The cheapest capability in the project, by a wide margin, is §1.** Twenty-two kernel ops are
built, compiled, tested, driven through the verifier, and forbidden for one reason repeated
verbatim twenty-two times: *"no command in the forge::ui registry emits it."* A UI command is
**20 lines** — I counted `part.sketch_circle` at `ui/src/PartCommands.cpp:503-522`. That is
440 lines of work standing between the app and 92.6 points of ground-truth expressibility.

---

# 1. ★ THE FREE TIER

**Read this section even if you read nothing else.** Nothing in it requires new geometry, new
math, a new value kind, or a research result. All of it is already compiled and already tested.

## 1.1 The 22 forbidden ops — 20 lines each

Verified at the tip: `implementation/sacrosanct/archie_op_vocabulary.json` reports
`kernel_ops: 40`, `user_invocable_ops: 18`, `forbidden_ops: 22`, `registry_commands: 31`,
`commands_emitting_ir: 20`. `ui/include/forge/ui/ArchieOpVocabulary.hpp:44,47,48` declares the
same three constants. **All 22 forbidden ops carry one distinct reason string** — I extracted
the set and its cardinality is 1. Not one is forbidden for a geometric reason.

The modelling census drove **15 of the 22 straight through `forge::ft` on the pinned verifier
and got 15/15 valid watertight solids** with every closed form checking (`POLY` pentagon
shoelace-exact, `PRISM` 25980.762114 exact, `PUSHFACE` 30000 = 40·30·25 exact, `DEFEATURE`
healing a Ø8 bore back to 24000 exactly). The direct-edit census executed the other family
through `forge_verify` independently. **This bucket is not speculative.**

| op | what a ~20-line UI command unlocks | assigned to |
|---|---|---|
| `BOX` `CYL` `CONE` `SPHERE` `TORUS` `PRISM` `TUBE` `RRECT` `REGPOLY` `ROTATE` | 1.9 % → **94.5 %** of BenchCAD GT expressible. `CYL` alone is in 64.0 % of GT programs, `ROTATE` 67.7 %, `BOX` 48.7 % | **landed** on `origin/app/kernel-primitives` (28 invocable / 12 forbidden) |
| `POLY` | the only IR op accepting an arbitrary silhouette; 20.1 % of GT programs; `task_101` op 1 is a waisted plate that has no other spelling | brief says assigned — **the landed branch does not take it** (§1.5) |
| `SLOT` | obround profiles, keyways by composition | brief says assigned — **the landed branch does not take it**, and it is **wrong today** (§1.4) |
| **`INPUT`** | ★ **the entire editing half of every benchmark.** `INPUT()` binds the input STEP. CADGenBench is **32 of 81 editing fixtures**; neuralCAD-Edit is 47 scoreable edit tasks; `INPUT` appears in **22.0 % of all corpus IR rows**. Without it no edit task is expressible at all | **this roadmap** |
| **`TAG`** | ★ persistent `@name` binding that survives index-permuting edits, with a position tolerance, an ambiguity refusal and a witness predicate (Law 6). The only defence against a face index silently retargeting after a boolean | **this roadmap** |
| **`VERIFY`** | ★ the do-no-harm assertion. Forbidding it means the app cannot express an invariant. The model reaches for it constantly | **this roadmap** |
| `PUSHFACE` | direct push/pull of a planar face. GT record `archie_edit_209` is **one `PUSHFACE`** | **this roadmap** |
| `RESIZEBORE` | exact bore resize. GT record `archie_edit_214` is **one `RESIZEBORE`**; `"bore:max"` already means "the largest bore" | **this roadmap** |
| `DEFEATURE` | feature removal + heal. Measured restoring an un-filleted plate to the last digit (23463.008882 → 23497.345175) | **this roadmap** |
| `HEAL` | shape simplification (today `simplifyShape` only — see §1.3) | **this roadmap** |
| `FOLD` | 90° flange macro (`BOX` + `ROTATE` + `FUSE`). Not sheet metal, and correct for what it is | **this roadmap** |
| `SWEEP` | path sweep. 1 use in 1317 GT programs — honestly low value, but it is already built | **this roadmap** |
| `WIRE` | arbitrary polyline loft sections; 1.7 % of GT programs | **this roadmap** |

**`TAG`, `VERIFY` and `INPUT` are forbidden by the same rule as `BOX`, and that is a category
error.** They are not features — they are the naming mechanism, the assertion mechanism and the
input-binding mechanism. A vocabulary that forbids its own self-checking is not a narrower
vocabulary; it is one that cannot check itself. **Un-forbid these three first, regardless of
what happens to the primitives.**

★ **`INPUT` is unreachable twice over.** Un-forbidding it is necessary and not sufficient:
`forge-desktop/src/KernelScene.cpp:107` calls `forge::ft::compile(tree)` with **no input
path** (verified — `buildFromIr(const std::string& program)` at `:72` takes a program and
nothing else). The fix is `file.import` in `forge::ui` **and** an input-STEP parameter on
`KernelScene::buildFromIr`. Fixing only the vocabulary would silently not work.

## 1.2 The second free tier — VERIFY quantities already computed and discarded

**Hours of `else if`, and it is the only change in this entire roadmap that improves Archie
without touching the grammar, the value model, the op table, or the UI registry.**

`opVerify` (`FeatureTreeCompiler.cpp:1944-2156`) supports **eight quantity groups**. In the
same process, on the same body:

* `massProperties` returns **14 numbers** and `VERIFY` reads **one** (`volume`). Free:
  `area`, `com.x|y|z`, `inertia.xx|yy|zz|xy|xz|yz`.
  ★ `com` catches the failure volume cannot — a part that matches volume to 0.1 % and sits in
  the wrong place. Placement is the entire interface term.
* `topologySignature` returns **6** and `VERIFY` reads **two**. Free: `vertices`, `euler`.
* `CompileResult::valid` is already held. Free: `watertight`.
* ★ **`forge_verify.cpp:584-595` already builds the per-kind face histogram the ground truth
  is stated in** (`std::map<std::string,long> hist; for (auto& f : full) hist[f.kind]++;`)
  and **no tree can assert on it.** `archie_edit_214`'s ground truth *is* `cylinder 167, torus
  125, bspline 67, sphere 25, cone 4, plane 42`. Three lines in `opVerify` make the GT's own
  summary form assertable.

Tier 3 (`VERIFY(%b, "<selector>.<quantity> …")`, reaching `resolveSelector` 550 lines up the
same file) is **days** and closes the loop with `TAG`: today a tree can *name* a feature and
then assert **nothing** about the thing it named.

## 1.3 The third free tier — compiled kernel code with no IR name at all

This bucket is larger than the 22 and part of it needs no new value kind either. It is a
sharper version of the same defect: those 22 ops at least *exist in the IR*. These do not.

**I verified this myself**, by grepping the compiler for each entry point:
`holeWizard`, `draftFaces`, `rib`, `thickenSurface`, `offsetSolid`, `extrudeProfileOnPlane`,
`sweepWithGuides`, `loftWithGuides`, `shellMultiThickness`, `onCurvePattern`, `moveFace`,
`rotateFace`, `deleteFaceAndHeal`, `replaceFace`, `sewShape`, `autoFillMissingFaces`,
`autoRepairSelfIntersection`, `harmonizeNormals`, `helicalSweep`, `sectionSolid`,
`splitCavityCore`, `fitSurface` — **all 22 have zero real call sites in
`FeatureTreeCompiler.cpp`.** (`rib` returns 5 grep hits; I read all five and every one is a
comment.)

| already compiled, no IR name | lines | new value kind? | cost of a name |
|---|---:|---|---|
| ★ `part::draftFaces` — analytic + native + OCCT paths | — | no | **days** (§4, rank 8) |
| `part::extrudeProfileOnPlane` — sketch on *any* world plane, boss or cut | — | no | days — the largest expressive win in the solid family |
| `part::rib`, `offsetSolid`, `shellMultiThickness`, `onCurvePattern`, `holeWizard` (csk + tapped geometry **already written**) | — | no | days each |
| `direct::moveFace`, `rotateFace`, `replaceFace`, `deleteFaceAndHeal` | — | no | days each |
| `heal::sewShape`, `autoFillMissingFaces`, `autoRepairSelfIntersection`, `harmonizeNormals`, `shapefix::repair` (returns the full DONE1..8/FAIL1..8 log — exactly the *named* failure a repair loop needs) | — | no | `HEAL(%b, MODE)`, **4 one-line cases** |
| `native::brep::sectionSolid` — the only kernel-backed WIRE producer that is not a polyline | — | no | days |
| ★ `loftguide::loft(wires, guides, …)` — the compiler passes `{}` for `guides` at `FeatureTreeCompiler.cpp:1002` | — | no | **one argument** |
| `forge::sheetextend` — 928 lines, real gauge tables, correct bend allowance, real DXF, real relief cut; 5/6 functions measured working; **its only C++ references are its own header, its own impl and `binding.cpp`** (verified) | 928 | no | days |
| `mold::analyseDraft` — genuinely real and correct draft **analysis** | — | no | days (a `VERIFY` key) |
| `forge::classa::*` — zebra, curvature comb, G0–G3 continuity, Gauss/mean curvature, G2 stitch; 760 lines, compiled, JS-bound | 760 | **no** (analysis consumes SOLID) | days — see §4 rank 12 |
| `native/gdt/Gdt.cpp` — 945 lines compiled, **22 public functions, 2 reach JS** | 945 | no | days |
| assembly kernel — `AssemblySolver` 661 + `MateLibrary` 811 + `ComponentRegistry` 296 + `InterferenceDetection` 279 + `AssemblyHierarchy` 124 + `MotionStudy` 87 = **2258 lines**, all CMake-linked and N-API-exported (line counts verified with `wc -l`) | 2258 | **ASSEMBLY** | weeks (§3) |
| `Drawings.cpp` — complete native HLR engine, base/aux/section+hatch/detail/broken/perspective + DXF + SVG | 1366 | **DRAWING** | weeks |
| `surfacing::*` + `native/brep` Coons/Gregory/NURBS/Surfit — 5,708 lines across ten principal files | 5708 | **SURFACE** | weeks (§3) |
| 28 native mesh modules; **21 of 28 are not in `CMakeLists.txt` at all** (verified by `comm` of on-disk vs CMake: `Remesh`, `Decimate`, `Repair`, `WallThickness`, `HausdorffDistance`, `Subdivide`, `QuadDominant`, `HoleFill`, `Offset`, `Curvature`, …) | ~12.7k | **MESH** | see §6.9 |
| `native/gdt/FcfEvaluator.cpp` — 849 lines, **not in `CMakeLists.txt`** (verified, `grep -c` = 0), no call site, and the gate its own header names does not exist. **Never compiled.** | 849 | no | see §6.3 |

## 1.4 The anti-free tier — seven measured defects that delete capability for free

These cost hours and each one is currently *removing* capability the kernel already has.
Every one was measured by a census agent; I re-derived the two marked ★.

| # | defect | measured effect | cost |
|---|---|---|---|
| 1 | ★ `sigOf` anchors a "curved" face on `axisLocation`, which `faceInventory` never populates for b-spline/sphere (`FeatureTreeCompiler.cpp:1355-1356`, `:1372`, `:1423`) | **every** b-spline face gets the identical signature `at={0,0,0}`; `sigDistance` is exactly 0.0; the ambiguity guard fires and blames a `PATTERN` that is not there. **92 of 430 faces (21.4 %) of the owner's own fixture cannot be named by `TAG`** | **hours** — one predicate, three call sites |
| 2 | `VERIFY(%a, %b, "…")` `continue`s on any non-`Str` arg (`:1947`, verified by reading the loop) | the second body ref is **silently discarded** and the tree reports `ok:true, PASS`. A clearance assertion written the natural way passes a question it never asked | hours |
| 3 | `SLOT` places both end-cap arcs through the *inside* of the rectangle | the obround's caps are subtracted, not added. Wrong on Archie's emission path **today**, because the IR is not gated by the UI vocabulary | hours |
| 4 | `FILLET`/`CHAMFER` advertise selector spellings the compiler does not honour; `CONVEX` is published to the model and rejected; a quoted selector silently means `ALL` | **confidently wrong geometry reported as success.** `task_101` ops 8–9 are edge-predicate fillets and are inexpressible | days |
| 5 | `ClassASurfacing` G2 ran **inverted**; G3 measured identically zero | a perfect join scored 200.00 %. Any Class A claim graded on it was marketing | **fixed on `origin/design/class-a-surfacing`** |
| 6 | `ShapeRegistry::get` materialises a `NativeSolid` (one lump) — every OCCT-only application module **silently discards all but the first lump** | measured on a 15 000 mm³ two-plate body: `flatten` → 12 000, `unfold` → 12 000, `endCap` → 13 200 (fused to the wrong body), `analyseDraft` → 6 faces of 12. No throw, no diagnostic. **Sheet metal, weldments and mold are multi-lump by nature** | days |
| 7 | app `bendRadius` never reaches the kernel (`binding.cpp:4800` reads `minBendRadius`); `PartCommands.cpp:757-785` emits `CBORE` with **7 args, no axis**, while the kernel accepts 10 | every bend develops at R = 0.5 mm; the app can only cut **+Z** counterbores — and counterbore recall is measured at **0.000** | hours |

## 1.5 One discrepancy in the hand-off, stated rather than papered over

The brief assigns **12** primitives to the parallel UI agent, including `SLOT` and `POLY`.
The branch that landed (`origin/app/kernel-primitives`) takes **10** and its regenerated
vocabulary leaves twelve forbidden: `DEFEATURE FOLD HEAL INPUT POLY PUSHFACE RESIZEBORE SLOT
SWEEP TAG VERIFY WIRE`. So `POLY` and `SLOT` are **not covered by either track as landed**.
`POLY` is 20.1 % of GT programs and the only op accepting an arbitrary silhouette; it must not
fall through the gap. `SLOT` must be fixed (§1.4 #3) before it is exposed at all.

---

# 2. ★ THE COMPLETE MAP

Every CAD op family, in one table.

**Columns.** *Exists* = a named implementation with a body, verified or cited to a `file:line`.
*IR* = nameable in `forge::ft::OpCode` today. *User* = a `forge::ui` command emits it.
*Kind* = the IR value kind the family needs (— = none). *Bench* = measured benchmark weight
(**HIGH**/MED/LOW/**ZERO**/UNKNOWN; ZERO means *measured at zero on all eight named
benchmarks*, not "unimportant"). *Cost* = to reach user-invocable capability, after its kind.

| # | Family | Exists in kernel | IR | User | Kind | Bench | Cost |
|---:|---|---|:--:|:--:|---|:--:|---|
| | **A · SKETCH & 2D** | | | | | | |
| A1 | Sketch entities (point/line/circle/arc) | **YES** — `forge::Sketcher`, 872 L over vendored FreeCAD planegcs (`3rdParty/planegcs`, verified present) | inside builders only | no | SKETCH | **HIGH** | weeks |
| A2 | Sketch entities (ellipse/conic/B-spline) | 11 curve types in `Geo.h`, **4 wired** to the facade | no | no | SKETCH | MED | weeks |
| A3 | Geometric constraints | **YES** — 67 `addConstraint*` primitives in `GCS.h`, **10 wired** (binary exposes 14 — §7) | **NO** — compiler calls `addPoint/addLine/addCircle/addArc` and **never** `addConstraint` or `solve` (verified, `grep -c` = 0) | no | SKETCH | **HIGH** | weeks |
| A4 | Dimensional constraints | **YES** — same solver | no | no | SKETCH | **HIGH** | weeks |
| A5 | DOF / over-under-constrained diagnosis | **YES and executed** — `classification="over"`, `conflicting=[1,2]`, per-tag residuals | no | no | SKETCH | MED | days after A3 |
| A6 | 2D curve offset | **YES** — `native::geom::PolygonOffset2D` | no | no | — | LOW | days |
| A7 | 2D trim / extend / split | **NO** | no | no | SKETCH | LOW | weeks |
| A8 | Sketch on face / datum planes | partial (`extrudeProfileOnPlane` takes a world plane) | no | no | SKETCH | MED | weeks |
| | **B · WIREFRAME / CURVE** | | | | | | |
| B1 | Polyline wire | **YES** — `profileWire` = `BRepBuilderAPI_MakePolygon` | `WIRE`,`RING` | **no** | — | MED | free (§1.1) |
| B2 | ★ **`ARC` in the profile grammar** | sketch entity exists; **no IR term** (`grep -c ARC` = 0, verified) | **NO** | no | — | **HIGH** — 48 GT programs; one of the **three** primitives Drawing2CAD & Text2CAD-Bench score | **days** |
| B3 | Spline / ellipse profile | `Curve::makeEllipse`, `makeBSpline` exist as edge geometry; **no interpolation routine** | **NO** | no | — | MED | weeks |
| B4 | ★ **`HELIX`** | `native::brep::helicalSweep` — RMF-transported, Pappus-exact, but emits a **SOLID** | **NO** (`grep -c HELIX` = 0, verified) | no | — (solid) / WIRE (curve) | LOW — **1** GT program | days (solid) |
| B5 | Section / intersection curve | **YES ×3** — `sectionSolid`, `intersectSurfaces` native + OCCT | **NO** | no | — | LOW | days |
| B6 | Curve projection to a face | **point only** | no | no | — | LOW | weeks |
| B7 | Join / trim / extend / split a wire | join **YES** (`Wire::fromEdges`); trim/extend/split **NO** | no | no | — | LOW | weeks |
| | **C · SOLID — SKETCHED FEATURES** | | | | | | |
| C1 | Extrude / revolve | **YES** | ✔ | ✔ | — | **HIGH** — `EXTRUDE` in 65.2 % of GT | done |
| C2 | ★ Boss/pocket **on a face** | **YES** — `extrudeProfileOnPlane` (verified 0 compiler refs) | **NO** — `EXTRUDE` is Z=0 only | no | — | **HIGH** — every GT boss is on a face | days |
| C3 | Loft, ruled + guided | **YES** — `loftguide::loft(wires, guides, …)` | `LOFT`, **guides dropped** at `:1002` | ✔ (unguided) | — | MED | **one argument** |
| C4 | Sweep, path + guided | **YES** — `sweepWithGuides` (0 compiler refs) | `SWEEP` unguided | **no** | — | LOW — 1 GT use | free (§1.1) + days |
| C5 | Rib / web | **YES** — `part::rib` (verified: 5 grep hits, **all comments**) | **NO** | no | — | LOW | days |
| C6 | Thread — cosmetic | metadata only: `HoleSpec.tappedPitch` **changes no geometry** | no | no | — | LOW | days |
| C7 | Thread — cut | **NO** — helix profile is circular only | no | no | — | ZERO | months |
| | **D · SOLID — APPLIED / DRESS-UP** | | | | | | |
| D1 | Fillet, constant | **YES** | ✔ | ✔ | — | MED — `FILLET` 14.2 % of GT; **0 interface features** | done |
| D2 | Fillet, variable | **YES** — per-edge anchor list | `BLEND` (one pair for all edges) | ✔ (partial) | — | LOW | days |
| D3 | Face blend / full round | **NO** — every path is edge-driven | no | no | — | LOW | weeks |
| D4 | Chamfer | **YES** | ✔ | ✔ | — | MED — 35.2 % of GT | done |
| D5 | ★ **DRAFT** | **YES ×3** — analytic (canonical cube only), native (**returns a mesh**, so B-rep coverage reads 0.0 %), OCCT 88.0 % | **NO OpCode AT ALL** (verified) | no | — | MED (geometry) / ★★ **gates all 13 OCCT drop waves** | **days** for the op; **months** for native |
| D6 | Shell, uniform | **YES** | ✔ | ✔ | — | MED | done |
| D7 | Shell, multi-thickness / chosen face | **YES** — `shellMultiThickness` (0 refs) | **NO** — `SHELL` picks one face by largest-area heuristic | no | — | LOW | days |
| D8 | Thicken (open shell → solid) | **YES** — `thickenSurface` (0 refs); `THICKEN` op lands on the SURFACE branch, **forbidden** | on SURFACE branch | no | SURFACE | LOW | days after SURFACE |
| D9 | Offset solid | **YES** — `offsetSolid` (0 refs) | **NO** | no | — | LOW | days |
| D10 | Hole — simple | **YES** | ✔ | ✔ | — | **HIGH** — bore = 43.6 % of all interface features | done |
| D11 | Hole — counterbore | **YES** | ✔ | ✔ (**7 args, +Z only**; kernel takes 10) | — | **HIGH** — measured recall **0.000** | hours |
| D12 | Hole — countersink / tapped | **YES** — `holeWizard(kind 2/3)`, geometry written (0 refs) | **NO** | no | — | MED | days |
| | **E · BOOLEAN / BODY** | | | | | | |
| E1 | Fuse / cut / common | **YES** — `FeatureTreeCompiler.cpp:2171` calls `setForgeNativeBrepEnabled(false)`, so **100 % of corpus booleans run on OCCT today** (verified) | ✔ | ✔ | — | **HIGH** — `CUT` 79.6 % of GT | done |
| E2 | Split / trim body | **YES** — `mold::splitCavityCore` (0 refs) | **NO** | no | ASSEMBLY (2 bodies out) | LOW | days after ASSEMBLY |
| E3 | Imprint | machinery inside the native boolean (SSI cut curves); no public entry | no | no | — | LOW | weeks |
| E4 | Move / rotate / scale body | `TRANSLATE` ✔, `ROTATE` forbidden; **no SCALE** | partial | partial | — | **HIGH** — `TRANSLATE` 90.8 %, `ROTATE` 67.7 % of GT; placement **is** the interface term | free (§1.1) |
| | **F · PATTERN / MIRROR** | | | | | | |
| F1 | Linear / polar / grid pattern | **YES** | ✔ | ✔ | — | MED — 35.1 % of GT; bolt patterns = 3.9 % of interface | done |
| F2 | Curve-driven pattern | **YES** — `onCurvePattern` (0 refs) | **NO** | no | — | LOW | days |
| F3 | Sketch/table/fill-driven pattern | **NO** | no | no | SKETCH | LOW | weeks |
| F4 | Mirror | **YES** | ✔ | ✔ | — | LOW — 0 uses in the GT harvest | done |
| | **G · DIRECT / DUMB-SOLID EDITING** | | | | | | |
| G1 | Push/pull planar face | **YES**, measured exact | `PUSHFACE` | **no** | — | **HIGH** — GT `archie_edit_209` **is** one `PUSHFACE`; CADGenBench is 32/81 edit fixtures | free (§1.1) |
| G2 | Resize bore | **YES**, measured exact | `RESIZEBORE` | **no** | — | **HIGH** — GT `archie_edit_214` **is** one `RESIZEBORE` | free (§1.1) |
| G3 | Move / rotate / replace face, delete+heal | **YES ×4** (0 compiler refs, verified) | **NO** | no | — | MED | days each |
| G4 | Defeature | **YES** — measured restoring a plate to the last digit | `DEFEATURE` | **no** | — | MED | free (§1.1) |
| G5 | ★ `CUTFEATURE` | **NO** — designed in `reports/CUT_FEATURE_DESIGN.md`, zero implementation. It is what GT record 203 needs | no | no | — | MED | weeks |
| G6 | Curved offset-face | **NO** | no | no | — | LOW | weeks–months |
| G7 | Feature recognition (general) | `FeatureRecognition.js` is a **verified orphan** and never implements step 5 of its own docstring — it never classifies a hole | no | no | — | ZERO | months |
| G8 | Direct-edit composition | ★ **BROKEN** — `DEFEATURE` after `PUSHFACE` fails; the same tree without the `PUSHFACE` succeeds. **No test chains two edit ops** | — | — | — | **HIGH** | days |
| | **H · SURFACE (Class C/D → A/B)** | | | | | | |
| H1 | SURFACE value kind | **LANDING** — `origin/ir/surface-value-kind`, +2043 L, 6 new ops (`CAP FACES SEW SKIN SURFCHECK THICKEN`), 40 → **46** kernel ops | ✔ on that branch | ★ **all 6 land FORBIDDEN** | SURFACE | see §3 | landed / weeks to reach |
| H2 | NURBS patch authoring / trim / sew / refine / eval | **YES** — `Nurbs.cpp` 811 L, live, JS-bound | **NO** | no | SURFACE | ZERO on interface (§0.1) | weeks |
| H3 | Coons / Gregory n-sided fill | **YES** — `SurfaceFill.cpp` 840 L (G1/G2), `GregoryFill.cpp` 904 L (G1 + additive G2), A/B-tested vs OCCT — **zero non-test callers** | **NO** | no | SURFACE | ZERO | weeks |
| H4 | Surface fit to point cloud | **YES** — `Surfit.cpp` 535 L, honest residual reporting | **NO** | no | SURFACE | ZERO | weeks |
| H5 | Surface knot insert / degree elevate | curve-level **YES**; surface-level **elevate only** | no | no | SURFACE | ZERO | weeks |
| H6 | ★ Surface **fairing** | **NO — absent in any form.** Flagged as the Class-A follow-up in *both* fill headers. `Surfit`'s `lambda=1e-8` is Tikhonov conditioning, not a fairing energy | no | no | SURFACE | ZERO | **2–3 months** |
| H7 | ★ Patch boundary **matching** to G2 | **NO** — nothing solves a control net against a neighbour | no | no | SURFACE | ZERO | **2–3 months** |
| H8 | Class A **analysis** — zebra, comb, G0–G3, Gauss/mean, G2 stitch | **YES** — 760 L live, all six entry points enumerated on a built binary. G2 was inverted, G3 inert (§1.4 #5) | **NO** | no | ★ **none** — analysis consumes SOLID | LOW | **days** |
| | **I · SUBDIVISION / FREE-FORM** | | | | | | |
| I1 | SubD cage modelling | ★ **1 real file of 18 grep hits.** `native/mesh/Subdivide.cpp` = 344 L of correct **Loop-on-triangles**, 35/35 self-test — and it is **not in `CMakeLists.txt`** (verified) so it has never linked. No cage, no creases, **rejects open meshes**, and Loop's limit surface is a box-spline, so exact B-rep conversion is impossible in principle | no | no | SUBD | ZERO — **0 cages** in any fixture | **months** (~2200 L new; Catmull-Clark, not Loop) |
| I2 | SubD ↔ B-rep | **NO** | no | no | SUBD + SURFACE | ZERO | months |
| I3 | T-splines / global deform | **NO** | no | no | UNKNOWN | ZERO | UNKNOWN |
| | **J · MESH / POLYGON** | | | | | | |
| J1 | Mesh import (STL) | **YES** via `INPUT()` — but **typed SOLID**. Volume/bbox/genus measure exactly; `VERIFY "faces="` and **every boolean** throw from inside `ShapeRegistry::get` | partial | no | **MESH** | LOW | days after MESH |
| J2 | Mesh repair / hole fill / self-intersection | **YES** — `repairMesh` 643 L, `HoleFill`; **uncompiled** | no | no | MESH | ZERO | weeks |
| J3 | Remesh / decimate / smooth / offset / voxelize | **YES** — `Remesh` 1128 L, `Decimate` 701 L, …; **21 of 28 modules uncompiled** (verified) | no | no | MESH | ZERO | weeks |
| J4 | Mesh boolean | **YES** — the one entry point exposed to JS, over raw arrays not handles | no | no | MESH | LOW | days |
| J5 | Mesh → B-rep (reverse engineering) | `PrimitiveFit` (plane/line/sphere/cylinder) is real, gated, **zero call sites, not even a JS binding** | no | no | MESH+SURFACE | ZERO | months |
| J6 | Mesh export (OBJ/OFF/PLY) | ★ **YES, all three written** — `MeshExchange.cpp:391/441/495/538/605/639` — and `binding.cpp` has **zero** occurrences of `MeshExchange` (verified) | no | no | — | LOW | **hours** |
| | **K · ASSEMBLY** | | | | | | |
| K1 | Component instancing + hierarchy | **YES** — `ComponentRegistry` 296 L (BVH, ray/frustum, 100k reserve) + `AssemblyHierarchy` 124 L | **NO** | no | **ASSEMBLY** | **HIGH** — MUSE axis 1 is a Component Assembly Graph, phrase in **106/106** rubrics | weeks |
| K2 | Mates / joints | **YES** — `AssemblySolver` 661 L (8 kinds, sparse-QR damped Gauss-Newton) + `MateLibrary` 811 L (12 SolidWorks kinds incl. gear/rack-pinion/cam/slot/width) | **NO** | no | ASSEMBLY | **HIGH** — MUSE axis 2 is Joint Design | weeks |
| K3 | Interference / clash | **YES** — `InterferenceDetection` 279 L, native narrow phase **default-ON**, A/B-gated vs OCCT | **NO** | no | ASSEMBLY | MED | days after K1 |
| K4 | Assembly patterns | JS only (`ComponentPattern`, 4 kinds) | no | no | ASSEMBLY | LOW | days |
| K5 | BOM / mass roll-up | JS only; the C++ `BomRollup` its header references **does not exist** | no | no | ASSEMBLY | LOW | days |
| K6 | Motion study / kinematics | **YES** — `MotionStudy` 87 L | no | no | ASSEMBLY | ZERO | days |
| K7 | ★ Multi-solid STEP writer | **NO** — `exportStep` takes one handle. `Compound` substrate exists | no | no | ASSEMBLY | **HIGH** — **on MUSE's critical path**; without it an ASSEMBLY has no export and cannot be scored | **1–2 weeks** |
| K8 | In-context / top-down design | **NO** | no | no | ASSEMBLY | ZERO | months |
| | **L · DRAWING / DRAFTING** | | | | | | |
| L1 | 3D→2D view projection (base/aux/section+hatch/detail/broken/perspective) | **YES** — `Drawings.cpp` 1366 L, native HLR, TKHLR dropped | **NO** | no | **DRAWING** (`ProjectedView`/`View2D` already exist as C++ types) | ZERO — Drawing2CAD runs the **other** direction | weeks |
| L2 | Dimensioning / annotation | JS composer ~4250 L, marked **UNMAPPED** in the migration manifest; **5 of 8 Drawing-workspace panels are `drawGenericPanel` placeholders** | no | no | DRAWING | ZERO | weeks |
| L3 | DXF / SVG output | **YES** — both, in `Drawings.cpp` | no | no | DRAWING | ZERO | days |
| L4 | ★ 2D→3D (`DXFPROFILE`) | `forge::dxf::parse`, 136 L, 4 entity types, no `DIMENSION`/`TEXT`/`BLOCK`; **no path from a `Document` to a `PROFILE`** | **NO** | no | ★ **none** — it yields `PROFILE` | MED | **days** |
| | **M · PMI / GD&T** | | | | | | |
| M1 | Datums + feature control frames | `Gdt.cpp` 945 L compiled, **22 public functions, 2 reach JS** | **NO** | no | ★ **none** — pass-through on SOLID, the `TAG` precedent | ★ **ZERO** — 0 of 106 MUSE rubrics mention GD&T, a datum or an FCF; the composite has no such axis | days |
| M2 | FCF evaluation against the B-rep | `FcfEvaluator.cpp` 849 L — **not in `CMakeLists.txt`** (verified), no call site, the gate its header names does not exist. **Never compiled** | no | no | — | ZERO | see §6.3 |
| M3 | Semantic PMI export (AP242) | `exportStepWithPmi` writes FCFs as ISO-10303-21 **comments** — no AP242 reader sees them. The semantic writer is JS-only | no | no | — | ZERO | weeks |
| M4 | Tolerance analysis | the verified-suite `fcf` tool is `archdisc-Models/scripts/fcf_evaluator.py` (1135 L, stdlib) — a **measurement** tool, not a modelling capability | n/a | n/a | — | ZERO | n/a |
| | **N · SHEET METAL** | | | | | | |
| N1 | Base / edge flange, miter | `forge::sheetextend`, 928 L — real gauge tables, correct BA/BD, real relief cut, 5/6 measured working — **no C++ consumer** | no | no | — | ZERO as a family; the parts are still scored as geometry | days |
| N2 | Bend / unbend / fold | `FOLD` exists (macro), compiles, **forbidden** | `FOLD` | no | — | LOW | free (§1.1) |
| N3 | Flat pattern | ★ `flatPattern` (`SheetMetal.cpp:748`) returns a rectangle whose length **omits the flange**: measured 106.095 vs 131.095 from the repo's own correct calculator — the difference is exactly the 25 mm flange | no | no | — | ZERO | days |
| N4 | Corner relief, sketched bend | ★ **no-ops** — measured, volume unchanged | no | no | — | ZERO | weeks |
| N5 | Jog / hem / louver / gusset | **NO** | no | no | — | ZERO | months |
| | **O · WELDMENTS / STRUCTURAL** | | | | | | |
| O1 | Structural member from a profile | ★ **every profile builds a solid box** (`Weldments.cpp:156`) — measured: RectTube 50×50×3 and IBeam 50×100 are both solid boxes. Geometry mass vs cut-list weight disagree **4.4×** | no | no | — | ZERO | weeks |
| O2 | Trim / extend / cope | ★ `trimMember` does **no geometry** and hard-codes `miterDeg = 45`, with `(void)memberB`. `CopeCut.js` is a correct planner with no consumers | no | no | ASSEMBLY | ZERO | weeks |
| O3 | End caps, gussets, weld beads | `endCap` exists; multi-lump bug fuses it to the wrong body (§1.4 #6) | no | no | ASSEMBLY | ZERO | weeks |
| O4 | Cut list | exists, and disagrees with the geometry by 4.4× | no | no | ASSEMBLY | ZERO | days |
| | **P · MOLD / DIE / TOOLING** | | | | | | |
| P1 | Draft **analysis** | **YES and correct** — `Mold.cpp:153` | **NO** | no | — (a `VERIFY` key) | ZERO | days |
| P2 | Parting line | **YES** — silhouette-edge detection is correct at `:223` | no | no | — | ZERO | days |
| P3 | ★ Parting **surface** | detects the silhouette then **discards it**; the surface is a flat plane through the bbox centre (`:243-293`). **Throws on a box, a cylinder and a sphere** | no | no | SURFACE | ZERO | months |
| P4 | Core / cavity split | exists — measured **losing 156 919 mm³**; the halves do not close | no | no | ASSEMBLY | ZERO | months |
| P5 | Shut-offs, slides, lifters, shrinkage, runners | **NO — nowhere in the repo** | no | no | SURFACE+ASSEMBLY | ZERO | months |
| | **Q · PARAMETRICS / HISTORY** | | | | | | |
| Q1 | ★ Persistent naming | **YES, and better than expected** — `TAG` binds `@name` to a face signature with a `max(1, 2·r)` position tolerance, an ambiguity refusal, and **Law 6**: a witness predicate whose independent resolution must agree or the compile fails "the name has retargeted" | `TAG` | **no** | — | **HIGH** | free (§1.1) + §1.4 #1 |
| Q2 | Lineage tracking | `LineageRegistry` populated at **exactly one call site** (`Booleans.cpp:272`, OCCT branch, operand A) and read by nothing in production | no | no | — | LOW | weeks |
| Q3 | Named parameters + expressions | real and wired **in the JS app**, nowhere near the kernel | **NO** | no | SCALAR (optional) | MED | ~1 week |
| Q4 | Driving vs driven dimensions | **NO**, everywhere | no | no | SKETCH | MED — HistCAD's metric is constraint-aware editability | weeks |
| Q5 | Suppress / reorder / rollback | JS implementations exist; their only consumer `ForgeProject` has **no production consumer of its own** | **NO** | no | — | LOW | weeks |
| Q6 | Configurations / design tables | `Configurations.cloneFor(config)` was **specified in a comment and never written** (repo-wide grep returns only the comment) | no | no | — | ZERO | weeks |
| Q7 | Incremental rebuild | **NO** — every parameter edit recompiles the whole tree | no | no | — | LOW | weeks |
| | **R · I/O / INTEROP** | | | | | | |
| R1 | STEP read | **YES** — and `StepReadOcct.cpp:1683` `ShapeFix_Shape` has **"no peer"**: it is both the edit-benchmark door and the last TKShHealing blocker, **with no regression gate** | via `INPUT` | **no** | — | **HIGH** | free (§1.1) |
| R2 | STEP write, single solid | **YES** — satisfies both sides of CADGenBench's contract | ✔ | ✔ | — | **HIGH** | done |
| R3 | STEP write, assembly | **NO** (K7) | no | no | ASSEMBLY | **HIGH** | 1–2 weeks |
| R4 | STL | read + write | via `INPUT` | no | MESH (for booleans) | LOW | days |
| R5 | OBJ / OFF / PLY | ★ **written and exposed by nothing** (J6) | no | no | — | LOW | **hours** |
| R6 | IGES | reads; **honestly refuses to write** | no | no | — | ZERO | weeks |
| R7 | JT / Parasolid | **NO** | no | no | — | ZERO | licensing, not schedule |
| | **S · MEASUREMENT / VERIFICATION** | | | | | | |
| S1 | `VERIFY` — 8 quantity groups | **YES** | `VERIFY` | **no** | — | **HIGH** | free (§1.1) |
| S2 | ★ `VERIFY` tier 1–2 (mass props, topology, per-kind face census) | **already computed and discarded** (§1.2) | no | no | ★ **none** | **HIGH** | **hours** |
| S3 | `VERIFY` tier 3 (selector-scoped) | `resolveSelector` exists 550 L up the same file | no | no | none | **HIGH** | days |
| S4 | `VERIFY` tier 4 (two-body: interference, clearance, IoU) | `detectInterference`, `voxelIoU` exist | ★ second ref **silently dropped**, reports PASS | no | none | **HIGH** | days |
| S5 | Wall thickness, draft angle, Hausdorff | `analyzeWallThickness`, `analyseDraft`, `hausdorffDistance` — all finished, all zero callers | no | no | MESH (some) | LOW | days |
| S6 | Section / cut-away view | `sectionSolid` (0 refs) | no | no | — | LOW | days |
| | **T · SIMULATION-ADJACENT** | | | | | | |
| T1 | FEA meshing | `FeaTet.cpp` exists; `reports/FEA_NAFEMS_GAP.md` in tree | no | no | MESH | ZERO | UNKNOWN |
| T2 | Additive manufacturing | `native/am/Am.cpp` exists | no | no | MESH | ZERO | UNKNOWN |
| T3 | CAM toolpaths | **UNKNOWN — not censused by any agent in this run** | UNKNOWN | no | UNKNOWN | ZERO | UNKNOWN |

**Row count: 120 families across 20 domains** (counted from the table itself, not asserted).
Every **ZERO** is *measured against the eight named benchmarks*, not an opinion about the
family's worth in a CAD product. Two rows are **UNKNOWN** and say so rather than being omitted.

---

# 3. THE VALUE-KIND LADDER

A family blocked on a value kind **cannot be scheduled before that kind**. This is the hardest
dependency in the roadmap: no amount of fidelity, and no number of new ops, substitutes for it.

**Two orderings, and they disagree — so both are given.** Family counts are counted from the
§2 table (a row is counted for a kind if its Kind cell names it, so jointly-blocked rows like
`MESH+SURFACE` count for both).

| kind | families blocked on it | benchmarks it unblocks | cost of the kind itself | verdict |
|---|---:|---|---|---|
| **ASSEMBLY** | ★ **15** — E2, K1–K8, O2, O3, O4, P4, P5, R3 | **MUSE**: 69 of 106 rows are multi-component cases the IR cannot state at all; **106/106** rubrics contain "Component Assembly Graph"; 34 name an explicit N-component target; **29 score illegal fusion at 0 points** | kind + 6 ops **~1 week**†; multi-solid STEP writer **1–2 weeks**† and it is on the critical path | ★ **do it.** Most families of any kind; one benchmark, but ~⅔ of its rows |
| **SKETCH** (+ `SKETCHREF`) | 9 — A1, A2, A3, A4, A5, A7, A8, F3, Q4 | ★ **four otherwise-unanswerable**: ParaCAD, Text2CAD-Bench, HistCAD, Drawing2CAD-*official*. All four want a sketch representation **as the answer**, not as an intermediate | IR half **days**†; facade breadth **weeks**†; app **months**† (interaction design, not mathematics) | ★ **do it.** Highest benchmark unlock of any kind |
| **SURFACE** | 12 — D8, H1–H7, J5, P3, P5 | **none measured.** Contributes **0** to the 40 % interface term by construction; 5.2 % of BenchCAD parts, 97.4 % of those in four gear/helix families; all 3 `bevel_gear` holdout parts are **refused by the instrument** (300 s timeout) | ★ **already landed** on `origin/ir/surface-value-kind` | merge it — then stop at reachability (§4 Wave 5) |
| **MESH** | 9 — J1–J5, R4, S5, T1, T2 | none directly — but it **removes a measured defect**: today `CUT` on an imported STL throws from inside `ShapeRegistry::get`. Naming the kind lets `CUT` *route* to the mesh boolean instead of throwing | days for the kind; the 21 uncompiled modules are separate (§6.9) | after ASSEMBLY and SKETCH |
| **DRAWING** (+ `SHEET`) | 3 — L1, L2, L3 | **none.** Drawing2CAD runs 3D→2D's opposite direction; `DXFPROFILE` (2D→3D) needs **no kind** | weeks | defer (§6.7) |
| **SUBD** | 2 — I1, I2 | **none.** 0 cages in any fixture | months, and the scheme must change from Loop to Catmull-Clark first | ✗ §6.1 |
| `SCALAR` | 1 — Q3, and only if measurements must be *consumed* by later ops | none | UNKNOWN | optional |

**Reading the disagreement honestly.** By family count, ASSEMBLY leads and SURFACE is second.
By benchmark unlock, SKETCH leads and SURFACE is *last of the six*. The two orderings **agree**
on the part that matters: SURFACE, MESH, DRAWING and SUBD all come after ASSEMBLY and SKETCH.
SURFACE ranks high on families and zero on benchmarks — which is precisely the shape of the
owner's thesis being right about the product and wrong about the scoreboard (§5).

★ **Note what is *not* on this list.** **70 of the 120 rows need no new value kind at all**;
48 are kind-blocked and 2 are UNKNOWN (I3, T3). The 70 include
`DRAFT`, `EXTRUDEON`, `ARC`, every direct-edit op, every `VERIFY` tier through 4, `DXFPROFILE`,
Class A **analysis**, and all of PMI. Those rows are Waves 0–2. **The value-kind ladder is not
the critical path for most of the map; it is the critical path for the benchmarks nobody can
currently score.**

## ★ 3.1 The closure check cannot see its own blind spot — and it is about to prove it

`archie_op_vocabulary.json` publishes `value_kind_closure` and asserts
`produced_by_allowed_ops: ["PROFILE","SOLID","WIRE"], gaps: []`. **That closure is computed
over the ops a user can invoke.** A kind whose every producing op is forbidden is invisible to
it.

I verified what happens when a value kind actually lands. On `origin/ir/surface-value-kind`:

```
kernel_ops:         40 -> 46        (CAP, FACES, SEW, SKIN, SURFCHECK, THICKEN)
user_invocable_ops: 18 -> 18        (unchanged)
forbidden_ops:      22 -> 28        (all six new ops, same one reason string)
value_kind_closure: {"produced_by_allowed_ops":["PROFILE","SOLID","WIRE"],"gaps":[]}
```

**The SURFACE value kind lands, six ops appear, and the instrument that exists to detect
exactly this reports no gaps.** It will do the same through every wave of this roadmap.

**Recommendation (hours):** make `value_kind_closure` compute over the **kernel** op table and
report `produced_by_kernel_ops` and `produced_by_allowed_ops` as two sets, with the difference
named. Without that, "gaps: []" is a sentence the generator is structurally incapable of
retracting, and every reader of the vocabulary — including the training pipeline — is being
told the value model is complete.

---

# 4. THE RANKING — benchmark value ÷ cost, respecting dependencies

Costs: **hours** · **days** (≤ 1 week) · **weeks** (1–8) · **months** (> 2). Estimates marked
† are inherited from the owning census rather than re-derived by me.

## Wave 0 — hours. No dependencies. Pure defect repair and self-checking.

| # | work | why first | cost |
|---:|---|---|---|
| 0.1 | ★ `sigOf` anchor fix — `hasAxis` instead of `!= "plane"`, at `FeatureTreeCompiler.cpp:1356`, `:1372`, `:1423` (all three or the signature and the distance disagree) | unblocks **21.4 % of the owner's own fixture** for the mechanism the whole edit story rests on. Strict improvement: no axis-bearing face changes behaviour | hours |
| 0.2 | ★ Un-forbid `TAG`, `VERIFY`, `INPUT` | 3 vocabulary rows. A vocabulary that forbids its own naming, assertion and input-binding cannot check itself | hours |
| 0.3 | ★ `VERIFY` tiers 1+2 — `area`, `com.*`, `inertia.*`, `vertices`, `euler`, `watertight`, and the **per-kind face census the ground truth is stated in** | the only change that improves Archie without touching grammar, value model, op table or UI. `com` catches what volume cannot | hours |
| 0.4 | `VERIFY(%a,%b,…)` must name the dropped operand instead of reporting PASS | a wrong answer delivered confidently is worse than a refusal. **The one place in this roadmap where a loud error beats silent tolerance** | hours |
| 0.5 | Fix `SLOT`'s inverted end caps | wrong on Archie's emission path **today**; prerequisite to ever exposing `SLOT` | hours |
| 0.6 | Pass `guides` in `opLoft` instead of `{}` (`:1002`) | **one argument**. `task_101` op 4 is a guided figure-8 skin | hours |
| 0.7 | `CBORE` 10-arg in `PartCommands.cpp:757-785`; `bendRadius`→`minBendRadius` at `binding.cpp:4800` | counterbore recall is **0.000** and the app can only cut +Z | hours |
| 0.8 | Add `node forge-kernel/test/sketcher_smoke.js` to `forge:kernel:test` | **one line — the first gate ~370 KB of vendored numerics has ever had** | hours |
| 0.9 | Fix `value_kind_closure` to compute over kernel ops (§3.1) | otherwise "gaps: []" is unretractable | hours |
| 0.10 | Wire `Subdivide.cpp` + the other 20 `native/mesh` sources into CMake **or** move them to `unwired/` | 344 verified lines nothing compiles is how a census reports "SubD 18 files" and a reader concludes there is a subdivision system | hours |

## Wave 1 — days. Reachability. The free tier.

| # | work | value | cost |
|---:|---|---|---|
| 1.1 | ★ UI commands for the remaining forbidden ops — `INPUT PUSHFACE RESIZEBORE DEFEATURE HEAL FOLD SWEEP WIRE` **and `POLY`, `SLOT`** (§1.5) | closes the forbidden set to zero. `POLY` alone is 20.1 % of GT programs | ~20 lines each |
| 1.2 | ★ `KernelScene::buildFromIr` takes an input-STEP parameter + `file.import` in `forge::ui` | without **both**, `INPUT` stays unreachable and the whole editing half stays unreachable | days |
| 1.3 | Implement `CONVEX`; make a quoted selector **resolve** instead of silently meaning `ALL` | a trained spelling that hard-fails fires hardest on the longest trees; a silent `ALL` is confidently wrong geometry | days |
| 1.4 | ★ Fix multi-lump discard in `ShapeRegistry::get` | prerequisite for sheet metal, weldments, mold — all multi-lump by nature — and for anything downstream of `ASSEMBLY` | days |
| 1.5 | Make `DEFEATURE` compose after `PUSHFACE`; add a test that chains two edit ops (there is none) | the edit ops do not compose **today** | days |

## Wave 2 — days. Names for compiled code. No new value kind.

| # | work | value | cost |
|---:|---|---|---|
| 2.1 | ★ **`ARC` in the profile grammar** | 48 GT programs (3.6 %); one of the **three** primitives Drawing2CAD and Text2CAD-Bench score directly. The sketch entity already exists | days |
| 2.2 | ★ **`DRAFT(%body, "sel", angle, neutral)`** over `part::draftFaces` as it stands | the largest missing NX/CATIA verb — and the **harness the native-draft programme needs**. Without it every coverage experiment runs from a bespoke C++ probe instead of from corpus IR | days |
| 2.3 | ★ **`EXTRUDEON`** over `extrudeProfileOnPlane` | makes **every** feature placeable on **any** face. Every GT boss is on a face, not on Z=0 | days |
| 2.4 | `VERIFY` tier 3 — selector-scoped assertions | closes the loop with `TAG`: name a feature, then assert about it | days |
| 2.5 | `HEAL(%b, SIMPLIFY\|FILL\|REPAIR\|ORIENT\|TOLERANCE)` | 4 cases over compiled code; `shapefix::repair`'s DONE1..8 log is a **named** failure a repair loop can act on | days |
| 2.6 | `RIB` · `OFFSETSOLID` · `MOVEFACE` · `ROTATEFACE` · `REPLACEFACE` · `UNIFY` · `SEW` · `SECTION` · `HOLE(…,CSK\|TAPPED)` · `PATTERN(…,CURVE,…)` · `SHELL` with a face-selector list | 11 built-but-unnamed verbs, one compiler case each | days each |
| 2.7 | `DXFPROFILE(...) -> PROFILE` | the only 2D→3D door in the repo; needs **no** new value kind | days |
| 2.8 | Bind OBJ/OFF/PLY (`MeshExchange.cpp`) in `binding.cpp` | three of five accepted mesh formats, already written | **hours** |
| 2.9 | `HELIX(r,R,pitch,turns) -> SOLID` over `helicalSweep` | 1 GT program. Cheap, honest, low value — do it because it is one case, not because it pays | days |
| 2.10 | Class A **analysis** into `VERIFY` (continuity, `zebra.breaks`) — ★ **needs no SURFACE kind** | makes a class claim checkable. Since the instrument was broken (§1.4 #5), measurement must precede any authoring claim | days† |

## Wave 3 — weeks. `SKETCH` + `SKETCHREF`. Four benchmarks unlocked.

Minimal honest version (from the sketch census, its estimate): six ops —
`SKETCH(XY)` · `SPT` · `SLINE` · `SCIRC` · `CON` · `SOLVE` — the 10 constraint kinds the facade
already dispatches, two value kinds in `Val::Kind`, `clearByTag` exposure, and **two gates**,
one of which asserts that a *deliberately contradictory* sketch still returns `ok == true` with
a solid and a named demoted tag.

★ **The family bolts on in front of the existing IR without touching one line of it:**
`SOLVE(%sketch) → PROFILE`, and `PROFILE` is what `EXTRUDE`/`REVOLVE`/`LOFT`/`SWEEP`/every
boolean/every edit op already consumes. **Weeks** for the IR + facade; the app is months and is
interaction design, not mathematics.

## Wave 4 — weeks. `ASSEMBLY`. MUSE unlocked.

Six ops and one kind: `INSTANCE` · `ASM` · `MATE` · `SOLVE` · `ASMPATTERN` · `CLASH`, every
builder body a call into an existing function. `MATE`'s second argument is a keyword, so 8
registry kinds + 12 matelib kinds are **one op with a widening keyword set — no new op per mate
type, ever**. ~1 week† for the kind + ops, **1–2 weeks† for the multi-solid STEP writer**,
which is the piece MUSE's rubric is actually judged from. Depends on Wave 1.4.

## Wave 5 — weeks. `SURFACE` reachability.

Merge `origin/ir/surface-value-kind`; add UI commands for its six ops (they land forbidden);
then `PATCH` / `TRIMSURF` / `ELEVATE` / `FITSURF` / `FILLPATCH` over Coons/Gregory/Surfit — all
of which already compile and are already A/B-verified against OCCT. **2–3 weeks† after SURFACE
lands.** Buys real product capability and, on the eight named benchmarks, **0.000**.

## Wave 6 — weeks. `MESH`.

The kind, then routing `CUT`/`FUSE` to `meshBoolean` instead of throwing, then compiling the 21
uncompiled modules behind gates.

## Wave 7 — months. Genuinely absent, and correctly last.

| work | cost | note |
|---|---|---|
| ★ Native `DRAFT` **construction** to B-rep | **months, no bounded fix known** | 0.0 % native vs 88.0 % OCCT. Family J alone gates all 13 drop waves and closure 14→12. The native path *tessellates and returns a mesh* — it is not low-coverage, it is the wrong shape |
| Surface **fairing** (H6) | 2–3 months† | genuinely absent in any form; the real gate on a Class A claim |
| Patch boundary **matching** to G2 (H7) | 2–3 months† | the classical hard part of a Class A toolkit |
| SubD, Catmull-Clark + creases + open cages + limit extraction | months, ~2200 L† | see §6.1 |
| Real sheet metal (N3, N4), real weldments (O1, O2), real mold (P3, P4) | months each | see §6.4–6.6 |
| `DRAWING` kind + annotation + the 5 placeholder panels | months | see §6.7 |
| PMI/GD&T semantic modelling | months | see §6.3 |

---

# 5. ★ THE HONEST ANSWER TO THE THESIS

> *"not only Class A/B/C/D, SubD, wireframe and BRep op families but ALL CAD op families as
> thats how Archie will achieve 1st place on all benchmarks as it can execute any CAD model/s."*

## 5.1 Where the thesis is exactly right

**"The op families ARE the capability surface"** is not a slogan; it is provably true of this
codebase and the map above is the proof. 88 families; a large majority of the machinery already
compiled; and the binding constraint on most rows is a *name*, not math.

And the thesis has a **stronger form than the one it states**: *a family whose values cannot be
named in the IR cannot exist at any fidelity.* That is unarguable, it is exactly the
value-kind ladder in §3, and it is why four benchmarks (ParaCAD, Text2CAD-Bench, HistCAD,
Drawing2CAD-official) and 69 of 106 MUSE rows are not merely scoring badly — **they cannot be
answered at all.** No amount of fidelity fixes that. Only a kind does.

## 5.2 Where the evidence contradicts the thesis

**As the *first* move, and in the *direction* the named families point, the evidence says no.**

| the claim | what the measurement says |
|---|---|
| more op families → higher benchmark scores | **96.3 %** of BenchCAD GT is already inside the 40-op table. The residual not already assigned elsewhere is **two names**, `ARC` and `HELIX`, worth **1.8 points** of GT coverage |
| the model needs more ops | it has never once asked for one. **0.118 %** OOV across 4.28 M corpus statements, and they are typos (`PLY`, `CYLINDER`) |
| Class A / SubD / free-form surfacing move the needle | ★ interface is 40 % of the score and reads **three face-kind predicates**: cylinder, plane, plane. **Verified**: 0 occurrences of torus/bspline/sphere/cone in 1141 lines. A B-spline face cannot contribute one interface point |
| … at least on the free-form benchmark parts | BenchCAD's one free-form family is `bevel_gear`, and **all 3 of its holdout parts are refused by the instrument** (300 s verifier timeout). Perfect surfacing moves that score by **0.000** |
| … at least on the drawing benchmark | **292 of 292 Drawing2CAD GT references are 100 % plane + cylinder.** Zero curved surfaces. Its official alphabet is `{Line, Arc, Circle, SOL, Ext, EOS}` |
| vocabulary is what is losing | on the BenchCAD holdout, **93 interface features expected, 10 found, 0 matched** — F1 0.000 on all six families, against an instrument self-scoring 1.000. On the text holdout, **311 bores expected, 48 found**, and **zero** counterbores across 32 parts using an op it already has |

**Headroom split, stated as the upper bound it is:** of the 0.684 composite between
`expert3d-v1` (0.3103) and the instrument ceiling (0.994) on 34 scoreable BenchCAD parts, the
`ARC`/`HELIX`-blocked families are **5 of 34 = 14.7 % → +0.101**; the other **29 parts →
+0.583** sit behind fidelity on ops that already exist. ★ **That split flatters the vocabulary
case**, because it credits the missing ops with taking those 5 parts all the way to the ceiling
in one step. **~85 % of available headroom is fidelity.**

## 5.3 So: what the families buy, and what they do not

This is the section that keeps the roadmap from being sold as something it is not.

**WHAT THEY BUY — real, measured, and large:**

* **User-invocability of the 22 (§1): 1.9 % → 94.5 % → 96.3 % GT expressibility.** The single
  largest vocabulary move available anywhere in the project, and it is ~440 lines.
* **The six edit ops:** 32 of 81 CADGenBench fixtures, 47 scoreable neuralCAD-Edit tasks, and
  HistCAD. `INPUT` appears in **22.0 %** of all corpus IR rows and is unreachable **twice over**.
* **`SKETCH`:** makes **four currently-unanswerable benchmarks answerable at all**.
* **`ASSEMBLY`:** makes **69 of 106 MUSE rows stateable**, and **29 MUSE rubrics score illegal
  fusion at 0 points** — a pipeline emitting one welded solid is capped on ~⅓ of MUSE before
  geometry is looked at.
* **`ARC`:** 48 GT programs *and* one of the three primitives two benchmarks score directly.
* **`VERIFY` widening:** the only change that improves Archie without touching grammar, value
  model, op table or UI.
* **`DRAFT` and `EXTRUDEON`:** the two largest missing NX/CATIA verbs, days each.

**WHAT THEY DO NOT BUY — stated as plainly:**

* **Not one point of the 40 % interface term from any curved-surface family.** By construction,
  verified in the extractor.
* **Not one point on BenchCAD from perfect surfacing.** 5.2 % of parts, 97.4 % of those in four
  gear/helix families, and the only holdout family that needs them is refused by the instrument.
  Expected delta: **0.000**.
* **Not one point from PMI/GD&T** on any of the eight. 0 of 106 MUSE rubrics mention a datum,
  a GD&T symbol, or a feature control frame; the composite has no such axis.
* **Not one point from sheet metal, weldments or mold *as families*.** Those parts are scored
  as geometry like any other. (The 18-op vocabulary still cannot express a bent, radiused,
  relieved plate at all — that is a *geometry* argument, and it is Wave 1, not Wave 7.)
* **Not the fidelity gap, and this is the one that decides the ordering.** Until an emitted
  bore lands inside the 0.80–0.95 IoU ramp, a new op family adds an op the model will place
  wrongly. Derived placement is already the measured unlearnable sub-task: **40.4 % of train
  and 48.2 % of held-out-B `TRANSLATE` arguments are exact arithmetic on other numbers.**

## 5.4 Two cautions on "first place" itself

* **MUSE's local gate floor is 100 %** — a featureless box of the stated envelope passes 37/37
  and 106/106. Any MUSE number below the VLM-rubric stage is not evidence of anything.
* **Held-out B is 8 families, not 250 rows** (SE ±0.088, 6.1× the naive estimate), and the
  expert3d holdout at n=25 would need n=625 for 80 % power. Compute required-n from observed SD
  *before* claiming any of this moved a score.

## 5.5 The one-sentence answer

**Build all the op families — the owner is right that they are the capability surface and right
that a missing value kind is an absolute ceiling — but build them in the order the evidence
gives, which is: repair the seven defects, spend the 440 lines that make 22 built ops
reachable, add `ARC`/`DRAFT`/`EXTRUDEON`, then `SKETCH`, then `ASSEMBLY`, and put Class A, SubD
and free-form surfacing last; and do not expect the families to move a benchmark score until
the model can place a bore where the target has one, because ~85 % of the measured headroom is
there and no op family reaches it.**

---

# 6. WHAT IS NOT WORTH BUILDING

A roadmap with no exclusions has not made any decisions. Each exclusion names what it would
cost, what it would buy, and — where there is one — the cheap honesty repair that replaces it.

**6.1 SubD (Catmull-Clark), on benchmark grounds.** ~2,200 lines† of new kernel: quad-capable
refinement, creases (non-negotiable — without them SubD cannot make a manufacturable part),
boundary rules for open cages (the current code *refuses* them), limit-patch extraction, and
extraordinary-vertex caps. **0 cages in any fixture.** `archie_edit_214` is 67 b-spline faces
and zero cages; `task_101`'s 14 ops need none. And the existing Loop code is not a stepping
stone: Loop's limit surface is a box-spline, Catmull-Clark's is bicubic B-spline away from
extraordinary vertices, which is the *only* reason SubD→B-rep is exact rather than a fit.
*If SubD is wanted for product reasons that is a legitimate call — but it should be made
knowing it is a from-scratch build, not the exposure of something that exists.*
**Cheap repair instead (hours):** wire `Subdivide.cpp` into CMake and register its test, or
move it to `unwired/`.

**6.2 Class A fairing and patch matching, before the instrument and before fidelity.** 2–3
months† each, and they are the *real* gate on any Class A claim. But two of the four continuity
metrics were not measuring anything (one inverted, one identically zero) until this week's fix,
and free-form surfaces score **0.000** on the only benchmark family that needs them. **Do the
measurement half first — it is days, it is unblocked by the SURFACE kind entirely, and it is
what makes every later authoring claim falsifiable.** Nothing supports a Class A capability
claim today.

**6.3 PMI / GD&T as a modelling capability.** 0 of 106 MUSE rubrics mention GD&T, a datum, or a
feature control frame; the composite has no such axis; `exportStepWithPmi` writes FCFs as
ISO-10303-21 *comments* that no AP242 reader sees. **One exception, and it is a liability not a
feature: `FcfEvaluator.cpp` is 849 lines that have never been compiled** (verified: `grep -c
FcfEvaluator CMakeLists.txt` = 0), with no call site and a gate its own header names that does
not exist. Compile it behind a gate or delete it. Leaving it is how "a file nothing compiles
cannot break" becomes a shipped defect.

**6.4 A real sheet-metal workbench.** Months, zero benchmark points. But the *defects* are
hours and they are currently reporting wrong numbers: `flatPattern` omits the flange (106.095
vs 131.095 — exactly the 25 mm flange), `cornerRelief` and `sketchedBend` are measured no-ops,
the shipped smoke's 224.2 mm guard is **90 radians** of bend allowance and its `200..240` band
*fails the correct call*. Fix the defects and wire `sheetextend`'s 928 working lines; do not
build the workbench.

**6.5 A real weldment workbench.** Months, zero benchmark points. But every profile currently
builds a **solid box** and the geometry mass disagrees with the cut-list weight by **4.4×** —
that is a correctness bug worth hours, not a reason to build a workbench. `trimMember` doing no
geometry while hard-coding `miterDeg = 45` should be *documented as a stub*, not left to look
finished.

**6.6 Mold parting surfaces, shut-offs, slides, lifters, shrinkage, runners.** Months, zero
benchmark points, and the foundation is not sound: `computeParting` detects silhouette edges
correctly and then **discards them** for a flat plane through the bbox centre; it **throws on a
box, a cylinder and a sphere**; cavity + core lose 156 919 mm³ so the halves do not close.
Draft *analysis* is real and correct — expose that as a `VERIFY` key (days) and stop there.

**6.7 Drawing view composition (3D→2D) as a benchmark play.** The 1,366-line native HLR engine
is real and TKHLR is dropped because of it. Its benchmark value is **zero** — Drawing2CAD runs
the opposite direction. **The days-cost item that actually points at a benchmark is
`DXFPROFILE` (2D→3D), and it needs no new value kind.** Build that; leave the composer.

**6.8 General feature recognition.** Months. `FeatureRecognition.js` is a verified orphan that
never implements step 5 of its own docstring — it never classifies a hole. The recognisers the
interface metric actually needs (bore, counterbore, bolt circle, mating face, shaft land)
already exist in `interface_metrics.py` as a **measurement** tool. Recognition is not what is
losing; emission is.

**6.9 Compiling all 21 orphaned `native/mesh` modules speculatively.** ~12,700 lines with 26 CI
gates and 18 of 22 entry points at zero production callers. Compile them **as the `MESH` kind
consumes them**, not before — otherwise the build grows by 12.7k lines of code nothing calls,
and the honest state ("uncompiled") is replaced by a worse one ("compiled, unused, and now
counted as capability").

**6.10 Cut threads, keyways as first-class ops, unsew, in-context design, JT/Parasolid.** Cut
threads need a non-circular helical profile and no benchmark scores a thread flank. Keyways are
a composition of `SLOT` + `CUT` once `SLOT` is fixed. JT and Parasolid are licensing, not
schedule. IGES already refuses to write **honestly**, which is the correct behaviour.

**6.11 ★ Wiring `OpConstraintBridge` to the planner — actively harmful, do not do it.** It is a
235-line refusal engine with thirteen verdicts and **zero production callers** (only its own
test at `ui/test/op_constraint_bridge_test.cpp:209`). Its allow-set is 18 ops; under it the only
`PROFILE` producers are `RECT` and `CIRCLE` and the only `WIRE` producer is a superellipse. It
**poisons every downstream `%N` of a refused statement** (`ui/src/OpConstraintBridge.cpp:553-558`),
so one refusal at op 30 destroys ops 31–400. Wiring it as written would turn a 41.5 %-ok
emission set into **0 %**. It is a fine UI affordance — *"this command is not on a toolbar
yet"* — and a capability ceiling wearing a safety hat anywhere near Archie's emission path.
★ **The correct response to `ForbiddenOp` is to add the command, not to refuse the plan.**

---

# 7. PROVENANCE — verified, read, inherited

**Verified by execution or by my own command at the pinned tip** (re-run any of these):

* `kernel_ops: 40`, `user_invocable_ops: 18`, `forbidden_ops: 22`, `registry_commands: 31`,
  `commands_emitting_ir: 20`; the full 18/22 op lists; **exactly one distinct forbidden reason
  string**; `ArchieOpVocabulary.hpp:44,47,48`.
* `Val { enum Kind { Profile, Wire, Solid } }` at `FeatureTreeCompiler.cpp:593`.
* `origin/ir/surface-value-kind`: 40→46 kernel ops, 18→18 invocable, 22→28 forbidden, all six
  new ops forbidden, and `value_kind_closure` still `gaps: []` (§3.1).
* `origin/app/kernel-primitives`: 28 invocable / 12 forbidden, and the residual list — which is
  how I found the `POLY`/`SLOT` hand-off gap (§1.5).
* All 22 kernel entry points in §1.3 have **zero real call sites** in `FeatureTreeCompiler.cpp`
  (I read all five `rib` hits; all are comments).
* `interface_metrics.py` is 1141 lines with exactly three face-kind predicates (l.465, 587,
  704) and **zero** occurrences of torus/bspline/sphere/cone.
* 21 of 28 `native/mesh` sources absent from `CMakeLists.txt` (`comm` of on-disk vs CMake);
  `Subdivide.cpp` among them; `FcfEvaluator.cpp` likewise absent.
* `grep -c` = 0 for `DRAFT` and `HELIX` in `FeatureTree.hpp`, `ARC` in `FeatureTreeCompiler.cpp`,
  `MeshExchange` in `binding.cpp`, `addConstraint`/`solve` in `FeatureTreeCompiler.cpp`.
* `opVerify`'s `continue` on any non-`Str` arg at `:1947`; `setForgeNativeBrepEnabled(false)` at
  `:2171`; `KernelScene::buildFromIr(const std::string&)` at `KernelScene.cpp:72`,
  `ft::compile` at `:107`.
* `part.sketch_circle` is **20 lines** at `ui/src/PartCommands.cpp:503-522` — the basis for the
  "~20 lines per command" claim.
* **Every line count in this document, checked with `wc -l`:** `AssemblySolver` 661,
  `MateLibrary` 811, `ComponentRegistry` 296, `InterferenceDetection` 279,
  `AssemblyHierarchy` 124, `MotionStudy` 87 (assembly total **2258**); `Gdt` 945,
  `FcfEvaluator` 849; `Drawings` 1366; `Sketcher` 872; `SheetMetalExtended` 928;
  `ClassASurfacing` 760; `Nurbs` 811; `GregoryFill` 904; `SurfaceFill` 840; `Surfit` 535;
  `Remesh` 1128, `Decimate` 701, `Repair` 643, `Subdivide` 344; `native/mesh` total **12 720**.
  planegcs vendored and present in `forge-kernel/3rdParty/planegcs/`.
* The §2 map's own arithmetic: **120 family rows / 20 domains**, of which **70 need no new
  value kind**, **48 are kind-blocked** and **2 are UNKNOWN** — all four counted from the
  table by script, not asserted.
* `a457bea2` is an ancestor of the tip, 2 commits behind — so every census claim holds here.

**Read at a `file:line` by a census agent and cross-checked by me against the pinned source,
but not independently executed:** the `sigOf` mechanism and its 21.4 % consequence; the
`OpConstraintBridge` poisoning at `:553-558`; the `TAG` Law-6 witness predicate; the `SHELL`
opening-face heuristic; the `LineageRegistry` single call site.

**Inherited from a census's own execution and NOT re-derived by me** — every number here is
traceable to a named PR, and if one is wrong the conclusion that rests on it moves:

* The 15/15 forbidden-op build sweep and its closed forms (PR #147/#151/#153 worktrees).
* The 1317-program GT coverage figures 1.9 % / 94.5 % / 96.3 % and the 0.118 % OOV rate (#150).
* `expert3d-v1` 93 expected / 10 found / 0 matched; 311 bores → 48 found; the 0.583/0.101
  headroom split (#150).
* The sheet-metal, weldment and mold measurements — 106.095 vs 131.095, the 4.4× mass
  disagreement, 156 919 mm³ lost, the multi-lump 15 000→12 000 sweep (#152).
* The Class A G2 inversion sweep, and the 5,708-line ten-file surface aggregate
  (`design/class-a-surfacing`) — I verified six of its ten constituent files individually.
* The 35/35 Loop subdivider self-test and the ~2,200 LOC Catmull-Clark estimate (`design/subd-freeform`).
* The 50-face / 258-face loft discretisation table and the `SLOT` cap defect (`design/modelling-op-families`).
* The sketcher's live over-constrained diagnosis (`classification="over"`, `conflicting=[1,2]`) (#147).

**Known-uncertain, flagged rather than smoothed over:**

* The sketcher binary a census drove exposes **14** constraint kinds; the pinned source declares
  **10**. `git log --all -S PointOnObject` returns nothing — **someone is extending the facade
  off-branch, in the shared checkout, on no origin branch.** Both counts are carried.
* Two censuses drove binaries **newer than the pinned base** (`forge_verify` from 2026-08-29,
  which accepts `bodies`/`interference`). Their claims were cross-checked against pinned source;
  the `VERIFY` two-body rows in §1.2/§4 reflect the **pinned** behaviour.
* The "533 `VERIFY` uses in 600 rows" and "892 `POLY` uses" figures are the owner's; no emission
  corpus is committed in this tree and neither was re-derived.
* Row **T3 (CAM toolpaths)** is **UNKNOWN**: no agent in this run censused it. It is in the map
  as UNKNOWN rather than omitted.
* `forge-desktop` is **not compiled by CI**. Every UI-side estimate in this roadmap ships
  unverified until that is fixed — and that is the mechanism by which a dangling
  `std::string` size byte already reached a shipped app.

---

## Appendix — the design stance, in one rule

Every recommendation above is **REPRESENT · REPAIR · TOLERATE**, and the ordering is deliberate.

* **Represent.** Most of this roadmap is a `case` in a compiler switch or a row in a vocabulary
  table, over code that already runs. Adding a name removes a gate; it never adds one.
* **Repair.** Where a request is out of range, degrade and *say so in the result* — the way
  `opFillet` already retries at 0.75/0.5/0.35/0.2× radius. A `DRAFT` that cannot hold its angle
  emits the largest it can and reports the shortfall. `FITSURF` returns its residual and lets
  `VERIFY` decide the tolerance; a hard tolerance inside a constructor is a gate that fires
  hardest on the most organic input.
* **Tolerate.** `SOLVE` on a contradictory sketch demotes the last-declared constraint and
  yields a `PROFILE`; `MATE` over-constrained keeps the last poses and reports the residual and
  the offending mate ids; `ASSEMBLY→SOLID` implicitly fuses and `SOLID→ASSEMBLY` becomes one
  member at identity; `CLASH` reports and never fails the build. **The floor of every new
  family is the status quo.**
* **Refuse only as a last resort, and name the entity.** `resolveSelector`'s `@name` failure is
  the bar to copy — *"@x no longer matches any face … nearest candidate is 60.3 mm away,
  tolerance 12.0"* — because a repair loop can act on it. §1.4 #1's `PATTERN` misdiagnosis is
  the counter-example: a correct refusal with a wrong cause costs a debugging session.
* **Never refuse silently.** The quoted-selector path (§1.4 #4) and the dropped `VERIFY` operand
  (§1.4 #2) are worse than gates: they deliver confidently wrong answers. **These are the only
  two places in this roadmap where I recommend a loud error over silent tolerance.**
* **Never refuse a spelling the vocabulary teaches.** `CONVEX` is published to the model and
  rejected by the compiler. Implement it or unpublish it — a trained spelling that hard-fails is
  the binding constraint's exact failure mode, and it fires hardest on the trees that use the
  most selectors, which are the longest ones.
