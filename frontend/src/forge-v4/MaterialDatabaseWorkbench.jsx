// Forge-219 — material properties database workbench.
//
// Pure JS lookup — no kernel call. Each row exposes E/ν/ρ/σ_y/σ_u/
// α/k/Cp from a curated catalogue (Shigley, MMPDS-14, ASM). Selection
// is published at `window.__forgeActiveMaterial` so the other
// workbenches (Forge-205/210/211/215) can pre-populate their fields.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';
import { MATERIALS, CATEGORIES, lookup, search, fmtPa, fmtAlpha } from './materialDatabase.js';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 620, zIndex: 1310,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};
const buttonStyle = {
  background: 'var(--forge-accent)', border: 'none',
  color: '#0a0e14', padding: '6px 10px', cursor: 'pointer',
  fontWeight: 600, fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function MaterialPanel({ open, onClose }) {
  const [query, setQuery] = React.useState('');
  const [category, setCategory] = React.useState('');
  const [selectedId, setSelectedId] = React.useState(null);
  if (!open) return null;

  let rows = search(query);
  if (category) rows = rows.filter((m) => m.category === category);
  const selected = selectedId ? lookup(selectedId) : null;

  const onUse = () => {
    if (!selected || typeof window === 'undefined') return;
    window.__forgeActiveMaterial = selected;
    window.dispatchEvent(new CustomEvent('forge:material-selected',
      { detail: { id: selected.id, material: selected } }));
  };

  return (
    <div style={panelStyle} data-testid="forge-material-panel">
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Material properties</strong>
        <button onClick={onClose} style={{ background: 'transparent',
                                           border: '1px solid var(--forge-rail-edge)',
                                           color: 'var(--forge-ink)',
                                           cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>
      <div style={{ color: 'var(--forge-ink-mute)', lineHeight: 1.5 }}>
        SI units throughout. Values are typical-of-class — derate
        against your specific lot's test data.
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <input data-testid="forge-material-search"
               placeholder="search by name, id, or category…"
               value={query}
               onChange={(e) => setQuery(e.target.value)}
               style={{ flex: 1, background: 'var(--forge-canvas)',
                        color: 'var(--forge-ink)',
                        border: '1px solid var(--forge-rail-edge)',
                        padding: '4px 6px',
                        fontFamily: 'var(--forge-mono)', fontSize: 11 }} />
        <select data-testid="forge-material-category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{ background: 'var(--forge-canvas)',
                         color: 'var(--forge-ink)',
                         border: '1px solid var(--forge-rail-edge)',
                         padding: '4px 6px',
                         fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
          <option value="">all categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <section data-testid="forge-material-list"
               style={{ background: 'var(--forge-canvas)',
                        padding: 'var(--forge-space-2)',
                        borderRadius: 'var(--forge-radius)',
                        maxHeight: 300, overflowY: 'auto',
                        fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
        {rows.length === 0 && (
          <div style={{ color: 'var(--forge-ink-mute)' }}>no matches</div>
        )}
        {rows.map((m) => (
          <div key={m.id}
               data-testid={`forge-material-row-${m.id}`}
               onClick={() => setSelectedId(m.id)}
               style={{ padding: '4px 6px', cursor: 'pointer',
                        background: selectedId === m.id ? 'var(--forge-accent)' : 'transparent',
                        color: selectedId === m.id ? '#0a0e14' : 'var(--forge-ink)' }}>
            <span style={{ display: 'inline-block', width: 80, opacity: 0.6 }}>
              {m.category.padEnd(10, ' ')}
            </span>
            {m.name}
          </div>
        ))}
      </section>

      {selected && (
        <>
          <button data-testid="forge-material-use" style={buttonStyle} onClick={onUse}>
            Use selected material
          </button>
          <section data-testid="forge-material-details"
                   style={{ background: 'var(--forge-canvas)',
                            padding: 'var(--forge-space-2)',
                            borderRadius: 'var(--forge-radius)',
                            fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4 }}>
              {selected.name}
            </div>
            <div>E (Young's)&nbsp;&nbsp;{fmtPa(selected.E)}</div>
            <div>ν (Poisson)&nbsp;&nbsp;{selected.nu.toFixed(3)}</div>
            <div>ρ (density)&nbsp;&nbsp;{selected.density} kg/m³</div>
            <div>σ_y (yield)&nbsp;&nbsp;{fmtPa(selected.yield)}</div>
            <div>σ_u (ult.)&nbsp;&nbsp;&nbsp;{fmtPa(selected.ultimate)}</div>
            <div>α (CTE)&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;{fmtAlpha(selected.alpha)}</div>
            <div>k (thermal)&nbsp;&nbsp;{selected.k.toFixed(1)} W/(m·K)</div>
            <div>Cp (specific)&nbsp;{selected.Cp.toFixed(0)} J/(kg·K)</div>
          </section>
        </>
      )}
    </div>
  );
}

export function MaterialDatabaseWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenMaterialWorkbench  = () => setOpen(true);
    window.__forgeCloseMaterialWorkbench = () => setOpen(false);
    window.__forgeMaterialCatalogue      = MATERIALS;
    window.__forgeMaterialLookup         = lookup;
    window.__forgeMaterialSearch         = search;
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.materialdb' || id === 'workbench.materialdb') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'materialdb') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <MaterialPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default MaterialPanel;
