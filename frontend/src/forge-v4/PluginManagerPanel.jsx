// Forge-134 — Plugin Manager panel + host.
//
// Modal panel listing every installed plugin with enable/disable + uninstall
// controls, plus Install-from-URL, Install-from-File, and Install-from-String
// entry points.
//
// Mount model mirrors the StandardPartsLibraryHost pattern:
//   - <PluginManagerPanelHost /> mounted in App.jsx
//   - Self-publishes `window.__forgeOpenPluginManager(true|false)` so the
//     Menus.jsx `tools.plugins` action routes through ForgeShellV4's
//     `default` case without the shell needing to import the panel.
//   - Bootstraps the plugin runtime on mount: installs window.Forge, then
//     auto-loads any plugins persisted in localStorage.
//
// Manual UI clicks NEVER write to Archie's thread.

import React, { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  install as pmInstall,
  loadFromString,
  loadFromUrl,
  uninstall as pmUninstall,
  enable as pmEnable,
  disable as pmDisable,
  listPlugins,
  subscribe,
  bootstrap,
} from './pluginManager.js';
import { showToast } from './Toast.jsx';
import { installForgeAPI } from './forgeAPI.js';

/* =====================================================================
 * Styling. Mirrors StressTestPanel / StandardPartsLibrary tokens so the
 * panel reads as native chrome instead of a debug drawer.
 * ===================================================================== */

const backdropStyle = {
  position: 'fixed',
  inset: 0,
  zIndex: 1700,
  background: 'rgba(0, 0, 0, 0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'auto',
};

const panelStyle = {
  width: 560,
  maxHeight: '80vh',
  background: 'rgba(13, 18, 26, 0.98)',
  color: '#ebecef',
  fontFamily: 'var(--forge-sans, -apple-system, ui-sans-serif, system-ui)',
  fontSize: 12,
  border: '1px solid var(--forge-rail-edge, #1f2a37)',
  borderRadius: 8,
  boxShadow: '0 16px 48px rgba(0, 0, 0, 0.6)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 18px',
  borderBottom: '1px solid #1f2a37',
};

const titleStyle = {
  fontSize: 14,
  fontWeight: 600,
  letterSpacing: '0.02em',
};

const closeBtnStyle = {
  background: 'transparent',
  border: 'none',
  color: '#9aa3ad',
  cursor: 'pointer',
  fontSize: 18,
  lineHeight: 1,
  padding: 4,
};

const actionsRowStyle = {
  display: 'flex',
  gap: 8,
  padding: '12px 18px',
  borderBottom: '1px solid #1f2a37',
  flexWrap: 'wrap',
};

const buttonStyle = {
  background: '#1f2a37',
  color: '#ebecef',
  border: '1px solid #2a3a4d',
  borderRadius: 5,
  padding: '7px 12px',
  cursor: 'pointer',
  fontFamily: 'inherit',
  fontSize: 12,
};

const dangerBtnStyle = {
  ...buttonStyle,
  background: '#3a2326',
  borderColor: '#572d2d',
};

const listStyle = {
  overflowY: 'auto',
  flex: 1,
  padding: '8px 0',
};

const rowStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr auto auto',
  alignItems: 'center',
  gap: 12,
  padding: '10px 18px',
  borderBottom: '1px solid #15202b',
};

const rowMetaStyle = {
  display: 'flex',
  alignItems: 'baseline',
  gap: 8,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
  color: '#9aa3ad',
  marginTop: 3,
};

const emptyStateStyle = {
  padding: '36px 18px',
  textAlign: 'center',
  color: '#6b7380',
  fontSize: 12,
  lineHeight: 1.6,
};

const inlineModalStyle = {
  ...panelStyle,
  width: 480,
  maxHeight: '70vh',
};

/* =====================================================================
 * Inline modal — used for paste-source plugin install and URL prompt.
 * Avoids window.prompt so we can paste a multi-line snippet.
 * ===================================================================== */

function InstallStringModal({ open, title, placeholder, onSubmit, onClose, multiline = true }) {
  const [value, setValue] = useState('');
  useEffect(() => { if (open) setValue(''); }, [open]);
  if (!open) return null;
  return createPortal(
    <div style={{ ...backdropStyle, zIndex: 1800 }}
         data-testid="forge-plugin-install-modal">
      <div style={inlineModalStyle}>
        <div style={headerStyle}>
          <span style={titleStyle}>{title}</span>
          <button type="button"
                  style={closeBtnStyle}
                  onClick={onClose}
                  aria-label="Close"
                  data-testid="forge-plugin-install-cancel">×</button>
        </div>
        <div style={{ padding: 18, flex: 1 }}>
          {multiline ? (
            <textarea value={value}
                      onChange={(e) => setValue(e.target.value)}
                      placeholder={placeholder}
                      data-testid="forge-plugin-install-input"
                      style={{
                        width: '100%',
                        minHeight: 240,
                        padding: 10,
                        background: '#0a0e14',
                        color: '#ebecef',
                        border: '1px solid #2a3a4d',
                        borderRadius: 5,
                        fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                        fontSize: 11,
                        resize: 'vertical',
                      }} />
          ) : (
            <input type="text"
                   value={value}
                   onChange={(e) => setValue(e.target.value)}
                   placeholder={placeholder}
                   data-testid="forge-plugin-install-input"
                   style={{
                     width: '100%',
                     padding: '8px 10px',
                     background: '#0a0e14',
                     color: '#ebecef',
                     border: '1px solid #2a3a4d',
                     borderRadius: 5,
                     fontFamily: 'inherit',
                     fontSize: 12,
                   }} />
          )}
        </div>
        <div style={{ padding: '12px 18px', display: 'flex', gap: 8,
                      justifyContent: 'flex-end', borderTop: '1px solid #1f2a37' }}>
          <button type="button"
                  style={buttonStyle}
                  onClick={onClose}>Cancel</button>
          <button type="button"
                  style={{ ...buttonStyle, background: '#2a4a7d', borderColor: '#3d6fb8' }}
                  data-testid="forge-plugin-install-submit"
                  onClick={() => { onSubmit(value); }}>
            Install
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}

/* =====================================================================
 * The main PluginManagerPanel UI.
 * ===================================================================== */

export function PluginManagerPanel({ open, onClose }) {
  const [plugins, setPlugins] = useState(() => listPlugins());
  const [installModal, setInstallModal] = useState(null);  // null | 'string' | 'url' | 'file'
  const fileInputRef = React.useRef(null);

  useEffect(() => {
    const off = subscribe((next) => setPlugins(next));
    setPlugins(listPlugins());
    return off;
  }, []);

  const handleInstallString = useCallback((src) => {
    if (!src || !src.trim()) {
      showToast({ kind: 'warn', text: 'Empty plugin source', ttl: 1500 });
      return;
    }
    try {
      const rec = loadFromString(src.trim());
      showToast({
        kind: 'ok',
        text: `Installed "${rec.manifest.name}" v${rec.manifest.version}`,
        ttl: 2200,
      });
      setInstallModal(null);
    } catch (err) {
      showToast({ kind: 'err', text: `Install failed: ${err.message}`, ttl: 4000 });
    }
  }, []);

  const handleInstallUrl = useCallback(async (url) => {
    if (!url || !url.trim()) {
      showToast({ kind: 'warn', text: 'Empty URL', ttl: 1500 });
      return;
    }
    try {
      const rec = await loadFromUrl(url.trim());
      showToast({
        kind: 'ok',
        text: `Installed "${rec.manifest.name}" from URL`,
        ttl: 2200,
      });
      setInstallModal(null);
    } catch (err) {
      showToast({ kind: 'err', text: `URL install failed: ${err.message}`, ttl: 4000 });
    }
  }, []);

  const handleInstallFile = useCallback(async (file) => {
    if (!file) return;
    try {
      const text = await file.text();
      const rec = loadFromString(text);
      showToast({
        kind: 'ok',
        text: `Installed "${rec.manifest.name}" from ${file.name}`,
        ttl: 2200,
      });
    } catch (err) {
      showToast({ kind: 'err', text: `File install failed: ${err.message}`, ttl: 4000 });
    }
    // Reset the input so the same file can be re-selected.
    if (fileInputRef.current) fileInputRef.current.value = '';
  }, []);

  const handleToggle = useCallback((rec) => {
    try {
      if (rec.status === 'live') {
        pmDisable(rec.name);
        showToast({ kind: 'info', text: `Disabled ${rec.name}`, ttl: 1500 });
      } else {
        pmEnable(rec.name);
        showToast({ kind: 'ok', text: `Enabled ${rec.name}`, ttl: 1500 });
      }
    } catch (err) {
      showToast({ kind: 'err', text: `Toggle failed: ${err.message}`, ttl: 3000 });
    }
  }, []);

  const handleUninstall = useCallback((rec) => {
    try {
      pmUninstall(rec.name);
      showToast({ kind: 'info', text: `Uninstalled ${rec.name}`, ttl: 1500 });
    } catch (err) {
      showToast({ kind: 'err', text: `Uninstall failed: ${err.message}`, ttl: 3000 });
    }
  }, []);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <>
      <div style={backdropStyle}
           role="dialog"
           aria-label="Plugin Manager"
           data-testid="forge-plugin-manager">
        <div style={panelStyle}>
          <div style={headerStyle}>
            <span style={titleStyle}>Plugin Manager · v4</span>
            <button type="button"
                    style={closeBtnStyle}
                    onClick={onClose}
                    aria-label="Close plugin manager"
                    data-testid="forge-plugin-manager-close">×</button>
          </div>
          <div style={actionsRowStyle}>
            <button type="button"
                    style={buttonStyle}
                    onClick={() => setInstallModal('string')}
                    data-testid="forge-plugin-install-string-btn">
              Install from String
            </button>
            <button type="button"
                    style={buttonStyle}
                    onClick={() => setInstallModal('url')}
                    data-testid="forge-plugin-install-url-btn">
              Install from URL
            </button>
            <button type="button"
                    style={buttonStyle}
                    onClick={() => fileInputRef.current?.click()}
                    data-testid="forge-plugin-install-file-btn">
              Install from File
            </button>
            <input ref={fileInputRef}
                   type="file"
                   accept=".js,.json,application/javascript,application/json,text/plain"
                   style={{ display: 'none' }}
                   data-testid="forge-plugin-install-file-input"
                   onChange={(e) => {
                     const f = e.target.files?.[0];
                     if (f) handleInstallFile(f);
                   }} />
            <span style={{
              flex: 1,
              textAlign: 'right',
              alignSelf: 'center',
              color: '#6cd0e8',
              fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
              fontSize: 10,
            }}>
              API v{(typeof window !== 'undefined' && window.Forge?.VERSION) || '—'}
            </span>
          </div>
          <div style={listStyle} data-testid="forge-plugin-list">
            {plugins.length === 0 ? (
              <div style={emptyStateStyle}>
                No plugins installed.<br />
                Use the buttons above to add one.
              </div>
            ) : plugins.map((rec) => (
              <div key={rec.name}
                   style={rowStyle}
                   data-testid={`forge-plugin-row-${rec.name}`}
                   data-status={rec.status}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {rec.manifest?.name || rec.name}
                    <span style={{
                      marginLeft: 8,
                      fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                      fontSize: 10,
                      color: '#6cd0e8',
                    }}>
                      v{rec.manifest?.version || '?'}
                    </span>
                  </div>
                  <div style={rowMetaStyle}>
                    <span>by {rec.manifest?.author || 'unknown'}</span>
                    <span>·</span>
                    <span data-testid={`forge-plugin-hooks-${rec.name}`}>
                      hooks {(rec.manifest?.hooks || []).length}
                    </span>
                    <span>·</span>
                    <span data-testid={`forge-plugin-menus-${rec.name}`}>
                      menus {(rec.manifest?.menuContributions || []).length}
                    </span>
                    <span>·</span>
                    <span>
                      tools {(rec.manifest?.toolContributions || []).length}
                    </span>
                    {rec.status === 'error' && (
                      <>
                        <span>·</span>
                        <span style={{ color: '#ff8888' }}>
                          {rec.error || 'error'}
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <button type="button"
                        style={{
                          ...buttonStyle,
                          background: rec.status === 'live' ? '#243d36' : '#1f2a37',
                          borderColor: rec.status === 'live' ? '#3d7d65' : '#2a3a4d',
                          color: rec.status === 'live' ? '#7ec97e' : '#ebecef',
                        }}
                        onClick={() => handleToggle(rec)}
                        data-testid={`forge-plugin-toggle-${rec.name}`}>
                  {rec.status === 'live' ? 'Enabled' : 'Disabled'}
                </button>
                <button type="button"
                        style={dangerBtnStyle}
                        onClick={() => handleUninstall(rec)}
                        data-testid={`forge-plugin-uninstall-${rec.name}`}>
                  Uninstall
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
      <InstallStringModal
        open={installModal === 'string'}
        title="Install plugin from string"
        placeholder={`// @name my-plugin\n// @version 1.0.0\n// @author you\nForge.toast('hello from plugin', 'ok');`}
        multiline={true}
        onSubmit={handleInstallString}
        onClose={() => setInstallModal(null)} />
      <InstallStringModal
        open={installModal === 'url'}
        title="Install plugin from URL"
        placeholder="https://example.com/my-plugin.js"
        multiline={false}
        onSubmit={handleInstallUrl}
        onClose={() => setInstallModal(null)} />
    </>,
    document.body
  );
}

/* =====================================================================
 * Self-mounting host. Bootstraps window.Forge + auto-loads persisted
 * plugins on first mount. Subscribes window.__forgeOpenPluginManager
 * so the Tools > Plugin Manager menu action opens the panel.
 * ===================================================================== */

export function PluginManagerPanelHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Install window.Forge FIRST so plugins evaluated during bootstrap
    // see the public API.
    installForgeAPI();
    // Then bootstrap persisted plugins.
    try { bootstrap(); } catch (err) {
      console.warn('[forge.v4.plugins] bootstrap failed:', err);
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenPluginManager = (v) =>
      setOpen(v === undefined ? true : !!v);
    return () => {
      try { delete window.__forgeOpenPluginManager; } catch {}
    };
  }, []);

  return <PluginManagerPanel open={open} onClose={() => setOpen(false)} />;
}

export default PluginManagerPanel;
