import { useEffect, useState } from 'react';

/**
 * Empty-state hint — shown when scene has no bodies and no design
 * history entries. Renders as a centred, non-blocking floating card
 * over the viewport. Auto-dismisses the moment either count is > 0.
 *
 * Reads from the same window slots the StatusBar polls @ 4 Hz so we
 * never have to thread props through the workbench wrapper. Pure
 * inline styles to keep the diff to a single new file.
 */
export default function EmptyStateHint() {
  const [show, setShow] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const tick = () => {
      try {
        if (dismissed) { setShow(false); return; }
        let bodies = 0;
        const reg = window.__archdiscBodies;
        if (reg) {
          const list = typeof reg.list === 'function' ? reg.list()
            : (Array.isArray(reg.bodies) ? reg.bodies : []);
          bodies = list.length;
        }
        let dhEntries = 0;
        const hist = window.__archdiscHistory;
        if (hist && hist.entries) dhEntries = hist.entries.length;
        setShow(bodies === 0 && dhEntries === 0);
      } catch {
        setShow(false);
      }
    };
    tick();
    const t = setInterval(tick, 600);
    return () => clearInterval(t);
  }, [dismissed]);

  if (!show) return null;

  return (
    <div
      style={{
        position: 'absolute', top: '40%', left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 25,
        pointerEvents: 'none',
        userSelect: 'none',
        maxWidth: 460,
        textAlign: 'center',
        color: '#cbd5e1',
        fontFamily: 'system-ui, -apple-system, sans-serif',
      }}
    >
      <div
        style={{
          background: 'rgba(20,24,32,0.78)',
          border: '1px solid rgba(255,255,255,0.10)',
          borderRadius: 8,
          padding: '22px 28px 16px',
          boxShadow: '0 12px 38px rgba(0,0,0,0.35)',
          backdropFilter: 'blur(6px)',
          pointerEvents: 'auto',
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 6, color: '#e5e7eb' }}>
          Start designing
        </div>
        <div style={{ fontSize: 12, lineHeight: 1.55, color: '#9ca3af' }}>
          Press <kbd style={{
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 4, padding: '1px 6px',
            fontFamily: 'monospace', fontSize: 11, color: '#e5e7eb',
          }}>S</kbd> to start a sketch, click a primitive in the ribbon above (Extrude · Box · Cylinder), or open a saved <code style={{ color: '#cbd5e1' }}>.archdisc.json</code> via the Drawing tab.
        </div>
        <div style={{ fontSize: 11, marginTop: 10, color: '#6b7280' }}>
          Press <kbd style={{
            background: 'rgba(255,255,255,0.08)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 4, padding: '1px 6px',
            fontFamily: 'monospace', fontSize: 11, color: '#e5e7eb',
          }}>?</kbd> any time to see every keyboard shortcut.
        </div>
        <button
          onClick={() => setDismissed(true)}
          style={{
            marginTop: 12,
            background: 'transparent',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: 4,
            color: '#9ca3af',
            cursor: 'pointer',
            padding: '4px 12px',
            fontSize: 11,
            fontFamily: 'inherit',
          }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}
