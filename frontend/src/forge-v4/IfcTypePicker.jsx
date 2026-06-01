// Forge-121 — IFC type picker.
//
// Tiny categorised dropdown that lets the user override the IFC4
// element class for a given body. The default is IFCBUILDINGELEMENTPROXY
// (the generic carrier for anything that doesn't fit a stricter
// subtype). The choice is persisted per-body in localStorage under
// `forge.v4.ifcTypes` so reopening the export panel or restarting the
// app keeps the user's structural tagging.
//
// Categories (per ISO 16739-1:2018):
//   • Structural — IFCBEAM, IFCCOLUMN, IFCSLAB, IFCWALL, IFCFOUNDATION,
//                  IFCMEMBER, IFCPILE, IFCSTAIR, IFCRAMP, IFCROOF
//   • MEP        — IFCFLOWFITTING, IFCFLOWSEGMENT, IFCPIPESEGMENT,
//                  IFCDUCTSEGMENT, IFCCABLECARRIER
//   • Furnishings — IFCFURNISHINGELEMENT, IFCSYSTEMFURNITUREELEMENT
//   • Default    — IFCBUILDINGELEMENTPROXY
//
// Manual clicks never write to the Archie thread; this is a pure UI.

import React, { useCallback, useEffect, useMemo, useState } from 'react';

const STORE_KEY = 'forge.v4.ifcTypes';

const CATEGORIES = [
  {
    label: 'Structural',
    types: [
      { value: 'IFCBEAM',        label: 'Beam' },
      { value: 'IFCCOLUMN',      label: 'Column' },
      { value: 'IFCSLAB',        label: 'Slab' },
      { value: 'IFCWALL',        label: 'Wall' },
      { value: 'IFCFOUNDATION',  label: 'Foundation' },
      { value: 'IFCMEMBER',      label: 'Member' },
      { value: 'IFCPILE',        label: 'Pile' },
      { value: 'IFCSTAIR',       label: 'Stair' },
      { value: 'IFCRAMP',        label: 'Ramp' },
      { value: 'IFCROOF',        label: 'Roof' },
    ],
  },
  {
    label: 'MEP',
    types: [
      { value: 'IFCFLOWFITTING',   label: 'Flow Fitting' },
      { value: 'IFCFLOWSEGMENT',   label: 'Flow Segment' },
      { value: 'IFCPIPESEGMENT',   label: 'Pipe Segment' },
      { value: 'IFCDUCTSEGMENT',   label: 'Duct Segment' },
      { value: 'IFCCABLECARRIER',  label: 'Cable Carrier' },
    ],
  },
  {
    label: 'Furnishings',
    types: [
      { value: 'IFCFURNISHINGELEMENT',     label: 'Furnishing Element' },
      { value: 'IFCSYSTEMFURNITUREELEMENT', label: 'System Furniture' },
    ],
  },
  {
    label: 'Default',
    types: [
      { value: 'IFCBUILDINGELEMENTPROXY', label: 'Building Element Proxy' },
    ],
  },
];

const ALL_VALUES = (() => {
  const out = [];
  for (const cat of CATEGORIES) for (const t of cat.types) out.push(t.value);
  return out;
})();

const DEFAULT_TYPE = 'IFCBUILDINGELEMENTPROXY';

function safeRead() {
  try {
    if (typeof localStorage === 'undefined') return {};
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const o = JSON.parse(raw);
    return (o && typeof o === 'object') ? o : {};
  } catch { return {}; }
}

function safeWrite(map) {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORE_KEY, JSON.stringify(map));
  } catch { /* quota / disabled */ }
}

export function loadIfcTypeMap()             { return safeRead(); }
export function saveIfcTypeForBody(id, type) {
  if (!id) return;
  const map = safeRead();
  map[id] = ALL_VALUES.includes(type) ? type : DEFAULT_TYPE;
  safeWrite(map);
}
export function getIfcTypeForBody(id) {
  const map = safeRead();
  return map[id] || DEFAULT_TYPE;
}

const selectStyle = {
  background: 'var(--forge-canvas, #1a1d24)',
  color: 'var(--forge-ink, #e4e7ed)',
  border: '1px solid var(--forge-rail-edge, #2a2f3a)',
  borderRadius: 'var(--forge-radius, 4px)',
  fontFamily: 'inherit',
  fontSize: 11,
  padding: '4px 6px',
  outline: 'none',
  cursor: 'pointer',
  minWidth: 160,
};

export function IfcTypePicker({ bodyId, value, onChange, compact = false }) {
  const [internal, setInternal] = useState(
    value || (bodyId ? getIfcTypeForBody(bodyId) : DEFAULT_TYPE),
  );

  useEffect(() => {
    if (value && value !== internal) setInternal(value);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const handleChange = useCallback((e) => {
    const v = e.target.value;
    setInternal(v);
    if (bodyId) saveIfcTypeForBody(bodyId, v);
    onChange?.(v);
  }, [bodyId, onChange]);

  const options = useMemo(() => {
    const els = [];
    for (const cat of CATEGORIES) {
      els.push(
        <optgroup key={cat.label} label={cat.label}>
          {cat.types.map((t) => (
            <option key={t.value} value={t.value}>
              {compact ? t.label : `${t.label} · ${t.value}`}
            </option>
          ))}
        </optgroup>,
      );
    }
    return els;
  }, [compact]);

  return (
    <select
      value={internal}
      onChange={handleChange}
      style={selectStyle}
      data-testid={`forge-ifc-type-picker-${bodyId || 'na'}`}
      aria-label="IFC element type"
    >
      {options}
    </select>
  );
}

export const IFC_TYPE_CATEGORIES = CATEGORIES;
export const IFC_TYPE_DEFAULT    = DEFAULT_TYPE;
export const IFC_TYPE_VALUES     = ALL_VALUES;

export default IfcTypePicker;
