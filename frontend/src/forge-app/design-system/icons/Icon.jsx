/**
 * Forge icon set — original, geometrically-derived SVGs at 16-native (scale
 * via CSS). The style is *technical line art*: 1.5-px stroke weight at 16,
 * rounded caps + joins, a single forge-orange accent line on a handful of
 * structural icons (sketch, extrude, fillet) so action icons read at a
 * glance.
 *
 * No third-party icon library is shipped — this set is hand-rolled for
 * Forge so the visual identity is wholly our IP. Names map to actions, not
 * to a competitor's command vocabulary.
 */

import React from 'react';

const STROKE = 1.5;

/* eslint-disable max-len */
const PATHS = {
  /* ─── navigation + chrome ── */
  search:   <><circle cx="7" cy="7" r="4.5"/><path d="m10.5 10.5 3 3"/></>,
  command:  <path d="M5 3a2 2 0 1 1 0 4h-2v-2h2zm0 6h6m0 0a2 2 0 1 1 0 4h-2v-2h2zm-6 0v2a2 2 0 1 1-2-2h2zm6-6h2a2 2 0 1 1-2 2v-2z"/>,
  menu:     <><path d="M3 4h10"/><path d="M3 8h10"/><path d="M3 12h10"/></>,
  close:    <><path d="M4 4l8 8"/><path d="M12 4l-8 8"/></>,
  plus:     <><path d="M8 3v10"/><path d="M3 8h10"/></>,
  minus:    <path d="M3 8h10"/>,
  check:    <path d="m3 8 3 3 7-7"/>,
  chevronUp:    <path d="m3 10 5-5 5 5"/>,
  chevronDown:  <path d="m3 6 5 5 5-5"/>,
  chevronLeft:  <path d="m10 3-5 5 5 5"/>,
  chevronRight: <path d="m6 3 5 5-5 5"/>,
  expand:   <><path d="M3 3h4M3 3v4M9 3h4v4M13 13H9v0M3 13h4v0M3 13V9M13 13V9"/></>,
  collapse: <><path d="M5 7H3v0M7 5V3M9 5v-2M9 7h2v0M11 9h2M9 11v2M7 11v2M5 9H3v0"/></>,
  drag:     <><circle cx="6" cy="4" r="1"/><circle cx="10" cy="4" r="1"/><circle cx="6" cy="8" r="1"/><circle cx="10" cy="8" r="1"/><circle cx="6" cy="12" r="1"/><circle cx="10" cy="12" r="1"/></>,
  more:     <><circle cx="3" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="13" cy="8" r="1"/></>,
  external: <><path d="M9 3h4v4"/><path d="M13 3 7 9"/><path d="M11 9v3a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h3"/></>,
  link:     <><path d="M7 9.5a2.5 2.5 0 0 0 3.54 0l2-2a2.5 2.5 0 0 0-3.54-3.54L8 5"/><path d="M9 6.5a2.5 2.5 0 0 0-3.54 0l-2 2a2.5 2.5 0 0 0 3.54 3.54L8 11"/></>,

  /* ─── file / project ── */
  fileNew:  <><path d="M3 2h6l4 4v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1z"/><path d="M9 2v4h4"/></>,
  fileOpen: <><path d="M2 5a1 1 0 0 1 1-1h3l1 1h6a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1z"/></>,
  fileSave: <><path d="M3 3h7l3 3v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M5 3v3h5V3M5 14v-4h6v4"/></>,
  fileImport: <><path d="M3 3h6l4 4v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M9 3v4h4"/><path d="M5 11h4m0 0-2-2m2 2-2 2"/></>,
  fileExport: <><path d="M3 3h6l4 4v8a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M9 3v4h4"/><path d="M9 11H5m0 0 2-2m-2 2 2 2"/></>,

  /* ─── undo / redo / clipboard ── */
  undo:  <><path d="M5 6 2 9l3 3"/><path d="M2 9h7a4 4 0 0 1 0 8h-2"/></>,
  redo:  <><path d="m11 6 3 3-3 3"/><path d="M14 9H7a4 4 0 0 0 0 8h2"/></>,
  copy:  <><rect x="5" y="3" width="8" height="10" rx="1"/><path d="M3 5v8a1 1 0 0 0 1 1h7"/></>,
  cut:   <><circle cx="5" cy="11" r="2"/><circle cx="11" cy="11" r="2"/><path d="M6.5 9.5 13 3M9.5 9.5 3 3"/></>,
  paste: <><rect x="3" y="4" width="10" height="10" rx="1"/><rect x="5" y="2" width="6" height="3" rx="0.5"/></>,
  delete: <><path d="M3 4h10"/><path d="M5 4v9a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1V4"/><path d="M6 4V3a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1"/></>,

  /* ─── view / display ── */
  eye:     <><path d="M1.5 8s2.5-5 6.5-5 6.5 5 6.5 5-2.5 5-6.5 5S1.5 8 1.5 8z"/><circle cx="8" cy="8" r="2.5"/></>,
  eyeOff:  <><path d="M3 3l10 10"/><path d="M11 12.5c-1 0.5-2 0.5-3 0.5-4 0-6.5-5-6.5-5s1-1.8 2.7-3.3"/><path d="M6 4.5C7 4.2 7.5 4 8 4c4 0 6.5 5 6.5 5s-0.5 1-1.5 2"/></>,
  isolate: <><circle cx="8" cy="8" r="3"/><circle cx="8" cy="8" r="6" strokeDasharray="2 2"/></>,
  suppress: <><circle cx="8" cy="8" r="6"/><path d="m4 4 8 8"/></>,
  lock:    <><rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5 7V5a3 3 0 0 1 6 0v2"/></>,
  unlock:  <><rect x="3" y="7" width="10" height="7" rx="1"/><path d="M5 7V5a3 3 0 0 1 6 0"/></>,
  pin:     <><path d="M9 2v5l3 3-8 1 5-1V2z"/><path d="M8 11v3"/></>,
  frame:   <><rect x="3" y="3" width="10" height="10" rx="1"/><circle cx="8" cy="8" r="2"/></>,

  /* ─── status ── */
  info:     <><circle cx="8" cy="8" r="6"/><path d="M8 11V7"/><circle cx="8" cy="5" r="0.5" fill="currentColor"/></>,
  warning:  <><path d="M8 2 14 13H2z"/><path d="M8 6v4"/><circle cx="8" cy="11.5" r="0.5" fill="currentColor"/></>,
  error:    <><circle cx="8" cy="8" r="6"/><path d="m5.5 5.5 5 5"/><path d="m10.5 5.5-5 5"/></>,
  success:  <><circle cx="8" cy="8" r="6"/><path d="m5 8 2.5 2.5L11 6"/></>,

  /* ─── settings / theme / help ── */
  settings: <><path d="M8 2v2M8 12v2M14 8h-2M4 8H2M11.7 4.3l-1.4 1.4M5.7 10.3l-1.4 1.4M11.7 11.7l-1.4-1.4M5.7 5.7 4.3 4.3"/><circle cx="8" cy="8" r="2.5"/></>,
  sun:      <><circle cx="8" cy="8" r="3"/><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.7 3.3l-1.4 1.4M4.7 11.3l-1.4 1.4M12.7 12.7l-1.4-1.4M4.7 4.7 3.3 3.3"/></>,
  moon:     <path d="M13 9.5A6 6 0 1 1 6.5 3a5 5 0 0 0 6.5 6.5z"/>,
  monitor:  <><rect x="2" y="3" width="12" height="9" rx="1"/><path d="M5 14h6M8 12v2"/></>,
  help:     <><circle cx="8" cy="8" r="6"/><path d="M6.5 6.5a1.5 1.5 0 1 1 2.5 1.2c-.5.3-1 .8-1 1.3"/><circle cx="8" cy="11.5" r="0.5" fill="currentColor"/></>,
  user:     <><circle cx="8" cy="6" r="2.5"/><path d="M3 13c1-2.5 3-4 5-4s4 1.5 5 4"/></>,
  send:     <><path d="m2 8 12-6-4 12-2.5-4.5z"/><path d="M7.5 9.5 11 6"/></>,
  attach:   <path d="M11 6.5 6.5 11a2.5 2.5 0 1 1-3.5-3.5L8 3a1.5 1.5 0 1 1 2.1 2.1L5 10.2"/>,

  /* ─── workbench tabs ── */
  sketchTab:      <><rect x="2.5" y="2.5" width="11" height="11" rx="1"/><path d="M5 11 11 5" stroke="var(--accent-bg)"/></>,
  partTab:        <><path d="M2.5 5 8 2.5 13.5 5v6L8 13.5 2.5 11z"/><path d="M2.5 5 8 8m0 0 5.5-3M8 8v5.5"/></>,
  surfacesTab:    <><path d="M2 11c2-4 6-4 6-8M14 5c-2 4-6 4-6 8"/></>,
  sheetMetalTab:  <><path d="M2 5h8v3l4 3H6V8z"/></>,
  weldmentsTab:   <><path d="M2 8h12"/><path d="M3 5h10v6H3z"/><circle cx="8" cy="8" r="1.2" fill="currentColor"/></>,
  assemblyTab:    <><rect x="2.5" y="2.5" width="5" height="5" rx="0.5"/><rect x="8.5" y="8.5" width="5" height="5" rx="0.5"/><path d="M7.5 7.5 8.5 8.5" stroke="var(--accent-bg)"/></>,
  drawingTab:     <><rect x="2.5" y="3" width="11" height="10" rx="0.5"/><path d="M5 6h6M5 9h4M5 12h3"/></>,
  simulateTab:    <><path d="M2 11c2 0 2-6 4-6s2 6 4 6 2-6 4-6"/></>,
  manufactureTab: <><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.3 3.3l1.4 1.4M11.3 11.3l1.4 1.4M3.3 12.7l1.4-1.4M11.3 4.7l1.4-1.4"/></>,

  /* ─── geometry primitives ── */
  box:      <><path d="M2 5 8 2l6 3v6l-6 3-6-3z"/><path d="M2 5l6 3 6-3M8 8v6"/></>,
  cylinder: <><ellipse cx="8" cy="4" rx="5" ry="1.5"/><path d="M3 4v8c0 .8 2.2 1.5 5 1.5s5-.7 5-1.5V4"/></>,
  sphere:   <><circle cx="8" cy="8" r="6"/><ellipse cx="8" cy="8" rx="6" ry="2.5"/></>,
  cone:     <><path d="M8 2 14 13H2z"/><ellipse cx="8" cy="13" rx="6" ry="1.2"/></>,
  torus:    <><ellipse cx="8" cy="8" rx="6" ry="3"/><ellipse cx="8" cy="8" rx="2" ry="1"/></>,

  /* ─── operations ── */
  extrude:    <><rect x="3" y="6" width="8" height="6" rx="0.5"/><path d="M3 6 5 4h8l-2 2M11 6v6l2-2V4" stroke="var(--accent-bg)"/></>,
  revolve:    <><path d="M8 2v12"/><path d="M5 4c0 4-3 4-3 4s3 0 3 4M11 4c0-2 3-2 3 0v8c0 2-3 2-3 0z"/></>,
  sweep:      <><path d="M3 11c2-6 6-6 6-2s4 0 4-4"/><circle cx="3" cy="11" r="1.2" fill="currentColor"/></>,
  loft:       <><ellipse cx="4" cy="8" rx="1.5" ry="3.5"/><ellipse cx="12" cy="8" rx="1.5" ry="3.5"/><path d="M4 4.5h8M4 11.5h8"/></>,
  shell:      <><path d="M2 5 8 2l6 3v6l-6 3-6-3z"/><path d="M4 6 8 4l4 2v5l-4 2-4-2z"/></>,
  fillet:     <><path d="M3 13V5a2 2 0 0 1 2-2h8" stroke="var(--accent-bg)"/><path d="M3 13h10"/></>,
  chamfer:    <><path d="M3 13V6l3-3h7" stroke="var(--accent-bg)"/><path d="M3 13h10"/></>,
  hole:       <><rect x="2.5" y="2.5" width="11" height="11" rx="0.5"/><circle cx="8" cy="8" r="2.5" stroke="var(--accent-bg)"/></>,
  draft:      <><path d="M4 13V5l8 8z"/></>,
  rib:        <><path d="M3 12V4M13 12V4M3 12h10"/><path d="M5 12V8h6v4" stroke="var(--accent-bg)"/></>,

  /* ─── booleans ── */
  combine:    <><circle cx="6" cy="8" r="4"/><circle cx="10" cy="8" r="4"/></>,
  subtract:   <><circle cx="6" cy="8" r="4"/><circle cx="10" cy="8" r="4" fill="var(--surface-app)" stroke="currentColor"/></>,
  intersect:  <><path d="M2 8a4 4 0 0 1 8 0 4 4 0 0 1-4 4 4 4 0 0 1-4-4z" fill="currentColor" opacity="0.3"/><circle cx="6" cy="8" r="4"/><circle cx="10" cy="8" r="4"/></>,

  /* ─── pattern + mate ── */
  patternLinear:   <><rect x="2" y="6" width="3" height="4"/><rect x="6.5" y="6" width="3" height="4"/><rect x="11" y="6" width="3" height="4"/></>,
  patternCircular: <><circle cx="8" cy="8" r="5" strokeDasharray="2 3"/><rect x="6.5" y="2" width="3" height="2.5"/><rect x="6.5" y="11.5" width="3" height="2.5"/><rect x="2" y="6.5" width="2.5" height="3"/><rect x="11.5" y="6.5" width="2.5" height="3"/></>,
  mirror:          <><rect x="2" y="5" width="4" height="6"/><rect x="10" y="5" width="4" height="6"/><path d="M8 2v12" strokeDasharray="2 1"/></>,
  mate:            <><circle cx="5" cy="8" r="3"/><circle cx="11" cy="8" r="3"/></>,
  insertComponent: <><rect x="2.5" y="2.5" width="11" height="11" rx="0.5"/><path d="M8 5v6M5 8h6" stroke="var(--accent-bg)"/></>,
  exploded:        <><rect x="2" y="2" width="4" height="4"/><rect x="10" y="2" width="4" height="4"/><rect x="2" y="10" width="4" height="4"/><rect x="10" y="10" width="4" height="4"/></>,

  /* ─── motion / archie ── */
  archie:    <><circle cx="8" cy="8" r="6" stroke="var(--accent-bg)" strokeWidth="1.6"/><path d="M5 9c.7 1 1.7 1.5 3 1.5s2.3-.5 3-1.5"/><circle cx="6" cy="6.5" r="0.5" fill="currentColor"/><circle cx="10" cy="6.5" r="0.5" fill="currentColor"/></>,
  play:      <path d="M4 3v10l9-5z"/>,
  pause:     <><rect x="4" y="3" width="3" height="10"/><rect x="9" y="3" width="3" height="10"/></>,
  stop:      <rect x="3" y="3" width="10" height="10" rx="0.5"/>,
  fastForward: <><path d="M2 3v10l5-5z"/><path d="M8 3v10l5-5z"/></>,
};
/* eslint-enable max-len */

export function Icon({ name, size = 16, label = null, decorative = true, className = '', style = {}, strokeWidth = STROKE, ...rest }) {
  const path = PATHS[name];
  if (!path) {
    if (typeof console !== 'undefined') console.warn('[forge.Icon] unknown icon:', name);
    return null;
  }
  const ariaProps = decorative
    ? { 'aria-hidden': true, focusable: false }
    : { role: 'img', 'aria-label': label || name };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`forge-icon ${className}`}
      style={style}
      {...ariaProps}
      {...rest}
    >
      {path}
    </svg>
  );
}

/** List of every icon name shipped. Useful for the design showcase + tests. */
export const ICON_NAMES = Object.freeze(Object.keys(PATHS));
