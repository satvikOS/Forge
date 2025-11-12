/**
 * Scene Hierarchy Panel - Object tree view and layer management
 */

import { useState, useEffect } from 'react';

const ObjectItem = ({ object, isSelected, onSelect, onVisibilityToggle, onLockToggle, level = 0 }) => {
  const [isExpanded, setIsExpanded] = useState(true);
  const hasChildren = object.children && object.children.length > 0;

  const getTypeIcon = (type) => {
    const icons = {
      box: '⬛',
      sphere: '⚫',
      cylinder: '⬭',
      cone: '🔺',
      plane: '▭',
      torus: '⭕',
      icosphere: '⬢',
      circle: '○',
      grid: '⊞',
      point_light: '💡',
      directional_light: '☀️',
      spot_light: '🔦',
      area_light: '▭',
      camera: '📷',
    };
    return icons[type] || '📦';
  };

  return (
    <div style={{ marginLeft: `${level * 16}px` }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 8px',
          background: isSelected ? 'var(--accent-orange)' : 'transparent',
          borderRadius: '4px',
          cursor: 'pointer',
          fontSize: '12px',
          color: isSelected ? 'white' : 'var(--text-primary)',
          marginBottom: '2px',
        }}
        onClick={() => onSelect(object.id)}
        onMouseEnter={(e) => {
          if (!isSelected) {
            e.currentTarget.style.background = 'var(--bg-hover)';
          }
        }}
        onMouseLeave={(e) => {
          if (!isSelected) {
            e.currentTarget.style.background = 'transparent';
          }
        }}
      >
        {/* Expand/Collapse */}
        {hasChildren ? (
          <span
            onClick={(e) => {
              e.stopPropagation();
              setIsExpanded(!isExpanded);
            }}
            style={{ marginRight: '4px', cursor: 'pointer', width: '12px' }}
          >
            {isExpanded ? '▾' : '▸'}
          </span>
        ) : (
          <span style={{ marginRight: '4px', width: '12px' }}></span>
        )}

        {/* Type Icon */}
        <span style={{ marginRight: '6px' }}>{getTypeIcon(object.type)}</span>

        {/* Name */}
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {object.name}
        </span>

        {/* Visibility Toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onVisibilityToggle(object.id);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '0 4px',
            color: isSelected ? 'white' : 'var(--text-secondary)',
            opacity: object.visible ? 1 : 0.5,
          }}
          title={object.visible ? 'Hide' : 'Show'}
        >
          {object.visible ? '👁️' : '🚫'}
        </button>

        {/* Lock Toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onLockToggle(object.id);
          }}
          style={{
            background: 'transparent',
            border: 'none',
            cursor: 'pointer',
            fontSize: '12px',
            padding: '0 4px',
            color: isSelected ? 'white' : 'var(--text-secondary)',
          }}
          title={object.locked ? 'Unlock' : 'Lock'}
        >
          {object.locked ? '🔒' : '🔓'}
        </button>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div>
          {object.children.map(child => (
            <ObjectItem
              key={child.id}
              object={child}
              isSelected={isSelected}
              onSelect={onSelect}
              onVisibilityToggle={onVisibilityToggle}
              onLockToggle={onLockToggle}
              level={level + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default function SceneHierarchyPanel({ sceneManager, selectedObjects, onObjectSelect }) {
  const [objects, setObjects] = useState([]);
  const [layers, setLayers] = useState([]);
  const [activeLayer, setActiveLayer] = useState('default');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    const updateScene = () => {
      setObjects(sceneManager.getAllObjects().filter(obj => !obj.parent));
      setLayers(Array.from(sceneManager.layers.values()));
      setActiveLayer(sceneManager.activeLayer);
    };

    updateScene();
    const interval = setInterval(updateScene, 200);
    return () => clearInterval(interval);
  }, [sceneManager]);

  const handleVisibilityToggle = (objectId) => {
    const obj = sceneManager.getObject(objectId);
    if (obj) {
      obj.visible = !obj.visible;
    }
  };

  const handleLockToggle = (objectId) => {
    const obj = sceneManager.getObject(objectId);
    if (obj) {
      obj.locked = !obj.locked;
    }
  };

  const filteredObjects = searchQuery
    ? objects.filter(obj => obj.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : objects;

  return (
    <div style={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      background: 'var(--bg-secondary)',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-tertiary)',
      }}>
        <div style={{
          fontSize: '14px',
          fontWeight: 'bold',
          color: 'var(--text-primary)',
          marginBottom: '8px',
        }}>
          Scene Hierarchy
        </div>

        {/* Search */}
        <input
          type="text"
          placeholder="Search objects..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{
            width: '100%',
            padding: '6px 10px',
            background: 'var(--bg-primary)',
            border: '1px solid var(--border-color)',
            borderRadius: '4px',
            color: 'var(--text-primary)',
            fontSize: '12px',
          }}
        />
      </div>

      {/* Objects List */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '8px',
      }}>
        {filteredObjects.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '20px',
            color: 'var(--text-secondary)',
            fontSize: '12px',
          }}>
            {searchQuery ? 'No objects found' : 'No objects in scene'}
            <div style={{ marginTop: '8px', fontSize: '11px' }}>
              Use the toolbar to add objects
            </div>
          </div>
        ) : (
          filteredObjects.map(obj => (
            <ObjectItem
              key={obj.id}
              object={obj}
              isSelected={selectedObjects.has(obj.id)}
              onSelect={onObjectSelect}
              onVisibilityToggle={handleVisibilityToggle}
              onLockToggle={handleLockToggle}
            />
          ))
        )}
      </div>

      {/* Footer - Object Count */}
      <div style={{
        padding: '8px 12px',
        borderTop: '1px solid var(--border-color)',
        background: 'var(--bg-tertiary)',
        fontSize: '11px',
        color: 'var(--text-secondary)',
        display: 'flex',
        justifyContent: 'space-between',
      }}>
        <span>Total: {objects.length}</span>
        <span>Selected: {selectedObjects.size}</span>
      </div>
    </div>
  );
}
