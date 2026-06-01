// Forge-168 — Cable library.
//
// Real cable data — outer diameter (OD, mm), ampacity (A) at 30 °C
// ambient, DC resistance (ohms/km), minimum bend radius (× OD), and
// electrical specs where relevant.
//
// Sources (called out in-line by section):
//   - AWG copper: NFPA 70 NEC Table 310.16 (60/75/90 °C ampacity for
//                 stranded copper, free air); IPC-2152 for stranded
//                 OD values used in panel wiring.
//   - Coax:       Belden / Times Microwave product spec sheets for
//                 RG-58/U, RG-178/U, RG-316/U.
//   - Cat 5e/6/6a/7: ANSI/TIA-568.2-D (cable diameters), IEEE 802.3
//                    section 40/55 (max length per Mbps/Gbps).
//   - USB:        USB 2.0 spec §5.3.1, USB 3.2 §6.4 (cable OD &
//                 max bend radius), USB-IF Type-C R2.2.
//   - HDMI:       HDMI Forum, 1.4 / 2.0 / 2.1 spec (bandwidth, cable OD).

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

/** Minimum bend radius (m) given outer diameter (mm) and multiplier. */
export function minBendRadius_m(od_mm, radiusFactor) {
  return (od_mm * radiusFactor) / 1000;
}

// ─────────────────────────────────────────────────────────────────────
// AWG hookup wire (stranded copper, PVC insulation — UL1007 family).
// Values: gauge → { stranding, OD, ampacity_air @75C, R_DC,
//                   minBend× OD, mass kg/km }
// Source: NEC T310.16 (chassis wiring, 75 °C) + IPC-2152 for OD/mass.
// ─────────────────────────────────────────────────────────────────────

const AWG_HOOKUP = [
  // [awg, stranding, OD_mm, ampacity_75C, R_ohm_per_km, bendFactor, mass_kg_km]
  ['24',   '7/32',   1.27,  3.5,   84.20,  6,  16.9],
  ['22',   '7/30',   1.52,  5.0,   52.96,  6,  21.7],
  ['20',   '10/30',  1.83,  7.5,   33.31,  6,  27.6],
  ['18',   '16/30',  2.18,  10.0,  20.95,  6,  37.4],
  ['16',   '26/30',  2.51,  13.0,  13.17,  6,  56.7],
  ['14',   '41/30',  2.92,  20.0,    8.282, 6,  85.5],
  ['12',   '65/30',  3.43,  25.0,    5.211, 6, 131.7],
  ['10',  '105/30',  4.07,  35.0,    3.277, 6, 198.5],
  ['8',   '168/30',  4.95,  50.0,    2.061, 8, 314.2],
  ['6',   '266/30',  6.05,  65.0,    1.296, 8, 478.1],
  ['4',   '420/30',  7.42,  85.0,    0.8152,8, 738.0],
  ['2',   '665/30',  9.07, 115.0,    0.5128,8,1147.0],
  ['1/0',     '—',  11.13, 150.0,    0.3225,12,1830.0],
  ['2/0',     '—',  12.40, 175.0,    0.2557,12,2300.0],
];

export const AWG_HOOKUP_WIRES = Object.freeze(AWG_HOOKUP.map(
  ([awg, stranding, od, amp, rdc, bf, mass]) => Object.freeze({
    id: `awg-${String(awg).replace('/', '-')}`,
    kind: 'wire',
    family: 'AWG hookup',
    awg, stranding,
    od_mm: od,
    ampacity_A_at75C: amp,
    R_DC_ohm_per_km: rdc,
    minBendFactor: bf,
    minBendRadius_m: minBendRadius_m(od, bf),
    mass_kg_per_km: mass,
    label: `AWG ${awg} (OD ${od.toFixed(2)} mm, ${amp} A)`,
  })));

// ─────────────────────────────────────────────────────────────────────
// Coaxial cables — Belden / Times Microwave datasheets.
//   Z0: impedance (Ω)
//   atten_dB_per_100ft_at_1GHz (or band-relevant)
//   velocity factor
// Min bend radius from MIL-DTL-17 (10× OD installation, 5× operation).
// ─────────────────────────────────────────────────────────────────────

export const COAX_CABLES = Object.freeze([
  {
    id: 'rg-58',
    kind: 'coax',
    family: 'RG-58/U',
    od_mm: 4.95,
    Z0_ohm: 50,
    velocityFactor: 0.66,
    atten_dB_per_100ft_at_1GHz: 13.8,
    centerConductor_AWG: '20',
    ampacity_A: 1.5,
    minBendFactor: 10,
    minBendRadius_m: minBendRadius_m(4.95, 10),
    mass_kg_per_km: 39,
    label: 'RG-58/U (50 Ω, OD 4.95 mm)',
  },
  {
    id: 'rg-178',
    kind: 'coax',
    family: 'RG-178/U',
    od_mm: 1.80,
    Z0_ohm: 50,
    velocityFactor: 0.69,
    atten_dB_per_100ft_at_1GHz: 41.0,
    centerConductor_AWG: '30',
    ampacity_A: 0.45,
    minBendFactor: 10,
    minBendRadius_m: minBendRadius_m(1.80, 10),
    mass_kg_per_km: 7,
    label: 'RG-178/U (50 Ω, OD 1.80 mm)',
  },
  {
    id: 'rg-316',
    kind: 'coax',
    family: 'RG-316/U',
    od_mm: 2.50,
    Z0_ohm: 50,
    velocityFactor: 0.69,
    atten_dB_per_100ft_at_1GHz: 27.5,
    centerConductor_AWG: '26',
    ampacity_A: 0.85,
    minBendFactor: 10,
    minBendRadius_m: minBendRadius_m(2.50, 10),
    mass_kg_per_km: 11,
    label: 'RG-316/U (50 Ω, OD 2.50 mm)',
  },
]);

// ─────────────────────────────────────────────────────────────────────
// Twisted-pair LAN — ANSI/TIA-568.2-D, IEEE 802.3 lengths.
//   - Cat 5e: UTP, 100 MHz, 100 m @ 1 Gbps
//   - Cat 6:  UTP, 250 MHz, 55 m @ 10 Gbps / 100 m @ 1 Gbps
//   - Cat 6a: F/UTP or U/FTP, 500 MHz, 100 m @ 10 Gbps
//   - Cat 7:  S/FTP, 600 MHz, 100 m @ 10 Gbps (ISO/IEC 11801 class F)
// Min bend radius per TIA-568: 4× OD installed.
// ─────────────────────────────────────────────────────────────────────

export const LAN_CABLES = Object.freeze([
  {
    id: 'cat5e-utp',
    kind: 'twistedpair',
    family: 'Cat 5e UTP',
    od_mm: 5.30,
    bandwidth_MHz: 100,
    maxLength_m_1Gbps: 100,
    maxLength_m_10Gbps: 0,    // not rated
    shielding: 'UTP',
    minBendFactor: 4,
    minBendRadius_m: minBendRadius_m(5.30, 4),
    mass_kg_per_km: 32,
    label: 'Cat 5e UTP (100 MHz, 1 Gbps @ 100 m)',
  },
  {
    id: 'cat6-utp',
    kind: 'twistedpair',
    family: 'Cat 6 UTP',
    od_mm: 5.80,
    bandwidth_MHz: 250,
    maxLength_m_1Gbps: 100,
    maxLength_m_10Gbps: 55,
    shielding: 'UTP',
    minBendFactor: 4,
    minBendRadius_m: minBendRadius_m(5.80, 4),
    mass_kg_per_km: 38,
    label: 'Cat 6 UTP (250 MHz, 10 Gbps @ 55 m)',
  },
  {
    id: 'cat6a-futp',
    kind: 'twistedpair',
    family: 'Cat 6a F/UTP',
    od_mm: 7.30,
    bandwidth_MHz: 500,
    maxLength_m_1Gbps: 100,
    maxLength_m_10Gbps: 100,
    shielding: 'F/UTP',
    minBendFactor: 4,
    minBendRadius_m: minBendRadius_m(7.30, 4),
    mass_kg_per_km: 55,
    label: 'Cat 6a F/UTP (500 MHz, 10 Gbps @ 100 m)',
  },
  {
    id: 'cat7-sftp',
    kind: 'twistedpair',
    family: 'Cat 7 S/FTP',
    od_mm: 8.00,
    bandwidth_MHz: 600,
    maxLength_m_1Gbps: 100,
    maxLength_m_10Gbps: 100,
    shielding: 'S/FTP',
    minBendFactor: 4,
    minBendRadius_m: minBendRadius_m(8.00, 4),
    mass_kg_per_km: 68,
    label: 'Cat 7 S/FTP (600 MHz, 10 Gbps @ 100 m)',
  },
]);

// ─────────────────────────────────────────────────────────────────────
// USB cables — USB-IF specs.
//   USB 2.0 spec: 5 m max @ 480 Mbps (12 Mbps full speed).
//   USB 3.0 (3.2 Gen 1): 3 m practical max for 5 Gbps.
//   USB 3.2 Gen 2x2 Type-C: 1 m for 20 Gbps.
// Min bend radius: 4× OD per USB-IF DLR (durability test).
// ─────────────────────────────────────────────────────────────────────

export const USB_CABLES = Object.freeze([
  {
    id: 'usb-2.0-a-b',
    kind: 'usb',
    family: 'USB 2.0',
    connectorA: 'USB-A',
    connectorB: 'USB-B',
    od_mm: 4.5,
    bandwidth_Mbps: 480,
    maxLength_m: 5.0,
    shielding: 'braided + foil',
    minBendFactor: 4,
    minBendRadius_m: minBendRadius_m(4.5, 4),
    mass_kg_per_km: 32,
    label: 'USB 2.0 A-B (480 Mbps, 5.0 m max)',
  },
  {
    id: 'usb-3.0-a-b',
    kind: 'usb',
    family: 'USB 3.0 (3.2 Gen 1)',
    connectorA: 'USB-A SS',
    connectorB: 'USB-B SS',
    od_mm: 6.5,
    bandwidth_Mbps: 5000,
    maxLength_m: 3.0,
    shielding: 'braided + foil + drain',
    minBendFactor: 4,
    minBendRadius_m: minBendRadius_m(6.5, 4),
    mass_kg_per_km: 58,
    label: 'USB 3.0 A-B (5 Gbps, 3.0 m max)',
  },
  {
    id: 'usb-3.2-type-c',
    kind: 'usb',
    family: 'USB 3.2 Type-C (Gen 2x2)',
    connectorA: 'USB-C',
    connectorB: 'USB-C',
    od_mm: 5.0,
    bandwidth_Mbps: 20000,
    maxLength_m: 1.0,
    shielding: 'fully shielded coax + braid',
    minBendFactor: 4,
    minBendRadius_m: minBendRadius_m(5.0, 4),
    mass_kg_per_km: 42,
    label: 'USB 3.2 Type-C (20 Gbps, 1.0 m max)',
  },
]);

// ─────────────────────────────────────────────────────────────────────
// HDMI cables — HDMI Forum spec.
//   HDMI 1.4: 10.2 Gbps   (Cat 2 / High Speed)
//   HDMI 2.0: 18.0 Gbps   (Premium High Speed)
//   HDMI 2.1: 48.0 Gbps   (Ultra High Speed)
// Min bend radius per HDMI compliance test: 8× OD.
// ─────────────────────────────────────────────────────────────────────

export const HDMI_CABLES = Object.freeze([
  {
    id: 'hdmi-1.4',
    kind: 'hdmi',
    family: 'HDMI 1.4 High Speed',
    od_mm: 7.3,
    bandwidth_Gbps: 10.2,
    maxLength_m_certified: 5.0,
    minBendFactor: 8,
    minBendRadius_m: minBendRadius_m(7.3, 8),
    mass_kg_per_km: 90,
    label: 'HDMI 1.4 High Speed (10.2 Gbps, 5 m)',
  },
  {
    id: 'hdmi-2.0',
    kind: 'hdmi',
    family: 'HDMI 2.0 Premium',
    od_mm: 7.5,
    bandwidth_Gbps: 18.0,
    maxLength_m_certified: 5.0,
    minBendFactor: 8,
    minBendRadius_m: minBendRadius_m(7.5, 8),
    mass_kg_per_km: 95,
    label: 'HDMI 2.0 Premium (18 Gbps, 5 m)',
  },
  {
    id: 'hdmi-2.1',
    kind: 'hdmi',
    family: 'HDMI 2.1 Ultra',
    od_mm: 8.0,
    bandwidth_Gbps: 48.0,
    maxLength_m_certified: 3.0,
    minBendFactor: 8,
    minBendRadius_m: minBendRadius_m(8.0, 8),
    mass_kg_per_km: 110,
    label: 'HDMI 2.1 Ultra High Speed (48 Gbps, 3 m)',
  },
]);

// ─────────────────────────────────────────────────────────────────────
// Roll-up
// ─────────────────────────────────────────────────────────────────────

export const ALL_CABLES = Object.freeze([
  ...AWG_HOOKUP_WIRES,
  ...COAX_CABLES,
  ...LAN_CABLES,
  ...USB_CABLES,
  ...HDMI_CABLES,
]);

export function getCable(id) {
  return ALL_CABLES.find((c) => c.id === id) || null;
}

export function cablesByFamily() {
  const groups = new Map();
  for (const c of ALL_CABLES) {
    const key = c.kind;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c);
  }
  return groups;
}

/**
 * Returns the per-cable minimum bend radius (m). Used by the harness
 * router to refuse routes that violate it.
 */
export function bendRadiusFor(cableId) {
  const c = getCable(cableId);
  return c?.minBendRadius_m ?? 0.025;  // safe fallback (25 mm)
}

/**
 * Aggregate bundle outer diameter for n cables — packing factor 1.21
 * (random round-rod packing), Belden engineering note.
 */
export function bundleOD_mm(cableList) {
  if (!cableList?.length) return 0;
  const ods = cableList.map((c) => getCable(c)?.od_mm || 0);
  if (ods.length === 1) return ods[0];
  // Equivalent OD = 1.21 · √(Σ OD²)
  const sumSq = ods.reduce((s, o) => s + o * o, 0);
  return 1.21 * Math.sqrt(sumSq);
}
