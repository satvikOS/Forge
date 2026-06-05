// PUSH-02 — Solid modelling ops workbench (forge::varfillet, ::loftguide,
// ::booleantol). Wraps the PUSH-18 kernel surfaces in a manual UI panel.
//
// Manual UI only — never posts to Archie's thread, never opens the Archie dock.

import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

function emptyReport() {
    return { input: null, output: null, error: null };
}

export function SolidOpsWorkbench({ onClose }) {
    const surface = typeof window !== 'undefined' && window.forge;
    const hasVar  = !!(surface && surface.varfillet);
    const hasLoft = !!(surface && surface.loftguide);
    const hasBool = !!(surface && surface.booleantol);

    const [box, setBox]           = useState(null);
    const [filletReport, setFR]   = useState(emptyReport());
    const [loftReport, setLR]     = useState(emptyReport());
    const [boolReport, setBR]     = useState(emptyReport());

    // Build a single 50×30×20 sample box on mount.
    useEffect(() => {
        if (!surface || !surface.box) return;
        try {
            const h = surface.box(50, 30, 20);
            setBox({ handle: h, dims: [50, 30, 20] });
        } catch { /* ignore */ }
    }, [surface]);

    const onVarFillet = useCallback(() => {
        if (!hasVar || !box) { setFR({ ...emptyReport(), error: 'varfillet unavailable' }); return; }
        try {
            // Variable radius fillet on edges 0-3 of the box top: r=1 → r=5 along edge.
            const res = surface.varfillet.fillet(box.handle,
                [0, 1, 2, 3],            // edge IDs
                [{ start: 1, end: 5 }, { start: 1, end: 5 }, { start: 1, end: 5 }, { start: 1, end: 5 }]);
            setFR({ input: { edges: 4, radii: [1, 5] }, output: res, error: null });
        } catch (ex) {
            setFR({ ...emptyReport(), error: String(ex.message || ex) });
        }
    }, [surface, hasVar, box]);

    const onLoft = useCallback(() => {
        if (!hasLoft) { setLR({ ...emptyReport(), error: 'loftguide unavailable' }); return; }
        try {
            const res = surface.loftguide.loft(
                [{ kind: 'circle', center: [0, 0, 0],  radius: 10 },
                 { kind: 'circle', center: [0, 0, 50], radius: 25 }],
                []                      // no guide curves for the sample loft
            );
            setLR({ input: { sections: 2 }, output: res, error: null });
        } catch (ex) {
            setLR({ ...emptyReport(), error: String(ex.message || ex) });
        }
    }, [surface, hasLoft]);

    const onTolBool = useCallback(() => {
        if (!hasBool || !box) { setBR({ ...emptyReport(), error: 'booleantol unavailable' }); return; }
        try {
            const cyl = surface.cyl(8, 30, 25, 15, -5);
            const res = surface.booleantol.cut(box.handle, cyl, 1e-3);
            setBR({ input: { fuzzy: 1e-3 }, output: res, error: null });
        } catch (ex) {
            setBR({ ...emptyReport(), error: String(ex.message || ex) });
        }
    }, [surface, hasBool, box]);

    return createPortal(
        <div data-testid="forge-solidops-panel" style={{
            position: 'fixed', right: 24, top: 96, width: 460, maxHeight: '78vh',
            background: '#181a1f', color: '#dadde2', border: '1px solid #2a2d34',
            borderRadius: 10, fontSize: 12, fontFamily: 'system-ui, sans-serif',
            boxShadow: '0 6px 22px rgba(0,0,0,0.45)', zIndex: 950,
            display: 'flex', flexDirection: 'column',
        }}>
            <div style={{
                padding: '8px 12px', borderBottom: '1px solid #2a2d34',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
                <div>Solid modelling ops <span style={{ opacity: 0.55 }}>· PUSH-02</span></div>
                <button onClick={onClose} aria-label="Close solid ops"
                    style={{ background: 'transparent', color: '#dadde2', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ padding: 10, overflowY: 'auto' }}>
                <div style={{ opacity: 0.7, marginBottom: 6 }}>
                    Native surfaces: varfillet {hasVar ? '✓' : '–'} ·
                    loftguide {hasLoft ? '✓' : '–'} ·
                    booleantol {hasBool ? '✓' : '–'}
                </div>

                {/* Variable-radius fillet */}
                <details open style={{ marginTop: 6 }}>
                    <summary style={{ cursor: 'pointer' }}>Variable-radius fillet</summary>
                    <div style={{ marginTop: 4, opacity: 0.85 }}>
                        Edges: <span data-testid="forge-solidops-fillet-edges">0-3</span> (top of 50×30×20 box) ·
                        radius interp: 1 → 5 mm
                    </div>
                    <button data-testid="forge-solidops-varfillet" onClick={onVarFillet}
                        style={{ marginTop: 6, padding: '6px 10px', background: '#2c4d2a',
                                 color: '#dfeedd', border: '1px solid #3a6738',
                                 borderRadius: 4, cursor: 'pointer' }}>
                        Apply variable fillet
                    </button>
                    {filletReport.output != null && (
                        <div data-testid="forge-solidops-fillet-report" style={{
                            marginTop: 6, padding: 6, background: '#0e1014',
                            border: '1px solid #2a2d34', borderRadius: 4,
                        }}>
                            <div>Result handle: <span data-testid="forge-solidops-fillet-handle">{filletReport.output}</span></div>
                        </div>
                    )}
                    {filletReport.error && (
                        <div data-testid="forge-solidops-fillet-error" style={{
                            marginTop: 6, padding: 6, background: '#3a1f1f', color: '#f1c4c4',
                            border: '1px solid #6d3434', borderRadius: 4,
                        }}>{filletReport.error}</div>
                    )}
                </details>

                {/* Loft with guides */}
                <details open style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer' }}>Loft (BRepOffsetAPI_ThruSections)</summary>
                    <div style={{ marginTop: 4, opacity: 0.85 }}>
                        Sections: 2 circles (Ø10 at z=0, Ø50 at z=50)
                    </div>
                    <button data-testid="forge-solidops-loft" onClick={onLoft}
                        style={{ marginTop: 6, padding: '6px 10px', background: '#2c4d2a',
                                 color: '#dfeedd', border: '1px solid #3a6738',
                                 borderRadius: 4, cursor: 'pointer' }}>
                        Build loft
                    </button>
                    {loftReport.output != null && (
                        <div data-testid="forge-solidops-loft-report" style={{
                            marginTop: 6, padding: 6, background: '#0e1014',
                            border: '1px solid #2a2d34', borderRadius: 4,
                        }}>
                            <div>Result handle: <span data-testid="forge-solidops-loft-handle">{loftReport.output}</span></div>
                        </div>
                    )}
                    {loftReport.error && (
                        <div data-testid="forge-solidops-loft-error" style={{
                            marginTop: 6, padding: 6, background: '#3a1f1f', color: '#f1c4c4',
                            border: '1px solid #6d3434', borderRadius: 4,
                        }}>{loftReport.error}</div>
                    )}
                </details>

                {/* Tolerant boolean */}
                <details open style={{ marginTop: 8 }}>
                    <summary style={{ cursor: 'pointer' }}>Tolerant boolean (fuzzy)</summary>
                    <div style={{ marginTop: 4, opacity: 0.85 }}>
                        Cut Ø16 cylinder through 50×30×20 box, fuzzy=1e-3
                    </div>
                    <button data-testid="forge-solidops-tolbool" onClick={onTolBool}
                        style={{ marginTop: 6, padding: '6px 10px', background: '#2c4d2a',
                                 color: '#dfeedd', border: '1px solid #3a6738',
                                 borderRadius: 4, cursor: 'pointer' }}>
                        Tolerant cut
                    </button>
                    {boolReport.output != null && (
                        <div data-testid="forge-solidops-bool-report" style={{
                            marginTop: 6, padding: 6, background: '#0e1014',
                            border: '1px solid #2a2d34', borderRadius: 4,
                        }}>
                            <div>Result handle: <span data-testid="forge-solidops-bool-handle">{boolReport.output}</span></div>
                        </div>
                    )}
                    {boolReport.error && (
                        <div data-testid="forge-solidops-bool-error" style={{
                            marginTop: 6, padding: 6, background: '#3a1f1f', color: '#f1c4c4',
                            border: '1px solid #6d3434', borderRadius: 4,
                        }}>{boolReport.error}</div>
                    )}
                </details>
            </div>
        </div>,
        document.body,
    );
}

export function SolidOpsWorkbenchHost() {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__forgeOpenSolidOpsWorkbench = () => setOpen(true);
        window.__forgeCloseSolidOpsWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenSolidOpsWorkbench;
            delete window.__forgeCloseSolidOpsWorkbench;
        };
    }, []);

    if (!open) return null;
    return <SolidOpsWorkbench onClose={() => setOpen(false)} />;
}

export default SolidOpsWorkbenchHost;
