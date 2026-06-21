// ============================================================================
// Forge-v4 — ARCHIE + STATUS-BAR + MISC CHROME icon set
// ----------------------------------------------------------------------------
// Hand-authored, Siemens-NX / Dassault-CATIA / SolidWorks toolbar-grade SVG
// glyphs for the "archie-status" command category — the AI assistant mark, the
// prompt/plan/build flow, the run states (spinner / success / warning / error /
// info), and the status-bar + viewport chrome toggles (snap, grid, magnetic
// snap, coordinate readout, selection filters, units badge, history timeline,
// rollback, parametric/equation, sensor, comment/markup).
//
// Every glyph is UNIQUE and literally depicts what the control DOES, the way a
// professional MCAD status bar / HUD does:
//   archie        → a four-point AI "spark" (the assistant mark)
//   send          → a paper-plane prompt vector
//   plan          → an ordered checklist of steps (the build plan)
//   build-running → a circular activity / progress spinner with a leading gap
//   success       → a check inside a circle
//   warning       → an exclamation inside a triangle
//   error         → an X inside a circle
//   info          → an i inside a circle
//   snap-toggle   → two endpoints snapping together with a snap glyph
//   grid-toggle   → a construction grid of cells
//   magnetic-snap → a horseshoe magnet pulling a point to a node
//   coordinate    → an X/Y/Z origin triad with a read-out cursor
//   filter body   → a solid box (whole-body pick)
//   filter face   → a single highlighted planar face
//   filter edge   → a single highlighted edge of a box
//   filter vertex → a single highlighted corner node
//   units-badge   → a tagged "mm" measure label
//   history       → a clock with a counter-clockwise rewind arrow
//   timeline      → a feature-tree timeline of nodes along a track
//   rollback      → a rollback bar dragged back up the timeline
//   parametric    → an f(x) equation / driven-dimension glyph
//   sensor        → a probe/sensor measuring a value with signal waves
//   comment/markup→ a speech bubble with a markup pen
//
// ICON STANDARD (identical across EVERY Forge category):
//   <svg viewBox="0 0 24 24" width/height={props.size||18} fill="none"
//        stroke="currentColor" strokeWidth={1.5}
//        strokeLinecap="round" strokeLinejoin="round" {...props}>
//   • MONOCHROME — currentColor only, no fills/colours (occasional tiny
//     fill="currentColor" stroke="none" dot for a centre-mark / sensor node).
//   • All content kept within x,y ∈ [2,22] (2 px safe padding).
//   • Consistent visual weight + complexity across the whole set.
//
// Pure presentational components — NO behaviour/logic. The default export is a
// map { '<toolId>': Component }; each component is ALSO a named export.
//
// The map keys are the REAL command / icon / test ids used by the app, grepped
// from:
//   frontend/src/ai/ForgeToolBridge.js
//   frontend/src/forge-v4/Icon.jsx        (archie.spark / send / cancel /
//                                           history / formula / thread)
//   frontend/src/forge-v4/ArchieDock.jsx  (forge-archie / forge-archie-cancel)
//   frontend/src/forge-v4/StatusBar.jsx   (forge-statusbar : units/snap/ortho)
//   frontend/src/forge-v4/Toast.jsx       (forge-toast kinds info/ok/warn/err)
//   frontend/src/forge-v4/SnapStatusChip.jsx        (forge-snap-toggle, grid)
//   frontend/src/forge-v4/SelectionFilterStrip.jsx  (edit.filterBody/Face/
//                                                     Edge/Vert)
//   frontend/src/forge-v4/RollbackBar.jsx           (forge-rollback)
//   frontend/src/forge-v4/BooleanHistoryPanel.jsx   (tools.boolHistory)
//   frontend/src/forge-v4/EquationManager.jsx       (tools.equations)
//   frontend/src/forge-v4/PMIAnnotations.jsx        (tools.pmiAnnotations)
//   frontend/src/forge-v4/Menus.jsx                 (tools.groundgrid, view.*)
// — plus sensible plain-word aliases so a lookup by either the canonical id
// or a natural name resolves, giving complete coverage of the category.
//
// Usage:
//   import STATUS_ICONS, { ArchieIcon } from 'forge-v4/icons/archie-statusIcons.jsx';
//   const Glyph = STATUS_ICONS['archie.spark'];   // or STATUS_ICONS['archie']
//   <Glyph size={20} />
// ============================================================================

import React from 'react';

// Shared <svg> wrapper so every glyph is pixel-identical in frame, weight and
// stroke behaviour. Children are the hand-authored paths.
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
   ARCHIE — the AI assistant + its prompt / plan / build flow
   ════════════════════════════════════════════════════════════════════════ */

// ARCHIE / ASSISTANT MARK — a four-point AI "spark" with a small orbiting
// accent star: the canonical assistant glyph.
export const ArchieIcon = (props) => (
  <Svg {...props}>
    {/* main spark: a 4-pointed star drawn as concave diamond cusps */}
    <path d="M12 3.2c.5 3.6 1.9 5 5.5 5.5 -3.6 .5 -5 1.9 -5.5 5.5 -.5 -3.6 -1.9 -5 -5.5 -5.5 3.6 -.5 5 -1.9 5.5 -5.5z" />
    {/* small accent spark, lower-left */}
    <path d="M6.5 15.5c.25 1.5 .8 2 2.3 2.3 -1.5 .25 -2 .8 -2.3 2.3 -.25 -1.5 -.8 -2 -2.3 -2.3 1.5 -.25 2 -.8 2.3 -2.3z" />
  </Svg>
);

// SEND / PROMPT — a paper-plane vector launching the prompt to Archie.
export const SendIcon = (props) => (
  <Svg {...props}>
    {/* outbound paper plane */}
    <path d="M21 4L3 11l7 2.5L13 21l3-9z" />
    {/* fold crease from nose to body */}
    <path d="M21 4l-11 9.5" />
  </Svg>
);

// PLAN — an ordered checklist of build steps (Archie's plan before it runs).
export const PlanIcon = (props) => (
  <Svg {...props}>
    {/* clipboard/sheet */}
    <path d="M5 4h14v16H5z" />
    {/* three checked plan rows */}
    <path d="M7.5 8l1.3 1.3L11 7" />
    <path d="M13.5 8.5H17" />
    <path d="M7.5 13l1.3 1.3L11 12" />
    <path d="M13.5 13.5H17" />
    <path d="M7.5 17.5H11" />
  </Svg>
);

// BUILD-RUNNING / SPINNER — a circular activity arc with a leading gap and an
// arrowhead (a build in progress).
export const BuildRunningIcon = (props) => (
  <Svg {...props}>
    {/* near-full progress arc, ~300° */}
    <path d="M20 12a8 8 0 1 1-2.34-5.66" />
    {/* arrowhead at the leading edge */}
    <path d="M20 5v4h-4" />
  </Svg>
);

/* ════════════════════════════════════════════════════════════════════════
   RUN STATE BADGES — success / warning / error / info
   ════════════════════════════════════════════════════════════════════════ */

// SUCCESS — a check inside a ring.
export const SuccessIcon = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M8 12.2l2.6 2.6L16 9.4" />
  </Svg>
);

// WARNING — an exclamation inside a rounded triangle.
export const WarningIcon = (props) => (
  <Svg {...props}>
    <path d="M12 4.2L21 19.5H3z" />
    <path d="M12 10v4" />
    <path d="M12 16.6v.05" />
  </Svg>
);

// ERROR — an X inside a ring.
export const ErrorIcon = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M9 9l6 6M15 9l-6 6" />
  </Svg>
);

// INFO — an "i" inside a ring.
export const InfoIcon = (props) => (
  <Svg {...props}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5" />
    <path d="M12 7.6v.05" />
  </Svg>
);

/* ════════════════════════════════════════════════════════════════════════
   VIEWPORT / STATUS-BAR TOGGLES — snap · grid · magnetic-snap · coordinates
   ════════════════════════════════════════════════════════════════════════ */

// SNAP-TOGGLE — two endpoints converging onto a snap node (the snap engine).
export const SnapToggleIcon = (props) => (
  <Svg {...props}>
    {/* two segments meeting at a snap node */}
    <path d="M4 5l6.4 6.4" />
    <path d="M20 5l-6.4 6.4" />
    {/* snap diamond at the meeting point */}
    <path d="M12 9.8l2.2 2.2-2.2 2.2-2.2-2.2z" />
    {/* the snapped-to baseline endpoints */}
    <path d="M4 19h16" opacity="0.5" />
    <circle cx="6" cy="19" r="0.9" fill="currentColor" stroke="none" />
    <circle cx="18" cy="19" r="0.9" fill="currentColor" stroke="none" />
  </Svg>
);

// GRID-TOGGLE — a 3×3 construction grid of cells.
export const GridToggleIcon = (props) => (
  <Svg {...props}>
    <path d="M4 4h16v16H4z" />
    <path d="M9.33 4v16M14.66 4v16" />
    <path d="M4 9.33h16M4 14.66h16" />
  </Svg>
);

// MAGNETIC-SNAP — a horseshoe magnet pulling a point onto a node.
export const MagneticSnapIcon = (props) => (
  <Svg {...props}>
    {/* horseshoe magnet body */}
    <path d="M6 4v6a6 6 0 0 0 12 0V4" />
    {/* magnet pole caps */}
    <path d="M4 4h4M16 4h4" />
    <path d="M6 8h2M16 8h2" />
    {/* attracted point with pull lines */}
    <circle cx="12" cy="19.5" r="1.2" fill="currentColor" stroke="none" />
    <path d="M9 17l1.5 1M15 17l-1.5 1" opacity="0.6" />
  </Svg>
);

// COORDINATE-READOUT — an X/Y/Z origin triad with a cursor reading position.
export const CoordinateIcon = (props) => (
  <Svg {...props}>
    {/* axis triad from a shared origin */}
    <path d="M6 18V5" />
    <path d="M6 18h13" />
    <path d="M6 18l-2.6 2.6" />
    {/* axis arrowheads */}
    <path d="M6 5l-1.4 1.6M6 5l1.4 1.6" />
    <path d="M19 18l-1.6-1.4M19 18l-1.6 1.4" />
    {/* readout cursor crosshair at a sampled point */}
    <path d="M14.5 9.5l1.4 1.4M15.9 9.5l-1.4 1.4" />
  </Svg>
);

/* ════════════════════════════════════════════════════════════════════════
   SELECTION FILTERS — body · face · edge · vertex
   ════════════════════════════════════════════════════════════════════════ */

// FILTER · BODY — a whole solid box (pick complete bodies).
export const FilterBodyIcon = (props) => (
  <Svg {...props}>
    {/* iso box: front face + receding top/right */}
    <path d="M5 8.5l7-3.5 7 3.5v7l-7 3.5-7-3.5z" />
    <path d="M5 8.5l7 3.5 7-3.5" />
    <path d="M12 12v7" />
  </Svg>
);

// FILTER · FACE — a box with one planar face highlighted (hatched).
export const FilterFaceIcon = (props) => (
  <Svg {...props}>
    {/* box outline (de-emphasised) */}
    <path d="M5 8.5l7-3.5 7 3.5v7l-7 3.5-7-3.5z" opacity="0.45" />
    <path d="M5 8.5l7 3.5 7-3.5M12 12v7" opacity="0.45" />
    {/* highlighted front face with diagonal hatching */}
    <path d="M5 8.5l7 3.5v7l-7-3.5z" />
    <path d="M6.5 11.2l4 3.2M6.5 14l4 3.2" opacity="0.7" />
  </Svg>
);

// FILTER · EDGE — a box with one edge highlighted with endpoint nodes.
export const FilterEdgeIcon = (props) => (
  <Svg {...props}>
    {/* box outline (de-emphasised) */}
    <path d="M5 8.5l7-3.5 7 3.5v7l-7 3.5-7-3.5z" opacity="0.45" />
    <path d="M5 8.5l7 3.5 7-3.5M12 12v7" opacity="0.45" />
    {/* highlighted vertical edge with end nodes */}
    <path d="M12 12v7" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none" />
  </Svg>
);

// FILTER · VERTEX — a box with a single corner node highlighted.
export const FilterVertexIcon = (props) => (
  <Svg {...props}>
    {/* box outline (de-emphasised) */}
    <path d="M5 8.5l7-3.5 7 3.5v7l-7 3.5-7-3.5z" opacity="0.45" />
    <path d="M5 8.5l7 3.5 7-3.5M12 12v7" opacity="0.45" />
    {/* highlighted top vertex with selection ring */}
    <circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" />
    <circle cx="12" cy="5" r="3.4" opacity="0.7" />
  </Svg>
);

/* ════════════════════════════════════════════════════════════════════════
   STATUS-BAR READOUTS — units badge
   ════════════════════════════════════════════════════════════════════════ */

// UNITS-BADGE — a measure label tag stamped "mm" (the active unit system).
export const UnitsBadgeIcon = (props) => (
  <Svg {...props}>
    {/* tag/label shape with a hole eyelet */}
    <path d="M3 7.5h11l5 4.5-5 4.5H3z" />
    {/* the "mm" unit ticks rendered as a measure scale inside the tag */}
    <path d="M5.5 11v2M8 11v2M10.5 11v2M13 11v2" />
    {/* eyelet at the pointed end */}
    <circle cx="16.2" cy="12" r="0.9" fill="currentColor" stroke="none" />
  </Svg>
);

/* ════════════════════════════════════════════════════════════════════════
   HISTORY / TIMELINE / ROLLBACK — the feature-tree time controls
   ════════════════════════════════════════════════════════════════════════ */

// HISTORY — a clock with a counter-clockwise rewind arrow.
export const HistoryIcon = (props) => (
  <Svg {...props}>
    {/* clock face */}
    <circle cx="13" cy="12" r="8" />
    {/* clock hands */}
    <path d="M13 8v4l2.5 2" />
    {/* rewind arrow sweeping in from the left */}
    <path d="M5 5.5v3.5h3.5" />
  </Svg>
);

// TIMELINE — a feature-tree timeline of nodes strung along a track.
export const TimelineIcon = (props) => (
  <Svg {...props}>
    {/* the timeline track */}
    <path d="M3 12h18" />
    {/* feature nodes along it */}
    <circle cx="6" cy="12" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none" />
    <circle cx="18" cy="12" r="1.7" fill="currentColor" stroke="none" />
    {/* tick risers showing ordered features */}
    <path d="M6 12V7M12 12V6M18 12V8" opacity="0.6" />
  </Svg>
);

// ROLLBACK — the rollback bar dragged back up the feature tree.
export const RollbackIcon = (props) => (
  <Svg {...props}>
    {/* feature-tree rows */}
    <path d="M7 5h12M7 9h12M7 19h12" opacity="0.45" />
    {/* the rollback bar (active, full weight) sitting at the suppressed line */}
    <path d="M4 14h16" />
    {/* drag handle / up-arrow showing it rolls back upward */}
    <path d="M12 14V9M9.5 11.5L12 9l2.5 2.5" />
  </Svg>
);

/* ════════════════════════════════════════════════════════════════════════
   PARAMETRIC / EQUATION · SENSOR · COMMENT / MARKUP
   ════════════════════════════════════════════════════════════════════════ */

// PARAMETRIC / EQUATION — an f(x) driven-dimension glyph (equation manager).
export const ParametricIcon = (props) => (
  <Svg {...props}>
    {/* the italic 'f' of f(x) */}
    <path d="M13 5h-1.6A2.4 2.4 0 0 0 9 7.4V18" />
    <path d="M6.5 11h6" />
    {/* the parentheses of f(x) */}
    <path d="M16 6.5a7 7 0 0 1 0 11" />
    <path d="M20 6.5a7 7 0 0 0 0 11" opacity="0.5" />
  </Svg>
);

// SENSOR — a probe measuring a value, emitting signal waves (a sim sensor).
export const SensorIcon = (props) => (
  <Svg {...props}>
    {/* sensor housing on a stand */}
    <path d="M5 9h6v6H5z" />
    <path d="M8 15v4M5.5 19h5" />
    {/* the probe node reading a point */}
    <circle cx="8" cy="12" r="1.4" fill="currentColor" stroke="none" />
    {/* emitted signal waves to the right */}
    <path d="M14 9.5a4 4 0 0 1 0 5" />
    <path d="M17 7.5a8 8 0 0 1 0 9" opacity="0.55" />
  </Svg>
);

// COMMENT / MARKUP — a speech bubble annotated with a markup pen.
export const CommentIcon = (props) => (
  <Svg {...props}>
    {/* comment bubble with a tail */}
    <path d="M4 5h12a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H9l-4 4v-4a1 1 0 0 1-1-1V7a2 2 0 0 1 2-2z" />
    {/* markup pen drawing inside the bubble */}
    <path d="M7.5 11l3-3 1.6 1.6-3 3H7.5z" />
  </Svg>
);

/* ════════════════════════════════════════════════════════════════════════
   ID → COMPONENT MAP  (canonical ids first, then plain-word aliases)
   ════════════════════════════════════════════════════════════════════════ */

const STATUS_ICONS = {
  // ── Archie assistant mark ────────────────────────────────────────────
  'archie.spark':        ArchieIcon,
  'forge-archie':        ArchieIcon,
  'archie':              ArchieIcon,
  'assistant':           ArchieIcon,
  'ai':                  ArchieIcon,
  'ai-assistant':        ArchieIcon,
  'archie.thread':       ArchieIcon,   // assistant thread shares the mark

  // ── Send / prompt ────────────────────────────────────────────────────
  'archie.send':         SendIcon,
  'send':                SendIcon,
  'prompt':              SendIcon,
  'submit-prompt':       SendIcon,
  'ai.send':             SendIcon,

  // ── Plan ─────────────────────────────────────────────────────────────
  'archie.plan':         PlanIcon,
  'plan':                PlanIcon,
  'build-plan':          PlanIcon,
  'planner':             PlanIcon,
  'ai.plan':             PlanIcon,
  'steps':               PlanIcon,

  // ── Build running / spinner ──────────────────────────────────────────
  'archie.running':      BuildRunningIcon,
  'build-running':       BuildRunningIcon,
  'buildRunning':        BuildRunningIcon,
  'spinner':             BuildRunningIcon,
  'busy':                BuildRunningIcon,
  'thinking':            BuildRunningIcon,
  'progress':            BuildRunningIcon,
  'ai.running':          BuildRunningIcon,
  'run':                 BuildRunningIcon,

  // ── Run-state badges ─────────────────────────────────────────────────
  'status.success':      SuccessIcon,
  'success':             SuccessIcon,
  'ok':                  SuccessIcon,   // Toast.jsx kind 'ok'
  'toast.ok':            SuccessIcon,
  'check':               SuccessIcon,
  'done':                SuccessIcon,
  'pass':                SuccessIcon,

  'status.warning':      WarningIcon,
  'warning':             WarningIcon,
  'warn':                WarningIcon,    // Toast.jsx kind 'warn'
  'toast.warn':          WarningIcon,
  'caution':             WarningIcon,

  'status.error':        ErrorIcon,
  'error':               ErrorIcon,
  'err':                 ErrorIcon,      // Toast.jsx kind 'err'
  'toast.err':           ErrorIcon,
  'fail':                ErrorIcon,
  'archie.cancel':       ErrorIcon,      // cancel/abort shares the X-in-ring
  'forge-archie-cancel': ErrorIcon,

  'status.info':         InfoIcon,
  'info':                InfoIcon,       // Toast.jsx kind 'info'
  'toast.info':          InfoIcon,
  'notice':              InfoIcon,

  // ── Snap toggle ──────────────────────────────────────────────────────
  'forge-snap-toggle':   SnapToggleIcon,
  'snap-toggle':         SnapToggleIcon,
  'snapToggle':          SnapToggleIcon,
  'snap':                SnapToggleIcon,
  'view.snap':           SnapToggleIcon,
  'toggle-snap':         SnapToggleIcon,

  // ── Grid toggle ──────────────────────────────────────────────────────
  'tools.groundgrid':    GridToggleIcon,
  'workbench.groundgrid':GridToggleIcon,
  'grid-toggle':         GridToggleIcon,
  'gridToggle':          GridToggleIcon,
  'grid':                GridToggleIcon,
  'view.grid':           GridToggleIcon,
  'toggle-grid':         GridToggleIcon,

  // ── Magnetic snap ────────────────────────────────────────────────────
  'magnetic-snap':       MagneticSnapIcon,
  'magneticSnap':        MagneticSnapIcon,
  'magnet':              MagneticSnapIcon,
  'snap.magnetic':       MagneticSnapIcon,

  // ── Coordinate readout ───────────────────────────────────────────────
  'coordinate-readout':  CoordinateIcon,
  'coordinateReadout':   CoordinateIcon,
  'coordinate':          CoordinateIcon,
  'coords':              CoordinateIcon,
  'cursor-xyz':          CoordinateIcon,
  'origin-triad':        CoordinateIcon,
  'status.coords':       CoordinateIcon,

  // ── Selection filters ────────────────────────────────────────────────
  'edit.filterBody':     FilterBodyIcon,
  'filter.body':         FilterBodyIcon,
  'filter-body':         FilterBodyIcon,
  'selection-filter':    FilterBodyIcon,   // category-level default → body
  'selectionFilter':     FilterBodyIcon,
  'filter':              FilterBodyIcon,

  'edit.filterFace':     FilterFaceIcon,
  'filter.face':         FilterFaceIcon,
  'filter-face':         FilterFaceIcon,

  'edit.filterEdge':     FilterEdgeIcon,
  'filter.edge':         FilterEdgeIcon,
  'filter-edge':         FilterEdgeIcon,

  'edit.filterVert':     FilterVertexIcon,
  'filter.vertex':       FilterVertexIcon,
  'filter-vertex':       FilterVertexIcon,
  'filter.vert':         FilterVertexIcon,

  // ── Units badge ──────────────────────────────────────────────────────
  'status.units':        UnitsBadgeIcon,
  'units-badge':         UnitsBadgeIcon,
  'unitsBadge':          UnitsBadgeIcon,
  'units':               UnitsBadgeIcon,
  'unit-system':         UnitsBadgeIcon,
  'forge-statusbar':     UnitsBadgeIcon,   // status-bar summary glyph

  // ── History ──────────────────────────────────────────────────────────
  'tools.boolHistory':   HistoryIcon,
  'archie.history':      HistoryIcon,
  'history':             HistoryIcon,
  'forge.v4.history':    HistoryIcon,
  'undo-history':        HistoryIcon,

  // ── Timeline (feature tree timeline) ─────────────────────────────────
  'timeline':            TimelineIcon,
  'feature-timeline':    TimelineIcon,
  'featureTimeline':     TimelineIcon,
  'history-timeline':    TimelineIcon,

  // ── Rollback ─────────────────────────────────────────────────────────
  'forge-rollback':      RollbackIcon,
  'rollback':            RollbackIcon,
  'rollback-bar':        RollbackIcon,
  'rollbackBar':         RollbackIcon,
  'roll-back':           RollbackIcon,

  // ── Parametric / equation ────────────────────────────────────────────
  'tools.equations':     ParametricIcon,
  'forge.v4.equations':  ParametricIcon,
  'archie.formula':      ParametricIcon,
  'parametric':          ParametricIcon,
  'equation':            ParametricIcon,
  'equations':           ParametricIcon,
  'fx':                  ParametricIcon,
  'driven-dimension':    ParametricIcon,
  'formula':             ParametricIcon,

  // ── Sensor ───────────────────────────────────────────────────────────
  'sensor':              SensorIcon,
  'sensors':             SensorIcon,
  'probe':               SensorIcon,
  'measure-sensor':      SensorIcon,
  'design.sensor':       SensorIcon,

  // ── Comment / markup ─────────────────────────────────────────────────
  'tools.pmiAnnotations':CommentIcon,
  'comment':             CommentIcon,
  'markup':              CommentIcon,
  'annotation':          CommentIcon,
  'note':                CommentIcon,
  'comments':            CommentIcon,
  'forge.v4.pmiNotes':   CommentIcon,
};

export default STATUS_ICONS;
