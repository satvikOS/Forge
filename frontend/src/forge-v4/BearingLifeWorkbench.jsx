// Forge-226 — Bearing L10 life workbench.
//
// ISO 281: L10 = (C/P)^p × 10^6 rev; reliability-adjusted Lna.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 580, zIndex: 1310,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};
const buttonStyle = {
  background: 'var(--forge-accent)', border: 'none',
  color: '#0a0e14', padding: '6px 10px', cursor: 'pointer',
  fontWeight: 600, fontFamily: 'var(--forge-mono)', fontSize: 11,
};
const fieldStyle = {
  width: 110, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.bearing)
      || (typeof window !== 'undefined' && window.electron && window.electron.bearing);
}

function defaults() {
  return {
    C: 30000, Fr: 5000, Fa: 0, X: 1.0, Y: 0.0,
    kind: 'ball', reliabilityPercent: 90, rpm: 1500,
  };
}

function BearingPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onAnalyse = () => {
    setErr(''); setResult(null);
    try {
      setResult(api().analyse(inp));
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-bearing-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Bearing · L10 life (ISO 281)</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        P = X·F_r + Y·F_a; L10 = (C/P)^p with p=3 (ball) or 10/3 (roller).
        Reliability factor a1 adjusts for reliability ≠ 90%.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="C (N)">
          <input type="number" step="1000" value={inp.C}
                 data-testid="forge-bearing-C"
                 onChange={(e) => update({ C: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="F_r (N)">
          <input type="number" step="100" value={inp.Fr}
                 data-testid="forge-bearing-Fr"
                 onChange={(e) => update({ Fr: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="F_a (N)">
          <input type="number" step="100" value={inp.Fa}
                 data-testid="forge-bearing-Fa"
                 onChange={(e) => update({ Fa: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="X">
          <input type="number" step="0.01" value={inp.X}
                 data-testid="forge-bearing-X"
                 onChange={(e) => update({ X: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Y">
          <input type="number" step="0.01" value={inp.Y}
                 data-testid="forge-bearing-Y"
                 onChange={(e) => update({ Y: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Kind">
          <select value={inp.kind} data-testid="forge-bearing-kind"
                  onChange={(e) => update({ kind: e.target.value })}
                  style={fieldStyle}>
            <option value="ball">ball</option>
            <option value="roller">roller</option>
          </select>
        </Field>
        <Field label="Reliability %">
          <select value={inp.reliabilityPercent} data-testid="forge-bearing-rel"
                  onChange={(e) => update({ reliabilityPercent: Number(e.target.value) })}
                  style={fieldStyle}>
            <option value={90}>90 (a1=1.00)</option>
            <option value={95}>95 (0.62)</option>
            <option value={99}>99 (0.21)</option>
            <option value={99.5}>99.5 (0.13)</option>
            <option value={99.9}>99.9 (0.04)</option>
          </select>
        </Field>
        <Field label="rpm">
          <input type="number" step="100" value={inp.rpm}
                 data-testid="forge-bearing-rpm"
                 onChange={(e) => update({ rpm: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-bearing-run" style={buttonStyle} onClick={onAnalyse}>
        Analyse
      </button>

      {err && (
        <div data-testid="forge-bearing-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-bearing-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>P (equiv)&nbsp;&nbsp;{result.equivalentLoad.toFixed(1)} N</div>
          <div>L10&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.L10MegaRev.toFixed(3)} × 10⁶ rev</div>
          <div>L10 hours&nbsp;&nbsp;{result.L10Hours > 0 ? result.L10Hours.toFixed(1) + ' h' : '—'}</div>
          <div>a1&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.reliabilityFactor.toFixed(3)}</div>
          <div>Lna&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.LnaMegaRev.toFixed(3)} × 10⁶ rev</div>
          <div>Lna hours&nbsp;&nbsp;{result.LnaHours > 0 ? result.LnaHours.toFixed(1) + ' h' : '—'}</div>
        </section>
      )}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ color: 'var(--forge-ink-mute)' }}>{label}</span>
      {children}
    </label>
  );
}

export function BearingLifeWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenBearingWorkbench  = () => setOpen(true);
    window.__forgeCloseBearingWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.bearing' || id === 'workbench.bearing') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'bearing') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <BearingPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default BearingPanel;
