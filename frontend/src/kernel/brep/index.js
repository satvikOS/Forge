/** ArchDisc Kernel — B-rep subtree barrel export. */
export { getKernel, getOCCT, _reset } from './kernelLoader.js';
export { BrepShape, withScope, track } from './BrepShape.js';
export {
  makeBox, makeCylinder, makeSphere, makeCone, makeTorus,
  // SP-14b — documented catchable exception for sub-Precision::Confusion()
  // primitive dimensions (was a raw Embind BindingError pre-SP-14b).
  DegeneratePrimitiveError, PRECISION_CONFUSION,
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
// SP-12 — Auto-trimming NURBS B-rep (Area F, T3) — the headline NURBS gap closure.
export {
  autoTrimNurbsBrep, intersectNurbsSurfaces, sideOfSurface, NURBSSurface,
} from './BrepNurbsAutoTrim.js';
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
// UX Tier 5a — Sheet Metal workbench foundation.
// UX Tier 5b — Sheet Metal additions (Hem / Jog / Miter Flange / Sketched Bend).
export {
  baseFlange, edgeFlange, flatPattern,
  isSheetMetal, getSheetMetalMetadata, bendAllowance,
  hem, jog, miterFlange, sketchedBend,
} from './BrepSheetMetal.js';
// UX Tier 6a — Weldments workbench foundation.
export {
  structuralMember, trimMembers, endCap,
  isWeldment, getWeldmentMetadata,
  buildStandardProfile, standardProfileSizes, STANDARD_PROFILES,
} from './BrepWeldments.js';
// UX Tier 9 — Mold Tools workbench foundation.
export {
  draftAnalysis, partingLine, toolingSplit,
  isMold, getMoldMetadata,
} from './BrepMoldTools.js';
// UX Tier 3a — Advanced feature ops (Boundary Boss / Rib / Helix).
export {
  boundaryBoss, rib, helix,
} from './BrepAdvancedFeatures.js';
// SP-13 — Data exchange completion (Area M, T2) — re-export from kernel/export/.
export {
  exportStepAp242, parseStepAp242Summary, importStepAp242WithAttrs,
} from '../export/StepExportAp242.js';
export {
  exportIges, parseIgesSummary, importIges,
} from '../export/IgesExport.js';
export {
  exportGltf, parseGltfSummary,
} from '../export/GltfExport.js';
