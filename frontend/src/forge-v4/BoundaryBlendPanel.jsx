// PUSH-208 (Slice-155) — N-sided Boundary Blend panel.
//
// Class-A surfacing primitive used by Alias / ICEM Surf to fill an N-sided
// hole bounded by 3..8 curves while holding G1 to a base surface across
// every edge. Surface contract:
//
//   * Curve list — Add up to 8 boundary curves (auto-seeded with a test
//     triangle of 3 quadratic Beziers; the user can switch between
//     "triangle / square / pentagon / hex / oct" presets or drive the
//     headless surface directly).
//   * Grid density slider — 6..80, default 30 (per the brief).
//   * Build button → tessellates a THREE.BufferGeometry, adds it to
//     `window.__forgeScene` as a new mesh, surfaces:
//       - max G1 deviation along each boundary (degrees)
//       - global max G1 deviation
//       - triangle / vertex counts
//   * Real validation: degenerate (all collinear) input shows a real
//     error and refuses to build. NO MVP / NO fallback.
//
// Window surface:
//   * window.__forgeOpenBoundaryBlend(true|false)
//   * window.__forgeCloseBoundaryBlend()
//   * window.__forgeBoundaryBlendHelper                   — math surface
//   * window.__forgeBoundaryBlendLast                     — last result
//
// Headed event: `forge:boundary-blend-built` with the result payload
// mirroring window.__forgeBoundaryBlendLast.
//
// Multi-cam e2e mandate honoured by push-208-boundary-blend.spec.js.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import {
  BOUNDARY_BLEND_EVENT,
  BOUNDARY_BLEND_STORAGE,
  BOUNDARY_BLEND_MIN_SIDES,
  BOUNDARY_BLEND_MAX_SIDES,
  BOUNDARY_BLEND_DEFAULT_N,
  BOUNDARY_BLEND_DEFAULT_GRID,
  BOUNDARY_BLEND_MIN_GRID,
  BOUNDARY_BLEND_MAX_GRID,
  BOUNDARY_BLEND_G1_THRESHOLD_DEG,
  buildNSidedBlend,
  buildTestTriangle,
  buildTestNGon,
  buildCollinearDegenerate,
  validateInputs,
  analyseG1,
  blendPoint,
  meanValueCoords,
  nGonCorners,
  tessellateBlend,
  evalCurve,
  evalCurveTangent,
  angleUnorientedDeg,
} from './boundaryBlendMath.js';

// Re-export so plugins / e2e have a stable import path.
export {
  BOUNDARY_BLEND_EVENT,
  BOUNDARY_BLEND_STORAGE,
  BOUNDARY_BLEND_MIN_SIDES,
  BOUNDARY_BLEND_MAX_SIDES,
  BOUNDARY_BLEND_DEFAULT_N,
  BOUNDARY_BLEND_DEFAULT_GRID,
  BOUNDARY_BLEND_MIN_GRID,
  BOUNDARY_BLEND_MAX_GRID,
  BOUNDARY_BLEND_G1_THRESHOLD_DEG,
};

// ─────────────────────────────────────────────────────────────────────
// Scene group name — single group per panel session so a re-build can
// dispose the previous mesh in one pass without leaking GPU mem.

export const BOUNDARY_BLEND_SCENE_NAME = '__forge_boundary_blend__';

// ─────────────────────────────────────────────────────────────────────
// THREE wiring.

function getActiveScene() {
  if (typeof window === 'undefined') return null;
  return window.__forgeScene || null;
}

function disposeGroup(group) {
  if (!group) return;
  group.traverse((obj) => {
    if (obj.geometry) {
      try { obj.geometry.dispose(); } catch {}
    }
    if (obj.material) {
      const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of mats) { try { m.dispose(); } catch {} }
    }
  });
  if (group.parent) {
    try { group.parent.remove(group); } catch {}
  }
}

// Build a THREE.Mesh from the buildNSidedBlend output. We compute vertex
// normals on the geometry so the patch lights correctly out of the box.
export function buildBlendMesh(result, colorHex = 0x4f87ff) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(result.positions, 3));
  geom.setIndex(new THREE.BufferAttribute(result.indices, 1));
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  geom.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: colorHex,
    metalness: 0.1,
    roughness: 0.55,
    side: THREE.DoubleSide,
    flatShading: false,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = 'boundary-blend-mesh';
  return mesh;
}

// Build a wireframe rendering of the input boundary curves so the panel's
// scene contribution shows the user what curves were used.
export function buildBoundaryCurvesPreview(boundaryCurves) {
  const group = new THREE.Group();
  group.name = 'boundary-blend-curves';
  for (let i = 0; i < boundaryCurves.length; i++) {
    const c = boundaryCurves[i];
    const SAMPLES = 32;
    const pts = new Float32Array(SAMPLES * 3);
    for (let k = 0; k < SAMPLES; k++) {
      const t = k / (SAMPLES - 1);
      const p = evalCurve(c, t);
      pts[k * 3]     = p[0];
      pts[k * 3 + 1] = p[1];
      pts[k * 3 + 2] = p[2];
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xffaa55 });
    const line = new THREE.Line(geom, mat);
    line.name = `boundary-blend-curve-${i}`;
    group.add(line);
  }
  return group;
}

// ─────────────────────────────────────────────────────────────────────
// Install the helper API on window the moment this module is imported.

if (typeof window !== 'undefined') {
  try {
    window.__forgeBoundaryBlendHelper = Object.freeze({
      buildNSidedBlend,
      buildTestTriangle,
      buildTestNGon,
      buildCollinearDegenerate,
      validateInputs,
      analyseG1,
      blendPoint,
      meanValueCoords,
      nGonCorners,
      tessellateBlend,
      evalCurve,
      evalCurveTangent,
      angleUnorientedDeg,
      buildBlendMesh,
      buildBoundaryCurvesPreview,
      EVENT_NAME:    BOUNDARY_BLEND_EVENT,
      STORAGE_KEY:   BOUNDARY_BLEND_STORAGE,
      MIN_SIDES:     BOUNDARY_BLEND_MIN_SIDES,
      MAX_SIDES:     BOUNDARY_BLEND_MAX_SIDES,
      DEFAULT_N:     BOUNDARY_BLEND_DEFAULT_N,
      DEFAULT_GRID:  BOUNDARY_BLEND_DEFAULT_GRID,
      MIN_GRID:      BOUNDARY_BLEND_MIN_GRID,
      MAX_GRID:      BOUNDARY_BLEND_MAX_GRID,
      G1_THRESHOLD_DEG: BOUNDARY_BLEND_G1_THRESHOLD_DEG,
      SCENE_NAME:    BOUNDARY_BLEND_SCENE_NAME,
    });
  } catch { /* fail soft */ }
}

// ─────────────────────────────────────────────────────────────────────
// Styles — same right-docked rail as PUSH-150 / PUSH-200.

const PANEL_W = 480;
const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: PANEL_W,
  zIndex: 1337,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column',
  gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflow: 'auto',
};
const HEADER_ROW = { display: 'flex', alignItems: 'center', gap: 8 };
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const SECTION_TITLE = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)', margin: '8px 0 4px',
};
const SECTION_BOX = {
  background: 'var(--forge-canvas-3, #1b212a)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4, padding: 8,
  display: 'flex', flexDirection: 'column', gap: 6,
};
const PRESET_GRID = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 4,
};
const PRESET_BTN = (active) => ({
  background: active ? 'var(--forge-accent-mute, #1f2c4a)' : 'var(--forge-canvas-1, #0e1218)',
  border: active ? '1px solid var(--forge-accent, #4f87ff)' : '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3,
  color: 'var(--forge-ink, #dadde2)',
  padding: '4px 0', cursor: 'pointer', fontSize: 10,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
});
const SLIDER_ROW = {
  display: 'grid', gridTemplateColumns: '1fr 60px', gap: 8, alignItems: 'center',
};
const NUM_INPUT_STYLE = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '3px 6px', borderRadius: 3, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  textAlign: 'right', width: '100%', boxSizing: 'border-box',
};
const ACTION_BTN = (variant = 'default', disabled = false) => ({
  background: disabled ? 'var(--forge-surface-mute, #1a1f27)'
            : variant === 'primary' ? 'var(--forge-accent, #4f87ff)'
            : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: disabled ? 'var(--forge-ink-mute, #9aa1ab)'
       : variant === 'primary' ? '#fff'
       : 'var(--forge-ink, #dadde2)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  padding: '6px 14px', borderRadius: 3, fontSize: 12,
  fontWeight: variant === 'primary' ? 600 : 400,
});
const CHIP_ROW = { display: 'flex', flexWrap: 'wrap', gap: 6 };
const CHIP = (variant) => ({
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid ' + (variant === 'ok'
    ? 'var(--forge-ok, #4caf50)'
    : variant === 'err' ? 'var(--forge-err, #ef5350)'
    : 'var(--forge-rail-edge, #2a2d34)'),
  borderRadius: 4,
  padding: '4px 8px',
  display: 'flex', flexDirection: 'column',
  gap: 2,
  fontSize: 10,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  color: 'var(--forge-ink, #dadde2)',
  minWidth: 80,
});
const CHIP_LABEL = {
  fontSize: 8,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};
const CURVE_ROW = {
  display: 'grid',
  gridTemplateColumns: '24px 1fr 60px',
  gap: 4,
  alignItems: 'center',
  fontSize: 10,
  padding: '2px 4px',
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const STATUS_PILL = (variant) => ({
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
  color: variant === 'err'  ? 'var(--forge-err, #ef5350)'
       : variant === 'ok'   ? 'var(--forge-ok, #4caf50)'
       :                      'var(--forge-ink-mute, #9aa1ab)',
  padding: '1px 6px',
  borderRadius: 'var(--forge-radius-pill, 10px)',
  border: '1px solid currentColor',
});
const ERR_BOX = {
  color: 'var(--forge-err, #ef5350)',
  background: 'var(--forge-canvas-1, #0e1218)',
  padding: '4px 8px',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
  border: '1px solid var(--forge-err, #ef5350)',
  borderRadius: 3,
};

// ─────────────────────────────────────────────────────────────────────
// Presets — drive the curve-list state from a single named source.

const PRESETS = {
  triangle: () => buildTestTriangle({ size: 100 }),
  square:   () => buildTestNGon({ N: 4, size: 100 }),
  pentagon: () => buildTestNGon({ N: 5, size: 100 }),
  hex:      () => buildTestNGon({ N: 6, size: 100 }),
  hept:     () => buildTestNGon({ N: 7, size: 100 }),
  oct:      () => buildTestNGon({ N: 8, size: 100 }),
  degenerate: () => buildCollinearDegenerate({ N: 3, length: 100 }),
};

// ─────────────────────────────────────────────────────────────────────
// Curve summary line — readable description for the list display.

function describeCurve(c, i) {
  if (!c) return `#${i}: (none)`;
  if (c.type === 'bezier') {
    return `#${i}: Bezier (${c.pts.length} pts)`;
  }
  if (c.type === 'polyline' || Array.isArray(c)) {
    const pts = Array.isArray(c) ? c : c.pts;
    return `#${i}: Polyline (${pts.length} pts)`;
  }
  return `#${i}: (unknown)`;
}

// ─────────────────────────────────────────────────────────────────────
// Panel.

export function BoundaryBlendPanel({ open, onClose }) {
  const [presetName, setPresetName] = useState('triangle');
  const [boundaryCurves, setBoundaryCurves] = useState(
    () => PRESETS.triangle().boundaryCurves);
  const [tangentRibbons, setTangentRibbons] = useState(
    () => PRESETS.triangle().tangentRibbons);
  const [gridU, setGridU] = useState(BOUNDARY_BLEND_DEFAULT_GRID);
  const [gridV, setGridV] = useState(BOUNDARY_BLEND_DEFAULT_GRID);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const sceneGroupRef = useRef(null);

  // Tear down the scene group on unmount or close.
  useEffect(() => {
    return () => {
      if (sceneGroupRef.current) {
        disposeGroup(sceneGroupRef.current);
        sceneGroupRef.current = null;
        if (typeof window !== 'undefined') {
          try { delete window.__forgeBoundaryBlendGroup; } catch {}
        }
      }
    };
  }, []);

  // Reset error / result when the panel closes so re-opening is fresh.
  useEffect(() => {
    if (!open) {
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const onChoosePreset = useCallback((name) => {
    const fn = PRESETS[name];
    if (!fn) return;
    const built = fn();
    setPresetName(name);
    setBoundaryCurves(built.boundaryCurves);
    setTangentRibbons(built.tangentRibbons);
    setError(null);
  }, []);

  const onChangeGrid = useCallback((e) => {
    let v = parseInt(e.target.value, 10);
    if (!Number.isFinite(v)) v = BOUNDARY_BLEND_DEFAULT_GRID;
    if (v < BOUNDARY_BLEND_MIN_GRID) v = BOUNDARY_BLEND_MIN_GRID;
    if (v > BOUNDARY_BLEND_MAX_GRID) v = BOUNDARY_BLEND_MAX_GRID;
    setGridU(v);
    setGridV(v);
  }, []);

  const publishToScene = useCallback((res, curves) => {
    if (typeof window === 'undefined') return;
    const scene = getActiveScene();
    // Remove previous group + dispose old GPU buffers.
    if (sceneGroupRef.current) {
      disposeGroup(sceneGroupRef.current);
      sceneGroupRef.current = null;
    }
    if (!scene) {
      // Renderer not yet up; surface a non-blocking warning, leave the
      // result in window so callers can still verify the math.
      window.__forgeBoundaryBlendGroup = null;
      return;
    }
    const group = new THREE.Group();
    group.name = BOUNDARY_BLEND_SCENE_NAME;
    group.add(buildBlendMesh(res));
    group.add(buildBoundaryCurvesPreview(curves));
    scene.add(group);
    sceneGroupRef.current = group;
    window.__forgeBoundaryBlendGroup = group;
  }, []);

  const onBuild = useCallback(() => {
    setBusy(true);
    setError(null);
    // Yield one frame so the busy state can render.
    setTimeout(() => {
      try {
        const res = buildNSidedBlend({
          boundaryCurves, tangentRibbons,
          gridU, gridV,
        });
        if (!res.ok) {
          setError(res.reason || 'unknown blend failure');
          setResult(null);
          if (typeof window !== 'undefined') {
            try {
              window.__forgeBoundaryBlendLast = { ok: false, reason: res.reason };
              window.dispatchEvent(new CustomEvent(BOUNDARY_BLEND_EVENT, {
                detail: { ok: false, reason: res.reason },
              }));
            } catch {}
          }
          return;
        }
        setResult(res);
        publishToScene(res, boundaryCurves);
        if (typeof window !== 'undefined') {
          // Strip the giant typed arrays into plain summaries for the
          // window mirror so the e2e can assert without serialising
          // a Float32Array through evaluate().
          const summary = {
            ok: true,
            N: res.N,
            gridU: res.gridU, gridV: res.gridV,
            vertexCount: res.vertexCount,
            triangleCount: res.triangleCount,
            bboxDiag: res.bboxDiag,
            eps: res.eps,
            g1: {
              globalMaxDeg: res.g1.globalMaxDeg,
              globalAvgDeg: res.g1.globalAvgDeg,
              pass: res.g1.pass,
              threshold: res.g1.threshold,
              perEdge: res.g1.perEdge.map((e) => ({
                edge:    e.edge,
                samples: e.samples,
                maxDeg:  e.maxDeg,
                avgDeg:  e.avgDeg,
                pass:    e.pass,
              })),
            },
            ts: Date.now(),
          };
          window.__forgeBoundaryBlendLast = summary;
          try {
            window.dispatchEvent(new CustomEvent(BOUNDARY_BLEND_EVENT, {
              detail: summary,
            }));
          } catch {}
        }
      } catch (err) {
        setError(err && err.message ? err.message : String(err));
        setResult(null);
      } finally {
        setBusy(false);
      }
    }, 40);
  }, [boundaryCurves, tangentRibbons, gridU, gridV, publishToScene]);

  // Live preview validation (without building) so the user sees collapse
  // errors immediately.
  const inputValidation = useMemo(() => {
    return validateInputs({ boundaryCurves, tangentRibbons });
  }, [boundaryCurves, tangentRibbons]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <aside role="region"
           aria-label="N-sided Boundary Blend panel"
           data-testid="forge-boundary-blend-panel"
           data-n-sides={boundaryCurves.length}
           data-grid-u={gridU}
           data-grid-v={gridV}
           data-preset={presetName}
           data-input-ok={inputValidation.ok ? '1' : '0'}
           style={PANEL_STYLE}>

      <div style={HEADER_ROW}>
        <strong style={{ flex: 1 }}>
          Boundary Blend · N-sided (Class-A)
        </strong>
        <span data-testid="forge-boundary-blend-status"
              style={STATUS_PILL(
                error ? 'err'
                : result && result.g1 && result.g1.pass ? 'ok'
                : 'mute')}>
          {error ? 'error'
            : busy ? 'busy'
            : result ? (result.g1.pass ? 'G1 pass' : 'G1 warn')
            : 'idle'}
        </span>
        <button type="button"
                onClick={onClose}
                aria-label="Close Boundary Blend panel"
                data-testid="forge-boundary-blend-close"
                style={CLOSE_BTN}>
          ×
        </button>
      </div>

      <div style={SECTION_TITLE}>Preset (1-click N-sided seed)</div>
      <div style={SECTION_BOX}>
        <div style={PRESET_GRID}>
          {[
            { id: 'triangle', label: '3 · Bezier' },
            { id: 'square',   label: '4 · Polyline' },
            { id: 'pentagon', label: '5 · Polyline' },
            { id: 'hex',      label: '6 · Polyline' },
            { id: 'hept',     label: '7 · Polyline' },
            { id: 'oct',      label: '8 · Polyline' },
          ].map((p) => (
            <button key={p.id}
                    type="button"
                    onClick={() => onChoosePreset(p.id)}
                    data-testid={`forge-boundary-blend-preset-${p.id}`}
                    style={PRESET_BTN(presetName === p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <div style={PRESET_GRID}>
          <button type="button"
                  onClick={() => onChoosePreset('degenerate')}
                  data-testid="forge-boundary-blend-preset-degenerate"
                  style={PRESET_BTN(presetName === 'degenerate')}>
            collinear (err)
          </button>
        </div>
      </div>

      <div style={SECTION_TITLE}>
        Curve list ({boundaryCurves.length} of {BOUNDARY_BLEND_MAX_SIDES})
      </div>
      <div style={SECTION_BOX}
           data-testid="forge-boundary-blend-curve-list"
           data-curve-count={boundaryCurves.length}>
        {boundaryCurves.map((c, i) => (
          <div key={i} style={CURVE_ROW}
               data-testid={`forge-boundary-blend-curve-${i}`}
               data-curve-type={(c && c.type) || 'polyline'}>
            <span>{i.toString().padStart(2, '0')}</span>
            <span>{describeCurve(c, i)}</span>
            <span style={{ textAlign: 'right' }}>
              {Array.isArray(c) ? c.length : (c.pts || []).length} pts
            </span>
          </div>
        ))}
        {boundaryCurves.length === 0 && (
          <div style={{
            color: 'var(--forge-ink-mute, #9aa1ab)',
            fontStyle: 'italic',
            fontSize: 10,
          }}>
            no curves — choose a preset above
          </div>
        )}
      </div>

      <div style={SECTION_TITLE}>Grid density</div>
      <div style={SECTION_BOX}>
        <div style={SLIDER_ROW}>
          <input type="range"
                 min={BOUNDARY_BLEND_MIN_GRID}
                 max={BOUNDARY_BLEND_MAX_GRID}
                 step={1}
                 value={gridU}
                 onChange={onChangeGrid}
                 data-testid="forge-boundary-blend-grid-slider" />
          <input type="number"
                 min={BOUNDARY_BLEND_MIN_GRID}
                 max={BOUNDARY_BLEND_MAX_GRID}
                 step={1}
                 value={gridU}
                 onChange={onChangeGrid}
                 data-testid="forge-boundary-blend-grid-input"
                 style={NUM_INPUT_STYLE} />
        </div>
        <div style={{
          fontSize: 9,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
        }}>
          {gridU}×{gridV} per sub-quad · {boundaryCurves.length} edges →
          ≤ {boundaryCurves.length * gridU * gridV * 2} triangles
        </div>
      </div>

      {!inputValidation.ok && (
        <div data-testid="forge-boundary-blend-input-err"
             style={ERR_BOX}>
          input invalid: {inputValidation.reason}
        </div>
      )}

      <div style={SECTION_TITLE}>Action</div>
      <div style={SECTION_BOX}>
        <button type="button"
                onClick={onBuild}
                disabled={busy || !inputValidation.ok}
                data-testid="forge-boundary-blend-build"
                style={ACTION_BTN('primary', busy || !inputValidation.ok)}>
          {busy ? 'Building…' : 'Build · tessellate + commit to scene'}
        </button>
        {error && (
          <div data-testid="forge-boundary-blend-error"
               style={ERR_BOX}>
            build failed: {error}
          </div>
        )}
      </div>

      {result && (
        <>
          <div style={SECTION_TITLE}>Result</div>
          <div style={SECTION_BOX}>
            <div style={CHIP_ROW}>
              <span data-testid="forge-boundary-blend-chip-sides"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>Sides (N)</span>
                <span>{result.N}</span>
              </span>
              <span data-testid="forge-boundary-blend-chip-vertices"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>Vertices</span>
                <span>{result.vertexCount}</span>
              </span>
              <span data-testid="forge-boundary-blend-chip-triangles"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>Triangles</span>
                <span>{result.triangleCount}</span>
              </span>
              <span data-testid="forge-boundary-blend-chip-g1-max"
                    style={CHIP(result.g1.pass ? 'ok' : 'err')}>
                <span style={CHIP_LABEL}>G1 max</span>
                <span>{result.g1.globalMaxDeg.toFixed(3)}°</span>
              </span>
              <span data-testid="forge-boundary-blend-chip-g1-avg"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>G1 avg</span>
                <span>{result.g1.globalAvgDeg.toFixed(3)}°</span>
              </span>
              <span data-testid="forge-boundary-blend-chip-g1-threshold"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>Threshold</span>
                <span>{result.g1.threshold.toFixed(1)}°</span>
              </span>
              <span data-testid="forge-boundary-blend-chip-eps"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>ε</span>
                <span>{result.eps.toFixed(3)} mm</span>
              </span>
              <span data-testid="forge-boundary-blend-chip-bbox"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>bbox diag</span>
                <span>{result.bboxDiag.toFixed(2)} mm</span>
              </span>
            </div>
          </div>

          <div style={SECTION_TITLE}>G1 deviation per edge</div>
          <div style={SECTION_BOX}
               data-testid="forge-boundary-blend-g1-edge-list">
            {result.g1.perEdge.map((e) => (
              <div key={e.edge} style={{
                ...CURVE_ROW,
                gridTemplateColumns: '24px 1fr 60px 60px',
              }}
                   data-testid={`forge-boundary-blend-g1-edge-${e.edge}`}
                   data-pass={e.pass ? '1' : '0'}>
                <span>{e.edge.toString().padStart(2, '0')}</span>
                <span>{e.pass ? 'pass' : 'warn'} · {e.samples} samples</span>
                <span style={{ textAlign: 'right' }}>
                  max {e.maxDeg.toFixed(2)}°
                </span>
                <span style={{
                  textAlign: 'right',
                  color: e.pass ? 'var(--forge-ok, #4caf50)'
                               : 'var(--forge-err, #ef5350)',
                }}>
                  avg {e.avgDeg.toFixed(2)}°
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={{
        marginTop: 'auto',
        fontSize: 10,
        fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
        color: 'var(--forge-ink-mute, #9aa1ab)',
        lineHeight: 1.5,
      }}>
        Mean Value Coordinates (Floater 2003) · Coons-style ribbon blend ·
        G1 measured patch-normal vs ribbon-tangent · 3-8 sides.
      </div>

    </aside>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host.

export function BoundaryBlendPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenBoundaryBlend = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseBoundaryBlend = () => setOpen(false);

    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.boundaryBlend') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenBoundaryBlend; } catch {}
      try { delete window.__forgeCloseBoundaryBlend; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  return <BoundaryBlendPanel open={open} onClose={() => setOpen(false)} />;
}

export default BoundaryBlendPanelHost;
