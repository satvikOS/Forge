// PUSH-10 — Extended CAM workbench (kernel forge::camx).
//
// Wraps the native 2.5-axis pocket / contour / drill toolpath generators and
// the Fanuc / Heidenhain / Siemens post-processors. Manual UI only — does NOT
// post to Archie's thread; does NOT auto-open the Archie dock.

import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

const POSTS = [
    { id: 'fanuc',      label: 'Fanuc (G-code)' },
    { id: 'heidenhain', label: 'Heidenhain (Klartext)' },
    { id: 'siemens',    label: 'Siemens (SinuTrain)' },
];

const SAMPLE_POCKETS = [
    {
        id: 'sq-100',
        label: '100×100 pocket, 6 mm endmill, 5 mm deep',
        boundary: [[
            { x: 0,   y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 },
        ]],
        toolId: 1,                            // 6 mm endmill from default catalogue
        params: { depth: 5, stepdown: 2.5, stepover: 4, direction: 'climb' },
    },
    {
        id: 'sq-200',
        label: '200×100 pocket, 8 mm endmill, 10 mm deep',
        boundary: [[
            { x: 0,   y: 0 }, { x: 200, y: 0 }, { x: 200, y: 100 }, { x: 0, y: 100 },
        ]],
        toolId: 2,
        params: { depth: 10, stepdown: 4, stepover: 6, direction: 'climb' },
    },
];

export function CAMExtendedWorkbench({ onClose }) {
    const surface = typeof window !== 'undefined' && window.forge && window.forge.camx;

    const [tools, setTools] = useState([]);
    const [sample, setSample] = useState(SAMPLE_POCKETS[0]);
    const [segments, setSegments] = useState(null);
    const [post, setPost] = useState('fanuc');
    const [gcode, setGcode] = useState('');
    const [cycle, setCycle] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!surface) return;
        try { setTools(surface.listTools()); } catch (ex) { setError(String(ex.message || ex)); }
    }, [surface]);

    const onPocket = useCallback(() => {
        if (!surface) { setError('window.forge.camx unavailable (rebuild kernel)'); return; }
        try {
            const segs = surface.pocketToolpath(sample.boundary, sample.toolId, sample.params);
            setSegments(segs);
            setError(null);
        } catch (ex) { setError(String(ex.message || ex)); }
    }, [surface, sample]);

    const onPost = useCallback(() => {
        if (!surface || !segments) return;
        try {
            const g = surface.postProcess(segments, post, {
                spindleRPM: 10000, feed: 600, safeZ: 5, toolId: sample.toolId,
            });
            setGcode(g);
            setError(null);
        } catch (ex) { setError(String(ex.message || ex)); }
    }, [surface, segments, post, sample]);

    const onCycle = useCallback(() => {
        if (!surface || !segments) return;
        try {
            const c = surface.estimateCycleTime(segments, 600);
            setCycle(c);
        } catch (ex) { setError(String(ex.message || ex)); }
    }, [surface, segments]);

    const gcodeLines = gcode ? gcode.split('\n').length : 0;

    return createPortal(
        <div data-testid="forge-camx-panel" style={{
            position: 'fixed', right: 24, top: 96, width: 500, maxHeight: '82vh',
            background: '#181a1f', color: '#dadde2', border: '1px solid #2a2d34',
            borderRadius: 10, fontSize: 12, fontFamily: 'system-ui, sans-serif',
            boxShadow: '0 6px 22px rgba(0,0,0,0.45)', zIndex: 950,
            display: 'flex', flexDirection: 'column',
        }}>
            <div style={{
                padding: '8px 12px', borderBottom: '1px solid #2a2d34',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
                <div>CAM extended <span style={{ opacity: 0.55 }}>· PUSH-10 · forge::camx</span></div>
                <button onClick={onClose} aria-label="Close CAM extended"
                    style={{ background: 'transparent', color: '#dadde2', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ padding: 10, overflowY: 'auto' }}>
                <div style={{ opacity: 0.7, marginBottom: 6 }}>
                    Native CAM: {surface ? 'ready' : 'unavailable'} · tools loaded: {tools.length}
                </div>

                <details open>
                    <summary style={{ cursor: 'pointer' }}>Tool catalogue ({tools.length})</summary>
                    <table data-testid="forge-camx-tools" style={{ width: '100%', borderCollapse: 'collapse', marginTop: 4 }}>
                        <thead style={{ background: '#0e1014' }}>
                            <tr>
                                <th style={{ textAlign: 'left', padding: 4 }}>ID</th>
                                <th style={{ textAlign: 'left', padding: 4 }}>Type</th>
                                <th style={{ textAlign: 'right', padding: 4 }}>Ø (mm)</th>
                                <th style={{ textAlign: 'right', padding: 4 }}>Flutes</th>
                                <th style={{ textAlign: 'right', padding: 4 }}>RPM</th>
                            </tr>
                        </thead>
                        <tbody>
                            {tools.map((t) => (
                                <tr key={t.id} data-testid={`forge-camx-tool-${t.id}`}>
                                    <td style={{ padding: 4 }}>{t.id}</td>
                                    <td style={{ padding: 4 }}>{t.material}</td>
                                    <td style={{ padding: 4, textAlign: 'right' }}>{t.diameter}</td>
                                    <td style={{ padding: 4, textAlign: 'right' }}>{t.flutes}</td>
                                    <td style={{ padding: 4, textAlign: 'right' }}>{t.maxRPM}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </details>

                <div style={{ marginTop: 10 }}>
                    <label>Sample part: </label>
                    <select data-testid="forge-camx-sample"
                        value={sample.id}
                        onChange={(e) => { setSample(SAMPLE_POCKETS.find((s) => s.id === e.target.value)); setSegments(null); setGcode(''); setCycle(null); }}
                        style={{ background: '#0e1014', color: '#dadde2', border: '1px solid #2a2d34', borderRadius: 4 }}>
                        {SAMPLE_POCKETS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                    </select>
                </div>

                <button data-testid="forge-camx-pocket" onClick={onPocket}
                    style={{ marginTop: 8, padding: '6px 10px', background: '#2c4d2a',
                             color: '#dfeedd', border: '1px solid #3a6738',
                             borderRadius: 4, cursor: 'pointer' }}>
                    Generate pocket toolpath
                </button>

                {segments && (
                    <div data-testid="forge-camx-segments-report" style={{ marginTop: 8 }}>
                        <div>Segments: <span data-testid="forge-camx-seg-count">{segments.length}</span></div>
                        <div>Z levels: <span data-testid="forge-camx-zlevels">{
                            Array.from(new Set(segments.flatMap((s) => s.map((p) => p.z)))).sort((a,b)=>b-a).join(', ')
                        }</span></div>
                    </div>
                )}

                <div style={{ marginTop: 10, borderTop: '1px solid #2a2d34', paddingTop: 8 }}>
                    <label>Post: </label>
                    <select data-testid="forge-camx-post"
                        value={post} onChange={(e) => setPost(e.target.value)}
                        style={{ background: '#0e1014', color: '#dadde2', border: '1px solid #2a2d34', borderRadius: 4 }}>
                        {POSTS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                    </select>
                    <button data-testid="forge-camx-postprocess" onClick={onPost} disabled={!segments}
                        style={{ marginLeft: 6, padding: '4px 8px',
                                 background: segments ? '#2c3a4d' : '#1a1c20',
                                 color: '#dadde2', border: '1px solid #3a3d44',
                                 borderRadius: 4, cursor: segments ? 'pointer' : 'not-allowed' }}>
                        Post
                    </button>
                    <button data-testid="forge-camx-cycle" onClick={onCycle} disabled={!segments}
                        style={{ marginLeft: 6, padding: '4px 8px',
                                 background: segments ? '#2c3a4d' : '#1a1c20',
                                 color: '#dadde2', border: '1px solid #3a3d44',
                                 borderRadius: 4, cursor: segments ? 'pointer' : 'not-allowed' }}>
                        Cycle time
                    </button>
                </div>

                {cycle && (
                    <div data-testid="forge-camx-cycle-report" style={{ marginTop: 6 }}>
                        Total length: <span data-testid="forge-camx-total-length">{cycle.totalLengthMm.toFixed(1)}</span> mm ·
                        Time: <span data-testid="forge-camx-total-time">{cycle.timeSec.toFixed(1)}</span> s
                    </div>
                )}

                {gcode && (
                    <details data-testid="forge-camx-gcode-section" open style={{ marginTop: 8 }}>
                        <summary style={{ cursor: 'pointer' }}>G-code · {gcodeLines} lines</summary>
                        <pre data-testid="forge-camx-gcode" style={{
                            fontSize: 10, lineHeight: 1.3, maxHeight: 200, overflow: 'auto',
                            background: '#0e1014', border: '1px solid #2a2d34', borderRadius: 4,
                            padding: 6, marginTop: 4,
                        }}>{gcode}</pre>
                    </details>
                )}

                {error && (
                    <div data-testid="forge-camx-error" style={{
                        marginTop: 8, padding: 8, background: '#3a1f1f', color: '#f1c4c4',
                        border: '1px solid #6d3434', borderRadius: 4,
                    }}>{error}</div>
                )}
            </div>
        </div>,
        document.body,
    );
}

export function CAMExtendedWorkbenchHost() {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__forgeOpenCAMExtendedWorkbench = () => setOpen(true);
        window.__forgeCloseCAMExtendedWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenCAMExtendedWorkbench;
            delete window.__forgeCloseCAMExtendedWorkbench;
        };
    }, []);

    if (!open) return null;
    return <CAMExtendedWorkbench onClose={() => setOpen(false)} />;
}

export default CAMExtendedWorkbenchHost;
