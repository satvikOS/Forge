/**
 * Viewport Overlays - Customizable viewport display options
 * Blender/Cinema 4D-style overlay system for grid, stats, and info
 */

import { useState, useEffect } from 'react';
import sceneUnitsSystem from '../systems/SceneUnitsSystem';

export default function ViewportOverlays({
    sceneManager,
    stats = {},
    activeTool = 'select',
    showGrid = true,
    showAxes = true,
    showStats = true,
    wireframeMode = 'off',
    onToggleGrid,
    onToggleAxes,
    onToggleStats,
    onToggleWireframe,
}) {
    const [fps, setFps] = useState(60);
    const [unitSettings, setUnitSettings] = useState(sceneUnitsSystem.getSettings());

    useEffect(() => {
        // Listen to unit system changes
        const handleUnitsChange = () => {
            setUnitSettings(sceneUnitsSystem.getSettings());
        };

        sceneUnitsSystem.addListener(handleUnitsChange);
        return () => sceneUnitsSystem.removeListener(handleUnitsChange);
    }, []);

    // Calculate scene statistics
    const sceneStats = {
        objects: sceneManager?.getAllObjects().length || 0,
        selected: sceneManager?.selectedObjects.size || 0,
        vertices: stats.vertices || 0,
        faces: stats.faces || 0,
    };

    const gridSize = sceneUnitsSystem.getGridSize();
    const unitInfo = sceneUnitsSystem.getUnitInfo(unitSettings.baseUnit);

    return (
        <>
            {/* Top-left info panel */}
            <div style={styles.topLeftPanel}>
                {/* Active Tool Indicator */}
                <div style={styles.toolIndicator}>
                    <span style={styles.toolIcon}>{getToolIcon(activeTool)}</span>
                    <span style={styles.toolName}>{getToolName(activeTool)}</span>
                </div>

                {/* Unit Scale Indicator */}
                <div style={styles.unitIndicator}>
                    <span style={styles.gridIcon}>⊞</span>
                    <span style={styles.unitText}>
                        1 square = {gridSize} {unitInfo.abbr}
                    </span>
                </div>

                {/* Snap Indicator */}
                {unitSettings.snapEnabled && (
                    <div style={styles.snapIndicator}>
                        <span style={styles.snapIcon}>🧲</span>
                        <span style={styles.snapText}>Snap: {unitSettings.snapSize} {unitInfo.abbr}</span>
                    </div>
                )}
            </div>

            {/* Top-right overlay controls */}
            <div style={styles.topRightPanel}>
                <button
                    onClick={onToggleGrid}
                    style={{
                        ...styles.overlayButton,
                        ...(showGrid ? styles.activeOverlay : {})
                    }}
                    title="Toggle Grid (G)"
                >
                    <span>⊞</span>
                    <span style={styles.buttonLabel}>Grid</span>
                </button>

                <button
                    onClick={onToggleAxes}
                    style={{
                        ...styles.overlayButton,
                        ...(showAxes ? styles.activeOverlay : {})
                    }}
                    title="Toggle Axes (A)"
                >
                    <span>⚐</span>
                    <span style={styles.buttonLabel}>Axes</span>
                </button>

                <button
                    onClick={onToggleStats}
                    style={{
                        ...styles.overlayButton,
                        ...(showStats ? styles.activeOverlay : {})
                    }}
                    title="Toggle Stats (I)"
                >
                    <span>📊</span>
                    <span style={styles.buttonLabel}>Stats</span>
                </button>

                <button
                    onClick={onToggleWireframe}
                    style={{
                        ...styles.overlayButton,
                        ...(wireframeMode !== 'off' ? styles.activeOverlay : {})
                    }}
                    title="Toggle Wireframe (W) - Cycles: Off → Solid → Transparent"
                >
                    <span>{wireframeMode === 'off' ? '◼' : wireframeMode === 'solid' ? '▦' : '▢'}</span>
                    <span style={styles.buttonLabel}>
                        {wireframeMode === 'off' ? 'Wireframe' : wireframeMode === 'solid' ? 'WF Solid' : 'WF Trans'}
                    </span>
                </button>
            </div>

            {/* Bottom-left stats panel */}
            {showStats && (
                <div style={styles.statsPanel}>
                    <div style={styles.statRow}>
                        <span style={styles.statLabel}>Objects:</span>
                        <span style={styles.statValue}>{sceneStats.objects}</span>
                    </div>
                    <div style={styles.statRow}>
                        <span style={styles.statLabel}>Selected:</span>
                        <span style={styles.statValue}>{sceneStats.selected}</span>
                    </div>
                    <div style={styles.statRow}>
                        <span style={styles.statLabel}>Vertices:</span>
                        <span style={styles.statValue}>{sceneStats.vertices.toLocaleString()}</span>
                    </div>
                    <div style={styles.statRow}>
                        <span style={styles.statLabel}>Faces:</span>
                        <span style={styles.statValue}>{sceneStats.faces.toLocaleString()}</span>
                    </div>
                    <div style={styles.statRow}>
                        <span style={styles.statLabel}>FPS:</span>
                        <span style={{ ...styles.statValue, color: fps > 30 ? '#4caf50' : '#ff9800' }}>
                            {fps}
                        </span>
                    </div>
                </div>
            )}

            {/* Bottom-right navigation hint */}
            <div style={styles.navigationHint}>
                <div style={styles.hintRow}>
                    <span style={styles.hintKey}>MMB</span>
                    <span style={styles.hintText}>Rotate</span>
                </div>
                <div style={styles.hintRow}>
                    <span style={styles.hintKey}>Shift+MMB</span>
                    <span style={styles.hintText}>Pan</span>
                </div>
                <div style={styles.hintRow}>
                    <span style={styles.hintKey}>Scroll</span>
                    <span style={styles.hintText}>Zoom</span>
                </div>
            </div>
        </>
    );
}

function getToolIcon(tool) {
    const icons = {
        select: '🖱',
        translate: '↔',
        rotate: '⟲',
        scale: '⇱',
        draw: '✏',
        measure: '📏',
    };
    return icons[tool] || '🖱';
}

function getToolName(tool) {
    const names = {
        select: 'Select',
        translate: 'Move',
        rotate: 'Rotate',
        scale: 'Scale',
        draw: 'Draw',
        measure: 'Measure',
    };
    return names[tool] || 'Unknown';
}

const styles = {
    topLeftPanel: {
        position: 'absolute',
        top: '16px',
        left: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        pointerEvents: 'none',
        zIndex: 100,
    },
    toolIndicator: {
        backgroundColor: 'rgba(26, 26, 26, 0.9)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '6px',
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        backdropFilter: 'blur(10px)',
    },
    toolIcon: {
        fontSize: '16px',
    },
    toolName: {
        fontSize: '13px',
        color: '#e0e0e0',
        fontWeight: '500',
    },
    unitIndicator: {
        backgroundColor: 'rgba(74, 144, 226, 0.15)',
        border: '1px solid rgba(74, 144, 226, 0.3)',
        borderRadius: '6px',
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        backdropFilter: 'blur(10px)',
    },
    gridIcon: {
        fontSize: '14px',
        color: '#4a90e2',
    },
    unitText: {
        fontSize: '12px',
        color: '#4a90e2',
        fontWeight: '500',
    },
    snapIndicator: {
        backgroundColor: 'rgba(76, 175, 80, 0.15)',
        border: '1px solid rgba(76, 175, 80, 0.3)',
        borderRadius: '6px',
        padding: '6px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        backdropFilter: 'blur(10px)',
    },
    snapIcon: {
        fontSize: '12px',
    },
    snapText: {
        fontSize: '11px',
        color: '#4caf50',
        fontWeight: '500',
    },
    topRightPanel: {
        position: 'absolute',
        top: '16px',
        right: '16px',
        display: 'flex',
        gap: '8px',
        zIndex: 100,
    },
    overlayButton: {
        backgroundColor: 'rgba(26, 26, 26, 0.9)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '6px',
        padding: '8px 12px',
        color: '#e0e0e0',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: '13px',
        transition: 'all 0.2s',
        backdropFilter: 'blur(10px)',
    },
    activeOverlay: {
        backgroundColor: 'rgba(74, 144, 226, 0.3)',
        borderColor: 'rgba(74, 144, 226, 0.5)',
    },
    buttonLabel: {
        fontSize: '11px',
    },
    statsPanel: {
        position: 'absolute',
        bottom: '16px',
        left: '16px',
        backgroundColor: 'rgba(26, 26, 26, 0.9)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '6px',
        padding: '10px 12px',
        backdropFilter: 'blur(10px)',
        minWidth: '150px',
        zIndex: 100,
        pointerEvents: 'none',
    },
    statRow: {
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: '4px',
        fontSize: '11px',
    },
    statLabel: {
        color: '#999',
    },
    statValue: {
        color: '#e0e0e0',
        fontWeight: '500',
        marginLeft: '12px',
    },
    navigationHint: {
        position: 'absolute',
        bottom: '16px',
        right: '16px',
        backgroundColor: 'rgba(26, 26, 26, 0.9)',
        border: '1px solid rgba(255, 255, 255, 0.1)',
        borderRadius: '6px',
        padding: '8px 10px',
        backdropFilter: 'blur(10px)',
        zIndex: 100,
        pointerEvents: 'none',
    },
    hintRow: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        marginBottom: '4px',
        fontSize: '10px',
    },
    hintKey: {
        backgroundColor: '#333',
        padding: '2px 6px',
        borderRadius: '3px',
        color: '#e0e0e0',
        fontWeight: '600',
        minWidth: '55px',
        textAlign: 'center',
        fontSize: '9px',
    },
    hintText: {
        color: '#999',
    },
};
