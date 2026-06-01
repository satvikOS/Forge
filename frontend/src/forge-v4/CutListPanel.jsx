// Forge-128 — Cut-list panel.
//
// Reads the BOM-ready cut list returned by weldmentsDispatch
// (which proxies the native `forge.weldments.cutList` op when the
// kernel is wired, or assembles an identically-shaped fallback
// from the synthetic member registry).
//
// CSV export downloads via an in-page <a> + Blob URL — keeps the
// component testable inside Electron without filesystem coupling.

import React, { useMemo, useState } from 'react';
import {
  WeldmentsDispatch, cutListToCsv,
} from './weldmentsDispatch.js';

function downloadBlob(filename, mime, text) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([text], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    a.remove();
  }, 200);
}

export function CutListPanel({ members = [], theme = 'dark', onClose }) {
  const [bumpKey, setBumpKey] = useState(0);

  // Pull the cut-list every render — kernel state may have changed
  // since the last open. The dispatch returns a stable shape.
  const { rows, source, error } = useMemo(() => {
    return WeldmentsDispatch.cutList(members);
  }, [members, bumpKey]);

  const totalMass = useMemo(
    () => rows.reduce((acc, r) => acc + (r.qty * (r.weight || 0)), 0),
    [rows]);

  const onExport = () => {
    const csv = cutListToCsv(rows);
    downloadBlob('weldment-cutlist.csv', 'text/csv', csv);
  };

  return (
    <div className="forge-cutlist-panel"
         data-testid="forge-cutlist-panel"
         data-source={source}
         data-theme={theme}
         style={panelStyle(theme)}>
      <header className="forge-cutlist-head" style={headStyle}>
        <span className="forge-cutlist-title"
              data-testid="forge-cutlist-title">Cut List</span>
        <span className="forge-cutlist-source"
              data-testid="forge-cutlist-source"
              style={{ opacity: 0.65, fontSize: 11 }}>
          source: {source}{error ? ` (${error})` : ''}
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                data-tool="weld.cutlist.refresh"
                data-testid="forge-cutlist-refresh"
                onClick={() => setBumpKey((n) => n + 1)}
                style={btnStyle(theme)}>Refresh</button>
        <button type="button"
                data-tool="weld.cutlist.csv"
                data-testid="forge-cutlist-export"
                onClick={onExport}
                style={btnStyle(theme)}>Export CSV</button>
        {onClose ? (
          <button type="button"
                  data-tool="weld.cutlist.close"
                  data-testid="forge-cutlist-close"
                  onClick={onClose}
                  style={btnStyle(theme)}>Close</button>
        ) : null}
      </header>
      {source === 'kernel-error' ? (
        <div data-testid="forge-cutlist-kernel-error"
             style={{ padding: 12, color: '#e9b04b', fontSize: 12 }}>
          Kernel reported an error: {error}. Displaying empty list.
        </div>
      ) : null}
      {!WeldmentsDispatch.kernelReady() ? (
        <div data-testid="forge-cutlist-kernel-not-ready"
             style={{ padding: '8px 12px', color: '#7d6b46', fontSize: 11,
                      borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
          Kernel not ready — showing synthetic cut list from in-memory members.
        </div>
      ) : null}
      <table className="forge-cutlist-table"
             data-testid="forge-cutlist-table"
             style={tableStyle}>
        <thead>
          <tr>
            <th style={thStyle(theme)}>Member ID</th>
            <th style={thStyle(theme)}>Profile</th>
            <th style={thStyle(theme)}>Length (mm)</th>
            <th style={thStyle(theme)}>Qty</th>
            <th style={thStyle(theme)}>Angle cuts</th>
            <th style={thStyle(theme)}>Weight (kg)</th>
            <th style={thStyle(theme)}>Material</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr data-testid="forge-cutlist-empty">
              <td colSpan={7} style={{ ...tdStyle(theme), textAlign: 'center',
                                       opacity: 0.55, padding: 24 }}>
                No members yet — pick a profile and place a structural member.
              </td>
            </tr>
          ) : rows.map((r) => (
            <tr key={r.memberId}
                data-cutlist-row={r.memberId}
                data-testid="forge-cutlist-row">
              <td style={tdStyle(theme)}>{r.memberId}</td>
              <td style={tdStyle(theme)}>{r.profileName}</td>
              <td style={tdStyle(theme)} data-cutlist-length>{r.length}</td>
              <td style={tdStyle(theme)} data-cutlist-qty>{r.qty}</td>
              <td style={tdStyle(theme)} data-cutlist-trim>
                {r.trim ? `${r.trim}${r.miterDeg
                  ? ` @ ${r.miterDeg.toFixed(1)}°` : ''}` : '—'}
              </td>
              <td style={tdStyle(theme)}
                  data-cutlist-weight>{(r.qty * r.weight).toFixed(2)}</td>
              <td style={tdStyle(theme)}>{r.material || '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr data-testid="forge-cutlist-total">
            <td colSpan={5} style={{ ...tdStyle(theme), textAlign: 'right',
                                     fontWeight: 600 }}>Total mass</td>
            <td style={{ ...tdStyle(theme), fontWeight: 600 }}
                data-cutlist-total>{totalMass.toFixed(2)} kg</td>
            <td style={tdStyle(theme)} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/* ----- inline style helpers (panel is its own visual unit) ----- */
function panelStyle(theme) {
  const dark = theme === 'dark';
  return {
    position:    'absolute',
    right:       16,
    bottom:      16,
    width:       620,
    maxHeight:   '60vh',
    overflow:    'auto',
    background:  dark ? 'rgba(20,18,15,0.96)' : 'rgba(248,244,232,0.96)',
    border:      `1px solid ${dark ? '#3a3329' : '#bfa66c'}`,
    borderRadius: 6,
    color:       dark ? '#e9d9a8' : '#1a1612',
    boxShadow:   '0 12px 36px rgba(0,0,0,0.45)',
    fontFamily:  'ui-sans-serif, system-ui',
    fontSize:    12,
    zIndex:      9000,
  };
}
const headStyle = {
  display: 'flex', alignItems: 'center', gap: 10,
  padding: '10px 12px',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  letterSpacing: 0.4,
};
function btnStyle(theme) {
  const dark = theme === 'dark';
  return {
    background: dark ? '#2a241b' : '#e7dcb8',
    color:      dark ? '#e9d9a8' : '#1a1612',
    border:     `1px solid ${dark ? '#52462f' : '#b89c5e'}`,
    borderRadius: 4,
    padding:    '4px 10px',
    fontSize:   11,
    cursor:     'pointer',
  };
}
const tableStyle = {
  width: '100%', borderCollapse: 'collapse',
};
function thStyle(theme) {
  const dark = theme === 'dark';
  return {
    textAlign: 'left',
    padding:   '6px 10px',
    fontWeight: 600,
    borderBottom: `1px solid ${dark ? '#3a3329' : '#bfa66c'}`,
    background:   dark ? 'rgba(40,32,20,0.7)' : 'rgba(231,220,184,0.7)',
    fontSize:  11,
    letterSpacing: 0.3,
  };
}
function tdStyle(theme) {
  const dark = theme === 'dark';
  return {
    padding: '5px 10px',
    borderBottom: `1px solid ${dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.06)'}`,
    fontVariantNumeric: 'tabular-nums',
  };
}

export default CutListPanel;
