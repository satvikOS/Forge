// Forge-77 — Auto-update banner.
//
// Floats at top-center, just under the title bar, when an update is
// available / downloading / ready. Listens to window.forge.updater
// events. Three states:
//   available  — "Update available · v1.0.123" + Download icon (auto-
//                downloads via main.js autoDownload=true)
//   progress   — "Downloading v1.0.123 · 47%" + animated bar
//   downloaded — "v1.0.123 ready · [Restart now]" button → quitAndInstall

import React, { useEffect, useState } from 'react';
import { Icon } from './icons/Icon.jsx';

export function UpdateBanner() {
  const [event, setEvent] = useState(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.forge?.updater?.onEvent) return;
    const unsub = window.forge.updater.onEvent((ev) => {
      setEvent(ev);
      setDismissed(false);
    });
    return () => unsub?.();
  }, []);

  if (!event || dismissed) return null;
  const { kind, version, percent } = event;
  return (
    <div role="status"
         aria-live="polite"
         data-testid="forge-update-banner"
         data-state={kind}
         style={{
           position: 'fixed',
           top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h) + var(--forge-space-3))',
           left: '50%',
           transform: 'translateX(-50%)',
           background: 'var(--forge-canvas-3)',
           border: '1px solid var(--forge-rail-edge)',
           borderLeft: `3px solid ${
             kind === 'downloaded' ? 'var(--forge-ok)'
             : kind === 'progress' ? 'var(--forge-warn)'
             : 'var(--forge-accent)'}`,
           borderRadius: 'var(--forge-radius)',
           padding: '8px 16px',
           color: 'var(--forge-ink)',
           font: 'inherit', fontSize: 12,
           boxShadow: '0 12px 36px rgba(0,0,0,0.55)',
           display: 'flex', alignItems: 'center', gap: 12,
           minWidth: 360,
           maxWidth: 600,
           zIndex: 2400,
         }}>
      <Icon name={kind === 'downloaded' ? 'sketch.finish' :
                  kind === 'progress'   ? 'edit.redo' :
                                          'misc.theme'} size={14} />
      <span style={{ flex: 1 }}>
        {kind === 'available'  && <>Update available · <strong>v{version}</strong> · downloading…</>}
        {kind === 'progress'   && <>Downloading v{version} · {Math.round(percent || 0)}%</>}
        {kind === 'downloaded' && <>Forge <strong>v{version}</strong> ready · restart to install</>}
      </span>
      {kind === 'progress' && (
        <span style={{
          width: 120, height: 4,
          background: 'var(--forge-surface)',
          borderRadius: 2,
          overflow: 'hidden',
        }}>
          <span style={{
            display: 'block',
            width: `${Math.round(percent || 0)}%`,
            height: '100%',
            background: 'var(--forge-accent)',
            transition: 'width 200ms ease',
          }} />
        </span>
      )}
      {kind === 'downloaded' && (
        <button type="button"
                onClick={() => window.forge?.updater?.quitAndInstall?.()}
                style={{
                  background: 'var(--forge-accent-mute)',
                  border: '1px solid var(--forge-accent)',
                  color: 'var(--forge-ink)',
                  borderRadius: 3,
                  padding: '4px 10px',
                  font: 'inherit', fontSize: 11,
                  cursor: 'pointer',
                }}>
          Restart now
        </button>
      )}
      <button type="button"
              onClick={() => setDismissed(true)}
              aria-label="Dismiss"
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--forge-ink-mute)', cursor: 'pointer',
                display: 'inline-flex', padding: 2,
              }}>
        <Icon name="select.clear" size={12} />
      </button>
    </div>
  );
}
