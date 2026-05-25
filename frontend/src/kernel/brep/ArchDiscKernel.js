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
// UX Tier 4 (focused) — sheet-body variants of SP-6's extrude/revolveProfile.
import {
  extrudedSurface, revolvedSurface,
} from './BrepSurfaceFeatures.js';
import { exportStep, importStep } from './BrepStep.js';
import { shell, thicken, offsetShape, draft } from './BrepLocalOps.js';
import { sweep, loft } from './BrepSurfacing.js';
import { checkSelfIntersection, checkClash, selfIntersect } from './BrepCheck.js';
import { translate, rotate, makeCompound } from './BrepTransform.js';
import {
  simplify,
  // SP-8 — Healing & repair completion (Area H, T1).
  autoFillMissingFaces,
  autoRepairSelfIntersection,
  harmonizeNormals,
} from './BrepHeal.js';
import { tessellate } from './BrepTessellate.js';
import { brepToMesh } from './brepToMesh.js';
import * as Measure from './BrepMeasure.js';
import {
  blendG2, cliffEdgeBlend, mitreCorner,
  // SP-10 — Blending suite completion (Area D, T2).
  faceFaceBlend, setbackCorner,
} from './BrepBlend.js';
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
// SP-12 — Auto-trimming NURBS B-rep (Area F, T3) — the headline NURBS gap.
import {
  autoTrimNurbsBrep, intersectNurbsSurfaces, sideOfSurface, NURBSSurface,
} from './BrepNurbsAutoTrim.js';
import {
  g2BlendBetweenEdges,
  // SP-10 — hold-line variable-radius blend + G3 (curvature-derivative) blend.
  holdLineBlend, g3BlendBetweenEdges,
} from './BrepBlendG2.js';
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
// SP-11 — Sheet & tolerant modeling (Area G, T2).
import {
  makeSheetBody, makeLamina,
  tolerantEdges, tolerantVertices, tolerantFaces,
  setBodyTolerance, BodyKindError,
} from './BrepSheet.js';
// UX Tier 5a — Sheet Metal workbench foundation.
// UX Tier 5b — Sheet Metal additions (Hem / Jog / Miter Flange / Sketched Bend).
import {
  baseFlange, edgeFlange, flatPattern,
  isSheetMetal, getSheetMetalMetadata, bendAllowance,
  hem, jog, miterFlange, sketchedBend,
} from './BrepSheetMetal.js';
// UX Tier 6a — Weldments workbench foundation.
// UX Tier 6b — Weldments additions (Gusset / Weld Bead).
import {
  structuralMember, trimMembers, endCap,
  isWeldment, getWeldmentMetadata,
  buildStandardProfile, standardProfileSizes, STANDARD_PROFILES,
  gusset, weldBead,
} from './BrepWeldments.js';
// UX Tier 9 — Mold Tools workbench foundation.
// UX Tier 9b — focused additions (Undercut Analysis + Shut-Off Surfaces).
import {
  draftAnalysis, partingLine, toolingSplit,
  isMold, getMoldMetadata,
  undercutAnalysis, shutOffSurfaces,
} from './BrepMoldTools.js';
// UX Tier 3a — Advanced feature ops (Boundary Boss / Rib / Helix).
import {
  boundaryBoss, rib, helix,
} from './BrepAdvancedFeatures.js';
// SP-13 — Data exchange completion (Area M, T2).
import {
  exportStepAp242, parseStepAp242Summary, importStepAp242WithAttrs,
} from '../export/StepExportAp242.js';
import {
  exportIges, parseIgesSummary, importIges,
} from '../export/IgesExport.js';
import {
  exportGltf, parseGltfSummary,
} from '../export/GltfExport.js';

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
    // ── UX Tier 4 (focused) — Surface feature ops ─────────────────────────
    /** Extruded Surface — prism the WIRE (not a face) → sheet body of lateral faces, no caps. SW Extruded Surface. */
    extrudedSurface,
    /** Revolved Surface — revolve the WIRE (not a face) → sheet body of SOR faces, no caps. SW Revolved Surface. */
    revolvedSurface,
    shell, thicken, offsetShape, draft,
    sweep, loft,
    checkSelfIntersection, checkClash, selfIntersect,
    translate, rotate, makeCompound,
    simplify,
    // ── SP-8 Healing & repair completion (Area H, T1) ─────────────────────
    /** Auto-fill missing faces — patches every closed open-edge loop with an N-sided patch and stitches the result back to a watertight body. */
    autoFillMissingFaces,
    /** Auto-repair face-level self-intersection — detect via Möller, then heal via ShapeFix_Shape tolerance widening + ShapeFix_Shell.FixFaceOrientation. */
    autoRepairSelfIntersection,
    /** Harmonise face normals so every face's outward normal points consistently (or all inward via opts.outward=false). */
    harmonizeNormals,
    blendG2, cliffEdgeBlend, mitreCorner,
    // ── SP-10 Blending suite completion (Area D, T2) ──────────────────────
    /** Rolling-ball blend between two SELECTED FACES — shared-edge fillet. */
    faceFaceBlend,
    /** Multi-edge vertex blend with per-edge setback distances. */
    setbackCorner,
    /** Variable-radius G2 blend constrained to TOUCH a 3-D hold curve. */
    holdLineBlend,
    /** G3 (curvature-derivative-continuous) blend between two edges — degree 3×7 NURBS. */
    g3BlendBetweenEdges,
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
    // ── SP-12 Auto-trimming NURBS B-rep (Area F, T3) ───────────────────────
    /** Take N NURBS surfaces; produce a self-consistent B-rep where each face is trimmed by the SSI curves. */
    autoTrimNurbsBrep,
    /** Surface-surface intersection between two NURBS surfaces — returns 3-D polylines + (u,v) pcurves on each surface. */
    intersectNurbsSurfaces,
    /** Classify a 3-D point against a NURBS surface — 'outside'/'inside'/'on' by normal convention. */
    sideOfSurface,
    /** Foundation NURBSSurface class — exposed here so the kernel facade carries the SP-12 input type. */
    NURBSSurface,
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
    // ── SP-11 Sheet & tolerant modeling (Area G) ──────────────────────────
    /** Build a SpineBody{kind:'sheet'} from a set of faces / shell / compound. */
    makeSheetBody,
    /** Build a single-face SpineBody{kind:'sheet'} — the Parasolid/ACIS lamina. */
    makeLamina,
    /** Every edge with tolerance > threshold, sorted descending. */
    tolerantEdges,
    /** Every vertex with tolerance > threshold, sorted descending. */
    tolerantVertices,
    /** Every face with tolerance > threshold, sorted descending. */
    tolerantFaces,
    /** Stamp the body-level modelling tolerance (chainable). */
    setBodyTolerance,
    /** Exception class raised by Body.assertSolid/Sheet/Wire/Lamina. */
    BodyKindError,
    // ── UX Tier 5a Sheet Metal workbench foundation ───────────────────────
    /** Base Flange — sketch profile + thickness + K-factor → sheet-metal-tagged solid body. */
    baseFlange,
    /** Edge Flange — pick an edge on a sheet-metal body and extrude a flange off it at `angleDeg`. */
    edgeFlange,
    /** Flat Pattern — unfold a bent sheet-metal part into its flat manufacturing layout. */
    flatPattern,
    /** Predicate — does the body carry sheet-metal metadata (tagged by Base Flange)? */
    isSheetMetal,
    /** Read the sheet-metal metadata bag — {thickness, kFactor, bendRadius, isFlat, bends[]}. */
    getSheetMetalMetadata,
    /** Sheet-metal bend-allowance formula — BA = π(R + K·t)(θ/180°). */
    bendAllowance,
    // ── UX Tier 5b Sheet Metal additions ───────────────────────────────────
    /** Hem — fold a sheet edge over itself (closed / open / rolled / teardrop). */
    hem,
    /** Jog — Z-step / stepped offset in the sheet via two opposed bends. */
    jog,
    /** Miter Flange — multi-edge mitered flange swept along an edge sequence. */
    miterFlange,
    /** Sketched Bend — bend the sheet along a user-drawn line by an angle. */
    sketchedBend,
    // ── UX Tier 6a Weldments workbench foundation ─────────────────────────
    /** Structural Member — sweep a standard ISO/ANSI profile along a 3D path; tags the result with weldment metadata. */
    structuralMember,
    /** Trim/Extend Members — boolean trim of 2+ weldment members at their joint (butt | mitered). */
    trimMembers,
    /** End Cap — flat (or thick) cap closing an open end of a structural member. */
    endCap,
    /** Predicate — does the body carry weldment metadata (tagged by Structural Member)? */
    isWeldment,
    /** Read the weldment metadata bag — {profile, size, length, dims, trims[], caps[]}. */
    getWeldmentMetadata,
    /** Build a 2D polygon (mm) for one of the standard ISO/ANSI profile families. */
    buildStandardProfile,
    /** Map of {profileFamily → sizeLabels[]} of every standard profile shipped. */
    standardProfileSizes,
    /** Raw catalogue of standard profile dimensions (for advanced callers). */
    STANDARD_PROFILES,
    // ── UX Tier 6b Weldments additions ─────────────────────────────────────
    /** Gusset — triangular (or polygon) reinforcement plate between two structural members at their shared joint. */
    gusset,
    /** Weld Bead — fillet / square / V / bevel weld profile swept along the joint between two members. */
    weldBead,
    // ── UX Tier 9 Mold Tools workbench foundation ─────────────────────────
    /** Draft Analysis — walk every face, classify by draft angle vs. pull direction (positive / negative / vertical). */
    draftAnalysis,
    /** Parting Line — trace the silhouette curve on the body (edges between positive- and negative-draft faces). */
    partingLine,
    /** Tooling Split — partition the body into CORE (faces +pull) + CAVITY (opposite) halves along a planar parting surface. */
    toolingSplit,
    /** Predicate — does the body carry mold metadata (tagged by any mold-tools op)? */
    isMold,
    /** Read the mold metadata bag — {draftAnalysis, partingLine, half, toolingSplit, undercut, shutOff}. */
    getMoldMetadata,
    // ── UX Tier 9b Mold Tools focused additions ──────────────────────────
    /** Undercut Analysis — flag faces that would lock the part in the mold via face-normal + shadow-ray test along pull direction. */
    undercutAnalysis,
    /** Shut-Off Surfaces — auto-close through-holes (closed free-edge loops) with N-sided patches so the body becomes watertight (suitable for cavity-cutting). */
    shutOffSurfaces,
    // ── UX Tier 3a Advanced feature ops ───────────────────────────────────
    /** Boundary Boss / Cut — loft through N profile wires with optional M guide curves; SW's marquee surfacing feature. */
    boundaryBoss,
    /** Rib — extrude a sketched LINE into a thin wall feature intersected with a parent body. */
    rib,
    /** Helix — 3D helical CURVE (wire body) for sweeping springs / threads. */
    helix,
    // ── SP-13 Data exchange completion (Area M, T2) ──────────────────────
    /** Export to STEP AP242 (PMI + colour + property attributes). */
    exportStepAp242,
    /** Parse the AP242 STEP file and return PMI/colour/property entity counts. */
    parseStepAp242Summary,
    /** Import an AP242 STEP file + reconstruct attribute manifest. */
    async importStepAp242WithAttrs(stepText) {
      const { importStep } = await import('./BrepStep.js');
      return importStepAp242WithAttrs(stepText, importStep);
    },
    /** Export to IGES 5.3 via OCCT IGESControl_Writer. */
    exportIges,
    /** Parse an IGES file and return section-count summary. */
    parseIgesSummary,
    /** Import an IGES file via OCCT IGESControl_Reader. */
    importIges,
    /** Export to glTF 2.0 with PBR material + per-face colour + attribute extras. */
    exportGltf,
    /** Parse a glTF 2.0 file and return material + extras summary. */
    parseGltfSummary,
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
