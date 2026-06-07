// PUSH-181 (Slice-137) — CNC Setup Sheet math.
//
// Pure-function dispatch for the CNC Setup Sheet generator. Reads the
// per-op CAM results published by PUSH-46 (cam.profile / pocket /
// faceMill etc. via ManufacturingWorkbench), PUSH-98 (DrillingPattern),
// and PUSH-117 (CamAdaptive), plus a stock body record, and produces
// the structured setup sheet the machine operator carries to the
// machine: program meta, op-by-op summary (tool, RPM, feed, depth,
// est cycle time), running total cycle time, and a tool-change list.
//
// Designed so the e2e + Archie can drive it headlessly without
// mounting React. No DOM, no React, no logging on the happy path.
//
// Inputs are tolerant — every field has a safe default but we never
// fabricate output that wasn't actually present in the cam result.

// ─────────────────────────────────────────────────────────────────────
// Tool-library reference. Standard EM / BM / drill / tap sizes used by
// the CAM workbench's TOOL_LIBRARY. Inlined here so this module has
// zero dependencies on camDispatch.js (which pulls in twenty strategy
// branches we don't need for the setup sheet).

export const TOOL_REFERENCE = Object.freeze({
  em6:   { name: 'EndMill Ø6',     diameter: 6,  flutes: 4, type: 'EndMill'   },
  em10:  { name: 'EndMill Ø10',    diameter: 10, flutes: 4, type: 'EndMill'   },
  em12:  { name: 'EndMill Ø12',    diameter: 12, flutes: 4, type: 'EndMill'   },
  bm6:   { name: 'BallMill Ø6',    diameter: 6,  flutes: 2, type: 'BallMill'  },
  bm3:   { name: 'BallMill Ø3',    diameter: 3,  flutes: 2, type: 'BallMill'  },
  vbit:  { name: 'VBit 60°',       diameter: 6,  flutes: 2, type: 'VBit'      },
  dr3:   { name: 'Drill Ø3',       diameter: 3,  flutes: 2, type: 'Drill'     },
  dr5:   { name: 'Drill Ø5',       diameter: 5,  flutes: 2, type: 'Drill'     },
  dr8:   { name: 'Drill Ø8',       diameter: 8,  flutes: 2, type: 'Drill'     },
  tapM5: { name: 'Tap M5×0.8',     diameter: 5,  flutes: 4, type: 'Tap'       },
  cf10:  { name: 'ChamferTool Ø10', diameter: 10, flutes: 4, type: 'ChamferTool' },
});

// Default fixture orientation when the caller didn't specify one. Mill
// convention: stock origin at lower-left back corner with Z+ up.
export const DEFAULT_FIXTURE = Object.freeze({
  origin:      'lower-left-back-corner',
  zAxis:       '+Z up',
  xAxis:       '+X right',
  yAxis:       '+Y forward',
  workOffset:  'G54',
  clampStyle:  'machine vise · soft jaws',
});

// ─────────────────────────────────────────────────────────────────────
// Public API.

/**
 * Build the setup sheet structure.
 *
 * @param {Array} camResults - per-op results from PUSH-46/98/117. Each
 *   entry may include: `{ op, strategy, toolId, toolName, toolDiameter,
 *   spindleRPM, feedXY, feedZ, depthMm, depth, zTop, zBottom,
 *   cycleTimeSec, moveCount, cuttingLengthMm }`. Partial fields are
 *   fine; we substitute safe defaults from TOOL_REFERENCE when a toolId
 *   is known.
 * @param {Object|null} stock - the stock body record. Read fields:
 *   `name`, `dx`/`dy`/`dz` (mm) or `spec.{dx,dy,dz}`, `material`,
 *   `aabb` (Float64Array len 6) when present. Falls back to a 100×100×30
 *   placeholder dim block only if absolutely nothing else available
 *   (and we mark `meta.stockDims.source = 'fallback'`).
 * @param {Array} bodies - the full body roster, used to resolve a stock
 *   body when none was supplied (pick the largest by volume).
 * @param {Object} [opts] - optional `programName`, `partName`,
 *   `programmer`, `machine`, `fixture` overrides.
 */
export function buildSheet(camResults, stock, bodies, opts = {}) {
  const ops = Array.isArray(camResults) ? camResults.filter(Boolean) : [];
  const stockResolved = resolveStock(stock, bodies);

  const operations = ops.map((raw, idx) => normaliseOp(raw, idx));

  let totalCycleSec = 0;
  for (const o of operations) totalCycleSec += Number(o.cycleTimeSec) || 0;

  const toolChanges = computeToolChanges(operations);

  const meta = {
    programName:  opts.programName  || 'PROG-001',
    partName:     opts.partName     || (stockResolved?.name || 'PART'),
    programmer:   opts.programmer   || 'Forge Operator',
    machine:      opts.machine      || '3-axis vertical mill',
    generatedAt:  opts.generatedAt  || new Date().toISOString(),
    fixture:      { ...DEFAULT_FIXTURE, ...(opts.fixture || {}) },
    stockDims:    stockResolved.dims,
    stockMaterial: stockResolved.material,
    stockName:    stockResolved.name,
    operationCount: operations.length,
    toolChangeCount: toolChanges.length,
  };

  return {
    meta,
    operations,
    totalCycleSec,
    toolChanges,
  };
}

/**
 * Render the setup sheet as a fixed-width ASCII document the operator
 * can print directly. Uses CRLF line endings so Excel / Notepad / TextEdit
 * all show it cleanly. Includes the operation table + tool-change list
 * + cycle totals.
 */
export function toAscii(sheet) {
  if (!sheet || !sheet.meta) return '';
  const L = [];
  const meta = sheet.meta;
  const dims = meta.stockDims || { dx: 0, dy: 0, dz: 0 };

  L.push('======================================================================');
  L.push('   ArchDisc Forge   ·   CNC SETUP SHEET   ·   PUSH-181');
  L.push('======================================================================');
  L.push(`Program:        ${meta.programName}`);
  L.push(`Part:           ${meta.partName}`);
  L.push(`Programmer:     ${meta.programmer}`);
  L.push(`Machine:        ${meta.machine}`);
  L.push(`Generated:      ${meta.generatedAt}`);
  L.push('');
  L.push('---------------------------------- STOCK -----------------------------');
  L.push(`Body:           ${meta.stockName}`);
  L.push(`Material:       ${meta.stockMaterial}`);
  L.push(`Dimensions:     ${dims.dx.toFixed(2)} x ${dims.dy.toFixed(2)} x ${dims.dz.toFixed(2)} mm  (X x Y x Z)`);
  L.push(`Source:         ${dims.source}`);
  L.push('');
  L.push('--------------------------------- FIXTURE ----------------------------');
  L.push(`Origin:         ${meta.fixture.origin}`);
  L.push(`Z-axis:         ${meta.fixture.zAxis}`);
  L.push(`X-axis:         ${meta.fixture.xAxis}`);
  L.push(`Y-axis:         ${meta.fixture.yAxis}`);
  L.push(`Work offset:    ${meta.fixture.workOffset}`);
  L.push(`Clamping:       ${meta.fixture.clampStyle}`);
  L.push('');
  L.push('------------------------------- OPERATIONS ---------------------------');
  L.push(' #   Strategy       Tool                 RPM    FeedXY  FeedZ  Depth   Cycle');
  L.push('                                                mm/min  mm/min  mm     s');
  L.push('----------------------------------------------------------------------');
  for (const op of sheet.operations) {
    L.push(formatOpRow(op));
  }
  L.push('----------------------------------------------------------------------');
  L.push(`TOTAL CYCLE TIME:  ${sheet.totalCycleSec.toFixed(2)} s   (${(sheet.totalCycleSec / 60).toFixed(2)} min)`);
  L.push('');
  L.push('------------------------------- TOOL CHANGES -------------------------');
  if (sheet.toolChanges.length === 0) {
    L.push('(no tool changes — single tool used across all operations)');
  } else {
    for (const tc of sheet.toolChanges) {
      L.push(`Tool change at Operation ${tc.atOperation}: ${tc.from || '(none)'}  ->  ${tc.to}`);
    }
  }
  L.push('');
  L.push('======================================================================');
  L.push(`Operations: ${sheet.operations.length}   ·   Tool changes: ${sheet.toolChanges.length}`);
  L.push('======================================================================');
  return L.join('\r\n');
}

// ─────────────────────────────────────────────────────────────────────
// Internals.

function resolveStock(stock, bodies) {
  // 1) Caller-supplied stock body wins.
  if (stock && typeof stock === 'object') {
    return stockRecord(stock);
  }
  // 2) Otherwise pick the largest body in the roster by bbox volume.
  if (Array.isArray(bodies) && bodies.length > 0) {
    let best = null, bestVol = -1;
    for (const b of bodies) {
      if (!b) continue;
      const d = readDims(b);
      const vol = (d.dx || 0) * (d.dy || 0) * (d.dz || 0);
      if (vol > bestVol) { bestVol = vol; best = b; }
    }
    if (best) return stockRecord(best);
  }
  // 3) Hard fallback — mark the source as 'fallback' so the operator
  //    sees the dims weren't measured from a real body.
  return {
    name:     '(no stock body)',
    material: 'unknown',
    dims:     { dx: 100, dy: 100, dz: 30, source: 'fallback' },
  };
}

function stockRecord(body) {
  const dims = readDims(body);
  return {
    name:     body.name || body.toolId || `body-${body.id || ''}`,
    material: normaliseMaterial(body.material),
    dims,
  };
}

function readDims(body) {
  // Preferred: real AABB attached by the kernel.
  if (body.aabb && body.aabb.length === 6) {
    const a = body.aabb;
    return {
      dx: Math.max(0, a[3] - a[0]),
      dy: Math.max(0, a[4] - a[1]),
      dz: Math.max(0, a[5] - a[2]),
      source: 'aabb',
    };
  }
  // Spec.dx/dy/dz path (Block primitive).
  const s = body.spec || body.params;
  if (s && typeof s === 'object') {
    if (Number.isFinite(s.dx) && Number.isFinite(s.dy) && Number.isFinite(s.dz)) {
      return { dx: s.dx, dy: s.dy, dz: s.dz, source: 'spec' };
    }
    if (Number.isFinite(s.width) && Number.isFinite(s.height) && Number.isFinite(s.distance)) {
      return {
        dx: s.width, dy: s.height, dz: s.distance,
        source: 'params',
      };
    }
    if (Number.isFinite(s.r) && Number.isFinite(s.h)) {
      // Cylinder — bbox is 2r × 2r × h.
      return { dx: s.r * 2, dy: s.r * 2, dz: s.h, source: 'spec-cyl' };
    }
  }
  // Direct dims on the body record.
  if (Number.isFinite(body.dx) && Number.isFinite(body.dy) && Number.isFinite(body.dz)) {
    return { dx: body.dx, dy: body.dy, dz: body.dz, source: 'body-dim' };
  }
  return { dx: 0, dy: 0, dz: 0, source: 'unknown' };
}

function normaliseMaterial(m) {
  return String(m || 'unknown').toLowerCase().trim();
}

function normaliseOp(raw, idx) {
  const toolId = raw.toolId || raw.tool || 'em6';
  const ref = TOOL_REFERENCE[toolId] || null;
  const toolName = raw.toolName
                || (raw.tool && typeof raw.tool === 'object' && raw.tool.name)
                || (ref && ref.name)
                || toolId;
  const diameter = pickNumber(raw.toolDiameter,
                              raw.tool && typeof raw.tool === 'object' && raw.tool.diameter,
                              ref && ref.diameter,
                              6);
  const zTop    = pickNumber(raw.zTop, 20);
  const zBottom = pickNumber(raw.zBottom, 0);
  const depthMm = pickNumber(raw.depthMm, raw.depth, Math.abs(zTop - zBottom), 0);
  return {
    index:        idx + 1,
    opLabel:      raw.op || raw.strategy || raw.opType || 'profile',
    strategy:     raw.strategy || raw.op || raw.opType || 'profile',
    tool:         { id: toolId, name: toolName, diameter },
    spindleRPM:   pickNumber(raw.spindleRPM, raw.rpm, ref ? defaultRpm(ref) : 12000),
    feedXY:       pickNumber(raw.feedXY, raw.feed, 1200),
    feedZ:        pickNumber(raw.feedZ, 300),
    depthMm,
    cycleTimeSec: pickNumber(raw.cycleTimeSec, raw.cycleSec, 0),
    moveCount:    pickNumber(raw.moveCount, raw.moves, 0),
    cuttingLengthMm: pickNumber(raw.cuttingLengthMm, raw.estCuttingMm, 0),
    zTop, zBottom,
  };
}

function defaultRpm(ref) {
  // Reasonable defaults aligned with TOOL_LIBRARY in camDispatch.js.
  switch (ref.type) {
    case 'EndMill':     return ref.diameter <= 6 ? 16000 : 12000;
    case 'BallMill':    return ref.diameter <= 6 ? 18000 : 14000;
    case 'VBit':        return 18000;
    case 'Drill':       return ref.diameter <= 5 ? 3500 : 2200;
    case 'Tap':         return 600;
    case 'ChamferTool': return 14000;
    default:            return 12000;
  }
}

function pickNumber(...candidates) {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return 0;
}

function computeToolChanges(operations) {
  const out = [];
  let prev = null;
  for (const op of operations) {
    const cur = op.tool.id;
    if (prev !== null && cur !== prev) {
      const prevTool = operations.find((o) => o.tool.id === prev);
      out.push({
        atOperation: op.index,
        from: prevTool ? prevTool.tool.name : prev,
        to:   op.tool.name,
        fromId: prev,
        toId:   cur,
      });
    }
    prev = cur;
  }
  return out;
}

function formatOpRow(op) {
  const idx   = String(op.index).padStart(2, ' ');
  const strat = pad(op.strategy, 14);
  const tool  = pad(op.tool.name, 20);
  const rpm   = padLeft(String(Math.round(op.spindleRPM)), 6);
  const feedXY = padLeft(String(Math.round(op.feedXY)), 6);
  const feedZ  = padLeft(String(Math.round(op.feedZ)), 6);
  const depth  = padLeft(op.depthMm.toFixed(2), 6);
  const cycle  = padLeft(op.cycleTimeSec.toFixed(2), 7);
  return ` ${idx}  ${strat} ${tool} ${rpm}  ${feedXY}  ${feedZ}  ${depth}  ${cycle}`;
}

function pad(s, n) {
  const str = String(s);
  if (str.length >= n) return str.slice(0, n);
  return str + ' '.repeat(n - str.length);
}

function padLeft(s, n) {
  const str = String(s);
  if (str.length >= n) return str.slice(0, n);
  return ' '.repeat(n - str.length) + str;
}

// ─────────────────────────────────────────────────────────────────────
// CSV export — useful for downstream MES / ERP imports. One row per
// operation plus a TOTAL row at the bottom.

export function toCsv(sheet) {
  if (!sheet || !sheet.operations) return '';
  const lines = [];
  lines.push([
    '"Op"', '"Strategy"', '"Tool"', '"Diameter_mm"',
    '"SpindleRPM"', '"FeedXY_mm_min"', '"FeedZ_mm_min"',
    '"Depth_mm"', '"CycleTime_s"', '"Moves"', '"CuttingLength_mm"',
  ].join(','));
  for (const op of sheet.operations) {
    lines.push([
      op.index,
      `"${op.strategy}"`,
      `"${op.tool.name}"`,
      op.tool.diameter,
      Math.round(op.spindleRPM),
      Math.round(op.feedXY),
      Math.round(op.feedZ),
      op.depthMm.toFixed(3),
      op.cycleTimeSec.toFixed(3),
      op.moveCount,
      op.cuttingLengthMm.toFixed(3),
    ].join(','));
  }
  lines.push('');
  lines.push([
    '"TOTAL"', '""', '""', '',
    '', '', '',
    '', sheet.totalCycleSec.toFixed(3), '', '',
  ].join(','));
  return lines.join('\r\n');
}

// ─────────────────────────────────────────────────────────────────────
// Convenience: pull cam results out of the published globals if the
// caller passed nothing. Looks at window.__forgeCamResults FIRST so the
// per-program publisher (any code path adding to that array) wins; then
// folds in the per-strategy globals from PUSH-98 / PUSH-117 as additive
// entries. Returns a deduplicated list keyed by (index + toolId +
// strategy) so the same op doesn't appear twice when it's published
// through both channels.

export function gatherCamResults() {
  const w = (typeof window !== 'undefined') ? window : null;
  if (!w) return [];
  const out = [];
  const seen = new Set();
  const push = (r) => {
    if (!r) return;
    const key = `${r.op || r.strategy || ''}|${r.toolId || ''}|${r.cycleTimeSec || 0}|${r.moveCount || 0}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(r);
  };
  // Primary registry — PUSH-181 publishes here, and any future cam panel
  // is expected to append its op records to this array.
  if (Array.isArray(w.__forgeCamResults)) {
    for (const r of w.__forgeCamResults) push(r);
  }
  // PUSH-117 adaptive clearing — published as a single-op record.
  if (w.__forgeCamAdaptiveResult && typeof w.__forgeCamAdaptiveResult === 'object') {
    const r = w.__forgeCamAdaptiveResult;
    if (r.ok) {
      push({
        op:           'adaptive',
        strategy:     'adaptive-clear',
        toolId:       'em6',
        spindleRPM:   16000,
        feedXY:       1200,
        feedZ:        300,
        cycleTimeSec: r.cycleTimeSec,
        moveCount:    r.moveCount,
        cuttingLengthMm: r.cuttingLengthMm,
      });
    }
  }
  // PUSH-98 drilling pattern — published as a per-hole array. Sum into
  // one record so it shows up as a single drilling op on the sheet.
  if (Array.isArray(w.__forgeDrillingPatternResults) &&
      w.__forgeDrillingPatternResults.length > 0) {
    let totalCycle = 0, totalMoves = 0, totalCut = 0;
    for (const h of w.__forgeDrillingPatternResults) {
      totalCycle += Number(h?.cycleTimeSec) || 0;
      totalMoves += Number(h?.moveCount) || 0;
      totalCut   += Number(h?.cuttingLengthMm) || Number(h?.estCuttingMm) || 0;
    }
    push({
      op:           'drill',
      strategy:     'drilling-pattern',
      toolId:       'dr5',
      spindleRPM:   2800,
      feedXY:       0,
      feedZ:        150,
      cycleTimeSec: totalCycle,
      moveCount:    totalMoves,
      cuttingLengthMm: totalCut,
    });
  }
  return out;
}
