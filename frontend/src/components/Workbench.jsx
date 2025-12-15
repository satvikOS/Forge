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
import '../styles/workbench.css';
import '../styles/workbench-switcher.css';
import '../styles/workbench-toolbar.css';

/**
 * Main Workbench Container
 * Manages workbench switching and shared layout
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
                body: JSON.stringify({
                    prompt,
                    workbench: activeWorkbench
                })
            });

            const data = await response.json();
            console.log('Generated design:', data);
        } catch (error) {
            console.error('Generation error:', error);
        }
    };

    const renderWorkbench = () => {
        switch (activeWorkbench) {
            case 'mechanical-cad':
                return <WorkbenchMechanical onGenerate={handleGenerate} />;
            case 'architecture-bim':
                return <WorkbenchArchitecture onGenerate={handleGenerate} />;
            case 'gaming-vfx':
                return <WorkbenchGaming onGenerate={handleGenerate} />;
            case 'automotive':
                return <WorkbenchAutomotive onGenerate={handleGenerate} />;
            case 'industrial':
                return <WorkbenchIndustrial onGenerate={handleGenerate} />;
            case 'electronics':
                return <WorkbenchElectronics onGenerate={handleGenerate} />;
            case 'aviation':
                return <WorkbenchAviation onGenerate={handleGenerate} />;
            case 'ui-product':
                return <WorkbenchUIProduct onGenerate={handleGenerate} />;
            default:
                return <div className="workbench-placeholder">Workbench coming soon...</div>;
        }
    };

    const renderToolbar = () => {
        <>
            <button className="toolbar-button">Tool 1</button>
            <button className="toolbar-button">Tool 2</button>
        </>
        );
};

return (
    <div className="workbench-container">
        {/* Header with Workbench Switcher */}
        <header className="workbench-header">
            <h1 className="workbench-title">ArchDisc</h1>
            <WorkbenchSwitcher
                activeWorkbench={activeWorkbench}
                onSwitchWorkbench={setActiveWorkbench}
            />

            {/* Workbench-Specific Toolbar */}
            <div className="workbench-toolbar">
                {renderToolbar()}
            </div>

            <div className="header-actions">
                <button className="header-button">File</button>
                <button className="header-button">Edit</button>
                <button className="header-button">View</button>
            </div>
        </header>

        {/* Active Workbench */}
        {renderWorkbench()}

        {/* Bottom Console - Shared across all workbenches */}
        <footer className="workbench-console">
            <div className="console-tabs">
                <button className="console-tab active">AI Prompt</button>
                <button className="console-tab">Console</button>
                <button className="console-tab">History</button>
            </div>

            <div className="prompt-input-container">
                <textarea
                    className="prompt-input"
                    placeholder={`Describe your ${activeWorkbench.replace('-', ' ')} design...`}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={3}
                />
                <button className="generate-button" onClick={handleGenerate}>
                    Generate
                </button>
            </div>
        </footer>
    </div>
);
}

export default WorkbenchContainer;
