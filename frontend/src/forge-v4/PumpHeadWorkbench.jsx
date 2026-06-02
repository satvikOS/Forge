// Forge-229 — Pump head / pipe flow workbench.
//
// Darcy-Weisbach + Bernoulli for incompressible liquid flow.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 620, zIndex: 1310,
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
  return (typeof window !== 'undefined' && window.forge && window.forge.pumphead)
      || (typeof window !== 'undefined' && window.electron && window.electron.pumphead);
}

function defaults() {
  return {
    flowRate: 0.010, diameter: 0.050, pipeLength: 100,
    roughness: 4.6e-5, density: 998, dynamicViscosity: 1.0e-3,
    staticHead: 0, pumpEfficiency: 0.7,
  };
}

function PumpHeadPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      setResult(api().analyse(inp));
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-pumphead-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Pump head · Darcy-Weisbach</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Re = ρVD/μ; f via Swamee-Jain or 64/Re; h_f = f·(L/D)·V²/(2g);
        shaft P = ρ·g·Q·H/η.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="Q (m³/s)">
          <input type="number" step="0.001" value={inp.flowRate}
                 data-testid="forge-pumphead-Q"
                 onChange={(e) => update({ flowRate: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="D (m)">
          <input type="number" step="0.005" value={inp.diameter}
                 data-testid="forge-pumphead-D"
                 onChange={(e) => update({ diameter: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="L (m)">
          <input type="number" step="10" value={inp.pipeLength}
                 data-testid="forge-pumphead-L"
                 onChange={(e) => update({ pipeLength: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="ε (m)">
          <input type="number" step="1e-5" value={inp.roughness}
                 data-testid="forge-pumphead-eps"
                 onChange={(e) => update({ roughness: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="ρ (kg/m³)">
          <input type="number" step="10" value={inp.density}
                 data-testid="forge-pumphead-rho"
                 onChange={(e) => update({ density: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="μ (Pa·s)">
          <input type="number" step="1e-4" value={inp.dynamicViscosity}
                 data-testid="forge-pumphead-mu"
                 onChange={(e) => update({ dynamicViscosity: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Static H (m)">
          <input type="number" step="1" value={inp.staticHead}
                 data-testid="forge-pumphead-static"
                 onChange={(e) => update({ staticHead: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="η pump">
          <input type="number" step="0.05" min="0.01" max="1" value={inp.pumpEfficiency}
                 data-testid="forge-pumphead-eta"
                 onChange={(e) => update({ pumpEfficiency: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-pumphead-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-pumphead-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-pumphead-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>V&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.meanVelocity.toFixed(2)} m/s</div>
          <div>Re&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.reynolds.toFixed(0)}</div>
          <div>f&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.frictionFactor.toFixed(5)}</div>
          <div>h_f&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.frictionHead.toFixed(2)} m</div>
          <div>H (total)&nbsp;{result.totalHead.toFixed(2)} m</div>
          <div style={{ marginTop: 4, fontWeight: 700 }} data-testid="forge-pumphead-power">
            Shaft P&nbsp;{(result.shaftPower / 1000).toFixed(2)} kW
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

export function PumpHeadWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenPumpHeadWorkbench  = () => setOpen(true);
    window.__forgeClosePumpHeadWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.pumphead' || id === 'workbench.pumphead') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'pumphead') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <PumpHeadPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default PumpHeadPanel;
