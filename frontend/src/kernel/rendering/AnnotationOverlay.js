/**
 * ArchDisc — Annotation Overlay
 *
 * Composes a callout-style SVG label layer over a 3D render. Used to
 * add "Fan / Booster / HPC / Combustor / HPT / LPT / Exhaust" labels
 * pointing to engine sections — matches the marketing-cutaway style of
 * GE/RR reference diagrams.
 *
 * The 3D render is captured separately (Playwright screenshot of
 * canvas). This module emits an SVG that uses the rendered image as
 * a background and overlays positioned text + leader lines.
 */

export default class AnnotationOverlay {

  /**
   * Build an SVG overlay.
   *
   * @param {object} options
   * @param {string} options.imageHref - data: URL or path to background
   * @param {number} options.width
   * @param {number} options.height
   * @param {string} [options.title]
   * @param {string} [options.subtitle]
   * @param {object[]} options.labels - [{ x, y, text, color, leaderTo? }]
   *   x,y in pixel coords. leaderTo optional {x,y} target.
   * @param {object[]} [options.legend] - [{ color, label }]
   * @returns {string} SVG markup
   */
  static build(options = {}) {
    const {
      imageHref,
      width = 1920,
      height = 800,
      title = '',
      subtitle = '',
      labels = [],
      legend = [],
    } = options;

    const labelEls = labels.map((lbl, i) => {
      const c = lbl.color || '#fff';
      const leader = lbl.leaderTo
        ? `<line x1="${lbl.leaderTo.x}" y1="${lbl.leaderTo.y}" x2="${lbl.x}" y2="${lbl.y}" stroke="${c}" stroke-width="1.5" opacity="0.8"/>`
        : '';
      const dotAtTarget = lbl.leaderTo
        ? `<circle cx="${lbl.leaderTo.x}" cy="${lbl.leaderTo.y}" r="3" fill="${c}"/>`
        : '';
      return `${leader}${dotAtTarget}
        <g transform="translate(${lbl.x}, ${lbl.y})">
          <rect x="-4" y="-14" width="${(lbl.text.length * 8) + 12}" height="22" fill="rgba(0,0,0,0.55)" stroke="${c}" stroke-width="1.2" rx="3"/>
          <text x="2" y="2" font-family="-apple-system, 'Segoe UI', sans-serif" font-size="13" font-weight="600" fill="${c}">${AnnotationOverlay._esc(lbl.text)}</text>
        </g>`;
    }).join('\n');

    const legendEls = legend.length === 0 ? '' : (() => {
      const items = legend.map((l, i) => {
        const y = 50 + i * 22;
        return `
          <rect x="20" y="${y}" width="14" height="14" fill="${l.color}" stroke="#fff" stroke-width="0.5"/>
          <text x="42" y="${y + 12}" font-family="monospace" font-size="12" fill="#fff">${AnnotationOverlay._esc(l.label)}</text>`;
      }).join('');
      return `<g class="legend">
        <rect x="10" y="30" width="220" height="${legend.length * 22 + 30}" fill="rgba(0,0,0,0.6)" stroke="#888" stroke-width="0.5" rx="4"/>
        <text x="20" y="48" font-family="-apple-system, sans-serif" font-size="13" font-weight="700" fill="#fff">SECTION LEGEND</text>
        ${items}
      </g>`;
    })();

    const titleEl = title ? `
      <g class="title">
        <text x="${width / 2}" y="40" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="22" font-weight="700" fill="#fff">${AnnotationOverlay._esc(title)}</text>
        ${subtitle ? `<text x="${width / 2}" y="62" text-anchor="middle" font-family="-apple-system, sans-serif" font-size="12" fill="#aab">${AnnotationOverlay._esc(subtitle)}</text>` : ''}
      </g>` : '';

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  ${imageHref ? `<image href="${imageHref}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>` : ''}
  ${titleEl}
  ${legendEls}
  ${labelEls}
</svg>`;
  }

  /**
   * Map engine z-positions (m) to image x-pixel positions for a side-view
   * render. Caller must know the camera projection — provide bbox + image dims.
   *
   * @param {object} bbox - { zMin, zMax }
   * @param {number} imageWidth
   * @param {number} imageHeight
   * @param {object} [options] - { padding = 0.1, flip = false (left-to-right vs right-to-left) }
   * @returns {function(zMeters):pixelX}
   */
  static makeZMapper(bbox, imageWidth, imageHeight, options = {}) {
    const { padding = 0.06, flip = true } = options;
    const padPx = imageWidth * padding;
    const usable = imageWidth - 2 * padPx;
    const zRange = bbox.zMax - bbox.zMin;
    return (zMeters) => {
      const t = (zMeters - bbox.zMin) / zRange;
      const tt = flip ? (1 - t) : t;
      return padPx + tt * usable;
    };
  }

  /** Standard GE9X engine section labels with z-positions in metres. */
  static GE9X_SECTIONS() {
    return [
      { z: 0.10,  text: 'Fan',          color: '#4a90d9' },
      { z: 1.20,  text: 'Booster (LPC)', color: '#4ed99d' },
      { z: 2.40,  text: 'HP Compressor', color: '#d9a04a' },
      { z: 3.30,  text: 'TAPS Combustor', color: '#d94a4a' },
      { z: 3.90,  text: 'HP Turbine',    color: '#d9c84a' },
      { z: 4.70,  text: 'LP Turbine',    color: '#4ad9c8' },
      { z: 5.50,  text: 'Exhaust',       color: '#aaaaaa' },
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
