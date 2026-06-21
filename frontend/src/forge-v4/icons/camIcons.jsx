// Forge-v4 — CAM / MANUFACTURE icon set.
//
// Hand-authored, NX/CATIA/SolidWorks-toolbar-grade glyphs for the CAM
// category of ArchDisc Forge. Every icon is a pure-presentational React
// SVG component — NO behaviour, NO logic, NO external icon library.
//
// STANDARD (identical for every glyph in every category):
//   <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
//        stroke="currentColor" strokeWidth={1.5} strokeLinecap="round"
//        strokeLinejoin="round" {...props}>
//   • monochrome — currentColor only, no fills/colours
//   • content kept inside [2,22] on both axes (2 px safe padding)
//   • consistent visual weight + complexity across the set
//   • each glyph UNIQUE and literally relevant to its operation
//
// Map keys mirror the REAL command / tool / kernel ids found in
//   frontend/src/ai/ForgeToolBridge.js     (manufacture.cam-*, cam.*)
//   frontend/src/forge-v4/Menus.jsx        (tools.cam*, tools.slicer, …)
//   frontend/src/forge-v4/toolRegistry.js  (camx, sheetmetal-unfold)
//   frontend/src/forge-v4/FiveAxisCAMPanel.jsx (swarf / parallel-to-face)
//   frontend/src/forge-v4/sheetMetalDispatch.js (baseFlange / hem / jog …)
// plus operation-relevant aliases so any reasonable lookup resolves.
//
// Usage:
//   import camIcons from 'forge-v4/icons/camIcons.jsx';
//   const Glyph = camIcons['manufacture.cam-pocket'];
//   <Glyph size={18} />
//
// or named:  import { CamPocket } from 'forge-v4/icons/camIcons.jsx';

import React from 'react';

/* Shared <svg> shell — guarantees every glyph obeys the standard. */
const Svg = ({ size, children, ...props }) => (
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

/* ═══════════════════════════════════════════════════════════════════
   SETUP / STOCK — wireframe stock block enclosing the solid part, with
   the part-zero (WCS) corner triad. The defining picture of a CAM setup.
   ═══════════════════════════════════════════════════════════════════ */
export const CamSetup = (props) => (
  <Svg {...props}>
    {/* wireframe stock box */}
    <path d="M3 8l6-3 12 0M3 8v9l6 3M9 5v9M9 14l12 0M21 8v9l-12 0" strokeDasharray="2.4 2" />
    {/* solid part nested inside */}
    <path d="M7 12l3-1.5 7 0M7 12v4l3 1.5M10 10.5v4M10 14.5l7 0M17 12v4l-7 0" />
    {/* part-zero triad at the near-bottom corner */}
    <path d="M3 20h4M3 20v-3" />
  </Svg>
);

/* ═══════════════════════════════════════════════════════════════════
   FACE MILL — large-Ø face-mill body skimming the top of a block, chip
   layer being removed across the full width (a face-milling operation).
   ═══════════════════════════════════════════════════════════════════ */
export const CamFaceMill = (props) => (
  <Svg {...props}>
    {/* arbor + broad cutter body */}
    <path d="M12 3v3" />
    <path d="M5 6h14l-1.5 3h-11z" />
    {/* insert teeth along the bottom edge */}
    <path d="M7 9l.8 1.4M11 9l.8 1.4M15 9l.8 1.4" />
    {/* freshly faced top of the workpiece, full-width pass */}
    <path d="M4 13h16" />
    <path d="M4 13v6h16v-6" />
  </Svg>
);

/* ═══════════════════════════════════════════════════════════════════
   2D CONTOUR / PROFILE — endmill tracing the OUTSIDE boundary of a
   profile; offset path with a lead-in arc and travel arrow.
   ═══════════════════════════════════════════════════════════════════ */
export const Cam2DContour = (props) => (
  <Svg {...props}>
    {/* the part profile */}
    <path d="M7 7h7l4 4v6H7z" />
    {/* tool-centre contour offset outside the profile, w/ lead-in arc */}
    <path d="M4 5.5a2 2 0 0 0-1 2v10.5" strokeDasharray="0.1 3" />
    {/* travelling cutter on the path */}
    <circle cx="4.5" cy="5.5" r="1.6" />
    <path d="M5 18l1.5-1.5" />
  </Svg>
);
export const CamProfile = Cam2DContour;

/* ═══════════════════════════════════════════════════════════════════
   2D POCKET — closed pocket boundary filled by an inward zig-zag /
   offset-spiral clearing pattern. The canonical pocketing glyph.
   ═══════════════════════════════════════════════════════════════════ */
export const Cam2DPocket = (props) => (
  <Svg {...props}>
    {/* pocket walls */}
    <rect x="3.5" y="5" width="17" height="14" rx="1.5" />
    {/* concentric offset-clear passes */}
    <rect x="6" y="7.5" width="12" height="9" rx="1" />
    {/* zig-zag floor fill */}
    <path d="M8 10l3 3.5-3 0M11 13.5l3-3.5M14 10l0 3.5-3 0" />
  </Svg>
);
export const CamPocket = Cam2DPocket;

/* ═══════════════════════════════════════════════════════════════════
   SLOT MILL — endmill cutting a straight closed-end slot; the rounded
   slot channel with the cutter Ø shown at one end.
   ═══════════════════════════════════════════════════════════════════ */
export const CamSlotMill = (props) => (
  <Svg {...props}>
    <path d="M3 14v-6h18v6" />
    {/* the slot — racetrack channel through the block */}
    <path d="M7 8.5h10a2.5 2.5 0 0 1 0 5H7a2.5 2.5 0 0 1 0-5z" />
    {/* cutter at the entry end + centre-line */}
    <circle cx="7" cy="11" r="2.5" strokeDasharray="2 1.6" />
    <path d="M7 11h10" strokeDasharray="2 1.6" />
    <path d="M3 16v3h18v-3" />
  </Svg>
);
export const CamSlot = CamSlotMill;

/* ═══════════════════════════════════════════════════════════════════
   DRILL — twist drill plunging into a hole; flutes + point angle, with
   a chip-clearing arrow. Mirrors cam.drill / tools.drillingPattern.
   ═══════════════════════════════════════════════════════════════════ */
export const CamDrill = (props) => (
  <Svg {...props}>
    {/* drill body + flutes */}
    <path d="M9 3h6v9l-3 4-3-4z" />
    <path d="M11 4v9M13 4v9" strokeDasharray="1.6 1.6" />
    {/* the drilled hole / blind bottom */}
    <path d="M7 17h10M9 20h6" />
    {/* peck-retract arrow */}
    <path d="M19 8v-4M19 8l-1.4-1.4M19 8l1.4-1.4" />
  </Svg>
);
export const CamDrilling = CamDrill;
export const CamDrillingPattern = CamDrill;

/* ═══════════════════════════════════════════════════════════════════
   BORE — boring bar enlarging an existing hole to a precise Ø; single-
   point insert sweeping the bore wall, Ø dimension across the hole.
   ═══════════════════════════════════════════════════════════════════ */
export const CamBore = (props) => (
  <Svg {...props}>
    {/* bored hole (front view) */}
    <circle cx="12" cy="12" r="7.5" />
    {/* boring bar + single-point tip reaching the wall */}
    <path d="M12 12h6" />
    <path d="M16.5 10.5l2 1.5-2 1.5z" />
    {/* Ø dimension across */}
    <path d="M5.5 12h13" strokeDasharray="0.1 2.4" />
  </Svg>
);

/* ═══════════════════════════════════════════════════════════════════
   TAP / THREAD-MILL — internal thread being cut; threaded hole shown in
   section with the helical thread profile flanks.
   ═══════════════════════════════════════════════════════════════════ */
export const CamTap = (props) => (
  <Svg {...props}>
    {/* threaded bore — sectioned walls */}
    <path d="M8 4v16M16 4v16" />
    {/* internal thread flanks (the saw-tooth crest line) */}
    <path d="M8 7l2 1.5-2 1.5M8 12l2 1.5-2 1.5M8 17l2 1.5" />
    <path d="M16 7l-2 1.5 2 1.5M16 12l-2 1.5 2 1.5M16 17l-2 1.5" />
    {/* helix axis */}
    <path d="M12 3v18" strokeDasharray="2 2" />
  </Svg>
);
export const CamThreadMill = CamTap;
export const CamThread = CamTap;

/* ═══════════════════════════════════════════════════════════════════
   ADAPTIVE CLEARING — high-MRR roughing: trochoidal/looping toolpath
   keeping constant tool engagement. Mirrors cam.adaptiveClear.
   ═══════════════════════════════════════════════════════════════════ */
export const CamAdaptive = (props) => (
  <Svg {...props}>
    {/* stock outline being cleared */}
    <rect x="3" y="4" width="18" height="16" rx="1.5" strokeDasharray="2.4 2" />
    {/* trochoidal looping engagement path */}
    <path d="M6 16c0-2 1-3 2.6-3s2.6 1 2.6 3-1 3-2.6 3M11.2 16c0-2 1-3 2.6-3s2.6 1 2.6 3-1 3-2.6 3" />
    <path d="M6 16c0-3 .9-5 2.6-7s2.6-3 2.6-5" />
  </Svg>
);
export const CamAdaptiveClear = CamAdaptive;

/* ═══════════════════════════════════════════════════════════════════
   3D CONTOUR — Z-level / waterline finishing: the contour passes
   stacked down the flank of a 3D form at constant Z heights.
   ═══════════════════════════════════════════════════════════════════ */
export const Cam3DContour = (props) => (
  <Svg {...props}>
    {/* curved 3D form (dome flank) */}
    <path d="M4 20c0-9 3.5-14 8-14s8 5 8 14" />
    {/* waterline (constant-Z) passes wrapping the form */}
    <path d="M6.2 14h11.6M5.1 17h13.8M7.6 11h8.8M9.6 8h4.8" />
  </Svg>
);
export const CamWaterline = Cam3DContour;
export const CamZLevel = Cam3DContour;

/* ═══════════════════════════════════════════════════════════════════
   PARALLEL FINISH — ball endmill raster finishing: evenly-spaced
   parallel passes sweeping across a curved surface.
   ═══════════════════════════════════════════════════════════════════ */
export const CamParallelFinish = (props) => (
  <Svg {...props}>
    {/* surface ridge profile (side) */}
    <path d="M3 16c3-7 5-7 7-3s4 4 11-5" />
    {/* parallel raster passes */}
    <path d="M5 18.5v-2M8 14.5v-2M11 16v-2M14 14v-2M17 11.5v-2M20 9v-2" />
    <path d="M3 19.5h18" strokeDasharray="0.1 2.6" />
  </Svg>
);
export const CamParallelToFace = CamParallelFinish;
export const ParallelToFace = CamParallelFinish;
export const CamRaster = CamParallelFinish;

/* ═══════════════════════════════════════════════════════════════════
   SCALLOP — constant-scallop / steep-shallow finishing: ball-cutter
   leaving the tell-tale scallop cusps between adjacent passes.
   ═══════════════════════════════════════════════════════════════════ */
export const CamScallop = (props) => (
  <Svg {...props}>
    {/* ball-nose cutter */}
    <path d="M9 3h6v6a3 3 0 0 1-6 0z" />
    {/* scallop cusps left on the finished floor */}
    <path d="M3 19a2 2 0 0 1 4 0 2 2 0 0 1 4 0 2 2 0 0 1 4 0 2 2 0 0 1 4 0" />
    {/* cusp-height tick */}
    <path d="M5 17v-1.5M9 17v-1.5" />
  </Svg>
);

/* ═══════════════════════════════════════════════════════════════════
   ENGRAVE — V-bit tracing text/line art onto the surface; the V-tool
   cutting a fine groove that forms a letter stroke.
   ═══════════════════════════════════════════════════════════════════ */
export const CamEngrave = (props) => (
  <Svg {...props}>
    {/* V-engraving bit */}
    <path d="M7 3h4l-2 5z" />
    {/* engraved stroke (a flowing 'e'-like glyph) being cut */}
    <path d="M9 8c-3 1-5 4-5 7s2 5 5 5 5-2 6-5" />
    <path d="M4 16h7" />
    {/* workpiece baseline */}
    <path d="M3 22h18" strokeDasharray="0.1 2.6" />
  </Svg>
);

/* ═══════════════════════════════════════════════════════════════════
   TURNING PROFILE — lathe OD turning: a revolved part on a centre-line
   with the turning insert taking the outer profile.
   ═══════════════════════════════════════════════════════════════════ */
export const CamTurningProfile = (props) => (
  <Svg {...props}>
    {/* spindle centre-line */}
    <path d="M3 12h18" strokeDasharray="3 2" />
    {/* turned shaft profile (stepped, revolved about the axis) */}
    <path d="M3 8h6v-2h5l4 3v3l-4 3h-5v-2H3" />
    {/* turning insert at the OD */}
    <path d="M17 18l1.5-3 1.5 3z" />
    <path d="M18.5 15v-2" />
  </Svg>
);
export const CamTurning = CamTurningProfile;
export const CamLathe = CamTurningProfile;

/* ═══════════════════════════════════════════════════════════════════
   GROOVE — lathe grooving / parting: narrow form-tool plunging a
   square groove into the turned diameter.
   ═══════════════════════════════════════════════════════════════════ */
export const CamGroove = (props) => (
  <Svg {...props}>
    {/* centre-line */}
    <path d="M3 12h18" strokeDasharray="3 2" />
    {/* shaft with a square groove cut into the top OD */}
    <path d="M3 8h8v3h2v-3h8" />
    <path d="M3 8v8h18V8" strokeDasharray="0.1 100" />
    {/* grooving tool plunging into the groove */}
    <path d="M11.4 11h1.2v-7h-1.2z" />
    <path d="M12 2v2" />
  </Svg>
);
export const CamParting = CamGroove;

/* ═══════════════════════════════════════════════════════════════════
   TOOLPATH SIMULATE — verify / material-removal sim: a part with the
   toolpath overlaid inside a "play" run indicator.
   ═══════════════════════════════════════════════════════════════════ */
export const CamSimulate = (props) => (
  <Svg {...props}>
    {/* stock/part being simulated */}
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    {/* simulated toolpath weaving inside */}
    <path d="M6 16l3-5 3 5 3-7 3 4" />
    {/* play / run indicator */}
    <path d="M9.5 9.5l4 2.5-4 2.5z" />
  </Svg>
);
export const CamStockSim = CamSimulate;
export const CamVerify = CamSimulate;
export const CamSimulator = CamSimulate;

/* ═══════════════════════════════════════════════════════════════════
   POST-PROCESS / G-CODE — toolpath → machine G-code: a document with
   the unmistakable "G01 / M03" code lines. Mirrors manufacture.gcode.
   ═══════════════════════════════════════════════════════════════════ */
export const CamGcode = (props) => (
  <Svg {...props}>
    {/* posted program sheet */}
    <path d="M5 3h9l5 5v13H5z" />
    <path d="M14 3v5h5" />
    {/* G/M code lines */}
    <path d="M8 12h2.5M12.5 12h3.5M8 15h4M14 15h2" />
    {/* output arrow → machine */}
    <path d="M8 18.5h4M12 18.5l-1.4-1.4M12 18.5l-1.4 1.4" />
  </Svg>
);
export const CamPost = CamGcode;
export const CamPostProcess = CamGcode;
export const Gcode = CamGcode;

/* ═══════════════════════════════════════════════════════════════════
   TOOL LIBRARY — rack of cutting tools (endmill / drill / face-mill)
   stored in the tool table.
   ═══════════════════════════════════════════════════════════════════ */
export const CamToolLibrary = (props) => (
  <Svg {...props}>
    {/* rack shelf */}
    <path d="M3 16h18" />
    {/* endmill */}
    <path d="M5 4v8h2V4zM5 12l1 2 1-2" />
    {/* drill */}
    <path d="M10.5 4v7h2V4zM10.5 11l1 3 1-3" />
    {/* face mill / boring bar */}
    <path d="M16 4v9h3V4z" />
    {/* tool numbers tick */}
    <path d="M5 19h14" strokeDasharray="0.1 3" />
  </Svg>
);
export const CamToolTable = CamToolLibrary;
export const ToolLibrary = CamToolLibrary;

/* ═══════════════════════════════════════════════════════════════════
   PROBE — on-machine touch probe with stylus + ruby tip contacting a
   surface; measurement crosshair on the touched point.
   ═══════════════════════════════════════════════════════════════════ */
export const CamProbe = (props) => (
  <Svg {...props}>
    {/* probe body + tapered stylus */}
    <path d="M8 3h8v5l-3.2 2v4" />
    {/* ruby tip touching the surface */}
    <circle cx="12.8" cy="15.5" r="1.8" />
    {/* probed surface + contact crosshair */}
    <path d="M4 19h16" />
    <path d="M12.8 19v-1.6" />
    <path d="M10 6h4" />
  </Svg>
);
export const Probe = CamProbe;
export const CamInspect = CamProbe;

/* ═══════════════════════════════════════════════════════════════════
   NESTING — parts efficiently packed into a sheet to minimise scrap;
   sheet boundary with several differently-shaped nested blanks.
   ═══════════════════════════════════════════════════════════════════ */
export const CamNesting = (props) => (
  <Svg {...props}>
    {/* the sheet */}
    <rect x="3" y="4" width="18" height="16" rx="1" />
    {/* nested part blanks packed in */}
    <path d="M5 6h6v5H5z" />
    <circle cx="16" cy="8.5" r="3" />
    <path d="M5 13l3-1 3 1v5H5z" />
    <path d="M13 13h6v5h-6z" />
  </Svg>
);
export const Nesting = CamNesting;
export const CamNest = CamNesting;

/* ═══════════════════════════════════════════════════════════════════
   SHEET-METAL UNFOLD / FLAT-PATTERN — folded part flattened to its
   developed blank with bend lines (dashed). Mirrors sheetmetal-unfold.
   ═══════════════════════════════════════════════════════════════════ */
export const CamFlatPattern = (props) => (
  <Svg {...props}>
    {/* folded 3D part (left) */}
    <path d="M3 14V8l4-2v6z" />
    <path d="M3 14l4 2 0-6" />
    {/* unfold arrow */}
    <path d="M9.5 11h4M13.5 11l-1.4-1.4M13.5 11l-1.4 1.4" />
    {/* developed flat blank w/ bend lines */}
    <path d="M15 6h6v12h-6z" />
    <path d="M17.5 6v12M19 6v12" strokeDasharray="1.8 1.6" />
  </Svg>
);
export const CamUnfold = CamFlatPattern;
export const SheetMetalUnfold = CamFlatPattern;
export const CamFlatten = CamFlatPattern;
export const FlatPattern = CamFlatPattern;

/* ═══════════════════════════════════════════════════════════════════
   BEND — sheet-metal flange folded up about a bend line; the bend
   angle arc and the neutral/bend-line shown.
   ═══════════════════════════════════════════════════════════════════ */
export const CamBend = (props) => (
  <Svg {...props}>
    {/* base flange */}
    <path d="M3 18h10" />
    {/* upstand flange folded at the bend radius */}
    <path d="M13 18a4 4 0 0 1 4-4l4 0" />
    {/* bend-angle arc + dimension */}
    <path d="M13 14a4.5 4.5 0 0 0 4.5 4.5" strokeDasharray="1.8 1.6" />
    {/* bend-line tick */}
    <path d="M13 18v2.5" />
  </Svg>
);
export const Bend = CamBend;
export const SheetMetalBend = CamBend;
export const CamFlange = CamBend;
export const EdgeFlange = CamBend;

/* ═══════════════════════════════════════════════════════════════════
   LASER / PLASMA CUT — focused beam + spark/kerf cutting a contour out
   of a flat sheet; the beam cone and the cut slit.
   ═══════════════════════════════════════════════════════════════════ */
export const CamLaserCut = (props) => (
  <Svg {...props}>
    {/* cutting head + focused beam cone */}
    <path d="M9 3h6v4l-2 2h-2l-2-2z" />
    <path d="M12 9v3" />
    {/* sheet with the cut contour + kerf */}
    <path d="M3 14h18" />
    <path d="M3 14v6h18v-6" />
    {/* sparks / pierce at the beam contact */}
    <path d="M12 14l-2 2.5M12 14l2 2.5M9.5 16l-1.5.6M14.5 16l1.5.6" />
  </Svg>
);
export const CamPlasmaCut = CamLaserCut;
export const CamLaser = CamLaserCut;
export const CamPlasma = CamLaserCut;
export const CamWaterjet = CamLaserCut;

/* ═══════════════════════════════════════════════════════════════════
   ── REAL-ID ENTRIES the rest of the map points at via aliases ──
   These additional distinct glyphs cover ids found in the registries
   that don't 1:1 map to a generic op above.
   ═══════════════════════════════════════════════════════════════════ */

/* 5-AXIS SWARF — flank/swarf milling with the tool axis tilted along a
   ruled wall; the cutter leaning to the surface normal. */
export const CamSwarf = (props) => (
  <Svg {...props}>
    {/* ruled / draughted wall */}
    <path d="M5 20l4-15M19 18l-2-13" />
    {/* tilted endmill flanking the wall */}
    <path d="M11 4l3 1-4 14-3-1z" />
    <path d="M10 19l1.5 1 1.5-1" />
    {/* tool-axis vector (tilted) */}
    <path d="M12.5 12l3-2" strokeDasharray="1.6 1.4" />
  </Svg>
);
export const Swarf = CamSwarf;

/* 5-AXIS / MULTI-AXIS — part on a tilt/rotate (A/C) trunnion table, the
   defining picture of indexed/continuous 5-axis machining. */
export const Cam5Axis = (props) => (
  <Svg {...props}>
    {/* trunnion cradle */}
    <path d="M4 17a8 8 0 0 1 16 0" />
    {/* part on the table */}
    <rect x="9" y="8" width="6" height="5" rx="0.6" transform="rotate(-18 12 10.5)" />
    {/* rotary axis arrows A & C */}
    <path d="M5 17l-1.5-1M5 17l-1 1.6" />
    <path d="M19 17l1.5-1M19 17l1 1.6" />
    <path d="M12 5v-2" />
  </Svg>
);
export const CamMultiAxis = Cam5Axis;
export const CamMultiAxisIndexed = Cam5Axis;
export const CamMultiAxisContinuous = Cam5Axis;

/* CNC SETUP SHEET — the operator document: a sheet with op rows, tool
   columns and a header block (program meta). */
export const CamSetupSheet = (props) => (
  <Svg {...props}>
    <path d="M5 3h14v18H5z" />
    {/* header block */}
    <path d="M5 7h14" />
    <path d="M7 5h6" />
    {/* op rows w/ tool-number ticks */}
    <path d="M5 11h14M5 14.5h14M5 18h14" />
    <path d="M9 7v14" />
    <path d="M7 9.5h.5M7 12.8h.5M7 16.2h.5" />
  </Svg>
);
export const CncSetupSheet = CamSetupSheet;

/* SLICER (3D printing / additive) — part sliced into horizontal layers,
   the FDM layer stack. */
export const CamSlicer = (props) => (
  <Svg {...props}>
    {/* sliced part silhouette */}
    <path d="M6 20l1.5-14h9L18 20z" />
    {/* slice planes */}
    <path d="M6.7 14h10.6M7.3 10.5h9.4M8 7h8" strokeDasharray="1.8 1.6" />
    <path d="M5 20h14" />
  </Svg>
);
export const Slicer = CamSlicer;
export const CamAdditive = CamSlicer;

/* CAMX — combined pocket/contour/drill + multi-post workbench: a part
   carrying all three op marks (pocket / contour / hole). */
export const CamExtended = (props) => (
  <Svg {...props}>
    <rect x="3" y="4" width="18" height="16" rx="1.5" />
    {/* pocket */}
    <rect x="5.5" y="6.5" width="5" height="4.5" rx="0.6" />
    {/* contour corner */}
    <path d="M13 6.5h5v5" />
    {/* drilled hole */}
    <circle cx="8" cy="15.5" r="2" />
    {/* contour bottom-right */}
    <path d="M13 18h5v-3" />
  </Svg>
);
export const Camx = CamExtended;

/* HEM — sheet-metal edge folded back flat onto itself (closed hem). */
export const CamHem = (props) => (
  <Svg {...props}>
    {/* base flange */}
    <path d="M3 13h11" />
    {/* hem folded 180° back over the base */}
    <path d="M14 13a3 3 0 0 0 0-6H6" />
    {/* the doubled (returned) leg */}
    <path d="M6 7v-2" />
  </Svg>
);
export const Hem = CamHem;

/* JOG — sheet-metal jog: two close offset bends stepping the face. */
export const CamJog = (props) => (
  <Svg {...props}>
    <path d="M3 16h7a3 3 0 0 0 3-3v-2a3 3 0 0 1 3-3h5" />
    {/* the offset (jog) dimension */}
    <path d="M19 8v8" strokeDasharray="0.1 2.4" />
    <path d="M3 16v2M21 8v-2" />
  </Svg>
);
export const Jog = CamJog;

/* CORNER RELIEF — relief notch cut at a sheet-metal bend corner. */
export const CamCornerRelief = (props) => (
  <Svg {...props}>
    {/* the two flange edges meeting at a corner */}
    <path d="M5 19V5h14" />
    {/* relief notch at the inner corner */}
    <path d="M5 11a3 3 0 0 0 3-3 3 3 0 0 1 3-3" strokeDasharray="0.1 100" />
    <circle cx="8" cy="8" r="3" />
    {/* bend lines */}
    <path d="M11 8h8M8 11v8" strokeDasharray="1.8 1.6" />
  </Svg>
);
export const CornerRelief = CamCornerRelief;
export const ClosedCorner = CamCornerRelief;
export const MiterFlange = CamCornerRelief;

/* ═══════════════════════════════════════════════════════════════════
   MAP — every real tool/command/kernel id (+ sensible aliases) → glyph.
   ═══════════════════════════════════════════════════════════════════ */
const camIcons = {
  /* ── SETUP / STOCK ── */
  'cam.setup': CamSetup,
  'cam.stock': CamSetup,
  'manufacture.cam-setup': CamSetup,
  'tools.cam': CamSetup,            // CAM (Manufacturing) entry workbench
  'cam': CamSetup,

  /* ── FACE MILL ── */
  'cam.face': CamFaceMill,
  'cam.facemill': CamFaceMill,
  'manufacture.cam-face': CamFaceMill,

  /* ── 2D CONTOUR / PROFILE ── */
  'cam.profile': Cam2DContour,
  'cam.contour': Cam2DContour,
  'manufacture.cam-profile': Cam2DContour,
  'cam-profile': Cam2DContour,

  /* ── 2D POCKET ── */
  'cam.pocket': Cam2DPocket,
  'manufacture.cam-pocket': Cam2DPocket,
  'cam-pocket': Cam2DPocket,
  'pocket': Cam2DPocket,           // FiveAxisCAMPanel strategy id

  /* ── SLOT MILL ── */
  'cam.slot': CamSlotMill,
  'cam.slotmill': CamSlotMill,
  'manufacture.cam-slot': CamSlotMill,

  /* ── DRILL ── */
  'cam.drill': CamDrill,
  'manufacture.cam-drill': CamDrill,
  'cam-drill': CamDrill,
  'tools.drillingPattern': CamDrillingPattern,
  'cam.drillingPattern': CamDrillingPattern,

  /* ── BORE ── */
  'cam.bore': CamBore,
  'manufacture.cam-bore': CamBore,

  /* ── TAP / THREAD-MILL ── */
  'cam.tap': CamTap,
  'cam.threadmill': CamThreadMill,
  'cam.thread': CamTap,
  'manufacture.cam-tap': CamTap,

  /* ── ADAPTIVE CLEARING ── */
  'cam.adaptiveClear': CamAdaptive,
  'cam.adaptive': CamAdaptive,
  'tools.camAdaptive': CamAdaptive,
  'manufacture.cam-adaptive': CamAdaptive,

  /* ── 3D CONTOUR / WATERLINE ── */
  'cam.contour3d': Cam3DContour,
  'cam.zlevel': Cam3DContour,
  'cam.waterline': Cam3DContour,
  'manufacture.cam-contour3d': Cam3DContour,

  /* ── PARALLEL FINISH ── */
  'cam.parallel': CamParallelFinish,
  'cam.parallelFinish': CamParallelFinish,
  'parallel-to-face': CamParallelToFace,   // FiveAxisCAMPanel strategy id
  'manufacture.cam-parallel': CamParallelFinish,

  /* ── SCALLOP ── */
  'cam.scallop': CamScallop,
  'manufacture.cam-scallop': CamScallop,

  /* ── ENGRAVE ── */
  'cam.engrave': CamEngrave,
  'manufacture.cam-engrave': CamEngrave,

  /* ── TURNING PROFILE ── */
  'cam.turn': CamTurningProfile,
  'cam.turning': CamTurningProfile,
  'cam.turningProfile': CamTurningProfile,
  'manufacture.cam-turn': CamTurningProfile,

  /* ── GROOVE ── */
  'cam.groove': CamGroove,
  'cam.parting': CamGroove,
  'manufacture.cam-groove': CamGroove,

  /* ── TOOLPATH SIMULATE ── */
  'cam.simulate': CamSimulate,
  'cam.sim': CamSimulate,
  'cam.stockSim': CamStockSim,
  'cam.verify': CamSimulate,
  'tools.camSim': CamSimulate,
  'manufacture.cam-simulate': CamSimulate,

  /* ── POST-PROCESS / G-CODE ── */
  'cam.gcode': CamGcode,
  'cam.post': CamPost,
  'cam.postProcess': CamPostProcess,
  'manufacture.gcode': CamGcode,
  'gcode': CamGcode,

  /* ── TOOL LIBRARY ── */
  'cam.toolLibrary': CamToolLibrary,
  'cam.tools': CamToolLibrary,
  'tools.library': CamToolLibrary,
  'manufacture.tool-library': CamToolLibrary,

  /* ── PROBE ── */
  'cam.probe': CamProbe,
  'manufacture.probe': CamProbe,

  /* ── NESTING ── */
  'cam.nesting': CamNesting,
  'cam.nest': CamNesting,
  'manufacture.nesting': CamNesting,

  /* ── SHEET-METAL UNFOLD / FLAT-PATTERN ── */
  'sheetmetal-unfold': CamFlatPattern,
  'cam.unfold': CamUnfold,
  'cam.flatPattern': CamFlatPattern,
  'flatPattern': FlatPattern,
  'unfold': CamUnfold,

  /* ── BEND / FLANGE ── */
  'bend': CamBend,
  'cam.bend': CamBend,
  'edgeFlange': EdgeFlange,
  'baseFlange': CamBend,
  'sheetMetal.bend': CamBend,

  /* ── LASER / PLASMA / WATERJET CUT ── */
  'cam.laser': CamLaserCut,
  'cam.plasma': CamPlasmaCut,
  'cam.waterjet': CamWaterjet,
  'cam.laserCut': CamLaserCut,
  'manufacture.laser-cut': CamLaserCut,
  'manufacture.plasma-cut': CamPlasmaCut,

  /* ── 5-AXIS / SWARF / MULTI-AXIS ── */
  'swarf': CamSwarf,
  'cam.swarf': CamSwarf,
  'cam.multiAxisIndexed': CamMultiAxisIndexed,
  'cam.multiAxisContinuous': CamMultiAxisContinuous,
  'tools.cam5Axis': Cam5Axis,
  'cam.5axis': Cam5Axis,

  /* ── CNC SETUP SHEET ── */
  'tools.cncSetupSheet': CncSetupSheet,
  'cam.setupSheet': CncSetupSheet,
  'cncSetupSheet': CncSetupSheet,

  /* ── SLICER (additive) ── */
  'tools.slicer': CamSlicer,
  'cam.slicer': CamSlicer,
  'slicer': Slicer,

  /* ── CAMX (extended workbench) ── */
  'camx': CamExtended,
  'tools.camx': CamExtended,

  /* ── SHEET-METAL CORNER / HEM / JOG ── */
  'hem': CamHem,
  'jog': CamJog,
  'cornerRelief': CornerRelief,
  'closedCorner': ClosedCorner,
  'miterFlange': MiterFlange,
  'tools.sheetCatalogue': CamFlatPattern,
};

export default camIcons;
