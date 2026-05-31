/**
 * Toast + ToastProvider — global notification surface.
 *
 *   const { push } = useToast();
 *   push({ title: 'Saved', tone: 'success', duration: 4000, action });
 *
 * Mount <ToastHost /> once near the app root and wrap with <ToastProvider>.
 */

import React, { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import { Icon } from '../icons/Icon.jsx';
import { IconButton } from './Button.jsx';
import { announce } from '../a11y.js';

const ToastContext = createContext(null);

let nextId = 1;
function uid() { return `t-${nextId++}`; }

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
    clearTimeout(timers.current.get(id));
    timers.current.delete(id);
  }, []);

  const push = useCallback((opts) => {
    const id = opts.id || uid();
    const t = {
      id, tone: 'info', duration: 5000, ...opts,
    };
    setToasts((cur) => [...cur, t]);
    announce(`${t.title || ''} ${t.description || ''}`.trim(),
             t.tone === 'danger' ? 'assertive' : 'polite');
    if (t.duration > 0) {
      timers.current.set(id, setTimeout(() => dismiss(id), t.duration));
    }
    return id;
  }, [dismiss]);

  useEffect(() => () => {
    for (const tm of timers.current.values()) clearTimeout(tm);
  }, []);

  return (
    <ToastContext.Provider value={{ push, dismiss, toasts }}>
      {children}
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('[forge.toast] useToast must be inside <ToastProvider>');
  return ctx;
}

const TONE_ICON = { info: 'info', success: 'success', warning: 'warning', danger: 'error' };
const TONE_BG = {
  info: 'var(--info-soft)', success: 'var(--success-soft)',
  warning: 'var(--warning-soft)', danger: 'var(--danger-soft)',
};
const TONE_TEXT = {
  info: 'var(--info-text)', success: 'var(--success-text)',
  warning: 'var(--warning-text)', danger: 'var(--danger-text)',
};
const TONE_BORDER = {
  info: 'var(--info-bg)', success: 'var(--success-bg)',
  warning: 'var(--warning-bg)', danger: 'var(--danger-bg)',
};

export function ToastHost() {
  const { toasts, dismiss } = useToast();
  return (
    <div
      aria-live="polite"
      aria-atomic="false"
      style={{
        position: 'fixed',
        right: 'var(--space-9)',
        bottom: 'var(--space-9)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-5)',
        zIndex: 'var(--z-toast)',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'danger' ? 'alert' : 'status'}
          style={{
            display: 'grid', gridTemplateColumns: '20px 1fr auto',
            alignItems: 'flex-start',
            gap: 'var(--space-5)',
            minWidth: '280px', maxWidth: '420px',
            padding: 'var(--space-7) var(--space-7) var(--space-7) var(--space-7)',
            background: TONE_BG[t.tone] || 'var(--surface-overlay)',
            color: TONE_TEXT[t.tone] || 'var(--text-primary)',
            border: `1px solid ${TONE_BORDER[t.tone] || 'var(--border-default)'}`,
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-lg)',
            pointerEvents: 'auto',
          }}
        >
          <Icon name={TONE_ICON[t.tone] || 'info'} size={20} />
          <div>
            {t.title && (
              <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)', color: 'var(--text-primary)' }}>
                {t.title}
              </div>
            )}
            {t.description && (
              <div style={{ marginTop: t.title ? 'var(--space-2)' : 0, fontSize: 'var(--text-xs)' }}>
                {t.description}
              </div>
            )}
            {t.action && (
              <div style={{ marginTop: 'var(--space-5)' }}>{t.action}</div>
            )}
          </div>
          <IconButton
            icon={<Icon name="close" size={12} />}
            label="Dismiss"
            size="sm"
            variant="ghost"
            onClick={() => dismiss(t.id)}
          />
        </div>
      ))}
    </div>
  );
}
