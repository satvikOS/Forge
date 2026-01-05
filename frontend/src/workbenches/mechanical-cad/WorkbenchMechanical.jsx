import React, { useState } from 'react';
import Viewport3D from '../../components/Viewport3D';
import {
    Mouse, Move, Pencil, Box, Layers, RotateCcw, ZoomIn, Home,
    Settings, History, Save, Circle, Square, Minus, ArrowUpDown,
    Copy, Grid3x3, Wrench, FlaskConical, FileText, Users, Package,
    Printer, Cog, Ruler, FileCode, Sheet, Zap, Eye, Database,
    GitBranch, DollarSign, BookOpen
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

    return (
        <>
            {/* LEFT SIDEBAR - Tools with Dropdowns */}
            <aside className="workbench-tools">
                <div className="workbench-tools-inner">
                    {/* Selection & Navigation */}
                    <button className="tool-icon-button" title="Select"><Mouse size={20} /></button>
                    <button className="tool-icon-button" title="Pan"><Move size={20} /></button>
                    <button className="tool-icon-button" title="Zoom"><ZoomIn size={20} /></button>
                    <button className="tool-icon-button" title="Home View"><Home size={20} /></button>

                    <div className="tool-divider"></div>

                    {/* Sketch Tools */}
                    <button
                        ref={el => buttonRefs.current['sketch'] = el}
                        className={`tool-icon-button ${activeDropdown === 'sketch' ? 'active' : ''}`}
                        onClick={(e) => toggleDropdown('sketch', e)}
                        title="Sketch"
                    >
                        <Pencil size={20} />
                    </button>

                    {/* 3D Features */}
                    <button
                        ref={el => buttonRefs.current['features'] = el}
                        className={`tool-icon-button ${activeDropdown === 'features' ? 'active' : ''}`}
                        onClick={(e) => toggleDropdown('features', e)}
                        title="3D Features"
                    >
                        <Box size={20} />
                    </button>

                    {/* Patterns */}
                    <button
                        ref={el => buttonRefs.current['patterns'] = el}
                        className={`tool-icon-button ${activeDropdown === 'patterns' ? 'active' : ''}`}
                        onClick={(e) => toggleDropdown('patterns', e)}
                        title="Patterns"
                    >
                        <Grid3x3 size={20} />
                    </button>

                    <div className="tool-divider"></div>

                    {/* Assembly */}
                    <button
                        ref={el => buttonRefs.current['assembly'] = el}
                        className={`tool-icon-button ${activeDropdown === 'assembly' ? 'active' : ''}`}
                        onClick={(e) => toggleDropdown('assembly', e)}
                        title="Assembly"
                    >
                        <Package size={20} />
                    </button>

                    {/* Manufacturing */}
                    <button
                        ref={el => buttonRefs.current['manufacturing'] = el}
                        className={`tool-icon-button ${activeDropdown === 'manufacturing' ? 'active' : ''}`}
                        onClick={(e) => toggleDropdown('manufacturing', e)}
                        title="Manufacturing"
                    >
                        <Wrench size={20} />
                    </button>

                    {/* Analysis */}
                    <button
                        ref={el => buttonRefs.current['analysis'] = el}
                        className={`tool-icon-button ${activeDropdown === 'analysis' ? 'active' : ''}`}
                        onClick={(e) => toggleDropdown('analysis', e)}
                        title="Analysis"
                    >
                        <FlaskConical size={20} />
                    </button>

                    <div className="tool-divider"></div>

                    {/* Surfaces */}
                    <button
                        ref={el => buttonRefs.current['surfaces'] = el}
                        className={`tool-icon-button ${activeDropdown === 'surfaces' ? 'active' : ''}`}
                        onClick={(e) => toggleDropdown('surfaces', e)}
                        title="Surfaces"
                    >
                        <Zap size={20} />
                    </button>

                    {/* Documentation */}
                    <button
                        ref={el => buttonRefs.current['documentation'] = el}
                        className={`tool-icon-button ${activeDropdown === 'documentation' ? 'active' : ''}`}
                        onClick={(e) => toggleDropdown('documentation', e)}
                        title="Documentation"
                    >
                        <FileText size={20} />
                    </button>

                    {/* Inspection */}
                    <button
                        ref={el => buttonRefs.current['inspection'] = el}
                        className={`tool-icon-button ${activeDropdown === 'inspection' ? 'active' : ''}`}
                        onClick={(e) => toggleDropdown('inspection', e)}
                        title="Inspection"
                    >
                        <Eye size={20} />
                    </button>

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
                onClick={() => {
                    closeContextMenu();
                    setActiveDropdown(null);
                }}
            >
                <Viewport3D canvasId="render-canvas-mechanical" domain="mechanical" />
            </main>

            {/* RIGHT PROPERTIES PANEL - Condensed */}
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

                {/* Material */}
                <div className="property-section">
                    <h3 className="property-header">MATERIAL</h3>
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
                    <h3 className="property-header">ANALYSIS</h3>
                    <button className="property-button">Run FEA Analysis</button>
                    <button className="property-button">Motion Simulation</button>
                    <button className="property-button">Generate Toolpaths</button>
                </div>

                {/* Export */}
                <div className="property-section">
                    <h3 className="property-header">EXPORT</h3>
                    <button className="property-button">Export STEP</button>
                    <button className="property-button">Export STL</button>
                    <button className="property-button">Generate Drawing</button>
                </div>

                {/* Configuration */}
                <div className="property-section">
                    <h3 className="property-header">CONFIGURATION</h3>
                    <select className="property-input">
                        <option>Default</option>
                        <option>Config A</option>
                        <option>Config B</option>
                    </select>
                    <button className="property-button">New Config</button>
                    <button className="property-button">Design Table</button>
                </div>

                {/* Collaboration */}
                <div className="property-section">
                    <h3 className="property-header">COLLABORATE</h3>
                    <button className="property-button">Share Design</button>
                    <button className="property-button">Add Comment</button>
                    <button className="property-button">Review</button>
                </div>

                {/* Version Control */}
                <div className="property-section">
                    <h3 className="property-header">VERSION</h3>
                    <button className="property-button">Save Revision</button>
                    <button className="property-button">Version History</button>
                    <button className="property-button">Branch/Merge</button>
                </div>

                {/* Standards */}
                <div className="property-section">
                    <h3 className="property-header">STANDARDS</h3>
                    <select className="property-input">
                        <option>ANSI</option>
                        <option>ISO</option>
                        <option>DIN</option>
                        <option>JIS</option>
                    </select>
                    <button className="property-button">GD&T</button>
                    <button className="property-button">Compliance Check</button>
                </div>

                {/* Cost */}
                <div className="property-section">
                    <h3 className="property-header">COST</h3>
                    <button className="property-button">Estimate Cost</button>
                    <button className="property-button">Compare Options</button>
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

            {/* DROPDOWN MENUS */}
            {activeDropdown === 'sketch' && (
                <div className="tool-dropdown" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                    <div className="dropdown-header">Sketch Tools</div>
                    <div className="dropdown-item">Line</div>
                    <div className="dropdown-item">Circle</div>
                    <div className="dropdown-item">Arc</div>
                    <div className="dropdown-item">Rectangle</div>
                    <div className="dropdown-item">Polygon</div>
                    <div className="dropdown-item">Spline</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item">Trim</div>
                    <div className="dropdown-item">Extend</div>
                    <div className="dropdown-item">Offset</div>
                    <div className="dropdown-item">Mirror</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item">Dimension</div>
                    <div className="dropdown-item">Constraint</div>
                </div>
            )}

            {activeDropdown === 'features' && (
                <div className="tool-dropdown" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                    <div className="dropdown-header">3D Features</div>
                    <div className="dropdown-item">Extrude</div>
                    <div className="dropdown-item">Revolve</div>
                    <div className="dropdown-item">Sweep</div>
                    <div className="dropdown-item">Loft</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item">Fillet</div>
                    <div className="dropdown-item">Chamfer</div>
                    <div className="dropdown-item">Draft</div>
                    <div className="dropdown-item">Shell</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item">Hole Wizard</div>
                    <div className="dropdown-item">Thread</div>
                    <div className="dropdown-item">Rib</div>
                    <div className="dropdown-item">Web</div>
                </div>
            )}

            {activeDropdown === 'patterns' && (
                <div className="tool-dropdown" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                    <div className="dropdown-header">Patterns & Mirrors</div>
                    <div className="dropdown-item">Linear Pattern</div>
                    <div className="dropdown-item">Circular Pattern</div>
                    <div className="dropdown-item">Curve Driven Pattern</div>
                    <div className="dropdown-item">Fill Pattern</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item">Mirror</div>
                    <div className="dropdown-item">Copy</div>
                    <div className="dropdown-item">Move/Copy Bodies</div>
                </div>
            )}

            {activeDropdown === 'assembly' && (
                <div className="tool-dropdown" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                    <div className="dropdown-header">Assembly Tools</div>
                    <div className="dropdown-item">Insert Component</div>
                    <div className="dropdown-item">Mate</div>
                    <div className="dropdown-item">Quick Mate</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item">Interference Detection</div>
                    <div className="dropdown-item">Collision Detection</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item">Exploded View</div>
                    <div className="dropdown-item">Motion Study</div>
                    <div className="dropdown-item">BOM</div>
                </div>
            )}

            {activeDropdown === 'manufacturing' && (
                <div className="tool-dropdown" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                    <div className="dropdown-header">Manufacturing</div>
                    <div className="dropdown-item">CAM Setup</div>
                    <div className="dropdown-item">2D Milling</div>
                    <div className="dropdown-item">3D Milling</div>
                    <div className="dropdown-item">Turning</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item">Sheet Metal</div>
                    <div className="dropdown-item">Weldments</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item">3D Printing</div>
                    <div className="dropdown-item">Mold Design</div>
                    <div className="dropdown-item">DFM Analysis</div>
                    <div className="dropdown-item">Cost Estimate</div>
                </div>
            )}

            {activeDropdown === 'analysis' && (
                <div className="tool-dropdown" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                    <div className="dropdown-header">Analysis & Simulation</div>
                    <div className="dropdown-item">FEA - Static</div>
                    <div className="dropdown-item">FEA - Dynamic</div>
                    <div className="dropdown-item">FEA - Thermal</div>
                    <div className="dropdown-item">FEA - Fatigue</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item">CFD Analysis</div>
                    <div className="dropdown-item">Motion Simulation</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item">Mass Properties</div>
                    <div className="dropdown-item">Interference Check</div>
                    <div className="dropdown-item">Draft Analysis</div>
                    <div className="dropdown-item">Curvature Analysis</div>
                </div>
            )}

            {activeDropdown === 'surfaces' && (
                <div className="tool-dropdown" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                    <div className="dropdown-header">Surface Tools</div>
                    <div className="dropdown-item">Planar Surface</div>
                    <div className="dropdown-item">Boundary Surface</div>
                    <div className="dropdown-item">Ruled Surface</div>
                    <div className="dropdown-item">Lofted Surface</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item">Offset Surface</div>
                    <div className="dropdown-item">Extend Surface</div>
                    <div className="dropdown-item">Trim Surface</div>
                    <div className="dropdown-item">Knit</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item">Thicken</div>
                    <div className="dropdown-item">Replace Face</div>
                    <div className="dropdown-item">Delete Face</div>
                    <div className="dropdown-item">Surface Flatten</div>
                </div>
            )}

            {activeDropdown === 'documentation' && (
                <div className="tool-dropdown" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                    <div className="dropdown-header">Documentation</div>
                    <div className="dropdown-item">Generate Drawing</div>
                    <div className="dropdown-item">Detail View</div>
                    <div className="dropdown-item">Section View</div>
                    <div className="dropdown-item">Auxiliary View</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item">Dimension</div>
                    <div className="dropdown-item">Note</div>
                    <div className="dropdown-item">Callout</div>
                    <div className="dropdown-item">Surface Finish</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item">BOM Table</div>
                    <div className="dropdown-item">Revision Table</div>
                    <div className="dropdown-item">Title Block</div>
                    <div className="dropdown-item">Export PDF</div>
                </div>
            )}

            {activeDropdown === 'inspection' && (
                <div className="tool-dropdown" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                    <div className="dropdown-header">Inspection & Quality</div>
                    <div className="dropdown-item">Measure Distance</div>
                    <div className="dropdown-item">Measure Angle</div>
                    <div className="dropdown-item">Measure Area</div>
                    <div className="dropdown-item">Measure Volume</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item">Check Geometry</div>
                    <div className="dropdown-item">Draft Analysis</div>
                    <div className="dropdown-item">Undercut Detection</div>
                    <div className="dropdown-item">Thickness Analysis</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item">Clearance Check</div>
                    <div className="dropdown-item">Deviation Analysis</div>
                    <div className="dropdown-item">CMM Inspection</div>
                </div>
            )}
        </>
    );
}

export default WorkbenchMechanical;
