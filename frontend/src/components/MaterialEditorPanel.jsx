/**
 * Material Editor Panel - UI for managing materials
 */

import { useState, useEffect } from 'react';

const MaterialPreview = ({ material, isSelected, onClick }) => (
  <div
    onClick={onClick}
    style={{
      padding: '10px',
      background: isSelected ? 'var(--accent-orange)' : 'var(--bg-tertiary)',
      borderRadius: '6px',
      cursor: 'pointer',
      border: `1px solid ${isSelected ? 'var(--accent-orange)' : 'var(--border-color)'}`,
      transition: 'all 0.2s',
    }}
    onMouseEnter={(e) => {
      if (!isSelected) {
        e.currentTarget.style.background = 'var(--bg-hover)';
      }
    }}
    onMouseLeave={(e) => {
      if (!isSelected) {
        e.currentTarget.style.background = 'var(--bg-tertiary)';
      }
    }}
  >
    <div style={{
      width: '100%',
      height: '60px',
      background: material.properties.color,
      borderRadius: '4px',
      marginBottom: '8px',
      border: '1px solid var(--border-color)',
    }} />
    <div style={{
      fontSize: '12px',
      color: isSelected ? 'white' : 'var(--text-primary)',
      fontWeight: isSelected ? 'bold' : 'normal',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    }}>
      {material.name}
    </div>
    <div style={{
      fontSize: '10px',
      color: isSelected ? 'rgba(255,255,255,0.8)' : 'var(--text-secondary)',
      marginTop: '2px',
    }}>
      {material.type}
    </div>
  </div>
);

const PropertySlider = ({ label, value, min, max, step, onChange }) => (
  <div style={{ marginBottom: '12px' }}>
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: '4px',
      fontSize: '11px',
      color: 'var(--text-secondary)',
    }}>
      <span>{label}</span>
      <span>{value.toFixed(2)}</span>
    </div>
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(parseFloat(e.target.value))}
      style={{
        width: '100%',
        accentColor: 'var(--accent-orange)',
      }}
    />
  </div>
);

const ColorPicker = ({ label, value, onChange }) => (
  <div style={{ marginBottom: '12px' }}>
    <div style={{
      fontSize: '11px',
      color: 'var(--text-secondary)',
      marginBottom: '4px',
    }}>
      {label}
    </div>
    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: '40px',
          height: '30px',
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
          cursor: 'pointer',
        }}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          flex: 1,
          padding: '6px 8px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
          color: 'var(--text-primary)',
          fontSize: '11px',
          fontFamily: 'monospace',
        }}
      />
    </div>
  </div>
);

export default function MaterialEditorPanel({ materialLibrary, onApplyMaterial }) {
  const [materials, setMaterials] = useState([]);
  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [activeTab, setActiveTab] = useState('library');

  useEffect(() => {
    if (materialLibrary) {
      setMaterials(materialLibrary.getAllMaterials());
      if (!selectedMaterial && materials.length > 0) {
        setSelectedMaterial(materials[0]);
      }
    }
  }, [materialLibrary]);

  const handlePropertyChange = (key, value) => {
    if (selectedMaterial) {
      selectedMaterial.setProperty(key, value);
      setMaterials([...materialLibrary.getAllMaterials()]);
    }
  };

  const handleCreateNew = () => {
    if (materialLibrary) {
      const newMat = materialLibrary.createMaterial('New Material', 'standard');
      setMaterials(materialLibrary.getAllMaterials());
      setSelectedMaterial(newMat);
    }
  };

  const handleDuplicate = () => {
    if (materialLibrary && selectedMaterial) {
      const duplicated = materialLibrary.duplicateMaterial(selectedMaterial.id);
      setMaterials(materialLibrary.getAllMaterials());
      setSelectedMaterial(duplicated);
    }
  };

  const handleDelete = () => {
    if (materialLibrary && selectedMaterial) {
      materialLibrary.deleteMaterial(selectedMaterial.id);
      setMaterials(materialLibrary.getAllMaterials());
      setSelectedMaterial(materials[0] || null);
    }
  };

  const handleApply = () => {
    if (selectedMaterial && onApplyMaterial) {
      onApplyMaterial(selectedMaterial);
    }
  };

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
          Material Editor
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', gap: '4px' }}>
          {['library', 'properties'].map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: '6px 12px',
                background: activeTab === tab ? 'var(--accent-orange)' : 'var(--bg-primary)',
                border: 'none',
                borderRadius: '4px',
                color: activeTab === tab ? 'white' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: '11px',
                textTransform: 'capitalize',
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px',
      }}>
        {activeTab === 'library' ? (
          <>
            {/* Actions */}
            <div style={{
              display: 'flex',
              gap: '6px',
              marginBottom: '12px',
            }}>
              <button
                onClick={handleCreateNew}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  color: 'var(--text-primary)',
                  cursor: 'pointer',
                  fontSize: '11px',
                }}
              >
                ➕ New
              </button>
              <button
                onClick={handleDuplicate}
                disabled={!selectedMaterial}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  color: selectedMaterial ? 'var(--text-primary)' : 'var(--text-disabled)',
                  cursor: selectedMaterial ? 'pointer' : 'not-allowed',
                  fontSize: '11px',
                  opacity: selectedMaterial ? 1 : 0.5,
                }}
              >
                📋 Copy
              </button>
              <button
                onClick={handleDelete}
                disabled={!selectedMaterial}
                style={{
                  flex: 1,
                  padding: '6px 10px',
                  background: 'var(--bg-tertiary)',
                  border: '1px solid var(--border-color)',
                  borderRadius: '4px',
                  color: selectedMaterial ? '#ff4444' : 'var(--text-disabled)',
                  cursor: selectedMaterial ? 'pointer' : 'not-allowed',
                  fontSize: '11px',
                  opacity: selectedMaterial ? 1 : 0.5,
                }}
              >
                🗑️ Delete
              </button>
            </div>

            {/* Material Grid */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
              gap: '8px',
            }}>
              {materials.map(mat => (
                <MaterialPreview
                  key={mat.id}
                  material={mat}
                  isSelected={selectedMaterial?.id === mat.id}
                  onClick={() => setSelectedMaterial(mat)}
                />
              ))}
            </div>
          </>
        ) : (
          <>
            {selectedMaterial ? (
              <div>
                {/* Material Name */}
                <div style={{ marginBottom: '16px' }}>
                  <div style={{
                    fontSize: '11px',
                    color: 'var(--text-secondary)',
                    marginBottom: '4px',
                  }}>
                    Material Name
                  </div>
                  <input
                    type="text"
                    value={selectedMaterial.name}
                    onChange={(e) => {
                      selectedMaterial.name = e.target.value;
                      setMaterials([...materials]);
                    }}
                    style={{
                      width: '100%',
                      padding: '6px 8px',
                      background: 'var(--bg-primary)',
                      border: '1px solid var(--border-color)',
                      borderRadius: '4px',
                      color: 'var(--text-primary)',
                      fontSize: '12px',
                    }}
                  />
                </div>

                {/* Color Properties */}
                <ColorPicker
                  label="Base Color"
                  value={selectedMaterial.properties.color}
                  onChange={(val) => handlePropertyChange('color', val)}
                />

                {/* Metalness */}
                {selectedMaterial.properties.metalness !== undefined && (
                  <PropertySlider
                    label="Metalness"
                    value={selectedMaterial.properties.metalness}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(val) => handlePropertyChange('metalness', val)}
                  />
                )}

                {/* Roughness */}
                {selectedMaterial.properties.roughness !== undefined && (
                  <PropertySlider
                    label="Roughness"
                    value={selectedMaterial.properties.roughness}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(val) => handlePropertyChange('roughness', val)}
                  />
                )}

                {/* Opacity */}
                {selectedMaterial.properties.opacity !== undefined && (
                  <PropertySlider
                    label="Opacity"
                    value={selectedMaterial.properties.opacity}
                    min={0}
                    max={1}
                    step={0.01}
                    onChange={(val) => {
                      handlePropertyChange('opacity', val);
                      handlePropertyChange('transparent', val < 1);
                    }}
                  />
                )}

                {/* Apply Button */}
                <button
                  onClick={handleApply}
                  style={{
                    width: '100%',
                    padding: '10px',
                    background: 'var(--accent-orange)',
                    border: 'none',
                    borderRadius: '6px',
                    color: 'white',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: 'bold',
                    marginTop: '16px',
                  }}
                >
                  Apply to Selection
                </button>
              </div>
            ) : (
              <div style={{
                textAlign: 'center',
                padding: '20px',
                color: 'var(--text-secondary)',
                fontSize: '12px',
              }}>
                Select a material from the library
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
