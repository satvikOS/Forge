// Forge-109 — Welding symbol per AWS A2.4.
//
// A welding symbol comprises:
//
//   • Reference line — horizontal segment with an arrow leg pointing at
//     the joint.
//   • Weld type symbol — placed below the reference line (= arrow-side)
//     or above (= other-side).
//   • Size / leg length immediately to the left of the weld symbol.
//   • Tail — diagonal stroke at the far end of the ref line, holding the
//     process abbreviation (GMAW / GTAW / SMAW / SAW).
//   • Flags:
//     - Field weld (filled flag on the elbow): triangle.
//     - Weld-all-around (circle at the elbow): hollow circle.
//
// Only the standard weld types specified in the brief are implemented.

import React from 'react';

// ── Weld type catalog ────────────────────────────────────────────────

export const WELD_TYPES = Object.freeze({
  fillet:   { label: 'Fillet',     code: 'fillet',   glyph: 'fillet'   },
  vgroove:  { label: 'V-groove',   code: 'vgroove',  glyph: 'vgroove'  },
  bevel:    { label: 'Bevel',      code: 'bevel',    glyph: 'bevel'    },
  square:   { label: 'Square',     code: 'square',   glyph: 'square'   },
  ugroove:  { label: 'U-groove',   code: 'ugroove',  glyph: 'ugroove'  },
  jgroove:  { label: 'J-groove',   code: 'jgroove',  glyph: 'jgroove'  },
});

// ── Process codes (AWS) ──────────────────────────────────────────────
// Stored in the tail.

export const WELD_PROCESSES = Object.freeze({
  '':     { label: '(unspecified)' },
  GMAW:   { label: 'Gas Metal Arc Welding (MIG)' },
  GTAW:   { label: 'Gas Tungsten Arc Welding (TIG)' },
  SMAW:   { label: 'Shielded Metal Arc Welding (stick)' },
  SAW:    { label: 'Submerged Arc Welding' },
  FCAW:   { label: 'Flux-Cored Arc Welding' },
  PAW:    { label: 'Plasma Arc Welding' },
});

// ── Factory + validation ─────────────────────────────────────────────

export function makeWeld({
  type      = 'fillet',
  side      = 'arrow',          // 'arrow' | 'other' | 'both'
  size      = 5,                // mm leg length / depth
  length    = null,             // null → continuous
  pitch     = null,
  process   = '',
  fieldWeld = false,
  allAround = false,
} = {}) {
  return { type, side, size, length, pitch, process, fieldWeld, allAround };
}

export function validateWeld(w) {
  if (!w || !WELD_TYPES[w.type])              return false;
  if (!['arrow', 'other', 'both'].includes(w.side)) return false;
  if (!Number.isFinite(w.size))               return false;
  if (w.process && !WELD_PROCESSES[w.process]) return false;
  return true;
}

// ── Weld type symbol path (paper coords, fits in 4x4 mm) ────────────

function WeldTypePath({ type, ink, stroke, flipped }) {
  // The symbol is drawn so the baseline of the reference line is at y=0.
  // If flipped (other side), the symbol is flipped about the x-axis.
  const flip = flipped ? -1 : 1;
  const sw = stroke;
  switch (type) {
    case 'fillet':
      // Right triangle leaning into reference line — leg up, hypotenuse
      return (
        <polyline points={`0,0 0,${3 * flip} 3,0`}
                  fill="none" stroke={ink} strokeWidth={sw} />
      );
    case 'vgroove':
      // Open V opening toward the reference line
      return (
        <polyline points={`0,0 1.5,${3 * flip} 3,0`}
                  fill="none" stroke={ink} strokeWidth={sw} />
      );
    case 'bevel':
      // Single diagonal leg (right side bevelled)
      return (
        <polyline points={`0,0 2.5,${3 * flip} 2.5,0`}
                  fill="none" stroke={ink} strokeWidth={sw} />
      );
    case 'square':
      // Two vertical lines (square-groove)
      return (
        <g>
          <line x1={0.6} y1={0} x2={0.6} y2={3 * flip}
                stroke={ink} strokeWidth={sw} />
          <line x1={2.2} y1={0} x2={2.2} y2={3 * flip}
                stroke={ink} strokeWidth={sw} />
        </g>
      );
    case 'ugroove':
      // Half-ellipse opening toward ref line
      return (
        <path d={`M 0 0 Q 1.5 ${3.5 * flip} 3 0`}
              fill="none" stroke={ink} strokeWidth={sw} />
      );
    case 'jgroove':
      // J shape — vertical leg + bottom curve
      return (
        <path d={`M 0 0 L 0 ${2 * flip} Q 0 ${3.5 * flip} 1.5 ${3.5 * flip} L 3 ${3.5 * flip}`}
              fill="none" stroke={ink} strokeWidth={sw} />
      );
    default:
      return null;
  }
}

// ── Render ───────────────────────────────────────────────────────────
//
// Layout (paper coords, in mm; origin = leftmost point of ref line):
//
//                                           ┌────┐
//   tail──┐                                  GMAW
//   ──────┴────────────────────────────────/
//     (ref line, horizontal)
//   size [V]                                  ← arrow-side symbol below
//
// Reference line length: 22 mm. Arrow leg drawn from (0,0) downward at
// 25° angle, length 8 mm.

const REF_LEN  = 22;
const ARM_LEN  = 8;
const FONT     = 'var(--forge-mono)';
const FONT_SZ  = 2.6;

export function WeldGlyph({
  x = 0, y = 0, weld, ink = '#14161b', stroke = 0.4, dataKey, ariaLabel,
}) {
  if (!weld || !validateWeld(weld)) return null;
  const sym = WELD_TYPES[weld.type];
  // Reference line from (0,0) to (REF_LEN, 0)
  // Arrow leg goes down-right from (0,0)
  const armDx = ARM_LEN * Math.cos(Math.PI / 6);
  const armDy = ARM_LEN * Math.sin(Math.PI / 6);
  // Tail (at right end) — two short diagonals forming a "less-than" mark
  const tailDx = 2.4;
  const tailDy = 1.6;
  // Symbol position
  const symX = REF_LEN * 0.5;
  const arrowSide = (weld.side === 'arrow' || weld.side === 'both');
  const otherSide = (weld.side === 'other' || weld.side === 'both');
  const sizeText = String(weld.size);
  return (
    <g data-weld="true"
       data-weld-type={weld.type}
       data-weld-side={weld.side}
       data-weld-size={weld.size}
       data-weld-process={weld.process || ''}
       data-weld-all-around={String(!!weld.allAround)}
       data-weld-field={String(!!weld.fieldWeld)}
       data-weld-key={dataKey || ''}
       aria-label={ariaLabel ||
         `${sym.label} weld size ${weld.size}` +
         (weld.process ? ` process ${weld.process}` : '')}
       transform={`translate(${x} ${y})`}>
      {/* arrow leg — from elbow (0,0) downward-right; arrowhead at tip */}
      <line x1={0} y1={0} x2={armDx} y2={armDy}
            stroke={ink} strokeWidth={stroke} />
      <polygon points={`${armDx},${armDy} ${armDx - 1.6 * Math.cos(Math.PI/6 - 0.3)},${armDy - 1.6 * Math.sin(Math.PI/6 - 0.3)} ${armDx - 1.6 * Math.cos(Math.PI/6 + 0.3)},${armDy - 1.6 * Math.sin(Math.PI/6 + 0.3)}`}
               fill={ink} stroke={ink} strokeWidth={0.2} />
      {/* reference line */}
      <line x1={0} y1={0} x2={REF_LEN} y2={0}
            stroke={ink} strokeWidth={stroke} />
      {/* tail at far end (only if a process is set) */}
      {weld.process && (
        <g data-weld-tail>
          <line x1={REF_LEN} y1={0}
                x2={REF_LEN + tailDx} y2={-tailDy}
                stroke={ink} strokeWidth={stroke} />
          <line x1={REF_LEN} y1={0}
                x2={REF_LEN + tailDx} y2={ tailDy}
                stroke={ink} strokeWidth={stroke} />
          <text x={REF_LEN + tailDx + 0.4} y={0}
                fontFamily={FONT} fontSize={FONT_SZ}
                dominantBaseline="middle"
                fill={ink}
                data-weld-process-text>
            {weld.process}
          </text>
        </g>
      )}
      {/* all-around flag — small circle at the elbow */}
      {weld.allAround && (
        <circle cx={0} cy={0} r={1.2}
                fill="none" stroke={ink} strokeWidth={stroke * 0.8}
                data-weld-all-around-flag />
      )}
      {/* field weld — small filled flag at the elbow, pointing right */}
      {weld.fieldWeld && (
        <polygon
          points={`0,${-2.4} 2.4,${-2.4} 0,${0}`}
          fill={ink} stroke={ink} strokeWidth={0.2}
          data-weld-field-flag />
      )}
      {/* arrow-side symbol (below reference line) */}
      {arrowSide && (
        <g transform={`translate(${symX - 1.5} 0.5)`}
           data-weld-symbol-side="arrow">
          <WeldTypePath type={weld.type} ink={ink} stroke={stroke} flipped={false} />
        </g>
      )}
      {arrowSide && (
        <text x={symX - 2.8} y={2.8}
              fontFamily={FONT} fontSize={FONT_SZ}
              fill={ink} textAnchor="end"
              data-weld-size-text="arrow">
          {sizeText}
        </text>
      )}
      {/* other-side symbol (above reference line, flipped) */}
      {otherSide && (
        <g transform={`translate(${symX - 1.5} -0.5)`}
           data-weld-symbol-side="other">
          <WeldTypePath type={weld.type} ink={ink} stroke={stroke} flipped={true} />
        </g>
      )}
      {otherSide && (
        <text x={symX - 2.8} y={-2.0}
              fontFamily={FONT} fontSize={FONT_SZ}
              fill={ink} textAnchor="end"
              data-weld-size-text="other">
          {sizeText}
        </text>
      )}
      {/* length / pitch (e.g. "20-50") to the right of size */}
      {(weld.length || weld.pitch) && (
        <text x={symX + 3.5} y={arrowSide ? 2.8 : -2.0}
              fontFamily={FONT} fontSize={FONT_SZ}
              fill={ink}
              data-weld-length-text>
          {weld.length || ''}{weld.pitch ? `-${weld.pitch}` : ''}
        </text>
      )}
    </g>
  );
}

/**
 * Weld symbol whose elbow connects to the joint via an existing leader
 * already drawn by the workbench.  Here we render the symbol at a frame
 * position, and the arrow tip naturally points down-right at the joint.
 */
export function WeldWithLeader({ weld, anchor, frame, ink = '#14161b', dataKey }) {
  if (!anchor || !frame) return null;
  // Compute orientation so the arrow leg goes toward the anchor.
  const fx = frame[0], fy = frame[1];
  const ax = anchor[0], ay = anchor[1];
  const dx = ax - fx, dy = ay - fy;
  const angle = Math.atan2(dy, dx) * 180 / Math.PI;
  return (
    <g data-weld-group="true" data-weld-key={dataKey || ''}
       transform={`translate(${fx} ${fy}) rotate(${angle})`}>
      <WeldGlyph weld={weld} ink={ink} dataKey={dataKey} />
    </g>
  );
}

// ── Drop-down menu picker ────────────────────────────────────────────

export function WeldPicker({ initial, onCommit, onCancel }) {
  const [type, setType]       = React.useState(initial?.type     || 'fillet');
  const [side, setSide]       = React.useState(initial?.side     || 'arrow');
  const [size, setSize]       = React.useState(initial?.size     ?? 5);
  const [process, setProcess] = React.useState(initial?.process  || '');
  const [allAround, setAA]    = React.useState(!!initial?.allAround);
  const [fieldWeld, setFW]    = React.useState(!!initial?.fieldWeld);

  const commit = () => {
    onCommit?.(makeWeld({
      type, side, size: parseFloat(size) || 0,
      process, allAround, fieldWeld,
    }));
  };
  return (
    <div data-testid="forge-weld-picker"
         style={{
           background: 'var(--forge-canvas-3)',
           border: '1px solid var(--forge-rail-edge)',
           borderRadius: 'var(--forge-radius)',
           padding: 10, minWidth: 280,
           fontFamily: 'var(--forge-mono)', fontSize: 11,
           color: 'var(--forge-ink)',
           boxShadow: '0 8px 24px rgba(0,0,0,0.45)',
           display: 'flex', flexDirection: 'column', gap: 8,
         }}>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Weld type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}
                  data-weld-field="type"
                  style={inputStyle}>
            {Object.entries(WELD_TYPES).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Side</label>
          <select value={side} onChange={(e) => setSide(e.target.value)}
                  data-weld-field="side"
                  style={inputStyle}>
            <option value="arrow">Arrow</option>
            <option value="other">Other</option>
            <option value="both">Both</option>
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Size (mm)</label>
          <input type="number" step="0.1" min="0"
                 value={size} onChange={(e) => setSize(e.target.value)}
                 data-weld-field="size"
                 style={inputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={labelStyle}>Process</label>
          <select value={process} onChange={(e) => setProcess(e.target.value)}
                  data-weld-field="process"
                  style={inputStyle}>
            {Object.keys(WELD_PROCESSES).map((k) => (
              <option key={k} value={k}>{k || '—'}</option>
            ))}
          </select>
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <label style={{ display: 'inline-flex', gap: 4, color: 'var(--forge-ink-2)' }}>
          <input type="checkbox" checked={allAround} data-weld-field="allAround"
                 onChange={(e) => setAA(e.target.checked)} />
          all-around
        </label>
        <label style={{ display: 'inline-flex', gap: 4, color: 'var(--forge-ink-2)' }}>
          <input type="checkbox" checked={fieldWeld} data-weld-field="fieldWeld"
                 onChange={(e) => setFW(e.target.checked)} />
          field weld
        </label>
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        {onCancel && (
          <button type="button" onClick={onCancel}
                  data-testid="forge-weld-cancel"
                  style={buttonStyle}>Cancel</button>
        )}
        <button type="button" onClick={commit}
                data-testid="forge-weld-commit"
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

export default WeldGlyph;
