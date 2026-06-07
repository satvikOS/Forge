// PUSH-176 (Slice-132 / GD&T Datum Target builder).
//
// ASME Y14.5 datum targets are POINTS, LINES, or AREAS used to ESTABLISH a
// datum on a surface that is too irregular to act as a planar / cylindrical
// datum feature on its own. A canonical three-point planar datum (A1 / A2
// / A3) is the textbook example: three small target points define an
// average plane on a casting, forging, or weldment whose as-cast face is
// too wavy to mate flat against a CMM table.
//
// Symbol anatomy (ASME Y14.5 §4.24, figs 4-46…4-52):
//   * Geometry on the surface — ✕ (point), chain-dot line, or hatched
//     circular / rectangular area zone.
//   * Leader line from the geometry to a balloon.
//   * Balloon is a CIRCLE DIVIDED HORIZONTALLY: upper half = target
//     SIZE notation (e.g. "⌀10" or empty for a point), lower half =
//     datum letter + target index (e.g. "A1", "A2", "A3", "B1", "C2").
//
// What this panel does:
//   * Lets the operator enumerate datum targets attached to the active
//     drawing or model. Each target carries id ("A1", "B2", "C3"…), type
//     (point / line / area), coordinates on the parent face, and the
//     target area (mm² — 0 for point, length × default 1 mm width for
//     line, π·r² or w·h for area).
//   * Renders a real SVG inspector to the right of the table so the
//     operator sees the actual Y14.5 datum-target glyph (geometry +
//     leader + balloon).
//   * Persists every target to localStorage `forge.v4.datumTargets`.
//   * Mirrors the live target list onto `window.__forgeDatumTargets`
//     so the e2e spec, plugins, and Archie tool calls can read the
//     published targets without importing the module.
//   * Broadcasts `forge:datum-targets-changed` on every mutation so
//     downstream subscribers (drawings view, AP242 export, Y14.5
//     validator) can refresh their projections.
//
// Hard constraints honoured (PUSH-176 brief + the no-deps mandate):
//   * NO new npm / C++ / external deps. Pure React + browser
//     localStorage + CustomEvent. Same playbook as PUSH-92 GdtFrame.
//   * Real impl, no MVP / stub / placeholder. The SVG inspector renders
//     the actual symbol from `DatumTargetSymbol.jsx` (PUSH-130), the
//     mass / area maths is real (mm²), and the persisted store
//     round-trips a JSON envelope.
//   * Surgical edits to Menus.jsx (one new entry `tools.datumTargets`)
//     and App.jsx (one import + one mount). PUSH-130's existing
//     DatumTargetSymbol.jsx is REUSED unchanged for the SVG glyph; this
//     panel is the BUILDER + persistence layer Y14.5 needs.
//
// Reachable via:
//   * `tools.datumTargets` menu action,
//   * `window.__forgeOpenDatumTargets()` / `closeDatumTargets()`,
//   * `window.__forgeDatumTargetsHelper.addTarget(spec)` for headless
//     callers.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import {
  DatumTargetSymbol,
  DATUM_TARGET_FORM,
  DATUM_TARGET_AREA_SHAPE,
  makeDatumTarget,
} from './DatumTargetSymbol.jsx';

// ─────────────────────────────────────────────────────────────────────
// Constants — keep the storage / event / debug surfaces exported so the
// e2e spec, plugins, and Archie tool calls can reach the same names
// without re-deriving them.

export const FORGE_DT_LS_KEY     = 'forge.v4.datumTargets';
export const FORGE_DT_EVENT_NAME = 'forge:datum-targets-changed';

// ASME Y14.5 datum target FORM enum — the three legal target shapes.
// Mirror the labels we show in the table.
export const DATUM_TARGET_TYPES = Object.freeze([
  { id: 'point', label: 'Point' },
  { id: 'line',  label: 'Line'  },
  { id: 'area',  label: 'Area'  },
]);

const VALID_FORM_IDS = new Set(DATUM_TARGET_TYPES.map((t) => t.id));

// ─────────────────────────────────────────────────────────────────────
// Pure helpers — these are exposed on the helper surface so the e2e +
// plugins + Archie can drive the store headlessly.

/**
 * Stable target id of the form A1 / A2 / B1 / C3.
 * If the spec carries a datum + targetNo combo we honour it, otherwise
 * we auto-generate the next index for the given datum letter.
 */
export function targetLabel(spec) {
  if (!spec || typeof spec !== 'object') return '';
  const d = (typeof spec.datum === 'string' && spec.datum.trim().length)
    ? spec.datum.trim().toUpperCase().slice(0, 1)
    : 'A';
  const n = (Number.isFinite(spec.targetNo) && spec.targetNo > 0)
    ? Math.floor(spec.targetNo) : 1;
  return `${d}${n}`;
}

/**
 * Target area in mm² for a (form, coords) tuple.
 *  - point: 0
 *  - line:  length(a,b) × 1 mm default contact-line width  (Y14.5 default)
 *  - area:  π·r²  (circle)  or  w·h  (rectangle)
 *
 * The mm² value is what the operator records on the drawing balloon's
 * upper half (e.g. "⌀10" = circle with r=5 mm = 78.5 mm² area).
 */
export function targetAreaMm2(form, coords) {
  if (!coords || typeof coords !== 'object') return 0;
  if (form === 'point') return 0;
  if (form === 'line') {
    const ax = Number(coords.ax) || 0, ay = Number(coords.ay) || 0;
    const bx = Number(coords.bx) || 0, by = Number(coords.by) || 0;
    const len = Math.hypot(bx - ax, by - ay);
    return len; // 1 mm contact-line width → mm² == mm length
  }
  if (form === 'area') {
    if ((coords.shape || 'circle') === 'rectangle') {
      const w = Number(coords.w) || 0, h = Number(coords.h) || 0;
      return Math.abs(w * h);
    }
    const r = Number(coords.r) || 0;
    return Math.PI * r * r;
  }
  return 0;
}

function emptyStore() {
  return { version: 1, targets: [] };
}

function nextRecordId() {
  const ts = Date.now().toString(36);
  const rand = Math.floor(Math.random() * 0xffff).toString(16).padStart(4, '0');
  return `dt-${ts}-${rand}`;
}

function defaultGeometryFor(form, coords) {
  // The DatumTargetSymbol.jsx renderer reads `geometry` keyed by form.
  // Mirror its shape so the SVG inspector can pick the same glyph the
  // operator sees in the workbench drawing layer.
  const c = coords || {};
  if (form === 'point') {
    return { x: Number(c.x) || 0, y: Number(c.y) || 0 };
  }
  if (form === 'line') {
    return {
      ax: Number(c.ax) || 0, ay: Number(c.ay) || 0,
      bx: Number(c.bx) || 10, by: Number(c.by) || 0,
    };
  }
  // area — default to circular
  if ((c.shape || 'circle') === 'rectangle') {
    return {
      shape: 'rectangle',
      x: Number(c.x) || 0, y: Number(c.y) || 0,
      w: Number(c.w) || 10, h: Number(c.h) || 8,
    };
  }
  return {
    shape: 'circle',
    cx: Number(c.cx) || 0, cy: Number(c.cy) || 0,
    r:  Number(c.r)  || 5,
  };
}

function normaliseTarget(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const formId = (typeof raw.form === 'string' && VALID_FORM_IDS.has(raw.form))
    ? raw.form : null;
  if (!formId) return null;
  const datum = (typeof raw.datum === 'string' && raw.datum.trim().length)
    ? raw.datum.trim().toUpperCase().slice(0, 1) : 'A';
  const targetNo = (Number.isFinite(raw.targetNo) && raw.targetNo > 0)
    ? Math.floor(raw.targetNo) : 1;
  const id = (typeof raw.id === 'string' && raw.id.length) ? raw.id : nextRecordId();
  const label = (typeof raw.label === 'string' && raw.label.length)
    ? raw.label : `${datum}${targetNo}`;
  const coords = (raw.coords && typeof raw.coords === 'object') ? raw.coords : {};
  const geometry = (raw.geometry && typeof raw.geometry === 'object')
    ? raw.geometry : defaultGeometryFor(formId, coords);
  const areaMm2 = Number.isFinite(raw.areaMm2)
    ? Math.max(0, Number(raw.areaMm2))
    : targetAreaMm2(formId, coords);
  const size = (typeof raw.size === 'string') ? raw.size : '';
  const createdAt = (typeof raw.createdAt === 'number' && Number.isFinite(raw.createdAt))
    ? raw.createdAt : Date.now();
  return {
    id, label, datum, targetNo,
    form: formId,
    coords, geometry,
    areaMm2, size,
    createdAt,
  };
}

function normaliseStore(raw) {
  if (!raw || typeof raw !== 'object') return emptyStore();
  const rawTargets = Array.isArray(raw.targets) ? raw.targets : [];
  const targets = [];
  for (const t of rawTargets) {
    const norm = normaliseTarget(t);
    if (norm) targets.push(norm);
  }
  return { version: 1, targets };
}

export function loadDatumTargetStore() {
  if (typeof window === 'undefined') return emptyStore();
  try {
    const txt = window.localStorage.getItem(FORGE_DT_LS_KEY);
    if (!txt) return emptyStore();
    return normaliseStore(JSON.parse(txt));
  } catch {
    return emptyStore();
  }
}

export function saveDatumTargetStore(store) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      FORGE_DT_LS_KEY,
      JSON.stringify(normaliseStore(store)),
    );
  } catch { /* quota-exceeded etc. — non-fatal */ }
}

// Mirror the store into `window.__forgeDatumTargets` so the e2e spec /
// plugins / Archie tool calls can read the target list without
// importing the module. Mutate the live reference in place so
// subscribers that captured the array don't go stale across mutations.
function syncWindowMirror(store) {
  if (typeof window === 'undefined') return;
  if (!Array.isArray(window.__forgeDatumTargets)) window.__forgeDatumTargets = [];
  const arr = window.__forgeDatumTargets;
  arr.length = 0;
  for (const t of store.targets) arr.push(t);
}

function publish(store) {
  if (typeof window === 'undefined') return;
  saveDatumTargetStore(store);
  syncWindowMirror(store);
  try {
    window.dispatchEvent(new CustomEvent(FORGE_DT_EVENT_NAME, { detail: store }));
  } catch { /* CustomEvent always exists in Electron */ }
}

// ─────────────────────────────────────────────────────────────────────
// Public mutator API — used by the panel + exposed on the window debug
// surface so e2e specs / plugins / Archie tool calls can drive the
// store without mounting the React panel.

export function addTarget(spec) {
  const norm = normaliseTarget(spec);
  if (!norm) return null;
  const store = loadDatumTargetStore();
  const next = { ...store, targets: [...store.targets, norm] };
  publish(next);
  return norm;
}

export function removeTarget(id) {
  if (typeof id !== 'string' || !id.length) return false;
  const store = loadDatumTargetStore();
  const next = store.targets.filter((t) => t.id !== id);
  if (next.length === store.targets.length) return false;
  publish({ ...store, targets: next });
  return true;
}

export function listTargets() {
  return loadDatumTargetStore().targets.slice();
}

export function clearAllTargets() {
  publish(emptyStore());
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail matching the family of Forge inspector
// panels (SectionPlane / Layers / GdtFrames / PMI / BomAggregator).

const PANEL_W = 560;

function panelStyle() {
  return {
    position: 'fixed',
    top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
    right: 0,
    bottom: 'var(--forge-statusbar-h, 24px)',
    width: PANEL_W,
    maxWidth: '96vw',
    zIndex: 1335, // one tick below GdtFrames (1336); we co-mount safely.
    background: 'var(--forge-canvas-2, #161b22)',
    borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
    padding: 'var(--forge-space-3, 12px)',
    display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
    color: 'var(--forge-ink, #dadde2)', fontSize: 12,
    overflowY: 'auto',
  };
}

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
const DEL_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink-mute, #9aa1ab)',
  cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3, fontSize: 10,
};
const HEADER_CELL = {
  padding: '4px 6px',
  textAlign: 'left',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
};
const CELL = {
  padding: '4px 6px',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
  textAlign: 'left',
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
};
const CELL_RIGHT = { ...CELL, textAlign: 'right' };

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function DatumTargetPanel({ open, onClose }) {
  const [store, setStore] = useState(() => loadDatumTargetStore());
  const [datum, setDatum] = useState('A');
  const [targetNo, setTargetNo] = useState(1);
  const [form, setForm] = useState('point');
  const [px, setPx] = useState(0);
  const [py, setPy] = useState(0);
  const [lineAx, setLineAx] = useState(-8);
  const [lineAy, setLineAy] = useState(0);
  const [lineBx, setLineBx] = useState(8);
  const [lineBy, setLineBy] = useState(0);
  const [areaShape, setAreaShape] = useState('circle');
  const [areaR, setAreaR] = useState(5);
  const [areaW, setAreaW] = useState(10);
  const [areaH, setAreaH] = useState(8);
  const [size, setSize] = useState('');
  const [selectedId, setSelectedId] = useState(null);

  // Refresh on open + sync the window mirror so the persisted state is
  // visible to plugins / scripts even before the first mutation.
  useEffect(() => {
    if (!open) return undefined;
    const fresh = loadDatumTargetStore();
    setStore(fresh);
    publish(fresh);
    const onChange = () => setStore(loadDatumTargetStore());
    window.addEventListener(FORGE_DT_EVENT_NAME, onChange);
    return () => {
      window.removeEventListener(FORGE_DT_EVENT_NAME, onChange);
    };
  }, [open]);

  // Auto-bump the target number when datum changes or after every add so
  // the operator naturally walks A1 → A2 → A3 then bumps to B1 manually.
  useEffect(() => {
    // When datum changes, jump to next unused number for that letter.
    const used = new Set(store.targets
      .filter((t) => t.datum === datum)
      .map((t) => t.targetNo));
    let n = 1;
    while (used.has(n)) n += 1;
    setTargetNo(n);
  }, [datum, store.targets.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live coordinates the user is editing.
  const coords = useMemo(() => {
    if (form === 'point') return { x: Number(px) || 0, y: Number(py) || 0 };
    if (form === 'line') {
      return {
        ax: Number(lineAx) || 0, ay: Number(lineAy) || 0,
        bx: Number(lineBx) || 0, by: Number(lineBy) || 0,
      };
    }
    if (areaShape === 'rectangle') {
      return {
        shape: 'rectangle',
        x: -Math.abs(Number(areaW) || 0) / 2,
        y: -Math.abs(Number(areaH) || 0) / 2,
        w: Math.abs(Number(areaW) || 0),
        h: Math.abs(Number(areaH) || 0),
      };
    }
    return {
      shape: 'circle',
      cx: 0, cy: 0, r: Math.abs(Number(areaR) || 0),
    };
  }, [form, px, py, lineAx, lineAy, lineBx, lineBy, areaShape, areaR, areaW, areaH]);

  const liveAreaMm2 = useMemo(() => targetAreaMm2(form, coords), [form, coords]);

  const draftSpec = useMemo(() => ({
    form, datum, targetNo, size,
    coords,
    geometry: defaultGeometryFor(form, coords),
    areaMm2: liveAreaMm2,
    label: `${datum}${targetNo}`,
  }), [form, datum, targetNo, size, coords, liveAreaMm2]);

  // Build a preview target that matches the makeDatumTarget shape so
  // the same DatumTargetSymbol glyph renders correctly.
  const previewTarget = useMemo(() => makeDatumTarget({
    form, datum, targetNo,
    size: size || '',
    geometry: defaultGeometryFor(form, coords),
    balloonAt: [16, -12],
  }), [form, datum, targetNo, size, coords]);

  const canAdd = useMemo(() => {
    if (!VALID_FORM_IDS.has(form)) return false;
    if (!/^[A-Z]$/.test(datum)) return false;
    if (!(Number.isFinite(targetNo) && targetNo >= 1)) return false;
    // Reject duplicate (datum, targetNo) combos.
    return !store.targets.some(
      (t) => t.datum === datum && t.targetNo === targetNo);
  }, [form, datum, targetNo, store.targets]);

  const onAdd = useCallback(() => {
    if (!canAdd) return;
    const rec = addTarget(draftSpec);
    if (rec) {
      setStore(loadDatumTargetStore());
      setSelectedId(rec.id);
    }
  }, [canAdd, draftSpec]);

  const onDelete = useCallback((id) => {
    const ok = removeTarget(id);
    if (ok) {
      setStore(loadDatumTargetStore());
      if (selectedId === id) setSelectedId(null);
    }
  }, [selectedId]);

  const onClear = useCallback(() => {
    clearAllTargets();
    setStore(loadDatumTargetStore());
    setSelectedId(null);
  }, []);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  const targetCount = store.targets.length;
  // Show selected target in the inspector; otherwise show the live draft.
  const inspectorTarget = useMemo(() => {
    if (selectedId) {
      const sel = store.targets.find((t) => t.id === selectedId);
      if (sel) {
        return {
          ...sel,
          balloonAt: sel.balloonAt || [16, -12],
        };
      }
    }
    return previewTarget;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, store.targets, previewTarget]);

  return createPortal(
    <div role="dialog"
         aria-label="GD&T Datum Targets — ASME Y14.5"
         data-testid="forge-datum-targets-panel"
         data-target-count={targetCount}
         style={panelStyle()}>
      <header style={HEADER_ROW}>
        <Icon name="measure.distance" size={14} />
        <strong style={{ fontSize: 13 }}>Datum Targets · ASME Y14.5</strong>
        <span data-testid="forge-datum-targets-count"
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                padding: '1px 6px', borderRadius: 'var(--forge-radius-pill, 10px)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
          {targetCount}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onClear}
                title="Remove every datum target (cannot be undone)"
                data-testid="forge-datum-targets-clear"
                style={CLEAR_BTN}>
          Clear all
        </button>
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close Datum Targets panel"
                data-testid="forge-datum-targets-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={SECTION_TITLE}>New target</div>
      <div style={ROW}>
        <label style={{ ...ROW, gap: 4 }}>
          <span style={{ width: 50, color: 'var(--forge-ink-mute, #9aa1ab)' }}>Datum</span>
          <input data-testid="forge-datum-targets-datum"
                 type="text"
                 maxLength={1}
                 value={datum}
                 onChange={(e) => setDatum(e.target.value.toUpperCase().slice(0, 1) || 'A')}
                 style={{ ...FIELD, width: 50, textAlign: 'center' }} />
        </label>
        <label style={{ ...ROW, gap: 4 }}>
          <span style={{ width: 56, color: 'var(--forge-ink-mute, #9aa1ab)' }}>Target #</span>
          <input data-testid="forge-datum-targets-no"
                 type="number"
                 min={1} max={99}
                 value={targetNo}
                 onChange={(e) => setTargetNo(Math.max(1, parseInt(e.target.value, 10) || 1))}
                 style={{ ...FIELD, width: 60, textAlign: 'center' }} />
        </label>
        <span data-testid="forge-datum-targets-label-preview"
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 12, fontWeight: 700,
                padding: '4px 8px',
                background: 'var(--forge-canvas, #0d1117)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
                borderRadius: 3,
              }}>
          {datum}{targetNo}
        </span>
      </div>

      <div style={ROW}>
        <label style={{ ...ROW, gap: 4 }}>
          <span style={{ width: 50, color: 'var(--forge-ink-mute, #9aa1ab)' }}>Type</span>
          <select data-testid="forge-datum-targets-form"
                  value={form}
                  onChange={(e) => setForm(e.target.value)}
                  style={{ ...FIELD, width: 120 }}>
            {DATUM_TARGET_TYPES.map((t) => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
        </label>
        <label style={{ ...ROW, gap: 4, flex: 1 }}>
          <span style={{ width: 40, color: 'var(--forge-ink-mute, #9aa1ab)' }}>Size</span>
          <input data-testid="forge-datum-targets-size"
                 type="text"
                 value={size}
                 onChange={(e) => setSize(e.target.value)}
                 placeholder={form === 'point' ? '— (no size for point)' : '⌀10'}
                 style={{ ...FIELD, flex: 1 }} />
        </label>
      </div>

      {form === 'point' && (
        <div style={ROW}>
          <label style={{ ...ROW, gap: 4 }}>
            <span style={{ width: 30, color: 'var(--forge-ink-mute, #9aa1ab)' }}>x</span>
            <input data-testid="forge-datum-targets-pt-x"
                   type="number"
                   value={px}
                   onChange={(e) => setPx(parseFloat(e.target.value) || 0)}
                   style={{ ...FIELD, width: 80 }} />
          </label>
          <label style={{ ...ROW, gap: 4 }}>
            <span style={{ width: 30, color: 'var(--forge-ink-mute, #9aa1ab)' }}>y</span>
            <input data-testid="forge-datum-targets-pt-y"
                   type="number"
                   value={py}
                   onChange={(e) => setPy(parseFloat(e.target.value) || 0)}
                   style={{ ...FIELD, width: 80 }} />
          </label>
        </div>
      )}
      {form === 'line' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={ROW}>
            <span style={{ width: 30, color: 'var(--forge-ink-mute, #9aa1ab)' }}>A</span>
            <label style={{ ...ROW, gap: 4 }}>
              <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>x</span>
              <input data-testid="forge-datum-targets-line-ax"
                     type="number"
                     value={lineAx}
                     onChange={(e) => setLineAx(parseFloat(e.target.value) || 0)}
                     style={{ ...FIELD, width: 70 }} />
            </label>
            <label style={{ ...ROW, gap: 4 }}>
              <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>y</span>
              <input data-testid="forge-datum-targets-line-ay"
                     type="number"
                     value={lineAy}
                     onChange={(e) => setLineAy(parseFloat(e.target.value) || 0)}
                     style={{ ...FIELD, width: 70 }} />
            </label>
          </div>
          <div style={ROW}>
            <span style={{ width: 30, color: 'var(--forge-ink-mute, #9aa1ab)' }}>B</span>
            <label style={{ ...ROW, gap: 4 }}>
              <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>x</span>
              <input data-testid="forge-datum-targets-line-bx"
                     type="number"
                     value={lineBx}
                     onChange={(e) => setLineBx(parseFloat(e.target.value) || 0)}
                     style={{ ...FIELD, width: 70 }} />
            </label>
            <label style={{ ...ROW, gap: 4 }}>
              <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>y</span>
              <input data-testid="forge-datum-targets-line-by"
                     type="number"
                     value={lineBy}
                     onChange={(e) => setLineBy(parseFloat(e.target.value) || 0)}
                     style={{ ...FIELD, width: 70 }} />
            </label>
          </div>
        </div>
      )}
      {form === 'area' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <label style={{ ...ROW, gap: 4 }}>
            <span style={{ width: 50, color: 'var(--forge-ink-mute, #9aa1ab)' }}>Shape</span>
            <select data-testid="forge-datum-targets-area-shape"
                    value={areaShape}
                    onChange={(e) => setAreaShape(e.target.value)}
                    style={{ ...FIELD, width: 130 }}>
              <option value="circle">Circle</option>
              <option value="rectangle">Rectangle</option>
            </select>
          </label>
          {areaShape === 'circle' && (
            <label style={{ ...ROW, gap: 4 }}>
              <span style={{ width: 50, color: 'var(--forge-ink-mute, #9aa1ab)' }}>r (mm)</span>
              <input data-testid="forge-datum-targets-area-r"
                     type="number" min={0.1} step={0.1}
                     value={areaR}
                     onChange={(e) => setAreaR(parseFloat(e.target.value) || 0)}
                     style={{ ...FIELD, width: 90 }} />
            </label>
          )}
          {areaShape === 'rectangle' && (
            <div style={ROW}>
              <label style={{ ...ROW, gap: 4 }}>
                <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>w</span>
                <input data-testid="forge-datum-targets-area-w"
                       type="number" min={0.1} step={0.1}
                       value={areaW}
                       onChange={(e) => setAreaW(parseFloat(e.target.value) || 0)}
                       style={{ ...FIELD, width: 80 }} />
              </label>
              <label style={{ ...ROW, gap: 4 }}>
                <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>h</span>
                <input data-testid="forge-datum-targets-area-h"
                       type="number" min={0.1} step={0.1}
                       value={areaH}
                       onChange={(e) => setAreaH(parseFloat(e.target.value) || 0)}
                       style={{ ...FIELD, width: 80 }} />
              </label>
            </div>
          )}
        </div>
      )}

      <div style={ROW}>
        <span style={{ ...SECTION_TITLE, margin: 0, fontSize: 10 }}>
          Target area (mm²)
        </span>
        <span data-testid="forge-datum-targets-area"
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 12, fontWeight: 600,
                color: 'var(--forge-ink, #dadde2)',
                padding: '2px 8px',
                background: 'var(--forge-canvas, #0d1117)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
                borderRadius: 3,
              }}>
          {liveAreaMm2.toFixed(3)}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onAdd}
                disabled={!canAdd}
                data-testid="forge-datum-targets-add"
                style={ADD_BTN(canAdd)}>
          Add target
        </button>
      </div>
      {!canAdd && (
        <small data-testid="forge-datum-targets-add-hint"
               style={{ color: 'var(--forge-ink-mute, #9aa1ab)', fontSize: 10 }}>
          {/^[A-Z]$/.test(datum)
            ? `Target ${datum}${targetNo} already exists — bump the number.`
            : 'Datum must be a single A-Z letter.'}
        </small>
      )}

      <div style={SECTION_TITLE}>SVG inspector</div>
      <div data-testid="forge-datum-targets-inspector"
           style={{
             background: 'var(--forge-canvas, #0d1117)',
             border: '1px solid var(--forge-rail-edge, #2a2d34)',
             borderRadius: 3, padding: 8,
             display: 'flex', alignItems: 'center', justifyContent: 'center',
             minHeight: 120,
           }}>
        <svg viewBox="-40 -40 80 80"
             width={200} height={200}
             data-testid="forge-datum-targets-svg"
             style={{ color: 'var(--forge-ink, #dadde2)' }}>
          <DatumTargetSymbol target={inspectorTarget} ink="currentColor" />
        </svg>
      </div>

      <div style={SECTION_TITLE}>Existing targets ({targetCount})</div>
      {targetCount === 0 ? (
        <div data-testid="forge-datum-targets-empty"
             style={{
               padding: '12px 0',
               fontStyle: 'italic',
               color: 'var(--forge-ink-mute, #9aa1ab)',
               fontSize: 11,
             }}>
          No targets yet. A 3-point planar datum needs three target
          points (e.g. A1 / A2 / A3) — pick Point above, set coordinates,
          press Add target.
        </div>
      ) : (
        <table data-testid="forge-datum-targets-table"
               style={{
                 width: '100%', borderCollapse: 'collapse',
               }}>
          <thead>
            <tr>
              <th style={HEADER_CELL}>ID</th>
              <th style={HEADER_CELL}>Type</th>
              <th style={HEADER_CELL}>Coords</th>
              <th style={{ ...HEADER_CELL, textAlign: 'right' }}>Area (mm²)</th>
              <th style={HEADER_CELL}> </th>
            </tr>
          </thead>
          <tbody>
            {store.targets.map((t) => (
              <tr key={t.id}
                  data-testid="forge-datum-targets-row"
                  data-target-id={t.id}
                  data-target-label={t.label}
                  data-target-form={t.form}
                  data-target-datum={t.datum}
                  data-target-no={t.targetNo}
                  data-target-area={t.areaMm2}
                  onClick={() => setSelectedId(t.id)}
                  style={{
                    cursor: 'pointer',
                    background: selectedId === t.id
                      ? 'var(--forge-accent-mute, #1f3a72)'
                      : 'transparent',
                  }}>
                <td style={{ ...CELL, fontWeight: 700 }}
                    data-testid="forge-datum-targets-row-label">
                  {t.label}
                </td>
                <td style={CELL} data-testid="forge-datum-targets-row-form">
                  {t.form}
                </td>
                <td style={CELL} data-testid="forge-datum-targets-row-coords">
                  {formatCoordsShort(t)}
                </td>
                <td style={CELL_RIGHT}
                    data-testid="forge-datum-targets-row-area">
                  {Number(t.areaMm2).toFixed(3)}
                </td>
                <td style={CELL}>
                  <button type="button"
                          title="Remove this target"
                          data-testid={`forge-datum-targets-del-${t.id}`}
                          onClick={(e) => { e.stopPropagation(); onDelete(t.id); }}
                          style={DEL_BTN}>
                    Del
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <footer style={{
        padding: '8px 0 0',
        borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
        color: 'var(--forge-ink-mute, #9aa1ab)',
        fontSize: 10,
        lineHeight: 1.4,
        marginTop: 'auto',
      }}>
        Datum targets persist across sessions (<code>forge.v4.datumTargets</code>)
        and are mirrored on <code>window.__forgeDatumTargets</code> for
        plugins and Archie tool calls. Three-point planar datum: A1/A2/A3.
      </footer>
    </div>,
    document.body,
  );
}

function formatCoordsShort(t) {
  const c = t.coords || {};
  if (t.form === 'point') {
    return `(${(Number(c.x) || 0).toFixed(2)}, ${(Number(c.y) || 0).toFixed(2)})`;
  }
  if (t.form === 'line') {
    return `(${(Number(c.ax) || 0).toFixed(1)},${(Number(c.ay) || 0).toFixed(1)})→`
         + `(${(Number(c.bx) || 0).toFixed(1)},${(Number(c.by) || 0).toFixed(1)})`;
  }
  if ((c.shape || 'circle') === 'rectangle') {
    return `${(Number(c.w) || 0).toFixed(1)}×${(Number(c.h) || 0).toFixed(1)} rect`;
  }
  return `⌀${(2 * (Number(c.r) || 0)).toFixed(1)} circle`;
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.datumTargets` menu action, exposes
// imperative open/close hooks for plugins / Archie tool calls, and
// surfaces the persisted store on the window mirror at bootstrap so
// reading `window.__forgeDatumTargets` works even before the panel mounts.

export function DatumTargetPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenDatumTargets  = () => setOpen(true);
    window.__forgeCloseDatumTargets = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.datumTargets') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    // Mirror the persisted store onto window.__forgeDatumTargets at boot.
    try { publish(loadDatumTargetStore()); } catch { /* fail-soft */ }
    // Expose a small debug surface so e2e specs / Archie tool calls /
    // plugins can drive the store without importing the module.
    window.__forgeDatumTargetsHelper = Object.freeze({
      addTarget,
      removeTarget,
      listTargets,
      clearAllTargets,
      targetAreaMm2,
      targetLabel,
      TYPES: DATUM_TARGET_TYPES,
      STORAGE_KEY: FORGE_DT_LS_KEY,
      EVENT_NAME: FORGE_DT_EVENT_NAME,
    });
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenDatumTargets; } catch {}
      try { delete window.__forgeCloseDatumTargets; } catch {}
    };
  }, []);
  return <DatumTargetPanel open={open} onClose={() => setOpen(false)} />;
}

export default DatumTargetPanel;
