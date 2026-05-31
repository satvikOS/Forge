// Forge-67 — positioned tooltip primitive.
//
// 350 ms hover delay; Esc dismisses; clamped to viewport.
// Replaces native `title` for every tool button so we get consistent
// positioning + the shortcut hint in mono.

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const DELAY = 350;
const PAD = 8;

export function Tooltip({ label, hint, placement = 'bottom', children }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  const triggerRef = useRef(null);
  const tipRef = useRef(null);
  const timer = useRef(null);

  const onEnter = useCallback(() => {
    timer.current = setTimeout(() => setOpen(true), DELAY);
  }, []);
  const onLeave = useCallback(() => {
    clearTimeout(timer.current); timer.current = null;
    setOpen(false);
  }, []);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current || !tipRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const t = tipRef.current.getBoundingClientRect();
    let x, y;
    if (placement === 'top')    { x = r.left + r.width/2 - t.width/2; y = r.top - t.height - 6; }
    if (placement === 'bottom') { x = r.left + r.width/2 - t.width/2; y = r.bottom + 6; }
    if (placement === 'left')   { x = r.left - t.width - 6;           y = r.top + r.height/2 - t.height/2; }
    if (placement === 'right')  { x = r.right + 6;                    y = r.top + r.height/2 - t.height/2; }
    const vw = window.innerWidth, vh = window.innerHeight;
    x = Math.max(PAD, Math.min(x, vw - t.width - PAD));
    y = Math.max(PAD, Math.min(y, vh - t.height - PAD));
    setPos({ x, y });
  }, [open, placement]);

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
      {open && (
        <div ref={tipRef}
             role="tooltip"
             data-testid="forge-tooltip"
             style={{
               position: 'fixed',
               left: pos?.x ?? -9999,
               top: pos?.y ?? -9999,
               pointerEvents: 'none',
               background: 'var(--forge-canvas-3)',
               color: 'var(--forge-ink)',
               border: '1px solid var(--forge-rail-edge)',
               borderRadius: 4,
               padding: '4px 8px',
               fontSize: 11,
               lineHeight: 1.3,
               boxShadow: '0 8px 24px rgba(0,0,0,0.55)',
               zIndex: 1500,
               whiteSpace: 'nowrap',
               display: 'flex',
               alignItems: 'baseline',
               gap: 10,
             }}>
          <span>{label}</span>
          {hint && (
            <kbd style={{
              fontFamily: 'var(--forge-mono)',
              fontSize: 10,
              color: 'var(--forge-ink-mute)',
              background: 'var(--forge-surface)',
              border: '1px solid var(--forge-rail-edge)',
              padding: '1px 4px',
              borderRadius: 3,
            }}>{hint}</kbd>
          )}
        </div>
      )}
    </>
  );
}
