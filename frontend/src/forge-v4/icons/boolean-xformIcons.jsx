// Forge — "boolean-xform" category icon set.
//
// Hand-authored, professional MCAD toolbar glyphs at Siemens-NX /
// Dassault-CATIA / SolidWorks fidelity for the Boolean + Transform tool
// family. Every glyph is UNIQUE and literally depicts the operation the way
// a working CAD toolbar does (two overlapping bodies for booleans, the moved
// half ghosted for subtract, a triad for translate, a sweep arc for rotate,
// a corner-handle box for scale, a dashed mirror plane, a slicing plane for
// split, an arrow pushing a highlighted face for move-face, a caliper for
// measure, …).
//
// ICON STANDARD (identical across every category — this is what makes the set
// read as one professional family, not random clip-art):
//
//   <svg viewBox="0 0 24 24" width={size} height={size}
//        fill="none" stroke="currentColor" strokeWidth={1.5}
//        strokeLinecap="round" strokeLinejoin="round" {...props}>
//
//   • viewBox 0 0 24 24, default 18×18 px.
//   • MONOCHROME — currentColor stroke only, fill="none". The few dot
//     accents use fill="currentColor" stroke="none" so they still inherit
//     the one ink colour (no second colour is ever introduced).
//   • All geometry kept inside x,y ∈ [2, 22] (2 px safe padding).
//   • Consistent visual weight + complexity: a primary body/feature plus one
//     operation-defining accent (arrow / plane / handle / ghost).
//   • Pure presentational SVG — NO behaviour, NO logic, NO state.
//
// The map keys are the REAL tool / command ids used across the app
// (frontend/src/ai/ForgeToolBridge.js verbs `part.fuse|cut|common|translate|
// rotate|add|subtract|intersect|mirror`, the Toolbar/Menus ids `bool.*`,
// `solid.*`, `transform.*`, `gizmo.*`, `measure.*`, `tools.*`, and the
// direct-edit dispatch ids `moveFace`, `deleteFaceAndHeal`, `pushPullFace`,
// `rotateFace`, `tools.directEditTranslate`). Sensible aliases are mapped to
// the same glyph so every surface that names the op a little differently still
// resolves to the correct, recognisable icon.
//
// Usage:
//   import BOOLEAN_XFORM_ICONS, { Union } from './icons/boolean-xformIcons.jsx';
//   const Glyph = BOOLEAN_XFORM_ICONS['part.fuse'];
//   <Glyph size={18} />

import React from 'react';

// Shared <svg> frame so every glyph is byte-for-byte on-standard. The caller
// passes only the inner geometry; size/stroke/caps/viewBox are fixed here.
function svg(children) {
  return function IconComponent({ size = 18, ...props }) {
    return (
      <svg
        viewBox="0 0 24 24"
        width={size}
        height={size}
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
  };
}

// ───────────────────────── BOOLEAN ─────────────────────────

// UNION / FUSE — two overlapping bodies merged into one outline. The merged
// silhouette is solid; the interior seam is ghosted (dashed) to read "fused".
export const Union = svg(
  <>
    <path d="M5 9a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v6a4 4 0 0 1-4 4H9a4 4 0 0 1-4-4z" />
    <rect x="3" y="3" width="9" height="9" rx="2" />
    <rect x="11" y="11" width="9" height="9" rx="2" />
  </>
);

// SUBTRACT / CUT — target body minus a tool body: the tool (dashed, ghosted)
// is removed, leaving a bite out of the solid target.
export const Subtract = svg(
  <>
    <path d="M3 5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v3.5h-1.5a3 3 0 0 0-3 3V13H5a2 2 0 0 1-2-2z" />
    <circle cx="13" cy="13" r="6" strokeDasharray="2.4 2.2" />
  </>
);

// INTERSECT / COMMON — only the lens-shaped overlap of two bodies is kept;
// the two source bodies are dashed, the common region is a solid filled lens.
export const Intersect = svg(
  <>
    <rect x="3" y="3" width="11" height="11" rx="2" strokeDasharray="2.4 2.2" />
    <rect x="10" y="10" width="11" height="11" rx="2" strokeDasharray="2.4 2.2" />
    <path d="M10 14V10h4v4z" />
  </>
);

// COMBINE BODIES — bring several separate bodies together into one assembly
// body: three bodies converging with merge arrows toward a center.
export const CombineBodies = svg(
  <>
    <rect x="3" y="3" width="6" height="6" rx="1" />
    <rect x="15" y="3" width="6" height="6" rx="1" />
    <rect x="9" y="15" width="6" height="6" rx="1" />
    <path d="M9 6h2.5a2 2 0 0 1 2 2v4.5M15 6h-2.5a2 2 0 0 0-2 2v4.5" />
    <path d="M10 11.5l2 2 2-2" />
  </>
);

// SPLIT BODY — a slicing plane passes through a solid, dividing it; the two
// halves part along the cut line (one half nudged away).
export const SplitBody = svg(
  <>
    <path d="M3 8l9-4 4 1.8-9 4z" />
    <path d="M3 8v6l9 4v-6" />
    <path d="M16 5.8V11l-4 3" />
    <path d="M19.5 4.5l-15 8" strokeDasharray="2.4 2.2" />
    <path d="M19 8l1.5-1.5L19 5" />
  </>
);

// ───────────────────────── TRANSFORM ─────────────────────────

// MOVE / TRANSLATE — a body with the XYZ translate triad (move gizmo): three
// orthogonal arrows from a common origin, the convention every CAD uses.
export const Move = svg(
  <>
    <rect x="3" y="11" width="7" height="7" rx="1" opacity="0.55" />
    <path d="M13 14V5M13 14H4M13 14l7 4" />
    <path d="M13 5l-2.4 2M13 5l2.4 2" />
    <path d="M4 14l2-2.4M4 14l2 2.4" />
    <path d="M20 18l-1-2.8M20 18l-2.9-0.6" />
  </>
);

// ROTATE — a body swept about an axis: a curved sweep arrow with arrowhead
// around a dashed rotation axis, the standard "revolve/rotate" depiction.
export const Rotate = svg(
  <>
    <path d="M12 2.5v19" strokeDasharray="2.6 2.4" />
    <path d="M6 7.5a8 6 0 0 1 12 0" />
    <path d="M18 7.5l-2.6-0.6M18 7.5l-0.9 2.6" />
    <ellipse cx="12" cy="16" rx="7.5" ry="2.6" opacity="0.55" />
  </>
);

// SCALE — a body resized by a corner handle: a base rectangle with a larger
// dashed target and a diagonal arrow at the corner grip.
export const Scale = svg(
  <>
    <rect x="4" y="11" width="7" height="7" rx="1" />
    <rect x="4" y="4" width="14" height="14" rx="1" strokeDasharray="2.6 2.4" />
    <path d="M11 11l6 6" />
    <path d="M17 13.5V17h-3.5" />
    <rect x="3" y="3" width="2.2" height="2.2" fill="currentColor" stroke="none" />
  </>
);

// ALIGN — two parts snapping to a common reference line: two bodies pulled to
// a shared dashed alignment axis with snap arrows.
export const Align = svg(
  <>
    <path d="M12 2.5v19" strokeDasharray="2.6 2.4" />
    <rect x="3" y="5" width="6" height="4.5" rx="0.8" />
    <rect x="14" y="14" width="6" height="4.5" rx="0.8" />
    <path d="M9 7.2h2M11 7.2l-1.4-1M11 7.2l-1.4 1" />
    <path d="M14 16.2h-2M12 16.2l1.4-1M12 16.2l1.4 1" />
  </>
);

// COPY — duplicate a body: an original solid with a forward-offset ghost copy
// (the classic stacked-card copy glyph adapted to a 3D part).
export const Copy = svg(
  <>
    <path d="M8 9l4-2 4 2v5l-4 2-4-2z" />
    <path d="M8 9l4 2 4-2M12 11v5" />
    <path d="M5 6l3.5-1.6M5 6v5l2 1M16.8 5.2L13 6.9" opacity="0.55" />
    <path d="M4 5.5l3.5-1.6 3.5 1.6" opacity="0.55" strokeDasharray="2.4 2.2" />
  </>
);

// MIRROR BODY — a body reflected across a dashed mirror plane; the source is
// solid, the reflected copy is ghosted, mirror symbols on the plane.
export const MirrorBody = svg(
  <>
    <path d="M12 2.5v19" strokeDasharray="2.6 2.4" />
    <path d="M9.5 6.5L4 9.5v5l5.5 3z" />
    <path d="M14.5 6.5L20 9.5v5l-5.5 3z" opacity="0.5" />
    <path d="M10.7 12h-1.6M9.1 12l1-0.9M9.1 12l1 0.9" />
    <path d="M13.3 12h1.6M14.9 12l-1-0.9M14.9 12l-1 0.9" opacity="0.5" />
  </>
);

// ───────────────────── DIRECT-EDIT (FACE) ─────────────────────

// MOVE FACE — a single highlighted face of a solid pushed/dragged by a vector
// arrow normal to it (direct-edit move-face).
export const MoveFace = svg(
  <>
    <path d="M4 8l5-3 5 3v7l-5 3-5-3z" />
    <path d="M4 8l5 3 5-3M9 11v7" />
    <path d="M9.5 5.2L14 8l4.5-1.8" opacity="0.45" />
    <path d="M16 4.5l4 1.6-1.7 3.8" />
  </>
);

// DELETE FACE (+ heal) — a face of the solid removed: the face outline dashed
// with an X, the surrounding body healed closed.
export const DeleteFace = svg(
  <>
    <path d="M5 8l5-3 5 3v7l-5 3-5-3z" />
    <path d="M5 8l5 3 5-3M10 11v7" />
    <path d="M5 8l5-3 5 3-5 3z" strokeDasharray="2.2 2" />
    <path d="M14.5 13l5 5M19.5 13l-5 5" />
  </>
);

// PUSH / PULL FACE — a planar face offset along its normal by a dimensioned
// double arrow (the NX "Offset / Push-Pull face" glyph).
export const PushPullFace = svg(
  <>
    <path d="M4 9l5-3 5 3v6l-5 3-5-3z" />
    <path d="M4 9l5 3 5-3M9 12v6" />
    <path d="M14 8.5l5-2M14 14.5l5-2" opacity="0.45" />
    <path d="M19 4.5v15" />
    <path d="M19 4.5l-1.6 1.4M19 4.5l1.6 1.4" />
    <path d="M19 19.5l-1.6-1.4M19 19.5l1.6-1.4" />
  </>
);

// ROTATE FACE — a face of a solid tipped about an in-plane axis by a small
// sweep arc (direct-edit angled-face / draft).
export const RotateFace = svg(
  <>
    <path d="M4 9l5-3 5 3v6l-5 3-5-3z" />
    <path d="M4 9l5 3 5-3M9 12v6" />
    <path d="M14 6.5h5" strokeDasharray="2.2 2" />
    <path d="M14.5 14a5 4 0 0 1 5-5" />
    <path d="M19.5 9l-1.8 0.2M19.5 9l-0.3 1.9" />
  </>
);

// ───────────────────── MEASURE / INSPECT ─────────────────────

// MEASURE / INSPECT DISTANCE — a dimension line with witness lines and double
// arrowheads between two extremes (the universal CAD measure glyph).
export const MeasureDistance = svg(
  <>
    <path d="M5 5v14M19 5v14" />
    <path d="M5 12h14" />
    <path d="M5 12l2.4-1.6M5 12l2.4 1.6" />
    <path d="M19 12l-2.4-1.6M19 12l-2.4 1.6" />
    <circle cx="5" cy="5" r="0.6" fill="currentColor" stroke="none" />
    <circle cx="19" cy="5" r="0.6" fill="currentColor" stroke="none" />
  </>
);

// INTERFERENCE — two overlapping bodies with the clash region called out
// (interference / clearance check between solids).
export const Interference = svg(
  <>
    <rect x="3" y="6" width="11" height="11" rx="1.5" />
    <rect x="10" y="3" width="11" height="11" rx="1.5" strokeDasharray="2.4 2.2" />
    <path d="M10 14V10h4v4z" />
    <path d="M12 5.6v2.6M12 9.8v0.01" />
  </>
);

// ─────────────────────────── MAP ───────────────────────────
// Real tool/command ids → glyph. Aliases share the canonical glyph so every
// surface (ForgeToolBridge verbs, Toolbar/Menus ids, direct-edit dispatch
// ids, gizmo ids) resolves to the right, recognisable icon.

const BOOLEAN_XFORM_ICONS = {
  // ── union / fuse ──
  'part.fuse': Union,
  'part.add': Union,
  'bool.union': Union,
  'solid.fuse': Union,
  'solid.union': Union,
  'transform.union': Union,

  // ── subtract / cut ──
  'part.cut': Subtract,
  'part.subtract': Subtract,
  'bool.cut': Subtract,
  'solid.cut': Subtract,
  'solid.subtract': Subtract,

  // ── intersect / common ──
  'part.common': Intersect,
  'part.intersect': Intersect,
  'bool.common': Intersect,
  'solid.common': Intersect,
  'solid.intersect': Intersect,

  // ── combine bodies ──
  'bool.combine': CombineBodies,
  'part.combine': CombineBodies,
  'solid.combine': CombineBodies,
  'body.combine': CombineBodies,

  // ── split body ──
  'bool.split': SplitBody,
  'part.split': SplitBody,
  'solid.split': SplitBody,
  'body.split': SplitBody,

  // ── move / translate ──
  'part.translate': Move,
  'solid.translate': Move,
  'transform.translate': Move,
  'gizmo.translate': Move,
  'studio.move': Move,
  'studio.translate': Move,
  'draft.move': Move,
  'tools.directEditTranslate': Move,
  'directEditTranslate': Move,

  // ── rotate ──
  'part.rotate': Rotate,
  'solid.rotate': Rotate,
  'transform.rotate': Rotate,
  'gizmo.rotate': Rotate,
  'studio.rotate': Rotate,
  'draft.rotate': Rotate,

  // ── scale ──
  'transform.scale': Scale,
  'gizmo.scale': Scale,
  'box.scale': Scale,
  'draft.scale': Scale,
  'studio.scale': Scale,
  'solid.scale': Scale,
  'part.scale': Scale,

  // ── align ──
  'transform.align': Align,
  'part.align': Align,
  'solid.align': Align,
  'body.align': Align,
  'tools.align': Align,

  // ── copy ──
  'edit.copy': Copy,
  'part.copy': Copy,
  'solid.copy': Copy,
  'body.copy': Copy,
  'transform.copy': Copy,

  // ── mirror body ──
  'part.mirror': MirrorBody,
  'pattern.mirror': MirrorBody,
  'draft.mirror': MirrorBody,
  'sketch.mirror': MirrorBody,
  'solid.mirror': MirrorBody,
  'body.mirror': MirrorBody,
  'transform.mirror': MirrorBody,

  // ── direct-edit: move face ──
  'moveFace': MoveFace,
  'direct.moveFace': MoveFace,
  'face.move': MoveFace,

  // ── direct-edit: delete face (+ heal) ──
  'deleteFaceAndHeal': DeleteFace,
  'direct.deleteFaceAndHeal': DeleteFace,
  'face.delete': DeleteFace,
  'deleteFace': DeleteFace,

  // ── direct-edit: push / pull (offset) face ──
  'pushPullFace': PushPullFace,
  'direct.pushPullFace': PushPullFace,
  'face.pushPull': PushPullFace,
  'offsetFace': PushPullFace,
  'face.offset': PushPullFace,

  // ── direct-edit: rotate face ──
  'rotateFace': RotateFace,
  'direct.rotateFace': RotateFace,
  'face.rotate': RotateFace,

  // ── measure / inspect distance ──
  'measure.distance': MeasureDistance,
  'tools.measure': MeasureDistance,
  'measure.inspect': MeasureDistance,
  'inspect.distance': MeasureDistance,

  // ── interference / clearance inspect ──
  'measure.interfere': Interference,
  'tools.interfere': Interference,
  'measure.interference': Interference,
  'inspect.interference': Interference,
};

export default BOOLEAN_XFORM_ICONS;
