/**
 * ArchDisc Kernel — SKF rolling-element bearing catalog.
 *
 * Pure-data spec for the SKF bearing series used by the SP-1 Falcon 9
 * octaweb e2e (engine gimbal bearings + accessory-drive bearings).
 *
 * Source: SKF general-catalogue 2020 edition.
 *
 *   60xx  — Deep-groove ball bearings (ISO 15)     — radial loads
 *   63xx  — Heavy-series deep-groove ball          — higher radial capacity
 *   302xx — Tapered roller bearings (ISO 355)      — combined radial+axial
 *   322xx — Heavy-series tapered roller           — higher combined-load
 *
 * Dimensions in millimetres; load ratings in kN.
 */

// Deep-groove ball bearing — 60xx (light) series.
//   bore       inner-race bore (mm)
//   od         outer-race outside dia (mm)
//   width      axial width (mm)
//   ballD      ball diameter (mm)
//   balls      number of balls
//   C_dyn_kN   dynamic load rating (per ISO 281)
//   C0_kN      static load rating (per ISO 76)
//   limitingSpeed_rpm  grease-lubricated limiting speed
export const SKF_DEEP_GROOVE_LIGHT = {
  6000: { bore: 10, od: 26, width: 8,  ballD: 4.762, balls: 7,  C_dyn_kN: 4.55,  C0_kN: 1.96,  limitingSpeed_rpm: 36000 },
  6001: { bore: 12, od: 28, width: 8,  ballD: 4.762, balls: 7,  C_dyn_kN: 5.07,  C0_kN: 2.36,  limitingSpeed_rpm: 32000 },
  6002: { bore: 15, od: 32, width: 9,  ballD: 5.556, balls: 8,  C_dyn_kN: 5.85,  C0_kN: 2.85,  limitingSpeed_rpm: 28000 },
  6003: { bore: 17, od: 35, width: 10, ballD: 6.000, balls: 8,  C_dyn_kN: 6.05,  C0_kN: 3.25,  limitingSpeed_rpm: 24000 },
  6004: { bore: 20, od: 42, width: 12, ballD: 7.144, balls: 8,  C_dyn_kN: 9.36,  C0_kN: 4.50,  limitingSpeed_rpm: 20000 },
  6005: { bore: 25, od: 47, width: 12, ballD: 7.144, balls: 9,  C_dyn_kN: 11.9,  C0_kN: 5.85,  limitingSpeed_rpm: 17000 },
  6006: { bore: 30, od: 55, width: 13, ballD: 8.731, balls: 9,  C_dyn_kN: 13.8,  C0_kN: 8.30,  limitingSpeed_rpm: 15000 },
  6008: { bore: 40, od: 68, width: 15, ballD: 9.525, balls: 10, C_dyn_kN: 17.9,  C0_kN: 11.4,  limitingSpeed_rpm: 11000 },
  6010: { bore: 50, od: 80, width: 16, ballD: 11.11, balls: 11, C_dyn_kN: 21.6,  C0_kN: 14.6,  limitingSpeed_rpm: 9500 },
  6012: { bore: 60, od: 95, width: 18, ballD: 12.70, balls: 11, C_dyn_kN: 29.6,  C0_kN: 21.2,  limitingSpeed_rpm: 8500 },
  6014: { bore: 70, od: 110, width: 20, ballD: 14.29, balls: 12, C_dyn_kN: 39.0, C0_kN: 31.0,  limitingSpeed_rpm: 7500 },
  6016: { bore: 80, od: 125, width: 22, ballD: 15.88, balls: 12, C_dyn_kN: 47.5, C0_kN: 40.5,  limitingSpeed_rpm: 6700 },
  6020: { bore: 100, od: 150, width: 24, ballD: 17.46, balls: 13, C_dyn_kN: 60.5, C0_kN: 54.0, limitingSpeed_rpm: 5300 },
};

// Deep-groove ball bearing — 63xx (heavy) series.
export const SKF_DEEP_GROOVE_HEAVY = {
  6300: { bore: 10, od: 35, width: 11, ballD: 6.747, balls: 7,  C_dyn_kN: 8.06,  C0_kN: 3.40,  limitingSpeed_rpm: 30000 },
  6302: { bore: 15, od: 42, width: 13, ballD: 7.938, balls: 7,  C_dyn_kN: 11.9,  C0_kN: 5.40,  limitingSpeed_rpm: 22000 },
  6304: { bore: 20, od: 52, width: 15, ballD: 9.525, balls: 7,  C_dyn_kN: 15.9,  C0_kN: 7.80,  limitingSpeed_rpm: 17000 },
  6306: { bore: 30, od: 72, width: 19, ballD: 12.30, balls: 8,  C_dyn_kN: 28.1,  C0_kN: 14.6,  limitingSpeed_rpm: 12000 },
  6308: { bore: 40, od: 90, width: 23, ballD: 15.08, balls: 8,  C_dyn_kN: 42.3,  C0_kN: 24.0,  limitingSpeed_rpm: 10000 },
  6310: { bore: 50, od: 110, width: 27, ballD: 18.26, balls: 8, C_dyn_kN: 65.0,  C0_kN: 38.0,  limitingSpeed_rpm: 8000 },
  6312: { bore: 60, od: 130, width: 31, ballD: 22.23, balls: 8, C_dyn_kN: 85.2,  C0_kN: 52.0,  limitingSpeed_rpm: 6700 },
  6314: { bore: 70, od: 150, width: 35, ballD: 25.40, balls: 8, C_dyn_kN: 108,   C0_kN: 68.0,  limitingSpeed_rpm: 6000 },
  6316: { bore: 80, od: 170, width: 39, ballD: 28.58, balls: 8, C_dyn_kN: 130,   C0_kN: 86.5,  limitingSpeed_rpm: 5000 },
  6320: { bore: 100, od: 215, width: 47, ballD: 34.93, balls: 8, C_dyn_kN: 186,  C0_kN: 140,   limitingSpeed_rpm: 4000 },
};

// Tapered roller bearing — 302xx (light) series.
//   bore       inner-race bore (mm)
//   od         outer-race outside dia (mm)
//   width      total bearing width (T, mm)
//   contactAngle_deg  cup half-angle
//   C_dyn_kN, C0_kN
//   limitingSpeed_rpm
export const SKF_TAPERED_LIGHT = {
  30203: { bore: 17, od: 40,  width: 13.25, contactAngle_deg: 13.84, C_dyn_kN: 20.4, C0_kN: 22,   limitingSpeed_rpm: 13000 },
  30204: { bore: 20, od: 47,  width: 15.25, contactAngle_deg: 13.84, C_dyn_kN: 26.8, C0_kN: 30,   limitingSpeed_rpm: 11000 },
  30205: { bore: 25, od: 52,  width: 16.25, contactAngle_deg: 14.50, C_dyn_kN: 29.7, C0_kN: 33.5, limitingSpeed_rpm: 10000 },
  30206: { bore: 30, od: 62,  width: 17.25, contactAngle_deg: 14.04, C_dyn_kN: 40.2, C0_kN: 45.5, limitingSpeed_rpm: 8500 },
  30207: { bore: 35, od: 72,  width: 18.25, contactAngle_deg: 14.04, C_dyn_kN: 49.5, C0_kN: 56,   limitingSpeed_rpm: 7500 },
  30208: { bore: 40, od: 80,  width: 19.75, contactAngle_deg: 14.04, C_dyn_kN: 58.3, C0_kN: 67,   limitingSpeed_rpm: 7000 },
  30210: { bore: 50, od: 90,  width: 21.75, contactAngle_deg: 14.84, C_dyn_kN: 68.2, C0_kN: 82,   limitingSpeed_rpm: 6300 },
  30212: { bore: 60, od: 110, width: 23.75, contactAngle_deg: 14.84, C_dyn_kN: 96.6, C0_kN: 116,  limitingSpeed_rpm: 5300 },
  30214: { bore: 70, od: 125, width: 26.25, contactAngle_deg: 14.84, C_dyn_kN: 122,  C0_kN: 150,  limitingSpeed_rpm: 4500 },
};

// Tapered roller bearing — 322xx + 323xx (heavy/steep) series.
export const SKF_TAPERED_HEAVY = {
  32205: { bore: 25, od: 52,  width: 19.25, contactAngle_deg: 18.75, C_dyn_kN: 39.6, C0_kN: 51,   limitingSpeed_rpm: 9000 },
  32207: { bore: 35, od: 72,  width: 24.25, contactAngle_deg: 18.75, C_dyn_kN: 71.5, C0_kN: 95,   limitingSpeed_rpm: 7000 },
  32208: { bore: 40, od: 80,  width: 24.75, contactAngle_deg: 17.45, C_dyn_kN: 79.2, C0_kN: 108,  limitingSpeed_rpm: 6300 },
  32210: { bore: 50, od: 90,  width: 24.75, contactAngle_deg: 17.45, C_dyn_kN: 85.8, C0_kN: 122,  limitingSpeed_rpm: 5600 },
  32308: { bore: 40, od: 90,  width: 35.25, contactAngle_deg: 19.50, C_dyn_kN: 125,  C0_kN: 146,  limitingSpeed_rpm: 5300 },
  32310: { bore: 50, od: 110, width: 42.25, contactAngle_deg: 19.50, C_dyn_kN: 178,  C0_kN: 216,  limitingSpeed_rpm: 4500 },
  32312: { bore: 60, od: 130, width: 48.50, contactAngle_deg: 19.50, C_dyn_kN: 231,  C0_kN: 290,  limitingSpeed_rpm: 3800 },
  32314: { bore: 70, od: 150, width: 54.00, contactAngle_deg: 18.83, C_dyn_kN: 282,  C0_kN: 360,  limitingSpeed_rpm: 3400 },
  32316: { bore: 80, od: 170, width: 61.50, contactAngle_deg: 18.83, C_dyn_kN: 358,  C0_kN: 475,  limitingSpeed_rpm: 3000 },
};

export const SKF_DEEP_GROOVE_LIGHT_DESIGNATIONS = Object.keys(SKF_DEEP_GROOVE_LIGHT);
export const SKF_DEEP_GROOVE_HEAVY_DESIGNATIONS = Object.keys(SKF_DEEP_GROOVE_HEAVY);
export const SKF_TAPERED_LIGHT_DESIGNATIONS     = Object.keys(SKF_TAPERED_LIGHT);
export const SKF_TAPERED_HEAVY_DESIGNATIONS     = Object.keys(SKF_TAPERED_HEAVY);
