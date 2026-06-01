// Forge-109 — GD&T Feature Control Frame component.
//
// Renders an ASME Y14.5 compliant Feature Control Frame (FCF) as an SVG
// group containing nested bordered compartments:
//
//   [ ⏥ │ ⌀0.05 Ⓜ │ A Ⓜ │ B │ C ]
//
// Cell 1: characteristic symbol (flatness, parallelism, …)
// Cell 2: tolerance zone (optional ⌀ prefix) + value + optional material
//         modifier (Ⓜ MMC, Ⓛ LMC; no glyph → RFS)
// Cells 3-5: up to 3 datum references, each with optional MMC/LMC modifier
//
// The component is pure-presentational. State management for FCFs lives
// in pmiAnnotations.js; the workbench wires placement/picking/dragging.
//
// All glyphs are real Unicode characters where ISO standards specify
// them; the few that have no Unicode equivalent (total runout) are
// composed from existing glyphs (↗↗) to preserve scanability.

import React from 'react';

// ── Characteristic symbol catalog (ASME Y14.5 / ISO 1101) ────────────
// 14 symbols total — every one the standard recognizes plus the four
// orientation specials.

export const GDT_SYMBOLS = Object.freeze({
  flatness:        { glyph: '⏥', label: 'Flatness',        unicode: 'U+23E5',  family: 'form'        },
  straightness:    { glyph: '—', label: 'Straightness',    unicode: 'U+2014',  family: 'form'        },
  circularity:     { glyph: '○', label: 'Circularity',     unicode: 'U+25CB',  family: 'form'        },
  cylindricity:    { glyph: '⌭', label: 'Cylindricity',    unicode: 'U+232D',  family: 'form'        },
  profileLine:     { glyph: '⌒', label: 'Profile of line', unicode: 'U+2312',  family: 'profile'     },
  profileSurface:  { glyph: '⌓', label: 'Profile of surf', unicode: 'U+2313',  family: 'profile'     },
  parallelism:     { glyph: '∥', label: 'Parallelism',     unicode: 'U+2225',  family: 'orientation' },
  perpendicularity:{ glyph: '⟂', label: 'Perpendicularity',unicode: 'U+27C2',  family: 'orientation' },
  angularity:      { glyph: '∠', label: 'Angularity',      unicode: 'U+2220',  family: 'orientation' },
  position:        { glyph: '⊕', label: 'Position',        unicode: 'U+2295',  family: 'location'    },
  concentricity:   { glyph: '◎', label: 'Concentricity',   unicode: 'U+25CE',  family: 'location'    },
  symmetry:        { glyph: '=', label: 'Symmetry',        unicode: 'U+003D',  family: 'location'    },
  circularRunout:  { glyph: '⌖', label: 'Circular runout', unicode: 'U+2316',  family: 'runout'      },
  totalRunout:     { glyph: '↗↗', label: 'Total runout', unicode: 'U+2197×2', family: 'runout' },
  runout:          { glyph: '↗', label: 'Runout',          unicode: 'U+2197',  family: 'runout'      },
});

// ── Material conditions ──────────────────────────────────────────────
// MMC: Maximum Material Condition (Ⓜ)
// LMC: Least Material Condition (Ⓛ)
// RFS: Regardless of Feature Size — no glyph (default)

export const MATERIAL_MODIFIERS = Object.freeze({
  RFS: { glyph: '',           label: 'Regardless of Feature Size' },
  MMC: { glyph: 'Ⓜ',     label: 'Maximum Material Condition' },
  LMC: { glyph: 'Ⓛ',     label: 'Least Material Condition'   },
});

export const ZONE_SHAPES = Object.freeze({
  none:     '',
  diameter: '⌀',   // Ø
  spherical:'S⌀',  // SØ
  square:   '□',
});

// ── Default factory + validation ─────────────────────────────────────

export function makeFcf({
  characteristic = 'flatness',
  tolerance     = 0.05,
  zoneShape     = 'none',
  materialMod   = 'RFS',
  datums        = [],     // [{ ref:'A', mod:'RFS'|'MMC'|'LMC' }, …]
} = {}) {
  return {
    characteristic,
    tolerance,
    zoneShape,
    materialMod,
    datums: datums.slice(0, 3),
  };
}

export function validateFcf(fcf) {
  if (!fcf || !GDT_SYMBOLS[fcf.characteristic]) return false;
  if (!Number.isFinite(fcf.tolerance)) return false;
  if (!MATERIAL_MODIFIERS[fcf.materialMod || 'RFS']) return false;
  if (!Array.isArray(fcf.datums)) return false;
  if (fcf.datums.length > 3) return false;
  for (const d of fcf.datums) {
    if (!d?.ref) return false;
    if (!MATERIAL_MODIFIERS[d.mod || 'RFS']) return false;
  }
  return true;
}

// ── Pure render: SVG <g> at (x,y) ───────────────────────────────────
// Returns a feature control frame group of nested bordered boxes. The
// height is fixed; width auto-fits the content.

const CELL_H = 6.0;             // mm, paper coords
const CHAR_W = 3.0;             // glyph default cell width
const PAD_X  = 1.2;
const FONT   = 'var(--forge-mono)';
const FONT_SZ = 3.4;

function cellWidth(text) {
  const n = String(text || '').length;
  return Math.max(CHAR_W, n * 2.0 + PAD_X * 2);
}

export function FcfGlyph({
  x = 0, y = 0, fcf, ink = '#14161b', stroke = 0.4,
  ariaLabel, dataKey,
}) {
  if (!fcf || !validateFcf(fcf)) return null;
  const sym = GDT_SYMBOLS[fcf.characteristic];
  const matMod = MATERIAL_MODIFIERS[fcf.materialMod || 'RFS'];
  const zone   = ZONE_SHAPES[fcf.zoneShape || 'none'];
  const tolText = `${zone}${fcf.tolerance}${matMod.glyph ? ' ' + matMod.glyph : ''}`;

  // Build cell array
  const cells = [];
  cells.push({ text: sym.glyph, key: 'char', w: cellWidth(sym.glyph) });
  cells.push({ text: tolText,   key: 'tol',  w: cellWidth(tolText) });
  for (let i = 0; i < fcf.datums.length; i++) {
    const d = fcf.datums[i];
    const dMod = MATERIAL_MODIFIERS[d.mod || 'RFS'];
    const text = `${d.ref}${dMod.glyph ? ' ' + dMod.glyph : ''}`;
    cells.push({ text, key: `datum-${i}`, w: cellWidth(text) });
  }

  // x-offsets for each cell
  let cx = 0;
  const positions = cells.map((c) => {
    const out = { ...c, x: cx };
    cx += c.w;
    return out;
  });
  const totalW = cx;

  return (
    <g data-fcf="true"
       data-fcf-char={fcf.characteristic}
       data-fcf-tolerance={fcf.tolerance}
       data-fcf-zone={fcf.zoneShape}
       data-fcf-mat-mod={fcf.materialMod}
       data-fcf-datums={fcf.datums.map((d) => d.ref).join('')}
       data-fcf-key={dataKey || ''}
       aria-label={ariaLabel || `${sym.label} ${tolText}`}
       transform={`translate(${x} ${y})`}>
      {/* outer frame */}
      <rect x={0} y={0} width={totalW} height={CELL_H}
            fill="white" stroke={ink} strokeWidth={stroke} />
      {/* dividers + glyph text per cell */}
      {positions.map((c, i) => (
        <g key={c.key}>
          {i > 0 && (
            <line x1={c.x} y1={0} x2={c.x} y2={CELL_H}
                  stroke={ink} strokeWidth={stroke} />
          )}
          <text x={c.x + c.w / 2} y={CELL_H / 2 + FONT_SZ / 3}
                fontFamily={FONT} fontSize={FONT_SZ}
                textAnchor="middle"
                fill={ink}
                data-fcf-cell={c.key}>
            {c.text}
          </text>
        </g>
      ))}
    </g>
  );
}

// ── Leader line component ────────────────────────────────────────────
// FCF anchors to a feature via a leader line + filled arrow head at the
// feature endpoint.

export function FcfWithLeader({ fcf, anchor, frame, ink = '#14161b', dataKey }) {
  if (!anchor || !frame) return null;
  const ax = anchor[0], ay = anchor[1];
  const fx = frame[0],  fy  = frame[1];
  const dx = ax - fx, dy = ay - fy;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len, uy = dy / len;
  const arrow = 1.4;
  // Triangle arrowhead at anchor
  const aL = [ax - ux * arrow + (-uy) * (arrow * 0.45),
              ay - uy * arrow + ( ux) * (arrow * 0.45)];
  const aR = [ax - ux * arrow - (-uy) * (arrow * 0.45),
              ay - uy * arrow - ( ux) * (arrow * 0.45)];
  return (
    <g data-fcf-group="true" data-fcf-key={dataKey || ''}>
      <line x1={fx} y1={fy} x2={ax} y2={ay}
            stroke={ink} strokeWidth={0.35} />
      <polygon points={`${ax},${ay} ${aL[0]},${aL[1]} ${aR[0]},${aR[1]}`}
               fill={ink} stroke={ink} strokeWidth={0.2} />
      <FcfGlyph fcf={fcf} x={fx} y={fy} ink={ink} dataKey={dataKey} />
    </g>
  );
}

// ── Drop-down menu picker (used by the workbench toolbar) ────────────
// Renders a list of all 14 symbols + inputs for tolerance / zone / mat
// modifier / datum references. onCommit fires with a fully-built FCF.

export function FcfPicker({ initial, onCommit, onCancel }) {
  const [char, setChar]       = React.useState(initial?.characteristic || 'flatness');
  const [tol, setTol]         = React.useState(initial?.tolerance ?? 0.05);
  const [zone, setZone]       = React.useState(initial?.zoneShape || 'none');
  const [mat, setMat]         = React.useState(initial?.materialMod || 'RFS');
  const [datums, setDatums]   = React.useState(initial?.datums || []);

  const addDatum = () => {
    if (datums.length >= 3) return;
    const nextRef = String.fromCharCode(65 + datums.length); // A, B, C
    setDatums([...datums, { ref: nextRef, mod: 'RFS' }]);
  };
  const updateDatum = (i, patch) => {
    setDatums(datums.map((d, idx) => idx === i ? { ...d, ...patch } : d));
  };
  const removeDatum = (i) => setDatums(datums.filter((_, idx) => idx !== i));

  const commit = () => {
    onCommit?.(makeFcf({
      characteristic: char,
      tolerance: parseFloat(tol) || 0,
      zoneShape: zone,
      materialMod: mat,
      datums,
    }));
  };

  return (
    <div data-testid="forge-fcf-picker"
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
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <label style={{ color: 'var(--forge-ink-mute)', fontSize: 10,
                        textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Characteristic
        </label>
        <select value={char} onChange={(e) => setChar(e.target.value)}
                data-fcf-field="char"
                style={pickerInputStyle}>
          {Object.entries(GDT_SYMBOLS).map(([k, v]) => (
            <option key={k} value={k}>{v.glyph}  {v.label}</option>
          ))}
        </select>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <div style={{ flex: 1 }}>
          <label style={pickerLabelStyle}>Zone</label>
          <select value={zone} onChange={(e) => setZone(e.target.value)}
                  data-fcf-field="zone"
                  style={pickerInputStyle}>
            {Object.entries(ZONE_SHAPES).map(([k, v]) => (
              <option key={k} value={k}>{v || '—'} {k}</option>
            ))}
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <label style={pickerLabelStyle}>Tolerance (mm)</label>
          <input type="number" step="0.001" min="0"
                 value={tol} onChange={(e) => setTol(e.target.value)}
                 data-fcf-field="tolerance"
                 style={pickerInputStyle} />
        </div>
        <div style={{ flex: 1 }}>
          <label style={pickerLabelStyle}>Material</label>
          <select value={mat} onChange={(e) => setMat(e.target.value)}
                  data-fcf-field="material-mod"
                  style={pickerInputStyle}>
            {Object.keys(MATERIAL_MODIFIERS).map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>
      </div>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6,
                      marginBottom: 4 }}>
          <span style={pickerLabelStyle}>Datums (up to 3)</span>
          <button type="button" onClick={addDatum}
                  disabled={datums.length >= 3}
                  data-fcf-add-datum
                  style={pickerButtonStyle}>+</button>
        </div>
        {datums.map((d, i) => (
          <div key={i} style={{ display: 'flex', gap: 4, marginBottom: 3 }}>
            <input type="text" maxLength={1} value={d.ref}
                   onChange={(e) => updateDatum(i, { ref: e.target.value.toUpperCase() })}
                   data-fcf-datum-ref={i}
                   style={{ ...pickerInputStyle, width: 30, textAlign: 'center' }} />
            <select value={d.mod} onChange={(e) => updateDatum(i, { mod: e.target.value })}
                    data-fcf-datum-mod={i}
                    style={pickerInputStyle}>
              {Object.keys(MATERIAL_MODIFIERS).map((k) => (
                <option key={k} value={k}>{k}</option>
              ))}
            </select>
            <button type="button" onClick={() => removeDatum(i)}
                    style={pickerButtonStyle}>×</button>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
        {onCancel && (
          <button type="button" onClick={onCancel}
                  data-testid="forge-fcf-cancel"
                  style={pickerButtonStyle}>Cancel</button>
        )}
        <button type="button" onClick={commit}
                data-testid="forge-fcf-commit"
                style={{ ...pickerButtonStyle,
                         background: 'var(--forge-accent-mute)',
                         borderColor: 'var(--forge-accent-rim)' }}>
          Add
        </button>
      </div>
    </div>
  );
}

const pickerLabelStyle = {
  color: 'var(--forge-ink-mute)', fontSize: 10,
  textTransform: 'uppercase', letterSpacing: '0.06em',
  display: 'block', marginBottom: 2,
};
const pickerInputStyle = {
  background: 'var(--forge-canvas)',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink)',
  font: 'inherit', fontSize: 11,
  padding: '3px 5px', borderRadius: 3,
  width: '100%',
};
const pickerButtonStyle = {
  background: 'var(--forge-surface)',
  border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink-2)',
  padding: '3px 8px', fontSize: 11,
  borderRadius: 3, cursor: 'pointer',
};

export default FcfGlyph;
