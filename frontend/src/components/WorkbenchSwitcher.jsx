import React, { useState } from 'react';
import './styles/workbench-switcher.css';

/**
 * Workbench Switcher Component
 * Toggle between different domain-specific workbenches
 */
function WorkbenchSwitcher({ activeWorkbench, onSwitchWorkbench }) {
    const [isExpanded, setIsExpanded] = useState(false);

    const workbenches = [
        {
            id: 'mechanical-cad',
            name: 'Mechanical CAD',
            icon: '⚙️',
            description: 'Parametric modeling, assemblies, precision constraints'
        },
        {
            id: 'architecture-bim',
            name: 'Architecture & BIM',
            icon: '🏛️',
            description: 'Building design, IFC, code compliance'
        },
        {
            id: 'gaming-vfx',
            name: 'Gaming & VFX',
            icon: '🎮',
            description: 'Polygon modeling, rigging, particle systems'
        },
        {
            id: 'automotive',
            name: 'Automotive',
            icon: '🚗',
            description: 'Vehicle design, aerodynamics'
        },
        {
            id: 'industrial',
            name: 'Industrial',
            icon: '🏭',
            description: 'Machinery, factory layouts'
        },
        {
            id: 'electronics',
            name: 'Electronics',
            icon: '⚡',
            description: 'PCB design, circuit simulation'
        }
    ];

    const currentWorkbench = workbenches.find(w => w.id === activeWorkbench);

    return (
        <div className="workbench-switcher">
            <button
                className="workbench-current"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                <span className="workbench-icon">{currentWorkbench?.icon}</span>
                <span className="workbench-name">{currentWorkbench?.name}</span>
                <span className="expand-arrow">{isExpanded ? '▲' : '▼'}</span>
            </button>

            {isExpanded && (
                <div className="workbench-dropdown">
                    {workbenches.map(wb => (
                        <button
                            key={wb.id}
                            className={`workbench-option ${wb.id === activeWorkbench ? 'active' : ''}`}
                            onClick={() => {
                                onSwitchWorkbench(wb.id);
                                setIsExpanded(false);
                            }}
                        >
                            <div className="workbench-option-header">
                                <span className="workbench-icon">{wb.icon}</span>
                                <span className="workbench-name">{wb.name}</span>
                            </div>
                            <p className="workbench-description">{wb.description}</p>
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}

export default WorkbenchSwitcher;
