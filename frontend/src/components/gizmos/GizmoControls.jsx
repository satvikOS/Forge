/**
 * Gizmo Controls - Mode switcher for transform gizmos
 * Provides UI for switching between move, rotate, and scale modes
 * Keyboard shortcuts: G (move), R (rotate), S (scale), X/Y/Z (constrain axes)
 */

import { useState, useEffect } from 'react';

export default function GizmoControls({ mode, onModeChange, constrainAxis, onConstrainAxis }) {
    const [activeMode, setActiveMode] = useState(mode || 'translate');
    const [activeConstraint, setActiveConstraint] = useState(constrainAxis || null);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Ignore if user is typing in an input field
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
                return;
            }

            switch (e.key.toLowerCase()) {
                case 'g':
                    handleModeChange('translate');
                    break;
                case 'r':
                    handleModeChange('rotate');
                    break;
                case 's':
                    handleModeChange('scale');
                    break;
                case 'x':
                    handleConstraintToggle('x');
                    break;
                case 'y':
                    handleConstraintToggle('y');
                    break;
                case 'z':
                    handleConstraintToggle('z');
                    break;
                case 'escape':
                    handleConstraintToggle(null);
                    break;
                default:
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [activeMode, activeConstraint]);

    const handleModeChange = (newMode) => {
        setActiveMode(newMode);
        if (onModeChange) {
            onModeChange(newMode);
        }
    };

    const handleConstraintToggle = (axis) => {
        const newConstraint = activeConstraint === axis ? null : axis;
        setActiveConstraint(newConstraint);
        if (onConstrainAxis) {
            onConstrainAxis(newConstraint);
        }
    };

    const modes = [
        { id: 'translate', label: 'Move', icon: '↔', key: 'G' },
        { id: 'rotate', label: 'Rotate', icon: '⟲', key: 'R' },
        { id: 'scale', label: 'Scale', icon: '⇱', key: 'S' },
    ];

    const constraints = [
        { id: 'x', label: 'X', color: '#ff0000' },
        { id: 'y', label: 'Y', color: '#00ff00' },
        { id: 'z', label: 'Z', color: '#0000ff' },
    ];

    return (
        <div style={styles.container}>
            {/* Mode Buttons */}
            <div style={styles.modeGroup}>
                <div style={styles.groupLabel}>Transform Mode</div>
                <div style={styles.buttonRow}>
                    {modes.map((m) => (
                        <button
                            key={m.id}
                            onClick={() => handleModeChange(m.id)}
                            style={{
                                ...styles.modeButton,
                                ...(activeMode === m.id ? styles.activeButton : {}),
                            }}
                            title={`${m.label} (${m.key})`}
                        >
                            <span style={styles.icon}>{m.icon}</span>
                            <span style={styles.label}>{m.label}</span>
                            <span style={styles.shortcut}>{m.key}</span>
                        </button>
                    ))}
                </div>
            </div>

            {/* Axis Constraints */}
            <div style={styles.constraintGroup}>
                <div style={styles.groupLabel}>Constrain Axis</div>
                <div style={styles.buttonRow}>
                    {constraints.map((c) => (
                        <button
                            key={c.id}
                            onClick={() => handleConstraintToggle(c.id)}
                            style={{
                                ...styles.constraintButton,
                                borderColor: c.color,
                                ...(activeConstraint === c.id ? {
                                    ...styles.activeConstraint,
                                    backgroundColor: c.color + '33',
                                    borderColor: c.color,
                                } : {}),
                            }}
                            title={`Constrain to ${c.label.toUpperCase()} axis (${c.label})`}
                        >
                            <span style={{ color: c.color, fontWeight: 'bold' }}>{c.label}</span>
                        </button>
                    ))}
                    <button
                        onClick={() => handleConstraintToggle(null)}
                        style={{
                            ...styles.constraintButton,
                            ...(activeConstraint === null ? styles.activeConstraint : {}),
                        }}
                        title="No constraint (Esc)"
                    >
                        <span>All</span>
                    </button>
                </div>
            </div>

            {/* Active Status Indicator */}
            {activeMode && (
                <div style={styles.statusBar}>
                    <span style={styles.statusText}>
                        {modes.find(m => m.id === activeMode)?.label}
                        {activeConstraint && ` • ${activeConstraint.toUpperCase()} axis`}
                    </span>
                </div>
            )}
        </div>
    );
}

const styles = {
    container: {
        padding: '12px',
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        border: '1px solid #444',
        minWidth: '280px',
    },
    modeGroup: {
        marginBottom: '12px',
    },
    constraintGroup: {
        marginBottom: '8px',
    },
    groupLabel: {
        fontSize: '11px',
        color: '#999',
        marginBottom: '6px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
        fontWeight: '600',
    },
    buttonRow: {
        display: 'flex',
        gap: '6px',
    },
    modeButton: {
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
        padding: '8px 4px',
        backgroundColor: '#1a1a1a',
        border: '1px solid #444',
        borderRadius: '6px',
        color: '#e0e0e0',
        cursor: 'pointer',
        transition: 'all 0.2s',
        fontFamily: 'inherit',
    },
    activeButton: {
        backgroundColor: '#4a90e2',
        borderColor: '#4a90e2',
        color: '#ffffff',
    },
    icon: {
        fontSize: '18px',
    },
    label: {
        fontSize: '11px',
        fontWeight: '500',
    },
    shortcut: {
        fontSize: '9px',
        opacity: 0.7,
        backgroundColor: '#000',
        padding: '2px 4px',
        borderRadius: '3px',
    },
    constraintButton: {
        flex: 1,
        padding: '8px',
        backgroundColor: '#1a1a1a',
        border: '2px solid #444',
        borderRadius: '6px',
        color: '#e0e0e0',
        cursor: 'pointer',
        transition: 'all 0.2s',
        fontSize: '13px',
        fontWeight: '600',
        fontFamily: 'inherit',
    },
    activeConstraint: {
        borderWidth: '2px',
    },
    statusBar: {
        marginTop: '8px',
        padding: '6px 8px',
        backgroundColor: '#1a1a1a',
        borderRadius: '4px',
        borderLeft: '3px solid #4a90e2',
    },
    statusText: {
        fontSize: '12px',
        color: '#4a90e2',
        fontWeight: '500',
    },
};
