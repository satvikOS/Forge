import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import './BodyPropertiesInspector.css';

/**
 * Body Properties Inspector — persistent right-panel readout for the
 * currently-selected body. Surfaces the engineering data the user
 * needs at every step of the design loop:
 *
 *   - Name (editable)               -> rename in registry
 *   - ID                            -> stable BodyRegistry handle
 *   - Source tool                   -> which ribbon op created it
 *   - Volume   (mm³)                -> from registry.volume_mm3
 *   - Surface area (mm²)            -> integrated from group meshes
 *   - Bounding box Lx,Ly,Lz (mm)    -> Box3 from group
 *   - Centroid cx,cy,cz (mm)        -> Box3 centre
 *   - Material (dropdown)            -> 7 stock engineering materials
 *   - Mass (g)                       -> volume × density (rho × V)
 *
 * Persists material selection per body in localStorage:
 *   archdisc:body-materials:v1 — {[bodyId]: materialKey}
 *
 * Implementation note: surface area is computed once per selection
 * change from the body's Three.js geometry (triangle areas summed),
 * not from the kernel — same approach SW uses for the cached value.
 */

const MATERIALS = [
  { key: 'none',       label: 'No material',         density_g_cm3: 0 },
  { key: 'steel-1045', label: 'Steel · AISI 1045',   density_g_cm3: 7.85 },
  { key: 'steel-4140', label: 'Steel · AISI 4140',   density_g_cm3: 7.85 },
  { key: 'stainless',  label: 'Stainless · 316L',    density_g_cm3: 7.96 },
  { key: 'aluminum',   label: 'Aluminum · 6061-T6',  density_g_cm3: 2.70 },
  { key: 'brass',      label: 'Brass · C36000',      density_g_cm3: 8.49 },
  { key: 'cast-iron',  label: 'Cast iron · A48 Cl40',density_g_cm3: 7.20 },
  { key: 'titanium',   label: 'Titanium · Ti-6Al-4V',density_g_cm3: 4.43 },
  { key: 'pu',         label: 'Polyurethane',        density_g_cm3: 1.20 },
];

const MAT_STORAGE_KEY = 'archdisc:body-materials:v1';

function loadMaterials() {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(MAT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch { return {}; }
}

function saveMaterials(map) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try { window.localStorage.setItem(MAT_STORAGE_KEY, JSON.stringify(map)); }
  catch { /* quota / privacy → silent */ }
}

function computeSurfaceArea(group) {
  // Sum triangle areas across every Mesh under the group. Geometry is
  // in METRES (Three.js group has scale 0.001 to convert mm → m), so we
  // scale to mm² with a 10⁶ factor.
  let area_m2 = 0;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  group?.traverse((obj) => {
    if (!obj.isMesh || !obj.geometry) return;
    const pos = obj.geometry.attributes.position;
    if (!pos) return;
    const idx = obj.geometry.index;
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const i0 = idx ? idx.getX(i)     : i;
      const i1 = idx ? idx.getX(i + 1) : i + 1;
      const i2 = idx ? idx.getX(i + 2) : i + 2;
      a.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0));
      b.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1));
      c.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2));
      b.sub(a); c.sub(a);
      area_m2 += 0.5 * b.cross(c).length();
    }
  });
  // group scale converts to world units once; geometry was already at mm.
  // The factor depends on how brepToMesh scales; for the existing pipeline
  // brepToMesh emits in metres × group(0.001) → mesh stays in metres of
  // model space. To convert to mm² multiply by 1e6.
  return area_m2 * 1e6;
}

function computeBox(group) {
  if (!group) return null;
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return null;
  // Box returned in metres (because group has scale 0.001 from mm geometry).
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    lx_mm: size.x * 1000,
    ly_mm: size.y * 1000,
    lz_mm: size.z * 1000,
    cx_mm: center.x * 1000,
    cy_mm: center.y * 1000,
    cz_mm: center.z * 1000,
  };
}

export default function BodyPropertiesInspector() {
  const [body, setBody] = useState(null);
  const [multiBodies, setMultiBodies] = useState([]);  // WF-11 aggregation
  const [matMap, setMatMap] = useState(() => loadMaterials());
  const [nameDraft, setNameDraft] = useState('');

  // Subscribe to selection.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const reg = window.__archdiscBodies;
    if (!reg) return undefined;
    const sync = () => {
      const ids = typeof reg.selectedIds === 'function' ? reg.selectedIds() : (reg.selectedId ? [reg.selectedId] : []);
      const list = typeof reg.list === 'function' ? reg.list() : reg.bodies;
      if (ids.length === 1) {
        const b = list.find(x => x.id === ids[0]) || null;
        setBody(b);
        setMultiBodies([]);
        setNameDraft(b?.name || '');
        return;
      }
      if (ids.length > 1) {
        // WF-11 — multi-select aggregation. Inspector shows summed volume,
        // summed mass (per-body material × per-body volume), and combined
        // bounding box. Single-body fields are hidden.
        const bs = list.filter(b => ids.includes(b.id));
        setBody(null);
        setMultiBodies(bs);
        setNameDraft('');
        return;
      }
      setBody(null);
      setMultiBodies([]);
      setNameDraft('');
    };
    sync();
    return reg.onChange ? reg.onChange(sync) : undefined;
  }, []);

  const derived = useMemo(() => {
    if (!body || !body.group) return null;
    return {
      surfaceArea_mm2: computeSurfaceArea(body.group),
      box: computeBox(body.group),
    };
  }, [body]);

  if (!body && multiBodies.length === 0) {
    return (
      <div className="body-props" data-archdisc-properties-inspector="empty">
        <div className="body-props-head">Body Properties</div>
        <div className="body-props-empty">Select a body to see its properties.</div>
      </div>
    );
  }

  // WF-11 — multi-select aggregate readout.
  if (!body && multiBodies.length > 0) {
    let totalVolume = 0;
    let totalMass = 0;
    let unitySumValid = true;
    const aggBox = new THREE.Box3();
    for (const b of multiBodies) {
      const v = b.volume_mm3 ?? null;
      if (v != null) totalVolume += v; else unitySumValid = false;
      const matKey = matMap[b.id];
      const def = MATERIALS.find(m => m.key === matKey);
      if (def && def.density_g_cm3 > 0 && v != null) {
        totalMass += (v / 1000) * def.density_g_cm3;
      }
      if (b.group) {
        const bx = new THREE.Box3().setFromObject(b.group);
        if (!bx.isEmpty()) aggBox.union(bx);
      }
    }
    const fmt = (v, digits = 3) => (v == null ? '—' : v.toFixed(digits));
    const aggSize = aggBox.isEmpty() ? null : aggBox.getSize(new THREE.Vector3());
    const aggCenter = aggBox.isEmpty() ? null : aggBox.getCenter(new THREE.Vector3());

    return (
      <div className="body-props" data-archdisc-properties-inspector="multi" data-body-count={multiBodies.length}>
        <div className="body-props-head">Selection · {multiBodies.length} bodies</div>

        <div className="body-props-section">Aggregate</div>
        <div className="body-props-row">
          <label className="body-props-label">ΣVolume</label>
          <span className="body-props-value" data-archdisc-multi-volume-mm3>
            {unitySumValid ? `${fmt(totalVolume, 1)} mm³` : '—'}
          </span>
        </div>
        <div className="body-props-row">
          <label className="body-props-label">ΣMass</label>
          <span className="body-props-value" data-archdisc-multi-mass-g>
            {totalMass > 0 ? `${fmt(totalMass, 2)} g` : '— (assign materials)'}
          </span>
        </div>
        <div className="body-props-row">
          <label className="body-props-label">Bbox Lx · Ly · Lz</label>
          <span className="body-props-value mono">
            {aggSize ? `${fmt(aggSize.x * 1000)} · ${fmt(aggSize.y * 1000)} · ${fmt(aggSize.z * 1000)} mm` : '—'}
          </span>
        </div>
        <div className="body-props-row">
          <label className="body-props-label">Centroid</label>
          <span className="body-props-value mono">
            {aggCenter ? `${fmt(aggCenter.x * 1000)} · ${fmt(aggCenter.y * 1000)} · ${fmt(aggCenter.z * 1000)} mm` : '—'}
          </span>
        </div>

        <div className="body-props-section">Bodies</div>
        <ul className="body-props-multi-list">
          {multiBodies.map(b => (
            <li key={b.id} className="body-props-multi-item" data-archdisc-multi-body-id={b.id}>
              <span className="body-props-multi-name">{b.name}</span>
              <span className="body-props-multi-vol">
                {b.volume_mm3 != null ? `${fmt(b.volume_mm3, 0)} mm³` : '—'}
              </span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const matKey = matMap[body.id] || 'none';
  const matDef = MATERIALS.find(m => m.key === matKey) || MATERIALS[0];
  const volume_mm3 = body.volume_mm3 ?? null;
  const mass_g = (volume_mm3 != null && matDef.density_g_cm3 > 0)
    ? (volume_mm3 / 1000) * matDef.density_g_cm3   // mm³ → cm³ → grams
    : null;

  const fmt = (v, digits = 3) => (v == null ? '—' : v.toFixed(digits));

  const commitRename = () => {
    const next = nameDraft.trim();
    if (!next || next === body.name) return;
    const reg = window.__archdiscBodies;
    if (reg && typeof reg.rename === 'function') reg.rename(body.id, next);
  };

  const onMaterialChange = (e) => {
    const next = { ...matMap, [body.id]: e.target.value };
    setMatMap(next);
    saveMaterials(next);
  };

  return (
    <div className="body-props" data-archdisc-properties-inspector="active" data-body-id={body.id}>
      <div className="body-props-head">Body Properties</div>

      <div className="body-props-row">
        <label className="body-props-label">Name</label>
        <input
          className="body-props-input"
          value={nameDraft}
          onChange={(e) => setNameDraft(e.target.value)}
          onBlur={commitRename}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
          data-archdisc-body-name-input="true"
        />
      </div>

      <div className="body-props-row">
        <label className="body-props-label">ID</label>
        <span className="body-props-value mono">{body.id}</span>
      </div>

      <div className="body-props-row">
        <label className="body-props-label">Source</label>
        <span className="body-props-value">{body.sourceTool ?? '—'}</span>
      </div>

      <div className="body-props-row">
        <label className="body-props-label">Material</label>
        <select
          className="body-props-select"
          value={matKey}
          onChange={onMaterialChange}
          data-archdisc-body-material-select="true"
        >
          {MATERIALS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
        </select>
      </div>

      <div className="body-props-section">Mass &amp; volume</div>
      <div className="body-props-row">
        <label className="body-props-label">Volume</label>
        <span className="body-props-value" data-archdisc-body-volume-mm3>
          {volume_mm3 != null ? `${fmt(volume_mm3, 1)} mm³` : '—'}
        </span>
      </div>
      <div className="body-props-row">
        <label className="body-props-label">Mass</label>
        <span className="body-props-value" data-archdisc-body-mass-g>
          {mass_g != null ? `${fmt(mass_g, 2)} g` : '—'}
        </span>
      </div>
      <div className="body-props-row">
        <label className="body-props-label">ρ</label>
        <span className="body-props-value">
          {matDef.density_g_cm3 > 0 ? `${matDef.density_g_cm3} g/cm³` : '—'}
        </span>
      </div>

      <div className="body-props-section">Geometry</div>
      <div className="body-props-row">
        <label className="body-props-label">Area</label>
        <span className="body-props-value" data-archdisc-body-area-mm2>
          {derived?.surfaceArea_mm2 != null ? `${fmt(derived.surfaceArea_mm2, 1)} mm²` : '—'}
        </span>
      </div>
      <div className="body-props-row">
        <label className="body-props-label">Lx · Ly · Lz</label>
        <span className="body-props-value mono">
          {derived?.box ? `${fmt(derived.box.lx_mm)} · ${fmt(derived.box.ly_mm)} · ${fmt(derived.box.lz_mm)} mm` : '—'}
        </span>
      </div>
      <div className="body-props-row">
        <label className="body-props-label">Centroid</label>
        <span className="body-props-value mono">
          {derived?.box ? `${fmt(derived.box.cx_mm)} · ${fmt(derived.box.cy_mm)} · ${fmt(derived.box.cz_mm)} mm` : '—'}
        </span>
      </div>
    </div>
  );
}
