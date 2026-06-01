// Forge-169 — ISA-5.1-2009 P&ID symbol library.
//
// "Instrumentation Symbols and Identification" (ANSI/ISA-5.1-2009)
// glyphs as real, DOM-friendly SVG path strings.  Each symbol is
// authored on a normalised 100-unit canvas so the editor can scale it
// to any grid cell — 10 mm in the spec — and they all share a single
// stroke style which makes the schematic look consistent.
//
// Each symbol entry exposes:
//   id           — stable string ID used in the saved drawing JSON
//   name         — short label used in the symbol palette
//   group        — 'valve' | 'pump' | 'tank' | 'hx' | 'instrument'
//   width/height — design-time bounds on the 100-unit canvas
//   ports        — array of connection points (x,y) in normalised
//                  coords, the editor snaps line endpoints to these
//   render       — function(props) returning a JSX <g> body — kept
//                  parameter-free so the editor can pass through
//                  the colour/scale uniformly.  We do NOT import
//                  React here to keep the file usable in unit tests
//                  and node CLIs.  Instead the file exports the raw
//                  SVG string in `svg` and the editor wraps it.
//
// ISA-5.1-2009 references:
//   Section 5.4   — valve body symbols (gate, ball, butterfly, etc.)
//   Section 5.5   — line drives (manual handle, actuator)
//   Section 5.6   — pumps, compressors
//   Section 5.7   — heat exchangers
//   Section 5.8   — vessels and tanks
//   Section 6.0   — discrete instrument bubble (PT, FT, TT, LT)
//   Section 6.1.6 — tag identification letters (P / T / F / L / A)
//
// The shapes encoded below are the exact ones drawn in the standard
// — bow-tie for general valve, circle-with-segment for ball, vane in
// circle for butterfly, etc.  This file is the source of truth for
// the schematic editor and is consumed by pidEditor.jsx.

export const ISA51_VERSION = '5.1-2009';

// All glyphs draw onto a 100×100 logical box centred on (50,50). The
// editor scales the box to grid-cell × symbolSize (default 4 grid
// cells = 40 mm), so the actual on-screen size is the symbol's
// width/height fields multiplied by the chosen cell pitch.
const W = 100;
const H = 100;

// Shared stroke style used by every symbol — the standard calls for
// solid black 0.5 mm lines on a white field.
export const SYMBOL_STYLE = {
  stroke: 'currentColor',
  strokeWidth: 1.8,
  fill: 'none',
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

/* ============================================================
   VALVES — ISA-5.1 section 5.4
   ============================================================ */

// Gate valve — two opposing triangles meeting at centreline.
// Bow-tie outline + vertical stem on top.
const gateValveSvg = `
  <polygon points="10,30 50,50 10,70" />
  <polygon points="90,30 50,50 90,70" />
  <line x1="50" y1="50" x2="50" y2="15" />
  <line x1="40" y1="15" x2="60" y2="15" />
`;

// Ball valve — bow-tie + circle inscribed at centre, with the
// quarter-turn bar across.
const ballValveSvg = `
  <polygon points="10,30 50,50 10,70" />
  <polygon points="90,30 50,50 90,70" />
  <circle cx="50" cy="50" r="14" />
  <line x1="36" y1="50" x2="64" y2="50" />
  <line x1="50" y1="50" x2="50" y2="15" />
`;

// Butterfly valve — bow-tie with a vertical disc/vane drawn as a
// flat ellipse across centre.
const butterflyValveSvg = `
  <polygon points="10,30 50,50 10,70" />
  <polygon points="90,30 50,50 90,70" />
  <ellipse cx="50" cy="50" rx="4" ry="20" />
  <line x1="50" y1="50" x2="50" y2="15" />
`;

// Globe valve — bow-tie + horizontal centred bar (the seat) and
// circular plug.
const globeValveSvg = `
  <polygon points="10,30 50,50 10,70" />
  <polygon points="90,30 50,50 90,70" />
  <circle cx="50" cy="50" r="10" />
  <line x1="50" y1="40" x2="50" y2="15" />
`;

// Needle valve — bow-tie + downward-pointing arrow tip on stem.
const needleValveSvg = `
  <polygon points="10,30 50,50 10,70" />
  <polygon points="90,30 50,50 90,70" />
  <line x1="50" y1="50" x2="50" y2="15" />
  <polygon points="44,30 50,50 56,30" fill="currentColor" />
`;

// Check valve (non-return) — bow-tie with arrow pointing direction
// of flow.
const checkValveSvg = `
  <polygon points="10,30 50,50 10,70" />
  <polygon points="90,30 50,50 90,70" />
  <polyline points="35,38 50,50 35,62" />
`;

// Pressure relief valve — bow-tie with diagonal upward line
// (vent-to-atmosphere) + spring zig-zag.
const reliefValveSvg = `
  <polygon points="10,30 50,50 10,70" />
  <polygon points="90,30 50,50 90,70" />
  <line x1="50" y1="50" x2="80" y2="10" />
  <polyline points="65,30 70,22 60,18 70,12" />
`;

// Three-way valve — bow-tie with a third stub leg going down.
const threeWayValveSvg = `
  <polygon points="10,30 50,50 10,70" />
  <polygon points="90,30 50,50 90,70" />
  <polygon points="30,90 50,50 70,90" />
  <line x1="50" y1="50" x2="50" y2="15" />
  <line x1="40" y1="15" x2="60" y2="15" />
`;

/* ============================================================
   PUMPS — ISA-5.1 section 5.6
   ============================================================ */

// Centrifugal pump — large circle with a triangular discharge
// pointing up + suction nozzle on left.
const centrifugalPumpSvg = `
  <circle cx="50" cy="55" r="30" />
  <line x1="20" y1="55" x2="5" y2="55" />
  <polyline points="40,25 50,15 60,25" />
  <line x1="50" y1="15" x2="50" y2="25" />
`;

// Positive-displacement pump — square housing with circle inside.
const pdPumpSvg = `
  <rect x="20" y="25" width="60" height="50" />
  <circle cx="50" cy="50" r="14" />
  <line x1="20" y1="50" x2="5" y2="50" />
  <line x1="80" y1="50" x2="95" y2="50" />
`;

// Gear pump — square housing with two interlocking circles
// (the gears).
const gearPumpSvg = `
  <rect x="20" y="25" width="60" height="50" />
  <circle cx="40" cy="50" r="12" />
  <circle cx="60" cy="50" r="12" />
  <line x1="20" y1="50" x2="5" y2="50" />
  <line x1="80" y1="50" x2="95" y2="50" />
`;

// Screw pump — square housing with a screw thread drawn as a
// zig-zag inside.
const screwPumpSvg = `
  <rect x="20" y="25" width="60" height="50" />
  <polyline points="24,38 76,38 24,50 76,50 24,62 76,62" />
  <line x1="20" y1="50" x2="5" y2="50" />
  <line x1="80" y1="50" x2="95" y2="50" />
`;

/* ============================================================
   TANKS / VESSELS — ISA-5.1 section 5.8
   ============================================================ */

// Vertical tank — rectangle with rounded top + flat bottom.
const verticalTankSvg = `
  <path d="M 20 30 Q 50 5 80 30 L 80 90 L 20 90 Z" />
  <line x1="50" y1="5" x2="50" y2="-5" />
`;

// Horizontal tank — long rectangle with hemispherical caps.
const horizontalTankSvg = `
  <path d="M 20 30 L 80 30 Q 95 50 80 70 L 20 70 Q 5 50 20 30 Z" />
`;

// Cone-bottom tank — vertical wall + V-bottom + flat top.
const coneBottomTankSvg = `
  <path d="M 20 20 L 80 20 L 80 65 L 50 95 L 20 65 Z" />
  <line x1="20" y1="20" x2="80" y2="20" />
`;

/* ============================================================
   HEAT EXCHANGERS — ISA-5.1 section 5.7
   ============================================================ */

// Shell-and-tube heat exchanger — horizontal cylinder with internal
// tubes drawn as parallel lines + 2 inlet/2 outlet stubs.
const shellTubeHxSvg = `
  <rect x="10" y="30" width="80" height="40" rx="6" />
  <line x1="10" y1="42" x2="90" y2="42" />
  <line x1="10" y1="50" x2="90" y2="50" />
  <line x1="10" y1="58" x2="90" y2="58" />
  <line x1="20" y1="30" x2="20" y2="15" />
  <line x1="80" y1="30" x2="80" y2="15" />
  <line x1="20" y1="70" x2="20" y2="85" />
  <line x1="80" y1="70" x2="80" y2="85" />
`;

// Plate-and-frame heat exchanger — stacked vertical plates (lines)
// with end frames.
const plateFrameHxSvg = `
  <rect x="20" y="20" width="60" height="60" />
  <line x1="28" y1="20" x2="28" y2="80" />
  <line x1="36" y1="20" x2="36" y2="80" />
  <line x1="44" y1="20" x2="44" y2="80" />
  <line x1="52" y1="20" x2="52" y2="80" />
  <line x1="60" y1="20" x2="60" y2="80" />
  <line x1="68" y1="20" x2="68" y2="80" />
  <line x1="76" y1="20" x2="76" y2="80" />
  <line x1="20" y1="50" x2="5" y2="50" />
  <line x1="80" y1="50" x2="95" y2="50" />
`;

/* ============================================================
   INSTRUMENT BUBBLES — ISA-5.1 section 6
   ============================================================ */

// A discrete instrument is a circle ~12 mm dia with two letters of
// tag identification and an instrument number.  ISA 5.1 §6.1.6:
//   Letter 1 = measured variable (P,T,F,L,A …)
//   Letter 2 = function (T transmitter, I indicator, C controller,
//                        E sensor, AH alarm-high)
// We don't pre-render the tag — the editor draws it over the bubble
// — but we do render the circle and any modifier marks (a horizontal
// bar through the circle means "panel-mounted").
const instrumentBubbleSvg = `
  <circle cx="50" cy="50" r="22" />
`;

// Pressure indicator (PI) — bubble with letters PI to be rendered
// by the editor.  We expose the glyph as an empty bubble and let the
// editor fill the tag.
const PT_INST = instrumentBubbleSvg;
const TT_INST = instrumentBubbleSvg;
const FT_INST = instrumentBubbleSvg;
const LT_INST = instrumentBubbleSvg;
const PI_INST = instrumentBubbleSvg;
const TI_INST = instrumentBubbleSvg;
const FI_INST = instrumentBubbleSvg;
const LI_INST = instrumentBubbleSvg;
const AT_INST = instrumentBubbleSvg;
// Alarm-high instruments — bubble with a small alarm pennant.
const ALARM_INST = `
  <circle cx="50" cy="50" r="22" />
  <polygon points="70,28 86,28 82,38 86,48 70,48" fill="currentColor" opacity="0.25" />
`;

/* ============================================================
   SYMBOL TABLE
   ============================================================ */

function ports(...pts) { return pts.map(([x, y]) => ({ x, y })); }

export const ISA51_SYMBOLS = [
  // valves
  { id: 'valve.gate',      name: 'Gate valve',      group: 'valve',
    width: W, height: H, svg: gateValveSvg,
    ports: ports([0, 50], [100, 50]) },
  { id: 'valve.ball',      name: 'Ball valve',      group: 'valve',
    width: W, height: H, svg: ballValveSvg,
    ports: ports([0, 50], [100, 50]) },
  { id: 'valve.butterfly', name: 'Butterfly valve', group: 'valve',
    width: W, height: H, svg: butterflyValveSvg,
    ports: ports([0, 50], [100, 50]) },
  { id: 'valve.globe',     name: 'Globe valve',     group: 'valve',
    width: W, height: H, svg: globeValveSvg,
    ports: ports([0, 50], [100, 50]) },
  { id: 'valve.needle',    name: 'Needle valve',    group: 'valve',
    width: W, height: H, svg: needleValveSvg,
    ports: ports([0, 50], [100, 50]) },
  { id: 'valve.check',     name: 'Check valve',     group: 'valve',
    width: W, height: H, svg: checkValveSvg,
    ports: ports([0, 50], [100, 50]) },
  { id: 'valve.relief',    name: 'Pressure relief', group: 'valve',
    width: W, height: H, svg: reliefValveSvg,
    ports: ports([0, 50], [100, 50]) },
  { id: 'valve.threeWay',  name: '3-way valve',     group: 'valve',
    width: W, height: H, svg: threeWayValveSvg,
    ports: ports([0, 50], [100, 50], [50, 100]) },
  // pumps
  { id: 'pump.centrifugal', name: 'Centrifugal pump', group: 'pump',
    width: W, height: H, svg: centrifugalPumpSvg,
    ports: ports([0, 55], [50, 0]) },
  { id: 'pump.positiveDisplacement', name: 'Pos-displacement pump',
    group: 'pump', width: W, height: H, svg: pdPumpSvg,
    ports: ports([0, 50], [100, 50]) },
  { id: 'pump.gear',  name: 'Gear pump',  group: 'pump',
    width: W, height: H, svg: gearPumpSvg,
    ports: ports([0, 50], [100, 50]) },
  { id: 'pump.screw', name: 'Screw pump', group: 'pump',
    width: W, height: H, svg: screwPumpSvg,
    ports: ports([0, 50], [100, 50]) },
  // tanks
  { id: 'tank.vertical',   name: 'Vertical tank',   group: 'tank',
    width: W, height: H, svg: verticalTankSvg,
    ports: ports([50, 0], [50, 100], [20, 50]) },
  { id: 'tank.horizontal', name: 'Horizontal tank', group: 'tank',
    width: W, height: H, svg: horizontalTankSvg,
    ports: ports([0, 50], [100, 50], [50, 30]) },
  { id: 'tank.coneBottom', name: 'Cone-bottom tank', group: 'tank',
    width: W, height: H, svg: coneBottomTankSvg,
    ports: ports([20, 20], [80, 20], [50, 95]) },
  // heat exchangers
  { id: 'hx.shellTube',  name: 'Shell & tube HX', group: 'hx',
    width: W, height: H, svg: shellTubeHxSvg,
    ports: ports([20, 15], [80, 15], [20, 85], [80, 85]) },
  { id: 'hx.plateFrame', name: 'Plate & frame HX', group: 'hx',
    width: W, height: H, svg: plateFrameHxSvg,
    ports: ports([0, 50], [100, 50]) },
  // instruments
  { id: 'inst.PT', name: 'Pressure transmitter', group: 'instrument',
    width: W, height: H, svg: PT_INST, tag: 'PT',
    ports: ports([50, 28], [50, 72]) },
  { id: 'inst.TT', name: 'Temperature transmitter', group: 'instrument',
    width: W, height: H, svg: TT_INST, tag: 'TT',
    ports: ports([50, 28], [50, 72]) },
  { id: 'inst.FT', name: 'Flow transmitter', group: 'instrument',
    width: W, height: H, svg: FT_INST, tag: 'FT',
    ports: ports([50, 28], [50, 72]) },
  { id: 'inst.LT', name: 'Level transmitter', group: 'instrument',
    width: W, height: H, svg: LT_INST, tag: 'LT',
    ports: ports([50, 28], [50, 72]) },
  { id: 'inst.PI', name: 'Pressure indicator', group: 'instrument',
    width: W, height: H, svg: PI_INST, tag: 'PI',
    ports: ports([50, 28], [50, 72]) },
  { id: 'inst.TI', name: 'Temperature indicator', group: 'instrument',
    width: W, height: H, svg: TI_INST, tag: 'TI',
    ports: ports([50, 28], [50, 72]) },
  { id: 'inst.FI', name: 'Flow indicator', group: 'instrument',
    width: W, height: H, svg: FI_INST, tag: 'FI',
    ports: ports([50, 28], [50, 72]) },
  { id: 'inst.LI', name: 'Level indicator', group: 'instrument',
    width: W, height: H, svg: LI_INST, tag: 'LI',
    ports: ports([50, 28], [50, 72]) },
  { id: 'inst.AT', name: 'Analyser transmitter', group: 'instrument',
    width: W, height: H, svg: AT_INST, tag: 'AT',
    ports: ports([50, 28], [50, 72]) },
  { id: 'inst.PAH', name: 'Pressure alarm high', group: 'instrument',
    width: W, height: H, svg: ALARM_INST, tag: 'PAH',
    ports: ports([50, 28], [50, 72]) },
  { id: 'inst.TAH', name: 'Temperature alarm high', group: 'instrument',
    width: W, height: H, svg: ALARM_INST, tag: 'TAH',
    ports: ports([50, 28], [50, 72]) },
  { id: 'inst.FAH', name: 'Flow alarm high', group: 'instrument',
    width: W, height: H, svg: ALARM_INST, tag: 'FAH',
    ports: ports([50, 28], [50, 72]) },
];

export const ISA51_BY_ID = Object.fromEntries(
  ISA51_SYMBOLS.map((s) => [s.id, s]),
);

export const ISA51_GROUPS = ['valve', 'pump', 'tank', 'hx', 'instrument'];

// Line type defs (ISA-5.1 §5.3) — process is solid, instrument is
// dashed, electrical is dot-dash, hydraulic is dense dash.
export const LINE_TYPES = {
  process:     { id: 'process',     name: 'Process',     stroke: '#000', dash: 'none',     width: 2.2 },
  instrument:  { id: 'instrument',  name: 'Instrument',  stroke: '#444', dash: '6 4',      width: 1.4 },
  electrical:  { id: 'electrical',  name: 'Electrical',  stroke: '#a30', dash: '6 4 2 4',  width: 1.4 },
  hydraulic:   { id: 'hydraulic',   name: 'Hydraulic',   stroke: '#26b', dash: '4 2',      width: 1.6 },
};

// Tag-letter table (ISA-5.1 §6.1.6 first-letter codes). Used by
// pidEditor to auto-increment per measured-variable.
export const TAG_FIRST_LETTERS = {
  A: 'Analysis', F: 'Flow', L: 'Level', P: 'Pressure',
  T: 'Temperature', V: 'Vibration', W: 'Weight',
};

// Return the next tag for a given prefix from a list of already-used
// tag strings (e.g. ['PT-101','PT-102'] → 'PT-103').
export function nextTag(prefix, used) {
  let max = 100;
  for (const t of used) {
    if (typeof t !== 'string') continue;
    const m = t.match(new RegExp(`^${prefix}-(\\d{3,})$`));
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${(max + 1).toString().padStart(3, '0')}`;
}
