// PUSH-29 — V12 Studio.
//
// A real CAD workbench mounted in Forge-v4. Has a ribbon of tool buttons
// (Sketch / Solid / Modify / Pattern / View) — each button opens a
// parameter dialog, the user (or Playwright) types values, hits Confirm,
// and the platform runs the matching Manifold-3D atomic CAD op. The
// resulting solid lands in window.__forgeScene at the right scale so it
// appears live in the viewport. Every body is a coherent boolean result
// of sketch → extrude → modify, not a stack of free-floating primitives.
//
// Manual UI only — never posts to Archie, never opens the dock.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';

import {
    createPart, startSketch, sketchRectangle, sketchCircle, sketchPolyline,
    sketchPolygon, finishSketch, extrude, cut, revolve, circularPattern,
    linearPattern, translate, rotate, fillet,
} from '../kernel/atomic/AtomicOps.js';
import { manifoldToMesh } from '../foundation/ManifoldThreeBridge.js';

// ----------------------------------------------------------------- ribbon
const RIBBON = [
    {
        tab: 'sketch', label: 'Sketch', tools: [
            { id: 'new-part',     label: 'New Part' },
            { id: 'sketch-xy',    label: 'Sketch XY' },
            { id: 'sketch-xz',    label: 'Sketch XZ' },
            { id: 'sketch-yz',    label: 'Sketch YZ' },
            { id: 'sk-circle',    label: 'Circle' },
            { id: 'sk-rect',      label: 'Rectangle' },
            { id: 'sk-polygon',   label: 'Polygon' },
            { id: 'finish-sketch',label: 'Finish Sketch' },
        ],
    },
    {
        tab: 'solid', label: 'Solid', tools: [
            { id: 'extrude',      label: 'Extrude' },
            { id: 'cut',          label: 'Cut Extrude' },
            { id: 'revolve',      label: 'Revolve' },
        ],
    },
    {
        tab: 'modify', label: 'Modify', tools: [
            { id: 'translate',    label: 'Translate' },
            { id: 'rotate',       label: 'Rotate' },
            { id: 'fillet',       label: 'Fillet' },
        ],
    },
    {
        tab: 'pattern', label: 'Pattern', tools: [
            { id: 'lpattern',     label: 'Linear Pattern' },
            { id: 'cpattern',     label: 'Circular Pattern' },
        ],
    },
    {
        tab: 'view', label: 'View', tools: [
            { id: 'view-iso',     label: 'Iso' },
            { id: 'view-front',   label: 'Front' },
            { id: 'view-top',     label: 'Top' },
            { id: 'view-right',   label: 'Right' },
        ],
    },
];

// Per-tool parameter schemas — drive the in-dialog inputs.
const PARAMS = {
    'new-part':     [{ name: 'name', label: 'Part name', type: 'text', def: 'Part-1' }],
    'sketch-xy':    [],
    'sketch-xz':    [],
    'sketch-yz':    [],
    'sk-circle':    [
        { name: 'r',  label: 'Radius (mm)', type: 'number', def: 10 },
        { name: 'cx', label: 'Centre X (mm)', type: 'number', def: 0 },
        { name: 'cy', label: 'Centre Y (mm)', type: 'number', def: 0 },
    ],
    'sk-rect':      [
        { name: 'w',  label: 'Width (mm)', type: 'number', def: 40 },
        { name: 'h',  label: 'Height (mm)', type: 'number', def: 30 },
        { name: 'cx', label: 'Centre X (mm)', type: 'number', def: 0 },
        { name: 'cy', label: 'Centre Y (mm)', type: 'number', def: 0 },
    ],
    'sk-polygon':   [
        { name: 'r',  label: 'Circumscribed radius (mm)', type: 'number', def: 25 },
        { name: 'n',  label: 'Sides', type: 'number', def: 6 },
        { name: 'cx', label: 'Centre X (mm)', type: 'number', def: 0 },
        { name: 'cy', label: 'Centre Y (mm)', type: 'number', def: 0 },
    ],
    'finish-sketch':[],
    'extrude':      [{ name: 'dist', label: 'Distance (mm)', type: 'number', def: 20 }],
    'cut':          [{ name: 'dist', label: 'Cut depth (mm)', type: 'number', def: 20 }],
    'revolve':      [{ name: 'angle', label: 'Angle (deg)', type: 'number', def: 360 }],
    'translate':    [
        { name: 'dx', label: 'dX (mm)', type: 'number', def: 0 },
        { name: 'dy', label: 'dY (mm)', type: 'number', def: 0 },
        { name: 'dz', label: 'dZ (mm)', type: 'number', def: 0 },
    ],
    'rotate':       [
        { name: 'angle', label: 'Angle (deg)', type: 'number', def: 90 },
        { name: 'ax', label: 'Axis X', type: 'number', def: 0 },
        { name: 'ay', label: 'Axis Y', type: 'number', def: 0 },
        { name: 'az', label: 'Axis Z', type: 'number', def: 1 },
    ],
    'fillet':       [{ name: 'r', label: 'Radius (mm)', type: 'number', def: 1 }],
    'lpattern':     [
        { name: 'count',    label: 'Count', type: 'number', def: 4 },
        { name: 'distance', label: 'Extrude depth (mm)', type: 'number', def: 25 },
        { name: 'dx',       label: 'dX between instances (mm)', type: 'number', def: 50 },
        { name: 'dy',       label: 'dY between instances (mm)', type: 'number', def: 0 },
    ],
    'cpattern':     [
        { name: 'count',    label: 'Count', type: 'number', def: 6 },
        { name: 'distance', label: 'Extrude depth (mm)', type: 'number', def: 25 },
        { name: 'angle',    label: 'Total angle (deg)', type: 'number', def: 360 },
    ],
    'view-iso':     [],
    'view-front':   [],
    'view-top':     [],
    'view-right':   [],
};

// ============================================================ helper: render
function ensureLights(scene) {
    let has = false;
    scene.traverse((o) => { if (o.isLight) has = true; });
    if (!has) {
        scene.add(new THREE.AmbientLight(0xffffff, 0.55));
        const dl = new THREE.DirectionalLight(0xffffff, 1.1);
        dl.position.set(40, 60, 80);
        scene.add(dl);
    }
}

function colourForPart(name = '') {
    // Stable colour per part name so different parts read distinctly.
    let h = 0;
    for (let i = 0; i < name.length; i += 1) h = ((h << 5) - h + name.charCodeAt(i)) | 0;
    const hue = (Math.abs(h) % 360) / 360;
    const col = new THREE.Color().setHSL(hue, 0.45, 0.55);
    return col.getHex();
}

function renderPartToScene(part) {
    const scene = window.__forgeScene;
    if (!scene || !part?.solid) return null;
    ensureLights(scene);
    // Remove any prior group for this part name.
    const prior = scene.children.find(
        (c) => c.userData?.v12studio && c.userData?.partName === part.name
    );
    if (prior) {
        scene.remove(prior);
        prior.traverse((o) => {
            o.geometry?.dispose?.(); o.material?.dispose?.();
        });
    }
    const mesh = manifoldToMesh(part.solid, { color: colourForPart(part.name) });
    const group = new THREE.Group();
    group.scale.set(0.001, 0.001, 0.001);    // Forge scene is metric m, atomic ops mm
    group.add(mesh);
    group.userData = { v12studio: true, partName: part.name };
    scene.add(group);
    // Auto-fit camera the first time we put anything in the scene.
    setTimeout(() => fitAllV12StudioGroups(), 30);
    return group;
}

function fitAllV12StudioGroups() {
    const cam = window.__forgeCamera;
    const orbit = window.__forgeOrbit;
    const scene = window.__forgeScene;
    if (!cam || !orbit || !scene) return;
    const box = new THREE.Box3();
    let any = false;
    scene.traverse((o) => {
        if (o.userData?.v12studio) { box.expandByObject(o); any = true; }
    });
    if (!any) return;
    const center = new THREE.Vector3(); box.getCenter(center);
    const size = new THREE.Vector3(); box.getSize(size);
    const diag = Math.max(size.length(), 0.1);
    const fov = (cam.fov * Math.PI) / 180;
    const dist = Math.max(diag / (2 * Math.tan(fov / 2)) * 2.4, 0.4);
    const dir = new THREE.Vector3(1.4, 0.6, 1.0).normalize();
    // Shift target left so geometry centres in the visible left ~75% of viewport.
    center.x -= size.length() * 0.12;
    cam.position.copy(center).add(dir.multiplyScalar(dist));
    cam.near = 0.001;
    cam.far = Math.max(100, dist * 50);
    cam.updateProjectionMatrix();
    orbit.target.copy(center);
    const wasDamping = orbit.enableDamping;
    orbit.enableDamping = false;
    orbit.update();
    let n = 0;
    const tick = () => {
        cam.position.copy(center).add(dir.clone().multiplyScalar(dist));
        cam.updateProjectionMatrix();
        orbit.target.copy(center);
        orbit.update();
        if (++n < 6) requestAnimationFrame(tick);
        else orbit.enableDamping = wasDamping;
    };
    requestAnimationFrame(tick);
}

function setCameraView(view) {
    const cam = window.__forgeCamera;
    const orbit = window.__forgeOrbit;
    if (!cam || !orbit) return;
    const dist = 1.2;
    let dir;
    switch (view) {
        case 'front': dir = new THREE.Vector3(0, -1, 0); break;
        case 'top':   dir = new THREE.Vector3(0, 0, 1); break;
        case 'right': dir = new THREE.Vector3(1, 0, 0); break;
        case 'iso':
        default:      dir = new THREE.Vector3(1.4, 0.6, 1.0).normalize(); break;
    }
    const target = new THREE.Vector3(0, 0, 0);
    cam.position.copy(target).add(dir.multiplyScalar(dist));
    cam.near = 0.001;
    cam.far = 100;
    cam.updateProjectionMatrix();
    orbit.target.copy(target);
    orbit.update();
}

// ============================================================ component
export function V12Studio({ onClose }) {
    const [parts, setParts] = useState({});       // { name: Part }
    const [activePartName, setActivePartName] = useState(null);
    const [history, setHistory] = useState([]);   // [{ tool, params, partName }]
    const [activeTab, setActiveTab] = useState('sketch');
    const [dialogTool, setDialogTool] = useState(null);
    const [dialogValues, setDialogValues] = useState({});
    const [error, setError] = useState(null);

    const log = useCallback((entry) => setHistory((h) => [...h, entry]), []);

    const openDialog = useCallback((toolId) => {
        const schema = PARAMS[toolId] || [];
        const defaults = {};
        for (const f of schema) defaults[f.name] = f.def;
        setDialogTool(toolId);
        setDialogValues(defaults);
        setError(null);
    }, []);

    const closeDialog = useCallback(() => {
        setDialogTool(null);
        setDialogValues({});
    }, []);

    const updateValue = useCallback((name, val) => {
        setDialogValues((v) => ({ ...v, [name]: val }));
    }, []);

    const ensurePart = () => {
        if (activePartName && parts[activePartName]) return parts[activePartName];
        const name = 'Part-1';
        const p = createPart(name);
        setParts((prev) => ({ ...prev, [name]: p }));
        setActivePartName(name);
        return p;
    };

    const runTool = useCallback(async () => {
        const tool = dialogTool;
        const v = dialogValues;
        try {
            switch (tool) {
                case 'new-part': {
                    const name = v.name || `Part-${Object.keys(parts).length + 1}`;
                    const p = createPart(name);
                    setParts((prev) => ({ ...prev, [name]: p }));
                    setActivePartName(name);
                    log({ tool, params: v, partName: name });
                    break;
                }
                case 'sketch-xy': case 'sketch-xz': case 'sketch-yz': {
                    const p = ensurePart();
                    const plane = tool === 'sketch-xy' ? 'XY' : tool === 'sketch-xz' ? 'XZ' : 'YZ';
                    await startSketch(p, plane);
                    log({ tool, params: { plane }, partName: p.name });
                    break;
                }
                case 'sk-circle': {
                    const p = ensurePart();
                    sketchCircle(p, +v.cx, +v.cy, +v.r);
                    log({ tool, params: v, partName: p.name });
                    break;
                }
                case 'sk-rect': {
                    const p = ensurePart();
                    sketchRectangle(p, +v.cx, +v.cy, +v.w, +v.h);
                    log({ tool, params: v, partName: p.name });
                    break;
                }
                case 'sk-polygon': {
                    const p = ensurePart();
                    sketchPolygon(p, +v.cx, +v.cy, +v.r, +v.n);
                    log({ tool, params: v, partName: p.name });
                    break;
                }
                case 'finish-sketch': {
                    const p = ensurePart();
                    finishSketch(p);
                    log({ tool, params: v, partName: p.name });
                    break;
                }
                case 'extrude': {
                    const p = ensurePart();
                    await extrude(p, +v.dist);
                    renderPartToScene(p);
                    log({ tool, params: v, partName: p.name });
                    break;
                }
                case 'cut': {
                    const p = ensurePart();
                    await cut(p, +v.dist);
                    renderPartToScene(p);
                    log({ tool, params: v, partName: p.name });
                    break;
                }
                case 'revolve': {
                    const p = ensurePart();
                    await revolve(p, (+v.angle * Math.PI) / 180);
                    renderPartToScene(p);
                    log({ tool, params: v, partName: p.name });
                    break;
                }
                case 'translate': {
                    const p = ensurePart();
                    await translate(p, +v.dx, +v.dy, +v.dz);
                    renderPartToScene(p);
                    log({ tool, params: v, partName: p.name });
                    break;
                }
                case 'rotate': {
                    const p = ensurePart();
                    await rotate(p, (+v.angle * Math.PI) / 180, [+v.ax, +v.ay, +v.az]);
                    renderPartToScene(p);
                    log({ tool, params: v, partName: p.name });
                    break;
                }
                case 'fillet': {
                    const p = ensurePart();
                    await fillet(p, +v.r);
                    renderPartToScene(p);
                    log({ tool, params: v, partName: p.name });
                    break;
                }
                case 'lpattern': {
                    const p = ensurePart();
                    // AtomicOps.linearPattern signature: (part, mode, count,
                    // distance, dx, dy). It consumes pendingProfile so the
                    // user must have finishSketch'd just before clicking this.
                    await linearPattern(p, 'extrude', +v.count, +v.distance, +v.dx, +v.dy);
                    renderPartToScene(p);
                    log({ tool, params: v, partName: p.name });
                    break;
                }
                case 'cpattern': {
                    const p = ensurePart();
                    await circularPattern(p, 'extrude', +v.count, +v.distance, +v.angle);
                    renderPartToScene(p);
                    log({ tool, params: v, partName: p.name });
                    break;
                }
                case 'view-iso':   setCameraView('iso');   log({ tool, params: v }); break;
                case 'view-front': setCameraView('front'); log({ tool, params: v }); break;
                case 'view-top':   setCameraView('top');   log({ tool, params: v }); break;
                case 'view-right': setCameraView('right'); log({ tool, params: v }); break;
                default:
                    throw new Error(`Unknown tool ${tool}`);
            }
            setError(null);
            closeDialog();
        } catch (ex) {
            setError(String(ex.message || ex));
        }
    }, [dialogTool, dialogValues, parts, log, closeDialog]);   // eslint-disable-line react-hooks/exhaustive-deps

    const partList = Object.values(parts);
    const activeRibbon = RIBBON.find((r) => r.tab === activeTab);

    return createPortal(
        <>
            <div data-testid="forge-v12studio-panel" style={{
                position: 'fixed', right: 16, top: 60, width: 350, maxHeight: '90vh',
                background: '#181a1f', color: '#dadde2', border: '1px solid #2a2d34',
                borderRadius: 10, fontSize: 12, fontFamily: 'system-ui, sans-serif',
                boxShadow: '0 6px 22px rgba(0,0,0,0.45)', zIndex: 940,
                display: 'flex', flexDirection: 'column',
            }}>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid #2a2d34',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>V12 Studio <span style={{ opacity: 0.55, fontSize: 11 }}>· PUSH-29 · real CAD</span></div>
                    <button onClick={onClose} aria-label="Close V12 Studio"
                        style={{ background: 'transparent', color: '#dadde2', border: 'none',
                                 cursor: 'pointer', fontSize: 18 }}>×</button>
                </div>

                {/* Tab strip */}
                <div data-testid="forge-v12studio-tabs"
                     style={{ display: 'flex', gap: 4, padding: '6px 8px',
                              borderBottom: '1px solid #2a2d34', background: '#1e2129' }}>
                    {RIBBON.map((r) => (
                        <button key={r.tab}
                            data-testid={`forge-v12studio-tab-${r.tab}`}
                            onClick={() => setActiveTab(r.tab)}
                            style={{
                                padding: '4px 8px', fontSize: 11,
                                background: activeTab === r.tab ? '#2c4d2a' : '#2a2d34',
                                color: '#dadde2', border: '1px solid #3a3d44',
                                borderRadius: 3, cursor: 'pointer',
                            }}>{r.label}</button>
                    ))}
                </div>

                {/* Tool palette */}
                <div data-testid="forge-v12studio-tools"
                     style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)',
                              gap: 4, padding: 8, borderBottom: '1px solid #2a2d34' }}>
                    {activeRibbon?.tools.map((t) => (
                        <button key={t.id}
                            data-testid={`forge-v12studio-tool-${t.id}`}
                            onClick={() => openDialog(t.id)}
                            style={{
                                padding: '6px 4px', fontSize: 11,
                                background: '#2a2d34', color: '#dadde2',
                                border: '1px solid #3a3d44', borderRadius: 3,
                                cursor: 'pointer', textAlign: 'left',
                            }}>{t.label}</button>
                    ))}
                </div>

                {/* Part state */}
                <div style={{ padding: 8, fontSize: 11, opacity: 0.85 }}>
                    Active part: <span data-testid="forge-v12studio-active-part">{activePartName || '—'}</span><br />
                    Parts: <span data-testid="forge-v12studio-parts-count">{partList.length}</span> ·
                    History: <span data-testid="forge-v12studio-history-count">{history.length}</span> ops
                </div>

                {/* Recent ops */}
                <div style={{ padding: '0 8px 8px', overflowY: 'auto', maxHeight: 220 }}>
                    <details open>
                        <summary style={{ cursor: 'pointer', fontSize: 11 }}>History</summary>
                        <ol data-testid="forge-v12studio-history"
                            style={{ margin: '4px 0 0 18px', padding: 0, fontSize: 10.5,
                                     lineHeight: 1.45, color: '#9ece6a' }}>
                            {history.slice(-25).map((e, i) => (
                                <li key={i}>{e.tool} {e.partName ? `· ${e.partName}` : ''}</li>
                            ))}
                        </ol>
                    </details>
                </div>
            </div>

            {/* Parameter dialog */}
            {dialogTool && (
                <div data-testid="forge-v12studio-dialog-backdrop"
                     style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              zIndex: 1000 }}
                     onClick={closeDialog}>
                    <div data-testid="forge-v12studio-dialog"
                         onClick={(e) => e.stopPropagation()}
                         style={{ background: '#0e1014', border: '1px solid #3a3d44',
                                  borderRadius: 8, padding: 16, minWidth: 320,
                                  fontFamily: 'system-ui, sans-serif', color: '#dadde2' }}>
                        <div style={{ fontSize: 13, marginBottom: 10, fontWeight: 600 }}>
                            {RIBBON.flatMap((r) => r.tools).find((t) => t.id === dialogTool)?.label}
                        </div>
                        {(PARAMS[dialogTool] || []).map((f) => (
                            <div key={f.name} style={{ marginBottom: 8,
                                display: 'grid', gridTemplateColumns: '120px 1fr', gap: 8, alignItems: 'center' }}>
                                <label style={{ fontSize: 11 }}>{f.label}</label>
                                <input
                                    data-testid={`forge-v12studio-input-${f.name}`}
                                    type={f.type === 'number' ? 'number' : 'text'}
                                    value={dialogValues[f.name] ?? ''}
                                    step={f.type === 'number' ? 'any' : undefined}
                                    onChange={(e) => updateValue(f.name,
                                        f.type === 'number' ? e.target.value : e.target.value)}
                                    style={{ padding: '4px 6px', fontSize: 12,
                                             background: '#181a1f', color: '#dadde2',
                                             border: '1px solid #3a3d44', borderRadius: 3 }}
                                />
                            </div>
                        ))}
                        {error && (
                            <div data-testid="forge-v12studio-dialog-error" style={{
                                marginBottom: 8, padding: 6, background: '#3a1f1f',
                                color: '#f1c4c4', border: '1px solid #6d3434',
                                borderRadius: 4, fontSize: 11,
                            }}>{error}</div>
                        )}
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 8 }}>
                            <button data-testid="forge-v12studio-dialog-cancel"
                                onClick={closeDialog}
                                style={{ padding: '5px 12px', background: '#2a2d34',
                                         color: '#dadde2', border: '1px solid #3a3d44',
                                         borderRadius: 3, cursor: 'pointer' }}>Cancel</button>
                            <button data-testid="forge-v12studio-dialog-confirm"
                                onClick={runTool}
                                style={{ padding: '5px 12px', background: '#2c4d2a',
                                         color: '#dfeedd', border: '1px solid #3a6738',
                                         borderRadius: 3, cursor: 'pointer', fontWeight: 600 }}>
                                Confirm
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>,
        document.body,
    );
}

export function V12StudioHost() {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__forgeOpenV12Studio = () => setOpen(true);
        window.__forgeCloseV12Studio = () => setOpen(false);
        return () => {
            try { delete window.__forgeOpenV12Studio; } catch {}
            try { delete window.__forgeCloseV12Studio; } catch {}
        };
    }, []);
    if (!open) return null;
    return <V12Studio onClose={() => setOpen(false)} />;
}

export default V12StudioHost;
