import React, { useState, useEffect } from 'react';
import Viewport3D from '../../components/Viewport3D';
import './WorkbenchMechanical.css';

/**
 * Mechanical CAD Workbench - Professional Layout
 * Layout: Feature Tree | Toolbar | Viewport | Properties
 * Bottom: AI Prompt Panel
 */
function WorkbenchMechanical() {
    // State Management
    const [activeMode, setActiveMode] = useState('model'); // model, sketch, assembly
    const [activeTool, setActiveTool] = useState('select');
    const [selectedFeature, setSelectedFeature] = useState(null);
    const [featureTree, setFeatureTree] = useState([]);
    const [aiPrompt, setAiPrompt] = useState('');
    const [designVariants, setDesignVariants] = useState([]);
    const [showVariants, setShowVariants] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [selectedVariant, setSelectedVariant] = useState(null);

    // Feature creation panel state
    const [showFeaturePanel, setShowFeaturePanel] = useState(false);
    const [featureParams, setFeatureParams] = useState({});

    // AI Design Generation
    const handleGenerateDesign = async () => {
        if (!aiPrompt.trim()) return;

        setIsGenerating(true);
        setShowVariants(false);

        try {
            const response = await fetch('/api/mechanical/generate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    prompt: aiPrompt,
                    preferences: { variantCount: 3 }
                })
            });

            const data = await response.json();

            if (data.success) {
                // Poll for job completion
                pollJobStatus(data.jobId);
            }
        } catch (error) {
            console.error('Error generating design:', error);
            setIsGenerating(false);
        }
    };

    const pollJobStatus = async (jobId) => {
        const interval = setInterval(async () => {
            try {
                const response = await fetch(`/api/mechanical/generate/${jobId}`);
                const job = await response.json();

                if (job.status === 'completed') {
                    clearInterval(interval);
                    setDesignVariants(job.result.variants || []);
                    setShowVariants(true);
                    setIsGenerating(false);
                } else if (job.status === 'failed') {
                    clearInterval(interval);
                    console.error('Design generation failed:', job.error);
                    setIsGenerating(false);
                }
            } catch (error) {
                clearInterval(interval);
                console.error('Error polling job:', error);
                setIsGenerating(false);
            }
        }, 1000);
    };

    const selectVariant = (variant) => {
        setSelectedVariant(variant);
        // Convert variant to feature tree
        // In full implementation, would parse variant.geometry into features
        setFeatureTree([
            { id: 'feature_1', name: variant.name, type: 'imported', suppressed: false }
        ]);
        setShowVariants(false);
    };

    // Feature Tree Operations
    const addFeature = (featureType) => {
        setActiveTool(featureType);
        setShowFeaturePanel(true);
        setFeatureParams({
            type: featureType,
            distance: 10,
            radius: 2,
            angle: 360
        });
    };

    const createFeature = async () => {
        try {
            const response = await fetch('/api/mechanical/feature/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    featureType: featureParams.type,
                    parameters: featureParams
                })
            });

            const data = await response.json();

            if (data.success) {
                // Add to feature tree
                setFeatureTree([...featureTree, {
                    ...data.feature,
                    suppressed: false
                }]);
                setShowFeaturePanel(false);
            }
        } catch (error) {
            console.error('Error creating feature:', error);
        }
    };

    const toggleFeature = (featureId) => {
        setFeatureTree(featureTree.map(f =>
            f.id === featureId ? { ...f, suppressed: !f.suppressed } : f
        ));
    };

    const deleteFeature = async (featureId) => {
        try {
            await fetch(`/api/mechanical/feature/${featureId}`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ featureTree })
            });

            setFeatureTree(featureTree.filter(f => f.id !== featureId));
        } catch (error) {
            console.error('Error deleting feature:', error);
        }
    };

    return (
        <div className="mechanical-workbench">
            {/* LEFT FEATURE TREE PANEL */}
            <aside className="feature-tree-panel">
                <div className="panel-header">
                    <h3>Feature Tree</h3>
                    <div className="mode-tabs">
                        <button
                            className={`mode-tab ${activeMode === 'model' ? 'active' : ''}`}
                            onClick={() => setActiveMode('model')}
                        >
                            Part
                        </button>
                        <button
                            className={`mode-tab ${activeMode === 'assembly' ? 'active' : ''}`}
                            onClick={() => setActiveMode('assembly')}
                        >
                            Assembly
                        </button>
                    </div>
                </div>

                <div className="feature-list">
                    {featureTree.length === 0 ? (
                        <div className="empty-state">
                            <p>No features yet</p>
                            <small>Use AI prompt or toolbar to create features</small>
                        </div>
                    ) : (
                        featureTree.map(feature => (
                            <div
                                key={feature.id}
                                className={`feature-item ${selectedFeature === feature.id ? 'selected' : ''} ${feature.suppressed ? 'suppressed' : ''}`}
                                onClick={() => setSelectedFeature(feature.id)}
                            >
                                <span className="feature-icon">
                                    {getFeatureIcon(feature.type)}
                                </span>
                                <span className="feature-name">{feature.name}</span>
                                <div className="feature-actions">
                                    <button
                                        className="icon-btn"
                                        onClick={(e) => { e.stopPropagation(); toggleFeature(feature.id); }}
                                        title={feature.suppressed ? 'Unsuppress' : 'Suppress'}
                                    >
                                        👁
                                    </button>
                                    <button
                                        className="icon-btn"
                                        onClick={(e) => { e.stopPropagation(); deleteFeature(feature.id); }}
                                        title="Delete"
                                    >
                                        🗑
                                    </button>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </aside>

            {/* LEFT TOOLBAR - VERTICAL */}
            <aside className="workbench-tools">
                <div className="tool-section">
                    <h4>Select</h4>
                    <button
                        className={`tool-icon-button ${activeTool === 'select' ? 'active' : ''}`}
                        onClick={() => setActiveTool('select')}
                        title="Select"
                    >
                        ⬚
                    </button>
                    <button
                        className={`tool-icon-button ${activeTool === 'move' ? 'active' : ''}`}
                        onClick={() => setActiveTool('move')}
                        title="Move"
                    >
                        ✥
                    </button>
                </div>

                <div className="tool-separator"></div>

                <div className="tool-section">
                    <h4>Sketch</h4>
                    <button
                        className={`tool-icon-button ${activeTool === 'sketch' ? 'active' : ''}`}
                        onClick={() => setActiveTool('sketch')}
                        title="New Sketch"
                    >
                        ✎
                    </button>
                </div>

                <div className="tool-separator"></div>

                <div className="tool-section">
                    <h4>Features</h4>
                    <button
                        className="tool-icon-button"
                        onClick={() => addFeature('extrude')}
                        title="Extrude"
                    >
                        ⬆
                    </button>
                    <button
                        className="tool-icon-button"
                        onClick={() => addFeature('revolve')}
                        title="Revolve"
                    >
                        ⟳
                    </button>
                    <button
                        className="tool-icon-button"
                        onClick={() => addFeature('fillet')}
                        title="Fillet"
                    >
                        ⌒
                    </button>
                    <button
                        className="tool-icon-button"
                        onClick={() => addFeature('chamfer')}
                        title="Chamfer"
                    >
                        ⌐
                    </button>
                    <button
                        className="tool-icon-button"
                        onClick={() => addFeature('hole')}
                        title="Hole"
                    >
                        ⊙
                    </button>
                    <button
                        className="tool-icon-button"
                        onClick={() => addFeature('pattern')}
                        title="Pattern"
                    >
                        ▦
                    </button>
                </div>

                <div className="tool-separator"></div>

                <div className="tool-section">
                    <h4>Analysis</h4>
                    <button
                        className="tool-icon-button"
                        title="FEA Analysis"
                    >
                        📊
                    </button>
                    <button
                        className="tool-icon-button"
                        title="Motion Simulation"
                    >
                        🎬
                    </button>
                </div>
            </aside>

            {/* CENTER VIEWPORT */}
            <main className="workbench-viewport">
                <Viewport3D canvasId="render-canvas-mechanical" domain="mechanical" />

                {/* Viewport Overlay UI */}
                <div className="viewport-overlay">
                    <div className="viewport-info">
                        <span className="mode-indicator">{activeMode.toUpperCase()} MODE</span>
                        <span className="tool-indicator">{activeTool.toUpperCase()}</span>
                    </div>
                </div>
            </main>

            {/* RIGHT PROPERTIES PANEL */}
            <aside className="workbench-properties">
                {selectedFeature ? (
                    <>
                        <div className="property-section">
                            <h3 className="property-header">Feature Properties</h3>
                            <div className="property-row">
                                <span className="property-label">Feature Type</span>
                                <span className="property-value">
                                    {featureTree.find(f => f.id === selectedFeature)?.type || 'None'}
                                </span>
                            </div>
                        </div>

                        <div className="property-section">
                            <h3 className="property-header">Parameters</h3>
                            <div className="property-row">
                                <span className="property-label">Distance</span>
                                <input type="number" className="property-input" defaultValue="10.0" />
                            </div>
                            <div className="property-row">
                                <span className="property-label">Draft Angle</span>
                                <input type="number" className="property-input" defaultValue="0.0" />
                            </div>
                        </div>
                    </>
                ) : (
                    <div className="property-section">
                        <h3 className="property-header">No Selection</h3>
                        <p className="property-hint">Select a feature from the tree to edit its properties</p>
                    </div>
                )}

                <div className="property-section">
                    <h3 className="property-header">Material</h3>
                    <select className="property-input">
                        <option>Aluminum 6061</option>
                        <option>Steel 1045</option>
                        <option>Stainless Steel 304</option>
                        <option>Titanium Ti-6Al-4V</option>
                        <option>ABS Plastic</option>
                    </select>
                </div>

                <div className="property-section">
                    <h3 className="property-header">Actions</h3>
                    <button className="property-button">Run FEA Analysis</button>
                    <button className="property-button">Generate Toolpaths</button>
                    <button className="property-button">Export Model</button>
                </div>
            </aside>

            {/* BOTTOM AI PROMPT PANEL */}
            <div className="ai-prompt-panel">
                <div className="prompt-header">
                    <h3>🤖 AI Design Assistant</h3>
                    <span className="prompt-hint">Describe what you want to design...</span>
                </div>

                <div className="prompt-input-container">
                    <textarea
                        className="prompt-input"
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        placeholder="Example: Design a planetary gear assembly for EV motors with 0.005mm tolerances"
                        rows={2}
                        disabled={isGenerating}
                    />
                    <button
                        className="generate-button"
                        onClick={handleGenerateDesign}
                        disabled={isGenerating || !aiPrompt.trim()}
                    >
                        {isGenerating ? '⏳ Generating...' : '✨ Generate Design'}
                    </button>
                </div>

                {/* Design Variants Overlay */}
                {showVariants && (
                    <div className="variants-overlay">
                        <div className="variants-container">
                            <div className="variants-header">
                                <h3>Select a Design Variant</h3>
                                <button
                                    className="close-button"
                                    onClick={() => setShowVariants(false)}
                                >
                                    ✕
                                </button>
                            </div>

                            <div className="variants-grid">
                                {designVariants.map((variant, index) => (
                                    <div
                                        key={variant.id}
                                        className="variant-card"
                                        onClick={() => selectVariant(variant)}
                                    >
                                        <div className="variant-header">
                                            <h4>{variant.name}</h4>
                                            <span className="variant-badge">{variant.differentiator}</span>
                                        </div>

                                        <div className="variant-preview">
                                            {/* 3D preview would go here */}
                                            <div className="preview-placeholder">
                                                📦 {variant.baseSpec?.type}
                                            </div>
                                        </div>

                                        <div className="variant-details">
                                            <div className="detail-row">
                                                <span>Material:</span>
                                                <strong>{variant.baseSpec?.material?.primary}</strong>
                                            </div>
                                            <div className="detail-row">
                                                <span>Manufacturing:</span>
                                                <strong>{variant.baseSpec?.manufacturing?.method}</strong>
                                            </div>
                                            <div className="detail-row">
                                                <span>Est. Cost:</span>
                                                <strong>${variant.estimatedCost?.toFixed(2)}</strong>
                                            </div>
                                            <div className="detail-row">
                                                <span>Weight:</span>
                                                <strong>{variant.bom?.totalWeight?.toFixed(2)} kg</strong>
                                            </div>
                                        </div>

                                        <div className="variant-manufacturability">
                                            <span className={`status-badge ${variant.manufacturability?.overall}`}>
                                                {variant.manufacturability?.overall === 'pass' ? '✓ Manufacturable' : '⚠ Review Required'}
                                            </span>
                                        </div>

                                        <button className="select-variant-button">
                                            Select This Design
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Feature Creation Panel (Modal) */}
            {showFeaturePanel && (
                <div className="modal-overlay" onClick={() => setShowFeaturePanel(false)}>
                    <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>Create {featureParams.type}</h3>
                            <button onClick={() => setShowFeaturePanel(false)}>✕</button>
                        </div>

                        <div className="modal-body">
                            {featureParams.type === 'extrude' && (
                                <div className="param-row">
                                    <label>Distance (mm)</label>
                                    <input
                                        type="number"
                                        value={featureParams.distance}
                                        onChange={(e) => setFeatureParams({ ...featureParams, distance: e.target.value })}
                                    />
                                </div>
                            )}
                            {featureParams.type === 'revolve' && (
                                <div className="param-row">
                                    <label>Angle (degrees)</label>
                                    <input
                                        type="number"
                                        value={featureParams.angle}
                                        onChange={(e) => setFeatureParams({ ...featureParams, angle: e.target.value })}
                                    />
                                </div>
                            )}
                            {(featureParams.type === 'fillet' || featureParams.type === 'chamfer') && (
                                <div className="param-row">
                                    <label>Radius (mm)</label>
                                    <input
                                        type="number"
                                        value={featureParams.radius}
                                        onChange={(e) => setFeatureParams({ ...featureParams, radius: e.target.value })}
                                    />
                                </div>
                            )}
                        </div>

                        <div className="modal-footer">
                            <button className="cancel-button" onClick={() => setShowFeaturePanel(false)}>
                                Cancel
                            </button>
                            <button className="create-button" onClick={createFeature}>
                                Create Feature
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

// Helper function to get feature icon
function getFeatureIcon(featureType) {
    const icons = {
        'extrude': '⬆',
        'revolve': '⟳',
        'fillet': '⌒',
        'chamfer': '⌐',
        'hole': '⊙',
        'pattern': '▦',
        'imported': '📦',
        'sketch': '✎'
    };
    return icons[featureType] || '•';
}

export default WorkbenchMechanical;
