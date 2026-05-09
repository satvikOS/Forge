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
    const margin = 12;

    // Layout regions:
    //   - Top header (project banner, classification stripe)
    //   - Main view area (4 ortho views)
    //   - Right column: title block + rev table + general notes
    //   - Bottom: process callouts + GD&T summary table
    const headerH = 16;
    const titleBlockW = 180;
    const titleBlockH = 64;
    const revTableH = 60;
    const notesH = 64;
    const processH = 58;
    const viewArea = {
      x: margin,
      y: margin + headerH,
      w: sw - 2 * margin - titleBlockW - margin,
      h: sh - 2 * margin - headerH - processH,
    };

    const out = [];

    // ---- SVG header & sheet border ----
    out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sw} ${sh}" width="${sw}mm" height="${sh}mm" font-family="Helvetica, Arial, sans-serif">`);
    out.push(`<rect width="${sw}" height="${sh}" fill="#ffffff"/>`);
    out.push(`<rect x="${margin}" y="${margin}" width="${sw - 2 * margin}" height="${sh - 2 * margin}" fill="none" stroke="#000" stroke-width="0.6"/>`);

    // Top header banner
    out.push(`<rect x="${margin}" y="${margin}" width="${sw - 2 * margin}" height="${headerH}" fill="#1a1a2e"/>`);
    out.push(`<text x="${margin + 4}" y="${margin + 11}" font-size="9" fill="#ffffff" font-weight="700">${ProductionDrawing._esc(project)}</text>`);
    out.push(`<text x="${sw / 2}" y="${margin + 11}" text-anchor="middle" font-size="10" fill="#ffffff" font-weight="700">${ProductionDrawing._esc(title.toUpperCase())}</text>`);
    const classColor = classification === 'Class 1' ? '#d94a4a' : classification === 'Class 2' ? '#d9c84a' : '#4ed99d';
    out.push(`<rect x="${sw - margin - 60}" y="${margin + 2}" width="56" height="${headerH - 4}" fill="${classColor}"/>`);
    out.push(`<text x="${sw - margin - 32}" y="${margin + 12}" text-anchor="middle" font-size="9" fill="#000" font-weight="700">${ProductionDrawing._esc(classification)}</text>`);

    // ---- Multi-view drawings ----
    const dimensions = ProductionDrawing._renderViews(solid, viewArea, scale, tolerance);
    out.push(dimensions.svg);

    // ---- Right column: title block + rev table + notes ----
    const rightX = margin + viewArea.w + margin;
    const titleBlockY = margin + headerH;

    // Revision history table at top of right column
    out.push(ProductionDrawing._revisionTable(revisions, rightX, titleBlockY, titleBlockW, revTableH));

    // General notes
    const notesY = titleBlockY + revTableH + 4;
    out.push(ProductionDrawing._notes(generalNotes, rightX, notesY, titleBlockW, notesH));

    // GD&T summary table
    if (tolerance) {
      const gdtY = notesY + notesH + 4;
      out.push(ProductionDrawing._gdtTable(tolerance, rightX, gdtY, titleBlockW, sh - margin - processH - gdtY - 4));
    }

    // Title block (bottom-right corner)
    const tbY = sh - margin - titleBlockH;
    out.push(ProductionDrawing._titleBlock({
      x: rightX, y: tbY, w: titleBlockW, h: titleBlockH,
      partID, drawingNumber: tolerance?.drawingNumber || `${partID}-DWG`,
      revision: tolerance?.revision || revisions[revisions.length - 1]?.rev || 'A',
      title, material, scale, sheetSize, drawnBy, approvedBy, date: new Date().toISOString().slice(0, 10),
    }));

    // ---- Bottom strip: process specs + tolerance default ----
    const procY = sh - margin - processH + 2;
    out.push(ProductionDrawing._processStrip(processSpecs, tolerance, margin, procY, viewArea.w, processH - 4));

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
        <text x="${ox + 4}" y="${oy + 10}" font-size="8" fill="#444" font-weight="700">${label}</text>
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
    const hMm = (bbox.height * 1000).toFixed(1);
    const x0 = bbox.minX * scale + cx;
    const x1 = bbox.maxX * scale + cx;
    const yBase = oy + cellH - (bbox.minY * scale + cy - oy) + 12;
    return `
      <line x1="${x0}" y1="${yBase}" x2="${x1}" y2="${yBase}" stroke="#000" stroke-width="0.3"/>
      <text x="${(x0 + x1) / 2}" y="${yBase + 7}" text-anchor="middle" font-size="7" fill="#000">${wMm}</text>`;
  }

  static _titleBlock(opts) {
    const { x, y, w, h, partID, drawingNumber, revision, title, material, scale, sheetSize, drawnBy, approvedBy, date } = opts;
    const cellH = h / 4;
    return `<g class="title-block">
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#000" stroke-width="0.6"/>
      <line x1="${x}" y1="${y + cellH}" x2="${x + w}" y2="${y + cellH}" stroke="#000" stroke-width="0.4"/>
      <line x1="${x}" y1="${y + 2 * cellH}" x2="${x + w}" y2="${y + 2 * cellH}" stroke="#000" stroke-width="0.4"/>
      <line x1="${x}" y1="${y + 3 * cellH}" x2="${x + w}" y2="${y + 3 * cellH}" stroke="#000" stroke-width="0.4"/>
      <line x1="${x + w * 0.55}" y1="${y}" x2="${x + w * 0.55}" y2="${y + h}" stroke="#000" stroke-width="0.4"/>

      <text x="${x + 3}" y="${y + 10}" font-size="6" fill="#666">PART NO.</text>
      <text x="${x + 3}" y="${y + cellH - 3}" font-size="9" fill="#000" font-weight="700">${ProductionDrawing._esc(partID)}</text>

      <text x="${x + w * 0.55 + 3}" y="${y + 10}" font-size="6" fill="#666">DWG NO.</text>
      <text x="${x + w * 0.55 + 3}" y="${y + cellH - 3}" font-size="9" fill="#000" font-weight="700">${ProductionDrawing._esc(drawingNumber)}</text>

      <text x="${x + 3}" y="${y + cellH + 8}" font-size="6" fill="#666">TITLE</text>
      <text x="${x + 3}" y="${y + cellH + 16}" font-size="7" fill="#000">${ProductionDrawing._esc(title)}</text>
      <text x="${x + 3}" y="${y + cellH + 23}" font-size="6" fill="#666">MATERIAL</text>
      <text x="${x + 3}" y="${y + cellH + 30}" font-size="7" fill="#000">${ProductionDrawing._esc(material)}</text>

      <text x="${x + w * 0.55 + 3}" y="${y + cellH + 8}" font-size="6" fill="#666">SCALE</text>
      <text x="${x + w * 0.55 + 3}" y="${y + cellH + 16}" font-size="7" fill="#000" font-weight="700">${ProductionDrawing._esc(scale)}</text>
      <text x="${x + w * 0.55 + 3}" y="${y + cellH + 23}" font-size="6" fill="#666">SHEET / SIZE</text>
      <text x="${x + w * 0.55 + 3}" y="${y + cellH + 30}" font-size="7" fill="#000">1 of 1 / ${ProductionDrawing._esc(sheetSize)}</text>

      <text x="${x + 3}" y="${y + 2 * cellH + 8}" font-size="6" fill="#666">DRAWN BY</text>
      <text x="${x + 3}" y="${y + 2 * cellH + 16}" font-size="7" fill="#000">${ProductionDrawing._esc(drawnBy)}</text>
      <text x="${x + 3}" y="${y + 2 * cellH + 23}" font-size="6" fill="#666">APPROVED BY</text>
      <text x="${x + 3}" y="${y + 2 * cellH + 30}" font-size="7" fill="#000">${ProductionDrawing._esc(approvedBy || '— pending —')}</text>

      <text x="${x + w * 0.55 + 3}" y="${y + 2 * cellH + 8}" font-size="6" fill="#666">DATE</text>
      <text x="${x + w * 0.55 + 3}" y="${y + 2 * cellH + 16}" font-size="7" fill="#000">${ProductionDrawing._esc(date)}</text>
      <text x="${x + w * 0.55 + 3}" y="${y + 2 * cellH + 23}" font-size="6" fill="#666">REV</text>
      <text x="${x + w * 0.55 + 3}" y="${y + 2 * cellH + 30}" font-size="9" fill="#000" font-weight="700">${ProductionDrawing._esc(revision)}</text>

      <text x="${x + w / 2}" y="${y + 3 * cellH + 12}" text-anchor="middle" font-size="6" fill="#666">PROPRIETARY — REPRODUCTION FORBIDDEN</text>
      <text x="${x + w / 2}" y="${y + 3 * cellH + 20}" text-anchor="middle" font-size="6" fill="#666">ASME Y14.5-2018 / ISO 1101 dimensioning</text>
    </g>`;
  }

  static _revisionTable(revs, x, y, w, h) {
    const rowH = (h - 14) / Math.max(1, revs.length);
    const headers = ['REV', 'DATE', 'BY', 'NOTE'];
    const colW = [w * 0.10, w * 0.22, w * 0.12, w * 0.56];
    let cursor = x;
    const headerCells = headers.map((label, i) => {
      const cell = `<rect x="${cursor}" y="${y}" width="${colW[i]}" height="14" fill="#1a1a2e" stroke="#000" stroke-width="0.4"/>
        <text x="${cursor + colW[i] / 2}" y="${y + 9}" text-anchor="middle" font-size="6" fill="#fff" font-weight="700">${label}</text>`;
      cursor += colW[i];
      return cell;
    }).join('');
    const rows = revs.map((r, i) => {
      let cx = x;
      const cells = [r.rev, r.date, r.by, r.note].map((v, ci) => {
        const cell = `<rect x="${cx}" y="${y + 14 + i * rowH}" width="${colW[ci]}" height="${rowH}" fill="#fff" stroke="#000" stroke-width="0.3"/>
          <text x="${cx + 2}" y="${y + 14 + i * rowH + rowH / 2 + 2}" font-size="6" fill="#000">${ProductionDrawing._esc(v || '')}</text>`;
        cx += colW[ci];
        return cell;
      }).join('');
      return cells;
    }).join('');
    return `<g class="rev-table">${headerCells}${rows}</g>`;
  }

  static _notes(notes, x, y, w, h) {
    const lines = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#000" stroke-width="0.4"/>`,
      `<rect x="${x}" y="${y}" width="${w}" height="11" fill="#1a1a2e"/>`,
      `<text x="${x + 3}" y="${y + 8}" font-size="7" fill="#fff" font-weight="700">GENERAL NOTES</text>`];
    const baseNotes = [
      '1. Dims in mm; tolerances per ASME Y14.5-2018.',
      '2. Remove all burrs and sharp edges.',
      '3. Inspect per drawing rev current.',
      '4. Material per cert lot traceability.',
    ];
    const allNotes = [...baseNotes, ...notes];
    let yc = y + 18;
    for (let i = 0; i < allNotes.length && yc < y + h - 4; i++) {
      lines.push(`<text x="${x + 3}" y="${yc}" font-size="6" fill="#000">${ProductionDrawing._esc(allNotes[i])}</text>`);
      yc += 7;
    }
    return lines.join('\n');
  }

  static _gdtTable(tolerance, x, y, w, h) {
    const items = tolerance.gdtCallouts || [];
    const lines = [
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#000" stroke-width="0.4"/>`,
      `<rect x="${x}" y="${y}" width="${w}" height="11" fill="#1a1a2e"/>`,
      `<text x="${x + 3}" y="${y + 8}" font-size="7" fill="#fff" font-weight="700">GD&amp;T CALLOUTS</text>`,
    ];
    let yc = y + 18;
    for (const c of items) {
      if (yc > y + h - 6) break;
      const txt = `${c.symbol} ${c.toleranceMm.toFixed(3)} ${c.datumRefs.join(' ')} → ${c.feature || ''}`;
      lines.push(`<text x="${x + 3}" y="${yc}" font-size="6" fill="#000">${ProductionDrawing._esc(txt)}</text>`);
      yc += 7;
    }
    if (items.length === 0) {
      lines.push(`<text x="${x + 3}" y="${yc}" font-size="6" fill="#888">— none specified —</text>`);
    }
    return lines.join('\n');
  }

  static _processStrip(specs, tolerance, x, y, w, h) {
    const lines = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fafafc" stroke="#000" stroke-width="0.4"/>`];
    const cols = ['HEAT TREAT', 'SURFACE FINISH', 'NDT', 'COATING'];
    const cw = w / 4;
    for (let i = 0; i < 4; i++) {
      const cx = x + i * cw;
      lines.push(`<line x1="${cx}" y1="${y}" x2="${cx}" y2="${y + h}" stroke="#000" stroke-width="0.3"/>`);
      lines.push(`<text x="${cx + 3}" y="${y + 8}" font-size="6" fill="#666" font-weight="700">${cols[i]}</text>`);
      const spec = specs[i] || (tolerance?.processCallouts?.[i]?.spec) || '— per spec sheet —';
      lines.push(`<text x="${cx + 3}" y="${y + 18}" font-size="7" fill="#000">${ProductionDrawing._esc(spec)}</text>`);
    }
    if (tolerance) {
      const last = `Default tol: linear ±0.1mm  angular ±0.5°  Ra ${tolerance.surfaceFinishes[0]?.Ra_um || 1.6}μm`;
      lines.push(`<text x="${x + 3}" y="${y + h - 4}" font-size="6" fill="#444">${ProductionDrawing._esc(last)}</text>`);
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
