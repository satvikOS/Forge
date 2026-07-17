# OCCT dylib-drop roadmap — 17 → 0 (grounded per-toolkit, 2026-07-17)

The north-star is `otool -L build/Release/forge-kernel.node | grep -c opencascade` → **0**.
**17** today (dropped TKBO+TKDE this session, transitive-only, CI-green). This is the
precise, audited plan to drop each remaining toolkit: its **direct #include count in
`src/`**, its key sites, and the **native work** that eliminates the OCCT uses.

## The two drop mechanisms
1. **Transitive-only drop** (free): a toolkit with **0 direct `#include`s** is pulled only
   via another linked toolkit's `DT_NEEDED`; remove its direct link and the parent still
   loads it. Done for TKBO (via TKBool) + TKDE (via TKDESTEP).
2. **Keystone migration**: a toolkit with direct uses needs **all** its OCCT calls replaced
   by native (or the OCCT fallback removed once native fully covers the case), then the
   direct link removed. Every remaining toolkit is this kind.

**Testing discipline (hard-won):** macOS flat-namespace linkage defers undefined symbols to
load-time, so a lib **always "links" on mac** — a false positive. Gate every drop by (a) 0
direct includes of its headers, (b) macOS runtime works, (c) **Linux CI green**. Never the
mac link. Verify with `bash test/native/run_native.sh` (137/137) + `forge:coherence` +
core.mjs before pushing; CI Linux is the final proof.

## Remaining 17 — by drop difficulty

### Tier A — smallest surface (2–3 direct uses; a bounded keystone each)
| Toolkit | #uses | Key sites | Native work to drop |
|---|---|---|---|
| **TKFillet** | 2 | `VarFillet.cpp` (BRepFilletAPI_MakeFillet), `Features.cpp:1138` (MakeChamfer/MakeFillet) | Native fillet (`FilletAnalytic`) covers only box-edge linear-law today. Extend native constant+variable fillet + chamfer to the general convex/concave edge-chain case, make it the default, delete the OCCT fillet path. (K3) |
| **TKHLR** | 2 | `Drawings.cpp` (HLRBRep_Algo, HLRToShape) | Native `brep::hiddenLineRemoval` (ortho+persp analytic, 43 KB) exists but *defers to OCCT for OCCT-backed inputs*. Make native HLR handle OCCT-backed shapes (tessellate→native HLR) so Drawings never calls HLRBRep; then drop. (K4) |
| **TKMesh** | 2 | `Tessellate.cpp:68`, `FeaTet.cpp:724` (BRepMesh_IncrementalMesh) | `forge::occtmesh` must watertight-tessellate arbitrary OCCT solids (K5_TKMESH_BLOCKER: today it mis-meshes revolves/caps). Then swap the 2 sites, drop TKMesh. (K5 — blocked on watertight OCCT-solid mesh) |
| **TKDESTEP** | 2 | `IoExchange.cpp`, `NativeOcctBridge.cpp` (STEPControl_Reader/Writer, IFSelect_ReturnStatus) | Native STEP write is default; native analytic STEP read is verified==OCCT but gated OFF. K1 = native **trimmed-NURBS STEP reader** for FOREIGN files → then STEP never touches OCCT. Biggest single interchange win. |
| **TKXSBase** | 2 | `IoExchange.cpp` (IFSelect_ReturnStatus, Interface_Static), `NativeOcctBridge.cpp` | Coupled to TKDESTEP (STEP-io return-status/settings). Drops together with the K1 native STEP reader (or becomes transitive-only once the direct IFSelect/Interface uses are gone). |
| **TKG2d** | 3 | `Nurbs.cpp` (Geom2d_TrimmedCurve/Line, GCE2d_MakeSegment), `OcctNativeMesh.cpp` + `OcctImport.cpp` (BRep_Tool::CurveOnSurface pcurves) | Replace OCCT 2D pcurves with native pcurves in the NURBS + import + occtmesh paths (needs native surface trimming). Then TKG2d is transitive-only via TKG3d/TKBRep → drop. |

### Tier B — mid surface (8–12 uses; larger keystones)
| Toolkit | #uses | Native work |
|---|---|---|
| **TKPrim** | 8 | Native primitives already exist + are default; migrate the remaining OCCT `BRepPrimAPI_Make*` fallback sites to native, drop. |
| **TKGeomBase** | 9 | GeomAPI/GeomLib/ProjLib/Convert — migrate to native NURBS/geom (`native/brep/Nurbs*`, `native/geom`). |
| **TKG3d** | 10 | Geom_ 3D surfaces/curves — core; part of the K6 gp_/Geom_→native Vec3/Nurbs migration. |
| **TKShHealing** | 10 | Native healing (`heal.*`, `mesh/Repair`, Sew) exists + is strong; migrate the remaining `ShapeFix_*`/`BRepBuilderAPI_Sewing` sites, drop. |
| **TKGeomAlgo** | 11 | GeomFill/GeomInt/Extrema/GProp — migrate to native surface intersection + extrema + native GProp (native MassProps already exists). |
| **TKBool** | 12 | BRepAlgoAPI booleans — native analytic + exact-mesh booleans exist; the NURBS-mixed/curved∩curved fallback (G3/G4) must land, then drop the OCCT boolean. |

### Tier C — the core substrate (last to go; K6/K7)
| Toolkit | #uses | Native work |
|---|---|---|
| **TKOffset** | 16 | BRepOffset/Draft/Pipe — native shell/draft/offset merged (K3) but 16 OCCT sites remain; migrate all, drop. |
| **TKTopAlgo** | 28 | BRepBuilderAPI/BRepTools/BRepAdaptor/BRepGProp/BRepCheck/TopExp — the B-rep *construction+query* substrate. Most native ops still emit/consume OCCT `TopoDS` here. K6 migrates to the native `Solid` topology. |
| **TKMath** | 35 | gp_/math_/Precision — pervasive. Migrate to native `Vec3`/`Matrix`/`linalg` (K6, partially done: DirectModeling/Mold/Airfoil). |
| **TKernel / TKBRep / TKG3d** | core | The last three: TKernel (Standard_*, handles), TKBRep (`TopoDS`/`BRep_Tool`), TKG3d. Drop only when the whole B-rep is the native `Solid` and no op round-trips through `TopoDS` — the K7 opaque-handle-C-API endgame. `otool → 0`. |

## Recommended order (leverage × tractability)
1. **K1 native STEP reader** → drops **TKDESTEP + TKXSBase** (+ makes STEP fully native) — biggest bounded win.
2. **TKFillet** (extend native fillet to general edges, delete OCCT fillet).
3. **TKHLR** (native HLR on OCCT-backed inputs, delete OCCT HLR).
4. **TKShHealing** + **TKPrim** (native healing/primitives already strong).
5. **TKMesh** (needs K5 watertight OCCT-solid mesh first).
6. **TKBool** (needs G3/G4 curved booleans) → **TKGeomAlgo/TKGeomBase/TKG2d/TKOffset**.
7. **K6/K7**: TKMath/TKTopAlgo/TKG3d/TKBRep/TKernel — the native-`Solid`-everywhere endgame → **0**.

Each step: replace/cover the OCCT uses natively → `run_native.sh` 137/137 + coherence + core.mjs → drop the lib from `CMakeLists OCCT_LIBS` → confirm `otool` count dropped → Linux CI green.
