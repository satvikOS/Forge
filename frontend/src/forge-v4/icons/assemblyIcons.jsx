// ============================================================================
// Forge V4 — ASSEMBLY icon set
// ----------------------------------------------------------------------------
// Hand-authored, monochrome (currentColor), Siemens-NX / Dassault-CATIA /
// SolidWorks toolbar-grade glyphs for every assembly operation surfaced in the
// app. Each glyph is a literal, recognizable depiction of its operation the way
// a professional MCAD toolbar draws it:
//
//   insert-component   = a part dropping into the assembly with a "+" badge
//   new-component      = an empty in-context part cube with a sketch profile
//   mate (coincident)  = two faces snapping flat together
//   mate (concentric)  = two bores sharing one axis (nested rings)
//   mate (distance)    = two parts held apart by a dimension
//   mate (angle)       = two faces at an angular constraint with a sweep arc
//   mate (parallel)    = two parallel faces with the ∥ symbol
//   mate (tangent)     = a cylinder kissing a flat (tangency point)
//   mate (width)       = a tab centered symmetrically in a slot
//   mate (gear)        = two meshing gears (ratio coupling)
//   mate (cam)         = a cam lobe driving a follower
//   move-component     = a part translated along XYZ arrows
//   rotate-component   = a part swept about an axis
//   explode / collapse = parts blown apart / drawn back together
//   exploded-view      = the canonical exploded stack with trace lines
//   interference-detect= two solids overlapping, the clash volume marked
//   clearance          = a measured gap between two parts
//   bom                = a numbered bill-of-materials table
//   joint              = a pin/revolute joint between two links
//   ground / fix       = a part pinned to a ground/anchor symbol
//   pattern-component  = one component repeated on a grid
//   replace-component  = one part swapped for another (cycle arrows)
//
// Standard (identical for EVERY icon, in EVERY category):
//   <svg viewBox="0 0 24 24" width={size||18} height={size||18}
//        fill="none" stroke="currentColor" strokeWidth={1.5}
//        strokeLinecap="round" strokeLinejoin="round" {...props}>
//   Content kept within x,y ∈ [2,22] (2px safe padding). No fills/colors.
//   Consistent visual weight + complexity. Pure presentational — no logic.
//
// The default export is a map  { '<toolId>': Component }  whose keys match the
// REAL command / tool ids used in the app (ForgeToolBridge.js +
// forge-v4 registries), plus sensible aliases so every call site resolves.
// Each component is ALSO a named export.
// ============================================================================

import React from 'react';

// Shared SVG frame so every glyph is pixel-identical in box, stroke + caps.
const S = ({ children, size, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    width={size || props.width || 18}
    height={size || props.height || 18}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.5}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    {children}
  </svg>
);

// ─────────────────────────────────────────────────────────────────────────────
// INSERT COMPONENT — an existing part dropping into the assembly, "+" badge.
// (assembly.add-instance)
// ─────────────────────────────────────────────────────────────────────────────
export const InsertComponentIcon = (props) => (
  <S {...props}>
    {/* host assembly cube (light) */}
    <path d="M3 14l5-2.6 5 2.6-5 2.6z" />
    <path d="M3 14v3.2l5 2.6 5-2.6V14" />
    <path d="M8 16.6v5.2" />
    {/* incoming part dropping in */}
    <path d="M14 4.5l4 2 4-2-4-2z" />
    <path d="M14 4.5v3l4 2 4-2v-3" />
    <path d="M18 6.5v3" />
    <path d="M10 9l5.5 1.5" strokeDasharray="2 2" />
    {/* + badge */}
    <path d="M18 13v3M16.5 14.5h3" />
  </S>
);

// ─────────────────────────────────────────────────────────────────────────────
// NEW COMPONENT — author a brand-new part in-context (empty cube + sketch start)
// ─────────────────────────────────────────────────────────────────────────────
export const NewComponentIcon = (props) => (
  <S {...props}>
    <path d="M5 8l7-3.5L19 8l-7 3.5z" />
    <path d="M5 8v7l7 3.5 7-3.5V8" />
    <path d="M12 11.5V19" />
    {/* "new" star/sketch profile on the top face */}
    <path d="M12 6.4v3M10.5 7.9h3" />
    <path d="M19 4.5v3M17.5 6h3" />
  </S>
);

// ─────────────────────────────────────────────────────────────────────────────
// MATE — generic constraint: two parts snapping with a constraint glyph.
// (assembly.add-mate, matesolver)
// ─────────────────────────────────────────────────────────────────────────────
export const MateIcon = (props) => (
  <S {...props}>
    <path d="M3 6h6v12H3z" />
    <path d="M15 6h6v12h-6z" />
    {/* snap / constraint link */}
    <path d="M9 12h6" />
    <path d="M11 10l-2 2 2 2M13 10l2 2-2 2" />
  </S>
);

// COINCIDENT — two faces snapping flat together (the planes coincide).
export const MateCoincidentIcon = (props) => (
  <S {...props}>
    <path d="M4 5l5 2.5v9L4 14z" />
    <path d="M20 5l-5 2.5v9l5-2.5z" />
    {/* coincident contact plane */}
    <path d="M12 4v16" strokeDasharray="2 2" />
    <path d="M9 9l3 0M12 9l3 0" />
    <path d="M9 13l3 0M12 13l3 0" />
  </S>
);

// CONCENTRIC — two bores sharing a common axis (nested rings).
export const MateConcentricIcon = (props) => (
  <S {...props}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.5" />
    <circle cx="12" cy="12" r="1" />
    {/* axis crosshair */}
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeDasharray="2 2" />
  </S>
);

// DISTANCE — two parts held apart by a dimension value.
export const MateDistanceIcon = (props) => (
  <S {...props}>
    <path d="M4 5v14M20 5v14" />
    {/* dimension line between */}
    <path d="M4 12h16" />
    <path d="M7 9.5L4 12l3 2.5M17 9.5l3 2.5-3 2.5" />
  </S>
);

// ANGLE — two faces meeting at an angular constraint, sweep arc.
export const MateAngleIcon = (props) => (
  <S {...props}>
    <path d="M5 19h15" />
    <path d="M5 19L18 6" />
    {/* angle sweep arc + tick */}
    <path d="M5 19A12 12 0 0 1 12 9.5" strokeDasharray="2 2" />
    <path d="M12.5 12.5l1.5 .6M11 14.5l1.5 .6" />
  </S>
);

// PARALLEL — two parallel faces with the ∥ symbol.
export const MateParallelIcon = (props) => (
  <S {...props}>
    <path d="M5 4L9 6v14l-4-2z" />
    <path d="M19 4l-4 2v14l4-2z" />
    {/* ∥ symbol */}
    <path d="M11 9v6M13 9v6" />
  </S>
);

// PERPENDICULAR — two faces at 90° with the ⊥ symbol.
export const MatePerpendicularIcon = (props) => (
  <S {...props}>
    <path d="M6 4v16M6 20h14" />
    {/* right-angle square */}
    <path d="M6 15h5v5" />
    <path d="M9.2 17.8v-1.6h1.6" />
  </S>
);

// TANGENT — a cylinder kissing a flat (single tangency contact point).
export const MateTangentIcon = (props) => (
  <S {...props}>
    <path d="M4 18h16" />
    <circle cx="12" cy="11" r="6" />
    {/* tangency contact mark */}
    <path d="M12 18v-1" />
    <circle cx="12" cy="18" r="0.8" />
  </S>
);

// WIDTH — a tab centered symmetrically inside a slot/pocket.
export const MateWidthIcon = (props) => (
  <S {...props}>
    {/* outer slot */}
    <path d="M3 5h18v14H3z" />
    {/* centered tab */}
    <path d="M10 8h4v8h-4z" />
    {/* symmetric centering dims */}
    <path d="M3 12h7M14 12h7" strokeDasharray="2 2" />
    <path d="M12 5v14" strokeDasharray="2 2" />
  </S>
);

// GEAR — two meshing gears (gear-ratio coupling).
export const MateGearIcon = (props) => (
  <S {...props}>
    <circle cx="8" cy="9" r="4" />
    <path d="M8 4v-1.5M8 14v1.5M3.4 6.5L2 5.7M12.6 6.5L14 5.7M3.4 11.5L2 12.3M12.6 11.5L14 12.3" />
    <circle cx="16" cy="16" r="3" />
    <path d="M16 12.5V11M16 19.5V21M12.7 14.3l-1.2-.7M19.3 17.7l1.2 .7M12.7 17.7l-1.2 .7M19.3 14.3l1.2-.7" />
  </S>
);

// CAM — a cam lobe driving a follower.
export const MateCamIcon = (props) => (
  <S {...props}>
    {/* eccentric cam lobe */}
    <path d="M11 17a6 6 0 1 1 4.6-9.8L17 10z" />
    <circle cx="11" cy="11" r="1" />
    {/* follower riding the lobe */}
    <path d="M17 4v4l-1.5 1" />
    <circle cx="15.5" cy="9" r="1.2" />
  </S>
);

// ─────────────────────────────────────────────────────────────────────────────
// MOVE COMPONENT — a part translated along XYZ triad arrows.
// ─────────────────────────────────────────────────────────────────────────────
export const MoveComponentIcon = (props) => (
  <S {...props}>
    <path d="M7 11l4-2 4 2-4 2z" />
    <path d="M7 11v4l4 2 4-2v-4" />
    <path d="M11 13v6" />
    {/* translate arrows */}
    <path d="M11 9V3M9 5l2-2 2 2" />
    <path d="M16 15.5l4 2M18.5 16.2l1.5 1.3-2 .6" />
    <path d="M6 15.5l-4 2M5.5 16.2L4 17.5l2 .6" />
  </S>
);

// ─────────────────────────────────────────────────────────────────────────────
// ROTATE COMPONENT — a part swept about an axis (rotation arc + arrow).
// ─────────────────────────────────────────────────────────────────────────────
export const RotateComponentIcon = (props) => (
  <S {...props}>
    <path d="M8 13l4-2 4 2-4 2z" />
    <path d="M8 13v3l4 2 4-2v-3" />
    <path d="M12 15v5" />
    {/* rotation arc + arrowhead about the vertical axis */}
    <path d="M12 9V2" strokeDasharray="2 2" />
    <path d="M5 8a7 7 0 0 1 14 0" />
    <path d="M19 8l-2.4-1M19 8l-1 2.4" />
  </S>
);

// ─────────────────────────────────────────────────────────────────────────────
// EXPLODE — parts blown apart along their explode lines.
// ─────────────────────────────────────────────────────────────────────────────
export const ExplodeIcon = (props) => (
  <S {...props}>
    <path d="M10 10h4v4h-4z" />
    {/* four pieces flying outward */}
    <path d="M5 5h3v3H5z" /><path d="M9 9L6 6" strokeDasharray="2 2" />
    <path d="M16 5h3v3h-3z" /><path d="M15 9l3-3" strokeDasharray="2 2" />
    <path d="M5 16h3v3H5z" /><path d="M9 15l-3 3" strokeDasharray="2 2" />
    <path d="M16 16h3v3h-3z" /><path d="M15 15l3 3" strokeDasharray="2 2" />
  </S>
);

// COLLAPSE — parts drawn back together (inverse of explode).
export const CollapseIcon = (props) => (
  <S {...props}>
    <path d="M10 10h4v4h-4z" />
    {/* arrows pointing inward, parts at rest */}
    <path d="M4 4l4 4M8 8H5M8 8V5" />
    <path d="M20 4l-4 4M16 8h3M16 8V5" />
    <path d="M4 20l4-4M8 16H5M8 16v3" />
    <path d="M20 20l-4-4M16 16h3M16 16v3" />
  </S>
);

// ─────────────────────────────────────────────────────────────────────────────
// EXPLODED-VIEW — the canonical exploded stack with vertical trace lines.
// (tools.explode, explode)
// ─────────────────────────────────────────────────────────────────────────────
export const ExplodedViewIcon = (props) => (
  <S {...props}>
    {/* stacked, separated parts with a common centerline trace */}
    <path d="M12 3v18" strokeDasharray="2 2" />
    <path d="M7 5l5-1.5L17 5l-5 1.5z" />
    <path d="M7 11l5-1.5L17 11l-5 1.5z" />
    <path d="M7 17l5-1.5L17 17l-5 1.5z" />
  </S>
);

// ─────────────────────────────────────────────────────────────────────────────
// INTERFERENCE-DETECT — two solids overlapping; the clash volume marked.
// (assembly.detect-interference, tools.interfere, tools.interference)
// ─────────────────────────────────────────────────────────────────────────────
export const InterferenceDetectIcon = (props) => (
  <S {...props}>
    <path d="M3 8h9v9H3z" />
    <path d="M12 7h9v9h-9z" strokeDasharray="2 2" />
    {/* clash overlap region hatched */}
    <path d="M12 9l-3 3M12 12l-3 3M12 15l-2 2" />
  </S>
);

// ─────────────────────────────────────────────────────────────────────────────
// CLEARANCE — a measured gap between two parts.
// (assembly.query-aabb in clearance role)
// ─────────────────────────────────────────────────────────────────────────────
export const ClearanceIcon = (props) => (
  <S {...props}>
    <path d="M3 5v14M9 5v14" />
    <path d="M15 5v14M21 5v14" />
    {/* the measured gap between the two parts */}
    <path d="M9 12h6" />
    <path d="M11.5 9.5L9 12l2.5 2.5M12.5 9.5L15 12l-2.5 2.5" />
  </S>
);

// ─────────────────────────────────────────────────────────────────────────────
// BOM — a numbered bill-of-materials table.
// (tools.bom)
// ─────────────────────────────────────────────────────────────────────────────
export const BomIcon = (props) => (
  <S {...props}>
    <path d="M4 4h16v16H4z" />
    <path d="M9 4v16" />
    <path d="M4 9h16M4 14h16" />
    {/* item numbers in the first column */}
    <path d="M6.5 6v1.5M6 6.5l.5-.5M6 12h1M6 17h1" />
  </S>
);

// ─────────────────────────────────────────────────────────────────────────────
// BOM BALLOONS — auto-placed numbered balloons with leaders.
// (tools.bomBalloons)
// ─────────────────────────────────────────────────────────────────────────────
export const BomBalloonsIcon = (props) => (
  <S {...props}>
    {/* the part */}
    <path d="M4 13l5-2.5 5 2.5v5l-5 2.5-5-2.5z" />
    {/* numbered balloon with leader */}
    <circle cx="18" cy="6" r="3.5" />
    <path d="M18 4.5v3M16.7 5.7h2.6" />
    <path d="M15 8.5L11 12" />
  </S>
);

// ─────────────────────────────────────────────────────────────────────────────
// JOINT — a pin/revolute joint between two links.
// ─────────────────────────────────────────────────────────────────────────────
export const JointIcon = (props) => (
  <S {...props}>
    {/* two links pinned at a common pivot */}
    <path d="M3 8h8a3 3 0 0 1 0 6H3z" />
    <path d="M21 16h-8a3 3 0 0 1 0-6h8" />
    <circle cx="12" cy="11" r="2.2" />
    <circle cx="12" cy="11" r="0.6" />
  </S>
);

// ─────────────────────────────────────────────────────────────────────────────
// GROUND / FIX — a part pinned to a fixed ground/anchor.
// (assembly.set-fixed)
// ─────────────────────────────────────────────────────────────────────────────
export const GroundFixIcon = (props) => (
  <S {...props}>
    {/* the fixed part */}
    <path d="M7 4l5-1.5L17 4v6l-5 1.5L7 10z" />
    {/* ground hatch with anchor pin */}
    <path d="M12 11.5V15" />
    <path d="M5 15h14" />
    <path d="M6 15l-2 2M9 15l-2 2M12 15l-2 2M15 15l-2 2M18 15l-2 2" />
  </S>
);

// ─────────────────────────────────────────────────────────────────────────────
// PATTERN-COMPONENT — one component repeated across the assembly on a grid.
// ─────────────────────────────────────────────────────────────────────────────
export const PatternComponentIcon = (props) => (
  <S {...props}>
    {/* seed component (heavier) bottom-left + repeats on a grid */}
    <path d="M3 17l3-1.5L9 17v3l-3 1.5L3 20z" />
    <path d="M3 9l3-1.5L9 9v3l-3 1.5L3 12z" />
    <path d="M12 17l3-1.5 3 1.5v3l-3 1.5-3-1.5z" />
    <path d="M12 9l3-1.5 3 1.5v3l-3 1.5-3-1.5z" />
  </S>
);

// ─────────────────────────────────────────────────────────────────────────────
// REPLACE-COMPONENT — swap one part for another (cycle/swap arrows).
// ─────────────────────────────────────────────────────────────────────────────
export const ReplaceComponentIcon = (props) => (
  <S {...props}>
    {/* old part out */}
    <path d="M3 4h7v7H3z" />
    {/* new part in */}
    <path d="M14 13h7v7h-7z" />
    {/* swap arrows */}
    <path d="M11 6h6a2 2 0 0 1 2 2v2" />
    <path d="M13 18H7a2 2 0 0 1-2-2v-2" />
    <path d="M5 14l-1.3 1.5M5 14l1.3 1.5" />
    <path d="M19 10l1.3-1.5M19 10l-1.3-1.5" />
  </S>
);

// ─────────────────────────────────────────────────────────────────────────────
// MATE SOLVE — run the constraint solver (mate network + converge tick).
// (assembly.solve)
// ─────────────────────────────────────────────────────────────────────────────
export const MateSolveIcon = (props) => (
  <S {...props}>
    <path d="M4 6h6v6H4z" />
    <path d="M14 12h6v6h-6z" />
    {/* solved/linked + convergence check */}
    <path d="M10 9h2a2 2 0 0 1 2 2v1" />
    <path d="M5.5 15.5l1.5 1.5 3-3.5" />
  </S>
);

// ─────────────────────────────────────────────────────────────────────────────
// ASSEMBLY TREE — the structured assembly/sub-assembly hierarchy.
// (tools.assemblyTree)
// ─────────────────────────────────────────────────────────────────────────────
export const AssemblyTreeIcon = (props) => (
  <S {...props}>
    <path d="M5 4h5v4H5z" />
    <path d="M14 9h5v4h-5z" />
    <path d="M14 16h5v4h-5z" />
    {/* tree branch connectors */}
    <path d="M7.5 8v10M7.5 11h6.5M7.5 18h6.5" />
  </S>
);

// ─────────────────────────────────────────────────────────────────────────────
// ASSEMBLY (workbench) — the assembled product (component cubes joined).
// (tools.assembly)
// ─────────────────────────────────────────────────────────────────────────────
export const AssemblyIcon = (props) => (
  <S {...props}>
    <path d="M4 8l4-2 4 2-4 2z" />
    <path d="M4 8v5l4 2 4-2V8" />
    <path d="M8 10v5" />
    <path d="M14 12l3-1.5 3 1.5-3 1.5z" />
    <path d="M14 12v4l3 1.5 3-1.5v-4" />
    <path d="M17 13.5V18" />
  </S>
);

// ─────────────────────────────────────────────────────────────────────────────
// Map: tool/command id -> component. Keys match REAL app ids plus aliases.
// ─────────────────────────────────────────────────────────────────────────────
const assemblyIcons = {
  // Insert / create components
  'assembly.add-instance': InsertComponentIcon,
  'assembly.insert-component': InsertComponentIcon,
  'insert-component': InsertComponentIcon,
  'insertComponent': InsertComponentIcon,
  'addInstance': InsertComponentIcon,

  'new-component': NewComponentIcon,
  'newComponent': NewComponentIcon,
  'assembly.new-component': NewComponentIcon,

  // Mate — generic + per-kind (kinds match MateKind enum + MateSolverWorkbench)
  'assembly.add-mate': MateIcon,
  'add-mate': MateIcon,
  'mate': MateIcon,
  'matesolver': MateIcon,
  'mate-solver': MateIcon,

  'mate.coincident': MateCoincidentIcon,
  'mate-coincident': MateCoincidentIcon,
  'coincident': MateCoincidentIcon,

  'mate.concentric': MateConcentricIcon,
  'mate-concentric': MateConcentricIcon,
  'concentric': MateConcentricIcon,

  'mate.distance': MateDistanceIcon,
  'mate-distance': MateDistanceIcon,

  'mate.angle': MateAngleIcon,
  'mate-angle': MateAngleIcon,

  'mate.parallel': MateParallelIcon,
  'mate-parallel': MateParallelIcon,
  'parallel': MateParallelIcon,

  'mate.perpendicular': MatePerpendicularIcon,
  'mate-perpendicular': MatePerpendicularIcon,
  'perpendicular': MatePerpendicularIcon,

  'mate.tangent': MateTangentIcon,
  'mate-tangent': MateTangentIcon,
  'tangent': MateTangentIcon,

  'mate.width': MateWidthIcon,
  'mate-width': MateWidthIcon,

  'mate.gear': MateGearIcon,
  'mate-gear': MateGearIcon,
  'gear-mate': MateGearIcon,

  'mate.cam': MateCamIcon,
  'mate-cam': MateCamIcon,
  'cam-mate': MateCamIcon,

  // Move / rotate components
  'move-component': MoveComponentIcon,
  'moveComponent': MoveComponentIcon,
  'assembly.move-component': MoveComponentIcon,

  'rotate-component': RotateComponentIcon,
  'rotateComponent': RotateComponentIcon,
  'assembly.rotate-component': RotateComponentIcon,

  // Explode / collapse / exploded-view
  'explode': ExplodedViewIcon,
  'tools.explode': ExplodedViewIcon,
  'exploded-view': ExplodedViewIcon,
  'explodedView': ExplodedViewIcon,
  'explode-burst': ExplodeIcon,
  'collapse': CollapseIcon,
  'unexplode': CollapseIcon,

  // Interference / clearance
  'assembly.detect-interference': InterferenceDetectIcon,
  'detect-interference': InterferenceDetectIcon,
  'interference-detect': InterferenceDetectIcon,
  'tools.interfere': InterferenceDetectIcon,
  'tools.interference': InterferenceDetectIcon,
  'interference': InterferenceDetectIcon,

  'clearance': ClearanceIcon,
  'assembly.query-aabb': ClearanceIcon,
  'clearance-check': ClearanceIcon,

  // BOM
  'bom': BomIcon,
  'tools.bom': BomIcon,
  'bill-of-materials': BomIcon,
  'tools.bomBalloons': BomBalloonsIcon,
  'bom-balloons': BomBalloonsIcon,

  // Joint
  'joint': JointIcon,
  'assembly.joint': JointIcon,
  'add-joint': JointIcon,

  // Ground / fix
  'assembly.set-fixed': GroundFixIcon,
  'set-fixed': GroundFixIcon,
  'ground': GroundFixIcon,
  'fix': GroundFixIcon,
  'ground-fix': GroundFixIcon,
  'fix-component': GroundFixIcon,

  // Pattern / replace components
  'pattern-component': PatternComponentIcon,
  'patternComponent': PatternComponentIcon,
  'component-pattern': PatternComponentIcon,

  'replace-component': ReplaceComponentIcon,
  'replaceComponent': ReplaceComponentIcon,
  'assembly.replace-component': ReplaceComponentIcon,

  // Solve + structure
  'assembly.solve': MateSolveIcon,
  'solve': MateSolveIcon,
  'mate-solve': MateSolveIcon,

  'tools.assemblyTree': AssemblyTreeIcon,
  'assembly-tree': AssemblyTreeIcon,
  'subassembly': AssemblyTreeIcon,

  'tools.assembly': AssemblyIcon,
  'assembly': AssemblyIcon,
};

export default assemblyIcons;
