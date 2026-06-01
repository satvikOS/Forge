// Forge-127 — Sheet Metal workbench panel.
//
// Right-anchored 380 px drawer that activates whenever the user is on
// the `sheet` workbench. Lists every sheet-metal op grouped into six
// CATIA-SMD-style categories:
//   Base | Flange | Bend | Forming | Corner | Flat
//
// Each row is a button; clicking opens an inline parameter dialog the
// user confirms to run the op through sheetMetalDispatch.js. The
// dialog mirrors the DirectEditPanel "OpDialog" pattern so the look &
// feel stays consistent across the panel family.
//
// Manual clicks NEVER write to Archie's thread — they hit the kernel
// dispatch directly. Archie continues to drive the same dispatcher via
// the schema-driven path in ForgeShellV4.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Icon } from './icons/Icon.jsx';
import { showToast } from './Toast.jsx';
import { schemaFor } from './toolSchemas.js';
import {
  SHEET_GROUPS, SHEET_OPS, dispatchSheet, sheetMetalReady,
} from './sheetMetalDispatch.js';
import {
  MATERIAL_IDS, MATERIAL_LABEL, kFactor, K_BASE,
} from './kFactorTable.js';

// ───────────────────────────── styles (token-driven) ──

const panelStyle = {
  position: 'fixed',
  right: 0,
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  bottom: 0,
  width: 380,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  zIndex: 1280,
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)',
  font: 'inherit',
  fontSize: 12,
  overflow: 'hidden',
};

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 'var(--forge-space-2)',
  paddingBottom: 'var(--forge-space-2)',
  borderBottom: '1px solid var(--forge-rail-edge)',
  fontWeight: 600,
};

const groupStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
};

const groupHeaderStyle = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--forge-ink-mute)',
  paddingTop: 6,
  paddingBottom: 2,
};

const opBtnStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 9px',
  background: 'var(--forge-surface, var(--forge-canvas-3))',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius)',
  color: 'var(--forge-ink)',
  cursor: 'pointer',
  textAlign: 'left',
  font: 'inherit',
  fontSize: 12,
  transition: 'background 90ms, border-color 90ms',
};

const logStyle = {
  marginTop: 'var(--forge-space-2)',
  borderTop: '1px solid var(--forge-rail-edge)',
  paddingTop: 'var(--forge-space-2)',
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  maxHeight: 140,
  overflowY: 'auto',
  fontFamily: 'var(--forge-mono)',
  fontSize: 11,
  color: 'var(--forge-ink-2)',
};

// ──────────────────────────── field renderer (matches DirectEditPanel) ──

function Field({ field, value, onChange }) {
  const inputStyle = {
    width: '100%',
    background: 'var(--forge-canvas)',
    border: '1px solid var(--forge-rail-edge)',
    borderRadius: 'var(--forge-radius)',
    color: 'var(--forge-ink)',
    font: 'inherit',
    fontSize: 12,
    padding: '5px 7px',
    boxSizing: 'border-box',
  };
  if (field.type === 'number' || field.type === 'int') {
    return (
      <input type="number" data-test-field={field.id}
             value={value ?? ''} step={field.step ?? (field.type === 'int' ? 1 : 'any')}
             min={field.min} max={field.max}
             onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
             style={inputStyle} />
    );
  }
  if (field.type === 'enum') {
    return (
      <select data-test-field={field.id} value={value ?? field.default ?? ''}
              onChange={(e) => onChange(e.target.value)}
              style={inputStyle}>
        {(field.options || []).map((opt) => (
          <option key={String(opt.value ?? opt)} value={opt.value ?? opt}>
            {opt.label ?? opt}
          </option>
        ))}
      </select>
    );
  }
  if (field.type === 'bool') {
    return (
      <input type="checkbox" data-test-field={field.id}
             checked={Boolean(value)}
             onChange={(e) => onChange(e.target.checked)}
             style={{ accentColor: 'var(--forge-accent)' }} />
    );
  }
  if (field.type === 'vec3') {
    const arr = Array.isArray(value) ? value : [0, 0, 0];
    return (
      <div style={{ display: 'flex', gap: 4 }}>
        {['x', 'y', 'z'].map((axis, i) => (
          <input key={axis} type="number" data-test-field={`${field.id}.${axis}`}
                 value={arr[i] ?? 0}
                 onChange={(e) => {
                   const n = arr.slice();
                   n[i] = Number(e.target.value) || 0;
                   onChange(n);
                 }}
                 style={{ ...inputStyle, padding: '5px 6px' }} />
        ))}
      </div>
    );
  }
  // text / fallback
  return (
    <input type="text" data-test-field={field.id}
           value={value ?? ''}
           onChange={(e) => onChange(e.target.value)}
           style={inputStyle} />
  );
}

// ──────────────────────────── per-op dialog ──

function OpDialog({ op, onCancel, onConfirm }) {
  const schema = useMemo(() => schemaFor(op.id) || { fields: [] }, [op.id]);
  const [values, setValues] = useState(() => {
    const v = {};
    for (const f of schema.fields) v[f.id] = f.default;
    return v;
  });
  // Live K-factor preview — recomputes whenever the user touches
  // material / thickness / bendRadius.
  const livePreview = useMemo(() => {
    const mat = values.material || 'steel-cr4';
    const t = Number(values.thickness) || 1.5;
    const r = Number(values.bendRadius) || t;
    const k = kFactor({ material: mat, thicknessMm: t, bendRadiusMm: r });
    return { mat, t, r, k };
  }, [values.material, values.thickness, values.bendRadius]);

  const submit = useCallback(() => {
    onConfirm(op.id, values);
  }, [op.id, values, onConfirm]);

  return (
    <div role="dialog" data-testid="forge-sheet-dialog"
         aria-label={`${op.label} dialog`}
         style={{
           position: 'absolute',
           inset: 'var(--forge-space-2)',
           background: 'var(--forge-canvas-3)',
           border: '1px solid var(--forge-rail-edge)',
           borderRadius: 'var(--forge-radius-lg)',
           boxShadow: '0 12px 36px rgba(0,0,0,0.55)',
           display: 'flex',
           flexDirection: 'column',
           padding: 'var(--forge-space-3)',
           gap: 'var(--forge-space-2)',
           overflowY: 'auto',
           zIndex: 1,
         }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <strong style={{ flex: 1 }}>{op.label}</strong>
        <button type="button" onClick={onCancel}
                data-testid="forge-sheet-dialog-close"
                aria-label="Close dialog"
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink-mute)', cursor: 'pointer',
                         display: 'inline-flex', padding: 2 }}>
          <Icon name="select.clear" size={12} />
        </button>
      </div>
      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)' }}>
        {schema.title || op.id}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {schema.fields.map((f) => (
          <label key={f.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <span style={{ fontSize: 10, textTransform: 'uppercase',
                           letterSpacing: '0.06em',
                           color: 'var(--forge-ink-mute)' }}>
              {f.label}{f.unit ? ` (${f.unit})` : ''}
            </span>
            <Field field={f} value={values[f.id]}
                   onChange={(v) => setValues((s) => ({ ...s, [f.id]: v }))} />
          </label>
        ))}
      </div>
      {('thickness' in values) && (
        <div data-testid="forge-sheet-kfactor-preview"
             style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                      padding: '6px 8px',
                      background: 'var(--forge-accent-mute)',
                      borderRadius: 'var(--forge-radius)',
                      color: 'var(--forge-ink-2)' }}>
          K-factor (live):&nbsp;
          <strong style={{ color: 'var(--forge-ink)' }}>{livePreview.k.toFixed(3)}</strong>
          &nbsp;·&nbsp;{MATERIAL_LABEL[livePreview.mat] || livePreview.mat}
          &nbsp;·&nbsp;t={livePreview.t}, R={livePreview.r}
        </div>
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
        <button type="button"
                onClick={onCancel}
                data-testid="forge-sheet-dialog-cancel"
                style={{ flex: 1, background: 'var(--forge-surface, var(--forge-canvas-3))',
                         border: '1px solid var(--forge-rail-edge)',
                         borderRadius: 'var(--forge-radius)',
                         color: 'var(--forge-ink)',
                         font: 'inherit', fontSize: 12,
                         padding: '6px 10px', cursor: 'pointer' }}>
          Cancel
        </button>
        <button type="button"
                onClick={submit}
                data-testid="forge-sheet-dialog-confirm"
                style={{ flex: 1,
                         background: 'var(--forge-accent-mute)',
                         border: '1px solid var(--forge-accent)',
                         borderRadius: 'var(--forge-radius)',
                         color: 'var(--forge-ink)',
                         font: 'inherit', fontSize: 12, fontWeight: 600,
                         padding: '6px 10px', cursor: 'pointer' }}>
          Apply
        </button>
      </div>
    </div>
  );
}

// ──────────────────────────── panel ──

export function SheetMetalWorkbench({ open, onClose, onResult }) {
  const [activeOp, setActiveOp] = useState(null);
  const [log, setLog] = useState([]);
  const ready = sheetMetalReady();

  useEffect(() => {
    if (!open) return;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        if (activeOp) setActiveOp(null);
        else onClose?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, activeOp, onClose]);

  const handleConfirm = useCallback((toolId, params) => {
    const r = dispatchSheet(toolId, params || {});
    const entry = {
      ts: Date.now(), id: toolId,
      label: SHEET_OPS[toolId]?.name || toolId,
      ok: r.ok && r.kind !== 'noop',
      handle: r.handle ?? null,
      kind: r.kind,
      message: r.message,
    };
    setLog((l) => [...l, entry]);
    if (entry.ok) {
      showToast({ kind: 'ok', text: `${toolId} → handle ${entry.handle}`, ttl: 1500 });
    } else {
      showToast({ kind: 'warn',
                  text: r.message || `${toolId} → ${r.kind || 'noop'}`,
                  ttl: 2200 });
    }
    onResult?.(entry, r);
    setActiveOp(null);
  }, [onResult]);

  if (!open) return null;

  return (
    <aside role="region"
           aria-label="Sheet metal"
           data-testid="forge-sheet-panel"
           style={panelStyle}>
      <header style={headerStyle}>
        <Icon name="wb.sheet" size={14} />
        <span style={{ flex: 1 }}>Sheet Metal</span>
        <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 10,
                       color: ready ? 'var(--forge-ok)' : 'var(--forge-ink-mute)' }}>
          {ready ? 'kernel ready' : 'kernel idle'}
        </span>
        <button type="button" onClick={onClose} aria-label="Close panel"
                data-testid="forge-sheet-close"
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink-mute)', cursor: 'pointer',
                         display: 'inline-flex', padding: 2 }}>
          <Icon name="select.clear" size={12} />
        </button>
      </header>

      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)' }}>
        Sheet-metal ops grouped CATIA-style. Each tool opens a dialog
        for material, thickness, bend radius, K-factor. Manual ops do
        not write Archie thread.
      </div>

      <div style={{ flex: 1, overflowY: 'auto', display: 'flex',
                    flexDirection: 'column', gap: 'var(--forge-space-2)',
                    paddingRight: 4 }}>
        {SHEET_GROUPS.map((group) => (
          <section key={group.id} style={groupStyle}
                   data-testid={`forge-sheet-group-${group.id}`}>
            <div style={groupHeaderStyle}>{group.label}</div>
            {group.ops.map((op) => (
              <button key={op.id} type="button"
                      data-testid={`forge-sheet-op-${op.id.replace('sheet.', '')}`}
                      data-sheet-op={op.id}
                      onClick={() => setActiveOp(op)}
                      style={opBtnStyle}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--forge-accent-mute)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'var(--forge-surface, var(--forge-canvas-3))'; }}>
                <Icon name="wb.sheet" size={14} />
                <span style={{ flex: 1 }}>{op.label}</span>
                <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 10,
                               color: 'var(--forge-ink-mute)' }}>
                  {op.id.replace('sheet.', '')}
                </span>
              </button>
            ))}
          </section>
        ))}
      </div>

      {log.length > 0 && (
        <div style={logStyle} data-testid="forge-sheet-log">
          {log.slice(-8).reverse().map((entry, i) => (
            <div key={`${entry.ts}-${i}`}
                 style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
              <span style={{ color: entry.ok ? 'var(--forge-ok)' : 'var(--forge-err)' }}>
                {entry.ok ? 'OK' : 'ER'}
              </span>
              <span style={{ flex: 1 }}>{entry.id}</span>
              <span style={{ color: 'var(--forge-ink-mute)' }}>
                {entry.handle != null ? `h=${entry.handle}` : (entry.message || entry.kind)}
              </span>
            </div>
          ))}
        </div>
      )}

      {activeOp && (
        <OpDialog op={activeOp}
                  onCancel={() => setActiveOp(null)}
                  onConfirm={handleConfirm} />
      )}
    </aside>
  );
}

// ──────────────────────────── host ──
//
// Mounted by App.jsx as a sibling of ForgeShellV4. Self-shows when:
//   • the user switches to the `sheet` workbench (we listen for the
//     forge `wb` storage event so we don't need to touch the shell);
//   • the imperative window.__forgeOpenSheetMetal() is called;
//   • or the custom event `forge:open-sheet-metal-panel` fires.

const SHEET_PANEL_EVENT = 'forge:open-sheet-metal-panel';

export function SheetMetalWorkbenchHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeOpenSheetMetal = () => setOpen(true);
    window.__forgeCloseSheetMetal = () => setOpen(false);

    const onEvt = () => setOpen(true);
    window.addEventListener(SHEET_PANEL_EVENT, onEvt);

    // Auto-show when activeWb flips to 'sheet'. The shell publishes
    // window.__forgeActiveWb every state change; poll once on mount,
    // then listen to the storage-style event.
    const sync = () => {
      const wb = window.__forgeActiveWb;
      if (wb === 'sheet') setOpen(true);
    };
    sync();
    window.addEventListener('forge:wb-changed', sync);

    return () => {
      window.removeEventListener(SHEET_PANEL_EVENT, onEvt);
      window.removeEventListener('forge:wb-changed', sync);
    };
  }, []);

  return <SheetMetalWorkbench open={open} onClose={() => setOpen(false)} />;
}

export default SheetMetalWorkbench;
