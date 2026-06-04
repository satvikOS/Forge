// PUSH-13 — Standard parts browser UI. Reads from StandardPartsCatalog and
// inserts via window.forge.stdpartsCatalog.insert. No deps.

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { CATALOG, listCatalog } from './StandardPartsCatalog.js';

const KINDS = ['all', 'bolt', 'shcs', 'nut', 'washer', 'bearing', 'bearing-taper', 'wshape', 'pipe', 'gear'];

export function StandardPartsBrowserHost() {
    const [open, setOpen] = useState(false);
    const [kind, setKind] = useState('all');
    const [filter, setFilter] = useState('');
    const [confirm, setConfirm] = useState(null);

    useEffect(() => {
        window.__forgeOpenStandardPartsBrowser  = () => setOpen(true);
        window.__forgeCloseStandardPartsBrowser = () => setOpen(false);
        return () => { delete window.__forgeOpenStandardPartsBrowser; delete window.__forgeCloseStandardPartsBrowser; };
    }, []);

    const items = useMemo(() => {
        const lo = filter.toLowerCase();
        const list = kind === 'all' ? CATALOG : listCatalog({ kind });
        return list.filter((p) => !lo || p.code.toLowerCase().includes(lo));
    }, [kind, filter]);

    if (!open) return null;

    const insert = (code) => {
        try {
            window.forge.stdpartsCatalog.insert(code, { x: 0, y: 0, z: 0 });
            setConfirm(`Inserted ${code}`);
            setTimeout(() => setConfirm(null), 1600);
        } catch (e) {
            setConfirm('Error: ' + String(e.message || e));
        }
    };

    return createPortal(
        <div data-testid="forge-stdparts-panel"
             style={{ position: 'fixed', top: 90, right: 24, width: 560, maxHeight: '80vh', overflow: 'auto',
                      background: '#161b22', color: '#c9d1d9',
                      border: '1px solid #30363d', borderRadius: 8, padding: 14,
                      zIndex: 6800, fontFamily: 'system-ui, sans-serif', fontSize: 13,
                      boxShadow: '0 14px 40px rgba(0,0,0,0.6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong>Standard parts (ISO / ANSI / DIN / SKF / AISC / ASME / AGMA — {CATALOG.length} entries)</strong>
                <button onClick={() => setOpen(false)} style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <select data-testid="forge-stdparts-kind" value={kind} onChange={(e) => setKind(e.target.value)}
                        style={{ background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: '5px 8px' }}>
                    {KINDS.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
                <input data-testid="forge-stdparts-filter" type="text" value={filter}
                       onChange={(e) => setFilter(e.target.value)} placeholder="Search code…"
                       style={{ flex: 1, background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: '5px 8px' }}/>
            </div>
            <div data-testid="forge-stdparts-list"
                 style={{ maxHeight: '60vh', overflowY: 'auto', border: '1px solid #30363d', borderRadius: 4 }}>
                {items.length === 0 ? (
                    <div style={{ padding: 10, color: '#8b949e' }}>No matches.</div>
                ) : items.map((p) => (
                    <div key={p.code} data-testid={`forge-stdparts-row-${p.code.replace(/[\s./]/g, '_')}`}
                         style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                  padding: '6px 10px', borderBottom: '1px solid #21262d' }}>
                        <div>
                            <div><strong>{p.code}</strong> <span style={{ color: '#8b949e', fontSize: 11 }}>({p.kind})</span></div>
                            <div style={{ fontSize: 11, color: '#8b949e' }}>
                                {p.diameter ? `Ø${p.diameter} ` : ''}
                                {p.length ? `L=${p.length} ` : ''}
                                {p.innerDiameter ? `id=${p.innerDiameter} ` : ''}
                                {p.outerDiameter ? `OD=${p.outerDiameter} ` : ''}
                                {p.width ? `W=${p.width} ` : ''}
                                {p.depth ? `d=${p.depth} ` : ''}
                                {p.module ? `m=${p.module}, z=${p.teeth} ` : ''}
                                {p.od ? `OD=${p.od}, wall=${p.wall} ` : ''}
                            </div>
                        </div>
                        <button data-testid={`forge-stdparts-insert-${p.code.replace(/[\s./]/g, '_')}`}
                                onClick={() => insert(p.code)}
                                style={{ background: '#238636', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: 'pointer', fontSize: 11 }}>Insert</button>
                    </div>
                ))}
            </div>
            {confirm && <div data-testid="forge-stdparts-confirm" style={{ marginTop: 8, padding: 6, background: '#1d2d1d', color: '#3fb950', borderRadius: 4, fontSize: 12 }}>{confirm}</div>}
        </div>,
        document.body
    );
}
