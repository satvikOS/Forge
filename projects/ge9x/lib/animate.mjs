/**
 * GE9X build — animation generation.
 *
 *   working  — front-view fan spool-up (16 swept blades accelerating
 *              from rest to redline), with a live spool-speed readout.
 *   assembly — side-view module assembly sequence, ordered and timed by
 *              foundation.generateAssemblySequence.
 *
 * Each animation is emitted as a self-contained SMIL-animated SVG and
 * as a numbered PNG frame sequence ready for ffmpeg encoding.
 */

import { makeCanvas, fillCircle, ring, fillPoly, line, fillRect, encodePNG }
  from './raster.mjs';
import { generateAssemblySequence } from '../../../frontend/src/foundation/AssemblySequence.js';
import { GE9X } from './spec.mjs';

const TAU = Math.PI * 2;

// ── Working animation: front-view fan spool-up ─────────────────────

/** One swept fan-blade polygon, hub→tip, rotated to angle `phi`. */
function fanBladePoly(cx, cy, phi, rHub, rTip, steps = 9) {
  const sweep = 0.42;                       // total angular sweep, root→tip
  const lead = [], trail = [];
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const r = rHub + (rTip - rHub) * f;
    const camber = sweep * f * f;
    const halfChord = 0.085 + 0.075 * f;    // angular half-chord widens to tip
    lead.push([cx + r * Math.cos(phi + camber - halfChord),
               cy + r * Math.sin(phi + camber - halfChord)]);
    trail.push([cx + r * Math.cos(phi + camber + halfChord),
                cy + r * Math.sin(phi + camber + halfChord)]);
  }
  return [...lead, ...trail.reverse()];
}

/** Render one front-view frame; returns the canvas. */
function workingFrame(W, H, angle, spoolFrac) {
  const c = makeCanvas(W, H, [12, 14, 20, 255]);
  const cx = W / 2, cy = H / 2;
  const Rnac = Math.min(W, H) * 0.46;
  const rTip = Rnac * 0.86, rHub = Rnac * 0.20;
  // Nacelle + fan case.
  ring(c, cx, cy, Rnac * 0.92, Rnac, [120, 128, 140, 255]);
  ring(c, cx, cy, rTip, Rnac * 0.92, [40, 44, 54, 255]);
  // 16 swept composite fan blades.
  for (let b = 0; b < GE9X.modules.fan.blades; b++) {
    const phi = angle + (b / GE9X.modules.fan.blades) * TAU;
    const shade = 150 + 70 * Math.sin(phi * 3);
    fillPoly(c, fanBladePoly(cx, cy, phi, rHub, rTip),
      [shade * 0.8, shade * 0.85, shade, 255]);
  }
  // Spinner with the GE swirl mark.
  fillCircle(c, cx, cy, rHub, [220, 224, 230, 255]);
  for (let s = 0; s < 220; s++) {
    const t = s / 220;
    const a = angle * 1.5 + t * TAU * 1.4;
    const r = rHub * (0.12 + 0.8 * t);
    fillCircle(c, cx + r * Math.cos(a), cy + r * Math.sin(a), 2.2, [28, 30, 38, 255]);
  }
  // Spool-speed readout bar.
  fillRect(c, 24, H - 44, 24 + (W - 48) * spoolFrac, H - 26, [70, 200, 120, 255]);
  fillRect(c, 24, H - 46, W - 24, H - 44, [60, 64, 74, 255]);
  return c;
}

/**
 * Generate the working (spool-up) animation.
 * @returns {{ svg, frames:[{name,buffer}], meta }}
 */
export function buildWorkingAnimation(opts = {}) {
  const W = opts.width ?? 640, H = opts.height ?? 640;
  const nFrames = opts.frames ?? 72;
  const turns = 7;                           // total revolutions over the clip
  const frames = [];
  const angles = [];
  for (let f = 0; f < nFrames; f++) {
    const t = f / (nFrames - 1);
    const spoolFrac = t;                     // linear ramp 0 → redline
    const angle = turns * TAU * t * t;       // ∫(ramp) → quadratic angle
    angles.push(angle);
    const canvas = workingFrame(W, H, angle, spoolFrac);
    frames.push({
      name: `working/frame_${String(f).padStart(4, '0')}.png`,
      buffer: encodePNG(W, H, canvas.px),
    });
  }
  // SMIL-animated SVG — a fan group rotating with a quadratic spool-up.
  const cx = W / 2, cy = H / 2;
  const keyTimes = angles.map((_, i) => (i / (angles.length - 1)).toFixed(4)).join(';');
  const rotValues = angles.map((a) => `${(a * 180 / Math.PI).toFixed(1)} ${cx} ${cy}`).join(';');
  const blades = [];
  for (let b = 0; b < GE9X.modules.fan.blades; b++) {
    const phi = (b / GE9X.modules.fan.blades) * TAU;
    const poly = fanBladePoly(cx, cy, phi, H * 0.092, H * 0.395)
      .map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
    blades.push(`<polygon points="${poly}" fill="#9aa2b4"/>`);
  }
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="100%" height="100%" fill="#0c0e14"/>`,
    `<circle cx="${cx}" cy="${cy}" r="${H * 0.46}" fill="none" stroke="#788" stroke-width="${H * 0.037}"/>`,
    `<g>`,
    ...blades,
    `<animateTransform attributeName="transform" type="rotate" dur="4s" `
      + `repeatCount="indefinite" keyTimes="${keyTimes}" values="${rotValues}"/>`,
    `</g>`,
    `<circle cx="${cx}" cy="${cy}" r="${H * 0.092}" fill="#dde0e6"/>`,
    `<text x="14" y="${H - 14}" font-family="monospace" font-size="13" fill="#7c8">`
      + `GE9X fan spool-up — 16 blades, redline ${GE9X.spools.LP.redline_rpm} rpm</text>`,
    `</svg>`,
  ].join('\n');
  return { svg, frames, meta: { frames: nFrames, width: W, height: H, turns } };
}

// ── Assembly animation: side-view module sequencing ────────────────

/** Inner/outer radius of a module for the meridional (side) view. */
function moduleRadii(mod) {
  if (mod.rTip !== undefined) return [mod.rHub ?? 0, mod.rTip];
  if (mod.rOuter !== undefined) return [mod.rInner ?? 0, mod.rOuter];
  if (mod.rRoot !== undefined) return [0, mod.rRoot];
  return [0, 200];
}

const MODULE_COLORS = {
  spinner: [210, 214, 220], fan: [150, 158, 172], fanCase: [90, 96, 108],
  nacelle: [70, 76, 88], booster: [120, 150, 180], hpc: [150, 130, 90],
  combustor: [200, 90, 70], hpt: [190, 110, 80], lpt: [110, 150, 120],
  coreNozzle: [90, 96, 108], plug: [200, 204, 210], lpShaft: [160, 160, 170],
  hpShaft: [140, 140, 150],
};

/** Render one side-view assembly frame given each module's x-offset. */
function assemblyFrame(W, H, offsets, scale, x0World) {
  const c = makeCanvas(W, H, [12, 14, 20, 255]);
  const cy = H / 2;
  const px = (xW) => 40 + (xW - x0World) * scale;
  const py = (rmm) => cy - rmm * scale;
  line(c, 0, cy, W, cy, [50, 54, 64, 255], 1);
  for (const [name, mod] of Object.entries(GE9X.modules)) {
    const [rIn, rOut] = moduleRadii(mod);
    const dx = offsets[name] ?? 0;
    const col = MODULE_COLORS[name] ?? [120, 120, 130];
    const xA = px(mod.x0 + dx), xB = px(mod.x1 + dx);
    // upper band + lower mirror band
    fillPoly(c, [[xA, py(rOut)], [xB, py(rOut)], [xB, py(rIn)], [xA, py(rIn)]],
      [...col, 255]);
    fillPoly(c, [[xA, py(-rIn)], [xB, py(-rIn)], [xB, py(-rOut)], [xA, py(-rOut)]],
      [col[0] * 0.7, col[1] * 0.7, col[2] * 0.7, 255]);
  }
  return c;
}

/**
 * Generate the assembly-sequence animation. Module order and timing
 * come from foundation.generateAssemblySequence.
 * @returns {{ svg, frames:[{name,buffer}], meta }}
 */
export function buildAssemblyAnimation(opts = {}) {
  const W = opts.width ?? 1100, H = opts.height ?? 460;
  const nFrames = opts.frames ?? 72;
  // Build the assembly definition: each module is a part, chained
  // fan-to-nozzle by mates, the core (HPC) as the base.
  const order = ['hpc', 'combustor', 'hpt', 'lpt', 'booster', 'fan', 'spinner',
    'hpShaft', 'lpShaft', 'fanCase', 'nacelle', 'coreNozzle', 'plug'];
  const parts = order.map((id) => {
    const mod = GE9X.modules[id];
    return { id, name: id, assembledPosition: [(mod.x0 + mod.x1) / 2, 0, 0] };
  });
  const mates = [];
  for (let i = 1; i < order.length; i++) mates.push({ a: order[0], b: order[i] });
  const seq = generateAssemblySequence({ parts, mates }, {
    baseId: 'hpc', explodeAxis: [1, 0, 0], explodeGap: 900,
  });

  // World extent for the side view (with explode headroom).
  const x0World = -1200, x1World = 6200;
  const scale = Math.min((W - 80) / (x1World - x0World), (H - 60) / 4200);

  const frames = [];
  for (let f = 0; f < nFrames; f++) {
    const t = (f / (nFrames - 1)) * seq.duration;
    const pos = seq.sample(t);
    const offsets = {};
    for (const sp of seq.parts) {
      const mod = GE9X.modules[sp.id];
      offsets[sp.id] = pos[sp.id][0] - (mod.x0 + mod.x1) / 2;   // delta from assembled
    }
    const canvas = assemblyFrame(W, H, offsets, scale, x0World);
    frames.push({
      name: `assembly/frame_${String(f).padStart(4, '0')}.png`,
      buffer: encodePNG(W, H, canvas.px),
    });
  }

  // Animated SVG — each module band slides from exploded to assembled.
  const cy = H / 2;
  const px = (xW) => 40 + (xW - x0World) * scale;
  const py = (rmm) => cy - rmm * scale;
  const svgParts = [];
  for (const sp of seq.parts) {
    const mod = GE9X.modules[sp.id];
    const [rIn, rOut] = moduleRadii(mod);
    const col = MODULE_COLORS[sp.id] ?? [120, 120, 130];
    const w = (mod.x1 - mod.x0) * scale;
    const x = px(mod.x0);
    const yU = py(rOut), hU = (rOut - rIn) * scale;
    const yL = py(-rIn), hL = (rOut - rIn) * scale;
    const dxExploded = (sp.explodedPosition[0] - sp.assembledPosition[0]) * scale;
    svgParts.push(
      `<g><rect x="${x.toFixed(1)}" y="${yU.toFixed(1)}" width="${w.toFixed(1)}" `
      + `height="${hU.toFixed(1)}" fill="rgb(${col.join(',')})"/>`
      + `<rect x="${x.toFixed(1)}" y="${yL.toFixed(1)}" width="${w.toFixed(1)}" `
      + `height="${hL.toFixed(1)}" fill="rgb(${col.map((v) => (v * 0.7) | 0).join(',')})"/>`
      + `<animateTransform attributeName="transform" type="translate" dur="5s" `
      + `repeatCount="indefinite" keyTimes="0;0.15;1" `
      + `values="${dxExploded.toFixed(1)} 0;${dxExploded.toFixed(1)} 0;0 0"/></g>`);
  }
  const svg = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="100%" height="100%" fill="#0c0e14"/>`,
    `<line x1="0" y1="${cy}" x2="${W}" y2="${cy}" stroke="#343a46"/>`,
    ...svgParts,
    `<text x="14" y="${H - 12}" font-family="monospace" font-size="13" fill="#8af">`
      + `GE9X assembly sequence — ${seq.order.length} modules, order from the mate graph</text>`,
    `</svg>`,
  ].join('\n');
  return { svg, frames, meta: { frames: nFrames, width: W, height: H, order: seq.order } };
}
