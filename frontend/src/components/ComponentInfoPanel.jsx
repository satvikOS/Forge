import React, { useState, useCallback } from 'react';
import { Info, AlertTriangle, CheckCircle, Edit3, Send, ChevronDown, ChevronUp, Layers } from 'lucide-react';
import { useViewport } from '../contexts/ViewportContext';
import './ComponentInfoPanel.css';

/**
 * ComponentInfoPanel - Nodal system info panel for selected components
 * Shows component details, per-component AI console for edits,
 * and compatibility checking with adjacent components.
 */
function ComponentInfoPanel() {
    const viewport = useViewport();
    const [editPrompt, setEditPrompt] = useState('');
    const [isEditing, setIsEditing] = useState(false);
    const [compatibilityResult, setCompatibilityResult] = useState(null);
    const [checkingCompat, setCheckingCompat] = useState(false);
    const [expanded, setExpanded] = useState(true);

    const selectedModel = viewport?.getSelectedModel?.();
    const models = viewport?.models || [];

    const handleEditSubmit = useCallback(async () => {
        if (!editPrompt.trim() || !selectedModel) return;
        setIsEditing(true);

        try {
            const res = await fetch('/api/ai/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    message: `Modify component "${selectedModel.name}" (ID: ${selectedModel.id}): ${editPrompt}`,
                    sessionId: `component_${selectedModel.id}`,
                }),
            });
            const data = await res.json();
            if (data.success) {
                setEditPrompt('');
                // If there are actions, they would be executed by the viewport
            }
        } catch (e) {
            console.error('Component edit failed:', e);
        } finally {
            setIsEditing(false);
        }
    }, [editPrompt, selectedModel]);

    const checkCompatibility = useCallback(async () => {
        if (!selectedModel) return;
        setCheckingCompat(true);

        try {
            const adjacentComponents = models
                .filter(m => m.id !== selectedModel.id)
                .map(m => ({
                    id: m.id,
                    name: m.name,
                    material: m.material,
                    transform: m.transform,
                    components: m.components,
                }));

            const res = await fetch('/api/ai/check-compatibility', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    component: {
                        id: selectedModel.id,
                        name: selectedModel.name,
                        material: selectedModel.material,
                        components: selectedModel.components,
                        transform: selectedModel.transform,
                    },
                    adjacentComponents,
                }),
            });
            const data = await res.json();
            if (data.success) {
                setCompatibilityResult(data);
            }
        } catch (e) {
            console.error('Compatibility check failed:', e);
        } finally {
            setCheckingCompat(false);
        }
    }, [selectedModel, models]);

    if (!selectedModel) {
        return (
            <div className="component-info-panel empty">
                <Info size={16} />
                <span>Select a model to see details</span>
            </div>
        );
    }

    return (
        <div className="component-info-panel">
            <div className="cip-header" onClick={() => setExpanded(!expanded)}>
                <Layers size={14} />
                <span className="cip-title">{selectedModel.name}</span>
                <span className="cip-id">{selectedModel.id}</span>
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </div>

            {expanded && (
                <div className="cip-body">
                    {/* Properties */}
                    <div className="cip-section">
                        <div className="cip-section-title">Properties</div>
                        <div className="cip-props">
                            <div className="cip-prop">
                                <span className="prop-label">Material</span>
                                <span className="prop-value">{selectedModel.material || 'Not set'}</span>
                            </div>
                            <div className="cip-prop">
                                <span className="prop-label">Components</span>
                                <span className="prop-value">{selectedModel.components?.length || 0}</span>
                            </div>
                            {selectedModel.massProperties && (
                                <>
                                    <div className="cip-prop">
                                        <span className="prop-label">Mass</span>
                                        <span className="prop-value">{selectedModel.massProperties.mass} kg</span>
                                    </div>
                                    <div className="cip-prop">
                                        <span className="prop-label">Volume</span>
                                        <span className="prop-value">{selectedModel.massProperties.volume} cm&sup3;</span>
                                    </div>
                                </>
                            )}
                        </div>
                    </div>

                    {/* Component List */}
                    {selectedModel.components?.length > 0 && (
                        <div className="cip-section">
                            <div className="cip-section-title">Components</div>
                            <div className="cip-component-list">
                                {selectedModel.components.map(comp => (
                                    <div key={comp.id} className="cip-component-item">
                                        <span className={`comp-vis ${comp.visible ? 'visible' : 'hidden'}`}></span>
                                        <span className="comp-name">{comp.name}</span>
                                        <span className="comp-id">{comp.id}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Compatibility Check */}
                    <div className="cip-section">
                        <div className="cip-section-title">Compatibility</div>
                        <button
                            className="compat-check-btn"
                            onClick={checkCompatibility}
                            disabled={checkingCompat || models.length < 2}
                        >
                            {checkingCompat ? 'Checking...' : 'Check Compatibility'}
                        </button>

                        {compatibilityResult && (
                            <div className={`compat-result ${compatibilityResult.compatible ? 'ok' : 'error'}`}>
                                <div className="compat-status">
                                    {compatibilityResult.compatible
                                        ? <><CheckCircle size={14} /> Compatible</>
                                        : <><AlertTriangle size={14} /> Issues Found</>
                                    }
                                </div>
                                {compatibilityResult.issues?.map((issue, i) => (
                                    <div key={i} className={`compat-issue severity-${issue.type}`}>
                                        <span className="issue-type">{issue.type}</span>
                                        <span className="issue-desc">{issue.description}</span>
                                        {issue.suggestion && (
                                            <span className="issue-fix">Fix: {issue.suggestion}</span>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Per-component AI Edit Console */}
                    <div className="cip-section">
                        <div className="cip-section-title">
                            <Edit3 size={12} />
                            AI Edit
                        </div>
                        <div className="cip-edit-console">
                            <input
                                type="text"
                                className="cip-edit-input"
                                placeholder="e.g., Add 4 M6 holes on 50mm PCD..."
                                value={editPrompt}
                                onChange={(e) => setEditPrompt(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleEditSubmit()}
                                disabled={isEditing}
                            />
                            <button
                                className="cip-edit-send"
                                onClick={handleEditSubmit}
                                disabled={!editPrompt.trim() || isEditing}
                            >
                                <Send size={12} />
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ComponentInfoPanel;
