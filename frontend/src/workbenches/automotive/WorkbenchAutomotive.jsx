import React from 'react';
import './WorkbenchAutomotive.css';

/**
 * Automotive Design Workbench
 * Vehicle design, surface modeling, aerodynamics
 */
function WorkbenchAutomotive({ onGenerate }) {
    return (
        <>
            {/* Left Sidebar - Automotive Tools */}
            <aside className="workbench-tools">
                <div className="tool-section">
                    <h3 className="tool-section-title">Surface Modeling</h3>
                    <button className="tool-button">
                        <span className="tool-icon">📐</span>
                        A-Class Surface
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🎨</span>
                        Freeform Surface
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">📏</span>
                        Loft
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🔄</span>
                        Sweep
                    </button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">Chassis & Frame</h3>
                    <button className="tool-button">
                        <span className="tool-icon">🏗️</span>
                        Frame Builder
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">⚙️</span>
                        Suspension
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🔧</span>
                        Drivetrain
                    </button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">Analysis</h3>
                    <button className="tool-button">
                        <span className="tool-icon">💨</span>
                        CFD (Aerodynamics)
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">📊</span>
                        Crash Test Sim
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">⚡</span>
                        Thermal Analysis
                    </button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">AI Tools</h3>
                    <button className="tool-button ai-tool">
                        <span className="tool-icon">🤖</span>
                        AI Body Design
                    </button>
                    <button className="tool-button ai-tool">
                        <span className="tool-icon">💨</span>
                        Optimize Drag
                    </button>
                </div>
            </aside>

            {/* Center - 3D Viewport */}
            <main className="workbench-viewport">
                <canvas id="render-canvas-automotive"></canvas>
                <div className="viewport-overlay">
                    <div className="viewport-controls">
                        <button className="viewport-button" title="Exterior View">🚗</button>
                        <button className="viewport-button" title="Interior View">🪑</button>
                        <button className="viewport-button" title="Wireframe">📐</button>
                        <button className="viewport-button" title="Render">🎨</button>
                    </div>
                    <div className="aero-indicator">
                        <span className="aero-label">Drag Coefficient</span>
                        <span className="aero-value">Cd = 0.28</span>
                    </div>
                </div>
            </main>

            {/* Right Sidebar - Properties */}
            <aside className="workbench-properties">
                <div className="property-group">
                    <h3 className="property-label">Vehicle Specs</h3>
                    <label>
                        <span className="property-label">Vehicle Type</span>
                        <select className="property-input">
                            <option>Sedan</option>
                            <option>SUV</option>
                            <option>Sports Car</option>
                            <option>Truck</option>
                        </select>
                    </label>
                    <label>
                        <span className="property-label">Wheelbase (mm)</span>
                        <input type="number" className="property-input" placeholder="2800" />
                    </label>
                    <label>
                        <span className="property-label">Track Width (mm)</span>
                        <input type="number" className="property-input" placeholder="1600" />
                    </label>
                </div>

                <div className="property-group">
                    <h3 className="property-label">Aerodynamics</h3>
                    <div className="aero-stats">
                        <div className="stat-row">
                            <span>Drag Coefficient:</span>
                            <span className="stat-value">0.28</span>
                        </div>
                        <div className="stat-row">
                            <span>Downforce (N):</span>
                            <span className="stat-value">450</span>
                        </div>
                    </div>
                    <button className="property-button">Run CFD Analysis</button>
                </div>

                <div className="property-group">
                    <h3 className="property-label">Export</h3>
                    <button className="property-button">Export STEP</button>
                    <button className="property-button">Export to CAM</button>
                </div>
            </aside>
        </>
    );
}

export default WorkbenchAutomotive;
