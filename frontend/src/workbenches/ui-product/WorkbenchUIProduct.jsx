import React from 'react';

/**
 * UI/Product Design Workbench - Blender Layout
 * Vector design, mockups, prototyping, artboards
 */
function WorkbenchUIProduct() {
    return (
        <>
            {/* LEFT TOOLBAR - ICON ONLY */}
            <aside className="workbench-tools">
                <button className="tool-icon-button" title="Select">⬚</button>
                <button className="tool-icon-button active" title="Frame">▭</button>
                <button className="tool-icon-button" title="Rectangle">▢</button>
                <button className="tool-icon-button" title="Circle">◯</button>
                <button className="tool-icon-button" title="Text">Ａ</button>
                <button className="tool-icon-button" title="Pen">✎</button>
                <button className="tool-icon-button" title="Image">🖼</button>
                <button className="tool-icon-button" title="Component">⊞</button>
            </aside>

            {/* CENTER VIEWPORT - HERO */}
            <main className="workbench-viewport">
                <canvas id="render-canvas-uiproduct"></canvas>

                {/* Viewport Controls - Top Right */}
                <div className="viewport-overlay">
                    <div className="viewport-controls">
                        <button className="viewport-button">Desktop</button>
                        <button className="viewport-button">Tablet</button>
                        <button className="viewport-button">Mobile</button>
                        <button className="viewport-button">Watch</button>
                    </div>
                </div>

                {/* Gizmo Controls - Bottom Left */}
                <div className="gizmo-controls">
                    <button className="gizmo-button active">Select</button>
                    <button className="gizmo-button">Pan</button>
                    <button className="gizmo-button">Zoom</button>
                </div>
            </main>

            {/* RIGHT PROPERTIES PANEL */}
            <aside className="workbench-properties">
                <div className="property-section">
                    <h3 className="property-header">Layer</h3>
                    <div className="property-row">
                        <span className="property-label">Name</span>
                        <input type="text" className="property-input" placeholder="Button" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Opacity</span>
                        <input type="number" className="property-input" placeholder="100" />
                    </div>
                </div>

                <div className="property-section">
                    <h3 className="property-header">Style</h3>
                    <div className="property-row">
                        <span className="property-label">Fill</span>
                        <input type="color" className="property-input" defaultValue="#3b82f6" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Stroke</span>
                        <input type="color" className="property-input" defaultValue="#000000" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Radius</span>
                        <input type="number" className="property-input" placeholder="8" />
                    </div>
                </div>

                <div className="property-section">
                    <h3 className="property-header">Export</h3>
                    <button className="property-button">Export PNG</button>
                    <button className="property-button">Export SVG</button>
                    <button className="property-button">Share Prototype</button>
                </div>
            </aside>
        </>
    );
}

export default WorkbenchUIProduct;
