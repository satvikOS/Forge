// Forge-136 — Title block templates (ISO 5457 · ANSI Y14.1 · JIS Z 8311).
//
// All dimensions are in millimetres. Paper sizes follow the published
// standard:
//
//   ISO 5457  (ISO 216 paper, drawing-format margins):
//     A0  1189 × 841
//     A1   841 × 594
//     A2   594 × 420
//     A3   420 × 297
//     A4   297 × 210      (landscape default)
//     margins: 20 mm bound edge, 10 mm on the other three for A0–A2;
//              10 mm bound, 10 mm rest for A3–A4. ISO 5457 §5.2.
//
//   ANSI Y14.1 (Inch paper, converted to mm with 1 in = 25.4 mm):
//     A   8.5 × 11    →  215.9  × 279.4
//     B  11   × 17    →  279.4  × 431.8
//     C  17   × 22    →  431.8  × 558.8
//     D  22   × 34    →  558.8  × 863.6
//     E  34   × 44    →  863.6  × 1117.6
//     margins per Y14.1 §3.2: 0.5 in (12.7 mm) borders on A/B,
//              0.75 in (19.05 mm) on C/D/E, 1.0 in (25.4 mm) binding edge
//              when the bound flag is asserted.
//
//   JIS Z 8311 (Japanese standard — paper = ISO 216 + JIS title block):
//     identical paper sizes to ISO 5457; the title block is anchored
//     bottom-right, 170 × 56 mm with the standard six-row layout
//     (Title / Drawn / Scale / Project / Material / Sheet).
//
// Each template defines:
//   {
//     id, label, std, paper: { w, h, orientation, units },
//     borders: { left, right, top, bottom },          // mm
//     titleBlock: { x, y, w, h, layout: [...rows] },  // mm — sheet space
//     dimStyleId,
//   }
//
// `titleBlock.layout` is a list of rows; each row has cells:
//   { key, label, w, value? }
// keyed by the same field names DrawingsWorkbench already uses
// (project / drawnBy / date / sheet / scale / units / std / material).
//
// The DrawingsWorkbench picker reads this catalogue, lets the user
// select a template, then re-emits the drawing sheet with the chosen
// paper / borders / title block layout.

import { DEFAULT_DIM_STYLE_ID } from './dimStyleLibrary.js';

const INCH = 25.4;

// ───────────────────────── helpers ──────────────────────────────────

function blockRows(spec) {
  // Validate that the layout rows total exactly the title-block width.
  for (const row of spec.titleBlock.layout) {
    const sum = row.cells.reduce((a, c) => a + c.w, 0);
    if (Math.abs(sum - spec.titleBlock.w) > 0.01) {
      throw new Error(
        `Title block layout row width ${sum} ≠ block width ${spec.titleBlock.w} ` +
        `(template ${spec.id})`,
      );
    }
  }
  return spec;
}

// ───────────────────────── ISO 5457 layouts ─────────────────────────
//
// Standard ISO title block is 180 × 56 mm, anchored to the bottom-right
// inside the drawing frame. The 180 mm width breaks into 7 cells in
// row 1 (Doc num, Title, ...) and the layout per ISO 7200. We use a
// pragmatic six-row variant that matches what CAD packages ship.

function isoTitleBlock(paperW, paperH, bordersLR, bordersTB) {
  const blockW = 180;
  const blockH = 56;
  return {
    x: paperW - bordersLR.right - blockW,
    y: paperH - bordersTB.bottom - blockH,
    w: blockW, h: blockH,
    layout: [
      { h: 8, cells: [
        { key: 'project', label: 'PROJECT', w: 90 },
        { key: 'drawnBy', label: 'DRAWN BY', w: 45 },
        { key: 'date',    label: 'DATE',     w: 45 },
      ]},
      { h: 8, cells: [
        { key: 'title',   label: 'TITLE', w: 180 },
      ]},
      { h: 8, cells: [
        { key: 'material',label: 'MATERIAL', w: 90 },
        { key: 'finish',  label: 'FINISH',   w: 45 },
        { key: 'mass',    label: 'MASS',     w: 45 },
      ]},
      { h: 8, cells: [
        { key: 'docnum',  label: 'DOC NO', w: 60 },
        { key: 'rev',     label: 'REV',    w: 30 },
        { key: 'scale',   label: 'SCALE',  w: 45 },
        { key: 'sheet',   label: 'SHEET',  w: 45 },
      ]},
      { h: 8, cells: [
        { key: 'tol',     label: 'GENERAL TOL', w: 90 },
        { key: 'projection', label: 'PROJECTION (E)', w: 45 },
        { key: 'std',     label: 'ISO 5457', w: 45 },
      ]},
      { h: 16, cells: [
        { key: 'company', label: 'COMPANY', w: 180 },
      ]},
    ],
  };
}

function makeIso(id, label, w, h, leftBorderMm) {
  const borders = {
    left:   leftBorderMm,
    right:  10,
    top:    10,
    bottom: 10,
  };
  return blockRows({
    id, label, std: 'ISO 5457',
    paper: { w, h, orientation: 'landscape', units: 'mm' },
    borders: {
      left:  borders.left,
      right: borders.right,
      top:   borders.top,
      bottom: borders.bottom,
    },
    titleBlock: isoTitleBlock(w, h, { right: borders.right }, { bottom: borders.bottom }),
    dimStyleId: 'iso-129',
  });
}

// ───────────────────────── ANSI Y14.1 layouts ────────────────────────
//
// ANSI title block (Y14.1 §3.3.1) is 6.5 in (165.1 mm) wide × 1.875 in
// (47.625 mm) tall on size A/B, with optional revision block above.
// On size C/D/E it grows to 8 × 2.5 in (203.2 × 63.5 mm).

function ansiTitleBlock(paperW, paperH, blockW, blockH, bordersLR, bordersTB) {
  return {
    x: paperW - bordersLR.right - blockW,
    y: paperH - bordersTB.bottom - blockH,
    w: blockW, h: blockH,
    layout: [
      { h: blockH / 3, cells: [
        { key: 'company', label: 'COMPANY',  w: blockW * 0.45 },
        { key: 'title',   label: 'TITLE',    w: blockW * 0.55 },
      ]},
      { h: blockH / 3, cells: [
        { key: 'drawnBy', label: 'DRAWN', w: blockW * 0.18 },
        { key: 'checked', label: 'CHK',   w: blockW * 0.12 },
        { key: 'approved',label: 'APP',   w: blockW * 0.15 },
        { key: 'date',    label: 'DATE',  w: blockW * 0.18 },
        { key: 'cage',    label: 'CAGE',  w: blockW * 0.12 },
        { key: 'docnum',  label: 'DWG NO',w: blockW * 0.25 },
      ]},
      { h: blockH / 3, cells: [
        { key: 'std',     label: 'ASME Y14.5', w: blockW * 0.30 },
        { key: 'projection', label: 'PROJECTION (T)', w: blockW * 0.18 },
        { key: 'scale',   label: 'SCALE', w: blockW * 0.18 },
        { key: 'weight',  label: 'WEIGHT', w: blockW * 0.15 },
        { key: 'sheet',   label: 'SHEET', w: blockW * 0.19 },
      ]},
    ],
  };
}

function makeAnsi(id, label, wIn, hIn, big) {
  const w = wIn * INCH;
  const h = hIn * INCH;
  const borderIn = big ? 0.75 : 0.5;
  const bindEdgeIn = 1.0;
  const borders = {
    left:   bindEdgeIn * INCH,
    right:  borderIn  * INCH,
    top:    borderIn  * INCH,
    bottom: borderIn  * INCH,
  };
  const blockW = (big ? 8.0 : 6.5) * INCH;
  const blockH = (big ? 2.5 : 1.875) * INCH;
  return blockRows({
    id, label, std: 'ANSI Y14.1',
    paper: { w, h, orientation: 'landscape', units: 'mm' },
    borders,
    titleBlock: ansiTitleBlock(w, h, blockW, blockH,
                               { right: borders.right }, { bottom: borders.bottom }),
    dimStyleId: 'asme-y14-5',
  });
}

// ───────────────────────── JIS Z 8311 layouts ────────────────────────
//
// JIS uses ISO 216 paper and a 170 × 56 mm title block. Layout per
// JIS Z 8311 §6: six rows, fields = (Project / Title / Material) /
// (Drawn-by / Checked / Approved / Date) / (Sheet / Scale / Doc no).

function jisTitleBlock(paperW, paperH, bordersLR, bordersTB) {
  const blockW = 170;
  const blockH = 56;
  return {
    x: paperW - bordersLR.right - blockW,
    y: paperH - bordersTB.bottom - blockH,
    w: blockW, h: blockH,
    layout: [
      { h: 8, cells: [
        { key: 'project', label: 'PROJECT', w: 100 },
        { key: 'docnum',  label: 'DOC NO',  w: 70 },
      ]},
      { h: 8, cells: [
        { key: 'title',   label: 'TITLE', w: 170 },
      ]},
      { h: 8, cells: [
        { key: 'material',label: 'MATERIAL', w: 100 },
        { key: 'finish',  label: 'FINISH',   w: 70 },
      ]},
      { h: 8, cells: [
        { key: 'drawnBy', label: 'DRAWN',   w: 50 },
        { key: 'checked', label: 'CHECKED', w: 50 },
        { key: 'approved',label: 'APPROVED',w: 70 },
      ]},
      { h: 8, cells: [
        { key: 'date',    label: 'DATE',  w: 60 },
        { key: 'scale',   label: 'SCALE', w: 50 },
        { key: 'sheet',   label: 'SHEET', w: 60 },
      ]},
      { h: 16, cells: [
        { key: 'company', label: 'COMPANY · JIS Z 8311', w: 170 },
      ]},
    ],
  };
}

function makeJis(id, label, w, h, leftBorderMm) {
  const borders = {
    left:   leftBorderMm,
    right:  10,
    top:    10,
    bottom: 10,
  };
  return blockRows({
    id, label, std: 'JIS Z 8311',
    paper: { w, h, orientation: 'landscape', units: 'mm' },
    borders,
    titleBlock: jisTitleBlock(w, h, { right: borders.right }, { bottom: borders.bottom }),
    dimStyleId: 'jis-z-8317',
  });
}

// ───────────────────────── catalogue ─────────────────────────────────
//
// 12 templates total, indexed by id. (ISO supplies 5, ANSI 5, JIS 2 —
// 12 distinct id rows mirror the deliverable's "12 real templates"
// brief. Pull more JIS sizes if needed by extending the array.)

export const TITLE_BLOCK_TEMPLATES = Object.freeze([
  makeIso('iso-a0', 'ISO 5457 · A0', 1189, 841, 20),
  makeIso('iso-a1', 'ISO 5457 · A1',  841, 594, 20),
  makeIso('iso-a2', 'ISO 5457 · A2',  594, 420, 20),
  makeIso('iso-a3', 'ISO 5457 · A3',  420, 297, 10),
  makeIso('iso-a4', 'ISO 5457 · A4',  297, 210, 10),
  makeAnsi('ansi-a', 'ANSI Y14.1 · A',  11,    8.5,  false),
  makeAnsi('ansi-b', 'ANSI Y14.1 · B',  17,   11,    false),
  makeAnsi('ansi-c', 'ANSI Y14.1 · C',  22,   17,    true),
  makeAnsi('ansi-d', 'ANSI Y14.1 · D',  34,   22,    true),
  makeAnsi('ansi-e', 'ANSI Y14.1 · E',  44,   34,    true),
  makeJis('jis-a3', 'JIS Z 8311 · A3', 420, 297, 10),
  makeJis('jis-a4', 'JIS Z 8311 · A4', 297, 210, 10),
]);

export const TITLE_BLOCK_COUNT = TITLE_BLOCK_TEMPLATES.length;

export const DEFAULT_TITLE_BLOCK_ID = 'iso-a4';

/** Look up a template by id. Returns undefined if not found. */
export function getTemplate(id) {
  return TITLE_BLOCK_TEMPLATES.find((t) => t.id === id);
}

/** Filter templates by published standard. */
export function templatesForStd(std) {
  return TITLE_BLOCK_TEMPLATES.filter((t) => t.std === std);
}

/** All three standards covered by this library. */
export const TITLE_BLOCK_STANDARDS = Object.freeze(['ISO 5457', 'ANSI Y14.1', 'JIS Z 8311']);

// Export the default dim-style id so callers don't have to know the
// dim-style library exists when they're only after the title block.
export { DEFAULT_DIM_STYLE_ID };
