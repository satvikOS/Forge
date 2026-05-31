// Forge v3 — tooltip + context menu.
//
// Replaces native `title` with a positioned overlay. Smart positioning
// clamps the tooltip to the viewport. Esc dismisses. Tooltips wait
// 350 ms before showing so quick mouse passes don't flash; they
// disappear instantly on leave to avoid stickiness.
//
// Context menu: shows at cursor on right-click. Items configurable per
// surface (verb rail, timeline, viewport, sidebar). Focus traps inside;
// Esc dismisses; click-outside closes.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const TOOLTIP_DELAY_MS = 350;
const VIEWPORT_PAD     = 8;

export function Tooltip({ children, label, hint, placement = 'top' }) {
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState(null);
  const triggerRef = useRef(null);
  const timerRef = useRef(null);
  const tipRef = useRef(null);

  const onEnter = useCallback(() => {
    timerRef.current = setTimeout(() => setOpen(true), TOOLTIP_DELAY_MS);
  }, []);
  const onLeave = useCallback(() => {
    clearTimeout(timerRef.current); timerRef.current = null;
    setOpen(false);
  }, []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !tipRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const t = tipRef.current.getBoundingClientRect();
    let x, y;
    if (placement === 'right') {
      x = r.right + 8; y = r.top + r.height / 2 - t.height / 2;
    } else if (placement === 'left') {
      x = r.left - t.width - 8; y = r.top + r.height / 2 - t.height / 2;
    } else if (placement === 'bottom') {
      x = r.left + r.width / 2 - t.width / 2; y = r.bottom + 8;
    } else { // top
      x = r.left + r.width / 2 - t.width / 2; y = r.top - t.height - 8;
    }
    const vw = window.innerWidth, vh = window.innerHeight;
    x = Math.max(VIEWPORT_PAD, Math.min(x, vw - t.width  - VIEWPORT_PAD));
    y = Math.max(VIEWPORT_PAD, Math.min(y, vh - t.height - VIEWPORT_PAD));
    setCoords({ x, y });
  }, [open, placement]);

  // Esc anywhere → close.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      {React.cloneElement(children, {
        ref: triggerRef,
        onMouseEnter: onEnter,
        onMouseLeave: onLeave,
        onFocus: onEnter,
        onBlur: onLeave,
      })}
      {open && typeof document !== 'undefined' && (
        <div ref={tipRef}
             role="tooltip"
             data-testid="forge-v3-tooltip"
             style={{
               position: 'fixed',
               left: coords?.x ?? -9999,
               top: coords?.y ?? -9999,
               pointerEvents: 'none',
               background: 'var(--forge-v3-surface)',
               color: 'var(--forge-v3-ink)',
               border: '1px solid var(--forge-v3-rail-edge)',
               borderRadius: 'var(--forge-v3-radius)',
               padding: '4px 8px',
               fontSize: 11,
               lineHeight: 1.3,
               boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
               zIndex: 1000,
               whiteSpace: 'nowrap',
             }}>
          <span>{label}</span>
          {hint && (
            <span style={{ color: 'var(--forge-v3-ink-mute)', marginLeft: 8 }}>{hint}</span>
          )}
        </div>
      )}
    </>
  );
}

export function ContextMenu({ open, x, y, items, onPick, onClose }) {
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onClose?.();
    };
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  // Smart positioning — clamp to viewport.
  const [coords, setCoords] = useState(null);
  useLayoutEffect(() => {
    if (!open || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const cx = Math.min(x, vw - r.width  - VIEWPORT_PAD);
    const cy = Math.min(y, vh - r.height - VIEWPORT_PAD);
    setCoords({ x: cx, y: cy });
  }, [open, x, y]);

  if (!open) return null;

  return (
    <ul
      ref={ref}
      role="menu"
      aria-label="Context menu"
      data-testid="forge-v3-context-menu"
      style={{
        position: 'fixed',
        left: coords?.x ?? x,
        top: coords?.y ?? y,
        listStyle: 'none',
        margin: 0,
        padding: 4,
        background: 'var(--forge-v3-surface)',
        border: '1px solid var(--forge-v3-rail-edge)',
        borderRadius: 'var(--forge-v3-radius-lg)',
        boxShadow: '0 16px 48px rgba(0,0,0,0.55)',
        minWidth: 180,
        zIndex: 1100,
      }}
    >
      {items.map((it, i) => it.divider ? (
        <li key={`sep-${i}`} role="separator"
            style={{
              height: 1,
              margin: '4px 8px',
              background: 'var(--forge-v3-rail-edge)',
            }} />
      ) : (
        <li key={it.id || it.label} role="menuitem">
          <button type="button"
                  disabled={it.disabled}
                  onClick={() => { if (!it.disabled) { onPick?.(it); onClose?.(); } }}
                  style={{
                    width: '100%', textAlign: 'left', cursor: it.disabled ? 'default' : 'pointer',
                    background: 'transparent', border: 'none',
                    color: it.disabled ? 'var(--forge-v3-ink-faint)' : 'var(--forge-v3-ink)',
                    font: 'inherit', fontSize: 12, padding: '6px 10px',
                    borderRadius: 4, display: 'flex', alignItems: 'center', gap: 8,
                  }}>
            {it.icon && <span aria-hidden="true">{it.icon}</span>}
            <span>{it.label}</span>
            {it.shortcut && (
              <span style={{
                marginLeft: 'auto',
                fontSize: 10, color: 'var(--forge-v3-ink-mute)',
                fontFamily: 'JetBrains Mono, monospace',
              }}>{it.shortcut}</span>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Item set per surface. The shell composes these based on selection
 *  + active verb when the user right-clicks. */
export function viewportContextItems(selection) {
  if (selection?.kind === 'body' && selection.ids?.length > 0) {
    return [
      { id: 'edit',      label: 'Edit',         icon: '✎', shortcut: 'E' },
      { id: 'fillet',    label: 'Fillet edges', icon: '⌒' },
      { id: 'chamfer',   label: 'Chamfer edges',icon: '⟋' },
      { divider: true },
      { id: 'hide',      label: 'Hide',         icon: '◌', shortcut: 'H' },
      { id: 'isolate',   label: 'Isolate',      icon: '◉' },
      { divider: true },
      { id: 'delete',    label: 'Delete',       icon: '⌫', shortcut: '⌫' },
    ];
  }
  return [
    { id: 'create.box', label: 'Create box',    icon: '▣' },
    { id: 'create.cyl', label: 'Create cyl',    icon: '◯' },
    { divider: true },
    { id: 'import',     label: 'Import…',       icon: '⤓' },
    { id: 'paste',      label: 'Paste',         icon: '⎘', disabled: true },
  ];
}
