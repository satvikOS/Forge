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

const PANEL_W = 340;

function panelStyle() {
  return {
    position: 'fixed',
    top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
    right: 0,
    width: PANEL_W,
    maxWidth: '96vw',
    height: 'calc(100vh - var(--forge-topbar-h) - var(--forge-qat-h) - var(--forge-cmdbar-h))',
    background: 'var(--forge-canvas-2)',
    borderLeft: '1px solid var(--forge-rail-edge)',
    boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
    display: 'flex', flexDirection: 'column',
    fontSize: 13,
    color: 'var(--forge-ink)',
    zIndex: 1295,
  };
}

const ROW_BTN = {
  background: 'transparent',
  border: 'none',
  color: 'var(--forge-ink-mute)',
  cursor: 'pointer',
  padding: 2,
  display: 'inline-flex',
  alignItems: 'center',
  borderRadius: 2,
};

// ─────────────────────────────────────────────────────────────────────

export function AssemblyTreePanel({
  open,
  onClose,
  bodies = [],
  selection,
  onSelect,
}) {
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

      <div style={{
        padding: '6px 8px',
        borderBottom: '1px solid var(--forge-rail-edge)',
        display: 'flex', gap: 6, alignItems: 'center',
      }}>
        <button type="button"
                onClick={handleCreateRoot}
                data-testid="forge-asm-add-root"
                style={{
                  background: 'var(--forge-surface)',
                  border: '1px solid var(--forge-rail-edge)',
                  borderRadius: 3,
                  color: 'var(--forge-ink)',
                  fontSize: 11, padding: '3px 8px',
                  cursor: 'pointer',
                }}>
          + Sub-assembly
        </button>
        <span style={{ flex: 1 }} />
        <span style={{
          fontFamily: 'var(--forge-mono)', fontSize: 10,
          color: 'var(--forge-ink-mute)',
        }}>
          {roots.length} root{roots.length === 1 ? '' : 's'}
        </span>
      </div>

      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '4px 0',
      }}>
        {roots.length === 0 && (
          <div style={{
            padding: 16, fontStyle: 'italic',
            color: 'var(--forge-ink-mute)', fontSize: 12,
          }}>
            Tree is empty. Insert parts via the standard parts library, or
            create a sub-assembly above.
          </div>
        )}
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}
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
    <header style={{
      display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)',
      padding: 'var(--forge-space-3) var(--forge-space-4)',
      borderBottom: '1px solid var(--forge-rail-edge)',
      background: 'var(--forge-canvas)',
      fontSize: 12, fontWeight: 600, flexShrink: 0,
    }}>
      <Icon name="wb.mech" size={14} />
      <span>Assembly tree</span>
      <span style={{
        fontFamily: 'var(--forge-mono)', fontSize: 10,
        color: 'var(--forge-ink-mute)',
        padding: '1px 6px', borderRadius: 'var(--forge-radius-pill)',
        border: '1px solid var(--forge-rail-edge)',
      }}>
        {count}
      </span>
      <span style={{ flex: 1 }} />
      <button type="button"
              onClick={onClose}
              aria-label="Close assembly tree"
              data-testid="forge-asm-close"
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--forge-ink-mute)', cursor: 'pointer',
                display: 'inline-flex', padding: 2,
              }}>
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

  const rowStyle = {
    display: 'flex', alignItems: 'center', gap: 4,
    padding: `2px 8px 2px ${8 + depth * 14}px`,
    cursor: 'pointer',
    background: isSelected ? 'var(--forge-accent-mute)' : 'transparent',
    borderLeft: isSelected
      ? '2px solid var(--forge-accent)'
      : '2px solid transparent',
    opacity: instance.hidden || instance.suppressed ? 0.45 : 1,
    fontSize: 12,
  };

  return (
    <li data-testid="forge-asm-node"
        data-instance-id={instance.id}
        data-depth={depth}
        data-hidden={String(!!instance.hidden)}
        data-suppressed={String(!!instance.suppressed)}>
      <div style={rowStyle}
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
                style={{
                  ...ROW_BTN,
                  visibility: hasChildren ? 'visible' : 'hidden',
                  width: 14,
                  color: 'var(--forge-ink-2)',
                  fontFamily: 'var(--forge-mono)',
                  fontSize: 10,
                }}>
          {isCollapsed ? '▶' : '▼'}
        </button>
        <Icon name={hasChildren ? 'wb.mech' : 'select.body'} size={11} />

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
                 style={{
                   flex: 1,
                   background: 'var(--forge-canvas)',
                   border: '1px solid var(--forge-accent-rim)',
                   borderRadius: 2,
                   color: 'var(--forge-ink)',
                   font: 'inherit',
                   padding: '1px 4px',
                 }}
                 onClick={(e) => e.stopPropagation()} />
        ) : (
          <span style={{
            flex: 1, overflow: 'hidden',
            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: 'var(--forge-ink)',
            fontFamily: 'var(--forge-mono)',
            fontSize: 11,
          }} title={body ? `${instance.name} → ${body.name || body.id}` : instance.name}>
            {instance.name}
            {instance.qty > 1 && (
              <span style={{
                color: 'var(--forge-ink-mute)', marginLeft: 4,
                fontSize: 10,
              }}>×{instance.qty}</span>
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
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
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
    <span style={{ display: 'inline-flex', gap: 2 }}
          onClick={(e) => e.stopPropagation()}>
      <button type="button"
              onClick={() => {
                setVisibility(instance.id, 'hidden', !instance.hidden);
                onChange();
              }}
              aria-label={instance.hidden ? 'Show' : 'Hide'}
              data-testid="forge-asm-hide"
              title="Hide / show"
              style={{
                ...ROW_BTN,
                color: instance.hidden ? 'var(--forge-warn)' : 'var(--forge-ink-mute)',
              }}>
        <Icon name={instance.hidden ? 'view.iso' : 'view.front'} size={11} />
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
              style={{
                ...ROW_BTN,
                color: instance.isolated ? 'var(--forge-accent)' : 'var(--forge-ink-mute)',
              }}>
        <Icon name="select.body" size={11} />
      </button>
      <button type="button"
              onClick={() => {
                setVisibility(instance.id, 'suppressed', !instance.suppressed);
                onChange();
              }}
              aria-label={instance.suppressed ? 'Unsuppress' : 'Suppress'}
              data-testid="forge-asm-suppress"
              title="Suppress (skip in solve + BOM)"
              style={{
                ...ROW_BTN,
                color: instance.suppressed ? 'var(--forge-err)' : 'var(--forge-ink-mute)',
              }}>
        <Icon name="select.clear" size={11} />
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
    <div style={{
      position: 'fixed',
      left: Math.min(ctx.x, window.innerWidth - 220),
      top: Math.min(ctx.y, window.innerHeight - 200),
      width: 210,
      background: 'var(--forge-canvas-3)',
      border: '1px solid var(--forge-rail-edge)',
      borderRadius: 'var(--forge-radius)',
      boxShadow: '0 6px 24px rgba(0,0,0,0.55)',
      zIndex: 1340,
      fontSize: 11,
    }}
         data-testid="forge-asm-context"
         onMouseDown={(e) => e.stopPropagation()}>
      <MenuItem
        label="Rename"
        testid="forge-asm-ctx-rename"
        onClick={() => onRename(inst.id)} />
      <MenuItem
        label="Delete"
        testid="forge-asm-ctx-delete"
        kind="danger"
        onClick={() => onDelete(inst.id)} />
      <div style={{
        borderTop: '1px solid var(--forge-rail-edge)',
        padding: '6px 8px',
        color: 'var(--forge-ink-mute)',
        fontFamily: 'var(--forge-mono)',
        fontSize: 10,
        lineHeight: 1.5,
      }} data-testid="forge-asm-ctx-props">
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
      <button type="button"
              onClick={onClose}
              style={{
                ...ROW_BTN,
                width: '100%',
                padding: '4px 8px',
                color: 'var(--forge-ink-mute)',
                borderTop: '1px solid var(--forge-rail-edge)',
                justifyContent: 'center',
              }}>
        close
      </button>
    </div>
  );
}

function MenuItem({ label, onClick, testid, kind }) {
  return (
    <button type="button"
            onClick={onClick}
            data-testid={testid}
            style={{
              display: 'block', width: '100%',
              textAlign: 'left',
              padding: '5px 10px',
              background: 'transparent',
              border: 'none',
              color: kind === 'danger' ? 'var(--forge-err)' : 'var(--forge-ink)',
              cursor: 'pointer',
              fontSize: 11,
              font: 'inherit',
            }}>
      {label}
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
