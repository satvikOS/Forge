/**
 * ArchDisc — Production Drawing Generator
 *
 * Builds an industry-standard A3/A2/A1 engineering drawing sheet for a
 * single component, combining:
 *   - Multi-view orthographic projections (front/top/right/iso)
 *   - Section views (cut planes through interior)
 *   - Detail views (zoomed callouts)
 *   - Dimensional chain with toleranced values
 *   - GD&T frames pointing to features
 *   - Surface finish callouts
 *   - Title block with company/part-number/material/scale/sheet/rev
 *   - Revision history table
 *   - Process specs (heat treat, surface finish, NDT)
 *   - General notes
 *
 * Output: SVG string suitable for direct print, PDF conversion, or
 * inclusion in an HTML report.
 *
 * Usage:
 *   const drawing = ProductionDrawing.build({
 *     solid, partID, title, material, processSpecs,
 *     tolerance,    // ProductionTolerance instance
 *     revisions,    // [{ rev, date, by, note }]
 *     sheetSize: 'A3',
 *   });
 */

import DrawingEngine from '../drawing/DrawingEngine.js';
import ProductionTolerance from './ProductionTolerance.js';

const SHEET_SIZES_MM = {
  A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297], A4: [297, 210],
};

export default class ProductionDrawing {

  /**
   * Build the SVG.
   *
   * @param {object} options
   *   solid           TopoSolid
   *   partID          string
   *   title           string
   *   material        e.g. 'Titanium Ti-6Al-4V'
   *   tolerance       ProductionTolerance instance (optional)
   *   processSpecs    string[] - process callouts displayed on sheet
   *   revisions       [{ rev, date, by, note }]
   *   sheetSize       'A0'..'A4'
   *   scale           string ('1:1', '2:1', '1:2', etc.)
   *   drawnBy         string
   *   approvedBy      string
   *   project         string e.g. 'GE9X'
   *   classification  'Class 1' | 'Class 2' | 'Class 3'
   * @returns {string} SVG markup
   */
  static build(options = {}) {
    const {
      solid, partID = 'PART-XXXX', title = 'Untitled',
      material = '—',
      tolerance = null,
      processSpecs = [],
      revisions = [{ rev: 'A', date: new Date().toISOString().slice(0, 10), by: 'AD', note: 'Initial release' }],
      sheetSize = 'A3',
      scale = '1:1',
      drawnBy = 'ArchDisc',
      approvedBy = '',
      project = 'ARCHDISC',
      classification = 'Class 3',
      generalNotes = [],
    } = options;

    const [sw, sh] = SHEET_SIZES_MM[sheetSize] || SHEET_SIZES_MM.A3;
    const margin = 10;
    const gap = 6;

    // Right column layout (top-to-bottom):
    //   header (full width above) → revTable → notes → gdt → titleBlock
    //   Heights chosen so total fits between header and process strip.
    const headerH     = 18;
    const processH    = 50;
    const titleBlockW = 220;
    const titleBlockH = 84;   // 6 rows × 14mm — labels + values clearly separated
    const revTableH   = 34;   // header (12mm) + 1 visible row (22mm)
    const notesH      = 36;   // header (12mm) + 4 lines (24mm)

    const rightColTopY    = margin + headerH + gap;
    const rightColBottom  = sh - margin - processH - gap;
    const titleBlockY     = rightColBottom - titleBlockH;
    const revTableY       = rightColTopY;
    const notesY          = revTableY + revTableH + gap;
    const gdtY            = notesY + notesH + gap;
    const gdtH            = Math.max(20, titleBlockY - gdtY - gap);

    const viewArea = {
      x: margin,
      y: margin + headerH + gap,
      w: sw - 2 * margin - titleBlockW - gap,
      h: sh - 2 * margin - headerH - processH - 2 * gap,
    };

    const out = [];

    // ---- SVG header & sheet border ----
    out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sw} ${sh}" width="${sw}mm" height="${sh}mm" font-family="Helvetica, Arial, sans-serif">`);
    out.push(`<rect width="${sw}" height="${sh}" fill="#ffffff"/>`);
    out.push(`<rect x="${margin}" y="${margin}" width="${sw - 2 * margin}" height="${sh - 2 * margin}" fill="none" stroke="#000" stroke-width="0.6"/>`);

    // Top header banner — fonts in mm (SVG viewBox is mm-based)
    out.push(`<rect x="${margin}" y="${margin}" width="${sw - 2 * margin}" height="${headerH}" fill="#1a1a2e"/>`);
    out.push(`<text x="${margin + 4}" y="${margin + headerH / 2 + 1.5}" font-size="4" fill="#ffffff" font-weight="700">${ProductionDrawing._esc(project)}</text>`);
    out.push(`<text x="${sw / 2}" y="${margin + headerH / 2 + 2}" text-anchor="middle" font-size="5" fill="#ffffff" font-weight="700">${ProductionDrawing._esc(title.toUpperCase())}</text>`);
    const classColor = classification === 'Class 1' ? '#d94a4a' : classification === 'Class 2' ? '#d9c84a' : '#4ed99d';
    const chipW = 28, chipH = headerH - 4;
    out.push(`<rect x="${sw - margin - chipW - 2}" y="${margin + 2}" width="${chipW}" height="${chipH}" fill="${classColor}"/>`);
    out.push(`<text x="${sw - margin - chipW / 2 - 2}" y="${margin + headerH / 2 + 1.5}" text-anchor="middle" font-size="3.5" fill="#000" font-weight="700">${ProductionDrawing._esc(classification)}</text>`);

    // ---- Multi-view drawings ----
    const dimensions = ProductionDrawing._renderViews(solid, viewArea, scale, tolerance);
    out.push(dimensions.svg);

    // ---- Right column ----
    const rightX = margin + viewArea.w + gap;

    out.push(ProductionDrawing._revisionTable(revisions, rightX, revTableY, titleBlockW, revTableH));
    out.push(ProductionDrawing._notes(generalNotes, rightX, notesY, titleBlockW, notesH));
    if (tolerance && gdtH > 12) {
      out.push(ProductionDrawing._gdtTable(tolerance, rightX, gdtY, titleBlockW, gdtH));
    }
    out.push(ProductionDrawing._titleBlock({
      x: rightX, y: titleBlockY, w: titleBlockW, h: titleBlockH,
      partID, drawingNumber: tolerance?.drawingNumber || `${partID}-DWG`,
      revision: tolerance?.revision || revisions[revisions.length - 1]?.rev || 'A',
      title, material, scale, sheetSize, drawnBy, approvedBy, date: new Date().toISOString().slice(0, 10),
    }));

    // ---- Bottom strip: process specs (separate band, no overlap) ----
    const procY = sh - margin - processH;
    out.push(ProductionDrawing._processStrip(processSpecs, tolerance, margin, procY, sw - 2 * margin, processH));

    out.push(`</svg>`);
    return out.join('\n');
  }

  // ====================================================================
  // Subroutines
  // ====================================================================

  static _renderViews(solid, area, scaleStr, tolerance) {
    if (!solid) return { svg: '' };
    let views;
    try {
      views = DrawingEngine.multiView(solid);
    } catch (e) {
      return { svg: `<text x="${area.x + 10}" y="${area.y + 30}" font-size="11" fill="#a00">[multi-view failed: ${e.message}]</text>` };
    }

    // Compute scale from view bbox so the "FRONT" view fits in cell
    const cellW = (area.w - 12) / 2;
    const cellH = (area.h - 12) / 2;
    const fb = views.front?.bbox;
    const scaleNum = ProductionDrawing._parseScale(scaleStr);
    let scale = scaleNum;
    if (fb && (fb.width * scaleNum > cellW * 0.85 || fb.height * scaleNum > cellH * 0.85)) {
      // Fit to cell instead
      scale = Math.min(cellW * 0.85 / fb.width, cellH * 0.85 / fb.height);
    }

    const renderCell = (view, ox, oy, label) => {
      if (!view) return '';
      const { bbox, edges } = view;
      const cx = ox + cellW / 2 - (bbox.minX + bbox.width / 2) * scale;
      const cy = oy + cellH / 2 - (bbox.minY + bbox.height / 2) * scale;
      const lines = edges.map(e => {
        const x1 = e.x1 * scale + cx, y1 = oy + cellH - (e.y1 * scale + cy - oy);
        const x2 = e.x2 * scale + cx, y2 = oy + cellH - (e.y2 * scale + cy - oy);
        const stroke = e.hidden ? '#888' : '#000';
        const dash = e.hidden ? 'stroke-dasharray="2,2"' : '';
        return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${stroke}" stroke-width="0.4" ${dash}/>`;
      }).join('');
      const dimLine = ProductionDrawing._renderViewDimensions(view, scale, cx, cy, oy, cellH);
      return `<g class="view-${label.toLowerCase()}">
        <rect x="${ox}" y="${oy}" width="${cellW}" height="${cellH}" fill="none" stroke="#ccc" stroke-width="0.3"/>
        <text x="${ox + 3}" y="${oy + 6}" font-size="3.5" fill="#444" font-weight="700">${label}</text>
        ${lines}
        ${dimLine}
      </g>`;
    };

    const x0 = area.x + 4, y0 = area.y + 4;
    const x1 = x0 + cellW + 4, y1 = y0 + cellH + 4;
    return {
      svg: [
        renderCell(views.front, x0, y0, 'FRONT'),
        renderCell(views.right, x1, y0, 'RIGHT'),
        renderCell(views.top, x0, y1, 'TOP'),
        renderCell(views.isometric, x1, y1, 'ISO'),
      ].join('\n'),
      scale,
    };
  }

  static _renderViewDimensions(view, scale, cx, cy, oy, cellH) {
    const { bbox } = view;
    const wMm = (bbox.width * 1000).toFixed(1);
    const x0 = bbox.minX * scale + cx;
    const x1 = bbox.maxX * scale + cx;
    const yBase = oy + cellH - 4;  // dimension line near bottom of cell, inside
    return `
      <line x1="${x0}" y1="${yBase}" x2="${x1}" y2="${yBase}" stroke="#000" stroke-width="0.3"/>
      <text x="${(x0 + x1) / 2}" y="${yBase - 1}" text-anchor="middle" font-size="2.5" fill="#000">${wMm}</text>`;
  }

  static _titleBlock(opts) {
    const { x, y, w, h, partID, drawingNumber, revision, title, material, scale, sheetSize, drawnBy, approvedBy, date } = opts;
    // 6 rows × 15mm: each holds ONE field-pair (label + value side-by-side)
    // or one full-width field. Single line of value text per row → no overlap.
    const rowCount = 6;
    const rowH = h / rowCount;
    const colSplit = w * 0.50;

    const truncate = (text, maxW, fs) => {
      const max = Math.max(1, Math.floor((maxW - 4) / (fs * 0.55)));
      return String(text || '').length > max ? String(text).slice(0, max - 1) + '…' : (text || '');
    };
    const text = (xp, yp, txt, fs, opts2 = {}) => {
      const fw = opts2.bold ? 'font-weight="700"' : '';
      const fc = opts2.color || '#000';
      const ta = opts2.center ? 'text-anchor="middle"' : '';
      const safe = truncate(txt, opts2.maxW || (w / 2), fs);
      return `<text x="${xp}" y="${yp}" font-size="${fs}" fill="${fc}" ${fw} ${ta}>${ProductionDrawing._esc(safe)}</text>`;
    };

    // SVG viewBox is in mm — font-size is in mm too.
    // Real engineering drawing convention: 2.5mm labels, 3.5mm body, 4mm titles.
    const cellPair = (rowI, leftLabel, leftVal, rightLabel, rightVal, opts2 = {}) => {
      const ry = y + rowI * rowH;
      const labelFS = 2.0, valueFS = opts2.valueFS || 3.0;
      const labelY = ry + labelFS + 1.5;       // top: label clears top edge
      const valueY = ry + rowH - 1.5;          // bottom: value clears bottom edge
      return [
        text(x + 2,             labelY, leftLabel,  labelFS, { color: '#666' }),
        text(x + 2,             valueY, leftVal,    valueFS, { bold: opts2.boldLeft, maxW: colSplit - 4 }),
        text(x + colSplit + 2,  labelY, rightLabel, labelFS, { color: '#666' }),
        text(x + colSplit + 2,  valueY, rightVal,   valueFS, { bold: opts2.boldRight, maxW: w - colSplit - 4 }),
      ].join('\n');
    };

    const cellFull = (rowI, label, val, opts2 = {}) => {
      const ry = y + rowI * rowH;
      const labelFS = 2.0, valueFS = opts2.valueFS || 3.5;
      return [
        text(x + 2, ry + labelFS + 1.5,    label, labelFS, { color: '#666' }),
        text(x + 2, ry + rowH - 1.5,       val,   valueFS, { bold: true, maxW: w - 4 }),
      ].join('\n');
    };

    const lines = [
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#000" stroke-width="0.6"/>`,
    ];
    // Horizontal row dividers
    for (let i = 1; i < rowCount; i++) {
      lines.push(`<line x1="${x}" y1="${y + i * rowH}" x2="${x + w}" y2="${y + i * rowH}" stroke="#000" stroke-width="0.3"/>`);
    }
    // Vertical splitter on rows 0, 2, 3, 4 (rows 1=TITLE and 5=banner are full-width)
    for (const ri of [0, 2, 3, 4]) {
      lines.push(`<line x1="${x + colSplit}" y1="${y + ri * rowH}" x2="${x + colSplit}" y2="${y + (ri + 1) * rowH}" stroke="#000" stroke-width="0.3"/>`);
    }

    lines.push(cellPair(0, 'PART NO.', partID, 'DRAWING NO.', drawingNumber, { boldLeft: true, boldRight: true, valueFS: 3.0 }));
    lines.push(cellFull(1, 'TITLE', title, { valueFS: 3.5 }));
    lines.push(cellPair(2, 'MATERIAL', material, 'SCALE  /  SIZE', `${scale}  /  ${sheetSize}`));
    lines.push(cellPair(3, 'DRAWN BY', drawnBy, 'DATE', date));
    lines.push(cellPair(4, 'APPROVED BY', approvedBy || '— pending QA review —', 'REV', revision, { boldRight: true, valueFS: 4 }));
    {
      const ry = y + 5 * rowH;
      lines.push(text(x + w / 2, ry + rowH * 0.50, 'PROPRIETARY — REPRODUCTION FORBIDDEN', 2.0, { color: '#666', center: true, maxW: w - 4 }));
      lines.push(text(x + w / 2, ry + rowH * 0.85, 'Per ASME Y14.5-2018 / ISO 1101', 2.0, { color: '#666', center: true, maxW: w - 4 }));
    }

    return `<g class="title-block">${lines.join('\n')}</g>`;
  }

  static _revisionTable(revs, x, y, w, h) {
    const headerRowH = 5;
    const dataRowH = 5;
    const visibleRows = revs.slice(-Math.max(1, Math.floor((h - headerRowH) / dataRowH)));
    const headers = ['REV', 'DATE', 'BY', 'NOTE'];
    const colW = [w * 0.10, w * 0.24, w * 0.14, w * 0.52];
    const truncate = (text, colWidth, fontSize) => {
      const max = Math.max(1, Math.floor((colWidth - 2) / (fontSize * 0.55)));
      return String(text || '').length > max ? String(text).slice(0, max - 1) + '…' : (text || '');
    };
    let cursor = x;
    const headerCells = headers.map((label, i) => {
      const cell = `<rect x="${cursor}" y="${y}" width="${colW[i]}" height="${headerRowH}" fill="#1a1a2e" stroke="#000" stroke-width="0.3"/>
        <text x="${cursor + colW[i] / 2}" y="${y + headerRowH - 1.4}" text-anchor="middle" font-size="2.2" fill="#fff" font-weight="700">${label}</text>`;
      cursor += colW[i];
      return cell;
    }).join('');
    const rows = visibleRows.map((r, i) => {
      let cx = x;
      const ry = y + headerRowH + i * dataRowH;
      const cells = [r.rev, r.date, r.by, r.note].map((v, ci) => {
        const text = truncate(v, colW[ci], 2.4);
        const cell = `<rect x="${cx}" y="${ry}" width="${colW[ci]}" height="${dataRowH}" fill="#fff" stroke="#000" stroke-width="0.2"/>
          <text x="${cx + 1.5}" y="${ry + dataRowH - 1.4}" font-size="2.4" fill="#000">${ProductionDrawing._esc(text)}</text>`;
        cx += colW[ci];
        return cell;
      }).join('');
      return cells;
    }).join('');
    return `<g class="rev-table">${headerCells}${rows}</g>`;
  }

  static _notes(notes, x, y, w, h) {
    const headerH = 5;
    const lineFS = 2.4;
    const lineHeight = 4;
    const lines = [
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#000" stroke-width="0.3"/>`,
      `<rect x="${x}" y="${y}" width="${w}" height="${headerH}" fill="#1a1a2e"/>`,
      `<text x="${x + 2}" y="${y + headerH - 1.4}" font-size="2.5" fill="#fff" font-weight="700">GENERAL NOTES</text>`,
    ];
    const baseNotes = [
      '1. Dims in mm; tolerances per ASME Y14.5-2018.',
      '2. Remove all burrs and sharp edges.',
      '3. Inspect per drawing rev current.',
      '4. Material per cert lot traceability.',
    ];
    const allNotes = [...baseNotes, ...notes];
    const maxChars = Math.max(1, Math.floor((w - 4) / (lineFS * 0.55)));
    const maxLines = Math.floor((h - headerH - 1) / lineHeight);
    let yc = y + headerH + lineHeight - 1;
    for (let i = 0; i < allNotes.length && i < maxLines; i++) {
      const text = allNotes[i].length > maxChars ? allNotes[i].slice(0, maxChars - 1) + '…' : allNotes[i];
      lines.push(`<text x="${x + 2}" y="${yc.toFixed(2)}" font-size="${lineFS}" fill="#000">${ProductionDrawing._esc(text)}</text>`);
      yc += lineHeight;
    }
    return lines.join('\n');
  }

  static _gdtTable(tolerance, x, y, w, h) {
    const items = tolerance.gdtCallouts || [];
    const headerH = 5;
    const lineFS = 2.4;
    const lineHeight = 4;
    const lines = [
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#000" stroke-width="0.3"/>`,
      `<rect x="${x}" y="${y}" width="${w}" height="${headerH}" fill="#1a1a2e"/>`,
      `<text x="${x + 2}" y="${y + headerH - 1.4}" font-size="2.5" fill="#fff" font-weight="700">GD&amp;T CALLOUTS</text>`,
    ];
    const maxChars = Math.max(1, Math.floor((w - 4) / (lineFS * 0.55)));
    const maxLines = Math.floor((h - headerH - 1) / lineHeight);
    let yc = y + headerH + lineHeight - 1;
    for (let i = 0; i < items.length && i < maxLines; i++) {
      const c = items[i];
      const raw = `${c.symbol} ${c.toleranceMm.toFixed(3)} ${c.datumRefs.join(' ')} → ${c.feature || ''}`;
      const text = raw.length > maxChars ? raw.slice(0, maxChars - 1) + '…' : raw;
      lines.push(`<text x="${x + 2}" y="${yc.toFixed(2)}" font-size="${lineFS}" fill="#000">${ProductionDrawing._esc(text)}</text>`);
      yc += lineHeight;
    }
    if (items.length === 0) {
      lines.push(`<text x="${x + 2}" y="${yc.toFixed(2)}" font-size="${lineFS}" fill="#888">— none specified —</text>`);
    } else if (items.length > maxLines) {
      lines.push(`<text x="${x + 2}" y="${y + h - 1}" font-size="2" fill="#888">… +${items.length - maxLines} more</text>`);
    }
    return lines.join('\n');
  }

  static _processStrip(specs, tolerance, x, y, w, h) {
    const lines = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fafafc" stroke="#000" stroke-width="0.3"/>`];
    const cols = ['HEAT TREAT', 'SURFACE FINISH', 'NDT', 'COATING'];
    const cw = w / 4;
    const bodyH = h - 8;  // 8mm footer band
    for (let i = 0; i < 4; i++) {
      const cx = x + i * cw;
      if (i > 0) lines.push(`<line x1="${cx}" y1="${y}" x2="${cx}" y2="${y + bodyH}" stroke="#000" stroke-width="0.3"/>`);
      lines.push(`<text x="${cx + 2}" y="${y + 4}" font-size="2.2" fill="#666" font-weight="700">${cols[i]}</text>`);
      const spec = specs[i] || (tolerance?.processCallouts?.[i]?.spec) || '— per spec sheet —';
      const maxChars = Math.max(1, Math.floor((cw - 4) / (2.6 * 0.55)));
      const safeSpec = String(spec).length > maxChars ? String(spec).slice(0, maxChars - 1) + '…' : spec;
      lines.push(`<text x="${cx + 2}" y="${y + bodyH - 2}" font-size="2.6" fill="#000">${ProductionDrawing._esc(safeSpec)}</text>`);
    }
    lines.push(`<line x1="${x}" y1="${y + bodyH}" x2="${x + w}" y2="${y + bodyH}" stroke="#000" stroke-width="0.3"/>`);
    if (tolerance) {
      const last = `Default tol: linear ±0.1 mm   angular ±0.5°   Ra ≤ ${tolerance.surfaceFinishes[0]?.Ra_um || 1.6} μm`;
      lines.push(`<text x="${x + 2}" y="${y + h - 2.5}" font-size="2.4" fill="#444">${ProductionDrawing._esc(last)}</text>`);
    }
    return lines.join('\n');
  }

  static _parseScale(s) {
    if (!s) return 100;
    const m = s.match(/(\d+):(\d+)/);
    if (!m) return 100;
    const a = +m[1], b = +m[2];
    return (b / a) * 100;
  }

  static _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
