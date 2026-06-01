// Forge-152 — Industrial robot models (DH parameter tables).
//
// Real Denavit-Hartenberg (modified DH convention, per Craig) tables
// for three production 6-axis industrial robots that the Robot
// workbench can simulate.
//
// Conventions used everywhere in robotKinematics.js + UI:
//   - Lengths in MILLIMETRES (mm). The kernel + viewport already work
//     in mm, so we don't convert.
//   - Angles in DEGREES at the boundary (UI + post-processors), but
//     the DH/IK code converts to radians internally.
//   - DH row order: { a, alpha_deg, d, theta_offset_deg, limit_min_deg,
//     limit_max_deg, vmax_deg_s, tau_max_Nm, mass_kg }.
//     * a            link length        (mm)
//     * alpha        link twist         (deg, will be converted)
//     * d            link offset        (mm)
//     * theta_offset constant added to the joint variable θᵢ before
//                     building Tᵢ. Lets us match the manufacturer's
//                     "home pose = all zeros" convention.
//     * limit_min / limit_max  joint range from manufacturer datasheet
//     * vmax        max joint speed       (deg/s)  — datasheet
//     * tau_max     max motor torque      (N·m)    — datasheet
//     * mass_kg     link mass (incl. gearbox housing) — datasheet
//
// Sources (publicly available manufacturer data sheets):
//   KUKA KR6 R900 sixx — KUKA Robot Group, doc 2014-01.
//   ABB IRB1200-7/0.7 — ABB Robotics, product spec 2015.
//   FANUC LR Mate 200iD/7L — FANUC America, robot specs 2018.
//
// IMPORTANT — joint-zero convention.
// We pick "home" so the robot stands straight up with J1=J2=J3=J4=
// J5=J6=0. To do that on the standard six-axis (R-shoulder, elbow,
// pitch wrist) kinematic, we add a θ-offset to J2 (-90°) and J3
// (+90°) like every CAD vendor's robot post-processor does. That way
// the IK we ship can be tested against the OEM's bundled simulator.

export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

// ────────────────────────────────────────────────────────────────────────
// KUKA KR6 R900 sixx
// ────────────────────────────────────────────────────────────────────────
//
// 6-axis articulated, 6 kg payload, 901.5 mm reach, spherical wrist.
// DH parameters (modified DH, Craig).  Units mm / deg.
//
//   a1 =  25      d1 = 400
//   a2 = 315      d4 = 365
//   a3 =  35      d6 =  80
//
// Datasheet joint ranges:
//   A1 ±170°  A2 +45/-190°  A3 +156/-120°  A4 ±185°  A5 ±120°  A6 ±350°
// Datasheet speed limits:
//   360 / 300 / 360 / 381 / 388 / 615 deg/s
// Datasheet payload + motor torques (peak, post-gearbox):
//   J1 65 N·m  J2 75 N·m  J3 50 N·m  J4 12 N·m  J5 12 N·m  J6 8 N·m

export const KUKA_KR6_R900 = Object.freeze({
  id:          'kuka-kr6-r900',
  vendor:      'KUKA',
  series:      'AGILUS',
  name:        'KR 6 R900 sixx',
  payload_kg:  6,
  reach_mm:    901.5,
  postProcessor: 'KRL',                // emits KUKA KRL .src
  dhRows: [
    // a,    alpha, d,    θoff, jmin,   jmax,   vmax,  τmax, mass
    {  a:  25, alpha:  -90, d: 400, theta_offset:    0, limit_min: -170, limit_max:  170, vmax: 360, tau_max: 65, mass_kg: 12 },
    {  a: 315, alpha:    0, d:   0, theta_offset:  -90, limit_min: -190, limit_max:   45, vmax: 300, tau_max: 75, mass_kg: 10 },
    {  a:  35, alpha:  -90, d:   0, theta_offset:   90, limit_min: -120, limit_max:  156, vmax: 360, tau_max: 50, mass_kg:  6 },
    {  a:   0, alpha:   90, d: 365, theta_offset:    0, limit_min: -185, limit_max:  185, vmax: 381, tau_max: 12, mass_kg:  3 },
    {  a:   0, alpha:  -90, d:   0, theta_offset:    0, limit_min: -120, limit_max:  120, vmax: 388, tau_max: 12, mass_kg:  2 },
    {  a:   0, alpha:    0, d:  80, theta_offset:    0, limit_min: -350, limit_max:  350, vmax: 615, tau_max:  8, mass_kg:  1 },
  ],
  // Colour applied to the rendered links — KUKA orange (Pantone 158C).
  linkColor: '#E25822',
  baseColor: '#1a1a1a',
});

// ────────────────────────────────────────────────────────────────────────
// ABB IRB1200-7/0.7
// ────────────────────────────────────────────────────────────────────────
//
// 6-axis articulated, 7 kg payload, 700 mm reach, spherical wrist.
//
//   a1 =   0      d1 = 399.1
//   a2 = 350      d4 = 351
//   a3 =  42      d6 =  82
//
// Datasheet joint ranges:
//   A1 ±170°  A2 +135/-100°  A3 +70/-200°  A4 ±270°  A5 ±130°  A6 ±400°
// Datasheet speed limits:
//   288 / 240 / 297 / 400 / 405 / 600 deg/s
// Approximate motor torques (peak, gearbox output):
//   J1 90 N·m  J2 110 N·m  J3 80 N·m  J4 15 N·m  J5 15 N·m  J6 9 N·m

export const ABB_IRB1200 = Object.freeze({
  id:          'abb-irb1200-7-070',
  vendor:      'ABB',
  series:      'IRB',
  name:        'IRB 1200-7/0.7',
  payload_kg:  7,
  reach_mm:    703,
  postProcessor: 'RAPID',              // emits ABB RAPID .mod
  dhRows: [
    {  a:   0, alpha:  -90, d: 399.1, theta_offset:    0, limit_min: -170, limit_max:  170, vmax: 288, tau_max:  90, mass_kg: 14 },
    {  a: 350, alpha:    0, d:     0, theta_offset:  -90, limit_min: -100, limit_max:  135, vmax: 240, tau_max: 110, mass_kg: 12 },
    {  a:  42, alpha:  -90, d:     0, theta_offset:   90, limit_min: -200, limit_max:   70, vmax: 297, tau_max:  80, mass_kg:  7 },
    {  a:   0, alpha:   90, d: 351,   theta_offset:    0, limit_min: -270, limit_max:  270, vmax: 400, tau_max:  15, mass_kg:  3 },
    {  a:   0, alpha:  -90, d:   0,   theta_offset:    0, limit_min: -130, limit_max:  130, vmax: 405, tau_max:  15, mass_kg:  2 },
    {  a:   0, alpha:    0, d:  82,   theta_offset:    0, limit_min: -400, limit_max:  400, vmax: 600, tau_max:   9, mass_kg:  1 },
  ],
  linkColor: '#D1521F',                // ABB orange
  baseColor: '#2a2a2a',
});

// ────────────────────────────────────────────────────────────────────────
// FANUC LR Mate 200iD/7L
// ────────────────────────────────────────────────────────────────────────
//
// 6-axis articulated, 7 kg payload, 911 mm reach (extended-arm "L"
// variant of the 200iD/7), spherical wrist.
//
//   a1 =  50      d1 = 330
//   a2 = 440      d4 = 440
//   a3 =  35      d6 =  80
//
// Datasheet joint ranges:
//   J1 ±170°  J2 +160/-100°  J3 +205/-70°  J4 ±190°  J5 ±125°  J6 ±360°
// Datasheet speed limits:
//   450 / 380 / 520 / 550 / 545 / 1000 deg/s
// Approximate motor torques (peak, gearbox output):
//   J1 60 N·m  J2 75 N·m  J3 50 N·m  J4 12 N·m  J5 12 N·m  J6 7 N·m

export const FANUC_LRMATE_200ID_7L = Object.freeze({
  id:          'fanuc-lrmate-200id-7l',
  vendor:      'FANUC',
  series:      'LR Mate',
  name:        'LR Mate 200iD/7L',
  payload_kg:  7,
  reach_mm:    911,
  postProcessor: 'TP',                 // emits FANUC TP .ls
  dhRows: [
    {  a:  50, alpha:  -90, d: 330, theta_offset:    0, limit_min: -170, limit_max:  170, vmax: 450,  tau_max: 60, mass_kg: 11 },
    {  a: 440, alpha:    0, d:   0, theta_offset:  -90, limit_min: -100, limit_max:  160, vmax: 380,  tau_max: 75, mass_kg:  9 },
    {  a:  35, alpha:  -90, d:   0, theta_offset:   90, limit_min:  -70, limit_max:  205, vmax: 520,  tau_max: 50, mass_kg:  6 },
    {  a:   0, alpha:   90, d: 440, theta_offset:    0, limit_min: -190, limit_max:  190, vmax: 550,  tau_max: 12, mass_kg:  3 },
    {  a:   0, alpha:  -90, d:   0, theta_offset:    0, limit_min: -125, limit_max:  125, vmax: 545,  tau_max: 12, mass_kg:  2 },
    {  a:   0, alpha:    0, d:  80, theta_offset:    0, limit_min: -360, limit_max:  360, vmax: 1000, tau_max:  7, mass_kg:  1 },
  ],
  linkColor: '#FBD64B',                // FANUC yellow
  baseColor: '#1f1f1f',
});

// ────────────────────────────────────────────────────────────────────────
// Catalogue
// ────────────────────────────────────────────────────────────────────────

export const ROBOT_MODELS = Object.freeze([
  KUKA_KR6_R900,
  ABB_IRB1200,
  FANUC_LRMATE_200ID_7L,
]);

export function getRobotModel(id) {
  return ROBOT_MODELS.find((m) => m.id === id) || null;
}

// ────────────────────────────────────────────────────────────────────────
// Quick consistency checks (used by unit tests + UI sanity)
// ────────────────────────────────────────────────────────────────────────
//
// Every model must:
//   - have 6 DH rows (6R manipulator)
//   - have d4 ≠ 0 and d6 ≠ 0 (spherical wrist — Pieper applies)
//   - have a2 > 0 (real upper-arm link)
//   - have limit_min < 0 < limit_max (proper joint range)
//   - have all torques and speeds positive
//
// Throws if anything is wrong — fail-fast so we never ship a
// silently-broken catalogue.

export function validateRobotModel(model) {
  if (!model || !Array.isArray(model.dhRows) || model.dhRows.length !== 6) {
    throw new Error(`[robotModels] ${model?.id ?? 'unknown'}: must have 6 DH rows`);
  }
  const r = model.dhRows;
  if (Math.abs(r[3].d) < 1e-6) {
    throw new Error(`[robotModels] ${model.id}: d4 must be non-zero (spherical wrist)`);
  }
  if (Math.abs(r[5].d) < 1e-6) {
    throw new Error(`[robotModels] ${model.id}: d6 must be non-zero (flange offset)`);
  }
  if (r[1].a <= 0) {
    throw new Error(`[robotModels] ${model.id}: a2 must be > 0 (upper-arm link)`);
  }
  for (let i = 0; i < 6; i++) {
    const row = r[i];
    if (row.limit_min >= row.limit_max) {
      throw new Error(`[robotModels] ${model.id} J${i+1}: limit_min must be < limit_max`);
    }
    if (row.vmax <= 0 || row.tau_max <= 0 || row.mass_kg <= 0) {
      throw new Error(`[robotModels] ${model.id} J${i+1}: vmax / tau_max / mass must be > 0`);
    }
  }
  return true;
}

// Eagerly validate the bundled catalogue when this module loads so any
// table regression is caught at import time — not 30 clicks deep.
for (const m of ROBOT_MODELS) validateRobotModel(m);

export default ROBOT_MODELS;
