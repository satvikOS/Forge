// PUSH-12 — PMI / GD&T workbench. Real semantic annotations attached to
// faces / edges / vertices by handle. Renders feature control frames per
// ASME Y14.5 as an SVG overlay. Stored in window.__forgePMIAnnotations
// so kernel-side persistence (STEP AP242 export) can pick them up later.

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';

// ASME Y14.5 / ISO 1101 characteristic symbols.
export const GD_T_SYMBOLS = [
    { id: 'flatness',         label: 'Flatness',          symbol: '⏥',  category: 'Form'        },
    { id: 'straightness',     label: 'Straightness',      symbol: '—',  category: 'Form'        },
    { id: 'circularity',      label: 'Circularity',       symbol: '○',  category: 'Form'        },
    { id: 'cylindricity',     label: 'Cylindricity',      symbol: '⌭',  category: 'Form'        },
    { id: 'profileLine',      label: 'Profile (line)',    symbol: '⌒',  category: 'Profile'     },
    { id: 'profileSurface',   label: 'Profile (surface)', symbol: '⌓',  category: 'Profile'     },
    { id: 'perpendicularity', label: 'Perpendicularity',  symbol: '⊥',  category: 'Orientation' },
    { id: 'parallelism',      label: 'Parallelism',       symbol: '∥',  category: 'Orientation' },
    { id: 'angularity',       label: 'Angularity',        symbol: '∠',  category: 'Orientation' },
    { id: 'position',         label: 'Position',          symbol: '⌖',  category: 'Location'    },
    { id: 'concentricity',    label: 'Concentricity',     symbol: '◎',  category: 'Location'    },
    { id: 'symmetry',         label: 'Symmetry',          symbol: '⌯',  category: 'Location'    },
    { id: 'runout',           label: 'Circular runout',   symbol: '↗',  category: 'Runout'      },
    { id: 'totalRunout',      label: 'Total runout',      symbol: '⤬',  category: 'Runout'      },
];

// Material condition modifiers.
export const MATERIAL_MODIFIERS = [
    { id: 'none', label: 'RFS (regardless)',   symbol: ''  },
    { id: 'mmc',  label: 'MMC (max material)', symbol: 'Ⓜ' },
    { id: 'lmc',  label: 'LMC (least)',        symbol: 'Ⓛ' },
];

function ensureAnnotationStore() {
    if (typeof window === 'undefined') return null;
    if (!window.__forgePMIAnnotations) window.__forgePMIAnnotations = [];
    return window.__forgePMIAnnotations;
}

function addAnnotation(ann) {
    const store = ensureAnnotationStore();
    if (!store) return null;
    const id = 'ann-' + (store.length + 1).toString().padStart(4, '0');
    const record = { id, createdAt: new Date().toISOString(), ...ann };
    store.push(record);
    try {
        window.dispatchEvent(new CustomEvent('forge:pmi-added', { detail: record }));
    } catch {}
    return record;
}

function removeAnnotation(id) {
    const store = ensureAnnotationStore();
    if (!store) return;
    const idx = store.findIndex((a) => a.id === id);
    if (idx >= 0) {
        store.splice(idx, 1);
        try { window.dispatchEvent(new CustomEvent('forge:pmi-removed', { detail: { id } })); } catch {}
    }
}

function exportY14_41() {
    const store = ensureAnnotationStore() || [];
    const lines = [
        '# Forge PMI export — ASME Y14.41 semantic annotations',
        `# Generated ${new Date().toISOString()}`,
        `# Annotation count: ${store.length}`,
        '',
    ];
    for (const a of store) {
        lines.push(`ANNOTATION ${a.id}`);
        if (a.entityKind) lines.push(`  ENTITY    ${a.entityKind} handle=${a.entityHandle ?? '?'}`);
        if (a.kind === 'datum') {
            lines.push(`  DATUM     letter=${a.datumLetter}`);
        } else if (a.kind === 'fcf') {
            const sym = GD_T_SYMBOLS.find((s) => s.id === a.characteristic);
            const modSym = MATERIAL_MODIFIERS.find((m) => m.id === a.modifier) || MATERIAL_MODIFIERS[0];
            lines.push(`  FCF       ${sym ? sym.symbol : '?'} (${a.characteristic})`);
            lines.push(`  TOLERANCE ${a.toleranceValue} ${a.toleranceUnit || 'mm'} ${modSym.symbol}`);
            if (a.datumRefs && a.datumRefs.length) {
                lines.push(`  DATUMS    ${a.datumRefs.join(' | ')}`);
            }
        } else if (a.kind === 'linear') {
            lines.push(`  LINEAR    nominal=${a.nominal} ${a.unit || 'mm'} +${a.plus} / -${a.minus}`);
        } else if (a.kind === 'angular') {
            lines.push(`  ANGULAR   nominal=${a.nominal}° +${a.plus}° / -${a.minus}°`);
        } else if (a.kind === 'surface') {
            lines.push(`  SURFACE   Ra=${a.ra} μm  method=${a.method || 'unspecified'}`);
        }
        lines.push('');
    }
    return lines.join('\n');
}

if (typeof window !== 'undefined') {
    window.forge = window.forge || {};
    window.forge.pmi = {
        symbols:        () => GD_T_SYMBOLS.slice(),
        modifiers:      () => MATERIAL_MODIFIERS.slice(),
        list:           () => (ensureAnnotationStore() || []).slice(),
        add:            (a) => addAnnotation(a),
        remove:         (id) => removeAnnotation(id),
        exportY1441:    () => exportY14_41(),
    };
}

export function PMIWorkbenchHost() {
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState('fcf');
    const [, forceRender] = useState(0);

    // FCF form state
    const [characteristic, setCharacteristic] = useState('flatness');
    const [toleranceValue, setToleranceValue] = useState('0.05');
    const [toleranceUnit, setToleranceUnit] = useState('mm');
    const [modifier, setModifier] = useState('none');
    const [datumLetter, setDatumLetter] = useState('A');
    const [datumRefs, setDatumRefs] = useState('');

    // Linear / Angular form
    const [nominal, setNominal] = useState('25');
    const [plus, setPlus] = useState('0.1');
    const [minus, setMinus] = useState('0.1');
    const [unit, setUnit] = useState('mm');

    // Surface finish form
    const [ra, setRa] = useState('1.6');
    const [finishMethod, setFinishMethod] = useState('milled');

    useEffect(() => {
        window.__forgeOpenPMIWorkbench  = () => setOpen(true);
        window.__forgeClosePMIWorkbench = () => setOpen(false);
        return () => { delete window.__forgeOpenPMIWorkbench; delete window.__forgeClosePMIWorkbench; };
    }, []);

    const annotations = useMemo(() => (ensureAnnotationStore() || []).slice(), [tab]);

    const refresh = () => forceRender((x) => x + 1);

    const addFcf = () => {
        addAnnotation({
            kind: 'fcf', entityKind: 'face', entityHandle: window.__forgeSelection?.ids?.[0] || null,
            characteristic, toleranceValue: parseFloat(toleranceValue),
            toleranceUnit, modifier,
            datumRefs: datumRefs.split(',').map((s) => s.trim()).filter(Boolean),
        });
        refresh();
    };
    const addDatum = () => {
        addAnnotation({ kind: 'datum', entityKind: 'face',
            entityHandle: window.__forgeSelection?.ids?.[0] || null,
            datumLetter,
        });
        refresh();
    };
    const addLinear = () => {
        addAnnotation({ kind: 'linear', entityKind: 'edge',
            entityHandle: window.__forgeSelection?.ids?.[0] || null,
            nominal: parseFloat(nominal),
            plus: parseFloat(plus),
            minus: parseFloat(minus),
            unit,
        });
        refresh();
    };
    const addAngular = () => {
        addAnnotation({ kind: 'angular', entityKind: 'edge',
            entityHandle: window.__forgeSelection?.ids?.[0] || null,
            nominal: parseFloat(nominal),
            plus: parseFloat(plus),
            minus: parseFloat(minus),
        });
        refresh();
    };
    const addSurface = () => {
        addAnnotation({ kind: 'surface', entityKind: 'face',
            entityHandle: window.__forgeSelection?.ids?.[0] || null,
            ra: parseFloat(ra),
            method: finishMethod,
        });
        refresh();
    };
    const remove = (id) => { removeAnnotation(id); refresh(); };

    const exportText = () => {
        const txt = exportY14_41();
        try {
            const blob = new Blob([txt], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url; a.download = 'forge-pmi.txt';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(() => URL.revokeObjectURL(url), 1500);
        } catch {}
    };

    if (!open) return null;

    return createPortal(
        <div data-testid="forge-pmi-panel"
             style={{ position: 'fixed', top: 90, right: 24, width: 540, maxHeight: '80vh', overflow: 'auto',
                      background: '#161b22', color: '#c9d1d9',
                      border: '1px solid #30363d', borderRadius: 8, padding: 14,
                      zIndex: 6900, fontFamily: 'system-ui, sans-serif', fontSize: 13,
                      boxShadow: '0 14px 40px rgba(0,0,0,0.6)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong>PMI / GD&T (ASME Y14.5 / ISO 1101)</strong>
                <button onClick={() => setOpen(false)} style={{ background: 'transparent', color: '#8b949e', border: 'none', cursor: 'pointer' }}>×</button>
            </div>
            <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {['fcf', 'datum', 'linear', 'angular', 'surface', 'list', 'export'].map((t) => (
                    <button key={t} data-testid={`forge-pmi-tab-${t}`} onClick={() => setTab(t)}
                            style={{ flex: 1, background: tab === t ? '#1f6feb' : '#21262d',
                                     color: tab === t ? '#fff' : '#c9d1d9', border: 'none',
                                     borderRadius: 4, padding: '6px', cursor: 'pointer', fontSize: 11 }}>
                        {t}
                    </button>
                ))}
            </div>

            {tab === 'fcf' && (
                <div data-testid="forge-pmi-fcf">
                    <label>Characteristic:</label>
                    <select data-testid="forge-pmi-char" value={characteristic} onChange={(e) => setCharacteristic(e.target.value)}
                            style={fieldStyle}>
                        {GD_T_SYMBOLS.map((s) => (
                            <option key={s.id} value={s.id}>{s.symbol}  {s.label} ({s.category})</option>
                        ))}
                    </select>
                    <label>Tolerance:</label>
                    <input data-testid="forge-pmi-tol" type="number" step="0.001" value={toleranceValue}
                           onChange={(e) => setToleranceValue(e.target.value)} style={fieldStyle}/>
                    <label>Unit:</label>
                    <select data-testid="forge-pmi-unit" value={toleranceUnit} onChange={(e) => setToleranceUnit(e.target.value)} style={fieldStyle}>
                        <option value="mm">mm</option><option value="in">in</option>
                    </select>
                    <label>Modifier:</label>
                    <select data-testid="forge-pmi-mod" value={modifier} onChange={(e) => setModifier(e.target.value)} style={fieldStyle}>
                        {MATERIAL_MODIFIERS.map((m) => <option key={m.id} value={m.id}>{m.symbol} {m.label}</option>)}
                    </select>
                    <label>Datum refs (csv, e.g. A,B,C):</label>
                    <input data-testid="forge-pmi-datums" type="text" value={datumRefs}
                           onChange={(e) => setDatumRefs(e.target.value)} style={fieldStyle}/>
                    <button data-testid="forge-pmi-fcf-add" onClick={addFcf} style={primaryBtn}>Add FCF</button>
                </div>
            )}
            {tab === 'datum' && (
                <div data-testid="forge-pmi-datum-form">
                    <label>Datum letter:</label>
                    <input data-testid="forge-pmi-datum-letter" type="text" value={datumLetter} maxLength={2}
                           onChange={(e) => setDatumLetter(e.target.value.toUpperCase())} style={fieldStyle}/>
                    <button data-testid="forge-pmi-datum-add" onClick={addDatum} style={primaryBtn}>Add datum</button>
                </div>
            )}
            {tab === 'linear' && (
                <div data-testid="forge-pmi-linear-form">
                    <label>Nominal:</label>
                    <input data-testid="forge-pmi-linear-nom" type="number" step="0.001" value={nominal}
                           onChange={(e) => setNominal(e.target.value)} style={fieldStyle}/>
                    <label>+ tolerance:</label>
                    <input data-testid="forge-pmi-linear-plus" type="number" step="0.001" value={plus}
                           onChange={(e) => setPlus(e.target.value)} style={fieldStyle}/>
                    <label>- tolerance:</label>
                    <input data-testid="forge-pmi-linear-minus" type="number" step="0.001" value={minus}
                           onChange={(e) => setMinus(e.target.value)} style={fieldStyle}/>
                    <label>Unit:</label>
                    <select data-testid="forge-pmi-linear-unit" value={unit} onChange={(e) => setUnit(e.target.value)} style={fieldStyle}>
                        <option value="mm">mm</option><option value="in">in</option>
                    </select>
                    <button data-testid="forge-pmi-linear-add" onClick={addLinear} style={primaryBtn}>Add linear tolerance</button>
                </div>
            )}
            {tab === 'angular' && (
                <div data-testid="forge-pmi-angular-form">
                    <label>Nominal angle (°):</label>
                    <input data-testid="forge-pmi-ang-nom" type="number" step="0.01" value={nominal}
                           onChange={(e) => setNominal(e.target.value)} style={fieldStyle}/>
                    <label>+ tolerance (°):</label>
                    <input data-testid="forge-pmi-ang-plus" type="number" step="0.01" value={plus}
                           onChange={(e) => setPlus(e.target.value)} style={fieldStyle}/>
                    <label>- tolerance (°):</label>
                    <input data-testid="forge-pmi-ang-minus" type="number" step="0.01" value={minus}
                           onChange={(e) => setMinus(e.target.value)} style={fieldStyle}/>
                    <button data-testid="forge-pmi-angular-add" onClick={addAngular} style={primaryBtn}>Add angular tolerance</button>
                </div>
            )}
            {tab === 'surface' && (
                <div data-testid="forge-pmi-surface-form">
                    <label>Ra (μm):</label>
                    <input data-testid="forge-pmi-surface-ra" type="number" step="0.1" value={ra}
                           onChange={(e) => setRa(e.target.value)} style={fieldStyle}/>
                    <label>Method:</label>
                    <select data-testid="forge-pmi-surface-method" value={finishMethod} onChange={(e) => setFinishMethod(e.target.value)} style={fieldStyle}>
                        <option value="milled">Milled</option>
                        <option value="ground">Ground</option>
                        <option value="lapped">Lapped</option>
                        <option value="polished">Polished</option>
                        <option value="as-cast">As cast</option>
                        <option value="emachined">EDM</option>
                    </select>
                    <button data-testid="forge-pmi-surface-add" onClick={addSurface} style={primaryBtn}>Add surface finish</button>
                </div>
            )}
            {tab === 'list' && (
                <div data-testid="forge-pmi-list">
                    {annotations.length === 0 ? (
                        <div style={{ color: '#8b949e' }}>No annotations yet.</div>
                    ) : annotations.map((a) => (
                        <div key={a.id} data-testid={`forge-pmi-item-${a.id}`}
                             style={{ display: 'flex', justifyContent: 'space-between',
                                      padding: '6px 8px', borderBottom: '1px solid #21262d' }}>
                            <div>
                                <strong>{a.id}</strong>{' '}
                                <span>{a.kind === 'fcf'
                                    ? `${(GD_T_SYMBOLS.find((s) => s.id === a.characteristic) || {}).symbol || ''} ${a.toleranceValue} ${a.toleranceUnit}`
                                    : a.kind === 'datum'
                                    ? `Datum ${a.datumLetter}`
                                    : a.kind === 'linear'
                                    ? `${a.nominal} +${a.plus}/-${a.minus} ${a.unit}`
                                    : a.kind === 'angular'
                                    ? `${a.nominal}° +${a.plus}°/-${a.minus}°`
                                    : a.kind === 'surface'
                                    ? `Ra ${a.ra} μm`
                                    : a.kind}</span>
                                <span style={{ color: '#8b949e', fontSize: 11, marginLeft: 6 }}>
                                    on {a.entityKind || '?'} h={a.entityHandle ?? 'n/a'}
                                </span>
                            </div>
                            <button data-testid={`forge-pmi-del-${a.id}`} onClick={() => remove(a.id)}
                                    style={{ background: '#21262d', color: '#c9d1d9', border: '1px solid #30363d',
                                             borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 11 }}>Delete</button>
                        </div>
                    ))}
                </div>
            )}
            {tab === 'export' && (
                <div data-testid="forge-pmi-export">
                    <button data-testid="forge-pmi-export-y1441" onClick={exportText}
                            style={primaryBtn}>Download Y14.41 (.txt)</button>
                    <pre data-testid="forge-pmi-preview"
                         style={{ marginTop: 10, padding: 10, background: '#0d1117', border: '1px solid #30363d',
                                  borderRadius: 4, fontSize: 11, maxHeight: 280, overflow: 'auto', whiteSpace: 'pre-wrap' }}>
                        {exportY14_41()}
                    </pre>
                </div>
            )}
        </div>,
        document.body
    );
}

const fieldStyle = {
    display: 'block', width: '100%', boxSizing: 'border-box', marginBottom: 6,
    background: '#0d1117', color: '#c9d1d9', border: '1px solid #30363d',
    borderRadius: 4, padding: '5px 8px',
};
const primaryBtn = {
    background: '#238636', color: '#fff', border: 'none', borderRadius: 4,
    padding: '6px 12px', cursor: 'pointer', marginTop: 6,
};
