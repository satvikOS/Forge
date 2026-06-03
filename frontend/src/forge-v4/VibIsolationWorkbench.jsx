// Forge-260 — Single-DoF vibration isolation.
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Machine design → Dynamics → Vibration isolation.
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
  return (typeof window !== 'undefined' && window.forge && window.forge.vibiso)
      || (typeof window !== 'undefined' && window.electron && window.electron.vibiso);
}

function defaults() {
  return {
    mode: 'size',
    massKg: 200, drivingFrequencyHz: 50,
    targetIsolationPct: 90, dampingRatio: 0.05,
    stiffnessNPerM: 1.794e6, dampingCoefficientNsm: 1340,
  };
}

function VibPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      if (inp.mode === 'size') {
        setResult({ kind: 'size', ...a.sizeIsolator({
          massKg: inp.massKg, drivingFrequencyHz: inp.drivingFrequencyHz,
          targetIsolationPct: inp.targetIsolationPct, dampingRatio: inp.dampingRatio,
        })});
      } else {
        setResult({ kind: 'response', ...a.response({
          massKg: inp.massKg, stiffnessNPerM: inp.stiffnessNPerM,
          dampingCoefficientNsm: inp.dampingCoefficientNsm,
          drivingFrequencyHz: inp.drivingFrequencyHz,
        })});
      }
    } catch (e) { setErr(String(e?.message || e)); }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-vibiso-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Vibration isolation · single-DoF</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        ω_n = √(k/m); ζ = c/(2√(km)); r = ω/ω_n.
        TR = √((1 + (2ζr)²)/((1−r²)² + (2ζr)²)); isolation only when r > √2.
      </div>

      <div style={{ display: 'flex', gap: 6 }} role="tablist">
        {[
          ['size', 'Size isolator'], ['response', 'Predict response'],
        ].map(([mode, label]) => (
          <button key={mode} role="tab" data-testid={`forge-vibiso-tab-${mode}`}
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
        <Field label="m (kg)">
          <input type="number" step="10" value={inp.massKg}
                 data-testid="forge-vibiso-m"
                 onChange={(e) => update({ massKg: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="f (Hz)">
          <input type="number" step="5" value={inp.drivingFrequencyHz}
                 data-testid="forge-vibiso-f"
                 onChange={(e) => update({ drivingFrequencyHz: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        {inp.mode === 'size' && (<>
          <Field label="iso % target">
            <input type="number" step="5" min="1" max="99" value={inp.targetIsolationPct}
                   data-testid="forge-vibiso-target"
                   onChange={(e) => update({ targetIsolationPct: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="ζ">
            <input type="number" step="0.01" min="0" max="1" value={inp.dampingRatio}
                   data-testid="forge-vibiso-zeta"
                   onChange={(e) => update({ dampingRatio: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </>)}
        {inp.mode === 'response' && (<>
          <Field label="k (N/m)">
            <input type="number" step="50000" value={inp.stiffnessNPerM}
                   data-testid="forge-vibiso-k"
                   onChange={(e) => update({ stiffnessNPerM: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="c (Ns/m)">
            <input type="number" step="100" value={inp.dampingCoefficientNsm}
                   data-testid="forge-vibiso-c"
                   onChange={(e) => update({ dampingCoefficientNsm: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </>)}
      </div>

      <button data-testid="forge-vibiso-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-vibiso-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && result.kind === 'size' && (
        <section data-testid="forge-vibiso-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>r&nbsp;{result.requiredFrequencyRatio.toFixed(2)}&nbsp;&nbsp;
               f_n&nbsp;{result.requiredNaturalFrequencyHz.toFixed(2)} Hz</div>
          <div data-testid="forge-vibiso-k-out"
               style={{ fontWeight: 700 }}>
            k&nbsp;{(result.requiredStiffnessNPerM / 1000).toFixed(0)} kN/m
          </div>
        </section>
      )}
      {result && result.kind === 'response' && (
        <section data-testid="forge-vibiso-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>f_n&nbsp;{result.naturalFrequencyHz.toFixed(2)} Hz&nbsp;&nbsp;
               ζ&nbsp;{result.dampingRatio.toFixed(3)}&nbsp;&nbsp;
               r&nbsp;{result.frequencyRatio.toFixed(2)}</div>
          <div>TR&nbsp;{result.transmissibility.toFixed(4)}</div>
          <div data-testid="forge-vibiso-iso"
               style={{ marginTop: 4, fontWeight: 700,
                        color: result.isolationPct > 75 ? '#4ade80'
                             : result.isolationPct > 50 ? '#fbbf24' : '#ff6363' }}>
            Isolation&nbsp;{result.isolationPct.toFixed(1)}%
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

export function VibIsolationWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenVibIsoWorkbench  = () => setOpen(true);
    window.__forgeCloseVibIsoWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.vibiso' || id === 'workbench.vibiso') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'vibiso') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <VibPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default VibPanel;
