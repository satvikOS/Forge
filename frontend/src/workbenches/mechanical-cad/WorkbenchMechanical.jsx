import React, { useState, useRef, useEffect, useCallback } from 'react';
import Viewport3D from '../../components/Viewport3D';
import ViewCube from '../../components/ViewCube';
import {
    MousePointer, Move, Pencil, Box, Layers, Copy, Link2,
    Settings, BarChart3, Waves, Wrench, FileText, RotateCcw,
    ChevronRight
} from 'lucide-react';
import './WorkbenchMechanical.css';

/**
 * Mechanical CAD Workbench - Professional Layout
 * Condensed toolbar with 8 smart groups, SolidWorks/CATIA/NX feature parity
 */

// ─── Tool Definitions ───────────────────────────────────────────────────────
const TOOL_GROUPS = {
    sketch: {
        icon: Pencil,
        label: 'Sketch',
        sections: [
            { header: 'Draw', items: ['Line', 'Circle', 'Arc', 'Rectangle', 'Polygon', 'Spline', 'Slot', 'Ellipse'] },
            { header: 'Modify', items: ['Trim', 'Extend', 'Offset', 'Fillet Sketch', 'Chamfer Sketch'] },
            { header: 'Constrain', items: ['Dimension', 'Coincident', 'Parallel', 'Perpendicular', 'Tangent', 'Equal', 'Fix', 'Symmetric'] },
        ]
    },
    part: {
        icon: Box,
        label: 'Part',
        sections: [
            { header: 'Create', items: ['Extrude', 'Revolve', 'Sweep', 'Loft', 'Rib', 'Coil'] },
            { header: 'Modify', items: ['Fillet', 'Chamfer', 'Shell', 'Draft', 'Hole Wizard', 'Thread'] },
            { header: 'Boolean', items: ['Combine', 'Intersect', 'Subtract', 'Split'] },
            { header: 'Pattern', items: ['Linear Pattern', 'Circular Pattern', 'Mirror', 'Pattern Along Curve'] },
        ]
    },
    surface: {
        icon: Waves,
        label: 'Surface',
        sections: [
            { header: 'Create', items: ['Loft Surface', 'Sweep Surface', 'Boundary Surface', 'Ruled Surface', 'Fill Surface', 'Offset Surface'] },
            { header: 'Modify', items: ['Trim Surface', 'Extend Surface', 'Blend Surface', 'Thicken', 'Knit Surface'] },
            { header: 'Analysis', items: ['Curvature Analysis', 'Zebra Stripes', 'Draft Analysis', 'Deviation Analysis'] },
        ]
    },
    assembly: {
        icon: Link2,
        label: 'Assembly',
        sections: [
            { header: 'Components', items: ['Insert Component', 'New Component', 'Replace Component', 'Component Pattern'] },
            { header: 'Mates', items: ['Coincident', 'Distance', 'Angle', 'Tangent', 'Concentric', 'Lock', 'Gear', 'Cam'] },
            { header: 'Tools', items: ['Exploded View', 'Motion Study', 'Interference Detection', 'Smart Fasteners', 'Clearance Check'] },
        ]
    },
    sheetmetal: {
        icon: Layers,
        label: 'Sheet Metal',
        sections: [
            { header: 'Create', items: ['Base Flange', 'Edge Flange', 'Miter Flange', 'Contour Flange', 'Hem', 'Tab'] },
            { header: 'Modify', items: ['Fold', 'Unfold', 'Corner Relief', 'Rip', 'Jog', 'Dimple'] },
            { header: 'Output', items: ['Flat Pattern', 'Export DXF', 'Bend Table', 'K-Factor'] },
        ]
    },
    simulation: {
        icon: BarChart3,
        label: 'Simulate',
        sections: [
            { header: 'Structural', items: ['Linear Static FEA', 'Nonlinear FEA', 'Modal Analysis', 'Buckling', 'Fatigue'] },
            { header: 'Thermal / Flow', items: ['Steady-State Thermal', 'Transient Thermal', 'CFD Flow', 'Conjugate Heat'] },
            { header: 'Motion', items: ['Kinematic', 'Dynamic Motion', 'Export Motion Loads'] },
            { header: 'Optimization', items: ['Topology Optimization', 'Generative Design', 'Lattice Structures', 'Design Study'] },
        ]
    },
    manufacturing: {
        icon: Wrench,
        label: 'Manufacture',
        sections: [
            { header: 'CNC', items: ['2.5-Axis Milling', '3-Axis Milling', '5-Axis Milling', 'Turning', 'Adaptive Clearing'] },
            { header: 'Post', items: ['Generate G-Code', 'Simulate Toolpath', 'Estimate Cycle Time'] },
            { header: 'Mold / Cast', items: ['Draft Analysis', 'Parting Line', 'Core & Cavity', 'Cooling Channels', 'Ejector Pins'] },
            { header: 'Additive', items: ['Optimize Orientation', 'Generate Supports', 'Nest Parts', 'Export STL'] },
            { header: 'Other', items: ['Fixtures', 'Cost Estimation', 'DFM Check'] },
        ]
    },
    documentation: {
        icon: FileText,
        label: 'Document',
        sections: [
            { header: 'Drawings', items: ['New Drawing', 'Add View', 'Section View', 'Detail View', 'Break View'] },
            { header: 'Annotation', items: ['Dimension', 'Note', 'Surface Finish', 'Weld Symbol', 'Datum', 'GD&T Frame'] },
            { header: 'Data', items: ['Generate BOM', 'Export BOM', 'Revision History', 'Compare Revisions'] },
            { header: 'Output', items: ['Export PDF', 'Export STEP', 'Export IGES', 'Export Parasolid'] },
        ]
    },
};

function WorkbenchMechanical() {
    const [activeDropdown, setActiveDropdown] = useState(null);
    const [contextMenu, setContextMenu] = useState(null);
    const [dropdownStyle, setDropdownStyle] = useState({});
    const [viewportRef, setViewportRef] = useState(null);
    const dropdownRef = useRef(null);
    const buttonRefs = useRef({});

    // Smart dropdown positioning
    const calculateDropdownPosition = useCallback((buttonElement) => {
        if (!buttonElement) return {};

        const rect = buttonElement.getBoundingClientRect();
        const vh = window.innerHeight;
        const vw = window.innerWidth;
        const dropdownH = 400;
        const dropdownW = 240;

        let style = { position: 'fixed', zIndex: 9999 };

        // Horizontal: right of button, or left if no room
        if (rect.right + dropdownW + 8 < vw) {
            style.left = rect.right + 4;
        } else {
            style.left = rect.left - dropdownW - 4;
        }

        // Vertical: align with button, adjust for overflow
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

    // Close dropdown on outside click
    useEffect(() => {
        if (!activeDropdown) return;
        const handleClick = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setActiveDropdown(null);
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

    // Render a dropdown menu for a tool group
    const renderDropdown = (groupKey) => {
        const group = TOOL_GROUPS[groupKey];
        if (activeDropdown !== groupKey) return null;

        return (
            <div
                className="tool-dropdown smart-positioned"
                style={dropdownStyle}
                ref={dropdownRef}
            >
                {group.sections.map((section, si) => (
                    <React.Fragment key={si}>
                        {si > 0 && <div className="dropdown-divider" />}
                        <div className="dropdown-header">{section.header}</div>
                        {section.items.map(item => (
                            <div
                                key={item}
                                className="dropdown-item"
                                onClick={() => {
                                    console.log(`${groupKey}:${item}`);
                                    setActiveDropdown(null);
                                }}
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
            {/* LEFT TOOLBAR */}
            <aside className="workbench-tools" onClick={() => setActiveDropdown(null)}>
                <div className="workbench-tools-inner">
                    {/* Pointer tools */}
                    <button className="tool-icon-button" title="Select (V)">
                        <MousePointer size={18} />
                    </button>
                    <button className="tool-icon-button" title="Move (G)">
                        <Move size={18} />
                    </button>

                    <div className="tool-separator" />

                    {/* Main tool groups */}
                    {Object.entries(TOOL_GROUPS).map(([key, group]) => {
                        const Icon = group.icon;
                        return (
                            <div className="tool-dropdown-container" key={key}>
                                <button
                                    ref={el => buttonRefs.current[key] = el}
                                    className={`tool-icon-button ${activeDropdown === key ? 'active' : ''}`}
                                    title={group.label}
                                    onClick={(e) => { e.stopPropagation(); toggleDropdown(key); }}
                                >
                                    <Icon size={18} />
                                    <ChevronRight size={8} className="tool-expand-indicator" />
                                </button>
                                {renderDropdown(key)}
                            </div>
                        );
                    })}

                    <div className="tool-separator" />

                    {/* Settings */}
                    <button className="tool-icon-button" title="Settings">
                        <Settings size={18} />
                    </button>
                </div>
            </aside>

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
                />

                {/* ViewCube - syncs with main camera */}
                {viewportRef && (
                    <ViewCube
                        camera={viewportRef.camera}
                        controls={viewportRef.controls}
                    />
                )}
            </main>

            {/* RIGHT PROPERTIES PANEL */}
            <aside className="workbench-properties">
                <div className="property-section">
                    <h3 className="property-header">Transform</h3>
                    <div className="property-row">
                        <span className="property-label">X</span>
                        <input type="number" className="property-input" placeholder="0.00" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Y</span>
                        <input type="number" className="property-input" placeholder="0.00" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Z</span>
                        <input type="number" className="property-input" placeholder="0.00" />
                    </div>
                </div>

                <div className="property-section">
                    <h3 className="property-header">Feature</h3>
                    <div className="property-row">
                        <span className="property-label">Distance</span>
                        <input type="number" className="property-input" placeholder="10.0" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Draft</span>
                        <input type="number" className="property-input" placeholder="0.0" />
                    </div>
                    <div className="property-row">
                        <span className="property-label">Radius</span>
                        <input type="number" className="property-input" placeholder="2.0" />
                    </div>
                </div>

                <div className="property-section">
                    <h3 className="property-header">Material</h3>
                    <select className="property-input">
                        <option>Aluminum 6061-T6</option>
                        <option>Steel AISI 1045</option>
                        <option>Stainless 304</option>
                        <option>Ti-6Al-4V</option>
                        <option>ABS Plastic</option>
                        <option>Nylon PA6</option>
                        <option>Copper C11000</option>
                        <option>Inconel 718</option>
                    </select>
                </div>

                <div className="property-section">
                    <h3 className="property-header">Quick Actions</h3>
                    <button className="property-button">Run FEA</button>
                    <button className="property-button">Generate Toolpath</button>
                    <button className="property-button">Export STEP</button>
                    <button className="property-button">Export STL</button>
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
                    <div className="context-menu-divider" />
                    <div className="context-menu-item">New Sketch</div>
                    <div className="context-menu-item">Measure</div>
                    <div className="context-menu-item">Select Bodies</div>
                </div>
            )}
        </>
    );
}

export default WorkbenchMechanical;
