import React, { useState } from 'react';
import Viewport3D from '../../components/Viewport3D';
import RibbonTopbar from '../../components/RibbonTopbar';
import {
    Mouse, Move, Pencil, Box, Layers, RotateCcw, ZoomIn, Home,
    Settings, History, Save
} from 'lucide-react';
import './WorkbenchMechanical.css';

/**
 * Mechanical CAD Workbench - Minimalistic Blender Layout with Dropdowns
 * Industry Standard: SolidWorks, Siemens NX, CATIA
 */
function WorkbenchMechanical() {
    const [aiPrompt, setAiPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [activeDropdown, setActiveDropdown] = useState(null);
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
    const [contextMenu, setContextMenu] = useState(null);
    const buttonRefs = React.useRef({});

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

    const toggleDropdown = (dropdownName, event) => {
        if (activeDropdown === dropdownName) {
            setActiveDropdown(null);
        } else {
            setActiveDropdown(dropdownName);
            // Calculate position based on button location with viewport boundary detection
            if (event && event.currentTarget) {
                const rect = event.currentTarget.getBoundingClientRect();
                const viewportHeight = window.innerHeight;
                const dropdownMaxHeight = 400; // Approximate max dropdown height

                let top = rect.top;

                // Check if dropdown would go off-screen at bottom
                if (rect.top + dropdownMaxHeight > viewportHeight) {
                    // Position above the button if there's more space above
                    if (rect.top > viewportHeight - rect.bottom) {
                        top = Math.max(10, rect.bottom - dropdownMaxHeight);
                    } else {
                        // Position at bottom of viewport with padding
                        top = viewportHeight - dropdownMaxHeight - 10;
                    }
                }

                // Ensure dropdown doesn't go above viewport top
                top = Math.max(10, top);

                setDropdownPosition({
                    top: top,
                    left: rect.right + 8 // 8px margin from button
                });
            }
        }
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

    // ==================== HANDLER FUNCTIONS FOR ALL SERVICES ====================

    // CAM/Manufacturing Handlers
    const handleCAMOperation = async (operation, data = {}) => {
        try {
            const response = await fetch(`/api/mechanical/cam/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`CAM ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`Error in CAM ${operation}:`, error);
        }
    };

    // GD&T Handlers
    const handleGDT = async (operation, data = {}) => {
        try {
            const response = await fetch(`/api/mechanical/gdt/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`GD&T ${operation}completed:`, result);
            }
        } catch (error) {
            console.error(`Error in GD&T ${operation}:`, error);
        }
    };

    // BOM Handlers
    const handleBOM = async (operation, data = {}) => {
        try {
            const response = await fetch(`/api/mechanical/bom/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`BOM ${operation} completed:`, result);
                // Could trigger download for Excel/CSV exports
                if (operation === 'export' && result.exported) {
                    downloadFile(result.exported.content, result.exported.filename);
                }
            }
        } catch (error) {
            console.error(`Error in BOM ${operation}:`, error);
        }
    };

    // MBD Handlers
    const handleMBD = async (operation, data = {}) => {
        try {
            const response = await fetch(`/api/mechanical/mbd/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`MBD ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`Error in MBD ${operation}:`, error);
        }
    };

    // Technical Manuals Handlers
    const handleManual = async (operation, data = {}) => {
        try {
            const response = await fetch(`/api/mechanical/manual/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`Manual ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`Error in Manual ${operation}:`, error);
        }
    };

    // Revision Control Handlers
    const handleRevision = async (operation, data = {}) => {
        try {
            const response = await fetch(`/api/mechanical/revision/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`Revision ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`Error in Revision ${operation}:`, error);
        }
    };

    // Cost Estimation Handlers
    const handleCost = async (operation, data = {}) => {
        try {
            const response = await fetch(`/api/mechanical/cost/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`Cost ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`Error in Cost ${operation}:`, error);
        }
    };

    // Fixtures Handlers
    const handleFixtures = async (operation, data = {}) => {
        try {
            const response = await fetch(`/api/mechanical/fixtures/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`Fixtures ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`Error in Fixtures ${operation}:`, error);
        }
    };

    // DFA & Mechanisms Handlers
    const handleDFA = async (operation, data = {}) => {
        try {
            const response = await fetch(`/api/mechanical/dfa/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`DFA ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`Error in DFA ${operation}:`, error);
        }
    };

    // Machining Simulation Handlers
    const handleMachiningSimulation = async (operation, data = {}) => {
        try {
            const response = await fetch(`/api/mechanical/simulation/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`Machining Simulation ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`Error in Machining Simulation ${operation}:`, error);
        }
    };

    // Mold Design Handlers
    const handleMoldDesign = async (operation, data = {}) => {
        try {
            const response = await fetch(`/api/mechanical/mold/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`Mold Design ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`Error in Mold Design ${operation}:`, error);
        }
    };

    // Additive Manufacturing Handlers
    const handleAdditive = async (operation, data = {}) => {
        try {
            const response = await fetch(`/api/mechanical/additive/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`Additive ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`Error in Additive ${operation}:`, error);
        }
    };

    // Standard Components Handlers
    const handleComponents = async (operation, data = {}) => {
        try {
            const response = await fetch(`/api/mechanical/components/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`Components ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`Error in Components ${operation}:`, error);
        }
    };

    // Analysis Handlers (Enhanced for Phase 3)
    const handleAnalysis = async (operation, data = {}) => {
        try {
            const response = await fetch(`/api/mechanical/analysis/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`✓ Analysis ${operation} completed:`, result);
                // TODO: Update viewport with analysis results visualization
            }
        } catch (error) {
            console.error(`✗ Error in Analysis ${operation}:`, error);
        }
    };

    // AI Optimization Handlers (Phase 3 - AI Agents)
    const handleAIOptimization = async (operation, data = {}) => {
        try {
            console.log(`🤖 Starting AI ${operation}...`);
            const response = await fetch(`/api/mechanical/ai-optimization/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`✓ AI ${operation} completed:`, result);
                // TODO: Update viewport with AI-generated results
            }
        } catch (error) {
            console.error(`✗ Error in AI ${operation}:`, error);
        }
    };

    // Peak Design Handlers (Advanced AI Design Features)
    const handlePeakDesign = async (operation, data = {}) => {
        try {
            console.log(`🚀 Peak Design: Starting ${operation}...`);

            let endpoint = '';
            let method = 'POST';

            switch (operation) {
                case 'generative-design':
                    endpoint = '/api/mechanical/peak/generative-design';
                    data = {
                        designSpace: { bounds: { x: 200, y: 200, z: 100 } },
                        preservedRegions: [],
                        loadCases: [{ type: 'force', magnitude: 1000, direction: [0, 0, -1] }],
                        constraints: [],
                        objectives: [
                            { type: 'minimize-mass', weight: 1.0 },
                            { type: 'maximize-stiffness', weight: 1.0 }
                        ],
                        targetMassReduction: 0.5,
                        manufacturingMethod: 'additive',
                        iterations: 50,
                        populationSize: 30
                    };
                    break;

                case 'class-a-surface':
                    endpoint = '/api/mechanical/peak/class-a-surface';
                    data = {
                        controlPoints: generateSampleControlPoints(),
                        degree: [3, 3],
                        continuity: 'G2',
                        constraints: [],
                        surfaceType: 'loft',
                        qualityTarget: 'class-a'
                    };
                    break;

                case 'synchronous-edit':
                    endpoint = '/api/mechanical/peak/direct-edit';
                    data = {
                        geometry: { faces: [], edges: [], vertices: [] },
                        operation: 'move-face',
                        selection: ['face_1'],
                        parameters: { distance: 10, direction: [0, 0, 1] },
                        liveRules: true,
                        captureIntent: true
                    };
                    break;

                case 'autonomous-design':
                    endpoint = '/api/mechanical/peak/autonomous-design';
                    data = {
                        goal: prompt('Enter high-level design goal:') || 'Design a lightweight drone frame',
                        performance: { maxLoad: 1000, maxWeight: 500 },
                        constraints: {},
                        userRole: 'approve',
                        maxIterations: 10
                    };
                    break;

                default:
                    console.error(`Unknown peak design operation: ${operation}`);
                    return;
            }

            const response = await fetch(endpoint, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });

            const result = await response.json();

            if (result.success) {
                console.log(`✅ Peak Design ${operation} completed:`, result);

                // Handle async job results
                if (result.jobId) {
                    console.log(`🔄 Autonomous design job started: ${result.jobId}`);
                    console.log(`📊 Monitor progress at: /api/mechanical/peak/autonomous-design/${result.jobId}`);
                    // TODO: Implement job polling UI
                } else {
                    // Display results immediately
                    if (result.results?.variants) {
                        console.log(`🎨 Generated ${result.results.variants.length} design variants`);
                        result.results.variants.forEach((variant, idx) => {
                            console.log(`  Variant ${idx + 1}: Score ${variant.score}, Mass ${variant.properties.mass}g`);
                        });
                    }
                    // TODO: Update viewport with results
                }
            } else {
                console.error(`❌ Peak Design ${operation} failed:`, result.error);
            }
        } catch (error) {
            console.error(`✗ Error in Peak Design ${operation}:`, error);
        }
    };

    // Helper to generate sample control points for surface operations
    const generateSampleControlPoints = () => {
        const grid = [];
        for (let i = 0; i < 5; i++) {
            const row = [];
            for (let j = 0; j < 5; j++) {
                row.push([i * 25, j * 25, Math.sin(i * 0.5) * Math.cos(j * 0.5) * 10]);
            }
            grid.push(row);
        }
        return grid;
    };

    // Parametric Design Handlers (NL → CAD)
    const handleParametricDesign = async (operation, data = {}) => {
        try {
            console.log(`📐 Parametric Design: ${operation}...`);

            let endpoint = '';
            let requestData = {};

            switch (operation) {
                case 'generate-from-prompt':
                    const userPrompt = prompt('Describe the part you want to design:\n(e.g., "aluminum bracket with 4 mounting holes, 100mm x 50mm x 25mm")');
                    if (!userPrompt) return;

                    endpoint = '/api/mechanical/parametric/generate-from-prompt';
                    requestData = {
                        prompt: userPrompt,
                        options: {
                            variantCount: 5,
                            designStyle: 'auto',
                            material: 'auto',
                            manufacturingMethod: 'auto',
                            detailLevel: 'medium'
                        }
                    };
                    break;

                case 'generate-conceptual-variants':
                    endpoint = '/api/mechanical/variants/generate-conceptual';
                    requestData = {
                        requirements: {
                            designIntent: { partType: 'bracket' },
                            functionalRequirements: [],
                            constraints: {},
                            objectives: [
                                { type: 'minimize-mass', priority: 'high' },
                                { type: 'maximize-strength', priority: 'high' }
                            ]
                        },
                        count: 5
                    };
                    break;

                case 'generate-bom':
                    endpoint = '/api/mechanical/bom/generate';
                    requestData = {
                        cadModel: {
                            name: 'Current Assembly',
                            assembly: {
                                components: [
                                    { name: 'Base Plate', type: 'part' },
                                    { name: 'Bracket', type: 'part' },
                                    { name: 'M6 Bolt', type: 'part' }
                                ]
                            }
                        },
                        options: {
                            bomType: 'hierarchical',
                            includeStandardParts: true,
                            includeCosts: true,
                            includeVendors: true
                        }
                    };
                    break;

                case 'prepare-simulation':
                    endpoint = '/api/mechanical/simulation/prepare';
                    requestData = {
                        cadModel: { name: 'Current Part' },
                        simulationType: 'fea',
                        options: {
                            autoMesh: true,
                            meshDensity: 'medium',
                            autoContacts: true,
                            autoMaterials: true
                        }
                    };
                    break;

                default:
                    console.error(`Unknown parametric design operation: ${operation}`);
                    return;
            }

            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(requestData)
            });

            const result = await response.json();

            if (result.success) {
                console.log(`✅ Parametric Design ${operation} completed:`, result);

                // Display results
                if (operation === 'generate-from-prompt' && result.variants) {
                    console.log(`🎨 Generated ${result.variants.length} parametric design variants:`);
                    result.variants.forEach((variant, idx) => {
                        console.log(`  Variant ${idx + 1}: ${variant.name}`);
                        console.log(`    Approach: ${variant.approach}`);
                        console.log(`    Mass: ${variant.properties.mass}g`);
                        console.log(`    Score: ${variant.score}`);
                        console.log(`    Parametric features:`, variant.features.length);
                    });
                    console.log(`🏆 Best variant: ${result.bestVariant.name}`);
                }

                if (operation === 'generate-conceptual-variants' && result.variants) {
                    console.log(`🎨 Generated ${result.variants.length} conceptual variants:`);
                    result.variants.forEach(variant => {
                        console.log(`  ${variant.name} (${variant.approach})`);
                        console.log(`    Philosophy: ${variant.philosophy}`);
                        console.log(`    Mass: ${variant.properties.mass}g`);
                        console.log(`    Score: ${variant.score}`);
                    });
                }

                if (operation === 'generate-bom' && result.bom) {
                    console.log(`📋 BOM Generated:`);
                    console.log(`  Total parts: ${result.summary.totalParts}`);
                    console.log(`  Unique parts: ${result.summary.uniqueParts}`);
                    console.log(`  Total cost: $${result.summary.totalCost}`);
                    console.log(`  Standard parts: ${result.summary.standardParts}`);
                    console.log(`  Custom parts: ${result.summary.customParts}`);
                }

                if (operation === 'prepare-simulation') {
                    console.log(`🔬 Simulation Preparation Complete:`);
                    console.log(`  Materials assigned: ${result.materials.length}`);
                    console.log(`  Contacts defined: ${result.contacts.length}`);
                    console.log(`  Mesh elements: ${result.mesh?.estimatedElements}`);
                    console.log(`  Ready for ${result.simulationType.toUpperCase()}: ${result.readyForSimulation}`);
                }

                // TODO: Update viewport with results
            } else {
                console.error(`❌ Parametric Design ${operation} failed:`, result.error);
            }
        } catch (error) {
            console.error(`✗ Error in Parametric Design ${operation}:`, error);
        }
    };

    // Helper function to trigger file downloads
    const downloadFile = (content, filename) => {
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleRibbonCommand = (command, data) => {
        console.log('Ribbon command:', command, data);
        // Handle ribbon commands here
    };

    return (
        <>
            {/* TOPBAR RIBBON - Industry Standard */}
            <RibbonTopbar onCommand={handleRibbonCommand} />

            {/* LEFT SIDEBAR - Essential Tools Only */}
            <aside className="workbench-tools">
                <div className="workbench-tools-inner">
                    {/* Selection & Navigation */}
                    <button className="tool-icon-button" title="Select"><Mouse size={20} /></button>
                    <button className="tool-icon-button" title="Pan"><Move size={20} /></button>
                    <button className="tool-icon-button" title="Zoom"><ZoomIn size={20} /></button>
                    <button className="tool-icon-button" title="Home View"><Home size={20} /></button>

                    <div className="tool-divider"></div>

                    {/* Quick Sketch Access */}
                    <button className="tool-icon-button active" title="Sketch"><Pencil size={20} /></button>
                    <button className="tool-icon-button" title="3D Feature"><Box size={20} /></button>

                    <div className="tool-divider"></div>

                    {/* Model Tree */}
                    <button className="tool-icon-button" title="Feature Tree"><Layers size={20} /></button>

                    <div className="tool-spacer"></div>

                    {/* Bottom Tools */}
                    <button className="tool-icon-button" title="History"><History size={20} /></button>
                    <button className="tool-icon-button" title="Quick Save"><Save size={20} /></button>
                    <button className="tool-icon-button" title="Settings"><Settings size={20} /></button>
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

            {/* RIGHT PROPERTIES PANEL - Enhanced */}
            <aside className="workbench-properties">
                {/* Feature Properties */}
                <div className="property-section">
                    <h3 className="property-header">FEATURE</h3>
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

                {/* Material & Appearance */}
                <div className="property-section">
                    <h3 className="property-header">MATERIAL</h3>
                    <select className="property-input">
                        <option>Aluminum 6061</option>
                        <option>Steel 1045</option>
                        <option>Stainless Steel 304</option>
                        <option>Titanium Ti-6Al-4V</option>
                        <option>ABS Plastic</option>
                        <option>Carbon Fiber</option>
                    </select>
                    <button className="property-button">Edit Material</button>
                    <button className="property-button">Apply Appearance</button>
                </div>

                {/* Configurations */}
                <div className="property-section">
                    <h3 className="property-header">CONFIGURATION</h3>
                    <select className="property-input">
                        <option>Default</option>
                        <option>Small (50mm)</option>
                        <option>Medium (100mm)</option>
                        <option>Large (150mm)</option>
                    </select>
                    <button className="property-button">New Configuration</button>
                    <button className="property-button">Design Table</button>
                </div>

                {/* Analysis */}
                <div className="property-section">
                    <h3 className="property-header">ANALYSIS</h3>
                    <button className="property-button">Run FEA Analysis</button>
                    <button className="property-button">Motion Simulation</button>
                    <button className="property-button">CFD Analysis</button>
                </div>

                {/* Manufacturing */}
                <div className="property-section">
                    <h3 className="property-header">MANUFACTURING</h3>
                    <button className="property-button">Generate Toolpaths</button>
                    <button className="property-button">DFM Check</button>
                    <button className="property-button">Cost Estimate</button>
                </div>

                {/* 3D Printing */}
                <div className="property-section">
                    <h3 className="property-header">3D PRINTING</h3>
                    <select className="property-input">
                        <option>FDM - PLA</option>
                        <option>FDM - PETG</option>
                        <option>SLA - Resin</option>
                        <option>SLS - Nylon</option>
                    </select>
                    <button className="property-button">Prepare Print</button>
                    <button className="property-button">Export STL</button>
                </div>

                {/* Collaboration */}
                <div className="property-section">
                    <h3 className="property-header">COLLABORATE</h3>
                    <button className="property-button">Share Design</button>
                    <button className="property-button">Add Comment</button>
                    <button className="property-button">Version History</button>
                </div>

                {/* Export */}
                <div className="property-section">
                    <h3 className="property-header">EXPORT</h3>
                    <button className="property-button">Export STEP</button>
                    <button className="property-button">Generate Drawing</button>
                    <button className="property-button">Export DXF</button>
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
