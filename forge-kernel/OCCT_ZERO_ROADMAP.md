# Forge Kernel → OCCT-Zero Migration Roadmap

> Generated 2026-06-23 by an 8-agent per-file audit of the live kernel
> (`occt-migration-audit` workflow). Grounded in the actual source tree at
> `forge-kernel/src/`, not recall. Drives task #12 (in-house kernel) toward the
> governing goal: **100% in-house kernel, ZERO external geometry dependency.**
> Discipline (Bible §0): OCCT stays the live default AND A/B parity oracle until
> each native op is A/B-verified; flip behind a flag; **delete OCCT only at the
> very end** against a frozen golden corpus. Never replace a working path with a stub.

## 1. Executive summary — honest ~35–40% migrated

Of **33 OCCT-dependent source files**:
- **`exists` (5):** Primitives, Transform, Booleans, binding.cpp (pass-through), LOD
- **`partial` (17):** Features, BooleanTol, ShapeCheck, Tessellate, ClassASurfacing, LoftGuide, Airfoil, VarFillet, Sketcher, SheetMetalExtended, Weldments, MassProps, Fea, Cam, CamAdvanced, IoExchange, GltfExport, MateLibrary, ComponentRegistry
- **`missing` (8):** DirectModeling, Sewing, ShapeFix, SheetMetal, Mold, FeaTet, Drawings (HLR), + the unsupported-NURBS half of IoExchange

The file *count* flatters the truth: the high-value hard files (Features 1603 LOC, DirectModeling, Drawings/HLR, the full STEP read path, ShapeFix/Sewing healing) carry most of the CAD-correctness weight and are largely un-migrated. **Code that genuinely runs native today behind a verified A/B gate ≈ 35%** (Primitives, Transform, Booleans on analytic operands, MassProps, native-handle Tessellate). The other ~65% is OCCT-only or falls back to OCCT for any non-trivial input (trimmed NURBS, sewing, healing, HLR, foreign-STEP import).

Native substrate that already exists (credited): `native/brep/` — StepAnalytic (read+write), StepFaceted, Loft, Sweep, NurbsSurface, SurfaceIntersect, MassProps; `native/mesh/` — Repair (vertex-weld = sewing substrate), ProjectSilhouette (HLR substrate), Offset/Inset, Shell, HoleFill, Curvature.

## 1b. STATUS UPDATE — 2026-06-24 (native-build sprint, git-grounded)

The §1 figure (~35–40%) was the **2026-06-23 audit baseline**. A native-build sprint
since — 24+ commits `6a0ff98a`→`eb573265`, run in **balanced alternation with the 14B
training blocks** (GPU-train XOR kernel-clang; never concurrent) — has built AND
**A/B-certified vs OCCT** most of the Wave-3 "hard frontier" §4 listed as missing.
Ground truth in-tree right now: **124 native `src/native/**` modules · 117 pure-C++
native gates (all green, deterministic) · 32 `native_vs_occt_*` A/B harnesses.**

Wave-3 keystones now BUILT + certified (commit):
- **W3.1 trimmed-NURBS B-rep face (THE keystone blocker)** + foreign-STEP read — `21ddb928`, `7a1c70aa`
- NURBS-aware SSI + sew/heal — `2648a1ec`; **exact boolean (ExactReal EPECK)** — `7a1c70aa`
- **W3.4/W3.5** native validator (BRepCheck-class, ~30 predicates) + healing (ShapeFix-class) — `9ac09f87`
- fillet family: analytic rolling-ball + concave/edge-chains + asym/variable; chamfer; offset/shell; offset-shape — `9ac09f87`,`4f1e5cc4`,`d36e4f6d`
- loft/sweep/helical-sweep + analytic pattern + section — `7e145feb`, burst-2/3
- **W3.6 HLR** ortho + perspective — `7e145feb`
- **W3.10** Class-A G1 Coons fill (`7e145feb`) + G2 surface fill (`bad9be18`) + n-sided G1 Gregory hole-fill (`f3784933`)
- queries (min-distance / point-in-solid) + exact convex hull (CGAL-class) — `bad9be18`
- gear family: involute spur + internal/ring + straight bevel — `bad9be18`, `f3784933`
- libfive-class interval-guaranteed implicit mesher + PicoGK-class voxel-field ops — `f3784933`
- STEP + IGES read AND write — `d36e4f6d`, `7a1c70aa`

**HONEST distinction (Bible §0):** these are native CAPABILITIES that EXIST and pass an
A/B gate vs OCCT — or vs closed-form/analytic ground truth where OCCT has no primitive
(interval mesher, voxel-field op, gear, n-sided fill: analytic IS the stronger oracle).
OCCT is **still compiled** as the A/B oracle + fallback. The remaining work is **Phase D**
— flip every runtime op to native-default behind its gate, freeze an OCCT golden corpus,
then DELETE OCCT — deliberately last, against full regression + CADGenBench. Booleans
**lineage** (Modified/Generated/IsDeleted) and fuzzy-boolean policy remain the named
Phase-D gates (§5/§6). Net: the §4 "hard 65%" is now largely BUILT+certified; what's
left is the runtime-flip + oracle-freeze + deletion, not the geometry itself.

**CI determinism:** every randomized native gate takes a fixed default seed (argv[1]
override) — reproducible CI; the two RNG-consuming gates (interval-mesh, voxel-field)
pass **0/2048** in a seed-robustness sweep.

## 2. WAVE 1 — "ready to flip" (native EXISTS + A/B-testable)

Run `native_vs_occt` parity (volume/COM/inertia/AABB), confirm pass, flip the per-op `FORGE_NATIVE_BREP` gate to native-default; **keep OCCT compiled as oracle + fallback.** Lowest risk — do first.

| # | File | Op(s) | A/B metric | Note |
|---|------|-------|-----------|------|
| W1.1 | Primitives.cpp | 11 solids | vol/COM/inertia/AABB | gate already wired; native `SolidFactory` 1:1 |
| W1.2 | Transform.cpp | translate/rotate | AABB/COM; vol+inertia invariant | `applyNativeRT` Rodrigues path done |
| W1.3 | Booleans.cpp | fuse/cut/common — **native operands only** | vol/COM/inertia | keep OCCT for OCCT operands **and lineage** (native has no Modified/Generated/IsDeleted yet) |
| W1.4 | Tessellate.cpp | viewport tessellation (native handles) | tri-mesh vol/COM/AABB | already delegates |
| W1.5 | LOD.cpp | cache wrapper | mesh vol/COM/AABB | only OCCT call `BRepTools::Clean()` is a no-op for native |
| W1.6 | MassProps.cpp | vol/area/COM/inertia | direct parity (this *is* the oracle) | native divergence-theorem path guarded |

**Caveat:** Wave 1 makes native the *default* but does NOT remove OCCT — every op still falls back to OCCT for OCCT-backed handles, and Booleans lineage stays OCCT. Correct per Bible §0.

## 3. WAVE 2 — "moderate native build" (bounded addition + A/B gate)

| # | File | Native subsystem | OCCT API replaced | Work |
|---|------|------------------|-------------------|------|
| W2.1 | ComponentRegistry | geom/Aabb | BRepBndLib + Bnd_Box | `brep::computeAABB(handle)`; sole OCCT call |
| W2.2 | MateLibrary | linalg | gp_Quaternion::Multiply | replace one parity `rotateVec()`; pure deletion |
| W2.3 | GltfExport | mesh/HalfEdgeMesh | BRepMesh_IncrementalMesh | route tessellation native; A/B tri-count+AABB |
| W2.4 | BooleanTol | brep/Boolean | BRepAlgoAPI + SetFuzzyValue | add `fuzz`; else documented OCCT-only fallback |
| W2.5 | Sketcher | geom/Point2 rings | MakeWire/Edge, GC_MakeArcOfCircle | `extractProfileRings()` exists; retire `extractWires()` |
| W2.6 | Airfoil | brep/Nurbs,Loft,Surface | PointsToBSpline, ThruSections | NACA/Selig math pure; native rational curve + loft |
| W2.7 | Weldments | brep/Primitives | MakeBox/Cylinder, Fuse | native makers+boolean exist; migrate tube sweep/caps |
| W2.8 | CamAdvanced | cam + native topo iter | BRepBndLib, TopExp_Explorer | replace stock AABB; push CMM surface sampling |
| W2.9 | Fea (mesher) | mesh + csg/implicit classifier | BRepBndLib, BRepClass3d_SolidClassifier | K/M+Newmark already native; only voxel seeding |

## 4. WAVE 3 — "hard frontier" (new native capability)

| # | File | New native capability required |
|---|------|-------------------------------|
| W3.1 | **IoExchange — STEP import (foreign/NURBS)** | **trimmed-NURBS surface reader** (B-spline surface + trim-loop → native B-rep). `StepAnalytic::read` fails honestly at `StepAnalytic.cpp:749` on unsupported surfaces. **THE keystone blocker.** STL/BREP/IGES read/write also missing. |
| W3.2 | Features — guided loft, shell, offset | native NURBS surface filler (vs GeomFill_NSections) + analytic B-rep offset (vs BRepOffset_MakeOffset). Ruled loft already native. |
| W3.3 | DirectModeling | native B-rep face/edge direct-edit (push/pull, move/delete-face-and-heal); needs surface classification + healing (W3.4). Several ops not A/B-testable. |
| W3.4 | ShapeFix + Sewing | native healing + sewing; promote `mesh/Repair.cpp` weld to B-rep edge-merge + manifold detection. Gates direct-modeling + import cleanup. |
| W3.5 | ShapeCheck | native topological validator (~30 BRepCheck_Status predicates). Validate via known-bad regression suite, not A/B. |
| W3.6 | Drawings — HLR | native hidden-line removal (substrate `mesh/ProjectSilhouette.cpp`); regression-image compare, not A/B. |
| W3.7 | Cam | native **2D planar** wire offset (vs BRepOffsetAPI_MakeOffset); `mesh/Offset` is 3D. |
| W3.8 | FeaTet | native BRep→triangle surface mesher (vs BRepMesh) + interior classifier. Bowyer-Watson/Tet-4 already native. |
| W3.9 | SheetMetal/Extended/Mold | native boolean **Splitter** (vs BRepAlgoAPI_Splitter; Mold cavity/core — no native eq), BRepGProp_Face::Normal for draft. |
| W3.10 | ClassASurfacing/LoftGuide/VarFillet | native analytic surface derivatives (G0–G3), surf-surf projection, and — VarFillet — **analytic rolling-ball fillet surface** with radius laws. Deepest single item. |

## 5. Critical path & the single biggest blocker

**Biggest blocker: native trimmed-NURBS STEP read (W3.1).** Any real-world / benchmark / customer part routes to OCCT's `STEPControl_Reader` the moment a face isn't one of the 5 canonical quadrics. Until native can read trimmed-NURBS, OCCT cannot be deleted — you'd lose the ability to read your own benchmark corpus.

**Must-precede constraints:**
1. **Native trimmed-NURBS surface (read+eval) = keystone** → precedes STEP import, guided loft, Class-A, VarFillet, direct-modeling surface classification. Build first in Wave 3.
2. Native healing/sewing (W3.4) → precedes DirectModeling delete-face-and-heal + robust STEP cleanup.
3. Native B-rep offset (W3.2) → precedes SheetMetal offset.
4. Native Booleans **lineage** → required before Booleans drops OCCT entirely (Wave 1 only flips native-on-native).

**Global order:** Phase A = Wave 1 flips (days). Phase B = Wave 2 builds (1–2 wks). Phase C = Wave 3 keystone-first (NURBS surface → STEP → healing → direct-model → HLR → loft/offset/shell → VarFillet → CAM 2D offset → FeaTet → sheet/mold). Phase D = delete OCCT only after zero runtime OCCT calls under full regression + CADGenBench, against a frozen golden corpus.

## 6. Risks & oracle gaps

- **Coincidental mass-props parity** (most dangerous silent failure): two different solids can share vol/COM/inertia/AABB. **Every topology-changing op's A/B gate MUST add a topology signature** (face/edge/vertex counts + adjacency hash), not just mass props.
- **Oracle-removal paradox:** OCCT is both fallback AND A/B oracle. **Freeze an OCCT-built golden-output corpus before deletion** so post-deletion regression keeps a truth source.
- **Fuzzy booleans + Booleans lineage are OCCT-only today** → may be "documented OCCT-only fallback" → which blocks total deletion unless reimplemented. Decide policy early; it gates Phase D.
- **Trimmed-NURBS scope creep:** bound W3.1 to the STEP AP203/AP214 surface subset in the CADGenBench + demo corpora first; don't chase OCCT's full coverage.
- **VarFillet (W3.10)** analytic rolling-ball fillet is STEP-grade hard — may be migrated last or kept OCCT-only with documented limitation.
- **Not A/B-testable** (need regression/image/round-trip checks instead): DirectModeling, ShapeFix, ShapeCheck, Drawings(HLR), IoExchange round-trip, Sketcher(2D).

---
**Bottom line:** Wave 1 is genuinely "flip after A/B" — safe to start the moment the GPU frees from training. The hard 65% is STEP-NURBS read, healing/sewing, HLR, offset/shell, guided/var fillet; the **native trimmed-NURBS surface reader/evaluator is the one capability that unblocks the most of it.**
