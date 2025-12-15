import React from 'react';
import './WorkbenchArchitecture.css';

/**
 * Architecture & BIM Workbench
 * Building design, IFC import/export, code compliance
 */
function WorkbenchArchitecture({ onGenerate }) {
    return (
        <>
            {/* Left Sidebar - Architecture Tools */}
            <aside className="workbench-tools">
                <div className="tool-section">
                    <h3 className="tool-section-title">Building Elements</h3>
                    <button className="tool-button">
                        <span className="tool-icon">🧱</span>
                        Wall
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🚪</span>
                        Door
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🪟</span>
                        Window
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🪜</span>
                        Stairs
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🏠</span>
                        Roof
                    </button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">Structure</h3>
                    <button className="tool-button">
                        <span className="tool-icon">🏗️</span>
                        Column
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">━</span>
                        Beam
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">⬜</span>
                        Floor/Slab
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🧱</span>
                        Foundation
                    </button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">Documentation</h3>
                    <button className="tool-button">
                        <span className="tool-icon">📐</span>
                        Floor Plan
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">📏</span>
                        Elevation
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">✂️</span>
                        Section
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">📋</span>
                        Schedule
                    </button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">AI Tools</h3>
                    <button className="tool-button ai-tool">
                        <span className="tool-icon">🤖</span>
                        AI Design Building
                    </button>
                    <button className="tool-button ai-tool">
                        <span className="tool-icon">✅</span>
                        Code Compliance Check
                    </button>
                    <button className="tool-button ai-tool">
                        <span className="tool-icon">⚡</span>
                        Energy Optimization
                    </button>
                </div>
            </aside>

            {/* Center - 3D Viewport */}
            <main className="workbench-viewport">
                <canvas id="render-canvas-architecture"></canvas>
                <div className="viewport-overlay">
                    <div className="viewport-controls">
                        <button className="viewport-button" title="Plan View">📐</button>
                        <button className="viewport-button" title="North Elevation">🔼</button>
                        <button className="viewport-button" title="Section">✂️</button>
                        <button className="viewport-button" title="3D View">🏠</button>
                    </div>
                    <div className="level-indicator">
                        <span className="level-label">Level: Ground Floor</span>
                        <button className="level-up">↑</button>
                        <button className="level-down">↓</button>
                    </div>
                </div>
            </main>

            {/* Right Sidebar - Properties */}
            <aside className="workbench-properties">
                <div className="property-group">
                    <h3 className="property-label">Wall Properties</h3>
                    <label>
                        <span className="property-label">Wall Type</span>
                        <select className="property-input">
                            <option>Exterior - Brick Veneer</option>
                            <option>Interior - GWB on Studs</option>
                            <option>Concrete - 200mm</option>
                            <option>Curtain Wall - Glass</option>
                        </select>
                    </label>
                    <label>
                        <span className="property-label">Height (mm)</span>
                        <input type="number" className="property-input" placeholder="3000" />
                    </label>
                    <label>
                        <span className="property-label">Thickness (mm)</span>
                        <input type="number" className="property-input" placeholder="200" />
                    </label>
                </div>

                <div className="property-group">
                    <h3 className="property-label">Level Settings</h3>
                    <label>
                        <span className="property-label">Level Name</span>
                        <input type="text" className="property-input" placeholder="Ground Floor" />
                    </label>
                    <label>
                        <span className="property-label">Elevation (mm)</span>
                        <input type="number" className="property-input" placeholder="0" />
                    </label>
                </div>

                <div className="property-group">
                    <h3 className="property-label">Compliance</h3>
                    <button className="property-button">Check Building Code</button>
                    <button className="property-button">ADA Compliance</button>
                    <button className="property-button">Energy Analysis</button>
                </div>

                <div className="property-group">
                    <h3 className="property-label">Export</h3>
                    <button className="property-button">Export IFC</button>
                    <button className="property-button">Export DWG</button>
                    <button className="property-button">Generate PDF Set</button>
                </div>
            </aside>
        </>
    );
}

export default WorkbenchArchitecture;
