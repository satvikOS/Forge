// Forge-130 — ordinate dimensions.
//
// An ordinate dimension stack measures the perpendicular distance from a
// zero-baseline (datum origin) to a feature. All values are shown
// without a dimension line — just a leader from the feature ending in a
// horizontal or vertical text label that reads the absolute distance.
//
// Origin marker: small "0" inside a square, anchored at the zero point.
// Each subsequent ordinate appears stacked along the chosen axis, with
// leaders kicked perpendicular so the labels stay clear of geometry.
//
// Spec reference: ASME Y14.5-2018 §6.5 (ordinate / chain / coordinate
// dimensioning).

import React, { useCallback, useState } from 'react';

export const ORDINATE_AXIS = Object.freeze({
  horizontal: 'horizontal',   // values measured along X (baseline vertical)
  vertical:   'vertical',     // values measured along Y (baseline horizontal)
});

export const DEFAULT_ORDINATE_OPTS = Object.freeze({
  axis:      ORDINATE_AXIS.horizontal,
  precision: 2,
  unit:      'mm',
});

/** Create a new ordinate-stack record (one origin + N values). */
export function makeOrdinateStack({
  origin = [0, 0],
  axis = ORDINATE_AXIS.horizontal,
  precision = 2,
  unit = 'mm',
  values = [],
  viewId = null,
}) {
  return {
    id:        `ord-${Date.now()}-${Math.floor(Math.random() * 0xfff).toString(16)}`,
    origin:    [origin[0], origin[1]],
    axis,
    precision,
    unit,
    values:    values.slice(),
    viewId,
    createdAt: Date.now(),
  };
}

/** Append a feature point to an ordinate stack. */
export function appendOrdinate(stack, pt) {
  if (!stack || !pt) return stack;
  return {
    ...stack,
    values: [...stack.values, [pt[0], pt[1]]],
  };
}

/**
 * Hook used by DrawingsWorkbench to place an ordinate stack:
 *   1st click → origin.
 *   Each subsequent click → adds a value to the active stack.
 *   ESC / cancel → commits & resets.
 */
export function useOrdinateTool({ active, axis = ORDINATE_AXIS.horizontal,
                                  unit = 'mm', precision = 2, onCommit }) {
  const [stack, setStack] = useState(null);
  const [phase, setPhase] = useState('idle');   // 'idle'|'placing'

  const recordClick = useCallback((pt, viewId) => {
    if (!active || !pt) return null;
    if (!stack) {
      const s = makeOrdinateStack({ origin: pt, axis, unit, precision, viewId });
      setStack(s);
      setPhase('placing');
      return { phase: 'placing', stack: s };
    }
    if (stack.viewId !== viewId) {
      // restart on the new sheet
      const s = makeOrdinateStack({ origin: pt, axis, unit, precision, viewId });
      setStack(s);
      return { phase: 'placing', stack: s };
    }
    const s = appendOrdinate(stack, pt);
    setStack(s);
    return { phase: 'placing', stack: s };
  }, [active, stack, axis, unit, precision]);

  const commit = useCallback(() => {
    if (!stack) { setPhase('idle'); return null; }
    onCommit?.(stack);
    setStack(null);
    setPhase('idle');
    return stack;
  }, [stack, onCommit]);

  const cancel = useCallback(() => {
    setStack(null);
    setPhase('idle');
  }, []);

  return { phase, stack, recordClick, commit, cancel };
}

// ── presentation ----------------------------------------------------

const STROKE = 0.4;
const LEADER_OFFSET = 12;        // mm, length of the kicked leader
const ORIGIN_BOX = 3;            // mm

function formatValue(v, unit, precision) {
  return `${v.toFixed(precision)}`;
}

/**
 * Single ordinate stack rendered as SVG. Each label is a stub leader +
 * value text; the origin sports a "0" inside a square.
 */
export function OrdinateStackGlyph({ stack, ink = 'currentColor' }) {
  if (!stack) return null;
  const { origin, axis, precision = 2, unit = 'mm' } = stack;
  const [ox, oy] = origin;
  return (
    <g data-testid="forge-ordinate-stack"
       data-ord-id={stack.id}
       data-ord-axis={axis}
       data-ord-count={stack.values.length}>
      {/* origin marker */}
      <g data-ord-origin="true">
        <rect x={ox - ORIGIN_BOX / 2} y={oy - ORIGIN_BOX / 2}
              width={ORIGIN_BOX} height={ORIGIN_BOX}
              fill="white" stroke={ink} strokeWidth={STROKE} />
        <text x={ox} y={oy + 1.05} textAnchor="middle"
              fontFamily="var(--forge-mono)" fontSize={2.4} fill={ink}>0</text>
      </g>
      {stack.values.map((pt, i) => (
        <OrdinateGlyph key={i}
                       origin={origin}
                       feature={pt}
                       axis={axis}
                       unit={unit}
                       precision={precision}
                       ink={ink}
                       index={i} />
      ))}
    </g>
  );
}

function OrdinateGlyph({ origin, feature, axis, unit, precision, ink, index }) {
  const [ox, oy] = origin;
  const [fx, fy] = feature;
  let labelX, labelY, leaderStart, leaderEnd, value;
  if (axis === ORDINATE_AXIS.horizontal) {
    // Measuring distance along X — leader goes vertical (away from baseline)
    value = Math.abs(fx - ox);
    leaderStart = [fx, fy];
    leaderEnd   = [fx, fy - LEADER_OFFSET];
    labelX = fx;
    labelY = fy - LEADER_OFFSET - 1.2;
  } else {
    // Measuring distance along Y — leader goes horizontal
    value = Math.abs(fy - oy);
    leaderStart = [fx, fy];
    leaderEnd   = [fx + LEADER_OFFSET, fy];
    labelX = fx + LEADER_OFFSET + 1.2;
    labelY = fy + 0.9;
  }
  const txt = formatValue(value, unit, precision);
  return (
    <g data-ord-glyph={index}
       data-ord-value={txt}>
      {/* leader stub */}
      <line x1={leaderStart[0]} y1={leaderStart[1]}
            x2={leaderEnd[0]}   y2={leaderEnd[1]}
            stroke={ink} strokeWidth={STROKE} />
      {/* value text */}
      <text x={labelX} y={labelY}
            textAnchor={axis === ORDINATE_AXIS.horizontal ? 'middle' : 'start'}
            fontFamily="var(--forge-mono)" fontSize={2.6} fill={ink}>
        {txt}
      </text>
    </g>
  );
}

/**
 * Layer renders every stack on a given drawing view.
 */
export function OrdinateLayer({ stacks, viewId, ink = 'currentColor' }) {
  if (!stacks?.length) return null;
  const my = stacks.filter((s) => !viewId || s.viewId === viewId);
  if (!my.length) return null;
  return (
    <g data-testid="forge-ordinate-layer"
       data-ord-view={viewId}
       data-ord-stack-count={my.length}>
      {my.map((s) => <OrdinateStackGlyph key={s.id} stack={s} ink={ink} />)}
    </g>
  );
}

/**
 * Preview rendered during active placement (between origin & first commit).
 */
export function OrdinatePreview({ tool, viewId, ink = 'var(--forge-accent)' }) {
  if (!tool?.stack || tool.stack.viewId !== viewId) return null;
  return (
    <g data-ord-preview="true">
      <OrdinateStackGlyph stack={tool.stack} ink={ink} />
    </g>
  );
}

export default OrdinateStackGlyph;
