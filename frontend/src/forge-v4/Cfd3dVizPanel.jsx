// PUSH-201 (Slice-151) — CFD result visualisation panel.
//
// Consumes a solved 3D Navier–Stokes grid (PUSH-200) and renders three
// scene-mounted overlays inside the live forge-v4 Viewport:
//
//   1. Velocity vectors    — InstancedMesh arrows at every Nth grid
//                            cell, sized + coloured by |U|. The
//                            longest arrow fits inside one cell so
//                            the field never collapses into an
//                            illegible spike-mat.
//   2. Pressure contours   — Mid-plane quad (k = nz/2) coloured per-
//                            vertex via the jet ramp.
//   3. Streamlines         — RK4 traces from an 8×8 grid of seeds on
//                            the inlet plane (lid by default) until
//                            domain exit or the step cap.
//
// All three groups are tagged with userData.cfdViz so the panel can
// surgically mount/unmount them without touching unrelated children
// of window.__forgeScene.
//
// Window surface
// --------------
//
//   * window.__forgeOpenCfd3dViz(true|false)  — show / hide panel.
//   * window.__forgeCloseCfd3dViz()
//   * window.__forgeCfdVizHelper              — pure-math helper surface
//                                               (jet ramp, RK4, sampling,
//                                               decimation, builders).
//   * window.__forgeCfdVizGroups              — { vectors, pressure,
//                                                 streamlines }
//                                               THREE.Group references
//                                               currently mounted.
//
// Menu wire-up:
//   * tools.cfd3dViz                          — opens this panel.
//
// Constraints (per the brief):
//   * No new npm / C++ / external deps.
//   * Real RK4 with trilinear sampling.
//   * Pressure quad uses *real* vertex colours, not a flat tinted plane.
//   * If __forgeScene is unavailable, surface a real error in the panel
//     (no silent fallback).

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  buildVelocityVectorField,
  buildPressureMidplane,
  buildStreamlines,
  removeCfdGroups,
  makeCfdVisualisationHelper,
  rk4Streamline,
  seedStreamlineGrid,
  decimateVectorField,
  jetColor,
  CFD_VIZ_DEFAULT_SCALE,
  CFD_VIZ_DEFAULT_EVERY,
  CFD_VIZ_DEFAULT_STREAMLINE_SEEDS,
  CFD_VIZ_DEFAULT_STREAMLINE_MAX_STEPS,
} from './cfdVisualisation.js';

// ─────────────────────────────────────────────────────────────────────
// Constants.

export const CFD_VIZ_PANEL_WIDTH = 380;
export const CFD_VIZ_QUICKSOLVE_RE  = 100;
export const CFD_VIZ_QUICKSOLVE_NX  = 16;
export const CFD_VIZ_QUICKSOLVE_STEPS = 120;

// ─────────────────────────────────────────────────────────────────────
// Helpers.

function fmtScalar(v, dp = 4) {
  if (v == null || !Number.isFinite(v)) return '—';
  if (Math.abs(v) > 0 && (Math.abs(v) < 1e-3 || Math.abs(v) > 1e4)) {
    return v.toExponential(dp);
  }
  return v.toFixed(dp);
}

function panelButton({ label, onClick, accent, disabled, testId, title }) {
  return (
    <button type="button"
            onClick={onClick}
            disabled={!!disabled}
            title={title || label}
            data-testid={testId}
            style={{
              padding: '6px 10px',
              borderRadius: 3,
              border: accent
                ? '1px solid var(--forge-accent-rim, #3a7afe)'
                : '1px solid var(--forge-rail-edge, #2a2d34)',
              background: accent
                ? 'var(--forge-accent-mute, #1f3a72)'
                : 'var(--forge-canvas, #0e1117)',
              color: 'var(--forge-ink, #dadde2)',
              fontFamily: 'inherit',
              fontSize: 11,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
              textAlign: 'left',
            }}>
      {label}
    </button>
  );
}

function Legend({ label, min, max, colormap }) {
  // 24-step horizontal ramp.
  const stops = 24;
  const cells = [];
  for (let i = 0; i < stops; i++) {
    const t = i / (stops - 1);
    const rgb = colormap(t);
    cells.push(
      <div key={i}
           style={{
             flex: 1,
             height: 8,
             background: `rgb(${(rgb[0]*255)|0},${(rgb[1]*255)|0},${(rgb[2]*255)|0})`,
           }} />,
    );
  }
  return (
    <div data-testid="forge-cfdviz-legend"
         style={{
           display: 'flex', flexDirection: 'column', gap: 2,
           fontFamily: 'var(--forge-mono, monospace)',
           fontSize: 9,
           color: 'var(--forge-ink-mute, #9aa1ab)',
         }}>
      <div>{label}</div>
      <div style={{ display: 'flex', gap: 0 }}>{cells}</div>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span>{fmtScalar(min, 3)}</span>
        <span>{fmtScalar(max, 3)}</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Main panel component.

export function Cfd3dVizPanel({ open, onClose }) {
  const [scale, setScale] = useState(CFD_VIZ_DEFAULT_SCALE);
  const [every, setEvery] = useState(CFD_VIZ_DEFAULT_EVERY);
  const [seedsW, setSeedsW] = useState(CFD_VIZ_DEFAULT_STREAMLINE_SEEDS);
  const [axis, setAxis] = useState('z');
  const [colormap, setColormap] = useState('jet');
  const [errorMsg, setErrorMsg] = useState(null);
  const [solving, setSolving] = useState(false);
  const [grid, setGrid] = useState(null);
  const [solveInfo, setSolveInfo] = useState(null);
  const [mounted, setMounted] = useState({
    vectors: false, pressure: false, streamlines: false,
  });
  const groupsRef = useRef({ vectors: null, pressure: null, streamlines: null });

  // Publish the currently-mounted group references for the e2e / Archie.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeCfdVizGroups = groupsRef.current;
    return undefined;
  }, [mounted.vectors, mounted.pressure, mounted.streamlines]);

  useEffect(() => {
    if (!open) {
      setErrorMsg(null);
    }
  }, [open]);

  // ─── Scene-graph guard ────────────────────────────────────────────
  function requireScene() {
    if (typeof window === 'undefined') {
      throw new Error('window is not defined (SSR context)');
    }
    if (!window.__forgeScene) {
      throw new Error(
        'forge-v4 viewport scene is not ready (window.__forgeScene is null). '
        + 'Wait for the canvas to mount before showing CFD viz.');
    }
    if (!window.__forgeThree) {
      throw new Error(
        'THREE namespace is not exposed on window (__forgeThree is null).');
    }
    return { scene: window.__forgeScene, THREE: window.__forgeThree };
  }

  // ─── Quick-solve cavity Re=100 16³ 120 steps via the PUSH-200 helper.
  const onSolveCavity = useCallback(() => {
    setSolving(true);
    setErrorMsg(null);
    setTimeout(() => {
      try {
        if (typeof window === 'undefined' || !window.__forgeCfd3dHelper) {
          throw new Error(
            'PUSH-200 helper is not installed (window.__forgeCfd3dHelper '
            + 'is missing). Mount the CFD 3D panel first.');
        }
        const h = window.__forgeCfd3dHelper;
        const drv = h.driveLidDrivenCavity({
          nx: CFD_VIZ_QUICKSOLVE_NX,
          ny: CFD_VIZ_QUICKSOLVE_NX,
          nz: CFD_VIZ_QUICKSOLVE_NX,
          L: 1,
          Re: CFD_VIZ_QUICKSOLVE_RE,
          U_lid: 1,
          steps: CFD_VIZ_QUICKSOLVE_STEPS,
          maxPoissonIter: 100,
          poissonTol: 1e-4,
        });
        const g = drv.grid;
        // Compute display stats for the chip strip.
        let umax = 0, umin = Infinity, usum = 0;
        let pmin = Infinity, pmax = -Infinity;
        for (let n = 0; n < g.N; n++) {
          const m = Math.sqrt(g.u[n]*g.u[n] + g.v[n]*g.v[n] + g.w[n]*g.w[n]);
          if (m > umax) umax = m;
          if (m < umin) umin = m;
          usum += m;
          if (g.p[n] < pmin) pmin = g.p[n];
          if (g.p[n] > pmax) pmax = g.p[n];
        }
        setGrid(g);
        setSolveInfo({
          nx: g.nx, ny: g.ny, nz: g.nz,
          Re: drv.Re, nu: drv.nu, U_lid: drv.U_lid,
          steps: drv.steps, totalTime: drv.totalTime,
          umin, umax, umean: usum / g.N,
          pmin, pmax,
          lastResidual: drv.residualHistory[drv.residualHistory.length - 1],
          lastDivergence: drv.divergenceHistory[drv.divergenceHistory.length - 1],
        });
        if (typeof window !== 'undefined') {
          window.__forgeCfdVizLast = {
            nx: g.nx, ny: g.ny, nz: g.nz,
            Re: drv.Re, nu: drv.nu, U_lid: drv.U_lid,
            steps: drv.steps, totalTime: drv.totalTime,
            umax, umin, umean: usum / g.N,
            pmin, pmax,
            lastResidual: drv.residualHistory[drv.residualHistory.length - 1],
            lastDivergence: drv.divergenceHistory[drv.divergenceHistory.length - 1],
          };
          try {
            window.dispatchEvent(new CustomEvent('forge:cfd3dviz-solve-complete', {
              detail: window.__forgeCfdVizLast,
            }));
          } catch { /* ignore */ }
        }
      } catch (err) {
        setErrorMsg(err && err.message ? err.message : String(err));
      } finally {
        setSolving(false);
      }
    }, 50);
  }, []);

  // ─── Vectors mount/unmount ───────────────────────────────────────
  const onToggleVectors = useCallback(() => {
    try {
      if (!grid) throw new Error('No solved grid yet — click "Solve cavity Re=100" first.');
      const { scene, THREE } = requireScene();
      // If already mounted, unmount.
      if (mounted.vectors && groupsRef.current.vectors) {
        scene.remove(groupsRef.current.vectors);
        removeCfdGroups(scene, 'vectors'); // belt-and-braces
        groupsRef.current.vectors = null;
        setMounted((m) => ({ ...m, vectors: false }));
        return;
      }
      // Replace any prior vectors group first.
      removeCfdGroups(scene, 'vectors');
      const grp = buildVelocityVectorField(THREE, grid, {
        scale,
        every,
        colormap,
      });
      scene.add(grp);
      groupsRef.current.vectors = grp;
      setMounted((m) => ({ ...m, vectors: true }));
    } catch (err) {
      setErrorMsg(err && err.message ? err.message : String(err));
    }
  }, [grid, mounted.vectors, scale, every, colormap]);

  // ─── Pressure mount/unmount ──────────────────────────────────────
  const onTogglePressure = useCallback(() => {
    try {
      if (!grid) throw new Error('No solved grid yet — click "Solve cavity Re=100" first.');
      const { scene, THREE } = requireScene();
      if (mounted.pressure && groupsRef.current.pressure) {
        scene.remove(groupsRef.current.pressure);
        removeCfdGroups(scene, 'pressure');
        groupsRef.current.pressure = null;
        setMounted((m) => ({ ...m, pressure: false }));
        return;
      }
      removeCfdGroups(scene, 'pressure');
      const grp = buildPressureMidplane(THREE, grid, {
        scale,
        axis,
        colormap,
      });
      scene.add(grp);
      groupsRef.current.pressure = grp;
      setMounted((m) => ({ ...m, pressure: true }));
    } catch (err) {
      setErrorMsg(err && err.message ? err.message : String(err));
    }
  }, [grid, mounted.pressure, scale, axis, colormap]);

  // ─── Streamlines mount/unmount ───────────────────────────────────
  const onToggleStreamlines = useCallback(() => {
    try {
      if (!grid) throw new Error('No solved grid yet — click "Solve cavity Re=100" first.');
      const { scene, THREE } = requireScene();
      if (mounted.streamlines && groupsRef.current.streamlines) {
        scene.remove(groupsRef.current.streamlines);
        removeCfdGroups(scene, 'streamlines');
        groupsRef.current.streamlines = null;
        setMounted((m) => ({ ...m, streamlines: false }));
        return;
      }
      removeCfdGroups(scene, 'streamlines');
      const grp = buildStreamlines(THREE, grid, {
        scale,
        seedsW,
        seedsH: seedsW,
        face: 'lid',
        maxSteps: CFD_VIZ_DEFAULT_STREAMLINE_MAX_STEPS,
        colormap,
      });
      scene.add(grp);
      groupsRef.current.streamlines = grp;
      setMounted((m) => ({ ...m, streamlines: true }));
    } catch (err) {
      setErrorMsg(err && err.message ? err.message : String(err));
    }
  }, [grid, mounted.streamlines, scale, seedsW, colormap]);

  // ─── Clear all ────────────────────────────────────────────────────
  const onClearAll = useCallback(() => {
    try {
      const { scene } = requireScene();
      const removed = removeCfdGroups(scene);
      groupsRef.current.vectors = null;
      groupsRef.current.pressure = null;
      groupsRef.current.streamlines = null;
      setMounted({ vectors: false, pressure: false, streamlines: false });
      if (typeof window !== 'undefined') {
        window.__forgeCfdVizGroups = groupsRef.current;
      }
      // Note: no error if removed === 0; clear is idempotent.
      void removed;
    } catch (err) {
      setErrorMsg(err && err.message ? err.message : String(err));
    }
  }, []);

  // Re-mount groups when scale / every / axis / colormap / seedsW changes
  // AND the group is currently mounted. This keeps the visualisation in
  // sync with the panel controls without needing a manual rebuild.
  useEffect(() => {
    if (!grid) return;
    try {
      const { scene, THREE } = requireScene();
      if (mounted.vectors && groupsRef.current.vectors) {
        scene.remove(groupsRef.current.vectors);
        removeCfdGroups(scene, 'vectors');
        const grp = buildVelocityVectorField(THREE, grid, { scale, every, colormap });
        scene.add(grp);
        groupsRef.current.vectors = grp;
      }
      if (mounted.pressure && groupsRef.current.pressure) {
        scene.remove(groupsRef.current.pressure);
        removeCfdGroups(scene, 'pressure');
        const grp = buildPressureMidplane(THREE, grid, { scale, axis, colormap });
        scene.add(grp);
        groupsRef.current.pressure = grp;
      }
      if (mounted.streamlines && groupsRef.current.streamlines) {
        scene.remove(groupsRef.current.streamlines);
        removeCfdGroups(scene, 'streamlines');
        const grp = buildStreamlines(THREE, grid, {
          scale, seedsW, seedsH: seedsW, face: 'lid', colormap,
        });
        scene.add(grp);
        groupsRef.current.streamlines = grp;
      }
      if (typeof window !== 'undefined') {
        window.__forgeCfdVizGroups = groupsRef.current;
      }
    } catch {
      // Don't surface a transient scene-rebuild error here — the next
      // user click will reveal the underlying issue with a fresh message.
    }
  }, [scale, every, axis, colormap, seedsW, grid]);

  if (!open) return null;

  return createPortal(
    <aside role="region"
           aria-label="3D CFD result visualisation"
           data-testid="forge-cfd3dviz-panel"
           data-has-grid={grid ? '1' : '0'}
           data-mounted-vectors={mounted.vectors ? '1' : '0'}
           data-mounted-pressure={mounted.pressure ? '1' : '0'}
           data-mounted-streamlines={mounted.streamlines ? '1' : '0'}
           style={{
             position: 'fixed',
             top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
             right: 0,
             width: CFD_VIZ_PANEL_WIDTH,
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

      {/* ─── Header ───────────────────────────── */}
      <header style={{
        padding: '10px 12px',
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
        background: 'var(--forge-canvas, #0e1117)',
        display: 'flex', alignItems: 'center', gap: 8,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>
          CFD · Result Visualisation
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onClose}
                aria-label="Close CFD visualisation panel"
                data-testid="forge-cfd3dviz-close"
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

      {/* ─── Solve section ───────────────────── */}
      <section style={{
        padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        <div style={{ fontSize: 10,
                      color: 'var(--forge-ink-mute, #9aa1ab)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em' }}>
          1 · Solve
        </div>
        <button type="button"
                onClick={onSolveCavity}
                disabled={solving}
                data-testid="forge-cfd3dviz-solve-cavity"
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  borderRadius: 3,
                  border: '1px solid var(--forge-accent-rim, #3a7afe)',
                  background: solving
                    ? 'var(--forge-canvas, #0e1117)'
                    : 'var(--forge-accent-mute, #1f3a72)',
                  color: 'var(--forge-ink, #dadde2)',
                  fontFamily: 'inherit',
                  fontSize: 11,
                  cursor: solving ? 'wait' : 'pointer',
                  opacity: solving ? 0.5 : 1,
                  textAlign: 'left',
                }}>
          {solving
            ? `Solving cavity Re=${CFD_VIZ_QUICKSOLVE_RE} · ${CFD_VIZ_QUICKSOLVE_NX}³ · ${CFD_VIZ_QUICKSOLVE_STEPS} steps…`
            : `Solve cavity Re=${CFD_VIZ_QUICKSOLVE_RE} · ${CFD_VIZ_QUICKSOLVE_NX}³ · ${CFD_VIZ_QUICKSOLVE_STEPS} steps`}
        </button>
        {solveInfo && (
          <div data-testid="forge-cfd3dviz-solve-stats"
               data-umax={solveInfo.umax.toFixed(6)}
               data-pmin={solveInfo.pmin.toFixed(6)}
               data-pmax={solveInfo.pmax.toFixed(6)}
               data-totaltime={solveInfo.totalTime.toFixed(6)}
               style={{
                 display: 'grid',
                 gridTemplateColumns: '1fr 1fr',
                 gap: 4,
                 fontFamily: 'var(--forge-mono, monospace)',
                 fontSize: 10,
                 padding: '6px 8px',
                 background: 'var(--forge-canvas, #0e1117)',
                 border: '1px solid var(--forge-rail-edge, #2a2d34)',
                 borderRadius: 3,
               }}>
            <div>
              <span style={{
                color: 'var(--forge-ink-mute, #9aa1ab)',
                marginRight: 6,
              }}>grid</span>
              {solveInfo.nx}³
            </div>
            <div>
              <span style={{
                color: 'var(--forge-ink-mute, #9aa1ab)',
                marginRight: 6,
              }}>Re</span>
              {solveInfo.Re.toFixed(0)}
            </div>
            <div>
              <span style={{
                color: 'var(--forge-ink-mute, #9aa1ab)',
                marginRight: 6,
              }}>t</span>
              {fmtScalar(solveInfo.totalTime, 4)}
            </div>
            <div>
              <span style={{
                color: 'var(--forge-ink-mute, #9aa1ab)',
                marginRight: 6,
              }}>steps</span>
              {solveInfo.steps}
            </div>
            <div>
              <span style={{
                color: 'var(--forge-ink-mute, #9aa1ab)',
                marginRight: 6,
              }}>|U|_max</span>
              {fmtScalar(solveInfo.umax, 4)}
            </div>
            <div>
              <span style={{
                color: 'var(--forge-ink-mute, #9aa1ab)',
                marginRight: 6,
              }}>p_max</span>
              {fmtScalar(solveInfo.pmax, 4)}
            </div>
            <div>
              <span style={{
                color: 'var(--forge-ink-mute, #9aa1ab)',
                marginRight: 6,
              }}>div_last</span>
              {fmtScalar(solveInfo.lastDivergence, 3)}
            </div>
            <div>
              <span style={{
                color: 'var(--forge-ink-mute, #9aa1ab)',
                marginRight: 6,
              }}>res_last</span>
              {fmtScalar(solveInfo.lastResidual, 3)}
            </div>
          </div>
        )}
      </section>

      {/* ─── Display controls ───────────────── */}
      <section style={{
        padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        <div style={{ fontSize: 10,
                      color: 'var(--forge-ink-mute, #9aa1ab)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em' }}>
          2 · Display options
        </div>
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
        }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 9,
                           color: 'var(--forge-ink-mute, #9aa1ab)',
                           textTransform: 'uppercase',
                           letterSpacing: '0.05em' }}>
              Scale (mm/L)
            </span>
            <input type="number" min={5} max={200} step={5}
                   value={scale}
                   onChange={(e) => {
                     const v = +e.target.value;
                     if (Number.isFinite(v) && v > 0) setScale(v);
                   }}
                   data-testid="forge-cfd3dviz-scale"
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
            <span style={{ fontSize: 9,
                           color: 'var(--forge-ink-mute, #9aa1ab)',
                           textTransform: 'uppercase',
                           letterSpacing: '0.05em' }}>
              Vec ev. Nth
            </span>
            <input type="number" min={1} max={8} step={1}
                   value={every}
                   onChange={(e) => {
                     const v = e.target.value | 0;
                     if (v >= 1 && v <= 8) setEvery(v);
                   }}
                   data-testid="forge-cfd3dviz-every"
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
            <span style={{ fontSize: 9,
                           color: 'var(--forge-ink-mute, #9aa1ab)',
                           textTransform: 'uppercase',
                           letterSpacing: '0.05em' }}>
              Stream seeds (N×N)
            </span>
            <input type="number" min={2} max={16} step={1}
                   value={seedsW}
                   onChange={(e) => {
                     const v = e.target.value | 0;
                     if (v >= 2 && v <= 16) setSeedsW(v);
                   }}
                   data-testid="forge-cfd3dviz-seeds"
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
            <span style={{ fontSize: 9,
                           color: 'var(--forge-ink-mute, #9aa1ab)',
                           textTransform: 'uppercase',
                           letterSpacing: '0.05em' }}>
              Pressure axis
            </span>
            <select value={axis}
                    onChange={(e) => setAxis(e.target.value)}
                    data-testid="forge-cfd3dviz-axis"
                    style={{
                      background: 'var(--forge-canvas, #0e1117)',
                      color: 'var(--forge-ink, #dadde2)',
                      border: '1px solid var(--forge-rail-edge, #2a2d34)',
                      borderRadius: 3,
                      padding: '3px 6px',
                      fontFamily: 'var(--forge-mono, monospace)',
                      fontSize: 11,
                    }}>
              <option value="z">z · (x,y)</option>
              <option value="y">y · (x,z)</option>
              <option value="x">x · (y,z)</option>
            </select>
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 9,
                           color: 'var(--forge-ink-mute, #9aa1ab)',
                           textTransform: 'uppercase',
                           letterSpacing: '0.05em' }}>
              Colormap
            </span>
            <select value={colormap}
                    onChange={(e) => setColormap(e.target.value)}
                    data-testid="forge-cfd3dviz-colormap"
                    style={{
                      background: 'var(--forge-canvas, #0e1117)',
                      color: 'var(--forge-ink, #dadde2)',
                      border: '1px solid var(--forge-rail-edge, #2a2d34)',
                      borderRadius: 3,
                      padding: '3px 6px',
                      fontFamily: 'var(--forge-mono, monospace)',
                      fontSize: 11,
                    }}>
              <option value="jet">jet</option>
              <option value="viridis">viridis</option>
            </select>
          </label>
        </div>
      </section>

      {/* ─── Visualisation actions ────────────── */}
      <section style={{
        padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        <div style={{ fontSize: 10,
                      color: 'var(--forge-ink-mute, #9aa1ab)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em' }}>
          3 · Mount / unmount
        </div>
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
        }}>
          {panelButton({
            label: mounted.vectors
              ? 'Hide vectors'
              : 'Show vectors',
            onClick: onToggleVectors,
            accent: !mounted.vectors,
            disabled: !grid,
            testId: 'forge-cfd3dviz-vectors',
            title: 'Velocity arrows at every Nth grid cell',
          })}
          {panelButton({
            label: mounted.pressure
              ? 'Hide pressure'
              : 'Show pressure',
            onClick: onTogglePressure,
            accent: !mounted.pressure,
            disabled: !grid,
            testId: 'forge-cfd3dviz-pressure',
            title: 'Pressure midplane quad with vertex colours',
          })}
          {panelButton({
            label: mounted.streamlines
              ? 'Hide streamlines'
              : 'Show streamlines',
            onClick: onToggleStreamlines,
            accent: !mounted.streamlines,
            disabled: !grid,
            testId: 'forge-cfd3dviz-streamlines',
            title: 'RK4 streamlines from the lid inlet plane',
          })}
          {panelButton({
            label: 'Clear all',
            onClick: onClearAll,
            accent: false,
            disabled: false,
            testId: 'forge-cfd3dviz-clear',
            title: 'Remove every CFD viz group from the scene',
          })}
        </div>
      </section>

      {/* ─── Legends ───────────────────────────── */}
      {solveInfo && (
        <section style={{
          padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 12,
          borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
          <Legend
            label={`|U| · ${colormap}`}
            min={solveInfo.umin}
            max={solveInfo.umax}
            colormap={jetColor} />
          <Legend
            label={`p · ${colormap}`}
            min={solveInfo.pmin}
            max={solveInfo.pmax}
            colormap={jetColor} />
        </section>
      )}

      {/* ─── Error surface ───────────────────── */}
      {errorMsg && (
        <section style={{ padding: '8px 12px' }}>
          <div data-testid="forge-cfd3dviz-error"
               style={{
                 color: 'var(--forge-err, #ff6363)',
                 background: 'var(--forge-canvas, #0e1117)',
                 padding: '6px 8px',
                 fontFamily: 'var(--forge-mono, monospace)',
                 fontSize: 10,
                 border: '1px solid var(--forge-err, #ff6363)',
                 borderRadius: 3,
                 whiteSpace: 'pre-wrap',
               }}>
            error: {errorMsg}
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
        Vectors: InstancedMesh (shaft + head). Pressure: PlaneGeometry with
        per-vertex colours via jet/viridis ramp. Streamlines: RK4 with
        trilinear velocity sampling. All groups mount onto
        window.__forgeScene.
      </section>

    </aside>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host.

export function Cfd3dVizPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenCfd3dViz  = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseCfd3dViz = () => setOpen(false);
    if (!window.__forgeCfdVizHelper) {
      window.__forgeCfdVizHelper = makeCfdVisualisationHelper();
    }

    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.cfd3dViz') {
        setOpen(true);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenCfd3dViz; } catch {}
      try { delete window.__forgeCloseCfd3dViz; } catch {}
      try { delete window.__forgeCfdVizHelper; } catch {}
      try { delete window.__forgeCfdVizGroups; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return <Cfd3dVizPanel open={open} onClose={() => setOpen(false)} />;
}

export default Cfd3dVizPanel;
