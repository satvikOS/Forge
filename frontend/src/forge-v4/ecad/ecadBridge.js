/**
 * ArchDisc Forge — ECAD ↔ MCAD Bridge + 3D Wiring-Harness Routing (Task #36)
 * ============================================================================
 * Bidirectional board exchange between the electrical (ECAD) and mechanical
 * (MCAD) domains, plus arc-length-true 3D harness routing.
 *
 * WHY THIS EXISTS (the actionable ECAD↔MCAD gap):
 *   The PCB designer lives in an ECAD tool (board outline, keepouts, drilled
 *   holes, component placements); the mechanical designer needs that board as
 *   a 3D MCAD assembly (an extruded board slab + a placed/rotated solid per
 *   component) so it fits the enclosure, and round-trips any mechanical edits
 *   (an enlarged outline, a moved mounting hole, a shifted connector) BACK to
 *   the ECAD side without drift. The wiring harness that links the connectors
 *   then needs a real 3D centerline whose LENGTH is the true arc length — the
 *   number the cut-list and the cost model depend on.
 *
 * PUBLISHED REFERENCES (this module VALIDATES against them — it does not
 * invent a format):
 *   - IDF 3.0 (Intermediate Data Format, Mentor Graphics / "IDF 3.0
 *     Specification, Rev. 3.0", 1998) — the concrete, line-oriented board
 *     exchange implemented here. `.emn` = board/panel file (geometry +
 *     placements); `.emp` = library file (package outlines + heights). Records
 *     are `.SECTION_NAME … .END_SECTION_NAME`; the `.HEADER` carries file type
 *     (BOARD_FILE/PANEL_FILE), IDF version 3.0, units (MM|THOU) and board
 *     thickness; `.BOARD_OUTLINE` / `.ROUTE_KEEPOUT` / `.PLACE_KEEPOUT` carry
 *     closed loops of `label X Y angle`; `.DRILLED_HOLES` carry
 *     `dia X Y plating assoc refdes hole-type owner`; `.PLACEMENT` carries, per
 *     component, a two-line record `pkg part-number refdes` / `X Y Zheight
 *     rotation side status`. This is the de-facto MCAD↔ECAD interchange that
 *     IPC-2581B (DPMX) and ProSTEP iViP IDX are the modern successors to (see
 *     `conformance` below) — IDF 3.0 is the pragmatic, universally-readable
 *     predecessor, which is why it is the concrete writer/parser here.
 *   - IPC-2581 Revision B "DPMX" / ProSTEP iViP IDX — design-lineage note: the
 *     modern baseline+incremental MCAD↔ECAD collaboration model. IDF 3.0 is the
 *     pragmatic predecessor; the same outline/keepout/hole/placement entities
 *     map forward 1:1. Not emitted here (noted for provenance, mirroring how
 *     archivalExport.js cites LOTAR/OAIS/AP242/QIF in its header).
 *   - Harness LENGTH = arc length of the centerline:
 *       · straight run        L = ‖B − A‖                     (Euclidean)
 *       · circular arc        L = r·θ                          (radius × angle)
 *       · piecewise polyline  L = Σ‖Pᵢ₊₁ − Pᵢ‖                 (chord sum)
 *       · Catmull-Rom spline  L = Σ‖samples‖ (centripetal, Barry-Goldman 1988)
 *       · free-hanging cable  L = 2a·sinh(d/(2a)),  a = H/w     (catenary)
 *         (the catenary y = a·cosh(x/a); its arc length between symmetric
 *          anchors at ±d/2 is ∫√(1+y′²)dx = 2a·sinh(d/2a); a = H/w is the
 *          horizontal-tension/weight-per-length parameter — Irvine, "Cable
 *          Structures", 1981.)
 *
 * REUSE, DON'T DUPLICATE:
 *   The Catmull-Rom router, circumscribed-circle bend-radius, polyline
 *   arc-length and auto-bundling already exist in ../harnessRouter.js (Forge-168,
 *   units = METRES) and the cable spec DB in ../cableLibrary.js. `routeHarness`
 *   here is a thin adapter that DELEGATES to harnessRouter.routeHarness (with a
 *   waypoints→cable adapter and mm↔m normalization) and adds only the catenary
 *   mode (no JS catenary existed before this module).
 *
 * UNITS
 *   Forge kernel + UI are millimetres; IDF supports MM or THOU. This module
 *   keeps board geometry in the IDF file's declared unit (MM by default) and
 *   lifts components in mm (the kernel/UI convention). harnessRouter is metres,
 *   so routeHarness converts mm→m at the boundary and reports BOTH.
 *
 * KERNEL-OPTIONAL (honestly labeled), mirroring the io/* modules:
 *   Every kernel call is guarded. The component lift uses forge.makeBox when a
 *   kernel is present; otherwise it emits an inline box mesh (positions/indices,
 *   min corner at origin — the OCCT makeBox convention) so the assembly is fully
 *   formed with no kernel. The kernel is resolved via
 *   `opts.forge !== undefined ? opts.forge : tryRequireKernel()`.
 */

import {
  routeHarness as routeHarnessCore,
  catmullRomSpline,
  polylineLength_m,
  localBendRadii_m,
} from '../harnessRouter.js';
import { bundleOD_mm, bendRadiusFor } from '../cableLibrary.js';

// ─────────────────────────────────────────────────────────────────────
// Kernel resolution (copied from robotExport.js:1283 — verbatim pattern).
// ─────────────────────────────────────────────────────────────────────
function tryRequireKernel() {
  // Only used outside the browser when no `forge` was injected.
  try {
    // eslint-disable-next-line global-require
    if (typeof require === 'function') {
      return require('forge-kernel/build/Release/forge-kernel.node');
    }
  } catch (_) { /* not available — caller must pass meshes/handles inline */ }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Number formatting for IDF fields (mirror robotExport.js fmt: up to 9
// significant digits, trim trailing zeros, −0 → 0). IDF fields are
// free-format whitespace-separated reals, so this is round-trip safe.
// ─────────────────────────────────────────────────────────────────────
function fmt(n) {
  if (!isFinite(n)) return '0';
  if (Math.abs(n) < 1e-12) return '0';
  let s = n.toPrecision(9);
  if (s.indexOf('e') === -1 && s.indexOf('.') !== -1) {
    s = s.replace(/0+$/, '').replace(/\.$/, '');
  }
  return s;
}

// Conformance block (mirrors archivalExport's self-describing conformance).
export const IDF_CONFORMANCE = Object.freeze({
  format: 'IDF',
  version: '3.0',
  spec: 'IDF 3.0 Specification, Rev. 3.0 (Mentor Graphics, 1998)',
  files: { board: '.emn', library: '.emp' },
  successors: ['IPC-2581B (DPMX)', 'ProSTEP iViP IDX'],
  note: 'IDF 3.0 is the pragmatic MCAD↔ECAD predecessor to IPC-2581/IDX; outline/keepout/hole/placement entities map 1:1 forward.',
});

// ═════════════════════════════════════════════════════════════════════
//  IDF 3.0 — PARSER  (.emn board file, hand-written line tokenizer; no deps)
// ═════════════════════════════════════════════════════════════════════

/**
 * Tokenize a single IDF data line into whitespace-separated fields, honoring
 * the IDF convention that a quoted string ("…") is a single field. IDF uses
 * '#' / lines after the data as nothing special; comments are not part of the
 * 3.0 data grammar, so we treat every non-blank, non-record line as data.
 */
function tokenizeIdfLine(line) {
  const out = [];
  const re = /"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    out.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return out;
}

/**
 * Parse a spec-conformant IDF 3.0 `.emn` board file into a normalized board
 * spec. Throws a clear error on a malformed file (missing/ën-terminated
 * records, bad header, non-numeric geometry).
 *
 * @param {string} emnText  the `.emn` file contents
 * @returns {{
 *   header:{ fileType, version, source, units, boardName, thickness },
 *   outline:Array<{label:number,x:number,y:number,angle:number}>,
 *   routeKeepouts:Array<{owner:string,loop:Array<{label,x,y,angle}>}>,
 *   placeKeepouts:Array<{owner:string,loop:Array<{label,x,y,angle}>}>,
 *   holes:Array<{diameter,x,y,plating,assoc,refdes,holeType,owner}>,
 *   components:Array<{pkg,partNumber,refdes,x,y,z,rot,side,status}>,
 * }}
 */
export function parseEmn(emnText) {
  if (typeof emnText !== 'string' || emnText.trim() === '') {
    throw new Error('parseEmn: empty or non-string IDF .emn input');
  }
  const rawLines = emnText.split(/\r?\n/);

  // Group into records: .SECTION … .END_SECTION. Lines outside a record that
  // are non-blank are illegal in IDF 3.0 → reject.
  const records = [];
  let cur = null;
  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i];
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (trimmed.startsWith('.END_')) {
      const sec = trimmed.slice(5);
      if (!cur) throw new Error(`parseEmn: line ${i + 1}: .END_${sec} with no open record`);
      if (cur.name !== sec) {
        throw new Error(`parseEmn: line ${i + 1}: .END_${sec} does not match open .${cur.name}`);
      }
      records.push(cur);
      cur = null;
    } else if (trimmed.startsWith('.')) {
      if (cur) throw new Error(`parseEmn: line ${i + 1}: nested record .${trimmed.slice(1)} inside .${cur.name}`);
      cur = { name: trimmed.slice(1).split(/\s+/)[0], headerTokens: tokenizeIdfLine(trimmed).slice(1), lines: [], lineNo: i + 1 };
    } else {
      if (!cur) throw new Error(`parseEmn: line ${i + 1}: data outside any record: "${trimmed}"`);
      cur.lines.push({ text: trimmed, no: i + 1 });
    }
  }
  if (cur) throw new Error(`parseEmn: unterminated record .${cur.name} (missing .END_${cur.name})`);

  const byName = (name) => records.filter((r) => r.name === name);

  // ── .HEADER (required) ──────────────────────────────────────────────
  const hdrRec = byName('HEADER')[0];
  if (!hdrRec) throw new Error('parseEmn: missing required .HEADER record');
  // line 1: file-type version source date author-version
  // line 2: board-name version
  // line 3: units
  if (hdrRec.lines.length < 3) {
    throw new Error('parseEmn: .HEADER must have 3 data lines (type/version, board name, units)');
  }
  const h1 = tokenizeIdfLine(hdrRec.lines[0].text);
  const fileType = h1[0];
  if (fileType !== 'BOARD_FILE' && fileType !== 'PANEL_FILE') {
    throw new Error(`parseEmn: .HEADER file type must be BOARD_FILE|PANEL_FILE, got "${fileType}"`);
  }
  const version = h1[1];
  if (version !== '3.0') {
    throw new Error(`parseEmn: only IDF version 3.0 supported, got "${version}"`);
  }
  const source = h1[2] || 'ArchDisc-Forge';
  const h2 = tokenizeIdfLine(hdrRec.lines[1].text);
  const boardName = h2[0];
  const h3 = tokenizeIdfLine(hdrRec.lines[2].text);
  const units = h3[0];
  if (units !== 'MM' && units !== 'THOU') {
    throw new Error(`parseEmn: .HEADER units must be MM|THOU, got "${units}"`);
  }

  // ── .BOARD_OUTLINE (required) ───────────────────────────────────────
  const outRec = byName('BOARD_OUTLINE')[0];
  if (!outRec) throw new Error('parseEmn: missing required .BOARD_OUTLINE record');
  // header line of outline = OWNER; first data line = thickness.
  if (outRec.lines.length < 1) throw new Error('parseEmn: .BOARD_OUTLINE missing thickness line');
  const thickness = num(outRec.lines[0].text.trim().split(/\s+/)[0], outRec.lines[0].no, 'board thickness');
  const outline = parseLoop(outRec.lines.slice(1));
  if (outline.length < 3) {
    throw new Error('parseEmn: .BOARD_OUTLINE needs at least 3 loop points to bound a board');
  }

  // ── keepouts (0+) ───────────────────────────────────────────────────
  const routeKeepouts = byName('ROUTE_KEEPOUT').map((r) => ({
    owner: r.headerTokens[0] || 'UNOWNED',
    loop: parseLoop(r.lines),
  }));
  const placeKeepouts = byName('PLACE_KEEPOUT').map((r) => ({
    owner: r.headerTokens[0] || 'UNOWNED',
    loop: parseLoop(r.lines),
  }));

  // ── .DRILLED_HOLES (0 or 1) ─────────────────────────────────────────
  const holes = [];
  const drillRec = byName('DRILLED_HOLES')[0];
  if (drillRec) {
    for (const ln of drillRec.lines) {
      const t = tokenizeIdfLine(ln.text);
      if (t.length < 4) throw new Error(`parseEmn: line ${ln.no}: drilled-hole row needs dia X Y plating …`);
      holes.push({
        diameter: num(t[0], ln.no, 'hole diameter'),
        x: num(t[1], ln.no, 'hole X'),
        y: num(t[2], ln.no, 'hole Y'),
        plating: t[3], // PTH | NPTH
        assoc: t[4] || 'BOARD',
        refdes: t[5] || 'NOREFDES',
        holeType: t[6] || 'OTHER',
        owner: t[7] || 'UNOWNED',
      });
    }
  }

  // ── .PLACEMENT (0 or 1; two lines per component) ────────────────────
  const components = [];
  const placeRec = byName('PLACEMENT')[0];
  if (placeRec) {
    const ls = placeRec.lines;
    if (ls.length % 2 !== 0) {
      throw new Error('parseEmn: .PLACEMENT must have an even number of data lines (2 per component)');
    }
    for (let i = 0; i < ls.length; i += 2) {
      const a = tokenizeIdfLine(ls[i].text);     // pkg part-number refdes
      const b = tokenizeIdfLine(ls[i + 1].text); // X Y Zheight rotation side status
      if (a.length < 3) throw new Error(`parseEmn: line ${ls[i].no}: placement line 1 needs pkg part-number refdes`);
      if (b.length < 6) throw new Error(`parseEmn: line ${ls[i + 1].no}: placement line 2 needs X Y Z rotation side status`);
      const side = b[4];
      if (side !== 'TOP' && side !== 'BOTTOM') {
        throw new Error(`parseEmn: line ${ls[i + 1].no}: placement side must be TOP|BOTTOM, got "${side}"`);
      }
      components.push({
        pkg: a[0],
        partNumber: a[1],
        refdes: a[2],
        x: num(b[0], ls[i + 1].no, 'placement X'),
        y: num(b[1], ls[i + 1].no, 'placement Y'),
        z: num(b[2], ls[i + 1].no, 'placement Z (mounting offset)'),
        rot: num(b[3], ls[i + 1].no, 'placement rotation'),
        side,
        status: b[5],
      });
    }
  }

  return {
    header: { fileType, version, source, units, boardName, thickness },
    outline, routeKeepouts, placeKeepouts, holes, components,
  };
}

function num(s, lineNo, what) {
  const v = Number(s);
  if (!Number.isFinite(v)) throw new Error(`parseEmn: line ${lineNo}: ${what} is not a number ("${s}")`);
  return v;
}

/** Parse a sequence of `label X Y angle` loop rows. */
function parseLoop(lines) {
  const loop = [];
  for (const ln of lines) {
    const t = ln.text.trim().split(/\s+/);
    if (t.length < 3) throw new Error(`parseEmn: line ${ln.no}: loop row needs "label X Y [angle]"`);
    loop.push({
      label: Math.trunc(num(t[0], ln.no, 'loop label')),
      x: num(t[1], ln.no, 'loop X'),
      y: num(t[2], ln.no, 'loop Y'),
      angle: t[3] !== undefined ? num(t[3], ln.no, 'loop arc angle') : 0,
    });
  }
  return loop;
}

// ═════════════════════════════════════════════════════════════════════
//  IDF 3.0 — WRITER  (spec-conformant .emn; inline ASCII, no deps)
// ═════════════════════════════════════════════════════════════════════

/**
 * Write a spec-conformant IDF 3.0 `.emn` board file. Round-trips with
 * parseEmn (export → import → export is byte-stable for a normalized board).
 *
 * @param {object} board  a normalized board spec (the shape parseEmn returns),
 *                         or a partial { outline, holes, routeKeepouts,
 *                         placeKeepouts, components, header? }.
 * @param {object} [opts] { units:'MM'|'THOU', source, boardName, thickness }
 * @returns {string} the `.emn` text
 */
export function writeEmn(board, opts = {}) {
  if (!board || typeof board !== 'object') throw new Error('writeEmn: board spec required');
  const hdr = board.header || {};
  const units = (opts.units || hdr.units || 'MM').toUpperCase();
  if (units !== 'MM' && units !== 'THOU') throw new Error(`writeEmn: units must be MM|THOU, got "${units}"`);
  const fileType = hdr.fileType || 'BOARD_FILE';
  const source = opts.source || hdr.source || 'ArchDisc-Forge';
  const boardName = opts.boardName || hdr.boardName || 'BOARD';
  const thickness = opts.thickness != null ? opts.thickness
    : (hdr.thickness != null ? hdr.thickness : 1.6);

  const lines = [];

  // .HEADER — type/version/source/date/program-version, board name, units.
  lines.push('.HEADER');
  lines.push(`${fileType} 3.0 "${source}" ${stamp()} 1`);
  lines.push(`"${boardName}" 0`);
  lines.push(units);
  lines.push('.END_HEADER');

  // .BOARD_OUTLINE — OWNER, then thickness, then the outer loop (label 0).
  const outline = board.outline || [];
  if (outline.length < 3) throw new Error('writeEmn: outline needs at least 3 points');
  lines.push('.BOARD_OUTLINE MCAD');
  lines.push(fmt(thickness));
  for (const p of outline) lines.push(loopRow(p));
  lines.push('.END_BOARD_OUTLINE');

  // .ROUTE_KEEPOUT / .PLACE_KEEPOUT loops.
  for (const k of board.routeKeepouts || []) {
    lines.push(`.ROUTE_KEEPOUT ${k.owner || 'MCAD'}`);
    for (const p of k.loop || []) lines.push(loopRow(p));
    lines.push('.END_ROUTE_KEEPOUT');
  }
  for (const k of board.placeKeepouts || []) {
    lines.push(`.PLACE_KEEPOUT ${k.owner || 'MCAD'}`);
    for (const p of k.loop || []) lines.push(loopRow(p));
    lines.push('.END_PLACE_KEEPOUT');
  }

  // .DRILLED_HOLES — dia X Y plating assoc refdes hole-type owner.
  const holes = board.holes || [];
  if (holes.length) {
    lines.push('.DRILLED_HOLES');
    for (const h of holes) {
      lines.push([
        fmt(h.diameter), fmt(h.x), fmt(h.y),
        h.plating || 'PTH',
        `"${h.assoc || 'BOARD'}"`,
        `"${h.refdes || 'NOREFDES'}"`,
        `"${h.holeType || 'OTHER'}"`,
        h.owner || 'MCAD',
      ].join(' '));
    }
    lines.push('.END_DRILLED_HOLES');
  }

  // .PLACEMENT — two lines per component.
  const components = board.components || [];
  if (components.length) {
    lines.push('.PLACEMENT');
    for (const c of components) {
      lines.push(`"${c.pkg || 'PKG'}" "${c.partNumber || c.refdes || 'PN'}" "${c.refdes || 'U?'}"`);
      lines.push([
        fmt(c.x), fmt(c.y), fmt(c.z || 0), fmt(c.rot || 0),
        c.side || 'TOP', c.status || 'PLACED',
      ].join(' '));
    }
    lines.push('.END_PLACEMENT');
  }

  return lines.join('\n') + '\n';
}

function loopRow(p) {
  return `${Math.trunc(p.label || 0)} ${fmt(p.x)} ${fmt(p.y)} ${fmt(p.angle || 0)}`;
}

// A deterministic-ish date stamp (YYYY/MM/DD.HH:MM:SS) for the IDF header. The
// header date is informational and not part of round-trip identity.
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())}.${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

// ═════════════════════════════════════════════════════════════════════
//  COMPONENT LIFT — IDF placement → placed/rotated 3D box (MCAD body)
// ═════════════════════════════════════════════════════════════════════

// Canonical box mesh (mm), min corner at origin — matches forge.makeBox /
// OCCT convention (copied from robotExport.test.mjs:154). 12 CCW-outward tris.
function boxMesh(dx, dy, dz) {
  const v = [
    [0, 0, 0], [dx, 0, 0], [dx, dy, 0], [0, dy, 0],
    [0, 0, dz], [dx, 0, dz], [dx, dy, dz], [0, dy, dz],
  ];
  const positions = [];
  for (const p of v) positions.push(p[0], p[1], p[2]);
  const indices = [
    0, 2, 1, 0, 3, 2, // bottom (z=0)
    4, 5, 6, 4, 6, 7, // top (z=dz)
    0, 1, 5, 0, 5, 4, // y=0
    2, 3, 7, 2, 7, 6, // y=dy
    1, 2, 6, 1, 6, 5, // x=dx
    0, 4, 7, 0, 7, 3, // x=0
  ];
  return { positions, indices };
}

/**
 * Parse an `.emp` library file into a package-footprint table:
 *   pkgName -> { dx, dy, height }  (mm/THOU in the file's units)
 * `.emp` carries `.ELECTRICAL`/`.MECHANICAL` records, each with a header line
 * `geom-name part-number units height` and an outline loop. dx/dy come from the
 * loop bbox. Returns {} for an empty/absent library.
 */
export function parseEmp(empText) {
  if (typeof empText !== 'string' || empText.trim() === '') return {};
  const lines = empText.split(/\r?\n/);
  const table = {};
  let cur = null;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (t === '') continue;
    if (t.startsWith('.END_')) { cur = null; continue; }
    if (t.startsWith('.ELECTRICAL') || t.startsWith('.MECHANICAL')) {
      cur = { name: null, height: 0, loop: [] };
      continue;
    }
    if (!cur) continue;
    const toks = tokenizeIdfLine(t);
    if (cur.name === null) {
      // header line: geom-name part-number units height
      cur.name = toks[0];
      cur.height = Number(toks[3]);
      if (!Number.isFinite(cur.height)) cur.height = 0;
      // stash a finalizer keyed by name
      table[cur.name] = { dx: 0, dy: 0, height: cur.height, _loop: cur.loop };
    } else {
      // loop row: label X Y angle
      const x = Number(toks[1]); const y = Number(toks[2]);
      if (Number.isFinite(x) && Number.isFinite(y)) cur.loop.push([x, y]);
    }
  }
  // finalize bbox dx/dy from each loop.
  for (const name of Object.keys(table)) {
    const loop = table[name]._loop || [];
    if (loop.length) {
      let minx = Infinity; let miny = Infinity; let maxx = -Infinity; let maxy = -Infinity;
      for (const [x, y] of loop) {
        if (x < minx) minx = x; if (x > maxx) maxx = x;
        if (y < miny) miny = y; if (y > maxy) maxy = y;
      }
      table[name].dx = maxx - minx;
      table[name].dy = maxy - miny;
    }
    delete table[name]._loop;
  }
  return table;
}

// Default package footprint (mm) when no `.emp` library entry is found. Keyed
// by a few common IDF package-name conventions; otherwise a small generic SMD.
const DEFAULT_PACKAGES = Object.freeze({
  DIP14: { dx: 19.0, dy: 6.4, height: 4.0 },
  DIP16: { dx: 21.5, dy: 6.4, height: 4.0 },
  SOIC8: { dx: 5.0, dy: 4.0, height: 1.75 },
  QFP44: { dx: 12.0, dy: 12.0, height: 2.0 },
  '0805': { dx: 2.0, dy: 1.25, height: 0.5 },
  '0603': { dx: 1.6, dy: 0.8, height: 0.45 },
  RADIAL_CAP: { dx: 6.0, dy: 6.0, height: 11.0 },
  CONN_HEADER: { dx: 10.0, dy: 2.5, height: 8.5 },
});

function packageFootprint(pkgName, empTable) {
  if (empTable && empTable[pkgName]) return empTable[pkgName];
  const up = String(pkgName || '').toUpperCase();
  if (DEFAULT_PACKAGES[up]) return DEFAULT_PACKAGES[up];
  // Heuristic for two-digit SMD codes embedded in the name (e.g. C_0805).
  for (const code of ['0805', '0603']) if (up.includes(code)) return DEFAULT_PACKAGES[code];
  return { dx: 3.0, dy: 3.0, height: 1.0 }; // generic SMD fallback
}

/**
 * Lift one placed component into an MCAD body (placed/rotated box at package
 * height). On TOP the part sits above the board (z = +placement.z); on BOTTOM
 * it hangs below (the box grows downward), per IDF side semantics.
 *
 * @returns a normalized link/part: { id, name, refdes, package, side,
 *   visual:{positions,indices}, handle?, position:{x,y,z}, rotation:{x,y,z},
 *   footprint:{dx,dy,height} }
 */
export function liftComponentToBody(comp, ctx = {}) {
  const { forge = null, empTable = null, boardThickness = 0 } = ctx;
  const fp = packageFootprint(comp.pkg, empTable);
  const dx = fp.dx; const dy = fp.dy; const dz = fp.height;

  // The IDF placement origin is the package origin; we model the body centered
  // in X/Y on that origin (footprint dx×dy), with its base on the board face.
  // Board top face is at z = boardThickness; bottom face at z = 0.
  const onTop = comp.side === 'TOP';
  // Box min corner: centered in XY about the placement point, base at the
  // appropriate board face plus the explicit IDF mount offset (comp.z).
  const baseZ = onTop ? (boardThickness + (comp.z || 0))
    : -(dz + (comp.z || 0)); // BOTTOM: box hangs below z=0
  const position = { x: comp.x - dx / 2, y: comp.y - dy / 2, z: baseZ };
  // IDF rotation is about Z (degrees, CCW looking down). Mirror for BOTTOM is
  // captured by the side flag + base-z; the in-plane rotation is the same axis.
  const rotation = { x: 0, y: 0, z: (comp.rot || 0) * Math.PI / 180 };

  let handle = null;
  let visual;
  if (forge && typeof forge.makeBox === 'function') {
    handle = forge.makeBox(dx, dy, dz);
    // Provide a mesh too (kernel handle is authoritative; mesh keeps the body
    // renderable / round-trippable without a tessellation round-trip).
    visual = boxMesh(dx, dy, dz);
  } else {
    visual = boxMesh(dx, dy, dz);
  }

  return {
    id: `cmp_${comp.refdes}`,
    name: comp.refdes,
    refdes: comp.refdes,
    package: comp.pkg,
    side: comp.side,
    handle,
    visual,
    position,
    rotation,
    footprint: { dx, dy, height: dz },
  };
}

/** Build the board slab body — an extruded outline at the board thickness. */
function liftBoardSlab(parsed, ctx = {}) {
  const { forge = null } = ctx;
  const bb = loopBBox(parsed.outline);
  const dx = bb.maxx - bb.minx;
  const dy = bb.maxy - bb.miny;
  const dz = parsed.header.thickness;
  let handle = null;
  const visual = boxMeshAt(bb.minx, bb.miny, 0, dx, dy, dz);
  if (forge && typeof forge.makeBox === 'function') {
    handle = forge.makeBox(dx, dy, dz);
  }
  return {
    id: 'board',
    name: parsed.header.boardName || 'board',
    refdes: '__BOARD__',
    side: 'BOARD',
    handle,
    visual,
    // position offset so the inline mesh sits at the outline's real XY origin.
    position: { x: 0, y: 0, z: 0 },
    rotation: { x: 0, y: 0, z: 0 },
    footprint: { dx, dy, height: dz },
    outlineBBox: bb,
  };
}

function boxMeshAt(ox, oy, oz, dx, dy, dz) {
  const m = boxMesh(dx, dy, dz);
  const p = m.positions.slice();
  for (let i = 0; i < p.length; i += 3) { p[i] += ox; p[i + 1] += oy; p[i + 2] += oz; }
  return { positions: p, indices: m.indices };
}

function loopBBox(loop) {
  let minx = Infinity; let miny = Infinity; let maxx = -Infinity; let maxy = -Infinity;
  for (const p of loop) {
    if (p.x < minx) minx = p.x; if (p.x > maxx) maxx = p.x;
    if (p.y < miny) miny = p.y; if (p.y > maxy) maxy = p.y;
  }
  return { minx, miny, maxx, maxy };
}

// ═════════════════════════════════════════════════════════════════════
//  (A) ecadImportBoard — IDF .emn → parsed board + lifted MCAD assembly
// ═════════════════════════════════════════════════════════════════════

/**
 * Parse an IDF 3.0 `.emn` board file and lift it into a 3D MCAD assembly:
 * an extruded board slab + one placed/rotated solid per component. The returned
 * `assembly` is a normalized spec ({ name, links:[…], mates:[] }) — the exact
 * shape io/robotExport.js and io/archivalExport.js accept — so the lifted board
 * flows straight into io.export-robot / io.export-archival.
 *
 * @param {string} emnText
 * @param {object} [opts] { empText?, forge? }
 * @returns {{ board:object, assembly:object, counts:object }}
 */
export function ecadImportBoard(emnText, opts = {}) {
  const forge = opts.forge !== undefined ? opts.forge : tryRequireKernel();
  const parsed = parseEmn(emnText);
  const empTable = opts.empText ? parseEmp(opts.empText) : null;

  const boardThickness = parsed.header.thickness;
  const links = [];
  links.push(liftBoardSlab(parsed, { forge }));
  for (const comp of parsed.components) {
    links.push(liftComponentToBody(comp, { forge, empTable, boardThickness }));
  }

  const assembly = {
    name: parsed.header.boardName || 'pcb_assembly',
    baseLink: 'board',
    links,
    parts: undefined, // normalized-spec form (not a JS Assembly)
    mates: [],
  };

  return {
    board: parsed,
    assembly,
    counts: {
      outlinePoints: parsed.outline.length,
      holes: parsed.holes.length,
      routeKeepouts: parsed.routeKeepouts.length,
      placeKeepouts: parsed.placeKeepouts.length,
      components: parsed.components.length,
    },
  };
}

// ═════════════════════════════════════════════════════════════════════
//  (B) ecadExportBoard — board-or-assembly → spec-conformant IDF .emn
// ═════════════════════════════════════════════════════════════════════

/**
 * Write a spec-conformant IDF 3.0 `.emn` string carrying outline + keepouts +
 * drilled holes + placements. Accepts either:
 *   - a normalized board spec (the shape parseEmn returns), or
 *   - an MCAD assembly ({ name, links:[…] } / { parts:[…] }) produced by
 *     ecadImportBoard — in which case the board geometry (outline bbox, board
 *     thickness) and the per-component placements are RECOVERED from the lifted
 *     bodies so MCAD → ECAD → MCAD preserves placements within tolerance.
 *
 * @param {object} boardOrAssembly
 * @param {object} [opts] { units, forge, source, boardName, thickness }
 * @returns {string} the `.emn` text
 */
export function ecadExportBoard(boardOrAssembly, opts = {}) {
  if (!boardOrAssembly || typeof boardOrAssembly !== 'object') {
    throw new Error('ecadExportBoard: board or assembly required');
  }
  // Already a normalized board spec? (has outline + components arrays).
  if (Array.isArray(boardOrAssembly.outline)) {
    return writeEmn(boardOrAssembly, opts);
  }
  // Otherwise treat as an assembly: recover a board spec from lifted bodies.
  const board = assemblyToBoard(boardOrAssembly, opts);
  return writeEmn(board, opts);
}

/**
 * Recover an IDF board spec from a lifted MCAD assembly (push-back, step B).
 * The board slab body gives the outline (its XY bbox → a rectangular loop) and
 * thickness; every component body gives back its placement
 * (refdes/package/x/y/z/rotation/side) by inverting liftComponentToBody.
 */
export function assemblyToBoard(assembly, opts = {}) {
  const links = assembly.links || (assembly.parts ? assembly.parts.map(adaptPart) : null);
  if (!Array.isArray(links) || links.length === 0) {
    throw new Error('assemblyToBoard: assembly has no links/parts to recover a board from');
  }
  const boardBody = links.find((l) => l.side === 'BOARD' || l.refdes === '__BOARD__' || l.id === 'board');
  if (!boardBody) throw new Error('assemblyToBoard: no board slab body found (side=BOARD)');

  const thickness = boardBody.footprint ? boardBody.footprint.height
    : (boardBody.position ? 1.6 : 1.6);
  const bb = boardBody.outlineBBox || footprintBBox(boardBody);
  // Rectangular outline loop (label 0), closed (first point repeated last).
  const outline = [
    { label: 0, x: bb.minx, y: bb.miny, angle: 0 },
    { label: 0, x: bb.maxx, y: bb.miny, angle: 0 },
    { label: 0, x: bb.maxx, y: bb.maxy, angle: 0 },
    { label: 0, x: bb.minx, y: bb.maxy, angle: 0 },
    { label: 0, x: bb.minx, y: bb.miny, angle: 0 },
  ];

  const components = [];
  for (const l of links) {
    if (l === boardBody || l.side === 'BOARD' || l.refdes === '__BOARD__') continue;
    const dx = l.footprint ? l.footprint.dx : 0;
    const dy = l.footprint ? l.footprint.dy : 0;
    const dz = l.footprint ? l.footprint.height : 0;
    const onTop = l.side !== 'BOTTOM';
    // Invert liftComponentToBody: placement origin = box-min + footprint/2;
    // mount offset z recovered from base-z relative to the board face.
    const px = (l.position ? l.position.x : 0) + dx / 2;
    const py = (l.position ? l.position.y : 0) + dy / 2;
    const baseZ = l.position ? l.position.z : 0;
    const mountZ = onTop ? (baseZ - thickness) : -(baseZ + dz);
    const rotZdeg = l.rotation ? (l.rotation.z * 180 / Math.PI) : 0;
    components.push({
      pkg: l.package || 'PKG',
      partNumber: l.refdes || l.name || 'PN',
      refdes: l.refdes || l.name || 'U?',
      x: px,
      y: py,
      z: roundTiny(mountZ),
      rot: roundTiny(rotZdeg),
      side: onTop ? 'TOP' : 'BOTTOM',
      status: 'PLACED',
    });
  }

  return {
    header: {
      fileType: 'BOARD_FILE', version: '3.0',
      source: opts.source || 'ArchDisc-Forge',
      units: (opts.units || 'MM').toUpperCase(),
      boardName: opts.boardName || assembly.name || 'BOARD',
      thickness,
    },
    outline,
    routeKeepouts: assembly.routeKeepouts || [],
    placeKeepouts: assembly.placeKeepouts || [],
    holes: assembly.holes || [],
    components,
  };
}

function adaptPart(p) {
  return {
    id: p.id, name: p.name, refdes: p.refdes || p.name,
    package: p.package, side: p.side,
    position: p.position, rotation: p.rotation, footprint: p.footprint,
    visual: p.visual, outlineBBox: p.outlineBBox,
  };
}

function footprintBBox(body) {
  // Derive the board XY bbox from its inline mesh positions.
  const pos = body.visual && body.visual.positions;
  if (!pos || !pos.length) return { minx: 0, miny: 0, maxx: 0, maxy: 0 };
  let minx = Infinity; let miny = Infinity; let maxx = -Infinity; let maxy = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const x = pos[i]; const y = pos[i + 1];
    if (x < minx) minx = x; if (x > maxx) maxx = x;
    if (y < miny) miny = y; if (y > maxy) maxy = y;
  }
  return { minx, miny, maxx, maxy };
}

// Snap values that are within 1e-9 of an integer (kills −0 / float fuzz so the
// recovered placements are clean).
function roundTiny(x) {
  const r = Math.round(x);
  if (Math.abs(x - r) < 1e-9) return r + 0; // +0 normalizes −0
  return Math.round(x * 1e6) / 1e6 + 0;
}

// ═════════════════════════════════════════════════════════════════════
//  (C) routeHarness — arc-length-true 3D harness routing
// ═════════════════════════════════════════════════════════════════════

/**
 * Catenary arc length between two anchors separated by horizontal span d, with
 * horizontal tension H and weight-per-unit-length w:
 *     a = H / w
 *     L = 2a · sinh( d / (2a) )
 * (Irvine, "Cable Structures", 1981.) Pure JS — no JS catenary existed before.
 */
export function catenaryLength(d, H, w) {
  if (!(d > 0)) return 0;
  const a = H / w;
  if (!(a > 0) || !isFinite(a)) throw new Error('catenaryLength: H/w must be > 0');
  return 2 * a * Math.sinh(d / (2 * a));
}

/**
 * Sample a catenary y(x)=a·cosh(x/a) between symmetric anchors at x=±d/2,
 * shifted so the two anchor endpoints match `from`/`to`. Returns a 3D polyline
 * (the sag is in the −Z direction). The chord is along (to−from) projected to
 * the horizontal; the vertical drop adds catenary sag.
 *
 * NOTE on units: the catenary parameter `a` MUST be in the SAME units as the
 * waypoint geometry. The caller (routeHarness) passes `a` already expressed in
 * the geometry's unit (mm). `cosh`/`sinh` are dimensionless, so `xp/a` and the
 * resulting sag come out in the geometry unit.
 */
export function catenaryPolyline(from, to, a, samples = 64) {
  const dx = to[0] - from[0]; const dy = to[1] - from[1]; const dz = to[2] - from[2];
  const horiz = Math.hypot(dx, dy); // horizontal span (geometry units)
  if (!(a > 0) || !isFinite(a)) throw new Error('catenaryPolyline: a must be > 0');
  const out = [];
  // Lowest point of a symmetric catenary is at the midspan; y at the anchors is
  // a·cosh((d/2)/a). We measure sag relative to the anchors and hang it below
  // the straight chord.
  const yAnchor = a * Math.cosh((horiz / 2) / a);
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    // position along the straight chord (handles any 3D anchor offset)
    const bx = from[0] + dx * t;
    const by = from[1] + dy * t;
    const bz = from[2] + dz * t;
    // local catenary coordinate x' ∈ [−d/2, +d/2]
    const xp = (t - 0.5) * horiz;
    const yLocal = a * Math.cosh(xp / a);
    const sag = yAnchor - yLocal; // 0 at anchors, max at midspan
    out.push([bx, by, bz - sag]); // hang below in −Z
  }
  return out;
}

/**
 * Route a wiring harness through `waypoints` and return the arc-length-true
 * centerline + per-segment lengths + total length + bundle radius.
 *
 * Modes:
 *   - 'linear'   : piecewise-linear centerline; length = Σ chord lengths.
 *   - 'spline'   : centripetal Catmull-Rom (delegates to harnessRouter); length
 *                  = Σ sampled-segment lengths (arc length of the spline).
 *   - 'catenary' : free-hanging cable between the first and last waypoint;
 *                  length = 2a·sinh(d/2a), a = H/w.
 *
 * Units: waypoints + bundleRadius are MILLIMETRES (the kernel/UI convention).
 * Internally harnessRouter is metres, so we convert at the boundary and report
 * length in mm (and length_m in m).
 *
 * @param {Array<[x,y,z]>} waypoints  ≥2 points (mm)
 * @param {object} [opts] {
 *   mode:'linear'|'spline'|'catenary',
 *   bundleRadius?:number (mm), cableId?:string|string[],
 *   anchorTension?:number (N, catenary H), weightPerLength?:number (N/m),
 *   samplesPerSegment?:number,
 * }
 * @returns {{ mode, centerline:Array<[x,y,z]>, segments:Array<{from,to,length}>,
 *             length:number(mm), length_m:number, bundleRadius:number(mm),
 *             minBendRadius:number(mm)|null }}
 */
export function routeHarness(waypoints, opts = {}) {
  if (!Array.isArray(waypoints) || waypoints.length < 2) {
    throw new Error('routeHarness: need at least 2 waypoints');
  }
  for (const p of waypoints) {
    if (!Array.isArray(p) || p.length < 3 || p.some((v) => !Number.isFinite(v))) {
      throw new Error('routeHarness: every waypoint must be a finite [x,y,z]');
    }
  }
  const mode = opts.mode || 'linear';

  // Bundle radius (mm): explicit, else derived from the cable list OD/2.
  let bundleRadius = opts.bundleRadius;
  if (bundleRadius == null && opts.cableId) {
    const list = Array.isArray(opts.cableId) ? opts.cableId : [opts.cableId];
    bundleRadius = bundleOD_mm(list) / 2;
  }
  if (bundleRadius == null) bundleRadius = 2.0; // 4 mm bundle default

  let centerline;
  if (mode === 'catenary') {
    const from = waypoints[0];
    const to = waypoints[waypoints.length - 1];
    const H = opts.anchorTension != null ? opts.anchorTension : 50;   // N
    const w = opts.weightPerLength != null ? opts.weightPerLength : 1; // N/m
    // a = H/w has units of length (m); express it in mm to match the geometry.
    const a_mm = (H / w) * 1000;
    centerline = catenaryPolyline(from, to, a_mm, opts.samplesPerSegment ?? 64);
  } else if (mode === 'spline' && waypoints.length >= 2) {
    // Delegate the spline math to harnessRouter (metres). Adapt mm→m, build a
    // single cable, route it, then convert the centerline back to mm.
    const wpM = waypoints.map((p) => [p[0] / 1000, p[1] / 1000, p[2] / 1000]);
    const cableId = Array.isArray(opts.cableId) ? opts.cableId[0] : (opts.cableId || 'awg-18');
    const cable = { id: 'harness', cableId, waypoints: wpM };
    const result = routeHarnessCore([cable], {
      samplesPerSegment: opts.samplesPerSegment ?? 24,
      bundleStrategy: 'none',
    });
    const route = result.routes[0];
    centerline = route.polyline.map((p) => [p[0] * 1000, p[1] * 1000, p[2] * 1000]);
  } else {
    // linear: the waypoints themselves are the centerline vertices.
    centerline = waypoints.map((p) => [p[0], p[1], p[2]]);
  }

  // Per-segment lengths + total = arc length (Σ chord lengths over the sampled
  // centerline; for 'linear' this is the exact polyline arc length, for
  // 'spline' it is the arc length of the sampled spline, and for 'catenary' the
  // sampled chord-sum converges to 2a·sinh(d/2a) — we report the ANALYTIC
  // catenary value as `length` and the sampled value as `lengthSampled`).
  const segments = [];
  for (let i = 1; i < centerline.length; i++) {
    const A = centerline[i - 1]; const B = centerline[i];
    segments.push({ from: A.slice(), to: B.slice(), length: distMM(A, B) });
  }
  const sampledLen = segments.reduce((s, g) => s + g.length, 0);

  let length = sampledLen;
  let lengthSampled = sampledLen;
  if (mode === 'catenary') {
    const from = waypoints[0]; const to = waypoints[waypoints.length - 1];
    const d = Math.hypot(to[0] - from[0], to[1] - from[1]); // horizontal span (mm)
    const H = opts.anchorTension != null ? opts.anchorTension : 50;
    const w = opts.weightPerLength != null ? opts.weightPerLength : 1;
    // catenaryLength is unit-agnostic in d (a = H/w has units of length; here
    // we treat the span d in metres for the physical a, then scale length back
    // to mm). Because L scales linearly with the unit of d when a scales too,
    // we compute in mm directly using a expressed in mm: a_mm = (H/w)*1000.
    const a_mm = (H / w) * 1000;
    length = 2 * a_mm * Math.sinh(d / (2 * a_mm));
  }

  // Bend-radius check on the sampled centerline (mm). For 'linear' with only
  // the raw vertices the radius at each vertex is the circumscribed-circle
  // radius of the corner (sharp corners → small radius).
  const radiiM = localBendRadii_m(centerline.map((p) => [p[0] / 1000, p[1] / 1000, p[2] / 1000]));
  let minR = Infinity;
  for (let i = 1; i < radiiM.length - 1; i++) if (radiiM[i] < minR) minR = radiiM[i];
  const minBendRadius = minR === Infinity ? null : minR * 1000;

  return {
    mode,
    centerline,
    segments,
    length,          // mm — arc length surfaced as the length feedback
    lengthSampled,   // mm — sampled chord-sum (== length for linear/spline)
    length_m: length / 1000,
    bundleRadius,    // mm
    minBendRadius,   // mm | null
    requiredBendRadius: opts.cableId
      ? bendRadiusFor(Array.isArray(opts.cableId) ? opts.cableId[0] : opts.cableId) * 1000
      : null,
  };
}

function distMM(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

// ─────────────────────────────────────────────────────────────────────
// Arc-length of an arbitrary polyline (mm) — exported for ground-truth
// checks. (Same definition as harnessRouter.polylineLength_m but in mm.)
// ─────────────────────────────────────────────────────────────────────
export function splineArcLength(points, samplesPerSegment = 64) {
  const sp = catmullRomSpline(
    points.map((p) => [p[0] / 1000, p[1] / 1000, p[2] / 1000]),
    samplesPerSegment,
  );
  return polylineLength_m(sp) * 1000;
}

export function polylineArcLength(points) {
  let L = 0;
  for (let i = 1; i < points.length; i++) L += distMM(points[i - 1], points[i]);
  return L;
}

// ─────────────────────────────────────────────────────────────────────
// Default export = the primary bidirectional entry (import). Mirrors the
// io/* house style (default export = the primary fn).
// ─────────────────────────────────────────────────────────────────────
export default ecadImportBoard;

// Internal helpers exported for testing (io/* house style).
export const __test = {
  parseEmn, writeEmn, parseEmp,
  tokenizeIdfLine, parseLoop, fmt, loopRow, num,
  liftComponentToBody, liftBoardSlab, assemblyToBoard,
  packageFootprint, boxMesh, boxMeshAt, loopBBox,
  splineArcLength, polylineArcLength, catenaryLength, catenaryPolyline,
  routeHarness, ecadImportBoard, ecadExportBoard,
  DEFAULT_PACKAGES, IDF_CONFORMANCE,
};
