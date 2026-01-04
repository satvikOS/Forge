/**
 * Object Inspector - Display and edit properties of selected objects
 * Part of Issue #28 - Enhanced Detail and Editing
 */

import { useState, useEffect } from 'react';

function ObjectInspector({ selectedObject, onPropertyChange, onClose }) {
  const [editedProperties, setEditedProperties] = useState({});

  useEffect(() => {
    if (selectedObject) {
      // Initialize edited properties from selected object
      setEditedProperties({
        name: selectedObject.name || '',
        position: { ...selectedObject.position },
        rotation: { ...selectedObject.rotation },
        scale: { ...selectedObject.scale },
        material: { ...selectedObject.material },
        ...(selectedObject.geometry ? {
          geometry: { ...selectedObject.geometry }
        } : {}),
      });
    }
  }, [selectedObject]);

  if (!selectedObject) {
    return (
      <div style={styles.container}>
        <div style={styles.header}>
          <h3 style={styles.title}>Object Inspector</h3>
        </div>
        <div style={styles.content}>
          <p style={styles.emptyMessage}>No object selected</p>
          <p style={styles.hint}>Select an object in the scene to edit its properties</p>
        </div>
      </div>
    );
  }

  const handleInputChange = (category, property, value) => {
    const newValue = parseFloat(value) || 0;
    setEditedProperties(prev => ({
      ...prev,
      [category]: {
        ...prev[category],
        [property]: newValue,
      }
    }));

    // Notify parent of change immediately
    if (onPropertyChange) {
      onPropertyChange(selectedObject.id, category, property, newValue);
    }
  };

  const handleMaterialChange = (property, value) => {
    setEditedProperties(prev => ({
      ...prev,
      material: {
        ...prev.material,
        [property]: value,
      }
    }));

    if (onPropertyChange) {
      onPropertyChange(selectedObject.id, 'material', property, value);
    }
  };

  const renderVector3Input = (label, category, values) => (
    <div style={styles.propertyGroup}>
      <label style={styles.label}>{label}</label>
      <div style={styles.vector3Container}>
        {['x', 'y', 'z'].map(axis => (
          <div key={axis} style={styles.axisInput}>
            <span style={styles.axisLabel}>{axis.toUpperCase()}</span>
            <input
              type="number"
              step="0.1"
              value={values?.[axis]?.toFixed(2) || 0}
              onChange={(e) => handleInputChange(category, axis, e.target.value)}
              style={styles.input}
            />
          </div>
        ))}
      </div>
    </div>
  );

  const renderGeometryInputs = () => {
    const geom = editedProperties.geometry;
    if (!geom) return null;

    return (
      <div style={styles.section}>
        <h4 style={styles.sectionTitle}>Geometry</h4>
        <div style={styles.propertyGroup}>
          <label style={styles.label}>Type</label>
          <input
            type="text"
            value={geom.type || 'unknown'}
            disabled
            style={{ ...styles.input, ...styles.disabledInput }}
          />
        </div>
        
        {geom.type === 'box' && (
          <>
            <div style={styles.propertyGroup}>
              <label style={styles.label}>Width</label>
              <input
                type="number"
                step="0.1"
                value={geom.width?.toFixed(2) || 1}
                onChange={(e) => handleInputChange('geometry', 'width', e.target.value)}
                style={styles.input}
              />
            </div>
            <div style={styles.propertyGroup}>
              <label style={styles.label}>Height</label>
              <input
                type="number"
                step="0.1"
                value={geom.height?.toFixed(2) || 1}
                onChange={(e) => handleInputChange('geometry', 'height', e.target.value)}
                style={styles.input}
              />
            </div>
            <div style={styles.propertyGroup}>
              <label style={styles.label}>Depth</label>
              <input
                type="number"
                step="0.1"
                value={geom.depth?.toFixed(2) || 1}
                onChange={(e) => handleInputChange('geometry', 'depth', e.target.value)}
                style={styles.input}
              />
            </div>
          </>
        )}
        
        {geom.type === 'sphere' && (
          <div style={styles.propertyGroup}>
            <label style={styles.label}>Radius</label>
            <input
              type="number"
              step="0.1"
              value={geom.radius?.toFixed(2) || 0.5}
              onChange={(e) => handleInputChange('geometry', 'radius', e.target.value)}
              style={styles.input}
            />
          </div>
        )}
        
        {geom.type === 'cylinder' && (
          <>
            <div style={styles.propertyGroup}>
              <label style={styles.label}>Radius Top</label>
              <input
                type="number"
                step="0.1"
                value={geom.radiusTop?.toFixed(2) || 0.5}
                onChange={(e) => handleInputChange('geometry', 'radiusTop', e.target.value)}
                style={styles.input}
              />
            </div>
            <div style={styles.propertyGroup}>
              <label style={styles.label}>Radius Bottom</label>
              <input
                type="number"
                step="0.1"
                value={geom.radiusBottom?.toFixed(2) || 0.5}
                onChange={(e) => handleInputChange('geometry', 'radiusBottom', e.target.value)}
                style={styles.input}
              />
            </div>
            <div style={styles.propertyGroup}>
              <label style={styles.label}>Height</label>
              <input
                type="number"
                step="0.1"
                value={geom.height?.toFixed(2) || 1}
                onChange={(e) => handleInputChange('geometry', 'height', e.target.value)}
                style={styles.input}
              />
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <h3 style={styles.title}>Object Inspector</h3>
        {onClose && (
          <button onClick={onClose} style={styles.closeButton}>×</button>
        )}
      </div>
      
      <div style={styles.content}>
        {/* Object Info */}
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Object Info</h4>
          <div style={styles.propertyGroup}>
            <label style={styles.label}>Name</label>
            <input
              type="text"
              value={editedProperties.name || ''}
              onChange={(e) => {
                setEditedProperties(prev => ({ ...prev, name: e.target.value }));
                if (onPropertyChange) {
                  onPropertyChange(selectedObject.id, 'name', null, e.target.value);
                }
              }}
              style={styles.input}
            />
          </div>
          <div style={styles.propertyGroup}>
            <label style={styles.label}>ID</label>
            <input
              type="text"
              value={selectedObject.id || ''}
              disabled
              style={{ ...styles.input, ...styles.disabledInput }}
            />
          </div>
          {selectedObject.userData?.componentType && (
            <div style={styles.propertyGroup}>
              <label style={styles.label}>Component Type</label>
              <input
                type="text"
                value={selectedObject.userData.componentType}
                disabled
                style={{ ...styles.input, ...styles.disabledInput }}
              />
            </div>
          )}
        </div>

        {/* Transform */}
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Transform</h4>
          {renderVector3Input('Position', 'position', editedProperties.position)}
          {renderVector3Input('Rotation', 'rotation', editedProperties.rotation)}
          {renderVector3Input('Scale', 'scale', editedProperties.scale)}
        </div>

        {/* Geometry */}
        {renderGeometryInputs()}

        {/* Material */}
        <div style={styles.section}>
          <h4 style={styles.sectionTitle}>Material</h4>
          <div style={styles.propertyGroup}>
            <label style={styles.label}>Color</label>
            <input
              type="color"
              value={editedProperties.material?.color || '#4a90e2'}
              onChange={(e) => handleMaterialChange('color', e.target.value)}
              style={styles.colorInput}
            />
          </div>
          <div style={styles.propertyGroup}>
            <label style={styles.label}>Metalness</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={editedProperties.material?.metalness || 0.3}
              onChange={(e) => handleMaterialChange('metalness', parseFloat(e.target.value))}
              style={styles.slider}
            />
            <span style={styles.sliderValue}>
              {(editedProperties.material?.metalness || 0.3).toFixed(2)}
            </span>
          </div>
          <div style={styles.propertyGroup}>
            <label style={styles.label}>Roughness</label>
            <input
              type="range"
              min="0"
              max="1"
              step="0.01"
              value={editedProperties.material?.roughness || 0.7}
              onChange={(e) => handleMaterialChange('roughness', parseFloat(e.target.value))}
              style={styles.slider}
            />
            <span style={styles.sliderValue}>
              {(editedProperties.material?.roughness || 0.7).toFixed(2)}
            </span>
          </div>
        </div>

        {/* Metadata */}
        {selectedObject.userData && Object.keys(selectedObject.userData).length > 0 && (
          <div style={styles.section}>
            <h4 style={styles.sectionTitle}>Metadata</h4>
            {selectedObject.userData.floorNumber !== undefined && (
              <div style={styles.propertyGroup}>
                <label style={styles.label}>Floor Number</label>
                <input
                  type="text"
                  value={selectedObject.userData.floorNumber}
                  disabled
                  style={{ ...styles.input, ...styles.disabledInput }}
                />
              </div>
            )}
            {selectedObject.userData.level !== undefined && (
              <div style={styles.propertyGroup}>
                <label style={styles.label}>Hierarchy Level</label>
                <input
                  type="text"
                  value={selectedObject.userData.level}
                  disabled
                  style={{ ...styles.input, ...styles.disabledInput }}
                />
              </div>
            )}
            {selectedObject.userData.editable !== undefined && (
              <div style={styles.propertyGroup}>
                <label style={styles.label}>Editable</label>
                <input
                  type="checkbox"
                  checked={selectedObject.userData.editable}
                  disabled
                  style={styles.checkbox}
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    width: '100%',
    height: '100%',
    backgroundColor: '#1a1a1a',
    color: '#e0e0e0',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  },
  header: {
    padding: '15px',
    borderBottom: '1px solid #333',
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  title: {
    margin: 0,
    fontSize: '16px',
    fontWeight: '600',
  },
  closeButton: {
    background: 'none',
    border: 'none',
    color: '#999',
    fontSize: '24px',
    cursor: 'pointer',
    padding: '0 5px',
    lineHeight: '20px',
  },
  content: {
    flex: 1,
    overflowY: 'auto',
    padding: '15px',
  },
  emptyMessage: {
    color: '#999',
    textAlign: 'center',
    marginTop: '50px',
  },
  hint: {
    color: '#666',
    fontSize: '12px',
    textAlign: 'center',
    marginTop: '10px',
  },
  section: {
    marginBottom: '20px',
  },
  sectionTitle: {
    fontSize: '14px',
    fontWeight: '600',
    marginBottom: '10px',
    color: '#4a90e2',
  },
  propertyGroup: {
    marginBottom: '12px',
  },
  label: {
    display: 'block',
    fontSize: '12px',
    color: '#999',
    marginBottom: '5px',
  },
  input: {
    width: '100%',
    padding: '6px 8px',
    backgroundColor: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '4px',
    color: '#e0e0e0',
    fontSize: '12px',
    boxSizing: 'border-box',
  },
  disabledInput: {
    opacity: 0.5,
    cursor: 'not-allowed',
  },
  vector3Container: {
    display: 'flex',
    gap: '8px',
  },
  axisInput: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  axisLabel: {
    fontSize: '10px',
    color: '#666',
    fontWeight: '600',
  },
  colorInput: {
    width: '100%',
    height: '32px',
    padding: '2px',
    backgroundColor: '#2a2a2a',
    border: '1px solid #444',
    borderRadius: '4px',
    cursor: 'pointer',
  },
  slider: {
    width: 'calc(100% - 50px)',
    verticalAlign: 'middle',
  },
  sliderValue: {
    marginLeft: '10px',
    fontSize: '12px',
    color: '#999',
  },
  checkbox: {
    marginTop: '5px',
  },
};

export default ObjectInspector;
