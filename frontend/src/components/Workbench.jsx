import React, { useState } from 'react';
import WorkbenchSwitcher from './WorkbenchSwitcher';
import WorkbenchMechanical from '../workbenches/mechanical-cad/WorkbenchMechanical';
import WorkbenchArchitecture from '../workbenches/architecture-bim/WorkbenchArchitecture';
import WorkbenchGaming from '../workbenches/gaming-vfx/WorkbenchGaming';
import WorkbenchAutomotive from '../workbenches/automotive/WorkbenchAutomotive';
import WorkbenchIndustrial from '../workbenches/industrial/WorkbenchIndustrial';
import WorkbenchElectronics from '../workbenches/electronics/WorkbenchElectronics';
import WorkbenchAviation from '../workbenches/aviation/WorkbenchAviation';
import WorkbenchUIProduct from '../workbenches/ui-product/WorkbenchUIProduct';
import AIConsole from './AIConsole';
import '../styles/workbench.css';

/**
 * Main Workbench Container - Blender-Style Layout
 * Grid: Header | Toolbar-Viewport-Properties | Footer
 */
function WorkbenchContainer() {
    const [activeWorkbench, setActiveWorkbench] = useState('mechanical-cad');
    const [prompt, setPrompt] = useState('');

    const handleGenerate = async () => {
        if (!prompt.trim()) return;

        try {
            const response = await fetch('/api/generate/design', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ prompt, workbench: activeWorkbench })
            });
            const data = await response.json();
            console.log('Generated:', data);
        } catch (error) {
            console.error('Error:', error);
        }
    };

    const renderWorkbench = () => {
        switch (activeWorkbench) {
            case 'mechanical-cad': return <WorkbenchMechanical />;
            case 'architecture-bim': return <WorkbenchArchitecture />;
            case 'gaming-vfx': return <WorkbenchGaming />;
            case 'automotive': return <WorkbenchAutomotive />;
            case 'industrial': return <WorkbenchIndustrial />;
            case 'electronics': return <WorkbenchElectronics />;
            case 'aviation': return <WorkbenchAviation />;
            case 'ui-product': return <WorkbenchUIProduct />;
            default: return null;
        }
    };

    const renderToolbar = () => {
        const toolbars = {
            'mechanical-cad': ['Sketch', 'Extrude', 'Revolve', 'Fillet', 'Pattern'],
            'architecture-bim': ['Wall', 'Door', 'Window', 'Level', 'Room'],
            'gaming-vfx': ['Model', 'Texture', 'Rig', 'Animate', 'Render'],
            'automotive': ['Surface', 'Curve', 'Blend', 'Aerodynamics', 'Chassis'],
            'industrial': ['Layout', 'Conveyor', 'Robot', 'Simulate', 'Optimize'],
            'electronics': ['Component', 'Trace', 'Route', 'Simulate', 'Export'],
            'aviation': ['Airfoil', 'Wing', 'Fuselage', 'Analysis', 'CFD'],
            'ui-product': ['Frame', 'Component', 'Text', 'Export', 'Preview']
        };

        const tools = toolbars[activeWorkbench] || [];
        return tools.map(tool => (
            <button key={tool} className="toolbar-button">{tool}</button>
        ));
    };

    return (
        <div className="workbench-container">
            {/* TOP HEADER */}
            <header className="workbench-header">
                <h1 className="workbench-title">ArchDisc</h1>
                <WorkbenchSwitcher
                    activeWorkbench={activeWorkbench}
                    onSwitchWorkbench={setActiveWorkbench}
                />
                <div className="workbench-toolbar">
                    {renderToolbar()}
                </div>
                <div className="header-actions">
                    <button className="header-button">File</button>
                    <button className="header-button">Edit</button>
                    <button className="header-button">View</button>
                </div>
            </header>

            {/* WORKBENCH CONTENT (Toolbar + Viewport + Properties) */}
            {renderWorkbench()}

            {/* BOTTOM FOOTER - AI CONSOLE (Chat/Code Terminal) */}
            <AIConsole />
        </div>
    );
}

export default WorkbenchContainer;
