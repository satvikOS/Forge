import React from 'react';

/**
 * Electronics & Robotics Workbench - Blender Layout
 * PCB design, schematic capture, component placement
 */
function WorkbenchElectronics() {
    return (
        <>
            {/* LEFT TOOLBAR - ICON ONLY */}
            <aside className="workbench-tools">
                <button className="tool-icon-button" title="Select">⬚</button>
                <button className="tool-icon-button active" title="Component">⊞</button>
                <button className="tool-icon-button" title="Trace">⤸</button>
                <button className="tool-icon-button" title="Via">●</button>
                <button className="tool-icon-button" title="Route">⚡</button>
                <button className="tool-icon-button" title="Polygon">▱</button>
                <button className="tool-icon-button" title="Measure">⟷</button>
                <button className="tool-icon-button" title="DRC">✓</button>
            </aside>

            {/* CENTER VIEWPORT - HERO */}
            <main className="workbench-viewport">
                <canvas id="render-canvas-electronics"></canvas>

                {/* Viewport Controls - Top Right */}
                <div className="viewport-overlay">
                    <div className="viewport-controls">
                        <button className="viewport-button">Top</button>
                        <button className="viewport-button">Bottom</button>
                        <button className="viewport-button">3D</button>
                        <button className="viewport-button">Schematic</button>
                    </div>
                </div>

                {/* Gizmo Controls - Bottom Left */}
                <div className="gizmo-controls">
                    <button className="gizmo-button active">Place</button>
                    <button className="gizmo-button">Route</button>
                    <button className="gizmo-button">Measure</button>
                </div>
            </main>

            {/* RIGHT PROPERTIES PANEL */}
            <aside className="workbench-properties">
                <div className="property-section">
                    <h3 className="property-header">Component</h3>
                    <div className="property-row">
                        <span className="property-label">Part</span>
                        <input type="text" className="property-input" placeholder="R1" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Value</span>
                        <input type="text" className="property-input" placeholder="10kΩ" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Package</span>
                        <select className="property-input">
                            <option>0805</option>
                            <option>0603</option>
                            <option>Through-hole</option>
                        </select>
                    </div>
                </div>

                <div className="property-section">
                    <h3 className="property-header">PCB</h3>
                    <div className="property-row">
                        <span className="property-label">Layers</span>
                        <input type="number" className="property-input" placeholder="2" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Trace Width</span>
                        <input type="number" className="property-input" placeholder="0.2" />
                    </div>
                    <button className="property-button">Auto-Route</button>
                </div>

                <div className="property-section">
                    <h3 className="property-header">Export</h3>
                    <button className="property-button">Generate Gerber</button>
                    <button className="property-button">Export BOM</button>
                </div>
            </aside>
        </>
    );
}

export default WorkbenchElectronics;
