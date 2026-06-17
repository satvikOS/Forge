// PUSH-212 (Slice-162) — G3 Curve Match panel.
//
// Class-A surfacing primitive: pick a reference curve (the "left side")
// and a target Bezier curve (the "right side") and adjust the leading
// control points of the target so it joins the reference end-to-start
// with G3 continuity (position + tangent + curvature + curvature derivative).
//
// Surface contract:
//   * Ref picker  — switch between 3 known references (cubic Bezier /
//                   quintic Bezier / circular arc on the XY plane).
//   * Target picker — cubic or quintic Bezier with arbitrary leading
//                     P_1..P_3 (the math file forces them to the G3
//                     solution; the remaining controls stay free).
//   * "Match G3" — solve, publish a result payload to
//                  window.__forgeCurveMatchG3Last + dispatch
//                  forge:curve-match-g3-built. Surface pre/post
//                  G3 deviation chips + per-control delta list.
//   * Real validation: degree-too-low target → real error, not a fake
//                      solution.
//
// Window surface:
//   * window.__forgeOpenCurveMatchG3(true|false)
//   * window.__forgeCloseCurveMatchG3()
//   * window.__forgeCurveMatchG3Helper           — math surface
//   * window.__forgeCurveMatchG3Last             — last result
//
// Headed event: `forge:curve-match-g3-built` with the result payload.
//
// Multi-cam e2e mandate honoured by push-212-curve-match-g3.spec.js.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  CURVE_MATCH_G3_EVENT,
  CURVE_MATCH_G3_STORAGE,
  CURVE_MATCH_G3_MIN_DEGREE,
  CURVE_MATCH_G3_MAX_REF_DEGREE,
  CURVE_MATCH_G3_TOL,
  matchG3,
  makeCurveMatchG3Helper,
} from './curveMatchG3Math.js';

export {
  CURVE_MATCH_G3_EVENT,
  CURVE_MATCH_G3_STORAGE,
  CURVE_MATCH_G3_MIN_DEGREE,
  CURVE_MATCH_G3_MAX_REF_DEGREE,
  CURVE_MATCH_G3_TOL,
};

// ─────────────────────────────────────────────────────────────────────
// Pre-canned reference + target presets — used by the panel's drop-downs
// and the e2e to drive predictable inputs.

export const CURVE_MATCH_G3_REF_PRESETS = Object.freeze({
  cubicBezier: {
    label: 'Cubic Bezier (4 controls)',
    build: () => ({
      type: 'bezier',
      controls: [
        [0, 0, 0],
        [10, 20, 0],
        [30, 20, 10],
        [40, 0, 10],
      ],
    }),
  },
  quinticBezier: {
    label: 'Quintic Bezier (6 controls)',
    build: () => ({
      type: 'bezier',
      controls: [
        [0, 0, 0],
        [5, 15, 0],
        [15, 30, 5],
        [25, 30, 10],
        [35, 15, 10],
        [40, 0, 10],
      ],
    }),
  },
  arcXY: {
    label: 'Circular Arc (R=20, XY, 90°)',
    build: () => ({
      type: 'arc',
      center: [0, 0, 0],
      radius: 20,
      axisU: [1, 0, 0],
      axisV: [0, 1, 0],
      thetaStart: 0,
      thetaEnd: Math.PI / 2,
    }),
  },
});

export const CURVE_MATCH_G3_TARGET_PRESETS = Object.freeze({
  cubicArbitrary: {
    label: 'Cubic Bezier — arbitrary controls',
    build: () => [
      [100, 0, 0],
      [110, 5, 0],
      [120, 0, 5],
      [130, -5, 5],
    ],
  },
  quinticArbitrary: {
    label: 'Quintic Bezier — arbitrary controls',
    build: () => [
      [100, 0, 0],
      [110, 5, 0],
      [120, 0, 5],
      [130, -5, 5],
      [140, -10, 5],
      [150, -15, 5],
    ],
  },
  degenerateLinear: {
    label: 'Linear (degree 1) — degenerate',
    build: () => [
      [100, 0, 0],
      [110, 0, 0],
    ],
  },
});

// ─────────────────────────────────────────────────────────────────────
// Install the helper API as soon as the module is imported.

if (typeof window !== 'undefined') {
  try {
    window.__forgeCurveMatchG3Helper = makeCurveMatchG3Helper();
    window.__forgeCurveMatchG3RefPresets = CURVE_MATCH_G3_REF_PRESETS;
    window.__forgeCurveMatchG3TargetPresets = CURVE_MATCH_G3_TARGET_PRESETS;
  } catch { /* fail soft */ }
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail, same dim language as PUSH-208 / 213.

const PANEL_W = 460;
const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: PANEL_W,
  zIndex: 1339,
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
const SELECT_STYLE = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '4px 6px', borderRadius: 3, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  width: '100%', boxSizing: 'border-box',
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
const DELTA_ROW = {
  display: 'grid',
  gridTemplateColumns: '28px 1fr 80px',
  gap: 4,
  alignItems: 'center',
  fontSize: 10,
  padding: '2px 4px',
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
};
const FOOTER_NOTE = {
  marginTop: 'auto',
  fontSize: 10,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  lineHeight: 1.5,
};

// ─────────────────────────────────────────────────────────────────────
// Format helpers.

function fmtNum(v, digits = 6) {
  if (!Number.isFinite(v)) return 'NaN';
  if (Math.abs(v) < 1e-12) return '0';
  if (Math.abs(v) < 1e-3 || Math.abs(v) >= 1e6) {
    return v.toExponential(digits - 1);
  }
  return v.toFixed(digits);
}

function describeRef(refCurve) {
  if (!refCurve) return '(none)';
  if (refCurve.type === 'bezier') {
    return `Bezier (deg ${refCurve.controls.length - 1})`;
  }
  if (refCurve.type === 'polyline') {
    return `Polyline (${refCurve.points.length} pts)`;
  }
  if (refCurve.type === 'arc') {
    return `Arc R=${refCurve.radius}`;
  }
  return `(${refCurve.type})`;
}

function describeTarget(controls) {
  if (!Array.isArray(controls)) return '(none)';
  return `Bezier (deg ${controls.length - 1}, ${controls.length} controls)`;
}

// ─────────────────────────────────────────────────────────────────────
// Panel.

export function CurveMatchG3Panel({ open, onClose }) {
  const [refPresetKey, setRefPresetKey] = useState('cubicBezier');
  const [targetPresetKey, setTargetPresetKey] = useState('cubicArbitrary');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const refCurve = useMemo(
    () => CURVE_MATCH_G3_REF_PRESETS[refPresetKey].build(),
    [refPresetKey],
  );
  const targetControlPoints = useMemo(
    () => CURVE_MATCH_G3_TARGET_PRESETS[targetPresetKey].build(),
    [targetPresetKey],
  );

  // Reset on close.
  useEffect(() => {
    if (!open) {
      setError(null);
      setBusy(false);
    }
  }, [open]);

  const onMatch = useCallback(() => {
    setBusy(true);
    setError(null);
    // Yield one frame so the busy pill renders before the (fast) solve.
    setTimeout(() => {
      try {
        const r = matchG3({
          refCurve,
          targetControlPoints,
        });
        if (!r.ok) {
          setError(r.error || 'unknown match failure');
          setResult(null);
          if (typeof window !== 'undefined') {
            try {
              window.__forgeCurveMatchG3Last = { ok: false, error: r.error };
              window.dispatchEvent(new CustomEvent(CURVE_MATCH_G3_EVENT, {
                detail: { ok: false, error: r.error },
              }));
            } catch {}
          }
          return;
        }
        setResult(r);
        if (typeof window !== 'undefined') {
          // Strip giant arrays into plain summaries for the window mirror.
          const summary = {
            ok: true,
            refPreset: refPresetKey,
            targetPreset: targetPresetKey,
            targetDegree: r.targetDegree,
            controls: r.controls.map((p) => p.slice()),
            originalControls: r.originalControls.map((p) => p.slice()),
            deltas: r.deltas.map((d) => ({
              index: d.index,
              from: d.from.slice(),
              to: d.to.slice(),
              delta: d.delta.slice(),
              deltaMag: d.deltaMag,
            })),
            pre: {
              g0: r.pre.g0Deviation,
              g1: r.pre.g1Deviation,
              g2: r.pre.g2Deviation,
              g3: r.pre.g3Deviation,
              g2Rel: r.pre.g2RelDeviation,
              g3Rel: r.pre.g3RelDeviation,
              curvature: r.pre.frenet.curvature,
              curvatureDeriv: r.pre.frenet.curvatureDeriv,
            },
            post: {
              g0: r.post.g0Deviation,
              g1: r.post.g1Deviation,
              g2: r.post.g2Deviation,
              g3: r.post.g3Deviation,
              g2Rel: r.post.g2RelDeviation,
              g3Rel: r.post.g3RelDeviation,
              curvature: r.post.frenet.curvature,
              curvatureDeriv: r.post.frenet.curvatureDeriv,
            },
            ref: {
              curvature: r.report.ref.curvature,
              curvatureDeriv: r.report.ref.curvatureDeriv,
              point: r.report.ref.point.slice(),
              tangent: r.report.ref.tangent.slice(),
            },
            improvement: r.report.improvement,
            achieved: { ...r.report.achieved },
            ts: Date.now(),
          };
          window.__forgeCurveMatchG3Last = summary;
          try {
            window.dispatchEvent(new CustomEvent(CURVE_MATCH_G3_EVENT, {
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
    }, 30);
  }, [refCurve, targetControlPoints, refPresetKey, targetPresetKey]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <aside role="region"
           aria-label="G3 Curve Match panel"
           data-testid="forge-curve-match-g3-panel"
           data-ref-preset={refPresetKey}
           data-target-preset={targetPresetKey}
           data-target-degree={targetControlPoints.length - 1}
           data-last-g3-pre={result ? result.pre.g3Deviation : ''}
           data-last-g3-post={result ? result.post.g3Deviation : ''}
           data-last-achieved-g3={result ? (result.report.achieved.g3 ? '1' : '0') : ''}
           style={PANEL_STYLE}>

      <div style={HEADER_ROW}>
        <strong style={{ flex: 1 }}>
          G3 Curve Match · Class-A
        </strong>
        <span data-testid="forge-curve-match-g3-status"
              style={STATUS_PILL(
                error ? 'err'
                : busy ? 'mute'
                : result ? (result.report.achieved.g3 ? 'ok' : 'mute')
                : 'mute')}>
          {error ? 'error'
            : busy ? 'busy'
            : result ? (result.report.achieved.g3 ? 'G3 ok' : 'G3 warn')
            : 'idle'}
        </span>
        <button type="button"
                onClick={onClose}
                aria-label="Close G3 Curve Match panel"
                data-testid="forge-curve-match-g3-close"
                style={CLOSE_BTN}>
          ×
        </button>
      </div>

      <div style={SECTION_TITLE}>Reference curve</div>
      <div style={SECTION_BOX}>
        <select value={refPresetKey}
                onChange={(e) => setRefPresetKey(e.target.value)}
                data-testid="forge-curve-match-g3-ref-picker"
                style={SELECT_STYLE}>
          {Object.entries(CURVE_MATCH_G3_REF_PRESETS).map(([key, p]) => (
            <option key={key} value={key}>{p.label}</option>
          ))}
        </select>
        <div style={{
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
        }}>
          {describeRef(refCurve)}
        </div>
      </div>

      <div style={SECTION_TITLE}>Target curve (degree ≥ 3)</div>
      <div style={SECTION_BOX}>
        <select value={targetPresetKey}
                onChange={(e) => setTargetPresetKey(e.target.value)}
                data-testid="forge-curve-match-g3-target-picker"
                style={SELECT_STYLE}>
          {Object.entries(CURVE_MATCH_G3_TARGET_PRESETS).map(([key, p]) => (
            <option key={key} value={key}>{p.label}</option>
          ))}
        </select>
        <div style={{
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
        }}>
          {describeTarget(targetControlPoints)}
        </div>
      </div>

      <div style={SECTION_TITLE}>Action</div>
      <div style={SECTION_BOX}>
        <button type="button"
                onClick={onMatch}
                disabled={busy}
                data-testid="forge-curve-match-g3-match"
                style={ACTION_BTN('primary', busy)}>
          {busy ? 'Solving…' : 'Match G3 · solve + report'}
        </button>
        {error && (
          <div data-testid="forge-curve-match-g3-error" style={ERR_BOX}>
            match failed: {error}
          </div>
        )}
      </div>

      {result && (
        <>
          <div style={SECTION_TITLE}>Continuity deviation (pre → post)</div>
          <div style={SECTION_BOX}>
            <div style={CHIP_ROW}>
              <span data-testid="forge-curve-match-g3-chip-pre-g0"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>Pre G0</span>
                <span>{fmtNum(result.pre.g0Deviation, 4)}</span>
              </span>
              <span data-testid="forge-curve-match-g3-chip-post-g0"
                    style={CHIP(result.report.achieved.g0 ? 'ok' : 'err')}>
                <span style={CHIP_LABEL}>Post G0</span>
                <span>{fmtNum(result.post.g0Deviation, 4)}</span>
              </span>
              <span data-testid="forge-curve-match-g3-chip-pre-g1"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>Pre G1 (°)</span>
                <span>{fmtNum(result.pre.g1Deviation, 4)}</span>
              </span>
              <span data-testid="forge-curve-match-g3-chip-post-g1"
                    style={CHIP(result.report.achieved.g1 ? 'ok' : 'err')}>
                <span style={CHIP_LABEL}>Post G1 (°)</span>
                <span>{fmtNum(result.post.g1Deviation, 4)}</span>
              </span>
              <span data-testid="forge-curve-match-g3-chip-pre-g2"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>Pre G2</span>
                <span>{fmtNum(result.pre.g2Deviation, 4)}</span>
              </span>
              <span data-testid="forge-curve-match-g3-chip-post-g2"
                    style={CHIP(result.report.achieved.g2 ? 'ok' : 'err')}>
                <span style={CHIP_LABEL}>Post G2</span>
                <span>{fmtNum(result.post.g2Deviation, 4)}</span>
              </span>
              <span data-testid="forge-curve-match-g3-chip-pre-g3"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>Pre G3</span>
                <span>{fmtNum(result.pre.g3Deviation, 4)}</span>
              </span>
              <span data-testid="forge-curve-match-g3-chip-post-g3"
                    style={CHIP(result.report.achieved.g3 ? 'ok' : 'err')}>
                <span style={CHIP_LABEL}>Post G3</span>
                <span>{fmtNum(result.post.g3Deviation, 4)}</span>
              </span>
              <span data-testid="forge-curve-match-g3-chip-improvement"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>Improvement ×</span>
                <span>{fmtNum(result.report.improvement, 4)}</span>
              </span>
              <span data-testid="forge-curve-match-g3-chip-target-degree"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>Target degree</span>
                <span>{result.targetDegree}</span>
              </span>
            </div>
          </div>

          <div style={SECTION_TITLE}>Reference Frenet readout (at join)</div>
          <div style={SECTION_BOX}>
            <div style={CHIP_ROW}>
              <span data-testid="forge-curve-match-g3-chip-ref-curvature"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>κ_ref</span>
                <span>{fmtNum(result.report.ref.curvature, 6)}</span>
              </span>
              <span data-testid="forge-curve-match-g3-chip-ref-curvature-deriv"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>κ′_ref</span>
                <span>{fmtNum(result.report.ref.curvatureDeriv, 6)}</span>
              </span>
              <span data-testid="forge-curve-match-g3-chip-post-curvature"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>κ_target</span>
                <span>{fmtNum(result.post.frenet.curvature, 6)}</span>
              </span>
              <span data-testid="forge-curve-match-g3-chip-post-curvature-deriv"
                    style={CHIP('mute')}>
                <span style={CHIP_LABEL}>κ′_target</span>
                <span>{fmtNum(result.post.frenet.curvatureDeriv, 6)}</span>
              </span>
            </div>
          </div>

          <div style={SECTION_TITLE}>Control-point delta vectors</div>
          <div style={SECTION_BOX}
               data-testid="forge-curve-match-g3-delta-list">
            {result.deltas.map((d) => (
              <div key={d.index} style={DELTA_ROW}
                   data-testid={`forge-curve-match-g3-delta-${d.index}`}
                   data-control-index={d.index}
                   data-delta-mag={d.deltaMag}>
                <span>{d.index.toString().padStart(2, '0')}</span>
                <span>
                  ({d.from.map((v) => v.toFixed(2)).join(', ')}) →
                  ({d.to.map((v) => v.toFixed(2)).join(', ')})
                </span>
                <span style={{
                  textAlign: 'right',
                  color: d.deltaMag > 1e-9
                    ? 'var(--forge-accent, #4f87ff)'
                    : 'var(--forge-ink-mute, #9aa1ab)',
                }}>
                  |Δ| {fmtNum(d.deltaMag, 3)}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div style={FOOTER_NOTE}>
        G0 + G1 + G2 + G3 join: P_0..P_3 of target Bezier solved by matching
        position + 1st + 2nd + 3rd derivative against the reference at u=1.
        De Casteljau + Frenet — Class-A parity with Alias / ICEM.
      </div>

    </aside>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host.

export function CurveMatchG3PanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenCurveMatchG3 = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseCurveMatchG3 = () => setOpen(false);

    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.curveMatchG3') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenCurveMatchG3; } catch {}
      try { delete window.__forgeCloseCurveMatchG3; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  return <CurveMatchG3Panel open={open} onClose={() => setOpen(false)} />;
}

export default CurveMatchG3PanelHost;
