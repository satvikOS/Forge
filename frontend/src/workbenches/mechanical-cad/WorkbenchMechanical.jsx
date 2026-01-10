import React, { useState } from 'react';
import Viewport3D from '../../components/Viewport3D';
import { useViewport } from '../../contexts/ViewportContext';
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
    const viewport = useViewport();
    const [aiPrompt, setAiPrompt] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [activeDropdown, setActiveDropdown] = useState(null);
    const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 });
    const [contextMenu, setContextMenu] = useState(null);
    const buttonRefs = React.useRef({});

    // Wireframe mode toggle handler
    const handleWireframeToggle = () => {
        if (!viewport || !viewport.toggleWireframeMode) return;

        const currentMode = viewport.wireframeMode || 'off';
        let nextMode;

        // Cycle through: off → solid → transparent → off
        switch(currentMode) {
            case 'off':
                nextMode = 'solid';
                break;
            case 'solid':
                nextMode = 'transparent';
                break;
            case 'transparent':
            default:
                nextMode = 'off';
                break;
        }

        viewport.toggleWireframeMode(nextMode);
    };

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

    // ==================== PHASE 4 SERVICE HANDLERS ====================

    // Cloud Sync Handlers
    const handleCloudSync = async (operation, data = {}) => {
        try {
            console.log(`☁️ Cloud Sync: ${operation}...`);
            const response = await fetch(`/api/mechanical/cloud/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`✅ Cloud ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`✗ Error in Cloud ${operation}:`, error);
        }
    };

    // Standard Parts Library Handlers
    const handleStandardParts = async (operation, data = {}) => {
        try {
            console.log(`🔩 Standard Parts: ${operation}...`);
            const response = await fetch(`/api/mechanical/parts/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`✅ Standard Parts ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`✗ Error in Standard Parts ${operation}:`, error);
        }
    };

    // Kinematics Handlers
    const handleKinematics = async (operation, data = {}) => {
        try {
            console.log(`⚙️ Kinematics: ${operation}...`);
            const response = await fetch(`/api/mechanical/kinematics/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`✅ Kinematics ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`✗ Error in Kinematics ${operation}:`, error);
        }
    };

    // Routing Handlers (Wires/Cables/Pipes)
    const handleRouting = async (operation, data = {}) => {
        try {
            console.log(`🔌 Routing: ${operation}...`);
            const response = await fetch(`/api/mechanical/routing/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`✅ Routing ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`✗ Error in Routing ${operation}:`, error);
        }
    };

    // Advanced Inspection Handlers
    const handleAdvancedInspection = async (operation, data = {}) => {
        try {
            console.log(`🔍 Inspection: ${operation}...`);
            const response = await fetch(`/api/mechanical/inspection/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`✅ Inspection ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`✗ Error in Inspection ${operation}:`, error);
        }
    };

    // PDM/PLM Integration Handlers
    const handlePDMPLM = async (operation, data = {}) => {
        try {
            console.log(`📦 PDM/PLM: ${operation}...`);
            const response = await fetch(`/api/mechanical/pdm/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`✅ PDM/PLM ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`✗ Error in PDM/PLM ${operation}:`, error);
        }
    };

    // Design Automation Handlers
    const handleAutomation = async (operation, data = {}) => {
        try {
            console.log(`🤖 Automation: ${operation}...`);
            const response = await fetch(`/api/mechanical/automation/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`✅ Automation ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`✗ Error in Automation ${operation}:`, error);
        }
    };

    // Rendering & Visualization Handlers
    const handleRendering = async (operation, data = {}) => {
        try {
            console.log(`🎨 Rendering: ${operation}...`);
            const response = await fetch(`/api/mechanical/rendering/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`✅ Rendering ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`✗ Error in Rendering ${operation}:`, error);
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

                {/* Wireframe Toggle Button - Top Right Corner */}
                <button
                    onClick={handleWireframeToggle}
                    style={{
                        position: 'absolute',
                        top: '16px',
                        right: '16px',
                        backgroundColor: viewport?.wireframeMode !== 'off' ? 'rgba(74, 144, 226, 0.3)' : 'rgba(26, 26, 26, 0.9)',
                        border: `1px solid ${viewport?.wireframeMode !== 'off' ? 'rgba(74, 144, 226, 0.5)' : 'rgba(255, 255, 255, 0.1)'}`,
                        borderRadius: '6px',
                        padding: '8px 12px',
                        color: '#e0e0e0',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        fontSize: '13px',
                        backdropFilter: 'blur(10px)',
                        zIndex: 100,
                        transition: 'all 0.2s'
                    }}
                    title="Toggle Wireframe (W) - Cycles: Off → Solid → Transparent"
                >
                    <span>{viewport?.wireframeMode === 'off' ? '◼' : viewport?.wireframeMode === 'solid' ? '▦' : '▢'}</span>
                    <span style={{ fontSize: '11px' }}>
                        {viewport?.wireframeMode === 'off' ? 'Wireframe' : viewport?.wireframeMode === 'solid' ? 'WF Solid' : 'WF Trans'}
                    </span>
                </button>
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
                    <button className="property-button" onClick={() => handleAnalysis('fea-static', {})}>Run FEA Analysis</button>
                    <button className="property-button" onClick={() => handleKinematics('simulate', {})}>Motion Simulation</button>
                    <button className="property-button" onClick={() => handleCAMOperation('generate-toolpath', {})}>Generate Toolpaths</button>
                </div>

                {/* Export */}
                <div className="property-section">
                    <h3 className="property-header">EXPORT</h3>
                    <button className="property-button" onClick={() => console.log('Export STEP')}>Export STEP</button>
                    <button className="property-button" onClick={() => console.log('Export STL')}>Export STL</button>
                    <button className="property-button" onClick={() => console.log('Generate Drawing')}>Generate Drawing</button>
                </div>

                {/* Configuration */}
                <div className="property-section">
                    <h3 className="property-header">CONFIGURATION</h3>
                    <select className="property-input">
                        <option>Default</option>
                        <option>Config A</option>
                        <option>Config B</option>
                    </select>
                    <button className="property-button" onClick={() => console.log('New Config')}>New Config</button>
                    <button className="property-button" onClick={() => console.log('Design Table')}>Design Table</button>
                </div>

                {/* Collaboration */}
                <div className="property-section">
                    <h3 className="property-header">COLLABORATE</h3>
                    <button className="property-button" onClick={() => handleCloudSync('upload', {})}>Share Design</button>
                    <button className="property-button" onClick={() => console.log('Add Comment')}>Add Comment</button>
                    <button className="property-button" onClick={() => console.log('Review')}>Review</button>
                </div>

                {/* Version Control */}
                <div className="property-section">
                    <h3 className="property-header">VERSION</h3>
                    <button className="property-button" onClick={() => handleRevision('create', {})}>Save Revision</button>
                    <button className="property-button" onClick={() => handleRevision('history', {})}>Version History</button>
                    <button className="property-button" onClick={() => handlePDMPLM('checkout', {})}>Branch/Merge</button>
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
                    <button className="property-button" onClick={() => handleGDT('add-annotation', {})}>GD&T</button>
                    <button className="property-button" onClick={() => console.log('Compliance Check')}>Compliance Check</button>
                </div>

                {/* Cost */}
                <div className="property-section">
                    <h3 className="property-header">COST</h3>
                    <button className="property-button" onClick={() => handleCost('estimate', {})}>Estimate Cost</button>
                    <button className="property-button" onClick={() => handleAIOptimization('cost-prediction', {})}>Compare Options</button>
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
                    <div className="dropdown-item" onClick={() => { console.log('Sketch: Line'); setActiveDropdown(null); }}>Line</div>
                    <div className="dropdown-item" onClick={() => { console.log('Sketch: Circle'); setActiveDropdown(null); }}>Circle</div>
                    <div className="dropdown-item" onClick={() => { console.log('Sketch: Arc'); setActiveDropdown(null); }}>Arc</div>
                    <div className="dropdown-item" onClick={() => { console.log('Sketch: Rectangle'); setActiveDropdown(null); }}>Rectangle</div>
                    <div className="dropdown-item" onClick={() => { console.log('Sketch: Polygon'); setActiveDropdown(null); }}>Polygon</div>
                    <div className="dropdown-item" onClick={() => { console.log('Sketch: Spline'); setActiveDropdown(null); }}>Spline</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item" onClick={() => { console.log('Sketch: Trim'); setActiveDropdown(null); }}>Trim</div>
                    <div className="dropdown-item" onClick={() => { console.log('Sketch: Extend'); setActiveDropdown(null); }}>Extend</div>
                    <div className="dropdown-item" onClick={() => { console.log('Sketch: Offset'); setActiveDropdown(null); }}>Offset</div>
                    <div className="dropdown-item" onClick={() => { console.log('Sketch: Mirror'); setActiveDropdown(null); }}>Mirror</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item" onClick={() => { console.log('Sketch: Dimension'); setActiveDropdown(null); }}>Dimension</div>
                    <div className="dropdown-item" onClick={() => { console.log('Sketch: Constraint'); setActiveDropdown(null); }}>Constraint</div>
                </div>
            )}

            {activeDropdown === 'features' && (
                <div className="tool-dropdown" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                    <div className="dropdown-header">3D Features</div>
                    <div className="dropdown-item" onClick={() => { console.log('Feature: Extrude'); setActiveDropdown(null); }}>Extrude</div>
                    <div className="dropdown-item" onClick={() => { console.log('Feature: Revolve'); setActiveDropdown(null); }}>Revolve</div>
                    <div className="dropdown-item" onClick={() => { console.log('Feature: Sweep'); setActiveDropdown(null); }}>Sweep</div>
                    <div className="dropdown-item" onClick={() => { console.log('Feature: Loft'); setActiveDropdown(null); }}>Loft</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item" onClick={() => { console.log('Feature: Fillet'); setActiveDropdown(null); }}>Fillet</div>
                    <div className="dropdown-item" onClick={() => { console.log('Feature: Chamfer'); setActiveDropdown(null); }}>Chamfer</div>
                    <div className="dropdown-item" onClick={() => { console.log('Feature: Draft'); setActiveDropdown(null); }}>Draft</div>
                    <div className="dropdown-item" onClick={() => { console.log('Feature: Shell'); setActiveDropdown(null); }}>Shell</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item" onClick={() => { console.log('Feature: Hole Wizard'); setActiveDropdown(null); }}>Hole Wizard</div>
                    <div className="dropdown-item" onClick={() => { console.log('Feature: Thread'); setActiveDropdown(null); }}>Thread</div>
                    <div className="dropdown-item" onClick={() => { console.log('Feature: Rib'); setActiveDropdown(null); }}>Rib</div>
                    <div className="dropdown-item" onClick={() => { console.log('Feature: Web'); setActiveDropdown(null); }}>Web</div>
                </div>
            )}

            {activeDropdown === 'patterns' && (
                <div className="tool-dropdown" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                    <div className="dropdown-header">Patterns & Mirrors</div>
                    <div className="dropdown-item" onClick={() => { console.log('Pattern: Linear'); setActiveDropdown(null); }}>Linear Pattern</div>
                    <div className="dropdown-item" onClick={() => { console.log('Pattern: Circular'); setActiveDropdown(null); }}>Circular Pattern</div>
                    <div className="dropdown-item" onClick={() => { console.log('Pattern: Curve Driven'); setActiveDropdown(null); }}>Curve Driven Pattern</div>
                    <div className="dropdown-item" onClick={() => { console.log('Pattern: Fill'); setActiveDropdown(null); }}>Fill Pattern</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item" onClick={() => { console.log('Pattern: Mirror'); setActiveDropdown(null); }}>Mirror</div>
                    <div className="dropdown-item" onClick={() => { console.log('Pattern: Copy'); setActiveDropdown(null); }}>Copy</div>
                    <div className="dropdown-item" onClick={() => { console.log('Pattern: Move/Copy Bodies'); setActiveDropdown(null); }}>Move/Copy Bodies</div>
                </div>
            )}

            {activeDropdown === 'assembly' && (
                <div className="tool-dropdown" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                    <div className="dropdown-header">Assembly Tools</div>
                    <div className="dropdown-item" onClick={() => { handleStandardParts('search', { query: 'fastener' }); setActiveDropdown(null); }}>Insert Component</div>
                    <div className="dropdown-item" onClick={() => { console.log('Assembly: Mate'); setActiveDropdown(null); }}>Mate</div>
                    <div className="dropdown-item" onClick={() => { console.log('Assembly: Quick Mate'); setActiveDropdown(null); }}>Quick Mate</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item" onClick={() => { console.log('Assembly: Interference Detection'); setActiveDropdown(null); }}>Interference Detection</div>
                    <div className="dropdown-item" onClick={() => { console.log('Assembly: Collision Detection'); setActiveDropdown(null); }}>Collision Detection</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item" onClick={() => { handleRendering('exploded', {}); setActiveDropdown(null); }}>Exploded View</div>
                    <div className="dropdown-item" onClick={() => { handleKinematics('simulate', { mechanismId: 'mech_1', duration: 5.0 }); setActiveDropdown(null); }}>Motion Study</div>
                    <div className="dropdown-item" onClick={() => { handleBOM('generate', {}); setActiveDropdown(null); }}>BOM</div>
                </div>
            )}

            {activeDropdown === 'manufacturing' && (
                <div className="tool-dropdown" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                    <div className="dropdown-header">Manufacturing</div>
                    <div className="dropdown-item" onClick={() => { handleCAMOperation('setup', { workpiece: { material: 'aluminum' } }); setActiveDropdown(null); }}>CAM Setup</div>
                    <div className="dropdown-item" onClick={() => { handleCAMOperation('2d-pocket', {}); setActiveDropdown(null); }}>2D Milling</div>
                    <div className="dropdown-item" onClick={() => { handleCAMOperation('3d-adaptive', {}); setActiveDropdown(null); }}>3D Milling</div>
                    <div className="dropdown-item" onClick={() => { handleCAMOperation('turning', {}); setActiveDropdown(null); }}>Turning</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item" onClick={() => { console.log('Manufacturing: Sheet Metal'); setActiveDropdown(null); }}>Sheet Metal</div>
                    <div className="dropdown-item" onClick={() => { console.log('Manufacturing: Weldments'); setActiveDropdown(null); }}>Weldments</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item" onClick={() => { handleAdditive('slice', {}); setActiveDropdown(null); }}>3D Printing</div>
                    <div className="dropdown-item" onClick={() => { handleMoldDesign('core-cavity', {}); setActiveDropdown(null); }}>Mold Design</div>
                    <div className="dropdown-item" onClick={() => { handleAIOptimization('dfm-analysis', {}); setActiveDropdown(null); }}>DFM Analysis</div>
                    <div className="dropdown-item" onClick={() => { handleCost('estimate', {}); setActiveDropdown(null); }}>Cost Estimate</div>
                </div>
            )}

            {activeDropdown === 'analysis' && (
                <div className="tool-dropdown" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                    <div className="dropdown-header">Analysis & Simulation</div>
                    <div className="dropdown-item" onClick={() => { handleAnalysis('fea-static', {}); setActiveDropdown(null); }}>FEA - Static</div>
                    <div className="dropdown-item" onClick={() => { handleAnalysis('fea-modal', {}); setActiveDropdown(null); }}>FEA - Dynamic</div>
                    <div className="dropdown-item" onClick={() => { handleAnalysis('fea-thermal', {}); setActiveDropdown(null); }}>FEA - Thermal</div>
                    <div className="dropdown-item" onClick={() => { handleAnalysis('fea-fatigue', {}); setActiveDropdown(null); }}>FEA - Fatigue</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item" onClick={() => { handleAnalysis('cfd-external', {}); setActiveDropdown(null); }}>CFD Analysis</div>
                    <div className="dropdown-item" onClick={() => { handleKinematics('simulate', {}); setActiveDropdown(null); }}>Motion Simulation</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item" onClick={() => { console.log('Analysis: Mass Properties'); setActiveDropdown(null); }}>Mass Properties</div>
                    <div className="dropdown-item" onClick={() => { console.log('Analysis: Interference Check'); setActiveDropdown(null); }}>Interference Check</div>
                    <div className="dropdown-item" onClick={() => { console.log('Analysis: Draft Analysis'); setActiveDropdown(null); }}>Draft Analysis</div>
                    <div className="dropdown-item" onClick={() => { console.log('Analysis: Curvature Analysis'); setActiveDropdown(null); }}>Curvature Analysis</div>
                </div>
            )}

            {activeDropdown === 'surfaces' && (
                <div className="tool-dropdown" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                    <div className="dropdown-header">Surface Tools</div>
                    <div className="dropdown-item" onClick={() => { console.log('Surface: Planar'); setActiveDropdown(null); }}>Planar Surface</div>
                    <div className="dropdown-item" onClick={() => { console.log('Surface: Boundary'); setActiveDropdown(null); }}>Boundary Surface</div>
                    <div className="dropdown-item" onClick={() => { console.log('Surface: Ruled'); setActiveDropdown(null); }}>Ruled Surface</div>
                    <div className="dropdown-item" onClick={() => { console.log('Surface: Lofted'); setActiveDropdown(null); }}>Lofted Surface</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item" onClick={() => { console.log('Surface: Offset'); setActiveDropdown(null); }}>Offset Surface</div>
                    <div className="dropdown-item" onClick={() => { console.log('Surface: Extend'); setActiveDropdown(null); }}>Extend Surface</div>
                    <div className="dropdown-item" onClick={() => { console.log('Surface: Trim'); setActiveDropdown(null); }}>Trim Surface</div>
                    <div className="dropdown-item" onClick={() => { console.log('Surface: Knit'); setActiveDropdown(null); }}>Knit</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item" onClick={() => { console.log('Surface: Thicken'); setActiveDropdown(null); }}>Thicken</div>
                    <div className="dropdown-item" onClick={() => { console.log('Surface: Replace Face'); setActiveDropdown(null); }}>Replace Face</div>
                    <div className="dropdown-item" onClick={() => { console.log('Surface: Delete Face'); setActiveDropdown(null); }}>Delete Face</div>
                    <div className="dropdown-item" onClick={() => { console.log('Surface: Flatten'); setActiveDropdown(null); }}>Surface Flatten</div>
                </div>
            )}

            {activeDropdown === 'documentation' && (
                <div className="tool-dropdown" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                    <div className="dropdown-header">Documentation</div>
                    <div className="dropdown-item" onClick={() => { console.log('Documentation: Generate Drawing'); setActiveDropdown(null); }}>Generate Drawing</div>
                    <div className="dropdown-item" onClick={() => { console.log('Documentation: Detail View'); setActiveDropdown(null); }}>Detail View</div>
                    <div className="dropdown-item" onClick={() => { console.log('Documentation: Section View'); setActiveDropdown(null); }}>Section View</div>
                    <div className="dropdown-item" onClick={() => { console.log('Documentation: Auxiliary View'); setActiveDropdown(null); }}>Auxiliary View</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item" onClick={() => { console.log('Documentation: Dimension'); setActiveDropdown(null); }}>Dimension</div>
                    <div className="dropdown-item" onClick={() => { handleGDT('add-annotation', {}); setActiveDropdown(null); }}>Note</div>
                    <div className="dropdown-item" onClick={() => { console.log('Documentation: Callout'); setActiveDropdown(null); }}>Callout</div>
                    <div className="dropdown-item" onClick={() => { console.log('Documentation: Surface Finish'); setActiveDropdown(null); }}>Surface Finish</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item" onClick={() => { handleBOM('generate', {}); setActiveDropdown(null); }}>BOM Table</div>
                    <div className="dropdown-item" onClick={() => { handleRevision('create', {}); setActiveDropdown(null); }}>Revision Table</div>
                    <div className="dropdown-item" onClick={() => { console.log('Documentation: Title Block'); setActiveDropdown(null); }}>Title Block</div>
                    <div className="dropdown-item" onClick={() => { handleManual('export', { format: 'pdf' }); setActiveDropdown(null); }}>Export PDF</div>
                </div>
            )}

            {activeDropdown === 'inspection' && (
                <div className="tool-dropdown" style={{ top: dropdownPosition.top, left: dropdownPosition.left }}>
                    <div className="dropdown-header">Inspection & Quality</div>
                    <div className="dropdown-item" onClick={() => { console.log('Inspection: Measure Distance'); setActiveDropdown(null); }}>Measure Distance</div>
                    <div className="dropdown-item" onClick={() => { console.log('Inspection: Measure Angle'); setActiveDropdown(null); }}>Measure Angle</div>
                    <div className="dropdown-item" onClick={() => { console.log('Inspection: Measure Area'); setActiveDropdown(null); }}>Measure Area</div>
                    <div className="dropdown-item" onClick={() => { console.log('Inspection: Measure Volume'); setActiveDropdown(null); }}>Measure Volume</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item" onClick={() => { console.log('Inspection: Check Geometry'); setActiveDropdown(null); }}>Check Geometry</div>
                    <div className="dropdown-item" onClick={() => { console.log('Inspection: Draft Analysis'); setActiveDropdown(null); }}>Draft Analysis</div>
                    <div className="dropdown-item" onClick={() => { console.log('Inspection: Undercut Detection'); setActiveDropdown(null); }}>Undercut Detection</div>
                    <div className="dropdown-item" onClick={() => { console.log('Inspection: Thickness Analysis'); setActiveDropdown(null); }}>Thickness Analysis</div>
                    <div className="dropdown-divider"></div>
                    <div className="dropdown-item" onClick={() => { handleRouting('clearance', {}); setActiveDropdown(null); }}>Clearance Check</div>
                    <div className="dropdown-item" onClick={() => { handleAdvancedInspection('gdt', {}); setActiveDropdown(null); }}>Deviation Analysis</div>
                    <div className="dropdown-item" onClick={() => { handleAdvancedInspection('cmm', {}); setActiveDropdown(null); }}>CMM Inspection</div>
                </div>
            )}
        </>
    );
}

export default WorkbenchMechanical;
