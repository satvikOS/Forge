// Forge-250 — Newton-Raphson AC power flow on a small N-bus system.
//
// Per [[feedback-forge-ui-hierarchy]] not on the rail. Reached via
// Tools menu → Electrical → Three-phase → Power flow.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 720, zIndex: 1310,
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
  width: 90, background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function api() {
  return (typeof window !== 'undefined' && window.forge && window.forge.powerflow)
      || (typeof window !== 'undefined' && window.electron && window.electron.powerflow);
}

function defaults() {
  return {
    buses: [
      { kind: 'slack', V_init: 1.05, angleDegInit: 0,
        P_specified: 0, Q_specified: 0 },
      { kind: 'pq',    V_init: 1.00, angleDegInit: 0,
        P_specified: -0.60, Q_specified: -0.25 },
      { kind: 'pv',    V_init: 1.04, angleDegInit: 0,
        P_specified: 0.40, Q_specified: 0 },
    ],
    branches: [
      { from: 0, to: 1, R: 0.05, X: 0.20, halfB: 0 },
      { from: 0, to: 2, R: 0.05, X: 0.20, halfB: 0 },
      { from: 1, to: 2, R: 0.05, X: 0.20, halfB: 0 },
    ],
    settings: { tolerance: 1e-6, maxIterations: 30 },
  };
}

function PFlowPanel({ open, onClose }) {
  const [inp, setInp] = React.useState(defaults);
  const [result, setResult] = React.useState(null);
  const [err, setErr] = React.useState('');
  if (!open) return null;

  const onCompute = () => {
    setErr(''); setResult(null);
    try { setResult(api().solve(inp)); }
    catch (e) { setErr(String(e?.message || e)); }
  };

  return (
    <div style={panelStyle} data-testid="forge-pflow-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Power flow · Newton-Raphson</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        Polar-form NR: P_i = Σ |V_i||V_k|·(G cosθ + B sinθ),
        Q_i = Σ |V_i||V_k|·(G sinθ − B cosθ). Slack fixed,
        PV holds V, PQ holds P + Q.
      </div>

      <div>
        <strong>Buses</strong>
        <table style={{ width: '100%', fontFamily: 'var(--forge-mono)', fontSize: 10 }}>
          <thead>
            <tr style={{ color: 'var(--forge-ink-mute)' }}>
              <th>kind</th><th>V_init</th><th>θ°_init</th><th>P_spec</th><th>Q_spec</th>
            </tr>
          </thead>
          <tbody>
            {inp.buses.map((b, i) => (
              <tr key={i}>
                <td>
                  <select value={b.kind}
                          onChange={(e) => {
                            const buses = inp.buses.map((bb, j) =>
                              j === i ? { ...bb, kind: e.target.value } : bb);
                            setInp({ ...inp, buses });
                          }}
                          style={fieldStyle}>
                    <option value="slack">slack</option>
                    <option value="pv">pv</option>
                    <option value="pq">pq</option>
                  </select>
                </td>
                {['V_init', 'angleDegInit', 'P_specified', 'Q_specified'].map((k) => (
                  <td key={k}>
                    <input type="number" step="0.05" value={b[k]}
                           onChange={(e) => {
                             const buses = inp.buses.map((bb, j) =>
                               j === i ? { ...bb, [k]: Number(e.target.value) || 0 } : bb);
                             setInp({ ...inp, buses });
                           }}
                           style={fieldStyle} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <strong>Branches</strong>
        <table style={{ width: '100%', fontFamily: 'var(--forge-mono)', fontSize: 10 }}>
          <thead>
            <tr style={{ color: 'var(--forge-ink-mute)' }}>
              <th>from</th><th>to</th><th>R</th><th>X</th><th>B/2</th>
            </tr>
          </thead>
          <tbody>
            {inp.branches.map((br, i) => (
              <tr key={i}>
                {['from', 'to', 'R', 'X', 'halfB'].map((k) => (
                  <td key={k}>
                    <input type="number" step="0.01" value={br[k]}
                           onChange={(e) => {
                             const branches = inp.branches.map((bb, j) =>
                               j === i ? { ...bb, [k]: Number(e.target.value) || 0 } : bb);
                             setInp({ ...inp, branches });
                           }}
                           style={fieldStyle} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button data-testid="forge-pflow-run" style={buttonStyle} onClick={onCompute}>
        Solve
      </button>

      {err && (
        <div data-testid="forge-pflow-error" style={{ color: 'var(--forge-bad, #ff6363)' }}>
          {err}
        </div>
      )}
      {result && (
        <section data-testid="forge-pflow-result"
                 style={{ background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <div data-testid="forge-pflow-conv"
               style={{ fontWeight: 700,
                        color: result.converged ? '#4ade80' : '#ff6363' }}>
            {result.converged ? 'CONVERGED' : 'NOT CONVERGED'}
            &nbsp;in {result.iterations} iters &nbsp;|mismatch|={result.finalMaxMismatch.toExponential(2)}
          </div>
          <table style={{ width: '100%', marginTop: 6, fontSize: 10 }}>
            <thead>
              <tr style={{ color: 'var(--forge-ink-mute)' }}>
                <th>bus</th><th>|V|</th><th>θ°</th><th>P</th><th>Q</th>
              </tr>
            </thead>
            <tbody>
              {result.buses.map((b, i) => (
                <tr key={i}>
                  <td>{i}</td>
                  <td>{b.V.toFixed(4)}</td>
                  <td>{b.angleDeg.toFixed(2)}</td>
                  <td>{b.P.toFixed(4)}</td>
                  <td>{b.Q.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

export function PowerFlowWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenPFlowWorkbench  = () => setOpen(true);
    window.__forgeClosePFlowWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.pflow' || id === 'workbench.pflow') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'pflow') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <PFlowPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default PFlowPanel;
