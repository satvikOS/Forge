// PUSH-145 (Slice-105) — Industry certification traceability matrix.
//
// Real certification needs: requirements → design features → analysis
// results → verification tests → results, with full traceability. We
// ship a 5-column matrix backed by certTemplates.js (FAA Part 23,
// AS9100 Rev D, ISO 9001:2015 row sets — real clause numbers) and
// export CSV via forge.dialog.saveFile.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CERT_TEMPLATE_IDS, CERT_TEMPLATE_META, RESULT_KINDS,
  getCertTemplate, makeBlankCertRow, exportCertCsv, countByResult,
} from './certTemplates.js';

const STORAGE_KEY = 'forge.v4.certTraceability';
export const FORGE_CERT_EVENT = 'forge:cert-traceability-changed';

function loadStore() {
  if (typeof localStorage === 'undefined') return { templateId: 'AS9100_REV_D', rows: [] };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { templateId: 'AS9100_REV_D', rows: [] };
    const j = JSON.parse(raw);
    if (j && typeof j.templateId === 'string' && Array.isArray(j.rows)) return j;
  } catch {}
  return { templateId: 'AS9100_REV_D', rows: [] };
}
function saveStore(s) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)); } catch {}
}

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0, bottom: 'var(--forge-statusbar-h, 24px)',
  width: 720, zIndex: 1330,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 8,
  color: 'var(--forge-ink)', fontSize: 12, overflowY: 'auto',
};

export function CertTraceabilityPanel({ open, onClose }) {
  const [store, setStore] = useState(() => loadStore());
  const [status, setStatus] = useState('');

  const commit = useCallback((next) => {
    setStore(next);
    saveStore(next);
    try {
      window.__forgeCertTraceability = next;
      window.dispatchEvent(new CustomEvent(FORGE_CERT_EVENT, { detail: next }));
    } catch {}
  }, []);

  const loadTemplate = (templateId) => {
    const rows = getCertTemplate(templateId);
    commit({ templateId, rows });
  };
  const addBlank = () => commit({
    ...store,
    rows: [...store.rows, makeBlankCertRow(store.templateId, store.rows.length)],
  });
  const removeRow = (i) => commit({ ...store, rows: store.rows.filter((_, j) => j !== i) });
  const updateRow = (i, patch) => commit({
    ...store, rows: store.rows.map((r, j) => j === i ? { ...r, ...patch } : r),
  });

  const counts = useMemo(() => countByResult(store.rows), [store.rows]);
  const meta = CERT_TEMPLATE_META[store.templateId];

  const exportCsv = async () => {
    const csv = exportCertCsv(store.rows, { template: meta });
    const dialog = window.forge?.dialog;
    if (!dialog) { setStatus('forge.dialog unavailable'); return; }
    const fp = await dialog.saveFile({
      title: 'Save traceability matrix',
      defaultPath: `traceability-${store.templateId}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }],
    });
    if (!fp) { setStatus('canceled'); return; }
    const bytes = new TextEncoder().encode(csv);
    const res = await dialog.writeBlob(fp, bytes);
    if (res?.ok) {
      try { window.__forgeLastCertCsvPath = fp; } catch {}
      setStatus(`✓ ${res.bytes} B saved`);
    } else {
      setStatus(`✗ write failed`);
    }
  };

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-cert-traceability-panel"
         data-template-id={store.templateId}
         data-row-count={store.rows.length}>
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Cert Traceability</strong>
        <button onClick={onClose}
                data-testid="forge-cert-close"
                style={{ background: 'transparent', border: '1px solid var(--forge-rail-edge)',
                         color: 'var(--forge-ink)', cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>

      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <label>Standard:</label>
        <select value={store.templateId} data-testid="forge-cert-template"
                onChange={(e) => loadTemplate(e.target.value)}
                style={{ flex: 1 }}>
          {CERT_TEMPLATE_IDS.map((id) => (
            <option key={id} value={id}>{CERT_TEMPLATE_META[id]?.label || id}</option>
          ))}
        </select>
        <button onClick={() => loadTemplate(store.templateId)}
                data-testid="forge-cert-reload">Reload preset</button>
      </div>

      <div style={{ color: 'var(--forge-ink-mute)', fontSize: 11 }}>
        {meta?.standard} · {meta?.revision}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={addBlank} data-testid="forge-cert-add">+ Row</button>
        <button onClick={exportCsv} data-testid="forge-cert-export"
                style={{ marginLeft: 'auto', background: 'var(--forge-accent, #2c4d2a)',
                         color: '#dfeedd', border: 'none', padding: '4px 8px', borderRadius: 4 }}>
          Export CSV…
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
        <span style={{ color: '#7ec07e' }} data-testid="forge-cert-pass">Pass {counts.pass || 0}</span>
        <span style={{ color: '#ff8a8a' }} data-testid="forge-cert-fail">Fail {counts.fail || 0}</span>
        <span style={{ color: 'var(--forge-ink-mute)' }} data-testid="forge-cert-pending">
          Pending {counts.pending || 0}
        </span>
      </div>

      <section data-testid="forge-cert-rows"
               style={{ fontFamily: 'var(--forge-mono)', fontSize: 10, maxHeight: 380, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--forge-rail-edge)' }}>
              <th style={{ textAlign: 'left', padding: 3 }}>Req ID</th>
              <th style={{ textAlign: 'left', padding: 3 }}>Clause</th>
              <th style={{ textAlign: 'left', padding: 3 }}>Feature</th>
              <th style={{ textAlign: 'left', padding: 3 }}>Test</th>
              <th style={{ textAlign: 'left', padding: 3 }}>Result</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {store.rows.map((r, i) => (
              <tr key={i} data-row="cert" data-row-result={r.result}>
                <td style={{ padding: 2 }}>
                  <input value={r.id || ''} style={{ width: 100 }}
                         data-testid={`forge-cert-id-${i}`}
                         onChange={(e) => updateRow(i, { id: e.target.value })} />
                </td>
                <td style={{ padding: 2 }}>
                  <span>{r.clauseNumber || '—'}</span>
                </td>
                <td style={{ padding: 2 }}>
                  <input value={r.featureLink || ''} style={{ width: 80 }}
                         data-testid={`forge-cert-feature-${i}`}
                         onChange={(e) => updateRow(i, { featureLink: e.target.value })} />
                </td>
                <td style={{ padding: 2 }}>
                  <input value={r.testRef || ''} style={{ width: 80 }}
                         data-testid={`forge-cert-test-${i}`}
                         onChange={(e) => updateRow(i, { testRef: e.target.value })} />
                </td>
                <td style={{ padding: 2 }}>
                  <select value={r.result || 'pending'}
                          data-testid={`forge-cert-result-${i}`}
                          onChange={(e) => updateRow(i, { result: e.target.value })}>
                    {RESULT_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </td>
                <td style={{ padding: 2 }}>
                  <button onClick={() => removeRow(i)}
                          data-testid={`forge-cert-rm-${i}`}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {status && (
        <div data-testid="forge-cert-status" style={{ color: 'var(--forge-ink-mute)' }}>
          {status}
        </div>
      )}
    </div>
  );
}

export function CertTraceabilityPanelHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenCertTraceability = (b) => setOpen(b === undefined ? true : !!b);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.certTraceability') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => window.removeEventListener('forge:menu-action', onMenu);
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <CertTraceabilityPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default CertTraceabilityPanel;
