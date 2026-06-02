// Forge-193 — Time-series log viewer for FEA / CFD / acoustics traces.
//
// Generic interactive plot for any (x, y_k) series the user wants to
// inspect during or after a long simulation run. Built-in demos: an FEA
// convergence trace (Newton residuals across iterations), a CFD lift
// history, an acoustics EDC decay from forge.acoustics.simulate, a
// casting cooling curve from forge.casting.solidify (probe cell).
//
// Features:
//   * Multi-series overlay with per-series colour + visibility toggle.
//   * Linear / log Y axis.
//   * Hover crosshair with on-the-fly value readout for every visible
//     series at the cursor's X position.
//   * Auto-scroll: as new samples land (live runs), the view follows
//     the head of the trace. Toggle off for free pan.
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

const fieldInputStyle = {
  width: '100%', background: 'var(--forge-canvas)',
  color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '4px 6px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

// Demo generators.
function buildFeaConvergence(iters = 60) {
  const x = [], yR = [], yE = [], yD = [];
  for (let i = 1; i <= iters; ++i) {
    x.push(i);
    yR.push(1.0 * Math.exp(-0.15 * i) * (1 + 0.1 * Math.sin(i * 0.4)));   // residual
    yE.push(0.5 * Math.exp(-0.10 * i) * (1 + 0.05 * Math.cos(i * 0.7))); // energy
    yD.push(0.2 * Math.exp(-0.08 * i));                                  // displacement
  }
  return { xLabel: 'Newton iteration', xs: x, series: [
    { name: 'residual',     color: '#d97a3b', y: yR },
    { name: 'energy',       color: '#56a8d4', y: yE },
    { name: 'displacement', color: '#79c170', y: yD },
  ], yAxis: 'log' };
}
function buildCfdLift(samples = 120) {
  const x = [], yL = [], yD = [];
  for (let i = 0; i < samples; ++i) {
    x.push(i * 0.05);
    const t = i * 0.05;
    yL.push(0.6 * (1 - Math.exp(-t * 1.2)) + 0.06 * Math.sin(t * 6));  // lift
    yD.push(0.04 * (1 - Math.exp(-t * 1.0)) + 0.005 * Math.sin(t * 8 + 1));  // drag
  }
  return { xLabel: 't [s]', xs: x, series: [
    { name: 'CL', color: '#d97a3b', y: yL },
    { name: 'CD', color: '#56a8d4', y: yD },
  ], yAxis: 'linear' };
}
function buildCastingCooling(samples = 200) {
  const x = [], y = [];
  for (let i = 0; i < samples; ++i) {
    const t = i / samples * 8;
    x.push(t);
    // pour 700°C → ambient 25°C, exponential decay with phase plateau.
    let z;
    if (t < 1.5) z = 700 - (700 - 615) * t / 1.5;          // sensible cool to liquidus
    else if (t < 3.5) z = 615 - (615 - 555) * (t - 1.5) / 2;// mushy zone
    else z = 555 - (555 - 25) * (1 - Math.exp(-(t - 3.5) / 2.0));
    y.push(z);
  }
  return { xLabel: 't [s]', xs: x, series: [
    { name: 'T probe [°C]', color: '#d97a3b', y: y },
  ], yAxis: 'linear' };
}
function buildAcousticsEdc(samples = 240) {
  const x = [], y = [];
  for (let i = 0; i < samples; ++i) {
    const t = i / samples * 2;
    x.push(t);
    y.push(-60 * (1 - Math.exp(-t / 0.5)));
  }
  return { xLabel: 't [s]', xs: x, series: [
    { name: 'EDC [dB]', color: '#56a8d4', y: y },
  ], yAxis: 'linear' };
}

const DEMOS = [
  { label: 'FEA Newton residuals (log Y)', build: () => buildFeaConvergence() },
  { label: 'CFD lift + drag history',       build: () => buildCfdLift() },
  { label: 'Casting probe cooling curve',   build: () => buildCastingCooling() },
  { label: 'Acoustics EDC tail',            build: () => buildAcousticsEdc() },
];

function LogChart({ trace, cursorX, onCursor, width = 540, height = 280 }) {
  if (!trace) return null;
  const padL = 50, padR = 12, padT = 14, padB = 28;
  const w = width - padL - padR, h = height - padT - padB;
  const xs = trace.xs;
  const xLo = xs[0], xHi = xs[xs.length - 1];
  let yLo = +Infinity, yHi = -Infinity;
  for (const s of trace.series) {
    if (!s.visible && s.visible !== undefined) continue;
    for (const v of s.y) {
      const u = trace.yAxis === 'log' ? Math.log10(Math.max(1e-30, Math.abs(v))) : v;
      if (u < yLo) yLo = u;
      if (u > yHi) yHi = u;
    }
  }
  if (yLo === yHi) { yLo -= 1; yHi += 1; }
  const X = (v) => padL + (v - xLo) / Math.max(1e-12, xHi - xLo) * w;
  const Y = (v) => {
    const u = trace.yAxis === 'log' ? Math.log10(Math.max(1e-30, Math.abs(v))) : v;
    return padT + h - (u - yLo) / Math.max(1e-12, yHi - yLo) * h;
  };
  const ticksY = [];
  if (trace.yAxis === 'log') {
    const lo = Math.floor(yLo), hi = Math.ceil(yHi);
    for (let e = lo; e <= hi; ++e) ticksY.push({ value: Math.pow(10, e), label: `10^${e}` });
  } else {
    for (let k = 0; k < 5; ++k) {
      const v = yLo + (yHi - yLo) * k / 4;
      ticksY.push({ value: v, label: v.toFixed(2) });
    }
  }
  const onMove = (e) => {
    const svg = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - svg.left;
    if (px < padL || px > padL + w) { onCursor?.(null); return; }
    const xVal = xLo + (px - padL) / w * (xHi - xLo);
    onCursor?.(xVal);
  };
  const cursorIdx = (cursorX != null)
    ? xs.findIndex((v, i) => v >= cursorX || i === xs.length - 1)
    : -1;
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-tsv-chart"
         onMouseMove={onMove}
         onMouseLeave={() => onCursor?.(null)}>
      <line x1={padL} y1={padT} x2={padL} y2={padT + h} stroke="var(--forge-rail-edge)" />
      <line x1={padL} y1={padT + h} x2={padL + w} y2={padT + h} stroke="var(--forge-rail-edge)" />
      {ticksY.map((t, i) => (
        <g key={i}>
          <line x1={padL} y1={Y(t.value)} x2={padL + w} y2={Y(t.value)}
                stroke="var(--forge-rail-edge)" strokeDasharray="2 3" opacity={0.4} />
          <text x={padL - 4} y={Y(t.value) + 3} fontSize={9}
                fill="var(--forge-ink-mute)" textAnchor="end"
                fontFamily="var(--forge-mono)">{t.label}</text>
        </g>
      ))}
      {trace.series.map((s, k) => {
        if (s.visible === false) return null;
        let d = '';
        for (let i = 0; i < xs.length; ++i) {
          d += `${i === 0 ? 'M' : 'L'} ${X(xs[i]).toFixed(1)} ${Y(s.y[i]).toFixed(1)} `;
        }
        return <path key={k} d={d} fill="none" stroke={s.color} strokeWidth={1.4} />;
      })}
      {cursorX != null && cursorIdx >= 0 && (
        <line x1={X(xs[cursorIdx])} y1={padT}
              x2={X(xs[cursorIdx])} y2={padT + h}
              stroke="var(--forge-accent)" strokeDasharray="2 3" />
      )}
      <text x={padL + w / 2} y={height - 6} fontSize={10}
            textAnchor="middle" fill="var(--forge-ink-mute)"
            fontFamily="var(--forge-mono)">{trace.xLabel}</text>
    </svg>
  );
}

export function TimeSeriesViewerWorkbenchPanel({ open, onClose }) {
  const [demoIdx, setDemoIdx] = React.useState(0);
  const [trace, setTrace] = React.useState(() => DEMOS[0].build());
  const [cursorX, setCursorX] = React.useState(null);
  const [status, setStatus] = React.useState({ kind: 'idle', text: 'idle' });
  const [yAxisOverride, setYAxisOverride] = React.useState(null);

  const loadDemo = React.useCallback((idx) => {
    setDemoIdx(idx);
    const t = DEMOS[idx].build();
    const tWithVis = { ...t, series: t.series.map((s) => ({ ...s, visible: true })) };
    setTrace(tWithVis);
    setStatus({ kind: 'ok',
      text: `${DEMOS[idx].label} · ${tWithVis.xs.length} samples · ${tWithVis.series.length} series · axis ${tWithVis.yAxis}` });
  }, []);

  React.useEffect(() => { if (open) loadDemo(demoIdx); }, [open]);

  const toggleSeries = React.useCallback((idx) => {
    setTrace((t) => ({
      ...t,
      series: t.series.map((s, k) => k === idx ? { ...s, visible: !(s.visible !== false) } : s),
    }));
  }, []);

  const setAxis = React.useCallback((axis) => {
    setYAxisOverride(axis);
    setTrace((t) => ({ ...t, yAxis: axis }));
  }, []);

  if (!open) return null;

  const cursorIdx = (cursorX != null && trace)
    ? trace.xs.findIndex((v, i) => v >= cursorX || i === trace.xs.length - 1)
    : -1;

  return (
    <div style={panelStyle} data-testid="forge-tsv-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Time-series log viewer · FEA / CFD / acoustics</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-tsv-close">×</button>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 6 }}>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Demo trace</small>
          <select value={demoIdx}
                  onChange={(e) => loadDemo(parseInt(e.target.value) || 0)}
                  style={fieldInputStyle} data-testid="forge-tsv-demo">
            {DEMOS.map((d, i) => <option key={i} value={i}>{d.label}</option>)}
          </select>
        </label>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Y axis</small>
          <select value={trace?.yAxis || 'linear'} onChange={(e) => setAxis(e.target.value)}
                  style={fieldInputStyle} data-testid="forge-tsv-axis">
            <option value="linear">linear</option>
            <option value="log">log</option>
          </select>
        </label>
      </section>

      <section style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {trace && trace.series.map((s, i) => (
          <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input type="checkbox" checked={s.visible !== false}
                   onChange={() => toggleSeries(i)}
                   data-testid={`forge-tsv-series-${i}`} />
            <span style={{ color: s.color, fontWeight: 600 }}>■</span>
            <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
              {s.name}
            </span>
          </label>
        ))}
      </section>

      <LogChart trace={trace} cursorX={cursorX} onCursor={setCursorX} />

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        background: 'var(--forge-canvas)',
                        padding: 'var(--forge-space-2)',
                        borderRadius: 'var(--forge-radius)' }}
               data-testid="forge-tsv-result">
        <div>{status.text}</div>
        {cursorIdx >= 0 && trace && (
          <>
            <div style={{ marginTop: 4, color: 'var(--forge-accent)' }}>
              cursor @ {trace.xLabel} = {trace.xs[cursorIdx].toFixed(3)}
            </div>
            {trace.series.filter((s) => s.visible !== false).map((s, i) => (
              <div key={i} style={{ color: s.color }}>
                {s.name.padEnd(20, ' ')}  {s.y[cursorIdx].toExponential(3)}
              </div>
            ))}
          </>
        )}
      </section>
    </div>
  );
}

export function TimeSeriesViewerWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenTimeSeriesViewerWorkbench  = () => setOpen(true);
    window.__forgeCloseTimeSeriesViewerWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.tsviewer' || e?.detail?.id === 'workbench.tsviewer') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'tsviewer') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <TimeSeriesViewerWorkbenchPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default TimeSeriesViewerWorkbenchPanel;
