# TKGeomBase drop plan — otool 10→9 (analysis 2026-07-25, execute in a build window)

## Current state
otool -L forge-kernel.node = **10** TK libs: TKBRep TKernel TKFillet TKG3d TKGeomAlgo
**TKGeomBase** TKMath TKOffset TKShHealing TKTopAlgo. TKGeomBase already reduced 12→**4**
exclusive symbols. The 4 blockers (verified via `nm -u | c++filt`):

1. `GeomConvert::CurveToBSplineCurve(handle<Geom_Curve>, Convert_ParameterisationType)`
2. `GeomConvert::SurfaceToBSplineSurface(handle<Geom_Surface>)`
3. `Extrema_GenExtPS::~Extrema_GenExtPS()`  (pulled in via GeomAPI_ProjectPointOnSurf)
4. `vtable for Extrema_PCFOfEPCOfExtPC2d`  (pulled in via Geom2dAPI_ProjectPointOnCurve)

## Call-site map → 3 native routines needed
### A. Analytic→BSpline conversion (blockers 1,2) — 7 sites, ALL in STEP write/import
- `OcctImport.cpp:324` CurveToBSplineCurve(basis); `:505` SurfaceToBSplineSurface(bz)
- `StepWriteOcct.cpp:389,397,490` CurveToBSplineCurve(...); `:591,633` SurfaceToBSplineSurface(...)
- **Native plan:** each analytic primitive has an EXACT rational-NURBS form. Implement
  `forge::occtconv::curveToBSpline(Geom_Curve)` + `surfaceToBSpline(Geom_Surface)` covering
  the types WE actually emit: line→degree-1 bspline; circle/ellipse→rational quadratic (9-pole
  or 7-pole); plane→bilinear; cylinder/cone→ruled × circular (rational in u); sphere/torus→
  rational bi-quadratic; Bezier→already bspline (knot-insert). Build Geom_BSplineCurve/Surface
  from computed poles/weights/knots via the (surviving TKG3d) constructors.

### B. 3D point→surface projection (blocker 3) — 5 sites
- `ClassASurfacing.cpp:482,485`, `OcctNativeMesh.cpp:236`, `Nurbs.cpp:716`, `OcctImport.cpp:939`
  (all `GeomAPI_ProjectPointOnSurf`, which internally uses Extrema_GenExtPS)
- **Native plan:** `forge::occtproj::projectPointOnSurface(P, surf)` — Newton iteration on
  ∂S/∂u·(S−P)=0, ∂S/∂v·(S−P)=0 with a coarse u,v seed grid for global start; handle periodic
  surfaces (wrap). Return nearest (u,v)+point+distance. Match GeomAPI_ProjectPointOnSurf's
  NearestPoint()/LowerDistance() API used at the call sites.

### C. 2D point→curve projection (blocker 4) — 2 sites, in STEP READER
- `StepReadOcct.cpp:1305,1306` `Geom2dAPI_ProjectPointOnCurve` (pcurve anchor shift)
- **Native plan:** `forge::occtproj::projectPointOnCurve2d(P, c2)` — 1-D Newton on
  d/dt‖C(t)−P‖²=0 with seeded sampling; the reader only needs NearestPoint() to shift a
  pcurve to an anchor, so a robust sampled-min + local refine suffices.

## ★RISK FLAG (do NOT drop blind)
All 3 routines sit in the **STEP read/write/import path** — precisely what the **Models-OS
13/13** gate exercises. Precedent: the TKG2d drop passed ALL kernel gates (core.mjs 34/34)
but REGRESSED Models-OS STEP-import 13/13→9/13 and was REVERTED. So:
- Kernel gates (run_native 140, directedit 9/9, core.mjs 34/34) are necessary NOT sufficient.
- **True drop gate = Models-OS 13/13 + Linux-CI "Kernel + Guards" strict-link.**
- Sequence: implement A→B→C behind the existing call sites (keep OCCT fallback compiled until
  each native routine passes a per-routine A/B vs the OCCT result on real STEP fixtures) →
  build → run_native + directedit + core.mjs → **Models-OS 13/13** → only THEN remove
  TKGeomBase from OCCT_LIBS → rebuild → otool==9 → push → Linux CI green. Revert-if-red.
- Fidelity bar for A: the emitted STEP B-splines must round-trip (write→read) within tolerance
  on the 13 Models-OS fixtures; a sloppy circle→NURBS (wrong weights) silently corrupts arcs.

## Effort
Multi-hour keystone (3 native math routines + STEP round-trip verification). Best done in a
dedicated build window (needs RAM free — NOT during a 30B train/eval). Analytic→NURBS (A) is
the bulk; B/C are standard Newton projectors. Estimated: A ~half day, B+C ~2-3h, verify ~2h.
