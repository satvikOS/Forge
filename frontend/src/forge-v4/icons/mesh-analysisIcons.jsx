// Forge — Mesh & Analysis category icon set.
//
// Hand-authored, Siemens-NX / Dassault-CATIA / SolidWorks toolbar-grade
// monochrome SVG glyphs for the polygon-mesh editing + design-analysis
// toolset. Every glyph depicts the ACTUAL operation the way a pro MCAD
// toolbar would: tessellate = a smooth surface broken into triangles;
// decimate = a dense triangle patch thinned to a sparse one with a down
// arrow; remesh = a triangle soup re-gridded to clean quads; repair/heal
// = a torn mesh hole stitched shut; smooth = a jagged edge relaxed into a
// curve; subdivide = one quad split into four; offset-mesh = a surface
// shadowed by an offset copy; mesh-boolean = two triangulated bodies with
// a set-op symbol; curvature = a comb of porcupine hairs along a curve;
// draft-analysis = a part with a pull direction + draft cone; thickness =
// a wall measured by a ball-gauge; zebra = reflection stripes wrapping a
// surface; section = a plane slicing a solid with hatching; deviation =
// a nominal vs probed surface with a Δ heatmap band; convex-hull = a
// point set wrapped in its taut envelope; point-cloud = a scattered dot
// field; scan-to-mesh = a dot cloud turning into triangles; mesh-to-solid
// = triangles becoming a BRep solid. A real engineer recognizes the op
// from the picture alone.
//
// ICON STANDARD (identical across every category):
//   <svg viewBox="0 0 24 24" width={size||18} height={size||18}
//        fill="none" stroke="currentColor" strokeWidth={1.5}
//        strokeLinecap="round" strokeLinejoin="round" {...props}>
//   Monochrome (currentColor only — no fills, no color). All content
//   kept inside x,y ∈ [2,22] (2 px safe padding). Consistent visual
//   weight + complexity. Pure presentational components — no logic.
//
// Keys match the REAL tool / command ids used in the app:
//   frontend/src/ai/ForgeToolBridge.js   part.tessellate, part.draft-faces,
//                                         heal.* verbs
//   frontend/src/forge-v4/meshDispatch.js decimateQEM / smoothLaplacian /
//                                         smoothTaubin / fillHoles /
//                                         repairSelfIntersect / meshBoolean /
//                                         remeshUniform / simplifyClustering /
//                                         subdivideLoop (mesh.subdiv.loop) /
//                                         subdivideCatmullClark (mesh.subdiv.cc) /
//                                         tessellateNativeBody / meshToSolidViaStl
//   frontend/src/config/menuConfig.js     draft-analysis, undercut,
//                                         wall-thickness, compare(+part/drawing/bom),
//                                         section-view, interference, clearance,
//                                         offset-surface, thicken, weld-bead
//   frontend/src/forge-v4 panels          CurvatureCombPanel (curvature-comb),
//                                         reflection-line, zebra / light-lines,
//                                         pointcloud import, *-scan, deviationHeatmap,
//                                         MeshRepairWorkbench, InspectionWorkbench
// Sensible aliases are added so kebab-case, camelCase, dotted and
// namespaced callsites all resolve to the same glyph.
//
// Usage:
//   import meshAnalysisIcons, { Tessellate } from
//     'forge-v4/icons/mesh-analysisIcons.jsx';
//   const Glyph = meshAnalysisIcons['part.tessellate'];
//   <Glyph size={18} />

import React from 'react';

// Shared <svg> wrapper enforcing the category-wide icon standard.
const Svg = ({ size, children, ...rest }) => (
  <svg
    viewBox="0 0 24 24"
    width={size || 18}
    height={size || 18}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...rest}
  >
    {children}
  </svg>
);

/* ════════════════════════ MESH — generation ════════════════════════ */

// Tessellate — a smooth round surface broken into a triangle mesh.
// Outer arc = the analytic surface; inner web = the generated triangles.
export const Tessellate = (props) => (
  <Svg {...props}>
    <path d="M3 12a9 9 0 0 1 18 0" />
    <path d="M3 12h18" />
    <path d="M6 12l3-5 3 5 3-5 3 5" />
    <path d="M9 7l3 5 3-5" />
  </Svg>
);

// Native-body tessellate — a BRep solid (cube) emitting its triangle skin.
export const TessellateNative = (props) => (
  <Svg {...props}>
    <path d="M5 7l7-4 7 4v8l-7 4-7-4z" />
    <path d="M5 7l7 4 7-4M12 11v8" />
    <path d="M5 7l7 4M19 7l-7 4M5 15l7-4 7 4" />
  </Svg>
);

/* ════════════════════════ MESH — reduction ════════════════════════ */

// Decimate / reduce — a dense triangle patch thinned to a sparse one,
// with a down arrow marking the triangle-count reduction.
export const Decimate = (props) => (
  <Svg {...props}>
    <path d="M3 4h7v7H3z" />
    <path d="M3 4l3.5 3.5L10 4M3 11l3.5-3.5L10 11M3 7.5h7M6.5 4v7" />
    <path d="M14 7.5h6M14 7.5l4-3.5M14 7.5l4 3.5" />
    <path d="M17 14v6M17 20l-2.5-2.5M17 20l2.5-2.5" />
  </Svg>
);

// Simplify (clustering) — a triangle blob collapsed onto a coarse voxel
// grid, the cells that merge clusters of vertices.
export const SimplifyClustering = (props) => (
  <Svg {...props}>
    <path d="M3 3h18v18H3z" />
    <path d="M9 3v18M15 3v18M3 9h18M3 15h18" />
    <path d="M6 18l2-3 2 3M14 6l2 3 2-3" />
  </Svg>
);

/* ════════════════════════ MESH — remesh ════════════════════════ */

// Remesh — an irregular triangle soup (left) re-gridded into clean,
// uniform quads (right) with a flow arrow between.
export const Remesh = (props) => (
  <Svg {...props}>
    <path d="M3 5l3 6 3-5-2 7 3-3" />
    <path d="M11 12h2M13 12l-1.5-1.5M13 12l-1.5 1.5" />
    <path d="M15 5h6v14h-6z" />
    <path d="M18 5v14M15 9.7h6M15 14.3h6" />
  </Svg>
);

/* ════════════════════════ MESH — repair / heal ════════════════════════ */

// Repair (self-intersection) — a mesh patch with a flagged defect (the
// crossing edges) marked by a wrench, the heal action.
export const Repair = (props) => (
  <Svg {...props}>
    <path d="M3 4h8v8H3z" />
    <path d="M3 4l8 8M11 4l-8 8" />
    <path d="M20.5 5.5a2.5 2.5 0 0 1-3.2 3.2L13 13.2 11 11.2l4.5-4.3a2.5 2.5 0 0 1 3.2-3.2l-1.8 1.8.9 1.6 1.6.9z" />
  </Svg>
);

// Fill-holes — a mesh boundary loop (the gap) being capped by a new
// triangulated patch stitched across the opening.
export const FillHoles = (props) => (
  <Svg {...props}>
    <path d="M4 6h6M14 6h6M4 6v12h16V6" strokeDasharray="0" />
    <path d="M10 6a3 3 0 0 1 4 0" strokeDasharray="2 2" />
    <path d="M10.5 6.5L12 11l1.5-4.5M9 13l3-2 3 2M12 11v6" />
  </Svg>
);

// Heal — auto-fill missing faces: a torn surface corner with the missing
// face dashed-in and a small "+" patch indicator.
export const HealAutoFill = (props) => (
  <Svg {...props}>
    <path d="M3 4h10v10" />
    <path d="M3 4v10h10" strokeDasharray="2.5 2" />
    <path d="M13 4l8 4-8 4z" strokeDasharray="2.5 2" />
    <path d="M18 14v6M15 17h6" />
  </Svg>
);

// Heal — auto-repair self-intersection: a folded/overlapping surface
// flagged and corrected (crossed fold + check).
export const HealAutoRepair = (props) => (
  <Svg {...props}>
    <path d="M3 6h9v9H3z" />
    <path d="M3 6l9 9M12 6L3 15" />
    <path d="M14 14l2.5 2.5L21 11" />
  </Svg>
);

// Heal — harmonize normals: a surface with face-normal arrows flipped so
// they all point consistently outward.
export const HarmonizeNormals = (props) => (
  <Svg {...props}>
    <path d="M3 16h16" />
    <path d="M3 16l4-2 4 2 4-2 4 2" />
    <path d="M5 14V7M5 7l-1.5 1.8M5 7l1.5 1.8" />
    <path d="M13 14V7M13 7l-1.5 1.8M13 7l1.5 1.8" />
  </Svg>
);

// Heal — sew: two surface edges stitched together with a sewing stitch
// line crossing the seam.
export const Sew = (props) => (
  <Svg {...props}>
    <path d="M4 5h7v14H4z" />
    <path d="M13 5h7v14h-7z" />
    <path d="M11 7l2 2M13 8l-2 2M11 11l2 2M13 12l-2 2M11 15l2 2M13 16l-2 2" />
  </Svg>
);

// Heal — simplify (shape): a surface stripped of redundant seam edges,
// the dashed faces merged into one clean face.
export const HealSimplify = (props) => (
  <Svg {...props}>
    <path d="M4 5h16v14H4z" />
    <path d="M9 5v14M15 5v14" strokeDasharray="2.5 2" />
    <path d="M19 9l-2 3 2 3M5 9l2 3-2 3" />
  </Svg>
);

// Heal — check validity: a body run through a magnifier returning a pass
// check, the geometry-validity report.
export const CheckValidity = (props) => (
  <Svg {...props}>
    <path d="M4 5h9v9H4z" />
    <path d="M6 9.5l2 2 4-4" />
    <circle cx="16" cy="16" r="3.5" />
    <path d="M18.6 18.6L21 21" />
  </Svg>
);

// Weld — two mesh edges fused with a weld-bead seam of stacked stitches.
export const WeldMesh = (props) => (
  <Svg {...props}>
    <path d="M4 5h6v14H4z" />
    <path d="M14 5h6v14h-6z" />
    <path d="M10 6.5c2 1 2 2 0 3s-2 2 0 3-2 2 0 3 2 2 0 3" />
  </Svg>
);

/* ════════════════════════ MESH — smooth ════════════════════════ */

// Smooth — a jagged polyline (top) relaxed into a smooth fair curve
// (bottom), the classic Laplacian smoothing depiction.
export const Smooth = (props) => (
  <Svg {...props}>
    <path d="M3 7l3-3 3 3 3-3 3 3 3-3 3 3" />
    <path d="M12 11v2M11 12.5l1 1 1-1" />
    <path d="M3 17c3-4 6 4 9 0s6-4 9 0" />
  </Svg>
);

// Smooth — Taubin (λ|μ): a fair curve with the two-pass inflate/deflate
// shrink-free signature, marked by the ± band.
export const SmoothTaubin = (props) => (
  <Svg {...props}>
    <path d="M3 12c3-6 6 6 9 0s6-6 9 0" />
    <path d="M3 9c3-6 6 6 9 0s6-6 9 0" strokeDasharray="2 2" />
    <path d="M3 15c3-6 6 6 9 0s6-6 9 0" strokeDasharray="2 2" />
  </Svg>
);

/* ════════════════════════ MESH — subdivide ════════════════════════ */

// Subdivide — one quad split into four, the canonical subdivision glyph.
export const Subdivide = (props) => (
  <Svg {...props}>
    <path d="M4 4h16v16H4z" />
    <path d="M12 4v16M4 12h16" />
    <path d="M8 8h0M16 8h0M8 16h0M16 16h0" />
  </Svg>
);

// Subdivide — Loop (triangle): a triangle split into four sub-triangles.
export const SubdivideLoop = (props) => (
  <Svg {...props}>
    <path d="M12 3L3 20h18z" />
    <path d="M7.5 11.5h9M12 3l-4.5 8.5M12 3l4.5 8.5" />
  </Svg>
);

// Subdivide — Catmull-Clark: a quad face with a smoothed limit-surface
// corner, the curved-cage CC signature.
export const SubdivideCatmullClark = (props) => (
  <Svg {...props}>
    <path d="M4 4h16v16H4z" strokeDasharray="2.5 2" />
    <path d="M7 17c0-5 5-10 10-10" />
    <path d="M12 6.5v11M5.5 12h13" strokeDasharray="2.5 2" />
  </Svg>
);

/* ════════════════════════ MESH — offset / boolean ════════════════════════ */

// Offset-mesh — a surface and its parallel offset copy with the gap arrow.
export const OffsetMesh = (props) => (
  <Svg {...props}>
    <path d="M3 14l4-4 4 4 4-4 4 4" />
    <path d="M3 9l4-4 4 4 4-4 4 4" />
    <path d="M19 7v4M19 7l-1.3 1.3M19 7l1.3 1.3" />
  </Svg>
);

// Offset-surface — same op on an analytic surface (smooth arc + offset).
export const OffsetSurface = (props) => (
  <Svg {...props}>
    <path d="M3 16a9 9 0 0 1 18 0" />
    <path d="M5 12a7 7 0 0 1 14 0" strokeDasharray="2.5 2" />
    <path d="M12 7V3M12 3l-1.6 1.8M12 3l1.6 1.8" />
  </Svg>
);

// Mesh-boolean — two triangulated bodies overlapping with a set-op (∪/∩)
// junction symbol marking the combine.
export const MeshBoolean = (props) => (
  <Svg {...props}>
    <path d="M3 8l4-4 4 4-4 4z" />
    <path d="M13 8l4-4 4 4-4 4z" />
    <path d="M5 8l2 2 2-2M15 8l2 2 2-2" />
    <path d="M8 17h8M12 14v6" />
  </Svg>
);

/* ════════════════════════ ANALYSIS — curvature / reflection ════════════════════════ */

// Curvature display (comb) — the porcupine curvature comb: hairs of
// varying length rising off a fair curve, joined by the envelope.
export const CurvatureComb = (props) => (
  <Svg {...props}>
    <path d="M3 18c3-9 15-9 18 0" />
    <path d="M4 16v-3M7 11v-4M10 8.5V4M14 8.5V4M17 11v-4M20 16v-3" />
    <path d="M4 13l3-2 3-2.5 4 0 3 2.5 3 2" />
  </Svg>
);

// Zebra / reflection — black-and-white reflection stripes wrapping a
// curved surface, the class-A continuity check.
export const Zebra = (props) => (
  <Svg {...props}>
    <path d="M4 19a10 10 0 0 1 16 0" />
    <path d="M7 15.2a7 7 0 0 1 10 0" />
    <path d="M9.5 11.6a4 4 0 0 1 5 0" />
    <path d="M12 9V4" strokeDasharray="2 1.6" />
    <path d="M4 19h16" strokeDasharray="2 1.6" />
  </Svg>
);

// Reflection-line / light-line — projected highlight lines streaming
// across a surface from a light direction.
export const ReflectionLine = (props) => (
  <Svg {...props}>
    <path d="M3 17a9 9 0 0 1 18 0" />
    <path d="M6 16.2c2-3 4-4.5 6-4.5s4 1.5 6 4.5" />
    <path d="M8 15.6c1.3-2 2.7-3 4-3s2.7 1 4 3" />
    <path d="M18 4l-3 4M21 6l-4 3" />
  </Svg>
);

/* ════════════════════════ ANALYSIS — draft / thickness ════════════════════════ */

// Draft-analysis — a molded part with the pull/draw direction arrow and
// the draft angle wedge measured off the wall.
export const DraftAnalysis = (props) => (
  <Svg {...props}>
    <path d="M5 20l3-14h6l3 14z" />
    <path d="M8 6l-1 14M16 6l1 14" />
    <path d="M12 6V2M12 2l-2 2.2M12 2l2 2.2" />
    <path d="M8 11a4 4 0 0 0 1.5 2" />
  </Svg>
);

// Draft-faces — the faces selected for a draft feature, neutral plane +
// tapered face arrows.
export const DraftFaces = (props) => (
  <Svg {...props}>
    <path d="M6 6l3 13M18 6l-3 13" />
    <path d="M4 6h16" />
    <path d="M9 19h6" strokeDasharray="2 1.6" />
    <path d="M11 11l2 0M13 11l-1.2-1M13 11l-1.2 1" />
  </Svg>
);

// Undercut analysis — a part section with the trapped undercut region
// (where the mold can't release) flagged with hatching.
export const Undercut = (props) => (
  <Svg {...props}>
    <path d="M4 20V8l4-4h6v6h-4v4h8v6z" />
    <path d="M12 2v4M12 6l-1.6-1.6M12 6l1.6-1.6" />
    <path d="M5 17l2-2M7 19l3-3M9 19l2-2" />
  </Svg>
);

// Wall-thickness / wall-check — a hollow wall cross-section measured by a
// ball-gauge (the inscribed-sphere thickness probe).
export const WallThickness = (props) => (
  <Svg {...props}>
    <path d="M4 4v16M9 6v12" />
    <path d="M4 4h7M4 20h7" />
    <circle cx="14" cy="12" r="3" />
    <path d="M11 12h6M11 12l1.5-1.2M11 12l1.5 1.2M17 12l-1.5-1.2M17 12l-1.5 1.2" />
  </Svg>
);

// Thicken — a single surface given wall thickness into a solid shell.
export const Thicken = (props) => (
  <Svg {...props}>
    <path d="M4 8a10 10 0 0 1 16 0" />
    <path d="M4 12a10 10 0 0 1 16 0" />
    <path d="M4 8v4M20 8v4" />
    <path d="M12 16v4M12 20l-1.6-1.8M12 20l1.6-1.8" />
  </Svg>
);

/* ════════════════════════ ANALYSIS — section / slice ════════════════════════ */

// Section-analysis / section-view — a cutting plane slicing a solid, the
// exposed cut face hatched.
export const SectionView = (props) => (
  <Svg {...props}>
    <path d="M7 6l8-3v12l-8 3z" />
    <path d="M3 9l8-3M3 18l8-3M3 9v9" />
    <path d="M15 3l4 1.5v12L15 15" strokeDasharray="2.5 2" />
    <path d="M7 7.5l8-3M7 10l8-3M7 12.5l8-3" />
  </Svg>
);

// Slice — a stack of parallel section planes cutting a body into layers
// (the layer/slicing operation).
export const Slice = (props) => (
  <Svg {...props}>
    <path d="M6 4l12-1v18L6 22z" />
    <path d="M3 6l12-1M3 12l12-1M3 18l12-1" strokeDasharray="2.5 2" />
    <path d="M6 4l12-1M6 13l12-1M6 22l12-1" />
  </Svg>
);

/* ════════════════════════ ANALYSIS — deviation / compare ════════════════════════ */

// Deviation / compare (Hausdorff) — a nominal surface overlaid on a
// probed one with the gap-distance Δ band measured between them.
export const Deviation = (props) => (
  <Svg {...props}>
    <path d="M3 8a10 10 0 0 1 18 0" />
    <path d="M3 14a10 10 0 0 1 18 0" strokeDasharray="2.5 2" />
    <path d="M8 5.6v5.6M14 5v5.7M19 8.4v6" />
    <path d="M12 18l2 3-4 0z" />
  </Svg>
);

// Compare-part — two part outlines overlaid with the changed/diff region
// highlighted (the model-compare op).
export const ComparePart = (props) => (
  <Svg {...props}>
    <path d="M4 5h9v9H4z" />
    <path d="M11 11h9v9h-9z" strokeDasharray="2.5 2" />
    <path d="M11 11h2v2h-2z" />
  </Svg>
);

// Interference / clearance — two solids overlapping with the clashing
// volume between them flagged.
export const Interference = (props) => (
  <Svg {...props}>
    <path d="M3 6h9v9H3z" />
    <path d="M9 12l9-3v9l-9 3z" />
    <path d="M9 12l3-1M9 15l3-1" />
    <path d="M9 6.5l1.2 2.6 2.6.2-2 1.7.6 2.5-2.4-1.4-2.4 1.4.6-2.5-2-1.7 2.6-.2z" strokeDasharray="0" />
  </Svg>
);

/* ════════════════════════ POINTS — hull / cloud / scan ════════════════════════ */

// Convex-hull — a scattered point set wrapped in its taut convex envelope.
export const ConvexHull = (props) => (
  <Svg {...props}>
    <path d="M7 3l11 4 2 8-7 6-9-4 1-9z" />
    <path d="M7 3h0M18 7h0M20 15h0M13 21h0M4 17h0M5 8h0M11 9h0M14 13h0" />
  </Svg>
);

// Point-cloud — a scattered dot field with a bounding box, the imported
// scan-point set.
export const PointCloud = (props) => (
  <Svg {...props}>
    <path d="M3 4h18v16H3z" strokeDasharray="2.5 2" />
    <path d="M7 8h0M11 6.5h0M16 9h0M9 12h0M14 13h0M18 15h0M6 16h0M11 17h0M15 18h0M8 11h0M13 9.5h0M17 11.5h0" />
  </Svg>
);

// Scan-to-mesh — a dot cloud (left) reconstructed into a triangle mesh
// (right) with a transform arrow between (Poisson/BPA surface recon).
export const ScanToMesh = (props) => (
  <Svg {...props}>
    <path d="M3 6h0M3 11h0M3 16h0M6 8h0M6 13h0M5 4h0M5 19h0" />
    <path d="M8 12h3M11 12l-1.4-1.4M11 12l-1.4 1.4" />
    <path d="M17.5 4l-4.5 8h9z" />
    <path d="M17.5 4v8M14.8 8h5.4" />
  </Svg>
);

// Mesh-to-solid — a triangle mesh (left) converted into a BRep solid cube
// (right) with the transform arrow (knit/BRep reconstruction).
export const MeshToSolid = (props) => (
  <Svg {...props}>
    <path d="M3 5l4 7-4 0zM3 12l4 0 0 5z" />
    <path d="M3 5l4 0 0 7M7 12l-4 5" />
    <path d="M9 12h3M12 12l-1.4-1.4M12 12l-1.4 1.4" />
    <path d="M14 8l4-2 4 2v6l-4 2-4-2z" />
    <path d="M14 8l4 2 4-2M18 10v6" />
  </Svg>
);

/* ════════════════════════ id → component map ════════════════════════ */

const icons = {
  /* tessellate */
  'tessellate': Tessellate,
  'part.tessellate': Tessellate,
  'mesh.tessellate': Tessellate,
  'tessellation': Tessellate,
  'solid-to-mesh': Tessellate,
  'solidToMesh': Tessellate,
  'tessellate-native': TessellateNative,
  'tessellateNativeBody': TessellateNative,
  'mesh.tessellateNative': TessellateNative,

  /* decimate / reduce */
  'decimate': Decimate,
  'reduce': Decimate,
  'decimate-reduce': Decimate,
  'decimateQEM': Decimate,
  'mesh.decimate': Decimate,
  'reduce-mesh': Decimate,
  'reduceMesh': Decimate,
  'qem': Decimate,
  'simplify-clustering': SimplifyClustering,
  'simplifyClustering': SimplifyClustering,
  'mesh.simplify': SimplifyClustering,
  'cluster-simplify': SimplifyClustering,

  /* remesh */
  'remesh': Remesh,
  'remeshUniform': Remesh,
  'mesh.remesh': Remesh,
  'uniform-remesh': Remesh,
  'retopology': Remesh,
  'retopo': Remesh,

  /* repair / heal / fill-holes / weld */
  'repair': Repair,
  'mesh-repair': Repair,
  'meshRepair': Repair,
  'repair-self-intersect': Repair,
  'repairSelfIntersect': Repair,
  'mesh.repair': Repair,
  'fix': Repair,
  'fill-holes': FillHoles,
  'fillHoles': FillHoles,
  'fill-hole': FillHoles,
  'fillHole': FillHoles,
  'mesh.fillHoles': FillHoles,
  'close-holes': FillHoles,
  'heal': HealAutoFill,
  'heal-auto-fill': HealAutoFill,
  'heal.auto-fill': HealAutoFill,
  'autoFillMissingFaces': HealAutoFill,
  'heal-fill': HealAutoFill,
  'heal-auto-repair': HealAutoRepair,
  'heal.auto-repair': HealAutoRepair,
  'autoRepairSelfIntersection': HealAutoRepair,
  'heal-repair': HealAutoRepair,
  'heal-harmonize-normals': HarmonizeNormals,
  'heal.harmonize-normals': HarmonizeNormals,
  'harmonizeNormals': HarmonizeNormals,
  'harmonize-normals': HarmonizeNormals,
  'unify-normals': HarmonizeNormals,
  'recompute-normals': HarmonizeNormals,
  'sew': Sew,
  'heal-sew': Sew,
  'heal.sew': Sew,
  'sewShape': Sew,
  'stitch': Sew,
  'weld': WeldMesh,
  'weld-vertices': WeldMesh,
  'weldVertices': WeldMesh,
  'merge-vertices': WeldMesh,
  'weld-bead': WeldMesh,
  'mesh.weld': WeldMesh,
  'heal-simplify': HealSimplify,
  'heal.simplify': HealSimplify,
  'simplifyShape': HealSimplify,
  'heal-check-validity': CheckValidity,
  'heal.check-validity': CheckValidity,
  'check-validity': CheckValidity,
  'checkValidity': CheckValidity,
  'check-geometry': CheckValidity,
  'check-mesh': CheckValidity,
  'forge.heal.checkValidity': CheckValidity,

  /* smooth */
  'smooth': Smooth,
  'mesh.smooth': Smooth,
  'smooth-laplacian': Smooth,
  'smoothLaplacian': Smooth,
  'laplacian-smooth': Smooth,
  'relax': Smooth,
  'shade-smooth': Smooth,
  'smooth-taubin': SmoothTaubin,
  'smoothTaubin': SmoothTaubin,
  'taubin-smooth': SmoothTaubin,
  'taubin': SmoothTaubin,

  /* subdivide */
  'subdivide': Subdivide,
  'subdivision': Subdivide,
  'mesh.subdivide': Subdivide,
  'subdiv': Subdivide,
  'subdivide-loop': SubdivideLoop,
  'subdivideLoop': SubdivideLoop,
  'mesh.subdiv.loop': SubdivideLoop,
  'loop-subdivide': SubdivideLoop,
  'subdivide-cc': SubdivideCatmullClark,
  'subdivideCatmullClark': SubdivideCatmullClark,
  'mesh.subdiv.cc': SubdivideCatmullClark,
  'catmull-clark': SubdivideCatmullClark,
  'catmullClark': SubdivideCatmullClark,

  /* offset / boolean */
  'offset-mesh': OffsetMesh,
  'offsetMesh': OffsetMesh,
  'mesh-offset': OffsetMesh,
  'mesh.offset': OffsetMesh,
  'offset-surface': OffsetSurface,
  'offsetSurface': OffsetSurface,
  'surface-offset': OffsetSurface,
  'thicken': Thicken,
  'thicken-surface': Thicken,
  'mesh-boolean': MeshBoolean,
  'meshBoolean': MeshBoolean,
  'mesh.boolean': MeshBoolean,
  'boolean-mesh': MeshBoolean,
  'mesh-csg': MeshBoolean,

  /* curvature / reflection */
  'curvature-display': CurvatureComb,
  'curvatureDisplay': CurvatureComb,
  'curvature': CurvatureComb,
  'curvature-comb': CurvatureComb,
  'curvatureComb': CurvatureComb,
  'curvature-comb-update': CurvatureComb,
  'comb': CurvatureComb,
  'porcupine': CurvatureComb,
  'zebra': Zebra,
  'zebra-stripes': Zebra,
  'zebraStripes': Zebra,
  'zebra-analysis': Zebra,
  'reflection': Zebra,
  'reflection-analysis': Zebra,
  'reflection-line': ReflectionLine,
  'reflectionLine': ReflectionLine,
  'reflection-lines': ReflectionLine,
  'light-line': ReflectionLine,
  'light-lines': ReflectionLine,
  'lightLine': ReflectionLine,
  'isophote': ReflectionLine,
  'isophotes': ReflectionLine,

  /* draft / thickness */
  'draft-analysis': DraftAnalysis,
  'draftAnalysis': DraftAnalysis,
  'archdiscDraftAnalysis': DraftAnalysis,
  'draft-analysis-toggle': DraftAnalysis,
  'draft-faces': DraftFaces,
  'draftFaces': DraftFaces,
  'part.draft-faces': DraftFaces,
  'draft': DraftFaces,
  'undercut': Undercut,
  'undercut-analysis': Undercut,
  'undercutAnalysis': Undercut,
  'thickness': WallThickness,
  'wall-thickness': WallThickness,
  'wallThickness': WallThickness,
  'wall-check': WallThickness,
  'wallCheck': WallThickness,
  'thickness-check': WallThickness,
  'thickness-analysis': WallThickness,

  /* section / slice */
  'section-analysis': SectionView,
  'sectionAnalysis': SectionView,
  'section-view': SectionView,
  'sectionView': SectionView,
  'section': SectionView,
  'cross-section': SectionView,
  'crossSection': SectionView,
  'slice': Slice,
  'slicer': Slice,
  'mesh.slice': Slice,
  'layer-slice': Slice,
  'sliceStack': Slice,

  /* deviation / compare */
  'deviation': Deviation,
  'deviation-compare': Deviation,
  'deviationCompare': Deviation,
  'hausdorff': Deviation,
  'deviation-heatmap': Deviation,
  'deviationHeatmap': Deviation,
  'surface-deviation': Deviation,
  'compare': ComparePart,
  'compare-part': ComparePart,
  'comparePart': ComparePart,
  'compare-drawing': ComparePart,
  'compare-bom': ComparePart,
  'model-compare': ComparePart,
  'interference': Interference,
  'interference-detection': Interference,
  'clash': Interference,
  'clearance': Interference,
  'clearance-verification': Interference,

  /* points / hull / cloud / scan */
  'convex-hull': ConvexHull,
  'convexHull': ConvexHull,
  'mesh.convexHull': ConvexHull,
  'hull': ConvexHull,
  'bounding-hull': ConvexHull,
  'point-cloud': PointCloud,
  'pointCloud': PointCloud,
  'pointcloud': PointCloud,
  'pointcloud-import': PointCloud,
  'import-point-cloud': PointCloud,
  'cmm-import': PointCloud,
  'cmmImport': PointCloud,
  'scan-import': PointCloud,
  'scan-to-mesh': ScanToMesh,
  'scanToMesh': ScanToMesh,
  'cloud-to-mesh': ScanToMesh,
  'cloudToMesh': ScanToMesh,
  'reconstruct-surface': ScanToMesh,
  'poisson-reconstruct': ScanToMesh,
  'reverse-engineer': ScanToMesh,
  'mesh-to-solid': MeshToSolid,
  'meshToSolid': MeshToSolid,
  'meshToSolidViaStl': MeshToSolid,
  'mesh.toSolid': MeshToSolid,
  'mesh-to-brep': MeshToSolid,
  'meshToSurface': MeshToSolid,
};

export default icons;
