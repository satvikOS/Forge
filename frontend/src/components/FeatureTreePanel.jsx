import { useState, useEffect, useCallback, useRef } from 'react';
import { useViewport } from '../contexts/ViewportContext';
import {
  getFeatureTree, getFeatureTreeData, updateFeatureParam,
  suppressFeature, deleteFeature, undoFeature, redoFeature,
} from '../workbenches/mechanical-cad/ToolExecutionEngine';

/**
 * Professional Feature Tree Panel.
 * - Drag-reorder
 * - Right-click context menu (Edit, Suppress, Delete, Rename)
 * - Rollback bar — drag a marker to roll back/forward through history
 * - Inline parameter editing
 * - Feature icons with proper typing
 */
export default function FeatureTreePanel({ onSelectFeature }) {
  const [features, setFeatures] = useState([]);
  const [selectedFeatureId, setSelectedFeatureId] = useState(null);
  const [expandedFeatures, setExpandedFeatures] = useState(new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const [renameMode, setRenameMode] = useState(null); // featureId
  const [renameValue, setRenameValue] = useState('');
  const [draggedId, setDraggedId] = useState(null);
  const [dragOverId, setDragOverId] = useState(null);
  const [rollbackIndex, setRollbackIndex] = useState(-1); // -1 = at end (all features active)
  const [filterText, setFilterText] = useState('');
  const viewport = useViewport();

  useEffect(() => {
    const ft = getFeatureTree();
    const unsubscribe = ft.onChange(() => {
      setFeatures(getFeatureTreeData());
    });
    setFeatures(getFeatureTreeData());
    return unsubscribe;
  }, []);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    document.addEventListener('click', close);
    document.addEventListener('contextmenu', close);
    return () => {
      document.removeEventListener('click', close);
      document.removeEventListener('contextmenu', close);
    };
  }, [contextMenu]);

  const handleSelect = useCallback((featureId) => {
    setSelectedFeatureId(featureId);
    if (onSelectFeature) onSelectFeature(featureId);
  }, [onSelectFeature]);

  const handleSuppress = useCallback((featureId) => {
    const feature = features.find(f => f.id === featureId);
    suppressFeature(featureId, !feature?.suppressed);
    setFeatures(getFeatureTreeData());
  }, [features]);

  const handleDelete = useCallback((featureId) => {
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
    e?.stopPropagation();
    setExpandedFeatures(prev => {
      const next = new Set(prev);
      if (next.has(featureId)) next.delete(featureId);
      else next.add(featureId);
      return next;
    });
  }, []);

  const handleContextMenu = useCallback((e, feature) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, feature });
  }, []);

  const startRename = useCallback((feature) => {
    setRenameMode(feature.id);
    setRenameValue(feature.name);
    setContextMenu(null);
  }, []);

  const commitRename = useCallback((featureId) => {
    if (renameValue.trim()) {
      const ft = getFeatureTree();
      const f = ft.features.find(x => x.id === featureId);
      if (f) f.name = renameValue.trim();
      setFeatures(getFeatureTreeData());
    }
    setRenameMode(null);
  }, [renameValue]);

  // Drag-reorder
  const handleDragStart = useCallback((e, id) => {
    setDraggedId(id);
    e.dataTransfer.effectAllowed = 'move';
  }, []);

  const handleDragOver = useCallback((e, id) => {
    e.preventDefault();
    if (id !== draggedId) setDragOverId(id);
  }, [draggedId]);

  const handleDrop = useCallback((e, targetId) => {
    e.preventDefault();
    if (!draggedId || draggedId === targetId) {
      setDraggedId(null);
      setDragOverId(null);
      return;
    }
    const ft = getFeatureTree();
    const fromIdx = ft.features.findIndex(f => f.id === draggedId);
    const toIdx = ft.features.findIndex(f => f.id === targetId);
    if (fromIdx >= 0 && toIdx >= 0) {
      const [moved] = ft.features.splice(fromIdx, 1);
      ft.features.splice(toIdx, 0, moved);
      ft._notify('reordered', { from: fromIdx, to: toIdx });
      setFeatures(getFeatureTreeData());
    }
    setDraggedId(null);
    setDragOverId(null);
  }, [draggedId]);

  const handleRollback = useCallback((index) => {
    setRollbackIndex(index);
    const ft = getFeatureTree();
    // Suppress features after the rollback index
    ft.features.forEach((f, i) => {
      const shouldSuppress = index >= 0 && i > index;
      if (f.suppressed !== shouldSuppress) {
        suppressFeature(f.id, shouldSuppress);
      }
    });
    setFeatures(getFeatureTreeData());
  }, []);

  const featureIcon = (type) => {
    const icons = {
      box: '▢', cylinder: '○', sphere: '●', cone: '△', torus: '◎',
      extrude: '⬆', extrude_cut: '⬇', revolve: '↻', revolve_cut: '↺',
      boolean_union: '∪', boolean_subtract: '−', boolean_intersect: '∩',
      fillet: '◜', chamfer: '◿', loft: '⋈', sweep: '↝',
      pushpull: '↔', shell: '▢', delete_face: '✗', hole: '◉',
    };
    return icons[type] || '◆';
  };

  const editableParams = (params) => {
    if (!params) return [];
    return Object.entries(params).filter(([key, val]) => {
      if (['center', 'profilePoints', 'direction', 'featureIdA', 'featureIdB',
           'targetFeatureId', 'axisOrigin', 'axisDirection', 'pathPoints',
           'edgeIds', 'removeFaceIds', 'profile', 'profiles'].includes(key)) return false;
      return typeof val === 'number';
    });
  };

  const filteredFeatures = filterText
    ? features.filter(f => f.name.toLowerCase().includes(filterText.toLowerCase()))
    : features;

  const activeCount = features.filter(f => !f.suppressed).length;

  return (
    <div className="feature-tree-panel">
      {/* Header */}
      <div className="feature-tree-header">
        <span className="feature-tree-title">Feature Manager</span>
        <div className="feature-tree-actions">
          <button className="ft-action-btn" onClick={() => { undoFeature(); setFeatures(getFeatureTreeData()); }} title="Undo (Ctrl+Z)">↶</button>
          <button className="ft-action-btn" onClick={() => { redoFeature(); setFeatures(getFeatureTreeData()); }} title="Redo (Ctrl+Y)">↷</button>
        </div>
      </div>

      {/* Search/filter */}
      {features.length > 3 && (
        <div className="ft-search-row">
          <input
            type="text"
            placeholder="Filter features..."
            className="ft-search"
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
          />
        </div>
      )}

      {/* Feature list */}
      <div className="feature-tree-list">
        {filteredFeatures.length === 0 && (
          <div className="feature-tree-empty">
            {filterText ? 'No features match filter' : 'No features yet. Use Part Design tools.'}
          </div>
        )}

        {filteredFeatures.map((feature, index) => {
          const isRollbackPoint = rollbackIndex === index;
          const isAfterRollback = rollbackIndex >= 0 && index > rollbackIndex;

          return (
            <div
              key={feature.id}
              className={`feature-tree-item-wrapper ${dragOverId === feature.id ? 'drag-over' : ''} ${draggedId === feature.id ? 'dragging' : ''}`}
              draggable
              onDragStart={(e) => handleDragStart(e, feature.id)}
              onDragOver={(e) => handleDragOver(e, feature.id)}
              onDrop={(e) => handleDrop(e, feature.id)}
              onDragEnd={() => { setDraggedId(null); setDragOverId(null); }}
            >
              <div
                className={`feature-tree-item ${selectedFeatureId === feature.id ? 'selected' : ''} ${feature.suppressed ? 'suppressed' : ''} ${feature.hasErrors ? 'has-error' : ''} ${isAfterRollback ? 'rollback-after' : ''}`}
                onClick={() => handleSelect(feature.id)}
                onContextMenu={(e) => handleContextMenu(e, feature)}
              >
                <div className="feature-tree-connector">
                  {index < filteredFeatures.length - 1 && <div className="connector-line" />}
                  <div className="connector-dot" />
                </div>

                <span className="feature-tree-icon">{featureIcon(feature.type)}</span>

                {renameMode === feature.id ? (
                  <input
                    className="ft-rename-input"
                    value={renameValue}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => commitRename(feature.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(feature.id);
                      if (e.key === 'Escape') setRenameMode(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <span className="feature-tree-name" onDoubleClick={() => startRename(feature)}>
                    {feature.name}
                  </span>
                )}

                {feature.hasErrors && <span className="ft-badge error" title={feature.errors?.join(', ')}>!</span>}
                {feature.suppressed && <span className="ft-badge suppressed">S</span>}

                <div className="feature-tree-item-actions">
                  {editableParams(feature.params).length > 0 && (
                    <button className="ft-mini-btn" onClick={(e) => toggleExpand(feature.id, e)} title="Parameters">
                      {expandedFeatures.has(feature.id) ? '▴' : '▾'}
                    </button>
                  )}
                  <button className="ft-mini-btn" onClick={(e) => { e.stopPropagation(); handleSuppress(feature.id); }} title="Suppress">
                    {feature.suppressed ? '○' : '●'}
                  </button>
                </div>
              </div>

              {expandedFeatures.has(feature.id) && (
                <div className="feature-params-panel">
                  {editableParams(feature.params).map(([key, val]) => (
                    <div key={key} className="feature-param-row">
                      <label className="feature-param-label">{key}</label>
                      <input
                        type="number"
                        step="0.001"
                        className="feature-param-input"
                        defaultValue={typeof val === 'number' ? val.toFixed(4) : val}
                        onBlur={(e) => handleParamChange(feature.id, key, e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleParamChange(feature.id, key, e.target.value); }}
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Rollback marker */}
              <div
                className={`rollback-marker ${isRollbackPoint ? 'active' : ''}`}
                onClick={() => handleRollback(rollbackIndex === index ? -1 : index)}
                title={rollbackIndex === index ? 'Roll forward (clear)' : 'Roll back to here'}
              />
            </div>
          );
        })}
      </div>

      {/* Summary */}
      {features.length > 0 && (
        <div className="feature-tree-summary">
          <span>{activeCount} active / {features.length} total</span>
          {rollbackIndex >= 0 && (
            <button className="ft-action-btn" onClick={() => handleRollback(-1)} title="Clear rollback">⟲</button>
          )}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          className="ft-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button onClick={() => { toggleExpand(contextMenu.feature.id); setContextMenu(null); }}>
            <span className="ft-ctx-icon">⚙</span> Edit Parameters
          </button>
          <button onClick={() => startRename(contextMenu.feature)}>
            <span className="ft-ctx-icon">✎</span> Rename
          </button>
          <button onClick={() => { handleSuppress(contextMenu.feature.id); setContextMenu(null); }}>
            <span className="ft-ctx-icon">{contextMenu.feature.suppressed ? '◯' : '●'}</span>
            {contextMenu.feature.suppressed ? 'Unsuppress' : 'Suppress'}
          </button>
          <div className="ft-ctx-divider"></div>
          <button onClick={() => { handleSelect(contextMenu.feature.id); setContextMenu(null); }}>
            <span className="ft-ctx-icon">→</span> Go To Feature
          </button>
          <div className="ft-ctx-divider"></div>
          <button className="ft-ctx-delete" onClick={() => { handleDelete(contextMenu.feature.id); setContextMenu(null); }}>
            <span className="ft-ctx-icon">✗</span> Delete
          </button>
        </div>
      )}
    </div>
  );
}
