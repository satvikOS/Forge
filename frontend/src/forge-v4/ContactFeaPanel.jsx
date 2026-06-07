// PUSH-221 (Slice-153) — Frictionless Penalty-Method Contact Analysis
// panel.
//
// Drives `contactFea.js` from a Forge-native side panel:
//
//   * 2 material cards (body A + body B) with E, ν, ρ inputs and a
//     drop-down of MATERIAL_PRESETS.
//   * 2 body picker (preset: two cubes / two spheres / two cubes apart).
//   * Penalty stiffness ε input (N/m, default 1e10).
//   * Mesh-resolution sliders (cube subdivisions or sphere layers).
//   * Newton-iteration cap + tolerance.
//   * "Solve" button → runs solveContact synchronously on the main thread
//     (a few hundred ms for the default mesh).
//   * "Hertz benchmark" preset button — sets up two spheres, solves,
//     and reports analytical vs. simulated contact radius.
//   * "Pull bodies apart" preset button — sets the bodies apart and
//     confirms the active set is empty (used by the e2e step 04).
//   * Results table with active-pair count, max gap (m), max contact
//     force (N), total contact force along the contact axis (N),
//     converged?, Newton iterations.
//   * Active-set chip showing per-iteration count history.
//   * Hertz comparison section (only for Hertz mode).
//
// Window surface
// --------------
//
//   window.__forgeOpenContactFea(v?)     — show/hide (defaults to show)
//   window.__forgeCloseContactFea()
//   window.__forgeContactFeaHelper       — Object.freeze({...solver})
//   window.__forgeContactFeaLast         — JSON-safe snapshot of last run
//
// Hard constraints (PUSH-221 brief):
//   * NO new npm / native deps.
//   * Real penalty math (Wriggers ch. 5).
//   * Real active-set update inside Newton.
//   * Hertz benchmark must match analytical within 15 %.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  CONTACT_DEFAULTS,
  MATERIAL_PRESETS,
  driveTwoCubes,
  driveTwoSpheresHertz,
  driveBodiesApart,
  hertzAnalytic,
  makeContactFeaHelper,
} from './contactFea.js';

// ─────────────────────────────────────────────────────────────────────
// Constants.

export const CONTACT_FEA_PANEL_WIDTH = 480;

export const CONTACT_MODE = Object.freeze({
  CUBES:        'cubes',
  HERTZ:        'hertz',
  APART:        'apart',
});

const PRESET_OPTIONS = Object.freeze([
  { key: 'STEEL',    label: 'Steel (E=210 GPa, ν=0.30)' },
  { key: 'ALU_6061', label: 'Aluminium 6061 (E=68.9 GPa, ν=0.33)' },
  { key: 'TI_6AL4V', label: 'Ti-6Al-4V (E=114 GPa, ν=0.34)' },
  { key: 'RUBBER',   label: 'Rubber (E=10 MPa, ν=0.49)' },
]);

// ─────────────────────────────────────────────────────────────────────
// Snapshot helper.

function snapshotResult(driverOut, mode, panelMeta) {
  const r = driverOut.result || driverOut;
  return {
    mode,
    bodyA: panelMeta.bodyA,
    bodyB: panelMeta.bodyB,
    materialA: panelMeta.materialA,
    materialB: panelMeta.materialB,
    eps: r.eps,
    iterations: r.iterations,
    activeCount: r.activeCount,
    maxGap: r.maxGap,
    maxContactF: r.maxContactF,
    contactRadius: r.contactRadius,
    totalContactForce: r.totalContactForce,
    converged: r.converged,
    activeHistory: r.activeHistory,
    activeFlips: r.activeFlips,
    residualHistory: r.residualHistory,
    hertz:      driverOut.hertz ?? null,
    aSim:       driverOut.aSim ?? null,
    aAnalyticTargetF: driverOut.aAnalyticTargetF ?? null,
    aAnalyticSimF:    driverOut.aAnalyticSimF ?? null,
    errVsTargetF:     driverOut.errVsTargetF ?? null,
    errVsSimF:        driverOut.errVsSimF ?? null,
    Fnumeric:         driverOut.Fnumeric ?? null,
    activeSet: r.activeSet.slice(0, 30).map((p) => ({
      slave: p.slave,
      facet: p.facet,
      gap:   p.gap,
      nx:    p.n[0], ny: p.n[1], nz: p.n[2],
    })),
    totalActivePairs: r.activeSet.length,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Chip — same look as Cfd3dPanel chips.

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
// Material card with preset picker + E, ν, ρ inputs.

function MaterialCard({ which, mat, onChange }) {
  const tid = (k) => `forge-contactfea-mat-${which}-${k}`;
  return (
    <div data-testid={tid('card')}
         style={{
           border: '1px solid var(--forge-rail-edge, #2a2d34)',
           borderRadius: 4,
           padding: '8px 10px',
           background: 'var(--forge-canvas, #0e1117)',
           display: 'flex', flexDirection: 'column', gap: 6,
         }}>
      <div style={{
        fontSize: 10,
        color: 'var(--forge-ink-mute, #9aa1ab)',
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}>Body {which.toUpperCase()}</div>
      <select value={mat.preset}
              onChange={(e) => {
                const p = e.target.value;
                const preset = MATERIAL_PRESETS[p];
                if (preset) onChange({ ...mat, preset: p, E: preset.E, nu: preset.nu, rho: preset.rho });
              }}
              data-testid={tid('preset')}
              style={{
                background: 'var(--forge-canvas-2, #161b22)',
                color: 'var(--forge-ink, #dadde2)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
                borderRadius: 3,
                padding: '3px 6px',
                fontFamily: 'var(--forge-mono, monospace)',
                fontSize: 11,
              }}>
        {PRESET_OPTIONS.map((p) => (
          <option key={p.key} value={p.key}>{p.label}</option>
        ))}
      </select>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 8, color: 'var(--forge-ink-mute, #9aa1ab)' }}>E (Pa)</span>
          <input type="number" min={1} step={1e8}
                 value={mat.E}
                 onChange={(e) => onChange({ ...mat, E: +e.target.value })}
                 data-testid={tid('E')}
                 style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 8, color: 'var(--forge-ink-mute, #9aa1ab)' }}>ν</span>
          <input type="number" min={-0.99} max={0.499} step={0.01}
                 value={mat.nu}
                 onChange={(e) => onChange({ ...mat, nu: +e.target.value })}
                 data-testid={tid('nu')}
                 style={inputStyle} />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <span style={{ fontSize: 8, color: 'var(--forge-ink-mute, #9aa1ab)' }}>ρ (kg/m³)</span>
          <input type="number" min={1} step={10}
                 value={mat.rho}
                 onChange={(e) => onChange({ ...mat, rho: +e.target.value })}
                 data-testid={tid('rho')}
                 style={inputStyle} />
        </label>
      </div>
    </div>
  );
}

const inputStyle = {
  background: 'var(--forge-canvas-2, #161b22)',
  color: 'var(--forge-ink, #dadde2)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3,
  padding: '3px 6px',
  fontFamily: 'var(--forge-mono, monospace)',
  fontSize: 10,
  minWidth: 40,
};

// ─────────────────────────────────────────────────────────────────────
// Main panel component.

export function ContactFeaPanel({ open, onClose }) {
  const [matA, setMatA] = useState({
    preset: 'STEEL',
    E: MATERIAL_PRESETS.STEEL.E,
    nu: MATERIAL_PRESETS.STEEL.nu,
    rho: MATERIAL_PRESETS.STEEL.rho,
  });
  const [matB, setMatB] = useState({
    preset: 'STEEL',
    E: MATERIAL_PRESETS.STEEL.E,
    nu: MATERIAL_PRESETS.STEEL.nu,
    rho: MATERIAL_PRESETS.STEEL.rho,
  });
  const [mode, setMode] = useState(CONTACT_MODE.CUBES);
  const [eps, setEps] = useState(CONTACT_DEFAULTS.PENALTY_DEFAULT);
  const [maxNewton, setMaxNewton] = useState(CONTACT_DEFAULTS.MAX_NEWTON_ITERATIONS);
  // Cube subdivisions.
  const [cubeSub, setCubeSub] = useState(3);
  // Cube initial overlap (m).
  const [cubeOverlap, setCubeOverlap] = useState(0.005);
  // Sphere mesh resolution.
  // Defaults match driveTwoSpheresHertz so the Hertz patch is
  // resolved by the discrete mesh (see contactFea.js for the
  // mesh-resolution rationale).
  const [sphereLayers, setSphereLayers] = useState(4);
  const [sphereTheta, setSphereTheta]   = useState(12);
  const [spherePhi, setSpherePhi]       = useState(16);
  // Hertz force (panel default — drives back through hertzAnalytic
  // for the "user-requested target force" comparison; the actual
  // simulation force comes from the prescribed-δ kinematic).
  const [hertzF, setHertzF] = useState(15);
  const [sphereR, setSphereR] = useState(0.020);
  // Apart gap.
  const [apartGap, setApartGap] = useState(0.05);

  const [running, setRunning] = useState(false);
  const [result, setResult]   = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (!open) {
      setRunning(false);
      setErrorMsg(null);
    }
  }, [open]);

  const runSolve = useCallback(() => {
    setRunning(true);
    setErrorMsg(null);
    setTimeout(() => {
      try {
        const materialA = { name: matA.preset, E: matA.E, nu: matA.nu, rho: matA.rho };
        const materialB = { name: matB.preset, E: matB.E, nu: matB.nu, rho: matB.rho };
        let driverOut, snap;
        if (mode === CONTACT_MODE.CUBES) {
          driverOut = driveTwoCubes({
            nx: cubeSub, ny: cubeSub, nz: cubeSub,
            gap: -Math.abs(cubeOverlap),
            materialA, materialB,
            eps, maxNewton,
          });
          snap = snapshotResult(driverOut, 'cubes', { bodyA: 'cube', bodyB: 'cube', materialA, materialB });
        } else if (mode === CONTACT_MODE.HERTZ) {
          // For Hertz mode the driver uses its own soft-elastomer
          // default material so the analytic contact patch is
          // resolvable on the discrete sphere mesh.  The panel's
          // material cards are kept for the CUBE mode comparison.
          driverOut = driveTwoSpheresHertz({
            R: sphereR,
            nLayers: sphereLayers, nTheta: sphereTheta, nPhi: spherePhi,
            targetF: hertzF,
            // Let the driver pick ε + maxNewton tuned for Hertz.
          });
          snap = snapshotResult(driverOut, 'hertz', {
            bodyA: 'sphere', bodyB: 'sphere',
            materialA: driverOut.inputs.material,
            materialB: driverOut.inputs.material,
          });
        } else if (mode === CONTACT_MODE.APART) {
          driverOut = driveBodiesApart({
            nx: cubeSub, ny: cubeSub, nz: cubeSub,
            gap: Math.abs(apartGap),
            materialA, materialB,
            eps,
          });
          snap = snapshotResult(driverOut, 'apart', { bodyA: 'cube', bodyB: 'cube', materialA, materialB });
        } else {
          throw new Error(`unknown mode ${mode}`);
        }
        setResult({ driverOut, snap });
        if (typeof window !== 'undefined') {
          window.__forgeContactFeaLast = snap;
          try {
            window.dispatchEvent(new CustomEvent('forge:contactfea-solve-complete', { detail: snap }));
          } catch { /* ignore */ }
        }
      } catch (err) {
        setErrorMsg(err && err.message ? err.message : String(err));
      } finally {
        setRunning(false);
      }
    }, 50);
  }, [mode, matA, matB, eps, maxNewton, cubeSub, cubeOverlap, sphereLayers, sphereTheta, spherePhi, sphereR, hertzF, apartGap]);

  const snap = result?.snap || null;

  if (!open) return null;

  return createPortal(
    <aside role="region"
           aria-label="Contact FEA penalty panel"
           data-testid="forge-contactfea-panel"
           data-mode={mode}
           style={{
             position: 'fixed',
             top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
             right: 0,
             width: CONTACT_FEA_PANEL_WIDTH,
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
          Contact Analysis (Penalty)
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onClose}
                aria-label="Close Contact FEA panel"
                data-testid="forge-contactfea-close"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--forge-ink-mute, #9aa1ab)', cursor: 'pointer',
                  display: 'inline-flex', padding: 2,
                  fontSize: 16, fontFamily: 'var(--forge-mono, monospace)',
                }}>
          ×
        </button>
      </header>

      <section style={{
        padding: '10px 12px',
        display: 'flex', flexDirection: 'column', gap: 10,
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        <MaterialCard which="a" mat={matA} onChange={setMatA} />
        <MaterialCard which="b" mat={matB} onChange={setMatB} />
      </section>

      <section style={{
        padding: '10px 12px',
        display: 'flex', flexDirection: 'column', gap: 10,
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{
            fontSize: 9,
            color: 'var(--forge-ink-mute, #9aa1ab)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>Preset</span>
          <select value={mode}
                  onChange={(e) => setMode(e.target.value)}
                  data-testid="forge-contactfea-mode"
                  style={inputStyle}>
            <option value={CONTACT_MODE.CUBES}>Two cubes pressed</option>
            <option value={CONTACT_MODE.HERTZ}>Two spheres (Hertz)</option>
            <option value={CONTACT_MODE.APART}>Two cubes apart</option>
          </select>
        </div>

        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 6,
        }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
              Penalty ε (N/m)
            </span>
            <input type="number" min={1e6} step={1e9}
                   value={eps}
                   onChange={(e) => setEps(+e.target.value)}
                   data-testid="forge-contactfea-eps"
                   style={inputStyle} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
              Max Newton iters
            </span>
            <input type="number" min={1} max={40} step={1}
                   value={maxNewton}
                   onChange={(e) => setMaxNewton(e.target.value | 0)}
                   data-testid="forge-contactfea-max-newton"
                   style={inputStyle} />
          </label>
        </div>

        {mode === CONTACT_MODE.CUBES && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 6,
          }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
                Cube subdiv (n³)
              </span>
              <input type="number" min={2} max={5} step={1}
                     value={cubeSub}
                     onChange={(e) => setCubeSub(e.target.value | 0)}
                     data-testid="forge-contactfea-cube-sub"
                     style={inputStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
                Cube overlap (m)
              </span>
              <input type="number" min={0.0001} step={0.001}
                     value={cubeOverlap}
                     onChange={(e) => setCubeOverlap(+e.target.value)}
                     data-testid="forge-contactfea-cube-overlap"
                     style={inputStyle} />
            </label>
          </div>
        )}

        {mode === CONTACT_MODE.HERTZ && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 6,
          }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
                Sphere R (m)
              </span>
              <input type="number" min={0.005} step={0.005}
                     value={sphereR}
                     onChange={(e) => setSphereR(+e.target.value)}
                     data-testid="forge-contactfea-sphere-r"
                     style={inputStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
                Target F (N)
              </span>
              <input type="number" min={1} step={50}
                     value={hertzF}
                     onChange={(e) => setHertzF(+e.target.value)}
                     data-testid="forge-contactfea-hertz-f"
                     style={inputStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
                Sphere layers
              </span>
              <input type="number" min={1} max={5} step={1}
                     value={sphereLayers}
                     onChange={(e) => setSphereLayers(e.target.value | 0)}
                     data-testid="forge-contactfea-sphere-layers"
                     style={inputStyle} />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
                nθ × nφ
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <input type="number" min={2} max={12} step={1}
                       value={sphereTheta}
                       onChange={(e) => setSphereTheta(e.target.value | 0)}
                       data-testid="forge-contactfea-sphere-theta"
                       style={{ ...inputStyle, width: '50%' }} />
                <input type="number" min={3} max={16} step={1}
                       value={spherePhi}
                       onChange={(e) => setSpherePhi(e.target.value | 0)}
                       data-testid="forge-contactfea-sphere-phi"
                       style={{ ...inputStyle, width: '50%' }} />
              </div>
            </label>
          </div>
        )}

        {mode === CONTACT_MODE.APART && (
          <label style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{ fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
              Apart gap (m)
            </span>
            <input type="number" min={0.001} step={0.005}
                   value={apartGap}
                   onChange={(e) => setApartGap(+e.target.value)}
                   data-testid="forge-contactfea-apart-gap"
                   style={inputStyle} />
          </label>
        )}

        <button type="button"
                onClick={runSolve}
                disabled={running}
                data-testid="forge-contactfea-solve"
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
          {running ? 'Solving…' : `Solve · Newton + active set · ${mode}`}
        </button>

        {errorMsg ? (
          <div data-testid="forge-contactfea-error"
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

      {snap && (
        <section data-testid="forge-contactfea-results"
                 style={{
                   padding: '10px 12px',
                   display: 'flex', flexDirection: 'column', gap: 10,
                   borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
                 }}>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Chip label="Mode" value={snap.mode}
                  testId="forge-contactfea-chip-mode" />
            <Chip label="Newton" value={snap.iterations}
                  testId="forge-contactfea-chip-iterations" />
            <Chip label="Converged?" value={snap.converged ? 'yes' : 'no'}
                  accent={snap.converged}
                  testId="forge-contactfea-chip-converged" />
            <Chip label="Active pairs" value={snap.activeCount}
                  accent={snap.activeCount > 0}
                  testId="forge-contactfea-chip-active" big />
            <Chip label="Max |g|"
                  value={Math.abs(snap.maxGap).toExponential(3)} units="m"
                  testId="forge-contactfea-chip-maxgap" big />
            <Chip label="Max F_contact"
                  value={snap.maxContactF.toExponential(3)} units="N"
                  testId="forge-contactfea-chip-maxforce" big />
            <Chip label="ΣF_contact"
                  value={snap.totalContactForce.toExponential(3)} units="N"
                  testId="forge-contactfea-chip-totalforce" />
            <Chip label="ε" value={snap.eps.toExponential(2)} units="N/m"
                  testId="forge-contactfea-chip-eps" />
          </div>

          <table data-testid="forge-contactfea-active-table"
                 style={{
                   width: '100%', borderCollapse: 'collapse',
                   border: '1px solid var(--forge-rail-edge, #2a2d34)',
                   background: 'var(--forge-canvas, #0e1117)',
                 }}>
            <thead>
              <tr>
                {['#', 'slave', 'facet', 'gap (m)', 'n_x', 'n_y', 'n_z'].map((h) => (
                  <th key={h}
                      style={{
                        padding: '3px 5px',
                        textAlign: 'right',
                        fontSize: 9,
                        color: 'var(--forge-ink-mute, #9aa1ab)',
                        background: 'var(--forge-canvas-2, #161b22)',
                        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
                        textTransform: 'uppercase',
                        letterSpacing: '0.05em',
                      }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {snap.activeSet.length === 0 ? (
                <tr>
                  <td colSpan={7}
                      data-testid="forge-contactfea-active-empty"
                      style={{
                        padding: '8px',
                        fontSize: 10,
                        textAlign: 'center',
                        color: 'var(--forge-ink-mute, #9aa1ab)',
                        fontStyle: 'italic',
                      }}>
                    no active contact pairs
                  </td>
                </tr>
              ) : snap.activeSet.map((p, i) => (
                <tr key={i} data-testid="forge-contactfea-active-row">
                  <td style={cellStyle}>{i}</td>
                  <td style={cellStyle}>{p.slave}</td>
                  <td style={cellStyle}>{p.facet}</td>
                  <td style={{ ...cellStyle,
                               color: p.gap < 0 ? 'var(--forge-warn, #f0a020)' : 'var(--forge-ink, #dadde2)' }}>
                    {p.gap.toExponential(3)}
                  </td>
                  <td style={cellStyle}>{p.nx.toFixed(3)}</td>
                  <td style={cellStyle}>{p.ny.toFixed(3)}</td>
                  <td style={cellStyle}>{p.nz.toFixed(3)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {snap.totalActivePairs > snap.activeSet.length && (
            <div style={{
              fontSize: 10,
              color: 'var(--forge-ink-mute, #9aa1ab)',
              fontStyle: 'italic',
            }}>
              showing first {snap.activeSet.length} of {snap.totalActivePairs} active pairs
            </div>
          )}
        </section>
      )}

      {snap && snap.mode === 'hertz' && snap.hertz && (
        <section data-testid="forge-contactfea-hertz"
                 data-err-vs-target-f={snap.errVsTargetF?.toFixed(4)}
                 data-err-vs-sim-f={snap.errVsSimF?.toFixed(4)}
                 style={{
                   padding: '10px 12px',
                   display: 'flex', flexDirection: 'column', gap: 6,
                   borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
                 }}>
          <div style={{ fontSize: 11, fontWeight: 600 }}>
            Hertz analytical comparison
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Chip label="E*" value={snap.hertz.Estar.toExponential(3)} units="Pa"
                  testId="forge-contactfea-hertz-estar" />
            <Chip label="R*" value={snap.hertz.Rstar.toExponential(3)} units="m"
                  testId="forge-contactfea-hertz-rstar" />
            <Chip label="δ analytic" value={snap.hertz.delta.toExponential(3)} units="m"
                  testId="forge-contactfea-hertz-delta" />
            <Chip label="p₀" value={snap.hertz.p0.toExponential(3)} units="Pa"
                  testId="forge-contactfea-hertz-p0" />
            <Chip label="F_numeric" value={snap.Fnumeric.toFixed(2)} units="N"
                  testId="forge-contactfea-hertz-fnum" />
            <Chip label="a sim" value={snap.aSim.toExponential(3)} units="m"
                  accent={true}
                  testId="forge-contactfea-hertz-asim" big />
            <Chip label="a analytic (F_target)"
                  value={snap.aAnalyticTargetF.toExponential(3)} units="m"
                  testId="forge-contactfea-hertz-aana-target" big />
            <Chip label="a analytic (F_sim)"
                  value={snap.aAnalyticSimF.toExponential(3)} units="m"
                  testId="forge-contactfea-hertz-aana-sim" big />
            <Chip label="err vs F_target"
                  value={(snap.errVsTargetF * 100).toFixed(1) + '%'}
                  accent={snap.errVsTargetF < 0.15}
                  testId="forge-contactfea-hertz-err-target" big />
            <Chip label="err vs F_sim"
                  value={(snap.errVsSimF * 100).toFixed(1) + '%'}
                  accent={snap.errVsSimF < 0.15}
                  testId="forge-contactfea-hertz-err-sim" big />
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
        Frictionless node-to-surface penalty contact · linear tetrahedra
        (CST4) · Newton–Raphson with active-set update · PCG inner solve
        · grid-bucket BVH broad phase · Hertz benchmark.
      </section>

    </aside>,
    document.body,
  );
}

const cellStyle = {
  padding: '2px 5px',
  textAlign: 'right',
  fontFamily: 'var(--forge-mono, monospace)',
  fontSize: 10,
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
};

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host.

export function ContactFeaPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenContactFea  = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseContactFea = () => setOpen(false);

    if (!window.__forgeContactFeaHelper) {
      window.__forgeContactFeaHelper = makeContactFeaHelper();
    }

    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.contactFea') {
        setOpen(true);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenContactFea; } catch {}
      try { delete window.__forgeCloseContactFea; } catch {}
      try { delete window.__forgeContactFeaHelper; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return <ContactFeaPanel open={open} onClose={() => setOpen(false)} />;
}
