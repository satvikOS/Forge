// Forge-109 — Surface finish callout per ISO 1302 / ASME Y14.36.
//
// Renders the basic open-V symbol with optional bars and a label group:
//
//     Removed (material removal required):  ∇ + horizontal bar above
//     Required (any process):                ∇ (basic — open V)
//     Prohibited (no material removal):      ∇ with circle inside
//
// To the right / below the symbol:
//   Ra/Rz/Rmax + value (µm)
//   Lay direction symbol  (=, ⊥, X, M, C, R, P)
//
// All glyphs are real Unicode where standards specify; lay symbols are
// taken from ISO 1302 Annex B.

import React from 'react';

// ── Variants ─────────────────────────────────────────────────────────

export const FINISH_VARIANTS = Object.freeze({
  required:   { label: 'Any process (basic)',         glyph: 'V'  },
  removed:    { label: 'Material removal required',   glyph: 'V/' },
  prohibited: { label: 'Material removal prohibited', glyph: 'V0' },
});

export const ROUGHNESS_PARAMS = Object.freeze({
  Ra:   { label: 'Ra — arithmetic mean',   unit: 'µm' },
  Rz:   { label: 'Rz — average peak-valley', unit: 'µm' },
  Rmax: { label: 'Rmax — max peak-valley',   unit: 'µm' },
});

// Lay direction symbols (ISO 1302 Annex B)
export const LAY_SYMBOLS = Object.freeze({
  '=':  { label: 'Parallel to projection plane' },
  '⊥':  { label: 'Perpendicular to projection plane' },
  'X':  { label: 'Crossed in two oblique directions' },
  'M':  { label: 'Multi-directional' },
  'C':  { label: 'Circular about centre' },
  'R':  { label: 'Radial relative to centre' },
  'P':  { label: 'Particulate / non-directional' },
});

// ── Factory + validation ─────────────────────────────────────────────

export function makeSurfaceFinish({
  variant = 'required',
  param   = 'Ra',
  value   = 1.6,
  lay     = null,           // null = unspecified
} = {}) {
  return { variant, param, value, lay };
}

export function validateFinish(f) {
  if (!f || !FINISH_VARIANTS[f.variant])  return false;
  if (!ROUGHNESS_PARAMS[f.param])         return false;
  if (!Number.isFinite(f.value))          return false;
  if (f.lay != null && !LAY_SYMBOLS[f.lay]) return false;
  return true;
}

// ── Glyph rendering ──────────────────────────────────────────────────
// The basic checkmark-V is drawn from two strokes that meet at the
// point; the bar / circle decorations differentiate variants. The full
// glyph fits in a 6x7 mm box; the label sits to its right.

const SYM_W = 6;
const SYM_H = 7;
const FONT  = 'var(--forge-mono)';
const FONT_SZ = 3.2;

function VGlyph({ variant, ink, stroke }) {
  // Two strokes forming a check-V:
  //   leg-left  : (0, h-3) → (legX, h)
  //   leg-right : (legX, h) → (w, 0)
  const w = SYM_W, h = SYM_H;
  const legX = w * 0.35;
  return (
    <>
      <line x1={0} y1={h * 0.55} x2={legX} y2={h}
            stroke={ink} strokeWidth={stroke} strokeLinecap="round" />
      <line x1={legX} y1={h} x2={w} y2={0}
            stroke={ink} strokeWidth={stroke} strokeLinecap="round" />
      {/* Removed variant: horizontal bar above the V */}
      {variant === 'removed' && (
        <line x1={legX * 0.2} y1={h * 0.20} x2={w} y2={h * 0.20}
              stroke={ink} strokeWidth={stroke} />
      )}
      {/* Prohibited: circle at the joint of the two strokes */}
      {variant === 'prohibited' && (
        <circle cx={legX + 0.3} cy={h * 0.78} r={0.9}
                fill="none" stroke={ink} strokeWidth={stroke * 0.8} />
      )}
    </>
  );
}

/**
 * Render the full surface-finish callout at (x,y).
 */
export function SurfaceFinishGlyph({
  x = 0, y = 0, finish, ink = '#14161b', stroke = 0.4,
  ariaLabel, dataKey,
}) {
  if (!finish || !validateFinish(finish)) return null;
  const valText = `${finish.param} ${finish.value} ${ROUGHNESS_PARAMS[finish.param].unit}`;
  const layText = finish.lay ? finish.lay : '';
  const labelW = Math.max(valText.length, layText.length) * 1.9 + 2;

  return (
    <g data-surface-finish="true"
       data-finish-variant={finish.variant}
       data-finish-param={finish.param}
       data-finish-value={finish.value}
       data-finish-lay={finish.lay || ''}
       data-finish-key={dataKey || ''}
       aria-label={ariaLabel ||
         `Surface finish ${valText}${layText ? ` lay ${layText}` : ''}`}
       transform={`translate(${x} ${y})`}>
      <VGlyph variant={finish.variant} ink={ink} stroke={stroke} />
      {/* roughness label to the right */}
      <text x={SYM_W + 0.8} y={SYM_H * 0.45}
            fontFamily={FONT} fontSize={FONT_SZ}
            fill={ink} dominantBaseline="middle"
            data-finish-label="value">
        {valText}
      </text>
      {/* lay direction below the value (if present) */}
      {layText && (
        <text x={SYM_W + 0.8} y={SYM_H * 0.45 + FONT_SZ + 0.4}
              fontFamily={FONT} fontSize={FONT_SZ * 0.9}
              fill={ink} dominantBaseline="middle"
              data-finish-label="lay">
          {layText}
        </text>
      )}
    </g>
  );
}

/**
 * Surface finish with a leader line + arrow head at the anchor point.
 */
export function SurfaceFinishWithLeader({
  finish, anchor, frame, ink = '#14161b', dataKey,
}) {
  if (!anchor || !frame) return null;
  const ax = anchor[0], ay = anchor[1];
  const fx = frame[0],  fy  = frame[1];
  const arrow = 1.2;
  const dx = ax - fx, dy = ay - fy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const aL = [ax - ux * arrow + (-uy) * (arrow * 0.4),
              ay - uy * arrow + ( ux) * (arrow * 0.4)];
  const aR = [ax - ux * arrow - (-uy) * (arrow * 0.4),
              ay - uy * arrow - ( ux) * (arrow * 0.4)];
  return (
    <g data-surface-finish-group="true" data-finish-key={dataKey || ''}>
      <line x1={fx} y1={fy + SYM_H * 0.85}
            x2={ax} y2={ay}
            stroke={ink} strokeWidth={0.3} />
      <polygon points={`${ax},${ay} ${aL[0]},${aL[1]} ${aR[0]},${aR[1]}`}
               fill={ink} stroke={ink} strokeWidth={0.2} />
      <SurfaceFinishGlyph finish={finish} x={fx} y={fy}
                          ink={ink} dataKey={dataKey} />
    </g>
  );
}

// ── Drop-down menu picker (used by the workbench toolbar) ────────────

export function SurfaceFinishPicker({ initial, onCommit, onCancel }) {
  const [variant, setVariant] = React.useState(initial?.variant || 'required');
  const [param,   setParam]   = React.useState(initial?.param   || 'Ra');
  const [value,   setValue]   = React.useState(initial?.value   ?? 1.6);
  const [lay,     setLay]     = React.useState(initial?.lay     || '');

  const commit = () => {
    onCommit?.(makeSurfaceFinish({
      variant, param,
      value: parseFloat(value) || 0,
      lay: lay || null,
    }));
  };

  return (
    <div data-testid="forge-finish-picker"
         style={{
           background: 'var(--forge-canvas-3)',
           border: '1px solid var(--forge-rail-edge)',
           borderRadius: 'var(--forge-radius)',
           padding: 10, minWidth: 260,
           fontFamily: 'var(--forge-mono)', fontSize: 11,
           color: 'var(--forge-ink)',
           boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
           display: 'flex', flexDirection: 'column', gap: 8,
         }}>
      <div>
        <label style={labelStyle}>Variant</label>
        <select value={variant} onChange={(e) => setVariant(e.target.value)}
                data-finish-field="variant"
                style={inputStyle}>
          {Object.entries(FINISH_VARIANTS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Parameter</label>
          <select value={param} onChange={(e) => setParam(e.target.value)}
                  data-finish-field="param"
                  style={inputStyle}>
            {Object.keys(ROUGHNESS_PARAMS).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Value (µm)</label>
          <input type="number" step="0.01" min="0"
                 value={value} onChange={(e) => setValue(e.target.value)}
                 data-finish-field="value"
                 style={inputStyle} />
        </div>
      </div>
      <div>
        <label style={labelStyle}>Lay direction</label>
        <select value={lay} onChange={(e) => setLay(e.target.value)}
                data-finish-field="lay"
                style={inputStyle}>
          <option value="">(unspecified)</option>
          {Object.entries(LAY_SYMBOLS).map(([k, v]) => (
            <option key={k} value={k}>{k}  {v.label}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        {onCancel && (
          <button type="button" onClick={onCancel}
                  data-testid="forge-finish-cancel"
                  style={buttonStyle}>Cancel</button>
        )}
        <button type="button" onClick={commit}
                data-testid="forge-finish-commit"
                style={{ ...buttonStyle,
                         background: 'var(--forge-accent-mute)',
                         borderColor: 'var(--forge-accent-rim)' }}>
          Add
        </button>
      </div>
    </div>
  );
}

const labelStyle = {
  color: 'var(--forge-ink-mute)', fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '0.06em',
  display: 'block', marginBottom: 2,
};
const inputStyle = {
  background: 'var(--forge-canvas)',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)',
  font: 'inherit', fontSize: 11,
  padding: '3px 5px', borderRadius: 3,
  width: '100%',
};
const buttonStyle = {
  background: 'var(--forge-surface)',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink-2)',
  padding: '3px 8px', fontSize: 11,
  borderRadius: 3, cursor: 'pointer',
};

export default SurfaceFinishGlyph;
