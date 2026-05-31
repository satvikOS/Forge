/**
 * ContextMenu — right-click contextual menu for Forge (Forge-28).
 *
 * Headless logic + minimal styling. Items:
 *   { id, label, icon?, shortcut?, when?: ctx => bool, run: ctx => void, submenu? }
 *
 * Behaviour:
 *   - Renders at the click point, then clamps to the viewport so it
 *     never spills off-screen (flips quadrant if needed).
 *   - Focus trap: arrow up/down navigates; Enter invokes; Escape closes;
 *     Tab is captured and routed to next/previous item.
 *   - Submenus open on hover and on ArrowRight; close on ArrowLeft.
 *   - Per-entity-kind builders registered with `registerMenu(kind, build)`
 *     so body/face/edge/vertex/feature/component can plug in their own
 *     items without editing the widget.
 *
 * Keeps zero global state — the host component owns the open/close
 * boolean. `useContextMenu()` is the convenience hook for that.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  clampToViewport,
  getContextMenuItems,
  listRegisteredKinds,
  registerContextMenu,
} from './ContextMenu.logic.js';

export { clampToViewport, getContextMenuItems, listRegisteredKinds, registerContextMenu };

// ---------------------------------------------------------- hook
export function useContextMenu() {
  const [state, setState] = useState(null); // { x, y, items, ctx } | null
  const open = useCallback((x, y, items, ctx = {}) => setState({ x, y, items, ctx }), []);
  const openForKind = useCallback((x, y, kind, ctx = {}) =>
    setState({ x, y, items: getContextMenuItems(kind, ctx), ctx }), []);
  const close = useCallback(() => setState(null), []);
  return { state, open, openForKind, close };
}

// ---------------------------------------------------------- component
const STYLES = {
  root: {
    position: 'fixed', minWidth: 200, maxWidth: 320,
    background: '#1f2024', color: '#e8e8ea',
    border: '1px solid #2c2d33', borderRadius: 6,
    boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
    padding: 4, zIndex: 10000,
    fontFamily: 'system-ui, -apple-system, sans-serif', fontSize: 13,
    outline: 'none',
  },
  item: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '6px 10px', borderRadius: 4, cursor: 'pointer',
    userSelect: 'none',
  },
  itemActive: { background: '#2c5cff' },
  itemDisabled: { color: '#7a7c83', cursor: 'not-allowed' },
  shortcut: { marginLeft: 'auto', color: '#9a9ca5', fontSize: 11 },
  separator: { height: 1, background: '#2c2d33', margin: '4px 6px' },
  submenuArrow: { marginLeft: 6, color: '#9a9ca5' },
};

/**
 * <ContextMenu> — controlled component. The host opens it (via
 * `useContextMenu`) and passes `state.x/y/items/ctx`; `onClose` fires when
 * the user clicks an item / clicks outside / hits Escape.
 */
export function ContextMenu({ state, onClose, viewport = null }) {
  const rootRef = useRef(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [openSubmenu, setOpenSubmenu] = useState(-1);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  // Reset selection each time the menu opens.
  useEffect(() => {
    if (!state) return;
    setActiveIndex(0);
    setOpenSubmenu(-1);
    setPos({ x: state.x, y: state.y });
  }, [state]);

  // Edge-clamp once we have actual measurements.
  useEffect(() => {
    if (!state || !rootRef.current) return;
    const r = rootRef.current.getBoundingClientRect();
    const vw = viewport?.w ?? (typeof window !== 'undefined' ? window.innerWidth : 1024);
    const vh = viewport?.h ?? (typeof window !== 'undefined' ? window.innerHeight : 768);
    const clamped = clampToViewport({
      x: state.x, y: state.y, w: r.width, h: r.height, viewportW: vw, viewportH: vh,
    });
    if (clamped.x !== pos.x || clamped.y !== pos.y) setPos(clamped);
    // Focus the menu for keyboard nav.
    rootRef.current.focus?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, viewport]);

  // Click-outside → close.
  useEffect(() => {
    if (!state) return undefined;
    const onMouseDown = (ev) => {
      if (rootRef.current && !rootRef.current.contains(ev.target)) onClose?.();
    };
    document.addEventListener('mousedown', onMouseDown, true);
    return () => document.removeEventListener('mousedown', onMouseDown, true);
  }, [state, onClose]);

  const items = state?.items ?? [];
  const enabledIndices = useMemo(
    () => items.map((it, i) => (it.disabled || it.separator ? -1 : i)).filter((i) => i >= 0),
    [items],
  );

  const onKeyDown = (ev) => {
    if (!items.length) return;
    if (ev.key === 'Escape') { ev.preventDefault(); onClose?.(); return; }
    if (ev.key === 'ArrowDown' || ev.key === 'Tab') {
      ev.preventDefault();
      const cur = enabledIndices.indexOf(activeIndex);
      const next = enabledIndices[(cur + 1 + enabledIndices.length) % enabledIndices.length];
      setActiveIndex(next);
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      const cur = enabledIndices.indexOf(activeIndex);
      const next = enabledIndices[(cur - 1 + enabledIndices.length) % enabledIndices.length];
      setActiveIndex(next);
    } else if (ev.key === 'ArrowRight') {
      const it = items[activeIndex];
      if (it?.submenu) setOpenSubmenu(activeIndex);
    } else if (ev.key === 'ArrowLeft') {
      setOpenSubmenu(-1);
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      const it = items[activeIndex];
      if (it && it.run) {
        it.run(state.ctx);
        onClose?.();
      }
    }
  };

  if (!state) return null;

  return (
    <div
      ref={rootRef}
      role="menu"
      tabIndex={-1}
      data-forge-context-menu
      style={{ ...STYLES.root, left: pos.x, top: pos.y }}
      onKeyDown={onKeyDown}
      onContextMenu={(ev) => ev.preventDefault()}
    >
      {items.map((it, i) => {
        if (it.separator) {
          // eslint-disable-next-line react/no-array-index-key
          return <div key={`sep-${i}`} style={STYLES.separator} />;
        }
        const active = i === activeIndex;
        const disabled = !!it.disabled;
        const style = {
          ...STYLES.item,
          ...(active && !disabled ? STYLES.itemActive : null),
          ...(disabled ? STYLES.itemDisabled : null),
        };
        return (
          <div
            key={it.id || `it-${i}`}
            role="menuitem"
            data-forge-menu-item={it.id || ''}
            style={style}
            onMouseEnter={() => setActiveIndex(i)}
            onClick={() => {
              if (disabled) return;
              if (it.submenu) { setOpenSubmenu(i); return; }
              it.run?.(state.ctx);
              onClose?.();
            }}
          >
            {it.icon ? <span aria-hidden style={{ width: 14 }}>{it.icon}</span> : <span style={{ width: 14 }} />}
            <span>{it.label}</span>
            {it.shortcut ? <span style={STYLES.shortcut}>{it.shortcut}</span> : null}
            {it.submenu ? <span style={STYLES.submenuArrow}>▸</span> : null}
            {it.submenu && openSubmenu === i ? (
              <ContextMenu
                state={{ x: pos.x + 200, y: pos.y + i * 28, items: it.submenu, ctx: state.ctx }}
                onClose={onClose}
                viewport={viewport}
              />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export default ContextMenu;
