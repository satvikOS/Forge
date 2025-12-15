import React from 'react';
import Viewport3D from '../../components/Viewport3D';

/**
 * Automotive Design Workbench
 * Industry Standard: CATIA, Alias, ICEM Surf
 */
function WorkbenchAutomotive() {
    return (
        <>
            {/* LEFT TOOLBAR - ICON ONLY */}
            <aside className="workbench-tools">
                <button className="tool-icon-button" title="Select">⬚</button>
                <button className="tool-icon-button active" title="Surface">⌘</button>
                <button className="tool-icon-button" title="Curve">⌇</button>
                <button className="tool-icon-button" title="Blend">◐</button>
                <button className="tool-icon-button" title="Trim">✂</button>
                <button className="tool-icon-button" title="Mirror">⇄</button>
                <button className="tool-icon-button" title="Airflow">≈</button>
                <button className="tool-icon-button" title="Render">◉</button>
            </aside>

            {/* CENTER VIEWPORT - HERO */}
            <main className="workbench-viewport">
                <Viewport3D canvasId="render-canvas-automotive" domain="automotive" />
            </main>

            {/* RIGHT PROPERTIES PANEL */}
            <aside className="workbench-properties">
                <div className="property-section">
                    <h3 className="property-header">Surface</h3>
                    <div className="property-row">
                        <span className="property-label">Type</span>
                        <select className="property-input">
                            <option>A-Class Surface</option>
                            <option>NACA Airfoil</option>
                            <option>Bézier Patch</option>
                        </select>
                    </div>
                    <div className="property-row">
                        <span className="property-label">Continuity</span>
                        <select className="property-input">
                            <option>G3 (Curvature)</option>
                            <option>G2 (Tangent)</option>
                            <option>G1 (Smooth)</option>
                        </select>
                    </div>
                </div>

                <div className="property-section">
                    <h3 className="property-header">Aerodynamics</h3>
                    <div className="property-row">
                        <span className="property-label">Cd</span>
                        <input type="number" className="property-input" placeholder="0.28" step="0.01" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Cl</span>
                        <input type="number" className="property-input" placeholder="0.15" step="0.01" />
                    </div>
                    <button className="property-button">Run CFD Analysis</button>
                </div>

                <div className="property-section">
                    <h3 className="property-header">Chassis</h3>
                    <div className="property-row">
                        <span className="property-label">Wheelbase</span>
                        <input type="number" className="property-input" placeholder="2700" />
                    </div>
                    <button className="property-button">Generate Frame</button>
                </div>
            </aside>
        </>
    );
}

export default WorkbenchAutomotive;
