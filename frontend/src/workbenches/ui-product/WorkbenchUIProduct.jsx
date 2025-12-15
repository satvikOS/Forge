import React from 'react';
import './WorkbenchUIProduct.css';

/**
 * UI/Web/Product Design Workbench
 * Vector tools, mockups, UI components
 */
function WorkbenchUIProduct({ onGenerate }) {
    return (
        <>
            {/* Left Sidebar - UI/Product Tools */}
            <aside className="workbench-tools">
                <div className="tool-section">
                    <h3 className="tool-section-title">Vector Tools</h3>
                    <button className="tool-button">
                        <span className="tool-icon">✏️</span>
                        Pen Tool
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🔲</span>
                        Rectangle
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">⭕</span>
                        Circle
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">📝</span>
                        Text
                    </button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">UI Components</h3>
                    <button className="tool-button">
                        <span className="tool-icon">🔘</span>
                        Button
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">📝</span>
                        Input Field
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">📋</span>
                        Card
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">🗂️</span>
                        Nav Bar
                    </button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">Mockups</h3>
                    <button className="tool-button">
                        <span className="tool-icon">📱</span>
                        Mobile Screen
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">💻</span>
                        Desktop Screen
                    </button>
                    <button className="tool-button">
                        <span className="tool-icon">⌚</span>
                        Watch Face
                    </button>
                </div>

                <div className="tool-section">
                    <h3 className="tool-section-title">AI Tools</h3>
                    <button className="tool-button ai-tool">
                        <span className="tool-icon">🤖</span>
                        AI Generate UI
                    </button>
                    <button className="tool-button ai-tool">
                        <span className="tool-icon">🎨</span>
                        Auto Layout
                    </button>
                </div>
            </aside>

            {/* Center - Canvas */}
            <main className="workbench-viewport">
                <canvas id="render-canvas-ui"></canvas>
                <div className="viewport-overlay">
                    <div className="viewport-controls">
                        <button className="viewport-button" title="Select">↖️</button>
                        <button className="viewport-button" title="Frame">🔲</button>
                        <button className="viewport-button" title="Component">🧩</button>
                        <button className="viewport-button" title="Preview">👁️</button>
                    </div>
                    <div className="artboard-selector">
                        <span className="artboard-label">Mobile - 375x812</span>
                        <select className="artboard-select">
                            <option>iPhone 14 Pro</option>
                            <option>iPad Pro</option>
                            <option>Desktop 1920x1080</option>
                        </select>
                    </div>
                </div>
            </main>

            {/* Right Sidebar - Properties */}
            <aside className="workbench-properties">
                <div className="property-group">
                    <h3 className="property-label">Appearance</h3>
                    <label>
                        <span className="property-label">Fill Color</span>
                        <input type="color" className="property-input" value="#6366f1" />
                    </label>
                    <label>
                        <span className="property-label">Stroke Color</span>
                        <input type="color" className="property-input" value="#000000" />
                    </label>
                    <label>
                        <span className="property-label">Opacity</span>
                        <input type="range" min="0" max="100" className="property-slider" />
                    </label>
                </div>

                <div className="property-group">
                    <h3 className="property-label">Typography</h3>
                    <label>
                        <span className="property-label">Font</span>
                        <select className="property-input">
                            <option>Inter</option>
                            <option>Roboto</option>
                            <option>SF Pro</option>
                        </select>
                    </label>
                    <label>
                        <span className="property-label">Size (px)</span>
                        <input type="number" className="property-input" placeholder="16" />
                    </label>
                </div>

                <div className="property-group">
                    <h3 className="property-label">Export</h3>
                    <button className="property-button">Export PNG</button>
                    <button className="property-button">Export SVG</button>
                    <button className="property-button">Copy CSS</button>
                </div>
            </aside>
        </>
    );
}

export default WorkbenchUIProduct;
