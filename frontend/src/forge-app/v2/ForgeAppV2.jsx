/**
 * ForgeAppV2 — the polished, industry-grade Forge shell.
 *
 * Wires:
 *   WorkspaceShell + Ribbon + FeatureTreePanel + PropertyPanel +
 *   ArchiePortal + StatusBar.
 *
 * Theme is applied to <html> data-forge-theme; persisted in
 * localStorage. The Archie Portal lives in the right dock; the feature
 * tree in the left dock; the centre is a viewport placeholder until
 * the GPU-instanced viewport from Forge-44 lands.
 *
 * Mounted at hash route `#forge-v2` (in addition to the legacy `#forge`
 * which still mounts the v1 ForgeApp).
 */

import React, { useState, useEffect, useCallback } from 'react';
import '../design-system/tokens.css';
import { Icon } from '../design-system/icons/Icon.jsx';
import { Tooltip } from '../design-system/primitives/Modal.jsx';
import { Tabs } from '../design-system/primitives/Tabs.jsx';
import { Button, IconButton } from '../design-system/primitives/Button.jsx';
import { ToastProvider, ToastHost } from '../design-system/primitives/Toast.jsx';
import { EmptyState } from '../design-system/primitives/EmptyState.jsx';
import { Inline } from '../design-system/primitives/Card.jsx';
import { announce } from '../design-system/a11y.js';
import { WorkspaceShell } from './layout/WorkspaceShell.jsx';
import { Ribbon } from './ribbon/Ribbon.jsx';
import { FeatureTreePanel } from './panels/FeatureTreePanel.jsx';
import { PropertyPanel } from './panels/PropertyPanel.jsx';
import { StatusBar } from './panels/StatusBar.jsx';
import { ArchiePortal } from '../archie-portal/ArchiePortal.jsx';
import { CommandPalette, useCommandPalette } from './overlays/CommandPalette.jsx';
import { WelcomeOverlay } from './overlays/WelcomeOverlay.jsx';
import { SettingsDialog } from './overlays/SettingsDialog.jsx';

const THEME_KEY = 'forge.theme.v2';
const WELCOME_KEY = 'forge.welcome.dismissed';

// Sample command list for the palette. The ribbon's TAB_GROUPS will be
// wired into a unified registry in a follow-up slice; for now we hand-curate
// the most-reached commands here so Cmd+K feels alive.
const PALETTE_COMMANDS = [
  { id: 'file.new',   label: 'New project',        category: 'File',     icon: 'fileNew',  shortcut: 'Cmd N' },
  { id: 'file.open',  label: 'Open project…',      category: 'File',     icon: 'fileOpen', shortcut: 'Cmd O' },
  { id: 'file.save',  label: 'Save',               category: 'File',     icon: 'fileSave', shortcut: 'Cmd S' },
  { id: 'file.export.step',  label: 'Export STEP', category: 'File',     icon: 'fileExport' },
  { id: 'edit.undo',  label: 'Undo',               category: 'Edit',     icon: 'undo',     shortcut: 'Cmd Z' },
  { id: 'edit.redo',  label: 'Redo',               category: 'Edit',     icon: 'redo',     shortcut: 'Cmd Shift Z' },
  { id: 'view.frame', label: 'Frame all',          category: 'View',     icon: 'frame',    shortcut: 'F' },
  { id: 'view.section', label: 'Section view',     category: 'View',     icon: 'cut' },
  { id: 'part.box',   label: 'Box',                category: 'Part',     icon: 'box' },
  { id: 'part.cylinder', label: 'Cylinder',        category: 'Part',     icon: 'cylinder' },
  { id: 'part.extrude', label: 'Extrude',          category: 'Part',     icon: 'extrude',  shortcut: 'E' },
  { id: 'part.fillet', label: 'Fillet',            category: 'Part',     icon: 'fillet',   shortcut: 'F' },
  { id: 'part.hole', label: 'Hole wizard',         category: 'Part',     icon: 'hole' },
  { id: 'sketch.new', label: 'New sketch',         category: 'Sketch',   icon: 'sketchTab', shortcut: 'S' },
  { id: 'sketch.dim', label: 'Smart dimension',    category: 'Sketch',   icon: 'drawingTab', shortcut: 'D' },
  { id: 'asm.mate',   label: 'Mate',               category: 'Assembly', icon: 'mate',     shortcut: 'M' },
  { id: 'asm.explode', label: 'Exploded view',     category: 'Assembly', icon: 'exploded' },
  { id: 'sim.static', label: 'Run static FEA',     category: 'Simulate', icon: 'simulateTab' },
  { id: 'sim.cfd',    label: 'Run CFD',            category: 'Simulate', icon: 'sweep' },
  { id: 'mfg.profile', label: 'CAM profile',       category: 'Manufacture', icon: 'frame' },
  { id: 'mfg.gcode',  label: 'Post G-code',        category: 'Manufacture', icon: 'fileExport' },
  { id: 'settings',   label: 'Open Settings…',     category: 'Tools',    icon: 'settings' },
  { id: 'help.welcome', label: 'Show welcome screen', category: 'Help',  icon: 'help' },
];

export function ForgeAppV2() {
  const [theme, setTheme] = useState(() =>
    (typeof localStorage !== 'undefined' && localStorage.getItem(THEME_KEY)) || 'dark');

  // apply theme to <html>
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.forgeTheme = theme;
    }
    if (typeof localStorage !== 'undefined') localStorage.setItem(THEME_KEY, theme);
  }, [theme]);

  // documents
  const [docs, setDocs] = useState([
    { id: 'd1', name: 'Untitled.forge', dirty: false, project: {
      name: 'Untitled.forge', version: 1, material: 'Steel (1018)',
      featureTree: { list: () => [] },
    }},
  ]);
  const [activeDocId, setActiveDocId] = useState('d1');
  const activeDoc = docs.find((d) => d.id === activeDocId);

  // viewport selection
  const [selection, setSelection] = useState(null);
  const [cursor] = useState(null);

  // Overlays
  const { open: paletteOpen, openPalette, closePalette } = useCommandPalette();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [welcomeOpen, setWelcomeOpen] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(WELCOME_KEY) !== '1';
  });

  // Recent commands stack — capped at 8.
  const [recentCommands, setRecentCommands] = useState([]);

  const onInvoke = useCallback((id, cmd) => {
    announce(`Command: ${cmd?.label || id}`);
    // route a couple of well-known ids locally; others reach the bridge in a follow-up
    if (id === 'settings') { setSettingsOpen(true); return; }
    if (id === 'help.welcome') { setWelcomeOpen(true); return; }
    if (id === 'file.new') { newDoc(); return; }
    setRecentCommands((cur) => [id, ...cur.filter((x) => x !== id)].slice(0, 8));
  }, []);

  const dismissWelcome = () => {
    setWelcomeOpen(false);
    if (typeof localStorage !== 'undefined') localStorage.setItem(WELCOME_KEY, '1');
  };

  const newDoc = () => {
    const id = `d${docs.length + 1}`;
    setDocs([...docs, { id, name: `Untitled-${docs.length + 1}.forge`, dirty: false, project: {
      name: `Untitled-${docs.length + 1}.forge`, version: 1, material: 'Steel (1018)',
      featureTree: { list: () => [] },
    } }]);
    setActiveDocId(id);
  };

  const closeDoc = (id) => {
    setDocs((cur) => {
      const next = cur.filter((d) => d.id !== id);
      if (id === activeDocId) setActiveDocId(next[0]?.id || null);
      return next.length ? next : [{ id: 'd1', name: 'Untitled.forge', dirty: false, project: {
        name: 'Untitled.forge', version: 1, material: 'Steel (1018)',
        featureTree: { list: () => [] },
      }}];
    });
  };

  return (
    <ToastProvider>
      <WorkspaceShell
        titleBar={
          <TitleBar onNewDoc={newDoc} theme={theme} onThemeChange={setTheme}
            onOpenPalette={openPalette}
            onOpenSettings={() => setSettingsOpen(true)} />
        }
        ribbon={<Ribbon onInvoke={onInvoke} />}
        documentTabs={
          <DocumentTabs docs={docs} activeId={activeDocId}
            onSelect={setActiveDocId} onClose={closeDoc} onNew={newDoc} />
        }
        leftDock={<FeatureTreePanel project={activeDoc?.project} onSelect={(ids) => setSelection(ids[0] || null)} />}
        rightDock={
          <ArchiePortal
            projectId={activeDocId}
            run={null /* wired post-bundle */}
            forge={typeof window !== 'undefined' ? window.forge : null}
            status={typeof window !== 'undefined' && window.forge?.isReady?.() ? 'ready' : 'offline'}
          />
        }
        viewport={
          <ViewportPlaceholder />
        }
        statusBar={
          <StatusBar
            cursor={cursor}
            selection={selection ? 1 : 0}
            theme={theme}
            onThemeChange={setTheme}
            kernelReady={typeof window !== 'undefined' && window.forge?.isReady?.()}
            archieStatus={typeof window !== 'undefined' && window.forge?.isReady?.() ? 'ready' : 'offline'}
          />
        }
      />
      <CommandPalette
        open={paletteOpen}
        onClose={closePalette}
        commands={PALETTE_COMMANDS}
        features={[]}
        recent={recentCommands}
        onInvoke={(it) => onInvoke(it.id, { label: it.label })}
      />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        theme={theme}
        onThemeChange={setTheme}
      />
      <WelcomeOverlay
        open={welcomeOpen}
        onClose={dismissWelcome}
        onNewProject={() => { dismissWelcome(); newDoc(); }}
        onOpenSample={() => { dismissWelcome(); /* TODO load sample */ }}
        onTakeTour={dismissWelcome}
        recent={[]}
      />
      <ToastHost />
    </ToastProvider>
  );
}

function TitleBar({ onNewDoc, theme, onThemeChange, onOpenPalette, onOpenSettings }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-6)' }}>
      <span style={{
        display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)',
        fontWeight: 'var(--weight-semibold)', color: 'var(--text-primary)',
      }}>
        <span style={{
          width: 22, height: 22, borderRadius: 'var(--radius-sm)',
          background: 'var(--accent-bg)', color: 'var(--accent-text)',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          fontWeight: 'var(--weight-bold)', fontSize: 'var(--text-xs)',
        }}>F</span>
        Forge
        <span style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)', fontWeight: 'var(--weight-regular)', marginLeft: 'var(--space-3)' }}>
          v2
        </span>
      </span>
      <Inline gap="var(--space-2)">
        <Tooltip content="New"><IconButton size="sm" icon={<Icon name="fileNew" />}  label="New"  onClick={onNewDoc} /></Tooltip>
        <Tooltip content="Open"><IconButton size="sm" icon={<Icon name="fileOpen" />} label="Open" /></Tooltip>
        <Tooltip content="Save (Cmd S)"><IconButton size="sm" icon={<Icon name="fileSave" />} label="Save" /></Tooltip>
        <Tooltip content="Undo (Cmd Z)"><IconButton size="sm" icon={<Icon name="undo" />} label="Undo" /></Tooltip>
        <Tooltip content="Redo (Cmd Shift Z)"><IconButton size="sm" icon={<Icon name="redo" />} label="Redo" /></Tooltip>
      </Inline>
      <span style={{ flex: 1 }} />
      <Inline gap="var(--space-2)">
        <Tooltip content="Search commands (Cmd K)">
          <IconButton size="sm" icon={<Icon name="search" />} label="Command palette" onClick={onOpenPalette} />
        </Tooltip>
        <Tooltip content="Help (?)">
          <IconButton size="sm" icon={<Icon name="help" />} label="Help" />
        </Tooltip>
        <Tooltip content="Settings">
          <IconButton size="sm" icon={<Icon name="settings" />} label="Settings" onClick={onOpenSettings} />
        </Tooltip>
      </Inline>
    </div>
  );
}

function DocumentTabs({ docs, activeId, onSelect, onClose, onNew }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'flex-end',
      padding: '0 var(--space-3)',
      overflowX: 'auto',
      gap: 0,
    }}>
      {docs.map((d) => {
        const active = d.id === activeId;
        return (
          <button
            key={d.id}
            type="button"
            onClick={() => onSelect(d.id)}
            onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); onClose(d.id); } }}
            aria-current={active ? 'page' : undefined}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)',
              padding: 'var(--space-4) var(--space-6)',
              background: active ? 'var(--surface-raised)' : 'transparent',
              color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
              fontSize: 'var(--text-sm)',
              border: 'none',
              borderTop: active ? '2px solid var(--accent-bg)' : '2px solid transparent',
              borderRadius: 'var(--radius-sm) var(--radius-sm) 0 0',
              cursor: 'pointer',
            }}
          >
            <Icon name="partTab" size={12} />
            <span>{d.name}</span>
            {d.dirty && <span aria-label="modified" style={{ width: 6, height: 6, background: 'var(--accent-bg)', borderRadius: '50%' }} />}
            <span
              role="button"
              aria-label={`Close ${d.name}`}
              onClick={(e) => { e.stopPropagation(); onClose(d.id); }}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                width: 16, height: 16, borderRadius: 'var(--radius-xs)',
                color: 'var(--text-tertiary)',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--surface-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
            ><Icon name="close" size={10} /></span>
          </button>
        );
      })}
      <button type="button" onClick={onNew}
        style={{
          padding: 'var(--space-3) var(--space-6)',
          background: 'transparent', color: 'var(--text-tertiary)',
          border: 'none', cursor: 'pointer',
        }}><Icon name="plus" size={12} /></button>
    </div>
  );
}

function ViewportPlaceholder() {
  return (
    <div style={{
      position: 'absolute', inset: 0,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: 'radial-gradient(ellipse at center, var(--surface-raised) 0%, var(--surface-app) 100%)',
    }}>
      <EmptyState
        size="lg"
        icon={<Icon name="partTab" size={28} />}
        title="Viewport — kernel-driven"
        description="GPU-instanced viewport mounts here once Forge-44 lands. Until then, use Archie or the ribbon to build geometry."
      />
    </div>
  );
}
