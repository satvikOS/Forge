// PUSH-71 (Slice-39 / Body Color override panel).
//
// Up through PUSH-70 every body's display colour was a hash of its kernel
// handle — the colorForBody helper in Viewport.jsx folds the numeric
// handle into HSL space (line 702). Per PUSH-59 the helper now consults
// `window.__forgeBodyColors?.get(body.handle)` first, falling back to the
// handle-hash path when the Map has no entry for that handle. That gives
// downstream surfaces (this panel, the project-file vault, plugins) a
// single contract for overriding body colour without forking the
// renderer.
//
// PUSH-71 ships the actual override UI:
//   • A right-docked panel that lists every native body in the scene.
//   • A per-row HTML5 `<input type="color">` for picking a hex colour.
//   • A per-row "Reset" button that drops the override for that body
//     (the renderer falls back to the handle-hash colour again).
//   • A per-row "Match material" button that derives a sensible base
//     colour from the body's currently-assigned material name
//     (steel=#888, aluminum=#aaa, plastic=#3a6, titanium=#666,
//     brass=#c90, with a sensible fallback) and writes that as the
//     override. This bridges PUSH-61's per-body material assignment
//     (window.__forgeBodyMaterials Map) into the visual layer.
//
// Persistence contract:
//   * localStorage key `forge.v4.bodyColors` — JSON {version, colors:
//     {<handle>: '#rrggbb'}}.
//   * `window.__forgeBodyColors` — JavaScript Map<handle, '#rrggbb'>
//     that mirrors the persisted store. The Viewport's colorForBody
//     helper reads from this Map first, so a write is reflected on the
//     next render frame.
//   * `forge:body-colors-changed` CustomEvent fires on every mutation
//     so the Viewport (and any sibling panel) can force a re-render.
//
// Constraints honoured (PUSH-71 brief):
//   * NO new npm packages, NO new C++ libs — pure React + the native
//     `<input type="color">` picker + the existing window.__forge*
//     surface.
//   * No MVP, no stub — the persistence helper round-trips JSON, the
//     window mirror Map is a real Map (not a plain object), and the
//     bus event matches the conventions used by SectionPlanePanel,
//     LayersPanel, MaterialsBrowserPanel.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one
//     import + one mount).
//   * Multi-cam e2e: 5 named camera angles per the Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';

// ─────────────────────────────────────────────────────────────────────
// Constants

export const FORGE_BODY_COLORS_KEY    = 'forge.v4.bodyColors';
export const FORGE_BODY_COLORS_EVENT  = 'forge:body-colors-changed';

// Material → base colour. Matches the brief's spec:
//   steel=#888888, aluminum=#aaaaaa, plastic=#33aa66, titanium=#666666,
//   brass=#cc9900. Unknown / generic materials fall back to a neutral
//   ledger grey that still visually contrasts against the default
//   handle-hash hue so the user can tell a "Match material" press
//   actually did something even on a body with no explicit material.
const MATERIAL_COLORS = Object.freeze({
  steel:     '#888888',
  aluminum:  '#aaaaaa',
  aluminium: '#aaaaaa', // British spelling alias — Material Library uses both
  plastic:   '#33aa66',
  titanium:  '#666666',
  brass:     '#cc9900',
});
const MATERIAL_FALLBACK_COLOR = '#9aa1ab';

export function colorForMaterial(materialName) {
  if (typeof materialName !== 'string' || materialName.length === 0) {
    return MATERIAL_FALLBACK_COLOR;
  }
  const key = materialName.toLowerCase().trim();
  // Exact match first — the user may have a literal "steel" or
  // "aluminum" entry from PUSH-61's bodyMaterials store.
  if (MATERIAL_COLORS[key]) return MATERIAL_COLORS[key];
  // Substring match so a real-world catalogue entry like "AISI 1018
  // steel" or "6061-T6 aluminum" still resolves to the right swatch.
  for (const matKey of Object.keys(MATERIAL_COLORS)) {
    if (key.includes(matKey)) return MATERIAL_COLORS[matKey];
  }
  return MATERIAL_FALLBACK_COLOR;
}

// ─────────────────────────────────────────────────────────────────────
// Persistence — body→colour map lives in localStorage so the user's
// overrides survive reload. Shape on disk:
//   {
//     "version": 1,
//     "colors": { "<handle>": "#rrggbb", … }
//   }
// Handle is the numeric kernel handle; keys are stored as strings on
// disk (JSON object keys) but expanded to numbers in the runtime Map.

function emptyStore() {
  return { version: 1, colors: {} };
}

function normaliseHex(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().toLowerCase();
  // Accept #rgb and #rrggbb. Expand #rgb to #rrggbb.
  if (/^#[0-9a-f]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`;
  }
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  return null;
}

function normaliseStore(raw) {
  if (!raw || typeof raw !== 'object') return emptyStore();
  const rawColors = (raw.colors && typeof raw.colors === 'object') ? raw.colors : {};
  const colors = {};
  for (const [k, v] of Object.entries(rawColors)) {
    const handle = Number(k);
    if (!Number.isFinite(handle)) continue;
    const hex = normaliseHex(v);
    if (!hex) continue;
    colors[String(handle)] = hex;
  }
  return { version: 1, colors };
}

export function loadBodyColorStore() {
  if (typeof window === 'undefined') return emptyStore();
  try {
    const txt = window.localStorage.getItem(FORGE_BODY_COLORS_KEY);
    if (!txt) return emptyStore();
    return normaliseStore(JSON.parse(txt));
  } catch {
    return emptyStore();
  }
}

export function saveBodyColorStore(store) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      FORGE_BODY_COLORS_KEY,
      JSON.stringify(normaliseStore(store)),
    );
  } catch { /* quota-exceeded etc. — non-fatal */ }
}

// Mirror the store into the live `window.__forgeBodyColors` Map so the
// Viewport's `colorForBody(body)` helper picks up the override on the
// next render frame. The Map is the contract surface — every read in
// Viewport.jsx is `window.__forgeBodyColors?.get(body.handle)`.
function syncWindowMap(store) {
  if (typeof window === 'undefined') return;
  if (!(window.__forgeBodyColors instanceof Map)) {
    window.__forgeBodyColors = new Map();
  }
  const map = window.__forgeBodyColors;
  // Delete any stale handles not in the new store.
  const liveKeys = new Set(Object.keys(store.colors).map((k) => Number(k)));
  for (const k of Array.from(map.keys())) {
    if (!liveKeys.has(k)) map.delete(k);
  }
  // Write every live entry — Map.set is idempotent so unchanged rows
  // are no-ops for the renderer.
  for (const [k, v] of Object.entries(store.colors)) {
    map.set(Number(k), v);
  }
}

// Emit the shared body-colors-changed bus event so the Viewport (which
// already subscribes for re-render) and any sibling panel can react
// without polling localStorage.
function publishColors(store) {
  if (typeof window === 'undefined') return;
  saveBodyColorStore(store);
  syncWindowMap(store);
  try {
    window.dispatchEvent(
      new CustomEvent(FORGE_BODY_COLORS_EVENT, { detail: store }),
    );
  } catch { /* CustomEvent is universal in Electron — fail-soft anyway */ }
}

// ─────────────────────────────────────────────────────────────────────
// Public mutator API — used by the panel + exposed on the window debug
// surface so e2e specs / Archie tool calls / plugins can drive overrides
// without mounting the React panel first.

export function setBodyColor(handle, hex) {
  if (typeof handle !== 'number' || !Number.isFinite(handle)) return false;
  const normalised = normaliseHex(hex);
  if (!normalised) return false;
  const store = loadBodyColorStore();
  const key = String(handle);
  if (store.colors[key] === normalised) {
    // Idempotent: still re-emit so out-of-sync subscribers can re-render.
    publishColors(store);
    return true;
  }
  const next = {
    ...store,
    colors: { ...store.colors, [key]: normalised },
  };
  publishColors(next);
  return true;
}

export function clearBodyColor(handle) {
  if (typeof handle !== 'number' || !Number.isFinite(handle)) return false;
  const store = loadBodyColorStore();
  const key = String(handle);
  if (!(key in store.colors)) return false;
  const nextColors = { ...store.colors };
  delete nextColors[key];
  publishColors({ ...store, colors: nextColors });
  return true;
}

export function getBodyColor(handle) {
  if (typeof handle !== 'number' || !Number.isFinite(handle)) return null;
  const store = loadBodyColorStore();
  return store.colors[String(handle)] || null;
}

export function getAllBodyColors() {
  const store = loadBodyColorStore();
  return { ...store.colors };
}

export function clearAllBodyColors() {
  publishColors(emptyStore());
}

// ─────────────────────────────────────────────────────────────────────
// Material lookup — bridges PUSH-61's bodyMaterials store. The canonical
// surface is `window.__forgeBodyMaterialsHelper.getBodyMaterial(body)`
// (PUSH-61 mounts it at module-load), which normalises the key derivation
// (`h:<handle>` for native bodies, `id:<bodyId>` for synthetics) and
// returns the persisted material name. We prefer the helper when present
// and fall back to probing the legacy Map directly with the same
// namespaced keys PUSH-61 writes.
function readBodyMaterial(body) {
  if (typeof window === 'undefined' || !body) return null;
  const helper = window.__forgeBodyMaterialsHelper;
  if (helper && typeof helper.getBodyMaterial === 'function') {
    try {
      const m = helper.getBodyMaterial(body);
      if (typeof m === 'string' && m.length) return m;
    } catch { /* fall through to direct probe */ }
  }
  const map = window.__forgeBodyMaterials;
  if (!(map instanceof Map)) return null;
  // PUSH-61 stores keys as namespaced strings: `h:<handle>` for native
  // bodies, `id:<bodyId>` as a fallback. Probe both forms in order.
  if (typeof body.handle === 'number') {
    const v = map.get(`h:${body.handle}`);
    if (typeof v === 'string' && v.length) return v;
    // Legacy / e2e-direct writes may have used the raw handle as the
    // Map key — accept that too so tests that bypass the helper still work.
    const vRaw = map.get(body.handle);
    if (typeof vRaw === 'string' && vRaw.length) return vRaw;
    const vStr = map.get(String(body.handle));
    if (typeof vStr === 'string' && vStr.length) return vStr;
  }
  if (typeof body.id === 'string' && body.id.length) {
    const v = map.get(`id:${body.id}`);
    if (typeof v === 'string' && v.length) return v;
    const vRaw = map.get(body.id);
    if (typeof vRaw === 'string' && vRaw.length) return vRaw;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Native body snapshot. Same filter the Layers / Materials Browser /
// MassProps / EntityProps panels use — only kernel-backed bodies have
// meaningful handle/id.

function readNativeBodies() {
  if (typeof window === 'undefined') return [];
  const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return all.filter(
    (b) => b && b.kind === 'native' && typeof b.handle === 'number',
  );
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail, same shelf as LayersPanel /
// SectionPlanePanel / MassProps / Interference. 360 px wide so the
// colour swatch + "Match material" button fit alongside the body name
// without truncating.

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
const SECTION_TITLE = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  margin: '8px 0 4px',
};
const RESET_BTN = (enabled) => ({
  background: enabled ? 'var(--forge-surface, #1f242c)' : 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: enabled ? 'var(--forge-ink, #dadde2)' : 'var(--forge-ink-mute, #9aa1ab)',
  cursor: enabled ? 'pointer' : 'not-allowed',
  padding: '3px 8px', borderRadius: 3,
  fontSize: 10,
  opacity: enabled ? 1 : 0.5,
});
const MATCH_BTN = {
  background: 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  cursor: 'pointer',
  padding: '3px 8px', borderRadius: 3,
  fontSize: 10,
};
const CLEAR_ALL_BTN = {
  background: 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  cursor: 'pointer',
  padding: '4px 10px', borderRadius: 3,
  fontSize: 11, fontWeight: 600,
};
const BODY_ROW = {
  display: 'grid',
  gridTemplateColumns: '28px 1fr 60px 60px',
  alignItems: 'center',
  gap: 6,
  padding: '5px 6px',
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
};
const COLOR_INPUT = {
  width: 26, height: 22, padding: 0,
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3,
  background: 'transparent',
  cursor: 'pointer',
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function BodyColorsPanel({ open, onClose }) {
  const [store, setStore] = useState(() => loadBodyColorStore());
  const [bodies, setBodies] = useState(() => readNativeBodies());

  // Refresh on open + listen for live body / colour churn while open.
  useEffect(() => {
    if (!open) return undefined;
    const fresh = loadBodyColorStore();
    setStore(fresh);
    setBodies(readNativeBodies());
    // Sync the window mirror Map on open in case the scene was loaded
    // after the store was last published (e.g. project re-open).
    publishColors(fresh);
    const onBodies = () => setBodies(readNativeBodies());
    const onColors = () => setStore(loadBodyColorStore());
    window.addEventListener('forge:bodies-changed', onBodies);
    window.addEventListener(FORGE_BODY_COLORS_EVENT, onColors);
    return () => {
      window.removeEventListener('forge:bodies-changed', onBodies);
      window.removeEventListener(FORGE_BODY_COLORS_EVENT, onColors);
    };
  }, [open]);

  // ─── Mutations. Each one funnels through publishColors() so the store
  // is persisted, mirrored into the window Map, and bus-published exactly
  // once per user action.

  const writeColor = useCallback((handle, hex) => {
    const ok = setBodyColor(handle, hex);
    if (ok) setStore(loadBodyColorStore());
  }, []);

  const resetColor = useCallback((handle) => {
    const ok = clearBodyColor(handle);
    if (ok) setStore(loadBodyColorStore());
  }, []);

  const matchMaterial = useCallback((body) => {
    if (!body || typeof body.handle !== 'number') return;
    const material = readBodyMaterial(body);
    const colour = colorForMaterial(material || '');
    const ok = setBodyColor(body.handle, colour);
    if (ok) setStore(loadBodyColorStore());
  }, []);

  const clearAll = useCallback(() => {
    clearAllBodyColors();
    setStore(loadBodyColorStore());
  }, []);

  const overrideCount = useMemo(
    () => Object.keys(store.colors).length,
    [store],
  );

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Body colours"
         data-testid="forge-body-colors-panel"
         data-override-count={overrideCount}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="view.shaded" size={14} />
        <strong style={{ fontSize: 13 }}>Body Colours</strong>
        <span data-testid="forge-body-colors-count"
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                padding: '1px 6px', borderRadius: 'var(--forge-radius-pill, 10px)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
          {overrideCount}/{bodies.length}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={clearAll}
                title="Reset every body to the default handle-hash colour"
                data-testid="forge-body-colors-clear-all"
                style={CLEAR_ALL_BTN}>
          Reset all
        </button>
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close body colours panel"
                data-testid="forge-body-colors-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={SECTION_TITLE}>
        Bodies ({bodies.length})
      </div>
      {bodies.length === 0 ? (
        <div data-testid="forge-body-colors-empty"
             style={{
               padding: '12px 0',
               fontStyle: 'italic',
               color: 'var(--forge-ink-mute, #9aa1ab)',
               fontSize: 11,
             }}>
          No native bodies in the scene. Add a body via any modelling
          workbench, then override its colour here.
        </div>
      ) : (
        <ul data-testid="forge-body-colors-list"
            style={{ listStyle: 'none', margin: 0, padding: 0,
                     display: 'flex', flexDirection: 'column' }}>
          {bodies.map((b) => {
            const key = String(b.handle);
            const override = store.colors[key] || null;
            const material = readBodyMaterial(b);
            // The colour picker needs a valid #rrggbb value even when no
            // override is in effect — fall back to the material-derived
            // colour, or to the neutral fallback, so the swatch still
            // shows something sensible.
            const inputValue = override
              || colorForMaterial(material || '')
              || MATERIAL_FALLBACK_COLOR;
            return (
              <li key={b.handle}
                  data-testid="forge-body-colors-row"
                  data-handle={b.handle}
                  data-body-id={b.id}
                  data-material={material || ''}
                  data-override={override || ''}
                  style={BODY_ROW}>
                <input type="color"
                       value={inputValue}
                       data-testid={`forge-body-colors-input-${b.handle}`}
                       data-handle={b.handle}
                       aria-label={`Pick colour for body ${b.handle}`}
                       onChange={(e) => writeColor(b.handle, e.target.value)}
                       style={COLOR_INPUT} />
                <span data-testid={`forge-body-colors-name-${b.handle}`}
                      title={`Body ${b.handle}${material ? ` (${material})` : ''}`}
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                        fontSize: 11,
                      }}>
                  {b.name || b.toolId || `handle ${b.handle}`}
                </span>
                <button type="button"
                        title="Reset this body's colour to the default handle-hash hue"
                        data-testid={`forge-body-colors-reset-${b.handle}`}
                        onClick={() => resetColor(b.handle)}
                        disabled={!override}
                        style={RESET_BTN(!!override)}>
                  Reset
                </button>
                <button type="button"
                        title={material
                          ? `Derive colour from material: ${material}`
                          : 'No material assigned — derive from the fallback palette'}
                        data-testid={`forge-body-colors-match-${b.handle}`}
                        onClick={() => matchMaterial(b)}
                        style={MATCH_BTN}>
                  Match
                </button>
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
        Per-body colour overrides persist across sessions
        (<code>forge.v4.bodyColors</code>). Reset returns a body to its
        default handle-hash hue. Match derives from PUSH-61 material.
      </footer>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.bodyColors` menu action, exposes the
// imperative open/close hooks for plugins / Archie tool calls, and
// surfaces the persisted store on the window mirror at bootstrap.

export function BodyColorsPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenBodyColorsPanel  = () => setOpen(true);
    window.__forgeCloseBodyColorsPanel = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.bodyColors') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    // On bootstrap, surface the persisted store on the window mirror
    // Map so the Viewport's colorForBody helper picks up persisted
    // overrides on the very first render — before the panel mounts.
    try {
      const store = loadBodyColorStore();
      publishColors(store);
    } catch { /* fail-soft on bootstrap */ }
    // Expose a small debug surface on window so the e2e specs can
    // inspect persisted state without importing the module.
    window.__forgeBodyColorsHelper = Object.freeze({
      getBodyColor,
      setBodyColor,
      clearBodyColor,
      getAllBodyColors,
      clearAllBodyColors,
      colorForMaterial,
      STORAGE_KEY: FORGE_BODY_COLORS_KEY,
      EVENT_NAME: FORGE_BODY_COLORS_EVENT,
    });
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenBodyColorsPanel; } catch {}
      try { delete window.__forgeCloseBodyColorsPanel; } catch {}
    };
  }, []);
  return <BodyColorsPanel open={open} onClose={() => setOpen(false)} />;
}

export default BodyColorsPanel;
