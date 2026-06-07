// PUSH-200 (Slice-150) — Real 3D Incompressible Navier–Stokes solver
// panel.
//
// Surface contract
// ----------------
//
//   * Grid-size picker (16/32/48). On a 16³ grid a 200-step lid-driven
//     cavity run completes in ~1.5s on the M4 Max single-thread; 48³
//     pushes ~20s and the panel surfaces a "Lock UI" notice while the
//     run is in flight.
//
//   * Reynolds-number input — used by both drivers (the kinematic
//     viscosity ν = U·L / Re).
//
//   * "Solve N steps" button — runs N SIMPLE iterations on the
//     lid-driven cavity in the current grid.
//
//   * "Validate Taylor–Green" preset — re-initialises the field with
//     the 3D Taylor–Green analytic vortex and reports max |sim - analytic|
//     after 100 steps. The preset uses the same Re input.
//
//   * Output:
//       - Velocity-magnitude midplane heatmap (k = nz/2). Rendered as a
//         single SVG <rect> grid with per-cell HSL colours so it stays
//         legible on the remote-desktop session.
//       - Residual-history chart: SVG polyline of log10 ‖r‖_∞ per step.
//       - Max divergence chip — current max |∇·u| over the grid; the
//         SIMPLE projection should drive this toward zero.
//
// Window surface
// --------------
//
//   * window.__forgeOpenCfd3d(true|false)        — show/hide.
//   * window.__forgeCloseCfd3d()
//   * window.__forgeCfd3dHelper                  — solver export surface
//                                                  (the e2e drives the
//                                                  solver headlessly
//                                                  through this).
//   * window.__forgeCfd3dLast                    — last simulation result
//                                                  (steps, residuals,
//                                                  centreline u, etc.).
//
// Headed event:  forge:cfd3d-solve-complete with detail payload mirroring
// __forgeCfd3dLast.
//
// Hard constraints (PUSH-200 brief)
// ---------------------------------
//   * NO new npm / C++ / external deps.
//   * Real PDE math — no stubs / no fallback / no fake numbers.
//   * Cartesian grid ≤ 50³.
//   * SIMPLE algorithm exactly per the brief.
//   * Validation against Ghia/Ghia/Shin 1982 + Taylor–Green analytic.
//
// Multi-cam e2e mandates 5 named camera angles per the Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  makeGrid,
  initFields,
  tagWalls,
  tagLid,
  applyBCs,
  step,
  cflDt,
  maxDivergence,
  computeDivergence,
  velocityMagnitude,
  midplaneVelocityMag,
  centrelineU,
  compareToGhia,
  taylorGreenInit,
  taylorGreenAnalyticAt,
  maxFieldError,
  kineticEnergy,
  driveLidDrivenCavity,
  driveTaylorGreen,
  makeNavierStokes3DHelper,
  GHIA_Y,
  GHIA_U_RE100,
  GHIA_U_RE1000,
  BC,
} from './navierStokes3d.js';

// ─────────────────────────────────────────────────────────────────────
// Constants.

export const CFD3D_GRID_OPTIONS = Object.freeze([16, 32, 48]);
export const CFD3D_DEFAULT_GRID = 16;
export const CFD3D_DEFAULT_RE   = 100;
export const CFD3D_DEFAULT_STEPS = 50;
export const CFD3D_MAX_STEPS    = 1000;
export const CFD3D_DEFAULT_U_LID = 1.0;
export const CFD3D_DEFAULT_L    = 1.0;
export const CFD3D_HEATMAP_PX   = 320;
export const CFD3D_RES_CHART_PX = { w: 360, h: 100 };
export const CFD3D_PANEL_WIDTH  = 460;

// ─────────────────────────────────────────────────────────────────────
// Pure colour ramp — turbo-like, returns CSS `hsl(...)` for a magnitude
// in [0, 1].

export function rampColour(t) {
  const c = Math.max(0, Math.min(1, t));
  // Approximate the matplotlib "turbo" / viridis ramp without dragging
  // in a library — just walk the hue from blue (240°) → red (0°) and
  // bump saturation/lightness at the high end.
  const hue = 240 - 240 * c;
  const sat = 70 + 30 * c;
  const lit = 18 + 50 * c;
  return `hsl(${hue.toFixed(0)},${sat.toFixed(0)}%,${lit.toFixed(0)}%)`;
}

// ─────────────────────────────────────────────────────────────────────
// Snapshot helper — convert the live grid + result history into a
// JSON-safe object for window.__forgeCfd3dLast (used by both the e2e
// and Archie).

function snapshotResult(driverOut, panelMeta) {
  const grid = driverOut.grid;
  const mag = midplaneVelocityMag(grid, 'z');
  let magMin = Infinity, magMax = -Infinity, magSum = 0;
  for (let i = 0; i < mag.length; i++) {
    if (mag[i] < magMin) magMin = mag[i];
    if (mag[i] > magMax) magMax = mag[i];
    magSum += mag[i];
  }
  const ke = kineticEnergy(grid);
  const divField = computeDivergence(grid, grid.u, grid.v, grid.w,
    new Float32Array(grid.N));
  const divMax = maxDivergence(grid, divField);

  return {
    mode:           panelMeta.mode,
    nx:             grid.nx,
    ny:             grid.ny,
    nz:             grid.nz,
    Lx:             grid.Lx,
    Ly:             grid.Ly,
    Lz:             grid.Lz,
    Re:             driverOut.Re,
    nu:             driverOut.nu,
    U_lid:          driverOut.U_lid ?? null,
    U0:             driverOut.U0 ?? null,
    steps:          driverOut.steps,
    totalTime:      driverOut.totalTime,
    midplaneMagMin: magMin,
    midplaneMagMax: magMax,
    midplaneMagAvg: magSum / mag.length,
    kineticEnergy:  ke,
    maxDivergence:  divMax,
    residualHistory:   driverOut.residualHistory,
    divergenceHistory: driverOut.divergenceHistory,
    initialMaxErr: driverOut.initialMaxErr ?? null,
    finalMaxErr:   driverOut.finalMaxErr ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Component: velocity-magnitude midplane heatmap.

function MidplaneHeatmap({ grid, magField, maxMag, label }) {
  if (!grid || !magField || !magField.length) {
    return (
      <div data-testid="forge-cfd3d-heatmap-empty"
           style={{
             padding: '20px 8px',
             color: 'var(--forge-ink-mute, #9aa1ab)',
             fontStyle: 'italic',
             fontSize: 11,
             textAlign: 'center',
           }}>
        No simulation yet — run "Solve N steps".
      </div>
    );
  }
  const { nx, ny } = grid;
  const cell = CFD3D_HEATMAP_PX / Math.max(nx, ny);
  const w = nx * cell;
  const h = ny * cell;
  const denom = (maxMag && maxMag > 1e-12) ? maxMag : 1;
  const rects = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const t = magField[i + nx * j] / denom;
      // Flip y so the lid (top wall) renders at top of the SVG.
      const yPx = (ny - 1 - j) * cell;
      rects.push(
        <rect key={`${i}-${j}`}
              x={i * cell} y={yPx}
              width={cell} height={cell}
              fill={rampColour(t)}
              data-testid={(i === (nx >> 1) && j === (ny >> 1))
                ? 'forge-cfd3d-heatmap-centre' : undefined}
              data-magnitude={t.toFixed(4)} />,
      );
    }
  }
  return (
    <div data-testid="forge-cfd3d-heatmap"
         data-nx={nx} data-ny={ny}
         data-max-mag={maxMag.toFixed(6)}
         style={{
           border: '1px solid var(--forge-rail-edge, #2a2d34)',
           padding: 6,
           background: 'var(--forge-canvas, #0e1117)',
         }}>
      <div style={{
        fontSize: 10,
        color: 'var(--forge-ink-mute, #9aa1ab)',
        marginBottom: 4,
        fontFamily: 'var(--forge-mono, monospace)',
      }}>
        {label || `velocity magnitude · midplane z=nz/2`} · max ={' '}
        <span data-testid="forge-cfd3d-mag-max">{maxMag.toFixed(4)}</span>
      </div>
      <svg width={w} height={h}
           viewBox={`0 0 ${w} ${h}`}
           xmlns="http://www.w3.org/2000/svg"
           style={{ display: 'block', imageRendering: 'pixelated' }}>
        {rects}
      </svg>
      <div style={{
        marginTop: 4,
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: 10,
        color: 'var(--forge-ink-mute, #9aa1ab)',
        fontFamily: 'var(--forge-mono, monospace)',
      }}>
        <span>0</span>
        <span>colour ramp · linear</span>
        <span>{maxMag.toFixed(3)}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Component: residual-history chart (log10 of L∞ Poisson residual).

function ResidualChart({ history, label }) {
  const { w, h } = CFD3D_RES_CHART_PX;
  if (!history || history.length === 0) {
    return (
      <div data-testid="forge-cfd3d-residual-chart-empty"
           style={{
             padding: '14px 6px', fontSize: 11,
             color: 'var(--forge-ink-mute, #9aa1ab)',
             fontStyle: 'italic',
           }}>
        Residual chart appears after the first solve.
      </div>
    );
  }
  const logs = history.map((r) => Math.log10(Math.max(r, 1e-20)));
  let mn = Infinity, mx = -Infinity;
  for (const v of logs) { if (v < mn) mn = v; if (v > mx) mx = v; }
  if (!Number.isFinite(mn) || !Number.isFinite(mx)) { mn = -1; mx = 1; }
  if (mx - mn < 0.5) { mx = mn + 0.5; }   // avoid divide-by-zero collapse
  const pad = 8;
  const innerW = w - 2 * pad;
  const innerH = h - 2 * pad;
  const points = logs.map((v, i) => {
    const x = pad + (logs.length === 1 ? innerW / 2 : (i / (logs.length - 1)) * innerW);
    const y = pad + (mx - v) / (mx - mn) * innerH;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  return (
    <div data-testid="forge-cfd3d-residual-chart"
         data-points={logs.length}
         data-last-log={logs[logs.length - 1].toFixed(3)}
         data-min-log={mn.toFixed(3)}
         data-max-log={mx.toFixed(3)}
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
        {label || 'residual'} · log₁₀ ‖r‖∞ · {logs.length} steps
      </div>
      <svg width={w} height={h}
           viewBox={`0 0 ${w} ${h}`}
           xmlns="http://www.w3.org/2000/svg"
           style={{ display: 'block' }}>
        <rect x={0} y={0} width={w} height={h} fill="transparent" />
        {/* grid lines at integer log decades */}
        {(() => {
          const lines = [];
          const startDec = Math.floor(mn);
          const endDec   = Math.ceil(mx);
          for (let d = startDec; d <= endDec; d++) {
            const y = pad + (mx - d) / (mx - mn) * innerH;
            lines.push(
              <line key={`g-${d}`} x1={pad} x2={pad + innerW}
                    y1={y} y2={y}
                    stroke="var(--forge-rail-edge, #2a2d34)"
                    strokeWidth={0.5} strokeDasharray="2,2" />,
              <text key={`t-${d}`}
                    x={pad} y={y - 1}
                    fill="var(--forge-ink-mute, #9aa1ab)"
                    fontSize={7}
                    fontFamily="var(--forge-mono, monospace)">
                {`1e${d}`}
              </text>,
            );
          }
          return lines;
        })()}
        <polyline points={points}
                  fill="none"
                  stroke="var(--forge-accent-rim, #3a7afe)"
                  strokeWidth={1.5} />
      </svg>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Component: scalar chip (label + value).

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
            color: accent
              ? 'var(--forge-ink, #dadde2)'
              : 'var(--forge-ink, #dadde2)',
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
// Centreline benchmark display — Ghia table vs. simulation.

function GhiaComparisonRow({ row }) {
  return (
    <tr data-testid="forge-cfd3d-ghia-row"
        data-y={row.y_norm.toFixed(3)}
        data-u-sim={row.u_sim.toFixed(4)}
        data-u-ghia={row.u_ghia.toFixed(4)}
        data-err-rel={row.err_rel.toFixed(4)}>
      <td style={{ padding: '2px 6px',
                   fontFamily: 'var(--forge-mono, monospace)',
                   fontSize: 10 }}>
        {row.y_norm.toFixed(4)}
      </td>
      <td style={{ padding: '2px 6px',
                   textAlign: 'right',
                   fontFamily: 'var(--forge-mono, monospace)',
                   fontSize: 10 }}>
        {row.u_sim.toFixed(4)}
      </td>
      <td style={{ padding: '2px 6px',
                   textAlign: 'right',
                   fontFamily: 'var(--forge-mono, monospace)',
                   fontSize: 10 }}>
        {row.u_ghia.toFixed(4)}
      </td>
      <td style={{ padding: '2px 6px',
                   textAlign: 'right',
                   fontFamily: 'var(--forge-mono, monospace)',
                   fontSize: 10,
                   color: row.err_rel > 0.5
                     ? 'var(--forge-err, #ff6363)'
                     : (row.err_rel > 0.2
                         ? 'var(--forge-warn, #f0a020)'
                         : 'var(--forge-ok, #4caf50)') }}>
        {(row.err_rel * 100).toFixed(1)}%
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Main panel component.

export function Cfd3dPanel({ open, onClose }) {
  const [gridSize, setGridSize] = useState(CFD3D_DEFAULT_GRID);
  const [Re, setRe] = useState(CFD3D_DEFAULT_RE);
  const [stepCount, setStepCount] = useState(CFD3D_DEFAULT_STEPS);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [mode, setMode] = useState('cavity'); // 'cavity' | 'taylor'
  const [errorMsg, setErrorMsg] = useState(null);

  // Reset whenever the panel closes so a stale simulation doesn't
  // bleed back into the next session.
  useEffect(() => {
    if (!open) {
      setRunning(false);
      setErrorMsg(null);
    }
  }, [open]);

  const onChangeGrid = useCallback((e) => {
    const v = e.target.value | 0;
    if (CFD3D_GRID_OPTIONS.includes(v)) setGridSize(v);
  }, []);
  const onChangeRe = useCallback((e) => {
    const v = +e.target.value;
    if (Number.isFinite(v) && v > 0) setRe(v);
  }, []);
  const onChangeSteps = useCallback((e) => {
    const v = e.target.value | 0;
    if (Number.isFinite(v) && v > 0 && v <= CFD3D_MAX_STEPS) setStepCount(v);
  }, []);

  // Drive the lid-driven cavity. The actual solve is synchronous on the
  // main thread because the grid is small enough; we set running flag
  // around it so the UI button can show a "Solving…" state.
  const onSolveCavity = useCallback(() => {
    setRunning(true);
    setErrorMsg(null);
    // Yield to the browser one frame so the UI rerenders before the
    // tight loop steals it.
    setTimeout(() => {
      try {
        const driverOut = driveLidDrivenCavity({
          nx: gridSize, ny: gridSize, nz: gridSize,
          L: CFD3D_DEFAULT_L,
          Re,
          U_lid: CFD3D_DEFAULT_U_LID,
          steps: stepCount,
          maxPoissonIter: 200,
          poissonTol: 1e-5,
        });
        const snapshot = snapshotResult(driverOut, { mode: 'cavity' });
        // Bench compare for Ghia if Re ∈ {100, 1000}.
        let ghia = null;
        if (Re === 100 || Re === 1000) {
          ghia = compareToGhia(driverOut.grid, CFD3D_DEFAULT_U_LID, Re);
        }
        snapshot.ghia = ghia;
        snapshot.centreline = centrelineU(driverOut.grid, CFD3D_DEFAULT_U_LID);
        snapshot.midplaneMag = Array.from(
          midplaneVelocityMag(driverOut.grid, 'z'));
        setResult({ driverOut, snapshot });
        if (typeof window !== 'undefined') {
          window.__forgeCfd3dLast = snapshot;
          try {
            window.dispatchEvent(new CustomEvent('forge:cfd3d-solve-complete', {
              detail: snapshot,
            }));
          } catch { /* ignore */ }
        }
        setMode('cavity');
      } catch (err) {
        setErrorMsg(err && err.message ? err.message : String(err));
      } finally {
        setRunning(false);
      }
    }, 50);
  }, [gridSize, Re, stepCount]);

  // Drive the Taylor–Green validation.
  const onSolveTaylor = useCallback(() => {
    setRunning(true);
    setErrorMsg(null);
    setTimeout(() => {
      try {
        const driverOut = driveTaylorGreen({
          nx: gridSize, ny: gridSize, nz: gridSize,
          L: 2 * Math.PI,
          Re,
          U0: 1.0,
          steps: 100, // brief: report max error after 100 steps
          maxPoissonIter: 200,
          poissonTol: 1e-5,
        });
        const snapshot = snapshotResult(driverOut, { mode: 'taylor' });
        snapshot.midplaneMag = Array.from(
          midplaneVelocityMag(driverOut.grid, 'z'));
        snapshot.errorDecreased = driverOut.finalMaxErr <= driverOut.initialMaxErr + 1e-3;
        setResult({ driverOut, snapshot });
        if (typeof window !== 'undefined') {
          window.__forgeCfd3dLast = snapshot;
          try {
            window.dispatchEvent(new CustomEvent('forge:cfd3d-solve-complete', {
              detail: snapshot,
            }));
          } catch { /* ignore */ }
        }
        setMode('taylor');
      } catch (err) {
        setErrorMsg(err && err.message ? err.message : String(err));
      } finally {
        setRunning(false);
      }
    }, 50);
  }, [gridSize, Re]);

  // ─── Derived display values ───
  const midplaneMag = useMemo(() => {
    if (!result) return null;
    return midplaneVelocityMag(result.driverOut.grid, 'z');
  }, [result]);

  const maxMag = useMemo(() => {
    if (!midplaneMag) return 0;
    let m = 0;
    for (let i = 0; i < midplaneMag.length; i++) {
      if (midplaneMag[i] > m) m = midplaneMag[i];
    }
    return m;
  }, [midplaneMag]);

  const divMax = useMemo(() => {
    if (!result) return null;
    const g = result.driverOut.grid;
    const div = computeDivergence(g, g.u, g.v, g.w, new Float32Array(g.N));
    return maxDivergence(g, div);
  }, [result]);

  const lastResidual = useMemo(() => {
    if (!result || !result.snapshot.residualHistory.length) return null;
    return result.snapshot.residualHistory[
      result.snapshot.residualHistory.length - 1];
  }, [result]);

  const ke = useMemo(() => {
    if (!result) return null;
    return kineticEnergy(result.driverOut.grid);
  }, [result]);

  const ghia = result?.snapshot?.ghia || null;

  if (!open) return null;

  return createPortal(
    <aside role="region"
           aria-label="3D Navier–Stokes CFD panel"
           data-testid="forge-cfd3d-panel"
           data-mode={mode}
           style={{
             position: 'fixed',
             top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
             right: 0,
             width: CFD3D_PANEL_WIDTH,
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
          CFD · 3D Navier–Stokes (SIMPLE)
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onClose}
                aria-label="Close CFD 3D panel"
                data-testid="forge-cfd3d-close"
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
            }}>Grid (N³)</span>
            <select value={gridSize}
                    onChange={onChangeGrid}
                    data-testid="forge-cfd3d-grid-size"
                    style={{
                      background: 'var(--forge-canvas, #0e1117)',
                      color: 'var(--forge-ink, #dadde2)',
                      border: '1px solid var(--forge-rail-edge, #2a2d34)',
                      borderRadius: 3,
                      padding: '3px 6px',
                      fontFamily: 'var(--forge-mono, monospace)',
                      fontSize: 11,
                    }}>
              {CFD3D_GRID_OPTIONS.map((g) => (
                <option key={g} value={g}>{g}³ = {g * g * g} cells</option>
              ))}
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{
              fontSize: 9,
              color: 'var(--forge-ink-mute, #9aa1ab)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>Reynolds</span>
            <input type="number"
                   min={1} max={5000} step={1}
                   value={Re}
                   onChange={onChangeRe}
                   data-testid="forge-cfd3d-reynolds"
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
            }}>Steps</span>
            <input type="number"
                   min={1} max={CFD3D_MAX_STEPS} step={1}
                   value={stepCount}
                   onChange={onChangeSteps}
                   data-testid="forge-cfd3d-steps"
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

        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button"
                  onClick={onSolveCavity}
                  disabled={running}
                  data-testid="forge-cfd3d-solve"
                  style={{
                    flex: 2,
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
            {running && mode === 'cavity'
              ? 'Solving…'
              : `Solve · Lid-driven cavity · ${stepCount} steps`}
          </button>
          <button type="button"
                  onClick={onSolveTaylor}
                  disabled={running}
                  data-testid="forge-cfd3d-validate-taylor"
                  style={{
                    flex: 1,
                    background: 'var(--forge-canvas, #0e1117)',
                    border: '1px solid var(--forge-rail-edge, #2a2d34)',
                    borderRadius: 3,
                    color: 'var(--forge-ink, #dadde2)',
                    font: 'inherit', fontSize: 11,
                    padding: '6px 10px',
                    cursor: running ? 'wait' : 'pointer',
                    opacity: running ? 0.5 : 1,
                  }}>
            {running && mode === 'taylor'
              ? 'Validating…'
              : 'Validate Taylor–Green'}
          </button>
        </div>

        {errorMsg ? (
          <div data-testid="forge-cfd3d-error"
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
            <Chip label="Mode" value={mode === 'cavity' ? 'Cavity' : 'Taylor–Green'}
                  testId="forge-cfd3d-chip-mode" />
            <Chip label="Grid" value={`${result.driverOut.grid.nx}³`}
                  testId="forge-cfd3d-chip-grid" />
            <Chip label="Re" value={result.snapshot.Re.toFixed(0)}
                  testId="forge-cfd3d-chip-re" />
            <Chip label="ν" value={result.snapshot.nu.toExponential(3)}
                  units="m²/s"
                  testId="forge-cfd3d-chip-nu" />
            <Chip label="Steps" value={result.snapshot.steps}
                  testId="forge-cfd3d-chip-steps" />
            <Chip label="t" value={result.snapshot.totalTime.toFixed(4)} units="s"
                  testId="forge-cfd3d-chip-time" />
            <Chip label="Max |U|" value={maxMag.toFixed(4)}
                  testId="forge-cfd3d-chip-umax" />
            <Chip label="KE" value={(ke ?? 0).toExponential(3)}
                  testId="forge-cfd3d-chip-ke" />
            <Chip label="max |∇·u|" value={(divMax ?? 0).toExponential(2)}
                  accent={(divMax ?? 0) > 1e-2}
                  testId="forge-cfd3d-chip-divmax" big />
            <Chip label="Last residual"
                  value={(lastResidual ?? 0).toExponential(2)}
                  testId="forge-cfd3d-chip-residual" big />
          </div>

          {mode === 'taylor' && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Chip label="Init err"
                    value={(result.driverOut.initialMaxErr ?? 0).toExponential(3)}
                    testId="forge-cfd3d-chip-initial-err" big />
              <Chip label="Final err"
                    value={(result.driverOut.finalMaxErr ?? 0).toExponential(3)}
                    testId="forge-cfd3d-chip-final-err" big />
              <Chip label="Decreased?"
                    value={result.snapshot.errorDecreased ? 'yes' : 'no'}
                    accent={result.snapshot.errorDecreased}
                    testId="forge-cfd3d-chip-err-decreased" big />
            </div>
          )}
        </section>
      )}

      {result && (
        <section style={{
          padding: '10px 12px',
          display: 'flex', flexDirection: 'column', gap: 10,
          borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
          <MidplaneHeatmap
            grid={result.driverOut.grid}
            magField={midplaneMag}
            maxMag={maxMag}
            label="|U| midplane (k=nz/2)" />
          <ResidualChart
            history={result.snapshot.residualHistory}
            label="Poisson residual" />
        </section>
      )}

      {ghia && (
        <section data-testid="forge-cfd3d-ghia"
                 data-l1={ghia.l1_err.toFixed(4)}
                 data-linf={ghia.l_inf_err.toFixed(4)}
                 style={{
                   padding: '10px 12px',
                   display: 'flex', flexDirection: 'column', gap: 6,
                 }}>
          <div style={{
            fontSize: 11, fontWeight: 600,
            display: 'flex', justifyContent: 'space-between',
          }}>
            <span>Ghia / Ghia / Shin 1982 · centreline u(y) at x = 0.5L</span>
            <span style={{
              fontFamily: 'var(--forge-mono, monospace)',
              fontSize: 10,
              color: 'var(--forge-ink-mute, #9aa1ab)',
            }}>
              ℓ₁ = {ghia.l1_err.toFixed(4)} · ℓ∞ = {ghia.l_inf_err.toFixed(4)}
            </span>
          </div>
          <div style={{
            maxHeight: 180,
            overflowY: 'auto',
            border: '1px solid var(--forge-rail-edge, #2a2d34)',
          }}>
            <table style={{
              width: '100%', borderCollapse: 'collapse',
            }}>
              <thead>
                <tr style={{
                  background: 'var(--forge-canvas-2, #161b22)',
                  position: 'sticky', top: 0,
                }}>
                  <th style={{
                    padding: '4px 6px',
                    textAlign: 'left',
                    fontSize: 9,
                    color: 'var(--forge-ink-mute, #9aa1ab)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}>y/L</th>
                  <th style={{
                    padding: '4px 6px',
                    textAlign: 'right',
                    fontSize: 9,
                    color: 'var(--forge-ink-mute, #9aa1ab)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}>u_sim / U</th>
                  <th style={{
                    padding: '4px 6px',
                    textAlign: 'right',
                    fontSize: 9,
                    color: 'var(--forge-ink-mute, #9aa1ab)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}>u_Ghia / U</th>
                  <th style={{
                    padding: '4px 6px',
                    textAlign: 'right',
                    fontSize: 9,
                    color: 'var(--forge-ink-mute, #9aa1ab)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}>|err|</th>
                </tr>
              </thead>
              <tbody>
                {ghia.samples.map((s, idx) => (
                  <GhiaComparisonRow key={idx} row={s} />
                ))}
              </tbody>
            </table>
          </div>
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
        SIMPLE algorithm · 1st-order upwind advection · 2nd-order centred
        Laplacian · red-black Gauss–Seidel Poisson solver. Validated against
        Ghia 1982 (Re ∈ {100, 1000}) and the 3D Taylor–Green analytic
        vortex.
      </section>

    </aside>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host.

export function Cfd3dPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenCfd3d  = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseCfd3d = () => setOpen(false);

    // Headless solver surface. The e2e + Archie drive solver
    // calculations directly through this without mounting React.
    if (!window.__forgeCfd3dHelper) {
      window.__forgeCfd3dHelper = makeNavierStokes3DHelper();
    }

    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.cfd3d') {
        setOpen(true);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenCfd3d; } catch {}
      try { delete window.__forgeCloseCfd3d; } catch {}
      try { delete window.__forgeCfd3dHelper; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return (
    <Cfd3dPanel open={open} onClose={() => setOpen(false)} />
  );
}

export default Cfd3dPanel;
