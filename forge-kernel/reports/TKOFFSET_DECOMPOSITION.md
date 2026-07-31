# TKOffset — decomposition analysis (2026-07-30)

**Read-only. No file under `forge-kernel/src` or `forge-kernel/include` was created,
modified or deleted.** `src/native/brep/NativeFilletChamfer.cpp` and
`src/ft/FeatureTreeCompiler.cpp` were **read only**, never written.

Every number below was measured on this machine against the built artifact
`build/Release/forge-kernel.node`, the 832 object files under `build/CMakeFiles/`,
and the 67 OCCT dylibs in `/opt/homebrew/opt/opencascade/lib`. Where a doc — including
`reports/OCCT_ZERO_NEXT_STEP_2026-07-30.md` and `CMakeLists.txt`'s own comments —
disagrees with the code or the binary, **the measurement wins and I say so explicitly**
(§7).

Baseline re-confirmed before and after this analysis:

```
otool -L build/Release/forge-kernel.node | grep -c opencascade   -> 8
node test/ft/ft_unified_edit.mjs   -> 20 passed
node test/directedit.mjs           -> 9/9 DirectEdit tests passed
node test/ft/ft_smoke.mjs          -> ===== ALL PASS =====
```

---

## 0. Executive answer

TKOffset is **not one algorithm**. It is 9 unrelated classes whose symbol sets are
**almost perfectly disjoint** — 7 of the 9 own a private vtable, one (`BRepOffset_MakeOffset`)
references none, and exactly one pair (`MakeThickSolid` / `MakeOffsetShape`) shares a
single symbol. Object-file attribution confirms the split is clean at the source level
too: 7 `.cpp` files, and no symbol that two families both need except that one vtable.

So the toolkit **does decompose**. But decomposition buys a *smaller blocking set*, not
a link-record drop: `otool` moves 8 → 7 only at 42/42. The honest way to read this report
is as a **queue of 9 independently-shippable, independently-gateable increments** (§5),
each needing exactly one bounded new capability — with one exception, family **F**
(guided pipe-shell sweep), which has no native engine anywhere in the tree and is the
one genuine wall.

The best first increment is **G + H** (`MakeThickSolid` + `MakeOffsetShape`): **6 of the
42 symbols, 14%**, sharing one geometric capability, five existing gates, and the weakest
OCCT incumbent in the toolkit (§4).

Three findings change the ordering the 07-30 report proposed:

1. **TKFillet-first buys zero closure.** Measured: dropping TKFillet alone takes the
   direct count 8 → 7 but the **true load closure 14 → 14** — TKOffset `DT_NEED`s
   TKFillet, so the process still loads it. Dropping **TKOffset** alone takes the
   closure **14 → 13**. Of the three leaf toolkits, TKOffset is the only one whose
   removal reduces the closure at all (§6).
2. **The ThickSolid capability being defended is much weaker than the ledger implies.**
   The lofted-volute claim reproduces and is worse than stated — **0/10** on the volute
   directly and **0/12** across the whole `pump_housing` (lofted-volute) family, i.e.
   **0/22** (§4.1). Corpus-wide the open-face rate is **66%** (95/143, 95% CI 58–74%), and **0/12 on every LOFT-bearing tree** (§4.3), and the
   closed-hollow mode is not a working capability at all — on a plain box it returns the
   *cavity* (512) instead of the *wall* (488) with `IsDone() == true` (§4.2). The
   purpose-written replacement `NativeThickSolid.cpp` (299 L, TKOffset-free by
   construction) **is not in `CMakeLists.txt` and has never been compiled with its body
   enabled** (§4.4) — though it needs quadric-face support before it can replace
   anything real (§5).
3. **None of the three Law-10 gates touches TKOffset at all** (§3.5). The mandated
   gate chain would stay green through a change that deleted all 42 symbols *and*
   silently broke every loft, sweep, shell, draft and cap-fill in the kernel. Any
   TKOffset work needs its own gate list before it needs a build.

---

## 1. The 42 symbols, grouped by algorithm family

Method: `nm -u` on the `.node` → 788 undefined symbols; `nm -gU` on
`libTKOffset.7.9.dylib` → 727 exports; intersection = **42** (matches the 07-30 report
exactly). Attribution to source is not inferred from `grep` — it is `nm -u` on each of
the 832 built object files, intersected with the 42.

**Exclusivity, measured across all 67 installed OCCT toolkits:** every one of the 42 is
exported by **TKOffset and by nothing else**. There is no alternative provider and no
"already linked elsewhere" shortcut for any family (§7.2 corrects `CMakeLists.txt` on
this point).

| # | Family | Class | Syms | Sites | Files |
|---|---|---|---:|---:|---:|
| A | 2-D contour offset | `BRepOffsetAPI_MakeOffset` | 4 | 1 | 1 |
| B | free-wire cap synthesis (N-sided filling) | `BRepOffsetAPI_MakeFilling` | 5 | 1 | 1 |
| C | draft / mould taper | `BRepOffsetAPI_DraftAngle` | 6 | 1 | 1 |
| D | N-section loft | `BRepOffsetAPI_ThruSections` | 6 | 5 | 4 |
| E | translational pipe sweep | `BRepOffsetAPI_MakePipe` | 3 | 3 | 1 |
| F | guided pipe-shell sweep | `BRepOffsetAPI_MakePipeShell` | 7 | 3 | 2 |
| G | hollow / shell (thick solid) | `BRepOffsetAPI_MakeThickSolid` | 3 | 3 | 1 |
| H | whole-solid grow/shrink offset | `BRepOffsetAPI_MakeOffsetShape` | 2 | 1 | 1 |
| — | *shared:* `vtable for BRepOffsetAPI_MakeOffsetShape` | (G ∩ H) | 1 | — | — |
| I | open-shell thicken (low-level engine) | `BRepOffset_MakeOffset` | 5 | 1 | 1 |
| | **total** | | **42** | **19** | **7** |

*(The 07-30 report says "~17 live call sites". The measured count is **19** — it
undercounts `MakePipe` and `MakeThickSolid`, each of which has 3 construction sites in
`Features.cpp`, not 1. §7.1.)*

### The G/H vtable coupling — measured, not assumed

`BRepOffsetAPI_MakeThickSolid` derives from `BRepOffsetAPI_MakeOffsetShape` and has
**no vtable of its own** in the undefined set. Two minimal translation units compiled
against OCCT 7.9 headers prove the coupling:

```
TU using ONLY MakeThickSolid  -> MakeThickSolidByJoin, Build, ctor, vtable for BRepOffsetAPI_MakeOffsetShape
TU using ONLY MakeOffsetShape -> PerformByJoin, ctor,          vtable for BRepOffsetAPI_MakeOffsetShape
```

Therefore: **G alone removes 3; H alone removes 2; G+H together remove 6.** The shared
vtable only leaves when both go. Every other family is fully self-contained (verified
the same way for A, C, D, E, F, I; B by object-file attribution).

### 1.A — 2-D contour offset (4 symbols)

`BRepOffsetAPI_MakeOffset::{ctor(Wire,JoinType,bool), Init, Perform}` + vtable.

| site | function | native attempt above it |
|---|---|---|
| `src/Cam.cpp:309` | `forge::cam::inwardOffset` — inward offset of a closed planar toolpath wire | **yes**, `src/Cam.cpp:301` `tryNativeInwardOffset` behind `forgeNativeFeaturesEnabled()` |

### 1.B — free-wire cap synthesis (5 symbols)

`BRepOffsetAPI_MakeFilling::{Add(Edge,GeomAbs_Shape,bool), Build, ctor(10-arg), IsDone}` + vtable.

| site | function | native attempt above it |
|---|---|---|
| `src/Healing.cpp:420` | `forge::heal::autoFillMissingFaces` — fabricate an N-sided cap over each closed free-boundary wire, then sew | **no** — `Healing.cpp`'s two native gates are at `:342` and `:479`; `autoFillMissingFaces` (`:400-445`) has none |

`src/DirectModeling.cpp:14` `#include <BRepOffsetAPI_MakeFilling.hxx>` is a **dead
include** — the only other mention in that file is the comment at `:102`, and
`DirectModeling.cpp.o` carries **zero** TKOffset symbols.

### 1.C — draft / mould taper (6 symbols)

`BRepOffsetAPI_DraftAngle::{Add(Face,Dir,double,Pln,bool), Build, Remove, ctor, AddDone}` + vtable.

| site | function | native attempt above it |
|---|---|---|
| `src/Features.cpp:1898` | `forge::part::draftFaces` | **yes, two** — `Features.cpp:1791` (FEAT gate + `NativeSolid`) → analytic `draftBoxAnalytic` (`DraftAnalytic.cpp`), else mesh-bridge `applyDraft` (`Draft.cpp`) at `:1860` |

### 1.D — N-section loft (6 symbols)

`BRepOffsetAPI_ThruSections::{ctor(bool,bool,double), AddWire, AddVertex, CheckCompatibility, Build}` + vtable.
`AddVertex` is referenced only from `Primitives.cpp` and `LoftGuide.cpp`.

| site | function | native attempt above it |
|---|---|---|
| `src/Features.cpp:906` | `forge::part::loft` | **yes**, `:864` FEAT gate → native stacked loft |
| `src/Features.cpp:2465` | `forge::part::loftWithGuides`, no-guides branch | **no** |
| `src/Airfoil.cpp:624` | `forge::airfoil::loftWing` | **yes**, `:597` FEAT gate |
| `src/Primitives.cpp:186` | `forge::makePyramid` OCCT fallback | **yes**, `:172` `forgeNativeBrepEnabled()` → `buildPyramid` (**default ON**, so this site is already dark in production) |
| `src/LoftGuide.cpp:194` | `forge::loftguide::loft` — **the target of the Unified-IR `LOFT` op** (`FeatureTreeCompiler.cpp:685`) | **yes but inert**, `:179` FEAT gate → `tryNativeLoftGuide`, whose `nativeSectionsOf` (`LoftGuide.cpp:124-131`) **returns `false` unconditionally**: there is no OCCT-wire → native-`LoftSection` importer, so this path defers on 100% of inputs even with the gate on |

### 1.E — translational pipe sweep (3 symbols)

`BRepOffsetAPI_MakePipe::{ctor(Wire,Shape), Build}` + vtable.

| site | function | native attempt above it |
|---|---|---|
| `src/Features.cpp:672` | `forge::part::sweep`, unguided branch | **yes**, `:633` (`!withGuides && forgeNativeFeaturesEnabled()`) |
| `src/Features.cpp:740` | `forge::part::pipeFromPolyline` | **no** |
| `src/Features.cpp:835` | `forge::part::sweepPolyline` | **no** |

### 1.F — guided pipe-shell sweep (7 symbols)

`BRepOffsetAPI_MakePipeShell::{ctor(Wire), Add(Shape,bool,bool), SetMode(bool), SetMode(Wire,bool,BRepFill_TypeOfContact), MakeSolid, Build}` + vtable.
`SetMode(bool)` (Frenet framing) is referenced **only** from `ClassASurfacing.cpp`.

| site | function | native attempt above it |
|---|---|---|
| `src/Features.cpp:683` | `forge::part::sweep`, guided branch | **no** (the `:633` gate excludes `withGuides`) |
| `src/Features.cpp:2414` | `forge::part::sweepWithGuides` | **no** |
| `src/ClassASurfacing.cpp:715` | `forge::classa::sweepWithGuides` (Frenet + curvilinear-equivalence guides) | **no** — `ClassASurfacing.cpp` has no `forgeNative*Enabled()` call anywhere |

### 1.G — hollow / shell (3 symbols + ½ of the shared vtable)

`BRepOffsetAPI_MakeThickSolid::{ctor, MakeThickSolidByJoin, Build}`.

| site | function | native attempt above it |
|---|---|---|
| `src/Features.cpp:967` | `forge::part::shell` — **the target of the Unified-IR `SHELL` op** (`FeatureTreeCompiler.cpp:958`) | **yes**, `:939` FEAT gate + `NativeSolid` kind + `multiThickness.empty()` → `shellSolid` (`Shell.cpp`) |
| `src/Features.cpp:2556` | `forge::part::shellMultiThickness`, base pass | **no** |
| `src/Features.cpp:2587` | `forge::part::shellMultiThickness`, per-face override pass | **no** |

### 1.H — whole-solid grow/shrink offset (2 symbols + ½ of the shared vtable)

`BRepOffsetAPI_MakeOffsetShape::{ctor, PerformByJoin}`.

| site | function | native attempt above it |
|---|---|---|
| `src/Features.cpp:1081` | `forge::part::offsetSolid` | **yes**, `:1042` FEAT gate + `NativeSolid` + **all-faces-planar** → `offsetSolidShape` (`OffsetShape.cpp`) |

### 1.I — open-shell thicken (5 symbols, no vtable)

`BRepOffset_MakeOffset::{ctor, Initialize, MakeThickSolid, Shape, IsDone}` — the
**low-level engine class**, not a `BRepOffsetAPI_` wrapper.

| site | function | native attempt above it |
|---|---|---|
| `src/Features.cpp:1002` | `forge::part::thickenSurface` — skin an **open shell** into a closed solid | **no** |

---

## 2. Per-family: does a native implementation exist in `src/native/brep/` today?

"Exists" is split three ways, because the distinction is the whole cost model:
**BUILT** (compiled into the kernel), **WIRED** (called from the OCCT site), and
**COVERS** (accepts an arbitrary `TopoDS_Shape`, which is what a drop requires).

| Fam | Syms | Sites | Native engine | Built? | Wired? | Accepts arbitrary `TopoDS_Shape`? |
|---|---:|---:|---|---|---|---|
| A | 4 | 1 | `src/native/geom/PolygonOffset2D.cpp` (604 L) | ✅ | ✅ `Cam.cpp:301`, FEAT-gated | **partial** — straight-segment wires only; defers on any non-`GeomAbs_Line` edge (`Cam.cpp:238`) |
| B | 5 | 1 | `SurfaceFill.cpp` (840 L Coons/bicubic), `GregoryFill.cpp` (904 L n-sided Gregory G2) | ✅ | ❌ | **no** — both consume a prescribed boundary-curve set, neither is wired to a free-wire pipeline |
| C | 6 | 1 | `DraftAnalytic.cpp` (241 L), `Draft.cpp` (344 L) | ✅ | ✅ `Features.cpp:1791` | **no** — analytic path is canonical-box-only; mesh path needs a `NativeSolid` handle |
| D | 6 | 5 | `LoftSweep.cpp` (407 L `loftSolid`, analytic), `Loft.cpp` (281 L, mesh) | ✅ | ✅ ×4, but `LoftGuide` seam is inert | **no** — needs `LoftSection` polygon rings; **no OCCT-wire → native-section importer exists** (`LoftGuide.cpp:124-131`) |
| E | 3 | 3 | `Sweep.cpp` (684 L, mesh), `HelicalSweep.cpp` (360 L), `LoftSweep.cpp::sweepSolid` | ✅ | ✅ 1 of 3 sites | **no** — polyline spine only (`Sweep.hpp:15`) |
| F | 7 | 3 | **none** | — | — | **no** — `LoftSweep.hpp:55` names guide-rail sweep as explicitly outside the increment |
| G | 3 | 3 | `Shell.cpp` (549 L `shellSolid`, `NativeSolid`-typed) **and** `NativeThickSolid.cpp` (299 L `occtoffset::makeThickSolid`, `TopoDS_Shape`-typed) | `Shell.cpp` ✅ / **`NativeThickSolid.cpp` ❌ NOT BUILT** | `Shell.cpp` ✅ `Features.cpp:939`; `NativeThickSolid.cpp` ❌ **zero references in `src/`** | **`NativeThickSolid.cpp` is the only file in the tree that does** — planar/prismatic faces, ≥1 opening (§4.4) |
| H | 2 | 1 | `OffsetShape.cpp` (470 L) | ✅ | ✅ `Features.cpp:1042` | **no** — `NativeSolid` + **all-planar** only; quadric offset is volume-exact but mis-placed along its axis, so it is honestly deferred |
| I | 5 | 1 | **none** | — | — | **no** — `Shell.cpp` hollows a *closed* solid, `OffsetShape.cpp` offsets a *closed* solid; neither skins an *open* shell |

**Cross-cutting:** the runtime gate for every wired path above is
`forgeNativeFeaturesEnabled()`, which is **default OFF**
(`src/native/brep/NativeRoute.cpp:69-75`, opt-in via `FORGE_NATIVE_FEATURES`). In the
shipped kernel, **all 19 TKOffset call sites execute the OCCT branch.** Every "wired"
✅ above is dark in production.

---

## 3. What a drop actually costs, and what proves it

### 3.1 There is no per-family `#ifdef` scaffold

TKOffset is appended unconditionally at `CMakeLists.txt:161-166`. Unlike TKFillet
(`CMakeLists.txt:182-190`, `FORGE_FILLET_DROP_NATIVE`), **no drop option exists** and no
call site is `#ifdef`-guarded. Every family therefore needs, in order: (1) a native
routine that accepts the call site's actual argument type, (2) the OCCT branch under
`#else`, (3) a CMake option, (4) evidence.

### 3.2 The interchange-type problem is the real cost, not the geometry

Seven of the nine families (all but **F** and **I**) already have a native engine
written, built, and correct on its own domain. What blocks them is not the algorithm — it is that every one of the 19 call
sites hands over a `TopoDS_Shape` / `TopoDS_Wire`, and the engines consume
`native::brep::Solid` or `mesh::HalfEdgeMesh`. This is exactly the K7 opaque-handle
problem the 07-30 report identifies in §1c, arriving one layer earlier.

The exception is instructive: `NativeThickSolid.cpp` was written specifically to be
`TopoDS_Shape`-typed and TKOffset-free (`NativeThickSolid.hpp:33-38`). It is the
template for how the other eight should be shaped — and it is the one file that was
never added to the build.

### 3.3 Symbols removed ≠ link record removed

`otool` counts `LC_LOAD_DYLIB` records. Removing 39 of 42 symbols leaves the count at
8. **Only 42/42 moves it.** Per-family progress is therefore measured by
`nm -u build/Release/forge-kernel.node | c++filt | grep -c '<class>'` → 0, not by
`otool`. Recommend adding a per-class counter to the ledger.

### 3.4 ★ Only 3 of the 9 families are reachable from the Unified IR

The IR opcode table is `src/ft/FeatureTreeCompiler.cpp:118-139`. Exactly three opcodes
reach TKOffset:

| IR op | routes to | family | symbols behind it |
|---|---|---|---:|
| `LOFT` | `forge::loftguide::loft` (`FeatureTreeCompiler.cpp:667-685`) → `LoftGuide.cpp:194` | **D** | 6 |
| `SWEEP` | `part::pipeFromPolyline` / `part::sweepPolyline` (`:701, :709`) → `Features.cpp:740, 835` | **E** | 3 |
| `SHELL` | `forge::part::shell` (`:957`) → `Features.cpp:967` | **G** | 3 |

**12 of the 42 symbols are reachable from the IR. The other 30 sit behind JS-only
bindings** (`src/binding.cpp:6494-6515`) that the model never emits: `thickenSurface`,
`offsetSolid`, `draftFaces`, `sweepWithGuides`, `loftWithGuides`, `shellMultiThickness`,
plus `cam::inwardOffset` and `heal::autoFillMissingFaces`. Family **F**
(`MakePipeShell`, 7 symbols — the hardest of the nine) is **not reachable from the
Unified IR at all**: `opSweep` deliberately routes around `part::sweep` because
"`part::sweep` collapses when profile+path are coplanar"
(`FeatureTreeCompiler.cpp:689`, routing at `:701` / `:709`).

This matters for scheduling: per Sacrosanct §2 the deliverable is Archie → Unified IR →
kernel, so IR-reachable capability is load-bearing and JS-only capability is API-surface
parity. It does **not** license deleting the JS-only ones (Law 9), but it does say which
regressions would be felt first.

### 3.5 ★ The mandated Law-10 gate chain does not test TKOffset at all

| gate | IR ops / APIs it exercises | TKOffset families touched |
|---|---|---|
| `test/ft/ft_unified_edit.mjs` | BOX CBORE CYL DEFEATURE HOLE INPUT PUSHFACE RESIZEBORE TAG VERIFY | **none** |
| `test/directedit.mjs` | DirectEdit only | **none** |
| `test/ft/ft_smoke.mjs` | BOX CUT CYL EXTRUDE FILLET FUSE HOLE RECT RRECT TRANSLATE | **none** |

All three pass today (§0) and would pass unchanged if all 42 symbols were deleted and
every loft/sweep/shell/draft/cap-fill broke. They are necessary, not sufficient — the
same relationship `reports/KERNEL_DROP_MASTER_PLAN.md:45` asserts for Models-OS 13/13.

The gates that **do** cover each family, and which must be added to the chain for any
TKOffset work:

| Fam | JS/e2e coverage | pure-C++ native gate (`test/native/`) |
|---|---|---|
| A | `test/cam_smoke.js`, `cam_adaptive_smoke.js`, `cam_5axis_smoke.js`, `cam_stock_smoke.js`, `cam_cmm_smoke.js` | — |
| B | `test/healing_smoke.js` | `surface_fill_test.cpp`, `gregory_fill_test.cpp` |
| C | `test/part_features_smoke.js`, `native_vs_occt_core.mjs`, `native_analytic_chamfer_draft_ab.mjs` | `draft_test.cpp`, `draft_analytic_test.cpp` |
| D | `test/part_features_smoke.js`, `airfoil_smoke.js`, `smoke.js`, `native_vs_occt_core.mjs` | `loft_test.cpp`, `loftsweep_test.cpp` |
| E | `test/part_features_smoke.js`, `pipe_route_smoke.js`, `native_vs_occt_core.mjs` | `sweep_test.cpp`, `helical_sweep_test.cpp`, `native_sweep_analytic_test.cpp` |
| F | `test/part_features_smoke.js`, `push07_classa_smoke.js` | **none** |
| G | `test/part_features_smoke.js`, `native_vs_occt_features_gap1.mjs` | `shell_solid_test.cpp`, `shell_faceid_test.cpp`, `open_face_shell_test.cpp` |
| H | `test/native_analytic_offset_ab.mjs` | `offset_shape_test.cpp` |
| I | `test/thicken_surface_smoke.js`, `knit_surface_smoke.js` | **none** |

`loftguide.loft`, `classa.sweepWithGuides`, `part.sweepPolyline` and `cam::inwardOffset`
have **no dedicated JS test** — grep across `test/` returns zero files naming them.
`loftguide.loft` is the IR `LOFT` target, so it is exercised indirectly by any
LOFT-bearing tree, but not by an assertion that names it.

---

## 4. ★ The ThickSolid claim, verified by running it

### 4.1 The lofted volute — claim reproduces, and is worse than stated

**First, a correction to the premise.** The task states that "`SHELL` appears in some" of
`data/forge/complex_all.jsonl`. It does not. Measured over all 1,613 trees:

| IR op | occurrences | rows containing |
|---|---:|---:|
| `LOFT` | 200 | 100 (all `pump_housing`) |
| `SHELL` | **0** | **0** |
| `SWEEP` / `DRAFT` / `THICKEN` / `OFFSET` / `REVOLVE` | **0** | **0** |

(For reference the corpus is built from `HOLE` 6666, `CYL` 5669, `FUSE` 4334, `CUT` 2814,
`PATTERN` 2714, `BOX` 2193, `CBORE` 1790, `ROTATE` 1493, `EXTRUDE` 699, `TRANSLATE` 687,
`RING` 600, `RRECT` 400, `POLY` 299, `FOLD` 286, `CHAMFER` 233, `LOFT` 200, `FILLET` 162.)

So **the only TKOffset family the corpus exercises as-authored is D (`ThruSections`)**,
via `LOFT`, on 100 of 1,613 trees — and since all 1,613 are kernel-verified, ThruSections
demonstrably *works* on all 100. `SHELL` is never emitted, so §4.3 measures ThickSolid by
*applying* it to each corpus solid rather than by replaying authored SHELL ops.


Harness: `scratchpad/tkoffset/volute_shell.mjs` (session scratchpad, outside the repo).
Subject: `cx_00000` of the `pump_housing` family — *"centrifugal pump housing, Ø187.6 ×
53.5 mm **volute**, 8.5 mm wall"* — its IR built through `forge.ft.compile`, then
`forge.part.shell`, i.e. `Features.cpp:967` `MakeThickSolidByJoin`.

```
-- A1: LOFT-ONLY volute body (%1..%4), open face on +Z --
  w=8.5  FAIL  faces=50 -> forge.part.shell: ThickSolid build failed  (18 ms)
  w=4.0  FAIL  faces=50 -> forge.part.shell: ThickSolid build failed  (19 ms)
  w=2.0  FAIL  faces=50 -> forge.part.shell: ThickSolid build failed  (23 ms)
  w=1.0  FAIL  faces=50 -> forge.part.shell: ThickSolid build failed  (23 ms)
-- A2: LOFT-ONLY volute, open face on -Z --
  w=8.5  FAIL  faces=50 -> forge.part.shell: ThickSolid build failed  (17 ms)
  w=2.0  FAIL  faces=50 -> forge.part.shell: ThickSolid build failed  (19 ms)
-- A3: FULL volute (loft - loft + suction flange + bore), open face on +Z --
  w=8.5  FAIL  faces=104 -> forge.part.shell: ThickSolid build failed (23 ms)
  w=4.0  FAIL  faces=104 -> forge.part.shell: ThickSolid build failed (23 ms)
  w=2.0  FAIL  faces=104 -> forge.part.shell: ThickSolid build failed (22 ms)
  w=1.0  FAIL  faces=104 -> forge.part.shell: ThickSolid build failed (28 ms)

EXPERIMENT A RESULT: 0/10 ThickSolid attempts succeeded on the lofted volute
CONTROL (box 40³, 2 mm wall, open top): OK vol=14752.000  == 40³ − 36·36·38 exactly
```

**Verdict: the claim is CONFIRMED and understated.** Not 4/4 — **0/10**, across two
open-face choices, four wall thicknesses, and both the bare loft body and the full
volute. The failure is instant (17–28 ms), i.e. OCCT rejects it structurally rather
than timing out. The control proves the harness and the op are sound: a box shells to
its exact closed-form volume.

### 4.2 What ThickSolid actually does on a box — and where it silently lies

Before quantifying the corpus, the baseline must be pinned, because the sign convention
matters and because one of the two modes returns a **wrong answer without failing**.

All four measurements below take the OCCT branch — verified: `f.kindOf(result) == 'occt'`,
because `forgeNativeFeaturesEnabled()` is off (`FORGE_NATIVE_FEATURES` unset), so
`Features.cpp:939`'s native shell is skipped and `Features.cpp:967`
`MakeThickSolidByJoin` runs. Box 10³, wall 1 mm:

| `thickness` arg | faces removed | OCCT result | correct answer | verdict |
|---|---|---:|---:|---|
| `-1.0` (**the IR convention**, `FeatureTreeCompiler.cpp:957` passes `-|w|`) | top face | **424.00000** | 424 = 10³ − 8·8·9 | ✅ exact |
| `-1.0` | none (closed hollow) | **512.00000** | 488 = 10³ − 8³ | ❌ **silently returns the cavity (8³), not the wall** |
| `+1.0` | top face | 564.92625 | 584 = 12·12·11 − 10³ | outward convention, ≈ but not exact at the rim |
| `+1.0` | none (closed hollow) | **−1698.43657** | 488 | ❌ negative volume, `IsDone() == true` |

Two facts follow, and both bound the corpus numbers in §4.3:

1. **The open-face mode is exact on simple geometry.** ThickSolid is not broken
   everywhere — it is broken on *complex* geometry. A rate below 100% therefore measures
   real fragility, not a harness artefact.
2. **The closed-hollow mode is not a working capability at all.** It returns
   `IsDone() == true` with either a negative volume or the *inner block* rather than the
   wall. The kernel's own gate already says so —
   `test/native_vs_occt_features_gap1.mjs:120-123`: *"OCCT's `BRepOffsetAPI_MakeThickSolid`
   CANNOT produce a fully enclosed void from an empty removed-face set … so OCCT is NOT a
   valid reference here"* — and that gate consequently scores shell `vs-analytic`, never
   `vs-occt`. Running it now:

   ```
   shell closed box(10) t=1    vs-analytic  occtVol=-1698.43657  natVol=488.00000  ref=488  PASS
   shell open-top box(10) t=1  vs-analytic  occtVol=  564.92625  natVol=424.00000  ref=424  PASS
   [gap1] shell  NATIVE-VERIFIED  (2/2 cases pass)
   ```

   The native analytic `shellSolid` already produces the correct 488 and 424. **The
   kernel has already concluded that OCCT is the wrong answer for shell and written the
   replacement.** It just never wired it for `TopoDS_Shape` inputs (§4.4).

**Consequence for the "closed" column in §4.3:** I score it as *"returned a positive
volume"*, which on the box evidence is a strict **over**-count of correctness. Treat it
as an upper bound, not a success rate.

### 4.3 Corpus-wide ThickSolid success rate

**Method.** `scratchpad/tkoffset/corpus_shell_strat.mjs`. Stratified sample of the 1,613
kernel-verified trees in `archdisc-Models/data/forge/complex_all.jsonl`: the first 12 rows
of **every** family (tube_sheet drew 36 from an earlier wider pass), **n = 143 across all
10 families**. Per row: compile the tree's IR with `forge.ft.compile`, pick the open face
with the *same* heuristic `FeatureTreeCompiler::opShell` uses (largest face whose outward
normal aligns with +Z), then call `forge.part.shell` at
`wall = clamp(3% × min-bbox-extent, 0.5, 5) mm` with the **negative** sign the IR path
uses. Both modes attempted: open-face, and closed-hollow (no face removed).

Scoring is deliberately generous: **"built" means `IsDone()` and `massProps.volume > 0`.**
It does *not* check the wall volume is right. Per §4.2 that makes these numbers an
**upper bound** on correctness — decisively so for the closed column.

| family | n | IR compiled | **open-face shell built** | closed-hollow returned +vol |
|---|---:|---:|---:|---:|
| `bearing_housing` | 12 | 12/12 | **0/12** = 0% | 0/12 |
| `pump_housing` **(the LOFT / volute family)** | 12 | 12/12 | **0/12** = 0% | 0/12 |
| `manifold_block` | 11 | 11/11 | **5/11** = 45% | 0/11 |
| `ribbed_bracket` | 12 | 12/12 | **8/12** = 67% | 10/12 |
| `sheet_chassis` | 12 | 12/12 | **8/12** = 67% | 4/12 |
| `valve_body` | 12 | 12/12 | **9/12** = 75% | 1/12 |
| `multilevel_housing` | 12 | 12/12 | **10/12** = 83% | 2/12 |
| `tube_sheet` | 36 | 36/36 | **31/36** = 86% | 26/36 |
| `stepped_shaft` | 12 | 12/12 | **12/12** = 100% | 7/12 |
| `bolted_cover` | 12 | 12/12 | **12/12** = 100% | 12/12 |
| **pooled** | **143** | **143/143** | **95/143 = 66%** | 62/143 = 43% |
| **unweighted mean of the 10 families** | | | **62%** | |

**Open-face pooled rate 66%, 95% Wilson CI 58–74%.**

Failure modes:

```
open-face   : 46 × "forge.part.shell: ThickSolid build failed"   (hard, loud)
               2 × IsDone()==true with a non-positive volume     (silent)
closed      : 28 × "ThickSolid build failed"
              53 × IsDone()==true with a non-positive volume     (silent)
```

Five things this establishes:

1. **The volute result is not a one-part anomaly — it is the whole family.** Every
   `pump_housing` tree, i.e. every LOFT-bearing tree in the sample, fails: **0/12
   open-face, 0/12 closed.** With §4.1's 0/10 that is **0/22 ThickSolid successes on
   lofted volutes**, on two independent code paths (bare loft body and full assembly).
   Split by feature content: trees **with** `LOFT` → 0/12; trees **without** → 95/131.
2. **`bearing_housing` also fails 0/12**, so lofted geometry is not the only trigger —
   ThickSolid fails on a whole class of ordinary machined housings too.
3. **Failure tracks complexity.** Median `faceCount` where ThickSolid succeeds: **78**.
   Median where it fails: **156**. It is the complex half of the corpus that is
   unsupported — exactly the half Sacrosanct §2 targets ("trees are LONG for complex
   parts").
4. **Closed-hollow is not a capability.** 53 of the 143 attempts returned a non-positive
   volume while reporting success, and §4.2 shows that even the "positive" ones are
   wrong (a box returns the 512 cavity, not the 488 wall). The realistic correctness rate
   for closed-hollow is ~0%, not 43%.
5. **Family D, by contrast, works.** All 143 trees compiled — including all 12 lofted
   volutes, each of which drives `BRepOffsetAPI_ThruSections` twice through
   `loftguide::loft`. `ThruSections` is the one TKOffset family with demonstrated
   production value on this corpus, and the ranking in §5 reflects that.

**Honest limits of this measurement.** (a) The sample is 143 of 1,613 (8.9%); per-family
n is 11–36, so per-family rates carry roughly ±25 pp at 95%, while the pooled rate is
tight. (b) A "success" is not verified to have the correct wall volume. (c) The open-face
choice is one heuristic; a different face might succeed where this one fails — the rate
is for *this* selection policy, which is the one the IR actually uses. (d) `manifold_block`
row `cx_00095` (75 faces, 22 ops) held one `MakeThickSolidByJoin` call at ~87% CPU for
**more than 10 minutes** before finally returning `"ThickSolid build failed"`. There is
no timeout on this path, so a pathological input can occupy a caller indefinitely — a
robustness fact worth recording independently of the drop question. That row is counted;
`manifold_block` shows n=11 rather than 12 because the sweep was stopped once every
family had coverage.

### 4.4 ★ The replacement for ThickSolid exists, is clean, and is not in the build

`src/native/brep/NativeThickSolid.cpp` (299 lines) declares
`forge::occtoffset::makeThickSolid(const TopoDS_Shape&, double, const TopTools_ListOfShape&, double)`
— a **1:1 drop-in for `MakeThickSolidByJoin` on an arbitrary `TopoDS_Shape`**, with an
explicit drop-hygiene contract (`NativeThickSolid.hpp:33-38`: "Uses ONLY surviving
toolkits … NO `BRepOffset*`, NO `BRepOffsetAPI*`").

Measured:

```
$ grep -n NativeThickSolid CMakeLists.txt                       -> (no match)
$ find build -name 'NativeThickSolid*.o'                        -> (no output)
$ grep -rn occtoffset src/ include/ | grep -v NativeThickSolid   -> (no output)

# compiled the way run_native.sh compiles it (no -DFORGE_NATIVE_BREP, no OCCT -I):
$ clang++ -std=c++20 -O2 -I include -c src/native/brep/NativeThickSolid.cpp -o nts.o
$ nm nts.o | wc -l                                              -> 1     (empty object)

# compiled the way the kernel would:
$ clang++ -std=c++20 -O2 -DFORGE_NATIVE_BREP -I include \
      -I /opt/homebrew/opt/opencascade/include/opencascade \
      -c src/native/brep/NativeThickSolid.cpp -o nts2.o          -> exit 0, clean
$ nm -g nts2.o | c++filt | grep makeThickSolid
  T forge::occtoffset::makeThickSolid(TopoDS_Shape const&, double, NCollection_List<TopoDS_Shape> const&, double)
$ nm -u nts2.o | <intersect with the 42>                        -> (empty)  ← adds ZERO TKOffset symbols
$ nm -u nts2.o | <map to toolkits>  -> TKTopAlgo 28, TKernel 18, TKBRep 13, TKG3d 5, TKMath 5
```

So the file **compiles clean, defines the entry point, references zero TKOffset
symbols, and needs only toolkits that are already linked**. It is not in
`CMakeLists.txt`, so CMake never sees it; and `run_native.sh` globs it
(`test/native/run_native.sh:67`) but compiles it without `-DFORGE_NATIVE_BREP`, so it
yields an **empty object** and its 140-gate suite proves nothing about it. It has
therefore **never been compiled with its body enabled anywhere in the repo**, and has
never been run.

Its honest defer envelope (`NativeThickSolid.hpp:39-44`): **any non-planar face**, zero
openings, `t` ≥ the solid's minimum half-extent, a degenerate corner meet, or a sew that
does not close.

**Do not read that as "free".** Measured against the corpus, the planar-only envelope is
empty: **0 of 1,613 parts are all-planar** and **0 of the 95 sampled ThickSolid successes
are all-planar** — every corpus part carries cylindrical faces. Wiring this file as
written and compiling OCCT out would make `part::shell` throw on every real part. The
file is the right *shape* for the drop (right type, right hygiene, zero TKOffset
symbols) but its geometry coverage has to be extended from planar to quadric first. §5
prices that honestly.

---

## 5. Ranking: (symbols removed) / (net-new capability required)

**What is measured and what is judgement.** The symbol counts, site counts, "engine
exists / is built / is wired" states, and the corpus rates are measurements. The **cost
column is engineering judgement**, anchored to a *named* capability so it can be argued
with. Units:

- **0.5** — a typing/wrapper change over an engine that already exists, is built, is
  gated and has a test. No new geometry.
- **1.0** — one new bounded geometric capability with a known closed form.
- **2.0** — a new pipeline or importer *plus* a bounded geometry capability.
- **4.0** — a new algorithm family with no engine and no gate anywhere in the tree.

### ★ The correction that reshapes this table

My first pass scored family **G** as cost 0 — "`NativeThickSolid.cpp` is written, just
add it to CMake". **That is wrong, and the corpus says so.** `NativeThickSolid.cpp`
honestly defers on *any non-planar face* (`NativeThickSolid.hpp:39`), and:

```
corpus rows that are ALL-PLANAR:                        0 / 1613   (0.0%)
surface kinds present: cylinder 1613, plane 1613, bspline 399, other 400,
                       cone 233, torus 162, sphere 159
sampled ThickSolid successes that are ALL-PLANAR:       0 / 95
```

**Every part in the complex corpus has cylindrical faces.** Wiring
`NativeThickSolid.cpp` as written and compiling out OCCT would make `part::shell` throw
on 100% of real parts — dropping the library by deleting the capability, which Law 9
forbids. The genuine cost of G is therefore **1.0: extend `NativeThickSolid` from planar
to quadric faces.** That is a *port*, not research — `src/native/brep/Shell.cpp` already
does exactly this analytically (plane offsets to a parallel plane, cylinder r→r−t,
sphere r→r−t, cone shifts; `Shell.hpp:36-42`) on the native B-rep, and `OffsetShape.cpp`
does the adjacent-face corner re-trim. G is re-typing proven analytics onto
`TopoDS_Shape`, not inventing them.

### The table

| Rank | Fam | Syms | Net-new capability required | Cost | Ratio | Independent? |
|---:|---|---:|---|---:|---:|---|
| **1** | **G + H** (pair) | **6** | quadric-face offset + adjacent-face corner re-trim on a `TopoDS_Shape`, once, serving both — a port of `Shell.cpp` + `OffsetShape.cpp` analytics into the already-written, already-drop-clean `NativeThickSolid.cpp` shape. Releases the shared vtable. | **1.5** | **4.0** | yes |
| **2** | **A** 2-D wire offset | 4 | circular-arc segments in `PolygonOffset2D` (concentric-arc offset + arc/line trim-extend — closed form, the 2-D analogue of the TKFillet plan's F1) | 1.0 | **4.0** | yes — 1 site, 1 file, no shared symbol |
| **3** | **C** DraftAngle | 6 | general planar-face taper on an arbitrary shape with adjacent-face re-trim (today `DraftAnalytic` is canonical-cube-only, `DraftAnalytic.hpp:46-52`) + `TopoDS_Shape` typing | 1.5 | **4.0** | yes |
| 4 | **G** alone | 3 | as rank 1, minus the `offsetSolid` wrapper | 1.0 | 3.0 | yes (vtable stays with H) |
| 5 | **D** ThruSections | 6 | OCCT-wire → `LoftSection` importer (the inert seam at `LoftGuide.cpp:124`) with the pole-overshoot guard the `pointsToBSpline` history demands, + `AddVertex` point-sections, + ruled/smooth toggle | 2.0 | 3.0 | yes, but 5 sites in 4 files must land together |
| 6 | **B** MakeFilling | 5 | free-wire detection → boundary-curve extraction → n-sided cap → sew, on arbitrary broken shapes. `GregoryFill.cpp` is the engine; nothing feeds it | 2.0 | 2.5 | yes |
| 7 | **I** thickenSurface | 5 | open-shell skinning — offset an *open* shell both ways and close the rim. Genuinely absent: `Shell.cpp` hollows a closed solid, `OffsetShape.cpp` offsets a closed solid | 2.0 | 2.5 | yes |
| 8 | **E** MakePipe | 3 | arbitrary-`TopoDS_Wire` spine (arc/spline, not just polyline — `Sweep.hpp:15`) + `TopoDS_Shape` typing | 1.5 | 2.0 | yes |
| 9 | **H** alone | 2 | `TopoDS_Shape` wrapper for `offsetSolidShape` + fix the known curved-face axial mis-placement (`Features.cpp:1035-1040`) | 1.0 | 2.0 | yes (vtable stays with G) |
| 10 | **F** MakePipeShell | 7 | guided sweep from scratch: Frenet framing, curvilinear-equivalence guide constraints, `MakeSolid` closure. **No native engine of any kind, and no pure-C++ gate** | 4.0 | 1.8 | yes |

### The answer to "can any family be dropped independently?"

**Yes — all nine.** The symbol sets are disjoint except the single G/H vtable, the
object-file attribution is clean, each family has its own call sites, and each has its
own tests. There is no ordering constraint between families. Concretely:

- **G + H is the recommended first increment**: the largest yield (6 of 42, 14%) at the
  joint-best ratio, one geometric capability shared between them, three C++ native gates
  and two JS gates already in place, and — uniquely — the *lowest capability risk*,
  because §4 shows the OCCT implementation being replaced is 0/22 on lofted volutes,
  silently wrong in closed-hollow mode, and 66% on the corpus overall (0% on every lofted tree).
- **A and C are the cheapest single families** — 1 site each, 1 file each, one bounded
  closed-form capability each.
- **F is the wall**: 7 symbols, zero engine, zero native gate, genuinely new geometry,
  and (§3.4) not reachable from the Unified IR at all. Schedule it last and budget it
  separately; every other family can land ahead of it.

### The honest ceiling

The nine increments above sum to 42 only when **F** lands too. Without F the blocking
set goes 42 → 7 and `otool` stays at **8**. Anyone planning this should read §5 as
"shrink the blocking set to 7, then solve guided sweep", **not** as "nine small drops
add up to a toolkit removal". The `otool` number does not move until the last one.

### The concrete first increment, and the exact evidence that would prove it

1. **Extend `NativeThickSolid.cpp` from planar to quadric faces.** Port the analytic
   offsets `Shell.cpp` already ships (plane → parallel plane, cylinder r→r−t, cone axial
   shift, sphere r→r−t, `Shell.hpp:36-42`) and `OffsetShape.cpp`'s adjacent-face corner
   re-trim, onto the `TopoDS_Shape` signature `NativeThickSolid.hpp:66` already declares.
   Keep the honest defer for torus/NURBS.
2. **Add it to `CMakeLists.txt`** (it is absent today) so it is compiled at all, and give
   `run_native.sh` a `-DFORGE_NATIVE_BREP` path for it — today it globs the file and
   compiles it to an empty object, so no gate covers it.
3. **Write the pure-C++ gate first, with a closed-form assertion that does not need OCCT
   as an oracle** — mandatory here, because §4.2 shows OCCT *is not a valid oracle for
   shell* (the kernel's own `native_vs_occt_features_gap1.mjs` already refuses to use it).
   The natural fixture is a cylinder Ø20 × H30 shelled inward to a 2 mm wall with the
   **top** face removed. The result is the outer cylinder minus a cavity of radius 8 and
   height 28 (2 mm floor, open top), so

   ```
   V = π(10²·30 − 8²·28) = π·1208 = 3795.04392553647
   ```

   exact and closed-form, needing no OCCT oracle. **Validated against the current
   kernel** (`f.part.shell(f.makeCylinder(10,30), [topFace-1], -2.0)`): OCCT returns
   `3795.043925536`, relative error `2.4e-16` — so the reference is right, *and* it shows
   OCCT's ThickSolid is machine-exact on a quadric shell. That is precisely the
   capability a planar-only native replacement would delete, which is why this assertion
   is the one that separates "compiles" from "replaces the capability".
4. **Wire the three `Features.cpp` sites** (`:967`, `:2556`, `:2587`) native-first with
   the OCCT branch under `#else`, behind a new `FORGE_OFFSET_DROP_THICKSOLID` option
   defaulting **OFF**, mirroring `FORGE_FILLET_DROP_NATIVE` (`CMakeLists.txt:182-190`).
5. **Repeat for H** at `Features.cpp:1081` — same quadric machinery, plus the known
   axial-placement fix.
6. **Evidence before the flip, in this order:** `test/native/run_native.sh` 141/141 →
   `node test/native_vs_occt_features_gap1.mjs` shell family still NATIVE-VERIFIED →
   `node test/part_features_smoke.js` → `node test/native_analytic_offset_ab.mjs` →
   the corpus harness in §4.3 re-run with the drop ON, requiring **≥ the OCCT baseline
   rate measured here, not merely "no throw"** → then `ft_unified_edit` 20/20,
   `directedit` 9/9, `ft_smoke` ALL PASS, `otool` still 8 (it will not move) and
   `nm -u … | grep -c BRepOffsetAPI_MakeThickSolid` → **0** → Models-OS 13/13 → Linux CI
   "Kernel + Guards". Revert-if-red.

The step-6 corpus requirement is the one that matters and the one no existing gate
enforces: a native ThickSolid that throws where OCCT succeeded is a capability deletion,
which Law 9 forbids regardless of what the link count does.

---

## 6. ★ Why TKOffset, and not TKFillet, is the drop that reduces the closure

`otool -L` counts direct link records. The **true load closure** is what the process
`dlopen`s. Both are measured here by walking `LC_LOAD_DYLIB` transitively from
`/opt/homebrew/opt/opencascade/lib`:

| scenario | `otool` count | true load closure | toolkits actually removed from the closure |
|---|---:|---:|---|
| today | 8 | **14** | — |
| drop **TKFillet** | 7 | **14** | **none** — TKOffset `DT_NEED`s TKFillet |
| drop **TKShHealing** | 7 | **14** | **none** |
| drop **TKOffset** | 7 | **13** | TKOffset |
| drop TKOffset + TKFillet *(DT_NEED arithmetic only)* | 6 | 9 | TKOffset, TKFillet, TKBO, TKBool, TKPrim |
| drop TKOffset + TKFillet *(honest — TKBO/TKBool/TKG2d must then be linked directly, because 31 live `BRepAlgoAPI_*`/`BOPAlgo_*` and 36 `Geom2d_*` symbols lose their transitive provider)* | **9** | **12** | TKOffset, TKFillet, TKPrim |
| drop TKOffset + TKFillet *(**MEASURED 2026-07-31**, not estimated — a real `FORGE_FILLET_DROP_NATIVE=ON` build was configured and linked)* | **9** | **11** | TKOffset, TKFillet, **TKBool** |

> **Correction, 2026-07-31.** The two estimated joint-drop rows above are superseded by
> the measured one. The freed toolkit is **TKBool, not TKPrim** — TKPrim survives because
> TKBO still pulls it. Closure lands at **11**, one better than the honest estimate.
>
> The rows for the *individual* drops (TKFillet → 14, TKOffset → 13) were already correct
> here and are confirmed by `otool -L`: `libTKOffset` DT_NEEDs `libTKFillet`, and the
> reverse is **not** true. The programme note claiming "TKFillet and TKOffset must drop
> together, the only way closure falls below 14" was therefore wrong, and this document
> was right. **TKOffset alone is a unilateral win; TKFillet alone is worth exactly zero
> and can only ever follow it.**
>
> A `FORGE_FILLET_DROP_NATIVE=ON` build links cleanly and sheds all 11 TKFillet symbols,
> but `native_vs_occt_core.mjs` then fails `fillet ALL box edges` and `chamfer ALL box
> edges`: the native engine honestly declines a vertex where exactly two blended edges
> meet, because the two-edge corner surface is not authored. Filleting every edge of a
> box is ordinary work, so enabling it would delete a real capability (Law 9) while
> moving closure by zero. Bank the corner-blend work; never score it as a drop.

Measured supporting numbers: `TKOffset` `DT_NEED`s
`TKBO TKBRep TKBool TKFillet TKG2d TKG3d TKGeomAlgo TKGeomBase TKMath TKPrim TKShHealing TKTopAlgo TKernel`;
506 of the `.node`'s 788 undefined symbols are OCCT symbols; **67 of those are provided
by none of the 8 linked toolkits** (36 → TKG2d, 31 → TKBO) and resolve only through the
`DT_NEED` chain.

Three consequences:

1. **The 07-30 report's headline recommendation (TKFillet first) buys a count, not a
   footprint.** Its own §3.5 says so; this table quantifies it: closure 14 → 14, zero
   toolkits actually unloaded. `CMakeLists.txt:191-207` reaches the same conclusion
   independently and, correctly, appends TKBO/TKG2d in the drop branch rather than
   inflating the default list.
2. **TKOffset is the only single leaf drop that moves the closure** (14 → 13).
3. **The pair TKOffset + TKFillet is where the real footprint win is** (14 → 12 honest,
   and it is the pair that finally unloads TKPrim). Since TKFillet's own drop is
   already scaffolded and blocked on one geometry problem, and TKOffset decomposes into
   nine independent increments of which two are nearly free, **the two programmes are
   complements, not alternatives** — and TKOffset's cheap end can start immediately,
   in parallel, without touching the fillet files.

---

## 7. Where the docs contradict the measurement (measurement wins)

**7.1 `reports/OCCT_ZERO_NEXT_STEP_2026-07-30.md:104` says "~17 live call sites".**
Measured: **19**. The undercount is `BRepOffsetAPI_MakePipe` (3 sites — `Features.cpp:672,
740, 835` — the report's §1.3 lists all three but the summary counts them as fewer) and
`BRepOffsetAPI_MakeThickSolid` (3 sites — `Features.cpp:967, 2556, 2587`). The report's
"8 classes" is also 9 — it omits `BRepOffsetAPI_MakeThickSolid` from the class list in
the prose while listing its call sites.

**7.2 `CMakeLists.txt:195-196` attributes `BRepOffsetAPI_MakeFilling` to TKBO.**

```
$ nm -gU /opt/homebrew/opt/opencascade/lib/libTKBO.7.9.dylib | grep -c MakeFilling      -> 0
$ nm -gU /opt/homebrew/opt/opencascade/lib/libTKBO.7.9.dylib | grep -c BRepOffsetAPI    -> 0
$ nm -gU /opt/homebrew/opt/opencascade/lib/libTKOffset.7.9.dylib | grep -c MakeFilling  -> 23
```

TKBO exports **zero** `BRepOffsetAPI_*` symbols. `MakeFilling` is TKOffset's, and it is
TKOffset-exclusive across all 67 installed toolkits. The rest of that comment block (the
`otool` 8 → 9 mechanic, TKG2d/`Geom2d_Line`, and the "count that falls because one
library hides behind another is not progress" conclusion) is confirmed correct by §6.

**7.3 The 07-30 report lists `NativeThickSolid.cpp (299 L)` among TKOffset's existing
engines.** True on disk, misleading in effect: it is **not in `CMakeLists.txt` and
compiles to an empty object under `run_native.sh`** (§4.4). "Exists" and "is built" are
different states and the ledger should distinguish them.

**7.4 `include/forge/native/brep/Shell.hpp` is described as the ThickSolid
replacement.** It is the replacement for the *native-solid* path only; the
`TopoDS_Shape` replacement is `NativeThickSolid.cpp`, which is the one that matters for
the drop and the one that isn't built.

---

## 8. Incidental defect found while running the ThickSolid experiment

**Not part of the assignment; reported, not fixed** — `src/ft/FeatureTreeCompiler.cpp` is
being edited by another agent and was never written to by me. Line numbers are as of the
copy on disk at the time of writing and may drift.

### The two face-id conventions

- `src/DirectModeling.cpp:168-178` `lookupFace` — **1-based**: it indexes a
  `TopTools_IndexedMapOfShape` and explicitly rejects `id < 1`. This is what
  `forge::direct::faceCount` / `inferFeature` use.
- `src/Features.cpp:146-154` `faceById` — **0-based**: it counts a `TopExp_Explorer` from
  `i = 0`. This is what `forge::part::shell` / `draftFaces` / `shellMultiThickness` use.

Measured on a 40 mm box (`faceCount == 6`):

```
f.direct.inferFeature(box, 0) -> THROW "forge.direct: face id 0 out of range (shape has 6 faces)"
f.direct.inferFeature(box, 6) -> OK
f.part.shell(box, [5], -2)    -> OK
f.part.shell(box, [6], -2)    -> THROW "forge.part: face id 6 out of range (only 6 faces)"
```

### `opShell` crosses them

`src/ft/FeatureTreeCompiler.cpp:941-957` picks the open face with a 1-based loop and
hands the result straight to the 0-based consumer:

```cpp
// FeatureTreeCompiler.cpp:951-957
for (std::uint32_t fid = 1; fid <= n; ++fid) {          // 1-based (lookupFace)
    auto fi = forge::direct::inferFeature(body, fid);
    ...
}
return forge::part::shell(body, {best}, -std::fabs(wall), {});   // 0-based (faceById)
```

### Proof, with a fixture symmetry cannot mask

A cube hides this — removing *any* one face of a cube gives the same wall volume, so
`SHELL` on a cube returns the right number while opening the wrong face. A **non-cubic**
box separates them. `BOX(60,20,10)`, wall 2:

```
opShell selects face id 1 (1-based), normal [0,0,-1], area 1200 = 60x20  -> the BOTTOM face, correct
closed form, bottom (60x20) removed : 60*20*10 - 56*16*8 = 4832
f.part.shell(box, [0], -2.0)                                = 4832.000000   <- the intended face
f.part.shell(box, [1], -2.0)                                = 5952.000000   <- one index off
IR:  %1 = BOX(60,20,10,0,0,0) / %2 = SHELL(%1, 2)           = 5952.000000   <- what SHELL actually does
```

**The IR `SHELL` op opens the wrong face and returns a 23 % volume error, silently, with
`ok: true`.** When the selected face happens to be the last one it instead throws
`forge.part: face id N out of range` — which is what my first experiment run hit before I
corrected the harness (§4.1).

Why it survived: no gate chains `SHELL` to a volume assertion, and the only shapes it is
exercised on are symmetric enough to hide it.

The immediate fix is `{best - 1}` **plus** a gate asserting the shelled volume on a
non-cubic box — `BOX(60,20,10)` wall 2 must give `4832`, not `5952`.

**Second-order hazard, flagged not measured:** even with the `-1`, the two enumerations
come from different traversals — `TopExp::MapShapes` (deduplicating, TShape-keyed) versus
`TopExp_Explorer` (non-deduplicating). They coincide on a simple solid but need not on a
compound or a shape with a shared face. The durable fix routes both through a single
enumeration rather than offsetting one into the other.

---

## Appendix — verbatim commands

```
$ otool -L build/Release/forge-kernel.node | grep -c opencascade
8

$ nm -u build/Release/forge-kernel.node | sed 's/^ *//;s/^_//' | sort -u | wc -l
     788
$ nm -gU /opt/homebrew/opt/opencascade/lib/libTKOffset.7.9.dylib | awk '{print $3}' \
    | sed 's/^_//' | sort -u | wc -l
     727
$ comm -12 undef.txt exp_TKOffset.txt | wc -l
      42

# object-file attribution (832 objects scanned; 7 source files carry TKOffset symbols)
Healing.cpp.o           5    Airfoil.cpp.o          4
Features.cpp.o         31    Primitives.cpp.o       5
Cam.cpp.o               4    LoftGuide.cpp.o        5
ClassASurfacing.cpp.o   7
   (union = 42; Features.cpp.o carries 31 of them)

# exclusivity across the whole install
$ ls /opt/homebrew/opt/opencascade/lib/libTK*.7.9.dylib | wc -l
      67
   -> all 42 symbols: providers = {TKOffset}, and only TKOffset.

# G/H vtable coupling, minimal TUs
TU(MakeThickSolid only)  -> 3 syms + vtable for BRepOffsetAPI_MakeOffsetShape
TU(MakeOffsetShape only) -> 2 syms + vtable for BRepOffsetAPI_MakeOffsetShape

# NativeThickSolid.cpp
$ grep -n NativeThickSolid CMakeLists.txt                      (no match)
$ find build -name 'NativeThickSolid*.o'                       (no output)
$ grep -rn occtoffset src/ include/ | grep -v NativeThickSolid (no output)
$ clang++ -std=c++20 -O2 -DFORGE_NATIVE_BREP -I include \
      -I /opt/homebrew/opt/opencascade/include/opencascade \
      -c src/native/brep/NativeThickSolid.cpp                  exit 0
   -> defines forge::occtoffset::makeThickSolid; TKOffset symbols referenced: 0

# gate baseline (before and after this analysis)
$ node test/ft/ft_unified_edit.mjs   -> 20 passed
$ node test/directedit.mjs           -> 9/9 DirectEdit tests passed
$ node test/ft/ft_smoke.mjs          -> ===== ALL PASS =====

# ThickSolid — the sign conventions, on a box 10^3 with wall 1 (kindOf(result)=='occt')
    part.shell(box, [top], -1.0) -> 424.00000   correct  (10^3 - 8*8*9)
    part.shell(box, [],    -1.0) -> 512.00000   WRONG: the cavity 8^3, not the wall 488
    part.shell(box, [top], +1.0) -> 564.92625   outward-wall convention
    part.shell(box, [],    +1.0) -> -1698.43657 negative, IsDone()==true

# proposed drop fixture, validated against the current kernel
    part.shell(makeCylinder(10,30), [top], -2.0) -> 3795.043925536
    closed form  pi*(10^2*30 - 8^2*28) = pi*1208 = 3795.04392553647  (rel err 2.4e-16)

# the SHELL off-by-one (section 8), on a non-cubic box 60x20x10 wall 2
    part.shell(box,[0],-2) = 4832.000000   (bottom removed -- correct)
    part.shell(box,[1],-2) = 5952.000000
    IR  SHELL(BOX(60,20,10), 2) = 5952.000000   <- opens the wrong face, ok:true

# the volute (Experiment A)
$ node scratchpad/tkoffset/volute_shell.mjs
    0/10 ThickSolid attempts succeeded; control box shells to 14752.000 exactly

# corpus sweep (Experiment B), n=143 over all 10 families
$ node scratchpad/tkoffset/corpus_shell_strat.mjs 12  (+ per-family runs)
    IR compiled                 143/143
    open-face ThickSolid built   95/143 = 66%   (95% Wilson CI 58-74%)
    closed-hollow +volume        62/143 = 43%   (upper bound; see 4.2)
    LOFT-bearing trees            0/12
    median faceCount  success 78   fail 156

# corpus composition
$ <IR op histogram over complex_all.jsonl>
    LOFT 200 occurrences / 100 rows;  SHELL/SWEEP/DRAFT/THICKEN/OFFSET/REVOLVE = 0
    ALL-PLANAR rows: 0 / 1613;  kinds: cylinder 1613, plane 1613, bspline 399,
                                       other 400, cone 233, torus 162, sphere 159
```

Working files (session scratchpad, outside every tracked tree — the only file this
analysis wrote into the repo is this report):
`scratchpad/tkoffset/{undef.txt, exp_TKOffset.txt, need_TKOffset.txt, attrib.txt,
f_*.cpp minimal TUs, volute_shell.mjs, corpus_shell_strat.mjs, corpus_shell_fam.mjs,
analyze.py, strat.jsonl, pump.jsonl, fam_*.jsonl}`.

---

*Produced 2026-07-30. Read-only analysis: no file under `forge-kernel/src` or
`forge-kernel/include` was modified. Sacrosanct §3 (the kernel); Prime Directive 8
(industrial grade — every number here is a measurement, and where I could not measure
something I say so); Prime Directive 6 (never optimise a proxy uncorrelated with the
true metric — see §6 on `otool` vs the load closure).*
