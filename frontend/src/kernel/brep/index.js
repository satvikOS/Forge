/** ArchDisc Kernel — B-rep subtree barrel export. */
export { getKernel, getOCCT, _reset } from './kernelLoader.js';
export { BrepShape, withScope, track } from './BrepShape.js';
export {
  makeBox, makeCylinder, makeSphere, makeCone, makeTorus,
} from './BrepPrimitives.js';
export { fuse, cut, common } from './BrepBoolean.js';
export { extrudeRect, revolveRect, filletAll, chamferAll, variableFillet } from './BrepFeatures.js';
export { exportStep, importStep } from './BrepStep.js';
export { tessellate } from './BrepTessellate.js';
export { brepToMesh } from './brepToMesh.js';
export { ArchDiscKernel } from './ArchDiscKernel.js';
export { sweep, loft } from './BrepSurfacing.js';
export { shell, thicken, offsetShape, draft } from './BrepLocalOps.js';
export { checkSelfIntersection, checkClash, selfIntersect } from './BrepCheck.js';
export { tessellatePerFace } from './BrepTessellate.js';
export { translate, makeCompound } from './BrepTransform.js';
export { simplify } from './BrepHeal.js';
export { blendG2, cliffEdgeBlend, mitreCorner } from './BrepBlend.js';
export { fuseAll, fuseNonManifold, fuseCoincident, fuseLattice } from './BrepBoolAdvanced.js';
export { replaceFace } from './BrepRewrite.js';
export { subdivideShape } from './BrepSubdivide.js';
export { retopoShape } from './BrepRetopo.js';
export { buildNurbsPatch, refineNurbs, elevateNurbsDegree, nurbsCurvature } from './BrepNurbs.js';
export { pipeShellSweep, loftTangent, stitchFaces, convergentSolid } from './BrepFinal.js';
export { catmullClarkShape } from './BrepCatmullClark.js';
export { intersectSurfaces } from './BrepNurbsSSI.js';
export { projectPointsOntoBrep, projectMeshOntoBrep } from './BrepSurfaceProject.js';
export { trimmedNurbsFace } from './BrepNurbsTrim.js';
export { g2BlendBetweenEdges } from './BrepBlendG2.js';
export { nSidedPatch } from './BrepNSided.js';
export { classAAnalyze } from './BrepClassA.js';
