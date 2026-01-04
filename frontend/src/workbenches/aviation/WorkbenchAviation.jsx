import React from 'react';
import Viewport3D from '../../components/Viewport3D';

/**
 * Aviation & Defense Workbench
 * Industry Standard: CATIA, Siemens NX, ANSYS
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
                <Viewport3D canvasId="render-canvas-aviation" domain="aviation" />
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
