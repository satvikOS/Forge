// Forge-150 — Arch/BIM Site → Building → Storey → Element project tree.
//
// Mirrors the FreeCAD Arch Project tree:
//
//   Default Site
//     └── Building 1
//          └── Storey 1
//                ├── Wall  · IFCWALL
//                ├── Door  · IFCDOOR
//                ├── Slab  · IFCSLAB
//                └── …
//
// Reads bodies off window.__forgeBodies. The tree groups bodies by
// their declared ifcSite / ifcBuilding / ifcStorey (default
// "Default Site" / "Building 1" / "Storey 1" when not set). Clicking
// an element selects it through the shell's selection setter; the
// per-element storey can be edited inline (the change is persisted
// via the ArchWorkbench localStorage save).
//
// Hard rules:
//   - Manual interaction NEVER writes to Archie's thread (clicks update
//     selection only; storey edits update the body record + localStorage).
//   - React #185 avoidance: we subscribe via useSyncExternalStore with
//     a version-counter snapshot so the snapshot identity stays stable
//     between body events.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
  useSyncExternalStore,
} from 'react';
import { Icon } from './icons/Icon.jsx';
import { ARCH_TOOLS_BY_ID } from './archComponents.js';

/* =====================================================================
 * Body-registry subscription (version-counter cached snapshot).
 *
 * React 18 useSyncExternalStore requires the snapshot to be
 * referentially stable when nothing changed. We achieve that by
 * keeping a tuple { bodies, version } cached at module scope and
 * bumping the version only when one of our subscribed events fires.
 * ===================================================================== */

let _snapshot = { bodies: [], version: 0 };
let _initialised = false;

function _readBodies() {
  if (typeof window === 'undefined') return [];
  return Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
}

function _refreshSnapshot() {
  const b = _readBodies();
  _snapshot = { bodies: b, version: _snapshot.version + 1 };
}

function _subscribe(onChange) {
  if (typeof window === 'undefined') return () => {};
  if (!_initialised) {
    _initialised = true;
    _refreshSnapshot();
  }
  const handler = () => {
    _refreshSnapshot();
    onChange();
  };
  // Each of these refreshes our cached snapshot. We coalesce by always
  // re-reading window.__forgeBodies — the shell republishes it on every
  // setBodies call (Forge-114 pattern).
  window.addEventListener('forge:body-added', handler);
  window.addEventListener('forge:wb-changed', handler);
  window.addEventListener('forge:bodies-replaced', handler);
  // Also poll on shell-snapshot intervals — covers __forgeSetBodies
  // calls that don't dispatch the body-added event.
  const pollId = window.setInterval(() => {
    const cur = _readBodies();
    if (cur !== _snapshot.bodies) {
      _refreshSnapshot();
      onChange();
    }
  }, 500);
  return () => {
    window.removeEventListener('forge:body-added', handler);
    window.removeEventListener('forge:wb-changed', handler);
    window.removeEventListener('forge:bodies-replaced', handler);
    window.clearInterval(pollId);
  };
}

function _getSnapshot() {
  return _snapshot;
}

function _getServerSnapshot() {
  return _snapshot;
}

function useBodies() {
  const snap = useSyncExternalStore(_subscribe, _getSnapshot, _getServerSnapshot);
  return snap.bodies;
}

/* =====================================================================
 * Tree shape.
 * ===================================================================== */

function groupBodies(bodies) {
  const sites = new Map();
  for (const b of bodies) {
    if (!b) continue;
    const siteName = b.ifcSite || 'Default Site';
    const bldgName = b.ifcBuilding || 'Building 1';
    const stoName  = b.ifcStorey || 'Storey 1';
    if (!sites.has(siteName)) sites.set(siteName, new Map());
    const bldgs = sites.get(siteName);
    if (!bldgs.has(bldgName)) bldgs.set(bldgName, new Map());
    const storeys = bldgs.get(bldgName);
    if (!storeys.has(stoName)) storeys.set(stoName, []);
    storeys.get(stoName).push(b);
  }
  return sites;
}

/* =====================================================================
 * Storage updater — when the user re-assigns a body to a different
 * storey via the inline select, we (a) update window.__forgeBodies,
 * (b) re-save the localStorage Arch list.
 * ===================================================================== */

const ARCH_STORAGE_KEY = 'forge.v4.arch.bodies';

function setBodyField(bodyId, key, value) {
  if (typeof window === 'undefined') return;
  const bodies = _readBodies();
  const next = bodies.map((b) => b && b.id === bodyId
    ? { ...b, [key]: value } : b);
  if (typeof window.__forgeSetBodies === 'function') {
    window.__forgeSetBodies(next);
  } else {
    window.__forgeBodies = next;
  }
  // Persist Arch bodies to localStorage.
  try {
    const archOnly = next
      .filter((b) => b && typeof b.toolId === 'string' && b.toolId.startsWith('arch.'))
      .map((b) => ({
        id: b.id, toolId: b.toolId,
        ifcType: b.ifcType, ifcStorey: b.ifcStorey || 'Storey 1',
        params: b.params || {}, kind: 'native',
        name: b.name,
        ifcBuilding: b.ifcBuilding || 'Building 1',
        ifcSite: b.ifcSite || 'Default Site',
      }));
    localStorage.setItem(ARCH_STORAGE_KEY, JSON.stringify(archOnly));
  } catch {}
  try {
    window.dispatchEvent(new CustomEvent('forge:bodies-replaced'));
  } catch {}
}

/* =====================================================================
 * Selection bridge.
 * ===================================================================== */

function selectBody(body) {
  if (typeof window === 'undefined') return;
  // The shell's selection model is { kind:'body', ids:[handle|id] }.
  // We use the body id (not the handle) so the IFC export panel and
  // feature tree can correlate without ambiguity.
  if (typeof window.__forgeSelectFeature === 'function' && body.id) {
    window.__forgeSelectFeature(body.id);
  }
}

/* =====================================================================
 * Styles.
 * ===================================================================== */

const panelStyle = {
  position: 'fixed',
  left: 'calc(var(--forge-rail-w) + 4px)',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h) + 4px)',
  width: 280,
  maxHeight: 'calc(100% - var(--forge-topbar-h) - var(--forge-qat-h) - 16px)',
  background: 'var(--forge-canvas-2)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius-lg)',
  boxShadow: '0 12px 36px rgba(0,0,0,0.55)',
  padding: 'var(--forge-space-3)',
  zIndex: 1270,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)',
  font: 'inherit',
  fontSize: 12,
  overflow: 'hidden',
};

const branchStyle = {
  display: 'flex', flexDirection: 'column', gap: 2,
  paddingLeft: 12,
};

const nodeBtnStyle = {
  display: 'flex', alignItems: 'center', gap: 6,
  padding: '3px 6px',
  background: 'transparent',
  border: '1px solid transparent',
  borderRadius: 'var(--forge-radius)',
  color: 'var(--forge-ink)',
  cursor: 'pointer',
  textAlign: 'left',
  font: 'inherit', fontSize: 12,
};

/* =====================================================================
 * Recursive tree node.
 * ===================================================================== */

function TreeBranch({ label, icon, defaultOpen, dataKind, dataKey, children }) {
  const [openLocal, setOpenLocal] = useState(defaultOpen !== false);
  return (
    <div data-test-node={dataKind} data-test-key={dataKey}>
      <button type="button"
              onClick={() => setOpenLocal((v) => !v)}
              style={{ ...nodeBtnStyle, fontWeight: 600 }}
              data-testid={`forge-arch-tree-${dataKind}-${(dataKey || label).replace(/\s+/g, '_')}`}>
        <span style={{ width: 10, color: 'var(--forge-ink-mute)' }}>
          {openLocal ? '▾' : '▸'}
        </span>
        <Icon name={icon} size={12} />
        <span style={{ flex: 1 }}>{label}</span>
      </button>
      {openLocal && <div style={branchStyle}>{children}</div>}
    </div>
  );
}

/* =====================================================================
 * Storey assignment editor — small inline select rendered in-row.
 * ===================================================================== */

function StoreySelect({ body, storeyOptions }) {
  return (
    <select
      data-testid={`forge-arch-tree-storey-select-${body.id}`}
      value={body.ifcStorey || 'Storey 1'}
      onChange={(e) => setBodyField(body.id, 'ifcStorey', e.target.value)}
      onClick={(e) => e.stopPropagation()}
      style={{
        background: 'var(--forge-canvas)',
        border: '1px solid var(--forge-rail-edge)',
        borderRadius: 'var(--forge-radius)',
        color: 'var(--forge-ink)',
        font: 'inherit', fontSize: 10,
        padding: '1px 3px',
        marginLeft: 'auto',
      }}>
      {storeyOptions.map((s) => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>
  );
}

/* =====================================================================
 * Element row — one Arch body.
 * ===================================================================== */

function ElementRow({ body, storeyOptions }) {
  const tool = ARCH_TOOLS_BY_ID[body.toolId];
  const ifc = body.ifcType || 'IFCBUILDINGELEMENTPROXY';
  return (
    <button type="button"
            onClick={() => selectBody(body)}
            style={nodeBtnStyle}
            data-testid={`forge-arch-tree-elem-${body.id}`}
            data-ifc-type={ifc}
            onMouseEnter={(e) => e.currentTarget.style.background = 'var(--forge-surface)'}
            onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
      <span style={{ width: 10 }} />
      <Icon name={tool?.icon || 'wb.mech'} size={11} />
      <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis',
                     whiteSpace: 'nowrap' }}>
        {body.name || body.id}
      </span>
      <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 9,
                     color: 'var(--forge-ink-mute)' }}>
        {ifc.replace('IFC', '')}
      </span>
      <StoreySelect body={body} storeyOptions={storeyOptions} />
    </button>
  );
}

/* =====================================================================
 * Panel.
 * ===================================================================== */

export function SiteHierarchy({ open, onClose }) {
  const bodies = useBodies();
  // Filter to Arch bodies (anything tagged with an IFC arch class).
  // We keep the full IFC4 class palette so IFCRAILING/IFCRAMP show up
  // even though they don't appear in IFC_ELEMENT_TYPES default list.
  const archBodies = useMemo(() => {
    return bodies.filter((b) => b && (
      typeof b.ifcType === 'string'
      || (typeof b.toolId === 'string' && b.toolId.startsWith('arch.'))
    ));
  }, [bodies]);

  const grouped = useMemo(() => groupBodies(archBodies), [archBodies]);

  // Available storey labels — unique ifcStorey across bodies, with the
  // mandatory defaults always present.
  const storeyOptions = useMemo(() => {
    const s = new Set(['Storey 1', 'Storey 2', 'Storey 3', 'Roof']);
    for (const b of archBodies) if (b.ifcStorey) s.add(b.ifcStorey);
    return Array.from(s);
  }, [archBodies]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <aside role="region"
           aria-label="Site hierarchy"
           data-testid="forge-arch-site-tree"
           style={panelStyle}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 6,
                       paddingBottom: 4,
                       borderBottom: '1px solid var(--forge-rail-edge)',
                       fontWeight: 600 }}>
        <Icon name="wb.mech" size={14} />
        <span style={{ flex: 1 }}>Project</span>
        <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 10,
                       color: 'var(--forge-ink-mute)' }}>
          {archBodies.length} elem
        </span>
        <button type="button" onClick={onClose} aria-label="Close site tree"
                data-testid="forge-arch-site-tree-close"
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink-mute)', cursor: 'pointer',
                         display: 'inline-flex', padding: 2 }}>
          <Icon name="select.clear" size={12} />
        </button>
      </header>

      <div style={{ flex: 1, overflowY: 'auto',
                    display: 'flex', flexDirection: 'column', gap: 2 }}>
        {archBodies.length === 0 ? (
          <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)',
                        padding: '8px 4px' }}>
            No Arch elements yet. Switch to the Arch workbench and place a Wall.
          </div>
        ) : Array.from(grouped.entries()).map(([siteName, buildings]) => (
          <TreeBranch key={siteName}
                      label={siteName}
                      icon="wb.mech"
                      dataKind="site"
                      dataKey={siteName}
                      defaultOpen>
            {Array.from(buildings.entries()).map(([bldgName, storeys]) => (
              <TreeBranch key={bldgName}
                          label={bldgName}
                          icon="wb.mech"
                          dataKind="building"
                          dataKey={bldgName}
                          defaultOpen>
                {Array.from(storeys.entries()).map(([stoName, elements]) => (
                  <TreeBranch key={stoName}
                              label={`${stoName} · ${elements.length}`}
                              icon="wb.drawing"
                              dataKind="storey"
                              dataKey={stoName}
                              defaultOpen>
                    {elements.map((e) => (
                      <ElementRow key={e.id} body={e}
                                  storeyOptions={storeyOptions} />
                    ))}
                  </TreeBranch>
                ))}
              </TreeBranch>
            ))}
          </TreeBranch>
        ))}
      </div>
    </aside>
  );
}

/* =====================================================================
 * Host — mounted by App.jsx as a sibling of ForgeShellV4.
 *
 * Subscribes to:
 *   • window.__forgeOpenSiteHierarchy()      — imperative open hook
 *   • 'forge:open-site-hierarchy'           — custom event
 *   • 'forge:wb-changed'                    — auto-show when wb=arch
 * ===================================================================== */

const SITE_PANEL_EVENT = 'forge:open-site-hierarchy';

export function SiteHierarchyHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeOpenSiteHierarchy  = (v) => setOpen(v !== false);
    window.__forgeCloseSiteHierarchy = () => setOpen(false);

    const onEvt = () => setOpen(true);
    window.addEventListener(SITE_PANEL_EVENT, onEvt);

    const sync = () => {
      const wb = window.__forgeActiveWb;
      if (wb === 'arch') setOpen(true);
    };
    sync();
    window.addEventListener('forge:wb-changed', sync);

    return () => {
      window.removeEventListener(SITE_PANEL_EVENT, onEvt);
      window.removeEventListener('forge:wb-changed', sync);
    };
  }, []);

  return <SiteHierarchy open={open} onClose={() => setOpen(false)} />;
}

export default SiteHierarchy;
