// ===========================================================================
// drawingIcons.jsx — Forge "drawing / drafting" category icon set.
//
// Hand-authored, Siemens-NX / Dassault-CATIA / SolidWorks-toolbar-grade SVG
// glyphs for the DRAWING discipline of ArchDisc Forge. Each glyph is a UNIQUE,
// operation-relevant depiction of the actual drafting op (the way a real
// engineering toolbar draws it): a base view is an orthographic part box with
// a viewing-eye + projection arrow; a section view is a part with a cutting
// plane + hatched cut face; a detail view is a circled callout + a zoom bubble;
// an auxiliary view is a part with an inclined fold-line and a normal arrow;
// a datum is the filled-triangle datum-feature symbol; a GD&T frame is the
// boxed feature-control-frame; a surface-finish is the ISO-1302 check-tick;
// a weld symbol is the AWS reference-line + arrow + fillet flag; a balloon is
// the circled item number on a leader; a BOM is the ruled item table; etc.
//
// STANDARD (matches every Forge category icon set exactly):
//   • React SVG component per id; default-export is a { id -> component } map,
//     and every component is ALSO a named export.
//   • <svg viewBox="0 0 24 24" width={size||18} height={size||18} fill="none"
//     stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"
//     strokeLinejoin="round" {...rest}>  with hand-authored child geometry.
//   • MONOCHROME — currentColor stroke only (the few solid datum/section marks
//     use fill="currentColor" so they read as the filled symbol they really are
//     in ASME/ISO drafting; still single-ink, no colour).
//   • All geometry kept inside x,y ∈ [2,22] (2 px safe padding), consistent
//     visual weight + complexity across the whole set.
//
// The id keys mirror the REAL tool/command ids used in the app (grepped from
// frontend/src/ai/ForgeToolBridge.js and frontend/src/forge-v4/*.jsx — the
// DrawingsWorkbench ToolButton ids `drawings.*`, the Menus.jsx `tools.*`
// drawing actions, the `view.*` named-view kinds, and the bridge `gdt.*` /
// `drawing.*` / `part.annotate-pmi` verbs) plus sensible human-readable
// aliases. Pure presentational components — NO behaviour / logic.
// ===========================================================================

import React from 'react';

// Shared <svg> wrapper so every glyph is pixel-identical in stroke, caps,
// joins, padding, and sizing. Children are the hand-authored geometry.
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

// ───────────────────────────────────────────────────────────────────────────
// SHEET / NEW DRAWING
// ───────────────────────────────────────────────────────────────────────────

// Blank drafting sheet with a corner fold + border frame + corner title-block
// box — the canonical "drawing sheet".
export const SheetIcon = (props) => (
  <Svg {...props}>
    <path d="M6 3h9l3 3v15H6z" />
    <path d="M15 3v3h3" />
    <rect x="8" y="16" width="8" height="3" />
  </Svg>
);

// New drawing — a fresh sheet with a corner fold and a "+" badge.
export const NewDrawingIcon = (props) => (
  <Svg {...props}>
    <path d="M5 3h8l3 3v8" />
    <path d="M13 3v3h3" />
    <path d="M5 3v18h11v-5" />
    <path d="M15.5 18.5h5M18 16v5" />
  </Svg>
);

// ───────────────────────────────────────────────────────────────────────────
// VIEWS
// ───────────────────────────────────────────────────────────────────────────

// Base / standard view — an orthographic part box projected from a viewing
// eye, with the projection arrow. (NX "Base View".)
export const BaseViewIcon = (props) => (
  <Svg {...props}>
    <rect x="10" y="9" width="10" height="8" />
    <path d="M10 13H3" />
    <path d="M6 10.5 3 13l3 2.5" />
    <circle cx="4" cy="6" r="1.6" />
  </Svg>
);

// Projected view — a parent view with an arrow projecting an orthographic
// child view alongside it (first/third-angle projection).
export const ProjectedViewIcon = (props) => (
  <Svg {...props}>
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" />
    <path d="M10 6.5h6.5V14" />
    <path d="M14.5 11.5 16.5 14l-2.5 1.5" />
  </Svg>
);

// Section view — a solid part with a cutting plane through it and the cut
// face cross-hatched (the revealed section). (SolidWorks "Section View".)
export const SectionViewIcon = (props) => (
  <Svg {...props}>
    <path d="M5 6h9l4 4v8H5z" />
    <path d="M14 6v4h4" />
    <path d="M9 3v18" />
    <path d="M9 10l-4 4M11 9l-6 6M13 10l-4 4" />
  </Svg>
);

// Detail view — a circled callout region on a part and the enlarged
// "detail" bubble it expands into. (CATIA "Detail View".)
export const DetailViewIcon = (props) => (
  <Svg {...props}>
    <circle cx="7" cy="8" r="3.5" />
    <path d="M9.5 10.5 13 14" />
    <circle cx="16.5" cy="16.5" r="4.5" />
    <path d="M14.5 16.5h4M16.5 14.5v4" />
  </Svg>
);

// Auxiliary view — a part with an inclined surface and a fold-line + normal
// arrow projecting true shape perpendicular to that face.
export const AuxiliaryViewIcon = (props) => (
  <Svg {...props}>
    <path d="M4 18V8h7l5 5" />
    <path d="M11 8l5 5" strokeDasharray="0.1 3" />
    <path d="M13.5 7.5 19 13" strokeDasharray="3 2.5" />
    <path d="m17.5 7 2.5 2.5-3.4 1" />
  </Svg>
);

// Broken view — a long part with the middle removed and the two break-lines
// (zig-zag) joining the kept ends. (NX "Broken View".)
export const BrokenViewIcon = (props) => (
  <Svg {...props}>
    <path d="M3 8h6M3 16h6M3 8v8" />
    <path d="M15 8h6M15 16h6M21 8v8" />
    <path d="M9 7v10M15 7v10" />
    <path d="m9 9 3 1.5-3 1.5 3 1.5-3 1.5" />
  </Svg>
);

// Isometric view — a 3D cube drawn in isometric projection.
export const IsometricViewIcon = (props) => (
  <Svg {...props}>
    <path d="M12 3 4 7.5v9L12 21l8-4.5v-9z" />
    <path d="M4 7.5 12 12l8-4.5" />
    <path d="M12 12v9" />
  </Svg>
);

// ───────────────────────────────────────────────────────────────────────────
// DIMENSIONS
// ───────────────────────────────────────────────────────────────────────────

// Smart dimension — an auto-sensing linear dimension with witness lines,
// arrowheads, and a value tick ("smart" = context-aware, marked with a spark).
export const SmartDimensionIcon = (props) => (
  <Svg {...props}>
    <path d="M4 7v10M14 7v10" />
    <path d="M4 12h10" />
    <path d="M6.5 10 4 12l2.5 2M11.5 10 14 12l-2.5 2" />
    <path d="M18.5 5v4M16.5 7h4M19 13.5l1 1.5 1.8.3-1.4 1.4.3 1.8-1.7-.9-1.7.9.3-1.8-1.4-1.4 1.8-.3z" />
  </Svg>
);

// Linear dimension — a horizontal dimension with witness lines + arrowheads.
export const LinearDimensionIcon = (props) => (
  <Svg {...props}>
    <path d="M4 6v12M20 6v12" />
    <path d="M4 12h16" />
    <path d="M7 9 4 12l3 3M17 9l3 3-3 3" />
  </Svg>
);

// Angular dimension — two lines meeting at a vertex with a dimensioned arc
// and arrowheads sweeping the included angle.
export const AngularDimensionIcon = (props) => (
  <Svg {...props}>
    <path d="M4 20 4 4l14 14" />
    <path d="M4 12a8 8 0 0 1 8 8" />
    <path d="M3.4 9.2 4 12l2.7-.9M9.2 20.6 12 20l-.9-2.7" />
  </Svg>
);

// Radial dimension — a circle/arc with a radial leader from the centre to the
// arc, R-arrowhead at the rim.
export const RadialDimensionIcon = (props) => (
  <Svg {...props}>
    <circle cx="10" cy="12" r="7" />
    <path d="M10 12 19 5" />
    <path d="M16 5.6 19 5l-.6 3" />
    <circle cx="10" cy="12" r="0.6" fill="currentColor" />
  </Svg>
);

// Diameter dimension — a circle with a full through-leader and Ø arrowheads
// at both rims.
export const DiameterDimensionIcon = (props) => (
  <Svg {...props}>
    <circle cx="11" cy="12" r="7" />
    <path d="M4 12h14" />
    <path d="M6.5 9.5 4 12l2.5 2.5M15.5 9.5 18 12l-2.5 2.5" />
    <path d="M19 8 16 16" />
  </Svg>
);

// Baseline dimension — several dimensions all measured from one common
// baseline (stacked, growing offsets). (ASME Y14.5 §6.5.)
export const BaselineDimensionIcon = (props) => (
  <Svg {...props}>
    <path d="M4 4v16" />
    <path d="M4 8h8M4 13h12M4 18h16" />
    <path d="M9.5 6 12 8l-2.5 2M13.5 11 16 13l-2.5 2M17.5 16 20 18l-2.5 2" />
  </Svg>
);

// Ordinate dimension — coordinate values stacked off a zero-origin baseline,
// each on a stub leader (no arrowheads). (ASME Y14.5 §6.5 ordinate.)
export const OrdinateDimensionIcon = (props) => (
  <Svg {...props}>
    <path d="M3 18h18" />
    <path d="M3 18 5 16" />
    <path d="M8 18v-7M13 18v-10M18 18v-13" />
    <path d="M6.5 9.5h3M11.5 6.5h3M16.5 3.5h3" />
  </Svg>
);

// ───────────────────────────────────────────────────────────────────────────
// GD&T / PMI / SYMBOLS
// ───────────────────────────────────────────────────────────────────────────

// Datum feature — the ASME datum-feature symbol: a leader to a filled datum
// triangle with the boxed reference letter.
export const DatumIcon = (props) => (
  <Svg {...props}>
    <rect x="13" y="4" width="7" height="6" />
    <path d="M16.5 11v3l-5 6" />
    <path d="m9 17 2.5 3 2.5-3z" fill="currentColor" />
  </Svg>
);

// Datum target — the ISO/ASME datum-target circle (half-line) with the
// target-point cross and the A1 area designation.
export const DatumTargetIcon = (props) => (
  <Svg {...props}>
    <circle cx="14" cy="14" r="6" />
    <path d="M8 14h12" />
    <path d="M14 6v3M11.5 11.5 4 19" />
    <path d="M2.5 17 4 19l2-1.5" />
  </Svg>
);

// GD&T feature-control-frame — the boxed FCF: characteristic cell + tolerance
// cell + datum-reference cell, with a leader. (ASME Y14.5 frame.)
export const GdtFrameIcon = (props) => (
  <Svg {...props}>
    <rect x="3" y="8" width="18" height="6" />
    <path d="M9 8v6M15 8v6" />
    <path d="M4.5 11h3" />
    <path d="M11 11h.01M18 11h.01" />
    <path d="M6 14v4" />
  </Svg>
);

// Surface finish — the ISO 1302 surface-texture check symbol with the
// machining-allowance horizontal bar and a roughness value tick.
export const SurfaceFinishIcon = (props) => (
  <Svg {...props}>
    <path d="M6 18 11 6l4 8" />
    <path d="M11 6h9" />
    <path d="M14 14h6" />
    <path d="M9 13l1.5 2" />
  </Svg>
);

// Weld symbol — the AWS/ISO weld callout: reference line + leader arrow with
// the fillet-weld triangle flag on it.
export const WeldSymbolIcon = (props) => (
  <Svg {...props}>
    <path d="M3.6 10h17.4" />
    <path d="M3.6 10 9 19" />
    <path d="m11 10 2.5 4h-5z" fill="currentColor" />
    <circle cx="3.6" cy="10" r="1.5" />
  </Svg>
);

// ───────────────────────────────────────────────────────────────────────────
// ANNOTATION / TABLES / BALLOON
// ───────────────────────────────────────────────────────────────────────────

// Balloon — the circled item number on a leader pointing to the part it
// identifies. (SolidWorks "Balloon".)
export const BalloonIcon = (props) => (
  <Svg {...props}>
    <circle cx="15" cy="7" r="4.5" />
    <path d="M15 4v6" strokeWidth={1} opacity="0" />
    <path d="M11.5 9.5 4 19" />
    <path d="M2.5 17 4 19l2-1.5" />
    <path d="M13.6 6.5 15 5.3V9" />
  </Svg>
);

// Annotation / note — a leader arrow pointing to a part with a text-note block.
export const AnnotationIcon = (props) => (
  <Svg {...props}>
    <rect x="11" y="3" width="10" height="8" rx="1" />
    <path d="M13.5 6h5M13.5 8h3" />
    <path d="M12 11 4 19" />
    <path d="M2.5 17 4 19l2-1.5" />
  </Svg>
);

// BOM table — the bill-of-materials grid (header row + item rows + columns).
export const BomTableIcon = (props) => (
  <Svg {...props}>
    <rect x="3" y="4" width="18" height="16" />
    <path d="M3 9h18" />
    <path d="M3 14.5h18" />
    <path d="M9 4v16M14 9v11" />
  </Svg>
);

// Revision table — a small revision-history table with the rev-cloud +
// triangle delta marker (Zone/Rev/Description).
export const RevisionTableIcon = (props) => (
  <Svg {...props}>
    <rect x="4" y="6" width="16" height="12" />
    <path d="M4 11h16" />
    <path d="M9 6v12" />
    <path d="m6.5 8 1.5 2-3 0z" fill="currentColor" />
    <path d="M11.5 8.5h6M11.5 14h6M11.5 15.8h4" />
  </Svg>
);

// Revision cloud — the freehand "cloud" loop drawn around a changed region
// with the rev delta-triangle tag. (AutoCAD "Revcloud".)
export const RevisionCloudIcon = (props) => (
  <Svg {...props}>
    <path d="M5 13a2.4 2.4 0 0 1 1.6-3.6A2.6 2.6 0 0 1 11 7.6 2.4 2.4 0 0 1 14.6 9a2.4 2.4 0 0 1 1 4.4 2.3 2.3 0 0 1-2.3 2.3H7.2A2.3 2.3 0 0 1 5 13Z" />
    <path d="m17.5 16 2 3.4h-4z" fill="currentColor" />
  </Svg>
);

// Title block — the lower-right drawing title block grid (fields + part-name
// cell). (Every drawing sheet's title block.)
export const TitleBlockIcon = (props) => (
  <Svg {...props}>
    <rect x="3" y="11" width="18" height="9" />
    <path d="M3 15.5h12" />
    <path d="M9 11v4.5" />
    <path d="M15 11v9" />
    <path d="M17 14h2M17 17h2" />
    <path d="M5 18h6" />
  </Svg>
);

// Hole table — a hole table linking tagged holes (A,B…) to an X/Y/Ø row grid.
export const HoleTableIcon = (props) => (
  <Svg {...props}>
    <circle cx="6" cy="6" r="2.2" />
    <path d="M6 4.5v3M4.5 6h3" />
    <rect x="11" y="3" width="10" height="11" />
    <path d="M11 7h10M11 10.5h10M15.5 3v11" />
  </Svg>
);

// ───────────────────────────────────────────────────────────────────────────
// CENTER MARKS / CENTERLINES / HATCH
// ───────────────────────────────────────────────────────────────────────────

// Center mark — a small cross at the centre of a circle (with the
// center-mark gap). (SolidWorks "Center Mark".)
export const CenterMarkIcon = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="6.5" />
    <path d="M12 4v5M12 15v5" />
    <path d="M4 12h5M15 12h5" />
  </Svg>
);

// Centerline — the chain (dash-dot) axis line through a symmetric feature.
export const CenterlineIcon = (props) => (
  <Svg {...props}>
    <path d="M5 7h14M5 17h14" />
    <path d="M3 12h2M8 12h6M17 12h4" />
    <path d="M11 11.5v1M14.5 11.5v1" opacity="0" />
  </Svg>
);

// Hatch — a region (boundary) filled with section cross-hatching at 45°.
export const HatchIcon = (props) => (
  <Svg {...props}>
    <path d="M5 5h11l3 3v11H5z" />
    <path d="M16 5v3h3" />
    <path d="M7 17 16 8M8 19l5-5M10 19l1.5-1.5" strokeWidth={1} />
  </Svg>
);

// ───────────────────────────────────────────────────────────────────────────
// EXPORT
// ───────────────────────────────────────────────────────────────────────────

// Export SVG — a drawing sheet with a down-arrow + "SVG" out badge.
export const ExportSvgIcon = (props) => (
  <Svg {...props}>
    <path d="M6 3h8l4 4v6" />
    <path d="M14 3v4h4" />
    <path d="M6 3v18h6" />
    <path d="M16 15v6M13.5 18.5 16 21l2.5-2.5" />
  </Svg>
);

// Export PDF — a drawing sheet folded with a down-out arrow (to PDF).
export const ExportPdfIcon = (props) => (
  <Svg {...props}>
    <path d="M6 3h8l4 4v5" />
    <path d="M14 3v4h4" />
    <path d="M6 3v18h5" />
    <path d="M8 12h3M8 15h4" />
    <path d="M17 15v6M14.5 18.5 17 21l2.5-2.5" />
  </Svg>
);

// Export STEP + PMI — a solid (cube) carrying a GD&T frame tag, written to
// STEP/AP242 with PMI. (drawings.exportStepPmi / gdt.write-step.)
export const ExportStepPmiIcon = (props) => (
  <Svg {...props}>
    <path d="M4 6 9 3l5 3v6l-5 3-5-3z" />
    <path d="M4 6 9 9l5-3M9 9v6" />
    <rect x="13" y="15" width="8" height="5" />
    <path d="M17 15v5" />
    <path d="M14.5 17.5h1.5" />
  </Svg>
);

// ===========================================================================
// MAP — tool/command id -> component. Keys mirror the REAL ids grepped from
// ForgeToolBridge.js + forge-v4/*.jsx (DrawingsWorkbench `drawings.*`,
// Menus.jsx `tools.*` drawing actions, `view.*` kinds, bridge `gdt.*` /
// `drawing.*` verbs) plus readable aliases. Aim: complete category coverage.
// ===========================================================================

const drawingIcons = {
  // ── sheet / new drawing ────────────────────────────────────────────────
  'sheet': SheetIcon,
  'drawing.sheet': SheetIcon,
  'drawings.sheet': SheetIcon,
  'new-drawing': NewDrawingIcon,
  'newDrawing': NewDrawingIcon,
  'drawing.new': NewDrawingIcon,
  'file.new': NewDrawingIcon,
  'tools.drawingsHlr': NewDrawingIcon,
  'tools.drawingTemplates': SheetIcon,

  // ── views ──────────────────────────────────────────────────────────────
  'base-view': BaseViewIcon,
  'standard-view': BaseViewIcon,
  'baseView': BaseViewIcon,
  'drawings.addView': BaseViewIcon,
  'drawings.projectView': BaseViewIcon,
  'drawing.project': BaseViewIcon,
  'view.shape': BaseViewIcon,

  'projected-view': ProjectedViewIcon,
  'projectedView': ProjectedViewIcon,

  'section-view': SectionViewIcon,
  'sectionView': SectionViewIcon,
  'view.section': SectionViewIcon,
  'drawings.addSection': SectionViewIcon,
  'drawings.projectSection': SectionViewIcon,

  'detail-view': DetailViewIcon,
  'detailView': DetailViewIcon,
  'view.detail': DetailViewIcon,
  'drawings.addDetail': DetailViewIcon,
  'drawings.projectDetail': DetailViewIcon,
  'tools.detailViews': DetailViewIcon,

  'auxiliary-view': AuxiliaryViewIcon,
  'auxiliaryView': AuxiliaryViewIcon,
  'view.auxiliary': AuxiliaryViewIcon,

  'broken-view': BrokenViewIcon,
  'brokenView': BrokenViewIcon,
  'view.broken': BrokenViewIcon,
  'drawings.addBroken': BrokenViewIcon,

  'isometric-view': IsometricViewIcon,
  'isometricView': IsometricViewIcon,
  'iso-view': IsometricViewIcon,
  'view.iso': IsometricViewIcon,

  // ── dimensions ─────────────────────────────────────────────────────────
  'dimension': SmartDimensionIcon,
  'smart-dimension': SmartDimensionIcon,
  'smartDimension': SmartDimensionIcon,
  'drawings.dimension': SmartDimensionIcon,
  'tools.dimChains': SmartDimensionIcon,

  'linear-dimension': LinearDimensionIcon,
  'linearDimension': LinearDimensionIcon,

  'angular-dimension': AngularDimensionIcon,
  'angularDimension': AngularDimensionIcon,

  'radial-dimension': RadialDimensionIcon,
  'radialDimension': RadialDimensionIcon,

  'diameter-dimension': DiameterDimensionIcon,
  'diameterDimension': DiameterDimensionIcon,

  'baseline-dimension': BaselineDimensionIcon,
  'baselineDimension': BaselineDimensionIcon,

  'ordinate-dimension': OrdinateDimensionIcon,
  'ordinateDimension': OrdinateDimensionIcon,
  'drawings.ordinate': OrdinateDimensionIcon,

  // ── GD&T / PMI / symbols ───────────────────────────────────────────────
  'datum': DatumIcon,
  'gdt.datum': DatumIcon,

  'datum-target': DatumTargetIcon,
  'datumTarget': DatumTargetIcon,
  'drawings.datumTarget': DatumTargetIcon,

  'gdt-frame': GdtFrameIcon,
  'gdtFrame': GdtFrameIcon,
  'drawings.gdt': GdtFrameIcon,
  'gdt.feature-control-frame': GdtFrameIcon,
  'gdt.position-relative-to-mate': GdtFrameIcon,
  'gdt.concentric-to-mate': GdtFrameIcon,
  'tools.gdtFrames': GdtFrameIcon,
  'tools.pmiAnnotations': GdtFrameIcon,
  'part.annotate-pmi': GdtFrameIcon,

  'surface-finish': SurfaceFinishIcon,
  'surfaceFinish': SurfaceFinishIcon,
  'drawings.finish': SurfaceFinishIcon,

  'weld-symbol': WeldSymbolIcon,
  'weldSymbol': WeldSymbolIcon,
  'drawings.weld': WeldSymbolIcon,

  // ── annotation / tables / balloon ──────────────────────────────────────
  'balloon': BalloonIcon,
  'drawings.balloon': BalloonIcon,
  'tools.bomBalloons': BalloonIcon,

  'annotation': AnnotationIcon,
  'note': AnnotationIcon,

  'bom-table': BomTableIcon,
  'bomTable': BomTableIcon,
  'tools.bom': BomTableIcon,

  'revision-table': RevisionTableIcon,
  'revisionTable': RevisionTableIcon,
  'drawings.revTable': RevisionTableIcon,
  'drawings.revRow': RevisionTableIcon,
  'tools.pdmRevisions': RevisionTableIcon,

  'revision-cloud': RevisionCloudIcon,
  'revisionCloud': RevisionCloudIcon,
  'drawings.cloud': RevisionCloudIcon,

  'title-block': TitleBlockIcon,
  'titleBlock': TitleBlockIcon,
  'drawings.titleBlock': TitleBlockIcon,

  'hole-table': HoleTableIcon,
  'holeTable': HoleTableIcon,
  'tools.holeTable': HoleTableIcon,

  // ── center marks / centerlines / hatch ─────────────────────────────────
  'center-mark': CenterMarkIcon,
  'centerMark': CenterMarkIcon,

  'centerline': CenterlineIcon,
  'centreLine': CenterlineIcon,
  'view.centreLine': CenterlineIcon,

  'hatch': HatchIcon,
  'view.hatchSpec': HatchIcon,

  // ── export ─────────────────────────────────────────────────────────────
  'export-svg': ExportSvgIcon,
  'drawings.exportSvg': ExportSvgIcon,

  'export-pdf': ExportPdfIcon,
  'drawings.exportPdf': ExportPdfIcon,
  'tools.printPreview': ExportPdfIcon,

  'export-step-pmi': ExportStepPmiIcon,
  'drawings.exportStepPmi': ExportStepPmiIcon,
  'gdt.write-step': ExportStepPmiIcon,
};

export default drawingIcons;
