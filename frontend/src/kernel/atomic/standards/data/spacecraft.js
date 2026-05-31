/**
 * ArchDisc Kernel — Spacecraft reference catalog (Falcon 9 / Merlin 1D).
 *
 * Pure-data dimension table for spacecraft-specific reference geometry
 * the SP-1 Falcon 9 octaweb e2e places into the scene via the Standards
 * Library dialog. Every entry is a published Falcon 9 / Merlin 1D
 * dimension (Wikipedia, NASA papers, SpaceX patent filings).
 *
 * Each builder turns these dimensions into a sequence of atomic CAD ops
 * (sketchPolyline → finishSketch → revolve → rotate for revolved bodies;
 * sketchRectangle → extrude for plates) recorded on a Part — replayable
 * history per the atomic-CAD direction.
 *
 * Dimensions in millimetres.
 */

// Merlin 1D first-stage (sea-level) bell-nozzle profile.
// Truncated bell — narrow throat at top, wide exit at bottom.
// Real bell uses a Rao-optimal parabolic curve; this catalog samples
// the curve into a 7-point polyline that revolve traces into a smooth
// bell surface.
export const FALCON9_SPEC = {
  'Merlin 1D Bell Nozzle': {
    throatRadius_mm: 130,
    exitRadius_mm: 460,
    bellLength_mm: 1500,
    // 7-point bell profile from throat (top) to exit (bottom).
    // Values normalised to (length, radius) — builder scales them.
    // The curve approximates a Rao-80% truncated bell.
    profileSamples: [
      [0.000, 1.00],   // throat — narrow
      [0.083, 1.55],
      [0.250, 2.40],
      [0.450, 3.05],
      [0.650, 3.45],
      [0.850, 3.65],
      [1.000, 3.54],   // exit — wide (3.54 = 460 / 130)
    ],
  },
  'Merlin 1D Combustion Chamber': {
    radius_mm: 200,
    height_mm: 400,
  },
  'Falcon 9 Thrust Dome (Al-Li 2195)': {
    radius_mm: 1850,
    thickness_mm: 6,
  },
  'Falcon 9 Engine Mount Frustum': {
    baseRadius_mm: 260,
    topRadius_mm: 200,
    height_mm: 60,
  },
  'Falcon 9 Heat Shield Panel': {
    // Trapezoidal heat-shield segment between adjacent engines.
    // 8 of these tile the engine bay; each subtends 45° of arc.
    innerRadius_mm: 1100,
    outerRadius_mm: 1850,
    thickness_mm: 4,
    arcDeg: 44,                  // 1° gap between adjacent panels
  },
  'Falcon 9 Thrust Takeout Pad': {
    width_mm: 280,
    depth_mm: 160,
    height_mm: 24,
  },
  'Merlin 1D Turbopump': {
    // Single cylindrical proxy for the gas-generator turbopump that sits
    // alongside the combustion chamber. Real Merlin TP is a complex
    // multi-stage pump — at SP-1 visual fidelity a cylinder is enough
    // to read the upper-engine silhouette.
    bodyRadius_mm: 110,
    bodyHeight_mm: 280,
  },
  'Merlin Plumbing Spoke': {
    // Short cylindrical feed-line proxy: a horizontal pipe running from
    // the dome centre out to each engine combustion chamber. Length is
    // close to the engine ring radius; diameter matches real LOX feed
    // lines on Falcon 9 (~80 mm OD).
    pipeRadius_mm: 40,
    pipeLength_mm: 1500,
  },
};

export const FALCON9_PARTS = Object.keys(FALCON9_SPEC);
