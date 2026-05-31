import React, { useState, useRef, useEffect } from 'react';
import { Cog, Building2, Gamepad2, Car, Cpu, ChevronDown } from 'lucide-react';
import '../styles/workbench-switcher.css';

/**
 * Workbench Switcher Component
 * Clean dropdown with lucide icons, no emojis
 */
function WorkbenchSwitcher({ activeWorkbench, onSwitchWorkbench }) {
    const [isExpanded, setIsExpanded] = useState(false);
    const dropdownRef = useRef(null);

    const workbenches = [
        {
            id: 'mechanical-cad',
            name: 'Mechanical CAD',
            icon: Cog,
            description: 'Parametric modeling, assemblies, simulation, manufacturing'
        },
        {
            id: 'architecture-bim',
            name: 'Architecture & BIM',
            icon: Building2,
            description: 'Building design, IFC, code compliance'
        },
        {
            id: 'gaming-vfx',
            name: 'Gaming & VFX',
            icon: Gamepad2,
            description: 'Polygon modeling, rigging, particle systems'
        },
        {
            id: 'automotive',
            name: 'Automotive',
            icon: Car,
            description: 'Vehicle design, surfacing, aerodynamics'
        },
        {
            id: 'electronics',
            name: 'Electronics',
            icon: Cpu,
            description: 'PCB design, circuit simulation'
        }
    ];

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
    const CurrentIcon = currentWorkbench?.icon;

    return (
        <div className="workbench-switcher" ref={dropdownRef}>
            <button
                className="workbench-current"
                onClick={() => setIsExpanded(!isExpanded)}
            >
                {CurrentIcon && <CurrentIcon size={14} className="workbench-icon-svg" />}
                <span className="workbench-name">{currentWorkbench?.name}</span>
                <ChevronDown size={12} className={`expand-chevron ${isExpanded ? 'open' : ''}`} />
            </button>

            {isExpanded && (
                <div className="workbench-dropdown">
                    {workbenches.map(wb => {
                        const WbIcon = wb.icon;
                        return (
                            <button
                                key={wb.id}
                                className={`workbench-option ${wb.id === activeWorkbench ? 'active' : ''}`}
                                onClick={() => {
                                    onSwitchWorkbench(wb.id);
                                    setIsExpanded(false);
                                }}
                            >
                                <div className="workbench-option-header">
                                    <WbIcon size={14} className="workbench-icon-svg" />
                                    <span className="workbench-name">{wb.name}</span>
                                </div>
                                <p className="workbench-description">{wb.description}</p>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
}

export default WorkbenchSwitcher;
