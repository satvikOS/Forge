// Forge-173 — Casting solidification workbench.
//
// Drives the native forge.casting.solidify kernel (enthalpy FDM with
// phase change) on a voxelised cavity. The UI lets the user pick an
// alloy preset (5 real handbook materials), set pour + ambient
// temperatures + wall heat transfer, choose the voxel grid + total
// simulation time, and run. The result viewer:
//   * 2D axis-aligned slice through the solidification-time field with
//     scrubbable axis + slice index;
//   * hot-spot count (cells that solidified last) + max Niyama porosity;
//   * cooling-curve probe panel — pick (i, j, k) and see T(t) at that
//     cell across all snapshots.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const ALLOY_PRESETS = [
  { name: 'A356-T6 (Al-Si)',  rho: 2685, cp: 963,  k: 151,  L: 389e3, Ts: 555, Tl: 615 },
  { name: 'AZ91 (Mg)',        rho: 1810, cp: 1050, k: 72,   L: 370e3, Ts: 470, Tl: 595 },
  { name: '304 stainless',    rho: 7900, cp: 500,  k: 16,   L: 273e3, Ts: 1399, Tl: 1454 },
  { name: 'Gray cast iron',   rho: 7200, cp: 460,  k: 53,   L: 220e3, Ts: 1150, Tl: 1200 },
  { name: 'Brass C36000',     rho: 8500, cp: 380,  k: 115,  L: 220e3, Ts: 885, Tl: 900 },
];

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 500, zIndex: 1310,
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

// Field-image renderer: paints a Nx×Ny solid-time slice as a heatmap.
function FieldSlice({ result, axis, sliceIdx, field, width = 460, height = 200 }) {
  if (!result) return <div style={{ color: 'var(--forge-ink-mute)' }}>no result</div>;
  const { Nx, Ny, Nz } = result;
  let W = 0, H = 0, get = null;
  if (axis === 'z') { W = Nx; H = Ny;
    get = (u, v) => (sliceIdx * Ny + v) * Nx + u; }
  else if (axis === 'y') { W = Nx; H = Nz;
    get = (u, v) => (v * Ny + sliceIdx) * Nx + u; }
  else { W = Ny; H = Nz;
    get = (u, v) => (v * Ny + u) * Nx + sliceIdx; }
  const data = field === 'solid'  ? result.solidTimeSec
             : field === 'peak'   ? result.peakTempK
             : field === 'niyama' ? result.niyama
             : result.solidTimeSec;
  // Compute range for colouring.
  let lo = +Infinity, hi = -Infinity;
  for (let v = 0; v < H; ++v) for (let u = 0; u < W; ++u) {
    const x = data[get(u, v)];
    if (x < 0) continue;
    if (x < lo) lo = x; if (x > hi) hi = x;
  }
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  if (hi - lo < 1e-9) hi = lo + 1;
  // Draw onto a canvas via direct PixelData rect grid.
  const cellW = Math.floor(width / W), cellH = Math.floor(height / H);
  const rects = [];
  for (let v = 0; v < H; ++v) {
    for (let u = 0; u < W; ++u) {
      const x = data[get(u, v)];
      if (x < 0 || !isFinite(x)) continue;
      const t = (x - lo) / (hi - lo);
      // Copper → blue gradient: hot (high) = #d97a3b copper, cool = #56a8d4 blue.
      const r = Math.round(217 * t + 86 * (1 - t));
      const g = Math.round(122 * t + 168 * (1 - t));
      const b = Math.round(59  * t + 212 * (1 - t));
      rects.push(
        <rect key={`${u}-${v}`} x={u * cellW} y={(H - 1 - v) * cellH}
              width={cellW} height={cellH}
              fill={`rgb(${r},${g},${b})`} />
      );
    }
  }
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-casting-slice">
      {rects}
      <text x={4} y={14} fontSize={10}
            fill="rgba(255,255,255,0.85)" fontFamily="var(--forge-mono)">
        axis {axis} slice {sliceIdx} · {field} · range {lo.toFixed(2)} → {hi.toFixed(2)}
      </text>
    </svg>
  );
}

// Cooling curve at a probe cell.
function CoolingCurveSVG({ result, ii, jj, kk, width = 460, height = 110 }) {
  if (!result || !result.snapshotTimesSec.length) return null;
  const { Nx, Ny } = result;
  const cIdx = (kk * Ny + jj) * Nx + ii;
  const xs = result.snapshotTimesSec;
  const ys = result.tempSnapshots.map((snap) => snap[cIdx]);
  const padL = 32, padR = 6, padT = 8, padB = 18;
  const w = width - padL - padR, h = height - padT - padB;
  const xMin = 0, xMax = xs[xs.length - 1];
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const X = (v) => padL + (v / xMax) * w;
  const Y = (v) => padT + h - ((v - yMin) / (yMax - yMin || 1)) * h;
  const d = xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${X(x).toFixed(1)} ${Y(ys[i]).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-casting-cooling-curve">
      <path d={d} fill="none" stroke="var(--forge-accent)" strokeWidth={1.3} />
      <text x={4} y={padT + 8} fontSize={10}
            fill="var(--forge-ink-mute)" fontFamily="var(--forge-mono)">
        T(t) at ({ii},{jj},{kk})  ·  {yMin.toFixed(0)}→{yMax.toFixed(0)} K  ·  {xMax.toFixed(1)} s
      </text>
    </svg>
  );
}

function buildBoxMask(Nx, Ny, Nz) {
  // Demo: full-cavity solid box; users would replace with a voxelisation
  // of a real body in a future slice.
  return new Uint8Array(Nx * Ny * Nz).fill(1);
}

function buildTBracketMask(Nx, Ny, Nz) {
  // Simple T-junction demo: thick horizontal bar at the bottom + thin
  // vertical web at the centre. Shows asymmetric solidification patterns.
  const m = new Uint8Array(Nx * Ny * Nz);
  for (let k = 0; k < Nz; ++k) {
    for (let j = 0; j < Ny; ++j) {
      for (let i = 0; i < Nx; ++i) {
        const inBar = (k < Math.max(1, Math.floor(Nz / 3)));
        const inWeb = !inBar
          && Math.abs(i - Math.floor(Nx / 2)) <= 1
          && Math.abs(j - Math.floor(Ny / 2)) <= Math.max(1, Math.floor(Ny / 4));
        if (inBar || inWeb) m[(k * Ny + j) * Nx + i] = 1;
      }
    }
  }
  return m;
}

export function CastingWorkbenchPanel({ open, onClose, viewOverride }) {
  const [alloyIdx, setAlloyIdx] = React.useState(0);
  const [pourC, setPourC]       = React.useState(700);
  const [ambientC, setAmbientC] = React.useState(25);
  const [hWall, setHWall]       = React.useState(2000);
  const [Nx, setNx] = React.useState(16);
  const [Ny, setNy] = React.useState(8);
  const [Nz, setNz] = React.useState(8);
  const [endSec, setEndSec] = React.useState(20);
  const [maskKind, setMaskKind] = React.useState('box');
  const [field, setField] = React.useState('solid');  // solid | peak | niyama
  const [axis, setAxis] = React.useState('z');
  const [sliceIdx, setSliceIdx] = React.useState(0);
  const [snapIdx, setSnapIdx] = React.useState(0);
  const [probe, setProbe] = React.useState({ i: 0, j: 0, k: 0 });
  const [status, setStatus] = React.useState({ kind: 'idle', text: 'idle' });
  const [result, setResult] = React.useState(null);

  React.useEffect(() => { if (viewOverride) {
    if (viewOverride.field !== undefined) setField(viewOverride.field);
    if (viewOverride.axis !== undefined) setAxis(viewOverride.axis);
    if (viewOverride.sliceIdx !== undefined) setSliceIdx(viewOverride.sliceIdx);
  } }, [viewOverride]);

  const alloy = ALLOY_PRESETS[alloyIdx];

  const onRun = React.useCallback(() => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.casting || typeof f.casting.solidify !== 'function') {
      setStatus({ kind: 'err', text: 'forge.casting kernel not available' });
      return;
    }
    try {
      setStatus({ kind: 'pending', text: 'running enthalpy FDM…' });
      const mask = maskKind === 't-bracket'
        ? buildTBracketMask(Nx, Ny, Nz)
        : buildBoxMask(Nx, Ny, Nz);
      const cfg = {
        minX: 0, minY: 0, minZ: 0,
        maxX: 0.016, maxY: 0.008, maxZ: 0.008,
        Nx, Ny, Nz,
        Tpour: pourC + 273.15,
        TambientK: ambientC + 273.15,
        hWall,
        alloy: {
          rho: alloy.rho, cp: alloy.cp, k: alloy.k, L: alloy.L,
          Tsolidus: alloy.Ts + 273.15, Tliquidus: alloy.Tl + 273.15,
        },
        endTimeSec: endSec,
        cflFactor: 0.4,
        sampleEvery: 25,
        cavityMask: mask,
      };
      const t0 = performance.now();
      const r = f.casting.solidify(cfg);
      const elapsedMs = performance.now() - t0;
      setResult(r);
      setSliceIdx(Math.floor(({ x: Nx, y: Ny, z: Nz })[axis] / 2));
      setSnapIdx(r.snapshotTimesSec.length - 1);
      setProbe({ i: Nx >> 1, j: Ny >> 1, k: Nz >> 1 });
      setStatus({ kind: 'ok',
        text: `solidified ${r.cellsSolidified}/${r.cellsSimulated} cells  ·  ` +
              `max t_solid ${r.maxSolidTimeSec.toFixed(2)} s  ·  ${elapsedMs.toFixed(0)} ms` });
    } catch (e) {
      setStatus({ kind: 'err', text: e.message });
    }
  }, [alloy, pourC, ambientC, hWall, Nx, Ny, Nz, endSec, maskKind, axis]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-casting-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Casting · solidification (enthalpy FDM)</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-casting-close">×</button>
      </header>

      <section>
        <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      marginBottom: 4 }}>Alloy</div>
        <select value={alloyIdx}
                onChange={(e) => setAlloyIdx(parseInt(e.target.value) || 0)}
                style={fieldInputStyle}
                data-testid="forge-casting-alloy">
          {ALLOY_PRESETS.map((p, i) =>
            <option key={i} value={i}>{p.name}  ρ={p.rho} cp={p.cp} k={p.k}  Ts/Tl={p.Ts}/{p.Tl}°C</option>)}
        </select>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        {[
          { label: 'T_pour [°C]', val: pourC,    set: setPourC,   t: 'forge-casting-tpour' },
          { label: 'T_amb  [°C]', val: ambientC, set: setAmbientC,t: 'forge-casting-tamb'  },
          { label: 'h_wall W/m²K',val: hWall,    set: setHWall,   t: 'forge-casting-hwall' },
          { label: 'Nx',          val: Nx, set: setNx, t: 'forge-casting-nx' },
          { label: 'Ny',          val: Ny, set: setNy, t: 'forge-casting-ny' },
          { label: 'Nz',          val: Nz, set: setNz, t: 'forge-casting-nz' },
          { label: 'end [s]',     val: endSec, set: setEndSec, t: 'forge-casting-end' },
        ].map((f) => (
          <label key={f.label}>
            <small style={{ color: 'var(--forge-ink-mute)' }}>{f.label}</small>
            <input type="number" value={f.val} step={f.label.includes('h_wall') ? 100 : 1}
                   onChange={(e) => f.set(parseFloat(e.target.value) || 0)}
                   style={fieldInputStyle} data-testid={f.t} />
          </label>
        ))}
      </section>

      <section style={{ display: 'flex', gap: 6 }}>
        <label style={{ flex: 1 }}>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Cavity</small>
          <select value={maskKind} onChange={(e) => setMaskKind(e.target.value)}
                  style={fieldInputStyle} data-testid="forge-casting-mask">
            <option value="box">Box (full cavity)</option>
            <option value="t-bracket">T-bracket demo</option>
          </select>
        </label>
      </section>

      <button onClick={onRun}
              style={{ background: 'var(--forge-accent)', border: 'none',
                       color: '#0a0e14', padding: '8px 12px', cursor: 'pointer',
                       fontWeight: 600, fontFamily: 'var(--forge-mono)' }}
              data-testid="forge-casting-run">
        Run solidification
      </button>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        color: status.kind === 'err' ? 'var(--forge-bad, #ff6363)'
                             : status.kind === 'ok'  ? 'var(--forge-ok, #4ec18b)'
                             : 'var(--forge-ink-mute)' }}
               data-testid="forge-casting-status">
        {status.text}
      </section>

      {result && (
        <>
          <section style={{ display: 'flex', gap: 4 }}>
            <select value={field} onChange={(e) => setField(e.target.value)}
                    style={fieldInputStyle} data-testid="forge-casting-field">
              <option value="solid">Solidification time</option>
              <option value="peak">Peak temperature</option>
              <option value="niyama">Niyama porosity</option>
            </select>
            <select value={axis} onChange={(e) => setAxis(e.target.value)}
                    style={fieldInputStyle} data-testid="forge-casting-axis">
              <option value="x">x-slice</option>
              <option value="y">y-slice</option>
              <option value="z">z-slice</option>
            </select>
            <input type="number" value={sliceIdx}
                   min={0} max={({ x: result.Nx, y: result.Ny, z: result.Nz })[axis] - 1}
                   onChange={(e) => setSliceIdx(parseInt(e.target.value) || 0)}
                   style={fieldInputStyle} data-testid="forge-casting-slice-idx" />
          </section>

          <FieldSlice result={result} axis={axis} sliceIdx={sliceIdx} field={field} />

          <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
            {['i', 'j', 'k'].map((axisName) => (
              <label key={axisName}>
                <small style={{ color: 'var(--forge-ink-mute)' }}>probe {axisName}</small>
                <input type="number" value={probe[axisName]}
                       min={0} max={({ i: result.Nx, j: result.Ny, k: result.Nz })[axisName] - 1}
                       onChange={(e) => setProbe({ ...probe, [axisName]: parseInt(e.target.value) || 0 })}
                       style={fieldInputStyle}
                       data-testid={`forge-casting-probe-${axisName}`} />
              </label>
            ))}
          </section>

          <CoolingCurveSVG result={result} ii={probe.i} jj={probe.j} kk={probe.k} />

          <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                            background: 'var(--forge-canvas)',
                            padding: 'var(--forge-space-2)',
                            borderRadius: 'var(--forge-radius)' }}
                   data-testid="forge-casting-result">
            <div>Cells solidified  {result.cellsSolidified} / {result.cellsSimulated}</div>
            <div>Max t_solid       {result.maxSolidTimeSec.toFixed(3)} s</div>
            <div>Avg t_solid       {result.avgSolidTimeSec.toFixed(3)} s</div>
            <div>Snapshots         {result.snapshotTimesSec.length}</div>
          </section>
        </>
      )}
    </div>
  );
}

export function CastingWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  const [viewOverride, setViewOverride] = React.useState(null);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenCastingWorkbench  = () => setOpen(true);
    window.__forgeCloseCastingWorkbench = () => setOpen(false);
    window.__forgeCastingView = (v) => setViewOverride({ ...(v || {}) });
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.casting' || e?.detail?.id === 'workbench.casting') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'casting') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <CastingWorkbenchPanel open={open} onClose={() => setOpen(false)}
                           viewOverride={viewOverride} />,
    document.body,
  );
}

export default CastingWorkbenchPanel;
