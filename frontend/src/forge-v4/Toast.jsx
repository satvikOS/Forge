// Forge-71 — Toast notifications.
//
// Top-right single-slot. Severity sets the left rim. Auto-dismiss based
// on type (3s info/success, 5s warn/err). New toast replaces current.

import React, { useEffect, useState } from 'react';
import { Icon } from './icons/Icon.jsx';

let _toastSeq = 0;
const _listeners = new Set();

export function showToast({ kind = 'info', text, hint, ttl }) {
  const id = ++_toastSeq;
  const t = { id, kind, text, hint, ttl: ttl ?? (kind === 'err' || kind === 'warn' ? 5000 : 3000) };
  for (const fn of _listeners) fn(t);
  return id;
}

const ICON_FOR = {
  info: 'menu.help',
  ok: 'sketch.finish',
  warn: 'measure.interfere',
  err: 'archie.cancel',
};
const COLOR_FOR = {
  info: 'var(--forge-ink-2)',
  ok:   'var(--forge-ok)',
  warn: 'var(--forge-warn)',
  err:  'var(--forge-err)',
};

export function ToastHost() {
  const [toast, setToast] = useState(null);
  useEffect(() => {
    const onToast = (t) => {
      setToast(t);
      if (t.ttl > 0) {
        const handle = setTimeout(() => setToast((cur) => cur?.id === t.id ? null : cur), t.ttl);
        return () => clearTimeout(handle);
      }
    };
    _listeners.add(onToast);
    return () => { _listeners.delete(onToast); };
  }, []);

  if (!toast) return null;
  return (
    <div role="status"
         aria-live="polite"
         data-testid="forge-toast"
         data-kind={toast.kind}
         style={{
           position: 'fixed',
           top: 'calc(var(--forge-topbar-h) + 12px)',
           right: 14,
           background: 'var(--forge-canvas-3)',
           border: '1px solid var(--forge-rail-edge)',
           borderLeft: `3px solid ${COLOR_FOR[toast.kind]}`,
           borderRadius: 'var(--forge-radius)',
           padding: '8px 12px',
           color: 'var(--forge-ink)',
           font: 'inherit', fontSize: 12,
           boxShadow: '0 12px 36px rgba(0,0,0,0.55)',
           maxWidth: 360,
           display: 'flex', alignItems: 'center', gap: 10,
           zIndex: 2500,
         }}>
      <span style={{ color: COLOR_FOR[toast.kind], display: 'inline-flex' }}>
        <Icon name={ICON_FOR[toast.kind]} size={14} />
      </span>
      <span style={{ flex: 1 }}>{toast.text}</span>
      {toast.hint && (
        <span style={{ color: 'var(--forge-ink-mute)', fontSize: 11,
                       fontFamily: 'var(--forge-mono)' }}>{toast.hint}</span>
      )}
      <button type="button"
              onClick={() => setToast(null)}
              aria-label="Dismiss"
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--forge-ink-mute)', cursor: 'pointer',
                fontSize: 10, padding: 2,
                display: 'inline-flex',
              }}>
        <Icon name="select.clear" size={12} />
      </button>
    </div>
  );
}
