// surfaceIcons.jsx — Forge SURFACE / FREEFORM toolbar icon set.
//
// Hand-authored, monochrome, NX / CATIA / SolidWorks-grade glyphs for the
// surfacing & freeform command category. One unique, operation-relevant
// glyph per op (a real engineer should read the op straight off the glyph).
//
// ICON STANDARD (every glyph obeys this exactly):
//   <svg viewBox="0 0 24 24" width={size||18} height={size||18}
//        fill="none" stroke="currentColor" strokeWidth={1.5}
//        strokeLinecap="round" strokeLinejoin="round" {...props}>
//   - content kept inside x,y ∈ [2,22]  (2 px safe padding)
//   - currentColor only — no fills, no colour
//   - consistent visual weight + complexity across the set
//
// The default export is a map { '<toolId>': Component }. Keys are the REAL
// command/verb ids used across the app's registries —
//   • forge.* native verbs  (ForgeToolBridge.js: part.extrude, part.revolve,
//     part.loft, part.sweep, part.nurbs-surface, …)
//   • kernel dispatch ids   (kernelDispatch.js: solid.extrude, solid.revolve,
//     solid.sweep, solid.loft, solid.thicken, solid.knit, solid.trimSurface)
//   • surfacing dispatch ids (surfacingDispatch.js: extrude-surface,
//     sweep-surface, fill, blend, offset, untrim, extrapolate, …)
//   • direct/heal/surfacing ops (directHealSurfDispatch.js: buildPatch, trim,
//     sew, deleteFaceAndHeal, …)
//   • menu command ids       (Menus.jsx: tools.surfacing, tools.classABlend,
//     tools.boundaryBlend, tools.loftSections, tools.surfaceOffset, …)
// — plus scope-named aliases (planar-surface, ruled-surface, control-point-edit,
//   delete-hole, extend-surface, intersect-curve, …) so callers can address an
//   op by any of its names. Every alias points at the same component, so the
//   glyph for an op is identical wherever it is referenced.
//
// Pure presentational SVG. No behaviour, no logic, no external icon library.

import React from 'react';

// Shared SVG frame so every glyph is pixel-for-pixel on-standard.
const Svg = ({ size, children, ...props }) => (
  <svg
    viewBox="0 0 24 24"
    width={size || 18}
    height={size || 18}
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

// ─────────────────────────────────────────────────────────────────────────
//  GLYPHS  — one per surfacing operation
// ─────────────────────────────────────────────────────────────────────────

// PLANAR SURFACE — a flat bounded sheet (parallelogram) with a corner normal
// tick; the canonical "fill a closed boundary with a plane" glyph.
export const PlanarSurfaceIcon = (props) => (
  <Svg {...props}>
    <path d="M5 8 L15 8 L19 16 L9 16 Z" />
    <path d="M9 16 V20" />
    <path d="M7 18 L11 18" />
  </Svg>
);

// EXTRUDE SURFACE — an open curve (top edge) pulled down a distance into a
// ruled sheet, with the pull-direction arrow. Surface (not solid): the swept
// region is an open skin, not a capped box.
export const ExtrudeSurfaceIcon = (props) => (
  <Svg {...props}>
    <path d="M4 6 Q9 3 14 6 T20 6" />
    <path d="M4 6 L4 18" />
    <path d="M20 6 L20 18" />
    <path d="M4 18 Q9 15 14 18 T20 18" />
    <path d="M12 9 L12 15 M9.5 12.5 L12 15 L14.5 12.5" />
  </Svg>
);

// REVOLVE SURFACE — a profile curve + dashed centre axis + sweep arc arrow
// spinning the profile into a surface of revolution.
export const RevolveSurfaceIcon = (props) => (
  <Svg {...props}>
    <path d="M6 4 V20" strokeDasharray="2 2" />
    <path d="M10 5 Q15 8 14 12 Q13 16 10 19" />
    <path d="M10 5 A8 4 0 0 1 18 8" />
    <path d="M16 5.5 L18 8 L15.4 8.8" />
  </Svg>
);

// SWEEP SURFACE — an open profile carried along a curved spine, sketched as
// section ribs riding a 3D path: the classic sweep glyph (open skin variant).
export const SweepSurfaceIcon = (props) => (
  <Svg {...props}>
    <path d="M4 18 Q9 6 14 9 T20 5" />
    <path d="M3 16 L5 19 L7 16" />
    <path d="M11 6 L13 11" />
    <path d="M17 4 L19 8" />
  </Svg>
);

// LOFT SURFACE — a skin lofted through ≥2 stacked cross-section profiles
// (two ellipses) with rulings blending them top to bottom.
export const LoftSurfaceIcon = (props) => (
  <Svg {...props}>
    <ellipse cx="12" cy="6" rx="6" ry="2.2" />
    <ellipse cx="12" cy="18" rx="4" ry="1.6" />
    <path d="M6 6 L8 18" />
    <path d="M18 6 L16 18" />
    <path d="M12 8.2 L12 16.4" strokeDasharray="2 2" />
  </Svg>
);

// BOUNDARY / BLEND SURFACE — a curvature-continuous patch bridging two faces;
// shown as two boundary edges joined by a smooth G2 spanning surface.
export const BoundaryBlendIcon = (props) => (
  <Svg {...props}>
    <path d="M4 6 Q6 9 4 12" />
    <path d="M20 6 Q18 9 20 12" />
    <path d="M4 6 Q12 2 20 6" />
    <path d="M4 12 Q12 16 20 12" />
    <path d="M4 9 Q12 12 20 9" strokeDasharray="2 2" />
  </Svg>
);

// FILL SURFACE — a closed boundary loop capped by an interior patch
// (cross-hatch fill) reconstructing the missing face.
export const FillSurfaceIcon = (props) => (
  <Svg {...props}>
    <path d="M5 9 Q12 3 19 9 Q21 14 16 19 Q9 21 6 16 Q3 13 5 9 Z" />
    <path d="M8 11 L15 17" />
    <path d="M11 9 L17 14" />
    <path d="M7 14 L12 18" />
  </Svg>
);

// OFFSET SURFACE — a base sheet plus a parallel copy displaced along the
// normal, with the offset-distance arrows between them.
export const OffsetSurfaceIcon = (props) => (
  <Svg {...props}>
    <path d="M4 10 Q12 5 20 10" />
    <path d="M4 17 Q12 12 20 17" />
    <path d="M8 8 L8 14 M6.5 12.5 L8 14 L9.5 12.5" />
    <path d="M16 8 L16 14 M14.5 12.5 L16 14 L17.5 12.5" />
  </Svg>
);

// TRIM SURFACE — a sheet split by a cutting curve, the discarded side
// shown removed (dashed); a scissors-cut along a boundary curve.
export const TrimSurfaceIcon = (props) => (
  <Svg {...props}>
    <path d="M4 6 L14 6 L20 12 L10 12 Z" />
    <path d="M9 4 Q12 12 8 20" />
    <path d="M14 14 L20 14 L18 19 L13 19 Z" strokeDasharray="2 2" />
  </Svg>
);

// UNTRIM — restore a trimmed face back to its full natural boundary; the
// kept sub-region (solid) expanded to the full parametric sheet (dashed).
export const UntrimIcon = (props) => (
  <Svg {...props}>
    <path d="M4 5 L20 5 L20 19 L4 19 Z" strokeDasharray="2 2" />
    <path d="M9 9 L20 9 L20 19 L9 19 Z" />
    <path d="M12 14 L7 14 M9 12 L7 14 L9 16" />
  </Svg>
);

// KNIT (sew) — multiple surface patches stitched into a single shell; two
// faces meeting at a seam with stitch ticks across the join.
export const KnitSurfaceIcon = (props) => (
  <Svg {...props}>
    <path d="M4 7 Q8 4 12 7 L12 16 Q8 19 4 16 Z" />
    <path d="M12 7 Q16 4 20 7 L20 16 Q16 19 12 16 Z" />
    <path d="M10 7 L14 9 M10 10 L14 12 M10 13 L14 15" />
  </Svg>
);

// THICKEN SURFACE — an open sheet offset both ways into a solid wall of
// thickness t, with the wall thickness dimension shown.
export const ThickenSurfaceIcon = (props) => (
  <Svg {...props}>
    <path d="M4 8 Q12 4 20 8" />
    <path d="M4 13 Q12 9 20 13" />
    <path d="M4 8 L4 13 M20 8 L20 13" />
    <path d="M12 6 L12 11" />
    <path d="M10.5 7.5 L12 6 L13.5 7.5 M10.5 9.5 L12 11 L13.5 9.5" />
  </Svg>
);

// RULED SURFACE — straight rulings spanning two rail curves (no smoothing);
// the defining trait is the family of straight line segments between rails.
export const RuledSurfaceIcon = (props) => (
  <Svg {...props}>
    <path d="M4 5 Q9 8 7 19" />
    <path d="M20 5 Q15 9 18 19" />
    <path d="M4.6 7 L19.4 7.4" />
    <path d="M5.6 11 L18.6 12" />
    <path d="M6.4 15 L18 16" />
  </Svg>
);

// NURBS SURFACE — a freeform B-spline patch shown as a warped control mesh
// (a deformed grid), the universal NURBS-patch glyph.
export const NurbsSurfaceIcon = (props) => (
  <Svg {...props}>
    <path d="M4 8 Q9 4 14 7 T21 7" />
    <path d="M3 13 Q8 9 13 12 T20 12" />
    <path d="M3 18 Q8 14 13 17 T20 17" />
    <path d="M5 6.5 L4 18.6" />
    <path d="M12.5 6 L12 17" />
    <path d="M20.6 7 L20 17.2" />
  </Svg>
);

// CONTROL-POINT EDIT — drag the poles of a curve/surface: a control polygon
// with its handle nodes, one pole pulled off the curve.
export const ControlPointEditIcon = (props) => (
  <Svg {...props}>
    <path d="M4 18 Q8 6 14 10 Q18 13 20 7" strokeDasharray="2.5 2.5" />
    <path d="M4 18 L9 5 L15 12 L20 7" />
    <circle cx="4" cy="18" r="1.4" />
    <circle cx="9" cy="5" r="1.4" />
    <circle cx="15" cy="12" r="1.4" />
    <circle cx="20" cy="7" r="1.4" />
  </Svg>
);

// DELETE HOLE — remove an internal hole/loop from a face and re-cap it; a
// face with a circular hole marked for deletion (×).
export const DeleteHoleIcon = (props) => (
  <Svg {...props}>
    <path d="M4 5 L20 5 L20 19 L4 19 Z" />
    <circle cx="12" cy="12" r="3.6" />
    <path d="M10 10 L14 14 M14 10 L10 14" />
  </Svg>
);

// EXTEND SURFACE — prolong a sheet past one of its edges (dashed extension)
// with the extend-direction arrow.
export const ExtendSurfaceIcon = (props) => (
  <Svg {...props}>
    <path d="M4 7 Q9 5 12 7 L12 17 Q9 19 4 17 Z" />
    <path d="M12 7 Q16 5 19 7" strokeDasharray="2 2" />
    <path d="M12 17 Q16 19 19 17" strokeDasharray="2 2" />
    <path d="M14 12 L20 12 M18 10 L20 12 L18 14" />
  </Svg>
);

// INTERSECT CURVE — the curve where two surfaces cross; two arcing sheets
// meeting along a highlighted intersection line.
export const IntersectCurveIcon = (props) => (
  <Svg {...props}>
    <path d="M4 6 Q12 9 20 6" />
    <path d="M4 18 Q12 15 20 18" />
    <path d="M6 4 Q9 12 6 20" />
    <path d="M18 4 Q15 12 18 20" />
    <path d="M9 11 Q12 12.5 15 11" strokeWidth={2} />
  </Svg>
);

// ─────────────────────────────────────────────────────────────────────────
//  ID MAP  — real command/verb ids (+ aliases) → component
// ─────────────────────────────────────────────────────────────────────────

const surfaceIcons = {
  // ── PLANAR SURFACE ──
  'planar-surface': PlanarSurfaceIcon,
  'planarSurface': PlanarSurfaceIcon,
  'surface.planar': PlanarSurfaceIcon,
  'tools.surfacing': PlanarSurfaceIcon, // category root → planar/sheet glyph

  // ── EXTRUDE SURFACE ──
  'extrude-surface': ExtrudeSurfaceIcon,      // surfacingDispatch.js
  'extrudeSurface': ExtrudeSurfaceIcon,
  'surface.extrude': ExtrudeSurfaceIcon,

  // ── REVOLVE SURFACE ──
  'revolve-surface': RevolveSurfaceIcon,
  'revolveSurface': RevolveSurfaceIcon,
  'surface.revolve': RevolveSurfaceIcon,

  // ── SWEEP SURFACE ──
  'sweep-surface': SweepSurfaceIcon,          // surfacingDispatch.js
  'sweepSurface': SweepSurfaceIcon,
  'surface.sweep': SweepSurfaceIcon,
  'tools.variableSectionSweep': SweepSurfaceIcon, // Menus.jsx

  // ── LOFT SURFACE ──
  'loft-surface': LoftSurfaceIcon,
  'loftSurface': LoftSurfaceIcon,
  'surface.loft': LoftSurfaceIcon,
  'multi-section': LoftSurfaceIcon,           // surfacingDispatch.js
  'multiSection': LoftSurfaceIcon,
  'tools.loftSections': LoftSurfaceIcon,      // Menus.jsx
  'tools.multiSectionLoft': LoftSurfaceIcon,  // Menus.jsx

  // ── BOUNDARY / BLEND SURFACE ──
  'boundary-surface': BoundaryBlendIcon,
  'boundary-blend': BoundaryBlendIcon,
  'boundaryBlend': BoundaryBlendIcon,
  'blend': BoundaryBlendIcon,                 // surfacingDispatch.js
  'tools.classABlend': BoundaryBlendIcon,     // Menus.jsx
  'tools.boundaryBlend': BoundaryBlendIcon,   // Menus.jsx
  'surface.blend': BoundaryBlendIcon,

  // ── FILL SURFACE ──
  'fill-surface': FillSurfaceIcon,
  'fillSurface': FillSurfaceIcon,
  'fill': FillSurfaceIcon,                    // surfacingDispatch.js
  'surface.fill': FillSurfaceIcon,
  'autoFillMissingFaces': FillSurfaceIcon,    // directHealSurfDispatch.js (HEAL)

  // ── OFFSET SURFACE ──
  'offset-surface': OffsetSurfaceIcon,
  'offsetSurface': OffsetSurfaceIcon,
  'offset': OffsetSurfaceIcon,                // surfacingDispatch.js
  'tools.surfaceOffset': OffsetSurfaceIcon,   // Menus.jsx
  'surface.offset': OffsetSurfaceIcon,

  // ── TRIM SURFACE ──
  'trim-surface': TrimSurfaceIcon,
  'trimSurface': TrimSurfaceIcon,
  'solid.trimSurface': TrimSurfaceIcon,       // kernelDispatch.js
  'trim': TrimSurfaceIcon,                    // directHealSurfDispatch.js (SURFACING)
  'surface.trim': TrimSurfaceIcon,

  // ── UNTRIM ──
  'untrim': UntrimIcon,                        // surfacingDispatch.js
  'untrim-surface': UntrimIcon,
  'surface.untrim': UntrimIcon,

  // ── KNIT (sew) ──
  'knit': KnitSurfaceIcon,
  'knit-surface': KnitSurfaceIcon,
  'solid.knit': KnitSurfaceIcon,              // kernelDispatch.js
  'sew': KnitSurfaceIcon,                     // directHealSurfDispatch.js (SURFACING)
  'heal.sew': KnitSurfaceIcon,                // ForgeToolBridge.js
  'sewShape': KnitSurfaceIcon,                // directHealSurfDispatch.js (HEAL)
  'gap': KnitSurfaceIcon,                     // surfacingDispatch.js (close gap = stitch)
  'surface.knit': KnitSurfaceIcon,

  // ── THICKEN SURFACE ──
  'thicken-surface': ThickenSurfaceIcon,
  'thickenSurface': ThickenSurfaceIcon,
  'solid.thicken': ThickenSurfaceIcon,        // kernelDispatch.js
  'thicken': ThickenSurfaceIcon,
  'surface.thicken': ThickenSurfaceIcon,

  // ── RULED SURFACE ──
  'ruled-surface': RuledSurfaceIcon,
  'ruledSurface': RuledSurfaceIcon,
  'ruled': RuledSurfaceIcon,                  // toolSchemas.js loft 'ruled' flag
  'surface.ruled': RuledSurfaceIcon,
  'extrapolate': RuledSurfaceIcon,            // surfacingDispatch.js (linear ruled extension)

  // ── NURBS SURFACE ──
  'nurbs-surface': NurbsSurfaceIcon,          // part.nurbs-surface (ForgeToolBridge.js)
  'part.nurbs-surface': NurbsSurfaceIcon,
  'nurbsSurface': NurbsSurfaceIcon,
  'nurbsfit': NurbsSurfaceIcon,               // toolRegistry.js / WorkbenchRail.jsx
  'buildPatch': NurbsSurfaceIcon,             // directHealSurfDispatch.js (SURFACING)
  'surface.nurbs': NurbsSurfaceIcon,

  // ── CONTROL-POINT EDIT ──
  'control-point-edit': ControlPointEditIcon,
  'controlPointEdit': ControlPointEditIcon,
  'control-point': ControlPointEditIcon,
  'controlPoints': ControlPointEditIcon,
  'refine': ControlPointEditIcon,             // directHealSurfDispatch.js (insert poles)
  'surface.controlPoints': ControlPointEditIcon,

  // ── DELETE HOLE ──
  'delete-hole': DeleteHoleIcon,
  'deleteHole': DeleteHoleIcon,
  'deleteFaceAndHeal': DeleteHoleIcon,        // directHealSurfDispatch.js (DIRECT)
  'surface.deleteHole': DeleteHoleIcon,

  // ── EXTEND SURFACE ──
  'extend-surface': ExtendSurfaceIcon,
  'extendSurface': ExtendSurfaceIcon,
  'extend': ExtendSurfaceIcon,                // toolSchemas.js extension param
  'surface.extend': ExtendSurfaceIcon,

  // ── INTERSECT CURVE ──
  'intersect-curve': IntersectCurveIcon,
  'intersectCurve': IntersectCurveIcon,
  'intersect-curves': IntersectCurveIcon,     // surfacingDispatch.js
  'intersect': IntersectCurveIcon,            // directHealSurfDispatch.js (SURFACING)
  'boundary-curve': IntersectCurveIcon,       // surfacingDispatch.js (extracted boundary)
  'surface.intersectCurve': IntersectCurveIcon,
};

export default surfaceIcons;
