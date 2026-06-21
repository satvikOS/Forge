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
//
// The palette UI is built entirely on the Forge design-system tokens
// (--fds-*) and the refined-neutral / monochrome aesthetic: a crisp
// search field, kind-grouped sections with category labels + per-row
// icons + keyboard hints, a clear accent active-row highlight, and a
// keyboard-shortcuts reference overlay (`?` inside the palette, or
// window.__forgeOpenShortcuts).

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { MENU_SPEC, MENU_KEYS } from './Menus.jsx';
import { WORKBENCHES } from './WorkbenchRail.jsx';
import { CALCULATOR_TREE } from './toolRegistry.js';
import { Icon } from './icons/Icon.jsx';

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

// ─────────────────────────── grouping ────────────────────────────────
//
// Results are grouped into labelled sections (CATIA / SW command-search
// idiom). Order is stable & deterministic; within each section the order
// is preserved from the (already score-sorted) results array.

const KIND_META = {
  menu:      { label: 'Commands',   icon: 'misc.search',  order: 0 },
  tool:      { label: 'Tools',      icon: 'gizmo.transform', order: 1 },
  workbench: { label: 'Workbenches', icon: 'wb.mech',     order: 2 },
  feature:   { label: 'Features',   icon: 'select.body',  order: 3 },
  body:      { label: 'Bodies',     icon: 'select.body',  order: 4 },
};

function groupResults(results) {
  const buckets = new Map();
  for (const r of results) {
    const k = r.kind || 'menu';
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  }
  const sections = [];
  for (const [kind, items] of buckets.entries()) {
    const meta = KIND_META[kind] || { label: kind, icon: 'misc.search', order: 9 };
    sections.push({ kind, label: meta.label, icon: meta.icon,
                    order: meta.order, items });
  }
  sections.sort((a, b) => a.order - b.order);
  return sections;
}

// ─────────────────────────── shortcuts reference ─────────────────────
//
// A static, curated map of the application-global shortcuts wired in
// ForgeShellV4's keydown handler + the palette itself. Read-only
// reference overlay — purely informational, dispatches nothing.

const SHORTCUT_GROUPS = [
  {
    label: 'General',
    items: [
      { keys: ['⌘', 'K'], desc: 'Open command palette' },
      { keys: ['⌘', '/'], desc: 'Toggle Archie dock' },
      { keys: ['⌘', 'T'], desc: 'Toggle theme (dark / light)' },
      { keys: ['⌘', ','], desc: 'Settings' },
      { keys: ['F1'],      desc: 'Help & documentation' },
      { keys: ['Esc'],     desc: 'Cancel tool / close overlay' },
    ],
  },
  {
    label: 'Edit',
    items: [
      { keys: ['⌘', 'Z'],      desc: 'Undo' },
      { keys: ['⌘', '⇧', 'Z'], desc: 'Redo' },
      { keys: ['⌘', 'A'],      desc: 'Select all' },
      { keys: ['⌘', '⇧', 'A'], desc: 'Select none' },
      { keys: ['⌫'],           desc: 'Delete selection' },
    ],
  },
  {
    label: 'View',
    items: [
      { keys: ['1'], desc: 'Isometric view' },
      { keys: ['2'], desc: 'Front view' },
      { keys: ['3'], desc: 'Top view' },
      { keys: ['4'], desc: 'Right view' },
      { keys: ['H'], desc: 'Centre model' },
      { keys: ['⌘', 'D'], desc: 'Cycle display (shaded / wire / section)' },
    ],
  },
  {
    label: 'Modelling',
    items: [
      { keys: ['T'],      desc: 'Move (translate) gizmo' },
      { keys: ['R'],      desc: 'Rotate gizmo' },
      { keys: ['Y'],      desc: 'Scale gizmo' },
      { keys: ['⌘', 'E'], desc: 'Equation manager' },
      { keys: ['⌘', 'I'], desc: 'Topology inspector' },
      { keys: ['⌘', 'P'], desc: 'Toggle preview panels' },
    ],
  },
];

// ─────────────────────────── UI ──────────────────────────────────────

const overlayStyle = {
  position: 'fixed', inset: 0, zIndex: 'var(--fds-z-popover, 1500)',
  background: 'var(--fds-scrim, rgba(8,9,12,0.50))',
  backdropFilter: 'blur(2px)',
  WebkitBackdropFilter: 'blur(2px)',
  display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
  paddingTop: '11vh',
  animation: 'fds-fade-in var(--fds-dur-fast, 120ms) var(--fds-ease, ease)',
};
const panelStyle = {
  width: 660, maxWidth: '92vw',
  background: 'var(--fds-surface-panel)',
  border: 'var(--fds-border-w) solid var(--fds-border)',
  borderRadius: 'var(--fds-radius-lg)',
  boxShadow: 'var(--fds-elev-3)',
  display: 'flex', flexDirection: 'column',
  color: 'var(--fds-text-secondary)',
  overflow: 'hidden',
  fontFamily: 'var(--fds-font-ui)',
};

// ── search field ──
const searchWrapStyle = {
  display: 'flex', alignItems: 'center', gap: 'var(--fds-space-3)',
  padding: '0 var(--fds-space-5)',
  height: 52,
  borderBottom: 'var(--fds-border-w) solid var(--fds-border)',
  background: 'var(--fds-surface-raised)',
};
const searchIconStyle = {
  color: 'var(--fds-accent)',
  display: 'flex', alignItems: 'center', flex: '0 0 auto',
};
const inputStyle = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  outline: 'none',
  color: 'var(--fds-text-primary)',
  fontSize: 'var(--fds-fs-large)',
  lineHeight: 'var(--fds-lh-large)',
  fontFamily: 'var(--fds-font-ui)',
  padding: 0,
  caretColor: 'var(--fds-accent)',
};
const countChipStyle = {
  flex: '0 0 auto',
  fontFamily: 'var(--fds-font-num)',
  fontVariantNumeric: 'tabular-nums lining-nums',
  fontSize: 'var(--fds-fs-micro)',
  color: 'var(--fds-text-tertiary)',
  background: 'var(--fds-surface-overlay)',
  border: 'var(--fds-border-w) solid var(--fds-border-subtle)',
  borderRadius: 'var(--fds-radius-pill)',
  padding: '1px var(--fds-space-3)',
  whiteSpace: 'nowrap',
};

// ── section header ──
const sectionHeadStyle = {
  display: 'flex', alignItems: 'center', gap: 'var(--fds-space-2)',
  padding: 'var(--fds-space-3) var(--fds-space-5) var(--fds-space-1)',
  color: 'var(--fds-text-tertiary)',
  fontSize: 'var(--fds-fs-micro)',
  lineHeight: 'var(--fds-lh-micro)',
  fontWeight: 'var(--fds-fw-semibold)',
  letterSpacing: 'var(--fds-tracking-label)',
  textTransform: 'uppercase',
  position: 'sticky', top: 0,
  background: 'var(--fds-surface-panel)',
  zIndex: 1,
  userSelect: 'none',
};
const sectionCountStyle = {
  marginLeft: 'auto',
  fontFamily: 'var(--fds-font-num)',
  fontVariantNumeric: 'tabular-nums lining-nums',
  fontWeight: 'var(--fds-fw-regular)',
  letterSpacing: 0,
  color: 'var(--fds-text-disabled)',
};

// ── result row ──
const rowStyle = (active) => ({
  display: 'flex', alignItems: 'center', gap: 'var(--fds-space-3)',
  padding: '0 var(--fds-space-4)',
  margin: '0 var(--fds-space-2)',
  height: 34,
  borderRadius: 'var(--fds-radius-md)',
  background: active ? 'var(--fds-state-selected)' : 'transparent',
  boxShadow: active
    ? 'inset 0 0 0 var(--fds-border-w) var(--fds-state-selected-bd)'
    : 'none',
  color: active ? 'var(--fds-text-primary)' : 'var(--fds-text-secondary)',
  cursor: 'pointer',
  fontSize: 'var(--fds-fs-base)',
  transition: 'background var(--fds-motion-fast), box-shadow var(--fds-motion-fast)',
});
const rowIconStyle = (active) => ({
  flex: '0 0 auto',
  width: 'var(--fds-icon-md)', height: 'var(--fds-icon-md)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  color: active ? 'var(--fds-accent)' : 'var(--fds-text-tertiary)',
});
const rowLabelStyle = (active) => ({
  flex: '0 1 auto',
  fontWeight: active ? 'var(--fds-fw-medium)' : 'var(--fds-fw-regular)',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
});
const breadcrumbStyle = {
  flex: '1 1 auto',
  color: 'var(--fds-text-tertiary)',
  fontSize: 'var(--fds-fs-small)',
  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  minWidth: 0,
};
const shortcutWrapStyle = {
  flex: '0 0 auto',
  display: 'flex', alignItems: 'center', gap: 'var(--fds-space-1)',
  marginLeft: 'var(--fds-space-3)',
};

// ── footer ──
const footerStyle = {
  display: 'flex', alignItems: 'center', gap: 'var(--fds-space-4)',
  padding: 'var(--fds-space-2) var(--fds-space-5)',
  borderTop: 'var(--fds-border-w) solid var(--fds-border)',
  background: 'var(--fds-surface-raised)',
  fontSize: 'var(--fds-fs-micro)',
  lineHeight: 'var(--fds-lh-micro)',
  color: 'var(--fds-text-tertiary)',
};
const hintGroupStyle = {
  display: 'flex', alignItems: 'center', gap: 'var(--fds-space-2)',
};
const shortcutsBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 'var(--fds-space-2)',
  background: 'transparent',
  border: 'var(--fds-border-w) solid var(--fds-border-subtle)',
  borderRadius: 'var(--fds-radius-sm)',
  color: 'var(--fds-text-tertiary)',
  font: 'inherit',
  padding: '2px var(--fds-space-3)',
  cursor: 'pointer',
  transition: 'background var(--fds-motion-fast), color var(--fds-motion-fast)',
};

// A keycap rendered with the shared design-system kbd treatment.
function Kbd({ children }) {
  return <kbd className="fds-kbd">{children}</kbd>;
}

const MAX_RESULTS = 60;

// ─────────────────────────── shortcuts overlay ───────────────────────

const shortcutsOverlayStyle = {
  position: 'fixed', inset: 0, zIndex: 'var(--fds-z-popover, 1500)',
  background: 'var(--fds-scrim, rgba(8,9,12,0.50))',
  backdropFilter: 'blur(2px)',
  WebkitBackdropFilter: 'blur(2px)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  animation: 'fds-fade-in var(--fds-dur-fast, 120ms) var(--fds-ease, ease)',
};
const shortcutsPanelStyle = {
  width: 640, maxWidth: '92vw', maxHeight: '82vh',
  background: 'var(--fds-surface-panel)',
  border: 'var(--fds-border-w) solid var(--fds-border)',
  borderRadius: 'var(--fds-radius-lg)',
  boxShadow: 'var(--fds-elev-3)',
  display: 'flex', flexDirection: 'column',
  color: 'var(--fds-text-secondary)',
  overflow: 'hidden',
  fontFamily: 'var(--fds-font-ui)',
};
const shortcutsHeaderStyle = {
  display: 'flex', alignItems: 'center', gap: 'var(--fds-space-3)',
  padding: '0 var(--fds-space-5)',
  height: 48,
  borderBottom: 'var(--fds-border-w) solid var(--fds-border)',
  background: 'var(--fds-surface-raised)',
};
const shortcutsTitleStyle = {
  fontSize: 'var(--fds-fs-medium)',
  lineHeight: 'var(--fds-lh-medium)',
  fontWeight: 'var(--fds-fw-semibold)',
  color: 'var(--fds-text-primary)',
};
const shortcutsBodyStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 'var(--fds-space-6)',
  padding: 'var(--fds-space-5)',
  overflowY: 'auto',
};
const shortcutsGroupHeadStyle = {
  color: 'var(--fds-text-tertiary)',
  fontSize: 'var(--fds-fs-micro)',
  lineHeight: 'var(--fds-lh-micro)',
  fontWeight: 'var(--fds-fw-semibold)',
  letterSpacing: 'var(--fds-tracking-label)',
  textTransform: 'uppercase',
  margin: '0 0 var(--fds-space-3)',
  paddingBottom: 'var(--fds-space-2)',
  borderBottom: 'var(--fds-border-w) solid var(--fds-border-subtle)',
};
const shortcutRowStyle = {
  display: 'flex', alignItems: 'center', gap: 'var(--fds-space-3)',
  height: 'var(--fds-row-h)',
  fontSize: 'var(--fds-fs-small)',
};
const closeBtnStyle = {
  marginLeft: 'auto',
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 'var(--fds-control-h-sm)', height: 'var(--fds-control-h-sm)',
  borderRadius: 'var(--fds-radius-sm)',
  background: 'transparent',
  border: 'none',
  color: 'var(--fds-text-tertiary)',
  cursor: 'pointer',
  transition: 'background var(--fds-motion-fast), color var(--fds-motion-fast)',
};

export function ShortcutsOverlay({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose?.(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div style={shortcutsOverlayStyle}
         data-testid="forge-shortcuts-overlay"
         onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <section style={shortcutsPanelStyle}
               role="dialog"
               aria-label="Keyboard shortcuts"
               onMouseDown={(e) => e.stopPropagation()}>
        <header style={shortcutsHeaderStyle}>
          <span style={searchIconStyle}>
            <Icon name="misc.kbd" size={16} />
          </span>
          <span style={shortcutsTitleStyle}>Keyboard Shortcuts</span>
          <button type="button"
                  aria-label="Close"
                  onClick={onClose}
                  data-testid="forge-shortcuts-close"
                  style={closeBtnStyle}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--fds-state-hover)';
                    e.currentTarget.style.color = 'var(--fds-text-primary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--fds-text-tertiary)';
                  }}>
            <Icon name="archie.cancel" size={14} />
          </button>
        </header>
        <div style={shortcutsBodyStyle}>
          {SHORTCUT_GROUPS.map((grp) => (
            <div key={grp.label}>
              <div style={shortcutsGroupHeadStyle}>{grp.label}</div>
              {grp.items.map((sc, i) => (
                <div key={i} style={shortcutRowStyle}>
                  <span style={{ flex: 1, color: 'var(--fds-text-secondary)' }}>
                    {sc.desc}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center',
                                 gap: 'var(--fds-space-1)', flex: '0 0 auto' }}>
                    {sc.keys.map((k, j) => <Kbd key={j}>{k}</Kbd>)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
        <footer style={footerStyle}>
          <span style={hintGroupStyle}><Kbd>esc</Kbd> close</span>
          <span style={{ flex: 1 }} />
          <span>Application shortcuts</span>
        </footer>
      </section>
    </div>
  );
}

export function CommandPalette({ open, onClose }) {
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const inputRef = useRef(null);
  const listRef = useRef(null);
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

  // Sectioned view of the same (flat, score-ordered) results. The flat
  // `results` array remains the source of truth for keyboard nav + the
  // testid result-count, so index math stays identical to before.
  const sections = useMemo(() => groupResults(results), [results]);

  // Reset on open / query change.
  useEffect(() => { if (open) setActiveIdx(0); }, [open, query]);
  useEffect(() => { if (!open) setShowShortcuts(false); }, [open]);
  useEffect(() => {
    if (open) {
      const id = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(id);
    }
  }, [open]);

  // Keep the active row scrolled into view as the user arrows through.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector('[data-cmd-active="true"]');
    if (el && el.scrollIntoView) {
      try { el.scrollIntoView({ block: 'nearest' }); } catch {}
    }
  }, [activeIdx, open, results.length]);

  // Esc closes; arrow keys + enter navigate; '?' opens the shortcuts ref.
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (showShortcuts) return; // overlay owns keys while open
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
      } else if (e.key === '?' && !query) {
        e.preventDefault();
        setShowShortcuts(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, results, activeIdx, onClose, showShortcuts, query]);

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
        <div style={searchWrapStyle}>
          <span style={searchIconStyle} aria-hidden="true">
            <Icon name="misc.search" size={16} />
          </span>
          <input ref={inputRef}
                 type="text"
                 value={query}
                 placeholder="Search every menu, tool, workbench, feature, body…"
                 data-testid="forge-cmd-palette-input"
                 onChange={(e) => setQuery(e.target.value)}
                 spellCheck={false}
                 autoComplete="off"
                 aria-label="Command search"
                 style={inputStyle} />
          <span style={countChipStyle} aria-hidden="true">
            {results.length}{results.length >= MAX_RESULTS ? '+' : ''}
          </span>
        </div>
        <ul role="listbox"
            ref={listRef}
            data-testid="forge-cmd-palette-results"
            data-result-count={results.length}
            style={{ listStyle: 'none', margin: 0,
                     padding: 'var(--fds-space-2) 0',
                     maxHeight: '52vh', overflowY: 'auto' }}>
          {results.length === 0 && (
            <li style={{ padding: 'var(--fds-space-5)',
                         color: 'var(--fds-text-tertiary)',
                         fontStyle: 'italic',
                         fontSize: 'var(--fds-fs-small)',
                         textAlign: 'center' }}>
              No matches for “{query}”.
            </li>
          )}
          {sections.map((section) => (
            <React.Fragment key={section.kind}>
              <li role="presentation" style={sectionHeadStyle}>
                <span>{section.label}</span>
                <span style={sectionCountStyle}>{section.items.length}</span>
              </li>
              {section.items.map((r) => {
                // Flat index drives keyboard nav + active highlight.
                const i = results.indexOf(r);
                const active = i === activeIdx;
                return (
                  <li key={r.id}
                      role="option"
                      aria-selected={active}
                      data-cmd-id={r.id}
                      data-cmd-kind={r.kind}
                      data-cmd-active={active ? 'true' : 'false'}
                      style={rowStyle(active)}
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => { executeEntry(r); onClose?.(); }}>
                    <span style={rowIconStyle(active)} aria-hidden="true">
                      <Icon name={r.icon || section.icon || 'misc.search'} size={16} />
                    </span>
                    <span style={rowLabelStyle(active)}>{r.label}</span>
                    <span style={breadcrumbStyle}>{r.breadcrumb}</span>
                    {r.shortcut && (
                      <span style={shortcutWrapStyle}>
                        <Kbd>{r.shortcut}</Kbd>
                      </span>
                    )}
                  </li>
                );
              })}
            </React.Fragment>
          ))}
        </ul>
        <footer style={footerStyle}>
          <span style={hintGroupStyle}><Kbd>↑</Kbd><Kbd>↓</Kbd> navigate</span>
          <span style={hintGroupStyle}><Kbd>↵</Kbd> execute</span>
          <span style={hintGroupStyle}><Kbd>esc</Kbd> close</span>
          <span style={{ flex: 1 }} />
          <button type="button"
                  data-testid="forge-cmd-palette-shortcuts"
                  onClick={() => setShowShortcuts(true)}
                  style={shortcutsBtnStyle}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = 'var(--fds-state-hover)';
                    e.currentTarget.style.color = 'var(--fds-text-secondary)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = 'transparent';
                    e.currentTarget.style.color = 'var(--fds-text-tertiary)';
                  }}>
            <Icon name="misc.kbd" size={12} />
            <span>Shortcuts</span>
            <Kbd>?</Kbd>
          </button>
        </footer>
      </section>
      <ShortcutsOverlay open={showShortcuts}
                        onClose={() => setShowShortcuts(false)} />
    </div>
  );
}

export function CommandPaletteHost() {
  const [open, setOpen] = useState(false);
  const [shortcutsOnly, setShortcutsOnly] = useState(false);
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
    // Standalone shortcuts-reference launcher (menu / help / status bar can
    // call this without opening the full palette).
    window.__forgeOpenShortcuts = (v) =>
      setShortcutsOnly(typeof v === 'boolean' ? v : true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      try { delete window.__forgeOpenCommandPalette; } catch {}
      try { delete window.__forgeOpenShortcuts; } catch {}
    };
  }, [open]);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <>
      <CommandPalette open={open} onClose={() => setOpen(false)} />
      <ShortcutsOverlay open={shortcutsOnly}
                        onClose={() => setShortcutsOnly(false)} />
    </>,
    document.body,
  );
}
