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

// Features
export { default as PrimitiveBuilder } from './features/PrimitiveBuilder.js';
export { default as ExtrudeFeature } from './features/ExtrudeFeature.js';
export { default as RevolveFeature } from './features/RevolveFeature.js';
export { default as FeatureTree } from './features/FeatureTree.js';
export { default as BooleanEngine } from './features/BooleanEngine.js';

// Tessellation
export { default as Tessellator } from './tessellation/Tessellator.js';

// Bridge
export { default as ThreeJSBridge } from './bridge/ThreeJSBridge.js';
