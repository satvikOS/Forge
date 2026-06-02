// Forge-185 — Tolerance stack-up workbench.
//
// 1D linear stack with worst-case + RSS + Monte-Carlo. Each row is a
// (name, nominal, +tol, −tol, distribution) link in the chain; spec is
// (LSL, USL) on the assembly total.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const DIST_LABELS = ['Normal (±3σ = tol)', 'Uniform', 'Triangular'];

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 540, zIndex: 1310,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};

const fieldInputStyle = {
  width: '100%', background: 'var(--forge-canvas)',
  color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '3px 5px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function DistributionBar({ result, width = 480, height = 64 }) {
  if (!result) return null;
  const { worstCaseLow, worstCaseHigh, mcP05, mcP95, rssMu } = result;
  const wcSpan = Math.max(0.001, worstCaseHigh - worstCaseLow);
  const X = (v) => ((v - worstCaseLow) / wcSpan) * width;
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-tol-bar">
      <rect x={0} y={20} width={width} height={6}
            fill="var(--forge-rail-edge)" />
      <rect x={X(mcP05)} y={14} width={Math.max(2, X(mcP95) - X(mcP05))}
            height={18} fill="var(--forge-accent)" opacity={0.7} />
      <line x1={X(rssMu)} y1={6} x2={X(rssMu)} y2={40}
            stroke="#fff" strokeWidth={1.5} />
      <text x={X(rssMu)} y={48} fontSize={9}
            textAnchor="middle" fill="var(--forge-ink-mute)"
            fontFamily="var(--forge-mono)">
        μ {rssMu.toFixed(3)}
      </text>
      <text x={0}     y={60} fontSize={9} fill="var(--forge-ink-mute)"
            fontFamily="var(--forge-mono)">{worstCaseLow.toFixed(3)}</text>
      <text x={width-32} y={60} fontSize={9} fill="var(--forge-ink-mute)"
            fontFamily="var(--forge-mono)">{worstCaseHigh.toFixed(3)}</text>
    </svg>
  );
}

export function ToleranceStackWorkbenchPanel({ open, onClose }) {
  const [chain, setChain] = React.useState([
    { name: 'L1', nominal: 10, tolPlus: 0.05, tolMinus: 0.05, dist: 0 },
    { name: 'L2', nominal: 10, tolPlus: 0.05, tolMinus: 0.05, dist: 0 },
    { name: 'L3', nominal: 10, tolPlus: 0.05, tolMinus: 0.05, dist: 0 },
    { name: 'L4', nominal: 10, tolPlus: 0.05, tolMinus: 0.05, dist: 0 },
  ]);
  const [USL, setUSL] = React.useState(40.20);
  const [LSL, setLSL] = React.useState(39.80);
  const [mcSamples, setMcSamples] = React.useState(10000);
  const [status, setStatus] = React.useState({ kind: 'idle', text: 'idle' });
  const [result, setResult] = React.useState(null);

  const onRun = React.useCallback(() => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.tolerance) {
      setStatus({ kind: 'err', text: 'forge.tolerance unavailable' });
      return;
    }
    try {
      const r = f.tolerance.compute({
        chain, USL, LSL, mcSamples, randomSeed: 42,
      });
      setResult(r);
      setStatus({ kind: 'ok',
        text: `Cp ${r.rssCp.toFixed(2)} · Cpk ${r.rssCpk.toFixed(2)} · MC yield ${r.mcYieldPct.toFixed(2)}%` });
    } catch (e) {
      setStatus({ kind: 'err', text: e.message });
    }
  }, [chain, USL, LSL, mcSamples]);

  React.useEffect(() => { if (open) onRun(); }, [open]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-tol-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Tolerance · 1D stack-up (worst-case + RSS + MC)</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-tol-close">×</button>
      </header>

      <section>
        <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      marginBottom: 4 }}>Chain</div>
        <table style={{ width: '100%', borderCollapse: 'collapse',
                        fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <thead>
            <tr style={{ color: 'var(--forge-ink-mute)' }}>
              <th style={{ textAlign: 'left' }}>name</th>
              <th>nominal</th><th>+tol</th><th>−tol</th><th>dist</th><th></th>
            </tr>
          </thead>
          <tbody>
            {chain.map((d, i) => (
              <tr key={i}>
                <td><input value={d.name}
                           onChange={(e) => setChain((arr) => arr.map((x, j) =>
                             j === i ? { ...x, name: e.target.value } : x))}
                           style={fieldInputStyle}
                           data-testid={`forge-tol-name-${i}`} /></td>
                <td><input type="number" value={d.nominal} step={0.1}
                           onChange={(e) => setChain((arr) => arr.map((x, j) =>
                             j === i ? { ...x, nominal: parseFloat(e.target.value) || 0 } : x))}
                           style={fieldInputStyle}
                           data-testid={`forge-tol-nom-${i}`} /></td>
                <td><input type="number" value={d.tolPlus} step={0.01}
                           onChange={(e) => setChain((arr) => arr.map((x, j) =>
                             j === i ? { ...x, tolPlus: parseFloat(e.target.value) || 0 } : x))}
                           style={fieldInputStyle}
                           data-testid={`forge-tol-plus-${i}`} /></td>
                <td><input type="number" value={d.tolMinus} step={0.01}
                           onChange={(e) => setChain((arr) => arr.map((x, j) =>
                             j === i ? { ...x, tolMinus: parseFloat(e.target.value) || 0 } : x))}
                           style={fieldInputStyle}
                           data-testid={`forge-tol-minus-${i}`} /></td>
                <td><select value={d.dist}
                            onChange={(e) => setChain((arr) => arr.map((x, j) =>
                              j === i ? { ...x, dist: parseInt(e.target.value) || 0 } : x))}
                            style={fieldInputStyle}
                            data-testid={`forge-tol-dist-${i}`}>
                  {DIST_LABELS.map((l, k) => <option key={k} value={k}>{l}</option>)}
                </select></td>
                <td>
                  <button onClick={() => setChain((arr) => arr.filter((_, j) => j !== i))}
                          style={{ ...fieldInputStyle, width: 24, cursor: 'pointer' }}>
                    −
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button onClick={() => setChain((arr) => [...arr,
                { name: `L${arr.length + 1}`, nominal: 10, tolPlus: 0.05, tolMinus: 0.05, dist: 0 }])}
                style={{ ...fieldInputStyle, cursor: 'pointer', marginTop: 4 }}
                data-testid="forge-tol-add">
          + add link
        </button>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>LSL</small>
          <input type="number" value={LSL} step={0.01}
                 onChange={(e) => setLSL(parseFloat(e.target.value) || 0)}
                 style={fieldInputStyle} data-testid="forge-tol-lsl" />
        </label>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>USL</small>
          <input type="number" value={USL} step={0.01}
                 onChange={(e) => setUSL(parseFloat(e.target.value) || 0)}
                 style={fieldInputStyle} data-testid="forge-tol-usl" />
        </label>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>MC samples</small>
          <input type="number" value={mcSamples} step={1000}
                 onChange={(e) => setMcSamples(parseInt(e.target.value) || 10000)}
                 style={fieldInputStyle} data-testid="forge-tol-mc" />
        </label>
      </section>

      <button onClick={onRun}
              style={{ background: 'var(--forge-accent)', border: 'none',
                       color: '#0a0e14', padding: '8px 12px', cursor: 'pointer',
                       fontWeight: 600, fontFamily: 'var(--forge-mono)' }}
              data-testid="forge-tol-run">
        Compute stack-up
      </button>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        color: status.kind === 'err' ? 'var(--forge-bad, #ff6363)'
                             : status.kind === 'ok'  ? 'var(--forge-ok, #4ec18b)'
                             : 'var(--forge-ink-mute)' }}
               data-testid="forge-tol-status">
        {status.text}
      </section>

      {result && <DistributionBar result={result} />}

      {result && (
        <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                          background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)' }}
                 data-testid="forge-tol-result">
          <div>Worst-case   {result.worstCaseLow.toFixed(4)} → {result.worstCaseHigh.toFixed(4)}</div>
          <div>RSS  μ {result.rssMu.toFixed(4)}  σ {result.rssSigma.toFixed(4)}</div>
          <div>RSS  Cp {result.rssCp.toFixed(3)}  Cpk {result.rssCpk.toFixed(3)}</div>
          <div>MC   μ {result.mcMu.toFixed(4)}  σ {result.mcSigma.toFixed(4)}</div>
          <div>MC   P05/50/95 {result.mcP05.toFixed(3)} / {result.mcP50.toFixed(3)} / {result.mcP95.toFixed(3)}</div>
          <div>MC   Cp {result.mcCp.toFixed(3)}  Cpk {result.mcCpk.toFixed(3)}</div>
          <div>MC   yield {result.mcYieldPct.toFixed(2)} % within [LSL, USL]</div>
        </section>
      )}
    </div>
  );
}

export function ToleranceStackWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenToleranceWorkbench  = () => setOpen(true);
    window.__forgeCloseToleranceWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.tolerance' || e?.detail?.id === 'workbench.tolerance') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'tolerance') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <ToleranceStackWorkbenchPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default ToleranceStackWorkbenchPanel;
