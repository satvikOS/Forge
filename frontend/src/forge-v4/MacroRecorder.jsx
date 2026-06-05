// PUSH-16 — Macro recorder + playback.
//
// Taps the forge:menu-action event bus to capture every command the user
// dispatches (palette, ribbon, right-click, etc.) into a script that can be
// re-played later. Saves scripts under window.localStorage so they survive
// across sessions without any external storage.
//
// The script JSON shape is intentionally simple — `events: [{ id, ts, args }]`
// — so it's interpretable from the Cmd-K palette or pasted into the public
// API (`window.forge.runMacro(scriptName)`). No external deps.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

const STORAGE_KEY = 'forge.macros.v1';

function loadAll() {
    if (typeof window === 'undefined' || !window.localStorage) return {};
    try { return JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '{}'); }
    catch { return {}; }
}
function saveAll(map) {
    if (typeof window === 'undefined' || !window.localStorage) return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(map)); } catch {}
}

export function listMacros() { return loadAll(); }
export function deleteMacro(name) {
    const all = loadAll();
    delete all[name];
    saveAll(all);
}

export function runMacro(name, opts = {}) {
    const all = loadAll();
    const script = all[name];
    if (!script || !Array.isArray(script.events)) return false;
    const speedMs = typeof opts.stepDelay === 'number' ? opts.stepDelay : 80;
    let i = 0;
    const tick = () => {
        if (i >= script.events.length) return;
        const ev = script.events[i++];
        try {
            window.dispatchEvent(new CustomEvent('forge:menu-action', { detail: { id: ev.id, args: ev.args } }));
        } catch {}
        setTimeout(tick, speedMs);
    };
    tick();
    return true;
}

if (typeof window !== 'undefined') {
    const __macrosApi = { list: listMacros, run: runMacro, delete: deleteMacro };
    try {
        window.forge = window.forge || {};
        window.forge.macros = window.forge.macros || {};
        Object.assign(window.forge.macros, __macrosApi);
    } catch {}
    try {
        window.forgeUI = window.forgeUI || {};
        window.forgeUI.macros = window.forgeUI.macros || {};
        Object.assign(window.forgeUI.macros, __macrosApi);
    } catch {}
}

export function MacroRecorderHost() {
    const [open, setOpen] = useState(false);
    const [recording, setRecording] = useState(false);
    const [events, setEvents] = useState([]);
    const [macroName, setMacroName] = useState('my-macro');
    const [savedList, setSavedList] = useState(() => Object.keys(loadAll()));
    const [error, setError] = useState(null);

    useEffect(() => {
        window.__forgeOpenMacroRecorder  = () => setOpen(true);
        window.__forgeCloseMacroRecorder = () => setOpen(false);
        window.__forgeStartMacroRecording = () => { setEvents([]); setRecording(true); setOpen(true); };
        window.__forgeStopMacroRecording = () => setRecording(false);
        return () => {
            delete window.__forgeOpenMacroRecorder;
            delete window.__forgeCloseMacroRecorder;
            delete window.__forgeStartMacroRecording;
            delete window.__forgeStopMacroRecording;
        };
    }, []);

    useEffect(() => {
        if (!recording) return;
        const onAction = (e) => {
            const id = e?.detail?.id;
            if (typeof id !== 'string') return;
            // Skip noisy meta-events that would re-trigger recursion.
            if (id.startsWith('macro.') || id.startsWith('palette.')) return;
            setEvents((prev) => [...prev, { id, args: e.detail.args || null, ts: Date.now() }]);
        };
        window.addEventListener('forge:menu-action', onAction);
        return () => window.removeEventListener('forge:menu-action', onAction);
    }, [recording]);

    useEffect(() => {
        const onMacroAction = (e) => {
            const id = e?.detail?.id;
            if (id === 'macro.record') { setEvents([]); setRecording(true); setOpen(true); }
            else if (id === 'macro.stop') setRecording(false);
            else if (id === 'macro.play') setOpen(true);
        };
        window.addEventListener('forge:menu-action', onMacroAction);
        return () => window.removeEventListener('forge:menu-action', onMacroAction);
    }, []);

    const save = () => {
        try {
            if (!macroName.trim()) { setError('Name required'); return; }
            const all = loadAll();
            all[macroName.trim()] = {
                name: macroName.trim(),
                recordedAt: new Date().toISOString(),
                events: events.slice(),
            };
            saveAll(all);
            setSavedList(Object.keys(all));
            setError(null);
        } catch (e) { setError(String(e.message || e)); }
    };

    const play = (name) => {
        setOpen(false);
        runMacro(name, { stepDelay: 120 });
    };

    if (!open) return null;

    return createPortal(
        <div data-testid="forge-macro-panel"
             style={{ position: 'fixed', top: 100, right: 24, width: 440,
                      background: '#161b22', color: '#c9d1d9',
                      border: '1px solid #30363d', borderRadius: 8, padding: 14,
                      zIndex: 6500, fontFamily: 'system-ui, sans-serif', fontSize: 13,
                      boxShadow: '0 14px 40px rgba(0,0,0,0.6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong>Macro recorder</strong>
                <button onClick={() => setOpen(false)} style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {!recording && (
                    <button data-testid="forge-macro-rec" onClick={() => { setEvents([]); setRecording(true); }}
                            style={{ background: '#f85149', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 10px', cursor: 'pointer' }}>● Record</button>
                )}
                {recording && (
                    <button data-testid="forge-macro-stop" onClick={() => setRecording(false)}
                            style={{ background: '#21262d', color: '#fff', border: '1px solid #30363d', borderRadius: 4, padding: '5px 10px', cursor: 'pointer' }}>■ Stop</button>
                )}
                <input data-testid="forge-macro-name" type="text" value={macroName}
                       onChange={(e) => setMacroName(e.target.value)}
                       style={{ flex: 1, background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: '5px 8px' }}/>
                <button data-testid="forge-macro-save" onClick={save}
                        style={{ background: '#238636', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 10px', cursor: 'pointer' }}>Save</button>
            </div>
            {error && <div data-testid="forge-macro-error" style={{ color: '#f85149', fontSize: 12, marginBottom: 6 }}>{error}</div>}
            <div data-testid="forge-macro-events" style={{ background: '#0d1117', border: '1px solid #30363d', borderRadius: 4, padding: 8, maxHeight: 160, overflowY: 'auto', fontFamily: 'monospace', fontSize: 11 }}>
                {events.length === 0 ? (
                    <div style={{ color: '#8b949e' }}>No events captured yet. Press ● Record then run commands.</div>
                ) : events.map((ev, i) => (
                    <div key={i}>{i + 1}. {ev.id}</div>
                ))}
            </div>
            <div style={{ marginTop: 10 }}>
                <strong>Saved macros</strong>
                <div data-testid="forge-macro-list" style={{ marginTop: 4 }}>
                    {savedList.length === 0 ? (
                        <div style={{ color: '#8b949e' }}>None yet.</div>
                    ) : savedList.map((n) => (
                        <div key={n} data-testid={`forge-macro-saved-${n}`} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
                            <span>{n}</span>
                            <span>
                                <button data-testid={`forge-macro-play-${n}`} onClick={() => play(n)}
                                        style={{ background: '#1f6feb', color: '#fff', border: 'none', borderRadius: 4, padding: '2px 8px', cursor: 'pointer', marginRight: 4 }}>▶ Play</button>
                                <button data-testid={`forge-macro-delete-${n}`}
                                        onClick={() => { deleteMacro(n); setSavedList(Object.keys(loadAll())); }}
                                        style={{ background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: '2px 8px', cursor: 'pointer' }}>Delete</button>
                            </span>
                        </div>
                    ))}
                </div>
            </div>
        </div>,
        document.body
    );
}
