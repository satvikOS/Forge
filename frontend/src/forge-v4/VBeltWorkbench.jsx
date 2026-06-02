// Forge-227 — V-belt drive workbench.
//
// Open-belt geometry, wrap angle, belt speed, design power, belt count.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 600, zIndex: 1310,
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
  return (typeof window !== 'undefined' && window.forge && window.forge.vbelt)
      || (typeof window !== 'undefined' && window.electron && window.electron.vbelt);
}

function defaults() {
  return {
    d1: 0.15, d2: 0.30, centreDist: 0.6,
    rpmSmall: 1750, nominalPower: 7500,
    serviceFactor: 1.2, ratingPerBelt: 3000,
  };
}

function VBeltPanel({ open, onClose }) {
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
    <div style={panelStyle} data-testid="forge-vbelt-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>V-belt drive · open geometry</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        L_p ≈ 2·C + (π/2)·(d_1 + d_2) + (d_2 − d_1)²/(4·C). Belt
        count = K_S · P / rating.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="d_1 (m)">
          <input type="number" step="0.01" value={inp.d1}
                 data-testid="forge-vbelt-d1"
                 onChange={(e) => update({ d1: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="d_2 (m)">
          <input type="number" step="0.01" value={inp.d2}
                 data-testid="forge-vbelt-d2"
                 onChange={(e) => update({ d2: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="C (m)">
          <input type="number" step="0.05" value={inp.centreDist}
                 data-testid="forge-vbelt-C"
                 onChange={(e) => update({ centreDist: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="n_1 (rpm)">
          <input type="number" step="50" value={inp.rpmSmall}
                 data-testid="forge-vbelt-rpm"
                 onChange={(e) => update({ rpmSmall: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="P (W)">
          <input type="number" step="500" value={inp.nominalPower}
                 data-testid="forge-vbelt-P"
                 onChange={(e) => update({ nominalPower: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="K_S">
          <input type="number" step="0.1" value={inp.serviceFactor}
                 data-testid="forge-vbelt-KS"
                 onChange={(e) => update({ serviceFactor: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Rating / belt (W)">
          <input type="number" step="500" value={inp.ratingPerBelt}
                 data-testid="forge-vbelt-rating"
                 onChange={(e) => update({ ratingPerBelt: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-vbelt-run" style={buttonStyle} onClick={onAnalyse}>
        Analyse
      </button>

      {err && (
        <div data-testid="forge-vbelt-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-vbelt-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>L_p&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{(result.pitchLength * 1000).toFixed(1)} mm</div>
          <div>θ_s (small)&nbsp;{result.wrapAngleSmallDeg.toFixed(2)}°</div>
          <div>V (belt)&nbsp;&nbsp;{result.beltSpeed.toFixed(2)} m/s</div>
          <div>P_design&nbsp;&nbsp;{(result.designPower / 1000).toFixed(2)} kW</div>
          <div data-testid="forge-vbelt-count"
               style={{ marginTop: 4, fontWeight: 700 }}>
            Belts needed:&nbsp;{Math.ceil(result.beltCount)} ({result.beltCount.toFixed(2)} continuous)
          </div>
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

export function VBeltWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenVBeltWorkbench  = () => setOpen(true);
    window.__forgeCloseVBeltWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.vbelt' || id === 'workbench.vbelt') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'vbelt') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <VBeltPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default VBeltPanel;
