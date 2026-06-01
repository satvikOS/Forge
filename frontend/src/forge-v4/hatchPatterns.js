// Forge-149 — Hatch pattern catalogue.
//
// Draft workbench annotation tool ships with the canonical ISO 12011
// (general lines / double-line) hatches plus the ANSI Y14.2 material
// catalogue every mechanical detailer expects (steel, stainless, brass,
// plastic, fire-brick, marble, lead, aluminium). Each entry describes
// the line strokes the renderer composes inside the closed region the
// user picks; the renderer never invents lines outside the catalogue.
//
// A pattern is a flat array of {angle, spacing, offset?, dashArray?}
// strokes. The Draft dispatcher passes the active pattern to
// forge.draft.hatchRegion (when the kernel exposes it) so the kernel
// can solid-fill the area; the workbench preview SVG renders the same
// strokes at the same angles so the user can see the result without
// the kernel.
//
// All distances in millimetres; all angles in degrees CCW from +X.
// dashArray follows the SVG convention "on off on off …".

export const HATCH_PATTERN_GROUPS = Object.freeze({
  ISO: 'ISO 12011 — General',
  ANSI: 'ANSI Y14.2 — Material',
});

const ISO_45 = Object.freeze({
  id: 'iso-45',
  group: 'ISO',
  name: 'Lines · 45°',
  description: 'Single set of 45° lines · ISO 12011 general indication.',
  strokes: [
    { angle: 45, spacing: 4.0, offset: 0.0, dashArray: null },
  ],
});

const ISO_DOUBLE_45 = Object.freeze({
  id: 'iso-double-45',
  group: 'ISO',
  name: 'Cross-hatch · 45°',
  description: 'Double 45° / 135° crosshatch · ISO 12011 sections.',
  strokes: [
    { angle:  45, spacing: 4.0, offset: 0.0, dashArray: null },
    { angle: 135, spacing: 4.0, offset: 0.0, dashArray: null },
  ],
});

// ────────── ANSI Y14.2 — material catalogue ──────────
// Source: ASME Y14.2-2014 §B.1 "Section line patterns by material".
// Spacings tuned to the published exemplars (4 mm baseline at 1:1).

const ANSI31_STEEL = Object.freeze({
  id: 'ansi31-steel',
  group: 'ANSI',
  ansiCode: 'ANSI31',
  name: 'ANSI31 · Steel / iron / general',
  description: 'Single 45° lines at 3.18 mm spacing.',
  strokes: [
    { angle: 45, spacing: 3.18, offset: 0.0, dashArray: null },
  ],
});

const ANSI32_STAINLESS = Object.freeze({
  id: 'ansi32-stainless',
  group: 'ANSI',
  ansiCode: 'ANSI32',
  name: 'ANSI32 · Stainless / heat-treat',
  description: 'Double 45° lines at 1.59 mm + 3.18 mm offset.',
  strokes: [
    { angle: 45, spacing: 3.18, offset: 0.00, dashArray: null },
    { angle: 45, spacing: 3.18, offset: 1.59, dashArray: null },
  ],
});

const ANSI33_BRASS = Object.freeze({
  id: 'ansi33-brass',
  group: 'ANSI',
  ansiCode: 'ANSI33',
  name: 'ANSI33 · Brass / bronze / copper',
  description: 'Alternating dashed 45° lines.',
  strokes: [
    { angle: 45, spacing: 3.18, offset: 0.00, dashArray: null },
    { angle: 45, spacing: 3.18, offset: 1.59, dashArray: [2.5, 1.0] },
  ],
});

const ANSI34_PLASTIC = Object.freeze({
  id: 'ansi34-plastic',
  group: 'ANSI',
  ansiCode: 'ANSI34',
  name: 'ANSI34 · Plastic / rubber',
  description: 'Wide 45° lines with skewed companions at 30°.',
  strokes: [
    { angle: 45, spacing: 6.35, offset: 0.0, dashArray: null },
    { angle: 30, spacing: 6.35, offset: 3.17, dashArray: null },
  ],
});

const ANSI35_FIREBRICK = Object.freeze({
  id: 'ansi35-firebrick',
  group: 'ANSI',
  ansiCode: 'ANSI35',
  name: 'ANSI35 · Fire-brick / refractory',
  description: '45° lines + perpendicular tick rows.',
  strokes: [
    { angle:  45, spacing: 4.76, offset: 0.0, dashArray: null },
    { angle: 135, spacing: 4.76, offset: 0.0, dashArray: [1.6, 3.2] },
  ],
});

const ANSI36_MARBLE = Object.freeze({
  id: 'ansi36-marble',
  group: 'ANSI',
  ansiCode: 'ANSI36',
  name: 'ANSI36 · Marble / slate / glass',
  description: 'Dashed 45° lines with intermediate dot rows.',
  strokes: [
    { angle: 45, spacing: 3.18, offset: 0.00, dashArray: [3.18, 1.59] },
    { angle: 45, spacing: 3.18, offset: 1.59, dashArray: [0.5, 4.27] },
  ],
});

const ANSI37_LEAD = Object.freeze({
  id: 'ansi37-lead',
  group: 'ANSI',
  ansiCode: 'ANSI37',
  name: 'ANSI37 · Lead / babbitt / white metal',
  description: 'Cross-hatch 45°/135° offset.',
  strokes: [
    { angle:  45, spacing: 1.59, offset: 0.00, dashArray: null },
    { angle: 135, spacing: 1.59, offset: 0.00, dashArray: null },
  ],
});

const ANSI38_ALUMINIUM = Object.freeze({
  id: 'ansi38-aluminium',
  group: 'ANSI',
  ansiCode: 'ANSI38',
  name: 'ANSI38 · Aluminium / magnesium',
  description: 'Dashed-then-solid alternating 45° rows.',
  strokes: [
    { angle: 45, spacing: 3.18, offset: 0.00, dashArray: null },
    { angle: 45, spacing: 3.18, offset: 1.59, dashArray: [2.0, 1.0, 0.5, 1.0] },
  ],
});

export const HATCH_PATTERNS = Object.freeze([
  ISO_45,
  ISO_DOUBLE_45,
  ANSI31_STEEL,
  ANSI32_STAINLESS,
  ANSI33_BRASS,
  ANSI34_PLASTIC,
  ANSI35_FIREBRICK,
  ANSI36_MARBLE,
  ANSI37_LEAD,
  ANSI38_ALUMINIUM,
]);

export const DEFAULT_HATCH_ID = 'iso-45';

/** Lookup a pattern by id; returns the ISO-45 default on miss. */
export function getHatchPattern(id) {
  return HATCH_PATTERNS.find((p) => p.id === id)
      || HATCH_PATTERNS[0];
}

/** Materialise a pattern descriptor the kernel + preview both consume. */
export function hatchSpec(id, scale = 1, angleOffset = 0) {
  const p = getHatchPattern(id);
  return {
    id: p.id,
    name: p.name,
    ansiCode: p.ansiCode || null,
    scale: scale > 0 ? scale : 1,
    angleOffset,
    strokes: p.strokes.map((s) => ({
      angle: s.angle + angleOffset,
      spacing: s.spacing * (scale > 0 ? scale : 1),
      offset: s.offset * (scale > 0 ? scale : 1),
      dashArray: s.dashArray
        ? s.dashArray.map((d) => d * (scale > 0 ? scale : 1))
        : null,
    })),
  };
}

/**
 * For preview SVG rendering — given a bounding box (xMin, yMin, xMax, yMax)
 * and a hatch spec, return an array of line segments tightly clipped to
 * the box. Stroke layers compose by concatenation; the renderer just
 * draws them in declaration order.
 */
export function buildHatchSegments(box, spec) {
  const { xMin, yMin, xMax, yMax } = box;
  const W = xMax - xMin;
  const H = yMax - yMin;
  const out = [];
  if (W <= 0 || H <= 0) return out;
  const diag = Math.hypot(W, H);
  for (const stroke of spec.strokes) {
    const rad = (stroke.angle * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    // Normal to the stroke direction; iterate along the normal.
    const nx = -sin;
    const ny =  cos;
    const sp = Math.max(0.25, stroke.spacing);
    const off = stroke.offset || 0;
    // March in normal direction from the centre of the box outward by ±diag
    // so the fan of lines fully covers the rectangle at any angle.
    const cx = (xMin + xMax) / 2;
    const cy = (yMin + yMax) / 2;
    for (let t = -diag; t <= diag; t += sp) {
      const ox = cx + nx * (t + off);
      const oy = cy + ny * (t + off);
      // Each line goes ±diag along the stroke direction.
      const x1 = ox - cos * diag;
      const y1 = oy - sin * diag;
      const x2 = ox + cos * diag;
      const y2 = oy + sin * diag;
      const clipped = clipToBox(x1, y1, x2, y2, xMin, yMin, xMax, yMax);
      if (clipped) {
        out.push({
          x1: clipped[0], y1: clipped[1],
          x2: clipped[2], y2: clipped[3],
          dashArray: stroke.dashArray,
        });
      }
    }
  }
  return out;
}

// Liang-Barsky line clipping to the bounding box.
function clipToBox(x1, y1, x2, y2, xMin, yMin, xMax, yMax) {
  let t0 = 0, t1 = 1;
  const dx = x2 - x1, dy = y2 - y1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - xMin, xMax - x1, y1 - yMin, yMax - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) {
      if (q[i] < 0) return null;
    } else {
      const r = q[i] / p[i];
      if (p[i] < 0) {
        if (r > t1) return null;
        if (r > t0) t0 = r;
      } else {
        if (r < t0) return null;
        if (r < t1) t1 = r;
      }
    }
  }
  return [
    x1 + t0 * dx, y1 + t0 * dy,
    x1 + t1 * dx, y1 + t1 * dy,
  ];
}

export default HATCH_PATTERNS;
