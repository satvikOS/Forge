// Forge-175 — Acoustic room simulator workbench.
//
// Drives the native forge.acoustics.simulate kernel (image-source method
// + Eyring stochastic tail). The UI lets the user dimension a shoebox
// room, pick a wall-surface preset per face, set source + receiver
// positions, and view per-band RT60, C50, C80, D50, the impulse response
// waveform, and the Schroeder EDC.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const BAND_HZ = [125, 250, 500, 1000, 2000, 4000];

// Per-band absorption coefficients for common surfaces (ISO standards).
const SURFACE_PRESETS = [
  { name: 'Painted concrete',     vals: [0.01, 0.01, 0.02, 0.02, 0.02, 0.03] },
  { name: 'Plaster on lath',      vals: [0.14, 0.10, 0.06, 0.05, 0.04, 0.03] },
  { name: 'Gypsum board 12 mm',   vals: [0.29, 0.10, 0.05, 0.04, 0.07, 0.09] },
  { name: 'Carpet on concrete',   vals: [0.02, 0.06, 0.14, 0.37, 0.60, 0.65] },
  { name: 'Glass wool 50 mm',     vals: [0.20, 0.55, 0.90, 0.95, 0.92, 0.85] },
  { name: 'Heavy curtain',        vals: [0.07, 0.31, 0.49, 0.81, 0.66, 0.54] },
  { name: 'Audience (seated)',    vals: [0.39, 0.57, 0.80, 0.94, 0.92, 0.87] },
  { name: 'Wood floor 22 mm',     vals: [0.15, 0.11, 0.10, 0.07, 0.06, 0.07] },
];

const AIR_ATTEN_RH50 = [0.0001, 0.0003, 0.0006, 0.0010, 0.0040, 0.0080];

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

function IRSVG({ ir, sampleRateHz, width = 480, height = 120 }) {
  if (!ir || ir.length === 0) return null;
  const N = ir.length;
  const padL = 30, padR = 6, padT = 14, padB = 18;
  const w = width - padL - padR, h = height - padT - padB;
  let maxAbs = 0;
  for (const v of ir) { const a = Math.abs(v); if (a > maxAbs) maxAbs = a; }
  if (maxAbs === 0) maxAbs = 1;
  const X = (i) => padL + (i / N) * w;
  const Y = (v) => padT + h * 0.5 - (v / maxAbs) * h * 0.45;
  const stride = Math.max(1, Math.floor(N / 1200));
  let d = '';
  for (let i = 0; i < N; i += stride) {
    d += `${i === 0 ? 'M' : 'L'} ${X(i).toFixed(1)} ${Y(ir[i]).toFixed(1)} `;
  }
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-acoustics-ir">
      <line x1={padL} y1={padT + h * 0.5} x2={padL + w} y2={padT + h * 0.5}
            stroke="var(--forge-rail-edge)" strokeDasharray="2 3" />
      <path d={d} fill="none" stroke="var(--forge-accent)" strokeWidth={0.7} />
      <text x={4} y={12} fontSize={10}
            fill="var(--forge-ink-mute)" fontFamily="var(--forge-mono)">
        IR  ·  {(N / sampleRateHz).toFixed(2)} s  ·  peak {maxAbs.toExponential(2)}
      </text>
    </svg>
  );
}

function EDCSVG({ edcDb, strideSamples, sampleRateHz, width = 480, height = 160 }) {
  if (!edcDb || !edcDb.length) return null;
  const padL = 36, padR = 6, padT = 10, padB = 20;
  const w = width - padL - padR, h = height - padT - padB;
  const colors = ['#56a8d4', '#56c1c1', '#79c170', '#d4c356', '#d49d56', '#d97a3b'];
  const dbMin = -80, dbMax = 0;
  const Y = (v) => padT + h * (1 - (v - dbMin) / (dbMax - dbMin));
  const X = (i, n) => padL + (i / n) * w;
  const paths = edcDb.map((arr, b) => {
    let d = '';
    for (let i = 0; i < arr.length; ++i) {
      d += `${i === 0 ? 'M' : 'L'} ${X(i, arr.length).toFixed(1)} ${Y(arr[i]).toFixed(1)} `;
    }
    return <path key={b} d={d} fill="none" stroke={colors[b]} strokeWidth={1.0} />;
  });
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-acoustics-edc">
      {[-20, -40, -60].map((v) => (
        <g key={v}>
          <line x1={padL} y1={Y(v)} x2={padL + w} y2={Y(v)}
                stroke="var(--forge-rail-edge)" strokeDasharray="2 3" />
          <text x={4} y={Y(v) + 4} fontSize={9}
                fill="var(--forge-ink-mute)" fontFamily="var(--forge-mono)">{v} dB</text>
        </g>
      ))}
      {paths}
      <text x={padL} y={12} fontSize={10}
            fill="var(--forge-ink-mute)" fontFamily="var(--forge-mono)">
        EDC per band — 125 / 250 / 500 / 1k / 2k / 4k Hz
      </text>
    </svg>
  );
}

function RT60Bars({ rt60Sec, width = 480, height = 90 }) {
  if (!rt60Sec) return null;
  const padL = 30, padR = 6, padT = 12, padB = 22;
  const w = width - padL - padR, h = height - padT - padB;
  const maxRt = Math.max(0.001, ...rt60Sec);
  const barW = w / BAND_HZ.length;
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-acoustics-rt60">
      {BAND_HZ.map((f, b) => {
        const rt = rt60Sec[b];
        const bh = (rt / maxRt) * h;
        return (
          <g key={b}>
            <rect x={padL + b * barW + 2} y={padT + h - bh}
                  width={barW - 4} height={bh}
                  fill="var(--forge-accent)" />
            <text x={padL + b * barW + barW / 2} y={padT + h + 11}
                  fontSize={9} textAnchor="middle"
                  fill="var(--forge-ink-mute)" fontFamily="var(--forge-mono)">
              {f >= 1000 ? `${f/1000}k` : f}
            </text>
            <text x={padL + b * barW + barW / 2} y={padT + h - bh - 3}
                  fontSize={9} textAnchor="middle"
                  fill="var(--forge-ink)" fontFamily="var(--forge-mono)">
              {rt.toFixed(2)}
            </text>
          </g>
        );
      })}
      <text x={4} y={12} fontSize={10}
            fill="var(--forge-ink-mute)" fontFamily="var(--forge-mono)">
        RT60 [s] per octave band
      </text>
    </svg>
  );
}

export function AcousticsWorkbenchPanel({ open, onClose, viewOverride }) {
  const [Lx, setLx] = React.useState(6);
  const [Ly, setLy] = React.useState(4);
  const [Lz, setLz] = React.useState(3);
  const [maxOrder, setMaxOrder] = React.useState(10);
  const [irLengthSec, setIrLengthSec] = React.useState(2);
  const [wallPresets, setWallPresets] = React.useState([0, 0, 0, 0, 0, 0]);
  const [sx, setSx] = React.useState(1.0);
  const [sy, setSy] = React.useState(2.0);
  const [sz, setSz] = React.useState(1.5);
  const [rx, setRx] = React.useState(5.0);
  const [ry, setRy] = React.useState(2.0);
  const [rz, setRz] = React.useState(1.5);
  const [viewKind, setViewKind] = React.useState('combined');  // combined | per-band | edc | rt60
  const [bandIdx, setBandIdx] = React.useState(2);            // 0..5
  const [status, setStatus] = React.useState({ kind: 'idle', text: 'idle' });
  const [result, setResult] = React.useState(null);

  React.useEffect(() => {
    if (viewOverride) {
      if (viewOverride.viewKind !== undefined) setViewKind(viewOverride.viewKind);
      if (viewOverride.bandIdx !== undefined) setBandIdx(viewOverride.bandIdx);
    }
  }, [viewOverride]);

  const onRun = React.useCallback(() => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.acoustics || typeof f.acoustics.simulate !== 'function') {
      setStatus({ kind: 'err', text: 'forge.acoustics kernel not available' });
      return;
    }
    try {
      setStatus({ kind: 'pending', text: 'tracing image sources…' });
      const walls = wallPresets.map((idx) =>
        new Float64Array(SURFACE_PRESETS[idx].vals));
      const cfg = {
        room: { Lx, Ly, Lz, walls, airAtten: new Float64Array(AIR_ATTEN_RH50) },
        sourceX: sx, sourceY: sy, sourceZ: sz,
        recvX:   rx, recvY:   ry, recvZ:   rz,
        maxOrder,
        speedOfSound: 343,
        sampleRateHz: 24000,    // 24 kHz keeps IR arrays light for the UI
        irLengthSec,
        sourcePowerW: 1e-3,
        randomSeed: 42,
      };
      const t0 = performance.now();
      const r = f.acoustics.simulate(cfg);
      const elapsedMs = performance.now() - t0;
      setResult(r);
      setStatus({ kind: 'ok',
        text: `IR ${r.samples} samp · ${r.imageSourcesEvaluated} img · ` +
              `RT60 mid ${r.rt60Sec[2].toFixed(2)} s (Sabine ${r.sabineRt60Mid.toFixed(2)}) · ${elapsedMs.toFixed(0)} ms` });
    } catch (e) {
      setStatus({ kind: 'err', text: e.message });
    }
  }, [Lx, Ly, Lz, maxOrder, irLengthSec, wallPresets, sx, sy, sz, rx, ry, rz]);

  if (!open) return null;

  const wallNames = ['-X', '+X', '-Y', '+Y', '-Z (floor)', '+Z (ceiling)'];

  return (
    <div style={panelStyle} data-testid="forge-acoustics-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Acoustics · image-source method + Eyring</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-acoustics-close">×</button>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
        {[
          { l: 'Lx [m]', v: Lx, s: setLx, t: 'forge-acoustics-lx' },
          { l: 'Ly [m]', v: Ly, s: setLy, t: 'forge-acoustics-ly' },
          { l: 'Lz [m]', v: Lz, s: setLz, t: 'forge-acoustics-lz' },
          { l: 'src x',  v: sx, s: setSx, t: 'forge-acoustics-sx' },
          { l: 'src y',  v: sy, s: setSy, t: 'forge-acoustics-sy' },
          { l: 'src z',  v: sz, s: setSz, t: 'forge-acoustics-sz' },
          { l: 'rcv x',  v: rx, s: setRx, t: 'forge-acoustics-rx' },
          { l: 'rcv y',  v: ry, s: setRy, t: 'forge-acoustics-ry' },
          { l: 'rcv z',  v: rz, s: setRz, t: 'forge-acoustics-rz' },
          { l: 'order',  v: maxOrder,    s: setMaxOrder,    t: 'forge-acoustics-order',  step: 1   },
          { l: 'IR [s]', v: irLengthSec, s: setIrLengthSec, t: 'forge-acoustics-irlen',  step: 0.1 },
        ].map((f) => (
          <label key={f.l}>
            <small style={{ color: 'var(--forge-ink-mute)' }}>{f.l}</small>
            <input type="number" value={f.v} step={f.step || 0.1}
                   onChange={(e) => f.s(parseFloat(e.target.value) || 0)}
                   style={fieldInputStyle} data-testid={f.t} />
          </label>
        ))}
      </section>

      <section>
        <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      marginBottom: 4 }}>Wall surfaces</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 4 }}>
          {wallNames.map((nm, i) => (
            <label key={i}>
              <small style={{ color: 'var(--forge-ink-mute)' }}>{nm}</small>
              <select value={wallPresets[i]}
                      onChange={(e) => setWallPresets((arr) =>
                        arr.map((v, j) => j === i ? parseInt(e.target.value) : v))}
                      style={fieldInputStyle}
                      data-testid={`forge-acoustics-wall-${i}`}>
                {SURFACE_PRESETS.map((p, k) =>
                  <option key={k} value={k}>{p.name}</option>)}
              </select>
            </label>
          ))}
        </div>
      </section>

      <button onClick={onRun}
              style={{ background: 'var(--forge-accent)', border: 'none',
                       color: '#0a0e14', padding: '8px 12px', cursor: 'pointer',
                       fontWeight: 600, fontFamily: 'var(--forge-mono)' }}
              data-testid="forge-acoustics-run">
        Compute room impulse response
      </button>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        color: status.kind === 'err' ? 'var(--forge-bad, #ff6363)'
                             : status.kind === 'ok'  ? 'var(--forge-ok, #4ec18b)'
                             : 'var(--forge-ink-mute)' }}
               data-testid="forge-acoustics-status">
        {status.text}
      </section>

      {result && (
        <section style={{ display: 'flex', gap: 4 }}>
          <select value={viewKind} onChange={(e) => setViewKind(e.target.value)}
                  style={fieldInputStyle} data-testid="forge-acoustics-view">
            <option value="combined">IR · combined</option>
            <option value="per-band">IR · per band</option>
            <option value="edc">EDC per band</option>
            <option value="rt60">RT60 bar chart</option>
          </select>
          {viewKind === 'per-band' && (
            <select value={bandIdx}
                    onChange={(e) => setBandIdx(parseInt(e.target.value) || 0)}
                    style={fieldInputStyle} data-testid="forge-acoustics-band">
              {BAND_HZ.map((f, i) =>
                <option key={i} value={i}>{f >= 1000 ? `${f/1000} kHz` : `${f} Hz`}</option>)}
            </select>
          )}
        </section>
      )}

      {result && viewKind === 'combined' &&
        <IRSVG ir={result.irCombined} sampleRateHz={result.sampleRateHz} />}
      {result && viewKind === 'per-band' &&
        <IRSVG ir={result.irPerBand[bandIdx]} sampleRateHz={result.sampleRateHz} />}
      {result && viewKind === 'edc' &&
        <EDCSVG edcDb={result.edcDb}
                strideSamples={result.edcStrideSamples}
                sampleRateHz={result.sampleRateHz} />}
      {result && viewKind === 'rt60' &&
        <RT60Bars rt60Sec={result.rt60Sec} />}

      {result && (
        <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                          background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)' }}
                 data-testid="forge-acoustics-metrics">
          <div>RT60   {Array.from(result.rt60Sec).map(x => x.toFixed(2)).join(' / ')}  s</div>
          <div>C50    {Array.from(result.c50Db).map(x => x.toFixed(1)).join(' / ')}  dB</div>
          <div>C80    {Array.from(result.c80Db).map(x => x.toFixed(1)).join(' / ')}  dB</div>
          <div>D50    {Array.from(result.d50).map(x => x.toFixed(2)).join(' / ')}</div>
          <div>Sabine RT60_mid  {result.sabineRt60Mid.toFixed(2)} s</div>
          <div>Image sources    {result.imageSourcesEvaluated}</div>
        </section>
      )}
    </div>
  );
}

export function AcousticsWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  const [viewOverride, setViewOverride] = React.useState(null);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenAcousticsWorkbench  = () => setOpen(true);
    window.__forgeCloseAcousticsWorkbench = () => setOpen(false);
    window.__forgeAcousticsView = (v) => setViewOverride({ ...(v || {}) });
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.acoustics' || e?.detail?.id === 'workbench.acoustics') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'acoustics') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AcousticsWorkbenchPanel open={open} onClose={() => setOpen(false)}
                             viewOverride={viewOverride} />,
    document.body,
  );
}

export default AcousticsWorkbenchPanel;
