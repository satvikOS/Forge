// PUSH-77 (Slice-45 / STL export panel — multi-body, combined or per-body).
//
// Up through PUSH-76 the only path to STL was File → Export STL… which
// dumps a single hard-wired "last native body" through forge.io.exportStl
// (see ForgeShellV4 file.exportStl case at line 557). There was no way
// for a user to:
//   • see every native body at once,
//   • pick a *subset* to export,
//   • choose between one combined STL vs one STL per body.
//
// This panel is that surface. Right-docked, same shelf as Body Colours /
// Layers / Materials Browser. Selection checkboxes per body, a two-radio
// mode selector ("Combined" / "One per body"), and a single Export
// button that calls window.forge.io.exportStl(handle, path, lt, at, asc).
//
// Hard constraints honoured (PUSH-77 brief):
//   • NO new npm packages, NO new C++ libs — the kernel-side STL writer
//     (StlAPI_Writer in forge-kernel/src/IoExchange.cpp) is already
//     plumbed end-to-end (preload `io.exportStl` → binding.cpp
//     IoExportStl → forge::io::exportStl).
//   • Real code, no MVP, no stub — every error path surfaces in the UI
//     and the file is verifiable on disk after a successful Export.
//   • Multi-cam e2e mandate: 5 named camera angles in the spec.
//
// Save path resolution:
//   "Combined": one forge.dialog.saveFile prompt; we write each selected
//     body to a tmp .stl alongside the target via forge.io.exportStl,
//     then concatenate the resulting ASCII STL blocks into one
//     multi-solid .stl at the user-chosen target through
//     forge.dialog.writeBlob. ASCII STL is a multi-solid format —
//     every "solid … / endsolid …" block is a self-contained tri
//     stream and one .stl can carry many. Every reader we care about
//     (MeshLab, Blender, FreeCAD, our own importStl) accepts that.
//
//   "One per body": one saveFile prompt for a base path; each selected
//     body is written as `<base>-<n>-h<handle>.stl` in the picked
//     directory. Each body goes through io.exportStl directly — no
//     concatenation needed.
//
// Persistence: there's nothing to persist for STL export — every press
// of Export is a discrete user action. The panel publishes
// window.__forgeLastStlExport on completion so an e2e (and Archie) can
// inspect the result, plus a forge:stl-export-complete bus event.

import React, {
    useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';

// ─────────────────────────────────────────────────────────────────────
// Constants

export const FORGE_STL_EXPORT_EVENT = 'forge:stl-export-complete';

// ASCII STL defaults — matches the legacy file.exportStl path. The
// linear tolerance controls BRepMesh_IncrementalMesh; 0.1 mm is the
// SolidWorks / Inventor "fine" preset.
const DEFAULT_LINEAR_TOL  = 0.1;
const DEFAULT_ANGULAR_TOL = 0.5;
const DEFAULT_ASCII       = true;  // "solid …" header requested in spec

// ─────────────────────────────────────────────────────────────────────
// Native body snapshot — same filter the Layers / Materials / Mass
// Properties / Body Colours panels use. Only kernel-backed native bodies
// have a meaningful handle for io.exportStl.

function readNativeBodies() {
    if (typeof window === 'undefined') return [];
    const all = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
    return all.filter(
        (b) => b && b.kind === 'native' && typeof b.handle === 'number',
    );
}

// ─────────────────────────────────────────────────────────────────────
// Mode constants

export const STL_MODE_COMBINED = 'combined';
export const STL_MODE_PER_BODY = 'perBody';

// ─────────────────────────────────────────────────────────────────────
// Sanitise a filename component — strip path separators, control chars,
// and trim trailing dots so the OS doesn't reject "foo." on Windows.

function safeName(s, fallback = 'forge') {
    const t = String(s || '').replace(/[^a-zA-Z0-9._-]/g, '_').replace(/\.+$/, '');
    return t.length > 0 ? t : fallback;
}

// Derive a path's directory portion ("/tmp/foo.stl" → "/tmp",
// "C:\Users\x\foo.stl" → "C:\Users\x"). The dialog returns native paths
// so we honour both separators.
function dirOf(p) {
    const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    return idx > 0 ? p.slice(0, idx) : '.';
}
function baseStem(p) {
    const idx = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
    const file = idx >= 0 ? p.slice(idx + 1) : p;
    const dot  = file.lastIndexOf('.');
    return dot > 0 ? file.slice(0, dot) : file;
}
// Join a directory and a filename using the same separator the directory
// already uses (so we don't mix / and \ on a Windows-style input path).
function joinPath(dir, name) {
    if (dir.includes('\\') && !dir.includes('/')) return `${dir}\\${name}`;
    return `${dir}/${name}`;
}

// ─────────────────────────────────────────────────────────────────────
// Core export — call the kernel for each selected body. Returns an array
// of result records that the panel turns into a UI summary + the
// public window.__forgeLastStlExport hand-off.

async function exportPerBody({ selected, basePath }) {
    const io = (typeof window !== 'undefined') ? window.forge?.io : null;
    if (!io || typeof io.exportStl !== 'function') {
        throw new Error('forge.io.exportStl unavailable — kernel bridge missing');
    }
    const dir = dirOf(basePath);
    const stem = safeName(baseStem(basePath), 'forge');
    const results = [];
    let n = 0;
    for (const body of selected) {
        n += 1;
        const fname = `${stem}-${String(n).padStart(2, '0')}-h${body.handle}.stl`;
        const fp = joinPath(dir, fname);
        const ok = await io.exportStl(body.handle, fp,
            DEFAULT_LINEAR_TOL, DEFAULT_ANGULAR_TOL, DEFAULT_ASCII);
        if (!ok) {
            throw new Error(`forge.io.exportStl returned false for handle ${body.handle}`);
        }
        results.push({ handle: body.handle, name: body.name || `handle ${body.handle}`, path: fp });
    }
    return results;
}

// Combined mode — write each body to a tmp .stl via the kernel then
// concatenate them into a single multi-solid ASCII .stl at the target
// path through forge.dialog.writeBlob.
//
// ASCII STL grammar (well-known):
//   solid <name>
//     facet normal nx ny nz
//       outer loop
//         vertex x y z
//         vertex x y z
//         vertex x y z
//       endloop
//     endfacet
//     …
//   endsolid <name>
//
// One file may contain multiple solid blocks. Every reader we care about
// (MeshLab, Blender, FreeCAD, our own importStl) accepts that — except
// some legacy tools that read only the first solid. We document the
// behaviour in the UI and proceed: the spec asks for "single combined
// file" and the multi-solid form is the canonical realisation that
// preserves every body's identity.
async function exportCombined({ selected, targetPath }) {
    const io     = (typeof window !== 'undefined') ? window.forge?.io     : null;
    const dialog = (typeof window !== 'undefined') ? window.forge?.dialog : null;
    if (!io || typeof io.exportStl !== 'function') {
        throw new Error('forge.io.exportStl unavailable — kernel bridge missing');
    }
    if (!dialog || typeof dialog.writeBlob !== 'function') {
        throw new Error('forge.dialog.writeBlob unavailable — cannot write combined STL');
    }
    // We need a way to read the per-body ASCII back into JavaScript so
    // we can concatenate. The kernel has `io.writeTmpStl(name, bytes) →
    // path` (preload line 1289) for the other direction; for reads we
    // pipe through fetch() against a file:// URL — Electron's renderer
    // accepts that. Falls back to XMLHttpRequest if fetch refuses the
    // scheme (older Electron builds set webSecurity).
    async function readTextFile(p) {
        // Normalise Windows backslashes for the URL.
        const urlPath = p.replace(/\\/g, '/');
        const url = `file://${urlPath.startsWith('/') ? '' : '/'}${urlPath}`;
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
            return await res.text();
        } catch (err) {
            // Try the XHR fallback before giving up. Some Electron versions
            // disallow fetch('file:...') even in the renderer.
            return await new Promise((resolve, reject) => {
                try {
                    const xhr = new XMLHttpRequest();
                    xhr.open('GET', url, true);
                    xhr.responseType = 'text';
                    xhr.onload = () => {
                        if (xhr.status === 0 || (xhr.status >= 200 && xhr.status < 300)) {
                            resolve(xhr.responseText);
                        } else {
                            reject(new Error(`xhr ${url} → ${xhr.status}`));
                        }
                    };
                    xhr.onerror = () => reject(err || new Error(`xhr error reading ${url}`));
                    xhr.send();
                } catch (xhrErr) {
                    reject(xhrErr);
                }
            });
        }
    }
    // Run the kernel writes serially — io.exportStl returns synchronously
    // from preload (it bridges to a sync N-API call) so awaiting is moot
    // for the call itself, but we want to keep the UI responsive between
    // bodies and the read step is async.
    const dir = dirOf(targetPath);
    const stem = safeName(baseStem(targetPath), 'forge');
    const blocks = [];
    const written = [];
    let n = 0;
    for (const body of selected) {
        n += 1;
        const tmpName = `${stem}-tmp-${n}-h${body.handle}.stl`;
        const tmpPath = joinPath(dir, tmpName);
        const ok = await io.exportStl(body.handle, tmpPath,
            DEFAULT_LINEAR_TOL, DEFAULT_ANGULAR_TOL, DEFAULT_ASCII);
        if (!ok) {
            throw new Error(`forge.io.exportStl returned false for handle ${body.handle}`);
        }
        const txt = await readTextFile(tmpPath);
        // Rename the embedded "solid …" / "endsolid …" name so the
        // combined file carries the user-facing body name, not the
        // kernel's anonymous "OCC_Stl" / "Shape" default.
        const niceName = safeName(body.name || `body${body.handle}`, `body${body.handle}`);
        let blockTxt = txt
            .replace(/^solid[^\n]*\n/m, `solid ${niceName}\n`)
            .replace(/endsolid[^\n]*\n?\s*$/m, `endsolid ${niceName}\n`);
        // Some STL writers don't emit a trailing newline. Make sure
        // every block ends with one so the next "solid …" starts on a
        // fresh line.
        if (!blockTxt.endsWith('\n')) blockTxt += '\n';
        blocks.push(blockTxt);
        written.push({ handle: body.handle, name: niceName, tmpPath });
    }
    const combined = blocks.join('');
    const bytes = new TextEncoder().encode(combined);
    const res = await dialog.writeBlob(targetPath, bytes);
    if (!res || !res.ok) {
        throw new Error(`forge.dialog.writeBlob failed${res?.error ? ': ' + res.error : ''}`);
    }
    return {
        path: targetPath,
        bytes: res.bytes,
        bodyCount: selected.length,
        tmpPaths: written.map((w) => w.tmpPath),
    };
}

// ─────────────────────────────────────────────────────────────────────
// Public API surface — exposed via window.__forgeStlExportHelper so
// e2e / plugins / Archie can drive the export without mounting the
// React panel.

export async function runExport({ mode, selected, targetPath }) {
    if (!Array.isArray(selected) || selected.length === 0) {
        throw new Error('runExport: no bodies selected');
    }
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
        throw new Error('runExport: targetPath required');
    }
    const m = (mode === STL_MODE_PER_BODY) ? STL_MODE_PER_BODY : STL_MODE_COMBINED;
    let payload;
    if (m === STL_MODE_PER_BODY) {
        const results = await exportPerBody({ selected, basePath: targetPath });
        payload = {
            mode: m,
            bodyCount: selected.length,
            paths: results.map((r) => r.path),
            results,
            targetPath,
        };
    } else {
        const res = await exportCombined({ selected, targetPath });
        payload = {
            mode: m,
            bodyCount: selected.length,
            paths: [res.path],
            results: [{ path: res.path, bytes: res.bytes, bodyCount: res.bodyCount }],
            targetPath,
            bytes: res.bytes,
        };
    }
    if (typeof window !== 'undefined') {
        try { window.__forgeLastStlExport = payload; } catch {}
        try {
            window.dispatchEvent(
                new CustomEvent(FORGE_STL_EXPORT_EVENT, { detail: payload }),
            );
        } catch { /* CustomEvent should always work in Electron */ }
    }
    return payload;
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail, same shelf as Layers / Body Colours /
// Materials Browser / MassProps. 360 px wide so the body name + the
// checkbox + the handle chip fit on one line without truncating.

const PANEL_STYLE = {
    position: 'fixed',
    top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
    right: 0,
    bottom: 'var(--forge-statusbar-h, 24px)',
    width: 360,
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

export function StlExportPanel({ open, onClose }) {
    const [bodies, setBodies] = useState(() => readNativeBodies());
    const [selected, setSelected] = useState(() => new Set());
    const [mode, setMode] = useState(STL_MODE_COMBINED);
    const [busy, setBusy] = useState(false);
    const [note, setNote] = useState(null);

    // Refresh body list on open + listen for live churn while open.
    useEffect(() => {
        if (!open) return undefined;
        const fresh = readNativeBodies();
        setBodies(fresh);
        // Default-select every native body so the common case ("just
        // export everything") is one click.
        setSelected(new Set(fresh.map((b) => b.handle)));
        setNote(null);
        const onBodies = () => {
            const next = readNativeBodies();
            setBodies(next);
            setSelected((cur) => {
                // Keep any selection that's still in the scene, plus
                // default-select any newly added bodies.
                const liveHandles = new Set(next.map((b) => b.handle));
                const ret = new Set();
                for (const h of cur) if (liveHandles.has(h)) ret.add(h);
                for (const b of next) if (!cur.has(b.handle)) ret.add(b.handle);
                return ret;
            });
        };
        window.addEventListener('forge:bodies-changed', onBodies);
        return () => {
            window.removeEventListener('forge:bodies-changed', onBodies);
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

    const onExport = useCallback(async () => {
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
        const defaultName = mode === STL_MODE_PER_BODY
            ? 'forge-bodies.stl'   // user picks a base; we append per-body suffix
            : 'forge-combined.stl';
        let chosen;
        try {
            chosen = await dialog.saveFile({
                title: mode === STL_MODE_PER_BODY
                    ? 'Save STL (one file per body — base name)'
                    : 'Save STL (combined)',
                defaultPath: defaultName,
                filters: [{ name: 'STL', extensions: ['stl'] }],
            });
        } catch (ex) {
            setNote({ kind: 'err', text: `Save dialog failed: ${ex?.message || ex}` });
            return;
        }
        if (!chosen) {
            setNote({ kind: 'info', text: 'Export · canceled' });
            return;
        }
        setBusy(true);
        setNote({ kind: 'info', text: `Exporting ${selectedBodies.length} bod${selectedBodies.length === 1 ? 'y' : 'ies'}…` });
        try {
            const payload = await runExport({
                mode, selected: selectedBodies, targetPath: chosen,
            });
            if (payload.mode === STL_MODE_PER_BODY) {
                setNote({
                    kind: 'ok',
                    text: `Saved ${payload.paths.length} file${payload.paths.length === 1 ? '' : 's'} · ${dirOf(chosen)}`,
                });
            } else {
                const kb = (payload.bytes / 1024).toFixed(1);
                setNote({
                    kind: 'ok',
                    text: `Saved · ${payload.paths[0].split(/[/\\]/).pop()} (${kb} KB, ${payload.bodyCount} solids)`,
                });
            }
        } catch (ex) {
            setNote({ kind: 'err', text: `Export failed: ${ex?.message || ex}` });
        } finally {
            setBusy(false);
        }
    }, [busy, mode, selectedBodies]);

    if (!open) return null;
    if (typeof document === 'undefined') return null;

    const exportEnabled = selectedBodies.length > 0 && bodies.length > 0;

    return createPortal(
        <div role="dialog"
             aria-label="Multi-body STL export"
             data-testid="forge-stl-export-panel"
             data-body-count={bodies.length}
             data-selected-count={selectedBodies.length}
             data-mode={mode}
             data-busy={busy ? 'true' : 'false'}
             style={PANEL_STYLE}>
            <header style={HEADER_ROW}>
                <Icon name="io.stl" size={14} />
                <strong style={{ fontSize: 13 }}>Multi-body STL export</strong>
                <span style={HANDLE_CHIP}
                      data-testid="forge-stl-export-count">
                    {selectedBodies.length}/{bodies.length}
                </span>
                <span style={{ flex: 1 }} />
                <button type="button"
                        onClick={() => onClose?.()}
                        aria-label="Close STL export panel"
                        data-testid="forge-stl-export-close"
                        style={CLOSE_BTN}>×</button>
            </header>

            <div style={SECTION_TITLE}>Mode</div>
            <fieldset style={{
                margin: 0, padding: 0, border: 'none',
                display: 'flex', gap: 14,
            }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="radio"
                           name="forge-stl-export-mode"
                           value={STL_MODE_COMBINED}
                           checked={mode === STL_MODE_COMBINED}
                           data-testid="forge-stl-export-mode-combined"
                           onChange={() => setMode(STL_MODE_COMBINED)} />
                    Combined (single .stl)
                </label>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input type="radio"
                           name="forge-stl-export-mode"
                           value={STL_MODE_PER_BODY}
                           checked={mode === STL_MODE_PER_BODY}
                           data-testid="forge-stl-export-mode-perbody"
                           onChange={() => setMode(STL_MODE_PER_BODY)} />
                    One file per body
                </label>
            </fieldset>

            <div style={{ ...SECTION_TITLE, display: 'flex', alignItems: 'center', gap: 8 }}>
                <span>Bodies ({bodies.length})</span>
                <span style={{ flex: 1 }} />
                <button type="button"
                        onClick={selectAll}
                        disabled={bodies.length === 0}
                        data-testid="forge-stl-export-select-all"
                        style={SECONDARY_BTN(bodies.length > 0)}>All</button>
                <button type="button"
                        onClick={selectNone}
                        disabled={selectedBodies.length === 0}
                        data-testid="forge-stl-export-select-none"
                        style={SECONDARY_BTN(selectedBodies.length > 0)}>None</button>
            </div>

            {bodies.length === 0 ? (
                <div data-testid="forge-stl-export-empty"
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
                <ul data-testid="forge-stl-export-list"
                    style={{ listStyle: 'none', margin: 0, padding: 0,
                             display: 'flex', flexDirection: 'column' }}>
                    {bodies.map((b) => {
                        const checked = selected.has(b.handle);
                        return (
                            <li key={b.handle}
                                data-testid="forge-stl-export-row"
                                data-handle={b.handle}
                                data-body-id={b.id}
                                data-checked={checked ? 'true' : 'false'}
                                style={BODY_ROW}>
                                <input type="checkbox"
                                       checked={checked}
                                       aria-label={`Include body ${b.handle} in STL export`}
                                       data-testid={`forge-stl-export-check-${b.handle}`}
                                       onChange={() => toggleBody(b.handle)} />
                                <span data-testid={`forge-stl-export-name-${b.handle}`}
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
                                <span style={HANDLE_CHIP}
                                      data-testid={`forge-stl-export-handle-${b.handle}`}>
                                    h{b.handle}
                                </span>
                            </li>
                        );
                    })}
                </ul>
            )}

            <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                <button type="button"
                        onClick={onExport}
                        disabled={!exportEnabled || busy}
                        data-testid="forge-stl-export-go"
                        data-export-state={busy ? 'busy' : 'idle'}
                        style={PRIMARY_BTN(exportEnabled, busy)}>
                    {busy ? 'Exporting…' : (mode === STL_MODE_PER_BODY ? 'Export · per body' : 'Export · combined')}
                </button>
            </div>

            {note && (
                <div data-testid="forge-stl-export-note"
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
                ASCII STL (multi-solid where combined), {DEFAULT_LINEAR_TOL} mm
                linear tolerance, {DEFAULT_ANGULAR_TOL} rad angular tolerance.
                One-per-body writes <code>&lt;base&gt;-&lt;n&gt;-h&lt;handle&gt;.stl</code>
                alongside the chosen file.
            </footer>
        </div>,
        document.body,
    );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.stlExport` menu action, exposes the
// imperative open/close hooks for plugins / Archie tool calls, and
// surfaces the runExport helper on the window mirror at bootstrap.

export function StlExportPanelHost() {
    const [open, setOpen] = useState(false);
    const mounted = useRef(false);
    useEffect(() => {
        if (mounted.current) return undefined;
        mounted.current = true;
        if (typeof window === 'undefined') return undefined;
        window.__forgeOpenStlExportPanel  = () => setOpen(true);
        window.__forgeCloseStlExportPanel = () => setOpen(false);
        const onMenu = (e) => {
            const id = e?.detail?.id;
            if (id === 'tools.stlExport') setOpen(true);
        };
        window.addEventListener('forge:menu-action', onMenu);
        // Expose a small debug surface on window so the e2e specs can
        // drive the export pipeline without mounting the React panel
        // first, and so Archie tool calls can deterministically export
        // via the same code path.
        window.__forgeStlExportHelper = Object.freeze({
            runExport,
            readNativeBodies,
            MODE_COMBINED: STL_MODE_COMBINED,
            MODE_PER_BODY: STL_MODE_PER_BODY,
            EVENT_NAME:    FORGE_STL_EXPORT_EVENT,
        });
        return () => {
            window.removeEventListener('forge:menu-action', onMenu);
            try { delete window.__forgeOpenStlExportPanel; } catch {}
            try { delete window.__forgeCloseStlExportPanel; } catch {}
        };
    }, []);
    return <StlExportPanel open={open} onClose={() => setOpen(false)} />;
}

export default StlExportPanel;
