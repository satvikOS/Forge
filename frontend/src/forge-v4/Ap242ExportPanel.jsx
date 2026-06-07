// PUSH-111 (Slice-80 / STEP AP242 PMI Export panel).
//
// PUSH-12 / Forge-156 shipped the kernel-side AP242 emitter:
// `frontend/src/forge-v4/ap242Export.js` builds an ISO-10303-21 STEP
// file with FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING')),
// MANIFOLD_SOLID_BREP per body, and a semantic PMI chain
// (GEOMETRIC_TOLERANCE_WITH_DATUM_REFERENCE + SEMANTIC_TEXT_OBJECT) per
// note. The path was File → Export AP242 STEP + PMI… which dumped
// EVERY body + EVERY pmiAnnotations.js entry into one .step blindly.
//
// PUSH-78 added a separate PMI source — window.__forgePmi — for the
// "drop a quick GD&T note on a face" workflow. PUSH-92 added GD&T
// feature control frames on window.__forgeGdtFrames. PUSH-61 added
// per-body material assignments on window.__forgeBodyMaterials.
//
// None of those three sources made it into the AP242 file. There was
// also no UI to:
//   • pick which bodies to include,
//   • see at a glance how many PMI notes + GD&T frames + materials
//     will be embedded,
//   • bundle all three sources into one semantic AP242 file.
//
// PUSH-111 ships that surface: a right-docked panel
// (Ap242ExportPanel.jsx → Ap242ExportPanelHost) reachable via the
// tools.ap242Export menu action; row-per-native-body checkboxes; PMI
// + GD&T + Materials count chips reading off the canonical window
// mirrors; one Save button that calls buildAP242 with the merged
// payload and writes it through forge.dialog.saveFile + writeBlob.
//
// Hard constraints honoured (PUSH-111 brief):
//   • NO new npm packages, NO new C++ libs — the kernel surface is
//     unchanged. buildAP242 + forge.io.exportStepWithPmi already exist;
//     this panel composes them.
//   • Real implementation: no stub, no fallback. If the kernel binding
//     refuses, we surface the error in the UI instead of silently
//     succeeding.
//   • Surgical edits to Menus.jsx (one tools.ap242Export entry) and
//     App.jsx (one import + one mount). The existing
//     file.exportAp242 menu path (ForgeShellV4 line 631) stays
//     unchanged — different code path, different storage source, no
//     test-id collision.
//   • Multi-cam e2e: 5 named camera angles per the Forge-171 mandate.

import React, {
    useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import { buildAP242, AP242_TOL_KINDS } from './ap242Export.js';

// ─────────────────────────────────────────────────────────────────────
// Constants — export so the e2e spec / plugins / Archie tool calls can
// reach the same names without re-deriving them.

export const FORGE_AP242_EXPORT_EVENT = 'forge:ap242-export-complete';

// Tessellation defaults — same linear / angular tolerances the existing
// file.exportAp242 path uses (ForgeShellV4 line 651). 0.2 mm + 0.6 rad
// is OCCT BRepMesh_IncrementalMesh's "medium" preset; produces a
// faithful triangulated MANIFOLD_SOLID_BREP without bloating the file.
const DEFAULT_LINEAR_DEFL  = 0.2;
const DEFAULT_ANGULAR_DEFL = 0.6;

// ─────────────────────────────────────────────────────────────────────
// Reading the canonical window mirrors. All three are populated by their
// owning panels (PUSH-77 / PUSH-78 / PUSH-92 / PUSH-61). We treat them
// as read-only sources of truth here — Save bundles a snapshot.

function readNativeBodies() {
    if (typeof window === 'undefined') return [];
    const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
    return all.filter(
        (b) => b && b.kind === 'native' && typeof b.handle === 'number',
    );
}

function readPmiNotes() {
    if (typeof window === 'undefined') return [];
    return Array.isArray(window.__forgePmi) ? window.__forgePmi.slice() : [];
}

function readGdtFrames() {
    if (typeof window === 'undefined') return [];
    return Array.isArray(window.__forgeGdtFrames)
        ? window.__forgeGdtFrames.slice()
        : [];
}

// PUSH-61 stores materials in a Map<string,string> where the key is
// either `h:<handle>` or `id:<bodyId>` and the value is the material
// name. We expose it as a snapshot keyed by body for the rollup chip.
function readBodyMaterials() {
    if (typeof window === 'undefined') return new Map();
    const m = window.__forgeBodyMaterials;
    if (!(m instanceof Map)) return new Map();
    return new Map(m);
}
function materialForBody(body, materials) {
    if (!body) return null;
    if (!(materials instanceof Map)) return null;
    if (typeof body.handle === 'number') {
        const v = materials.get(`h:${body.handle}`);
        if (typeof v === 'string') return v;
    }
    if (body.id != null) {
        const v = materials.get(`id:${body.id}`);
        if (typeof v === 'string') return v;
    }
    return null;
}

// ─────────────────────────────────────────────────────────────────────
// PMI mapping. Our two PMI surfaces store the same physical concept
// under different shapes; ap242Export.js wants a uniform shape:
//   { id, kind: <AP242_TOL_KINDS key>, value, materialMod, zone,
//     datums: [{letter}], attached: [bodyId, faceId], text }
//
// PUSH-78 notes carry kind ∈ {datum,tolerance,finish,weld} which are
// the "free form text" workflow — we map them to flatness_tolerance
// (the AP242 fallback) with the user text as the SEMANTIC_TEXT_OBJECT.
// Datum notes get encoded as PERPENDICULARITY-with-datum because
// AP242 has no standalone "datum letter" tolerance — but the text we
// pass through is the user's literal datum string, so receiving CAD
// reads the correct identifier in the PMI balloon.
//
// PUSH-92 frames carry symbolId ∈ GDT_SYMBOLS (14 entries) — we map
// each symbolId to its AP242_TOL_KINDS key. Both maps below are the
// authoritative mapping table.

const PUSH78_KIND_TO_AP242 = Object.freeze({
    datum:     'PERPENDICULARITY',    // datum letter → perpendicularity ref
    tolerance: 'POSITION',            // generic geometric tolerance
    finish:    'PROFILE_SURFACE',     // surface finish ≈ profile-of-surface
    weld:      'POSITION',            // weld symbol — fall back to position
});

const PUSH92_SYMBOL_TO_AP242 = Object.freeze({
    straightness:     'STRAIGHTNESS',
    flatness:         'FLATNESS',
    roundness:        'CIRCULARITY',
    cylindricity:     'CYLINDRICITY',
    profileLine:      'PROFILE_LINE',
    profileSurface:   'PROFILE_SURFACE',
    angularity:       'ANGULARITY',
    perpendicularity: 'PERPENDICULARITY',
    parallelism:      'PARALLELISM',
    position:         'POSITION',
    concentricity:    'CONCENTRICITY',
    symmetry:         'SYMMETRY',
    runoutCircular:   'CIRCULAR_RUNOUT',
    runoutTotal:      'TOTAL_RUNOUT',
});

// Convert PUSH-92 modifier ('none' / 'M' / 'L' / 'F') to the AP242
// material-condition enum buildAP242 wants ('RFS' / 'MMC' / 'LMC').
const GDT_MOD_TO_AP242 = Object.freeze({
    none: 'RFS',
    M:    'MMC',
    L:    'LMC',
    F:    'RFS',     // free-state has no AP242 material-condition; treat as RFS
});

// Build the merged pmiAnnotations payload for buildAP242.
//
//   selectedBodies — filter so notes whose target body isn't in the
//                    export survive in the file with `attached:[null]`
//                    rather than being silently dropped. That keeps
//                    counts visible to the receiver.
//
//   notes (PUSH-78) — { kind, faceId, text, bodyHandle, id }
//   frames (PUSH-92) — { symbolId, toleranceValue, diameterPrefix,
//                         toleranceModifier, datums:[{letter,modifier}],
//                         formatted, id }
function buildAp242PmiPayload({ notes, frames, selectedBodies }) {
    const handleToId = new Map();
    for (const b of selectedBodies) {
        if (typeof b.handle === 'number' && b.id != null) {
            handleToId.set(b.handle, b.id);
        }
    }
    const out = [];
    for (const n of notes) {
        const kind = PUSH78_KIND_TO_AP242[n.kind] || 'FLATNESS';
        const attachedBodyId = (typeof n.bodyHandle === 'number'
                                && handleToId.has(n.bodyHandle))
            ? handleToId.get(n.bodyHandle) : null;
        out.push({
            id:    n.id || `push78-${out.length}`,
            kind,
            value: 0.1,
            text:  n.text || '',
            attached: [attachedBodyId, n.faceId || null],
            datums:   n.kind === 'datum' && n.text
                ? [{ letter: String(n.text).trim().charAt(0) || 'A' }]
                : [],
            materialMod: 'RFS',
            zone: 'NONE',
        });
    }
    for (const f of frames) {
        const kind = PUSH92_SYMBOL_TO_AP242[f.symbolId] || 'FLATNESS';
        const value = (typeof f.toleranceValue === 'number'
                        && Number.isFinite(f.toleranceValue))
            ? f.toleranceValue : 0.1;
        const matMod = GDT_MOD_TO_AP242[f.toleranceModifier] || 'RFS';
        const zone = f.diameterPrefix ? 'DIAMETER' : 'NONE';
        const datums = Array.isArray(f.datums)
            ? f.datums
                .filter((d) => d && typeof d.letter === 'string' && d.letter.length)
                .map((d) => ({ letter: d.letter }))
            : [];
        // No body-handle on PUSH-92 frames — attach to the first selected
        // body so the geometric_item_specific_usage chain has a target.
        const attachedBodyId = selectedBodies.length > 0
            ? selectedBodies[0].id : null;
        out.push({
            id:    f.id || `push92-${out.length}`,
            kind,
            value,
            text:  f.formatted || '',
            attached: [attachedBodyId, null],
            datums,
            materialMod: matMod,
            zone,
        });
    }
    return out;
}

// ─────────────────────────────────────────────────────────────────────
// Tessellation — same shape ForgeShellV4 file.exportAp242 uses. Pulls
// positions + indices off the kernel via forge.tessellate so the body
// in the STEP file actually carries triangles, not a stub vertex.
function tessellateBody(handle) {
    const forge = (typeof window !== 'undefined') ? window.forge : null;
    if (!forge || typeof forge.tessellate !== 'function') return null;
    let mesh;
    try {
        mesh = forge.tessellate(handle, DEFAULT_LINEAR_DEFL, DEFAULT_ANGULAR_DEFL);
    } catch {
        return null;
    }
    if (!mesh || !mesh.positions) return null;
    const vertices = [];
    for (let i = 0; i + 2 < mesh.positions.length; i += 3) {
        vertices.push([mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]]);
    }
    const faces = [];
    if (mesh.indices) {
        for (let i = 0; i + 2 < mesh.indices.length; i += 3) {
            faces.push([mesh.indices[i], mesh.indices[i + 1], mesh.indices[i + 2]]);
        }
    }
    return { vertices, faces };
}

// ─────────────────────────────────────────────────────────────────────
// Core export — bundle bodies + PMI + GD&T + materials → AP242 STEP →
// writeBlob. Returns a summary payload + publishes it on the window
// mirror + the forge:ap242-export-complete bus event so an e2e spec
// (and Archie) can inspect the result without re-deriving the path.

export async function runExport({ selected, targetPath, projectName = 'Forge Project' }) {
    if (!Array.isArray(selected) || selected.length === 0) {
        throw new Error('runExport: no bodies selected');
    }
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
        throw new Error('runExport: targetPath required');
    }
    const dialog = (typeof window !== 'undefined') ? window.forge?.dialog : null;
    if (!dialog || typeof dialog.writeBlob !== 'function') {
        throw new Error('forge.dialog.writeBlob unavailable — cannot write AP242 STEP');
    }
    const notes  = readPmiNotes();
    const frames = readGdtFrames();
    const materials = readBodyMaterials();

    const tessBodies = [];
    const tessSkipped = [];
    for (const b of selected) {
        const tess = tessellateBody(b.handle);
        const matName = materialForBody(b, materials);
        if (!tess) {
            // Surface this — the AP242 emitter still accepts an empty
            // body but the receiving CAD will read no geometry.
            tessSkipped.push({ id: b.id, handle: b.handle, name: b.name || `h${b.handle}` });
            tessBodies.push({
                id: b.id,
                name: b.name || `h${b.handle}`,
                material: matName,
                vertices: [], faces: [],
            });
            continue;
        }
        tessBodies.push({
            id: b.id,
            name: b.name || `h${b.handle}`,
            material: matName,
            vertices: tess.vertices,
            faces: tess.faces,
        });
    }

    const pmiAnnotations = buildAp242PmiPayload({
        notes, frames, selectedBodies: selected,
    });

    const text = buildAP242({
        projectName,
        bodies: tessBodies,
        pmiAnnotations,
        units: 'mm',
    });
    const bytes = new TextEncoder().encode(text);
    const res = await dialog.writeBlob(targetPath, bytes);
    if (!res || !res.ok) {
        throw new Error(`forge.dialog.writeBlob failed${res?.error ? ': ' + res.error : ''}`);
    }
    const payload = {
        path: targetPath,
        bytes: res.bytes,
        bodyCount: selected.length,
        pmiNoteCount: notes.length,
        gdtFrameCount: frames.length,
        materialAssignmentCount: Array.from(materials.values()).filter(Boolean).length,
        annotationCount: pmiAnnotations.length,
        tessSkippedCount: tessSkipped.length,
    };
    if (typeof window !== 'undefined') {
        try { window.__forgeLastAp242Export = payload; } catch {}
        try {
            window.dispatchEvent(
                new CustomEvent(FORGE_AP242_EXPORT_EVENT, { detail: payload }),
            );
        } catch { /* CustomEvent should always work in Electron */ }
    }
    return payload;
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail matching the other Forge-shell side panels
// (StlExportPanel / PmiAnnotationsPanel / etc.) so the panel slots into
// the existing information architecture rather than floating as a one-off.

const PANEL_STYLE = {
    position: 'fixed',
    top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
    right: 0,
    bottom: 'var(--forge-statusbar-h, 24px)',
    width: 380,
    zIndex: 1335,
    background: 'var(--forge-canvas-2, #161b22)',
    borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
    padding: 'var(--forge-space-3, 12px)',
    display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
    color: 'var(--forge-ink, #dadde2)', fontSize: 12,
    overflowY: 'auto',
};
const HEADER_ROW = {
    display: 'flex', alignItems: 'center', gap: 8,
};
const CLOSE_BTN = {
    background: 'transparent',
    border: '1px solid var(--forge-rail-edge, #2a2d34)',
    color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
    padding: '2px 6px', borderRadius: 3,
};
const SECTION_TITLE = {
    fontSize: 10,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    color: 'var(--forge-ink-mute, #9aa1ab)',
    margin: '8px 0 4px',
};
const CHIP_ROW = {
    display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center',
};
const CHIP = (kind) => ({
    fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
    fontSize: 10,
    color: kind === 'accent'
        ? '#fff'
        : 'var(--forge-ink-mute, #9aa1ab)',
    background: kind === 'accent'
        ? '#2563eb'
        : 'transparent',
    padding: '2px 8px',
    borderRadius: 'var(--forge-radius-pill, 10px)',
    border: '1px solid '
        + (kind === 'accent'
            ? '#1d4ed8'
            : 'var(--forge-rail-edge, #2a2d34)'),
});
const SECONDARY_BTN = (enabled) => ({
    background: 'var(--forge-surface, #1f242c)',
    border: '1px solid var(--forge-rail-edge, #2a2d34)',
    color: enabled ? 'var(--forge-ink, #dadde2)' : 'var(--forge-ink-mute, #9aa1ab)',
    cursor: enabled ? 'pointer' : 'not-allowed',
    padding: '3px 10px', borderRadius: 3,
    fontSize: 11, fontWeight: 500,
    opacity: enabled ? 1 : 0.55,
});
const PRIMARY_BTN = (enabled, busy) => ({
    background: enabled ? '#2563eb' : 'var(--forge-surface, #1f242c)',
    border: '1px solid ' + (enabled ? '#1d4ed8' : 'var(--forge-rail-edge, #2a2d34)'),
    color: enabled ? '#fff' : 'var(--forge-ink-mute, #9aa1ab)',
    cursor: enabled ? (busy ? 'progress' : 'pointer') : 'not-allowed',
    padding: '6px 14px', borderRadius: 4,
    fontSize: 12, fontWeight: 600,
    opacity: enabled ? 1 : 0.55,
});
const BODY_ROW = {
    display: 'grid',
    gridTemplateColumns: '24px 1fr auto auto',
    alignItems: 'center',
    gap: 8,
    padding: '5px 6px',
    borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
};
const HANDLE_CHIP = {
    fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
    fontSize: 10,
    color: 'var(--forge-ink-mute, #9aa1ab)',
    padding: '1px 6px', borderRadius: 'var(--forge-radius-pill, 10px)',
    border: '1px solid var(--forge-rail-edge, #2a2d34)',
};
const NOTE = (kind) => ({
    padding: '6px 8px',
    fontSize: 11,
    borderRadius: 3,
    background: kind === 'err'
        ? 'rgba(239,68,68,0.15)'
        : kind === 'ok'
            ? 'rgba(34,197,94,0.15)'
            : 'rgba(148,163,184,0.12)',
    color: kind === 'err'
        ? '#fca5a5'
        : kind === 'ok'
            ? '#86efac'
            : 'var(--forge-ink, #dadde2)',
    border: '1px solid '
        + (kind === 'err' ? '#7f1d1d' : kind === 'ok' ? '#14532d' : 'var(--forge-rail-edge, #2a2d34)'),
});

// ─────────────────────────────────────────────────────────────────────
// Panel UI.

export function Ap242ExportPanel({ open, onClose }) {
    const [bodies, setBodies] = useState(() => readNativeBodies());
    const [selected, setSelected] = useState(() => new Set());
    const [pmiNotes, setPmiNotes] = useState(() => readPmiNotes());
    const [gdtFrames, setGdtFrames] = useState(() => readGdtFrames());
    const [materials, setMaterials] = useState(() => readBodyMaterials());
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState(null);

    // Refresh on open + listen for live churn while open. We subscribe
    // to all three publishers (bodies / PMI / GD&T / materials) so the
    // count chips stay accurate while the user is adding notes / frames
    // in a sibling panel.
    useEffect(() => {
        if (!open) return undefined;
        const fresh = readNativeBodies();
        setBodies(fresh);
        setSelected(new Set(fresh.map((b) => b.handle)));
        setPmiNotes(readPmiNotes());
        setGdtFrames(readGdtFrames());
        setMaterials(readBodyMaterials());
        setNote(null);
        const onBodies = () => {
            const next = readNativeBodies();
            setBodies(next);
            setSelected((cur) => {
                const liveHandles = new Set(next.map((b) => b.handle));
                const ret = new Set();
                for (const h of cur) if (liveHandles.has(h)) ret.add(h);
                for (const b of next) if (!cur.has(b.handle)) ret.add(b.handle);
                return ret;
            });
            setMaterials(readBodyMaterials());
        };
        const onPmi = () => setPmiNotes(readPmiNotes());
        const onGdt = () => setGdtFrames(readGdtFrames());
        const onMat = () => setMaterials(readBodyMaterials());
        window.addEventListener('forge:bodies-changed', onBodies);
        window.addEventListener('forge:pmi-changed', onPmi);
        window.addEventListener('forge:gdt-frames-changed', onGdt);
        window.addEventListener('forge:material-applied', onMat);
        return () => {
            window.removeEventListener('forge:bodies-changed', onBodies);
            window.removeEventListener('forge:pmi-changed', onPmi);
            window.removeEventListener('forge:gdt-frames-changed', onGdt);
            window.removeEventListener('forge:material-applied', onMat);
        };
    }, [open]);

    const toggleBody = useCallback((handle) => {
        setSelected((cur) => {
            const next = new Set(cur);
            if (next.has(handle)) next.delete(handle);
            else next.add(handle);
            return next;
        });
    }, []);
    const selectAll = useCallback(() => {
        setSelected(new Set(bodies.map((b) => b.handle)));
    }, [bodies]);
    const selectNone = useCallback(() => {
        setSelected(new Set());
    }, []);

    const selectedBodies = useMemo(
        () => bodies.filter((b) => selected.has(b.handle)),
        [bodies, selected],
    );

    // Count materials that resolve to a selected body — the file only
    // embeds materials for bodies actually being written.
    const materialAssignmentCount = useMemo(() => {
        let n = 0;
        for (const b of selectedBodies) {
            if (materialForBody(b, materials)) n += 1;
        }
        return n;
    }, [selectedBodies, materials]);

    const onSave = useCallback(async () => {
        if (busy) return;
        if (selectedBodies.length === 0) {
            setNote({ kind: 'err', text: 'Select at least one body to export.' });
            return;
        }
        const dialog = (typeof window !== 'undefined') ? window.forge?.dialog : null;
        if (!dialog || typeof dialog.saveFile !== 'function') {
            setNote({ kind: 'err', text: 'forge.dialog.saveFile unavailable — cannot prompt for save path.' });
            return;
        }
        let chosen;
        try {
            chosen = await dialog.saveFile({
                title: 'Save AP242 STEP + PMI',
                defaultPath: 'forge-ap242.step',
                filters: [{ name: 'AP242 STEP', extensions: ['step', 'stp'] }],
            });
        } catch (ex) {
            setNote({ kind: 'err', text: `Save dialog failed: ${ex?.message || ex}` });
            return;
        }
        if (!chosen) {
            setNote({ kind: 'info', text: 'Save · canceled' });
            return;
        }
        setBusy(true);
        setNote({ kind: 'info',
            text: `Writing AP242 (${selectedBodies.length} bod${selectedBodies.length === 1 ? 'y' : 'ies'}, ${pmiNotes.length} PMI, ${gdtFrames.length} GD&T)…` });
        try {
            const payload = await runExport({
                selected: selectedBodies, targetPath: chosen,
            });
            const kb = (payload.bytes / 1024).toFixed(1);
            const skipped = payload.tessSkippedCount > 0
                ? ` · ${payload.tessSkippedCount} body(s) tessellation skipped`
                : '';
            setNote({
                kind: 'ok',
                text: `Saved · ${payload.path.split(/[/\\]/).pop()} (${kb} KB, ${payload.annotationCount} PMI entries)${skipped}`,
            });
        } catch (ex) {
            setNote({ kind: 'err', text: `AP242 export failed: ${ex?.message || ex}` });
        } finally {
            setBusy(false);
        }
    }, [busy, selectedBodies, pmiNotes, gdtFrames]);

    if (!open) return null;
    if (typeof document === 'undefined') return null;

    const exportEnabled = selectedBodies.length > 0 && bodies.length > 0;

    return createPortal(
        <div role="dialog"
             aria-label="AP242 STEP + PMI export"
             data-testid="forge-ap242-export-panel"
             data-body-count={bodies.length}
             data-selected-count={selectedBodies.length}
             data-pmi-count={pmiNotes.length}
             data-gdt-count={gdtFrames.length}
             data-material-count={materialAssignmentCount}
             data-busy={busy ? 'true' : 'false'}
             style={PANEL_STYLE}>
            <header style={HEADER_ROW}>
                <Icon name="io.step" size={14} />
                <strong style={{ fontSize: 13 }}>AP242 STEP + PMI</strong>
                <span style={HANDLE_CHIP}
                      data-testid="forge-ap242-export-body-count">
                    {selectedBodies.length}/{bodies.length}
                </span>
                <span style={{ flex: 1 }} />
                <button type="button"
                        onClick={() => onClose?.()}
                        aria-label="Close AP242 export panel"
                        data-testid="forge-ap242-export-close"
                        style={CLOSE_BTN}>×</button>
            </header>

            <div style={SECTION_TITLE}>Bundled into the .step</div>
            <div style={CHIP_ROW}>
                <span style={CHIP('accent')}
                      data-testid="forge-ap242-export-pmi-count">
                    PMI · {pmiNotes.length}
                </span>
                <span style={CHIP('accent')}
                      data-testid="forge-ap242-export-gdt-count">
                    GD&amp;T · {gdtFrames.length}
                </span>
                <span style={CHIP('accent')}
                      data-testid="forge-ap242-export-material-count">
                    Materials · {materialAssignmentCount}
                </span>
            </div>

            <div style={{ ...SECTION_TITLE, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>Bodies ({bodies.length})</span>
                <span style={{ flex: 1 }} />
                <button type="button"
                        onClick={selectAll}
                        disabled={bodies.length === 0}
                        data-testid="forge-ap242-export-select-all"
                        style={SECONDARY_BTN(bodies.length > 0)}>All</button>
                <button type="button"
                        onClick={selectNone}
                        disabled={selectedBodies.length === 0}
                        data-testid="forge-ap242-export-select-none"
                        style={SECONDARY_BTN(selectedBodies.length > 0)}>None</button>
            </div>

            {bodies.length === 0 ? (
                <div data-testid="forge-ap242-export-empty"
                     style={{
                         padding: '12px 0',
                         fontStyle: 'italic',
                         color: 'var(--forge-ink-mute, #9aa1ab)',
                         fontSize: 11,
                     }}>
                    No native bodies in the scene. Add a body via any modelling
                    workbench, then export it here.
                </div>
            ) : (
                <ul data-testid="forge-ap242-export-list"
                    style={{ listStyle: 'none', margin: 0, padding: 0,
                             display: 'flex', flexDirection: 'column' }}>
                    {bodies.map((b) => {
                        const checked = selected.has(b.handle);
                        const mat = materialForBody(b, materials);
                        return (
                            <li key={b.handle}
                                data-testid="forge-ap242-export-row"
                                data-handle={b.handle}
                                data-body-id={b.id}
                                data-checked={checked ? 'true' : 'false'}
                                data-material={mat || ''}
                                style={BODY_ROW}>
                                <input type="checkbox"
                                       checked={checked}
                                       aria-label={`Include body ${b.handle} in AP242 export`}
                                       data-testid={`forge-ap242-export-check-${b.handle}`}
                                       onChange={() => toggleBody(b.handle)} />
                                <span data-testid={`forge-ap242-export-name-${b.handle}`}
                                      title={`Body ${b.handle}`}
                                      style={{
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          whiteSpace: 'nowrap',
                                          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                                          fontSize: 11,
                                      }}>
                                    {b.name || b.toolId || `handle ${b.handle}`}
                                </span>
                                {mat ? (
                                    <span style={HANDLE_CHIP}
                                          data-testid={`forge-ap242-export-material-${b.handle}`}>
                                        {mat}
                                    </span>
                                ) : <span />}
                                <span style={HANDLE_CHIP}
                                      data-testid={`forge-ap242-export-handle-${b.handle}`}>
                                    h{b.handle}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}

            <div style={SECTION_TITLE}>PMI Notes ({pmiNotes.length})</div>
            {pmiNotes.length === 0 ? (
                <div data-testid="forge-ap242-export-pmi-empty"
                     style={{
                         padding: '6px 0', fontStyle: 'italic',
                         color: 'var(--forge-ink-mute, #9aa1ab)', fontSize: 11,
                     }}>
                    No PMI notes — add via Tools → PMI Annotations…
                </div>
            ) : (
                <ul data-testid="forge-ap242-export-pmi-list"
                    style={{ listStyle: 'none', margin: 0, padding: 0,
                             maxHeight: 120, overflowY: 'auto',
                             border: '1px solid var(--forge-rail-edge, #2a2d34)',
                             borderRadius: 3 }}>
                    {pmiNotes.map((n, i) => (
                        <li key={n.id || `pmi-${i}`}
                            data-testid="forge-ap242-export-pmi-row"
                            data-kind={n.kind}
                            data-face-id={n.faceId}
                            style={{
                                padding: '4px 6px',
                                borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
                                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                                fontSize: 10,
                                color: 'var(--forge-ink, #dadde2)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}>
                            {n.kind} · face {n.faceId} · {n.text}
                        </li>
                    ))}
                </ul>
            )}

            <div style={SECTION_TITLE}>GD&amp;T Frames ({gdtFrames.length})</div>
            {gdtFrames.length === 0 ? (
                <div data-testid="forge-ap242-export-gdt-empty"
                     style={{
                         padding: '6px 0', fontStyle: 'italic',
                         color: 'var(--forge-ink-mute, #9aa1ab)', fontSize: 11,
                     }}>
                    No GD&amp;T frames — add via Tools → GD&amp;T Feature Control Frames…
                </div>
            ) : (
                <ul data-testid="forge-ap242-export-gdt-list"
                    style={{ listStyle: 'none', margin: 0, padding: 0,
                             maxHeight: 120, overflowY: 'auto',
                             border: '1px solid var(--forge-rail-edge, #2a2d34)',
                             borderRadius: 3 }}>
                    {gdtFrames.map((f, i) => (
                        <li key={f.id || `gdt-${i}`}
                            data-testid="forge-ap242-export-gdt-row"
                            data-symbol-id={f.symbolId}
                            style={{
                                padding: '4px 6px',
                                borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
                                fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                                fontSize: 10,
                                color: 'var(--forge-ink, #dadde2)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                            }}>
                            {f.glyph || ''} {f.formatted || f.symbolId}
                        </li>
                    ))}
                </ul>
            )}

            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                <button type="button"
                        onClick={onSave}
                        disabled={!exportEnabled || busy}
                        data-testid="forge-ap242-export-save"
                        data-export-state={busy ? 'busy' : 'idle'}
                        style={PRIMARY_BTN(exportEnabled, busy)}>
                    {busy ? 'Saving…' : 'Save AP242 (.step)'}
                </button>
            </div>

            {note && (
                <div data-testid="forge-ap242-export-note"
                     data-note-kind={note.kind}
                     style={NOTE(note.kind)}>
                    {note.text}
                </div>
            )}

            <footer style={{
                padding: '8px 0 0',
                borderTop: '1px solid var(--forge-rail-edge, #2a2d34)',
                color: 'var(--forge-ink-mute, #9aa1ab)',
                fontSize: 10,
                lineHeight: 1.4,
            }}>
                ISO 10303-242 STEP w/ semantic PMI · mm units · linear
                deflection {DEFAULT_LINEAR_DEFL} mm, angular {DEFAULT_ANGULAR_DEFL} rad.
                Bundles window.__forgePmi + window.__forgeGdtFrames +
                window.__forgeBodyMaterials.
            </footer>
        </div>,
        document.body,
    );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.ap242Export` menu action, exposes the
// imperative open/close hooks for plugins / Archie tool calls, and
// surfaces the runExport helper on the window mirror at bootstrap so
// the e2e / Archie / plugins can drive the same code path without
// mounting the React panel.

export function Ap242ExportPanelHost() {
    const [open, setOpen] = useState(false);
    const mounted = useRef(false);
    useEffect(() => {
        if (mounted.current) return undefined;
        mounted.current = true;
        if (typeof window === 'undefined') return undefined;
        window.__forgeOpenAp242ExportPanel  = () => setOpen(true);
        window.__forgeCloseAp242ExportPanel = () => setOpen(false);
        const onMenu = (e) => {
            const id = e?.detail?.id;
            if (id === 'tools.ap242Export') setOpen(true);
        };
        window.addEventListener('forge:menu-action', onMenu);
        window.__forgeAp242ExportHelper = Object.freeze({
            runExport,
            readNativeBodies,
            readPmiNotes,
            readGdtFrames,
            readBodyMaterials,
            buildAp242PmiPayload,
            PUSH78_KIND_TO_AP242,
            PUSH92_SYMBOL_TO_AP242,
            EVENT_NAME: FORGE_AP242_EXPORT_EVENT,
        });
        return () => {
            window.removeEventListener('forge:menu-action', onMenu);
            try { delete window.__forgeOpenAp242ExportPanel; } catch {}
            try { delete window.__forgeCloseAp242ExportPanel; } catch {}
        };
    }, []);
    return <Ap242ExportPanel open={open} onClose={() => setOpen(false)} />;
}

export default Ap242ExportPanel;
