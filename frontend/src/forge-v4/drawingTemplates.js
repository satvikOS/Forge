// PUSH-113 (Slice-82) — Drawing Template Builders.
//
// PUSH-110 (Slice-79) shipped the Print Preview panel that renders a
// live HLR view2D onto an ISO/ANSI paper sheet with a tiny title block.
// That was enough to ship "a sheet for the shop", but a real production
// drawing carries a lot more than a five-row meta block: a properly
// proportioned engineering title block with revision history table, a
// BOM placeholder, sheet-corner labels, border frames with margin
// fiducials, etc.
//
// PUSH-113 lifts that wholesale into reusable template builders. Each
// builder returns a complete W3C-conformant SVG string sized to a real
// ISO paper (A0 / A1 / A2 / A3 / A4 in portrait or landscape) with:
//
//   * Outer + inner border frames with 10 mm margin.
//   * Lower-right engineering title block:
//       - Project name
//       - Drawing name
//       - Drawn by + date
//       - Checked by + date
//       - Sheet identifier (A4 portrait etc.)
//       - Scale (1:1, 1:2, 1:5, 1:10, 1:20, 1:50, 1:100)
//       - Revision letter (A..Z)
//   * Above the title block: revision history table — 4 rows
//     (Rev / Date / By / Description) so the QA stamp matches the
//     production-floor expectation.
//   * Above the revision table: a 4-row × 5-col BOM placeholder so the
//     drafter has a parking spot for the parts list before the kernel
//     wires up the BOM-Balloon Auto-Place output (PUSH-93).
//   * The remaining clear paper area is the drawing canvas — the area
//     where a downstream HLR projection (PUSH-110) or sketch (PUSH-50)
//     would land. We mark it with a dashed faint outline and the label
//     "Drawing Area" so the user can see exactly where the drawing
//     will land before they load a view2D into the template.
//
// No new npm / C++ / external deps — pure JS string-building, mm units
// throughout, helpers exported so the panel + the e2e harness can both
// build templates without mounting the React panel.
//
// All five sheet sizes (A0 / A1 / A2 / A3 / A4) reuse the same SVG
// builder. The only thing that changes between them is the mm
// dimensions + the title block / revision table proportions, which we
// scale gently so A0 doesn't get a thumbnail title block in a 1189 mm
// sheet.
//
// Canonical ISO 216 mm dimensions in portrait orientation:
//   A0 = 841  × 1189
//   A1 = 594  × 841
//   A2 = 420  × 594
//   A3 = 297  × 420
//   A4 = 210  × 297
//
// `orientation` swaps width × height for landscape.

export const ISO_SHEETS = [
    { id: 'A0', width: 841, height: 1189 },
    { id: 'A1', width: 594, height: 841  },
    { id: 'A2', width: 420, height: 594  },
    { id: 'A3', width: 297, height: 420  },
    { id: 'A4', width: 210, height: 297  },
];

export const SCALE_OPTIONS = [
    '1:1', '1:2', '1:5', '1:10', '1:20', '1:50', '1:100',
];

export const ORIENTATIONS = ['portrait', 'landscape'];

// Resolve the mm dimensions of a sheet given an id + orientation.
// Portrait = upright (W < H). Landscape swaps so W > H.
export function sheetMm(sheetId, orientation = 'portrait') {
    const spec = ISO_SHEETS.find((s) => s.id === sheetId);
    if (!spec) throw new Error(`sheetMm: unknown sheet ${sheetId}`);
    const small = Math.min(spec.width, spec.height);
    const large = Math.max(spec.width, spec.height);
    return orientation === 'landscape'
        ? { widthMm: large, heightMm: small }
        : { widthMm: small, heightMm: large };
}

// Canonical title-block defaults. Empty strings mean "leave the row
// blank for the drafter to hand-letter on paper". The panel writes user
// values back into this shape before passing it to the builder.
export function defaultTitleBlock(overrides = {}) {
    return {
        project:   overrides.project   || 'Untitled Project',
        drawing:   overrides.drawing   || 'Untitled Drawing',
        drawnBy:   overrides.drawnBy   || '',
        drawnDate: overrides.drawnDate || new Date().toISOString().slice(0, 10),
        checkedBy:  overrides.checkedBy  || '',
        checkedDate: overrides.checkedDate || '',
        scale:     overrides.scale     || '1:1',
        revision:  overrides.revision  || 'A',
    };
}

function escapeXml(s) {
    return String(s == null ? '' : s).replace(/[<>&"']/g, (c) => ({
        '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
    }[c]));
}

// Compute the title-block / revision-table / BOM-table mm geometry for
// a given sheet. Title block lives in the lower-right; we scale its
// width with the sheet size so it stays legible on A0 without being
// too big to fit on A4.
//
//   A4 → title block 90 × 40
//   A3 → 110 × 46
//   A2 → 130 × 52
//   A1 → 160 × 60
//   A0 → 200 × 72
//
// Revision table sits on top of the title block, 25 mm tall by default.
// BOM table sits on top of the revision table.
function titleBlockGeometry(widthMm) {
    if (widthMm >= 1100) return { tbW: 200, tbH: 72, revH: 36, bomH: 56 };  // A0 landscape
    if (widthMm >= 800)  return { tbW: 200, tbH: 72, revH: 32, bomH: 48 };  // A0 / A1 landscape
    if (widthMm >= 550)  return { tbW: 160, tbH: 60, revH: 28, bomH: 40 };  // A1 / A2 landscape
    if (widthMm >= 400)  return { tbW: 130, tbH: 52, revH: 24, bomH: 36 };  // A2 / A3 landscape
    if (widthMm >= 280)  return { tbW: 110, tbH: 46, revH: 22, bomH: 32 };  // A3 / A4 landscape
    return { tbW: 90, tbH: 40, revH: 20, bomH: 28 };                         // A4 portrait
}

// Build a template SVG for a (sheetId, orientation, titleBlock) tuple.
// The returned string is a complete W3C SVG document (XML decl + svg
// root with mm units + viewBox = mm), ready to drop on disk via
// forge.dialog.writeBlob or render inline via dangerouslySetInnerHTML.
//
//   sheetId       — A0 / A1 / A2 / A3 / A4
//   orientation   — 'portrait' / 'landscape'
//   titleBlock    — overrides for defaultTitleBlock fields
//   margin        — paper-mm outside the inner border (default 10)
//
// `extras` lets callers stamp existing-revision rows / BOM rows on the
// template; defaults are blank so the drafter can fill them in.
export function buildSheetTemplate({
    sheetId = 'A4',
    orientation = 'portrait',
    titleBlock = {},
    margin = 10,
    revisions = [],
    bom = [],
} = {}) {
    const { widthMm, heightMm } = sheetMm(sheetId, orientation);
    const tb = defaultTitleBlock(titleBlock);
    const geom = titleBlockGeometry(widthMm);

    const out = [];
    out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    out.push(`<svg xmlns="http://www.w3.org/2000/svg"`);
    out.push(`     data-template-sheet="${sheetId}"`);
    out.push(`     data-template-orientation="${orientation}"`);
    out.push(`     width="${widthMm}mm" height="${heightMm}mm"`);
    out.push(`     viewBox="0 0 ${widthMm} ${heightMm}">`);
    // Paper background.
    out.push(`  <rect x="0" y="0" width="${widthMm}" height="${heightMm}" fill="#ffffff" stroke="none"/>`);

    // ---- Outer + inner border frames ----
    // Outer 1 mm from paper edge, inner at `margin` mm.
    out.push(`  <g data-layer="border" fill="none" stroke="#000000" stroke-width="0.6">`);
    out.push(`    <rect x="1" y="1" width="${(widthMm - 2).toFixed(3)}" height="${(heightMm - 2).toFixed(3)}" stroke-width="0.3"/>`);
    out.push(`    <rect x="${margin}" y="${margin}" width="${(widthMm - 2 * margin).toFixed(3)}" height="${(heightMm - 2 * margin).toFixed(3)}" stroke-width="0.6"/>`);
    out.push(`  </g>`);

    // ---- Title block (lower-right) ----
    const tbX = widthMm - margin - geom.tbW;
    const tbY = heightMm - margin - geom.tbH;
    const tbRows = [
        { k: 'Project',  v: tb.project },
        { k: 'Drawing',  v: tb.drawing },
        { k: 'Drawn by', v: `${tb.drawnBy}${tb.drawnDate ? ' · ' + tb.drawnDate : ''}` },
        { k: 'Checked',  v: `${tb.checkedBy}${tb.checkedDate ? ' · ' + tb.checkedDate : ''}` },
        { k: 'Sheet',    v: `${sheetId} ${orientation}` },
        { k: 'Scale',    v: tb.scale },
        { k: 'Revision', v: tb.revision },
    ];
    const tbRowH = geom.tbH / tbRows.length;
    const tbKeyColW = Math.min(28, geom.tbW * 0.32);

    out.push(`  <g data-layer="titleblock" font-family="Helvetica, Arial, sans-serif" font-size="3.2" fill="#000000">`);
    out.push(`    <rect x="${tbX.toFixed(3)}" y="${tbY.toFixed(3)}" width="${geom.tbW.toFixed(3)}" height="${geom.tbH.toFixed(3)}" fill="none" stroke="#000000" stroke-width="0.6"/>`);
    // Vertical divider between key + value columns.
    out.push(`    <line x1="${(tbX + tbKeyColW).toFixed(3)}" y1="${tbY.toFixed(3)}" x2="${(tbX + tbKeyColW).toFixed(3)}" y2="${(tbY + geom.tbH).toFixed(3)}" stroke="#000000" stroke-width="0.3"/>`);
    for (let i = 0; i < tbRows.length; i++) {
        const { k, v } = tbRows[i];
        const rowY = tbY + (i + 1) * tbRowH;
        if (i < tbRows.length - 1) {
            out.push(`    <line x1="${tbX.toFixed(3)}" y1="${rowY.toFixed(3)}" x2="${(tbX + geom.tbW).toFixed(3)}" y2="${rowY.toFixed(3)}" stroke="#000000" stroke-width="0.2"/>`);
        }
        const textY = tbY + (i + 0.65) * tbRowH;
        out.push(`    <text x="${(tbX + 2).toFixed(3)}" y="${textY.toFixed(3)}" font-weight="600">${escapeXml(k)}</text>`);
        out.push(`    <text x="${(tbX + tbKeyColW + 2).toFixed(3)}" y="${textY.toFixed(3)}">${escapeXml(v)}</text>`);
    }
    out.push(`  </g>`);

    // ---- Revision history table (above title block) ----
    const revX = tbX;
    const revY = tbY - geom.revH - 2;
    const revRowCount = 4;
    const revRowH = geom.revH / revRowCount;
    // Columns: Rev / Date / By / Description (proportional widths).
    const revCols = [
        { k: 'Rev',  w: 0.12 },
        { k: 'Date', w: 0.22 },
        { k: 'By',   w: 0.16 },
        { k: 'Description', w: 0.50 },
    ];
    out.push(`  <g data-layer="revtable" font-family="Helvetica, Arial, sans-serif" font-size="3" fill="#000000">`);
    out.push(`    <rect x="${revX.toFixed(3)}" y="${revY.toFixed(3)}" width="${geom.tbW.toFixed(3)}" height="${geom.revH.toFixed(3)}" fill="none" stroke="#000000" stroke-width="0.6"/>`);
    // Header row.
    let colX = revX;
    for (const col of revCols) {
        const cw = col.w * geom.tbW;
        out.push(`    <text x="${(colX + 1.5).toFixed(3)}" y="${(revY + revRowH * 0.65).toFixed(3)}" font-weight="700">${escapeXml(col.k)}</text>`);
        colX += cw;
        if (colX < revX + geom.tbW - 0.01) {
            out.push(`    <line x1="${colX.toFixed(3)}" y1="${revY.toFixed(3)}" x2="${colX.toFixed(3)}" y2="${(revY + geom.revH).toFixed(3)}" stroke="#000000" stroke-width="0.2"/>`);
        }
    }
    // Row dividers.
    for (let i = 1; i < revRowCount; i++) {
        const ry = revY + i * revRowH;
        out.push(`    <line x1="${revX.toFixed(3)}" y1="${ry.toFixed(3)}" x2="${(revX + geom.tbW).toFixed(3)}" y2="${ry.toFixed(3)}" stroke="#000000" stroke-width="0.2"/>`);
    }
    // Stamp any caller-supplied revisions into rows 1..N (row 0 is header).
    for (let r = 0; r < Math.min(revisions.length, revRowCount - 1); r++) {
        const rev = revisions[r] || {};
        const ry = revY + (r + 1 + 0.65) * revRowH;
        let cx = revX;
        const vals = [rev.rev || '', rev.date || '', rev.by || '', rev.description || ''];
        for (let c = 0; c < revCols.length; c++) {
            const cw = revCols[c].w * geom.tbW;
            out.push(`    <text x="${(cx + 1.5).toFixed(3)}" y="${ry.toFixed(3)}">${escapeXml(vals[c])}</text>`);
            cx += cw;
        }
    }
    out.push(`  </g>`);

    // ---- BOM placeholder (above revision table) ----
    const bomX = revX;
    const bomY = revY - geom.bomH - 2;
    const bomRowCount = 4;
    const bomRowH = geom.bomH / bomRowCount;
    const bomCols = [
        { k: 'Item', w: 0.10 },
        { k: 'Qty',  w: 0.10 },
        { k: 'Part No.', w: 0.22 },
        { k: 'Description', w: 0.40 },
        { k: 'Material', w: 0.18 },
    ];
    out.push(`  <g data-layer="bomtable" font-family="Helvetica, Arial, sans-serif" font-size="3" fill="#000000">`);
    out.push(`    <rect x="${bomX.toFixed(3)}" y="${bomY.toFixed(3)}" width="${geom.tbW.toFixed(3)}" height="${geom.bomH.toFixed(3)}" fill="none" stroke="#000000" stroke-width="0.6"/>`);
    // Header.
    let bcx = bomX;
    for (const col of bomCols) {
        const cw = col.w * geom.tbW;
        out.push(`    <text x="${(bcx + 1.5).toFixed(3)}" y="${(bomY + bomRowH * 0.65).toFixed(3)}" font-weight="700">${escapeXml(col.k)}</text>`);
        bcx += cw;
        if (bcx < bomX + geom.tbW - 0.01) {
            out.push(`    <line x1="${bcx.toFixed(3)}" y1="${bomY.toFixed(3)}" x2="${bcx.toFixed(3)}" y2="${(bomY + geom.bomH).toFixed(3)}" stroke="#000000" stroke-width="0.2"/>`);
        }
    }
    // Row dividers.
    for (let i = 1; i < bomRowCount; i++) {
        const ry = bomY + i * bomRowH;
        out.push(`    <line x1="${bomX.toFixed(3)}" y1="${ry.toFixed(3)}" x2="${(bomX + geom.tbW).toFixed(3)}" y2="${ry.toFixed(3)}" stroke="#000000" stroke-width="0.2"/>`);
    }
    // Stamp any caller-supplied BOM rows.
    for (let r = 0; r < Math.min(bom.length, bomRowCount - 1); r++) {
        const item = bom[r] || {};
        const ry = bomY + (r + 1 + 0.65) * bomRowH;
        let cx = bomX;
        const vals = [
            String(item.item || r + 1),
            String(item.qty || ''),
            String(item.partNo || ''),
            String(item.description || ''),
            String(item.material || ''),
        ];
        for (let c = 0; c < bomCols.length; c++) {
            const cw = bomCols[c].w * geom.tbW;
            out.push(`    <text x="${(cx + 1.5).toFixed(3)}" y="${ry.toFixed(3)}">${escapeXml(vals[c])}</text>`);
            cx += cw;
        }
    }
    out.push(`  </g>`);

    // ---- Drawing area (everything to the left of + above the right-column stack) ----
    // Stack height = tb + rev + bom + 2 mm × 2 separators.
    const stackH = geom.tbH + geom.revH + geom.bomH + 4;
    // The drawing area is bounded by:
    //   left = margin
    //   top  = margin
    //   right = widthMm - margin
    //   bottom = heightMm - margin
    // …but the lower-right stack (tb / rev / bom) carves out tbW × stackH.
    // We mark the L-shape with a dashed faint outline + "Drawing Area" label.
    const daX = margin;
    const daY = margin;
    const daW = widthMm - 2 * margin;
    const daH = heightMm - 2 * margin - stackH;
    // Below the stack, the drawing area is full width.
    out.push(`  <g data-layer="drawingarea" fill="none" stroke="#9a9a9a" stroke-width="0.25" stroke-dasharray="2 1.4">`);
    // Top horizontal piece (above the stack).
    out.push(`    <rect x="${daX.toFixed(3)}" y="${daY.toFixed(3)}" width="${daW.toFixed(3)}" height="${daH.toFixed(3)}"/>`);
    // Strip to the left of the stack.
    const stripX = margin;
    const stripY = daY + daH;
    const stripW = (widthMm - margin) - geom.tbW - margin;
    const stripH = stackH;
    if (stripW > 1) {
        out.push(`    <rect x="${stripX.toFixed(3)}" y="${stripY.toFixed(3)}" width="${stripW.toFixed(3)}" height="${stripH.toFixed(3)}"/>`);
    }
    out.push(`  </g>`);
    // "Drawing Area" label, centred in the upper drawing area.
    out.push(`  <g data-layer="drawinglabel" font-family="Helvetica, Arial, sans-serif" font-size="6" fill="#9a9a9a">`);
    out.push(`    <text x="${(daX + daW / 2).toFixed(3)}" y="${(daY + daH / 2).toFixed(3)}" text-anchor="middle" dominant-baseline="middle" opacity="0.7">Drawing Area · ${sheetId} ${orientation}</text>`);
    out.push(`  </g>`);

    out.push(`</svg>`);
    return out.join('\n');
}

// Per-sheet convenience builders. All five share the same backing
// buildSheetTemplate but make the SKILL.md-level API explicit.
export function buildA4Template(titleBlock = {}, opts = {}) {
    return buildSheetTemplate({ sheetId: 'A4', ...opts, titleBlock });
}
export function buildA3Template(titleBlock = {}, opts = {}) {
    return buildSheetTemplate({ sheetId: 'A3', ...opts, titleBlock });
}
export function buildA2Template(titleBlock = {}, opts = {}) {
    return buildSheetTemplate({ sheetId: 'A2', ...opts, titleBlock });
}
export function buildA1Template(titleBlock = {}, opts = {}) {
    return buildSheetTemplate({ sheetId: 'A1', ...opts, titleBlock });
}
export function buildA0Template(titleBlock = {}, opts = {}) {
    return buildSheetTemplate({ sheetId: 'A0', ...opts, titleBlock });
}

// Catalogue of predefined templates for the panel picker. Each entry is
// (id, label, sheetId, orientation, default title-block stamp). The
// panel exposes these as buttons; custom user templates are appended
// dynamically from localStorage.
export const PREDEFINED_TEMPLATES = [
    { id: 'A4-portrait',  label: 'A4 · Portrait',  sheetId: 'A4', orientation: 'portrait'  },
    { id: 'A4-landscape', label: 'A4 · Landscape', sheetId: 'A4', orientation: 'landscape' },
    { id: 'A3-landscape', label: 'A3 · Landscape', sheetId: 'A3', orientation: 'landscape' },
    { id: 'A3-portrait',  label: 'A3 · Portrait',  sheetId: 'A3', orientation: 'portrait'  },
    { id: 'A2-landscape', label: 'A2 · Landscape', sheetId: 'A2', orientation: 'landscape' },
    { id: 'A1-landscape', label: 'A1 · Landscape', sheetId: 'A1', orientation: 'landscape' },
    { id: 'A0-landscape', label: 'A0 · Landscape', sheetId: 'A0', orientation: 'landscape' },
];

export const LOCALSTORAGE_KEY = 'forge.v4.drawingTemplates';

// Load custom user templates from localStorage. Returns [] when no
// browser env or no saved templates. Each entry is shape-compatible
// with PREDEFINED_TEMPLATES + carries `titleBlock` (the saved stamp).
export function loadCustomTemplates() {
    if (typeof window === 'undefined' || !window.localStorage) return [];
    try {
        const raw = window.localStorage.getItem(LOCALSTORAGE_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((t) => t && typeof t.id === 'string'
            && typeof t.sheetId === 'string');
    } catch {
        return [];
    }
}

// Persist a custom template list to localStorage. We dedup on `id` so
// re-saves overwrite rather than append.
export function saveCustomTemplate(template) {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    const list = loadCustomTemplates();
    const idx = list.findIndex((t) => t.id === template.id);
    if (idx >= 0) list[idx] = template;
    else list.push(template);
    try {
        window.localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(list));
        return true;
    } catch {
        return false;
    }
}

export function deleteCustomTemplate(id) {
    if (typeof window === 'undefined' || !window.localStorage) return false;
    const list = loadCustomTemplates().filter((t) => t.id !== id);
    try {
        window.localStorage.setItem(LOCALSTORAGE_KEY, JSON.stringify(list));
        return true;
    } catch {
        return false;
    }
}
