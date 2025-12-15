import React from 'react';
import Viewport3D from '../../components/Viewport3D';

/**
 * Gaming & VFX Workbench
 * Industry Standard: Maya, Blender, 3ds Max
 */
function WorkbenchGaming() {
    return (
        <>
            {/* LEFT TOOLBAR - ICON ONLY */}
            <aside className="workbench-tools">
                <button className="tool-icon-button" title="Select">⬚</button>
                <button className="tool-icon-button active" title="Model">◫</button>
                <button className="tool-icon-button" title="Sculpt">◐</button>
                <button className="tool-icon-button" title="UV">⊞</button>
                <button className="tool-icon-button" title="Texture">🎨</button>
                <button className="tool-icon-button" title="Rig">⚙</button>
                <button className="tool-icon-button" title="Animate">▶</button>
                <button className="tool-icon-button" title="Particles">✦</button>
            </aside>

            {/* CENTER VIEWPORT - HERO */}
            <main className="workbench-viewport">
                <Viewport3D canvasId="render-canvas-gaming" />
            </main>

            {/* RIGHT PROPERTIES PANEL */}
            <aside className="workbench-properties">
                <div className="property-section">
                    <h3 className="property-header">Mesh</h3>
                    <div className="property-row">
                        <span className="property-label">Vertices</span>
                        <input type="number" className="property-input" placeholder="1024" disabled />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Faces</span>
                        <input type="number" className="property-input" placeholder="2048" disabled />
                    </div>
                    <button className="property-button">Subdivide Surface</button>
                </div>

                <div className="property-section">
                    <h3 className="property-header">Material</h3>
                    <div className="property-row">
                        <span className="property-label">Shader</span>
                        <select className="property-input">
                            <option>PBR Metallic</option>
                            <option>Principled BSDF</option>
                            <option>Toon Shader</option>
                        </select>
                    </div>
                    <div className="property-row">
                        <span className="property-label">Base Color</span>
                        <input type="color" className="property-input" defaultValue="#808080" />
                    </div>
                </div>

                <div className="property-section">
                    <h3 className="property-header">Animation</h3>
                    <div className="property-row">
                        <span className="property-label">Frame</span>
                        <input type="number" className="property-input" placeholder="1" />
                    </div>
                    <button className="property-button">Insert Keyframe</button>
                    <button className="property-button">Render Animation</button>
                </div>
            </aside>
        </>
    );
}

export default WorkbenchGaming;
