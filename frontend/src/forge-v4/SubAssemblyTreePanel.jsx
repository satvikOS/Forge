// PUSH-134 (Slice-99) — Sub-assembly hierarchy tree.
//
// Up through PUSH-69 the only "grouping" surface for native bodies was
// the Layers Manager — a flat membership map keyed by name. Real MCAD
// assemblies need a nested TREE: a top-level sub-assembly ("Drivetrain")
// holds children ("MotorAssembly", "GearBox"), each of which holds its
// own grandchildren ("Stator", "Rotor", …). PUSH-134 closes that gap
// with a dedicated sub-assembly tree panel.
//
// What this panel adds vs. PUSH-69 Layers and Forge-101 AssemblyTree:
//   • A nested PARENT → CHILDREN tree of named sub-assemblies the user
//     builds at any depth (root sub-assemblies + sub-sub-assemblies …).
//     Forge-101's AssemblyTreePanel sits on the instance-hierarchy
//     kernel (a different model focused on `instances` of bodies, used
//     by FlexibleComponentToggle + the world-transform math); PUSH-134
//     is a per-body grouping tree built directly off
//     `window.__forgeBodies` and the user's free-form node names.
//   • Drag-and-drop bodies INTO sub-assemblies (also: drag bodies out
//     back to the root, drag sub-assemblies into other sub-assemblies
//     to re-parent).
//   • Each sub-assembly node aggregates its descendants' mass via
//     window.forge.massProps(handle) → volume × density (steel default,
//     same convention as PUSH-58 MassProps); mass of a sub-assembly =
//     sum of all native bodies in the sub-tree.
//   • Persists the entire tree (sub-assembly nodes + body→parent map)
//     to localStorage key `forge.v4.subAssemblies`. Survives reload.
//   • Exposes window.__forgeSubAssemblies (live snapshot) +
//     window.__forgeOpenSubAssemblyTree(true|false) hook for plugins
//     and the e2e harness.
//   • Listens for `forge:bodies-changed` so newly imported / deleted
//     bodies refresh the orphan list immediately.
//
// Constraints honoured (PUSH-134 brief):
//   * NO new npm packages, NO new C++ libs — React + the existing
//     window.__forge* surface only.
//   * NO MVP, NO fallback, NO stub — drag-drop, persistence, mass
//     aggregation, bus events all real.
//   * Surgical edits to Menus.jsx + App.jsx (one new entry + one mount).
//   * Multi-cam e2e: 5 named camera angles per the Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';

// ─────────────────────────────────────────────────────────────────────
// Persistence — sub-assembly node set + body→parent map live in
// localStorage so the user's hierarchy survives reload. Shape on disk:
//   {
//     "version": 1,
//     "nodes": [
//       { "id": "node-1", "name": "Drivetrain", "parentId": null },
//       { "id": "node-2", "name": "MotorAsm",   "parentId": "node-1" }
//     ],
//     "bodyParents": { "<bodyId>": "<nodeId>" }
//   }
//
// Body key is `b.id` (the stable PUSH-32+ string id) with a handle-string
// fallback for bodies that arrived without an id.

export const FORGE_SUB_ASSEMBLIES_KEY   = 'forge.v4.subAssemblies';
export const FORGE_SUB_ASSEMBLIES_EVENT = 'forge:sub-assemblies-changed';

// Default density (steel, g/cc) for sub-assembly mass aggregation when
// the body has no material override. Matches the PUSH-58 MassProps
// fallback exactly.
const DEFAULT_DENSITY_G_CC = 7.85;

function bodyKey(b) {
  if (!b || typeof b !== 'object') return null;
  if (typeof b.id === 'string' && b.id.length) return b.id;
  if (typeof b.handle === 'number') return `handle:${b.handle}`;
  return null;
}

function emptyStore() {
  return { version: 1, nodes: [], bodyParents: {} };
}

function normaliseStore(raw) {
  if (!raw || typeof raw !== 'object') return emptyStore();
  const rawNodes = Array.isArray(raw.nodes) ? raw.nodes : [];
  // Build a {id → node} map first so we can detect cycles / orphans.
  const nodes = [];
  const seen = new Set();
  for (const n of rawNodes) {
    if (!n || typeof n !== 'object') continue;
    const id = typeof n.id === 'string' && n.id.length ? n.id : null;
    if (!id || seen.has(id)) continue;
    const name = typeof n.name === 'string' && n.name.length
      ? n.name : id;
    const parentId = typeof n.parentId === 'string' && n.parentId.length
      ? n.parentId : null;
    nodes.push({ id, name, parentId });
    seen.add(id);
  }
  // Re-pass: orphan-parent references degrade to root.
  const ids = new Set(nodes.map((n) => n.id));
  for (const n of nodes) {
    if (n.parentId && !ids.has(n.parentId)) n.parentId = null;
  }
  // Break cycles: if walking up the parent chain hits the node itself,
  // detach to root.
  for (const n of nodes) {
    let cursor = n.parentId;
    const visited = new Set([n.id]);
    while (cursor) {
      if (visited.has(cursor)) { n.parentId = null; break; }
      visited.add(cursor);
      const p = nodes.find((m) => m.id === cursor);
      cursor = p ? p.parentId : null;
    }
  }
  // Body parent map: drop entries whose target node no longer exists.
  const rawMap = (raw.bodyParents && typeof raw.bodyParents === 'object')
    ? raw.bodyParents : {};
  const bodyParents = {};
  for (const [k, v] of Object.entries(rawMap)) {
    if (typeof v === 'string' && ids.has(v)) bodyParents[k] = v;
  }
  return { version: 1, nodes, bodyParents };
}

export function loadSubAssemblyStore() {
  if (typeof window === 'undefined') return emptyStore();
  try {
    const txt = window.localStorage.getItem(FORGE_SUB_ASSEMBLIES_KEY);
    if (!txt) return emptyStore();
    return normaliseStore(JSON.parse(txt));
  } catch {
    return emptyStore();
  }
}

export function saveSubAssemblyStore(store) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      FORGE_SUB_ASSEMBLIES_KEY,
      JSON.stringify(normaliseStore(store)),
    );
  } catch { /* quota etc. — fail-soft */ }
}

// Publish the live store on the window + emit the bus event so any
// non-panel consumer (project file load, plugins, downstream BOM
// aggregator) can react without polling.
function publishStore(store) {
  if (typeof window === 'undefined') return;
  saveSubAssemblyStore(store);
  window.__forgeSubAssemblies = store;
  try {
    window.dispatchEvent(new CustomEvent(
      FORGE_SUB_ASSEMBLIES_EVENT, { detail: store }));
  } catch { /* CustomEvent universal in Electron */ }
}

// Read native bodies the same way LayersPanel + MaterialsBrowser do.
function readNativeBodies() {
  if (typeof window === 'undefined') return [];
  const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return all.filter(
    (b) => b && b.kind === 'native' && typeof b.handle === 'number',
  );
}

// Read the material density (g/cc) for a body via the PUSH-61 body
// materials map. Falls back to steel.
function bodyDensity(body) {
  if (!body) return DEFAULT_DENSITY_G_CC;
  const map = (typeof window !== 'undefined') ? window.__forgeBodyMaterials : null;
  if (map && typeof map === 'object') {
    const matName = map[body.id] || map[`handle:${body.handle}`];
    // The materialCatalogue density lookup is via window.__forgeMaterialDensity
    // (a Map id → g/cc) when the materials browser is loaded; fail-soft.
    if (matName && typeof window.__forgeMaterialDensity === 'function') {
      const d = window.__forgeMaterialDensity(matName);
      if (Number.isFinite(d) && d > 0) return d;
    }
  }
  return DEFAULT_DENSITY_G_CC;
}

// Compute mass (g) of a single native body via the kernel mass-props
// surface. Returns 0 if the kernel can't deliver a volume.
function bodyMassGrams(body) {
  if (!body || typeof body.handle !== 'number') return 0;
  const fn = (typeof window !== 'undefined') ? window.forge?.massProps : null;
  if (typeof fn !== 'function') return 0;
  try {
    const r = fn(body.handle);
    const vol = Number(r?.volume);
    if (!Number.isFinite(vol) || vol <= 0) return 0;
    // 1 cc = 1000 mm³; mass(g) = volume(mm³) × density(g/cc) / 1000.
    return vol * bodyDensity(body) / 1000;
  } catch { return 0; }
}

// Aggregate mass of a sub-assembly = sum of every descendant body's
// mass, recursively walking child sub-assemblies.
function subAssemblyMassGrams(nodeId, store, bodies) {
  const childNodes = store.nodes.filter((n) => n.parentId === nodeId);
  const childBodies = bodies.filter((b) => {
    const k = bodyKey(b);
    return k && store.bodyParents[k] === nodeId;
  });
  let total = 0;
  for (const b of childBodies) total += bodyMassGrams(b);
  for (const n of childNodes) total += subAssemblyMassGrams(n.id, store, bodies);
  return total;
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail, 360 px wide so the tree has room for
// nested indents + the trailing mass column.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 360,
  zIndex: 1330,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflowY: 'auto',
};
const HEADER_ROW = {
  display: 'flex', alignItems: 'center', gap: 8,
};
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const PLUS_BTN = {
  background: 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '4px 10px', borderRadius: 3,
  fontSize: 11, fontWeight: 600,
};
const SECTION_TITLE = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  margin: '8px 0 4px',
};
const NODE_ROW = (depth, dragOver) => ({
  display: 'grid',
  gridTemplateColumns: `${14 + depth * 14}px 14px 1fr 90px 20px`,
  alignItems: 'center',
  gap: 4,
  padding: '3px 6px 3px 4px',
  borderRadius: 3,
  background: dragOver
    ? 'var(--forge-accent-mute, #2a3744)'
    : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  marginBottom: 2,
  cursor: 'grab',
});
const BODY_ROW = (depth) => ({
  display: 'grid',
  gridTemplateColumns: `${14 + depth * 14}px 1fr 90px 20px`,
  alignItems: 'center',
  gap: 4,
  padding: '2px 6px',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
  cursor: 'grab',
});
const ORPHAN_ROW = (dragOver) => ({
  marginTop: 6,
  padding: '6px 6px 4px',
  border: '1px dashed var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3,
  background: dragOver
    ? 'var(--forge-accent-mute, #2a3744)'
    : 'transparent',
});
const ICON_BTN = {
  background: 'transparent',
  border: 'none',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  cursor: 'pointer',
  padding: 0,
  width: 14, height: 14,
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10,
};

// ─────────────────────────────────────────────────────────────────────
// Drag payload mime types. We use two distinct types so the drop
// handler can disambiguate body-into-node vs node-into-node moves.

const MIME_BODY = 'application/x-forge-body-id';
const MIME_NODE = 'application/x-forge-sub-assembly-node-id';

// ─────────────────────────────────────────────────────────────────────

export function SubAssemblyTreePanel({ open, onClose }) {
  const [store, setStore]   = useState(() => loadSubAssemblyStore());
  const [bodies, setBodies] = useState(() => readNativeBodies());
  const [collapsed, setCollapsed] = useState(() => new Set());
  const [renaming, setRenaming]   = useState(null);
  const [dragOverNode, setDragOverNode] = useState(null);
  const [dragOverRoot, setDragOverRoot] = useState(false);
  const nextIdRef = useRef(1);

  // Bump the next-id counter past any persisted node ids so newly
  // created nodes never collide with reloaded ones.
  useEffect(() => {
    let max = 0;
    for (const n of store.nodes) {
      const m = /^node-(\d+)$/.exec(n.id);
      if (m) { const v = parseInt(m[1], 10); if (v > max) max = v; }
    }
    nextIdRef.current = max + 1;
  }, [store.nodes]);

  // Persist + publish on every mutation.
  const commit = useCallback((next) => {
    const normalised = normaliseStore(next);
    setStore(normalised);
    publishStore(normalised);
  }, []);

  // Refresh on open + listen for body churn.
  useEffect(() => {
    if (!open) return undefined;
    const fresh = loadSubAssemblyStore();
    setStore(fresh);
    setBodies(readNativeBodies());
    publishStore(fresh);
    const onBodies = () => {
      setBodies(readNativeBodies());
      // Re-publish so any stale bodyParents entries (deleted bodies)
      // get re-normalised on disk.
      publishStore(loadSubAssemblyStore());
    };
    window.addEventListener('forge:bodies-changed', onBodies);
    return () => window.removeEventListener('forge:bodies-changed', onBodies);
  }, [open]);

  // Derived: tree of nodes (root + children).
  const rootNodes = useMemo(
    () => store.nodes.filter((n) => n.parentId == null),
    [store.nodes]);

  const childNodesOf = useCallback(
    (parentId) => store.nodes.filter((n) => n.parentId === parentId),
    [store.nodes]);

  const bodiesOfNode = useCallback(
    (nodeId) => bodies.filter((b) => {
      const k = bodyKey(b);
      return k && store.bodyParents[k] === nodeId;
    }),
    [bodies, store.bodyParents]);

  // Orphans = bodies that aren't claimed by any sub-assembly. They live
  // in a dedicated "Unassigned" tray below the tree.
  const orphanBodies = useMemo(() => bodies.filter((b) => {
    const k = bodyKey(b);
    return !(k && store.bodyParents[k]);
  }), [bodies, store.bodyParents]);

  // ─── Mutations.

  const createSubAssembly = useCallback((parentId = null) => {
    const id = `node-${nextIdRef.current++}`;
    let typed = null;
    try {
      if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
        typed = window.prompt('New sub-assembly name', `SubAsm ${nextIdRef.current - 1}`);
      }
    } catch { typed = null; }
    const name = (typed && typed.trim().length)
      ? typed.trim() : `SubAsm ${nextIdRef.current - 1}`;
    commit({
      ...store,
      nodes: [...store.nodes, { id, name, parentId }],
    });
  }, [store, commit]);

  const renameNode = useCallback((id, name) => {
    const clean = typeof name === 'string' && name.trim().length
      ? name.trim() : null;
    if (!clean) return;
    commit({
      ...store,
      nodes: store.nodes.map((n) =>
        n.id === id ? { ...n, name: clean } : n),
    });
  }, [store, commit]);

  const deleteNode = useCallback((id) => {
    // Re-parent immediate children to this node's parent so we don't
    // accidentally orphan an entire sub-tree.
    const target = store.nodes.find((n) => n.id === id);
    if (!target) return;
    const grandParent = target.parentId;
    // Clear bodyParents entries pointing at this node — those bodies
    // fall back into the orphan tray.
    const nextMap = { ...store.bodyParents };
    for (const [k, v] of Object.entries(nextMap)) {
      if (v === id) delete nextMap[k];
    }
    commit({
      ...store,
      nodes: store.nodes
        .filter((n) => n.id !== id)
        .map((n) => n.parentId === id ? { ...n, parentId: grandParent } : n),
      bodyParents: nextMap,
    });
  }, [store, commit]);

  const reparentNode = useCallback((childId, newParentId) => {
    if (childId === newParentId) return;
    // Cycle guard: if newParentId is a descendant of childId, refuse.
    let cursor = newParentId;
    while (cursor) {
      if (cursor === childId) return;
      const p = store.nodes.find((n) => n.id === cursor);
      cursor = p ? p.parentId : null;
    }
    commit({
      ...store,
      nodes: store.nodes.map((n) =>
        n.id === childId ? { ...n, parentId: newParentId } : n),
    });
  }, [store, commit]);

  const moveBodyToNode = useCallback((bodyK, newParentId) => {
    if (!bodyK) return;
    const nextMap = { ...store.bodyParents };
    if (newParentId == null) delete nextMap[bodyK];
    else nextMap[bodyK] = newParentId;
    commit({ ...store, bodyParents: nextMap });
  }, [store, commit]);

  // ─── Drag handlers (body + node both draggable; both droppable into
  // a node row or the orphan tray).

  const handleBodyDragStart = (e, body) => {
    const k = bodyKey(body);
    if (!k) return;
    try {
      e.dataTransfer.setData(MIME_BODY, k);
      e.dataTransfer.effectAllowed = 'move';
    } catch {}
  };
  const handleNodeDragStart = (e, node) => {
    try {
      e.dataTransfer.setData(MIME_NODE, node.id);
      e.dataTransfer.effectAllowed = 'move';
    } catch {}
  };
  const handleDragOver = (e, nodeId) => {
    e.preventDefault();
    e.stopPropagation();
    try { e.dataTransfer.dropEffect = 'move'; } catch {}
    if (nodeId === null) {
      setDragOverRoot(true);
      setDragOverNode(null);
    } else {
      setDragOverNode(nodeId);
      setDragOverRoot(false);
    }
  };
  const handleDragLeave = () => {
    setDragOverNode(null);
    setDragOverRoot(false);
  };
  const handleDrop = (e, targetNodeId) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverNode(null);
    setDragOverRoot(false);
    try {
      const bodyK = e.dataTransfer.getData(MIME_BODY);
      if (bodyK) { moveBodyToNode(bodyK, targetNodeId); return; }
      const nodeId = e.dataTransfer.getData(MIME_NODE);
      if (nodeId) { reparentNode(nodeId, targetNodeId); }
    } catch {}
  };

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const renderNode = (node, depth) => {
    const children = childNodesOf(node.id);
    const memberBodies = bodiesOfNode(node.id);
    const hasContent = children.length > 0 || memberBodies.length > 0;
    const isCollapsed = collapsed.has(node.id);
    const mass = subAssemblyMassGrams(node.id, store, bodies);
    const isDragOver = dragOverNode === node.id;
    return (
      <li key={node.id}
          data-testid="forge-subasm-node"
          data-node-id={node.id}
          data-parent={node.parentId || 'root'}
          data-name={node.name}
          data-children-count={children.length + memberBodies.length}
          data-mass-grams={mass.toFixed(3)}
          style={{ listStyle: 'none' }}>
        <div
          data-testid={`forge-subasm-row-${node.id}`}
          draggable
          onDragStart={(e) => handleNodeDragStart(e, node)}
          onDragOver={(e) => handleDragOver(e, node.id)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, node.id)}
          style={NODE_ROW(depth, isDragOver)}>
          <button type="button"
                  onClick={() => {
                    const next = new Set(collapsed);
                    if (next.has(node.id)) next.delete(node.id);
                    else next.add(node.id);
                    setCollapsed(next);
                  }}
                  data-testid={`forge-subasm-toggle-${node.id}`}
                  aria-label={isCollapsed ? 'Expand' : 'Collapse'}
                  style={{
                    ...ICON_BTN,
                    justifySelf: 'end',
                    visibility: hasContent ? 'visible' : 'hidden',
                  }}>
            {isCollapsed ? '▶' : '▼'}
          </button>
          <Icon name="wb.mech" size={11} />
          {renaming === node.id ? (
            <input type="text"
                   autoFocus
                   defaultValue={node.name}
                   onBlur={(e) => {
                     renameNode(node.id, e.target.value);
                     setRenaming(null);
                   }}
                   onKeyDown={(e) => {
                     if (e.key === 'Enter') e.target.blur();
                     if (e.key === 'Escape') setRenaming(null);
                   }}
                   data-testid={`forge-subasm-rename-${node.id}`}
                   style={{
                     background: 'var(--forge-canvas, #0d1117)',
                     border: '1px solid var(--forge-accent, #58a6ff)',
                     borderRadius: 2,
                     color: 'var(--forge-ink, #dadde2)',
                     font: 'inherit',
                     fontSize: 11,
                     padding: '1px 4px',
                   }}
                   onClick={(e) => e.stopPropagation()} />
          ) : (
            <button type="button"
                    data-testid={`forge-subasm-name-${node.id}`}
                    onDoubleClick={() => setRenaming(node.id)}
                    onClick={() => setRenaming(node.id)}
                    title="Click to rename"
                    style={{
                      background: 'transparent', border: 'none',
                      color: 'var(--forge-ink, #dadde2)',
                      textAlign: 'left',
                      cursor: 'text',
                      font: 'inherit',
                      fontSize: 11,
                      padding: 0,
                      fontWeight: 600,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}>
              {node.name}
            </button>
          )}
          <span data-testid={`forge-subasm-mass-${node.id}`}
                style={{
                  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                  fontSize: 10,
                  color: 'var(--forge-ink-mute, #9aa1ab)',
                  textAlign: 'right',
                }}>
            {mass > 0 ? `${mass.toFixed(2)} g` : '—'}
          </span>
          <button type="button"
                  onClick={() => deleteNode(node.id)}
                  data-testid={`forge-subasm-delete-${node.id}`}
                  title="Delete sub-assembly (children fall back to parent)"
                  style={{
                    ...ICON_BTN,
                    color: 'var(--forge-err, #ff6b6b)',
                    fontSize: 12,
                  }}>×</button>
        </div>
        {!isCollapsed && hasContent && (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {children.map((c) => renderNode(c, depth + 1))}
            {memberBodies.map((b) => {
              const m = bodyMassGrams(b);
              const k = bodyKey(b);
              return (
                <li key={`body-${k}`}
                    data-testid="forge-subasm-body"
                    data-body-id={b.id}
                    data-body-handle={b.handle}
                    data-parent={node.id}
                    style={{ listStyle: 'none' }}>
                  <div draggable
                       onDragStart={(e) => handleBodyDragStart(e, b)}
                       style={BODY_ROW(depth + 1)}
                       data-testid={`forge-subasm-body-row-${b.handle}`}>
                    <span />
                    <span style={{
                      color: 'var(--forge-ink, #dadde2)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                          title={`Body ${b.handle} → ${node.name}`}>
                      <Icon name="select.body" size={10} />
                      {' '}{b.name || b.toolId || `handle ${b.handle}`}
                    </span>
                    <span style={{
                      fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                      fontSize: 10,
                      color: 'var(--forge-ink-mute, #9aa1ab)',
                      textAlign: 'right',
                    }}>
                      {m > 0 ? `${m.toFixed(2)} g` : '—'}
                    </span>
                    <button type="button"
                            onClick={() => moveBodyToNode(k, null)}
                            data-testid={`forge-subasm-body-eject-${b.handle}`}
                            title="Move back to Unassigned"
                            style={{ ...ICON_BTN, fontSize: 11 }}>↑</button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </li>
    );
  };

  const totalMass = rootNodes.reduce(
    (acc, n) => acc + subAssemblyMassGrams(n.id, store, bodies), 0);

  return createPortal(
    <div role="dialog"
         aria-label="Sub-assembly hierarchy"
         data-testid="forge-subassemblies-panel"
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="wb.mech" size={14} />
        <strong style={{ fontSize: 13 }}>Sub-assemblies</strong>
        <span data-testid="forge-subasm-count"
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                padding: '1px 6px', borderRadius: 'var(--forge-radius-pill, 10px)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
          {store.nodes.length}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => createSubAssembly(null)}
                title="Create a new top-level sub-assembly"
                data-testid="forge-subasm-new-root"
                style={PLUS_BTN}>
          + Root
        </button>
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close sub-assembly tree"
                data-testid="forge-subasm-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={SECTION_TITLE}>
        Tree ({store.nodes.length} sub-assemblies · {bodies.length} bodies
        {totalMass > 0 && ` · ${totalMass.toFixed(2)} g total`})
      </div>

      {/* Root drop zone — drag a sub-assembly here to detach it back to
          the top level. Drag a body here to remove it from its current
          parent (orphans go to the Unassigned tray below). */}
      <div onDragOver={(e) => handleDragOver(e, null)}
           onDragLeave={handleDragLeave}
           onDrop={(e) => handleDrop(e, null)}
           data-testid="forge-subasm-root-dropzone"
           data-drag-over={dragOverRoot ? 'true' : 'false'}
           style={{
             padding: '4px 6px',
             border: '1px dashed var(--forge-rail-edge, #2a2d34)',
             borderRadius: 3,
             marginBottom: 4,
             color: 'var(--forge-ink-mute, #9aa1ab)',
             fontSize: 10,
             textAlign: 'center',
             background: dragOverRoot
               ? 'var(--forge-accent-mute, #2a3744)'
               : 'transparent',
           }}>
        ↑ drop here to detach to top-level
      </div>

      {store.nodes.length === 0 ? (
        <div data-testid="forge-subasm-empty"
             style={{
               padding: '12px 0',
               fontStyle: 'italic',
               color: 'var(--forge-ink-mute, #9aa1ab)',
               fontSize: 11,
             }}>
          Tree is empty. Click <strong>+ Root</strong> to create your first
          sub-assembly, then drag bodies into it from the Unassigned tray.
        </div>
      ) : (
        <ul data-testid="forge-subasm-tree"
            style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {rootNodes.map((n) => renderNode(n, 0))}
        </ul>
      )}

      <div style={SECTION_TITLE}>
        Unassigned bodies ({orphanBodies.length})
      </div>
      <div data-testid="forge-subasm-orphans"
           onDragOver={(e) => handleDragOver(e, null)}
           onDragLeave={handleDragLeave}
           onDrop={(e) => handleDrop(e, null)}
           style={ORPHAN_ROW(dragOverRoot)}>
        {orphanBodies.length === 0 ? (
          <div style={{
            color: 'var(--forge-ink-mute, #9aa1ab)',
            fontStyle: 'italic',
            fontSize: 11,
          }}>
            All bodies are assigned to a sub-assembly.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {orphanBodies.map((b) => {
              const m = bodyMassGrams(b);
              const k = bodyKey(b);
              return (
                <li key={`orphan-${k}`}
                    data-testid="forge-subasm-orphan-body"
                    data-body-id={b.id}
                    data-body-handle={b.handle}
                    style={{ listStyle: 'none' }}>
                  <div draggable
                       onDragStart={(e) => handleBodyDragStart(e, b)}
                       style={{
                         ...BODY_ROW(0),
                         gridTemplateColumns: '14px 1fr 90px 20px',
                       }}
                       data-testid={`forge-subasm-orphan-row-${b.handle}`}>
                    <span />
                    <span style={{
                      color: 'var(--forge-ink, #dadde2)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                          title={`Body ${b.handle} (unassigned)`}>
                      <Icon name="select.body" size={10} />
                      {' '}{b.name || b.toolId || `handle ${b.handle}`}
                    </span>
                    <span style={{
                      fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                      fontSize: 10,
                      color: 'var(--forge-ink-mute, #9aa1ab)',
                      textAlign: 'right',
                    }}>
                      {m > 0 ? `${m.toFixed(2)} g` : '—'}
                    </span>
                    <span />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <footer style={{
        padding: '8px 0 0',
        borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
        color: 'var(--forge-ink-mute, #9aa1ab)',
        fontSize: 10,
        lineHeight: 1.4,
        marginTop: 'auto',
      }}>
        Sub-assemblies persist across sessions
        (<code>forge.v4.subAssemblies</code>). Sub-assembly mass = sum
        of every descendant body's mass.
      </footer>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.subAssemblies` menu action, exposes
// imperative open/close hooks for plugins / Archie tool calls / e2e.

export function SubAssemblyTreePanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSubAssemblyTree  = (v) =>
      setOpen(v === undefined ? true : !!v);
    window.__forgeCloseSubAssemblyTree = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.subAssemblies') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    // Bootstrap: publish the persisted store on the window so non-panel
    // consumers (BOM aggregator, project file load, plugins) can read
    // it without opening the panel first.
    try {
      const store = loadSubAssemblyStore();
      publishStore(store);
    } catch { /* fail-soft on bootstrap */ }
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenSubAssemblyTree; } catch {}
      try { delete window.__forgeCloseSubAssemblyTree; } catch {}
    };
  }, []);
  return <SubAssemblyTreePanel open={open} onClose={() => setOpen(false)} />;
}

export default SubAssemblyTreePanel;
