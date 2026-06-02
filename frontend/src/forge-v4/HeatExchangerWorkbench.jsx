// Forge-218 — heat exchanger LMTD sizing workbench.
//
// Inputs: hot in/out, cold in/out, flow type → LMTD + ΔT₁/ΔT₂.
// Plus required area Q/(U·LMTD·F) and ε-NTU effectiveness.
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
  width: 100, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.hxc)
      || (typeof window !== 'undefined' && window.electron && window.electron.hxc);
}

function defaults() {
  return {
    thIn: 100, thOut: 60, tcIn: 20, tcOut: 50,
    flow: 'counter',
    Q: 50000, U: 500, F: 1.0,
    cMin: 100, cMax: 200, UA: 200,
  };
}

function HeatExchangerPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onSolve = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      const lm = a.lmtd({
        thIn: inp.thIn, thOut: inp.thOut, tcIn: inp.tcIn, tcOut: inp.tcOut,
        flow: inp.flow,
      });
      const area = a.requiredArea({ Q: inp.Q, U: inp.U, lmtd: lm.lmtd, F: inp.F });
      const eps = a.effectiveness({
        UA: inp.UA, cMin: inp.cMin, cMax: inp.cMax, flow: inp.flow,
      });
      setResult({ lm, area, eps });
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-hxc-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Heat exchanger · LMTD + ε-NTU</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Counter-flow ΔT₁ = T_h,in − T_c,out (parallel uses inlets-vs-
        inlets). LMTD = (ΔT₁ − ΔT₂) / ln(ΔT₁/ΔT₂). Q = U·A·LMTD·F.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="Th in (°C)">
          <input type="number" step="1" value={inp.thIn}
                 data-testid="forge-hxc-thIn"
                 onChange={(e) => update({ thIn: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Th out (°C)">
          <input type="number" step="1" value={inp.thOut}
                 data-testid="forge-hxc-thOut"
                 onChange={(e) => update({ thOut: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Tc in (°C)">
          <input type="number" step="1" value={inp.tcIn}
                 data-testid="forge-hxc-tcIn"
                 onChange={(e) => update({ tcIn: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Tc out (°C)">
          <input type="number" step="1" value={inp.tcOut}
                 data-testid="forge-hxc-tcOut"
                 onChange={(e) => update({ tcOut: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Flow">
          <select value={inp.flow} data-testid="forge-hxc-flow"
                  onChange={(e) => update({ flow: e.target.value })}
                  style={fieldStyle}>
            <option value="counter">counter</option>
            <option value="parallel">parallel</option>
          </select>
        </Field>
        <Field label="Q (W)">
          <input type="number" step="1000" value={inp.Q}
                 data-testid="forge-hxc-Q"
                 onChange={(e) => update({ Q: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="U (W/m²K)">
          <input type="number" step="50" value={inp.U}
                 data-testid="forge-hxc-U"
                 onChange={(e) => update({ U: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="F factor">
          <input type="number" step="0.05" value={inp.F}
                 data-testid="forge-hxc-F"
                 onChange={(e) => update({ F: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="UA (W/K)">
          <input type="number" step="10" value={inp.UA}
                 data-testid="forge-hxc-UA"
                 onChange={(e) => update({ UA: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="C_min (W/K)">
          <input type="number" step="10" value={inp.cMin}
                 data-testid="forge-hxc-cmin"
                 onChange={(e) => update({ cMin: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="C_max (W/K)">
          <input type="number" step="10" value={inp.cMax}
                 data-testid="forge-hxc-cmax"
                 onChange={(e) => update({ cMax: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-hxc-run" style={buttonStyle} onClick={onSolve}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-hxc-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-hxc-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>ΔT₁ / ΔT₂&nbsp;&nbsp;{result.lm.dT1.toFixed(2)} / {result.lm.dT2.toFixed(2)} K</div>
          <div>LMTD&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.lm.lmtd.toFixed(2)} K</div>
          <div>Area req&nbsp;&nbsp;&nbsp;{result.area.toFixed(3)} m²</div>
          <div>Effectiveness ε&nbsp;{result.eps.toFixed(4)}</div>
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

export function HeatExchangerWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenHxcWorkbench  = () => setOpen(true);
    window.__forgeCloseHxcWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.hxc' || id === 'workbench.hxc') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'hxc') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <HeatExchangerPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default HeatExchangerPanel;
