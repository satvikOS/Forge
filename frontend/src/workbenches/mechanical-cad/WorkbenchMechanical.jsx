import React, { useState } from 'react';
import Viewport3D from '../../components/Viewport3D';
import './WorkbenchMechanical.css';

/**
 * Mechanical CAD Workbench - Minimalistic Blender Layout with Dropdowns
 * Industry Standard: SolidWorks, Siemens NX, CATIA
 */
function WorkbenchMechanical() {
    const [aiPrompt, setAiPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [activeDropdown, setActiveDropdown] = useState(null);
    const [contextMenu, setContextMenu] = useState(null);

    // AI Design Generation
    const handleGenerateDesign = async () => {
        if (!aiPrompt.trim()) return;
        setIsGenerating(true);

        try {
            const response = await fetch('/api/mechanical/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt: aiPrompt, preferences: { variantCount: 3 } })
            });

            const data = await response.json();

            if (data.success) {
                pollJobStatus(data.jobId);
            }
        } catch (error) {
            console.error('Error generating design:', error);
            setIsGenerating(false);
        }
    };

    const pollJobStatus = async (jobId) => {
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`/api/mechanical/generate/${jobId}`);
                const job = await response.json();

                if (job.status === 'completed') {
                    clearInterval(interval);
                    console.log('Design generated:', job.result);
                    setIsGenerating(false);
                    setAiPrompt('');
                } else if (job.status === 'failed') {
                    clearInterval(interval);
                    console.error('Design generation failed:', job.error);
                    setIsGenerating(false);
                }
            } catch (error) {
                clearInterval(interval);
                console.error('Error polling job:', error);
                setIsGenerating(false);
            }
        }, 1000);
    };

    const toggleDropdown = (dropdownName) => {
        setActiveDropdown(activeDropdown === dropdownName ? null : dropdownName);
    };

    const handleRightClick = (e, itemType) => {
        e.preventDefault();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            type: itemType
        });
    };

    const closeContextMenu = () => setContextMenu(null);

    return (
        <>
            {/* LEFT TOOLBAR - ICON WITH DROPDOWNS */}
            <aside className="workbench-tools" onClick={() => setActiveDropdown(null)}>
                <button className="tool-icon-button" title="Select">⬚</button>
                <button className="tool-icon-button" title="Move">✥</button>

                {/* Sketch Dropdown */}
                <div className="tool-dropdown-container">
                    <button
                        className="tool-icon-button active"
                        title="Sketch"
                        onClick={(e) => { e.stopPropagation(); toggleDropdown('sketch'); }}
                    >
                        ✎
                    </button>
                    {activeDropdown === 'sketch' && (
                        <div className="tool-dropdown">
                            <div className="dropdown-item">Line</div>
                            <div className="dropdown-item">Circle</div>
                            <div className="dropdown-item">Arc</div>
                            <div className="dropdown-item">Rectangle</div>
                            <div className="dropdown-item">Polygon</div>
                            <div className="dropdown-divider"></div>
                            <div className="dropdown-item">Dimension</div>
                            <div className="dropdown-item">Constraints</div>
                        </div>
                    )}
                </div>

                {/* Features Dropdown */}
                <div className="tool-dropdown-container">
                    <button
                        className="tool-icon-button"
                        title="Features"
                        onClick={(e) => { e.stopPropagation(); toggleDropdown('features'); }}
                    >
                        ⬆
                    </button>
                    {activeDropdown === 'features' && (
                        <div className="tool-dropdown">
                            <div className="dropdown-item">Extrude</div>
                            <div className="dropdown-item">Revolve</div>
                            <div className="dropdown-item">Sweep</div>
                            <div className="dropdown-item">Loft</div>
                            <div className="dropdown-divider"></div>
                            <div className="dropdown-item">Fillet</div>
                            <div className="dropdown-item">Chamfer</div>
                            <div className="dropdown-item">Hole</div>
                            <div className="dropdown-item">Shell</div>
                        </div>
                    )}
                </div>

                {/* Sheet Metal Dropdown */}
                <div className="tool-dropdown-container">
                    <button
                        className="tool-icon-button"
                        title="Sheet Metal"
                        onClick={(e) => { e.stopPropagation(); toggleDropdown('sheetmetal'); }}
                    >
                        ⎕
                    </button>
                    {activeDropdown === 'sheetmetal' && (
                        <div className="tool-dropdown">
                            <div className="dropdown-header">Create</div>
                            <div className="dropdown-item">Base Face</div>
                            <div className="dropdown-item">Edge Flange</div>
                            <div className="dropdown-item">Contour Flange</div>
                            <div className="dropdown-item">Hem</div>
                            <div className="dropdown-divider"></div>
                            <div className="dropdown-header">Modify</div>
                            <div className="dropdown-item">Fold</div>
                            <div className="dropdown-item">Unfold</div>
                            <div className="dropdown-item">Corner Relief</div>
                            <div className="dropdown-item">Rip</div>
                            <div className="dropdown-divider"></div>
                            <div className="dropdown-item">✓ Flat Pattern</div>
                            <div className="dropdown-item">Export DXF</div>
                        </div>
                    )}
                </div>

                {/* Pattern Dropdown */}
                <div className="tool-dropdown-container">
                    <button
                        className="tool-icon-button"
                        title="Pattern"
                        onClick={(e) => { e.stopPropagation(); toggleDropdown('pattern'); }}
                    >
                        ▦
                    </button>
                    {activeDropdown === 'pattern' && (
                        <div className="tool-dropdown">
                            <div className="dropdown-item">Linear Pattern</div>
                            <div className="dropdown-item">Circular Pattern</div>
                            <div className="dropdown-item">Mirror</div>
                        </div>
                    )}
                </div>

                {/* Assembly Dropdown */}
                <div className="tool-dropdown-container">
                    <button
                        className="tool-icon-button"
                        title="Assembly"
                        onClick={(e) => { e.stopPropagation(); toggleDropdown('assembly'); }}
                    >
                        🔗
                    </button>
                    {activeDropdown === 'assembly' && (
                        <div className="tool-dropdown">
                            <div className="dropdown-item">Insert Component</div>
                            <div className="dropdown-item">Mate</div>
                            <div className="dropdown-item">Angle</div>
                            <div className="dropdown-item">Tangent</div>
                            <div className="dropdown-divider"></div>
                            <div className="dropdown-item">Motion Study</div>
                            <div className="dropdown-item">Exploded View</div>
                        </div>
                    )}
                </div>

                {/* Weldments Dropdown */}
                <div className="tool-dropdown-container">
                    <button
                        className="tool-icon-button"
                        title="Weldments"
                        onClick={(e) => { e.stopPropagation(); toggleDropdown('weldments'); }}
                    >
                        🔩
                    </button>
                    {activeDropdown === 'weldments' && (
                        <div className="tool-dropdown">
                            <div className="dropdown-header">Structural</div>
                            <div className="dropdown-item">Structural Frame</div>
                            <div className="dropdown-item">Trim/Extend</div>
                            <div className="dropdown-item">End Cap</div>
                            <div className="dropdown-divider"></div>
                            <div className="dropdown-header">Welds</div>
                            <div className="dropdown-item">Fillet Weld</div>
                            <div className="dropdown-item">Groove Weld</div>
                            <div className="dropdown-item">Spot Weld</div>
                            <div className="dropdown-divider"></div>
                            <div className="dropdown-item">Gusset Plate</div>
                            <div className="dropdown-item">✓ Cut List</div>
                        </div>
                    )}
                </div>

                {/* AI Optimization Dropdown */}
                <div className="tool-dropdown-container">
                    <button
                        className="tool-icon-button"
                        title="AI Optimization"
                        onClick={(e) => { e.stopPropagation(); toggleDropdown('ai_optimize'); }}
                    >
                        🧠
                    </button>
                    {activeDropdown === 'ai_optimize' && (
                        <div className="tool-dropdown">
                            <div className="dropdown-header">Optimization</div>
                            <div className="dropdown-item">Topology Optimization</div>
                            <div className="dropdown-item">Generative Design</div>
                            <div className="dropdown-item">Lattice Structures</div>
                            <div className="dropdown-divider"></div>
                            <div className="dropdown-header">Analysis</div>
                            <div className="dropdown-item">DFM Analysis</div>
                            <div className="dropdown-item">Cost Estimation</div>
                            <div className="dropdown-item">Design Validation</div>
                        </div>
                    )}
                </div>

                {/* Templates Dropdown */}
                <div className="tool-dropdown-container">
                    <button
                        className="tool-icon-button"
                        title="Templates"
                        onClick={(e) => { e.stopPropagation(); toggleDropdown('templates'); }}
                    >
                        📋
                    </button>
                    {activeDropdown === 'templates' && (
                        <div className="tool-dropdown">
                            <div className="dropdown-header">Standards</div>
                            <div className="dropdown-item">ANSI Parts</div>
                            <div className="dropdown-item">ISO Parts</div>
                            <div className="dropdown-item">DIN Parts</div>
                            <div className="dropdown-divider"></div>
                            <div className="dropdown-header">Assemblies</div>
                            <div className="dropdown-item">Frame Assembly</div>
                            <div className="dropdown-item">Modular System</div>
                            <div className="dropdown-divider"></div>
                            <div className="dropdown-header">Drawings</div>
                            <div className="dropdown-item">ANSI A Size</div>
                            <div className="dropdown-item">ISO A3</div>
                            <div className="dropdown-divider"></div>
                            <div className="dropdown-item">Custom Templates...</div>
                        </div>
                    )}
                </div>

                {/* Configuration Dropdown */}
                <div className="tool-dropdown-container">
                    <button
                        className="tool-icon-button"
                        title="Configuration"
                        onClick={(e) => { e.stopPropagation(); toggleDropdown('configuration'); }}
                    >
                        ⚙️
                    </button>
                    {activeDropdown === 'configuration' && (
                        <div className="tool-dropdown">
                            <div className="dropdown-item">New Configuration</div>
                            <div className="dropdown-item">Design Table</div>
                            <div className="dropdown-item">Switch Configuration</div>
                            <div className="dropdown-divider"></div>
                            <div className="dropdown-item">Import CSV/Excel</div>
                            <div className="dropdown-item">Export Table</div>
                            <div className="dropdown-item">Compare Configs</div>
                        </div>
                    )}
                </div>

                {/* Analysis Dropdown */}
                <div className="tool-dropdown-container">
                    <button
                        className="tool-icon-button"
                        title="Analysis"
                        onClick={(e) => { e.stopPropagation(); toggleDropdown('analysis'); }}
                    >
                        📊
                    </button>
                    {activeDropdown === 'analysis' && (
                        <div className="tool-dropdown">
                            <div className="dropdown-item">FEA Analysis</div>
                            <div className="dropdown-item">Motion Simulation</div>
                            <div className="dropdown-item">Mass Properties</div>
                            <div className="dropdown-divider"></div>
                            <div className="dropdown-item">2D Drawing</div>
                            <div className="dropdown-item">Generate BOM</div>
                        </div>
                    )}
                </div>
            </aside>

            {/* CENTER VIEWPORT - HERO */}
            <main
                className="workbench-viewport"
                onContextMenu={(e) => handleRightClick(e, 'viewport')}
                onClick={closeContextMenu}
            >
                <Viewport3D canvasId="render-canvas-mechanical" domain="mechanical" />
            </main>

            {/* RIGHT PROPERTIES PANEL */}
            <aside className="workbench-properties">
                {/* Feature Properties */}
                <div className="property-section">
                    <h3 className="property-header">Feature</h3>
                    <div className="property-row">
                        <span className="property-label">Distance</span>
                        <input type="number" className="property-input" placeholder="10.0" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Draft Angle</span>
                        <input type="number" className="property-input" placeholder="0.0" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Radius</span>
                        <input type="number" className="property-input" placeholder="2.0" />
                    </div>
                </div>

                {/* Material */}
                <div className="property-section">
                    <h3 className="property-header">Material</h3>
                    <select className="property-input">
                        <option>Aluminum 6061</option>
                        <option>Steel 1045</option>
                        <option>Stainless Steel 304</option>
                        <option>Titanium Ti-6Al-4V</option>
                        <option>ABS Plastic</option>
                    </select>
                </div>

                {/* Analysis */}
                <div className="property-section">
                    <h3 className="property-header">Analysis</h3>
                    <button className="property-button">Run FEA Analysis</button>
                    <button className="property-button">Motion Simulation</button>
                    <button className="property-button">Generate Toolpaths</button>
                </div>

                {/* Export */}
                <div className="property-section">
                    <h3 className="property-header">Export</h3>
                    <button className="property-button">Export STEP</button>
                    <button className="property-button">Export STL</button>
                    <button className="property-button">Generate Drawing</button>
                </div>
            </aside>

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="context-menu"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={closeContextMenu}
                >
                    <div className="context-menu-item">Edit Feature</div>
                    <div className="context-menu-item">Suppress</div>
                    <div className="context-menu-item">Delete</div>
                    {contextMenu.type === 'viewport' && (
                        <>
                            <div className="context-menu-divider"></div>
                            <div className="context-menu-item">New Sketch</div>
                            <div className="context-menu-item">Select Bodies</div>
                        </>
                    )}
                </div>
            )}
        </>
    );
}

export default WorkbenchMechanical;
