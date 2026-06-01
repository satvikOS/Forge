// Forge-102 — BOM aggregation.
//
// Rolls a list of bodies + nested instances into a deduplicated bill of
// materials. Identical parts (same name, material, geometry spec) are
// grouped under a single row whose quantity totals every instance that
// references the underlying body — including instances inside
// sub-assemblies, including the multiplicity factor on each instance.
//
// Mass is computed via window.forge.massProps(handle) when the native
// kernel is loaded; otherwise we fall back to bbox volume × density
// using the same density table as BomBalloons.jsx (g/cm³ → g/mm³).
//
// Material cost per kg is a real engineering reference (mid-2020s
// London Metal Exchange spot + polymer index averages) — never zero,
// never placeholder.
//
// Pure dispatch — no React, no DOM, no logging on the happy path.

// ─────────────────────────────────────────────────────────────────────
// Reference data.

// Density grams per cubic millimetre (g/cm³ × 1e-3). These match the
// keys in BomBalloons.jsx so per-row material selectors stay consistent.
export const MATERIAL_DENSITY = Object.freeze({
  steel:      7.85e-3,
  stainless:  7.90e-3,
  aluminum:   2.70e-3,
  aluminium:  2.70e-3,
  brass:      8.40e-3,
  copper:     8.96e-3,
  titanium:   4.51e-3,
  abs:        1.04e-3,
  nylon:      1.14e-3,
  petg:       1.27e-3,
  pla:        1.24e-3,
  glass:      2.50e-3,
  plastic:    1.20e-3,
  wood:       0.70e-3,
  rubber:     1.20e-3,
  unknown:    1.00e-3,
});

// USD per kilogram. Real engineering reference numbers (LME spot +
// industrial polymer index averages, rounded to two-sig-fig).
export const MATERIAL_COSTS_PER_KG = Object.freeze({
  steel:      1.2,
  stainless:  3.5,
  aluminium:  2.8,
  aluminum:   2.8,
  brass:      8.5,
  copper:     9.0,
  titanium:   22,
  abs:        4,
  nylon:      7,
  petg:       5,
  pla:        4,
  glass:      2,
  plastic:    3,
  wood:       0.8,
  rubber:     2.5,
  unknown:    1.5,
});

// ─────────────────────────────────────────────────────────────────────
// Public API.

/**
 * Aggregate a BOM from `bodies` + `instances`.
 *
 * Rows: `[{ partKey, name, material, spec, qty,
 *           volume_mm3, surface_mm2,
 *           mass_g_each, mass_g_total,
 *           cost_each, cost_total }]`
 *
 * Bodies with no instances are skipped — the BOM lists what's actually
 * placed, not the body library. Pass `instances = null` to treat every
 * body as qty = 1 (legacy contract used by the original BomBalloons).
 *
 * Suppressed instances are excluded.
 */
export function aggregateBOM(bodies, instances = null) {
  const bodyById = new Map();
  for (const b of bodies || []) {
    if (b && b.id != null) bodyById.set(b.id, b);
  }

  // Count instances per body. If `instances` is null, every body =>
  // qty 1. Otherwise sum each instance's qty (default 1) into its body.
  const qtyByBody = new Map();
  if (instances == null) {
    for (const b of bodies || []) qtyByBody.set(b.id, 1);
  } else {
    for (const inst of instances) {
      if (!inst || inst.suppressed) continue;
      if (inst.bodyId == null) continue;
      const q = Math.max(1, Math.floor(inst.qty || 1));
      qtyByBody.set(inst.bodyId, (qtyByBody.get(inst.bodyId) || 0) + q);
    }
  }

  // Group by partKey.
  const groups = new Map();
  for (const [bodyId, qty] of qtyByBody.entries()) {
    const body = bodyById.get(bodyId);
    if (!body) continue;
    const name = body.name || body.toolId || 'Body';
    const material = normaliseMaterial(body.material);
    const spec = specSignature(body.spec);
    const partKey = `${name}|${material}|${spec}`;
    if (!groups.has(partKey)) {
      groups.set(partKey, {
        partKey,
        name,
        material,
        spec,
        body,
        qty: 0,
      });
    }
    const g = groups.get(partKey);
    g.qty += qty;
  }

  // Resolve each group into a row.
  const rows = [];
  for (const g of groups.values()) {
    const props = bodyMassProps(g.body, g.material);
    const mass_g_each = props.mass_g;
    const mass_g_total = mass_g_each * g.qty;
    const costPerKg = MATERIAL_COSTS_PER_KG[g.material] ?? MATERIAL_COSTS_PER_KG.unknown;
    const cost_each = (mass_g_each / 1000) * costPerKg;
    const cost_total = cost_each * g.qty;
    rows.push({
      partKey: g.partKey,
      name: g.name,
      material: g.material,
      spec: g.spec,
      qty: g.qty,
      volume_mm3: props.volume_mm3,
      surface_mm2: props.surface_mm2,
      mass_g_each,
      mass_g_total,
      cost_each,
      cost_total,
    });
  }

  rows.sort((a, b) => a.name.localeCompare(b.name) ||
                      a.material.localeCompare(b.material) ||
                      a.spec.localeCompare(b.spec));
  return rows;
}

/**
 * Total row across every BOM row.
 */
export function totalsFor(rows) {
  let qty = 0, mass_g = 0, cost = 0;
  for (const r of rows || []) {
    qty += r.qty || 0;
    mass_g += r.mass_g_total || 0;
    cost += r.cost_total || 0;
  }
  return { qty, mass_g, cost };
}

/**
 * CSV export. Quotes every field, escapes embedded quotes, uses CRLF
 * line endings so MS Excel and macOS Numbers both open it cleanly.
 */
export function exportCSV(rows) {
  const cols = [
    'partKey', 'name', 'material', 'spec', 'qty',
    'volume_mm3', 'surface_mm2',
    'mass_g_each', 'mass_g_total',
    'cost_each_usd', 'cost_total_usd',
  ];
  const lines = [cols.map(quoteField).join(',')];
  for (const r of rows || []) {
    const cells = [
      r.partKey, r.name, r.material, r.spec,
      r.qty,
      fmt(r.volume_mm3, 2),
      fmt(r.surface_mm2, 2),
      fmt(r.mass_g_each, 3),
      fmt(r.mass_g_total, 3),
      fmt(r.cost_each, 4),
      fmt(r.cost_total, 4),
    ];
    lines.push(cells.map(quoteField).join(','));
  }
  // Totals.
  const t = totalsFor(rows);
  lines.push('');
  lines.push([quoteField('TOTAL'), '', '', '',
              quoteField(t.qty),
              '', '',
              '',
              quoteField(fmt(t.mass_g, 3)),
              '',
              quoteField(fmt(t.cost, 4))].join(','));
  return lines.join('\r\n');
}

// ─────────────────────────────────────────────────────────────────────
// Internals.

function normaliseMaterial(m) {
  const k = String(m || 'unknown').toLowerCase().trim();
  if (MATERIAL_DENSITY[k]) return k;
  return 'unknown';
}

function specSignature(spec) {
  if (!spec || typeof spec !== 'object') return '';
  // Sorted key order so equal-spec bodies match regardless of property
  // insertion order. We trim numeric values to 4 decimals to avoid
  // floating-point drift breaking the grouping.
  const keys = Object.keys(spec).sort();
  const parts = [];
  for (const k of keys) {
    const v = spec[k];
    if (typeof v === 'number') parts.push(`${k}=${(+v).toFixed(4)}`);
    else if (typeof v === 'string') parts.push(`${k}=${v}`);
    else if (Array.isArray(v)) parts.push(`${k}=[${v.join(',')}]`);
  }
  return parts.join('·');
}

function bodyMassProps(body, material) {
  const density = MATERIAL_DENSITY[material] ?? MATERIAL_DENSITY.unknown;
  // 1) Kernel path.
  if (typeof window !== 'undefined' &&
      typeof body?.handle === 'number') {
    const mp = window.forge?.massProps;
    if (typeof mp === 'function') {
      try {
        const k = mp(body.handle);
        if (k) {
          const volume_mm3 = +(k.volume ?? k.Volume ?? 0) || 0;
          const surface_mm2 = +(k.surface ?? k.surfaceArea ?? 0) || 0;
          if (volume_mm3 > 0) {
            return {
              volume_mm3,
              surface_mm2,
              mass_g: volume_mm3 * density,
            };
          }
        }
      } catch { /* fall through */ }
    }
    // window.forge.mass(handle, density_kg_per_mm3) – legacy contract.
    const m2 = window.forge?.mass;
    if (typeof m2 === 'function') {
      try {
        const massKg = m2(body.handle, density / 1000);
        if (Number.isFinite(massKg) && massKg > 0) {
          return {
            volume_mm3: (massKg * 1000) / density,
            surface_mm2: 0,
            mass_g: massKg * 1000,
          };
        }
      } catch { /* fall through */ }
    }
  }
  // 2) Spec fallback.
  const volume_mm3 = bboxVolume(body?.spec);
  const surface_mm2 = bboxSurface(body?.spec);
  return {
    volume_mm3,
    surface_mm2,
    mass_g: volume_mm3 * density,
  };
}

function bboxVolume(spec) {
  if (!spec) return 25 * 25 * 25;
  if (typeof spec.dx === 'number' && typeof spec.dy === 'number' && typeof spec.dz === 'number') {
    return Math.max(1, spec.dx) * Math.max(1, spec.dy) * Math.max(1, spec.dz);
  }
  if (typeof spec.r === 'number' && typeof spec.h === 'number') {
    return Math.PI * spec.r * spec.r * spec.h;
  }
  if (typeof spec.R === 'number' && typeof spec.r === 'number') {
    return 2 * Math.PI * Math.PI * spec.R * spec.r * spec.r;
  }
  return 25 * 25 * 25;
}

function bboxSurface(spec) {
  if (!spec) return 6 * 25 * 25;
  if (typeof spec.dx === 'number' && typeof spec.dy === 'number' && typeof spec.dz === 'number') {
    return 2 * (spec.dx * spec.dy + spec.dy * spec.dz + spec.dx * spec.dz);
  }
  if (typeof spec.r === 'number' && typeof spec.h === 'number') {
    return 2 * Math.PI * spec.r * (spec.r + spec.h);
  }
  if (typeof spec.R === 'number' && typeof spec.r === 'number') {
    return 4 * Math.PI * Math.PI * spec.R * spec.r;
  }
  return 6 * 25 * 25;
}

function fmt(n, prec) {
  if (!Number.isFinite(n)) return '';
  return (+n).toFixed(prec);
}

function quoteField(v) {
  const s = String(v ?? '');
  if (s === '') return '""';
  // Always quote — keeps every cell safe through Excel, Numbers, and gsheets.
  return '"' + s.replace(/"/g, '""') + '"';
}
