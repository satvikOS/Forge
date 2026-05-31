import React, { useEffect } from 'react';
import PropTypes from 'prop-types';
import './styles.css';
import { AppStateProvider, useAppState } from './state/AppState.js';
import MultiDocumentBar from './MultiDocumentBar.jsx';
import Ribbon from './Ribbon.jsx';
import CommandPalette from './CommandPalette.jsx';
import FeatureTreePanel from './panels/FeatureTreePanel.jsx';
import ConfigurationPanel from './panels/ConfigurationPanel.jsx';
import PropertyPanel from './panels/PropertyPanel.jsx';
import SelectionFilterPanel from './panels/SelectionFilterPanel.jsx';
import StatusBar from './panels/StatusBar.jsx';
import { ForgeProject } from '../kernel/forge/ForgeProject.js';

/**
 * ForgeApp — the top-level Forge React shell (Forge-26).
 *
 * Layout (CSS grid in styles.css):
 *   topbar     — brand + theme toggle + workspace dropdown + settings ⚙
 *   docbar     — multi-document tabs (one per open ForgeProject)
 *   ribbon     — workbench tabs + grouped command buttons
 *   workarea   — dockable panels (left FeatureTree+Configurations,
 *                centre viewport placeholder, right Properties + filter,
 *                bottom viewport tools strip)
 *   status     — coords / units / sel count / kernel ready badge
 *
 * Modals overlay everything: CommandPalette (Cmd+K) and Settings (⚙).
 *
 * The kernel may not load in dev / tests; we render a "kernel detached"
 * banner in the centre region in that case but every panel still mounts
 * because the underlying data models don't require the kernel handle.
 */

function ForgeAppInner() {
  const {
    state,
    activeProject,
    openProject,
    openPalette, closePalette,
    openSettings, closeSettings,
    setTheme,
    setWorkspaceRole,
    selectionFilter,
    propertyManager,
  } = useAppState();

  // Seed an Untitled project the first time the app opens so the user
  // has something to interact with immediately.
  useEffect(() => {
    if (!state.projects || state.projects.length === 0) {
      openProject(new ForgeProject({ name: 'Untitled 1' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global keybindings: Cmd/Ctrl+K opens the palette.
  useEffect(() => {
    function onKey(e) {
      const isMod = e.metaKey || e.ctrlKey;
      if (isMod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        if (state.paletteOpen) closePalette();
        else openPalette();
      } else if (e.key === 'Escape') {
        if (state.paletteOpen) closePalette();
        if (state.settingsOpen) closeSettings();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.paletteOpen, state.settingsOpen, openPalette, closePalette, closeSettings]);

  const proj = activeProject();

  return (
    <div className="forge-app" data-forge-theme={state.theme}>
      {/* ---------- Topbar ---------- */}
      <header className="forge-topbar">
        <span className="brand">FORGE</span>
        <span style={{ color: 'var(--muted)' }}>parametric MCAD</span>
        <span className="spacer" />
        <select
          aria-label="Workspace role"
          value={state.workspaceRole}
          onChange={(e) => setWorkspaceRole(e.target.value)}
        >
          {['Engineer', 'Designer', 'Reviewer'].map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setTheme(state.theme === 'dark' ? 'light' : 'dark')}
          title="Toggle theme"
        >
          {state.theme === 'dark' ? '☀ light' : '☾ dark'}
        </button>
        <button type="button" onClick={openSettings} title="Settings" aria-label="Settings">⚙</button>
        <button type="button" onClick={openPalette} title="Command palette (⌘K)">⌘K</button>
      </header>

      {/* ---------- Document tabs ---------- */}
      <MultiDocumentBar />

      {/* ---------- Ribbon ---------- */}
      <Ribbon />

      {/* ---------- Dockable work area ---------- */}
      <div className="forge-workarea">
        <aside className="forge-dock-left" aria-label="Left dock">
          <FeatureTreePanel tree={proj?.featureTree} />
          <ConfigurationPanel configurations={proj?.configurations} />
        </aside>
        <section className="forge-dock-center" aria-label="Viewport">
          {state.status.kernelReady ? (
            <div style={{ textAlign: 'center', color: 'var(--muted)' }}>
              <div style={{ fontSize: 14, color: 'var(--text)' }}>Viewport</div>
              <div style={{ fontSize: 11 }}>3D canvas — wired in Forge-27</div>
            </div>
          ) : (
            <div style={{ textAlign: 'center', color: 'var(--muted)', maxWidth: 360 }}>
              <div style={{ fontSize: 14, color: 'var(--warn)' }}>Kernel detached</div>
              <div style={{ fontSize: 11, marginTop: 6 }}>
                {state.status.kernelError
                  || 'Running outside Electron — viewport is unavailable but every panel still functions.'}
              </div>
            </div>
          )}
        </section>
        <aside className="forge-dock-right" aria-label="Right dock">
          <PropertyPanel propertyManager={propertyManager} />
          <SelectionFilterPanel filter={selectionFilter} />
        </aside>
        <footer className="forge-dock-bottom" aria-label="Viewport tools">
          <span>◧ left dock</span>
          <span>◨ right dock</span>
          <span>☰ panels</span>
          <span style={{ flex: 1 }} />
          <span>active workbench: {state.activeRibbonTab}</span>
        </footer>
      </div>

      {/* ---------- Status bar ---------- */}
      <StatusBar
        status={state.status}
        units={proj?.units || 'mm'}
        selectionFilter={selectionFilter}
      />

      {/* ---------- Modals ---------- */}
      <CommandPalette />
      {state.settingsOpen ? <SettingsModal onClose={closeSettings} /> : null}
    </div>
  );
}

function SettingsModal({ onClose }) {
  const { state, setTheme, setWorkspaceRole, updateWorkspaceConfig } = useAppState();
  const role = state.workspaceRole;
  const cfg = state.workspaceConfigs[role] || { pinned: [] };
  const pinnedText = (cfg.pinned || []).join(', ');

  return (
    <div className="forge-modal-shade" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="forge-settings" role="dialog" aria-modal="true" aria-label="Settings">
        <h2>Settings</h2>
        <div className="row">
          <label htmlFor="forge-theme">Theme</label>
          <select id="forge-theme" value={state.theme} onChange={(e) => setTheme(e.target.value)}>
            <option value="dark">Dark</option>
            <option value="light">Light</option>
          </select>
        </div>
        <div className="row">
          <label htmlFor="forge-role">Workspace</label>
          <select id="forge-role" value={role} onChange={(e) => setWorkspaceRole(e.target.value)}>
            {['Engineer', 'Designer', 'Reviewer'].map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div className="row">
          <label htmlFor="forge-pinned">Pinned tools</label>
          <input
            id="forge-pinned"
            type="text"
            defaultValue={pinnedText}
            onBlur={(e) => {
              const next = e.target.value.split(',').map((s) => s.trim()).filter(Boolean);
              updateWorkspaceConfig(role, { pinned: next });
            }}
          />
        </div>
        <div className="actions">
          <button type="button" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
SettingsModal.propTypes = { onClose: PropTypes.func.isRequired };

/**
 * Public entry point — wraps the shell in the AppStateProvider so
 * consumers only need to mount <ForgeApp /> in their router.
 */
export default function ForgeApp({ initialProjects = null }) {
  return (
    <AppStateProvider initialProjects={initialProjects}>
      <ForgeAppInner />
    </AppStateProvider>
  );
}
ForgeApp.propTypes = {
  initialProjects: PropTypes.array,
};
