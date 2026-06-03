// Forge-265 — Tuned mass damper (Den Hartog optimum).
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Machine design → Dynamics → Tuned mass damper.
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
  width: 130, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.tmd)
      || (typeof window !== 'undefined' && window.electron && window.electron.tmd);
}

function defaults() {
  return {
    primaryMassKg: 1000, primaryFrequencyHz: 2.5, massRatio: 0.05,
  };
}

function TMDPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try { setResult(api().sizeAbsorber(inp)); }
    catch (e) { setErr(String(e?.message || e)); }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-tmd-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Tuned mass damper · Den Hartog optimum</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        f_opt = 1/(1+μ); ζ_opt = √(3μ/(8(1+μ)³)). At Den Hartog tuning
        TR_peak = √(1 + 2/μ); higher μ gives less peak transmissibility.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="m_p (kg)">
          <input type="number" step="50" value={inp.primaryMassKg}
                 data-testid="forge-tmd-mp"
                 onChange={(e) => update({ primaryMassKg: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="f_p (Hz)">
          <input type="number" step="0.1" value={inp.primaryFrequencyHz}
                 data-testid="forge-tmd-fp"
                 onChange={(e) => update({ primaryFrequencyHz: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="μ (mass ratio)">
          <input type="number" step="0.01" min="0.01" max="1" value={inp.massRatio}
                 data-testid="forge-tmd-mu"
                 onChange={(e) => update({ massRatio: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-tmd-run" style={buttonStyle} onClick={onCompute}>
        Size absorber
      </button>

      {err && (
        <div data-testid="forge-tmd-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-tmd-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>m_a&nbsp;{result.absorberMassKg.toFixed(1)} kg&nbsp;&nbsp;
               f_opt&nbsp;{result.frequencyRatioOptimum.toFixed(3)}</div>
          <div>f_a&nbsp;{result.absorberFrequencyHz.toFixed(2)} Hz&nbsp;&nbsp;
               ζ_opt&nbsp;{result.dampingRatioOptimum.toFixed(3)}</div>
          <div data-testid="forge-tmd-k"
               style={{ marginTop: 4, fontWeight: 700 }}>
            k_a&nbsp;{(result.absorberStiffnessNPerM / 1000).toFixed(1)} kN/m&nbsp;&nbsp;
            c_a&nbsp;{result.absorberDampingNsm.toFixed(1)} Ns/m
          </div>
          <div data-testid="forge-tmd-TR"
               style={{ marginTop: 4, fontWeight: 700,
                        color: result.peakTransmissibility < 5 ? '#4ade80'
                             : result.peakTransmissibility < 10 ? '#fbbf24' : '#ff6363' }}>
            TR_peak&nbsp;{result.peakTransmissibility.toFixed(2)}
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

export function TunedMassDamperWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenTMDWorkbench  = () => setOpen(true);
    window.__forgeCloseTMDWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.tmd' || id === 'workbench.tmd') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'tmd') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <TMDPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default TMDPanel;
