/**
 * Axel Viewer - Interactive visualization of Axel voxel analysis layers
 * Displays geometry, materials, flaws, tooling, and environment analysis
 */

import React, { useState } from 'react';
import PropTypes from 'prop-types';
import './AxelViewer.css';

export default function AxelViewer({ axelData }) {
  const [activeLayer, setActiveLayer] = useState('geometry');
  
  if (!axelData || !axelData.metadata) {
    return (
      <div className="axel-viewer-empty">
        <p>No Axel analysis data available</p>
      </div>
    );
  }

  const layers = [
    { id: 'geometry', label: 'Geometry', icon: '📐' },
    { id: 'materials', label: 'Materials', icon: '🔬' },
    { id: 'flaws', label: 'Flaws', icon: '⚠️' },
    { id: 'tooling', label: 'Tooling', icon: '🔨' },
    { id: 'environment', label: 'Environment', icon: '🌍' }
  ];

  const metadata = axelData.metadata;
  
  return (
    <div className="axel-viewer">
      <div className="axel-header">
        <h3>🔬 Axel Voxel Analysis</h3>
        <div className="axel-stats">
          <span>Resolution: {metadata.resolution}</span>
          <span>Processing: {metadata.processingTime}ms</span>
          <span>Version: {metadata.engine} {metadata.version}</span>
        </div>
      </div>

      <div className="layer-selector">
        {layers.map(layer => (
          <button
            key={layer.id}
            className={`layer-button ${activeLayer === layer.id ? 'active' : ''}`}
            onClick={() => setActiveLayer(layer.id)}
            disabled={!metadata[layer.id]}
          >
            <span className="layer-icon">{layer.icon}</span>
            <span className="layer-label">{layer.label}</span>
          </button>
        ))}
      </div>
      
      <div className="layer-content">
        {activeLayer === 'geometry' && <GeometryLayer data={metadata.geometry} />}
        {activeLayer === 'materials' && <MaterialsLayer data={metadata.materials} />}
        {activeLayer === 'flaws' && <FlawsLayer data={metadata.flaws} />}
        {activeLayer === 'tooling' && <ToolingLayer data={metadata.tooling} />}
        {activeLayer === 'environment' && <EnvironmentLayer data={metadata.environment} />}
      </div>

      <div className="axel-footer">
        <div className="voxel-info">
          {axelData.voxelGrid && (
            <span>
              Voxel Grid: {axelData.voxelGrid.dimensions.x} × {axelData.voxelGrid.dimensions.y} × {axelData.voxelGrid.dimensions.z}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

AxelViewer.propTypes = {
  axelData: PropTypes.shape({
    metadata: PropTypes.object,
    voxelGrid: PropTypes.object
  })
};

// Geometry Layer Component
function GeometryLayer({ data }) {
  if (!data) return <div className="layer-empty">No geometry data available</div>;

  return (
    <div className="layer-panel geometry-layer">
      <h4>Metrology Analysis</h4>
      
      <div className="data-section">
        <h5>Accuracy</h5>
        <p className="data-value">{data.accuracy}</p>
        <p className="data-detail">Resolution: {data.resolution}mm</p>
      </div>

      {data.pointCloud && (
        <div className="data-section">
          <h5>Point Cloud</h5>
          <p className="data-value">{data.pointCloud.count?.toLocaleString()} points</p>
          <p className="data-detail">Density: {data.pointCloud.density?.toLocaleString()} pts/m²</p>
          <p className="data-detail">Format: {data.pointCloud.format}</p>
        </div>
      )}

      {data.deviations && (
        <div className="data-section">
          <h5>Geometric Deviations</h5>
          <p className="data-detail">Tolerance: {data.deviations.tolerance}mm</p>
          <p className="data-detail">Max Deviation: {data.deviations.maxDeviation}mm</p>
          <p className="data-detail">Avg Deviation: {data.deviations.averageDeviation}mm</p>
        </div>
      )}

      {data.surfaceProfile && (
        <div className="data-section">
          <h5>Surface Profile</h5>
          <p className="data-detail">Ra: {data.surfaceProfile.roughness?.ra}mm</p>
          <p className="data-detail">Rz: {data.surfaceProfile.roughness?.rz}mm</p>
          <p className="data-detail">Features: {data.surfaceProfile.features?.join(', ')}</p>
        </div>
      )}
    </div>
  );
}

GeometryLayer.propTypes = {
  data: PropTypes.object
};

// Materials Layer Component
function MaterialsLayer({ data }) {
  if (!data) return <div className="layer-empty">No materials data available</div>;

  return (
    <div className="layer-panel materials-layer">
      <h4>Chemical Analysis</h4>
      
      {data.elements && (
        <div className="data-section">
          <h5>Composition</h5>
          <p className="data-value">{data.elements.type || 'Unknown Material'}</p>
          <div className="composition-list">
            {Object.entries(data.elements).map(([key, value]) => {
              if (key === 'unit' || key === 'type' || key === 'era' || key === 'grade') return null;
              return (
                <div key={key} className="composition-item">
                  <span className="element-name">{key}</span>
                  <span className="element-value">{value}%</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {data.properties && (
        <div className="data-section">
          <h5>Physical Properties</h5>
          <p className="data-detail">Density: {data.properties.density} kg/m³</p>
          <p className="data-detail">Tensile Strength: {data.properties.tensileStrength} MPa</p>
          <p className="data-detail">Elasticity: {data.properties.elasticity} GPa</p>
          <p className="data-detail">Hardness: {data.properties.hardness} HB</p>
        </div>
      )}

      {data.certifications && (
        <div className="data-section">
          <h5>Certifications</h5>
          <p className="data-detail">Standards: {data.certifications.standards?.join(', ')}</p>
        </div>
      )}
    </div>
  );
}

MaterialsLayer.propTypes = {
  data: PropTypes.object
};

// Flaws Layer Component
function FlawsLayer({ data }) {
  if (!data) return <div className="layer-empty">No flaw data available</div>;

  return (
    <div className="layer-panel flaws-layer">
      <h4>Wear & Defect Analysis</h4>
      
      <div className="data-section">
        <h5>Age</h5>
        <p className="data-value">{data.ageYears} years</p>
      </div>

      {data.wear && (
        <div className="data-section">
          <h5>Wear Pattern</h5>
          <p className="data-value">{data.wear.type}</p>
          <p className="data-detail">Severity: {(data.wear.severity * 100).toFixed(1)}%</p>
          <p className="data-detail">Areas: {data.wear.areas?.join(', ')}</p>
        </div>
      )}

      {data.scratches && (
        <div className="data-section">
          <h5>Surface Scratches</h5>
          <p className="data-value">{data.scratches.count} scratches</p>
          <p className="data-detail">Distribution: {data.scratches.distribution}</p>
        </div>
      )}

      {data.weathering && (
        <div className="data-section">
          <h5>Weathering</h5>
          {data.weathering.oxidation && (
            <p className="data-detail">Oxidation: {data.weathering.oxidation.level}</p>
          )}
          {data.weathering.corrosion && (
            <p className="data-detail">Corrosion: {data.weathering.corrosion.level}</p>
          )}
          {data.weathering.patina && (
            <p className="data-detail">Patina: {data.weathering.patina.level}</p>
          )}
        </div>
      )}

      {data.damage && (
        <div className="data-section">
          <h5>Structural Damage</h5>
          <p className="data-value">{data.damage.count} issues</p>
          <p className="data-detail">Condition: {data.damage.overallCondition}</p>
          <p className="data-detail">Repair: {data.damage.requiresRepair ? 'Required' : 'Not Required'}</p>
        </div>
      )}
    </div>
  );
}

FlawsLayer.propTypes = {
  data: PropTypes.object
};

// Tooling Layer Component
function ToolingLayer({ data }) {
  if (!data) return <div className="layer-empty">No tooling data available</div>;

  return (
    <div className="layer-panel tooling-layer">
      <h4>Manufacturing Analysis</h4>
      
      <div className="data-section">
        <h5>Era</h5>
        <p className="data-value">{data.era}</p>
      </div>

      {data.method && (
        <div className="data-section">
          <h5>Manufacturing Method</h5>
          <p className="data-value">{data.method}</p>
        </div>
      )}

      {data.toolMarks && (
        <div className="data-section">
          <h5>Tool Marks</h5>
          <p className="data-detail">Type: {data.toolMarks.type}</p>
          <p className="data-detail">Density: {data.toolMarks.density}</p>
          <p className="data-detail">Pattern: {data.toolMarks.pattern}</p>
          <p className="data-detail">Depth: {data.toolMarks.depth}mm</p>
          {data.toolMarks.characteristics && (
            <p className="data-detail">
              Characteristics: {data.toolMarks.characteristics.join(', ')}
            </p>
          )}
        </div>
      )}

      {data.surfaceFinish && (
        <div className="data-section">
          <h5>Surface Finish</h5>
          <p className="data-detail">Quality: {data.surfaceFinish.quality}</p>
          <p className="data-detail">Grade: {data.surfaceFinish.grade}</p>
          <p className="data-detail">Roughness Ra: {data.surfaceFinish.roughness}μm</p>
          <p className="data-detail">{data.surfaceFinish.description}</p>
        </div>
      )}

      {data.historicalContext && (
        <div className="data-section">
          <h5>Historical Context</h5>
          <p className="data-detail">Period: {data.historicalContext.period}</p>
          <p className="data-detail">
            Technologies: {data.historicalContext.technologies?.join(', ')}
          </p>
        </div>
      )}
    </div>
  );
}

ToolingLayer.propTypes = {
  data: PropTypes.object
};

// Environment Layer Component
function EnvironmentLayer({ data }) {
  if (!data) return <div className="layer-empty">No environment data available</div>;

  return (
    <div className="layer-panel environment-layer">
      <h4>Environmental Composition</h4>
      
      <div className="data-section">
        <h5>Location</h5>
        <p className="data-value">{data.location || 'Not specified'}</p>
        <p className="data-detail">Time: {data.timeOfDay}</p>
        <p className="data-detail">Weather: {data.weather}</p>
      </div>

      {data.lighting && (
        <div className="data-section">
          <h5>Lighting</h5>
          <p className="data-detail">Intensity: {data.lighting.intensity?.toLocaleString()} lux</p>
          <p className="data-detail">Color Temp: {data.lighting.colorTemperature}K</p>
          <p className="data-detail">Shadows: {data.lighting.shadows}</p>
          <p className="data-detail">
            Sun Position: Az {data.lighting.sunPosition?.azimuth}°, El {data.lighting.sunPosition?.elevation}°
          </p>
        </div>
      )}

      {data.atmosphere && (
        <div className="data-section">
          <h5>Atmosphere</h5>
          <p className="data-detail">Fog: {(data.atmosphere.fog * 100).toFixed(0)}%</p>
          <p className="data-detail">Haze: {(data.atmosphere.haze * 100).toFixed(0)}%</p>
          <p className="data-detail">Humidity: {(data.atmosphere.humidity * 100).toFixed(0)}%</p>
          <p className="data-detail">Visibility: {data.atmosphere.visibility}m</p>
          <p className="data-detail">Pollution: {(data.atmosphere.pollution * 100).toFixed(0)}%</p>
        </div>
      )}

      {data.climate && (
        <div className="data-section">
          <h5>Climate</h5>
          <p className="data-detail">Zone: {data.climate.zone}</p>
          <p className="data-detail">Avg Temp: {data.climate.averageTemperature}°C</p>
          <p className="data-detail">Precipitation: {data.climate.precipitation}mm/year</p>
        </div>
      )}
    </div>
  );
}

EnvironmentLayer.propTypes = {
  data: PropTypes.object
};
