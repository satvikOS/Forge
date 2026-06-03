// Forge-256 — Hydrology: rational method + Kirpich + IDF.
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Site & civil → Hydrology → Hydrology.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 640, zIndex: 1310,
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
  return (typeof window !== 'undefined' && window.forge && window.forge.hydrology)
      || (typeof window !== 'undefined' && window.electron && window.electron.hydrology);
}

function defaults() {
  return {
    runoffCoefficient: 0.6, drainageAreaM2: 100000,
    flowPathM: 1000, slopeFraction: 0.01,
    a: 800, b: 10, c: 0.85,
  };
}

function HydroPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      const tc = a.kirpichTimeOfConcentrationMin(inp.flowPathM, inp.slopeFraction);
      const i = a.idfIntensityMmHr({
        a: inp.a, b: inp.b, c: inp.c, durationMin: tc,
      });
      const Q = a.rationalDischarge({
        runoffCoefficient: inp.runoffCoefficient,
        rainfallIntensityMmHr: i,
        drainageAreaM2: inp.drainageAreaM2,
      });
      setResult({ tc, i, Q });
    } catch (e) { setErr(String(e?.message || e)); }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-hydro-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Hydrology · rational + Kirpich + IDF</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        T_c = 0.0195·L^0.77·S^(−0.385) min.
        i = a/(t+b)^c. Q = C·i·A (m³/s with i mm/hr ÷ 3.6e6).
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="C">
          <input type="number" step="0.05" min="0" max="1" value={inp.runoffCoefficient}
                 data-testid="forge-hydro-C"
                 onChange={(e) => update({ runoffCoefficient: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="A (m²)">
          <input type="number" step="5000" value={inp.drainageAreaM2}
                 data-testid="forge-hydro-A"
                 onChange={(e) => update({ drainageAreaM2: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="L (m)">
          <input type="number" step="50" value={inp.flowPathM}
                 data-testid="forge-hydro-L"
                 onChange={(e) => update({ flowPathM: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="S (frac)">
          <input type="number" step="0.005" min="0.001" value={inp.slopeFraction}
                 data-testid="forge-hydro-S"
                 onChange={(e) => update({ slopeFraction: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="IDF a">
          <input type="number" step="50" value={inp.a}
                 data-testid="forge-hydro-a"
                 onChange={(e) => update({ a: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="IDF b">
          <input type="number" step="1" value={inp.b}
                 data-testid="forge-hydro-b"
                 onChange={(e) => update({ b: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="IDF c">
          <input type="number" step="0.05" value={inp.c}
                 data-testid="forge-hydro-c"
                 onChange={(e) => update({ c: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-hydro-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-hydro-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-hydro-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div data-testid="forge-hydro-Tc"
               style={{ fontWeight: 700 }}>
            T_c&nbsp;{result.tc.toFixed(1)} min
          </div>
          <div data-testid="forge-hydro-i"
               style={{ fontWeight: 700, color: '#fbbf24' }}>
            i (IDF @ T_c)&nbsp;{result.i.toFixed(1)} mm/hr
          </div>
          <div data-testid="forge-hydro-Q"
               style={{ fontWeight: 700, color: '#4ade80', marginTop: 4 }}>
            Q (peak)&nbsp;{result.Q.toFixed(3)} m³/s ({(result.Q * 1000).toFixed(0)} L/s)
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

export function HydrologyWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenHydroWorkbench  = () => setOpen(true);
    window.__forgeCloseHydroWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.hydro' || id === 'workbench.hydro') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'hydro') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <HydroPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default HydroPanel;
