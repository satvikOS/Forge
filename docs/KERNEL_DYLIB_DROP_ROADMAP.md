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
| **TKHLR** | 2 | `Drawings.cpp:211` `runHLR` + `:1018` `HLRBuckets` (HLRBRep_Algo, HLRToShape) | **K4 attempt 3 → SILHOUETTE blocker RESOLVED, still NOT dropped (perf wall).** The attempt-2 curved-silhouette gap is CLOSED: `brep::hiddenLineRemoval` now GROUPS the faceted sub-faces by analytic-surface signature + connectivity (== `analyticFaceInventory`) and traces the silhouette over each group's FULL range — closed-form iso-u lines (cyl/cone), great circle (sphere), marched (torus). **Cylinder front(-Y) 160→260, per-class V=180 H=80 rel `0`** (`native_vs_occt_hlr_import` 10/10, up from 9/9). Built-native + persp UNCHANGED (`native_vs_occt_hlr` 2/2, `hlr_test` 29/29). Native HLR is now geometrically COMPLETE (polyhedral+quadric, built AND faceted-import). REMAINING blockers to the DROP are **PERFORMANCE + plumbing**, not correctness: (a) `projectView`/`sectionView` only get a raw `TopoDS_Shape` → import route re-tessellates the ~64 bore strips via `emitFaceTris` into ~50k occluder triangles → **>100 s** vs OCCT ms; (b) even clean NativeSolid-direct native HLR is **~5.3 s/view** (~100–1000× OCCT). Needs occluder BVH + import-strip triangle reuse + re-plumb `projectView`/section bindings to pass the `ShapeHandle`. **`docs/K4_HLR_DROP_BRIEF.md` attempt-3 LOG.** |
| **TKMesh** | 2 | `Tessellate.cpp:68`, `FeaTet.cpp:724` (BRepMesh_IncrementalMesh) | **K5 ATTEMPTED → NOT dropped (measured blocker; tree reverted, otool 17).** Surprise: **FeaTet routing WORKS** (native shared-edge boundary is watertight, `fea_smoke`/`fea_nafems` pass). The BLOCKER is the **display** `Tessellate.cpp` path: the OCCT-reference side of `native_vs_occt_core.mjs` runs the site-under-test, and the in-house `occtmesh` mesher emits phantom/mislocated facets for shapes carrying un-baked `TopLoc_Location` transforms (`translate`/`rotate` use `BRepBuilderAPI_Transform(copy=false)`), breaking 6/34. Root cause: `OcctNativeMesh.cpp`'s shared-edge cache keys on `TShape` alone (ignores edge-location) + surface-frame≠edge-frame on boolean results. **Verified partial fix (recommended standalone): re-key the edge cache on `(TShape, edge-location)` → fixes 4/6 (extrude/revolve/prism) AND benefits Booleans/Drawings — a genuine latent-bug fix.** Irreducible remainder: `common box∩sphere` (curved boolean on a translated operand). Needs `copy=true`-baked transforms or a frame-consistent per-face path. **`docs/K5_TKMESH_DROP_BRIEF.md` VERIFICATION LOG.** |
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

## Recommended order (leverage × tractability — revised 2026-07-17 after the K4 + K5 attempts)
Two honest attempts (K4 TKHLR, K5 TKMesh) both found real blockers; both are **precisely documented**
and left the tree green (nothing faked, nothing shipped). Key lessons: (a) drops routing raw-`TopoDS_Shape`
through `importOcctSolid` inherit its **faceted topology** — fine for tessellation, fatal for edge ops
(HLR); (b) the in-house `occtmesh` mesher mishandles **un-baked `TopLoc_Location`** transforms
(`copy=false`), a latent bug hitting Booleans/Drawings too. Revised order:
0. **[verified latent-bug fix, no drop] Re-key `OcctNativeMesh.cpp` shared-edge cache on
   `(TShape, edge-location)`** — K5 measured this fixes 4/6 display cases (extrude/revolve/prism) AND
   benefits existing Booleans/Drawings. Land it standalone (full `run_native` 137/137 must stay green);
   it de-risks the later TKMesh display route. **Concrete next action.**
1. **TKShHealing** + **TKPrim** — FRESH attempts (untested). Native healing/primitives already strong +
   mostly default; migrate residual `ShapeFix_*`/`BRepPrimAPI_*` sites, drop. Most likely next metric move.
2. **TKMesh** (K5, deferred) — FeaTet route already works; the display route needs step-0 + the
   `common box∩sphere` boolean-frame gap closed (`copy=true`-baked transforms or frame-consistent per-face
   read). Then drop → **16**.
3. **TKHLR** (K4, deferred) — native-HLR feature-edge suppression (attempt 2) + grouped analytic
   silhouette (attempt 3) are DONE; native HLR now matches OCCT on built + faceted-import solids.
   Remaining is **performance**: an occluder BVH + import-strip triangle reuse (native `projectView`
   is ~5–100 s/view vs OCCT ms) + re-plumb `projectView`/section bindings to pass the `ShapeHandle`
   (avoid the faceted import for `NativeSolid` inputs), then flip gate + migrate + goldens + drop.
4. **K1 native STEP reader** → drops **TKDESTEP + TKXSBase** — biggest bounded win, larger build.
5. **TKFillet** (general native fillet + chamfer) — genuinely hard geometry.
6. **TKBool** (needs G3/G4 curved booleans) → **TKGeomAlgo/TKGeomBase/TKG2d/TKOffset**.
7. **K6/K7**: TKMath/TKTopAlgo/TKG3d/TKBRep/TKernel — the native-`Solid`-everywhere endgame → **0**.

Each step: replace/cover the OCCT uses natively → `run_native.sh` 137/137 + coherence + core.mjs → drop the lib from `CMakeLists OCCT_LIBS` → confirm `otool` count dropped → Linux CI green.
