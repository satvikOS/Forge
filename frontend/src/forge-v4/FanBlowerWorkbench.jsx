// Forge-231 — Fan / blower workbench.
//
// Sizes a centrifugal fan from flow rate + static pressure + outlet
// area + efficiency. Also exposes the affinity laws (Q ∝ N, Δp ∝ N²·ρ,
// P ∝ N³·ρ) for converting a rated point to operating conditions.
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
  return (typeof window !== 'undefined' && window.forge && window.forge.fan)
      || (typeof window !== 'undefined' && window.electron && window.electron.fan);
}

function defaults() {
  return {
    flowRate: 2.0, deltaPStatic: 500, density: 1.2,
    outletArea: 0.2, fanEfficiency: 0.7,
    N1: 1500, N2: 3000, rho2: 1.2,
  };
}

function FanPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try {
      const a = api();
      const size = a.analyse({
        flowRate: inp.flowRate, deltaPStatic: inp.deltaPStatic,
        density: inp.density, outletArea: inp.outletArea,
        fanEfficiency: inp.fanEfficiency,
      });
      const aff = a.scaleByAffinity({
        Q1: inp.flowRate, dP1: size.totalPressure, P1: size.shaftPower,
        N1: inp.N1, rho1: inp.density,
        N2: inp.N2, rho2: inp.rho2,
      });
      setResult({ size, aff });
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };
  const update = (patch) => setInp({ ...inp, ...patch });

  return (
    <div style={panelStyle} data-testid="forge-fan-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Fan / blower · sizing + affinity</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Δp_v = ½ρV²; Δp_t = Δp_s + Δp_v; P_shaft = QΔp_t/η. Affinity:
        Q ∝ N, Δp ∝ N²·ρ, P ∝ N³·ρ.
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <Field label="Q (m³/s)">
          <input type="number" step="0.1" value={inp.flowRate}
                 data-testid="forge-fan-Q"
                 onChange={(e) => update({ flowRate: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="Δp_s (Pa)">
          <input type="number" step="50" value={inp.deltaPStatic}
                 data-testid="forge-fan-dPs"
                 onChange={(e) => update({ deltaPStatic: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="ρ (kg/m³)">
          <input type="number" step="0.1" value={inp.density}
                 data-testid="forge-fan-rho"
                 onChange={(e) => update({ density: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="A outlet (m²)">
          <input type="number" step="0.01" value={inp.outletArea}
                 data-testid="forge-fan-A"
                 onChange={(e) => update({ outletArea: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="η fan">
          <input type="number" step="0.05" min="0.01" max="1" value={inp.fanEfficiency}
                 data-testid="forge-fan-eta"
                 onChange={(e) => update({ fanEfficiency: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="N₁ rated">
          <input type="number" step="100" value={inp.N1}
                 data-testid="forge-fan-N1"
                 onChange={(e) => update({ N1: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="N₂ op.">
          <input type="number" step="100" value={inp.N2}
                 data-testid="forge-fan-N2"
                 onChange={(e) => update({ N2: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
        <Field label="ρ₂ (kg/m³)">
          <input type="number" step="0.1" value={inp.rho2}
                 data-testid="forge-fan-rho2"
                 onChange={(e) => update({ rho2: Number(e.target.value) || 0 })}
                 style={fieldStyle} />
        </Field>
      </div>

      <button data-testid="forge-fan-run" style={buttonStyle} onClick={onCompute}>
        Compute
      </button>

      {err && (
        <div data-testid="forge-fan-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-fan-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>V outlet&nbsp;&nbsp;&nbsp;{result.size.velocityOutlet.toFixed(2)} m/s</div>
          <div>Δp_v&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.size.velocityPressure.toFixed(1)} Pa</div>
          <div>Δp_t&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{result.size.totalPressure.toFixed(1)} Pa</div>
          <div>P_hyd&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{(result.size.hydraulicPower).toFixed(1)} W</div>
          <div data-testid="forge-fan-shaft"
               style={{ marginTop: 4, fontWeight: 700 }}>
            Shaft P&nbsp;&nbsp;{(result.size.shaftPower / 1000).toFixed(3)} kW
          </div>
          <hr style={{ borderColor: 'var(--forge-rail-edge)' }} />
          <div style={{ color: 'var(--forge-ink-mute)' }}>Affinity-scaled point:</div>
          <div>Q₂&nbsp;&nbsp;&nbsp;&nbsp;{result.aff.Q2.toFixed(3)} m³/s</div>
          <div>Δp₂&nbsp;&nbsp;&nbsp;{result.aff.dP2.toFixed(1)} Pa</div>
          <div>P₂&nbsp;&nbsp;&nbsp;&nbsp;{(result.aff.P2 / 1000).toFixed(3)} kW</div>
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

export function FanBlowerWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenFanWorkbench  = () => setOpen(true);
    window.__forgeCloseFanWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.fan' || id === 'workbench.fan') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'fan') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <FanPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default FanPanel;
