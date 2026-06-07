// PUSH-113 (Slice-82) — Drawing Templates Panel.
//
// PUSH-110 (Slice-79) shipped the Print Preview panel, which paints the
// live HLR view2D onto an ISO/ANSI sheet with a five-row meta block.
// What PUSH-113 adds is the catalogue side of the equation: predefined
// drawing templates (A0 / A1 / A2 / A3 / A4 in portrait + landscape)
// with a real engineering title block (Project / Drawing / Drawn by /
// Checked / Sheet / Scale / Revision), a four-row revision history
// table, and a four-row × five-col BOM placeholder.
//
// What the panel does:
//
//   * Template picker — built-in sheet catalogue (7 sheets from
//     PREDEFINED_TEMPLATES) plus any custom templates the user has
//     saved (loaded from localStorage on mount).
//   * Title-block editor — Project, Drawing, Drawn by, Checked by,
//     Drawn date, Checked date, Scale (1:1..1:100), Revision (A..Z).
//     Edits are live: the preview SVG re-renders on every keystroke.
//   * Live preview — pixel-scaled rectangle that renders the SVG via
//     dangerouslySetInnerHTML so the drafter can verify the title-block
//     placement, revision-table alignment, and drawing-area extent
//     before they save the template.
//   * Save as custom… — names the current sheet + title-block stamp,
//     persists to localStorage under forge.v4.drawingTemplates, and
//     adds it to the picker.
//   * Save SVG… — writes the rendered template SVG to disk via
//     forge.dialog.saveFile + writeBlob (same pipeline Print Preview
//     uses). The output is a complete W3C SVG document ready for any
//     downstream drawing pipeline.
//   * Load into Drawings… — publishes the SVG to
//     window.__forgeDrawingTemplate so the Drawings (HLR) workbench
//     can pick it up + render edges on top of the template.
//
// Pure React, pure JS — no new npm / C++ / external deps.
// Manual UI only — never posts to Archie, never opens the dock.

import React, { useEffect, useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
    PREDEFINED_TEMPLATES,
    SCALE_OPTIONS,
    ISO_SHEETS,
    ORIENTATIONS,
    buildSheetTemplate,
    buildA0Template, buildA1Template, buildA2Template, buildA3Template, buildA4Template,
    defaultTitleBlock,
    sheetMm,
    loadCustomTemplates, saveCustomTemplate, deleteCustomTemplate,
    LOCALSTORAGE_KEY,
} from './drawingTemplates.js';

export function DrawingTemplatesPanel({ onClose }) {
    const [activeId, setActiveId] = useState('A3-landscape');
    const [titleBlock, setTitleBlock] = useState(() => defaultTitleBlock());
    const [customTemplates, setCustomTemplates] = useState(() => loadCustomTemplates());
    const [saveNote, setSaveNote] = useState(null);
    const [error, setError] = useState(null);
    const [newName, setNewName] = useState('');

    // Resolve the active sheet (built-in OR custom).
    const activeTemplate = useMemo(() => {
        const builtins = PREDEFINED_TEMPLATES;
        const all = [...builtins, ...customTemplates];
        return all.find((t) => t.id === activeId) || builtins[2]; // default A3-landscape
    }, [activeId, customTemplates]);

    // When the user picks a custom template, hydrate the title block
    // with its saved values so they don't have to retype them.
    useEffect(() => {
        if (activeTemplate && activeTemplate._isCustom && activeTemplate.titleBlock) {
            setTitleBlock(defaultTitleBlock(activeTemplate.titleBlock));
        }
    }, [activeTemplate]);

    // Render the SVG for the active template + current title block.
    const svg = useMemo(() => {
        try {
            return buildSheetTemplate({
                sheetId: activeTemplate.sheetId,
                orientation: activeTemplate.orientation,
                titleBlock,
            });
        } catch (ex) {
            setError(ex.message || String(ex));
            return '';
        }
    }, [activeTemplate, titleBlock]);

    const sheet = useMemo(
        () => sheetMm(activeTemplate.sheetId, activeTemplate.orientation),
        [activeTemplate],
    );

    // Publish to window for the e2e harness + Drawings consumer.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.__forgeDrawingTemplate = {
            id: activeTemplate.id,
            sheetId: activeTemplate.sheetId,
            orientation: activeTemplate.orientation,
            widthMm: sheet.widthMm,
            heightMm: sheet.heightMm,
            titleBlock,
            svg,
        };
    }, [activeTemplate, sheet, titleBlock, svg]);

    // Live preview — keep the bigger dimension at <= 360 px so the
    // panel stays compact for A0.
    const previewMaxPx = 360;
    const pxPerMm = previewMaxPx / Math.max(sheet.widthMm, sheet.heightMm);
    const previewWidthPx  = +(sheet.widthMm  * pxPerMm).toFixed(2);
    const previewHeightPx = +(sheet.heightMm * pxPerMm).toFixed(2);

    const updateTitleBlock = useCallback((field, value) => {
        setTitleBlock((tb) => ({ ...tb, [field]: value }));
    }, []);

    const saveSvgToDisk = useCallback(async () => {
        setSaveNote(null);
        setError(null);
        try {
            const dialog = typeof window !== 'undefined' && window.forge && window.forge.dialog;
            if (!dialog || typeof dialog.saveFile !== 'function' || typeof dialog.writeBlob !== 'function') {
                setError('window.forge.dialog.saveFile unavailable (Electron only).');
                return;
            }
            const fp = await dialog.saveFile({
                title: 'Save Drawing Template SVG',
                defaultPath: `${activeTemplate.id}-template.svg`,
                filters: [{ name: 'SVG', extensions: ['svg'] }],
            });
            if (!fp) return;
            const bytes = new TextEncoder().encode(svg);
            await dialog.writeBlob(fp, bytes);
            if (typeof window !== 'undefined') window.__forgeLastDrawingTemplatePath = fp;
            setSaveNote(`SVG saved · ${fp}`);
        } catch (ex) {
            setError(`Save failed: ${ex.message || ex}`);
        }
    }, [svg, activeTemplate]);

    const saveAsCustom = useCallback(() => {
        setSaveNote(null);
        setError(null);
        const name = (newName || titleBlock.drawing || 'custom').trim();
        if (!name) {
            setError('Name required to save custom template.');
            return;
        }
        const safe = name.toLowerCase().replace(/[^a-z0-9-]+/g, '-').slice(0, 40) || 'custom';
        const id = `custom-${safe}-${Date.now().toString(36).slice(-4)}`;
        const template = {
            id,
            label: `${name} · ${activeTemplate.sheetId} ${activeTemplate.orientation}`,
            sheetId: activeTemplate.sheetId,
            orientation: activeTemplate.orientation,
            titleBlock: { ...titleBlock },
            _isCustom: true,
        };
        const ok = saveCustomTemplate(template);
        if (!ok) {
            setError('Could not persist to localStorage.');
            return;
        }
        setCustomTemplates(loadCustomTemplates());
        setActiveId(id);
        setNewName('');
        setSaveNote(`Custom template saved · ${template.label}`);
    }, [newName, titleBlock, activeTemplate]);

    const deleteCustom = useCallback((id) => {
        setSaveNote(null);
        setError(null);
        const ok = deleteCustomTemplate(id);
        if (!ok) {
            setError('Could not delete custom template.');
            return;
        }
        const remaining = loadCustomTemplates();
        setCustomTemplates(remaining);
        if (activeId === id) setActiveId('A3-landscape');
        setSaveNote(`Custom template deleted · ${id}`);
    }, [activeId]);

    const loadIntoDrawings = useCallback(() => {
        setSaveNote(null);
        setError(null);
        if (typeof window === 'undefined') return;
        window.__forgeDrawingTemplateLoaded = {
            ...window.__forgeDrawingTemplate,
            loadedAt: Date.now(),
        };
        try {
            window.dispatchEvent(new CustomEvent('forge:drawing-template-loaded', {
                detail: window.__forgeDrawingTemplateLoaded,
            }));
        } catch {}
        setSaveNote(`Template loaded into Drawings · ${activeTemplate.id}`);
    }, [activeTemplate]);

    const builtinTemplates = PREDEFINED_TEMPLATES;

    return createPortal(
        <div data-testid="forge-drawing-templates-panel"
             style={{
                 position: 'fixed', right: 24, top: 96, width: 540, maxHeight: '88vh',
                 background: '#181a1f', color: '#dadde2', border: '1px solid #2a2d34',
                 borderRadius: 10, fontSize: 12, fontFamily: 'system-ui, sans-serif',
                 boxShadow: '0 6px 22px rgba(0,0,0,0.45)', zIndex: 953,
                 display: 'flex', flexDirection: 'column',
             }}>
            <div style={{
                padding: '8px 12px', borderBottom: '1px solid #2a2d34',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
                <div>
                    Drawing Templates{' '}
                    <span style={{ opacity: 0.55 }}>· PUSH-113 · A0..A4 + title block</span>
                </div>
                <button data-testid="forge-drawing-templates-close"
                        onClick={onClose}
                        aria-label="Close drawing templates"
                        style={{ background: 'transparent', color: '#dadde2',
                                 border: 'none', cursor: 'pointer',
                                 fontSize: 16, lineHeight: 1 }}>×</button>
            </div>

            <div style={{ padding: 10, overflowY: 'auto' }}>
                {/* Template picker */}
                <div style={{ opacity: 0.7, marginBottom: 4 }}>Sheet template</div>
                <div data-testid="forge-drawing-templates-list"
                     style={{ display: 'grid', gridTemplateColumns: '1fr 1fr',
                              gap: 4, marginBottom: 8 }}>
                    {builtinTemplates.map((t) => (
                        <button key={t.id}
                                data-testid={`forge-drawing-template-${t.id}`}
                                data-active={activeId === t.id ? 'true' : 'false'}
                                onClick={() => setActiveId(t.id)}
                                style={{
                                    background: activeId === t.id ? '#2d4a6a' : '#222632',
                                    color: '#dadde2',
                                    border: activeId === t.id
                                        ? '1px solid #3a6a8a'
                                        : '1px solid #3a3d44',
                                    borderRadius: 4,
                                    padding: '5px 8px',
                                    cursor: 'pointer',
                                    fontSize: 11,
                                    textAlign: 'left',
                                }}>
                            {t.label}
                        </button>
                    ))}
                </div>
                {customTemplates.length > 0 && (
                    <>
                        <div style={{ opacity: 0.7, marginBottom: 4, marginTop: 4 }}>
                            Custom templates ({customTemplates.length})
                        </div>
                        <div data-testid="forge-drawing-templates-custom-list"
                             style={{ display: 'flex', flexDirection: 'column',
                                      gap: 3, marginBottom: 8 }}>
                            {customTemplates.map((t) => (
                                <div key={t.id} style={{ display: 'flex', gap: 4 }}>
                                    <button data-testid={`forge-drawing-template-custom-${t.id}`}
                                            onClick={() => setActiveId(t.id)}
                                            style={{
                                                flex: 1,
                                                background: activeId === t.id ? '#2d4a6a' : '#222632',
                                                color: '#dadde2',
                                                border: activeId === t.id
                                                    ? '1px solid #3a6a8a'
                                                    : '1px solid #3a3d44',
                                                borderRadius: 4,
                                                padding: '4px 8px',
                                                cursor: 'pointer',
                                                fontSize: 11,
                                                textAlign: 'left',
                                            }}>
                                        {t.label}
                                    </button>
                                    <button data-testid={`forge-drawing-template-delete-${t.id}`}
                                            onClick={() => deleteCustom(t.id)}
                                            style={{
                                                background: '#2c1717',
                                                color: '#f4b3b3',
                                                border: '1px solid #5a2a2a',
                                                borderRadius: 4,
                                                padding: '4px 8px',
                                                cursor: 'pointer',
                                                fontSize: 11,
                                            }}>
                                        Delete
                                    </button>
                                </div>
                            ))}
                        </div>
                    </>
                )}

                {/* Active sheet info */}
                <div data-testid="forge-drawing-templates-info"
                     data-active-id={activeTemplate.id}
                     data-sheet-id={activeTemplate.sheetId}
                     data-orientation={activeTemplate.orientation}
                     data-width-mm={sheet.widthMm}
                     data-height-mm={sheet.heightMm}
                     style={{ marginBottom: 8, padding: '6px 8px',
                              background: '#10141a', border: '1px solid #2a2d34',
                              borderRadius: 4, fontFamily: 'monospace', fontSize: 11 }}>
                    Active · <b>{activeTemplate.sheetId} {activeTemplate.orientation}</b>{' '}
                    · <b>{sheet.widthMm} × {sheet.heightMm} mm</b>
                </div>

                {/* Title block editor */}
                <div style={{ opacity: 0.7, marginBottom: 4 }}>Title block fields</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr',
                              gap: 4, marginBottom: 8 }}>
                    <label style={{ gridColumn: '1 / span 2' }}>
                        <div style={{ opacity: 0.65, marginBottom: 2 }}>Project</div>
                        <input type="text"
                               data-testid="forge-drawing-template-project"
                               value={titleBlock.project}
                               onChange={(e) => updateTitleBlock('project', e.target.value)}
                               style={{ width: '100%', background: '#0e1014',
                                        color: '#dadde2', border: '1px solid #2a2d34',
                                        borderRadius: 4, padding: '3px 4px' }} />
                    </label>
                    <label style={{ gridColumn: '1 / span 2' }}>
                        <div style={{ opacity: 0.65, marginBottom: 2 }}>Drawing</div>
                        <input type="text"
                               data-testid="forge-drawing-template-drawing"
                               value={titleBlock.drawing}
                               onChange={(e) => updateTitleBlock('drawing', e.target.value)}
                               style={{ width: '100%', background: '#0e1014',
                                        color: '#dadde2', border: '1px solid #2a2d34',
                                        borderRadius: 4, padding: '3px 4px' }} />
                    </label>
                    <label>
                        <div style={{ opacity: 0.65, marginBottom: 2 }}>Drawn by</div>
                        <input type="text"
                               data-testid="forge-drawing-template-drawnby"
                               value={titleBlock.drawnBy}
                               onChange={(e) => updateTitleBlock('drawnBy', e.target.value)}
                               style={{ width: '100%', background: '#0e1014',
                                        color: '#dadde2', border: '1px solid #2a2d34',
                                        borderRadius: 4, padding: '3px 4px' }} />
                    </label>
                    <label>
                        <div style={{ opacity: 0.65, marginBottom: 2 }}>Drawn date</div>
                        <input type="text"
                               data-testid="forge-drawing-template-drawndate"
                               value={titleBlock.drawnDate}
                               onChange={(e) => updateTitleBlock('drawnDate', e.target.value)}
                               style={{ width: '100%', background: '#0e1014',
                                        color: '#dadde2', border: '1px solid #2a2d34',
                                        borderRadius: 4, padding: '3px 4px' }} />
                    </label>
                    <label>
                        <div style={{ opacity: 0.65, marginBottom: 2 }}>Checked by</div>
                        <input type="text"
                               data-testid="forge-drawing-template-checkedby"
                               value={titleBlock.checkedBy}
                               onChange={(e) => updateTitleBlock('checkedBy', e.target.value)}
                               style={{ width: '100%', background: '#0e1014',
                                        color: '#dadde2', border: '1px solid #2a2d34',
                                        borderRadius: 4, padding: '3px 4px' }} />
                    </label>
                    <label>
                        <div style={{ opacity: 0.65, marginBottom: 2 }}>Checked date</div>
                        <input type="text"
                               data-testid="forge-drawing-template-checkeddate"
                               value={titleBlock.checkedDate}
                               onChange={(e) => updateTitleBlock('checkedDate', e.target.value)}
                               style={{ width: '100%', background: '#0e1014',
                                        color: '#dadde2', border: '1px solid #2a2d34',
                                        borderRadius: 4, padding: '3px 4px' }} />
                    </label>
                    <label>
                        <div style={{ opacity: 0.65, marginBottom: 2 }}>Scale</div>
                        <select data-testid="forge-drawing-template-scale"
                                value={titleBlock.scale}
                                onChange={(e) => updateTitleBlock('scale', e.target.value)}
                                style={{ width: '100%', background: '#0e1014',
                                         color: '#dadde2', border: '1px solid #2a2d34',
                                         borderRadius: 4, padding: '3px 4px' }}>
                            {SCALE_OPTIONS.map((s) => (
                                <option key={s} value={s}>{s}</option>
                            ))}
                        </select>
                    </label>
                    <label>
                        <div style={{ opacity: 0.65, marginBottom: 2 }}>Revision</div>
                        <input type="text"
                               data-testid="forge-drawing-template-revision"
                               value={titleBlock.revision}
                               onChange={(e) => updateTitleBlock('revision', e.target.value)}
                               style={{ width: '100%', background: '#0e1014',
                                        color: '#dadde2', border: '1px solid #2a2d34',
                                        borderRadius: 4, padding: '3px 4px' }} />
                    </label>
                </div>

                {/* Live SVG preview */}
                <div style={{ opacity: 0.7, marginBottom: 4 }}>Live preview</div>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                    <div data-testid="forge-drawing-template-svg-container"
                         data-svg-length={svg.length}
                         style={{ width: previewWidthPx, height: previewHeightPx,
                                  border: '1px solid #3a3d44', background: '#ffffff',
                                  boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}
                         dangerouslySetInnerHTML={{ __html: svg }} />
                </div>

                {/* Custom save form */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                    <input type="text"
                           data-testid="forge-drawing-template-name"
                           placeholder="Name for custom template…"
                           value={newName}
                           onChange={(e) => setNewName(e.target.value)}
                           style={{ flex: 1, background: '#0e1014',
                                    color: '#dadde2', border: '1px solid #2a2d34',
                                    borderRadius: 4, padding: '4px 6px',
                                    fontSize: 11 }} />
                    <button data-testid="forge-drawing-template-save-custom"
                            onClick={saveAsCustom}
                            style={{ background: '#222632',
                                     color: '#dadde2', border: '1px solid #3a3d44',
                                     borderRadius: 4, padding: '4px 8px',
                                     cursor: 'pointer', fontSize: 11 }}>
                        Save as custom…
                    </button>
                </div>

                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button data-testid="forge-drawing-template-save-svg"
                            onClick={saveSvgToDisk}
                            style={{ flex: 1, background: '#222632',
                                     color: '#dadde2', border: '1px solid #3a3d44',
                                     borderRadius: 4, padding: '5px 8px',
                                     cursor: 'pointer', fontSize: 12 }}>
                        Save SVG…
                    </button>
                    <button data-testid="forge-drawing-template-load-drawings"
                            onClick={loadIntoDrawings}
                            style={{ flex: 1, background: '#2d4a6a',
                                     color: '#ffffff', border: '1px solid #3a6a8a',
                                     borderRadius: 4, padding: '5px 8px',
                                     cursor: 'pointer', fontSize: 12 }}>
                        Load into Drawings
                    </button>
                </div>

                {saveNote && (
                    <div data-testid="forge-drawing-template-note"
                         style={{ marginTop: 8, padding: '6px 8px',
                                  background: '#1f2937', border: '1px solid #2a3a52',
                                  borderRadius: 4, color: '#a8c8f0', fontSize: 11 }}>
                        {saveNote}
                    </div>
                )}
                {error && (
                    <div data-testid="forge-drawing-template-error"
                         style={{ marginTop: 8, padding: '6px 8px',
                                  background: '#2c1717', border: '1px solid #5a2a2a',
                                  borderRadius: 4, color: '#f4b3b3', fontSize: 11 }}>
                        {error}
                    </div>
                )}
            </div>
        </div>,
        document.body,
    );
}

export function DrawingTemplatesPanelHost() {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__forgeOpenDrawingTemplates = () => setOpen(true);
        window.__forgeCloseDrawingTemplates = () => setOpen(false);
        // Pure helpers + builders surfaced to the e2e harness + any
        // downstream caller (e.g. a future kernel-side AP242 sheet
        // emitter) so the SVG template can be produced without mounting
        // the panel.
        window.__forgeDrawingTemplatesHelper = {
            PREDEFINED_TEMPLATES,
            SCALE_OPTIONS,
            ISO_SHEETS,
            ORIENTATIONS,
            LOCALSTORAGE_KEY,
            sheetMm, defaultTitleBlock,
            buildSheetTemplate,
            buildA0Template, buildA1Template, buildA2Template,
            buildA3Template, buildA4Template,
            loadCustomTemplates, saveCustomTemplate, deleteCustomTemplate,
        };
        return () => {
            delete window.__forgeOpenDrawingTemplates;
            delete window.__forgeCloseDrawingTemplates;
            delete window.__forgeDrawingTemplatesHelper;
        };
    }, []);
    if (!open) return null;
    return <DrawingTemplatesPanel onClose={() => setOpen(false)} />;
}

export default DrawingTemplatesPanelHost;
