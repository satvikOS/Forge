// Forge-168 — Connector library.
//
// Real connector mechanical data — overall outer dimensions, pin
// spacing, pin count, mating force, current rating per contact, IP
// rating where applicable.
//
// Sources (per family):
//   - DB-9 / DB-15 / DB-25 (D-subminiature): MIL-DTL-24308; standard
//     0.109"  (2.77 mm) pin pitch row spacing for DE-9 / DB-25,
//     0.084"  (2.13 mm) high-density DB-15.
//   - Molex Mini-Fit Jr: Molex spec 5557 / 5559 (4.20 mm pitch, 9 A).
//   - JST PH: 2.0 mm pitch, 2.0 A; JST XH: 2.5 mm pitch, 3.0 A;
//     JST SH: 1.0 mm pitch, 1.0 A.  (JST product pages.)
//   - M8 (IEC 61076-2-104): 3/4/5/6/8 pin, IP67/68, 2 A.
//   - M12 (IEC 61076-2-101): 3/4/5/8/12 pin, IP67, 4 A.

// ─────────────────────────────────────────────────────────────────────
// D-subminiature (MIL-DTL-24308)
// ─────────────────────────────────────────────────────────────────────

export const DSUB_CONNECTORS = Object.freeze([
  {
    id: 'db-9',
    kind: 'dsub',
    family: 'D-Sub DB-9',
    pinCount: 9,
    pinPitch_mm: 2.77,
    bodyWidth_mm: 30.81,
    bodyHeight_mm: 12.55,
    bodyDepth_mm: 12.27,
    matingForce_N: 6.7,        // 0.6N typical per contact × 9
    rating_A_per_pin: 5.0,
    rating_V: 250,
    IP: '—',
    label: 'D-Sub DB-9 (9 pin, 2.77 mm pitch)',
  },
  {
    id: 'db-15',
    kind: 'dsub',
    family: 'D-Sub DB-15 (high density)',
    pinCount: 15,
    pinPitch_mm: 2.29,
    bodyWidth_mm: 39.14,
    bodyHeight_mm: 12.55,
    bodyDepth_mm: 12.27,
    matingForce_N: 11.0,
    rating_A_per_pin: 5.0,
    rating_V: 250,
    IP: '—',
    label: 'D-Sub DB-15 HD (15 pin, 2.29 mm pitch)',
  },
  {
    id: 'db-25',
    kind: 'dsub',
    family: 'D-Sub DB-25',
    pinCount: 25,
    pinPitch_mm: 2.77,
    bodyWidth_mm: 53.04,
    bodyHeight_mm: 12.55,
    bodyDepth_mm: 12.27,
    matingForce_N: 16.5,
    rating_A_per_pin: 5.0,
    rating_V: 250,
    IP: '—',
    label: 'D-Sub DB-25 (25 pin, 2.77 mm pitch)',
  },
]);

// ─────────────────────────────────────────────────────────────────────
// Molex Mini-Fit Jr (Series 5557 housing / 5559 terminal)
// Pitch: 4.20 mm.  Rating: 9.0 A per contact (16 AWG); voltage 600 V.
// Pin counts: 2 / 4 / 6 / 8 / 10 / 12 / 14 / 16 / 18 / 20 / 24
// Body OD is 2 rows × N/2 pins; height fixed at 11.20 mm.
// ─────────────────────────────────────────────────────────────────────

function molexMiniFit(pinCount) {
  const rows = 2;
  const cols = pinCount / rows;
  const width  = 5.50 + (cols - 1) * 4.20 + 5.50;  // end walls + pitch
  const height = 11.20;
  return {
    id: `molex-minifit-jr-${pinCount}`,
    kind: 'molex',
    family: 'Molex Mini-Fit Jr',
    pinCount, rows,
    pinPitch_mm: 4.20,
    bodyWidth_mm: round1(width),
    bodyHeight_mm: height,
    bodyDepth_mm: 19.0,
    matingForce_N: 1.6 * pinCount,   // 1.6 N per contact (Molex spec)
    rating_A_per_pin: 9.0,
    rating_V: 600,
    IP: '—',
    label: `Molex Mini-Fit Jr ${pinCount}-pin (4.20 mm)`,
  };
}
export const MOLEX_CONNECTORS = Object.freeze(
  [2, 4, 6, 8, 10, 12].map(molexMiniFit));

// ─────────────────────────────────────────────────────────────────────
// JST PH / XH / SH series
// ─────────────────────────────────────────────────────────────────────

function jstPH(pinCount) {
  const pitch = 2.0;
  const width = 2.95 + (pinCount - 1) * pitch + 2.95;
  return {
    id: `jst-ph-${pinCount}`,
    kind: 'jst',
    family: 'JST PH',
    pinCount, rows: 1,
    pinPitch_mm: pitch,
    bodyWidth_mm: round2(width),
    bodyHeight_mm: 6.0,
    bodyDepth_mm: 7.85,
    matingForce_N: 0.6 * pinCount,
    rating_A_per_pin: 2.0,
    rating_V: 100,
    IP: '—',
    label: `JST PH ${pinCount}-pin (2.00 mm)`,
  };
}
function jstXH(pinCount) {
  const pitch = 2.5;
  const width = 3.4 + (pinCount - 1) * pitch + 3.4;
  return {
    id: `jst-xh-${pinCount}`,
    kind: 'jst',
    family: 'JST XH',
    pinCount, rows: 1,
    pinPitch_mm: pitch,
    bodyWidth_mm: round2(width),
    bodyHeight_mm: 8.6,
    bodyDepth_mm: 10.2,
    matingForce_N: 0.8 * pinCount,
    rating_A_per_pin: 3.0,
    rating_V: 250,
    IP: '—',
    label: `JST XH ${pinCount}-pin (2.50 mm)`,
  };
}
function jstSH(pinCount) {
  const pitch = 1.0;
  const width = 1.5 + (pinCount - 1) * pitch + 1.5;
  return {
    id: `jst-sh-${pinCount}`,
    kind: 'jst',
    family: 'JST SH',
    pinCount, rows: 1,
    pinPitch_mm: pitch,
    bodyWidth_mm: round2(width),
    bodyHeight_mm: 2.5,
    bodyDepth_mm: 4.25,
    matingForce_N: 0.3 * pinCount,
    rating_A_per_pin: 1.0,
    rating_V: 50,
    IP: '—',
    label: `JST SH ${pinCount}-pin (1.00 mm)`,
  };
}
export const JST_CONNECTORS = Object.freeze([
  ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map(jstPH),
  ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map(jstXH),
  ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map(jstSH),
]);

// ─────────────────────────────────────────────────────────────────────
// M8 / M12 industrial — IEC 61076-2-104 / -101
// Cable-end plug: round body, M8x1 / M12x1 thread, IP67/68.
// ─────────────────────────────────────────────────────────────────────

function m8(pinCount) {
  return {
    id: `m8-${pinCount}p`,
    kind: 'industrial',
    family: 'M8 round',
    pinCount, rows: 1,
    pinPitch_mm: 0.0,                 // circular layout
    threadDia_mm: 8.0,
    bodyOD_mm: 11.6,
    bodyLength_mm: 28.0,
    matingForce_N: 4.0 * pinCount,
    rating_A_per_pin: 2.0,
    rating_V: 60,
    IP: 'IP67/IP68',
    label: `M8 ${pinCount}-pin (IP67, 2 A)`,
  };
}
function m12(pinCount) {
  return {
    id: `m12-${pinCount}p`,
    kind: 'industrial',
    family: 'M12 round',
    pinCount, rows: 1,
    pinPitch_mm: 0.0,
    threadDia_mm: 12.0,
    bodyOD_mm: 14.5,
    bodyLength_mm: 39.0,
    matingForce_N: 5.0 * pinCount,
    rating_A_per_pin: 4.0,
    rating_V: 250,
    IP: 'IP67',
    label: `M12 ${pinCount}-pin (IP67, 4 A)`,
  };
}
export const INDUSTRIAL_CONNECTORS = Object.freeze([
  ...[3, 4, 5, 6, 8].map(m8),
  ...[3, 4, 5, 8, 12].map(m12),
]);

// ─────────────────────────────────────────────────────────────────────
// Roll-up
// ─────────────────────────────────────────────────────────────────────

export const ALL_CONNECTORS = Object.freeze([
  ...DSUB_CONNECTORS,
  ...MOLEX_CONNECTORS,
  ...JST_CONNECTORS,
  ...INDUSTRIAL_CONNECTORS,
]);

export function getConnector(id) {
  return ALL_CONNECTORS.find((c) => c.id === id) || null;
}

export function connectorsByFamily() {
  const groups = new Map();
  for (const c of ALL_CONNECTORS) {
    const fam = c.family;
    if (!groups.has(fam)) groups.set(fam, []);
    groups.get(fam).push(c);
  }
  return groups;
}

function round1(x) { return Math.round(x * 10) / 10; }
function round2(x) { return Math.round(x * 100) / 100; }
