# OCCT dylib-drop roadmap — 17 → 0 (grounded per-toolkit, 2026-07-17)

The north-star is `otool -L build/Release/forge-kernel.node | grep -c opencascade` → **0**.
**17** today (dropped TKBO+TKDE this session, transitive-only, CI-green). This is the
precise, audited plan to drop each remaining toolkit: its **direct #include count in
`src/`**, its key sites, and the **native work** that eliminates the OCCT uses.

**Active (2026-07-17):** `d493e095` (CI-green) made native `nativeFaceInventory` correct on
STEP-imported native solids (connectivity+signature grouping). **K4 (TKHLR) ATTEMPTED → NOT
dropped (honest blocker, all gates green, nothing shipped)** — see the VERIFICATION LOG in
`docs/K4_HLR_DROP_BRIEF.md`. The measured blocker: `projectView`/`sectionView` take a raw
`TopoDS_Shape`, so the only native route is `importOcctSolid → hiddenLineRemoval`, but
`importOcctSolid` uses **faceted-topology-over-exact-geometry** — each analytic face's
triangulation diagonal becomes a topological Edge and native HLR draws it (box → 13 hidden
polylines incl. spurious diagonals vs OCCT's 4). This **corrects a false premise** (Drawings.cpp:411's
"orthographic import route matches exactly" holds only for hand-built clean-topology A/B fixtures,
never the import round-trip). Dropping TKHLR now requires native-HLR **feature-edge suppression**
(cull coplanar + tangent/smooth edges) — a real HLR enhancement, AND curved-imported solids lose
their analytic surface under faceting so silhouette parity is a further open question. **K5 (TKMesh
→ 15) is the better next lead** (`docs/K5_TKMESH_DROP_BRIEF.md`) — tessellation WANTS facets, so it
is the one drop the faceted-import limitation does not hurt.

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
| **TKHLR** | 2 | `Drawings.cpp:211` `runHLR` + `:1018` `HLRBuckets` (HLRBRep_Algo, HLRToShape) | **K4 ATTEMPTED → NOT dropped (measured blocker).** Native `brep::hiddenLineRemoval` is machine-precision vs OCCT on **clean native-built** solids (both A/B harnesses rel≤5e-15), and `projectShape` on a NativeSolid handle is exact. BUT `projectView`/`sectionView` take a raw `TopoDS_Shape` → only native route is `importOcctSolid→hiddenLineRemoval`, and `importOcctSolid`'s **faceted topology** makes native HLR draw triangulation diagonals (box → 13 hidden vs OCCT 4). To drop: add native-HLR **feature-edge suppression** (coplanar+tangent culling; solves polyhedral) AND resolve curved-imported silhouette parity (faceting drops the analytic surface). THEN convert `native_vs_occt_hlr*` to golden regressions (oracle removal) + drop. **`docs/K4_HLR_DROP_BRIEF.md` VERIFICATION LOG.** |
| **TKMesh** | 2 | `Tessellate.cpp:68`, `FeaTet.cpp:724` (BRepMesh_IncrementalMesh) | **CORRECTED (K5 brief):** both uses are **OCCT-backed only** (native handles already bypass BRepMesh via `tessellateSolidForViewport`), so both are routable via `importOcctSolid`→native tessellator. The `FORGE_SURFACE_TESSELLATE` timeout is the **boolean** path, NOT display/FeaTet — so this drop likely dodges it (verify `native_boolean_test` timing). FeaTet tet-seed surface-mesh quality is the one real risk. **`docs/K5_TKMESH_DROP_BRIEF.md`.** |
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

## Recommended order (leverage × tractability — revised 2026-07-17 after the K4 attempt)
The K4 attempt taught the key lesson: any drop that routes `projectView`-style raw-`TopoDS_Shape`
consumers through `importOcctSolid` inherits its **faceted topology** — fine for tessellation, fatal
for edge-based ops (HLR). Order accordingly:
1. **TKMesh** (K5) — the one drop faceted-import does NOT hurt (tessellation wants facets). Native
   viewport tessellator exists + is the shipping default for native handles; route the 2 OCCT-backed
   sites (`Tessellate.cpp:68` display = low risk; `FeaTet.cpp:724` tet-seed = the one quality risk),
   drop. → **16**. Even a partial (display-native only) is progress.
2. **TKShHealing** + **TKPrim** — native healing/primitives already strong + mostly default; migrate
   residual `ShapeFix_*`/`BRepPrimAPI_*` sites, drop.
3. **TKHLR** (K4, deferred) — needs native-HLR **feature-edge suppression** (coplanar+tangent culling)
   + curved-imported silhouette parity first; then flip gate + migrate `projectView`/section + goldens
   + drop. Real HLR enhancement, not a flip.
4. **K1 native STEP reader** → drops **TKDESTEP + TKXSBase** (+ makes STEP fully native) — biggest
   bounded win but a larger build (foreign trimmed-NURBS reader).
5. **TKFillet** (extend native fillet to general convex/concave edge chains + chamfer, delete OCCT
   fillet) — genuinely hard geometry.
6. **TKBool** (needs G3/G4 curved booleans) → **TKGeomAlgo/TKGeomBase/TKG2d/TKOffset**.
7. **K6/K7**: TKMath/TKTopAlgo/TKG3d/TKBRep/TKernel — the native-`Solid`-everywhere endgame → **0**.

Each step: replace/cover the OCCT uses natively → `run_native.sh` 137/137 + coherence + core.mjs → drop the lib from `CMakeLists OCCT_LIBS` → confirm `otool` count dropped → Linux CI green.
