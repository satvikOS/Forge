import { useState, useEffect } from 'react';
import { ChevronDown, ChevronRight, Box, Layers, Ruler, Settings } from 'lucide-react';
import { MATERIALS } from '../kernel/index.js';
import { getBodyRegistry } from '../foundation/BodyRegistry.js';
import './PropertyManager.css';

// Hook: surface the body that should drive the Properties panel.
// Priority: explicit selection in the Part Browser, then the most
// recent foundation manifold (fallback for tools that produce a
// body without going through the registry, e.g. legacy paths).
// Returns { manifold, name } so the header can show the body name.
function useFoundationBody() {
  const [body, setBody] = useState({ manifold: null, name: null });
  useEffect(() => {
    const reg = getBodyRegistry();
    const refresh = () => {
      const sel = reg.selectedBody();
      if (sel?.manifold) return setBody({ manifold: sel.manifold, name: sel.name });
      const m = (typeof window !== 'undefined') ? window.__lastFoundationManifold : null;
      setBody({ manifold: m || null, name: m ? 'Most recent body' : null });
    };
    refresh();
    const unsub = reg.onChange(refresh);
    const id = setInterval(refresh, 500);  // catches legacy __lastFoundationManifold updates
    return () => { unsub(); clearInterval(id); };
  }, []);
  return body;
}

/**
 * Property Manager — Right sidebar panel.
 * Shows context-aware properties for the active selection.
 * Sections collapse/expand. Numeric inputs accept mm/in with auto-conversion.
 */
export default function PropertyManager({ selection, sketchActive, sketchStatus, lastFeature }) {
  const [expanded, setExpanded] = useState({
    geometry: true, material: true, transform: true, manufacturing: false, simulation: false,
  });
  const [material, setMaterial] = useState('Aluminum 6061-T6');

  const toggle = (key) => setExpanded({ ...expanded, [key]: !expanded[key] });

  // Compute properties from selection
  const solid = selection?.solid || null;
  const hasSelection = selection && (selection.type === 'object' || selection.type === 'face');

  // Foundation-body fallback: when no legacy-kernel solid is selected,
  // surface the selected body from the Part Browser (or the most
  // recent foundation manifold if nothing is selected) so the
  // Properties panel always reflects real numbers.
  const { manifold: foundationBody, name: foundationName } = useFoundationBody();
  const showFoundation = !solid && !!foundationBody;

  let mass = 0, volume = 0, surfaceArea = 0;
  let bbox = null;
  if (solid) {
    try {
      const props = solid.massProperties(MATERIALS[material]?.density || 2700);
      mass = props.mass;
      volume = props.volume;
      surfaceArea = props.surfaceArea;
      bbox = solid.boundingBox();
    } catch (e) { /* fallback */ }
  } else if (showFoundation) {
    try {
      const Vmm3 = foundationBody.volume();
      const Amm2 = foundationBody.surfaceArea();
      const bb = foundationBody.boundingBox();
      // Convert mm-scale foundation outputs into the SI units the rest
      // of the panel uses (legacy kernel: m, m², m³, kg).
      volume = Vmm3 * 1e-9;          // mm³ → m³
      surfaceArea = Amm2 * 1e-6;     // mm² → m²
      const density = MATERIALS[material]?.density || 2700;
      mass = volume * density;
      bbox = {
        min: { x: bb.min[0] / 1000, y: bb.min[1] / 1000, z: bb.min[2] / 1000 },
        max: { x: bb.max[0] / 1000, y: bb.max[1] / 1000, z: bb.max[2] / 1000 },
        size: () => ({
          x: (bb.max[0] - bb.min[0]) / 1000,
          y: (bb.max[1] - bb.min[1]) / 1000,
          z: (bb.max[2] - bb.min[2]) / 1000,
        }),
      };
    } catch (e) { /* fallback */ }
  }

  const matSpec = MATERIALS[material];

  return (
    <div className="property-manager">
      {/* Header */}
      <div className="pm-header">
        <span className="pm-title">PROPERTIES</span>
        {hasSelection && <span className="pm-selection-tag">{selection?.name || 'Object'}</span>}
        {!hasSelection && showFoundation && foundationName && (
          <span className="pm-selection-tag">{foundationName}</span>
        )}
        {sketchActive && <span className="pm-mode-tag sketch">SKETCH</span>}
      </div>

      {/* Sketch Status — only when sketching */}
      {sketchActive && sketchStatus && (
        <div className="pm-section pm-section-sketch">
          <div className="pm-row"><span>Status</span><span className="pm-value">{sketchStatus}</span></div>
        </div>
      )}

      {/* Geometry section */}
      <Section title="Geometry" icon={<Box size={11} />} expanded={expanded.geometry} onToggle={() => toggle('geometry')}>
        {(solid || showFoundation) ? (
          <>
            <Row label="Source" value={solid ? 'Legacy B-Rep' : 'Foundation manifold'} />
            <Row label="Volume" value={formatVolume(volume)} />
            <Row label="Surface Area" value={formatArea(surfaceArea)} />
            <Row label="Mass" value={formatMass(mass)} highlight />
            {bbox && (
              <>
                <Row label="Width (X)" value={formatLength(bbox.size().x)} />
                <Row label="Height (Y)" value={formatLength(bbox.size().y)} />
                <Row label="Depth (Z)" value={formatLength(bbox.size().z)} />
              </>
            )}
            {solid && (
              <>
                <Row label="Vertices" value={solid.vertices().length} />
                <Row label="Edges" value={solid.edges().length} />
                <Row label="Faces" value={solid.faces().length} />
              </>
            )}
          </>
        ) : (
          <div className="pm-empty">No selection. Click an object to view properties.</div>
        )}
      </Section>

      {/* Material section */}
      <Section title="Material" icon={<Layers size={11} />} expanded={expanded.material} onToggle={() => toggle('material')}>
        <div className="pm-row">
          <span>Type</span>
          <select className="pm-select" value={material} onChange={(e) => setMaterial(e.target.value)}>
            {Object.keys(MATERIALS).map(name => <option key={name} value={name}>{name}</option>)}
          </select>
        </div>
        {matSpec && (
          <>
            <Row label="Density" value={`${matSpec.density} kg/m³`} />
            <Row label="Young's Modulus" value={`${(matSpec.E / 1e9).toFixed(1)} GPa`} />
            <Row label="Yield Strength" value={`${(matSpec.yieldStrength / 1e6).toFixed(1)} MPa`} />
            <Row label="UTS" value={`${(matSpec.ultimateStrength / 1e6).toFixed(1)} MPa`} />
            <Row label="Poisson's Ratio" value={matSpec.nu} />
          </>
        )}
      </Section>

      {/* Transform section */}
      <Section title="Transform" icon={<Ruler size={11} />} expanded={expanded.transform} onToggle={() => toggle('transform')}>
        {selection?.position ? (
          <>
            <NumRow label="X" value={selection.position.x} unit="mm" />
            <NumRow label="Y" value={selection.position.y} unit="mm" />
            <NumRow label="Z" value={selection.position.z} unit="mm" />
            {selection.rotation && (
              <>
                <NumRow label="RX" value={selection.rotation.x} unit="°" />
                <NumRow label="RY" value={selection.rotation.y} unit="°" />
                <NumRow label="RZ" value={selection.rotation.z} unit="°" />
              </>
            )}
          </>
        ) : (
          <div className="pm-empty">Select an object</div>
        )}
      </Section>

      {/* Manufacturing section */}
      <Section title="Manufacturing" icon={<Settings size={11} />} expanded={expanded.manufacturing} onToggle={() => toggle('manufacturing')}>
        {(solid || showFoundation) ? (
          <>
            <Row label="Material Cost" value={`$${(mass * 3.5).toFixed(2)}`} />
            <Row label="Machining Cost" value={`$${(surfaceArea * 15).toFixed(2)}`} />
            <Row label="Setup Cost" value="$85.00" />
            <Row label="Total" value={`$${((mass * 3.5) + (surfaceArea * 15) + 85).toFixed(2)}`} highlight />
          </>
        ) : (
          <div className="pm-empty">No solid for cost estimate</div>
        )}
      </Section>

      {/* Last feature */}
      {lastFeature && (
        <div className="pm-section pm-section-last">
          <div className="pm-section-header">
            <span>LAST FEATURE</span>
          </div>
          <div className="pm-feature-name">{lastFeature.name}</div>
          {lastFeature.message && <div className="pm-feature-msg">{lastFeature.message}</div>}
        </div>
      )}
    </div>
  );
}

function Section({ title, icon, expanded, onToggle, children }) {
  return (
    <div className={`pm-section ${expanded ? 'expanded' : 'collapsed'}`}>
      <button className="pm-section-header" onClick={onToggle}>
        {expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        {icon}
        <span>{title}</span>
      </button>
      {expanded && <div className="pm-section-body">{children}</div>}
    </div>
  );
}

function Row({ label, value, highlight }) {
  return (
    <div className="pm-row">
      <span>{label}</span>
      <span className={`pm-value ${highlight ? 'highlight' : ''}`}>{value}</span>
    </div>
  );
}

function NumRow({ label, value, unit }) {
  return (
    <div className="pm-row">
      <span>{label}</span>
      <div className="pm-num-input">
        <input type="number" value={value} readOnly className="pm-input" />
        <span className="pm-unit">{unit}</span>
      </div>
    </div>
  );
}

// Formatters
function formatLength(m) {
  return `${(m * 1000).toFixed(2)} mm`;
}
function formatMass(kg) {
  if (kg < 0.001) return `${(kg * 1e6).toFixed(2)} mg`;
  if (kg < 1) return `${(kg * 1000).toFixed(2)} g`;
  return `${kg.toFixed(3)} kg`;
}
function formatVolume(m3) {
  if (m3 < 1e-6) return `${(m3 * 1e9).toFixed(2)} mm³`;
  if (m3 < 1e-3) return `${(m3 * 1e6).toFixed(2)} cm³`;
  return `${m3.toFixed(6)} m³`;
}
function formatArea(m2) {
  if (m2 < 1e-4) return `${(m2 * 1e6).toFixed(2)} mm²`;
  return `${(m2 * 1e4).toFixed(2)} cm²`;
}
