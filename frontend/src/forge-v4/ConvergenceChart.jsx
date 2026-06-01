// Forge-122 — convergence residual chart.
//
// Subscribes to window's 'forge:fea-residual' event (broadcast by
// simulationDispatch.withProgress when a solver completes with a residual
// log) and plots residual vs step on a log scale. Multiple solves
// accumulate into a list — most recent first.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 420, zIndex: 1320,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
};

const ROW = (active) => ({
  padding: 'var(--forge-space-2)',
  borderBottom: '1px solid var(--forge-rail-edge)',
  cursor: 'pointer',
  background: active ? 'var(--forge-accent-mute)' : 'transparent',
});

function ResidualSVG({ residuals, width = 360, height = 200 }) {
  if (!residuals || residuals.length < 2) {
    return <div style={{ color: 'var(--forge-ink-mute)', textAlign: 'center', padding: 20 }}>
      no residuals
    </div>;
  }
  const padL = 36, padB = 22, padT = 8, padR = 8;
  const w = width - padL - padR;
  const h = height - padT - padB;
  const xs = residuals.map((r) => r.step);
  const ys = residuals.map((r) => Math.max(1e-12, Math.abs(r.residual || 1e-12)));
  const xMin = Math.min(...xs), xMax = Math.max(...xs);
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const logYMin = Math.log10(yMin);
  const logYMax = Math.log10(yMax);
  const range = (logYMax - logYMin) || 1;
  const x = (v) => padL + ((v - xMin) / (xMax - xMin || 1)) * w;
  const y = (v) => padT + h - ((Math.log10(v) - logYMin) / range) * h;
  const path = residuals.map((r, i) =>
    `${i === 0 ? 'M' : 'L'} ${x(r.step).toFixed(1)} ${y(Math.max(1e-12, Math.abs(r.residual))).toFixed(1)}`).join(' ');
  // Y-axis ticks (log decades).
  const tickDecs = [];
  for (let d = Math.floor(logYMin); d <= Math.ceil(logYMax); d++) {
    tickDecs.push(d);
  }
  return (
    <svg width={width} height={height} style={{ background: 'var(--forge-canvas)' }}>
      {/* axes */}
      <line x1={padL} y1={padT} x2={padL} y2={padT + h}
            stroke="var(--forge-rail-edge)" />
      <line x1={padL} y1={padT + h} x2={padL + w} y2={padT + h}
            stroke="var(--forge-rail-edge)" />
      {/* y ticks */}
      {tickDecs.map((d) => {
        const v = Math.pow(10, d);
        const yy = y(v);
        if (yy < padT || yy > padT + h) return null;
        return (
          <g key={d}>
            <line x1={padL - 3} y1={yy} x2={padL} y2={yy}
                  stroke="var(--forge-rail-edge)" />
            <text x={padL - 5} y={yy + 3} fontSize={9}
                  fill="var(--forge-ink-mute)"
                  textAnchor="end"
                  fontFamily="var(--forge-mono)">
              1e{d}
            </text>
          </g>
        );
      })}
      {/* x ticks (every 5 steps) */}
      {xs.filter((s, i) => i % Math.max(1, Math.floor(xs.length / 5)) === 0).map((s) => (
        <g key={s}>
          <line x1={x(s)} y1={padT + h} x2={x(s)} y2={padT + h + 3}
                stroke="var(--forge-rail-edge)" />
          <text x={x(s)} y={padT + h + 14} fontSize={9}
                fill="var(--forge-ink-mute)"
                textAnchor="middle"
                fontFamily="var(--forge-mono)">{s}</text>
        </g>
      ))}
      {/* residual curve */}
      <path d={path} fill="none" stroke="var(--forge-accent)" strokeWidth={1.5} />
      {/* points */}
      {residuals.map((r, i) => (
        <circle key={i} cx={x(r.step)} cy={y(Math.max(1e-12, Math.abs(r.residual)))}
                r={1.8} fill="var(--forge-accent)" />
      ))}
    </svg>
  );
}

export function ConvergenceChartPanel({ open, onClose }) {
  const [log, setLog] = React.useState([]);     // [{ jobId, label, residuals, ts }]
  const [active, setActive] = React.useState(0);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const onRes = (e) => {
      const entry = { ...e.detail, ts: Date.now() };
      setLog((prev) => [entry, ...prev].slice(0, 20));
      setActive(0);
    };
    window.addEventListener('forge:fea-residual', onRes);
    return () => window.removeEventListener('forge:fea-residual', onRes);
  }, []);
  if (!open) return null;
  const cur = log[active];
  return (
    <div style={panelStyle} data-testid="forge-convergence-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>FEA Convergence</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-convergence-close">×</button>
      </header>
      <section style={{ overflowY: 'auto', maxHeight: 200 }}>
        {log.length === 0 && (
          <div style={{ color: 'var(--forge-ink-mute)', textAlign: 'center', padding: 20 }}>
            Run a solver — its residual log appears here.
          </div>
        )}
        {log.map((entry, i) => (
          <div key={entry.jobId + '-' + entry.ts}
               style={ROW(i === active)}
               onClick={() => setActive(i)}>
            <div><strong>{entry.label}</strong></div>
            <small style={{ color: 'var(--forge-ink-mute)' }}>
              {entry.residuals.length} steps · final {entry.residuals[entry.residuals.length-1]?.residual?.toExponential?.(2)}
            </small>
          </div>
        ))}
      </section>
      {cur && <ResidualSVG residuals={cur.residuals} />}
      {cur && (
        <div style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                      color: 'var(--forge-ink-mute)' }}>
          steps: {cur.residuals.length} · max residual: {Math.max(...cur.residuals.map((r) => Math.abs(r.residual))).toExponential(3)} ·
          min: {Math.min(...cur.residuals.map((r) => Math.abs(r.residual)).filter((v) => v > 0)).toExponential(3)}
        </div>
      )}
    </div>
  );
}

export function ConvergenceChartHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeOpenConvergence = (v) => setOpen(typeof v === 'boolean' ? v : !open);
    const onRes = () => setOpen(true);   // auto-open when a residual broadcast lands
    window.addEventListener('forge:fea-residual', onRes);
    return () => window.removeEventListener('forge:fea-residual', onRes);
  }, [open]);
  if (typeof document === 'undefined') return null;
  return createPortal(<ConvergenceChartPanel open={open} onClose={() => setOpen(false)} />,
                      document.body);
}
