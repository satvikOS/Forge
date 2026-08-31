# Family census — DIRECT / SYNCHRONOUS MODELLING, FEATURE RECOGNITION, DEFEATURING, HEALING

**Date** 2026-08-31 · **Base SHA** `a457bea2e9e82a129ea7b0b719fb8a4b56ccaad9`
(`origin/claude/sacrosanct-execution-20260828`, "D-035 retracts D-034") ·
**Status** census — no kernel or UI code changed by this report.

Blob SHAs of the four files this census is mostly about, at that commit, so a later reader can
tell whether it still describes the tree:

| file | blob |
|---|---|
| `forge-kernel/src/DirectEdit.cpp` | `50292c695a70b48390a7658ee91cb68ec6e3f43c` |
| `forge-kernel/src/DirectModeling.cpp` | `4c97a93984a75697e390e19aae48c0492cede7c9` |
| `forge-kernel/src/Healing.cpp` | `98d8d1ef3d811477e0ad4037d3aad3f94556af5c` |
| `ui/include/forge/ui/ArchieOpVocabulary.hpp` | `35ee055224f83dd32513a5806b2f6dbddc2ea016` |

## Method, and what "verified" means here

Three grades are used and never blurred:

* **MEASURED** — I ran it. Every such number came out of
  `forge-kernel/build-fixcheck/forge_verify` (built 2026-08-29 15:11), fed IR on stdin. The
  reproduction inputs are in Appendix A and every volume is checked against closed-form
  arithmetic in the same line.
* **READ** — I read the implementation and confirmed it is a named function with a body wired
  to a call site. A grep hit alone is never reported as a capability.
* **CITED** — someone else measured it; the file and line are given and the claim is theirs.

Where I could not establish something, it says so.

---

## 1. The headline: this family is BUILT AND SWITCHED OFF

Six of the 22 forbidden ops are this family's core, and every one of them is implemented,
compiles today, and executes today in the shipped desktop application. Nothing is missing but a
line of UI.

**MEASURED.** All of these ran end to end through `forge_verify` on a stock plate:

| IR line | result | closed-form check |
|---|---|---|
| `DEFEATURE(%3, "hole:at=15,0")` | ok, `holes=1` PASS, vol 23497.345175 | 24000 − π·4²·10 = 23497.345 ✓ |
| `DEFEATURE(%3, "fillet:r=2")` after `FILLET(2, VERTICAL)` | ok, vol 23497.345175, faces 11→7 | restores the un-filleted plate **to the last digit** (filleted was 23463.008882) ✓ |
| `RESIZEBORE(%2, "bore:max", 3.0)` | ok, vol 23717.256661, bore r 4→3 | 24000 − π·3²·10 = 23717.257 ✓ |
| `RESIZEBORE(%2, "bore:max", 6.0)` | ok, vol 22869.026645 | 24000 − π·6²·10 = 22869.027 ✓ |
| `RESIZEBORE` on a **blind** Ø8×5 bore → r 3 | ok, vol 23858.628331, `span` 5, genus 0 | 24000 − π·3²·5 = 23858.628 ✓ |
| `PUSHFACE(%2, "+Z", 5.0)` | ok, `bbox.z=15` PASS, vol 35246.017763 | 36000 − π·4²·15 = 35246.018 ✓ |
| `PUSHFACE(%1, "+Z", -3.0)` | ok, vol 16800 | 60·40·7 ✓ |
| `TAG(%3,"@left","hole:at=-15,0")` | `TAG @left -> cylinder face 7` | — |
| `HEAL(%2)` | ok, 7 faces | — |
| `FOLD(%1, -30,20,0, 60,15,2, 90, 0)` on a 60×40×2 plate | ok, vol 6360, bodies 1, shellCount 1, bbox.z 15 | 4800 + 1800 − 240 overlap = 6360 ✓ (the flange root is fused into the plate; the flat 0° form gives 6600 exactly) |

`TAG` even survives a boolean-based direct edit: `TAG → PUSHFACE → RESIZEBORE("@left")` resolved
the name across the push and resized the correct bore (output `bores` = r 3 at (−15,0), r 4 at
(15,0)). That is the L4 persistent-name mechanism working on exactly the case it was built for.

**Why no user can reach any of it.** Not a kernel limit and not a policy that inspects geometry.
`ui/include/forge/ui/ArchieOpVocabulary.hpp:177-222` gives all 22 forbidden ops one identical
reason: *"no command in the forge::ui registry emits it, so no user can produce it."*
`ui/src/PartCommands.cpp` registers 18 commands; none of them is a direct-modelling command.

**READ — the gate is nowhere near the kernel.** `forge-desktop/src/KernelScene.cpp:72-116`
hands the document's IR straight to `forge::ft::parse` then `forge::ft::compile`, with **no op
filter of any kind**. `forge::ui::OpConstraintBridge`, the component that *could* refuse a
forbidden op, has no production call site at all — the only file that references it besides its
own header and generator is `ui/test/op_constraint_bridge_test.cpp`. So the moment a command
emits the statement, the shipped app executes it. There is nothing else to build.

**CITED, and it is already costing emission quality.** `implementation/sacrosanct/DECISIONS.md`
D-035 (:1435-1494, merged at this base SHA) measured a 600-emission run: **95.6% of "illegal" op
uses — 1890 of 1978 — are ops the kernel implements**, forbidden solely by that UI-gap sentence,
and only 1.0% are true out-of-vocabulary. The op-position census in that entry includes `PUSH`
×3: the model reaching for `PUSHFACE` and being scored as if it had invented an op.

**The three retained ground-truth edit records are this family and nothing else.** Verified by
reading the owner's logs directly (`~/New Folder With Items/`):

| fixture | instruction | recorded plan | the IR that says it |
|---|---|---|---|
| `archie_edit_214` | "Shrink the diameter of the largest bore in this part by 5mm" | enumerate bores → pick largest Ø96.851 → offset that cylindrical face inward 2.5 mm → rebuild → confirm the other 7 bores + bbox unchanged | `RESIZEBORE(%0,"bore:max",45.9255)` + `VERIFY` |
| `archie_edit_209` | "Thicken the part in the +Z direction by 2.5mm" | identify +Z extreme planar face → extrude/offset +2.5 → rebuild → confirm z-max | `PUSHFACE(%0,"+Z",2.5)` + `VERIFY` |
| `archie_edit_203` | "Reduce the number of impeller blades from 7 to 5" | locate 7 radial blade solids → select 2 symmetric → **defeature/CUT** → heal → verify | *inexpressible* — see §5.1 |

Two of the three are one forbidden op each.

---

## 2. Census — direct / synchronous modelling

Columns: *reachable from IR* means `forge::ft` compiles a statement for it; *user-invocable*
means a `forge::ui` command emits that statement.

| op / capability | exists in kernel? (file:line) | reachable from IR? | user-invocable? | value kinds needed | what it would take | benchmark that scores it |
|---|---|---|---|---|---|---|
| **push/pull planar face** | YES — `forge::pushPullFace`, `src/DirectEdit.cpp:362-395` (prism ± boolean + heal) | YES — `PUSHFACE(%b,"sel",d)`, `FeatureTreeCompiler.cpp:1837-1858` | **NO** | SOLID only | one `CommandDescriptor` (~35 lines, `PartCommands.cpp`) + vocabulary regen | neuralCAD-Edit; **GT 209 is exactly this** |
| **resize hole / bore** | YES — `forge::resizeBore`, `src/DirectEdit.cpp:397-458` (annulus cut/fuse, axial span from the face's own v-extent) | YES — `RESIZEBORE(%b,"sel",r)`, `:1860-1900` | **NO** | SOLID only | same | neuralCAD-Edit; **GT 214 is exactly this** |
| **delete face + heal the wound** | YES — `forge::defeature`, `src/DirectEdit.cpp:340-360` (`BRepAlgoAPI_Defeaturing`) | YES — `DEFEATURE(%b,"sel"…)`, `:1902-1942` | **NO** | SOLID only | same | neuralCAD-Edit, HistCAD |
| **delete face + cap by fitting** | YES — `forge::direct::deleteFaceAndHeal`, `src/DirectModeling.cpp:635-665` (face-subset shell → `autoFillMissingFaces`) | **NO** | **NO** (napi only, `binding.cpp:6607`) | SOLID | a `DELETEFACE` op in `forge::ft` (~25 lines) + command | neuralCAD-Edit |
| **move face freely in 3D** | YES — `forge::direct::moveFace`, `src/DirectModeling.cpp:530-579` (normal part → push/pull; tangential part → wedge fuse) | **NO** | **NO** (napi only) | SOLID | `MOVEFACE(%b,"sel",dx,dy,dz)` op + command | neuralCAD-Edit |
| **rotate / tilt face** | YES — `forge::direct::rotateFace`, `src/DirectModeling.cpp:582-633` | **NO** | **NO** (napi only) | SOLID | `TILTFACE` op + command | neuralCAD-Edit |
| **replace face surface** (plane/cyl/sphere, trim wire kept) | YES — `forge::direct::replaceFace`, `src/DirectModeling.cpp:667-736` | **NO** | **NO** (napi only) | SOLID (+ a surface *spec*, not a SURFACE value) | `REPLACEFACE(%b,"sel",KIND,…)` op + command | neuralCAD-Edit, HistCAD |
| **offset face** (move a *curved* face along its own surface normal) | **NO** — `pushPullFace` throws on any non-planar face (`DirectEdit.cpp:370-374`); `resizeBore` covers the cylindrical case only | n/a | n/a | SOLID | genuinely new: local offset + re-trim. Weeks. | neuralCAD-Edit |
| **face-group → solid (cut a boss/blade/rib)** | **NO** — designed, never built. `reports/CUT_FEATURE_DESIGN.md`, status "design only"; `grep -rn CUTFEATURE` outside that file = 0 hits | **NO** | **NO** | SOLID | see §5.1 | **GT 203**; neuralCAD-Edit |
| **persistent feature name** | YES — `TAG`, `FeatureTreeCompiler.cpp:1747-1779`; resolution + retarget guards at `:1406-1462` | YES | **NO** | SOLID (pass-through) | command + a UI notion of "name this feature" | HistCAD (design intent), neuralCAD-Edit |
| **bind an existing STEP as the body** | YES — `INPUT()`, `FeatureTreeCompiler.cpp:1780-1834` (import → `unifyFaces`) | YES | **NO** | SOLID | an "open part" command that emits `INPUT()` | every edit benchmark — **without it there is no edit task at all** |
| **in-tree do-no-harm assertion** | YES — `VERIFY`, `FeatureTreeCompiler.cpp:1944-2060` (faces / edges / volume / holes / bbox / genus) | YES | **NO** | SOLID (pass-through) | command, or emit automatically after every edit | HistCAD; every GT plan's last op is a verify |
| **sheet-metal flange** | YES — `FOLD`, `FeatureTreeCompiler.cpp:1299-1320` (BOX + ROTATE-about-hinge + FUSE) | YES | **NO** | SOLID | command | MUSE; sheet-metal families |
| **merge same-surface faces** | YES — `forge::unifyFaces`, `src/DirectEdit.cpp:198-262` | indirectly (`INPUT`, `VERIFY holes=`) | **NO** | SOLID | — (should stay internal) | prerequisite for all of the above |
| **face inventory** | YES — `forge::faceInventory`, `src/DirectEdit.cpp:264-338` | as the selector substrate | **NO** | — | expose as a panel | prerequisite |
| **face/edge/topology counts, edge polylines** | YES — `faceCount/edgeCount/topoCounts/edgeSegments`, `src/DirectModeling.cpp:368-470` | via `VERIFY` | partly (edge picking is wired: `ForgeFrame.cpp` → `forge::ui::pickEdge`) | — | — | — |
| **"Delete Selection"** | **NO** — `ui/src/ForgeShell.cpp:149-166` declares `featureIrOp = "DELETE"`; the kernel has no `DELETE`, and the handler increments `doc_.deletedCount` and touches no geometry | **NO** | it is *offered* | — | point it at `DEFEATURE`/`DELETEFACE` | — |

That last row is already recorded by the vocabulary's own self-audit as
`derived_defects[0..1]` in `implementation/sacrosanct/archie_op_vocabulary.json`
("declares an op it never emits"; "declares an op the kernel does not have"). It is the one
place in the app where the direct-modelling family *appears* to exist and does not.

### 2.1 The four IR edit ops are OCCT-only

**CITED** — `reports/TKBO_BOOLEAN_STATE.md:352-388`: *"There is no native defeature. Not a
partial one — none."* `forge::defeature` has no `#ifdef FORGE_NATIVE_BREP` branch. Under a
symbol probe, `test/ft/ft_unified_edit.mjs` (20 pass) issued 10 `Defeaturing::Build`, 69 `Cut`,
1 `Fuse` and **0 native attempts**; `test/directedit.mjs` (9/9) issued 1 / 4 / 2 / **0**. That
report also argues defeature is the only TKBO symbol group with no native code behind it, and
therefore the largest single unknown in the TKBO estimate.

---

## 3. Census — feature RECOGNITION

Recognition is the weakest column in the family and the answers differ sharply by layer.

| capability | exists? (file:line) | what it actually decides | reachable from IR? | user-invocable? | honest limit |
|---|---|---|---|---|---|
| per-face geometric classification | YES — `forge::faceInventory`, `src/DirectEdit.cpp:264-338` | surface type + area + centroid + axis + radius + **concavity** | as the selector substrate | NO | a flat list. **No adjacency, no grouping, no volume.** |
| per-face *feature* label | YES — `forge::direct::inferFeature`, `src/DirectModeling.cpp:738-802` | `Boss / Hole / Fillet / Blend / Chamfer` | **NO** | NO (napi only) | decided from the surface type and orientation of **one** face. A cone is always "chamfer-like"; a sphere is always "blend"; a torus is always "fillet". No neighbours are consulted. |
| **hole recognition from raw B-rep** | YES — the bore detector, `src/tools/forge_verify.cpp:186-575` | a concave cylinder counts as a bore only when the **solid closes right round its axis** (`forge::PointInSolid`), and coaxial wall pieces dedup onto **one axis line** | via `VERIFY "holes=N"` (a second implementation, `FeatureTreeCompiler.cpp:1973-2010`) | NO | **lives inside a command-line tool, not the kernel library** — nothing else can call it. It also declares degradation (`boresDegraded`, `boresFellBack`) rather than silently guessing, which is the right shape. |
| fillet / boss recognition | partial — `resolveSelector`'s `fillet:`/`blend:` branch collects **every** torus and cylinder (`FeatureTreeCompiler.cpp:1621-1633`); `boss:`/`shaft:` = convex cylinders | radius bound / rank only | via selectors | NO | a `fillet:` selector with no radius bound matches the bores too. It is a filter, not a recogniser. |
| repeated radial feature groups | YES — `resolveSelector` `radial:`/`blade:`/`lug:`/`spoke:`, `FeatureTreeCompiler.cpp:1512-1613` | infers the **fold count** from the angular distribution of off-axis face centroids, then assigns each face to its nearest group centre by circular mean | YES | NO | the only *grouping* logic in the kernel, and it is **kind-agnostic** — it reaches bspline blade faces that no other predicate can name. Its own comment records that the earlier sector-based version removed 3 blades when asked for 2. |
| pocket / slot / rib / chamfer recognition | **NO** | — | — | — | nothing exists. |
| mesh-based patch recognition (JS) | YES, 422 lines — `frontend/src/foundation/FeatureRecognition.js`, `recognize()` at :327 | region-grow on normal similarity → per-patch planar RMS or Pratt circle/cylinder fit → `planar / cylindrical / freeform` | **NO** | **NO** | **VERIFIED ORPHAN**: no module imports it. The only two references in the tree are comments in `CAMToolpath.js:4,222`. **VERIFIED INCOMPLETE against its own header**: step 5 of its docstring promises `HOLE / SHAFT / EDGE_FILLET` classification; grepping the file for `hole`/`shaft`/`EDGE_FILLET` returns **only those comment lines**. It never classifies a hole. |

**Answer to "can the kernel identify a hole, a fillet, a boss, a pocket from raw B-rep?"**

* **hole — yes, and well.** The `forge_verify` bore detector is a real recogniser: it rejects
  edge blends, internal-corner blends and slot ends by measuring the solid rather than the face,
  and it fuses a split wall back into one hole by axis line. It is the best piece of recognition
  in the project. It is in the wrong place (a tool) and has a second, weaker copy in the IR.
* **fillet — no.** Only "is a torus or a cylinder", optionally under a radius bound.
* **boss — no.** Only "is a convex cylinder". A rectangular boss is invisible.
* **pocket — no.** Nothing.

`reports/CUT_FEATURE_DESIGN.md:1.6` reached the same conclusion independently and states it
plainly: *"Feature recognition — honest answer: none."* I agree with the substance and would
sharpen it: there is exactly one genuine recogniser (bores) and one genuine grouper (radial),
and neither is in the kernel library where the ops that need them live.

---

## 4. Census — HEALING and DEFEATURING

### 4.1 What exists

| capability | exists? (file:line) | reachable from IR? | user-invocable? | notes |
|---|---|---|---|---|
| sew a pile of faces into a shell | YES — `forge::heal::sewShape`, `src/Healing.cpp:366` (`BRepBuilderAPI_Sewing`) | **NO** | NO (napi `heal.sewShape`, `binding.cpp:6618`) | reports open-edge counts before/after |
| simplify / unify faces + edges | YES — `forge::heal::simplifyShape`, `src/Healing.cpp:409` (`ShapeUpgrade_UnifySameDomain`) | **YES — this is all `HEAL(%body)` does** | NO | see §4.2 |
| cap missing faces | YES — `forge::heal::autoFillMissingFaces`, `src/Healing.cpp:428` (`freeBounds` → `BRepOffsetAPI_MakeFilling` per closed wire → sew → solid) | **NO** | NO | its own header (`Healing.cpp:72`) warns it **fabricates a new patch** rather than trimming an existing surface |
| repair tolerance / self-intersection / small faces / orientation / wires | YES — `forge::heal::autoRepairSelfIntersection`, `src/Healing.cpp:550` (`ShapeFix_Shape`, DONE-bit summary) | **NO** | NO | |
| harmonise normals | YES — `forge::heal::harmonizeNormals`, `src/Healing.cpp:589` | **NO** | NO | |
| validity report | YES — `forge::heal::checkValidity`, `src/Healing.cpp:635` (`BRepCheck_Analyzer`) | partly, via `VERIFY` | NO | |
| full ShapeFix DONE1..8/FAIL1..8 log | YES — `forge::shapefix::repair`, `include/forge/ShapeFix.hpp`, `src/ShapeFix.cpp` (342 lines) | **NO** | NO | |
| defeature (remove faces, neighbours extend) | YES — `src/DirectEdit.cpp:340-360` | YES | NO | §2 |
| native (OCCT-free) light finalize | YES — `forge::occtheal::finalizeShape`, `src/native/brep/NativeShapeHeal.cpp:456` — with `freeBounds:318`, `solidFromShell:402`, `orientSolidOutward:414`, `shellOrientationConsistent:425`, `finalizeShapeCurvedSafe:539` | via the FEAT gate only | NO | 645 lines, real bodies — verified by reading |
| native heal / sew | YES — `src/native/brep/Heal.cpp` (980 lines), `Sew.cpp` (482) behind `forge::shapefix` / `forge::sewing` gates | **NO** | NO | |

### 4.2 `HEAL(%body)` is a misnomer

**READ.** `opHeal` (`FeatureTreeCompiler.cpp:1322-1326`) is three lines and calls
`forge::heal::simplifyShape(body, {})` with default options — `unifyFaces=true, unifyEdges=true,
concatBSplines=false`. So the IR's `HEAL`:

* **unifies** coincident-surface faces and edges, and
* does **nothing else**. It does not sew, does not cap a missing face, does not fix a tolerance,
  does not re-orient a normal, does not report validity.

Every one of those five capabilities exists, is implemented, is bound to napi, and is
unreachable from the one format Archie emits. GT 203's plan literally reads *"op4 heal"* after a
blade removal; the op that name resolves to would only merge faces.

`forge-kernel/docs/feature_tree_ir.md:131` documents this honestly — *"`heal::simplifyShape`
(unify faces/edges)"* — so this is a naming and coverage gap, not a hidden defect.

### 4.3 What `FORGE_SHHEAL_DROP_NATIVE` actually replaced

The brief asked specifically. **READ**, `forge-kernel/CMakeLists.txt:483-531` (option declared
at :524, **default ON**):

It routes **three OCCT classes at their `src/Healing.cpp` call sites only** onto in-house peers,
and compiles the OCCT fallback out at each:

| OCCT class | symbols | call site | native peer |
|---|---|---|---|
| `ShapeFix_Solid` | 4 | `Healing.cpp:446`, `:531` | `occtheal::orientSolidOutward` / `occtheal::solidFromShell` |
| `ShapeAnalysis_Shell` | 3 | `Healing.cpp:525-527` — *the OCCT call discarded its result* | `occtheal::shellOrientationConsistent` (strictly richer) |
| `ShapeAnalysis_FreeBounds` | 1 | `Healing.cpp:407` | `occtheal::freeBounds` |

That is **8 of TKShHealing's 20 symbols**, hence 20 → 12. What it did **not** do, in the
CMakeLists' own words:

* TKShHealing is **not** removed from `OCCT_LIBS`. The remaining 12 symbols are blocked on the
  STEP reader (`ShapeFix_Shape` ×6 at `StepReadOcct.cpp:1581`, `ShapeAnalysis_Surface` ×2,
  `ShapeAnalysis_Curve` ×1) and on a general OCCT-shape unify (`ShapeUpgrade_UnifySameDomain`
  ×3, one of which is `DirectEdit.cpp`).
* **`OCCT_CLOSURE` is 14 before and 14 after**, and would still be 14 after a *hypothetical
  complete* TKShHealing drop, because TKFillet, TKOffset, TKBO and TKBool each `DT_NEED`
  libTKShHealing. Only `OCCT_DIRECT` would move 8 → 7. The file says so itself and warns:
  *"it is NOT a drop and must not be scored as one."* I agree; I found nothing that contradicts it.
* **It does not touch this family's own healing.** `DirectEdit.cpp:69-85` — the post-boolean
  heal every one of `PUSHFACE` / `RESIZEBORE` runs — takes the native path only when
  `native::brep::forgeNativeFeaturesEnabled()` is true, and that gate **defaults OFF**
  (`src/native/brep/NativeRoute.cpp:69-75`: FEAT is its own opt-in, `FORGE_NATIVE_FEATURES`,
  not implied by `FORGE_NATIVE_BREP`). So in the production build **100% of direct-edit healing
  runs OCCT `ShapeFix_Shape`.** `forge-kernel/docs/K_TKSHHEALING_DROP_BRIEF.md:53` classes this
  exact row as an **"UNGATED BLOCKER"**.

So: the option is real, its 8-symbol claim is documented at object level, and its scope is
narrower than its name suggests — it fires without dropping its toolkit *and* without touching
the direct-modelling family at all.

---

## 5. What the `unifyFaces` guard teaches — and what it costs

`src/DirectEdit.cpp:95-198` (analysis) and `:247-261` (the fire). The shape of it is the model
this whole family should copy, and I want to be precise about which part is the lesson.

**What it does.** `ShapeUpgrade_UnifySameDomain::IntUnifyFaces` dereferences a null pcurve and
SIGSEGVs when a body carries two coaxial, equal-radius, seam-carrying cylindrical walls stored
*differently* — one analytic `Geom_CylindricalSurface`, one `Geom_SurfaceOfLinearExtrusion` of a
circle. The guard cannot pre-check for null pcurves, because the crashing input is clean
(`nullPcurves=0`, measured on it). So it detects the **configuration** instead
(`mixedCoaxialSameRadiusFaces`, `:177-194`) and, where it fires, returns the body **unmerged**.

**Five things it gets right, in order of how transferable they are:**

1. **It refuses the *operation*, never the *input*.** The body still comes back, still builds,
   still scores. Nothing downstream has to know. This is the whole difference between a guard
   and a gate, and it is why the binding constraint survives here.
2. **The failure is a CONFIGURATION, found by search, not a symptom.** The comment records the
   sweep that isolated it: r 4.4950 → SIGSEGV, 4.4900 → ok, 4.5000 → ok; crashes again at 5.0
   and 3.0 whenever the two coincide *exactly*; two coaxial equal-radius **analytic** cylinders
   merge fine. The trigger is exact radius coincidence **plus mixed representation**, and the
   second half was established by controlled comparison, not assumed.
3. **The cheaper fix was tried, measured, and rejected on evidence.** `KeepShapes` — withhold
   just the offending pair and keep every other merge — was implemented; all six crashing cases
   still SIGSEGV, because the traversal still visits a kept face and still asks it for the pcurve
   that is not there. That negative result is *in the source*, so nobody re-derives it.
4. **The dead-ish code is kept for a stated reason.** The map is retained even though the shipped
   path is a whole-shape skip, because it **names the pair** for a future targeted repair. That
   is the "name the face/edge/op so a repair loop can act" discipline, applied before there is a
   repair loop.
5. **The cost is written down.** *"That leaves a bore wall split in two, which is a face count we
   would rather not have. It is not a wrong solid."* No pretence that tolerating is free.

**MEASURED — the cost is bigger than the comment lets on, and it lands on this family.**

Controlled pair, same op, one variable (does the plate have a hole?):

| tree | raw `faceCount` | census after `unifyFaces` | kinds |
|---|---|---|---|
| `BOX(60,40,10)` → `PUSHFACE("+Z",5)` | 10 | **6** | plane 6 |
| `BOX` → `HOLE(Ø8)` → `PUSHFACE("+Z",5)` | 12 | **12 — nothing merged** | plane 6, **other 4**, cylinder 1, **other(concave, r≈4) 1** |
| `BOX` → 2×`HOLE(Ø8)` → `PUSHFACE("+Z",5)` | 14 | **14 — nothing merged** | plane 6, **other 6**, cylinder 2 |

The no-hole control merges 4 coplanar strips away; the holed case merges nothing at all, while
plainly containing two coaxial same-radius wall pieces that should merge. That is the guard
firing, and its price is not "a face count we would rather not have" — it is that **the whole
body stops being merged**.

Three consequences, all measured on the same run:

* **6 of 14 faces come back `kind:"other"`** — the four prism side walls plus the upper 5 mm of
  each bore wall (indices 10 and 11: concave, area 125.664 = 2π·4·5 each). Every selector family
  except `face:N` and `radial:` filters on `kind`, so those faces are **unaddressable by any
  predicate**.
* **`bores[].span` reports 10 on a 15 mm-deep through hole** — the tool measures only the piece
  it recognised as a cylinder.
* **`DEFEATURE` after `PUSHFACE` fails.** `BOX → 2×HOLE → PUSHFACE("+Z",5) → DEFEATURE("hole:at=15,0")`
  → *"DEFEATURE removed the selected faces but the solid is UNCHANGED (volume identical)."*
  The identical tree without the `PUSHFACE` succeeds and removes exactly π·4²·10 mm³.
  **The direct-edit ops do not compose.** None of the 20 cases in
  `test/ft/ft_unified_edit.mjs` chains two of them on one body, so nothing catches this.

**Root cause, and it is already documented elsewhere in this repo.**
`include/forge/OcctPrimBuilder.hpp:78-89` — `occtPrism(profile, vec, canonize = false)`:

> ★ DEFAULT **false** … Since the TKPrim drop every prism in the kernel has carried
> extrusion-typed laterals where OCCT emitted Planes, and faceInventory reports those as kind
> "other". Flipping this default would change the face-type census of every extrude, push/pull,
> rib, parting slab and base flange in the product at once…

`pushPullFace` calls `occtPrism(face, v)` (`DirectEdit.cpp:378`) — i.e. **un-canonized**. So the
prism's bore wall is a `Geom_SurfaceOfLinearExtrusion` of a circle, coaxial with and the same
radius as the `HOLE`'s analytic cylinder: *precisely* the guard's trigger, manufactured by our
own op. The crash guard's cost is a downstream consequence of the canonize default.

**NOT MEASURED — the falsifiable prediction.** Passing `canonize=true` at `DirectEdit.cpp:378`
should make the prism's wall analytic, remove the mixed-representation pair, let `unifyFaces`
merge, restore the `cylinder` kind, and make `PUSHFACE → DEFEATURE` compose. The test is one
argument and re-running Appendix A. The header explains why it is not a free change (it moves
the face-type census of every prism in the product), so it needs the Models-OS gate — but it is
a *far* smaller change than it looks, and this family is the reason to spend it.

**Second root cause, and this one is free.** `faceInventory`'s switch
(`DirectEdit.cpp:287-334`) has cases for Plane, Cylinder, Cone, Sphere, Torus, BSpline, Bezier,
SurfaceOfRevolution — and **no case for `GeomAbs_SurfaceOfExtrusion`**, which falls to
`default: "other"` at `:333`. `inferFeature` in the sibling file **does** handle it
(`DirectModeling.cpp:785`). The project's two face classifiers disagree about the surface type
its own prism builder emits. Adding the case (extrusion-of-line → `"plane"`,
extrusion-of-circle-along-its-axis → `"cylinder"`; the exact test already exists in
`seamWalls`, `DirectEdit.cpp:151-170`) restores *selectability* without touching one coordinate
of geometry. It is a label fix, and it is hours.

### 5.1 The one thing that is genuinely, structurally missing

`archie_edit_203` — remove 2 of 7 impeller blades. **MEASURED**: `DEFEATURE` on a fused boss is
refused with *"a whole solid protrusion (blade, boss, rib) cannot be deleted by face removal; it
has to be CUT"* — and that refusal is **correct**. `BRepAlgoAPI_Defeaturing` asks neighbours to
extend over the wound; a blade is bounded on all sides by its own faces and no neighbour can
extend across it.

`reports/CUT_FEATURE_DESIGN.md` is a full design for the missing op (`CUTFEATURE`), written
2026-07-30, status **design only**; `grep -rn 'CUTFEATURE\|CutFeature'` outside that file returns
zero hits. Its own findings, which I did not re-derive: every ingredient exists (`BRepAlgoAPI_Splitter`
is already used at `src/Mold.cpp:312` and adds **no toolkit** beyond what Cut and Defeaturing
already require; face-subset shell building exists at `DirectModeling.cpp:644-656`, wired to
keep the complement; `BRepBuilderAPI_MakeFace(surf, wire, Inside)` exists at
`DirectModeling.cpp:701-709`), and the hard part is **grouping** — deciding which faces are one
protrusion — which `faceInventory` cannot answer because it carries no adjacency.

The `radial:` selector is the one existing grouper and it *does* reach bspline blade faces. It
solves the selection half of GT 203. The removal half has no op.

---

## 6. The four questions

### 6.1 What is already built and merely unreachable? — LOUDLY, THIS IS THE CHEAPEST THING IN THE PROJECT

**Six IR ops for this family are implemented, compile, and execute in the shipped app, and no
user or Archie-trained-on-user-reachable-ops can emit them:** `PUSHFACE`, `RESIZEBORE`,
`DEFEATURE`, `TAG`, `HEAL`, `FOLD` — plus `INPUT` and `VERIFY`, without which an edit task
cannot begin or be checked. That is **8 of the 22 forbidden ops**; the other 14 (primitives,
transforms, wire) belong to the other agents' censuses.

The cost per op is one `CommandDescriptor` in `ui/src/PartCommands.cpp` plus
`python3 implementation/sacrosanct/tools/gen_op_constraint_table.py --write`. The two things
that usually make this expensive are already done:

* **A quoted face selector is already an emittable argument.** `IrArg::text` exists
  (`ui/include/forge/ui/FeatureIr.hpp:38-49`, rendered at `ui/src/FeatureIr.cpp:58`) and is
  already used by `part.fillet` and `part.chamfer` (`PartCommands.cpp:811`, `:834`), with
  `ParamType::Text` in the schema.
* **`EntityKind::Face` selection already drives commands** — `part.hole`, `part.counterbore`,
  `part.shell` all take `SelectionSignature::atLeast(EntityKind::Face, 1)`.

The one thing that does **not** exist is a **face-pick → selector-string** bridge: nothing in
`ui/` turns "the face the user clicked" into `"hole:at=21.75,0"` or `"+Z"`. It has to exist, and
it is small — `faceInventory` already returns every field a predicate needs, and
`resolveSelector` already accepts `face:N` as an escape hatch, so the first version can emit
`face:N` and be correct on the spot while a nicer predicate is derived.

Independent corroboration that this is where the value is: **D-035, 1890 of 1978 "illegal" op
uses are ops the kernel implements, blocked only by this sentence.**

### 6.2 What new IR VALUE KIND does this family require? — **NONE**

This is the family's distinguishing property and it deserves to be said plainly, because it is
what makes it cheap relative to Class-A surfacing, SubD and wireframe.

Every op here has the signature `SOLID → SOLID`. `PROFILE`, `WIRE`, `SOLID` are enough.
The vocabulary's own closure check agrees: `value_kind_closure.gaps` in
`archie_op_vocabulary.json` is `[]`.

Two near-misses that are **not** new value kinds:

* **A face selection is not a value.** It is a quoted predicate resolved against the live
  `faceInventory` at compile time (`FeatureTreeCompiler.cpp:1393-1745`), and `TAG` gives it
  persistence across renumbering. That design is *better* than a face-handle value kind, because
  a handle would go stale on exactly the ops that renumber faces — which is every edit.
* **`replaceFace` takes a surface *spec*, not a SURFACE.** `SurfaceSpec`
  (`DirectModeling.hpp:58-64`) is a tagged `{kind, origin, normal, radius}` union over
  plane/cylinder/sphere — three enum words and seven numbers, expressible as ordinary IR
  arguments. If the SURFACE value kind lands from the other agents' work, `REPLACEFACE` could
  later take one and become general; **it does not need it to become real.**

So: **this family is blocked on nothing but itself.** No other agent's landing gates it.

### 6.3 What is genuinely absent, and how long — plainly

| gap | size | why |
|---|---|---|
| UI commands for the 8 reachable ops + face-pick→selector bridge | **days** | one descriptor each, ~35 lines, against a proven pattern; the selector-string bridge can start at `face:N` |
| `faceInventory` case for `GeomAbs_SurfaceOfExtrusion` | **hours** | the exact classification test already exists ~140 lines earlier in the same file (`seamWalls`, `:128-173`); pure label change, no geometry moves |
| `canonize=true` at the push/pull prism call site | **days**, mostly gating | one argument + the Models-OS census gate the OcctPrimBuilder header demands; would likely also fix `PUSHFACE→DEFEATURE` composition |
| IR ops for the four DirectModeling primitives already in the kernel (`MOVEFACE`, `TILTFACE`, `DELETEFACE`, `REPLACEFACE`) | **days each** | ~25 lines of compiler each, mirroring `opPushFace`; the kernel functions and napi bindings already exist |
| routing the other five `forge::heal` verbs into `HEAL(%body, MODE)` | **days** | all five are implemented and napi-bound; this is argument plumbing |
| moving the bore recogniser out of `src/tools/forge_verify.cpp` into the kernel library, and deleting the duplicate in `VERIFY` | **~1 week** | two implementations of one definition is the exact defect `TopologySignature` was unified to end (`forge_verify.cpp:176-186`) |
| **`CUTFEATURE` — face group → solid → cut** | **weeks** | design exists (`reports/CUT_FEATURE_DESIGN.md`), zero implementation. Grouping is the hard half and needs adjacency `faceInventory` does not carry. Unblocks GT 203 and the whole "remove this protrusion" class |
| **true offset-face on curved faces** | **weeks–months** | local surface offset + re-trim of neighbours. Not a wrapper over anything that exists |
| **general feature recognition (pocket / slot / rib / chamfer / hole *pattern*)** | **months** | needs an adjacency graph, a concavity/loop analysis and a feature grammar. Nothing today is a starting point except the bore detector and the radial grouper |
| **native (OCCT-free) defeature** | **months** | `TKBO_BOOLEAN_STATE.md:352-388`: nothing exists to measure. Independent of the boolean sectorisation problem, so it is a *separable* win — but it is from scratch |

Nothing in the first six rows is research. Rows 7-10 are.

### 6.4 A minimal honest version

The smallest thing that makes this family **real rather than decorative** — every piece already
exists except the wiring, and each step is independently falsifiable:

1. **`part.open_step` → `INPUT()`.** Without a body there is no edit task. One command.
2. **A face pick emits a selector string.** Start with `face:N` from the existing
   `EntityKind::Face` selection; upgrade to a predicate (`+Z`, `hole:at=x,y`, `bore:r=…`) derived
   from `faceInventory` when the pick is unambiguous. This is the single missing bridge.
3. **Three commands, each `IrArg::text(selector)` on the `part.fillet` pattern:**
   `part.push_pull` → `PUSHFACE`, `part.resize_bore` → `RESIZEBORE`,
   `part.remove_feature` → `DEFEATURE`. **This alone makes GT 209 and GT 214 user-reachable and
   Archie-trainable.**
4. **Add `case GeomAbs_SurfaceOfExtrusion` to `faceInventory`.** Hours, no geometry moves, and
   without it step 3 produces bodies whose new faces cannot be selected next turn — measured
   above at 6 of 14.
5. **Emit `VERIFY` automatically after every edit command**, with the invariants the GT plans
   actually assert (bbox unchanged, other-bore count unchanged). Every one of the three retained
   GT plans ends in a do-no-harm check; the op exists and asserting is free.
6. **`part.tag_feature` → `TAG`**, so an edit sequence can name what it touched. Measured above
   to survive a `PUSHFACE`.

That is six changes, none of them research, and at the end of it the app can perform — and
Archie can emit — the two edit tasks the owner's own ground truth records, with assertions, on a
STEP file it did not build. Today it can perform zero of them.

What that version still cannot do, stated so nobody mistakes it for done: remove a blade
(`CUTFEATURE`), offset a curved face, recognise a pocket, or heal anything beyond unifying faces.

---

## Appendix A — reproduction

All rows below were produced by:

```
forge-kernel/build-fixcheck/forge_verify < cases.jsonl
```

one JSON object per line, `{"id":…, "ir":…}`, optionally `"census":"full"`. The exact trees:

```
# §1 — the forbidden ops execute
%1 = BOX(60,40,10,0,0,0)
%2 = HOLE(%1, 8, -15, 0, 0)
%3 = HOLE(%2, 8, 15, 0, 0)
%4 = VERIFY(%3, "holes=2")                     -> ok, vol 22994.690351, holes=2 PASS

%4 = DEFEATURE(%3, "hole:at=15,0")
%5 = VERIFY(%4, "holes=1")                     -> ok, vol 23497.345175, holes=1 PASS

%3 = FILLET(%2, 2, VERTICAL)                   -> ok, vol 23463.008882, faces 11
%4 = DEFEATURE(%3, "fillet:r=2")               -> ok, vol 23497.345175, faces 7   (exact restore)

%3 = RESIZEBORE(%2, "bore:max", 3.0)           -> ok, vol 23717.256661, bore r=3
%3 = RESIZEBORE(%2, "bore:max", 6.0)           -> ok, vol 22869.026645, bore r=6
%3 = PUSHFACE(%2, "+Z", 5.0)
%4 = VERIFY(%3, "bbox.z=15")                   -> ok, vol 35246.017763, PASS
%2 = PUSHFACE(%1, "+Z", -3.0)                  -> ok, vol 16800
%3 = HEAL(%2)                                  -> ok

# FOLD, on a 60x40x2 plate, hinge on the +Y edge running +X
%2 = FOLD(%1, -30,20,0, 60,15,2, 90, 0)        -> ok, vol 6360, bodies 1, bbox.z 15
%2 = FOLD(%1, -30,20,0, 60,15,2,  0, 0)        -> ok, vol 6600 = 4800+1800, bodies 1
# A hinge placed OFF the plate (e.g. hx=60 on a plate whose x-max is 30) yields two
# disjoint bodies -- correct for that input, and the first thing I got wrong here.

# TAG survives a boolean-based direct edit
%4 = TAG(%3, "@left", "hole:at=-15,0")         -> "TAG @left -> cylinder face 7"
%5 = PUSHFACE(%4, "+Z", 5.0)
%6 = RESIZEBORE(%5, "@left", 3.0)              -> ok, bores r=3 @(-15,0), r=4 @(15,0)

# §5 — the guard's cost (add "census":"full")
%2 = PUSHFACE(%1, "+Z", 5.0)                   [no hole]  raw 10 -> census 6,  plane 6
%3 = PUSHFACE(%2, "+Z", 5.0)                   [1 hole]   raw 12 -> census 12, other 5 + cyl 1 + plane 6
%4 = PUSHFACE(%3, "+Z", 5.0)                   [2 holes]  raw 14 -> census 14, other 6 + cyl 2 + plane 6

# §5 — the ops do not compose
%4 = PUSHFACE(%3, "+Z", 5.0)
%5 = DEFEATURE(%4, "hole:at=15,0")
   -> FAIL op %5: "DEFEATURE removed the selected faces but the solid is UNCHANGED"
      (identical tree without %4 succeeds)

# §5.1 — DEFEATURE correctly refuses a protrusion
%2 = CYL(6,8,0,0,10,0,0,1)
%3 = FUSE(%1,%2)
%4 = DEFEATURE(%3, "boss:max")
   -> FAIL: "...a whole solid protrusion (blade, boss, rib) cannot be deleted by face
      removal; it has to be CUT."
```

Ground-truth censuses were read directly from the owner's logs and re-counted:

```
archie_edit_214 INPUT  faceCount 430 = cylinder 167, torus 125, bspline 67, sphere 25, cone 4, plane 42
archie_edit_214 OUTPUT faceCount 431 = cylinder 166, torus 125, bspline 67, sphere 25, cone 4, plane 44
archie_edit_209 INPUT  faceCount 118 ;  OUTPUT faceCount 185, histogram includes "other": 2
archie_edit_203 INPUT  faceCount 156 = bspline 125, torus 14, sphere 7, cylinder 8, plane 2 ; OUTPUT 140
```

Two derived figures, arithmetic only:

* On 214's input, the **kind-filtering** selector predicates (`+Z`, `plane:*`, `bore/hole`,
  `boss/shaft`, `fillet/blend`) can only name `cylinder + torus + plane` = **334 of 430 = 77.7%**;
  the 67 bspline + 25 sphere + 4 cone faces (**22.3%**) are of kinds no such predicate mentions.
  The `radial:`/`blade:` branch is kind-agnostic and is the only way to reach them.
* On 203's input the kind-filtering predicates reach **24 of 156 = 15.4%**. The 125 bspline blade
  faces are reachable *only* through `radial:`. This is why that one selector matters far more
  than its 100 lines suggest.

## Appendix B — claims I could NOT verify

* I did not build the kernel. Everything executed used a pre-existing binary,
  `forge-kernel/build-fixcheck/forge_verify` (2026-08-29 15:11), and I did not establish which
  CMake options it was configured with. The FEAT gate (`FORGE_NATIVE_FEATURES`) was unset in my
  environment, which is its documented default.
* I did not run `test/ft/ft_unified_edit.mjs` or `test/directedit.mjs` (they need a built
  `forge.node`). Their **content** I read; their pass counts (20/20, 9/9) and the symbol-probe
  boolean tallies are **CITED** from `reports/TKBO_BOOLEAN_STATE.md:369-378`, not re-measured.
* I did not reproduce the `unifyFaces` SIGSEGV itself. My equal-radius mixed-representation
  attempt (`HOLE(Ø9)` then `CIRCLE(4.5)+EXTRUDE+CUT`) built cleanly to 7 faces. What I measured
  is the guard's **effect** — merging withheld on the `PUSHFACE`-over-a-hole body — established
  by the no-hole control, not the crash.
* `canonize=true` at `DirectEdit.cpp:378` is a **prediction**, not a result. Not tested.
* The `FORGE_SHHEAL_DROP_NATIVE` object-level claim (8 OCCT symbols in Healing.cpp.o with the
  option off, 0 with it on) is **CITED** from `CMakeLists.txt:506-508`. I did not run `nm`.
* OCCT closure numbers (`OCCT_CLOSURE` 14, `OCCT_DIRECT` 8→7) are **CITED** from
  `CMakeLists.txt:517-523` and `reports/OCCT_CLOSURE_TRUTH.md`. I did not run `otool`.
