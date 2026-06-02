// Forge-233 — Hierarchical Tools menu.
//
// Renders the CALCULATOR_TREE from toolRegistry.js as a 3-level menu:
//   Category (Structural / Machine design / Fluids & HVAC …)
//     → Section (Loads & code / Power transmission / Pipe & duct flow …)
//       → Tool (Wind load / Gear pair / Pump head …)
//
// Each leaf dispatches `forge:menu-action` with `id: 'tools.<id>'` —
// the same event ForgeShellV4 already routes when the old flat menu
// fired. Existing handlers stay intact; only the UI surface changes.
//
// Also exposes a search box that filters the flattened tree, so the
// user can type "bolt" and click the result without drilling.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';
import { CALCULATOR_TREE, flattenTree, TOTAL_CALCULATOR_COUNT } from './toolRegistry.js';

const FLAT_TOOLS = flattenTree();

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  left: 'calc(var(--forge-rail-w) + 8px)',
  width: 720,
  maxHeight: 'min(560px, calc(100vh - var(--forge-topbar-h) - var(--forge-qat-h) - 80px))',
  background: 'var(--forge-canvas-2)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius)',
  boxShadow: '0 10px 32px rgba(0,0,0,0.5)',
  zIndex: 1400,
  padding: 'var(--forge-space-2)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflow: 'hidden',
};

const columnStyle = {
  background: 'var(--forge-canvas)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 4,
  padding: 'var(--forge-space-2)',
  overflowY: 'auto',
  minHeight: 280,
};

function fireToolEvent(id) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('forge:menu-action', {
    detail: { id: `tools.${id}` },
  }));
}

function HierarchicalToolsPanel({ open, onClose }) {
  const [query, setQuery] = React.useState('');
  const [activeCat, setActiveCat] = React.useState(CALCULATOR_TREE[0]?.label ?? null);
  const [activeSec, setActiveSec] = React.useState(null);
  const inputRef = React.useRef(null);

  React.useEffect(() => {
    if (open) {
      setQuery('');
      setActiveCat(CALCULATOR_TREE[0]?.label ?? null);
      setActiveSec(null);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const trimmed = query.trim().toLowerCase();
  const searchMatches = trimmed.length >= 2
    ? FLAT_TOOLS.filter((t) =>
        t.label.toLowerCase().includes(trimmed)
        || t.category.toLowerCase().includes(trimmed)
        || t.section.toLowerCase().includes(trimmed))
    : null;

  const activeCategory = CALCULATOR_TREE.find((c) => c.label === activeCat);
  const sections = activeCategory ? activeCategory.sections : [];
  const activeSection = sections.find((s) => s.label === activeSec) ?? sections[0];

  const onItemClick = (id) => {
    fireToolEvent(id);
    onClose?.();
  };

  return createPortal(
    <div role="dialog" aria-modal="false" aria-label="Tools menu"
         style={panelStyle} data-testid="forge-tools-menu">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input
          ref={inputRef}
          data-testid="forge-tools-menu-search"
          placeholder={`Search ${TOTAL_CALCULATOR_COUNT} tools…`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: 1,
                   background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
                   border: '1px solid var(--forge-rail-edge)',
                   padding: '6px 10px',
                   fontFamily: 'var(--forge-mono)', fontSize: 12 }} />
        <button onClick={onClose} aria-label="Close tools menu"
                style={{ background: 'transparent',
                         border: '1px solid var(--forge-rail-edge)',
                         color: 'var(--forge-ink)',
                         cursor: 'pointer', padding: '4px 10px' }}>
          Esc
        </button>
      </div>

      {searchMatches ? (
        <div data-testid="forge-tools-menu-search-results"
             style={{ ...columnStyle, minHeight: 0 }}>
          {searchMatches.length === 0 && (
            <div style={{ color: 'var(--forge-ink-mute)' }}>no matches</div>
          )}
          {searchMatches.slice(0, 50).map((t) => (
            <button key={t.id}
                    data-testid={`forge-tools-menu-result-${t.id}`}
                    onClick={() => onItemClick(t.id)}
                    style={{ display: 'block', width: '100%',
                             textAlign: 'left',
                             background: 'transparent', border: 'none',
                             color: 'var(--forge-ink)',
                             padding: '4px 0',
                             fontFamily: 'var(--forge-mono)', fontSize: 11,
                             cursor: 'pointer' }}>
              <span>{t.label}</span>
              <span style={{ marginLeft: 6, color: 'var(--forge-ink-mute)' }}>
                — {t.category} / {t.section}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div style={{ display: 'grid',
                      gridTemplateColumns: '1fr 1fr 1.5fr',
                      gap: 8, flex: 1, minHeight: 0 }}>
          <div data-testid="forge-tools-menu-categories" style={columnStyle}>
            <div style={{ color: 'var(--forge-ink-mute)', marginBottom: 6,
                          fontSize: 11, textTransform: 'uppercase' }}>
              Category
            </div>
            {CALCULATOR_TREE.map((cat) => (
              <button key={cat.label}
                      data-testid={`forge-tools-menu-cat-${cat.label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
                      onClick={() => { setActiveCat(cat.label); setActiveSec(null); }}
                      style={{ display: 'block', width: '100%',
                               textAlign: 'left',
                               background: activeCat === cat.label
                                 ? 'var(--forge-accent)' : 'transparent',
                               color: activeCat === cat.label
                                 ? '#0a0e14' : 'var(--forge-ink)',
                               border: 'none',
                               padding: '6px 8px',
                               fontFamily: 'var(--forge-mono)', fontSize: 11,
                               cursor: 'pointer' }}>
                {cat.label}
              </button>
            ))}
          </div>

          <div data-testid="forge-tools-menu-sections" style={columnStyle}>
            <div style={{ color: 'var(--forge-ink-mute)', marginBottom: 6,
                          fontSize: 11, textTransform: 'uppercase' }}>
              Section
            </div>
            {sections.map((sec) => (
              <button key={sec.label}
                      onClick={() => setActiveSec(sec.label)}
                      data-testid={`forge-tools-menu-sec-${sec.label.toLowerCase().replace(/[^a-z]+/g, '-')}`}
                      style={{ display: 'block', width: '100%',
                               textAlign: 'left',
                               background: (activeSection?.label === sec.label)
                                 ? 'var(--forge-canvas-2)' : 'transparent',
                               color: 'var(--forge-ink)',
                               border: '1px solid transparent',
                               borderLeft: (activeSection?.label === sec.label)
                                 ? '2px solid var(--forge-accent)' : '2px solid transparent',
                               padding: '4px 8px',
                               fontFamily: 'var(--forge-mono)', fontSize: 11,
                               cursor: 'pointer' }}>
                {sec.label}
              </button>
            ))}
          </div>

          <div data-testid="forge-tools-menu-items" style={columnStyle}>
            <div style={{ color: 'var(--forge-ink-mute)', marginBottom: 6,
                          fontSize: 11, textTransform: 'uppercase' }}>
              Tool
            </div>
            {(activeSection?.items ?? []).map((item) => (
              <button key={item.id}
                      data-testid={`forge-tools-menu-item-${item.id}`}
                      onClick={() => onItemClick(item.id)}
                      style={{ display: 'block', width: '100%',
                               textAlign: 'left',
                               background: 'transparent',
                               color: 'var(--forge-ink)',
                               border: 'none',
                               padding: '5px 0',
                               fontFamily: 'var(--forge-mono)', fontSize: 11,
                               cursor: 'pointer' }}>
                <span>{item.label}</span>
                <span style={{ marginLeft: 6, color: 'var(--forge-ink-mute)' }}>
                  {item.slice}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}

export function HierarchicalToolsMenuHost() {
  const [open, setOpen] = React.useState(false);

  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenToolsMenu  = () => setOpen(true);
    window.__forgeCloseToolsMenu = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.open' || id === 'tools.menu') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => window.removeEventListener('forge:menu-action', onMenu);
  }, []);

  return <HierarchicalToolsPanel open={open} onClose={() => setOpen(false)} />;
}

// Trigger button — a small chip the menu bar / topbar can render to
// open the hierarchical Tools menu. Each surface that wants it imports
// this rather than re-implementing.
export function ToolsMenuTrigger() {
  return (
    <button
      type="button"
      data-testid="forge-tools-menu-trigger"
      onClick={() => {
        if (typeof window !== 'undefined') window.__forgeOpenToolsMenu?.();
      }}
      style={{
        background: 'var(--forge-canvas-2)',
        border: '1px solid var(--forge-rail-edge)',
        color: 'var(--forge-ink)',
        padding: '4px 10px', cursor: 'pointer',
        fontFamily: 'var(--forge-mono)', fontSize: 11,
        borderRadius: 4,
      }}>
      Tools ▾
    </button>
  );
}

export default HierarchicalToolsMenuHost;
