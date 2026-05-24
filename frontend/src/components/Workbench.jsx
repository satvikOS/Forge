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

    // Command palette actions
    const getCommandActions = () => [
        { id: 'switch-mechanical', label: 'Switch to Mechanical CAD', category: 'Workbench', action: () => setActiveWorkbench('mechanical-cad') },
        { id: 'switch-architecture', label: 'Switch to Architecture & BIM', category: 'Workbench', action: () => setActiveWorkbench('architecture-bim') },
        { id: 'switch-gaming', label: 'Switch to Gaming & VFX', category: 'Workbench', action: () => setActiveWorkbench('gaming-vfx') },
        { id: 'switch-automotive', label: 'Switch to Automotive', category: 'Workbench', action: () => setActiveWorkbench('automotive') },
        { id: 'switch-electronics', label: 'Switch to Electronics', category: 'Workbench', action: () => setActiveWorkbench('electronics') },
        { id: 'save', label: 'Save Project', category: 'File', shortcut: 'Ctrl+S', action: handleSave },
        { id: 'undo', label: 'Undo', category: 'Edit', shortcut: 'Ctrl+Z', action: handleUndo },
        { id: 'redo', label: 'Redo', category: 'Edit', shortcut: 'Ctrl+Shift+Z', action: handleRedo },
        { id: 'export-step', label: 'Export as STEP', category: 'Export', action: () => addToast('Exporting STEP...', 'info') },
        { id: 'export-stl', label: 'Export as STL', category: 'Export', action: () => addToast('Exporting STL...', 'info') },
        { id: 'export-gltf', label: 'Export as glTF', category: 'Export', action: () => addToast('Exporting glTF...', 'info') },
        { id: 'export-obj', label: 'Export as OBJ', category: 'Export', action: () => addToast('Exporting OBJ...', 'info') },
    ];

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

                {/* WORKBENCH CONTENT (Toolbar + Viewport + Properties) - renders as grid children */}
                {renderWorkbench()}

                {/* ROLLBACK COLUMN — vertical kernel-history timeline scrubber,
                    relocated OUT of the viewport overlay layer. Sits in its
                    own grid column between the viewport and the Properties
                    panel so the 3D model is never obstructed. Auto-hides
                    (zero-width column) when the kernel HistoryLog is empty. */}
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
