import { useState, useEffect, useRef } from 'react';
import { MATERIALS } from '../kernel/simulation/FEAEngine.js';
import './ThoughtBubble.css';

/**
 * Thought Bubble — floating info panel that appears when a component is selected.
 * Shows all computed properties: mass, volume, material, stress, cost, tolerances.
 * Positioned near the selected object in the viewport.
 */
export default function ThoughtBubble({ selection, viewport, onClose }) {
  const [expanded, setExpanded] = useState(false);
  const ref = useRef(null);

  if (!selection || selection.type === 'none') return null;

  const solid = selection.solid || null;
  const name = selection.name || selection.partName || 'Component';
  const materialName = selection.material || 'Aluminum 6061-T6';
  const mat = MATERIALS[materialName] || MATERIALS['Aluminum 6061-T6'];

  // Compute real properties
  let mass = 0, volume = 0, surfaceArea = 0, density = mat?.density || 2700;
  let vertices = 0, edges = 0, faces = 0;
  let centroid = { x: 0, y: 0, z: 0 };

  if (solid) {
    try {
      const props = solid.massProperties(density);
      mass = props.mass;
      volume = props.volume;
      surfaceArea = props.surfaceArea;
      centroid = props.centroid;
      vertices = solid.vertices().length;
      edges = solid.edges().length;
      faces = solid.faces().length;
    } catch (e) {
      // fallback
    }
  }

  // Cost estimation
  const materialCostPerKg = 3.5; // USD/kg for aluminum
  const machiningCostPerM2 = 15; // USD/m² for machining
  const materialCost = mass * materialCostPerKg;
  const machiningCost = surfaceArea * machiningCostPerM2;
  const totalCost = materialCost + machiningCost;

  // Stress quick-check
  const maxStress = selection.feaResult?.results?.maxVonMises;
  const safetyFactor = maxStress ? mat.yieldStrength / maxStress : null;

  return (
    <div className={`thought-bubble ${expanded ? 'expanded' : ''}`} ref={ref}>
      {/* Connector arrow */}
      <div className="thought-bubble-arrow" />

      {/* Header */}
      <div className="thought-bubble-header" onClick={() => setExpanded(!expanded)}>
        <span className="thought-bubble-name">{name}</span>
        <span className="thought-bubble-toggle">{expanded ? '\u25B4' : '\u25BE'}</span>
        {onClose && (
          <button
            className="thought-bubble-close"
            title="Close"
            aria-label="Close"
            data-testid="thought-bubble-close"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
          >
            \u00D7
          </button>
        )}
      </div>

      {/* Quick stats (always visible) */}
      <div className="thought-bubble-quick">
        <div className="tb-stat">
          <span className="tb-label">Mass</span>
          <span className="tb-value">{formatMass(mass)}</span>
        </div>
        <div className="tb-stat">
          <span className="tb-label">Material</span>
          <span className="tb-value tb-material">{materialName}</span>
        </div>
        {safetyFactor !== null && (
          <div className="tb-stat">
            <span className="tb-label">Safety</span>
            <span className={`tb-value ${safetyFactor > 1.5 ? 'tb-pass' : safetyFactor > 1 ? 'tb-warn' : 'tb-fail'}`}>
              {safetyFactor.toFixed(2)}x
            </span>
          </div>
        )}
        <div className="tb-stat">
          <span className="tb-label">Cost</span>
          <span className="tb-value">${totalCost.toFixed(2)}</span>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div className="thought-bubble-details">
          <div className="tb-section">
            <div className="tb-section-title">Geometry</div>
            <div className="tb-row"><span>Volume</span><span>{formatVolume(volume)}</span></div>
            <div className="tb-row"><span>Surface Area</span><span>{formatArea(surfaceArea)}</span></div>
            <div className="tb-row"><span>Vertices</span><span>{vertices}</span></div>
            <div className="tb-row"><span>Edges</span><span>{edges}</span></div>
            <div className="tb-row"><span>Faces</span><span>{faces}</span></div>
            <div className="tb-row"><span>Centroid</span><span>({centroid.x?.toFixed(3)}, {centroid.y?.toFixed(3)}, {centroid.z?.toFixed(3)})</span></div>
          </div>

          <div className="tb-section">
            <div className="tb-section-title">Material</div>
            <div className="tb-row"><span>Density</span><span>{density} kg/m3</span></div>
            <div className="tb-row"><span>Young's Modulus</span><span>{(mat.E / 1e9).toFixed(1)} GPa</span></div>
            <div className="tb-row"><span>Yield Strength</span><span>{(mat.yieldStrength / 1e6).toFixed(1)} MPa</span></div>
            <div className="tb-row"><span>Ultimate Strength</span><span>{(mat.ultimateStrength / 1e6).toFixed(1)} MPa</span></div>
            <div className="tb-row"><span>Poisson's Ratio</span><span>{mat.nu}</span></div>
            <div className="tb-row"><span>Thermal Conductivity</span><span>{mat.thermalConductivity} W/(m*K)</span></div>
          </div>

          <div className="tb-section">
            <div className="tb-section-title">Manufacturing</div>
            <div className="tb-row"><span>Material Cost</span><span>${materialCost.toFixed(2)}</span></div>
            <div className="tb-row"><span>Machining Cost</span><span>${machiningCost.toFixed(2)}</span></div>
            <div className="tb-row"><span>Total Cost</span><span className="tb-highlight">${totalCost.toFixed(2)}</span></div>
          </div>

          {selection.position && (
            <div className="tb-section">
              <div className="tb-section-title">Transform</div>
              <div className="tb-row"><span>Position</span><span>({selection.position.x}, {selection.position.y}, {selection.position.z})</span></div>
              {selection.rotation && <div className="tb-row"><span>Rotation</span><span>({selection.rotation.x}, {selection.rotation.y}, {selection.rotation.z})</span></div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function formatMass(kg) {
  if (kg < 0.001) return `${(kg * 1e6).toFixed(2)} mg`;
  if (kg < 1) return `${(kg * 1000).toFixed(2)} g`;
  return `${kg.toFixed(3)} kg`;
}

function formatVolume(m3) {
  if (m3 < 1e-6) return `${(m3 * 1e9).toFixed(2)} mm3`;
  if (m3 < 1e-3) return `${(m3 * 1e6).toFixed(2)} cm3`;
  return `${m3.toFixed(6)} m3`;
}

function formatArea(m2) {
  if (m2 < 1e-4) return `${(m2 * 1e6).toFixed(2)} mm2`;
  if (m2 < 1) return `${(m2 * 1e4).toFixed(2)} cm2`;
  return `${m2.toFixed(4)} m2`;
}
