/**
 * ArchDisc Foundation — public entry point.
 *
 * The foundation modules form ArchDisc's real geometry stack going
 * forward. They replace the visualization-grade primitive workflow
 * with a sketch → constraint solver → profile → manifold-3d feature
 * → STL pipeline that produces topology-robust output.
 */

export { getManifold } from './manifoldKernel.js';
export {
  Sketch2D, SketchPoint, SketchLine, SketchCircle, SketchArc,
} from './Sketch2D.js';
export { buildCrossSection, crossSectionFromPolygons } from './Profile.js';
export {
  extrude, revolve, add, subtract, intersect,
  translate, rotate, scale, mirror,
  linearPattern, circularPattern, shell,
} from './Features.js';
export { Part, buildPart } from './Part.js';
export { Assembly } from './AssemblyMate.js';
export { toBinarySTL, toAsciiSTL, buildPrintReport } from './STLExport.js';
