/**
 * NPC Crowd Panel - UI for configuring and spawning NPC crowds
 * Integrates with crowdService for AI-powered crowd generation
 */

import { useState } from 'react';

export default function NPCCrowdPanel({ sceneManager, onCrowdGenerated, onClose }) {
    const [crowdSettings, setCrowdSettings] = useState({
        count: 10,
        areaWidth: 50,
        areaDepth: 50,
        behavior: 'mixed',
        density: 'medium',
        scenario: 'urban street',
    });
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedCrowd, setGeneratedCrowd] = useState(null);

    const handleSettingChange = (key, value) => {
        setCrowdSettings(prev => ({ ...prev, [key]: value }));
    };

    const handleGenerateCrowd = async () => {
        setIsGenerating(true);

        try {
            const response = await fetch('/api/crowd/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    count: crowdSettings.count,
                    area: { width: crowdSettings.areaWidth, depth: crowdSettings.areaDepth },
                    behavior: crowdSettings.behavior,
                    density: crowdSettings.density,
                    scenario: crowdSettings.scenario,
                }),
            });

            if (!response.ok) {
                throw new Error('Crowd generation failed');
            }

            const result = await response.json();
            setGeneratedCrowd(result.crowd);

            if (onCrowdGenerated) {
                onCrowdGenerated(result.crowd);
            }

            console.log('✅ NPC crowd generated:', result);

        } catch (error) {
            console.error('❌ Error generating crowd:', error);
            alert('Failed to generate crowd: ' + error.message);
        } finally {
            setIsGenerating(false);
        }
    };

    return (
        <div style={styles.panel}>
            <div style={styles.header}>
                <h3 style={styles.title}>
                    <span>👥</span>
                    <span>NPC Crowd Generator</span>
                </h3>
                {onClose && (
                    <button onClick={onClose} style={styles.closeButton}>×</button>
                )}
            </div>

            <div style={styles.content}>
                {/* Crowd Size */}
                <div style={styles.section}>
                    <label style={styles.label}>
                        Crowd Size
                        <span style={styles.valueDisplay}>{crowdSettings.count} NPCs</span>
                    </label>
                    <input
                        type="range"
                        min="1"
                        max="100"
                        value={crowdSettings.count}
                        onChange={(e) => handleSettingChange('count', parseInt(e.target.value))}
                        style={styles.slider}
                    />
                    <div style={styles.sliderMarks}>
                        <span>1</span>
                        <span>50</span>
                        <span>100</span>
                    </div>
                </div>

                {/* Spawn Area */}
                <div style={styles.section}>
                    <label style={styles.label}>Spawn Area</label>
                    <div style={styles.row}>
                        <div style={styles.inputGroup}>
                            <span style={styles.inputLabel}>Width</span>
                            <input
                                type="number"
                                value={crowdSettings.areaWidth}
                                onChange={(e) => handleSettingChange('areaWidth', parseFloat(e.target.value))}
                                style={styles.numberInput}
                                step="1"
                                min="10"
                            />
                            <span style={styles.unit}>m</span>
                        </div>
                        <div style={styles.inputGroup}>
                            <span style={styles.inputLabel}>Depth</span>
                            <input
                                type="number"
                                value={crowdSettings.areaDepth}
                                onChange={(e) => handleSettingChange('areaDepth', parseFloat(e.target.value))}
                                style={styles.numberInput}
                                step="1"
                                min="10"
                            />
                            <span style={styles.unit}>m</span>
                        </div>
                    </div>
                </div>

                {/* Behavior Type */}
                <div style={styles.section}>
                    <label style={styles.label}>Behavior Type</label>
                    <div style={styles.buttonGroup}>
                        {['walking', 'standing', 'sitting', 'mixed'].map(behavior => (
                            <button
                                key={behavior}
                                onClick={() => handleSettingChange('behavior', behavior)}
                                style={{
                                    ...styles.optionButton,
                                    ...(crowdSettings.behavior === behavior ? styles.activeOption : {})
                                }}
                            >
                                {behavior.charAt(0).toUpperCase() + behavior.slice(1)}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Density */}
                <div style={styles.section}>
                    <label style={styles.label}>Crowd Density</label>
                    <div style={styles.buttonGroup}>
                        {['low', 'medium', 'high'].map(density => (
                            <button
                                key={density}
                                onClick={() => handleSettingChange('density', density)}
                                style={{
                                    ...styles.optionButton,
                                    ...(crowdSettings.density === density ? styles.activeOption : {})
                                }}
                            >
                                {density.charAt(0).toUpperCase() + density.slice(1)}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Scenario */}
                <div style={styles.section}>
                    <label style={styles.label}>Scenario</label>
                    <select
                        value={crowdSettings.scenario}
                        onChange={(e) => handleSettingChange('scenario', e.target.value)}
                        style={styles.select}
                    >
                        <option value="urban street">Urban Street</option>
                        <option value="park">Park</option>
                        <option value="shopping mall">Shopping Mall</option>
                        <option value="train station">Train Station</option>
                        <option value="concert">Concert/Event</option>
                        <option value="office">Office Building</option>
                    </select>
                </div>

                {/* Generate Button */}
                <button
                    onClick={handleGenerateCrowd}
                    disabled={isGenerating}
                    style={{
                        ...styles.generateButton,
                        ...(isGenerating ? styles.generatingButton : {})
                    }}
                >
                    {isGenerating ? (
                        <>
                            <span>⏳</span>
                            <span>Generating with AI...</span>
                        </>
                    ) : (
                        <>
                            <span>🤖</span>
                            <span>Generate NPC Crowd</span>
                        </>
                    )}
                </button>

                {/* Generated Crowd Info */}
                {generatedCrowd && (
                    <div style={styles.resultSection}>
                        <h4 style={styles.resultTitle}>✅ Crowd Generated</h4>
                        <div style={styles.statsGrid}>
                            <div style={styles.stat}>
                                <span style={styles.statLabel}>NPCs:</span>
                                <span style={styles.statValue}>{generatedCrowd.npcs?.length || 0}</span>
                            </div>
                            <div style={styles.stat}>
                                <span style={styles.statLabel}>Area:</span>
                                <span style={styles.statValue}>
                                    {crowdSettings.areaWidth}×{crowdSettings.areaDepth}m
                                </span>
                            </div>
                            <div style={styles.stat}>
                                <span style={styles.statLabel}>Density:</span>
                                <span style={styles.statValue}>
                                    {(generatedCrowd.metadata?.averageDensity || 0).toFixed(2)}/m²
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Info Box */}
                <div style={styles.infoBox}>
                    <div style={styles.infoTitle}>💡 AI-Powered Crowd Generation</div>
                    <ul style={styles.infoList}>
                        <li>Realistic NPC placement with proper spacing</li>
                        <li>AI-generated behaviors and animations</li>
                        <li>Character variation (age, build, clothing)</li>
                        <li>Natural Motion Euphoria physics support</li>
                    </ul>
                </div>
            </div>
        </div>
    );
}

const styles = {
    panel: {
        width: '100%',
        height: '100%',
        backgroundColor: '#1a1a1a',
        display: 'flex',
        flexDirection: 'column',
        color: '#e0e0e0',
    },
    header: {
        padding: '16px',
        borderBottom: '1px solid #333',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        backgroundColor: '#222',
    },
    title: {
        margin: 0,
        fontSize: '16px',
        fontWeight: '600',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    closeButton: {
        background: 'none',
        border: 'none',
        color: '#999',
        fontSize: '28px',
        cursor: 'pointer',
        padding: 0,
        lineHeight: '24px',
    },
    content: {
        flex: 1,
        overflowY: 'auto',
        padding: '20px',
    },
    section: {
        marginBottom: '24px',
    },
    label: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '10px',
        fontSize: '13px',
        fontWeight: '500',
        color: '#e0e0e0',
    },
    valueDisplay: {
        color: '#4a90e2',
        fontSize: '12px',
        fontWeight: '600',
    },
    slider: {
        width: '100%',
        height: '6px',
        borderRadius: '3px',
        outline: 'none',
        WebkitAppearance: 'none',
    },
    sliderMarks: {
        display: 'flex',
        justifyContent: 'space-between',
        fontSize: '10px',
        color: '#666',
        marginTop: '4px',
    },
    row: {
        display: 'flex',
        gap: '12px',
    },
    inputGroup: {
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        backgroundColor: '#2a2a2a',
        padding: '8px 12px',
        borderRadius: '6px',
        border: '1px solid #444',
    },
    inputLabel: {
        fontSize: '11px',
        color: '#999',
        minWidth: '40px',
    },
    numberInput: {
        flex: 1,
        background: 'transparent',
        border: 'none',
        color: '#e0e0e0',
        fontSize: '13px',
        outline: 'none',
        width: '60px',
    },
    unit: {
        fontSize: '11px',
        color: '#666',
    },
    buttonGroup: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(80px, 1fr))',
        gap: '8px',
    },
    optionButton: {
        padding: '10px',
        backgroundColor: '#2a2a2a',
        border: '1px solid #444',
        borderRadius: '6px',
        color: '#e0e0e0',
        cursor: 'pointer',
        fontSize: '12px',
        transition: 'all 0.2s',
    },
    activeOption: {
        backgroundColor: '#4a90e2',
        borderColor: '#4a90e2',
        color: '#ffffff',
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
    generateButton: {
        width: '100%',
        padding: '14px',
        backgroundColor: '#4a90e2',
        border: 'none',
        borderRadius: '8px',
        color: '#ffffff',
        fontSize: '14px',
        fontWeight: '600',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px',
        marginTop: '24px',
        transition: 'background-color 0.2s',
    },
    generatingButton: {
        opacity: 0.7,
        cursor: 'not-allowed',
    },
    resultSection: {
        marginTop: '24px',
        padding: '16px',
        backgroundColor: '#2a2a2a',
        borderRadius: '8px',
        border: '1px solid #4a90e2',
    },
    resultTitle: {
        margin: '0 0 12px 0',
        fontSize: '14px',
        color: '#4a90e2',
        fontWeight: '600',
    },
    statsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '12px',
    },
    stat: {
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
    },
    statLabel: {
        fontSize: '10px',
        color: '#999',
        textTransform: 'uppercase',
    },
    statValue: {
        fontSize: '16px',
        color: '#4a90e2',
        fontWeight: '600',
    },
    infoBox: {
        marginTop: '24px',
        padding: '14px',
        backgroundColor: '#2a2a2a',
        borderRadius: '6px',
        border: '1px solid #444',
    },
    infoTitle: {
        fontSize: '12px',
        fontWeight: '600',
        marginBottom: '8px',
        color: '#4a90e2',
    },
    infoList: {
        margin: 0,
        paddingLeft: '20px',
        fontSize: '11px',
        color: '#999',
        lineHeight: '1.6',
    },
};
