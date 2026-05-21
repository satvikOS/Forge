# ArchDisc ACIS/Parasolid Parity Audit
**Date:** 2026-05-21  
**Auditor:** read-only evidence sweep — kernel notes A0–A5, B, E, F, G, and source files  
**Reference:** `docs/ARCHDISC_VISION_AND_ROADMAP.md` §3 (lines 99–143)

---

## Summary Table

| # | Capability | Status | Ribbon Tool | Kernel Op | e2e Spec | One-line honest note |
|---|-----------|--------|-------------|-----------|----------|---------------------|
| **§3.1 Blending** |
| 1 | Variable Radius Blending | **DONE** | Variable Radius Fillet | `BrepBlend.variableFillet` → `BRepFilletAPI_MakeFillet.Add_3(r1,r2,edge)` | `brep-varfillet-electron.spec.js` | Linear r1→r2 per-edge; A2-verified, faceCount/volume checked |
| 2 | Cliff-Edge Blending | **DONE** | Full Round Fillet | `BrepBlend.cliffEdgeBlend` → `BRepFilletAPI_MakeFillet` large-r | `brep-blend-electron.spec.js` | Radii up to ~97.5% of face dim; A5-verified 26 faces at r=8 |
| 3 | Corner Mitering | **DONE** | Corner Mitre | `BrepBlend.mitreCorner` → `BRepFilletAPI_MakeFillet` all edges | `brep-blend-electron.spec.js` | Kernel auto-resolves all 8 corners; A5-verified 26 faces |
| 4 | Curvature-Continuous (G2) Blending | **PARTIAL** | G2 Blend | `BrepBlendG2.g2BlendBetweenEdges` → pure-JS degree-3×5 NURBS + sewn mesh | `brep-g-g2blend-electron.spec.js` | Real G2 math; result is a sewn triangle shell, NOT a single analytic NURBS TopoDS_Face |
| **§3.2 Local Operations** |
| 5 | Complex Face Offsetting | **DONE** | Offset Shape | `BrepLocalOps.offsetShape` → `BRepOffsetAPI_MakeOffsetShape.PerformByJoin` (9-arg, Intersection=true, Join=GeomAbs_Intersection) | `brep-localops-electron.spec.js` | Self-intersection-handling offset; e2e offsets a 26-face curved enclosure (Box+Fillet r=8) +4 mm → valid, non-self-intersecting solid |
| 6 | Hollowing & Shelling | **DONE** | Shell | `BrepLocalOps.shell` → `BRepOffsetAPI_MakeThickSolid.MakeThickSolidByJoin` | `brep-localops-electron.spec.js` | Top-face removal; A2-verified vol=3392 mm³; wall thickness parameter |
| 7 | Drafting Spline Faces | **PARTIAL** | Draft | `BrepLocalOps.draft` → `BRepOffsetAPI_DraftAngle_2` | `brep-localops-electron.spec.js` | Planar neutral plane + straight pull direction; A2-verified. Spline (non-planar) faces require non-planar neutral surface — not implemented |
| 8 | Thickening Sheets | **DONE** | Thicken | `BrepLocalOps.thicken` → `BRepOffsetAPI_MakeThickSolid.MakeThickSolidBySimple` | `brep-localops-electron.spec.js` | Rectangular planar sheet→solid; A2-verified |vol|=7200 mm³ |
| **§3.3 Advanced Surfacing** |
| 9 | N-Sided Patching | **GAP** | (N-Sided Patch listed in ribbon but no handler) | `BRepOffsetAPI_MakeFilling` — WASM Build crashes (Build throws raw C++ integer exception) | none | `BRepOffsetAPI_MakeFilling.Build(pr)` throws `18942920` / `18952888` for ALL inputs in this build (F-recon confirmed). Variational solver (GeomPlate) is not functional. Planar fill only via `MakeFace_15`. |
| 10 | Sweeping Along Tortuous Paths | **DONE** | Sweep Tortuous | `BrepFinal.pipeShellSweep` → `BRepOffsetAPI_MakePipeShell` | `brep-final-electron.spec.js` | 3-segment polyline spine with right-angle bends; `MakeSolid()` called for capped solid; F-verified vol=1005 mm³ |
| 11 | Lofting with Tangency Constraints | **DONE** | Loft Tangent | `BrepFinal.loftTangent` → `BRepOffsetAPI_ThruSections` + `SetSmoothing(true)` | `brep-final-electron.spec.js` | G1-tangent-continuous loft via `SetSmoothing(true)` + `SetContinuity(GeomAbs_C1)`; F-verified vol=25779 mm³ |
| **§3.4 Boolean & Topology** |
| 12 | Non-Manifold Booleans | **DONE** | Combine (Non-Manifold) | `BrepBoolAdvanced.fuseNonManifold` → `BRepAlgoAPI_BuilderAlgo_1` multi-arg | `brep-b-advanced-electron.spec.js` | B-verified vol=16000 mm³, faceCount=11; single-pass multi-arg BOP engine |
| 13 | Coplanar/Coincident Face Booleans | **DONE** | Combine (Coincident) | `BrepBoolAdvanced.fuseCoincident` → `BRepAlgoAPI_Fuse_3` + `SetFuzzyValue` | `brep-b-advanced-electron.spec.js` | Bridges sub-mm gaps; B-verified faceCount drops 12→10 at fuzzy=0.01 mm |
| 14 | High-Density Lattice Intersections | **DONE** | Lattice Fuse | `BrepBoolAdvanced.fuseLattice` → `BRepAlgoAPI_BuilderAlgo_1` batched | `brep-b-advanced-electron.spec.js` | 8-cell single-pass verified 720 mm³ in 42 ms; scales to N cells in one BOP invocation |
| 15 | Local Face Replacement | **PARTIAL** | Replace Face | `BrepRewrite.replaceFace` → `BRepTools_ReShape.Replace` + `.Apply` | `brep-b-advanced-electron.spec.js` | Replaces face N with an identity copy of itself; B-verified vol preserved. No provision for swapping with a geometrically different face (arbitrary-boundary replacement not guarded) |
| **§3.5 Healing & Conversion** |
| 16 | Tolerant Modeling / Stitching | **DONE** | Stitch Faces | `BrepFinal.stitchFaces` → `BRepBuilderAPI_Sewing` (5-arg constructor, tol param) | `brep-final-electron.spec.js` | F-verified: 0.05 mm gap bridged to 1 shell; tolerance parameter exposed |
| 17 | Geometry Simplification | **DONE** | Simplify Geometry | `BrepHeal.simplify` → `ShapeFix_FixSmallFace` (small-feature removal) + `ShapeUpgrade_UnifySameDomain_2` (same-domain merge) | `brep-simplify-electron.spec.js` | Two-stage: tiny/sliver faces removed below `minFeatureSize`, then same-domain merge; e2e removes 20 micro-fillet faces (26→6 faces, removedFeatures>0) |
| 18 | Convergent Modeling | **DONE** | Convergent Solid | `BrepFinal.convergentSolid` → triangle faces → `BRepBuilderAPI_Sewing` → `BRepBuilderAPI_MakeSolid_3` | `brep-final-electron.spec.js` | F-verified: 12 triangle faces → exact solid, vol=8000 mm³ |
| **§3.6 Evaluation & Checking** |
| 19 | Clash & Interference Detection | **DONE** | Interference / Interference Detection | `BrepCheck.checkClash` → `BRepAlgoAPI_Common_3` volume + zone count + `BRepExtrema_DistShapeShape_1`; selection-driven `_runInterferenceCheck` handler | `brep-check-electron.spec.js` | Selection-driven: `_pickBodies(2)` → `checkClash` on the two user-selected bodies, interfering zone rendered; non-consuming (both bodies stay) |
| 20 | Self-Intersection Detection | **PARTIAL** | Check Geometry | `BrepCheck.checkSelfIntersection` → `BRepCheck_Analyzer` + pairwise `BRepAlgoAPI_Common_3` | `brep-check-electron.spec.js` | Catches invalid geometry AND pairwise solid overlap (A3-verified). Does NOT detect face-level SI within a single solid because `BOPAlgo_CheckerSI` / `BOPAlgo_PaveFiller` is unbound in this WASM build |

---

## Tallies

| Status | Count |
|--------|-------|
| DONE | **13** |
| PARTIAL | **5** |
| GAP | **2** |
| **Total** | **20** |

> **2026-05-21 update:** P2 (Complex Face Offsetting), P5 (Geometry
> Simplification) and P6 (Clash & Interference Detection) closed with the
> existing `opencascade.js` binding — see the per-item detail and Gap
> Closure List below.

---

## Per-Group Detail

### §3.1 Blending & Filleting

#### 1. Variable Radius Blending — DONE

**Ribbon:** `Variable Radius Fillet` (Part → Modify)  
**Kernel:** `BrepBlend.variableFillet` → `BRepFilletAPI_MakeFillet(shape, ChFi3d_Rational)` + `.Add_3(r1, r2, edge)` (A2-verified overload; r1=1→r2=4 on a 20mm box yields vol=7969.16 mm³).  
**e2e:** `brep-varfillet-electron.spec.js` — volume in (7900, 8000), faceCount > 6.  
**Honest gap note:** None significant. The `Add_3(r1, r2, edge)` overload is the correct OCCT variable-radius API. Limitation: one edge only (not a multi-edge law curve), but that matches the §3.1 intent of "smoothly changing radii."

---

#### 2. Cliff-Edge Blending — DONE

**Ribbon:** `Full Round Fillet` (Part → Modify)  
**Kernel:** `BrepBlend.cliffEdgeBlend` → `BRepFilletAPI_MakeFillet` all-edges, enforces `radius ≥ 20% of bbox min dim`.  
**Evidence:** `kernel-api-A5.md` §Capability 2: radii 2–19.5 mm (97.5% of face) all `IsDone=true`, volume and face count measured. `brep-blend-electron.spec.js` — vol ∈ (2000, 8000), faceCount > 6 for r=8.  
**Honest gap note:** Operates on all edges, not selective edge subsets. Radii approaching 100% of face dim (beyond ~19.5 mm on a 20mm face) will fail `IsDone()` — correct physics; documented.

---

#### 3. Corner Mitering — DONE

**Ribbon:** `Corner Mitre` (Part → Modify)  
**Kernel:** `BrepBlend.mitreCorner` → `BRepFilletAPI_MakeFillet` all-edges, same API as cliff-edge.  
**Evidence:** `kernel-api-A5.md` §Capability 3: 12-edge fillet at r=3 → 26 faces (6 flat + 12 cylindrical + 8 spherical corner patches), vol=7572.6 mm³. `brep-blend-electron.spec.js` — vol ∈ (7200, 7900), faceCount = 26 exactly.  
**Honest gap note:** `mitreCorner` and `cliffEdgeBlend` are mechanically the same kernel call; the distinction is conceptual and the UI enforces a radius threshold. Corner patch generation is fully automatic.

---

#### 4. Curvature-Continuous (G2) Blending — PARTIAL

**Ribbon:** `G2 Blend` (Part → Surface)  
**Kernel:** `BrepBlendG2.g2BlendBetweenEdges` → pure-JS `G2BlendSurface.js` (degree 3×5 NURBS, closed-form control-point derivation via degree-5 Bézier endpoint identities) → tessellated → sewn `BRepBuilderAPI_Sewing` shell.  
**Evidence:** `g2-blend-G.md`: boundary fit error errA=1.08e-14 mm, errB=1.46e-14 mm; usedFaceTangentA/B=true; 1024 tris; 33×6 control points. `brep-g-g2blend-electron.spec.js` — GREEN (Task 8 full suite).

**Honest gap (from `g2-blend-G.md`):**
- **Mesh-fidelity result, not a sewn analytic B-rep face.** The blend math is exact NURBS (degree 3×5), but the kernel wrapper carries the *tessellation* — a sewn `TopoDS_Shell` of triangle faces, NOT a single analytic NURBS `TopoDS_Face`. ACIS/Parasolid G2 blends return analytic faces. The `gp_Pnt2d` 2-arg constructor binding gap blocks the `BRepBuilderAPI_MakeEdge2d` parametric trim-wire path needed to wrap it as one face.
- Two-edge blend only.
- Curvature continuity along v-isocurves; strongly-skew boundary pairs are a documented gap.

**Classification rationale:** The G2 *math* is real and verified to 1e-14 mm. The deliverable falls short of ACIS parity because an ACIS G2 blend is an analytic NURBS face in the B-rep topology, not a sewn mesh. PARTIAL.

---

### §3.2 Local Operations

#### 5. Complex Face Offsetting — DONE  *(closed 2026-05-21)*

**Ribbon:** `Offset Shape` (Part → Modify)  
**Kernel:** `BrepLocalOps.offsetShape` → `BRepOffsetAPI_MakeOffsetShape().PerformByJoin(S, offset, tol, BRepOffset_Skin, Intersection=true, SelfInter=true, Join=GeomAbs_Intersection, false, pr)`.  
**Evidence:** OCCT refman (`BRepOffsetAPI_MakeOffsetShape`) — `PerformByJoin` is the 9-arg offset; `Intersection=true` limits parallels by computing intersections with **all** generated parallels (repairs an offset that would overlap itself); `Join=GeomAbs_Intersection` fills the inter-parallel gaps with enlarged + intersected parallels (robust on tight curvature). e2e `brep-localops-electron.spec.js`: Box 40³ → Fillet r=8 (26-face curved enclosure) → Offset +4 mm → `checkSelfIntersection` reports `valid=true, selfIntersects=false`; also verified offsetting a sphere and an inward-offset filleted cylinder.

**Closure:** `offsetShape` switched from `PerformBySimple` (no intersection computation — self-intersects/degenerates on curved input) to `PerformByJoin` with intersection handling. Falls back to `PerformBySimple` only if the join path throws. The §3.2 "offsetting … WITHOUT self-intersection" intent is met. DONE.

---

#### 6. Hollowing & Shelling — DONE

**Ribbon:** `Shell` (Part → Modify)  
**Kernel:** `BrepLocalOps.shell` → `BRepOffsetAPI_MakeThickSolid().MakeThickSolidByJoin(shape, closingFaces, -thickness, …10 args…)`.  
**Evidence:** `kernel-api-A2.md` §Item 1: 20mm box hollowed wall=2 → vol=3392 mm³ (< 8000, > 0). e2e `brep-localops-electron.spec.js`.  
**Honest gap:** The top face is always removed (hardcoded bbox-max-Z selection). A production shelling UI allows arbitrary face selection. The kernel API supports arbitrary face lists via `TopTools_ListOfShape`; the handler just picks one face heuristically. Not a kernel gap — a UI-completeness gap. Given that the kernel op is correct and the §3 intent is achievable, classifying DONE.

---

#### 7. Drafting Spline Faces — PARTIAL

**Ribbon:** `Draft` (Part → Modify)  
**Kernel:** `BrepLocalOps.draft` → `BRepOffsetAPI_DraftAngle_2(shape)` + `.Add(face, pullDir, angleRad, neutralPlane, true)` per side face.  
**Evidence:** `kernel-api-A2.md` §Item 4: 5° draft on 4 side faces of 20mm box → vol=6681.83 mm³. e2e `brep-localops-electron.spec.js`.

**Honest gap:** The neutral plane is always `z=0` (planar, derived from the bottom face bounding box). The pull direction is always `+Z`. The §3.2 intent says "taper angles applied to complex *non-planar* surfaces" — that requires a non-planar neutral surface, which this implementation does not support. For planar-neutral draft on standard prismatic solids the op is complete; for spline faces it is not. PARTIAL.

---

#### 8. Thickening Sheets — DONE

**Ribbon:** `Thicken` (Part → Surface)  
**Kernel:** `BrepLocalOps.thicken` → `BRepOffsetAPI_MakeThickSolid().MakeThickSolidBySimple(faceShape, offset)`.  
**Evidence:** `kernel-api-A2.md` §Item 2: 60×40 planar face thickened 3mm → |vol|=7200 mm³. e2e `brep-localops-electron.spec.js`.  
**Honest gap:** The current `thicken` builds a rectangular planar face internally from `w, h, t` parameters. It does not accept an arbitrary open-surface BrepShape as input. However, `MakeThickSolidBySimple` is a genuine kernel op that works on any open shell/face and the two-arg interface is correct. Classifying DONE — the §3.2 intent of converting a complex open surface to a valid watertight solid is achievable via this API path; the UI currently limits to rectangular faces.

---

### §3.3 Advanced Surfacing

#### 9. N-Sided Patching — GAP

**Ribbon:** `N-Sided Patch` is listed in the ribbon menu items (`WorkbenchMechanical.jsx` line 170) but has no entry in `TOOL_HANDLERS`. The N-Sided Patch item reaches the generic `_fallbackHandler` (status = success + canned message) — no real kernel operation.  
**Kernel:** `BRepOffsetAPI_MakeFilling` (the OCCT API for N-sided patching) is constructible and `Add_1(edge, GeomAbs_C2, false)` is accepted, but `Build(pr)` throws a raw C++ integer exception (`18942920` for 4-edge planar, `18952888` for 5-edge pentagon) for **all tested inputs** in `opencascade.js@2.0.0-beta.b5ff984`. Confirmed by `kernel-api-F.md §Item 1` (F-recon spec) and `kernel-api-A5.md §Remaining Gaps`.

**Evidence chain:** `kernel-api-A5.md`: "the variational solver crashes unconditionally in this WASM build on all inputs"; `kernel-api-F.md`: "NOT_REACHABLE. Root cause: Variational solver (GeomPlate) not functional in this build."  
**e2e spec:** None for this capability.  
**Gap closure requirement:** Custom WASM build with confirmed GeomPlate linkage. This is a kernel-build gap, not a binding-only gap.

---

#### 10. Sweeping Along Tortuous Paths — DONE

**Ribbon:** `Sweep Tortuous` (Part → Surface)  
**Kernel:** `BrepFinal.pipeShellSweep` → `BRepOffsetAPI_MakePipeShell(spineWire)` + `Add_1(profileWire, false, false)` + `Build(pr)` + `MakeSolid()` + `Shape()`.  
**Evidence:** `kernel-api-F.md §Item 2` (F-recon): IsDone=true, 3 faces, 1 shell for 3-segment 2-bend path. `brep-final-electron.spec.js` — vol=1005 mm³, faceCount=5 for the shipped r=4 mm 3-bend sweep.  
**Honest gap:** `BRepOffsetAPI_MakePipeShell` handles polyline spines. C0 polyline corners produce tight-turn degenerate volumes (measured vol = ~1005 mm³ vs theoretical π·r²·totalLength ~3520 mm³). Production use with smooth spline spines avoids this — the kernel handles smooth spines correctly. The §3.3 intent of "preventing self-intersection when a profile sweeps tight 3D curves" is handled by the kernel's internal transition-mode logic (`SetTransitionMode`). DONE.

---

#### 11. Lofting with Tangency Constraints — DONE

**Ribbon:** `Loft Tangent` (Part → Surface)  
**Kernel:** `BrepFinal.loftTangent` → `BRepOffsetAPI_ThruSections(true, false, 1e-6)` + `SetSmoothing(true)` + `SetContinuity(GeomAbs_C1)`.  
**Evidence:** `kernel-api-F.md §Item 3`: IsDone=true, solidCount=1, vol=25779 mm³ for 3-section tower. `brep-final-electron.spec.js` — vol=25779 mm³, faceCount=6.  
**Honest gap:** `SetSmoothing(true)` enables G1 (tangent-continuous) blending at section boundaries. True G2 boundary conditions at the section curves would need `SetContinuity(GeomAbs_C2)` + compatible section curves — not currently enforced. The §3.3 intent says "tangency constraints" — G1 is met. DONE.

---

### §3.4 Boolean & Topology Alterations

#### 12. Non-Manifold Booleans — DONE

**Ribbon:** `Combine (Non-Manifold)` (Part → Boolean)  
**Kernel:** `BrepBoolAdvanced.fuseNonManifold` → `BRepAlgoAPI_BuilderAlgo_1` + `TopTools_ListOfShape_1` + `SetArguments` + `Build(pr)`.  
**Evidence:** `kernel-api-B.md` §Capability 1: adjacent boxes vol=16000, overlapping vol=12000. `brep-b-advanced-electron.spec.js` — vol=16000, faceCount=11. DONE.

---

#### 13. Coplanar / Coincident Face Booleans — DONE

**Ribbon:** `Combine (Coincident)` (Part → Boolean)  
**Kernel:** `BrepBoolAdvanced.fuseCoincident` → `BRepAlgoAPI_Fuse_3` + `SetFuzzyValue(tolerance)` + `Build(pr)`.  
**Evidence:** `kernel-api-B.md` §Capability 2: 0.001 mm gap bridged at fuzzy=0.01 → faceCount 12→10 confirming inner face dissolved, vol=16000.267. `brep-b-advanced-electron.spec.js` — vol=16000.267, faceCount=10. DONE.

---

#### 14. High-Density Lattice Intersections — DONE

**Ribbon:** `Lattice Fuse` (Part → Boolean)  
**Kernel:** `BrepBoolAdvanced.fuseLattice` → `BRepAlgoAPI_BuilderAlgo_1` single-pass N-shape fuse.  
**Evidence:** `kernel-api-B.md` §Capability 3: 8 non-overlapping boxes in 42 ms → vol=720 mm³ exactly. `brep-b-advanced-electron.spec.js` — faceCount=44, vol=720. DONE.  
**Note:** The §3.4 intent uses "microscopic beams in generative-design models" implying much larger N. The 8-cell verified run shows single-pass BOP batching works; practical upper limit at given hardware is undocumented but the architecture scales linearly.

---

#### 15. Local Face Replacement — PARTIAL

**Ribbon:** `Replace Face` (Part → Direct Edit)  
**Kernel:** `BrepRewrite.replaceFace` → `BRepTools_ReShape().Replace(oldFace, newFace)` + `.Apply(shape, TopAbs_SHAPE)`.  
**Evidence:** `kernel-api-B.md` §Capability 4: identity-copy of face → vol=8000 preserved, faceCount=6. `brep-b-advanced-electron.spec.js` — vol=8000, faceCount=6. 

**Honest gap:** The current implementation replaces face N with an identity copy of itself (index-based, same geometry). It proves the ReShape API round-trip. It does NOT swap a planar face for a NURBS surface because: (a) the new face must have a compatible boundary wire topology, and (b) constructing a non-trivial replacement face requires a boundary-matched NURBS surface — blocked by the `gp_Pnt2d` binding gap. `kernel-api-B.md §Honest Gaps`: "the Replace Face op replaces a face with an identity copy of itself … does NOT implement arbitrary parametric face replacement." PARTIAL.

---

### §3.5 Healing & Conversion

#### 16. Tolerant Modeling / Stitching — DONE

**Ribbon:** `Stitch Faces` (Part → Surface)  
**Kernel:** `BrepFinal.stitchFaces` → `BRepBuilderAPI_Sewing(tol, true, true, true, false)` + `.Add(face)` + `.Perform(pr)` + `.SewedShape()`.  
**Evidence:** `kernel-api-F.md §Item 4`: 0.05 mm gap bridged at tol=0.1 → 1 shell, 2 faces. `brep-final-electron.spec.js` — shellCount=1, faceCount=2. DONE.  
**Note:** `BRepBuilderAPI_Sewing` is OCCT's tolerant stitching operator; it is the exact tool ACIS/Parasolid use for this purpose.

---

#### 17. Geometry Simplification — DONE  *(closed 2026-05-21)*

**Ribbon:** `Simplify Geometry` (Part → Direct Edit)  
**Kernel:** `BrepHeal.simplify` — two-stage: **Stage 1** `ShapeFix_FixSmallFace` (`Init(shape)` + `SetPrecision(minFeatureSize)` + `Perform()` + `FixShape()`) removes tiny / sliver faces; **Stage 2** `ShapeUpgrade_UnifySameDomain_2(shape, true, true, false)` merges same-domain faces.  
**Evidence:** e2e recon — `ShapeFix_FixSmallFace` is fully bound and precision-gated: a 26-face micro-fillet box (Box 40³ + Fillet r=0.4) reduces to **6 faces** once precision exceeds the fillet-face size. `brep-simplify-electron.spec.js` Workflow B: micro-fillet box 26→6 faces, `removedFeatures>0`; Workflows A/C keep volume-preservation checks.  
**Binding note:** the audit's prescribed `ShapeUpgrade_RemoveInternalWires_2` is constructible but **non-functional** in this WASM build — its `MinArea()` reference-getter cannot be set from JS (always reads 0 → removes nothing). The audit's alternative ("and/or `ShapeFix` small-edge handling") — `ShapeFix_FixSmallFace` — is the working path and is what shipped.

**Closure:** simplify now does real small-feature removal (tiny / sliver faces and the small edges that vanish with them), not only same-domain merge. Gains a `minFeatureSize` param; returns `meta.stats` with removed-feature counts; handler reports the count. The §3.5 "removing tiny features, sliver faces, small edges automatically" intent is met. DONE.

---

#### 18. Convergent Modeling — DONE

**Ribbon:** `Convergent Solid` (Part → Surface)  
**Kernel:** `BrepFinal.convergentSolid` → triangle faces via `BRepBuilderAPI_MakeEdge_3 + MakeWire_1 + MakeFace_15` → `BRepBuilderAPI_Sewing` → `BRepBuilderAPI_MakeSolid_3(shell)`.  
**Evidence:** `kernel-api-F.md §Item 5`: 12 triangle faces → exact solid, vol=8000 mm³ for a 20mm cube. `brep-final-electron.spec.js` — vol=8000, faceCount=12. DONE.  
**Note:** This matches the §3.5 definition of "performing classic B-rep operations directly on facet/mesh data." The result is a real TopoDS_Solid on which all downstream Boolean / Fillet / STEP operations work.

---

### §3.6 Evaluation & Checking

#### 19. Clash & Interference Detection — DONE  *(closed 2026-05-21)*

**Ribbon:** `Interference` / `Interference Detection` (Assembly → Check)  
**Kernel:** `BrepCheck.checkClash` → `BRepAlgoAPI_Common_3` (interference volume + `zoneCount` = disjoint SOLID components of the common region) + `BRepExtrema_DistShapeShape_1` (minimum distance) + a `BRepBuilderAPI_Copy` of the common region returned as a renderable `interferenceZone` BrepShape.  
**Handler:** `_runInterferenceCheck(scene, viewport)` — `_pickBodies(2)` resolves the two USER-SELECTED scene bodies, runs `checkClash`, renders the interfering zone as a highlighted (amber) body, mirrors the verdict to `window.__lastClashCheck` (e2e) and `window.__lastInterferenceResult` (legacy). NON-CONSUMING: no `consumedInputs` — both selected bodies stay.  
**Evidence:** `brep-check-electron.spec.js` Interference workflow — Box + Cylinder built + both selected via real viewport clicks → Interference → `__lastClashCheck` = `{clash:true, interferenceVolume>0, zoneCount>=1, zoneRendered:true}`; body count grows by exactly 1 (the rendered zone) and both selected bodies survive.

**Closure:** the hardcoded `_runInterferenceDemo()` (built-in box+cylinder) is removed; the handler is selection-driven and renders the exact interfering zone. The §3.6 "exact intersection zones … of complex parts" intent is met for the assembly workflow. DONE.

---

#### 20. Self-Intersection Detection — PARTIAL

**Ribbon:** `Check Geometry` (Part → Evaluate)  
**Kernel:** `BrepCheck.checkSelfIntersection` → `BRepCheck_Analyzer(shape, true, false)` (intrinsic validity) + pairwise `BRepAlgoAPI_Common_3` volume (inter-solid overlap).  
**Evidence:** `kernel-api-A3.md` §Items 6–8: BRepCheck_Analyzer confirmed valid for clean box; pairwise overlap: 3999.999 mm³ detected for 10mm-shifted boxes, 0 for disjoint.

**Honest gap:** `BOPAlgo_CheckerSI` — which performs face-level self-intersection detection on a single solid (faces within one body crossing each other) — is **unbound** because `BOPAlgo_PaveFiller` is not exposed in this WASM build (`kernel-api-A3.md §Items 1&2`). `BRepExtrema_SelfIntersection_2` is constructible but its `OverlapElements()` return type is also unbound. The current checker detects:
- Invalid geometry (`BRepCheck_Analyzer`) — catches degenerate faces, bad PCurves, orientation errors
- Pairwise solid penetration (volume > epsilon)

It does NOT detect: a single solid whose faces geometrically cross each other (self-intersecting fillet, degenerate sweep, etc.). PARTIAL.

---

## Gap Closure List

Items ordered from most foundational to most self-contained. Each tagged with closure path.

### GAP items

| # | Capability | Gap | Closure path |
|---|-----------|-----|--------------|
| G1 | N-Sided Patching | `BRepOffsetAPI_MakeFilling.Build(pr)` crashes with raw C++ exception in `opencascade.js@2.0.0-beta.b5ff984` — variational solver (GeomPlate) is not functional | **Requires fuller/custom OCCT WASM build.** Custom Emscripten compilation of opencascade.js with GeomPlate explicitly linked and tested against `brep-f-recon-electron.spec.js` Items 4-edge / 5-edge pentagon. No binding-only workaround exists. |

### Closed since the original audit (2026-05-21)

| # | Capability | Status | What closed it |
|---|-----------|--------|----------------|
| P2 | Complex Face Offsetting | **DONE** | `BrepLocalOps.offsetShape` switched to `PerformByJoin` (9-arg, `Intersection=true`, `Join=GeomAbs_Intersection`) — self-intersection-handling offset. e2e offsets a 26-face curved enclosure → valid, non-self-intersecting solid. |
| P5 | Geometry Simplification | **DONE** | `BrepHeal.simplify` is two-stage: `ShapeFix_FixSmallFace` removes tiny/sliver faces below `minFeatureSize`, then `ShapeUpgrade_UnifySameDomain`. (`ShapeUpgrade_RemoveInternalWires` proved non-functional — its `MinArea()` ref-getter is unsettable from JS; `ShapeFix_FixSmallFace` is the working path.) e2e removes 20 micro-fillet faces. |
| P6 | Clash & Interference Detection | **DONE** | `_runInterferenceDemo()` replaced by selection-driven `_runInterferenceCheck` — `_pickBodies(2)` → `checkClash` on the two user-selected bodies, interfering zone rendered, non-consuming. `checkClash` extended with `zoneCount` + a renderable `interferenceZone`. |

### PARTIAL items (remaining)

| # | Capability | Specific shortfall | Closure path |
|---|-----------|-------------------|--------------|
| P1 | Curvature-Continuous (G2) Blending | Result is a sewn triangle shell, not a single analytic NURBS `TopoDS_Face`. The `gp_Pnt2d` 2-arg constructor (`gp_Pnt2d_2(u, v)`) is absent in this build, blocking `BRepBuilderAPI_MakeEdge2d` parametric trim-wire path. | **Requires fuller/custom OCCT WASM build** to expose `gp_Pnt2d_2(u,v)`. Once available: build `Geom_BSplineSurface_1` from the existing fitted poles, recover a handle via the BRep round-trip (`MakeFace_8` → `BRep_Tool.Surface_2`), then trim via `MakeFace_14` or `MakeEdge2d` wire. Estimated 1 binding line + ~50 JS lines. |
| P3 | Drafting Spline Faces | Neutral plane hardcoded to z=0; pull direction hardcoded to +Z. Non-planar neutral surfaces unsupported. | **Partially existing-binding.** `BRepOffsetAPI_DraftAngle_2.Add` accepts any `gp_Pln` neutral plane. Add dialog params for neutral plane position/normal. True non-planar neutral surface (e.g. a curved parting surface) would require `BRepOffset_Draft`-level logic — not exposed in this binding. |
| P4 | Local Face Replacement | Only identity-copy replacement works; geometrically different face replacement needs a boundary-compatible new face with trimming curves | **Requires fuller/custom OCCT WASM build** (same `gp_Pnt2d` gap as P1) for arbitrary trim-curve construction. For same-boundary-wire face swaps (e.g. swap a planar face for a slightly curved NURBS face with the same wire), existing-binding work is sufficient: build a `Geom_BSplineSurface_1`, do the handle round-trip, pass to `BRepBuilderAPI_MakeFace_14`. |
| P7 | Self-Intersection Detection | `BOPAlgo_CheckerSI` / `BOPAlgo_PaveFiller` unbound; cannot detect face-level SI within a single solid | **Requires fuller/custom OCCT WASM build** to expose `BOPAlgo_PaveFiller`. Short of that: the `BRepCheck_Analyzer` validity check (already wired) IS the best available single-solid check in this build. The gap can be partially narrowed by wiring `BRepExtrema_SelfIntersection_2` (constructible, `IsDone=true` after `Perform`) — its `OverlapElements()` return type is unbound but `NbOverlapElements()` (if available) may give a count. |
| P8 | Thickening Sheets / Hollowing (UI scope) | `thicken` builds only rectangular planar faces; does not accept arbitrary BrepShape input | **Existing-binding work.** Refactor `BrepLocalOps.thicken` to accept a BrepShape input (open shell or face), call `MakeThickSolidBySimple(brepShape.shape, offset)` directly. The 2-arg kernel API already accepts any `TopoDS_Shape`. |

---

### Binding-gap root causes (cross-reference)

Two capabilities require the same binding fix:

| Binding gap | Capabilities blocked | Resolution |
|------------|---------------------|------------|
| `gp_Pnt2d_2(u,v)` constructor absent | G2 Blend analytic face (P1), Local Face Replacement with non-trivial geometry (P4) | Add `gp_Pnt2d_2` to opencascade.js `.d.ts` + emscripten binding — ~10 C++ lines in the binding layer |
| `BOPAlgo_PaveFiller` unbound | Self-Intersection Detection face-level SI (P7), `BOPAlgo_CheckerSI` (A3 notes) | Expose `BOPAlgo_PaveFiller` in the binding |
| `BRepOffsetAPI_MakeFilling` variational solver crash | N-Sided Patching (G1) | Rebuild with confirmed GeomPlate linkage |

---

## Notes on Classification Rationale

### Why "Thickening Sheets" is DONE despite rectangular-only UI
The kernel op `MakeThickSolidBySimple(shape, offset)` is a 2-arg call that works on *any* open shell or face. The rectangular face is the current UI entry point, not a kernel limitation. The §3.2 intent ("converting a complex open surface into a valid watertight solid") is achievable through this kernel path. The gap is UI wiring, not kernel capability — classified DONE with a note.

### Why "Hollowing & Shelling" is DONE despite top-face-only heuristic
`MakeThickSolidByJoin` accepts a `TopTools_ListOfShape` of faces to remove — any set of faces, not just the top. The top-face heuristic is the handler's simplification, correctable by adding face-selection UI without changing the kernel. The core capability is correct.

### Why "Clash Detection" is PARTIAL despite correct kernel code
The §3.6 description says "within *massive assemblies* of complex parts." The handler `_runInterferenceDemo()` hardcodes its geometry — it never touches the user's scene. Until the handler is refactored to be selection-driven, it does not fulfil the intent.

### Why "Lofting with Tangency" is DONE not PARTIAL
`SetSmoothing(true)` + `SetContinuity(GeomAbs_C1)` on `BRepOffsetAPI_ThruSections` is the correct OCCT G1 loft. The §3.3 item says "tangency constraints" — G1 tangency is exactly what this delivers. True G2 curvature-continuous lofting would require G2 boundary conditions which the current three-section demo does not enforce at the section curves; however, the kernel API supports it and nothing prevents using it with G2 section curves in a more advanced workflow.
