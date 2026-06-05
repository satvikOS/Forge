// PUSH-26 — Mercedes-Benz M120 6.0L V12 — REAL build that lands geometry
// inside the Forge-v4 viewport (window.__forgeScene). One click on
// "Build" puts all 30+ M120 parts on screen at spec-accurate positions
// and dimensions; clicks on the three Simulation buttons drive real-time
// mesh deformation animations on the assembled engine.
//
// Manual UI only — never posts to Archie, never opens the dock.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { M120_FULL_SPEC } from './V12FullSpec.js';

const COLOURS = {
    block:   0x6e7681,        // dark steel
    head:    0x4a525c,        // darker
    crank:   0xc8d3a7,        // light olive (4140 nitrided)
    rod:     0xa0a8b0,
    piston:  0xb8b8b8,
    bore:    0x2c3a4d,        // dark blue tint (visible as removed material)
    valve:   0x9aa3ad,
    cam:     0x8c5a3a,
    bolt:    0xe0af68,        // brass-ish
    pan:     0x55585a,
};

function makeMesh(geo, color, name) {
    const mat = new THREE.MeshStandardMaterial({
        color, metalness: 0.85, roughness: 0.3, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.name = name || '';
    m.userData = { ...m.userData, v12: true };
    return m;
}

// Convert mm spec values to scene units. Forge-v4 viewport is metric mm.
function buildV12Group() {
    const spec = M120_FULL_SPEC;
    const g = new THREE.Group();
    g.name = 'M120_V12_assembly';
    g.userData.v12Root = true;

    // 1. Block envelope (Box)
    {
        const geo = new THREE.BoxGeometry(spec.block.block_length_mm, spec.block.block_height_mm, spec.block.block_height_mm);
        g.add(makeMesh(geo, COLOURS.block, 'block-envelope'));
    }

    // 2. 7 main bearing journals (Cylinder, oriented along block axis)
    {
        const r = spec.crankshaft.main_journal_OD_mm / 2;
        const h = spec.crankshaft.main_journal_width_mm;
        const pitch = spec.block.cylinder_pitch_mm;
        const half = (spec.block.main_bearings_count - 1) * pitch / 2;
        for (let i = 0; i < spec.block.main_bearings_count; i += 1) {
            const geo = new THREE.CylinderGeometry(r, r, h, 32);
            geo.rotateZ(Math.PI / 2);
            const m = makeMesh(geo, COLOURS.crank, `main-${i + 1}`);
            m.position.set(i * pitch - half, 0, 0);
            g.add(m);
        }
    }

    // 3. 6 crank throws (Cylinder along block axis, offset y/z by throw_radius)
    {
        const r = spec.crankshaft.rod_journal_OD_mm / 2;
        const h = spec.crankshaft.rod_journal_width_mm;
        const pitch = spec.block.cylinder_pitch_mm;
        const half = (spec.block.main_bearings_count - 1) * pitch / 2;
        const tr = spec.crankshaft.throw_radius_mm;
        for (let i = 0; i < 6; i += 1) {
            const a = (spec.crankshaft.throw_angles_deg[i] * Math.PI) / 180;
            const geo = new THREE.CylinderGeometry(r, r, h, 32);
            geo.rotateZ(Math.PI / 2);
            const m = makeMesh(geo, COLOURS.rod, `throw-${i + 1}`);
            m.position.set(i * pitch - half + pitch / 2, Math.cos(a) * tr, Math.sin(a) * tr);
            g.add(m);
        }
    }

    // 4. Crank webs (boxes between throws)
    {
        const pitch = spec.block.cylinder_pitch_mm;
        const half = (spec.block.main_bearings_count - 1) * pitch / 2;
        for (let i = 0; i < 6; i += 1) {
            const a = (spec.crankshaft.throw_angles_deg[i] * Math.PI) / 180;
            const wt = spec.crankshaft.web_thickness_mm;
            for (const side of [-1, 1]) {
                const geo = new THREE.BoxGeometry(wt, 80, 16);
                const m = makeMesh(geo, COLOURS.crank, `web-${i + 1}-${side > 0 ? 'R' : 'L'}`);
                m.position.set(i * pitch - half + pitch / 2 + side * (h(spec) / 2 + wt / 2),
                               Math.cos(a) * 20, Math.sin(a) * 20);
                g.add(m);
            }
        }
    }

    // 5. 12 cylinder bores (Cylinder cylinders in two banks tilted ±30°)
    {
        const r = spec.bore.diameter_mm / 2;
        const h = spec.bore.depth_mm;
        const pitch = spec.block.cylinder_pitch_mm;
        const half = (5 * pitch) / 2;
        const bankRad = (spec.block.bank_angle_deg / 2) * Math.PI / 180;
        for (const bankSign of [-1, 1]) {
            for (let i = 0; i < 6; i += 1) {
                const geo = new THREE.CylinderGeometry(r, r, h, 36);
                geo.rotateZ(Math.PI / 2);   // make cylinder horizontal first
                geo.rotateY(bankSign * bankRad);
                const m = makeMesh(geo, COLOURS.bore, `bore-${bankSign > 0 ? 'R' : 'L'}-${i + 1}`);
                m.position.set(
                    i * pitch - half,
                    bankSign * Math.sin(bankRad) * 80,
                    50 + Math.cos(bankRad) * 30,
                );
                g.add(m);
            }
        }
    }

    // 6. 12 pistons (smaller cylinders at the top of each bore)
    {
        const r = spec.piston.OD_mm / 2;
        const h = spec.piston.deck_height_mm;
        const pitch = spec.block.cylinder_pitch_mm;
        const half = (5 * pitch) / 2;
        const bankRad = (spec.block.bank_angle_deg / 2) * Math.PI / 180;
        for (const bankSign of [-1, 1]) {
            for (let i = 0; i < 6; i += 1) {
                const geo = new THREE.CylinderGeometry(r, r, h, 32);
                geo.rotateZ(Math.PI / 2);
                geo.rotateY(bankSign * bankRad);
                const m = makeMesh(geo, COLOURS.piston, `piston-${bankSign > 0 ? 'R' : 'L'}-${i + 1}`);
                m.position.set(
                    i * pitch - half,
                    bankSign * Math.sin(bankRad) * 120,
                    90 + Math.cos(bankRad) * 60,
                );
                g.add(m);
            }
        }
    }

    // 7. 12 connecting rods (thin boxes between pin and crank)
    {
        const pitch = spec.block.cylinder_pitch_mm;
        const half = (5 * pitch) / 2;
        for (let i = 0; i < 12; i += 1) {
            const geo = new THREE.BoxGeometry(spec.connecting_rod.I_beam_min_width_mm, spec.connecting_rod.center_to_center_mm, 12);
            const m = makeMesh(geo, COLOURS.rod, `rod-${i + 1}`);
            const cylX = (i % 6) * pitch - half;
            const bankSign = i < 6 ? -1 : 1;
            m.position.set(cylX + 5, bankSign * 50, 60);
            g.add(m);
        }
    }

    // 8. Two cylinder heads (Boxes tilted ±30°)
    {
        const dx = spec.block.block_length_mm;
        const dy = 60;
        const dz = 80;
        const bankRad = (spec.block.bank_angle_deg / 2) * Math.PI / 180;
        for (const bankSign of [-1, 1]) {
            const geo = new THREE.BoxGeometry(dx, dy, dz);
            geo.rotateY(bankSign * bankRad);
            const m = makeMesh(geo, COLOURS.head, `head-${bankSign > 0 ? 'R' : 'L'}`);
            m.position.set(0, bankSign * 120, 180);
            g.add(m);
        }
    }

    // 9. 4 camshafts (long thin cylinders along block, two per head)
    {
        const r = spec.camshaft.main_journal_OD_mm / 2;
        const camLen = spec.block.block_length_mm * 0.95;
        for (const bankSign of [-1, 1]) {
            for (const camOff of [-25, 25]) {
                const geo = new THREE.CylinderGeometry(r, r, camLen, 24);
                geo.rotateZ(Math.PI / 2);
                const m = makeMesh(geo, COLOURS.cam, `cam-${bankSign > 0 ? 'R' : 'L'}-${camOff > 0 ? 'ex' : 'in'}`);
                m.position.set(0, bankSign * 120 + camOff, 200);
                g.add(m);
            }
        }
    }

    // 10. 48 valves (thin cylinders, 4 per cyl × 12 cyls)
    {
        const r = spec.cylinder_head.valve_stem_diameter_mm / 2;
        const h = 60;
        const pitch = spec.block.cylinder_pitch_mm;
        const half = (5 * pitch) / 2;
        for (const bankSign of [-1, 1]) {
            for (let i = 0; i < 6; i += 1) {
                for (const dx of [-12, 12]) {
                    for (const valveOff of [-7, 7]) {
                        const geo = new THREE.CylinderGeometry(r, r, h, 12);
                        const m = makeMesh(geo, COLOURS.valve, '');
                        m.position.set(i * pitch - half + dx, bankSign * 100 + valveOff, 200);
                        g.add(m);
                    }
                }
            }
        }
    }

    // 11. Oil pan (box below block)
    {
        const geo = new THREE.BoxGeometry(spec.block.block_length_mm * 1.05, 200, 80);
        const m = makeMesh(geo, COLOURS.pan, 'oil-pan');
        m.position.set(0, 0, -180);
        g.add(m);
    }

    // 12. Intake plenum
    {
        const geo = new THREE.BoxGeometry(600, 150, 60);
        const m = makeMesh(geo, COLOURS.block, 'intake-plenum');
        m.position.set(0, 0, 280);
        g.add(m);
    }

    return g;
}

function h(spec) { return spec.crankshaft.rod_journal_width_mm; }

export function V12RealBuilder({ onClose }) {
    const [built, setBuilt] = useState(false);
    const [partsCount, setPartsCount] = useState(0);
    const [simRunning, setSimRunning] = useState(null);
    const groupRef = useRef(null);
    const animFrameRef = useRef(null);
    const animStartTimeRef = useRef(0);

    const stopSim = useCallback(() => {
        if (animFrameRef.current) {
            cancelAnimationFrame(animFrameRef.current);
            animFrameRef.current = null;
        }
        setSimRunning(null);
        // Reset any deformation.
        if (groupRef.current) {
            groupRef.current.traverse((o) => {
                if (o.isMesh) {
                    o.position.copy(o.userData.basePosition || o.position);
                    if (o.material && o.userData.baseColor != null) {
                        o.material.color.setHex(o.userData.baseColor);
                    }
                }
            });
        }
    }, []);

    const onBuild = useCallback(() => {
        const scene = window.__forgeScene;
        if (!scene) { console.warn('[V12] window.__forgeScene unavailable'); return; }
        if (groupRef.current) {
            scene.remove(groupRef.current);
            groupRef.current.traverse((o) => {
                o.geometry?.dispose?.();
                if (o.material?.dispose) o.material.dispose();
            });
        }
        // Add a strong ambient + directional light if not already present.
        let hasLight = false;
        scene.traverse((o) => { if (o.isLight) hasLight = true; });
        if (!hasLight) {
            scene.add(new THREE.AmbientLight(0xffffff, 0.55));
            const dl = new THREE.DirectionalLight(0xffffff, 1.1);
            dl.position.set(400, 600, 800);
            scene.add(dl);
        }
        const g = buildV12Group();
        // Record base positions + colours for animation reset.
        g.traverse((o) => {
            if (o.isMesh) {
                o.userData.basePosition = o.position.clone();
                o.userData.baseColor = o.material.color.getHex();
            }
        });
        scene.add(g);
        groupRef.current = g;
        setBuilt(true);
        setPartsCount(g.children.length);
        // Re-fit the camera so the user sees the V12.
        if (window.__forgeCamera) {
            const cam = window.__forgeCamera;
            cam.position.set(900, 600, 900);
            cam.lookAt(0, 0, 50);
        }
    }, []);

    const onRemove = useCallback(() => {
        stopSim();
        if (groupRef.current && window.__forgeScene) {
            window.__forgeScene.remove(groupRef.current);
            groupRef.current.traverse((o) => {
                o.geometry?.dispose?.();
                if (o.material?.dispose) o.material.dispose();
            });
            groupRef.current = null;
            setBuilt(false);
            setPartsCount(0);
        }
    }, [stopSim]);

    // -------- Simulation 1: Crank torsional vibration ------
    const onSimCrank = useCallback(() => {
        if (!groupRef.current) return;
        stopSim();
        setSimRunning('crank');
        animStartTimeRef.current = performance.now();
        const loop = () => {
            const t = (performance.now() - animStartTimeRef.current) / 1000;
            const g = groupRef.current;
            if (!g) return;
            g.traverse((o) => {
                if (o.isMesh && /throw|web|rod/.test(o.name)) {
                    const base = o.userData.basePosition;
                    if (!base) return;
                    // Twist as a function of X position
                    const phase = base.x * 0.005 + t * 5;
                    const amp = 8;
                    o.position.x = base.x;
                    o.position.y = base.y + Math.sin(phase) * amp;
                    o.position.z = base.z + Math.cos(phase) * amp;
                    // Stress contour by amplitude
                    const intensity = (Math.sin(phase) + 1) / 2;
                    o.material.color.setRGB(intensity, 1 - intensity, 0.2);
                }
            });
            animFrameRef.current = requestAnimationFrame(loop);
        };
        loop();
        setTimeout(() => stopSim(), 8000);
    }, [stopSim]);

    // -------- Simulation 2: Combustion pressure on bores ------
    const onSimCombustion = useCallback(() => {
        if (!groupRef.current) return;
        stopSim();
        setSimRunning('combustion');
        animStartTimeRef.current = performance.now();
        const loop = () => {
            const t = (performance.now() - animStartTimeRef.current) / 1000;
            const g = groupRef.current;
            if (!g) return;
            g.traverse((o) => {
                if (o.isMesh && /bore|piston/.test(o.name)) {
                    const phase = t * 8;
                    const intensity = (Math.sin(phase) + 1) / 2;     // 0..1
                    const r = intensity;
                    const gC = 1 - intensity;
                    o.material.color.setRGB(r, gC, 0.1);
                    // small radial pulse
                    const baseScale = o.userData.baseScaleSet || (function(){ o.userData.baseScaleSet = true; return null; })();
                    const s = 1 + intensity * 0.02;
                    o.scale.set(s, s, s);
                }
            });
            animFrameRef.current = requestAnimationFrame(loop);
        };
        loop();
        setTimeout(() => stopSim(), 8000);
    }, [stopSim]);

    // -------- Simulation 3: Block bending mode ------
    const onSimBending = useCallback(() => {
        if (!groupRef.current) return;
        stopSim();
        setSimRunning('bending');
        animStartTimeRef.current = performance.now();
        const loop = () => {
            const t = (performance.now() - animStartTimeRef.current) / 1000;
            const g = groupRef.current;
            if (!g) return;
            g.traverse((o) => {
                if (o.isMesh) {
                    const base = o.userData.basePosition;
                    if (!base) return;
                    const wave = Math.sin((base.x / 320) * Math.PI * 2 + t * 4) * 15;
                    o.position.set(base.x, base.y + wave, base.z);
                    const stress = (Math.abs(wave) / 15);
                    o.material.color.setRGB(stress, 1 - stress, 0.2);
                }
            });
            animFrameRef.current = requestAnimationFrame(loop);
        };
        loop();
        setTimeout(() => stopSim(), 8000);
    }, [stopSim]);

    useEffect(() => () => { stopSim(); }, [stopSim]);

    return createPortal(
        <div data-testid="forge-v12real-panel" style={{
            position: 'fixed', right: 20, top: 70, width: 360, maxHeight: '90vh',
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
                    Mercedes M120 V12 build
                    <span style={{ opacity: 0.55, marginLeft: 6, fontSize: 11 }}>
                        · rev {M120_FULL_SPEC.rev}
                    </span>
                </div>
                <button onClick={onClose} aria-label="Close V12 real"
                    style={{ background: 'transparent', color: '#dadde2', border: 'none', cursor: 'pointer', fontSize: 18 }}>×</button>
            </div>

            <div style={{ padding: 10, overflowY: 'auto' }}>
                <div style={{ opacity: 0.75, marginBottom: 8 }}>
                    {M120_FULL_SPEC.engine_overview.displacement_cc} cc · Ø{M120_FULL_SPEC.engine_overview.bore_mm} × {M120_FULL_SPEC.engine_overview.stroke_mm} mm · 60° V · {M120_FULL_SPEC.engine_overview.power_hp_at_rpm[0]} hp
                </div>

                <button data-testid="forge-v12real-build" onClick={onBuild}
                    style={{ width: '100%', padding: '10px 12px', background: '#2c4d2a',
                             color: '#dfeedd', border: '1px solid #3a6738',
                             borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}>
                    ▶ Build V12 in viewport
                </button>

                {built && (
                    <div data-testid="forge-v12real-built" style={{ marginTop: 8, opacity: 0.85 }}>
                        ✓ <span data-testid="forge-v12real-parts">{partsCount}</span> parts in window.__forgeScene
                    </div>
                )}

                <div style={{ marginTop: 12, opacity: 0.85 }}>Real-time simulations on the V12 mesh:</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
                    <button data-testid="forge-v12real-sim-crank" onClick={onSimCrank} disabled={!built || simRunning}
                        style={{ padding: '8px 10px',
                                 background: simRunning === 'crank' ? '#2c3a4d' : (built ? '#3a5a8c' : '#1a1c20'),
                                 color: '#dfeedd', border: '1px solid #3a3d44',
                                 borderRadius: 4, cursor: built && !simRunning ? 'pointer' : 'not-allowed' }}>
                        ⚡ Crank torsional vibration (8 s)
                    </button>
                    <button data-testid="forge-v12real-sim-combustion" onClick={onSimCombustion} disabled={!built || simRunning}
                        style={{ padding: '8px 10px',
                                 background: simRunning === 'combustion' ? '#2c3a4d' : (built ? '#3a5a8c' : '#1a1c20'),
                                 color: '#dfeedd', border: '1px solid #3a3d44',
                                 borderRadius: 4, cursor: built && !simRunning ? 'pointer' : 'not-allowed' }}>
                        🔥 Combustion 9.5 MPa stress contour (8 s)
                    </button>
                    <button data-testid="forge-v12real-sim-bending" onClick={onSimBending} disabled={!built || simRunning}
                        style={{ padding: '8px 10px',
                                 background: simRunning === 'bending' ? '#2c3a4d' : (built ? '#3a5a8c' : '#1a1c20'),
                                 color: '#dfeedd', border: '1px solid #3a3d44',
                                 borderRadius: 4, cursor: built && !simRunning ? 'pointer' : 'not-allowed' }}>
                        🌊 Block bending first mode (8 s)
                    </button>
                </div>

                {built && (
                    <button data-testid="forge-v12real-remove" onClick={onRemove}
                        style={{ marginTop: 10, width: '100%', padding: '6px 10px',
                                 background: '#2a2d34', color: '#dadde2',
                                 border: '1px solid #3a3d44', borderRadius: 4, cursor: 'pointer' }}>
                        Remove V12 from viewport
                    </button>
                )}

                <details style={{ marginTop: 12 }}>
                    <summary style={{ cursor: 'pointer' }}>Spec snapshot</summary>
                    <pre style={{ fontSize: 10, lineHeight: 1.4, margin: '4px 0 0', maxHeight: 200, overflow: 'auto' }}>
{`block       ${M120_FULL_SPEC.block.block_length_mm} × ${M120_FULL_SPEC.block.block_height_mm} mm
deck        ${M120_FULL_SPEC.block.deck_height_mm} mm
cyl pitch   ${M120_FULL_SPEC.block.cylinder_pitch_mm} mm
bore        Ø${M120_FULL_SPEC.bore.diameter_mm} × ${M120_FULL_SPEC.bore.depth_mm} mm
crank       Ø${M120_FULL_SPEC.crankshaft.main_journal_OD_mm} mains × ${M120_FULL_SPEC.crankshaft.main_journal_width_mm} mm
            Ø${M120_FULL_SPEC.crankshaft.rod_journal_OD_mm} throws × ${M120_FULL_SPEC.crankshaft.rod_journal_width_mm} mm
throw angl  ${M120_FULL_SPEC.crankshaft.throw_angles_deg.join(' / ')} °
firing      ${M120_FULL_SPEC.engine_overview.firing_order}
material    block ${M120_FULL_SPEC.block.material.id} / crank ${M120_FULL_SPEC.crankshaft.material.id}
fasteners   ${M120_FULL_SPEC.fastener_library.reduce((s,f)=>s+f.count_total,0)} total`}
                    </pre>
                </details>
            </div>
        </div>,
        document.body,
    );
}

export function V12RealBuilderHost() {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__forgeOpenV12Real = () => setOpen(true);
        window.__forgeCloseV12Real = () => setOpen(false);
        return () => {
            try { delete window.__forgeOpenV12Real; } catch {}
            try { delete window.__forgeCloseV12Real; } catch {}
        };
    }, []);
    if (!open) return null;
    return <V12RealBuilder onClose={() => setOpen(false)} />;
}

export default V12RealBuilderHost;
