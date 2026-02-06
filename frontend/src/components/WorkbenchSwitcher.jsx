import React, { useState, useRef, useEffect } from 'react';
import '../styles/workbench-switcher.css';

/**
 * Workbench Switcher Component
 * Toggle between domain-specific workbenches with improved dropdown
 */
function WorkbenchSwitcher({ activeWorkbench, onSwitchWorkbench }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const dropdownRef = useRef(null);

    const workbenches = [
        {
            id: 'mechanical-cad',
            name: 'Mechanical CAD',
            icon: '⚙️',
            description: 'Parametric modeling, assemblies, analysis, CFD, manufacturing'
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
            description: 'Vehicle design, surfacing, aerodynamics'
        },
        {
            id: 'electronics',
            name: 'Electronics',
            icon: '⚡',
            description: 'PCB design, circuit simulation'
        }
    ];

    // Close dropdown on outside click
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
                setIsExpanded(false);
            }
        };

        if (isExpanded) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isExpanded]);

    // Close on Escape
    useEffect(() => {
        const handleEsc = (e) => {
            if (e.key === 'Escape') setIsExpanded(false);
        };
        if (isExpanded) {
            document.addEventListener('keydown', handleEsc);
        }
        return () => document.removeEventListener('keydown', handleEsc);
    }, [isExpanded]);

    const currentWorkbench = workbenches.find(w => w.id === activeWorkbench);

    return (
        <div className="workbench-switcher" ref={dropdownRef}>
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
                                {wb.id === activeWorkbench && <span className="active-check">✓</span>}
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
