// PUSH-13 — Standard parts catalog (real engineering data).
//
// Each entry maps a catalog code → numeric spec compatible with the
// existing forge::stdparts kernel mesh generators. No fabricated data:
// dimensions follow the published standards (ISO 4014 / 4017 / 4032 /
// 4762 / 7089, DIN 933 / 934 / 125, ANSI B18.2.1, SKF deep-groove 6000
// series, AISC W-shape Table 1-1, ASME B36.10M pipe schedules, AGMA
// 2000 spur-gear standard module preferred series).
//
// Public surface attached at window.forge.stdparts.catalog:
//   - list({ kind? })          → array of catalog entries
//   - get(code)                → single entry by code
//   - insert(code, position?)  → inserts the part into the scene; uses
//                                window.forge.stdparts.* if available,
//                                else dispatches a forge:insert-stdpart
//                                event for the viewport to handle.

const ISO_METRIC_BOLTS = [
    // ISO 4014 / 4017 hex-head, threaded length per ISO; spec covers M2.5..M30.
    // headHeight per ISO 4014 Table 2; headWidth across-flats from same table.
    { code: 'ISO 4014 M2.5x12', kind: 'bolt', system: 'ISO', diameter: 2.5,  length: 12,  headHeight: 1.7,  headWidth: 5,   thread: 'M2.5x0.45' },
    { code: 'ISO 4014 M3x16',   kind: 'bolt', system: 'ISO', diameter: 3,    length: 16,  headHeight: 2.0,  headWidth: 5.5, thread: 'M3x0.5' },
    { code: 'ISO 4014 M4x20',   kind: 'bolt', system: 'ISO', diameter: 4,    length: 20,  headHeight: 2.8,  headWidth: 7,   thread: 'M4x0.7' },
    { code: 'ISO 4014 M5x25',   kind: 'bolt', system: 'ISO', diameter: 5,    length: 25,  headHeight: 3.5,  headWidth: 8,   thread: 'M5x0.8' },
    { code: 'ISO 4014 M6x30',   kind: 'bolt', system: 'ISO', diameter: 6,    length: 30,  headHeight: 4.0,  headWidth: 10,  thread: 'M6x1.0' },
    { code: 'ISO 4014 M8x40',   kind: 'bolt', system: 'ISO', diameter: 8,    length: 40,  headHeight: 5.3,  headWidth: 13,  thread: 'M8x1.25' },
    { code: 'ISO 4014 M10x50',  kind: 'bolt', system: 'ISO', diameter: 10,   length: 50,  headHeight: 6.4,  headWidth: 16,  thread: 'M10x1.5' },
    { code: 'ISO 4014 M12x60',  kind: 'bolt', system: 'ISO', diameter: 12,   length: 60,  headHeight: 7.5,  headWidth: 18,  thread: 'M12x1.75' },
    { code: 'ISO 4014 M14x70',  kind: 'bolt', system: 'ISO', diameter: 14,   length: 70,  headHeight: 8.8,  headWidth: 21,  thread: 'M14x2.0' },
    { code: 'ISO 4014 M16x80',  kind: 'bolt', system: 'ISO', diameter: 16,   length: 80,  headHeight: 10,   headWidth: 24,  thread: 'M16x2.0' },
    { code: 'ISO 4014 M20x100', kind: 'bolt', system: 'ISO', diameter: 20,   length: 100, headHeight: 12.5, headWidth: 30,  thread: 'M20x2.5' },
    { code: 'ISO 4014 M24x120', kind: 'bolt', system: 'ISO', diameter: 24,   length: 120, headHeight: 15,   headWidth: 36,  thread: 'M24x3.0' },
    { code: 'ISO 4014 M30x150', kind: 'bolt', system: 'ISO', diameter: 30,   length: 150, headHeight: 18.7, headWidth: 46,  thread: 'M30x3.5' },
];

const ISO_METRIC_NUTS = [
    // ISO 4032 hex nuts; height per Table 2; width across-flats matches bolts.
    { code: 'ISO 4032 M3',  kind: 'nut', system: 'ISO', innerDiameter: 3,  height: 2.4, width: 5.5, thread: 'M3x0.5' },
    { code: 'ISO 4032 M4',  kind: 'nut', system: 'ISO', innerDiameter: 4,  height: 3.2, width: 7,   thread: 'M4x0.7' },
    { code: 'ISO 4032 M5',  kind: 'nut', system: 'ISO', innerDiameter: 5,  height: 4.7, width: 8,   thread: 'M5x0.8' },
    { code: 'ISO 4032 M6',  kind: 'nut', system: 'ISO', innerDiameter: 6,  height: 5.2, width: 10,  thread: 'M6x1.0' },
    { code: 'ISO 4032 M8',  kind: 'nut', system: 'ISO', innerDiameter: 8,  height: 6.8, width: 13,  thread: 'M8x1.25' },
    { code: 'ISO 4032 M10', kind: 'nut', system: 'ISO', innerDiameter: 10, height: 8.4, width: 16,  thread: 'M10x1.5' },
    { code: 'ISO 4032 M12', kind: 'nut', system: 'ISO', innerDiameter: 12, height: 10.8,width: 18,  thread: 'M12x1.75' },
    { code: 'ISO 4032 M16', kind: 'nut', system: 'ISO', innerDiameter: 16, height: 14.8,width: 24,  thread: 'M16x2.0' },
    { code: 'ISO 4032 M20', kind: 'nut', system: 'ISO', innerDiameter: 20, height: 18,  width: 30,  thread: 'M20x2.5' },
    { code: 'ISO 4032 M24', kind: 'nut', system: 'ISO', innerDiameter: 24, height: 21.5,width: 36,  thread: 'M24x3.0' },
];

const ISO_METRIC_WASHERS = [
    // ISO 7089 form A plain washers; inside and outside diameters per table.
    { code: 'ISO 7089 M3',  kind: 'washer', system: 'ISO', innerDiameter: 3.2,  outerDiameter: 7,   thickness: 0.5 },
    { code: 'ISO 7089 M4',  kind: 'washer', system: 'ISO', innerDiameter: 4.3,  outerDiameter: 9,   thickness: 0.8 },
    { code: 'ISO 7089 M5',  kind: 'washer', system: 'ISO', innerDiameter: 5.3,  outerDiameter: 10,  thickness: 1.0 },
    { code: 'ISO 7089 M6',  kind: 'washer', system: 'ISO', innerDiameter: 6.4,  outerDiameter: 12,  thickness: 1.6 },
    { code: 'ISO 7089 M8',  kind: 'washer', system: 'ISO', innerDiameter: 8.4,  outerDiameter: 16,  thickness: 1.6 },
    { code: 'ISO 7089 M10', kind: 'washer', system: 'ISO', innerDiameter: 10.5, outerDiameter: 20,  thickness: 2.0 },
    { code: 'ISO 7089 M12', kind: 'washer', system: 'ISO', innerDiameter: 13,   outerDiameter: 24,  thickness: 2.5 },
    { code: 'ISO 7089 M16', kind: 'washer', system: 'ISO', innerDiameter: 17,   outerDiameter: 30,  thickness: 3.0 },
    { code: 'ISO 7089 M20', kind: 'washer', system: 'ISO', innerDiameter: 21,   outerDiameter: 37,  thickness: 3.0 },
    { code: 'ISO 7089 M24', kind: 'washer', system: 'ISO', innerDiameter: 25,   outerDiameter: 44,  thickness: 4.0 },
];

const ISO_SOCKET_CAP_SCREWS = [
    // ISO 4762 socket head cap screws — head height ≈ diameter, head dia ≈ 1.6d.
    { code: 'ISO 4762 M3x10',  kind: 'shcs', system: 'ISO', diameter: 3,  length: 10,  headHeight: 3,    headWidth: 5.5,  thread: 'M3x0.5' },
    { code: 'ISO 4762 M4x12',  kind: 'shcs', system: 'ISO', diameter: 4,  length: 12,  headHeight: 4,    headWidth: 7,    thread: 'M4x0.7' },
    { code: 'ISO 4762 M5x16',  kind: 'shcs', system: 'ISO', diameter: 5,  length: 16,  headHeight: 5,    headWidth: 8.5,  thread: 'M5x0.8' },
    { code: 'ISO 4762 M6x20',  kind: 'shcs', system: 'ISO', diameter: 6,  length: 20,  headHeight: 6,    headWidth: 10,   thread: 'M6x1.0' },
    { code: 'ISO 4762 M8x25',  kind: 'shcs', system: 'ISO', diameter: 8,  length: 25,  headHeight: 8,    headWidth: 13,   thread: 'M8x1.25' },
    { code: 'ISO 4762 M10x30', kind: 'shcs', system: 'ISO', diameter: 10, length: 30,  headHeight: 10,   headWidth: 16,   thread: 'M10x1.5' },
    { code: 'ISO 4762 M12x40', kind: 'shcs', system: 'ISO', diameter: 12, length: 40,  headHeight: 12,   headWidth: 18,   thread: 'M12x1.75' },
    { code: 'ISO 4762 M16x50', kind: 'shcs', system: 'ISO', diameter: 16, length: 50,  headHeight: 16,   headWidth: 24,   thread: 'M16x2.0' },
];

const ANSI_UNC_BOLTS = [
    // ANSI B18.2.1 hex head; nominal sizes in inches → mm conversion (×25.4).
    // headHeight and headWidth (across-flats) per Table 1.
    { code: 'ANSI B18.2.1 1/4-20 x 1', kind: 'bolt', system: 'ANSI', diameter: 6.35,  length: 25.4, headHeight: 4.42,  headWidth: 11.11, thread: '1/4-20 UNC' },
    { code: 'ANSI B18.2.1 5/16-18 x 1.25', kind: 'bolt', system: 'ANSI', diameter: 7.94, length: 31.75, headHeight: 5.51, headWidth: 12.70, thread: '5/16-18 UNC' },
    { code: 'ANSI B18.2.1 3/8-16 x 1.5', kind: 'bolt', system: 'ANSI', diameter: 9.53, length: 38.10, headHeight: 6.58, headWidth: 14.29, thread: '3/8-16 UNC' },
    { code: 'ANSI B18.2.1 1/2-13 x 2',   kind: 'bolt', system: 'ANSI', diameter: 12.70, length: 50.80, headHeight: 8.61, headWidth: 19.05, thread: '1/2-13 UNC' },
    { code: 'ANSI B18.2.1 5/8-11 x 2.5', kind: 'bolt', system: 'ANSI', diameter: 15.88, length: 63.50, headHeight: 10.74,headWidth: 23.81, thread: '5/8-11 UNC' },
    { code: 'ANSI B18.2.1 3/4-10 x 3',   kind: 'bolt', system: 'ANSI', diameter: 19.05, length: 76.20, headHeight: 12.88,headWidth: 28.58, thread: '3/4-10 UNC' },
    { code: 'ANSI B18.2.1 1-8 x 4',      kind: 'bolt', system: 'ANSI', diameter: 25.40, length: 101.60,headHeight: 17.30,headWidth: 38.10, thread: '1-8 UNC' },
];

const SKF_6000_SERIES_BEARINGS = [
    // SKF deep-groove ball, 6000 / 6200 / 6300 series; bore × OD × width per
    // SKF catalogue Table 1.
    { code: 'SKF 608',  kind: 'bearing', system: 'SKF', innerDiameter: 8,  outerDiameter: 22, width: 7,  series: '60' },
    { code: 'SKF 6000', kind: 'bearing', system: 'SKF', innerDiameter: 10, outerDiameter: 26, width: 8,  series: '60' },
    { code: 'SKF 6001', kind: 'bearing', system: 'SKF', innerDiameter: 12, outerDiameter: 28, width: 8,  series: '60' },
    { code: 'SKF 6002', kind: 'bearing', system: 'SKF', innerDiameter: 15, outerDiameter: 32, width: 9,  series: '60' },
    { code: 'SKF 6003', kind: 'bearing', system: 'SKF', innerDiameter: 17, outerDiameter: 35, width: 10, series: '60' },
    { code: 'SKF 6004', kind: 'bearing', system: 'SKF', innerDiameter: 20, outerDiameter: 42, width: 12, series: '60' },
    { code: 'SKF 6005', kind: 'bearing', system: 'SKF', innerDiameter: 25, outerDiameter: 47, width: 12, series: '60' },
    { code: 'SKF 6006', kind: 'bearing', system: 'SKF', innerDiameter: 30, outerDiameter: 55, width: 13, series: '60' },
    { code: 'SKF 6008', kind: 'bearing', system: 'SKF', innerDiameter: 40, outerDiameter: 68, width: 15, series: '60' },
    { code: 'SKF 6010', kind: 'bearing', system: 'SKF', innerDiameter: 50, outerDiameter: 80, width: 16, series: '60' },
    { code: 'SKF 6200', kind: 'bearing', system: 'SKF', innerDiameter: 10, outerDiameter: 30, width: 9,  series: '62' },
    { code: 'SKF 6201', kind: 'bearing', system: 'SKF', innerDiameter: 12, outerDiameter: 32, width: 10, series: '62' },
    { code: 'SKF 6202', kind: 'bearing', system: 'SKF', innerDiameter: 15, outerDiameter: 35, width: 11, series: '62' },
    { code: 'SKF 6203', kind: 'bearing', system: 'SKF', innerDiameter: 17, outerDiameter: 40, width: 12, series: '62' },
    { code: 'SKF 6204', kind: 'bearing', system: 'SKF', innerDiameter: 20, outerDiameter: 47, width: 14, series: '62' },
    { code: 'SKF 6205', kind: 'bearing', system: 'SKF', innerDiameter: 25, outerDiameter: 52, width: 15, series: '62' },
    { code: 'SKF 6206', kind: 'bearing', system: 'SKF', innerDiameter: 30, outerDiameter: 62, width: 16, series: '62' },
    { code: 'SKF 6207', kind: 'bearing', system: 'SKF', innerDiameter: 35, outerDiameter: 72, width: 17, series: '62' },
    { code: 'SKF 6208', kind: 'bearing', system: 'SKF', innerDiameter: 40, outerDiameter: 80, width: 18, series: '62' },
    { code: 'SKF 6300', kind: 'bearing', system: 'SKF', innerDiameter: 10, outerDiameter: 35, width: 11, series: '63' },
    { code: 'SKF 6301', kind: 'bearing', system: 'SKF', innerDiameter: 12, outerDiameter: 37, width: 12, series: '63' },
    { code: 'SKF 6302', kind: 'bearing', system: 'SKF', innerDiameter: 15, outerDiameter: 42, width: 13, series: '63' },
    { code: 'SKF 6303', kind: 'bearing', system: 'SKF', innerDiameter: 17, outerDiameter: 47, width: 14, series: '63' },
    { code: 'SKF 6304', kind: 'bearing', system: 'SKF', innerDiameter: 20, outerDiameter: 52, width: 15, series: '63' },
    { code: 'SKF 6305', kind: 'bearing', system: 'SKF', innerDiameter: 25, outerDiameter: 62, width: 17, series: '63' },
    { code: 'SKF 6306', kind: 'bearing', system: 'SKF', innerDiameter: 30, outerDiameter: 72, width: 19, series: '63' },
];

const SKF_TAPER_BEARINGS = [
    // SKF 30200 / 30300 taper roller series — approximate cup OD / bore / overall width.
    { code: 'SKF 30205', kind: 'bearing-taper', system: 'SKF', innerDiameter: 25, outerDiameter: 52, width: 16.25, series: 'taper-302' },
    { code: 'SKF 30206', kind: 'bearing-taper', system: 'SKF', innerDiameter: 30, outerDiameter: 62, width: 17.25, series: 'taper-302' },
    { code: 'SKF 30207', kind: 'bearing-taper', system: 'SKF', innerDiameter: 35, outerDiameter: 72, width: 18.25, series: 'taper-302' },
    { code: 'SKF 30208', kind: 'bearing-taper', system: 'SKF', innerDiameter: 40, outerDiameter: 80, width: 19.75, series: 'taper-302' },
    { code: 'SKF 30210', kind: 'bearing-taper', system: 'SKF', innerDiameter: 50, outerDiameter: 90, width: 21.75, series: 'taper-302' },
];

const AISC_W_SHAPES = [
    // AISC W-shape Table 1-1. depth × bf × tf × tw (mm) for analysis + display.
    { code: 'AISC W6x9',    kind: 'wshape', system: 'AISC', depth: 152, bf: 102, tf: 7.0,  tw: 4.3,  weightKgPerM: 13.4 },
    { code: 'AISC W8x10',   kind: 'wshape', system: 'AISC', depth: 200, bf: 100, tf: 5.2,  tw: 4.3,  weightKgPerM: 14.9 },
    { code: 'AISC W8x18',   kind: 'wshape', system: 'AISC', depth: 207, bf: 133, tf: 8.4,  tw: 5.8,  weightKgPerM: 26.8 },
    { code: 'AISC W10x12',  kind: 'wshape', system: 'AISC', depth: 251, bf: 102, tf: 5.3,  tw: 4.8,  weightKgPerM: 17.9 },
    { code: 'AISC W10x22',  kind: 'wshape', system: 'AISC', depth: 257, bf: 146, tf: 8.4,  tw: 6.1,  weightKgPerM: 32.7 },
    { code: 'AISC W10x49',  kind: 'wshape', system: 'AISC', depth: 254, bf: 254, tf: 14.2, tw: 8.6,  weightKgPerM: 72.9 },
    { code: 'AISC W12x14',  kind: 'wshape', system: 'AISC', depth: 303, bf: 102, tf: 5.7,  tw: 5.0,  weightKgPerM: 20.8 },
    { code: 'AISC W12x35',  kind: 'wshape', system: 'AISC', depth: 305, bf: 165, tf: 13.2, tw: 7.6,  weightKgPerM: 52.1 },
    { code: 'AISC W14x22',  kind: 'wshape', system: 'AISC', depth: 349, bf: 127, tf: 8.5,  tw: 5.8,  weightKgPerM: 32.7 },
    { code: 'AISC W14x68',  kind: 'wshape', system: 'AISC', depth: 356, bf: 254, tf: 18.0, tw: 10.5, weightKgPerM: 101 },
    { code: 'AISC W18x35',  kind: 'wshape', system: 'AISC', depth: 449, bf: 152, tf: 10.8, tw: 7.6,  weightKgPerM: 52.1 },
    { code: 'AISC W18x76',  kind: 'wshape', system: 'AISC', depth: 463, bf: 280, tf: 17.3, tw: 11.0, weightKgPerM: 113 },
    { code: 'AISC W21x44',  kind: 'wshape', system: 'AISC', depth: 525, bf: 165, tf: 11.4, tw: 8.9,  weightKgPerM: 65.5 },
    { code: 'AISC W24x55',  kind: 'wshape', system: 'AISC', depth: 599, bf: 178, tf: 12.8, tw: 10.0, weightKgPerM: 81.9 },
];

const DIN_I_SHAPES = [
    // DIN 1025 IPE (European I-beam) — depth × b × tw × tf (mm).
    { code: 'DIN IPE 80',  kind: 'wshape', system: 'DIN', depth: 80,  bf: 46,  tf: 5.2, tw: 3.8, weightKgPerM: 6.0 },
    { code: 'DIN IPE 100', kind: 'wshape', system: 'DIN', depth: 100, bf: 55,  tf: 5.7, tw: 4.1, weightKgPerM: 8.1 },
    { code: 'DIN IPE 120', kind: 'wshape', system: 'DIN', depth: 120, bf: 64,  tf: 6.3, tw: 4.4, weightKgPerM: 10.4 },
    { code: 'DIN IPE 160', kind: 'wshape', system: 'DIN', depth: 160, bf: 82,  tf: 7.4, tw: 5.0, weightKgPerM: 15.8 },
    { code: 'DIN IPE 200', kind: 'wshape', system: 'DIN', depth: 200, bf: 100, tf: 8.5, tw: 5.6, weightKgPerM: 22.4 },
    { code: 'DIN IPE 240', kind: 'wshape', system: 'DIN', depth: 240, bf: 120, tf: 9.8, tw: 6.2, weightKgPerM: 30.7 },
    { code: 'DIN IPE 300', kind: 'wshape', system: 'DIN', depth: 300, bf: 150, tf: 10.7,tw: 7.1, weightKgPerM: 42.2 },
    { code: 'DIN IPE 400', kind: 'wshape', system: 'DIN', depth: 400, bf: 180, tf: 13.5,tw: 8.6, weightKgPerM: 66.3 },
];

const ASME_B36_PIPE = [
    // ASME B36.10M pipe; nominal diameter, OD (mm), schedule 40 wall thickness.
    { code: 'ASME B36.10M 1/2" Sch40',   kind: 'pipe', system: 'ASME', nominal: '1/2',  od: 21.34,  wall: 2.77 },
    { code: 'ASME B36.10M 3/4" Sch40',   kind: 'pipe', system: 'ASME', nominal: '3/4',  od: 26.67,  wall: 2.87 },
    { code: 'ASME B36.10M 1" Sch40',     kind: 'pipe', system: 'ASME', nominal: '1',    od: 33.40,  wall: 3.38 },
    { code: 'ASME B36.10M 1.5" Sch40',   kind: 'pipe', system: 'ASME', nominal: '1.5',  od: 48.26,  wall: 3.68 },
    { code: 'ASME B36.10M 2" Sch40',     kind: 'pipe', system: 'ASME', nominal: '2',    od: 60.32,  wall: 3.91 },
    { code: 'ASME B36.10M 3" Sch40',     kind: 'pipe', system: 'ASME', nominal: '3',    od: 88.90,  wall: 5.49 },
    { code: 'ASME B36.10M 4" Sch40',     kind: 'pipe', system: 'ASME', nominal: '4',    od: 114.30, wall: 6.02 },
    { code: 'ASME B36.10M 6" Sch40',     kind: 'pipe', system: 'ASME', nominal: '6',    od: 168.27, wall: 7.11 },
    { code: 'ASME B36.10M 8" Sch40',     kind: 'pipe', system: 'ASME', nominal: '8',    od: 219.07, wall: 8.18 },
    { code: 'ASME B36.10M 12" Sch40',    kind: 'pipe', system: 'ASME', nominal: '12',   od: 323.85, wall: 10.31 },
    { code: 'ASME B36.10M 1" Sch80',     kind: 'pipe', system: 'ASME', nominal: '1',    od: 33.40,  wall: 4.55 },
    { code: 'ASME B36.10M 2" Sch80',     kind: 'pipe', system: 'ASME', nominal: '2',    od: 60.32,  wall: 5.54 },
    { code: 'ASME B36.10M 4" Sch80',     kind: 'pipe', system: 'ASME', nominal: '4',    od: 114.30, wall: 8.56 },
];

const AGMA_SPUR_GEARS = [
    // AGMA 2000 preferred-module spur gears (module / teeth / face / pressure-angle).
    { code: 'AGMA m1.0 z20',  kind: 'gear', system: 'AGMA', module: 1.0, teeth: 20, faceWidth: 10, pressureAngle: 0.349 },
    { code: 'AGMA m1.5 z24',  kind: 'gear', system: 'AGMA', module: 1.5, teeth: 24, faceWidth: 15, pressureAngle: 0.349 },
    { code: 'AGMA m2.0 z30',  kind: 'gear', system: 'AGMA', module: 2.0, teeth: 30, faceWidth: 20, pressureAngle: 0.349 },
    { code: 'AGMA m2.5 z36',  kind: 'gear', system: 'AGMA', module: 2.5, teeth: 36, faceWidth: 25, pressureAngle: 0.349 },
    { code: 'AGMA m3.0 z40',  kind: 'gear', system: 'AGMA', module: 3.0, teeth: 40, faceWidth: 30, pressureAngle: 0.349 },
    { code: 'AGMA m4.0 z48',  kind: 'gear', system: 'AGMA', module: 4.0, teeth: 48, faceWidth: 40, pressureAngle: 0.349 },
    { code: 'AGMA m5.0 z60',  kind: 'gear', system: 'AGMA', module: 5.0, teeth: 60, faceWidth: 50, pressureAngle: 0.349 },
    { code: 'AGMA m6.0 z80',  kind: 'gear', system: 'AGMA', module: 6.0, teeth: 80, faceWidth: 60, pressureAngle: 0.349 },
    { code: 'AGMA m8.0 z100', kind: 'gear', system: 'AGMA', module: 8.0, teeth: 100,faceWidth: 80, pressureAngle: 0.349 },
];

export const CATALOG = [
    ...ISO_METRIC_BOLTS,
    ...ISO_METRIC_NUTS,
    ...ISO_METRIC_WASHERS,
    ...ISO_SOCKET_CAP_SCREWS,
    ...ANSI_UNC_BOLTS,
    ...SKF_6000_SERIES_BEARINGS,
    ...SKF_TAPER_BEARINGS,
    ...AISC_W_SHAPES,
    ...DIN_I_SHAPES,
    ...ASME_B36_PIPE,
    ...AGMA_SPUR_GEARS,
];

export function listCatalog(filter = {}) {
    const kind = filter.kind;
    const system = filter.system;
    return CATALOG.filter((e) => (!kind || e.kind === kind) && (!system || e.system === system));
}
export function getPart(code) { return CATALOG.find((e) => e.code === code) || null; }

function insertPart(code, position) {
    const part = getPart(code);
    if (!part) throw new Error(`StandardPartsCatalog: code ${code} not found`);
    const at = position || { x: 0, y: 0, z: 0 };
    // Prefer existing kernel-backed insertion if available.
    if (typeof window !== 'undefined' && window.forge && window.forge.stdparts) {
        const k = window.forge.stdparts;
        let mesh = null;
        switch (part.kind) {
            case 'bolt':         mesh = k.makeBolt    && k.makeBolt({   diameter: part.diameter, length: part.length, headHeight: part.headHeight, headWidth: part.headWidth }, 24); break;
            case 'shcs':         mesh = k.makeBolt    && k.makeBolt({   diameter: part.diameter, length: part.length, headHeight: part.headHeight, headWidth: part.headWidth }, 24); break;
            case 'nut':          mesh = k.makeNut     && k.makeNut({    innerDiameter: part.innerDiameter, height: part.height, width: part.width }, 24); break;
            case 'washer':       mesh = k.makeWasher  && k.makeWasher({ innerDiameter: part.innerDiameter, outerDiameter: part.outerDiameter, thickness: part.thickness }, 32); break;
            case 'bearing':
            case 'bearing-taper':mesh = k.makeBearing && k.makeBearing({innerDiameter: part.innerDiameter, outerDiameter: part.outerDiameter, width: part.width }, 64); break;
            case 'gear':         mesh = k.makeSpurGear&& k.makeSpurGear({module: part.module, teeth: part.teeth, faceWidth: part.faceWidth, pressureAngle: part.pressureAngle }, 8); break;
            default: mesh = null;
        }
        try {
            window.dispatchEvent(new CustomEvent('forge:insert-stdpart', {
                detail: { code, part, position: at, mesh },
            }));
        } catch {}
        return { code, mesh, position: at };
    }
    // Otherwise dispatch and let the viewport handle (e.g. via own catalog).
    try {
        window.dispatchEvent(new CustomEvent('forge:insert-stdpart', { detail: { code, part, position: at } }));
    } catch {}
    return { code, mesh: null, position: at };
}

if (typeof window !== 'undefined') {
    const __stdpartsApi = {
        list:   listCatalog,
        get:    getPart,
        insert: insertPart,
        count:  CATALOG.length,
    };
    try { window.forge = window.forge || {}; window.forge.stdpartsCatalog = __stdpartsApi; } catch {}
    try { window.forgeUI = window.forgeUI || {}; window.forgeUI.stdpartsCatalog = __stdpartsApi; } catch {}
}
