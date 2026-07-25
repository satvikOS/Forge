# Kernel OCCT-zero — AGGRESSIVE parallel drop plan (2026-07-25). otool 10 → target 5-6.

## Ground truth (measured via occt_drop_gate.sh, this session)
10 TK dylibs linked. EXCLUSIVE-symbol counts (the drop blockers):

| tier | keystone | excl | native routine that unblocks it |
|---|---|---|---|
| **1** | **TKGeomBase** | 4 | analytic→NURBS convert + point-surface/curve projection |
| **1** | TKFillet | 11 | native fillet/chamfer (VarFillet.cpp started) |
| **1** | TKShHealing | 20 | native ShapeFix/ShapeAnalysis (unifySameDomain started) |
| **1** | TKGeomAlgo | 24 | point projection + points→NURBS fit + GeomAPI To2d/To3d |
| 2 | TKOffset | 42 | native offset/draft |
| 3 | TKBRep | 77 | (foundation B-rep — hard) |
| 3 | TKTopAlgo | 95 | (topology algos — hard) |
| 3 | TKG3d | 118 | (3D geometry — hardest) |
| 4 (LAST) | TKMath | 26 | foundation — everything depends on it |
| 4 (LAST) | TKernel | 24 | foundation — drop dead last |

## ★KEY: drops are COUPLED through shared native routines → author by ROUTINE, not keystone
- **R1 Projection** — native Newton point→surface (`GeomAPI_ProjectPointOnSurf`) + point→curve-2d
  (`Geom2dAPI_ProjectPointOnCurve`). Unblocks TKGeomAlgo (11 of its 24) AND TKGeomBase (its Extrema
  blockers 3+4). HIGHEST LEVERAGE.
- **R2 NURBS** — analytic→bspline (`GeomConvert::Curve/SurfaceToBSpline`) + points→bspline lsq fit
  (`GeomAPI_PointsToBSpline`) + `GeomAPI::To2d/To3d`. Unblocks TKGeomBase (blockers 1+2) AND
  TKGeomAlgo. Spec READY: reports/nurbs_forms_reference.md.
- **R3 Fillet/Chamfer** — `BRepFilletAPI_MakeFillet/MakeChamfer` native. Unblocks TKFillet (all 11).
- **R4 ShapeHealing** — `ShapeFix_Shape/Solid`, `ShapeAnalysis_Surface/Curve/Shell`. Unblocks TKShHealing (all 20).

R1+R2 together → drop TKGeomBase AND TKGeomAlgo (10→8). +R3 → TKFillet (→7). +R4 → TKShHealing (→6).

## Execution protocol (AGGRESSIVE: parallel author, serial build)
**Parallelizable NOW-once-RAM-frees (light, no build): 4 agents, one per routine R1-R4**, each:
(a) enumerate its exclusive symbols (targets in reports/kernel_drop_targets/*.txt),
(b) map our call sites, (c) AUTHOR the native replacement + wire behind the call sites keeping OCCT
as a compiled fallback (no drop yet). Worktree-isolated. NO cmake build (single-track — I build).

**Serial (mine, single-track — the true bottleneck):** per keystone, in Tier order:
1. integrate the routine(s) → `cmake-js build --parallel 1`
2. gate: test/native/run_native.sh (140) + test/directedit.mjs (9/9) + core.mjs (34/34)
3. **TRUE gate: Models-OS 13/13** (the drop that regresses STEP round-trip = revert, per the TKG2d
   precedent) → then remove the keystone from OCCT_LIBS → rebuild → otool drops by 1
4. push archdisc → Linux CI "Kernel + Guards" strict-link = the final confirmation. Revert-if-red.

## Why builds can't parallelize (honest)
Concurrent OCCT-linked C++ builds are the one thing that reliably breaks the 39GB box (RAM + the
single-track rule), and each drop changes what toolkits SURVIVE (so gate N+1 depends on N landing).
Parallelism lives in the AUTHORING; the build/gate is a fast serial loop once code is ready.

## Blocked on
z3d-v2 30B train (holding ~26G, free 4.2G, swap 2.8G) — NO parallel agents until it frees RAM
(~28 min). Then: launch R1-R4 authors in parallel → serial-build Tier-1 → otool 10→6.
