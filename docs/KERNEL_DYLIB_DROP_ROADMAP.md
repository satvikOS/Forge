# OCCT dylib-drop roadmap — 17 → 0 (grounded per-toolkit, 2026-07-17)

The north-star is `otool -L build/Release/forge-kernel.node | grep -c opencascade` → **0**.
**17** today (dropped TKBO+TKDE this session, transitive-only, CI-green). This is the
precise, audited plan to drop each remaining toolkit: its **direct #include count in
`src/`**, its key sites, and the **native work** that eliminates the OCCT uses.

**Active (2026-07-17):** `d493e095` (CI-green) made native `nativeFaceInventory` correct on
STEP-imported native solids (connectivity+signature grouping). **K4 (TKHLR) attempt 4 (2026-07-17):
the native ortho HLR is now CORRECTNESS-COMPLETE (feature-edge suppression + grouped analytic
silhouette, attempts 2–3) AND FAST — a 2D BVH over the projected occluder soup (`OccluderBVH` in
`Hlr.cpp`) makes occlusion O(log n): ~40–50× faster, byte-for-byte identical output (drilled box
5074→100 ms; faceted-import route attempt-3's ">100 s"→38 ms). PERF NO LONGER BLOCKS the drop.
This perf fix is SHIPPED (all gates green).** But `TKHLR` is STILL NOT dropped on NON-perf walls:
(a) **envelope regression** — `projectShape`/`projectView` DEFER to OCCT HLR for freeform-NURBS /
NativeMesh / non-analytic imports (native envelope = polyhedral+analytic-quadric only); dropping
`TKHLR` silently regresses those (Bible §0). (b) `projectView`/`sectionView` take a raw
`TopoDS_Shape` (no handle) and the section back-half migration is UNVERIFIED. See the attempt-4
VERIFICATION LOG in `docs/K4_HLR_DROP_BRIEF.md`. Follow-up: native freeform-silhouette tracer +
re-plumb/A-B projectView/section, then flip+migrate+remove+drop → **16**.

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
| **TKHLR** | 2 | `Drawings.cpp:211` `runHLR` + `:1018` `HLRBuckets` (HLRBRep_Algo, HLRToShape) | **K4 attempt 4 → PERF wall RESOLVED (2D-BVH), still NOT dropped (envelope + migration walls).** attempt-3's PERF blocker is GONE: a 2D BVH over the projected occluder soup (`OccluderBVH` in `Hlr.cpp`) makes `occludedPoint`/`segmentSplitCandidates` O(log n) — native ortho HLR is **~40–50× faster, OUTPUT BYTE-FOR-BYTE IDENTICAL**. Drilled box front (266 hidden segs): **5074 → 100 ms**; faceted-import route (attempt-3's ">100 s"): **~38 ms**; no blowup. Correctness UNCHANGED (`native_vs_occt_hlr` 2/2, `_persp` PASS, `hlr_import` 10/10, `hlr_test` 29/29, `run_native` 137/137, drawings smokes PASS, coherence PASS). REMAINING blockers are NOT perf: (a) **envelope regression** — `projectShape`/`projectView` DEFER to OCCT HLR for freeform-NURBS / NativeMesh / non-analytic imports (native's honest envelope = polyhedral+analytic-quadric); dropping `TKHLR` silently regresses those (Bible §0). (b) **`projectView`/`sectionView` migration UNVERIFIED** — raw `TopoDS_Shape` (no handle), section back-half reframe not A/B'd. `projectShape` native flip IS viable (`FORGE_NATIVE_FEATURES=1` smoke passes). Follow-up: native freeform-silhouette tracer + re-plumb+A/B projectView/section, then flip+migrate+remove+drop. **`docs/K4_HLR_DROP_BRIEF.md` attempt-4 LOG.** |
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
3. **TKHLR** (K4, deferred) — feature-edge suppression (attempt 2) + grouped analytic silhouette
   (attempt 3) + **2D-BVH occlusion (attempt 4)** are DONE; native ortho HLR now matches OCCT on
   built + faceted-import solids AND is FAST (~40–50× faster; drilled box 5074→100 ms; import route
   >100 s→38 ms; byte-for-byte identical output). Perf NO LONGER blocks. Remaining is NOT perf:
   (a) close the **envelope regression** (native freeform-NURBS silhouette tracer, so dropping OCCT
   HLR doesn't silently regress freeform/mesh/non-analytic inputs); (b) re-plumb + A/B
   `projectView`/`sectionView` (raw `TopoDS_Shape`, section back-half) onto native BEFORE removing
   the OCCT path; then flip gate + migrate + remove `runHLR`/`HLRBuckets` + drop → **16**.
4. **K1 native STEP reader** → drops **TKDESTEP + TKXSBase** — biggest bounded win, larger build.
5. **TKFillet** (general native fillet + chamfer) — genuinely hard geometry.
6. **TKBool** (needs G3/G4 curved booleans) → **TKGeomAlgo/TKGeomBase/TKG2d/TKOffset**.
7. **K6/K7**: TKMath/TKTopAlgo/TKG3d/TKBRep/TKernel — the native-`Solid`-everywhere endgame → **0**.

Each step: replace/cover the OCCT uses natively → `run_native.sh` 137/137 + coherence + core.mjs → drop the lib from `CMakeLists OCCT_LIBS` → confirm `otool` count dropped → Linux CI green.
