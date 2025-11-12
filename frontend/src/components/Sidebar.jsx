import { useState } from 'react';

export default function Sidebar({ 
  design, 
  analysis, 
  compliance, 
  currentMode,
  activeTool,
  selectedObjects,
  onPropertyChange 
}) {
  const [activeTab, setActiveTab] = useState('properties');
  const [isCollapsed, setIsCollapsed] = useState(false);

  const tabs = [
    { id: 'properties', label: 'Properties', icon: '⚙' },
    { id: 'modifiers', label: 'Modifiers', icon: '🔧' },
    { id: 'materials', label: 'Materials', icon: '🎨' },
    { id: 'physics', label: 'Physics', icon: '⚛' },
    { id: 'scene', label: 'Scene', icon: '📊' },
    { id: 'outliner', label: 'Outliner', icon: '📋' },
  ];

  if (isCollapsed) {
    return (
      <div style={{
        width: '40px',
        minWidth: '40px',
        maxWidth: '40px',
        background: 'var(--bg-secondary)',
        borderLeft: '1px solid var(--border-color)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '10px 0',
        transition: 'all 0.3s ease',
        overflow: 'hidden',
        flexShrink: 0,
      }}>
        <button
          onClick={() => setIsCollapsed(false)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '18px',
            padding: '8px',
          }}
          title="Expand sidebar"
        >
          ◀
        </button>
      </div>
    );
  }

  return (
    <div style={{
      width: '350px',
      minWidth: '350px',
      maxWidth: '350px',
      background: 'var(--bg-secondary)',
      borderLeft: '1px solid var(--border-color)',
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      transition: 'all 0.3s ease',
      overflow: 'hidden',
      flexShrink: 0,
    }}>
      {/* Header with collapse button */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '8px 12px',
        borderBottom: '1px solid var(--border-color)',
      }}>
        <span style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: '500' }}>
          Properties Panel
        </span>
        <button
          onClick={() => setIsCollapsed(true)}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-secondary)',
            cursor: 'pointer',
            fontSize: '14px',
            padding: '4px',
          }}
          title="Collapse sidebar"
        >
          ▶
        </button>
      </div>

      {/* Tabs */}
      <div style={{
        display: 'flex',
        flexWrap: 'wrap',
        borderBottom: '1px solid var(--border-color)',
        background: 'var(--bg-tertiary)',
        padding: '4px',
        gap: '2px',
      }}>
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            style={{
              flex: '1 1 calc(33.333% - 2px)',
              minWidth: '100px',
              padding: '8px 6px',
              background: activeTab === tab.id ? 'var(--bg-secondary)' : 'transparent',
              border: 'none',
              borderBottom: activeTab === tab.id ? '2px solid var(--accent-orange)' : '2px solid transparent',
              color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
              cursor: 'pointer',
              fontSize: '11px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '4px',
              transition: 'all 0.15s',
              borderRadius: '4px',
            }}
            onMouseEnter={(e) => {
              if (activeTab !== tab.id) {
                e.currentTarget.style.background = 'var(--bg-hover)';
              }
            }}
            onMouseLeave={(e) => {
              if (activeTab !== tab.id) {
                e.currentTarget.style.background = 'transparent';
              }
            }}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        overflowY: 'auto',
        padding: '12px',
      }}>
        {activeTab === 'properties' && (
          <PropertiesTab 
            currentMode={currentMode}
            activeTool={activeTool}
            selectedObjects={selectedObjects}
            onPropertyChange={onPropertyChange}
          />
        )}
        {activeTab === 'modifiers' && <ModifiersTab />}
        {activeTab === 'materials' && <MaterialsTab />}
        {activeTab === 'physics' && <PhysicsTab />}
        {activeTab === 'scene' && (
          <SceneTab design={design} analysis={analysis} compliance={compliance} />
        )}
        {activeTab === 'outliner' && <OutlinerTab />}
      </div>
    </div>
  );
}

function PropertiesTab({ currentMode, activeTool, selectedObjects, onPropertyChange }) {
  return (
    <div>
      <PropertyGroup title="Transform">
        <EditableProperty label="Location X" value="0.0" unit="m" />
        <EditableProperty label="Location Y" value="0.0" unit="m" />
        <EditableProperty label="Location Z" value="0.0" unit="m" />
      </PropertyGroup>

      <PropertyGroup title="Rotation">
        <EditableProperty label="Rotation X" value="0.0" unit="°" />
        <EditableProperty label="Rotation Y" value="0.0" unit="°" />
        <EditableProperty label="Rotation Z" value="0.0" unit="°" />
      </PropertyGroup>

      <PropertyGroup title="Scale">
        <EditableProperty label="Scale X" value="1.0" unit="×" />
        <EditableProperty label="Scale Y" value="1.0" unit="×" />
        <EditableProperty label="Scale Z" value="1.0" unit="×" />
      </PropertyGroup>

      {currentMode === 'edit' && (
        <PropertyGroup title="Edit Properties">
          <Property label="Selection Mode" value="Vertices" />
          <Property label="Proportional Edit" value="Disabled" />
        </PropertyGroup>
      )}

      {activeTool && (
        <PropertyGroup title="Tool Properties">
          <Property label="Active Tool" value={activeTool} />
        </PropertyGroup>
      )}
    </div>
  );
}

function ModifiersTab() {
  return (
    <div>
      <div style={{
        padding: '12px',
        background: 'var(--bg-tertiary)',
        borderRadius: '6px',
        textAlign: 'center',
        color: 'var(--text-secondary)',
        fontSize: '12px',
      }}>
        <div style={{ marginBottom: '8px' }}>No modifiers applied</div>
        <button
          style={{
            padding: '6px 12px',
            background: 'var(--accent-orange)',
            border: 'none',
            borderRadius: '4px',
            color: 'white',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          Add Modifier
        </button>
      </div>
    </div>
  );
}

function MaterialsTab() {
  return (
    <div>
      <PropertyGroup title="Material Slots">
        <div style={{
          padding: '12px',
          background: 'var(--bg-tertiary)',
          borderRadius: '6px',
          textAlign: 'center',
          color: 'var(--text-secondary)',
          fontSize: '12px',
        }}>
          <div style={{ marginBottom: '8px' }}>No materials assigned</div>
          <button
            style={{
              padding: '6px 12px',
              background: 'var(--accent-orange)',
              border: 'none',
              borderRadius: '4px',
              color: 'white',
              cursor: 'pointer',
              fontSize: '12px',
            }}
          >
            New Material
          </button>
        </div>
      </PropertyGroup>
    </div>
  );
}

function PhysicsTab() {
  return (
    <div>
      <div style={{
        padding: '12px',
        background: 'var(--bg-tertiary)',
        borderRadius: '6px',
        textAlign: 'center',
        color: 'var(--text-secondary)',
        fontSize: '12px',
      }}>
        <div style={{ marginBottom: '8px' }}>No physics enabled</div>
        <button
          style={{
            padding: '6px 12px',
            background: 'var(--accent-orange)',
            border: 'none',
            borderRadius: '4px',
            color: 'white',
            cursor: 'pointer',
            fontSize: '12px',
          }}
        >
          Enable Physics
        </button>
      </div>
    </div>
  );
}

function SceneTab({ design, analysis, compliance }) {
  if (!design) {
    return (
      <div style={{
        padding: '12px',
        background: 'var(--bg-tertiary)',
        borderRadius: '6px',
        textAlign: 'center',
        color: 'var(--text-secondary)',
        fontSize: '12px',
      }}>
        No design data available
      </div>
    );
  }

  return (
    <div>
      {design.specifications && (
        <PropertyGroup title="Specifications">
          <Property label="Type" value={design.specifications.objectType} />
          <Property label="Description" value={design.specifications.description} />
        </PropertyGroup>
      )}

      {analysis && (
        <PropertyGroup title="Analysis">
          <Property 
            label="Score" 
            value={`${analysis.overallScore}/100`}
            valueColor={analysis.overallScore >= 70 ? '#4caf50' : '#ff9800'}
          />
        </PropertyGroup>
      )}

      {compliance && (
        <PropertyGroup title="Compliance">
          <Property 
            label="Status" 
            value={compliance.compliant ? 'Compliant' : 'Needs Review'}
            valueColor={compliance.compliant ? '#4caf50' : '#ff9800'}
          />
        </PropertyGroup>
      )}
    </div>
  );
}

function OutlinerTab() {
  const sceneObjects = [
    { id: 'camera', name: 'Camera', type: 'camera', visible: true },
    { id: 'light', name: 'Light', type: 'light', visible: true },
    { id: 'cube', name: 'Cube', type: 'mesh', visible: true },
  ];

  return (
    <div>
      <PropertyGroup title="Scene Hierarchy">
        {sceneObjects.map((obj) => (
          <div
            key={obj.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 8px',
              background: 'var(--bg-primary)',
              borderRadius: '4px',
              marginBottom: '4px',
              fontSize: '12px',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <span>{obj.type === 'camera' ? '📷' : obj.type === 'light' ? '💡' : '📦'}</span>
              <span style={{ color: 'var(--text-primary)' }}>{obj.name}</span>
            </div>
            <button
              style={{
                background: 'transparent',
                border: 'none',
                color: obj.visible ? 'var(--text-primary)' : 'var(--text-disabled)',
                cursor: 'pointer',
                fontSize: '12px',
              }}
            >
              {obj.visible ? '👁' : '👁‍🗨'}
            </button>
          </div>
        ))}
      </PropertyGroup>
    </div>
  );
}

function PropertyGroup({ title, children }) {
  return (
    <div style={{ marginBottom: '16px' }}>
      <h3 style={{
        fontSize: '12px',
        color: 'var(--accent-orange)',
        marginBottom: '8px',
        fontWeight: '600',
      }}>
        {title}
      </h3>
      <div style={{
        background: 'var(--bg-tertiary)',
        borderRadius: '6px',
        padding: '10px',
      }}>
        {children}
      </div>
    </div>
  );
}

function Property({ label, value, valueColor }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      marginBottom: '6px',
      fontSize: '12px',
    }}>
      <span style={{ color: 'var(--text-secondary)' }}>{label}:</span>
      <span style={{ 
        color: valueColor || 'var(--text-primary)',
        fontWeight: '400',
      }}>
        {value}
      </span>
    </div>
  );
}

function EditableProperty({ label, value, unit }) {
  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      marginBottom: '6px',
      fontSize: '12px',
      gap: '6px',
    }}>
      <span style={{ color: 'var(--text-secondary)', minWidth: '70px' }}>{label}:</span>
      <input
        type="number"
        step="0.1"
        defaultValue={value}
        style={{
          flex: 1,
          padding: '4px 6px',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-color)',
          borderRadius: '4px',
          color: 'var(--text-primary)',
          fontSize: '12px',
        }}
      />
      <span style={{ color: 'var(--text-secondary)', minWidth: '20px' }}>{unit}</span>
    </div>
  );
}
