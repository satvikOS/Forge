import React from 'react';

/**
 * Mechanical CAD Workbench - Blender Layout
 * Toolbar (icons) | Viewport (hero) | Properties
 */
function WorkbenchMechanical() {
    return (
        <>
            {/* LEFT TOOLBAR - ICON ONLY */}
            <aside className="workbench-tools">
                <button className="tool-icon-button" title="Select">⬚</button>
                <button className="tool-icon-button" title="Move">✥</button>
                <button className="tool-icon-button active" title="Sketch">✎</button>
                <button className="tool-icon-button" title="Extrude">⬆</button>
                <button className="tool-icon-button" title="Revolve">⟳</button>
                <button className="tool-icon-button" title="Fillet">⌒</button>
                <button className="tool-icon-button" title="Chamfer">⌐</button>
                <button className="tool-icon-button" title="Pattern">▦</button>
            </aside>

            {/* CENTER VIEWPORT - HERO */}
            <main className="workbench-viewport">
                <canvas id="render-canvas-mechanical"></canvas>

                {/* Viewport Controls - Top Right */}
                <div className="viewport-overlay">
                    <div className="viewport-controls">
                        <button className="viewport-button">Top</button>
                        <button className="viewport-button">Front</button>
                        <button className="viewport-button">Right</button>
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
                    <h3 className="property-header">Transform</h3>
                    <div className="property-row">
                        <span className="property-label">Location X</span>
                        <input type="number" className="property-input" placeholder="0.0" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Location Y</span>
                        <input type="number" className="property-input" placeholder="0.0" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Location Z</span>
                        <input type="number" className="property-input" placeholder="0.0" />
                    </div>
                </div>

                <div className="property-section">
                    <h3 className="property-header">Feature</h3>
                    <div className="property-row">
                        <span className="property-label">Distance</span>
                        <input type="number" className="property-input" placeholder="10.0" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Draft Angle</span>
                        <input type="number" className="property-input" placeholder="0.0" />
                    </div>
                </div>

                <div className="property-section">
                    <h3 className="property-header">Material</h3>
                    <select className="property-input">
                        <option>Aluminum 6061</option>
                        <option>Steel 1045</option>
                        <option>ABS Plastic</option>
                    </select>
                    <button className="property-button">Run FEA Analysis</button>
                </div>
            </aside>
        </>
    );
}

export default WorkbenchMechanical;
