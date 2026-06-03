// Forge-263 — Sound transmission loss (mass law + composite).
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Fluids & HVAC → Acoustics → Sound transmission loss.
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
  return (typeof window !== 'undefined' && window.forge && window.forge.soundtl)
      || (typeof window !== 'undefined' && window.electron && window.electron.soundtl);
}

function defaults() {
  return {
    mode: 'mass',
    surfaceDensityKgPerM2: 12.5, frequencyHz: 500, coincidenceLossDb: 0,
    elements: [
      { areaM2: 8.0, transmissionLossDb: 50 },
      { areaM2: 0.5, transmissionLossDb: 30 },
    ],
  };
}

function STLPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      if (inp.mode === 'mass') {
        setResult({ kind: 'mass', tl: a.massLawTL({
          surfaceDensityKgPerM2: inp.surfaceDensityKgPerM2,
          frequencyHz: inp.frequencyHz,
          coincidenceLossDb: inp.coincidenceLossDb,
        })});
      } else {
        setResult({ kind: 'composite', tl: a.compositeTL({ elements: inp.elements })});
      }
    } catch (e) { setErr(String(e?.message || e)); }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-soundtl-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Sound transmission loss · mass law + composite</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Mass law: TL = 20·log₁₀(ρ_s·f) − 47 dB.
        Composite: τ_total = Σ(A_i·τ_i)/ΣA_i; TL = −10·log₁₀(τ).
      </div>

      <div style={{ display: 'flex', gap: 6 }} role="tablist">
        {[
          ['mass', 'Mass law'], ['composite', 'Composite'],
        ].map(([mode, label]) => (
          <button key={mode} role="tab" data-testid={`forge-soundtl-tab-${mode}`}
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

      {inp.mode === 'mass' && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <Field label="ρ_s (kg/m²)">
            <input type="number" step="2.5" value={inp.surfaceDensityKgPerM2}
                   data-testid="forge-soundtl-rho"
                   onChange={(e) => update({ surfaceDensityKgPerM2: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="f (Hz)">
            <input type="number" step="100" value={inp.frequencyHz}
                   data-testid="forge-soundtl-f"
                   onChange={(e) => update({ frequencyHz: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
          <Field label="coincidence loss (dB)">
            <input type="number" step="1" min="0" value={inp.coincidenceLossDb}
                   data-testid="forge-soundtl-coincide"
                   onChange={(e) => update({ coincidenceLossDb: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        </div>
      )}

      {inp.mode === 'composite' && (
        <div>
          <table style={{ width: '100%', fontFamily: 'var(--forge-mono)', fontSize: 10 }}>
            <thead><tr style={{ color: 'var(--forge-ink-mute)' }}>
              <th>area (m²)</th><th>TL (dB)</th><th></th>
            </tr></thead>
            <tbody>
              {inp.elements.map((el, i) => (
                <tr key={i}>
                  <td>
                    <input type="number" step="0.5" value={el.areaM2}
                           onChange={(e) => {
                             const elements = inp.elements.map((ee, j) =>
                               j === i ? { ...ee, areaM2: Number(e.target.value) || 0 } : ee);
                             setInp({ ...inp, elements });
                           }} style={fieldStyle} />
                  </td>
                  <td>
                    <input type="number" step="5" value={el.transmissionLossDb}
                           onChange={(e) => {
                             const elements = inp.elements.map((ee, j) =>
                               j === i ? { ...ee, transmissionLossDb: Number(e.target.value) || 0 } : ee);
                             setInp({ ...inp, elements });
                           }} style={fieldStyle} />
                  </td>
                  <td>
                    {inp.elements.length > 1 && (
                      <button onClick={() => setInp({ ...inp, elements: inp.elements.filter((_, j) => j !== i) })}
                              style={{ ...fieldStyle, width: 30, cursor: 'pointer',
                                       background: 'var(--forge-bad, #ff6363)',
                                       color: '#0a0e14', fontWeight: 700 }}>×</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button data-testid="forge-soundtl-add"
                  onClick={() => setInp({ ...inp, elements: [...inp.elements, { areaM2: 1, transmissionLossDb: 40 }] })}
                  style={{ ...buttonStyle, marginTop: 6, background: 'var(--forge-canvas-2)',
                           color: 'var(--forge-ink)',
                           border: '1px solid var(--forge-rail-edge)' }}>
            + add element
          </button>
        </div>
      )}

      <button data-testid="forge-soundtl-run" style={buttonStyle} onClick={onCompute}>
        Compute TL
      </button>

      {err && (
        <div data-testid="forge-soundtl-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-soundtl-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 13,
                          fontWeight: 700, color: '#4ade80' }}
                 data-tl={result.tl.toFixed(3)}>
          TL&nbsp;{result.tl.toFixed(2)} dB
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

export function SoundTLWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSoundTLWorkbench  = () => setOpen(true);
    window.__forgeCloseSoundTLWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.soundtl' || id === 'workbench.soundtl') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'soundtl') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <STLPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default STLPanel;
