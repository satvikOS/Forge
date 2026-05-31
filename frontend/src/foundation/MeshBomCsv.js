/**
 * BOM CSV Export — emits a real Bill of Materials for the current
 * scene as a CSV the fabrication shop / procurement can import
 * directly into Excel, ERPNext, NetSuite, etc.
 *
 * Columns (in this order, with units in the header):
 *   #          row number
 *   Body ID    BodyRegistry stable id (e.g. body-001)
 *   Name       editable display name
 *   Source     ribbon tool that created the body
 *   Material   material key from BodyPropertiesInspector (or "—")
 *   Density g/cm³
 *   Volume mm³
 *   Mass g     volume × density (g/cm³), or blank when no material
 *   Lx mm / Ly mm / Lz mm    bounding-box extents (world space)
 *   Cx mm / Cy mm / Cz mm    bounding-box centroid (world space)
 *   Created    body.createdAt ISO timestamp
 *
 * Footer row carries totals: ΣVolume, ΣMass.
 *
 * Materials are read from the WF-08 localStorage map keyed by body id
 * — same source the Inspector uses, so the BOM stays in sync with
 * whatever the user assigned through the Inspector dropdown.
 */

import * as THREE from 'three';

// Mirror of the material density table from BodyPropertiesInspector.
// Duplicated here to keep this module dependency-free (the inspector is
// a React component and we don't want it imported into the foundation
// layer). Both tables ship in the same commit; keep them in sync.
const MATERIAL_DENSITIES = {
  'steel-1045': { label: 'Steel · AISI 1045',   density_g_cm3: 7.85 },
  'steel-4140': { label: 'Steel · AISI 4140',   density_g_cm3: 7.85 },
  'stainless':  { label: 'Stainless · 316L',    density_g_cm3: 7.96 },
  'aluminum':   { label: 'Aluminum · 6061-T6',  density_g_cm3: 2.70 },
  'brass':      { label: 'Brass · C36000',      density_g_cm3: 8.49 },
  'cast-iron':  { label: 'Cast iron · A48 Cl40',density_g_cm3: 7.20 },
  'titanium':   { label: 'Titanium · Ti-6Al-4V',density_g_cm3: 4.43 },
  'pu':         { label: 'Polyurethane',        density_g_cm3: 1.20 },
};

const MAT_STORAGE_KEY = 'archdisc:body-materials:v1';

function loadMaterialMap() {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const raw = window.localStorage.getItem(MAT_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch { return {}; }
}

function listBodies() {
  if (typeof window === 'undefined' || !window.__archdiscBodies) return [];
  const reg = window.__archdiscBodies;
  if (typeof reg.list === 'function') return reg.list();
  if (Array.isArray(reg.bodies)) return reg.bodies;
  return [];
}

function bboxMm(group) {
  if (!group) return null;
  const box = new THREE.Box3().setFromObject(group);
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  // group has metres world coords (the 0.001 scale is baked into the
  // group itself) — convert each metre to mm for the BOM.
  return {
    lx: size.x * 1000, ly: size.y * 1000, lz: size.z * 1000,
    cx: center.x * 1000, cy: center.y * 1000, cz: center.z * 1000,
  };
}

function csvField(s) {
  const str = String(s ?? '');
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function csvLine(values) { return values.map(csvField).join(','); }

const HEADER = [
  '#', 'Body ID', 'Name', 'Source', 'Material', 'Density g/cm3',
  'Volume mm3', 'Mass g',
  'Lx mm', 'Ly mm', 'Lz mm',
  'Cx mm', 'Cy mm', 'Cz mm',
  'Created',
];

/**
 * Build the BOM CSV text + (optionally) trigger a download.
 *
 * @param {object} opts
 * @param {string=} opts.filename     defaults to archdisc-bom-<timestamp>.csv
 * @param {boolean=} opts.download    defaults to true
 * @returns {{ok, rows, totalVolume, totalMass, csv, filename}}
 */
export function exportBomCsv(opts = {}) {
  const bodies = listBodies();
  if (bodies.length === 0) {
    return { ok: false, reason: 'empty-scene', rows: 0, csv: '' };
  }
  const matMap = loadMaterialMap();
  const lines = [csvLine(HEADER)];
  let totalVolume = 0;
  let totalMass = 0;

  bodies.forEach((b, i) => {
    const matKey = matMap[b.id] || null;
    const matDef = matKey ? MATERIAL_DENSITIES[matKey] : null;
    const volume = b.volume_mm3 ?? null;
    const mass = (volume != null && matDef && matDef.density_g_cm3 > 0)
      ? (volume / 1000) * matDef.density_g_cm3
      : null;
    if (volume != null) totalVolume += volume;
    if (mass   != null) totalMass   += mass;

    const bb = bboxMm(b.group) || { lx: '', ly: '', lz: '', cx: '', cy: '', cz: '' };
    lines.push(csvLine([
      i + 1,
      b.id,
      b.name ?? '',
      b.sourceTool ?? '',
      matDef ? matDef.label : (matKey || '—'),
      matDef ? matDef.density_g_cm3.toFixed(2) : '',
      volume != null ? volume.toFixed(1) : '',
      mass   != null ? mass.toFixed(2)   : '',
      typeof bb.lx === 'number' ? bb.lx.toFixed(3) : bb.lx,
      typeof bb.ly === 'number' ? bb.ly.toFixed(3) : bb.ly,
      typeof bb.lz === 'number' ? bb.lz.toFixed(3) : bb.lz,
      typeof bb.cx === 'number' ? bb.cx.toFixed(3) : bb.cx,
      typeof bb.cy === 'number' ? bb.cy.toFixed(3) : bb.cy,
      typeof bb.cz === 'number' ? bb.cz.toFixed(3) : bb.cz,
      b.createdAt ?? '',
    ]));
  });

  // Totals footer row.
  lines.push(csvLine([
    '', '', 'TOTAL', '', '', '',
    totalVolume.toFixed(1),
    totalMass.toFixed(2),
    '', '', '', '', '', '', '',
  ]));

  const csv = lines.join('\n') + '\n';
  const filename = opts.filename ?? `archdisc-bom-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;

  if (opts.download !== false && typeof window !== 'undefined' && typeof document !== 'undefined') {
    try {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.warn('[BOM] download failed', err);
    }
  }

  return {
    ok: true,
    rows: bodies.length,
    totalVolume,
    totalMass,
    csv,
    filename,
  };
}

export default { exportBomCsv };
