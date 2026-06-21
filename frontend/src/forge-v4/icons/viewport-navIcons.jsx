// ============================================================================
// Forge-v4 — VIEWPORT / NAVIGATION icon set
// ----------------------------------------------------------------------------
// Hand-authored, Siemens-NX / Dassault-CATIA / SolidWorks toolbar-grade SVG
// glyphs for the "viewport-nav" command category. Every glyph is UNIQUE and
// literally depicts the operation the way a professional MCAD toolbar does:
//   fit-all      → a body framed by L-shaped fit brackets
//   zoom-window  → a marquee rectangle dragged over the scene
//   zoom-in/out  → a magnifier with + / −
//   pan          → a 4-way grab cross
//   orbit/rotate → a sphere with a circling orbital arrow
//   roll         → a circular arrow spinning the camera about its sight axis
//   look-at      → an eye + crosshair targeting a point
//   fly          → a paper-plane / walk-through camera vector
//   iso/dimetric → a wireframe cube seen down its body diagonal / 2-equal-axes
//   front/back/… → a labelled face of the standard view cube
//   normal-to    → camera axis snapping perpendicular to a face
//   section      → a cutting plane slicing a solid with hatched cut face
//   clip-plane   → a half-space clip plane through a body
//   persp/ortho  → a frustum (converging) vs a prism (parallel) toggle
//   visual-style → shaded / shaded+edges / wireframe / hidden-line / x-ray / realistic spheres
//   camera       → a camera body
//   viewcube-home→ a house (home view)
//   previous-view→ a counter-clockwise history arrow
//   full-screen  → expand-to-corners arrows
//
// ICON STANDARD (identical across every category):
//   <svg viewBox="0 0 24 24" width/height={props.size||18} fill="none"
//        stroke="currentColor" strokeWidth={1.5}
//        strokeLinecap="round" strokeLinejoin="round" {...props}>
//   • MONOCHROME — currentColor only, no fills/colours (occasional
//     fill="currentColor" stroke="none" only for tiny solid dots/centre-marks).
//   • All content kept within [2,22] (2px safe padding).
//   • Consistent visual weight + complexity across the set.
//
// Pure presentational components — NO behaviour/logic. The default export is a
// map { '<toolId>': Component }; each component is also a named export.
//
// The map keys are the REAL command/icon ids used by the app (grepped from
// frontend/src/ai/ForgeToolBridge.js, frontend/src/forge-v4/Menus.jsx,
// HeadsUpToolbar.jsx, NavSphere.jsx, ForgeShellV4.jsx, DisplayStateQuickBar.jsx,
// Icon.jsx) — e.g. view.iso / view.front / view.zoomFit / view.zoom_fit /
// view.normalTo / view.shaded / view.wireframe / view.section / view.transparent
// / view.home / view.center — plus sensible aliases for every conceptual
// viewport-nav operation so the whole category is covered.
// ============================================================================

import React from 'react';

// Shared <svg> wrapper so every glyph is pixel-for-pixel on-standard.
const S = (props, children) => {
  const { size, ...rest } = props || {};
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
};

// Tiny helper for the solid centre-dot / camera-target pip (the only filled bits).
const Dot = (cx, cy, r = 1) => (
  <circle cx={cx} cy={cy} r={r} fill="currentColor" stroke="none" />
);

// ───────────────────────── ZOOM / FIT ─────────────────────────

// fit-all — a body (cube) hugged by four L-shaped "frame" brackets.
export const FitAll = (props) => S(props, (
  <>
    <path d="M3 6V3h3M18 3h3v3M21 18v3h-3M6 21H3v-3" />
    <path d="M9 9h6v6H9z" />
  </>
));

// zoom-window — a magnifier dragging a dashed marquee rectangle.
export const ZoomWindow = (props) => S(props, (
  <>
    <rect x="3" y="4" width="11" height="9" rx="0.5" strokeDasharray="2 1.6" />
    <circle cx="14" cy="14" r="4" />
    <path d="M17 17l3.5 3.5" />
  </>
));

// zoom-in — magnifier with a "+".
export const ZoomIn = (props) => S(props, (
  <>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M14.8 14.8L21 21" />
    <path d="M10 7v6M7 10h6" />
  </>
));

// zoom-out — magnifier with a "−".
export const ZoomOut = (props) => S(props, (
  <>
    <circle cx="10" cy="10" r="6.5" />
    <path d="M14.8 14.8L21 21" />
    <path d="M7 10h6" />
  </>
));

// ───────────────────────── PAN / ORBIT / ROLL ─────────────────────────

// pan — a 4-way grab cross with arrowheads (drag the scene).
export const Pan = (props) => S(props, (
  <>
    <path d="M12 3v18M3 12h18" />
    <path d="M12 3l-2 2.5M12 3l2 2.5" />
    <path d="M12 21l-2-2.5M12 21l2 2.5" />
    <path d="M3 12l2.5-2M3 12l2.5 2" />
    <path d="M21 12l-2.5-2M21 12l-2.5 2" />
  </>
));

// orbit / rotate — a sphere (with axis ellipse) wrapped by a circling
// orbital arrow: the tumble camera.
export const Orbit = (props) => S(props, (
  <>
    <circle cx="12" cy="12" r="5" />
    <ellipse cx="12" cy="12" rx="5" ry="2.2" transform="rotate(-28 12 12)" />
    <path d="M19.5 6.5a9 9 0 0 1-1.6 11.8" />
    <path d="M19.5 6.5l-3.1.7M19.5 6.5l.9 3" />
  </>
));

// roll — circular arrow that rolls the camera about its line of sight.
export const Roll = (props) => S(props, (
  <>
    <path d="M5.5 12a6.5 6.5 0 1 1 2.6 5.2" />
    <path d="M8 13.6l-2.6 1.7-1.4-2.8" />
    {Dot(12, 12, 1)}
  </>
));

// ───────────────────────── LOOK-AT / FLY ─────────────────────────

// look-at — an eye centred on a crosshair target point (aim the camera).
export const LookAt = (props) => S(props, (
  <>
    <path d="M3 12c2.4-3.4 5.4-5 9-5s6.6 1.6 9 5c-2.4 3.4-5.4 5-9 5s-6.6-1.6-9-5z" />
    <circle cx="12" cy="12" r="2.3" />
    <path d="M12 3v2M12 19v2M3 12h-1M22 12h-1" />
  </>
));

// fly — a paper-plane camera vector flying through the scene (walk/fly-through).
export const Fly = (props) => S(props, (
  <>
    <path d="M21 4L3 11l6.5 2.2L12 20l2.6-6.2z" />
    <path d="M9.5 13.2L21 4" />
  </>
));

// ───────────────────────── STANDARD ORIENTATIONS ─────────────────────────

// isometric — a wireframe cube viewed down its body diagonal (3 equal faces).
export const Isometric = (props) => S(props, (
  <>
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
  </>
));

// dimetric — cube tipped so TWO axes are equal & one differs (asymmetric tip).
export const Dimetric = (props) => S(props, (
  <>
    <path d="M12 4l7 3v8l-7 4-7-3.4V8z" />
    <path d="M5 8l7 3.4 7-3.4M12 11.4V19" />
    <path d="M5 8l7-4 7 3" strokeDasharray="1.6 1.6" />
  </>
));

// front — view cube with the FRONT face highlighted (camera looks at +Y face).
export const Front = (props) => S(props, (
  <>
    <path d="M5 8.5l7-3.5 7 3.5v7l-7 3.5-7-3.5z" />
    <path d="M5 8.5l7 3.5 7-3.5M12 12v7" />
    <path d="M5 8.5V15.5l7 3.5V12z" fill="currentColor" stroke="none" opacity="0.55" />
  </>
));

// back — view cube with the rear face highlighted (back of the body).
export const Back = (props) => S(props, (
  <>
    <path d="M5 8.5l7-3.5 7 3.5v7l-7 3.5-7-3.5z" />
    <path d="M5 8.5l7 3.5 7-3.5M12 12v7" />
    <path d="M12 5l7 3.5v7l-7-3.5z" fill="currentColor" stroke="none" opacity="0.5" />
    <path d="M19 8.5L12 12" />
  </>
));

// top — view cube with the TOP face highlighted (camera looks straight down).
export const Top = (props) => S(props, (
  <>
    <path d="M5 8.5l7-3.5 7 3.5v7l-7 3.5-7-3.5z" />
    <path d="M5 8.5l7 3.5 7-3.5M12 12v7" />
    <path d="M5 8.5l7-3.5 7 3.5-7 3.5z" fill="currentColor" stroke="none" opacity="0.55" />
  </>
));

// bottom — view cube with the BOTTOM face highlighted (look straight up).
export const Bottom = (props) => S(props, (
  <>
    <path d="M5 8.5l7-3.5 7 3.5v7l-7 3.5-7-3.5z" />
    <path d="M5 8.5l7 3.5 7-3.5M12 12v7" />
    <path d="M5 15.5l7 3.5 7-3.5-7-3.5z" fill="currentColor" stroke="none" opacity="0.55" />
  </>
));

// left — view cube with the LEFT face highlighted.
export const Left = (props) => S(props, (
  <>
    <path d="M5 8.5l7-3.5 7 3.5v7l-7 3.5-7-3.5z" />
    <path d="M5 8.5l7 3.5 7-3.5M12 12v7" />
    <path d="M5 8.5l7 3.5v7l-7-3.5z" fill="currentColor" stroke="none" opacity="0.55" />
  </>
));

// right — view cube with the RIGHT face highlighted.
export const Right = (props) => S(props, (
  <>
    <path d="M5 8.5l7-3.5 7 3.5v7l-7 3.5-7-3.5z" />
    <path d="M5 8.5l7 3.5 7-3.5M12 12v7" />
    <path d="M19 8.5L12 12v7l7-3.5z" fill="currentColor" stroke="none" opacity="0.55" />
  </>
));

// normal-to — camera sight axis snapping PERPENDICULAR to a tilted face,
// with the right-angle square marking the normal.
export const NormalTo = (props) => S(props, (
  <>
    <path d="M4 17l9-11 5 5" />
    <path d="M13 6l4.5 11" strokeDasharray="2 2" />
    <path d="M11 8.6l1.7 1.4-1.4 1.7" />
    {Dot(13, 6, 1.1)}
  </>
));

// ───────────────────────── SECTION / CLIP ─────────────────────────

// section-view (toggle) — a cutting plane slicing a solid; the exposed cut
// face is hatched (the classic section symbol).
export const SectionView = (props) => S(props, (
  <>
    <path d="M5 9l4-3h10v9l-4 3H5z" />
    <path d="M3 6.5l5-3.5 11 0M3 6.5v9.5l5 3.5" strokeDasharray="2 1.8" />
    <path d="M6 15.5l3-2M8.5 16l2.5-1.7M11 16.5l2-1.4" opacity="0.85" />
  </>
));

// clip-plane — a dashed clip plane passing through a body, slicing it into a
// shown half and a clipped (ghost) half.
export const ClipPlane = (props) => S(props, (
  <>
    <path d="M6 8h7v8H6z" />
    <path d="M13 6.5l3-1.5v8l-3 1.5" strokeDasharray="2 1.8" />
    <path d="M3 14l9-4.5 9 4.5" />
    <path d="M3 14l2 .4M21 14l-2 .4" />
  </>
));

// ───────────────────────── PROJECTION TOGGLE ─────────────────────────

// perspective — a converging frustum (eye-point → far rectangle): true 3D feel.
export const Perspective = (props) => S(props, (
  <>
    <path d="M9 9h11v9H9z" />
    <path d="M3 12l6-3M3 12l6 6" />
    {Dot(3, 12, 1.2)}
  </>
));

// orthographic — a straight prism with parallel projection rails (no convergence).
export const Orthographic = (props) => S(props, (
  <>
    <path d="M6 8h10v10H6z" />
    <path d="M3 5h10v10H3z" />
    <path d="M3 5l3 3M13 5l3 3M3 15l3 3M13 15l3 3" />
  </>
));

// perspective/ortho TOGGLE — frustum & prism back-to-back with a switch arrow.
export const ProjectionToggle = (props) => S(props, (
  <>
    <path d="M3 9h6v7H3z" />
    {Dot(3.2, 12.5, 1.1)}
    <path d="M15 8h6v9h-6z" />
    <path d="M21 8l-6 1.5M21 17l-6-1.5" opacity="0.9" />
    <path d="M11 11l2 1.5-2 1.5" />
  </>
));

// ───────────────────────── VISUAL STYLES ─────────────────────────

// shaded — sphere with a smooth terminator (solid lit hemisphere).
export const Shaded = (props) => S(props, (
  <>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none" />
  </>
));

// shaded-with-edges — shaded sphere with explicit facet/edge lines.
export const ShadedEdges = (props) => S(props, (
  <>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none" opacity="0.5" />
    <path d="M4 12h16M12 4v16" />
  </>
));

// wireframe — sphere drawn as latitude/longitude wires only.
export const Wireframe = (props) => S(props, (
  <>
    <circle cx="12" cy="12" r="8" />
    <ellipse cx="12" cy="12" rx="3.2" ry="8" />
    <path d="M4 12h16" />
  </>
));

// hidden-line — wire sphere whose far (hidden) lines are dashed.
export const HiddenLine = (props) => S(props, (
  <>
    <circle cx="12" cy="12" r="8" />
    <path d="M4 12a8 8 0 0 1 16 0" />
    <path d="M4 12a8 8 0 0 0 16 0" strokeDasharray="2 2" />
    <ellipse cx="12" cy="12" rx="3.2" ry="8" strokeDasharray="2 2" />
  </>
));

// x-ray / transparent — see-through sphere (dashed outline, ghosted interior edge).
export const XRay = (props) => S(props, (
  <>
    <circle cx="12" cy="12" r="8" strokeDasharray="2.4 2" />
    <path d="M7 12h10" strokeDasharray="2 2" opacity="0.8" />
    <circle cx="12" cy="12" r="3" strokeDasharray="1.8 1.8" />
  </>
));

// realistic — sphere with a specular highlight + cast shadow (rendered look).
export const Realistic = (props) => S(props, (
  <>
    <circle cx="12" cy="11" r="7.5" />
    <path d="M12 3.5a7.5 7.5 0 0 0 0 15z" fill="currentColor" stroke="none" />
    {Dot(9, 8, 1.4)}
    <path d="M6 21h12" opacity="0.7" />
  </>
));

// visual-style (group / menu root) — a swatch sphere split shaded|wire.
export const VisualStyle = (props) => S(props, (
  <>
    <circle cx="12" cy="12" r="8" />
    <path d="M12 4a8 8 0 0 0 0 16z" fill="currentColor" stroke="none" />
    <path d="M14 6.5l3.5 2M14 12h4M14 17.5l3.5-2" />
  </>
));

// ───────────────────────── CAMERA / HOME / HISTORY / FULLSCREEN ─────────────────────────

// camera — a camera body with lens + viewfinder bump.
export const Camera = (props) => S(props, (
  <>
    <path d="M3 8h3l1.5-2h9L18 8h3v11H3z" />
    <circle cx="12" cy="13" r="3.5" />
    {Dot(18.3, 10.3, 0.9)}
  </>
));

// viewcube-home / home-view — a house (the canonical "home view" glyph).
export const Home = (props) => S(props, (
  <>
    <path d="M3 12l9-8 9 8" />
    <path d="M6 10.3V20h12v-9.7" />
    <path d="M10 20v-5h4v5" />
  </>
));

// previous-view — counter-clockwise history arrow (step camera back).
export const PreviousView = (props) => S(props, (
  <>
    <path d="M5 12a7 7 0 1 0 2.4-5.3" />
    <path d="M4 4v3.8h3.8" />
    {Dot(12, 12, 1)}
  </>
));

// full-screen — four corner arrows expanding to fill the viewport.
export const FullScreen = (props) => S(props, (
  <>
    <path d="M9 4H4v5M20 9V4h-5M15 20h5v-5M4 15v5h5" />
    <path d="M4 4l5 5M20 4l-5 5M20 20l-5-5M4 20l5-5" opacity="0.85" />
  </>
));

// center / zoom-to-fit-on-origin — body crosshair-centred in the frame.
export const Center = (props) => S(props, (
  <>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
    {Dot(12, 12, 1)}
  </>
));

// ============================================================================
// ID MAP — keys are the real command/icon ids + sensible aliases. A single
// component is reused across the ids that denote the SAME operation (e.g.
// view.zoomFit + view.zoom_fit + view.fit all map to FitAll). This keeps the
// glyph language consistent everywhere the op surfaces.
// ============================================================================

const viewportNavIcons = {
  // ── fit / zoom ──
  'view.zoomFit': FitAll,
  'view.zoom_fit': FitAll,           // icon-id spelling used in Menus/HeadsUpToolbar/Icon.jsx
  'view.fit': FitAll,
  'fit-all': FitAll,
  'zoom-fit': FitAll,
  'view.zoomWindow': ZoomWindow,
  'zoom-window': ZoomWindow,
  'view.zoomIn': ZoomIn,
  'zoom-in': ZoomIn,
  'view.zoomOut': ZoomOut,
  'zoom-out': ZoomOut,

  // ── pan / orbit / roll ──
  'view.pan': Pan,
  'pan': Pan,
  'view.orbit': Orbit,
  'view.rotate': Orbit,
  'gizmo.rotate': Orbit,             // viewport tumble shares the orbit glyph
  'orbit': Orbit,
  'rotate': Orbit,
  'view.roll': Roll,
  'roll': Roll,

  // ── look-at / fly ──
  'view.lookAt': LookAt,
  'view.normalToPoint': LookAt,
  'look-at': LookAt,
  'view.fly': Fly,
  'view.walkthrough': Fly,
  'fly': Fly,

  // ── standard orientations ──
  'view.iso': Isometric,
  'isometric': Isometric,
  'view.dimetric': Dimetric,
  'dimetric': Dimetric,
  'view.front': Front,
  'front': Front,
  'view.back': Back,
  'back': Back,
  'view.top': Top,
  'top': Top,
  'view.bottom': Bottom,
  'bottom': Bottom,
  'view.left': Left,
  'left': Left,
  'view.right': Right,
  'right': Right,
  'view.normalTo': NormalTo,
  'normal-to': NormalTo,

  // ── section / clip ──
  'view.section': SectionView,
  'section-view-toggle': SectionView,
  'tools.sectionPlane': SectionView, // Section Plane… menu entry
  'view.clipPlane': ClipPlane,
  'clip-plane': ClipPlane,

  // ── projection toggle ──
  'view.perspective': Perspective,
  'perspective': Perspective,
  'view.ortho': Orthographic,
  'view.orthographic': Orthographic,
  'orthographic': Orthographic,
  'view.projectionToggle': ProjectionToggle,
  'perspective-ortho-toggle': ProjectionToggle,

  // ── visual styles ──
  'view.shaded': Shaded,
  'shaded': Shaded,
  'view.shadedEdges': ShadedEdges,
  'view.shadedWithEdges': ShadedEdges,
  'shaded-edges': ShadedEdges,
  'view.wireframe': Wireframe,
  'wireframe': Wireframe,
  'view.hiddenLine': HiddenLine,
  'hidden-line': HiddenLine,
  'view.transparent': XRay,          // real wired display-state id (DisplayStateQuickBar)
  'view.xray': XRay,
  'x-ray': XRay,
  'view.realistic': Realistic,
  'realistic': Realistic,
  'view.visualStyle': VisualStyle,
  'visual-style': VisualStyle,

  // ── camera / home / history / fullscreen / center ──
  'view.camera': Camera,
  'tools.cameraBookmarks': Camera,   // Camera Bookmarks… menu entry
  'camera': Camera,
  'view.home': Home,
  'view.viewcubeHome': Home,
  'viewcube-home': Home,
  'view.previousView': PreviousView,
  'view.prev': PreviousView,
  'previous-view': PreviousView,
  'view.fullscreen': FullScreen,
  'view.fullScreen': FullScreen,
  'full-screen': FullScreen,
  'view.center': Center,             // real "Centre on origin" id (NavSphere/Menus)
  'center': Center,
};

export default viewportNavIcons;
