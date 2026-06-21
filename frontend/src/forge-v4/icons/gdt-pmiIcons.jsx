// Forge — GD&T / PMI category icon set.
//
// Hand-authored, Siemens-NX / Dassault-CATIA / SolidWorks toolbar-grade
// monochrome SVG glyphs for the geometric-dimensioning-&-tolerancing and
// product-manufacturing-information toolset. Every glyph depicts the
// ACTUAL geometric control the way a drafting toolbar would: the ASME
// Y14.5 / ISO 1101 characteristic symbol set inside / framing real
// geometry (a feature-control-frame, a datum triangle, a toleranced
// surface, a measured zone), so a real engineer recognizes the op from
// the picture alone.
//
// ICON STANDARD (identical across every category):
//   <svg viewBox="0 0 24 24" width={size||18} height={size||18}
//        fill="none" stroke="currentColor" strokeWidth={1.5}
//        strokeLinecap="round" strokeLinejoin="round" {...props}>
//   Monochrome (currentColor only — no fills, no color). All content
//   kept inside x,y ∈ [2,22] (2 px safe padding). Consistent visual
//   weight + complexity. Pure presentational components — no logic.
//
// Keys match the REAL tool / command / characteristic ids used in the
// app (frontend/src/ai/ForgeToolBridge.js  gdt.* verbs + part.annotate-pmi;
// frontend/src/forge-v4 GdtFcf.jsx / GdtFramePanel.jsx / PMIAnnotations.jsx
// / SurfaceFinish.jsx / DatumTargetSymbol.jsx symbol catalogs; Menus.jsx
// tools.pmiAnnotations / tools.gdtFrames). Sensible aliases are added so
// kebab-case, camelCase and namespaced callsites all resolve.
//
// Usage:
//   import gdtPmiIcons, { DatumFeature } from
//     'forge-v4/icons/gdt-pmiIcons.jsx';
//   const Glyph = gdtPmiIcons['gdt.feature-control-frame'];
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

/* ───────────────────────── Datums & frames ───────────────────────── */

// Datum feature — the filled ASME datum triangle on a short leader with
// the labelled reference square ("A").
export const DatumFeature = (props) => (
  <Svg {...props}>
    <path d="M5 20h6" />
    <path d="M8 20l-2.2 2.5h4.4z" />
    <path d="M8 20v-3" />
    <rect x="12.5" y="13.5" width="7" height="7" rx="0.6" />
    <path d="M14.4 18.4l1.6-3.4 1.6 3.4M14.9 17.3h2.2" />
  </Svg>
);

// Datum target — the divided circle target symbol (lower half = target
// area id, upper half = datum/point) on its leader, the way Y14.5 §4.24
// draws a movable datum target.
export const DatumTarget = (props) => (
  <Svg {...props}>
    <circle cx="9" cy="9" r="6" />
    <path d="M3 9h12" />
    <path d="M5.2 11.6l2.2 2.2M5.2 13.8l2.2-2.2" />
    <path d="M14 14l4.5 4.5" />
    <path d="M16 11.5l-1.5 1.5 1.5 1.5" />
  </Svg>
);

// Feature-control-frame — the canonical multi-cell GD&T frame:
// |⌖|⌀ tol|A|B| — divided box with a position glyph in the first cell.
export const FeatureControlFrame = (props) => (
  <Svg {...props}>
    <rect x="2.5" y="8" width="19" height="8" rx="0.6" />
    <path d="M9 8v8M13 8v8M17 8v8" />
    <circle cx="5.75" cy="12" r="2.4" />
    <path d="M5.75 9.1v5.8M2.85 12h5.8" />
    <path d="M14.6 12h1.8M19 12h0.01" />
  </Svg>
);

/* ───────────── Location tolerances (Y14.5 'location' family) ─────────── */

// Position (true position) — crosshair circle ⊕/⌖: the toleranced axis
// centered in its diametral zone.
export const Position = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="7.5" />
    <path d="M12 2.5v19M2.5 12h19" />
  </Svg>
);

// Concentricity / coaxiality — two concentric circles ◎ sharing one axis,
// with the common centre marked.
export const Concentricity = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="8" />
    <circle cx="12" cy="12" r="3.4" />
    <circle cx="12" cy="12" r="0.6" />
  </Svg>
);

// Symmetry — the ⌯ symbol: a centre line with two equal-distance bars
// straddling it (feature symmetric about the datum plane).
export const Symmetry = (props) => (
  <Svg {...props}>
    <path d="M12 3v18" />
    <path d="M5 8h14M5 16h14" />
    <path d="M8 11.5h8M8 14.5h8" />
  </Svg>
);

/* ─────────────── Form tolerances (Y14.5 'form' family) ──────────────── */

// Flatness — the ⏥ parallelogram: a single planar surface confined
// between two parallel planes (shown edge-on as a tilted band).
export const Flatness = (props) => (
  <Svg {...props}>
    <path d="M6 16l5-8h7l-5 8z" />
    <path d="M4 19.5h16" />
  </Svg>
);

// Straightness — a line element constrained inside a narrow tolerance
// zone (the line between two close straight rails).
export const Straightness = (props) => (
  <Svg {...props}>
    <path d="M3 8.5h18M3 15.5h18" />
    <path d="M3 12h18" />
  </Svg>
);

// Circularity / roundness — the ○ glyph: a round cross-section trapped
// between two concentric tolerance circles.
export const Circularity = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="6" strokeDasharray="1.4 2" />
  </Svg>
);

// Cylindricity — the ⌭ glyph: a cylinder confined between two coaxial
// cylindrical zones (parallel slanted rails through the round symbol).
export const Cylindricity = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M7 5l-3 14M14 5l-3 14" />
  </Svg>
);

/* ────────── Profile tolerances (Y14.5 'profile' family) ──────────── */

// Profile of a line — the ⌒ open arc: a 2-D line element held within a
// profile zone, with the tolerance band traced around it.
export const ProfileLine = (props) => (
  <Svg {...props}>
    <path d="M4 16a8 8 0 0 1 16 0" />
    <path d="M4 19h16" />
  </Svg>
);

// Profile of a surface — the ⌓ closed-bottom arc: a whole surface bounded
// by a profile zone (arc closed off across the base).
export const ProfileSurface = (props) => (
  <Svg {...props}>
    <path d="M4 17a8 8 0 0 1 16 0" />
    <path d="M4 17h16" />
    <path d="M4 20h16" strokeDasharray="1.4 2" />
  </Svg>
);

/* ────── Orientation tolerances (Y14.5 'orientation' family) ──────── */

// Perpendicularity — the ⟂ glyph: a feature normal (90°) to its datum,
// with the right-angle square marked.
export const Perpendicularity = (props) => (
  <Svg {...props}>
    <path d="M12 3v17M4 20h16" />
    <path d="M12 16h4v4" />
  </Svg>
);

// Parallelism — the ∥ glyph: the toleranced surface parallel to its
// datum (two equal-spaced parallel rails).
export const Parallelism = (props) => (
  <Svg {...props}>
    <path d="M7 4L4 20M16 4l-3 16" />
  </Svg>
);

// Angularity — the ∠ glyph: a feature at a specified basic angle to the
// datum, with the angle vertex and base shown.
export const Angularity = (props) => (
  <Svg {...props}>
    <path d="M4 20h16" />
    <path d="M4 20L18 5" />
    <path d="M4 20a7 7 0 0 0 5-2.6" />
  </Svg>
);

/* ──────────────── Runout (Y14.5 'runout' family) ───────────────── */

// Circular runout — the single ↗ arrow: surface variation as the part
// rotates about its datum axis (one slanted arrow off the axis circle).
export const Runout = (props) => (
  <Svg {...props}>
    <circle cx="9.5" cy="14.5" r="5" />
    <path d="M9.5 14.5L20 4" />
    <path d="M20 4h-4.5M20 4v4.5" />
  </Svg>
);

// Total runout — the double ↗↗ arrows: full-surface runout over the whole
// feature (two parallel slanted arrows).
export const TotalRunout = (props) => (
  <Svg {...props}>
    <path d="M5 19L14 10M14 10h-4M14 10v4" />
    <path d="M10 19L19 10M19 10h-4M19 10v4" />
    <path d="M3 21h18" />
  </Svg>
);

/* ────────────────── Material-condition modifiers ─────────────────── */

// MMC — Maximum Material Condition Ⓜ : the circled M modifier.
export const ModifierMMC = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8 16V8l4 5 4-5v8" />
  </Svg>
);

// LMC — Least Material Condition Ⓛ : the circled L modifier.
export const ModifierLMC = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 8v8h5" />
  </Svg>
);

// RFS — Regardless of Feature Size (Ⓢ, modifier absent in current Y14.5):
// the circled S, the way legacy frames mark RFS.
export const ModifierRFS = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M14.5 9.5a3 2.4 0 0 0-3-1.5c-1.6 0-2.6.9-2.6 2 0 2.6 5.6 1.4 5.6 4 0 1.2-1.1 2-2.7 2a3.2 2.6 0 0 1-3.1-1.6" />
  </Svg>
);

// Free state Ⓕ — the circled F modifier (non-rigid part, free condition).
export const ModifierFreeState = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="9" />
    <path d="M15 8H9.5v8M9.5 12h4.5" />
  </Svg>
);

/* ──────────────────── Other PMI annotations ──────────────────────── */

// Surface finish — the ISO 1302 check-mark surface-texture symbol with
// the Ra leader bar (machining tick on the surface).
export const SurfaceFinish = (props) => (
  <Svg {...props}>
    <path d="M4 20h16" />
    <path d="M9 20l3.5-6 3.5 11" />
    <path d="M16 14.5h4" />
  </Svg>
);

// Basic dimension — a boxed (theoretically exact) dimension with its
// extension/dimension lines and arrowheads.
export const BasicDimension = (props) => (
  <Svg {...props}>
    <rect x="7.5" y="9" width="9" height="6" rx="0.6" />
    <path d="M4 6v5M20 6v5" />
    <path d="M4 8.5h3.5M16.5 8.5H20" />
    <path d="M5.6 7.3l-1.6 1.2 1.6 1.2M18.4 7.3l1.6 1.2-1.6 1.2" />
  </Svg>
);

// PMI annotations panel — a part face carrying a stacked PMI note
// (annotation flag + frame on a leader to a surface).
export const PmiAnnotations = (props) => (
  <Svg {...props}>
    <path d="M3 19h7" />
    <path d="M10 19l4-9" />
    <rect x="12" y="3.5" width="9" height="5" rx="0.6" />
    <path d="M16 3.5v5" />
    <path d="M14 10l-4 9" strokeDasharray="0.1 3" />
  </Svg>
);

// Write GD&T to STEP — a feature-control-frame flowing into a document
// (PMI committed to an AP242 STEP file).
export const WriteStep = (props) => (
  <Svg {...props}>
    <rect x="2.5" y="6" width="11" height="5" rx="0.6" />
    <path d="M7 6v5" />
    <path d="M13.5 8.5h3.5" />
    <path d="M13 16h6m0 0l-2.4-2.4M19 16l-2.4 2.4" />
    <path d="M9 11v3.5h3" />
  </Svg>
);

// Position relative to a mating part — true-position crosshair circle
// referencing a second (mating) feature: the assembly-context op.
export const PositionRelativeToMate = (props) => (
  <Svg {...props}>
    <circle cx="8" cy="12" r="5.5" />
    <path d="M8 5v14M2.5 12h11" />
    <path d="M15 12h6m0 0l-2.2-2.2M21 12l-2.2 2.2" />
  </Svg>
);

// Concentric to a mating part — coaxiality of this bore to a mating
// axis: concentric circles tied to a datum-axis reference at right.
export const ConcentricToMate = (props) => (
  <Svg {...props}>
    <circle cx="9" cy="12" r="6.5" />
    <circle cx="9" cy="12" r="2.6" />
    <path d="M17.5 4v16" />
    <path d="M15.5 12h4" strokeDasharray="1.4 2" />
  </Svg>
);

/* ───────────────────────── id → component map ─────────────────────── */
// Canonical ids first, then aliases (kebab / camel / namespaced) that
// resolve to the same glyph, for complete category coverage.
const icons = {
  /* datums & frames */
  'datum-feature': DatumFeature,
  'datum': DatumFeature,
  'gdt.datum': DatumFeature,
  'gdt-datum': DatumFeature,
  'datum-target': DatumTarget,
  'gdt.datum-target': DatumTarget,
  'datumTarget': DatumTarget,
  'feature-control-frame': FeatureControlFrame,
  'fcf': FeatureControlFrame,
  'gdt.feature-control-frame': FeatureControlFrame,
  'gdt-fcf': FeatureControlFrame,
  'tools.gdtFrames': FeatureControlFrame,
  'gdtFrames': FeatureControlFrame,
  'gdt-frame': FeatureControlFrame,

  /* location */
  'position': Position,
  'truePosition': Position,
  'true-position': Position,
  'concentricity': Concentricity,
  'concentric': Concentricity,
  'coaxiality': Concentricity,
  'symmetry': Symmetry,
  'symmetric': Symmetry,

  /* form */
  'flatness': Flatness,
  'straightness': Straightness,
  'circularity': Circularity,
  'roundness': Circularity,
  'cylindricity': Cylindricity,

  /* profile */
  'profile-line': ProfileLine,
  'profileLine': ProfileLine,
  'profile-surface': ProfileSurface,
  'profileSurface': ProfileSurface,

  /* orientation */
  'perpendicularity': Perpendicularity,
  'perpendicular': Perpendicularity,
  'parallelism': Parallelism,
  'parallel': Parallelism,
  'angularity': Angularity,
  'angular': Angularity,

  /* runout */
  'runout': Runout,
  'runoutCircular': Runout,
  'circular-runout': Runout,
  'total-runout': TotalRunout,
  'totalRunout': TotalRunout,
  'runoutTotal': TotalRunout,

  /* material-condition modifiers */
  'mmc': ModifierMMC,
  'M': ModifierMMC,
  'modifier-mmc': ModifierMMC,
  'lmc': ModifierLMC,
  'L': ModifierLMC,
  'modifier-lmc': ModifierLMC,
  'rfs': ModifierRFS,
  'S': ModifierRFS,
  'modifier-rfs': ModifierRFS,
  'free-state': ModifierFreeState,
  'F': ModifierFreeState,
  'modifier-free-state': ModifierFreeState,

  /* other PMI */
  'surface-finish': SurfaceFinish,
  'surfaceFinish': SurfaceFinish,
  'basic-dimension': BasicDimension,
  'basicDimension': BasicDimension,
  'basic-dim': BasicDimension,
  'pmi-annotations': PmiAnnotations,
  'tools.pmiAnnotations': PmiAnnotations,
  'pmiAnnotations': PmiAnnotations,
  'part.annotate-pmi': PmiAnnotations,
  'gdt.write-step': WriteStep,
  'gdt-write-step': WriteStep,
  'write-step': WriteStep,
  'gdt.position-relative-to-mate': PositionRelativeToMate,
  'position-relative-to-mate': PositionRelativeToMate,
  'gdt.concentric-to-mate': ConcentricToMate,
  'concentric-to-mate': ConcentricToMate,
};

export default icons;
