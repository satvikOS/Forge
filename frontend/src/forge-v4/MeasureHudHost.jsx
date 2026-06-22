// Task #21 (Enterprise CAD UI/UX) — measure-on-selection HUD
// (CATIA "Measure Between" / NX quick-measure).
//
// Self-mounting portal host for measureOnSelection.js. On mount it
// installs the imperative window API and subscribes to the canonical
// `forge:selection-changed` bus (the same bus the SelectionFilterStrip,
// EntityProps, and MeasureToolPanel listen on). When 1–2 entities are
// picked it reads window.__forgeSelection + window.__forgeBodies and
// renders a monochrome corner readout — instant distance / angle /
// length without opening the modal MeasureToolPanel.
//
// no-setState contract: the window API `window.__forgeMeasureReadout()`
// is a PURE read (computes from the live stores, returns the readout
// object) and `window.__forgeOpenMeasureHud(bool)` toggles visibility —
// the recompute is driven by the bus subscription, not by the API
// poking React state for the data.
//
// MONOCHROME ONLY — --forge-* grey tokens, bottom-right, no chromatic.

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { measureOnSelection } from './measureOnSelection.js';

const METRIC_LABEL = {
  distance: 'Distance', angle: 'Angle', length: 'Length',
  radius: 'Radius', point: 'Point', count: 'Selection',
};

const hudStyle = {
  position: 'fixed',
  right: 'calc(var(--forge-right-w, 340px) + 16px)',
  bottom: 'calc(var(--forge-cmdbar-h, 52px) + var(--forge-statusbar-h, 26px) + 16px)',
  zIndex: 1325,
  display: 'inline-flex',
  flexDirection: 'column',
  gap: 2,
  padding: '6px 12px',
  background: 'var(--forge-canvas-2, #0a0b0e)',
  border: '1px solid var(--forge-rail-edge, rgba(255,255,255,0.12))',
  borderRadius: 'var(--forge-radius, 4px)',
  color: 'var(--forge-ink, #ebecef)',
  fontFamily: 'var(--forge-mono, ui-monospace, Menlo, monospace)',
  fontSize: 12,
  letterSpacing: '0.02em',
  userSelect: 'none',
  pointerEvents: 'none',
  boxShadow: '0 8px 20px rgba(0,0,0,0.5)',
  whiteSpace: 'nowrap',
  minWidth: 168,
};

const keyStyle = {
  fontSize: 9,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'var(--forge-ink-mute, #757a85)',
  fontFamily: 'var(--forge-font, system-ui, sans-serif)',
};

const valStyle = {
  fontSize: 14,
  fontVariantNumeric: 'tabular-nums lining-nums',
  color: 'var(--forge-ink, #ebecef)',
};

const detailStyle = {
  fontSize: 10,
  color: 'var(--forge-ink-2, #b0b4bd)',
  fontFamily: 'var(--forge-font, system-ui, sans-serif)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  maxWidth: 240,
};

function compute() {
  if (typeof window === 'undefined') return null;
  try {
    return measureOnSelection(window.__forgeSelection, window.__forgeBodies);
  } catch { return null; }
}

export function MeasureHudHost() {
  const [open, setOpen] = useState(true);
  const [readout, setReadout] = useState(() => compute());

  const refresh = useCallback(() => { setReadout(compute()); }, []);

  // Subscribe to the canonical selection bus — this drives the recompute.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.addEventListener('forge:selection-changed', refresh);
    window.addEventListener('forge:filter-changed', refresh);
    refresh();
    return () => {
      window.removeEventListener('forge:selection-changed', refresh);
      window.removeEventListener('forge:filter-changed', refresh);
    };
  }, [refresh]);

  // Imperative window API. The data read is PURE (no setState); the
  // visibility toggle is a UI concern local to this host.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeMeasureReadout = () => compute();
    window.__forgeOpenMeasureHud = (v) =>
      setOpen(typeof v === 'boolean' ? v : (o) => !o);
    return () => {
      try { delete window.__forgeMeasureReadout; } catch { /* ignore */ }
      try { delete window.__forgeOpenMeasureHud; } catch { /* ignore */ }
    };
  }, []);

  if (typeof document === 'undefined') return null;

  // Only show the HUD for an actual measurable readout (a metric that
  // carries a value, or a 1–2 pick count). 3+ picks still show count.
  const visible = open && readout != null;

  return createPortal(
    visible ? (
      <div style={hudStyle}
           data-testid="forge-measure-hud"
           data-metric={readout.metric}
           role="status"
           aria-live="polite">
        <span style={keyStyle}>{METRIC_LABEL[readout.metric] || 'Measure'}</span>
        <span style={valStyle}
              data-testid="forge-measure-hud-value"
              data-metric={readout.metric}
              data-value={readout.value == null ? '' : String(readout.value)}>
          {readout.label}
        </span>
        {readout.detail ? (
          <span style={detailStyle} data-testid="forge-measure-hud-detail">
            {readout.detail}
          </span>
        ) : null}
      </div>
    ) : (
      // Always render a stable empty anchor so e2e can assert the empty
      // path deterministically without a race on mount.
      <div style={{ position: 'fixed', width: 0, height: 0, overflow: 'hidden' }}
           data-testid="forge-measure-hud-empty"
           aria-hidden="true" />
    ),
    document.body,
  );
}

export default MeasureHudHost;
