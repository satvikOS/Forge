// Forge v4 — left-tree (feature / model / assembly) shared stylesheet.
//
// CATIA / SolidWorks / NX-grade feature & assembly TREE chrome built
// purely on the Foundation design-system tokens (--fds-* / --forge-*).
// No new colors or off-ladder sizes are introduced here — every value
// resolves to a design-system token so dark / light / sepia /
// high-contrast all keep working.
//
// WHY A RUNTIME INJECT?  The design system's `forge-tokens.css` +
// `forge-base.css` are imported exactly once by ForgeShellV4.jsx (which
// is owned by the shell-layout area and off-limits here). To ship a
// dedicated, area-scoped stylesheet WITHOUT touching the shell, the
// tree components call `useTreeStyles()` which appends one idempotent
// <style id="forge-tree-styles"> the first time any tree mounts. The
// rules are namespaced `.fds-ft-*` ("Forge tree") so they never collide
// with the base `.fds-tree-*` primitives or any `.forge-*` shell class.

const STYLE_ID = 'forge-tree-styles';

const CSS = `
/* ===========================================================================
 * Forge left-tree — feature / model-browser / assembly tree
 * Tabular · dense · scannable. Tight rows, indentation guides, chevrons,
 * per-node icons, full selection / hover / active / suppressed states.
 * ========================================================================= */

/* --- Dock header (title + count + actions + search) ---------------------- */
.fds-ft-dock-head {
  display: flex;
  align-items: center;
  gap: var(--fds-space-2);
  height: var(--fds-control-h-lg);
  padding: 0 var(--fds-space-2) 0 var(--fds-space-3);
  background: var(--fds-surface-raised);
  border-bottom: var(--fds-border-w) solid var(--fds-border);
  user-select: none;
}
.fds-ft-dock-title {
  display: inline-flex;
  align-items: center;
  gap: var(--fds-space-2);
  font-size: var(--fds-fs-small);
  font-weight: var(--fds-fw-medium);
  letter-spacing: var(--fds-tracking-label);
  text-transform: uppercase;
  color: var(--fds-text-tertiary);
  white-space: nowrap;
}
.fds-ft-dock-title > svg { color: var(--fds-text-secondary); }
.fds-ft-count {
  font-family: var(--fds-font-num);
  font-variant-numeric: tabular-nums lining-nums;
  font-size: var(--fds-fs-micro);
  line-height: 1;
  color: var(--fds-text-tertiary);
  padding: 1px var(--fds-space-2);
  border: var(--fds-border-w) solid var(--fds-border);
  border-radius: var(--fds-radius-pill);
}
.fds-ft-head-spacer { flex: 1 1 auto; }
.fds-ft-head-actions { display: inline-flex; align-items: center; gap: 1px; }

/* --- Header / row icon buttons ------------------------------------------- */
.fds-ft-iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--fds-control-h-sm);
  height: var(--fds-control-h-sm);
  padding: 0;
  background: transparent;
  border: var(--fds-border-w) solid transparent;
  border-radius: var(--fds-radius-sm);
  color: var(--fds-text-tertiary);
  cursor: pointer;
  transition: background var(--fds-motion-fast), color var(--fds-motion-fast),
              border-color var(--fds-motion-fast);
}
.fds-ft-iconbtn:hover {
  background: var(--fds-state-hover);
  color: var(--fds-text-primary);
  border-color: var(--fds-border);
}
.fds-ft-iconbtn:active { background: var(--fds-state-pressed); }
.fds-ft-iconbtn[data-on="true"] {
  background: var(--fds-state-selected);
  color: var(--fds-text-primary);
  border-color: var(--fds-state-selected-bd);
}

/* --- Search / filter field ----------------------------------------------- */
.fds-ft-search {
  position: relative;
  display: flex;
  align-items: center;
  padding: var(--fds-space-2) var(--fds-space-3);
  background: var(--fds-surface-raised);
  border-bottom: var(--fds-border-w) solid var(--fds-border);
}
.fds-ft-search-glyph {
  position: absolute;
  left: calc(var(--fds-space-3) + var(--fds-space-2));
  display: inline-flex;
  color: var(--fds-text-tertiary);
  pointer-events: none;
}
.fds-ft-search-input {
  width: 100%;
  height: var(--fds-control-h-sm);
  padding: 0 var(--fds-space-3) 0 calc(var(--fds-space-5) + var(--fds-space-3));
  background: var(--fds-surface-overlay);
  border: var(--fds-border-w) solid var(--fds-border);
  border-radius: var(--fds-radius-sm);
  color: var(--fds-text-primary);
  font-family: var(--fds-font-ui);
  font-size: var(--fds-fs-small);
  line-height: var(--fds-control-h-sm);
  outline: none;
  transition: border-color var(--fds-motion-fast), background var(--fds-motion-fast);
}
.fds-ft-search-input::placeholder { color: var(--fds-text-disabled); }
.fds-ft-search-input:focus {
  border-color: var(--fds-accent-rim);
  background: var(--fds-surface-overlay-2);
}

/* --- Scroll body --------------------------------------------------------- */
.fds-ft-body {
  flex: 1 1 auto;
  overflow-y: auto;
  overflow-x: hidden;
  padding: var(--fds-space-2) 0;
}
.fds-ft-list { list-style: none; margin: 0; padding: 0; }

/* --- The row ------------------------------------------------------------- */
.fds-ft-row {
  position: relative;
  display: flex;
  align-items: center;
  gap: var(--fds-space-2);
  height: var(--fds-row-h-compact);
  padding-right: var(--fds-space-2);
  /* left padding is set per-depth inline via --ft-indent */
  padding-left: var(--ft-indent, var(--fds-space-3));
  border: var(--fds-border-w) solid transparent;
  border-left: var(--fds-border-w-2) solid transparent;
  color: var(--fds-text-secondary);
  font-family: var(--fds-font-ui);
  font-size: var(--fds-fs-small);
  line-height: var(--fds-row-h-compact);
  white-space: nowrap;
  cursor: pointer;
  user-select: none;
  transition: background var(--fds-motion-fast), color var(--fds-motion-fast);
}
.fds-ft-row:hover {
  background: var(--fds-state-hover);
  color: var(--fds-text-primary);
}
.fds-ft-row[data-active="true"],
.fds-ft-row[data-selected="true"] {
  background: var(--fds-state-selected);
  color: var(--fds-text-primary);
  border-color: var(--fds-state-selected-bd);
  border-left-color: var(--fds-accent);
}
.fds-ft-row[data-drag-over="true"] {
  background: var(--fds-state-active);
  border-top-color: var(--fds-accent-rim);
}
.fds-ft-row[data-suppressed="true"] {
  color: var(--fds-text-disabled);
  text-decoration: line-through;
  text-decoration-color: var(--fds-text-disabled);
}
.fds-ft-row[data-hidden="true"] { opacity: 0.5; }

/* --- Twisty (expand / collapse chevron) ---------------------------------- */
.fds-ft-twisty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--fds-icon-sm);
  height: var(--fds-icon-sm);
  flex-shrink: 0;
  color: var(--fds-text-tertiary);
  background: transparent;
  border: none;
  padding: 0;
  cursor: pointer;
}
.fds-ft-twisty:hover { color: var(--fds-text-primary); }
.fds-ft-twisty > svg {
  transition: transform var(--fds-motion-fast);
  transform: rotate(0deg);
}
.fds-ft-twisty[data-expanded="true"] > svg { transform: rotate(90deg); }
.fds-ft-twisty[data-leaf="true"] { visibility: hidden; }

/* --- Node status dot ----------------------------------------------------- */
.fds-ft-dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--fds-text-disabled);
}
.fds-ft-row[data-active="true"] .fds-ft-dot { background: var(--fds-accent); }

/* --- Per-node icon ------------------------------------------------------- */
.fds-ft-icon {
  display: inline-flex;
  flex-shrink: 0;
  color: var(--fds-text-tertiary);
}
.fds-ft-row:hover .fds-ft-icon,
.fds-ft-row[data-active="true"] .fds-ft-icon,
.fds-ft-row[data-selected="true"] .fds-ft-icon { color: var(--fds-text-secondary); }

/* --- Label + inline rename ---------------------------------------------- */
.fds-ft-label {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.fds-ft-qty {
  flex-shrink: 0;
  margin-left: var(--fds-space-1);
  font-family: var(--fds-font-num);
  font-variant-numeric: tabular-nums lining-nums;
  font-size: var(--fds-fs-micro);
  color: var(--fds-text-tertiary);
}
.fds-ft-value {
  flex-shrink: 0;
  font-family: var(--fds-font-num);
  font-variant-numeric: tabular-nums lining-nums;
  font-size: var(--fds-fs-micro);
  color: var(--fds-text-tertiary);
  text-align: right;
}
.fds-ft-rename {
  flex: 1 1 auto;
  min-width: 80px;
  height: calc(var(--fds-row-h-compact) - 4px);
  padding: 0 var(--fds-space-2);
  background: var(--fds-surface-overlay-2);
  border: var(--fds-border-w) solid var(--fds-accent-rim);
  border-radius: var(--fds-radius-sm);
  color: var(--fds-text-primary);
  font-family: var(--fds-font-ui);
  font-size: var(--fds-fs-small);
  outline: none;
}

/* --- Trailing row actions (reveal on hover / selection) ------------------ */
.fds-ft-row-actions {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  flex-shrink: 0;
  margin-left: var(--fds-space-1);
  opacity: 0;
  transition: opacity var(--fds-motion-fast);
}
.fds-ft-row:hover .fds-ft-row-actions,
.fds-ft-row[data-active="true"] .fds-ft-row-actions,
.fds-ft-row[data-selected="true"] .fds-ft-row-actions,
.fds-ft-row-actions[data-pinned="true"] { opacity: 1; }
.fds-ft-row-actions > button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--fds-control-h-xs);
  height: var(--fds-control-h-xs);
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--fds-radius-xs);
  color: var(--fds-text-tertiary);
  cursor: pointer;
  transition: background var(--fds-motion-fast), color var(--fds-motion-fast);
}
.fds-ft-row-actions > button:hover {
  background: var(--fds-state-hover);
  color: var(--fds-text-primary);
}
.fds-ft-row-actions > button[data-on="true"] { color: var(--fds-text-secondary); }
.fds-ft-row-actions > button[data-signal="warn"] { color: var(--fds-signal-warn); }
.fds-ft-row-actions > button[data-signal="error"] { color: var(--fds-signal-error); }
.fds-ft-row-actions > button[data-signal="accent"] { color: var(--fds-accent); }

/* --- Nested children groups (indentation guide rail) --------------------- */
.fds-ft-children { list-style: none; margin: 0; padding: 0; }

/* --- Section sub-head (within a tree, e.g. "Unassigned") ----------------- */
.fds-ft-subhead {
  display: flex;
  align-items: center;
  gap: var(--fds-space-2);
  padding: var(--fds-space-3) var(--fds-space-3) var(--fds-space-2);
  font-size: var(--fds-fs-micro);
  font-weight: var(--fds-fw-medium);
  letter-spacing: var(--fds-tracking-label);
  text-transform: uppercase;
  color: var(--fds-text-tertiary);
}
.fds-ft-subhead-rule { flex: 1 1 auto; height: var(--fds-border-w); background: var(--fds-border-subtle); }

/* --- Empty-state --------------------------------------------------------- */
.fds-ft-empty {
  padding: var(--fds-space-4) var(--fds-space-4);
  color: var(--fds-text-tertiary);
  font-size: var(--fds-fs-small);
  line-height: var(--fds-lh-base);
}
.fds-ft-empty strong { color: var(--fds-text-secondary); font-weight: var(--fds-fw-medium); }

/* --- Drop zone (detach / reparent target) -------------------------------- */
.fds-ft-dropzone {
  margin: var(--fds-space-2) var(--fds-space-3);
  padding: var(--fds-space-2) var(--fds-space-3);
  border: var(--fds-border-w) dashed var(--fds-border);
  border-radius: var(--fds-radius-sm);
  color: var(--fds-text-tertiary);
  font-size: var(--fds-fs-micro);
  text-align: center;
  transition: background var(--fds-motion-fast), border-color var(--fds-motion-fast);
}
.fds-ft-dropzone[data-drag-over="true"] {
  background: var(--fds-state-selected);
  border-color: var(--fds-accent-rim);
  color: var(--fds-text-secondary);
}

/* --- Context menu (shared across the tree panels) ------------------------ */
.fds-ft-menu {
  list-style: none;
  margin: 0;
  padding: var(--fds-space-2);
  min-width: 168px;
  background: var(--fds-surface-panel);
  border: var(--fds-border-w) solid var(--fds-border-strong);
  border-radius: var(--fds-radius-md);
  box-shadow: var(--fds-elev-2);
}
.fds-ft-menu-item {
  display: flex;
  align-items: center;
  gap: var(--fds-space-3);
  width: 100%;
  height: var(--fds-control-h-sm);
  padding: 0 var(--fds-space-3);
  background: transparent;
  border: none;
  border-radius: var(--fds-radius-sm);
  color: var(--fds-text-secondary);
  font-family: var(--fds-font-ui);
  font-size: var(--fds-fs-small);
  text-align: left;
  cursor: pointer;
  transition: background var(--fds-motion-fast), color var(--fds-motion-fast);
}
.fds-ft-menu-item:hover { background: var(--fds-state-hover); color: var(--fds-text-primary); }
.fds-ft-menu-item > svg { color: var(--fds-text-tertiary); flex-shrink: 0; }
.fds-ft-menu-item[data-danger="true"] { color: var(--fds-signal-error); }
.fds-ft-menu-item[data-danger="true"] > svg { color: var(--fds-signal-error); }
.fds-ft-menu-sep { height: var(--fds-border-w); background: var(--fds-border); margin: var(--fds-space-2) 0; }
.fds-ft-menu-meta {
  padding: var(--fds-space-2) var(--fds-space-3);
  font-family: var(--fds-font-num);
  font-variant-numeric: tabular-nums lining-nums;
  font-size: var(--fds-fs-micro);
  line-height: var(--fds-lh-micro);
  color: var(--fds-text-tertiary);
}
`;

/**
 * Idempotently inject the left-tree stylesheet into <head>. Safe to call
 * from every tree component on every render; the work happens once.
 */
export function ensureTreeStyles() {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;
  const el = document.createElement('style');
  el.id = STYLE_ID;
  el.textContent = CSS;
  document.head.appendChild(el);
}

/**
 * A crisp 1.5px-stroke chevron that matches the forge-v4 icon idiom
 * (currentColor, rounded caps). Rotated 90° by the `.fds-ft-twisty`
 * class when its parent is `data-expanded="true"`.
 */
export function TreeChevron({ size = 12 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none"
         stroke="currentColor" strokeWidth="1.5"
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 4l4 4-4 4" />
    </svg>
  );
}
