// Forge-230 — Refrigeration / heat-pump COP workbench.
//
// Carnot COP (T-only upper bound) + vapor-compression COP from
// caller-supplied 4 cycle enthalpies + compressor power sizing.
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
  return (typeof window !== 'undefined' && window.forge && window.forge.refrig)
      || (typeof window !== 'undefined' && window.electron && window.electron.refrig);
}

function defaults() {
  return {
    mode: 'refrig',
    T_hot_K: 308, T_cold_K: 268,
    h1: 245000, h2: 280000, h3: 100000,
    thermalCapacity: 10000,
  };
}

function RefrigPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      const carnot = a.carnotCOP(inp.T_hot_K, inp.T_cold_K, inp.mode);
      const cycle = a.vaporCycle({
        h1: inp.h1, h2: inp.h2, h3: inp.h3, mode: inp.mode,
      });
      const W = a.compressorPower(inp.thermalCapacity, cycle.cop);
      setResult({ carnot, cycle, W, secondLaw: cycle.cop / carnot });
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-refrig-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Refrigeration · COP</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Carnot upper bound + vapor-compression COP from h₁/h₂/h₃ + 2nd-
        law efficiency = actual/Carnot.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="Mode">
          <select value={inp.mode} data-testid="forge-refrig-mode"
                  onChange={(e) => update({ mode: e.target.value })}
                  style={fieldStyle}>
            <option value="refrig">refrigeration</option>
            <option value="heatpump">heat pump</option>
          </select>
        </Field>
        <Field label="T_hot (K)">
          <input type="number" step="1" value={inp.T_hot_K}
                 data-testid="forge-refrig-Th"
                 onChange={(e) => update({ T_hot_K: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="T_cold (K)">
          <input type="number" step="1" value={inp.T_cold_K}
                 data-testid="forge-refrig-Tc"
                 onChange={(e) => update({ T_cold_K: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="h₁ (J/kg)">
          <input type="number" step="1000" value={inp.h1}
                 data-testid="forge-refrig-h1"
                 onChange={(e) => update({ h1: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="h₂ (J/kg)">
          <input type="number" step="1000" value={inp.h2}
                 data-testid="forge-refrig-h2"
                 onChange={(e) => update({ h2: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="h₃ (J/kg)">
          <input type="number" step="1000" value={inp.h3}
                 data-testid="forge-refrig-h3"
                 onChange={(e) => update({ h3: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Q (W)">
          <input type="number" step="500" value={inp.thermalCapacity}
                 data-testid="forge-refrig-Q"
                 onChange={(e) => update({ thermalCapacity: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-refrig-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-refrig-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-refrig-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>Carnot COP&nbsp;&nbsp;&nbsp;{result.carnot.toFixed(3)}</div>
          <div>Cycle COP&nbsp;&nbsp;&nbsp;&nbsp;{result.cycle.cop.toFixed(3)}</div>
          <div>η_2nd-law&nbsp;&nbsp;&nbsp;{(result.secondLaw * 100).toFixed(1)}%</div>
          <div>q_L (effect)&nbsp;{(result.cycle.refrigerationEffect / 1000).toFixed(1)} kJ/kg</div>
          <div>q_H (cond.)&nbsp;&nbsp;{(result.cycle.condenserRejection / 1000).toFixed(1)} kJ/kg</div>
          <div>w_c&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{(result.cycle.compressorWork / 1000).toFixed(1)} kJ/kg</div>
          <div data-testid="forge-refrig-W"
               style={{ marginTop: 4, fontWeight: 700 }}>
            Compressor W&nbsp;&nbsp;{(result.W / 1000).toFixed(2)} kW
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

export function RefrigerationWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenRefrigWorkbench  = () => setOpen(true);
    window.__forgeCloseRefrigWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.refrig' || id === 'workbench.refrig') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'refrig') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <RefrigPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default RefrigPanel;
