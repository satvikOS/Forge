import React from 'react';
import './WorkbenchAviation.css';

/**
 * Aviation & Defense Workbench
 * Airfoil design, structural analysis, weight distribution
 */
function WorkbenchAviation({ onGenerate }) {
    return (
        <>
            {/* Left Sidebar - Aviation Tools */}
            <aside className="workbench-tools">
                <div className="tool-section">
                    <h3 className="tool-section-title">Airfoil Design</h3>
                    <button className="tool-button">
                        <span className="tool-icon">✈️</span>
                        Wing Design
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🌀</span>
                        Airfoil Generator
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">📐</span>
                        NACA Profiles
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🔄</span>
                        Twist & Taper
                    </button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">Structural</h3>
                    <button className="tool-button">
                        <span className="tool-icon">🏗️</span>
                        Fuselage Frame
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">⚖️</span>
                        Weight Distribution
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🔩</span>
                        Rivet Patterns
                    </button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">Analysis</h3>
                    <button className="tool-button">
                        <span className="tool-icon">💨</span>
                        Lift/Drag Analysis
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">📊</span>
                        Stress Analysis
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🎯</span>
                        Center of Gravity
                    </button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">AI Tools</h3>
                    <button className="tool-button ai-tool">
                        <span className="tool-icon">🤖</span>
                        AI Wing Optimizer
                    </button>
                    <button className="tool-button ai-tool">
                        <span className="tool-icon">⚡</span>
                        Performance Optimizer
                    </button>
                </div>
            </aside>

            {/* Center - 3D Viewport */}
            <main className="workbench-viewport">
                <canvas id="render-canvas-aviation"></canvas>
                <div className="viewport-overlay">
                    <div className="viewport-controls">
                        <button className="viewport-button" title="Top View">⬆️</button>
                        <button className="viewport-button" title="Side View">➡️</button>
                        <button className="viewport-button" title="Front View">🔲</button>
                        <button className="viewport-button" title="3D View">✈️</button>
                    </div>
                    <div className="flight-metrics">
                        <div className="metric">
                            <span className="metric-label">Lift Coefficient</span>
                            <span className="metric-value">1.24</span>
                        </div>
                        <div className="metric">
                            <span className="metric-label">L/D Ratio</span>
                            <span className="metric-value">18.5</span>
                        </div>
                    </div>
                </div>
            </main>

            {/* Right Sidebar - Properties */}
            <aside className="workbench-properties">
                <div className="property-group">
                    <h3 className="property-label">Airfoil Parameters</h3>
                    <label>
                        <span className="property-label">Profile</span>
                        <select className="property-input">
                            <option>NACA 2412</option>
                            <option>NACA 4412</option>
                            <option>NACA 6412</option>
                            <option>Custom</option>
                        </select>
                    </label>
                    <label>
                        <span className="property-label">Chord Length (m)</span>
                        <input type="number" className="property-input" placeholder="2.5" />
                    </label>
                    <label>
                        <span className="property-label">Angle of Attack (°)</span>
                        <input type="number" className="property-input" placeholder="5" />
                    </label>
                </div>

                <div className="property-group">
                    <h3 className="property-label">Performance</h3>
                    <div className="perf-stats">
                        <div className="stat-row">
                            <span>Lift Coefficient:</span>
                            <span className="stat-value">1.24</span>
                        </div>
                        <div className="stat-row">
                            <span>Drag Coefficient:</span>
                            <span className="stat-value">0.067</span>
                        </div>
                        <div className="stat-row">
                            <span>L/D Ratio:</span>
                            <span className="stat-value">18.5</span>
                        </div>
                    </div>
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

export default WorkbenchAviation;
