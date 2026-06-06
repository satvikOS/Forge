// PUSH-60 — Bill of Materials panel (per-body view + CSV export).
//
// Forge-102 originally shipped a partKey-grouped BOM with cost rollups.
// PUSH-60 reshapes the panel into the per-body engineering view a real
// mechanical-CAD user expects: one row per native body, an inline material
// picker on every row (shares the PUSH-58 5-material density table), live
// mass (g) computed from the real kernel volume × density, a total row
// across the bottom, and an Export CSV button that lands a real CSV file
// on disk through `forge.dialog.saveFile` + `forge.dialog.writeBlob`.
//
// Material selection is persisted across opens / re-renders on
// `window.__forgeBodyMaterials` — a Map keyed by the native body handle.
// Bodies without an entry default to steel (matches MassPropsPanel).
//
// The panel mounts itself onto document.body and exposes:
//   window.__forgeOpenBom(true|false)
//   window.__forgeCloseBom()
//   window.__forgeRefreshBom()
//
// Reads bodies via `window.__forgeBodies` so the panel works in isolation
// of ForgeShellV4 state (matches the original Forge-102 contract). The
// ForgeShellV4 'tools.bom' handler already publishes the fresh bodies
// list before calling __forgeOpenBom.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import { DENSITY_G_CC, MATERIAL_LIST } from './MassPropsPanel.jsx';

const PANEL_W = 520;

// ─────────────────────────────────────────────────────────────────────
// Material book-keeping. We persist the per-body material choice on
// `window.__forgeBodyMaterials` so the picker doesn't lose state when
// the panel closes / re-renders, and so other surfaces (e.g. the
// massprops panel) can read it back later.

function getMaterialMap() {
  if (typeof window === 'undefined') return new Map();
  if (!(window.__forgeBodyMaterials instanceof Map)) {
    window.__forgeBodyMaterials = new Map();
  }
  return window.__forgeBodyMaterials;
}

function getBodyMaterial(body) {
  const map = getMaterialMap();
  const key = bodyMaterialKey(body);
  if (key == null) return 'steel';
  return map.get(key) || 'steel';
}

function setBodyMaterial(body, material) {
  const map = getMaterialMap();
  const key = bodyMaterialKey(body);
  if (key == null) return;
  map.set(key, material);
}

function bodyMaterialKey(body) {
  if (!body) return null;
  if (typeof body.handle === 'number') return `h:${body.handle}`;
  if (body.id != null) return `id:${body.id}`;
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Per-body kernel readout. We always re-call window.forge.massProps so
// the row stays correct after a re-extrude / regen under the same id.

function massPropsFor(body) {
  if (!body || typeof body.handle !== 'number') return null;
  const fn = (typeof window !== 'undefined') ? window.forge?.massProps : null;
  if (typeof fn !== 'function') return null;
  try {
    const k = fn(body.handle);
    if (!k) return null;
    const volume = Number(k.volume ?? k.Volume ?? 0);
    const area   = Number(k.area ?? k.surface ?? k.surfaceArea ?? 0);
    if (!Number.isFinite(volume) || volume <= 0) return null;
    return { volume, area };
  } catch {
    return null;
  }
}

// Volume mm³ × density g/cc → mass g. 1 cc = 1000 mm³.
function massGrams(volumeMm3, densityGcc) {
  const v = Number(volumeMm3);
  const d = Number(densityGcc);
  if (!Number.isFinite(v) || !Number.isFinite(d)) return 0;
  return v * d * 1e-3;
}

// ─────────────────────────────────────────────────────────────────────
// CSV builder. Quotes every field, escapes embedded quotes, CRLF line
// endings so Excel + Numbers + Sheets all open cleanly.

function quoteCsv(v) {
  const s = String(v ?? '');
  return '"' + s.replace(/"/g, '""') + '"';
}

export function buildBomCSV(rows) {
  const cols = [
    'name', 'qty', 'material', 'volume_mm3', 'density_g_cc',
    'mass_g',
  ];
  const lines = [cols.map(quoteCsv).join(',')];
  let totalMass = 0;
  let totalQty = 0;
  for (const r of rows || []) {
    lines.push([
      r.name,
      r.qty,
      r.material,
      Number(r.volume_mm3).toFixed(3),
      Number(r.density_g_cc).toFixed(3),
      Number(r.mass_g).toFixed(3),
    ].map(quoteCsv).join(','));
    totalMass += Number(r.mass_g) || 0;
    totalQty  += Number(r.qty) || 0;
  }
  lines.push('');
  lines.push([
    'TOTAL',
    totalQty,
    '',
    '',
    '',
    totalMass.toFixed(3),
  ].map(quoteCsv).join(','));
  return lines.join('\r\n');
}

// ─────────────────────────────────────────────────────────────────────
// Per-body row computation. One row per native body with a handle.

function buildRows(bodies) {
  const out = [];
  for (const b of bodies || []) {
    if (!b || b.kind !== 'native' || typeof b.handle !== 'number') continue;
    const mp = massPropsFor(b);
    const material = getBodyMaterial(b);
    const density = DENSITY_G_CC[material] ?? DENSITY_G_CC.steel;
    const volume_mm3 = mp ? mp.volume : 0;
    const mass_g = massGrams(volume_mm3, density);
    out.push({
      body: b,
      handle: b.handle,
      name: b.name || b.toolId || `handle ${b.handle}`,
      qty: 1,
      material,
      density_g_cc: density,
      volume_mm3,
      surface_mm2: mp ? mp.area : 0,
      mass_g,
    });
  }
  return out;
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

export function BomPanel({ open, onClose, bodies = [] }) {
  // Refresh tick: incremented whenever a material picker mutates the
  // shared Map so React re-renders all derived numbers. We pass the tick
  // into the useMemo dep so buildRows re-runs and pulls the fresh
  // material out of the shared Map (buildRows reads it via the closure
  // on getBodyMaterial → window.__forgeBodyMaterials).
  const [tickValue, setTickValue] = useState(0);
  const tick = useCallback(() => setTickValue((t) => t + 1), []);
  const [csvStatus, setCsvStatus] = useState(null);

  const rows = useMemo(
    () => buildRows(bodies),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bodies, open, tickValue]);

  const totals = useMemo(() => {
    let mass_g = 0, qty = 0;
    for (const r of rows) {
      mass_g += r.mass_g;
      qty    += r.qty;
    }
    return { qty, mass_g };
  }, [rows]);

  const onMaterialPick = useCallback((row, value) => {
    setBodyMaterial(row.body, value);
    tick();
  }, [tick]);

  const onExport = useCallback(async () => {
    const csv = buildBomCSV(rows);
    setCsvStatus('exporting…');
    try {
      const dialog = (typeof window !== 'undefined') ? window.forge?.dialog : null;
      if (!dialog || typeof dialog.saveFile !== 'function'
                  || typeof dialog.writeBlob !== 'function') {
        setCsvStatus('error: forge.dialog.saveFile / writeBlob unavailable');
        return;
      }
      const filepath = await dialog.saveFile({
        title: 'Export BOM CSV',
        defaultPath: `bom-${new Date().toISOString().slice(0, 10)}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (!filepath) {
        setCsvStatus('cancelled');
        return;
      }
      const bytes = new TextEncoder().encode(csv);
      const res = await dialog.writeBlob(filepath, bytes);
      if (res && res.ok) {
        try { window.__forgeLastBomPath = filepath; } catch {}
        setCsvStatus(`saved → ${filepath.split('/').pop()} (${res.bytes} B)`);
      } else {
        setCsvStatus(`error: ${res?.error || 'writeBlob failed'}`);
      }
    } catch (err) {
      setCsvStatus(`error: ${err.message || String(err)}`);
    }
  }, [rows]);

  // Auto-clear the status pill after a few seconds so it doesn't linger.
  useEffect(() => {
    if (!csvStatus) return undefined;
    const t = setTimeout(() => setCsvStatus(null), 3600);
    return () => clearTimeout(t);
  }, [csvStatus]);

  if (!open) return null;

  return createPortal(
    <aside
      role="region"
      aria-label="Bill of materials"
      data-testid="forge-bom-panel"
      style={panelStyle()}>

      <Header
        rowCount={rows.length}
        onExport={onExport}
        onClose={onClose}
        csvStatus={csvStatus}
      />

      <div style={{
        flex: 1, overflowY: 'auto',
        background: 'var(--forge-canvas, #0e1117)',
      }}>
        {rows.length === 0 ? (
          <div data-testid="forge-bom-empty" style={{
            padding: 20, fontStyle: 'italic',
            color: 'var(--forge-ink-mute, #9aa1ab)', fontSize: 11,
          }}>
            No native bodies in the scene. Add a body via the standard
            parts library or any modelling workbench, then re-open the
            BOM panel.
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
                <th style={HEADER_CELL}>Name</th>
                <th style={{ ...HEADER_CELL, textAlign: 'right' }}>Qty</th>
                <th style={HEADER_CELL}>Material</th>
                <th style={{ ...HEADER_CELL, textAlign: 'right' }}>Volume (mm³)</th>
                <th style={{ ...HEADER_CELL, textAlign: 'right' }}>Density (g/cc)</th>
                <th style={{ ...HEADER_CELL, textAlign: 'right' }}>Mass (g)</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Row
                  key={`${r.handle}`}
                  r={r}
                  onMaterialPick={onMaterialPick}
                />
              ))}
            </tbody>
            <tfoot>
              <tr data-testid="forge-bom-totals"
                  style={{
                    borderTop: '2px solid var(--forge-accent-rim, #3a7afe)',
                    background: 'var(--forge-canvas-2, #161b22)',
                    color: 'var(--forge-ink, #dadde2)',
                    fontWeight: 700,
                  }}>
                <td style={CELL}>TOTAL</td>
                <td style={CELL_RIGHT} data-testid="forge-bom-total-qty">
                  {totals.qty}
                </td>
                <td style={CELL}>—</td>
                <td style={CELL_RIGHT}>—</td>
                <td style={CELL_RIGHT}>—</td>
                <td style={{ ...CELL_RIGHT, fontWeight: 700 }}
                    data-testid="forge-bom-total-mass">
                  {totals.mass_g.toFixed(3)} g
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

function Header({ rowCount, onExport, onClose, csvStatus }) {
  return (
    <header style={{
      display: 'flex', flexDirection: 'column',
      borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
      background: 'var(--forge-canvas, #0e1117)',
      flexShrink: 0,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center',
        gap: 8,
        padding: '10px 12px',
      }}>
        <Icon name="wb.mech" size={14} />
        <span style={{ fontSize: 12, fontWeight: 600 }}>
          Bill of Materials
        </span>
        <span data-testid="forge-bom-row-count" style={{
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          padding: '1px 6px', borderRadius: 'var(--forge-radius-pill, 10px)',
          border: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
          {rowCount}
        </span>
        <span style={{ flex: 1 }} />
        <button
          type="button"
          onClick={onExport}
          data-testid="forge-bom-export-csv"
          style={{
            background: 'var(--forge-accent-mute, #1f3a72)',
            border: '1px solid var(--forge-accent-rim, #3a7afe)',
            borderRadius: 3,
            color: 'var(--forge-ink, #dadde2)',
            font: 'inherit', fontSize: 11,
            padding: '4px 10px',
            cursor: 'pointer',
          }}>
          Export CSV…
        </button>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close BOM panel"
          data-testid="forge-bom-close"
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
        }} data-testid="forge-bom-csv-status">
          {csvStatus}
        </div>
      )}
    </header>
  );
}

function Row({ r, onMaterialPick }) {
  return (
    <tr data-testid="forge-bom-row"
        data-handle={r.handle}
        data-material={r.material}
        style={{
          borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
      <td style={CELL} data-testid="forge-bom-row-name">{r.name}</td>
      <td style={CELL_RIGHT} data-testid="forge-bom-row-qty">{r.qty}</td>
      <td style={CELL}>
        <select
          value={r.material}
          onChange={(e) => onMaterialPick(r, e.target.value)}
          data-testid="forge-bom-row-material"
          data-handle={r.handle}
          style={{
            background: 'var(--forge-canvas, #0e1117)',
            color: 'var(--forge-ink, #dadde2)',
            border: '1px solid var(--forge-rail-edge, #2a2d34)',
            borderRadius: 3,
            padding: '2px 4px',
            fontFamily: 'var(--forge-mono, monospace)',
            fontSize: 11,
          }}>
          {MATERIAL_LIST.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </td>
      <td style={CELL_RIGHT} data-testid="forge-bom-row-volume">
        {Number(r.volume_mm3).toFixed(3)}
      </td>
      <td style={CELL_RIGHT} data-testid="forge-bom-row-density">
        {Number(r.density_g_cc).toFixed(3)}
      </td>
      <td style={{ ...CELL_RIGHT, fontWeight: 600 }}
          data-testid="forge-bom-row-mass">
        {Number(r.mass_g).toFixed(3)}
      </td>
    </tr>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Self-mounting host. Exposes window.__forgeOpenBom(true|false).

export function BomPanelHost() {
  const [open, setOpen] = useState(false);
  const [bodies, setBodies] = useState(() => readBodies());
  const mounted = useRef(false);

  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenBom = (v) => {
      setBodies(readBodies());
      setOpen(v === undefined ? true : !!v);
    };
    window.__forgeCloseBom = () => setOpen(false);
    window.__forgeRefreshBom = () => setBodies(readBodies());
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.bom') {
        setBodies(readBodies());
        setOpen(true);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      try { delete window.__forgeOpenBom; } catch {}
      try { delete window.__forgeCloseBom; } catch {}
      try { delete window.__forgeRefreshBom; } catch {}
      window.removeEventListener('forge:menu-action', onMenu);
    };
  }, []);

  if (typeof document === 'undefined') return null;
  return (
    <BomPanel
      open={open}
      onClose={() => setOpen(false)}
      bodies={bodies} />
  );
}

function readBodies() {
  if (typeof window === 'undefined') return [];
  return Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
}

export default BomPanel;
