/**
 * ArchDisc Forge — Auto-BOM rollup + auto-balloon (Forge-45)
 *
 * Closes the §4 partial: the Forge-32 balloon glyph already supports
 * leader / arrowhead / collision-nudge; this slice layers the rollup
 * that produces the row data and the auto-placement that puts a
 * numbered balloon on every visible component in a drawing view.
 *
 *   const rollup = new BomRollup({ project, rootInstance });
 *   autoBalloon(view, rollup);
 *   const svg = BomTable.toSvg(rollup, {
 *     columns: ['item', 'partNumber', 'description', 'qty', 'material', 'mass'],
 *     sheetSize: 'A3',
 *   });
 *
 * `project` is the `ForgeProject` instance (Forge-34) — it carries the
 * `partStore`, the `materialLibrary` (Forge-26 properties) and the
 * `assembly` reference used to walk the tree. `rootInstance` is the
 * native instance id of the top sub-assembly node (0 = world root).
 *
 * The rollup is intentionally *forgiving* about missing data: if the
 * project has no `materialLibrary` we just emit mass=0 and cost=0, so
 * a fresh project still produces a publishable BOM. Anything that does
 * exist (e.g. a `partNumber` set on a `Part` via the Property Manager)
 * flows straight into the right column.
 *
 * IP-safe: original code; OCCT is used only as a runtime library.
 */

import { Balloon } from '../Drawings.js';
import { getForge } from '../index.js';

// ---------------------------------------------------------- typography
//
// Forge-38 typography tokens (drawing-sheet defaults — sized to print on
// any ISO/ANSI sheet). Title-block grids reuse the same scale. Sizes in
// millimetres; renderers convert via the sheet viewBox.
export const DRAWING_TYPOGRAPHY = Object.freeze({
  fontFamily: 'Helvetica, Arial, sans-serif',
  headerSize: 3.0,
  bodySize:   2.6,
  labelSize:  1.8,
  rowSpacing: 7.0,    // ISO 7573 — 7 mm row pitch is the BS / DIN baseline
  headerWeight: 'bold',
  bodyWeight:   'normal',
  stroke: 0.3,
  thickStroke: 0.5,
});

// ---------------------------------------------------------- BOM rollup
//
// `BomRollup` walks the assembly hierarchy starting at `rootInstance`,
// folds duplicate instances of the same part into a single row, and
// emits a `[{ itemNumber, partId, partName, qty, mass, totalMass,
// material, partNumber, description, cost, totalCost, depth }]` array.
//
// Sub-assemblies are *expanded into* the rollup — each leaf is counted
// once per parent traversal, then nested sub-assembly qtys roll up by
// summing all descendant leaves. `depth` lets the SVG renderer indent
// sub-assembly rows when the caller asks for an indented BOM.

export class BomRollup {
  constructor({
    project = null,
    rootInstance = 0,
    forge = null,
    partOf = null,
    partResolver = null,
    materialLibrary = null,
    includeSubAssemblies = true,
  } = {}) {
    this.project = project;
    this.rootInstance = rootInstance;
    this.includeSubAssemblies = includeSubAssemblies;

    // Resolve a kernel proxy that exposes `assembly.getChildren`.
    this._forge = forge || _resolveForge();
    if (!this._forge.assembly || !this._forge.assembly.getChildren) {
      throw new Error(
        '[BomRollup] requires a Forge-35+ kernel with assembly.getChildren',
      );
    }

    // partOf(instance) → partId. Default: pull the underlying component
    // handle so two box instances collapse onto one BOM row. This mirrors
    // the simpler Forge-35 BomRollup function.
    this._partOf = partOf || ((id) => {
      if (this._forge.getComponentHandle) {
        try {
          const h = this._forge.getComponentHandle(id);
          if (h && h !== 0) return `comp-${h}`;
        } catch (_e) { /* fall through */ }
      }
      return `inst-${id}`;
    });

    // partResolver(partId) → { partName, partNumber, description, material, mass }.
    // Default attempts to look up the project's partStore / materialLibrary;
    // unknown ids fall back to a stub so the BOM still prints.
    this._partResolver = partResolver || ((partId) => this._defaultPartLookup(partId));

    this._materialLibrary = materialLibrary
      || (project && project.materialLibrary)
      || _defaultMaterialLibrary();

    this.rows = [];
    this._byPart = new Map();
    this._build();
  }

  // ----- per-part lookup (defaults) ----------------------------------
  _defaultPartLookup(partId) {
    // ForgeProject.partStore (Forge-34) — list parts via `parts.get(partId)`
    // when present. Anything missing → blank, so the BOM still prints.
    const proj = this.project;
    if (proj && proj.partStore && typeof proj.partStore.metaFor === 'function') {
      const meta = proj.partStore.metaFor(partId) || {};
      return {
        partName:    meta.name        || partId,
        partNumber:  meta.partNumber  || partId,
        description: meta.description || '',
        material:    meta.material    || 'Unspecified',
        mass:        Number(meta.mass) || 0,
      };
    }
    return {
      partName:    String(partId),
      partNumber:  String(partId),
      description: '',
      material:    'Unspecified',
      mass:        0,
    };
  }

  _costFor(material, mass) {
    if (!material || mass <= 0) return 0;
    const lib = this._materialLibrary || {};
    const entry = lib[material] || lib[String(material).toLowerCase()];
    const usdPerKg = (entry && typeof entry.usdPerKg === 'number') ? entry.usdPerKg : 0;
    return mass * usdPerKg;
  }

  // ----- the walker ---------------------------------------------------
  _build() {
    const f = this._forge;
    const visit = (node, depth, aggregator) => {
      const kids = Array.from(f.assembly.getChildren(node) || []);
      for (const child of kids) {
        const partId = this._partOf(child);
        const meta = this._partResolver(partId);
        // Sub-assembly = node with children of its own.
        const childKids = Array.from(f.assembly.getChildren(child) || []);
        const isSubAssembly = childKids.length > 0;

        const row = this._upsertRow(partId, meta, depth);
        row.qty += 1;
        row.totalMass = row.qty * row.mass;
        row.totalCost = row.qty * row.cost;
        if (aggregator) aggregator.qty += 1;
        // Recurse into the child so leaves nested under this sub-assembly
        // also produce rows. Sub-assemblies thus inflate their own
        // `qty` (the assembly count) AND fold their leaves into the
        // table — matching SolidWorks 'indented BOM' behaviour.
        if (this.includeSubAssemblies && isSubAssembly) {
          visit(child, depth + 1, null);
        } else if (!this.includeSubAssemblies && isSubAssembly) {
          // 'parts only' BOM — recurse but don't emit the assembly row.
          row.qty -= 1;
          if (row.qty <= 0) this._byPart.delete(partId);
          visit(child, depth, null);
        }
      }
    };
    visit(this.rootInstance, 0, null);

    // Item numbers assigned in walk order — stable across re-runs.
    this.rows = Array.from(this._byPart.values()).sort((a, b) => a._order - b._order);
    this.rows.forEach((r, i) => {
      r.itemNumber = i + 1;
      delete r._order;
    });
  }

  _upsertRow(partId, meta, depth) {
    let r = this._byPart.get(partId);
    if (r) return r;
    const mass = Number(meta.mass) || 0;
    const cost = this._costFor(meta.material, mass);
    r = {
      _order: this._byPart.size,
      itemNumber: 0,
      partId,
      partName:    meta.partName    || partId,
      partNumber:  meta.partNumber  || partId,
      description: meta.description || '',
      qty: 0,
      mass,
      totalMass: 0,
      material:   meta.material || 'Unspecified',
      cost,
      totalCost:  0,
      depth,
    };
    this._byPart.set(partId, r);
    return r;
  }

  // ----- API ----------------------------------------------------------
  /** Items array — `{ itemNumber, partId, partName, qty, ... }[]`. */
  items() { return this.rows.slice(); }

  /** Look up the row for an instance (by its partId). */
  rowFor(instanceId) {
    const pid = this._partOf(instanceId);
    return this._byPart.get(pid) || null;
  }

  /** Sum of qty × mass over the whole rollup. */
  totalMass() { return this.rows.reduce((s, r) => s + r.totalMass, 0); }
  totalCost() { return this.rows.reduce((s, r) => s + r.totalCost, 0); }
}

// ---------------------------------------------------------- auto-balloon
//
// For each component visible in `drawingView`, compute the projected
// centroid in view-local mm, push it out along the centroid→bbox-edge
// ray to clear the geometry, and call `view.addBalloon(...)` with a
// Forge-32 `Balloon({...})` whose number = BOM item number. The
// existing 4-pass collision nudge inside `Drawings.js#renderBalloons`
// handles overlap with previously placed balloons.

/**
 * autoBalloon — place a numbered balloon on every component visible in
 * `drawingView`. `bomRollup` is a `BomRollup` whose item numbers we use
 * for the balloon labels.
 *
 * Options:
 *   instanceList:   InstanceId[]  — only balloon these instances.
 *                                   Default = bomRollup leaves.
 *   centroidOf:     (instance) → [x, y]  — overrides the default
 *                                   "use the view bbox midpoint" sampler.
 *                                   Tests pass a pure-JS implementation
 *                                   so we don't need a kernel handle.
 *   offset:         number — extra mm to push the balloon outside the
 *                            view bbox edge.   Default 6 mm.
 *   radius:         balloon radius (mm).   Default 3.5 mm.
 */
export function autoBalloon(drawingView, bomRollup, {
  instanceList = null,
  centroidOf   = null,
  offset       = 6,
  radius       = 3.5,
} = {}) {
  if (!drawingView || !drawingView.bbox) {
    throw new Error('[autoBalloon] drawingView must have a bbox (set by HLR)');
  }
  if (!bomRollup || !Array.isArray(bomRollup.rows)) {
    throw new Error('[autoBalloon] bomRollup must expose .rows[]');
  }
  // Default instance source: bomRollup rows. We balloon ONE leader per
  // unique part — the SolidWorks default. If the caller wants per-instance
  // balloons (e.g. for a "fasteners highlighted" drawing) they pass an
  // explicit instanceList and a centroidOf that maps each instance to
  // its own projected point.
  const items = bomRollup.rows.slice();
  const targets = instanceList || items.map(r => ({ row: r, instance: null }));

  // Compute the projected centroid of each balloon target.
  //   * If the caller provided a centroidOf, defer to it (tests do this).
  //   * Else fall back to the view bbox midpoint — gives a sensible default
  //     when the kernel isn't loaded. Spread the multiple-target case in a
  //     ring around the centre so two balloons don't stack.
  const { minX, minY, maxX, maxY } = drawingView.bbox;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const w  = maxX - minX;
  const h  = maxY - minY;
  const r  = 0.35 * Math.min(w, h) || Math.max(w, h, 1) * 0.5;
  const N  = Math.max(1, targets.length);

  const placed = [];
  for (let i = 0; i < N; i++) {
    const t = targets[i];
    const row = t.row || items[i];
    if (!row) continue;
    const inst = (t && 'instance' in t) ? t.instance : t;

    // 1) anchor (geometry call-out point) in view-local mm
    let anchor;
    if (typeof centroidOf === 'function') {
      anchor = centroidOf(inst, row, i);
    } else {
      const theta = (i / N) * Math.PI * 2;
      anchor = [cx + Math.cos(theta) * r, cy + Math.sin(theta) * r];
    }

    // 2) push along centroid→anchor direction to the bbox edge.
    // This is the standard CAD heuristic — the balloon sits on the
    // outside of the part silhouette so the leader doesn't cross
    // geometry. Push by `offset` mm past the edge.
    const dx = anchor[0] - cx;
    const dy = anchor[1] - cy;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    // Distance from centre to the bbox edge along (ux, uy):
    //   t_x = (sign(ux) * (w/2)) / ux   (when ux != 0)
    //   t_y = (sign(uy) * (h/2)) / uy
    const tx = ux !== 0 ? Math.abs(w / 2 / ux) : Infinity;
    const ty = uy !== 0 ? Math.abs(h / 2 / uy) : Infinity;
    const edgeT = Math.min(tx, ty);
    const ballX = cx + ux * (edgeT + offset);
    const ballY = cy + uy * (edgeT + offset);

    const balloon = Balloon({
      anchor,
      balloonAt: [ballX, ballY],
      number: row.itemNumber,
      radius,
    });
    drawingView.addBalloon(balloon);
    placed.push(balloon);
  }
  return placed;
}

// ---------------------------------------------------------- BOM table SVG
//
// Pure SVG output of the rolled-up table — ready to be placed adjacent
// to the title block. The default column set matches ISO 7573 ("parts
// list") with optional total-mass and total-cost columns. The layout
// is a flat table — no `<foreignObject>`, no CSS — so it survives
// Inkscape / Illustrator / DWG plotter round-trips.
//
// Returned object exposes:
//   .toSvg(rollup, { columns, sheetSize, anchor })  → string

const COLUMN_DEFS = Object.freeze({
  item:        { label: 'ITEM',     field: 'itemNumber', align: 'middle', widthFr: 0.6 },
  partNumber:  { label: 'PART NO.', field: 'partNumber', align: 'start',  widthFr: 1.4 },
  description: { label: 'DESCRIPTION', field: 'description', align: 'start', widthFr: 2.2 },
  qty:         { label: 'QTY',      field: 'qty',        align: 'middle', widthFr: 0.6 },
  material:    { label: 'MATERIAL', field: 'material',   align: 'start',  widthFr: 1.2 },
  mass:        { label: 'MASS (kg)',field: 'mass',       align: 'end',    widthFr: 1.0 },
  totalMass:   { label: 'TOTAL MASS (kg)', field: 'totalMass', align: 'end', widthFr: 1.0 },
  cost:        { label: 'COST ($)', field: 'cost',       align: 'end',    widthFr: 1.0 },
  totalCost:   { label: 'TOTAL ($)',field: 'totalCost',  align: 'end',    widthFr: 1.0 },
  partName:    { label: 'PART NAME',field: 'partName',   align: 'start',  widthFr: 1.6 },
});

// Sheet → table footprint. Caller can override via options.
function defaultTableFootprint(sheetSize) {
  // ~ 160 mm wide on A3+, 120 mm on A4, capped — kept compatible with
  // a 6.5 mm row pitch + 7 mm header pitch (ISO 7573).
  const W = {
    A0: 220, A1: 200, A2: 180, A3: 160, A4: 120,
    A: 120, B: 160, C: 180, D: 200, E: 220,
  }[sheetSize] || 160;
  return { W };
}

function escapeXml(s) {
  return String(s).replace(/[<>&'"]/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;',
  }[c]));
}

function fmtCell(value, field) {
  if (value == null) return '—';
  if (typeof value === 'number') {
    if (field === 'qty' || field === 'itemNumber') return String(value | 0);
    return value.toFixed(2);
  }
  return String(value);
}

export const BomTable = Object.freeze({
  DEFAULT_COLUMNS: Object.freeze([
    'item', 'partNumber', 'description', 'qty', 'material', 'mass',
  ]),

  /**
   * toSvg(rollup, { columns, sheetSize, anchor, rowHeight, includeTotals })
   *
   * Returns a standalone SVG document (root `<svg>` with `xmlns`). The
   * table sits at `anchor.{x,y}` in sheet-mm coords; the default
   * places it at (10, 10) so the caller can drop it straight into a
   * `<g transform="translate(...)">` next to the title block.
   *
   * `rowHeight` defaults to ISO 7573's 7 mm pitch (`DRAWING_TYPOGRAPHY.rowSpacing`).
   * `includeTotals` adds a final "TOTAL" row summing qty / mass / cost.
   */
  toSvg(rollup, {
    columns = BomTable.DEFAULT_COLUMNS,
    sheetSize = 'A3',
    anchor = { x: 10, y: 10 },
    rowHeight = DRAWING_TYPOGRAPHY.rowSpacing,
    includeTotals = true,
    standalone = true,
  } = {}) {
    if (!rollup || !Array.isArray(rollup.rows)) {
      throw new Error('[BomTable.toSvg] rollup must be a BomRollup instance');
    }
    const cols = columns
      .map((id) => ({ id, def: COLUMN_DEFS[id] }))
      .filter(c => !!c.def);
    if (cols.length === 0) {
      throw new Error('[BomTable.toSvg] no valid columns selected');
    }
    const totalFr = cols.reduce((s, c) => s + c.def.widthFr, 0);
    const { W } = defaultTableFootprint(sheetSize);
    const colWidths = cols.map(c => (c.def.widthFr / totalFr) * W);

    const rows = rollup.rows;
    const nRows = rows.length;
    const totalH = rowHeight * (nRows + 1 + (includeTotals ? 1 : 0));

    const ax = anchor.x ?? 10;
    const ay = anchor.y ?? 10;

    // ------ <svg> open
    let body = '';
    if (standalone) {
      body += `<?xml version="1.0" encoding="UTF-8"?>\n`;
      body += `<svg xmlns="http://www.w3.org/2000/svg" `;
      body += `width="${W.toFixed(2)}mm" height="${totalH.toFixed(2)}mm" `;
      body += `viewBox="0 0 ${W.toFixed(2)} ${totalH.toFixed(2)}" `;
      body += `data-bom="true" data-rows="${nRows}">`;
    }

    body += `<g data-label="bom-table" transform="translate(${ax.toFixed(2)},${ay.toFixed(2)})">`;

    // ------ outer frame
    body += `<rect x="0" y="0" width="${W.toFixed(2)}" height="${totalH.toFixed(2)}" `;
    body += `fill="#fff" stroke="#000" stroke-width="${DRAWING_TYPOGRAPHY.thickStroke}"/>`;

    // ------ column rules
    let cursorX = 0;
    for (let i = 0; i < cols.length - 1; i++) {
      cursorX += colWidths[i];
      body += `<line x1="${cursorX.toFixed(2)}" y1="0" x2="${cursorX.toFixed(2)}" y2="${totalH.toFixed(2)}" `;
      body += `stroke="#000" stroke-width="${DRAWING_TYPOGRAPHY.stroke}"/>`;
    }

    // ------ row rules
    for (let i = 1; i <= nRows + (includeTotals ? 1 : 0); i++) {
      const ry = i * rowHeight;
      body += `<line x1="0" y1="${ry.toFixed(2)}" x2="${W.toFixed(2)}" y2="${ry.toFixed(2)}" `;
      body += `stroke="#000" stroke-width="${DRAWING_TYPOGRAPHY.stroke}"/>`;
    }

    // ------ header row
    cursorX = 0;
    const headerY = (rowHeight * 0.7).toFixed(2);
    for (let i = 0; i < cols.length; i++) {
      const cw = colWidths[i];
      const cx = cursorX + cw / 2;
      body += `<text x="${cx.toFixed(2)}" y="${headerY}" font-family="${DRAWING_TYPOGRAPHY.fontFamily}" `;
      body += `font-size="${DRAWING_TYPOGRAPHY.headerSize}" font-weight="${DRAWING_TYPOGRAPHY.headerWeight}" `;
      body += `text-anchor="middle">${escapeXml(cols[i].def.label)}</text>`;
      cursorX += cw;
    }

    // ------ data rows
    for (let r = 0; r < nRows; r++) {
      cursorX = 0;
      const ry = ((r + 1) * rowHeight + rowHeight * 0.7).toFixed(2);
      const depth = rows[r].depth || 0;
      for (let i = 0; i < cols.length; i++) {
        const cw = colWidths[i];
        const def = cols[i].def;
        const v = fmtCell(rows[r][def.field], def.field);
        let tx;
        if (def.align === 'middle') tx = cursorX + cw / 2;
        else if (def.align === 'end') tx = cursorX + cw - 1.5;
        else tx = cursorX + 1.5 + (def.id === 'partName' || def.id === 'description'
          ? depth * 2 : 0);
        body += `<text x="${tx.toFixed(2)}" y="${ry}" font-family="${DRAWING_TYPOGRAPHY.fontFamily}" `;
        body += `font-size="${DRAWING_TYPOGRAPHY.bodySize}" `;
        body += `text-anchor="${def.align}">${escapeXml(v)}</text>`;
        cursorX += cw;
      }
    }

    // ------ totals row
    if (includeTotals) {
      cursorX = 0;
      const totalsRow = {
        itemNumber: '',
        partNumber: '',
        description: 'TOTAL',
        partName: 'TOTAL',
        qty:       rows.reduce((s, r) => s + r.qty, 0),
        material:  '',
        mass:      rollup.totalMass ? rollup.totalMass() : 0,
        totalMass: rollup.totalMass ? rollup.totalMass() : 0,
        cost:      rollup.totalCost ? rollup.totalCost() : 0,
        totalCost: rollup.totalCost ? rollup.totalCost() : 0,
      };
      const ry = ((nRows + 1) * rowHeight + rowHeight * 0.7).toFixed(2);
      for (let i = 0; i < cols.length; i++) {
        const cw = colWidths[i];
        const def = cols[i].def;
        const v = fmtCell(totalsRow[def.field], def.field);
        let tx;
        if (def.align === 'middle') tx = cursorX + cw / 2;
        else if (def.align === 'end') tx = cursorX + cw - 1.5;
        else tx = cursorX + 1.5;
        body += `<text x="${tx.toFixed(2)}" y="${ry}" font-family="${DRAWING_TYPOGRAPHY.fontFamily}" `;
        body += `font-size="${DRAWING_TYPOGRAPHY.bodySize}" font-weight="bold" `;
        body += `text-anchor="${def.align}">${escapeXml(v)}</text>`;
        cursorX += cw;
      }
    }

    body += '</g>';
    if (standalone) body += '</svg>';
    return body;
  },
});

// ---------------------------------------------------------- defaults
//
// Material library — a handful of canonical materials and their (rough
// market-rate) $/kg. Used only as a fallback when the project doesn't
// ship its own. Numbers are deliberately conservative — they exist so
// the BOM has *something* to multiply, not to quote engineering pricing.
function _defaultMaterialLibrary() {
  return {
    'Steel':      { usdPerKg: 2.5 },
    'Aluminum':   { usdPerKg: 3.5 },
    'Aluminium':  { usdPerKg: 3.5 },
    'Brass':      { usdPerKg: 8.0 },
    'Copper':     { usdPerKg: 9.0 },
    'Titanium':   { usdPerKg: 35.0 },
    'Plastic':    { usdPerKg: 4.0 },
    'Nylon':      { usdPerKg: 5.0 },
    'PLA':        { usdPerKg: 25.0 },
    'ABS':        { usdPerKg: 20.0 },
    'Unspecified':{ usdPerKg: 0 },
  };
}

function _resolveForge() {
  if (typeof window !== 'undefined' && window.forge) return window.forge;
  try { return getForge(); } catch (_e) {
    // No bridge — the caller must inject `forge` explicitly. We return a
    // stub that throws useful messages instead of crashing on import.
    return {
      assembly: {
        getChildren: () => {
          throw new Error('[BomRollup] no forge bridge — pass { forge } or run inside Electron');
        },
      },
    };
  }
}

export default {
  BomRollup,
  autoBalloon,
  BomTable,
  DRAWING_TYPOGRAPHY,
};
