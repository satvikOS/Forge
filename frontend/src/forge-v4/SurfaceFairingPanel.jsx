// PUSH-210 (Slice-164) — Surface Fairing panel (Class-A smoothing).
//
// Self-mounting right-rail panel that drives the Pinkall & Polthier 1993
// cotangent-Laplacian fairing math against any live body in the scene.
// Two modes:
//
//   * "Smooth" — Taubin λ/μ alternating Laplacian. Fast, volume-preserving,
//                no boundary-pin requirement. Defaults λ = 0.6, μ = −0.63.
//
//   * "Fair"   — Bi-Laplacian (L^T L + ε I) X_new = ε X_old, solved per
//                coordinate via conjugate gradient with boundary vertices
//                pinned. True Class-A bending-energy minimisation.
//
// Window surface:
//   window.__forgeOpenSurfaceFairing(true|false)
//   window.__forgeCloseSurfaceFairing()
//   window.__forgeSurfaceFairingHelper        — full math + drive surface
//   window.__forgeSurfaceFairingLast          — last result envelope
//   window.__forgeSurfaceFairingGroup         — last preview mesh group
//
// Menu wiring: `tools.surfaceFairing` opens the panel.
// Event broadcast: `forge:surface-fairing-built` with the result envelope.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';

import {
  FAIRING_MODES,
  FAIRING_DEFAULT_MODE,
  FAIRING_DEFAULT_ITERATIONS,
  FAIRING_MIN_ITERATIONS,
  FAIRING_MAX_ITERATIONS,
  FAIRING_DEFAULT_LAMBDA,
  FAIRING_DEFAULT_MU,
  FAIRING_MIN_LAMBDA,
  FAIRING_MAX_LAMBDA,
  FAIRING_MIN_MU,
  FAIRING_MAX_MU,
  FAIRING_DEFAULT_EPSILON,
  FAIRING_MIN_EPSILON,
  FAIRING_MAX_EPSILON,
  FAIRING_CG_MAX_ITERATIONS,
  FAIRING_CG_TOL,
  FORGE_FAIRING_EVENT,
  FORGE_FAIRING_STORAGE,
  FORGE_FAIRING_GROUP_NAME,
  FORGE_FAIRING_USERDATA_TAG,
  assembleCotangentLaplacian,
  assembleSymmetricCotangentLaplacian,
  applyLaplacian,
  detectBoundaryVertices,
  taubinSmoothStep,
  runTaubin,
  runBiLaplace,
  conjugateGradient,
  bendingEnergy,
  maxDisplacement,
  validateInputs,
  runFairing,
  extractPositions,
  extractTriangleIndices,
  makeTestSphere,
  makeTestSphereWithHole,
  makeBufferGeometryLike,
} from './surfaceFairingMath.js';

// ─────────────────────────────────────────────────────────────────────
// Scene helpers — mirror the porcupine / reflection / boundary patterns
// so the body picker behaviour is consistent across panels.

export function listMeshBodies() {
  if (typeof window === 'undefined') return [];
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return bodies.filter((b) => (
    b && typeof b === 'object' && (Number.isFinite(b.handle) || typeof b.id === 'string')
  ));
}

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
      mat = obj.matrixWorld;
    }
  });
  return mat;
}

// ─────────────────────────────────────────────────────────────────────
// Scene group lifecycle — clear / install a single fairing preview group.

export function clearFairingGroup() {
  if (typeof window === 'undefined') return { removed: 0 };
  const scene = window.__forgeScene;
  if (!scene) return { removed: 0 };
  let removed = 0;
  const toRemove = [];
  scene.traverse((obj) => {
    if (obj && obj.userData && obj.userData[FORGE_FAIRING_USERDATA_TAG] === true) {
      toRemove.push(obj);
    }
  });
  for (const obj of toRemove) {
    if (obj.parent) obj.parent.remove(obj);
    if (obj.geometry && typeof obj.geometry.dispose === 'function') {
      try { obj.geometry.dispose(); } catch {}
    }
    if (obj.material && typeof obj.material.dispose === 'function') {
      try { obj.material.dispose(); } catch {}
    }
    removed += 1;
  }
  try { delete window.__forgeSurfaceFairingGroup; } catch {}
  return { removed };
}

export async function installFairingGroup({
  positions, indices, worldMatrix,
}) {
  if (typeof window === 'undefined') return { mounted: false };
  const scene = window.__forgeScene;
  if (!scene || typeof scene.add !== 'function') return { mounted: false };
  const THREE = await import('three');
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  if (indices && indices.length > 0) {
    geom.setIndex(new THREE.BufferAttribute(indices, 1));
  }
  geom.computeBoundingBox();
  geom.computeBoundingSphere();
  geom.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({
    color: 0x4f87ff,
    metalness: 0.1,
    roughness: 0.45,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.85,
    flatShading: false,
  });
  mat.name = 'forge.surfaceFairing.material';
  const mesh = new THREE.Mesh(geom, mat);
  mesh.name = FORGE_FAIRING_GROUP_NAME;
  mesh.userData[FORGE_FAIRING_USERDATA_TAG] = true;
  if (worldMatrix && worldMatrix.elements) {
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(worldMatrix);
    mesh.matrixWorld.copy(worldMatrix);
  }
  scene.add(mesh);
  window.__forgeSurfaceFairingGroup = mesh;
  return { mounted: true, object: mesh };
}

// ─────────────────────────────────────────────────────────────────────
// runSurfaceFairing — Top-level headless driver.

export async function runSurfaceFairing({
  bodyId = null,
  geometry = null,
  worldMatrix = null,
  mode = FAIRING_DEFAULT_MODE,
  iterations = FAIRING_DEFAULT_ITERATIONS,
  lambda = FAIRING_DEFAULT_LAMBDA,
  mu = FAIRING_DEFAULT_MU,
  epsilon = FAIRING_DEFAULT_EPSILON,
  cgIterations = FAIRING_CG_MAX_ITERATIONS,
  cgTol = FAIRING_CG_TOL,
  fixedExtra = null,
  installPreview = true,
} = {}) {
  const geom = geometry || (bodyId != null ? findGeometryForBody(bodyId) : null);
  if (!geom) {
    return { ok: false, reason: `no geometry for body ${bodyId}` };
  }
  const out = runFairing(geom, {
    mode, iterations, lambda, mu, epsilon, cgIterations, cgTol, fixedExtra,
  });
  if (!out.ok) return out;
  // Reuse the SOURCE geometry's indices to render the result mesh.
  const indices = extractTriangleIndices(geom);
  clearFairingGroup();
  let mounted = { mounted: false };
  if (installPreview) {
    const matrix = worldMatrix || (bodyId != null
      ? findWorldMatrixForBody(bodyId) : null);
    mounted = await installFairingGroup({
      positions: out.positions,
      indices,
      worldMatrix: matrix,
    });
  }
  const summary = {
    ok: true,
    bodyId,
    mode: out.mode,
    iterations: out.iterations,
    params: out.params,
    preEnergy: out.preEnergy,
    postEnergy: out.postEnergy,
    energyReduction: out.energyReduction,
    energyReductionPct: out.energyReductionPct,
    maxDisplacement: out.maxDisplacement,
    maxFreeDisplacement: out.maxFreeDisplacement,
    maxBoundaryDisplacement: out.maxBoundaryDisplacement,
    boundaryPreservationPct: out.boundaryPreservationPct,
    boundaryCount: out.boundaryCount,
    interiorCount: out.interiorCount,
    vertexCount: out.vertexCount,
    triangleCount: out.triangleCount,
    averageEdgeLength: out.averageEdgeLength,
    mounted: mounted.mounted,
    ts: Date.now(),
  };
  if (typeof window !== 'undefined') {
    window.__forgeSurfaceFairingLast = Object.freeze(summary);
    try {
      window.dispatchEvent(new CustomEvent(FORGE_FAIRING_EVENT, {
        detail: summary,
      }));
    } catch {}
  }
  return {
    ...summary,
    positions: out.positions,
    originalPositions: out.originalPositions,
    boundaryMask: out.boundaryMask,
    voronoiArea: out.voronoiArea,
    indices,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Helper API mount — install before React renders so the e2e + Archie
// can hit the surface at boot.

if (typeof window !== 'undefined') {
  try {
    window.__forgeSurfaceFairingHelper = Object.freeze({
      // Math.
      assembleCotangentLaplacian,
      assembleSymmetricCotangentLaplacian,
      applyLaplacian,
      detectBoundaryVertices,
      taubinSmoothStep,
      runTaubin,
      runBiLaplace,
      conjugateGradient,
      bendingEnergy,
      maxDisplacement,
      validateInputs,
      runFairing,
      extractPositions,
      extractTriangleIndices,
      makeTestSphere,
      makeTestSphereWithHole,
      makeBufferGeometryLike,
      // Scene drivers.
      listMeshBodies,
      findGeometryForBody,
      findWorldMatrixForBody,
      clearFairingGroup,
      installFairingGroup,
      runSurfaceFairing,
      // Constants.
      MODES:             FAIRING_MODES,
      DEFAULT_MODE:      FAIRING_DEFAULT_MODE,
      DEFAULT_ITERATIONS: FAIRING_DEFAULT_ITERATIONS,
      MIN_ITERATIONS:    FAIRING_MIN_ITERATIONS,
      MAX_ITERATIONS:    FAIRING_MAX_ITERATIONS,
      DEFAULT_LAMBDA:    FAIRING_DEFAULT_LAMBDA,
      DEFAULT_MU:        FAIRING_DEFAULT_MU,
      MIN_LAMBDA:        FAIRING_MIN_LAMBDA,
      MAX_LAMBDA:        FAIRING_MAX_LAMBDA,
      MIN_MU:            FAIRING_MIN_MU,
      MAX_MU:            FAIRING_MAX_MU,
      DEFAULT_EPSILON:   FAIRING_DEFAULT_EPSILON,
      MIN_EPSILON:       FAIRING_MIN_EPSILON,
      MAX_EPSILON:       FAIRING_MAX_EPSILON,
      CG_MAX_ITERATIONS: FAIRING_CG_MAX_ITERATIONS,
      CG_TOL:            FAIRING_CG_TOL,
      EVENT_NAME:        FORGE_FAIRING_EVENT,
      STORAGE_KEY:       FORGE_FAIRING_STORAGE,
      GROUP_NAME:        FORGE_FAIRING_GROUP_NAME,
      USERDATA_TAG:      FORGE_FAIRING_USERDATA_TAG,
    });
  } catch { /* SSR */ }
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail, matches PorcupinePlotPanel.

const PANEL_W = 420;
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
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
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
const ERR_BOX = {
  color: 'var(--forge-err, #ef5350)',
  background: 'var(--forge-canvas-1, #0e1218)',
  padding: '4px 8px',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
  border: '1px solid var(--forge-err, #ef5350)',
  borderRadius: 3,
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

// Format energy + length values for readability.
function fmtNum(v, digits = 4) {
  if (!Number.isFinite(v)) return 'n/a';
  const absV = Math.abs(v);
  if (absV >= 1000 || (absV > 0 && absV < 0.001)) return v.toExponential(digits);
  return v.toFixed(digits);
}
function fmtPct(v) {
  if (!Number.isFinite(v)) return 'n/a';
  return `${v.toFixed(2)}%`;
}

function modeLabel(m) {
  if (m === 'smooth') return 'Smooth · Taubin';
  if (m === 'fair')   return 'Fair · Bi-Laplace';
  return m;
}

// ─────────────────────────────────────────────────────────────────────
// Panel.

export function SurfaceFairingPanel({ open, onClose }) {
  const [bodies, setBodies] = useState(() => listMeshBodies());
  const [bodyId, setBodyId] = useState(null);
  const [mode, setMode]     = useState(FAIRING_DEFAULT_MODE);
  const [iterations, setIterations] = useState(FAIRING_DEFAULT_ITERATIONS);
  const [lambda, setLambda] = useState(FAIRING_DEFAULT_LAMBDA);
  const [mu, setMu]         = useState(FAIRING_DEFAULT_MU);
  const [epsilon, setEpsilon] = useState(FAIRING_DEFAULT_EPSILON);
  const [busy, setBusy]     = useState(false);
  const [result, setResult] = useState(null);
  const [errorMsg, setErrorMsg] = useState(null);

  // Persist UI prefs.
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(FORGE_FAIRING_STORAGE);
      if (!raw) return;
      const j = JSON.parse(raw);
      if (FAIRING_MODES.includes(j.mode)) setMode(j.mode);
      if (Number.isFinite(j.iterations)) setIterations(
        Math.max(FAIRING_MIN_ITERATIONS,
          Math.min(FAIRING_MAX_ITERATIONS, j.iterations | 0)));
      if (Number.isFinite(j.lambda)) setLambda(
        Math.max(FAIRING_MIN_LAMBDA, Math.min(FAIRING_MAX_LAMBDA, j.lambda)));
      if (Number.isFinite(j.mu)) setMu(
        Math.max(FAIRING_MIN_MU, Math.min(FAIRING_MAX_MU, j.mu)));
      if (Number.isFinite(j.epsilon)) setEpsilon(
        Math.max(FAIRING_MIN_EPSILON,
          Math.min(FAIRING_MAX_EPSILON, j.epsilon)));
    } catch { /* corrupt prefs — keep defaults */ }
  }, []);
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(FORGE_FAIRING_STORAGE, JSON.stringify({
        mode, iterations, lambda, mu, epsilon,
      }));
    } catch { /* quota / private */ }
  }, [mode, iterations, lambda, mu, epsilon]);

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

  const onRun = useCallback(async () => {
    if (!bodyId) {
      setErrorMsg('Pick a body first.');
      return;
    }
    setBusy(true);
    setErrorMsg(null);
    try {
      const r = await runSurfaceFairing({
        bodyId, mode, iterations, lambda, mu, epsilon,
      });
      if (!r.ok) {
        setErrorMsg(r.reason || 'fairing failed');
        setResult(null);
      } else {
        setResult(r);
      }
    } catch (ex) {
      setErrorMsg(`fairing crashed: ${ex && ex.message ? ex.message : ex}`);
      setResult(null);
    } finally {
      setBusy(false);
    }
  }, [bodyId, mode, iterations, lambda, mu, epsilon]);

  const onClear = useCallback(() => {
    clearFairingGroup();
    setResult(null);
    setErrorMsg(null);
  }, []);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <aside role="dialog"
           aria-label="Surface Fairing panel"
           data-testid="forge-surface-fairing-panel"
           data-body-id={bodyId == null ? '' : String(bodyId)}
           data-mode={mode}
           data-iterations={String(iterations)}
           data-lambda={String(lambda)}
           data-mu={String(mu)}
           data-epsilon={String(epsilon)}
           data-built={result ? '1' : '0'}
           data-vertex-count={result ? String(result.vertexCount) : ''}
           data-triangle-count={result ? String(result.triangleCount) : ''}
           data-boundary-count={result ? String(result.boundaryCount) : ''}
           data-pre-energy={result ? String(result.preEnergy) : ''}
           data-post-energy={result ? String(result.postEnergy) : ''}
           data-energy-reduction-pct={result ? String(result.energyReductionPct) : ''}
           data-max-displacement={result ? String(result.maxDisplacement) : ''}
           data-max-boundary-displacement={result ? String(result.maxBoundaryDisplacement) : ''}
           data-mounted={result && result.mounted ? '1' : '0'}
           data-busy={busy ? '1' : '0'}
           style={PANEL_STYLE}>

      <header style={HEADER_ROW}>
        <strong style={{ fontSize: 13, flex: 1 }}>
          Surface Fairing · Class-A
        </strong>
        <span data-testid="forge-surface-fairing-status"
              style={STATUS_PILL(
                errorMsg ? 'err'
                : busy ? 'mute'
                : result ? 'ok'
                : 'mute')}>
          {errorMsg ? 'error'
            : busy ? 'busy'
            : result ? 'built'
            : 'idle'}
        </span>
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close Surface Fairing panel"
                data-testid="forge-surface-fairing-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
        Pinkall &amp; Polthier 1993 cotangent Laplace-Beltrami. Smooth = Taubin
        λ/μ; Fair = bi-Laplacian (L<sup>T</sup>L+εI)X = εX<sub>0</sub>
        via conjugate gradient. Boundary vertices stay pinned.
      </div>

      <div style={SECTION_TITLE}>Body</div>
      <div style={SECTION_BOX}>
        <select value={bodyId == null ? '' : bodyId}
                onChange={(e) => setBodyId(e.target.value || null)}
                data-testid="forge-surface-fairing-body"
                aria-label="Body to fair"
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

      <div style={SECTION_TITLE}>Mode</div>
      <div style={SECTION_BOX}>
        <div style={MODE_GRID} role="radiogroup" aria-label="Fairing mode">
          {FAIRING_MODES.map((m) => (
            <button key={m}
                    type="button"
                    role="radio"
                    onClick={() => setMode(m)}
                    aria-checked={mode === m}
                    data-testid={`forge-surface-fairing-mode-${m}`}
                    data-active={mode === m ? '1' : '0'}
                    style={MODE_BTN(mode === m)}>
              <strong>{modeLabel(m)}</strong>
              <span style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
                {m === 'smooth' ? 'fast · volume-preserving'
                                : 'slow · bending-energy min'}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div style={SECTION_TITLE}>Iterations</div>
      <div style={SECTION_BOX}>
        <div style={SLIDER_ROW}>
          <input type="range"
                 min={FAIRING_MIN_ITERATIONS}
                 max={FAIRING_MAX_ITERATIONS}
                 step={1}
                 value={iterations}
                 onChange={(e) => {
                   const v = parseInt(e.target.value, 10);
                   if (Number.isFinite(v)) setIterations(
                     Math.max(FAIRING_MIN_ITERATIONS,
                       Math.min(FAIRING_MAX_ITERATIONS, v)));
                 }}
                 data-testid="forge-surface-fairing-iterations-slider"
                 aria-label="Iteration count"
                 style={{ width: '100%' }} />
          <input type="number"
                 min={FAIRING_MIN_ITERATIONS}
                 max={FAIRING_MAX_ITERATIONS}
                 step={1}
                 value={iterations}
                 onChange={(e) => {
                   const v = parseInt(e.target.value, 10);
                   if (Number.isFinite(v)) setIterations(
                     Math.max(FAIRING_MIN_ITERATIONS,
                       Math.min(FAIRING_MAX_ITERATIONS, v)));
                 }}
                 data-testid="forge-surface-fairing-iterations-input"
                 aria-label="Iteration count"
                 style={NUM_INPUT_STYLE} />
        </div>
      </div>

      {mode === 'smooth' && (
        <>
          <div style={SECTION_TITLE}>λ (shrink)</div>
          <div style={SECTION_BOX}>
            <div style={SLIDER_ROW}>
              <input type="range"
                     min={FAIRING_MIN_LAMBDA}
                     max={FAIRING_MAX_LAMBDA}
                     step={0.01}
                     value={lambda}
                     onChange={(e) => {
                       const v = Number(e.target.value);
                       if (Number.isFinite(v)) setLambda(
                         Math.max(FAIRING_MIN_LAMBDA,
                           Math.min(FAIRING_MAX_LAMBDA, v)));
                     }}
                     data-testid="forge-surface-fairing-lambda-slider"
                     aria-label="Taubin lambda"
                     style={{ width: '100%' }} />
              <input type="number"
                     min={FAIRING_MIN_LAMBDA}
                     max={FAIRING_MAX_LAMBDA}
                     step={0.01}
                     value={lambda}
                     onChange={(e) => {
                       const v = Number(e.target.value);
                       if (Number.isFinite(v)) setLambda(
                         Math.max(FAIRING_MIN_LAMBDA,
                           Math.min(FAIRING_MAX_LAMBDA, v)));
                     }}
                     data-testid="forge-surface-fairing-lambda-input"
                     aria-label="Taubin lambda"
                     style={NUM_INPUT_STYLE} />
            </div>
          </div>

          <div style={SECTION_TITLE}>μ (inflate)</div>
          <div style={SECTION_BOX}>
            <div style={SLIDER_ROW}>
              <input type="range"
                     min={FAIRING_MIN_MU}
                     max={FAIRING_MAX_MU}
                     step={0.01}
                     value={mu}
                     onChange={(e) => {
                       const v = Number(e.target.value);
                       if (Number.isFinite(v)) setMu(
                         Math.max(FAIRING_MIN_MU,
                           Math.min(FAIRING_MAX_MU, v)));
                     }}
                     data-testid="forge-surface-fairing-mu-slider"
                     aria-label="Taubin mu"
                     style={{ width: '100%' }} />
              <input type="number"
                     min={FAIRING_MIN_MU}
                     max={FAIRING_MAX_MU}
                     step={0.01}
                     value={mu}
                     onChange={(e) => {
                       const v = Number(e.target.value);
                       if (Number.isFinite(v)) setMu(
                         Math.max(FAIRING_MIN_MU,
                           Math.min(FAIRING_MAX_MU, v)));
                     }}
                     data-testid="forge-surface-fairing-mu-input"
                     aria-label="Taubin mu"
                     style={NUM_INPUT_STYLE} />
            </div>
            <div style={{ fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
              Need |μ| &gt; λ to cancel shrinkage; defaults match Taubin 1995.
            </div>
          </div>
        </>
      )}

      {mode === 'fair' && (
        <>
          <div style={SECTION_TITLE}>ε (Tikhonov)</div>
          <div style={SECTION_BOX}>
            <div style={SLIDER_ROW}>
              <input type="range"
                     min={Math.log10(FAIRING_MIN_EPSILON)}
                     max={Math.log10(FAIRING_MAX_EPSILON)}
                     step={0.05}
                     value={Math.log10(epsilon)}
                     onChange={(e) => {
                       const v = Math.pow(10, Number(e.target.value));
                       if (Number.isFinite(v)) setEpsilon(
                         Math.max(FAIRING_MIN_EPSILON,
                           Math.min(FAIRING_MAX_EPSILON, v)));
                     }}
                     data-testid="forge-surface-fairing-epsilon-slider"
                     aria-label="Tikhonov epsilon"
                     style={{ width: '100%' }} />
              <input type="number"
                     min={FAIRING_MIN_EPSILON}
                     max={FAIRING_MAX_EPSILON}
                     step={FAIRING_MIN_EPSILON}
                     value={epsilon}
                     onChange={(e) => {
                       const v = Number(e.target.value);
                       if (Number.isFinite(v)) setEpsilon(
                         Math.max(FAIRING_MIN_EPSILON,
                           Math.min(FAIRING_MAX_EPSILON, v)));
                     }}
                     data-testid="forge-surface-fairing-epsilon-input"
                     aria-label="Tikhonov epsilon"
                     style={NUM_INPUT_STYLE} />
            </div>
            <div style={{ fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
              Smaller ε = stronger fairing (slower CG); larger ε pulls X back to X₀.
            </div>
          </div>
        </>
      )}

      <div style={SECTION_TITLE}>Action</div>
      <div style={SECTION_BOX}>
        <div style={BUTTON_ROW}>
          <button type="button"
                  onClick={onRun}
                  disabled={!bodyId || busy}
                  data-testid="forge-surface-fairing-run"
                  style={ACTION_BTN('primary', !bodyId || busy)}>
            {busy ? 'Running…' : 'Run'}
          </button>
          <button type="button"
                  onClick={onClear}
                  disabled={busy}
                  data-testid="forge-surface-fairing-clear"
                  style={ACTION_BTN('default', busy)}>
            Clear preview
          </button>
        </div>
        {errorMsg && (
          <div data-testid="forge-surface-fairing-error" style={ERR_BOX}>
            error: {errorMsg}
          </div>
        )}
      </div>

      {result && (
        <>
          <div style={SECTION_TITLE}>Mesh</div>
          <div style={SECTION_BOX}>
            <div style={STATS_GRID}>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>Vertices</span>
                <span data-testid="forge-surface-fairing-stat-vertices">
                  {result.vertexCount.toLocaleString()}
                </span>
              </div>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>Triangles</span>
                <span data-testid="forge-surface-fairing-stat-triangles">
                  {result.triangleCount.toLocaleString()}
                </span>
              </div>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>Interior</span>
                <span data-testid="forge-surface-fairing-stat-interior">
                  {result.interiorCount.toLocaleString()}
                </span>
              </div>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>Boundary</span>
                <span data-testid="forge-surface-fairing-stat-boundary">
                  {result.boundaryCount.toLocaleString()}
                </span>
              </div>
            </div>
          </div>

          <div style={SECTION_TITLE}>Bending energy</div>
          <div style={SECTION_BOX}>
            <div style={STATS_GRID}>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>Pre</span>
                <span data-testid="forge-surface-fairing-stat-pre-energy">
                  {fmtNum(result.preEnergy)}
                </span>
              </div>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>Post</span>
                <span data-testid="forge-surface-fairing-stat-post-energy">
                  {fmtNum(result.postEnergy)}
                </span>
              </div>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>Reduction</span>
                <span data-testid="forge-surface-fairing-stat-reduction"
                      style={{ color: result.energyReductionPct > 0
                        ? 'var(--forge-ok, #4caf50)'
                        : 'var(--forge-err, #ef5350)' }}>
                  {fmtPct(result.energyReductionPct)}
                </span>
              </div>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>ε</span>
                <span>{fmtNum(result.params?.epsilon ?? epsilon)}</span>
              </div>
            </div>
          </div>

          <div style={SECTION_TITLE}>Displacement</div>
          <div style={SECTION_BOX}>
            <div style={STATS_GRID}>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>Max</span>
                <span data-testid="forge-surface-fairing-stat-maxdisp">
                  {fmtNum(result.maxDisplacement)}
                </span>
              </div>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>Free max</span>
                <span data-testid="forge-surface-fairing-stat-freedisp">
                  {fmtNum(result.maxFreeDisplacement)}
                </span>
              </div>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>Boundary max</span>
                <span data-testid="forge-surface-fairing-stat-bnddisp"
                      style={{ color: result.maxBoundaryDisplacement <= 1e-10
                        ? 'var(--forge-ok, #4caf50)'
                        : 'var(--forge-err, #ef5350)' }}>
                  {fmtNum(result.maxBoundaryDisplacement)}
                </span>
              </div>
              <div style={STAT_CELL}>
                <span style={STAT_LABEL}>Boundary held</span>
                <span data-testid="forge-surface-fairing-stat-bnd-preservation">
                  {fmtPct(result.boundaryPreservationPct)}
                </span>
              </div>
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
        Pinkall &amp; Polthier 1993 · Taubin 1995 · Botsch &amp; Kobbelt 2004 · Class-A target.
      </div>
    </aside>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host.

export function SurfaceFairingPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenSurfaceFairing  = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseSurfaceFairing = () => setOpen(false);

    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.surfaceFairing') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);

    return () => {
      try { delete window.__forgeOpenSurfaceFairing; } catch {}
      try { delete window.__forgeCloseSurfaceFairing; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return <SurfaceFairingPanel open={open} onClose={() => setOpen(false)} />;
}

export default SurfaceFairingPanelHost;
