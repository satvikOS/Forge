// Forge-164 — Generative Design workbench panel.
//
// Drives runGenerativeDesign with user-set objectives + a
// manufacturing-process picker. Shows Pareto front sweep when
// multi-objective is enabled.

import React from 'react';
import { createPortal } from 'react-dom';
import { MFG_PROCESSES, runGenerativeDesign, paretoSweep } from './generativeDesign.js';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 440, zIndex: 1310,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};

function ParetoSVG({ points, width = 380, height = 200 }) {
  if (!points || points.length < 2) {
    return <div style={{ color: 'var(--forge-ink-mute)' }}>no Pareto front yet</div>;
  }
  const padL = 40, padB = 24, padT = 8, padR = 8;
  const w = width - padL - padR;
  const h = height - padT - padB;
  const xs = points.map((p) => p.mass);
  const ys = points.map((p) => p.compliance);
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const x = (v) => padL + ((v - xMin) / (xMax - xMin || 1)) * w;
  const y = (v) => padT + h - ((v - yMin) / (yMax - yMin || 1)) * h;
  return (
    <svg width={width} height={height} style={{ background: 'var(--forge-canvas)' }}>
      <line x1={padL} y1={padT} x2={padL} y2={padT + h}
            stroke="var(--forge-rail-edge)" />
      <line x1={padL} y1={padT + h} x2={padL + w} y2={padT + h}
            stroke="var(--forge-rail-edge)" />
      <text x={padL + w / 2} y={padT + h + 18} fontSize={10}
            fill="var(--forge-ink-mute)" textAnchor="middle"
            fontFamily="var(--forge-mono)">mass →</text>
      <text x={4} y={padT + h / 2} fontSize={10}
            fill="var(--forge-ink-mute)" textAnchor="start"
            fontFamily="var(--forge-mono)"
            transform={`rotate(-90, 14, ${padT + h / 2})`}>compliance →</text>
      {/* curve through points sorted by mass */}
      <path d={points.slice().sort((a, b) => a.mass - b.mass).map((p, i) =>
              `${i === 0 ? 'M' : 'L'} ${x(p.mass).toFixed(1)} ${y(p.compliance).toFixed(1)}`).join(' ')}
            fill="none" stroke="var(--forge-accent)" strokeWidth={1.5} />
      {points.map((p, i) => (
        <g key={i}>
          <circle cx={x(p.mass)} cy={y(p.compliance)} r={3}
                  fill="var(--forge-accent)" />
          <text x={x(p.mass) + 5} y={y(p.compliance) - 5} fontSize={9}
                fill="var(--forge-ink)" fontFamily="var(--forge-mono)">
            VF {(p.vf * 100).toFixed(0)}%
          </text>
        </g>
      ))}
    </svg>
  );
}

export function GenerativeDesignPanel({ open, onClose }) {
  const [processId, setProcessId] = React.useState('mill-3axis');
  const [vf, setVf] = React.useState(0.30);
  const [iterations, setIterations] = React.useState(30);
  const [filter, setFilter] = React.useState(2);
  const [running, setRunning] = React.useState(false);
  const [result, setResult] = React.useState(null);
  const [paretoMode, setParetoMode] = React.useState(false);
  const [paretoPoints, setParetoPoints] = React.useState([]);

  const process = MFG_PROCESSES.find((p) => p.id === processId);

  async function run() {
    setRunning(true); setResult(null);
    try {
      if (paretoMode) {
        const points = await paretoSweep({
          designSpace: { mesh: window.__forgeLastMesh, gridDim: [16, 16, 16], voxelSize: 1 },
          material: { E: 200e9, nu: 0.3, rho: 7850 },
          loads: [{ node: 0, force: [0, 0, -1000] }],
          bcs: [{ node: 1, dof: 'xyz' }],
          processId,
          iterations,
        });
        setParetoPoints(points);
      } else {
        const r = await runGenerativeDesign({
          designSpace: { mesh: window.__forgeLastMesh, gridDim: [16, 16, 16], voxelSize: 1 },
          material: { E: 200e9, nu: 0.3, rho: 7850 },
          loads: [{ node: 0, force: [0, 0, -1000] }],
          bcs: [{ node: 1, dof: 'xyz' }],
          processId,
          volumeFraction: vf,
          iterations,
          filterRadius_mm: filter,
        });
        setResult(r);
      }
    } catch (err) {
      setResult({ error: err.message });
    } finally {
      setRunning(false);
    }
  }

  if (!open) return null;
  return (
    <div style={panelStyle} data-testid="forge-generative-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Generative Design</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-generative-close">×</button>
      </header>

      <section>
        <small style={{ color: 'var(--forge-ink-mute)' }}>Manufacturing process</small>
        <select value={processId} onChange={(e) => setProcessId(e.target.value)}
                style={{ width: '100%', background: 'var(--forge-canvas)',
                         color: 'var(--forge-ink)', border: '1px solid var(--forge-rail-edge)',
                         padding: '6px 8px', fontFamily: 'var(--forge-mono)' }}
                data-testid="forge-generative-process">
          {MFG_PROCESSES.map((p) =>
            <option key={p.id} value={p.id}>{p.label}</option>)}
        </select>
        {process && (
          <pre style={{ fontSize: 10, color: 'var(--forge-ink-mute)',
                        background: 'var(--forge-canvas)',
                        padding: 'var(--forge-space-2)', borderRadius: 'var(--forge-radius)',
                        margin: '6px 0 0 0', overflowX: 'auto' }}>
{JSON.stringify(process.constraints, null, 2)}
          </pre>
        )}
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Volume fraction</small>
          <input type="number" min="0.1" max="0.9" step="0.05" value={vf}
                 onChange={(e) => setVf(parseFloat(e.target.value) || 0.3)}
                 style={{ width: '100%', background: 'var(--forge-canvas)',
                          color: 'var(--forge-ink)',
                          border: '1px solid var(--forge-rail-edge)',
                          padding: '4px 6px', fontFamily: 'var(--forge-mono)' }} />
        </label>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Iterations</small>
          <input type="number" min="5" max="200" step="5" value={iterations}
                 onChange={(e) => setIterations(parseInt(e.target.value, 10) || 30)}
                 style={{ width: '100%', background: 'var(--forge-canvas)',
                          color: 'var(--forge-ink)',
                          border: '1px solid var(--forge-rail-edge)',
                          padding: '4px 6px', fontFamily: 'var(--forge-mono)' }} />
        </label>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Filter radius (mm)</small>
          <input type="number" min="0.5" max="20" step="0.5" value={filter}
                 onChange={(e) => setFilter(parseFloat(e.target.value) || 2)}
                 style={{ width: '100%', background: 'var(--forge-canvas)',
                          color: 'var(--forge-ink)',
                          border: '1px solid var(--forge-rail-edge)',
                          padding: '4px 6px', fontFamily: 'var(--forge-mono)' }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4,
                        marginTop: 14 }}>
          <input type="checkbox" checked={paretoMode}
                 onChange={(e) => setParetoMode(e.target.checked)}
                 data-testid="forge-generative-pareto" />
          <small>Pareto sweep</small>
        </label>
      </section>

      <button onClick={run} disabled={running}
              style={{ background: running ? 'var(--forge-surface)' : 'var(--forge-accent-mute)',
                       border: '1px solid var(--forge-accent-rim)',
                       color: 'var(--forge-ink)',
                       padding: '8px 14px',
                       borderRadius: 'var(--forge-radius)',
                       cursor: running ? 'progress' : 'pointer',
                       fontWeight: 600 }}
              data-testid="forge-generative-run">
        {running ? 'Optimising…' : paretoMode ? 'Sweep Pareto front' : 'Run optimisation'}
      </button>

      {result && !paretoMode && (
        <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                          background: result.error ? 'rgba(226,106,106,0.15)' :
                                       'rgba(126,201,143,0.15)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)' }}>
          {result.error
            ? <div>✗ {result.error}</div>
            : (<>
                <div><strong>Result</strong></div>
                <div>iterations  {result.iterations}</div>
                <div>compliance  {result.compliance?.toExponential(3) ?? 'n/a'}</div>
                <div>converged   {result.converged ? 'yes' : 'no'}</div>
                <div>solid voxels {result.iso?.solidVoxelCount ?? 0} / {result.iso?.totalVoxels ?? 0}</div>
                <div>relative ρ  {(result.iso?.relativeMass * 100).toFixed(1)}%</div>
              </>)}
        </section>
      )}

      {paretoMode && paretoPoints.length > 0 && (
        <section>
          <ParetoSVG points={paretoPoints} />
        </section>
      )}
    </div>
  );
}

export function GenerativeDesignPanelHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenGenerativeDesign = (v) =>
      setOpen(typeof v === 'boolean' ? v : !open);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.generative') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => window.removeEventListener('forge:menu-action', onMenu);
  }, [open]);
  if (typeof document === 'undefined') return null;
  return createPortal(<GenerativeDesignPanel open={open}
                                              onClose={() => setOpen(false)} />,
                      document.body);
}

export default GenerativeDesignPanel;
