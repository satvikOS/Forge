// PUSH-150 (Slice-110) — Surface Continuity Inspector.
//
// Class-A audit panel for the seam between two abutting surfaces:
//
//   • Face A picker — every surface body currently in the scene.
//   • Face B picker — same population, defaults to "next surface after A".
//   • Side-A radio — which of the four parametric edges of A is the seam
//       (u0 | u1 | v0 | v1).
//   • Side-B radio — same for B.
//   • Sample count slider — 5..101 boundary samples (default 25).
//   • Reverse-B toggle — flips B's parameter sweep so that, when the two
//       faces meet at the same 3D edge but their UV winds disagree, the
//       per-sample pairing still matches up.
//   • Mode toggle G0/G1/G2 — chooses which per-sample series renders in
//       the inline SVG chart.
//   • Inline SVG chart — per-sample mismatch line, worst-sample marker.
//   • Summary chips — worst + average per metric, with PASS/FAIL badges
//       against the Class-A thresholds (G0<1mm, G1<10°, G2<0.05 1/mm).
//
// The brief explicitly carves out:
//
//   "Pick 2 faces, sample boundary points, compute distance (G0), tangent
//    angle (G1), curvature mismatch (G2) via existing forge.surfacing.eval.
//    Report worst/avg per metric. Real Class-A workflow."
//
// Hard constraints honoured:
//   * NO new npm / C++ / external deps. Pure React + the existing
//     window.forge.surfacing.eval primitive + the helpers in
//     continuityMath.js.
//   * NO kernel modifications. The continuity metrics are derived JS-side
//     from surfacing.eval samples — the OCCT LocalAnalysis_SurfaceContinuity
//     class is NOT yet wired through the preload bridge, that's a kernel
//     rebuild out of scope for this slice.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one mount).
//   * Manual clicks do NOT post to Archie's thread.
//   * Multi-cam e2e mandate honoured by push-150-surface-continuity.spec.js.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import {
  FORGE_CONTINUITY_EVENT,
  FORGE_CONTINUITY_STORAGE,
  CONTINUITY_DEFAULT_SAMPLES,
  CONTINUITY_MIN_SAMPLES,
  CONTINUITY_MAX_SAMPLES,
  CONTINUITY_SIDES,
  CONTINUITY_MODES,
  computeContinuity,
  classifyContinuity,
  dataForMode,
  buildSparkPath,
  sampleBoundary,
  evalAtParam,
  distanceMm,
  tangentAngleDeg,
  curvatureDelta,
} from './continuityMath.js';

// Re-export the constants so external callers (Archie tool / e2e helpers)
// hit the same source of truth.
export {
  FORGE_CONTINUITY_EVENT,
  FORGE_CONTINUITY_STORAGE,
  CONTINUITY_DEFAULT_SAMPLES,
  CONTINUITY_MIN_SAMPLES,
  CONTINUITY_MAX_SAMPLES,
};

// ─────────────────────────────────────────────────────────────────────
// Scene helpers — discover the surface bodies currently in the scene.

/** Identify every native surface body in __forgeBodies. The PUSH-85 and
 *  PUSH-107 panels tag their bodies with `surface: true`; for backwards
 *  compatibility we ALSO accept anything whose toolId starts with
 *  'surfacing.' or whose name starts with 'Surface'. */
export function listSurfaceBodies() {
  if (typeof window === 'undefined') return [];
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return bodies.filter((b) => (
    b && b.kind === 'native' && Number.isFinite(b.handle)
    && (b.surface === true
        || (typeof b.toolId === 'string' && b.toolId.startsWith('surfacing.'))
        || (typeof b.name === 'string' && b.name.toLowerCase().includes('surface')))
  ));
}

// ─────────────────────────────────────────────────────────────────────
// runContinuityInspector — Top-level driver. Resolves the two face
// handles, runs the metric loop, broadcasts the result. Used by the
// panel button and the e2e spec / Archie tool calls.

export function runContinuityInspector({
  faceA, sideA = 'u1',
  faceB, sideB = 'u0',
  samples = CONTINUITY_DEFAULT_SAMPLES,
  reverseB = false,
  bodyAId = null, bodyBId = null,
} = {}) {
  if (!Number.isFinite(faceA) || !Number.isFinite(faceB)) {
    return { ok: false, reason: 'face A or face B handle missing' };
  }
  const r = computeContinuity({ faceA, sideA, faceB, sideB, samples, reverseB });
  if (!r.ok) return r;
  const classification = classifyContinuity(r.summary);
  const detail = {
    faceA, sideA, faceB, sideB, samples: r.samples,
    bodyAId, bodyBId,
    summary: r.summary, classification,
    ts: Date.now(),
  };
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FORGE_CONTINUITY_EVENT, { detail }));
    }
  } catch { /* fail soft — CustomEvent universal in Electron */ }
  return {
    ok: true,
    faceA, sideA, faceB, sideB, samples: r.samples,
    perSample: r.perSample, summary: r.summary, classification,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Side-effect helper API install — same pattern as ClassABlendPanel /
// SurfaceOffsetPanel. The moment this module is imported (which App.jsx
// does once the bundle loads), the helper API mirror is available on
// window. This is the contract surface plugins / e2e / Archie tool calls
// rely on.

if (typeof window !== 'undefined') {
  try {
    window.__forgeSurfaceContinuityHelper = Object.freeze({
      listSurfaceBodies,
      sampleBoundary,
      evalAtParam,
      distanceMm,
      tangentAngleDeg,
      curvatureDelta,
      computeContinuity,
      classifyContinuity,
      runContinuityInspector,
      dataForMode,
      buildSparkPath,
      EVENT_NAME:     FORGE_CONTINUITY_EVENT,
      STORAGE_KEY:    FORGE_CONTINUITY_STORAGE,
      DEFAULT_SAMPLES: CONTINUITY_DEFAULT_SAMPLES,
      MIN_SAMPLES:     CONTINUITY_MIN_SAMPLES,
      MAX_SAMPLES:     CONTINUITY_MAX_SAMPLES,
      SIDES:           CONTINUITY_SIDES,
      MODES:           CONTINUITY_MODES,
    });
    // Pre-mount menu listener so the e2e can observe the menu-action even
    // if the React host hasn't mounted yet.
    window.addEventListener('forge:menu-action', (e) => {
      if (e?.detail?.id === 'tools.surfaceContinuity') {
        window.__forgeSurfaceContinuityLastMenuTs = Date.now();
      }
    });
  } catch { /* fail soft — defensive in SSR / non-window envs */ }
}

// ─────────────────────────────────────────────────────────────────────
// Styles — same right-docked rail as PUSH-85 / PUSH-107.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 480,
  zIndex: 1336,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflow: 'hidden',
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
const TWO_COL = {
  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6,
};
const SELECT_STYLE = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '4px 6px', borderRadius: 3, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  width: '100%', boxSizing: 'border-box',
};
const SIDE_GRID = {
  display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4,
};
const SIDE_BTN = (active) => ({
  background: active ? 'var(--forge-accent-mute, #1f2c4a)' : 'var(--forge-canvas-1, #0e1218)',
  border: active ? '1px solid var(--forge-accent, #4f87ff)' : '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3,
  color: 'var(--forge-ink, #dadde2)',
  padding: '4px 0', cursor: 'pointer', fontSize: 10,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
});
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
const CHIP_GRID = {
  display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6,
};
const CHIP = (pass) => ({
  border: '1px solid ' + (pass === 'PASS'
    ? 'var(--forge-ok, #4caf50)'
    : pass === 'FAIL' ? 'var(--forge-err, #ef5350)'
    : 'var(--forge-rail-edge, #2a2d34)'),
  background: 'var(--forge-canvas-1, #0e1218)',
  borderRadius: 4, padding: '6px 4px',
  display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
  fontSize: 11,
});
const BADGE = (pass) => ({
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 9,
  color: pass === 'PASS' ? 'var(--forge-ok, #4caf50)'
       : pass === 'FAIL' ? 'var(--forge-err, #ef5350)'
       : 'var(--forge-ink-mute, #9aa1ab)',
  padding: '1px 6px',
  borderRadius: 'var(--forge-radius-pill, 10px)',
  border: '1px solid currentColor',
});
const CHART_BOX = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4, padding: 4,
  position: 'relative',
};
const LOG_BOX = {
  flex: 1, minHeight: 0, overflowY: 'auto',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4, background: 'var(--forge-canvas-1, #0e1218)',
  padding: 6, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  color: 'var(--forge-ink-2, #b5bac4)',
};
const STATUS_PILL = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  padding: '1px 6px',
  borderRadius: 'var(--forge-radius-pill, 10px)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
};

// ─────────────────────────────────────────────────────────────────────
// Helpers — labels.

function sideLabel(s) {
  if (s === 'u0') return 'u=0';
  if (s === 'u1') return 'u=1';
  if (s === 'v0') return 'v=0';
  if (s === 'v1') return 'v=1';
  return s;
}
function modeLabel(m) {
  if (m === 'G0') return 'Distance';
  if (m === 'G1') return 'Tangent angle';
  if (m === 'G2') return 'Mean Δ';
  return m;
}
function modeUnit(m) {
  if (m === 'G0') return 'mm';
  if (m === 'G1') return '°';
  if (m === 'G2') return '1/mm';
  return '';
}
function modeFmt(m, v) {
  if (!Number.isFinite(v)) return 'n/a';
  if (m === 'G0') return v.toFixed(4);
  if (m === 'G1') return v.toFixed(3);
  if (m === 'G2') return v.toExponential(2);
  return v.toFixed(3);
}

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function SurfaceContinuityPanel({ open, onClose }) {
  const [surfaces, setSurfaces] = useState(() => listSurfaceBodies());
  const [bodyAId, setBodyAId]   = useState(null);
  const [bodyBId, setBodyBId]   = useState(null);
  const [sideA,   setSideA]     = useState('u1');
  const [sideB,   setSideB]     = useState('u0');
  const [reverseB, setReverseB] = useState(false);
  const [samples, setSamples]   = useState(() => {
    if (typeof localStorage === 'undefined') return CONTINUITY_DEFAULT_SAMPLES;
    try {
      const raw = localStorage.getItem(FORGE_CONTINUITY_STORAGE);
      if (!raw) return CONTINUITY_DEFAULT_SAMPLES;
      const blob = JSON.parse(raw);
      const v = Number(blob.samples);
      if (Number.isFinite(v) && v >= CONTINUITY_MIN_SAMPLES && v <= CONTINUITY_MAX_SAMPLES) {
        return v | 0;
      }
      return CONTINUITY_DEFAULT_SAMPLES;
    } catch { return CONTINUITY_DEFAULT_SAMPLES; }
  });
  const [mode, setMode] = useState(() => {
    if (typeof localStorage === 'undefined') return 'G0';
    try {
      const raw = localStorage.getItem(FORGE_CONTINUITY_STORAGE);
      if (!raw) return 'G0';
      const blob = JSON.parse(raw);
      const m = String(blob.mode || 'G0').toUpperCase();
      if (m === 'G0' || m === 'G1' || m === 'G2') return m;
      return 'G0';
    } catch { return 'G0'; }
  });
  const [result, setResult] = useState(null);
  const [log, setLog] = useState([]);
  const lastInspectRef = useRef(null);

  // Persist sample count + mode so a re-open boots the user's last set-up.
  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(FORGE_CONTINUITY_STORAGE,
        JSON.stringify({ samples, mode }));
    } catch { /* quota / private mode — fail soft */ }
  }, [samples, mode]);

  // Refresh surface list when the panel opens + on bodies-changed.
  useEffect(() => {
    if (!open) return undefined;
    const refresh = () => {
      const list = listSurfaceBodies();
      setSurfaces(list);
      setBodyAId((prev) => {
        if (prev && list.find((b) => b.id === prev)) return prev;
        if (list.length >= 1) return list[list.length - 2 >= 0
          ? list.length - 2 : list.length - 1].id;
        return null;
      });
      setBodyBId((prev) => {
        if (prev && list.find((b) => b.id === prev)) return prev;
        if (list.length >= 1) return list[list.length - 1].id;
        return null;
      });
    };
    refresh();
    setResult(null);
    setLog([]);
    window.addEventListener('forge:selection-changed', refresh);
    window.addEventListener('forge:bodies-changed', refresh);
    return () => {
      window.removeEventListener('forge:selection-changed', refresh);
      window.removeEventListener('forge:bodies-changed', refresh);
    };
  }, [open]);

  const bodyA = useMemo(() =>
    surfaces.find((b) => b.id === bodyAId) || null, [bodyAId, surfaces]);
  const bodyB = useMemo(() =>
    surfaces.find((b) => b.id === bodyBId) || null, [bodyBId, surfaces]);

  // Inspect — the headline button. Calls the headless driver.
  const onInspect = useCallback(() => {
    if (!bodyA || !bodyB) {
      setLog((l) => [...l.slice(-12), {
        ok: false, ts: Date.now(),
        message: 'Pick two surface bodies to inspect.',
      }]);
      return;
    }
    const r = runContinuityInspector({
      faceA: bodyA.handle, sideA,
      faceB: bodyB.handle, sideB,
      samples, reverseB,
      bodyAId: bodyA.id, bodyBId: bodyB.id,
    });
    if (r.ok) {
      lastInspectRef.current = r;
      setResult(r);
      setLog((l) => [...l.slice(-12), {
        ok: true, ts: Date.now(),
        message: `Inspect ${samples}× ${sideLabel(sideA)}→${sideLabel(sideB)}: `
          + `G0 max ${modeFmt('G0', r.summary.g0Max)} mm, `
          + `G1 max ${modeFmt('G1', r.summary.g1Max)}°, `
          + `G2 max ${modeFmt('G2', r.summary.g2Max)} 1/mm `
          + `(${r.classification.grade})`,
      }]);
    } else {
      setResult(null);
      setLog((l) => [...l.slice(-12), {
        ok: false, ts: Date.now(),
        message: `Inspect failed: ${r.reason || 'error'}`,
      }]);
    }
  }, [bodyA, bodyB, sideA, sideB, samples, reverseB]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  // Chart preparation.
  const chartW = 432, chartH = 100;
  const modeData = result
    ? dataForMode(result.perSample, result.summary, mode)
    : null;
  const spark = modeData
    ? buildSparkPath(modeData.values, chartW, chartH)
    : null;
  // Worst-sample marker x.
  const worstX = modeData && modeData.worstIdx >= 0 && modeData.values.length > 1
    ? 4 + (modeData.worstIdx / (modeData.values.length - 1)) * (chartW - 8)
    : null;

  // Classification chips.
  const cls = result ? result.classification : null;

  return createPortal(
    <div role="dialog"
         aria-label="Surface continuity"
         data-testid="forge-surface-continuity-panel"
         data-body-a={bodyAId == null ? '' : String(bodyAId)}
         data-body-b={bodyBId == null ? '' : String(bodyBId)}
         data-side-a={sideA}
         data-side-b={sideB}
         data-samples={String(samples)}
         data-mode={mode}
         data-reverse-b={reverseB ? '1' : '0'}
         data-source-count={String(surfaces.length)}
         data-g0-max={result ? String(result.summary.g0Max) : ''}
         data-g1-max={result ? String(result.summary.g1Max) : ''}
         data-g2-max={result ? String(result.summary.g2Max) : ''}
         data-grade={cls ? cls.grade : ''}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="sketch.spline" size={14} />
        <strong style={{ fontSize: 13 }}>Surface Continuity</strong>
        <span style={STATUS_PILL}>G0 / G1 / G2 audit</span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close Surface Continuity panel"
                data-testid="forge-surface-continuity-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
        Pick two abutting surfaces. The panel samples the shared edge on
        both faces and reports per-sample distance (G0), cross-seam
        tangent angle (G1), and mean-curvature delta (G2) via
        forge.surfacing.eval. Pass thresholds: G0&lt;1 mm, G1&lt;10°,
        G2&lt;0.05 (1/mm).
      </div>

      <div style={SECTION_TITLE}>Face A</div>
      <div style={SECTION_BOX}>
        <select value={bodyAId == null ? '' : bodyAId}
                onChange={(e) => setBodyAId(e.target.value || null)}
                data-testid="forge-surface-continuity-body-a"
                aria-label="Face A body"
                style={SELECT_STYLE}>
          <option value="">
            {surfaces.length === 0 ? '— no surface bodies in scene —' : '— pick face A —'}
          </option>
          {surfaces.map((b) => (
            <option key={b.id} value={b.id}>
              {`${b.name || b.toolId || b.id}  ·  handle ${b.handle}`}
            </option>
          ))}
        </select>
        <div style={SIDE_GRID}>
          {CONTINUITY_SIDES.map((s) => (
            <button key={s}
                    type="button"
                    onClick={() => setSideA(s)}
                    data-testid={`forge-surface-continuity-side-a-${s}`}
                    data-active={sideA === s ? '1' : '0'}
                    aria-pressed={sideA === s}
                    style={SIDE_BTN(sideA === s)}>
              {sideLabel(s)}
            </button>
          ))}
        </div>
      </div>

      <div style={SECTION_TITLE}>Face B</div>
      <div style={SECTION_BOX}>
        <select value={bodyBId == null ? '' : bodyBId}
                onChange={(e) => setBodyBId(e.target.value || null)}
                data-testid="forge-surface-continuity-body-b"
                aria-label="Face B body"
                style={SELECT_STYLE}>
          <option value="">
            {surfaces.length === 0 ? '— no surface bodies in scene —' : '— pick face B —'}
          </option>
          {surfaces.map((b) => (
            <option key={b.id} value={b.id}>
              {`${b.name || b.toolId || b.id}  ·  handle ${b.handle}`}
            </option>
          ))}
        </select>
        <div style={SIDE_GRID}>
          {CONTINUITY_SIDES.map((s) => (
            <button key={s}
                    type="button"
                    onClick={() => setSideB(s)}
                    data-testid={`forge-surface-continuity-side-b-${s}`}
                    data-active={sideB === s ? '1' : '0'}
                    aria-pressed={sideB === s}
                    style={SIDE_BTN(sideB === s)}>
              {sideLabel(s)}
            </button>
          ))}
        </div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6,
                        fontSize: 11, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          <input type="checkbox"
                 checked={reverseB}
                 onChange={(e) => setReverseB(e.target.checked)}
                 data-testid="forge-surface-continuity-reverse-b" />
          Reverse face B parameter sweep
        </label>
      </div>

      <div style={SECTION_TITLE}>Samples</div>
      <div style={SECTION_BOX}>
        <div style={SLIDER_ROW}>
          <input type="range"
                 min={CONTINUITY_MIN_SAMPLES}
                 max={CONTINUITY_MAX_SAMPLES}
                 step="1"
                 value={samples}
                 onChange={(e) => setSamples(Math.max(CONTINUITY_MIN_SAMPLES,
                   Math.min(CONTINUITY_MAX_SAMPLES, Number(e.target.value) | 0)))}
                 data-testid="forge-surface-continuity-samples-slider"
                 aria-label="Sample count"
                 style={{ width: '100%' }} />
          <input type="number"
                 min={CONTINUITY_MIN_SAMPLES}
                 max={CONTINUITY_MAX_SAMPLES}
                 step="1"
                 value={samples}
                 onChange={(e) => setSamples(Math.max(CONTINUITY_MIN_SAMPLES,
                   Math.min(CONTINUITY_MAX_SAMPLES, Number(e.target.value) | 0)))}
                 data-testid="forge-surface-continuity-samples-number"
                 aria-label="Sample count"
                 style={NUM_INPUT_STYLE} />
        </div>
        <div style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
                      display: 'flex', justifyContent: 'space-between' }}>
          <span>{`${CONTINUITY_MIN_SAMPLES} samples`}</span>
          <span>{`${samples} along ${sideLabel(sideA)}↔${sideLabel(sideB)} ${reverseB ? '(B reversed)' : ''}`}</span>
          <span>{`${CONTINUITY_MAX_SAMPLES} samples`}</span>
        </div>
      </div>

      <div style={SECTION_TITLE}>Inspect</div>
      <div style={SECTION_BOX}>
        <button type="button"
                onClick={onInspect}
                disabled={!bodyA || !bodyB}
                data-testid="forge-surface-continuity-inspect"
                style={ACTION_BTN('primary', !bodyA || !bodyB)}>
          Inspect continuity
        </button>
      </div>

      <div style={SECTION_TITLE}>Mode</div>
      <div style={SECTION_BOX}>
        <div style={MODE_GRID}>
          {CONTINUITY_MODES.map((m) => (
            <button key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    data-testid={`forge-surface-continuity-mode-${m.toLowerCase()}`}
                    data-active={mode === m ? '1' : '0'}
                    aria-pressed={mode === m}
                    style={MODE_BTN(mode === m)}>
              <strong>{m}</strong>
              <span style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
                {`${modeLabel(m)} (${modeUnit(m)})`}
              </span>
            </button>
          ))}
        </div>
        <div data-testid="forge-surface-continuity-chart" style={CHART_BOX}>
          <svg width={chartW} height={chartH}
               viewBox={`0 0 ${chartW} ${chartH}`}
               style={{ display: 'block' }}
               aria-label={`${modeLabel(mode)} per sample`}>
            <line x1="0" y1={chartH / 2} x2={chartW} y2={chartH / 2}
                  stroke="var(--forge-rail-edge, #2a2d34)" strokeWidth="1"
                  strokeDasharray="2,2" />
            {spark && spark.d
              ? (
                <>
                  <path d={spark.d}
                        fill="none"
                        stroke="var(--forge-accent, #4f87ff)"
                        strokeWidth="1.5" />
                  {modeData && modeData.values.map((v, i) => {
                    if (!Number.isFinite(v) || modeData.values.length < 2) return null;
                    const px = 4 + (i / (modeData.values.length - 1)) * (chartW - 8);
                    const range = spark.max - spark.min;
                    const py = 4 + (range > 0
                      ? (1 - (v - spark.min) / range) * (chartH - 8)
                      : (chartH - 8) / 2);
                    return (
                      <circle key={i} cx={px} cy={py} r="1.5"
                              fill="var(--forge-accent, #4f87ff)" />
                    );
                  })}
                  {Number.isFinite(worstX) && worstX != null && (
                    <line x1={worstX} y1="0" x2={worstX} y2={chartH}
                          stroke="var(--forge-err, #ef5350)" strokeWidth="1" />
                  )}
                </>
              ) : (
                <text x={chartW / 2} y={chartH / 2}
                      fill="var(--forge-ink-mute, #9aa1ab)" fontSize="11"
                      textAnchor="middle" dominantBaseline="middle">
                  {bodyA && bodyB
                    ? 'Click "Inspect continuity" to populate.'
                    : 'Pick two surface bodies and inspect.'}
                </text>
              )}
          </svg>
          {modeData && (
            <div style={{ display: 'flex', justifyContent: 'space-between',
                          fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
                          padding: '4px 4px 0' }}>
              <span data-testid="forge-surface-continuity-chart-min">
                {`min ${modeFmt(mode, spark ? spark.min : 0)} ${modeUnit(mode)}`}
              </span>
              <span data-testid="forge-surface-continuity-chart-max">
                {`max ${modeFmt(mode, spark ? spark.max : 0)} ${modeUnit(mode)}`}
              </span>
            </div>
          )}
        </div>
      </div>

      <div style={SECTION_TITLE}>Summary</div>
      <div style={SECTION_BOX}>
        <div style={CHIP_GRID}>
          <div data-testid="forge-surface-continuity-chip-g0" style={CHIP(cls ? cls.g0 : null)}>
            <strong>G0</strong>
            <span style={{ fontFamily: 'var(--forge-mono, ui-monospace, monospace)' }}>
              {result ? `${modeFmt('G0', result.summary.g0Max)} mm` : '—'}
            </span>
            <span style={{ fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
              {result ? `avg ${modeFmt('G0', result.summary.g0Avg)} mm` : ''}
            </span>
            <span style={BADGE(cls ? cls.g0 : null)} data-testid="forge-surface-continuity-badge-g0">
              {cls ? cls.g0 : '—'}
            </span>
          </div>
          <div data-testid="forge-surface-continuity-chip-g1" style={CHIP(cls ? cls.g1 : null)}>
            <strong>G1</strong>
            <span style={{ fontFamily: 'var(--forge-mono, ui-monospace, monospace)' }}>
              {result ? `${modeFmt('G1', result.summary.g1Max)}°` : '—'}
            </span>
            <span style={{ fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
              {result ? `avg ${modeFmt('G1', result.summary.g1Avg)}°` : ''}
            </span>
            <span style={BADGE(cls ? cls.g1 : null)} data-testid="forge-surface-continuity-badge-g1">
              {cls ? cls.g1 : '—'}
            </span>
          </div>
          <div data-testid="forge-surface-continuity-chip-g2" style={CHIP(cls ? cls.g2 : null)}>
            <strong>G2</strong>
            <span style={{ fontFamily: 'var(--forge-mono, ui-monospace, monospace)' }}>
              {result ? `${modeFmt('G2', result.summary.g2Max)} 1/mm` : '—'}
            </span>
            <span style={{ fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
              {result ? `avg ${modeFmt('G2', result.summary.g2Avg)} 1/mm` : ''}
            </span>
            <span style={BADGE(cls ? cls.g2 : null)} data-testid="forge-surface-continuity-badge-g2">
              {cls ? cls.g2 : '—'}
            </span>
          </div>
        </div>
        {result && (
          <div data-testid="forge-surface-continuity-grade"
               style={{ textAlign: 'center', fontSize: 11,
                        color: cls.grade === 'G2' ? 'var(--forge-ok, #4caf50)'
                             : cls.grade === 'G1' ? 'var(--forge-accent, #4f87ff)'
                             : cls.grade === 'G0' ? 'var(--forge-warn, #d4a142)'
                             : 'var(--forge-err, #ef5350)' }}>
            Highest seam continuity: <strong>{cls.grade}</strong>
            {' '}({result.samples} samples between {sideLabel(sideA)}↔{sideLabel(sideB)})
          </div>
        )}
      </div>

      <div style={SECTION_TITLE}>Log</div>
      <div data-testid="forge-surface-continuity-log"
           data-log-count={log.length}
           style={LOG_BOX}>
        {log.length === 0 ? (
          <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>
            no inspections yet
          </span>
        ) : log.slice().reverse().map((entry, i) => (
          <div key={`${entry.ts}-${i}`}
               style={{
                 display: 'flex', gap: 6, alignItems: 'baseline',
                 borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
                 padding: '2px 0',
               }}>
            <span style={{ color: entry.ok ? 'var(--forge-ok, #4caf50)'
                                            : 'var(--forge-err, #ef5350)' }}>
              {entry.ok ? 'OK' : 'ER'}
            </span>
            <span style={{ flex: 1 }}>{entry.message}</span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.surfaceContinuity` menu action.

export function SurfaceContinuityPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSurfaceContinuity  = () => setOpen(true);
    window.__forgeCloseSurfaceContinuity = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.surfaceContinuity') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenSurfaceContinuity; } catch {}
      try { delete window.__forgeCloseSurfaceContinuity; } catch {}
    };
  }, []);
  if (!open) return null;
  return <SurfaceContinuityPanel open={open} onClose={() => setOpen(false)} />;
}

export default SurfaceContinuityPanel;
