// Forge-195 — Multi-window helper.
//
// On mount: read the URL hash for `wb=<id>` and switch the shell's
// active workbench accordingly. Adds a small "New window" button next
// to the locale picker that calls window.forge.win.newWindow with the
// current workbench. Also exposes `window.__forgeNewWindow` for
// programmatic use.

import React from 'react';
import { createPortal } from 'react-dom';

const buttonStyle = {
  position: 'fixed',
  top: 6,
  right: 110,
  zIndex: 1450,
  background: 'var(--forge-canvas-2)',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)',
  padding: '2px 8px',
  borderRadius: 3,
  cursor: 'pointer',
  fontSize: 11,
  fontFamily: 'var(--forge-mono)',
};

function parseHashWb() {
  if (typeof window === 'undefined') return null;
  const h = window.location.hash || '';
  const m = h.match(/wb=([^&]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

export function MultiWindowHost() {
  const [, rerender] = React.useState(0);
  const [windowCount, setWindowCount] = React.useState(0);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const wb = parseHashWb();
    if (wb && typeof window.__forgeSetActiveWb === 'function') {
      // Defer to let the shell mount + register its window hooks.
      setTimeout(() => {
        try { window.__forgeSetActiveWb(wb); }
        catch {}
      }, 800);
    }
    window.__forgeNewWindow = async (opts) => {
      const f = window.forge;
      if (!f?.win?.newWindow) return { ok: false, error: 'forge.win unavailable' };
      const r = await f.win.newWindow(opts || {});
      if (r.ok) {
        const list = await f.win.listWindows();
        setWindowCount(list.count);
      }
      return r;
    };
    window.__forgeListWindows = async () => {
      const f = window.forge;
      if (!f?.win?.listWindows) return { ids: [], count: 0 };
      const r = await f.win.listWindows();
      setWindowCount(r.count);
      return r;
    };
    return undefined;
  }, []);

  const onClick = React.useCallback(async () => {
    const initialWb = (typeof window !== 'undefined' && window.__forgeActiveWb) || 'mech';
    if (typeof window.__forgeNewWindow === 'function') {
      const r = await window.__forgeNewWindow({ initialWb });
      rerender((n) => n + 1);
      return r;
    }
  }, []);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <button onClick={onClick} style={buttonStyle}
            data-testid="forge-newwindow-button"
            title="Open a new window with the current workbench">
      ⧉ New window  {windowCount > 0 ? `(${windowCount})` : ''}
    </button>,
    document.body,
  );
}

export default MultiWindowHost;
