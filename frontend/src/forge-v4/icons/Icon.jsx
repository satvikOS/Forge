// Forge-65 — custom icon library.
//
// Every icon is a 16×16 SVG drawn on a 1 px grid with 1.5 px stroke,
// rounded line-caps and joins. The set is hand-built — no Lucide, no
// Heroicons, no Material — so the visual language belongs to Forge.
//
// Naming convention: <category>.<verb> or <category>.<noun>.
//   wb.*       workbench rail
//   menu.*     top-bar menu items
//   file.*     File menu actions
//   sketch.*   2D sketcher primitives
//   solid.*    3D solid operations (extrude, revolve, sweep, loft…)
//   pattern.*  patterns (linear, circular, mirror)
//   bool.*     booleans (union, cut, common)
//   select.*   selection filters (vertex, edge, face, body)
//   view.*     view operations (named views, display states)
//   io.*       import / export
//   archie.*   AI bits (spark, command palette)
//
// Usage:
//   import { Icon } from 'forge-v4/icons/Icon.jsx';
//   <Icon name="solid.extrude" size={20} />
//
// The Icon component accepts `accent` to override stroke color (defaults
// to currentColor so it inherits its parent text colour — works in
// hover / active / disabled states automatically).

import React from 'react';

const PATHS = {
  // ──────────────── workbench rail glyphs ────────────────
  'wb.mech': (
    // cube + small gear-tooth — Mechanical CAD
    <>
      <path d="M3 5l5-3 5 3v6l-5 3-5-3z" />
      <path d="M3 5l5 3 5-3M8 8v6" />
    </>
  ),
  'wb.drawing': (
    // sheet with corner fold + 2 ruled lines — Drawing
    <>
      <path d="M3 2h7l3 3v9H3z" />
      <path d="M10 2v3h3" />
      <path d="M5 8h6M5 11h4" />
    </>
  ),
  'wb.weldments': (
    // two intersecting beams with a weld bead — Weldments
    <>
      <path d="M2 4h12M2 12h12" />
      <path d="M5 4v8M11 4v8" />
      <circle cx="8" cy="8" r="1.4" />
    </>
  ),
  'wb.sheet': (
    // flat sheet with a bend — Sheet Metal
    <>
      <path d="M2 6h7l3 3v5H2z" />
      <path d="M9 6v3h3" />
    </>
  ),
  'wb.mold': (
    // 2 halves of a mold with a part inside — Mold Tools
    <>
      <path d="M2 4v8h4V4M14 4v8h-4V4" />
      <circle cx="8" cy="8" r="1.7" />
    </>
  ),
  'wb.sim': (
    // wave + arrow — Simulation
    <>
      <path d="M2 8c2 -3 4 3 6 0c2 -3 4 3 6 0" />
      <path d="M11 13l3 -3" />
    </>
  ),
  'wb.mfg': (
    // milling cutter — Manufacturing
    <>
      <path d="M5 2v6h6V2" />
      <path d="M5 8l-2 6h10l-2 -6" />
    </>
  ),
  'wb.robot': (
    // articulated robot arm — base + shoulder + elbow + gripper
    <>
      <path d="M3 14h4v-2H3z" />
      <path d="M5 12V8l4 -3l3 4l-2 2v3" />
      <circle cx="5" cy="8" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="9" cy="5" r="0.7" fill="currentColor" stroke="none" />
      <circle cx="12" cy="9" r="0.7" fill="currentColor" stroke="none" />
      <path d="M9 13h3v1h1v-1" />
    </>
  ),
  'wb.arch': (
    // pitched-roof house + door silhouette — Architecture / BIM
    <>
      <path d="M2 8l6 -5l6 5v6H2z" />
      <path d="M7 14v-4h2v4" />
      <path d="M2 8l6 -5l6 5" />
    </>
  ),

  // ──────────────── menus ────────────────
  'menu.file':    (<><path d="M3 2h7l3 3v9H3z" /><path d="M10 2v3h3" /></>),
  'menu.edit':    (<><path d="M3 12l8-8 2 2-8 8H3z" /><path d="M9 4l2 2" /></>),
  'menu.view':    (<><circle cx="8" cy="8" r="2" /><path d="M2 8c2 -4 8 -4 12 0c -2 4 -10 4 -12 0Z" /></>),
  'menu.tools':   (<><path d="M5 11l-3 3 1 1 3 -3" /><path d="M6 10l4 -4 c1 -1 3 -1 4 0 c1 1 1 3 0 4 l-4 4z" /></>),
  'menu.help':    (<><circle cx="8" cy="8" r="6" /><path d="M6 6c0 -2 4 -2 4 0c0 1 -2 2 -2 3" /><circle cx="8" cy="11" r="0.6" fill="currentColor" stroke="none" /></>),

  // ──────────────── file actions ────────────────
  'file.new':     (<><path d="M3 2h7l3 3v9H3z" /><path d="M8 7v6M5 10h6" /></>),
  'file.open':    (<><path d="M2 4h4l2 2h6v7H2z" /></>),
  'file.save':    (<><path d="M3 2h8l2 2v10H3z" /><path d="M5 2v4h6V2M5 9h6v5H5" /></>),
  'file.import':  (<><path d="M2 14h12" /><path d="M8 2v9M5 8l3 3 3 -3" /></>),
  'file.export':  (<><path d="M2 14h12" /><path d="M8 11V2M5 5l3 -3 3 3" /></>),

  // ──────────────── edit actions ────────────────
  'edit.undo':    (<><path d="M3 6h7c2 0 4 2 4 4M3 6l3 -3M3 6l3 3" /></>),
  'edit.redo':    (<><path d="M13 6H6c-2 0-4 2-4 4M13 6l-3 -3M13 6l-3 3" /></>),
  'edit.copy':    (<><path d="M5 5h8v8H5z" /><path d="M3 3h8v2M3 3v8h2" /></>),
  'edit.paste':   (<><path d="M3 4h2v9h8V4h2M5 4V2h6v2" /></>),
  'edit.delete':  (<><path d="M3 4h10M6 4V2h4v2M5 4l1 9h4l1 -9" /></>),

  // ──────────────── selection filters ────────────────
  'select.vertex': (<><circle cx="8" cy="8" r="2.2" /></>),
  'select.edge':   (<><path d="M3 12L13 4" /><circle cx="3" cy="12" r="1.2" /><circle cx="13" cy="4" r="1.2" /></>),
  'select.face':   (<><path d="M3 4h10v8H3z" /></>),
  'select.body':   (<><path d="M3 5l5-3 5 3v6l-5 3-5-3z" /></>),
  'select.clear':  (<><circle cx="8" cy="8" r="5" /><path d="M5 5l6 6M11 5l-6 6" /></>),

  // ──────────────── sketch primitives ────────────────
  'sketch.point':   (<><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" /><circle cx="8" cy="8" r="3.5" /></>),
  'sketch.line':    (<><path d="M3 13L13 3" /></>),
  'sketch.rect':    (<><path d="M3 4h10v8H3z" /></>),
  'sketch.circle':  (<><circle cx="8" cy="8" r="5" /></>),
  'sketch.arc':     (<><path d="M3 11A6 6 0 0 1 13 11" /></>),
  'sketch.spline':  (<><path d="M3 12c2 -8 8 8 10 0" /></>),
  'sketch.polygon': (<><path d="M8 2l5 4-2 6H5L3 6z" /></>),
  'sketch.slot':    (<><path d="M5 5h6a3 3 0 0 1 0 6H5a3 3 0 0 1 0 -6Z" /></>),
  'sketch.fillet':  (<><path d="M3 13V6a3 3 0 0 1 3 -3h7" /></>),
  'sketch.chamfer': (<><path d="M3 13V6l3 -3h7" /></>),
  'sketch.trim':    (<><path d="M3 8h10" /><path d="M6 5l-2 3 2 3M10 5l2 3 -2 3" /></>),
  'sketch.offset':  (<><path d="M5 4h6v8H5z" /><path d="M3 3h10v10H3z" strokeDasharray="2 1.5" /></>),
  'sketch.mirror':  (<><path d="M8 2v12" strokeDasharray="2 1.5" /><path d="M6 5L3 8l3 3M10 5l3 3 -3 3" /></>),

  'sketch.dim':     (<><path d="M3 5v6M13 5v6M3 8h10" /><path d="M5 6l-2 2 2 2M11 6l2 2 -2 2" /></>),
  'sketch.constrain': (<><path d="M8 3v10" /><circle cx="8" cy="3" r="1.2" /><circle cx="8" cy="13" r="1.2" /></>),
  'sketch.finish':  (<><circle cx="8" cy="8" r="5.5" /><path d="M5.5 8l2 2 3 -3.5" /></>),

  // ──────────────── 3D solids ────────────────
  'solid.extrude':  (<><path d="M3 9h7v4H3z" /><path d="M3 9V5l3 -3h7v4H10" /></>),
  'solid.revolve':  (<><circle cx="8" cy="8" r="5" /><path d="M8 3v10" strokeDasharray="2 1.5" /></>),
  'solid.sweep':    (<><path d="M3 11c4 -8 6 8 10 0" /><circle cx="3" cy="11" r="1.5" /></>),
  'solid.loft':     (<><path d="M3 5h5v6H3z" /><path d="M10 4h3v8h-3z" /><path d="M8 5l2 -1M8 11l2 1" /></>),
  'solid.shell':    (<><path d="M3 4h10v8H3z" /><path d="M5 6h6v4H5z" /></>),
  'solid.thicken':  (<><path d="M3 7l5 -3 5 3" /><path d="M3 9l5 -3 5 3" /></>),
  'solid.knit':     (<><path d="M3 5h10M3 11h10" /><path d="M5 5l3 6 3 -6" strokeDasharray="1.5 1.5" /></>),
  'solid.boundary': (<><path d="M3 3v10h10" /><path d="M3 3c2 4 8 4 10 10" /></>),

  // ──────────────── solid mods ────────────────
  'solid.fillet':   (<><path d="M3 13v-7a3 3 0 0 1 3 -3h7" /></>),
  'solid.chamfer':  (<><path d="M3 13v-7l3 -3h7" /></>),
  'solid.draft':    (<><path d="M3 13V5l4 -2 v 10z" /><path d="M9 13V5l4 -2v10z" /></>),
  'solid.hole':     (<><path d="M3 4h10v8H3z" /><circle cx="8" cy="8" r="2" /></>),
  'solid.thread':   (<><path d="M5 3v10M11 3v10" /><path d="M5 5h6M5 8h6M5 11h6" /></>),
  'solid.rib':      (<><path d="M3 13h10" /><path d="M7 13V6l4 -3" /></>),
  'solid.face_push': (<><path d="M3 5h5v6H3z" /><path d="M10 8h3M12 6l1 2 -1 2" /></>),

  // ──────────────── patterns ────────────────
  'pattern.linear':   (<><path d="M3 5h2v2H3zM7 5h2v2H7zM11 5h2v2h-2zM3 9h2v2H3zM7 9h2v2H7zM11 9h2v2h-2z" /></>),
  'pattern.circular': (<><circle cx="8" cy="8" r="5" /><circle cx="8" cy="3" r="1" /><circle cx="13" cy="8" r="1" /><circle cx="8" cy="13" r="1" /><circle cx="3" cy="8" r="1" /></>),
  'pattern.mirror':   (<><path d="M8 2v12" strokeDasharray="2 1.5" /><path d="M5 5h2v6H5zM9 5h2v6H9z" /></>),
  'pattern.curve':    (<><path d="M2 12c4 -8 8 8 12 0" /><circle cx="3" cy="10" r="0.8" /><circle cx="8" cy="6" r="0.8" /><circle cx="13" cy="10" r="0.8" /></>),

  // ──────────────── booleans ────────────────
  'bool.union':     (<><circle cx="6" cy="8" r="4" /><circle cx="10" cy="8" r="4" /></>),
  'bool.cut':       (<><circle cx="6" cy="8" r="4" /><circle cx="10" cy="8" r="4" strokeDasharray="2 1.5" /></>),
  'bool.common':    (<><circle cx="6" cy="8" r="4" strokeDasharray="2 1.5" /><circle cx="10" cy="8" r="4" strokeDasharray="2 1.5" /><path d="M7.6 5.2c1.2 .6 2 1.6 2 2.8s-.8 2.2-2 2.8" /></>),
  'bool.split':     (<><circle cx="8" cy="8" r="4" /><path d="M2 8h12" /></>),

  // ──────────────── views ────────────────
  'view.iso':       (<><path d="M8 2l5 3v6l-5 3-5-3V5z" /><path d="M3 5l5 3 5-3M8 8v6" /></>),
  'view.front':     (<><path d="M3 4h10v8H3z" /></>),
  'view.top':       (<><path d="M3 6l5 -3 5 3 -5 3z" /></>),
  'view.right':     (<><path d="M3 4l3 -2v10l-3 -2zM6 2h7v12H6z" /></>),
  'view.shaded':    (<><circle cx="8" cy="8" r="5" /><path d="M8 3a5 5 0 0 0 0 10" fill="currentColor" stroke="none" /></>),
  'view.wireframe': (<><circle cx="8" cy="8" r="5" /><path d="M3 8h10M8 3v10" /></>),
  'view.section':   (<><path d="M3 8h10" strokeDasharray="2 1.5" /><path d="M3 8L7 4h6v8H3z" /></>),
  'view.zoom_fit':  (<><path d="M5 2H2v3M11 2h3v3M5 14H2v-3M11 14h3v-3" /><circle cx="8" cy="8" r="2.5" /></>),

  // ──────────────── measure + inspect ────────────────
  'measure.distance': (<><path d="M3 5v6M13 5v6M3 8h10" /></>),
  'measure.angle':    (<><path d="M3 13L13 13L3 3" /><path d="M7 13a4 4 0 0 1 0 -3" /></>),
  'measure.area':     (<><path d="M3 4h10v8H3z" /><path d="M3 4l10 8M13 4L3 12" /></>),
  'measure.mass':     (<><path d="M5 3h6l1 4H4z" /><path d="M3 7h10v6H3z" /></>),
  'measure.interfere':(<><path d="M5 5h6v6H5z" /><path d="M3 3h6v6H3z" strokeDasharray="2 1.5" /></>),

  // ──────────────── i/o ────────────────
  'io.step':        (<><circle cx="8" cy="8" r="5" /><path d="M6 9c0 1.5 1 1.5 2 1.5s2 -1 2 -2c0 -2 -4 -1 -4 -3c0 -1 1 -1.5 2 -1.5s2 .5 2 1.5" fill="none" /></>),
  'io.iges':        (<><circle cx="8" cy="8" r="5" /><path d="M7 5v6M9 5v6" /></>),
  'io.stl':         (<><circle cx="8" cy="8" r="5" /><path d="M5 8l3 -3 3 3 -3 3z" /></>),
  'io.brep':        (<><path d="M3 8l5 -5 5 5 -5 5z" /></>),
  'io.pdf':         (<><path d="M3 2h7l3 3v9H3z" /><path d="M5 9h2c.7 0 1 .5 1 1s-.3 1 -1 1H5" /></>),

  // ──────────────── archie ────────────────
  'archie.spark':   (<><path d="M8 2v4M6 4h4M7 2.6l2 2.8M9 2.6l-2 2.8" /><path d="M5 9l3 5 3 -5" /></>),
  'archie.send':    (<><path d="M2 8l11 -5 -5 11 -2 -4z" /></>),
  'archie.cancel':  (<><circle cx="8" cy="8" r="6" /><path d="M5 5l6 6" /></>),
  'archie.history': (<><circle cx="8" cy="8" r="6" /><path d="M8 4v4l3 2" /></>),
  'archie.thread':  (<><path d="M2 5h12v6H7l-3 3v-3H2z" /></>),

  // ──────────────── chrome misc ────────────────
  'misc.settings':  (<><circle cx="8" cy="8" r="2" /><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.5 3.5l1.4 1.4M11 11l1.5 1.5M3.5 12.5l1.4 -1.4M11 5l1.5 -1.5" /></>),
  'misc.search':    (<><circle cx="7" cy="7" r="4" /><path d="M10 10l4 4" /></>),
  'misc.kbd':       (<><path d="M2 4h12v8H2z" /><path d="M4 7h1M7 7h1M10 7h1M5 10h6" /></>),
  'misc.collapse_r':(<><path d="M3 4h10v8H3z" /><path d="M10 4v8M7 6l-2 2 2 2" /></>),
  'misc.expand_r':  (<><path d="M3 4h10v8H3z" /><path d="M10 4v8M5 6l2 2 -2 2" /></>),
  'misc.pin':       (<><path d="M8 2v8M5 5l3 -3 3 3M5 11h6" /></>),
  'misc.lock':      (<><path d="M4 7h8v6H4z" /><path d="M6 7V5a2 2 0 0 1 4 0v2" /></>),
  'misc.unlock':    (<><path d="M4 7h8v6H4z" /><path d="M6 7V5a2 2 0 0 1 4 0" /></>),
  'misc.eye':       (<><path d="M2 8c2 -3 4 -4 6 -4s4 1 6 4c-2 3 -4 4 -6 4s-4 -1 -6 -4Z" /><circle cx="8" cy="8" r="1.6" /></>),
  'misc.eye_off':   (<><path d="M2 8c1 -1.5 2 -2.5 3.5 -3M14 8c-2 3 -4 4 -6 4M3 3l10 10" /></>),
  'misc.theme':     (<><circle cx="8" cy="8" r="5" /><path d="M8 3a5 5 0 0 0 0 10" fill="currentColor" stroke="none" /></>),

  // ──────────────── gizmo (3D viewport tools — dedicated to avoid icon collisions) ────────────────
  'gizmo.translate':(<><path d="M8 2v12M2 8h12M5 5l-3 3 3 3M11 5l3 3 -3 3M5 11l3 3 3 -3M5 5l3 -3 3 3" /></>),
  'gizmo.rotate':   (<><path d="M3 8a5 5 0 0 1 10 0 5 5 0 0 1 -10 0z" /><path d="M11 3l2 3 -3 1" /></>),
  'gizmo.scale':    (<><path d="M3 13L13 3" /><path d="M3 9V13h4M13 7V3h-4" /></>),
  'gizmo.transform':(<><rect x="4" y="4" width="8" height="8" /><circle cx="4" cy="4" r="1" /><circle cx="12" cy="4" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="12" cy="12" r="1" /></>),

  // ──────────────── view (additional — home / back / top / right / normal-to dedicated) ────────────────
  'view.home':      (<><path d="M2 8l6 -5 6 5" /><path d="M4 8v5h8V8" /></>),
  'view.back':      (<><path d="M3 5l5 -3 5 3v6l-5 3 -5 -3V5z" opacity="0.4" /><path d="M3 5l5 3 5 -3M8 8v6" /></>),
  'view.top':       (<><path d="M2 8l6 -4 6 4 -6 4 -6 -4z" /><path d="M8 4v8" opacity="0.4" /></>),
  'view.bottom':    (<><path d="M2 8l6 -4 6 4 -6 4 -6 -4z" opacity="0.4" /><path d="M8 8v4M2 8l6 4 6 -4" /></>),
  'view.right':     (<><path d="M3 3l5 3v8l-5 -3z" /><path d="M8 6l5 -3v8l-5 3" opacity="0.4" /></>),
  'view.left':      (<><path d="M8 6l5 -3v8l-5 3" /><path d="M3 3l5 3v8l-5 -3z" opacity="0.4" /></>),
  'view.normalTo':  (<><path d="M2 12l5 -8 5 5 2 -2" /><circle cx="7" cy="4" r="1.3" /></>),

  // ──────────────── formula / cost / weld-bead / spring — dedicated glyphs ────────────────
  'archie.formula': (<><path d="M11 3h-3a2 2 0 0 0 -2 2v6a2 2 0 0 1 -2 2" /><path d="M3 8h6" /></>),
  'measure.cost':   (<><path d="M11 4H7a2 2 0 0 0 0 4h2a2 2 0 0 1 0 4H5" /><path d="M8 2v2M8 12v2" /></>),
  'weld.bead':      (<><path d="M2 8q1.5 -2 3 0 t3 0 t3 0 t3 0" /><path d="M2 11h12" opacity="0.4" /></>),
  'pattern.spring': (<><path d="M3 12c0 -3 2 -3 2 -6 0 -3 2 -3 2 0 0 3 2 3 2 6 0 3 2 3 2 0" /></>),
};

export const ICON_NAMES = Object.keys(PATHS);

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.5,
  accent = null,         // override stroke for a single icon if needed
  decorative = true,     // default = aria-hidden; set false for screen readers
  label,
  ...rest
}) {
  const d = PATHS[name];
  if (!d) {
    // Defensive: missing icons render an outlined square so the layout
    // doesn't collapse but the gap is visible.
    return (
      <svg width={size} height={size} viewBox="0 0 16 16"
           fill="none" stroke="currentColor" strokeWidth={strokeWidth}
           {...rest}>
        <path d="M2 2h12v12H2z" />
      </svg>
    );
  }
  return (
    <svg
      width={size} height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke={accent || 'currentColor'}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={decorative ? 'presentation' : 'img'}
      aria-hidden={decorative ? 'true' : undefined}
      aria-label={!decorative ? (label || name) : undefined}
      {...rest}
    >
      {d}
    </svg>
  );
}
