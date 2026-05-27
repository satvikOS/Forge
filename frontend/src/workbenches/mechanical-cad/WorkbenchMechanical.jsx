import React, { useState, useRef, useEffect, useCallback } from 'react';
import Viewport3D from '../../components/Viewport3D';
import NavSphere from '../../components/NavSphere';
import ModelTree from '../../components/ModelTree';
import ProjectLibrary from '../../components/ProjectLibrary';
import ComponentInfoPanel from '../../components/ComponentInfoPanel';
import { useViewport } from '../../contexts/ViewportContext';
import apiService from '../../services/api';
import { executeTool, getCurrentAssembly } from './ToolExecutionEngine';
import { addFoundationManifoldToScene, addBrepShapeToScene } from './ToolExecutionEngine';
import { getKernel } from '../../kernel/brep/kernelLoader.js';
import { ArchDiscKernel } from '../../kernel/brep/ArchDiscKernel.js';
import * as THREE from 'three';
import { getBodyRegistry } from '../../foundation/BodyRegistry';
import { createPart, startSketch, sketchRectangle, sketchCircle, finishSketch, extrude, cut, revolve, circularPattern, linearPattern, translate, fillet } from '../../kernel/atomic/AtomicOps.js';
import { sculptPart, requestSculptPlan, executeSculptPlan } from '../../ai/sculptor/PartSculptor.js';
import { sculptAssembly } from '../../ai/sculptor/AssemblyBuilder.js';
import { requestManifest } from '../../ai/sculptor/ComponentManifest.js';
import { ComponentLibrary, partToStep } from '../../ai/sculptor/ComponentLibrary.js';
import { loopSubdivide, loopStep, weldMesh } from '../../foundation/LoopSubdivision.js';
import {
    bindSpine, bindSpineFromShape, validateSpine, SpineBody,
    Body as SpineBodyClass, Lump, Shell, Face, Loop, Coedge, Edge, Vertex,
    IdAllocator,
} from '../../kernel/topology/index.js';
import FeatureTreePanel from '../../components/FeatureTreePanel';
import DesignHistoryPanel from '../../components/DesignHistoryPanel';
import '../../components/DesignHistoryPanel.css';
import PartBrowserPanel from '../../components/PartBrowserPanel';
import '../../components/PartBrowserPanel.css';
import TopologyInspector from '../../components/TopologyInspector';
import '../../components/TopologyInspector.css';
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
import SlicerPreviewPanel from '../../components/SlicerPreviewPanel';
import '../../components/SlicerPreviewPanel.css';
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
import {
    ConfirmationCorner,
    HeadsUpViewToolbar,
    PropertyManagerDock,
    SketchStateBadge,
    SelectionPriorityBar,
} from '../../components/SwUxOverlays';
import '../../components/SwUxOverlays.css';
import '../../components/FeatureTreePanel.css';
import '../../components/ThoughtBubble.css';
import '../../components/RibbonToolbar.css';
import '../../components/PropertyManager.css';
import '../../components/AssemblyTree.css';
import '../../components/ComponentTreePanel.css';
import {
    MousePointer, Move, Pencil, Box, Layers, Link2,
    Settings, BarChart3, Waves, Wrench, FileText,
    ChevronRight, ChevronLeft, Ruler, Pipette, GitBranch,
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
            { header: 'Solid Primitives', items: [
                'Box', 'Cylinder', 'Sphere', 'Cone', 'Torus'
            ]},
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
                'Offset Shape', 'Hole Wizard', 'Thread', 'Counterbore', 'Countersink',
                'Scale', 'Dome', 'Indent', 'Flex', 'Deform', 'Corner Mitre'
            ]},
            { header: 'Boolean', items: [
                'Combine', 'Intersect', 'Subtract', 'Split', 'Move Body', 'Copy Body',
                'Combine (Non-Manifold)', 'Combine (Coincident)', 'Lattice Fuse'
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
                'Remove Duplicates', 'Simplify Geometry'
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
                'Thicken', 'Subdivide Surface', 'Catmull-Clark Subdivide', 'Retopo Surface', 'NURBS Patch', 'Refine NURBS', 'Elevate NURBS', 'NURBS Curvature', 'Sweep Tortuous', 'Loft Tangent', 'Stitch Faces', 'Convergent Solid', 'Surface-Surface Intersection', 'Trimmed NURBS Patch', 'G2 Blend', 'Knit Surface', 'Flatten', 'Deform Surface'
            ]},
            { header: 'Faceting', items: [
                'Faceter Controls', 'Hidden Line / Silhouette'
            ]},
            { header: 'Analysis', items: [
                'Class-A Analyze', 'Zebra Stripes', 'Curvature Analysis',
                'Draft Analysis', 'Deviation Analysis', 'Minimum Radius',
                'Face Curvature', 'Section Analysis', 'Tangent Continuity'
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

// SHOW_THOUGHT_BUBBLE — the floating info box that pops up over the viewport when an
// object is selected. Temporarily disabled: it obstructs the view of the geometry and
// the operation in progress. Flip to true to re-add it.
const SHOW_THOUGHT_BUBBLE = false;

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
    // Press '?' to toggle the keyboard-shortcut help overlay (SW/NX
    // convention). Listed in the keydown handler below.
    const [helpOverlayOpen, setHelpOverlayOpen] = useState(false);
    // Drawer collapse state — both the left toolbar (icon strip) and the
    // right properties panel can be collapsed to thin slivers so the user
    // can reclaim viewport real estate without losing access to the
    // drawer's content (re-expand via the same chevron). Persisted in
    // localStorage so the user's preference survives reload.
    //
    // Fixed-viewport contract: collapsing a drawer does NOT widen the
    // 3D viewport canvas. The drawer's reserved gutter (defined in
    // workbench.css) stays the same width; the drawer's CONTENTS slide
    // off-screen behind the gutter edge.
    const [toolsCollapsed, setToolsCollapsed] = useState(() => {
        if (typeof window === 'undefined') return false;
        try { return window.localStorage.getItem('archdisc.tools.collapsed') === '1'; }
        catch { return false; }
    });
    const [propsCollapsed, setPropsCollapsed] = useState(() => {
        if (typeof window === 'undefined') return false;
        try { return window.localStorage.getItem('archdisc.properties.collapsed') === '1'; }
        catch { return false; }
    });
    const toggleToolsCollapsed = useCallback(() => {
        setToolsCollapsed((p) => {
            const n = !p;
            try { window.localStorage.setItem('archdisc.tools.collapsed', n ? '1' : '0'); } catch {}
            return n;
        });
    }, []);
    const togglePropsCollapsed = useCallback(() => {
        setPropsCollapsed((p) => {
            const n = !p;
            try { window.localStorage.setItem('archdisc.properties.collapsed', n ? '1' : '0'); } catch {}
            return n;
        });
    }, []);

    // Expose setSelection on window so headed e2e specs can trigger the
    // ThoughtBubble without needing a real 3D viewport pick.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__archdiscSetSelection = setSelection;
        return () => { delete window.__archdiscSetSelection; };
    }, [setSelection]);

    // Expose the BodyRegistry on window so e2e specs and _pickBodies can
    // programmatically select bodies without needing viewport picking.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__archdiscRegistry = getBodyRegistry();
        return () => { delete window.__archdiscRegistry; };
    }, []);

    const [aiSettingsOpen, setAISettingsOpen] = useState(false);
    const [aiChatOpen, setAIChatOpen] = useState(false);
    const [ribbonTab, setRibbonTab] = useState('part');
    const dropdownRef = useRef(null);
    const buttonRefs = useRef({});
    const toolStatusTimerRef = useRef(null);
    const viewport = useViewport();

    // Expose the atomic CAD operation set on window so the autonomous
    // sculptor (and headed e2e specs) can drive ArchDisc's real tools and
    // see each feature appear in the live viewport. `render` replaces the
    // previous atomic body so an evolving part stays a single body.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const scene = viewport?.scene;
        if (!scene) return undefined;
        let lastAtomicGroup = null;
        window.__archdiscAtomic = {
            createPart, startSketch, sketchRectangle, sketchCircle, finishSketch, extrude, cut, revolve, circularPattern, linearPattern, translate, fillet,
            render: (part, color) => {
                if (lastAtomicGroup) {
                    // Unregister from the body registry (also removes from scene)
                    // so the BODIES panel shows only the current atomic body.
                    const prevId = lastAtomicGroup.userData.bodyId;
                    if (prevId) {
                        getBodyRegistry().remove(prevId);
                    } else {
                        scene.remove(lastAtomicGroup);
                    }
                    lastAtomicGroup = null;
                }
                lastAtomicGroup = addFoundationManifoldToScene(
                    scene, viewport, part.solid, color ?? 0x9aa3ad,
                );
                return lastAtomicGroup;
            },
            renderBody: (part, color) =>
                addFoundationManifoldToScene(scene, viewport, part.solid, color ?? 0x9aa3ad),
        };
        return () => { delete window.__archdiscAtomic; };
    }, [viewport]);

    // Expose the L2 AI Sculptor so headed e2e specs (and the app) can ask an
    // LLM to autonomously sculpt a part from a plain-text description.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__archdiscSculptor = { sculptPart, requestSculptPlan, executeSculptPlan, sculptAssembly, requestManifest };
        return () => { delete window.__archdiscSculptor; };
    }, []);

    // The session-wide component library: each finished component is saved
    // here (and exported to STEP) so the build never loses a completed part.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const library = new ComponentLibrary();
        window.__archdiscComponents = {
            library,
            partToStep,
            save: async ({ id, name, part }) => {
                const stepText = await partToStep(part);
                return library.saveComponent({ id, name, stepText, volume: part.solid.volume() });
            },
            list: () => library.list(),
            get: (id) => library.get(id),
            count: () => library.count(),
        };
        return () => { delete window.__archdiscComponents; };
    }, []);

    // Expose the ArchDisc Kernel so headed Electron e2e specs
    // (and the B-rep Lab panel) can drive exact B-rep geometry and see it
    // render in the live viewport.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const scene = viewport?.scene;
        if (!scene) return undefined;
        let lastBrepGroup = null;
        const renderShape = async (shape) => {
            const mesh = await ArchDiscKernel.brep.brepToMesh(shape);
            if (lastBrepGroup) { scene.remove(lastBrepGroup); lastBrepGroup = null; }
            const group = new THREE.Group();
            group.scale.set(0.001, 0.001, 0.001);
            group.add(mesh);
            group.userData.pickable = true;
            group.userData.generatedModel = true;
            scene.add(group);
            group.updateMatrixWorld(true);
            lastBrepGroup = group;
            if (typeof window.__archdiscFocusOnObject === 'function') {
                window.__archdiscFocusOnObject(group);
            }
            const metrics = await ArchDiscKernel.brep.measure(shape);
            // __lastBrepShape holds live kernel memory owned by this closure;
            // dispose the previous before replacing. External code must not
            // dispose it.
            if (window.__lastBrepShape) { window.__lastBrepShape.dispose(); }
            window.__lastBrepMetrics = metrics;
            window.__lastBrepShape = shape;
            return metrics;
        };
        window.__archdiscKernel = {
            getKernel,
            getOCCT: getKernel,  // backward-compatible alias for existing e2e specs
            kernel: ArchDiscKernel,
            renderShape,
            renderBox: async (dx, dy, dz) =>
                renderShape(await ArchDiscKernel.brep.makeBox(dx, dy, dz)),
            renderCylinder: async (r, h) =>
                renderShape(await ArchDiscKernel.brep.makeCylinder(r, h)),
            renderSphere: async (r) =>
                renderShape(await ArchDiscKernel.brep.makeSphere(r)),
            renderCone: async (r1, r2, h) =>
                renderShape(await ArchDiscKernel.brep.makeCone(r1, r2, h)),
            renderTorus: async (R, r) =>
                renderShape(await ArchDiscKernel.brep.makeTorus(R, r)),
            renderFuse: async () => {
                const a = await ArchDiscKernel.brep.makeBox(10, 10, 10);
                const b = await ArchDiscKernel.brep.makeBox(10, 10, 10);
                const result = await ArchDiscKernel.brep.fuse(a, b);
                a.dispose(); b.dispose();
                return renderShape(result);
            },
            renderCut: async () => {
                const block = await ArchDiscKernel.brep.makeBox(12, 12, 12);
                const drill = await ArchDiscKernel.brep.makeCylinder(4, 12);
                const result = await ArchDiscKernel.brep.cut(block, drill);
                block.dispose(); drill.dispose();
                return renderShape(result);
            },
            renderCommon: async () => {
                const block = await ArchDiscKernel.brep.makeBox(12, 12, 12);
                const ball = await ArchDiscKernel.brep.makeSphere(8);
                const result = await ArchDiscKernel.brep.common(block, ball);
                block.dispose(); ball.dispose();
                return renderShape(result);
            },
            renderExtrude: async (w, h, d) =>
                renderShape(await ArchDiscKernel.brep.extrudeRect(w, h, d)),
            renderRevolve: async (innerR, w, h, deg) =>
                renderShape(await ArchDiscKernel.brep.revolveRect(innerR, w, h, deg)),
            renderFillet: async (size, radius) =>
                renderShape(await ArchDiscKernel.brep.filletAll(
                    await ArchDiscKernel.brep.makeBox(size, size, size), radius)),
            renderChamfer: async (size, distance) =>
                renderShape(await ArchDiscKernel.brep.chamferAll(
                    await ArchDiscKernel.brep.makeBox(size, size, size), distance)),
            renderShell: async (boxSize, wallThickness) => {
                const box = await ArchDiscKernel.brep.makeBox(boxSize, boxSize, boxSize);
                const hollowed = await ArchDiscKernel.brep.shell(box, wallThickness);
                box.dispose();
                return renderShape(hollowed);
            },
            renderThicken: async (w, h, t) => {
                const slab = await ArchDiscKernel.brep.thicken(w, h, t);
                return renderShape(slab);
            },
            renderOffsetShape: async (boxSize, offset) => {
                const box = await ArchDiscKernel.brep.makeBox(boxSize, boxSize, boxSize);
                const offsetted = await ArchDiscKernel.brep.offsetShape(box, offset);
                box.dispose();
                return renderShape(offsetted);
            },
            renderDraft: async (boxSize, angleDeg) => {
                const box = await ArchDiscKernel.brep.makeBox(boxSize, boxSize, boxSize);
                const drafted = await ArchDiscKernel.brep.draft(box, angleDeg);
                box.dispose();
                return renderShape(drafted);
            },
            renderSweep: async (r, len) => {
                const pipe = await ArchDiscKernel.brep.sweep(r, len);
                return renderShape(pipe);
            },
            renderLoft: async (bottomSize, topSize, height) => {
                const lofted = await ArchDiscKernel.brep.loft(bottomSize, topSize, height);
                return renderShape(lofted);
            },
            renderVariableFillet: async (boxSize, r1, r2) => {
                const box = await ArchDiscKernel.brep.makeBox(boxSize, boxSize, boxSize);
                const filleted = await ArchDiscKernel.brep.variableFillet(box, r1, r2);
                box.dispose();
                return renderShape(filleted);
            },
            renderBoolFuse: async (size) => {
                const a = await ArchDiscKernel.brep.makeBox(size, size, size);
                const b = await ArchDiscKernel.brep.makeBox(size, size, size);
                const result = await ArchDiscKernel.brep.fuse(a, b);
                a.dispose(); b.dispose();
                return renderShape(result);
            },
            renderBoolCommon: async (size) => {
                const a = await ArchDiscKernel.brep.makeBox(size, size, size);
                const b = await ArchDiscKernel.brep.makeBox(size, size, size);
                const result = await ArchDiscKernel.brep.common(a, b);
                a.dispose(); b.dispose();
                return renderShape(result);
            },
            renderBoolCut: async (blockSize, cylR, cylH) => {
                const block = await ArchDiscKernel.brep.makeBox(blockSize, blockSize, blockSize);
                const drill = await ArchDiscKernel.brep.makeCylinder(cylR, cylH);
                const result = await ArchDiscKernel.brep.cut(block, drill);
                block.dispose(); drill.dispose();
                return renderShape(result);
            },
        };
        return () => { delete window.__archdiscKernel; };
    }, [viewport]);

    // Expose Loop subdivision utilities so headed Electron e2e recon specs
    // can run loopSubdivide/loopStep against tessellated B-rep meshes without
    // bundling the module separately. Mirror pattern: __archdiscKernel above.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__archdiscSubdiv = { loopSubdivide, loopStep, weldMesh };
        return () => { delete window.__archdiscSubdiv; };
    }, []);

    // SP-1 — expose the unified topology spine so headed Electron e2e specs
    // (spine-recon / spine-scaffold / spine-bind) can call bindSpine +
    // validateSpine and construct spine entities directly inside win.evaluate,
    // without bundling kernel/topology separately. Additive — no behaviour
    // change; mirror pattern: __archdiscKernel / __archdiscSubdiv above.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__archdiscSpine = {
            bindSpine, bindSpineFromShape, validateSpine,
            classes: {
                Body: SpineBodyClass, Lump, Shell, Face, Loop, Coedge, Edge,
                Vertex, IdAllocator, SpineBody,
            },
        };
        return () => { delete window.__archdiscSpine; };
    }, []);

    // SP-1 S3 — expose the canonical scene-add path so e2e specs that build
    // a body via direct ArchDiscKernel.brep.* calls (rather than via a ribbon
    // tool) can still register and render their result through the same
    // pipeline a ribbon tool uses (brepToMesh + Group + BodyRegistry +
    // window.__last* mirroring). Without this hook a programmatically-built
    // SpineBody never reaches the scene — the spec sees a populated registry
    // but no mesh. Additive; mirrors the pattern of the slots above.
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__archdiscAddBrepShape = addBrepShapeToScene;
        return () => { delete window.__archdiscAddBrepShape; };
    }, []);

    // Get selected model from context
    const selectedModel = viewport?.models?.find(m => m.id === viewport?.selectedModelId) || null;

    // UX Tier-10c re-edit loop — when the user picks "Edit Feature" in
    // the Design History context menu, DesignHistoryPanel fires
    // `archdisc:dh-edit-feature` with the entry. We seed the planParams
    // slot from the entry's stored values + __expressions, then re-run
    // the original tool — which makes ToolParamDialog re-open with the
    // ORIGINAL `=expr` strings (Tier 10c persisted them on the entry).
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const onEditFeature = async (ev) => {
            const entry = ev?.detail?.entry;
            if (!entry || !entry.tool) return;
            // Build a planParams slot equivalent — values literal + the
            // expression sidecar. ToolParamDialog's plan-params branch
            // (Tier 10c re-edit overlay) folds the expressions back as
            // `=expr` strings so the dialog re-renders the parametric
            // source the user originally typed.
            window.__archdiscPlanParams = window.__archdiscPlanParams || {};
            window.__archdiscPlanParams[entry.tool] = {
                ...(entry.values || {}),
                ...(entry.expressions ? { __expressions: { ...entry.expressions } } : {}),
            };
            // Re-dispatch the tool through the standard handler so every
            // side-effect (selection, scene update, DH log) runs again.
            try {
                await handleToolExecute(entry.tab || 'part', entry.tool);
            } catch (err) {
                console.warn('[archdisc] dh-edit-feature re-dispatch failed', err);
            }
        };
        window.addEventListener('archdisc:dh-edit-feature', onEditFeature);
        return () => window.removeEventListener('archdisc:dh-edit-feature', onEditFeature);
    }, [handleToolExecute]);

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

    // Keyboard shortcuts — SW/NX-style accelerators for the most-used
    // tools. Each entry: { key, ctrl?, alt?, shift?, action, tool, group }.
    // CAD users live by these — every real CAD app ships them.
    //
    // Rules:
    //  - Skip when typing in an INPUT/TEXTAREA (existing guard below).
    //  - Skip when a dialog is open (we check window.__archdiscDialogOpen
    //    which the ToolParamDialog sets when it's mounted).
    //  - Skip when contenteditable element is focused (Equation Manager).
    //  - Bare letters → tool launch. Modifier combos reserved for the
    //    browser / Electron menu (Ctrl+S etc).
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        const handleKey = (e) => {
            const tag = e.target?.tagName;
            if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
            if (e.target?.isContentEditable) return;
            // Dialog open? skip (so dialog inputs handle their own keys).
            if (window.__archdiscDialogOpen) return;
            // Existing select/move/escape stays.
            if (!e.ctrlKey && !e.metaKey && !e.altKey) {
                if (e.key === 'v' || e.key === 'V') { handleSelectMode(); return; }
                if (e.key === 'g' || e.key === 'G') { handleMoveMode(); return; }
                // SW-style tool shortcuts. Lower-case test only (so
                // upper-case via shift is consumed by selection naming
                // wherever the host needs it).
                const k = e.key;
                // E = Extrude (the Tier-11d unified Extrude tool)
                if (k === 'e' || k === 'E') {
                    e.preventDefault();
                    handleToolExecute('part', 'Extrude');
                    return;
                }
                // F = Fillet
                if (k === 'f' || k === 'F') {
                    e.preventDefault();
                    handleToolExecute('part', 'Fillet');
                    return;
                }
                // C = Chamfer
                if (k === 'c' || k === 'C') {
                    e.preventDefault();
                    handleToolExecute('part', 'Chamfer');
                    return;
                }
                // S = Sketch (start new sketch)
                if (k === 's' || k === 'S') {
                    e.preventDefault();
                    handleToolExecute('sketch', 'Start Sketch');
                    return;
                }
                // L = Line (in sketch mode)
                if (k === 'l' || k === 'L') {
                    e.preventDefault();
                    handleToolExecute('sketch', 'Line');
                    return;
                }
                // R = Rectangle (in sketch mode)
                if (k === 'r' || k === 'R') {
                    e.preventDefault();
                    handleToolExecute('sketch', 'Rectangle');
                    return;
                }
                // D = Smart Dimension
                if (k === 'd' || k === 'D') {
                    e.preventDefault();
                    handleToolExecute('sketch', 'Smart Dimension');
                    return;
                }
                // M = Measure
                if (k === 'm' || k === 'M') {
                    e.preventDefault();
                    handleToolExecute('measure', 'Distance');
                    return;
                }
                // Space = Zoom-to-Fit (canonical CAD view-fit shortcut)
                if (k === ' ' || k === 'Spacebar') {
                    e.preventDefault();
                    if (viewport?.focusOnAll) viewport.focusOnAll();
                    else if (typeof window.__archdiscFocusOnAll === 'function') window.__archdiscFocusOnAll();
                    return;
                }
                // ? = Toggle keyboard-shortcut help overlay (SW/NX convention)
                if (k === '?' || (k === '/' && e.shiftKey)) {
                    e.preventDefault();
                    setHelpOverlayOpen((prev) => !prev);
                    return;
                }
            }
            // Ctrl/Cmd + S = Save Snapshot (overrides browser's Save Page)
            if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
                e.preventDefault();
                handleToolExecute('document', 'Save Snapshot');
                return;
            }
            // Ctrl/Cmd + Z = Undo (one step back through the kernel
            // HistoryLog from SP-3a). Ctrl/Cmd + Y or Ctrl+Shift+Z = Redo.
            // The kernel HistoryLog tracks geometric ops; the rollback
            // bar (UX Tier-1 #10) drives the same API on click/drag —
            // these shortcuts just give the user keyboard parity.
            if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
                e.preventDefault();
                try {
                    const h = window.__archdiscKernelHistory;
                    if (!h) return;
                    if (h.cursor <= 0) {
                        // Already at baseline (no entries yet) — no-op.
                        return;
                    }
                    const prev = h.cursor === 0 ? '__baseline' : h.entries[h.cursor - 1];
                    h.rollBackTo(prev);
                } catch (err) {
                    console.warn('[archdisc] undo failed', err);
                }
                return;
            }
            if (
                (e.ctrlKey || e.metaKey) && (
                    (e.key === 'y' || e.key === 'Y') ||
                    (e.shiftKey && (e.key === 'z' || e.key === 'Z'))
                )
            ) {
                e.preventDefault();
                try {
                    const h = window.__archdiscKernelHistory;
                    if (!h) return;
                    if (h.cursor >= h.entries.length - 1) return;  // at tail
                    h.rollForwardTo(h.entries[h.cursor + 1]);
                } catch (err) {
                    console.warn('[archdisc] redo failed', err);
                }
                return;
            }
            if (e.key === 'Escape') {
                if (helpOverlayOpen) { setHelpOverlayOpen(false); return; }
                setActiveDropdown(null); setActiveTool(null); setToolStatus(null); setSelection(null);
            }
        };
        window.addEventListener('keydown', handleKey);
        return () => window.removeEventListener('keydown', handleKey);
    }, [handleSelectMode, handleMoveMode, handleToolExecute, viewport]);

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

            {/* LEFT TOOLBAR - Icon buttons only, dropdown rendered outside.
                The collapse toggle lets the user fold the toolbar to a thin
                sliver; the viewport canvas size stays the same because the
                toolbar's reserved gutter (--toolbar-width) is fixed at the
                stage level. */}
            <aside
                className={'workbench-tools' + (toolsCollapsed ? ' workbench-tools-collapsed' : '')}
                data-archdisc-tools-collapsed={toolsCollapsed ? 'true' : 'false'}
            >
                <button
                    className="workbench-drawer-toggle"
                    title={toolsCollapsed ? 'Expand tool palette' : 'Collapse tool palette'}
                    aria-label={toolsCollapsed ? 'Expand tool palette' : 'Collapse tool palette'}
                    aria-expanded={!toolsCollapsed}
                    data-archdisc-tools-toggle={toolsCollapsed ? 'collapsed' : 'expanded'}
                    onClick={toggleToolsCollapsed}
                >
                    {toolsCollapsed ? <ChevronRight size={11} /> : <ChevronLeft size={11} />}
                </button>
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

                    {/* UX cleanup (2026-05-24): the 11 category-dropdown
                        launchers that used to live here (Sketch / Part /
                        Reference / Direct Edit / Surface / Assembly /
                        Sheet Metal / Weldments / Piping / Simulate /
                        Manufacture) were REMOVED. Nine of them duplicated
                        the top-ribbon tabs verbatim, so opening the same
                        production tool gave the user two equally-valid
                        paths through different chrome. The left palette
                        is now scoped to viewport-interaction tools only,
                        per the user feedback "old UI behind the newer
                        ones you can see behind the one in viewport".

                        TOOL_GROUPS itself is kept in the file (used by
                        renderDropdown) because two of the eleven groups
                        (Reference geometry + Piping/Routing) do NOT yet
                        have a ribbon home. They're a queued promotion to
                        ribbon-level tabs in a future dispatch; until
                        then they live ONLY in the AI Console / Command
                        Palette / direct-API paths and don't need a
                        palette button. Resurrecting any of them is one
                        button-render line away. */}

                    {/* Settings — viewport interaction (workspace toggles). */}
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

                {/* Active-tool indicator removed (UX cleanup 2026-05-24).
                    The canonical SW location for the active-tool name is
                    the green-check ConfirmationCorner at top-right, which
                    already shows `active.tool` (see SwUxOverlays.jsx). The
                    earlier `active-tool-indicator` pill at top-centre
                    duplicated that label and crowded the viewport corner
                    with two overlays of the same data. */}

                {/* Thought Bubble — component info on selection (temporarily disabled, see SHOW_THOUGHT_BUBBLE) */}
                {selection && SHOW_THOUGHT_BUBBLE && <ThoughtBubble selection={selection} viewport={viewport} onClose={() => setSelection(null)} />}

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

                {/* ─── Tier-1 SolidWorks UX overlays ──────────────────── */}
                {/* Heads-up View Toolbar (top-centre): Zoom/Section/View/Display */}
                <HeadsUpViewToolbar />
                {/* Confirmation Corner (top-right): green-check / red-X */}
                <ConfirmationCorner />
                {/* PropertyManager Dock (left): docked param dialog for migrated tools */}
                <PropertyManagerDock />
                {/* Sketch State Badge (bottom-left): UNDER/FULL/OVER-DEFINED */}
                <SketchStateBadge />
                {/* Tier-11a NX-distinctive: Selection-priority pre-filter (top-left) */}
                <SelectionPriorityBar />
            </main>

            {/* RIGHT PROPERTIES PANEL — collapse toggle on the inner edge.
                Collapsing the panel slides its contents off-screen behind
                the gutter edge; the viewport stays the same size because
                the gutter (--properties-width) is reserved at the stage
                level. */}
            <aside
                className={'workbench-properties' + (propsCollapsed ? ' workbench-properties-collapsed' : '')}
                data-archdisc-properties-collapsed={propsCollapsed ? 'true' : 'false'}
            >
                <button
                    className="workbench-drawer-toggle"
                    title={propsCollapsed ? 'Expand properties panel' : 'Collapse properties panel'}
                    aria-label={propsCollapsed ? 'Expand properties panel' : 'Collapse properties panel'}
                    aria-expanded={!propsCollapsed}
                    data-archdisc-properties-toggle={propsCollapsed ? 'collapsed' : 'expanded'}
                    onClick={togglePropsCollapsed}
                >
                    {propsCollapsed ? <ChevronLeft size={11} /> : <ChevronRight size={11} />}
                </button>
                {/* Design history — every foundation tool run appears here */}
                <DesignHistoryPanel />

                {/* Part browser — every foundation body in the scene */}
                <PartBrowserPanel />

                {/* SP-1 S7 Topology Inspector — surfaces the unified spine
                    Body→Lump→Shell→Face→Loop→Coedge→Edge→Vertex for the
                    selected body, with per-entity readout + drill-down. */}
                <TopologyInspector />

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

            {/* Keyboard shortcuts help overlay — press '?' to toggle. */}
            {helpOverlayOpen && (
                <div
                    style={{
                        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
                        zIndex: 60, display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    onClick={() => setHelpOverlayOpen(false)}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: 'rgba(20,24,32,0.96)', border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: 8, padding: '20px 24px', minWidth: 460, maxWidth: 560,
                            boxShadow: '0 18px 60px rgba(0,0,0,0.45)', color: '#e5e7eb',
                            fontFamily: 'system-ui, -apple-system, sans-serif',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 12 }}>
                            <div style={{ fontSize: 15, fontWeight: 600 }}>Keyboard shortcuts</div>
                            <button
                                onClick={() => setHelpOverlayOpen(false)}
                                style={{
                                    background: 'transparent', border: 'none', color: '#9ca3af',
                                    cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: 0,
                                }}
                                aria-label="Close help"
                            >×</button>
                        </div>
                        <table style={{ width: '100%', fontSize: 13, borderCollapse: 'collapse' }}>
                            <tbody>
                                {[
                                    ['S', 'Start Sketch'],
                                    ['L', 'Line (in sketch)'],
                                    ['R', 'Rectangle (in sketch)'],
                                    ['D', 'Smart Dimension'],
                                    ['E', 'Extrude (unified, with Boolean enum)'],
                                    ['F', 'Fillet'],
                                    ['C', 'Chamfer'],
                                    ['M', 'Measure → Distance'],
                                    ['Space', 'Zoom-to-Fit'],
                                    ['V', 'Select mode'],
                                    ['G', 'Move mode'],
                                    ['?', 'Toggle this help'],
                                    ['Esc', 'Cancel active tool / close menus'],
                                ].map(([k, label]) => (
                                    <tr key={k}>
                                        <td style={{ padding: '5px 12px 5px 0', width: 80 }}>
                                            <kbd style={{
                                                background: 'rgba(255,255,255,0.08)',
                                                border: '1px solid rgba(255,255,255,0.15)',
                                                borderRadius: 4, padding: '2px 8px',
                                                fontFamily: 'monospace', fontSize: 12, color: '#e5e7eb',
                                            }}>{k}</kbd>
                                        </td>
                                        <td style={{ padding: '5px 0', color: '#cbd5e1' }}>{label}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                        <div style={{ marginTop: 14, fontSize: 11, color: '#6b7280' }}>
                            Modifier combos (Ctrl/Alt/Cmd) are reserved for the browser/Electron menus.
                            Shortcuts skip when a dialog is open or a text field is focused.
                        </div>
                    </div>
                </div>
            )}

            {/* AI dialogs — both still mountable but the second floating
                launcher was removed (UX cleanup 2026-05-24). The chat
                panel's header now carries a "Settings" link that opens
                AISettingsPanel, so there's exactly ONE canonical AI button
                in the workspace (the chat-launcher at the bottom-right).
                The standalone .ai-settings-launcher "AI" pill that used
                to sit just below it has been deleted. */}
            <AISettingsPanel open={aiSettingsOpen} onClose={() => setAISettingsOpen(false)} />

            {/* AI Chat front-door — Clarifier + Planner + Executor in one panel.
                This is the SINGLE canonical AI entry point in the workspace. */}
            <button className="chat-launcher"
                    onClick={() => setAIChatOpen(true)}
                    title="AI Chat (Clarifier + Planner + Run) — Settings reachable from the chat panel header"
                    data-action="open-chat"
                    data-ai-launcher="canonical">
              💬
            </button>
            <AIChatPanel
              open={aiChatOpen}
              onClose={() => setAIChatOpen(false)}
              onOpenSettings={() => setAISettingsOpen(true)}
            />

            {/* Drawing preview overlay — pops when Standard 3 View runs */}
            <DrawingPreviewPanel />

            {/* Section preview overlay — pops when Section View runs */}
            <SectionPreviewPanel />

            {/* Slicer preview overlay — pops when Slice Preview runs */}
            <SlicerPreviewPanel />

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
