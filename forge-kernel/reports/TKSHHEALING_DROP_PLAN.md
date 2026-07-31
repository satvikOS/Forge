# TKShHealing — drop plan (2026-07-30)

**Analysis + preparation only. No file under `forge-kernel/src` or `forge-kernel/include`
was modified.** `NativeFilletChamfer.cpp` and `FeatureTreeCompiler.cpp` were not touched
or read for edit. Every number below was measured on this machine today against
`build/Release/forge-kernel.node` with `nm` / `otool` / `c++filt`, or by running the gates.
Where a doc or a prior report disagrees with the code or with a measurement, the measurement
wins and I say so (§8).

The kernel was rebuilt underneath this analysis by a concurrent session (artifact mtime
`16:52:27` → `19:35:41`; `src/IoExchange.cpp` and `src/native/brep/NativeFilletChamfer.cpp`
changed — neither was touched by me). **Every headline number was re-measured on the
19:35:41 artifact and is unchanged**: `otool` 8, TKShHealing 20 / TKFillet 11 / TKOffset 42,
and the 20-symbol set is byte-identical (`diff` empty). `IoExchange.cpp` contains no
`ShapeFix_*` / `ShapeAnalysis_*` / `ShapeUpgrade_*` reference, so the §1.2 call-site map is
unaffected. The new STEP-reader gate re-verified 72/72 against the pre-rebuild freeze.

**Headline (this reverses the 07-30 next-step report's priority ordering):**
dropping TKShHealing takes `otool` **8 → 7 with no compensating additions**, because
TKShHealing's entire `DT_NEED` set is a strict subset of TKFillet's and TKOffset's, both
of which stay. Dropping TKFillet takes it **8 → 9** (CMakeLists.txt:191-206, measured by
another agent today). Measured in §5.

---

## 0. Ground truth, measured today

```
$ otool -L build/Release/forge-kernel.node | grep -c opencascade
8
$ nm -u build/Release/forge-kernel.node | wc -l
788
```

| toolkit | symbols the `.node` needs | exclusive to it |
|---|---:|---:|
| TKernel | 25 | 25 |
| TKMath | 26 | 26 |
| TKG3d | 138 | 138 |
| TKBRep | 80 | 80 |
| TKTopAlgo | 97 | 97 |
| **TKShHealing** | **20** | **20** |
| TKOffset | 42 | 42 |
| TKFillet | 11 | 11 |

`comm -12 need_TKShHealing.txt union(exports of the other 7)` → **0**. All 20 are
exclusive; no other linked toolkit can serve them.

---

## 1. Every TKShHealing symbol still linked, and its exact call site

### 1.1 The 20 symbols, grouped by class

| # | demangled symbol | group |
|---|---|---|
| 1 | `ShapeFix_Shape::ShapeFix_Shape(TopoDS_Shape const&)` | **A** |
| 2 | `ShapeFix_Shape::Perform(Message_ProgressRange const&)` | **A** |
| 3 | `ShapeFix_Shape::Shape() const` | **A** |
| 4 | `ShapeFix_Shape::Status(ShapeExtend_Status) const` | **A** |
| 5 | `vtable for ShapeFix_Shape` | **A** |
| 6 | `vtable for ShapeFix_Root` | **A** |
| 7 | `ShapeFix_Solid::ShapeFix_Solid()` | **B** |
| 8 | `ShapeFix_Solid::ShapeFix_Solid(TopoDS_Solid const&)` | **B** |
| 9 | `ShapeFix_Solid::SolidFromShell(TopoDS_Shell const&)` | **B** |
| 10 | `ShapeFix_Solid::Solid() const` | **B** |
| 11 | `ShapeAnalysis_Shell::ShapeAnalysis_Shell()` | **C** |
| 12 | `ShapeAnalysis_Shell::LoadShells(TopoDS_Shape const&)` | **C** |
| 13 | `ShapeAnalysis_Shell::CheckOrientedShells(TopoDS_Shape const&, bool, bool)` | **C** |
| 14 | `ShapeAnalysis_FreeBounds::ShapeAnalysis_FreeBounds(TopoDS_Shape const&, double, bool, bool)` | **D** |
| 15 | `ShapeUpgrade_UnifySameDomain::ShapeUpgrade_UnifySameDomain(TopoDS_Shape const&, bool, bool, bool)` | **E** |
| 16 | `ShapeUpgrade_UnifySameDomain::Build()` | **E** |
| 17 | `vtable for ShapeUpgrade_UnifySameDomain` | **E** |
| 18 | `ShapeAnalysis_Surface::ShapeAnalysis_Surface(handle<Geom_Surface> const&)` | **F** |
| 19 | `ShapeAnalysis_Surface::ValueOfUV(gp_Pnt const&, double)` | **F** |
| 20 | `ShapeAnalysis_Curve::Project(handle<Geom_Curve> const&, gp_Pnt const&, double, gp_Pnt&, double&, bool) const` | **G** |

`ShapeUpgrade_UnifySameDomain::Shape()` is *not* in the list — it is inlined/`ShapeFix_Root`-
inherited and resolves without an import.

### 1.2 Every live call site (17 statements, 12 logical sites, 5 files)

| group | file:line | statement | on the STEP-read path? |
|---|---|---|---|
| **G** | `src/native/brep/StepReadOcct.cpp:969-970` | `ShapeAnalysis_Curve sac; dist = sac.Project(c,P,Confusion,proj,u,false)` inside `paramOnCurve` | **YES** |
| **F** | `src/native/brep/StepReadOcct.cpp:1239` | `new ShapeAnalysis_Surface(surf)` — shared inverter for `attachFilePcurves` | **YES** |
| **F** | `src/native/brep/StepReadOcct.cpp:1292,1293` | `sas->ValueOfUV(Pf3, prec)` / `(Pl3, prec)` | **YES** |
| **A** | `src/native/brep/StepReadOcct.cpp:1581-1585` | `new ShapeFix_Shape(raw); SetPrecision(max(1e-6,X.tol)); SetMaxTolerance(1.0); Perform(); Shape()` | **YES — ★the residual** |
| **E** | `src/Healing.cpp:387-391` | `ShapeUpgrade_UnifySameDomain unify(s,…); SetAngularTolerance; Build()` (`simplifyShape`) | no |
| **D** | `src/Healing.cpp:407-410` | `ShapeAnalysis_FreeBounds analyzer(s,tol,F,F); GetClosedWires()` (`autoFillMissingFaces`) | no |
| **B** | `src/Healing.cpp:446,448,451` | `new ShapeFix_Solid(mk.Solid()); Perform(); Solid()` | no |
| **A** | `src/Healing.cpp:488-503` | `new ShapeFix_Shape(s); SetPrecision/Min/MaxTolerance; Perform(); Status(DONE1..6)` (`autoRepairSelfIntersection`) | no |
| **A** | `src/Healing.cpp:517-519` | `new ShapeFix_Shape(s); Perform(); Shape()` (`harmonizeNormals`) | no |
| **C** | `src/Healing.cpp:525-527` | `ShapeAnalysis_Shell ana; LoadShells(sh); CheckOrientedShells(sh,true)` — **return value discarded** | no |
| **B** | `src/Healing.cpp:531-532` | `new ShapeFix_Solid(); SolidFromShell(shell)` | no |
| **A** | `src/ShapeFix.cpp:295-304, 327, 332` | `new ShapeFix_Shape(s); SetPrecision/Min/MaxTolerance; Perform(); Status(DONE1..8/FAIL1..8)` | no |
| **A** | `src/DirectEdit.cpp:71-73` | `ShapeFix_Shape fixer(s); Perform(); Shape()` (private `heal()`, used at `:271` and `:334`) | no |
| **E** | `src/DirectEdit.cpp:136-138` | `ShapeUpgrade_UnifySameDomain u(shape,T,T,T); Build()` (`unifyFaces`) | no |
| **A** | `src/DirectModeling.cpp:513` | `new ShapeFix_Shape(out)` — post-boolean light heal (`pushPullFace`) | no |
| **A** | `src/DirectModeling.cpp:565` | `new ShapeFix_Shape(work)` — `moveFace` | no |
| **A** | `src/DirectModeling.cpp:618` | `new ShapeFix_Shape(op.Shape())` — `rotateFace` | no |
| **A** | `src/DirectModeling.cpp:721` | `new ShapeFix_Shape(sewn)` — face-swap re-sew | no |

**STEP-read path = 4 statements in 1 file** (`StepReadOcct.cpp` 969, 1239, 1292/1293, 1581),
carrying groups **F (2) + G (1) + A (shared)**.
**Non-STEP = 13 statements in 4 files**, carrying groups **B (4) + C (3) + D (1) + E (3) +
A (shared)**.

Group **A** is the only group that straddles the boundary: all six `ShapeFix_Shape` symbols
survive as long as *any one* of the nine A-sites keeps the OCCT call, because the vtable
imports are emitted by construction, not by use.

### 1.3 Dead includes (0 uses, verified by grep) — free hygiene, no symbol effect

`src/Healing.cpp:18` `ShapeAnalysis_ShapeContents.hxx` · `:19` `ShapeAnalysis_ShapeTolerance.hxx`
· `:21` `ShapeFix_ShapeTolerance.hxx` · `src/native/brep/StepReadOcct.cpp:92` `ShapeFix_Shell.hxx`.

---

## 2. Native equivalent per site — what exists, and how close

There is a substantial OCCT-typed native layer and it is **compiled into the shipping
binary today** (verified with `nm | c++filt | grep occtheal` — all 11 entry points are
`T` symbols in `forge-kernel.node`). `CMakeLists.txt:729-730` lists both files. The
comments inside `NativeShapeHeal.cpp:640` and `NativeShapeHealBridge.cpp:300` that say
"not yet listed in CMake" are **stale**.

| group | site | native peer | state |
|---|---|---|---|
| **G** | StepReadOcct:969 | `occtheal::projectPointOnCurve` — `NativeShapeHeal.cpp:223-292`. Closed form for `Geom_Line`/`Geom_Circle`, 32-sample seed + 30-step Gauss-Newton otherwise. | **exists, unwired.** Semantic delta: clamps to `[First,Last]`; a `Geom_TrimmedCurve`-wrapped circle misses the closed form and falls to Newton. Caller passes `adjustToEnds=false` and does its own exact endpoint snap at `:971-974`, so the delta is confined to interior feet. |
| **F** | StepReadOcct:1239/1292/1293 | `occtheal::valueOfUV` / `projectPointOnSurface` — `NativeShapeHeal.cpp` (decl `NativeShapeHeal.hpp:98-103`). Closed form for Plane/Cyl/Cone/Sphere/Torus, grid-seeded Gauss-Newton otherwise. | **exists, unwired.** Signature is a drop-in: the site only needs `(surf, P, prec) -> gp_Pnt2d`, and `surf` is already in scope; the `Handle(ShapeAnalysis_Surface)` cache disappears. |
| **A** (light) | DirectEdit:71, DirectModeling:513/565/618/721 | `occtheal::finalizeShape` — `NativeShapeHeal.cpp:458-500`: `BRepLib::SameParameter` + signed-volume outward orient + closed-shell→solid promote. | **exists AND wired**, at `DirectEdit.cpp:67-69` and `DirectModeling.cpp:511/563/616/719`, behind `forgeNativeFeaturesEnabled()` — **default OFF** (`NativeRoute.cpp:69-75`). Measured green with the gate on (§2.1). |
| **A** (light) | Healing:517 | same `finalizeShape` | **exists, unwired** (this site has no `#ifdef` branch at all). |
| **A** (rich) | Healing:488, ShapeFix:295 | `occtheal::fixShapeGeneral` — `NativeShapeHealBridge.cpp` (import → `healBRep` → `occtFromNativeSolid`), plus `tryNativeHeal`/`tryNativeRepair` wired *ahead* at `Healing.cpp:479` / `ShapeFix.cpp:283`. | **exists, gated, and self-declared incomplete.** Two named blockers in `NativeShapeHealBridge.cpp:274-292`: §A the heal rebuild mints bare faces so a *changed* curved body FACETS on export; §B `importOcctSolid`'s 2-manifold gate rejects exactly the broken inputs a rich repair is called for. Plus §C: no min/max tolerance band. |
| **A** (rich) | StepReadOcct:1581 | — | **★ no peer.** See §3. |
| **B** | Healing:446, 531 | `occtheal::orientSolidOutward` (`NativeShapeHeal.cpp:416-422`) and `occtheal::solidFromShell` (`:404-414`) | **exists, unwired.** `solidFromShell` = `BRepBuilderAPI_MakeSolid` + signed-volume flip — exactly what both sites consume from `ShapeFix_Solid`. |
| **C** | Healing:525-527 | `occtheal::shellOrientationConsistent` (`NativeShapeHeal.cpp:427-453`) | **exists, unwired.** The OCCT call at `:527` **discards its result**, so the native peer is strictly richer at zero behavioural risk. |
| **D** | Healing:407 | `occtheal::freeBounds` (`NativeShapeHeal.cpp:320-399`) — free edges = edges with exactly one face ancestor, chained into closed loops / open chains | **exists, unwired.** Matches the ctor `(shape, tol, splitClosed=F, splitOpen=F)` + `GetClosedWires()` contract this site uses. |
| **E** | DirectEdit:136, Healing:387 | `native::brep::unifySameDomain{Planar,Curved,Bored}` — `UnifyFaces.cpp` (1224 L), wired at `DirectEdit.cpp:100-131` | **PARTIAL.** `NativeSolid` handles only, with explicit eligibility predicates; every OCCT-backed handle and every ineligible native solid falls through. `Healing.cpp:387` has **no** native branch at all. |

### 2.1 Measured A/B of the light-heal peer (real evidence, not "it compiles")

`forgeNativeFeaturesEnabled()` routes `DirectEdit.cpp:71` and all four `DirectModeling.cpp`
sites to `occtheal::finalizeShape`. Run today:

```
                                 default (OCCT)         FORGE_NATIVE_FEATURES=1 (native)
test/directedit.mjs              9/9                    9/9
test/ft/ft_unified_edit.mjs      20/20                  20/20
test/ft/ft_smoke.mjs             ALL PASS               ALL PASS
test/healing_smoke.js            ALL PASS               ALL PASS
```

`occtheal::finalizeShape` is a viable unconditional replacement at those five sites.
(Caveat: `test/healing_smoke.js` is a weak gate — 106 lines, mostly `assert.ok(handle > 0)`;
it does **not** assert volume or χ/genus after `simplifyShape` / `autoFillMissingFaces` /
`harmonizeNormals`. Strengthening it is step P1.0 below.)

---

## 3. ★ Pcurve synthesis — what actually needs it, and why

### 3.1 The operation

The **only** operation is `StepReadOcct.cpp:1581`, the post-transfer `ShapeFix_Shape` pass,
and the reader is explicit that it depends on it — `:1579-1580`:

```cpp
// ShapeFix: add the missing analytic pcurves (project each 3D edge onto its
// adjacent surfaces), fix same-parameter and face/shell orientation.
Handle(ShapeFix_Shape) sfs = new ShapeFix_Shape(raw);
```

The reader builds every edge from a 3D curve only (`ladderEdge`, `:993-1010`), and
`BRepBuilderAPI_MakeFace(surf, wire, false)` at `:1550` does not manufacture pcurves. So an
edge reaches the heal with a pcurve only if `attachFilePcurves` (`:1218-1407`) bound one.

### 3.2 Which surface types, precisely

`attachFilePcurves` **deliberately** skips `PLANE` (`:1231-1234`) — OCCT computes a plane
pcurve on demand via `BRep_Tool::CurveOnPlane`, so a planar face never needs synthesis.
Non-planar faces are left needing a pcurve in exactly four cases:

1. **Non-mm files.** `:1224` `if (X.scale != 1.0) return;` — the whole binding path is off,
   so *every* non-planar edge in a non-millimetre STEP file needs synthesis. This is the
   largest and most under-appreciated case.
2. **File carries no pcurve for that EDGE_CURVE on that surface** (`:1247` `continue`).
3. **File carries one the reader cannot rebuild** — `honest("unsupported 2D form")` `:1377`,
   `honest("locus mismatch")` `:1379`, `honest("unsupported 2D seam form")` `:1391`,
   `honest("seam locus mismatch")` `:1394`, `honest("ambiguous pcurve pairing")` `:1404`.
   **Critical asymmetry** (`:1360-1370`): `honest()` **fails the import** when
   `surf->IsUClosed() || surf->IsVClosed()`, but on an **open** surface it only logs and
   `continue`s — leaving the edge pcurve-less and handing the job to `ShapeFix_Shape`.
   So synthesis demand is confined to **open non-planar surfaces**: trimmed
   cylinder/cone/sphere/torus patches, `B_SPLINE_SURFACE`, `SURFACE_OF_LINEAR_EXTRUSION`.
4. Multi-shell / degenerate faces where `bounds.empty()` takes the natural-bounds branch.

**Measured on the 72-file golden corpus** (`test/golden_corpus_steps`, offline STEP-text
audit, script in the appendix):

```
planar faces                                     72,634
NON-planar faces                                 40,242
NON-planar edges                                168,979
NON-planar edges with NO file PCURVE on their own face:  0    (0.000%)

per surface type (missing / total edges)
  CYLINDRICAL_SURFACE            0 / 85,789
  <rational B-spline, complex instance>  0 / 73,624
  TOROIDAL_SURFACE               0 / 5,768
  B_SPLINE_SURFACE_WITH_KNOTS    0 / 1,954
  CONICAL_SURFACE                0 / 1,832
  SPHERICAL_SURFACE              0 / 12

originating system: 'Open CASCADE STEP processor 7.9'  — 72 of 72 files
```

So **case 2 never fires on this corpus**, and case 1 never fires (all mm). The entire
residual on the corpus is case 3 on open surfaces, whose rate is **NOT MEASURED** —
`honest()` has no counter. That is a stated blocker, not a guess; step P3.0 below adds the
counter before any code moves.

The corpus is also **not representative of the reader's job**: `StepReadOcct.cpp` exists to
read *foreign* STEP, and all 72 files were written by OCCT itself. A SolidWorks/CATIA/NX
file with `.MILLI.`-scaled or pcurve-free `SURFACE_CURVE` records is exactly case 1/2.

### 3.3 ★ A SECOND residual the brief did not name: seam/period reconciliation

`attachFilePcurves` attaches the file pcurve and then deliberately **invalidates the
parameterisation** (`:1382-1383`, `:1399-1400`):

```cpp
b.SameRange(e, Standard_False);
b.SameParameter(e, Standard_False);
```

with the comment at `:1371-1374`: *"let the standing heal (ShapeFix + BRepLib::SameParameter)
reconcile"*. And `:1388` names the specific fixer it relies on: **`ShapeFix_Wire::FixShifted`**
— which swaps the forward/reverse members of a seam pcurve pair and shifts pcurves by the
surface period so a wire on a periodic surface is contiguous.

`BRepLib::SameParameter` (already called natively at `:1586`, and inside
`occtheal::finalizeShape`) does the co-parameterisation. It does **not** do `FixShifted`.

So `StepReadOcct.cpp:1581` has **three** dependencies, not one:
**(i) pcurve synthesis, (ii) seam/period `FixShifted`, (iii) same-parameter reconcile.**
Only (iii) is covered natively today. Any plan that closes only (i) will red the corpus on
the seam edges of every closed cylinder/sphere/torus.

### 3.4 Is synthesis reachable from `occtproj` / `NativeProjection`?

Yes — it is roughly two-thirds built.

`include/forge/native/geom/NativeProjection.hpp` (`forge::occtproj`) provides
`projectPointOnSurface(P, surf)` and a bounded `(P, surf, u1,u2,v1,v2)` variant, already
default-ON via `FORGE_NATIVE_PROJECTION` (`CMakeLists.txt:238`) and already **used by
`StepReadOcct.cpp:1312-1313`**. `occtheal::valueOfUV` is the same inversion. Point→(u,v) is
therefore solved.

The pipeline for a general `ShapeConstruct_ProjectCurveOnSurface` equivalent is:

1. sample the 3D curve at N parameters → `occtproj::projectPointOnSurface` each → (u,v)s
   — **exists**;
2. unwrap the (u,v) sequence across the periodic seam (the `shiftToAnchor` idiom already at
   `StepReadOcct.cpp:1300-1310`) — **exists as a local lambda, needs lifting**;
3. recognise the closed forms first — a line/circle on a plane/cylinder/cone maps to a 2D
   line or circle exactly; `occtconv::to2d(c3, gp_Pln)` (`NativeNurbsConvert.hpp:79`) already
   covers the planar case — **partially exists**;
4. otherwise least-squares fit a `Geom2d_BSplineCurve` through the (u,v) points —
   **DOES NOT EXIST.** `occtconv::pointsToBSpline` is 3D-only (`TColgp_Array1OfPnt` →
   `Geom_BSplineCurve`). A `Geom2d` twin is needed, and it must carry the sane-net
   overshoot guard that the 3D version needed after the airfoil regression
   (`CMakeLists.txt:225-234`; report §4 item 7).

Net: pcurve synthesis is **reachable**, and the missing piece is one bounded, well-precedented
routine (`occtconv::pointsToBSpline2d`) plus the seam unwrap plus the analytic fast paths.
It is not a research problem. It is also **not on the critical path for 17 of the 20
symbols** — see §4.

---

## 4. The SPLIT — how far the symbol count falls without touching the reader

Because the groups partition cleanly by file, the count falls in stages:

| stage | groups | symbols | files touched | new capability needed | STEP reader touched |
|---|---|---:|---|---|---|
| **P1** | B + C + D | **8** | `Healing.cpp` only | **none** — all three peers exist and are exact | **no** |
| **P2** | F + G | **3** | `StepReadOcct.cpp` (2 statements) | **none** — peers exist; both are pure numerics | yes, but not the heal |
| **P3** | E | **3** | `DirectEdit.cpp`, `Healing.cpp` | general OCCT-shape `UnifySameDomain` | **no** |
| **P4** | A | **6** | all 5 files | pcurve synthesis + `FixShifted` + rich DONE/FAIL | yes — the heal |

```
20  ──P1(-8)──►  12  ──P2(-3)──►  9  ──P3(-3)──►  6  ──P4(-6)──►  0   ⇒  otool 8 → 7
```

**P1 alone removes four of the seven TKShHealing classes entirely** and needs zero new
geometry. It is the answer to "can the non-STEP call sites move independently": yes, 8 of
20 symbols, in one file, with peers that are already compiled into the shipping binary.

**Honest caveat about what P1 buys.** It does **not** move `otool` (still 8) and it does
**not** shrink the load closure — TKShHealing stays in the process via `TKOffset`/`TKFillet`
`DT_NEED` even after the direct link goes. What it buys is: (a) the remaining surface is
exactly three named capabilities instead of a 20-symbol fog, (b) each native peer gets
proven on a live gate long before the reader depends on it, (c) `occt_drop_gate.sh
TKShHealing` goes 20 → 12 → 9 → 6 → 0 as a *measurable* series.

### 4.1 ★ The closure arithmetic — measured, and it favours TKShHealing

```
$ otool -L libTKShHealing.7.9.dylib | grep -oE 'libTK[A-Za-z0-9]+' | sort -u
  TKBRep TKG2d TKG3d TKGeomAlgo TKGeomBase TKMath TKShHealing TKTopAlgo TKernel
$ otool -L libTKFillet.7.9.dylib  | ...
  TKBO TKBool TKBRep TKFillet TKG2d TKG3d TKGeomAlgo TKGeomBase TKMath TKPrim TKShHealing TKTopAlgo TKernel
$ otool -L libTKOffset.7.9.dylib  | ...
  TKBO TKBool TKBRep TKFillet TKG2d TKG3d TKGeomAlgo TKGeomBase TKMath TKOffset TKPrim TKShHealing TKTopAlgo TKernel
```

TKShHealing's `DT_NEED` set is a **strict subset** of TKFillet's and of TKOffset's. Both stay.
Therefore removing `TKShHealing` from `OCCT_LIBS` **cannot expose a new library**:
`otool` goes **8 → 7**, clean, with no `list(APPEND OCCT_LIBS …)` compensation.

Compare the measured TKFillet result recorded in `CMakeLists.txt:191-206` today:
dropping TKFillet forces `list(APPEND OCCT_LIBS TKBO TKG2d)` and the count goes **8 → 9**.

**This reverses the priority in `reports/OCCT_ZERO_NEXT_STEP_2026-07-30.md` §3.**
That section chose TKFillet on blast radius (4 sites vs 13, 1 new capability vs 3) — sound
reasoning at the time, but it was written before the 8→9 measurement landed in CMakeLists.
TKShHealing is now the only one of the eight whose removal actually lowers the number.
The right conclusion is not "switch targets immediately" — TKFillet's F1/F2 work is still
correct and still needed — but that **TKShHealing P1+P2 is the cheapest real progress
available right now**, and that the ledger should stop treating the two as interchangeable.

---

## 5. The ordered plan, with the exact test that proves each step

Standing gates (must be green after every step; **revert-if-red**, no argument):

```
node test/ft/ft_unified_edit.mjs                        → 20/20
node test/directedit.mjs                                → 9/9
node test/ft/ft_smoke.mjs                               → ALL PASS
otool -L build/Release/forge-kernel.node | grep -c opencascade   → 8  (until P4)
```

Baseline captured today: **20/20, 9/9, ALL PASS, 8.**

---

### P0 — repair the gate infrastructure (do this first; it is currently broken)

**P0.1 — `test/build_golden_corpus_measure.sh` does not build.** Measured:

```
$ node test/golden_corpus.mjs --verify --limit 8
SRC FAIL: src/native/geom/NativeProjection.cpp
  include/forge/native/geom/NativeProjection.hpp:21:10: fatal error: 'gp_Pnt.hxx' file not found
SRC FAIL: src/native/geom/NativeNurbsConvert.cpp
  ... 'Geom2d_Curve.hxx' file not found
[golden-measure] native source compile failed
```

Step 1 of the script compiles every `src/native/**/*.cpp` with `FLAGS` (which includes
`-DFORGE_NATIVE_BREP`) but **without** `-I "$OCCT_INC"`. The OCCT-typed boundary TUs
(`NativeProjection`, `NativeNurbsConvert`, `NativeShapeHeal`, `NativeShapeHealBridge`,
`StepReadOcct`, `StepWriteOcct`, `NativeFilletChamfer`, …) landed after that script was
written, and it has been red ever since. **Fix + verification are in §6, diff 1.**
After the fix, measured today: `node test/golden_corpus.mjs --verify --limit 10` →
`PASS 10 · FAIL 0 · OCCT-DELETION GATE GREEN`.

**P0.2 — there is no regression gate on the native STEP reader.**
`test/golden_corpus_measure.cpp:186-187` reads its STEP with **OCCT's own
`STEPControl_Reader`**, so `golden_corpus.mjs --verify` never executes one line of
`StepReadOcct.cpp`. The reader's only coverage today is `test/io_smoke.js` (a 10×10×10 box).
**A gate is authored and baselined in §6, diff 2**; measured today:

```
[step-read] FROZE 72 models   import errors: 3 (all pre-existing, listed below)
[step-read] 72 pass / 0 fail of 72        (re-run, rel-tol 1e-9 on volume/area,
                                           exact on faces/edges/closed/manifold/oriented/χ/genus)
```
Pre-existing import failures frozen as-is (they are the honest current state, not
regressions): `cadgen_16bf75ef24271ed7.step` and `fx_filleted_box.step`
("native→OCCT bridge: faceted solid mis-integrates"), `cadgen_c1f67a9f481fcc46.step`
("MakeEdge(line) trim gap beyond 1.0mm ceiling, g2=85.000000").

**P0.3 — strengthen `test/healing_smoke.js`.** Add volume + face-count + χ/genus assertions
around `simplifyShape` / `autoFillMissingFaces` / `harmonizeNormals`. K5's lesson
(`K5_TKMESH_BLOCKER.md`; report §4 item 2) is that volume matched to 1e-16 while χ went
2 → −6. Without this, P1 cannot be honestly gated.

**Proof of P0:** `node test/golden_corpus.mjs --verify` green; `node
test/step_read_corpus_gate.mjs --verify` 72/72; `node test/healing_smoke.js` green with the
new assertions **before** any source change.

---

### P1 — drop groups B + C + D (20 → 12). `Healing.cpp` only. No new capability.

Wire `occtheal::{freeBounds, orientSolidOutward, solidFromShell, shellOrientationConsistent}`
at `Healing.cpp:407 / 446 / 531 / 525`, keeping the OCCT baseline under `#else` behind a new
`FORGE_SHHEAL_DROP_NATIVE` option (the `FORGE_FILLET_DROP_NATIVE` pattern,
`CMakeLists.txt:168-190`). **Diff in §6, diff 3 + 4.**

**Proof:**
1. `bash scripts/occt_drop_gate.sh TKShHealing` → `TKShHealing exports needed by .node: 12`
   (today: 20).
2. `nm -u build/Release/forge-kernel.node | c++filt | grep -cE 'ShapeFix_Solid|ShapeAnalysis_Shell|ShapeAnalysis_FreeBounds'` → **0** (today: 8).
3. `node test/healing_smoke.js` (P0.3-strengthened) → ALL PASS, and specifically
   `autoFillMissingFaces` on a box-with-one-face-deleted must still recover
   `volume = 8000.00 ± 1.0`, `closed = true`, `χ = 2`, `genus = 0`.
4. Standing gates 20/20, 9/9, ALL PASS; `otool` still 8.
5. `node test/step_read_corpus_gate.mjs --verify` → 72/72 (proves no reader collateral).
6. A/B: rebuild `-DFORGE_SHHEAL_DROP_NATIVE=OFF` and re-run 3 — byte-identical report.
7. Push → Linux CI **"Kernel + Guards"** strict-link.

---

### P2 — drop groups F + G (12 → 9). `StepReadOcct.cpp`, 2 statements. No new capability.

**P2.0 first — instrument, don't guess.** Add an env-gated counter to
`attachFilePcurves`'s `honest()` (`:1360`) and to the `:1247 continue`, printing
`bound / skipped-no-file-pcurve / rejected-<why>` per import under
`FORGE_STEP_PCURVE_STATS=1`. Run it over all 72 corpus files. This is the **only** way to
size the §3 residual, and it is a prerequisite for P4 as well as a safety net for P2.

Then swap `:969-970` → `occtheal::projectPointOnCurve(c, P, Precision::Confusion(), proj, u,
false)` and `:1239/1292/1293` → `occtheal::valueOfUV(surf, Pf3, prec)` / `(surf, Pl3, prec)`.
**Diff in §6, diff 5.**

**Proof:**
1. `scripts/occt_drop_gate.sh TKShHealing` → 9.
2. `nm -u … | c++filt | grep -cE 'ShapeAnalysis_Surface|ShapeAnalysis_Curve'` → **0**.
3. `node test/step_read_corpus_gate.mjs --verify` → **72/72, rel-tol 1e-9 on volume and
   area, exact on faces / edges / closed / manifold / oriented / χ / genus.** This is the
   load-bearing assertion: it is the only test in the repo that executes the native reader
   over real geometry, and χ/genus is what catches the crack a matching volume hides.
4. `FORGE_STEP_PCURVE_STATS=1` totals identical to the P2.0 baseline (proves the swap did
   not change which pcurves bind).
5. `node test/golden_corpus.mjs --verify` → 72/72 gateable.
6. Standing gates; `otool` still 8. Linux CI.

---

### P3 — drop group E (9 → 6). General OCCT-shape `UnifySameDomain`.

`UnifyFaces.cpp` covers `NativeSolid` handles only. Two options, in preference order:

**P3a (preferred).** Generalise `UnifyFaces.cpp` to accept an OCCT-backed handle by routing
`importOcctSolid → unifySameDomain{Planar,Curved,Bored} → occtFromNativeSolid`, and keep the
existing honest defer for every ineligible body — but **route the defer to a null result,
not to OCCT**, only once `native_unify_smoke.mjs` covers the deferred classes natively.

**P3b.** Accept a narrower `simplifyShape`/`unifyFaces` contract and document the loss.
**REJECTED under Law 9** — dropping a library by deleting the capability is forbidden.

**Do not retry** the 2026 G1 experiment (report §4 item 3, commit `bb520463`): bridge-level
`ShapeUpgrade_UnifySameDomain` coalescing inside `occtFromNativeSolid` fixed face identity
and passed core 34/34 + face-census 18/18 but regressed `coherence_logic` 8/8 → ~3/10,
because the coalesced periodic face tessellates non-watertight — and a
`BRepCheck_Analyzer.IsValid()` + volume guard did **not** catch it.

**Proof:**
1. `scripts/occt_drop_gate.sh TKShHealing` → 6; `nm -u | grep -c ShapeUpgrade` → 0.
2. `node test/native_unify_smoke.mjs` → today's baseline `3/3 planar + 2/2 cyl + 2/2 cone +
   2/2 sphere + 2/2 torus + 1/1 bored A/B + 1/1 deferred` — plus new cases for every class
   that currently defers to OCCT.
3. **`node test/coherence_logic_score.mjs` must not regress** — this is the specific gate the
   prior attempt reddened; it is mandatory here, not optional.
4. `node test/healing_smoke.js` `simplifyShape` face/edge counts unchanged on the box (6→6,
   12→12) and on a fused-cap solid where the merge is real.
5. Standing gates; `otool` still 8. Linux CI.

---

### P4 — drop group A (6 → 0) and the library (otool 8 → 7).

Four capabilities, in dependency order:

**P4.1 `occtconv::pointsToBSpline2d`** — the `Geom2d` twin of `pointsToBSpline`, with the
sane-net overshoot guard (`CMakeLists.txt:225-234`). *Proof:* a new pure-C++ gate under
`test/native/geom/` (run_native 140 → 141) asserting exact reproduction of a 2D line, a 2D
circle and a known B-spline to 1e-12, plus a pole-magnitude bound versus the input hull.

**P4.2 `occtheal::projectCurveOnSurface(c3, surf, u0,u1,v0,v1) -> Handle(Geom2d_Curve)`** —
analytic fast paths first (line/circle on plane/cylinder/cone → exact 2D line or circle),
seam-unwrapped sample-and-fit otherwise via P4.1. *Proof:* round-trip assertion — for each
of {plane, cylinder, cone, sphere, torus, B-spline} and each of {line, circle, spline}, the
synthesised pcurve must satisfy `|S(c2(t)) − c3(t)| ≤ 1e-9` over 200 samples.

**P4.3 seam / `FixShifted` equivalent** (§3.3) — for a wire on a periodic surface, shift each
pcurve by `k·period` so consecutive edges are contiguous in (u,v), and order the seam pcurve
pair fwd/rev. *Proof:* import every corpus file containing a closed cylinder/sphere/torus and
assert `BRepCheck_Analyzer(shape, true).IsValid()` **plus** χ/genus exact — the wire
discontinuity `IsValid()` alone misses is the same class of defect as G1's.

**P4.4 rich DONE/FAIL semantics** for `Healing.cpp:488` and `ShapeFix.cpp:295`. The native
report is *richer* (`NativeShapeHealBridge.hpp:92-118` gives named counts, not 8 bits); the
mapping is already specified at `NativeShapeHealBridge.cpp:258-264`. **This is a
representation change and must be declared as one** — the JS contract
(`RepairReport.fixedWires/fixedSmallFaces/fixedOrientation/fixedTolerance/
fixedSelfIntersection/fixersFired`) is asserted-on today: `test/healing_smoke.js` currently
prints `fixedOrientation: true, fixersFired: 1` for a clean box. Preserve the field names,
synthesise them from the counts, and freeze the box's report in the test.
**Also still open:** `NativeShapeHealBridge.cpp:274-292` §A (surface-preserving heal rebuild —
without it a *changed* curved body facets on export) and §B (lenient face-soup importer —
without it `fixShapeGeneral` cannot reach the broken inputs it is called for). Neither is
optional for P4; both are named in the file itself.

**Then** the flip: make every A-site native-or-throw under `FORGE_SHHEAL_DROP_NATIVE`,
remove `TKShHealing` from `OCCT_LIBS` (`CMakeLists.txt:161-166`).

**Proof of P4:**
1. `scripts/occt_drop_gate.sh TKShHealing` → `EXCLUSIVE: 0`, `VERDICT: DROP-SAFE`.
2. `otool -L build/Release/forge-kernel.node | grep -c opencascade` → **7**, and
   `otool -L | grep -c TKShHealing` → **0**, **with no `list(APPEND OCCT_LIBS …)`
   compensation** (§4.1 proves none is needed — if the link demands one, the subset claim
   was wrong and the step must be re-analysed, not patched).
3. `nm -u build/Release/forge-kernel.node | c++filt | grep -cE '^Shape(Fix|Analysis|Upgrade)_'` → **0**.
4. `node test/step_read_corpus_gate.mjs --verify` → 72/72 at the P0.2 freeze.
5. `node test/golden_corpus.mjs --verify` → all gateable PASS.
6. `bash test/native/run_native.sh` → 141/141 (140 today + P4.1).
7. `npm run forge:kernel:test` full chain; `node test/coherence_logic_score.mjs` no regression.
8. Standing gates 20/20, 9/9, ALL PASS.
9. **TRUE gate:** Models-OS STEP-import battery 13/13. *Honest note: as in the 07-30 report,
   I could not locate a canonical runner file for this; the only in-repo references are
   `reports/KERNEL_DROP_MASTER_PLAN.md:45` and `scripts/archie_os/routers.py:147`. Pin the
   runner path before relying on it.*
10. Linux CI "Kernel + Guards" strict-link. Revert-if-red.

---

## 6. Proposed patches (DIFFS — apply, do not assume applied)

### Diff 1 — `test/build_golden_corpus_measure.sh`: repair the golden-corpus gate

The OCCT-free native layer must be compiled **without** `-DFORGE_NATIVE_BREP`, so the
OCCT-typed boundary TUs become empty objects (this is exactly what `test/native/run_native.sh`
already does — `FLAGS="-std=c++20 -O2"`, no define). Adding `-I "$OCCT_INC"` instead pulls in
`NativeOcctBridge`/`OcctNativeMesh`/`ShapeRegistry`/`OcctPrimBuilder` and cascades; this
version is the minimal one. **Verified: builds clean, and `golden_corpus.mjs --verify
--limit 10` → PASS 10 · FAIL 0.**

```diff
--- a/forge-kernel/test/build_golden_corpus_measure.sh
+++ b/forge-kernel/test/build_golden_corpus_measure.sh
@@
 FLAGS="-std=c++20 -O2 -DFORGE_NATIVE_BREP"
+# The OCCT-FREE native layer compiles WITHOUT -DFORGE_NATIVE_BREP: the OCCT-typed
+# boundary TUs (NativeProjection / NativeNurbsConvert / NativeShapeHeal /
+# NativeShapeHealBridge / StepRead|WriteOcct / NativeFilletChamfer / ...) are wrapped
+# in `#ifdef FORGE_NATIVE_BREP` and become empty objects, exactly as in
+# test/native/run_native.sh. Without this the script has been RED since those files
+# landed (2026-07-25): "fatal error: 'gp_Pnt.hxx' file not found".
+NFLAGS="-std=c++20 -O2"
 JOBS="${JOBS:-$( (command -v nproc >/dev/null && nproc) || sysctl -n hw.ncpu 2>/dev/null || echo 4 )}"
@@
-compile() { if ! $CXX $FLAGS -I "$INC" -c "$1" -o "$2" 2>"$2.err"; then echo "SRC FAIL: $1" >&2; tail -12 "$2.err" >&2; echo x>>"$FAIL"; fi; }
+compile() { if ! $CXX $NFLAGS -I "$INC" -c "$1" -o "$2" 2>"$2.err"; then echo "SRC FAIL: $1" >&2; tail -12 "$2.err" >&2; echo x>>"$FAIL"; fi; }
```

### Diff 2 — new `test/step_read_corpus_gate.mjs`: the missing STEP-reader gate

Full source is at
`/private/tmp/claude-501/-Users-account-clawteam1/d653c3c3-36e1-47f7-a422-af8248b8f360/scratchpad/step_read_corpus_gate.mjs`
and the frozen baseline at `…/scratchpad/step_read_corpus.json` (72 models). Move both to
`forge-kernel/test/` (the script already defaults its paths to the kernel tree; the env
overrides `FORGE_KERNEL_ROOT` / `FORGE_STEP_FREEZE` / `FORGE_STEP_CORPUS` exist only for the
out-of-tree run). It drives `forge.io.importStep` (→
`IoExchange.cpp:92` → `native::brep::foreignStepToOcct`), and per file records
`volume, area, faces, edges, closed, manifold, oriented, euler, genus` — χ/genus computed
from a position-welded tessellation so it is faceting-independent (the K5 rule).
`--freeze` writes the oracle, `--verify` asserts rel-tol `1e-9` on volume/area and exact
equality on everything else. Measured deterministic: 72/72 on a re-run.

*Note when running it:* keep `FORGE_NATIVE_FEATURES` at its default. With the FEAT gate on,
two files shift area by 2–6e-4 (`cadgen_6379bba34006859c`, `cadgen_efb51dbf731f2a72`) — that
is the native analytic mass-properties path, **not** the reader, but it makes the gate
non-comparable across settings.

### Diff 3 — `CMakeLists.txt`: the drop scaffold (mirrors `FORGE_FILLET_DROP_NATIVE`)

```diff
--- a/forge-kernel/CMakeLists.txt
+++ b/forge-kernel/CMakeLists.txt
@@ (after the FORGE_FILLET_DROP_NATIVE block, ~:207)
+# FORGE_SHHEAL_DROP_NATIVE routes the TKShHealing call sites onto the in-house
+# forge::occtheal peers (src/native/brep/NativeShapeHeal.cpp) and COMPILES OUT the OCCT
+# ShapeAnalysis_*/ShapeFix_* fallback at each site (native-or-throw under the macro, OCCT
+# baseline under #else) — the FORGE_FILLET_DROP_NATIVE pattern.
+#   DEFAULT ON at P1 scope: groups B/C/D (ShapeFix_Solid, ShapeAnalysis_Shell,
+#   ShapeAnalysis_FreeBounds — 8 of the 20 symbols) have EXACT native peers that are
+#   already compiled into the binary and A/B-green. OFF rebuilds the OCCT baseline for an
+#   apples-to-apples A/B.
+#   TKShHealing is NOT removed from OCCT_LIBS here: 12 symbols remain (ShapeFix_Shape x6,
+#   ShapeUpgrade_UnifySameDomain x3, ShapeAnalysis_Surface x2, ShapeAnalysis_Curve x1).
+#   See reports/TKSHHEALING_DROP_PLAN.md for the P1..P4 series that takes it to 0.
+#   ★ MEASURED 2026-07-30: unlike TKFillet (whose drop takes otool 8 -> 9 because TKBO and
+#   TKG2d were reaching the link only through it), TKShHealing's DT_NEED set
+#   {TKBRep TKG2d TKG3d TKGeomAlgo TKGeomBase TKMath TKTopAlgo TKernel} is a strict SUBSET
+#   of both TKFillet's and TKOffset's, which stay. Its drop is a clean 8 -> 7.
+option(FORGE_SHHEAL_DROP_NATIVE
+       "route the healing call sites native & compile out the OCCT ShapeFix/ShapeAnalysis fallback"
+       ON)
+if(FORGE_NATIVE_BREP AND FORGE_SHHEAL_DROP_NATIVE)
+    add_compile_definitions(FORGE_SHHEAL_DROP_NATIVE=1)
+    message(STATUS "FORGE_SHHEAL_DROP_NATIVE=ON — ShapeFix_Solid/ShapeAnalysis_Shell/"
+                   "ShapeAnalysis_FreeBounds fallbacks compiled out (TKShHealing 20 -> 12 symbols)")
+endif()
```

### Diff 4 — `src/Healing.cpp`: P1, groups B + C + D (−8 symbols)

```diff
--- a/forge-kernel/src/Healing.cpp
+++ b/forge-kernel/src/Healing.cpp
@@ -13,13 +13,17 @@
 #include <GProp_GProps.hxx>
 #include <GeomAbs_Shape.hxx>
 #include <Precision.hxx>
-#include <ShapeAnalysis_FreeBounds.hxx>
-#include <ShapeAnalysis_Shell.hxx>
-#include <ShapeAnalysis_ShapeContents.hxx>
-#include <ShapeAnalysis_ShapeTolerance.hxx>
+// DEAD (verified 0 uses, 2026-07-30): ShapeAnalysis_ShapeContents,
+// ShapeAnalysis_ShapeTolerance, ShapeFix_ShapeTolerance — removed.
+#ifndef FORGE_SHHEAL_DROP_NATIVE
+#include <ShapeAnalysis_FreeBounds.hxx>
+#include <ShapeAnalysis_Shell.hxx>
+#include <ShapeFix_Solid.hxx>
+#endif
 #include <ShapeFix_Shape.hxx>
-#include <ShapeFix_ShapeTolerance.hxx>
-#include <ShapeFix_Solid.hxx>
 #include <ShapeUpgrade_UnifySameDomain.hxx>
 #include <TopAbs_Orientation.hxx>
@@ -86,6 +90,7 @@
 #ifdef FORGE_NATIVE_BREP
 #include "forge/native/brep/NativeRoute.hpp"   // forgeNativeFeaturesEnabled()
+#include "forge/native/brep/NativeShapeHeal.hpp" // occtheal::{freeBounds,orientSolidOutward,solidFromShell,shellOrientationConsistent}
 #include "forge/native/brep/Heal.hpp"          // healBRep, HealOptions, HealReport (native)
```

```diff
@@ -403,12 +408,23 @@ AutoFillResult autoFillMissingFaces(ShapeHandle shape, double tolerance) {
     rep.openEdgesBefore = countFreeEdges(s);
 
     // Detect free wires (closed loops of free edges) we can cap.
-    // ShapeAnalysis_FreeBounds returns a compound of wires in OCCT 7.9.
-    ShapeAnalysis_FreeBounds analyzer(s, tolerance,
-                                      /*splitClosed*/ Standard_False,
-                                      /*splitOpen*/   Standard_False);
-    const TopoDS_Compound& closedWires = analyzer.GetClosedWires();
+#if defined(FORGE_NATIVE_BREP) && defined(FORGE_SHHEAL_DROP_NATIVE)
+    // NATIVE (TKShHealing-free): free edges = edges with exactly one face ancestor,
+    // chained into closed loops / open chains. Same contract as
+    // ShapeAnalysis_FreeBounds(s, tol, splitClosed=F, splitOpen=F) + GetClosedWires().
+    const forge::occtheal::FreeBounds fb = forge::occtheal::freeBounds(s, tolerance);
+    const TopoDS_Compound& closedWires = fb.closedWires;
+#else
+    // ShapeAnalysis_FreeBounds returns a compound of wires in OCCT 7.9.
+    ShapeAnalysis_FreeBounds analyzer(s, tolerance,
+                                      /*splitClosed*/ Standard_False,
+                                      /*splitOpen*/   Standard_False);
+    const TopoDS_Compound& closedWires = analyzer.GetClosedWires();
+#endif
```

```diff
@@ -442,14 +458,22 @@
     if (sewn.ShapeType() == TopAbs_SHELL && BRep_Tool::IsClosed(TopoDS::Shell(sewn))) {
         BRepBuilderAPI_MakeSolid mk(TopoDS::Shell(sewn));
         if (mk.IsDone()) {
-            // Sanity-check + orient the solid outwards.
-            Handle(ShapeFix_Solid) fix = new ShapeFix_Solid(mk.Solid());
-            fix->Perform();
-            if (fix->Solid().IsNull()) {
-                result = mk.Solid();
-            } else {
-                result = fix->Solid();
-            }
+#if defined(FORGE_NATIVE_BREP) && defined(FORGE_SHHEAL_DROP_NATIVE)
+            // NATIVE: reverse when the signed volume is negative — the net effect this
+            // site consumes from ShapeFix_Solid::Perform() (outward normals). Never null.
+            const TopoDS_Shape oriented = forge::occtheal::orientSolidOutward(mk.Solid());
+            result = oriented.IsNull() ? TopoDS_Shape(mk.Solid()) : oriented;
+#else
+            // Sanity-check + orient the solid outwards.
+            Handle(ShapeFix_Solid) fix = new ShapeFix_Solid(mk.Solid());
+            fix->Perform();
+            if (fix->Solid().IsNull()) {
+                result = mk.Solid();
+            } else {
+                result = fix->Solid();
+            }
+#endif
         }
     } else if (sewn.ShapeType() == TopAbs_COMPOUND) {
```

```diff
@@ -521,17 +545,33 @@ ShapeHandle harmonizeNormals(ShapeHandle shape) {
     // For each shell, run ShapeAnalysis_Shell + ShapeFix_Solid for the
     // outward orientation. We don't change face wires.
     for (TopExp_Explorer ex(work, TopAbs_SHELL); ex.More(); ex.Next()) {
         TopoDS_Shell sh = TopoDS::Shell(ex.Current());
-        ShapeAnalysis_Shell ana;
-        ana.LoadShells(sh);
-        ana.CheckOrientedShells(sh, /*alsofree*/ Standard_True);
+#if defined(FORGE_NATIVE_BREP) && defined(FORGE_SHHEAL_DROP_NATIVE)
+        // NATIVE peer of LoadShells + CheckOrientedShells. The OCCT call DISCARDED its
+        // result (it was a diagnostic no-op); the behaviour is preserved EXACTLY —
+        // the capability is not removed, only re-implemented. Law 9.
+        (void)forge::occtheal::shellOrientationConsistent(sh);
+#else
+        ShapeAnalysis_Shell ana;
+        ana.LoadShells(sh);
+        ana.CheckOrientedShells(sh, /*alsofree*/ Standard_True);
+#endif
     }
 
     if (work.ShapeType() == TopAbs_SHELL && BRep_Tool::IsClosed(TopoDS::Shell(work))) {
-        Handle(ShapeFix_Solid) fs = new ShapeFix_Solid();
-        TopoDS_Solid solid = fs->SolidFromShell(TopoDS::Shell(work));
+#if defined(FORGE_NATIVE_BREP) && defined(FORGE_SHHEAL_DROP_NATIVE)
+        // NATIVE: MakeSolid(shell) + signed-volume outward flip.
+        TopoDS_Solid solid = forge::occtheal::solidFromShell(TopoDS::Shell(work));
+#else
+        Handle(ShapeFix_Solid) fs = new ShapeFix_Solid();
+        TopoDS_Solid solid = fs->SolidFromShell(TopoDS::Shell(work));
+#endif
         if (!solid.IsNull()) {
             work = solid;
         }
     }
```

> `Healing.cpp:517` (`ShapeFix_Shape` in `harmonizeNormals`) is deliberately **left alone in
> P1** — it is group A, so changing it buys zero symbols and only adds risk. It moves in P4.

### Diff 5 — `src/native/brep/StepReadOcct.cpp`: P2, groups F + G (−3 symbols)

**Do not apply before P0.2 (the reader gate) and P2.0 (the pcurve counter).**

```diff
@@ -963,10 +963,17 @@
 double paramOnCurve(const Handle(Geom_Curve)& c, const gp_Pnt& P, double tol, double& dist) {
     const double cf = c->FirstParameter(), cl = c->LastParameter();
     gp_Pnt proj;
     double u = cf;
-    ShapeAnalysis_Curve sac;
-    dist = sac.Project(c, P, Precision::Confusion(), proj, u, Standard_False);
+#if defined(FORGE_NATIVE_BREP) && defined(FORGE_SHHEAL_DROP_NATIVE)
+    // NATIVE (TKShHealing-free): closed form for Line/Circle, sampled Gauss-Newton
+    // otherwise. adjustToEnds=false — the EXACT endpoint snap below is unchanged.
+    dist = forge::occtheal::projectPointOnCurve(c, P, Precision::Confusion(), proj, u,
+                                                /*adjustToEnds*/ false);
+#else
+    ShapeAnalysis_Curve sac;
+    dist = sac.Project(c, P, Precision::Confusion(), proj, u, Standard_False);
+#endif
     const double dF = P.Distance(c->Value(cf));
```

```diff
@@ -1236,7 +1243,9 @@
     const double vScale = pcurveVScale(X.R, surfId, X.scale);
     const TopLoc_Location loc0;
-    Handle(ShapeAnalysis_Surface) sas = new ShapeAnalysis_Surface(surf);  // shared inverter
+#if !defined(FORGE_NATIVE_BREP) || !defined(FORGE_SHHEAL_DROP_NATIVE)
+    Handle(ShapeAnalysis_Surface) sas = new ShapeAnalysis_Surface(surf);  // shared inverter
+#endif
     BRep_Builder b;
@@ -1289,8 +1298,15 @@
                 gp_Pnt Pf3, Pl3;
                 c3->D0(f, Pf3); c3->D0(l, Pl3);
-                gp_Pnt2d uvF = sas->ValueOfUV(Pf3, prec);
-                gp_Pnt2d uvL = sas->ValueOfUV(Pl3, prec);
+#if defined(FORGE_NATIVE_BREP) && defined(FORGE_SHHEAL_DROP_NATIVE)
+                // NATIVE inversion: closed form for Plane/Cyl/Cone/Sphere/Torus,
+                // grid-seeded Gauss-Newton otherwise. Stateless — no shared handle.
+                gp_Pnt2d uvF = forge::occtheal::valueOfUV(surf, Pf3, prec);
+                gp_Pnt2d uvL = forge::occtheal::valueOfUV(surf, Pl3, prec);
+#else
+                gp_Pnt2d uvF = sas->ValueOfUV(Pf3, prec);
+                gp_Pnt2d uvL = sas->ValueOfUV(Pl3, prec);
+#endif
```

plus, in the include block (`:64`, `:81`, `:91-93`): guard `ShapeAnalysis_Surface.hxx` and
`ShapeAnalysis_Curve.hxx` under `#ifndef FORGE_SHHEAL_DROP_NATIVE`, delete the dead
`ShapeFix_Shell.hxx` at `:92`, and add
`#include "forge/native/brep/NativeShapeHeal.hpp"`.

---

## 7. Risk register

| # | risk | mitigation |
|---|---|---|
| 1 | `occtheal::projectPointOnCurve` clamps to `[First,Last]`; OCCT's `Project` on a periodic curve may not. A `Geom_TrimmedCurve`-wrapped circle also misses the closed form and takes 32-sample Newton. | P2.0 counter + `step_read_corpus_gate` at rel-tol 1e-9. If a fixture moves, add a `Geom_TrimmedCurve` unwrap to the `DownCast` chain before widening the tolerance. |
| 2 | `orientSolidOutward` implements only the *net effect* of `ShapeFix_Solid::Perform()`; the OCCT call also re-orients individual faces inside the shell. | Both call sites feed it a solid built from an **already sewn** closed shell, so face orientation is already consistent. Gated by strengthened `healing_smoke.js` χ/genus. |
| 3 | P4 lands a *representation change* in `RepairReport` (8 status bits → named counts). | Field names preserved and synthesised; freeze the clean-box report (`fixedOrientation: true, fixersFired: 1`) as an assertion first. |
| 4 | `fixShapeGeneral` **facets** a changed curved body (`NativeShapeHealBridge.cpp:224-228`) — the K6/K7 faceting root cause. | P4 cannot land without §A (surface-preserving heal rebuild). Do not ship a "fixed" curved body that lost its analytic surfaces. |
| 5 | `scripts/occt_drop_gate.sh` mis-computes `EXCLUSIVE` (regex `libTK[A-Za-z0-9]+\.dylib` never matches brew's `libTKernel.7.9.dylib`; verified emits nothing). Here it happens to be right because overlap is 0, but it cannot detect the thing it exists to detect. | Apply the one-character fix `\.[0-9.]*dylib` before relying on it as a P1/P2 gate. Already documented in the 07-30 report §5.1 — still unfixed. |
| 6 | P1/P2/P3 move the symbol count but **not** `otool` and **not** the load closure. | Report both numbers. `otool` moves only at P4. |

---

## 8. Where the docs / prior reports contradict the code (code and measurement win)

**8.1 `NativeShapeHeal.cpp:640-641` and `NativeShapeHealBridge.cpp:300-305` both say the
files are "not yet listed in CMake".** They are: `CMakeLists.txt:729` and `:730`. All 11
`forge::occtheal::*` entry points are present as `T` symbols in the shipping
`forge-kernel.node`.

**8.2 `reports/OCCT_ZERO_NEXT_STEP_2026-07-30.md` §3.1 ranks TKFillet above TKShHealing.**
The ranking predates the closure measurement now recorded at `CMakeLists.txt:191-206`:
dropping TKFillet takes `otool` **8 → 9**; dropping TKShHealing takes it **8 → 7** cleanly
(§4.1). The blast-radius argument in that section remains correct; the conclusion no longer
follows from it alone.

**8.3 The same report's §1.2 lists TKShHealing's residuals as "(a) pcurve synthesis, (b)
rich DONE/FAIL, (c) general OCCT-shape unify".** Correct as far as it goes, but incomplete:
`StepReadOcct.cpp:1388` names **`ShapeFix_Wire::FixShifted`** — seam/period pcurve
reconciliation — as a load-bearing dependency, and the reader deliberately sets
`SameRange(false)`/`SameParameter(false)` (`:1382-1383`, `:1399-1400`) to hand that job to the
heal. `BRepLib::SameParameter` does not do it. That is a **fourth** residual (§3.3).

**8.4 The same report's §1.2 row count ("13 live call sites").** There are **17 distinct
statements** across 5 files (§1.2), which collapse to 12 logical sites. The difference
matters only for effort estimation, not for the symbol arithmetic.

**8.5 `docs/K_TKSHHEALING_DROP_BRIEF.md`.** Two errors, both already flagged in the 07-30
report §5.2/§5.3 and both re-confirmed today: `BRepBuilderAPI_Sewing` is a **TKTopAlgo**
export (`nm -gU libTKShHealing` finds 0 Sewing symbols), and "no native `ShapeUpgrade`
anywhere" is false — `src/native/brep/UnifyFaces.cpp` is 1224 lines and is wired at
`DirectEdit.cpp:100-131`.

**8.6 `test/golden_corpus.mjs` is not a STEP-reader gate.** Its measure TU reads STEP with
`STEPControl_Reader` (`test/golden_corpus_measure.cpp:186-187`) and links `-lTKDESTEP
-lTKXSBase`, i.e. the toolkits the native reader replaced. It gates the **importer**, not the
**reader**. Anything that says otherwise is wrong. (It is also currently unbuildable — §5 P0.1.)

---

## Appendix — verbatim commands

```
$ otool -L build/Release/forge-kernel.node | grep -c opencascade
8
$ nm -u build/Release/forge-kernel.node | sed 's/^ *//;s/^_//' | sort -u > undef.txt; wc -l < undef.txt
788
$ nm -gU /opt/homebrew/opt/opencascade/lib/libTKShHealing.7.9.dylib | awk '{print $3}' \
    | sed 's/^_//' | sort -u > exp_TKShHealing.txt
$ comm -12 undef.txt exp_TKShHealing.txt | wc -l
20
$ comm -12 <(comm -12 undef.txt exp_TKShHealing.txt) \
           <(cat exp_TKernel.txt exp_TKMath.txt exp_TKG3d.txt exp_TKBRep.txt \
                 exp_TKTopAlgo.txt exp_TKOffset.txt exp_TKFillet.txt | sort -u) | wc -l
0                                   # all 20 are exclusive

$ otool -L /opt/homebrew/opt/opencascade/lib/libTKShHealing.7.9.dylib | grep -oE 'libTK[A-Za-z0-9]+' | sort -u | tr '\n' ' '
libTKBRep libTKG2d libTKG3d libTKGeomAlgo libTKGeomBase libTKMath libTKShHealing libTKTopAlgo libTKernel
$ otool -L /opt/homebrew/opt/opencascade/lib/libTKFillet.7.9.dylib | grep -oE 'libTK[A-Za-z0-9]+' | sort -u | tr '\n' ' '
libTKBO libTKBRep libTKBool libTKFillet libTKG2d libTKG3d libTKGeomAlgo libTKGeomBase libTKMath libTKPrim libTKShHealing libTKTopAlgo libTKernel
                                    # TKShHealing's DT_NEED ⊂ TKFillet's ⊂ TKOffset's

$ nm build/Release/forge-kernel.node | c++filt | grep -c '^.* T forge::occtheal::'
11                                  # every native peer IS compiled in

# gates, baseline 2026-07-30 (default FEAT off)
$ node test/ft/ft_unified_edit.mjs   →  20 passed
$ node test/directedit.mjs           →  9/9 DirectEdit tests passed
$ node test/ft/ft_smoke.mjs          →  ===== ALL PASS =====
$ node test/healing_smoke.js         →  [heal-smoke] ALL PASS
$ node test/native_unify_smoke.mjs   →  3/3 planar + 2/2 cyl + 2/2 cone + 2/2 sphere
                                        + 2/2 torus + 1/1 bored A/B + 1/1 deferred

# same gates with the light-heal native peer ON
$ FORGE_NATIVE_FEATURES=1 node test/directedit.mjs        →  9/9
$ FORGE_NATIVE_FEATURES=1 node test/ft/ft_unified_edit.mjs →  20 passed
$ FORGE_NATIVE_FEATURES=1 node test/ft/ft_smoke.mjs        →  ALL PASS
$ FORGE_NATIVE_FEATURES=1 node test/healing_smoke.js       →  ALL PASS

# the new STEP-reader gate (P0.2)
$ node step_read_corpus_gate.mjs --freeze  →  72 models, 3 pre-existing import errors
$ node step_read_corpus_gate.mjs --verify  →  72 pass / 0 fail of 72
   (12 files emit "[K5][viewport] N face(s) of M DEFERRED (no BRepMesh)";
    tally = 119 / 10,589 faces = 1.124% — the OcctNativeMesh.cpp:603/688 rational-pcurve
    trim residual, a display gap, not a link gap)

# golden-corpus gate, before and after the diff-1 fix
$ node test/golden_corpus.mjs --verify --limit 8   (before) → measure-TU build failed
$ node test/golden_corpus.mjs --verify --limit 10  (after)  → PASS 10 · FAIL 0 ·
                                                     OCCT-DELETION GATE GREEN

# corpus pcurve audit (offline STEP-text parse, 72 files)
  planar faces 72,634 · non-planar faces 40,242 · non-planar edges 168,979
  non-planar edges with NO file PCURVE: 0
  originating system: 'Open CASCADE STEP processor 7.9' x72
```

Working files (scratchpad, not committed):
`pcurve_audit.py`, `step_read_corpus_gate.mjs`, `step_read_corpus.json`,
`bgcm.sh` (the patched build script), `tksh/` (symbol sets).

---

*Produced 2026-07-30. No kernel source or header was modified; `NativeFilletChamfer.cpp` and
`FeatureTreeCompiler.cpp` were not touched. Sacrosanct §3; Prime Directive 8 (nothing here is
an estimate dressed as a measurement) and Prime Directive 6 (`otool` alone is a proxy — §4.1
reports the closure too). Two blockers are stated rather than papered over: the
`attachFilePcurves` rejection rate is UNMEASURED and needs the P2.0 counter, and the
Models-OS 13/13 runner path is still unpinned.*
