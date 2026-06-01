// Forge-93 — Direct Edit Panel.
//
// Right-anchored 360 px drawer that exposes every window.forge.direct.*
// operation (pushPullFace, moveFace, rotateFace, deleteFaceAndHeal,
// replaceFace, inferFeature, faceCount). Each row is a button that
// opens an in-panel dialog asking for:
//
//   • the selection (face/edge/vertex picked from the viewport — read
//     from window.__forgeSelection if the viewport has wired it; the
//     panel also accepts manual ID entry as a fallback);
//   • the numeric inputs the op needs (distance, translation, etc.).
//
// On confirm:
//   1. Guard window.forge availability via isForgeReady(); show a toast
//      and abort if missing.
//   2. Call the corresponding dispatcher from directHealSurfDispatch.js.
//   3. Render the result row at the bottom of the panel (with timestamp).
//
// Manual clicks do NOT write to Archie's thread — they call the kernel
// directly. Archie continues to drive the same dispatchers via its own
// tool-router; the two paths share the same wrapper.
//
// Panel hosts itself: subscribe to window event `forge:open-direct-heal-
// surf-panel` with detail.which === 'direct'. The App-level host (see
// App.jsx) renders the component once at mount; ForgeShellV4 stays
// untouched.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './icons/Icon.jsx';
import { showToast } from './Toast.jsx';
import { DIRECT_OPS, isForgeReady, PANEL_EVENT } from './directHealSurfDispatch.js';

// ────────── shared style chunks ──────────
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

const opListStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  overflowY: 'auto',
  paddingRight: 4,
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
  transition: 'background 90ms, border-color 90ms',
};

const logStyle = {
  marginTop: 'var(--forge-space-2)',
  borderTop: '1px solid var(--forge-rail-edge)',
  paddingTop: 'var(--forge-space-2)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  maxHeight: 140,
  overflowY: 'auto',
  fontFamily: 'var(--forge-mono)',
  fontSize: 11,
  color: 'var(--forge-ink-2)',
};

// ────────── helpers ──────────
function readViewportSelection() {
  if (typeof window === 'undefined') return null;
  const s = window.__forgeSelection;
  if (!s || typeof s !== 'object') return null;
  if (!s.kind || s.kind === 'none') return null;
  return s;
}

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

// ────────── field renderer ──────────
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
  switch (field.kind) {
    case 'int':
      return (
        <input type="number" step={1}
               value={value ?? 0}
               onChange={(e) => onChange(parseInt(e.target.value, 10) || 0)}
               style={inputStyle}
               data-test-field={field.id} />
      );
    case 'number':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <input type="number" step={0.001}
                 value={value ?? 0}
                 onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
                 style={inputStyle}
                 data-test-field={field.id} />
          {field.unit && (
            <span style={{ fontSize: 10, color: 'var(--forge-ink-mute)',
                           fontFamily: 'var(--forge-mono)' }}>
              {field.unit}
            </span>
          )}
        </div>
      );
    case 'slider':
      return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="range"
                 min={field.min} max={field.max} step={field.step}
                 value={value ?? field.default}
                 onChange={(e) => onChange(parseFloat(e.target.value))}
                 style={{ flex: 1 }}
                 data-test-field={field.id} />
          <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                         color: 'var(--forge-ink-2)', minWidth: 48,
                         textAlign: 'right' }}>
            {Number(value ?? field.default).toFixed(3)}{field.unit ? ` ${field.unit}` : ''}
          </span>
        </div>
      );
    case 'vec3': {
      const arr = Array.isArray(value) ? value : [0, 0, 0];
      const setAt = (i, v) => {
        const next = [...arr];
        next[i] = v;
        onChange(next);
      };
      return (
        <div style={{ display: 'flex', gap: 4 }}>
          {[0, 1, 2].map((i) => (
            <input key={i} type="number" step={0.1}
                   value={arr[i] ?? 0}
                   onChange={(e) => setAt(i, parseFloat(e.target.value) || 0)}
                   style={{ ...inputStyle, padding: '3px 4px', textAlign: 'right' }}
                   data-test-field={`${field.id}.${i}`}
                   aria-label={`${field.label} ${'XYZ'[i]}`} />
          ))}
        </div>
      );
    }
    case 'intList': {
      const text = Array.isArray(value) ? value.join(', ') : '';
      return (
        <input type="text"
               value={text}
               onChange={(e) => {
                 const parts = e.target.value
                   .split(/[,\s]+/)
                   .map((s) => s.trim())
                   .filter(Boolean)
                   .map((s) => parseInt(s, 10))
                   .filter((n) => Number.isFinite(n));
                 onChange(parts);
               }}
               style={inputStyle}
               placeholder="0, 1, 2"
               data-test-field={field.id} />
      );
    }
    case 'json': {
      const text = (() => {
        try { return JSON.stringify(value, null, 2); }
        catch { return String(value); }
      })();
      return (
        <textarea value={text}
                  onChange={(e) => {
                    try { onChange(JSON.parse(e.target.value)); }
                    catch { /* keep raw text — user is mid-edit */ }
                  }}
                  rows={Math.min(8, Math.max(3, text.split('\n').length))}
                  style={{ ...inputStyle, fontFamily: 'var(--forge-mono)',
                           fontSize: 11, resize: 'vertical' }}
                  data-test-field={field.id} />
      );
    }
    default:
      return null;
  }
}

// ────────── op dialog ──────────
function OpDialog({ op, onClose, onResult, selection }) {
  const [values, setValues] = useState(() => defaultValuesFor(op.signature));

  // Seed handle/faceId from the viewport selection on open.
  useEffect(() => {
    if (!selection) return;
    setValues((v) => {
      const next = { ...v };
      if ('handle' in next && Array.isArray(selection.bodyIds) && selection.bodyIds[0] != null) {
        next.handle = selection.bodyIds[0];
      }
      if ('faceId' in next && selection.kind === 'face' && selection.ids?.[0] != null) {
        next.faceId = selection.ids[0];
      }
      if ('faceIds' in next && selection.kind === 'face' && Array.isArray(selection.ids)) {
        next.faceIds = [...selection.ids];
      }
      return next;
    });
  }, [selection]);

  const submit = useCallback(() => {
    if (!isForgeReady()) {
      showToast({ kind: 'warn',
                  text: 'window.forge not loaded — direct edit ops unavailable',
                  ttl: 3500 });
      onClose();
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
    onClose();
  }, [op, values, onResult, onClose]);

  return (
    <div role="dialog"
         aria-label={`${op.label} dialog`}
         data-testid="forge-direct-edit-dialog"
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
          : 'No viewport selection — type IDs manually.'}
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
                onClick={onClose}
                data-testid="forge-direct-edit-dialog-cancel"
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
                data-testid="forge-direct-edit-dialog-confirm"
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

// ────────── panel itself ──────────
export function DirectEditPanel({ open, onClose }) {
  const [activeOp, setActiveOp] = useState(null);
  const [log, setLog] = useState([]);
  const selection = useMemo(() => readViewportSelection(), [open, activeOp]);

  // ESC closes the dialog (or the panel if no dialog open).
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

  if (!open) return null;
  return (
    <aside role="region"
           aria-label="Direct edit"
           data-testid="forge-direct-edit-panel"
           style={{ ...panelStyle, position: 'fixed' }}>
      <header style={headerStyle}>
        <Icon name="select.face" size={14} />
        <span style={{ flex: 1 }}>Direct Edit</span>
        <button type="button" onClick={onClose} aria-label="Close panel"
                data-testid="forge-direct-edit-close"
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink-mute)', cursor: 'pointer',
                         display: 'inline-flex', padding: 2 }}>
          <Icon name="select.clear" size={12} />
        </button>
      </header>
      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)' }}>
        Tweak a B-rep without re-running the feature tree. Pick a face/edge
        in the viewport, then click an op below.
      </div>
      <div style={opListStyle}>
        {DIRECT_OPS.map((op) => (
          <button key={op.id}
                  type="button"
                  data-testid={`forge-direct-op-${op.id}`}
                  data-direct-op={op.id}
                  onClick={() => setActiveOp(op)}
                  style={opBtnStyle}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--forge-surface-2)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--forge-surface)'; }}>
            <Icon name="solid.extrude" size={14} />
            <span style={{ flex: 1 }}>{op.label}</span>
            <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 10,
                           color: 'var(--forge-ink-mute)' }}>
              direct.{op.id}
            </span>
          </button>
        ))}
      </div>
      {log.length > 0 && (
        <div style={logStyle} data-testid="forge-direct-log">
          {log.slice(-8).reverse().map((entry, i) => (
            <div key={`${entry.ts}-${i}`}
                 style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span style={{ color: entry.ok ? 'var(--forge-ok)' : 'var(--forge-err)' }}>
                {entry.ok ? 'OK' : 'ER'}
              </span>
              <span style={{ flex: 1 }}>{entry.label}</span>
              <span style={{ color: 'var(--forge-ink-mute)' }}>
                {typeof entry.payload === 'object'
                  ? JSON.stringify(entry.payload).slice(0, 60)
                  : String(entry.payload).slice(0, 60)}
              </span>
            </div>
          ))}
        </div>
      )}
      {activeOp && (
        <OpDialog op={activeOp}
                  selection={selection}
                  onClose={() => setActiveOp(null)}
                  onResult={(r) => setLog((l) => [...l, r])} />
      )}
    </aside>
  );
}

// ────────── self-mounting host ──────────
// Mounted once by App.jsx; subscribes to PANEL_EVENT and shows itself
// when detail.which === 'direct'. Test-ids on every button so the
// headed Electron suite can click without modifying ForgeShellV4.

export function DirectEditPanelHost() {
  const [open, setOpen] = useState(false);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (typeof window === 'undefined') return;
    // Expose an imperative opener for tests + menus.
    window.__forgeOpenDirectEdit = () => setOpen(true);
    const onEvt = (e) => {
      if (!e?.detail) return;
      if (e.detail.which === 'direct') setOpen(true);
    };
    window.addEventListener(PANEL_EVENT, onEvt);
    return () => window.removeEventListener(PANEL_EVENT, onEvt);
  }, []);
  return <DirectEditPanel open={open} onClose={() => setOpen(false)} />;
}
