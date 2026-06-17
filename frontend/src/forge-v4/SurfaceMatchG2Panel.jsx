// PUSH-214 (Slice-165) — Real G2 Surface Match panel.
//
// Given a TARGET tensor-product Bezier surface and a REFERENCE base
// surface sharing a boundary edge, adjust the target's control rows
// nearest that edge so the join is G2 (position + tangent plane +
// curvature). Class-A surfacing parity with Alias / ICEM / CATIA.
//
// Surface contract:
//   * Preset row — 3 named (reference, target, refEdge, tgtEdge) seeds
//     covering the brief's verification cases:
//       - flat ↔ flat       (no-op solve sanity)
//       - sphere ↔ flat     (real curvature transfer)
//       - identity (saddle) (identity-correction sanity)
//   * Edge picker — refEdge / tgtEdge ∈ {v0, v1, u0, u1}.
//   * Sample count slider — 5..201, default 25.
//   * "Match G2" button — runs solveSurfaceMatchG2(), publishes the
//     before/after metrics to the panel state + window + bus event.
//   * Read-out — pre / post G0 / G1 / G2 deviation chips, per-sample
//     table with the worst row highlighted.
//
// Window surface:
//   * window.__forgeOpenSurfaceMatchG2(true|false)
//   * window.__forgeCloseSurfaceMatchG2()
//   * window.__forgeSurfaceMatchG2Helper         — math surface
//   * window.__forgeSurfaceMatchG2Last           — last result (summary)
//
// Headed event: `forge:surface-match-g2-built` with the result payload
// mirroring window.__forgeSurfaceMatchG2Last.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';

import {
  SURFACE_MATCH_G2_EVENT,
  SURFACE_MATCH_G2_STORAGE,
  SURFACE_MATCH_G2_DEFAULT_SAMPLES,
  SURFACE_MATCH_G2_MIN_SAMPLES,
  SURFACE_MATCH_G2_MAX_SAMPLES,
  SURFACE_MATCH_G2_EDGES,
  SURFACE_MATCH_G2_G0_THRESHOLD,
  SURFACE_MATCH_G2_G1_THRESHOLD,
  SURFACE_MATCH_G2_G2_THRESHOLD,
  normaliseSurface,
  deCasteljau,
  deCasteljauDeriv1,
  deCasteljauDeriv2,
  surfaceEval,
  surfaceDu,
  surfaceDv,
  surfaceDuu,
  surfaceDvv,
  surfaceDuv,
  surfaceLocalGeometry,
  edgeMeta,
  getEdgeRow,
  setEdgeRow,
  edgeParamToUv,
  edgeCrossDeriv,
  edgeCrossDeriv2,
  bezierAnchorParams,
  solveSurfaceMatchG2,
  verifyG2Match,
  makeBicubicFlatPatch,
  makeBicubicSpherePatch,
  makeBicubicSaddlePatch,
  makeFlatRefTargetPair,
  makeSphereFlatPair,
  makeIdentityPair,
  validateInputs,
  angleUnorientedDeg,
} from './surfaceMatchG2Math.js';

// Re-export so plugins / e2e have a stable import path.
export {
  SURFACE_MATCH_G2_EVENT,
  SURFACE_MATCH_G2_STORAGE,
  SURFACE_MATCH_G2_DEFAULT_SAMPLES,
  SURFACE_MATCH_G2_MIN_SAMPLES,
  SURFACE_MATCH_G2_MAX_SAMPLES,
  SURFACE_MATCH_G2_EDGES,
  SURFACE_MATCH_G2_G0_THRESHOLD,
  SURFACE_MATCH_G2_G1_THRESHOLD,
  SURFACE_MATCH_G2_G2_THRESHOLD,
};

// ─────────────────────────────────────────────────────────────────────
// Helper API — exposed for the e2e + Archie tool calls.

if (typeof window !== 'undefined') {
  try {
    window.__forgeSurfaceMatchG2Helper = Object.freeze({
      // Pure-math entry points.
      normaliseSurface,
      deCasteljau,
      deCasteljauDeriv1,
      deCasteljauDeriv2,
      surfaceEval,
      surfaceDu, surfaceDv,
      surfaceDuu, surfaceDvv, surfaceDuv,
      surfaceLocalGeometry,
      edgeMeta,
      getEdgeRow, setEdgeRow,
      edgeParamToUv,
      edgeCrossDeriv, edgeCrossDeriv2,
      bezierAnchorParams,
      solveSurfaceMatchG2,
      verifyG2Match,
      validateInputs,
      angleUnorientedDeg,
      // Synthetic surface constructors.
      makeBicubicFlatPatch,
      makeBicubicSpherePatch,
      makeBicubicSaddlePatch,
      makeFlatRefTargetPair,
      makeSphereFlatPair,
      makeIdentityPair,
      // Constants.
      EVENT_NAME:       SURFACE_MATCH_G2_EVENT,
      STORAGE_KEY:      SURFACE_MATCH_G2_STORAGE,
      DEFAULT_SAMPLES:  SURFACE_MATCH_G2_DEFAULT_SAMPLES,
      MIN_SAMPLES:      SURFACE_MATCH_G2_MIN_SAMPLES,
      MAX_SAMPLES:      SURFACE_MATCH_G2_MAX_SAMPLES,
      EDGES:            SURFACE_MATCH_G2_EDGES,
      G0_THRESHOLD:     SURFACE_MATCH_G2_G0_THRESHOLD,
      G1_THRESHOLD:     SURFACE_MATCH_G2_G1_THRESHOLD,
      G2_THRESHOLD:     SURFACE_MATCH_G2_G2_THRESHOLD,
    });
  } catch { /* fail soft */ }
}

// ─────────────────────────────────────────────────────────────────────
// Presets — the 3 verification cases the brief calls for.

const PRESETS = {
  'flat-flat': () => {
    const p = makeFlatRefTargetPair({ size: 100 });
    return { ...p, label: 'Flat ↔ Flat (no-op)' };
  },
  'sphere-flat': () => {
    const p = makeSphereFlatPair({ R: 200, size: 100 });
    return { ...p, label: 'Sphere ↔ Flat (curvature transfer)' };
  },
  'identity': () => {
    const p = makeIdentityPair({});
    return { ...p, label: 'Identity (zero correction)' };
  },
};

// ─────────────────────────────────────────────────────────────────────
// Panel styling — same right-docked rail as the rest of the v4 panels.

const PANEL_W = 460;
const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: PANEL_W,
  zIndex: 1338,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
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
  padding: '4px 4px', cursor: 'pointer', fontSize: 9,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
});
const EDGE_GRID = {
  display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4,
};
const EDGE_BTN = (active) => ({
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

// Format a small number for the read-outs. Switches to scientific
// notation for very small absolute values.
function fmt(v, fixed = 4) {
  if (!Number.isFinite(v)) return 'n/a';
  if (Math.abs(v) < 1e-6) return v.toExponential(2);
  return v.toFixed(fixed);
}

// ─────────────────────────────────────────────────────────────────────
// Panel component.

export function SurfaceMatchG2Panel({ open, onClose }) {
  const [presetName, setPresetName] = useState('flat-flat');
  const [pair, setPair] = useState(() => PRESETS['flat-flat']());
  const [refEdge, setRefEdge] = useState(() => PRESETS['flat-flat']().refEdge);
  const [tgtEdge, setTgtEdge] = useState(() => PRESETS['flat-flat']().tgtEdge);
  const [samples, setSamples] = useState(SURFACE_MATCH_G2_DEFAULT_SAMPLES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

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
    setPair(built);
    setRefEdge(built.refEdge);
    setTgtEdge(built.tgtEdge);
    setResult(null);
    setError(null);
  }, []);

  const onChangeSamples = useCallback((e) => {
    let v = parseInt(e.target.value, 10);
    if (!Number.isFinite(v)) v = SURFACE_MATCH_G2_DEFAULT_SAMPLES;
    if (v < SURFACE_MATCH_G2_MIN_SAMPLES) v = SURFACE_MATCH_G2_MIN_SAMPLES;
    if (v > SURFACE_MATCH_G2_MAX_SAMPLES) v = SURFACE_MATCH_G2_MAX_SAMPLES;
    setSamples(v);
  }, []);

  const inputValidation = useMemo(() => {
    return validateInputs({
      reference: pair.reference,
      target:    pair.target,
      refEdge, tgtEdge,
    });
  }, [pair, refEdge, tgtEdge]);

  const onMatch = useCallback(() => {
    setBusy(true);
    setError(null);
    setTimeout(() => {
      try {
        // Deep-clone the working pair so re-running "Match G2" on the
        // same preset is idempotent (each click solves against a fresh
        // copy of the seed).
        const ref = {
          controlPoints: pair.reference.controlPoints.map(
            (row) => row.map((p) => [p[0], p[1], p[2]])),
        };
        const tgt = {
          controlPoints: pair.target.controlPoints.map(
            (row) => row.map((p) => [p[0], p[1], p[2]])),
        };
        const r = solveSurfaceMatchG2({
          reference: ref,
          target:    tgt,
          refEdge, tgtEdge, samples,
        });
        if (!r.ok) {
          setError(r.reason || 'unknown solve failure');
          setResult(null);
          if (typeof window !== 'undefined') {
            try {
              window.__forgeSurfaceMatchG2Last = { ok: false, reason: r.reason };
              window.dispatchEvent(new CustomEvent(SURFACE_MATCH_G2_EVENT, {
                detail: { ok: false, reason: r.reason },
              }));
            } catch {}
          }
          return;
        }
        setResult({
          ...r,
          // Store the edited target so the read-out can display the new
          // control rows.
          editedTarget: tgt,
          referenceUsed: ref,
        });
        if (typeof window !== 'undefined') {
          const summary = {
            ok: true,
            preset: presetName,
            refEdge, tgtEdge,
            samples,
            n_boundary: r.n_boundary,
            m_target:   r.m_target,
            anchors:    r.anchors,
            before: {
              g0Max: r.beforeMetrics.g0Max,
              g0Avg: r.beforeMetrics.g0Avg,
              normalDevMaxDeg: r.beforeMetrics.normalDevMaxDeg,
              normalDevAvgDeg: r.beforeMetrics.normalDevAvgDeg,
              tangentAlongMaxDeg: r.beforeMetrics.tangentAlongMaxDeg,
              tangentCrossMaxDeg: r.beforeMetrics.tangentCrossMaxDeg,
              meanCurvMaxDelta:   r.beforeMetrics.meanCurvMaxDelta,
              gaussCurvMaxDelta:  r.beforeMetrics.gaussCurvMaxDelta,
              princCurv1MaxDelta: r.beforeMetrics.princCurv1MaxDelta,
              princCurv2MaxDelta: r.beforeMetrics.princCurv2MaxDelta,
              g0Pass: r.beforeMetrics.g0Pass,
              g1Pass: r.beforeMetrics.g1Pass,
              g2Pass: r.beforeMetrics.g2Pass,
            },
            after: {
              g0Max: r.afterMetrics.g0Max,
              g0Avg: r.afterMetrics.g0Avg,
              normalDevMaxDeg: r.afterMetrics.normalDevMaxDeg,
              normalDevAvgDeg: r.afterMetrics.normalDevAvgDeg,
              tangentAlongMaxDeg: r.afterMetrics.tangentAlongMaxDeg,
              tangentCrossMaxDeg: r.afterMetrics.tangentCrossMaxDeg,
              meanCurvMaxDelta:   r.afterMetrics.meanCurvMaxDelta,
              gaussCurvMaxDelta:  r.afterMetrics.gaussCurvMaxDelta,
              princCurv1MaxDelta: r.afterMetrics.princCurv1MaxDelta,
              princCurv2MaxDelta: r.afterMetrics.princCurv2MaxDelta,
              g0Pass: r.afterMetrics.g0Pass,
              g1Pass: r.afterMetrics.g1Pass,
              g2Pass: r.afterMetrics.g2Pass,
            },
            editedRows: {
              row0: r.edited.row0,
              row1: r.edited.row1,
              row2: r.edited.row2,
            },
            ts: Date.now(),
          };
          window.__forgeSurfaceMatchG2Last = summary;
          try {
            window.dispatchEvent(new CustomEvent(SURFACE_MATCH_G2_EVENT, {
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
  }, [pair, presetName, refEdge, tgtEdge, samples]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <aside role="region"
           aria-label="G2 Surface Match panel"
           data-testid="forge-surface-match-g2-panel"
           data-preset={presetName}
           data-ref-edge={refEdge}
           data-tgt-edge={tgtEdge}
           data-samples={samples}
           data-input-ok={inputValidation.ok ? '1' : '0'}
           data-post-g0-max={result ? result.afterMetrics.g0Max : ''}
           data-post-g2-mean-delta={result ? result.afterMetrics.meanCurvMaxDelta : ''}
           style={PANEL_STYLE}>

      <div style={HEADER_ROW}>
        <strong style={{ flex: 1 }}>
          G2 Surface Match · Class-A
        </strong>
        <span data-testid="forge-surface-match-g2-status"
              style={STATUS_PILL(
                error ? 'err'
                : (result
                    && result.afterMetrics.g2Pass) ? 'ok'
                : 'mute')}>
          {error ? 'error'
            : busy ? 'busy'
            : result ? (result.afterMetrics.g2Pass ? 'G2 pass' : 'G2 warn')
            : 'idle'}
        </span>
        <button type="button"
                onClick={onClose}
                aria-label="Close G2 Surface Match panel"
                data-testid="forge-surface-match-g2-close"
                style={CLOSE_BTN}>
          ×
        </button>
      </div>

      <div style={SECTION_TITLE}>Preset (ref ↔ target)</div>
      <div style={SECTION_BOX}>
        <div style={PRESET_GRID}>
          {[
            { id: 'flat-flat',    label: 'flat↔flat' },
            { id: 'sphere-flat',  label: 'sphere↔flat' },
            { id: 'identity',     label: 'identity' },
          ].map((p) => (
            <button key={p.id}
                    type="button"
                    onClick={() => onChoosePreset(p.id)}
                    data-testid={`forge-surface-match-g2-preset-${p.id}`}
                    style={PRESET_BTN(presetName === p.id)}>
              {p.label}
            </button>
          ))}
        </div>
        <div style={{
          fontSize: 9,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
        }}>
          {pair.label}
        </div>
      </div>

      <div style={SECTION_TITLE}>Reference surface picker</div>
      <div style={SECTION_BOX}>
        <div style={{ display: 'grid',
                      gridTemplateColumns: '1fr 1fr',
                      gap: 8,
                      fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                      fontSize: 10 }}>
          <div data-testid="forge-surface-match-g2-ref-info">
            <span style={CHIP_LABEL}>Reference</span>
            <div>
              {(() => {
                const r = normaliseSurface(pair.reference);
                return r.ok
                  ? `degree ${r.n}×${r.m} · ${(r.n+1)*(r.m+1)} CPs`
                  : `invalid: ${r.reason}`;
              })()}
            </div>
          </div>
          <div data-testid="forge-surface-match-g2-tgt-info">
            <span style={CHIP_LABEL}>Target</span>
            <div>
              {(() => {
                const r = normaliseSurface(pair.target);
                return r.ok
                  ? `degree ${r.n}×${r.m} · ${(r.n+1)*(r.m+1)} CPs`
                  : `invalid: ${r.reason}`;
              })()}
            </div>
          </div>
        </div>
      </div>

      <div style={SECTION_TITLE}>Boundary edge — reference</div>
      <div style={SECTION_BOX}>
        <div style={EDGE_GRID}>
          {SURFACE_MATCH_G2_EDGES.map((e) => (
            <button key={e}
                    type="button"
                    onClick={() => setRefEdge(e)}
                    data-testid={`forge-surface-match-g2-ref-edge-${e}`}
                    style={EDGE_BTN(refEdge === e)}>
              {e}
            </button>
          ))}
        </div>
      </div>

      <div style={SECTION_TITLE}>Boundary edge — target</div>
      <div style={SECTION_BOX}>
        <div style={EDGE_GRID}>
          {SURFACE_MATCH_G2_EDGES.map((e) => (
            <button key={e}
                    type="button"
                    onClick={() => setTgtEdge(e)}
                    data-testid={`forge-surface-match-g2-tgt-edge-${e}`}
                    style={EDGE_BTN(tgtEdge === e)}>
              {e}
            </button>
          ))}
        </div>
      </div>

      <div style={SECTION_TITLE}>Verification samples</div>
      <div style={SECTION_BOX}>
        <div style={SLIDER_ROW}>
          <input type="range"
                 min={SURFACE_MATCH_G2_MIN_SAMPLES}
                 max={SURFACE_MATCH_G2_MAX_SAMPLES}
                 step={1}
                 value={samples}
                 onChange={onChangeSamples}
                 data-testid="forge-surface-match-g2-samples-slider" />
          <input type="number"
                 min={SURFACE_MATCH_G2_MIN_SAMPLES}
                 max={SURFACE_MATCH_G2_MAX_SAMPLES}
                 step={1}
                 value={samples}
                 onChange={onChangeSamples}
                 data-testid="forge-surface-match-g2-samples-input"
                 style={NUM_INPUT_STYLE} />
        </div>
      </div>

      {!inputValidation.ok && (
        <div data-testid="forge-surface-match-g2-input-err"
             style={ERR_BOX}>
          input invalid: {inputValidation.reason}
        </div>
      )}

      <div style={SECTION_TITLE}>Action</div>
      <div style={SECTION_BOX}>
        <button type="button"
                onClick={onMatch}
                disabled={busy || !inputValidation.ok}
                data-testid="forge-surface-match-g2-match"
                style={ACTION_BTN('primary', busy || !inputValidation.ok)}>
          {busy ? 'Matching…' : 'Match G2 (solve target rows 0/1/2)'}
        </button>
        {error && (
          <div data-testid="forge-surface-match-g2-error"
               style={ERR_BOX}>
            match failed: {error}
          </div>
        )}
      </div>

      {result && (
        <>
          <div style={SECTION_TITLE}>Pre-match deviation</div>
          <div style={SECTION_BOX}>
            <div style={CHIP_ROW}>
              <span data-testid="forge-surface-match-g2-pre-g0-max"
                    style={CHIP(result.beforeMetrics.g0Pass ? 'ok' : 'err')}>
                <span style={CHIP_LABEL}>G0 max (mm)</span>
                <span>{fmt(result.beforeMetrics.g0Max, 6)}</span>
              </span>
              <span data-testid="forge-surface-match-g2-pre-g1-max"
                    style={CHIP(result.beforeMetrics.g1Pass ? 'ok' : 'err')}>
                <span style={CHIP_LABEL}>G1 max (°)</span>
                <span>{fmt(result.beforeMetrics.normalDevMaxDeg, 4)}</span>
              </span>
              <span data-testid="forge-surface-match-g2-pre-g2-mean"
                    style={CHIP(result.beforeMetrics.g2Pass ? 'ok' : 'err')}>
                <span style={CHIP_LABEL}>G2 H max</span>
                <span>{fmt(result.beforeMetrics.meanCurvMaxDelta, 6)}</span>
              </span>
              <span data-testid="forge-surface-match-g2-pre-g2-k1"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>κ1 max</span>
                <span>{fmt(result.beforeMetrics.princCurv1MaxDelta, 6)}</span>
              </span>
              <span data-testid="forge-surface-match-g2-pre-g2-k2"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>κ2 max</span>
                <span>{fmt(result.beforeMetrics.princCurv2MaxDelta, 6)}</span>
              </span>
            </div>
          </div>

          <div style={SECTION_TITLE}>Post-match deviation</div>
          <div style={SECTION_BOX}>
            <div style={CHIP_ROW}>
              <span data-testid="forge-surface-match-g2-post-g0-max"
                    style={CHIP(result.afterMetrics.g0Pass ? 'ok' : 'err')}>
                <span style={CHIP_LABEL}>G0 max (mm)</span>
                <span>{fmt(result.afterMetrics.g0Max, 6)}</span>
              </span>
              <span data-testid="forge-surface-match-g2-post-g1-max"
                    style={CHIP(result.afterMetrics.g1Pass ? 'ok' : 'err')}>
                <span style={CHIP_LABEL}>G1 max (°)</span>
                <span>{fmt(result.afterMetrics.normalDevMaxDeg, 6)}</span>
              </span>
              <span data-testid="forge-surface-match-g2-post-g2-mean"
                    style={CHIP(result.afterMetrics.g2Pass ? 'ok' : 'err')}>
                <span style={CHIP_LABEL}>G2 H max</span>
                <span>{fmt(result.afterMetrics.meanCurvMaxDelta, 6)}</span>
              </span>
              <span data-testid="forge-surface-match-g2-post-g2-k1"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>κ1 max</span>
                <span>{fmt(result.afterMetrics.princCurv1MaxDelta, 6)}</span>
              </span>
              <span data-testid="forge-surface-match-g2-post-g2-k2"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>κ2 max</span>
                <span>{fmt(result.afterMetrics.princCurv2MaxDelta, 6)}</span>
              </span>
              <span data-testid="forge-surface-match-g2-post-tangent-cross"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>tangent⊥</span>
                <span>{fmt(result.afterMetrics.tangentCrossMaxDeg, 4)}°</span>
              </span>
            </div>
            <div style={{ fontSize: 9, color: 'var(--forge-ink-mute, #9aa1ab)',
                          fontFamily: 'var(--forge-mono, ui-monospace, monospace)' }}>
              Solver: P_{`{i,0}`} = R · P_{`{i,1}`} = P0 + ∂R/∂v/m ·
              P_{`{i,2}`} = 2·P1 − P0 + ∂²R/∂v²/(m·(m−1)).
              Anchors at u_i = i/n, i ∈ [0..{result.n_boundary}].
            </div>
          </div>

          <div style={SECTION_TITLE}>Edited rows</div>
          <div style={SECTION_BOX}
               data-testid="forge-surface-match-g2-rows-list"
               data-row-count={result.edited.row0.length}>
            {[0, 1, 2].map((rIdx) => (
              <div key={rIdx} style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
                fontSize: 9,
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
                paddingBottom: 4,
              }}>
                <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>
                  row {rIdx} ({rIdx === 0 ? 'G0' : rIdx === 1 ? 'G1' : 'G2'})
                </div>
                {(rIdx === 0 ? result.edited.row0
                  : rIdx === 1 ? result.edited.row1
                  : result.edited.row2).map((p, i) => (
                  <div key={i}
                       data-testid={`forge-surface-match-g2-row-${rIdx}-${i}`}>
                    P_{`{${i}, ${rIdx}}`}: [{p[0].toFixed(2)}, {p[1].toFixed(2)}, {p[2].toFixed(2)}]
                  </div>
                ))}
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
        Tensor-product Bezier S(u,v) · De Casteljau partial derivatives ·
        G0+G1+G2 back-solve of target's first 3 cross-boundary control
        rows · principal-curvature verifier.
      </div>

    </aside>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host.

export function SurfaceMatchG2PanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenSurfaceMatchG2 =
      (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseSurfaceMatchG2 = () => setOpen(false);

    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.surfaceMatchG2') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenSurfaceMatchG2; } catch {}
      try { delete window.__forgeCloseSurfaceMatchG2; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  return <SurfaceMatchG2Panel open={open} onClose={() => setOpen(false)} />;
}

export default SurfaceMatchG2PanelHost;
