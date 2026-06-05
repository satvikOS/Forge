// PUSH-08 — Mold tooling workbench (forge::mold).
//
// Manual UI only — never posts to Archie, never opens dock.

import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

export function MoldWorkbench({ onClose }) {
    const surface = typeof window !== 'undefined' && window.forge && window.forge.mold;

    const [box, setBox]         = useState(null);
    const [drafts, setDrafts]   = useState(null);
    const [cooling, setCooling] = useState(null);
    const [runner, setRunner]   = useState(null);
    const [error, setError]     = useState(null);

    useEffect(() => {
        if (!surface || !window.forge.box) return;
        try { setBox(window.forge.box(100, 100, 100)); } catch { /* ignore */ }
    }, [surface]);

    const onDraft = useCallback(() => {
        if (!surface || !box) { setError('mold.analyseDraft unavailable'); return; }
        try {
            const res = surface.analyseDraft(box, [0, 0, 1], 3);
            setDrafts(res);
            setError(null);
        } catch (ex) { setError(String(ex.message || ex)); }
    }, [surface, box]);

    const onCooling = useCallback(() => {
        if (!surface) { setError('mold.insertCoolingChannels unavailable'); return; }
        try {
            const block = window.forge.box(200, 200, 100);
            const channels = [
                { start: [10, 100, 50],  end: [190, 100, 50], diameter: 10 },
                { start: [100, 10, 50],  end: [100, 190, 50], diameter: 10 },
            ];
            const res = surface.insertCoolingChannels(block, channels);
            setCooling({ handle: res, channels: 2 });
            setError(null);
        } catch (ex) { setError(String(ex.message || ex)); }
    }, [surface]);

    const onRunner = useCallback(() => {
        if (!surface) { setError('mold.buildRunnerSystem unavailable'); return; }
        try {
            const res = surface.buildRunnerSystem(
                [0, 0, 100],
                [[40, 0, 0], [-20, 35, 0], [-20, -35, 0]],
                { sprue: 12, runner: 8, gate: 4 },
            );
            setRunner({
                sprue: res.sprue,
                runners: res.runners ? res.runners.length : 0,
                gates: res.gates ? res.gates.length : 0,
            });
            setError(null);
        } catch (ex) { setError(String(ex.message || ex)); }
    }, [surface]);

    return createPortal(
        <div data-testid="forge-mold-panel" style={{
            position: 'fixed', right: 24, top: 96, width: 500, maxHeight: '78vh',
            background: '#181a1f', color: '#dadde2', border: '1px solid #2a2d34',
            borderRadius: 10, fontSize: 12, fontFamily: 'system-ui, sans-serif',
            boxShadow: '0 6px 22px rgba(0,0,0,0.45)', zIndex: 950,
            display: 'flex', flexDirection: 'column',
        }}>
            <div style={{
                padding: '8px 12px', borderBottom: '1px solid #2a2d34',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
                <div>Mold tooling <span style={{ opacity: 0.55 }}>· PUSH-08 · forge::mold</span></div>
                <button onClick={onClose} aria-label="Close mold"
                    style={{ background: 'transparent', color: '#dadde2', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ padding: 10, overflowY: 'auto' }}>
                <div style={{ opacity: 0.7, marginBottom: 6 }}>
                    Sample: 100×100×100 box. Pull direction +Z, threshold 3°.
                </div>

                <details open>
                    <summary style={{ cursor: 'pointer' }}>Draft analysis</summary>
                    <button data-testid="forge-mold-draft" onClick={onDraft}
                        style={{ marginTop: 6, padding: '4px 8px', background: '#2c4d2a',
                                 color: '#dfeedd', border: '1px solid #3a6738',
                                 borderRadius: 4, cursor: 'pointer' }}>
                        Analyse draft
                    </button>
                    {drafts && (
                        <div data-testid="forge-mold-draft-report" style={{
                            marginTop: 6, padding: 6, background: '#0e1014',
                            border: '1px solid #2a2d34', borderRadius: 4,
                        }}>
                            <div>Faces: <span data-testid="forge-mold-face-count">{drafts.length}</span></div>
                            <div>Positive (draws upward): {drafts.filter((d) => d.isPositive).length}</div>
                            <div>Negative (side action): {drafts.filter((d) => d.isNegative).length}</div>
                            <div>Vertical (parting wall): {drafts.filter((d) => d.isVertical).length}</div>
                        </div>
                    )}
                </details>

                <details open style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer' }}>Cooling channels</summary>
                    <button data-testid="forge-mold-cooling" onClick={onCooling}
                        style={{ marginTop: 6, padding: '4px 8px', background: '#2c4d2a',
                                 color: '#dfeedd', border: '1px solid #3a6738',
                                 borderRadius: 4, cursor: 'pointer' }}>
                        Drill 2 channels (Ø10 cross pattern)
                    </button>
                    {cooling && (
                        <div data-testid="forge-mold-cooling-report" style={{
                            marginTop: 6, padding: 6, background: '#0e1014',
                            border: '1px solid #2a2d34', borderRadius: 4,
                        }}>
                            <div>Drilled block handle: <span data-testid="forge-mold-cool-handle">{cooling.handle}</span></div>
                            <div>Channels: {cooling.channels}</div>
                        </div>
                    )}
                </details>

                <details open style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer' }}>Runner system (sprue + runners + gates)</summary>
                    <button data-testid="forge-mold-runner" onClick={onRunner}
                        style={{ marginTop: 6, padding: '4px 8px', background: '#2c4d2a',
                                 color: '#dfeedd', border: '1px solid #3a6738',
                                 borderRadius: 4, cursor: 'pointer' }}>
                        Build runner system (3-gate)
                    </button>
                    {runner && (
                        <div data-testid="forge-mold-runner-report" style={{
                            marginTop: 6, padding: 6, background: '#0e1014',
                            border: '1px solid #2a2d34', borderRadius: 4,
                        }}>
                            <div>Sprue handle: <span data-testid="forge-mold-sprue-handle">{runner.sprue}</span></div>
                            <div>Runners: <span data-testid="forge-mold-runner-count">{runner.runners}</span></div>
                            <div>Gates: <span data-testid="forge-mold-gate-count">{runner.gates}</span></div>
                        </div>
                    )}
                </details>

                {error && (
                    <div data-testid="forge-mold-error" style={{
                        marginTop: 8, padding: 8, background: '#3a1f1f', color: '#f1c4c4',
                        border: '1px solid #6d3434', borderRadius: 4,
                    }}>{error}</div>
                )}
            </div>
        </div>,
        document.body,
    );
}

export function MoldWorkbenchHost() {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__forgeOpenMoldWorkbench = () => setOpen(true);
        window.__forgeCloseMoldWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenMoldWorkbench;
            delete window.__forgeCloseMoldWorkbench;
        };
    }, []);

    if (!open) return null;
    return <MoldWorkbench onClose={() => setOpen(false)} />;
}

export default MoldWorkbenchHost;
