import React from 'react';
import Viewport3D from '../../components/Viewport3D';

/**
 * Architecture & BIM Workbench - Blender Layout  
 * Industry Standard: Revit, ArchiCAD
 */
function WorkbenchArchitecture() {
    return (
        <>
            {/* LEFT TOOLBAR - ICON ONLY */}
            <aside className="workbench-tools">
                <button className="tool-icon-button" title="Select">⬚</button>
                <button className="tool-icon-button active" title="Wall">▬</button>
                <button className="tool-icon-button" title="Door">⌂</button>
                <button className="tool-icon-button" title="Window">◫</button>
                <button className="tool-icon-button" title="Floor">▭</button>
                <button className="tool-icon-button" title="Roof">⌂</button>
                <button className="tool-icon-button" title="Column">║</button>
                <button className="tool-icon-button" title="Level">≡</button>
            </aside>

            {/* CENTER VIEWPORT - HERO */}
            <main className="workbench-viewport">
                <Viewport3D canvasId="render-canvas-architecture" />
            </main>

            {/* RIGHT PROPERTIES PANEL */}
            <aside className="workbench-properties">
                <div className="property-section">
                    <h3 className="property-header">Element</h3>
                    <div className="property-row">
                        <span className="property-label">Type</span>
                        <select className="property-input">
                            <option>Interior Wall</option>
                            <option>Exterior Wall</option>
                            <option>Curtain Wall</option>
                        </select>
                    </div>
                    <div className="property-row">
                        <span className="property-label">Height</span>
                        <input type="number" className="property-input" placeholder="3000" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Thickness</span>
                        <input type="number" className="property-input" placeholder="200" />
                    </div>
                </div>

                <div className="property-section">
                    <h3 className="property-header">BIM Data</h3>
                    <div className="property-row">
                        <span className="property-label">Level</span>
                        <select className="property-input">
                            <option>Level 1 (0.0m)</option>
                            <option>Level 2 (3.0m)</option>
                            <option>Roof (6.0m)</option>
                        </select>
                    </div>
                    <div className="property-row">
                        <span className="property-label">Family</span>
                        <input type="text" className="property-input" placeholder="Basic Wall" />
                    </div>
                </div>

                <div className="property-section">
                    <h3 className="property-header">Analysis</h3>
                    <button className="property-button">Check Code Compliance</button>
                    <button className="property-button">Structural Analysis</button>
                    <button className="property-button">Export to IFC</button>
                </div>
            </aside>
        </>
    );
}

export default WorkbenchArchitecture;
