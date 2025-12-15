import React from 'react';
import './WorkbenchMechanical.css';

/**
 * Mechanical CAD Workbench
 * Professional parametric modeling tools
 */
function WorkbenchMechanical({ onGenerate }) {
    return (
        <>
            {/* Single Unified Left Sidebar - Like VSCode */}
            <aside className="workbench-tools">
                {/* Parametric Section */}
                <div className="tool-section">
                    <h3 className="tool-section-title">Parametric</h3>
                    <button className="tool-button">Sketch</button>
                    <button className="tool-button">Extrude</button>
                    <button className="tool-button">Revolve</button>
                    <button className="tool-button">Cut</button>
                </div>

                {/* Modify Section */}
                <div className="tool-section">
                    <h3 className="tool-section-title">Modify</h3>
                    <button className="tool-button">Fillet</button>
                    <button className="tool-button">Chamfer</button>
                    <button className="tool-button">Pattern</button>
                    <button className="tool-button">Mirror</button>
                </div>

                {/* Assembly Section */}
                <div className="tool-section">
                    <h3 className="tool-section-title">Assembly</h3>
                    <button className="tool-button">Insert Component</button>
                    <button className="tool-button">Mate</button>
                    <button className="tool-button">Motion Study</button>
                </div>

                {/* Constraints Section */}
                <div className="tool-section">
                    <h3 className="tool-section-title">Sketch Constraints</h3>
                    <button className="tool-button">Dimension</button>
                    <button className="tool-button">Linear</button>
                </div>

                {/* Analysis Section */}
                <div className="tool-section">
                    <h3 className="tool-section-title">Analysis</h3>
                    <button className="tool-button">Material: Aluminum 6061</button>
                    <button className="tool-button">Run FEA</button>
                    <button className="tool-button">Mass Properties</button>
                </div>
            </aside>

            {/* Center - 3D Viewport with Canvas */}
            <main className="workbench-viewport">
                <canvas id="render-canvas-mechanical"></canvas>

                {/* Viewport Controls Overlay */}
                <div className="viewport-overlay">
                    <div className="viewport-controls">
                        <button className="viewport-button" title="Top View">Top</button>
                        <button className="viewport-button" title="Front View">Front</button>
                        <button className="viewport-button" title="Right View">Right</button>
                        <button className="viewport-button" title="Isometric">ISO</button>
                    </div>
                </div>

                {/* Gizmo Controls - Bottom Left */}
                <div className="gizmo-controls">
                    <button className="gizmo-button active" title="Move">Move</button>
                    <button className="gizmo-button" title="Rotate">Rotate</button>
                    <button className="gizmo-button" title="Scale">Scale</button>
                </div>
            </main>

            {/* Right Sidebar - Properties */}
            <aside className="workbench-properties">
                <div className="property-group">
                    <h3 className="property-label">Feature Parameters</h3>
                    <label>
                        <span className="property-label">Extrude Distance (mm)</span>
                        <input type="number" className="property-input" placeholder="10.0" />
                    </label>
                    <label>
                        <span className="property-label">Draft Angle (°)</span>
                        <input type="number" className="property-input" placeholder="0.0" />
                    </label>
                </div>

                <div className="property-group">
                    <h3 className="property-label">Material</h3>
                    <select className="property-input">
                        <option>Aluminum 6061</option>
                        <option>Steel 1045</option>
                        <option>ABS Plastic</option>
                    </select>
                </div>
            </aside>
        </>
    );
}

export default WorkbenchMechanical;
