/**
 * ArchDisc — Process Specs Library
 *
 * Standard manufacturing/quality process callouts. Each spec provides
 * a drawing callout block (`callout` string) + the underlying standard
 * reference. Used by ProductionDrawing._processStrip and per-part QAQC
 * package.
 *
 * Coverage:
 *   - Heat treat (AMS 2750E pyrometry; alloy-specific heat-treat callouts)
 *   - Surface finish (Ra/Rz per ASME B46.1)
 *   - NDT methods (UT, FPI, RT, MT) per ASTM E1417/E1444
 *   - Welding (AWS D17.1, ASME IX)
 *   - Brazing (AWS C3.6)
 *   - Additive (AMS 7000-series)
 *   - Coatings (TBC, anodize, plasma-spray)
 *   - Surface treatments (shot-peen, glass-bead, vapor-honing)
 */

const HEAT_TREAT = {
  'AMS-H-6875': { name: 'Steel — quench & temper', callout: 'HT per AMS-H-6875, Q&T to HRC 35-40' },
  'AMS-2759/3': { name: 'PH stainless H1025 / H1075', callout: 'HT per AMS 2759/3, age to specified condition' },
  'AMS-2774': { name: 'Nickel superalloy solution + age', callout: 'HT per AMS 2774, solution + double age' },
  'AMS-H-81200': { name: 'Titanium beta annealing', callout: 'HT per AMS-H-81200, annealed' },
  'NONE': { name: 'No heat treatment', callout: 'Material as-received condition' },
};

const SURFACE_FINISH = {
  'Ra-0.4': { Ra_um: 0.4, callout: 'Ra ≤ 0.4 μm (16 μin)', method: 'fine grind / lap' },
  'Ra-0.8': { Ra_um: 0.8, callout: 'Ra ≤ 0.8 μm (32 μin)', method: 'grind' },
  'Ra-1.6': { Ra_um: 1.6, callout: 'Ra ≤ 1.6 μm (63 μin)', method: 'fine machining' },
  'Ra-3.2': { Ra_um: 3.2, callout: 'Ra ≤ 3.2 μm (125 μin)', method: 'standard machining' },
  'Ra-6.3': { Ra_um: 6.3, callout: 'Ra ≤ 6.3 μm (250 μin)', method: 'rough machining' },
  'Ra-12.5': { Ra_um: 12.5, callout: 'Ra ≤ 12.5 μm (500 μin)', method: 'as-cast / as-forged' },
};

const NDT = {
  'FPI-A': { name: 'Fluorescent Penetrant Inspection — sensitivity Type I Method A', spec: 'ASTM E1417 / AMS 2647', callout: 'FPI per ASTM E1417 Type I Method A, accept per Section X' },
  'UT': { name: 'Ultrasonic Inspection', spec: 'AMS 2154 / ASTM E2375', callout: 'UT per AMS 2154 Class A, no FBH > Ø2.5mm' },
  'RT': { name: 'Radiographic Inspection', spec: 'ASTM E1742', callout: 'RT per ASTM E1742, accept per ASME B16.34 Severe' },
  'MT': { name: 'Magnetic Particle', spec: 'ASTM E1444', callout: 'MT per ASTM E1444 wet fluorescent' },
  'CT': { name: 'Computed Tomography', spec: 'ASTM E1570', callout: 'CT per ASTM E1570 voxel ≤ 0.05mm' },
};

const WELDING = {
  'AWS-D17.1-A': { spec: 'AWS D17.1 Class A', callout: 'Weld per AWS D17.1 Class A, GTAW' },
  'ASME-IX': { spec: 'ASME Section IX', callout: 'Weld per WPS-001 to ASME IX' },
};

const COATINGS = {
  'TBC-YSZ-250': { name: 'Yttria-stabilized zirconia TBC, 250µm', spec: 'AMS 4955', callout: 'TBC per AMS 4955, 250µm ± 25µm' },
  'PtAl-bondcoat': { name: 'Platinum-aluminide bond coat', spec: 'GE9X/M&PE proprietary', callout: 'Pt-Al bond coat 75µm ± 10µm prior to TBC' },
  'Anodize-Type-II': { name: 'Sulfuric anodize Type II', spec: 'MIL-A-8625 Type II Class 1', callout: 'Anodize per MIL-A-8625 Type II Class 1, 5-25 µm' },
  'PlasmaSpray-WC': { name: 'Tungsten carbide plasma spray', spec: 'AMS 2447', callout: 'WC plasma spray per AMS 2447' },
  'Cad-plate': { name: 'Cadmium plate', spec: 'AMS-QQ-P-416', callout: 'Cadmium plate per AMS-QQ-P-416 Type II Class 2 (0.013mm)' },
};

const SURFACE_TREATMENT = {
  'ShotPeen-A': { name: 'Shot peen Almen A', spec: 'AMS 2430', callout: 'Shot peen per AMS 2430, intensity 0.008-0.012A, 200% coverage' },
  'GlassBead': { name: 'Glass bead blast', spec: 'AMS 2431', callout: 'Glass bead per AMS 2431, MIL-G-9954 #16' },
  'Burnish': { name: 'Roller burnish', spec: 'in-house', callout: 'Roller burnish to Ra ≤ 0.4 µm at indicated surfaces' },
  'PassivateSS': { name: 'Stainless passivation', spec: 'AMS 2700', callout: 'Passivate per AMS 2700 nitric Type II Method 1' },
};

const ADDITIVE = {
  'AMS-7003': { name: 'Powder Bed Fusion (LPBF) titanium', spec: 'AMS 7003 / 7004', callout: 'LPBF Ti-6Al-4V per AMS 7003, HIP per AMS 2774' },
  'AMS-7012': { name: 'PBF nickel-base superalloy', spec: 'AMS 7012', callout: 'LPBF Inconel 718 per AMS 7012, solution + age' },
};

export default class ProcessSpecs {

  static heatTreat(key) { return HEAT_TREAT[key] || HEAT_TREAT.NONE; }
  static surfaceFinish(key) { return SURFACE_FINISH[key] || SURFACE_FINISH['Ra-3.2']; }
  static ndt(key) { return NDT[key] || null; }
  static welding(key) { return WELDING[key] || null; }
  static coating(key) { return COATINGS[key] || null; }
  static surfaceTreatment(key) { return SURFACE_TREATMENT[key] || null; }
  static additive(key) { return ADDITIVE[key] || null; }

  /** Suggest typical process specs for a part based on category/material. */
  static suggestForPart({ category, subsystem, material }) {
    const out = { heatTreat: null, surfaceFinish: null, ndt: null, coating: null, surfaceTreatment: null };

    // Heat treat by material
    if (material?.includes('Inconel')) out.heatTreat = ProcessSpecs.heatTreat('AMS-2774');
    else if (material?.includes('CMSX')) out.heatTreat = ProcessSpecs.heatTreat('AMS-2774');
    else if (material?.includes('Titanium')) out.heatTreat = ProcessSpecs.heatTreat('AMS-H-81200');
    else if (material?.includes('Steel')) out.heatTreat = ProcessSpecs.heatTreat('AMS-H-6875');

    // Surface finish by category — blades need fine, casings standard
    if (subsystem === 'BLD' || subsystem === 'NGV') out.surfaceFinish = ProcessSpecs.surfaceFinish('Ra-0.8');
    else if (subsystem === 'DSK' || subsystem === 'CSG') out.surfaceFinish = ProcessSpecs.surfaceFinish('Ra-1.6');
    else if (subsystem === 'BLT' || subsystem === 'NUT') out.surfaceFinish = ProcessSpecs.surfaceFinish('Ra-3.2');
    else out.surfaceFinish = ProcessSpecs.surfaceFinish('Ra-3.2');

    // NDT by class — Class 1 LLP gets full inspection
    if (subsystem === 'BLD' || subsystem === 'DSK' || subsystem === 'NGV') {
      out.ndt = ProcessSpecs.ndt('FPI-A');
    } else if (subsystem === 'CSG' || subsystem === 'LIN') {
      out.ndt = ProcessSpecs.ndt('UT');
    }

    // Coating — turbine blades get TBC
    if (category === 'HPT' && subsystem === 'BLD') {
      out.coating = ProcessSpecs.coating('TBC-YSZ-250');
    }

    // Shot peen on critical structural parts
    if (subsystem === 'DSK' || (category === 'FAN' && subsystem === 'BLD')) {
      out.surfaceTreatment = ProcessSpecs.surfaceTreatment('ShotPeen-A');
    }

    return out;
  }

  /** Format a process callout strip for drawing. */
  static toCallouts(specs) {
    return [
      specs.heatTreat?.callout || 'No heat treatment',
      specs.surfaceFinish?.callout || 'Ra ≤ 3.2 μm',
      specs.ndt?.callout || 'Visual only',
      specs.coating?.callout || 'No coating',
    ];
  }
}
