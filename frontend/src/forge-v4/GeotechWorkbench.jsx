// Forge-176 — Geotechnical slope stability workbench.
//
// 2D limit-equilibrium analysis: Bishop simplified + Janbu corrected.
// Drives the native forge.geotech.analyse kernel — circular-search across
// (Xc, Yc, R) grid, returns FoS_Bishop + FoS_Janbu + critical-circle
// geometry + slice tabulation.
//
// UI:
//   * Slope profile editor: point list (text input, drag-out scope for v2).
//   * Soil layer table — gamma / c' / φ' / ru / name per layer.
//   * Water table polyline (optional).
//   * Search grid sliders (Xc / Yc / R bounds + resolution).
//   * "Run analysis" → kernel call.
//   * Result viz: 2D SVG with profile + critical circle + slip surface +
//     slice annotations.
//   * Metric panel: FoS_Bishop, FoS_Janbu, critical (xc, yc, R), iterations,
//     trials.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

// ---------------------------------------------------------------- presets
const SOIL_PRESETS = [
  { name: 'Silty sand',       gammaWet: 19, gammaSat: 21, cPrime: 5,  phiPrime: 32, ru: 0.0 },
  { name: 'Dense gravel',     gammaWet: 21, gammaSat: 23, cPrime: 0,  phiPrime: 38, ru: 0.0 },
  { name: 'Soft clay',        gammaWet: 17, gammaSat: 18, cPrime: 15, phiPrime: 0,  ru: 0.0 },
  { name: 'Stiff clay',       gammaWet: 19, gammaSat: 20, cPrime: 50, phiPrime: 22, ru: 0.0 },
  { name: 'Engineered fill',  gammaWet: 20, gammaSat: 22, cPrime: 10, phiPrime: 30, ru: 0.0 },
];

const DEMO_GROUND = '-20, 0; 0, 0; 10, 10; 30, 10';
const DEMO_LAYER  = '-20, 30; 30, 30';   // top above ground (full domain)

function parsePolyline(text) {
  const out = [];
  // Tolerate Unicode minus (U+2212) in addition to ASCII hyphen-minus.
  const normalised = text.replace(/−/g, '-');
  for (const piece of normalised.split(/[;\n]+/)) {
    const m = piece.match(/-?\d+(\.\d+)?/g);
    if (m && m.length >= 2) {
      out.push(parseFloat(m[0]));
      out.push(parseFloat(m[1]));
    }
  }
  return new Float64Array(out);
}

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
  padding: '3px 5px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

// 2D SVG view of the slope + result.
function SlopeSVG({ ground, waterTable, layers, result, view,
                    width = 460, height = 240 }) {
  if (!ground || ground.length < 4) return <div style={{ color: 'var(--forge-ink-mute)' }}>no profile</div>;
  const padL = 30, padR = 6, padT = 8, padB = 22;
  const w = width - padL - padR, h = height - padT - padB;
  // Compute bounds from ground + critical circle (if any).
  let xMin = +Infinity, xMax = -Infinity, yMin = +Infinity, yMax = -Infinity;
  const consume = (arr) => {
    for (let i = 0; i < arr.length / 2; ++i) {
      const x = arr[2*i], y = arr[2*i+1];
      if (x < xMin) xMin = x; if (x > xMax) xMax = x;
      if (y < yMin) yMin = y; if (y > yMax) yMax = y;
    }
  };
  consume(ground);
  if (result) {
    consume([result.xcCritical - result.rCritical, result.ycCritical,
             result.xcCritical + result.rCritical, result.ycCritical - result.rCritical]);
  }
  const sx = view?.zoom ?? 1, panX = view?.panX ?? 0, panY = view?.panY ?? 0;
  const xR = (xMax - xMin), yR = (yMax - yMin);
  const X = (mm) => padL + ((mm - xMin + panX) / xR) * w * sx;
  const Y = (mm) => padT + h - ((mm - yMin + panY) / yR) * h * sx;
  // Render ground as a closed shape filled below for soil tint.
  const groundPts = [];
  for (let i = 0; i < ground.length / 2; ++i) {
    groundPts.push(`${X(ground[2*i]).toFixed(1)},${Y(ground[2*i+1]).toFixed(1)}`);
  }
  const groundLine = groundPts.join(' ');
  // Fill below ground: extend with bottom-corners.
  const fillPts = [
    `${X(xMin).toFixed(1)},${Y(yMin - 5).toFixed(1)}`,
    ...groundPts,
    `${X(xMax).toFixed(1)},${Y(yMin - 5).toFixed(1)}`,
  ].join(' ');
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-geotech-svg">
      {/* soil tint */}
      <polygon points={fillPts} fill="rgba(140,100,60,0.25)" />
      {/* ground polyline */}
      <polyline points={groundLine} stroke="var(--forge-ink)" fill="none" strokeWidth={1.5} />
      {/* water table */}
      {waterTable && waterTable.length >= 4 && (
        <polyline
          points={Array.from({length: waterTable.length/2}, (_, i) =>
            `${X(waterTable[2*i]).toFixed(1)},${Y(waterTable[2*i+1]).toFixed(1)}`).join(' ')}
          stroke="#56a8d4" strokeWidth={1.2} strokeDasharray="3 3" fill="none" />
      )}
      {/* critical circle */}
      {result && (
        <>
          <circle cx={X(result.xcCritical)} cy={Y(result.ycCritical)}
                  r={Math.max(1, sx * w * result.rCritical / xR)}
                  stroke="var(--forge-accent)" strokeWidth={1.2}
                  fill="rgba(217,122,59,0.10)" />
          <circle cx={X(result.xcCritical)} cy={Y(result.ycCritical)} r={2.5}
                  fill="var(--forge-accent)" />
          {/* slip surface */}
          {result.slipSurface && (
            <polyline
              points={Array.from({length: result.slipSurface.length/2}, (_, i) =>
                `${X(result.slipSurface[2*i]).toFixed(1)},${Y(result.slipSurface[2*i+1]).toFixed(1)}`).join(' ')}
              stroke="var(--forge-bad, #ff6363)" strokeWidth={1.8} fill="none" />
          )}
          {/* slice base markers */}
          {result.slices && result.slices.slice(0, 50).map((s, i) => (
            <line key={i}
                  x1={X(s.xCentre)} y1={Y(s.yBase)}
                  x2={X(s.xCentre)} y2={Y(s.yBase + (s.weight/(s.width*20)))}
                  stroke="var(--forge-ink-mute)" strokeWidth={0.5} />
          ))}
        </>
      )}
      <text x={padL} y={height - 6} fontSize={10}
            fill="var(--forge-ink-mute)" fontFamily="var(--forge-mono)">x [m]</text>
      <text x={4} y={padT + 8} fontSize={10}
            fill="var(--forge-ink-mute)" fontFamily="var(--forge-mono)">y</text>
    </svg>
  );
}

export function GeotechWorkbenchPanel({ open, onClose, viewOverride }) {
  const [groundText, setGroundText] = React.useState(DEMO_GROUND);
  const [waterText,  setWaterText]  = React.useState('');
  const [layers, setLayers] = React.useState([
    { presetIdx: 0, topProfileText: DEMO_LAYER,
      gammaWet: 19, gammaSat: 21, cPrime: 5, phiPrime: 32, ru: 0.0,
      name: 'Silty sand' },
  ]);
  const [xcMin, setXcMin] = React.useState(2);
  const [xcMax, setXcMax] = React.useState(14);
  const [ycMin, setYcMin] = React.useState(12);
  const [ycMax, setYcMax] = React.useState(24);
  const [rMin,  setRMin]  = React.useState(8);
  const [rMax,  setRMax]  = React.useState(20);
  const [nXc, setNXc] = React.useState(10);
  const [nYc, setNYc] = React.useState(10);
  const [nR,  setNR]  = React.useState(8);
  const [sliceCount, setSliceCount] = React.useState(30);
  const [status, setStatus] = React.useState({ kind: 'idle', text: 'idle' });
  const [result, setResult] = React.useState(null);
  const [view, setView] = React.useState({ zoom: 1, panX: 0, panY: 0 });

  // Allow the host to override the view (multi-cam e2e drives zoom/pan).
  React.useEffect(() => { if (viewOverride) setView(viewOverride); }, [viewOverride]);

  const ground = React.useMemo(() => parsePolyline(groundText), [groundText]);
  const water  = React.useMemo(() => waterText.trim() ? parsePolyline(waterText) : new Float64Array(0), [waterText]);

  const onRun = React.useCallback(() => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.geotech || typeof f.geotech.analyse !== 'function') {
      setStatus({ kind: 'err', text: 'forge.geotech kernel not available' });
      return;
    }
    try {
      setStatus({ kind: 'pending', text: 'searching trial circles…' });
      const t0 = performance.now();
      const cfg = {
        groundProfile: ground,
        waterTable: water,
        layers: layers.map((L) => ({
          topProfile: parsePolyline(L.topProfileText),
          gammaWet: L.gammaWet, gammaSat: L.gammaSat,
          cPrime: L.cPrime, phiPrime: L.phiPrime, ru: L.ru,
          name: L.name,
        })),
        xcMin, xcMax, ycMin, ycMax, rMin, rMax,
        nXc, nYc, nR,
        sliceCount, bishopMaxIters: 50, bishopTol: 1e-4, janbuF0: 0.0,
      };
      const out = f.geotech.analyse(cfg);
      const elapsedMs = performance.now() - t0;
      setResult(out);
      setStatus({ kind: 'ok',
        text: `FoS_Bishop ${out.fosBishop.toFixed(2)}  ·  Janbu ${out.fosJanbu.toFixed(2)}  ·  ${out.trialsEvaluated} trials  ·  ${elapsedMs.toFixed(0)} ms` });
    } catch (e) {
      setStatus({ kind: 'err', text: e.message });
    }
  }, [ground, water, layers, xcMin, xcMax, ycMin, ycMax, rMin, rMax, nXc, nYc, nR, sliceCount]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-geotech-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Geotech · slope stability (Bishop + Janbu)</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-geotech-close">×</button>
      </header>

      <section>
        <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      marginBottom: 4 }}>Ground profile (x, y; …)</div>
        <textarea rows={2} value={groundText}
                  onChange={(e) => setGroundText(e.target.value)}
                  style={{ ...fieldInputStyle, resize: 'vertical' }}
                  data-testid="forge-geotech-ground" />
      </section>

      <section>
        <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      marginBottom: 4 }}>Water table (optional)</div>
        <textarea rows={1} value={waterText}
                  onChange={(e) => setWaterText(e.target.value)}
                  placeholder="e.g. −20, 8; 30, 8"
                  style={{ ...fieldInputStyle, resize: 'vertical' }}
                  data-testid="forge-geotech-water" />
      </section>

      <section>
        <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      marginBottom: 4 }}>Soil layers</div>
        {layers.map((L, i) => (
          <div key={i} style={{ marginBottom: 6,
                                border: '1px solid var(--forge-rail-edge)',
                                padding: 4 }}>
            <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
              <select value={L.presetIdx ?? 0}
                      onChange={(e) => {
                        const p = SOIL_PRESETS[parseInt(e.target.value)];
                        setLayers((arr) => arr.map((x, j) =>
                          j === i ? { ...x, ...p, presetIdx: parseInt(e.target.value) } : x));
                      }}
                      style={{ ...fieldInputStyle, flex: 1 }}
                      data-testid={`forge-geotech-preset-${i}`}>
                {SOIL_PRESETS.map((p, k) =>
                  <option key={k} value={k}>{p.name}</option>)}
              </select>
              <button onClick={() => setLayers((arr) => arr.filter((_, j) => j !== i))}
                      style={{ ...fieldInputStyle, width: 30, cursor: 'pointer' }}>
                −
              </button>
            </div>
            <textarea rows={1} value={L.topProfileText}
                      onChange={(e) =>
                        setLayers((arr) => arr.map((x, j) =>
                          j === i ? { ...x, topProfileText: e.target.value } : x))}
                      placeholder="top profile: x, y; …"
                      style={{ ...fieldInputStyle, resize: 'vertical', marginBottom: 4 }}
                      data-testid={`forge-geotech-layer-top-${i}`} />
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 4 }}>
              {[
                { label: 'γ_wet', val: L.gammaWet,  key: 'gammaWet'  },
                { label: 'γ_sat', val: L.gammaSat,  key: 'gammaSat'  },
                { label: "c'",    val: L.cPrime,    key: 'cPrime'    },
                { label: "φ'",    val: L.phiPrime,  key: 'phiPrime'  },
                { label: 'ru',    val: L.ru,        key: 'ru'        },
              ].map((f) => (
                <label key={f.key} style={{ display: 'block' }}>
                  <small style={{ color: 'var(--forge-ink-mute)' }}>{f.label}</small>
                  <input type="number" value={f.val} step={0.5}
                         onChange={(e) => {
                           const v = parseFloat(e.target.value) || 0;
                           setLayers((arr) => arr.map((x, j) =>
                             j === i ? { ...x, [f.key]: v } : x));
                         }}
                         style={fieldInputStyle}
                         data-testid={`forge-geotech-layer-${i}-${f.key}`} />
                </label>
              ))}
            </div>
          </div>
        ))}
        <button onClick={() => setLayers((arr) =>
                  [...arr, { presetIdx: 0, topProfileText: DEMO_LAYER,
                             ...SOIL_PRESETS[0] }])}
                style={{ ...fieldInputStyle, cursor: 'pointer' }}>
          + add layer
        </button>
      </section>

      <section>
        <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      marginBottom: 4 }}>Search grid</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
          {[
            { label: 'Xc min',  val: xcMin, set: setXcMin, t: 'forge-geotech-xcmin' },
            { label: 'Xc max',  val: xcMax, set: setXcMax, t: 'forge-geotech-xcmax' },
            { label: 'nXc',     val: nXc,   set: setNXc,   t: 'forge-geotech-nxc'   },
            { label: 'Yc min',  val: ycMin, set: setYcMin, t: 'forge-geotech-ycmin' },
            { label: 'Yc max',  val: ycMax, set: setYcMax, t: 'forge-geotech-ycmax' },
            { label: 'nYc',     val: nYc,   set: setNYc,   t: 'forge-geotech-nyc'   },
            { label: 'R min',   val: rMin,  set: setRMin,  t: 'forge-geotech-rmin'  },
            { label: 'R max',   val: rMax,  set: setRMax,  t: 'forge-geotech-rmax'  },
            { label: 'nR',      val: nR,    set: setNR,    t: 'forge-geotech-nr'    },
            { label: 'slices',  val: sliceCount, set: setSliceCount, t: 'forge-geotech-slices' },
          ].map((f) => (
            <label key={f.label}>
              <small style={{ color: 'var(--forge-ink-mute)' }}>{f.label}</small>
              <input type="number" value={f.val} step={1}
                     onChange={(e) => f.set(parseFloat(e.target.value) || 0)}
                     style={fieldInputStyle}
                     data-testid={f.t} />
            </label>
          ))}
        </div>
      </section>

      <button onClick={onRun}
              style={{ background: 'var(--forge-accent)', border: 'none',
                       color: '#0a0e14', padding: '8px 12px', cursor: 'pointer',
                       fontWeight: 600, fontFamily: 'var(--forge-mono)' }}
              data-testid="forge-geotech-run">
        Run slope analysis
      </button>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        color: status.kind === 'err' ? 'var(--forge-bad, #ff6363)'
                             : status.kind === 'ok'  ? 'var(--forge-ok, #4ec18b)'
                             : 'var(--forge-ink-mute)' }}
               data-testid="forge-geotech-status">
        {status.text}
      </section>

      <SlopeSVG ground={ground} waterTable={water} layers={layers}
                result={result} view={view} />

      {result && (
        <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                          background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)' }}
                 data-testid="forge-geotech-result">
          <div>FoS Bishop {result.fosBishop.toFixed(3)} · Janbu {result.fosJanbu.toFixed(3)}</div>
          <div>Critical circle (xc, yc, R): ({result.xcCritical.toFixed(2)}, {result.ycCritical.toFixed(2)}, {result.rCritical.toFixed(2)}) m</div>
          <div>{result.trialsEvaluated} trial circles · Bishop converged in {result.iterations} iters</div>
          <div>{result.slices.length} slices · slip surface {result.slipSurface.length/2} pts</div>
        </section>
      )}
    </div>
  );
}

export function GeotechWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  const [view, setView] = React.useState({ zoom: 1, panX: 0, panY: 0 });
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenGeotechWorkbench  = () => setOpen(true);
    window.__forgeCloseGeotechWorkbench = () => setOpen(false);
    // Multi-cam emulation for 2D viewport — the e2e cycles through these.
    window.__forgeGeotechView = (next) => setView({ ...view, ...(next || {}) });
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.geotech' || e?.detail?.id === 'workbench.geotech') {
        setOpen(true);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'geotech') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <GeotechWorkbenchPanel open={open} onClose={() => setOpen(false)}
                           viewOverride={view} />,
    document.body,
  );
}

export default GeotechWorkbenchPanel;
