// PUSH-110 (Slice-79 / Drawing Print/PDF preview panel).
//
// PUSH-55 (Slice-24b) wired Drawings-HLR → Save DXF…, but a DXF on disk
// is only one half of a drawing deliverable. Production-floor practice
// is: print the HLR projection onto a fixed paper size + scale, give it
// a title block, and PDF it for the shop. Up to now Forge has no print
// preview at all — file.exportPdf in ForgeShellV4 just shows a toast
// pointing at the legacy DrawingsWorkbench (which renders no real
// drawing). PUSH-110 ships the first-class Print Preview panel.
//
// What the panel does:
//
//   * Paper size dropdown — ISO A0..A4 + ANSI Letter / Legal / Tabloid,
//     each with its real mm dimensions. The mm values are authoritative
//     (the preview rectangle scales from them, and any downstream PDF
//     writer would respect them).
//   * Orientation toggle — Portrait / Landscape. Landscape swaps the
//     paper dimensions before scaling so the preview rectangle reflects
//     the physical sheet you'd get out of a plotter.
//   * Scale dropdown — 1:1 / 1:2 / 1:5 / 1:10 / 1:20. The scale is the
//     ratio between model mm and paper mm; the preview SVG content is
//     drawn at preview-px / world-mm so picking a coarser scale shrinks
//     the projected drawing inside the same sheet.
//   * Live SVG preview — picks up the current HLR view2D from
//     window.__forgeDrawingsHLRView (published by DrawingsHLRWorkbench
//     on every projectView / projectSection); if there's no live view
//     it falls back to a sample 80×40 rectangle + diagonals so the
//     preview is never blank.
//   * Title block — drawn into the SVG preview at the bottom right
//     with part name, sheet size, scale, orientation, date.
//   * "Save SVG…" — runs the existing forge.dialog.saveFile +
//     writeBlob pipeline (same one Save DXF… uses) to drop the rendered
//     SVG on disk. The bytes are real W3C SVG so any browser, Inkscape,
//     or print pipeline can ingest them.
//   * "Copy SVG to clipboard" — writes the same SVG string into
//     navigator.clipboard.writeText so the user can paste it into
//     another tool without going through the file system.
//   * "Print to PDF" — opens window.__forgePrintPreviewWindow with the
//     SVG embedded in a printable HTML doc and calls window.print(),
//     which honours the paper @page CSS sizing.
//
// Pure React, pure JS — no new npm / C++ / external deps.
// Manual UI only — never posts to Archie, never opens the dock.

import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';

// Authoritative paper-size table in mm.
//   ISO 216 — A0 down to A4
//   ANSI/ASME Y14.1 — Letter, Legal, Tabloid
// Width / height are the portrait orientation; landscape swaps them.
export const PAPER_SIZES = [
    { id: 'A0',      label: 'A0 (841 × 1189 mm)',  width: 841,   height: 1189, family: 'ISO'  },
    { id: 'A1',      label: 'A1 (594 × 841 mm)',   width: 594,   height: 841,  family: 'ISO'  },
    { id: 'A2',      label: 'A2 (420 × 594 mm)',   width: 420,   height: 594,  family: 'ISO'  },
    { id: 'A3',      label: 'A3 (297 × 420 mm)',   width: 297,   height: 420,  family: 'ISO'  },
    { id: 'A4',      label: 'A4 (210 × 297 mm)',   width: 210,   height: 297,  family: 'ISO'  },
    { id: 'Letter',  label: 'Letter (216 × 279 mm)', width: 215.9, height: 279.4, family: 'ANSI' },
    { id: 'Legal',   label: 'Legal (216 × 356 mm)',  width: 215.9, height: 355.6, family: 'ANSI' },
    { id: 'Tabloid', label: 'Tabloid (279 × 432 mm)', width: 279.4, height: 431.8, family: 'ANSI' },
];

export const SCALE_OPTIONS = [
    { id: '1:1',  label: '1 : 1',  ratio: 1     },
    { id: '1:2',  label: '1 : 2',  ratio: 0.5   },
    { id: '1:5',  label: '1 : 5',  ratio: 0.2   },
    { id: '1:10', label: '1 : 10', ratio: 0.1   },
    { id: '1:20', label: '1 : 20', ratio: 0.05  },
];

export const ORIENTATIONS = [
    { id: 'portrait',  label: 'Portrait'  },
    { id: 'landscape', label: 'Landscape' },
];

// Resolve the (width, height) of a sheet in mm given a paper id + orientation.
//   Landscape swaps portrait W × H.
//   Returns numbers rounded to 0.01 mm precision so callers can assert
//   against canonical values (e.g. A4 landscape = 297 × 210 mm).
export function paperMm(paperId, orientation) {
    const spec = PAPER_SIZES.find((p) => p.id === paperId) || PAPER_SIZES[4];
    const w = spec.width;
    const h = spec.height;
    if (orientation === 'landscape') {
        return { widthMm: +Math.max(w, h).toFixed(2),
                 heightMm: +Math.min(w, h).toFixed(2),
                 family: spec.family };
    }
    return { widthMm: +Math.min(w, h).toFixed(2),
             heightMm: +Math.max(w, h).toFixed(2),
             family: spec.family };
}

export function scaleRatio(scaleId) {
    const s = SCALE_OPTIONS.find((x) => x.id === scaleId);
    return s ? s.ratio : 1;
}

// View2D bbox semantics (matches DrawingsHLRWorkbench): {minX, minY, maxX, maxY}.
// Sample fallback view drawn when there's no live HLR projection — a
// 100×60 rectangle with diagonals so the preview is never blank.
const SAMPLE_VIEW = {
    visibleEdges: [
        // outer rectangle 0..100 × 0..60
        [{ x: 0,   y: 0   }, { x: 100, y: 0   }],
        [{ x: 100, y: 0   }, { x: 100, y: 60  }],
        [{ x: 100, y: 60  }, { x: 0,   y: 60  }],
        [{ x: 0,   y: 60  }, { x: 0,   y: 0   }],
        // diagonals
        [{ x: 0,   y: 0   }, { x: 100, y: 60  }],
        [{ x: 0,   y: 60  }, { x: 100, y: 0   }],
    ],
    hiddenEdges: [],
    bbox: { minX: 0, minY: 0, maxX: 100, maxY: 60 },
};

// Build a printable SVG string at the requested paper size + scale.
//   widthMm × heightMm — physical sheet (in mm).
//   ratio          — model-mm-per-paper-mm (so the projected drawing
//                    occupies world/ratio mm of paper).
//   margin         — paper-mm reserved around the projected drawing.
//   view2D         — { visibleEdges, hiddenEdges, bbox } from HLR.
//   meta           — { partName, sheetId, scaleLabel, orientationLabel, date }.
//
// The drawing is centred within (margin .. width-margin) horizontally
// and (margin .. height-margin-titleBlockHeight) vertically. A title
// block is drawn at the bottom-right with the supplied meta. The SVG
// is W3C-conformant with mm units (width="297mm" height="210mm"), so
// any browser print pipeline maps 1 mm of SVG to 1 mm of paper.
export function buildPrintSvg({
    widthMm, heightMm, ratio,
    view2D = SAMPLE_VIEW,
    margin = 10,
    titleBlockMm = { w: 80, h: 28 },
    meta = {},
} = {}) {
    if (!Number.isFinite(widthMm) || widthMm <= 0)
        throw new Error('buildPrintSvg: widthMm must be > 0');
    if (!Number.isFinite(heightMm) || heightMm <= 0)
        throw new Error('buildPrintSvg: heightMm must be > 0');
    if (!Number.isFinite(ratio) || ratio <= 0)
        throw new Error('buildPrintSvg: ratio must be > 0');

    const v = view2D || SAMPLE_VIEW;
    const visible = Array.isArray(v.visibleEdges) ? v.visibleEdges : [];
    const hidden  = Array.isArray(v.hiddenEdges)  ? v.hiddenEdges  : [];
    let bb = v.bbox || null;
    if (!bb) {
        // Recompute bbox if missing — accept either polyline-of-points
        // or 2-point segment shapes (DrawingsHLR emits both at times).
        let minX = +Infinity, minY = +Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const pl of visible.concat(hidden)) {
            for (const pt of pl) {
                if (pt && Number.isFinite(pt.x) && Number.isFinite(pt.y)) {
                    if (pt.x < minX) minX = pt.x;
                    if (pt.y < minY) minY = pt.y;
                    if (pt.x > maxX) maxX = pt.x;
                    if (pt.y > maxY) maxY = pt.y;
                }
            }
        }
        if (!Number.isFinite(minX)) {
            bb = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
        } else {
            bb = { minX, minY, maxX, maxY };
        }
    }
    const worldW = Math.max(1e-6, bb.maxX - bb.minX);
    const worldH = Math.max(1e-6, bb.maxY - bb.minY);

    // Paper-mm window the drawing has to fit inside, accounting for
    // title-block clearance at the bottom-right.
    const usableW = Math.max(20, widthMm - 2 * margin);
    const usableH = Math.max(20, heightMm - 2 * margin - titleBlockMm.h - 4);

    // Drawing in paper-mm = world-mm × ratio.
    const drawW = worldW * ratio;
    const drawH = worldH * ratio;

    // If drawing is bigger than usable area at requested ratio, we still
    // render at requested ratio — overflow gets clipped by SVG viewport,
    // which is the correct production-floor behaviour (the user will see
    // the overflow and pick a coarser scale). Centred when it fits.
    const ox = margin + Math.max(0, (usableW - drawW) / 2);
    const oy = margin + Math.max(0, (usableH - drawH) / 2);

    // Project (mx, my) world-mm → (px, py) paper-mm. Drawing y points
    // up in world coords (HLR convention) and down in SVG. Flip y.
    const project = (mx, my) => {
        const px = ox + (mx - bb.minX) * ratio;
        const py = oy + (drawH - (my - bb.minY) * ratio);
        return `${px.toFixed(3)},${py.toFixed(3)}`;
    };

    const polylineToPath = (pl) => {
        if (!pl || pl.length < 2) return null;
        const head = project(pl[0].x, pl[0].y);
        const tail = pl.slice(1).map((p) => 'L' + project(p.x, p.y)).join(' ');
        return `M${head} ${tail}`;
    };

    const visiblePaths = visible.map(polylineToPath).filter(Boolean);
    const hiddenPaths  = hidden.map(polylineToPath).filter(Boolean);

    // Title block at bottom-right: meta block.
    const tbX = widthMm - margin - titleBlockMm.w;
    const tbY = heightMm - margin - titleBlockMm.h;
    const tb = {
        x: tbX, y: tbY, w: titleBlockMm.w, h: titleBlockMm.h,
    };
    const tbRows = [
        [`Part`,  meta.partName        || 'untitled'],
        [`Sheet`, meta.sheetId         || 'A4 portrait'],
        [`Scale`, meta.scaleLabel      || '1 : 1'],
        [`Orient`, meta.orientationLabel || 'portrait'],
        [`Date`,  meta.date            || new Date().toISOString().slice(0, 10)],
    ];

    // Build the SVG. Use mm units for both <svg> width/height and the
    // viewBox so 1 SVG unit = 1 mm and downstream PDF writers / browser
    // print pipelines map 1:1 onto the paper sheet.
    const out = [];
    out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    out.push(`<svg xmlns="http://www.w3.org/2000/svg"`);
    out.push(`     width="${widthMm}mm" height="${heightMm}mm"`);
    out.push(`     viewBox="0 0 ${widthMm} ${heightMm}">`);
    // Sheet outline (paper border).
    out.push(`  <rect x="0" y="0" width="${widthMm}" height="${heightMm}" fill="#ffffff" stroke="none"/>`);
    out.push(`  <rect x="${margin}" y="${margin}"`);
    out.push(`        width="${(widthMm - 2 * margin).toFixed(3)}"`);
    out.push(`        height="${(heightMm - 2 * margin).toFixed(3)}"`);
    out.push(`        fill="none" stroke="#a8a8a8" stroke-width="0.4"/>`);
    // Visible edges (solid black).
    out.push(`  <g data-layer="visible" fill="none" stroke="#000000" stroke-width="0.4" stroke-linecap="round" stroke-linejoin="round">`);
    for (const p of visiblePaths) out.push(`    <path d="${p}"/>`);
    out.push(`  </g>`);
    // Hidden edges (dashed grey).
    out.push(`  <g data-layer="hidden" fill="none" stroke="#7a7a7a" stroke-width="0.25" stroke-dasharray="2 1.2" stroke-linecap="round" stroke-linejoin="round">`);
    for (const p of hiddenPaths) out.push(`    <path d="${p}"/>`);
    out.push(`  </g>`);
    // Title block frame + rows.
    out.push(`  <g data-layer="titleblock" font-family="Helvetica,Arial,sans-serif" font-size="3.2" fill="#000000">`);
    out.push(`    <rect x="${tb.x.toFixed(3)}" y="${tb.y.toFixed(3)}" width="${tb.w.toFixed(3)}" height="${tb.h.toFixed(3)}" fill="none" stroke="#000000" stroke-width="0.4"/>`);
    const rowH = tb.h / tbRows.length;
    for (let i = 0; i < tbRows.length; i++) {
        const [k, val] = tbRows[i];
        const ry = tb.y + (i + 1) * rowH;
        out.push(`    <line x1="${tb.x.toFixed(3)}" y1="${ry.toFixed(3)}" x2="${(tb.x + tb.w).toFixed(3)}" y2="${ry.toFixed(3)}" stroke="#000000" stroke-width="0.2"/>`);
        const ty = tb.y + (i + 0.7) * rowH;
        out.push(`    <text x="${(tb.x + 2).toFixed(3)}" y="${ty.toFixed(3)}">${escapeXml(k)}</text>`);
        out.push(`    <text x="${(tb.x + 18).toFixed(3)}" y="${ty.toFixed(3)}">${escapeXml(String(val))}</text>`);
    }
    out.push(`  </g>`);
    out.push(`</svg>`);
    return out.join('\n');
}

function escapeXml(s) {
    return String(s).replace(/[<>&"']/g, (c) => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
    }[c]));
}

// Build a printable HTML page wrapping the SVG so the system print
// dialog (Cmd+P / window.print()) produces a PDF at the right paper
// size. The @page CSS rule pins the physical sheet dimensions; the
// embedded SVG is already mm-correct so it renders at 1:1 on paper.
export function buildPrintableHtml({ svg, widthMm, heightMm, title = 'Forge Print Preview' }) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>${escapeXml(title)}</title>
<style>
@page { size: ${widthMm}mm ${heightMm}mm; margin: 0; }
html, body { margin: 0; padding: 0; background: #ffffff; }
.sheet { width: ${widthMm}mm; height: ${heightMm}mm; display: block; }
svg { width: 100%; height: 100%; display: block; }
</style>
</head>
<body>
<div class="sheet">${svg}</div>
<script>
// Auto-fire the print dialog after the SVG paints. Use setTimeout to
// give the layout a tick so width/height resolve in mm.
window.addEventListener('load', () => { setTimeout(() => { try { window.print(); } catch (e) {} }, 300); });
</script>
</body>
</html>`;
}

export function PrintPreviewPanel({ onClose }) {
    const [paperId, setPaperId] = useState('A4');
    const [orientation, setOrientation] = useState('portrait');
    const [scaleId, setScaleId] = useState('1:1');
    const [view2D, setView2D] = useState(() =>
        (typeof window !== 'undefined' && window.__forgeDrawingsHLRView) || SAMPLE_VIEW);
    const [partName, setPartName] = useState(() => {
        if (typeof window === 'undefined') return 'untitled';
        const bodies = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
        return bodies[0]?.name || bodies[0]?.id || 'untitled';
    });
    const [saveNote, setSaveNote] = useState(null);
    const [error, setError] = useState(null);
    const previewRef = useRef(null);

    // Pick up live HLR view when DrawingsHLR re-projects.
    useEffect(() => {
        const onChange = () => {
            if (typeof window !== 'undefined' && window.__forgeDrawingsHLRView) {
                setView2D(window.__forgeDrawingsHLRView);
            }
        };
        if (typeof window !== 'undefined') {
            window.addEventListener('forge:drawings-hlr-view', onChange);
            window.addEventListener('forge:drawings-projected', onChange);
        }
        return () => {
            if (typeof window !== 'undefined') {
                window.removeEventListener('forge:drawings-hlr-view', onChange);
                window.removeEventListener('forge:drawings-projected', onChange);
            }
        };
    }, []);

    const paper = useMemo(() => paperMm(paperId, orientation), [paperId, orientation]);
    const ratio = useMemo(() => scaleRatio(scaleId), [scaleId]);
    const scaleLabel = useMemo(() => {
        const s = SCALE_OPTIONS.find((x) => x.id === scaleId);
        return s ? s.label : '1 : 1';
    }, [scaleId]);

    const svg = useMemo(() => {
        try {
            return buildPrintSvg({
                widthMm: paper.widthMm,
                heightMm: paper.heightMm,
                ratio,
                view2D,
                meta: {
                    partName,
                    sheetId: `${paperId} ${orientation}`,
                    scaleLabel,
                    orientationLabel: orientation,
                    date: new Date().toISOString().slice(0, 10),
                },
            });
        } catch (ex) {
            setError(ex.message || String(ex));
            return '';
        }
    }, [paper, ratio, view2D, paperId, orientation, scaleLabel, partName]);

    // Publish results on window so the e2e harness can grab them.
    useEffect(() => {
        if (typeof window === 'undefined') return;
        window.__forgePrintPreview = {
            paperId, orientation, scaleId,
            widthMm: paper.widthMm, heightMm: paper.heightMm,
            ratio, svg,
            partName,
        };
    }, [paperId, orientation, scaleId, paper, ratio, svg, partName]);

    const saveSvg = useCallback(async () => {
        setSaveNote(null);
        setError(null);
        try {
            const dialog = typeof window !== 'undefined' && window.forge && window.forge.dialog;
            if (!dialog || typeof dialog.saveFile !== 'function' || typeof dialog.writeBlob !== 'function') {
                setError('window.forge.dialog.saveFile unavailable (Electron only).');
                return;
            }
            const fp = await dialog.saveFile({
                title: 'Save Print Preview SVG',
                defaultPath: `${partName}.${paperId}.${orientation}.svg`,
                filters: [{ name: 'SVG', extensions: ['svg'] }],
            });
            if (!fp) return;
            const bytes = new TextEncoder().encode(svg);
            await dialog.writeBlob(fp, bytes);
            if (typeof window !== 'undefined') window.__forgeLastPrintSvgPath = fp;
            setSaveNote(`SVG saved · ${fp}`);
        } catch (ex) {
            setError(`Save failed: ${ex.message || ex}`);
        }
    }, [svg, paperId, orientation, partName]);

    const copySvg = useCallback(async () => {
        setSaveNote(null);
        setError(null);
        try {
            if (typeof navigator === 'undefined' || !navigator.clipboard) {
                setError('navigator.clipboard unavailable.');
                return;
            }
            await navigator.clipboard.writeText(svg);
            setSaveNote(`SVG copied to clipboard · ${svg.length} chars`);
        } catch (ex) {
            setError(`Clipboard failed: ${ex.message || ex}`);
        }
    }, [svg]);

    const printToPdf = useCallback(() => {
        setSaveNote(null);
        setError(null);
        try {
            const html = buildPrintableHtml({
                svg,
                widthMm: paper.widthMm,
                heightMm: paper.heightMm,
                title: `${partName} — ${paperId} ${orientation}`,
            });
            if (typeof window === 'undefined') return;
            // Open a fresh window and pipe the printable HTML in. The
            // embedded <script> calls window.print() after load, which
            // lands the OS print → Save as PDF flow.
            const w = window.open('', '_blank', 'width=900,height=900');
            if (!w) {
                setError('Print window blocked — pop-up handler missing.');
                return;
            }
            w.document.open();
            w.document.write(html);
            w.document.close();
            if (typeof window !== 'undefined') window.__forgePrintPreviewWindow = w;
            setSaveNote('Print dialog opened in new window.');
        } catch (ex) {
            setError(`Print failed: ${ex.message || ex}`);
        }
    }, [svg, paper, paperId, orientation, partName]);

    // Preview rectangle width — 360 px max so the panel stays compact.
    const previewMaxPx = 360;
    const pxPerMm = previewMaxPx / Math.max(paper.widthMm, paper.heightMm);
    const previewWidthPx  = +(paper.widthMm  * pxPerMm).toFixed(2);
    const previewHeightPx = +(paper.heightMm * pxPerMm).toFixed(2);

    return createPortal(
        <div data-testid="forge-print-preview-panel"
             style={{
                 position: 'fixed', right: 24, top: 96, width: 460, maxHeight: '86vh',
                 background: '#181a1f', color: '#dadde2', border: '1px solid #2a2d34',
                 borderRadius: 10, fontSize: 12, fontFamily: 'system-ui, sans-serif',
                 boxShadow: '0 6px 22px rgba(0,0,0,0.45)', zIndex: 952,
                 display: 'flex', flexDirection: 'column',
             }}>
            <div style={{
                padding: '8px 12px', borderBottom: '1px solid #2a2d34',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            }}>
                <div>
                    Print Preview{' '}
                    <span style={{ opacity: 0.55 }}>· PUSH-110 · printToPDF</span>
                </div>
                <button data-testid="forge-print-preview-close"
                        onClick={onClose}
                        aria-label="Close print preview"
                        style={{ background: 'transparent', color: '#dadde2',
                                 border: 'none', cursor: 'pointer',
                                 fontSize: 16, lineHeight: 1 }}>×</button>
            </div>

            <div style={{ padding: 10, overflowY: 'auto' }}>
                <div style={{ opacity: 0.7, marginBottom: 6 }}>
                    Live HLR view: {view2D && view2D !== SAMPLE_VIEW ? 'active' : 'sample fallback'}
                    {' · '}
                    visible edges: {(view2D && Array.isArray(view2D.visibleEdges)) ? view2D.visibleEdges.length : 0}
                </div>

                <label style={{ display: 'block', marginBottom: 6 }}>
                    <div style={{ opacity: 0.7, marginBottom: 2 }}>Paper size</div>
                    <select data-testid="forge-print-preview-paper"
                            value={paperId}
                            onChange={(e) => setPaperId(e.target.value)}
                            style={{ width: '100%', background: '#0e1014',
                                     color: '#dadde2', border: '1px solid #2a2d34',
                                     borderRadius: 4, padding: '3px 4px' }}>
                        {PAPER_SIZES.map((p) => (
                            <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                    </select>
                </label>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <label>
                        <div style={{ opacity: 0.7, marginBottom: 2 }}>Orientation</div>
                        <select data-testid="forge-print-preview-orientation"
                                value={orientation}
                                onChange={(e) => setOrientation(e.target.value)}
                                style={{ width: '100%', background: '#0e1014',
                                         color: '#dadde2', border: '1px solid #2a2d34',
                                         borderRadius: 4, padding: '3px 4px' }}>
                            {ORIENTATIONS.map((o) => (
                                <option key={o.id} value={o.id}>{o.label}</option>
                            ))}
                        </select>
                    </label>
                    <label>
                        <div style={{ opacity: 0.7, marginBottom: 2 }}>Scale</div>
                        <select data-testid="forge-print-preview-scale"
                                value={scaleId}
                                onChange={(e) => setScaleId(e.target.value)}
                                style={{ width: '100%', background: '#0e1014',
                                         color: '#dadde2', border: '1px solid #2a2d34',
                                         borderRadius: 4, padding: '3px 4px' }}>
                            {SCALE_OPTIONS.map((s) => (
                                <option key={s.id} value={s.id}>{s.label}</option>
                            ))}
                        </select>
                    </label>
                </div>

                <label style={{ display: 'block', marginTop: 6 }}>
                    <div style={{ opacity: 0.7, marginBottom: 2 }}>Part name (title block)</div>
                    <input type="text"
                           data-testid="forge-print-preview-partname"
                           value={partName}
                           onChange={(e) => setPartName(e.target.value)}
                           style={{ width: '100%', background: '#0e1014',
                                    color: '#dadde2', border: '1px solid #2a2d34',
                                    borderRadius: 4, padding: '3px 4px' }} />
                </label>

                <div data-testid="forge-print-preview-dimensions"
                     data-width-mm={paper.widthMm}
                     data-height-mm={paper.heightMm}
                     data-ratio={ratio}
                     style={{ marginTop: 8, padding: '6px 8px',
                              background: '#10141a', border: '1px solid #2a2d34',
                              borderRadius: 4, fontFamily: 'monospace', fontSize: 11 }}>
                    Sheet · <b>{paper.widthMm} × {paper.heightMm} mm</b>{' '}
                    · ratio <b>{ratio}</b>{' '}
                    · family <b>{paper.family}</b>
                </div>

                <div style={{ marginTop: 10, display: 'flex', justifyContent: 'center' }}>
                    <div data-testid="forge-print-preview-svg-container"
                         ref={previewRef}
                         style={{ width: previewWidthPx, height: previewHeightPx,
                                  border: '1px solid #3a3d44', background: '#ffffff',
                                  boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }}
                         dangerouslySetInnerHTML={{ __html: svg }} />
                </div>

                <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button data-testid="forge-print-preview-save-svg"
                            onClick={saveSvg}
                            style={{ flex: 1, background: '#222632',
                                     color: '#dadde2', border: '1px solid #3a3d44',
                                     borderRadius: 4, padding: '5px 8px',
                                     cursor: 'pointer', fontSize: 12 }}>
                        Save SVG…
                    </button>
                    <button data-testid="forge-print-preview-copy-svg"
                            onClick={copySvg}
                            style={{ flex: 1, background: '#222632',
                                     color: '#dadde2', border: '1px solid #3a3d44',
                                     borderRadius: 4, padding: '5px 8px',
                                     cursor: 'pointer', fontSize: 12 }}>
                        Copy SVG
                    </button>
                    <button data-testid="forge-print-preview-print-pdf"
                            onClick={printToPdf}
                            style={{ flex: 1, background: '#2d4a6a',
                                     color: '#ffffff', border: '1px solid #3a6a8a',
                                     borderRadius: 4, padding: '5px 8px',
                                     cursor: 'pointer', fontSize: 12 }}>
                        Print to PDF…
                    </button>
                </div>

                {saveNote && (
                    <div data-testid="forge-print-preview-note"
                         style={{ marginTop: 8, padding: '6px 8px',
                                  background: '#1f2937', border: '1px solid #2a3a52',
                                  borderRadius: 4, color: '#a8c8f0', fontSize: 11 }}>
                        {saveNote}
                    </div>
                )}
                {error && (
                    <div data-testid="forge-print-preview-error"
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

export function PrintPreviewPanelHost() {
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (typeof window === 'undefined') return undefined;
        window.__forgeOpenPrintPreview = () => setOpen(true);
        window.__forgeClosePrintPreview = () => setOpen(false);
        // Expose pure helpers so the e2e + downstream callers (e.g. a
        // future kernel-side AP242 emitter) can build a print SVG
        // without mounting the panel.
        window.__forgePrintPreviewHelper = {
            PAPER_SIZES, SCALE_OPTIONS, ORIENTATIONS,
            paperMm, scaleRatio, buildPrintSvg, buildPrintableHtml,
        };
        return () => {
            delete window.__forgeOpenPrintPreview;
            delete window.__forgeClosePrintPreview;
            delete window.__forgePrintPreviewHelper;
        };
    }, []);
    if (!open) return null;
    return <PrintPreviewPanel onClose={() => setOpen(false)} />;
}

export default PrintPreviewPanelHost;
