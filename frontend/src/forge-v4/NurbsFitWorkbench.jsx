// Forge-194 — NURBS surface-fit workbench.
//
// Reverse-engineers a B-spline tensor-product surface from a point
// cloud. Workbench: pick a survey (same 4 built-ins as the terrain
// workbench), choose uCount × vCount control-net dimensions, fit; the
// SVG colours each input point by |residual| so high-error regions are
// obvious. Result card reports RMS + max-abs residuals + sample count.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

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
  padding: '4px 6px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function buildHill(N = 12) {
  const pts = [];
  for (let j = 0; j < N; ++j) {
    for (let i = 0; i < N; ++i) {
      const x = i / (N - 1) * 8 - 4;
      const y = j / (N - 1) * 8 - 4;
      const z = 3 * Math.exp(-(x * x + y * y) / 8);
      pts.push(x, y, z);
    }
  }
  return { label: 'Gaussian hill', points: new Float64Array(pts) };
}
function buildRidge(N = 12) {
  const pts = [];
  for (let j = 0; j < N; ++j) {
    for (let i = 0; i < N; ++i) {
      const x = i / (N - 1) * 8;
      const y = j / (N - 1) * 8;
      const z = 4 * Math.sin(x * 0.4);
      pts.push(x, y, z);
    }
  }
  return { label: 'Sine ridge', points: new Float64Array(pts) };
}
function buildSaddle(N = 12) {
  const pts = [];
  for (let j = 0; j < N; ++j) {
    for (let i = 0; i < N; ++i) {
      const x = i / (N - 1) * 8 - 4;
      const y = j / (N - 1) * 8 - 4;
      const z = (x * x - y * y) * 0.2;
      pts.push(x, y, z);
    }
  }
  return { label: 'Saddle (x² − y²)', points: new Float64Array(pts) };
}
function buildScatter(N = 60) {
  const pts = [];
  let seed = 21;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                      return (seed % 1000) / 1000; };
  for (let i = 0; i < N; ++i) {
    const x = rnd() * 8;
    const y = rnd() * 8;
    const z = 1 + 2 * Math.sin(x * 0.4) * Math.cos(y * 0.4) + 0.5 * (rnd() - 0.5);
    pts.push(x, y, z);
  }
  return { label: 'Noisy scatter', points: new Float64Array(pts) };
}

const SURVEYS = [buildHill(12), buildRidge(12), buildSaddle(12), buildScatter(60)];

function ResidualScatter({ points, residuals, width = 500, height = 280 }) {
  if (!points || !residuals) return null;
  const pad = 16;
  const N = points.length / 3;
  let xLo = +Infinity, xHi = -Infinity, yLo = +Infinity, yHi = -Infinity;
  let maxAbs = 0;
  for (let i = 0; i < N; ++i) {
    const x = points[3*i], y = points[3*i+1];
    if (x < xLo) xLo = x; if (x > xHi) xHi = x;
    if (y < yLo) yLo = y; if (y > yHi) yHi = y;
    if (Math.abs(residuals[i]) > maxAbs) maxAbs = Math.abs(residuals[i]);
  }
  const xR = Math.max(1e-9, xHi - xLo);
  const yR = Math.max(1e-9, yHi - yLo);
  const s = Math.min((width - 2 * pad) / xR, (height - 2 * pad) / yR);
  const X = (x) => pad + (x - xLo) * s;
  const Y = (y) => height - pad - (y - yLo) * s;
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-nurbsfit-svg">
      {Array.from({ length: N }, (_, i) => {
        const r = residuals[i];
        const t = Math.min(1, Math.abs(r) / Math.max(1e-6, maxAbs));
        // Cool-warm: blue (low residual) → red (high) via copper.
        const red = Math.round(80 + 175 * t);
        const grn = Math.round(168 * (1 - t) + 80 * t);
        const blu = Math.round(212 * (1 - t) + 30 * t);
        return (
          <circle key={i} cx={X(points[3*i])} cy={Y(points[3*i+1])}
                  r={2.5}
                  fill={`rgb(${red},${grn},${blu})`} />
        );
      })}
      <text x={4} y={14} fontSize={10}
            fill="rgba(255,255,255,0.85)" fontFamily="var(--forge-mono)">
        residual scatter · {N} pts · max |r| {maxAbs.toExponential(2)}
      </text>
    </svg>
  );
}

export function NurbsFitWorkbenchPanel({ open, onClose }) {
  const [surveyIdx, setSurveyIdx] = React.useState(0);
  const [uCount, setUCount] = React.useState(7);
  const [vCount, setVCount] = React.useState(7);
  const [result, setResult] = React.useState(null);
  const [status, setStatus] = React.useState({ kind: 'idle', text: 'idle' });

  const survey = SURVEYS[surveyIdx];

  const onRun = React.useCallback(() => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.nurbsfit) {
      setStatus({ kind: 'err', text: 'forge.nurbsfit unavailable' });
      return;
    }
    try {
      const t0 = performance.now();
      const r = f.nurbsfit.fitSurface({
        points: survey.points,
        uCount, vCount,
      });
      const ms = performance.now() - t0;
      setResult(r);
      setStatus({ kind: 'ok',
        text: `${survey.label} · ${uCount}×${vCount} CPs · ${r.samples} samples · RMS ${r.rmsResidual.toFixed(4)} m · max |r| ${r.maxAbsResidual.toFixed(3)} m · ${ms.toFixed(0)} ms` });
    } catch (e) {
      setStatus({ kind: 'err', text: e.message });
    }
  }, [surveyIdx, uCount, vCount, survey]);

  React.useEffect(() => { if (open) onRun(); }, [open, surveyIdx, uCount, vCount]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-nurbsfit-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>NURBS surface fit · cubic B-spline LSQ</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-nurbsfit-close">×</button>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: 4 }}>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Survey</small>
          <select value={surveyIdx}
                  onChange={(e) => setSurveyIdx(parseInt(e.target.value) || 0)}
                  style={fieldInputStyle} data-testid="forge-nurbsfit-survey">
            {SURVEYS.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
          </select>
        </label>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>uCount</small>
          <input type="number" value={uCount} min={4} step={1}
                 onChange={(e) => setUCount(parseInt(e.target.value) || 4)}
                 style={fieldInputStyle} data-testid="forge-nurbsfit-u" />
        </label>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>vCount</small>
          <input type="number" value={vCount} min={4} step={1}
                 onChange={(e) => setVCount(parseInt(e.target.value) || 4)}
                 style={fieldInputStyle} data-testid="forge-nurbsfit-v" />
        </label>
      </section>

      <button onClick={onRun}
              style={{ background: 'var(--forge-accent)', border: 'none',
                       color: '#0a0e14', padding: '8px 12px', cursor: 'pointer',
                       fontWeight: 600, fontFamily: 'var(--forge-mono)' }}
              data-testid="forge-nurbsfit-run">
        Fit NURBS surface
      </button>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        color: status.kind === 'err' ? 'var(--forge-bad, #ff6363)'
                             : status.kind === 'ok'  ? 'var(--forge-ok, #4ec18b)'
                             : 'var(--forge-ink-mute)' }}
               data-testid="forge-nurbsfit-status">
        {status.text}
      </section>

      {result && (
        <ResidualScatter points={survey.points} residuals={result.residuals} />
      )}

      {result && (
        <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                          background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)' }}
                 data-testid="forge-nurbsfit-result">
          <div>Control net    {result.uCount} × {result.vCount}  (= {result.controlZ.length} CPs)</div>
          <div>Samples        {result.samples}</div>
          <div>Bounds (x)     {result.xMin.toFixed(2)} .. {result.xMax.toFixed(2)} m</div>
          <div>Bounds (y)     {result.yMin.toFixed(2)} .. {result.yMax.toFixed(2)} m</div>
          <div>RMS residual   {result.rmsResidual.toFixed(5)} m</div>
          <div>Max |residual| {result.maxAbsResidual.toFixed(5)} m</div>
        </section>
      )}
    </div>
  );
}

export function NurbsFitWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenNurbsFitWorkbench  = () => setOpen(true);
    window.__forgeCloseNurbsFitWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.nurbsfit' || e?.detail?.id === 'workbench.nurbsfit') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'nurbsfit') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <NurbsFitWorkbenchPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default NurbsFitWorkbenchPanel;
