# K5 — Drop TKMesh (native tessellation becomes the only surface mesher)

**North-star:** `otool -L build/Release/forge-kernel.node | grep -c opencascade` → 0.
After K4 (TKHLR) this should be **16**; K5 targets **16 → 15**. Prereq: land K4 first.

## Ground truth (audited 2026-07-17)

Direct TKMesh (`BRepMesh`/`IMeshData`/`IMeshTools`) includes in `src/` — only **two files, two uses,
BOTH on OCCT-backed shapes**:

- **`src/Tessellate.cpp:68`** — `BRepMesh_IncrementalMesh mesher(shape, linearTol, false, angTol, ...)`
  for the **display/viewport** tessellation. **Native handles already bypass BRepMesh entirely**:
  lines 48–56 route `ShapeKind::NativeSolid`→`nb::tessellateSolidForViewport(...)` and
  `ShapeKind::NativeMesh`→`nb::tessellateMeshForViewport(...)` (watertight analytic-face tessellation
  + smooth normals + per-tri faceIds), which is the SHIPPING default for native handles. The
  BRepMesh call is reached ONLY for `ShapeKind::Occt` handles.
- **`src/FeaTet.cpp:724`** — `BRepMesh_IncrementalMesh mesher(shape, targetEdge, false, ...)` then
  `Poly_Triangulation` boundary-triangle extraction (line ~634) to seed the **tetrahedral volume
  mesh**. Also OCCT-backed only. Note the existing workaround comment (line ~748): "BRepMesh on a
  planar face only produces corner+edge vertices" — the native sampler can do BETTER here.

The native replacement already exists: `src/native/brep/SolidTessellate.cpp` +
`tessellateSolidForViewport` (`NativeRoute.hpp`). The surface-sampling density knob is
`FORGE_SURFACE_TESSELLATE` (default OFF).

## The one nuance — the FORGE_SURFACE_TESSELLATE timeout is a DIFFERENT path

`FORGE_SURFACE_TESSELLATE` was left default-OFF because turning surface-sampling on **globally** made
the **boolean path's** meshes denser and timed out `native_boolean_test` (300s cap). That is the CSG
result-validation tessellation — NOT the public display `tessellate` export and NOT FeaTet. So routing
the two OCCT-backed uses above through the native tessellator should **not** re-trigger the boolean
timeout. VERIFY THIS EXPLICITLY: after the change, `bash test/native/run_native.sh` JOBS=3 must finish
`native_boolean_test` well under 300s. If routing FeaTet/display somehow shares the dense path, cap the
native deflection for these two callers to match BRepMesh's `linearTol`/`targetEdge` density (do NOT
globally flip FORGE_SURFACE_TESSELLATE).

## Drop sequence (verify each step before the next)

1. **Tessellate.cpp:** for `ShapeKind::Occt`, `importOcctSolid(shape)` → native `Solid` →
   `tessellateSolidForViewport` (exactly as the native branch), removing the `BRepMesh_IncrementalMesh`
   call. A/B the resulting vertex/tri counts + AABB + per-face areas against the current BRepMesh
   output on the canonical solids BEFORE deleting the OCCT path (the native tessellation need not be
   vertex-identical, but must be watertight, same topology genus, and area-match to chordal tol).
2. **FeaTet.cpp:** replace the BRepMesh surface seed with the native surface mesh (import OCCT→native,
   sample faces). The tet mesher only needs a watertight, well-formed boundary triangle set. Gate:
   the FEA tet gates (`native_*fea*` / `feaTet` smokes) still pass — element count within tolerance,
   no inverted/degenerate boundary tris, closed surface.
3. **Oracle removal:** the mesh A/B gates that use BRepMesh as reference will not compile without
   TKMesh — capture BRepMesh outputs as golden fixtures (vert/tri counts + AABB + area per canonical
   solid) and convert to native-only golden regressions; keep the OCCT oracle behind an opt-in
   `#ifdef FORGE_HAVE_OCCT_MESH` TU excluded from the default build.
4. **Remove** both `#include <BRepMesh_IncrementalMesh.hxx>`. Confirm `grep -rE 'BRepMesh|IMeshData|
   IMeshTools' src/` is empty.
5. **Drop `TKMesh`** from `OCCT_LIBS` in `forge-kernel/CMakeLists.txt`.
6. **Gate before push (mandatory):** clean rebuild `build/`; `otool ... | grep -c opencascade` == **15**;
   `bash test/native/run_native.sh` JOBS=3 == 137/137 (watch `native_boolean_test` timing);
   `native_vs_occt_core.mjs` 34/34; `forge:coherence` DISCRIMINATION PASS. macOS flat-namespace hides
   bad drops → the true gate is **Linux CI green**, never the mac link.

## Discipline
- Warm main tree or worktree; **commit locally, DO NOT push** — human reviews diff + gate output and
  pushes (CI-green control, one workflow-kind at a time).
- If FeaTet native surface quality can't match BRepMesh for tet seeding on some scene, **do NOT drop
  TKMesh**: route only the display `Tessellate.cpp` path native (that's safe + verified), leave FeaTet
  on OCCT, record the precise FeaTet blocker here, keep everything green, commit the partial verified
  progress, and report honestly. No faked pass; the native tessellator reports failure rather than
  emit a non-watertight/degenerate mesh.
```

---

## VERIFICATION LOG — attempt 2026-07-17 (honest BLOCKER; TKMesh NOT dropped, tree reverted)

**Corrected state:** otool `opencascade` count is **17** (K4/TKHLR was NOT dropped, per the earlier
honest-blocker commit). K5 therefore targets **17 → 16**, not the stale "16 → 15" above.

**Outcome:** TKMesh is **NOT dropped.** Both `BRepMesh_IncrementalMesh` sites remain. The tree is
reverted **byte-identical to HEAD** (`git diff --stat` empty). Baseline re-verified after revert:
`otool … | grep -c opencascade` = **17**, `native_vs_occt_core.mjs` = **ALL 34 GATES PASS**,
`fea_smoke.cjs` = PASS. This is an honest verified blocker, not a fake pass.

### What was tried (all routed through the already-in-tree native mesher)
Both sites were routed through `forge::occtmesh::triangulateShapeInPlace` (the SAME in-house per-face
mesher already shipping for the Booleans mixed-operand soup + Drawings HLR retry — attaches a native
`Poly_Triangulation` per face; reads OCCT surfaces/pcurves only, never TKMesh). The two BRepMesh sites'
readback code was left unchanged.

- **`src/FeaTet.cpp:724` (tet seeding) — WORKS.** Contrary to the brief's "one real risk" framing, the
  FeaTet path was the SAFE one: `fea_smoke.cjs` PASS (1874 nodes / 10224 **volume** tets,
  `shellTetsOnly=false`, maxDisp 17.6 µm, σ 28.7 MPa — all in band), `fea_nafems_gate.mjs` hardFail=false
  (cantilever −0.28 %, patch machine-precision, modal 0.22 %, thermoelastic EXACT; LE1/LE10/LE11 are the
  pre-existing documented deferred-Tet10 accuracy gap, converging). The native shared-edge boundary is
  watertight and seeds the tet mesher correctly.

- **`src/Tessellate.cpp:68` (display/viewport) — THE BLOCKER.** `native_vs_occt_core.mjs` derives each
  op's bbox AND topology signature from `f.tessellate(h, 0.05, 0.3)` — and for the **OCCT reference**
  side of every A/B it runs the OCCT-handle branch, i.e. the site under test. The native mesher emits
  **phantom / mis-placed facets** for several OCCT display shape classes, breaking 6 of the 34 gates
  (prism, cut box-box, common box∩sphere, extrude rect, extrude L-profile, revolve90). Measured, e.g.:
  - `extrudeProfile(rect 4×3, +Z 5)` OCCT tessellated to bbox **z=[−5,5]** (phantom cap at z=−5), 8 tris
    (should be z=[0,5], 12 tris). Native/correct = z=[0,5].
  - `cut(box 4³, box 2×2×6 @ (1,1,−1))` OCCT tessellated with faces at **tool-LOCAL** coords
    (x∈[0,2], z∈[1,5]) instead of global (x∈[1,3], z∈[0,4]) → bbox z=[0,5] not [0,4].

### Root cause (precisely diagnosed)
`translate`/`rotate` on the OCCT path use `BRepBuilderAPI_Transform(…, copy=false)` — a rigid
**`TopLoc_Location`, not baked geometry**. That leaves un-baked locations that the native mesher reads
INCONSISTENTLY: the shared-edge cache in `OcctNativeMesh.cpp` uses global 3-D edge curves
(`BRep_Tool::Curve`, which applies the edge location) while the per-face path evaluates the OCCT
`Geom_Surface` in a frame that can differ. BRepMesh hides this by tessellating each face self-consistently
in its own frame; the native mesher's global-shared-edge design does not.

Two partial fixes were built and **measured**, neither sufficient alone:
1. **`OcctNativeMesh.cpp` edge-cache keyed on `(TShape, edge-location)` instead of `TShape` alone.**
   The cache ignored the edge location, so a `MakePrism` top ring (= bottom ring's TShape translated by
   the extrusion vector) / `MakeRevol` copy got the first-visited instance's points → phantom. The
   location-aware key **fixed 4 of 6** (extrude / revolve90 / prism now bbox- and topology-correct).
   This is a genuine latent-bug fix that also helps the existing Booleans/Drawings consumers. **Remaining
   2:** `cut box-box` and `common box∩sphere` (boolean RESULTS whose faces carry a residual location →
   surface-frame ≠ edge-frame; the cache key can't fix a per-face surface read).
2. **Hybrid `importOcctSolid → tessellateSolidForViewport`, occtmesh fallback** (the brief's step-1
   recommendation). `importOcctSolid` **fixed `cut box-box`** (analytic planar boolean imports faithfully)
   but **DEFERS on the curved boolean `common box∩sphere`** (falls to occtmesh → still phantom) and
   `tessellateSolidForViewport` **THREW** on the `draft` mesh-bridge shape (a new regression). Also
   `importOcctSolid` imports only the FIRST solid (unsafe for compounds/multi-solid display) and ignores
   `linearTol`/`angularTol` (fixed native fan density, not tol-controlled LOD).

The irreducible remainder is **`common box∩sphere`** (a curved boolean on a `copy=false`-translated
operand): occtmesh phantoms it, importOcctSolid defers on it. No in-scope change makes the display path
tessellate it correctly.

### Why not dropped
A mandatory gate (`native_vs_occt_core.mjs` must be 34/34) cannot be met while the display site is native,
and a "commit the partial" is only allowed with EVERY gate green (it isn't). The only clean fixes are
out-of-scope and regression-risky: (a) make `translate`/`rotate` bake geometry (`copy=true`) — a core-op
change touching every downstream boolean/lineage/gate; or (b) rework `OcctNativeMesh.cpp`'s frame handling
(and/or extend `importOcctSolid` to curved booleans + harden `tessellateSolidForViewport` for draft) —
surgery on shipping mesher code used by Booleans/Drawings. Per K5 discipline (honest revert, no faked or
unverified pass), the tree was reverted to HEAD. **Recommended follow-up for the human:** land the
edge-cache `(TShape, location)` key fix on its own (verified to fix extrude/revolve/prism, benefits
Booleans/Drawings), then close the boolean-frame gap via `copy=true` transforms or a frame-consistent
per-face path before re-attempting the K5 display route.
