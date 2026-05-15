import React, { useState, useRef, useEffect, useCallback } from 'react';
import Viewport3D from '../../components/Viewport3D';
import NavSphere from '../../components/NavSphere';
import ModelTree from '../../components/ModelTree';
import ProjectLibrary from '../../components/ProjectLibrary';
import ComponentInfoPanel from '../../components/ComponentInfoPanel';
import { useViewport } from '../../contexts/ViewportContext';
import apiService from '../../services/api';
import { executeTool, getCurrentAssembly } from './ToolExecutionEngine';
import FeatureTreePanel from '../../components/FeatureTreePanel';
import DesignHistoryPanel from '../../components/DesignHistoryPanel';
import '../../components/DesignHistoryPanel.css';
import PartBrowserPanel from '../../components/PartBrowserPanel';
import '../../components/PartBrowserPanel.css';
import ToolParamDialog from '../../components/ToolParamDialog';
import '../../components/ToolParamDialog.css';
import AISettingsPanel from '../../components/AISettingsPanel';
import '../../components/AISettingsPanel.css';
import AIChatPanel from '../../components/AIChatPanel';
import '../../components/AIChatPanel.css';
import DrawingPreviewPanel from '../../components/DrawingPreviewPanel';
import '../../components/DrawingPreviewPanel.css';
import SectionPreviewPanel from '../../components/SectionPreviewPanel';
import '../../components/SectionPreviewPanel.css';
import ManufacturePreviewPanel from '../../components/ManufacturePreviewPanel';
import '../../components/ManufacturePreviewPanel.css';
import CostEstimationPanel from '../../components/CostEstimationPanel';
import '../../components/CostEstimationPanel.css';
import AssemblyCostPanel from '../../components/AssemblyCostPanel';
import '../../components/AssemblyCostPanel.css';
import DFMCheckPanel from '../../components/DFMCheckPanel';
import '../../components/DFMCheckPanel.css';
import ThoughtBubble from '../../components/ThoughtBubble';
import RibbonToolbar from '../../components/RibbonToolbar';
import PropertyManager from '../../components/PropertyManager';
import AssemblyTree from '../../components/AssemblyTree';
import ComponentTreePanel from '../../components/ComponentTreePanel';
import '../../components/FeatureTreePanel.css';
import '../../components/ThoughtBubble.css';
import '../../components/RibbonToolbar.css';
import '../../components/PropertyManager.css';
import '../../components/AssemblyTree.css';
import '../../components/ComponentTreePanel.css';
import {
    MousePointer, Move, Pencil, Box, Layers, Link2,
    Settings, BarChart3, Waves, Wrench, FileText,
    ChevronRight, Ruler, Pipette, GitBranch,
    Crosshair, Zap, X, CheckCircle, AlertTriangle, Info
} from 'lucide-react';
import './WorkbenchMechanical.css';

/**
 * Mechanical CAD Workbench - Professional Layout
 * Full NX / CATIA / SolidWorks feature parity
 * 13 tool groups covering the complete mechanical design workflow
 */

// ─── Tool Definitions - Full Industry Parity ──────────────────────────────────
const TOOL_GROUPS = {
    sketch: {
        icon: Pencil,
        label: 'Sketch',
        sections: [
            { header: 'Draw', items: [
                'Line', 'Centerline', 'Circle', 'Center Circle', 'Arc', '3-Point Arc',
                'Rectangle', 'Center Rectangle', 'Polygon', 'Spline', 'Fit Spline',
                'Slot', 'Straight Slot', 'Arc Slot', 'Ellipse', 'Parabola',
                'Point', 'Construction Geometry', 'Text'
            ]},
            { header: 'Modify', items: [
                'Trim', 'Extend', 'Offset', 'Offset Chain', 'Fillet Sketch', 'Chamfer Sketch',
                'Mirror Sketch', 'Linear Sketch Pattern', 'Circular Sketch Pattern',
                'Convert Entities', 'Intersection Curve', 'Split Curve'
            ]},
            { header: 'Constrain', items: [
                'Dimension', 'Smart Dimension', 'Horizontal', 'Vertical',
                'Coincident', 'Collinear', 'Parallel', 'Perpendicular',
                'Tangent', 'Equal', 'Concentric', 'Midpoint',
                'Fix', 'Symmetric', 'Fully Define Sketch'
            ]},
            { header: 'Reference', items: [
                'Sketch Plane', 'Sketch on Face', 'Projected Curve', 'Wrap'
            ]},
        ]
    },
    part: {
        icon: Box,
        label: 'Part Design',
        sections: [
            { header: 'Extrusion', items: [
                'Extrude Boss', 'Extrude Cut', 'Extrude Thin', 'Extrude to Surface',
                'Revolve Boss', 'Revolve Cut', 'Revolve Thin'
            ]},
            { header: 'Advanced Shape', items: [
                'Sweep Boss', 'Sweep Cut', 'Loft Boss', 'Loft Cut',
                'Boundary Boss', 'Boundary Cut', 'Rib', 'Coil', 'Wrap Feature'
            ]},
            { header: 'Modify', items: [
                'Fillet', 'Variable Radius Fillet', 'Face Fillet', 'Full Round Fillet',
                'Chamfer', 'Shell', 'Draft', 'Draft Analysis',
                'Hole Wizard', 'Thread', 'Counterbore', 'Countersink',
                'Scale', 'Dome', 'Indent', 'Flex', 'Deform'
            ]},
            { header: 'Boolean', items: [
                'Combine', 'Intersect', 'Subtract', 'Split', 'Move Body', 'Copy Body'
            ]},
            { header: 'Pattern', items: [
                'Linear Pattern', 'Circular Pattern', 'Mirror Feature', 'Mirror Body',
                'Pattern Along Curve', 'Table Driven Pattern', 'Fill Pattern',
                'Variable Pattern'
            ]},
        ]
    },
    reference: {
        icon: Crosshair,
        label: 'Reference',
        sections: [
            { header: 'Geometry', items: [
                'Reference Plane', 'Plane at Angle', 'Plane Offset',
                'Reference Axis', 'Reference Point', 'Center of Mass',
                'Coordinate System', 'Mate Reference'
            ]},
            { header: 'Curves', items: [
                'Composite Curve', 'Curve Through Points', 'Helix/Spiral',
                'Projected Curve', 'Split Line', 'Intersection Curve',
                '3D Sketch', '3D Sketch on Plane'
            ]},
        ]
    },
    directEdit: {
        icon: Zap,
        label: 'Direct Edit',
        sections: [
            { header: 'Direct Modeling', items: [
                'Push/Pull Face', 'Move Face', 'Offset Face', 'Delete Face',
                'Replace Face', 'Resize Fillet', 'Resize Chamfer',
                'Move/Copy Body', 'Recognize Feature'
            ]},
            { header: 'Import Repair', items: [
                'Import Diagnosis', 'Heal Faces', 'Stitch Surface', 'Knit Surface',
                'Check Geometry', 'Remove Duplicates'
            ]},
        ]
    },
    surface: {
        icon: Waves,
        label: 'Surface',
        sections: [
            { header: 'Create', items: [
                'Extrude Surface', 'Revolve Surface', 'Sweep Surface',
                'Loft Surface', 'Boundary Surface', 'Ruled Surface',
                'Fill Surface', 'Planar Surface', 'Offset Surface',
                'Mid Surface', 'N-Sided Patch'
            ]},
            { header: 'Modify', items: [
                'Trim Surface', 'Untrim Surface', 'Extend Surface',
                'Blend Surface', 'Fillet Surface', 'Chamfer Surface',
                'Thicken', 'Knit Surface', 'Flatten', 'Deform Surface'
            ]},
            { header: 'Analysis', items: [
                'Curvature Analysis', 'Zebra Stripes', 'Draft Analysis',
                'Deviation Analysis', 'Minimum Radius', 'Face Curvature',
                'Section Analysis', 'Tangent Continuity'
            ]},
        ]
    },
    assembly: {
        icon: Link2,
        label: 'Assembly',
        sections: [
            { header: 'Components', items: [
                'Insert Component', 'New Component', 'Replace Component',
                'Component Pattern', 'Linear Component Pattern', 'Circular Component Pattern',
                'Mirror Components', 'Move Component', 'Rotate Component',
                'Float', 'Fix Component', 'Component Reference'
            ]},
            { header: 'Mates & Constraints', items: [
                'Coincident', 'Distance', 'Angle', 'Tangent', 'Concentric',
                'Lock', 'Parallel', 'Perpendicular', 'Width',
                'Path Mate', 'Linear Coupler', 'Gear Mate', 'Rack & Pinion',
                'Cam', 'Hinge', 'Screw', 'Universal Joint', 'Slot'
            ]},
            { header: 'Analyze', items: [
                'Exploded View', 'Explode Line Sketch', 'Collapse',
                'Motion Study', 'Contact Detection', 'Interference Detection',
                'Clearance Verification', 'Mass Properties', 'Section View',
                'Large Assembly Mode'
            ]},
            { header: 'Library', items: [
                'Smart Fasteners', 'Toolbox', 'Standard Parts Library',
                'Bearing Wizard', 'Spring Wizard', 'O-Ring'
            ]},
        ]
    },
    sheetmetal: {
        icon: Layers,
        label: 'Sheet Metal',
        sections: [
            { header: 'Create', items: [
                'Base Flange', 'Edge Flange', 'Miter Flange', 'Contour Flange',
                'Hem', 'Tab', 'Sketched Bend', 'Cross Break',
                'Closed Corner', 'Lofted Bend'
            ]},
            { header: 'Form', items: [
                'Forming Tool', 'Louver', 'Lance', 'Rib Form',
                'Dimple', 'Drawn Cutout', 'Stamped Feature'
            ]},
            { header: 'Modify', items: [
                'Fold', 'Unfold', 'Flatten', 'No Bends',
                'Corner Relief', 'Rip', 'Jog', 'Break Corner',
                'Process Bends'
            ]},
            { header: 'Output', items: [
                'Flat Pattern', 'Export DXF', 'Bend Table', 'K-Factor',
                'Gauge Table', 'Bend Deduction', 'Cost Estimation'
            ]},
        ]
    },
    weldments: {
        icon: GitBranch,
        label: 'Weldments',
        sections: [
            { header: 'Structure', items: [
                'Structural Member', '3D Sketch Frame', 'Trim/Extend',
                'End Cap', 'Gusset', 'Fillet Bead', 'Sub-Weld Folder'
            ]},
            { header: 'Weld Beads', items: [
                'Fillet Weld', 'Groove Weld', 'Spot Weld', 'Plug Weld',
                'Cosmetic Weld', 'Weld Symbol'
            ]},
            { header: 'Profiles', items: [
                'C-Channel', 'I-Beam', 'L-Angle', 'T-Section',
                'Rectangular Tube', 'Round Tube', 'Pipe', 'Custom Profile'
            ]},
            { header: 'Output', items: [
                'Cut List', 'Cut List Properties', 'Weld BOM', 'Total Length'
            ]},
        ]
    },
    piping: {
        icon: Pipette,
        label: 'Piping & Routing',
        sections: [
            { header: 'Piping', items: [
                'Route Pipe', 'Edit Route', 'Add Fitting', 'Add Valve',
                'Add Flange', 'Add Tee', 'Add Elbow', 'Add Reducer',
                'Auto Route', 'P&ID Integration'
            ]},
            { header: 'Tubing', items: [
                'Route Tube', 'Flexible Tube', 'Rigid Tube',
                'Tube Fitting', 'Quick Connect', 'Tube Clip'
            ]},
            { header: 'Electrical', items: [
                'Route Cable', 'Wire Harness', 'Add Connector',
                'Add Clip', 'Flatten Route', 'Cable Length Report'
            ]},
            { header: 'Analysis', items: [
                'Flow Analysis', 'Pressure Drop', 'Bill of Materials',
                'Pipe Stress Check', 'Routing Report'
            ]},
        ]
    },
    simulation: {
        icon: BarChart3,
        label: 'Simulate',
        sections: [
            { header: 'Structural', items: [
                'Linear Static FEA', 'Nonlinear FEA', 'Modal Analysis',
                'Buckling Analysis', 'Fatigue Analysis', 'Drop Test',
                'Frequency Response', 'Random Vibration', 'Thermal Stress',
                'Creep Analysis', 'Impact Analysis'
            ]},
            { header: 'Thermal / Flow', items: [
                'Steady-State Thermal', 'Transient Thermal', 'CFD Flow Simulation',
                'Conjugate Heat Transfer', 'Electronics Cooling', 'Free Convection',
                'Radiation', 'HVAC Flow'
            ]},
            { header: 'Motion', items: [
                'Kinematic Study', 'Dynamic Motion', 'Contact Motion',
                'Gravity Loading', 'Export Motion Loads', 'Motor', 'Spring',
                'Damper', 'Force Function'
            ]},
            { header: 'Optimization', items: [
                'Topology Optimization', 'Generative Design', 'Lattice Structures',
                'Design Study', 'Parameter Optimization', 'Multi-objective Study',
                'Sensitivity Analysis', 'What-If Comparison'
            ]},
            { header: 'Setup', items: [
                'Define Material', 'Apply Fixture', 'Apply Load', 'Apply Pressure',
                'Mesh Control', 'Mesh Quality', 'Contact Set', 'Bolt Connector',
                'Pin Connector', 'Remote Load'
            ]},
        ]
    },
    manufacturing: {
        icon: Wrench,
        label: 'Manufacture',
        sections: [
            { header: 'CNC Milling', items: [
                '2.5-Axis Milling', '3-Axis Milling', '3+2 Axis Milling',
                '5-Axis Milling', 'Pocket', 'Face Mill', 'Contour',
                'Adaptive Clearing', 'Steep & Shallow', 'Rest Machining'
            ]},
            { header: 'CNC Turning', items: [
                'Turning Roughing', 'Turning Finishing', 'Grooving',
                'Threading', 'Drilling', 'Bore', 'Mill-Turn'
            ]},
            { header: 'Post Process', items: [
                'Generate G-Code', 'Simulate Toolpath', 'Verify Against Stock',
                'Estimate Cycle Time', 'NC Editor', 'Post Processor Config'
            ]},
            { header: 'Mold & Casting', items: [
                'Draft Analysis', 'Parting Line', 'Shut-Off Surface',
                'Core & Cavity', 'Cooling Channels', 'Ejector Pins',
                'Runner System', 'Gate Location', 'Mold Flow Analysis'
            ]},
            { header: 'Additive', items: [
                'Optimize Orientation', 'Generate Supports', 'Nest Parts',
                'Slice Preview', 'Material Estimation', 'Build Simulation',
                'Export STL', 'Export 3MF', 'Export AMF'
            ]},
            { header: 'Inspection', items: [
                'CMM Program', 'First Article Inspection', 'Deviation Map',
                'Measurement Plan', 'GD&T Callout', 'Balloon Report'
            ]},
            { header: 'Cost & DFM', items: [
                'Fixtures', 'Cost Estimation', 'DFM Check', 'DFA Analysis',
                'Sustainability Check', 'Weight Optimization'
            ]},
        ]
    },
    documentation: {
        icon: FileText,
        label: 'Document',
        sections: [
            { header: 'Drawings', items: [
                'New Drawing', 'Standard 3 View', 'Add View', 'Projected View',
                'Auxiliary View', 'Section View', 'Detail View', 'Break View',
                'Crop View', 'Alternate Position View', 'Isometric View'
            ]},
            { header: 'Annotation', items: [
                'Smart Dimension', 'Ordinate Dimension', 'Baseline Dimension',
                'Reference Dimension', 'Note', 'Balloon', 'Auto Balloon',
                'Surface Finish', 'Weld Symbol', 'Datum Feature',
                'Datum Target', 'GD&T Frame', 'Geometric Tolerance',
                'Hole Callout', 'Stack-Up Tolerance'
            ]},
            { header: 'Table', items: [
                'BOM Table', 'Revision Table', 'Hole Table',
                'General Table', 'Bend Table', 'Weld Table',
                'Design Table', 'Title Block'
            ]},
            { header: 'Output', items: [
                'Export PDF', 'Export DWG', 'Export DXF',
                'Export STEP', 'Export IGES', 'Export Parasolid',
                'Export JT', 'Export 3D PDF', 'Pack and Go'
            ]},
        ]
    },
    measure: {
        icon: Ruler,
        label: 'Measure',
        sections: [
            { header: 'Measure', items: [
                'Distance', 'Angle', 'Radius', 'Length', 'Area', 'Volume',
                'Mass Properties', 'Center of Gravity', 'Moments of Inertia'
            ]},
            { header: 'Check', items: [
                'Check Geometry', 'Draft Check', 'Undercut Check',
                'Wall Thickness', 'Interference', 'Clearance',
                'Deviation Compare', 'Point Cloud Compare'
            ]},
            { header: 'Display', items: [
                'Section Plane', 'Dynamic Section', 'Measure Point',
                'Annotate Measurement', 'Export Report'
            ]},
        ]
    },
};

function WorkbenchMechanical() {
    const [activeDropdown, setActiveDropdown] = useState(null);
    const [contextMenu, setContextMenu] = useState(null);
    const [dropdownStyle, setDropdownStyle] = useState({});
    const [viewportRef, setViewportRef] = useState(null);
    const [actionStatus, setActionStatus] = useState(null);
    const [toolStatus, setToolStatus] = useState(null);    // { message, type, tool }
    const [activeTool, setActiveTool] = useState(null);    // Currently active tool name
    const [activeProjectId, setActiveProjectId] = useState(null);
    const [selection, setSelection] = useState(null);
    const [aiSettingsOpen, setAISettingsOpen] = useState(false);
    const [aiChatOpen, setAIChatOpen] = useState(false);
    const [ribbonTab, setRibbonTab] = useState('part');
    const dropdownRef = useRef(null);
    const buttonRefs = useRef({});
    const toolStatusTimerRef = useRef(null);
    const viewport = useViewport();

    // Get selected model from context
    const selectedModel = viewport?.models?.find(m => m.id === viewport?.selectedModelId) || null;

    // ─── Tool Execution Handler ────────────────────────────────────────────────
    const handleToolExecute = useCallback(async (groupKey, toolName) => {
        setActiveDropdown(null);

        const scene = viewport?.scene;
        if (!scene) {
            setToolStatus({ message: 'Viewport not ready yet. Please wait.', type: 'error', tool: toolName });
            return;
        }

        setActiveTool(toolName);

        // Execute the tool action — handlers may be async (foundation
        // path uses manifold-3d WASM and returns a Promise). Show a
        // transient "Running…" status while we wait so the UI is honest.
        const out = executeTool(groupKey, toolName, scene, viewport);
        let result;
        if (out && typeof out.then === 'function') {
            setToolStatus({ message: `${toolName} running…`, type: 'info', tool: toolName });
            result = await out;
        } else {
            result = out;
        }

        setToolStatus({
            message: result.message,
            type: result.status, // 'success', 'info', 'warn', 'error'
            tool: toolName,
        });

        if (toolStatusTimerRef.current) clearTimeout(toolStatusTimerRef.current);
        const delay = result.status === 'success' ? 4000 : result.status === 'error' ? 6000 : 8000;
        toolStatusTimerRef.current = setTimeout(() => {
            setToolStatus(null);
        }, delay);
    }, [viewport]);

    // ─── Select / Move / Settings handlers ─────────────────────────────────────
    const [interactionMode, setInteractionMode] = useState('select'); // 'select' | 'move'

    const handleSelectMode = useCallback(() => {
        setInteractionMode('select');
        setActiveTool('Select');
        setToolStatus({ message: 'Select mode: Click objects to select them.', type: 'info', tool: 'Select' });
        if (viewport?.controls) {
            viewport.controls.enableRotate = true;
        }
    }, [viewport]);

    const handleMoveMode = useCallback(() => {
        setInteractionMode('move');
        setActiveTool('Move');
        setToolStatus({ message: 'Move mode: Drag objects to reposition. Use gizmo handles for axis-constrained movement.', type: 'info', tool: 'Move' });
        if (viewport?.setTransformMode) {
            viewport.setTransformMode('translate');
        }
    }, [viewport]);

    const handleSettings = useCallback(() => {
        setToolStatus({ message: 'Settings: Grid, Snap, Units, Display preferences. (Settings panel coming soon)', type: 'info', tool: 'Settings' });
    }, []);

    // ─── Context menu actions ────────────────────────────────────────────────────
    const handleContextAction = useCallback((action) => {
        setContextMenu(null);
        const scene = viewport?.scene;
        switch (action) {
            case 'New Sketch':
                if (scene) executeTool('sketch', 'Line', scene, viewport);
                setToolStatus({ message: 'New sketch started on selected face.', type: 'success', tool: 'Sketch' });
                break;
            case 'Insert Reference Plane':
                if (scene) executeTool('reference', 'Reference Plane', scene, viewport);
                break;
            case 'Measure':
                if (scene) executeTool('measure', 'Distance', scene, viewport);
                break;
            case 'Mass Properties':
                if (selectedModel) {
                    setToolStatus({
                        message: `Mass: ${selectedModel.massProperties?.mass || '--'} kg | Vol: ${selectedModel.massProperties?.volume || '--'} cm³`,
                        type: 'info', tool: 'Mass Properties'
                    });
                }
                break;
            case 'Delete':
                if (selectedModel && viewport?.removeModel) {
                    viewport.removeModel(selectedModel.id);
                    setToolStatus({ message: `Deleted "${selectedModel.name}"`, type: 'success', tool: 'Delete' });
                }
                break;
            case 'Hide/Show':
                if (selectedModel && viewport?.toggleModelVisibility) {
                    viewport.toggleModelVisibility(selectedModel.id);
                    setToolStatus({ message: `Toggled visibility of "${selectedModel.name}"`, type: 'info', tool: 'Visibility' });
                }
                break;
            default:
                setToolStatus({ message: `${action} activated.`, type: 'info', tool: action });
        }
    }, [viewport, selectedModel]);

    // Keyboard shortcuts for toolbar
    useEffect(() => {
        const handleKey = (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            if (e.key === 'v' || e.key === 'V') { handleSelectMode(); }
            if (e.key === 'g' || e.key === 'G') { handleMoveMode(); }
            if (e.key === 'Escape') { setActiveDropdown(null); setActiveTool(null); setToolStatus(null); }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [handleSelectMode, handleMoveMode]);

    // Smart dropdown positioning - viewport-aware fixed overlay
    const calculateDropdownPosition = useCallback((buttonElement) => {
        if (!buttonElement) return {};

        const rect = buttonElement.getBoundingClientRect();
        const vh = window.innerHeight;
        const vw = window.innerWidth;
        const dropdownH = 500;
        const dropdownW = 260;

        let style = { position: 'fixed', zIndex: 9999 };

        if (rect.right + dropdownW + 8 < vw) {
            style.left = rect.right + 4;
        } else {
            style.left = rect.left - dropdownW - 4;
        }

        if (vh - rect.top >= dropdownH) {
            style.top = rect.top;
        } else if (rect.bottom >= dropdownH) {
            style.top = rect.bottom - dropdownH;
        } else {
            style.top = Math.max(8, (vh - Math.min(dropdownH, vh - 16)) / 2);
            style.maxHeight = vh - 16;
            style.overflowY = 'auto';
        }

        return style;
    }, []);

    useEffect(() => {
        if (activeDropdown && buttonRefs.current[activeDropdown]) {
            setDropdownStyle(calculateDropdownPosition(buttonRefs.current[activeDropdown]));
        }
    }, [activeDropdown, calculateDropdownPosition]);

    useEffect(() => {
        const onResize = () => {
            if (activeDropdown && buttonRefs.current[activeDropdown]) {
                setDropdownStyle(calculateDropdownPosition(buttonRefs.current[activeDropdown]));
            }
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [activeDropdown, calculateDropdownPosition]);

    useEffect(() => {
        if (!activeDropdown) return;
        const handleClick = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                const isToolButton = Object.values(buttonRefs.current).some(
                    btn => btn && btn.contains(e.target)
                );
                if (!isToolButton) setActiveDropdown(null);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [activeDropdown]);

    const toggleDropdown = (name) => {
        setActiveDropdown(activeDropdown === name ? null : name);
    };

    const handleRightClick = (e) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
    };

    const closeContextMenu = () => setContextMenu(null);

    const handleViewportReady = (data) => {
        setViewportRef(data);
    };

    // ─── Endpoint-Connected Quick Actions ────────────────────────────────────────
    const runAction = async (actionName, apiCall) => {
        setActionStatus({ action: actionName, status: 'running' });
        try {
            const result = await apiCall();
            setActionStatus({ action: actionName, status: 'done', result });
            setTimeout(() => setActionStatus(null), 3000);
        } catch (err) {
            setActionStatus({ action: actionName, status: 'error', error: err.message });
            setTimeout(() => setActionStatus(null), 5000);
        }
    };

    const handleRunFEA = () => {
        if (!selectedModel) return;
        runAction('FEA Analysis', () =>
            apiService.analyzeDesign({ designId: selectedModel.designId, specs: selectedModel.specs })
        );
    };

    const handleRunCFD = () => {
        if (!selectedModel) return;
        runAction('CFD Simulation', async () => {
            const res = await fetch('/api/parametric/prep-simulation', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    designData: selectedModel.specs,
                    simulationType: 'cfd',
                }),
            });
            return res.json();
        });
    };

    const handleExportGLTF = () => {
        if (!selectedModel) return;
        runAction('Export glTF', async () => {
            const res = await fetch(`/api/download/${selectedModel.designId}/gltf`);
            if (res.ok) {
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${selectedModel.name || 'model'}.gltf`;
                a.click();
                URL.revokeObjectURL(url);
            }
            return { success: true };
        });
    };

    const handleExportOBJ = () => {
        if (!selectedModel) return;
        runAction('Export OBJ', async () => {
            const res = await fetch(`/api/download/${selectedModel.designId}/obj`);
            if (res.ok) {
                const blob = await res.blob();
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${selectedModel.name || 'model'}.obj`;
                a.click();
                URL.revokeObjectURL(url);
            }
            return { success: true };
        });
    };

    const handleTopoOpt = () => {
        if (!selectedModel) return;
        runAction('Topology Optimization', async () => {
            const res = await fetch('/api/parametric/generate-variants', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: `Optimize topology of ${selectedModel.name}`,
                    numVariants: 1,
                    strategies: ['lightweight'],
                }),
            });
            return res.json();
        });
    };

    const handleGenerateToolpath = () => {
        if (!selectedModel) return;
        runAction('Generate Toolpath', async () => {
            const res = await fetch('/api/mechanical/analyze', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    designData: selectedModel.specs,
                    analysisType: 'manufacturing',
                }),
            });
            return res.json();
        });
    };

    // ─── Transform handlers ──────────────────────────────────────────────────────
    const handleTransformChange = (field, value) => {
        if (!viewport || !selectedModel) return;
        viewport.updateModelTransform(selectedModel.id, field, value);
    };

    const handleMaterialChange = (e) => {
        if (!viewport || !selectedModel) return;
        viewport.updateModelMaterial(selectedModel.id, e.target.value);
    };

    // ─── Render Dropdown ─────────────────────────────────────────────────────────
    const renderDropdown = (groupKey) => {
        const group = TOOL_GROUPS[groupKey];
        if (activeDropdown !== groupKey) return null;

        return (
            <div
                className="tool-dropdown smart-positioned"
                style={dropdownStyle}
                ref={dropdownRef}
            >
                <div className="dropdown-title">{group.label}</div>
                {group.sections.map((section, si) => (
                    <React.Fragment key={si}>
                        {si > 0 && <div className="dropdown-divider" />}
                        <div className="dropdown-header">{section.header}</div>
                        {section.items.map(item => (
                            <div
                                key={item}
                                className={`dropdown-item ${activeTool === item ? 'active-tool' : ''}`}
                                onClick={() => handleToolExecute(groupKey, item)}
                            >
                                {item}
                            </div>
                        ))}
                    </React.Fragment>
                ))}
            </div>
        );
    };

    return (
        <>
            {/* RIBBON TOOLBAR - Professional contextual toolbar */}
            <RibbonToolbar
                activeTab={ribbonTab}
                onTabChange={setRibbonTab}
                onToolClick={(groupKey, toolName) => handleToolExecute(groupKey, toolName)}
            />

            {/* LEFT TOOLBAR - Icon buttons only, dropdown rendered outside */}
            <aside className="workbench-tools">
                <div className="workbench-tools-inner">
                    {/* Pointer tools */}
                    <button
                        className={`tool-icon-button ${interactionMode === 'select' ? 'active' : ''}`}
                        title="Select (V)"
                        onClick={handleSelectMode}
                    >
                        <MousePointer size={18} />
                    </button>
                    <button
                        className={`tool-icon-button ${interactionMode === 'move' ? 'active' : ''}`}
                        title="Move (G)"
                        onClick={handleMoveMode}
                    >
                        <Move size={18} />
                    </button>

                    <div className="tool-separator" />

                    {/* All tool groups - buttons only, NO dropdown inside */}
                    {Object.entries(TOOL_GROUPS).map(([key, group]) => {
                        const Icon = group.icon;
                        return (
                            <button
                                key={key}
                                ref={el => buttonRefs.current[key] = el}
                                className={`tool-icon-button ${activeDropdown === key ? 'active' : ''}`}
                                title={group.label}
                                onClick={(e) => { e.stopPropagation(); toggleDropdown(key); }}
                            >
                                <Icon size={18} />
                                <ChevronRight size={8} className="tool-expand-indicator" />
                            </button>
                        );
                    })}

                    <div className="tool-separator" />

                    {/* Settings */}
                    <button className="tool-icon-button" title="Settings" onClick={handleSettings}>
                        <Settings size={18} />
                    </button>
                </div>
            </aside>

            {/* DROPDOWN OVERLAY - Rendered OUTSIDE the sidebar to avoid mask-image clipping */}
            {activeDropdown && renderDropdown(activeDropdown)}

            {/* CENTER VIEWPORT */}
            <main
                className="workbench-viewport"
                onContextMenu={handleRightClick}
                onClick={closeContextMenu}
            >
                <Viewport3D
                    canvasId="render-canvas-mechanical"
                    domain="mechanical"
                    onReady={handleViewportReady}
                    onSelectionChange={setSelection}
                />

                {/* NavSphere - translucent 3D navigation sphere */}
                {viewportRef && (
                    <NavSphere
                        camera={viewportRef.camera}
                        controls={viewportRef.controls}
                    />
                )}

                {/* Tool Status Bar - shows feedback when tools are clicked */}
                {toolStatus && (
                    <div className={`tool-status-bar tool-status-${toolStatus.type}`}>
                        <div className="tool-status-icon">
                            {toolStatus.type === 'success' && <CheckCircle size={14} />}
                            {toolStatus.type === 'error' && <AlertTriangle size={14} />}
                            {toolStatus.type === 'warn' && <AlertTriangle size={14} />}
                            {toolStatus.type === 'info' && <Info size={14} />}
                        </div>
                        <div className="tool-status-content">
                            {toolStatus.tool && <span className="tool-status-name">{toolStatus.tool}</span>}
                            <span className="tool-status-message">{toolStatus.message}</span>
                        </div>
                        <button className="tool-status-close" onClick={() => setToolStatus(null)}>
                            <X size={12} />
                        </button>
                    </div>
                )}

                {/* Active Tool Indicator */}
                {activeTool && (
                    <div className="active-tool-indicator">
                        <span className="active-tool-dot" />
                        <span>{activeTool}</span>
                    </div>
                )}

                {/* Thought Bubble — component info on selection */}
                {selection && <ThoughtBubble selection={selection} viewport={viewport} />}

                {/* Selection Info Bar */}
                {selection && (
                    <div className="selection-info-bar">
                        <span className="selection-info-type">{selection.type}</span>
                        {selection.faceId && <span>Face #{selection.faceId}</span>}
                        {selection.edgeCount && <span>{selection.edgeCount} edges</span>}
                        {selection.name && <span>{selection.name}</span>}
                        {selection.solidId && <span className="selection-info-id">Solid #{selection.solidId}</span>}
                    </div>
                )}

                {/* Project Library - overlay inside viewport */}
                <ProjectLibrary
                    activeProjectId={activeProjectId}
                    onSelectProject={(id) => setActiveProjectId(id)}
                    onNewProject={() => setActiveProjectId(null)}
                />
            </main>

            {/* RIGHT PROPERTIES PANEL */}
            <aside className="workbench-properties">
                {/* Design history — every foundation tool run appears here */}
                <DesignHistoryPanel />

                {/* Part browser — every foundation body in the scene */}
                <PartBrowserPanel />

                {/* Feature Tree at top */}
                <FeatureTreePanel onSelectFeature={(id) => console.log('Selected feature:', id)} />

                {/* Assembly Tree \u2014 expand/collapse + instance counts */}
                <AssemblyTree
                    assembly={getCurrentAssembly()}
                    onPartClick={(part) => setSelection({ type: 'object', name: part.name, solidId: part.solid?.id, solid: part.solid })}
                />

                {/* Component Registry Panel \u2014 every part has a registered ID; click to focus */}
                <ComponentTreePanel
                    scene={typeof window !== 'undefined' ? window.__three_scene : null}
                    camera={typeof window !== 'undefined' ? window.__three_camera : null}
                    controls={typeof window !== 'undefined' ? window.__three_controls : null}
                    onSelect={(entry) => setSelection({ type: 'component', name: entry.name, partID: entry.partID, entry })}
                />

                {/* PropertyManager \u2014 context-aware properties */}
                <PropertyManager selection={selection} lastFeature={null} />
            </aside>

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="context-menu"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                    onClick={closeContextMenu}
                >
                    <div className="context-menu-item" onClick={() => handleContextAction('Edit Feature')}>Edit Feature</div>
                    <div className="context-menu-item" onClick={() => handleContextAction('Edit Sketch')}>Edit Sketch</div>
                    <div className="context-menu-item" onClick={() => handleContextAction('Suppress')}>Suppress</div>
                    <div className="context-menu-item" onClick={() => handleContextAction('Delete')}>Delete</div>
                    <div className="context-menu-divider" />
                    <div className="context-menu-item" onClick={() => handleContextAction('New Sketch')}>New Sketch</div>
                    <div className="context-menu-item" onClick={() => handleContextAction('Insert Reference Plane')}>Insert Reference Plane</div>
                    <div className="context-menu-item" onClick={() => handleContextAction('Measure')}>Measure</div>
                    <div className="context-menu-item" onClick={() => handleContextAction('Mass Properties')}>Mass Properties</div>
                    <div className="context-menu-divider" />
                    <div className="context-menu-item" onClick={() => handleContextAction('Select Bodies')}>Select Bodies</div>
                    <div className="context-menu-item" onClick={() => handleContextAction('Hide/Show')}>Hide/Show</div>
                    <div className="context-menu-item" onClick={() => handleContextAction('Isolate')}>Isolate</div>
                    <div className="context-menu-item" onClick={() => handleContextAction('Change Transparency')}>Change Transparency</div>
                </div>
            )}

            {/* Tool parameter dialog — listens for handler requestToolParams() calls */}
            <ToolParamDialog />

            {/* BYO-LLM Settings — toggled via the floating "AI" pill */}
            <button className="ai-settings-launcher"
                    onClick={() => setAISettingsOpen(true)}
                    title="AI Provider Settings (BYO-LLM)">
              AI
            </button>
            <AISettingsPanel open={aiSettingsOpen} onClose={() => setAISettingsOpen(false)} />

            {/* AI Chat front-door — Clarifier + Planner + Executor in one panel */}
            <button className="chat-launcher"
                    onClick={() => setAIChatOpen(true)}
                    title="AI Chat (Clarifier + Planner + Run)"
                    data-action="open-chat">
              💬
            </button>
            <AIChatPanel open={aiChatOpen} onClose={() => setAIChatOpen(false)} />

            {/* Drawing preview overlay — pops when Standard 3 View runs */}
            <DrawingPreviewPanel />

            {/* Section preview overlay — pops when Section View runs */}
            <SectionPreviewPanel />

            {/* Manufacture preview overlay — pops when a CAM tool runs */}
            <ManufacturePreviewPanel />

            {/* Cost estimation overlay — pops when Cost Estimation runs */}
            <CostEstimationPanel />

            {/* Assembly cost overlay — pops when Assembly Cost runs */}
            <AssemblyCostPanel />

            {/* DFM Check overlay — pops when DFM Check runs */}
            <DFMCheckPanel />
        </>
    );
}

export default WorkbenchMechanical;
