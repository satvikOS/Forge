// Forge-93 — Surfacing Panel.
//
// Right-anchored 360 px drawer exposing every window.forge.surfacing.*
// operation:
//   • buildPatch(grid, uDegree, vDegree, uKnots, vKnots) → faceHandle
//   • trim(face, uvFlat)
//   • sew(faces, tolerance)
//   • refine(face, uTimes, vTimes)
//   • eval(face, u, v)
//   • intersect(faceA, faceB) → curveSegments
//   • projectPoint(face, pt) → uvAndPoint
//   • classAAnalyse(face, samples) → continuity report
//
// buildPatch supports two input modes:
//   • JSON: a 2-D array of control points (default).
//   • Interactive picker: a u × v point grid the user clicks in 3D —
//     the panel collects screen-space picks via window.__forgeProbePick
//     until the grid is full, then submits.
//
// classAAnalyse, when run, asks the renderer to switch the face into a
// shading mode that visualises the continuity report. We expose two
// styles — zebra-stripe and Gaussian-curvature — via
// window.__forgeSetSurfaceShading({ faceId, mode, report }). The panel
// dispatches whichever mode the user picked.
//
// Manual clicks NEVER write to Archie's thread.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons/Icon.jsx';
import { showToast } from './Toast.jsx';
import {
  SURFACING_OPS,
  isForgeReady,
  PANEL_EVENT,
} from './directHealSurfDispatch.js';
import {
  SURFACING_V4_OPS,
  SURFACING_V4_GROUPS,
  dispatchAnalysis,
} from './surfacingDispatch.js';

const panelStyle = {
  position: 'fixed',
  right: 0,
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  bottom: 0,
  width: 420,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-edge, var(--forge-rail-edge))',
  padding: 'var(--forge-space-3)',
  zIndex: 1300,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)',
  font: 'inherit',
  fontSize: 12,
  overflow: 'hidden',
};

// Group icon mapping for the four CATIA-GSD categories.
const GROUP_ICON = {
  'Curve Tools':   'sketch.spline',
  'Surface Tools': 'sketch.rect',
  'Operations':   'sketch.trim',
  'Analysis':     'sketch.constrain',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--forge-space-2)',
  paddingBottom: 'var(--forge-space-2)',
  borderBottom: '1px solid var(--forge-rail-edge)',
  fontWeight: 600,
};

const opBtnStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 10px',
  background: 'var(--forge-surface)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius)',
  color: 'var(--forge-ink)',
  cursor: 'pointer',
  textAlign: 'left',
  font: 'inherit',
  fontSize: 12,
};

function defaultValuesFor(signature) {
  const v = {};
  for (const f of signature) {
    v[f.id] = (typeof structuredClone === 'function')
      ? structuredClone(f.default)
      : JSON.parse(JSON.stringify(f.default));
  }
  return v;
}

function buildArgs(signature, values) {
  return signature.map((f) => values[f.id]);
}

// V4 ops take a single params object; their fn signature is fn(params).
// Build that object straight from the form values keyed by id.
function buildParamsObject(signature, values) {
  const o = {};
  for (const f of signature) o[f.id] = values[f.id];
  return o;
}

function readViewportSelection() {
  if (typeof window === 'undefined') return null;
  const s = window.__forgeSelection;
  if (!s || typeof s !== 'object') return null;
  if (!s.kind || s.kind === 'none') return null;
  return s;
}

// Apply class-A shading via the viewport's hook. Falls back to a toast
// if the hook isn't wired (dev shell without the surface shading
// path).
function applyClassAShading(faceId, mode, report) {
  if (typeof window === 'undefined') return false;
  if (typeof window.__forgeSetSurfaceShading !== 'function') return false;
  try {
    window.__forgeSetSurfaceShading({ faceId, mode, report });
    return true;
  } catch (err) {
    console.warn('[forge.v4.surfacing] class-A shading hook threw', err);
    return false;
  }
}

// ────────── shared Field renderer (int / slider / vec3 / json) ──────────
function Field({ field, value, onChange }) {
  const inputStyle = {
    width: '100%',
    background: 'var(--forge-canvas)',
    border: '1px solid var(--forge-rail-edge)',
    borderRadius: 3,
    color: 'var(--forge-ink)',
    font: 'inherit',
    fontSize: 12,
    padding: '4px 6px',
  };
  if (field.kind === 'int' || field.kind === 'number') {
    return (
      <input type="number" step={field.kind === 'int' ? 1 : 0.001}
             value={value ?? 0}
             onChange={(e) => onChange(
               field.kind === 'int'
                 ? (parseInt(e.target.value, 10) || 0)
                 : (parseFloat(e.target.value) || 0))}
             style={inputStyle}
             data-test-field={field.id} />
    );
  }
  if (field.kind === 'slider') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <input type="range"
               min={field.min} max={field.max} step={field.step}
               value={value ?? field.default}
               onChange={(e) => onChange(parseFloat(e.target.value))}
               style={{ flex: 1 }}
               data-test-field={field.id} />
        <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                       color: 'var(--forge-ink-2)', minWidth: 56,
                       textAlign: 'right' }}>
          {Number(value ?? field.default).toFixed(4)}{field.unit ? ` ${field.unit}` : ''}
        </span>
      </div>
    );
  }
  if (field.kind === 'vec3') {
    const arr = Array.isArray(value) ? value : [0, 0, 0];
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        {[0, 1, 2].map((i) => (
          <input key={i} type="number" step={0.1}
                 value={arr[i] ?? 0}
                 onChange={(e) => {
                   const next = [...arr];
                   next[i] = parseFloat(e.target.value) || 0;
                   onChange(next);
                 }}
                 style={{ ...inputStyle, padding: '3px 4px', textAlign: 'right' }}
                 data-test-field={`${field.id}.${i}`}
                 aria-label={`${field.label} ${'XYZ'[i]}`} />
        ))}
      </div>
    );
  }
  if (field.kind === 'json') {
    const text = (() => {
      try { return JSON.stringify(value, null, 2); }
      catch { return String(value); }
    })();
    return (
      <textarea value={text}
                onChange={(e) => {
                  try { onChange(JSON.parse(e.target.value)); }
                  catch { /* keep raw — user mid-edit */ }
                }}
                rows={Math.min(10, Math.max(3, text.split('\n').length))}
                style={{ ...inputStyle, fontFamily: 'var(--forge-mono)',
                         fontSize: 11, resize: 'vertical' }}
                data-test-field={field.id} />
    );
  }
  return null;
}

// ────────── interactive picker for buildPatch ──────────
function InteractivePicker({ rows, cols, onDone, onCancel }) {
  const [picks, setPicks] = useState([]);
  const need = rows * cols;
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onPick = (e) => {
      if (!e?.detail) return;
      const pt = e.detail.point;
      if (!pt || !Array.isArray(pt) || pt.length !== 3) return;
      setPicks((p) => {
        if (p.length >= need) return p;
        return [...p, pt];
      });
    };
    window.addEventListener('forge:probe-pick', onPick);
    // Also expose an imperative push for tests / Archie.
    window.__forgePushPatchPoint = (pt) => {
      window.dispatchEvent(new CustomEvent('forge:probe-pick', { detail: { point: pt } }));
    };
    return () => {
      window.removeEventListener('forge:probe-pick', onPick);
      delete window.__forgePushPatchPoint;
    };
  }, [need]);

  useEffect(() => {
    if (picks.length === need) {
      // Pack into rows × cols grid
      const grid = [];
      for (let r = 0; r < rows; r++) {
        const row = [];
        for (let c = 0; c < cols; c++) row.push(picks[r * cols + c]);
        grid.push(row);
      }
      onDone(grid);
    }
  }, [picks, need, rows, cols, onDone]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6,
                  padding: 8, background: 'var(--forge-surface)',
                  borderRadius: 3, fontSize: 11 }}>
      <div>
        Pick {need} points in the viewport — {picks.length}/{need} collected.
      </div>
      <div style={{ fontFamily: 'var(--forge-mono)', fontSize: 10,
                    color: 'var(--forge-ink-mute)' }}>
        Grid: {rows} × {cols}
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button type="button"
                onClick={onCancel}
                style={{ flex: 1, background: 'var(--forge-canvas)',
                         border: '1px solid var(--forge-rail-edge)',
                         borderRadius: 3, color: 'var(--forge-ink)',
                         font: 'inherit', fontSize: 11, padding: '4px 8px',
                         cursor: 'pointer' }}>
          Cancel
        </button>
        <button type="button"
                disabled={picks.length === 0}
                onClick={() => setPicks((p) => p.slice(0, -1))}
                style={{ flex: 1, background: 'var(--forge-canvas)',
                         border: '1px solid var(--forge-rail-edge)',
                         borderRadius: 3, color: 'var(--forge-ink)',
                         font: 'inherit', fontSize: 11, padding: '4px 8px',
                         cursor: picks.length ? 'pointer' : 'not-allowed' }}>
          Undo last
        </button>
      </div>
    </div>
  );
}

// ────────── per-op dialog ──────────
function OpDialog({ op, onClose, onResult, selection }) {
  const [values, setValues] = useState(() => defaultValuesFor(op.signature));
  const [pickerOpen, setPickerOpen] = useState(false);
  // For buildPatch, the interactive picker derives rows × cols from the
  // current JSON default. Default is 3×3.
  const grid = values.grid;
  const rows = Array.isArray(grid) ? grid.length : 3;
  const cols = (Array.isArray(grid) && Array.isArray(grid[0])) ? grid[0].length : 3;

  useEffect(() => {
    if (!selection) return;
    setValues((v) => {
      const next = { ...v };
      if ('face' in next && selection.kind === 'face' && selection.ids?.[0] != null) {
        next.face = selection.ids[0];
      }
      if ('faceA' in next && selection.kind === 'face' && selection.ids?.[0] != null) {
        next.faceA = selection.ids[0];
      }
      if ('faceB' in next && selection.kind === 'face' && selection.ids?.[1] != null) {
        next.faceB = selection.ids[1];
      }
      return next;
    });
  }, [selection]);

  // Class-A analyse shading mode picker.
  const [classAMode, setClassAMode] = useState('zebra');

  const submit = useCallback(() => {
    if (!isForgeReady()) {
      showToast({ kind: 'warn',
                  text: 'window.forge not loaded — surfacing ops unavailable',
                  ttl: 3500 });
      onClose();
      return;
    }
    // V4 ops take a single params object; legacy ops take positional args.
    const r = op.v4
      ? op.fn(buildParamsObject(op.signature, values))
      : op.fn(...buildArgs(op.signature, values));
    let extra = null;
    if (op.id === 'classAAnalyse' && r.ok) {
      const ok = applyClassAShading(values.face, classAMode, r.result);
      extra = ok ? `shading:${classAMode}` : 'shading hook unavailable';
      if (!ok) {
        showToast({ kind: 'warn',
                    text: 'Class-A shading hook unavailable — report only',
                    ttl: 2500 });
      }
    }
    // V4 analysis ops broadcast their result so SurfaceAnalysisOverlay
    // can visualise it. The overlay listens to forge:surface-analysis.
    if (op.v4 && op.group === 'Analysis' && r.ok) {
      dispatchAnalysis({ kind: r.result?.kind || op.id, op: op.id,
                          face: values.face ?? values.faceA, result: r.result });
      extra = `analysis:${r.result?.kind || op.id}`;
    }
    onResult({
      ts: Date.now(),
      id: op.id,
      label: op.label,
      ok: r.ok,
      payload: r.ok ? r.result : `${r.reason || 'error'}${r.message ? ' · ' + r.message : ''}`,
      extra,
    });
    if (!r.ok) {
      showToast({ kind: 'warn', text: `${op.label} failed: ${r.reason || 'error'}`, ttl: 3000 });
    } else {
      showToast({ kind: 'ok', text: `${op.label} ok`, ttl: 1500 });
    }
    onClose();
  }, [op, values, onResult, onClose, classAMode]);

  return (
    <div role="dialog"
         aria-label={`${op.label} dialog`}
         data-testid="forge-surfacing-dialog"
         style={{
           position: 'absolute',
           inset: 'var(--forge-space-2)',
           background: 'var(--forge-canvas-3)',
           border: '1px solid var(--forge-rail-edge)',
           borderRadius: 'var(--forge-radius-lg)',
           boxShadow: '0 12px 36px rgba(0,0,0,0.55)',
           display: 'flex',
           flexDirection: 'column',
           padding: 'var(--forge-space-3)',
           gap: 8,
           overflowY: 'auto',
           zIndex: 1,
         }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ flex: 1 }}>{op.label}</strong>
        <button type="button" onClick={onClose} aria-label="Close dialog"
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink-mute)', cursor: 'pointer',
                         display: 'inline-flex', padding: 2 }}>
          <Icon name="select.clear" size={12} />
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)',
                    fontFamily: 'var(--forge-mono)' }}>
        {selection
          ? `Selection: ${selection.kind} × ${selection.ids?.length ?? 0}`
          : 'No viewport selection — type face handles manually.'}
      </div>

      {op.id === 'buildPatch' && (
        <div style={{ display: 'flex', gap: 6 }}>
          <button type="button"
                  data-testid="forge-surfacing-pick-grid"
                  onClick={() => setPickerOpen(true)}
                  style={{ flex: 1, background: 'var(--forge-surface)',
                           border: '1px solid var(--forge-rail-edge)',
                           borderRadius: 3, color: 'var(--forge-ink)',
                           font: 'inherit', fontSize: 11, padding: '4px 8px',
                           cursor: 'pointer' }}>
            Pick grid in viewport
          </button>
        </div>
      )}
      {pickerOpen && (
        <InteractivePicker rows={rows} cols={cols}
                           onDone={(g) => {
                             setValues((v) => ({ ...v, grid: g }));
                             setPickerOpen(false);
                           }}
                           onCancel={() => setPickerOpen(false)} />
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {op.signature.map((f) => (
          <label key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase',
                           letterSpacing: '0.06em',
                           color: 'var(--forge-ink-mute)' }}>
              {f.label}
            </span>
            <Field field={f}
                   value={values[f.id]}
                   onChange={(v) => setValues((s) => ({ ...s, [f.id]: v }))} />
          </label>
        ))}
      </div>

      {op.id === 'classAAnalyse' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={{ fontSize: 10, textTransform: 'uppercase',
                         letterSpacing: '0.06em',
                         color: 'var(--forge-ink-mute)' }}>
            Shading mode
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            {[
              { id: 'zebra',   label: 'Zebra stripes' },
              { id: 'gauss',   label: 'Gaussian curvature' },
              { id: 'mean',    label: 'Mean curvature' },
              { id: 'isophote',label: 'Isophotes' },
            ].map((m) => (
              <button key={m.id}
                      type="button"
                      data-test-shading={m.id}
                      onClick={() => setClassAMode(m.id)}
                      data-active={String(classAMode === m.id)}
                      style={{ flex: 1,
                               background: classAMode === m.id
                                 ? 'var(--forge-accent-mute)'
                                 : 'var(--forge-canvas)',
                               border: classAMode === m.id
                                 ? '1px solid var(--forge-accent)'
                                 : '1px solid var(--forge-rail-edge)',
                               borderRadius: 3,
                               color: 'var(--forge-ink)',
                               font: 'inherit', fontSize: 10,
                               padding: '4px 6px', cursor: 'pointer' }}>
                {m.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button type="button"
                onClick={onClose}
                data-testid="forge-surfacing-dialog-cancel"
                style={{ flex: 1, background: 'var(--forge-surface)',
                         border: '1px solid var(--forge-rail-edge)',
                         borderRadius: 'var(--forge-radius)',
                         color: 'var(--forge-ink)',
                         font: 'inherit', fontSize: 12,
                         padding: '6px 10px', cursor: 'pointer' }}>
          Cancel
        </button>
        <button type="button"
                onClick={submit}
                data-testid="forge-surfacing-dialog-confirm"
                style={{ flex: 1,
                         background: 'var(--forge-accent-mute)',
                         border: '1px solid var(--forge-accent)',
                         borderRadius: 'var(--forge-radius)',
                         color: 'var(--forge-ink)',
                         font: 'inherit', fontSize: 12, fontWeight: 600,
                         padding: '6px 10px', cursor: 'pointer' }}>
          Apply
        </button>
      </div>
    </div>
  );
}

// ────────── continuity report block ──────────
function ContinuityReport({ report }) {
  if (!report) return null;
  const rows = [];
  if (typeof report.G0 === 'number') rows.push(['G0', report.G0.toFixed(4)]);
  if (typeof report.G1 === 'number') rows.push(['G1', report.G1.toFixed(4)]);
  if (typeof report.G2 === 'number') rows.push(['G2', report.G2.toFixed(4)]);
  if (typeof report.maxCurvature === 'number') rows.push(['Max κ', report.maxCurvature.toFixed(4)]);
  if (typeof report.minCurvature === 'number') rows.push(['Min κ', report.minCurvature.toFixed(4)]);
  if (Array.isArray(report.issues)) rows.push(['Issues', report.issues.length]);
  if (!rows.length) {
    rows.push(['raw', JSON.stringify(report).slice(0, 80)]);
  }
  return (
    <div data-testid="forge-surfacing-continuity"
         style={{ marginTop: 'var(--forge-space-2)',
                  borderTop: '1px solid var(--forge-rail-edge)',
                  paddingTop: 'var(--forge-space-2)',
                  display: 'flex', flexDirection: 'column', gap: 4,
                  fontFamily: 'var(--forge-mono)', fontSize: 11,
                  color: 'var(--forge-ink-2)' }}>
      <strong style={{ fontSize: 11, color: 'var(--forge-ink)',
                       fontFamily: 'var(--forge-font, inherit)' }}>
        Continuity report
      </strong>
      {rows.map(([k, v]) => (
        <div key={k} style={{ display: 'flex', gap: 6 }}>
          <span style={{ color: 'var(--forge-ink-mute)', minWidth: 60 }}>{k}</span>
          <span style={{ flex: 1 }}>{v}</span>
        </div>
      ))}
    </div>
  );
}

// ────────── category tab strip ──────────
// CATIA GSD-style four-tab navigation. Each tab is a section header in
// the scrolling op tree. The active tab is the section auto-expanded;
// clicking a different tab collapses the others. Mono-accent only.
function CategoryTabs({ tabs, active, onPick }) {
  return (
    <div role="tablist"
         data-testid="forge-surfacing-tabs"
         style={{ display: 'grid',
                  gridTemplateColumns: `repeat(${tabs.length}, 1fr)`,
                  gap: 2,
                  paddingBottom: 'var(--forge-space-2)',
                  borderBottom: '1px solid var(--forge-rail-edge)' }}>
      {tabs.map((t) => {
        const isOn = t === active;
        return (
          <button key={t}
                  type="button"
                  role="tab"
                  aria-selected={isOn ? 'true' : 'false'}
                  data-testid={`forge-surfacing-tab-${t.toLowerCase().replace(/\s+/g, '-')}`}
                  data-active={String(isOn)}
                  onClick={() => onPick(t)}
                  style={{ background: isOn ? 'var(--forge-accent-mute)' : 'transparent',
                           border: isOn ? '1px solid var(--forge-accent)' : '1px solid var(--forge-rail-edge)',
                           borderRadius: 'var(--forge-radius)',
                           color: 'var(--forge-ink)',
                           font: 'inherit',
                           fontSize: 10.5,
                           padding: '6px 4px',
                           cursor: 'pointer',
                           textAlign: 'center',
                           letterSpacing: '0.02em' }}>
            <Icon name={GROUP_ICON[t] || 'sketch.spline'} size={12} />
            <div style={{ marginTop: 2 }}>{t}</div>
          </button>
        );
      })}
    </div>
  );
}

// One op row.
function OpRow({ op, onPick }) {
  return (
    <button type="button"
            data-testid={`forge-surfacing-op-${op.id}`}
            data-surfacing-op={op.id}
            data-surfacing-group={op.group || 'Legacy'}
            onClick={() => onPick(op)}
            style={opBtnStyle}
            onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--forge-surface-2)'; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--forge-surface)'; }}>
      <Icon name={GROUP_ICON[op.group] || 'sketch.spline'} size={14} />
      <span style={{ flex: 1 }}>{op.label}</span>
      <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 10,
                     color: 'var(--forge-ink-mute)' }}>
        {op.kernel ? `surf.${op.kernel}` : `surfacing.${op.id}`}
      </span>
    </button>
  );
}

// Convert the legacy SURFACING_OPS into the unified shape so they slot
// into the "Operations" tab — buildPatch, trim, sew, refine, eval,
// intersect, projectPoint, classAAnalyse.
function legacyOpsAsV4() {
  return SURFACING_OPS.map((op) => ({
    ...op,
    v4: false,
    group: 'Operations',
    kernel: op.id,
  }));
}

// Build the unified catalogue. V4 ops are flagged v4:true so the dialog
// knows to call op.fn(params) instead of op.fn(...args).
function buildCatalogue() {
  const v4 = SURFACING_V4_OPS.map((op) => ({ ...op, v4: true }));
  const legacy = legacyOpsAsV4();
  return [...v4, ...legacy];
}

// ────────── panel itself ──────────
export function SurfacingPanel({ open, onClose }) {
  const [activeOp, setActiveOp] = useState(null);
  const [log, setLog] = useState([]);
  const [continuity, setContinuity] = useState(null);
  const [activeTab, setActiveTab] = useState('Curve Tools');
  const selection = useMemo(() => readViewportSelection(), [open, activeOp]);
  const catalogue = useMemo(() => buildCatalogue(), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (activeOp) setActiveOp(null);
        else onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, activeOp, onClose]);

  const onAddLog = useCallback((entry) => {
    setLog((l) => [...l, entry]);
    if (entry.id === 'classAAnalyse' && entry.ok && typeof entry.payload === 'object') {
      setContinuity(entry.payload);
    }
  }, []);

  if (!open) return null;
  const tabs = [...SURFACING_V4_GROUPS, 'Operations'];
  const visibleOps = catalogue.filter((op) => op.group === activeTab);
  return (
    <aside role="region"
           aria-label="Surfacing"
           data-testid="forge-surfacing-panel"
           style={panelStyle}>
      <header style={headerStyle}>
        <Icon name="sketch.spline" size={14} />
        <span style={{ flex: 1 }}>Surfacing · Class-A · GSD</span>
        <button type="button" onClick={onClose} aria-label="Close panel"
                data-testid="forge-surfacing-close"
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink-mute)', cursor: 'pointer',
                         display: 'inline-flex', padding: 2 }}>
          <Icon name="select.clear" size={12} />
        </button>
      </header>
      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)' }}>
        {activeTab === 'Analysis'
          ? 'Class-A diagnostics: porcupine, reflection lines, isoclines, draft analysis. Result feeds the viewport overlay.'
          : activeTab === 'Curve Tools'
          ? 'Generative curves: lines, planes, helices, conics, projected and parallel curves.'
          : activeTab === 'Surface Tools'
          ? 'Patch generators: extract, extrude, sweep, fill, blend, multi-section, offset, gap-close, untrim, extrapolate.'
          : 'Build, trim, sew, refine and analyse NURBS patches. Class-A analyse switches the renderer into zebra-stripe or curvature shading.'}
      </div>

      <CategoryTabs tabs={tabs} active={activeTab} onPick={setActiveTab} />

      <div data-testid={`forge-surfacing-section-${activeTab.toLowerCase().replace(/\s+/g, '-')}`}
           style={{ display: 'flex', flexDirection: 'column', gap: 4,
                    overflowY: 'auto', flex: 1 }}>
        {visibleOps.length === 0 && (
          <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)',
                        padding: 'var(--forge-space-2)' }}>
            No ops in this category.
          </div>
        )}
        {visibleOps.map((op) => (
          <OpRow key={op.id} op={op} onPick={setActiveOp} />
        ))}
      </div>

      {continuity && (
        <div style={{ position: 'relative' }}>
          <ContinuityReport report={continuity} />
          <button type="button"
                  onClick={() => setContinuity(null)}
                  aria-label="Clear continuity report"
                  style={{ position: 'absolute', top: 8, right: 4,
                           background: 'transparent', border: 'none',
                           color: 'var(--forge-ink-mute)',
                           cursor: 'pointer', fontSize: 10 }}>
            clear
          </button>
        </div>
      )}

      {log.length > 0 && (
        <div data-testid="forge-surfacing-log"
             style={{ marginTop: 'var(--forge-space-2)',
                      borderTop: '1px solid var(--forge-rail-edge)',
                      paddingTop: 'var(--forge-space-2)',
                      display: 'flex', flexDirection: 'column', gap: 4,
                      maxHeight: 120, overflowY: 'auto',
                      fontFamily: 'var(--forge-mono)', fontSize: 11,
                      color: 'var(--forge-ink-2)' }}>
          {log.slice(-6).reverse().map((entry, i) => (
            <div key={`${entry.ts}-${i}`}
                 style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span style={{ color: entry.ok ? 'var(--forge-ok)' : 'var(--forge-err)' }}>
                {entry.ok ? 'OK' : 'ER'}
              </span>
              <span style={{ flex: 1 }}>{entry.label}</span>
              {entry.extra && (
                <span style={{ color: 'var(--forge-accent)' }}>{entry.extra}</span>
              )}
              <span style={{ color: 'var(--forge-ink-mute)' }}>
                {typeof entry.payload === 'object'
                  ? JSON.stringify(entry.payload).slice(0, 40)
                  : String(entry.payload).slice(0, 40)}
              </span>
            </div>
          ))}
        </div>
      )}

      {activeOp && (
        <OpDialog op={activeOp}
                  selection={selection}
                  onClose={() => setActiveOp(null)}
                  onResult={onAddLog} />
      )}
    </aside>
  );
}

// ────────── self-mounting host ──────────
export function SurfacingPanelHost() {
  const [open, setOpen] = useState(false);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (typeof window === 'undefined') return;
    window.__forgeOpenSurfacing = () => setOpen(true);
    const onEvt = (e) => {
      if (!e?.detail) return;
      if (e.detail.which === 'surfacing') setOpen(true);
    };
    window.addEventListener(PANEL_EVENT, onEvt);
    return () => window.removeEventListener(PANEL_EVENT, onEvt);
  }, []);
  return <SurfacingPanel open={open} onClose={() => setOpen(false)} />;
}
