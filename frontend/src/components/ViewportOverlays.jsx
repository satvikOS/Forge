/**
 * Viewport Overlays - Customizable viewport display options
 * Blender/Cinema 4D-style overlay system for grid, stats, and info
 */

import { useState, useEffect } from 'react';
import sceneUnitsSystem from '../systems/SceneUnitsSystem';
import './ViewportOverlays.css';

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
        const handleUnitsChange = () => {
            setUnitSettings(sceneUnitsSystem.getSettings());
        };

        sceneUnitsSystem.addListener(handleUnitsChange);
        return () => sceneUnitsSystem.removeListener(handleUnitsChange);
    }, []);

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
            <div className="vo-top-left">
                {/* Active Tool Indicator */}
                <div className="vo-pill">
                    <span className="vo-pill-icon">{getToolIcon(activeTool)}</span>
                    <span className="vo-pill-text">{getToolName(activeTool)}</span>
                </div>

                {/* Unit Scale Indicator */}
                <div className="vo-pill vo-pill-blue">
                    <span className="vo-pill-icon">{'\u229E'}</span>
                    <span className="vo-pill-text">
                        1 square = {gridSize} {unitInfo.abbr}
                    </span>
                </div>

                {/* Snap Indicator */}
                {unitSettings.snapEnabled && (
                    <div className="vo-pill vo-pill-green">
                        <span className="vo-pill-icon">{'\u2348'}</span>
                        <span className="vo-pill-text">Snap: {unitSettings.snapSize} {unitInfo.abbr}</span>
                    </div>
                )}
            </div>

            {/* Top-right overlay controls */}
            <div className="vo-top-right">
                <button
                    onClick={onToggleGrid}
                    className={`vo-toggle-btn ${showGrid ? 'active' : ''}`}
                    title="Toggle Grid (G)"
                >
                    <span>{'\u229E'}</span>
                    <span className="vo-btn-label">Grid</span>
                </button>

                <button
                    onClick={onToggleAxes}
                    className={`vo-toggle-btn ${showAxes ? 'active' : ''}`}
                    title="Toggle Axes (A)"
                >
                    <span>{'\u2690'}</span>
                    <span className="vo-btn-label">Axes</span>
                </button>

                <button
                    onClick={onToggleStats}
                    className={`vo-toggle-btn ${showStats ? 'active' : ''}`}
                    title="Toggle Stats (I)"
                >
                    <span>{'\u25A6'}</span>
                    <span className="vo-btn-label">Stats</span>
                </button>

                <button
                    onClick={onToggleWireframe}
                    className={`vo-toggle-btn ${wireframeMode !== 'off' ? 'active' : ''}`}
                    title="Toggle Wireframe (W) - Cycles: Off / Solid / Transparent"
                >
                    <span>{wireframeMode === 'off' ? '\u25FC' : wireframeMode === 'solid' ? '\u25A6' : '\u25A2'}</span>
                    <span className="vo-btn-label">
                        {wireframeMode === 'off' ? 'Wireframe' : wireframeMode === 'solid' ? 'WF Solid' : 'WF Trans'}
                    </span>
                </button>
            </div>

            {/* Bottom-left stats panel */}
            {showStats && (
                <div className="vo-stats-panel">
                    <div className="vo-stat-row">
                        <span className="vo-stat-label">Objects:</span>
                        <span className="vo-stat-value">{sceneStats.objects}</span>
                    </div>
                    <div className="vo-stat-row">
                        <span className="vo-stat-label">Selected:</span>
                        <span className="vo-stat-value">{sceneStats.selected}</span>
                    </div>
                    <div className="vo-stat-row">
                        <span className="vo-stat-label">Vertices:</span>
                        <span className="vo-stat-value monospace">{sceneStats.vertices.toLocaleString()}</span>
                    </div>
                    <div className="vo-stat-row">
                        <span className="vo-stat-label">Faces:</span>
                        <span className="vo-stat-value monospace">{sceneStats.faces.toLocaleString()}</span>
                    </div>
                    <div className="vo-stat-row">
                        <span className="vo-stat-label">FPS:</span>
                        <span className={`vo-stat-value monospace ${fps > 30 ? 'vo-fps-good' : 'vo-fps-warn'}`}>
                            {fps}
                        </span>
                    </div>
                </div>
            )}

            {/* Bottom-right navigation hint */}
            <div className="vo-nav-hints">
                <div className="vo-hint-row">
                    <span className="vo-hint-key">MMB</span>
                    <span className="vo-hint-text">Rotate</span>
                </div>
                <div className="vo-hint-row">
                    <span className="vo-hint-key">Shift+MMB</span>
                    <span className="vo-hint-text">Pan</span>
                </div>
                <div className="vo-hint-row">
                    <span className="vo-hint-key">Scroll</span>
                    <span className="vo-hint-text">Zoom</span>
                </div>
            </div>
        </>
    );
}

function getToolIcon(tool) {
    const icons = {
        select: '\uD83D\uDDB1',
        translate: '\u2194',
        rotate: '\u27F2',
        scale: '\u21F1',
        draw: '\u270F',
        measure: '\uD83D\uDCCF',
    };
    return icons[tool] || '\uD83D\uDDB1';
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
