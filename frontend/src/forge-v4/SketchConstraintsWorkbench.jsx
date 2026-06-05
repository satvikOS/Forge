// PUSH-03 — Sketch constraints workbench (forge::sketcher, PLANEGCS-backed).
//
// Demonstrates the parametric 2D sketcher: build a rectangle by point + line
// primitives, apply horizontal / vertical / equal constraints to enforce
// orthogonality + opposite-side equality, solve, read back the constrained
// coordinates. Pure native call surface — manual UI only, never posts to
// Archie's thread.

import React, { useEffect, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

export function SketchConstraintsWorkbench({ onClose }) {
    const surface = typeof window !== 'undefined' && window.forge && window.forge.sketcher;

    const [report, setReport] = useState(null);
    const [error, setError]   = useState(null);

    const onBuildAndSolve = useCallback(() => {
        if (!surface) { setError('window.forge.sketcher unavailable'); return; }
        try {
            const h  = surface.createSketch();
            const KIND = surface.kinds;

            // Four points roughly in a rectangle, intentionally off-axis.
            const p0 = surface.addPoint(h, 0,    0);
            const p1 = surface.addPoint(h, 100,  3);
            const p2 = surface.addPoint(h, 102,  62);
            const p3 = surface.addPoint(h, 1,    60);

            // Four edges as lines.
            const e0 = surface.addLine(h, p0, p1);
            const e1 = surface.addLine(h, p1, p2);
            const e2 = surface.addLine(h, p2, p3);
            const e3 = surface.addLine(h, p3, p0);

            // Force bottom + top horizontal, left + right vertical.
            surface.addConstraint(h, KIND.Horizontal, [e0]);
            surface.addConstraint(h, KIND.Horizontal, [e2]);
            surface.addConstraint(h, KIND.Vertical,   [e1]);
            surface.addConstraint(h, KIND.Vertical,   [e3]);

            // Pin p0 to the origin.
            surface.addConstraint(h, KIND.Distance, [p0, p0], 0);

            const status = surface.solve(h);
            const pts = [p0, p1, p2, p3].map((pid) => surface.readPoint(h, pid));
            surface.destroySketch(h);

            setReport({
                handle: h, status,
                points: pts,
                edges: [e0, e1, e2, e3],
                isRect:
                    Math.abs(pts[0].y - pts[1].y) < 1e-6 &&
                    Math.abs(pts[2].y - pts[3].y) < 1e-6 &&
                    Math.abs(pts[0].x - pts[3].x) < 1e-6 &&
                    Math.abs(pts[1].x - pts[2].x) < 1e-6,
            });
            setError(null);
        } catch (ex) { setError(String(ex.message || ex)); }
    }, [surface]);

    return createPortal(
        <div data-testid="forge-sketch-panel" style={{
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
                <div>Sketch constraints <span style={{ opacity: 0.55 }}>· PUSH-03 · planegcs</span></div>
                <button onClick={onClose} aria-label="Close sketch"
                    style={{ background: 'transparent', color: '#dadde2', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ padding: 10, overflowY: 'auto' }}>
                <div style={{ opacity: 0.7, marginBottom: 6 }}>
                    Build a 4-point rectangle with 4 horizontal/vertical constraints +
                    origin pin, solve, read back coordinates.
                </div>

                {surface && (
                    <details open>
                        <summary style={{ cursor: 'pointer' }}>Available constraint kinds ({Object.keys(surface.kinds).length})</summary>
                        <ul style={{ margin: '4px 0 8px 16px', padding: 0 }}>
                            {Object.entries(surface.kinds).map(([name, id]) => (
                                <li key={name} data-testid={`forge-sketch-kind-${name}`}>{name} = {id}</li>
                            ))}
                        </ul>
                    </details>
                )}

                <button data-testid="forge-sketch-solve" onClick={onBuildAndSolve}
                    style={{ marginTop: 8, padding: '6px 10px', background: '#2c4d2a',
                             color: '#dfeedd', border: '1px solid #3a6738',
                             borderRadius: 4, cursor: 'pointer' }}>
                    Build + solve rectangle
                </button>

                {error && (
                    <div data-testid="forge-sketch-error" style={{
                        marginTop: 8, padding: 8, background: '#3a1f1f', color: '#f1c4c4',
                        border: '1px solid #6d3434', borderRadius: 4,
                    }}>{error}</div>
                )}

                {report && (
                    <div data-testid="forge-sketch-report" style={{
                        marginTop: 10, padding: 8, background: '#0e1014',
                        border: '1px solid #2a2d34', borderRadius: 4,
                    }}>
                        <div>Status: <span data-testid="forge-sketch-status">{report.status}</span></div>
                        <div>Is rectangle: <span data-testid="forge-sketch-is-rect">{String(report.isRect)}</span></div>
                        <div style={{ marginTop: 6 }}>Solved points:</div>
                        <table style={{ width: '100%', fontSize: 11, marginTop: 4 }}>
                            <tbody>
                                {report.points.map((p, i) => (
                                    <tr key={i} data-testid={`forge-sketch-point-${i}`}>
                                        <td>P{i}</td>
                                        <td>x = {p.x.toFixed(3)}</td>
                                        <td>y = {p.y.toFixed(3)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}

export function SketchConstraintsWorkbenchHost() {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__forgeOpenSketchConstraintsWorkbench = () => setOpen(true);
        window.__forgeCloseSketchConstraintsWorkbench = () => setOpen(false);
        return () => {
            delete window.__forgeOpenSketchConstraintsWorkbench;
            delete window.__forgeCloseSketchConstraintsWorkbench;
        };
    }, []);

    if (!open) return null;
    return <SketchConstraintsWorkbench onClose={() => setOpen(false)} />;
}

export default SketchConstraintsWorkbenchHost;
