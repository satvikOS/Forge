// Forge-172 — Injection mould flow analysis workbench.
//
// Drives the native forge.mold.heleShawFill kernel on a triangulated
// cavity shell with Cross-WLF non-Newtonian viscosity. UI lets the user
// pick a polymer preset (5 real Hieber-Shen materials), build a demo
// cavity (disc / rectangular plate / star), set gate position + flow
// rate + temperatures, and run.
//
// Result viewer: 2D shaded-triangle heatmap of fill-time / peak pressure
// / fill fraction; weld-line + air-trap markers overlaid; metric card.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const POLY_PRESETS = [
  { name: 'ABS',     n: 0.30, tauStar: 1.50e5, D1: 3.0e8,  A1: 28.0, A2: 51.6, Tg: 373.0 },
  { name: 'PP',      n: 0.30, tauStar: 2.50e4, D1: 1.5e10, A1: 27.0, A2: 51.6, Tg: 263.0 },
  { name: 'PC',      n: 0.34, tauStar: 9.00e4, D1: 5.0e8,  A1: 28.0, A2: 51.6, Tg: 423.0 },
  { name: 'PA66',    n: 0.32, tauStar: 8.50e4, D1: 6.5e9,  A1: 21.0, A2: 51.6, Tg: 318.0 },
  { name: 'PMMA',    n: 0.27, tauStar: 5.00e4, D1: 8.5e8,  A1: 27.0, A2: 51.6, Tg: 378.0 },
];

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 520, zIndex: 1310,
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

// Build a triangulated disc with the gate at the centre.
function buildDiscMesh(R, nRings, nSectors) {
  const verts = [0, 0, 0];
  for (let r = 1; r <= nRings; ++r) {
    const rr = R * r / nRings;
    for (let s = 0; s < nSectors; ++s) {
      const a = (2 * Math.PI * s) / nSectors;
      verts.push(rr * Math.cos(a), rr * Math.sin(a), 0);
    }
  }
  const tris = [];
  for (let s = 0; s < nSectors; ++s) {
    const a = 1 + s, b = 1 + ((s + 1) % nSectors);
    tris.push(0, a, b);
  }
  for (let r = 0; r < nRings - 1; ++r) {
    const base0 = 1 + r * nSectors;
    const base1 = 1 + (r + 1) * nSectors;
    for (let s = 0; s < nSectors; ++s) {
      const a = base0 + s;
      const b = base0 + ((s + 1) % nSectors);
      const c = base1 + s;
      const d = base1 + ((s + 1) % nSectors);
      tris.push(a, b, d);
      tris.push(a, d, c);
    }
  }
  return {
    vertices: new Float64Array(verts),
    triangles: new Uint32Array(tris),
    nTri: tris.length / 3,
  };
}

// Build a flat plate (Lx × Ly) with the gate at one corner.
function buildPlateMesh(Lx, Ly, Nx, Ny) {
  const verts = [];
  for (let j = 0; j <= Ny; ++j) {
    for (let i = 0; i <= Nx; ++i) {
      verts.push(i * Lx / Nx, j * Ly / Ny, 0);
    }
  }
  const tris = [];
  const at = (i, j) => j * (Nx + 1) + i;
  for (let j = 0; j < Ny; ++j) {
    for (let i = 0; i < Nx; ++i) {
      tris.push(at(i,j), at(i+1,j), at(i+1,j+1));
      tris.push(at(i,j), at(i+1,j+1), at(i,j+1));
    }
  }
  return {
    vertices: new Float64Array(verts),
    triangles: new Uint32Array(tris),
    nTri: tris.length / 3,
  };
}

// Shade-by-field heatmap of the cavity.
function CavityHeatmap({ mesh, field, weldList, airList, width = 480, height = 280 }) {
  if (!mesh || !mesh.vertices) return null;
  const pad = 8;
  let xMin = +Infinity, xMax = -Infinity, yMin = +Infinity, yMax = -Infinity;
  for (let i = 0; i < mesh.vertices.length / 3; ++i) {
    const x = mesh.vertices[3*i], y = mesh.vertices[3*i+1];
    if (x < xMin) xMin = x; if (x > xMax) xMax = x;
    if (y < yMin) yMin = y; if (y > yMax) yMax = y;
  }
  const xR = Math.max(1e-6, xMax - xMin);
  const yR = Math.max(1e-6, yMax - yMin);
  const sx = (width - 2 * pad) / xR;
  const sy = (height - 2 * pad) / yR;
  const s = Math.min(sx, sy);
  const X = (x) => pad + (x - xMin) * s;
  const Y = (y) => height - pad - (y - yMin) * s;
  // Field range.
  let lo = +Infinity, hi = -Infinity;
  for (const v of field) {
    if (v < 0 || !isFinite(v)) continue;
    if (v < lo) lo = v; if (v > hi) hi = v;
  }
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  if (hi - lo < 1e-12) hi = lo + 1;
  const tris = [];
  for (let t = 0; t < mesh.nTri; ++t) {
    const i0 = mesh.triangles[3*t+0];
    const i1 = mesh.triangles[3*t+1];
    const i2 = mesh.triangles[3*t+2];
    const x0 = mesh.vertices[3*i0],     y0 = mesh.vertices[3*i0+1];
    const x1 = mesh.vertices[3*i1],     y1 = mesh.vertices[3*i1+1];
    const x2 = mesh.vertices[3*i2],     y2 = mesh.vertices[3*i2+1];
    const v = field[t];
    const fn = isFinite(v) && v >= 0 ? (v - lo) / (hi - lo) : 0;
    const r = Math.round(217 * fn + 30 * (1 - fn));
    const g = Math.round(122 * fn + 75 * (1 - fn));
    const b = Math.round(59  * fn + 110 * (1 - fn));
    tris.push(
      <polygon key={t}
               points={`${X(x0)},${Y(y0)} ${X(x1)},${Y(y1)} ${X(x2)},${Y(y2)}`}
               fill={`rgb(${r},${g},${b})`}
               stroke="rgba(0,0,0,0.1)" strokeWidth={0.3} />
    );
  }
  const overlays = [];
  for (const tId of weldList || []) {
    const i0 = mesh.triangles[3*tId+0];
    const i1 = mesh.triangles[3*tId+1];
    const i2 = mesh.triangles[3*tId+2];
    const cx = (mesh.vertices[3*i0] + mesh.vertices[3*i1] + mesh.vertices[3*i2]) / 3;
    const cy = (mesh.vertices[3*i0+1] + mesh.vertices[3*i1+1] + mesh.vertices[3*i2+1]) / 3;
    overlays.push(
      <circle key={`weld-${tId}`} cx={X(cx)} cy={Y(cy)} r={1.6}
              fill="#ffd966" stroke="#000" strokeWidth={0.3} />);
  }
  for (const tId of airList || []) {
    const i0 = mesh.triangles[3*tId+0];
    const i1 = mesh.triangles[3*tId+1];
    const i2 = mesh.triangles[3*tId+2];
    const cx = (mesh.vertices[3*i0] + mesh.vertices[3*i1] + mesh.vertices[3*i2]) / 3;
    const cy = (mesh.vertices[3*i0+1] + mesh.vertices[3*i1+1] + mesh.vertices[3*i2+1]) / 3;
    overlays.push(
      <rect key={`air-${tId}`} x={X(cx)-2} y={Y(cy)-2} width={4} height={4}
            fill="#ff6363" stroke="#000" strokeWidth={0.3} />);
  }
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-mold-cavity">
      {tris}
      {overlays}
      <text x={4} y={14} fontSize={10}
            fill="rgba(255,255,255,0.85)" fontFamily="var(--forge-mono)">
        range {lo.toFixed(2)} → {hi.toFixed(2)}  ·  weld {weldList?.length || 0}  ·  air-trap {airList?.length || 0}
      </text>
    </svg>
  );
}

export function MoldFlowWorkbenchPanel({ open, onClose, viewOverride }) {
  const [polymerIdx, setPolymerIdx] = React.useState(0);
  const [cavityKind, setCavityKind] = React.useState('disc');
  const [thicknessMm, setThicknessMm] = React.useState(2);
  const [flowRateCm3s, setFlowRateCm3s] = React.useState(5);
  const [meltC, setMeltC] = React.useState(240);
  const [moldC, setMoldC] = React.useState(60);
  const [maxTimeSec, setMaxTimeSec] = React.useState(60);
  const [field, setField] = React.useState('fill');   // fill | pressure | fraction
  const [status, setStatus] = React.useState({ kind: 'idle', text: 'idle' });
  const [result, setResult] = React.useState(null);
  const [mesh, setMesh] = React.useState(null);

  React.useEffect(() => {
    if (viewOverride && viewOverride.field !== undefined) setField(viewOverride.field);
  }, [viewOverride]);

  // Build mesh once cavity kind changes.
  React.useEffect(() => {
    const m = cavityKind === 'plate'
      ? buildPlateMesh(0.08, 0.04, 16, 8)
      : buildDiscMesh(0.040, 6, 16);
    m.thickness = new Float64Array(m.nTri).fill(thicknessMm / 1000);
    setMesh(m);
  }, [cavityKind, thicknessMm]);

  const onRun = React.useCallback(() => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.mold || typeof f.mold.heleShawFill !== 'function') {
      setStatus({ kind: 'err', text: 'forge.mold kernel not available' });
      return;
    }
    if (!mesh) return;
    try {
      setStatus({ kind: 'pending', text: 'running Hele-Shaw fill…' });
      const mat = POLY_PRESETS[polymerIdx];
      const gate = cavityKind === 'plate'
        ? { x: 0.005, y: 0.020, z: 0,
            flowRateM3s: flowRateCm3s * 1e-6, meltTempK: meltC + 273.15 }
        : { x: 0, y: 0, z: 0,
            flowRateM3s: flowRateCm3s * 1e-6, meltTempK: meltC + 273.15 };
      const t0 = performance.now();
      const r = f.mold.heleShawFill(
        { vertices: mesh.vertices, triangles: mesh.triangles, thickness: mesh.thickness },
        gate, mat, moldC + 273.15, maxTimeSec, 800);
      const elapsedMs = performance.now() - t0;
      setResult(r);
      setStatus({ kind: 'ok',
        text: `total fill ${r.totalFillTimeSec.toFixed(2)} s · peak P ${(r.maxPressurePa/1e6).toFixed(2)} MPa · ` +
              `welds ${r.weldLineTriangles.length} · ${r.stepsTaken} steps · ${elapsedMs.toFixed(0)} ms` });
    } catch (e) {
      setStatus({ kind: 'err', text: e.message });
    }
  }, [mesh, cavityKind, polymerIdx, flowRateCm3s, meltC, moldC, maxTimeSec]);

  if (!open) return null;

  // Field display
  const fieldData = result
    ? (field === 'fill' ? result.fillTimeSec
       : field === 'pressure' ? result.peakPressurePa
       : result.filledFraction)
    : (mesh ? new Float64Array(mesh.nTri) : null);

  return (
    <div style={panelStyle} data-testid="forge-mold-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Mold flow · Hele-Shaw + Cross-WLF</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-mold-close">×</button>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Polymer</small>
          <select value={polymerIdx}
                  onChange={(e) => setPolymerIdx(parseInt(e.target.value) || 0)}
                  style={fieldInputStyle} data-testid="forge-mold-polymer">
            {POLY_PRESETS.map((p, i) =>
              <option key={i} value={i}>{p.name}  n={p.n}  Tg={p.Tg-273.15}°C</option>)}
          </select>
        </label>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Cavity</small>
          <select value={cavityKind}
                  onChange={(e) => setCavityKind(e.target.value)}
                  style={fieldInputStyle} data-testid="forge-mold-cavity-kind">
            <option value="disc">Disc (centre gate)</option>
            <option value="plate">Plate (corner gate)</option>
          </select>
        </label>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        {[
          { label: 'Thickness [mm]', val: thicknessMm,    set: setThicknessMm,   t: 'forge-mold-thick', step: 0.1 },
          { label: 'Flow [cm³/s]',   val: flowRateCm3s,   set: setFlowRateCm3s,  t: 'forge-mold-flow',  step: 0.5 },
          { label: 'Melt T [°C]',    val: meltC,          set: setMeltC,         t: 'forge-mold-melt',  step: 5   },
          { label: 'Mold T [°C]',    val: moldC,          set: setMoldC,         t: 'forge-mold-mold',  step: 5   },
          { label: 'Max time [s]',   val: maxTimeSec,     set: setMaxTimeSec,    t: 'forge-mold-tmax',  step: 5   },
        ].map((f) => (
          <label key={f.label}>
            <small style={{ color: 'var(--forge-ink-mute)' }}>{f.label}</small>
            <input type="number" value={f.val} step={f.step}
                   onChange={(e) => f.set(parseFloat(e.target.value) || 0)}
                   style={fieldInputStyle} data-testid={f.t} />
          </label>
        ))}
      </section>

      <button onClick={onRun}
              style={{ background: 'var(--forge-accent)', border: 'none',
                       color: '#0a0e14', padding: '8px 12px', cursor: 'pointer',
                       fontWeight: 600, fontFamily: 'var(--forge-mono)' }}
              data-testid="forge-mold-run">
        Run mould flow
      </button>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        color: status.kind === 'err' ? 'var(--forge-bad, #ff6363)'
                             : status.kind === 'ok'  ? 'var(--forge-ok, #4ec18b)'
                             : 'var(--forge-ink-mute)' }}
               data-testid="forge-mold-status">
        {status.text}
      </section>

      {result && (
        <section style={{ display: 'flex', gap: 4 }}>
          <select value={field} onChange={(e) => setField(e.target.value)}
                  style={fieldInputStyle} data-testid="forge-mold-field">
            <option value="fill">Fill time</option>
            <option value="pressure">Peak pressure</option>
            <option value="fraction">Filled fraction</option>
          </select>
        </section>
      )}

      {mesh && fieldData && (
        <CavityHeatmap mesh={mesh} field={fieldData}
                       weldList={result ? result.weldLineTriangles : []}
                       airList={result ? result.airTrapTriangles : []} />
      )}

      {result && (
        <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                          background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)' }}
                 data-testid="forge-mold-result">
          <div>Total fill time   {result.totalFillTimeSec.toFixed(3)} s</div>
          <div>Peak pressure     {(result.maxPressurePa/1e6).toFixed(3)} MPa</div>
          <div>Steps             {result.stepsTaken}{result.converged ? ' (converged)' : ''}</div>
          <div>Weld lines        {result.weldLineTriangles.length} tris</div>
          <div>Air traps         {result.airTrapTriangles.length} tris</div>
        </section>
      )}
    </div>
  );
}

export function MoldFlowWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  const [viewOverride, setViewOverride] = React.useState(null);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenMoldFlowWorkbench  = () => setOpen(true);
    window.__forgeCloseMoldFlowWorkbench = () => setOpen(false);
    window.__forgeMoldFlowView = (v) => setViewOverride({ ...(v || {}) });
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.moldflow' || e?.detail?.id === 'workbench.moldflow') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'moldflow') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <MoldFlowWorkbenchPanel open={open} onClose={() => setOpen(false)}
                            viewOverride={viewOverride} />,
    document.body,
  );
}

export default MoldFlowWorkbenchPanel;
