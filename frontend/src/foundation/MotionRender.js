/**
 * ArchDisc Foundation — deterministic motion rendering.
 *
 * The motion-study and assembly-sequence solvers produce frame data
 * that drives a live WebGL viewport animation. That animation is real,
 * but a viewport render can only be eyeballed. This module makes the
 * animation independently VERIFIABLE: it renders motion frames to
 * deterministic SVG — a filmstrip (one panel per sampled frame) and a
 * self-contained SMIL-animated SVG. Both are pure functions of the
 * frame data, so a test can parse them and assert the motion is
 * present and correct, with no pixels involved.
 *
 * Kernel-free pure math — node-importable for e2e.
 */

/** Transform a link-local point by a planar pose {x,y,theta}. */
function pw(pose, p) {
  const c = Math.cos(pose.theta), s = Math.sin(pose.theta);
  return [pose.x + p[0] * c - p[1] * s, pose.y + p[0] * s + p[1] * c];
}

/** World-space polyline of one link (its local segments, end to end). */
function linkPolyline(pose, segments) {
  const pts = [];
  for (const [a, b] of segments) {
    if (pts.length === 0) pts.push(pw(pose, a));
    pts.push(pw(pose, b));
  }
  return pts;
}

/** Bounding box over every link of every frame. */
function motionBounds(frames, linkSegments) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const fr of frames) {
    for (let li = 0; li < linkSegments.length; li++) {
      if (!linkSegments[li]?.length) continue;
      for (const p of linkPolyline(fr.links[li], linkSegments[li])) {
        if (p[0] < minX) minX = p[0]; if (p[0] > maxX) maxX = p[0];
        if (p[1] < minY) minY = p[1]; if (p[1] > maxY) maxY = p[1];
      }
    }
  }
  return { minX, maxX, minY, maxY };
}

/**
 * Render one motion frame to an SVG `<g>` body (links as polylines).
 * The projection flips Y so +Y is up, like the viewport.
 */
function frameGroup(frame, linkSegments, bounds, margin, colors) {
  const proj = (p) => [
    margin + (p[0] - bounds.minX),
    margin + (bounds.maxY - p[1]),
  ];
  const lines = [];
  for (let li = 0; li < linkSegments.length; li++) {
    if (!linkSegments[li]?.length) continue;
    const pts = linkPolyline(frame.links[li], linkSegments[li]).map(proj);
    const pointsAttr = pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    lines.push(`<polyline points="${pointsAttr}" fill="none" `
      + `stroke="${colors[li % colors.length]}" stroke-width="2"/>`);
  }
  return lines.join('');
}

const LINK_COLORS = ['#888', '#8b1538', '#3060c0', '#c8a04a', '#2a8f5a', '#9a4ec0'];

/**
 * Render a filmstrip: `count` evenly-spaced frames side by side. A
 * deterministic deliverable artifact — the whole animation at a glance.
 *
 * @returns {string} standalone SVG
 */
export function motionFilmstripSVG(frames, linkSegments, opts = {}) {
  const count = Math.min(opts.count ?? 8, frames.length);
  const margin = 10;
  const b = motionBounds(frames, linkSegments);
  const panelW = (b.maxX - b.minX) + 2 * margin;
  const panelH = (b.maxY - b.minY) + 2 * margin;
  const svg = [`<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${(panelW * count).toFixed(0)}" `
    + `height="${panelH.toFixed(0)}" viewBox="0 0 ${(panelW * count).toFixed(2)} ${panelH.toFixed(2)}">`,
    `<rect width="100%" height="100%" fill="white"/>`];
  for (let i = 0; i < count; i++) {
    const fi = Math.round((i / (count - 1 || 1)) * (frames.length - 1));
    svg.push(`<g transform="translate(${(i * panelW).toFixed(2)},0)">`);
    svg.push(`<rect width="${panelW.toFixed(2)}" height="${panelH.toFixed(2)}" `
      + `fill="none" stroke="#ddd"/>`);
    svg.push(frameGroup(frames[fi], linkSegments, b, margin, LINK_COLORS));
    svg.push(`<text x="4" y="12" font-family="monospace" font-size="9" fill="#444">`
      + `t=${frames[fi].t.toFixed(2)}</text>`);
    svg.push(`</g>`);
  }
  svg.push(`</svg>`);
  return svg.join('\n');
}

/**
 * Render a self-contained SMIL-animated SVG: each link is one polyline
 * whose `points` attribute is animated through every frame. The file
 * plays the motion study on its own — and every frame's geometry is
 * literally in the markup, so it is fully verifiable.
 *
 * @returns {string} standalone animated SVG
 */
export function motionAnimatedSVG(frames, linkSegments, opts = {}) {
  const durationSec = opts.durationSec ?? 3;
  const margin = 10;
  const b = motionBounds(frames, linkSegments);
  const w = (b.maxX - b.minX) + 2 * margin;
  const h = (b.maxY - b.minY) + 2 * margin;
  const proj = (p) => [margin + (p[0] - b.minX), margin + (b.maxY - p[1])];

  const svg = [`<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w.toFixed(0)}" height="${h.toFixed(0)}" `
    + `viewBox="0 0 ${w.toFixed(2)} ${h.toFixed(2)}">`,
    `<rect width="100%" height="100%" fill="white"/>`];

  const keyTimes = frames.map((_, i) => (i / (frames.length - 1)).toFixed(4)).join(';');
  for (let li = 0; li < linkSegments.length; li++) {
    if (!linkSegments[li]?.length) continue;
    // The animated `points` value list — one entry per frame.
    const values = frames.map((fr) =>
      linkPolyline(fr.links[li], linkSegments[li]).map(proj)
        .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')).join(';');
    const first = values.split(';')[0];
    svg.push(`<polyline points="${first}" fill="none" `
      + `stroke="${LINK_COLORS[li % LINK_COLORS.length]}" stroke-width="2">`);
    svg.push(`<animate attributeName="points" dur="${durationSec}s" `
      + `repeatCount="indefinite" keyTimes="${keyTimes}" values="${values}"/>`);
    svg.push(`</polyline>`);
  }
  svg.push(`</svg>`);
  return svg.join('\n');
}

/**
 * Count the SMIL keyframes embedded in an animated SVG — lets a test
 * confirm every motion frame made it into the artifact.
 */
export function countAnimatedFrames(animatedSVG) {
  const m = animatedSVG.match(/keyTimes="([^"]+)"/);
  return m ? m[1].split(';').length : 0;
}
