# ArchDisc Kernel Audit — 2026-05-10

Function-by-function honest assessment of every kernel module. Written
after archiving the demo projects and confronting the gap between what
the demos claimed and what the kernel actually does.

Three columns:

- **Implementation** — does the code in this module actually do the thing
  its docstring claims, end-to-end?
- **Used by demos?** — was it actually wired into any of the V6 / GE9X /
  example-tier projects?
- **Foundation status** — is it strong enough to build on, or does it
  need replacement / completion?

## TL;DR

- The demos used **only** `PrimitiveBuilder` (4 shapes) + `Assembly` +
  `AssemblyBridge` + `StudioLighting`. **Every other kernel module went
  unexercised.**
- `ExtrudeFeature`, `RevolveFeature`, `LoftSweep`, `FilletChamfer`,
  `BooleanEngine`, `SketchSolver`, `MateSolver` all contain real code,
  but it was never tested through real workflows. The audit below is
  about whether that code is sound enough to build on.
- `FEAEngine`, `CFDEngine`, `GDTEngine`, `STEPExporter`,
  `ProductionDrawing`, `ProductionPackage`, `TopologyOptimizer` are
  **visualization / template generators**, not solvers. Outputs are not
  trustworthy as engineering data.

## features/

### `PrimitiveBuilder.js` — 4 shapes
- `box(w, h, d, center)` — Builds 8-vertex 12-edge 6-face B-Rep box.
  **Implementation: solid.** Used in every demo.
- `cylinder(radius, height, segments)` — Tessellated cylinder. Sound.
- `cylinderShell(rOuter, rInner, height, segments)` — Hollow cylinder.
  Sound.
- `torus(major, minor, segs1, segs2)` — Tessellated torus. Sound.
- `sphere(radius, segments)` — Tessellated sphere. Sound but only
  approximate.
- `cone(rBottom, rTop, height, segments)` — Tessellated cone. Sound.
- **Foundation status: KEEP.** This is the kernel's actual primary
  output. Every primitive is a closed polygonal B-Rep solid. Good
  enough to feed into manifold-3d once we replace the boolean backend.

### `BooleanEngine.js` — CSG via BSP
- `union(a, b)`, `subtract(a, b)`, `intersect(a, b)` — BSP tree CSG.
  **Implementation: present but fragile.** Known failure mode:
  ~30 sequential subtractions on one envelope produce empty geometry.
  This is what forced the V6 block into 53-piece visual workaround.
- `_buildBSP`, `_clipPolygons`, `_classifyVertex` — internal BSP work.
- **Foundation status: REPLACE.** The right fix is to delegate to
  `manifold-3d` (MIT, robust, used by Onshape / OnPoint / Slic3r).
  Keep current code as a fallback path only.

### `ExtrudeFeature.js` — Profile → solid
- `extrude(profilePoints, direction, distance, opts)` — Generates side
  walls + caps from a closed profile. Supports taper, mid-plane,
  reversed. **Implementation: looks sound** — never exercised by demos.
- **Foundation status: TEST.** Need to wire to `Sketch2D` profiles and
  prove round-trip → manifold solid → STL → reimport.

### `RevolveFeature.js` — Profile → revolved solid
- `revolve(profilePoints, axis, point, startAngle, endAngle, segments)`.
  **Implementation: looks sound** — never tested.
- **Foundation status: TEST.**

### `LoftSweep.js` — Multi-profile + path operations
- `loft(profiles, opts)` — Loft N profiles.
- `sweep(profile, path, opts)` — Sweep profile along path.
- **Implementation: looks sound for simple cases** — untested.
- **Foundation status: TEST.** Most likely needs work for tangent
  continuity between profiles and twist control.

### `FilletChamfer.js` — Edge rounding
- `fillet(solid, edgeIds, radius, segments)` — Replace sharp edges with
  arcs.
- `chamfer(solid, edgeIds, distance)` — Replace with bevel.
- **Implementation: present but topology-fragile.** Replaces edges
  vertex-by-vertex which won't preserve adjacent face validity in
  general cases. Probably works on cube edges; will fail on cylindrical
  fillets.
- **Foundation status: REPLACE.** Once manifold-3d is in, fillets via
  Minkowski sum (offset + intersect) will be more robust.

### `FeatureTree.js`
- Feature history container. Operation log.
- **Implementation: scaffold.** No re-execution / rollback / suppress.
- **Foundation status: COMPLETE.** Real parametric history needs
  feature-graph re-evaluation when a parent changes. That's M9+ work,
  not P0.

### `DirectEdit.js`
- Push-pull style direct edit operations.
- **Foundation status: DEFER.** Direct-edit on top of a parametric
  kernel is end-stage; needs working features first.

## sketch/

### `SketchSolver.js` — 2D constraint solver
- `SketchPoint`, `SketchLine`, `SketchCircle`, `SketchArc` entity classes.
- `Constraint` types: coincident, parallel, perpendicular, tangent,
  equal, horizontal, vertical, distance, angle, radius, fixed,
  symmetric, midpoint.
- `solve()` — Newton-Raphson on constraint residuals.
- **Implementation: present, looks correct in structure.** Untested in
  practice. Convergence on under/over-constrained sketches is the
  main risk.
- **Foundation status: TEST + KEEP if convergent, else replace with
  solvespace WASM.** This is M2.

### `InteractiveSketch.js`
- UI for live sketching with pen/stylus.
- **Foundation status: KEEP** — the UX layer is fine; rebuild on top of
  validated solver.

## assembly/

### `Assembly.js`
- Container for parts + mates. Hierarchy. `addPart`, `partCount`,
  `boundingBox`.
- **Implementation: solid.** Used by every demo.
- **Foundation status: KEEP.**

### `MateSolver.js` — 6-DOF iterative solver
- Mate types: coincident, distance, concentric, parallel, perpendicular,
  angle, lock.
- `solve(assembly, opts)` — iterates with damped corrections until
  residuals converge.
- **Implementation: present, looks structurally correct.** Untested
  end-to-end on real mates. The residual functions for concentric +
  parallel + angle need verification.
- **Foundation status: TEST + COMPLETE.** This is M7.

## simulation/

### `FEAEngine.js` — "Linear static FEA"
- `linearStatic(solid, opts)` — Generates "tetrahedral mesh" via box
  approximation, then applies **beam-bending formulas** (σ = M·c/I) to
  the longest bbox dimension.
- `_generateMesh` — Stub that returns approx mesh stats, not real
  elements.
- `fatigueAnalysis` — Basquin equation with hardcoded endurance limit
  = 0.5 × ultimate.
- `modalAnalysis` — Approximate first natural frequency from mass +
  stiffness estimates.
- **Implementation: NOT a real FEA solver.** Outputs are
  beam-approximation magnitudes. The "3.84 MPa, SF=71.9" type results
  in the demos came from this beam math, not from a stiffness matrix
  solve.
- **Foundation status: REPLACE.** Either integrate CalculiX (GPL, real
  Nastran-compat solver) via WASM or remove the misleading API.
  Until then, FEAEngine should be renamed to `BeamApprox` so callers
  understand what they get.

### `CFDEngine.js`
- Self-documents as **"simplified potential flow + drag/pressure
  estimates ... realistic-magnitude estimates for visualization
  purposes"**.
- Uses Darcy-Weisbach for pressure drop, drag-coefficient lookup tables
  for force estimation.
- **Implementation: handbook formulas, not Navier-Stokes.**
- **Foundation status: KEEP for what it is, RELABEL.** This is fine as
  a back-of-envelope analysis tool. It is not CFD. Rename to
  `FlowEstimator`.

### `FEAVisualizer.js`
- Colorizes a mesh by stress field. Colormap rendering.
- **Implementation: pure visualization** — colors come from whatever
  field you pass in.
- **Foundation status: KEEP for viz.** Rename: this is `MeshColorizer`.

### `TopologyOptimizer.js`
- "SIMP-like" density-based topology optimization.
- **Foundation status: AUDIT.** SIMP needs an FEM solver underneath; if
  this lacks one, it's a placeholder.

## standards/

### `GDTEngine.js`
- Generates GD&T frame metadata + SVG rendering. Tolerance lookup tables
  per ASME Y14.5-2018.
- **Implementation: GENERATOR, not analyzer.** Does not compute
  tolerance stacks. Does not validate fits. Does not derive datum
  reference frames from geometry.
- **Foundation status: KEEP as renderer, COMPLETE as analyzer.** Real
  tolerance-stack solver is multiple weeks of work.

### `BearingLibrary.js` / `FastenerLibrary.js`
- Catalog dimensions for ANSI/ISO/DIN bearings + fasteners.
- **Foundation status: KEEP.** Useful reference data; not a solver.

## export/

### `STEPExporter.js`
- ISO 10303-21 file writer. Self-documents as "simplified".
- Writes `MANIFOLD_SOLID_BREP` with `CLOSED_SHELL` + `ADVANCED_FACE`s.
- **Implementation: writes syntactically-valid STEP**, but only emits
  planar/cylindrical surfaces. NURBS surfaces not supported.
- **Foundation status: KEEP for primitive output, EXTEND for NURBS** —
  but NURBS is M9+ work.

### `ExportEngine.js` / `ProjectExporter.js`
- ZIP packaging, JSON serialization, screenshot capture.
- **Foundation status: KEEP.** Solid utility code.

### `HTMLReportBuilder.js`
- Generates HTML reports from analysis results.
- **Foundation status: KEEP.** Pure templating.

## drawing/

### `DrawingEngine.js`
- 2D drawing via SVG. Supports ortho views, dimensions, leaders, hatch.
- **Implementation: present.** **Critical gap: uses provided face
  outlines rather than performing true projection-from-3D with
  hidden-line removal.** That is the difference between a real drawing
  engine and a 2D editor.
- **Foundation status: COMPLETE.** Need:
  1. 3D → 2D orthographic projection
  2. Hidden-line removal (BSP-based or face-by-face occlusion)
  3. Section view (clip plane + hatch fill)
  4. Dimension auto-placement to avoid overlap

### `Annotations.js`
- Leader / dimension / note SVG renderer.
- **Foundation status: KEEP.**

## production/

### `ProductionDrawing.js` / `ProductionPackage.js` / `AssemblyDrawing.js`
- Generators that emit SVG drawings + JSON manifests.
- **Implementation: TEMPLATES.** Output is what you tell them to
  output. They do not derive from geometry.
- **Foundation status: KEEP as templates** but disconnect them from any
  claim of "Part-21 / AS9102 compliance" — those compliances require
  actual GD&T computed from geometry.

### `FMEA.js` / `MaterialCert.js` / `InspectionReport.js`
- JSON document templates per industry standards.
- **Foundation status: KEEP as templates.** They cannot validate
  themselves; they require a human or a real solver to fill them in
  meaningfully.

### `BOM.js`
- Walks an Assembly to produce a part list + roll-up mass.
- **Implementation: SOLID.** This is the one thing in `production/`
  that is fully derived from geometry.
- **Foundation status: KEEP.**

## bridge/ (Three.js integration)

### `AssemblyBridge.js`, `ThreeJSBridge.js`, `FocusController.js`
- Convert kernel B-Rep to Three.js InstancedMesh / BufferGeometry.
- Camera focus, picking via BVH.
- **Implementation: SOLID.** This is the kernel's strongest area.
- **Foundation status: KEEP.**

## rendering/

### `StudioLighting.js`, `MarketingCutaway.js`, `PostFX.js`,
`SceneComposer.js`, `CutawayRenderer.js`, `AnnotationOverlay.js`
- Three.js rendering presets, clip planes, HDR pipelines.
- **Foundation status: KEEP.** Excellent quality rendering layer.

## math/

### `Vec3.js`, `Mat4.js`, `Plane.js`, `BBox3.js`, `Curve.js`, `Surface.js`
- Linear algebra + analytic geometry primitives. Surface types:
  Planar, Cylindrical, Spherical, Conical, Toroidal.
- **Implementation: SOLID.** Foundational.
- **Gap:** No NURBS / B-spline curves or surfaces. Needed for any
  freeform / curvature-continuous geometry.
- **Foundation status: KEEP, EXTEND with NURBS at M9+.**

## topology/

### `TopoVertex.js` ... `TopoSolid.js`
- B-Rep topology hierarchy. Vertex → Edge → Loop → Face → Shell → Solid.
- **Implementation: SOLID.** Standard B-Rep structure.
- **Foundation status: KEEP.**

## thermodynamics/

### `OttoCycle.js`, `BraytonCycle.js`
- Engineering cycle calculations with real thermodynamic relations
  (compression, combustion, expansion stages).
- Emissions correlations from published correlations.
- **Implementation: REAL engineering math.** This is not a solver in
  the geometric sense; it's a thermodynamics calculator. Numbers are
  defensible.
- **Foundation status: KEEP.** Useful as reference calculators; do not
  oversell as physics simulation.

## airfoil/, turbomachinery/, acoustics/

- `NACA.js` — Real NACA 4-digit airfoil math.
- `TurbomachineryBlade.js`, `HollowBlade.js` — Blade geometry generators.
- `NoisePrediction.js` — Empirical noise correlations.
- **Implementation: real math, narrow scope.**
- **Foundation status: KEEP for use cases that match.**

## manufacturing/

### `Slicer.js`
- 3D-print slicer (layer extraction). Plane-mesh intersections.
- **Foundation status: AUDIT for manifold-input correctness.**

### `GCodeGenerator.js`, `CAMVisualizer.js`, `ToolLibrary.js`,
`StockSimulator.js`, `MoldFlow.js`
- CAM-style toolpath generators. **Templates that don't derive from
  geometry** (the "8.8 min, 392-line G-code" was hand-coded path
  templates filled with parameters).
- **Foundation status: KEEP as templates** but disconnect from
  geometry-aware claims until real toolpath computation exists.

## materials/

### `EngineMaterials.js`
- Three.js PBR material presets (steel, aluminum, plastic, carbon
  fiber, etc.) for rendering.
- **Foundation status: KEEP for rendering.** Not a material database
  in the engineering sense.

## spatial/, lod/, tessellation/

### `BVH.js`, `LODManager.js`, `Tessellator.js`,
`SubdivisionSurface.js`, `PixelManager.js`
- Spatial acceleration + LOD + mesh refinement. Catmull-Clark
  subdivision (currently disabled per CLAUDE.md note).
- **Foundation status: KEEP.** Useful infrastructure.

## pdm/, registry/, recording/, agents/, realworld/, maintenance/

### `PartIDRegistry.js`, `PartNumbering.js`, `VersionControl.js`,
`CostingEngine.js`, `Sustainability.js`, `InteractionRecorder.js`,
`AgentBridge.js`, `ComplianceMatrix.js`, `RealWorldTestRunner.js`,
`TestScenarios.js`, `MaintenanceSchedule.js`
- PLM / cost / compliance / interaction-recording infrastructure.
- **Implementation: KEEP for the metadata bookkeeping it does.** Be
  careful not to claim it does engineering analysis.

## What we're keeping vs replacing vs deferring

| Area | Verdict |
|---|---|
| Math + topology | KEEP |
| PrimitiveBuilder | KEEP |
| Three.js bridge + rendering | KEEP |
| Assembly container + BOM | KEEP |
| Thermodynamic cycle calculators | KEEP |
| OS / catalog libraries (bearings, fasteners) | KEEP |
| ExtrudeFeature / RevolveFeature | TEST + COMPLETE |
| LoftSweep | TEST + LIKELY COMPLETE |
| SketchSolver | TEST + COMPLETE OR REPLACE WITH solvespace |
| MateSolver | TEST + COMPLETE |
| BooleanEngine | REPLACE WITH manifold-3d |
| FilletChamfer | REPLACE (after manifold lands) |
| DrawingEngine | COMPLETE (need 3D→2D projection + HLR) |
| FEAEngine | RENAME to BeamApprox; integrate CalculiX as real solver |
| CFDEngine | RENAME to FlowEstimator |
| TopologyOptimizer | AUDIT (depends on FEA) |
| GDTEngine | KEEP renderer; build separate analyzer |
| STEPExporter | KEEP for primitives; extend with NURBS at M9+ |
| Production/* package generators | KEEP as templates only |
| FeatureTree (real parametric history) | DEFER to M9+ |
| Direct edit | DEFER to M9+ |
| NURBS surfaces | DEFER to M9+ |
| Real CAM toolpaths | DEFER to M9+ |

## P0 path

The shortest path to a credible foundation:

1. Replace boolean backend with `manifold-3d` → unlocks robust
   sketch-feature workflows.
2. Test + repair `SketchSolver` → unlocks parametric 2D.
3. Wire `Sketch → ExtrudeFeature/RevolveFeature → manifold solid →
   STL` → unlocks real parts.
4. Repair `FilletChamfer` on top of `manifold` (offset + boolean) →
   unlocks usable parts.
5. Test + repair `MateSolver` → unlocks real assemblies.
6. Add manifold-validated STL export → unlocks 3D printing.
7. Build five real demonstrator parts that exercise all of the above
   end-to-end.

After this — and only after this — re-evaluate whether to attempt
NURBS, real FEM/CFD, or stay in the maker / fixture / weldment niche.
