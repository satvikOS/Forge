/**
 * WorkspaceShell — the v2 top-level layout.
 *
 * CSS grid: title bar / ribbon / document tabs / [left dock | viewport |
 * right dock] / status bar. Each dock zone is independently resizable
 * via a keyboard-accessible separator. Layout state (sizes, collapsed,
 * theme) persists in localStorage under `forge.layout.v2`.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Icon } from '../../design-system/icons/Icon.jsx';

const LAYOUT_KEY = 'forge.layout.v2';

const DEFAULT_LAYOUT = {
  leftDockWidth: 280,
  rightDockWidth: 360,
  bottomDockHeight: 220,
  leftCollapsed: false,
  rightCollapsed: false,
  bottomCollapsed: true,
};

function loadLayout() {
  if (typeof localStorage === 'undefined') return DEFAULT_LAYOUT;
  try {
    const raw = localStorage.getItem(LAYOUT_KEY);
    return raw ? { ...DEFAULT_LAYOUT, ...JSON.parse(raw) } : DEFAULT_LAYOUT;
  } catch { return DEFAULT_LAYOUT; }
}

function saveLayout(l) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(l)); } catch { /* quota */ }
}

/** Drag-or-key-resizable separator. */
function Resizer({ orientation, onResize, ariaLabel, min = 160, max = 900, value }) {
  const startVal = useRef(0);
  const dragging = useRef(false);

  const onPointerDown = (e) => {
    dragging.current = true;
    startVal.current = { x: e.clientX, y: e.clientY, v: value };
    e.target.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e) => {
    if (!dragging.current) return;
    const delta = orientation === 'vertical'
      ? (startVal.current.x - e.clientX)
      : (startVal.current.y - e.clientY);
    const next = Math.max(min, Math.min(max, startVal.current.v + (orientation === 'vertical' ? -delta : delta)));
    onResize(next);
  };
  const onPointerUp = () => { dragging.current = false; };
  const onKey = (e) => {
    const step = e.shiftKey ? 32 : 8;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { onResize(Math.max(min, value - step)); e.preventDefault(); }
    else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { onResize(Math.min(max, value + step)); e.preventDefault(); }
    else if (e.key === 'Home') { onResize(min); e.preventDefault(); }
    else if (e.key === 'End') { onResize(max); e.preventDefault(); }
  };

  return (
    <div
      role="separator"
      aria-orientation={orientation === 'vertical' ? 'vertical' : 'horizontal'}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onKeyDown={onKey}
      style={{
        flex: '0 0 auto',
        width:  orientation === 'vertical'   ? 6 : 'auto',
        height: orientation === 'horizontal' ? 6 : 'auto',
        background: 'transparent',
        cursor: orientation === 'vertical' ? 'col-resize' : 'row-resize',
        outline: 'none',
        position: 'relative',
        zIndex: 2,
      }}
    >
      <div style={{
        position: 'absolute', inset: 0,
        background: 'var(--border-subtle)',
        opacity: 0.5,
        margin: orientation === 'vertical' ? '0 2px' : '2px 0',
      }} />
    </div>
  );
}

export function WorkspaceShell({
  titleBar,
  ribbon,
  documentTabs,
  leftDock,
  rightDock,
  bottomDock,
  viewport,
  statusBar,
}) {
  const [layout, setLayoutState] = useState(loadLayout);
  const setLayout = useCallback((patch) => {
    setLayoutState((cur) => {
      const next = typeof patch === 'function' ? patch(cur) : { ...cur, ...patch };
      saveLayout(next);
      return next;
    });
  }, []);

  // Compute grid template
  const leftW  = layout.leftCollapsed  ? 36 : layout.leftDockWidth;
  const rightW = layout.rightCollapsed ? 36 : layout.rightDockWidth;
  const botH   = layout.bottomCollapsed ? 0  : layout.bottomDockHeight;

  return (
    <div className="forge-root" data-forge-theme={typeof document !== 'undefined' ? (document.documentElement.dataset.forgeTheme || 'dark') : 'dark'}
      style={{
        display: 'grid',
        gridTemplateRows: 'auto auto auto 1fr auto auto',
        height: '100vh',
        width: '100vw',
        overflow: 'hidden',
        background: 'var(--surface-app)',
        color: 'var(--text-primary)',
        font: 'var(--text-base) var(--font-sans)',
      }}>
      {/* TITLE BAR */}
      <div style={{
        gridRow: 1,
        background: 'var(--surface-panel)',
        borderBottom: '1px solid var(--border-subtle)',
        padding: 'var(--space-3) var(--space-7)',
      }}>{titleBar}</div>

      {/* RIBBON */}
      <div style={{
        gridRow: 2,
        background: 'var(--surface-raised)',
        borderBottom: '1px solid var(--border-subtle)',
      }}>{ribbon}</div>

      {/* DOCUMENT TABS */}
      <div style={{
        gridRow: 3,
        background: 'var(--surface-panel)',
        borderBottom: '1px solid var(--border-subtle)',
      }}>{documentTabs}</div>

      {/* MAIN: left dock | viewport | right dock */}
      <div style={{
        gridRow: 4,
        display: 'flex',
        minHeight: 0,
        background: 'var(--surface-app)',
      }}>
        {/* LEFT */}
        <aside style={{
          flex: `0 0 ${leftW}px`,
          background: 'var(--surface-panel)',
          borderRight: '1px solid var(--border-subtle)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <DockHeader
            label="Left"
            collapsed={layout.leftCollapsed}
            onToggle={() => setLayout({ leftCollapsed: !layout.leftCollapsed })}
            side="left"
          />
          {!layout.leftCollapsed && (
            <div style={{ flex: 1, overflowY: 'auto' }}>{leftDock}</div>
          )}
        </aside>

        {!layout.leftCollapsed && (
          <Resizer
            orientation="vertical"
            value={layout.leftDockWidth}
            onResize={(v) => setLayout({ leftDockWidth: v })}
            ariaLabel="Resize left panel"
            min={200} max={500}
          />
        )}

        {/* VIEWPORT */}
        <main style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
            {viewport}
          </div>
          {!layout.bottomCollapsed && (
            <>
              <Resizer
                orientation="horizontal"
                value={layout.bottomDockHeight}
                onResize={(v) => setLayout({ bottomDockHeight: v })}
                ariaLabel="Resize bottom panel"
                min={120} max={520}
              />
              <div style={{
                flex: `0 0 ${botH}px`,
                background: 'var(--surface-panel)',
                borderTop: '1px solid var(--border-subtle)',
                overflow: 'auto',
              }}>{bottomDock}</div>
            </>
          )}
        </main>

        {!layout.rightCollapsed && (
          <Resizer
            orientation="vertical"
            value={layout.rightDockWidth}
            onResize={(v) => setLayout({ rightDockWidth: v })}
            ariaLabel="Resize right panel"
            min={280} max={640}
          />
        )}

        {/* RIGHT */}
        <aside style={{
          flex: `0 0 ${rightW}px`,
          background: 'var(--surface-panel)',
          borderLeft: '1px solid var(--border-subtle)',
          display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}>
          <DockHeader
            label="Right"
            collapsed={layout.rightCollapsed}
            onToggle={() => setLayout({ rightCollapsed: !layout.rightCollapsed })}
            side="right"
          />
          {!layout.rightCollapsed && (
            <div style={{ flex: 1, minHeight: 0 }}>{rightDock}</div>
          )}
        </aside>
      </div>

      {/* STATUS BAR */}
      <div style={{
        gridRow: 6,
        background: 'var(--surface-panel)',
        borderTop: '1px solid var(--border-subtle)',
      }}>{statusBar}</div>
    </div>
  );
}

function DockHeader({ label, collapsed, onToggle, side }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: collapsed ? 'var(--space-3)' : 'var(--space-5) var(--space-7)',
      borderBottom: collapsed ? 'none' : '1px solid var(--border-subtle)',
      fontSize: 'var(--text-2xs)',
      color: 'var(--text-tertiary)',
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      writingMode: collapsed ? 'vertical-rl' : 'horizontal-tb',
      transform: collapsed && side === 'left' ? 'rotate(180deg)' : 'none',
    }}>
      {!collapsed && <span>{label}</span>}
      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? `Expand ${label.toLowerCase()} panel` : `Collapse ${label.toLowerCase()} panel`}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: 20, height: 20,
          background: 'transparent', border: 'none', cursor: 'pointer',
          color: 'var(--text-tertiary)',
        }}>
        <Icon name={side === 'left'
          ? (collapsed ? 'chevronRight' : 'chevronLeft')
          : (collapsed ? 'chevronLeft' : 'chevronRight')} size={10} />
      </button>
    </div>
  );
}
