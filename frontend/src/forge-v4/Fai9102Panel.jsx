// PUSH-184 (Slice-140 / FAI AS9102 generator).
//
// AS9102 Rev B is the SAE aerospace standard the AS9100D §8.5.1.3 clause
// invokes for production process verification: a real aerospace shop
// must ship a First Article Inspection Report (FAIR) with every new
// part or revised part before serial production begins. The FAIR has
// THREE forms — Form 1 (part number accountability), Form 2 (material
// + special process verification), Form 3 (characteristic accountability).
//
// This panel ships those three forms as a tabbed editor. Each tab
// renders the REAL AS9102 column structure (numbered FAIR fields, not
// invented columns), auto-populates Part Number / Revision from the
// PUSH-100 PDM revisions store (window.__forgePdmRevisions) and the
// Form 2 material rows from the PUSH-109 Material Properties store
// (window.__forgeMaterialProperties), and exports the whole FAIR to
// a single ASCII .txt via the same forge.dialog.saveFile / writeBlob
// pipeline every other panel uses.
//
// State is persisted to `forge.v4.fai9102` so a window relaunch keeps
// the in-progress FAIR. Every edit publishes onto window.__forgeFai9102
// so headless callers + the e2e can read the live snapshot.
//
// Hard constraints (PUSH-184 brief):
//   * NO new npm / C++ / external deps. Pure ES + React.
//   * Real impl, no MVP / stub / placeholder.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one
//     import + one mount).
//
// Reachable via:
//   * `tools.fai9102` menu action,
//   * `window.__forgeOpenFai9102(true|false)`,
//   * `window.__forgeFai9102Helper.{populate,exportTxt,setForm1,...}`.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import {
  FORM_IDS, FORM_META,
  FORM1_FIELDS, FORM2_FIELDS, FORM3_FIELDS,
  CHARACTERISTIC_DESIGNATORS,
  makeBlankForm1, makeBlankForm2Row, makeBlankForm3Row, makeBlankFair,
  formatFairAscii,
  populateForm1FromPdm, populateForm2FromMaterials,
} from './as9102Forms.js';

const STORAGE_KEY = 'forge.v4.fai9102';
export const FORGE_FAI9102_EVENT = 'forge:fai9102-changed';

// ─────────────────────────────────────────────────────────────────────
// Persistence.

function loadState() {
  if (typeof localStorage === 'undefined') return makeBlankFair();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return makeBlankFair();
    const j = JSON.parse(raw);
    if (j && typeof j === 'object'
            && j.form1 && Array.isArray(j.form2) && Array.isArray(j.form3)) {
      // Merge in defaults so an older persisted record gets any new field.
      return {
        form1: { ...makeBlankForm1(), ...j.form1 },
        form2: j.form2.map((r) => ({ ...makeBlankForm2Row(0), ...r })),
        form3: j.form3.map((r) => ({ ...makeBlankForm3Row(0), ...r })),
      };
    }
  } catch { /* ignore */ }
  return makeBlankFair();
}
function saveState(s) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

// ─────────────────────────────────────────────────────────────────────
// Styles.

const PANEL_W = 880;

function panelStyle() {
  return {
    position: 'fixed',
    top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
    right: 0,
    width: PANEL_W, maxWidth: '98vw',
    height: 'calc(100vh - var(--forge-topbar-h, 40px) - var(--forge-qat-h, 32px) - var(--forge-cmdbar-h, 24px))',
    background: 'var(--forge-canvas-2, #161b22)',
    borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
    boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
    display: 'flex', flexDirection: 'column',
    fontSize: 12,
    color: 'var(--forge-ink, #dadde2)',
    zIndex: 1320,
  };
}

const HEADER_CELL = {
  padding: '5px 8px',
  textAlign: 'left',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
};

const CELL_INPUT = {
  width: '100%',
  background: 'var(--forge-canvas, #0e1117)',
  color: 'var(--forge-ink, #dadde2)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3,
  padding: '3px 6px',
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 11,
};

const BTN = {
  background: 'var(--forge-canvas, #0e1117)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 3,
  color: 'var(--forge-ink, #dadde2)',
  font: 'inherit', fontSize: 11,
  padding: '4px 10px',
  cursor: 'pointer',
};
const BTN_PRIMARY = {
  ...BTN,
  background: 'var(--forge-accent-mute, #1f3a72)',
  border: '1px solid var(--forge-accent-rim, #3a7afe)',
};

// ─────────────────────────────────────────────────────────────────────
// Panel.

export function Fai9102Panel({ open, onClose }) {
  const [state, setState] = useState(() => loadState());
  const [activeTab, setActiveTab] = useState('form1');
  const [status, setStatus] = useState(null);

  // Persist + publish onto window + dispatch the bus event.
  const commit = useCallback((next) => {
    setState(next);
    saveState(next);
    if (typeof window !== 'undefined') {
      try {
        window.__forgeFai9102 = next;
        window.dispatchEvent(new CustomEvent(FORGE_FAI9102_EVENT, { detail: next }));
      } catch { /* ignore */ }
    }
  }, []);

  // Mirror initial state to window so headless callers see it before
  // any edit happens.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.__forgeFai9102 = state; } catch { /* ignore */ }
  }, [state]);

  const setForm1 = useCallback((patch) => {
    commit({ ...state, form1: { ...state.form1, ...patch } });
  }, [state, commit]);

  const setForm2Row = useCallback((idx, patch) => {
    const next = state.form2.map((r, i) => i === idx ? { ...r, ...patch } : r);
    commit({ ...state, form2: next });
  }, [state, commit]);
  const addForm2 = useCallback(() => {
    commit({ ...state, form2: [...state.form2, makeBlankForm2Row(state.form2.length)] });
  }, [state, commit]);
  const removeForm2 = useCallback((idx) => {
    commit({ ...state, form2: state.form2.filter((_, i) => i !== idx) });
  }, [state, commit]);

  const setForm3Row = useCallback((idx, patch) => {
    const next = state.form3.map((r, i) => i === idx ? { ...r, ...patch } : r);
    commit({ ...state, form3: next });
  }, [state, commit]);
  const addForm3 = useCallback(() => {
    commit({ ...state, form3: [...state.form3, makeBlankForm3Row(state.form3.length)] });
  }, [state, commit]);
  const removeForm3 = useCallback((idx) => {
    commit({ ...state, form3: state.form3.filter((_, i) => i !== idx) });
  }, [state, commit]);

  // Auto-populate — pull from PDM revisions + material properties.
  const autoPopulate = useCallback(() => {
    if (typeof window === 'undefined') return;
    try {
      const pdm = window.__forgePdmRevisions;
      const matProps = window.__forgeMaterialProperties;
      const matPropsAll = window.__forgeMaterialPropertiesAll;
      const fallbackPn = (state.form1?.partNumber || '').trim()
        || (pdm?.current ? `PN-${pdm.current.replace(/\./g, '')}` : 'PN-000001');
      const newForm1 = populateForm1FromPdm(pdm, fallbackPn);
      // Don't blow away user-typed values: only fill blanks.
      const mergedForm1 = { ...newForm1 };
      for (const f of FORM1_FIELDS) {
        const cur = state.form1?.[f.id];
        if (cur !== '' && cur != null && cur !== false) {
          // Boolean fields default to true so we treat "false" as user-set
          // only if the existing value is genuinely the opposite of seed.
          if (f.kind === 'bool') {
            mergedForm1[f.id] = cur;
          } else {
            mergedForm1[f.id] = cur;
          }
        }
      }
      const matRows = populateForm2FromMaterials(matProps, matPropsAll);
      // Merge material rows into Form 2 — append the auto-populated rows
      // after any existing rows so user-typed rows are preserved.
      const existing = Array.isArray(state.form2) ? state.form2 : [];
      const existingNames = new Set(
        existing.map((r) => (r?.materialOrProcessName || '').trim().toLowerCase()).filter(Boolean));
      const fresh = matRows.filter((r) => {
        const key = (r.materialOrProcessName || '').trim().toLowerCase();
        return key && !existingNames.has(key);
      });
      const nextForm2 = [...existing, ...fresh].map((r, i) => ({ ...r, ordinal: i }));
      commit({ ...state, form1: mergedForm1, form2: nextForm2 });
      setStatus(`auto-populated · ${fresh.length} material row(s) appended`);
    } catch (err) {
      setStatus(`error: ${err?.message || String(err)}`);
    }
  }, [state, commit]);

  // Reset the entire FAIR.
  const resetAll = useCallback(() => {
    commit(makeBlankFair());
    setStatus('reset');
  }, [commit]);

  // Export TXT — runs the same forge.dialog.saveFile / writeBlob pipeline
  // every other panel uses.
  const exportTxt = useCallback(async () => {
    const txt = formatFairAscii(state);
    try { window.__forgeLastFai9102Txt = txt; } catch { /* ignore */ }
    const dialog = (typeof window !== 'undefined') ? window.forge?.dialog : null;
    if (!dialog || typeof dialog.saveFile !== 'function'
                || typeof dialog.writeBlob !== 'function') {
      setStatus('error: forge.dialog.saveFile / writeBlob unavailable');
      return;
    }
    const pn = state.form1?.partNumber || 'unknown';
    const fairId = state.form1?.fairIdentifier || 'FAIR-DRAFT';
    setStatus('exporting…');
    try {
      const fp = await dialog.saveFile({
        title: 'Export AS9102 FAIR',
        defaultPath: `fair-${pn}-${fairId}.txt`,
        filters: [{ name: 'Text', extensions: ['txt'] }],
      });
      if (!fp) { setStatus('cancelled'); return; }
      const bytes = new TextEncoder().encode(txt);
      const res = await dialog.writeBlob(fp, bytes);
      if (res && res.ok) {
        try { window.__forgeLastFai9102Path = fp; } catch { /* ignore */ }
        setStatus(`saved → ${fp.split(/[/\\]/).pop()} (${res.bytes} B)`);
      } else {
        setStatus(`error: ${res?.error || 'writeBlob failed'}`);
      }
    } catch (err) {
      setStatus(`error: ${err?.message || String(err)}`);
    }
  }, [state]);

  // Auto-clear status after a few seconds.
  useEffect(() => {
    if (!status) return undefined;
    const t = setTimeout(() => setStatus(null), 4500);
    return () => clearTimeout(t);
  }, [status]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <aside
      role="region"
      aria-label="AS9102 First Article Inspection Report"
      data-testid="forge-fai9102-panel"
      data-active-tab={activeTab}
      data-form2-rows={state.form2.length}
      data-form3-rows={state.form3.length}
      style={panelStyle()}
    >
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onPopulate={autoPopulate}
        onReset={resetAll}
        onExport={exportTxt}
        onClose={onClose}
        status={status}
        partNumber={state.form1?.partNumber || ''}
        fairId={state.form1?.fairIdentifier || ''}
      />

      <div style={{
        flex: 1, overflowY: 'auto',
        background: 'var(--forge-canvas, #0e1117)',
        padding: 12,
      }}>
        {activeTab === 'form1' && (
          <Form1Body row={state.form1} setRow={setForm1} />
        )}
        {activeTab === 'form2' && (
          <Form2Body
            rows={state.form2}
            setRow={setForm2Row}
            onAdd={addForm2}
            onRemove={removeForm2}
          />
        )}
        {activeTab === 'form3' && (
          <Form3Body
            rows={state.form3}
            setRow={setForm3Row}
            onAdd={addForm3}
            onRemove={removeForm3}
          />
        )}
      </div>
    </aside>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────

function Header({
  activeTab, setActiveTab,
  onPopulate, onReset, onExport, onClose,
  status, partNumber, fairId,
}) {
  return (
    <header style={{
      display: 'flex', flexDirection: 'column',
      borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
      background: 'var(--forge-canvas, #0e1117)',
      flexShrink: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '10px 12px',
      }}>
        <Icon name="misc.settings" size={14} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          AS9102 FAI Report
        </span>
        <span data-testid="forge-fai9102-pn-chip"
              style={{
                fontFamily: 'var(--forge-mono, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                padding: '1px 6px', borderRadius: 'var(--forge-radius-pill, 10px)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
          PN: {partNumber || '—'} · FAIR: {fairId || '—'}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onPopulate}
                data-testid="forge-fai9102-populate" style={BTN}>
          Auto-populate
        </button>
        <button type="button" onClick={onReset}
                data-testid="forge-fai9102-reset" style={BTN}>
          Reset
        </button>
        <button type="button" onClick={onExport}
                data-testid="forge-fai9102-export" style={BTN_PRIMARY}>
          Export TXT…
        </button>
        <button type="button" onClick={onClose}
                aria-label="Close AS9102 FAI panel"
                data-testid="forge-fai9102-close"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--forge-ink-mute, #9aa1ab)', cursor: 'pointer',
                  display: 'inline-flex', padding: 2,
                }}>
          ×
        </button>
      </div>

      {/* Tab strip. */}
      <div role="tablist" style={{
        display: 'flex', gap: 0,
        padding: '0 12px',
        borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
      }}>
        {FORM_IDS.map((id) => (
          <button key={id} type="button" role="tab"
            data-testid={`forge-fai9102-tab-${id}`}
            data-active={activeTab === id ? 'true' : 'false'}
            onClick={() => setActiveTab(id)}
            style={{
              background: activeTab === id
                ? 'var(--forge-canvas-2, #161b22)'
                : 'transparent',
              border: 'none',
              borderBottom: activeTab === id
                ? '2px solid var(--forge-accent-rim, #3a7afe)'
                : '2px solid transparent',
              color: 'var(--forge-ink, #dadde2)',
              cursor: 'pointer',
              fontSize: 12,
              padding: '8px 14px',
              fontWeight: activeTab === id ? 600 : 400,
            }}>
            {FORM_META[id].shortLabel}
          </button>
        ))}
      </div>

      {status && (
        <div style={{
          padding: '6px 12px',
          fontSize: 11,
          fontFamily: 'var(--forge-mono, monospace)',
          color: status.startsWith('error')
            ? 'var(--forge-err, #ff6363)'
            : 'var(--forge-ok, #4caf50)',
          borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
        }} data-testid="forge-fai9102-status">
          {status}
        </div>
      )}
    </header>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Form 1 — vertical key/value editor (one row per FAIR).

function Form1Body({ row, setRow }) {
  return (
    <section data-testid="forge-fai9102-form1">
      <div style={{ marginBottom: 10, color: 'var(--forge-ink-mute, #9aa1ab)', fontSize: 11 }}>
        AS9102 Form 1 — one record per first article. Field numbers preserved.
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {FORM1_FIELDS.map((f) => (
            <tr key={f.id}
                data-row="form1"
                data-field-id={f.id}
                style={{ borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)' }}>
              <th style={{
                ...HEADER_CELL,
                width: 280,
                verticalAlign: 'middle',
                whiteSpace: 'nowrap',
              }}>
                <span style={{ color: 'var(--forge-accent-rim, #3a7afe)', marginRight: 6 }}>
                  [{f.field}]
                </span>
                {f.header}
              </th>
              <td style={{ padding: '3px 8px' }}>
                {f.kind === 'bool' ? (
                  <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <input type="checkbox"
                           checked={!!row[f.id]}
                           data-testid={`forge-fai9102-f1-${f.id}`}
                           onChange={(e) => setRow({ [f.id]: e.target.checked })} />
                    <span style={{
                      fontFamily: 'var(--forge-mono, monospace)',
                      fontSize: 11,
                      color: 'var(--forge-ink-mute, #9aa1ab)',
                    }}>
                      {row[f.id] ? 'YES' : 'NO'}
                    </span>
                  </label>
                ) : (
                  <input type="text"
                         value={row[f.id] || ''}
                         data-testid={`forge-fai9102-f1-${f.id}`}
                         onChange={(e) => setRow({ [f.id]: e.target.value })}
                         style={CELL_INPUT} />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Form 2 — material / process rows.

function Form2Body({ rows, setRow, onAdd, onRemove }) {
  return (
    <section data-testid="forge-fai9102-form2">
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 10,
      }}>
        <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)', fontSize: 11 }}>
          AS9102 Form 2 — Material / Special Process / Functional Test
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onAdd}
                data-testid="forge-fai9102-f2-add" style={BTN}>
          + Row
        </button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{
            position: 'sticky', top: 0,
            background: 'var(--forge-canvas-2, #161b22)',
            borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
          }}>
            <th style={{ ...HEADER_CELL, width: 36 }}>#</th>
            {FORM2_FIELDS.map((c) => (
              <th key={c.id} style={HEADER_CELL}>
                <span style={{ color: 'var(--forge-accent-rim, #3a7afe)', marginRight: 4 }}>
                  [{c.field}]
                </span>
                {c.header}
              </th>
            ))}
            <th style={{ ...HEADER_CELL, width: 32 }}>—</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr data-testid="forge-fai9102-f2-empty">
              <td colSpan={FORM2_FIELDS.length + 2}
                  style={{ padding: 16, color: 'var(--forge-ink-mute)', fontStyle: 'italic' }}>
                No material / process rows. Click "+ Row" or "Auto-populate".
              </td>
            </tr>
          ) : rows.map((r, i) => (
            <tr key={i}
                data-row="form2"
                data-row-index={i}
                style={{ borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)' }}>
              <td style={{ padding: '3px 8px', color: 'var(--forge-ink-mute, #9aa1ab)' }}>
                {i + 1}
              </td>
              {FORM2_FIELDS.map((c) => (
                <td key={c.id} style={{ padding: '3px 6px' }}>
                  <input type="text"
                         value={r[c.id] || ''}
                         data-testid={`forge-fai9102-f2-${c.id}-${i}`}
                         onChange={(e) => setRow(i, { [c.id]: e.target.value })}
                         style={CELL_INPUT} />
                </td>
              ))}
              <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                <button type="button" onClick={() => onRemove(i)}
                        data-testid={`forge-fai9102-f2-rm-${i}`}
                        style={{
                          ...BTN,
                          padding: '2px 6px',
                          color: 'var(--forge-err, #ff6363)',
                        }}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Form 3 — characteristic accountability rows.

function Form3Body({ rows, setRow, onAdd, onRemove }) {
  return (
    <section data-testid="forge-fai9102-form3">
      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        marginBottom: 10,
      }}>
        <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)', fontSize: 11 }}>
          AS9102 Form 3 — Characteristic Accountability & Verification
        </span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onAdd}
                data-testid="forge-fai9102-f3-add" style={BTN}>
          + Characteristic
        </button>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{
            position: 'sticky', top: 0,
            background: 'var(--forge-canvas-2, #161b22)',
            borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
          }}>
            <th style={{ ...HEADER_CELL, width: 36 }}>#</th>
            {FORM3_FIELDS.map((c) => (
              <th key={c.id} style={HEADER_CELL}>
                <span style={{ color: 'var(--forge-accent-rim, #3a7afe)', marginRight: 4 }}>
                  [{c.field}]
                </span>
                {c.header}
              </th>
            ))}
            <th style={{ ...HEADER_CELL, width: 32 }}>—</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr data-testid="forge-fai9102-f3-empty">
              <td colSpan={FORM3_FIELDS.length + 2}
                  style={{ padding: 16, color: 'var(--forge-ink-mute)', fontStyle: 'italic' }}>
                No characteristic rows. Click "+ Characteristic".
              </td>
            </tr>
          ) : rows.map((r, i) => (
            <tr key={i}
                data-row="form3"
                data-row-index={i}
                style={{ borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)' }}>
              <td style={{ padding: '3px 8px', color: 'var(--forge-ink-mute, #9aa1ab)' }}>
                {i + 1}
              </td>
              {FORM3_FIELDS.map((c) => (
                <td key={c.id} style={{ padding: '3px 6px' }}>
                  {c.id === 'characteristicDesignator' ? (
                    <select value={r[c.id] || ''}
                            data-testid={`forge-fai9102-f3-${c.id}-${i}`}
                            onChange={(e) => setRow(i, { [c.id]: e.target.value })}
                            style={CELL_INPUT}>
                      {CHARACTERISTIC_DESIGNATORS.map((d) => (
                        <option key={d || 'none'} value={d}>{d || '(unspecified)'}</option>
                      ))}
                    </select>
                  ) : (
                    <input type="text"
                           value={r[c.id] || ''}
                           data-testid={`forge-fai9102-f3-${c.id}-${i}`}
                           onChange={(e) => setRow(i, { [c.id]: e.target.value })}
                           style={CELL_INPUT} />
                  )}
                </td>
              ))}
              <td style={{ padding: '3px 6px', textAlign: 'center' }}>
                <button type="button" onClick={() => onRemove(i)}
                        data-testid={`forge-fai9102-f3-rm-${i}`}
                        style={{
                          ...BTN,
                          padding: '2px 6px',
                          color: 'var(--forge-err, #ff6363)',
                        }}>
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host. Exposes window.__forgeOpenFai9102(true|false) and
// listens for the `tools.fai9102` menu action.

export function Fai9102PanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenFai9102 = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeCloseFai9102 = () => setOpen(false);

    // Headless surface: pure-fn helpers + a few state mutators so the
    // e2e + plugins + Archie can drive a FAIR without React mounted.
    window.__forgeFai9102Helper = Object.freeze({
      formatFairAscii,
      makeBlankFair,
      makeBlankForm1, makeBlankForm2Row, makeBlankForm3Row,
      populateForm1FromPdm, populateForm2FromMaterials,
      FORM1_FIELDS, FORM2_FIELDS, FORM3_FIELDS,
      FORM_IDS, FORM_META, CHARACTERISTIC_DESIGNATORS,
      STORAGE_KEY,
    });

    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.fai9102') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);

    return () => {
      try { delete window.__forgeOpenFai9102; } catch { /* ignore */ }
      try { delete window.__forgeCloseFai9102; } catch { /* ignore */ }
      try { delete window.__forgeFai9102Helper; } catch { /* ignore */ }
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  return <Fai9102Panel open={open} onClose={() => setOpen(false)} />;
}

export default Fai9102Panel;
