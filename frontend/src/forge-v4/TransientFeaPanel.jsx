// PUSH-222 (Slice-158) — Transient Dynamics FEA panel.
//
// Surface contract
// ----------------
//
//   * Time step dt + total time T inputs.
//   * Newmark β + γ inputs (defaults 0.25 / 0.5 = unconditional stability).
//   * Rayleigh damping α + β_R inputs.
//   * Load type: impulse / sinusoidal / step.
//   * "Run" button — runs the canonical SDOF mass-spring fixture
//     (M = 1, K = 4π²) with the configured load + damping. Results:
//       - time-displacement plot of the monitor node (SVG polyline)
//       - max displacement / max velocity / max acceleration chips
//       - solver elapsed time + step count.
//
// Window surface
// --------------
//
//   * window.__forgeOpenTransientFea(true|false)    — show / hide.
//   * window.__forgeCloseTransientFea()
//   * window.__forgeTransientFeaHelper              — solver export surface
//                                                     (the e2e drives the
//                                                     solver headlessly
//                                                     through this).
//   * window.__forgeTransientFeaLast                — last run snapshot
//                                                     (times, disp, max...).
//
// Headed event:  forge:transient-fea-complete with detail payload mirroring
// __forgeTransientFeaLast.
//
// Hard constraints (PUSH-222 brief)
// ---------------------------------
//   * NO new npm / C++ deps.
//   * Real Newmark math — no MVP, no Euler-only fallback.
//   * Real K_eff = K + (γ/(β·dt))·C + (1/(β·dt²))·M with direct LU.
//
// Multi-cam e2e mandates 5 named camera angles per the Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  TRANSIENT_DEFAULTS,
  LOAD_TYPES,
  solveTransient,
  buildSdofFixture,
  makeTransientFeaHelper,
} from './transientFea.js';

// ─────────────────────────────────────────────────────────────────────
// Constants.

export const TRANSIENT_PANEL_WIDTH = 480;
export const TRANSIENT_PLOT_PX = { w: 420, h: 160 };

// ─────────────────────────────────────────────────────────────────────
// Time-displacement plot — SVG polyline with axis decorations.

function TimeHistoryPlot({ times, values, label, testId, color }) {
  const { w, h } = TRANSIENT_PLOT_PX;
  if (!times || !values || times.length === 0) {
    return (
      <div data-testid={`${testId}-empty`}
           style={{
             padding: '14px 6px', fontSize: 11,
             color: 'var(--forge-ink-mute, #9aa1ab)',
             fontStyle: 'italic',
           }}>
        Plot appears after the first run.
      </div>
    );
  }
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v < yMin) yMin = v;
    if (v > yMax) yMax = v;
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = -1; yMax = 1; }
  if (yMax - yMin < 1e-12) { yMin -= 0.5; yMax += 0.5; }
  const tMin = times[0], tMax = times[times.length - 1];
  const pad = 16;
  const innerW = w - 2 * pad, innerH = h - 2 * pad;
  // Polyline points.
  const pts = new Array(times.length);
  for (let i = 0; i < times.length; i++) {
    const x = pad + (times[i] - tMin) / (tMax - tMin) * innerW;
    const y = pad + (yMax - values[i]) / (yMax - yMin) * innerH;
    pts[i] = `${x.toFixed(2)},${y.toFixed(2)}`;
  }
  const zeroY = (yMin < 0 && yMax > 0)
    ? pad + (yMax / (yMax - yMin)) * innerH
    : null;
  return (
    <div data-testid={testId}
         data-points={times.length}
         data-y-min={yMin.toExponential(3)}
         data-y-max={yMax.toExponential(3)}
         data-t-min={tMin.toFixed(4)}
         data-t-max={tMax.toFixed(4)}
         style={{
           border: '1px solid var(--forge-rail-edge, #2a2d34)',
           padding: 6,
           background: 'var(--forge-canvas, #0e1117)',
         }}>
      <div style={{
        fontSize: 10,
        color: 'var(--forge-ink-mute, #9aa1ab)',
        fontFamily: 'var(--forge-mono, monospace)',
        marginBottom: 4,
      }}>
        {label} · t ∈ [{tMin.toFixed(3)}, {tMax.toFixed(3)}] s ·
        y ∈ [{yMin.toExponential(2)}, {yMax.toExponential(2)}]
      </div>
      <svg width={w} height={h}
           viewBox={`0 0 ${w} ${h}`}
           xmlns="http://www.w3.org/2000/svg"
           style={{ display: 'block' }}>
        <rect x={0} y={0} width={w} height={h} fill="transparent" />
        {/* zero line if range straddles 0 */}
        {zeroY !== null && (
          <line x1={pad} y1={zeroY} x2={pad + innerW} y2={zeroY}
                stroke="var(--forge-rail-edge, #2a2d34)"
                strokeWidth={0.7} strokeDasharray="3,3" />
        )}
        {/* axes box */}
        <rect x={pad} y={pad} width={innerW} height={innerH}
              fill="none"
              stroke="var(--forge-rail-edge, #2a2d34)"
              strokeWidth={0.7} />
        <polyline points={pts.join(' ')}
                  fill="none"
                  stroke={color || 'var(--forge-accent-rim, #3a7afe)'}
                  strokeWidth={1.5} />
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Scalar chip — label + value.

function Chip({ label, value, units, testId, accent, big }) {
  return (
    <span data-testid={testId}
          style={{
            display: 'inline-flex', flexDirection: 'column',
            padding: big ? '6px 10px' : '3px 8px',
            border: '1px solid var(--forge-rail-edge, #2a2d34)',
            borderRadius: 4,
            background: accent
              ? 'var(--forge-accent-mute, #1f3a72)'
              : 'var(--forge-canvas, #0e1117)',
            color: 'var(--forge-ink, #dadde2)',
            fontFamily: 'var(--forge-mono, monospace)',
            fontSize: big ? 11 : 10,
            lineHeight: 1.1,
            minWidth: 90,
          }}>
      <span style={{
        fontSize: 8,
        color: 'var(--forge-ink-mute, #9aa1ab)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        {label}
      </span>
      <span>
        {value}
        {units ? <span style={{
          color: 'var(--forge-ink-mute, #9aa1ab)',
          fontSize: big ? 9 : 8,
          marginLeft: 4,
        }}>{units}</span> : null}
      </span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Snapshot — JSON-safe summary for window.__forgeTransientFeaLast.

function snapshotResult(out, panelMeta) {
  return {
    // Echo of inputs.
    dt:           out.dt,
    tEnd:         out.tEnd,
    beta:         out.beta,
    gamma:        out.gamma,
    alphaRayleigh: out.alphaR,
    betaRayleigh:  out.betaR,
    loadType:     out.loadType,
    loadDof:      out.loadDof,
    monitorDof:   out.monitorDof,
    loadAmp:      panelMeta.loadAmp,
    loadOmega:    panelMeta.loadOmega,
    // Results
    nSteps:       out.nSteps,
    N:            out.N,
    maxAbsDisp:   out.maxAbsDisp,
    maxAbsVel:    out.maxAbsVel,
    maxAbsAcc:    out.maxAbsAcc,
    elapsedMs:    out.elapsedMs,
    // Histories — Array.from for JSON-safety.
    times:        Array.from(out.times),
    dispMonitor:  Array.from(out.dispMonitor),
    velMonitor:   Array.from(out.velMonitor),
    accMonitor:   Array.from(out.accMonitor),
    energy:       Array.from(out.energy),
    // Fixture metadata
    fixture: panelMeta.fixture,
    // Final state
    finalDisp: out.finalU[out.monitorDof],
    finalVel:  out.finalV[out.monitorDof],
    finalAcc:  out.finalA[out.monitorDof],
  };
}

// ─────────────────────────────────────────────────────────────────────
// Main panel.

export function TransientFeaPanel({ open, onClose }) {
  const [dt,    setDt]    = useState(TRANSIENT_DEFAULTS.DT);     // 0.01
  const [tEnd,  setTEnd]  = useState(TRANSIENT_DEFAULTS.T_END);  // 2.0
  const [beta,  setBeta]  = useState(TRANSIENT_DEFAULTS.BETA);   // 0.25
  const [gamma, setGamma] = useState(TRANSIENT_DEFAULTS.GAMMA);  // 0.5
  const [alphaR, setAlphaR] = useState(TRANSIENT_DEFAULTS.ALPHA_RAYLEIGH);
  const [betaR,  setBetaR]  = useState(TRANSIENT_DEFAULTS.BETA_RAYLEIGH);
  const [loadType, setLoadType] = useState(LOAD_TYPES.IMPULSE);
  const [loadAmp,  setLoadAmp]  = useState(1.0);
  const [loadOmega, setLoadOmega] = useState(2 * Math.PI); // resonance for SDOF
  const [initialDisp, setInitialDisp] = useState(1.0); // 1 m for free-vibration demo
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (!open) {
      setRunning(false);
      setErrorMsg(null);
    }
  }, [open]);

  const onChangeDt    = useCallback((e) => {
    const v = +e.target.value;
    if (Number.isFinite(v) && v > 0) setDt(v);
  }, []);
  const onChangeTEnd  = useCallback((e) => {
    const v = +e.target.value;
    if (Number.isFinite(v) && v > 0) setTEnd(v);
  }, []);
  const onChangeBeta  = useCallback((e) => {
    const v = +e.target.value;
    if (Number.isFinite(v) && v >= 0) setBeta(v);
  }, []);
  const onChangeGamma = useCallback((e) => {
    const v = +e.target.value;
    if (Number.isFinite(v) && v >= 0) setGamma(v);
  }, []);
  const onChangeAlphaR = useCallback((e) => {
    const v = +e.target.value;
    if (Number.isFinite(v)) setAlphaR(v);
  }, []);
  const onChangeBetaR  = useCallback((e) => {
    const v = +e.target.value;
    if (Number.isFinite(v)) setBetaR(v);
  }, []);
  const onChangeLoadType = useCallback((e) => {
    setLoadType(e.target.value);
  }, []);
  const onChangeLoadAmp = useCallback((e) => {
    const v = +e.target.value;
    if (Number.isFinite(v)) setLoadAmp(v);
  }, []);
  const onChangeLoadOmega = useCallback((e) => {
    const v = +e.target.value;
    if (Number.isFinite(v) && v >= 0) setLoadOmega(v);
  }, []);
  const onChangeInitialDisp = useCallback((e) => {
    const v = +e.target.value;
    if (Number.isFinite(v)) setInitialDisp(v);
  }, []);

  const onRun = useCallback(() => {
    setRunning(true);
    setErrorMsg(null);
    setTimeout(() => {
      try {
        const fixture = buildSdofFixture({ K: 4 * Math.PI * Math.PI, m: 1 });
        const N = fixture.nodes.length; // 2 nodes × 1 DOF = 2 global DOFs
        const initialU = new Float64Array(N);
        const initialV = new Float64Array(N);
        // Monitor / load on free node (dof index 1 — node 0 is pinned).
        const monitorDof = 1;
        const loadDof    = 1;
        initialU[1] = initialDisp;
        const out = solveTransient({
          nodes:    fixture.nodes,
          elements: fixture.elements,
          dt, tEnd,
          beta, gamma,
          alphaRayleigh: alphaR,
          betaRayleigh:  betaR,
          loadType,
          loadDof,
          loadAmp,
          loadOmega,
          loadTStart: 0,
          monitorDof,
          initialU,
          initialV,
        });
        const snap = snapshotResult(out, {
          loadAmp, loadOmega,
          fixture: {
            type: 'sdof-mass-spring',
            K: 4 * Math.PI * Math.PI,
            m: 1,
            naturalOmega: fixture.naturalOmega,
            naturalFreqHz: fixture.naturalFreqHz,
            naturalPeriod: fixture.naturalPeriod,
            monitorDof,
            loadDof,
            initialDisp,
          },
        });
        setResult({ out, snap });
        if (typeof window !== 'undefined') {
          window.__forgeTransientFeaLast = snap;
          try {
            window.dispatchEvent(new CustomEvent('forge:transient-fea-complete', {
              detail: snap,
            }));
          } catch { /* ignore */ }
        }
      } catch (err) {
        setErrorMsg(err && err.message ? err.message : String(err));
      } finally {
        setRunning(false);
      }
    }, 50);
  }, [dt, tEnd, beta, gamma, alphaR, betaR,
      loadType, loadAmp, loadOmega, initialDisp]);

  // ─── Derived display values ───
  const histTimes = result?.snap.times || null;
  const histDisp  = result?.snap.dispMonitor || null;

  if (!open) return null;

  return createPortal(
    <aside role="region"
           aria-label="Transient dynamics FEA panel"
           data-testid="forge-transient-fea-panel"
           style={{
             position: 'fixed',
             top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
             right: 0,
             width: TRANSIENT_PANEL_WIDTH,
             maxWidth: '96vw',
             height: 'calc(100vh - var(--forge-topbar-h, 40px) - var(--forge-qat-h, 32px) - var(--forge-cmdbar-h, 24px))',
             background: 'var(--forge-canvas-2, #161b22)',
             borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
             boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
             display: 'flex', flexDirection: 'column',
             fontSize: 12,
             color: 'var(--forge-ink, #dadde2)',
             zIndex: 1296,
             overflowY: 'auto',
           }}>

      <header style={{
        padding: '10px 12px',
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
        background: 'var(--forge-canvas, #0e1117)',
        display: 'flex', alignItems: 'center', gap: 8,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>
          Transient Dynamics (Newmark-β)
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onClose}
                aria-label="Close transient FEA panel"
                data-testid="forge-transient-fea-close"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--forge-ink-mute, #9aa1ab)', cursor: 'pointer',
                  display: 'inline-flex', padding: 2,
                  fontSize: 16,
                  fontFamily: 'var(--forge-mono, monospace)',
                }}>
          ×
        </button>
      </header>

      <section style={{
        padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10,
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        <div style={{
          color: 'var(--forge-ink-mute, #9aa1ab)',
          fontSize: 11, lineHeight: 1.4,
        }}>
          SDOF mass-spring fixture (M = 1 kg, K = 4π² N/m → f<sub>n</sub> = 1 Hz).
          Solves M·ü + C·u̇ + K·u = f(t) via Newmark-β implicit integration.
          C = α·M + β<sub>R</sub>·K (Rayleigh).
        </div>
      </section>

      <section style={{
        padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10,
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
        }}>
          <Field label="dt (s)" testId="forge-transient-fea-dt"
                 value={dt} onChange={onChangeDt}
                 min={1e-6} max={1} step={0.001} type="number" />
          <Field label="T total (s)" testId="forge-transient-fea-tend"
                 value={tEnd} onChange={onChangeTEnd}
                 min={1e-3} max={1000} step={0.1} type="number" />
          <Field label="Newmark β" testId="forge-transient-fea-beta"
                 value={beta} onChange={onChangeBeta}
                 min={0} max={1} step={0.01} type="number" />
          <Field label="Newmark γ" testId="forge-transient-fea-gamma"
                 value={gamma} onChange={onChangeGamma}
                 min={0} max={1} step={0.05} type="number" />
          <Field label="Rayleigh α" testId="forge-transient-fea-alphaR"
                 value={alphaR} onChange={onChangeAlphaR}
                 min={0} max={100} step={0.01} type="number" />
          <Field label="Rayleigh β" testId="forge-transient-fea-betaR"
                 value={betaR} onChange={onChangeBetaR}
                 min={0} max={1} step={0.001} type="number" />
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
        }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{
              fontSize: 9,
              color: 'var(--forge-ink-mute, #9aa1ab)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>Load type</span>
            <select value={loadType}
                    onChange={onChangeLoadType}
                    data-testid="forge-transient-fea-loadtype"
                    style={selectStyle}>
              <option value={LOAD_TYPES.IMPULSE}>Impulse</option>
              <option value={LOAD_TYPES.SINE}>Sinusoidal</option>
              <option value={LOAD_TYPES.STEP}>Step</option>
              <option value={LOAD_TYPES.ZERO}>Zero (free)</option>
            </select>
          </label>
          <Field label="F amp (N)" testId="forge-transient-fea-loadamp"
                 value={loadAmp} onChange={onChangeLoadAmp}
                 min={-1e6} max={1e6} step={0.1} type="number" />
          <Field label="ω forcing (rad/s)" testId="forge-transient-fea-loadomega"
                 value={loadOmega} onChange={onChangeLoadOmega}
                 min={0} max={1e6} step={0.1} type="number" />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <Field label="Initial u (m)" testId="forge-transient-fea-u0"
                 value={initialDisp} onChange={onChangeInitialDisp}
                 min={-100} max={100} step={0.01} type="number" />
        </div>

        <div>
          <button type="button"
                  onClick={onRun}
                  disabled={running}
                  data-testid="forge-transient-fea-run"
                  style={{
                    width: '100%',
                    background: running
                      ? 'var(--forge-canvas, #0e1117)'
                      : 'var(--forge-accent-mute, #1f3a72)',
                    border: '1px solid var(--forge-accent-rim, #3a7afe)',
                    borderRadius: 3,
                    color: 'var(--forge-ink, #dadde2)',
                    font: 'inherit', fontSize: 11,
                    padding: '6px 10px',
                    cursor: running ? 'wait' : 'pointer',
                    opacity: running ? 0.5 : 1,
                  }}>
            {running ? 'Solving…' : 'Run transient simulation'}
          </button>
        </div>

        {errorMsg ? (
          <div data-testid="forge-transient-fea-error"
               style={{
                 color: 'var(--forge-err, #ff6363)',
                 background: 'var(--forge-canvas, #0e1117)',
                 padding: '4px 8px',
                 fontFamily: 'var(--forge-mono, monospace)',
                 fontSize: 10,
                 border: '1px solid var(--forge-err, #ff6363)',
                 borderRadius: 3,
               }}>
            error: {errorMsg}
          </div>
        ) : null}
      </section>

      {result && (
        <section style={{
          padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10,
          borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Chip label="Steps" value={result.snap.nSteps}
                  testId="forge-transient-fea-chip-steps" />
            <Chip label="dt" value={result.snap.dt.toExponential(2)} units="s"
                  testId="forge-transient-fea-chip-dt" />
            <Chip label="T" value={result.snap.tEnd.toFixed(3)} units="s"
                  testId="forge-transient-fea-chip-tend" />
            <Chip label="β" value={result.snap.beta.toFixed(3)}
                  testId="forge-transient-fea-chip-beta" />
            <Chip label="γ" value={result.snap.gamma.toFixed(3)}
                  testId="forge-transient-fea-chip-gamma" />
            <Chip label="α (Ray)" value={result.snap.alphaRayleigh.toFixed(3)}
                  testId="forge-transient-fea-chip-alphaR" />
            <Chip label="βR (Ray)" value={result.snap.betaRayleigh.toFixed(3)}
                  testId="forge-transient-fea-chip-betaR" />
            <Chip label="solve t" value={result.snap.elapsedMs.toFixed(1)}
                  units="ms"
                  testId="forge-transient-fea-chip-elapsed" />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Chip label="max |u|"
                  value={result.snap.maxAbsDisp.toExponential(3)} units="m"
                  testId="forge-transient-fea-chip-maxdisp" big />
            <Chip label="max |u̇|"
                  value={result.snap.maxAbsVel.toExponential(3)} units="m/s"
                  testId="forge-transient-fea-chip-maxvel" big />
            <Chip label="max |ü|"
                  value={result.snap.maxAbsAcc.toExponential(3)} units="m/s²"
                  testId="forge-transient-fea-chip-maxacc" big />
          </div>
        </section>
      )}

      {result && (
        <section style={{
          padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10,
          borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
          <TimeHistoryPlot times={histTimes}
                           values={histDisp}
                           label="Monitor node · displacement u(t)"
                           testId="forge-transient-fea-plot-disp"
                           color="var(--forge-accent-rim, #3a7afe)" />
          <TimeHistoryPlot times={histTimes}
                           values={result?.snap.velMonitor}
                           label="Monitor node · velocity u̇(t)"
                           testId="forge-transient-fea-plot-vel"
                           color="var(--forge-warn, #f0a020)" />
          <TimeHistoryPlot times={histTimes}
                           values={result?.snap.accMonitor}
                           label="Monitor node · acceleration ü(t)"
                           testId="forge-transient-fea-plot-acc"
                           color="var(--forge-err, #ff6363)" />
          <TimeHistoryPlot times={histTimes}
                           values={result?.snap.energy}
                           label="Total mechanical energy E(t) = ½ u̇ᵀMu̇ + ½ uᵀKu"
                           testId="forge-transient-fea-plot-energy"
                           color="var(--forge-ok, #4caf50)" />
        </section>
      )}

      <section style={{
        padding: '10px 12px',
        marginTop: 'auto',
        background: 'var(--forge-canvas, #0e1117)',
        borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
        fontSize: 10,
        fontFamily: 'var(--forge-mono, monospace)',
        color: 'var(--forge-ink-mute, #9aa1ab)',
        lineHeight: 1.5,
      }}>
        Newmark-β implicit time integration · γ = 1/2, β = 1/4 ⇒
        A-stable · K<sub>eff</sub> = K + (γ/(β·dt))C + (1/(β·dt²))M ·
        Rayleigh damping C = α·M + β<sub>R</sub>·K · dense LU solver.
      </section>
    </aside>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Field helper — small labeled input.

const selectStyle = {
  background: 'var(--forge-canvas, #0e1117)',
  color: 'var(--forge-ink, #dadde2)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3,
  padding: '3px 6px',
  fontFamily: 'var(--forge-mono, monospace)',
  fontSize: 11,
};

function Field({ label, value, onChange, testId, type = 'number',
                 min, max, step }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
      <span style={{
        fontSize: 9,
        color: 'var(--forge-ink-mute, #9aa1ab)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>{label}</span>
      <input type={type}
             value={value}
             onChange={onChange}
             min={min} max={max} step={step}
             data-testid={testId}
             style={selectStyle} />
    </label>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host.

export function TransientFeaPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenTransientFea  = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseTransientFea = () => setOpen(false);

    // Headless solver surface — the e2e + Archie drive solver
    // calculations through this without mounting React.
    if (!window.__forgeTransientFeaHelper) {
      window.__forgeTransientFeaHelper = makeTransientFeaHelper();
    }

    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.transientFea') {
        setOpen(true);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenTransientFea; } catch {}
      try { delete window.__forgeCloseTransientFea; } catch {}
      try { delete window.__forgeTransientFeaHelper; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return (
    <TransientFeaPanel open={open} onClose={() => setOpen(false)} />
  );
}

export default TransientFeaPanel;
