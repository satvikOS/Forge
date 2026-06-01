// Forge-154 — Material picker panel.
//
// Right-anchored 420 px panel. Header has a search box + category
// dropdown. List shows every catalogue entry as a row with:
//   • colour swatch
//   • name + category
//   • the three "first-look" engineering values (ρ, YS, UTS) so the
//     engineer can scan-pick without opening details.
// Clicking a row opens a detail card showing the full property block
// (ρ, E, ν, YS, UTS, k, α, cp, ρₑ) — all in SI with engineer-friendly
// unit labels.
//
// Self-mounts via window.__forgeOpenMaterialPicker(true|false).
// Publishes the picked material via window.__forgeActiveMaterial +
// fires a `forge:material-picked` CustomEvent.
//
// No state setters are called from window.__forge* — see
// MEMORY: feedback-studio-window-api-no-setstate. We use a small
// internal event bus + a single useEffect to drive open/close.

import React from 'react';
import { createPortal } from 'react-dom';
import {
  listCategories, listByCategory, search, getMaterial, count, addCustom,
} from './materialCatalogue.js';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 36px) + var(--forge-qat-h, 32px))',
  right: 0,
  width: 420, maxWidth: '96vw',
  height: 'calc(100vh - var(--forge-topbar-h, 36px) - var(--forge-qat-h, 32px) - var(--forge-cmdbar-h, 32px))',
  background: 'var(--forge-canvas-3, #14171c)',
  borderLeft: '1px solid var(--forge-rail-edge, #232830)',
  boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
  display: 'flex', flexDirection: 'column',
  color: 'var(--forge-ink, #e6e8ec)', fontSize: 12,
  zIndex: 1290,
};
const headerStyle = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '10px 14px',
  borderBottom: '1px solid var(--forge-rail-edge, #232830)',
  background: 'var(--forge-canvas, #0d1014)',
  fontWeight: 600, fontSize: 12, flexShrink: 0,
};
const subHeaderStyle = {
  display: 'flex', gap: 6, alignItems: 'center',
  padding: '8px 12px',
  borderBottom: '1px solid var(--forge-rail-edge, #232830)',
  background: 'var(--forge-canvas, #0d1014)',
  flexShrink: 0,
};
const inputStyle = {
  flex: 1, background: 'var(--forge-canvas-2, #11151a)',
  border: '1px solid var(--forge-rail-edge, #232830)',
  borderRadius: 3, color: 'var(--forge-ink, #e6e8ec)',
  font: 'inherit', fontSize: 12, padding: '4px 8px',
};
const selectStyle = {
  background: 'var(--forge-canvas-2, #11151a)',
  border: '1px solid var(--forge-rail-edge, #232830)',
  borderRadius: 3, color: 'var(--forge-ink, #e6e8ec)',
  font: 'inherit', fontSize: 11, padding: '4px 6px',
};
const listStyle = {
  flex: 1, overflowY: 'auto', padding: 4,
  display: 'flex', flexDirection: 'column', gap: 1,
};
const rowStyle = (selected) => ({
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '6px 10px',
  background: selected ? 'var(--forge-accent, #2966c4)' : 'transparent',
  color: selected ? '#fff' : 'var(--forge-ink, #e6e8ec)',
  borderRadius: 3, cursor: 'pointer',
});
const swatchStyle = (c) => ({
  width: 18, height: 18, borderRadius: 3,
  background: c, flexShrink: 0,
  border: '1px solid rgba(255,255,255,0.18)',
});
const detailStyle = {
  borderTop: '1px solid var(--forge-rail-edge, #232830)',
  padding: '10px 14px', background: 'var(--forge-canvas, #0d1014)',
  flexShrink: 0,
};
const detailGridStyle = {
  display: 'grid', gridTemplateColumns: 'auto 1fr',
  rowGap: 4, columnGap: 12, fontSize: 11,
};

function pretty(value, unit, scale = 1, fixed = 0) {
  if (!Number.isFinite(value)) return '—';
  const v = value * scale;
  if (Math.abs(v) >= 100) return `${v.toFixed(fixed)} ${unit}`;
  return `${v.toFixed(fixed + 1)} ${unit}`;
}

function MaterialPicker({ open, onClose }) {
  const [q, setQ]                 = React.useState('');
  const [cat, setCat]             = React.useState('all');
  const [active, setActive]       = React.useState(null);
  const cats = React.useMemo(() => listCategories(), []);
  const total = React.useMemo(() => count(), []);

  // Forge-154 — list of materials to render. Memoised against the
  // (q, cat, total) triple so we don't recompute on every keystroke.
  // The `total` dep covers addCustom() bumping the count.
  const rows = React.useMemo(() => {
    let arr;
    if (q.trim()) arr = search(q);
    else if (cat === 'all') arr = [].concat(...cats.map(listByCategory));
    else arr = listByCategory(cat);
    return arr;
  }, [q, cat, cats, total]);

  // First search → focus the first row so the spec can read its data
  // without an extra click.
  React.useEffect(() => {
    if (rows.length && !active) setActive(rows[0]);
  }, [rows, active]);

  if (!open) return null;
  return (
    <div style={panelStyle}
         data-testid="forge-material-picker"
         role="dialog" aria-label="Material library">
      <div style={headerStyle}>
        <span style={{ flex: 1 }}>Material Library</span>
        <span style={{ color: 'var(--forge-ink-mute, #8a9099)', fontSize: 11,
                       fontFamily: 'var(--forge-mono, ui-monospace, monospace)' }}>
          {total} grades
        </span>
        <button type="button"
                onClick={onClose}
                aria-label="Close"
                data-testid="forge-material-picker-close"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--forge-ink, #e6e8ec)', cursor: 'pointer',
                  fontSize: 14, lineHeight: 1, padding: '2px 6px',
                }}>
          ×
        </button>
      </div>
      <div style={subHeaderStyle}>
        <input type="search"
               value={q}
               placeholder="Search e.g. Ti-6Al-4V, 6061, PEEK…"
               onChange={(e) => { setQ(e.target.value); setActive(null); }}
               data-testid="forge-material-search"
               style={inputStyle} />
        <select value={cat}
                onChange={(e) => { setCat(e.target.value); setActive(null); }}
                data-testid="forge-material-category"
                style={selectStyle}>
          <option value="all">All</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>
      <div style={listStyle} data-testid="forge-material-list">
        {rows.length === 0 ? (
          <div style={{ padding: 16, color: 'var(--forge-ink-mute, #8a9099)' }}>
            No materials match.
          </div>
        ) : rows.slice(0, 200).map((m) => (
          <div key={m.name}
               role="button"
               data-testid={`forge-material-row-${m.name}`}
               data-material={m.name}
               onClick={() => setActive(m)}
               style={rowStyle(active?.name === m.name)}>
            <div style={swatchStyle(m.color)} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                            fontWeight: 500 }}>
                {m.name}
              </div>
              <div style={{ fontSize: 10,
                            color: active?.name === m.name ? '#dde6f5' : 'var(--forge-ink-mute, #8a9099)',
                            fontFamily: 'var(--forge-mono, ui-monospace, monospace)' }}>
                {m.category} · ρ {Math.round(m.density)} · YS {Math.round(m.yieldStrength / 1e6)} MPa
              </div>
            </div>
          </div>
        ))}
      </div>
      {active && (
        <div style={detailStyle} data-testid="forge-material-detail"
             data-material-name={active.name}>
          <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={swatchStyle(active.color)} />
            <strong>{active.name}</strong>
            <span style={{ color: 'var(--forge-ink-mute, #8a9099)', fontSize: 10 }}>
              {active.category}
            </span>
          </div>
          <div style={detailGridStyle}>
            <span>Density ρ</span>
            <span data-testid="material-density">
              {pretty(active.density, 'kg/m³', 1, 0)}
            </span>
            <span>Young's E</span>
            <span data-testid="material-youngs">
              {pretty(active.youngsModulus, 'GPa', 1e-9, 1)}
            </span>
            <span>Poisson ν</span>
            <span data-testid="material-poisson">
              {Number.isFinite(active.poissonRatio) ? active.poissonRatio.toFixed(3) : '—'}
            </span>
            <span>Yield σy</span>
            <span data-testid="material-yield">
              {pretty(active.yieldStrength, 'MPa', 1e-6, 0)}
            </span>
            <span>UTS σu</span>
            <span data-testid="material-uts">
              {pretty(active.ultimateTensile, 'MPa', 1e-6, 0)}
            </span>
            <span>Therm. cond.</span>
            <span data-testid="material-thermal-k">
              {pretty(active.thermalConductivity, 'W/(m·K)', 1, 1)}
            </span>
            <span>Therm. expansion α</span>
            <span data-testid="material-thermal-a">
              {pretty(active.thermalExpansion, 'µ/K', 1e6, 1)}
            </span>
            <span>Specific heat cp</span>
            <span data-testid="material-cp">
              {pretty(active.specificHeat, 'J/(kg·K)', 1, 0)}
            </span>
            <span>Elec. resistivity</span>
            <span data-testid="material-rho-e">
              {Number.isFinite(active.electricalResistivity) && active.electricalResistivity < 1e6
                ? `${active.electricalResistivity.toExponential(2)} Ω·m`
                : 'insulator'}
            </span>
          </div>
          <div style={{ marginTop: 10, display: 'flex', gap: 6 }}>
            <button type="button"
                    onClick={() => {
                      if (typeof window === 'undefined') return;
                      window.__forgeActiveMaterial = active;
                      window.dispatchEvent(new CustomEvent('forge:material-picked',
                        { detail: { material: active } }));
                    }}
                    data-testid="forge-material-apply"
                    style={{
                      background: 'var(--forge-accent, #2966c4)',
                      color: '#fff', border: 'none',
                      borderRadius: 3, padding: '5px 12px',
                      cursor: 'pointer', fontSize: 11,
                    }}>
              Apply
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** App-level host. Mounted as a sibling of ForgeShellV4. */
export function MaterialPickerHost() {
  const [open, setOpen] = React.useState(false);

  // Install window hooks once. NEVER call setOpen from the imperative
  // hook directly without the typeof-boolean guard or we'll race the
  // re-render that nukes the hook (feedback-studio-window-api-no-setstate).
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const onEvt = (e) => setOpen(!!(e?.detail?.open));
    window.__forgeOpenMaterialPicker = (v) => {
      const next = typeof v === 'boolean' ? v : true;
      window.dispatchEvent(new CustomEvent('forge:material-picker-open',
        { detail: { open: next } }));
    };
    window.addEventListener('forge:material-picker-open', onEvt);
    // Bridge: also support direct setOpen(false) for menu/close paths
    // by handling the close button locally.
    window.__forgeMaterialPickerIsOpen = () => open;
    return () => {
      window.removeEventListener('forge:material-picker-open', onEvt);
      delete window.__forgeOpenMaterialPicker;
      delete window.__forgeMaterialPickerIsOpen;
    };
  }, [open]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <MaterialPicker open={open} onClose={() => setOpen(false)} />,
    document.body);
}

export { addCustom };

export default MaterialPicker;
