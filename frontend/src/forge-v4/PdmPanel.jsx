// Forge-133 — PDM panel (Product Data Management).
//
// 420 px right-anchored panel exposing the full PDM-equivalent surface
// for ArchDisc Forge v4. Five tabs:
//
//   • Items      — table of every part (PN / name / current rev / state
//                  / locked-by). Row click opens the detail strip with
//                  the item's rev history.
//   • Revisions  — chronological history of every rev across all items
//                  with timestamps and ECN refs.
//   • ECNs       — Engineering Change Notice list; "Affected" column
//                  shows the PNs each ECN touches.
//   • BOMs       — Tree view for the selected parent item; the toggle
//                  switches between Released and Working roll-ups and
//                  highlights diff additions / removals.
//   • Where Used — given the selected item, lists every parent that
//                  references it.
//
// Self-mounts via window.__forgeOpenPdm AND wires to Tools menu
// (tools.pdm). Manual UI NEVER writes to Archie's thread — clicks call
// the store directly.

import React, {
  useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore,
} from 'react';
import { Icon } from './icons/Icon.jsx';
import { showToast } from './Toast.jsx';
import {
  createItem, revise, checkout, checkin, setLifecycle,
  addEcn, linkBom, whereUsed, releasedBom, workingBom, bomDiff,
  getItem, listItems, listRevs, listEcns, listBoms,
  revsForItem, historyForItem,
  subscribe, snapshot,
} from './pdmStore.js';

const PANEL_W = 420;
export const PDM_EVENT = 'forge:open-pdm-panel';

const TABS = [
  { id: 'items',  label: 'Items' },
  { id: 'revs',   label: 'Revisions' },
  { id: 'ecns',   label: 'ECNs' },
  { id: 'boms',   label: 'BOMs' },
  { id: 'where',  label: 'Where Used' },
];

// ── style helpers ────────────────────────────────────────────────────

function panelStyle() {
  return {
    position: 'fixed',
    top:    'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
    right:  0,
    width:  PANEL_W,
    maxWidth: '96vw',
    height: 'calc(100vh - var(--forge-topbar-h) - var(--forge-qat-h) - var(--forge-cmdbar-h))',
    background: 'var(--forge-canvas-2)',
    borderLeft: '1px solid var(--forge-rail-edge)',
    boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
    display: 'flex', flexDirection: 'column',
    fontSize: 12,
    color: 'var(--forge-ink)',
    zIndex: 1295,
  };
}

const headerStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '8px 12px',
  borderBottom: '1px solid var(--forge-rail-edge)',
  background: 'var(--forge-canvas)',
  fontWeight: 600,
  flexShrink: 0,
};

const tabBarStyle = {
  display: 'flex',
  borderBottom: '1px solid var(--forge-rail-edge)',
  background: 'var(--forge-canvas)',
  flexShrink: 0,
};

const tabBtnBase = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  borderBottom: '2px solid transparent',
  color: 'var(--forge-ink-2)',
  font: 'inherit',
  fontSize: 11,
  padding: '6px 4px',
  cursor: 'pointer',
  textAlign: 'center',
  transition: 'color 90ms, border-color 90ms',
};

const bodyStyle = {
  flex: 1,
  overflowY: 'auto',
  padding: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const sectionTitle = {
  fontSize: 10,
  textTransform: 'uppercase',
  letterSpacing: '0.06em',
  color: 'var(--forge-ink-mute)',
  margin: 0,
  fontWeight: 600,
};

const inputStyle = {
  background: 'var(--forge-canvas)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 3,
  color: 'var(--forge-ink)',
  font: 'inherit',
  fontSize: 11,
  padding: '4px 6px',
};

const primaryBtn = {
  background: 'var(--forge-accent-mute)',
  border: '1px solid var(--forge-accent)',
  borderRadius: 'var(--forge-radius)',
  color: 'var(--forge-ink)',
  fontWeight: 600,
  font: 'inherit',
  fontSize: 11,
  padding: '5px 10px',
  cursor: 'pointer',
};

const ghostBtn = {
  background: 'var(--forge-surface)',
  border: '1px solid var(--forge-rail-edge)',
  borderRadius: 'var(--forge-radius)',
  color: 'var(--forge-ink)',
  font: 'inherit',
  fontSize: 11,
  padding: '4px 8px',
  cursor: 'pointer',
};

const tableStyle = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 11,
};

const thStyle = {
  textAlign: 'left',
  fontWeight: 600,
  fontSize: 10,
  color: 'var(--forge-ink-mute)',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  padding: '4px 6px',
  borderBottom: '1px solid var(--forge-rail-edge)',
  background: 'var(--forge-canvas)',
  position: 'sticky',
  top: 0,
};

const tdStyle = {
  padding: '4px 6px',
  borderBottom: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const lifecyclePill = (state) => {
  const COLOR = {
    WIP:      { bg: 'rgba(225,178,80,0.16)',   fg: 'var(--forge-warn)' },
    Released: { bg: 'rgba(92,200,143,0.16)',   fg: 'var(--forge-ok)'   },
    Obsolete: { bg: 'rgba(226,106,106,0.16)',  fg: 'var(--forge-err)'  },
  }[state] || { bg: 'var(--forge-surface)', fg: 'var(--forge-ink-2)' };
  return {
    display: 'inline-block',
    padding: '1px 6px',
    borderRadius: 'var(--forge-radius-pill)',
    background: COLOR.bg,
    color: COLOR.fg,
    fontFamily: 'var(--forge-mono)',
    fontSize: 9,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  };
};

// ── live store subscription ──────────────────────────────────────────

function useStore() {
  // useSyncExternalStore returns the slice the React tree depends on.
  // We snapshot all lists at once but memoize their reference so this
  // doesn't churn when an unrelated piece of state mutates.
  const get = useCallback(() => snapshot(), []);
  return useSyncExternalStore(subscribe, get, get);
}

// ── Items tab ────────────────────────────────────────────────────────

function ItemsTab({ items, locks, onPickItem, selectedItemId }) {
  const [pn, setPn] = useState('');
  const [name, setName] = useState('');
  const [material, setMaterial] = useState('AL-6061');

  const onCreate = useCallback(() => {
    if (!pn.trim()) {
      showToast({ kind: 'warn', text: 'Part number required', ttl: 1500 });
      return;
    }
    try {
      const it = createItem({ partNumber: pn.trim(), name: name.trim(), material });
      showToast({ kind: 'ok', text: `Created ${it.partNumber} rev ${it.currentRev}`, ttl: 1500 });
      setPn(''); setName('');
    } catch (err) {
      showToast({ kind: 'warn', text: err.message, ttl: 2200 });
    }
  }, [pn, name, material]);

  const selected = items.find((it) => it.id === selectedItemId) || null;

  return (
    <>
      <div data-testid="forge-pdm-items-create"
           style={{ display: 'flex', flexDirection: 'column', gap: 4,
                    padding: 8, background: 'var(--forge-surface)',
                    border: '1px solid var(--forge-rail-edge)',
                    borderRadius: 'var(--forge-radius)' }}>
        <h4 style={sectionTitle}>Create item</h4>
        <input value={pn} onChange={(e) => setPn(e.target.value)}
               placeholder="Part number (e.g. P-1001)"
               data-testid="forge-pdm-input-pn"
               style={inputStyle} />
        <input value={name} onChange={(e) => setName(e.target.value)}
               placeholder="Name"
               data-testid="forge-pdm-input-name"
               style={inputStyle} />
        <select value={material} onChange={(e) => setMaterial(e.target.value)}
                data-testid="forge-pdm-input-material"
                style={inputStyle}>
          <option value="AL-6061">Aluminium 6061-T6</option>
          <option value="SS-304">Stainless 304</option>
          <option value="MS-1018">Mild steel 1018</option>
          <option value="PA-12">Nylon PA-12</option>
          <option value="unspecified">unspecified</option>
        </select>
        <button type="button"
                data-testid="forge-pdm-create-btn"
                onClick={onCreate}
                style={primaryBtn}>
          + Create item
        </button>
      </div>

      <h4 style={sectionTitle}>Items ({items.length})</h4>
      <div style={{ background: 'var(--forge-canvas-3)',
                    border: '1px solid var(--forge-rail-edge)',
                    borderRadius: 'var(--forge-radius)',
                    overflow: 'auto', maxHeight: 220 }}>
        <table style={tableStyle} data-testid="forge-pdm-items-table">
          <thead>
            <tr>
              <th style={thStyle}>Part #</th>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Rev</th>
              <th style={thStyle}>State</th>
              <th style={thStyle}>Locked</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={5} style={{ ...tdStyle, color: 'var(--forge-ink-mute)',
                                            textAlign: 'center', padding: 14 }}>
                No items yet. Use the form above.
              </td></tr>
            ) : items.map((it) => {
              const isSel = it.id === selectedItemId;
              return (
                <tr key={it.id}
                    data-testid={`forge-pdm-item-row-${it.partNumber}`}
                    data-item-id={it.id}
                    onClick={() => onPickItem(it.id)}
                    style={{
                      cursor: 'pointer',
                      background: isSel ? 'var(--forge-accent-mute)' : 'transparent',
                    }}
                    onMouseEnter={(e) => { if (!isSel) e.currentTarget.style.background = 'var(--forge-surface)'; }}
                    onMouseLeave={(e) => { if (!isSel) e.currentTarget.style.background = 'transparent'; }}>
                  <td style={{ ...tdStyle, fontFamily: 'var(--forge-mono)' }}>{it.partNumber}</td>
                  <td style={tdStyle}>{it.name}</td>
                  <td style={{ ...tdStyle, fontFamily: 'var(--forge-mono)', fontWeight: 600 }}>{it.currentRev}</td>
                  <td style={tdStyle}><span style={lifecyclePill(it.lifecycle)}>{it.lifecycle}</span></td>
                  <td style={{ ...tdStyle, color: it.lockedBy ? 'var(--forge-warn)' : 'var(--forge-ink-mute)',
                                fontFamily: 'var(--forge-mono)', fontSize: 10 }}>
                    {it.lockedBy || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {selected && <ItemDetail item={selected} />}
    </>
  );
}

function ItemDetail({ item }) {
  const [user, setUser] = useState('engineer');
  const [note, setNote] = useState('');

  const onRevise = useCallback(() => {
    try {
      const it = revise(item.id);
      showToast({ kind: 'ok', text: `${it.partNumber} → rev ${it.currentRev}`, ttl: 1500 });
    } catch (err) {
      showToast({ kind: 'warn', text: err.message, ttl: 2200 });
    }
  }, [item.id]);

  const onCheckout = useCallback(() => {
    try {
      checkout(item.id, user);
      showToast({ kind: 'ok', text: `Checked out by ${user}`, ttl: 1200 });
    } catch (err) {
      showToast({ kind: 'warn', text: err.message, ttl: 2200 });
    }
  }, [item.id, user]);

  const onCheckin = useCallback(() => {
    try {
      checkin(item.id, user, note || `Checked in by ${user}`);
      showToast({ kind: 'ok', text: `Checked in`, ttl: 1200 });
      setNote('');
    } catch (err) {
      showToast({ kind: 'warn', text: err.message, ttl: 2200 });
    }
  }, [item.id, user, note]);

  const onLifecycle = useCallback((state) => {
    try {
      setLifecycle(item.id, state);
      showToast({ kind: 'ok', text: `${item.partNumber} → ${state}`, ttl: 1200 });
    } catch (err) {
      showToast({ kind: 'warn', text: err.message, ttl: 2200 });
    }
  }, [item.id, item.partNumber]);

  const revs    = revsForItem(item.id);
  const history = historyForItem(item.id);

  return (
    <div data-testid="forge-pdm-item-detail"
         data-item-id={item.id}
         style={{ display: 'flex', flexDirection: 'column', gap: 6,
                  padding: 8, background: 'var(--forge-canvas-3)',
                  border: '1px solid var(--forge-rail-edge)',
                  borderRadius: 'var(--forge-radius)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <strong data-testid="forge-pdm-detail-pn"
                style={{ fontFamily: 'var(--forge-mono)', fontSize: 13 }}>
          {item.partNumber}
        </strong>
        <span style={{ color: 'var(--forge-ink-2)', flex: 1 }}>{item.name}</span>
        <span data-testid="forge-pdm-detail-rev"
              style={{ fontFamily: 'var(--forge-mono)', fontWeight: 700 }}>
          Rev {item.currentRev}
        </span>
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <span style={lifecyclePill(item.lifecycle)}>{item.lifecycle}</span>
        <span style={{ fontSize: 10, color: 'var(--forge-ink-mute)',
                        fontFamily: 'var(--forge-mono)' }}>
          {item.material}
        </span>
      </div>

      <input value={user} onChange={(e) => setUser(e.target.value)}
             placeholder="user"
             data-testid="forge-pdm-detail-user"
             style={inputStyle} />
      <input value={note} onChange={(e) => setNote(e.target.value)}
             placeholder="check-in note"
             data-testid="forge-pdm-detail-note"
             style={inputStyle} />

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button type="button"
                data-testid="forge-pdm-revise-btn"
                onClick={onRevise}
                style={ghostBtn}>Revise</button>
        <button type="button"
                data-testid="forge-pdm-checkout-btn"
                onClick={onCheckout}
                style={ghostBtn}>Check out</button>
        <button type="button"
                data-testid="forge-pdm-checkin-btn"
                onClick={onCheckin}
                style={ghostBtn}>Check in</button>
      </div>

      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <button type="button"
                data-testid="forge-pdm-lifecycle-wip"
                onClick={() => onLifecycle('WIP')}
                style={ghostBtn}>→ WIP</button>
        <button type="button"
                data-testid="forge-pdm-lifecycle-released"
                onClick={() => onLifecycle('Released')}
                style={ghostBtn}>→ Released</button>
        <button type="button"
                data-testid="forge-pdm-lifecycle-obsolete"
                onClick={() => onLifecycle('Obsolete')}
                style={ghostBtn}>→ Obsolete</button>
      </div>

      <h5 style={{ ...sectionTitle, marginTop: 4 }}>
        Revisions ({revs.length})
      </h5>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                    fontFamily: 'var(--forge-mono)', fontSize: 10,
                    color: 'var(--forge-ink-2)' }}>
        {revs.map((r) => (
          <li key={r.id} data-rev-letter={r.rev}
              style={{ display: 'flex', gap: 6, padding: '2px 0',
                        borderBottom: '1px solid var(--forge-rail-edge)' }}>
            <span style={{ width: 24, fontWeight: 700, color: 'var(--forge-ink)' }}>{r.rev}</span>
            <span style={{ flex: 1 }}>{r.note}</span>
            <span style={{ color: 'var(--forge-ink-mute)' }}>{r.ecnRef || '—'}</span>
            <span style={{ color: 'var(--forge-ink-mute)' }}>
              {new Date(r.createdAt).toISOString().slice(0, 10)}
            </span>
          </li>
        ))}
      </ul>

      <h5 style={{ ...sectionTitle, marginTop: 4 }}>
        History ({history.length})
      </h5>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                    fontFamily: 'var(--forge-mono)', fontSize: 10,
                    color: 'var(--forge-ink-2)', maxHeight: 100, overflowY: 'auto' }}>
        {history.slice().reverse().map((h) => (
          <li key={h.id}
              style={{ display: 'flex', gap: 6, padding: '2px 0',
                        borderBottom: '1px solid var(--forge-rail-edge)' }}>
            <span style={{ width: 56, color: 'var(--forge-ink-mute)' }}>{h.kind}</span>
            <span style={{ flex: 1 }}>{h.note}</span>
            <span style={{ color: 'var(--forge-ink-mute)' }}>
              {new Date(h.ts).toISOString().slice(11, 19)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Revisions tab ────────────────────────────────────────────────────

function RevisionsTab({ revs, items }) {
  const byItem = useMemo(() => {
    const m = new Map();
    for (const it of items) m.set(it.id, it);
    return m;
  }, [items]);
  return (
    <>
      <h4 style={sectionTitle}>All revisions ({revs.length})</h4>
      <div style={{ background: 'var(--forge-canvas-3)',
                    border: '1px solid var(--forge-rail-edge)',
                    borderRadius: 'var(--forge-radius)',
                    overflow: 'auto', maxHeight: '60vh' }}>
        <table style={tableStyle} data-testid="forge-pdm-revs-table">
          <thead>
            <tr>
              <th style={thStyle}>Part #</th>
              <th style={thStyle}>Rev</th>
              <th style={thStyle}>ECN</th>
              <th style={thStyle}>Note</th>
              <th style={thStyle}>Date</th>
            </tr>
          </thead>
          <tbody>
            {revs.length === 0 ? (
              <tr><td colSpan={5} style={{ ...tdStyle, color: 'var(--forge-ink-mute)',
                                            textAlign: 'center', padding: 14 }}>
                No revisions logged.
              </td></tr>
            ) : revs.slice().sort((a, b) => b.createdAt - a.createdAt).map((r) => {
              const it = byItem.get(r.itemId);
              return (
                <tr key={r.id}
                    data-testid={`forge-pdm-rev-row-${r.id}`}
                    data-rev-letter={r.rev}>
                  <td style={{ ...tdStyle, fontFamily: 'var(--forge-mono)' }}>
                    {it ? it.partNumber : '—'}
                  </td>
                  <td style={{ ...tdStyle, fontFamily: 'var(--forge-mono)', fontWeight: 600 }}>
                    {r.rev}
                  </td>
                  <td style={{ ...tdStyle, color: 'var(--forge-ink-mute)' }}>
                    {r.ecnRef || '—'}
                  </td>
                  <td style={tdStyle}>{r.note}</td>
                  <td style={{ ...tdStyle, fontFamily: 'var(--forge-mono)',
                                color: 'var(--forge-ink-mute)' }}>
                    {new Date(r.createdAt).toISOString().slice(0, 10)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── ECNs tab ─────────────────────────────────────────────────────────

function EcnsTab({ ecns, items }) {
  const [number, setNumber] = useState('');
  const [reason, setReason] = useState('');
  const [picked, setPicked] = useState(new Set());

  const togglePick = useCallback((id) => {
    setPicked((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const onAdd = useCallback(() => {
    if (!number.trim()) {
      showToast({ kind: 'warn', text: 'ECN number required', ttl: 1500 });
      return;
    }
    try {
      addEcn({ number: number.trim(),
               reason,
               affectedItems: Array.from(picked) });
      showToast({ kind: 'ok', text: `ECN ${number} created`, ttl: 1500 });
      setNumber(''); setReason(''); setPicked(new Set());
    } catch (err) {
      showToast({ kind: 'warn', text: err.message, ttl: 2200 });
    }
  }, [number, reason, picked]);

  const pnFor = useMemo(() => {
    const m = new Map();
    for (const it of items) m.set(it.id, it.partNumber);
    return m;
  }, [items]);

  return (
    <>
      <div data-testid="forge-pdm-ecn-create"
           style={{ display: 'flex', flexDirection: 'column', gap: 4,
                    padding: 8, background: 'var(--forge-surface)',
                    border: '1px solid var(--forge-rail-edge)',
                    borderRadius: 'var(--forge-radius)' }}>
        <h4 style={sectionTitle}>New ECN</h4>
        <input value={number} onChange={(e) => setNumber(e.target.value)}
               placeholder="ECN number (e.g. ECN-1001)"
               data-testid="forge-pdm-ecn-number"
               style={inputStyle} />
        <input value={reason} onChange={(e) => setReason(e.target.value)}
               placeholder="Reason"
               data-testid="forge-pdm-ecn-reason"
               style={inputStyle} />
        <div style={{ fontSize: 10, color: 'var(--forge-ink-mute)' }}>
          Affected items (click to toggle):
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
          {items.map((it) => {
            const on = picked.has(it.id);
            return (
              <button key={it.id}
                      type="button"
                      data-testid={`forge-pdm-ecn-pick-${it.partNumber}`}
                      data-active={on ? 'true' : 'false'}
                      onClick={() => togglePick(it.id)}
                      style={{
                        ...ghostBtn,
                        fontFamily: 'var(--forge-mono)',
                        fontSize: 10,
                        padding: '2px 6px',
                        background: on ? 'var(--forge-accent-mute)' : 'var(--forge-surface)',
                        borderColor: on ? 'var(--forge-accent)' : 'var(--forge-rail-edge)',
                      }}>
                {it.partNumber}
              </button>
            );
          })}
        </div>
        <button type="button"
                data-testid="forge-pdm-ecn-add-btn"
                onClick={onAdd}
                style={primaryBtn}>
          + Add ECN
        </button>
      </div>

      <h4 style={sectionTitle}>ECNs ({ecns.length})</h4>
      <div style={{ background: 'var(--forge-canvas-3)',
                    border: '1px solid var(--forge-rail-edge)',
                    borderRadius: 'var(--forge-radius)',
                    overflow: 'auto', maxHeight: '50vh' }}>
        <table style={tableStyle} data-testid="forge-pdm-ecns-table">
          <thead>
            <tr>
              <th style={thStyle}>Number</th>
              <th style={thStyle}>Date</th>
              <th style={thStyle}>Reason</th>
              <th style={thStyle}>Affected</th>
            </tr>
          </thead>
          <tbody>
            {ecns.length === 0 ? (
              <tr><td colSpan={4} style={{ ...tdStyle, color: 'var(--forge-ink-mute)',
                                            textAlign: 'center', padding: 14 }}>
                No ECNs.
              </td></tr>
            ) : ecns.slice().sort((a, b) => b.createdAt - a.createdAt).map((e) => (
              <tr key={e.id}
                  data-testid={`forge-pdm-ecn-row-${e.number}`}>
                <td style={{ ...tdStyle, fontFamily: 'var(--forge-mono)', fontWeight: 600 }}>
                  {e.number}
                </td>
                <td style={{ ...tdStyle, fontFamily: 'var(--forge-mono)',
                              color: 'var(--forge-ink-mute)' }}>
                  {e.date}
                </td>
                <td style={tdStyle}>{e.reason || '—'}</td>
                <td style={{ ...tdStyle, fontFamily: 'var(--forge-mono)',
                              fontSize: 10, color: 'var(--forge-ink-2)',
                              whiteSpace: 'normal' }}
                    data-affected-count={e.affectedItems.length}>
                  {e.affectedItems.length === 0
                    ? '—'
                    : e.affectedItems.map((id) => pnFor.get(id) || id.slice(0, 6)).join(', ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// ── BOMs tab ─────────────────────────────────────────────────────────

function BomsTab({ items, selectedItemId, onPickItem }) {
  const [mode, setMode] = useState('working'); // 'working' | 'released' | 'diff'
  const [childPn, setChildPn] = useState('');
  const [qty, setQty] = useState('1');

  const parent = items.find((it) => it.id === selectedItemId) || null;

  const onLink = useCallback(() => {
    if (!parent) {
      showToast({ kind: 'warn', text: 'Select a parent item first', ttl: 1800 });
      return;
    }
    const child = items.find((it) => it.partNumber === childPn.trim());
    if (!child) {
      showToast({ kind: 'warn', text: `Unknown child part number "${childPn}"`, ttl: 2200 });
      return;
    }
    try {
      linkBom(child.id, parent.id, parseInt(qty, 10) || 1);
      showToast({ kind: 'ok',
                  text: `Linked ${child.partNumber} × ${qty} → ${parent.partNumber}`,
                  ttl: 1500 });
      setChildPn(''); setQty('1');
    } catch (err) {
      showToast({ kind: 'warn', text: err.message, ttl: 2200 });
    }
  }, [parent, childPn, qty, items]);

  const released = useMemo(
    () => parent ? releasedBom(parent.id) : [],
    [parent]);
  const working = useMemo(
    () => parent ? workingBom(parent.id) : [],
    [parent]);
  const diff = useMemo(
    () => parent ? bomDiff(parent.id) : null,
    [parent]);

  return (
    <>
      <h4 style={sectionTitle}>Parent item</h4>
      <select value={selectedItemId || ''}
              onChange={(e) => onPickItem(e.target.value)}
              data-testid="forge-pdm-bom-parent-select"
              style={inputStyle}>
        <option value="">— select parent —</option>
        {items.map((it) => (
          <option key={it.id} value={it.id}>
            {it.partNumber} · {it.name} · rev {it.currentRev}
          </option>
        ))}
      </select>

      {parent && (
        <>
          <h4 style={sectionTitle}>Link child</h4>
          <div style={{ display: 'flex', gap: 4 }}>
            <input value={childPn} onChange={(e) => setChildPn(e.target.value)}
                   placeholder="Child part #"
                   data-testid="forge-pdm-bom-child-pn"
                   style={{ ...inputStyle, flex: 1 }} />
            <input value={qty} onChange={(e) => setQty(e.target.value)}
                   placeholder="Qty"
                   type="number" min="1"
                   data-testid="forge-pdm-bom-qty"
                   style={{ ...inputStyle, width: 50 }} />
            <button type="button"
                    data-testid="forge-pdm-bom-link-btn"
                    onClick={onLink}
                    style={primaryBtn}>
              Link
            </button>
          </div>

          <h4 style={sectionTitle}>View</h4>
          <div style={tabBarStyle}>
            {['working', 'released', 'diff'].map((m) => (
              <button key={m}
                      type="button"
                      data-testid={`forge-pdm-bom-mode-${m}`}
                      data-active={mode === m ? 'true' : 'false'}
                      onClick={() => setMode(m)}
                      style={{
                        ...tabBtnBase,
                        color: mode === m ? 'var(--forge-ink)' : 'var(--forge-ink-2)',
                        borderBottomColor: mode === m ? 'var(--forge-accent)' : 'transparent',
                      }}>
                {m === 'working' ? 'Working' : m === 'released' ? 'Released' : 'Diff'}
              </button>
            ))}
          </div>

          <div style={{ background: 'var(--forge-canvas-3)',
                        border: '1px solid var(--forge-rail-edge)',
                        borderRadius: 'var(--forge-radius)',
                        padding: 8, fontSize: 11,
                        maxHeight: '40vh', overflowY: 'auto' }}
               data-testid="forge-pdm-bom-tree"
               data-bom-mode={mode}>
            {mode === 'working' && <BomTree rows={working} parent={parent} />}
            {mode === 'released' && (released.length === 0
              ? <div style={{ color: 'var(--forge-ink-mute)' }}>
                  Parent is not Released — no released BOM.
                </div>
              : <BomTree rows={released} parent={parent} />)}
            {mode === 'diff' && diff && (
              <BomDiffView diff={diff} />
            )}
          </div>
        </>
      )}
    </>
  );
}

function BomTree({ rows, parent }) {
  if (rows.length === 0) {
    return (
      <div style={{ color: 'var(--forge-ink-mute)' }}>
        No children linked under {parent.partNumber}.
      </div>
    );
  }
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}
        data-testid="forge-pdm-bom-list"
        data-bom-rows={rows.length}>
      <li style={{ fontFamily: 'var(--forge-mono)', fontWeight: 700,
                    color: 'var(--forge-ink)' }}>
        {parent.partNumber} (rev {parent.currentRev})
      </li>
      {rows.map((r) => (
        <li key={r.edge.id}
            data-bom-child={r.child.partNumber}
            style={{ display: 'flex', gap: 6,
                      padding: '2px 0 2px 14px',
                      fontFamily: 'var(--forge-mono)',
                      color: 'var(--forge-ink-2)' }}>
          <span style={{ color: 'var(--forge-ink-mute)' }}>└─</span>
          <span style={{ flex: 1 }}>
            {r.child.partNumber} · {r.child.name}
          </span>
          <span style={{ color: 'var(--forge-ink-mute)' }}>rev {r.rev}</span>
          <span style={{ color: 'var(--forge-ink)' }}>×{r.qty}</span>
        </li>
      ))}
    </ul>
  );
}

function BomDiffView({ diff }) {
  return (
    <div data-testid="forge-pdm-bom-diff">
      <h5 style={{ ...sectionTitle, color: 'var(--forge-ok)' }}>
        Added ({diff.added.length})
      </h5>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                    fontFamily: 'var(--forge-mono)', fontSize: 10 }}
          data-diff-added={diff.added.length}>
        {diff.added.map((r) => (
          <li key={r.edge.id} style={{ color: 'var(--forge-ok)' }}>
            + {r.child.partNumber} ×{r.qty} (rev {r.rev})
          </li>
        ))}
      </ul>
      <h5 style={{ ...sectionTitle, color: 'var(--forge-err)', marginTop: 6 }}>
        Removed ({diff.removed.length})
      </h5>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                    fontFamily: 'var(--forge-mono)', fontSize: 10 }}
          data-diff-removed={diff.removed.length}>
        {diff.removed.map((r) => (
          <li key={r.edge.id} style={{ color: 'var(--forge-err)' }}>
            − {r.child.partNumber} ×{r.qty} (rev {r.rev})
          </li>
        ))}
      </ul>
      <h5 style={{ ...sectionTitle, color: 'var(--forge-warn)', marginTop: 6 }}>
        Changed ({diff.changed.length})
      </h5>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                    fontFamily: 'var(--forge-mono)', fontSize: 10 }}
          data-diff-changed={diff.changed.length}>
        {diff.changed.map((c, i) => (
          <li key={i} style={{ color: 'var(--forge-warn)' }}>
            ~ {c.working.child.partNumber}: ×{c.released.qty}/rev {c.released.rev}
            → ×{c.working.qty}/rev {c.working.rev}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Where Used tab ───────────────────────────────────────────────────

function WhereUsedTab({ items, selectedItemId, onPickItem }) {
  const child = items.find((it) => it.id === selectedItemId) || null;
  const parents = useMemo(
    () => child ? whereUsed(child.id) : [],
    [child]);
  return (
    <>
      <h4 style={sectionTitle}>Item</h4>
      <select value={selectedItemId || ''}
              onChange={(e) => onPickItem(e.target.value)}
              data-testid="forge-pdm-where-item-select"
              style={inputStyle}>
        <option value="">— select item —</option>
        {items.map((it) => (
          <option key={it.id} value={it.id}>
            {it.partNumber} · {it.name}
          </option>
        ))}
      </select>

      {child && (
        <>
          <h4 style={sectionTitle}>
            Used by ({parents.length})
            <span data-testid="forge-pdm-where-count"
                  style={{ marginLeft: 6, color: 'var(--forge-ink)',
                            fontFamily: 'var(--forge-mono)' }}>
              {parents.length}
            </span>
          </h4>
          <div style={{ background: 'var(--forge-canvas-3)',
                        border: '1px solid var(--forge-rail-edge)',
                        borderRadius: 'var(--forge-radius)',
                        overflow: 'auto', maxHeight: '50vh' }}>
            <table style={tableStyle} data-testid="forge-pdm-where-table">
              <thead>
                <tr>
                  <th style={thStyle}>Parent #</th>
                  <th style={thStyle}>Name</th>
                  <th style={thStyle}>Rev</th>
                  <th style={thStyle}>Qty</th>
                </tr>
              </thead>
              <tbody>
                {parents.length === 0 ? (
                  <tr><td colSpan={4} style={{ ...tdStyle, color: 'var(--forge-ink-mute)',
                                                textAlign: 'center', padding: 14 }}>
                    Not used by any parent.
                  </td></tr>
                ) : parents.map((row) => (
                  <tr key={row.edge.id}
                      data-testid={`forge-pdm-where-row-${row.parent.partNumber}`}>
                    <td style={{ ...tdStyle, fontFamily: 'var(--forge-mono)' }}>
                      {row.parent.partNumber}
                    </td>
                    <td style={tdStyle}>{row.parent.name}</td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--forge-mono)' }}>
                      {row.parent.currentRev}
                    </td>
                    <td style={{ ...tdStyle, fontFamily: 'var(--forge-mono)',
                                  fontWeight: 600 }}>
                      ×{row.qty}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

// ── Panel root ───────────────────────────────────────────────────────

export function PdmPanel({ open, onClose }) {
  const [activeTab, setActiveTab] = useState('items');
  const [selectedItemId, setSelectedItemId] = useState(null);
  const store = useStore();

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Keep selection valid if the underlying list mutates.
  useEffect(() => {
    if (selectedItemId && !store.items.some((it) => it.id === selectedItemId)) {
      setSelectedItemId(null);
    }
  }, [store.items, selectedItemId]);

  if (!open) return null;

  return (
    <aside role="region"
           aria-label="Product Data Management"
           data-testid="forge-pdm-panel"
           style={panelStyle()}>
      <header style={headerStyle}>
        <Icon name="misc.settings" size={14} />
        <span style={{ flex: 1 }}>Product Data Management</span>
        <button type="button"
                onClick={onClose}
                aria-label="Close panel"
                data-testid="forge-pdm-close"
                style={{ background: 'transparent', border: 'none',
                          color: 'var(--forge-ink-mute)', cursor: 'pointer',
                          display: 'inline-flex', padding: 2 }}>
          <Icon name="select.clear" size={12} />
        </button>
      </header>

      <div style={tabBarStyle} role="tablist">
        {TABS.map((t) => (
          <button key={t.id}
                  type="button"
                  role="tab"
                  data-testid={`forge-pdm-tab-${t.id}`}
                  data-active={activeTab === t.id ? 'true' : 'false'}
                  onClick={() => setActiveTab(t.id)}
                  style={{
                    ...tabBtnBase,
                    color: activeTab === t.id ? 'var(--forge-ink)' : 'var(--forge-ink-2)',
                    borderBottomColor: activeTab === t.id ? 'var(--forge-accent)' : 'transparent',
                  }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={bodyStyle}
           data-testid={`forge-pdm-body-${activeTab}`}>
        {activeTab === 'items' && (
          <ItemsTab items={store.items}
                    locks={store}
                    selectedItemId={selectedItemId}
                    onPickItem={setSelectedItemId} />
        )}
        {activeTab === 'revs' && (
          <RevisionsTab revs={store.revs} items={store.items} />
        )}
        {activeTab === 'ecns' && (
          <EcnsTab ecns={store.ecns} items={store.items} />
        )}
        {activeTab === 'boms' && (
          <BomsTab items={store.items}
                   selectedItemId={selectedItemId}
                   onPickItem={setSelectedItemId} />
        )}
        {activeTab === 'where' && (
          <WhereUsedTab items={store.items}
                        selectedItemId={selectedItemId}
                        onPickItem={setSelectedItemId} />
        )}
      </div>
    </aside>
  );
}

// ── Self-mounting host ───────────────────────────────────────────────

export function PdmPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenPdm = (v) => setOpen(v === undefined ? true : !!v);
    window.__forgeClosePdm = () => setOpen(false);
    const onEvt = (e) => {
      if (e?.detail?.which === 'pdm' || !e?.detail) setOpen(true);
    };
    window.addEventListener(PDM_EVENT, onEvt);
    return () => {
      window.removeEventListener(PDM_EVENT, onEvt);
      try { delete window.__forgeOpenPdm; } catch {}
      try { delete window.__forgeClosePdm; } catch {}
    };
  }, []);
  return <PdmPanel open={open} onClose={() => setOpen(false)} />;
}

export default PdmPanel;
