# K5 blocker — `forge::occtmesh` is not yet a drop-in for `BRepMesh_IncrementalMesh`

Measured 2026-07-09 on `archdisc @ 10499f7a` by merging `k5-tkmesh-callers-swap` (the branch that
swaps the last two `BRepMesh_IncrementalMesh` call sites in `src/FeaTet.cpp` and `src/Tessellate.cpp`)
and running the A/B gate. The merge was **rolled back**; trunk is green.

    native_vs_occt_core.mjs   ->   6 GATE FAILURE(S) — native != reference on some op

## What fails

| # | gate | volume | verdict |
|---|------|--------|---------|
| 10 | `prism(6,1.5,3)` | 17.537014 vs 17.537014, err 2e-16 | FAIL — F/E signature `8/18` |
| 15 | `cut box-box` | 48.000000 vs 48.000000, err 1e-16 | FAIL |
| 17 | `common box∩sphere` | 24.870944 vs **24.862589** | FAIL — 3.36e-4 relative |
| 31 | `revolve90 rect[2,3]x[0,4] @Y` | — | **TOPOLOGY signature mismatch: χ=-6 / genus=4 vs χ=2 / genus=0** |
| 34 | `extrude rect(4x3) +Z d=5` | 60.000000 vs 60.000000, err 0 | FAIL |
| 35 | `extrude L-profile +Z d=2` | 32.000000 vs 32.000000, err 1e-16 | FAIL |
| 37 | `revolve90 rect[2,3]x[0,4] @Y` | 15.707963 vs 15.707913 | FAIL — 3.17e-6 |

## The diagnosis

A 90° revolve of a rectangle about an axis in its plane is topologically a **ball**: χ = 2, genus 0.
One side of gate 31 reports **genus 4**. Meanwhile gates 34/35 have volumes agreeing to *machine
epsilon* and still fail.

**Volume is blind to the defect.** A mesh can be riddled with cracks and still integrate to the exact
right volume, because the divergence-theorem sum telescopes over the open edges. What changes is the
Euler characteristic. That is why the topology signature (χ / genus + planar-analytic B-rep F/E)
exists in `native_vs_occt_core.mjs`, and it is the only thing that caught this.

This is the same class of defect as the native→OCCT bridge emitting `makeCylinder(7,25)` as 130 faces
(see `OCCT_DEPENDENCY_TRUTH.md`): mass properties exact to 1e-12, face identity wrong, every
volume-based A/B gate passing.

    forge::occtmesh does not produce a watertight, conformally-stitched mesh for
      - revolved surfaces (gate 31, 37)
      - curved∩planar boolean results (gate 17)
    and it changes the B-rep F/E signature on straight prisms/extrudes (gates 10, 34, 35).

## What has to be true before K5 can land

1. `occtmesh` output must be **watertight**: every triangle edge shared by exactly two triangles.
   Gate on `χ` of the emitted mesh, not on its volume.
2. Vertices must be **welded across surface patch seams** — the F/E signature drift on a straight
   prism (`8/18`) says adjacent patches emit duplicate vertices along the shared edge.
3. Revolved/curved surfaces need seam handling at the periodic parameter boundary (u=0 ≡ u=2π).
4. Only then swap `FeaTet.cpp` and `Tessellate.cpp`, and only then can `TKMesh` leave `OCCT_LIBS`.

## Reproduce

    git merge --no-commit --no-ff k5-tkmesh-callers-swap
    cmake --build forge-kernel/build -j4
    cd forge-kernel && FORGE_KERNEL=build/Release/forge-kernel.node node test/native_vs_occt_core.mjs
    git merge --abort

`k5-native-mesh-wf_ed72df97` (the branch that introduces `forge::occtmesh` itself) conflicts on
`CMakeLists.txt` and `OCCT_REPLACEMENT_ROADMAP.md` and is **not** merged either. K5 stays open.

## Status of the OCCT-zero series after 2026-07-09

    MERGED GREEN   k6-directmodeling-native      DirectModeling.cpp -> native Vec3
                   k6-mold-migration             Mold.cpp -> native Vec3
                   k3-general-fillet             native general-dihedral convex edge fillet
    ROLLED BACK    k5-tkmesh-callers-swap        6 gate failures (this document)
    UNMERGED       wf_fdf8f816_gapA              conflicts: src/Booleans.cpp
                   k2-native-fuzzy-boolean       conflicts: src/BooleanTol.cpp
                   k4-persp-hlr-sewheal          conflicts: src/Drawings.cpp
                   k5-native-mesh                conflicts: CMakeLists.txt, roadmap
                   k7-capi-skeleton              conflicts: test/capi/forge_capi_smoke.cpp

North-star unchanged: `otool -L forge-kernel.node | grep -ci opencascade` = **19** (was 22, target 0).
These three merges migrate call sites off OCCT algebra; no toolkit can leave `OCCT_LIBS` until the
last caller of that toolkit is gone.
