/**
 * ArchDisc Foundation — Sheet metal unfolding (K-factor + bend allowance).
 *
 * Computes the developed flat-pattern length of a multi-bend sheet-metal
 * part using the standard bend-allowance formula:
 *
 *     BA = θ · (r + K · t)            where:
 *
 *         θ  = bend angle (radians)
 *         r  = inside bend radius (mm)
 *         K  = K-factor (location of neutral axis as fraction of t)
 *         t  = sheet thickness (mm)
 *
 * The neutral axis is the line through the cross-section that neither
 * stretches nor compresses during bending. For typical materials and
 * the standard Smith / SolidWorks "Sheet Metal" formulation:
 *
 *         K ≈ 0.33   for tight bends (r/t < 1)
 *         K ≈ 0.40   for medium bends (r/t ~ 1-2)   — most common
 *         K ≈ 0.50   for very generous bends (r/t > 5)
 *
 * Reference: David Smith, "Sheet Metal Fabrication", Industrial Press,
 * sections 4.2-4.5; also the SolidWorks Sheet Metal Help.
 *
 * Part definition: a sequence of segments
 *
 *   { type: 'flat', length, width }     // straight section
 *   { type: 'bend', angle_deg, radius_mm, k? }  // bend at the joint;
 *                                                  k overrides defaultK
 *
 * Two flats with a bend between them describe a folded part. We assume
 * uniform width (the input is a 1-D unfolding problem; for true 2-D
 * gusseted flats with darts you'd need additional fold-line metadata).
 *
 * Output:
 *   { totalDevelopedLengthMm, segments: [{ start, end, type, ... }] }
 *
 * SVG rendering shows the flat pattern with bend lines marked dashed.
 */

const D2R = Math.PI / 180;

export const TYPICAL_K_FACTORS = {
  tight: 0.33,    // r/t < 1
  medium: 0.40,   // r/t = 1-2
  generous: 0.50, // r/t > 5
};

/**
 * Bend allowance for a single bend.
 * @returns {number} flat-strip length consumed by the bend (mm)
 */
export function bendAllowance(angleDeg, radius, thickness, k = 0.4) {
  return (angleDeg * D2R) * (radius + k * thickness);
}

/**
 * Bend deduction (alternative formulation used by some shops):
 *   BD = 2 · OSSB - BA
 *   where OSSB = (r + t) · tan(θ/2) is the outside set-back
 *
 * This is what you subtract from "outside-mold-line" dimensions.
 */
export function bendDeduction(angleDeg, radius, thickness, k = 0.4) {
  const theta = angleDeg * D2R;
  const ossb = (radius + thickness) * Math.tan(theta / 2);
  return 2 * ossb - bendAllowance(angleDeg, radius, thickness, k);
}

/**
 * Unfold a part definition into a flat pattern.
 *
 * @param {object} part
 * @param {number} part.thickness - sheet thickness (mm)
 * @param {number} part.defaultK  - default K-factor (default 0.4)
 * @param {Array}  part.segments  - alternating flat / bend entries
 * @returns {object} flat pattern data
 */
export function unfold(part) {
  const t = part.thickness;
  const defaultK = part.defaultK ?? 0.4;
  if (!Number.isFinite(t) || t <= 0) throw new Error('thickness must be > 0');

  const items = [];
  let cursor = 0;
  let width = 0;

  for (let i = 0; i < part.segments.length; i++) {
    const s = part.segments[i];
    if (s.type === 'flat') {
      items.push({
        kind: 'flat',
        startMm: cursor,
        endMm: cursor + s.length,
        lengthMm: s.length,
        widthMm: s.width,
      });
      cursor += s.length;
      if (s.width !== undefined) width = Math.max(width, s.width);
    } else if (s.type === 'bend') {
      const k = s.k ?? defaultK;
      const ba = bendAllowance(s.angle_deg ?? s.angleDeg ?? s.angle, s.radius_mm ?? s.radius, t, k);
      items.push({
        kind: 'bend',
        startMm: cursor,
        endMm: cursor + ba,
        lengthMm: ba,
        angle_deg: s.angle_deg ?? s.angleDeg ?? s.angle,
        radius_mm: s.radius_mm ?? s.radius,
        kFactor: k,
        thicknessMm: t,
        bendDeductionMm: bendDeduction(
          s.angle_deg ?? s.angleDeg ?? s.angle,
          s.radius_mm ?? s.radius,
          t,
          k,
        ),
      });
      cursor += ba;
    } else {
      throw new Error(`Unknown segment type: ${s.type}`);
    }
  }

  return {
    thicknessMm: t,
    defaultK,
    totalDevelopedLengthMm: cursor,
    widthMm: width,
    segments: items,
  };
}

/**
 * Render an SVG flat pattern of the unfolded sheet.
 * Outline is the strip; bend lines are dashed across the width.
 *
 * @param {object} flatPattern - output of unfold()
 * @param {object} options
 * @param {number} options.marginMm - margin around the pattern (default 8)
 * @param {string} options.title
 * @returns {string} SVG content
 */
export function renderFlatPatternSVG(flatPattern, options = {}) {
  const margin = options.marginMm ?? 8;
  const title = options.title ?? 'Flat Pattern';
  const t = flatPattern.thicknessMm;
  const W = flatPattern.totalDevelopedLengthMm + 2 * margin;
  const H = flatPattern.widthMm + 2 * margin + 24;
  const lines = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}mm" height="${H}mm">`);
  lines.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="white"/>`);
  // Outer strip rectangle
  lines.push(`<rect x="${margin}" y="${margin}" width="${flatPattern.totalDevelopedLengthMm}" height="${flatPattern.widthMm}" fill="none" stroke="black" stroke-width="0.5"/>`);
  // Bend lines
  for (const s of flatPattern.segments) {
    if (s.kind !== 'bend') continue;
    const x = margin + s.startMm;
    const y0 = margin;
    const y1 = margin + flatPattern.widthMm;
    lines.push(`<line x1="${x}" y1="${y0}" x2="${x}" y2="${y1}" stroke="#888" stroke-width="0.4" stroke-dasharray="2,1.2"/>`);
    const xMid = margin + (s.startMm + s.endMm) / 2;
    const yLabel = margin + flatPattern.widthMm + 4;
    lines.push(`<text x="${xMid}" y="${yLabel}" font-family="monospace" font-size="2.5" text-anchor="middle">↥ ${s.angle_deg.toFixed(0)}° R${s.radius_mm}</text>`);
    // also a bend region tinted between startMm and endMm
    lines.push(`<rect x="${x}" y="${margin}" width="${s.endMm - s.startMm}" height="${flatPattern.widthMm}" fill="rgba(100,180,255,0.15)" stroke="none"/>`);
  }
  // Length dimension at top
  const yDim = margin - 3;
  lines.push(`<text x="${margin + flatPattern.totalDevelopedLengthMm / 2}" y="${yDim}" font-family="monospace" font-size="3.0" text-anchor="middle">developed length: ${flatPattern.totalDevelopedLengthMm.toFixed(2)} mm</text>`);
  // Title
  lines.push(`<text x="${margin}" y="${H - 2}" font-family="monospace" font-size="3.0">${escapeHTML(title)} · t = ${t} mm · K = ${flatPattern.defaultK}</text>`);
  lines.push(`</svg>`);
  return lines.join('\n');
}

function escapeHTML(s) {
  return String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
}
