// PUSH-178 (Slice-134) — Weldment cutlist generator panel.
//
// Real-world fabrication workflow: tag a stack of structural sections
// (square tube, rectangular tube, angle, channel) sitting in the scene,
// classify each by its AABB, group identical (section, length) pairs,
// and hand a saw operator a cut list spreadsheet.
//
// What this panel does:
//   * Scan button → reads `window.__forgeBodies` and runs the pure
//     pipeline in cutlistMath.js (classify + groupByLengthAndSection).
//   * Cutlist table — section · qty · length · total length, with a
//     totals row at the bottom.
//   * CSV export — same forge.dialog.saveFile / writeBlob path the BOM
//     panels use.
//
// Hard constraints (PUSH-178 brief):
//   * NO new npm / C++ / external deps.
//   * Real impl — no MVP, no stub, no placeholder.
//   * AABB → classification is a pure function (cutlistMath.js) so the
//     e2e + Archie / plugins can drive grouping headlessly.
//
// Reachable via:
//   * `tools.weldmentCutlist` menu action,
//   * `window.__forgeOpenWeldmentCutlist(true|false)`,
//   * `window.__forgeWeldmentCutlistHelper.{classify,groupByLengthAndSection,...}`
//     for headless callers.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import cutlistMath, {
  classify,
  bodyAABB,
  groupByLengthAndSection,
  totalsFor,
  exportCutlistCsv,
  SECTION_KINDS,
  MIN_LENGTH_RATIO,
  LENGTH_QUANT_MM,
  SECTION_QUANT_MM,
} from './cutlistMath.js';

const PANEL_W = 620;

// ─────────────────────────────────────────────────────────────────────
// Snapshot helpers.

export function readBodiesSnapshot() {
  if (typeof window === 'undefined') return [];
  const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  return all.filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────
// Styles.

function panelStyle() {
  return {
    position: 'fixed',
    top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
    right: 0,
    width: PANEL_W,
    maxWidth: '96vw',
    height: 'calc(100vh - var(--forge-topbar-h, 40px) - var(--forge-qat-h, 32px) - var(--forge-cmdbar-h, 24px))',
    background: 'var(--forge-canvas-2, #161b22)',
    borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
    boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
    display: 'flex', flexDirection: 'column',
    fontSize: 12,
    color: 'var(--forge-ink, #dadde2)',
    zIndex: 1296,
  };
}

const HEADER_CELL = {
  padding: '6px 8px',
  textAlign: 'left',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  fontSize: 10,
  color: 'var(--forge-ink-mute, #9aa1ab)',
};

const CELL = {
  padding: '4px 8px',
  fontFamily: 'var(--forge-mono, ui-monospace, SF Mono, Menlo, monospace)',
  fontSize: 11,
  textAlign: 'left',
};
const CELL_RIGHT = { ...CELL, textAlign: 'right' };

// ─────────────────────────────────────────────────────────────────────
// Panel.

export function WeldmentCutlistPanel({ open, onClose, bodies = [] }) {
  const [csvStatus, setCsvStatus] = useState(null);
  const [liveBodies, setLiveBodies] = useState(() => bodies);
  const [scanned, setScanned] = useState(false);
  const [scanTick, setScanTick] = useState(0);

  // Resnapshot the bodies prop into local state when (a) the panel opens
  // with a fresh list, or (b) someone hits Scan / Refresh.
  useEffect(() => {
    setLiveBodies(bodies);
  }, [bodies]);

  const result = useMemo(() => {
    if (!scanned) return { rows: [], skipped: [] };
    return groupByLengthAndSection(liveBodies);
  }, [liveBodies, scanned, scanTick]);

  const rows = result.rows;
  const skipped = result.skipped;
  const totals = useMemo(() => totalsFor(rows), [rows]);

  // Publish for headless callers + the e2e spec.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeWeldmentCutlistRows = rows;
    window.__forgeWeldmentCutlistTotals = totals;
    window.__forgeWeldmentCutlistSkipped = skipped;
  }, [rows, totals, skipped]);

  const onScan = useCallback(() => {
    setLiveBodies(readBodiesSnapshot());
    setScanned(true);
    setScanTick((t) => t + 1);
  }, []);

  const onExport = useCallback(async () => {
    const csv = exportCutlistCsv(rows);
    setCsvStatus('exporting…');
    try {
      const dialog = (typeof window !== 'undefined') ? window.forge?.dialog : null;
      if (!dialog || typeof dialog.saveFile !== 'function'
                  || typeof dialog.writeBlob !== 'function') {
        setCsvStatus('error: forge.dialog.saveFile / writeBlob unavailable');
        return;
      }
      const stamp = new Date().toISOString().slice(0, 10);
      const filepath = await dialog.saveFile({
        title: 'Export Weldment Cutlist CSV',
        defaultPath: `weldment-cutlist-${stamp}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (!filepath) {
        setCsvStatus('cancelled');
        return;
      }
      const bytes = new TextEncoder().encode(csv);
      const res = await dialog.writeBlob(filepath, bytes);
      if (res && res.ok) {
        try { window.__forgeLastWeldmentCutlistPath = filepath; } catch {}
        try { window.__forgeLastWeldmentCutlistCsv  = csv; } catch {}
        setCsvStatus(`saved → ${filepath.split('/').pop()} (${res.bytes} B)`);
      } else {
        setCsvStatus(`error: ${res?.error || 'writeBlob failed'}`);
      }
    } catch (err) {
      setCsvStatus(`error: ${err.message || String(err)}`);
    }
  }, [rows]);

  // Auto-clear the status pill after a few seconds.
  useEffect(() => {
    if (!csvStatus) return undefined;
    const t = setTimeout(() => setCsvStatus(null), 3600);
    return () => clearTimeout(t);
  }, [csvStatus]);

  if (!open) return null;

  return createPortal(
    <aside
      role="region"
      aria-label="Weldment cutlist generator"
      data-testid="forge-cutlist-panel"
      data-scanned={scanned ? '1' : '0'}
      data-row-count={rows.length}
      style={panelStyle()}>

      <Header
        rowCount={rows.length}
        bodyCount={liveBodies.length}
        skippedCount={skipped.length}
        scanned={scanned}
        onScan={onScan}
        onExport={onExport}
        onClose={onClose}
        csvStatus={csvStatus}
      />

      <div style={{
        flex: 1, overflowY: 'auto',
        background: 'var(--forge-canvas, #0e1117)',
      }}>
        {!scanned ? (
          <div data-testid="forge-cutlist-prompt" style={{
            padding: 20, fontStyle: 'italic',
            color: 'var(--forge-ink-mute, #9aa1ab)', fontSize: 11,
          }}>
            Click <strong>Scan scene</strong> to classify every prismatic
            body in <code>window.__forgeBodies</code> and emit a cutlist
            of square / rectangular / angle / channel sections grouped
            by (section, length).
            <div style={{ marginTop: 10, fontSize: 10 }}>
              Threshold: length / mid-dim ≥ {MIN_LENGTH_RATIO} ·
              section quantised to {SECTION_QUANT_MM} mm ·
              length quantised to {LENGTH_QUANT_MM} mm.
            </div>
          </div>
        ) : rows.length === 0 ? (
          <div data-testid="forge-cutlist-empty" style={{
            padding: 20, fontStyle: 'italic',
            color: 'var(--forge-ink-mute, #9aa1ab)', fontSize: 11,
          }}>
            No prismatic bodies found. The scene has {liveBodies.length} body
            {liveBodies.length === 1 ? '' : 'ies'}, but none have a
            length/mid-dim ratio ≥ {MIN_LENGTH_RATIO}.
          </div>
        ) : (
          <table style={{
            width: '100%', borderCollapse: 'collapse',
          }}>
            <thead>
              <tr style={{
                position: 'sticky', top: 0,
                background: 'var(--forge-canvas-2, #161b22)',
                borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
                <th style={HEADER_CELL}>Section</th>
                <th style={{ ...HEADER_CELL, textAlign: 'right' }}>Qty</th>
                <th style={{ ...HEADER_CELL, textAlign: 'right' }}>Length (mm)</th>
                <th style={{ ...HEADER_CELL, textAlign: 'right' }}>Total length (mm)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.key} r={r} />
              ))}
            </tbody>
            <tfoot>
              <tr data-testid="forge-cutlist-totals"
                  style={{
                    borderTop: '2px solid var(--forge-accent-rim, #3a7afe)',
                    background: 'var(--forge-canvas-2, #161b22)',
                    color: 'var(--forge-ink, #dadde2)',
                    fontWeight: 700,
                  }}>
                <td style={CELL}>TOTAL · cuts</td>
                <td style={CELL_RIGHT} data-testid="forge-cutlist-total-qty">
                  {totals.qty}
                </td>
                <td style={CELL_RIGHT}>—</td>
                <td style={{ ...CELL_RIGHT, fontWeight: 700 }}
                    data-testid="forge-cutlist-total-length">
                  {Number(totals.totalLength).toFixed(0)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
        {scanned && skipped.length > 0 && (
          <div data-testid="forge-cutlist-skipped" style={{
            padding: '8px 12px',
            fontSize: 10,
            color: 'var(--forge-ink-mute, #9aa1ab)',
            fontFamily: 'var(--forge-mono, monospace)',
            borderTop: '1px dashed var(--forge-rail-edge, #2a2d34)',
          }}>
            Skipped {skipped.length} non-prismatic
            {skipped.length === 1 ? ' body' : ' bodies'}:
            {skipped.slice(0, 6).map((s, i) => (
              <span key={i} style={{ marginLeft: 6 }}>
                {(s.body?.name || s.body?.id || 'body')} ({s.reason})
              </span>
            ))}
            {skipped.length > 6 && <span style={{ marginLeft: 6 }}>…</span>}
          </div>
        )}
      </div>
    </aside>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────

function Header({
  rowCount, bodyCount, skippedCount, scanned,
  onScan, onExport, onClose, csvStatus,
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
        <Icon name="wb.weldments" size={14} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>
          Weldment Cutlist
        </span>
        <span data-testid="forge-cutlist-row-count"
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                padding: '1px 6px', borderRadius: 'var(--forge-radius-pill, 10px)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
          {scanned
            ? `${rowCount} cut${rowCount === 1 ? '' : 's'} · ${bodyCount} bodies`
              + (skippedCount > 0 ? ` · ${skippedCount} skipped` : '')
            : `${bodyCount} bodies (not scanned)`}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onScan}
                data-testid="forge-cutlist-scan"
                style={btnStyle('primary')}>
          {scanned ? 'Rescan scene' : 'Scan scene'}
        </button>
        <button type="button"
                onClick={onExport}
                disabled={!scanned || rowCount === 0}
                data-testid="forge-cutlist-export-csv"
                style={{
                  ...btnStyle(),
                  opacity: (scanned && rowCount > 0) ? 1 : 0.4,
                  cursor: (scanned && rowCount > 0) ? 'pointer' : 'not-allowed',
                }}>
          Export CSV…
        </button>
        <button type="button"
                onClick={onClose}
                aria-label="Close Weldment Cutlist panel"
                data-testid="forge-cutlist-close"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--forge-ink-mute, #9aa1ab)', cursor: 'pointer',
                  display: 'inline-flex', padding: 2,
                }}>
          ×
        </button>
      </div>

      {csvStatus && (
        <div style={{
          padding: '0 12px 8px',
          fontSize: 10,
          fontFamily: 'var(--forge-mono, monospace)',
          color: csvStatus.startsWith('error')
            ? 'var(--forge-err, #ff6363)'
            : 'var(--forge-ok, #4caf50)',
        }} data-testid="forge-cutlist-csv-status">
          {csvStatus}
        </div>
      )}
    </header>
  );
}

function btnStyle(variant) {
  if (variant === 'primary') {
    return {
      background: 'var(--forge-accent-mute, #1f3a72)',
      border: '1px solid var(--forge-accent-rim, #3a7afe)',
      borderRadius: 3,
      color: 'var(--forge-ink, #dadde2)',
      font: 'inherit', fontSize: 11,
      padding: '4px 10px',
      cursor: 'pointer',
    };
  }
  return {
    background: 'var(--forge-canvas, #0e1117)',
    border: '1px solid var(--forge-rail-edge, #2a2d34)',
    borderRadius: 3,
    color: 'var(--forge-ink, #dadde2)',
    font: 'inherit', fontSize: 11,
    padding: '4px 10px',
    cursor: 'pointer',
  };
}

function Row({ r }) {
  return (
    <tr data-testid="forge-cutlist-row"
        data-key={r.key}
        data-section={r.sectionLabel}
        data-kind={r.kind}
        data-a={r.a}
        data-b={r.b}
        data-length={r.length}
        data-qty={r.qty}
        data-total-length={r.totalLength}
        style={{
          borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
      <td style={CELL} data-testid="forge-cutlist-row-section">
        {r.sectionLabel}
      </td>
      <td style={CELL_RIGHT} data-testid="forge-cutlist-row-qty">{r.qty}</td>
      <td style={CELL_RIGHT} data-testid="forge-cutlist-row-length">
        {Number(r.length).toFixed(0)}
      </td>
      <td style={{ ...CELL_RIGHT, fontWeight: 600 }}
          data-testid="forge-cutlist-row-total-length">
        {Number(r.totalLength).toFixed(0)}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host. Exposes window.__forgeOpenWeldmentCutlist(true|false)
// and listens for the `tools.weldmentCutlist` menu action so the menu
// dispatch reaches the panel without ForgeShellV4 needing a new case.

export function WeldmentCutlistPanelHost() {
  const [open, setOpen] = useState(false);
  const [bodies, setBodies] = useState(() => readBodiesSnapshot());
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenWeldmentCutlist = (v) => {
      setBodies(readBodiesSnapshot());
      setOpen(v === undefined ? true : !!v);
    };
    window.__forgeCloseWeldmentCutlist = () => setOpen(false);
    window.__forgeRefreshWeldmentCutlist = () => setBodies(readBodiesSnapshot());

    // Headless helper surface so the e2e + Archie / plugins can drive
    // the pipeline without mounting React.
    window.__forgeWeldmentCutlistHelper = Object.freeze({
      classify,
      bodyAABB,
      groupByLengthAndSection,
      totalsFor,
      exportCutlistCsv,
      readBodiesSnapshot,
      cutlistMath,
      SECTION_KINDS,
      MIN_LENGTH_RATIO,
      LENGTH_QUANT_MM,
      SECTION_QUANT_MM,
    });

    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.weldmentCutlist') {
        setBodies(readBodiesSnapshot());
        setOpen(true);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenWeldmentCutlist; } catch {}
      try { delete window.__forgeCloseWeldmentCutlist; } catch {}
      try { delete window.__forgeRefreshWeldmentCutlist; } catch {}
      try { delete window.__forgeWeldmentCutlistHelper; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return (
    <WeldmentCutlistPanel
      open={open}
      onClose={() => setOpen(false)}
      bodies={bodies} />
  );
}

export default WeldmentCutlistPanel;
