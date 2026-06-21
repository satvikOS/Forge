// Forge — FEATURE category icon set (solid feature toolbar glyphs).
//
// Siemens-NX / Dassault-CATIA / SolidWorks toolbar-quality, hand-authored
// SVG. Every glyph is UNIQUE and literally depicts the modelling operation
// the way a professional MCAD ribbon does: a profile pulled into a solid for
// extrude, a profile + dashed axis + sweep arc for revolve, a rounded corner
// with its radius for fillet, a bevelled corner for chamfer, a hollowed box
// for shell, a feature stepped across a grid/ring for patterns, and so on.
//
// ── ICON STANDARD (identical across EVERY Forge category) ──────────────
//   • viewBox="0 0 24 24", width/height = props.size||18
//   • fill="none", stroke="currentColor", strokeWidth=1.5
//   • strokeLinecap="round", strokeLinejoin="round"
//   • MONOCHROME — currentColor only, no fills / no colour
//   • all geometry within x,y ∈ [2,22] (2 px safe padding)
//   • consistent visual weight + complexity; no external icon library
//
// ── KEYS ───────────────────────────────────────────────────────────────
// Keys match the REAL command ids used in the app (verified against
// frontend/src/forge-v4/toolSchemas.js + kernelDispatch.js + SolidOpsWorkbench.jsx
// + frontend/src/ai/ForgeToolBridge.js): the dotted `solid.*` / `pattern.*`
// / `bool.*` vocabulary. Plain-word aliases (extrude, pad, boss, pocket,
// linear-pattern, …) point at the same component so lookups by either the
// canonical id or a natural alias resolve.
//
// Usage:
//   import FEATURE_ICONS, { ExtrudeIcon } from 'forge-v4/icons/featureIcons.jsx';
//   const Glyph = FEATURE_ICONS['solid.extrude'];   // or FEATURE_ICONS['pad']
//   <Glyph size={20} />

import React from 'react';

// Shared <svg> wrapper so every glyph is pixel-identical in frame, weight
// and stroke behaviour. Children are the hand-authored paths.
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

/* ════════════════════════════════════════════════════════════════════════
   SOLID FEATURES — material-adding / profile-based
   ════════════════════════════════════════════════════════════════════════ */

// EXTRUDE / PAD — rectangular profile pulled into a prism with depth arrows.
export const ExtrudeIcon = (props) => (
  <Svg {...props}>
    {/* extruded prism (front face + receding top/side) */}
    <path d="M4 11h9v8H4z" />
    <path d="M4 11l4-4h9l-4 4M13 11l4-4v8l-4 4" />
    {/* pull / depth arrow showing the extrude direction */}
    <path d="M8.5 6.5V2M6.5 3.5l2-2 2 2" />
  </Svg>
);

// BOSS / BOSS-EXTRUDE — raised cylindrical pad standing proud of a face.
export const BossIcon = (props) => (
  <Svg {...props}>
    {/* base face */}
    <path d="M3 18h18" />
    {/* raised round boss (ellipse top + cylinder walls) */}
    <ellipse cx="12" cy="8" rx="5" ry="2" />
    <path d="M7 8v6c0 1.1 2.2 2 5 2s5-.9 5-2V8" />
    {/* rise arrow */}
    <path d="M19.5 16V9M17.8 10.5l1.7-1.6 1.7 1.6" />
  </Svg>
);

// REVOLVE — profile spun about a dashed axis with a sweep arc.
export const RevolveIcon = (props) => (
  <Svg {...props}>
    {/* dashed axis of revolution */}
    <path d="M5 3v18" strokeDasharray="2.4 2.2" />
    {/* generating profile against the axis */}
    <path d="M5 8h5l1.5 3.5L10 16H5" />
    {/* sweep / revolution arc with arrowhead */}
    <path d="M13 7a8 8 0 0 1 0 10" />
    <path d="M11.6 15.4 13 17.2l2-1.1" />
  </Svg>
);

// SWEEP — profile carried along a sweep path (open curve).
export const SweepIcon = (props) => (
  <Svg {...props}>
    {/* sweep path */}
    <path d="M4 19c4-1 4-10 8-12s5 0 8-3" />
    {/* profile (small section) riding at the start of the path */}
    <rect x="2.5" y="16.5" width="5" height="5" rx="0.6" transform="rotate(-18 5 19)" />
    {/* section marker further along the path */}
    <circle cx="14.4" cy="9" r="1.3" />
  </Svg>
);

// LOFT — solid blended between two (offset) cross-section profiles.
export const LoftIcon = (props) => (
  <Svg {...props}>
    {/* near section */}
    <rect x="3" y="13" width="6" height="7" rx="0.6" />
    {/* far section (smaller, raised) */}
    <rect x="15" y="4" width="5" height="6" rx="0.6" />
    {/* transition / blend rails connecting the sections */}
    <path d="M9 13l6-3M9 20l6-10M9 14.5l6-7.5" />
  </Svg>
);

// THICKEN — open surface offset to a thin solid wall.
export const ThickenIcon = (props) => (
  <Svg {...props}>
    {/* original surface */}
    <path d="M3 9c5-4 13-4 18 0" />
    {/* offset surface (the added thickness) */}
    <path d="M3 14c5-4 13-4 18 0" />
    {/* end caps + offset arrow */}
    <path d="M3 9v5M21 9v5" />
    <path d="M12 6.4V12M10.3 7.9 12 6.2l1.7 1.7" />
  </Svg>
);

// WRAP — flat sketch text/curve projected & wrapped onto a cylinder face.
export const WrapIcon = (props) => (
  <Svg {...props}>
    {/* cylinder */}
    <ellipse cx="12" cy="6" rx="7" ry="2.4" />
    <path d="M5 6v12a7 2.4 0 0 0 14 0V6" />
    {/* wrapped band / engraving following the surface curvature */}
    <path d="M5.6 12.5c3 1.6 9.8 1.6 12.8 0" />
    <path d="M6.4 9.4c2.6 1.3 8.6 1.3 11.2 0" strokeDasharray="2 2" />
  </Svg>
);

// DOME — face bulged into a spherical-cap dome with apex height.
export const DomeIcon = (props) => (
  <Svg {...props}>
    {/* base ellipse the dome grows from */}
    <ellipse cx="12" cy="17" rx="8" ry="2.4" />
    {/* domed cap */}
    <path d="M4 17C4 9.5 8 5 12 5s8 4.5 8 12" />
    {/* apex height marker */}
    <path d="M12 5V2.5M10.4 4 12 2.4 13.6 4" />
  </Svg>
);

/* ════════════════════════════════════════════════════════════════════════
   SOLID FEATURES — material-removing
   ════════════════════════════════════════════════════════════════════════ */

// CUT / EXTRUDE-CUT — profile removed from a solid (dashed removed volume).
export const CutIcon = (props) => (
  <Svg {...props}>
    {/* solid block */}
    <path d="M4 8h13v12H4z" />
    <path d="M4 8l3-3h13v12l-3 3M17 8l3-3" />
    {/* removed pocket pushed INTO the block (dashed = subtracted material) */}
    <path d="M8 12h5v8" strokeDasharray="2 1.8" />
    {/* cut / push-in arrow */}
    <path d="M10.5 4.5V9M8.8 7.3l1.7 1.7 1.7-1.7" />
  </Svg>
);

// POCKET — blind rectangular recess machined into a top face.
export const PocketIcon = (props) => (
  <Svg {...props}>
    {/* block with a rectangular recess in the top face */}
    <path d="M3 8l3-3h15v13l-3 3H3z" />
    <path d="M3 8h15v13M18 8l3-3" />
    {/* recessed pocket floor + walls */}
    <path d="M7 11h7v6H7z" />
    <path d="M7 11l1.4-1.4h7L14 11" />
  </Svg>
);

// HOLE (simple / wizard) — drilled bore with centre cross-hair.
export const HoleIcon = (props) => (
  <Svg {...props}>
    {/* face the hole is in */}
    <path d="M4 5h16v14H4z" />
    {/* bore */}
    <circle cx="12" cy="12" r="4" />
    {/* centre mark */}
    <path d="M12 6.5v3M12 14.5v3M6.5 12h3M14.5 12h3" />
  </Svg>
);

// COUNTERBORE HOLE — stepped bore: wide flat-bottomed recess over a pilot.
export const CounterboreHoleIcon = (props) => (
  <Svg {...props}>
    {/* section view of a counterbored hole (axis = vertical centre) */}
    <path d="M12 3v18" strokeDasharray="2.2 2" />
    {/* left wall: wide step down to a narrow pilot */}
    <path d="M5 4v6h2.5v11" />
    {/* right wall mirrored */}
    <path d="M19 4v6h-2.5v11" />
    {/* top face edges */}
    <path d="M3 4h4M17 4h4" />
  </Svg>
);

// COUNTERSINK HOLE — conical 82°/90° seat tapering into a pilot bore.
export const CountersinkHoleIcon = (props) => (
  <Svg {...props}>
    {/* axis */}
    <path d="M12 3v18" strokeDasharray="2.2 2" />
    {/* left wall: cone seat angling down into a straight pilot */}
    <path d="M5 4l2.5 6v11" />
    {/* right wall mirrored */}
    <path d="M19 4l-2.5 6v11" />
    {/* top face edges */}
    <path d="M3 4h4M17 4h4" />
  </Svg>
);

// THREADED / TAPPED HOLE — bore with helical thread crests on the wall.
export const ThreadedHoleIcon = (props) => (
  <Svg {...props}>
    {/* axis */}
    <path d="M12 3v18" strokeDasharray="2.2 2" />
    {/* bore walls */}
    <path d="M7 4v17M17 4v17" />
    <path d="M4 4h6M14 4h6" />
    {/* thread crests (alternating ticks = tapped thread) */}
    <path d="M7 8h2M15 10h2M7 12h2M15 14h2M7 16h2" />
  </Svg>
);

// SHELL — solid box hollowed to a thin wall (open top, inner cavity).
export const ShellIcon = (props) => (
  <Svg {...props}>
    {/* outer box, open at the top */}
    <path d="M5 6v13h14V6" />
    {/* inner cavity wall (the removed interior) showing wall thickness */}
    <path d="M8 6v10h8V6" />
    {/* top rim showing remaining wall thickness */}
    <path d="M5 6h3M16 6h3" />
  </Svg>
);

/* ════════════════════════════════════════════════════════════════════════
   EDGE / FACE MODIFIERS
   ════════════════════════════════════════════════════════════════════════ */

// FILLET — sharp corner rounded; original corner ghosted; radius shown.
export const FilletIcon = (props) => (
  <Svg {...props}>
    {/* solid corner with a rounded (filleted) edge */}
    <path d="M5 20V11a6 6 0 0 1 6-6h9" />
    {/* ghost of the original square corner */}
    <path d="M5 5h6M5 5v6" strokeDasharray="2 1.8" />
    {/* radius callout from arc centre */}
    <circle cx="11" cy="11" r="0.9" fill="currentColor" stroke="none" />
    <path d="M11 11l-4.2-4.2" />
  </Svg>
);

// VARIABLE FILLET — radius that varies along the edge (small→large arcs).
export const VariableFilletIcon = (props) => (
  <Svg {...props}>
    {/* edge being rounded with a growing radius */}
    <path d="M4 20V8a3 3 0 0 1 3-3" />
    <path d="M4 20a12 12 0 0 1 12-12" />
    {/* control points marking the varying radii along the edge */}
    <circle cx="4" cy="14" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="8.5" cy="9" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="16" cy="8" r="0.9" fill="currentColor" stroke="none" />
    {/* ghost square corner */}
    <path d="M4 5h3M4 5v3" strokeDasharray="2 1.8" />
  </Svg>
);

// CHAMFER — corner sliced off by a straight bevel; ghost corner shown.
export const ChamferIcon = (props) => (
  <Svg {...props}>
    {/* solid corner with a bevelled (chamfered) edge */}
    <path d="M5 20V11l6-6h9" />
    {/* ghost of the original square corner removed by the bevel */}
    <path d="M5 5h6M5 5v6" strokeDasharray="2 1.8" />
    {/* bevel distance ticks */}
    <path d="M5 8.5l3.5 3.5" strokeDasharray="2 1.6" />
  </Svg>
);

// DRAFT — face tilted by a small angle (mould pull) with neutral plane.
export const DraftIcon = (props) => (
  <Svg {...props}>
    {/* neutral plane (parting line) */}
    <path d="M3 19h18" />
    {/* drafted face tilting away from vertical */}
    <path d="M7 19V6l4-2" />
    {/* vertical reference + draft-angle arc */}
    <path d="M7 19V4" strokeDasharray="2 1.8" />
    <path d="M7 8a4 4 0 0 1 1.6 .9" />
    {/* pull-direction arrow up the face */}
    <path d="M16 18V7M14.4 8.6 16 7l1.6 1.6" />
  </Svg>
);

/* ════════════════════════════════════════════════════════════════════════
   STRUCTURAL THIN FEATURES
   ════════════════════════════════════════════════════════════════════════ */

// RIB — thin reinforcing web grown from a sketch line under a wall.
export const RibIcon = (props) => (
  <Svg {...props}>
    {/* L-shaped / spanning walls the rib braces between */}
    <path d="M4 4v16h16" />
    {/* the rib: a thin triangular brace between the two walls */}
    <path d="M4 4l11 16" />
    <path d="M6.5 4l11 16" />
    {/* thickness hatch on the rib */}
    <path d="M9 9l1.6 2.4" />
  </Svg>
);

// WEB — flat thin sheet filling a gap between bounding faces.
export const WebIcon = (props) => (
  <Svg {...props}>
    {/* two flanges with a thin web bridging them (I/T section) */}
    <path d="M4 4h6M14 4h6" />
    <path d="M4 20h6M14 20h6" />
    {/* the thin web panel */}
    <path d="M10 4h4v16h-4z" />
    {/* hatch indicating the added thin material */}
    <path d="M10.5 8h3M10.5 12h3M10.5 16h3" />
  </Svg>
);

/* ════════════════════════════════════════════════════════════════════════
   PATTERNS, MIRROR, COMBINE, SCALE, FLEX
   ════════════════════════════════════════════════════════════════════════ */

// LINEAR PATTERN — a seed feature repeated along a direction with arrow.
export const LinearPatternIcon = (props) => (
  <Svg {...props}>
    {/* seed instance (solid) */}
    <rect x="3" y="5" width="4.5" height="4.5" rx="0.5" />
    {/* repeated instances along +X */}
    <rect x="9.5" y="5" width="4.5" height="4.5" rx="0.5" />
    <rect x="16" y="5" width="4.5" height="4.5" rx="0.5" />
    {/* direction / spacing arrow */}
    <path d="M3 16h17M17.5 13.8 20 16l-2.5 2.2" />
  </Svg>
);

// CIRCULAR PATTERN — feature copied around an axis on a bolt circle.
export const CircularPatternIcon = (props) => (
  <Svg {...props}>
    {/* bolt circle */}
    <circle cx="12" cy="12" r="8" strokeDasharray="2.2 2.2" />
    {/* axis centre */}
    <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
    {/* instances arrayed around the ring */}
    <circle cx="12" cy="4" r="1.6" />
    <circle cx="18.9" cy="16" r="1.6" />
    <circle cx="5.1" cy="16" r="1.6" />
    {/* rotation arrow */}
    <path d="M16.7 6.4a6 6 0 0 1 1.3 2.6" />
    <path d="M18.6 7.2 18 9.4l-2.1-.7" />
  </Svg>
);

// MIRROR FEATURE — feature reflected across a dashed mirror plane.
export const MirrorIcon = (props) => (
  <Svg {...props}>
    {/* mirror plane */}
    <path d="M12 3v18" strokeDasharray="2.4 2.2" />
    {/* original feature (left) */}
    <path d="M9 7l-6 2 2 6h4z" />
    {/* mirrored copy (right) */}
    <path d="M15 7l6 2-2 6h-4z" />
  </Svg>
);

// COMBINE — boolean of two bodies (overlapping → merged) with ∪ hint.
export const CombineIcon = (props) => (
  <Svg {...props}>
    {/* two overlapping bodies merged into one volume */}
    <rect x="3" y="7" width="11" height="11" rx="1" />
    <rect x="10" y="4" width="11" height="11" rx="1" />
    {/* merge node where they join */}
    <circle cx="12" cy="14.5" r="0.9" fill="currentColor" stroke="none" />
  </Svg>
);

// SCALE — body resized about an anchor; nested frame + diagonal arrow.
export const ScaleIcon = (props) => (
  <Svg {...props}>
    {/* original body */}
    <rect x="4" y="11" width="7" height="7" rx="0.5" />
    {/* scaled-up target frame */}
    <rect x="4" y="4" width="16" height="14" rx="0.5" strokeDasharray="2.2 2" />
    {/* scale diagonal arrow from anchor */}
    <path d="M11 11l8 6M19 12.6V17h-4.4" />
  </Svg>
);

// FLEX — body bent/twisted about a trim plane (deformation).
export const FlexIcon = (props) => (
  <Svg {...props}>
    {/* straight reference of the un-flexed bar */}
    <path d="M3 18h6" />
    {/* the body flexing (bending) up around a hinge */}
    <path d="M3 18V8a3 3 0 0 1 3-3h13" />
    {/* trim / bend plane */}
    <path d="M9 3v18" strokeDasharray="2.2 2" />
    {/* bend-angle arrow */}
    <path d="M14 5l2.2-1.2M14 5l.3 2.4" />
  </Svg>
);

/* ════════════════════════════════════════════════════════════════════════
   ID → COMPONENT MAP  (canonical app ids + sensible aliases)
   ════════════════════════════════════════════════════════════════════════ */

const FEATURE_ICONS = {
  // ── Extrude / pad / boss ─────────────────────────────────────────────
  'solid.extrude':      ExtrudeIcon,
  'extrude':            ExtrudeIcon,
  'pad':                ExtrudeIcon,
  'extrudeProfile':     ExtrudeIcon,
  'boss':               BossIcon,
  'boss-extrude':       BossIcon,
  'bossExtrude':        BossIcon,
  'solid.boss':         BossIcon,

  // ── Revolve ──────────────────────────────────────────────────────────
  'solid.revolve':      RevolveIcon,
  'revolve':            RevolveIcon,
  'revolveProfile':     RevolveIcon,

  // ── Sweep ────────────────────────────────────────────────────────────
  'solid.sweep':        SweepIcon,
  'sweep':              SweepIcon,

  // ── Loft ─────────────────────────────────────────────────────────────
  'solid.loft':         LoftIcon,
  'loft':               LoftIcon,

  // ── Thicken / wrap / dome ────────────────────────────────────────────
  'solid.thicken':      ThickenIcon,
  'thicken':            ThickenIcon,
  'thickenSurface':     ThickenIcon,
  'wrap':               WrapIcon,
  'solid.wrap':         WrapIcon,
  'dome':               DomeIcon,
  'solid.dome':         DomeIcon,

  // ── Cut / pocket ─────────────────────────────────────────────────────
  'cut':                CutIcon,
  'extrude-cut':        CutIcon,
  'extrudeCut':         CutIcon,
  'solid.cut':          CutIcon,
  'pocket':             PocketIcon,
  'mfg.pocket':         PocketIcon,
  'solid.pocket':       PocketIcon,

  // ── Holes (simple / counterbore / countersink / threaded) ────────────
  'solid.hole':         HoleIcon,
  'hole':               HoleIcon,
  'holeWizard':         HoleIcon,
  'simple-hole':        HoleIcon,
  'counterbore':        CounterboreHoleIcon,
  'counterbore-hole':   CounterboreHoleIcon,
  'hole.counterbore':   CounterboreHoleIcon,
  'countersink':        CountersinkHoleIcon,
  'countersink-hole':   CountersinkHoleIcon,
  'hole.countersink':   CountersinkHoleIcon,
  'solid.thread':       ThreadedHoleIcon,
  'thread':             ThreadedHoleIcon,
  'threaded':           ThreadedHoleIcon,
  'tapped':             ThreadedHoleIcon,
  'threaded-hole':      ThreadedHoleIcon,
  'hole.tapped':        ThreadedHoleIcon,

  // ── Shell ────────────────────────────────────────────────────────────
  'solid.shell':        ShellIcon,
  'shell':              ShellIcon,

  // ── Fillet / variable fillet / chamfer / draft ───────────────────────
  'solid.fillet':       FilletIcon,
  'fillet':             FilletIcon,
  'variable-fillet':    VariableFilletIcon,
  'variableFillet':     VariableFilletIcon,
  'solid.variableFillet': VariableFilletIcon,
  'solid.chamfer':      ChamferIcon,
  'chamfer':            ChamferIcon,
  'solid.draft':        DraftIcon,
  'draft':              DraftIcon,
  'draftFaces':         DraftIcon,

  // ── Rib / web ────────────────────────────────────────────────────────
  'solid.rib':          RibIcon,
  'rib':                RibIcon,
  'web':                WebIcon,
  'solid.web':          WebIcon,

  // ── Patterns / mirror ────────────────────────────────────────────────
  'pattern.linear':     LinearPatternIcon,
  'linear-pattern':     LinearPatternIcon,
  'linearPattern':      LinearPatternIcon,
  'pattern.circular':   CircularPatternIcon,
  'circular-pattern':   CircularPatternIcon,
  'circularPattern':    CircularPatternIcon,
  'pattern.mirror':     MirrorIcon,
  'mirror':             MirrorIcon,
  'mirror-feature':     MirrorIcon,
  'mirrorFeature':      MirrorIcon,
  'mirrorPattern':      MirrorIcon,

  // ── Combine / scale / flex ───────────────────────────────────────────
  'combine':            CombineIcon,
  'solid.combine':      CombineIcon,
  'scale':              ScaleIcon,
  'solid.scale':        ScaleIcon,
  'flex':               FlexIcon,
  'solid.flex':         FlexIcon,
};

export default FEATURE_ICONS;
