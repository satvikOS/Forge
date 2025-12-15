import React from 'react';

/**
 * Industrial & Machinery Workbench - Blender Layout
 * Factory layouts, robotics, production line design
 */
function WorkbenchIndustrial() {
    return (
        <>
            {/* LEFT TOOLBAR - ICON ONLY */}
            <aside className="workbench-tools">
                <button className="tool-icon-button" title="Select">⬚</button>
                <button className="tool-icon-button active" title="Layout">▦</button>
                <button className="tool-icon-button" title="Conveyor">⟹</button>
                <button className="tool-icon-button" title="Robot">🤖</button>
                <button className="tool-icon-button" title="Machine">⚙</button>
                <button className="tool-icon-button" title="Rack">▤</button>
                <button className="tool-icon-button" title="Path">⤸</button>
                <button className="tool-icon-button" title="Simulate">▶</button>
            </aside>

            {/* CENTER VIEWPORT - HERO */}
            <main className="workbench-viewport">
                <canvas id="render-canvas-industrial"></canvas>

                {/* Viewport Controls - Top Right */}
                <div className="viewport-overlay">
                    <div className="viewport-controls">
                        <button className="viewport-button">Top</button>
                        <button className="viewport-button">Side</button>
                        <button className="viewport-button">Front</button>
                        <button className="viewport-button">ISO</button>
                    </div>
                </div>

                {/* Gizmo Controls - Bottom Left */}
                <div className="gizmo-controls">
                    <button className="gizmo-button active">Move</button>
                    <button className="gizmo-button">Rotate</button>
                    <button className="gizmo-button">Array</button>
                </div>
            </main>

            {/* RIGHT PROPERTIES PANEL */}
            <aside className="workbench-properties">
                <div className="property-section">
                    <h3 className="property-header">Equipment</h3>
                    <div className="property-row">
                        <span className="property-label">Type</span>
                        <select className="property-input">
                            <option>Robotic Arm</option>
                            <option>Conveyor Belt</option>
                            <option>CNC Machine</option>
                        </select>
                    </div>
                    <div className="property-row">
                        <span className="property-label">Capacity</span>
                        <input type="number" className="property-input" placeholder="1000" />
                    </div>
                </div>

                <div className="property-section">
                    <h3 className="property-header">Layout</h3>
                    <div className="property-row">
                        <span className="property-label">Floor Area</span>
                        <input type="number" className="property-input" placeholder="500" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Clearance</span>
                        <input type="number" className="property-input" placeholder="2.5" />
                    </div>
                    <button className="property-button">Optimize Layout</button>
                </div>

                <div className="property-section">
                    <h3 className="property-header">Simulation</h3>
                    <button className="property-button">Run Throughput Analysis</button>
                    <button className="property-button">Collision Detection</button>
                </div>
            </aside>
        </>
    );
}

export default WorkbenchIndustrial;
