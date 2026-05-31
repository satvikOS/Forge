/**
 * ArchDisc Foundation — 3-axis CAM toolpath generation.
 *
 * Consumes the output of `FeatureRecognition.recognize()` plus a stock
 * description and emits Fanuc/LinuxCNC-compatible G-code that would
 * actually run on a 3-axis vertical mill.
 *
 * Operations supported in this MVP:
 *
 *   1. Drill cycles (G81 / G83 peck) for cylindrical features whose
 *      axis is approximately vertical. One drill per through-hole.
 *
 *   2. Outer-profile contour mill — G1 along the outline of the
 *      part's projection onto the XY plane at a chosen depth-of-cut.
 *
 *   3. Pocket clearing for planar concave regions (rectangular bbox
 *      pocket clear via parallel passes).
 *
 * What is intentionally simplified for the MVP:
 *   - tool-radius compensation (G41/G42) — only G40-style "centerline"
 *     paths are emitted; offsets must be applied externally.
 *   - tool-change logic (M6 + tool-length offsets) — we just emit
 *     comments noting the required tool.
 *   - safe-height computation per-operation — we use a single fixed
 *     plane above the stock.
 *   - undercut / overhang detection — the part must be flat-bottomed
 *     and have all features accessible from +Z.
 *
 * Output format: standard Fanuc-style G-code with M-codes, RS274D
 * conventions:
 *
 *   G21 ; mm
 *   G17 ; XY plane
 *   G90 ; absolute
 *   G94 ; feed per minute
 *   T1  M6 ; load tool 1 (drill)
 *   S{rpm} M3 ; spindle on, CW
 *   G81 X{x} Y{y} Z{depth} R{retract} F{feed}
 *   ...
 *   M5 ; spindle off
 *   M30 ; program end
 */

const PI = Math.PI;

/**
 * Generate a peck-drill cycle for a list of through-holes.
 *
 * @param {Array<{x, y, diameter, depth}>} holes
 * @param {object} opts
 *   tool          tool number (default T1)
 *   toolName      e.g. "Ø6 HSS twist drill" (comment)
 *   rpm           default 1500
 *   feedMmPerMin  default 100
 *   safeHeightMm  Z above stock for travel (default 5)
 *   retractMm     R-plane in canned cycle (default 2)
 *   pecking       use G83 (true) vs G81 (false) — default true if depth > 3 × dia
 * @returns {string} G-code block
 */
export function drillCycle(holes, opts = {}) {
  const tool = opts.tool ?? 1;
  const toolName = opts.toolName ?? 'drill';
  const rpm = opts.rpm ?? 1500;
  const feed = opts.feedMmPerMin ?? 100;
  const safeZ = opts.safeHeightMm ?? 5;
  const Rretract = opts.retractMm ?? 2;
  const out = [];
  out.push(`( --- DRILL ${holes.length} holes, ${toolName} --- )`);
  out.push(`T${tool} M6 ( load tool ${tool}: ${toolName} )`);
  out.push(`S${rpm} M3`);
  out.push(`G0 Z${safeZ.toFixed(2)}`);
  for (let i = 0; i < holes.length; i++) {
    const h = holes[i];
    const cycleCmd = (opts.pecking ?? (h.depth > 3 * h.diameter)) ? 'G83' : 'G81';
    const peckArg = cycleCmd === 'G83' ? ` Q${(h.diameter * 0.5).toFixed(2)}` : '';
    out.push(`G0 X${h.x.toFixed(3)} Y${h.y.toFixed(3)}`);
    out.push(`${cycleCmd} X${h.x.toFixed(3)} Y${h.y.toFixed(3)} Z${(-h.depth).toFixed(3)} R${Rretract.toFixed(2)}${peckArg} F${feed}`);
  }
  out.push('G80');
  out.push('M5');
  return out.join('\n');
}

/**
 * Generate an outer-profile contour milling block.
 *
 * The profile is given as an ordered closed polygon in XY (already at
 * the desired tool-center offset; this MVP doesn't compute G41/G42).
 * Multiple Z passes if the depth exceeds depthPerPass.
 *
 * @param {Array<[x,y]>} profile - closed polygon (CCW for outer)
 * @param {object} opts
 *   tool, toolName, rpm, feedMmPerMin
 *   totalDepthMm     default 5
 *   depthPerPassMm   default 2 (so totalDepth / dPerPass passes)
 *   safeHeightMm     default 5
 */
export function contourMill(profile, opts = {}) {
  const tool = opts.tool ?? 2;
  const toolName = opts.toolName ?? 'end-mill';
  const rpm = opts.rpm ?? 3000;
  const feed = opts.feedMmPerMin ?? 600;
  const safeZ = opts.safeHeightMm ?? 5;
  const total = opts.totalDepthMm ?? 5;
  const dPass = opts.depthPerPassMm ?? 2;
  const passes = Math.max(1, Math.ceil(total / dPass));
  const out = [];
  out.push(`( --- CONTOUR mill outer profile, ${profile.length} pts, ${passes} passes, ${toolName} --- )`);
  out.push(`T${tool} M6 ( load tool ${tool}: ${toolName} )`);
  out.push(`S${rpm} M3`);
  out.push(`G0 Z${safeZ.toFixed(2)}`);
  out.push(`G0 X${profile[0][0].toFixed(3)} Y${profile[0][1].toFixed(3)}`);
  for (let p = 1; p <= passes; p++) {
    const z = -Math.min(p * dPass, total);
    out.push(`( --- pass ${p}, z = ${z.toFixed(2)} mm --- )`);
    out.push(`G1 Z${z.toFixed(3)} F${(feed / 4).toFixed(0)}`);
    for (let i = 1; i < profile.length; i++) {
      out.push(`G1 X${profile[i][0].toFixed(3)} Y${profile[i][1].toFixed(3)} F${feed}`);
    }
    out.push(`G1 X${profile[0][0].toFixed(3)} Y${profile[0][1].toFixed(3)} F${feed}`);
  }
  out.push(`G0 Z${safeZ.toFixed(2)}`);
  out.push('M5');
  return out.join('\n');
}

/**
 * Spiral pocket clearing for a rectangular pocket. The pocket is
 * defined by its bbox + final depth. Tool starts at center, spirals
 * outward in equally-spaced passes, then finishes with a perimeter cut.
 *
 * @param {object} pocket - { xmin, ymin, xmax, ymax, depth }
 * @param {object} opts
 *   tool, toolName, rpm, feedMmPerMin
 *   stepoverMm   - radial stepover per pass (default 0.6 × dia)
 *   toolDiaMm    - tool diameter (default 6)
 */
export function pocketClear(pocket, opts = {}) {
  const tool = opts.tool ?? 3;
  const toolName = opts.toolName ?? 'pocket end-mill';
  const rpm = opts.rpm ?? 4000;
  const feed = opts.feedMmPerMin ?? 800;
  const safeZ = opts.safeHeightMm ?? 5;
  const dPass = opts.depthPerPassMm ?? 1.5;
  const total = pocket.depth;
  const passes = Math.max(1, Math.ceil(total / dPass));
  const dia = opts.toolDiaMm ?? 6;
  const stepover = opts.stepoverMm ?? 0.6 * dia;
  const halfDia = dia / 2;

  const out = [];
  out.push(`( --- POCKET clear ${pocket.xmin.toFixed(2)},${pocket.ymin.toFixed(2)} → ${pocket.xmax.toFixed(2)},${pocket.ymax.toFixed(2)}, depth ${total}, ${toolName} Ø${dia} --- )`);
  out.push(`T${tool} M6 ( load tool ${tool}: ${toolName} )`);
  out.push(`S${rpm} M3`);
  out.push(`G0 Z${safeZ.toFixed(2)}`);

  for (let p = 1; p <= passes; p++) {
    const z = -Math.min(p * dPass, total);
    out.push(`( --- pocket pass ${p}, z = ${z.toFixed(2)} mm --- )`);
    // Concentric rectangular passes inset from outer
    let x0 = pocket.xmin + halfDia;
    let y0 = pocket.ymin + halfDia;
    let x1 = pocket.xmax - halfDia;
    let y1 = pocket.ymax - halfDia;
    let first = true;
    while (x1 > x0 && y1 > y0) {
      if (first) {
        out.push(`G0 X${x0.toFixed(3)} Y${y0.toFixed(3)}`);
        out.push(`G1 Z${z.toFixed(3)} F${(feed / 4).toFixed(0)}`);
        first = false;
      } else {
        out.push(`G1 X${x0.toFixed(3)} Y${y0.toFixed(3)} F${feed}`);
      }
      out.push(`G1 X${x1.toFixed(3)} Y${y0.toFixed(3)} F${feed}`);
      out.push(`G1 X${x1.toFixed(3)} Y${y1.toFixed(3)} F${feed}`);
      out.push(`G1 X${x0.toFixed(3)} Y${y1.toFixed(3)} F${feed}`);
      out.push(`G1 X${x0.toFixed(3)} Y${y0.toFixed(3)} F${feed}`);
      x0 += stepover; y0 += stepover; x1 -= stepover; y1 -= stepover;
    }
  }
  out.push(`G0 Z${safeZ.toFixed(2)}`);
  out.push('M5');
  return out.join('\n');
}

/**
 * Compose a complete G-code program from a header + multiple operation
 * blocks + footer.
 */
export function programWrap(operationBlocks, opts = {}) {
  const partName = opts.partName ?? 'ArchDisc Part';
  const out = [];
  out.push('%');
  out.push(`( ArchDisc Foundation CAM — ${partName} )`);
  out.push(`( generated ${new Date().toISOString().slice(0, 19)} )`);
  out.push('G21 ( mm )');
  out.push('G17 ( XY plane )');
  out.push('G90 ( absolute )');
  out.push('G94 ( feed per min )');
  out.push('G54 ( WCS 1 )');
  out.push('G40 ( cancel cutter comp )');
  out.push('G49 ( cancel tool length offset )');
  out.push('M5  ( spindle off )');
  for (const block of operationBlocks) {
    out.push('');
    out.push(block);
  }
  out.push('');
  out.push('G0 Z25 ( safe retract )');
  out.push('M5');
  out.push('M30 ( program end )');
  out.push('%');
  return out.join('\n');
}

/**
 * Convenience: build a full CAM program from FeatureRecognition output.
 * Looks at every cylindrical patch with vertical axis (n_z > 0.95) and
 * generates a drill cycle for each unique (x,y, diameter, depth) hole.
 *
 * @param {object} args
 * @param {object} args.recognition  - return of FeatureRecognition.recognize(manifold)
 * @param {object} args.bbox         - manifold bounding box
 * @param {object} args.opts         - drilling/milling parameters
 * @returns {object} { holes, gcode, stats }
 */
export function generateCAMFromFeatures({ recognition, bbox, opts = {} }) {
  // Group cylindrical patches by (x, y, diameter) within an XY tolerance
  const cyls = recognition.summary.cylinders || recognition.cylinders || [];
  const tol = opts.holeTol ?? 0.5;
  const verticalAxisDot = opts.verticalAxisDot ?? 0.95;
  const stockTopZ = opts.stockTopZ ?? bbox.max[2];
  const stockBotZ = opts.stockBotZ ?? bbox.min[2];

  const groups = [];
  for (const c of cyls) {
    if (!c.axis) continue;
    const az = Math.abs(c.axis[2]);
    if (az < verticalAxisDot) continue;     // not vertical
    const x = c.axisPoint[0], y = c.axisPoint[1];
    let g = groups.find(g => Math.hypot(g.x - x, g.y - y) < tol && Math.abs(g.diameter - c.diameter) < tol);
    if (!g) {
      g = { x, y, diameter: c.diameter, axialExtent: c.axialExtent };
      groups.push(g);
    }
  }
  // Build hole list (treat depth = stock thickness for through-holes)
  const stockDepth = stockTopZ - stockBotZ;
  const holes = groups.map(g => ({ x: g.x, y: g.y, diameter: g.diameter, depth: stockDepth }));

  // Outer-profile contour from manifold's XY footprint — for the MVP we
  // approximate as the bbox rectangle.
  const profile = [
    [bbox.min[0], bbox.min[1]],
    [bbox.max[0], bbox.min[1]],
    [bbox.max[0], bbox.max[1]],
    [bbox.min[0], bbox.max[1]],
    [bbox.min[0], bbox.min[1]],
  ];

  const blocks = [];
  if (holes.length) blocks.push(drillCycle(holes, {
    tool: 1, toolName: `Ø${holes[0]?.diameter.toFixed(2) ?? '?'} HSS drill`,
    rpm: 1500, feedMmPerMin: 100,
    safeHeightMm: stockTopZ + 5,
  }));
  blocks.push(contourMill(profile, {
    tool: 2, toolName: 'Ø6 carbide end-mill',
    rpm: 3000, feedMmPerMin: 600,
    safeHeightMm: stockTopZ + 5,
    totalDepthMm: stockDepth, depthPerPassMm: 2,
  }));

  const gcode = programWrap(blocks, { partName: opts.partName ?? 'feature-driven part' });
  return {
    holes,
    profile,
    gcode,
    stats: {
      lines: gcode.split('\n').length,
      drillCycleCount: holes.length,
      contourPassCount: Math.ceil(stockDepth / 2),
    },
  };
}
