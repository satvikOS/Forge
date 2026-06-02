// Forge-174 — Welding distortion FEA workbench.
//
// Drives the native forge.welding.simulateWeld kernel (Goldak heat source
// + thermo-mechanical FEA with J2 plasticity). The UI lets the user pick
// a steel preset (4 industry-standard alloys), set torch power + travel
// speed + Goldak axes, define a straight weld bead on a default plate
// or a user-overridden geometry, and visualise the result as a 2D
// top-projection heatmap of peak HAZ temperature / Mises stress /
// displacement magnitude / equivalent plastic strain.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const STEEL_PRESETS = [
  { name: 'S235 mild', rho: 7850, cp: 470, k: 50, alpha: 1.2e-5,
    E: 210e9, nu: 0.30, sigmaY0: 235e6, Etan: 5e9 },
  { name: 'S355 mild', rho: 7850, cp: 470, k: 50, alpha: 1.2e-5,
    E: 210e9, nu: 0.30, sigmaY0: 355e6, Etan: 5e9 },
  { name: '304 SS',    rho: 8000, cp: 500, k: 16, alpha: 1.6e-5,
    E: 200e9, nu: 0.30, sigmaY0: 215e6, Etan: 4e9 },
  { name: 'AL 6061',   rho: 2700, cp: 900, k: 167, alpha: 2.4e-5,
    E:  69e9, nu: 0.33, sigmaY0: 275e6, Etan: 2e9 },
];

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

// Reuses the same hex→tet split as the smoke test.
function buildPlate(Lx, Ly, Lz, nx, ny, nz) {
  const nodes = [];
  for (let k = 0; k <= nz; ++k)
    for (let j = 0; j <= ny; ++j)
      for (let i = 0; i <= nx; ++i)
        nodes.push((i / nx) * Lx, (j / ny) * Ly, (k / nz) * Lz);
  const at = (i, j, k) => (k * (ny + 1) + j) * (nx + 1) + i;
  const tets = [];
  for (let k = 0; k < nz; ++k) {
    for (let j = 0; j < ny; ++j) {
      for (let i = 0; i < nx; ++i) {
        const n000 = at(i,   j,   k  );
        const n100 = at(i+1, j,   k  );
        const n010 = at(i,   j+1, k  );
        const n110 = at(i+1, j+1, k  );
        const n001 = at(i,   j,   k+1);
        const n101 = at(i+1, j,   k+1);
        const n011 = at(i,   j+1, k+1);
        const n111 = at(i+1, j+1, k+1);
        tets.push(n000, n100, n110, n111);
        tets.push(n000, n110, n010, n111);
        tets.push(n000, n010, n011, n111);
        tets.push(n000, n011, n001, n111);
        tets.push(n000, n001, n101, n111);
        tets.push(n000, n101, n100, n111);
      }
    }
  }
  return {
    nodes:  new Float64Array(nodes),
    tets:   new Uint32Array(tets),
    nx, ny, nz, Lx, Ly, Lz,
  };
}

function nodeIdx(nx, ny, i, j, k) {
  return (k * (ny + 1) + j) * (nx + 1) + i;
}

function FieldOverlay({ plate, field, perTet, width = 480, height = 220 }) {
  if (!plate || !field) return null;
  const pad = 12;
  const w = width - 2 * pad, h = height - 2 * pad;
  // Project nodes onto XY (top view) and tile cells.
  const sx = w / plate.Lx, sy = h / plate.Ly;
  const X = (xs) => pad + xs * sx;
  const Y = (ys) => pad + h - ys * sy;
  let lo = +Infinity, hi = -Infinity;
  for (const v of field) {
    if (!isFinite(v)) continue;
    if (v < lo) lo = v; if (v > hi) hi = v;
  }
  if (!isFinite(lo)) { lo = 0; hi = 1; }
  if (hi - lo < 1e-12) hi = lo + 1;
  // For top-view, average each XY cell's vertical column of nodes (k = 0..nz).
  const cells = [];
  for (let j = 0; j < plate.ny; ++j) {
    for (let i = 0; i < plate.nx; ++i) {
      let v = 0, n = 0;
      if (perTet) {
        // Field is per-tet — average the 6 tets touching this XY column.
        // 6 tets per hex, nx·ny·nz hexes total, hex index = i + nx·j + nx·ny·k.
        for (let k = 0; k < plate.nz; ++k) {
          const hexId = (k * plate.ny + j) * plate.nx + i;
          for (let s = 0; s < 6; ++s) { v += field[hexId * 6 + s]; ++n; }
        }
      } else {
        // Field is per-node — average 4 corner nodes at top face.
        const k = plate.nz;
        const ids = [
          nodeIdx(plate.nx, plate.ny, i,   j,   k),
          nodeIdx(plate.nx, plate.ny, i+1, j,   k),
          nodeIdx(plate.nx, plate.ny, i,   j+1, k),
          nodeIdx(plate.nx, plate.ny, i+1, j+1, k),
        ];
        for (const id of ids) { v += field[id]; ++n; }
      }
      v /= Math.max(1, n);
      const t = (v - lo) / (hi - lo);
      const r = Math.round(217 * t + 56 * (1 - t));
      const g = Math.round(122 * t + 75 * (1 - t));
      const b = Math.round(59  * t + 110 * (1 - t));
      cells.push(
        <rect key={`${i}-${j}`}
              x={X((i  ) * plate.Lx / plate.nx)}
              y={Y((j+1) * plate.Ly / plate.ny)}
              width={plate.Lx / plate.nx * sx}
              height={plate.Ly / plate.ny * sy}
              fill={`rgb(${r},${g},${b})`} />
      );
    }
  }
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-welding-field">
      {cells}
      <text x={4} y={14} fontSize={10}
            fill="rgba(255,255,255,0.85)" fontFamily="var(--forge-mono)">
        range  {lo.toExponential(2)} → {hi.toExponential(2)}
      </text>
    </svg>
  );
}

export function WeldingDistortionWorkbenchPanel({ open, onClose, viewOverride }) {
  const [steelIdx, setSteelIdx] = React.useState(0);
  const [Lx, setLx] = React.useState(60);   // mm
  const [Ly, setLy] = React.useState(20);
  const [Lz, setLz] = React.useState(4);
  const [voltsV, setVoltsV] = React.useState(25);
  const [currentA, setCurrentA] = React.useState(200);
  const [efficiency, setEfficiency] = React.useState(0.7);
  const [speedMmS, setSpeedMmS] = React.useState(5);
  const [field, setField] = React.useState('haz');   // haz | mises | disp | plastic
  const [status, setStatus] = React.useState({ kind: 'idle', text: 'idle' });
  const [result, setResult] = React.useState(null);
  const [plate, setPlate] = React.useState(null);

  React.useEffect(() => {
    if (viewOverride && viewOverride.field !== undefined) setField(viewOverride.field);
  }, [viewOverride]);

  // Build plate when geometry changes.
  React.useEffect(() => {
    setPlate(buildPlate(Lx / 1000, Ly / 1000, Lz / 1000, 12, 4, 2));
  }, [Lx, Ly, Lz]);

  const onRun = React.useCallback(() => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.welding || typeof f.welding.simulateWeld !== 'function') {
      setStatus({ kind: 'err', text: 'forge.welding kernel not available' });
      return;
    }
    if (!plate) return;
    try {
      setStatus({ kind: 'pending', text: 'thermal pass + mechanical solve…' });
      const mat = STEEL_PRESETS[steelIdx];
      const matFull = { ...mat, Tref: 293.15 };
      const power = voltsV * currentA * efficiency;
      const Lcentre = plate.Lx * 0.5;
      const xStart  = plate.Lx * 0.25;
      const src = {
        power,
        a: 0.004, b: 0.003, cf: 0.004, cr: 0.012,
        ff: 0.6, fr: 1.4,
        speed: speedMmS / 1000,
        pathXYZ: new Float64Array([
          xStart, plate.Ly / 2, plate.Lz,
          xStart + Lcentre, plate.Ly / 2, plate.Lz,
        ]),
      };
      // Fix the left edge (i = 0 column).
      const N = (plate.nx + 1) * (plate.ny + 1) * (plate.nz + 1);
      const fixed = new Uint8Array(3 * N);
      for (let k = 0; k <= plate.nz; ++k) {
        for (let j = 0; j <= plate.ny; ++j) {
          const id = (k * (plate.ny + 1) + j) * (plate.nx + 1) + 0;
          fixed[3 * id + 0] = 1; fixed[3 * id + 1] = 1; fixed[3 * id + 2] = 1;
        }
      }
      const meshArg = { nodes: plate.nodes, tets: plate.tets, fixedDof: fixed };
      const totalTimeSec = (Lcentre / src.speed) + 2.0;
      const t0 = performance.now();
      const r = f.welding.simulateWeld(meshArg, matFull, src, totalTimeSec, 4);
      const elapsedMs = performance.now() - t0;
      setResult(r);
      setStatus({ kind: 'ok',
        text: `peak ${(r.maxTempK - 273.15).toFixed(0)} °C · max disp ${r.maxDisplacementMm.toFixed(2)} mm · ` +
              `max σ ${(r.maxMisesPa / 1e6).toFixed(0)} MPa · ${elapsedMs.toFixed(0)} ms` });
    } catch (e) {
      setStatus({ kind: 'err', text: e.message });
    }
  }, [plate, steelIdx, voltsV, currentA, efficiency, speedMmS]);

  if (!open) return null;

  // Pick field data + per-tet flag.
  let fieldData = null, perTet = false;
  if (result && plate) {
    if (field === 'haz')      { fieldData = result.peakHazTempK;  perTet = false; }
    else if (field === 'mises'){ fieldData = result.misesStressPa; perTet = true; }
    else if (field === 'disp') {
      fieldData = new Float64Array(plate.nodes.length / 3);
      for (let i = 0; i < fieldData.length; ++i) {
        const dx = result.displacement[3 * i + 0];
        const dy = result.displacement[3 * i + 1];
        const dz = result.displacement[3 * i + 2];
        fieldData[i] = Math.sqrt(dx * dx + dy * dy + dz * dz) * 1000;
      }
      perTet = false;
    } else { fieldData = result.plasticStrain; perTet = true; }
  }

  return (
    <div style={panelStyle} data-testid="forge-welding-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Welding · Goldak + thermo-mech FEA</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-welding-close">×</button>
      </header>

      <section>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Material</small>
          <select value={steelIdx}
                  onChange={(e) => setSteelIdx(parseInt(e.target.value) || 0)}
                  style={fieldInputStyle} data-testid="forge-welding-mat">
            {STEEL_PRESETS.map((p, i) =>
              <option key={i} value={i}>{p.name}  σY={(p.sigmaY0/1e6).toFixed(0)} MPa  k={p.k} W/mK</option>)}
          </select>
        </label>
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        {[
          { l: 'Lx [mm]', v: Lx, s: setLx, t: 'forge-welding-lx', step: 5 },
          { l: 'Ly [mm]', v: Ly, s: setLy, t: 'forge-welding-ly', step: 5 },
          { l: 'Lz [mm]', v: Lz, s: setLz, t: 'forge-welding-lz', step: 1 },
          { l: 'Volts',   v: voltsV,     s: setVoltsV,     t: 'forge-welding-v',   step: 1   },
          { l: 'Amps',    v: currentA,   s: setCurrentA,   t: 'forge-welding-a',   step: 10  },
          { l: 'η',       v: efficiency, s: setEfficiency, t: 'forge-welding-eff', step: 0.05 },
          { l: 'speed [mm/s]', v: speedMmS, s: setSpeedMmS, t: 'forge-welding-spd', step: 0.5 },
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
              data-testid="forge-welding-run">
        Run weld simulation
      </button>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        color: status.kind === 'err' ? 'var(--forge-bad, #ff6363)'
                             : status.kind === 'ok'  ? 'var(--forge-ok, #4ec18b)'
                             : 'var(--forge-ink-mute)' }}
               data-testid="forge-welding-status">
        {status.text}
      </section>

      {result && (
        <section>
          <select value={field} onChange={(e) => setField(e.target.value)}
                  style={fieldInputStyle} data-testid="forge-welding-field-sel">
            <option value="haz">Peak HAZ temperature</option>
            <option value="mises">Mises stress</option>
            <option value="disp">Displacement magnitude</option>
            <option value="plastic">Equivalent plastic strain</option>
          </select>
        </section>
      )}

      {plate && fieldData && (
        <FieldOverlay plate={plate} field={fieldData} perTet={perTet} />
      )}

      {result && (
        <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                          background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)' }}
                 data-testid="forge-welding-result">
          <div>Peak HAZ      {(result.maxTempK - 273.15).toFixed(0)} °C</div>
          <div>Max disp      {result.maxDisplacementMm.toFixed(3)} mm</div>
          <div>Max Mises σ   {(result.maxMisesPa / 1e6).toFixed(1)} MPa</div>
          <div>Thermal steps {result.thermalStepsTaken} · snapshots {result.snapshotsTaken}</div>
        </section>
      )}
    </div>
  );
}

export function WeldingDistortionWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  const [viewOverride, setViewOverride] = React.useState(null);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenWeldingDistortionWorkbench  = () => setOpen(true);
    window.__forgeCloseWeldingDistortionWorkbench = () => setOpen(false);
    window.__forgeWeldingView = (v) => setViewOverride({ ...(v || {}) });
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.welddist' || e?.detail?.id === 'workbench.welddist') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'welddist') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <WeldingDistortionWorkbenchPanel open={open} onClose={() => setOpen(false)}
                                     viewOverride={viewOverride} />,
    document.body,
  );
}

export default WeldingDistortionWorkbenchPanel;
