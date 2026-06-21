// Forge-71 — Heads-Up viewport toolbar.
//
// Floats top-center over the viewport (industry convention — Inventor,
// SolidWorks, CATIA, NX). A compact, grouped view-controls cluster:
// Orient (centre / zoom-fit / iso) · Visual style (shaded / wireframe /
// section) · Gizmo (move / rotate / scale) · Normal-to. Each tool also
// has its own keyboard shortcut.
//
// Pro refinement (viewport-chrome area): the strip is now an engineering-
// grade segmented command bar built on the --fds-* design system — crisp
// 1px hairlines, hairline group dividers, a single restrained accent on
// the active segment, and a subtle blurred backdrop that never competes
// with the model. A companion read-only viewport HUD (selection count /
// coordinate of the active selection / document units) floats at the
// viewport's bottom-left, spatially grounding the scene the way every pro
// MCAD app does — sourced entirely from the published window.__forge*
// hooks + the forge:menu-action bus, so the shell is never touched.

import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './icons/Icon.jsx';
import { Tooltip } from './Tooltip.jsx';

// Grouped, labelled command segments. The flat list is preserved verbatim
// (ids, icons, hints, separators) so every data-hut-id and the active-state
// logic stay byte-identical — the `group` tag only drives presentation.
const HUT_TOOLS = [
  { id: 'view.center',     label: 'Centre on origin', icon: 'view.home',     hint: 'H', group: 'orient' },
  { id: 'view.zoomFit',    label: 'Zoom fit',         icon: 'view.zoom_fit', hint: 'F', group: 'orient' },
  { id: 'view.iso',        label: 'Iso',              icon: 'view.iso',      hint: '1', group: 'orient' },
  { sep: true, id: 's1' },
  { id: 'view.shaded',     label: 'Shaded',           icon: 'view.shaded',    group: 'style' },
  { id: 'view.wireframe',  label: 'Wireframe',        icon: 'view.wireframe', group: 'style' },
  { id: 'view.section',    label: 'Section',          icon: 'view.section',   group: 'style' },
  { sep: true, id: 's2' },
  { id: 'gizmo.translate', label: 'Move (T)',         icon: 'gizmo.translate', hint: 'T', group: 'gizmo' },
  { id: 'gizmo.rotate',    label: 'Rotate (R)',       icon: 'gizmo.rotate',    hint: 'R', group: 'gizmo' },
  { id: 'gizmo.scale',     label: 'Scale (Y)',        icon: 'gizmo.scale',     hint: 'Y', group: 'gizmo' },
  { sep: true, id: 's3' },
  { id: 'view.normalTo',   label: 'Normal to face',   icon: 'view.normalTo', group: 'orient' },
];

// Format a coordinate magnitude with a stable tabular width.
function fmt(n) {
  if (!Number.isFinite(n)) return '0';
  const a = Math.abs(n);
  if (a >= 1000) return n.toFixed(0);
  if (a >= 100) return n.toFixed(1);
  return n.toFixed(2);
}

// Read-only viewport HUD: selection count, the active selection's world
// position, and the document units. Entirely driven by the published
// shell mirrors (window.__forgeSelection / __forgeBodies) — no shell edit,
// no new prop on the shell-owned <HeadsUpToolbar>.
function useViewportReadout() {
  const [state, setState] = useState({ kind: 'none', count: 0, pos: null, units: 'mm' });
  const lastSig = useRef('');

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    let raf = 0;
    let alive = true;

    const sample = () => {
      const sel = window.__forgeSelection || { kind: 'none', ids: [] };
      const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
      const ids = Array.isArray(sel.ids) ? sel.ids : [];
      const count = ids.length;
      const units = (typeof window.__forgeUnits === 'string' && window.__forgeUnits) || 'mm';

      // Centroid of the first selected body (1-based index into bodies,
      // matching the shell's body-id convention), if resolvable.
      let pos = null;
      if (sel.kind === 'body' && count > 0) {
        const b = bodies[ids[0] - 1] || bodies[ids[0]];
        const p = b && (b.position || b.origin || (b.params && b.params.position));
        if (p && Number.isFinite(p.x)) pos = { x: p.x, y: p.y || 0, z: p.z || 0 };
        else if (Array.isArray(p) && p.length >= 3) pos = { x: p[0], y: p[1], z: p[2] };
      }

      const sig = `${sel.kind}|${count}|${units}|${pos ? `${fmt(pos.x)},${fmt(pos.y)},${fmt(pos.z)}` : '-'}`;
      if (sig !== lastSig.current) {
        lastSig.current = sig;
        setState({ kind: sel.kind || 'none', count, pos, units });
      }
      if (alive) raf = requestAnimationFrame(sample);
    };
    raf = requestAnimationFrame(sample);
    return () => { alive = false; try { cancelAnimationFrame(raf); } catch { /* ignore */ } };
  }, []);

  return state;
}

export function HeadsUpToolbar({ activeDisplay = 'shaded', activeGizmo = null, onAction }) {
  const readout = useViewportReadout();
  const hasSel = readout.kind && readout.kind !== 'none' && readout.count > 0;

  return (
    <>
      <div className="forge-hut"
           role="toolbar"
           aria-label="Viewport tools"
           data-testid="forge-hut">
        {HUT_TOOLS.map((t) => t.sep ? (
          <span key={t.id} className="forge-hut-sep" aria-hidden="true" />
        ) : (
          <Tooltip key={t.id} label={t.label} hint={t.hint} placement="bottom">
            <button type="button"
                    className="forge-hut-btn"
                    data-hut-id={t.id}
                    data-hut-group={t.group}
                    data-active={String(t.id === `view.${activeDisplay}` || t.id === `gizmo.${activeGizmo}`)}
                    onClick={() => onAction?.(t.id)}
                    aria-label={t.label}>
              <Icon name={t.icon} size={16} />
            </button>
          </Tooltip>
        ))}
      </div>

      {/* Subtle in-viewport HUD — selection count · coordinate · units.
          Read-only, bottom-left, never obstructs the model centre. */}
      <div className="forge-viewport-hud"
           data-testid="forge-viewport-hud"
           data-has-selection={String(hasSel)}
           role="status"
           aria-label="Viewport readout">
        <span className="forge-viewport-hud-item">
          <span className="forge-viewport-hud-key">SEL</span>
          <span className="forge-viewport-hud-val fds-num">
            {hasSel ? `${readout.kind} · ${readout.count}` : 'none'}
          </span>
        </span>
        {readout.pos ? (
          <>
            <span className="forge-viewport-hud-div" aria-hidden="true" />
            <span className="forge-viewport-hud-item" title="Selection origin (world)">
              <span className="forge-viewport-hud-key">XYZ</span>
              <span className="forge-viewport-hud-val fds-num">
                {fmt(readout.pos.x)} {fmt(readout.pos.y)} {fmt(readout.pos.z)}
              </span>
            </span>
          </>
        ) : null}
        <span className="forge-viewport-hud-div" aria-hidden="true" />
        <span className="forge-viewport-hud-item" title="Document units">
          <span className="forge-viewport-hud-key">UNIT</span>
          <span className="forge-viewport-hud-val fds-num">{readout.units}</span>
        </span>
      </div>
    </>
  );
}
