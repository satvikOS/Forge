// PUSH-05 — Drawings HLR workbench (forge::drawings).
//
// Wraps the new HLR API (projectView, sectionView, emitDXF, emitSVG)
// shipped by the kernel agent. Distinct from the legacy
// Forge-90/130 DrawingsWorkbench.jsx; uses
// __forgeOpenDrawingsHLRWorkbench to avoid collision.
//
// Manual UI only — never posts to Archie, never opens dock.

import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

const VIEW_DIRS = [
    { id: 'front', label: 'FRONT (-Y)' },
    { id: 'top',   label: 'TOP (+Z)' },
    { id: 'right', label: 'RIGHT (+X)' },
    { id: 'iso',   label: 'ISO (1,1,1)' },
];

export function DrawingsHLRWorkbench({ onClose }) {
    const surface = typeof window !== 'undefined' && window.forge && window.forge.drawings;

    const [box, setBox]   = useState(null);
    const [dir, setDir]   = useState('front');
    const [view, setView] = useState(null);
    const [dxf, setDxf]   = useState('');
    const [svg, setSvg]   = useState('');
    const [error, setError] = useState(null);

    useEffect(() => {
        if (!surface || !window.forge.box) return;
        try { setBox(window.forge.box(100, 60, 40)); } catch { /* ignore */ }
    }, [surface]);

    const onProject = useCallback(() => {
        if (!surface || !surface.projectView || !box) {
            setError('drawings.projectView unavailable');
            return;
        }
        try {
            const v = surface.projectView(box, dir);
            setView(v);
            setError(null);
        } catch (ex) { setError(String(ex.message || ex)); }
    }, [surface, box, dir]);

    const onEmitDXF = useCallback(() => {
        if (!surface || !surface.emitDXF || !view) return;
        try { setDxf(surface.emitDXF([view], [])); }
        catch (ex) { setError(String(ex.message || ex)); }
    }, [surface, view]);

    const onEmitSVG = useCallback(() => {
        if (!surface || !surface.emitSVG || !view) return;
        try { setSvg(surface.emitSVG(view)); }
        catch (ex) { setError(String(ex.message || ex)); }
    }, [surface, view]);

    return createPortal(
        <div data-testid="forge-drawingshlr-panel" style={{
            position: 'fixed', right: 24, top: 96, width: 520, maxHeight: '82vh',
            background: '#181a1f', color: '#dadde2', border: '1px solid #2a2d34',
            borderRadius: 10, fontSize: 12, fontFamily: 'system-ui, sans-serif',
            boxShadow: '0 6px 22px rgba(0,0,0,0.45)', zIndex: 950,
            display: 'flex', flexDirection: 'column',
        }}>
            <div style={{
                padding: '8px 12px', borderBottom: '1px solid #2a2d34',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
                <div>Drawings (HLR) <span style={{ opacity: 0.55 }}>· PUSH-05 · forge::drawings</span></div>
                <button onClick={onClose} aria-label="Close drawings HLR"
                    style={{ background: 'transparent', color: '#dadde2', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ padding: 10, overflowY: 'auto' }}>
                <div style={{ opacity: 0.7, marginBottom: 6 }}>
                    Sample: 100 × 60 × 40 box (handle: {box ?? '—'}). Native HLR
                    via HLRBRep_Algo + DXF R12 / SVG emit.
                </div>

                <div style={{ marginTop: 4 }}>
                    <label>View direction: </label>
                    <select data-testid="forge-drawingshlr-direction"
                        value={dir} onChange={(e) => setDir(e.target.value)}
                        style={{ background: '#0e1014', color: '#dadde2',
                                 border: '1px solid #2a2d34', borderRadius: 4 }}>
                        {VIEW_DIRS.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
                    </select>
                </div>

                <button data-testid="forge-drawingshlr-project" onClick={onProject}
                    style={{ marginTop: 6, padding: '6px 10px', background: '#2c4d2a',
                             color: '#dfeedd', border: '1px solid #3a6738',
                             borderRadius: 4, cursor: 'pointer' }}>
                    Project view
                </button>

                {view && (
                    <div data-testid="forge-drawingshlr-view-report" style={{
                        marginTop: 8, padding: 6, background: '#0e1014',
                        border: '1px solid #2a2d34', borderRadius: 4,
                    }}>
                        <div>Visible edges: <span data-testid="forge-drawingshlr-visible-count">{view.visibleEdges?.length ?? 0}</span></div>
                        <div>Hidden edges: <span data-testid="forge-drawingshlr-hidden-count">{view.hiddenEdges?.length ?? 0}</span></div>
                        <div>BBox: <span data-testid="forge-drawingshlr-bbox">
                            x [{view.minX?.toFixed(1)} → {view.maxX?.toFixed(1)}]
                            y [{view.minY?.toFixed(1)} → {view.maxY?.toFixed(1)}]
                        </span></div>
                    </div>
                )}

                <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                    <button data-testid="forge-drawingshlr-emit-dxf" onClick={onEmitDXF}
                        disabled={!view}
                        style={{ flex: 1, padding: '4px 8px',
                                 background: view ? '#2c3a4d' : '#1a1c20',
                                 color: '#dadde2', border: '1px solid #3a3d44',
                                 borderRadius: 4, cursor: view ? 'pointer' : 'not-allowed' }}>
                        Emit DXF
                    </button>
                    <button data-testid="forge-drawingshlr-emit-svg" onClick={onEmitSVG}
                        disabled={!view}
                        style={{ flex: 1, padding: '4px 8px',
                                 background: view ? '#2c3a4d' : '#1a1c20',
                                 color: '#dadde2', border: '1px solid #3a3d44',
                                 borderRadius: 4, cursor: view ? 'pointer' : 'not-allowed' }}>
                        Emit SVG
                    </button>
                </div>

                {dxf && (
                    <details data-testid="forge-drawingshlr-dxf-section" open style={{ marginTop: 8 }}>
                        <summary style={{ cursor: 'pointer' }}>DXF · {dxf.length} bytes</summary>
                        <pre data-testid="forge-drawingshlr-dxf" style={{
                            fontSize: 10, lineHeight: 1.3, maxHeight: 200, overflow: 'auto',
                            background: '#0e1014', border: '1px solid #2a2d34', borderRadius: 4,
                            padding: 6, marginTop: 4,
                        }}>{dxf}</pre>
                    </details>
                )}

                {svg && (
                    <details data-testid="forge-drawingshlr-svg-section" open style={{ marginTop: 8 }}>
                        <summary style={{ cursor: 'pointer' }}>SVG · {svg.length} bytes</summary>
                        <pre data-testid="forge-drawingshlr-svg" style={{
                            fontSize: 10, lineHeight: 1.3, maxHeight: 200, overflow: 'auto',
                            background: '#0e1014', border: '1px solid #2a2d34', borderRadius: 4,
                            padding: 6, marginTop: 4,
                        }}>{svg}</pre>
                    </details>
                )}

                {error && (
                    <div data-testid="forge-drawingshlr-error" style={{
                        marginTop: 8, padding: 8, background: '#3a1f1f', color: '#f1c4c4',
                        border: '1px solid #6d3434', borderRadius: 4,
                    }}>{error}</div>
                )}
            </div>
        </div>,
        document.body,
    );
}

export function DrawingsHLRWorkbenchHost() {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__forgeOpenDrawingsHLRWorkbench = () => setOpen(true);
        window.__forgeCloseDrawingsHLRWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenDrawingsHLRWorkbench;
            delete window.__forgeCloseDrawingsHLRWorkbench;
        };
    }, []);

    if (!open) return null;
    return <DrawingsHLRWorkbench onClose={() => setOpen(false)} />;
}

export default DrawingsHLRWorkbenchHost;
