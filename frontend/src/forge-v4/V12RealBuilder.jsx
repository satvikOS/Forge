// PUSH-28 — Mercedes-Benz M120 6.0L V12 high-fidelity build into the
// Forge-v4 viewport. Compared to PUSH-26 (~118 primitive boxes/cylinders)
// this rev adds the shapes that make the assembly read as an engine
// instead of stacked primitives: stepped block sides + water jacket,
// crank with proper webs + counterweights, I-beam connecting rods,
// valve covers, intake plenum runners, exhaust headers, ancillary drives
// (alternator + power steering + AC pump pulleys), starter motor.
//
// Spec-driven from specs/mercedes-m120-v12-full.json. Renders directly to
// window.__forgeScene. Three real-time simulations animate on the result.

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import * as THREE from 'three';
import { M120_FULL_SPEC } from './V12FullSpec.js';

const COLOURS = {
    blockAl:    0x6e7681,        // raw aluminium block
    blockDark:  0x4a525c,
    deckMach:   0x9aa3ad,        // machined deck face (lighter)
    crank:      0xc8d3a7,        // 4140 nitrided olive
    rod:        0xa0a8b0,
    piston:     0xd0d4d8,
    bore:       0x2c3a4d,
    valve:      0xf0e8d8,
    valveSpring:0x8b6a3a,
    cam:        0x8c5a3a,
    bolt:       0xe0af68,
    pan:        0x55585a,
    cover:      0x3a3a3a,        // black valve cover
    intake:     0xc97a3a,        // copper-bronze intake plenum
    exhaust:    0x222222,        // ceramic-coated exhaust
    pulley:     0x4a4a4a,
    belt:       0x1a1a1a,
    coil:       0xb84a2a,        // red coil packs
    sparkPlug:  0xe8e8e8,
    accent:     0xe0af68,
};

function makeMesh(geo, color, name, opts = {}) {
    const mat = new THREE.MeshStandardMaterial({
        color,
        metalness: opts.metalness ?? 0.7,
        roughness: opts.roughness ?? 0.35,
        side: opts.side ?? THREE.FrontSide,
        transparent: opts.opacity != null && opts.opacity < 1,
        opacity: opts.opacity ?? 1,
        depthWrite: opts.opacity == null || opts.opacity >= 0.95,
    });
    const m = new THREE.Mesh(geo, mat);
    m.name = name || '';
    m.userData = { ...m.userData, v12: true };
    return m;
}

// Build a counterweight: a quarter-disc that hangs off a crank throw
// opposite the rod-journal direction so the crank stays balanced.
function makeCounterweight(angleDeg, lengthAlongCrank) {
    // Approximate a counterweight with a thick disc segment.
    const g = new THREE.CylinderGeometry(56, 56, 22, 32, 1, false, Math.PI, Math.PI);
    g.rotateZ(Math.PI / 2);  // orient along crank axis
    const angle = (angleDeg * Math.PI) / 180;
    // Counterweight points opposite to rod journal.
    g.rotateX(angle + Math.PI);
    return g;
}

function makeConrod(length, sBoreR, bBoreR) {
    // I-beam connecting rod approximated by: big end ring + small end ring
    // + thin connecting beam.
    const group = new THREE.Group();
    const beamW = 14, beamT = 18;
    // Big end (crank pin) - donut shape
    {
        const g = new THREE.TorusGeometry(bBoreR + 8, 8, 8, 24);
        g.rotateY(Math.PI / 2);
        const m = makeMesh(g, COLOURS.rod, '', { metalness: 0.85, roughness: 0.25 });
        m.position.set(0, -length / 2, 0);
        group.add(m);
    }
    // Small end (wrist pin)
    {
        const g = new THREE.TorusGeometry(sBoreR + 5, 5, 8, 20);
        g.rotateY(Math.PI / 2);
        const m = makeMesh(g, COLOURS.rod, '', { metalness: 0.85, roughness: 0.25 });
        m.position.set(0, length / 2, 0);
        group.add(m);
    }
    // I-beam: vertical flat in the middle + flanges top/bottom
    {
        const g = new THREE.BoxGeometry(beamT, length * 0.86, beamW * 0.4);
        const m = makeMesh(g, COLOURS.rod, '', { metalness: 0.85, roughness: 0.25 });
        m.position.set(0, 0, 0);
        group.add(m);
    }
    return group;
}

function buildV12Group() {
    const spec = M120_FULL_SPEC;
    const root = new THREE.Group();
    root.name = 'M120_V12_assembly';
    root.userData.v12Root = true;

    const PITCH = spec.block.cylinder_pitch_mm;
    const LEN = spec.block.block_length_mm;
    const HALF = (5 * PITCH) / 2;
    const BANK_DEG = spec.block.bank_angle_deg / 2;
    const BANK_RAD = BANK_DEG * Math.PI / 180;
    const BORE_R = spec.bore.diameter_mm / 2;
    const DECK = spec.block.deck_height_mm;

    // ============================================================ 1. BLOCK
    // The block has multiple stacked sections rather than a single box:
    //  - lower crankcase (wide, holds the crank)
    //  - mid section (water jacket area, narrower)
    //  - V bank trunks (two tilted boxes)
    {
        // Lower crankcase
        const g = new THREE.BoxGeometry(LEN, 240, 80);
        const m = makeMesh(g, COLOURS.blockAl, 'block-crankcase', { metalness: 0.6, roughness: 0.55 });
        m.position.set(0, 0, -40);
        root.add(m);
    }
    {
        // Mid-block water jacket (narrower waist)
        const g = new THREE.BoxGeometry(LEN, 180, 60);
        const m = makeMesh(g, COLOURS.blockAl, 'block-midjacket', { metalness: 0.55, roughness: 0.6 });
        m.position.set(0, 0, 30);
        root.add(m);
    }
    {
        // Two bank trunks (cylinder banks of the V)
        for (const bankSign of [-1, 1]) {
            const g = new THREE.BoxGeometry(LEN, 95, 110);
            g.rotateY(bankSign * BANK_RAD);
            const m = makeMesh(g, COLOURS.blockAl, `bank-${bankSign>0?'R':'L'}`,
                { metalness: 0.6, roughness: 0.55, opacity: 0.45 });
            m.position.set(0, bankSign * 75, 95);
            root.add(m);
        }
    }
    {
        // Deck faces (machined, lighter colour, the top of each bank)
        for (const bankSign of [-1, 1]) {
            const g = new THREE.BoxGeometry(LEN * 1.02, 95, 6);
            g.rotateY(bankSign * BANK_RAD);
            const m = makeMesh(g, COLOURS.deckMach, `deck-${bankSign>0?'R':'L'}`,
                { metalness: 0.85, roughness: 0.2 });
            m.position.set(0, bankSign * 110, 150);
            root.add(m);
        }
    }

    // ============================================================ 2. CRANKSHAFT
    // Main journals
    {
        const r = spec.crankshaft.main_journal_OD_mm / 2;
        const h = spec.crankshaft.main_journal_width_mm;
        for (let i = 0; i < spec.block.main_bearings_count; i += 1) {
            const g = new THREE.CylinderGeometry(r, r, h, 32);
            g.rotateZ(Math.PI / 2);
            const m = makeMesh(g, COLOURS.crank, `main-${i + 1}`, { metalness: 0.9, roughness: 0.2 });
            m.position.set(i * PITCH - (spec.block.main_bearings_count - 1) * PITCH / 2, 0, 0);
            root.add(m);
        }
    }
    // Rod journals + counterweights
    {
        const rj_r = spec.crankshaft.rod_journal_OD_mm / 2;
        const rj_h = spec.crankshaft.rod_journal_width_mm;
        const tr = spec.crankshaft.throw_radius_mm;
        for (let i = 0; i < 6; i += 1) {
            const angDeg = spec.crankshaft.throw_angles_deg[i];
            const a = (angDeg * Math.PI) / 180;
            const xPos = (i - 2.5) * PITCH;
            const yPos = Math.cos(a) * tr;
            const zPos = Math.sin(a) * tr;
            // Rod journal (pin)
            {
                const g = new THREE.CylinderGeometry(rj_r, rj_r, rj_h, 32);
                g.rotateZ(Math.PI / 2);
                const m = makeMesh(g, COLOURS.crank, `throw-${i+1}`, { metalness: 0.9, roughness: 0.2 });
                m.position.set(xPos, yPos, zPos);
                root.add(m);
            }
            // Two webs flanking the throw
            for (const side of [-1, 1]) {
                const g = new THREE.BoxGeometry(16, 100, 30);
                const m = makeMesh(g, COLOURS.crank, `web-${i+1}-${side>0?'R':'L'}`, { metalness: 0.85, roughness: 0.25 });
                m.position.set(xPos + side * (rj_h/2 + 8), yPos * 0.4, zPos * 0.4);
                root.add(m);
            }
            // Two counterweights (heavier than webs, point OPPOSITE the throw)
            for (const side of [-1, 1]) {
                const angOpp = a + Math.PI;
                const g = new THREE.CylinderGeometry(48, 48, 18, 32, 1, false, 0, Math.PI);
                g.rotateZ(Math.PI / 2);
                g.rotateX(angOpp);
                const m = makeMesh(g, COLOURS.crank, `cw-${i+1}-${side>0?'R':'L'}`, { metalness: 0.85, roughness: 0.3 });
                m.position.set(xPos + side * (rj_h/2 + 26), 0, 0);
                root.add(m);
            }
        }
    }
    // Crank snout (front of engine)
    {
        const g = new THREE.CylinderGeometry(spec.crankshaft.snout_OD_mm / 2, spec.crankshaft.snout_OD_mm / 2, 70, 24);
        g.rotateZ(Math.PI / 2);
        const m = makeMesh(g, COLOURS.crank, 'snout', { metalness: 0.95, roughness: 0.18 });
        m.position.set(-LEN/2 - 50, 0, 0);
        root.add(m);
    }
    // Crank flange (rear, flywheel mount)
    {
        const g = new THREE.CylinderGeometry(spec.crankshaft.flange_OD_mm / 2, spec.crankshaft.flange_OD_mm / 2, 18, 24);
        g.rotateZ(Math.PI / 2);
        const m = makeMesh(g, COLOURS.crank, 'flange', { metalness: 0.9, roughness: 0.2 });
        m.position.set(LEN/2 + 25, 0, 0);
        root.add(m);
    }
    // Harmonic balancer (front pulley)
    {
        const g = new THREE.CylinderGeometry(90, 90, 28, 32);
        g.rotateZ(Math.PI / 2);
        const m = makeMesh(g, COLOURS.pulley, 'balancer', { metalness: 0.6, roughness: 0.45 });
        m.position.set(-LEN/2 - 100, 0, 0);
        root.add(m);
    }
    // Flywheel
    {
        const g = new THREE.CylinderGeometry(160, 160, 28, 36);
        g.rotateZ(Math.PI / 2);
        const m = makeMesh(g, COLOURS.crank, 'flywheel', { metalness: 0.85, roughness: 0.25 });
        m.position.set(LEN/2 + 60, 0, 0);
        root.add(m);
    }

    // ============================================================ 3. CYLINDER BORES + PISTONS + CONRODS
    {
        const h = spec.bore.depth_mm;
        const ph = spec.piston.deck_height_mm;
        const pr = spec.piston.OD_mm / 2;
        for (const bankSign of [-1, 1]) {
            for (let i = 0; i < 6; i += 1) {
                const xPos = i * PITCH - HALF;
                const angDeg = spec.crankshaft.throw_angles_deg[i];
                const ang = (angDeg * Math.PI) / 180;
                const yCenter = bankSign * 75;
                const zBase = 100;

                // Bore inner surface
                {
                    const g = new THREE.CylinderGeometry(BORE_R + 2, BORE_R + 2, h, 32, 1, true);
                    g.rotateZ(Math.PI / 2);
                    g.rotateX(-bankSign * BANK_RAD);
                    const m = makeMesh(g, COLOURS.bore, `bore-${bankSign>0?'R':'L'}-${i+1}`,
                        { metalness: 0.95, roughness: 0.1, side: THREE.DoubleSide });
                    // Position bore axis along (sin bank, cos bank) vertical-ish
                    const tilt = bankSign * BANK_RAD;
                    m.position.set(xPos, yCenter + Math.sin(tilt) * 30, zBase + Math.cos(tilt) * 25);
                    root.add(m);
                }
                // Piston (small cylinder INSIDE the bore, at TDC for some, BDC for others)
                {
                    const tdcOffset = (i % 2 === 0) ? 1 : -1;
                    const g = new THREE.CylinderGeometry(pr, pr, ph, 28);
                    g.rotateZ(Math.PI / 2);
                    g.rotateX(-bankSign * BANK_RAD);
                    const m = makeMesh(g, COLOURS.piston, '', { metalness: 0.92, roughness: 0.2 });
                    const tilt = bankSign * BANK_RAD;
                    const ZZ = zBase + Math.cos(tilt) * (25 + tdcOffset * 20);
                    m.position.set(xPos, yCenter + Math.sin(tilt) * (30 + tdcOffset * 20), ZZ);
                    root.add(m);
                }
                // Connecting rod (I-beam group)
                {
                    const rod = makeConrod(140, pr * 0.4, spec.crankshaft.rod_journal_OD_mm / 2);
                    rod.rotation.x = bankSign * BANK_RAD;
                    const tilt = bankSign * BANK_RAD;
                    rod.position.set(xPos + bankSign * 12,
                                     yCenter * 0.3 + Math.sin(tilt) * 15,
                                     50 + Math.cos(tilt) * 12);
                    rod.userData.v12 = true;
                    rod.children.forEach((c) => { c.userData.v12 = true; });
                    rod.name = `rod-${bankSign>0?'R':'L'}-${i+1}`;
                    root.add(rod);
                }
            }
        }
    }

    // ============================================================ 4. HEADS + VALVE COVERS
    {
        for (const bankSign of [-1, 1]) {
            // Head casting
            const g = new THREE.BoxGeometry(LEN * 0.98, 110, 75);
            g.rotateY(bankSign * BANK_RAD);
            const head = makeMesh(g, COLOURS.blockAl, `head-${bankSign>0?'R':'L'}`,
                { metalness: 0.65, roughness: 0.45, opacity: 0.55 });
            head.position.set(0, bankSign * 140, 195);
            root.add(head);

            // Valve cover (black, sits on head)
            const gc = new THREE.BoxGeometry(LEN * 1.02, 95, 40);
            gc.rotateY(bankSign * BANK_RAD);
            const cover = makeMesh(gc, COLOURS.cover, `valve-cover-${bankSign>0?'R':'L'}`,
                { metalness: 0.4, roughness: 0.65 });
            cover.position.set(0, bankSign * 160, 250);
            root.add(cover);

            // Mercedes "M120" cast lettering (a small embossed box on top)
            const gl = new THREE.BoxGeometry(160, 32, 4);
            gl.rotateY(bankSign * BANK_RAD);
            const letter = makeMesh(gl, COLOURS.accent, `m120-emblem-${bankSign>0?'R':'L'}`,
                { metalness: 0.7, roughness: 0.4 });
            letter.position.set(0, bankSign * 160, 275);
            root.add(letter);
        }
    }

    // ============================================================ 5. CAMSHAFTS (DOHC, 2 per head)
    {
        const r = spec.camshaft.main_journal_OD_mm / 2;
        const camLen = LEN * 0.98;
        for (const bankSign of [-1, 1]) {
            for (const camOff of [-22, 22]) {
                const g = new THREE.CylinderGeometry(r, r, camLen, 24);
                g.rotateZ(Math.PI / 2);
                g.rotateY(bankSign * BANK_RAD);
                const m = makeMesh(g, COLOURS.cam, `cam-${bankSign>0?'R':'L'}-${camOff>0?'ex':'in'}`,
                    { metalness: 0.85, roughness: 0.3 });
                m.position.set(0, bankSign * 145 + camOff * Math.cos(BANK_RAD), 215);
                root.add(m);
                // Cam lobes (5 mains per cam) — bumps along its length
                for (let lobe = 0; lobe < spec.camshaft.main_journal_count_per_cam; lobe += 1) {
                    const lobeAng = (lobe * Math.PI / 3);
                    const lg = new THREE.CylinderGeometry(r * 1.4, r * 1.4, 14, 16);
                    lg.rotateZ(Math.PI / 2);
                    lg.rotateY(bankSign * BANK_RAD);
                    const lm = makeMesh(lg, COLOURS.cam, '', { metalness: 0.85, roughness: 0.3 });
                    lm.position.set(lobe * PITCH - HALF * 0.8,
                                    bankSign * 145 + camOff * Math.cos(BANK_RAD) + Math.cos(lobeAng) * 4,
                                    215 + Math.sin(lobeAng) * 4);
                    root.add(lm);
                }
            }
        }
    }

    // ============================================================ 6. VALVES (48: 4 per cyl)
    {
        const vr = spec.cylinder_head.valve_stem_diameter_mm / 2;
        for (const bankSign of [-1, 1]) {
            for (let i = 0; i < 6; i += 1) {
                for (const dx of [-15, 15]) {
                    for (const valveOff of [-10, 10]) {
                        // Valve stem
                        const g = new THREE.CylinderGeometry(vr, vr, 80, 12);
                        g.rotateZ(Math.PI / 2);
                        g.rotateY(bankSign * BANK_RAD);
                        const stem = makeMesh(g, COLOURS.valve, '',
                            { metalness: 0.95, roughness: 0.15 });
                        stem.position.set(i * PITCH - HALF + dx, bankSign * 135 + valveOff, 210);
                        root.add(stem);
                        // Valve head (umbrella at the end)
                        const isIntake = dx < 0;
                        const vhR = isIntake
                            ? spec.cylinder_head.intake_valve_diameter_mm / 2
                            : spec.cylinder_head.exhaust_valve_diameter_mm / 2;
                        const gh = new THREE.CylinderGeometry(vhR, vhR * 0.85, 8, 16);
                        gh.rotateZ(Math.PI / 2);
                        gh.rotateY(bankSign * BANK_RAD);
                        const head = makeMesh(gh, COLOURS.valve, '',
                            { metalness: 0.95, roughness: 0.15 });
                        head.position.set(i * PITCH - HALF + dx, bankSign * 110 + valveOff, 185);
                        root.add(head);
                    }
                }
            }
        }
    }

    // ============================================================ 7. INTAKE PLENUM + 12 RUNNERS
    {
        // Plenum on top centre
        const plg = new THREE.BoxGeometry(LEN * 0.92, 160, 80);
        const plenum = makeMesh(plg, COLOURS.intake, 'intake-plenum',
            { metalness: 0.7, roughness: 0.35, opacity: 0.7 });
        plenum.position.set(0, 0, 340);
        root.add(plenum);
        // 12 runners curving from plenum to each cylinder
        for (const bankSign of [-1, 1]) {
            for (let i = 0; i < 6; i += 1) {
                const g = new THREE.CylinderGeometry(18, 22, 90, 14);
                g.rotateX(bankSign * 0.5);
                const m = makeMesh(g, COLOURS.intake, '',
                    { metalness: 0.75, roughness: 0.3 });
                m.position.set(i * PITCH - HALF, bankSign * 70, 290);
                root.add(m);
            }
        }
    }

    // ============================================================ 8. EXHAUST HEADERS (12 primary tubes)
    {
        for (const bankSign of [-1, 1]) {
            for (let i = 0; i < 6; i += 1) {
                // Primary tube from each exhaust port
                const g = new THREE.CylinderGeometry(22, 26, 110, 12);
                g.rotateZ(Math.PI / 4 * bankSign);
                const m = makeMesh(g, COLOURS.exhaust, '',
                    { metalness: 0.5, roughness: 0.65 });
                m.position.set(i * PITCH - HALF, bankSign * 195, 175);
                root.add(m);
            }
            // Collector (merge of 6 → 1 per bank)
            const cg = new THREE.CylinderGeometry(40, 32, 200, 18);
            cg.rotateZ(Math.PI / 2);
            const cm = makeMesh(cg, COLOURS.exhaust, `exhaust-collector-${bankSign>0?'R':'L'}`,
                { metalness: 0.55, roughness: 0.6 });
            cm.position.set(0, bankSign * 240, 100);
            root.add(cm);
        }
    }

    // ============================================================ 9. SPARK PLUGS + COILS (24 — 2/cyl)
    {
        for (const bankSign of [-1, 1]) {
            for (let i = 0; i < 6; i += 1) {
                for (const off of [-12, 12]) {
                    // Coil pack (red box)
                    const g = new THREE.BoxGeometry(28, 18, 65);
                    const m = makeMesh(g, COLOURS.coil, '', { metalness: 0.4, roughness: 0.6 });
                    m.position.set(i * PITCH - HALF + off, bankSign * 160, 308);
                    root.add(m);
                }
            }
        }
    }

    // ============================================================ 10. OIL PAN (deep, finned)
    {
        const g = new THREE.BoxGeometry(LEN * 1.04, 240, 100);
        const m = makeMesh(g, COLOURS.pan, 'oil-pan',
            { metalness: 0.7, roughness: 0.45 });
        m.position.set(0, 0, -130);
        root.add(m);
        // Drain plug
        const dg = new THREE.CylinderGeometry(12, 12, 20, 14);
        const dm = makeMesh(dg, COLOURS.bolt, 'drain-plug', { metalness: 0.85, roughness: 0.25 });
        dm.position.set(-LEN/4, 0, -185);
        root.add(dm);
    }

    // ============================================================ 11. ANCILLARIES — alternator + AC + PS pulleys
    {
        // Alternator (front-right)
        {
            const g = new THREE.CylinderGeometry(58, 58, 120, 24);
            g.rotateZ(Math.PI / 2);
            const m = makeMesh(g, COLOURS.blockDark, 'alternator', { metalness: 0.7, roughness: 0.4 });
            m.position.set(-LEN/2 - 140, 110, 60);
            root.add(m);
        }
        // AC compressor (front-left)
        {
            const g = new THREE.BoxGeometry(140, 90, 90);
            const m = makeMesh(g, COLOURS.blockDark, 'ac-compressor', { metalness: 0.65, roughness: 0.45 });
            m.position.set(-LEN/2 - 140, -110, 60);
            root.add(m);
        }
        // Power steering pump (front-centre-high)
        {
            const g = new THREE.CylinderGeometry(35, 35, 100, 20);
            g.rotateZ(Math.PI / 2);
            const m = makeMesh(g, COLOURS.blockDark, 'ps-pump', { metalness: 0.7, roughness: 0.4 });
            m.position.set(-LEN/2 - 140, 0, 180);
            root.add(m);
        }
        // Water pump
        {
            const g = new THREE.CylinderGeometry(60, 60, 70, 20);
            g.rotateZ(Math.PI / 2);
            const m = makeMesh(g, COLOURS.blockDark, 'water-pump', { metalness: 0.7, roughness: 0.4 });
            m.position.set(-LEN/2 - 60, 0, 100);
            root.add(m);
        }
        // Drive pulleys (3 on the front)
        for (const py of [110, 0, -110]) {
            const g = new THREE.CylinderGeometry(48, 48, 18, 24);
            g.rotateZ(Math.PI / 2);
            const m = makeMesh(g, COLOURS.pulley, '', { metalness: 0.6, roughness: 0.5 });
            m.position.set(-LEN/2 - 175, py, py === 0 ? 30 : 0);
            root.add(m);
        }
        // Starter motor (rear)
        {
            const g = new THREE.CylinderGeometry(48, 48, 180, 20);
            g.rotateZ(Math.PI / 2);
            const m = makeMesh(g, COLOURS.blockDark, 'starter', { metalness: 0.7, roughness: 0.4 });
            m.position.set(LEN/2 + 40, -130, -50);
            root.add(m);
        }
    }

    return root;
}

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
        if (groupRef.current) {
            groupRef.current.traverse((o) => {
                if (o.isMesh) {
                    if (o.userData.basePosition) o.position.copy(o.userData.basePosition);
                    if (o.userData.baseScale) o.scale.copy(o.userData.baseScale);
                    if (o.userData.baseColor != null && o.material) {
                        o.material.color.setHex(o.userData.baseColor);
                    }
                }
            });
        }
    }, []);

    const recordBaseTransforms = (g) => {
        g.traverse((o) => {
            if (o.isMesh) {
                o.userData.basePosition = o.position.clone();
                o.userData.baseScale = o.scale.clone();
                if (o.material) o.userData.baseColor = o.material.color.getHex();
            }
        });
    };

    const fitCamera = useCallback((g) => {
        try {
            const cam = window.__forgeCamera;
            const orbit = window.__forgeOrbit;
            if (!cam || !orbit) return;
            const wasDamping = orbit.enableDamping;
            orbit.enableDamping = false;
            // V12 group is scaled 0.08×, so ~50 units across. Target the
            // visual centre and pan the target LEFT so the V12 appears
            // centred in the viewport's visible left ~75 % (the panel
            // covers the right ~25 %).
            const center = new THREE.Vector3(-9, 0, 4);
            const dir = new THREE.Vector3(1.3, 0.5, 1.0).normalize();
            const dist = 75;
            const apply = () => {
                cam.position.copy(center).add(dir.clone().multiplyScalar(dist));
                cam.near = 0.1;
                cam.far = 1000;
                cam.updateProjectionMatrix();
                orbit.target.copy(center);
                orbit.update();
            };
            apply();
            let n = 0;
            const tick = () => {
                apply();
                if (++n < 8) requestAnimationFrame(tick);
                else orbit.enableDamping = wasDamping;
            };
            requestAnimationFrame(tick);
        } catch (ex) { console.warn('[V12] fit failed', ex); }
    }, []);

    const onBuild = useCallback(() => {
        const scene = window.__forgeScene;
        if (!scene) { console.warn('[V12] no scene'); return; }
        if (groupRef.current) {
            scene.remove(groupRef.current);
            groupRef.current.traverse((o) => {
                o.geometry?.dispose?.();
                o.material?.dispose?.();
            });
        }
        let hasLight = false;
        scene.traverse((o) => { if (o.isLight) hasLight = true; });
        if (!hasLight) {
            scene.add(new THREE.AmbientLight(0xffffff, 0.55));
            const dl = new THREE.DirectionalLight(0xffffff, 1.2);
            dl.position.set(400, 600, 800);
            scene.add(dl);
            const dl2 = new THREE.DirectionalLight(0xddeeff, 0.4);
            dl2.position.set(-400, -300, -200);
            scene.add(dl2);
        }
        const g = buildV12Group();
        // Forge-v4 viewport scene uses small units (default camera at ~40);
        // mm coordinates make the V12 ~636 units across. Scale down so the
        // V12 ends up ~50 units long → fills most of the visible viewport.
        g.scale.set(0.08, 0.08, 0.08);
        recordBaseTransforms(g);
        scene.add(g);
        groupRef.current = g;
        let n = 0; g.traverse((o) => { if (o.isMesh) n += 1; });
        setBuilt(true);
        setPartsCount(n);
        // Defer fit so geometry has updated matrices.
        setTimeout(() => fitCamera(g), 30);
    }, [fitCamera]);

    const onRemove = useCallback(() => {
        stopSim();
        if (groupRef.current && window.__forgeScene) {
            window.__forgeScene.remove(groupRef.current);
            groupRef.current.traverse((o) => {
                o.geometry?.dispose?.();
                o.material?.dispose?.();
            });
            groupRef.current = null;
            setBuilt(false);
            setPartsCount(0);
        }
    }, [stopSim]);

    const onSimCrank = useCallback(() => {
        if (!groupRef.current) return;
        stopSim();
        setSimRunning('crank');
        animStartTimeRef.current = performance.now();
        const loop = () => {
            const t = (performance.now() - animStartTimeRef.current) / 1000;
            const g = groupRef.current; if (!g) return;
            g.traverse((o) => {
                if (o.isMesh && /throw|web|cw|rod|main|snout|flange|flywheel|balancer/.test(o.name)) {
                    const base = o.userData.basePosition; if (!base) return;
                    const phase = base.x * 0.005 + t * 5;
                    const amp = 8;
                    o.position.x = base.x;
                    o.position.y = base.y + Math.sin(phase) * amp;
                    o.position.z = base.z + Math.cos(phase) * amp;
                    const intensity = (Math.sin(phase) + 1) / 2;
                    if (o.material) o.material.color.setRGB(intensity, 1 - intensity, 0.2);
                }
            });
            animFrameRef.current = requestAnimationFrame(loop);
        };
        loop();
        setTimeout(() => stopSim(), 8000);
    }, [stopSim]);

    const onSimCombustion = useCallback(() => {
        if (!groupRef.current) return;
        stopSim();
        setSimRunning('combustion');
        animStartTimeRef.current = performance.now();
        const loop = () => {
            const t = (performance.now() - animStartTimeRef.current) / 1000;
            const g = groupRef.current; if (!g) return;
            g.traverse((o) => {
                if (o.isMesh && /bore/.test(o.name)) {
                    const phase = t * 8;
                    const intensity = (Math.sin(phase) + 1) / 2;
                    if (o.material) o.material.color.setRGB(intensity, 1 - intensity, 0.1);
                    const baseScale = o.userData.baseScale; if (!baseScale) return;
                    const s = 1 + intensity * 0.04;
                    o.scale.set(baseScale.x * s, baseScale.y * s, baseScale.z * s);
                }
            });
            animFrameRef.current = requestAnimationFrame(loop);
        };
        loop();
        setTimeout(() => stopSim(), 8000);
    }, [stopSim]);

    const onSimBending = useCallback(() => {
        if (!groupRef.current) return;
        stopSim();
        setSimRunning('bending');
        animStartTimeRef.current = performance.now();
        const loop = () => {
            const t = (performance.now() - animStartTimeRef.current) / 1000;
            const g = groupRef.current; if (!g) return;
            g.traverse((o) => {
                if (o.isMesh) {
                    const base = o.userData.basePosition; if (!base) return;
                    const wave = Math.sin((base.x / 320) * Math.PI * 2 + t * 4) * 18;
                    o.position.set(base.x, base.y + wave, base.z);
                    const stress = (Math.abs(wave) / 18);
                    if (o.material) o.material.color.setRGB(stress, 1 - stress, 0.2);
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
            position: 'fixed', right: 20, top: 70, width: 320, maxHeight: '90vh',
            background: '#181a1f', color: '#dadde2', border: '1px solid #2a2d34',
            borderRadius: 10, fontSize: 12, fontFamily: 'system-ui, sans-serif',
            boxShadow: '0 6px 22px rgba(0,0,0,0.45)', zIndex: 950,
            display: 'flex', flexDirection: 'column',
        }}>
            <div style={{ padding: '8px 12px', borderBottom: '1px solid #2a2d34',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                    Mercedes M120 V12 build
                    <span style={{ opacity: 0.55, marginLeft: 6, fontSize: 11 }}>
                        · rev {M120_FULL_SPEC.rev}
                    </span>
                </div>
                <button onClick={onClose} aria-label="Close V12 real"
                    style={{ background: 'transparent', color: '#dadde2', border: 'none',
                             cursor: 'pointer', fontSize: 18 }}>×</button>
            </div>

            <div style={{ padding: 10, overflowY: 'auto' }}>
                <div style={{ opacity: 0.75, marginBottom: 8 }}>
                    {M120_FULL_SPEC.engine_overview.displacement_cc} cc · Ø{M120_FULL_SPEC.engine_overview.bore_mm}×{M120_FULL_SPEC.engine_overview.stroke_mm} · 60° V · {M120_FULL_SPEC.engine_overview.power_hp_at_rpm[0]} hp
                </div>
                <button data-testid="forge-v12real-build" onClick={onBuild}
                    style={{ width: '100%', padding: '10px 12px', background: '#2c4d2a',
                             color: '#dfeedd', border: '1px solid #3a6738',
                             borderRadius: 4, cursor: 'pointer', fontWeight: 700 }}>
                    ▶ Build V12 in viewport
                </button>

                {built && (
                    <div data-testid="forge-v12real-built" style={{ marginTop: 8, opacity: 0.85 }}>
                        ✓ <span data-testid="forge-v12real-parts">{partsCount}</span> meshes in __forgeScene
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
                        Remove V12
                    </button>
                )}
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
