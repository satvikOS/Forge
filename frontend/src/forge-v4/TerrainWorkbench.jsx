// Forge-191 — Civil terrain workbench.
//
// User picks a built-in survey (or pastes XYZ tuples), the kernel
// Delaunay-triangulates the (x, y) projection and we colour the TIN by
// elevation. A design plane (z = a·x + b·y + c) drives the cut/fill
// volume; we paint each triangle red (cut) or blue (fill) depending on
// whether the existing TIN is above or below the design plane.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 560, zIndex: 1310,
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

// Built-in surveys: each is a {label, points: Float64Array(3N)} record.
function buildHill(N = 9, k = 0.05) {
  const pts = [];
  for (let j = 0; j < N; ++j) {
    for (let i = 0; i < N; ++i) {
      const x = i * 2;
      const y = j * 2;
      const z = 5 * Math.exp(-k * ((x - (N - 1)) * (x - (N - 1)) + (y - (N - 1)) * (y - (N - 1))));
      pts.push(x, y, z);
    }
  }
  return { label: 'Gaussian hill', points: new Float64Array(pts) };
}
function buildRidge(N = 9) {
  const pts = [];
  for (let j = 0; j < N; ++j) {
    for (let i = 0; i < N; ++i) {
      const x = i * 2;
      const y = j * 2;
      const z = 4 * Math.sin(x * 0.4);
      pts.push(x, y, z);
    }
  }
  return { label: 'Sine ridge', points: new Float64Array(pts) };
}
function buildPlateau(N = 9) {
  const pts = [];
  for (let j = 0; j < N; ++j) {
    for (let i = 0; i < N; ++i) {
      const x = i * 2;
      const y = j * 2;
      const cx = (N - 1), cy = (N - 1);
      const r = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy));
      const z = r < 5 ? 3.0 : Math.max(0, 3 - 0.4 * (r - 5));
      pts.push(x, y, z);
    }
  }
  return { label: 'Plateau', points: new Float64Array(pts) };
}
function buildScatter(N = 40) {
  const pts = [];
  let seed = 11;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed % 1000) / 1000; };
  for (let i = 0; i < N; ++i) {
    const x = rnd() * 16;
    const y = rnd() * 16;
    const z = 2 + 3 * rnd() + 0.5 * Math.sin(x * 0.3) * Math.cos(y * 0.3);
    pts.push(x, y, z);
  }
  return { label: 'Random scatter', points: new Float64Array(pts) };
}

const SURVEYS = [buildHill(9), buildRidge(9), buildPlateau(9), buildScatter(40)];

function TerrainSVG({ points, triangles, plane, mode, width = 500, height = 320 }) {
  if (!points || !triangles || !triangles.length) return null;
  const pad = 18;
  const N = points.length / 3;
  let xLo = +Infinity, xHi = -Infinity, yLo = +Infinity, yHi = -Infinity;
  let zLo = +Infinity, zHi = -Infinity;
  for (let i = 0; i < N; ++i) {
    const x = points[3*i], y = points[3*i+1], z = points[3*i+2];
    if (x < xLo) xLo = x; if (x > xHi) xHi = x;
    if (y < yLo) yLo = y; if (y > yHi) yHi = y;
    if (z < zLo) zLo = z; if (z > zHi) zHi = z;
  }
  const xR = Math.max(1e-9, xHi - xLo);
  const yR = Math.max(1e-9, yHi - yLo);
  const zR = Math.max(1e-9, zHi - zLo);
  const s = Math.min((width - 2 * pad) / xR, (height - 2 * pad) / yR);
  const X = (x) => pad + (x - xLo) * s;
  const Y = (y) => height - pad - (y - yLo) * s;
  const triEls = [];
  for (let t = 0; t < triangles.length / 3; ++t) {
    const i0 = triangles[3*t], i1 = triangles[3*t+1], i2 = triangles[3*t+2];
    const x0 = points[3*i0], y0 = points[3*i0+1], z0 = points[3*i0+2];
    const x1 = points[3*i1], y1 = points[3*i1+1], z1 = points[3*i1+2];
    const x2 = points[3*i2], y2 = points[3*i2+1], z2 = points[3*i2+2];
    const zMean = (z0 + z1 + z2) / 3;
    const dz0 = z0 - (plane.a * x0 + plane.b * y0 + plane.c);
    const dz1 = z1 - (plane.a * x1 + plane.b * y1 + plane.c);
    const dz2 = z2 - (plane.a * x2 + plane.b * y2 + plane.c);
    const dzMean = (dz0 + dz1 + dz2) / 3;
    let r, g, b;
    if (mode === 'cutfill') {
      // Red = cut, blue = fill, white = balanced
      if (dzMean > 0) {
        const t2 = Math.min(1, dzMean / Math.max(0.01, zR));
        r = 200 + 55 * t2; g = 122 * (1 - t2) + 50 * t2; b = 70 * (1 - t2) + 30 * t2;
      } else {
        const t2 = Math.min(1, -dzMean / Math.max(0.01, zR));
        r = 80 + 50 * (1 - t2); g = 120 * (1 - t2) + 80 * t2; b = 180 + 50 * t2;
      }
    } else {
      // Elevation colour map: low = blue, high = copper
      const t2 = (zMean - zLo) / zR;
      r = Math.round(217 * t2 + 86 * (1 - t2));
      g = Math.round(122 * t2 + 168 * (1 - t2));
      b = Math.round(59  * t2 + 212 * (1 - t2));
    }
    triEls.push(
      <polygon key={t}
               points={`${X(x0)},${Y(y0)} ${X(x1)},${Y(y1)} ${X(x2)},${Y(y2)}`}
               fill={`rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`}
               stroke="rgba(0,0,0,0.2)" strokeWidth={0.4} />
    );
  }
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-terrain-svg">
      {triEls}
      <text x={4} y={14} fontSize={10}
            fill="rgba(255,255,255,0.85)" fontFamily="var(--forge-mono)">
        TIN {triangles.length / 3} triangles · z {zLo.toFixed(1)}…{zHi.toFixed(1)} m · {mode}
      </text>
    </svg>
  );
}

export function TerrainWorkbenchPanel({ open, onClose }) {
  const [surveyIdx, setSurveyIdx] = React.useState(0);
  const [planeA, setPlaneA] = React.useState(0.0);
  const [planeB, setPlaneB] = React.useState(0.0);
  const [planeC, setPlaneC] = React.useState(2.0);
  const [mode, setMode] = React.useState('elevation');     // elevation | cutfill
  const [triangles, setTriangles] = React.useState(null);
  const [cutFill, setCutFill] = React.useState(null);
  const [status, setStatus] = React.useState({ kind: 'idle', text: 'idle' });

  const survey = SURVEYS[surveyIdx];

  const onRun = React.useCallback(() => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.terrain) {
      setStatus({ kind: 'err', text: 'forge.terrain unavailable' });
      return;
    }
    try {
      const t0 = performance.now();
      const dr = f.terrain.delaunay({ points: survey.points });
      const cf = f.terrain.cutFillVsPlane({
        points: survey.points,
        triangles: dr.triangles,
        a: planeA, b: planeB, c: planeC,
      });
      const ms = performance.now() - t0;
      setTriangles(dr.triangles);
      setCutFill(cf);
      setStatus({ kind: 'ok',
        text: `${survey.label} · ${dr.triangles.length / 3} tri · cut ${cf.cutVolume.toFixed(1)} m³ · fill ${cf.fillVolume.toFixed(1)} m³ · net ${cf.netVolume.toFixed(1)} m³ · ${ms.toFixed(0)} ms` });
    } catch (e) {
      setStatus({ kind: 'err', text: e.message });
    }
  }, [surveyIdx, planeA, planeB, planeC, survey]);

  React.useEffect(() => { if (open) onRun(); }, [open, surveyIdx, planeA, planeB, planeC]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-terrain-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Terrain · Delaunay TIN + cut/fill</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-terrain-close">×</button>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: '3fr 2fr', gap: 6 }}>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Survey</small>
          <select value={surveyIdx}
                  onChange={(e) => setSurveyIdx(parseInt(e.target.value) || 0)}
                  style={fieldInputStyle} data-testid="forge-terrain-survey">
            {SURVEYS.map((s, i) => <option key={i} value={i}>{s.label}</option>)}
          </select>
        </label>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Colour mode</small>
          <select value={mode} onChange={(e) => setMode(e.target.value)}
                  style={fieldInputStyle} data-testid="forge-terrain-mode">
            <option value="elevation">Elevation</option>
            <option value="cutfill">Cut/Fill vs plane</option>
          </select>
        </label>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        {[
          { l: 'plane a',  v: planeA, s: setPlaneA, t: 'forge-terrain-a', step: 0.05 },
          { l: 'plane b',  v: planeB, s: setPlaneB, t: 'forge-terrain-b', step: 0.05 },
          { l: 'plane c',  v: planeC, s: setPlaneC, t: 'forge-terrain-c', step: 0.25 },
        ].map((f) => (
          <label key={f.l}>
            <small style={{ color: 'var(--forge-ink-mute)' }}>{f.l}</small>
            <input type="number" value={f.v} step={f.step}
                   onChange={(e) => f.s(parseFloat(e.target.value) || 0)}
                   style={fieldInputStyle} data-testid={f.t} />
          </label>
        ))}
      </section>

      <button onClick={onRun}
              style={{ background: 'var(--forge-accent)', border: 'none',
                       color: '#0a0e14', padding: '8px 12px', cursor: 'pointer',
                       fontWeight: 600, fontFamily: 'var(--forge-mono)' }}
              data-testid="forge-terrain-run">
        Triangulate + cut/fill
      </button>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        color: status.kind === 'err' ? 'var(--forge-bad, #ff6363)'
                             : status.kind === 'ok'  ? 'var(--forge-ok, #4ec18b)'
                             : 'var(--forge-ink-mute)' }}
               data-testid="forge-terrain-status">
        {status.text}
      </section>

      {triangles && (
        <TerrainSVG points={survey.points} triangles={triangles}
                    plane={{ a: planeA, b: planeB, c: planeC }} mode={mode} />
      )}

      {cutFill && (
        <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                          background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)' }}
                 data-testid="forge-terrain-result">
          <div>TIN area      {cutFill.tinArea.toFixed(2)} m²</div>
          <div>Cut volume    {cutFill.cutVolume.toFixed(2)} m³</div>
          <div>Fill volume   {cutFill.fillVolume.toFixed(2)} m³</div>
          <div>Net volume    {cutFill.netVolume.toFixed(2)} m³</div>
        </section>
      )}
    </div>
  );
}

export function TerrainWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenTerrainWorkbench  = () => setOpen(true);
    window.__forgeCloseTerrainWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.terrain' || e?.detail?.id === 'workbench.terrain') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'terrain') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <TerrainWorkbenchPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default TerrainWorkbenchPanel;
