// Forge-261 — Fin efficiency (Incropera Ch. 3) workbench.
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Fluids & HVAC → Heat transfer → Fin efficiency.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 660, zIndex: 1310,
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
  return (typeof window !== 'undefined' && window.forge && window.forge.fin)
      || (typeof window !== 'undefined' && window.electron && window.electron.fin);
}

function defaults() {
  return {
    mode: 'rect',
    heightM: 0.05, thicknessM: 0.005, widthM: 0.1,
    diameterM: 0.005,
    thermalConductivity: 200, convectionH: 100, temperatureDiffK: 100,
  };
}

function FinPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      if (inp.mode === 'rect') {
        setResult({ kind: 'rect', ...a.rectangular({
          heightM: inp.heightM, thicknessM: inp.thicknessM, widthM: inp.widthM,
          thermalConductivity: inp.thermalConductivity,
          convectionH: inp.convectionH,
          temperatureDiffK: inp.temperatureDiffK,
        })});
      } else {
        setResult({ kind: 'pin', ...a.pin({
          lengthM: inp.heightM, diameterM: inp.diameterM,
          thermalConductivity: inp.thermalConductivity,
          convectionH: inp.convectionH,
          temperatureDiffK: inp.temperatureDiffK,
        })});
      }
    } catch (e) { setErr(String(e?.message || e)); }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-fin-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Fin efficiency · Incropera Ch. 3</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Rectangular: m = √(2h/(k·t)), L_c = L+t/2.&nbsp;Pin: m = √(4h/(k·D)),
        L_c = L+D/4. η_f = tanh(m·L_c)/(m·L_c); q_f = η_f·h·A_f·ΔT.
      </div>

      <div style={{ display: 'flex', gap: 6 }} role="tablist">
        {[
          ['rect', 'Rectangular'], ['pin', 'Pin'],
        ].map(([mode, label]) => (
          <button key={mode} role="tab" data-testid={`forge-fin-tab-${mode}`}
                  onClick={() => update({ mode })}
                  style={{ flex: 1, padding: '4px 8px', cursor: 'pointer',
                           fontWeight: 700,
                           background: inp.mode === mode ? 'var(--forge-accent)' : 'var(--forge-canvas)',
                           color: inp.mode === mode ? '#0a0e14' : 'var(--forge-ink)',
                           border: '1px solid var(--forge-rail-edge)' }}>
            {label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label={inp.mode === 'rect' ? 'L (m)' : 'L (m)'}>
          <input type="number" step="0.01" value={inp.heightM}
                 data-testid="forge-fin-L"
                 onChange={(e) => update({ heightM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        {inp.mode === 'rect' && (<>
          <Field label="t (m)">
            <input type="number" step="0.001" value={inp.thicknessM}
                   data-testid="forge-fin-t"
                   onChange={(e) => update({ thicknessM: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="w (m)">
            <input type="number" step="0.025" value={inp.widthM}
                   data-testid="forge-fin-w"
                   onChange={(e) => update({ widthM: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </>)}
        {inp.mode === 'pin' && (
          <Field label="D (m)">
            <input type="number" step="0.001" value={inp.diameterM}
                   data-testid="forge-fin-D"
                   onChange={(e) => update({ diameterM: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        )}
        <Field label="k (W/m·K)">
          <input type="number" step="10" value={inp.thermalConductivity}
                 data-testid="forge-fin-k"
                 onChange={(e) => update({ thermalConductivity: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="h (W/m²·K)">
          <input type="number" step="10" value={inp.convectionH}
                 data-testid="forge-fin-h"
                 onChange={(e) => update({ convectionH: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="ΔT (K)">
          <input type="number" step="10" value={inp.temperatureDiffK}
                 data-testid="forge-fin-dT"
                 onChange={(e) => update({ temperatureDiffK: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-fin-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-fin-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-fin-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>m&nbsp;{result.parameter_m.toFixed(2)} m⁻¹&nbsp;&nbsp;
               L_c&nbsp;{(result.correctedLength * 1000).toFixed(2)} mm</div>
          <div data-testid="forge-fin-eta"
               style={{ marginTop: 4, fontWeight: 700,
                        color: result.finEfficiency > 0.75 ? '#4ade80'
                             : result.finEfficiency > 0.50 ? '#fbbf24' : '#ff6363' }}>
            η_f&nbsp;{(result.finEfficiency * 100).toFixed(1)}%
          </div>
          <div>A_f&nbsp;{(result.finAreaM2 * 1e4).toFixed(2)} cm²&nbsp;&nbsp;
               ε_f&nbsp;{result.finEffectiveness.toFixed(2)}</div>
          <div data-testid="forge-fin-q"
               style={{ fontWeight: 700, color: '#fbbf24' }}>
            q_f&nbsp;{result.heatRateW.toFixed(2)} W
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

export function FinEfficiencyWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenFinWorkbench  = () => setOpen(true);
    window.__forgeCloseFinWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.fin' || id === 'workbench.fin') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'fin') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <FinPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default FinPanel;
