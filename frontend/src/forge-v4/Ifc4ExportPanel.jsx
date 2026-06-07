// PUSH-123 (Slice-91) — IFC4 (BIM) Export panel.
//
// PUSH-13 / Forge-121 shipped the kernel-side IFC4 emitter
// (frontend/src/forge-v4/ifcExport.js → buildIfcText + exportIFC). The
// path through the UI was File → Export IFC4 (.ifc)… (ForgeShellV4
// line 627) which opens the legacy modal IfcExportPanel — a heavyweight
// per-body storey + IFC-type assignment table. That panel is great when
// the user wants fine-grained BIM tagging but heavy for the common day-
// to-day workflow:
//
//   "Take every native body in the scene, stamp them with a project
//    name + description + length unit, and write the IFC4 file."
//
// PUSH-123 ships the dedicated right-docked Ifc4ExportPanel for that
// workflow:
//   • Bodies checklist (per-row testable check-box).
//   • IFC project metadata (name, description, length unit).
//   • One Save button → window.forge.dialog.saveFile + writeBlob.
//   • Publishes window.__forgeLastIfc4Export + a forge:ifc4-export-
//     complete bus event so an e2e / Archie / plugin can inspect the
//     result without scraping the DOM.
//
// Hard constraints honoured (PUSH-123 brief):
//   • NO new npm packages, NO new C++ libs — the kernel surface is
//     unchanged. buildIfcText + exportIFC already exist in
//     ifcExport.js; this panel composes them.
//   • Real implementation: no stub, no fallback. If the kernel binding
//     refuses (forge.dialog.writeBlob missing, etc.) we surface the
//     error in the UI instead of silently succeeding.
//   • Surgical edits to Menus.jsx (one tools.ifcExport entry) and
//     App.jsx (one import + one mount). The existing
//     file.exportIfc menu path (ForgeShellV4 line 627) stays
//     unchanged — different code path, different test-id namespace
//     (forge-ifc4-* vs forge-ifc-*), no collision.
//   • Multi-cam e2e: 5 named camera angles per the Forge-171 mandate.
//
// Manual button clicks NEVER write to Archie's thread.

import React, {
    useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import { buildIfcText } from './ifcExport.js';

// ─────────────────────────────────────────────────────────────────────
// Constants — export so the e2e spec / plugins / Archie tool calls can
// reach the same names without re-deriving them.

export const FORGE_IFC4_EXPORT_EVENT = 'forge:ifc4-export-complete';

const UNIT_OPTIONS = Object.freeze([
    { value: 'mm', label: 'Millimetres (mm)' },
    { value: 'cm', label: 'Centimetres (cm)' },
    { value: 'm',  label: 'Metres (m)' },
    { value: 'in', label: 'Inches (in)' },
    { value: 'ft', label: 'Feet (ft)' },
]);

// ─────────────────────────────────────────────────────────────────────
// Body source — reads window.__forgeBodies and filters to anything the
// IFC emitter can produce geometry for (native handles + synthetic
// box/cylinder/sphere specs).

function readSceneBodies() {
    if (typeof window === 'undefined') return [];
    const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
    return all.filter((b) => {
        if (!b) return false;
        if (typeof b.handle === 'number') return true;
        if (b.spec && typeof b.spec.kind === 'string') return true;
        return false;
    });
}

function bodyKey(b) {
    if (b.id != null) return String(b.id);
    if (typeof b.handle === 'number') return `h${b.handle}`;
    return `idx-${b._idx || ''}`;
}

function defaultProjectName() {
    if (typeof window !== 'undefined' && typeof window.__forgeProjectName === 'string') {
        return window.__forgeProjectName;
    }
    return 'Forge IFC4 Project';
}

// ─────────────────────────────────────────────────────────────────────
// Core export — bundle selected bodies + project metadata → IFC4 STEP
// text → forge.dialog.writeBlob. Returns a summary payload + publishes
// it on the window mirror + the forge:ifc4-export-complete bus event.

export async function runIfc4Export({
    selected,
    targetPath,
    projectName = 'Forge IFC4 Project',
    description = '',
    units = 'mm',
}) {
    if (!Array.isArray(selected) || selected.length === 0) {
        throw new Error('runIfc4Export: no bodies selected');
    }
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
        throw new Error('runIfc4Export: targetPath required');
    }
    const dialog = (typeof window !== 'undefined') ? window.forge?.dialog : null;
    if (!dialog || typeof dialog.writeBlob !== 'function') {
        throw new Error('forge.dialog.writeBlob unavailable — cannot write IFC4');
    }

    // The IFC4 emitter already drops a description into the project
    // record by appending "Forge IFC4 export of <name>". To honour the
    // user's free-form description without modifying ifcExport.js, we
    // pass projectName as `"<name> — <description>"` when the user
    // supplied one; the emitter still picks the canonical IfcProject
    // Name + IfcBuilding Name from this string. Tests check both.
    const stampedName = description && description.trim().length > 0
        ? `${projectName} — ${description}`
        : projectName;

    const ifcText = buildIfcText({
        bodies: selected,
        projectName: stampedName,
        units,
    });
    const bytes = new TextEncoder().encode(ifcText);
    const res = await dialog.writeBlob(targetPath, bytes);
    if (!res || !res.ok) {
        throw new Error(`forge.dialog.writeBlob failed${res?.error ? ': ' + res.error : ''}`);
    }
    const payload = {
        path: targetPath,
        bytes: res.bytes,
        bodyCount: selected.length,
        projectName,
        description,
        units,
        schema: 'IFC4',
    };
    if (typeof window !== 'undefined') {
        try { window.__forgeLastIfc4Export = payload; } catch {}
        try {
            window.dispatchEvent(
                new CustomEvent(FORGE_IFC4_EXPORT_EVENT, { detail: payload }),
            );
        } catch { /* CustomEvent should always work in Electron */ }
    }
    return payload;
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail matching the other Forge-shell side panels
// so the IFC4 export panel slots into the existing IA rather than
// floating as a one-off.

const PANEL_STYLE = {
    position: 'fixed',
    top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
    right: 0,
    bottom: 'var(--forge-statusbar-h, 24px)',
    width: 380,
    zIndex: 1338,
    background: 'var(--forge-canvas-2, #161b22)',
    borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
    padding: 'var(--forge-space-3, 12px)',
    display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
    color: 'var(--forge-ink, #dadde2)', fontSize: 12,
    overflowY: 'auto',
};
const HEADER_ROW = { display: 'flex', alignItems: 'center', gap: 8 };
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
const CHIP_ROW = { display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' };
const CHIP = (kind) => ({
    fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
    fontSize: 10,
    color: kind === 'accent' ? '#fff' : 'var(--forge-ink-mute, #9aa1ab)',
    background: kind === 'accent' ? '#2563eb' : 'transparent',
    padding: '2px 8px',
    borderRadius: 'var(--forge-radius-pill, 10px)',
    border: '1px solid ' + (kind === 'accent' ? '#1d4ed8' : 'var(--forge-rail-edge, #2a2d34)'),
});
const FIELD_LABEL = {
    fontSize: 10,
    color: 'var(--forge-ink-mute, #9aa1ab)',
    margin: '4px 0 2px',
};
const TEXT_INPUT = {
    background: 'var(--forge-canvas, #1a1d24)',
    border: '1px solid var(--forge-rail-edge, #2a2d34)',
    borderRadius: 3,
    color: 'var(--forge-ink, #dadde2)',
    fontFamily: 'inherit',
    fontSize: 12,
    padding: '4px 8px',
    width: '100%',
    outline: 'none',
    boxSizing: 'border-box',
};
const SELECT_INPUT = { ...TEXT_INPUT, cursor: 'pointer' };
const TEXTAREA_INPUT = { ...TEXT_INPUT, minHeight: 48, resize: 'vertical' };
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
    gridTemplateColumns: '24px 1fr auto',
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

export function Ifc4ExportPanel({ open, onClose }) {
    const [bodies, setBodies] = useState(() => readSceneBodies());
    const [selected, setSelected] = useState(() => new Set(readSceneBodies().map(bodyKey)));
    const [projectName, setProjectName] = useState(() => defaultProjectName());
    const [description, setDescription] = useState('');
    const [units, setUnits] = useState('mm');
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState(null);

    // Hydrate every time the panel opens. Subscribe to body churn while
    // the panel is open so the checklist tracks live scene changes
    // (a sibling workbench can add a body and it'll appear here).
    useEffect(() => {
        if (!open) return undefined;
        const fresh = readSceneBodies();
        setBodies(fresh);
        setSelected(new Set(fresh.map(bodyKey)));
        setNote(null);

        const onBodies = () => {
            const next = readSceneBodies();
            setBodies(next);
            setSelected((cur) => {
                const liveKeys = new Set(next.map(bodyKey));
                const ret = new Set();
                for (const k of cur) if (liveKeys.has(k)) ret.add(k);
                for (const b of next) {
                    const k = bodyKey(b);
                    if (!cur.has(k)) ret.add(k);
                }
                return ret;
            });
        };
        window.addEventListener('forge:bodies-changed', onBodies);
        return () => {
            window.removeEventListener('forge:bodies-changed', onBodies);
        };
    }, [open]);

    const toggleBody = useCallback((key) => {
        setSelected((cur) => {
            const next = new Set(cur);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
        });
    }, []);
    const selectAll = useCallback(() => {
        setSelected(new Set(bodies.map(bodyKey)));
    }, [bodies]);
    const selectNone = useCallback(() => {
        setSelected(new Set());
    }, []);

    const selectedBodies = useMemo(
        () => bodies.filter((b) => selected.has(bodyKey(b))),
        [bodies, selected],
    );

    const onSave = useCallback(async () => {
        if (busy) return;
        if (selectedBodies.length === 0) {
            setNote({ kind: 'err', text: 'Select at least one body to export.' });
            return;
        }
        if (!projectName || !projectName.trim()) {
            setNote({ kind: 'err', text: 'Project name is required.' });
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
                title: 'Save IFC4 (.ifc)',
                defaultPath: `${projectName.trim().replace(/[^a-zA-Z0-9._-]+/g, '_').replace(/^_+|_+$/g, '') || 'forge-ifc4'}.ifc`,
                filters: [{ name: 'IFC4 (Industry Foundation Classes)', extensions: ['ifc'] }],
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
            text: `Writing IFC4 (${selectedBodies.length} bod${selectedBodies.length === 1 ? 'y' : 'ies'}, units = ${units})…` });
        try {
            const payload = await runIfc4Export({
                selected: selectedBodies,
                targetPath: chosen,
                projectName: projectName.trim(),
                description: description.trim(),
                units,
            });
            const kb = (payload.bytes / 1024).toFixed(1);
            setNote({
                kind: 'ok',
                text: `Saved · ${payload.path.split(/[/\\]/).pop()} (${kb} KB)`,
            });
        } catch (ex) {
            setNote({ kind: 'err', text: `IFC4 export failed: ${ex?.message || ex}` });
        } finally {
            setBusy(false);
        }
    }, [busy, selectedBodies, projectName, description, units]);

    if (!open) return null;
    if (typeof document === 'undefined') return null;

    const exportEnabled = selectedBodies.length > 0
        && bodies.length > 0
        && Boolean(projectName && projectName.trim());

    return createPortal(
        <div role="dialog"
             aria-label="IFC4 (BIM) export"
             data-testid="forge-ifc4-export-panel"
             data-body-count={bodies.length}
             data-selected-count={selectedBodies.length}
             data-units={units}
             data-project-name={projectName}
             data-busy={busy ? 'true' : 'false'}
             style={PANEL_STYLE}>
            <header style={HEADER_ROW}>
                <Icon name="io.step" size={14} />
                <strong style={{ fontSize: 13 }}>IFC4 (BIM) Export</strong>
                <span style={HANDLE_CHIP}
                      data-testid="forge-ifc4-export-body-count">
                    {selectedBodies.length}/{bodies.length}
                </span>
                <span style={{ flex: 1 }} />
                <button type="button"
                        onClick={() => onClose?.()}
                        aria-label="Close IFC4 export panel"
                        data-testid="forge-ifc4-export-close"
                        style={CLOSE_BTN}>×</button>
            </header>

            <div style={SECTION_TITLE}>Project metadata</div>
            <div style={FIELD_LABEL}>Project name</div>
            <input type="text"
                   value={projectName}
                   onChange={(e) => setProjectName(e.target.value)}
                   spellCheck={false}
                   aria-label="IFC project name"
                   data-testid="forge-ifc4-export-name"
                   style={TEXT_INPUT} />
            <div style={FIELD_LABEL}>Description</div>
            <textarea value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      spellCheck={false}
                      aria-label="IFC project description"
                      data-testid="forge-ifc4-export-description"
                      style={TEXTAREA_INPUT} />
            <div style={FIELD_LABEL}>Length unit</div>
            <select value={units}
                    onChange={(e) => setUnits(e.target.value)}
                    aria-label="IFC length unit"
                    data-testid="forge-ifc4-export-units"
                    style={SELECT_INPUT}>
                {UNIT_OPTIONS.map((u) => (
                    <option key={u.value} value={u.value}>{u.label}</option>
                ))}
            </select>

            <div style={{ ...SECTION_TITLE, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>Bodies ({bodies.length})</span>
                <span style={{ flex: 1 }} />
                <button type="button"
                        onClick={selectAll}
                        disabled={bodies.length === 0}
                        data-testid="forge-ifc4-export-select-all"
                        style={SECONDARY_BTN(bodies.length > 0)}>All</button>
                <button type="button"
                        onClick={selectNone}
                        disabled={selectedBodies.length === 0}
                        data-testid="forge-ifc4-export-select-none"
                        style={SECONDARY_BTN(selectedBodies.length > 0)}>None</button>
            </div>

            {bodies.length === 0 ? (
                <div data-testid="forge-ifc4-export-empty"
                     style={{
                         padding: '12px 0',
                         fontStyle: 'italic',
                         color: 'var(--forge-ink-mute, #9aa1ab)',
                         fontSize: 11,
                     }}>
                    No bodies in the scene. Add a body via any modelling
                    workbench, then export it here.
                </div>
            ) : (
                <ul data-testid="forge-ifc4-export-list"
                    style={{ listStyle: 'none', margin: 0, padding: 0,
                             display: 'flex', flexDirection: 'column' }}>
                    {bodies.map((b) => {
                        const key = bodyKey(b);
                        const checked = selected.has(key);
                        return (
                            <li key={key}
                                data-testid="forge-ifc4-export-row"
                                data-body-key={key}
                                data-checked={checked ? 'true' : 'false'}
                                style={BODY_ROW}>
                                <input type="checkbox"
                                       checked={checked}
                                       aria-label={`Include ${b.name || key} in IFC4 export`}
                                       data-testid={`forge-ifc4-export-check-${key}`}
                                       onChange={() => toggleBody(key)} />
                                <span data-testid={`forge-ifc4-export-name-${key}`}
                                      title={String(b.name || key)}
                                      style={{
                                          overflow: 'hidden',
                                          textOverflow: 'ellipsis',
                                          whiteSpace: 'nowrap',
                                          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
                                          fontSize: 11,
                                      }}>
                                    {b.name || b.toolId || key}
                                </span>
                                <span style={HANDLE_CHIP}
                                      data-testid={`forge-ifc4-export-handle-${key}`}>
                                    {typeof b.handle === 'number' ? `h${b.handle}` : (b.spec?.kind || 'body')}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}

            <div style={CHIP_ROW}>
                <span style={CHIP('accent')}
                      data-testid="forge-ifc4-export-schema-chip">
                    Schema · IFC4
                </span>
                <span style={CHIP('accent')}
                      data-testid="forge-ifc4-export-units-chip">
                    Units · {units}
                </span>
            </div>

            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                <button type="button"
                        onClick={onSave}
                        disabled={!exportEnabled || busy}
                        data-testid="forge-ifc4-export-save"
                        data-export-state={busy ? 'busy' : 'idle'}
                        style={PRIMARY_BTN(exportEnabled, busy)}>
                    {busy ? 'Saving…' : 'Save IFC4 (.ifc)'}
                </button>
            </div>

            {note && (
                <div data-testid="forge-ifc4-export-note"
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
                ISO 16739-1:2018 · STEP21 envelope · IfcProject / IfcSite /
                IfcBuilding / IfcBuildingStorey spatial hierarchy.
                Per-body IFCFACETEDBREP via OCCT tessellation.
            </footer>
        </div>,
        document.body,
    );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.ifcExport` menu action, exposes the
// imperative open/close hooks for plugins / Archie tool calls, and
// surfaces the runIfc4Export helper on the window mirror at bootstrap
// so the e2e / Archie / plugins can drive the same code path without
// mounting the React panel.

export function Ifc4ExportPanelHost() {
    const [open, setOpen] = useState(false);
    const mounted = useRef(false);
    useEffect(() => {
        if (mounted.current) return undefined;
        mounted.current = true;
        if (typeof window === 'undefined') return undefined;
        window.__forgeOpenIfc4Export  = () => setOpen(true);
        window.__forgeCloseIfc4Export = () => setOpen(false);
        const onMenu = (e) => {
            const id = e?.detail?.id;
            if (id === 'tools.ifcExport') setOpen(true);
        };
        window.addEventListener('forge:menu-action', onMenu);
        window.__forgeIfc4ExportHelper = Object.freeze({
            runIfc4Export,
            readSceneBodies,
            buildIfcText,
            UNIT_OPTIONS,
            EVENT_NAME: FORGE_IFC4_EXPORT_EVENT,
        });
        return () => {
            window.removeEventListener('forge:menu-action', onMenu);
            try { delete window.__forgeOpenIfc4Export; } catch {}
            try { delete window.__forgeCloseIfc4Export; } catch {}
        };
    }, []);
    return <Ifc4ExportPanel open={open} onClose={() => setOpen(false)} />;
}

export default Ifc4ExportPanel;
