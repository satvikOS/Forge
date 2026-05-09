/**
 * ArchDisc Geometry Kernel — Public API
 *
 * The ArchDisc Kernel is a proprietary B-Rep CAD engine built from scratch.
 * No external CAD dependencies — pure JavaScript geometry, topology, and constraint solving.
 *
 * Architecture:
 *   Math Layer     → Vec3, Mat4, Plane, BBox3, Curves, Surfaces
 *   Topology Layer → Vertex, Edge, Loop, Face, Shell, Solid (B-Rep)
 *   Sketch Layer   → 2D constraint solver (coincident, parallel, tangent, etc.)
 *   Feature Layer  → Parametric operations (extrude, revolve, primitives, feature tree)
 *   Tessellation   → B-Rep → triangle mesh conversion
 *   Bridge Layer   → Three.js integration (rendering, picking, highlighting)
 */

// Math
export { default as Vec3, EPSILON } from './math/Vec3.js';
export { default as Mat4 } from './math/Mat4.js';
export { default as Plane } from './math/Plane.js';
export { default as BBox3 } from './math/BBox3.js';
export { LineCurve, ArcCurve, NurbsCurve } from './math/Curve.js';
export { PlanarSurface, CylindricalSurface, SphericalSurface, ConicalSurface, ToroidalSurface } from './math/Surface.js';

// Topology
export { default as TopoVertex } from './topology/TopoVertex.js';
export { default as TopoEdge } from './topology/TopoEdge.js';
export { default as TopoLoop } from './topology/TopoLoop.js';
export { default as TopoFace } from './topology/TopoFace.js';
export { default as TopoShell } from './topology/TopoShell.js';
export { default as TopoSolid } from './topology/TopoSolid.js';

// Sketch
export { default as SketchSolver, SketchPoint, SketchLine, SketchCircle, SketchArc } from './sketch/SketchSolver.js';
export { default as InteractiveSketch, TOOLS as SketchTools } from './sketch/InteractiveSketch.js';

// Tessellation (Subdivision)
export { default as SubdivisionSurface } from './tessellation/SubdivisionSurface.js';

// Features
export { default as PrimitiveBuilder } from './features/PrimitiveBuilder.js';
export { default as ExtrudeFeature } from './features/ExtrudeFeature.js';
export { default as RevolveFeature } from './features/RevolveFeature.js';
export { default as FeatureTree } from './features/FeatureTree.js';
export { default as BooleanEngine } from './features/BooleanEngine.js';
export { default as FilletChamfer } from './features/FilletChamfer.js';
export { default as LoftSweep } from './features/LoftSweep.js';
export { default as DirectEdit } from './features/DirectEdit.js';

// Export
export { default as ExportEngine } from './export/ExportEngine.js';
export { default as STEPExporter } from './export/STEPExporter.js';

// Tessellation
export { default as Tessellator } from './tessellation/Tessellator.js';

// Bridge
export { default as ThreeJSBridge } from './bridge/ThreeJSBridge.js';
export { default as AssemblyBridge } from './bridge/AssemblyBridge.js';

// Assembly
export { default as Assembly, PartInstance, Mate } from './assembly/Assembly.js';
export { default as MateSolver } from './assembly/MateSolver.js';

// Simulation
export { default as FEAEngine, MATERIALS } from './simulation/FEAEngine.js';
export { default as RenderEngine, PBR_PRESETS, LIGHTING_PRESETS } from './simulation/RenderEngine.js';
export { default as FEAVisualizer } from './simulation/FEAVisualizer.js';
export { default as TopologyOptimizer } from './simulation/TopologyOptimizer.js';
export { default as CFDEngine, FLUIDS } from './simulation/CFDEngine.js';

// Manufacturing
export { default as GCodeGenerator } from './manufacturing/GCodeGenerator.js';
export { default as Slicer } from './manufacturing/Slicer.js';
export { default as ToolLibrary, TOOL_TYPES, MATERIAL_PARAMS } from './manufacturing/ToolLibrary.js';
export { default as CAMVisualizer } from './manufacturing/CAMVisualizer.js';
export { default as StockSimulator } from './manufacturing/StockSimulator.js';
export { default as MoldFlow, PLASTIC_MATERIALS } from './manufacturing/MoldFlow.js';

// Rendering & Publishing
export { default as SceneComposer, BACKGROUNDS, CAMERA_PRESETS } from './rendering/SceneComposer.js';

// Pixel Management (Proprietary)
export { default as PixelManager } from './pixelmanagement/PixelManager.js';

// Standards & Libraries
export { default as FastenerLibrary, METRIC_THREADS } from './standards/FastenerLibrary.js';
export { default as GDTEngine, GDT_TYPES, IT_GRADES } from './standards/GDTEngine.js';
export { default as BearingLibrary, BEARING_CATALOG } from './standards/BearingLibrary.js';

// PDM / Version Control
export { default as VersionControl } from './pdm/VersionControl.js';
export { default as PartNumbering, SCHEMES as PART_NUMBERING_SCHEMES } from './pdm/PartNumbering.js';
export { default as CostingEngine, MATERIAL_COSTS_PER_KG, MACHINE_RATES, FINISHING_COSTS } from './pdm/CostingEngine.js';
export { default as Sustainability, MATERIAL_FOOTPRINTS, GRID_INTENSITY } from './pdm/Sustainability.js';

// AI Agent Bridge
export { default as AgentBridge } from './agents/AgentBridge.js';

// Spatial — BVH for fast picking in large scenes
export { default as BVH } from './spatial/BVH.js';

// Airfoil & Turbomachinery (real engine geometry)
export { default as NACA } from './airfoil/NACA.js';
export { default as TurbomachineryBlade } from './turbomachinery/TurbomachineryBlade.js';
export { default as HollowBlade } from './turbomachinery/HollowBlade.js';

// LOD for large assemblies
export { default as LODManager } from './lod/LODManager.js';

// Drawing — 2D engineering drawings from 3D solids
export { default as DrawingEngine, VIEW_DIRECTIONS } from './drawing/DrawingEngine.js';
export { default as Annotations } from './drawing/Annotations.js';

// Registry — Global Part ID system (foundation for tree panel, export, tests)
export { default as PartIDRegistry } from './registry/PartIDRegistry.js';

// Focus / spotlight controller — camera + dim-others
export { default as FocusController } from './bridge/FocusController.js';

// Interaction Recorder — captures every user action with timestamps
export { default as InteractionRecorder } from './recording/InteractionRecorder.js';

// Project Exporter — emit every component as a file (geometry + metadata + tests)
export { default as ProjectExporter } from './export/ProjectExporter.js';

// Brayton thermodynamic cycle — real engine performance
export { default as BraytonCycle } from './thermodynamics/BraytonCycle.js';

// Acoustic noise prediction — FAR Part 36 / ICAO Annex 16 cert margins
export { default as NoisePrediction } from './acoustics/NoisePrediction.js';

// Maintenance schedule — task cards + intervals + LLP
export { default as MaintenanceSchedule, TASK_LIBRARY as MAINTENANCE_TASKS } from './maintenance/MaintenanceSchedule.js';

// HTML Report Builder — self-contained interactive deliverable
export { default as HTMLReportBuilder } from './export/HTMLReportBuilder.js';

// Real-World Test Scenarios + Runner — bird strike, rotor overspeed, etc.
export { default as TestScenarios, SCENARIO_LIBRARY } from './realworld/TestScenarios.js';
export { default as RealWorldTestRunner } from './realworld/RealWorldTestRunner.js';

// FAR Part 33 / CS-E Compliance Matrix
export { default as ComplianceMatrix, COMPLIANCE_ITEMS } from './realworld/ComplianceMatrix.js';

// Cutaway Renderer — section-view rendering for engine internals
export { default as CutawayRenderer } from './rendering/CutawayRenderer.js';

// Marketing Cutaway — color-coded section view matching reference imagery
export { default as MarketingCutaway, SECTION_COLORS } from './rendering/MarketingCutaway.js';

// Annotation Overlay — section labels + leader lines on top of renders
export { default as AnnotationOverlay } from './rendering/AnnotationOverlay.js';

// Engine Materials — PBR mapping per material name (titanium, Inconel, CMC, ...)
export { default as EngineMaterials, ENGINE_MATERIAL_PARAMS } from './materials/EngineMaterials.js';

// Studio Lighting — 3-point + hemisphere for engineering renders
export { default as StudioLighting } from './rendering/StudioLighting.js';

// Post-FX — SSAO + bloom + FXAA via Three.js EffectComposer
export { default as PostFX } from './rendering/PostFX.js';
