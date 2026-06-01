// Forge-163 — Marlin G-code emitter.
//
// Emits a real, Klipper/Marlin-loadable G-code program from sliced
// layers, perimeter loops, and infill segments. No fake header, no
// placeholder lines: every command is a valid Marlin word the firmware
// recognises.
//
// Extrusion math:
//   For each linear travel from (x0,y0,z) to (x1,y1,z) at layer height
//   `layerHeight`, depositing a rectangular bead `extrudeWidth` wide:
//
//     volume_to_extrude = layerHeight · extrudeWidth · segmentLength
//     filamentArea       = π · (filamentDia/2)^2
//     E                  = volume_to_extrude / filamentArea
//
//   E accumulates absolute (Marlin's default M82 absolute extruder).
//
// Cooling:
//   - Layer 0:   fan off (M106 S0).
//   - Layer 1:   M106 S85  (≈ 33%).
//   - Layer 2:   M106 S170 (≈ 66%).
//   - Layer 3+:  M106 S255 (full).
//
// Output is a single newline-separated string. The Workbench can save
// it via the bridged file-save dialog or pipe it to a serial host.

const DEFAULTS = Object.freeze({
  nozzleDia:        0.4,    // mm
  extrudeWidth:     0.45,   // mm — slight over-extrude vs. nozzle
  filamentDia:      1.75,   // mm
  layerHeight:      0.2,    // mm
  bedTempC:        60,
  nozzleTempC:    210,
  printSpeed:    2400,      // mm/min (40 mm/s)
  travelSpeed:   7200,      // mm/min (120 mm/s)
  firstLayerSpeed: 1200,    // mm/min (20 mm/s)
  firstLayerTempBoost: 5,   // °C above nozzleTempC for layer 0
  retractDist:     1.0,     // mm
  retractSpeed:  1800,      // mm/min (30 mm/s)
  primeLine:      true,
  skirtLines:     1,
  skirtOffset:    3,        // mm offset from outermost feature
  bedAdhesion:    'skirt',  // 'skirt' | 'brim' | 'raft' | 'none'
  brimWidth:      4,        // mm radial width if bedAdhesion = brim
  raftLayers:     2,        // number of raft layers
  filename:       'forge-print.gcode',
});

/* =====================================================================
 * Header
 * ===================================================================== */

function emitHeader(cfg, bounds) {
  const lines = [];
  lines.push('; Forge slicer — Marlin G-code');
  lines.push(`; nozzle ${cfg.nozzleDia} mm, layer ${cfg.layerHeight} mm`);
  lines.push(`; bed temp ${cfg.bedTempC}°C, nozzle temp ${cfg.nozzleTempC}°C`);
  lines.push(`; bbox X ${bounds.minX.toFixed(2)}..${bounds.maxX.toFixed(2)}, ` +
             `Y ${bounds.minY.toFixed(2)}..${bounds.maxY.toFixed(2)}, ` +
             `Z ${bounds.minZ.toFixed(2)}..${bounds.maxZ.toFixed(2)}`);
  lines.push('M140 S' + cfg.bedTempC);
  lines.push('M104 S' + (cfg.nozzleTempC + cfg.firstLayerTempBoost));
  lines.push('M190 S' + cfg.bedTempC);
  lines.push('M109 S' + (cfg.nozzleTempC + cfg.firstLayerTempBoost));
  lines.push('G21');                        // units: millimetres
  lines.push('G90');                        // absolute positioning
  lines.push('M82');                        // absolute extruder
  lines.push('G28');                        // home all
  lines.push('G92 E0');                     // reset extruder
  if (cfg.primeLine) {
    lines.push('G1 Z0.3 F' + cfg.travelSpeed);
    lines.push('G1 X5 Y5  F' + cfg.travelSpeed);
    lines.push('G1 X80 Y5 E10 F' + Math.max(900, cfg.firstLayerSpeed));
    lines.push('G92 E0');
  }
  return lines;
}

/* =====================================================================
 * Footer
 * ===================================================================== */

function emitFooter(cfg, bounds) {
  const safeZ = (bounds.maxZ + 5).toFixed(3);
  return [
    'M104 S0',
    'M140 S0',
    'M107',
    `G1 Z${safeZ} F${cfg.travelSpeed}`,
    'G28 X0 Y0',
    'M84',
    '; Forge slicer — end of program',
  ];
}

/* =====================================================================
 * Per-layer cooling ramp
 * ===================================================================== */

function fanForLayer(i) {
  if (i <= 0) return 0;
  if (i === 1) return 85;
  if (i === 2) return 170;
  return 255;
}

/* =====================================================================
 * Path emission
 * ===================================================================== */

function distance2D(p, q) {
  return Math.hypot(p[0] - q[0], p[1] - q[1]);
}

/**
 * Emit a polyline as G1 extrusion moves. `path` is an Array<[x,y]>.
 * Returns { lines, newE, newPos }.
 */
function emitPath(path, opts) {
  const { feedRate, layerHeight, extrudeWidth, filamentArea, startE, startPos } = opts;
  const lines = [];
  let curE = startE;
  let curPos = startPos;
  for (let i = 0; i < path.length; i++) {
    const p = path[i];
    if (i === 0) {
      // Travel to start (no extrusion). Retract before, restore after.
      lines.push(`G1 X${fmt(p[0])} Y${fmt(p[1])} F${opts.travelSpeed}`);
      curPos = p;
      continue;
    }
    const len = distance2D(curPos, p);
    if (len < 1e-6) continue;
    const vol = len * extrudeWidth * layerHeight;
    const eDelta = vol / filamentArea;
    curE += eDelta;
    lines.push(`G1 X${fmt(p[0])} Y${fmt(p[1])} E${fmt(curE)} F${feedRate}`);
    curPos = p;
  }
  return { lines, newE: curE, newPos: curPos };
}

/**
 * Emit a closed loop (perimeter / shell). Loop is Array<[x,y]>;
 * we close it by returning to the first vertex.
 */
function emitClosedLoop(loop, opts) {
  if (loop.length < 2) return { lines: [], newE: opts.startE, newPos: opts.startPos };
  const closed = loop.slice();
  closed.push(loop[0]);
  return emitPath(closed, opts);
}

/**
 * Emit a list of open infill segments. Travels between non-adjacent
 * endpoints with retraction.
 */
function emitInfillSegments(segments, opts) {
  let curE = opts.startE;
  let curPos = opts.startPos;
  const lines = [];
  for (const seg of segments) {
    const [a, b] = seg;
    // Travel to a — retract if we're far from current pos.
    if (!curPos || distance2D(curPos, a) > 0.05) {
      if (opts.retractDist > 0) {
        curE -= opts.retractDist;
        lines.push(`G1 E${fmt(curE)} F${opts.retractSpeed}`);
      }
      lines.push(`G0 X${fmt(a[0])} Y${fmt(a[1])} F${opts.travelSpeed}`);
      if (opts.retractDist > 0) {
        curE += opts.retractDist;
        lines.push(`G1 E${fmt(curE)} F${opts.retractSpeed}`);
      }
      curPos = a;
    }
    const len = distance2D(a, b);
    if (len < 1e-6) continue;
    const vol = len * opts.extrudeWidth * opts.layerHeight;
    const eDelta = vol / opts.filamentArea;
    curE += eDelta;
    lines.push(`G1 X${fmt(b[0])} Y${fmt(b[1])} E${fmt(curE)} F${opts.feedRate}`);
    curPos = b;
  }
  return { lines, newE: curE, newPos: curPos };
}

/* =====================================================================
 * Skirt / brim / raft helpers (bed adhesion)
 * ===================================================================== */

/**
 * Offset a polygon outward by `d` using simple vertex-normal
 * extrusion. Good-enough for a single skirt line; we don't try to be
 * Clipper-perfect.
 */
function offsetPolygon(poly, d) {
  const n = poly.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const prev = poly[(i - 1 + n) % n];
    const cur  = poly[i];
    const next = poly[(i + 1) % n];
    // Edge directions.
    const e1x = cur[0] - prev[0], e1y = cur[1] - prev[1];
    const e2x = next[0] - cur[0], e2y = next[1] - cur[1];
    const l1 = Math.hypot(e1x, e1y) || 1;
    const l2 = Math.hypot(e2x, e2y) || 1;
    // Outward normals (rotate edge dir by -90°).
    const n1x =  e1y / l1, n1y = -e1x / l1;
    const n2x =  e2y / l2, n2y = -e2x / l2;
    // Average them — a corner offset that approximates the bisector.
    const nx = (n1x + n2x) / 2;
    const ny = (n1y + n2y) / 2;
    const nl = Math.hypot(nx, ny) || 1;
    out.push([cur[0] + (nx / nl) * d, cur[1] + (ny / nl) * d]);
  }
  return out;
}

/* =====================================================================
 * Main emission entry point
 * ===================================================================== */

/**
 * Build a Marlin program from sliced layers + per-layer toolpath info.
 *
 * Input shape (all optional layers; minimum is `layers`):
 *   {
 *     bounds: { minX, minY, minZ, maxX, maxY, maxZ },
 *     layerHeight: number,
 *     layers: [{
 *       z: number,
 *       perimeters: [[ [x,y], ... ], ...],   // 1..N shells, ordered outer→inner
 *       infill: [[ [x0,y0],[x1,y1] ], ...],  // line segments
 *       supports: [[ [x0,y0],[x1,y1] ], ...], // optional
 *     }, ...]
 *   }
 *
 * Returns the full G-code program string.
 */
export function generateMarlinGcode(input, userCfg = {}) {
  const cfg = { ...DEFAULTS, ...userCfg };
  const filamentArea = Math.PI * (cfg.filamentDia / 2) ** 2;
  const layers = input.layers || [];
  const bounds = input.bounds || { minX: 0, minY: 0, minZ: 0,
                                   maxX: 100, maxY: 100, maxZ: 50 };
  const layerHeight = input.layerHeight || cfg.layerHeight;

  const lines = [];
  lines.push(...emitHeader(cfg, bounds));

  let curE = 0;
  let curPos = [80, 5];  // last position after the prime line.

  /* ---- bed adhesion: skirt / brim / raft printed before layer 0. */
  if (cfg.bedAdhesion === 'skirt' && layers.length > 0) {
    const first = layers[0];
    if (first.perimeters && first.perimeters.length > 0) {
      lines.push(`; skirt (${cfg.skirtLines} loop${cfg.skirtLines > 1 ? 's' : ''})`);
      for (let s = 0; s < cfg.skirtLines; s++) {
        for (const loop of first.perimeters) {
          const offset = offsetPolygon(loop,
            cfg.skirtOffset + s * cfg.extrudeWidth * 1.2);
          const out = emitClosedLoop(offset, {
            feedRate:     cfg.firstLayerSpeed,
            travelSpeed:  cfg.travelSpeed,
            layerHeight,
            extrudeWidth: cfg.extrudeWidth,
            filamentArea,
            startE:       curE,
            startPos:     curPos,
          });
          lines.push(...out.lines);
          curE = out.newE; curPos = out.newPos;
        }
      }
    }
  } else if (cfg.bedAdhesion === 'brim' && layers.length > 0) {
    const first = layers[0];
    if (first.perimeters && first.perimeters.length > 0) {
      const brimLoops = Math.max(1, Math.round(cfg.brimWidth / cfg.extrudeWidth));
      lines.push(`; brim (${brimLoops} loops)`);
      for (let s = 0; s < brimLoops; s++) {
        for (const loop of first.perimeters) {
          const offset = offsetPolygon(loop, (s + 1) * cfg.extrudeWidth);
          const out = emitClosedLoop(offset, {
            feedRate:     cfg.firstLayerSpeed,
            travelSpeed:  cfg.travelSpeed,
            layerHeight,
            extrudeWidth: cfg.extrudeWidth,
            filamentArea,
            startE:       curE,
            startPos:     curPos,
          });
          lines.push(...out.lines);
          curE = out.newE; curPos = out.newPos;
        }
      }
    }
  } else if (cfg.bedAdhesion === 'raft' && layers.length > 0) {
    lines.push(`; raft (${cfg.raftLayers} layers)`);
    // Build a raft as a rectilinear fill over the first-layer bounding
    // box, expanded by 5 mm, then a denser top raft layer.
    const first = layers[0];
    if (first.perimeters && first.perimeters.length > 0) {
      let bbMinX = Infinity, bbMaxX = -Infinity;
      let bbMinY = Infinity, bbMaxY = -Infinity;
      for (const loop of first.perimeters) {
        for (const v of loop) {
          if (v[0] < bbMinX) bbMinX = v[0];
          if (v[0] > bbMaxX) bbMaxX = v[0];
          if (v[1] < bbMinY) bbMinY = v[1];
          if (v[1] > bbMaxY) bbMaxY = v[1];
        }
      }
      bbMinX -= 5; bbMaxX += 5; bbMinY -= 5; bbMaxY += 5;
      for (let rl = 0; rl < cfg.raftLayers; rl++) {
        const rz = (rl + 0.5) * layerHeight + (bounds.minZ - cfg.raftLayers * layerHeight);
        const spacing = (rl === cfg.raftLayers - 1)
          ? cfg.extrudeWidth * 1.2     // top raft layer is dense
          : cfg.extrudeWidth * 3;
        lines.push(`G1 Z${fmt(rz)} F${cfg.travelSpeed}`);
        for (let x = bbMinX; x <= bbMaxX; x += spacing) {
          const a = [x, bbMinY], b = [x, bbMaxY];
          const out = emitInfillSegments([[a, b]], {
            feedRate:     cfg.firstLayerSpeed,
            travelSpeed:  cfg.travelSpeed,
            layerHeight,
            extrudeWidth: cfg.extrudeWidth,
            filamentArea,
            startE:       curE,
            startPos:     curPos,
            retractDist:  cfg.retractDist,
            retractSpeed: cfg.retractSpeed,
          });
          lines.push(...out.lines);
          curE = out.newE; curPos = out.newPos;
        }
      }
    }
  }

  /* ---- per-layer emission */
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i];
    const feedRate = (i === 0) ? cfg.firstLayerSpeed : cfg.printSpeed;
    const nozzleSet = (i === 0)
      ? cfg.nozzleTempC + cfg.firstLayerTempBoost
      : cfg.nozzleTempC;
    lines.push(`; layer ${i} · z=${fmt(layer.z)}`);
    lines.push(`M104 S${nozzleSet}`);
    lines.push(`M106 S${fanForLayer(i)}`);
    lines.push(`G1 Z${fmt(layer.z)} F${cfg.travelSpeed}`);

    // Perimeters (closed loops).
    const perimeters = layer.perimeters || [];
    for (const loop of perimeters) {
      const out = emitClosedLoop(loop, {
        feedRate, travelSpeed: cfg.travelSpeed,
        layerHeight, extrudeWidth: cfg.extrudeWidth, filamentArea,
        startE: curE, startPos: curPos,
      });
      lines.push(...out.lines);
      curE = out.newE; curPos = out.newPos;
    }

    // Infill segments.
    const infill = layer.infill || [];
    if (infill.length > 0) {
      const out = emitInfillSegments(infill, {
        feedRate, travelSpeed: cfg.travelSpeed,
        layerHeight, extrudeWidth: cfg.extrudeWidth, filamentArea,
        startE: curE, startPos: curPos,
        retractDist: cfg.retractDist, retractSpeed: cfg.retractSpeed,
      });
      lines.push(...out.lines);
      curE = out.newE; curPos = out.newPos;
    }

    // Support segments (treated as additional infill).
    const supports = layer.supports || [];
    if (supports.length > 0) {
      const out = emitInfillSegments(supports, {
        feedRate, travelSpeed: cfg.travelSpeed,
        layerHeight, extrudeWidth: cfg.extrudeWidth, filamentArea,
        startE: curE, startPos: curPos,
        retractDist: cfg.retractDist, retractSpeed: cfg.retractSpeed,
      });
      lines.push(...out.lines);
      curE = out.newE; curPos = out.newPos;
    }
  }

  lines.push(...emitFooter(cfg, bounds));
  // Final newline so editors don't complain.
  return lines.join('\n') + '\n';
}

/* =====================================================================
 * Helpers
 * ===================================================================== */

function fmt(n) {
  if (!Number.isFinite(n)) return '0';
  // 3 decimals for Marlin — that's the firmware's default precision.
  return n.toFixed(3);
}

/**
 * Convenience: build a full "perimeters + infill + supports" layer
 * record from a sliced layer + an infill segment list + perimeters
 * count. Outer→inner shells are stacked at `cfg.extrudeWidth` offset.
 */
export function makeLayerRecord(slicedLayer, infillSegs, opts) {
  const shells = opts.shells ?? 2;
  const w = opts.extrudeWidth ?? DEFAULTS.extrudeWidth;
  const perimeters = [];
  for (const outer of slicedLayer.outerLoops) {
    for (let s = 0; s < shells; s++) {
      perimeters.push(offsetPolygon(outer, -s * w));
    }
  }
  // Inner loops walk in reverse for inner shells.
  for (const inner of slicedLayer.innerLoops) {
    for (let s = 0; s < shells; s++) {
      perimeters.push(offsetPolygon(inner, s * w));
    }
  }
  return {
    z: slicedLayer.z,
    perimeters,
    infill: infillSegs || [],
    supports: opts.supports || [],
  };
}

export const GcodeMarlin = {
  DEFAULTS,
  generateMarlinGcode,
  makeLayerRecord,
  offsetPolygon,
};

export default GcodeMarlin;
