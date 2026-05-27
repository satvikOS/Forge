import React, { useState, useEffect } from 'react';
import { Undo2, Redo2, Search, Save, Download } from 'lucide-react';
import Topbar from './Topbar';
import StatusBarPro from './StatusBarPro';
import './StatusBarPro.css';
import WorkbenchSwitcher from './WorkbenchSwitcher';
import WorkbenchMechanical from '../workbenches/mechanical-cad/WorkbenchMechanical';
import WorkbenchArchitecture from '../workbenches/architecture-bim/WorkbenchArchitecture';
import WorkbenchGaming from '../workbenches/gaming-vfx/WorkbenchGaming';
import WorkbenchAutomotive from '../workbenches/automotive/WorkbenchAutomotive';
import WorkbenchElectronics from '../workbenches/electronics/WorkbenchElectronics';
import AIConsole from './AIConsole';
import ProjectLibrary from './ProjectLibrary';
import ComponentInfoPanel from './ComponentInfoPanel';
import CommandPalette from './CommandPalette';
import { TABS as RIBBON_TABS } from './RibbonToolbar';
import QuickAccessToolbar from './QuickAccessToolbar';
import ToastContainer from './ToastContainer';
import { RollbackBar } from './SwUxOverlays';
import './SwUxOverlays.css';
import { ViewportProvider } from '../contexts/ViewportContext';
import apiService from '../services/api';
import '../styles/workbench.css';

/**
 * Main Workbench Container
 * Layout: Header (menus + actions) | Toolbar + Viewport + Properties | Footer (AI Console)
 *
 * Tool access is consolidated in the left sidebar per workbench.
 * The Topbar provides application-level menus (File, Edit, View, Tools, Help).
 */
function WorkbenchContainer() {
    const [activeWorkbench, setActiveWorkbench] = useState('mechanical-cad');
    const [isOnline, setIsOnline] = useState(true);
    const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
    const [toasts, setToasts] = useState([]);
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
    const [activeProjectId, setActiveProjectId] = useState(null);
    // Rollback column visibility — driven by the live kernel HistoryLog.
    // The RollbackBar component returns null when the log is empty so we
    // collapse the grid column to 0 width to avoid an empty gap between
    // the viewport and the right Properties panel. This is the only piece
    // of state the workbench shell needs from the bar; the bar itself owns
    // expand/collapse + scrubbing.
    const [rollbackHasItems, setRollbackHasItems] = useState(false);
    const [rollbackCollapsed, setRollbackCollapsed] = useState(() => {
        if (typeof window === 'undefined') return false;
        try {
            return window.localStorage.getItem('archdisc.rollbackBar.collapsed') === '1';
        } catch { return false; }
    });

    // Subscribe to the kernel history-changed event so the column hides
    // when the log goes empty (and reappears when ops record). The bar
    // mirrors `__archdiscRollbackBarHasItems` on every snapshot.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const refresh = () => {
            setRollbackHasItems(!!window.__archdiscRollbackBarHasItems);
            try {
                setRollbackCollapsed(
                    window.localStorage.getItem('archdisc.rollbackBar.collapsed') === '1'
                );
            } catch { /* localStorage unavailable */ }
        };
        refresh();
        window.addEventListener('archdisc:history-changed', refresh);
        const id = setInterval(refresh, 600);  // belt-and-braces poll
        return () => {
            window.removeEventListener('archdisc:history-changed', refresh);
            clearInterval(id);
        };
    }, []);

    // Toast helper
    const addToast = (message, type = 'info', duration = 3000) => {
        const id = Date.now();
        setToasts(prev => [...prev, { id, message, type, duration }]);
    };

    const removeToast = (id) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    };

    // Monitor online/offline status
    useEffect(() => {
        const updateOnlineStatus = () => setIsOnline(navigator.onLine);

        window.addEventListener('online', updateOnlineStatus);
        window.addEventListener('offline', updateOnlineStatus);

        const checkHealth = async () => {
            try {
                await apiService.healthCheck();
                setIsOnline(true);
            } catch (error) {
                setIsOnline(false);
            }
        };

        checkHealth();
        const interval = setInterval(checkHealth, 30000);

        return () => {
            window.removeEventListener('online', updateOnlineStatus);
            window.removeEventListener('offline', updateOnlineStatus);
            clearInterval(interval);
        };
    }, []);

    // Global keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Command Palette: Ctrl+K or Cmd+K
            if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
                e.preventDefault();
                setCommandPaletteOpen(prev => !prev);
            }
            // Undo: Ctrl+Z
            if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                e.preventDefault();
                handleUndo();
            }
            // Redo: Ctrl+Shift+Z or Ctrl+Y
            if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
                if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
                e.preventDefault();
                handleRedo();
            }
            // Save: Ctrl+S
            if ((e.ctrlKey || e.metaKey) && e.key === 's') {
                e.preventDefault();
                handleSave();
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [undoStack, redoStack]);

    const handleUndo = () => {
        if (undoStack.length === 0) return;
        addToast('Undo', 'info', 1500);
    };

    const handleRedo = () => {
        if (redoStack.length === 0) return;
        addToast('Redo', 'info', 1500);
    };

    const handleSave = () => {
        setHasUnsavedChanges(false);
        addToast('Project saved', 'success', 2000);
    };

    const renderWorkbench = () => {
        switch (activeWorkbench) {
            case 'mechanical-cad': return <WorkbenchMechanical />;
            case 'architecture-bim': return <WorkbenchArchitecture />;
            case 'gaming-vfx': return <WorkbenchGaming />;
            case 'automotive': return <WorkbenchAutomotive />;
            case 'electronics': return <WorkbenchElectronics />;
            default: return <WorkbenchMechanical />;
        }
    };

    // WF-03 — Command Palette action set. Indexes EVERY ribbon tool
    // (246 entries across 9 tabs) so Ctrl+K can launch any CAD op
    // without hunting through tabs. Each ribbon-tool action dispatches
    // `archdisc:run-tool {tab, tool}`, which WorkbenchMechanical
    // listens to and forwards to `handleToolExecute` — the exact same
    // code path a real ribbon click takes.
    //
    // App-level actions (workbench switch / undo / redo / save) are
    // kept in their own categories at the top so they remain a single
    // keystroke away.
    const getCommandActions = () => {
        const dispatchTool = (tab, tool) => {
            if (typeof window === 'undefined') return;
            window.dispatchEvent(new CustomEvent('archdisc:run-tool', { detail: { tab, tool } }));
        };
        const ribbonActions = [];
        for (const [tabKey, tabDef] of Object.entries(RIBBON_TABS || {})) {
            const tabLabel = tabDef?.label || tabKey;
            for (const group of (tabDef?.groups || [])) {
                const groupLabel = group?.label || '';
                for (const tool of (group?.tools || [])) {
                    if (!tool?.name) continue;
                    ribbonActions.push({
                        id: `tool-${tabKey}-${tool.name.replace(/\s+/g, '-').toLowerCase()}`,
                        label: tool.name,
                        category: `${tabLabel} › ${groupLabel}`,
                        shortcut: tool.shortcut || undefined,
                        // Dispatch the TOOL's groupKey (the `key` field on
                        // the registry entry) — that's what ToolExecutionEngine
                        // routes on, not the ribbon-tab key. A tool's tab and
                        // key sometimes match (Box → key:'part', tab:'part')
                        // but often don't (Export Project Bundle → key:
                        // 'documentation', tab:'drawing').
                        action: () => dispatchTool(tool.key || tabKey, tool.name),
                    });
                }
            }
        }
        const appActions = [
            { id: 'switch-mechanical', label: 'Switch to Mechanical CAD', category: 'Workbench', action: () => setActiveWorkbench('mechanical-cad') },
            { id: 'switch-architecture', label: 'Switch to Architecture & BIM', category: 'Workbench', action: () => setActiveWorkbench('architecture-bim') },
            { id: 'switch-gaming', label: 'Switch to Gaming & VFX', category: 'Workbench', action: () => setActiveWorkbench('gaming-vfx') },
            { id: 'switch-automotive', label: 'Switch to Automotive', category: 'Workbench', action: () => setActiveWorkbench('automotive') },
            { id: 'switch-electronics', label: 'Switch to Electronics', category: 'Workbench', action: () => setActiveWorkbench('electronics') },
            { id: 'save', label: 'Save Project', category: 'File', shortcut: 'Ctrl+S', action: handleSave },
            { id: 'undo', label: 'Undo', category: 'Edit', shortcut: 'Ctrl+Z', action: handleUndo },
            { id: 'redo', label: 'Redo', category: 'Edit', shortcut: 'Ctrl+Shift+Z', action: handleRedo },
        ];
        return [...appActions, ...ribbonActions];
    };

    return (
        <ViewportProvider>
            <div className="workbench-container">
                {/* TOP HEADER - Application menus + utility actions */}
                <header className="workbench-header">
                    <div className="header-brand">
                        <h1 className="workbench-title">ArchDisc</h1>
                        <span
                            className={`status-indicator ${isOnline ? 'online' : 'offline'}`}
                            title={isOnline ? 'Connected' : 'Offline'}
                        ></span>
                        {hasUnsavedChanges && (
                            <span className="unsaved-dot" title="Unsaved changes"></span>
                        )}
                    </div>

                    {/* Application menu bar - File, Edit, View, Tools, Help */}
                    <Topbar />

                    <div className="header-center">
                        <WorkbenchSwitcher
                            activeWorkbench={activeWorkbench}
                            onSwitchWorkbench={setActiveWorkbench}
                        />
                    </div>

                    <div className="header-actions">
                        <button
                            className="header-button command-palette-trigger"
                            onClick={() => setCommandPaletteOpen(true)}
                            title="Command Palette (Ctrl+K)"
                        >
                            <Search size={12} />
                            <span className="search-text">Search...</span>
                            <kbd className="search-kbd">Ctrl+K</kbd>
                        </button>
                        <div className="header-divider"></div>
                        <button
                            className="header-button icon-btn"
                            title="Undo (Ctrl+Z)"
                            onClick={handleUndo}
                            disabled={undoStack.length === 0}
                        >
                            <Undo2 size={14} />
                        </button>
                        <button
                            className="header-button icon-btn"
                            title="Redo (Ctrl+Shift+Z)"
                            onClick={handleRedo}
                            disabled={redoStack.length === 0}
                        >
                            <Redo2 size={14} />
                        </button>
                        <div className="header-divider"></div>
                        <button className="header-button icon-btn" onClick={handleSave} title="Save (Ctrl+S)">
                            <Save size={14} />
                        </button>
                        <button className="header-button icon-btn" title="Export">
                            <Download size={14} />
                        </button>
                    </div>
                </header>

                {/* QUICK ACCESS TOOLBAR — pinned commands, one click away
                    regardless of the active ribbon tab. Persists across
                    sessions via localStorage. Dispatches the same
                    `archdisc:run-tool` event the Command Palette uses,
                    so the entire chain (event → handleToolExecute →
                    kernel op) is exercised on every pin click. */}
                <QuickAccessToolbar
                    onSave={handleSave}
                    onUndo={handleUndo}
                    onRedo={handleRedo}
                    canUndo={undoStack.length > 0}
                    canRedo={redoStack.length > 0}
                />

                {/*
                 * STAGE — the fixed-viewport area. The 3D viewport occupies
                 * a stable rectangle inside this wrapper; the toolbar /
                 * properties / rollback drawers are absolute-positioned
                 * overlays that never push the viewport (they animate over
                 * their own reserved gutters). See
                 * `frontend/src/styles/workbench.css::.workbench-stage`.
                 *
                 * Workbench wrappers still mount the same three children
                 * (`.workbench-tools`, `.workbench-viewport`,
                 * `.workbench-properties`) — they used to be grid items at
                 * the container level; they're now absolute children of
                 * this stage element.
                 */}
                <div className="workbench-stage" data-archdisc-stage="active">
                    {renderWorkbench()}

                    {/* ROLLBACK STRIP — vertical kernel-history timeline
                        scrubber, pinned to the right gutter (between the
                        viewport and the Properties drawer) as an absolute
                        overlay. The reserved gutter width is fixed, so the
                        viewport canvas does NOT change size when the strip
                        toggles empty / collapsed / expanded. */}
                    <aside
                        className={
                            'workbench-rollback'
                            + (rollbackHasItems ? '' : ' workbench-rollback-empty')
                            + (rollbackCollapsed ? ' workbench-rollback-collapsed' : '')
                        }
                        data-archdisc-rollback-column={rollbackHasItems ? 'active' : 'empty'}
                        data-archdisc-rollback-column-collapsed={rollbackCollapsed ? 'true' : 'false'}
                    >
                        <RollbackBar />
                    </aside>
                </div>

                {/* STATUS BAR */}
                <StatusBarPro />

                {/* BOTTOM FOOTER - AI CONSOLE (Chat/Code Terminal) */}
                <AIConsole />

                {/* Command Palette Overlay */}
                {commandPaletteOpen && (
                    <CommandPalette
                        actions={getCommandActions()}
                        onClose={() => setCommandPaletteOpen(false)}
                    />
                )}

                {/* Toast Notifications */}
                <ToastContainer toasts={toasts} onRemove={removeToast} />
            </div>
        </ViewportProvider>
    );
}

export default WorkbenchContainer;
