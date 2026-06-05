// PUSH-21 — Mercedes-Benz M120 6.0L V12 engine builder workbench.
//
// Reference: M120 in the 1991-2002 S600 / SL600 / CL600 / Maybach + the
// McLaren F1's BMW S70/2 (same architecture). Specifications:
//   - Displacement   5987 cc
//   - Bore × stroke  89.0 mm × 80.2 mm
//   - V-angle        60°
//   - 12 cylinders   2 banks of 6 (firing 1-12-5-8-3-10-6-7-2-11-4-9)
//   - DOHC 48 valves (4 per cylinder)
//   - 7 main bearings
//   - Bore spacing   106 mm (block length 6 × 106 = 636 mm)
//   - Deck height    220 mm (top of block to crank centerline)
//   - All-aluminium block + heads
//
// This workbench drives geometry creation through the native kernel surface
// one body at a time, mirroring the way a human would click "Add bore" 26
// times while watching the parts list fill up. Each click calls window.forge
// .makeCylinder(...) (contextBridge-exposed) and pushes a row to the parts
// list. A 2D top-down SVG preview shows the V12 layout taking shape so
// remote-desktop watchers can see real geometric progress.
//
// Manual UI only — never posts to Archie, never opens the dock.

import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';

// M120 design parameters in mm. Everything below is derived from these.
const M120 = {
    bore:        89.0,
    stroke:      80.2,
    bankAngle:   60,            // degrees between banks
    cylSpacing:  106,           // mm between adjacent cylinders on a bank
    deckHeight:  220,           // mm crank-CL → deck face
    boreDepth:   86,            // mm bore depth into deck
    mainBearing: { OD: 70, width: 26 },
    crankPin:    { OD: 60, width: 24, throw: 40.1 },
    blockLength: 636,           // = 6 cylinders × 106 mm pitch
};

// Build the canonical list of 26 bodies for the M120 block skeleton.
function makeM120Recipe() {
    const recipe = [];
    const angRad = (M120.bankAngle / 2) * Math.PI / 180;
    // 12 cylinder bores — 6 per bank, alternating left / right banks down
    // the engine length. Bore axes lean ±30° from vertical.
    for (let i = 0; i < 6; i += 1) {
        for (const bank of ['L', 'R']) {
            const cylNo = i * 2 + (bank === 'L' ? 1 : 2);
            const offsetY = bank === 'L' ? -Math.sin(angRad) * 100 : +Math.sin(angRad) * 100;
            const offsetZ = Math.cos(angRad) * (M120.deckHeight - M120.boreDepth);
            recipe.push({
                role:    'bore',
                cylNo,
                bank,
                shape:   'cylinder',
                radius:  M120.bore / 2,
                height:  M120.boreDepth,
                x:       i * M120.cylSpacing - (M120.blockLength / 2),
                y:       offsetY,
                z:       offsetZ,
                note:    `Cyl ${cylNo} bank ${bank} bore Ø${M120.bore}`,
            });
        }
    }
    // 7 main bearings on the crankshaft centerline.
    for (let i = 0; i < 7; i += 1) {
        recipe.push({
            role:    'main',
            cylNo:   null,
            bank:    null,
            shape:   'cylinder',
            radius:  M120.mainBearing.OD / 2,
            height:  M120.mainBearing.width,
            x:       i * M120.cylSpacing - (M120.blockLength / 2),
            y:       0,
            z:       0,
            note:    `Main bearing ${i + 1} Ø${M120.mainBearing.OD}`,
        });
    }
    // 6 crank throws between the mains.
    const THROW_ANGLES = [0, 120, 240, 60, 180, 300];   // 60° between adjacent throws on a flat V12
    for (let i = 0; i < 6; i += 1) {
        const a = (THROW_ANGLES[i] * Math.PI) / 180;
        recipe.push({
            role:    'throw',
            cylNo:   null,
            bank:    null,
            shape:   'cylinder',
            radius:  M120.crankPin.OD / 2,
            height:  M120.crankPin.width,
            x:       i * M120.cylSpacing - (M120.blockLength / 2) + (M120.cylSpacing / 2),
            y:       Math.cos(a) * M120.crankPin.throw,
            z:       Math.sin(a) * M120.crankPin.throw,
            note:    `Crank throw ${i + 1} @ ${THROW_ANGLES[i]}°`,
        });
    }
    return recipe;
}

export function V12EngineBuilder({ onClose }) {
    const surface = typeof window !== 'undefined' && window.forge;
    const hasKernel = !!(surface && typeof surface.makeCylinder === 'function');

    const recipe = useMemo(makeM120Recipe, []);
    const [built, setBuilt] = useState([]);       // [{ role, cylNo, handle, ... }]
    const [error, setError] = useState(null);

    const nextStep = built.length;
    const total = recipe.length;
    const done = nextStep >= total;

    const onAddOne = useCallback(() => {
        if (!hasKernel || done) return;
        try {
            const spec = recipe[nextStep];
            const handle = surface.makeCylinder(spec.radius, spec.height);
            // Position the new body.
            if (typeof surface.translate === 'function') {
                surface.translate(handle, spec.x, spec.y, spec.z);
            }
            setBuilt((b) => [...b, { ...spec, handle, index: nextStep }]);
            setError(null);
        } catch (ex) { setError(String(ex.message || ex)); }
    }, [hasKernel, done, recipe, nextStep, surface]);

    const onReset = useCallback(() => {
        setBuilt([]);
        setError(null);
    }, []);

    const counts = useMemo(() => {
        const c = { bore: 0, main: 0, throw: 0 };
        for (const b of built) c[b.role] = (c[b.role] || 0) + 1;
        return c;
    }, [built]);

    return createPortal(
        <div data-testid="forge-v12-panel" style={{
            position: 'fixed', right: 24, top: 80, width: 560, maxHeight: '88vh',
            background: '#181a1f', color: '#dadde2', border: '1px solid #2a2d34',
            borderRadius: 10, fontSize: 12, fontFamily: 'system-ui, sans-serif',
            boxShadow: '0 6px 22px rgba(0,0,0,0.45)', zIndex: 950,
            display: 'flex', flexDirection: 'column',
        }}>
            <div style={{
                padding: '8px 12px', borderBottom: '1px solid #2a2d34',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
                <div>
                    Mercedes-Benz M120 6.0L V12
                    <span style={{ opacity: 0.55, marginLeft: 6 }}>· PUSH-21 · engine builder</span>
                </div>
                <button onClick={onClose} aria-label="Close V12 builder"
                    style={{ background: 'transparent', color: '#dadde2', border: 'none',
                             cursor: 'pointer', fontSize: 18 }}>×</button>
            </div>

            <div style={{ padding: 10, overflowY: 'auto' }}>
                <div style={{ opacity: 0.7, marginBottom: 8, lineHeight: 1.55 }}>
                    Reference: M120 V12 — bore Ø{M120.bore} × stroke {M120.stroke} mm,
                    60° V, 7 mains, 5987 cc.<br />
                    Native kernel: {hasKernel ? '✓ ready' : '✗ unavailable'}.
                </div>

                <div style={{
                    background: '#0e1014', border: '1px solid #2a2d34',
                    borderRadius: 4, padding: 8, marginBottom: 8,
                }}>
                    <div><strong>Progress</strong></div>
                    <div data-testid="forge-v12-progress">
                        Bodies built: <span data-testid="forge-v12-count">{built.length}</span> / {total}
                    </div>
                    <div style={{ opacity: 0.8 }}>
                        Bores: <span data-testid="forge-v12-bore-count">{counts.bore || 0}</span> /12 ·
                        Mains: <span data-testid="forge-v12-main-count">{counts.main || 0}</span> /7 ·
                        Throws: <span data-testid="forge-v12-throw-count">{counts.throw || 0}</span> /6
                    </div>
                </div>

                <div style={{ marginBottom: 8 }}>
                    Next part:&nbsp;
                    <strong data-testid="forge-v12-next-note">
                        {done ? '— complete —' : recipe[nextStep].note}
                    </strong>
                </div>

                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                    <button data-testid="forge-v12-add-one" onClick={onAddOne} disabled={!hasKernel || done}
                        style={{
                            flex: 2, padding: '8px 12px',
                            background: done ? '#1a1c20' : '#2c4d2a',
                            color: '#dfeedd', border: '1px solid #3a6738',
                            borderRadius: 4, cursor: done ? 'not-allowed' : 'pointer',
                            fontWeight: 600,
                        }}>
                        {done ? 'V12 complete' : `Add part ${nextStep + 1}/${total}`}
                    </button>
                    <button data-testid="forge-v12-reset" onClick={onReset}
                        style={{
                            flex: 1, padding: '8px 12px',
                            background: '#2a2d34', color: '#dadde2',
                            border: '1px solid #3a3d44', borderRadius: 4, cursor: 'pointer',
                        }}>
                        Reset
                    </button>
                </div>

                {error && (
                    <div data-testid="forge-v12-error" style={{
                        marginTop: 8, padding: 8, background: '#3a1f1f', color: '#f1c4c4',
                        border: '1px solid #6d3434', borderRadius: 4,
                    }}>{error}</div>
                )}

                {/* 2D top-down preview SVG showing built parts in plan. */}
                <div style={{ marginTop: 10 }}>
                    <div style={{ opacity: 0.85, marginBottom: 4 }}>Top-down plan view (mm scale)</div>
                    <svg data-testid="forge-v12-preview" viewBox="-340 -110 680 220"
                         style={{ width: '100%', height: 180,
                                  background: '#0e1014', border: '1px solid #2a2d34',
                                  borderRadius: 4 }}>
                        {/* crank centerline */}
                        <line x1="-330" y1="0" x2="330" y2="0" stroke="#3a3d44" strokeDasharray="4,3" />
                        {built.map((b, i) => {
                            const color = b.role === 'bore' ? '#7aa2f7'
                                : b.role === 'main' ? '#e0af68' : '#9ece6a';
                            return (
                                <circle key={i}
                                    cx={b.x} cy={b.y} r={b.radius * 0.5}
                                    fill={color} fillOpacity="0.35" stroke={color} strokeWidth="1.2"
                                    data-testid={`forge-v12-svg-body-${i}`}
                                />
                            );
                        })}
                    </svg>
                    <div style={{ marginTop: 4, fontSize: 11, opacity: 0.7 }}>
                        <span style={{ color: '#7aa2f7' }}>● bore</span>{' · '}
                        <span style={{ color: '#e0af68' }}>● main bearing</span>{' · '}
                        <span style={{ color: '#9ece6a' }}>● crank throw</span>
                    </div>
                </div>

                {/* Parts list */}
                <details open style={{ marginTop: 10 }}>
                    <summary style={{ cursor: 'pointer' }}>Parts list ({built.length})</summary>
                    <ol style={{ margin: '4px 0 0 18px', padding: 0, fontSize: 11, lineHeight: 1.5 }}>
                        {built.map((b, i) => (
                            <li key={i} data-testid={`forge-v12-row-${i}`}>
                                #{b.handle} · {b.note} · @({b.x.toFixed(0)},{b.y.toFixed(0)},{b.z.toFixed(0)})
                            </li>
                        ))}
                    </ol>
                </details>
            </div>
        </div>,
        document.body,
    );
}

export function V12EngineBuilderHost() {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__forgeOpenV12Builder = () => setOpen(true);
        window.__forgeCloseV12Builder = () => setOpen(false);
        return () => {
            try { delete window.__forgeOpenV12Builder; } catch {}
            try { delete window.__forgeCloseV12Builder; } catch {}
        };
    }, []);
    if (!open) return null;
    return <V12EngineBuilder onClose={() => setOpen(false)} />;
}

export default V12EngineBuilderHost;
