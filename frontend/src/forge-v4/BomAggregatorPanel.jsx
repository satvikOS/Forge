// PUSH-116 (Slice-85 / BOM Aggregator).
//
// PUSH-60 shipped the row-per-body BOM view. For real-world engineering
// drawings + procurement you need GROUPING — fifty M6 bolts collapse to
// one row with qty=50, every titanium part rolls under one material
// total, and the cost rollup is the sum across each group.
//
// What this panel does:
//
//   * Reads `window.__forgeBodies` at open time + on every refresh.
//   * Honours the per-body material assignment shared with PUSH-60
//     (via bodyMaterials.js) — if the user picked aluminum in the BOM
//     panel, the aggregator sees aluminum here.
//   * Group-by dropdown — Name pattern / Material / Part key. The
//     pure dispatch lives in bomAggregator.js so the e2e + plugins
//     can drive grouping headlessly.
//   * Grouped table with: Group · Qty · Material · Mass each · Mass
//     total · Cost total. Totals row at the bottom.
//   * "Export CSV…" runs the same forge.dialog.saveFile / writeBlob
//     pipeline PUSH-60 uses; lands a CSV on disk with one row per
//     group plus a TOTAL line.
//   * Refresh button re-snapshots window.__forgeBodies so a body added
//     after the panel opened still shows up.
//
// Hard constraints (PUSH-116 brief):
//   * NO new npm / C++ / external deps.
//   * Real impl, no MVP / stub / placeholder. If forge.dialog isn't
//     available we surface the real "unavailable" error verbatim.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one
//     import + one mount).
//
// Reachable via:
//   * `tools.bomAggregator` menu action,
//   * `window.__forgeOpenBomAggregator(true|false)`,
//   * `window.__forgeBomAggregatorHelper.groupBodies(bodies, mode)`
//     for headless callers.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import {
  groupBodies,
  totalsForGroups,
  exportCsv,
  computeRowMass,
  namePattern,
  GROUP_BY_MODES,
  DENSITY_TABLE,
  COST_TABLE,
} from './bomAggregator.js';
import {
  getBodyMaterial,
  FORGE_BODY_MATERIALS_EVENT,
} from './bodyMaterials.js';

const PANEL_W = 620;

// ─────────────────────────────────────────────────────────────────────
// Snapshot helpers.

export function readBodiesSnapshot() {
  if (typeof window === 'undefined') return [];
  const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
  // Decorate each body with the persisted material so the aggregator's
  // pure groupBodies() picks up the assignment the user already made
  // through MassProps / BomPanel / MaterialsBrowser.
  return all.filter(Boolean).map((b) => {
    let mat = b.material;
    if (!mat) {
      try { mat = getBodyMaterial(b); } catch { mat = 'steel'; }
    }
    return { ...b, material: mat };
  });
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
    zIndex: 1295,
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

export function BomAggregatorPanel({ open, onClose, bodies = [] }) {
  const [groupBy, setGroupBy] = useState('name');
  const [csvStatus, setCsvStatus] = useState(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [liveBodies, setLiveBodies] = useState(() => bodies);

  // Resnapshot the bodies prop into local state when (a) the panel
  // opens with a fresh list, or (b) someone hits the Refresh button.
  useEffect(() => {
    setLiveBodies(bodies);
  }, [bodies]);

  // PUSH-61 — refresh when MassProps / BomPanel / MaterialsBrowser
  // mutates a body's material so the grouping stays live.
  useEffect(() => {
    if (!open) return undefined;
    const onApplied = () => {
      setLiveBodies(readBodiesSnapshot());
      setRefreshTick((t) => t + 1);
    };
    window.addEventListener(FORGE_BODY_MATERIALS_EVENT, onApplied);
    return () => window.removeEventListener(FORGE_BODY_MATERIALS_EVENT, onApplied);
  }, [open]);

  const rows = useMemo(() => groupBodies(liveBodies, groupBy),
    [liveBodies, groupBy, refreshTick]);
  const totals = useMemo(() => totalsForGroups(rows), [rows]);

  // Publish for headless callers + the e2e spec.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeBomAggregatorRows = rows;
    window.__forgeBomAggregatorTotals = totals;
    window.__forgeBomAggregatorGroupBy = groupBy;
  }, [rows, totals, groupBy]);

  const onRefresh = useCallback(() => {
    setLiveBodies(readBodiesSnapshot());
    setRefreshTick((t) => t + 1);
  }, []);

  const groupByLabel = useMemo(() => {
    const m = GROUP_BY_MODES.find((g) => g.id === groupBy);
    return m ? m.label : groupBy;
  }, [groupBy]);

  const onExport = useCallback(async () => {
    const csv = exportCsv(rows, { groupByLabel });
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
        title: 'Export Aggregated BOM CSV',
        defaultPath: `bom-aggregated-${groupBy}-${stamp}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (!filepath) {
        setCsvStatus('cancelled');
        return;
      }
      const bytes = new TextEncoder().encode(csv);
      const res = await dialog.writeBlob(filepath, bytes);
      if (res && res.ok) {
        try { window.__forgeLastBomAggregatorPath = filepath; } catch {}
        try { window.__forgeLastBomAggregatorCsv  = csv; } catch {}
        setCsvStatus(`saved → ${filepath.split('/').pop()} (${res.bytes} B)`);
      } else {
        setCsvStatus(`error: ${res?.error || 'writeBlob failed'}`);
      }
    } catch (err) {
      setCsvStatus(`error: ${err.message || String(err)}`);
    }
  }, [rows, groupBy, groupByLabel]);

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
      aria-label="Bill of materials aggregator"
      data-testid="forge-bomagg-panel"
      data-group-by={groupBy}
      style={panelStyle()}>

      <Header
        rowCount={rows.length}
        bodyCount={liveBodies.length}
        groupBy={groupBy}
        onGroupBy={setGroupBy}
        onRefresh={onRefresh}
        onExport={onExport}
        onClose={onClose}
        csvStatus={csvStatus}
      />

      <div style={{
        flex: 1, overflowY: 'auto',
        background: 'var(--forge-canvas, #0e1117)',
      }}>
        {rows.length === 0 ? (
          <div data-testid="forge-bomagg-empty" style={{
            padding: 20, fontStyle: 'italic',
            color: 'var(--forge-ink-mute, #9aa1ab)', fontSize: 11,
          }}>
            No bodies in the scene. Add a body via the standard parts
            library or any modelling workbench, then click Refresh.
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
                <th style={HEADER_CELL}>Group</th>
                <th style={{ ...HEADER_CELL, textAlign: 'right' }}>Qty</th>
                <th style={HEADER_CELL}>Material</th>
                <th style={{ ...HEADER_CELL, textAlign: 'right' }}>Mass each (g)</th>
                <th style={{ ...HEADER_CELL, textAlign: 'right' }}>Mass total (g)</th>
                <th style={{ ...HEADER_CELL, textAlign: 'right' }}>Cost total (USD)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row key={r.groupKey} r={r} />
              ))}
            </tbody>
            <tfoot>
              <tr data-testid="forge-bomagg-totals"
                  style={{
                    borderTop: '2px solid var(--forge-accent-rim, #3a7afe)',
                    background: 'var(--forge-canvas-2, #161b22)',
                    color: 'var(--forge-ink, #dadde2)',
                    fontWeight: 700,
                  }}>
                <td style={CELL}>TOTAL · {groupByLabel}</td>
                <td style={CELL_RIGHT} data-testid="forge-bomagg-total-qty">
                  {totals.qty}
                </td>
                <td style={CELL}>—</td>
                <td style={CELL_RIGHT}>—</td>
                <td style={{ ...CELL_RIGHT, fontWeight: 700 }}
                    data-testid="forge-bomagg-total-mass">
                  {totals.mass_g.toFixed(3)}
                </td>
                <td style={{ ...CELL_RIGHT, fontWeight: 700 }}
                    data-testid="forge-bomagg-total-cost">
                  {totals.cost.toFixed(4)}
                </td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </aside>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────

function Header({
  rowCount, bodyCount, groupBy, onGroupBy,
  onRefresh, onExport, onClose, csvStatus,
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
        <Icon name="measure.mass" size={14} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>
          BOM Aggregator
        </span>
        <span data-testid="forge-bomagg-row-count"
              style={{
                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                fontSize: 10,
                color: 'var(--forge-ink-mute, #9aa1ab)',
                padding: '1px 6px', borderRadius: 'var(--forge-radius-pill, 10px)',
                border: '1px solid var(--forge-rail-edge, #2a2d34)',
              }}>
          {rowCount} group{rowCount === 1 ? '' : 's'} · {bodyCount} bodies
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onRefresh}
                data-testid="forge-bomagg-refresh"
                style={btnStyle()}>
          Refresh
        </button>
        <button type="button"
                onClick={onExport}
                data-testid="forge-bomagg-export-csv"
                style={btnStyle('primary')}>
          Export CSV…
        </button>
        <button type="button"
                onClick={onClose}
                aria-label="Close BOM Aggregator panel"
                data-testid="forge-bomagg-close"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--forge-ink-mute, #9aa1ab)', cursor: 'pointer',
                  display: 'inline-flex', padding: 2,
                }}>
          ×
        </button>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '0 12px 10px',
      }}>
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <span style={{
            fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
            textTransform: 'uppercase', letterSpacing: '0.05em',
          }}>
            Group by
          </span>
          <select value={groupBy}
                  onChange={(e) => onGroupBy(e.target.value)}
                  data-testid="forge-bomagg-group-by"
                  style={{
                    background: 'var(--forge-canvas, #0e1117)',
                    color: 'var(--forge-ink, #dadde2)',
                    border: '1px solid var(--forge-rail-edge, #2a2d34)',
                    borderRadius: 3,
                    padding: '2px 6px',
                    fontFamily: 'var(--forge-mono, monospace)',
                    fontSize: 11,
                  }}>
            {GROUP_BY_MODES.map((m) => (
              <option key={m.id} value={m.id}>{m.label}</option>
            ))}
          </select>
        </label>
      </div>

      {csvStatus && (
        <div style={{
          padding: '0 12px 8px',
          fontSize: 10,
          fontFamily: 'var(--forge-mono, monospace)',
          color: csvStatus.startsWith('error')
            ? 'var(--forge-err, #ff6363)'
            : 'var(--forge-ok, #4caf50)',
        }} data-testid="forge-bomagg-csv-status">
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
    <tr data-testid="forge-bomagg-row"
        data-group-key={r.groupKey}
        data-label={r.label}
        data-qty={r.qty}
        data-material={r.material || ''}
        data-mass-total={r.mass_g_total}
        data-cost-total={r.cost_total}
        style={{
          borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
      <td style={CELL} data-testid="forge-bomagg-row-label">{r.label}</td>
      <td style={CELL_RIGHT} data-testid="forge-bomagg-row-qty">{r.qty}</td>
      <td style={CELL} data-testid="forge-bomagg-row-material">
        {r.material || (r.groupBy === 'material' ? r.label : (r.bodies.length ? 'mixed' : '—'))}
      </td>
      <td style={CELL_RIGHT} data-testid="forge-bomagg-row-mass-each">
        {Number(r.mass_g_each).toFixed(3)}
      </td>
      <td style={{ ...CELL_RIGHT, fontWeight: 600 }}
          data-testid="forge-bomagg-row-mass-total">
        {Number(r.mass_g_total).toFixed(3)}
      </td>
      <td style={CELL_RIGHT} data-testid="forge-bomagg-row-cost-total">
        {Number(r.cost_total).toFixed(4)}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host. Exposes window.__forgeOpenBomAggregator(true|false)
// and listens for the `tools.bomAggregator` menu action so the menu
// dispatch reaches the panel without ForgeShellV4 needing a new case.

export function BomAggregatorPanelHost() {
  const [open, setOpen] = useState(false);
  const [bodies, setBodies] = useState(() => readBodiesSnapshot());
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;

    window.__forgeOpenBomAggregator = (v) => {
      setBodies(readBodiesSnapshot());
      setOpen(v === undefined ? true : !!v);
    };
    window.__forgeCloseBomAggregator = () => setOpen(false);
    window.__forgeRefreshBomAggregator = () => setBodies(readBodiesSnapshot());

    // Headless helper surface so the e2e + Archie / plugins can drive
    // the grouping pipeline without mounting React.
    window.__forgeBomAggregatorHelper = Object.freeze({
      groupBodies, totalsForGroups, exportCsv,
      computeRowMass, namePattern,
      GROUP_BY_MODES, DENSITY_TABLE, COST_TABLE,
      readBodiesSnapshot,
    });

    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.bomAggregator') {
        setBodies(readBodiesSnapshot());
        setOpen(true);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenBomAggregator; } catch {}
      try { delete window.__forgeCloseBomAggregator; } catch {}
      try { delete window.__forgeRefreshBomAggregator; } catch {}
      try { delete window.__forgeBomAggregatorHelper; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return (
    <BomAggregatorPanel
      open={open}
      onClose={() => setOpen(false)}
      bodies={bodies} />
  );
}

export default BomAggregatorPanel;
