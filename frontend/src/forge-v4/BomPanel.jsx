// Forge-102 — BOM panel.
//
// A dedicated 420 px right-anchored drawer that surfaces the aggregated
// BOM as a sortable table:
//   - Group-by toggle (material | name | spec)
//   - Sortable qty / mass / cost columns (click headers)
//   - Totals row pinned at the bottom
//   - Export-CSV button — calls window.forge.dialog.saveFile
//
// Mounts itself onto document.body and exposes:
//   window.__forgeOpenBom(true|false)
//
// ForgeShellV4.jsx + Toolbar.jsx are off-limits this slice — the host
// reads bodies via `window.__forgeBodies` and instances via the
// assemblyHierarchy module so the panel works in isolation.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import { listInstances } from './assemblyHierarchy.js';
import {
  aggregateBOM, exportCSV, totalsFor, MATERIAL_COSTS_PER_KG,
} from './bomAggregator.js';

const PANEL_W = 420;

function panelStyle() {
  return {
    position: 'fixed',
    top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
    right: 0,
    width: PANEL_W,
    maxWidth: '96vw',
    height: 'calc(100vh - var(--forge-topbar-h) - var(--forge-qat-h) - var(--forge-cmdbar-h))',
    background: 'var(--forge-canvas-2)',
    borderLeft: '1px solid var(--forge-rail-edge)',
    boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
    display: 'flex', flexDirection: 'column',
    fontSize: 12,
    color: 'var(--forge-ink)',
    zIndex: 1296,
  };
}

const HEADER_BTN = {
  background: 'transparent',
  border: 'none',
  color: 'var(--forge-ink-mute)',
  cursor: 'pointer',
  font: 'inherit',
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  padding: '6px 6px',
  textAlign: 'left',
};

// ─────────────────────────────────────────────────────────────────────

export function BomPanel({
  open,
  onClose,
  bodies = [],
  instances = null,
}) {
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState('asc');
  const [groupBy, setGroupBy] = useState('none'); // 'none' | 'material' | 'name' | 'spec'
  const [csvStatus, setCsvStatus] = useState(null);

  const rows = useMemo(
    () => aggregateBOM(bodies, instances),
    [bodies, instances]);

  const sorted = useMemo(() => {
    const out = rows.slice();
    out.sort((a, b) => compareRow(a, b, sortKey, sortDir));
    return out;
  }, [rows, sortKey, sortDir]);

  const grouped = useMemo(() => groupRows(sorted, groupBy), [sorted, groupBy]);
  const totals = useMemo(() => totalsFor(rows), [rows]);

  const handleSort = (key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const handleExport = useCallback(async () => {
    const csv = exportCSV(rows);
    setCsvStatus('exporting…');
    try {
      const fn = window?.forge?.dialog?.saveFile;
      if (typeof fn === 'function') {
        const result = await fn({
          defaultPath: `bom-${new Date().toISOString().slice(0, 10)}.csv`,
          filters: [{ name: 'CSV', extensions: ['csv'] }],
          data: csv,
          mime: 'text/csv',
        });
        if (result && result.path) {
          setCsvStatus(`saved → ${result.path}`);
        } else if (result === false) {
          setCsvStatus('cancelled');
        } else {
          setCsvStatus('saved');
        }
      } else {
        // Browser fallback — Blob URL + anchor click.
        const blob = new Blob([csv], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `bom-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        setCsvStatus('downloaded');
      }
    } catch (err) {
      setCsvStatus(`error: ${err.message || String(err)}`);
    } finally {
      setTimeout(() => setCsvStatus(null), 2400);
    }
  }, [rows]);

  if (!open) return null;

  return createPortal(
    <aside
      role="region"
      aria-label="Bill of materials"
      data-testid="forge-bom-panel"
      style={panelStyle()}>

      <Header
        onClose={onClose}
        rowCount={rows.length}
        groupBy={groupBy}
        setGroupBy={setGroupBy}
        onExport={handleExport}
        csvStatus={csvStatus}
      />

      <div style={{
        flex: 1, overflowY: 'auto',
        background: 'var(--forge-canvas)',
      }}>
        {rows.length === 0 ? (
          <div style={{
            padding: 20, fontStyle: 'italic',
            color: 'var(--forge-ink-mute)', fontSize: 11,
          }}>
            Bill of materials is empty. Insert bodies via the standard
            parts library, then place instances via the assembly tree.
          </div>
        ) : (
          <table style={{
            width: '100%', borderCollapse: 'collapse',
            fontSize: 11,
            fontFamily: 'var(--forge-mono)',
          }}>
            <thead>
              <tr style={{
                position: 'sticky', top: 0,
                background: 'var(--forge-canvas-2)',
                borderBottom: '1px solid var(--forge-rail-edge)',
                color: 'var(--forge-ink-mute)',
              }}>
                <SortHdr label="Part" sk="name" cur={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHdr label="Material" sk="material" cur={sortKey} dir={sortDir} onSort={handleSort} />
                <SortHdr label="Qty" sk="qty" cur={sortKey} dir={sortDir} onSort={handleSort}
                         align="right" />
                <SortHdr label="g/ea" sk="mass_g_each" cur={sortKey} dir={sortDir} onSort={handleSort}
                         align="right" />
                <SortHdr label="g total" sk="mass_g_total" cur={sortKey} dir={sortDir} onSort={handleSort}
                         align="right" />
                <SortHdr label="$ ea" sk="cost_each" cur={sortKey} dir={sortDir} onSort={handleSort}
                         align="right" />
                <SortHdr label="$ total" sk="cost_total" cur={sortKey} dir={sortDir} onSort={handleSort}
                         align="right" />
              </tr>
            </thead>
            <tbody>
              {grouped.flatMap(({ key, rows: rs }) => {
                const groupHeader = groupBy === 'none' ? null : (
                  <tr key={`g-${key}`}
                      data-testid="forge-bom-group"
                      data-group-key={key}>
                    <td colSpan={7} style={{
                      padding: '6px 8px',
                      background: 'var(--forge-surface-2)',
                      color: 'var(--forge-ink-2)',
                      fontWeight: 600,
                      borderBottom: '1px solid var(--forge-rail-edge)',
                      fontSize: 10,
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                    }}>
                      {key || '(none)'}
                      <span style={{
                        marginLeft: 6, color: 'var(--forge-ink-mute)',
                        fontWeight: 400,
                      }}>
                        {rs.length} part{rs.length === 1 ? '' : 's'}
                      </span>
                    </td>
                  </tr>
                );
                return [groupHeader, ...rs.map((r) => (
                  <Row key={r.partKey} r={r} />
                ))].filter(Boolean);
              })}
            </tbody>
            <tfoot>
              <tr data-testid="forge-bom-totals"
                  style={{
                    borderTop: '2px solid var(--forge-accent-rim)',
                    background: 'var(--forge-canvas-2)',
                    color: 'var(--forge-ink)',
                    fontWeight: 600,
                  }}>
                <td style={{ padding: '8px' }}>TOTAL</td>
                <td style={{ padding: '8px',
                             color: 'var(--forge-ink-mute)' }}>
                  {rows.length} parts
                </td>
                <td style={cellRight}>{totals.qty}</td>
                <td style={cellRight}>—</td>
                <td style={cellRight}>{totals.mass_g.toFixed(1)} g</td>
                <td style={cellRight}>—</td>
                <td style={{ ...cellRight, color: 'var(--forge-accent)' }}>
                  ${totals.cost.toFixed(2)}
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

function Header({ onClose, rowCount, groupBy, setGroupBy, onExport, csvStatus }) {
  return (
    <header style={{
      display: 'flex', flexDirection: 'column',
      borderBottom: '1px solid var(--forge-rail-edge)',
      background: 'var(--forge-canvas)',
      flexShrink: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        gap: 'var(--forge-space-2)',
        padding: 'var(--forge-space-3) var(--forge-space-4)',
      }}>
        <Icon name="wb.mech" size={14} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>
          Bill of Materials
        </span>
        <span style={{
          fontFamily: 'var(--forge-mono)', fontSize: 10,
          color: 'var(--forge-ink-mute)',
          padding: '1px 6px', borderRadius: 'var(--forge-radius-pill)',
          border: '1px solid var(--forge-rail-edge)',
        }}>
          {rowCount}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={onExport}
                data-testid="forge-bom-export-csv"
                style={{
                  background: 'var(--forge-accent-mute)',
                  border: '1px solid var(--forge-accent-rim)',
                  borderRadius: 3,
                  color: 'var(--forge-ink)',
                  font: 'inherit', fontSize: 11,
                  padding: '4px 10px',
                  cursor: 'pointer',
                }}>
          Export CSV
        </button>
        <button type="button"
                onClick={onClose}
                aria-label="Close BOM panel"
                data-testid="forge-bom-close"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'var(--forge-ink-mute)', cursor: 'pointer',
                  display: 'inline-flex', padding: 2,
                }}>
          <Icon name="select.clear" size={12} />
        </button>
      </div>

      <div style={{
        display: 'flex', alignItems: 'center', gap: 4,
        padding: '0 var(--forge-space-4) var(--forge-space-2)',
        fontSize: 10, color: 'var(--forge-ink-mute)',
      }}>
        <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Group by
        </span>
        {['none', 'material', 'name', 'spec'].map((g) => (
          <button key={g}
                  type="button"
                  onClick={() => setGroupBy(g)}
                  data-testid={`forge-bom-group-${g}`}
                  data-active={String(groupBy === g)}
                  style={{
                    background: groupBy === g
                      ? 'var(--forge-accent-mute)'
                      : 'transparent',
                    border: '1px solid '
                      + (groupBy === g ? 'var(--forge-accent-rim)' : 'var(--forge-rail-edge)'),
                    borderRadius: 2,
                    color: 'var(--forge-ink)',
                    fontSize: 10,
                    padding: '2px 6px',
                    cursor: 'pointer',
                  }}>
            {g}
          </button>
        ))}
        <span style={{ flex: 1 }} />
        {csvStatus && (
          <span data-testid="forge-bom-csv-status"
                style={{
                  fontFamily: 'var(--forge-mono)',
                  color: csvStatus.startsWith('error')
                    ? 'var(--forge-err)'
                    : 'var(--forge-ok)',
                }}>
            {csvStatus}
          </span>
        )}
      </div>
    </header>
  );
}

function SortHdr({ label, sk, cur, dir, onSort, align }) {
  const active = sk === cur;
  return (
    <th style={{
      padding: 0,
      textAlign: align || 'left',
      width: align === 'right' ? '12%' : undefined,
    }}>
      <button type="button"
              onClick={() => onSort(sk)}
              data-testid={`forge-bom-sort-${sk}`}
              data-active={String(active)}
              style={{
                ...HEADER_BTN,
                width: '100%',
                textAlign: align || 'left',
                color: active ? 'var(--forge-ink)' : 'var(--forge-ink-mute)',
              }}>
        {label}
        {active && (
          <span style={{ marginLeft: 3 }}>{dir === 'asc' ? '▲' : '▼'}</span>
        )}
      </button>
    </th>
  );
}

const cellRight = {
  padding: '4px 8px',
  textAlign: 'right',
  fontFamily: 'var(--forge-mono)',
};
const cellLeft = {
  padding: '4px 8px',
  textAlign: 'left',
  color: 'var(--forge-ink)',
};

function Row({ r }) {
  const costPerKg = MATERIAL_COSTS_PER_KG[r.material] ?? MATERIAL_COSTS_PER_KG.unknown;
  return (
    <tr data-testid="forge-bom-row"
        data-part-key={r.partKey}
        data-material={r.material}
        style={{ borderBottom: '1px solid var(--forge-rail-edge)' }}>
      <td style={cellLeft}>
        <div style={{ color: 'var(--forge-ink)' }}>{r.name}</div>
        {r.spec && (
          <div style={{ color: 'var(--forge-ink-mute)', fontSize: 9 }}>
            {r.spec}
          </div>
        )}
      </td>
      <td style={cellLeft}>
        <span title={`$${costPerKg.toFixed(2)} per kg`}>{r.material}</span>
      </td>
      <td style={cellRight}>{r.qty}</td>
      <td style={cellRight}>{r.mass_g_each.toFixed(2)}</td>
      <td style={cellRight}>{r.mass_g_total.toFixed(1)}</td>
      <td style={cellRight}>${r.cost_each.toFixed(3)}</td>
      <td style={{ ...cellRight, color: 'var(--forge-accent)' }}>
        ${r.cost_total.toFixed(2)}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────

function compareRow(a, b, key, dir) {
  const sign = dir === 'desc' ? -1 : 1;
  const av = a[key], bv = b[key];
  if (typeof av === 'number' && typeof bv === 'number') {
    return sign * (av - bv);
  }
  return sign * String(av ?? '').localeCompare(String(bv ?? ''));
}

function groupRows(rows, groupBy) {
  if (groupBy === 'none') {
    return [{ key: '', rows }];
  }
  const buckets = new Map();
  for (const r of rows) {
    const key = String(r[groupBy] ?? '');
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(r);
  }
  return Array.from(buckets.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, rs]) => ({ key, rows: rs }));
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host. Exposes window.__forgeOpenBom(true|false).

export function BomPanelHost() {
  const [open, setOpen] = useState(false);
  const [bodies, setBodies] = useState(() =>
    (typeof window !== 'undefined' && Array.isArray(window.__forgeBodies))
      ? window.__forgeBodies
      : []);
  const [instances, setInstances] = useState(() => safeListInstances());
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenBom = (v) => {
      if (Array.isArray(window.__forgeBodies)) setBodies(window.__forgeBodies);
      setInstances(safeListInstances());
      setOpen(v === undefined ? true : !!v);
    };
    window.__forgeCloseBom = () => setOpen(false);
    window.__forgeRefreshBom = () => {
      if (Array.isArray(window.__forgeBodies)) setBodies([...window.__forgeBodies]);
      setInstances(safeListInstances());
    };
    return () => {
      try { delete window.__forgeOpenBom; } catch {}
      try { delete window.__forgeCloseBom; } catch {}
      try { delete window.__forgeRefreshBom; } catch {}
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return (
    <BomPanel
      open={open}
      onClose={() => setOpen(false)}
      bodies={bodies}
      instances={instances} />
  );
}

function safeListInstances() {
  try { return listInstances(); } catch { return []; }
}

export default BomPanel;
