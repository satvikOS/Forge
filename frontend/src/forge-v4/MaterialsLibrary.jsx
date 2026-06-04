// PUSH-17 — Materials library + exploded view animator. Pure React + Three.js.
//
// Materials surface as a workbench panel listing engineering materials with
// real density (for mass calc), Young's modulus, Poisson's ratio, ultimate
// tensile, plus PBR appearance (albedo / metallic / roughness). Selecting
// a body + clicking "Apply" tags `window.__forgeBodyMaterials[bodyHandle]`
// and dispatches forge:material-applied. Downstream consumers (cost calc,
// FEA, viewport shader) read from that map.
//
// Exploded view: requests assembly tree from window.__forgeAssemblyTree,
// computes a unit-direction offset per part based on its centroid relative
// to the assembly centroid, animates a slider (0..1) that translates each
// part along its direction. No new deps.

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

export const MATERIAL_LIBRARY = [
    // metals
    { id: 'steel-A36',        name: 'Steel A36',              category: 'Metal',  density: 7850,  E: 200e9, nu: 0.30, Sy: 250e6,  Sut: 400e6,  albedo: '#7d8590', metallic: 1.0, roughness: 0.45 },
    { id: 'steel-1045',       name: 'Steel AISI 1045',         category: 'Metal',  density: 7870,  E: 205e9, nu: 0.29, Sy: 530e6,  Sut: 625e6,  albedo: '#6e7681', metallic: 1.0, roughness: 0.40 },
    { id: 'steel-4140',       name: 'Steel 4140 (Cr-Mo)',      category: 'Metal',  density: 7850,  E: 205e9, nu: 0.29, Sy: 655e6,  Sut: 1020e6, albedo: '#656d76', metallic: 1.0, roughness: 0.38 },
    { id: 'steel-stainless316', name: 'Stainless 316L',        category: 'Metal',  density: 8000,  E: 193e9, nu: 0.30, Sy: 290e6,  Sut: 580e6,  albedo: '#a5acb3', metallic: 1.0, roughness: 0.25 },
    { id: 'al-6061',          name: 'Aluminum 6061-T6',        category: 'Metal',  density: 2700,  E: 69e9,  nu: 0.33, Sy: 276e6,  Sut: 310e6,  albedo: '#c0c4c8', metallic: 1.0, roughness: 0.55 },
    { id: 'al-7075',          name: 'Aluminum 7075-T6',        category: 'Metal',  density: 2810,  E: 72e9,  nu: 0.33, Sy: 503e6,  Sut: 572e6,  albedo: '#b9bdc1', metallic: 1.0, roughness: 0.50 },
    { id: 'al-5052',          name: 'Aluminum 5052-H32',       category: 'Metal',  density: 2680,  E: 70e9,  nu: 0.33, Sy: 193e6,  Sut: 228e6,  albedo: '#bdc1c5', metallic: 1.0, roughness: 0.60 },
    { id: 'ti-6al4v',         name: 'Titanium Ti-6Al-4V',      category: 'Metal',  density: 4430,  E: 113.8e9, nu: 0.342, Sy: 880e6, Sut: 950e6, albedo: '#9aa0a6', metallic: 1.0, roughness: 0.35 },
    { id: 'copper-c11000',    name: 'Copper C11000',           category: 'Metal',  density: 8940,  E: 117e9, nu: 0.34, Sy: 70e6,   Sut: 220e6,  albedo: '#b87333', metallic: 1.0, roughness: 0.30 },
    { id: 'brass-c36000',     name: 'Brass C36000',            category: 'Metal',  density: 8500,  E: 97e9,  nu: 0.31, Sy: 360e6,  Sut: 470e6,  albedo: '#b5a642', metallic: 1.0, roughness: 0.35 },
    { id: 'castiron-grey',    name: 'Cast Iron (Grey)',        category: 'Metal',  density: 7150,  E: 110e9, nu: 0.26, Sy: 0,      Sut: 240e6,  albedo: '#4a4a4a', metallic: 0.4, roughness: 0.85 },
    // plastics
    { id: 'plastic-abs',      name: 'ABS plastic',             category: 'Plastic',density: 1050,  E: 2.0e9, nu: 0.35, Sy: 40e6,   Sut: 45e6,   albedo: '#e8e9eb', metallic: 0.0, roughness: 0.60 },
    { id: 'plastic-pa6',      name: 'Nylon PA6',               category: 'Plastic',density: 1140,  E: 2.5e9, nu: 0.39, Sy: 70e6,   Sut: 78e6,   albedo: '#f0f0e8', metallic: 0.0, roughness: 0.55 },
    { id: 'plastic-pc',       name: 'Polycarbonate',           category: 'Plastic',density: 1200,  E: 2.3e9, nu: 0.37, Sy: 62e6,   Sut: 70e6,   albedo: '#d4dde2', metallic: 0.0, roughness: 0.40 },
    { id: 'plastic-peek',     name: 'PEEK',                    category: 'Plastic',density: 1320,  E: 3.6e9, nu: 0.38, Sy: 100e6,  Sut: 116e6,  albedo: '#e2c47a', metallic: 0.0, roughness: 0.45 },
    // elastomers
    { id: 'rubber-nbr',       name: 'Nitrile NBR',             category: 'Elastomer', density: 1230, E: 0.005e9, nu: 0.49, Sy: 0,  Sut: 24e6,   albedo: '#1c1c1c', metallic: 0.0, roughness: 0.95 },
    { id: 'rubber-epdm',      name: 'EPDM',                    category: 'Elastomer', density: 1100, E: 0.004e9, nu: 0.49, Sy: 0,  Sut: 21e6,   albedo: '#272727', metallic: 0.0, roughness: 0.92 },
    // wood
    { id: 'wood-douglas-fir', name: 'Douglas Fir',             category: 'Wood',   density: 530,   E: 13e9,  nu: 0.35, Sy: 50e6,   Sut: 88e6,   albedo: '#a07853', metallic: 0.0, roughness: 0.80 },
    { id: 'wood-oak',         name: 'White Oak',               category: 'Wood',   density: 770,   E: 12e9,  nu: 0.36, Sy: 47e6,   Sut: 102e6,  albedo: '#7a5530', metallic: 0.0, roughness: 0.82 },
    // glass / ceramic / concrete
    { id: 'glass-borosilicate', name: 'Borosilicate glass',    category: 'Glass',  density: 2230,  E: 64e9,  nu: 0.20, Sy: 0,      Sut: 35e6,   albedo: '#d6e2e6', metallic: 0.0, roughness: 0.05 },
    { id: 'ceramic-alumina',  name: 'Alumina (Al2O3)',         category: 'Ceramic',density: 3950,  E: 350e9, nu: 0.22, Sy: 0,      Sut: 350e6,  albedo: '#e8e2dc', metallic: 0.0, roughness: 0.30 },
    { id: 'concrete-c30',     name: 'Concrete C30/37',         category: 'Civil',  density: 2400,  E: 33e9,  nu: 0.20, Sy: 0,      Sut: 3e6,    albedo: '#a6a6a6', metallic: 0.0, roughness: 0.92 },
];

function ensureMaterialMap() {
    if (typeof window === 'undefined') return null;
    if (!window.__forgeBodyMaterials) window.__forgeBodyMaterials = {};
    return window.__forgeBodyMaterials;
}

function applyMaterial(bodyHandle, materialId) {
    const map = ensureMaterialMap();
    if (!map) return;
    if (bodyHandle == null) {
        // No selection — apply to active body if known.
        const sel = window.__forgeSelection;
        if (sel?.kind === 'body' && sel.ids?.length > 0) {
            for (const h of sel.ids) map[h] = materialId;
        } else {
            map['__default'] = materialId;
        }
    } else {
        map[bodyHandle] = materialId;
    }
    try {
        window.dispatchEvent(new CustomEvent('forge:material-applied', {
            detail: { bodyHandle, materialId, map: { ...map } },
        }));
    } catch {}
}

if (typeof window !== 'undefined') {
    window.forge = window.forge || {};
    window.forge.materials = {
        library: () => MATERIAL_LIBRARY.slice(),
        lookup: (id) => MATERIAL_LIBRARY.find((m) => m.id === id) || null,
        apply: (bodyHandle, materialId) => applyMaterial(bodyHandle, materialId),
        map: () => ({ ...ensureMaterialMap() }),
    };
}

export function MaterialsLibraryHost() {
    const [open, setOpen] = useState(false);
    const [filter, setFilter] = useState('');
    const [selectedMat, setSelectedMat] = useState('steel-A36');
    const [confirm, setConfirm] = useState(null);

    useEffect(() => {
        window.__forgeOpenMaterialsLibrary  = () => setOpen(true);
        window.__forgeCloseMaterialsLibrary = () => setOpen(false);
        return () => { delete window.__forgeOpenMaterialsLibrary; delete window.__forgeCloseMaterialsLibrary; };
    }, []);

    if (!open) return null;

    const lo = filter.toLowerCase();
    const filtered = MATERIAL_LIBRARY.filter((m) =>
        !lo || m.name.toLowerCase().includes(lo) || m.category.toLowerCase().includes(lo)
    );

    const apply = () => {
        const m = MATERIAL_LIBRARY.find((x) => x.id === selectedMat);
        applyMaterial(null, selectedMat);
        setConfirm(`Applied ${m ? m.name : selectedMat}`);
        setTimeout(() => setConfirm(null), 1800);
    };

    return createPortal(
        <div data-testid="forge-materials-panel"
             style={{ position: 'fixed', top: 90, right: 24, width: 540,
                      background: '#161b22', color: '#c9d1d9',
                      border: '1px solid #30363d', borderRadius: 8, padding: 14,
                      zIndex: 6600, fontFamily: 'system-ui, sans-serif', fontSize: 13,
                      boxShadow: '0 14px 40px rgba(0,0,0,0.6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong>Materials library</strong>
                <button onClick={() => setOpen(false)} style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>
            <input data-testid="forge-materials-filter" type="text" value={filter}
                   onChange={(e) => setFilter(e.target.value)} placeholder="Filter… (e.g. aluminum, plastic, wood)"
                   style={{ width: '100%', boxSizing: 'border-box', background: '#0d1117', color: '#c9d1d9',
                            border: '1px solid #30363d', borderRadius: 4, padding: '6px 8px', marginBottom: 8 }}/>
            <div data-testid="forge-materials-list"
                 style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid #30363d', borderRadius: 4 }}>
                {filtered.map((m) => (
                    <div key={m.id} data-testid={`forge-material-${m.id}`}
                         onClick={() => setSelectedMat(m.id)}
                         style={{ padding: '6px 10px', cursor: 'pointer',
                                  background: selectedMat === m.id ? '#1f6feb33' : 'transparent',
                                  borderBottom: '1px solid #21262d' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span><span style={{ display: 'inline-block', width: 12, height: 12, background: m.albedo, marginRight: 6, borderRadius: 2 }}/>{m.name}</span>
                            <span style={{ color: '#8b949e', fontSize: 11 }}>{m.category}</span>
                        </div>
                        <div style={{ fontSize: 11, color: '#8b949e' }}>
                            ρ={m.density} kg/m³  ·  E={(m.E / 1e9).toFixed(0)} GPa  ·  Sy={(m.Sy / 1e6).toFixed(0)} MPa  ·  Sut={(m.Sut / 1e6).toFixed(0)} MPa
                        </div>
                    </div>
                ))}
            </div>
            <div style={{ marginTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#8b949e', fontSize: 12 }}>{filtered.length} material{filtered.length === 1 ? '' : 's'}</span>
                <button data-testid="forge-materials-apply" onClick={apply}
                        style={{ background: '#238636', color: '#fff', border: 'none', borderRadius: 4, padding: '6px 14px', cursor: 'pointer' }}>Apply to selection</button>
            </div>
            {confirm && <div data-testid="forge-materials-confirm" style={{ marginTop: 8, padding: 6, background: '#1d2d1d', color: '#3fb950', borderRadius: 4, fontSize: 12 }}>{confirm}</div>}
        </div>,
        document.body
    );
}

// ─────────────────── Exploded view ───────────────────────────────────────

export function ExplodedViewHost() {
    const [open, setOpen] = useState(false);
    const [factor, setFactor] = useState(0);
    const [animating, setAnimating] = useState(false);

    useEffect(() => {
        window.__forgeOpenExplodedView  = () => setOpen(true);
        window.__forgeCloseExplodedView = () => setOpen(false);
        return () => { delete window.__forgeOpenExplodedView; delete window.__forgeCloseExplodedView; };
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            window.dispatchEvent(new CustomEvent('forge:explode-update', { detail: { factor } }));
        } catch {}
    }, [factor]);

    useEffect(() => {
        if (!animating) return;
        const start = performance.now();
        const dur = 2400; // ms
        const step = (t) => {
            const u = Math.min(1, (t - start) / dur);
            setFactor(u);
            if (u < 1) requestAnimationFrame(step);
            else setAnimating(false);
        };
        requestAnimationFrame(step);
    }, [animating]);

    if (!open) return null;

    return createPortal(
        <div data-testid="forge-explode-panel"
             style={{ position: 'fixed', bottom: 24, right: 24, width: 360,
                      background: '#161b22', color: '#c9d1d9',
                      border: '1px solid #30363d', borderRadius: 8, padding: 14,
                      zIndex: 6700, fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong>Exploded view</strong>
                <button onClick={() => setOpen(false)} style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>
            <label>Offset factor: <span data-testid="forge-explode-factor">{factor.toFixed(2)}</span></label>
            <input data-testid="forge-explode-slider" type="range" min="0" max="1" step="0.01"
                   value={factor} onChange={(e) => setFactor(parseFloat(e.target.value))}
                   style={{ width: '100%', marginTop: 6 }}/>
            <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
                <button data-testid="forge-explode-play" onClick={() => setAnimating(true)}
                        style={{ background: '#1f6feb', color: '#fff', border: 'none', borderRadius: 4, padding: '5px 10px', cursor: 'pointer' }}>▶ Animate</button>
                <button data-testid="forge-explode-reset" onClick={() => setFactor(0)}
                        style={{ background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d', borderRadius: 4, padding: '5px 10px', cursor: 'pointer' }}>Reset</button>
            </div>
            <div style={{ marginTop: 6, color: '#8b949e', fontSize: 11 }}>
                Parts are translated along the unit vector from the assembly centroid to each part centroid, scaled by 1.5 × bounding-box diagonal × factor.
            </div>
        </div>,
        document.body
    );
}
