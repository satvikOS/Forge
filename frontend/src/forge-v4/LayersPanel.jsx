// PUSH-69 (Slice-37 / Layers — Body visibility GROUPS).
//
// Up through PUSH-67 the only visibility surface was the per-body eye in
// the RightPanel BodyList (Slice-5 / PUSH-36). Engineers building an
// assembly with even a dozen bodies hit a wall: there was no way to
// group bodies under a named tag and hide the whole tag in one click,
// the way every other MCAD tool exposes "layers" (AutoCAD), "groups"
// (Rhino), or "display sets" (Creo). PUSH-69 closes that gap with a
// proper Layers Manager panel.
//
// What this panel adds vs. the existing per-body eye:
//   • A named layer ("Default" is created up front; the user can spawn
//     new ones via the "+" button at any time).
//   • A body↔layer membership map, persisted in localStorage under the
//     spec-mandated key `forge.v4.bodyLayers`. Survives reload.
//   • Per-row "Move to layer" dropdown — each native body shows its
//     current layer membership and can be re-assigned in one click.
//   • Per-layer visibility toggle. Flipping a layer OFF marks every
//     member body's `visible` flag to `false` and republishes through
//     the existing `window.__forgeSetBodies` channel (which Viewport.jsx
//     already honours — line 608 in Viewport.jsx renders null when
//     `m.body.visible === false`). DO NOT modify Viewport.jsx.
//   • Per-layer lock toggle. Locked layers store their member handles
//     on `window.__forgeLockedHandles` (a Set), and the panel emits
//     `forge:layers-changed` for any downstream picker to consult.
//     Selection enforcement is centralised in the panel's `useEffect`
//     hook that listens for `forge:selection-changed` and unwinds any
//     pick that landed on a locked handle.
//
// Constraints honoured (PUSH-69 brief):
//   * NO new npm packages, NO new C++ libs — React + the existing
//     window.__forge* surface only.
//   * No MVP, no stub — the persistence helper round-trips JSON, the
//     visibility writeback uses the existing __forgeSetBodies pattern
//     (the same setter the shell installs on every render), and the
//     bus events match the conventions used by SectionPlanePanel,
//     MaterialsBrowserPanel, EntityPropsPanel.
//   * Surgical edits to Menus.jsx + App.jsx (one new entry + one mount).
//   * Multi-cam e2e: 5 named camera angles per the Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';

// ─────────────────────────────────────────────────────────────────────
// Persistence — body→layer map + layer set live in localStorage so the
// user's grouping survives reload (matches PUSH-61's bodyMaterials.js
// pattern). Shape on disk:
//   {
//     "version": 1,
//     "layers": [
//       { "name": "Default", "visible": true, "locked": false },
//       { "name": "L1",      "visible": true, "locked": false }
//     ],
//     "membership": { "<bodyId>": "Default" }
//   }
// Body key is `b.id` (PUSH-32+ guarantees a stable id on every native
// body) with a handle-string fallback when id is missing.

export const FORGE_BODY_LAYERS_KEY   = 'forge.v4.bodyLayers';
export const FORGE_LAYERS_EVENT      = 'forge:layers-changed';
export const DEFAULT_LAYER_NAME      = 'Default';

function bodyKey(b) {
  if (!b || typeof b !== 'object') return null;
  if (typeof b.id === 'string' && b.id.length) return b.id;
  if (typeof b.handle === 'number') return `handle:${b.handle}`;
  return null;
}

function emptyStore() {
  return {
    version: 1,
    layers: [
      { name: DEFAULT_LAYER_NAME, visible: true, locked: false },
    ],
    membership: {},
  };
}

function normaliseStore(raw) {
  if (!raw || typeof raw !== 'object') return emptyStore();
  const layers = Array.isArray(raw.layers) ? raw.layers : [];
  const cleanedLayers = layers
    .filter((l) => l && typeof l.name === 'string' && l.name.length)
    .map((l) => ({
      name: l.name,
      visible: l.visible !== false,
      locked: !!l.locked,
    }));
  if (!cleanedLayers.find((l) => l.name === DEFAULT_LAYER_NAME)) {
    cleanedLayers.unshift({
      name: DEFAULT_LAYER_NAME, visible: true, locked: false,
    });
  }
  const namesSet = new Set(cleanedLayers.map((l) => l.name));
  const rawMembership = (raw.membership && typeof raw.membership === 'object')
    ? raw.membership : {};
  const membership = {};
  for (const [k, v] of Object.entries(rawMembership)) {
    if (typeof v === 'string' && namesSet.has(v)) membership[k] = v;
  }
  return { version: 1, layers: cleanedLayers, membership };
}

export function loadLayerStore() {
  if (typeof window === 'undefined') return emptyStore();
  try {
    const txt = window.localStorage.getItem(FORGE_BODY_LAYERS_KEY);
    if (!txt) return emptyStore();
    return normaliseStore(JSON.parse(txt));
  } catch {
    return emptyStore();
  }
}

export function saveLayerStore(store) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      FORGE_BODY_LAYERS_KEY,
      JSON.stringify(normaliseStore(store)),
    );
  } catch { /* quota-exceeded etc. — non-fatal */ }
}

// Emit the shared layers-changed bus event so any other surface that
// cares about layer state (locked-handles enforcement, projectFile
// serialisation, plugin hooks) can react without polling localStorage.
function publishLayers(store) {
  if (typeof window === 'undefined') return;
  saveLayerStore(store);
  // Publish a Set of locked body handles for cheap lookup. The selection
  // enforcement effect below reads through this set on every selection
  // change so a panel-less consumer (e.g. AisSelection, ForgeShell) can
  // still respect locking by reading window.__forgeLockedHandles.
  const locked = new Set();
  const lockedNames = new Set(store.layers
    .filter((l) => l.locked).map((l) => l.name));
  if (lockedNames.size > 0) {
    const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
    for (const b of bodies) {
      const k = bodyKey(b);
      const layer = (k && store.membership[k]) || DEFAULT_LAYER_NAME;
      if (lockedNames.has(layer) && typeof b.handle === 'number') {
        locked.add(b.handle);
      }
    }
  }
  window.__forgeLockedHandles = locked;
  window.__forgeLayerStore   = store;
  try {
    window.dispatchEvent(new CustomEvent(FORGE_LAYERS_EVENT, { detail: store }));
  } catch { /* CustomEvent is universal in Electron — fail-soft anyway */ }
}

// Apply the store's visibility decisions to the live bodies array and
// publish through the existing __forgeSetBodies channel — the same
// setter ForgeShellV4 installs. This is the contract the Viewport.jsx
// renderer already honours (line 608: `if (m.body.visible === false) return null;`).
function applyVisibilityToBodies(store) {
  if (typeof window === 'undefined') return;
  const setter = window.__forgeSetBodies;
  if (typeof setter !== 'function') return;
  const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  if (bodies.length === 0) return;
  const hiddenLayers = new Set(store.layers
    .filter((l) => l.visible === false).map((l) => l.name));
  let touched = false;
  const next = bodies.map((b) => {
    const k = bodyKey(b);
    const layerName = (k && store.membership[k]) || DEFAULT_LAYER_NAME;
    const layerHidden = hiddenLayers.has(layerName);
    const desiredVisible = !layerHidden;
    const currentVisible = b.visible !== false;
    if (currentVisible === desiredVisible) return b;
    touched = true;
    return { ...b, visible: desiredVisible };
  });
  if (touched) setter(next);
}

// ─────────────────────────────────────────────────────────────────────
// Native body snapshot. Same filter the Materials Browser + MassProps +
// EntityProps use — only kernel-backed bodies have meaningful handle/id.

function readNativeBodies() {
  if (typeof window === 'undefined') return [];
  const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return all.filter(
    (b) => b && b.kind === 'native' && typeof b.handle === 'number',
  );
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail (same shelf as SectionPlanePanel /
// MassProps / Interference). 320 px wide, full panel height.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 340,
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
const LAYER_ROW = (highlighted) => ({
  display: 'grid',
  gridTemplateColumns: '24px 24px 1fr 18px',
  alignItems: 'center',
  gap: 6,
  padding: '4px 6px',
  borderRadius: 3,
  background: highlighted
    ? 'var(--forge-accent-mute, #2a3744)'
    : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
});
const TOGGLE_BTN = (active, color) => ({
  width: 22, height: 22,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: active ? color : 'var(--forge-ink-mute, #9aa1ab)',
  cursor: 'pointer',
  borderRadius: 3,
  padding: 0,
});
const BODY_ROW = {
  display: 'grid',
  gridTemplateColumns: '1fr 130px',
  alignItems: 'center',
  gap: 6,
  padding: '3px 6px',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
};
const SELECT = {
  background: 'var(--forge-canvas-2, #161b22)',
  color: 'var(--forge-ink, #dadde2)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3,
  padding: '2px 6px',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
};

// ─────────────────────────────────────────────────────────────────────

export function LayersPanel({ open, onClose }) {
  // Live store + body snapshot. Both refresh on open so a mid-session
  // import / scene-load shows up the next time the user pops the panel.
  const [store, setStore] = useState(() => loadLayerStore());
  const [bodies, setBodies] = useState(() => readNativeBodies());
  const [selectedLayer, setSelectedLayer] = useState(DEFAULT_LAYER_NAME);

  // Republish to disk + bus on every store mutation. Also re-applies the
  // visibility writeback so the viewport tracks the toggle without a
  // separate "Apply" button (a layer toggle should feel instant).
  const commit = useCallback((next) => {
    const normalised = normaliseStore(next);
    setStore(normalised);
    publishLayers(normalised);
    applyVisibilityToBodies(normalised);
  }, []);

  // Refresh on open and listen for live body churn.
  useEffect(() => {
    if (!open) return undefined;
    const fresh = loadLayerStore();
    setStore(fresh);
    setBodies(readNativeBodies());
    // Sync visibility on open in case the scene was loaded after the
    // store was last published (e.g. project re-open).
    applyVisibilityToBodies(fresh);
    publishLayers(fresh);
    const onBodies = () => {
      setBodies(readNativeBodies());
      // Re-publish so the locked-handles set picks up new members.
      publishLayers(loadLayerStore());
    };
    window.addEventListener('forge:bodies-changed', onBodies);
    return () => window.removeEventListener('forge:bodies-changed', onBodies);
  }, [open]);

  // Selection enforcement: if a locked-layer member shows up in the
  // active selection, unwind it. This is centralised here so that *any*
  // selection source (RightPanel pick, viewport raycast, plugin
  // dispatch) gets honoured uniformly.
  useEffect(() => {
    if (!open) return undefined;
    const onPick = (e) => {
      const sel = e?.detail || (typeof window !== 'undefined' ? window.__forgeSelection : null);
      if (!sel || sel.kind === 'none') return;
      const locked = window.__forgeLockedHandles;
      if (!(locked instanceof Set) || locked.size === 0) return;
      const targets = [];
      if (typeof sel.bodyHandle === 'number') targets.push(sel.bodyHandle);
      if (Array.isArray(sel.ids)) {
        for (const id of sel.ids) {
          if (typeof id === 'number') targets.push(id);
        }
      }
      const blocked = targets.some((h) => locked.has(h));
      if (!blocked) return;
      // Unwind. Mirrors how the entity-props panel resets after a
      // tools.* action: write the global + fire the bus event the same
      // way the original selection source did.
      const cleared = { kind: 'none', ids: [] };
      window.__forgeSelection = cleared;
      try {
        window.dispatchEvent(new CustomEvent('forge:selection-changed', { detail: cleared }));
      } catch {}
      // Some UI code reads through __forgeSelect (the React setter
      // ForgeShellV4 installs); also call it so the shell's state stays
      // honest with the unwound pick.
      if (typeof window.__forgeSelect === 'function') {
        try { window.__forgeSelect(cleared); } catch {}
      }
    };
    window.addEventListener('forge:selection-changed', onPick);
    return () => window.removeEventListener('forge:selection-changed', onPick);
  }, [open, store]);

  // Derived view: bodies grouped by their assigned layer name.
  const layerNames = useMemo(() => store.layers.map((l) => l.name), [store]);

  const groupedByLayer = useMemo(() => {
    const groups = new Map();
    for (const layer of store.layers) groups.set(layer.name, []);
    for (const b of bodies) {
      const k = bodyKey(b);
      const layerName = (k && store.membership[k]) || DEFAULT_LAYER_NAME;
      if (!groups.has(layerName)) groups.set(layerName, []);
      groups.get(layerName).push(b);
    }
    return groups;
  }, [bodies, store]);

  // ─── Mutations. Each one funnels through `commit()` so the store is
  // re-normalised, persisted, applied to the viewport, and bus-published
  // exactly once per user action.

  const createLayer = useCallback(() => {
    setStore((prev) => {
      // Find a unique fallback name: L1, L2, L3 …
      let i = prev.layers.length;
      let name = `L${i}`;
      const taken = new Set(prev.layers.map((l) => l.name));
      while (taken.has(name)) { i += 1; name = `L${i}`; }
      // The user can type a name; if they cancel/accept-empty, fall back.
      let typed = null;
      try {
        if (typeof window !== 'undefined' && typeof window.prompt === 'function') {
          typed = window.prompt('New layer name', name);
        }
      } catch { typed = null; }
      const finalName = (typed && typed.trim().length) ? typed.trim() : name;
      const dedupedName = taken.has(finalName)
        ? `${finalName} ${prev.layers.length}` : finalName;
      const next = {
        ...prev,
        layers: [...prev.layers,
          { name: dedupedName, visible: true, locked: false }],
      };
      const normalised = normaliseStore(next);
      // Bypass the React batch — commit() in the next microtask so the
      // promotion through publish/apply has the freshest store.
      Promise.resolve().then(() => commit(normalised));
      setSelectedLayer(dedupedName);
      return normalised;
    });
  }, [commit]);

  const setLayerVisible = useCallback((name, visible) => {
    const next = {
      ...store,
      layers: store.layers.map((l) =>
        l.name === name ? { ...l, visible: !!visible } : l),
    };
    commit(next);
  }, [store, commit]);

  const setLayerLocked = useCallback((name, locked) => {
    const next = {
      ...store,
      layers: store.layers.map((l) =>
        l.name === name ? { ...l, locked: !!locked } : l),
    };
    commit(next);
  }, [store, commit]);

  const moveBodyToLayer = useCallback((body, layerName) => {
    const k = bodyKey(body);
    if (!k) return;
    if (!store.layers.find((l) => l.name === layerName)) return;
    const next = {
      ...store,
      membership: { ...store.membership, [k]: layerName },
    };
    commit(next);
  }, [store, commit]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  // Render: a layer list (with V / L toggles + count) on top, then a
  // dedicated "Members of <selectedLayer>" panel below where the user
  // re-assigns bodies.
  const layerBodies = groupedByLayer.get(selectedLayer) || [];

  return createPortal(
    <div role="dialog"
         aria-label="Layers manager"
         data-testid="forge-layers-panel"
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="select.body" size={14} />
        <strong style={{ fontSize: 13 }}>Layers</strong>
        <span data-testid="forge-layers-count"
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                padding: '1px 6px', borderRadius: 'var(--forge-radius-pill, 10px)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
          {store.layers.length}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={createLayer}
                title="Create a new layer"
                data-testid="forge-layers-new"
                style={PLUS_BTN}>
          + Layer
        </button>
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close layers manager"
                data-testid="forge-layers-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={SECTION_TITLE}>Layers ({store.layers.length})</div>
      <ul data-testid="forge-layers-list"
          style={{ listStyle: 'none', margin: 0, padding: 0,
                   display: 'flex', flexDirection: 'column', gap: 4 }}>
        {store.layers.map((l) => {
          const isSelected = l.name === selectedLayer;
          const memberCount = (groupedByLayer.get(l.name) || []).length;
          return (
            <li key={l.name}
                data-testid={`forge-layers-row-${l.name}`}
                data-layer={l.name}
                data-visible={l.visible ? 'true' : 'false'}
                data-locked={l.locked ? 'true' : 'false'}
                style={LAYER_ROW(isSelected)}>
              <button type="button"
                      title={l.visible ? `Hide layer ${l.name}` : `Show layer ${l.name}`}
                      data-testid={`forge-layers-visible-${l.name}`}
                      onClick={() => setLayerVisible(l.name, !l.visible)}
                      style={TOGGLE_BTN(l.visible, 'var(--forge-ink, #dadde2)')}>
                <Icon name={l.visible ? 'misc.eye' : 'misc.eye_off'} size={12} />
              </button>
              <button type="button"
                      title={l.locked ? `Unlock layer ${l.name}` : `Lock layer ${l.name}`}
                      data-testid={`forge-layers-lock-${l.name}`}
                      onClick={() => setLayerLocked(l.name, !l.locked)}
                      style={TOGGLE_BTN(l.locked, 'var(--forge-accent, #58a6ff)')}>
                <Icon name={l.locked ? 'misc.settings' : 'misc.kbd'} size={11} />
              </button>
              <button type="button"
                      data-testid={`forge-layers-pick-${l.name}`}
                      onClick={() => setSelectedLayer(l.name)}
                      style={{
                        background: 'transparent', border: 'none',
                        color: 'var(--forge-ink, #dadde2)',
                        textAlign: 'left',
                        cursor: 'pointer',
                        font: 'inherit',
                        fontSize: 11,
                        padding: 0,
                        opacity: l.visible ? 1 : 0.6,
                        textDecoration: l.visible ? 'none' : 'line-through',
                      }}>
                <strong>{l.name}</strong>
              </button>
              <span style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                textAlign: 'right',
              }}
                    data-testid={`forge-layers-count-${l.name}`}>
                {memberCount}
              </span>
            </li>
          );
        })}
      </ul>

      <div style={SECTION_TITLE}>
        Members of <strong>{selectedLayer}</strong> ({layerBodies.length})
      </div>
      {bodies.length === 0 ? (
        <div data-testid="forge-layers-empty"
             style={{
               padding: '12px 0',
               fontStyle: 'italic',
               color: 'var(--forge-ink-mute, #9aa1ab)',
               fontSize: 11,
             }}>
          No native bodies in the scene. Add a body via any modelling
          workbench, then assign it to a layer here.
        </div>
      ) : (
        <ul data-testid="forge-layers-bodies"
            style={{ listStyle: 'none', margin: 0, padding: 0,
                     display: 'flex', flexDirection: 'column' }}>
          {bodies.map((b) => {
            const k = bodyKey(b);
            const layerName = (k && store.membership[k]) || DEFAULT_LAYER_NAME;
            const layer = store.layers.find((l) => l.name === layerName);
            const visible = b.visible !== false;
            return (
              <li key={k || b.handle}
                  data-testid="forge-layers-body-row"
                  data-handle={b.handle}
                  data-body-id={b.id}
                  data-layer={layerName}
                  data-visible={visible ? 'true' : 'false'}
                  data-locked={layer?.locked ? 'true' : 'false'}
                  style={BODY_ROW}>
                <span data-testid={`forge-layers-body-name-${b.handle}`}
                      title={`Body ${b.handle} (${layerName})`}
                      style={{
                        color: visible ? 'var(--forge-ink, #dadde2)'
                                       : 'var(--forge-ink-mute, #9aa1ab)',
                        textDecoration: visible ? 'none' : 'line-through',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}>
                  {b.name || b.toolId || `handle ${b.handle}`}
                </span>
                <select value={layerName}
                        data-testid={`forge-layers-body-select-${b.handle}`}
                        data-handle={b.handle}
                        onChange={(e) => moveBodyToLayer(b, e.target.value)}
                        style={SELECT}>
                  {layerNames.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </li>
            );
          })}
        </ul>
      )}

      <footer style={{
        padding: '8px 0 0',
        borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
        color: 'var(--forge-ink-mute, #9aa1ab)',
        fontSize: 10,
        lineHeight: 1.4,
        marginTop: 'auto',
      }}>
        Layer membership persists across sessions
        (<code>forge.v4.bodyLayers</code>). Locked layers prevent selection
        of their member bodies.
      </footer>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.layers` menu action, exposes the
// imperative open/close hooks for plugins / Archie tool calls.

export function LayersPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenLayersPanel  = () => setOpen(true);
    window.__forgeCloseLayersPanel = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.layers') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    // On bootstrap, surface the persisted store on the global window
    // hooks so any non-panel consumer (project file load, plugins) can
    // read locked handles without opening the panel first.
    try {
      const store = loadLayerStore();
      publishLayers(store);
      applyVisibilityToBodies(store);
    } catch { /* fail-soft on bootstrap */ }
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenLayersPanel; } catch {}
      try { delete window.__forgeCloseLayersPanel; } catch {}
    };
  }, []);
  return <LayersPanel open={open} onClose={() => setOpen(false)} />;
}

export default LayersPanel;
