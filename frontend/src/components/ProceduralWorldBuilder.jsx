/**
 * Procedural World Builder - UI for AI-powered procedural world generation
 * Integrates with ProceduralGenerationEngine for terrain, buildings, and vegetation
 */

import { useState } from 'react';

export default function ProceduralWorldBuilder({ sceneManager, onWorldGenerated, onClose }) {
    const [worldSettings, setWorldSettings] = useState({
        worldType: 'natural',
        width: 200,
        depth: 200,
        theme: 'temperate',
        features: ['terrain', 'vegetation'],
    });
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationProgress, setGenerationProgress] = useState(null);

    const handleSettingChange = (key, value) => {
        setWorldSettings(prev => ({ ...prev, [key]: value }));
    };

    const handleFeatureToggle = (feature) => {
        setWorldSettings(prev => ({
            ...prev,
            features: prev.features.includes(feature)
                ? prev.features.filter(f => f !== feature)
                : [...prev.features, feature]
        }));
    };

    const handleGenerateWorld = async () => {
        setIsGenerating(true);
        setGenerationProgress({ stage: 'Initializing', percent: 0 });

        try {
            const response = await fetch('/api/procedural/generate-world', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    worldType: worldSettings.worldType,
                    size: { width: worldSettings.width, depth: worldSettings.depth },
                    features: worldSettings.features,
                    theme: worldSettings.theme,
                }),
            });

            if (!response.ok) {
                throw new Error('World generation failed');
            }

            const result = await response.json();

            if (onWorldGenerated) {
                onWorldGenerated(result.world);
            }

            setGenerationProgress({ stage: 'Complete', percent: 100 });
            console.log('✅ Procedural world generated:', result);

        } catch (error) {
            console.error('❌ Error generating world:', error);
            alert('Failed to generate world: ' + error.message);
            setGenerationProgress(null);
        } finally {
            setTimeout(() => {
                setIsGenerating(false);
                setGenerationProgress(null);
            }, 1500);
        }
    };

    return (
        <div style={styles.panel}>
            <div style={styles.header}>
                <h3 style={styles.title}>
                    <span>🌍</span>
                    <span>Procedural World Builder</span>
                </h3>
                {onClose && (
                    <button onClick={onClose} style={styles.closeButton}>×</button>
                )}
            </div>

            <div style={styles.content}>
                {/* World Type */}
                <div style={styles.section}>
                    <label style={styles.label}>World Type</label>
                    <div style={styles.buttonGroup}>
                        {[
                            { id: 'natural', label: 'Natural', icon: '🌲' },
                            { id: 'urban', label: 'Urban', icon: '🏙' },
                            { id: 'fantasy', label: 'Fantasy', icon: '✨' },
                            { id: 'sci-fi', label: 'Sci-Fi', icon: '🚀' },
                        ].map(type => (
                            <button
                                key={type.id}
                                onClick={() => handleSettingChange('worldType', type.id)}
                                style={{
                                    ...styles.typeButton,
                                    ...(worldSettings.worldType === type.id ? styles.activeType : {})
                                }}
                            >
                                <span style={styles.typeIcon}>{type.icon}</span>
                                <span>{type.label}</span>
                            </button>
                        ))}
                    </div>
                </div>

                {/* World Size */}
                <div style={styles.section}>
                    <label style={styles.label}>World Size</label>
                    <div style={styles.sizePresets}>
                        {[
                            { label: 'Small', size: 100 },
                            { label: 'Medium', size: 200 },
                            { label: 'Large', size: 500 },
                            { label: 'Huge', size: 1000 },
                        ].map(preset => (
                            <button
                                key={preset.label}
                                onClick={() => {
                                    handleSettingChange('width', preset.size);
                                    handleSettingChange('depth', preset.size);
                                }}
                                style={{
                                    ...styles.presetButton,
                                    ...(worldSettings.width === preset.size ? styles.activePreset : {})
                                }}
                            >
                                {preset.label}
                                <span style={styles.presetSize}>{preset.size}m</span>
                            </button>
                        ))}
                    </div>
                    <div style={styles.customSize}>
                        <div style={styles.inputGroup}>
                            <span style={styles.inputLabel}>W</span>
                            <input
                                type="number"
                                value={worldSettings.width}
                                onChange={(e) => handleSettingChange('width', parseFloat(e.target.value))}
                                style={styles.sizeInput}
                                step="10"
                                min="50"
                            />
                        </div>
                        <span style={styles.sizeSeparator}>×</span>
                        <div style={styles.inputGroup}>
                            <span style={styles.inputLabel}>D</span>
                            <input
                                type="number"
                                value={worldSettings.depth}
                                onChange={(e) => handleSettingChange('depth', parseFloat(e.target.value))}
                                style={styles.sizeInput}
                                step="10"
                                min="50"
                            />
                        </div>
                        <span style={styles.unit}>meters</span>
                    </div>
                </div>

                {/* Theme/Biome */}
                <div style={styles.section}>
                    <label style={styles.label}>Theme / Biome</label>
                    <select
                        value={worldSettings.theme}
                        onChange={(e) => handleSettingChange('theme', e.target.value)}
                        style={styles.select}
                    >
                        <optgroup label="Natural">
                            <option value="temperate">Temperate Forest</option>
                            <option value="tropical">Tropical Rainforest</option>
                            <option value="desert">Desert</option>
                            <option value="tundra">Tundra</option>
                            <option value="savanna">Savanna</option>
                            <option value="mountain">Mountain</option>
                        </optgroup>
                        <optgroup label="Urban">
                            <option value="modern">Modern City</option>
                            <option value="industrial">Industrial</option>
                            <option value="suburban">Suburban</option>
                        </optgroup>
                        <optgroup label="Fantasy">
                            <option value="magical_forest">Magical Forest</option>
                            <option value="dark_realm">Dark Realm</option>
                            <option value="floating_islands">Floating Islands</option>
                        </optgroup>
                    </select>
                </div>

                {/* Features */}
                <div style={styles.section}>
                    <label style={styles.label}>World Features</label>
                    <div style={styles.featureGrid}>
                        {[
                            { id: 'terrain', label: 'Terrain', icon: '⛰' },
                            { id: 'vegetation', label: 'Vegetation', icon: '🌳' },
                            { id: 'water', label: 'Water Bodies', icon: '💧' },
                            { id: 'buildings', label: 'Buildings', icon: '🏢', urban: true },
                            { id: 'roads', label: 'Roads', icon: '🛣', urban: true },
                            { id: 'props', label: 'Props', icon: '📦' },
                        ].map(feature => {
                            const isUrbanOnly = feature.urban && worldSettings.worldType !== 'urban';
                            return (
                                <button
                                    key={feature.id}
                                    onClick={() => !isUrbanOnly && handleFeatureToggle(feature.id)}
                                    disabled={isUrbanOnly}
                                    style={{
                                        ...styles.featureButton,
                                        ...(worldSettings.features.includes(feature.id) ? styles.activeFeature : {}),
                                        ...(isUrbanOnly ? styles.disabledFeature : {})
                                    }}
                                >
                                    <span style={styles.featureIcon}>{feature.icon}</span>
                                    <span style={styles.featureLabel}>{feature.label}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* Generate Button */}
                <button
                    onClick={handleGenerateWorld}
                    disabled={isGenerating || worldSettings.features.length === 0}
                    style={{
                        ...styles.generateButton,
                        ...(isGenerating ? styles.generatingButton : {}),
                        ...(worldSettings.features.length === 0 ? styles.disabledButton : {})
                    }}
                >
                    {isGenerating ? (
                        <>
                            <span>⏳</span>
                            <span>Generating...</span>
                        </>
                    ) : (
                        <>
                            <span>🤖</span>
                            <span>Generate World with AI</span>
                        </>
                    )}
                </button>

                {/* Progress */}
                {generationProgress && (
                    <div style={styles.progressSection}>
                        <div style={styles.progressLabel}>{generationProgress.stage}</div>
                        <div style={styles.progressBar}>
                            <div
                                style={{
                                    ...styles.progressFill,
                                    width: `${generationProgress.percent}%`
                                }}
                            />
                        </div>
                    </div>
                )}

                {/* Info */}
                <div style={styles.infoBox}>
                    <div style={styles.infoTitle}>🤖 AI-Powered Generation</div>
                    <ul style={styles.infoList}>
                        <li>Realistic terrain with natural features</li>
                        <li>Procedural vegetation distribution</li>
                        <li>Intelligent building placement (urban worlds)</li>
                        <li>All generated using Gemini AI - no local fallbacks</li>
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
        display: 'block',
        marginBottom: '10px',
        fontSize: '13px',
        fontWeight: '500',
        color: '#e0e0e0',
    },
    buttonGroup: {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '8px',
    },
    typeButton: {
        padding: '14px',
        backgroundColor: '#2a2a2a',
        border: '1px solid #444',
        borderRadius: '8px',
        color: '#e0e0e0',
        cursor: 'pointer',
        fontSize: '13px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '6px',
        transition: 'all 0.2s',
    },
    activeType: {
        backgroundColor: '#4a90e2',
        borderColor: '#4a90e2',
        color: '#ffffff',
    },
    typeIcon: {
        fontSize: '24px',
    },
    sizePresets: {
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: '6px',
        marginBottom: '12px',
    },
    presetButton: {
        padding: '10px 8px',
        backgroundColor: '#2a2a2a',
        border: '1px solid #444',
        borderRadius: '6px',
        color: '#e0e0e0',
        cursor: 'pointer',
        fontSize: '12px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
    },
    activePreset: {
        backgroundColor: '#4a90e233',
        borderColor: '#4a90e2',
    },
    presetSize: {
        fontSize: '10px',
        color: '#999',
    },
    customSize: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
    },
    inputGroup: {
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        backgroundColor: '#2a2a2a',
        padding: '10px 12px',
        borderRadius: '6px',
        border: '1px solid #444',
    },
    inputLabel: {
        fontSize: '11px',
        color: '#999',
        fontWeight: '600',
    },
    sizeInput: {
        flex: 1,
        background: 'transparent',
        border: 'none',
        color: '#e0e0e0',
        fontSize: '14px',
        outline: 'none',
    },
    sizeSeparator: {
        color: '#666',
        fontSize: '16px',
    },
    unit: {
        fontSize: '11px',
        color: '#666',
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
    featureGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(2, 1fr)',
        gap: '8px',
    },
    featureButton: {
        padding: '12px',
        backgroundColor: '#2a2a2a',
        border: '1px solid #444',
        borderRadius: '6px',
        color: '#e0e0e0',
        cursor: 'pointer',
        fontSize: '12px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        transition: 'all 0.2s',
    },
    activeFeature: {
        backgroundColor: '#4a90e233',
        borderColor: '#4a90e2',
    },
    disabledFeature: {
        opacity: 0.3,
        cursor: 'not-allowed',
    },
    featureIcon: {
        fontSize: '18px',
    },
    featureLabel: {
        fontSize: '11px',
    },
    generateButton: {
        width: '100%',
        padding: '16px',
        backgroundColor: '#4a90e2',
        border: 'none',
        borderRadius: '8px',
        color: '#ffffff',
        fontSize: '15px',
        fontWeight: '600',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        marginTop: '24px',
    },
    generatingButton: {
        opacity: 0.7,
        cursor: 'not-allowed',
    },
    disabledButton: {
        opacity: 0.5,
        cursor: 'not-allowed',
    },
    progressSection: {
        marginTop: '16px',
    },
    progressLabel: {
        fontSize: '12px',
        color: '#4a90e2',
        marginBottom: '8px',
        textAlign: 'center',
    },
    progressBar: {
        height: '6px',
        backgroundColor: '#333',
        borderRadius: '3px',
        overflow: 'hidden',
    },
    progressFill: {
        height: '100%',
        backgroundColor: '#4a90e2',
        transition: 'width 0.3s',
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
