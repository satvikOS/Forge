// Forge-139 — Universal command palette.
//
// Cmd+K opens an overlay with a fuzzy-match search box and a results
// list. The catalogue indexes:
//
//   - every menu item from Menus.jsx MENU_SPEC,
//   - every toolbar tool across every workbench in Toolbar.jsx SPEC,
//   - every workbench tab in WorkbenchRail's WORKBENCHES,
//   - every feature node in window.__forgeFeatureTree,
//   - every body name in window.__forgeBodies.
//
// Each result row shows a breadcrumb (category > group > item) on the
// left and the keyboard shortcut (if any) on the right. Clicking a
// row executes the action via the matching dispatcher:
//
//   - menu item → window dispatch of `forge:menu-action` (mirrors
//     handleMenuAction in ForgeShellV4),
//   - toolbar tool → click the matching DOM tool button so the existing
//     onInvoke pipeline runs (keeps schema dock + param dialog wiring
//     intact),
//   - workbench tab → click the rail button by data-wb,
//   - feature node → select via window.__forgeSelectFeature,
//   - body → pick via window.__forgeSelection.
//
// Strict: manual clicks here NEVER write to Archie's thread.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MENU_SPEC, MENU_KEYS } from './Menus.jsx';
import { WORKBENCHES } from './WorkbenchRail.jsx';
import { CALCULATOR_TREE } from './toolRegistry.js';

// We avoid importing Toolbar's SPEC directly to keep the dependency
// graph minimal; instead, toolsForWorkbench is the public access.
import { toolsForWorkbench } from './Toolbar.jsx';

// ─────────────────────────── catalogue build ─────────────────────────

function buildMenuEntries() {
  const out = [];
  for (const key of MENU_KEYS) {
    const spec = MENU_SPEC[key];
    if (!spec) continue;
    for (const item of spec.items) {
      if (item.divider) continue;
      out.push({
        id: `menu.${item.id}`,
        kind: 'menu',
        actionId: item.id,
        label: item.label,
        breadcrumb: `${spec.label} > ${item.label}`,
        shortcut: item.shortcut || null,
        icon: item.icon || null,
        keywords: `${spec.label} ${item.label} ${item.id}`.toLowerCase(),
      });
    }
  }
  return out;
}

function buildToolbarEntries() {
  const out = [];
  for (const wb of WORKBENCHES) {
    const groups = toolsForWorkbench(wb.id) || [];
    for (const grp of groups) {
      for (const t of grp.tools) {
        out.push({
          id: `tool.${wb.id}.${t.id}`,
          kind: 'tool',
          workbench: wb.id,
          toolId: t.id,
          label: t.label,
          breadcrumb: `${wb.label} · ${grp.label} > ${t.label}`,
          shortcut: t.hint || null,
          icon: t.icon || null,
          keywords: `${wb.label} ${grp.label} ${t.label} ${t.id}`.toLowerCase(),
        });
      }
    }
  }
  return out;
}

function buildWorkbenchEntries() {
  return WORKBENCHES.map((wb) => ({
    id: `wb.${wb.id}`,
    kind: 'workbench',
    workbench: wb.id,
    label: wb.label,
    breadcrumb: `Workbench > ${wb.label}`,
    shortcut: null,
    icon: wb.icon || null,
    keywords: `workbench ${wb.label} ${wb.id}`.toLowerCase(),
  }));
}

function buildFeatureEntries() {
  if (typeof window === 'undefined') return [];
  const tree = Array.isArray(window.__forgeFeatureTree) ? window.__forgeFeatureTree : [];
  return tree.map((f) => ({
    id: `feat.${f.id}`,
    kind: 'feature',
    featureId: f.id,
    label: f.label || f.id,
    breadcrumb: `Feature tree > ${f.label || f.id}`,
    shortcut: null,
    icon: f.icon || null,
    keywords: `feature ${f.label || ''} ${f.id}`.toLowerCase(),
  }));
}

function buildBodyEntries() {
  if (typeof window === 'undefined') return [];
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return bodies.map((b) => ({
    id: `body.${b.id}`,
    kind: 'body',
    bodyId: b.id,
    handle: b.handle,
    label: b.name || b.toolId || b.id,
    breadcrumb: `Bodies > ${b.name || b.toolId || b.id}`,
    shortcut: null,
    icon: 'select.body',
    keywords: `body ${b.name || ''} ${b.toolId || ''} ${b.id}`.toLowerCase(),
  }));
}

// PUSH-01: index every calculator from CALCULATOR_TREE so Cmd-K finds
// the 270+ tools that previously only lived behind the hierarchical Tools
// menu. Each entry dispatches `tools.<id>` via the same forge:menu-action
// pipeline so ForgeShellV4's route handlers run unchanged.
function buildCalculatorEntries() {
  const out = [];
  for (const cat of (CALCULATOR_TREE || [])) {
    for (const sec of (cat.sections || [])) {
      for (const item of (sec.items || [])) {
        if (!item || !item.id) continue;
        const label = item.label ? item.label.replace(/…$/, '') : item.id;
        const breadcrumb = `${cat.label || 'Tools'} > ${sec.label || ''} > ${label}`;
        out.push({
          id: `calc.${item.id}`,
          kind: 'menu',
          actionId: `tools.${item.id}`,
          label,
          breadcrumb,
          shortcut: null,
          icon: cat.icon || 'tool',
          keywords: `${label} ${sec.label || ''} ${cat.label || ''} ${item.slice || ''}`.toLowerCase(),
        });
      }
    }
  }
  return out;
}

export function buildCatalogue() {
  return [
    ...buildMenuEntries(),
    ...buildToolbarEntries(),
    ...buildWorkbenchEntries(),
    ...buildFeatureEntries(),
    ...buildBodyEntries(),
    ...buildCalculatorEntries(),
  ];
}

// ─────────────────────────── fuzzy match ─────────────────────────────
//
// Simple subsequence-with-streak scoring. Hits earlier in the string
// and consecutive matches score higher; exact prefix matches win.

export function fuzzyScore(query, entry) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return 1; // empty query → everything passes
  const haystack = entry.keywords || (entry.label || '').toLowerCase();
  if (!haystack) return 0;
  // Prefix bonus
  if (haystack.startsWith(q)) return 10000 - q.length;
  // Substring bonus
  const idx = haystack.indexOf(q);
  if (idx >= 0) return 5000 - idx;
  // Subsequence (each char must appear in order)
  let score = 0;
  let hi = 0;
  let streak = 0;
  let last = -1;
  for (let qi = 0; qi < q.length; qi += 1) {
    const c = q.charAt(qi);
    let found = -1;
    for (let i = hi; i < haystack.length; i += 1) {
      if (haystack.charAt(i) === c) { found = i; break; }
    }
    if (found < 0) return 0;
    streak = (found === last + 1) ? streak + 1 : 1;
    score += streak * 4 - found * 0.05;
    last = found;
    hi = found + 1;
  }
  return Math.max(1, score);
}

// ─────────────────────────── action dispatch ─────────────────────────

function executeEntry(entry) {
  if (!entry) return;
  if (typeof window === 'undefined') return;
  switch (entry.kind) {
    case 'menu':
      try {
        window.dispatchEvent(new CustomEvent('forge:menu-action',
                                             { detail: { id: entry.actionId } }));
      } catch {}
      return;
    case 'tool': {
      // Switch workbench first if needed.
      const wbBtn = document.querySelector(`[data-wb="${entry.workbench}"]`);
      if (wbBtn && wbBtn.getAttribute('data-active') !== 'true') {
        try { wbBtn.click(); } catch {}
      }
      // Defer one frame so the new toolbar mounts, then click.
      setTimeout(() => {
        const btn = document.querySelector(`[data-tool="${entry.toolId}"]`);
        if (btn) { try { btn.click(); } catch {} }
      }, 32);
      return;
    }
    case 'workbench': {
      const wbBtn = document.querySelector(`[data-wb="${entry.workbench}"]`);
      if (wbBtn) { try { wbBtn.click(); } catch {} }
      return;
    }
    case 'feature': {
      try { window.__forgeSelectFeature?.(entry.featureId); } catch {}
      return;
    }
    case 'body': {
      try {
        if (typeof entry.handle === 'number') {
          window.__forgeSelection = { kind: 'body', ids: [entry.handle] };
          window.dispatchEvent(new CustomEvent('forge:selection-changed',
                                               { detail: window.__forgeSelection }));
        }
      } catch {}
      return;
    }
    default: return;
  }
}

// ─────────────────────────── UI ──────────────────────────────────────

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 1470,
  background: 'rgba(8,9,12,0.50)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
  paddingTop: '12vh',
};
const panelStyle = {
  width: 640, maxWidth: '90vw',
  background: 'var(--forge-canvas-2)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius)',
  boxShadow: '0 32px 80px rgba(0,0,0,0.7)',
  display: 'flex', flexDirection: 'column',
  color: 'var(--forge-ink)',
  overflow: 'hidden',
};
const inputStyle = {
  width: '100%',
  background: 'transparent',
  border: 'none',
  outline: 'none',
  color: 'var(--forge-ink)',
  fontSize: 16,
  padding: '14px 16px',
  borderBottom: '1px solid var(--forge-rail-edge)',
};
const rowStyle = (active) => ({
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '8px 14px',
  background: active ? 'var(--forge-accent-mute)' : 'transparent',
  cursor: 'pointer',
  fontSize: 13,
  borderBottom: '1px solid var(--forge-canvas)',
});
const kindBadgeStyle = (kind) => ({
  fontFamily: 'var(--forge-mono)',
  fontSize: 9,
  padding: '2px 5px',
  borderRadius: 3,
  background: 'var(--forge-surface)',
  color: 'var(--forge-ink-mute)',
});
const shortcutStyle = {
  fontFamily: 'var(--forge-mono)',
  fontSize: 11,
  color: 'var(--forge-ink-mute)',
  marginLeft: 8,
};

const MAX_RESULTS = 60;

export function CommandPalette({ open, onClose }) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  // Rebuild on open so feature tree / body list reflect latest state.
  const catalogue = useMemo(() => open ? buildCatalogue() : [], [open]);

  const results = useMemo(() => {
    if (!open) return [];
    if (!query.trim()) return catalogue.slice(0, MAX_RESULTS);
    const scored = [];
    for (const e of catalogue) {
      const s = fuzzyScore(query, e);
      if (s > 0) scored.push({ e, s });
    }
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, MAX_RESULTS).map((x) => x.e);
  }, [open, query, catalogue]);

  // Reset on open / query change.
  useEffect(() => { if (open) setActiveIdx(0); }, [open, query]);
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Esc closes; arrow keys + enter navigate.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose?.(); return; }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, Math.max(0, results.length - 1)));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setActiveIdx((i) => Math.max(0, i - 1));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const entry = results[activeIdx];
        if (entry) { executeEntry(entry); onClose?.(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, results, activeIdx, onClose]);

  if (!open) return null;

  return (
    <div style={overlayStyle}
         data-testid="forge-cmd-palette-overlay"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <section style={panelStyle}
               data-testid="forge-cmd-palette"
               role="dialog"
               aria-label="Command palette"
               onMouseDown={(e) => e.stopPropagation()}>
        <input ref={inputRef}
               type="text"
               value={query}
               placeholder="Search every menu, tool, workbench, feature, body…"
               data-testid="forge-cmd-palette-input"
               onChange={(e) => setQuery(e.target.value)}
               spellCheck={false}
               autoComplete="off"
               style={inputStyle} />
        <ul role="listbox"
            data-testid="forge-cmd-palette-results"
            data-result-count={results.length}
            style={{ listStyle: 'none', margin: 0, padding: 0,
                     maxHeight: '52vh', overflowY: 'auto' }}>
          {results.length === 0 && (
            <li style={{ padding: 14, color: 'var(--forge-ink-mute)',
                         fontStyle: 'italic', fontSize: 12 }}>
              No matches.
            </li>
          )}
          {results.map((r, i) => (
            <li key={r.id}
                role="option"
                aria-selected={i === activeIdx}
                data-cmd-id={r.id}
                data-cmd-kind={r.kind}
                style={rowStyle(i === activeIdx)}
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => { executeEntry(r); onClose?.(); }}>
              <span style={kindBadgeStyle(r.kind)}>{r.kind}</span>
              <span style={{ flex: 1 }}>
                <span style={{ fontWeight: 600 }}>{r.label}</span>
                <span style={{ color: 'var(--forge-ink-mute)',
                               marginLeft: 8, fontSize: 11 }}>
                  {r.breadcrumb}
                </span>
              </span>
              {r.shortcut && (<span style={shortcutStyle}>{r.shortcut}</span>)}
            </li>
          ))}
        </ul>
        <footer style={{ display: 'flex', alignItems: 'center', gap: 12,
                         padding: '8px 14px',
                         borderTop: '1px solid var(--forge-rail-edge)',
                         fontSize: 10, color: 'var(--forge-ink-mute)' }}>
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> execute</span>
          <span><kbd>esc</kbd> close</span>
          <span style={{ flex: 1 }} />
          <span>{results.length} results</span>
        </footer>
      </section>
    </div>
  );
}

export function CommandPaletteHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onKey = (e) => {
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'k') {
        // Prevent the default Cmd+K (legacy: focus cmd bar). The palette
        // takes priority per the deliverable.
        e.preventDefault();
        e.stopPropagation();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    window.__forgeOpenCommandPalette = (v) =>
      setOpen(typeof v === 'boolean' ? v : !open);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      try { delete window.__forgeOpenCommandPalette; } catch {}
    };
  }, [open]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <CommandPalette open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}
