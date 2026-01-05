import React, { useState, useRef, useEffect, useCallback } from 'react';
import Viewport3D from '../../components/Viewport3D';
import {
    Mouse, Move, Pencil, Box, Sheet, Copy, Link2, Zap, Settings,
    BarChart3, Waves, Wrench, Factory, Printer, CircleDot, Package,
    FileText, File, BookOpen, RotateCcw, Play, DollarSign, Axis3D,
    Cog, Grid3x3
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
    const [contextMenu, setContextMenu] = useState(null);
    const [dropdownStyle, setDropdownStyle] = useState({});
    const dropdownRef = useRef(null);
    const buttonRefs = useRef({});

    // Smart dropdown positioning - calculates optimal position based on viewport
    const calculateDropdownPosition = useCallback((buttonElement) => {
        if (!buttonElement) return {};

        const buttonRect = buttonElement.getBoundingClientRect();
        const viewportHeight = window.innerHeight;
        const viewportWidth = window.innerWidth;

        // Estimated dropdown dimensions
        const dropdownHeight = 350; // Max estimated height
        const dropdownWidth = 220;  // Width from CSS

        let style = {
            position: 'fixed',
            zIndex: 9999
        };

        // Horizontal positioning: prefer right of button, fallback to left
        if (buttonRect.right + dropdownWidth + 10 < viewportWidth) {
            style.left = buttonRect.right + 4;
        } else {
            style.left = buttonRect.left - dropdownWidth - 4;
        }

        // Vertical positioning: align with button, adjust if would overflow
        const spaceBelow = viewportHeight - buttonRect.top;
        const spaceAbove = buttonRect.bottom;

        if (spaceBelow >= dropdownHeight) {
            // Enough space below - align top with button
            style.top = buttonRect.top;
        } else if (spaceAbove >= dropdownHeight) {
            // More space above - align bottom with button bottom
            style.top = buttonRect.bottom - dropdownHeight;
        } else {
            // Limited space both ways - center and constrain
            const availableHeight = Math.min(dropdownHeight, viewportHeight - 20);
            style.top = Math.max(10, (viewportHeight - availableHeight) / 2);
            style.maxHeight = availableHeight;
            style.overflowY = 'auto';
        }

        return style;
    }, []);

    // Update dropdown position when active dropdown changes
    useEffect(() => {
        if (activeDropdown && buttonRefs.current[activeDropdown]) {
            const style = calculateDropdownPosition(buttonRefs.current[activeDropdown]);
            setDropdownStyle(style);
        }
    }, [activeDropdown, calculateDropdownPosition]);

    // Recalculate on window resize
    useEffect(() => {
        const handleResize = () => {
            if (activeDropdown && buttonRefs.current[activeDropdown]) {
                const style = calculateDropdownPosition(buttonRefs.current[activeDropdown]);
                setDropdownStyle(style);
            }
        };

        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, [activeDropdown, calculateDropdownPosition]);

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

    // Analysis Handlers (Enhanced)
    const handleAnalysis = async (operation, data = {}) => {
        try {
            const response = await fetch(`/api/mechanical/analysis/${operation}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            const result = await response.json();
            if (result.success) {
                console.log(`Analysis ${operation} completed:`, result);
            }
        } catch (error) {
            console.error(`Error in Analysis ${operation}:`, error);
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
            {/* LEFT TOOLBAR - Icon Tools */}
            <aside className="workbench-tools" onClick={() => setActiveDropdown(null)}>
                <div className="workbench-tools-inner">
                    <button className="tool-icon-button" title="Select"><Mouse size={20} /></button>
                    <button className="tool-icon-button" title="Move"><Move size={20} /></button>

                    {/* Sketch Dropdown */}
                    <div className="tool-dropdown-container">
                        <button
                            ref={el => buttonRefs.current['sketch'] = el}
                            className="tool-icon-button active"
                            title="Sketch"
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <Pencil size={20} />
                        </button>
                        {activeDropdown === 'sketch' && (
                            <div
                                className="tool-dropdown smart-positioned"
                                style={dropdownStyle}
                                ref={dropdownRef}
                            >
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
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <Box size={20} />
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
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <Sheet size={20} />
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
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <Copy size={20} />
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
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <Link2 size={20} />
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
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <Zap size={20} />
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
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <Zap size={20} />
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
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <FileText size={20} />
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
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <Settings size={20} />
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

                    {/* Surfacing Dropdown */}
                    <div className="tool-dropdown-container">
                        <button
                            className="tool-icon-button"
                            title="Surfacing"
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <Waves size={20} />
                        </button>
                        {activeDropdown === 'surfacing' && (
                            <div className="tool-dropdown">
                                <div className="dropdown-header">Create</div>
                                <div className="dropdown-item">Loft Surface</div>
                                <div className="dropdown-item">Sweep Surface</div>
                                <div className="dropdown-item">Boundary Surface</div>
                                <div className="dropdown-item">Ruled Surface</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-header">Modify</div>
                                <div className="dropdown-item">Trim Surface</div>
                                <div className="dropdown-item">Blend Surface</div>
                                <div className="dropdown-item">Extend Surface</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-header">Analysis</div>
                                <div className="dropdown-item">Curvature Analysis</div>
                                <div className="dropdown-item">Zebra Stripes</div>
                                <div className="dropdown-item">Draft Analysis</div>
                            </div>
                        )}
                    </div>

                    {/* CAM/Manufacturing Dropdown */}
                    <div className="tool-dropdown-container">
                        <button
                            className="tool-icon-button"
                            title="CAM/Manufacturing"
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <Wrench size={20} />
                        </button>
                        {activeDropdown === 'cam' && (
                            <div className="tool-dropdown">
                                <div className="dropdown-header">CNC Milling</div>
                                <div className="dropdown-item" onClick={() => handleCAMOperation('generate-toolpath', { type: '2.5-axis' })}>2.5-Axis Toolpath</div>
                                <div className="dropdown-item" onClick={() => handleCAMOperation('generate-toolpath', { type: '3-axis' })}>3-Axis Toolpath</div>
                                <div className="dropdown-item" onClick={() => handleCAMOperation('generate-toolpath', { type: '5-axis' })}>5-Axis Toolpath</div>
                                <div className="dropdown-item" onClick={() => handleCAMOperation('adaptive-clearing')}>Adaptive Clearing</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-header">Turning</div>
                                <div className="dropdown-item" onClick={() => handleCAMOperation('turning', { operation: 'roughing' })}>OD Roughing</div>
                                <div className="dropdown-item" onClick={() => handleCAMOperation('turning', { operation: 'facing' })}>Facing</div>
                                <div className="dropdown-item" onClick={() => handleCAMOperation('turning', { operation: 'threading' })}>Threading</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-header">Post Processing</div>
                                <div className="dropdown-item" onClick={() => handleCAMOperation('post-process')}>Generate G-Code</div>
                                <div className="dropdown-item" onClick={() => handleCAMOperation('simulate')}>Simulate Toolpath</div>
                            </div>
                        )}
                    </div>

                    {/* Mold Design Dropdown */}
                    <div className="tool-dropdown-container">
                        <button
                            className="tool-icon-button"
                            title="Mold Design"
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <Factory size={20} />
                        </button>
                        {activeDropdown === 'mold' && (
                            <div className="tool-dropdown">
                                <div className="dropdown-item" onClick={() => handleMoldDesign('draft-analysis')}>Draft Analysis</div>
                                <div className="dropdown-item" onClick={() => handleMoldDesign('parting-line')}>Parting Line</div>
                                <div className="dropdown-item" onClick={() => handleMoldDesign('core-cavity')}>Core & Cavity</div>
                                <div className="dropdown-item" onClick={() => handleMoldDesign('undercut')}>Undercut Detection</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-item" onClick={() => handleMoldDesign('mold-base')}>Mold Base</div>
                                <div className="dropdown-item" onClick={() => handleMoldDesign('ejector-pins')}>Ejector Pins</div>
                                <div className="dropdown-item" onClick={() => handleMoldDesign('cooling-channels')}>Cooling Channels</div>
                            </div>
                        )}
                    </div>

                    {/* Additive Manufacturing Dropdown */}
                    <div className="tool-dropdown-container">
                        <button
                            className="tool-icon-button"
                            title="3D Printing"
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <Printer size={20} />
                        </button>
                        {activeDropdown === 'additive' && (
                            <div className="tool-dropdown">
                                <div className="dropdown-header">Preparation</div>
                                <div className="dropdown-item" onClick={() => handleAdditive('optimize-orientation')}>Optimize Orientation</div>
                                <div className="dropdown-item" onClick={() => handleAdditive('generate-supports')}>Generate Supports</div>
                                <div className="dropdown-item" onClick={() => handleAdditive('nest-parts')}>Nest Parts</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-header">Slicing</div>
                                <div className="dropdown-item" onClick={() => handleAdditive('preview-layers')}>Preview Layers</div>
                                <div className="dropdown-item" onClick={() => handleAdditive('estimate')}>Estimate Time/Cost</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-item" onClick={() => handleAdditive('export-stl')}>Export STL</div>
                                <div className="dropdown-item" onClick={() => handleAdditive('export-gcode')}>Export G-Code</div>
                            </div>
                        )}
                    </div>

                    {/* GD&T/Tolerancing Dropdown */}
                    <div className="tool-dropdown-container">
                        <button
                            className="tool-icon-button"
                            title="GD&T"
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <CircleDot size={20} />
                        </button>
                        {activeDropdown === 'gdt' && (
                            <div className="tool-dropdown">
                                <div className="dropdown-header">Annotations</div>
                                <div className="dropdown-item" onClick={() => handleGDT('add-annotation', { type: 'true-position' })}>True Position</div>
                                <div className="dropdown-item" onClick={() => handleGDT('add-annotation', { type: 'perpendicularity' })}>Perpendicularity</div>
                                <div className="dropdown-item" onClick={() => handleGDT('add-annotation', { type: 'parallelism' })}>Parallelism</div>
                                <div className="dropdown-item" onClick={() => handleGDT('add-annotation', { type: 'flatness' })}>Flatness</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-header">Analysis</div>
                                <div className="dropdown-item" onClick={() => handleGDT('verify-compliance')}>Verify Compliance</div>
                                <div className="dropdown-item" onClick={() => handleGDT('adjust-cam')}>Tolerance Stack-Up</div>
                                <div className="dropdown-item" onClick={() => handleGDT('process-plan')}>Process Planning</div>
                            </div>
                        )}
                    </div>

                    {/* Standard Components Dropdown */}
                    <div className="tool-dropdown-container">
                        <button
                            className="tool-icon-button"
                            title="Components Library"
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <Package size={20} />
                        </button>
                        {activeDropdown === 'components' && (
                            <div className="tool-dropdown">
                                <div className="dropdown-header">Fasteners</div>
                                <div className="dropdown-item" onClick={() => handleComponents('search', { standard: 'ISO', type: 'bolts' })}>ISO Bolts & Screws</div>
                                <div className="dropdown-item" onClick={() => handleComponents('search', { standard: 'ANSI', type: 'fasteners' })}>ANSI Fasteners</div>
                                <div className="dropdown-item" onClick={() => handleComponents('search', { standard: 'DIN' })}>DIN Standards</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-header">Other</div>
                                <div className="dropdown-item" onClick={() => handleComponents('search', { type: 'bearings' })}>Bearings</div>
                                <div className="dropdown-item" onClick={() => handleComponents('search', { type: 'springs' })}>Springs</div>
                                <div className="dropdown-item" onClick={() => handleComponents('search', { type: 'connectors' })}>Connectors</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-item" onClick={() => handleComponents('search', {})}>🔍 Search Library</div>
                                <div className="dropdown-item" onClick={() => handleComponents('suggest-replacement', {})}>AI Suggest Replacement</div>
                            </div>
                        )}
                    </div>

                    {/* BOM Dropdown */}
                    <div className="tool-dropdown-container">
                        <button
                            className="tool-icon-button"
                            title="BOM"
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <FileText size={20} />
                        </button>
                        {activeDropdown === 'bom' && (
                            <div className="tool-dropdown">
                                <div className="dropdown-item" onClick={() => handleBOM('hierarchical', {})}>Generate Hierarchical BOM</div>
                                <div className="dropdown-item" onClick={() => handleBOM('flat', {})}>Generate Flat BOM</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-item" onClick={() => handleBOM('add-to-drawing', {})}>Add to Drawing</div>
                                <div className="dropdown-item" onClick={() => handleBOM('export', { format: 'excel' })}>Export to Excel</div>
                                <div className="dropdown-item" onClick={() => handleBOM('export', { format: 'csv' })}>Export to CSV</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-item" onClick={() => handleBOM('configuration', {})}>Configuration-Specific BOM</div>
                            </div>
                        )}
                    </div>

                    {/* MBD/Drawings Dropdown */}
                    <div className="tool-dropdown-container">
                        <button
                            className="tool-icon-button"
                            title="Drawings & MBD"
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <File size={20} />
                        </button>
                        {activeDropdown === 'drawings' && (
                            <div className="tool-dropdown">
                                <div className="dropdown-header">2D Drawings</div>
                                <div className="dropdown-item" onClick={() => console.log('Generate drawing')}>New Drawing</div>
                                <div className="dropdown-item" onClick={() => console.log('Add view')}>Add View</div>
                                <div className="dropdown-item" onClick={() => console.log('Section view')}>Section View</div>
                                <div className="dropdown-item" onClick={() => console.log('Detail view')}>Detail View</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-header">MBD</div>
                                <div className="dropdown-item" onClick={() => handleMBD('embed-pmi', {})}>Embed PMI</div>
                                <div className="dropdown-item" onClick={() => handleMBD('generate-3d-spec', {})}>Generate 3D Spec</div>
                                <div className="dropdown-item" onClick={() => handleMBD('qr-code', {})}>QR Code for Shop Floor</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-item" onClick={() => console.log('Export PDF')}>Export PDF</div>
                            </div>
                        )}
                    </div>

                    {/* Technical Manuals Dropdown */}
                    <div className="tool-dropdown-container">
                        <button
                            className="tool-icon-button"
                            title="Documentation"
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <BookOpen size={20} />
                        </button>
                        {activeDropdown === 'manuals' && (
                            <div className="tool-dropdown">
                                <div className="dropdown-item" onClick={() => handleManual('exploded-view', {})}>Exploded View</div>
                                <div className="dropdown-item" onClick={() => handleManual('assembly-instructions', {})}>Assembly Instructions</div>
                                <div className="dropdown-item" onClick={() => handleManual('service-manual', {})}>Service Manual</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-item" onClick={() => handleManual('pdf-booklet', {})}>Generate PDF Booklet</div>
                                <div className="dropdown-item" onClick={() => console.log('Export instructions')}>Export Instructions</div>
                            </div>
                        )}
                    </div>

                    {/* Revision Control Dropdown */}
                    <div className="tool-dropdown-container">
                        <button
                            className="tool-icon-button"
                            title="Revisions"
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <RotateCcw size={20} />
                        </button>
                        {activeDropdown === 'revisions' && (
                            <div className="tool-dropdown">
                                <div className="dropdown-item" onClick={() => handleRevision('create', {})}>Create Revision</div>
                                <div className="dropdown-item" onClick={() => handleRevision('request-approval', {})}>Request Approval</div>
                                <div className="dropdown-item" onClick={() => handleRevision('approve', { decision: 'approved' })}>Approve/Reject</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-item" onClick={() => handleRevision('release', {})}>Release Model</div>
                                <div className="dropdown-item" onClick={() => console.log('View audit trail')}>View Audit Trail</div>
                                <div className="dropdown-item" onClick={() => console.log('Rollback')}>Rollback to Previous</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-item" onClick={() => console.log('Change state')}>Change Lifecycle State</div>
                            </div>
                        )}
                    </div>

                    {/* Machining Simulation Dropdown */}
                    <div className="tool-dropdown-container">
                        <button
                            className="tool-icon-button"
                            title="Simulation"
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <Play size={20} />
                        </button>
                        {activeDropdown === 'machining_sim' && (
                            <div className="tool-dropdown">
                                <div className="dropdown-item" onClick={() => handleMachiningSimulation('material-removal', {})}>Material Removal Sim</div>
                                <div className="dropdown-item" onClick={() => handleMachiningSimulation('collision-detect', {})}>Collision Detection</div>
                                <div className="dropdown-item" onClick={() => handleMachiningSimulation('kinematic', {})}>Kinematic Simulation</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-item" onClick={() => handleMachiningSimulation('estimate-cycle-time', {})}>Estimate Cycle Time</div>
                                <div className="dropdown-item" onClick={() => handleMachiningSimulation('verify', {})}>Verify Toolpath</div>
                            </div>
                        )}
                    </div>

                    {/* Cost Estimation Dropdown */}
                    <div className="tool-dropdown-container">
                        <button
                            className="tool-icon-button"
                            title="Cost Estimation"
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <DollarSign size={20} />
                        </button>
                        {activeDropdown === 'cost' && (
                            <div className="tool-dropdown">
                                <div className="dropdown-item" onClick={() => handleCost('machining-cost', {})}>Machining Cost</div>
                                <div className="dropdown-item" onClick={() => handleCost('additive-cost', {})}>Additive Manufacturing Cost</div>
                                <div className="dropdown-item" onClick={() => handleCost('assembly-cost', {})}>Assembly Cost</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-item" onClick={() => handleCost('compare', {})}>Compare Methods</div>
                                <div className="dropdown-item" onClick={() => handleCost('report', {})}>Cost Breakdown Report</div>
                            </div>
                        )}
                    </div>

                    {/* Jigs & Fixtures Dropdown */}
                    <div className="tool-dropdown-container">
                        <button
                            className="tool-icon-button"
                            title="Fixtures"
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <Axis3D size={20} />
                        </button>
                        {activeDropdown === 'fixtures' && (
                            <div className="tool-dropdown">
                                <div className="dropdown-header">Machining</div>
                                <div className="dropdown-item" onClick={() => handleFixtures('generate-machining', {})}>Generate Machining Fixture</div>
                                <div className="dropdown-item" onClick={() => handleFixtures('3-2-1-locating', {})}>3-2-1 Locating</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-header">Assembly</div>
                                <div className="dropdown-item" onClick={() => handleFixtures('assembly-jig', {})}>Assembly Jig</div>
                                <div className="dropdown-item" onClick={() => handleFixtures('welding-fixture', {})}>Welding Fixture</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-item" onClick={() => handleFixtures('validate', {})}>Validate Fixture</div>
                            </div>
                        )}
                    </div>

                    {/* DFA & Mechanisms Dropdown */}
                    <div className="tool-dropdown-container">
                        <button
                            className="tool-icon-button"
                            title="DFA & Mechanisms"
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <Cog size={20} />
                        </button>
                        {activeDropdown === 'dfa' && (
                            <div className="tool-dropdown">
                                <div className="dropdown-header">Assembly</div>
                                <div className="dropdown-item" onClick={() => handleDFA('plan-sequence', {})}>Plan Assembly Sequence</div>
                                <div className="dropdown-item" onClick={() => handleDFA('check-interferences', {})}>Check Interferences</div>
                                <div className="dropdown-item" onClick={() => handleDFA('generate-instructions', {})}>Generate Instructions</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-header">Routing</div>
                                <div className="dropdown-item" onClick={() => handleDFA('route-cables', {})}>Cable Routing</div>
                                <div className="dropdown-item" onClick={() => handleDFA('route-hoses', {})}>Hose/Pipe Routing</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-header">Mechanisms</div>
                                <div className="dropdown-item" onClick={() => handleDFA('design-linkage', {})}>Design Linkage</div>
                                <div className="dropdown-item" onClick={() => handleDFA('design-gear-train', {})}>Gear Train</div>
                                <div className="dropdown-item" onClick={() => handleDFA('design-cam', {})}>Cam Mechanism</div>
                            </div>
                        )}
                    </div>

                    {/* Analysis Dropdown - ENHANCED */}
                    <div className="tool-dropdown-container">
                        <button
                            className="tool-icon-button"
                            title="Analysis"
                            ref={el => buttonRefs.current[''] = el}
                            onClick={(e) => { e.stopPropagation(); toggleDropdown(''); }}
                        >
                            <BarChart3 size={20} />
                        </button>
                        {activeDropdown === 'analysis' && (
                            <div className="tool-dropdown">
                                <div className="dropdown-header">Structural</div>
                                <div className="dropdown-item" onClick={() => handleAnalysis('fea-linear', {})}>Linear FEA</div>
                                <div className="dropdown-item" onClick={() => handleAnalysis('fea-nonlinear', {})}>Nonlinear FEA</div>
                                <div className="dropdown-item" onClick={() => handleAnalysis('modal', {})}>Modal Analysis</div>
                                <div className="dropdown-item" onClick={() => handleAnalysis('buckling', {})}>Buckling Analysis</div>
                                <div className="dropdown-item" onClick={() => handleAnalysis('fatigue', {})}>Fatigue Analysis</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-header">Motion</div>
                                <div className="dropdown-item" onClick={() => handleAnalysis('kinematic', {})}>Kinematic Simulation</div>
                                <div className="dropdown-item" onClick={() => handleAnalysis('dynamic-motion', {})}>Dynamic Motion</div>
                                <div className="dropdown-item" onClick={() => handleAnalysis('export-motion-loads', {})}>Export Motion Loads</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-header">Thermal</div>
                                <div className="dropdown-item" onClick={() => handleAnalysis('thermal-steady', {})}>Steady-State</div>
                                <div className="dropdown-item" onClick={() => handleAnalysis('thermal-transient', {})}>Transient</div>
                                <div className="dropdown-divider"></div>
                                <div className="dropdown-header">Other</div>
                                <div className="dropdown-item" onClick={() => handleAnalysis('mass-properties', {})}>Mass Properties</div>
                                <div className="dropdown-item" onClick={() => handleBOM('flat', {})}>Generate BOM</div>
                            </div>
                        )}
                    </div>
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
