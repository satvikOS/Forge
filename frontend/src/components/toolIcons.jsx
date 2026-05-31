/**
 * toolIcons — hand-designed inline-SVG icons for the most-used ribbon
 * tools, replacing the unicode-glyph stand-ins (□ O ⬡ ⌒ …). Each icon
 * is a small 16×16 SVG with consistent 1.5-px stroke, neutral colour
 * (inherits `currentColor` so CSS hover/active states still drive the
 * paint), and a tiny accent-fill for primitives.
 *
 * The RibbonToolbar checks each tool entry for a `Icon` field (this
 * module exports a name→component map); if present, the ribbon
 * renders the SVG instead of the legacy glyph string. Tools without
 * an entry here continue to use their unicode glyph — additive, no
 * regression risk.
 */

import React from 'react';

const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

// Primitive solids — Box / Cylinder / Sphere / Cone / Torus
const Box = (p) => (
  <svg {...base} {...p}>
    <path d="M2.5 5.2L8 2.4l5.5 2.8M2.5 5.2v5.6L8 13.6m-5.5-2.8L8 13.6m5.5-8.4v5.6L8 13.6m5.5-8.4L8 8M2.5 5.2L8 8m0 5.6V8" />
  </svg>
);
const Cylinder = (p) => (
  <svg {...base} {...p}>
    <ellipse cx="8" cy="3.5" rx="4.5" ry="1.4" />
    <ellipse cx="8" cy="12.5" rx="4.5" ry="1.4" />
    <path d="M3.5 3.5v9M12.5 3.5v9" />
  </svg>
);
const Sphere = (p) => (
  <svg {...base} {...p}>
    <circle cx="8" cy="8" r="5.5" />
    <ellipse cx="8" cy="8" rx="5.5" ry="2" />
    <path d="M8 2.5v11" />
  </svg>
);
const Cone = (p) => (
  <svg {...base} {...p}>
    <path d="M8 2.5L13 12.5M8 2.5L3 12.5" />
    <ellipse cx="8" cy="12.5" rx="5" ry="1.3" />
  </svg>
);
const Torus = (p) => (
  <svg {...base} {...p}>
    <ellipse cx="8" cy="8" rx="6" ry="3" />
    <path d="M3 8c0-1.3 2.2-2.4 5-2.4S13 6.7 13 8" />
  </svg>
);

// Sketch primitives — Line / Circle / Arc / Rectangle / Polygon
const Line = (p) => (
  <svg {...base} {...p}>
    <path d="M2.5 13.5L13.5 2.5" />
    <circle cx="2.5" cy="13.5" r="1" fill="currentColor" />
    <circle cx="13.5" cy="2.5" r="1" fill="currentColor" />
  </svg>
);
const Circle = (p) => (
  <svg {...base} {...p}>
    <circle cx="8" cy="8" r="5.5" />
    <circle cx="8" cy="8" r="0.8" fill="currentColor" />
  </svg>
);
const Arc = (p) => (
  <svg {...base} {...p}>
    <path d="M2.5 12.5A6 6 0 0 1 13.5 12.5" />
    <circle cx="2.5" cy="12.5" r="0.8" fill="currentColor" />
    <circle cx="13.5" cy="12.5" r="0.8" fill="currentColor" />
  </svg>
);
const Rectangle = (p) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="3.5" width="11" height="9" />
  </svg>
);
const Polygon = (p) => (
  <svg {...base} {...p}>
    <path d="M8 2L13.5 5.5V10.5L8 14L2.5 10.5V5.5L8 2z" />
  </svg>
);

// Feature ops — Extrude / Revolve / Sweep / Loft / Fillet / Chamfer / Shell / Mirror / Pattern / Boolean
const Extrude = (p) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="9" width="6" height="4.5" />
    <path d="M8.5 13.5L13.5 9M8.5 9L13.5 4.5M2.5 9L7.5 4.5h6L8.5 9" />
  </svg>
);
const Revolve = (p) => (
  <svg {...base} {...p}>
    <path d="M3 8L3 14M3 8c0-3 2-5 4-5s4 2 4 5M3 14c0 .7 1.8 1.3 4 1.3" />
    <path d="M13 2.5v11" strokeDasharray="1.5 1.5" />
  </svg>
);
const Sweep = (p) => (
  <svg {...base} {...p}>
    <path d="M2.5 11.5C5 11.5 5 4.5 8 4.5C11 4.5 11 11.5 13.5 11.5" />
    <circle cx="2.5" cy="11.5" r="1.3" fill="currentColor" />
  </svg>
);
const Loft = (p) => (
  <svg {...base} {...p}>
    <ellipse cx="4" cy="12.5" rx="2.5" ry="1" />
    <ellipse cx="12" cy="3.5" rx="1.5" ry="0.7" />
    <path d="M1.5 12.5L10.5 3.5M6.5 12.5L13.5 3.5" />
  </svg>
);
const Fillet = (p) => (
  <svg {...base} {...p}>
    <path d="M2.5 13.5V8a5.5 5.5 0 0 1 5.5-5.5h5.5" />
    <path d="M2.5 13.5h2.5M11 2.5v2.5" strokeDasharray="1 1.2" />
  </svg>
);
const Chamfer = (p) => (
  <svg {...base} {...p}>
    <path d="M2.5 13.5V7L7 2.5h6.5" />
    <path d="M2.5 13.5h2.5M11 2.5v2.5" strokeDasharray="1 1.2" />
  </svg>
);
const Shell = (p) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="2.5" width="11" height="11" />
    <rect x="5" y="5" width="6" height="6" />
  </svg>
);
const Mirror = (p) => (
  <svg {...base} {...p}>
    <path d="M2.5 4l3 4-3 4M13.5 4l-3 4 3 4" />
    <path d="M8 1.5v13" strokeDasharray="1.5 1.2" />
  </svg>
);
const Pattern = (p) => (
  <svg {...base} {...p}>
    <rect x="2" y="2" width="3.5" height="3.5" />
    <rect x="6.25" y="2" width="3.5" height="3.5" />
    <rect x="10.5" y="2" width="3.5" height="3.5" />
    <rect x="2" y="6.25" width="3.5" height="3.5" />
    <rect x="6.25" y="6.25" width="3.5" height="3.5" />
    <rect x="10.5" y="6.25" width="3.5" height="3.5" />
    <rect x="2" y="10.5" width="3.5" height="3.5" />
    <rect x="6.25" y="10.5" width="3.5" height="3.5" />
    <rect x="10.5" y="10.5" width="3.5" height="3.5" />
  </svg>
);
const Boolean = (p) => (
  <svg {...base} {...p}>
    <circle cx="6" cy="8" r="4.5" />
    <circle cx="10" cy="8" r="4.5" />
  </svg>
);

// File ops — Save / Open / Bundle / Snapshot
const Save = (p) => (
  <svg {...base} {...p}>
    <path d="M3 3h8l2 2v8H3z" />
    <path d="M5 3v3.5h6V3M5 13v-4h6v4" />
  </svg>
);
const Open = (p) => (
  <svg {...base} {...p}>
    <path d="M2.5 5l1-1.5h5L9.5 5h4v8.5h-11z" />
  </svg>
);
const Bundle = (p) => (
  <svg {...base} {...p}>
    <rect x="2.5" y="3.5" width="11" height="10" />
    <path d="M6.5 3.5v3M6.5 6.5h3" />
    <path d="M2.5 9h11" />
  </svg>
);

export const TOOL_ICONS = {
  // Primitives
  'Box': Box,
  'Cylinder': Cylinder,
  'Sphere': Sphere,
  'Cone': Cone,
  'Torus': Torus,
  // Sketch
  'Line': Line,
  'Circle': Circle,
  'Arc': Arc,
  'Rectangle': Rectangle,
  'Center Rectangle': Rectangle,
  'Polygon': Polygon,
  // Features
  'Extrude': Extrude,
  'Extrude Boss': Extrude,
  'Revolve': Revolve,
  'Revolve Boss': Revolve,
  'Sweep': Sweep,
  'Sweep Boss': Sweep,
  'Loft': Loft,
  'Loft Boss': Loft,
  'Fillet': Fillet,
  'Variable Fillet': Fillet,
  'Chamfer': Chamfer,
  'Shell': Shell,
  'Mirror': Mirror,
  'Mirror Feature': Mirror,
  'Linear Pattern': Pattern,
  'Circular Pattern': Pattern,
  'Pattern Feature': Pattern,
  'Boolean': Boolean,
  // File
  'Save Snapshot': Save,
  'Load Snapshot': Open,
  'Export Project Bundle': Bundle,
};

export default TOOL_ICONS;
