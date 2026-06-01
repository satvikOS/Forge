// Forge-119 — `.forge` project file save/open panel.
//
// Self-mounted host that registers `window.__forgeOpenProjectFile(mode)`
// where mode is 'save' | 'open'. For 'save' renders a small modal with a
// project-name input + Save button — pressing Save fires the native
// saveFile dialog and writes the .forge archive via `saveProject`. For
// 'open' the modal skips the form and immediately prompts the openFile
// dialog, then calls `loadProject` and pushes the resulting scene back
// to the shell via `restoreScene`.
//
// Pattern matches ProjectBundlePanel (Forge-103) / DirectEditPanel
// (Forge-93): App.jsx mounts `<ProjectFilePanelHost />` once, the host
// registers the window entry point, ForgeShellV4.jsx stays untouched.
//
// Manual button clicks never write to Archie's thread.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { showToast } from './Toast.jsx';
import {
  saveProject, loadProject,
  getCurrentSceneSnapshot, restoreScene,
} from './projectFile.js';

const PANEL_EVENT = 'forge:open-project-file';

// ────────────────────────────── style chunks (v4 tokens)

const overlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'var(--forge-overlay)',
  zIndex: 1400,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};

const panelStyle = {
  width: 460,
  maxWidth: '92vw',
  background: 'var(--forge-canvas-3)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius-lg)',
  boxShadow: '0 24px 64px rgba(0,0,0,0.65)',
  display: 'flex',
  flexDirection: 'column',
  color: 'var(--forge-ink)',
  fontFamily: 'var(--forge-font)',
  fontSize: 12,
  overflow: 'hidden',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--forge-space-2)',
  padding: '10px 14px',
  borderBottom: '1px solid var(--forge-rail-edge)',
  background: 'var(--forge-canvas)',
  fontWeight: 600,
  fontSize: 12,
};

const bodyStyle = {
  padding: 'var(--forge-space-4)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--forge-space-3)',
};

const footerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--forge-space-2)',
  padding: '10px 14px',
  borderTop: '1px solid var(--forge-rail-edge)',
  background: 'var(--forge-canvas)',
};

const sectionLabel = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--forge-ink-mute)',
  fontWeight: 500,
};

const inputStyle = {
  background: 'var(--forge-canvas)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius)',
  color: 'var(--forge-ink)',
  fontFamily: 'inherit',
  fontSize: 13,
  padding: '6px 10px',
  width: '100%',
  outline: 'none',
};

const btnBase = {
  background: 'var(--forge-surface)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius)',
  color: 'var(--forge-ink)',
  fontFamily: 'inherit',
  fontSize: 12,
  padding: '6px 14px',
  cursor: 'pointer',
};

const ctaStyle = {
  ...btnBase,
  background: 'var(--forge-accent-mute)',
  borderColor: 'var(--forge-accent-rim)',
  color: 'var(--forge-ink)',
  fontWeight: 600,
};

// ────────────────────────────── helpers

function safeFileName(s) {
  return String(s ?? 'project')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 96) || 'project';
}

// ────────────────────────────── component

export function ProjectFilePanel({ open, mode, onClose, initialName }) {
  const [name, setName] = useState(initialName || 'Untitled Project');
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null);

  useEffect(() => {
    if (open) {
      setName(initialName || 'Untitled Project');
      setBusy(false);
      setLastResult(null);
    }
  }, [open, initialName]);

  const onSave = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setLastResult(null);
    const forge = (typeof window !== 'undefined' ? window.forge : null);
    try {
      const filepath = forge?.dialog?.saveFile
        ? await forge.dialog.saveFile({
            title: 'Save Project',
            defaultPath: `${safeFileName(name)}.forge`,
            filters: [{ name: 'Forge Project', extensions: ['forge'] }],
          })
        : null;
      if (!filepath) {
        setBusy(false);
        showToast({ kind: 'info', text: 'Save cancelled', ttl: 1500 });
        return;
      }
      const scene = { ...getCurrentSceneSnapshot(), projectName: name };
      const r = await saveProject({ filepath, scene });
      setLastResult(r);
      if (r.ok) {
        const kb = Math.max(1, Math.round(r.bytes / 1024));
        showToast({
          kind: 'ok',
          text: `Project saved · ${kb} KB`,
          hint: r.path,
        });
        onClose?.();
      } else {
        showToast({ kind: 'err', text: `Save failed · ${r.error}` });
      }
    } catch (err) {
      setLastResult({ ok: false, error: err.message });
      showToast({ kind: 'err', text: `Save crashed · ${err.message}` });
    } finally {
      setBusy(false);
    }
  }, [busy, name, onClose]);

  if (!open || mode !== 'save') return null;

  return (
    <div style={overlayStyle}
         role="dialog"
         aria-modal="true"
         aria-label="Save Forge Project"
         data-testid="forge-project-file-overlay"
         onClick={(e) => { if (e.target === e.currentTarget && !busy) onClose?.(); }}>
      <div style={panelStyle}
           data-testid="forge-project-file-panel"
           onClick={(e) => e.stopPropagation()}>
        <header style={headerStyle}>
          <span>Save Project</span>
          <span style={{ flex: 1 }} />
          <button type="button"
                  onClick={() => !busy && onClose?.()}
                  aria-label="Close"
                  data-testid="forge-project-file-close"
                  style={{
                    background: 'transparent', border: 'none',
                    color: 'var(--forge-ink-mute)', cursor: 'pointer',
                    fontSize: 14, padding: 2,
                  }}>×</button>
        </header>

        <div style={bodyStyle}>
          <div>
            <div style={sectionLabel}>Project name</div>
            <input style={{ ...inputStyle, marginTop: 4 }}
                   value={name}
                   onChange={(e) => setName(e.target.value)}
                   spellCheck={false}
                   autoFocus
                   data-testid="forge-project-file-name" />
          </div>

          <div style={{ color: 'var(--forge-ink-mute)', fontSize: 11 }}>
            Saves every body (STEP), feature tree, sketches, configurations,
            PMI, materials, and view state into a single <code>.forge</code> archive.
          </div>

          {lastResult && (
            <div style={{
              padding: 'var(--forge-space-2) var(--forge-space-3)',
              borderRadius: 'var(--forge-radius)',
              border: '1px solid var(--forge-rail-edge)',
              background: 'var(--forge-surface)',
              fontFamily: 'var(--forge-mono)',
              fontSize: 11,
              color: lastResult.ok ? 'var(--forge-ok)' : 'var(--forge-err)',
            }}
                 data-testid="forge-project-file-result">
              {lastResult.ok
                ? `OK · ${lastResult.bytes} bytes → ${lastResult.path}`
                : `ERR · ${lastResult.error}`}
            </div>
          )}
        </div>

        <footer style={footerStyle}>
          <span style={{ flex: 1, color: 'var(--forge-ink-mute)', fontSize: 11 }}>
            .forge — full session archive
          </span>
          <button type="button"
                  style={btnBase}
                  onClick={() => !busy && onClose?.()}
                  data-testid="forge-project-file-cancel">
            Cancel
          </button>
          <button type="button"
                  style={{
                    ...ctaStyle,
                    opacity: busy ? 0.6 : 1,
                    cursor: busy ? 'wait' : 'pointer',
                  }}
                  disabled={busy}
                  onClick={onSave}
                  data-testid="forge-project-file-save">
            {busy ? 'Saving…' : 'Save Project'}
          </button>
        </footer>
      </div>
    </div>
  );
}

// ────────────────────────────── self-mounting host

export function ProjectFilePanelHost() {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState(null); // 'save' | 'open'
  const [initialName, setInitialName] = useState('Untitled Project');
  const mountedRef = useRef(false);
  const openingRef = useRef(false);

  // 'open' mode: immediately prompt the native open dialog and load.
  // No modal — the OS file dialog is the panel.
  const runOpenFlow = useCallback(async () => {
    if (openingRef.current) return;
    openingRef.current = true;
    const forge = (typeof window !== 'undefined' ? window.forge : null);
    try {
      const filepath = forge?.dialog?.openFile
        ? await forge.dialog.openFile({
            title: 'Open Project',
            filters: [{ name: 'Forge Project', extensions: ['forge'] }],
            properties: ['openFile'],
          })
        : null;
      const path = Array.isArray(filepath) ? filepath[0] : filepath;
      if (!path) {
        showToast({ kind: 'info', text: 'Open cancelled', ttl: 1500 });
        return;
      }
      const r = await loadProject(path);
      if (r.ok) {
        restoreScene(r.scene);
        const total = r.scene?.bodies?.length ?? 0;
        const errs = (r.errors || []).length;
        showToast({
          kind: errs ? 'info' : 'ok',
          text: errs
            ? `Project opened · ${total} bodies · ${errs} restore errors`
            : `Project opened · ${total} bodies`,
          hint: path,
        });
      } else {
        showToast({ kind: 'err', text: `Open failed · ${r.error}` });
      }
    } catch (err) {
      showToast({ kind: 'err', text: `Open crashed · ${err.message}` });
    } finally {
      openingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (typeof window === 'undefined') return;

    // window.__forgeOpenProjectFile('save' | 'open')
    window.__forgeOpenProjectFile = (which) => {
      const m = which === 'open' ? 'open' : 'save';
      if (m === 'save') {
        const n = window.__forgeProjectName || 'Untitled Project';
        setInitialName(n);
        setMode('save');
        setOpen(true);
      } else {
        // No modal — immediately prompt the file dialog.
        runOpenFlow();
      }
    };
    window.__forgeCloseProjectFile = () => setOpen(false);

    const onEvt = (e) => {
      const which = (e?.detail && e.detail.mode) || 'save';
      window.__forgeOpenProjectFile(which);
    };
    window.addEventListener(PANEL_EVENT, onEvt);
    return () => {
      window.removeEventListener(PANEL_EVENT, onEvt);
      try { delete window.__forgeOpenProjectFile; } catch {}
      try { delete window.__forgeCloseProjectFile; } catch {}
    };
  }, [runOpenFlow]);

  return <ProjectFilePanel open={open}
                           mode={mode}
                           initialName={initialName}
                           onClose={() => setOpen(false)} />;
}

export default ProjectFilePanel;
