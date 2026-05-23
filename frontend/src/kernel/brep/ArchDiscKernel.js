/**
 * ArchDisc Kernel — the unified facade. The single entry point for exact
 * B-rep geometry. Kernel internals never leak past this module. A0 scope:
 * makeBox + measurement + tessellation. A1 scope: all primitives, booleans,
 * features (extrude/revolve/fillet/chamfer), and STEP import/export.
 */

import { getKernel } from './kernelLoader.js';
import {
  makeBox, makeCylinder, makeSphere, makeCone, makeTorus,
} from './BrepPrimitives.js';
import { fuse, cut, common } from './BrepBoolean.js';
import {
  extrudeRect, revolveRect, filletAll, chamferAll, variableFillet,
  // SP-6 — arbitrary trimmed-wire profile features (Area B, T1).
  extrudeProfile, revolveProfile, sweepProfile,
} from './BrepFeatures.js';
import { exportStep, importStep } from './BrepStep.js';
import { shell, thicken, offsetShape, draft } from './BrepLocalOps.js';
import { sweep, loft } from './BrepSurfacing.js';
import { checkSelfIntersection, checkClash, selfIntersect } from './BrepCheck.js';
import { translate, rotate, makeCompound } from './BrepTransform.js';
import { simplify } from './BrepHeal.js';
import { tessellate } from './BrepTessellate.js';
import { brepToMesh } from './brepToMesh.js';
import * as Measure from './BrepMeasure.js';
import { blendG2, cliffEdgeBlend, mitreCorner } from './BrepBlend.js';
import { fuseAll, fuseNonManifold, fuseCoincident, fuseLattice } from './BrepBoolAdvanced.js';
// SP-5 — Boolean & partition completion (Area C, T1).
import { imprint } from './BrepImprint.js';
import { partition } from './BrepPartition.js';
import { planarSection } from './BrepSection.js';
import { replaceFace } from './BrepRewrite.js';
import { subdivideShape } from './BrepSubdivide.js';
import { retopoShape } from './BrepRetopo.js';
import { buildNurbsPatch, refineNurbs, elevateNurbsDegree, nurbsCurvature } from './BrepNurbs.js';
import { pipeShellSweep, loftTangent, stitchFaces, convergentSolid } from './BrepFinal.js';
import { catmullClarkShape } from './BrepCatmullClark.js';
import { intersectSurfaces } from './BrepNurbsSSI.js';
import { projectPointsOntoBrep, projectMeshOntoBrep } from './BrepSurfaceProject.js';
import { trimmedNurbsFace } from './BrepNurbsTrim.js';
import { g2BlendBetweenEdges } from './BrepBlendG2.js';
import { nSidedPatch } from './BrepNSided.js';
import { classAAnalyze } from './BrepClassA.js';
import {
  facetShape, facetRenderMesh, facetAnalysisMesh,
  hiddenLineProjection, meshSilhouette, resolveFaceterParams, FACETER_PROFILES,
} from './BrepFaceter.js';
import {
  classifyPoint, rayFire, evalCurve, evalSurface, massProperties, adjacency,
} from './BrepQuery.js';
// SP-9 — Direct / synchronous modeling (Area E, T2).
import {
  pushPullFace, moveFace, deleteFaceAndHeal, inferFeature,
} from './BrepDirectOps.js';

export const ArchDiscKernel = {
  /** Ensure the B-rep kernel WASM module is loaded. */
  init: getKernel,
  /** Exact B-rep operations. */
  brep: {
    makeBox,
    makeCylinder, makeSphere, makeCone, makeTorus,
    fuse, cut, common,
    extrudeRect, revolveRect, filletAll, chamferAll, variableFillet,
    // ── SP-6 Sketch-feature generalisation (Area B, T1) ───────────────────
    /** Extrude an arbitrary closed planar wire to a prismatic solid. */
    extrudeProfile,
    /** Revolve an arbitrary closed planar wire around an axis to a solid. */
    revolveProfile,
    /** Sweep an arbitrary closed planar profile wire along a path wire. */
    sweepProfile,
    shell, thicken, offsetShape, draft,
    sweep, loft,
    checkSelfIntersection, checkClash, selfIntersect,
    translate, rotate, makeCompound,
    simplify,
    blendG2, cliffEdgeBlend, mitreCorner,
    fuseAll, fuseNonManifold, fuseCoincident, fuseLattice,
    // ── SP-5 Boolean & partition completion (Area C, T1) ──────────────────
    /** Project tool boundary edges onto body faces (volume preserved). */
    imprint,
    /** Split a body along N tool surfaces / solids into multiple pieces (volume conserved). */
    partition,
    /** Planar section of a body — 'curves' (intersection wire) or 'split' (partition into halves). */
    planarSection,
    replaceFace,
    subdivideShape,
    retopoShape,
    buildNurbsPatch, refineNurbs, elevateNurbsDegree, nurbsCurvature,
    pipeShellSweep, loftTangent, stitchFaces, convergentSolid,
    catmullClarkShape,
    intersectSurfaces,
    projectPointsOntoBrep,
    projectMeshOntoBrep,
    trimmedNurbsFace,
    g2BlendBetweenEdges,
    nSidedPatch,
    classAAnalyze,
    exportStep, importStep,
    /** Returns cached triangle data ({positions,normals,indices}); normally used via brepToMesh. */
    tessellate,
    brepToMesh,
    // ── Faceter option surface (SP-7, Area I) ──────────────────────────────
    /** Controlled-deflection faceting — chordal + angular tol, render/analysis profile. */
    facetShape,
    /** Facet at the display-tuned render profile. */
    facetRenderMesh,
    /** Facet at the simulation/curvature-grade analysis profile (much finer). */
    facetAnalysisMesh,
    /** Hidden-line / silhouette extraction via OCCT HLRBRep_Algo. */
    hiddenLineProjection,
    /** Pure-JS mesh-edge silhouette extractor (fast, kernel-free — viewport overlay). */
    meshSilhouette,
    /** Resolve effective chordal/angular deflection for a faceting request. */
    resolveFaceterParams,
    /** Render / analysis quality profile definitions. */
    faceterProfiles: FACETER_PROFILES,
    volume: Measure.volume,
    area: Measure.area,
    faceCount: Measure.faceCount,
    edgeCount: Measure.edgeCount,
    boundingBox: Measure.boundingBox,
    // ── SP-4 Query & Evaluation API (Area J) ──────────────────────────────
    /** Classify a 3-D point against a solid body: 'inside' / 'on' / 'outside'. */
    classifyPoint,
    /** Fire a ray against a body; return every face intersection sorted by distance. */
    rayFire,
    /** Evaluate a spine Edge's curve at parameter t∈[0,1] — point, tangent, 2nd deriv, curvature. */
    evalCurve,
    /** Evaluate a spine Face's surface at (u,v) — point, normal, partials, curvatures. */
    evalSurface,
    /** Centroid + inertia tensor + principal moments / axes + mass. */
    massProperties,
    /** Adjacency traversal view of a SpineBody — facesOfEdge / edgesOfFace / … */
    adjacency,
    // ── SP-9 Direct / Synchronous Modeling (Area E) ───────────────────────
    /** Push (>0, add material) or pull (<0, cut) a face along its outward normal. */
    pushPullFace,
    /** Translate a planar/cylindrical face by a delta vector (normal component only). */
    moveFace,
    /** Remove a face from a body and heal the opening by extending adjacents. */
    deleteFaceAndHeal,
    /** Infer the feature (boss/hole/fillet/chamfer/...) the picked face belongs to. */
    inferFeature,
    /** All metrics in one call — convenient for e2e assertions. */
    async measure(brepShape) {
      return {
        volume: await Measure.volume(brepShape),
        area: await Measure.area(brepShape),
        faceCount: await Measure.faceCount(brepShape),
        edgeCount: await Measure.edgeCount(brepShape),
        boundingBox: await Measure.boundingBox(brepShape),
      };
    },
  },
};
