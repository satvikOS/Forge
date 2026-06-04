// PUSH-14 — PDM workbench UI. Talks to electron pdm:* IPC via window.forge.pdm.
// Lists vault contents, supports add / checkout / checkin / history / rollback
// / ECN attach. All bytes flow through base64; no library outside the electron
// runtime. The workbench mounts as a draggable panel like every other Forge
// workbench, registers window.__forgeOpenPDMWorkbench, and never auto-posts to
// Archie's thread.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const FONT = 'system-ui, sans-serif';

async function callPdm(method, payload) {
    const api = (typeof window !== 'undefined') ? window.forge && window.forge.pdm : null;
    if (!api || typeof api[method] !== 'function') {
        throw new Error(`forge.pdm.${method} unavailable — Electron bridge required.`);
    }
    return await api[method](payload);
}

export function PDMWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [docs, setDocs] = useState([]);
    const [selected, setSelected] = useState(null);
    const [history, setHistory] = useState(null);
    const [error, setError] = useState(null);
    const [user, setUser] = useState('alice');
    const [comment, setComment] = useState('Initial check-in');
    const [newDocName, setNewDocName] = useState('bracket-A.step');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        window.__forgeOpenPDMWorkbench  = () => setOpen(true);
        window.__forgeClosePDMWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenPDMWorkbench; delete window.__forgeClosePDMWorkbench; };
    }, []);

    const refresh = async () => {
        try {
            setBusy(true);
            await callPdm('init');
            const list = await callPdm('list');
            setDocs(list || []);
            setError(null);
        } catch (e) { setError(String(e.message || e)); }
        finally { setBusy(false); }
    };

    useEffect(() => { if (open) refresh(); }, [open]);

    if (!open) return null;

    const doAddSample = async () => {
        try {
            setBusy(true);
            const samplePayload = Buffer.from
                ? Buffer.from(`ISO-10303-21;\nHEADER;\nFILE_DESCRIPTION(('${newDocName}'),'2;1');\nFILE_NAME('${newDocName}', '${new Date().toISOString()}',(),(),'','','');\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;`).toString('base64')
                : btoa(`ISO-10303-21;\n${newDocName}\nENDSEC;`);
            const ext = newDocName.split('.').pop() || 'bin';
            const meta = await callPdm('add', { name: newDocName, extension: ext, payloadBase64: samplePayload, user });
            await refresh();
            setSelected(meta);
            setError(null);
        } catch (e) { setError(String(e.message || e)); }
        finally { setBusy(false); }
    };

    const doCheckout = async (docId) => {
        try { setBusy(true); await callPdm('checkout', { docId, user }); await refresh(); setError(null); }
        catch (e) { setError(String(e.message || e)); }
        finally { setBusy(false); }
    };

    const doCheckin = async (docId) => {
        try {
            setBusy(true);
            const payload = Buffer.from
                ? Buffer.from(`v2 payload ${new Date().toISOString()}`).toString('base64')
                : btoa(`v2 payload ${new Date().toISOString()}`);
            await callPdm('checkin', { docId, user, payloadBase64: payload, comment });
            await refresh();
            setError(null);
        } catch (e) { setError(String(e.message || e)); }
        finally { setBusy(false); }
    };

    const showHistory = async (docId) => {
        try { setBusy(true); const h = await callPdm('history', { docId }); setHistory(h); setError(null); }
        catch (e) { setError(String(e.message || e)); }
        finally { setBusy(false); }
    };

    const doRollback = async (docId, toVersion) => {
        try { setBusy(true); await callPdm('rollback', { docId, toVersion, user, comment: `rollback to v${toVersion}` }); await refresh(); await showHistory(docId); setError(null); }
        catch (e) { setError(String(e.message || e)); }
        finally { setBusy(false); }
    };

    const doEcn = async (docId) => {
        try { setBusy(true); await callPdm('ecn', { docId, author: user, description: 'Released to manufacturing', stage: 'approved' }); setError(null); }
        catch (e) { setError(String(e.message || e)); }
        finally { setBusy(false); }
    };

    return createPortal(
        <div data-testid="forge-pdm-panel"
             style={{ position: 'fixed', top: 80, right: 24, width: 540,
                      background: '#161b22', color: '#c9d1d9',
                      border: '1px solid #30363d', borderRadius: 8, padding: 16,
                      zIndex: 6000, fontFamily: FONT, fontSize: 13,
                      boxShadow: '0 14px 40px rgba(0,0,0,0.6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <strong>PDM vault</strong>
                <button onClick={() => setOpen(false)} style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ marginBottom: 8 }}>
                <label>User: </label>
                <input data-testid="forge-pdm-user" type="text" value={user} onChange={(e) => setUser(e.target.value)} style={{ background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: 3 }} />
                <button data-testid="forge-pdm-refresh" disabled={busy} onClick={refresh}
                        style={{ marginLeft: 8, background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: '3px 8px', cursor: 'pointer' }}>Refresh</button>
            </div>
            <div style={{ marginBottom: 10, padding: 8, background: '#0d1117', border: '1px solid #30363d', borderRadius: 4 }}>
                <label>Add doc: </label>
                <input data-testid="forge-pdm-newname" type="text" value={newDocName} onChange={(e) => setNewDocName(e.target.value)} style={{ width: 220, background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: 3 }} />
                <button data-testid="forge-pdm-add" disabled={busy} onClick={doAddSample}
                        style={{ marginLeft: 8, background: '#238636', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 10px', cursor: 'pointer' }}>Add</button>
            </div>
            {error && <div data-testid="forge-pdm-error" style={{ marginBottom: 8, color: '#f85149', fontSize: 12 }}>{error}</div>}
            <div data-testid="forge-pdm-list" style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid #30363d', borderRadius: 4 }}>
                {docs.length === 0 && (
                    <div data-testid="forge-pdm-empty" style={{ padding: 10, color: '#8b949e' }}>Vault is empty. Use "Add" to commit the first document.</div>
                )}
                {docs.map((d) => (
                    <div key={d.docId} data-testid={`forge-pdm-row-${d.docId}`}
                         style={{ padding: 8, borderBottom: '1px solid #30363d',
                                  background: selected && selected.docId === d.docId ? '#1f6feb22' : 'transparent' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <span><strong>{d.name}</strong>  <span style={{ color: '#8b949e' }}>v{d.currentVersion}</span></span>
                            <span style={{ color: d.locked ? '#f85149' : '#3fb950' }}>{d.locked ? 'CHECKED OUT' : 'available'}</span>
                        </div>
                        <div style={{ fontSize: 11, color: '#8b949e' }}>{d.docId} · {d.extension} · updated {d.updatedAt}</div>
                        <div style={{ marginTop: 4, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            <button data-testid={`forge-pdm-checkout-${d.docId}`} disabled={busy} onClick={() => doCheckout(d.docId)} style={btnStyle}>Check out</button>
                            <button data-testid={`forge-pdm-checkin-${d.docId}`} disabled={busy} onClick={() => doCheckin(d.docId)} style={btnStyle}>Check in</button>
                            <button data-testid={`forge-pdm-history-${d.docId}`} disabled={busy} onClick={() => { setSelected(d); showHistory(d.docId); }} style={btnStyle}>History</button>
                            <button data-testid={`forge-pdm-ecn-${d.docId}`} disabled={busy} onClick={() => doEcn(d.docId)} style={btnStyle}>ECN</button>
                        </div>
                    </div>
                ))}
            </div>
            {history && (
                <div data-testid="forge-pdm-history" style={{ marginTop: 10, padding: 8, background: '#0d1117', border: '1px solid #30363d', borderRadius: 4 }}>
                    <strong>{history.name}</strong> · current v{history.currentVersion}
                    {history.versions.map((v) => (
                        <div key={v.version} style={{ marginTop: 4, fontSize: 12 }}>
                            <span data-testid={`forge-pdm-v-${v.version}`}>v{v.version}</span> by {v.author} at {v.committedAt} — {v.comment} <span style={{ color: '#8b949e' }}>({v.byteLength} B, {v.hash.slice(0, 8)})</span>
                            {v.version !== history.currentVersion && (
                                <button data-testid={`forge-pdm-rollback-${v.version}`}
                                        disabled={busy} onClick={() => doRollback(history.docId, v.version)}
                                        style={{ marginLeft: 6, ...btnStyle }}>Rollback to this</button>
                            )}
                        </div>
                    ))}
                </div>
            )}
        </div>,
        document.body
    );
}

const btnStyle = {
    background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d',
    borderRadius: 4, padding: '3px 8px', cursor: 'pointer', fontSize: 11,
};
