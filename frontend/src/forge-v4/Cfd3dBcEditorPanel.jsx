// PUSH-202 (Slice-159) — CFD Boundary Condition Editor.
//
// Interactive editor that "paints" boundary conditions onto one of the
// six AABB faces of a 3D Navier–Stokes grid (PUSH-200). The panel
// round-trips with the actual `grid` produced by
// __forgeCfd3dHelper.makeGrid, mutating its `bcType` Uint8Array and
// `bcValue` Float32Array in place, then re-solves through the helper.
//
// Surface contract
// ----------------
//
//   * Face picker:      six buttons for −X / +X / −Y / +Y / −Z / +Z.
//                       Selecting a face stores it in component state;
//                       the readout shows the currently highlighted face.
//
//   * BC type radio:    Wall / Inlet / Outlet / Lid. For Inlet + Lid the
//                       editor also reveals three number inputs for the
//                       prescribed velocity vector (Ux, Uy, Uz).
//
//   * "Apply to face":  walks every cell on the selected face (e.g.
//                       i == 0 for −X, i == nx − 1 for +X, etc.). Writes
//                       `bcType[idx] = ENUM`. For Inlet + Lid also writes
//                       `bcValue[3*idx + 0..2] = (Ux, Uy, Uz)`. For Wall
//                       + Outlet the bcValue triplet is zeroed for the
//                       face cells so a previous Inlet/Lid paint cannot
//                       bleed through. Lastly re-runs applyBCs(grid) so
//                       u/v/w on the painted face match the new tags
//                       immediately — no solve step required to see the
//                       BC reflected on the field.
//
//   * "Re-solve":       calls __forgeCfd3dHelper.step(grid, dt, opts)
//                       `solveSteps` times with the current ν. Updates
//                       the per-step divergence + residual chips so the
//                       user can confirm the projection still drives
//                       ‖∇·u‖_∞ toward zero after the BC change. Uses
//                       cflDt(grid, nu) so dt adapts to the new flow.
//
//   * Read-out:         live counts of every bcType in the grid
//                       (Interior / Wall / Inlet / Outlet / Lid), grid
//                       dims (nx × ny × nz), and the last face touched
//                       with its applied enum.
//
//   * "Build grid":     creates a fresh 12³ unit-cube grid via
//                       __forgeCfd3dHelper.makeGrid so the user can
//                       start with a clean slate without leaving the
//                       panel. Mirrors the e2e step 02 contract — drop
//                       a 12³ grid, then paint Wall on all six faces.
//
// Window surface
// --------------
//
//   * window.__forgeOpenCfd3dBcEditor(true|false)  — show / hide panel.
//   * window.__forgeCloseCfd3dBcEditor()
//   * window.__forgeCfd3dBcEditor                   — { grid, lastFace,
//                                                       lastBC,
//                                                       lastSolveResult,
//                                                       applyToFace,
//                                                       countBCs }
//
// The editor reads grid + helper off window so it stays a thin React
// shell — every BC mutation is real, deterministic, synchronous, and
// observable from the e2e through the same window surface the panel uses
// internally.
//
// Menu wire-up:
//   * tools.cfd3dBcEditor                           — opens this panel.
//
// Multi-cam e2e mandates 5 named camera angles per the Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  BC,
  makeGrid,
  initFields,
  applyBCs,
  step,
  cflDt,
  computeDivergence,
  maxDivergence,
  makeNavierStokes3DHelper,
} from './navierStokes3d.js';

// ─────────────────────────────────────────────────────────────────────
// Constants.

export const CFD3D_BC_EDITOR_PANEL_WIDTH = 460;
export const CFD3D_BC_EDITOR_DEFAULT_NX = 12;
export const CFD3D_BC_EDITOR_DEFAULT_LX = 1.0;
export const CFD3D_BC_EDITOR_DEFAULT_NU = 1e-2;
export const CFD3D_BC_EDITOR_DEFAULT_SOLVE_STEPS = 50;

export const CFD3D_BC_FACES = Object.freeze([
  { id: '-X', label: '−X face (i = 0)',         axis: 0, hi: false },
  { id: '+X', label: '+X face (i = nx − 1)',    axis: 0, hi: true  },
  { id: '-Y', label: '−Y face (j = 0)',         axis: 1, hi: false },
  { id: '+Y', label: '+Y face (j = ny − 1)',    axis: 1, hi: true  },
  { id: '-Z', label: '−Z face (k = 0)',         axis: 2, hi: false },
  { id: '+Z', label: '+Z face (k = nz − 1)',    axis: 2, hi: true  },
]);

export const CFD3D_BC_TYPES = Object.freeze([
  { id: 'wall',    label: 'Wall (no-slip)',         enum: BC.WALL,    needsVel: false },
  { id: 'inlet',   label: 'Inlet (Dirichlet U)',    enum: BC.INLET,   needsVel: true  },
  { id: 'outlet',  label: 'Outlet (zero-grad)',     enum: BC.OUTLET,  needsVel: false },
  { id: 'lid',    label: 'Lid (moving wall, U_t)',  enum: BC.LID,     needsVel: true  },
]);

// ─────────────────────────────────────────────────────────────────────
// Pure helper: walk a face and apply (bcEnum, velocity) to every cell.
// Returns the number of cells touched.

export function applyBcToFace(grid, faceId, bcEnum, velocity) {
  if (!grid || !grid.bcType || !grid.bcValue) {
    throw new Error('applyBcToFace: grid missing bcType / bcValue arrays');
  }
  const face = CFD3D_BC_FACES.find((f) => f.id === faceId);
  if (!face) throw new Error(`applyBcToFace: unknown face id ${faceId}`);
  const { nx, ny, nz, sliceXY, bcType, bcValue } = grid;
  const ux = velocity && Number.isFinite(velocity[0]) ? +velocity[0] : 0;
  const uy = velocity && Number.isFinite(velocity[1]) ? +velocity[1] : 0;
  const uz = velocity && Number.isFinite(velocity[2]) ? +velocity[2] : 0;
  let touched = 0;

  // Iterate the 2D face plane: pick the two free axes based on `face.axis`.
  if (face.axis === 0) {
    // x-face: free axes are (j, k); fix i.
    const i = face.hi ? nx - 1 : 0;
    for (let k = 0; k < nz; k++) {
      for (let j = 0; j < ny; j++) {
        const idx = i + nx * j + sliceXY * k;
        bcType[idx] = bcEnum;
        bcValue[3 * idx + 0] = ux;
        bcValue[3 * idx + 1] = uy;
        bcValue[3 * idx + 2] = uz;
        touched += 1;
      }
    }
  } else if (face.axis === 1) {
    // y-face: free axes are (i, k); fix j.
    const j = face.hi ? ny - 1 : 0;
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        const idx = i + nx * j + sliceXY * k;
        bcType[idx] = bcEnum;
        bcValue[3 * idx + 0] = ux;
        bcValue[3 * idx + 1] = uy;
        bcValue[3 * idx + 2] = uz;
        touched += 1;
      }
    }
  } else {
    // z-face: free axes are (i, j); fix k.
    const k = face.hi ? nz - 1 : 0;
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const idx = i + nx * j + sliceXY * k;
        bcType[idx] = bcEnum;
        bcValue[3 * idx + 0] = ux;
        bcValue[3 * idx + 1] = uy;
        bcValue[3 * idx + 2] = uz;
        touched += 1;
      }
    }
  }
  // Push the new tag into u/v/w immediately so the field is consistent
  // before the next solve. applyBCs is cheap (one walk of the grid) and
  // honours OUTLET zero-gradient + WALL/INLET/LID Dirichlet correctly.
  applyBCs(grid);
  return touched;
}

// Count cells by bcType for the read-out.
export function countBcTypes(grid) {
  if (!grid || !grid.bcType) {
    return { INTERIOR: 0, WALL: 0, INLET: 0, OUTLET: 0, LID: 0, TOTAL: 0 };
  }
  const t = grid.bcType;
  let interior = 0, wall = 0, inlet = 0, outlet = 0, lid = 0;
  for (let n = 0; n < t.length; n++) {
    const v = t[n];
    if      (v === BC.INTERIOR) interior += 1;
    else if (v === BC.WALL)     wall     += 1;
    else if (v === BC.INLET)    inlet    += 1;
    else if (v === BC.OUTLET)   outlet   += 1;
    else if (v === BC.LID)      lid      += 1;
  }
  return {
    INTERIOR: interior, WALL: wall, INLET: inlet,
    OUTLET: outlet, LID: lid, TOTAL: t.length,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Component: face button.

function FaceButton({ face, selected, onSelect }) {
  return (
    <button type="button"
            onClick={() => onSelect(face.id)}
            data-testid={`forge-cfd3d-bc-face-${face.id}`}
            data-selected={selected ? 'true' : 'false'}
            style={{
              padding: '6px 8px',
              borderRadius: 3,
              border: selected
                ? '1px solid var(--forge-accent-rim, #3a7afe)'
                : '1px solid var(--forge-rail-edge, #2a2d34)',
              background: selected
                ? 'var(--forge-accent-mute, #1f3a72)'
                : 'var(--forge-canvas, #0e1117)',
              color: 'var(--forge-ink, #dadde2)',
              font: 'inherit',
              fontSize: 11,
              fontFamily: 'var(--forge-mono, monospace)',
              cursor: 'pointer',
              textAlign: 'center',
            }}>
      {face.id}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Component: BC type radio.

function BcTypeRadio({ value, onChange }) {
  return (
    <div role="radiogroup"
         aria-label="BC type"
         style={{
           display: 'grid',
           gridTemplateColumns: '1fr 1fr',
           gap: 4,
         }}>
      {CFD3D_BC_TYPES.map((t) => (
        <label key={t.id}
               data-testid={`forge-cfd3d-bc-type-${t.id}`}
               data-selected={value === t.id ? 'true' : 'false'}
               style={{
                 display: 'flex', alignItems: 'center', gap: 6,
                 padding: '4px 6px',
                 border: value === t.id
                   ? '1px solid var(--forge-accent-rim, #3a7afe)'
                   : '1px solid var(--forge-rail-edge, #2a2d34)',
                 background: value === t.id
                   ? 'var(--forge-accent-mute, #1f3a72)'
                   : 'var(--forge-canvas, #0e1117)',
                 borderRadius: 3,
                 fontSize: 11,
                 cursor: 'pointer',
               }}>
          <input type="radio"
                 name="forge-cfd3d-bc-type"
                 value={t.id}
                 checked={value === t.id}
                 onChange={() => onChange(t.id)}
                 style={{ accentColor: 'var(--forge-accent-rim, #3a7afe)' }} />
          <span>{t.label}</span>
        </label>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Component: scalar read-out chip.

function Chip({ label, value, testId, accent }) {
  return (
    <span data-testid={testId}
          style={{
            display: 'inline-flex', flexDirection: 'column',
            padding: '3px 8px',
            border: '1px solid var(--forge-rail-edge, #2a2d34)',
            borderRadius: 4,
            background: accent
              ? 'var(--forge-accent-mute, #1f3a72)'
              : 'var(--forge-canvas, #0e1117)',
            color: 'var(--forge-ink, #dadde2)',
            fontFamily: 'var(--forge-mono, monospace)',
            fontSize: 10,
            lineHeight: 1.1,
            minWidth: 70,
          }}>
      <span style={{
        fontSize: 8,
        color: 'var(--forge-ink-mute, #9aa1ab)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>
        {label}
      </span>
      <span>{value}</span>
    </span>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Main panel component.

export function Cfd3dBcEditorPanel({ open, onClose }) {
  // Grid lives in a ref so we mutate it in place (Uint8Array writes don't
  // trigger React re-renders by themselves).
  const gridRef = useRef(null);
  const [gridDims, setGridDims] = useState({ nx: 0, ny: 0, nz: 0 });
  const [face, setFace] = useState('-X');
  const [bcType, setBcType] = useState('wall');
  const [Ux, setUx] = useState(1);
  const [Uy, setUy] = useState(0);
  const [Uz, setUz] = useState(0);
  const [solveSteps, setSolveSteps] = useState(CFD3D_BC_EDITOR_DEFAULT_SOLVE_STEPS);
  const [nu, setNu] = useState(CFD3D_BC_EDITOR_DEFAULT_NU);
  const [counts, setCounts] = useState({
    INTERIOR: 0, WALL: 0, INLET: 0, OUTLET: 0, LID: 0, TOTAL: 0,
  });
  const [lastFace, setLastFace] = useState(null);
  const [lastBC, setLastBC] = useState(null);
  const [lastTouched, setLastTouched] = useState(0);
  const [lastSolve, setLastSolve] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);
  const [running, setRunning] = useState(false);

  const refreshCounts = useCallback(() => {
    const g = gridRef.current;
    if (!g) {
      setCounts({ INTERIOR: 0, WALL: 0, INLET: 0, OUTLET: 0, LID: 0, TOTAL: 0 });
      return;
    }
    setCounts(countBcTypes(g));
  }, []);

  // Build a fresh grid using the real PUSH-200 makeGrid helper. The
  // helper surface lives on window.__forgeCfd3dHelper (installed by
  // Cfd3dPanelHost). We also expose the local import as a fallback so
  // the editor still works if Cfd3dPanelHost has not mounted yet.
  const buildGrid = useCallback((nx) => {
    const helper = (typeof window !== 'undefined' && window.__forgeCfd3dHelper)
      ? window.__forgeCfd3dHelper
      : null;
    const factory = helper ? helper.makeGrid : makeGrid;
    const initialiser = helper ? helper.initFields : initFields;
    const g = factory(nx, nx, nx,
      CFD3D_BC_EDITOR_DEFAULT_LX,
      CFD3D_BC_EDITOR_DEFAULT_LX,
      CFD3D_BC_EDITOR_DEFAULT_LX);
    initialiser(g);
    gridRef.current = g;
    setGridDims({ nx: g.nx, ny: g.ny, nz: g.nz });
    setLastFace(null);
    setLastBC(null);
    setLastTouched(0);
    setLastSolve(null);
    refreshCounts();
    if (typeof window !== 'undefined') {
      const surface = window.__forgeCfd3dBcEditor || {};
      surface.grid = g;
      surface.lastFace = null;
      surface.lastBC = null;
      surface.lastSolveResult = null;
      window.__forgeCfd3dBcEditor = surface;
    }
    return g;
  }, [refreshCounts]);

  // Build a default 12³ grid the first time the panel opens, so the e2e
  // can start painting without an extra "Build" click.
  useEffect(() => {
    if (!open) return;
    if (!gridRef.current) {
      try { buildGrid(CFD3D_BC_EDITOR_DEFAULT_NX); }
      catch (err) {
        setErrorMsg(err && err.message ? err.message : String(err));
      }
    } else {
      refreshCounts();
    }
  }, [open, buildGrid, refreshCounts]);

  // Reset error + running on close.
  useEffect(() => {
    if (!open) {
      setErrorMsg(null);
      setRunning(false);
    }
  }, [open]);

  const onApply = useCallback(() => {
    setErrorMsg(null);
    const g = gridRef.current;
    if (!g) { setErrorMsg('No grid — click "Build grid" first.'); return; }
    const bc = CFD3D_BC_TYPES.find((t) => t.id === bcType);
    if (!bc) { setErrorMsg(`Unknown BC type: ${bcType}`); return; }
    const vel = bc.needsVel ? [Ux, Uy, Uz] : [0, 0, 0];
    try {
      const touched = applyBcToFace(g, face, bc.enum, vel);
      setLastFace(face);
      setLastBC(bc.id);
      setLastTouched(touched);
      refreshCounts();
      if (typeof window !== 'undefined') {
        const surface = window.__forgeCfd3dBcEditor || {};
        surface.grid = g;
        surface.lastFace = face;
        surface.lastBC = bc.id;
        surface.lastTouched = touched;
        window.__forgeCfd3dBcEditor = surface;
        try {
          window.dispatchEvent(new CustomEvent('forge:cfd3d-bc-applied', {
            detail: { face, bc: bc.id, enum: bc.enum, touched,
                      velocity: vel, counts: countBcTypes(g) },
          }));
        } catch { /* ignore */ }
      }
    } catch (err) {
      setErrorMsg(err && err.message ? err.message : String(err));
    }
  }, [face, bcType, Ux, Uy, Uz, refreshCounts]);

  const onResolve = useCallback(() => {
    setErrorMsg(null);
    const g = gridRef.current;
    if (!g) { setErrorMsg('No grid — build one first.'); return; }
    const helper = (typeof window !== 'undefined' && window.__forgeCfd3dHelper)
      ? window.__forgeCfd3dHelper
      : null;
    const stepFn = helper ? helper.step : step;
    const cflFn  = helper ? helper.cflDt : cflDt;
    const divFn  = helper ? helper.computeDivergence : computeDivergence;
    const maxDivFn = helper ? helper.maxDivergence : maxDivergence;
    setRunning(true);
    // Yield one frame so the "Solving…" UI flips before the tight loop.
    setTimeout(() => {
      try {
        const nSteps = solveSteps | 0;
        const residuals = [];
        const divergence = [];
        let totalTime = 0;
        for (let n = 0; n < nSteps; n++) {
          const dt = cflFn(g, nu);
          const r = stepFn(g, dt, { nu, maxPoissonIter: 200, poissonTol: 1e-5 });
          residuals.push(r.finalPoissonResidual);
          divergence.push(r.divergenceAfter);
          totalTime += dt;
        }
        const div = divFn(g, g.u, g.v, g.w, new Float32Array(g.N));
        const divMax = maxDivFn(g, div);
        const solveResult = {
          steps: nSteps,
          totalTime,
          residualLast: residuals[residuals.length - 1] ?? null,
          residualFirst: residuals[0] ?? null,
          divergenceLast: divergence[divergence.length - 1] ?? null,
          divergenceFirst: divergence[0] ?? null,
          maxDivergence: divMax,
          residualHistory: residuals,
          divergenceHistory: divergence,
          nu,
        };
        setLastSolve(solveResult);
        if (typeof window !== 'undefined') {
          const surface = window.__forgeCfd3dBcEditor || {};
          surface.grid = g;
          surface.lastSolveResult = solveResult;
          window.__forgeCfd3dBcEditor = surface;
          try {
            window.dispatchEvent(new CustomEvent('forge:cfd3d-bc-resolved', {
              detail: solveResult,
            }));
          } catch { /* ignore */ }
        }
      } catch (err) {
        setErrorMsg(err && err.message ? err.message : String(err));
      } finally {
        setRunning(false);
      }
    }, 50);
  }, [nu, solveSteps]);

  const onChangeGridSize = useCallback((e) => {
    const v = e.target.value | 0;
    if (v >= 4 && v <= 50) {
      try { buildGrid(v); }
      catch (err) {
        setErrorMsg(err && err.message ? err.message : String(err));
      }
    }
  }, [buildGrid]);

  const selectedBc = useMemo(
    () => CFD3D_BC_TYPES.find((t) => t.id === bcType) || CFD3D_BC_TYPES[0],
    [bcType],
  );

  if (!open) return null;

  return createPortal(
    <aside role="region"
           aria-label="CFD boundary condition editor"
           data-testid="forge-cfd3d-bc-editor-panel"
           data-grid-nx={gridDims.nx}
           data-grid-ny={gridDims.ny}
           data-grid-nz={gridDims.nz}
           data-last-face={lastFace || ''}
           data-last-bc={lastBC || ''}
           style={{
             position: 'fixed',
             top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
             right: 0,
             width: CFD3D_BC_EDITOR_PANEL_WIDTH,
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
          CFD · Boundary Condition Editor
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onClose}
                aria-label="Close CFD BC editor"
                data-testid="forge-cfd3d-bc-editor-close"
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
          gridTemplateColumns: '1fr 1fr',
          gap: 8,
        }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{
              fontSize: 9,
              color: 'var(--forge-ink-mute, #9aa1ab)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>Grid (N³)</span>
            <input type="number"
                   min={4} max={50} step={1}
                   value={gridDims.nx || CFD3D_BC_EDITOR_DEFAULT_NX}
                   onChange={onChangeGridSize}
                   data-testid="forge-cfd3d-bc-grid-n"
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
          <button type="button"
                  onClick={() => buildGrid(gridDims.nx || CFD3D_BC_EDITOR_DEFAULT_NX)}
                  data-testid="forge-cfd3d-bc-build-grid"
                  style={{
                    alignSelf: 'flex-end',
                    background: 'var(--forge-canvas, #0e1117)',
                    border: '1px solid var(--forge-rail-edge, #2a2d34)',
                    borderRadius: 3,
                    color: 'var(--forge-ink, #dadde2)',
                    font: 'inherit', fontSize: 11,
                    padding: '6px 10px',
                    cursor: 'pointer',
                  }}>
            Build grid (reset BCs)
          </button>
        </div>
      </section>

      <section style={{
        padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        <div style={{
          fontSize: 9,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>Face</div>
        <div data-testid="forge-cfd3d-bc-face-picker"
             style={{
               display: 'grid',
               gridTemplateColumns: 'repeat(6, 1fr)',
               gap: 4,
             }}>
          {CFD3D_BC_FACES.map((f) => (
            <FaceButton key={f.id}
                        face={f}
                        selected={face === f.id}
                        onSelect={setFace} />
          ))}
        </div>
        <div style={{
          fontSize: 10,
          fontFamily: 'var(--forge-mono, monospace)',
          color: 'var(--forge-ink-mute, #9aa1ab)',
        }}
             data-testid="forge-cfd3d-bc-face-label">
          {CFD3D_BC_FACES.find((f) => f.id === face)?.label}
        </div>
      </section>

      <section style={{
        padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        <div style={{
          fontSize: 9,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        }}>BC type</div>
        <BcTypeRadio value={bcType} onChange={setBcType} />

        {selectedBc.needsVel && (
          <div data-testid="forge-cfd3d-bc-velocity"
               style={{
                 display: 'grid',
                 gridTemplateColumns: '1fr 1fr 1fr',
                 gap: 6,
               }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{
                fontSize: 8,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>Ux</span>
              <input type="number"
                     step="0.1"
                     value={Ux}
                     onChange={(e) => setUx(+e.target.value)}
                     data-testid="forge-cfd3d-bc-ux"
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
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{
                fontSize: 8,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>Uy</span>
              <input type="number"
                     step="0.1"
                     value={Uy}
                     onChange={(e) => setUy(+e.target.value)}
                     data-testid="forge-cfd3d-bc-uy"
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
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{
                fontSize: 8,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}>Uz</span>
              <input type="number"
                     step="0.1"
                     value={Uz}
                     onChange={(e) => setUz(+e.target.value)}
                     data-testid="forge-cfd3d-bc-uz"
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
        )}

        <button type="button"
                onClick={onApply}
                data-testid="forge-cfd3d-bc-apply"
                style={{
                  background: 'var(--forge-accent-mute, #1f3a72)',
                  border: '1px solid var(--forge-accent-rim, #3a7afe)',
                  borderRadius: 3,
                  color: 'var(--forge-ink, #dadde2)',
                  font: 'inherit', fontSize: 11,
                  padding: '6px 10px',
                  cursor: 'pointer',
                }}>
          Apply BC to {face} face
        </button>
      </section>

      <section style={{
        padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
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
            }}>Re-solve steps</span>
            <input type="number"
                   min={1} max={1000} step={1}
                   value={solveSteps}
                   onChange={(e) => {
                     const v = e.target.value | 0;
                     if (v > 0 && v <= 1000) setSolveSteps(v);
                   }}
                   data-testid="forge-cfd3d-bc-solve-steps"
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
            }}>ν (m²/s)</span>
            <input type="number"
                   step="0.001"
                   value={nu}
                   onChange={(e) => {
                     const v = +e.target.value;
                     if (Number.isFinite(v) && v >= 0) setNu(v);
                   }}
                   data-testid="forge-cfd3d-bc-nu"
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

        <button type="button"
                onClick={onResolve}
                disabled={running}
                data-testid="forge-cfd3d-bc-resolve"
                style={{
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
          {running
            ? `Re-solving ${solveSteps} steps…`
            : `Re-solve ${solveSteps} SIMPLE steps`}
        </button>
      </section>

      {errorMsg ? (
        <section style={{ padding: '10px 12px' }}>
          <div data-testid="forge-cfd3d-bc-error"
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
        </section>
      ) : null}

      <section style={{
        padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8,
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip label="nx" value={gridDims.nx}
                testId="forge-cfd3d-bc-chip-nx" />
          <Chip label="ny" value={gridDims.ny}
                testId="forge-cfd3d-bc-chip-ny" />
          <Chip label="nz" value={gridDims.nz}
                testId="forge-cfd3d-bc-chip-nz" />
          <Chip label="N cells" value={counts.TOTAL}
                testId="forge-cfd3d-bc-chip-ncells" />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip label="Interior" value={counts.INTERIOR}
                testId="forge-cfd3d-bc-chip-interior" />
          <Chip label="Wall" value={counts.WALL}
                testId="forge-cfd3d-bc-chip-wall" />
          <Chip label="Inlet" value={counts.INLET}
                testId="forge-cfd3d-bc-chip-inlet" />
          <Chip label="Outlet" value={counts.OUTLET}
                testId="forge-cfd3d-bc-chip-outlet" />
          <Chip label="Lid" value={counts.LID}
                testId="forge-cfd3d-bc-chip-lid" />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <Chip label="Last face" value={lastFace || '—'}
                testId="forge-cfd3d-bc-chip-last-face"
                accent={!!lastFace} />
          <Chip label="Last BC" value={lastBC || '—'}
                testId="forge-cfd3d-bc-chip-last-bc"
                accent={!!lastBC} />
          <Chip label="Touched" value={lastTouched}
                testId="forge-cfd3d-bc-chip-last-touched" />
        </div>

        {lastSolve && (
          <div data-testid="forge-cfd3d-bc-solve-result"
               style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Chip label="Steps" value={lastSolve.steps}
                  testId="forge-cfd3d-bc-chip-steps" />
            <Chip label="t" value={lastSolve.totalTime.toExponential(2)}
                  testId="forge-cfd3d-bc-chip-time" />
            <Chip label="max |∇·u|"
                  value={(lastSolve.maxDivergence ?? 0).toExponential(2)}
                  testId="forge-cfd3d-bc-chip-divmax"
                  accent={(lastSolve.maxDivergence ?? 0) > 1e-2} />
            <Chip label="last residual"
                  value={(lastSolve.residualLast ?? 0).toExponential(2)}
                  testId="forge-cfd3d-bc-chip-residual" />
          </div>
        )}
      </section>

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
        Paints `bcType` + `bcValue` on a face plane of the PUSH-200 grid.
        Re-solve runs SIMPLE on the live grid through __forgeCfd3dHelper.
        BC enum (from navierStokes3d.js):
        INTERIOR={BC.INTERIOR} · WALL={BC.WALL} · INLET={BC.INLET} ·
        OUTLET={BC.OUTLET} · LID={BC.LID}.
      </section>

    </aside>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host.

export function Cfd3dBcEditorPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenCfd3dBcEditor  = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseCfd3dBcEditor = () => setOpen(false);

    // Make sure the helper surface exists even if Cfd3dPanelHost has not
    // mounted yet — the editor depends on it for makeGrid / step / cflDt.
    if (!window.__forgeCfd3dHelper) {
      window.__forgeCfd3dHelper = makeNavierStokes3DHelper();
    }

    // Expose the editor's public surface — the e2e + Archie drive the
    // BC apply / re-solve through these without round-tripping the React
    // tree. The grid + lastFace / lastBC / lastSolveResult fields are
    // updated in place by the panel callbacks.
    if (!window.__forgeCfd3dBcEditor) {
      window.__forgeCfd3dBcEditor = {
        grid: null,
        lastFace: null,
        lastBC: null,
        lastTouched: 0,
        lastSolveResult: null,
        applyToFace: applyBcToFace,
        countBCs: countBcTypes,
        FACES: CFD3D_BC_FACES,
        TYPES: CFD3D_BC_TYPES,
        BC,
      };
    }

    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.cfd3dBcEditor') {
        setOpen(true);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenCfd3dBcEditor; } catch {}
      try { delete window.__forgeCloseCfd3dBcEditor; } catch {}
      try { delete window.__forgeCfd3dBcEditor; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return <Cfd3dBcEditorPanel open={open} onClose={() => setOpen(false)} />;
}

export default Cfd3dBcEditorPanel;
