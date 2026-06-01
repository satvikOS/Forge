// Forge-93 — Heal Panel.
//
// Right-anchored 360 px drawer exposing every window.forge.heal.*
// operation:
//   • sewShape(h, tol)
//   • simplifyShape(h, opts)
//   • autoFillMissingFaces(h, tol)
//   • autoRepairSelfIntersection(h, tol)
//   • harmonizeNormals(h)
//   • checkValidity(h) → { issues: [{ severity, msg, faceId? }, ...] }
//
// Each tolerance-bearing op shows a slider field. Sew / simplify /
// autoFill / autoRepair all share the same slider field component
// (rendered via the dialog system).
//
// checkValidity is special: instead of opening a dialog asking for the
// handle and then closing, the panel inlines the issues list with
// colour-coded severity rows after the call returns. The list stays
// visible until the user closes the panel or runs another op.
//
// Manual clicks NEVER write to Archie's thread — the panel calls the
// dispatcher directly. Archie continues to drive the same
// dispatcher from its tool router.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons/Icon.jsx';
import { showToast } from './Toast.jsx';
import { HEAL_OPS, isForgeReady, PANEL_EVENT } from './directHealSurfDispatch.js';

// ────────── style chunks (shared with DirectEditPanel.jsx visually
// but inlined here so each panel file is self-contained and we don't
// risk a circular import between panels) ──────────
const panelStyle = {
  position: 'fixed',
  right: 0,
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  bottom: 0,
  width: 360,
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

const SEV_COLOR = {
  err:     'var(--forge-err)',
  error:   'var(--forge-err)',
  warn:    'var(--forge-warn)',
  warning: 'var(--forge-warn)',
  info:    'var(--forge-ink-2)',
  ok:      'var(--forge-ok)',
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

function readViewportSelection() {
  if (typeof window === 'undefined') return null;
  const s = window.__forgeSelection;
  if (!s || typeof s !== 'object') return null;
  if (!s.kind || s.kind === 'none') return null;
  return s;
}

// ────────── field renderer (slider, int, json) ──────────
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
  if (field.kind === 'json') {
    const text = (() => {
      try { return JSON.stringify(value, null, 2); }
      catch { return String(value); }
    })();
    return (
      <textarea value={text}
                onChange={(e) => {
                  try { onChange(JSON.parse(e.target.value)); }
                  catch { /* keep raw — user is mid-edit */ }
                }}
                rows={Math.min(8, Math.max(3, text.split('\n').length))}
                style={{ ...inputStyle, fontFamily: 'var(--forge-mono)',
                         fontSize: 11, resize: 'vertical' }}
                data-test-field={field.id} />
    );
  }
  return null;
}

// ────────── per-op dialog ──────────
function OpDialog({ op, onClose, onResult, selection }) {
  const [values, setValues] = useState(() => defaultValuesFor(op.signature));

  useEffect(() => {
    if (!selection) return;
    setValues((v) => {
      const next = { ...v };
      if ('handle' in next && Array.isArray(selection.bodyIds) && selection.bodyIds[0] != null) {
        next.handle = selection.bodyIds[0];
      } else if ('handle' in next && selection.kind === 'body' && selection.ids?.[0] != null) {
        next.handle = selection.ids[0];
      }
      return next;
    });
  }, [selection]);

  const submit = useCallback(() => {
    if (!isForgeReady()) {
      showToast({ kind: 'warn',
                  text: 'window.forge not loaded — heal ops unavailable',
                  ttl: 3500 });
      onClose(null);
      return;
    }
    const args = buildArgs(op.signature, values);
    const r = op.fn(...args);
    onResult({
      ts: Date.now(),
      id: op.id,
      label: op.label,
      ok: r.ok,
      payload: r.ok ? r.result : `${r.reason || 'error'}${r.message ? ' · ' + r.message : ''}`,
    });
    if (!r.ok) {
      showToast({ kind: 'warn', text: `${op.label} failed: ${r.reason || 'error'}`, ttl: 3000 });
    } else {
      showToast({ kind: 'ok', text: `${op.label} ok`, ttl: 1500 });
    }
    onClose(r);
  }, [op, values, onResult, onClose]);

  return (
    <div role="dialog"
         aria-label={`${op.label} dialog`}
         data-testid="forge-heal-dialog"
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
        <button type="button" onClick={() => onClose(null)} aria-label="Close dialog"
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
          : 'No viewport selection — type handle manually.'}
      </div>
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
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button type="button"
                onClick={() => onClose(null)}
                data-testid="forge-heal-dialog-cancel"
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
                data-testid="forge-heal-dialog-confirm"
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

// ────────── validity issue list ──────────
function ValidityIssues({ issues }) {
  if (!issues || issues.length === 0) {
    return (
      <div style={{ fontSize: 11, color: 'var(--forge-ok)',
                    background: 'var(--forge-surface)',
                    padding: '6px 8px', borderRadius: 3,
                    borderLeft: '3px solid var(--forge-ok)' }}>
        No issues detected — shape is valid.
      </div>
    );
  }
  return (
    <ul data-testid="forge-heal-issues"
        style={{ listStyle: 'none', padding: 0, margin: 0,
                 display: 'flex', flexDirection: 'column', gap: 4 }}>
      {issues.map((it, i) => {
        const sev = String(it.severity || it.kind || 'info').toLowerCase();
        const color = SEV_COLOR[sev] || SEV_COLOR.info;
        return (
          <li key={i}
              data-issue-severity={sev}
              style={{ display: 'flex', gap: 6, alignItems: 'baseline',
                       background: 'var(--forge-surface)',
                       borderLeft: `3px solid ${color}`,
                       padding: '5px 8px', borderRadius: 3,
                       fontSize: 11 }}>
            <span style={{ color, fontFamily: 'var(--forge-mono)',
                           textTransform: 'uppercase',
                           fontWeight: 600, fontSize: 10, minWidth: 38 }}>
              {sev}
            </span>
            <span style={{ flex: 1, color: 'var(--forge-ink)' }}>
              {it.msg || it.message || JSON.stringify(it)}
            </span>
            {it.faceId != null && (
              <span style={{ fontFamily: 'var(--forge-mono)',
                             color: 'var(--forge-ink-mute)' }}>
                face #{it.faceId}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// ────────── panel itself ──────────
export function HealPanel({ open, onClose }) {
  const [activeOp, setActiveOp] = useState(null);
  const [log, setLog] = useState([]);
  const [validity, setValidity] = useState(null);
  const selection = useMemo(() => readViewportSelection(), [open, activeOp]);

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

  const onDialogClose = useCallback((r) => {
    // checkValidity → render the issues list inline
    if (activeOp?.id === 'checkValidity' && r?.ok) {
      setValidity({ ts: Date.now(), issues: r.result?.issues || [] });
    }
    setActiveOp(null);
  }, [activeOp]);

  if (!open) return null;
  return (
    <aside role="region"
           aria-label="Heal"
           data-testid="forge-heal-panel"
           style={panelStyle}>
      <header style={headerStyle}>
        <Icon name="sketch.finish" size={14} />
        <span style={{ flex: 1 }}>Heal</span>
        <button type="button" onClick={onClose} aria-label="Close panel"
                data-testid="forge-heal-close"
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink-mute)', cursor: 'pointer',
                         display: 'inline-flex', padding: 2 }}>
          <Icon name="select.clear" size={12} />
        </button>
      </header>
      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)' }}>
        Repair imported / stitched B-reps. Tolerance is in millimetres.
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4,
                    overflowY: 'auto' }}>
        {HEAL_OPS.map((op) => (
          <button key={op.id}
                  type="button"
                  data-testid={`forge-heal-op-${op.id}`}
                  data-heal-op={op.id}
                  onClick={() => setActiveOp(op)}
                  style={opBtnStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--forge-surface-2)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--forge-surface)'; }}>
            <Icon name={op.id === 'checkValidity' ? 'menu.help' : 'sketch.finish'}
                  size={14} />
            <span style={{ flex: 1 }}>{op.label}</span>
            <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 10,
                           color: 'var(--forge-ink-mute)' }}>
              heal.{op.id}
            </span>
          </button>
        ))}
      </div>

      {validity && (
        <div data-testid="forge-heal-validity"
             style={{ marginTop: 'var(--forge-space-2)',
                      borderTop: '1px solid var(--forge-rail-edge)',
                      paddingTop: 'var(--forge-space-2)',
                      display: 'flex', flexDirection: 'column', gap: 4,
                      maxHeight: 220, overflowY: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <strong style={{ flex: 1, fontSize: 11 }}>
              Validity ({validity.issues.length} issue{validity.issues.length === 1 ? '' : 's'})
            </strong>
            <button type="button"
                    onClick={() => setValidity(null)}
                    aria-label="Clear validity report"
                    style={{ background: 'transparent', border: 'none',
                             color: 'var(--forge-ink-mute)', cursor: 'pointer',
                             fontSize: 10 }}>
              clear
            </button>
          </div>
          <ValidityIssues issues={validity.issues} />
        </div>
      )}

      {log.length > 0 && (
        <div data-testid="forge-heal-log"
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
              <span style={{ color: 'var(--forge-ink-mute)' }}>
                {typeof entry.payload === 'object'
                  ? JSON.stringify(entry.payload).slice(0, 50)
                  : String(entry.payload).slice(0, 50)}
              </span>
            </div>
          ))}
        </div>
      )}

      {activeOp && (
        <OpDialog op={activeOp}
                  selection={selection}
                  onClose={onDialogClose}
                  onResult={(r) => setLog((l) => [...l, r])} />
      )}
    </aside>
  );
}

// ────────── self-mounting host ──────────
export function HealPanelHost() {
  const [open, setOpen] = useState(false);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (typeof window === 'undefined') return;
    window.__forgeOpenHeal = () => setOpen(true);
    const onEvt = (e) => {
      if (!e?.detail) return;
      if (e.detail.which === 'heal') setOpen(true);
    };
    window.addEventListener(PANEL_EVENT, onEvt);
    return () => window.removeEventListener(PANEL_EVENT, onEvt);
  }, []);
  return <HealPanel open={open} onClose={() => setOpen(false)} />;
}
