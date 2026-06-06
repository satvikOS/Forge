// PUSH-61 — Materials Browser panel.
//
// Per-body material assignment browser. Lists every native body in the
// scene as one row, with a dropdown that writes through the shared
// persistence helper (`bodyMaterials.js`). Sits alongside the existing
// `MaterialPicker` (PUSH-17 / Forge-154 — engineering material catalogue
// browser for picking a *new* material to apply) and the
// `MaterialsLibrary` (PUSH-17 raw library) — those panels list the
// material data; this one assigns materials to bodies.
//
// Reachable via:
//   - `forge:menu-action` with id `tools.materials` (the menu-level
//     materials entry, shared with the catalogue picker; this panel
//     uses a unique data-testid so e2e selectors don't collide)
//   - `forge:menu-action` with id `tools.materialsBrowser` (dedicated
//     id so callers that *only* want this panel can reach it cleanly)
//   - `window.__forgeOpenMaterialsBrowser(true|false)` imperative hook
//
// Multi-cam friendly: the panel renders as a dialog overlay (centred,
// dimmable backdrop) so the viewport stays unobstructed and the e2e
// runner can grab 5 named camera angles without the browser ever
// covering the kernel view.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import { DENSITY_G_CC, MATERIAL_LIST } from './MassPropsPanel.jsx';
import {
  getBodyMaterial,
  setBodyMaterial,
  bodyMaterialKey,
  FORGE_BODY_MATERIALS_EVENT,
} from './bodyMaterials.js';

// ─────────────────────────────────────────────────────────────────────
// Scene readout. Pulls the live `window.__forgeBodies` array and filters
// to native bodies (handle is a finite number). The MassPropsPanel uses
// the same filter so the two surfaces always agree on "which bodies
// exist". A synthetic body (no handle) wouldn't have a kernel volume so
// we skip it.

function readNativeBodies() {
  if (typeof window === 'undefined') return [];
  const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return all.filter(
    (b) => b && b.kind === 'native' && typeof b.handle === 'number',
  );
}

// Recompute the kernel mass-props for one body. Same shape the BOM /
// MassProps panels use — we re-call every render so an upstream
// re-extrude that bumped the handle's geometry surfaces immediately.
function massPropsFor(body) {
  if (!body || typeof body.handle !== 'number') return null;
  const fn = (typeof window !== 'undefined') ? window.forge?.massProps : null;
  if (typeof fn !== 'function') return null;
  try {
    const k = fn(body.handle);
    if (!k) return null;
    const volume = Number(k.volume ?? k.Volume ?? 0);
    if (!Number.isFinite(volume) || volume <= 0) return null;
    return { volume };
  } catch {
    return null;
  }
}

// Volume mm³ × density g/cc → mass g. 1 cc = 1000 mm³.
function massGrams(volumeMm3, densityGcc) {
  const v = Number(volumeMm3);
  const d = Number(densityGcc);
  if (!Number.isFinite(v) || !Number.isFinite(d)) return 0;
  return v * d * 1e-3;
}

// ─────────────────────────────────────────────────────────────────────
// Styles. Dialog overlay with a centred 640-wide card. The MassProps /
// BOM panels are right-docked rails; this one floats as a modal so it
// can be summoned over any workbench without competing for rail space.

const BACKDROP_STYLE = {
  position: 'fixed', inset: 0,
  background: 'rgba(8, 11, 16, 0.55)',
  zIndex: 1340,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 24,
};
const DIALOG_STYLE = {
  background: 'var(--forge-canvas-2, #161b22)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 6,
  boxShadow: '0 20px 48px rgba(0,0,0,0.55)',
  color: 'var(--forge-ink, #dadde2)',
  width: 720, maxWidth: '96vw',
  maxHeight: '88vh',
  display: 'flex', flexDirection: 'column',
  overflow: 'hidden',
  fontSize: 12,
};
const HEADER_STYLE = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '10px 14px',
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
  background: 'var(--forge-canvas, #0e1117)',
  flexShrink: 0,
};
const CELL_HEAD = {
  padding: '6px 10px',
  textAlign: 'left',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  background: 'var(--forge-canvas, #0e1117)',
  position: 'sticky', top: 0,
};
const CELL = {
  padding: '6px 10px',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
  textAlign: 'left',
  verticalAlign: 'middle',
};
const CELL_RIGHT = { ...CELL, textAlign: 'right' };

// ─────────────────────────────────────────────────────────────────────

export function MaterialsBrowserPanel({ open, onClose }) {
  // Refresh tick — bumped whenever an external surface emits the
  // shared `forge:material-applied` event, or when the user picks a new
  // material inside this panel. The tick is the cheapest way to force a
  // re-render of the rows (which read through the persistence helper).
  const [tickValue, setTickValue] = useState(0);
  const tick = useCallback(() => setTickValue((t) => t + 1), []);

  // Take a snapshot of native bodies every time the panel opens so a
  // mid-session add/remove from another workbench shows up on next open.
  const [bodies, setBodies] = useState(() => readNativeBodies());
  useEffect(() => {
    if (!open) return undefined;
    setBodies(readNativeBodies());
    const onBodiesChange = () => setBodies(readNativeBodies());
    window.addEventListener('forge:bodies-changed', onBodiesChange);
    return () => window.removeEventListener('forge:bodies-changed', onBodiesChange);
  }, [open]);

  // Subscribe to the shared persistence bus so external writes (BOM,
  // MassProps) propagate live without the user having to re-open.
  useEffect(() => {
    if (!open) return undefined;
    const onApplied = () => tick();
    window.addEventListener(FORGE_BODY_MATERIALS_EVENT, onApplied);
    return () => window.removeEventListener(FORGE_BODY_MATERIALS_EVENT, onApplied);
  }, [open, tick]);

  const rows = useMemo(() => {
    return bodies.map((b) => {
      const material = getBodyMaterial(b);
      const density = DENSITY_G_CC[material] ?? DENSITY_G_CC.steel;
      const mp = massPropsFor(b);
      const volume = mp ? mp.volume : 0;
      const mass = massGrams(volume, density);
      return {
        body: b,
        handle: b.handle,
        key: bodyMaterialKey(b),
        name: b.name || b.toolId || `handle ${b.handle}`,
        material,
        density,
        volume,
        mass,
      };
    });
    // tickValue is a sentinel — re-runs the closure when persistence churns.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bodies, tickValue]);

  const onPick = useCallback((row, value) => {
    if (typeof value !== 'string' || value.length === 0) return;
    setBodyMaterial(row.body, value);
    tick();
  }, [tick]);

  const onBackdrop = useCallback((e) => {
    if (e.target === e.currentTarget) onClose?.();
  }, [onClose]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      role="dialog"
      aria-label="Materials browser"
      data-testid="forge-materials-browser-panel"
      style={BACKDROP_STYLE}
      onClick={onBackdrop}>
      <div style={DIALOG_STYLE} onClick={(e) => e.stopPropagation()}>

        <header style={HEADER_STYLE}>
          <Icon name="misc.search" size={14} />
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            Materials Browser
          </span>
          <span data-testid="forge-materials-browser-count" style={{
            fontFamily: 'var(--forge-mono, monospace)',
            fontSize: 10,
            color: 'var(--forge-ink-mute, #9aa1ab)',
            padding: '1px 6px', borderRadius: 'var(--forge-radius-pill, 10px)',
            border: '1px solid var(--forge-rail-edge, #2a2d34)',
          }}>
            {rows.length}
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => onClose?.()}
            aria-label="Close materials browser"
            data-testid="forge-materials-browser-close"
            style={{
              background: 'transparent', border: 'none',
              color: 'var(--forge-ink-mute, #9aa1ab)', cursor: 'pointer',
              fontSize: 16, lineHeight: 1, padding: 4,
            }}>
            ×
          </button>
        </header>

        <div style={{
          flex: 1, overflowY: 'auto',
          background: 'var(--forge-canvas, #0e1117)',
        }}>
          {rows.length === 0 ? (
            <div
              data-testid="forge-materials-browser-empty"
              style={{
                padding: 24,
                fontStyle: 'italic',
                color: 'var(--forge-ink-mute, #9aa1ab)',
                fontSize: 11,
              }}>
              No native bodies in the scene. Add a body via any modelling
              workbench, then re-open the Materials Browser.
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={CELL_HEAD}>Body</th>
                  <th style={CELL_HEAD}>Material</th>
                  <th style={{ ...CELL_HEAD, textAlign: 'right' }}>
                    Density (g/cc)
                  </th>
                  <th style={{ ...CELL_HEAD, textAlign: 'right' }}>
                    Volume (mm³)
                  </th>
                  <th style={{ ...CELL_HEAD, textAlign: 'right' }}>
                    Mass (g)
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <BrowserRow key={r.key} r={r} onPick={onPick} />
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer style={{
          padding: '8px 14px',
          borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
          background: 'var(--forge-canvas, #0e1117)',
          color: 'var(--forge-ink-mute, #9aa1ab)',
          fontSize: 10,
          lineHeight: 1.4,
          flexShrink: 0,
        }}>
          Assignments persist across sessions and propagate live to the
          Mass Properties + Bill of Materials panels.
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function BrowserRow({ r, onPick }) {
  return (
    <tr
      data-testid="forge-materials-browser-row"
      data-handle={r.handle}
      data-material={r.material}
      style={{
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
      <td style={CELL} data-testid="forge-materials-browser-row-name">
        {r.name}
      </td>
      <td style={CELL}>
        <select
          value={r.material}
          onChange={(e) => onPick(r, e.target.value)}
          data-testid="forge-materials-browser-row-material"
          data-handle={r.handle}
          style={{
            background: 'var(--forge-canvas-2, #161b22)',
            color: 'var(--forge-ink, #dadde2)',
            border: '1px solid var(--forge-rail-edge, #2a2d34)',
            borderRadius: 3,
            padding: '2px 6px',
            fontFamily: 'var(--forge-mono, monospace)',
            fontSize: 11,
          }}>
          {MATERIAL_LIST.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </td>
      <td style={CELL_RIGHT}
          data-testid="forge-materials-browser-row-density">
        {Number(r.density).toFixed(3)}
      </td>
      <td style={CELL_RIGHT}
          data-testid="forge-materials-browser-row-volume">
        {Number(r.volume).toFixed(3)}
      </td>
      <td style={{ ...CELL_RIGHT, fontWeight: 600 }}
          data-testid="forge-materials-browser-row-mass">
        {Number(r.mass).toFixed(3)}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host. Listens for both `tools.materials` and
// `tools.materialsBrowser` menu actions; exposes
// `window.__forgeOpenMaterialsBrowser(true|false)` for callers that
// already know they want this panel specifically (the existing
// MaterialPicker + MaterialsLibrary also react to `tools.materials`,
// which is fine — they all use distinct data-testids).

export function MaterialsBrowserHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenMaterialsBrowser  = (v) => {
      setOpen(typeof v === 'boolean' ? v : true);
    };
    window.__forgeCloseMaterialsBrowser = () => setOpen(false);

    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.materials'
       || id === 'tools.materialsBrowser'
       || id === 'tools.bodyMaterials') {
        setOpen(true);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenMaterialsBrowser; } catch {}
      try { delete window.__forgeCloseMaterialsBrowser; } catch {}
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return (
    <MaterialsBrowserPanel
      open={open}
      onClose={() => setOpen(false)}
    />
  );
}

export default MaterialsBrowserPanel;
