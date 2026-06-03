// Forge-259 — Combustion analysis (stoichiometric AFR + flue gas).
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Fluids & HVAC → Combustion → Combustion.
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
  width: 100, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.combustion)
      || (typeof window !== 'undefined' && window.electron && window.electron.combustion);
}

function defaults() {
  return {
    C: 0.75, H: 0.05, O: 0.05, N: 0.01, S: 0.04,
    excessAirRatio: 1.20,
  };
}

function CombPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      setResult(api().analyse({
        fuel: { C: inp.C, H: inp.H, O: inp.O, N: inp.N, S: inp.S },
        excessAirRatio: inp.excessAirRatio,
      }));
    } catch (e) { setErr(String(e?.message || e)); }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-combustion-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Combustion · stoichiometric AFR + flue gas</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        m_O₂,stoich = (8/3)·C + 8·H + S − O. AFR_stoich = O₂/0.232.
        Excess λ → flue gas %CO₂, %O₂, %N₂ dry basis.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {['C', 'H', 'O', 'N', 'S'].map((el) => (
          <Field key={el} label={`${el} (mass)`}>
            <input type="number" step="0.01" min="0" max="1" value={inp[el]}
                   data-testid={`forge-combustion-${el}`}
                   onChange={(e) => update({ [el]: Number(e.target.value) || 0 })}
                   style={fieldStyle} />
          </Field>
        ))}
        <Field label="λ excess">
          <input type="number" step="0.05" min="1" value={inp.excessAirRatio}
                 data-testid="forge-combustion-lambda"
                 onChange={(e) => update({ excessAirRatio: Number(e.target.value) || 1 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-combustion-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-combustion-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-combustion-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div data-testid="forge-combustion-AFR"
               style={{ fontWeight: 700 }}>
            AFR stoich&nbsp;{result.stoichiometricAirKgPerKgFuel.toFixed(2)} kg/kg&nbsp;&nbsp;
            actual&nbsp;{result.actualAirKgPerKgFuel.toFixed(2)} kg/kg
          </div>
          <div>CO₂&nbsp;{result.co2KgPerKgFuel.toFixed(2)} kg/kg&nbsp;&nbsp;
               H₂O&nbsp;{result.h2oKgPerKgFuel.toFixed(2)} kg/kg&nbsp;&nbsp;
               SO₂&nbsp;{result.so2KgPerKgFuel.toFixed(3)} kg/kg</div>
          <div>N₂&nbsp;{result.n2KgPerKgFuel.toFixed(2)} kg/kg&nbsp;&nbsp;
               excess O₂&nbsp;{result.excessO2KgPerKgFuel.toFixed(3)} kg/kg</div>
          <div data-testid="forge-combustion-dry"
               style={{ marginTop: 4, fontWeight: 700, color: '#fbbf24' }}>
            Dry flue gas&nbsp;
            CO₂&nbsp;{result.dryCO2MassPct.toFixed(1)}%&nbsp;&nbsp;
            O₂&nbsp;{result.dryO2MassPct.toFixed(2)}%&nbsp;&nbsp;
            N₂&nbsp;{result.dryN2MassPct.toFixed(1)}%
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

export function CombustionWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenCombustionWorkbench  = () => setOpen(true);
    window.__forgeCloseCombustionWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.combustion' || id === 'workbench.combustion') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'combustion') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <CombPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default CombPanel;
