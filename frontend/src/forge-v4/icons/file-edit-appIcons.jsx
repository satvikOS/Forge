// ArchDisc Forge — FILE / EDIT / APP icon set.
//
// Hand-authored, NX / CATIA / SolidWorks toolbar-grade monochrome glyphs for
// the file-edit-app command category. Every glyph is unique and literally
// depicts its operation the way a real MCAD toolbar would: New = blank sheet
// with a plus, Save-As = floppy with an arrow, Import-STEP = box with an
// inbound arrow + "STP" tab, Section/Measure-tool = caliper across a dimension,
// Suppress = feature frozen out of the tree, etc.
//
// STANDARD (identical across every category — this is what reads as "pro"):
//   <svg viewBox="0 0 24 24" width={size||18} height={size||18} fill="none"
//        stroke="currentColor" strokeWidth={1.5}
//        strokeLinecap="round" strokeLinejoin="round" {...rest}>
//   • monochrome (currentColor only — no fills/colours)
//   • all content kept within [2,22] (2px safe padding)
//   • consistent visual weight + complexity
//
// Keys match the REAL command/tool ids found in:
//   frontend/src/forge-v4/Menus.jsx (File / Edit / View / Tools)
//   frontend/src/forge-v4/BodyContextMenu.jsx (hide / isolate / suppress / …)
//   frontend/src/forge-v4/HierarchicalToolsMenu.jsx
//   frontend/src/ai/ForgeToolBridge.js
// Sensible aliases (bare ids, dotted ids, common synonyms) are wired to the
// same component at the bottom so callers using either spelling resolve.
//
// Default export: { '<toolId>': (props) => <svg/> }.  Each component is also
// a named export.  Pure presentational — no behaviour, no logic.

import React from 'react';

// Shared <svg> wrapper so every glyph is byte-identical on the standard.
const S = (props, children) => {
  const { size, ...rest } = props || {};
  return (
    <svg
      viewBox="0 0 24 24"
      width={(props && props.size) || 18}
      height={(props && props.size) || 18}
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
};

/* ──────────────────────────────────────────────────────────────────────────
   FILE
   ────────────────────────────────────────────────────────────────────────── */

// New — blank document with a folded corner and a plus.
export const NewDoc = (p) => S(p, (
  <>
    <path d="M6 3h7l5 5v13H6z" />
    <path d="M13 3v5h5" />
    <path d="M12 12v6M9 15h6" />
  </>
));

// Open — folder swinging open with a sheet lifting out.
export const Open = (p) => S(p, (
  <>
    <path d="M3 7a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v3H3z" />
    <path d="M3 12h18l-2.2 8a1 1 0 0 1-1 .8H6.2a1 1 0 0 1-1-.8z" />
  </>
));

// Open Project — folder with a "wrench/part" marker (a .forge project).
export const OpenProject = (p) => S(p, (
  <>
    <path d="M3 6a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
    <path d="M12 11l2 2-2 2M16 11l-2 2 2 2" />
  </>
));

// Recent Files — folder with a clock (history).
export const Recent = (p) => S(p, (
  <>
    <path d="M3 6a1 1 0 0 1 1-1h5l2 2h6" />
    <path d="M3 6v13a1 1 0 0 0 1 1h7" />
    <circle cx="17" cy="15" r="4.5" />
    <path d="M17 12.5V15l1.7 1.1" />
  </>
));

// Save — classic floppy disk (write to disk).
export const Save = (p) => S(p, (
  <>
    <path d="M4 4h12l4 4v12H4z" />
    <path d="M8 4v5h7V4" />
    <path d="M8 13h8v7H8z" />
  </>
));

// Save Project — floppy disk with a part chevron mark.
export const SaveProject = (p) => S(p, (
  <>
    <path d="M4 4h12l4 4v12H4z" />
    <path d="M8 4v5h7V4" />
    <path d="M9 16l2.5 2.5L15 14" />
  </>
));

// Save As — floppy disk with a "branch/new copy" arrow.
export const SaveAs = (p) => S(p, (
  <>
    <path d="M4 4h11l3 3v8" />
    <path d="M4 4v16h9" />
    <path d="M8 4v4h6V4" />
    <path d="M14 19h7M18 16l3 3-3 3" />
  </>
));

/* ── IMPORT ─────────────────────────────────────────────────────────────── */

// Import (generic) — a solid box with an arrow flying INTO it.
export const Import = (p) => S(p, (
  <>
    <path d="M14 4h6a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-6" />
    <path d="M3 12h11M9 7l5 5-5 5" />
  </>
));

// Import STEP — inbound arrow into a tagged "STP" tab.
export const ImportStep = (p) => S(p, (
  <>
    <path d="M11 5h9a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1h-9" />
    <path d="M15 12h6M15 12v-3M15 12v3M14 9h7v6h-7" opacity="0" />
    <path d="M3 12h9M8 8l4 4-4 4" />
    <path d="M14 9h7v6h-7z" />
  </>
));

// Import IGES — inbound arrow into a surface-patch tab.
export const ImportIges = (p) => S(p, (
  <>
    <path d="M3 12h9M8 8l4 4-4 4" />
    <path d="M14 8h7v8h-7z" />
    <path d="M14 11c3-2 4 2 7 0M14 14c3-2 4 2 7 0" />
  </>
));

// Import STL — inbound arrow into a faceted-triangle (mesh) tab.
export const ImportStl = (p) => S(p, (
  <>
    <path d="M3 12h9M8 8l4 4-4 4" />
    <path d="M17.5 7l4.5 8h-9z" />
    <path d="M17.5 7v8M13 15l9-4" opacity="0" />
    <path d="M17.5 11l4.5 4M17.5 11l-4 4" />
  </>
));

// Import BREP — inbound arrow into a wireframe cube tab.
export const ImportBrep = (p) => S(p, (
  <>
    <path d="M3 12h9M8 8l4 4-4 4" />
    <path d="M14 6l4-1 4 1v8l-4 1-4-1z" />
    <path d="M14 6l4 1 4-1M18 7v8" />
  </>
));

// Import DXF — inbound arrow into a 2D drawing tab.
export const ImportDxf = (p) => S(p, (
  <>
    <path d="M3 12h9M8 8l4 4-4 4" />
    <path d="M14 6h7v12h-7z" />
    <path d="M16 9l3 6M19 9l-3 6" />
  </>
));

/* ── EXPORT ─────────────────────────────────────────────────────────────── */

// Export (generic) — a solid box with an arrow flying OUT of it.
export const Export = (p) => S(p, (
  <>
    <path d="M10 4H4a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h6" />
    <path d="M21 12H10M16 7l5 5-5 5" />
  </>
));

// Export STEP — solid cube emitting an outbound "STP" arrow.
export const ExportStep = (p) => S(p, (
  <>
    <path d="M3 7l5-2 5 2v6l-5 2-5-2z" />
    <path d="M3 7l5 2 5-2M8 9v6" />
    <path d="M14 18h7M18 15l3 3-3 3" />
  </>
));

// Export IGES — surface patch emitting an outbound arrow.
export const ExportIges = (p) => S(p, (
  <>
    <path d="M3 5h9v9H3z" />
    <path d="M3 8c2-1.5 4 1.5 6 0M3 11c2-1.5 4 1.5 6 0" />
    <path d="M14 18h7M18 15l3 3-3 3" />
  </>
));

// Export STL — faceted mesh emitting an outbound arrow.
export const ExportStl = (p) => S(p, (
  <>
    <path d="M7 4l5 9H2z" />
    <path d="M7 8l5 5M7 8l-3 5" />
    <path d="M14 18h7M18 15l3 3-3 3" />
  </>
));

// Export BREP — wireframe cube emitting an outbound arrow.
export const ExportBrep = (p) => S(p, (
  <>
    <path d="M3 5l5-2 5 2v6l-5 2-5-2z" />
    <path d="M3 5l5 2 5-2M8 7v6" />
    <path d="M14 18h7M18 15l3 3-3 3" />
  </>
));

// Export PDF — a sheet stamped "PDF" sliding out.
export const ExportPdf = (p) => S(p, (
  <>
    <path d="M5 3h8l5 5v8M5 3v18h7" />
    <path d="M13 3v5h5" />
    <path d="M15 19h6M18 16l3 3-3 3" />
    <path d="M7 12h2a1 1 0 0 1 0 2H7zv-2" opacity="0" />
    <path d="M7 12h1.5a1 1 0 0 1 0 2H7v-2" />
  </>
));

// Export IFC — BIM building emitting an outbound arrow.
export const ExportIfc = (p) => S(p, (
  <>
    <path d="M3 20V8l5-3 5 3v12z" />
    <path d="M6 11h2M11 11h0M6 14h2M11 14h0M6 17h2M11 17h0" />
    <path d="M14 18h7M18 15l3 3-3 3" />
  </>
));

// Export AP242 — STEP cube with PMI annotation flag, outbound.
export const ExportAp242 = (p) => S(p, (
  <>
    <path d="M3 6l5-2 5 2v6l-5 2-5-2z" />
    <path d="M3 6l5 2 5-2M8 8v6" />
    <path d="M15 4v8M15 4l5 1.5L15 7" />
    <path d="M14 19h7M18 16l3 3-3 3" />
  </>
));

// Export Bundle — a zipped/strapped package emitting an arrow.
export const ExportBundle = (p) => S(p, (
  <>
    <path d="M3 8l6-3 6 3v8l-6 3-6-3z" />
    <path d="M9 5v14M3 8l6 3 6-3" />
    <path d="M8 9h2v2H8z" />
    <path d="M15 19h6M18 16l3 3-3 3" opacity="0" />
  </>
));

// Print — printer with a feed sheet (Print Preview / PDF).
export const Print = (p) => S(p, (
  <>
    <path d="M7 9V4h10v5" />
    <path d="M5 9h14a2 2 0 0 1 2 2v6h-4v3H7v-3H3v-6a2 2 0 0 1 2-2z" />
    <path d="M7 14h10v6H7z" />
    <circle cx="17.5" cy="12" r=".6" fill="currentColor" stroke="none" />
  </>
));

/* ──────────────────────────────────────────────────────────────────────────
   EDIT
   ────────────────────────────────────────────────────────────────────────── */

// Undo — curved arrow looping counter-clockwise back.
export const Undo = (p) => S(p, (
  <>
    <path d="M5 10h9a5 5 0 0 1 0 10h-3" />
    <path d="M5 10l4-4M5 10l4 4" />
  </>
));

// Redo — curved arrow looping clockwise forward.
export const Redo = (p) => S(p, (
  <>
    <path d="M19 10h-9a5 5 0 0 0 0 10h3" />
    <path d="M19 10l-4-4M19 10l-4 4" />
  </>
));

// Cut — scissors across a dashed cut-line.
export const Cut = (p) => S(p, (
  <>
    <circle cx="6" cy="7" r="2.5" />
    <circle cx="6" cy="17" r="2.5" />
    <path d="M8 8l13 8M8 16l13-8" />
    <path d="M8 12l-1 0" opacity="0" />
  </>
));

// Copy — two overlapping sheets.
export const Copy = (p) => S(p, (
  <>
    <path d="M9 9h10v11H9z" />
    <path d="M5 15H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1" />
  </>
));

// Paste — clipboard with a sheet on it.
export const Paste = (p) => S(p, (
  <>
    <path d="M6 5h2V4a2 2 0 0 1 4 0v1h2v3H6z" />
    <path d="M6 7H5a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1h-1" />
    <path d="M11 14h6v6h-6z" />
  </>
));

// Delete — trash can with a lid and slats.
export const Delete = (p) => S(p, (
  <>
    <path d="M4 6h16" />
    <path d="M9 6V4h6v2" />
    <path d="M6 6l1.2 14a1 1 0 0 0 1 .9h7.6a1 1 0 0 0 1-.9L18 6" />
    <path d="M10 10v7M14 10v7" />
  </>
));

// Duplicate — a part with a "+copy" offset clone.
export const Duplicate = (p) => S(p, (
  <>
    <path d="M4 8l5-3 5 3v6l-5 3-5-3z" />
    <path d="M4 8l5 3 5-3M9 11v6" />
    <path d="M17 6v8M21 10h-8" opacity="0" />
    <path d="M18 6v6M15 9h6" />
  </>
));

// Select All — full marquee with corner ticks.
export const SelectAll = (p) => S(p, (
  <>
    <path d="M4 4h16v16H4z" strokeDasharray="3 2.5" />
    <path d="M9 12l2 2 4-4" />
  </>
));

// Select None — empty marquee with a clear slash.
export const SelectNone = (p) => S(p, (
  <>
    <path d="M4 4h16v16H4z" strokeDasharray="3 2.5" />
    <path d="M8 8l8 8M16 8l-8 8" />
  </>
));

/* ──────────────────────────────────────────────────────────────────────────
   APP / SETTINGS / LIBRARY / DISPLAY
   ────────────────────────────────────────────────────────────────────────── */

// Settings / Preferences — gear with a centre hub.
export const Settings = (p) => S(p, (
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M5.5 18.5l2.1-2.1M16.4 7.6l2.1-2.1" />
  </>
));

// Materials Library — sphere swatch sitting on a labelled card stack.
export const Materials = (p) => S(p, (
  <>
    <circle cx="9" cy="9" r="4.5" />
    <path d="M5.5 6.5a3.2 3.2 0 0 1 5 1.2" />
    <path d="M4 16h16M4 19h16M4 16l1.5-2h13l1.5 2v3H4z" />
  </>
));

// Material Properties — sphere swatch with a property tag/grid.
export const MaterialProperties = (p) => S(p, (
  <>
    <circle cx="8.5" cy="8.5" r="5" />
    <path d="M5 6a3.5 3.5 0 0 1 5.5 1.3" />
    <path d="M14 15h7v6h-7z" />
    <path d="M14 18h7M17.5 15v6" />
  </>
));

// Appearance / Render — paint roller / shaded sphere with sheen.
export const Appearance = (p) => S(p, (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 3a9 9 0 0 1 0 18" fill="currentColor" stroke="none" />
    <path d="M8 7.5a4 4 0 0 1 2-1.3" />
  </>
));

// Render Room — camera/photo of a shaded sphere (path-traced render).
export const Render = (p) => S(p, (
  <>
    <path d="M3 8h3l1.5-2h5L17 8h4a0 0 0 0 1 0 0v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1z" />
    <circle cx="12" cy="13" r="4" />
    <path d="M12 9a4 4 0 0 1 0 8" fill="currentColor" stroke="none" />
  </>
));

// Units — a ruler segment with tick marks (mm/in).
export const Units = (p) => S(p, (
  <>
    <path d="M3 8h18v8H3z" />
    <path d="M7 8v4M11 8v3M15 8v4M19 8v3M9 8v2M13 8v2M17 8v2M5 8v2" />
  </>
));

// Measure Tool — engineering caliper with extension lines + arrows.
export const Measure = (p) => S(p, (
  <>
    <path d="M5 6v12M19 6v12" />
    <path d="M5 12h14" />
    <path d="M8 9l-3 3 3 3M16 9l3 3-3 3" />
  </>
));

// Search / Command Palette — magnifier over a list.
export const Search = (p) => S(p, (
  <>
    <circle cx="10" cy="10" r="6" />
    <path d="M14.5 14.5L20 20" />
    <path d="M8 10h4M10 8v4" opacity="0" />
  </>
));

// Help — life-ring / question in a circle.
export const Help = (p) => S(p, (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.2 9.2a3 3 0 0 1 5.6 1.3c0 2-2.8 2.3-2.8 4" />
    <circle cx="12" cy="17" r=".7" fill="currentColor" stroke="none" />
  </>
));

// Help / Docs — open book.
export const Docs = (p) => S(p, (
  <>
    <path d="M12 6C10 4.5 6.5 4.5 4 5.5v13C6.5 17.5 10 17.5 12 19" />
    <path d="M12 6c2-1.5 5.5-1.5 8-.5v13c-2.5-1-6-1-8 .5z" />
    <path d="M12 6v13" />
  </>
));

// Help / About — info "i" in a circle.
export const About = (p) => S(p, (
  <>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5" />
    <circle cx="12" cy="8" r=".8" fill="currentColor" stroke="none" />
  </>
));

// Shortcuts — keyboard keycap row.
export const Shortcuts = (p) => S(p, (
  <>
    <path d="M3 6h18v12H3z" />
    <path d="M6 9h0M9 9h0M12 9h0M15 9h0M18 9h0M6 12h0M9 12h0M12 12h0M15 12h0M18 12h0M8 15h8" />
  </>
));

// Account — user silhouette in a frame.
export const Account = (p) => S(p, (
  <>
    <circle cx="12" cy="9" r="3.5" />
    <path d="M5 20a7 7 0 0 1 14 0" />
  </>
));

/* ──────────────────────────────────────────────────────────────────────────
   TREE / DISPLAY STATE  (hide · show · isolate · suppress · layers)
   ────────────────────────────────────────────────────────────────────────── */

// Layers — stacked sheets/levels (layer manager).
export const Layers = (p) => S(p, (
  <>
    <path d="M12 3l9 5-9 5-9-5z" />
    <path d="M3 13l9 5 9-5" />
    <path d="M3 18l9 5 9-5" opacity="0" />
    <path d="M3 17l9 5 9-5" />
  </>
));

// Hide — crossed-out eye (turn body invisible).
export const Hide = (p) => S(p, (
  <>
    <path d="M3 12c2.5-4 6-6 9-6s6.5 2 9 6c-1 1.6-2.2 3-3.6 4" />
    <path d="M9.5 9.5a3.5 3.5 0 0 0 4.8 5" />
    <path d="M4 4l16 16" />
  </>
));

// Show — open eye with iris (make visible).
export const Show = (p) => S(p, (
  <>
    <path d="M3 12c2.5-4 6-6 9-6s6.5 2 9 6c-2.5 4-6 6-9 6s-6.5-2-9-6z" />
    <circle cx="12" cy="12" r="2.8" />
  </>
));

// Isolate — one highlighted part, neighbours ghosted away.
export const Isolate = (p) => S(p, (
  <>
    <path d="M9 9l3-1.5L15 9v4l-3 1.5L9 13z" />
    <path d="M9 9l3 1.5L15 9M12 10.5V15" />
    <path d="M4 5l1.5-.8M4 19l1.5.8M20 5l-1.5-.8M20 19l-1.5.8" />
  </>
));

// Suppress — feature greyed/frozen out of the tree (paused node).
export const Suppress = (p) => S(p, (
  <>
    <path d="M4 6l5-2.5L14 6v6l-5 2.5L4 12z" strokeDasharray="3 2" />
    <path d="M4 6l5 2.5L14 6M9 8.5V14" strokeDasharray="3 2" />
    <circle cx="18" cy="17" r="4" />
    <path d="M17 15.5v3M19 15.5v3" />
  </>
));

// Unsuppress / resume — feature reactivated (play node).
export const Unsuppress = (p) => S(p, (
  <>
    <path d="M4 6l5-2.5L14 6v6l-5 2.5L4 12z" />
    <path d="M4 6l5 2.5L14 6M9 8.5V14" />
    <circle cx="18" cy="17" r="4" />
    <path d="M17 15.3l3 1.7-3 1.7z" />
  </>
));

// Rename — edit pencil over a text label.
export const Rename = (p) => S(p, (
  <>
    <path d="M3 18v-2.5L13 5.5l2.5 2.5L5.5 18z" />
    <path d="M11.5 7.5l2.5 2.5" />
    <path d="M14 20h7" />
  </>
));

// Quit — door with an outbound arrow (exit app).
export const Quit = (p) => S(p, (
  <>
    <path d="M14 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h8" />
    <path d="M10 12h10M16 8l4 4-4 4" />
  </>
));

/* ──────────────────────────────────────────────────────────────────────────
   MAP  (real command/tool ids → component) + sensible aliases
   ────────────────────────────────────────────────────────────────────────── */

const icons = {
  // ── File ──
  'file.new': NewDoc,
  'file.open': Open,
  'file.openProject': OpenProject,
  'file.recent': Recent,
  'file.save': Save,
  'file.saveProject': SaveProject,
  'file.saveAs': SaveAs,

  // imports
  'file.import': Import,
  'file.importStep': ImportStep,
  'file.importIges': ImportIges,
  'file.importStl': ImportStl,
  'file.importBrep': ImportBrep,
  'file.importDxf': ImportDxf,
  'file.importJt': ImportBrep,
  'file.importParasolid': ImportBrep,

  // exports
  'file.export': Export,
  'file.exportStep': ExportStep,
  'file.exportIges': ExportIges,
  'file.exportStl': ExportStl,
  'file.exportBrep': ExportBrep,
  'file.exportPdf': ExportPdf,
  'file.exportIfc': ExportIfc,
  'file.exportAp242': ExportAp242,
  'file.exportBundle': ExportBundle,
  'tools.stlExport': ExportStl,
  'tools.ap242Export': ExportAp242,
  'tools.ifcExport': ExportIfc,
  'tools.dxf': ImportDxf,

  // print
  'tools.printPreview': Print,
  'file.print': Print,

  'file.settings': Settings,
  'file.quit': Quit,

  // ── Edit ──
  'edit.undo': Undo,
  'edit.redo': Redo,
  'edit.cut': Cut,
  'edit.copy': Copy,
  'edit.paste': Paste,
  'edit.delete': Delete,
  'edit.selectAll': SelectAll,
  'edit.selectNone': SelectNone,
  'duplicate': Duplicate,

  // ── App / settings / library / display ──
  'tools.settings': Settings,
  'tools.materials': Materials,
  'tools.materialdb': Materials,
  'tools.materialsBrowser': Materials,
  'tools.library': Materials,
  'tools.materialProperties': MaterialProperties,
  'material': MaterialProperties,
  'materialdb': Materials,
  'appearance': Appearance,
  'tools.themes': Appearance,
  'view.theme': Appearance,
  'tools.pathTracer': Render,
  'tools.units': Units,
  'tools.measure': Measure,
  'tools.search': Search,
  'tools.commandPalette': Search,
  'palette.open': Search,
  'tools.shortcuts': Shortcuts,
  'help.shortcuts': Shortcuts,
  'tools.account': Account,
  'tools.layers': Layers,

  // ── Help ──
  'help.docs': Docs,
  'help.about': About,

  // ── Tree / display state (context menu) ──
  'hide': Hide,
  'show': Show,
  'isolate': Isolate,
  'suppress': Suppress,
  'unsuppress': Unsuppress,
  'rename': Rename,
  'delete': Delete,

  // ── short-id aliases (bare verbs, common synonyms) ──
  'new': NewDoc,
  'open': Open,
  'save': Save,
  'saveAs': SaveAs,
  'save-as': SaveAs,
  'import': Import,
  'export': Export,
  'print': Print,
  'undo': Undo,
  'redo': Redo,
  'cut': Cut,
  'copy': Copy,
  'paste': Paste,
  'settings': Settings,
  'preferences': Settings,
  'materials': Materials,
  'materials-library': Materials,
  'render': Render,
  'units': Units,
  'measure': Measure,
  'measure-tool': Measure,
  'search': Search,
  'help': Help,
  'account': Account,
  'layers': Layers,
};

export default icons;
