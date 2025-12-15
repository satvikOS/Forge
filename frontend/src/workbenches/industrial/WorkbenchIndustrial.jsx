import React from 'react';
import Viewport3D from '../../components/Viewport3D';

/**
 * Industrial & Machinery Workbench
 * Industry Standard: Siemens Plant Simulation, AutoCAD Plant 3D
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
                <Viewport3D canvasId="render-canvas-industrial" domain="industrial" />
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
