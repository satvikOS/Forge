/**
 * ArchDisc Forge — Title Block templates (Forge-32)
 *
 * 10 ready-to-stamp title block templates: 5 ISO (A4, A3, A2, A1, A0) +
 * 5 ANSI (A, B, C, D, E). Each template is a function that returns an
 * SVG fragment positioned in the bottom-right corner of the sheet in
 * sheet-mm coordinates. Placeholders are filled in from the `fields`
 * record at apply time. Unknown fields render as "—" so an
 * uncustomised drawing still produces a publishable sheet.
 *
 * The contract is:
 *
 *   applyTitleBlock(svgDoc:string, template:string, fields:object)
 *     → svgDoc:string
 *
 * `svgDoc` is the SVG that ForgeDrawing.toSvg() emits *without* its
 * built-in 80×40 stub title block. We splice our fragment in just
 * before `</svg>`, on top of the sheet border.
 *
 * The fragments are intentionally pure-SVG (no <foreignObject>, no CSS)
 * so they survive round-tripping through Inkscape / Illustrator and
 * print cleanly on real DWG plotters.
 *
 * Field schema (all string|number|null):
 *   drawingNumber, title, scale, drawnBy, checkedBy, approvedBy,
 *   date, sheet ("N / M"), material, finish, weight, revision,
 *   project, company
 */

// ----------------------------------------------------------- field helpers

const FIELD_KEYS = Object.freeze([
  'drawingNumber', 'title', 'scale', 'drawnBy', 'checkedBy',
  'approvedBy', 'date', 'sheet', 'material', 'finish',
  'weight', 'revision', 'project', 'company',
]);

function blank(v) {
  if (v == null) return '—';
  const s = String(v).trim();
  return s.length === 0 ? '—' : s;
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

function txt(x, y, value, opts = {}) {
  const size  = opts.size  ?? 3.0;
  const anchor = opts.anchor ?? 'start';
  const weight = opts.weight ?? 'normal';
  return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" ` +
    `font-family="Helvetica, Arial, sans-serif" ` +
    `font-size="${size}" font-weight="${weight}" ` +
    `fill="#000" text-anchor="${anchor}">${escapeXml(blank(value))}</text>`;
}

function rect(x, y, w, h, sw = 0.4) {
  return `<rect x="${x.toFixed(2)}" y="${y.toFixed(2)}" ` +
    `width="${w.toFixed(2)}" height="${h.toFixed(2)}" ` +
    `fill="#fff" stroke="#000" stroke-width="${sw}"/>`;
}

function line(x0, y0, x1, y1, sw = 0.3) {
  return `<line x1="${x0.toFixed(2)}" y1="${y0.toFixed(2)}" ` +
    `x2="${x1.toFixed(2)}" y2="${y1.toFixed(2)}" stroke="#000" stroke-width="${sw}"/>`;
}

// ----------------------------------------------------------- one template
//
// Every template is parameterised by the bottom-right corner location
// (`bx`, `by` — the sheet's bottom-right in mm) and the title-block size.
// The fragment lives in sheet-mm coords. Each template carves the block
// into a labelled grid; the labels above each cell ("DRAWN BY", etc) are
// rendered in 1.8 mm sans-serif, the values in 3.0 mm.

function renderGrid(bx, by, W, H, fields) {
  // Reusable 4-row × 4-col grid template — works for every ISO/ANSI size,
  // just scaled. Rows from bottom: drawingNumber line (12 mm),
  // signatures (12 mm), material/finish/weight (8 mm), title/project (rest).
  const x0 = bx - W;
  const y0 = by - H;
  let s = '';
  s += rect(x0, y0, W, H, 0.5);

  // Outer column proportions
  const col1 = W * 0.40;   // title / project / company
  const col2 = W * 0.20;   // material / finish / weight
  const col3 = W * 0.20;   // drawn / checked / approved
  // const col4 = W - col1 - col2 - col3;   // drawing-number block (right-most)
  const xCol1 = x0;
  const xCol2 = x0 + col1;
  const xCol3 = x0 + col1 + col2;
  const xCol4 = x0 + col1 + col2 + col3;

  // Internal rules
  s += line(xCol2, y0,            xCol2, y0 + H);
  s += line(xCol3, y0,            xCol3, y0 + H);
  s += line(xCol4, y0,            xCol4, y0 + H);

  // Horizontal rules carving rows
  const rowH = H / 4;
  for (let i = 1; i < 4; i++) {
    s += line(x0, y0 + i * rowH, x0 + W, y0 + i * rowH);
  }

  // -------- Column 1: TITLE / PROJECT / COMPANY / DRG-NO -------------
  // Row 0 (top)   : company name (big)
  // Row 1         : project
  // Row 2         : title (the drawing title — biggest)
  // Row 3 (bottom): "DRG NO: <drawingNumber>"
  const lbl = (x, y, text) => `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" ` +
    `font-family="Helvetica, Arial, sans-serif" font-size="1.8" ` +
    `fill="#444">${escapeXml(text)}</text>`;
  s += lbl(xCol1 + 1.0, y0 + 2.0,        'COMPANY');
  s += txt(xCol1 + 1.0, y0 + rowH - 1.5, fields.company, { size: 3.4, weight: 'bold' });

  s += lbl(xCol1 + 1.0, y0 + rowH + 2.0,        'PROJECT');
  s += txt(xCol1 + 1.0, y0 + 2 * rowH - 1.5,    fields.project, { size: 3.0 });

  s += lbl(xCol1 + 1.0, y0 + 2 * rowH + 2.0,    'TITLE');
  s += txt(xCol1 + 1.0, y0 + 3 * rowH - 1.5,    fields.title, { size: 3.6, weight: 'bold' });

  s += lbl(xCol1 + 1.0, y0 + 3 * rowH + 2.0,    'DRG NO');
  s += txt(xCol1 + 1.0, y0 + 4 * rowH - 1.5,    fields.drawingNumber, { size: 3.4, weight: 'bold' });

  // -------- Column 2: MATERIAL / FINISH / WEIGHT / SCALE -------------
  s += lbl(xCol2 + 1.0, y0 + 2.0,        'MATERIAL');
  s += txt(xCol2 + 1.0, y0 + rowH - 1.5, fields.material, { size: 2.8 });

  s += lbl(xCol2 + 1.0, y0 + rowH + 2.0,        'FINISH');
  s += txt(xCol2 + 1.0, y0 + 2 * rowH - 1.5,    fields.finish, { size: 2.8 });

  s += lbl(xCol2 + 1.0, y0 + 2 * rowH + 2.0,    'WEIGHT');
  s += txt(xCol2 + 1.0, y0 + 3 * rowH - 1.5,    fields.weight, { size: 2.8 });

  s += lbl(xCol2 + 1.0, y0 + 3 * rowH + 2.0,    'SCALE');
  s += txt(xCol2 + 1.0, y0 + 4 * rowH - 1.5,    fields.scale, { size: 3.0, weight: 'bold' });

  // -------- Column 3: DRAWN / CHECKED / APPROVED / SHEET -------------
  s += lbl(xCol3 + 1.0, y0 + 2.0,        'DRAWN BY');
  s += txt(xCol3 + 1.0, y0 + rowH - 1.5, fields.drawnBy, { size: 2.8 });

  s += lbl(xCol3 + 1.0, y0 + rowH + 2.0,        'CHECKED BY');
  s += txt(xCol3 + 1.0, y0 + 2 * rowH - 1.5,    fields.checkedBy, { size: 2.8 });

  s += lbl(xCol3 + 1.0, y0 + 2 * rowH + 2.0,    'APPROVED BY');
  s += txt(xCol3 + 1.0, y0 + 3 * rowH - 1.5,    fields.approvedBy, { size: 2.8 });

  s += lbl(xCol3 + 1.0, y0 + 3 * rowH + 2.0,    'SHEET');
  s += txt(xCol3 + 1.0, y0 + 4 * rowH - 1.5,    fields.sheet, { size: 3.0 });

  // -------- Column 4: DATE / REV ------------------------------------
  s += lbl(xCol4 + 1.0, y0 + 2.0,        'DATE');
  s += txt(xCol4 + 1.0, y0 + rowH - 1.5, fields.date, { size: 2.8 });

  s += lbl(xCol4 + 1.0, y0 + rowH + 2.0,        'REVISION');
  s += txt(xCol4 + 1.0, y0 + 2 * rowH - 1.5,    fields.revision, { size: 3.0, weight: 'bold' });

  // Stamp area (free space in bottom-right cells).
  s += lbl(xCol4 + 1.0, y0 + 2 * rowH + 2.0, 'STAMP');

  return s;
}

// ----------------------------------------------------------- registry
//
// Each TEMPLATES[name] is { sheetSize, w, h, render(fields, sheet) }.
// w/h are the title-block dimensions; ISO sheets get a wider block,
// small sheets (A4 / ANSI A) get a compact one.

const T = (sheetSize, w, h) => ({
  sheetSize,
  w,
  h,
  render(fields, sheet) {
    // bx/by = bottom-right of sheet in mm, minus a 5 mm border.
    const bx = sheet.w - 5;
    const by = sheet.h - 5;
    return `<g data-label="title-block" data-template="${sheetSize}">${
      renderGrid(bx, by, w, h, fields)
    }</g>`;
  },
});

export const TEMPLATES = Object.freeze({
  // ISO 216 portrait→landscape. Title block scales with the sheet's
  // long edge so it stays roughly proportional.
  A4: T('A4', 180, 40),
  A3: T('A3', 200, 45),
  A2: T('A2', 220, 50),
  A1: T('A1', 240, 55),
  A0: T('A0', 280, 60),
  // ANSI Y14.1
  A:  T('A',  170, 38),
  B:  T('B',  200, 42),
  C:  T('C',  220, 48),
  D:  T('D',  240, 52),
  E:  T('E',  280, 60),
});

// ----------------------------------------------------------- pluggable apply
//
// Splice the requested title block on top of a freshly-rendered SVG.
// We rely on the SVG containing a recognisable trailer `</svg>` — we
// inject our `<g>` right before it. If the SVG already contains a
// `data-label="title-block"` group from the built-in stub renderer,
// we strip that first.

export function applyTitleBlock(svgDoc, templateName, fields) {
  const tmpl = TEMPLATES[templateName];
  if (!tmpl) {
    throw new Error(`[forge.drawings] unknown title-block template '${templateName}'`);
  }
  // Strip built-in stub group (if present).
  let s = svgDoc.replace(
    /<g data-label="title-block"[\s\S]*?<\/g>/g,
    '',
  );

  // Pull viewBox to know sheet w/h.
  const m = /viewBox="0 0 ([0-9.]+) ([0-9.]+)"/.exec(s);
  if (!m) {
    throw new Error('[forge.drawings] could not find viewBox in svgDoc — is this a ForgeDrawing SVG?');
  }
  const sheet = { w: Number(m[1]), h: Number(m[2]) };

  // Normalise fields against the schema with sensible defaults.
  const normalised = {};
  for (const k of FIELD_KEYS) normalised[k] = fields ? fields[k] : null;
  if (!normalised.date) normalised.date = new Date().toISOString().slice(0, 10);
  if (!normalised.sheet) normalised.sheet = '1 / 1';
  if (!normalised.scale) normalised.scale = '1:1';
  if (!normalised.revision) normalised.revision = 'A';

  const frag = tmpl.render(normalised, sheet);
  s = s.replace('</svg>', `${frag}</svg>`);
  return s;
}

export const TITLE_BLOCK_FIELDS = FIELD_KEYS;

export default {
  TEMPLATES,
  TITLE_BLOCK_FIELDS,
  applyTitleBlock,
};
