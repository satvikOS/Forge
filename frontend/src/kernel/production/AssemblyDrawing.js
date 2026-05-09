/**
 * ArchDisc — Assembly-Level Drawing (Engine-level layout sheet)
 *
 * Produces a single sheet showing the overall assembly with:
 *   - Schematic side elevation showing all major sections
 *   - Station numbers (FAA/SAE ARP 755 convention)
 *   - Envelope dimensions (overall length, fan diameter, etc.)
 *   - Balloon-numbered components keyed to MBOM
 *   - Title block with assembly drawing number, rev, classification
 *
 * Used as the top-level deliverable in any engine submission folder.
 */

export default class AssemblyDrawing {

  /**
   * Build engine-level assembly drawing as SVG.
   *
   * @param {object} options
   *   project          'GE9X'
   *   title            'GE9X Engine Assembly'
   *   drawingNumber
   *   revision
   *   length_m, fanDia_m
   *   stations         [{ z_m, name, label }]
   *   sections         [{ z0_m, z1_m, color, label }]
   *   balloonItems     [{ ballonNo, partID, name, qty, x, y }]
   *   sheetSize        'A1', 'A2', 'A3'
   *   bom              MBOM lines for table
   * @returns {string} SVG markup
   */
  static build(options = {}) {
    const {
      project = 'PROJECT',
      title = 'Engine Assembly',
      drawingNumber = 'ASM-001',
      revision = 'A',
      length_m = 5.69, fanDia_m = 3.40,
      stations = AssemblyDrawing.GE9X_STATIONS(),
      sections = AssemblyDrawing.GE9X_SECTIONS(),
      balloonItems = [],
      sheetSize = 'A2',
      bom = [],
      classification = 'Class 1 ASSY',
      drawnBy = 'ArchDisc',
      approvedBy = '— pending QA —',
      date = new Date().toISOString().slice(0, 10),
    } = options;

    const SHEETS = { A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297] };
    const [sw, sh] = SHEETS[sheetSize] || SHEETS.A2;
    const margin = 12;

    // Layout: top header, main schematic in middle, BOM table on right,
    // process strip + title block at bottom
    const headerH = 22;
    const titleBlockW = 240;
    const titleBlockH = 90;
    const bomTableW = titleBlockW;
    const bomTableY = margin + headerH + 6;
    const bomTableH = sh - 2 * margin - headerH - titleBlockH - 12;

    // Schematic area (left of right column)
    const schemaX = margin + 4;
    const schemaY = margin + headerH + 8;
    const schemaW = sw - 2 * margin - titleBlockW - 12;
    const schemaH = sh - 2 * margin - headerH - 80;

    const out = [];
    out.push(`<?xml version="1.0" encoding="UTF-8"?>`);
    out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${sw} ${sh}" width="${sw}mm" height="${sh}mm" font-family="Helvetica, Arial, sans-serif">`);
    out.push(`<rect width="${sw}" height="${sh}" fill="#fff"/>`);
    out.push(`<rect x="${margin}" y="${margin}" width="${sw - 2 * margin}" height="${sh - 2 * margin}" fill="none" stroke="#000" stroke-width="0.6"/>`);

    // ---- Header banner ----
    out.push(`<rect x="${margin}" y="${margin}" width="${sw - 2 * margin}" height="${headerH}" fill="#1a1a2e"/>`);
    out.push(`<text x="${margin + 4}" y="${margin + headerH / 2 + 2}" font-size="5" fill="#fff" font-weight="700">${AssemblyDrawing._esc(project)} — ASSEMBLY DRAWING</text>`);
    out.push(`<text x="${sw / 2}" y="${margin + headerH / 2 + 2.5}" text-anchor="middle" font-size="6" fill="#fff" font-weight="700">${AssemblyDrawing._esc(title.toUpperCase())}</text>`);
    out.push(`<rect x="${sw - margin - 35}" y="${margin + 3}" width="33" height="${headerH - 6}" fill="#d94a4a"/>`);
    out.push(`<text x="${sw - margin - 18.5}" y="${margin + headerH / 2 + 2}" text-anchor="middle" font-size="3.5" fill="#000" font-weight="700">${AssemblyDrawing._esc(classification)}</text>`);

    // ---- Schematic side elevation ----
    out.push(AssemblyDrawing._renderSchematic(schemaX, schemaY, schemaW, schemaH, length_m, fanDia_m, sections, stations, balloonItems));

    // ---- BOM table ----
    const rightX = sw - margin - bomTableW;
    out.push(AssemblyDrawing._bomTable(bom, rightX, bomTableY, bomTableW, bomTableH));

    // ---- Title block ----
    const tbY = sh - margin - titleBlockH;
    out.push(AssemblyDrawing._titleBlock({
      x: rightX, y: tbY, w: titleBlockW, h: titleBlockH,
      partID: drawingNumber, drawingNumber, revision,
      title, project, scale: 'NTS', sheetSize, drawnBy, approvedBy, date,
    }));

    // ---- Notes strip at bottom under schematic ----
    const notesY = sh - margin - 60;
    out.push(`<rect x="${schemaX}" y="${notesY}" width="${schemaW}" height="56" fill="#fafafc" stroke="#000" stroke-width="0.3"/>`);
    out.push(`<text x="${schemaX + 3}" y="${notesY + 5}" font-size="2.5" fill="#666" font-weight="700">ASSEMBLY NOTES</text>`);
    const notes = [
      '1. Assembly sequence per AS 5180 modular build (LP module, HP core, accessories, nacelle, pylon).',
      '2. Match-balance fan rotor + LPT rotor as a coupled assembly per EM 72-30-00-700.',
      '3. Inspect all flange bolt-circle parallelism within 0.05 mm before final torque.',
      '4. Borescope ports per drawing must remain accessible after pylon-mate.',
      '5. Engine envelope dimensions are critical — verify against airframe interface drawing IFD-9X-001.',
      '6. All cycle-life-limited parts (LLP) are identified in the LLP table — track installation cycles per FAR 33.70.',
      '7. Match-mark all flanges before disassembly during MRO; drawing shows nominal phasing only.',
    ];
    let yc = notesY + 11;
    for (const n of notes) {
      out.push(`<text x="${schemaX + 3}" y="${yc}" font-size="2.4" fill="#000">${AssemblyDrawing._esc(n)}</text>`);
      yc += 4;
    }

    // ---- Bottom envelope dim strip ----
    const envY = sh - margin - 12;
    out.push(`<rect x="${margin}" y="${envY - 6}" width="${schemaW + 4}" height="14" fill="#1a1a2e"/>`);
    out.push(`<text x="${schemaX + 3}" y="${envY + 1}" font-size="3.2" fill="#fff" font-weight="700">ENGINE ENVELOPE</text>`);
    out.push(`<text x="${schemaX + 3}" y="${envY + 6}" font-size="2.6" fill="#fff">Length: ${length_m.toFixed(2)} m   ·   Fan Ø: ${fanDia_m.toFixed(2)} m   ·   Mass (dry): per published spec   ·   Application: Boeing 777X</text>`);

    out.push(`</svg>`);
    return out.join('\n');
  }

  // ----------------------------------------------------------------

  static _renderSchematic(x, y, w, h, length_m, fanDia_m, sections, stations, balloons) {
    const lines = [];
    // Use most of the area for the schematic, leave room above + below for labels
    const ah = h * 0.55;       // engine drawing height
    const ay = y + h * 0.20;   // top of engine drawing (room for top labels)
    const ax = x + 8;
    const aw = w - 16;
    const scale = aw / length_m;     // pixels per meter

    // Draw engine envelope as horizontal cylinder (front view) — engine
    // axis horizontal, fan on left
    const fanRpx = (fanDia_m / 2) * scale * 0.9;  // scale fan diameter to fit height
    const coreRpx = fanRpx * 0.30;                 // core diameter ~30% of fan

    const cyAxis = ay + ah / 2;

    // Draw section bands as colored rectangles
    for (const s of sections) {
      const x0 = ax + s.z0_m * scale;
      const x1 = ax + s.z1_m * scale;
      const isFan = s.label.toLowerCase().includes('fan');
      const isExhaust = s.label.toLowerCase().includes('exhaust');
      const top = isFan ? cyAxis - fanRpx : cyAxis - coreRpx;
      const bot = isFan ? cyAxis + fanRpx : cyAxis + coreRpx;
      lines.push(`<rect x="${x0}" y="${top}" width="${x1 - x0}" height="${bot - top}" fill="${s.color}" fill-opacity="0.55" stroke="#222" stroke-width="0.3"/>`);
      // Section label inside
      lines.push(`<text x="${(x0 + x1) / 2}" y="${cyAxis + 0.5}" text-anchor="middle" font-size="3" fill="#000" font-weight="700">${AssemblyDrawing._esc(s.label)}</text>`);
    }

    // Outer fan/nacelle silhouette (the wide part on the left)
    const fanEnd = sections.find(s => s.label.toLowerCase().includes('fan'))?.z1_m || 1.2;
    lines.push(`<line x1="${ax}" y1="${cyAxis - fanRpx}" x2="${ax + fanEnd * scale}" y2="${cyAxis - fanRpx}" stroke="#000" stroke-width="0.6"/>`);
    lines.push(`<line x1="${ax}" y1="${cyAxis + fanRpx}" x2="${ax + fanEnd * scale}" y2="${cyAxis + fanRpx}" stroke="#000" stroke-width="0.6"/>`);
    // Step from fan to core
    lines.push(`<line x1="${ax + fanEnd * scale}" y1="${cyAxis - fanRpx}" x2="${ax + fanEnd * scale}" y2="${cyAxis - coreRpx}" stroke="#000" stroke-width="0.4"/>`);
    lines.push(`<line x1="${ax + fanEnd * scale}" y1="${cyAxis + fanRpx}" x2="${ax + fanEnd * scale}" y2="${cyAxis + coreRpx}" stroke="#000" stroke-width="0.4"/>`);
    // Core outline to exhaust
    lines.push(`<line x1="${ax + fanEnd * scale}" y1="${cyAxis - coreRpx}" x2="${ax + length_m * scale}" y2="${cyAxis - coreRpx}" stroke="#000" stroke-width="0.6"/>`);
    lines.push(`<line x1="${ax + fanEnd * scale}" y1="${cyAxis + coreRpx}" x2="${ax + length_m * scale}" y2="${cyAxis + coreRpx}" stroke="#000" stroke-width="0.6"/>`);
    // Exhaust closure
    lines.push(`<line x1="${ax + length_m * scale}" y1="${cyAxis - coreRpx}" x2="${ax + length_m * scale}" y2="${cyAxis + coreRpx}" stroke="#000" stroke-width="0.6"/>`);
    // Inlet closure
    lines.push(`<line x1="${ax}" y1="${cyAxis - fanRpx}" x2="${ax}" y2="${cyAxis + fanRpx}" stroke="#000" stroke-width="0.6"/>`);
    // Centerline
    lines.push(`<line x1="${ax - 4}" y1="${cyAxis}" x2="${ax + length_m * scale + 4}" y2="${cyAxis}" stroke="#000" stroke-width="0.3" stroke-dasharray="2,1.5,0.4,1.5"/>`);

    // Station ticks above engine
    const tickY = ay - 6;
    for (const st of stations) {
      const sx = ax + st.z_m * scale;
      lines.push(`<line x1="${sx}" y1="${tickY}" x2="${sx}" y2="${cyAxis - (st.z_m < fanEnd ? fanRpx : coreRpx)}" stroke="#888" stroke-width="0.2" stroke-dasharray="1,1"/>`);
      lines.push(`<text x="${sx}" y="${tickY - 1}" text-anchor="middle" font-size="2.4" fill="#000" font-weight="700">${AssemblyDrawing._esc(st.name)}</text>`);
      lines.push(`<text x="${sx}" y="${tickY - 4}" text-anchor="middle" font-size="2" fill="#666">${AssemblyDrawing._esc(st.label)}</text>`);
    }

    // Overall length dimension below engine
    const dimY = cyAxis + fanRpx + 12;
    lines.push(`<line x1="${ax}" y1="${dimY}" x2="${ax + length_m * scale}" y2="${dimY}" stroke="#000" stroke-width="0.4"/>`);
    lines.push(`<line x1="${ax}" y1="${dimY - 2}" x2="${ax}" y2="${dimY + 2}" stroke="#000" stroke-width="0.4"/>`);
    lines.push(`<line x1="${ax + length_m * scale}" y1="${dimY - 2}" x2="${ax + length_m * scale}" y2="${dimY + 2}" stroke="#000" stroke-width="0.4"/>`);
    lines.push(`<text x="${ax + length_m * scale / 2}" y="${dimY + 4}" text-anchor="middle" font-size="3" fill="#000" font-weight="700">${(length_m * 1000).toFixed(0)} mm  /  ${length_m.toFixed(2)} m</text>`);

    // Fan diameter dimension at left
    lines.push(`<line x1="${ax - 8}" y1="${cyAxis - fanRpx}" x2="${ax - 8}" y2="${cyAxis + fanRpx}" stroke="#000" stroke-width="0.4"/>`);
    lines.push(`<line x1="${ax - 10}" y1="${cyAxis - fanRpx}" x2="${ax - 6}" y2="${cyAxis - fanRpx}" stroke="#000" stroke-width="0.4"/>`);
    lines.push(`<line x1="${ax - 10}" y1="${cyAxis + fanRpx}" x2="${ax - 6}" y2="${cyAxis + fanRpx}" stroke="#000" stroke-width="0.4"/>`);
    lines.push(`<text x="${ax - 12}" y="${cyAxis}" text-anchor="end" font-size="2.6" fill="#000" font-weight="700">Ø${(fanDia_m * 1000).toFixed(0)} mm</text>`);

    // Balloons keyed to BOM (top of engine)
    let balloonNo = 1;
    for (const b of balloons.slice(0, 12)) {
      const bx = ax + (b.z_m || 0) * scale;
      const by = cyAxis - fanRpx - 8;
      lines.push(`<line x1="${bx}" y1="${by}" x2="${bx}" y2="${cyAxis - fanRpx}" stroke="#666" stroke-width="0.3"/>`);
      lines.push(`<circle cx="${bx}" cy="${by}" r="3.2" fill="#fff" stroke="#000" stroke-width="0.4"/>`);
      lines.push(`<text x="${bx}" y="${by + 1}" text-anchor="middle" font-size="2.6" fill="#000" font-weight="700">${b.balloonNo || balloonNo}</text>`);
      balloonNo++;
    }

    return lines.join('\n');
  }

  static _bomTable(bom, x, y, w, h) {
    const headerH = 5;
    const lineH = 3.5;
    const lines = [
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#000" stroke-width="0.4"/>`,
      `<rect x="${x}" y="${y}" width="${w}" height="${headerH}" fill="#1a1a2e"/>`,
      `<text x="${x + 2}" y="${y + headerH - 1.4}" font-size="2.5" fill="#fff" font-weight="700">BILL OF MATERIALS (top by qty)</text>`,
    ];
    // Column header strip
    const colHeaderY = y + headerH + 4;
    lines.push(`<text x="${x + 2}" y="${colHeaderY}" font-size="2.2" fill="#666" font-weight="700">#</text>`);
    lines.push(`<text x="${x + 8}" y="${colHeaderY}" font-size="2.2" fill="#666" font-weight="700">PART</text>`);
    lines.push(`<text x="${x + w * 0.50}" y="${colHeaderY}" font-size="2.2" fill="#666" font-weight="700">CAT</text>`);
    lines.push(`<text x="${x + w * 0.62}" y="${colHeaderY}" font-size="2.2" fill="#666" font-weight="700">MAT</text>`);
    lines.push(`<text x="${x + w * 0.86}" y="${colHeaderY}" font-size="2.2" fill="#666" font-weight="700">QTY</text>`);
    lines.push(`<line x1="${x + 1}" y1="${colHeaderY + 1}" x2="${x + w - 1}" y2="${colHeaderY + 1}" stroke="#888" stroke-width="0.2"/>`);

    const maxLines = Math.floor((h - headerH - 5) / lineH);
    let yc = colHeaderY + 5;
    const truncate = (text, w_, fs) => {
      const max = Math.max(1, Math.floor((w_ - 2) / (fs * 0.55)));
      return String(text || '').length > max ? String(text).slice(0, max - 1) + '…' : (text || '');
    };
    for (let i = 0; i < bom.length && i < maxLines; i++) {
      const item = bom[i];
      lines.push(`<text x="${x + 2}" y="${yc}" font-size="2.2" fill="#000">${item.item}</text>`);
      lines.push(`<text x="${x + 8}" y="${yc}" font-size="2.2" fill="#000">${AssemblyDrawing._esc(truncate(item.name, w * 0.42 - 8, 2.2))}</text>`);
      lines.push(`<text x="${x + w * 0.50}" y="${yc}" font-size="2.2" fill="#000">${AssemblyDrawing._esc(item.category || '')}</text>`);
      lines.push(`<text x="${x + w * 0.62}" y="${yc}" font-size="2.2" fill="#000">${AssemblyDrawing._esc(truncate(item.material, w * 0.22, 2.2))}</text>`);
      lines.push(`<text x="${x + w * 0.86}" y="${yc}" font-size="2.2" fill="#000" font-weight="700">${item.quantity || item.qty || '?'}</text>`);
      yc += lineH;
    }
    if (bom.length > maxLines) {
      lines.push(`<text x="${x + 2}" y="${y + h - 2}" font-size="2" fill="#888">… +${bom.length - maxLines} more entries — see MBOM.csv for full list</text>`);
    }
    return lines.join('\n');
  }

  static _titleBlock(opts) {
    // Reuse same format as ProductionDrawing — 6 rows × 14mm
    const { x, y, w, h, partID, drawingNumber, revision, title, scale, sheetSize, drawnBy, approvedBy, date, project } = opts;
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
      return `<text x="${xp}" y="${yp}" font-size="${fs}" fill="${fc}" ${fw} ${ta}>${AssemblyDrawing._esc(safe)}</text>`;
    };

    const cellPair = (rowI, l1, v1, l2, v2, opts2 = {}) => {
      const ry = y + rowI * rowH;
      const labelFS = 2.0, valueFS = opts2.valueFS || 3.0;
      const labelY = ry + labelFS + 1.5;
      const valueY = ry + rowH - 1.5;
      return [
        text(x + 2,             labelY, l1,  labelFS, { color: '#666' }),
        text(x + 2,             valueY, v1,  valueFS, { bold: opts2.boldLeft, maxW: colSplit - 4 }),
        text(x + colSplit + 2,  labelY, l2,  labelFS, { color: '#666' }),
        text(x + colSplit + 2,  valueY, v2,  valueFS, { bold: opts2.boldRight, maxW: w - colSplit - 4 }),
      ].join('\n');
    };

    const lines = [`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="#000" stroke-width="0.6"/>`];
    for (let i = 1; i < rowCount; i++) lines.push(`<line x1="${x}" y1="${y + i * rowH}" x2="${x + w}" y2="${y + i * rowH}" stroke="#000" stroke-width="0.3"/>`);
    for (const ri of [0, 1, 2, 3, 4]) lines.push(`<line x1="${x + colSplit}" y1="${y + ri * rowH}" x2="${x + colSplit}" y2="${y + (ri + 1) * rowH}" stroke="#000" stroke-width="0.3"/>`);

    lines.push(cellPair(0, 'PROJECT', project, 'DRAWING NO.', drawingNumber, { boldLeft: true, boldRight: true }));
    lines.push(cellPair(1, 'TITLE', title, 'REV', revision, { boldRight: true, valueFS: 4 }));
    lines.push(cellPair(2, 'SCALE', scale, 'SHEET / SIZE', `1 of 1 / ${sheetSize}`));
    lines.push(cellPair(3, 'DRAWN BY', drawnBy, 'DATE', date));
    lines.push(cellPair(4, 'APPROVED BY', approvedBy, 'CLASS', 'Top-Level ASSY'));
    {
      const ry = y + 5 * rowH;
      lines.push(text(x + w / 2, ry + rowH * 0.50, 'PROPRIETARY — REPRODUCTION FORBIDDEN', 2.0, { color: '#666', center: true, maxW: w - 4 }));
      lines.push(text(x + w / 2, ry + rowH * 0.85, 'Per ASME Y14.5-2018 / ISO 1101', 2.0, { color: '#666', center: true, maxW: w - 4 }));
    }
    return `<g class="title-block">${lines.join('\n')}</g>`;
  }

  // ----------------------------------------------------------------
  // Static engine data templates
  // ----------------------------------------------------------------

  /** GE9X engine stations (FAA/SAE ARP 755) with z-positions in m. */
  static GE9X_STATIONS() {
    return [
      { z_m: 0.00,  name: '0',   label: 'Inlet' },
      { z_m: 0.40,  name: '2',   label: 'Fan inlet' },
      { z_m: 1.10,  name: '13',  label: 'Fan exit / bypass' },
      { z_m: 1.85,  name: '2.5', label: 'LPC exit' },
      { z_m: 3.10,  name: '3',   label: 'HPC exit' },
      { z_m: 3.50,  name: '4',   label: 'Combustor exit (TIT)' },
      { z_m: 4.10,  name: '4.95', label: 'HPT exit' },
      { z_m: 5.20,  name: '5',   label: 'LPT exit (EGT)' },
      { z_m: 5.69,  name: '7',   label: 'Nozzle exit' },
    ];
  }

  /** GE9X color-coded sections matching MarketingCutaway. */
  static GE9X_SECTIONS() {
    return [
      { z0_m: -0.30, z1_m: 0.40, color: '#6e7caf', label: 'Inlet' },
      { z0_m: 0.40,  z1_m: 1.10, color: '#4a90d9', label: 'Fan' },
      { z0_m: 1.10,  z1_m: 1.85, color: '#4ed99d', label: 'Booster (LPC)' },
      { z0_m: 1.85,  z1_m: 3.10, color: '#d9a04a', label: 'HPC' },
      { z0_m: 3.10,  z1_m: 3.50, color: '#d94a4a', label: 'Combustor' },
      { z0_m: 3.50,  z1_m: 4.10, color: '#d9c84a', label: 'HPT' },
      { z0_m: 4.10,  z1_m: 5.20, color: '#4ad9c8', label: 'LPT' },
      { z0_m: 5.20,  z1_m: 5.69, color: '#707080', label: 'Exhaust' },
    ];
  }

  static _esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
}
