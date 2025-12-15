import React from 'react';

/**
 * Aviation & Defense Workbench - Blender Layout
 * Aircraft design, airfoil analysis, structural integrity
 */
function WorkbenchAviation() {
    return (
        <>
            {/* LEFT TOOLBAR - ICON ONLY */}
            <aside className="workbench-tools">
                <button className="tool-icon-button" title="Select">⬚</button>
                <button className="tool-icon-button active" title="Airfoil">⌇</button>
                <button className="tool-icon-button" title="Wing">✈</button>
                <button className="tool-icon-button" title="Fuselage">⬭</button>
                <button className="tool-icon-button" title="Tail">⊿</button>
                <button className="tool-icon-button" title="Engine">◯</button>
                <button className="tool-icon-button" title="Airflow">≈</button>
                <button className="tool-icon-button" title="Stress">⚡</button>
            </aside>

            {/* CENTER VIEWPORT - HERO */}
            <main className="workbench-viewport">
                <canvas id="render-canvas-aviation"></canvas>

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
                    <button className="gizmo-button">Scale</button>
                </div>
            </main>

            {/* RIGHT PROPERTIES PANEL */}
            <aside className="workbench-properties">
                <div className="property-section">
                    <h3 className="property-header">Airfoil</h3>
                    <div className="property-row">
                        <span className="property-label">Profile</span>
                        <select className="property-input">
                            <option>NACA 2412</option>
                            <option>NACA 4415</option>
                            <option>Clark Y</option>
                        </select>
                    </div>
                    <div className="property-row">
                        <span className="property-label">Chord</span>
                        <input type="number" className="property-input" placeholder="2.5" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">AOA</span>
                        <input type="number" className="property-input" placeholder="5" />
                    </div>
                </div>

                <div className="property-section">
                    <h3 className="property-header">Performance</h3>
                    <div className="property-row">
                        <span className="property-label">L/D Ratio</span>
                        <input type="number" className="property-input" placeholder="15.5" disabled />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Stall Speed</span>
                        <input type="number" className="property-input" placeholder="65" disabled />
                    </div>
                    <button className="property-button">Run CFD Analysis</button>
                </div>

                <div className="property-section">
                    <h3 className="property-header">Structure</h3>
                    <button className="property-button">Stress Analysis</button>
                    <button className="property-button">Weight Distribution</button>
                </div>
            </aside>
        </>
    );
}

export default WorkbenchAviation;
