// PUSH-178 (Slice-134) — Weldment cutlist math (pure functions).
//
// Real weldment cutlist generation. Scans an array of `bodies` looking
// for **prismatic members** — long, thin axis-aligned bricks that
// represent steel structural sections (square tube, rectangular tube,
// L-angle, C-channel). Groups identical (section, length) pairs into a
// single cutlist row so a fabricator can hand the spreadsheet to a saw.
//
// Hard constraints (PUSH-178 brief):
//   * Pure functions — no React, no DOM. Imported by both the panel
//     (WeldmentCutlistPanel.jsx) and the e2e spec.
//   * Real engineering classification: prismatic = max-dim / mid-dim
//     ratio ≥ MIN_LENGTH_RATIO (default 5). Anything shorter is gear
//     stock or a plate, not a saw-cut weldment member.
//   * Section equality is mm-quantised so 50.0001 × 50 still groups
//     with 50 × 50. Length is rounded to LENGTH_QUANT_MM (1 mm) so
//     500.4 + 500.0 collapse into the same cut.
//   * No external deps.
//
// Classification heuristic — given an AABB (axis-aligned bounding box):
//
//   1. Pick the longest axis = `lengthAxis`. The two shorter dims are
//      the cross-section (a, b) with a ≤ b.
//   2. If max / mid < MIN_LENGTH_RATIO → NOT prismatic, skip the body.
//   3. Else build the section signature:
//        a === b           → 'sq'   (square tube)
//        a / b ≤ 0.66      → 'rect' (rectangular tube)
//        a / b > 0.66      → 'rect' too (still a rect, just closer to square)
//        body.spec.section === 'angle'   → 'angle'   (L-section)
//        body.spec.section === 'channel' → 'channel' (C-channel)
//      The angle/channel branches are intentionally explicit — there's
//      no way to tell an L-section from a thin-walled rectangle by
//      AABB alone, so the modeller has to tag the body. Without a tag
//      the body falls back to sq / rect based on the cross-section
//      aspect ratio.
//   4. Label is "a×b kind", e.g. "3×3 sq" or "5×3 rect" or "50×50 angle".

// ─────────────────────────────────────────────────────────────────────
// Reference constants.

export const MIN_LENGTH_RATIO = 5;
export const LENGTH_QUANT_MM  = 1;
export const SECTION_QUANT_MM = 0.5;

export const SECTION_KINDS = Object.freeze([
  { id: 'sq',      label: 'Square tube' },
  { id: 'rect',    label: 'Rectangular tube' },
  { id: 'angle',   label: 'Angle (L)' },
  { id: 'channel', label: 'Channel (C)' },
]);

// ─────────────────────────────────────────────────────────────────────
// AABB helpers.

/**
 * Normalise an AABB-ish input. Accepts:
 *   * { min: [x,y,z], max: [x,y,z] }
 *   * { dx, dy, dz }
 *   * { width, height, distance }   (the kernel makeBox convention)
 *   * [dx, dy, dz]                  (3-tuple)
 *   * [minX,minY,minZ, maxX,maxY,maxZ] (6-tuple)
 *
 * Returns the absolute dimensions `[dx, dy, dz]` (always positive),
 * or null if the input doesn't carry usable geometry.
 */
export function aabbDims(bbox) {
  if (bbox == null) return null;
  if (Array.isArray(bbox)) {
    if (bbox.length === 3) {
      return [Math.abs(+bbox[0] || 0), Math.abs(+bbox[1] || 0), Math.abs(+bbox[2] || 0)];
    }
    if (bbox.length === 6) {
      return [
        Math.abs(+bbox[3] - +bbox[0]) || 0,
        Math.abs(+bbox[4] - +bbox[1]) || 0,
        Math.abs(+bbox[5] - +bbox[2]) || 0,
      ];
    }
    return null;
  }
  if (typeof bbox === 'object') {
    if (Array.isArray(bbox.min) && Array.isArray(bbox.max)
        && bbox.min.length === 3 && bbox.max.length === 3) {
      return [
        Math.abs(+bbox.max[0] - +bbox.min[0]) || 0,
        Math.abs(+bbox.max[1] - +bbox.min[1]) || 0,
        Math.abs(+bbox.max[2] - +bbox.min[2]) || 0,
      ];
    }
    if (Number.isFinite(+bbox.dx) || Number.isFinite(+bbox.dy) || Number.isFinite(+bbox.dz)) {
      return [Math.abs(+bbox.dx || 0), Math.abs(+bbox.dy || 0), Math.abs(+bbox.dz || 0)];
    }
    if (Number.isFinite(+bbox.width) && Number.isFinite(+bbox.height) && Number.isFinite(+bbox.distance)) {
      return [Math.abs(+bbox.width), Math.abs(+bbox.height), Math.abs(+bbox.distance)];
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Section classification.

/**
 * Classify a body's AABB into a weldment section descriptor.
 *
 * Returns:
 *   { prismatic: true, length, a, b, kind, sectionKey, sectionLabel }
 *   when the AABB is long-and-thin enough to be a saw-cut member.
 *
 *   { prismatic: false, reason }
 *   when the AABB is too cubic / too small / missing.
 *
 * `kindHint` is read from the body's spec.section ('angle' | 'channel')
 * so a modeller can declare an L or C section that AABB alone cannot
 * resolve. Pass `null` for a pure-geometry classification.
 */
export function classify(bbox, kindHint = null) {
  const dims = aabbDims(bbox);
  if (!dims) return { prismatic: false, reason: 'no-aabb' };
  const [ax, ay, az] = dims;
  if (ax <= 0 || ay <= 0 || az <= 0) {
    return { prismatic: false, reason: 'degenerate' };
  }
  // Sort descending so length = longest, a = shortest, b = middle.
  const sorted = [ax, ay, az].sort((p, q) => q - p);
  const length = sorted[0];
  const mid    = sorted[1];
  const minor  = sorted[2];
  if (mid === 0 || length / mid < MIN_LENGTH_RATIO) {
    return { prismatic: false, reason: 'not-prismatic', ratio: length / Math.max(mid, 1e-6) };
  }
  // Section is (minor, mid) → quantise so 50.001 × 50 group with 50 × 50.
  const a = quantiseSection(minor);
  const b = quantiseSection(mid);
  // Pure-geometry section kind: a === b → square, else rectangular.
  let kind = (a === b) ? 'sq' : 'rect';
  // Spec tag override — modeller knows it's an L or C.
  if (kindHint === 'angle')   kind = 'angle';
  if (kindHint === 'channel') kind = 'channel';
  const sectionKey   = `${a.toFixed(1)}x${b.toFixed(1)}-${kind}`;
  const sectionLabel = sectionLabelFor(a, b, kind);
  return {
    prismatic: true,
    length: quantiseLength(length),
    a, b, kind,
    sectionKey,
    sectionLabel,
  };
}

function sectionLabelFor(a, b, kind) {
  // "3×3 sq" / "50×30 rect" / "50×50 angle" / "100×50 channel".
  const ai = formatDim(a);
  const bi = formatDim(b);
  return `${ai}×${bi} ${kind}`;
}

function formatDim(v) {
  if (!Number.isFinite(v)) return '0';
  // Drop the trailing .0 for clean labels.
  return Number(v.toFixed(1)).toString();
}

function quantiseSection(v) {
  const q = SECTION_QUANT_MM;
  return Math.round(v / q) * q;
}
function quantiseLength(v) {
  const q = LENGTH_QUANT_MM;
  return Math.round(v / q) * q;
}

// ─────────────────────────────────────────────────────────────────────
// Body → AABB extraction.

/**
 * Pull an AABB out of a forge body. Inspection order:
 *   1. body.bbox / body.aabb        — explicit (set by callers / e2e).
 *   2. body.spec.dx/dy/dz           — pure-geometry spec.
 *   3. body.params.width/height/distance — kernel makeBox convention.
 *   4. window.forge.massProps(body.handle) — fall back to volume^(1/3)
 *      to surface mass at least. The cutlist won't classify those
 *      bodies as prismatic since we have no aspect ratio data — they
 *      drop out cleanly.
 *
 * Returns `null` if no geometry is available — the caller treats that
 * as "skip this body".
 */
export function bodyAABB(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.bbox) {
    const d = aabbDims(body.bbox);
    if (d) return d;
  }
  if (body.aabb) {
    const d = aabbDims(body.aabb);
    if (d) return d;
  }
  if (body.spec && typeof body.spec === 'object') {
    const d = aabbDims(body.spec);
    if (d && (d[0] > 0 || d[1] > 0 || d[2] > 0)) return d;
  }
  if (body.params && typeof body.params === 'object') {
    const d = aabbDims(body.params);
    if (d && (d[0] > 0 || d[1] > 0 || d[2] > 0)) return d;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────
// Cutlist aggregation.

/**
 * Group bodies into cutlist rows by (section, length).
 *
 * Returns sorted rows shaped:
 *   {
 *     key, sectionKey, sectionLabel, kind, a, b, length,
 *     qty, totalLength,
 *     bodies: [{ id, name }]
 *   }
 *
 * Bodies that aren't prismatic are excluded (the second tuple `skipped`
 * lists them with the rejection reason — useful for the panel's
 * diagnostics row).
 */
export function groupByLengthAndSection(bodies) {
  const groups = new Map();
  const skipped = [];
  for (const body of bodies || []) {
    if (!body) continue;
    const bbox = bodyAABB(body);
    if (!bbox) {
      skipped.push({ body, reason: 'no-aabb' });
      continue;
    }
    const kindHint = body.spec?.section || body.section || null;
    const cls = classify(bbox, kindHint);
    if (!cls.prismatic) {
      skipped.push({ body, reason: cls.reason });
      continue;
    }
    const key = `${cls.sectionKey}@${cls.length.toFixed(1)}`;
    let row = groups.get(key);
    if (!row) {
      row = {
        key,
        sectionKey:   cls.sectionKey,
        sectionLabel: cls.sectionLabel,
        kind:         cls.kind,
        a:            cls.a,
        b:            cls.b,
        length:       cls.length,
        qty:          0,
        totalLength:  0,
        bodies:       [],
      };
      groups.set(key, row);
    }
    row.qty += 1;
    row.totalLength += cls.length;
    row.bodies.push({ id: body.id ?? null, name: body.name ?? 'Body' });
  }
  const rows = Array.from(groups.values()).sort((p, q) => {
    // Sort by kind, then by section size (smaller first), then by length.
    const kindOrder = (k) => SECTION_KINDS.findIndex((s) => s.id === k);
    const kp = kindOrder(p.kind);
    const kq = kindOrder(q.kind);
    if (kp !== kq) return kp - kq;
    if (p.a !== q.a) return p.a - q.a;
    if (p.b !== q.b) return p.b - q.b;
    return p.length - q.length;
  });
  return { rows, skipped };
}

/**
 * Total qty + length across every cutlist row.
 */
export function totalsFor(rows) {
  let qty = 0, totalLength = 0;
  for (const r of rows || []) {
    qty += r.qty || 0;
    totalLength += r.totalLength || 0;
  }
  return { qty, totalLength };
}

// ─────────────────────────────────────────────────────────────────────
// CSV export.

/**
 * CSV — one row per group + a TOTAL footer. Excel + Numbers safe (CRLF,
 * every cell quoted). Columns:
 *   key, section, kind, a_mm, b_mm, length_mm, qty, total_length_mm, names
 */
export function exportCutlistCsv(rows) {
  const cols = ['key', 'section', 'kind',
                'a_mm', 'b_mm', 'length_mm',
                'qty', 'total_length_mm', 'names'];
  const lines = [cols.map(quoteField).join(',')];
  for (const r of rows || []) {
    const names = (r.bodies || []).map((b) => b.name).join(';');
    lines.push([
      r.key, r.sectionLabel, r.kind,
      r.a, r.b, r.length,
      r.qty, r.totalLength,
      names,
    ].map(quoteField).join(','));
  }
  const t = totalsFor(rows);
  lines.push('');
  lines.push([quoteField('TOTAL'), '', '',
              '', '', '',
              quoteField(t.qty),
              quoteField(t.totalLength),
              ''].join(','));
  return lines.join('\r\n');
}

function quoteField(v) {
  const s = (v == null) ? '' : String(v);
  return '"' + s.replace(/"/g, '""') + '"';
}

// ─────────────────────────────────────────────────────────────────────
// Default export — bundle for the headless helper surface.

export default Object.freeze({
  MIN_LENGTH_RATIO, LENGTH_QUANT_MM, SECTION_QUANT_MM, SECTION_KINDS,
  aabbDims, bodyAABB, classify,
  groupByLengthAndSection, totalsFor, exportCutlistCsv,
});
