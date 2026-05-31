/**
 * Modal — focus-trapped, ESC-closable, backdrop-clickable dialog.
 * Tooltip — small hover/focus popover with smart placement.
 */

import React, { useRef, useEffect } from 'react';
import { useFocusTrap, useEscapeKey, useUniqueId } from '../a11y.js';
import { IconButton } from './Button.jsx';
import { Icon } from '../icons/Icon.jsx';

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md', // sm | md | lg | xl
  closeOnBackdrop = true,
}) {
  const ref = useRef(null);
  useFocusTrap(ref, open);
  useEscapeKey(onClose, open);
  const titleId = useUniqueId('forge-modal-title');
  const descId = useUniqueId('forge-modal-desc');

  // lock body scroll while open
  useEffect(() => {
    if (!open || typeof document === 'undefined') return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  if (!open) return null;

  const widths = { sm: '380px', md: '520px', lg: '720px', xl: '960px' };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? titleId : undefined}
      aria-describedby={description ? descId : undefined}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        zIndex: 'var(--z-modal)',
        padding: 'var(--space-9)',
      }}
      onMouseDown={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        ref={ref}
        style={{
          width: widths[size],
          maxWidth: '95vw',
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--surface-overlay)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border-default)',
          borderRadius: 'var(--radius-lg)',
          boxShadow: 'var(--shadow-xl)',
        }}
      >
        {(title || onClose) && (
          <header style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: 'var(--space-7) var(--space-8)',
            borderBottom: '1px solid var(--border-subtle)',
          }}>
            <div>
              {title && (
                <h2 id={titleId} style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 'var(--weight-semibold)' }}>
                  {title}
                </h2>
              )}
              {description && (
                <p id={descId} style={{ margin: 'var(--space-2) 0 0', fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
                  {description}
                </p>
              )}
            </div>
            {onClose && (
              <IconButton
                icon={<Icon name="close" />}
                label="Close"
                variant="ghost"
                onClick={onClose}
              />
            )}
          </header>
        )}
        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-8)' }}>
          {children}
        </div>
        {footer && (
          <footer style={{
            display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-5)',
            padding: 'var(--space-7) var(--space-8)',
            borderTop: '1px solid var(--border-subtle)',
          }}>
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}

export function Tooltip({ children, content, placement = 'top', delay = 400 }) {
  const [show, setShow] = React.useState(false);
  const timer = useRef();
  const enter = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setShow(true), delay);
  };
  const leave = () => {
    clearTimeout(timer.current);
    setShow(false);
  };
  return (
    <span style={{ position: 'relative', display: 'inline-flex' }}
      onMouseEnter={enter} onMouseLeave={leave}
      onFocus={enter} onBlur={leave}>
      {children}
      {show && content && (
        <span
          role="tooltip"
          style={{
            position: 'absolute',
            ...(placement === 'top' ? { bottom: '100%', marginBottom: 'var(--space-4)' } : {}),
            ...(placement === 'bottom' ? { top: '100%', marginTop: 'var(--space-4)' } : {}),
            ...(placement === 'left' ? { right: '100%', marginRight: 'var(--space-4)', top: '50%', transform: 'translateY(-50%)' } : {}),
            ...(placement === 'right' ? { left: '100%', marginLeft: 'var(--space-4)', top: '50%', transform: 'translateY(-50%)' } : {}),
            ...((placement === 'top' || placement === 'bottom') ? { left: '50%', transform: 'translateX(-50%)' } : {}),
            background: 'var(--surface-overlay)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border-default)',
            borderRadius: 'var(--radius-md)',
            padding: 'var(--space-3) var(--space-6)',
            fontSize: 'var(--text-xs)',
            lineHeight: 'var(--leading-snug)',
            boxShadow: 'var(--shadow-md)',
            whiteSpace: 'nowrap',
            pointerEvents: 'none',
            zIndex: 'var(--z-tooltip)',
          }}
        >
          {content}
        </span>
      )}
    </span>
  );
}
