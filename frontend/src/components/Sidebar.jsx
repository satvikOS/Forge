import { useState } from 'react';
import MaterialsBrowser from './MaterialsBrowser';
import './Sidebar.css';

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
  const [showMaterialsBrowser, setShowMaterialsBrowser] = useState(false);

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
      <div className="sidebar sidebar-collapsed">
        <button
          onClick={() => setIsCollapsed(false)}
          className="sidebar-expand-btn"
          title="Expand sidebar"
        >
          ◀
        </button>
      </div>
    );
  }

  return (
    <div className="sidebar sidebar-expanded">
      {/* Header with collapse button */}
      <div className="sidebar-header">
        <span className="sidebar-header-title">Properties Panel</span>
        <button
          onClick={() => setIsCollapsed(true)}
          className="sidebar-collapse-btn"
          title="Collapse sidebar"
        >
          ▶
        </button>
      </div>

      {/* Tabs */}
      <div className="sidebar-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`sidebar-tab ${activeTab === tab.id ? 'active' : ''}`}
          >
            <span className="sidebar-tab-icon">{tab.icon}</span>
            <span>{tab.label}</span>
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="sidebar-content">
        {activeTab === 'properties' && (
          <PropertiesTab
            currentMode={currentMode}
            activeTool={activeTool}
            selectedObjects={selectedObjects}
            onPropertyChange={onPropertyChange}
          />
        )}
        {activeTab === 'modifiers' && <ModifiersTab />}
        {activeTab === 'materials' && <MaterialsTab onOpenBrowser={() => setShowMaterialsBrowser(true)} />}
        {activeTab === 'physics' && <PhysicsTab />}
        {activeTab === 'scene' && (
          <SceneTab design={design} analysis={analysis} compliance={compliance} />
        )}
        {activeTab === 'outliner' && <OutlinerTab />}
      </div>

      {/* Materials Browser Modal */}
      <MaterialsBrowser
        isOpen={showMaterialsBrowser}
        onClose={() => setShowMaterialsBrowser(false)}
        onSelectMaterial={(material) => {
          console.log('Selected material:', material);
          setShowMaterialsBrowser(false);
        }}
      />
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
      <div className="sidebar-empty-state">
        <div className="sidebar-empty-text">No modifiers applied</div>
        <button className="sidebar-action-btn primary">Add Modifier</button>
      </div>
    </div>
  );
}

function MaterialsTab({ onOpenBrowser }) {
  return (
    <div>
      <PropertyGroup title="Material Slots">
        <div className="sidebar-empty-state">
          <div className="sidebar-empty-text">No materials assigned</div>
          <div className="sidebar-btn-stack">
            <button className="sidebar-action-btn primary">New Material</button>
            <button className="sidebar-action-btn secondary" onClick={onOpenBrowser}>
              Browse Materials
            </button>
          </div>
        </div>
      </PropertyGroup>
    </div>
  );
}

function PhysicsTab() {
  return (
    <div>
      <div className="sidebar-empty-state">
        <div className="sidebar-empty-text">No physics enabled</div>
        <button className="sidebar-action-btn primary">Enable Physics</button>
      </div>
    </div>
  );
}

function SceneTab({ design, analysis, compliance }) {
  if (!design) {
    return (
      <div className="sidebar-empty-state">
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
            valueColor={analysis.overallScore >= 70 ? 'var(--color-success)' : 'var(--color-warning)'}
          />
        </PropertyGroup>
      )}

      {compliance && (
        <PropertyGroup title="Compliance">
          <Property
            label="Status"
            value={compliance.compliant ? 'Compliant' : 'Needs Review'}
            valueColor={compliance.compliant ? 'var(--color-success)' : 'var(--color-warning)'}
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
          <div key={obj.id} className="outliner-item">
            <div className="outliner-item-left">
              <span className="outliner-item-icon">
                {obj.type === 'camera' ? '📷' : obj.type === 'light' ? '💡' : '📦'}
              </span>
              <span className="outliner-item-name">{obj.name}</span>
            </div>
            <button className={`outliner-visibility ${obj.visible ? 'visible' : ''}`}>
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
    <div className="sidebar-property-group">
      <h3 className="sidebar-group-title">{title}</h3>
      <div className="sidebar-group-content">
        {children}
      </div>
    </div>
  );
}

function Property({ label, value, valueColor }) {
  return (
    <div className="sidebar-property-row">
      <span className="sidebar-property-label">{label}:</span>
      <span className="sidebar-property-value" style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </span>
    </div>
  );
}

function EditableProperty({ label, value, unit }) {
  return (
    <div className="sidebar-editable-row">
      <span className="sidebar-property-label">{label}:</span>
      <input
        type="number"
        step="0.1"
        defaultValue={value}
        className="sidebar-property-input"
      />
      <span className="sidebar-property-unit">{unit}</span>
    </div>
  );
}
