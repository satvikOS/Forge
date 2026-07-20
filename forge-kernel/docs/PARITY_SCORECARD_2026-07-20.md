# Kernel Parity Scorecard — measured 2026-07-20 (GOLD build/Release, otool=15)

Measured against build/Release/forge-kernel.node (the GOLD binary). No claims — every row was RUN.

## DONE (verified native, 0 OCCT linkage)
- **CGAL / libfive / PicoGK / Manifold** — fully native in src/native/{mesh(28),implicit(10),voxel(7),csg(3)}
  = 48 cpp, **0 opencascade linkage**. 4 of the 5 target engines are dependency-free.
- **Core B-rep native path** — test/native_vs_occt_core.mjs = **34/34 A/B PASS** (core 17 + features 6 +
  sensitivity 3 + step3c/3d 8); topology signature (χ/genus + F/E) gates every topology-changing op.
- **Native analytic face inventory** (OCCT-free, cylinder/cone/torus + axis/axisLocation/radius) —
  test/native_analytic_face_inventory.mjs = **44/44 PASS**.
- **Parasolid-style opaque-handle C-API** — include/forge/capi/forge_capi.h, links OCCT-free standalone, 39/39.
- **Analytic surface-query axis exposure (NEW 2026-07-20, Parasolid PK_FACE_ask_surf parity)** — the analytic
  axis (direction + axisLocation + analyticKind) that faceInventory computes is now surfaced through the Models
  measure_step face records (scripts/inv_of_step.mjs merges forge.faceInventory into the per-face inferFeature
  record; no kernel rebuild). Verified: 104/104 faces carry axis; a hole's axis ⊥ its radial normal (dot 0.0),
  analyticKind=cylinder; backward-compat keys (kind/normal/centroid/radius) intact; Models OS suite 13/13.

## REMAINING (the OCCT B-rep substrate — otool 15 → 0, multi-cycle keystones)
Per docs/K6_K7_EXECUTION_BRIEF.md + OCCT_REPLACEMENT_ROADMAP.md, every remaining dylib drop is gated on a
curved-preserving native B-rep replacing the faceted TopoDS round-trip. Ordered:
- **G2 watertight tessellation** default-on (density fix landed wave-3: boolean test 310s→41s; boolean-body
  curved-face conformance still open).
- **K6a** native single-face primitive builders (cyl→1 face, needs G2).
- **K6b** route public faceInventory/faceCount → nativeFaceInventory for NATIVE handles (native layer ready 44/44;
  NOTE: does not help IMPORTED-STEP shapes, which stay OCCT handles — so no drop, architectural only).
- **K5** drop TKMesh (done earlier, otool 16→15).
- **K1** native trimmed-NURBS STEP reader (drops TKDESTEP — the deepest blocker).
- **K2** curved/mixed/fuzzy booleans (drops TKBO/TKBool). **K3** general fillet/offset (TKFillet/TKOffset).
- **K4** perspective HLR (TKHLR). **K6** substrate gp_/Geom_ migration (Features 112 sites, Drawings 86, …).

## Discipline note (why the substrate keystones are NOT rushed here)
Each remaining keystone requires a kernel REBUILD. The program's history (kernel-occt-zero-program memory) shows
locally-green drops that REGRESSED downstream: the TKG2d 15→14 attempt passed ALL kernel gates but broke the
Models OS STEP-import (13/13→9/13) and was reverted. **The true drop gate is Models-OS-13/13 + Linux-CI**, and
Linux-CI cannot be run in this environment. So a substrate keystone is a dedicated multi-cycle effort gated on
BOTH kernel-A/B AND Models-OS-13/13 AND Linux-CI — not a bounded single-session change. GOLD-15 is backed up for
revert. The safe, verified parity advance this session was the axis-query exposure (Models-side, no rebuild).
