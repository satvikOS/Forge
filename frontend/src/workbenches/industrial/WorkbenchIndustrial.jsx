import React from 'react';
import './WorkbenchIndustrial.css';

/**
 * Industrial & Machinery Workbench
 * Factory layouts, conveyor systems, robotic arms
 */
function WorkbenchIndustrial({ onGenerate }) {
    return (
        <>
            {/* Left Sidebar - Industrial Tools */}
            <aside className="workbench-tools">
                <div className="tool-section">
                    <h3 className="tool-section-title">Factory Layout</h3>
                    <button className="tool-button">
                        <span className="tool-icon">🏭</span>
                        Assembly Line
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">📦</span>
                        Storage Zone
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🚪</span>
                        Loading Dock
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🔲</span>
                        Floor Zones
                    </button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">Machinery</h3>
                    <button className="tool-button">
                        <span className="tool-icon">🦾</span>
                        Robotic Arm
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🔄</span>
                        Conveyor Belt
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🏗️</span>
                        CNC Machine
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">⚙️</span>
                        Custom Equipment
                    </button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">Simulation</h3>
                    <button className="tool-button">
                        <span className="tool-icon">🎬</span>
                        Motion Path
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">📊</span>
                        Throughput Analysis
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">⏱️</span>
                        Cycle Time
                    </button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">AI Tools</h3>
                    <button className="tool-button ai-tool">
                        <span className="tool-icon">🤖</span>
                        Optimize Layout
                    </button>
                    <button className="tool-button ai-tool">
                        <span className="tool-icon">🦾</span>
                        Design Robot Gripper
                    </button>
                </div>
            </aside>

            {/* Center - 3D Viewport */}
            <main className="workbench-viewport">
                <canvas id="render-canvas-industrial"></canvas>
                <div className="viewport-overlay">
                    <div className="viewport-controls">
                        <button className="viewport-button" title="Top View">⬇️</button>
                        <button className="viewport-button" title="Side View">➡️</button>
                        <button className="viewport-button" title="3D View">📦</button>
                        <button className="viewport-button" title="Simulate">▶️</button>
                    </div>
                    <div className="production-stats">
                        <div className="stat-item">
                            <span className="stat-label">Throughput</span>
                            <span className="stat-value">120 units/hr</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">Efficiency</span>
                            <span className="stat-value">87%</span>
                        </div>
                    </div>
                </div>
            </main>

            {/* Right Sidebar - Properties */}
            <aside className="workbench-properties">
                <div className="property-group">
                    <h3 className="property-label">Layout Settings</h3>
                    <label>
                        <span className="property-label">Factory Size (m²)</span>
                        <input type="number" className="property-input" placeholder="5000" />
                    </label>
                    <label>
                        <span className="property-label">Production Line Count</span>
                        <input type="number" className="property-input" placeholder="3" />
                    </label>
                </div>

                <div className="property-group">
                    <h3 className="property-label">Robot Parameters</h3>
                    <label>
                        <span className="property-label">Reach (mm)</span>
                        <input type="number" className="property-input" placeholder="1500" />
                    </label>
                    <label>
                        <span className="property-label">Payload (kg)</span>
                        <input type="number" className="property-input" placeholder="10" />
                    </label>
                    <label>
                        <span className="property-label">DOF (Degrees of Freedom)</span>
                        <input type="number" className="property-input" placeholder="6" />
                    </label>
                </div>

                <div className="property-group">
                    <h3 className="property-label">Analysis</h3>
                    <button className="property-button">Run Simulation</button>
                    <button className="property-button">Export Layout</button>
                </div>
            </aside>
        </>
    );
}

export default WorkbenchIndustrial;
