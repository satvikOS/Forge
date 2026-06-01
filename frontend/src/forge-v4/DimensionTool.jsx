// Forge-90 — dimension tool for the drawings workbench.
//
// Click two points on a drawing view → places a dimension entity:
//   { id, kind:'linear'|'aligned'|'angular',
//     a:[x,y], b:[x,y], offset:number,
//     value:number, unit:string, precision:number,
//     viewId, hidden?:boolean }
//
// The hook exposes:
//   useDimensionTool({ active, onCommit, units, precision })
//     → { phase, hover, pendingA, recordClick, cancel,
//         renderPreview(viewBox, scale) }
//
// And the standalone DimensionLayer renders an array of dimensions as
// SVG (extension lines + arrow heads + value text), used both by the
// preview and by the persisted dimensions on each sheet.

import React, { useCallback, useState } from 'react';

const UNIT_FACTORS = {
  mm: 1,
  cm: 0.1,
  m:  0.001,
  in: 1 / 25.4,
  ft: 1 / 304.8,
};

export function formatDimensionValue(value, unit = 'mm', precision = 2) {
  const f = UNIT_FACTORS[unit] || 1;
  return `${(value * f).toFixed(precision)} ${unit}`;
}

export function computeLinearDistance(a, b) {
  if (!a || !b) return 0;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return Math.sqrt(dx * dx + dy * dy);
}

export function computeProjectedDistance(a, b, mode) {
  if (!a || !b) return 0;
  const dx = Math.abs(b[0] - a[0]);
  const dy = Math.abs(b[1] - a[1]);
  if (mode === 'horizontal') return dx;
  if (mode === 'vertical')   return dy;
  return computeLinearDistance(a, b);
}

/**
 * Hook used by DrawingsWorkbench. Tracks a two-click sequence.
 *
 * @param {object} opts
 * @param {boolean} opts.active     tool button currently pressed
 * @param {string}  opts.units      'mm' | 'in' | …
 * @param {number}  opts.precision  decimal places
 * @param {function} opts.onCommit  (dim) => void — fires on the 2nd click
 */
export function useDimensionTool({ active, units = 'mm', precision = 2, onCommit, mode = 'aligned' }) {
  const [pendingA, setPendingA] = useState(null);
  const [hover, setHover] = useState(null);

  const recordClick = useCallback((pt, viewId) => {
    if (!active || !pt) return null;
    if (!pendingA) {
      setPendingA({ pt, viewId });
      return { phase: 'awaitingB', a: pt };
    }
    if (pendingA.viewId !== viewId) {
      // Don't span two sheets; restart on the new one.
      setPendingA({ pt, viewId });
      return { phase: 'awaitingB', a: pt };
    }
    const a = pendingA.pt;
    const b = pt;
    const value = computeProjectedDistance(a, b, mode);
    const dim = {
      id: `dim-${Date.now()}-${Math.floor(Math.random() * 0xfff).toString(16)}`,
      kind: mode,
      viewId,
      a, b,
      offset: 12,        // distance the dim line floats off the geometry
      value,
      unit: units,
      precision,
    };
    setPendingA(null);
    setHover(null);
    onCommit?.(dim);
    return { phase: 'placed', dim };
  }, [active, pendingA, mode, units, precision, onCommit]);

  const moveHover = useCallback((pt, viewId) => {
    if (!active) return;
    setHover(pt ? { pt, viewId } : null);
  }, [active]);

  const cancel = useCallback(() => {
    setPendingA(null);
    setHover(null);
  }, []);

  const phase = !active ? 'idle' : pendingA ? 'awaitingB' : 'awaitingA';
  return { phase, hover, pendingA, recordClick, moveHover, cancel };
}

/**
 * Render the dimension preview for the active drag — only shows when a
 * first point has been clicked and a hover is available.
 */
export function DimensionPreview({ pendingA, hover, viewId, units, precision, mode }) {
  if (!pendingA || pendingA.viewId !== viewId) return null;
  if (!hover || hover.viewId !== viewId) return null;
  const a = pendingA.pt, b = hover.pt;
  const value = computeProjectedDistance(a, b, mode);
  return (
    <g data-dim-preview="true" pointerEvents="none">
      <DimensionGlyph dim={{
        a, b, kind: mode, offset: 10, value, unit: units, precision,
      }} preview />
    </g>
  );
}

/**
 * Layer renders every committed dimension. Stroke + arrow + value text.
 */
export function DimensionLayer({ dimensions, viewId }) {
  if (!dimensions?.length) return null;
  return (
    <g data-dim-layer="true">
      {dimensions
        .filter((d) => d.viewId === viewId && !d.hidden)
        .map((d) => <DimensionGlyph key={d.id} dim={d} />)}
    </g>
  );
}

function DimensionGlyph({ dim, preview }) {
  const { a, b, offset = 10, kind } = dim;
  // For aligned mode, dim line is parallel to the segment; for horizontal/
  // vertical, dim line projects onto that axis.
  let aDim, bDim;
  if (kind === 'horizontal') {
    const y = Math.min(a[1], b[1]) - offset;
    aDim = [a[0], y]; bDim = [b[0], y];
  } else if (kind === 'vertical') {
    const x = Math.max(a[0], b[0]) + offset;
    aDim = [x, a[1]]; bDim = [x, b[1]];
  } else {
    // aligned — perpendicular offset
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len, ny = dx / len;
    aDim = [a[0] + nx * offset, a[1] + ny * offset];
    bDim = [b[0] + nx * offset, b[1] + ny * offset];
  }
  const midX = (aDim[0] + bDim[0]) / 2;
  const midY = (aDim[1] + bDim[1]) / 2;
  const stroke = preview ? 'var(--forge-accent)' : 'var(--forge-ink)';
  const sw = 0.4;
  const arrow = 1.5;
  // Arrow heads — small triangles at each end of dim line.
  const angle = Math.atan2(bDim[1] - aDim[1], bDim[0] - aDim[0]);
  const ah = (cx, cy, dir) => {
    const a1 = angle + dir + Math.PI - 0.3;
    const a2 = angle + dir + Math.PI + 0.3;
    return `${cx},${cy} ${cx + arrow * Math.cos(a1)},${cy + arrow * Math.sin(a1)} ${cx + arrow * Math.cos(a2)},${cy + arrow * Math.sin(a2)}`;
  };
  const label = formatDimensionValue(dim.value, dim.unit, dim.precision);
  return (
    <g data-dim-id={dim.id || 'preview'} data-dim-kind={kind}>
      {/* extension lines from geometry pts to dim line */}
      <line x1={a[0]} y1={a[1]} x2={aDim[0]} y2={aDim[1]}
            stroke={stroke} strokeWidth={sw * 0.7} strokeDasharray="1 0.8" />
      <line x1={b[0]} y1={b[1]} x2={bDim[0]} y2={bDim[1]}
            stroke={stroke} strokeWidth={sw * 0.7} strokeDasharray="1 0.8" />
      {/* dim line */}
      <line x1={aDim[0]} y1={aDim[1]} x2={bDim[0]} y2={bDim[1]}
            stroke={stroke} strokeWidth={sw} />
      {/* arrowheads */}
      <polygon points={ah(aDim[0], aDim[1], Math.PI)} fill={stroke} />
      <polygon points={ah(bDim[0], bDim[1], 0)} fill={stroke} />
      {/* value text */}
      <text x={midX} y={midY - 1} textAnchor="middle"
            fontFamily="var(--forge-mono)" fontSize={3.2}
            fill={stroke}
            data-dim-value={label}>
        {label}
      </text>
    </g>
  );
}

/**
 * Helper used by the inspector for editing units / precision on the
 * persisted list. Updates the formatted display so the inspector stays
 * in sync without re-projecting.
 */
export function reformatDimension(dim, units, precision) {
  return {
    ...dim,
    unit: units,
    precision,
  };
}
