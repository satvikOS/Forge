// PUSH-220 (Slice-152) — Real Nonlinear Static FEA panel.
//
// Drives nonlinearFea.js (Newton-Raphson + J2 radial-return + H8 hex
// elements + Jacobi-PCG linear solve) headlessly inside the React shell.
//
// UI contract
// -----------
//
//   * Material card — E (Young), ν (Poisson), σ_y (initial yield),
//     H (linear isotropic hardening modulus). Steel preset prefilled.
//   * Geometry card — # elements along x for the bar (1, 2, 5 or 10),
//     bar length L, cross-section A = (L/5)².
//   * Load card — total prescribed end-displacement, # load increments
//     (slider 5 → 50), Newton iteration cap.
//   * Run button — solveNonlinearStatic on the configured mesh.
//   * Result chips — converged?, final residual, max plastic strain,
//     final stress, reaction force at the loaded face.
//   * Load-displacement curve (SVG polyline). x = strain, y = engineering
//     stress in MPa. Yield plateau + hardening slope are immediately
//     readable.
//   * Plastic-strain history chart (log-scale).
//   * Increment table — per-increment lambda, Newton iters, CG iters,
//     reaction, p_eqv.
//
// Window surface
// --------------
//
//   * window.__forgeOpenNonlinearFea(true|false)
//   * window.__forgeCloseNonlinearFea()
//   * window.__forgeNonlinearFeaHelper            — solver export surface
//                                                   (e2e drives it headlessly)
//   * window.__forgeNonlinearFeaLast              — last solve snapshot
//                                                   (mat, geom, history,
//                                                    final stress, etc.)
//
// Custom event: forge:nonlinearFea-solve-complete with detail = snapshot.
//
// Hard constraints
// ----------------
//   * NO new npm / C++ deps. Pure React + SVG.
//   * Real radial-return + Newton + Jacobi-PCG (no stubs / fake numbers).
//
// Multi-cam e2e mandates 5 named camera angles per the Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  makeBarMesh,
  solveNonlinearStatic,
  driveUniaxialTension,
  driveBarHardening,
  validateUniaxialTension,
  validateBarHardening,
  makeNonlinearFeaHelper,
  SOLVE_DEFAULTS,
} from './nonlinearFea.js';

// ─────────────────────────────────────────────────────────────────────
// Constants.

export const NLFEA_DEFAULTS = Object.freeze({
  E:           210e9,     // Pa  steel
  nu:          0.3,
  sigY0:       250e6,     // Pa  mild-steel yield
  H:           1e9,       // Pa  linear isotropic hardening
  nx:          1,         // 1-element validation
  L:           0.01,      // 10 mm bar
  nIncrements: 20,
  newtonMaxIter: 25,
});

export const NLFEA_ELEM_OPTIONS = Object.freeze([1, 2, 5, 10]);
export const NLFEA_INCR_MIN = 5;
export const NLFEA_INCR_MAX = 50;
export const NLFEA_PANEL_WIDTH = 460;
export const NLFEA_CHART_PX = { w: 360, h: 160 };

// Material presets (the panel exposes a dropdown so the e2e can switch
// presets without typing).
export const NLFEA_MATERIAL_PRESETS = Object.freeze([
  { id: 'steel',    name: 'Mild Steel',    E: 210e9, nu: 0.3,  sigY0: 250e6, H: 1e9 },
  { id: 'aluminium', name: 'Aluminium',     E: 69e9,  nu: 0.33, sigY0: 95e6,  H: 5e8 },
  { id: 'titanium', name: 'Ti-6Al-4V',     E: 113.8e9, nu: 0.342, sigY0: 880e6, H: 3e9 },
  { id: 'copper',   name: 'OFE Copper',    E: 110e9, nu: 0.34, sigY0: 70e6,  H: 4e8 },
]);

// ─────────────────────────────────────────────────────────────────────
// Snapshot helper — turn driver output into JSON-safe object.

function snapshotResult(driverOut, panelMeta) {
  const last = driverOut.history.length
    ? driverOut.history[driverOut.history.length - 1] : null;
  return {
    mat: {
      E:     panelMeta.E,
      nu:    panelMeta.nu,
      sigY0: panelMeta.sigY0,
      H:     panelMeta.H,
    },
    geom: {
      nx:    panelMeta.nx,
      L:     panelMeta.L,
      A:     driverOut.A,
    },
    nIncrements:        driverOut.history.length,
    targetIncrements:   panelMeta.nIncrements,
    maxDisp:            driverOut.maxDisp,
    yieldStrain:        driverOut.yieldStrain,
    converged:          driverOut.converged,
    history:            driverOut.history.map((h) => ({
      increment:     h.increment,
      lambda:        h.lambda,
      newtonIters:   h.newtonIters,
      cgIters:       h.cgIters,
      residual:      h.residual,
      residualInitial: h.residualInitial,
      maxDisp:       h.maxDisp,
      maxPEqv:       h.maxPEqv,
      reactionForce: h.reactionForce,
      plasticGPCount: h.plasticGPCount,
      diverged:      h.diverged || false,
    })),
    finalResidual:     last ? last.residual : null,
    finalMaxPEqv:      last ? last.maxPEqv : 0,
    finalReaction:     last ? last.reactionForce : 0,
    finalStress:       last && driverOut.A > 0
      ? last.reactionForce / driverOut.A : 0,
    finalStrain:       last && panelMeta.L > 0
      ? (last.lambda * driverOut.maxDisp) / panelMeta.L : 0,
    finalPlasticGPs:   last ? last.plasticGPCount : 0,
    strainTrace:       driverOut.strainTrace,
    engStressTrace:    driverOut.engStressTrace,
    reactionTrace:     driverOut.reactionTrace,
    dispTrace:         driverOut.dispTrace,
    mode:              panelMeta.mode,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Chip — label + value (mirror Cfd3dPanel).

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
            minWidth: 80,
          }}>
      <span style={{
        fontSize: 8,
        color: 'var(--forge-ink-mute, #9aa1ab)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>{label}</span>
      <span>
        {value}
        {units ? (
          <span style={{
            color: 'var(--forge-ink-mute, #9aa1ab)',
            fontSize: big ? 9 : 8,
            marginLeft: 4,
          }}>{units}</span>
        ) : null}
      </span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Load-displacement curve (engineering stress vs. engineering strain).

function LoadDispChart({ strainTrace, stressTrace, yieldStress, label }) {
  const { w, h } = NLFEA_CHART_PX;
  if (!strainTrace || !strainTrace.length || !stressTrace || !stressTrace.length) {
    return (
      <div data-testid="forge-nlfea-loaddisp-empty"
           style={{
             padding: '14px 6px', fontSize: 11,
             color: 'var(--forge-ink-mute, #9aa1ab)',
             fontStyle: 'italic',
           }}>
        Load-displacement curve appears after the first solve.
      </div>
    );
  }
  const pad = 30;
  const innerW = w - 2 * pad;
  const innerH = h - 2 * pad;
  let mnX = Infinity, mxX = -Infinity, mnY = Infinity, mxY = -Infinity;
  for (let i = 0; i < strainTrace.length; i++) {
    const x = strainTrace[i];
    const y = stressTrace[i] / 1e6;  // MPa
    if (x < mnX) mnX = x; if (x > mxX) mxX = x;
    if (y < mnY) mnY = y; if (y > mxY) mxY = y;
  }
  if (!Number.isFinite(mnX) || !Number.isFinite(mxX)) { mnX = 0; mxX = 1; }
  if (mxX - mnX < 1e-12) mxX = mnX + 1e-12;
  if (mxY - mnY < 1e-3) mxY = mnY + 1e-3;
  // Always start the y-axis at 0 for clarity.
  mnY = 0;
  const xMap = (x) => pad + ((x - mnX) / (mxX - mnX)) * innerW;
  const yMap = (y) => pad + (1 - (y - mnY) / (mxY - mnY)) * innerH;
  const points = strainTrace.map((x, i) => {
    return `${xMap(x).toFixed(2)},${yMap(stressTrace[i] / 1e6).toFixed(2)}`;
  }).join(' ');
  const yieldStressMPa = (yieldStress || 0) / 1e6;

  return (
    <div data-testid="forge-nlfea-loaddisp"
         data-points={strainTrace.length}
         data-max-strain={mxX.toExponential(3)}
         data-max-stress-mpa={mxY.toFixed(3)}
         data-yield-mpa={yieldStressMPa.toFixed(3)}
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
        display: 'flex', justifyContent: 'space-between',
      }}>
        <span>{label || 'load-displacement'}</span>
        <span>σ (MPa) vs ε</span>
      </div>
      <svg width={w} height={h}
           viewBox={`0 0 ${w} ${h}`}
           xmlns="http://www.w3.org/2000/svg"
           style={{ display: 'block' }}>
        {/* axes */}
        <line x1={pad} y1={pad + innerH} x2={pad + innerW} y2={pad + innerH}
              stroke="var(--forge-rail-edge, #2a2d34)" strokeWidth={1} />
        <line x1={pad} y1={pad}          x2={pad}        y2={pad + innerH}
              stroke="var(--forge-rail-edge, #2a2d34)" strokeWidth={1} />
        {/* yield line */}
        {yieldStressMPa > 0 && yieldStressMPa >= mnY && yieldStressMPa <= mxY ? (
          <g data-testid="forge-nlfea-yield-line">
            <line x1={pad}
                  x2={pad + innerW}
                  y1={yMap(yieldStressMPa)}
                  y2={yMap(yieldStressMPa)}
                  stroke="var(--forge-warn, #f0a020)"
                  strokeWidth={1}
                  strokeDasharray="3,2" />
            <text x={pad + innerW - 4}
                  y={yMap(yieldStressMPa) - 3}
                  textAnchor="end"
                  fill="var(--forge-warn, #f0a020)"
                  fontSize={9}
                  fontFamily="var(--forge-mono, monospace)">
              σ_y = {yieldStressMPa.toFixed(1)} MPa
            </text>
          </g>
        ) : null}
        {/* data polyline */}
        <polyline points={points}
                  fill="none"
                  stroke="var(--forge-accent-rim, #3a7afe)"
                  strokeWidth={1.5} />
        {/* sample dots */}
        {strainTrace.map((x, i) => (
          <circle key={i} cx={xMap(x)} cy={yMap(stressTrace[i] / 1e6)}
                  r={1.5}
                  fill="var(--forge-accent-rim, #3a7afe)" />
        ))}
        {/* axis labels */}
        <text x={pad + innerW / 2} y={h - 6}
              textAnchor="middle"
              fill="var(--forge-ink-mute, #9aa1ab)"
              fontSize={9}
              fontFamily="var(--forge-mono, monospace)">strain ε</text>
        <text x={8} y={pad + innerH / 2}
              transform={`rotate(-90 8 ${pad + innerH / 2})`}
              textAnchor="middle"
              fill="var(--forge-ink-mute, #9aa1ab)"
              fontSize={9}
              fontFamily="var(--forge-mono, monospace)">σ (MPa)</text>
        {/* tick labels */}
        <text x={pad} y={pad + innerH + 12}
              textAnchor="middle"
              fill="var(--forge-ink-mute, #9aa1ab)"
              fontSize={8}
              fontFamily="var(--forge-mono, monospace)">{mnX.toExponential(1)}</text>
        <text x={pad + innerW} y={pad + innerH + 12}
              textAnchor="middle"
              fill="var(--forge-ink-mute, #9aa1ab)"
              fontSize={8}
              fontFamily="var(--forge-mono, monospace)">{mxX.toExponential(1)}</text>
        <text x={pad - 4} y={pad}
              textAnchor="end"
              fill="var(--forge-ink-mute, #9aa1ab)"
              fontSize={8}
              fontFamily="var(--forge-mono, monospace)">{mxY.toFixed(0)}</text>
        <text x={pad - 4} y={pad + innerH}
              textAnchor="end"
              fill="var(--forge-ink-mute, #9aa1ab)"
              fontSize={8}
              fontFamily="var(--forge-mono, monospace)">0</text>
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Plastic-strain history chart (linear y from 0 → max).

function PlasticStrainChart({ history }) {
  const { w, h } = NLFEA_CHART_PX;
  if (!history || !history.length) {
    return (
      <div data-testid="forge-nlfea-pchart-empty"
           style={{
             padding: '14px 6px', fontSize: 11,
             color: 'var(--forge-ink-mute, #9aa1ab)',
             fontStyle: 'italic',
           }}>
        Plastic-strain chart appears after the first solve.
      </div>
    );
  }
  const pad = 30;
  const innerW = w - 2 * pad;
  const innerH = h - 2 * pad;
  const ys = history.map((h) => h.maxPEqv);
  let mx = 0;
  for (const v of ys) if (v > mx) mx = v;
  if (mx <= 0) mx = 1e-6;
  const points = ys.map((v, i) => {
    const x = pad + (i / Math.max(1, ys.length - 1)) * innerW;
    const y = pad + (1 - v / mx) * innerH;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  return (
    <div data-testid="forge-nlfea-pchart"
         data-max-peqv={mx.toExponential(3)}
         data-points={ys.length}
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
      }}>plastic strain p_eqv · max = {mx.toExponential(3)}</div>
      <svg width={w} height={h}
           viewBox={`0 0 ${w} ${h}`}
           xmlns="http://www.w3.org/2000/svg"
           style={{ display: 'block' }}>
        <line x1={pad} y1={pad + innerH} x2={pad + innerW} y2={pad + innerH}
              stroke="var(--forge-rail-edge, #2a2d34)" strokeWidth={1} />
        <line x1={pad} y1={pad}          x2={pad}        y2={pad + innerH}
              stroke="var(--forge-rail-edge, #2a2d34)" strokeWidth={1} />
        <polyline points={points}
                  fill="none"
                  stroke="var(--forge-warn, #f0a020)"
                  strokeWidth={1.5} />
        {ys.map((v, i) => (
          <circle key={i}
                  cx={pad + (i / Math.max(1, ys.length - 1)) * innerW}
                  cy={pad + (1 - v / mx) * innerH}
                  r={1.5}
                  fill="var(--forge-warn, #f0a020)" />
        ))}
        <text x={pad + innerW / 2} y={h - 6}
              textAnchor="middle"
              fill="var(--forge-ink-mute, #9aa1ab)"
              fontSize={9}
              fontFamily="var(--forge-mono, monospace)">increment</text>
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Increment history table.

function HistoryRow({ row }) {
  return (
    <tr data-testid="forge-nlfea-hist-row"
        data-lambda={row.lambda.toFixed(4)}
        data-newton-iters={row.newtonIters}
        data-cg-iters={row.cgIters}
        data-peqv={row.maxPEqv.toExponential(3)}
        data-reaction={row.reactionForce.toFixed(3)}>
      <td style={{ padding: '2px 6px',
                   fontFamily: 'var(--forge-mono, monospace)',
                   fontSize: 10 }}>{row.increment}</td>
      <td style={{ padding: '2px 6px', textAlign: 'right',
                   fontFamily: 'var(--forge-mono, monospace)',
                   fontSize: 10 }}>{row.lambda.toFixed(3)}</td>
      <td style={{ padding: '2px 6px', textAlign: 'right',
                   fontFamily: 'var(--forge-mono, monospace)',
                   fontSize: 10 }}>{row.newtonIters}</td>
      <td style={{ padding: '2px 6px', textAlign: 'right',
                   fontFamily: 'var(--forge-mono, monospace)',
                   fontSize: 10 }}>{row.cgIters}</td>
      <td style={{ padding: '2px 6px', textAlign: 'right',
                   fontFamily: 'var(--forge-mono, monospace)',
                   fontSize: 10,
                   color: row.maxPEqv > 0
                     ? 'var(--forge-warn, #f0a020)'
                     : 'var(--forge-ink, #dadde2)' }}>
        {row.maxPEqv > 1e-15 ? row.maxPEqv.toExponential(2) : '–'}
      </td>
      <td style={{ padding: '2px 6px', textAlign: 'right',
                   fontFamily: 'var(--forge-mono, monospace)',
                   fontSize: 10 }}>{row.reactionForce.toFixed(1)}</td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Main panel.

export function NonlinearFeaPanel({ open, onClose }) {
  const [E,     setE]     = useState(NLFEA_DEFAULTS.E);
  const [nu,    setNu]    = useState(NLFEA_DEFAULTS.nu);
  const [sigY0, setSigY0] = useState(NLFEA_DEFAULTS.sigY0);
  const [H,     setH]     = useState(NLFEA_DEFAULTS.H);
  const [nx,    setNx]    = useState(NLFEA_DEFAULTS.nx);
  const [L,     setL]     = useState(NLFEA_DEFAULTS.L);
  const [nIncrements, setNIncr] = useState(NLFEA_DEFAULTS.nIncrements);
  const [newtonMaxIter, setNewtonMaxIter] = useState(NLFEA_DEFAULTS.newtonMaxIter);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [mode, setMode] = useState('uniaxial'); // 'uniaxial' | 'bar'

  useEffect(() => {
    if (!open) {
      setRunning(false);
      setErrorMsg(null);
    }
  }, [open]);

  const onChangeE = useCallback((e) => {
    const v = +e.target.value;
    if (Number.isFinite(v) && v > 0) setE(v);
  }, []);
  const onChangeNu = useCallback((e) => {
    const v = +e.target.value;
    if (Number.isFinite(v) && v > -1 && v < 0.5) setNu(v);
  }, []);
  const onChangeSigY = useCallback((e) => {
    const v = +e.target.value;
    if (Number.isFinite(v) && v > 0) setSigY0(v);
  }, []);
  const onChangeH = useCallback((e) => {
    const v = +e.target.value;
    if (Number.isFinite(v) && v >= 0) setH(v);
  }, []);
  const onChangeNx = useCallback((e) => {
    const v = e.target.value | 0;
    if (NLFEA_ELEM_OPTIONS.includes(v)) setNx(v);
  }, []);
  const onChangeL = useCallback((e) => {
    const v = +e.target.value;
    if (Number.isFinite(v) && v > 0) setL(v);
  }, []);
  const onChangeIncr = useCallback((e) => {
    const v = e.target.value | 0;
    if (Number.isFinite(v) && v >= NLFEA_INCR_MIN && v <= NLFEA_INCR_MAX) {
      setNIncr(v);
    }
  }, []);
  const onChangeNewtonCap = useCallback((e) => {
    const v = e.target.value | 0;
    if (Number.isFinite(v) && v >= 5 && v <= 100) {
      setNewtonMaxIter(v);
    }
  }, []);
  const onChangePreset = useCallback((e) => {
    const id = e.target.value;
    const p = NLFEA_MATERIAL_PRESETS.find((m) => m.id === id);
    if (p) {
      setE(p.E); setNu(p.nu); setSigY0(p.sigY0); setH(p.H);
    }
  }, []);

  const runSolve = useCallback((modeId) => {
    setRunning(true);
    setErrorMsg(null);
    setMode(modeId);
    setTimeout(() => {
      try {
        const driver = modeId === 'bar' ? driveBarHardening : driveUniaxialTension;
        const driverOut = driver({
          E, nu, sigY0, H,
          nx: modeId === 'bar' ? nx : 1,
          L,
          nIncrements,
          newtonMaxIter,
          newtonTol: 1e-5,
        });
        const snap = snapshotResult(driverOut, {
          E, nu, sigY0, H,
          nx: modeId === 'bar' ? nx : 1,
          L,
          nIncrements,
          mode: modeId,
        });
        setResult({ driverOut, snapshot: snap });
        if (typeof window !== 'undefined') {
          window.__forgeNonlinearFeaLast = snap;
          try {
            window.dispatchEvent(new CustomEvent('forge:nonlinearFea-solve-complete', {
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
  }, [E, nu, sigY0, H, nx, L, nIncrements, newtonMaxIter]);

  const onRunUniaxial = useCallback(() => runSolve('uniaxial'), [runSolve]);
  const onRunBar      = useCallback(() => runSolve('bar'),      [runSolve]);

  if (!open) return null;

  return createPortal(
    <aside role="region"
           aria-label="Nonlinear FEA (Newton-Raphson + J2 plasticity)"
           data-testid="forge-nlfea-panel"
           data-mode={mode}
           style={{
             position: 'fixed',
             top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
             right: 0,
             width: NLFEA_PANEL_WIDTH,
             maxWidth: '96vw',
             height: 'calc(100vh - var(--forge-topbar-h, 40px) - var(--forge-qat-h, 32px) - var(--forge-cmdbar-h, 24px))',
             background: 'var(--forge-canvas-2, #161b22)',
             borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
             boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
             display: 'flex', flexDirection: 'column',
             fontSize: 12,
             color: 'var(--forge-ink, #dadde2)',
             zIndex: 1295,
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
          Nonlinear Static FEA · Newton-Raphson + J2
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onClose}
                aria-label="Close Nonlinear FEA panel"
                data-testid="forge-nlfea-close"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--forge-ink-mute, #9aa1ab)', cursor: 'pointer',
                  display: 'inline-flex', padding: 2,
                  fontSize: 16,
                  fontFamily: 'var(--forge-mono, monospace)',
                }}>×</button>
      </header>

      {/* Material card */}
      <section style={{
        padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10,
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        <div style={{
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>Material (J2 + linear isotropic hardening)</div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{
            fontSize: 9,
            color: 'var(--forge-ink-mute, #9aa1ab)',
          }}>Preset</span>
          <select onChange={onChangePreset}
                  defaultValue="steel"
                  data-testid="forge-nlfea-preset"
                  style={{
                    background: 'var(--forge-canvas, #0e1117)',
                    color: 'var(--forge-ink, #dadde2)',
                    border: '1px solid var(--forge-rail-edge, #2a2d34)',
                    borderRadius: 3,
                    padding: '3px 6px',
                    fontFamily: 'var(--forge-mono, monospace)',
                    fontSize: 11,
                  }}>
            {NLFEA_MATERIAL_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.name} · σ_y = {(p.sigY0 / 1e6).toFixed(0)} MPa</option>
            ))}
          </select>
        </label>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
        }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{
              fontSize: 9,
              color: 'var(--forge-ink-mute, #9aa1ab)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>E · Young (Pa)</span>
            <input type="number"
                   step={1e9}
                   value={E}
                   onChange={onChangeE}
                   data-testid="forge-nlfea-E"
                   style={{
                     background: 'var(--forge-canvas, #0e1117)',
                     color: 'var(--forge-ink, #dadde2)',
                     border: '1px solid var(--forge-rail-edge, #2a2d34)',
                     borderRadius: 3,
                     padding: '3px 6px',
                     fontFamily: 'var(--forge-mono, monospace)',
                     fontSize: 11,
                   }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{
              fontSize: 9,
              color: 'var(--forge-ink-mute, #9aa1ab)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>ν · Poisson</span>
            <input type="number"
                   step={0.01}
                   min={-0.99} max={0.49}
                   value={nu}
                   onChange={onChangeNu}
                   data-testid="forge-nlfea-nu"
                   style={{
                     background: 'var(--forge-canvas, #0e1117)',
                     color: 'var(--forge-ink, #dadde2)',
                     border: '1px solid var(--forge-rail-edge, #2a2d34)',
                     borderRadius: 3,
                     padding: '3px 6px',
                     fontFamily: 'var(--forge-mono, monospace)',
                     fontSize: 11,
                   }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{
              fontSize: 9,
              color: 'var(--forge-ink-mute, #9aa1ab)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>σ_y · Yield (Pa)</span>
            <input type="number"
                   step={1e6}
                   value={sigY0}
                   onChange={onChangeSigY}
                   data-testid="forge-nlfea-sigY"
                   style={{
                     background: 'var(--forge-canvas, #0e1117)',
                     color: 'var(--forge-ink, #dadde2)',
                     border: '1px solid var(--forge-rail-edge, #2a2d34)',
                     borderRadius: 3,
                     padding: '3px 6px',
                     fontFamily: 'var(--forge-mono, monospace)',
                     fontSize: 11,
                   }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{
              fontSize: 9,
              color: 'var(--forge-ink-mute, #9aa1ab)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>H · Hardening (Pa)</span>
            <input type="number"
                   step={1e8}
                   value={H}
                   onChange={onChangeH}
                   data-testid="forge-nlfea-H"
                   style={{
                     background: 'var(--forge-canvas, #0e1117)',
                     color: 'var(--forge-ink, #dadde2)',
                     border: '1px solid var(--forge-rail-edge, #2a2d34)',
                     borderRadius: 3,
                     padding: '3px 6px',
                     fontFamily: 'var(--forge-mono, monospace)',
                     fontSize: 11,
                   }} />
          </label>
        </div>
      </section>

      {/* Geometry + solver card */}
      <section style={{
        padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10,
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        <div style={{
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>Geometry &amp; load</div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          gap: 8,
        }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{
              fontSize: 9,
              color: 'var(--forge-ink-mute, #9aa1ab)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}># elements (bar)</span>
            <select value={nx}
                    onChange={onChangeNx}
                    data-testid="forge-nlfea-nx"
                    style={{
                      background: 'var(--forge-canvas, #0e1117)',
                      color: 'var(--forge-ink, #dadde2)',
                      border: '1px solid var(--forge-rail-edge, #2a2d34)',
                      borderRadius: 3,
                      padding: '3px 6px',
                      fontFamily: 'var(--forge-mono, monospace)',
                      fontSize: 11,
                    }}>
              {NLFEA_ELEM_OPTIONS.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{
              fontSize: 9,
              color: 'var(--forge-ink-mute, #9aa1ab)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>L · length (m)</span>
            <input type="number"
                   step={0.001} min={0.001}
                   value={L}
                   onChange={onChangeL}
                   data-testid="forge-nlfea-L"
                   style={{
                     background: 'var(--forge-canvas, #0e1117)',
                     color: 'var(--forge-ink, #dadde2)',
                     border: '1px solid var(--forge-rail-edge, #2a2d34)',
                     borderRadius: 3,
                     padding: '3px 6px',
                     fontFamily: 'var(--forge-mono, monospace)',
                     fontSize: 11,
                   }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{
              fontSize: 9,
              color: 'var(--forge-ink-mute, #9aa1ab)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>Load incr.</span>
            <input type="number"
                   step={1} min={NLFEA_INCR_MIN} max={NLFEA_INCR_MAX}
                   value={nIncrements}
                   onChange={onChangeIncr}
                   data-testid="forge-nlfea-increments"
                   style={{
                     background: 'var(--forge-canvas, #0e1117)',
                     color: 'var(--forge-ink, #dadde2)',
                     border: '1px solid var(--forge-rail-edge, #2a2d34)',
                     borderRadius: 3,
                     padding: '3px 6px',
                     fontFamily: 'var(--forge-mono, monospace)',
                     fontSize: 11,
                   }} />
          </label>
        </div>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{
            fontSize: 9,
            color: 'var(--forge-ink-mute, #9aa1ab)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>Load increments · {nIncrements} steps</span>
          <input type="range"
                 min={NLFEA_INCR_MIN} max={NLFEA_INCR_MAX} step={1}
                 value={nIncrements}
                 onChange={onChangeIncr}
                 data-testid="forge-nlfea-incr-slider" />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{
            fontSize: 9,
            color: 'var(--forge-ink-mute, #9aa1ab)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>Newton iter cap (per increment)</span>
          <input type="number" min={5} max={100} step={1}
                 value={newtonMaxIter}
                 onChange={onChangeNewtonCap}
                 data-testid="forge-nlfea-newton-cap"
                 style={{
                   background: 'var(--forge-canvas, #0e1117)',
                   color: 'var(--forge-ink, #dadde2)',
                   border: '1px solid var(--forge-rail-edge, #2a2d34)',
                   borderRadius: 3,
                   padding: '3px 6px',
                   fontFamily: 'var(--forge-mono, monospace)',
                   fontSize: 11,
                 }} />
        </label>

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button"
                  onClick={onRunUniaxial}
                  disabled={running}
                  data-testid="forge-nlfea-run-uniaxial"
                  style={{
                    flex: 1,
                    background: running && mode === 'uniaxial'
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
            {running && mode === 'uniaxial'
              ? 'Solving…'
              : 'Run · Uniaxial tension'}
          </button>
          <button type="button"
                  onClick={onRunBar}
                  disabled={running}
                  data-testid="forge-nlfea-run-bar"
                  style={{
                    flex: 1,
                    background: running && mode === 'bar'
                      ? 'var(--forge-canvas, #0e1117)'
                      : 'var(--forge-canvas, #0e1117)',
                    border: '1px solid var(--forge-rail-edge, #2a2d34)',
                    borderRadius: 3,
                    color: 'var(--forge-ink, #dadde2)',
                    font: 'inherit', fontSize: 11,
                    padding: '6px 10px',
                    cursor: running ? 'wait' : 'pointer',
                    opacity: running ? 0.5 : 1,
                  }}>
            {running && mode === 'bar'
              ? 'Solving…'
              : `Run · ${nx}-elem bar`}
          </button>
        </div>

        {errorMsg ? (
          <div data-testid="forge-nlfea-error"
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

      {/* Result chips */}
      {result && (
        <section style={{
          padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10,
          borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Chip label="Mode"
                  value={mode === 'bar' ? `Bar nx=${result.snapshot.geom.nx}` : 'Uniaxial 1-elem'}
                  testId="forge-nlfea-chip-mode" />
            <Chip label="Increments"
                  value={result.snapshot.nIncrements}
                  testId="forge-nlfea-chip-incr" />
            <Chip label="Converged"
                  value={result.snapshot.converged ? 'YES' : 'NO'}
                  accent={result.snapshot.converged}
                  testId="forge-nlfea-chip-converged" big />
            <Chip label="Final σ"
                  value={(result.snapshot.finalStress / 1e6).toFixed(2)}
                  units="MPa"
                  testId="forge-nlfea-chip-stress" big />
            <Chip label="Final ε"
                  value={result.snapshot.finalStrain.toExponential(3)}
                  testId="forge-nlfea-chip-strain" />
            <Chip label="Max p_eqv"
                  value={result.snapshot.finalMaxPEqv.toExponential(3)}
                  testId="forge-nlfea-chip-peqv" big />
            <Chip label="Reaction"
                  value={result.snapshot.finalReaction.toFixed(2)}
                  units="N"
                  testId="forge-nlfea-chip-reaction" />
            <Chip label="Last r/r₀"
                  value={result.snapshot.finalResidual !== null
                    ? (result.snapshot.finalResidual /
                       Math.max(result.snapshot.history[0]?.residualInitial || 1, 1)).toExponential(2)
                    : '–'}
                  testId="forge-nlfea-chip-residual" />
            <Chip label="Plastic GPs"
                  value={result.snapshot.finalPlasticGPs}
                  testId="forge-nlfea-chip-plastic-gps" />
          </div>
        </section>
      )}

      {/* Charts */}
      {result && (
        <section style={{
          padding: '10px 12px',
          display: 'flex', flexDirection: 'column', gap: 10,
          borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
          <LoadDispChart
            strainTrace={result.snapshot.strainTrace}
            stressTrace={result.snapshot.engStressTrace}
            yieldStress={result.snapshot.mat.sigY0}
            label={`load-displacement · ${mode === 'bar' ? `${result.snapshot.geom.nx}-elem bar` : 'uniaxial'}`} />
          <PlasticStrainChart history={result.snapshot.history} />
        </section>
      )}

      {/* Increment history table */}
      {result && (
        <section data-testid="forge-nlfea-history"
                 style={{
                   padding: '10px 12px',
                   display: 'flex', flexDirection: 'column', gap: 6,
                 }}>
          <div style={{
            fontSize: 11, fontWeight: 600,
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>Load increment history</span>
            <span style={{
              fontFamily: 'var(--forge-mono, monospace)',
              fontSize: 10,
              color: 'var(--forge-ink-mute, #9aa1ab)',
            }}>{result.snapshot.nIncrements} of {result.snapshot.targetIncrements}</span>
          </div>
          <div style={{
            maxHeight: 200,
            overflowY: 'auto',
            border: '1px solid var(--forge-rail-edge, #2a2d34)',
          }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{
                  background: 'var(--forge-canvas-2, #161b22)',
                  position: 'sticky', top: 0,
                }}>
                  <th style={{ padding: '4px 6px', textAlign: 'left',
                               fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)',
                               textTransform: 'uppercase',
                               letterSpacing: '0.05em' }}>#</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right',
                               fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)',
                               textTransform: 'uppercase',
                               letterSpacing: '0.05em' }}>λ</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right',
                               fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)',
                               textTransform: 'uppercase',
                               letterSpacing: '0.05em' }}>NR</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right',
                               fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)',
                               textTransform: 'uppercase',
                               letterSpacing: '0.05em' }}>CG</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right',
                               fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)',
                               textTransform: 'uppercase',
                               letterSpacing: '0.05em' }}>p_eqv</th>
                  <th style={{ padding: '4px 6px', textAlign: 'right',
                               fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)',
                               textTransform: 'uppercase',
                               letterSpacing: '0.05em' }}>F (N)</th>
                </tr>
              </thead>
              <tbody>
                {result.snapshot.history.map((h, idx) => (
                  <HistoryRow key={idx} row={h} />
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* Footer description */}
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
        Newton-Raphson load-step driver · J2 (von Mises) radial-return
        plasticity · linear isotropic hardening · 8-node hex with
        2×2×2 Gauss integration · Jacobi-PCG linear solve · adaptive
        bisection on Newton divergence. Reference: Simo &amp; Hughes 1998 §3.
      </section>

    </aside>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host.

export function NonlinearFeaPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenNonlinearFea  = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseNonlinearFea = () => setOpen(false);

    if (!window.__forgeNonlinearFeaHelper) {
      window.__forgeNonlinearFeaHelper = makeNonlinearFeaHelper();
    }

    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.nonlinearFea') {
        setOpen(true);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenNonlinearFea; } catch {}
      try { delete window.__forgeCloseNonlinearFea; } catch {}
      try { delete window.__forgeNonlinearFeaHelper; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return <NonlinearFeaPanel open={open} onClose={() => setOpen(false)} />;
}

export default NonlinearFeaPanel;
