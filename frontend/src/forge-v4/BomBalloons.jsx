// Forge-90 — BOM table + auto-balloon placement.
//
// Given a list of bodies in the active project, build a BOM grouped by
// (name × material) — quantity = count of bodies sharing those fields.
// The BOM table renders to the right inspector; the balloons are placed
// onto the active drawing view (the workbench passes the active view).
//
// Mass is computed via window.forge.mass(handle, density) when available,
// otherwise estimated from the body's bounding-box volume × density.
//
// Default placement strategy: ring around the drawing extents, evenly
// spaced. The user can re-position any balloon by dragging — the drag
// handler is provided by the workbench.

import React, { useMemo } from 'react';

// Density g/cm³ → kg/mm³ (1 g/cm³ = 1e-6 kg/mm³).
const DENSITY = Object.freeze({
  'steel':      7.85e-6,
  'aluminum':   2.70e-6,
  'aluminium':  2.70e-6,
  'brass':      8.40e-6,
  'copper':     8.96e-6,
  'titanium':   4.51e-6,
  'plastic':    1.20e-6,
  'pla':        1.24e-6,
  'abs':        1.04e-6,
  'nylon':      1.14e-6,
  'wood':       0.70e-6,
  'glass':      2.50e-6,
  'rubber':     1.20e-6,
  'stainless':  8.00e-6,
  'unknown':    1.00e-6,
});

function densityFor(material) {
  const k = String(material || '').toLowerCase().trim();
  return DENSITY[k] || DENSITY.unknown;
}

function bboxVolumeForBody(body) {
  // Synthetic specs carry their own dx/dy/dz; native bodies don't (yet).
  // We approximate a cube of 25 mm if no info available.
  const s = body?.spec;
  if (!s) return 25 * 25 * 25;
  if (typeof s.dx === 'number' && typeof s.dy === 'number' && typeof s.dz === 'number') {
    return Math.max(1, s.dx) * Math.max(1, s.dy) * Math.max(1, s.dz);
  }
  if (typeof s.r === 'number' && typeof s.h === 'number') {
    return Math.PI * s.r * s.r * s.h;
  }
  if (typeof s.R === 'number' && typeof s.r === 'number') {
    return 2 * Math.PI * Math.PI * s.R * s.r * s.r;
  }
  return 25 * 25 * 25;
}

function estimateMassKg(body, density) {
  // 1) try the kernel
  if (typeof window !== 'undefined' && window.forge?.mass &&
      typeof body?.handle === 'number') {
    try {
      const m = window.forge.mass(body.handle, density);
      if (Number.isFinite(m) && m > 0) return m;
    } catch (err) { /* fall through */ }
  }
  // 2) bbox * density
  const v = bboxVolumeForBody(body);     // mm³
  return v * density;                    // kg
}

/**
 * Group bodies into BOM rows. Returns:
 *   [{ id, balloon, name, qty, material, mass, density, bodies:[…] }]
 */
export function buildBom(bodies, opts = {}) {
  const matOverrides = opts.materials || {};
  const groups = new Map();
  for (const b of bodies || []) {
    if (!b) continue;
    const name = b.name || b.toolId || 'Body';
    const material = matOverrides[b.id] || b.material || 'Aluminum';
    const key = `${name}::${material}`;
    if (!groups.has(key)) {
      groups.set(key, { name, material, bodies: [] });
    }
    groups.get(key).bodies.push(b);
  }
  let balloon = 1;
  return Array.from(groups.values()).map((g) => {
    const density = densityFor(g.material);
    let totalMass = 0;
    for (const body of g.bodies) totalMass += estimateMassKg(body, density);
    return {
      id: `bom-${balloon}`,
      balloon: balloon++,
      name: g.name,
      qty: g.bodies.length,
      material: g.material,
      density,
      mass: totalMass,
      bodies: g.bodies,
    };
  });
}

/**
 * Default ring placement. Returns Map(rowId -> {x,y}).
 */
export function defaultBalloonPositions(rows, bounds) {
  const out = new Map();
  if (!rows?.length || !bounds) return out;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const r  = Math.max(bounds.w, bounds.h) * 0.65;
  const n  = rows.length;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
    out.set(rows[i].id, {
      x: cx + r * Math.cos(a),
      y: cy + r * Math.sin(a),
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────── Table view

export function BomTable({ rows, onMaterialChange, onRemoveRow }) {
  const total = useMemo(
    () => rows.reduce((s, r) => s + (r.qty || 0), 0),
    [rows],
  );
  const totalMass = useMemo(
    () => rows.reduce((s, r) => s + (r.mass || 0), 0),
    [rows],
  );
  if (!rows.length) {
    return (
      <div style={{
        padding: 12, fontSize: 11, color: 'var(--forge-ink-mute)',
        fontStyle: 'italic',
      }}>
        BOM is empty. Add bodies to the project to populate the bill of
        materials.
      </div>
    );
  }
  return (
    <div data-testid="forge-bom-table"
         style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{
            borderBottom: '1px solid var(--forge-rail-edge)',
            color: 'var(--forge-ink-mute)', textAlign: 'left',
          }}>
            <th style={{ padding: '4px 6px', fontWeight: 500, width: 26 }}>#</th>
            <th style={{ padding: '4px 6px', fontWeight: 500 }}>Name</th>
            <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'right' }}>Qty</th>
            <th style={{ padding: '4px 6px', fontWeight: 500 }}>Material</th>
            <th style={{ padding: '4px 6px', fontWeight: 500, textAlign: 'right' }}>Mass</th>
            <th style={{ padding: '4px 6px', width: 18 }} aria-label="actions"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}
                data-bom-row={r.id}
                style={{ borderBottom: '1px solid var(--forge-rail-edge)' }}>
              <td style={{
                padding: '4px 6px',
                fontFamily: 'var(--forge-mono)',
                color: 'var(--forge-accent)',
                fontWeight: 600,
              }}>{r.balloon}</td>
              <td style={{ padding: '4px 6px', color: 'var(--forge-ink)' }}>{r.name}</td>
              <td style={{
                padding: '4px 6px', textAlign: 'right',
                fontFamily: 'var(--forge-mono)',
                color: 'var(--forge-ink)',
              }}>{r.qty}</td>
              <td style={{ padding: '4px 6px' }}>
                <select
                  value={r.material}
                  onChange={(e) => onMaterialChange?.(r.id, e.target.value)}
                  data-bom-material={r.id}
                  style={{
                    background: 'var(--forge-canvas)',
                    border: '1px solid var(--forge-rail-edge)',
                    color: 'var(--forge-ink)',
                    font: 'inherit', fontSize: 11,
                    padding: '2px 4px', borderRadius: 3,
                    width: '100%',
                  }}>
                  {Object.keys(DENSITY)
                    .filter((k) => k !== 'unknown' && k !== 'aluminium')
                    .map((k) => (
                      <option key={k} value={k}>
                        {k.charAt(0).toUpperCase() + k.slice(1)}
                      </option>
                    ))}
                </select>
              </td>
              <td style={{
                padding: '4px 6px', textAlign: 'right',
                fontFamily: 'var(--forge-mono)',
                color: 'var(--forge-ink-2)',
              }}>
                {(r.mass * 1000).toFixed(1)} g
              </td>
              <td style={{ padding: '4px 6px' }}>
                <button type="button"
                        onClick={() => onRemoveRow?.(r.id)}
                        aria-label={`Remove row ${r.balloon}`}
                        style={{
                          background: 'transparent', border: 'none',
                          color: 'var(--forge-ink-mute)', cursor: 'pointer',
                          fontSize: 11,
                        }}>×</button>
              </td>
            </tr>
          ))}
          <tr>
            <td colSpan={2} style={{ padding: '6px', fontWeight: 600 }}>Total</td>
            <td style={{
              padding: '6px', textAlign: 'right', fontWeight: 600,
              fontFamily: 'var(--forge-mono)',
            }}>{total}</td>
            <td></td>
            <td style={{
              padding: '6px', textAlign: 'right', fontWeight: 600,
              color: 'var(--forge-accent)',
              fontFamily: 'var(--forge-mono)',
            }}>{(totalMass * 1000).toFixed(1)} g</td>
            <td></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─────────────────────────────────────────────────────── Balloons SVG

/**
 * Render balloon callouts as SVG. Each balloon is a circle + the balloon
 * number, with a leader line drawn from the balloon centre toward the
 * view centroid (so the leader naturally points at the geometry).
 */
export function BalloonLayer({ rows, positions, centroid, onDragStart }) {
  if (!rows?.length || !positions) return null;
  return (
    <g data-testid="forge-balloons">
      {rows.map((r) => {
        const p = positions.get(r.id);
        if (!p) return null;
        const cx = p.x, cy = p.y;
        const tx = centroid?.x ?? 0;
        const ty = centroid?.y ?? 0;
        const dx = tx - cx, dy = ty - cy;
        const len = Math.hypot(dx, dy) || 1;
        const R = 4;
        const lx = cx + (dx / len) * R;
        const ly = cy + (dy / len) * R;
        return (
          <g key={r.id}
             data-balloon-id={r.id}
             data-balloon-number={r.balloon}
             style={{ cursor: onDragStart ? 'grab' : 'default' }}
             onMouseDown={(e) => onDragStart?.(e, r.id)}>
            <line x1={lx} y1={ly} x2={tx} y2={ty}
                  stroke="var(--forge-ink-2)" strokeWidth={0.3} />
            <circle cx={cx} cy={cy} r={R}
                    fill="var(--forge-canvas)"
                    stroke="var(--forge-accent)" strokeWidth={0.5} />
            <text x={cx} y={cy + 1.4} textAnchor="middle"
                  fontFamily="var(--forge-mono)" fontSize={3.6}
                  fontWeight={600}
                  fill="var(--forge-ink)">
              {r.balloon}
            </text>
          </g>
        );
      })}
    </g>
  );
}
