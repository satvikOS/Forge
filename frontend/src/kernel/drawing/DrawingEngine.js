/**
 * ArchDisc — Drawing Engine
 *
 * Generates 2D engineering drawings from 3D B-Rep solids.
 * Projects all edges onto a viewing plane and classifies them as:
 * - visible (solid lines)
 * - hidden (dashed lines, behind front faces)
 * - tangent (lines where curved surfaces meet smoothly)
 *
 * Output: SVG-compatible paths suitable for engineering drawings.
 */

import Vec3 from '../math/Vec3.js';
import Mat4 from '../math/Mat4.js';
import Annotations from './Annotations.js';

const VIEW_DIRECTIONS = {
  front:    { dir: new Vec3(0, 0, -1),  up: new Vec3(0, 1, 0) },
  back:     { dir: new Vec3(0, 0, 1),   up: new Vec3(0, 1, 0) },
  top:      { dir: new Vec3(0, -1, 0),  up: new Vec3(0, 0, -1) },
  bottom:   { dir: new Vec3(0, 1, 0),   up: new Vec3(0, 0, 1) },
  left:     { dir: new Vec3(1, 0, 0),   up: new Vec3(0, 1, 0) },
  right:    { dir: new Vec3(-1, 0, 0),  up: new Vec3(0, 1, 0) },
  isometric:{ dir: new Vec3(-1, -1, -1).normalize(), up: new Vec3(0, 1, 0) },
};

export { VIEW_DIRECTIONS };

export default class DrawingEngine {

  /**
   * Generate a 2D projection of a solid from a viewing direction.
   * @param {TopoSolid} solid
   * @param {string|object} viewSpec - 'front', 'top', etc., or { dir, up }
   * @returns {object} { edges: [{ x1, y1, x2, y2, hidden }], bbox }
   */
  static projectSolid(solid, viewSpec = 'front') {
    const view = typeof viewSpec === 'string' ? VIEW_DIRECTIONS[viewSpec] : viewSpec;
    if (!view) throw new Error(`Unknown view: ${viewSpec}`);

    const viewDir = view.dir;
    const upDir = view.up;
    // Build 2D basis: U = right (cross of up and viewDir), V = up
    const U = upDir.cross(viewDir).normalize();
    const V = viewDir.cross(U).normalize();

    const projectPoint = (p3d) => ({
      x: p3d.x * U.x + p3d.y * U.y + p3d.z * U.z,
      y: p3d.x * V.x + p3d.y * V.y + p3d.z * V.z,
      depth: p3d.x * viewDir.x + p3d.y * viewDir.y + p3d.z * viewDir.z,
    });

    const edges = [];
    const seen = new Set();
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;

    for (const edge of solid.edges()) {
      const v1 = edge.startVertex?.point;
      const v2 = edge.endVertex?.point;
      if (!v1 || !v2) continue;

      // Dedup edges (same start/end across faces)
      const key = `${v1.x.toFixed(6)},${v1.y.toFixed(6)},${v1.z.toFixed(6)}-${v2.x.toFixed(6)},${v2.y.toFixed(6)},${v2.z.toFixed(6)}`;
      const keyR = `${v2.x.toFixed(6)},${v2.y.toFixed(6)},${v2.z.toFixed(6)}-${v1.x.toFixed(6)},${v1.y.toFixed(6)},${v1.z.toFixed(6)}`;
      if (seen.has(key) || seen.has(keyR)) continue;
      seen.add(key);

      // Tangent edge filter: skip edges between coplanar faces (smooth)
      const isTangent = DrawingEngine._isTangentEdge(edge);
      if (isTangent) continue;

      const p1 = projectPoint(v1);
      const p2 = projectPoint(v2);

      // Determine if edge is hidden: midpoint depth check vs face depths
      const midDepth = (p1.depth + p2.depth) / 2;
      const hidden = DrawingEngine._isHiddenEdge(edge, viewDir, midDepth);

      edges.push({ x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y, hidden });

      minX = Math.min(minX, p1.x, p2.x);
      maxX = Math.max(maxX, p1.x, p2.x);
      minY = Math.min(minY, p1.y, p2.y);
      maxY = Math.max(maxY, p1.y, p2.y);
    }

    if (!isFinite(minX)) {
      minX = maxX = minY = maxY = 0;
    }

    return {
      view: typeof viewSpec === 'string' ? viewSpec : 'custom',
      edges,
      bbox: { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY },
      edgeCount: edges.length,
    };
  }

  /**
   * Check if edge is between two faces with small angle (tangent/smooth edge).
   * Tangent edges shouldn't appear in drawings.
   */
  static _isTangentEdge(edge) {
    if (!edge.faces || edge.faces.size !== 2) return false;
    const facesArr = [...edge.faces];
    try {
      const n1 = facesArr[0].outerLoop?.computeNormal();
      const n2 = facesArr[1].outerLoop?.computeNormal();
      if (!n1 || !n2) return false;
      const dot = n1.x * n2.x + n1.y * n2.y + n1.z * n2.z;
      return dot > 0.985; // within 10° → tangent
    } catch {
      return false;
    }
  }

  /**
   * Simplified hidden line check: edge is hidden if both adjacent faces face away
   * from the viewer (back-facing).
   */
  static _isHiddenEdge(edge, viewDir, midDepth) {
    if (!edge.faces || edge.faces.size === 0) return false;
    const facesArr = [...edge.faces];
    let allBackFacing = true;
    for (const f of facesArr) {
      try {
        const n = f.outerLoop?.computeNormal();
        if (!n) continue;
        const dot = n.x * viewDir.x + n.y * viewDir.y + n.z * viewDir.z;
        if (f.reversed) {
          if (dot > 0) allBackFacing = false;
        } else {
          if (dot < 0) allBackFacing = false;
        }
      } catch { /* ignore */ }
    }
    return allBackFacing;
  }

  /**
   * Generate SVG markup for a drawing view.
   * @param {object} projection - Result of projectSolid()
   * @param {object} options - { width, height, padding, scale }
   * @returns {string} SVG string
   */
  static toSVG(projection, options = {}) {
    const padding = options.padding || 20;
    const scale = options.scale || 1000; // m → mm
    const { bbox } = projection;
    const w = (bbox.width * scale) + padding * 2;
    const h = (bbox.height * scale) + padding * 2;
    const tx = padding - bbox.minX * scale;
    const ty = padding - bbox.minY * scale;

    const lines = [];
    for (const e of projection.edges) {
      const x1 = e.x1 * scale + tx;
      const y1 = (h - (e.y1 * scale + ty)); // flip Y for SVG
      const x2 = e.x2 * scale + tx;
      const y2 = (h - (e.y2 * scale + ty));
      const stroke = e.hidden ? '#888' : '#000';
      const dash = e.hidden ? 'stroke-dasharray="3,3"' : '';
      lines.push(`<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${stroke}" stroke-width="0.6" ${dash}/>`);
    }

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(0)}" height="${h.toFixed(0)}" viewBox="0 0 ${w.toFixed(0)} ${h.toFixed(0)}">
  <rect width="100%" height="100%" fill="white"/>
  ${lines.join('\n  ')}
</svg>`;
  }

  /**
   * Generate a multi-view drawing (Front + Top + Right + Iso).
   * @param {TopoSolid} solid
   * @returns {object} { views: { front, top, right, isometric } }
   */
  static multiView(solid) {
    return {
      front: DrawingEngine.projectSolid(solid, 'front'),
      top: DrawingEngine.projectSolid(solid, 'top'),
      right: DrawingEngine.projectSolid(solid, 'right'),
      isometric: DrawingEngine.projectSolid(solid, 'isometric'),
    };
  }

  /**
   * Generate full drawing sheet SVG with title block.
   */
  static generateSheet(solid, options = {}) {
    const partName = options.partName || solid.name || 'Untitled';
    const drawnBy = options.drawnBy || 'ArchDisc';
    const date = options.date || new Date().toISOString().split('T')[0];
    const scale = options.scale || 1000;
    const sheetSize = options.sheetSize || 'A3'; // A0..A4

    const views = DrawingEngine.multiView(solid);
    const margin = 30;

    // Sheet dimensions (mm)
    const sheets = {
      A0: [1189, 841], A1: [841, 594], A2: [594, 420], A3: [420, 297], A4: [297, 210],
    };
    const [sw, sh] = sheets[sheetSize] || sheets.A3;

    // Layout: front top-left, top right of front, right below front, iso bottom-right
    const cellW = (sw - margin * 3) / 2;
    const cellH = (sh - margin * 3 - 60) / 2; // 60 for title block

    const renderView = (view, x, y, label, includeDims = false) => {
      const { bbox } = view;
      const vw = bbox.width * scale;
      const vh = bbox.height * scale;
      const cx = x + (cellW - vw) / 2 - bbox.minX * scale;
      const cy = y + (cellH - vh) / 2 - bbox.minY * scale;

      const lines = view.edges.map(e => {
        const x1 = e.x1 * scale + cx;
        const y1 = sh - (e.y1 * scale + cy);
        const x2 = e.x2 * scale + cx;
        const y2 = sh - (e.y2 * scale + cy);
        const dash = e.hidden ? 'stroke-dasharray="3,3"' : '';
        const stroke = e.hidden ? '#888' : '#000';
        return `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${stroke}" stroke-width="0.6" ${dash}/>`;
      }).join('\n  ');

      let dimsSVG = '';
      if (includeDims) {
        // Auto-dimension this view's bbox (overall W and H)
        const wmm = bbox.width * scale;
        const hmm = bbox.height * scale;
        const bl = { x: bbox.minX * scale + cx, y: sh - (bbox.minY * scale + cy) };
        const br = { x: bbox.maxX * scale + cx, y: sh - (bbox.minY * scale + cy) };
        const tl = { x: bbox.minX * scale + cx, y: sh - (bbox.maxY * scale + cy) };
        const wDim = Annotations.linearDim(bl, br, 12, `${wmm.toFixed(1)}`);
        const hDim = Annotations.linearDim(tl, bl, 12, `${hmm.toFixed(1)}`);
        dimsSVG = wDim.svg + hDim.svg;
      }

      const labelY = sh - y - 5;
      return `${lines}\n  ${dimsSVG}\n  <text x="${x + 4}" y="${labelY.toFixed(0)}" font-family="monospace" font-size="10" fill="#333">${label}</text>`;
    };

    const titleBlockY = margin;
    const titleBlock = `
  <rect x="${sw - 200}" y="${titleBlockY}" width="${200 - margin}" height="50" fill="none" stroke="#000" stroke-width="0.8"/>
  <text x="${sw - 195}" y="${titleBlockY + 14}" font-family="monospace" font-size="9" fill="#000" font-weight="bold">${partName}</text>
  <text x="${sw - 195}" y="${titleBlockY + 28}" font-family="monospace" font-size="8" fill="#555">Drawn: ${drawnBy}</text>
  <text x="${sw - 195}" y="${titleBlockY + 40}" font-family="monospace" font-size="8" fill="#555">Date: ${date}  Scale: 1:${scale === 1000 ? '1' : (1/scale).toFixed(0)}  ${sheetSize}</text>`;

    const fy = sh - margin - cellH;
    const ty = sh - margin * 2 - cellH * 2;
    const includeDims = options.dimensions !== false;
    const cells = [
      renderView(views.front, margin, fy, 'FRONT', includeDims),
      renderView(views.top, margin, ty, 'TOP', includeDims),
      renderView(views.right, margin + cellW + margin, fy, 'RIGHT', includeDims),
      renderView(views.isometric, margin + cellW + margin, ty, 'ISO', false),
    ];

    return `<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}" viewBox="0 0 ${sw} ${sh}">
  <rect width="100%" height="100%" fill="white"/>
  <rect x="${margin/2}" y="${margin/2}" width="${sw - margin}" height="${sh - margin}" fill="none" stroke="#000" stroke-width="1"/>
  ${cells.join('\n  ')}
  ${titleBlock}
</svg>`;
  }
}
