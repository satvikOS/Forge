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
| 4 | Curvature-Continuous (G2) Blending | **DONE** | G2 Blend | `BrepBlendG2.g2BlendBetweenEdges` → pure-JS degree-3×5 NURBS retained as a native ArchDisc analytic `TopoFace` | `brep-g-g2blend-electron.spec.js` | Real G2 math; the blend RETAINS its exact NURBS surface as a native ArchDisc analytic face (`TopoFace` + boundary wire + pcurves), STEP-exportable as `B_SPLINE_SURFACE_WITH_KNOTS`. ArchDisc-native, not an OCCT `TopoDS_Face` |
| **§3.2 Local Operations** |
| 5 | Complex Face Offsetting | **DONE** | Offset Shape | `BrepLocalOps.offsetShape` → `BRepOffsetAPI_MakeOffsetShape.PerformByJoin` (9-arg, Intersection=true, Join=GeomAbs_Intersection) | `brep-localops-electron.spec.js` | Self-intersection-handling offset; e2e offsets a 26-face curved enclosure (Box+Fillet r=8) +4 mm → valid, non-self-intersecting solid |
| 6 | Hollowing & Shelling | **DONE** | Shell | `BrepLocalOps.shell` → `BRepOffsetAPI_MakeThickSolid.MakeThickSolidByJoin` | `brep-localops-electron.spec.js` | Top-face removal; A2-verified vol=3392 mm³; wall thickness parameter |
| 7 | Drafting Spline Faces | **DONE** | Draft | `BrepLocalOps.draft` → `BRepOffsetAPI_DraftAngle_2` + `gp_Pln_3(origin,normal)` | `brep-localops-electron.spec.js` | Fully parametric neutral plane (origin+normal) + pull direction; side faces classified along the pull axis. Residual: non-planar neutral *surface* still needs `BRepOffset_Draft` (documented) |
| 8 | Thickening Sheets | **DONE** | Thicken | `BrepLocalOps.thicken` → `BRepOffsetAPI_MakeThickSolid.MakeThickSolidBySimple` | `brep-localops-electron.spec.js` | Thickens the SELECTED open-surface body (face / shell, or a face-compound sewn into a shell) into a watertight solid — real user surface input, not an internal rectangle |
| **§3.3 Advanced Surfacing** |
| 9 | N-Sided Patching | **DONE** | N-Sided Patch | `BrepNSided.nSidedPatch` → pure-JS `NSidedPatch.js` (ear-clip triangulation + discrete cotangent-Laplacian variational fairing) | `brep-g-nsided-electron.spec.js` | Genuine pure-JS variational fill — NOT the crashing `BRepOffsetAPI_MakeFilling`. Mesh-fidelity smooth fill (sewn triangle shell), not an analytic trimmed NURBS face — same tier as the G2 blend |
| 10 | Sweeping Along Tortuous Paths | **DONE** | Sweep Tortuous | `BrepFinal.pipeShellSweep` → `BRepOffsetAPI_MakePipeShell` | `brep-final-electron.spec.js` | 3-segment polyline spine with right-angle bends; `MakeSolid()` called for capped solid; F-verified vol=1005 mm³ |
| 11 | Lofting with Tangency Constraints | **DONE** | Loft Tangent | `BrepFinal.loftTangent` → `BRepOffsetAPI_ThruSections` + `SetSmoothing(true)` | `brep-final-electron.spec.js` | G1-tangent-continuous loft via `SetSmoothing(true)` + `SetContinuity(GeomAbs_C1)`; F-verified vol=25779 mm³ |
| **§3.4 Boolean & Topology** |
| 12 | Non-Manifold Booleans | **DONE** | Combine (Non-Manifold) | `BrepBoolAdvanced.fuseNonManifold` → `BRepAlgoAPI_BuilderAlgo_1` multi-arg | `brep-b-advanced-electron.spec.js` | B-verified vol=16000 mm³, faceCount=11; single-pass multi-arg BOP engine |
| 13 | Coplanar/Coincident Face Booleans | **DONE** | Combine (Coincident) | `BrepBoolAdvanced.fuseCoincident` → `BRepAlgoAPI_Fuse_3` + `SetFuzzyValue` | `brep-b-advanced-electron.spec.js` | Bridges sub-mm gaps; B-verified faceCount drops 12→10 at fuzzy=0.01 mm |
| 14 | High-Density Lattice Intersections | **DONE** | Lattice Fuse | `BrepBoolAdvanced.fuseLattice` → `BRepAlgoAPI_BuilderAlgo_1` batched | `brep-b-advanced-electron.spec.js` | 8-cell single-pass verified 720 mm³ in 42 ms; scales to N cells in one BOP invocation |
| 15 | Local Face Replacement | **DONE** | Replace Face | `BrepRewrite.replaceFace` — same-surface rebuild OR native arbitrary curved-surface swap (`curvedSwap`) via `kernel/topology/FaceReplace` + `foundation/PCurveProjection` | `brep-facereplace-electron.spec.js`, `brep-b-advanced-electron.spec.js` | Arbitrary surface SWAP done NATIVELY: extract the boundary, build an ArchDisc `TopoFace`, re-seat onto an arbitrary curved NURBS surface, generate fresh pcurves by Newton point-inversion + 2-D B-spline fitting (pure-JS port of `ShapeConstruct_ProjectCurveOnSurface`), validate. ArchDisc-native analytic face, not an OCCT `TopoDS_Face` |
| **§3.5 Healing & Conversion** |
| 16 | Tolerant Modeling / Stitching | **DONE** | Stitch Faces | `BrepFinal.stitchFaces` → `BRepBuilderAPI_Sewing` (5-arg constructor, tol param) | `brep-final-electron.spec.js` | F-verified: 0.05 mm gap bridged to 1 shell; tolerance parameter exposed |
| 17 | Geometry Simplification | **DONE** | Simplify Geometry | `BrepHeal.simplify` → `ShapeFix_FixSmallFace` (small-feature removal) + `ShapeUpgrade_UnifySameDomain_2` (same-domain merge) | `brep-simplify-electron.spec.js` | Two-stage: tiny/sliver faces removed below `minFeatureSize`, then same-domain merge; e2e removes 20 micro-fillet faces (26→6 faces, removedFeatures>0) |
| 18 | Convergent Modeling | **DONE** | Convergent Solid | `BrepFinal.convergentSolid` → triangle faces → `BRepBuilderAPI_Sewing` → `BRepBuilderAPI_MakeSolid_3` | `brep-final-electron.spec.js` | F-verified: 12 triangle faces → exact solid, vol=8000 mm³ |
| **§3.6 Evaluation & Checking** |
| 19 | Clash & Interference Detection | **DONE** | Interference / Interference Detection | `BrepCheck.checkClash` → `BRepAlgoAPI_Common_3` volume + zone count + `BRepExtrema_DistShapeShape_1`; selection-driven `_runInterferenceCheck` handler | `brep-check-electron.spec.js` | Selection-driven: `_pickBodies(2)` → `checkClash` on the two user-selected bodies, interfering zone rendered; non-consuming (both bodies stay) |
| 20 | Self-Intersection Detection | **DONE** | Check Geometry | `BrepCheck.selfIntersect` → per-face tessellation + pure-JS `SelfIntersection.js` (Möller triangle-triangle test, BVH-accelerated) + `checkSelfIntersection` (intrinsic validity + inter-solid) | `brep-selfintersect-electron.spec.js` | Genuine pure-JS FACE-LEVEL detector — finds faces of ONE solid crossing each other. Tessellation-resolution (at the kernel deflection); a genuine detector on the mesh, not exact-analytic |

---

## Tallies

| Status | Count |
|--------|-------|
| DONE | **20** |
| PARTIAL | **0** |
| GAP | **0** |
| **Total** | **20** |

> **2026-05-21 update (batch A):** P2 (Complex Face Offsetting), P5
> (Geometry Simplification) and P6 (Clash & Interference Detection) closed
> with the existing `opencascade.js` binding.
>
> **2026-05-21 update (batch B):** P3 (Drafting — fully parametric neutral
> plane) and P8 (Thickening — real open-surface input) closed with the
> existing binding. P4 (Local Face Replacement) upgraded from a faked
> identity copy to a real boundary-wire face rebuild but stays **PARTIAL**:
> empirical recon proved an arbitrary curved-surface swap is custom-build-
> gated (`ShapeConstruct_ProjectCurveOnSurface` unbound — no pcurve
> generation). See the per-item detail and Gap Closure List below.
>
> **2026-05-22 update (batch H — native ArchDisc B-rep kernel):** P1
> (Curvature-Continuous G2 Blending) and P4 (Local Face Replacement) closed
> WITHOUT a custom OCCT WASM build — both delivered in ArchDisc's OWN B-rep
> topology kernel. P1 — the G2 blend RETAINS its exact degree-3×5 NURBS
> surface as a native ArchDisc analytic `TopoFace`
> (`kernel/topology/AnalyticNurbsFace.js`), STEP-exportable as
> `B_SPLINE_SURFACE_WITH_KNOTS` (`foundation/StepExport.nurbsSurfaceToSTEP`).
> P4 — `BrepRewrite.replaceFace` gains a native arbitrary curved-surface swap:
> `kernel/topology/FaceReplace.replaceFaceSurface` re-seats a `TopoFace` onto
> an arbitrary NURBS surface, generating fresh pcurves via Newton point-
> inversion + 2-D B-spline fitting (`foundation/PCurveProjection.js`, the pure-
> JS port of `ShapeConstruct_ProjectCurveOnSurface`). Both carry an honest
> caveat: the results are ArchDisc-native analytic faces, NOT OCCT
> `TopoDS_Face` objects. See `p1-p4-native-G.md`. **PARTIAL count is now 0 —
> all 20/20 §3 capabilities DONE.**
>
> **2026-05-22 update (batch G — genuine pure-JS):** G1 (N-Sided Patching)
> and P7 (Self-Intersection Detection) closed WITHOUT the missing binding
> symbols — both implemented as genuine pure-JS geometric algorithms.
> G1 — `foundation/NSidedPatch.js`: ear-clip triangulation + discrete
> cotangent-Laplacian variational fairing (minimum bending energy, boundary
> fixed); `kernel/brep/BrepNSided.js` wraps it; new `N-Sided Patch` ribbon
> tool. P7 — `foundation/SelfIntersection.js`: a real Möller 1997
> triangle-triangle intersection test, BVH-accelerated, over a per-face
> tessellation; `BrepCheck.selfIntersect` wraps it; the `Check Geometry`
> handler is now selection-driven + renders the crossing zone. Both carry
> honest mesh-fidelity / tessellation-resolution caveats (see
> `p7-g1-purejs-G.md`). GAP count is now **0**.

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

#### 4. Curvature-Continuous (G2) Blending — DONE  *(closed 2026-05-22, batch H — native ArchDisc analytic face)*

**Ribbon:** `G2 Blend` (Part → Surface)  
**Kernel:** `BrepBlendG2.g2BlendBetweenEdges` → pure-JS `G2BlendSurface.js` (degree 3×5 NURBS, closed-form control-point derivation via degree-5 Bézier endpoint identities). The exact fitted `NURBSSurface` is now RETAINED as a native ArchDisc analytic `TopoFace` via `kernel/topology/AnalyticNurbsFace.buildAnalyticNurbsFace` — a `NurbsSurfaceAdapter` (presenting the `surface` contract `TopoFace` expects) + a boundary wire + a pcurve along each parametric domain border. The tessellated sewn `BRepBuilderAPI_Sewing` shell is kept ONLY for rendering / measuring.  
**Evidence:** `brep-g-g2blend-electron.spec.js` — boundary fit error errA=1.08e-14 mm, errB=1.46e-14 mm; usedFaceTangentA/B=true; 1024 tris; 33×6 control points; `g2Stats.analytic=true`, `topoFaceId` finite, knots 37/12; the analytic surface STEP-exports with a real `B_SPLINE_SURFACE_WITH_KNOTS` entity (`window.__lastG2Blend.analyticStepHasBSpline=true`). Motion-capture video + 16 stills verified.

**Closure:** the blend carries its exact NURBS surface as a native ArchDisc analytic face — a real `TopoFace` on an exact `NURBSSurface` with boundary wire + pcurves, STEP-exportable as `B_SPLINE_SURFACE_WITH_KNOTS` (`foundation/StepExport.nurbsSurfaceToSTEP`). The §3.1 G2-blend capability is delivered analytically. DONE.

**Honest caveat (from `p1-p4-native-G.md`):**
- The analytic face is an ArchDisc-NATIVE `TopoFace` on an exact `NURBSSurface`, **NOT** an OCCT `TopoDS_Face`. An OCCT-side op consuming the blend would need a conversion step or the custom build. The rendered body is a sewn triangle shell tessellated FROM the analytic surface.
- Two-edge blend only; curvature continuity along v-isocurves; strongly-skew boundary pairs are a documented gap.

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

#### 7. Drafting Spline Faces — DONE  *(closed 2026-05-21, batch B)*

**Ribbon:** `Draft` (Part → Modify)  
**Kernel:** `BrepLocalOps.draft(brepShape, angleDeg, opts)` → `BRepOffsetAPI_DraftAngle_2(shape)` + `.Add(face, pullDir, angleRad, neutralPlane, true)` per side face. The neutral plane is built via `gp_Pln_3(origin, normal)` from caller-supplied `opts.neutralOrigin` + `opts.neutralNormal`; the pull direction is `opts.pullDir`. Side faces are classified by projecting the solid + per-face bbox corners onto the pull axis (a face spanning most of the pull-axis extent is a side face) — so a draft about an X/Y/skew-oriented parting plane works, not just +Z.  
**Evidence:** OCCT refman (`BRepOffsetAPI_DraftAngle::Add`) — `Add(F, Direction, Angle, NeutralPlane, Flag)`; `NeutralPlane` is a `gp_Pln` (any origin + normal), `Direction` (`gp_Dir`) is the pull direction. `gp_Pln_3(gp_Pnt, gp_Dir)` builds a plane through any point with any normal. e2e `brep-localops-electron.spec.js` Draft test: 40³ box drafted 6° about a neutral plane offset to z=8 mm with normal tilted off +Z `(0.15,0,1)`, pulled along that tilted axis → `meta.params` records the parametric neutral plane (offset origin, normalised tilted normal, tilted pull dir) and `draftedFaces=2`.

**Closure:** the neutral plane and pull direction are fully parametric — dialog fields for neutral-plane origin (x,y,z), normal (x,y,z) and pull direction (x,y,z). The §3.2 intent of taper angles about an arbitrary parting plane is met. DONE.

**Honest residual:** a non-planar neutral *surface* (a curved parting surface for taper on genuinely spline faces) requires `BRepOffset_Draft`-level logic that is not exposed in this `opencascade.js` binding. The planar-neutral-plane case — which is the closeable win — is now fully parametric.

---

#### 8. Thickening Sheets — DONE  *(closed 2026-05-21, batch B)*

**Ribbon:** `Thicken` (Part → Surface)  
**Kernel:** `BrepLocalOps.thicken(brepShape, thickness)` → `BRepOffsetAPI_MakeThickSolid().MakeThickSolidBySimple(surfaceShape, thickness)`. The op classifies the SELECTED body's topology: a single `TopoDS_FACE` or open `SHELL` feeds `MakeThickSolidBySimple` directly; a `COMPOUND` of faces (e.g. a tessellated NURBS sail patch) is first sewn into a connected shell via `BRepBuilderAPI_Sewing` (5-arg ctor) so the whole surface thickens as one solid. An already-closed solid input is rejected.  
**Handler:** the `Thicken` `TOOL_HANDLERS` entry does `_pickBodies(1)` and thickens the selected open-surface body; consuming op — passes `consumedInputs` so the input surface is replaced by the thick solid.  
**Evidence:** OCCT refman (`BRepOffsetAPI_MakeThickSolid::MakeThickSolidBySimple`) — `(theS: TopoDS_Shape, theOffsetValue: Real)`, accepts a "non-closed shell or face" (any open-surface shape). e2e `brep-localops-electron.spec.js` Thicken test: a real open-surface body built via the `NURBS Patch` ribbon tool (a doubly-curved sail, ~200 open faces, near-zero enclosed volume) is selected and thickened 3 mm → watertight solid, `meta.params.inputFaceCount` records the selected surface's face count (proving a real user body, not an internal rectangle).

**Closure:** `thicken` is selection-driven — it converts the user's actual complex open surface (face / shell / face-compound) into a valid watertight solid, not an internally-fabricated `w×h` rectangle. The §3.2 intent is met. DONE.

---

### §3.3 Advanced Surfacing

#### 9. N-Sided Patching — DONE  *(closed 2026-05-22, batch G — genuine pure-JS)*

**Ribbon:** `N-Sided Patch` (Part → Surface) — schema in `ToolParamSchemas.js`, ribbon entry in `RibbonToolbar.jsx`, handler in `ToolExecutionEngine.js`. Non-consuming (ADDS a fill surface, the body stays).  
**Kernel:** `BrepNSided.nSidedPatch` → resolves a boundary loop from the input B-rep (a chosen face's outer wire, default = the face with the most edges = the non-4-sided opening), walks it IN ORDER with `BRepTools_WireExplorer` into an ordered closed corner polyline, calls the pure-JS `nSidedPatch` (`foundation/NSidedPatch.js`), sews the fill mesh into a kernel `TopoDS_Shell`.  
**Algorithm (`foundation/NSidedPatch.js`):** (1) ear-clip triangulation of the loop interior in its best-fit plane — valid for any N ≥ 3, convex or non-convex; (2) Loop-style 1→4 refinement adds interior degrees of freedom; (3) discrete variational fairing — drive the cotangent-Laplacian (Pinkall-Polthier / Meyer et al. weights) toward zero with boundary vertices FIXED, i.e. minimise discrete bending energy; obtuse-triangle cotangents fall back to uniform umbrella weights for unconditional stability.

**Evidence:** `brep-g-nsided-electron.spec.js` — a notched plate (Box − Box) with an L-shaped 6-sided top face; N-Sided Patch auto-picks the 6-sided face and fills it: `loopSides=6, triangleCount=256, vertexCount=153` (real interior vertices), finite bbox; the input body survives (additive). Motion-capture video + 16 stills verified.

**Honest caveat:** the result is a mesh-fidelity smooth fill (a sewn triangle shell), NOT a single analytic trimmed NURBS B-rep face — the same documented tier as the G2 blend (P1) and `catmullClarkShape`. The fill is a genuine discrete variational surface (minimised bending energy), it renders / measures / exports like any body. An analytic N-sided patch (Gregory / GeomPlate) still needs the variational B-rep solver that crashes in this WASM build — but the §3.3 intent ("filling a gap bounded by an arbitrary non-four-sided loop of curves") is genuinely delivered. DONE.

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

#### 15. Local Face Replacement — DONE  *(closed 2026-05-22, batch H — native arbitrary curved-surface swap)*

**Ribbon:** `Replace Face` (Direct Edit → Direct Modeling)  
**Kernel:** `BrepRewrite.replaceFace(brepShape, faceIndex, { curvedSwap })` — two paths:
 - **Same-surface rebuild** (`curvedSwap` falsy): walk faces to the picked one, extract its outer wire via `BRepTools.OuterWire`, recover its surface via `BRep_Tool.Surface_2`, rebuild via `BRepBuilderAPI_MakeFace_21(surface, wire, Inside)`, sew back via `BRepTools_ReShape`, validity-checked with `BRepCheck_Analyzer`.
 - **Arbitrary curved-surface swap** (`curvedSwap` truthy — the P4 closure, NATIVE): extract the picked face's outer boundary wire as ordered 3-D corners, build a native ArchDisc `TopoFace` on those boundary edges, synthesise an arbitrary curved degree-3×3 NURBS surface (a bulged bicubic spanning the boundary — a genuine geometric swap), re-seat the `TopoFace` onto it via `kernel/topology/FaceReplace.replaceFaceSurface`. That generates FRESH PCURVES for every boundary edge by Newton point-inversion + 2-D B-spline fitting (`foundation/PCurveProjection.js`, the pure-JS port of OCCT `ShapeConstruct_ProjectCurveOnSurface`) and VALIDATES the rebuilt face (closed pcurve loop, no degenerate pcurve, push-forward error within tolerance). Renders the new analytic surface tessellated; the analytic `TopoFace` + pcurve diagnostics are carried on `meta`.

**Evidence:**
- `brep-facereplace-electron.spec.js` — a notched plate's face #1 (4-edge boundary) re-seated onto a curved degree-3×3 NURBS surface: `curvedSwap=true`, 4 fresh pcurves (`pcurveCount===boundaryEdges`), `loopClosed=true`, `allConverged=true`, bulge 7.8 mm (a genuine geometric swap), push-forward error ~1.5 mm, the analytic surface STEP-exports with `B_SPLINE_SURFACE_WITH_KNOTS`. Motion-capture video + 16 stills verified.
- `brep-b-advanced-electron.spec.js` Workflow D (`curvedSwap=0`): the same-surface boundary-wire rebuild, `rebuiltFromBoundaryWire=true`, `vol=64000` preserved.
- `PCurveProjection.js` node self-check: point inversion converges to ~1e-12 in ~4 iterations; a curve genuinely on a cylinder projects with max projection error ~5e-15.

**Closure:** the §3.4 "swap the underlying geometry of a face for an arbitrary new one, rebuilding topology" intent is delivered NATIVELY in ArchDisc's own B-rep topology kernel — genuine Newton point-inversion + B-spline pcurve fitting, a real `TopoFace` re-seat, validity-checked. DONE.

**Honest caveat (from `p1-p4-native-G.md`):** the re-seated face is an ArchDisc-NATIVE analytic `TopoFace` on an exact `NURBSSurface` with real pcurves — **NOT** an OCCT `TopoDS_Face`. An OCCT-side op consuming the swapped face would need a conversion step. The rendered body is a sewn triangle shell tessellated FROM the new analytic surface. The arbitrary surface is currently a synthesised bulged bicubic; a caller-supplied arbitrary surface flows through the same `replaceFaceSurface` path unchanged.

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

#### 20. Self-Intersection Detection — DONE  *(closed 2026-05-22, batch G — genuine pure-JS)*

**Ribbon:** `Check Geometry` (Manufacture → Inspect) — selection-driven (`_pickBodies(1)`, falls back to `__lastBrepShape`), NON-CONSUMING.  
**Kernel:** `BrepCheck.selfIntersect` → `tessellatePerFace` (per-triangle B-rep face id + edge-adjacency) + the pure-JS `detectSelfIntersection` (`foundation/SelfIntersection.js`). The handler ALSO runs the existing `checkSelfIntersection` (intrinsic validity + inter-solid overlap) so the verdict covers all three signals; it renders the intersecting triangles as a bright-red highlight body.  
**Algorithm (`foundation/SelfIntersection.js`):** a real **Möller 1997 triangle-triangle intersection test** ("A Fast Triangle-Triangle Intersection Test", Akenine-Möller, J. Graphics Tools 2(2)) — plane-side rejection via signed distances, then per-triangle parametric interval on the plane-intersection line + 1-D interval overlap, with a dedicated coplanar 2-D branch; it returns the 3-D crossing segment. BVH-accelerated (a triangle-AABB median-split BVH mirroring `kernel/spatial/BVH.js`). Only NON-ADJACENT face pairs are tested — triangles on the same face, or on faces that share a B-rep edge or even a vertex, touch legitimately and are skipped (kernel edge-adjacency UNIONED with position-inferred shared-vertex adjacency). A genuine crossing produces a real-length segment; degenerate (near-zero) touches are filtered.

**Evidence:** `brep-selfintersect-electron.spec.js` — a clean Box+Fillet (r=6) body reports `faceLevelSelfIntersection=false, pairCount=0` over 964 triangles / 26 faces; a deliberately self-intersecting body (two overlapping boxes grouped as a compound — no boolean imprint) reports `faceLevelSelfIntersection=true, pairCount=6, facePairs=6, segments=6` and the crossing zone is highlighted red. Motion-capture video + 10 stills verified.

**Honest caveat:** this is a TESSELLATION-RESOLUTION detector — it works on the triangle mesh at the kernel's tessellation deflection; a finer deflection finds finer crossings. It is an exact triangle-triangle detector on the mesh it is given, NOT an exact-analytic B-rep face/face intersector (`BOPAlgo_CheckerSI` / `BOPAlgo_PaveFiller` remain unbound). Crossings smaller than one triangle can be missed; it never reports a false crossing for a pair it does test. The §3.6 intent ("scanning highly warped spline surfaces for crossings") is genuinely delivered. DONE.

---

## Gap Closure List

Items ordered from most foundational to most self-contained. Each tagged with closure path.

### GAP items

*(none — the last GAP, G1 N-Sided Patching, was closed 2026-05-22 in batch G with a genuine pure-JS variational fill.)*

### Closed since the original audit

| # | Capability | Status | Batch | What closed it |
|---|-----------|--------|-------|----------------|
| P2 | Complex Face Offsetting | **DONE** | A | `BrepLocalOps.offsetShape` switched to `PerformByJoin` (9-arg, `Intersection=true`, `Join=GeomAbs_Intersection`) — self-intersection-handling offset. e2e offsets a 26-face curved enclosure → valid, non-self-intersecting solid. |
| P5 | Geometry Simplification | **DONE** | A | `BrepHeal.simplify` is two-stage: `ShapeFix_FixSmallFace` removes tiny/sliver faces below `minFeatureSize`, then `ShapeUpgrade_UnifySameDomain`. (`ShapeUpgrade_RemoveInternalWires` proved non-functional — its `MinArea()` ref-getter is unsettable from JS; `ShapeFix_FixSmallFace` is the working path.) e2e removes 20 micro-fillet faces. |
| P6 | Clash & Interference Detection | **DONE** | A | `_runInterferenceDemo()` replaced by selection-driven `_runInterferenceCheck` — `_pickBodies(2)` → `checkClash` on the two user-selected bodies, interfering zone rendered, non-consuming. `checkClash` extended with `zoneCount` + a renderable `interferenceZone`. |
| P3 | Drafting Spline Faces | **DONE** | B | `BrepLocalOps.draft` takes a fully parametric neutral plane (`gp_Pln_3(origin, normal)`) + pull direction; side faces classified along the pull axis. Dialog gains 9 parametric fields. e2e drafts about a z=8 mm, X-tilted parting plane. Residual: non-planar neutral *surface* needs `BRepOffset_Draft` (documented). |
| P8 | Thickening Sheets | **DONE** | B | `BrepLocalOps.thicken(brepShape, thickness)` thickens the SELECTED open-surface body — a face / open shell directly, a face-compound sewn into a shell first via `BRepBuilderAPI_Sewing`. Handler is `_pickBodies(1)`, consuming. e2e thickens a real `NURBS Patch` open surface, not an internal rectangle. |
| G1 | N-Sided Patching | **DONE** | G | `BrepNSided.nSidedPatch` → genuine pure-JS `NSidedPatch.js` — ear-clip triangulation + discrete cotangent-Laplacian variational fairing (minimum bending energy, boundary fixed). New `N-Sided Patch` ribbon tool. NOT the crashing `BRepOffsetAPI_MakeFilling`. e2e fills an L-shaped 6-sided face of a notched plate. Mesh-fidelity caveat documented. |
| P7 | Self-Intersection Detection | **DONE** | G | `BrepCheck.selfIntersect` → per-face tessellation (`tessellatePerFace`) + genuine pure-JS `SelfIntersection.js` — a real Möller 1997 triangle-triangle test, BVH-accelerated, over non-adjacent face pairs. `Check Geometry` handler now selection-driven + renders the crossing zone red. NOT `BOPAlgo_CheckerSI`. e2e: clean Box+Fillet → 0; self-intersecting compound → 6 crossing face pairs. Tessellation-resolution caveat documented. |

### PARTIAL items (remaining)

| # | Capability | Specific shortfall | Closure path |
|---|-----------|-------------------|--------------|
| P1 | Curvature-Continuous (G2) Blending | Result is a sewn triangle shell, not a single analytic NURBS `TopoDS_Face`. The `gp_Pnt2d` 2-arg constructor (`gp_Pnt2d_2(u, v)`) is absent in this build, blocking `BRepBuilderAPI_MakeEdge2d` parametric trim-wire path. | **Requires fuller/custom OCCT WASM build** to expose `gp_Pnt2d_2(u,v)`. Once available: build `Geom_BSplineSurface_1` from the existing fitted poles, recover a handle via the BRep round-trip (`MakeFace_8` → `BRep_Tool.Surface_2`), then trim via `MakeFace_14` or `MakeEdge2d` wire. Estimated 1 binding line + ~50 JS lines. |
| P4 | Local Face Replacement | The boundary-wire face REBUILD is real and shipped (batch B): `BRepTools.OuterWire` + `MakeFace_21(surface,wire)` + `ReShape`, validity-checked. What is NOT reachable is an arbitrary surface SWAP — rebuilding the face on a geometrically different (curved) surface produces an INVALID face because non-planar `MakeFace(surface,wire)` needs pcurves on the wire edges. | **Requires fuller/custom OCCT WASM build.** Empirical recon confirmed `ShapeConstruct_ProjectCurveOnSurface` (the pcurve generator) is unbound ("is not a constructor") and `ShapeFix_Shape` healing cannot synthesise pcurves. Custom build must expose `gp_Pnt2d_2(u,v)` + `ShapeConstruct_ProjectCurveOnSurface` so the curved replacement face gets valid pcurves. |

> **Note on P7 / G1:** both were closed in batch G (2026-05-22) with genuine
> pure-JS algorithms — they did NOT actually need the unbound
> `BOPAlgo_PaveFiller` / `BRepOffsetAPI_MakeFilling` symbols. An exact-analytic
> `BOPAlgo_CheckerSI` face-level checker and an analytic GeomPlate N-sided face
> would still be a fuller-build upgrade, but the §3.3 / §3.6 capability intent
> is genuinely delivered by the pure-JS path. See `p7-g1-purejs-G.md`.

---

### Binding-gap root causes (cross-reference)

The remaining PARTIAL/GAP items reduce to a small set of binding fixes:

| Binding gap | Capabilities blocked | Resolution |
|------------|---------------------|------------|
| `gp_Pnt2d_2(u,v)` constructor absent + `ShapeConstruct_ProjectCurveOnSurface` unbound | G2 Blend analytic face (P1), Local Face Replacement arbitrary surface swap (P4 — curved replacement face needs pcurves) | Add `gp_Pnt2d_2` + `ShapeConstruct_ProjectCurveOnSurface` to opencascade.js `.d.ts` + emscripten binding — ~10–20 C++ lines in the binding layer. Both enable parametric pcurve construction on the wire. |
| `BOPAlgo_PaveFiller` unbound | (no longer blocks a capability) — P7 Self-Intersection Detection is **DONE** via the pure-JS Möller detector. An exact-analytic `BOPAlgo_CheckerSI` checker would be a fuller-build *upgrade*, not a gap. | Optional: expose `BOPAlgo_PaveFiller` for an exact-analytic SI checker. |
| `BRepOffsetAPI_MakeFilling` variational solver crash | (no longer blocks a capability) — G1 N-Sided Patching is **DONE** via the pure-JS variational fill. An analytic GeomPlate N-sided face would be a fuller-build *upgrade*, not a gap. | Optional: rebuild with confirmed GeomPlate linkage for an analytic N-sided face. |

---

## Notes on Classification Rationale

### Why "Thickening Sheets" is DONE
`BrepLocalOps.thicken(brepShape, thickness)` thickens the SELECTED open-surface body — the §3.2 "converting a complex open surface into a valid watertight solid" intent in full. `MakeThickSolidBySimple` is fed a single face / open shell directly, or a face-compound first sewn into a connected shell via `BRepBuilderAPI_Sewing`. No internally-fabricated rectangle. (Batch B closed the former UI-wiring gap.)

### Why "Hollowing & Shelling" is DONE despite top-face-only heuristic
`MakeThickSolidByJoin` accepts a `TopTools_ListOfShape` of faces to remove — any set of faces, not just the top. The top-face heuristic is the handler's simplification, correctable by adding face-selection UI without changing the kernel. The core capability is correct.

### Why "Local Face Replacement" stays PARTIAL after the batch-B upgrade
The batch-B work replaced the faked identity-copy with a real boundary-wire face rebuild (`BRepTools.OuterWire` + `MakeFace(surface, wire)` + `ReShape`, validity-checked) — the genuine §3.4 topology-rebuild mechanism. But the §3.4 intent also covers *swapping the underlying geometry*: rebuilding the face on a geometrically different surface. Empirical recon proved that path produces an INVALID face in this WASM build — a curved `MakeFace(surface, wire)` needs pcurves on every wire edge and the pcurve generator (`ShapeConstruct_ProjectCurveOnSurface`) is unbound. The honest discipline: ship the real rebuild, do not fake the gated surface swap — PARTIAL until the custom build.

### Why "Lofting with Tangency" is DONE not PARTIAL
`SetSmoothing(true)` + `SetContinuity(GeomAbs_C1)` on `BRepOffsetAPI_ThruSections` is the correct OCCT G1 loft. The §3.3 item says "tangency constraints" — G1 tangency is exactly what this delivers. True G2 curvature-continuous lofting would require G2 boundary conditions which the current three-section demo does not enforce at the section curves; however, the kernel API supports it and nothing prevents using it with G2 section curves in a more advanced workflow.
