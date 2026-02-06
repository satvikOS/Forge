import React, { useState, useEffect } from 'react';
import WorkbenchSwitcher from './WorkbenchSwitcher';
import WorkbenchMechanical from '../workbenches/mechanical-cad/WorkbenchMechanical';
import WorkbenchArchitecture from '../workbenches/architecture-bim/WorkbenchArchitecture';
import WorkbenchGaming from '../workbenches/gaming-vfx/WorkbenchGaming';
import WorkbenchAutomotive from '../workbenches/automotive/WorkbenchAutomotive';
import WorkbenchElectronics from '../workbenches/electronics/WorkbenchElectronics';
import AIConsole from './AIConsole';
import CommandPalette from './CommandPalette';
import ToastContainer from './ToastContainer';
import { ViewportProvider } from '../contexts/ViewportContext';
import apiService from '../services/api';
import '../styles/workbench.css';

/**
 * Main Workbench Container, Blender Style Layout
 * Grid: Header, Toolbar, Viewport, Properties, Footer
 */
function WorkbenchContainer() {
    const [activeWorkbench, setActiveWorkbench] = useState('mechanical-cad');
    const [featureSearch, setFeatureSearch] = useState('');
    const [isOnline, setIsOnline] = useState(true);
    const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
    const [toasts, setToasts] = useState([]);
    const [undoStack, setUndoStack] = useState([]);
    const [redoStack, setRedoStack] = useState([]);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

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

    const renderToolbar = () => {
        const toolbars = {
            'mechanical-cad': ['Sketch', 'Extrude', 'Revolve', 'Fillet', 'Pattern', 'Assembly', 'CFD', 'Simulate'],
            'architecture-bim': ['Wall', 'Door', 'Window', 'Level', 'Room', 'Roof', 'Stair'],
            'gaming-vfx': ['Model', 'Texture', 'Rig', 'Animate', 'Render', 'Particles'],
            'automotive': ['Surface', 'Curve', 'Blend', 'Aerodynamics', 'Chassis', 'Aero'],
            'electronics': ['Component', 'Trace', 'Route', 'Simulate', 'Export', 'DRC'],
        };

        const tools = toolbars[activeWorkbench] || [];
        return tools.map(tool => (
            <button key={tool} className="toolbar-button">{tool}</button>
        ));
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
                {/* TOP HEADER */}
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

                    <div className="header-center">
                        <WorkbenchSwitcher
                            activeWorkbench={activeWorkbench}
                            onSwitchWorkbench={setActiveWorkbench}
                        />
                        <div className="workbench-toolbar">
                            {renderToolbar()}
                        </div>
                    </div>

                    <div className="header-actions">
                        <button
                            className="header-button icon-btn"
                            title="Undo (Ctrl+Z)"
                            onClick={handleUndo}
                            disabled={undoStack.length === 0}
                        >
                            ↩
                        </button>
                        <button
                            className="header-button icon-btn"
                            title="Redo (Ctrl+Shift+Z)"
                            onClick={handleRedo}
                            disabled={redoStack.length === 0}
                        >
                            ↪
                        </button>
                        <div className="header-divider"></div>
                        <button
                            className="header-button command-palette-trigger"
                            onClick={() => setCommandPaletteOpen(true)}
                            title="Command Palette (Ctrl+K)"
                        >
                            <span className="search-icon">⌘</span>
                            <span className="search-text">Search...</span>
                            <kbd className="search-kbd">Ctrl+K</kbd>
                        </button>
                        <div className="header-divider"></div>
                        <button className="header-button" onClick={handleSave}>
                            {hasUnsavedChanges ? '● Save' : 'Save'}
                        </button>
                        <button className="header-button">Export</button>
                    </div>
                </header>

                {/* WORKBENCH CONTENT (Toolbar + Viewport + Properties) */}
                {renderWorkbench()}

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
