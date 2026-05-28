/**
 * ArchDisc Kernel — Automotive reference catalog (Volvo FH-series).
 *
 * Pure-data dimensions for the Video-21 parity reference (Volvo FH
 * tractor truck) — SP-2 front fascia. Every leaf maps to a Spacecraft-
 * style atomic-CAD builder; placements are recorded as feature history
 * on the Part.
 *
 * All dims in millimetres. Cab is ~2500 mm wide × ~3500 mm tall;
 * the fascia panel sits at ~1300 mm above the ground.
 */

export const VOLVO_FH = {
  // Slim header strip at the very top of the fascia (the area where
  // the upper running lights / clearance lamps live). The earlier
  // 1600 mm full-cab panel dominated everything and hid the grille
  // and bumper; the realistic Volvo FH fascia is a STACK of sections,
  // so the "cab front panel" is reduced to a header bar.
  'Cab Front Panel': {
    width_mm: 2500,
    height_mm: 220,
    thickness_mm: 8,
  },
  // Main radiator grille — perforated steel honeycomb between the
  // bumper and the upper light bar. The builder lays out an N×M
  // hex-perforation pattern and cuts each hole through the panel.
  'Radiator Grille Panel': {
    width_mm: 1500,
    height_mm: 500,
    thickness_mm: 6,
    holeRadius_mm: 9,
    holeSpacingX_mm: 22,
    holeSpacingY_mm: 22,
    holeCols: 60,
    holeRows: 20,
  },
  // Lower air-intake slats — a rectangular slot pattern.
  'Lower Intake Slat Bank': {
    width_mm: 1500,
    height_mm: 220,
    thickness_mm: 4,
    slatWidth_mm: 80,
    slatHeight_mm: 22,
    slatGapX_mm: 14,
    slatGapY_mm: 16,
    slatCols: 14,
    slatRows: 5,
  },
  // Bumper main section — full-width trim across the front.
  'Bumper Main Section': {
    width_mm: 2500,
    height_mm: 280,
    depth_mm: 220,
  },
  'Bumper Lower Trim': {
    width_mm: 2400,
    height_mm: 80,
    depth_mm: 60,
  },
  'Bumper Side Cap': {
    width_mm: 320,
    height_mm: 460,
    depth_mm: 240,
  },
  // Headlight cluster — outer projector + DRL strip.
  'Headlight Cluster': {
    width_mm: 380,
    height_mm: 220,
    depth_mm: 160,
    lensRadius_mm: 70,
  },
  // VOLVO embossed logo — block letters across the front panel.
  // Letters are 200 mm tall, 8 mm raised relief.
  'VOLVO Logo Emboss': {
    letterHeight_mm: 200,
    letterWidth_mm: 140,
    letterSpacing_mm: 30,
    reliefDepth_mm: 8,
    strokeWidth_mm: 30,
  },
  // "L" license badge — round disc with the L glyph raised on top.
  'L Badge': {
    discRadius_mm: 70,
    discThickness_mm: 6,
    reliefDepth_mm: 4,
    strokeWidth_mm: 18,
  },
  // Step plate at the very bottom of the cab front.
  'Cab Front Step Plate': {
    width_mm: 1800,
    depth_mm: 220,
    thickness_mm: 6,
  },
  // Vertical louvers between the grille and headlights.
  'Headlight Surround Louver': {
    height_mm: 240,
    width_mm: 14,
    depth_mm: 28,
  },
  // Front step ladder treads for cab access.
  'Cab Step Tread': {
    width_mm: 280,
    depth_mm: 80,
    thickness_mm: 6,
  },
  // Tow-hook mount (visible at the bottom centre of the bumper).
  'Tow Hook Mount': {
    width_mm: 180,
    height_mm: 90,
    depth_mm: 60,
  },
  // ── Round-2 additions for richer Video-21 parity ──
  'Cab Side Pillar': {
    // Vertical pillar between cab front + cab side (the A-pillar
    // equivalent at the fascia edge).
    width_mm: 60,
    height_mm: 1400,
    depth_mm: 90,
  },
  'Orange Accent Trim': {
    // Thin horizontal accent strip across the upper fascia (matches
    // the Volvo FH visible bright accent above the headlights).
    width_mm: 2400,
    height_mm: 24,
    depth_mm: 12,
  },
  'License Plate Frame': {
    width_mm: 540,
    height_mm: 120,
    thickness_mm: 8,
  },
  'License Plate Panel': {
    width_mm: 520,
    height_mm: 110,
    thickness_mm: 2,
  },
  'Fog Light Cluster': {
    width_mm: 240,
    height_mm: 110,
    depth_mm: 110,
    lensRadius_mm: 40,
  },
  'Wing Mirror Housing': {
    // Organic curved housing — built via revolve of a 6-point profile
    // around the Y axis (then rotated to mount on the side).
    bodyRadius_mm: 75,
    bodyHeight_mm: 230,
    stalkRadius_mm: 18,
    stalkLength_mm: 200,
  },
  'Roof Sun Visor': {
    width_mm: 2400,
    height_mm: 320,
    thickness_mm: 16,
  },
  'Mud Flap': {
    width_mm: 320,
    height_mm: 280,
    thickness_mm: 6,
  },
  'Lower Side Skirt': {
    width_mm: 220,
    height_mm: 280,
    depth_mm: 60,
  },
  'Door Handle Recess': {
    width_mm: 140,
    height_mm: 38,
    depth_mm: 14,
  },
  'Roof Beacon Bar': {
    width_mm: 1200,
    height_mm: 50,
    depth_mm: 80,
  },
  // ── SP-3 round 1 — cab body ──
  // Cab is ~2500 mm wide × 2400 mm tall × 2200 mm deep (from fascia
  // backplate to cab rear wall). All panels are flat slabs that get
  // positioned + rotated into the cab box.
  'Cab Side Panel': {
    width_mm: 2200,
    height_mm: 2400,
    thickness_mm: 60,   // v10 — was 10mm, interior bleed-through visible
  },
  'Cab Rear Panel': {
    width_mm: 2500,
    height_mm: 2400,
    thickness_mm: 60,   // v10 — match side wall thickness
  },
  'Cab Roof Panel': {
    width_mm: 2500,
    depth_mm: 2200,
    thickness_mm: 12,
  },
  'Cab Floor Panel': {
    width_mm: 2500,
    depth_mm: 2200,
    thickness_mm: 8,
  },
  'Windshield': {
    width_mm: 2300,
    height_mm: 1100,
    thickness_mm: 8,
  },
  'Side Window': {
    width_mm: 800,
    height_mm: 700,
    thickness_mm: 6,
  },
  'Cab Door': {
    width_mm: 1100,
    height_mm: 1800,
    thickness_mm: 60,
  },
  'Roof Air Deflector': {
    // Aero spoiler bolted to the top of the cab roof — sloped forward.
    width_mm: 2400,
    height_mm: 350,
    depth_mm: 800,
  },
  'A Pillar': {
    width_mm: 110,
    height_mm: 1800,
    depth_mm: 110,
  },
  'B Pillar': {
    width_mm: 110,
    height_mm: 2000,
    depth_mm: 110,
  },
  'Wheel Arch Cover': {
    // Curved cover over the wheel — built as a thick partial-revolve
    // (half-cylinder cap).
    outerRadius_mm: 600,
    thickness_mm: 40,
    width_mm: 380,
  },
  'Roof Marker Light': {
    width_mm: 80,
    height_mm: 60,
    depth_mm: 35,
  },
  'Exhaust Stack': {
    radius_mm: 90,
    height_mm: 2400,
  },
  // ── SP-4 chassis (frame + suspension + wheels + powertrain) ──
  'Frame Rail': {
    // C-section longitudinal frame rail (truck spine).
    flangeWidth_mm: 90,
    webHeight_mm:   280,
    thickness_mm:   8,
    length_mm:    7800,    // tractor wheelbase + overhangs
  },
  'Frame Cross Member': {
    width_mm:    700,
    height_mm:   180,
    depth_mm:    100,
  },
  'Fuel Tank': {
    radius_mm:    340,
    length_mm:   1400,
  },
  'Axle Beam': {
    radius_mm:    100,
    length_mm:   2300,
  },
  'Wheel Rim': {
    radius_mm:    280,
    width_mm:     220,
  },
  'Tire': {
    outerRadius_mm: 525,
    innerRadius_mm: 280,
    width_mm:       260,
  },
  'Brake Drum': {
    radius_mm: 220,
    width_mm:  140,
  },
  'Drive Shaft': {
    radius_mm:   55,
    length_mm:  2600,
  },
  'Differential Housing': {
    radius_mm:  220,
    width_mm:   320,
  },
  'Suspension Leaf Spring': {
    width_mm:    100,
    length_mm:  1400,
    thickness_mm: 14,
  },
  'Shock Absorber': {
    radius_mm:  40,
    length_mm: 520,
  },
  'Air Suspension Bellows': {
    outerRadius_mm: 130,
    height_mm:      280,
  },
  'Battery Box': {
    width_mm: 700,
    height_mm: 360,
    depth_mm: 540,
  },
  'Air Compressor Tank': {
    radius_mm: 180,
    length_mm: 880,
  },
  'Engine Block': {
    width_mm: 980,
    height_mm: 1100,
    depth_mm: 1400,
  },
  'Cylinder Head': {
    width_mm: 880,
    height_mm: 280,
    depth_mm: 1380,
  },
  'Turbocharger Housing': {
    bodyRadius_mm: 220,
    bodyHeight_mm: 380,
  },
  'Intake Manifold': {
    width_mm:  680,
    height_mm: 240,
    depth_mm:  1200,
  },
  'Exhaust Manifold': {
    width_mm:  680,
    height_mm: 240,
    depth_mm:  1200,
  },
  'Radiator Module': {
    width_mm:  1200,
    height_mm: 880,
    depth_mm:   80,
  },
  'Cooling Fan': {
    bladeRadius_mm: 380,
    hubRadius_mm:    70,
    bladeCount:      12,
  },
  // ── SP-5 cab interior ──
  'Driver Seat Base': {
    width_mm:  600,
    depth_mm:  580,
    height_mm: 100,
  },
  'Driver Seat Back': {
    width_mm:  600,
    depth_mm: 100,
    height_mm: 780,
  },
  'Seat Headrest': {
    width_mm: 280,
    depth_mm: 140,
    height_mm: 220,
  },
  'Steering Wheel Rim': {
    outerRadius_mm: 240,
    innerRadius_mm: 215,
    width_mm:       40,
  },
  'Steering Wheel Boss': {
    radius_mm: 80,
    height_mm: 60,
  },
  'Steering Wheel Spoke': {
    width_mm:  180,
    height_mm:  30,
    depth_mm:   24,
  },
  'Steering Column': {
    radius_mm:  55,
    length_mm: 360,
  },
  'Dashboard': {
    width_mm:  2200,
    height_mm: 360,
    depth_mm:  420,
  },
  'Instrument Cluster': {
    width_mm:  580,
    height_mm: 220,
    depth_mm:  60,
  },
  'Gear Shifter': {
    radius_mm:  18,
    length_mm: 240,
    knobRadius_mm: 45,
  },
  'Foot Pedal': {
    width_mm:  100,
    depth_mm:  220,
    thickness_mm: 14,
  },
  'AC Vent': {
    width_mm: 220,
    height_mm: 90,
    depth_mm: 90,
  },
  'Door Card': {
    width_mm:  1100,
    height_mm: 1100,
    thickness_mm: 35,
  },
  'Sun Visor Interior': {
    width_mm:  680,
    height_mm: 220,
    thickness_mm: 18,
  },
  'Centre Console': {
    width_mm: 300,
    depth_mm: 540,
    height_mm: 240,
  },
  'Cup Holder': {
    outerRadius_mm: 50,
    innerRadius_mm: 38,
    depth_mm:      60,
  },
  'Sleeper Bunk': {
    width_mm:  2200,
    depth_mm:  900,
    height_mm: 180,
  },
  'Headliner': {
    width_mm:  2400,
    depth_mm:  1800,
    thickness_mm: 18,
  },
  // ── Round-3: Hood, sleeper, fenders, 5th wheel, air horn ──
  'Engine Hood': {
    // Covers the engine bay between fascia and cab front. Slightly
    // curved top would be ideal — currently a flat slab.
    width_mm:  2300,
    depth_mm:   700,
    thickness_mm: 8,
  },
  'Front Fender': {
    // Quarter-pipe shape over each front wheel. Built as half-annular
    // polyline-revolve.
    outerRadius_mm: 680,
    thickness_mm:   30,
    width_mm:      380,
  },
  'Sleeper Cab Extension': {
    // Box behind the driver's seat — extends the cab rearward into a
    // sleeper berth.
    width_mm:  2400,
    height_mm: 1800,
    depth_mm:  1000,
  },
  'Air Horn': {
    radius_mm:  55,
    length_mm: 600,
  },
  'Fifth Wheel Plate': {
    // Disc-shaped pivot plate at the rear of the tractor where the
    // semi-trailer king-pin engages.
    outerRadius_mm: 480,
    innerRadius_mm: 80,
    thickness_mm: 28,
  },
  'Trailer King-Pin Plate': {
    // Underside of the trailer that mates with the fifth wheel.
    width_mm:  900,
    depth_mm:  900,
    thickness_mm: 30,
  },
  'Trailer Body': {
    // Long box trailer.
    width_mm:  2500,
    height_mm: 2500,
    depth_mm:  10000,
    thickness_mm: 8,
  },
  'Trailer Floor': {
    width_mm: 2500,
    depth_mm: 10000,
    thickness_mm: 12,
  },
  'Trailer Roof': {
    width_mm: 2500,
    depth_mm: 10000,
    thickness_mm: 10,
  },
  'Trailer Side Panel': {
    width_mm: 10000,
    height_mm: 2500,
    thickness_mm: 10,
  },
  'Trailer Rear Door': {
    width_mm: 2500,
    height_mm: 2500,
    thickness_mm: 14,
  },
  'Mud Guard Rear': {
    width_mm: 320,
    height_mm: 380,
    thickness_mm: 6,
  },
  'Side Step Light': {
    width_mm: 90,
    height_mm: 35,
    depth_mm: 25,
  },
  'Aero Roof Fairing': {
    // Aerodynamic fairing over the roof toward the trailer.
    width_mm: 2400,
    height_mm: 250,
    depth_mm: 1500,
  },
};

export const VOLVO_FH_PARTS = Object.keys(VOLVO_FH);
