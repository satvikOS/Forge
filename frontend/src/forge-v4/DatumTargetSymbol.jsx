// Forge-130 — Datum target symbol per ASME Y14.5 §4.24.
//
// Three forms:
//   • point  — small ✕ at the target point
//   • line   — line segment through two pts with chain-dot style
//   • area   — circular (default) or rectangular shaded zone
//
// Every datum target carries a balloon: a circle bisected by a horizontal
// line. The upper half holds the target size (e.g. "⌀10"); the lower
// half holds the datum-feature letter + target number (e.g. "A1").
// The balloon is connected to the target geometry by a leader line.
//
// Spec reference: ASME Y14.5-2018 figs 4-46 thru 4-52.

import React from 'react';

export const DATUM_TARGET_FORM = Object.freeze({
  point: 'point',
  line:  'line',
  area:  'area',
});

export const DATUM_TARGET_AREA_SHAPE = Object.freeze({
  circle:    'circle',
  rectangle: 'rectangle',
});

/**
 * Build a new datum target record.
 *
 * @param {object} opts
 * @param {'point'|'line'|'area'} opts.form
 * @param {string} opts.datum               datum letter ('A', 'B', …)
 * @param {number} opts.targetNo            target index (1, 2, …)
 * @param {string} [opts.size]              upper-half text, e.g. '⌀10'
 * @param {Array}  opts.geometry            form-specific geometry
 * @param {Array<number>} [opts.balloonAt]  sheet coords [x, y]
 */
export function makeDatumTarget({
  form, datum, targetNo, size = '', geometry, balloonAt,
}) {
  if (!Object.values(DATUM_TARGET_FORM).includes(form)) {
    throw new Error(`makeDatumTarget: unknown form '${form}'`);
  }
  return {
    id:        `dt-${Date.now()}-${Math.floor(Math.random() * 0xfff).toString(16)}`,
    form,
    datum:     String(datum || 'A').toUpperCase(),
    targetNo:  Number.isFinite(targetNo) ? targetNo : 1,
    size:      String(size || ''),
    geometry:  geometry || {},
    balloonAt: Array.isArray(balloonAt) ? balloonAt.slice(0, 2) : [0, 0],
    createdAt: Date.now(),
  };
}

// ── presentation -----------------------------------------------------

const STROKE = 0.4;
const BALLOON_R = 4.5;

function DatumTargetGeometry({ target, ink = 'currentColor' }) {
  const g = target.geometry || {};
  if (target.form === DATUM_TARGET_FORM.point) {
    const x = g.x ?? 0, y = g.y ?? 0;
    const a = 2.2;
    return (
      <g data-dt-geom="point">
        <line x1={x - a} y1={y - a} x2={x + a} y2={y + a}
              stroke={ink} strokeWidth={STROKE} />
        <line x1={x - a} y1={y + a} x2={x + a} y2={y - a}
              stroke={ink} strokeWidth={STROKE} />
      </g>
    );
  }
  if (target.form === DATUM_TARGET_FORM.line) {
    const ax = g.ax ?? 0, ay = g.ay ?? 0;
    const bx = g.bx ?? 10, by = g.by ?? 0;
    // chain-dot line (long-short-long)
    return (
      <line data-dt-geom="line"
            x1={ax} y1={ay} x2={bx} y2={by}
            stroke={ink} strokeWidth={STROKE}
            strokeDasharray="6 1 1 1" />
    );
  }
  if (target.form === DATUM_TARGET_FORM.area) {
    const shape = g.shape || DATUM_TARGET_AREA_SHAPE.circle;
    if (shape === DATUM_TARGET_AREA_SHAPE.rectangle) {
      const x = g.x ?? 0, y = g.y ?? 0;
      const w = g.w ?? 10, h = g.h ?? 8;
      return (
        <g data-dt-geom="area-rect">
          <rect x={x} y={y} width={w} height={h}
                fill="none" stroke={ink} strokeWidth={STROKE}
                strokeDasharray="2 1" />
          <HatchFill x={x} y={y} w={w} h={h} angle={45} spacing={1.6} ink={ink} />
        </g>
      );
    }
    // circle
    const cx = g.cx ?? 0, cy = g.cy ?? 0, r = g.r ?? 4;
    return (
      <g data-dt-geom="area-circle">
        <circle cx={cx} cy={cy} r={r}
                fill="none" stroke={ink} strokeWidth={STROKE}
                strokeDasharray="2 1" />
        <HatchFill x={cx - r} y={cy - r} w={r * 2} h={r * 2}
                   angle={45} spacing={1.6} ink={ink} clipCircle={{ cx, cy, r }} />
      </g>
    );
  }
  return null;
}

function HatchFill({ x, y, w, h, angle = 45, spacing = 2, ink = 'currentColor', clipCircle }) {
  // Build a thin hatched zone. Uses an SVG <defs> pattern via a clip-path
  // when a circle clip is requested.
  const id = `dt-hatch-${Math.floor(Math.random() * 1e9)}`;
  return (
    <g>
      <defs>
        <pattern id={id} width={spacing} height={spacing}
                 patternUnits="userSpaceOnUse"
                 patternTransform={`rotate(${angle})`}>
          <line x1={0} y1={0} x2={0} y2={spacing}
                stroke={ink} strokeWidth={0.15} strokeOpacity={0.6} />
        </pattern>
        {clipCircle && (
          <clipPath id={`${id}-clip`}>
            <circle cx={clipCircle.cx} cy={clipCircle.cy} r={clipCircle.r} />
          </clipPath>
        )}
      </defs>
      <rect x={x} y={y} width={w} height={h}
            fill={`url(#${id})`}
            clipPath={clipCircle ? `url(#${id}-clip)` : undefined} />
    </g>
  );
}

function DatumTargetBalloon({ target, ink = 'currentColor', x, y }) {
  const r = BALLOON_R;
  return (
    <g data-dt-balloon="true"
       data-dt-datum={target.datum}
       data-dt-no={target.targetNo}>
      <circle cx={x} cy={y} r={r}
              fill="white" stroke={ink} strokeWidth={STROKE} />
      <line x1={x - r} y1={y} x2={x + r} y2={y}
            stroke={ink} strokeWidth={STROKE} />
      {/* Upper half = size text (e.g. "⌀10") */}
      <text x={x} y={y - 0.8}
            textAnchor="middle"
            fontFamily="var(--forge-mono)"
            fontSize={2.3} fill={ink}
            data-dt-size={target.size}>
        {target.size || ''}
      </text>
      {/* Lower half = datum + target number (e.g. "A1") */}
      <text x={x} y={y + 2.6}
            textAnchor="middle"
            fontFamily="var(--forge-mono)"
            fontSize={2.6} fontWeight={700} fill={ink}
            data-dt-label={`${target.datum}${target.targetNo}`}>
        {target.datum}{target.targetNo}
      </text>
    </g>
  );
}

/**
 * Full datum target glyph: geometry + leader + balloon.
 * The leader is a straight line from the closest geometry anchor to the
 * balloon centre.
 */
export function DatumTargetSymbol({ target, ink = 'currentColor' }) {
  if (!target) return null;
  const anchor = computeAnchorPoint(target);
  const [bx, by] = target.balloonAt || [anchor.x + 14, anchor.y - 12];
  return (
    <g data-testid="forge-datum-target"
       data-dt-id={target.id}
       data-dt-form={target.form}
       data-dt-datum={target.datum}
       data-dt-no={target.targetNo}>
      <DatumTargetGeometry target={target} ink={ink} />
      {/* Leader line */}
      <line x1={anchor.x} y1={anchor.y} x2={bx} y2={by}
            stroke={ink} strokeWidth={STROKE} />
      <DatumTargetBalloon target={target} ink={ink} x={bx} y={by} />
    </g>
  );
}

function computeAnchorPoint(target) {
  const g = target.geometry || {};
  switch (target.form) {
    case DATUM_TARGET_FORM.point:
      return { x: g.x ?? 0, y: g.y ?? 0 };
    case DATUM_TARGET_FORM.line:
      return {
        x: ((g.ax ?? 0) + (g.bx ?? 0)) / 2,
        y: ((g.ay ?? 0) + (g.by ?? 0)) / 2,
      };
    case DATUM_TARGET_FORM.area:
      if ((g.shape || 'circle') === DATUM_TARGET_AREA_SHAPE.rectangle) {
        return { x: (g.x ?? 0) + (g.w ?? 0) / 2, y: (g.y ?? 0) + (g.h ?? 0) / 2 };
      }
      return { x: g.cx ?? 0, y: g.cy ?? 0 };
    default:
      return { x: 0, y: 0 };
  }
}

/**
 * Render every datum target in `targets` as a layer on a drawing view.
 */
export function DatumTargetLayer({ targets, viewId, ink }) {
  if (!targets?.length) return null;
  const my = targets.filter((t) => !viewId || t.viewId === viewId);
  if (!my.length) return null;
  return (
    <g data-testid="forge-datum-target-layer"
       data-dt-view={viewId}
       data-dt-count={my.length}>
      {my.map((t) => <DatumTargetSymbol key={t.id} target={t} ink={ink} />)}
    </g>
  );
}

/**
 * Compact picker UI used by the workbench inspector.
 * `onCommit(target)` is called when the user finalises the symbol.
 */
export function DatumTargetPicker({ onCommit, onCancel }) {
  const [form, setForm] = React.useState(DATUM_TARGET_FORM.point);
  const [datum, setDatum] = React.useState('A');
  const [targetNo, setTargetNo] = React.useState(1);
  const [size, setSize] = React.useState('⌀10');
  const [shape, setShape] = React.useState(DATUM_TARGET_AREA_SHAPE.circle);
  return (
    <div data-testid="forge-datum-target-picker"
         style={{
           background: 'var(--forge-canvas-3)',
           border: '1px solid var(--forge-rail-edge)',
           borderRadius: 6, padding: 10,
           display: 'flex', flexDirection: 'column', gap: 6,
           color: 'var(--forge-ink)', fontSize: 12,
           minWidth: 220,
         }}>
      <div style={{ fontWeight: 600 }}>Datum target — ASME Y14.5</div>
      <label style={{ display: 'flex', gap: 6 }}>
        <span style={{ width: 60 }}>Form</span>
        <select value={form} onChange={(e) => setForm(e.target.value)}
                data-dt-form-pick="true">
          <option value={DATUM_TARGET_FORM.point}>point</option>
          <option value={DATUM_TARGET_FORM.line}>line</option>
          <option value={DATUM_TARGET_FORM.area}>area</option>
        </select>
      </label>
      <label style={{ display: 'flex', gap: 6 }}>
        <span style={{ width: 60 }}>Datum</span>
        <input value={datum}
               maxLength={1}
               data-dt-datum-pick="true"
               onChange={(e) => setDatum(e.target.value.toUpperCase())} />
      </label>
      <label style={{ display: 'flex', gap: 6 }}>
        <span style={{ width: 60 }}>Target #</span>
        <input type="number" min={1} value={targetNo}
               data-dt-no-pick="true"
               onChange={(e) => setTargetNo(parseInt(e.target.value, 10) || 1)} />
      </label>
      <label style={{ display: 'flex', gap: 6 }}>
        <span style={{ width: 60 }}>Size</span>
        <input value={size}
               data-dt-size-pick="true"
               onChange={(e) => setSize(e.target.value)} />
      </label>
      {form === DATUM_TARGET_FORM.area && (
        <label style={{ display: 'flex', gap: 6 }}>
          <span style={{ width: 60 }}>Shape</span>
          <select value={shape} onChange={(e) => setShape(e.target.value)}
                  data-dt-shape-pick="true">
            <option value={DATUM_TARGET_AREA_SHAPE.circle}>circle</option>
            <option value={DATUM_TARGET_AREA_SHAPE.rectangle}>rectangle</option>
          </select>
        </label>
      )}
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
        <button type="button" onClick={() => onCancel?.()}
                data-dt-cancel="true">Cancel</button>
        <button type="button" data-dt-commit="true"
                onClick={() => {
                  const geometry =
                    form === DATUM_TARGET_FORM.point
                      ? { x: 0, y: 0 }
                      : form === DATUM_TARGET_FORM.line
                        ? { ax: -8, ay: 0, bx: 8, by: 0 }
                        : shape === DATUM_TARGET_AREA_SHAPE.rectangle
                          ? { shape, x: -5, y: -4, w: 10, h: 8 }
                          : { shape, cx: 0, cy: 0, r: 5 };
                  onCommit?.(makeDatumTarget({
                    form, datum, targetNo, size, geometry,
                    balloonAt: [14, -12],
                  }));
                }}>Place</button>
      </div>
    </div>
  );
}

export default DatumTargetSymbol;
