# OCCT-zero — next step (2026-07-30)

**Read-only analysis. No file under `forge-kernel/src` or `forge-kernel/include` was
touched.** Every number below was measured on this machine from the built artifact
`build/Release/forge-kernel.node` with `otool`, `nm`, `c++filt`, and by reading the
source. Where a doc disagrees with the code, **the code wins and I say so
explicitly** (§5).

The kernel was rebuilt underneath this analysis (artifact mtime 09:06:21 → 09:35:24).
Every headline number was **re-measured on the 09:35:24 artifact and is unchanged**:
`otool` count 8, same 8 toolkits, 783 undefined symbols, TKFillet 11, TKShHealing 20.

Method: `nm -u` on the `.node` → 783 undefined symbols; `nm -gU` on each linked
OCCT dylib → its export set; intersect. Working files in the session scratchpad.

---

## 0. Ground truth, measured

```
$ otool -L build/Release/forge-kernel.node | grep -c opencascade
8
```

The 8, in link order, identical for `forge-kernel.node` and `libforge_kernel_core.dylib`:

```
libTKernel.7.9  libTKMath.7.9  libTKG3d.7.9  libTKBRep.7.9
libTKTopAlgo.7.9  libTKShHealing.7.9  libTKOffset.7.9  libTKFillet.7.9
```

This matches `CMakeLists.txt:161-166` (`set(OCCT_LIBS TKernel TKMath TKG3d TKBRep
TKTopAlgo TKShHealing TKOffset)`) plus the conditional `list(APPEND OCCT_LIBS TKFillet)`
at `CMakeLists.txt:189` (appended because `FORGE_FILLET_DROP_NATIVE` defaults OFF,
`CMakeLists.txt:182-184`).

### Blocking-symbol counts (measured today, not quoted)

| toolkit | symbols the `.node` needs from it | exclusive to it | delta vs 2026-07-24 doc | delta vs 2026-07-25 plan |
|---|---:|---:|---:|---:|
| TKFillet | 11 | 11 | 11 → **11** (flat) | 11 → **11** (flat) |
| TKShHealing | 20 | 20 | 20 → **20** (flat) | 20 → **20** (flat) |
| TKernel | 25 | 25 | — | 24 → **25** |
| TKMath | 25 | 25 | 20 → **25** | 26 → **25** |
| TKOffset | 42 | 42 | 42 → **42** (flat) | 42 → **42** (flat) |
| TKBRep | 80 | 80 | 59 → **80** | 77 → **80** |
| TKTopAlgo | 95 | 95 | 84 → **95** | 95 → **95** (flat) |
| TKG3d | 138 | 138 | 62 → **138** | 118 → **138** |

I verified independently that **no needed symbol is exported by two of the eight**
(`comm -23 need_X union(exports of the other 7)` returns `need_X` unchanged for all
8), so "needed" and "exclusive" coincide here. That is a property of OCCT's toolkit
partitioning, *not* something `scripts/occt_drop_gate.sh` actually checks — see §5.1.

---

## 1. Exactly which 8 remain, and what each is still used for

Determined by demangling each toolkit's blocking symbol set and grepping the live
call sites. Class histograms are from the measured symbol lists.

### 1.1 TKFillet — 11 symbols, 4 live call sites, 2 files

Symbols: `BRepFilletAPI_MakeFillet` {ctor(Shape,ChFi3d_FilletShape), Add(double,Edge),
Add(Array1<gp_Pnt2d>,Edge), Build}, `BRepFilletAPI_MakeChamfer` {ctor(Shape),
Add(d,Edge), Add(d1,d2,Edge,Face), Build}, `ChFi3d_Builder::~ChFi3d_Builder`, + 2 vtables.

| site | op | native path above it? |
|---|---|---|
| `src/Features.cpp:1398` | `filletEdges` const-radius, on a 20 s watchdog thread | yes — `occtfillet::makeFillet` at `Features.cpp:1299`, FEAT-gated |
| `src/Features.cpp:1530` | `variableFilletEdge` (Pnt2d radius-law array) | yes — `occtfillet::makeVariableFillet` at `Features.cpp:1513`, drop-macro-gated only |
| `src/Features.cpp:1744` | `chamferEdges` | yes — `occtfillet::makeChamfer` at `Features.cpp:1711`, FEAT-gated |
| `src/VarFillet.cpp:304` | `varfillet::fillet` (`Law_Linear`/`Law_S`) | yes — `occtfillet::makeVariableFillet` at `VarFillet.cpp:286` |

Every one of the four is already wrapped in `#ifndef FORGE_FILLET_DROP_NATIVE`
(`Features.cpp:1318/1529/1727`, `VarFillet.cpp:303`) with the native attempt made
unconditional and "native-or-throw" under the macro (`Features.cpp:1278/1305`,
`:1491/1519`, `:1680/1717`, `VarFillet.cpp:262/292`). **The drop is a CMake flag
away mechanically; only coverage blocks it.**

### 1.2 TKShHealing — 20 symbols, 13 live call sites, 5 files

Symbols: `ShapeFix_Shape` {ctor, Perform, Shape, Status} + `ShapeFix_Root`/`ShapeFix_Shape`
vtables (6), `ShapeFix_Solid` {2 ctors, SolidFromShell, Solid} (4),
`ShapeAnalysis_Shell` {ctor, LoadShells, CheckOrientedShells} (3),
`ShapeAnalysis_Surface` {ctor, ValueOfUV} (2), `ShapeAnalysis_FreeBounds` {ctor} (1),
`ShapeAnalysis_Curve::Project` (1), `ShapeUpgrade_UnifySameDomain` {ctor, Build, vtable} (3).

| site | fixup | native alternative wired? |
|---|---|---|
| `src/native/brep/StepReadOcct.cpp:969` | `ShapeAnalysis_Curve::Project` — parameter of a vertex on its 3D curve, in the native STEP reader's `paramOnCurve` | **no** (native `occtheal::projectPointOnCurve` exists, unwired) |
| `src/native/brep/StepReadOcct.cpp:1239` | `ShapeAnalysis_Surface` shared inverter for file-pcurve binding | **no** (native `occtheal::valueOfUV` exists, unwired) |
| `src/native/brep/StepReadOcct.cpp:1581` | `ShapeFix_Shape` post-transfer: **synthesises missing pcurves**, SameParameter, orientation | **no** — the ★residual, see §2.2 |
| `src/Healing.cpp:387` | `ShapeUpgrade_UnifySameDomain` (`simplifyShape`) on arbitrary shapes | **no** |
| `src/Healing.cpp:407` | `ShapeAnalysis_FreeBounds` (`autoFillMissingFaces`) | **no** (native `occtheal::freeBounds` exists, unwired) |
| `src/Healing.cpp:446` | `ShapeFix_Solid` orient after cap-sew | **no** (native `occtheal::orientSolidOutward` exists, unwired) |
| `src/Healing.cpp:488` | `ShapeFix_Shape` **rich** repair, reads `ShapeExtend_DONE1..6` | **no** — `tryNativeHeal` runs *ahead* at `:479` but is FEAT-gated and defers on OCCT-backed input |
| `src/Healing.cpp:517,525,531` | `ShapeFix_Shape` + `ShapeAnalysis_Shell` + `ShapeFix_Solid::SolidFromShell` (`harmonizeNormals`) | **no** (all three native peers exist, unwired) |
| `src/ShapeFix.cpp:295` | `ShapeFix_Shape` **rich** repair, `DONE1..8`/`FAIL1..8` + min/max tolerance band | **no** — same gated-`healBRep` situation |
| `src/DirectEdit.cpp:71` | `ShapeFix_Shape` light heal | **yes**, `occtheal::finalizeShape` at `DirectEdit.cpp:68`, behind `forgeNativeFeaturesEnabled()` (**default OFF**) |
| `src/DirectEdit.cpp:136` | `ShapeUpgrade_UnifySameDomain` | partial — native `unifySameDomain{Planar,Curved,Bored}` at `:106/:120/:131`, **NativeSolid handles only** |
| `src/DirectModeling.cpp:513,565,618,721` | `ShapeFix_Shape` light heal after boolean / sew | **yes**, `occtheal::finalizeShape` at `:511/:563/:616/:719`, same default-OFF gate |

### 1.3 TKOffset — 42 symbols, ~17 live call sites, 7 files — the widest algorithm toolkit

8 classes: `BRepOffset_MakeOffset` (`Features.cpp:1002`), `BRepOffsetAPI_MakePipe`
(`Features.cpp:672,740,835`), `BRepOffsetAPI_DraftAngle` (`Features.cpp:1898`),
`BRepOffsetAPI_MakeOffset` 2-D wire offset (`Cam.cpp:309`), `BRepOffsetAPI_MakeFilling`
(`Healing.cpp:420`), `BRepOffsetAPI_ThruSections` (`Airfoil.cpp:624`,
`Primitives.cpp:186`, `Features.cpp:906,2465`, `LoftGuide.cpp:194`),
`BRepOffsetAPI_MakePipeShell` (`ClassASurfacing.cpp:715`, `Features.cpp:683,2414`),
`BRepOffsetAPI_MakeThickSolid` (`Features.cpp:967,2556,2587`),
`BRepOffsetAPI_MakeOffsetShape` (`Features.cpp:1081`). This is shell/thicken, loft,
sweep/pipe, draft, 2-D contour offset, and free-wire cap synthesis — i.e. most of the
feature vocabulary.

### 1.4 TKTopAlgo — 95 symbols — topology construction + sewing + classification

`BRepBuilderAPI_MakeEdge` 11, `BRepBuilderAPI_Sewing` 9, `MakeFace` 9,
`BRepLib_MakeShape` 8, `BRepBuilderAPI_MakeShape` 7, `MakePolygon` 7, `MakeWire` 6,
`MakeSolid` 6, `BRepTopAdaptor_FClass2d` 3 (`OcctNativeMesh.cpp:495`), `BRepLib` 3,
`BRepGProp` 3, `BRepClass3d_SolidClassifier` 3 (`FeaTet.cpp:337,820,862`,
`Fea.cpp:961`), `MakeVertex` 3, `BRepBuilderAPI_FindPlane` 3, `BRepCheck_Analyzer` 2
(`ShapeCheck.cpp:314`, `Healing.cpp:547`), `Transform`/`GTransform` 2 each, `BRepBndLib` 1.

**Note (code beats the docs):** `BRepBuilderAPI_Sewing` is exported by **TKTopAlgo**,
not TKShHealing. `nm -gU` on `libTKShHealing` finds 0 `Sewing` symbols; `libTKTopAlgo`
exports 60. `docs/K_TKSHHEALING_DROP_BRIEF.md` lists sewing as a TKShHealing site
(rows 4,7,8 and the "TKShHealing (… BRepBuilderAPI_Sewing)" header) — that is wrong.
Live sewing sites: `ClassASurfacing.cpp:648`, `Sewing.cpp:202`, `OcctPrimBuilder.cpp:81,289`,
`DirectModeling.cpp:712`, `NativeOcctBridge.cpp` (bridge merge), `Healing.cpp:414`.

### 1.5 TKBRep — 80 symbols — the B-rep data layer

`BRep_Tool` 12, `BRep_Builder` 11, `BRepLProp_CLProps` 8, `BRepAdaptor_Surface` 7,
`BRepTools_WireExplorer` 6, `BRepLProp_SLProps` 6, `BRepAdaptor_Curve` 6, `TopExp` 5,
`BRepTools` 5, `TopExp_Explorer` 4, `TopoDS_Iterator`/`TopoDS_Builder` 2 each,
`TopoDS_T{Wire,Solid,Shell,Shape,Compound}` 1 each, `BRepTools_ReShape` 1. This is
`TopoDS_Shape` itself plus every accessor. Used by essentially every `src/*.cpp`,
**including all of the "native" OCCT-boundary files** (`StepReadOcct.cpp`,
`NativeShapeHeal.cpp`, `NativeFilletChamfer.cpp`, `OcctImport.cpp`, `NativeOcctBridge.cpp`).

### 1.6 TKG3d — 138 symbols — the exact-geometry carrier

`Geom_BSplineSurface` 23, `Geom_BSplineCurve` 17, `GeomLProp_SLProps` 11
(`ClassASurfacing.cpp:595`, `Nurbs.cpp:655,783`), `Geom_BezierSurface` 9,
`GeomAdaptor_Surface` 6, `Geom_BezierCurve` 6, `Geom_ToroidalSurface` 5, `Geom_Plane` 5,
`GProp_GProps` 4, `Geom_SphericalSurface` 4, `Geom_Line` 4, `Geom_CylindricalSurface` 4,
`Geom_ConicalSurface` 4, `Geom_Circle` 4, `Geom_TrimmedCurve` 3,
`Geom_SurfaceOfRevolution` 3, `Geom_RectangularTrimmedSurface` 3, `Geom_Parabola` 3,
`Geom_Hyperbola` 3, `Geom_Ellipse` 3, plus `Geom_SweptSurface`,
`Geom_SurfaceOfLinearExtrusion`, `Geom_OffsetSurface`, `Adaptor3d_*`.

### 1.7 TKMath — 25 symbols — `gp_`, `TopLoc_Location`, `Bnd_Box`, `Poly_Triangulation`, `ElCLib`

Foundation. `gp_Trsf::{SetRotation,SetTransformation,SetMirror,SetValues,Invert}`,
`gp_Ax2/Ax3/Pln` ctors, `ElCLib::{Line,Circle,Ellipse,Parabola,Hyperbola}Parameter`,
`TopLoc_Location` + `TopLoc_SListOfItemLocation`, `Bnd_Box`, `Poly_Triangulation`.

### 1.8 TKernel — 25 symbols — memory, RTTI, exceptions, NCollection bases

`Standard::{Allocate,AllocateOptimal,Reallocate,Free}`, `Standard_Type::Register`,
`Standard_Failure` (ctor/dtor/typeinfo/message/stack), `NCollection_Base{Map,List,Sequence,Allocator}`,
`Standard_Mutex::Lock`, `Message_Report::Clear`. Drops dead last, by construction.

---

## 1b. ★ The `otool == 8` metric measures direct link records, not the dependency closure

`otool -L` lists `LC_LOAD_DYLIB` records. It does **not** list what those dylibs
themselves pull in, and it does not list symbols the `.node` needs but resolves
through a transitively-loaded library.

Measured: of the 783 undefined symbols in the `.node`, **347 are provided by none of
the 8 linked toolkits**, and of those, **67 are OCCT symbols**:

```
37  Geom2d_*        (Geom2d_BSplineCurve 11, Geom2d_BezierCurve 8, Geom2d_Line 4,
                     Geom2d_Ellipse 4, Geom2d_TrimmedCurve 3, Geom2d_Circle 3,
                     Geom2d_Conic 2, …)                              -> TKG2d
30  BRepAlgoAPI_* / BOPAlgo_*  (Section 6, Algo 7, Splitter 3, Fuse 2,
                     Cut 2, Common 2, Defeaturing 2, …)              -> TKBO / TKBool
```

They resolve only because the linked toolkits `DT_NEED` them:

```
TKOffset  needs: TKBO TKBool TKBRep TKernel TKFillet TKG2d TKG3d TKGeomAlgo
                 TKGeomBase TKMath TKOffset TKPrim TKShHealing TKTopAlgo
TKFillet  needs: TKBO TKBool TKBRep TKernel TKFillet TKG2d TKG3d TKGeomAlgo
                 TKGeomBase TKMath TKPrim TKShHealing TKTopAlgo
```

**The real load-time closure is 14 OCCT toolkits**: the 8 direct + TKG2d, TKGeomBase,
TKGeomAlgo, TKBO, TKBool, TKPrim. `TKPrim`, `TKGeomBase` and `TKGeomAlgo` are recorded
as "DROPPED" (commits `22e25a0e`, `ec5b6b7d`, `2f1214d3`) and they *are* off the link
list — but the process still loads them.

More seriously: `BRepAlgoAPI_Fuse/Cut/Common/Section/Splitter/Defeaturing` are **live
kernel calls** (14 files: `Booleans.cpp`, `DirectEdit.cpp`, `DirectModeling.cpp`,
`Features.cpp`, `Mold.cpp`, `SheetMetal.cpp`, `SheetMetalExtended.cpp`, `Weldments.cpp`,
`Nurbs.cpp`, `Drawings.cpp`, `BooleanTol.cpp`, `InterferenceDetection.cpp`,
`binding.cpp`, `native/brep/NativeRoute.cpp`). TKBO/TKBool are load-bearing and were
never actually retired — they merely stopped appearing in `otool -L`.

**Consequence for the sacrosanct north star** (`sacrosanct.md:104`, "otool -L | grep
opencascade == 0"): as currently measured, that target can be reached while the
process still dlopens OCCT. The honest north star is
`nm -u forge-kernel.node | c++filt | grep -cE '^(Geom|gp_|TopoDS|BRep|BOP|Standard|Poly|TopExp|TopLoc|NCollection|Bnd|Adaptor|Shape|Int|Extrema)' == 0`,
or a Linux strict-link with an empty `-lTK*` list. I recommend adding that second
counter to the ledger alongside `otool`. **This is not a reason to stop — it is a
reason to stop reporting `otool` alone.**

---

## 1c. ★ The foundation toolkits are getting *harder*, and it is caused by the drop method itself

Comparing the same script's output across three dated measurements:

| toolkit | 07-24 | 07-25 | **07-30** |
|---|---:|---:|---:|
| TKG3d | 62 | 118 | **138** |
| TKBRep | 59 | 77 | **80** |
| TKTopAlgo | 84 | 95 | **95** |
| TKMath | 20 | 26 | **25** |
| TKFillet / TKShHealing / TKOffset | 11 / 20 / 42 | 11 / 20 / 42 | **11 / 20 / 42** |

The leaf counts are flat; the foundation counts more than doubled for TKG3d. The
cause is visible in the code: every "native" replacement authored since 07-24
(`StepReadOcct.cpp`, `NativeShapeHeal.cpp`, `NativeFilletChamfer.cpp`,
`NativeVariableFillet.cpp`, `NativeThickSolid.cpp`, `NativeSectionFill.cpp`,
`NativeProjection.cpp`, `NativeNurbsConvert.cpp`, `NativeOcctBridge.cpp` analytic
reconstructors) implements **native algebra on OCCT data types**. That is the stated
design (`include/forge/native/brep/NativeShapeHeal.hpp:9-22`: "it consumes/produces
OCCT geometry+topology handles … because every call site is OCCT-typed"). It works —
it drops leaves — but each such file adds fresh `Handle(Geom_BSplineSurface)`,
`BRep_Builder`, `BRepBuilderAPI_MakeEdge` references.

So the sequence "drop leaves with OCCT-typed native code, then drop the foundation"
is self-defeating at the last step. The K7 opaque-handle C-API
(`docs/K6_K7_EXECUTION_BRIEF.md:71-73`) is not the *final consolidation*; it is the
precondition for TKG3d/TKBRep/TKTopAlgo ever moving. **That does not change what to
do next** — the leaves are still worth taking, and each one is a real, CI-provable
win — but it does mean the last four toolkits are a rewrite, not a migration, and
the plan should say so.

---

## 2. Per-library: the native capability that would drop it, and whether it exists today

`src/native/brep/` currently holds 55 files; `src/native/{geom,mesh,cam,csg,implicit,…}`
another ~90; `test/native/` has **140** pure-C++ gate binaries.

| toolkit | capability required to drop it | exists in `src/native/` today? |
|---|---|---|
| **TKFillet** | (a) constant-R rolling-ball blend on a convex straight planar–planar edge of an *arbitrary* `TopoDS_Shape`; (b) the same when the adjacent face **already carries a fillet arc** from a prior edge; (c) a **vertex/corner blend** where ≥2 filleted edges meet; (d) linear-law variable radius; (e) symmetric + asymmetric chamfer | **(a) YES** — `NativeFilletChamfer.cpp` (666 L) `occtfillet::makeFillet/makeChamfer`, local-neighbourhood retrim + sew. **(d) YES** — `NativeVariableFillet.cpp` (573 L), linear law only. **(e) YES** (asym supported: `ChamferSpec::dist2`). **(b) NO** — hard-blocked at `NativeFilletChamfer.cpp:295,310,357` (`allStraight` precondition) → defers at `:474,:485,:543,:558`. **(c) NO.** Analytic engines `FilletAnalytic.cpp` (2910 L) + `ChamferAnalytic.cpp` cover the same envelope on `NativeSolid` only. |
| **TKShHealing** | (1) `ValueOfUV`; (2) `ShapeAnalysis_Curve::Project`; (3) `FreeBounds`; (4) `ShapeFix_Solid` build+orient; (5) `ShapeAnalysis_Shell` orientation check; (6) light `ShapeFix_Shape`; (7) **pcurve synthesis** for a non-planar face with no file pcurve; (8) rich `DONE1..8/FAIL1..8` repair semantics; (9) `UnifySameDomain` on **OCCT-backed** shapes | **(1)–(6) YES** — `NativeShapeHeal.cpp` (647 L) `occtheal::{valueOfUV, projectPointOnCurve, freeBounds, solidFromShell, orientSolidOutward, shellOrientationConsistent, finalizeShape, finalizeShapeCurvedSafe}`; a per-call-site wiring plan is written out verbatim at `NativeShapeHeal.cpp:572-642`. Only 5 of 13 sites are wired, all behind a default-OFF gate. **(7) NO** — declared residual, `NativeShapeHeal.hpp:59-64`. **(8) NO** — `healBRep` (`Heal.cpp`) is the intended peer but is FEAT-gated and defers on OCCT-backed input. **(9) PARTIAL** — `UnifyFaces.cpp` (1224 L) planar + co-cylindrical + bored merges, `NativeSolid` handles only. |
| **TKOffset** | native shell/thicken, solid offset, draft, N-section loft, pipe & pipe-shell sweep, 2-D contour offset, free-wire energy-min cap | mostly YES as engines, **none wired at the OCCT call sites**: `OffsetShape.cpp` (470 L), `NativeThickSolid.cpp` (299 L), `Draft.cpp`/`DraftAnalytic.cpp`, `Loft.cpp`/`LoftSweep.cpp`, `Sweep.cpp`/`HelicalSweep.cpp`, `NativeSectionFill.cpp` (`occtfill::sectionFillSurface`, already replacing `GeomFill_NSections`), `SurfaceFill.cpp`/`GregoryFill.cpp` (cap synthesis, **not wired to a free-wire pipeline**), `geom/PolygonOffset2D.cpp` (the `Cam.cpp:309` 2-D peer). 17 call sites all take general OCCT shapes. |
| **TKTopAlgo** | a native topology *builder* + sewer + solid classifier + validator that the OCCT-typed layer can use **without** `TopoDS_Shape` | engines YES (`Topology.cpp` `TopologyBuilder`, `Sew.cpp` `sewFaces`, `Check.cpp` ~30 predicates, `Query.cpp` point-in-solid/min-distance, `MassProps.cpp`, `Aabb.cpp`), but every consumer is OCCT-typed. **Blocked on K7.** |
| **TKBRep** | replace `TopoDS_Shape` as the kernel's interchange type | `Topology.cpp` is a complete peer; nothing consumes it at the OCCT boundary. **Blocked on K7.** |
| **TKG3d** | replace `Handle(Geom_*)` as the surface/curve interchange type | `Nurbs.cpp`, `NurbsSurface.cpp`, `NurbsAlgebra.cpp`, `NurbsCalculus.cpp`, `Surface.cpp`, `Curve.cpp`, `geom/Bezier.cpp` are complete peers. Declared seam `src/Nurbs.cpp::nativeSurfaceOf()` still returns `nullopt` for every input. **Blocked on K7.** |
| **TKMath** | native `gp_`/`Bnd_Box`/`TopLoc_Location`/`ElCLib` peers | `native/linalg`, `native/geom/Geom.cpp`, `Aabb.cpp` exist. Drop after all of the above. |
| **TKernel** | native allocator/RTTI/exception/collection substrate | trivially available in C++20; drop dead last, purely transitively. |

---

## 3. The single highest-value next drop: **TKFillet** (otool 8 → 7)

### 3.1 Why TKFillet and not TKShHealing

Both have their native engines written. The discriminator is **blast radius** and
**number of net-new capabilities**:

| | TKFillet | TKShHealing |
|---|---|---|
| blocking symbols | 11 | 20 |
| live call sites | 4 | 13 |
| files touched | 2 (`Features.cpp`, `VarFillet.cpp`) | 5, **including `StepReadOcct.cpp`** |
| net-new capabilities needed | **1** (arc-tolerant retrim + corner blend — one geometry problem) | **3** (pcurve synthesis, rich DONE/FAIL semantics, general OCCT-shape unify) |
| drop scaffold authored | **yes** — `FORGE_FILLET_DROP_NATIVE`, `CMakeLists.txt:182-190`, all four call sites already `#ifndef`-guarded | no CMake option exists |
| blast radius on failure | fillet/chamfer ops only | **the STEP import path** — `StepReadOcct.cpp` is the file that replaced TKDESTEP; a regression there costs the benchmark corpus |

TKShHealing's three residuals all sit on the highest-value asset in the kernel (the
native STEP reader). TKFillet's single residual sits on an isolated feature op with a
scaffold already in place. Take the isolated one.

*Rejected alternatives:* TKOffset (42 symbols, 17 sites, 8 unrelated algorithm
families — the widest, not the cheapest). TKG3d/TKBRep/TKTopAlgo/TKMath/TKernel — all
blocked on K7 (§1c), and attempting them now would be the "cheap-leaf era is over"
mistake in reverse.

### 3.2 The exact blocking predicate, at file:line

`src/native/brep/NativeFilletChamfer.cpp:128-140`:

```cpp
bool orderedOuterVertices(const TopoDS_Face& f,
                          std::vector<gp_Pnt>& pts, bool& allStraight) {
    ...
    for (BRepTools_WireExplorer ex(ow, f); ex.More(); ex.Next()) {
        BRepAdaptor_Curve ac(ex.Current());
        if (ac.GetType() != GeomAbs_Line) allStraight = false;   // ← the whole blocker
        pts.push_back(BRep_Tool::Pnt(ex.CurrentVertex()));
    }
```

Its three consumers reject the face outright when `allStraight == false`:
`:295` (`retrimAdjacentFace`), `:310`, `:357` (`clipEndFaceArc`). Those nulls become
the honest deferrals at `:474` / `:543` `"adjacent face has a non-straight outer
boundary"` and `:485` / `:558` `"end face is not a straight-boundary corner"`.

`makeFillet` applies specs **sequentially** against the running shape
(`NativeFilletChamfer.cpp:640-650`, header `:93-97`). So the *first* edge of a
multi-edge request succeeds and leaves a circular arc on each of its two adjacent
faces; the *second* edge that shares one of those faces then hits
`allStraight == false` and the **whole request defers**. That is precisely the
condition `CMakeLists.txt:174-181` describes as the reason the drop flag is OFF.

### 3.3 Implementation approach — four phases, in order

**F1 — arc-tolerant local retrim.** Replace the `(std::vector<gp_Pnt> ring, bool
allStraight)` representation with an ordered *boundary-element* list:
`struct BElem { enum {Line, Arc}; gp_Pnt p0, p1; gp_Circ circ; }`, read per edge from
`BRepAdaptor_Curve::GetType()` → `GeomAbs_Line` or `GeomAbs_Circle` (`ac.Circle()`).
`retrimAdjacentFace` then replaces **only** the one or two elements incident on the
target edge with the offset tangent lines and copies every other element verbatim
into the rebuilt wire via `BRepBuilderAPI_MakeEdge(gp_Circ, p0, p1)`. `planarFaceFromRing`
(`:170`) becomes `planarFaceFromBoundary`, and `ringNormal` (`:154`) uses each arc's
chord for the Newell sign test (already the convention at `:372`). Defer unchanged
for any element that is neither line nor circle. **This alone makes every
vertex-disjoint multi-edge set, and every sequential fillet on non-adjacent faces,
route native.** No new geometry.

**F2 — the corner (vertex) blend — the actual new geometry.** When k ≥ 2 filleted
edges of equal radius R meet at a convex vertex V, the cylinder patches leave an
opening. For **k = 3** (the box corner; the case the gate exercises) the blend is an
*exact spherical patch*, not an iterative rolling-ball solve: the ball centre C is
the unique point at distance R inside all three adjacent planes, i.e. the solution of
the 3×3 linear system `n_i · C = n_i · V + R` (`n_i` = outward unit normals, `i=1..3`;
non-singular for any convex 3-face corner, and `C = V + R(±1,±1,±1)` for an
axis-aligned box). Emit **one** `Geom_SphericalSurface(gp_Ax3(C,…), R)` face trimmed
by the three quarter-circle arcs where the three cylinder blends terminate; trim each
cylinder patch at the corresponding generator. Closed-form, watertight by
construction. **Defer** (honest, not faked) when k > 3, when radii differ, or when
the corner is non-convex. The chamfer analogue is the planar triangle through
`V + d·u_i` — one planar face.

**F3 — freeze the OCCT oracle BEFORE severing it.** `test/native_vs_occt_core.mjs:420`
obtains its reference by calling the *same* binding with `setNativeBrep(false)`:
```js
try { occt = measure(c.build, false); } catch (e) { … fail++; continue; }
```
Under `-DFORGE_FILLET_DROP_NATIVE=ON` the OCCT branch at `Features.cpp:1318-1427` /
`:1727-1780` is compiled out, so that call **throws and the gate reds regardless of
native quality**. Two things must therefore change together with the flip:
1. Build once with the flag **OFF**, dump `{volume, centerOfMass, inertiaCom, bbox,
   sig.euler, sig.genus, brep.faces/edges}` for the three fillet/chamfer cases
   (`:216-217`, `:231-233`, `:237-238`) into a committed fixture, and let
   `measure(…, false)` fall back to the frozen record when the OCCT fillet backend is
   absent. This is the roadmap's own "oracle-removal paradox" rule
   (`OCCT_ZERO_ROADMAP.md:117`) applied to fillet.
2. Fix the backend-kind assertion at `native_vs_occt_core.mjs:426-427`
   (`expectNatKind = c.meshBridge ? 'nativeMesh' : 'nativeSolid'`). Under the drop
   `occtfillet::makeFillet` returns `ShapeRegistry::instance().add(nr.shape)`
   (`Features.cpp:1300`) — an **OCCT-backed** handle, `kindOf == 'occt'`. The three
   cases need their expected kind updated, or `occtfillet` needs to emit a native
   handle. Do not discover this after the build.

**F4 — flip and gate.** `-DFORGE_FILLET_DROP_NATIVE=ON` → rebuild → the gate chain in
§3.4 → remove nothing else; `CMakeLists.txt:189` stops appending TKFillet
automatically.

Honest effort: F1 ≈ 0.5–1 day, F2 ≈ 1–2 days, F3 ≈ 0.5 day, F4 = one serial build
cycle. Nothing here needs a GPU.

### 3.4 The exact test that proves it, and the exact assertion

**Primary — a new pure-native gate that does not need OCCT as an oracle** (essential:
the oracle is what is being deleted).

- **File:** `test/native/brep/fillet_corner_blend_test.cpp`, registered in
  `test/native/run_native.sh` (140 → 141 gates).
- **Case:** cube of side `L = 3.0`, fillet **all 12 edges** with `R = 0.3`.
- **Assertion (closed form, no OCCT):** an all-edge-and-corner-rounded cube of side
  `L` and radius `R` is exactly the Minkowski sum of a cube of side `a = L − 2R` with
  a ball of radius `R`, so by the Steiner decomposition

  ```
  V(L,R) = a³ + 6a²R + 3πR²a + (4/3)πR³ ,   a = L − 2R
  ```

  For `L = 3, R = 0.3` → `a = 2.4`:
  `13.824 + 10.368 + 0.648π + 0.036π = ` **`26.3408493750554186`**

  ```cpp
  const double V    = massProperties(filleted).volume;
  const double Vref = 26.3408493750554186;  // a³+6a²R+3πR²a+(4/3)πR³, a=2.4, R=0.3
  CHECK(std::fabs(V - Vref) / Vref <= 1e-9);          // exact blend, not a mesh
  CHECK(faceCount(filleted) == 26);                   // 6 planes + 12 cylinders + 8 spheres
  CHECK(eulerCharacteristic(filleted) == 2 && genus(filleted) == 0);
  CHECK(isWatertight(filleted));
  ```

  Formula verified numerically at both degenerate limits: `R → 0` gives
  `V → L³ = 27.000000000`, and `R = L/2 = 1.5` (where `a = 0`, so the solid *is* a
  ball) gives `V = 14.137166941` = `(4/3)π·1.5³` exactly. The naive edge-only removal
  `12(1−π/4)R²(L−2R) = 0.55624796` vs the true removal `27 − 26.34084938 = 0.65915062`
  differs by exactly the 8 corner pieces — i.e. **this assertion is precisely the one
  that a corner-blend-less implementation cannot pass**. The current mesh-bridge path
  agrees only to `MESH_TOL`, so `1e-9` is unreachable without F2.

**Secondary — link safety, in this order (each must pass before the next):**

1. `bash scripts/occt_drop_gate.sh TKFillet` must print
   `...of those, EXCLUSIVE to TKFillet (block the drop): 0` and `VERDICT: DROP-SAFE`.
   *(Today it prints `11` / `NOT SAFE` — verbatim output in the appendix.)*
2. `bash test/native/run_native.sh` — 141/141.
3. `FORGE_KERNEL=build/Release/forge-kernel.node node test/native_vs_occt_core.mjs`
   — `ALL n GATES PASS` with the three fillet/chamfer cases running against the F3
   frozen golden, and the `okSig` topology assertion (`native_vs_occt_core.mjs:474-476`,
   `occt.sig.euler === nat.sig.euler && occt.sig.genus === nat.sig.genus`) green.
4. `node test/directedit.mjs` 9/9; `npm run forge:kernel:test` 34/34.
5. `otool -L build/Release/forge-kernel.node | grep -c opencascade` → **7**, and
   `nm -u build/Release/forge-kernel.node | grep -c BRepFilletAPI` → **0**.
6. **TRUE gate:** the Models-OS STEP-import battery 13/13
   (`reports/KERNEL_DROP_MASTER_PLAN.md:45` names this as the real gate; the TKG2d
   15→14 revert is the precedent). *Honest note: I could not locate a single canonical
   runner file for it in `archdisc-Models` — the only in-repo references are
   `reports/KERNEL_DROP_MASTER_PLAN.md:45` and `scripts/archie_os/routers.py:147`.
   Pin the runner path before relying on it as a gate.*
7. Push to branch `archdisc` → Linux CI **"Kernel + Guards"** strict-link — the
   ultimate confirmation. Revert-if-red.

### 3.5 What would make this recommendation wrong

- If F2's corner blend turns out to need a genuine variable-radius canal-surface
  solve for the *non-orthogonal* 3-face corner, the estimate doubles. The orthogonal
  case (which is what the gate asserts) stays closed-form either way; scope F2 to
  "convex 3-face corner, equal radii, closed-form C" and defer the rest honestly.
- If `occtfillet` returning an OCCT-backed handle (§3.3 F3.2) turns out to break a
  downstream consumer that assumes a native handle, that must be found *before* the
  flip, not after.
- The drop takes otool 8 → 7 but does **not** reduce the 14-toolkit load closure
  (§1b): TKFillet is DT_NEEDed by TKOffset. The count moves; the process footprint
  does not, until TKOffset goes too.

---

## 4. Already tried and reverted — do not retry these

| # | attempt | outcome | evidence |
|---|---|---|---|
| 1 | **TKG2d drop, 15 → 14** | passed every macOS gate, **broke Linux strict-link** → reverted. This is why `occt_drop_gate.sh` exists and why Models-OS 13/13 + Linux CI, not macOS gates, are the true gate. | `scripts/occt_drop_gate.sh:5-8`; `reports/KERNEL_DROP_MASTER_PLAN.md:46` |
| 2 | **K5 `k5-tkmesh-callers-swap`** — swap `BRepMesh_IncrementalMesh` at `FeaTet.cpp`/`Tessellate.cpp` | **6 A/B gate failures**; gate 31 (`revolve90`) reported χ=−6/genus 4 vs χ=2/genus 0 while volumes matched to 1e-16. Reverted; TKMesh was later dropped only after the mesher was made watertight. **Lesson: volume is blind to cracks — always gate on χ/genus.** | `K5_TKMESH_BLOCKER.md` (whole file); commit `5e2d20e1` |
| 3 | **G1 bridge-level `ShapeUpgrade_UnifySameDomain` coalescing** in `occtFromNativeSolid` | fixed face identity (cyl 130→3) and passed core.mjs 34/34 + face-census 18/18, **but regressed `coherence_logic` 8/8 → ~3/10** — the coalesced periodic face tessellates non-watertight. A `BRepCheck_Analyzer.IsValid()` + volume guard did **not** catch it. Reverted. Correct fix = native single-analytic-face + periodic tessellator. | commit `bb520463`; doc commit `7518b2aa` |
| 4 | **G1 routing public `faceInventory`/`direct.faceCount`/`edgeCount` native** | desynced from `direct.moveFace`/`pushPullFace`, which still address the OCCT face map — `faceInventory → pushPullFace(index)` operated on the wrong face (volume 6332 vs 7854); no gate chained them. Reverted; native queries re-exposed as additive `forge.nativeFaceInventory`/`nativeEdgeCount`. **Lesson: routing the public face query native requires native direct-edit addressing first.** | commit `7fd23dd6` |
| 5 | **G2 surface-sampling tessellation default-ON** | correctness all-PASS and watertight on clean primitives, but `native_boolean_test` exceeded the 300 s CI budget → reverted to default-OFF behind `FORGE_SURFACE_TESSELLATE=1`. Still OFF. | commit `2f3baf50`; `docs/K6_K7_EXECUTION_BRIEF.md:11-38` |
| 6 | **TKShHealing drop, 2026-07-17** | **not dropped.** Only 3 genuinely-dead includes removed (`Features.cpp` ×2, `Nurbs.cpp` ×1). The estimate "~10 direct uses" was wrong; the real surface was ~28 sites across 8 files. | `docs/K_TKSHHEALING_DROP_BRIEF.md` |
| 7 | **Native `pointsToBSpline`, first version** | fit a *correct curve* (airfoil area 818.797 vs OCCT 818.795) but with an ill-conditioned n≈r normal-equation control net whose poles spiked >7e4 mm off a 200 mm airfoil; `ThruSections` interpolates poles across stations, so the `trapezoidalWing` loft ballooned **3.2×** (5.11e6 vs OCCT 1.59e6). Reverted, then relanded with a sane-net overshoot guard (loft 1.588e6, 0.06%). | commits `c5cd044e` → `2f1214d3`; `CMakeLists.txt:225-234` |
| 8 | **`occtFromNativeSolid` via `StepAnalytic::write` → temp.step → `STEPControl_Reader`** | **hung and spiked ~4.5 GB on box-minus-cyl.** Replaced by direct `BRepBuilderAPI` reconstruction. Do not reintroduce a STEP round-trip in the bridge. | `src/NativeOcctBridge.cpp:1440-1444` |
| 9 | **`FORGE_FILLET_DROP_NATIVE` = ON** | authored 2026-07-25 (`8e4644b6`) and left **default OFF** — not gate-passing: multi-adjacent-edge fillet defers, and the flip reds core.mjs's own OCCT reference side. **This is exactly what §3 unblocks.** | `CMakeLists.txt:172-190` |
| 10 | **`k7-capi-skeleton` branch** | superseded and byte-identical to trunk; its smoke test asserted a **full**-cylinder bore (`pi*9*30`) where only a quarter cylinder overlaps. Trunk's `pi*9*30/4` is correct. Do not resurrect that test. | `K5_TKMESH_BLOCKER.md:76-80` |

Also standing, not reverted but deliberately deferred: `OcctNativeMesh.cpp:603,688`
emits an **empty mesh** for a face whose trim cannot be resolved (degree-8 / rational
B-spline pcurve) — an honest display gap, not a link gap.

---

## 5. Where the docs contradict the code (code wins)

**5.1 `scripts/occt_drop_gate.sh` does not compute what it documents.** At `:38`:

```bash
OTHER_LIBS=$(otool -L "$NODE" | grep -oE '/[^ ]*libTK[A-Za-z0-9]+\.dylib' | ...)
```

The regex requires `libTKxxx.dylib`, but brew's paths are `libTKernel.**7.9**.dylib`.
Verified on this machine: that pipeline emits **nothing**, so `OTHER_LIBS` is always
empty, `ALLOTHER` is empty, and every needed symbol is reported "EXCLUSIVE". The
script's `EXCLUSIVE` count is really the `NEEDED` count. Here that happens to be the
same answer (I checked the true intersection by hand — zero overlap among the 8), but
the script would silently fail to detect a symbol covered by another linked toolkit —
which is the one thing it exists to detect. One-line fix: `\.[0-9.]*dylib`.

**5.2 `docs/K_TKSHHEALING_DROP_BRIEF.md` attributes `BRepBuilderAPI_Sewing` to
TKShHealing** (header line 4 and rows 4, 7, 8). `nm -gU` says TKShHealing exports
**0** Sewing symbols and TKTopAlgo exports 60. Sewing is a TKTopAlgo dependency and
does **not** block a TKShHealing drop.

**5.3 The same brief's "single hardest blocker — no native `ShapeUpgrade` anywhere in
`src/native/brep/`" is out of date.** `src/native/brep/UnifyFaces.cpp` (1224 lines)
implements `unifySameDomain{Planar,Curved,Bored}` and is wired at `DirectEdit.cpp:106,
120,131`. It is scoped to `NativeSolid` handles — a real limitation, but "NONE" is no
longer accurate.

**5.4 "Faceted `importOcctSolid`" is out of date in both directions.**
`docs/K6_ANALYTIC_IMPORT.md` and `include/forge/OcctImport.hpp:9-62` show the importer
attaches exact analytic surfaces (Plane/Cylinder/Cone/Sphere/Torus) *and* exact
B-spline/Bezier/`SurfaceOfLinearExtrusion` surfaces, deferring honestly only on
`SurfaceOfRevolution` and `OffsetSurface`; the topology is faceted in (u,v) but the
parent surface is exact. On the export side, `occtFromNativeSolid`
(`NativeOcctBridge.cpp:1466-1545`) now reconstructs planar-simple bodies 1:1 and has
dedicated exact reconstructors for cylinder, cone, sphere, torus, and merged
boolean-result strips. **The residual is narrower than the ledger implies:** a native
solid carrying genuinely free-form NURBS faces still falls through to
`occtFacetedFromNativeSolid`.

**5.5 `OCCT_ZERO_ROADMAP.md` (2026-06-23/24) is stale as a status document** — it
reports 33 OCCT-dependent files, `otool = 19/17`, and a Wave-1/2/3 plan that has been
overtaken. Its §5 dependency ordering and §6 risk list (topology signature required
on every A/B gate; the oracle-removal paradox) are still correct and load-bearing —
§6 is the direct authority for §3.3-F3 above. Recommend keeping §5/§6 and marking
§1-§4 historical.

**5.6 `reports/native_kernel_next_keystones_2026-07-24.md` reports otool = 10** with
TKGeomBase and TKGeomAlgo still linked. Both were dropped on 2026-07-25
(`ec5b6b7d`, `2f1214d3`). Its per-toolkit counts for TKG3d/TKBRep/TKTopAlgo/TKMath
are superseded (§1c). Its §4 conclusion — that the remaining cluster is K6/K7-gated
and that the cheap-leaf era is over — is confirmed by today's measurement.

---

## Appendix — verbatim commands and output (all read-only, no rebuild)

```
$ otool -L build/Release/forge-kernel.node | grep opencascade
	/opt/homebrew/opt/opencascade/lib/libTKernel.7.9.dylib
	/opt/homebrew/opt/opencascade/lib/libTKMath.7.9.dylib
	/opt/homebrew/opt/opencascade/lib/libTKG3d.7.9.dylib
	/opt/homebrew/opt/opencascade/lib/libTKBRep.7.9.dylib
	/opt/homebrew/opt/opencascade/lib/libTKTopAlgo.7.9.dylib
	/opt/homebrew/opt/opencascade/lib/libTKShHealing.7.9.dylib
	/opt/homebrew/opt/opencascade/lib/libTKOffset.7.9.dylib
	/opt/homebrew/opt/opencascade/lib/libTKFillet.7.9.dylib

$ nm -u build/Release/forge-kernel.node | wc -l
     783

$ for TK in TKernel TKMath TKG3d TKBRep TKTopAlgo TKShHealing TKOffset TKFillet; do
      nm -gU /opt/homebrew/opt/opencascade/lib/lib$TK.7.9.dylib | awk '{print $3}' |
      sed 's/^_//' | sort -u > exp_$TK.txt
      comm -12 undef.txt exp_$TK.txt | wc -l ; done
TKernel 25   TKMath 25   TKG3d 138   TKBRep 80
TKTopAlgo 95   TKShHealing 20   TKOffset 42   TKFillet 11

$ bash scripts/occt_drop_gate.sh TKFillet
== occt drop-gate: TKFillet ==
  .node undefined symbols: 783
  TKFillet exports needed by .node: 11
  ...of those, EXCLUSIVE to TKFillet (block the drop): 11
  VERDICT: NOT SAFE — TKFillet exclusively provides these symbols the .node needs:
    _ZN14ChFi3d_BuilderD2Ev
    _ZN24BRepFilletAPI_MakeFillet3AddEdRK11TopoDS_Edge
    _ZN24BRepFilletAPI_MakeFillet3AddERK18NCollection_Array1I8gp_Pnt2dERK11TopoDS_Edge
    _ZN24BRepFilletAPI_MakeFillet5BuildERK21Message_ProgressRange
    _ZN24BRepFilletAPI_MakeFilletC1ERK12TopoDS_Shape18ChFi3d_FilletShape
    _ZN25BRepFilletAPI_MakeChamfer3AddEddRK11TopoDS_EdgeRK11TopoDS_Face
    _ZN25BRepFilletAPI_MakeChamfer3AddEdRK11TopoDS_Edge
    _ZN25BRepFilletAPI_MakeChamfer5BuildERK21Message_ProgressRange
    _ZN25BRepFilletAPI_MakeChamferC1ERK12TopoDS_Shape
    _ZTV24BRepFilletAPI_MakeFillet
    _ZTV25BRepFilletAPI_MakeChamfer

$ bash scripts/occt_drop_gate.sh TKShHealing | head -4
== occt drop-gate: TKShHealing ==
  .node undefined symbols: 783
  TKShHealing exports needed by .node: 20
  ...of those, EXCLUSIVE to TKShHealing (block the drop): 20

# the script's OTHER_LIBS regex matches nothing (§5.1):
$ otool -L build/Release/forge-kernel.node | grep -oE '/[^ ]*libTK[A-Za-z0-9]+\.dylib'
(no output)
$ otool -L build/Release/forge-kernel.node | grep -oE '/[^ ]*libTK[A-Za-z0-9]+\.[0-9.]*dylib' | wc -l
       8

# undefined OCCT symbols provided by NONE of the 8 linked toolkits (§1b):
$ comm -23 undef.txt <(cat exp_*.txt | sort -u) | c++filt | grep -c '^Geom2d_'
      37
$ comm -23 undef.txt <(cat exp_*.txt | sort -u) | c++filt | grep -cE '^(BRepAlgoAPI_|BOPAlgo_)'
      30

$ otool -L /opt/homebrew/opt/opencascade/lib/libTKFillet.7.9.dylib | grep -oE 'libTK[A-Za-z0-9]+' | sort -u | tr '\n' ' '
libTKBO libTKBRep libTKBool libTKFillet libTKG2d libTKG3d libTKGeomAlgo
libTKGeomBase libTKMath libTKPrim libTKShHealing libTKTopAlgo libTKernel

$ find test/native -name '*.cpp' | wc -l
     140

$ stat -f '%Sm' build/Release/forge-kernel.node
Jul 30 09:06:21 2026
$ find src include CMakeLists.txt -newer build/Release/forge-kernel.node -type f
include/forge/VoxelIoU.hpp
```

---

*Produced 2026-07-30. No kernel source or header was modified. Sacrosanct §3 pillar;
Prime Directive 8 (industrial grade — nothing here is a stub or an estimate dressed
as a measurement) and Prime Directive 6 (never optimise a proxy uncorrelated with the
true metric — see §1b on `otool` as a proxy).*
