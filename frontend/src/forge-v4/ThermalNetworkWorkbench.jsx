// Forge-211 — steady-state thermal network workbench.
//
// Solves K·T = Q on a thermal-resistance network. Each node carries
// a temperature DOF; each edge is a thermal conductance G [W/K].
// Per-node sources are heat fluxes [W] and per-node `fixed=true`
// pins the temperature.
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

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.thermal)
      || (typeof window !== 'undefined' && window.electron && window.electron.thermal);
}

export function thermalSolve(input) {
  const t = api();
  if (!t) throw new Error('forge.thermal not available');
  return t.solve(input);
}

// PCB-style 5-node fixture: heat source at the chip, conduction
// through 3 traces + ambient sinks at the board edges.
function pcbFixture() {
  return {
    nodes: [
      { fixed: false },                                  // 0 chip
      { fixed: false },                                  // 1 trace mid
      { fixed: false },                                  // 2 trace mid
      { fixed: true, prescribedTemperature: 25 },        // 3 ambient
      { fixed: true, prescribedTemperature: 25 },        // 4 ambient
    ],
    edges: [
      { a: 0, b: 1, conductance: 0.5 },
      { a: 0, b: 2, conductance: 0.5 },
      { a: 1, b: 3, conductance: 0.3 },
      { a: 2, b: 4, conductance: 0.3 },
    ],
    sources: [{ node: 0, heatFlux: 10 }],                // 10 W chip
  };
}

function ThermalPanel({ open, onClose }) {
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onRun = () => {
    setErr(''); setResult(null);
    try {
      const r = thermalSolve(pcbFixture());
      setResult(r);
    } catch (e) {
      setErr(String(e?.message || e));
    }
  };

  return (
    <div style={panelStyle} data-testid="forge-thermal-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Thermal network · steady state</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        K·T = Q on a conductance graph. Pinned nodes (Dirichlet),
        heat-flux sources (Neumann). Edge fluxes report power flow.
      </div>
      <button data-testid="forge-thermal-solve" style={buttonStyle} onClick={onRun}>
        Solve PCB fixture (10 W chip + 2 ambient sinks at 25°C)
      </button>
      {err && (
        <div data-testid="forge-thermal-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-thermal-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div>Singular&nbsp;&nbsp;{result.singular ? 'YES' : 'no'}</div>
          <div style={{ color: 'var(--forge-ink-mute)', marginTop: 4 }}>Temperatures</div>
          {Array.from(result.temperatures).map((T, i) => (
            <div key={i}>node {i}&nbsp;&nbsp;{T.toFixed(2)}°C</div>
          ))}
          <div style={{ color: 'var(--forge-ink-mute)', marginTop: 4 }}>Edge fluxes (W)</div>
          {Array.from(result.edgeFluxes).map((F, i) => (
            <div key={i}>edge {i}&nbsp;&nbsp;{F.toFixed(2)} W</div>
          ))}
        </section>
      )}
    </div>
  );
}

export function ThermalNetworkWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenThermalWorkbench  = () => setOpen(true);
    window.__forgeCloseThermalWorkbench = () => setOpen(false);
    window.__forgeThermalSolve          = thermalSolve;
    window.__forgeThermalFixture        = pcbFixture;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.thermal' || id === 'workbench.thermal') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'thermal') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <ThermalPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default ThermalPanel;
