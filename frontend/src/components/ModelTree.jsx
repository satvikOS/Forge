import React from 'react';
import { ChevronDown, ChevronRight, Eye, EyeOff, Box, Layers, Trash2, Hash } from 'lucide-react';
import { useViewport } from '../contexts/ViewportContext';
import './ModelTree.css';

/**
 * ModelTree - Hierarchical model/component tree with IDs
 * Shows all generated models and their component hierarchy.
 * Each component has a unique ID for tracking and editing.
 */
function ModelTree() {
    const viewport = useViewport();
    if (!viewport) return null;

    const { models, selectedModelId, selectModel, removeModel, toggleComponentVisibility } = viewport;

    if (models.length === 0) {
        return (
            <div className="model-tree">
                <div className="model-tree-header">
                    <Layers size={12} />
                    <span>Model Tree</span>
                </div>
                <div className="model-tree-empty">
                    No models generated yet. Use the AI Console to create a model.
                </div>
            </div>
        );
    }

    return (
        <div className="model-tree">
            <div className="model-tree-header">
                <Layers size={12} />
                <span>Model Tree</span>
                <span className="model-tree-count">{models.length}</span>
            </div>
            <div className="model-tree-list">
                {models.map(model => (
                    <ModelNode
                        key={model.id}
                        model={model}
                        isSelected={model.id === selectedModelId}
                        onSelect={() => selectModel(model.id)}
                        onRemove={() => removeModel(model.id)}
                        onToggleVisibility={(compId) => toggleComponentVisibility(model.id, compId)}
                    />
                ))}
            </div>
        </div>
    );
}

function ModelNode({ model, isSelected, onSelect, onRemove, onToggleVisibility }) {
    const [expanded, setExpanded] = React.useState(true);

    return (
        <div className={`model-node ${isSelected ? 'selected' : ''}`}>
            {/* Model header */}
            <div className="model-node-header" onClick={onSelect}>
                <button
                    className="tree-toggle"
                    onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
                >
                    {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
                <Box size={12} className="model-icon" />
                <span className="model-node-name">{model.name}</span>
                <span className="model-node-id">{model.id}</span>
                <button
                    className="tree-action-btn"
                    title="Remove model"
                    onClick={(e) => { e.stopPropagation(); onRemove(); }}
                >
                    <Trash2 size={10} />
                </button>
            </div>

            {/* Component list */}
            {expanded && (
                <div className="model-node-children">
                    {model.components.map(comp => (
                        <div
                            key={comp.id}
                            className={`component-node ${!comp.visible ? 'hidden-comp' : ''}`}
                        >
                            <span className="component-indent" />
                            <Hash size={10} className="component-icon" />
                            <span className="component-name">{comp.name}</span>
                            <span className="component-id">{comp.id}</span>
                            <button
                                className="tree-action-btn"
                                title={comp.visible ? 'Hide' : 'Show'}
                                onClick={() => onToggleVisibility(comp.id)}
                            >
                                {comp.visible ? <Eye size={10} /> : <EyeOff size={10} />}
                            </button>
                        </div>
                    ))}
                    {/* Design ID row */}
                    <div className="component-node meta-row">
                        <span className="component-indent" />
                        <span className="meta-label">Design ID:</span>
                        <span className="meta-value">{model.designId}</span>
                    </div>
                    {/* Created date */}
                    <div className="component-node meta-row">
                        <span className="component-indent" />
                        <span className="meta-label">Created:</span>
                        <span className="meta-value">
                            {new Date(model.createdAt).toLocaleTimeString()}
                        </span>
                    </div>
                </div>
            )}
        </div>
    );
}

export default ModelTree;
