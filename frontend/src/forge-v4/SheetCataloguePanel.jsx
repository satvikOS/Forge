// PUSH-95 (Slice-63 / Sheet Metal multi-flange catalogue panel).
//
// Up through PUSH-43 (Slice-12) the only UI in Forge that exercised the
// `forge.sheetMetal.*` kernel namespace end-to-end was the Sheet Metal
// workbench's baseFlange → edgeFlange → flatPattern triplet. The kernel
// itself, however, ships nine first-class ops:
//
//   baseFlange · edgeFlange · miterFlange · hem · jog ·
//   closedCorner · cornerRelief · unfold · flatPattern
//
// PUSH-43 wired the first three; the remaining six were callable only
// via Archie or the macro recorder. PUSH-95 lands the missing UI: a
// right-docked Sheet Metal Catalogue panel reachable from the Tools
// menu (`tools.sheetCatalogue`) that lets the user pick the active
// sheet body (auto-seeding a 100×60×2 baseFlange if there isn't one
// yet) and then apply any of EIGHT downstream flange ops through their
// own inline param dialog. Each Apply call goes through the real
// `sheetMetalDispatch` wrapper (which calls `window.forge.sheetMetal.{op}`),
// the returned native handle replaces the seed body via
// `__forgeAppendBody`, and the panel logs the result.
//
// Contract:
//   * Mounts as a fixed right-docked drawer; toggled by
//     `window.__forgeOpenSheetCatalogue(true|false)` or the
//     `tools.sheetCatalogue` menu action (`forge:menu-action`).
//   * Picks the active sheet metal body from `window.__forgeBodies`
//     (selected → last with toolId `sheet.*` → last native body).
//   * If the picked body's toolId is not `sheet.*`, "Seed base flange"
//     button materialises a 100×60×2 mm baseFlange via the kernel and
//     pushes it through `__forgeAppendBody`.
//   * Eight op buttons: Edge Flange / Miter Flange / Hem / Jog /
//     Closed Corner / Corner Relief / Unfold / Flat Pattern. Clicking
//     a button toggles its inline form (edge / vertex id + numeric
//     fields). Apply runs `dispatchSheet` and, on success, replaces
//     the active sheet body with the returned native handle (sheet
//     metal kernel ops always supersede the previous body).
//   * Self-describing through data-testid + data-* attributes so the
//     e2e spec can assert state without DOM-scraping.
//   * Publishes `window.__forgeLastSheetCatalogueOp` + the bus event
//     `forge:sheet-catalogue-op` after every apply.
//
// Hard constraints (per the slice brief): no new npm/C++ deps, real
// kernel calls only, no stub / fallback / placeholder. The mass
// properties readout uses `window.forge.massProps` — already present
// from PUSH-58 — so the panel doubles as a quick volume sanity check.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  baseFlange  as smBaseFlange,
  edgeFlange  as smEdgeFlange,
  miterFlange as smMiterFlange,
  hem         as smHem,
  jog         as smJog,
  closedCorner as smClosedCorner,
  cornerRelief as smCornerRelief,
  unfold       as smUnfold,
  flatPattern  as smFlatPattern,
  sheetMetalReady,
} from './sheetMetalDispatch.js';

// ─────────────────────────────────────────────────────────────────────
// Op catalogue. Each entry declares its label, kernel runner, and the
// list of param fields the inline form should render. Fields are
// rendered in order with their own input + a default value. The keys
// match the argument names the sheetMetalDispatch wrappers accept.

const FIELD_NUM  = 'number';
const FIELD_INT  = 'int';
const FIELD_ENUM = 'enum';

export const SHEET_CATALOGUE_OPS = Object.freeze([
  {
    id: 'sheet.edgeFlange',
    label: 'Edge Flange',
    hint: 'Add a 90° flange to one perimeter edge.',
    runner: smEdgeFlange,
    fields: [
      { id: 'edgeId',    label: 'Edge ID',       type: FIELD_INT,  default: 0,   min: 0, step: 1 },
      { id: 'length',    label: 'Length',        type: FIELD_NUM,  default: 25,  min: 0.1, step: 0.5, unit: 'mm' },
      { id: 'angleDeg',  label: 'Angle',         type: FIELD_NUM,  default: 90,  step: 1,   unit: '°' },
      { id: 'relief',    label: 'Relief',        type: FIELD_ENUM, default: 'rect', options: ['rect','obround','tear','none'] },
      { id: 'thickness', label: 'Thickness',     type: FIELD_NUM,  default: 2,   min: 0.05, step: 0.1, unit: 'mm' },
      { id: 'bendRadius',label: 'Bend radius',   type: FIELD_NUM,  default: 3,   min: 0.01, step: 0.1, unit: 'mm' },
    ],
  },
  {
    id: 'sheet.miterFlange',
    label: 'Miter Flange',
    hint: 'Single mitered flange along one or more edges.',
    runner: smMiterFlange,
    fields: [
      { id: 'edgeIds',   label: 'Edge IDs (csv)', type: 'csv',  default: '0' },
      { id: 'length',    label: 'Length',         type: FIELD_NUM, default: 20, min: 0.1, step: 0.5, unit: 'mm' },
      { id: 'angleDeg',  label: 'Angle',          type: FIELD_NUM, default: 90, step: 1,   unit: '°' },
      { id: 'thickness', label: 'Thickness',      type: FIELD_NUM, default: 2,  min: 0.05, step: 0.1, unit: 'mm' },
      { id: 'bendRadius',label: 'Bend radius',    type: FIELD_NUM, default: 3,  min: 0.01, step: 0.1, unit: 'mm' },
    ],
  },
  {
    id: 'sheet.hem',
    label: 'Hem',
    hint: 'Flat-fold a perimeter edge for safety / stiffness.',
    runner: smHem,
    fields: [
      { id: 'edgeId',   label: 'Edge ID',  type: FIELD_INT, default: 0, min: 0, step: 1 },
      { id: 'hemType',  label: 'Hem type', type: FIELD_ENUM, default: 'closed',
                         options: ['closed','open','tear-drop','rolled'] },
      { id: 'length',   label: 'Length',   type: FIELD_NUM, default: 3, min: 0.05, step: 0.5, unit: 'mm' },
      { id: 'thickness',label: 'Thickness',type: FIELD_NUM, default: 2, min: 0.05, step: 0.1, unit: 'mm' },
      { id: 'bendRadius',label: 'Bend radius', type: FIELD_NUM, default: 3, min: 0.01, step: 0.1, unit: 'mm' },
    ],
  },
  {
    id: 'sheet.jog',
    label: 'Jog',
    hint: 'Z-bend offset on a perimeter edge.',
    runner: smJog,
    fields: [
      { id: 'edgeId',    label: 'Edge ID',    type: FIELD_INT, default: 0, min: 0, step: 1 },
      { id: 'jogHeight', label: 'Jog height', type: FIELD_NUM, default: 8, min: 0.01, step: 0.5, unit: 'mm' },
      { id: 'angleDeg',  label: 'Angle',      type: FIELD_NUM, default: 90, step: 1, unit: '°' },
      { id: 'thickness', label: 'Thickness',  type: FIELD_NUM, default: 2,  min: 0.05, step: 0.1, unit: 'mm' },
      { id: 'bendRadius',label: 'Bend radius',type: FIELD_NUM, default: 3,  min: 0.01, step: 0.1, unit: 'mm' },
    ],
  },
  {
    id: 'sheet.closedCorner',
    label: 'Closed Corner',
    hint: 'Seal the gap where two flanges meet at a vertex.',
    runner: smClosedCorner,
    fields: [
      { id: 'vertexId',  label: 'Vertex ID', type: FIELD_INT, default: 0, min: 0, step: 1 },
      { id: 'gap',       label: 'Gap',       type: FIELD_NUM, default: 0.1, min: 0, step: 0.01, unit: 'mm' },
      { id: 'thickness', label: 'Thickness', type: FIELD_NUM, default: 2,   min: 0.05, step: 0.1, unit: 'mm' },
      { id: 'bendRadius',label: 'Bend radius', type: FIELD_NUM, default: 3, min: 0.01, step: 0.1, unit: 'mm' },
    ],
  },
  {
    id: 'sheet.cornerRelief',
    label: 'Corner Relief',
    hint: 'Punch a relief shape at a corner vertex.',
    runner: smCornerRelief,
    fields: [
      { id: 'vertexId',   label: 'Vertex ID', type: FIELD_INT, default: 0, min: 0, step: 1 },
      { id: 'reliefMode', label: 'Mode',      type: FIELD_ENUM, default: 'circular',
                          options: ['circular','oval','rectangular'] },
      { id: 'sizeMm',     label: 'Size',      type: FIELD_NUM, default: 1.5, min: 0.05, step: 0.1, unit: 'mm' },
      { id: 'thickness',  label: 'Thickness', type: FIELD_NUM, default: 2,   min: 0.05, step: 0.1, unit: 'mm' },
      { id: 'bendRadius', label: 'Bend radius', type: FIELD_NUM, default: 3, min: 0.01, step: 0.1, unit: 'mm' },
    ],
  },
  {
    id: 'sheet.unfold',
    label: 'Unfold',
    hint: 'Flatten the formed part along its bend log.',
    runner: smUnfold,
    fields: [
      { id: 'thickness', label: 'Thickness',  type: FIELD_NUM, default: 2,  min: 0.05, step: 0.1, unit: 'mm' },
      { id: 'bendRadius',label: 'Bend radius',type: FIELD_NUM, default: 3,  min: 0.01, step: 0.1, unit: 'mm' },
      { id: 'k',         label: 'K-factor',   type: FIELD_NUM, default: 0.44, min: 0, max: 0.5, step: 0.01 },
    ],
  },
  {
    id: 'sheet.flatPattern',
    label: 'Flat Pattern',
    hint: 'Develop the 2D laser-ready outline.',
    runner: smFlatPattern,
    fields: [
      { id: 'thickness', label: 'Thickness',  type: FIELD_NUM, default: 2,  min: 0.05, step: 0.1, unit: 'mm' },
      { id: 'bendRadius',label: 'Bend radius',type: FIELD_NUM, default: 3,  min: 0.01, step: 0.1, unit: 'mm' },
      { id: 'k',         label: 'K-factor',   type: FIELD_NUM, default: 0.44, min: 0, max: 0.5, step: 0.01 },
    ],
  },
]);

const OP_BY_ID = Object.freeze(
  SHEET_CATALOGUE_OPS.reduce((acc, op) => { acc[op.id] = op; return acc; }, {}),
);

// ─────────────────────────────────────────────────────────────────────
// Helpers — active sheet body picker.

/** Detect whether a body looks like the head of a sheet-metal chain. */
export function isSheetMetalBody(b) {
  if (!b || b.kind !== 'native' || typeof b.handle !== 'number') return false;
  const tid = String(b.toolId || '');
  return tid.startsWith('sheet.');
}

/** Pick the sheet body to operate on:
 *    1. selected body that is sheet metal
 *    2. last body with toolId 'sheet.*'
 *    3. last native body of any kind (fallback)
 *    4. null
 */
export function pickActiveSheetBody() {
  if (typeof window === 'undefined') return null;
  const arr = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  const native = arr.filter((b) => b && b.kind === 'native' && typeof b.handle === 'number');
  if (native.length === 0) return null;
  const sel = window.__forgeSelection || null;
  if (sel && typeof sel.bodyHandle === 'number') {
    const m = native.find((b) => b.handle === sel.bodyHandle);
    if (m && isSheetMetalBody(m)) return m;
  }
  for (let i = native.length - 1; i >= 0; i -= 1) {
    if (isSheetMetalBody(native[i])) return native[i];
  }
  return native[native.length - 1];
}

/** Read body volume via the live kernel; returns null when unavailable. */
export function readBodyVolume(handle) {
  if (typeof handle !== 'number') return null;
  if (typeof window === 'undefined' || !window.forge?.massProps) return null;
  try {
    const mp = window.forge.massProps(handle);
    const v = Math.abs(Number(mp?.volume));
    return Number.isFinite(v) ? v : null;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────
// Styles — match the right-docked panel rail used by Mass Props / Big
// Scene / BOM Balloons panels.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 420,
  zIndex: 1342,
  background: 'var(--forge-canvas-2, #131820)',
  borderLeft: '1px solid var(--forge-rail-edge, #1f2a37)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #ebecef)', fontSize: 12,
  overflow: 'hidden',
};
const HEADER_STYLE = {
  display: 'flex', justifyContent: 'space-between',
  alignItems: 'center', gap: 8,
};
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #1f2a37)',
  color: 'var(--forge-ink, #ebecef)', cursor: 'pointer',
  padding: '2px 8px', borderRadius: 3, fontSize: 14,
  lineHeight: '16px',
};
const HELP_STYLE = {
  color: 'var(--forge-ink-mute, #8a93a0)', lineHeight: 1.45, fontSize: 11,
};
const SCROLL_STYLE = {
  flex: 1,
  overflowY: 'auto',
  display: 'flex', flexDirection: 'column', gap: 6,
  paddingRight: 4,
};
const SEED_BTN_STYLE = {
  background: 'var(--forge-accent, #2e7be0)',
  color: '#fff',
  border: '1px solid var(--forge-accent, #2e7be0)',
  padding: '7px 10px',
  cursor: 'pointer',
  fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
  fontWeight: 600, fontSize: 12,
  borderRadius: 4, textAlign: 'left',
};
const OP_ROW_STYLE = {
  display: 'flex', flexDirection: 'column',
  border: '1px solid var(--forge-rail-edge, #1f2a37)',
  borderRadius: 4,
  background: 'var(--forge-surface, #1a212c)',
  overflow: 'hidden',
};
const OP_HEADER_STYLE = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '7px 9px',
  background: 'transparent',
  border: 'none',
  color: 'var(--forge-ink, #ebecef)',
  cursor: 'pointer',
  textAlign: 'left',
  font: 'inherit', fontSize: 12,
};
const OP_BODY_STYLE = {
  borderTop: '1px solid var(--forge-rail-edge, #1f2a37)',
  padding: '8px 9px',
  display: 'flex', flexDirection: 'column', gap: 6,
  background: 'var(--forge-canvas-3, #0f141c)',
};
const FIELD_LABEL = {
  fontSize: 10, textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--forge-ink-mute, #8a93a0)',
};
const FIELD_INPUT = {
  width: '100%',
  background: 'var(--forge-canvas, #0a0d12)',
  border: '1px solid var(--forge-rail-edge, #1f2a37)',
  borderRadius: 3,
  color: 'var(--forge-ink, #ebecef)',
  font: 'inherit',
  fontSize: 12,
  padding: '5px 7px',
  boxSizing: 'border-box',
};
const APPLY_BTN = {
  ...SEED_BTN_STYLE,
  background: 'var(--forge-accent-mute, #213b62)',
  borderColor: 'var(--forge-accent, #2e7be0)',
  textAlign: 'center',
  fontWeight: 600,
};
const LOG_STYLE = {
  marginTop: 6,
  borderTop: '1px solid var(--forge-rail-edge, #1f2a37)',
  paddingTop: 6,
  display: 'flex', flexDirection: 'column', gap: 3,
  maxHeight: 120,
  overflowY: 'auto',
  fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
  fontSize: 10,
  color: 'var(--forge-ink-2, #b5bcc6)',
};

// ─────────────────────────────────────────────────────────────────────
// Inline form field renderer.

function FieldInput({ field, value, onChange, opId }) {
  if (field.type === FIELD_ENUM) {
    return (
      <select
        value={value ?? field.default ?? ''}
        data-testid={`forge-sheet-catalogue-field-${opId.replace('sheet.', '')}-${field.id}`}
        data-field={field.id}
        onChange={(e) => onChange(e.target.value)}
        style={FIELD_INPUT}
      >
        {(field.options || []).map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    );
  }
  if (field.type === 'csv') {
    return (
      <input
        type="text"
        value={value ?? field.default ?? ''}
        data-testid={`forge-sheet-catalogue-field-${opId.replace('sheet.', '')}-${field.id}`}
        data-field={field.id}
        onChange={(e) => onChange(e.target.value)}
        style={FIELD_INPUT}
        placeholder="e.g. 0,1,2,3"
      />
    );
  }
  // number / int
  return (
    <input
      type="number"
      value={value ?? ''}
      step={field.step ?? (field.type === FIELD_INT ? 1 : 'any')}
      min={field.min}
      max={field.max}
      data-testid={`forge-sheet-catalogue-field-${opId.replace('sheet.', '')}-${field.id}`}
      data-field={field.id}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') { onChange(null); return; }
        const n = Number(raw);
        onChange(Number.isFinite(n) ? n : null);
      }}
      style={FIELD_INPUT}
    />
  );
}

// ─────────────────────────────────────────────────────────────────────
// Build the kernel-bound params bag from form values for a given op.

function buildRunnerArgs(op, formValues, shape) {
  const args = { ...formValues };
  // 'csv' fields (currently miterFlange.edgeIds) need parsing.
  for (const f of op.fields) {
    if (f.type === 'csv') {
      const raw = String(args[f.id] ?? f.default ?? '0').trim();
      const ids = raw.split(',').map((s) => Number(s.trim())).filter((n) => Number.isFinite(n));
      args[f.id] = ids.length ? ids : [0];
    } else if (formValues[f.id] === undefined || formValues[f.id] === null) {
      // empty input falls back to schema default.
      args[f.id] = f.default;
    }
  }
  // Inject the active sheet body handle when the op needs it.
  if (op.id !== 'sheet.unfold' && op.id !== 'sheet.flatPattern') {
    args.shape = shape;
  } else {
    args.shape = shape;
  }
  return args;
}

// ─────────────────────────────────────────────────────────────────────
// Panel.

export function SheetCataloguePanel({ open, onClose }) {
  const [body, setBody] = useState(() => pickActiveSheetBody());
  const [openOpId, setOpenOpId] = useState(null);
  const [formValues, setFormValues] = useState({});
  const [log, setLog] = useState([]);
  const [status, setStatus] = useState('Pick a sheet body or seed a base flange to begin.');
  const [, setBodyTick] = useState(0);

  // Keep the active body in sync with the live shell. Polls cheaply on
  // every selection / bodies update event.
  useEffect(() => {
    if (!open) return undefined;
    const sync = () => {
      const next = pickActiveSheetBody();
      setBody(next);
      setBodyTick((n) => n + 1);
    };
    sync();
    const evs = ['forge:bodies-changed', 'forge:selection-changed', 'forge:wb-changed'];
    for (const e of evs) window.addEventListener(e, sync);
    const iv = setInterval(sync, 800);
    return () => {
      for (const e of evs) window.removeEventListener(e, sync);
      clearInterval(iv);
    };
  }, [open]);

  // Reset form state on op switch — load defaults for the new op.
  const openOp = openOpId ? OP_BY_ID[openOpId] : null;
  useEffect(() => {
    if (!openOp) { setFormValues({}); return; }
    const defaults = {};
    for (const f of openOp.fields) defaults[f.id] = f.default;
    setFormValues(defaults);
  }, [openOpId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Live volume of the current sheet body — gives a quick proof-of-life
  // readout that the kernel is wired and the panel is looking at the
  // body we think it is.
  const volume = useMemo(() => {
    if (!body) return null;
    return readBodyVolume(body.handle);
  }, [body]);

  // Seed a 100×60×2 baseFlange when there's no sheet body.
  const onSeed = useCallback(() => {
    if (!sheetMetalReady()) {
      setStatus('Kernel not ready — forge.sheetMetal is unavailable.');
      return;
    }
    const r = smBaseFlange({
      width: 100, height: 60,
      thickness: 2, bendRadius: 3,
      material: 'steel-cr4',
    });
    if (!r.ok || r.kind !== 'native' || typeof r.handle !== 'number') {
      setStatus(`Seed failed: ${r.message || r.kind || 'unknown'}`);
      return;
    }
    const id = `sheet-cat-base-${Date.now().toString(36)}`;
    const next = {
      id, kind: 'native', handle: r.handle,
      toolId: 'sheet.baseFlange',
      name: 'Sheet · Base Flange 100×60×2',
      params: r.params,
    };
    if (typeof window.__forgeAppendBody === 'function') {
      window.__forgeAppendBody(next);
    }
    setBody(next);
    setStatus(`Seeded base flange h=${r.handle}.`);
    setLog((l) => [...l, {
      ts: Date.now(),
      op: 'sheet.baseFlange',
      ok: true,
      handle: r.handle,
    }]);
    try {
      window.dispatchEvent(new CustomEvent('forge:sheet-catalogue-op', {
        detail: { op: 'sheet.baseFlange', handle: r.handle, ok: true },
      }));
      window.__forgeLastSheetCatalogueOp = {
        op: 'sheet.baseFlange', handle: r.handle, ok: true, ts: Date.now(),
      };
    } catch { /* fail-soft */ }
  }, []);

  // Replace the active sheet body with `next`. Edge flange / hem / etc.
  // *supersede* the previous body — we keep the seed in the log but
  // swap the live body for downstream ops.
  const replaceActiveBody = useCallback((nextBody) => {
    if (typeof window === 'undefined') return;
    const arr = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
    const oldId = body?.id || null;
    const filtered = oldId ? arr.filter((b) => b.id !== oldId) : arr;
    const replaced = [...filtered, nextBody];
    if (typeof window.__forgeSetBodies === 'function') {
      window.__forgeSetBodies(replaced);
    } else if (typeof window.__forgeAppendBody === 'function') {
      window.__forgeAppendBody(nextBody);
    }
    setBody(nextBody);
  }, [body]);

  const applyOp = useCallback((op) => {
    if (!sheetMetalReady()) {
      setStatus('Kernel not ready — forge.sheetMetal is unavailable.');
      return;
    }
    if (!body) {
      setStatus('No active sheet body — click "Seed Base Flange" first.');
      return;
    }
    const args = buildRunnerArgs(op, formValues, body.handle);
    let r;
    try {
      r = op.runner(args);
    } catch (err) {
      r = { ok: false, kind: 'noop', op: op.id, message: err?.message || String(err) };
    }
    const ok = !!r?.ok && r.kind === 'native' && typeof r.handle === 'number';
    const entry = {
      ts: Date.now(),
      op: op.id,
      ok,
      handle: r?.handle ?? null,
      message: r?.message || null,
    };
    setLog((l) => [...l, entry]);
    if (ok) {
      const nextId = `sheet-cat-${op.id.split('.')[1]}-${Date.now().toString(36)}`;
      const nextBody = {
        id: nextId, kind: 'native', handle: r.handle,
        toolId: op.id,
        name: `Sheet · ${op.label}`,
        params: r.params || args,
      };
      replaceActiveBody(nextBody);
      setStatus(`${op.id} → handle ${r.handle}`);
    } else {
      setStatus(`${op.id} failed: ${r?.message || r?.kind || 'unknown'}`);
    }
    try {
      window.dispatchEvent(new CustomEvent('forge:sheet-catalogue-op', {
        detail: { op: op.id, ok, handle: r?.handle ?? null, message: r?.message || null },
      }));
      window.__forgeLastSheetCatalogueOp = {
        op: op.id, ok, handle: r?.handle ?? null, message: r?.message || null, ts: Date.now(),
      };
    } catch { /* fail-soft */ }
  }, [body, formValues, replaceActiveBody]);

  if (!open) return null;

  const kernelReady = sheetMetalReady();
  const hasSheet = !!(body && isSheetMetalBody(body));
  const volStr = (volume === null || !Number.isFinite(volume))
    ? '—'
    : volume.toFixed(2);

  return (
    <aside
      role="region"
      aria-label="Sheet metal catalogue"
      data-testid="forge-sheet-catalogue-panel"
      data-kernel-ready={kernelReady ? 'true' : 'false'}
      data-has-sheet={hasSheet ? 'true' : 'false'}
      data-body-id={body?.id || ''}
      data-body-handle={body?.handle != null ? String(body.handle) : ''}
      data-body-toolid={body?.toolId || ''}
      data-body-volume={volStr}
      data-open-op={openOpId || ''}
      data-op-count={String(SHEET_CATALOGUE_OPS.length)}
      data-log-count={String(log.length)}
      style={PANEL_STYLE}
    >
      <header style={HEADER_STYLE}>
        <strong>Sheet Metal Catalogue</strong>
        <button
          type="button"
          onClick={onClose}
          data-testid="forge-sheet-catalogue-close"
          aria-label="Close panel"
          style={CLOSE_BTN}
        >×</button>
      </header>

      <div style={HELP_STYLE} data-testid="forge-sheet-catalogue-help">
        Pick (or seed) a sheet body, then expand any op. Apply runs the
        real kernel via <code>forge.sheetMetal</code>; the returned
        native handle replaces the previous body so downstream ops
        chain off the latest geometry.
      </div>

      <div
        data-testid="forge-sheet-catalogue-body-row"
        style={{
          display: 'grid',
          gridTemplateColumns: '60px 1fr',
          columnGap: 8, rowGap: 3,
          fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
          fontSize: 11,
          background: 'var(--forge-canvas-3, #0f141c)',
          padding: '6px 8px',
          borderRadius: 4,
          border: '1px solid var(--forge-rail-edge, #1f2a37)',
        }}
      >
        <span style={{ color: 'var(--forge-ink-mute, #8a93a0)' }}>Body</span>
        <span data-testid="forge-sheet-catalogue-body-name">
          {body ? `${body.name || body.id} · h=${body.handle}` : '— none —'}
        </span>
        <span style={{ color: 'var(--forge-ink-mute, #8a93a0)' }}>Tool</span>
        <span data-testid="forge-sheet-catalogue-body-tool">
          {body?.toolId || '—'}
        </span>
        <span style={{ color: 'var(--forge-ink-mute, #8a93a0)' }}>Volume</span>
        <span data-testid="forge-sheet-catalogue-body-volume">
          {volStr} mm³
        </span>
        <span style={{ color: 'var(--forge-ink-mute, #8a93a0)' }}>Kernel</span>
        <span
          data-testid="forge-sheet-catalogue-kernel"
          style={{ color: kernelReady
            ? 'var(--forge-good, #4ade80)'
            : 'var(--forge-bad,  #ff6363)' }}
        >
          {kernelReady ? 'ready' : 'unavailable'}
        </span>
      </div>

      {!hasSheet && (
        <button
          type="button"
          onClick={onSeed}
          data-testid="forge-sheet-catalogue-seed"
          style={SEED_BTN_STYLE}
        >
          Seed Base Flange · 100 × 60 × 2 mm
        </button>
      )}

      <div style={SCROLL_STYLE} data-testid="forge-sheet-catalogue-ops">
        {SHEET_CATALOGUE_OPS.map((op) => {
          const isOpen = openOpId === op.id;
          const opKey = op.id.replace('sheet.', '');
          return (
            <div
              key={op.id}
              data-testid={`forge-sheet-catalogue-op-${opKey}`}
              data-op-id={op.id}
              data-open={isOpen ? 'true' : 'false'}
              style={OP_ROW_STYLE}
            >
              <button
                type="button"
                style={OP_HEADER_STYLE}
                data-testid={`forge-sheet-catalogue-op-${opKey}-toggle`}
                onClick={() => setOpenOpId(isOpen ? null : op.id)}
                aria-expanded={isOpen ? 'true' : 'false'}
              >
                <span style={{ flex: 1, fontWeight: 600 }}>{op.label}</span>
                <span style={{ fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
                               fontSize: 10,
                               color: 'var(--forge-ink-mute, #8a93a0)' }}>
                  {opKey}
                </span>
              </button>
              {isOpen && (
                <div style={OP_BODY_STYLE}>
                  <div style={{ fontSize: 10,
                                color: 'var(--forge-ink-mute, #8a93a0)' }}>
                    {op.hint}
                  </div>
                  {op.fields.map((f) => (
                    <label key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span style={FIELD_LABEL}>
                        {f.label}{f.unit ? ` (${f.unit})` : ''}
                      </span>
                      <FieldInput
                        field={f}
                        opId={op.id}
                        value={formValues[f.id]}
                        onChange={(v) => setFormValues((s) => ({ ...s, [f.id]: v }))}
                      />
                    </label>
                  ))}
                  <button
                    type="button"
                    onClick={() => applyOp(op)}
                    disabled={!hasSheet}
                    data-testid={`forge-sheet-catalogue-op-${opKey}-apply`}
                    style={{
                      ...APPLY_BTN,
                      opacity: hasSheet ? 1 : 0.5,
                      cursor: hasSheet ? 'pointer' : 'not-allowed',
                    }}
                  >
                    Apply {op.label}
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div
        data-testid="forge-sheet-catalogue-status"
        data-status-text={status}
        style={{
          fontFamily: 'var(--forge-mono, ui-monospace, SFMono-Regular)',
          fontSize: 10,
          color: 'var(--forge-ink-mute, #8a93a0)',
        }}
      >
        {status}
      </div>

      {log.length > 0 && (
        <div style={LOG_STYLE} data-testid="forge-sheet-catalogue-log">
          {log.slice(-6).reverse().map((entry, i) => (
            <div
              key={`${entry.ts}-${i}`}
              data-testid="forge-sheet-catalogue-log-entry"
              data-op={entry.op}
              data-ok={entry.ok ? 'true' : 'false'}
              data-handle={entry.handle != null ? String(entry.handle) : ''}
              style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}
            >
              <span style={{
                color: entry.ok
                  ? 'var(--forge-good, #4ade80)'
                  : 'var(--forge-bad,  #ff6363)',
              }}>
                {entry.ok ? 'OK' : 'ER'}
              </span>
              <span style={{ flex: 1 }}>{entry.op}</span>
              <span style={{ color: 'var(--forge-ink-mute, #8a93a0)' }}>
                {entry.handle != null ? `h=${entry.handle}` : (entry.message || '')}
              </span>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host. Subscribes to `tools.sheetCatalogue` (via forge:menu-action)
// and exposes the imperative open/close hooks.

export function SheetCataloguePanelHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSheetCatalogue  = (v) =>
      setOpen(v === undefined ? true : !!v);
    window.__forgeCloseSheetCatalogue = () => setOpen(false);
    // Default the published last-op slot so e2e probes always see the
    // surface, even before any apply runs.
    if (!window.__forgeLastSheetCatalogueOp) {
      window.__forgeLastSheetCatalogueOp = { op: null, ok: false, handle: null, ts: 0 };
    }
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.sheetCatalogue') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenSheetCatalogue;  } catch { /* noop */ }
      try { delete window.__forgeCloseSheetCatalogue; } catch { /* noop */ }
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <SheetCataloguePanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default SheetCataloguePanel;
