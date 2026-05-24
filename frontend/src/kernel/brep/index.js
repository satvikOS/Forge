/** ArchDisc Kernel — B-rep subtree barrel export. */
export { getKernel, getOCCT, _reset } from './kernelLoader.js';
export { BrepShape, withScope, track } from './BrepShape.js';
export {
  makeBox, makeCylinder, makeSphere, makeCone, makeTorus,
} from './BrepPrimitives.js';
export { fuse, cut, common } from './BrepBoolean.js';
export {
  extrudeRect, revolveRect, filletAll, chamferAll, variableFillet,
  // SP-6 — Sketch-feature generalisation (Area B, T1): arbitrary closed-
  // trimmed-wire profile sweep / extrude / revolve.
  extrudeProfile, revolveProfile, sweepProfile,
} from './BrepFeatures.js';
export { exportStep, importStep } from './BrepStep.js';
export { tessellate } from './BrepTessellate.js';
export { brepToMesh } from './brepToMesh.js';
export { ArchDiscKernel } from './ArchDiscKernel.js';
export { sweep, loft } from './BrepSurfacing.js';
export { shell, thicken, offsetShape, draft } from './BrepLocalOps.js';
export { checkSelfIntersection, checkClash, selfIntersect } from './BrepCheck.js';
export { tessellatePerFace } from './BrepTessellate.js';
export { translate, rotate, makeCompound } from './BrepTransform.js';
export {
  simplify,
  // SP-8 — Healing & repair completion (Area H, T1).
  autoFillMissingFaces,
  autoRepairSelfIntersection,
  harmonizeNormals,
} from './BrepHeal.js';
export {
  blendG2, cliffEdgeBlend, mitreCorner,
  // SP-10 — Blending suite completion (Area D, T2).
  faceFaceBlend, setbackCorner,
} from './BrepBlend.js';
export { fuseAll, fuseNonManifold, fuseCoincident, fuseLattice } from './BrepBoolAdvanced.js';
// SP-5 — Boolean & partition completion (Area C, T1).
export { imprint } from './BrepImprint.js';
export { partition } from './BrepPartition.js';
export { planarSection } from './BrepSection.js';
export { replaceFace } from './BrepRewrite.js';
export { subdivideShape } from './BrepSubdivide.js';
export { retopoShape } from './BrepRetopo.js';
export { buildNurbsPatch, refineNurbs, elevateNurbsDegree, nurbsCurvature } from './BrepNurbs.js';
export { pipeShellSweep, loftTangent, stitchFaces, convergentSolid } from './BrepFinal.js';
export { catmullClarkShape } from './BrepCatmullClark.js';
export { intersectSurfaces } from './BrepNurbsSSI.js';
export { projectPointsOntoBrep, projectMeshOntoBrep } from './BrepSurfaceProject.js';
export { trimmedNurbsFace } from './BrepNurbsTrim.js';
export {
  g2BlendBetweenEdges,
  // SP-10 — hold-line variable-radius blend + G3 (curvature-derivative) blend.
  holdLineBlend, g3BlendBetweenEdges,
} from './BrepBlendG2.js';
export { nSidedPatch } from './BrepNSided.js';
export { classAAnalyze } from './BrepClassA.js';
export {
  facetShape, facetRenderMesh, facetAnalysisMesh,
  hiddenLineProjection, meshSilhouette, resolveFaceterParams, FACETER_PROFILES,
} from './BrepFaceter.js';
export {
  classifyPoint, rayFire, evalCurve, evalSurface, massProperties, adjacency,
} from './BrepQuery.js';
// SP-9 — Direct / synchronous modeling (Area E, T2).
export {
  pushPullFace, moveFace, deleteFaceAndHeal, inferFeature,
} from './BrepDirectOps.js';
// SP-11 — Sheet & tolerant modeling (Area G, T2).
export {
  makeSheetBody, makeLamina,
  tolerantEdges, tolerantVertices, tolerantFaces,
  setBodyTolerance, BodyKindError,
} from './BrepSheet.js';
