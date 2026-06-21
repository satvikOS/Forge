// Forge — hand-authored 2D SKETCH icon set (Siemens-NX / Dassault-CATIA /
// SolidWorks toolbar quality).
//
// Every glyph is drawn on a 24×24 grid with a 1.5 px stroke, monochrome
// (`currentColor` only — no fills except deliberate solid dots/markers that
// read as "points"/"vertices" the way a real CAD toolbar draws them), and
// kept inside the [2,22] safe box (2 px padding). Each icon is UNIQUE and
// literally depicts its sketch operation the way a professional MCAD toolbar
// does — a real engineer recognises the op from the glyph alone:
//
//   line          two endpoints + the segment between them
//   polyline      a multi-segment chain of vertices
//   arc           a swept arc with its centre + two endpoints
//   circle        a ring with a centre-mark cross
//   ellipse       an oval with its two axes
//   rectangle     a box drawn from a corner-pick handle
//   polygon       a regular hexagon with its inscribing construction ring
//   slot          a stadium (two arcs + two parallel sides) on its centreline
//   spline        a smooth fitted curve through its fit-points
//   point         a dotted target marker
//   offset        a profile parallelled outward with an offset arrow
//   trim          a curve with a clipped (scissored) middle segment
//   extend        a curve lengthened to a target boundary by an arrow
//   mirror        two profiles flipped about a dashed symmetry line
//   fillet-2d     a square corner rounded, the radius shown
//   chamfer-2d    a square corner cut by a bevel, the chamfer shown
//   dimension     a witness/extension + arrowed dimension line
//   constraints   the canonical SolidWorks-style relation glyphs
//   project       a 3D edge dropped onto the sketch plane
//   convert       a model edge harvested into a sketch curve
//   construction  a dashed centre/reference line
//   start-sketch  a profile on a plane with the "new sketch" pencil
//   sketch-on-face a profile placed on a highlighted solid face
//
// API CONTRACT (matches every other Forge category icon file):
//   • default export: a map  { '<toolId>': (props) => (<svg .../>) }
//   • named export: each component (PascalCase) for direct import
//   • each component renders:
//       <svg viewBox="0 0 24 24" width={props.size||18} height={props.size||18}
//            fill="none" stroke="currentColor" strokeWidth={1.5}
//            strokeLinecap="round" strokeLinejoin="round" {...props}>
//
// Pure presentational — NO behaviour, NO logic, NO external icon library.
//
// Id keys cover the REAL command/tool ids used across the app:
//   • the canonical `sketch.*` icon namespace (Icon.jsx / Menus.jsx / BodyContextMenu.jsx)
//   • the `draft.*` 2D-sketcher tool ids (draftDispatch.js DRAFT_*_TOOLS)
//   • the `sketch.add-*` / `sketch.solve` bridge verbs (ForgeToolBridge.js)
//   • the PLANEGCS constraint kinds (SketchConstraintsExtendedPanel.jsx)
//   • bare + alias forms (line, circle, fillet2d, dim.radial, …) for callers
//     that key on the short op name.

import React from 'react';

// ───────────────────────── shared svg shell ─────────────────────────
// One wrapper guarantees identical viewBox / stroke / linecap / weight on
// every glyph — the single biggest reason a set reads as "pro" not "random".
function Svg({ size, children, ...rest }) {
  return (
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
}

// A small solid endpoint/vertex marker — the way CAD toolbars indicate a
// pickable sketch point. Kept tiny + consistent across glyphs.
const Dot = ({ cx, cy, r = 1.3 }) => (
  <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
);

// ════════════════════════════════════════════════════════════════════
//  ENTITY / CURVE TOOLS
// ════════════════════════════════════════════════════════════════════

// LINE — two endpoints joined by a segment.
export const LineIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <line x1="4" y1="20" x2="20" y2="4" />
    <Dot cx="4" cy="20" />
    <Dot cx="20" cy="4" />
  </Svg>
);

// POLYLINE — a connected chain of segments through several vertices.
export const PolylineIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M3 18L8 8l5 6 4-9 1.8 3.6" />
    <Dot cx="3" cy="18" />
    <Dot cx="8" cy="8" />
    <Dot cx="13" cy="14" />
    <Dot cx="17" cy="5" />
    <Dot cx="18.8" cy="8.6" />
  </Svg>
);

// WIRE — an open polyline of straight + arc segments (FreeCAD "Wire").
export const WireIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M3 19L9 11a3 3 0 0 1 4.5 0L19 5" />
    <Dot cx="3" cy="19" />
    <Dot cx="9" cy="11" />
    <Dot cx="19" cy="5" />
  </Svg>
);

// ARC (generic) — a swept arc with its centre and two endpoints.
export const ArcIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M4 18A12 12 0 0 1 20 6" />
    <line x1="6" y1="6" x2="4" y2="18" strokeDasharray="2 2" opacity="0.5" />
    <line x1="6" y1="6" x2="20" y2="6" strokeDasharray="2 2" opacity="0.5" />
    <Dot cx="4" cy="18" />
    <Dot cx="20" cy="6" />
    <Dot cx="6" cy="6" r="1.1" />
  </Svg>
);

// ARC — CENTRE / START / END (centre-point arc): centre + radius legs + sweep.
export const ArcCenterIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M5 19A14 14 0 0 1 19 9" />
    <line x1="12" y1="20" x2="5" y2="19" strokeDasharray="2 2" />
    <line x1="12" y1="20" x2="19" y2="9" strokeDasharray="2 2" />
    <Dot cx="12" cy="20" />
    <Dot cx="5" cy="19" />
    <Dot cx="19" cy="9" />
  </Svg>
);

// ARC — 3-POINT (start / end / on-arc): three pick points on the curve.
export const Arc3PointIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M4 17A13 13 0 0 1 20 8" />
    <Dot cx="4" cy="17" />
    <Dot cx="11.4" cy="9.6" />
    <Dot cx="20" cy="8" />
    <text x="13.5" y="20" fontSize="6" fill="currentColor" stroke="none" fontFamily="monospace">3</text>
  </Svg>
);

// CIRCLE — a ring with a centre-mark cross (CAD centre-point circle).
export const CircleIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 8.5v7M8.5 12h7" />
  </Svg>
);

// CIRCLE — CENTRE+RADIUS: ring + centre dot + a dashed radius leg.
export const CircleCenterIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <circle cx="11" cy="13" r="8" />
    <line x1="11" y1="13" x2="18" y2="9" strokeDasharray="2 2" />
    <Dot cx="11" cy="13" />
  </Svg>
);

// ELLIPSE — an oval with its major + minor axes drawn.
export const EllipseIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <ellipse cx="12" cy="12" rx="9" ry="6" />
    <path d="M3 12h18M12 6v12" strokeDasharray="2 2" />
    <Dot cx="12" cy="12" r="1.1" />
  </Svg>
);

// RECTANGLE — CORNER: a box with the dragged corner-pick handle shown.
export const RectangleIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <rect x="4" y="6" width="16" height="12" />
    <Dot cx="4" cy="6" />
    <Dot cx="20" cy="18" />
  </Svg>
);

// RECTANGLE — CENTRE: a box drawn from its centre, with the centre mark.
export const RectangleCenterIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <rect x="4" y="7" width="16" height="10" />
    <path d="M12 9.5v5M9.5 12h5" />
    <Dot cx="12" cy="12" r="1.1" />
  </Svg>
);

// POLYGON — a regular hexagon inside its inscribing construction circle.
export const PolygonIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M12 3.5l7.4 4.25v8.5L12 20.5l-7.4-4.25v-8.5z" />
    <circle cx="12" cy="12" r="8.5" strokeDasharray="2 2" />
    <Dot cx="12" cy="12" r="1.1" />
  </Svg>
);

// SLOT — a stadium (two semicircular ends + parallel sides) on its centreline.
export const SlotIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M8 6h8a6 6 0 0 1 0 12H8a6 6 0 0 1 0-12z" />
    <path d="M8 12h8" strokeDasharray="2 2" />
    <Dot cx="8" cy="12" />
    <Dot cx="16" cy="12" />
  </Svg>
);

// SPLINE — a smooth fitted curve through its fit-points.
export const SplineIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M3 17C7 5 10 19 13 11s5-6 8 4" />
    <Dot cx="3" cy="17" />
    <Dot cx="13" cy="11" />
    <Dot cx="21" cy="15" />
  </Svg>
);

// BEZIER — a curve with its control polygon + control handles.
export const BezierIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M4 19C4 9 20 15 20 5" />
    <path d="M4 19l4-6M20 5l-4 6" strokeDasharray="2 2" />
    <Dot cx="4" cy="19" />
    <Dot cx="8" cy="13" />
    <Dot cx="16" cy="11" />
    <Dot cx="20" cy="5" />
  </Svg>
);

// POINT — a dotted target marker (sketch point).
export const PointIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <circle cx="12" cy="12" r="6.5" strokeDasharray="2 2" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    <Dot cx="12" cy="12" r="1.8" />
  </Svg>
);

// ════════════════════════════════════════════════════════════════════
//  MODIFY TOOLS
// ════════════════════════════════════════════════════════════════════

// OFFSET — a profile parallelled outward, with the offset direction arrow.
export const OffsetIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M6 19V9a3 3 0 0 1 3-3h9" />
    <path d="M3 21V8a5 5 0 0 1 5-5h11" strokeDasharray="2.5 2" />
    <path d="M14 12l3 0M15.5 10.5L17 12l-1.5 1.5" />
  </Svg>
);

// TRIM — a curve with its middle segment scissored/clipped away.
export const TrimIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M3 12h6M15 12h6" />
    <path d="M9 8l2 4-2 4M15 8l-2 4 2 4" />
    <Dot cx="11" cy="12" r="1" />
    <Dot cx="13" cy="12" r="1" />
  </Svg>
);

// EXTEND — a curve lengthened to a target boundary by an arrow.
export const ExtendIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M4 12h9" />
    <path d="M13 12h6M16 9l3 3-3 3" strokeDasharray="2.5 2" />
    <path d="M21 5v14" />
    <Dot cx="4" cy="12" />
  </Svg>
);

// MIRROR — two profiles flipped about a dashed symmetry line.
export const MirrorIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M12 3v18" strokeDasharray="2.5 2" />
    <path d="M9 6L4 12l5 6V6z" />
    <path d="M15 6l5 6-5 6V6z" />
  </Svg>
);

// FILLET-2D — a square corner rounded, with the radius shown.
export const Fillet2dIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M5 20V12a7 7 0 0 1 7-7h8" />
    <path d="M5 5h7v7" strokeDasharray="2 2" opacity="0.55" />
    <line x1="12" y1="12" x2="8" y2="8" strokeDasharray="2 2" />
    <text x="6.5" y="11" fontSize="5.5" fill="currentColor" stroke="none" fontFamily="monospace">R</text>
  </Svg>
);

// CHAMFER-2D — a square corner cut by a bevel, the chamfer shown.
export const Chamfer2dIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M5 20V11l6-6h9" />
    <path d="M5 5h6v6" strokeDasharray="2 2" opacity="0.55" />
    <text x="6.2" y="10.5" fontSize="5" fill="currentColor" stroke="none" fontFamily="monospace">C</text>
  </Svg>
);

// MOVE — a sketch entity translated with a 4-way move arrow.
export const MoveIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <rect x="4" y="13" width="7" height="7" strokeDasharray="2 2" opacity="0.55" />
    <rect x="11" y="6" width="7" height="7" />
    <path d="M8 16l5-6M6 10l2 0v2M16 12l-2 0v-2" />
  </Svg>
);

// ROTATE — a sketch entity revolved about a centre by a sweep arrow.
export const RotateIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M6 7A9 9 0 1 1 5 14" />
    <path d="M6 3v4h4" />
    <Dot cx="12" cy="12" r="1.1" />
  </Svg>
);

// SCALE — a profile resized along a corner diagonal.
export const ScaleIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <rect x="5" y="5" width="8" height="8" strokeDasharray="2 2" opacity="0.55" />
    <rect x="5" y="5" width="14" height="14" />
    <path d="M13 13l5 5M14 18h4v-4" />
  </Svg>
);

// ARRAY · LINEAR — a feature repeated on a rectangular grid.
export const ArrayLinearIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <rect x="4" y="4" width="5" height="5" />
    <rect x="14" y="4" width="5" height="5" strokeDasharray="2 2" opacity="0.6" />
    <rect x="4" y="14" width="5" height="5" strokeDasharray="2 2" opacity="0.6" />
    <rect x="14" y="14" width="5" height="5" strokeDasharray="2 2" opacity="0.6" />
    <path d="M9 6.5h5M6.5 9v5" />
  </Svg>
);

// ARRAY · CIRCULAR — a feature repeated around a ring.
export const ArrayCircularIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <circle cx="12" cy="12" r="8" strokeDasharray="2.5 2.5" />
    <rect x="10" y="2.5" width="4" height="4" />
    <rect x="17.5" y="10" width="4" height="4" strokeDasharray="1.5 1.5" opacity="0.6" />
    <rect x="10" y="17.5" width="4" height="4" strokeDasharray="1.5 1.5" opacity="0.6" />
    <rect x="2.5" y="10" width="4" height="4" strokeDasharray="1.5 1.5" opacity="0.6" />
    <Dot cx="12" cy="12" r="1" />
  </Svg>
);

// ARRAY · ON PATH — a feature repeated along a curve.
export const ArrayPathIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M3 18C7 8 17 20 21 6" strokeDasharray="2.5 2" />
    <rect x="2" y="16" width="3.5" height="3.5" />
    <rect x="9.5" y="13" width="3.5" height="3.5" opacity="0.6" />
    <rect x="18.5" y="4.5" width="3.5" height="3.5" opacity="0.6" />
  </Svg>
);

// PROJECT — a 3D model edge dropped down onto the sketch plane.
export const ProjectIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M5 5l6 0 0 6" />
    <path d="M8 8v6M11 5v6" strokeDasharray="2 2" />
    <path d="M3 18h18" />
    <Dot cx="8" cy="18" />
    <Dot cx="11" cy="18" />
    <path d="M8 14l0 3M11 11l0 6" strokeDasharray="2 2" opacity="0.6" />
  </Svg>
);

// CONVERT ENTITIES — a model edge harvested into a sketch curve (overlay).
export const ConvertEntitiesIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M4 5h9a4 4 0 0 1 4 4v8" opacity="0.45" />
    <path d="M3 8h9a4 4 0 0 1 4 4v8" />
    <path d="M14 4l4 1-1 4" />
  </Svg>
);

// ════════════════════════════════════════════════════════════════════
//  ANNOTATION / DIMENSION TOOLS
// ════════════════════════════════════════════════════════════════════

// DIMENSION (generic / linear) — witness lines + arrowed dimension line.
export const DimensionIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M4 7v10M20 7v10" />
    <path d="M4 12h16" />
    <path d="M7 9l-3 3 3 3M17 9l3 3-3 3" />
  </Svg>
);

// DIMENSION — RADIAL: a circle with an arrowed radius callout + R.
export const DimensionRadialIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <circle cx="10" cy="13" r="7" />
    <path d="M10 13l9-6M13.5 8l5.5-1-1 5" />
    <Dot cx="10" cy="13" r="1" />
    <text x="14" y="20" fontSize="5.5" fill="currentColor" stroke="none" fontFamily="monospace">R</text>
  </Svg>
);

// DIMENSION — ANGULAR: two rays + a swept angle dimension arc.
export const DimensionAngularIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M5 19L20 19M5 19L18 7" />
    <path d="M14 19A9 9 0 0 0 11.5 12.7" />
    <path d="M11.5 14.4l1.5-1.7 1.8 1.2" />
  </Svg>
);

// DIMENSION — DIAMETER: a circle with a through-arrow diameter callout + Ø.
export const DimensionDiameterIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <circle cx="12" cy="11" r="7.2" />
    <path d="M5 11h14M8 8l-3 3 3 3M16 8l3 3-3 3" />
    <text x="9" y="22" fontSize="5.5" fill="currentColor" stroke="none" fontFamily="monospace">&#216;</text>
  </Svg>
);

// TEXT — an annotation "A" glyph on a baseline (sketch text).
export const TextIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M7 17l4-10 4 10M8.4 13.5h5.2" />
    <path d="M4 20h16" strokeDasharray="2 2" />
  </Svg>
);

// LABEL — a tag with a leader anchor dot.
export const LabelIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M4 6h11l4 5-4 5H4z" />
    <Dot cx="14.5" cy="11" r="1.1" />
    <path d="M7 11h4" />
  </Svg>
);

// LEADER — an arrow + landing line + note (callout leader).
export const LeaderIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M4 19l8-6" />
    <path d="M4 19l1-3.2 3 1.2" />
    <path d="M12 13h8M12 8h8" />
  </Svg>
);

// HATCH — a bounded region cross-hatched (section fill).
export const HatchIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <rect x="4" y="4" width="16" height="16" />
    <path d="M7 20l13-13M4 17l13-13M11 20l9-9M4 13l9-9M16 20l4-4M4 9l5-5" opacity="0.85" />
  </Svg>
);

// ════════════════════════════════════════════════════════════════════
//  GEOMETRIC CONSTRAINTS (PLANEGCS kinds — SketchConstraints*Panel.jsx)
// ════════════════════════════════════════════════════════════════════

// COINCIDENT — two points snapped to the same location.
export const CoincidentIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </Svg>
);

// PARALLEL — two like-direction lines with the ∥ mark.
export const ParallelIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M6 20L13 4M11 20L18 4" />
    <path d="M3.5 13.5l3-1M5 17l3-1" opacity="0.8" />
  </Svg>
);

// PERPENDICULAR — two lines meeting at 90° with the square mark.
export const PerpendicularIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M5 19h15M9 21V5" />
    <path d="M9 14h5v5" opacity="0.85" />
  </Svg>
);

// TANGENT — a line touching a circle at exactly one point.
export const TangentIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <circle cx="9" cy="13" r="6.5" />
    <path d="M15.5 4v18" />
    <Dot cx="15.5" cy="13" r="1.4" />
  </Svg>
);

// HORIZONTAL — a horizontal segment with the H relation mark.
export const HorizontalIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M3 14h18" />
    <Dot cx="3" cy="14" />
    <Dot cx="21" cy="14" />
    <path d="M8 4v6M14 4v6M8 7h6" />
  </Svg>
);

// VERTICAL — a vertical segment with the V relation mark.
export const VerticalIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M10 3v18" />
    <Dot cx="10" cy="3" />
    <Dot cx="10" cy="21" />
    <path d="M14 8l2.5 6L19 8" />
  </Svg>
);

// EQUAL — two entities forced equal, with the = mark.
export const EqualIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M3 7h7M3 11h7" />
    <path d="M14 13h7M14 17h7" />
    <path d="M5 14l1.5 4M16 4l1.5 4" opacity="0.55" />
  </Svg>
);

// CONCENTRIC — two circles sharing one centre.
export const ConcentricIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4" />
    <Dot cx="12" cy="12" r="1.1" />
  </Svg>
);

// SYMMETRIC — two points mirrored about a centreline (symmetry relation).
export const SymmetricIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M12 3v18" strokeDasharray="2.5 2" />
    <Dot cx="5" cy="9" r="2" />
    <Dot cx="19" cy="9" r="2" />
    <path d="M5 9h4M15 9h4" opacity="0.8" />
    <path d="M9 16h6" opacity="0.6" />
  </Svg>
);

// FIX — an entity locked/grounded (anchor relation).
export const FixIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <Dot cx="12" cy="6" r="2.2" />
    <path d="M12 8v6" />
    <path d="M5 14h14" />
    <path d="M7 14l-2 5M11 14l-1 5M15 14l1 5M19 14l2 5" opacity="0.8" />
  </Svg>
);

// POINT-ON-LINE — a point constrained to lie on a line.
export const PointOnLineIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M3 18L21 6" />
    <circle cx="12" cy="12" r="3.4" />
    <Dot cx="12" cy="12" r="1.4" />
  </Svg>
);

// POINT-ON-CURVE — a point constrained to lie on a curve/circle.
export const PointOnCurveIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M3 19C8 19 8 5 13 5s5 7 8 7" />
    <circle cx="13" cy="5" r="3.4" />
    <Dot cx="13" cy="5" r="1.4" />
  </Svg>
);

// ════════════════════════════════════════════════════════════════════
//  DIMENSIONAL CONSTRAINTS
// ════════════════════════════════════════════════════════════════════

// DISTANCE — a driving linear-distance dimension constraint.
export const DistanceIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M5 6v12M19 6v12" />
    <path d="M5 12h14M8 9l-3 3 3 3M16 9l3 3-3 3" />
  </Svg>
);

// ANGLE — a driving angular dimension constraint.
export const AngleIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M4 20h16M4 20L17 6" />
    <path d="M13 20A11 11 0 0 0 10 13" />
    <Dot cx="4" cy="20" r="1.1" />
  </Svg>
);

// DIAMETER — a driving diameter dimension constraint (Ø).
export const DiameterIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <circle cx="12" cy="12" r="8" />
    <path d="M5 19L19 5" />
    <text x="8.5" y="15" fontSize="8" fill="currentColor" stroke="none" fontFamily="monospace">&#216;</text>
  </Svg>
);

// RADIUS — a driving radius dimension constraint (R).
export const RadiusIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M4 20A16 16 0 0 1 20 4" />
    <path d="M4 20l16-16M16 4l4 0 0 4" />
    <Dot cx="4" cy="20" r="1.1" />
    <text x="9" y="14" fontSize="6" fill="currentColor" stroke="none" fontFamily="monospace">R</text>
  </Svg>
);

// CONSTRAIN (generic relation) — the lock-relation glyph used when the
// specific kind isn't known.
export const ConstrainIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M12 4v16" />
    <circle cx="12" cy="5" r="2" />
    <circle cx="12" cy="19" r="2" />
    <path d="M6 12h12" strokeDasharray="2 2" />
  </Svg>
);

// ════════════════════════════════════════════════════════════════════
//  CONSTRUCTION / SESSION / WORKFLOW
// ════════════════════════════════════════════════════════════════════

// CONSTRUCTION LINE — a dashed reference/centre line through two markers.
export const ConstructionLineIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M3 18L21 6" strokeDasharray="3 2.5" />
    <Dot cx="3" cy="18" r="1.1" />
    <Dot cx="21" cy="6" r="1.1" />
  </Svg>
);

// START SKETCH — a profile on a plane with the "new sketch" pencil.
export const StartSketchIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M3 16l6-3 9 4.5" opacity="0.55" />
    <path d="M3 16V9l6-3 9 4.5V18" opacity="0.55" />
    <path d="M13 21l-3 1 1-3 6.5-6.5 2 2L13 21z" />
  </Svg>
);

// SKETCH ON FACE — a profile placed on a highlighted solid face.
export const SketchOnFaceIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <path d="M4 8l6-3 10 4v8l-6 3-10-4V8z" />
    <path d="M4 8l10 4 6-3M14 12v8" opacity="0.45" />
    <rect x="6.5" y="8.5" width="5" height="4" transform="skewX(-18)" />
  </Svg>
);

// SOLVE — run the constraint solver (the checked/resolved sketch).
export const SolveIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M7.5 12.5l3 3 6-7" />
  </Svg>
);

// FINISH SKETCH — exit/accept the sketch (checked profile ring).
export const FinishIcon = ({ size, ...p }) => (
  <Svg size={size} {...p}>
    <circle cx="12" cy="12" r="9" strokeDasharray="3 2" />
    <path d="M8 12l2.5 2.5L16 8.5" />
  </Svg>
);

// ════════════════════════════════════════════════════════════════════
//  ID MAP — canonical `sketch.*` / `draft.*` / bridge / constraint ids
//  plus bare aliases.  Keys match the REAL ids used across the app.
// ════════════════════════════════════════════════════════════════════

const sketchIcons = {
  // ── canonical icon namespace (Icon.jsx / Menus.jsx / BodyContextMenu.jsx) ──
  'sketch.line':        LineIcon,
  'sketch.polyline':    PolylineIcon,
  'sketch.wire':        WireIcon,
  'sketch.arc':         ArcIcon,
  'sketch.arc.center':  ArcCenterIcon,
  'sketch.arc.3pt':     Arc3PointIcon,
  'sketch.circle':      CircleIcon,
  'sketch.circle.center': CircleCenterIcon,
  'sketch.ellipse':     EllipseIcon,
  'sketch.rect':        RectangleIcon,
  'sketch.rect.center': RectangleCenterIcon,
  'sketch.rectangle':   RectangleIcon,
  'sketch.polygon':     PolygonIcon,
  'sketch.slot':        SlotIcon,
  'sketch.spline':      SplineIcon,
  'sketch.bezier':      BezierIcon,
  'sketch.point':       PointIcon,
  'sketch.offset':      OffsetIcon,
  'sketch.trim':        TrimIcon,
  'sketch.extend':      ExtendIcon,
  'sketch.mirror':      MirrorIcon,
  'sketch.fillet':      Fillet2dIcon,
  'sketch.fillet2d':    Fillet2dIcon,
  'sketch.chamfer':     Chamfer2dIcon,
  'sketch.chamfer2d':   Chamfer2dIcon,
  'sketch.move':        MoveIcon,
  'sketch.rotate':      RotateIcon,
  'sketch.scale':       ScaleIcon,
  'sketch.array.linear':   ArrayLinearIcon,
  'sketch.array.circular': ArrayCircularIcon,
  'sketch.array.path':     ArrayPathIcon,
  'sketch.project':     ProjectIcon,
  'sketch.convert':     ConvertEntitiesIcon,
  'sketch.dim':         DimensionIcon,
  'sketch.dim.linear':  DimensionIcon,
  'sketch.dim.radial':  DimensionRadialIcon,
  'sketch.dim.radius':  DimensionRadialIcon,
  'sketch.dim.angular': DimensionAngularIcon,
  'sketch.dim.diameter': DimensionDiameterIcon,
  'sketch.text':        TextIcon,
  'sketch.label':       LabelIcon,
  'sketch.leader':      LeaderIcon,
  'sketch.hatch':       HatchIcon,
  'sketch.construction': ConstructionLineIcon,
  'sketch.constrain':   ConstrainIcon,
  'sketch.start':       StartSketchIcon,
  'sketch.onface':      SketchOnFaceIcon,
  'sketch.solve':       SolveIcon,
  'sketch.finish':      FinishIcon,

  // ── draft.* 2D-sketcher tool ids (draftDispatch.js DRAFT_*_TOOLS) ──
  'draft.line':         LineIcon,
  'draft.wire':         WireIcon,
  'draft.polyline':     PolylineIcon,
  'draft.spline':       SplineIcon,
  'draft.bezier':       BezierIcon,
  'draft.circle':       CircleIcon,
  'draft.arc':          ArcIcon,
  'draft.ellipse':      EllipseIcon,
  'draft.rectangle':    RectangleIcon,
  'draft.polygon':      PolygonIcon,
  'draft.point':        PointIcon,
  'draft.slot':         SlotIcon,
  'draft.move':         MoveIcon,
  'draft.rotate':       RotateIcon,
  'draft.scale':        ScaleIcon,
  'draft.offset':       OffsetIcon,
  'draft.array.linear':   ArrayLinearIcon,
  'draft.array.circular': ArrayCircularIcon,
  'draft.array.onpath':   ArrayPathIcon,
  'draft.mirror':       MirrorIcon,
  'draft.trim':         TrimIcon,
  'draft.extend':       ExtendIcon,
  'draft.fillet':       Fillet2dIcon,
  'draft.chamfer':      Chamfer2dIcon,
  'draft.text':         TextIcon,
  'draft.dimension':    DimensionIcon,
  'draft.label':        LabelIcon,
  'draft.leader':       LeaderIcon,
  'draft.hatch':        HatchIcon,
  'draft.project':      ProjectIcon,
  'draft.convert':      ConvertEntitiesIcon,
  'draft.construction': ConstructionLineIcon,

  // ── ForgeToolBridge.js sketch verbs ──
  'sketch.create':        StartSketchIcon,
  'sketch.add-point':     PointIcon,
  'sketch.add-line':      LineIcon,
  'sketch.add-circle':    CircleIcon,
  'sketch.add-arc':       ArcIcon,
  'sketch.add-rectangle': RectangleIcon,
  'sketch.add-spline':    SplineIcon,
  'sketch.add-constraint': ConstrainIcon,

  // ── PLANEGCS constraint kinds (SketchConstraints*Panel.jsx) ──
  Coincident:    CoincidentIcon,
  Parallel:      ParallelIcon,
  Perpendicular: PerpendicularIcon,
  Tangent:       TangentIcon,
  Horizontal:    HorizontalIcon,
  Vertical:      VerticalIcon,
  Equal:         EqualIcon,
  Concentric:    ConcentricIcon,
  Symmetric:     SymmetricIcon,
  Fix:           FixIcon,
  PointOnLine:   PointOnLineIcon,
  PointOnCircle: PointOnCurveIcon,
  Distance:      DistanceIcon,
  Angle:         AngleIcon,
  Diameter:      DiameterIcon,
  Radius:        RadiusIcon,

  // constraint kinds — lowercase + dotted aliases
  'constraint.coincident':    CoincidentIcon,
  'constraint.parallel':      ParallelIcon,
  'constraint.perpendicular': PerpendicularIcon,
  'constraint.tangent':       TangentIcon,
  'constraint.horizontal':    HorizontalIcon,
  'constraint.vertical':      VerticalIcon,
  'constraint.equal':         EqualIcon,
  'constraint.concentric':    ConcentricIcon,
  'constraint.symmetric':     SymmetricIcon,
  'constraint.fix':           FixIcon,
  'constraint.pointOnLine':   PointOnLineIcon,
  'constraint.pointOnCurve':  PointOnCurveIcon,
  'constraint.distance':      DistanceIcon,
  'constraint.angle':         AngleIcon,
  'constraint.diameter':      DiameterIcon,
  'constraint.radius':        RadiusIcon,

  // ── bare op-name aliases (callers keyed on the short op) ──
  line:          LineIcon,
  polyline:      PolylineIcon,
  wire:          WireIcon,
  arc:           ArcIcon,
  'arc-center':  ArcCenterIcon,
  'arc-3pt':     Arc3PointIcon,
  circle:        CircleIcon,
  'circle-center': CircleCenterIcon,
  ellipse:       EllipseIcon,
  rectangle:     RectangleIcon,
  'rectangle-center': RectangleCenterIcon,
  polygon:       PolygonIcon,
  slot:          SlotIcon,
  spline:        SplineIcon,
  bezier:        BezierIcon,
  point:         PointIcon,
  offset:        OffsetIcon,
  trim:          TrimIcon,
  extend:        ExtendIcon,
  mirror:        MirrorIcon,
  'fillet-2d':   Fillet2dIcon,
  fillet2d:      Fillet2dIcon,
  'chamfer-2d':  Chamfer2dIcon,
  chamfer2d:     Chamfer2dIcon,
  move:          MoveIcon,
  rotate:        RotateIcon,
  scale:         ScaleIcon,
  'array-linear':   ArrayLinearIcon,
  'array-circular': ArrayCircularIcon,
  'array-path':     ArrayPathIcon,
  project:       ProjectIcon,
  'convert-entities': ConvertEntitiesIcon,
  convert:       ConvertEntitiesIcon,
  dimension:     DimensionIcon,
  'dimension-linear':  DimensionIcon,
  'dimension-radial':  DimensionRadialIcon,
  'dimension-angular': DimensionAngularIcon,
  'dimension-diameter': DimensionDiameterIcon,
  text:          TextIcon,
  label:         LabelIcon,
  leader:        LeaderIcon,
  hatch:         HatchIcon,
  coincident:    CoincidentIcon,
  parallel:      ParallelIcon,
  perpendicular: PerpendicularIcon,
  tangent:       TangentIcon,
  horizontal:    HorizontalIcon,
  vertical:      VerticalIcon,
  equal:         EqualIcon,
  concentric:    ConcentricIcon,
  symmetric:     SymmetricIcon,
  fix:           FixIcon,
  'point-on-line':  PointOnLineIcon,
  'point-on-curve': PointOnCurveIcon,
  distance:      DistanceIcon,
  angle:         AngleIcon,
  diameter:      DiameterIcon,
  radius:        RadiusIcon,
  constrain:     ConstrainIcon,
  constraint:    ConstrainIcon,
  'construction-line': ConstructionLineIcon,
  construction:  ConstructionLineIcon,
  'start-sketch': StartSketchIcon,
  'sketch-on-face': SketchOnFaceIcon,
  solve:         SolveIcon,
  finish:        FinishIcon,
};

export default sketchIcons;
