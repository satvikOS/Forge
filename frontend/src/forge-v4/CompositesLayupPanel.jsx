// PUSH-144 (Slice-104) — Composites layup + ply book panel.
//
// Real aerospace ply book: layered materials with fiber orientation per
// layer. Standard [0/45/-45/90]s quasi-isotropic is a one-click preset.
// Drives classical lamination theory (ABD matrix) via compositesMath.js.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  COMPOSITE_MATERIALS, COMPOSITE_MATERIAL_IDS, STANDARD_ORIENTATIONS,
  makeEmptyPlyBook, makeQuasiIsoLayup, normalisePly,
  totalThickness_mm, totalMass_g, isSymmetric, isBalanced,
  computeABD, exportPlyBookAscii, summarise,
} from './compositesMath.js';

const STORAGE_KEY = 'forge.v4.composites';
export const FORGE_COMPOSITES_EVENT = 'forge:composites-changed';

function loadBook() {
  if (typeof localStorage === 'undefined') return makeEmptyPlyBook();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return makeEmptyPlyBook();
    const j = JSON.parse(raw);
    if (j && Array.isArray(j.plies)) return j;
  } catch {}
  return makeEmptyPlyBook();
}
function saveBook(book) {
  if (typeof localStorage === 'undefined') return;
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(book)); } catch {}
}

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0, bottom: 'var(--forge-statusbar-h, 24px)',
  width: 560, zIndex: 1330,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 8,
  color: 'var(--forge-ink)', fontSize: 12, overflowY: 'auto',
};

export function CompositesLayupPanel({ open, onClose }) {
  const [book, setBook] = useState(() => loadBook());
  const [status, setStatus] = useState('');

  const commit = useCallback((next) => {
    setBook(next);
    saveBook(next);
    try {
      window.__forgeComposites = next;
      window.dispatchEvent(new CustomEvent(FORGE_COMPOSITES_EVENT, { detail: next }));
    } catch {}
  }, []);

  const addPly = () => commit({
    ...book,
    plies: [...book.plies, normalisePly({
      materialId: 'cfrp_ud_t300', orientation_deg: 0, thickness_mm: 0.18, count: 1, area_mm2: 1e6,
    })],
  });
  const removePly = (i) => commit({ ...book, plies: book.plies.filter((_, j) => j !== i) });
  const updatePly = (i, patch) => commit({
    ...book,
    plies: book.plies.map((p, j) => j === i ? normalisePly({ ...p, ...patch }) : p),
  });
  const presetQuasiIso = () => commit(makeQuasiIsoLayup({ materialId: 'cfrp_ud_t300' }));
  const clear = () => commit(makeEmptyPlyBook());

  const summary = useMemo(() => summarise(book), [book]);
  const totalT = useMemo(() => totalThickness_mm(book), [book]);
  const totalM = useMemo(() => totalMass_g(book), [book]);
  const sym = useMemo(() => isSymmetric(book), [book]);
  const bal = useMemo(() => isBalanced(book), [book]);

  const computeABDClick = () => {
    const abd = computeABD(book);
    setStatus(`ABD computed — A11=${abd.A?.[0]?.[0]?.toFixed?.(1) ?? 'n/a'} D11=${abd.D?.[0]?.[0]?.toFixed?.(2) ?? 'n/a'}`);
    try {
      window.__forgeCompositesABD = abd;
    } catch {}
  };

  const exportAscii = async () => {
    const ascii = exportPlyBookAscii(book, { title: 'Forge ply book' });
    const dialog = window.forge?.dialog;
    if (!dialog) { setStatus('forge.dialog unavailable'); return; }
    const fp = await dialog.saveFile({
      title: 'Save ply book',
      defaultPath: 'plybook.txt',
      filters: [{ name: 'Plain text', extensions: ['txt'] }],
    });
    if (!fp) { setStatus('canceled'); return; }
    const bytes = new TextEncoder().encode(ascii);
    const res = await dialog.writeBlob(fp, bytes);
    if (res?.ok) {
      try { window.__forgeLastPlyBookPath = fp; } catch {}
      setStatus(`✓ saved ${res.bytes} B → ${fp.split('/').pop()}`);
    } else {
      setStatus(`✗ write failed`);
    }
  };

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-composites-panel"
         data-ply-count={book.plies.length}
         data-symmetric={String(sym)}
         data-balanced={String(bal)}>
      <header style={{ display: 'flex', justifyContent: 'space-between' }}>
        <strong>Composites Layup</strong>
        <button onClick={onClose}
                data-testid="forge-composites-close"
                style={{ background: 'transparent', border: '1px solid var(--forge-rail-edge)',
                         color: 'var(--forge-ink)', cursor: 'pointer', padding: '2px 6px' }}>
          ×
        </button>
      </header>

      <div style={{ display: 'flex', gap: 6 }}>
        <button onClick={presetQuasiIso} data-testid="forge-composites-preset-qi">
          Quasi-iso preset
        </button>
        <button onClick={addPly} data-testid="forge-composites-add">+ Ply</button>
        <button onClick={clear} data-testid="forge-composites-clear">Clear</button>
        <button onClick={computeABDClick} data-testid="forge-composites-compute-abd">
          Compute ABD
        </button>
        <button onClick={exportAscii} data-testid="forge-composites-export"
                style={{ marginLeft: 'auto', background: 'var(--forge-accent, #2c4d2a)',
                         color: '#dfeedd', border: 'none', padding: '4px 8px', borderRadius: 4 }}>
          Export ply book…
        </button>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
        <span>Total thickness <strong data-testid="forge-composites-thickness">{totalT.toFixed(3)}</strong> mm</span>
        <span>Total mass <strong>{totalM.toFixed(1)}</strong> g</span>
        <span style={{ color: sym ? '#7ec07e' : '#ff8a8a' }}
              data-testid="forge-composites-sym">
          {sym ? '✓ symmetric' : '✗ not symmetric'}
        </span>
        <span style={{ color: bal ? '#7ec07e' : '#ff8a8a' }}
              data-testid="forge-composites-bal">
          {bal ? '✓ balanced' : '✗ not balanced'}
        </span>
      </div>

      <section data-testid="forge-composites-rows"
               style={{ fontFamily: 'var(--forge-mono)', fontSize: 11, maxHeight: 320, overflowY: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--forge-rail-edge)' }}>
              <th>#</th><th>Material</th><th>θ°</th><th>t mm</th><th>count</th><th>×</th>
            </tr>
          </thead>
          <tbody>
            {book.plies.map((p, i) => (
              <tr key={i} data-row="ply" data-ply-orientation={p.orientation_deg}>
                <td>{i + 1}</td>
                <td>
                  <select value={p.materialId} data-testid={`forge-composites-mat-${i}`}
                          onChange={(e) => updatePly(i, { materialId: e.target.value })}>
                    {COMPOSITE_MATERIAL_IDS.map((m) => (
                      <option key={m} value={m}>{COMPOSITE_MATERIALS[m]?.label || m}</option>
                    ))}
                  </select>
                </td>
                <td>
                  <select value={p.orientation_deg} data-testid={`forge-composites-orient-${i}`}
                          onChange={(e) => updatePly(i, { orientation_deg: Number(e.target.value) })}>
                    {STANDARD_ORIENTATIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                </td>
                <td>
                  <input type="number" value={p.thickness_mm} step="0.01" style={{ width: 60 }}
                         onChange={(e) => updatePly(i, { thickness_mm: Number(e.target.value) || 0 })} />
                </td>
                <td>
                  <input type="number" value={p.count} min="1" style={{ width: 50 }}
                         onChange={(e) => updatePly(i, { count: Math.max(1, parseInt(e.target.value) || 1) })} />
                </td>
                <td>
                  <button onClick={() => removePly(i)}
                          data-testid={`forge-composites-rm-${i}`}>×</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {status && (
        <div data-testid="forge-composites-status" style={{ color: 'var(--forge-ink-mute)', fontFamily: 'var(--forge-mono)' }}>
          {status}
        </div>
      )}
    </div>
  );
}

export function CompositesLayupPanelHost() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenComposites = (b) => setOpen(b === undefined ? true : !!b);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.composites') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => window.removeEventListener('forge:menu-action', onMenu);
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <CompositesLayupPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default CompositesLayupPanel;
