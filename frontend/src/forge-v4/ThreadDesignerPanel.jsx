// Forge-166 — Thread Designer panel.
//
// Right-anchored 420 px panel. Picker rows:
//   • Standard       (ISO Metric / UNC / UNF / NPT)
//   • Size           (depends on standard)
//   • Series         (coarse/fine for metric; UNC/UNF for inch)
//   • Length (mm)
//   • Mode           (External / Internal)
//   • Direction      (RH / LH)
//
// Generate button calls threadGenerator.generateExternalOnShaft (or
// Internal variant) — returns a real kernel solid handle, NOT a mesh.
//
// REACT-#185 AVOIDANCE: the panel mounts via a portal host that uses
//   • a snapshot reducer ({ open, version }) so each toggle bumps version
//   • a stable useEffect dep array — strings only, no fresh refs
// Window imperative hooks NEVER call React setState directly; they
// dispatch a CustomEvent and the panel reads that via useEffect.
//
// Manual UI clicks NEVER write to Archie's thread.

import React from 'react';
import { createPortal } from 'react-dom';
import { STANDARDS, resolveThread, countSizes } from './threadStandards.js';
import {
  generateExternalOnShaft, generateInternalInBore,
} from './threadGenerator.js';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 36px) + var(--forge-qat-h, 32px))',
  right: 0,
  width: 420, maxWidth: '96vw',
  height: 'calc(100vh - var(--forge-topbar-h, 36px) - var(--forge-qat-h, 32px) - var(--forge-cmdbar-h, 32px))',
  background: 'var(--forge-canvas-3, #14171c)',
  borderLeft: '1px solid var(--forge-rail-edge, #232830)',
  boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
  display: 'flex', flexDirection: 'column',
  color: 'var(--forge-ink, #e6e8ec)', fontSize: 12,
  zIndex: 1291,
};
const headerStyle = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '10px 14px',
  borderBottom: '1px solid var(--forge-rail-edge, #232830)',
  background: 'var(--forge-canvas, #0d1014)',
  fontWeight: 600, fontSize: 12, flexShrink: 0,
};
const bodyStyle = {
  flex: 1, overflowY: 'auto',
  padding: '12px 14px',
  display: 'flex', flexDirection: 'column', gap: 10,
};
const rowStyle = {
  display: 'grid', gridTemplateColumns: '108px 1fr',
  alignItems: 'center', gap: 8,
};
const labelStyle = {
  color: 'var(--forge-ink-mute, #8a9099)', fontSize: 11,
};
const selectStyle = {
  background: 'var(--forge-canvas-2, #11151a)',
  border: '1px solid var(--forge-rail-edge, #232830)',
  borderRadius: 3, color: 'var(--forge-ink, #e6e8ec)',
  font: 'inherit', fontSize: 12, padding: '4px 8px',
};
const inputStyle = {
  ...selectStyle, padding: '4px 8px',
};
const generateBtnStyle = (busy) => ({
  background: busy ? 'var(--forge-rail-edge, #232830)' : 'var(--forge-accent, #2966c4)',
  color: '#fff', border: 'none',
  borderRadius: 3, padding: '8px 12px',
  cursor: busy ? 'progress' : 'pointer',
  font: 'inherit', fontSize: 12, fontWeight: 600,
});
const specBlockStyle = {
  background: 'var(--forge-canvas, #0d1014)',
  border: '1px solid var(--forge-rail-edge, #232830)',
  borderRadius: 3, padding: 8,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)', fontSize: 11,
  display: 'grid', gridTemplateColumns: 'auto 1fr',
  rowGap: 3, columnGap: 10,
};
const errStyle = {
  background: '#3a1e22', color: '#ff9aa2',
  border: '1px solid #6b2a30', borderRadius: 3,
  padding: 8, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const okStyle = {
  background: '#1d3a26', color: '#9ad7af',
  border: '1px solid #2c5a3a', borderRadius: 3,
  padding: 8, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};

function fmtMm(v) {
  return Number.isFinite(v) ? `${v.toFixed(3)} mm` : '—';
}

export function ThreadDesignerPanel({ open, onClose }) {
  const [standard, setStandard] = React.useState('ISO_METRIC');
  const [size, setSize]         = React.useState('M10');
  const [series, setSeries]     = React.useState('coarse');
  const [length, setLength]     = React.useState(20);
  const [mode, setMode]         = React.useState('external');
  const [direction, setDir]     = React.useState('rh');
  const [busy, setBusy]         = React.useState(false);
  const [lastResult, setLast]   = React.useState(null);
  const [lastError, setErr]     = React.useState(null);

  // Snap state to derived strings so useMemo deps stay primitive.
  const std = React.useMemo(
    () => STANDARDS.find((s) => s.id === standard) || STANDARDS[0],
    [standard]);

  // When the standard changes, clamp size + series to a valid combo.
  React.useEffect(() => {
    if (!std.sizes.includes(size)) {
      setSize(std.sizes[0]);
    }
    if (!std.seriesOptions.includes(series)) {
      setSeries(std.seriesOptions[0]);
    }
  }, [std, size, series]);

  // Live spec preview — recomputed on every parameter change.
  const spec = React.useMemo(
    () => resolveThread({ standard, size, series }),
    [standard, size, series]);

  function handleGenerate() {
    setBusy(true);
    setErr(null);
    setLast(null);
    try {
      const args = { standard, size, series, lengthMm: Number(length),
                     mode, direction };
      const result = mode === 'external'
        ? generateExternalOnShaft(args)
        : generateInternalInBore(args);
      setLast({
        ok: true,
        mode,
        direction,
        spec: result.spec,
        helixSamples: result.helixPoints?.length || 0,
        // The solid is a kernel handle (number or object id). Stringify
        // safely for the UI without leaking the registry handle.
        solidPresent: result.solid != null,
      });
      // Publish via CustomEvent for callers / e2e — DO NOT post to Archie.
      if (typeof window !== 'undefined') {
        window.__forgeLastThread = {
          standard, size, series, length: Number(length), mode, direction,
          spec: result.spec,
          solid: result.solid,
        };
        window.dispatchEvent(new CustomEvent('forge:thread-generated', {
          detail: {
            standard, size, series, mode, direction,
            length: Number(length),
            spec: result.spec,
          },
        }));
      }
    } catch (err) {
      setErr(err?.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <div style={panelStyle}
         data-testid="forge-thread-designer"
         role="dialog" aria-label="Thread Designer">
      <div style={headerStyle}>
        <span style={{ flex: 1 }}>Thread Designer</span>
        <span style={{ color: 'var(--forge-ink-mute, #8a9099)', fontSize: 11,
                       fontFamily: 'var(--forge-mono, ui-monospace, monospace)' }}>
          {countSizes()} sizes
        </span>
        <button type="button"
                onClick={onClose}
                aria-label="Close"
                data-testid="forge-thread-designer-close"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--forge-ink, #e6e8ec)', cursor: 'pointer',
                  fontSize: 14, lineHeight: 1, padding: '2px 6px',
                }}>
          ×
        </button>
      </div>

      <div style={bodyStyle}>
        <div style={rowStyle}>
          <span style={labelStyle}>Standard</span>
          <select value={standard}
                  onChange={(e) => setStandard(e.target.value)}
                  data-testid="forge-thread-standard"
                  style={selectStyle}>
            {STANDARDS.map((s) => (
              <option key={s.id} value={s.id}>{s.label}</option>
            ))}
          </select>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Size</span>
          <select value={size}
                  onChange={(e) => setSize(e.target.value)}
                  data-testid="forge-thread-size"
                  style={selectStyle}>
            {std.sizes.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Series</span>
          <select value={series}
                  onChange={(e) => setSeries(e.target.value)}
                  data-testid="forge-thread-series"
                  style={selectStyle}
                  disabled={std.seriesOptions.length <= 1}>
            {std.seriesOptions.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Length (mm)</span>
          <input type="number"
                 value={length}
                 min={1} max={500} step={0.5}
                 onChange={(e) => setLength(e.target.value)}
                 data-testid="forge-thread-length"
                 style={inputStyle} />
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Mode</span>
          <select value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  data-testid="forge-thread-mode"
                  style={selectStyle}>
            <option value="external">External (male)</option>
            <option value="internal">Internal (female)</option>
          </select>
        </div>

        <div style={rowStyle}>
          <span style={labelStyle}>Direction</span>
          <select value={direction}
                  onChange={(e) => setDir(e.target.value)}
                  data-testid="forge-thread-direction"
                  style={selectStyle}>
            <option value="rh">Right-hand</option>
            <option value="lh">Left-hand</option>
          </select>
        </div>

        {spec && (
          <div style={specBlockStyle} data-testid="forge-thread-spec">
            <span>Standard</span>
            <span data-testid="spec-standard">{spec.standard}</span>
            <span>Profile</span>
            <span data-testid="spec-profile">{spec.profile}</span>
            <span>Pitch P</span>
            <span data-testid="spec-pitch">{fmtMm(spec.pitch)}</span>
            <span>Major D</span>
            <span data-testid="spec-major">{fmtMm(spec.major)}</span>
            <span>Pitch dia D2</span>
            <span data-testid="spec-pitch-dia">{fmtMm(spec.pitchDia)}</span>
            <span>Minor dia D1</span>
            <span data-testid="spec-minor-dia">
              {Number.isFinite(spec.minorDia) ? fmtMm(spec.minorDia) : '—'}
            </span>
            <span>Height H</span>
            <span data-testid="spec-height">{fmtMm(spec.H)}</span>
            {spec.tapered && (
              <>
                <span>Half-angle</span>
                <span data-testid="spec-half-angle">
                  {spec.halfAngleDeg.toFixed(4)}°
                </span>
              </>
            )}
            {Number.isFinite(spec.tapDrill) && (
              <>
                <span>Tap drill</span>
                <span data-testid="spec-tap-drill">{fmtMm(spec.tapDrill)}</span>
              </>
            )}
          </div>
        )}

        <button type="button"
                onClick={handleGenerate}
                disabled={busy}
                data-testid="forge-thread-generate"
                style={generateBtnStyle(busy)}>
          {busy ? 'Generating…' : 'Generate thread'}
        </button>

        {lastError && (
          <div style={errStyle} data-testid="forge-thread-error">
            {lastError}
          </div>
        )}
        {lastResult && (
          <div style={okStyle} data-testid="forge-thread-result"
               data-mode={lastResult.mode}
               data-direction={lastResult.direction}
               data-solid-present={lastResult.solidPresent ? 'true' : 'false'}
               data-helix-samples={String(lastResult.helixSamples)}>
            OK — {lastResult.spec.standard} {lastResult.spec.size}{' '}
            {lastResult.spec.series} ·{' '}
            {lastResult.mode} · {lastResult.direction.toUpperCase()} ·{' '}
            helix samples {lastResult.helixSamples} ·{' '}
            solid {lastResult.solidPresent ? 'OK' : 'null'}
          </div>
        )}
      </div>
    </div>
  );
}

/** App-level portal host. Mounted as a sibling of ForgeShellV4. */
export function ThreadDesignerPanelHost() {
  // Snapshot reducer: open boolean + version counter → guarantees a
  // re-render on every toggle even when the same boolean is set twice.
  const [snap, setSnap] = React.useState({ open: false, version: 0 });

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onEvt = (e) => {
      const next = !!(e?.detail?.open);
      setSnap((prev) => ({ open: next, version: prev.version + 1 }));
    };
    // Imperative entry point — dispatches an event; NEVER calls setState
    // directly (feedback-studio-window-api-no-setstate).
    window.__forgeOpenThreadDesigner = (v) => {
      const next = typeof v === 'boolean' ? v : true;
      window.dispatchEvent(new CustomEvent('forge:thread-designer-open', {
        detail: { open: next },
      }));
    };
    window.__forgeThreadDesignerIsOpen = () => snap.open;
    window.addEventListener('forge:thread-designer-open', onEvt);
    return () => {
      window.removeEventListener('forge:thread-designer-open', onEvt);
      delete window.__forgeOpenThreadDesigner;
      delete window.__forgeThreadDesignerIsOpen;
    };
    // Stable deps — primitive only, the version bump alone re-fires this
    // effect when needed.
  }, [snap.open, snap.version]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <ThreadDesignerPanel
      open={snap.open}
      onClose={() => setSnap((prev) => ({ open: false, version: prev.version + 1 }))} />,
    document.body);
}

export default ThreadDesignerPanel;
