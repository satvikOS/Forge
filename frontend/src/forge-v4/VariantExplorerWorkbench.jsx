// Forge-187 — Generative variant explorer.
//
// Drives forge.variants.{latinHypercube, paretoFront} against domain
// generators. This slice ships a single recipe — Trapezoidal Wing —
// because it composes nicely against forge.airfoil.{trapezoidalWing,
// planformMetrics, massProps} from Forge-171. Future slices can add
// more recipes (slope stability variations, casting cavity variants).
//
// The user sets ranges for (rootChord, halfSpan, taperRatio), a sample
// count, and chooses objectives (minimise mass / maximise aspect ratio
// in this slice). The workbench runs the sweep, scores each variant,
// computes the Pareto front, and renders the scatter plot with
// Pareto-front points highlighted in copper.
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

function ScatterPlot({ points, paretoIds, width = 480, height = 240 }) {
  if (!points || !points.length) return null;
  const padL = 38, padR = 8, padT = 14, padB = 22;
  const w = width - padL - padR, h = height - padT - padB;
  const xs = points.map((p) => p.mass);
  const ys = points.map((p) => p.AR);
  const xLo = Math.min(...xs), xHi = Math.max(...xs);
  const yLo = Math.min(...ys), yHi = Math.max(...ys);
  const X = (v) => padL + ((v - xLo) / Math.max(1e-9, xHi - xLo)) * w;
  const Y = (v) => padT + h - ((v - yLo) / Math.max(1e-9, yHi - yLo)) * h;
  const paretoSet = new Set(paretoIds || []);
  // Pareto polyline (sorted by mass ascending).
  const sortedFront = [...paretoSet].sort((a, b) => points[a].mass - points[b].mass);
  const frontD = sortedFront.map((i, k) =>
    `${k === 0 ? 'M' : 'L'} ${X(points[i].mass).toFixed(1)} ${Y(points[i].AR).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-variants-scatter">
      <line x1={padL} y1={padT + h} x2={padL + w} y2={padT + h}
            stroke="var(--forge-rail-edge)" />
      <line x1={padL} y1={padT} x2={padL} y2={padT + h}
            stroke="var(--forge-rail-edge)" />
      {frontD && (
        <path d={frontD} fill="none"
              stroke="var(--forge-accent)" strokeWidth={1.3}
              strokeDasharray="3 2" />
      )}
      {points.map((p, i) => {
        const onFront = paretoSet.has(i);
        return (
          <circle key={i} cx={X(p.mass)} cy={Y(p.AR)}
                  r={onFront ? 4 : 2.4}
                  fill={onFront ? 'var(--forge-accent)' : 'rgba(86, 168, 212, 0.7)'}
                  stroke={onFront ? '#0a0e14' : 'none'}
                  strokeWidth={onFront ? 0.5 : 0} />
        );
      })}
      <text x={padL + w / 2} y={padT + h + 18}
            fontSize={10} textAnchor="middle"
            fill="var(--forge-ink-mute)" fontFamily="var(--forge-mono)">
        mass (g) — minimise →
      </text>
      <text x={6} y={padT + 6}
            fontSize={10} fill="var(--forge-ink-mute)"
            fontFamily="var(--forge-mono)">
        AR ↑
      </text>
      <text x={padL + 4} y={padT + 12}
            fontSize={10} fill="var(--forge-ink-mute)"
            fontFamily="var(--forge-mono)">
        {points.length} variants · {(paretoIds || []).length} on Pareto
      </text>
    </svg>
  );
}

export function VariantExplorerWorkbenchPanel({ open, onClose }) {
  const [chordLo, setChordLo] = React.useState(50);
  const [chordHi, setChordHi] = React.useState(200);
  const [halfSpanLo, setHalfSpanLo] = React.useState(300);
  const [halfSpanHi, setHalfSpanHi] = React.useState(1200);
  const [taperLo, setTaperLo] = React.useState(0.3);
  const [taperHi, setTaperHi] = React.useState(1.0);
  const [samples, setSamples] = React.useState(20);
  const [points, setPoints] = React.useState(null);
  const [paretoIds, setParetoIds] = React.useState(null);
  const [status, setStatus] = React.useState({ kind: 'idle', text: 'idle' });

  const onRun = React.useCallback(() => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.variants || !f.airfoil) {
      setStatus({ kind: 'err', text: 'forge.variants or forge.airfoil unavailable' });
      return;
    }
    try {
      setStatus({ kind: 'pending', text: 'sweeping design space…' });
      const t0 = performance.now();
      const lhs = f.variants.latinHypercube({
        dims: [
          { name: 'rootChord', lo: chordLo,    hi: chordHi },
          { name: 'halfSpan',  lo: halfSpanLo, hi: halfSpanHi },
          { name: 'taper',     lo: taperLo,    hi: taperHi },
        ],
        samples,
        randomSeed: 7,
      });
      // Use the same root profile for every variant so the only deltas
      // are the dimensional sweep parameters.
      const rootProfile = f.airfoil.naca4('2412', 80);
      const pts = [];
      const objBuf = new Float64Array(samples * 2);
      for (let s = 0; s < samples; ++s) {
        const rc = lhs.values[s * 3 + 0];
        const hs = lhs.values[s * 3 + 1];
        const tp = lhs.values[s * 3 + 2];
        const spec = {
          rootProfile,
          rootChordMm: rc, taperRatio: tp, halfSpanMm: hs,
          sweepDeg: 0, dihedralDeg: 0, twistDeg: 0,
          spanStations: 4,
        };
        let mass = 0, AR = 0, area = 0;
        try {
          const handle = f.airfoil.trapezoidalWing(spec);
          const mp = f.massProps(handle);
          // Convert mm³ → grams assuming Al6061 density 2.7 g/cm³
          //   mass_g = volume_mm³ × 1e-3 cm³/mm³ × 2.7 g/cm³
          mass = mp.volume * 1e-3 * 2.7;
          const metrics = f.airfoil.planformMetrics(spec);
          AR = metrics.aspectRatio;
          area = metrics.areaMm2;
          // No retain/release — the BREP handle is GC-tracked by the
          // shape registry. Stale handles in this sweep don't matter
          // because the next batch will start fresh.
        } catch (e) {
          mass = NaN; AR = NaN;
        }
        pts.push({ rc, hs, tp, mass, AR, area });
        objBuf[s * 2 + 0] = isFinite(mass) ? mass : 1e18;
        objBuf[s * 2 + 1] = isFinite(AR) ? AR : -1e18;
      }
      // Pareto front: minimise mass (-1), maximise AR (+1).
      const idx = Array.from(f.variants.paretoFront(objBuf, 2, [-1, +1]));
      setPoints(pts);
      setParetoIds(idx);
      const elapsedMs = performance.now() - t0;
      setStatus({ kind: 'ok',
        text: `${samples} variants · ${idx.length} on Pareto · ${elapsedMs.toFixed(0)} ms` });
    } catch (e) {
      setStatus({ kind: 'err', text: e.message });
    }
  }, [chordLo, chordHi, halfSpanLo, halfSpanHi, taperLo, taperHi, samples]);

  React.useEffect(() => { if (open) onRun(); }, [open]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-variants-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Generative variants · trapezoidal wing</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-variants-close">×</button>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
        {[
          { l: 'chord lo',  v: chordLo,    s: setChordLo,    t: 'forge-var-chord-lo', step: 5 },
          { l: 'chord hi',  v: chordHi,    s: setChordHi,    t: 'forge-var-chord-hi', step: 5 },
          { l: 'b/2 lo',    v: halfSpanLo, s: setHalfSpanLo, t: 'forge-var-hs-lo',    step: 50 },
          { l: 'b/2 hi',    v: halfSpanHi, s: setHalfSpanHi, t: 'forge-var-hs-hi',    step: 50 },
          { l: 'taper lo',  v: taperLo,    s: setTaperLo,    t: 'forge-var-tp-lo',    step: 0.05 },
          { l: 'taper hi',  v: taperHi,    s: setTaperHi,    t: 'forge-var-tp-hi',    step: 0.05 },
          { l: 'samples',   v: samples,    s: setSamples,    t: 'forge-var-samples',  step: 4 },
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
              data-testid="forge-variants-run">
        Sweep design space
      </button>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        color: status.kind === 'err' ? 'var(--forge-bad, #ff6363)'
                             : status.kind === 'ok'  ? 'var(--forge-ok, #4ec18b)'
                             : 'var(--forge-ink-mute)' }}
               data-testid="forge-variants-status">
        {status.text}
      </section>

      {points && paretoIds && (
        <ScatterPlot points={points} paretoIds={paretoIds} />
      )}

      {points && paretoIds && (
        <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                          background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)',
                          maxHeight: 180, overflowY: 'auto' }}
                 data-testid="forge-variants-table">
          <div style={{ color: 'var(--forge-ink-mute)' }}>
            #   chord  b/2    taper   mass(g)   AR     pareto
          </div>
          {points.map((p, i) => {
            const onFront = paretoIds.includes(i);
            return (
              <div key={i} style={{ color: onFront ? 'var(--forge-accent)' : 'var(--forge-ink)' }}>
                {String(i).padStart(2,' ')}  {p.rc.toFixed(0).padStart(5,' ')}
                {' '}{p.hs.toFixed(0).padStart(5,' ')}
                {' '}{p.tp.toFixed(2).padStart(5,' ')}
                {' '}{isFinite(p.mass) ? p.mass.toFixed(1).padStart(8,' ') : '   —    '}
                {' '}{isFinite(p.AR)   ? p.AR.toFixed(2).padStart(6,' ')  : '  —   '}
                {' '}{onFront ? ' ★' : ''}
              </div>
            );
          })}
        </section>
      )}
    </div>
  );
}

export function VariantExplorerWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenVariantsWorkbench  = () => setOpen(true);
    window.__forgeCloseVariantsWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.variants' || e?.detail?.id === 'workbench.variants') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'variants') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <VariantExplorerWorkbenchPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default VariantExplorerWorkbenchPanel;
