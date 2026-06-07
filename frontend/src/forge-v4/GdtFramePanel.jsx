// PUSH-92 (Slice-60 / GD&T Feature Control Frames panel).
//
// ASME Y14.5 Feature Control Frames are the canonical engineering
// shorthand for geometric dimensioning & tolerancing — what every
// drawing checker looks for when validating a part print. PUSH-78
// shipped quick free-text PMI notes ("⌖ Ø0.1 A B C" typed by hand);
// PUSH-92 ships the structured Frame BUILDER that authors the same
// string from the constituent dropdowns so the resulting frames are
// guaranteed-valid Y14.5 syntax.
//
// Frame anatomy (left → right):
//   [tolerance symbol]
//   | [Ø?] tolerance value [M / L / F modifier?]
//   | primary datum   [M / L / F modifier?]
//   | secondary datum [M / L / F modifier?]
//   | tertiary datum  [M / L / F modifier?]
//
// Persistence contract:
//   * window.__forgeGdtFrames — canonical in-memory array of frame
//     records. Each record: { id, symbol, symbolId, glyph, toleranceValue,
//     diameterPrefix, toleranceModifier, datums: [{ letter, modifier }],
//     formatted, createdAt }.
//   * localStorage key `forge.v4.gdtFrames` — JSON {version, frames:[…]}.
//   * `forge:gdt-frames-changed` CustomEvent fires on every mutation.
//
// Hard constraints honoured (PUSH-92 brief):
//   * NO new npm packages, NO new C++ libs — pure React, browser
//     localStorage, CustomEvent. Same playbook as PUSH-78.
//   * Real implementation: localStorage round-trips JSON; window mirror
//     is a real array; bus event wired the same shape SectionPlane /
//     Layers / BodyColors / CameraBookmarks / ActivityLog / PMI use.
//   * Surgical edits to Menus.jsx (one new tools.gdtFrames entry) and
//     App.jsx (one import + one mount). The PUSH-78 PMI panel stays
//     untouched — different file, different storage key, different bus.
//   * Multi-cam e2e: 5 named camera angles per Forge-171 mandate.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';

// ─────────────────────────────────────────────────────────────────────
// Constants — keep the storage / event / debug surfaces exported so the
// e2e spec, plugins, and Archie tool calls can reach the same names
// without re-deriving them.

export const FORGE_GDT_LS_KEY     = 'forge.v4.gdtFrames';
export const FORGE_GDT_EVENT_NAME = 'forge:gdt-frames-changed';

// The 14 ASME Y14.5 geometric tolerance characteristic symbols. Order
// mirrors the standard's grouping (Form / Profile / Orientation /
// Location / Runout) so the dropdown reads like a Y14.5 cheat-sheet.
export const GDT_SYMBOLS = Object.freeze([
  // Form (no datum required — datums optional in the UI).
  { id: 'straightness',  label: 'Straightness',        glyph: '─',  category: 'Form'        },
  { id: 'flatness',      label: 'Flatness',            glyph: '▱',  category: 'Form'        },
  { id: 'roundness',     label: 'Roundness (Circularity)', glyph: '○',  category: 'Form'    },
  { id: 'cylindricity',  label: 'Cylindricity',        glyph: '⌭',  category: 'Form'        },
  // Profile.
  { id: 'profileLine',   label: 'Profile of a line',   glyph: '⌒',  category: 'Profile'     },
  { id: 'profileSurface',label: 'Profile of a surface',glyph: '⌓',  category: 'Profile'     },
  // Orientation.
  { id: 'angularity',    label: 'Angularity',          glyph: '∠',  category: 'Orientation' },
  { id: 'perpendicularity',label: 'Perpendicularity',  glyph: '⊥',  category: 'Orientation' },
  { id: 'parallelism',   label: 'Parallelism',         glyph: '∥',  category: 'Orientation' },
  // Location.
  { id: 'position',      label: 'Position',            glyph: '⌖',  category: 'Location'    },
  { id: 'concentricity', label: 'Concentricity',       glyph: '◎',  category: 'Location'    },
  { id: 'symmetry',      label: 'Symmetry',            glyph: '⌯',  category: 'Location'    },
  // Runout.
  { id: 'runoutCircular',label: 'Circular runout',     glyph: '↗',  category: 'Runout'      },
  { id: 'runoutTotal',   label: 'Total runout',        glyph: '↗↗', category: 'Runout'      },
]);

const VALID_SYMBOL_IDS = new Set(GDT_SYMBOLS.map((s) => s.id));

// The four tolerance / datum modifiers Y14.5 recognises. None = no
// modifier (the most common case for unmodified RFS conditions).
export const GDT_MODIFIERS = Object.freeze([
  { id: 'none', label: '— none —', glyph: ''  },
  { id: 'M',    label: 'Ⓜ MMC (max material condition)', glyph: 'Ⓜ' },
  { id: 'L',    label: 'Ⓛ LMC (least material condition)', glyph: 'Ⓛ' },
  { id: 'F',    label: 'Ⓕ Free state', glyph: 'Ⓕ' },
]);

const VALID_MOD_IDS = new Set(GDT_MODIFIERS.map((m) => m.id));

// ─────────────────────────────────────────────────────────────────────
// Frame formatter — takes a record-style spec and emits the canonical
// Y14.5 frame string. Empty fields drop out gracefully so the live
// preview reads sanely while the user is still filling the form.

export function formatFrameString(spec) {
  if (!spec || typeof spec !== 'object') return '';
  const sym = GDT_SYMBOLS.find((s) => s.id === spec.symbolId);
  const glyph = sym ? sym.glyph : (spec.glyph || '');
  // Tolerance segment: optional Ø + value + optional modifier.
  let tol = '';
  const v = spec.toleranceValue;
  const hasValue = (typeof v === 'number' && Number.isFinite(v))
                    || (typeof v === 'string' && v.trim().length > 0);
  if (hasValue) {
    const valStr = (typeof v === 'number') ? String(v) : v.trim();
    const diaPrefix = spec.diameterPrefix ? 'Ø' : '';
    const modSpec = GDT_MODIFIERS.find((m) => m.id === spec.toleranceModifier);
    const modGlyph = (modSpec && modSpec.id !== 'none') ? ` ${modSpec.glyph}` : '';
    tol = `${diaPrefix}${valStr}${modGlyph}`;
  }
  const segments = [glyph];
  if (tol.length > 0) segments.push(tol);
  // Datum segments. Skip rows with no letter; render the letter and an
  // optional modifier glyph when present.
  const datums = Array.isArray(spec.datums) ? spec.datums : [];
  for (const d of datums) {
    if (!d || typeof d !== 'object') continue;
    const letter = typeof d.letter === 'string' ? d.letter.trim() : '';
    if (!letter) continue;
    const modSpec = GDT_MODIFIERS.find((m) => m.id === d.modifier);
    const modGlyph = (modSpec && modSpec.id !== 'none') ? ` ${modSpec.glyph}` : '';
    segments.push(`${letter}${modGlyph}`);
  }
  return segments.join('|');
}

// ─────────────────────────────────────────────────────────────────────
// Persistence helpers — load / save round-trip JSON in localStorage and
// keep window.__forgeGdtFrames mirrored in sync. Same playbook the
// PUSH-78 PMI panel uses so the contract feels familiar to subscribers.

function emptyStore() {
  return { version: 1, frames: [] };
}

function nextId() {
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `gdt-${ts}-${rand}`;
}

function normaliseDatumRow(raw) {
  if (!raw || typeof raw !== 'object') {
    return { letter: '', modifier: 'none' };
  }
  const letter = typeof raw.letter === 'string' ? raw.letter.trim().toUpperCase() : '';
  const modifier = (typeof raw.modifier === 'string' && VALID_MOD_IDS.has(raw.modifier))
    ? raw.modifier : 'none';
  return { letter, modifier };
}

function normaliseFrame(raw) {
  if (!raw || typeof raw !== 'object') return null;
  // Symbol identification — accept symbolId; fall back to legacy
  // `symbol` (label) if a callsite hands us the older shape.
  let symbolId = typeof raw.symbolId === 'string' ? raw.symbolId : null;
  if (!symbolId && typeof raw.symbol === 'string') {
    const byLabel = GDT_SYMBOLS.find((s) =>
      s.label.toLowerCase() === raw.symbol.toLowerCase()
      || s.id.toLowerCase() === raw.symbol.toLowerCase());
    if (byLabel) symbolId = byLabel.id;
  }
  if (!symbolId || !VALID_SYMBOL_IDS.has(symbolId)) return null;
  const symSpec = GDT_SYMBOLS.find((s) => s.id === symbolId);
  // Tolerance value: accept a number or a numeric string. Drop the rest.
  let toleranceValue = null;
  if (typeof raw.toleranceValue === 'number' && Number.isFinite(raw.toleranceValue)) {
    toleranceValue = raw.toleranceValue;
  } else if (typeof raw.toleranceValue === 'string' && raw.toleranceValue.trim().length) {
    const num = Number(raw.toleranceValue);
    toleranceValue = Number.isFinite(num) ? num : raw.toleranceValue.trim();
  }
  const diameterPrefix = !!raw.diameterPrefix;
  const toleranceModifier = (typeof raw.toleranceModifier === 'string'
                              && VALID_MOD_IDS.has(raw.toleranceModifier))
    ? raw.toleranceModifier : 'none';
  // Up to 3 datum rows. Pad / trim so the shape is consistent.
  const inDatums = Array.isArray(raw.datums) ? raw.datums : [];
  const datums = [0, 1, 2].map((i) => normaliseDatumRow(inDatums[i]));
  const id = (typeof raw.id === 'string' && raw.id.length) ? raw.id : nextId();
  const createdAt = (typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt))
    ? raw.createdAt : Date.now();
  const norm = {
    id,
    symbolId,
    symbol: symSpec.label,
    glyph: symSpec.glyph,
    category: symSpec.category,
    toleranceValue,
    diameterPrefix,
    toleranceModifier,
    datums,
    createdAt,
  };
  norm.formatted = formatFrameString(norm);
  return norm;
}

function normaliseStore(raw) {
  if (!raw || typeof raw !== 'object') return emptyStore();
  const rawFrames = Array.isArray(raw.frames) ? raw.frames : [];
  const frames = [];
  for (const f of rawFrames) {
    const norm = normaliseFrame(f);
    if (norm) frames.push(norm);
  }
  return { version: 1, frames };
}

export function loadGdtStore() {
  if (typeof window === 'undefined') return emptyStore();
  try {
    const txt = window.localStorage.getItem(FORGE_GDT_LS_KEY);
    if (!txt) return emptyStore();
    return normaliseStore(JSON.parse(txt));
  } catch {
    return emptyStore();
  }
}

export function saveGdtStore(store) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      FORGE_GDT_LS_KEY,
      JSON.stringify(normaliseStore(store)),
    );
  } catch { /* quota-exceeded etc. — non-fatal */ }
}

// Mirror the store into `window.__forgeGdtFrames` so the e2e spec /
// plugins / Archie tool calls can read the frame list without
// importing the module. Mutate the live reference in place so
// subscribers that captured the array don't go stale across mutations.
function syncWindowMirror(store) {
  if (typeof window === 'undefined') return;
  if (!Array.isArray(window.__forgeGdtFrames)) window.__forgeGdtFrames = [];
  const arr = window.__forgeGdtFrames;
  arr.length = 0;
  for (const f of store.frames) arr.push(f);
}

function publish(store) {
  if (typeof window === 'undefined') return;
  saveGdtStore(store);
  syncWindowMirror(store);
  try {
    window.dispatchEvent(new CustomEvent(FORGE_GDT_EVENT_NAME, { detail: store }));
  } catch { /* CustomEvent always exists in Electron */ }
}

// ─────────────────────────────────────────────────────────────────────
// Public mutator API — used by the panel + exposed on the window debug
// surface so e2e specs / plugins / Archie tool calls can drive the
// store without mounting the React panel.

export function addFrame(spec) {
  const norm = normaliseFrame(spec);
  if (!norm) return null;
  const store = loadGdtStore();
  const next = { ...store, frames: [...store.frames, norm] };
  publish(next);
  return norm;
}

export function removeFrame(id) {
  if (typeof id !== 'string' || !id.length) return false;
  const store = loadGdtStore();
  const next = store.frames.filter((f) => f.id !== id);
  if (next.length === store.frames.length) return false;
  publish({ ...store, frames: next });
  return true;
}

export function listFrames() {
  return loadGdtStore().frames.slice();
}

export function clearAllFrames() {
  publish(emptyStore());
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail matching SectionPlane / Layers /
// BodyColors / CameraBookmarks / PMI shelf so the panel fits the
// existing information architecture rather than floating as a one-off.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 400,
  zIndex: 1336, // sit one tick above the PMI panel to make co-mounting safe
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflowY: 'auto',
};
const HEADER_ROW = { display: 'flex', alignItems: 'center', gap: 8 };
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const SECTION_TITLE = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)', margin: '8px 0 4px',
};
const FIELD = {
  width: '100%', boxSizing: 'border-box',
  background: 'var(--forge-canvas, #0d1117)',
  color: 'var(--forge-ink, #dadde2)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3, padding: '5px 7px',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
};
const ROW = { display: 'flex', gap: 6, alignItems: 'center' };
const PREVIEW_BOX = {
  background: 'var(--forge-canvas, #0d1117)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3, padding: '8px 10px',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 14, color: 'var(--forge-ink, #dadde2)',
  letterSpacing: '0.04em', minHeight: 22,
};
const ADD_BTN = (enabled) => ({
  background: enabled ? 'var(--forge-accent, #2c8af2)' : 'var(--forge-surface, #1f242c)',
  color: enabled ? '#fff' : 'var(--forge-ink-mute, #9aa1ab)',
  border: 'none', borderRadius: 3,
  padding: '6px 12px',
  cursor: enabled ? 'pointer' : 'not-allowed',
  fontWeight: 600,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
});
const CLEAR_BTN = {
  background: 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  cursor: 'pointer',
  padding: '4px 10px', borderRadius: 3, fontSize: 11,
};
const FRAME_ROW = {
  display: 'grid',
  gridTemplateColumns: '1fr 50px',
  alignItems: 'start', gap: 6,
  padding: '6px 6px',
  borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
};
const DEL_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3, fontSize: 10,
};

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function GdtFramePanel({ open, onClose }) {
  const [store, setStore] = useState(() => loadGdtStore());
  const [symbolId, setSymbolId] = useState('position');
  const [toleranceValue, setToleranceValue] = useState('0.1');
  const [diameterPrefix, setDiameterPrefix] = useState(true);
  const [toleranceModifier, setToleranceModifier] = useState('M');
  const [datumA, setDatumA] = useState({ letter: 'A', modifier: 'none' });
  const [datumB, setDatumB] = useState({ letter: '',  modifier: 'none' });
  const [datumC, setDatumC] = useState({ letter: '',  modifier: 'none' });

  // Refresh on open + sync the window mirror so the persisted state is
  // visible to plugins / scripts even before the first mutation.
  useEffect(() => {
    if (!open) return undefined;
    const fresh = loadGdtStore();
    setStore(fresh);
    publish(fresh);
    const onChange = () => setStore(loadGdtStore());
    window.addEventListener(FORGE_GDT_EVENT_NAME, onChange);
    return () => {
      window.removeEventListener(FORGE_GDT_EVENT_NAME, onChange);
    };
  }, [open]);

  const symbolSpec = useMemo(
    () => GDT_SYMBOLS.find((s) => s.id === symbolId) || GDT_SYMBOLS[0],
    [symbolId],
  );

  // Live preview spec — drives the formatted string + the per-frame
  // record we hand to addFrame() when the user clicks Add.
  const draftSpec = useMemo(() => ({
    symbolId,
    toleranceValue,
    diameterPrefix,
    toleranceModifier,
    datums: [datumA, datumB, datumC],
  }), [symbolId, toleranceValue, diameterPrefix, toleranceModifier,
       datumA, datumB, datumC]);

  const preview = useMemo(() => formatFrameString(draftSpec), [draftSpec]);

  const canAdd = useMemo(() => {
    // Must have a tolerance value entered. Datums are optional for Form
    // tolerances — Y14.5 doesn't require them.
    const v = String(toleranceValue || '').trim();
    if (v.length === 0) return false;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0;
  }, [toleranceValue]);

  const onAdd = useCallback(() => {
    if (!canAdd) return;
    const rec = addFrame(draftSpec);
    if (rec) setStore(loadGdtStore());
  }, [canAdd, draftSpec]);

  const onDelete = useCallback((id) => {
    const ok = removeFrame(id);
    if (ok) setStore(loadGdtStore());
  }, []);

  const onClear = useCallback(() => {
    clearAllFrames();
    setStore(loadGdtStore());
  }, []);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const frameCount = store.frames.length;

  // Datum row helper — used for A / B / C.
  const datumRow = (label, value, setValue, testidPrefix) => (
    <div style={{ ...ROW, marginTop: 4 }}>
      <span style={{ width: 70, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
        {label}
      </span>
      <input data-testid={`${testidPrefix}-letter`}
             type="text"
             value={value.letter}
             onChange={(e) => setValue({
               ...value,
               letter: e.target.value.toUpperCase().slice(0, 2),
             })}
             placeholder="—"
             maxLength={2}
             style={{ ...FIELD, width: 56, textAlign: 'center' }} />
      <select data-testid={`${testidPrefix}-modifier`}
              value={value.modifier}
              onChange={(e) => setValue({ ...value, modifier: e.target.value })}
              style={{ ...FIELD, flex: 1 }}>
        {GDT_MODIFIERS.map((m) => (
          <option key={m.id} value={m.id}>{m.label}</option>
        ))}
      </select>
    </div>
  );

  return createPortal(
    <div role="dialog"
         aria-label="GD&T Feature Control Frames"
         data-testid="forge-gdt-frames-panel"
         data-frame-count={frameCount}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="measure.distance" size={14} />
        <strong style={{ fontSize: 13 }}>GD&amp;T Feature Control Frames</strong>
        <span data-testid="forge-gdt-frames-count"
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                padding: '1px 6px', borderRadius: 'var(--forge-radius-pill, 10px)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
          {frameCount}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onClear}
                title="Remove every GD&T frame (cannot be undone)"
                data-testid="forge-gdt-frames-clear"
                style={CLEAR_BTN}>
          Clear all
        </button>
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close GD&T Frames panel"
                data-testid="forge-gdt-frames-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={SECTION_TITLE}>Geometric tolerance symbol</div>
      <select data-testid="forge-gdt-frames-symbol"
              value={symbolId}
              onChange={(e) => setSymbolId(e.target.value)}
              style={FIELD}>
        {GDT_SYMBOLS.map((s) => (
          <option key={s.id} value={s.id}>
            {s.glyph}  {s.label}  · {s.category}
          </option>
        ))}
      </select>

      <div style={SECTION_TITLE}>Tolerance</div>
      <div style={ROW}>
        <label style={{ ...ROW, gap: 4 }}>
          <input data-testid="forge-gdt-frames-diameter"
                 type="checkbox"
                 checked={diameterPrefix}
                 onChange={(e) => setDiameterPrefix(e.target.checked)} />
          <span style={{ fontFamily: 'var(--forge-mono, ui-monospace, monospace)' }}>
            Ø (diameter)
          </span>
        </label>
      </div>
      <div style={ROW}>
        <input data-testid="forge-gdt-frames-value"
               type="text"
               inputMode="decimal"
               value={toleranceValue}
               onChange={(e) => setToleranceValue(e.target.value)}
               placeholder="0.1"
               style={{ ...FIELD, width: 120 }} />
        <select data-testid="forge-gdt-frames-tol-modifier"
                value={toleranceModifier}
                onChange={(e) => setToleranceModifier(e.target.value)}
                style={{ ...FIELD, flex: 1 }}>
          {GDT_MODIFIERS.map((m) => (
            <option key={m.id} value={m.id}>{m.label}</option>
          ))}
        </select>
      </div>

      <div style={SECTION_TITLE}>Datum references</div>
      {datumRow('Primary',   datumA, setDatumA, 'forge-gdt-frames-datum-a')}
      {datumRow('Secondary', datumB, setDatumB, 'forge-gdt-frames-datum-b')}
      {datumRow('Tertiary',  datumC, setDatumC, 'forge-gdt-frames-datum-c')}

      <div style={SECTION_TITLE}>Live preview</div>
      <div data-testid="forge-gdt-frames-preview"
           style={PREVIEW_BOX}>
        {preview || <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>—</span>}
      </div>

      <div style={{ ...ROW, marginTop: 4 }}>
        <button type="button"
                onClick={onAdd}
                disabled={!canAdd}
                data-testid="forge-gdt-frames-add"
                style={ADD_BTN(canAdd)}>
          Add frame
        </button>
        {!canAdd && (
          <small data-testid="forge-gdt-frames-add-hint"
                 style={{ color: 'var(--forge-ink-mute, #9aa1ab)', fontSize: 10 }}>
            Enter a numeric tolerance value first.
          </small>
        )}
      </div>

      <div style={SECTION_TITLE}>Existing frames ({frameCount})</div>
      {frameCount === 0 ? (
        <div data-testid="forge-gdt-frames-empty"
             style={{
               padding: '12px 0',
               fontStyle: 'italic',
               color: 'var(--forge-ink-mute, #9aa1ab)',
               fontSize: 11,
             }}>
          No frames yet. Pick a symbol, enter a tolerance, optionally
          add datum references, then press Add frame.
        </div>
      ) : (
        <ul data-testid="forge-gdt-frames-list"
            style={{ listStyle: 'none', margin: 0, padding: 0,
                     display: 'flex', flexDirection: 'column' }}>
          {store.frames.map((f) => (
            <li key={f.id}
                data-testid="forge-gdt-frames-row"
                data-frame-id={f.id}
                data-symbol-id={f.symbolId}
                data-symbol={f.symbol}
                style={FRAME_ROW}>
              <div style={{ minWidth: 0 }}>
                <div style={{
                  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                  fontSize: 12,
                  color: 'var(--forge-ink, #dadde2)',
                  letterSpacing: '0.04em',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}>
                  {f.formatted}
                </div>
                <div style={{
                  fontSize: 10,
                  color: 'var(--forge-ink-mute, #9aa1ab)',
                  marginTop: 2,
                }}>
                  {f.symbol} · {f.category}
                </div>
              </div>
              <button type="button"
                      title="Remove this frame"
                      data-testid={`forge-gdt-frames-del-${f.id}`}
                      onClick={() => onDelete(f.id)}
                      style={DEL_BTN}>
                Delete
              </button>
            </li>
          ))}
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
        Frames persist across sessions (<code>forge.v4.gdtFrames</code>)
        and are mirrored on <code>window.__forgeGdtFrames</code> for
        plugins and Archie tool calls.
      </footer>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.gdtFrames` menu action, exposes
// imperative open/close hooks for plugins / Archie tool calls, and
// surfaces the persisted store on the window mirror at bootstrap so
// reading `window.__forgeGdtFrames` works even before the panel mounts.

export function GdtFramePanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenGdtFramesPanel  = () => setOpen(true);
    window.__forgeCloseGdtFramesPanel = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.gdtFrames') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    // Mirror the persisted store onto window.__forgeGdtFrames at boot.
    try { publish(loadGdtStore()); } catch { /* fail-soft */ }
    // Expose a small debug surface so e2e specs / Archie tool calls /
    // plugins can drive the store without importing the module.
    window.__forgeGdtFramesHelper = Object.freeze({
      addFrame,
      removeFrame,
      listFrames,
      clearAllFrames,
      formatFrameString,
      SYMBOLS: GDT_SYMBOLS,
      MODIFIERS: GDT_MODIFIERS,
      STORAGE_KEY: FORGE_GDT_LS_KEY,
      EVENT_NAME: FORGE_GDT_EVENT_NAME,
    });
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenGdtFramesPanel; } catch {}
      try { delete window.__forgeCloseGdtFramesPanel; } catch {}
    };
  }, []);
  return <GdtFramePanel open={open} onClose={() => setOpen(false)} />;
}

export default GdtFramePanel;
