import React from 'react';
import './WorkbenchMechanical.css';

/**
 * Mechanical CAD Workbench
 * Parametric modeling, assemblies, precision constraints
 */
function WorkbenchMechanical({ onGenerate }) {
    return (
        <>
            {/* Left Sidebar - Mechanical Tools */}
            <aside className="workbench-tools">
                <div className="tool-section">
                    <h3 className="tool-section-title">Parametric</h3>
                    <button className="tool-button">
                        <span className="tool-icon">📐</span>
                        Sketch
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">➡️</span>
                        Extrude
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🔄</span>
                        Revolve
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">✂️</span>
                        Cut
                    </button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">Modify</h3>
                    <button className="tool-button">
                        <span className="tool-icon">🔲</span>
                        Fillet
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">📏</span>
                        Chamfer
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🔁</span>
                        Pattern
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🪞</span>
                        Mirror
                    </button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">Assembly</h3>
                    <button className="tool-button">
                        <span className="tool-icon">🔗</span>
                        Insert Component
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🧲</span>
                        Mate
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">⚡</span>
                        Motion Study
                    </button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">AI Tools</h3>
                    <button className="tool-button ai-tool">
                        <span className="tool-icon">🤖</span>
                        AI Generate Part
                    </button>
                    <button className="tool-button ai-tool">
                        <span className="tool-icon">⚙️</span>
                        Auto Constraint
                    </button>
                </div>
            </aside>

            {/* Center - 3D Viewport */}
            <main className="workbench-viewport">
                <canvas id="render-canvas-mechanical"></canvas>
                <div className="viewport-overlay">
                    <div className="viewport-controls">
                        <button className="viewport-button" title="Top View">⬆️</button>
                        <button className="viewport-button" title="Front View">🔲</button>
                        <button className="viewport-button" title="Right View">➡️</button>
                        <button className="viewport-button" title="Isometric">📐</button>
                    </div>
                </div>
            </main>

            {/* Right Sidebar - Properties */}
            <aside className="workbench-properties">
                <div className="property-group">
                    <h3 className="property-label">Sketch Constraints</h3>
                    <label>
                        <span className="property-label">Dimension Type</span>
                        <select className="property-input">
                            <option>Linear</option>
                            <option>Angular</option>
                            <option>Radial</option>
                            <option>Diameter</option>
                        </select>
                    </label>
                </div>

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
                        <option>Stainless Steel 304</option>
                        <option>Titanium Grade 5</option>
                        <option>ABS Plastic</option>
                    </select>
                </div>

                <div className="property-group">
                    <h3 className="property-label">Analysis</h3>
                    <button className="property-button">Run FEA</button>
                    <button className="property-button">Mass Properties</button>
                </div>
            </aside>
        </>
    );
}

export default WorkbenchMechanical;
