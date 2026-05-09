/**
 * ArchDisc — Drawing Annotations
 *
 * Generates dimension lines, GD&T frames, surface finish, balloons,
 * and notes for engineering drawings.
 *
 * Output is SVG-ready geometry (lines, arrows, text).
 */

const TICK_LEN = 3;
const ARROW_LEN = 4;
const TEXT_OFFSET = 6;
const EXT_LINE_GAP = 2;

export default class Annotations {

  /**
   * Linear dimension between two points.
   * @param {object} p1 - { x, y } first endpoint (mm)
   * @param {object} p2 - { x, y } second endpoint (mm)
   * @param {number} offset - Perpendicular offset for dim line (mm)
   * @param {string} text - Override text (default: distance in mm)
   * @returns {object} { svg, value, points }
   */
  static linearDim(p1, p2, offset = 15, text = null) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < 1e-6) return { svg: '', value: 0 };

    // Perpendicular direction (left of vector p1→p2)
    const nx = -dy / dist;
    const ny = dx / dist;

    // Dimension line offset
    const dp1 = { x: p1.x + nx * offset, y: p1.y + ny * offset };
    const dp2 = { x: p2.x + nx * offset, y: p2.y + ny * offset };

    // Extension lines (from feature points to dimension line)
    const ep1a = { x: p1.x + nx * EXT_LINE_GAP, y: p1.y + ny * EXT_LINE_GAP };
    const ep1b = { x: p1.x + nx * (offset + EXT_LINE_GAP), y: p1.y + ny * (offset + EXT_LINE_GAP) };
    const ep2a = { x: p2.x + nx * EXT_LINE_GAP, y: p2.y + ny * EXT_LINE_GAP };
    const ep2b = { x: p2.x + nx * (offset + EXT_LINE_GAP), y: p2.y + ny * (offset + EXT_LINE_GAP) };

    // Arrows
    const arrows = [
      Annotations._arrow(dp1, { x: dp1.x + dx / dist * ARROW_LEN, y: dp1.y + dy / dist * ARROW_LEN }),
      Annotations._arrow(dp2, { x: dp2.x - dx / dist * ARROW_LEN, y: dp2.y - dy / dist * ARROW_LEN }),
    ];

    // Text (centered above dimension line)
    const tx = (dp1.x + dp2.x) / 2 + nx * TEXT_OFFSET;
    const ty = (dp1.y + dp2.y) / 2 + ny * TEXT_OFFSET;
    const label = text || `${dist.toFixed(2)}`;
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;

    const svg = `
  <line x1="${ep1a.x.toFixed(2)}" y1="${ep1a.y.toFixed(2)}" x2="${ep1b.x.toFixed(2)}" y2="${ep1b.y.toFixed(2)}" stroke="#333" stroke-width="0.4"/>
  <line x1="${ep2a.x.toFixed(2)}" y1="${ep2a.y.toFixed(2)}" x2="${ep2b.x.toFixed(2)}" y2="${ep2b.y.toFixed(2)}" stroke="#333" stroke-width="0.4"/>
  <line x1="${dp1.x.toFixed(2)}" y1="${dp1.y.toFixed(2)}" x2="${dp2.x.toFixed(2)}" y2="${dp2.y.toFixed(2)}" stroke="#333" stroke-width="0.4"/>
  ${arrows.join('\n  ')}
  <text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" font-family="monospace" font-size="8" fill="#333" text-anchor="middle" transform="rotate(${angle.toFixed(1)} ${tx.toFixed(2)} ${ty.toFixed(2)})">${label}</text>`;

    return { svg, value: dist, label, points: [dp1, dp2] };
  }

  /**
   * Diameter dimension on a circle/hole.
   * @param {object} center - { x, y }
   * @param {number} radius - in mm
   * @param {number} angle - leader angle in radians (default 45°)
   */
  static diameterDim(center, radius, angle = Math.PI / 4) {
    const cx = Math.cos(angle), cy = Math.sin(angle);
    const p1 = { x: center.x - cx * radius, y: center.y - cy * radius };
    const p2 = { x: center.x + cx * radius, y: center.y + cy * radius };
    const tx = center.x + cx * (radius + 8);
    const ty = center.y + cy * (radius + 8);
    const label = `Ø${(radius * 2).toFixed(2)}`;

    return {
      svg: `
  <line x1="${p1.x.toFixed(2)}" y1="${p1.y.toFixed(2)}" x2="${p2.x.toFixed(2)}" y2="${p2.y.toFixed(2)}" stroke="#333" stroke-width="0.4"/>
  ${Annotations._arrow(p1, p2)}
  ${Annotations._arrow(p2, p1)}
  <text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" font-family="monospace" font-size="9" fill="#333" font-weight="bold">${label}</text>`,
      value: radius * 2,
      label,
    };
  }

  /**
   * Radius dimension (for arcs and fillets).
   */
  static radiusDim(center, radius, leaderAngle = Math.PI / 6) {
    const cx = Math.cos(leaderAngle), cy = Math.sin(leaderAngle);
    const p1 = { x: center.x, y: center.y };
    const p2 = { x: center.x + cx * radius, y: center.y + cy * radius };
    const p3 = { x: center.x + cx * (radius + 10), y: center.y + cy * (radius + 10) };
    const label = `R${radius.toFixed(2)}`;

    return {
      svg: `
  <line x1="${p1.x.toFixed(2)}" y1="${p1.y.toFixed(2)}" x2="${p3.x.toFixed(2)}" y2="${p3.y.toFixed(2)}" stroke="#333" stroke-width="0.4"/>
  ${Annotations._arrow(p2, p1)}
  <text x="${p3.x.toFixed(2)}" y="${(p3.y - 2).toFixed(2)}" font-family="monospace" font-size="9" fill="#333">${label}</text>`,
      value: radius,
      label,
    };
  }

  /**
   * Angular dimension between two lines that meet at a vertex.
   */
  static angleDim(vertex, p1, p2, radius = 15) {
    const a1 = Math.atan2(p1.y - vertex.y, p1.x - vertex.x);
    const a2 = Math.atan2(p2.y - vertex.y, p2.x - vertex.x);
    let delta = a2 - a1;
    while (delta < 0) delta += Math.PI * 2;
    while (delta > Math.PI * 2) delta -= Math.PI * 2;
    if (delta > Math.PI) delta = Math.PI * 2 - delta;

    const angDeg = delta * 180 / Math.PI;
    const label = `${angDeg.toFixed(1)}°`;
    const midA = (a1 + a2) / 2;

    // Arc path
    const arcStart = { x: vertex.x + Math.cos(a1) * radius, y: vertex.y + Math.sin(a1) * radius };
    const arcEnd = { x: vertex.x + Math.cos(a2) * radius, y: vertex.y + Math.sin(a2) * radius };
    const tx = vertex.x + Math.cos(midA) * (radius + 8);
    const ty = vertex.y + Math.sin(midA) * (radius + 8);

    return {
      svg: `
  <path d="M ${arcStart.x.toFixed(2)} ${arcStart.y.toFixed(2)} A ${radius} ${radius} 0 0 1 ${arcEnd.x.toFixed(2)} ${arcEnd.y.toFixed(2)}" fill="none" stroke="#333" stroke-width="0.4"/>
  <text x="${tx.toFixed(2)}" y="${ty.toFixed(2)}" font-family="monospace" font-size="9" fill="#333" text-anchor="middle">${label}</text>`,
      value: angDeg,
      label,
    };
  }

  /**
   * Surface finish symbol (Ra value).
   * @param {object} pos - { x, y } anchor
   * @param {number} ra - surface roughness in microns (e.g., 1.6, 3.2)
   */
  static surfaceFinish(pos, ra) {
    const { x, y } = pos;
    return {
      svg: `
  <path d="M ${x} ${y} L ${(x + 4).toFixed(1)} ${(y - 6).toFixed(1)} L ${(x + 8).toFixed(1)} ${y} M ${(x + 4).toFixed(1)} ${(y - 6).toFixed(1)} L ${(x + 4).toFixed(1)} ${(y - 14).toFixed(1)} L ${(x + 14).toFixed(1)} ${(y - 14).toFixed(1)}" fill="none" stroke="#333" stroke-width="0.5"/>
  <text x="${(x + 5).toFixed(1)}" y="${(y - 7).toFixed(1)}" font-family="monospace" font-size="6" fill="#333">${ra.toFixed(1)}</text>`,
      label: `Ra ${ra}`,
    };
  }

  /**
   * GD&T feature control frame.
   * @param {object} pos
   * @param {string} symbol - GD&T symbol (e.g., '⊥', '⊕', '⌭')
   * @param {number} tolerance - in mm
   * @param {string[]} datums - array of datum letters (e.g., ['A', 'B'])
   */
  static gdtFrame(pos, symbol, tolerance, datums = []) {
    const { x, y } = pos;
    const cellW = 12;
    const cellH = 8;
    const cells = [symbol, tolerance.toFixed(3), ...datums];
    const w = cellW * cells.length;

    let svg = `
  <rect x="${x}" y="${y}" width="${w}" height="${cellH}" fill="white" stroke="#333" stroke-width="0.5"/>`;
    cells.forEach((cell, i) => {
      const cx = x + i * cellW + cellW / 2;
      const cy = y + cellH / 2 + 2;
      svg += `
  <text x="${cx.toFixed(1)}" y="${cy.toFixed(1)}" font-family="monospace" font-size="6" fill="#333" text-anchor="middle">${cell}</text>`;
      if (i < cells.length - 1) {
        svg += `
  <line x1="${(x + (i + 1) * cellW).toFixed(1)}" y1="${y}" x2="${(x + (i + 1) * cellW).toFixed(1)}" y2="${(y + cellH).toFixed(1)}" stroke="#333" stroke-width="0.3"/>`;
      }
    });

    return { svg, label: `${symbol} ${tolerance.toFixed(3)} ${datums.join('|')}` };
  }

  /**
   * Balloon callout (numbered circle linked to a feature).
   */
  static balloon(pos, number, leaderTo) {
    const { x, y } = pos;
    let svg = `
  <circle cx="${x}" cy="${y}" r="6" fill="white" stroke="#333" stroke-width="0.5"/>
  <text x="${x}" y="${(y + 2.5).toFixed(1)}" font-family="monospace" font-size="7" fill="#333" text-anchor="middle" font-weight="bold">${number}</text>`;
    if (leaderTo) {
      svg += `
  <line x1="${x}" y1="${(y + 6).toFixed(1)}" x2="${leaderTo.x.toFixed(1)}" y2="${leaderTo.y.toFixed(1)}" stroke="#333" stroke-width="0.4"/>`;
    }
    return { svg, label: `${number}` };
  }

  /**
   * Auto-dimension a 2D projection: adds overall W/H dimensions and any
   * detected circle features (placeholder — needs real face detection).
   * @param {object} projection - From DrawingEngine.projectSolid()
   * @returns {object} { svg, count, dims }
   */
  static autoDimension(projection, scale = 1000, offsetX = 0, offsetY = 0) {
    const { bbox } = projection;
    const wmm = bbox.width * scale;
    const hmm = bbox.height * scale;
    const dims = [];

    // Overall width (bottom)
    const bl = { x: bbox.minX * scale + offsetX, y: bbox.minY * scale + offsetY };
    const br = { x: bbox.maxX * scale + offsetX, y: bbox.minY * scale + offsetY };
    const tl = { x: bbox.minX * scale + offsetX, y: bbox.maxY * scale + offsetY };
    dims.push(Annotations.linearDim(bl, br, -15, `${wmm.toFixed(2)}`));
    dims.push(Annotations.linearDim(bl, tl, -15, `${hmm.toFixed(2)}`));

    return {
      svg: dims.map(d => d.svg).join('\n'),
      count: dims.length,
      dims,
    };
  }

  // --- Internals ---

  static _arrow(tip, base) {
    const dx = tip.x - base.x;
    const dy = tip.y - base.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-6) return '';
    const ux = dx / len, uy = dy / len;
    const px = -uy, py = ux;
    const al = ARROW_LEN;
    const aw = al * 0.4;
    const x1 = tip.x - ux * al + px * aw;
    const y1 = tip.y - uy * al + py * aw;
    const x2 = tip.x - ux * al - px * aw;
    const y2 = tip.y - uy * al - py * aw;
    return `<polygon points="${tip.x.toFixed(2)},${tip.y.toFixed(2)} ${x1.toFixed(2)},${y1.toFixed(2)} ${x2.toFixed(2)},${y2.toFixed(2)}" fill="#333"/>`;
  }
}
