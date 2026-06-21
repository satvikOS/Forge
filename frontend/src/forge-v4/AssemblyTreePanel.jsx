// Forge-101 — Nested assembly hierarchy panel.
//
// A right-anchored 340 px drawer (matches `--forge-right-w` design token)
// that renders the instance tree as a collapsible hierarchy. Each row
// shows the instance icon, name, and three controls: hide, isolate,
// suppress. Drag-drop reparents an instance; right-click opens a
// contextual menu (rename / delete / show props).
//
// ForgeShellV4.jsx + Toolbar.jsx are off-limits this slice — the panel
// portals itself onto document.body and exposes a global toggle on
// `window.__forgeOpenAssemblyTree()` for the shell, Archie, and the
// e2e harness. Manual clicks never write to the Archie thread.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import {
  createInstance, deleteInstance, getChildren, getInstance,
  isolate as isolateInstance, listInstances, listRoots,
  renameInstance, setParent, setVisibility, subassemblyBounds,
  worldTransform,
} from './assemblyHierarchy.js';
import { FlexibleComponentToggle } from './FlexibleComponentToggle.jsx';
import { ensureTreeStyles, TreeChevron } from './treeStyles.jsx';

const PANEL_W = 340;
const INDENT_PX = 14; // per-depth indentation step

function panelStyle() {
  return {
    position: 'fixed',
    top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
    right: 0,
    width: PANEL_W,
    maxWidth: '96vw',
    height: 'calc(100vh - var(--forge-topbar-h) - var(--forge-qat-h) - var(--forge-cmdbar-h))',
    background: 'var(--fds-surface-panel)',
    borderLeft: 'var(--fds-border-w) solid var(--fds-border)',
    boxShadow: 'var(--fds-elev-3)',
    display: 'flex', flexDirection: 'column',
    fontFamily: 'var(--fds-font-ui)',
    fontSize: 'var(--fds-fs-small)',
    color: 'var(--fds-text-secondary)',
    zIndex: 'var(--fds-z-drawer)',
  };
}

// ─────────────────────────────────────────────────────────────────────

export function AssemblyTreePanel({
  open,
  onClose,
  bodies = [],
  selection,
  onSelect,
}) {
  ensureTreeStyles();
  // Re-render tick — bumped after every mutation that touches the
  // module-level cache so the tree re-reads its source of truth.
  const [tick, setTick] = useState(0);
  const force = useCallback(() => setTick((t) => t + 1), []);

  const [collapsed, setCollapsed] = useState(() => new Set());
  const [contextMenu, setContextMenu] = useState(null);
  const [renaming, setRenaming] = useState(null);
  const dragRef = useRef(null);

  // Roots → top-level instances. Each child is fetched lazily as the
  // user expands a node so kernel.getChildren reconciliation stays cheap.
  const roots = useMemo(() => getChildren(null), [tick, bodies]);

  // Closing the context menu on outside click.
  useEffect(() => {
    if (!contextMenu) return undefined;
    const onDoc = () => setContextMenu(null);
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [contextMenu]);

  // Expose a manual reload — used by tests + Archie after createInstance.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeReloadAssemblyTree = force;
    return () => { try { delete window.__forgeReloadAssemblyTree; } catch {} };
  }, [force]);

  if (!open) return null;

  const handleCreateRoot = () => {
    // Insert a placeholder instance referencing the first body in the
    // body registry, or a bodyless node if there are none. This gives
    // the user something to drag/rename so the panel is usable even
    // before the kernel attaches.
    const firstBody = bodies?.[0]?.id ?? null;
    createInstance({ bodyId: firstBody, name: 'Sub-assembly' });
    force();
  };

  return createPortal(
    <aside
      role="region"
      aria-label="Assembly hierarchy"
      data-testid="forge-asm-tree"
      style={panelStyle()}>

      <Header onClose={onClose} count={listInstances().length} />

      <div className="fds-ft-search" style={{ gap: 'var(--fds-space-2)' }}>
        <button type="button"
                onClick={handleCreateRoot}
                data-testid="forge-asm-add-root"
                className="fds-ft-menu-item"
                style={{
                  width: 'auto', height: 'var(--fds-control-h-sm)',
                  border: 'var(--fds-border-w) solid var(--fds-border)',
                  background: 'var(--fds-surface-overlay)',
                  color: 'var(--fds-text-primary)',
                  fontWeight: 'var(--fds-fw-medium)',
                }}>
          <Icon name="wb.mech" size={12} />
          <span>New sub-assembly</span>
        </button>
        <span style={{ flex: 1 }} />
        <span className="fds-ft-value">
          {roots.length} root{roots.length === 1 ? '' : 's'}
        </span>
      </div>

      <div className="fds-ft-body">
        {roots.length === 0 && (
          <div className="fds-ft-empty">
            Tree is empty. Insert parts via the standard parts library, or
            create a <strong>sub-assembly</strong> above.
          </div>
        )}
        <ul className="fds-ft-list"
            data-testid="forge-asm-root-list">
          {roots.map((inst) => (
            <TreeNode
              key={inst.id}
              instance={inst}
              depth={0}
              bodies={bodies}
              selection={selection}
              onSelect={onSelect}
              collapsed={collapsed}
              setCollapsed={setCollapsed}
              renaming={renaming}
              setRenaming={setRenaming}
              dragRef={dragRef}
              onMutate={force}
              onContext={(evt, id) => {
                evt.preventDefault();
                setContextMenu({
                  x: evt.clientX,
                  y: evt.clientY,
                  instanceId: id,
                });
              }}
            />
          ))}
        </ul>
      </div>

      {contextMenu && (
        <ContextMenu
          ctx={contextMenu}
          bodies={bodies}
          onClose={() => setContextMenu(null)}
          onRename={(id) => {
            setRenaming(id);
            setContextMenu(null);
          }}
          onDelete={(id) => {
            deleteInstance(id);
            force();
            setContextMenu(null);
          }}
        />
      )}
    </aside>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────

function Header({ onClose, count }) {
  return (
    <header className="fds-ft-dock-head" style={{ flexShrink: 0 }}>
      <span className="fds-ft-dock-title">
        <Icon name="wb.mech" size={14} />
        <span>Assembly Tree</span>
      </span>
      <span className="fds-ft-count">{count}</span>
      <span className="fds-ft-head-spacer" />
      <button type="button"
              onClick={onClose}
              aria-label="Close assembly tree"
              data-testid="forge-asm-close"
              className="fds-ft-iconbtn">
        <Icon name="select.clear" size={12} />
      </button>
    </header>
  );
}

function TreeNode({
  instance, depth, bodies,
  selection, onSelect,
  collapsed, setCollapsed,
  renaming, setRenaming,
  dragRef, onMutate, onContext,
}) {
  const children = useMemo(() => getChildren(instance.id), [instance.id, instance.parentId, depth]);
  const hasChildren = children.length > 0;
  const isCollapsed = collapsed.has(instance.id);
  const body = bodies?.find?.((b) => b.id === instance.bodyId);
  const isSelected = selection?.kind === 'instance' &&
                     Array.isArray(selection.ids) &&
                     selection.ids.includes(instance.id);

  const handleToggle = (e) => {
    e.stopPropagation();
    const next = new Set(collapsed);
    if (next.has(instance.id)) next.delete(instance.id);
    else next.add(instance.id);
    setCollapsed(next);
  };

  const handleClick = () => {
    onSelect?.({ kind: 'instance', ids: [instance.id] });
  };

  const handleDragStart = (e) => {
    dragRef.current = instance.id;
    try {
      e.dataTransfer.setData('forge/assembly-instance', String(instance.id));
      e.dataTransfer.effectAllowed = 'move';
    } catch {}
  };
  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };
  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const childId = dragRef.current ?? parseInt(
      e.dataTransfer.getData('forge/assembly-instance'), 10);
    dragRef.current = null;
    if (!Number.isFinite(childId) || childId === instance.id) return;
    setParent(childId, instance.id);
    onMutate();
  };

  return (
    <li data-testid="forge-asm-node"
        data-instance-id={instance.id}
        data-depth={depth}
        data-hidden={String(!!instance.hidden)}
        data-suppressed={String(!!instance.suppressed)}>
      <div className="fds-ft-row"
           data-selected={isSelected ? 'true' : undefined}
           data-hidden={instance.hidden ? 'true' : undefined}
           data-suppressed={instance.suppressed ? 'true' : undefined}
           style={{ '--ft-indent': `calc(var(--fds-space-3) + ${depth * INDENT_PX}px)` }}
           onClick={handleClick}
           onContextMenu={(e) => onContext(e, instance.id)}
           draggable
           onDragStart={handleDragStart}
           onDragOver={handleDragOver}
           onDrop={handleDrop}>
        <button type="button"
                onClick={handleToggle}
                aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                data-testid="forge-asm-toggle"
                data-collapsed={String(isCollapsed)}
                className="fds-ft-twisty"
                data-expanded={!isCollapsed ? 'true' : undefined}
                data-leaf={!hasChildren ? 'true' : undefined}>
          <TreeChevron size={12} />
        </button>
        <span className="fds-ft-icon">
          <Icon name={hasChildren ? 'wb.mech' : 'select.body'} size={12} />
        </span>

        {renaming === instance.id ? (
          <input type="text"
                 autoFocus
                 defaultValue={instance.name}
                 onBlur={(e) => {
                   renameInstance(instance.id, e.target.value);
                   setRenaming(null);
                   onMutate();
                 }}
                 onKeyDown={(e) => {
                   if (e.key === 'Enter') e.target.blur();
                   if (e.key === 'Escape') {
                     setRenaming(null);
                   }
                 }}
                 data-testid="forge-asm-rename"
                 className="fds-ft-rename"
                 onClick={(e) => e.stopPropagation()} />
        ) : (
          <span className="fds-ft-label"
                title={body ? `${instance.name} → ${body.name || body.id}` : instance.name}>
            {instance.name}
            {instance.qty > 1 && (
              <span className="fds-ft-qty">×{instance.qty}</span>
            )}
          </span>
        )}

        <FlexibleComponentToggle inst={instance.id}
                                 name={instance.name}
                                 compact />

        <NodeControls
          instance={instance}
          onChange={onMutate}
        />
      </div>

      {hasChildren && !isCollapsed && (
        <ul className="fds-ft-children">
          {children.map((child) => (
            <TreeNode
              key={child.id}
              instance={child}
              depth={depth + 1}
              bodies={bodies}
              selection={selection}
              onSelect={onSelect}
              collapsed={collapsed}
              setCollapsed={setCollapsed}
              renaming={renaming}
              setRenaming={setRenaming}
              dragRef={dragRef}
              onMutate={onMutate}
              onContext={onContext}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function NodeControls({ instance, onChange }) {
  return (
    <span className="fds-ft-row-actions"
          data-pinned={(instance.hidden || instance.isolated || instance.suppressed) ? 'true' : undefined}
          onClick={(e) => e.stopPropagation()}>
      <button type="button"
              onClick={() => {
                setVisibility(instance.id, 'hidden', !instance.hidden);
                onChange();
              }}
              aria-label={instance.hidden ? 'Show' : 'Hide'}
              data-testid="forge-asm-hide"
              title="Hide / show"
              data-signal={instance.hidden ? 'warn' : undefined}>
        <Icon name={instance.hidden ? 'misc.eye_off' : 'misc.eye'} size={12} />
      </button>
      <button type="button"
              onClick={() => {
                if (instance.isolated) {
                  setVisibility(instance.id, 'isolated', false);
                } else {
                  isolateInstance(instance.id);
                }
                onChange();
              }}
              aria-label="Isolate"
              data-testid="forge-asm-isolate"
              title="Isolate this subassembly"
              data-signal={instance.isolated ? 'accent' : undefined}>
        <Icon name="view.iso" size={12} />
      </button>
      <button type="button"
              onClick={() => {
                setVisibility(instance.id, 'suppressed', !instance.suppressed);
                onChange();
              }}
              aria-label={instance.suppressed ? 'Unsuppress' : 'Suppress'}
              data-testid="forge-asm-suppress"
              title="Suppress (skip in solve + BOM)"
              data-signal={instance.suppressed ? 'error' : undefined}>
        <Icon name="select.clear" size={12} />
      </button>
    </span>
  );
}

function ContextMenu({ ctx, bodies, onClose, onRename, onDelete }) {
  const inst = getInstance(ctx.instanceId);
  if (!inst) return null;
  const body = bodies?.find?.((b) => b.id === inst.bodyId) || null;
  const bounds = subassemblyBounds(inst.id, bodies);
  const wt = worldTransform(inst.id);
  return (
    <div className="fds-ft-menu"
         style={{
           position: 'fixed',
           left: Math.min(ctx.x, window.innerWidth - 220),
           top: Math.min(ctx.y, window.innerHeight - 200),
           width: 210,
           zIndex: 'var(--fds-z-popover)',
         }}
         data-testid="forge-asm-context"
         onMouseDown={(e) => e.stopPropagation()}>
      <MenuItem
        icon="edit.copy"
        label="Rename"
        testid="forge-asm-ctx-rename"
        onClick={() => onRename(inst.id)} />
      <MenuItem
        icon="edit.delete"
        label="Delete"
        testid="forge-asm-ctx-delete"
        kind="danger"
        onClick={() => onDelete(inst.id)} />
      <div className="fds-ft-menu-sep" role="separator" />
      <div className="fds-ft-menu-meta" data-testid="forge-asm-ctx-props">
        <div>id: {inst.id}</div>
        <div>body: {body?.name || (inst.bodyId == null ? '—' : `#${inst.bodyId}`)}</div>
        <div>qty: {inst.qty}</div>
        <div>parent: {inst.parentId == null ? 'root' : `#${inst.parentId}`}</div>
        <div>origin: {(+wt[12]).toFixed(1)}, {(+wt[13]).toFixed(1)}, {(+wt[14]).toFixed(1)}</div>
        {!bounds.empty && (
          <div>
            size: {(bounds.max[0] - bounds.min[0]).toFixed(1)} ×{' '}
            {(bounds.max[1] - bounds.min[1]).toFixed(1)} ×{' '}
            {(bounds.max[2] - bounds.min[2]).toFixed(1)} mm
          </div>
        )}
      </div>
      <div className="fds-ft-menu-sep" role="separator" />
      <button type="button"
              onClick={onClose}
              className="fds-ft-menu-item"
              style={{ justifyContent: 'center', color: 'var(--fds-text-tertiary)' }}>
        Close
      </button>
    </div>
  );
}

function MenuItem({ icon, label, onClick, testid, kind }) {
  return (
    <button type="button"
            onClick={onClick}
            data-testid={testid}
            className="fds-ft-menu-item"
            data-danger={kind === 'danger' ? 'true' : undefined}>
      {icon && <Icon name={icon} size={12} />}
      <span>{label}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host. ForgeShellV4 is off-limits this slice, so we
// portal the panel onto document.body and expose:
//   window.__forgeOpenAssemblyTree(true|false)
//
// The shell can set `window.__forgeBodies = [...]` (it already does for
// the CAM workbench) so the panel renders body names alongside instance
// rows; the panel falls back gracefully when that snapshot is empty.

export function AssemblyTreePanelHost() {
  const [open, setOpen] = useState(false);
  const [bodies, setBodies] = useState(() =>
    (typeof window !== 'undefined' && Array.isArray(window.__forgeBodies))
      ? window.__forgeBodies
      : []);
  const [selection, setSelection] = useState(null);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenAssemblyTree = (v) => {
      // Refresh the body snapshot every time the panel toggles open —
      // the shell mutates window.__forgeBodies in place.
      if (Array.isArray(window.__forgeBodies)) setBodies(window.__forgeBodies);
      setOpen(v === undefined ? true : !!v);
    };
    window.__forgeCloseAssemblyTree = () => setOpen(false);
    return () => {
      try { delete window.__forgeOpenAssemblyTree; } catch {}
      try { delete window.__forgeCloseAssemblyTree; } catch {}
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return (
    <AssemblyTreePanel
      open={open}
      onClose={() => setOpen(false)}
      bodies={bodies}
      selection={selection}
      onSelect={(sel) => {
        setSelection(sel);
        if (typeof window !== 'undefined' &&
            typeof window.__forgeSelectInstance === 'function') {
          try { window.__forgeSelectInstance(sel); } catch {}
        }
      }} />
  );
}

export default AssemblyTreePanel;
