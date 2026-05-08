import { useState, useEffect, useCallback } from 'react';
import { useViewport } from '../contexts/ViewportContext';
import {
  getFeatureTree, getFeatureTreeData, updateFeatureParam,
  suppressFeature, deleteFeature, undoFeature, redoFeature,
} from '../workbenches/mechanical-cad/ToolExecutionEngine';

/**
 * Feature Tree Panel — shows parametric history and allows editing.
 * Each feature can be: selected, suppressed, deleted, or have parameters edited.
 */
export default function FeatureTreePanel({ onSelectFeature }) {
  const [features, setFeatures] = useState([]);
  const [selectedFeatureId, setSelectedFeatureId] = useState(null);
  const [editingParam, setEditingParam] = useState(null); // { featureId, key }
  const [expandedFeatures, setExpandedFeatures] = useState(new Set());
  const viewport = useViewport();

  // Subscribe to feature tree changes
  useEffect(() => {
    const ft = getFeatureTree();
    const unsubscribe = ft.onChange(() => {
      setFeatures(getFeatureTreeData());
    });
    setFeatures(getFeatureTreeData());
    return unsubscribe;
  }, []);

  const handleSelect = useCallback((featureId) => {
    setSelectedFeatureId(featureId);
    if (onSelectFeature) onSelectFeature(featureId);
  }, [onSelectFeature]);

  const handleSuppress = useCallback((featureId, e) => {
    e.stopPropagation();
    const feature = features.find(f => f.id === featureId);
    suppressFeature(featureId, !feature?.suppressed);
    setFeatures(getFeatureTreeData());
  }, [features]);

  const handleDelete = useCallback((featureId, e) => {
    e.stopPropagation();
    deleteFeature(featureId);
    setFeatures(getFeatureTreeData());
    if (selectedFeatureId === featureId) setSelectedFeatureId(null);
  }, [selectedFeatureId]);

  const handleParamChange = useCallback((featureId, key, value) => {
    const numVal = parseFloat(value);
    if (isNaN(numVal)) return;
    updateFeatureParam(featureId, key, numVal);
    setFeatures(getFeatureTreeData());
  }, []);

  const toggleExpand = useCallback((featureId, e) => {
    e.stopPropagation();
    setExpandedFeatures(prev => {
      const next = new Set(prev);
      if (next.has(featureId)) next.delete(featureId);
      else next.add(featureId);
      return next;
    });
  }, []);

  const handleUndo = useCallback(() => {
    undoFeature();
    setFeatures(getFeatureTreeData());
  }, []);

  const handleRedo = useCallback(() => {
    redoFeature();
    setFeatures(getFeatureTreeData());
  }, []);

  const featureIcon = (type) => {
    const icons = {
      box: '\u25A1', cylinder: '\u25CB', sphere: '\u25CF', cone: '\u25B3', torus: '\u25CE',
      extrude: '\u2195', revolve: '\u21BB', boolean_union: '\u222A', boolean_subtract: '\u2212',
      boolean_intersect: '\u2229', fillet: '\u2312', chamfer: '\u2334', loft: '\u2261',
      sweep: '\u21DD', pushpull: '\u2194', shell: '\u25A2', delete_face: '\u2717',
    };
    return icons[type] || '\u25A0';
  };

  const editableParams = (params) => {
    if (!params) return [];
    return Object.entries(params).filter(([key, val]) => {
      if (key === 'center' || key === 'profilePoints' || key === 'direction') return false;
      if (key === 'featureIdA' || key === 'featureIdB' || key === 'targetFeatureId') return false;
      if (key === 'axisOrigin' || key === 'axisDirection' || key === 'pathPoints') return false;
      if (key === 'edgeIds' || key === 'removeFaceIds' || key === 'profile' || key === 'profiles') return false;
      return typeof val === 'number';
    });
  };

  return (
    <div className="feature-tree-panel">
      <div className="feature-tree-header">
        <span className="feature-tree-title">Feature Tree</span>
        <div className="feature-tree-actions">
          <button className="ft-action-btn" onClick={handleUndo} title="Undo (Ctrl+Z)">
            &#x21B6;
          </button>
          <button className="ft-action-btn" onClick={handleRedo} title="Redo (Ctrl+Y)">
            &#x21B7;
          </button>
        </div>
      </div>

      <div className="feature-tree-list">
        {features.length === 0 && (
          <div className="feature-tree-empty">
            No features yet. Use Part Design tools to create geometry.
          </div>
        )}

        {features.map((feature, index) => (
          <div key={feature.id} className="feature-tree-item-wrapper">
            <div
              className={`feature-tree-item ${
                selectedFeatureId === feature.id ? 'selected' : ''
              } ${feature.suppressed ? 'suppressed' : ''} ${
                feature.hasErrors ? 'has-error' : ''
              }`}
              onClick={() => handleSelect(feature.id)}
            >
              {/* Connector line */}
              <div className="feature-tree-connector">
                {index < features.length - 1 && <div className="connector-line" />}
                <div className="connector-dot" />
              </div>

              {/* Icon + Name */}
              <span className="feature-tree-icon">{featureIcon(feature.type)}</span>
              <span className="feature-tree-name">{feature.name}</span>

              {/* Status badges */}
              {feature.hasErrors && <span className="ft-badge error" title={feature.errors.join(', ')}>!</span>}
              {feature.suppressed && <span className="ft-badge suppressed">S</span>}

              {/* Actions */}
              <div className="feature-tree-item-actions">
                {editableParams(feature.params).length > 0 && (
                  <button
                    className="ft-mini-btn"
                    onClick={(e) => toggleExpand(feature.id, e)}
                    title="Edit parameters"
                  >
                    {expandedFeatures.has(feature.id) ? '\u25B4' : '\u25BE'}
                  </button>
                )}
                <button
                  className="ft-mini-btn"
                  onClick={(e) => handleSuppress(feature.id, e)}
                  title={feature.suppressed ? 'Unsuppress' : 'Suppress'}
                >
                  {feature.suppressed ? '\u25CB' : '\u25CF'}
                </button>
                <button
                  className="ft-mini-btn delete"
                  onClick={(e) => handleDelete(feature.id, e)}
                  title="Delete feature"
                >
                  &#x2715;
                </button>
              </div>
            </div>

            {/* Expanded parameters */}
            {expandedFeatures.has(feature.id) && (
              <div className="feature-params-panel">
                {editableParams(feature.params).map(([key, val]) => (
                  <div key={key} className="feature-param-row">
                    <label className="feature-param-label">{key}</label>
                    <input
                      type="number"
                      step="0.1"
                      className="feature-param-input"
                      defaultValue={typeof val === 'number' ? val.toFixed(3) : val}
                      onBlur={(e) => handleParamChange(feature.id, key, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleParamChange(feature.id, key, e.target.value);
                      }}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Summary */}
      {features.length > 0 && (
        <div className="feature-tree-summary">
          {features.filter(f => !f.suppressed).length} active / {features.length} total
        </div>
      )}
    </div>
  );
}
