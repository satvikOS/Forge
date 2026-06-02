// Forge-183 — Autosave recovery banner.
//
// Mounted by App.jsx. On first render, checks for a recoverable autosave
// (newer than the last manual save) and offers Restore / Discard. Once
// the user acts, the banner persists `forge.v4.last_save_ts` so it
// doesn't re-prompt on the next launch with the same state.

import React from 'react';
import { createPortal } from 'react-dom';
import {
  hasRecoverableSession, latest, clear, markManualSave, installWindowApis,
} from './autoSave.js';

const bannerStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h) + 4px)',
  left: '50%', transform: 'translateX(-50%)',
  zIndex: 1300,
  background: 'var(--forge-canvas-2)',
  border: '1px solid var(--forge-accent)',
  borderRadius: 4,
  padding: '8px 14px',
  display: 'flex', alignItems: 'center', gap: 10,
  color: 'var(--forge-ink)', fontSize: 12,
  boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
  fontFamily: 'var(--forge-mono)',
};

const buttonStyle = {
  background: 'var(--forge-accent)',
  border: 'none', color: '#0a0e14',
  padding: '4px 10px', cursor: 'pointer',
  fontWeight: 600, fontFamily: 'var(--forge-mono)',
  fontSize: 11,
};

const dismissStyle = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)',
  padding: '4px 10px', cursor: 'pointer',
  fontFamily: 'var(--forge-mono)',
  fontSize: 11,
};

export function AutoSaveRecoveryHost() {
  const [shown, setShown] = React.useState(false);
  const [autosave, setAutosave] = React.useState(null);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    installWindowApis();
    if (hasRecoverableSession()) {
      const data = latest();
      if (data) {
        setAutosave(data);
        setShown(true);
      }
    }
  }, []);

  const onRestore = React.useCallback(() => {
    if (!autosave) return;
    // Push the scene's feature tree + body metadata back via the shell.
    if (typeof window.__forgeReplaceFeatureTree === 'function') {
      window.__forgeReplaceFeatureTree(autosave.scene.featureTree || []);
    }
    if (typeof window.__forgeSetBodies === 'function') {
      window.__forgeSetBodies(autosave.scene.bodies || []);
    }
    markManualSave();
    setShown(false);
  }, [autosave]);

  const onDiscard = React.useCallback(() => {
    clear();
    markManualSave();
    setShown(false);
  }, []);

  if (typeof document === 'undefined' || !shown || !autosave) return null;
  const minutesAgo = Math.max(1, Math.round((Date.now() - autosave.timestamp) / 60000));
  return createPortal(
    <div style={bannerStyle} data-testid="forge-autosave-banner">
      <span>↺ Autosave from {minutesAgo} min ago available
            ({(autosave.scene.bodies || []).length} bodies,
             {(autosave.scene.featureTree || []).length} feature{(autosave.scene.featureTree || []).length === 1 ? '' : 's'}).</span>
      <button type="button" onClick={onRestore}
              style={buttonStyle} data-testid="forge-autosave-restore">
        Restore
      </button>
      <button type="button" onClick={onDiscard}
              style={dismissStyle} data-testid="forge-autosave-discard">
        Discard
      </button>
    </div>,
    document.body,
  );
}

export default AutoSaveRecoveryHost;
