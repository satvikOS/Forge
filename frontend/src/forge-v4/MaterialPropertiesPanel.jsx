// PUSH-109 — Full Material Properties editor.
//
// PUSH-58 (MassPropsPanel) + PUSH-61 (bodyMaterials.js helper) shipped a
// 5-row density-only material picker — perfectly adequate for the mass
// readout, but useless for any real FEA workflow. A static analysis run
// needs Young's modulus + Poisson's ratio; a buckling check adds yield
// stress; a thermal solve adds conductivity / expansion / specific heat;
// a non-linear yield check adds ultimate strength.
//
// This panel exposes the full property set per body:
//
//   density (g/cc)
//   Young's modulus E (GPa)
//   Poisson's ratio nu (-)
//   yield strength sigmaY (MPa)
//   ultimate strength sigmaU (MPa)
//   thermal conductivity k (W/mK)
//   thermal expansion alpha (1/K, ×1e-6)
//   specific heat cp (J/kgK)
//
// All 8 properties can be edited free-form per body. A preset library
// covers 6 industry-standard alloys / plastics / composites so the user
// can pick a sane baseline + tweak from there.
//
//   Steel A36              — Carbon steel, structural.
//   Aluminum 6061-T6       — Aerospace / extrusion alloy.
//   Titanium Ti-6Al-4V     — Aerospace grade 5.
//   Brass C26000           — Cartridge brass.
//   ABS plastic            — Injection-moulded thermoplastic.
//   Carbon Fiber UD        — Unidirectional CFRP lamina (fiber direction).
//
// Persistence: forge.v4.materialProps (per-body record keyed by handle).
// Run-time read-out: window.__forgeMaterialProperties[handle] = record.
//
// Reachable via tools.materialProperties — the panel mounts its own host
// so App.jsx only needs to drop <MaterialPropertiesHost />.
//
// PUSH-109 deliberately keeps the persistence model parallel to (not
// merged with) PUSH-61's bodyMaterials.js — the helper there stores a
// single string ("steel"/"aluminum"/...) which the existing mass / BOM
// surfaces depend on, and PUSH-109 stores a full numeric record. The
// PUSH-61 string is the "preset key"; the PUSH-109 record is the
// authoritative numeric override. A future slice can collapse them by
// teaching MassProps / BOM to read PUSH-109 records and fall back to the
// preset table — but that's not in scope here.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

const STORAGE_KEY = 'forge.v4.materialProps';
const APPLIED_EVENT = 'forge:material-properties-applied';

// ─────────────────────────────────────────────────────────────────────
// Preset library — the 6 baselines requested in the PUSH-109 brief.
// Numbers are mainstream engineering references (MIL-HDBK-5, MMPDS,
// ASM Handbook Vol 1/2/21, AISC Steel Manual). All units in the panel:
//
//   density  : g/cc        (multiply by 1000 → kg/m³)
//   E        : GPa
//   nu       : -
//   sigmaY   : MPa
//   sigmaU   : MPa
//   k        : W/mK
//   alpha    : 1e-6 / K    (typed "12.0" means 12e-6 /K)
//   cp       : J/kgK

export const MATERIAL_PRESETS = Object.freeze({
  'Steel A36': {
    density: 7.85, E: 200, nu: 0.26, sigmaY: 250, sigmaU: 400,
    k: 50, alpha: 12.0, cp: 486,
  },
  'Aluminum 6061': {
    density: 2.70, E: 69, nu: 0.33, sigmaY: 276, sigmaU: 310,
    k: 167, alpha: 23.6, cp: 896,
  },
  'Titanium Ti-6Al-4V': {
    density: 4.43, E: 113.8, nu: 0.342, sigmaY: 880, sigmaU: 950,
    k: 6.7, alpha: 8.6, cp: 526,
  },
  'Brass C26000': {
    density: 8.53, E: 110, nu: 0.375, sigmaY: 124, sigmaU: 315,
    k: 120, alpha: 19.9, cp: 380,
  },
  'ABS plastic': {
    density: 1.05, E: 2.3, nu: 0.35, sigmaY: 41, sigmaU: 45,
    k: 0.17, alpha: 80.0, cp: 1300,
  },
  'Carbon Fiber UD': {
    density: 1.55, E: 135, nu: 0.30, sigmaY: 1500, sigmaU: 1500,
    k: 6.5, alpha: 1.1, cp: 1050,
  },
});

export const PRESET_KEYS = Object.freeze(Object.keys(MATERIAL_PRESETS));

// The 8 fields the editor exposes. Order is the row order in the panel.
const FIELD_DEFS = Object.freeze([
  { key: 'density', label: 'Density',           unit: 'g/cc',    step: 0.01 },
  { key: 'E',       label: "Young's modulus E", unit: 'GPa',     step: 0.1  },
  { key: 'nu',      label: "Poisson's ratio ν", unit: '',        step: 0.01 },
  { key: 'sigmaY',  label: 'Yield σY',          unit: 'MPa',     step: 1    },
  { key: 'sigmaU',  label: 'Ultimate σU',       unit: 'MPa',     step: 1    },
  { key: 'k',       label: 'Thermal cond k',    unit: 'W/mK',    step: 0.1  },
  { key: 'alpha',   label: 'Therm. exp α',      unit: '×1e-6/K', step: 0.1  },
  { key: 'cp',      label: 'Specific heat cp',  unit: 'J/kgK',   step: 1    },
]);

export const MATERIAL_PROPERTY_KEYS = Object.freeze(FIELD_DEFS.map((f) => f.key));

// ─────────────────────────────────────────────────────────────────────
// Persistence layer.
//
// Layout in localStorage (JSON):
//   {
//     "h:42":  { preset: "Steel A36", density: 7.85, E: 200, ... },
//     "h:108": { preset: "Aluminum 6061", density: 2.70, E: 69, ... },
//   }
//
// The `preset` field is informational only — the numeric values are
// authoritative.

let cache = null;
let cacheLoaded = false;

function deriveKey(handleOrBody) {
  if (handleOrBody == null) return null;
  if (typeof handleOrBody === 'number' && Number.isFinite(handleOrBody)) {
    return `h:${handleOrBody}`;
  }
  if (typeof handleOrBody === 'object') {
    if (typeof handleOrBody.handle === 'number' && Number.isFinite(handleOrBody.handle)) {
      return `h:${handleOrBody.handle}`;
    }
    if (handleOrBody.id != null) return `id:${handleOrBody.id}`;
  }
  return null;
}

function load() {
  if (cacheLoaded) return cache;
  cacheLoaded = true;
  cache = Object.create(null);
  if (typeof window === 'undefined' || !window.localStorage) return cache;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (typeof raw === 'string' && raw.length > 0) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        for (const [k, v] of Object.entries(parsed)) {
          if (typeof k === 'string' && v && typeof v === 'object') {
            cache[k] = sanitiseRecord(v);
          }
        }
      }
    }
  } catch (err) {
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('[forge.materialProps] failed to read localStorage:', err.message);
    }
  }
  syncWindowMirror();
  return cache;
}

function sanitiseRecord(rec) {
  const out = {};
  if (typeof rec.preset === 'string') out.preset = rec.preset;
  for (const def of FIELD_DEFS) {
    const v = Number(rec[def.key]);
    if (Number.isFinite(v)) out[def.key] = v;
  }
  return out;
}

function persist() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cache || {}));
  } catch (err) {
    if (typeof console !== 'undefined') {
      // eslint-disable-next-line no-console
      console.warn('[forge.materialProps] failed to persist localStorage:', err.message);
    }
  }
}

// Mirror the numeric record onto window.__forgeMaterialProperties so any
// FEA / thermal code can read the value out without importing this
// module. The brief specifies the per-handle layout:
//
//   window.__forgeMaterialProperties[handle] = {
//     density, E, nu, sigmaY, sigmaU, k, alpha, cp
//   }
//
// Plus a flat-key view so callers can iterate the keyed store too.
function syncWindowMirror() {
  if (typeof window === 'undefined') return;
  const flat = {};
  const byHandle = {};
  for (const [k, rec] of Object.entries(cache)) {
    flat[k] = rec;
    if (k.startsWith('h:')) {
      const h = Number(k.slice(2));
      if (Number.isFinite(h)) byHandle[h] = numericOnly(rec);
    }
  }
  // The dedicated handle map is what the brief specifies — keep it as
  // a plain dict (not a Map) so the e2e can read it directly.
  window.__forgeMaterialProperties = byHandle;
  // Full record (preset + numeric) — useful for the BOM and round-trip.
  window.__forgeMaterialPropertiesAll = flat;
}

function numericOnly(rec) {
  const out = {};
  for (const def of FIELD_DEFS) {
    if (typeof rec[def.key] === 'number' && Number.isFinite(rec[def.key])) {
      out[def.key] = rec[def.key];
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Public API.

export function getMaterialProperties(handleOrBody) {
  const key = deriveKey(handleOrBody);
  if (key == null) return null;
  const map = load();
  return map[key] ? { ...map[key] } : null;
}

export function setMaterialProperties(handleOrBody, record) {
  const key = deriveKey(handleOrBody);
  if (key == null) return false;
  if (!record || typeof record !== 'object') return false;
  const map = load();
  map[key] = sanitiseRecord(record);
  persist();
  syncWindowMirror();
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(APPLIED_EVENT, {
        detail: { key, record: { ...map[key] } },
      }));
    } catch { /* ignore */ }
  }
  return true;
}

export function getAllMaterialProperties() {
  const map = load();
  return { ...map };
}

export function clearMaterialProperties() {
  cache = Object.create(null);
  cacheLoaded = true;
  persist();
  syncWindowMirror();
  if (typeof window !== 'undefined') {
    try {
      window.dispatchEvent(new CustomEvent(APPLIED_EVENT, {
        detail: { cleared: true },
      }));
    } catch { /* ignore */ }
  }
}

// Hydrate once at module-load so the window mirror exists before the
// first panel mount + before the e2e first read.
load();

if (typeof window !== 'undefined') {
  window.__forgeMaterialPropertiesHelper = Object.freeze({
    getMaterialProperties,
    setMaterialProperties,
    getAllMaterialProperties,
    clearMaterialProperties,
    STORAGE_KEY,
    APPLIED_EVENT,
    PRESETS: MATERIAL_PRESETS,
    PRESET_KEYS,
    FIELD_DEFS,
  });
}

// ─────────────────────────────────────────────────────────────────────
// Helpers used by the panel.

function listNativeBodies() {
  if (typeof window === 'undefined') return [];
  const arr = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return arr.filter((b) => b && typeof b.handle === 'number');
}

function preferredBody() {
  const all = listNativeBodies();
  if (all.length === 0) return null;
  if (typeof window !== 'undefined') {
    const sel = window.__forgeSelection;
    if (sel && typeof sel.bodyHandle === 'number') {
      const m = all.find((b) => b.handle === sel.bodyHandle);
      if (m) return m;
    }
  }
  return all[all.length - 1];
}

function bodyLabel(b) {
  if (!b) return 'None';
  return b.name || b.id || `handle ${b.handle}`;
}

// Initial editor values for a given body — either the previously saved
// record OR the default preset (Steel A36).
function defaultRecordFor(body) {
  const saved = getMaterialProperties(body);
  if (saved) {
    return {
      preset: saved.preset || 'Steel A36',
      ...MATERIAL_PRESETS['Steel A36'], // baseline fill-in for missing fields
      ...saved,
    };
  }
  return { preset: 'Steel A36', ...MATERIAL_PRESETS['Steel A36'] };
}

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 420,
  zIndex: 1335,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)',
  fontSize: 12,
  overflowY: 'auto',
};

const labelStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const fieldRowStyle = {
  display: 'grid',
  gridTemplateColumns: '160px 1fr 60px',
  alignItems: 'center',
  columnGap: 8,
  rowGap: 4,
};

const inputStyle = {
  background: 'var(--forge-canvas)',
  color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 4,
  padding: '3px 6px',
  fontFamily: 'var(--forge-mono)',
  fontSize: 11,
  width: '100%',
};

export function MaterialPropertiesPanel({ open, onClose }) {
  const [bodies, setBodies] = useState(() => listNativeBodies());
  const [bodyHandle, setBodyHandle] = useState(() => preferredBody()?.handle ?? null);
  const [draft, setDraft] = useState(() => defaultRecordFor(preferredBody()));
  const [status, setStatus] = useState(null);

  // Refresh the body list and the editor whenever the panel opens or the
  // selection changes — the rest of the app may have appended bodies, or
  // the user may have clicked something in the viewport.
  useEffect(() => {
    if (!open) return undefined;
    const refresh = () => {
      const all = listNativeBodies();
      setBodies(all);
      const sel = (typeof window !== 'undefined' && window.__forgeSelection)
        ? window.__forgeSelection.bodyHandle : null;
      const pickHandle = (typeof sel === 'number' && all.some((b) => b.handle === sel))
        ? sel
        : (bodyHandle != null && all.some((b) => b.handle === bodyHandle))
          ? bodyHandle
          : (all[all.length - 1]?.handle ?? null);
      setBodyHandle(pickHandle);
      const pickBody = all.find((b) => b.handle === pickHandle) || null;
      setDraft(defaultRecordFor(pickBody));
    };
    refresh();
    const onSel = () => refresh();
    const onApplied = () => refresh();
    window.addEventListener('forge:selection-changed', onSel);
    window.addEventListener(APPLIED_EVENT, onApplied);
    return () => {
      window.removeEventListener('forge:selection-changed', onSel);
      window.removeEventListener(APPLIED_EVENT, onApplied);
    };
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const activeBody = useMemo(
    () => bodies.find((b) => b.handle === bodyHandle) || null,
    [bodies, bodyHandle],
  );

  const onPickBody = useCallback((e) => {
    const h = Number(e?.target?.value);
    if (!Number.isFinite(h)) return;
    setBodyHandle(h);
    const b = bodies.find((bb) => bb.handle === h) || null;
    setDraft(defaultRecordFor(b));
    setStatus(null);
  }, [bodies]);

  const onPickPreset = useCallback((e) => {
    const name = e?.target?.value;
    if (typeof name !== 'string' || !(name in MATERIAL_PRESETS)) return;
    setDraft({ preset: name, ...MATERIAL_PRESETS[name] });
    setStatus(null);
  }, []);

  const onChangeField = useCallback((key) => (e) => {
    const raw = e?.target?.value;
    const num = raw === '' ? '' : Number(raw);
    setDraft((d) => ({ ...d, [key]: num, preset: 'Custom' }));
    setStatus(null);
  }, []);

  const onApply = useCallback(() => {
    if (!activeBody) return;
    // Resolve any blank field back to the current preset's value so we
    // don't write NaN into the record. If the user blanked a field with
    // no fallback (Custom), drop it from the record so the JSON stays
    // numeric-only — the kernel never gets a NaN.
    const presetSrc = MATERIAL_PRESETS[draft.preset] || MATERIAL_PRESETS['Steel A36'];
    const out = { preset: draft.preset || 'Custom' };
    for (const def of FIELD_DEFS) {
      const v = draft[def.key];
      if (typeof v === 'number' && Number.isFinite(v)) out[def.key] = v;
      else if (typeof presetSrc[def.key] === 'number') out[def.key] = presetSrc[def.key];
    }
    const ok = setMaterialProperties(activeBody, out);
    setStatus(ok ? 'Applied' : 'Failed to write');
  }, [activeBody, draft]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-matprops-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>Material Properties (FEA)</strong>
        <button onClick={onClose}
                data-testid="forge-matprops-close"
                style={{
                  background: 'transparent',
                  border: '1px solid var(--forge-rail-edge)',
                  color: 'var(--forge-ink)',
                  cursor: 'pointer',
                  padding: '2px 6px',
                }}>
          ×
        </button>
      </header>

      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.4 }}>
        Edit per-body E / ν / ρ / σY / σU / k / α / cp. The applied record
        lands on <code style={{ fontFamily: 'var(--forge-mono)' }}>
          window.__forgeMaterialProperties[handle]
        </code> + <code style={{ fontFamily: 'var(--forge-mono)' }}>
          localStorage.forge.v4.materialProps
        </code>.
      </div>

      <label style={labelStyle}>
        Body:
        <select data-testid="forge-matprops-body"
                value={bodyHandle ?? ''}
                onChange={onPickBody}
                style={{ ...inputStyle, flex: 1, width: 'auto' }}>
          {bodies.length === 0 && (
            <option value="">— no bodies in scene —</option>
          )}
          {bodies.map((b) => (
            <option key={b.handle} value={b.handle}>
              {bodyLabel(b)} (h:{b.handle})
            </option>
          ))}
        </select>
      </label>

      <label style={labelStyle}>
        Preset:
        <select data-testid="forge-matprops-preset"
                value={draft.preset && (draft.preset in MATERIAL_PRESETS) ? draft.preset : ''}
                onChange={onPickPreset}
                style={{ ...inputStyle, flex: 1, width: 'auto' }}>
          <option value="">— choose preset —</option>
          {PRESET_KEYS.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </label>

      <section data-testid="forge-matprops-fields" style={fieldRowStyle}>
        {FIELD_DEFS.map((def) => (
          <React.Fragment key={def.key}>
            <div style={{ color: 'var(--forge-ink-mute)' }}>{def.label}</div>
            <input type="number"
                   data-testid={`forge-matprops-${def.key}`}
                   data-field={def.key}
                   value={draft[def.key] === '' ? '' : draft[def.key]}
                   step={def.step}
                   onChange={onChangeField(def.key)}
                   style={inputStyle} />
            <div style={{
              color: 'var(--forge-ink-mute)',
              fontFamily: 'var(--forge-mono)',
              fontSize: 10,
            }}>{def.unit}</div>
          </React.Fragment>
        ))}
      </section>

      <footer style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <button onClick={onApply}
                data-testid="forge-matprops-apply"
                disabled={!activeBody}
                style={{
                  background: 'var(--forge-accent, #2f80ed)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 4,
                  padding: '6px 14px',
                  cursor: activeBody ? 'pointer' : 'not-allowed',
                  fontWeight: 600,
                }}>
          Apply
        </button>
        <span data-testid="forge-matprops-status"
              style={{
                color: status === 'Applied'
                  ? 'var(--forge-good, #5fb05f)'
                  : 'var(--forge-ink-mute)',
                fontSize: 11,
              }}>
          {status || (activeBody ? `Editing ${bodyLabel(activeBody)}` : 'No body selected')}
        </span>
      </footer>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — wires the menu action + imperative open/close hook.

export function MaterialPropertiesHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenMaterialProperties  = () => setOpen(true);
    window.__forgeCloseMaterialProperties = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.materialProperties' || id === 'workbench.materialProperties') {
        setOpen(true);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <MaterialPropertiesPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default MaterialPropertiesPanel;
