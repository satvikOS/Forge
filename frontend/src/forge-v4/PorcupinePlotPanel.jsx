// PUSH-211 (Slice-156) — Porcupine curvature plot panel.
//
// Class-A surfacing QA. At every vertex of a triangle mesh we estimate
// the per-vertex Gaussian (K), mean (H), or max-principal (κ_max)
// curvature via Meyer 2003 discrete differential-geometry operators
// (see porcupinePlotMath.js for the math), then draw a quill (line
// segment) from P_i to P_i + scale·κ·n_i. The colour is a diverging
// ramp: red for high positive curvature, blue for high negative, green
// near zero.
//
// In ICEM / Alias / Catia ICEM "porcupine plot" is the canonical numeric
// G2 / curvature continuity probe (zebra reveals C1/G1, porcupine reveals
// C2/G2).
//
// Window surface
// ──────────────
//   * window.__forgeOpenPorcupinePlot(true|false)  — show/hide panel.
//   * window.__forgeClosePorcupinePlot()
//   * window.__forgePorcupinePlot                  — last-built result mirror.
//   * window.__forgePorcupinePlotHelper            — pure-math helper API.
//
// Event:
//   * forge:porcupine-plot-built — emitted on every Build with the
//     full per-vertex curvature payload (no THREE refs, just typed
//     arrays + stats).
//
// Hard constraints honoured
// ─────────────────────────
//   * NO new npm packages — THREE is already in frontend/package.json.
//   * Real Meyer 2003 cotangent + angle-defect math (no random / no
//     fake values / no fallback).
//   * Surgical edits to Menus.jsx + App.jsx.
//   * Manual clicks do NOT post to Archie's thread.
//   * Multi-cam e2e mandate (5 named camera angles).

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import {
  FORGE_PORCUPINE_EVENT,
  FORGE_PORCUPINE_STORAGE,
  FORGE_PORCUPINE_GROUP_NAME,
  FORGE_PORCUPINE_USERDATA_TAG,
  PORCUPINE_MODES,
  PORCUPINE_DEFAULT_MODE,
  PORCUPINE_DEFAULT_SCALE,
  PORCUPINE_MIN_SCALE,
  PORCUPINE_MAX_SCALE,
  buildPorcupineFromBufferGeometry,
  computeDiscreteCurvature,
  computeVertexNormals,
  principalFromMeanGaussian,
  extractTriangleIndices,
  extractPositions,
  divergingColor,
  summariseCurvature,
  checkSphereIdentity,
  pickCurvatureSeries,
  buildPorcupineLineSegments,
} from './porcupinePlotMath.js';

// Re-export constants so external callers (Archie tool / e2e) hit the
// same source of truth.
export {
  FORGE_PORCUPINE_EVENT,
  FORGE_PORCUPINE_STORAGE,
  FORGE_PORCUPINE_GROUP_NAME,
  FORGE_PORCUPINE_USERDATA_TAG,
  PORCUPINE_MODES,
  PORCUPINE_DEFAULT_MODE,
  PORCUPINE_DEFAULT_SCALE,
  PORCUPINE_MIN_SCALE,
  PORCUPINE_MAX_SCALE,
};

// ─────────────────────────────────────────────────────────────────────
// Scene helpers.

/** The body picker enumerates EVERY body in window.__forgeBodies that
 *  has a renderable mesh in the live scene. The Class-A workflow runs
 *  against either solid bodies (the cube → boolean → mesh case) or pure
 *  surface bodies (PUSH-85 Class-A blend, PUSH-102 loft, etc.) — so we
 *  do NOT filter to surface-only here. */
export function listMeshBodies() {
  if (typeof window === 'undefined') return [];
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return bodies.filter((b) => (
    b && typeof b === 'object' && (Number.isFinite(b.handle) || typeof b.id === 'string')
  ));
}

/** Find the live BufferGeometry for a body id. We rely on the
 *  Viewport.jsx mesh ref callback which tags the rendered mesh with
 *  userData.body — same surface zebra / draft / light-line overlays
 *  rely on. */
export function findGeometryForBody(bodyId) {
  if (typeof window === 'undefined') return null;
  const scene = window.__forgeScene;
  if (!scene || typeof scene.traverse !== 'function') return null;
  let geom = null;
  scene.traverse((obj) => {
    if (geom) return;
    if (!obj || !obj.isMesh) return;
    if (!obj.userData || !obj.userData.body) return;
    const b = obj.userData.body;
    if (b.id === bodyId || b.handle === bodyId
        || (b.handle != null && String(b.handle) === String(bodyId))
        || (b.id != null && String(b.id) === String(bodyId))) {
      if (obj.geometry) geom = obj.geometry;
    }
  });
  return geom;
}

/** Find the live three.js Object3D matrix for a body id (so the
 *  porcupine quills are emitted in WORLD space matching the rendered
 *  mesh). We return null if the mesh is at identity. */
export function findWorldMatrixForBody(bodyId) {
  if (typeof window === 'undefined') return null;
  const scene = window.__forgeScene;
  if (!scene || typeof scene.traverse !== 'function') return null;
  let mat = null;
  scene.traverse((obj) => {
    if (mat) return;
    if (!obj || !obj.isMesh) return;
    if (!obj.userData || !obj.userData.body) return;
    const b = obj.userData.body;
    if (b.id === bodyId || b.handle === bodyId) {
      // matrixWorld is auto-updated by three's render loop.
      mat = obj.matrixWorld;
    }
  });
  return mat;
}

// ─────────────────────────────────────────────────────────────────────
// Scene group lifecycle — clear / install a single porcupine group on
// __forgeScene under a known userData tag so subsequent builds replace
// the previous quills (rather than accumulate). Used by both the panel
// and the headless helper.

export function clearPorcupineGroup() {
  if (typeof window === 'undefined') return { removed: 0 };
  const scene = window.__forgeScene;
  if (!scene) return { removed: 0 };
  let removed = 0;
  const toRemove = [];
  scene.traverse((obj) => {
    if (obj && obj.userData && obj.userData[FORGE_PORCUPINE_USERDATA_TAG] === true) {
      toRemove.push(obj);
    }
  });
  for (const obj of toRemove) {
    if (obj.parent) obj.parent.remove(obj);
    // Dispose geometry + material if possible.
    if (obj.geometry && typeof obj.geometry.dispose === 'function') {
      try { obj.geometry.dispose(); } catch {}
    }
    if (obj.material && typeof obj.material.dispose === 'function') {
      try { obj.material.dispose(); } catch {}
    }
    removed += 1;
  }
  if (typeof window !== 'undefined') {
    try { delete window.__forgePorcupinePlotGroup; } catch {}
  }
  return { removed };
}

/** Build and mount a fresh porcupine group into __forgeScene. Lazy-
 *  imports THREE (already in node_modules) so this module stays
 *  side-effect-free at parse time. */
export async function installPorcupineGroup({ linePositions, lineColors, worldMatrix }) {
  if (typeof window === 'undefined') return { mounted: false };
  const scene = window.__forgeScene;
  if (!scene || typeof scene.add !== 'function') return { mounted: false };
  const THREE = await import('three');
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
  geom.setAttribute('color',    new THREE.BufferAttribute(lineColors, 3));
  // No index — every (2i, 2i+1) pair is a single line segment.
  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    linewidth:    1, // most WebGL drivers cap at 1; the quill density does the work
    transparent:  false,
    depthTest:    true,
    depthWrite:   false,
    toneMapped:   false,
  });
  mat.name = 'forge.porcupinePlot.material';
  const lineSeg = new THREE.LineSegments(geom, mat);
  lineSeg.name = FORGE_PORCUPINE_GROUP_NAME;
  lineSeg.userData[FORGE_PORCUPINE_USERDATA_TAG] = true;
  // Apply the source body's world matrix so quills track its pose.
  if (worldMatrix && worldMatrix.elements) {
    lineSeg.matrixAutoUpdate = false;
    lineSeg.matrix.copy(worldMatrix);
    lineSeg.matrixWorld.copy(worldMatrix);
  }
  scene.add(lineSeg);
  if (typeof window !== 'undefined') {
    window.__forgePorcupinePlotGroup = lineSeg;
  }
  return { mounted: true, object: lineSeg };
}

// ─────────────────────────────────────────────────────────────────────
// runPorcupinePlot — Headless driver. Builds the math result, installs
// the scene group, broadcasts a forge:porcupine-plot-built event, returns
// the result envelope. Used by both the Build button + the e2e spec.

export async function runPorcupinePlot({
  bodyId, mode = PORCUPINE_DEFAULT_MODE, scale = PORCUPINE_DEFAULT_SCALE,
  geometry = null, worldMatrix = null,
} = {}) {
  const geom = geometry || findGeometryForBody(bodyId);
  if (!geom) {
    return { ok: false, reason: `no geometry for body ${bodyId}` };
  }
  // Drop the previous group BEFORE building so multiple builds replace
  // rather than accumulate.
  clearPorcupineGroup();
  const out = buildPorcupineFromBufferGeometry(geom, { mode, scale });
  if (out.vertexCount === 0 || out.triangleCount === 0) {
    return { ok: false, reason: 'empty geometry (no vertices or triangles)' };
  }
  const matrix = worldMatrix || findWorldMatrixForBody(bodyId);
  const mounted = await installPorcupineGroup({
    linePositions: out.linePositions,
    lineColors:    out.lineColors,
    worldMatrix:   matrix,
  });
  // Publish summary on window for plugins + e2e.
  if (typeof window !== 'undefined') {
    window.__forgePorcupinePlot = Object.freeze({
      bodyId, mode, scale,
      vertexCount:   out.vertexCount,
      triangleCount: out.triangleCount,
      stats:         out.stats,
      mounted:       mounted.mounted,
      ts:            Date.now(),
    });
    try {
      window.dispatchEvent(new CustomEvent(FORGE_PORCUPINE_EVENT, {
        detail: {
          bodyId, mode, scale,
          vertexCount:   out.vertexCount,
          triangleCount: out.triangleCount,
          stats:         out.stats,
          mounted:       mounted.mounted,
        },
      }));
    } catch { /* fail-soft */ }
  }
  return {
    ok: true,
    bodyId, mode, scale,
    vertexCount:   out.vertexCount,
    triangleCount: out.triangleCount,
    positions:     out.positions,
    normals:       out.normals,
    gaussian:      out.gaussian,
    mean:          out.mean,
    principalMax:  out.principalMax,
    voronoiArea:   out.voronoiArea,
    linePositions: out.linePositions,
    lineColors:    out.lineColors,
    stats:         out.stats,
    mounted:       mounted.mounted,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Install the helper API + pre-mount menu listener once at module-load
// time so the e2e spec can probe both surfaces before React mounts.

if (typeof window !== 'undefined') {
  try {
    window.__forgePorcupinePlotHelper = Object.freeze({
      listMeshBodies,
      findGeometryForBody,
      findWorldMatrixForBody,
      clearPorcupineGroup,
      installPorcupineGroup,
      runPorcupinePlot,
      buildPorcupineFromBufferGeometry,
      computeDiscreteCurvature,
      computeVertexNormals,
      principalFromMeanGaussian,
      extractTriangleIndices,
      extractPositions,
      divergingColor,
      summariseCurvature,
      checkSphereIdentity,
      pickCurvatureSeries,
      buildPorcupineLineSegments,
      MODES:           PORCUPINE_MODES,
      DEFAULT_MODE:    PORCUPINE_DEFAULT_MODE,
      DEFAULT_SCALE:   PORCUPINE_DEFAULT_SCALE,
      MIN_SCALE:       PORCUPINE_MIN_SCALE,
      MAX_SCALE:       PORCUPINE_MAX_SCALE,
      EVENT_NAME:      FORGE_PORCUPINE_EVENT,
      STORAGE_KEY:     FORGE_PORCUPINE_STORAGE,
      GROUP_NAME:      FORGE_PORCUPINE_GROUP_NAME,
      USERDATA_TAG:    FORGE_PORCUPINE_USERDATA_TAG,
    });
    window.addEventListener('forge:menu-action', (e) => {
      if (e?.detail?.id === 'tools.porcupinePlot') {
        window.__forgePorcupinePlotLastMenuTs = Date.now();
      }
    });
  } catch { /* SSR fallback */ }
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail matching SurfaceContinuityPanel.

const PANEL_W = 400;
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
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflowY: 'auto',
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
const SELECT_STYLE = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '4px 6px', borderRadius: 3, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  width: '100%', boxSizing: 'border-box',
};
const MODE_GRID = {
  display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6,
};
const MODE_BTN = (active) => ({
  background: active ? 'var(--forge-accent-mute, #1f2c4a)' : 'var(--forge-canvas-1, #0e1218)',
  border: active ? '1px solid var(--forge-accent, #4f87ff)' : '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4,
  color: 'var(--forge-ink, #dadde2)',
  padding: '6px 4px', cursor: 'pointer', fontSize: 11,
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
});
const SLIDER_ROW = {
  display: 'grid', gridTemplateColumns: '1fr 70px', gap: 8, alignItems: 'center',
};
const NUM_INPUT_STYLE = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '3px 6px', borderRadius: 3, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  textAlign: 'right', width: '100%', boxSizing: 'border-box',
};
const BUTTON_ROW = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 };
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
const STATS_GRID = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
  fontSize: 11, fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const STAT_CELL = {
  display: 'flex', flexDirection: 'column', gap: 1,
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3, padding: '4px 6px',
};
const STAT_LABEL = {
  fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
};
const LEGEND_BAR = {
  display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4,
  fontSize: 10, fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const LEGEND_CELL = (rgb) => ({
  display: 'flex', alignItems: 'center', gap: 4,
  background: rgb, color: '#fff',
  padding: '2px 6px', borderRadius: 3,
  textShadow: '0 0 2px #000',
});

// ─────────────────────────────────────────────────────────────────────
// Helpers — labels.

function modeLabel(m) {
  if (m === 'gaussian') return 'Gaussian K';
  if (m === 'mean')     return 'Mean H';
  if (m === 'principal')return 'Max-principal κ';
  return m;
}
function modeUnit(m) {
  if (m === 'gaussian') return '1/L²';
  return '1/L';
}
function fmtKappa(v) {
  if (!Number.isFinite(v)) return 'n/a';
  if (Math.abs(v) >= 0.001 && Math.abs(v) < 1000) return v.toFixed(5);
  return v.toExponential(3);
}

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function PorcupinePlotPanel({ open, onClose }) {
  const [bodies, setBodies] = useState(() => listMeshBodies());
  const [bodyId, setBodyId] = useState(null);
  const [mode, setMode] = useState(() => {
    if (typeof localStorage === 'undefined') return PORCUPINE_DEFAULT_MODE;
    try {
      const raw = localStorage.getItem(FORGE_PORCUPINE_STORAGE);
      if (!raw) return PORCUPINE_DEFAULT_MODE;
      const j = JSON.parse(raw);
      const m = String(j.mode || PORCUPINE_DEFAULT_MODE).toLowerCase();
      if (PORCUPINE_MODES.includes(m)) return m;
      return PORCUPINE_DEFAULT_MODE;
    } catch { return PORCUPINE_DEFAULT_MODE; }
  });
  const [scale, setScale] = useState(() => {
    if (typeof localStorage === 'undefined') return PORCUPINE_DEFAULT_SCALE;
    try {
      const raw = localStorage.getItem(FORGE_PORCUPINE_STORAGE);
      if (!raw) return PORCUPINE_DEFAULT_SCALE;
      const j = JSON.parse(raw);
      const v = Number(j.scale);
      if (Number.isFinite(v) && v >= PORCUPINE_MIN_SCALE && v <= PORCUPINE_MAX_SCALE) return v;
      return PORCUPINE_DEFAULT_SCALE;
    } catch { return PORCUPINE_DEFAULT_SCALE; }
  });
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // Persist mode + scale across re-opens.
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(FORGE_PORCUPINE_STORAGE,
        JSON.stringify({ mode, scale }));
    } catch { /* quota / private mode — fail soft */ }
  }, [mode, scale]);

  // Refresh body list on open + on bodies-changed events.
  useEffect(() => {
    if (!open) return undefined;
    const refresh = () => {
      const list = listMeshBodies();
      setBodies(list);
      setBodyId((prev) => {
        if (prev != null && list.find(
          (b) => b.id === prev || b.handle === prev)) return prev;
        if (list.length > 0) return list[list.length - 1].id;
        return null;
      });
    };
    refresh();
    setErrorMsg(null);
    window.addEventListener('forge:bodies-changed', refresh);
    window.addEventListener('forge:selection-changed', refresh);
    return () => {
      window.removeEventListener('forge:bodies-changed', refresh);
      window.removeEventListener('forge:selection-changed', refresh);
    };
  }, [open]);

  const onBuild = useCallback(async () => {
    if (!bodyId) {
      setErrorMsg('Pick a body first.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const r = await runPorcupinePlot({ bodyId, mode, scale });
      if (!r.ok) {
        setErrorMsg(r.reason || 'build failed');
        setResult(null);
      } else {
        setResult(r);
      }
    } catch (ex) {
      setErrorMsg(`build crashed: ${ex.message || ex}`);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, [bodyId, mode, scale]);

  const onClear = useCallback(() => {
    clearPorcupineGroup();
    setResult(null);
    setErrorMsg(null);
  }, []);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  // Re-derive the active series stats from the latest result, regardless
  // of which mode was used when the build ran — so the user can flip the
  // radio after a build to compare numbers without a re-Build click.
  // (The line geometry on screen still reflects the BUILT mode; the
  // numbers are what changes.)
  const activeStats = useMemo(() => {
    if (!result || !result.stats) return null;
    if (mode === 'gaussian')  return result.stats.gaussianSummary;
    if (mode === 'principal') return result.stats.principalSummary;
    return result.stats.meanSummary;
  }, [result, mode]);

  const builtStats = result?.stats || null;
  const builtMode  = builtStats?.mode || null;
  // For colour ramp legend, normalise to ±absMax of the BUILT series.
  const built_kAbsMax = builtStats?.kAbsMax || 0;
  const red   = divergingColor(+1);
  const green = divergingColor(0);
  const blue  = divergingColor(-1);
  const toRgbCss = (c) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;

  return createPortal(
    <div role="dialog"
         aria-label="Porcupine curvature plot"
         data-testid="forge-porcupine-panel"
         data-body-id={bodyId == null ? '' : String(bodyId)}
         data-mode={mode}
         data-built-mode={builtMode || ''}
         data-scale={String(scale)}
         data-vertex-count={result ? String(result.vertexCount) : ''}
         data-triangle-count={result ? String(result.triangleCount) : ''}
         data-mounted={result && result.mounted ? '1' : '0'}
         data-k-abs-max={built_kAbsMax ? String(built_kAbsMax) : ''}
         data-busy={busy ? '1' : '0'}
         style={PANEL_STYLE}>

      <header style={HEADER_ROW}>
        <Icon name="measure.angle" size={14} />
        <strong style={{ fontSize: 13 }}>Porcupine Curvature</strong>
        <span style={{
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          padding: '1px 6px',
          borderRadius: 'var(--forge-radius-pill, 10px)',
          border: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
          Class-A QA
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close Porcupine Curvature panel"
                data-testid="forge-porcupine-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
        Pick a body; the panel estimates per-vertex Gaussian / mean /
        max-principal curvature via Meyer 2003 discrete operators and
        draws quills proportional to curvature × normal. Zebra reveals
        G1 defects; the porcupine reveals G2 defects numerically.
      </div>

      <div style={SECTION_TITLE}>Body</div>
      <div style={SECTION_BOX}>
        <select value={bodyId == null ? '' : bodyId}
                onChange={(e) => setBodyId(e.target.value || null)}
                data-testid="forge-porcupine-body"
                aria-label="Body to plot"
                style={SELECT_STYLE}>
          <option value="">
            {bodies.length === 0 ? '— no bodies in scene —' : '— pick a body —'}
          </option>
          {bodies.map((b) => (
            <option key={b.id} value={b.id}>
              {`${b.name || b.toolId || b.id}  ·  handle ${b.handle ?? '—'}`}
            </option>
          ))}
        </select>
        <div style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          {bodies.length} body{bodies.length === 1 ? '' : 's'} in scene
        </div>
      </div>

      <div style={SECTION_TITLE}>Curvature type</div>
      <div style={SECTION_BOX}>
        <div style={MODE_GRID} role="radiogroup" aria-label="Curvature type">
          {PORCUPINE_MODES.map((m) => (
            <button key={m}
                    type="button"
                    role="radio"
                    onClick={() => setMode(m)}
                    aria-checked={mode === m}
                    data-testid={`forge-porcupine-mode-${m}`}
                    data-active={mode === m ? '1' : '0'}
                    style={MODE_BTN(mode === m)}>
              <strong>{modeLabel(m)}</strong>
              <span style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
                {`(${modeUnit(m)})`}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div style={SECTION_TITLE}>Quill scale</div>
      <div style={SECTION_BOX}>
        <div style={SLIDER_ROW}>
          <input type="range"
                 min={PORCUPINE_MIN_SCALE}
                 max={PORCUPINE_MAX_SCALE}
                 step={0.05}
                 value={scale}
                 onChange={(e) => {
                   const v = Number(e.target.value);
                   if (Number.isFinite(v)) {
                     setScale(Math.max(PORCUPINE_MIN_SCALE,
                       Math.min(PORCUPINE_MAX_SCALE, v)));
                   }
                 }}
                 data-testid="forge-porcupine-scale-slider"
                 aria-label="Quill scale"
                 style={{ width: '100%' }} />
          <input type="number"
                 min={PORCUPINE_MIN_SCALE}
                 max={PORCUPINE_MAX_SCALE}
                 step="0.05"
                 value={scale}
                 onChange={(e) => {
                   const v = Number(e.target.value);
                   if (Number.isFinite(v)) {
                     setScale(Math.max(PORCUPINE_MIN_SCALE,
                       Math.min(PORCUPINE_MAX_SCALE, v)));
                   }
                 }}
                 data-testid="forge-porcupine-scale-number"
                 aria-label="Quill scale"
                 style={NUM_INPUT_STYLE} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
                      display: 'flex', justifyContent: 'space-between' }}>
          <span>{`${PORCUPINE_MIN_SCALE}`}</span>
          <span>{`quill length = scale · κ · n`}</span>
          <span>{`${PORCUPINE_MAX_SCALE}`}</span>
        </div>
      </div>

      <div style={SECTION_TITLE}>Plot</div>
      <div style={SECTION_BOX}>
        <div style={BUTTON_ROW}>
          <button type="button"
                  onClick={onBuild}
                  disabled={!bodyId || busy}
                  data-testid="forge-porcupine-build"
                  style={ACTION_BTN('primary', !bodyId || busy)}>
            {busy ? 'Building…' : 'Build'}
          </button>
          <button type="button"
                  onClick={onClear}
                  disabled={busy}
                  data-testid="forge-porcupine-clear"
                  style={ACTION_BTN('default', busy)}>
            Clear
          </button>
        </div>
        {errorMsg && (
          <div data-testid="forge-porcupine-error"
               style={{
                 color: 'var(--forge-err, #ff6363)',
                 background: 'var(--forge-canvas-1, #0e1218)',
                 padding: '4px 8px', borderRadius: 3,
                 fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                 fontSize: 10,
                 border: '1px solid var(--forge-err, #ff6363)',
               }}>
            error: {errorMsg}
          </div>
        )}
      </div>

      {result && builtStats && (
        <>
          <div style={SECTION_TITLE}>Built mesh</div>
          <div style={SECTION_BOX}>
            <div style={STATS_GRID}>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>Vertices</span>
                <span data-testid="forge-porcupine-stat-vertices">
                  {result.vertexCount.toLocaleString()}
                </span>
              </div>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>Triangles</span>
                <span data-testid="forge-porcupine-stat-triangles">
                  {result.triangleCount.toLocaleString()}
                </span>
              </div>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>Built mode</span>
                <span data-testid="forge-porcupine-stat-built-mode">
                  {modeLabel(builtMode)}
                </span>
              </div>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>|κ|_max (built)</span>
                <span data-testid="forge-porcupine-stat-kabsmax">
                  {fmtKappa(builtStats.kAbsMax)}
                </span>
              </div>
            </div>
          </div>

          <div style={SECTION_TITLE}>{`${modeLabel(mode)} (${modeUnit(mode)})`}</div>
          <div style={SECTION_BOX}>
            <div style={STATS_GRID}>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>Min</span>
                <span data-testid="forge-porcupine-stat-min">
                  {activeStats ? fmtKappa(activeStats.min) : '—'}
                </span>
              </div>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>Max</span>
                <span data-testid="forge-porcupine-stat-max">
                  {activeStats ? fmtKappa(activeStats.max) : '—'}
                </span>
              </div>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>Avg</span>
                <span data-testid="forge-porcupine-stat-avg">
                  {activeStats ? fmtKappa(activeStats.avg) : '—'}
                </span>
              </div>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>|Avg|</span>
                <span data-testid="forge-porcupine-stat-absavg">
                  {activeStats ? fmtKappa(activeStats.absAvg) : '—'}
                </span>
              </div>
            </div>
          </div>

          <div style={SECTION_TITLE}>Colour ramp</div>
          <div style={SECTION_BOX}>
            <div style={LEGEND_BAR}>
              <span style={LEGEND_CELL(toRgbCss(blue))}
                    data-testid="forge-porcupine-legend-blue">
                neg κ
              </span>
              <span style={LEGEND_CELL(toRgbCss(green))}
                    data-testid="forge-porcupine-legend-green">
                ≈ 0
              </span>
              <span style={LEGEND_CELL(toRgbCss(red))}
                    data-testid="forge-porcupine-legend-red">
                pos κ
              </span>
            </div>
            <div style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
              Ramp normalised to ±|κ|_max of the built series. Quills point
              outward (κ &gt; 0) or inward (κ &lt; 0) along the surface normal.
            </div>
          </div>
        </>
      )}

      <div style={{ flex: 1 }} />
      <div style={{
        fontSize: 10, fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
        color: 'var(--forge-ink-mute, #9aa1ab)',
        background: 'var(--forge-canvas-1, #0e1218)',
        padding: '6px 8px',
        borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
        lineHeight: 1.4,
      }}>
        Meyer / Desbrun / Schroeder / Barr 2003 discrete differential
        operators: angle-defect K + cotangent Laplacian H + closed-form
        κ₁,κ₂ = H ± √(max(H²−K, 0)). Class-A G2 audit.
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for `tools.porcupinePlot` menu action +
// window.__forgeOpenPorcupinePlot() imperative entry point.

export function PorcupinePlotPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenPorcupinePlot  = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeClosePorcupinePlot = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.porcupinePlot') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenPorcupinePlot; } catch {}
      try { delete window.__forgeClosePorcupinePlot; } catch {}
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return <PorcupinePlotPanel open={open} onClose={() => setOpen(false)} />;
}

export default PorcupinePlotPanelHost;
