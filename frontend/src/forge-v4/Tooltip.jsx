// Forge-67 — positioned tooltip primitive.
//
// 350 ms hover delay; Esc dismisses; clamped to the viewport. Replaces the
// native `title` for every tool button so we get consistent positioning, the
// shortcut hint in mono, and (optionally) a richer title + description form
// for ribbon / hero buttons.
//
// Styling comes entirely from the design-system `.fds-tooltip` / `.fds-kbd`
// classes + `--fds-*` tokens (theme/forge-base.css §9, §13) — no ad-hoc
// colours / sizes — so it themes automatically (dark / light / sepia / HC).
//
// API (backwards-compatible):
//   <Tooltip label="Extrude" hint="E"><button …/></Tooltip>          // 1-line
//   <Tooltip title="Extruded Boss/Base" description="Pull a sketch profile
//            into a solid." hint="E"><button …/></Tooltip>           // rich

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

const DELAY = 350;
const PAD = 8;

export function Tooltip({ label, hint, title, description, placement = 'bottom', children }) {
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

  // A single element child is required; guard so a missing / multiple child
  // fails loudly in dev instead of silently dropping the trigger handlers.
  const child = React.Children.only(children);
  const isRich = !!(title || description);
  const headLabel = title || label;

  return (
    <>
      {React.cloneElement(child, {
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
             className={`fds-tooltip${isRich ? ' fds-tooltip--rich' : ''}`}
             style={{
               position: 'fixed',
               left: pos?.x ?? -9999,
               top: pos?.y ?? -9999,
             }}>
          {isRich ? (
            <>
              <div className="fds-tooltip-head">
                <span className="fds-tooltip-title">{headLabel}</span>
                {hint && <kbd className="fds-kbd">{hint}</kbd>}
              </div>
              {description && <div className="fds-tooltip-desc">{description}</div>}
            </>
          ) : (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--fds-space-4)' }}>
              <span>{label}</span>
              {hint && <kbd className="fds-kbd">{hint}</kbd>}
            </div>
          )}
        </div>
      )}
    </>
  );
}
