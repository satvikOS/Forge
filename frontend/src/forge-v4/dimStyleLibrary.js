// Forge-136 — Dimension style library (ISO 129 · ASME Y14.5 · JIS Z 8317).
//
// Six pre-baked dimension styles drawn from the three engineering
// drawing standards in common production use. Each style is a plain
// object the DimensionTool and ordinate / leader components read at
// render time to lay out arrows, text, gaps, tolerances.
//
// Style shape:
//   {
//     id, label, std,
//     arrow: { style, length, width, fill },
//     text:  { height, font, decimals },
//     leader: { offset, gap, jogLength },
//     tolerance: { default: { plus, minus }, displayMode },
//     gap, extension,                       // extension-line geometry
//   }
//
// arrow.style ∈ { 'filled', 'open', 'oblique' }
// tolerance.displayMode ∈ { 'symmetric', 'bilateral', 'limit', 'none' }
//
// Units are millimetres for everything except text height, which is
// measured in mm (per ISO 3098 the text height is also mm).
//
// Default lookup: ISO 129 — the workshop default referenced by ISO 5457
// drawings.

const ISO_ARROW_FILLED = Object.freeze({
  style: 'filled', length: 3.5, width: 1.2, fill: true,
});
const ANSI_ARROW_FILLED = Object.freeze({
  style: 'filled', length: 3.0, width: 1.0, fill: true,
});
const ISO_ARROW_OPEN = Object.freeze({
  style: 'open', length: 3.5, width: 1.2, fill: false,
});
const JIS_ARROW_FILLED = Object.freeze({
  style: 'filled', length: 3.0, width: 1.0, fill: true,
});
const OBLIQUE = Object.freeze({
  style: 'oblique', length: 3.0, width: 0.6, fill: false,
});

export const DIM_STYLES = Object.freeze([
  // ──────────────────────── ISO 129-1 standard ─────────────────────
  Object.freeze({
    id:        'iso-129',
    label:     'ISO 129-1 · Standard',
    std:       'ISO 129',
    arrow:     ISO_ARROW_FILLED,
    text:      { height: 3.5, font: 'ISO 3098', decimals: 2 },
    leader:    { offset: 2, gap: 1, jogLength: 6 },
    tolerance: { default: { plus: 0.1, minus: 0.1 }, displayMode: 'bilateral' },
    gap:        1,    // gap between feature and extension-line start
    extension:  2,    // overshoot past the dim-line
  }),
  // ──────────────────────── ISO 129 · Architectural ─────────────────
  Object.freeze({
    id:        'iso-129-arch',
    label:     'ISO 129 · Architectural',
    std:       'ISO 129',
    arrow:     OBLIQUE,
    text:      { height: 2.5, font: 'ISO 3098', decimals: 0 },
    leader:    { offset: 1.5, gap: 0.8, jogLength: 5 },
    tolerance: { default: { plus: 0, minus: 0 }, displayMode: 'none' },
    gap:        1.0,
    extension:  2.0,
  }),
  // ──────────────────────── ASME Y14.5 (inch) ──────────────────────
  Object.freeze({
    id:        'asme-y14-5',
    label:     'ASME Y14.5 · Decimal Inch',
    std:       'ASME Y14.5',
    arrow:     ANSI_ARROW_FILLED,
    text:      { height: 3.0, font: 'Gothic', decimals: 3 },
    leader:    { offset: 1.5, gap: 0.8, jogLength: 5 },
    tolerance: { default: { plus: 0.005, minus: 0.005 }, displayMode: 'bilateral' },
    gap:        0.8,
    extension:  1.5,
  }),
  // ──────────────────────── ASME Y14.5 · Metric ────────────────────
  Object.freeze({
    id:        'asme-y14-5-metric',
    label:     'ASME Y14.5 · Metric',
    std:       'ASME Y14.5',
    arrow:     ANSI_ARROW_FILLED,
    text:      { height: 3.5, font: 'Gothic', decimals: 2 },
    leader:    { offset: 1.5, gap: 0.8, jogLength: 6 },
    tolerance: { default: { plus: 0.1, minus: 0.1 }, displayMode: 'symmetric' },
    gap:        1.0,
    extension:  2.0,
  }),
  // ──────────────────────── JIS Z 8317 (general) ────────────────────
  Object.freeze({
    id:        'jis-z-8317',
    label:     'JIS Z 8317 · General',
    std:       'JIS Z 8317',
    arrow:     JIS_ARROW_FILLED,
    text:      { height: 3.0, font: 'JIS Z 8313', decimals: 2 },
    leader:    { offset: 2, gap: 1, jogLength: 6 },
    tolerance: { default: { plus: 0.05, minus: 0.05 }, displayMode: 'bilateral' },
    gap:        1.0,
    extension:  2.0,
  }),
  // ──────────────────────── JIS Z 8317 · Open arrow ────────────────
  Object.freeze({
    id:        'jis-z-8317-open',
    label:     'JIS Z 8317 · Open Arrow',
    std:       'JIS Z 8317',
    arrow:     ISO_ARROW_OPEN,
    text:      { height: 2.5, font: 'JIS Z 8313', decimals: 2 },
    leader:    { offset: 2, gap: 1, jogLength: 6 },
    tolerance: { default: { plus: 0.05, minus: 0.05 }, displayMode: 'limit' },
    gap:        1.0,
    extension:  2.0,
  }),
]);

export const DIM_STYLE_COUNT = DIM_STYLES.length;

export const DEFAULT_DIM_STYLE_ID = 'iso-129';

/** Look up by id. */
export function getDimStyle(id) {
  return DIM_STYLES.find((s) => s.id === id) || DIM_STYLES.find((s) => s.id === DEFAULT_DIM_STYLE_ID);
}

/** Filter by standard ('ISO 129', 'ASME Y14.5', 'JIS Z 8317'). */
export function dimStylesForStandard(std) {
  return DIM_STYLES.filter((s) => s.std === std);
}

export const DIM_STYLE_STANDARDS = Object.freeze(['ISO 129', 'ASME Y14.5', 'JIS Z 8317']);

/**
 * Format a numeric measurement against a dim style.
 * Honours decimal places + tolerance display mode.
 */
export function formatDimValue(value, styleId, override) {
  const style = getDimStyle(styleId);
  const t = override?.tolerance ?? style.tolerance.default;
  const v = value.toFixed(style.text.decimals);
  switch (style.tolerance.displayMode) {
    case 'none':       return v;
    case 'symmetric':  return `${v} ±${t.plus.toFixed(style.text.decimals)}`;
    case 'bilateral':  return `${v} +${t.plus.toFixed(style.text.decimals)}/−${t.minus.toFixed(style.text.decimals)}`;
    case 'limit': {
      const hi = (value + t.plus).toFixed(style.text.decimals);
      const lo = (value - t.minus).toFixed(style.text.decimals);
      return `${hi} / ${lo}`;
    }
    default: return v;
  }
}
