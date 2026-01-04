/**
 * Project Settings - Configuration panel for units, grid, and scene settings
 * Cinema 4D/Blender-style project properties
 */

import { useState, useEffect } from 'react';
import sceneUnitsSystem from '../systems/SceneUnitsSystem';

export default function ProjectSettings({ isOpen, onClose, sceneManager }) {
    const [settings, setSettings] = useState(sceneUnitsSystem.getSettings());
    const [hasChanges, setHasChanges] = useState(false);

    useEffect(() => {
        setSettings(sceneUnitsSystem.getSettings());
    }, [isOpen]);

    const handleSettingChange = (key, value) => {
        setSettings(prev => ({
            ...prev,
            [key]: value
        }));
        setHasChanges(true);
    };

    const handleApply = () => {
        // Apply settings to sceneUnitsSystem
        sceneUnitsSystem.setBaseUnit(settings.baseUnit);
        sceneUnitsSystem.setGridScale(settings.gridScale);
        sceneUnitsSystem.setGridSubdivisions(settings.gridSubdivisions);
        sceneUnitsSystem.setSnapEnabled(settings.snapEnabled);
        sceneUnitsSystem.setSnapSize(settings.snapSize);

        setHasChanges(false);
        console.log('✅ Project settings applied');
    };

    const handleReset = () => {
        sceneUnitsSystem.resetToDefaults();
        setSettings(sceneUnitsSystem.getSettings());
        setHasChanges(false);
    };

    if (!isOpen) return null;

    const units = sceneUnitsSystem.getAvailableUnits();

    return (
        <div style={styles.overlay} onClick={onClose}>
            <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
                <div style={styles.header}>
                    <h2 style={styles.title}>Project Settings</h2>
                    <button onClick={onClose} style={styles.closeButton}>×</button>
                </div>

                <div style={styles.content}>
                    {/* Units Section */}
                    <div style={styles.section}>
                        <h3 style={styles.sectionTitle}>📏 Units</h3>

                        <div style={styles.settingGroup}>
                            <label style={styles.label}>Base Unit</label>
                            <select
                                value={settings.baseUnit}
                                onChange={(e) => handleSettingChange('baseUnit', e.target.value)}
                                style={styles.select}
                            >
                                {units.map(unit => (
                                    <option key={unit} value={unit}>
                                        {sceneUnitsSystem.getUnitInfo(unit).name} ({sceneUnitsSystem.getUnitInfo(unit).abbr})
                                    </option>
                                ))}
                            </select>
                            <div style={styles.hint}>Default measurement unit for the scene</div>
                        </div>

                        <div style={styles.settingGroup}>
                            <label style={styles.label}>Display Unit</label>
                            <select
                                value={settings.displayUnit}
                                onChange={(e) => handleSettingChange('displayUnit', e.target.value)}
                                style={styles.select}
                            >
                                {units.map(unit => (
                                    <option key={unit} value={unit}>
                                        {sceneUnitsSystem.getUnitInfo(unit).name}
                                    </option>
                                ))}
                            </select>
                            <div style={styles.hint}>Unit shown in UI and properties</div>
                        </div>
                    </div>

                    {/* Grid Section */}
                    <div style={styles.section}>
                        <h3 style={styles.sectionTitle}>⊞ Grid</h3>

                        <div style={styles.settingGroup}>
                            <label style={styles.label}>
                                Grid Scale
                                <span style={styles.currentValue}>
                                    {settings.gridScale} {sceneUnitsSystem.getUnitInfo(settings.baseUnit).abbr}
                                </span>
                            </label>
                            <input
                                type="number"
                                value={settings.gridScale}
                                onChange={(e) => handleSettingChange('gridScale', parseFloat(e.target.value) || 1.0)}
                                step="0.1"
                                min="0.001"
                                style={styles.input}
                            />
                            <div style={styles.hint}>Size of each major grid square</div>
                        </div>

                        <div style={styles.settingGroup}>
                            <label style={styles.label}>
                                Subdivisions
                                <span style={styles.currentValue}>{settings.gridSubdivisions}</span>
                            </label>
                            <input
                                type="range"
                                value={settings.gridSubdivisions}
                                onChange={(e) => handleSettingChange('gridSubdivisions', parseInt(e.target.value))}
                                min="1"
                                max="100"
                                style={styles.slider}
                            />
                            <div style={styles.hint}>Number of subdivisions per grid square</div>
                        </div>

                        <div style={styles.infoBox}>
                            <div style={styles.infoLabel}>Subdivision Size:</div>
                            <div style={styles.infoValue}>
                                {(settings.gridScale / settings.gridSubdivisions).toFixed(4)} {sceneUnitsSystem.getUnitInfo(settings.baseUnit).abbr}
                            </div>
                        </div>
                    </div>

                    {/* Snapping Section */}
                    <div style={styles.section}>
                        <h3 style={styles.sectionTitle}>🧲 Snapping</h3>

                        <div style={styles.settingGroup}>
                            <label style={styles.checkboxLabel}>
                                <input
                                    type="checkbox"
                                    checked={settings.snapEnabled}
                                    onChange={(e) => handleSettingChange('snapEnabled', e.target.checked)}
                                    style={styles.checkbox}
                                />
                                <span>Enable Snap to Grid</span>
                            </label>
                        </div>

                        {settings.snapEnabled && (
                            <div style={styles.settingGroup}>
                                <label style={styles.label}>
                                    Snap Size
                                    <span style={styles.currentValue}>
                                        {settings.snapSize} {sceneUnitsSystem.getUnitInfo(settings.baseUnit).abbr}
                                    </span>
                                </label>
                                <input
                                    type="number"
                                    value={settings.snapSize}
                                    onChange={(e) => handleSettingChange('snapSize', parseFloat(e.target.value) || 1.0)}
                                    step="0.1"
                                    min="0.001"
                                    style={styles.input}
                                />
                                <div style={styles.hint}>Increment for snapping transformations</div>
                            </div>
                        )}
                    </div>

                    {/* Scene Section */}
                    <div style={styles.section}>
                        <h3 style={styles.sectionTitle}>🌍 Scene</h3>

                        <div style={styles.settingGroup}>
                            <label style={styles.label}>
                                Scene Scale
                                <span style={styles.currentValue}>{settings.sceneScale}×</span>
                            </label>
                            <input
                                type="number"
                                value={settings.sceneScale}
                                onChange={(e) => handleSettingChange('sceneScale', parseFloat(e.target.value) || 1.0)}
                                step="0.1"
                                min="0.001"
                                style={styles.input}
                            />
                            <div style={styles.hint}>Global scene scale multiplier</div>
                        </div>

                        {sceneManager && (
                            <div style={styles.infoBox}>
                                <div style={styles.infoLabel}>Objects in Scene:</div>
                                <div style={styles.infoValue}>{sceneManager.getAllObjects().length}</div>
                            </div>
                        )}
                    </div>
                </div>

                <div style={styles.footer}>
                    <button
                        onClick={handleReset}
                        style={styles.resetButton}
                    >
                        Reset to Defaults
                    </button>
                    <div style={styles.footerRight}>
                        <button onClick={onClose} style={styles.cancelButton}>
                            Cancel
                        </button>
                        <button
                            onClick={handleApply}
                            disabled={!hasChanges}
                            style={{
                                ...styles.applyButton,
                                ...(hasChanges ? {} : styles.disabledButton)
                            }}
                        >
                            Apply Changes
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

const styles = {
    overlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.7)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        backdropFilter: 'blur(4px)',
    },
    modal: {
        width: '600px',
        maxWidth: '90vw',
        maxHeight: '90vh',
        backgroundColor: '#1a1a1a',
        borderRadius: '12px',
        border: '1px solid #444',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
    },
    header: {
        padding: '20px 24px',
        borderBottom: '1px solid #333',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#222',
    },
    title: {
        margin: 0,
        fontSize: '18px',
        fontWeight: '600',
        color: '#e0e0e0',
    },
    closeButton: {
        background: 'none',
        border: 'none',
        color: '#999',
        fontSize: '28px',
        cursor: 'pointer',
        padding: 0,
        lineHeight: '24px',
        width: '32px',
        height: '32px',
    },
    content: {
        flex: 1,
        overflowY: 'auto',
        padding: '24px',
    },
    section: {
        marginBottom: '28px',
    },
    sectionTitle: {
        fontSize: '15px',
        fontWeight: '600',
        color: '#4a90e2',
        marginBottom: '16px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    settingGroup: {
        marginBottom: '20px',
    },
    label: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '8px',
        fontSize: '13px',
        color: '#e0e0e0',
        fontWeight: '500',
    },
    currentValue: {
        color: '#4a90e2',
        fontSize: '12px',
        fontWeight: '600',
    },
    input: {
        width: '100%',
        padding: '10px 12px',
        backgroundColor: '#2a2a2a',
        border: '1px solid #444',
        borderRadius: '6px',
        color: '#e0e0e0',
        fontSize: '13px',
        boxSizing: 'border-box',
    },
    select: {
        width: '100%',
        padding: '10px 12px',
        backgroundColor: '#2a2a2a',
        border: '1px solid #444',
        borderRadius: '6px',
        color: '#e0e0e0',
        fontSize: '13px',
        cursor: 'pointer',
    },
    slider: {
        width: '100%',
        height: '6px',
        borderRadius: '3px',
        outline: 'none',
        WebkitAppearance: 'none',
    },
    hint: {
        marginTop: '6px',
        fontSize: '11px',
        color: '#999',
        fontStyle: 'italic',
    },
    checkboxLabel: {
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        cursor: 'pointer',
        fontSize: '13px',
        color: '#e0e0e0',
    },
    checkbox: {
        width: '18px',
        height: '18px',
        cursor: 'pointer',
    },
    infoBox: {
        backgroundColor: '#2a2a2a',
        borderRadius: '6px',
        padding: '12px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        border: '1px solid #333',
    },
    infoLabel: {
        fontSize: '12px',
        color: '#999',
    },
    infoValue: {
        fontSize: '13px',
        color: '#4a90e2',
        fontWeight: '600',
    },
    footer: {
        padding: '16px 24px',
        borderTop: '1px solid #333',
        display: 'flex',
        justifyContent: 'space-between',
        backgroundColor: '#222',
    },
    resetButton: {
        padding: '10px 16px',
        backgroundColor: 'transparent',
        border: '1px solid #666',
        borderRadius: '6px',
        color: '#999',
        cursor: 'pointer',
        fontSize: '13px',
    },
    footerRight: {
        display: 'flex',
        gap: '12px',
    },
    cancelButton: {
        padding: '10px 20px',
        backgroundColor: 'transparent',
        border: '1px solid #666',
        borderRadius: '6px',
        color: '#e0e0e0',
        cursor: 'pointer',
        fontSize: '13px',
    },
    applyButton: {
        padding: '10px 20px',
        backgroundColor: '#4a90e2',
        border: 'none',
        borderRadius: '6px',
        color: '#ffffff',
        cursor: 'pointer',
        fontSize: '13px',
        fontWeight: '500',
    },
    disabledButton: {
        opacity: 0.5,
        cursor: 'not-allowed',
    },
};
