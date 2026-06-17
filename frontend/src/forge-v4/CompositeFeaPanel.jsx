// PUSH-223 (Slice-166) — Composite Shell FEA panel.
//
// Mounts via window.__forgeOpenCompositeFea() or the menu action
// tools.compositeFea. Drives the 4-node Mindlin shell solver in
// compositeFea.js + the classical lamination ABD matrix in
// compositesMath.js + the Tsai-Wu / Tsai-Hill / max-stress polynomial
// failure criteria.
//
// Window surface
// --------------
//
//   * window.__forgeOpenCompositeFea(true|false)    — show / hide.
//   * window.__forgeCloseCompositeFea()
//   * window.__forgeCompositeFeaHelper              — solver export
//                                                     surface (so the
//                                                     e2e + Archie can
//                                                     drive the math
//                                                     headlessly).
//   * window.__forgeCompositeFeaLast                — last run snapshot
//                                                     (mesh, displacements,
//                                                     per-ply RF table,
//                                                     first-ply failure).
//
// Headed event:  forge:composite-fea-complete with detail payload
//                mirroring __forgeCompositeFeaLast.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  COMPOSITE_MATERIALS, COMPOSITE_MATERIAL_IDS,
  makeQuasiIsoLayup, normalisePly, expandPlies, computeABD,
} from './compositesMath.js';
import {
  COMPOSITE_FEA_DEFAULTS, LOAD_PATTERNS,
  solveCompositeShell, makeCompositeFeaHelper,
} from './compositeFea.js';

// ─────────────────────────────────────────────────────────────────────
// Layup presets — exposed so the panel + e2e can request named stacks.

function makeUnidirectionalLayup({
  material = 'UD CFRP', plyCount = 8, area_mm2 = 100 * 100,
  orientation_deg = 0,
} = {}) {
  const t = COMPOSITE_MATERIALS[material]?.nominalPlyThickness_mm || 0.125;
  const plies = [];
  for (let i = 0; i < plyCount; i++) {
    plies.push({
      id: `ply-ud-${i}`, material,
      orientation_deg, thickness_mm: t, count: 1, area_mm2,
    });
  }
  return {
    version: 1,
    name: `[${orientation_deg}]_${plyCount} ${material}`,
    plies,
  };
}

function makeSimpleSymmetricLayup({
  material = 'UD CFRP', area_mm2 = 100 * 100,
  pattern = [0, 90, 0, 90],
} = {}) {
  const t = COMPOSITE_MATERIALS[material]?.nominalPlyThickness_mm || 0.125;
  const seq = pattern.concat(pattern.slice().reverse());
  const plies = seq.map((orient, i) => ({
    id: `ply-sym-${i}`, material,
    orientation_deg: orient, thickness_mm: t, count: 1, area_mm2,
  }));
  return {
    version: 1,
    name: `[${pattern.join('/')}]s ${material}`,
    plies,
  };
}

// True 8-ply [0/+45/-45/90]s quasi-isotropic layup with equal counts of
// each orientation. The compositesMath.makeQuasiIsoLayup helper ships
// a 10-ply approximation (4× 0°, 2× ±45°, 2× 90°) which does NOT
// satisfy A11 ≈ A22 — this PUSH-223 helper builds the canonical
// equal-count quasi-iso so the FE assertions hold.
function makeTrueQuasiIsoLayup({
  material = 'UD CFRP', area_mm2 = 100 * 100,
} = {}) {
  const t = COMPOSITE_MATERIALS[material]?.nominalPlyThickness_mm || 0.125;
  const seq = [0, 45, -45, 90, 90, -45, 45, 0];
  const plies = seq.map((orient, i) => ({
    id: `ply-qi-${i}`, material,
    orientation_deg: orient, thickness_mm: t, count: 1, area_mm2,
  }));
  return {
    version: 1,
    name: '[0/+45/-45/90]s quasi-iso (8-ply, equal counts)',
    plies,
  };
}

const LAYUP_PRESETS = Object.freeze({
  QUASI_ISO: 'quasi-iso',
  CROSS_PLY: 'cross-ply-0-90',
  UD_0:      'unidirectional-0',
  UD_90:     'unidirectional-90',
});

function buildLayupFromPreset(preset) {
  switch (preset) {
    case LAYUP_PRESETS.QUASI_ISO:
      // True equal-count quasi-iso for A11 ≈ A22 + isotropy identity.
      return makeTrueQuasiIsoLayup({ material: 'UD CFRP' });
    case LAYUP_PRESETS.CROSS_PLY:
      return makeSimpleSymmetricLayup({
        material: 'UD CFRP', pattern: [0, 90],
      });
    case LAYUP_PRESETS.UD_0:
      return makeUnidirectionalLayup({
        material: 'UD CFRP', orientation_deg: 0,
      });
    case LAYUP_PRESETS.UD_90:
      return makeUnidirectionalLayup({
        material: 'UD CFRP', orientation_deg: 90,
      });
    default:
      return makeQuasiIsoLayup({ material: 'UD CFRP' });
  }
}

// Expose the helper aggregate WITH the layup factory for the e2e.
function makeFullHelper() {
  const base = makeCompositeFeaHelper();
  return Object.freeze({
    ...base,
    LAYUP_PRESETS,
    buildLayupFromPreset,
    makeUnidirectionalLayup,
    makeSimpleSymmetricLayup,
    makeTrueQuasiIsoLayup,
    makeQuasiIsoLayup,
    computeABD,
    expandPlies,
    COMPOSITE_MATERIALS,
  });
}

// ─────────────────────────────────────────────────────────────────────
// UI styling — match the TransientFeaPanel + ContactFeaPanel palette.

export const COMPOSITE_FEA_PANEL_WIDTH = 540;

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
// Snapshot — JSON-safe summary for window.__forgeCompositeFeaLast.

function snapshotResult(out, panelMeta) {
  return {
    Lx_mm: out.Lx_mm, Ly_mm: out.Ly_mm,
    nx: out.nx, ny: out.ny,
    loadPattern:   out.loadPattern,
    loadMagnitude: out.loadMagnitude,
    bcType:        out.bcType,
    nPlies:        out.nPlies,
    nElements:     out.nElements,
    N:             out.N,
    layupName:     panelMeta.layupName,
    layupPreset:   panelMeta.layupPreset,
    // Section
    A_NperMM:   out.A_NperMM,
    B_NperMM:   out.B_NperMM,
    D_NmmPerMM: out.D_NmmPerMM,
    As_NperMM:  out.As_NperMM,
    totalThickness_mm: out.totalThickness_mm,
    // Displacements
    maxAbsU:     out.maxAbsU,
    maxAbsW:     out.maxAbsW,
    maxAbsTheta: out.maxAbsTheta,
    // Failure
    fpf: out.fpf,
    perPlyTable: out.perPlyTable,
    // Timing
    elapsedSolveMs: out.elapsedSolveMs,
    elapsedTotalMs: out.elapsedTotalMs,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Per-ply RF result table.

function PerPlyTable({ table }) {
  if (!Array.isArray(table) || table.length === 0) {
    return (
      <div data-testid="forge-composite-fea-plytable-empty"
           style={{
             padding: '8px 6px', fontSize: 11,
             color: 'var(--forge-ink-mute, #9aa1ab)',
             fontStyle: 'italic',
           }}>
        Run the analysis to populate the per-ply reserve-factor table.
      </div>
    );
  }
  return (
    <div data-testid="forge-composite-fea-plytable"
         data-plycount={table.length}>
      <table style={{
        width: '100%',
        borderCollapse: 'collapse',
        fontFamily: 'var(--forge-mono, monospace)',
        fontSize: 10,
      }}>
        <thead>
          <tr style={{
            color: 'var(--forge-ink-mute, #9aa1ab)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>
            <th style={{ textAlign: 'right', padding: '4px 6px' }}>#</th>
            <th style={{ textAlign: 'left',  padding: '4px 6px' }}>Material</th>
            <th style={{ textAlign: 'right', padding: '4px 6px' }}>Orient</th>
            <th style={{ textAlign: 'right', padding: '4px 6px' }}>z mid</th>
            <th style={{ textAlign: 'right', padding: '4px 6px' }}>min RF</th>
            <th style={{ textAlign: 'right', padding: '4px 6px' }}>max FI</th>
            <th style={{ textAlign: 'left',  padding: '4px 6px' }}>Crit.</th>
          </tr>
        </thead>
        <tbody>
          {table.map((row, i) => (
            <tr key={i}
                data-testid={`forge-composite-fea-plyrow-${i}`}
                data-rf={Number.isFinite(row.minRF) ? row.minRF.toExponential(4) : 'inf'}
                data-orient={row.orientation_deg}
                style={{
                  borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
                  color: row.minRF < 1
                    ? 'var(--forge-err, #ff6363)'
                    : 'var(--forge-ink, #dadde2)',
                }}>
              <td style={{ textAlign: 'right', padding: '3px 6px' }}>
                {row.plyIndex + 1}
              </td>
              <td style={{ textAlign: 'left', padding: '3px 6px' }}>
                {row.material}
              </td>
              <td style={{ textAlign: 'right', padding: '3px 6px' }}>
                {row.orientation_deg > 0 ? '+' : ''}{row.orientation_deg}°
              </td>
              <td style={{ textAlign: 'right', padding: '3px 6px' }}>
                {row.z_mid_mm.toFixed(4)}
              </td>
              <td style={{ textAlign: 'right', padding: '3px 6px' }}>
                {Number.isFinite(row.minRF) ? row.minRF.toExponential(3) : '∞'}
              </td>
              <td style={{ textAlign: 'right', padding: '3px 6px' }}>
                {Number.isFinite(row.maxFI) ? row.maxFI.toExponential(3) : '∞'}
              </td>
              <td style={{ textAlign: 'left', padding: '3px 6px' }}>
                {row.criticalCriterion || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Main panel.

export function CompositeFeaPanel({ open, onClose }) {
  const [layupPreset, setLayupPreset] = useState(LAYUP_PRESETS.CROSS_PLY);
  const [Lx, setLx] = useState(100);
  const [Ly, setLy] = useState(100);
  const [nx, setNx] = useState(4);
  const [ny, setNy] = useState(4);
  const [loadPattern, setLoadPattern] = useState(LOAD_PATTERNS.TENSION_X);
  const [loadMag, setLoadMag] = useState(100);
  const [bcType, setBcType] = useState('clamped-left');
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (!open) {
      setRunning(false);
      setErrorMsg(null);
    }
  }, [open]);

  const onChangeLx = useCallback((e) => {
    const v = +e.target.value;
    if (Number.isFinite(v) && v > 0) setLx(v);
  }, []);
  const onChangeLy = useCallback((e) => {
    const v = +e.target.value;
    if (Number.isFinite(v) && v > 0) setLy(v);
  }, []);
  const onChangeNx = useCallback((e) => {
    const v = +e.target.value | 0;
    if (Number.isFinite(v) && v >= 1) setNx(v);
  }, []);
  const onChangeNy = useCallback((e) => {
    const v = +e.target.value | 0;
    if (Number.isFinite(v) && v >= 1) setNy(v);
  }, []);
  const onChangeLoadMag = useCallback((e) => {
    const v = +e.target.value;
    if (Number.isFinite(v)) setLoadMag(v);
  }, []);
  const onChangeLoadType = useCallback((e) => setLoadPattern(e.target.value), []);
  const onChangeBcType = useCallback((e) => setBcType(e.target.value), []);
  const onChangeLayupPreset = useCallback((e) => setLayupPreset(e.target.value), []);

  // The actual layup book for the configured preset.
  const book = useMemo(() => buildLayupFromPreset(layupPreset), [layupPreset]);

  const onRun = useCallback(() => {
    setRunning(true);
    setErrorMsg(null);
    setTimeout(() => {
      try {
        const out = solveCompositeShell({
          layup: book,
          Lx_mm: Lx, Ly_mm: Ly, nx, ny,
          loadPattern, loadMagnitude: loadMag,
          bcType,
        });
        const snap = snapshotResult(out, {
          layupName: book.name,
          layupPreset,
        });
        setResult({ out, snap });
        if (typeof window !== 'undefined') {
          window.__forgeCompositeFeaLast = snap;
          try {
            window.dispatchEvent(new CustomEvent('forge:composite-fea-complete', {
              detail: snap,
            }));
          } catch {}
        }
      } catch (err) {
        setErrorMsg(err && err.message ? err.message : String(err));
      } finally {
        setRunning(false);
      }
    }, 50);
  }, [book, Lx, Ly, nx, ny, loadPattern, loadMag, bcType, layupPreset]);

  if (!open) return null;

  return createPortal(
    <aside role="region"
           aria-label="Composite shell FEA panel"
           data-testid="forge-composite-fea-panel"
           style={{
             position: 'fixed',
             top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
             right: 0,
             width: COMPOSITE_FEA_PANEL_WIDTH,
             maxWidth: '96vw',
             height: 'calc(100vh - var(--forge-topbar-h, 40px) - var(--forge-qat-h, 32px) - var(--forge-cmdbar-h, 24px))',
             background: 'var(--forge-canvas-2, #161b22)',
             borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
             boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
             display: 'flex', flexDirection: 'column',
             fontSize: 12,
             color: 'var(--forge-ink, #dadde2)',
             zIndex: 1297,
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
          Composite Shell FEA (Mindlin · ABD · Tsai-Wu)
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onClose}
                aria-label="Close composite FEA panel"
                data-testid="forge-composite-fea-close"
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
          4-node Mindlin-Reissner shell · 5 DOFs/node (u, v, w, θ<sub>x</sub>, θ<sub>y</sub>) · 2×2
          Gauss for membrane / bending · 1-point reduced shear (anti-locking) ·
          classical lamination ABD (compositesMath) · Tsai-Wu / Tsai-Hill /
          max-stress per-ply failure check.
        </div>
      </section>

      <section style={{
        padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10,
        borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{
            fontSize: 9,
            color: 'var(--forge-ink-mute, #9aa1ab)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>Layup preset</span>
          <select value={layupPreset}
                  onChange={onChangeLayupPreset}
                  data-testid="forge-composite-fea-layup"
                  style={selectStyle}>
            <option value={LAYUP_PRESETS.QUASI_ISO}>
              [0/+45/−45/90]<sub>s</sub> Quasi-isotropic (CFRP)
            </option>
            <option value={LAYUP_PRESETS.CROSS_PLY}>
              [0/90]<sub>s</sub> Cross-ply (CFRP)
            </option>
            <option value={LAYUP_PRESETS.UD_0}>
              [0]<sub>8</sub> Unidirectional (CFRP, fibre = x)
            </option>
            <option value={LAYUP_PRESETS.UD_90}>
              [90]<sub>8</sub> Unidirectional (CFRP, fibre = y)
            </option>
          </select>
        </label>
        <div style={{
          fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
          fontFamily: 'var(--forge-mono, monospace)',
        }}>
          Active: <span data-testid="forge-composite-fea-layup-name">
            {book.name}
          </span> · <span data-testid="forge-composite-fea-layup-plycount">
            {expandPlies(book).length} plies
          </span>
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
        }}>
          <Field label="Lx (mm)" testId="forge-composite-fea-lx"
                 value={Lx} onChange={onChangeLx}
                 min={1} max={1e5} step={1} type="number" />
          <Field label="Ly (mm)" testId="forge-composite-fea-ly"
                 value={Ly} onChange={onChangeLy}
                 min={1} max={1e5} step={1} type="number" />
          <Field label="nx (elements)" testId="forge-composite-fea-nx"
                 value={nx} onChange={onChangeNx}
                 min={1} max={64} step={1} type="number" />
          <Field label="ny (elements)" testId="forge-composite-fea-ny"
                 value={ny} onChange={onChangeNy}
                 min={1} max={64} step={1} type="number" />
        </div>

        <div style={{
          display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
        }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{
              fontSize: 9,
              color: 'var(--forge-ink-mute, #9aa1ab)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>Load pattern</span>
            <select value={loadPattern}
                    onChange={onChangeLoadType}
                    data-testid="forge-composite-fea-loadtype"
                    style={selectStyle}>
              <option value={LOAD_PATTERNS.TENSION_X}>Tension (x edge)</option>
              <option value={LOAD_PATTERNS.TENSION_Y}>Tension (y edge)</option>
              <option value={LOAD_PATTERNS.SHEAR}>In-plane shear</option>
              <option value={LOAD_PATTERNS.BENDING}>Edge bending moment</option>
              <option value={LOAD_PATTERNS.PRESSURE}>Out-of-plane pressure</option>
            </select>
          </label>
          <Field label="Magnitude (N/mm or MPa)"
                 testId="forge-composite-fea-loadmag"
                 value={loadMag} onChange={onChangeLoadMag}
                 min={-1e6} max={1e6} step={1} type="number" />
        </div>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span style={{
            fontSize: 9,
            color: 'var(--forge-ink-mute, #9aa1ab)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}>Boundary condition</span>
          <select value={bcType}
                  onChange={onChangeBcType}
                  data-testid="forge-composite-fea-bctype"
                  style={selectStyle}>
            <option value="clamped-left">Left edge clamped (all 5 DOFs)</option>
            <option value="pinned-left">Left edge pinned (u, v, w only)</option>
          </select>
        </label>

        <div>
          <button type="button"
                  onClick={onRun}
                  disabled={running}
                  data-testid="forge-composite-fea-run"
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
            {running ? 'Solving…' : 'Run composite shell analysis'}
          </button>
        </div>

        {errorMsg ? (
          <div data-testid="forge-composite-fea-error"
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
            <Chip label="Elements" value={result.snap.nElements}
                  testId="forge-composite-fea-chip-elements" />
            <Chip label="DOFs" value={result.snap.N}
                  testId="forge-composite-fea-chip-dofs" />
            <Chip label="Plies" value={result.snap.nPlies}
                  testId="forge-composite-fea-chip-plies" />
            <Chip label="solve t"
                  value={result.snap.elapsedSolveMs.toFixed(1)} units="ms"
                  testId="forge-composite-fea-chip-elapsed" />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Chip label="max |u|"
                  value={result.snap.maxAbsU.toExponential(3)} units="mm"
                  testId="forge-composite-fea-chip-maxu" big />
            <Chip label="max |w|"
                  value={result.snap.maxAbsW.toExponential(3)} units="mm"
                  testId="forge-composite-fea-chip-maxw" big />
            <Chip label="max |θ|"
                  value={result.snap.maxAbsTheta.toExponential(3)} units="rad"
                  testId="forge-composite-fea-chip-maxtheta" big />
          </div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <Chip label="A11"
                  value={(result.snap.A_NperMM[0][0]).toExponential(3)}
                  units="N/mm"
                  testId="forge-composite-fea-chip-a11" />
            <Chip label="A22"
                  value={(result.snap.A_NperMM[1][1]).toExponential(3)}
                  units="N/mm"
                  testId="forge-composite-fea-chip-a22" />
            <Chip label="A66"
                  value={(result.snap.A_NperMM[2][2]).toExponential(3)}
                  units="N/mm"
                  testId="forge-composite-fea-chip-a66" />
            <Chip label="D11"
                  value={(result.snap.D_NmmPerMM[0][0]).toExponential(3)}
                  units="N·mm"
                  testId="forge-composite-fea-chip-d11" />
            <Chip label="t total"
                  value={result.snap.totalThickness_mm.toFixed(4)}
                  units="mm"
                  testId="forge-composite-fea-chip-thickness" />
          </div>
          <div style={{
            display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap',
            background: result.snap.fpf.RF < 1
              ? 'var(--forge-err-mute, #4a1c1c)'
              : 'var(--forge-accent-mute, #1f3a72)',
            padding: '6px 8px',
            border: '1px solid '
              + (result.snap.fpf.RF < 1
                  ? 'var(--forge-err, #ff6363)'
                  : 'var(--forge-accent-rim, #3a7afe)'),
            borderRadius: 4,
          }}>
            <span style={{
              fontSize: 9,
              color: 'var(--forge-ink-mute, #9aa1ab)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}>First-ply failure</span>
            <span data-testid="forge-composite-fea-fpf-rf"
                  style={{
                    fontFamily: 'var(--forge-mono, monospace)',
                    fontSize: 12,
                    color: result.snap.fpf.RF < 1
                      ? 'var(--forge-err, #ff6363)'
                      : 'var(--forge-ok, #4caf50)',
                  }}>
              RF = {Number.isFinite(result.snap.fpf.RF)
                ? result.snap.fpf.RF.toExponential(3)
                : '∞'}
            </span>
            <span data-testid="forge-composite-fea-fpf-ply"
                  style={{
                    fontFamily: 'var(--forge-mono, monospace)',
                    fontSize: 11,
                  }}>
              ply #{result.snap.fpf.plyIndex + 1}
            </span>
            <span data-testid="forge-composite-fea-fpf-criterion"
                  style={{
                    fontFamily: 'var(--forge-mono, monospace)',
                    fontSize: 11,
                  }}>
              {result.snap.fpf.criterion || '—'}
            </span>
            <span data-testid="forge-composite-fea-fpf-load"
                  style={{
                    fontFamily: 'var(--forge-mono, monospace)',
                    fontSize: 11,
                  }}>
              load = {Number.isFinite(result.snap.fpf.loadAtFailure)
                ? result.snap.fpf.loadAtFailure.toExponential(3)
                : '∞'}
            </span>
          </div>
        </section>
      )}

      {result && (
        <section style={{
          padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 10,
          borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
          <div style={{
            color: 'var(--forge-ink-mute, #9aa1ab)',
            fontSize: 11, fontFamily: 'var(--forge-mono, monospace)',
          }}>
            Per-ply reserve factors (envelopes over all element Gauss
            points). Red rows fail the criterion.
          </div>
          <PerPlyTable table={result.snap.perPlyTable} />
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
        Bilinear Q4 element · 20 DOFs total · K = K<sub>m</sub> + K<sub>mb</sub> + K<sub>b</sub> + K<sub>s</sub> ·
        K<sub>s</sub> uses 1-pt reduced quadrature (Mindlin κ<sub>s</sub> = 5/6) ·
        dense LU solver.
      </section>
    </aside>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host.

export function CompositeFeaPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenCompositeFea  = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseCompositeFea = () => setOpen(false);

    // Headless solver surface — installs before mount so the e2e can
    // exercise the math without touching React.
    if (!window.__forgeCompositeFeaHelper) {
      window.__forgeCompositeFeaHelper = makeFullHelper();
    }

    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.compositeFea') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenCompositeFea; } catch {}
      try { delete window.__forgeCloseCompositeFea; } catch {}
      try { delete window.__forgeCompositeFeaHelper; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return (
    <CompositeFeaPanel open={open} onClose={() => setOpen(false)} />
  );
}

export default CompositeFeaPanel;
