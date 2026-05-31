/**
 * ArchDisc — CNC Tool Library
 *
 * Parametric definitions for cutting tools used in CAM operations.
 * Each tool has geometry (for collision/preview) and cutting parameters
 * (recommended speeds/feeds based on material).
 */

const TOOL_TYPES = {
  endmill_flat: {
    name: 'Flat Endmill',
    description: 'Square end, ideal for pocketing and contouring',
    flutes: [2, 3, 4],
    minDiameter: 0.0005,  // 0.5mm
    maxDiameter: 0.025,   // 25mm
    cornerRadius: 0,
  },
  endmill_ball: {
    name: 'Ball Nose Endmill',
    description: '3D contouring, surface finishing',
    flutes: [2, 4],
    minDiameter: 0.001,
    maxDiameter: 0.020,
    cornerRadius: null, // = diameter / 2
  },
  endmill_corner: {
    name: 'Corner Radius Endmill',
    description: 'Bottom contour with rounded corners',
    flutes: [2, 4],
    minDiameter: 0.003,
    maxDiameter: 0.020,
    cornerRadius: 0.001, // 1mm default
  },
  drill_twist: {
    name: 'Twist Drill',
    description: 'Hole drilling',
    flutes: [2],
    minDiameter: 0.0005,
    maxDiameter: 0.025,
    pointAngle: 118, // degrees
  },
  drill_spot: {
    name: 'Spot Drill',
    description: 'Center drilling, chamfering',
    flutes: [2],
    minDiameter: 0.002,
    maxDiameter: 0.012,
    pointAngle: 90,
  },
  threadmill: {
    name: 'Thread Mill',
    description: 'Internal/external threading',
    flutes: [2, 3],
    minDiameter: 0.002,
    maxDiameter: 0.025,
    pitch: 0.001,
  },
  facemill: {
    name: 'Face Mill',
    description: 'High-volume face milling',
    flutes: [3, 4, 5, 6],
    minDiameter: 0.025,
    maxDiameter: 0.100,
    cornerRadius: 0.0008,
  },
  chamfer: {
    name: 'Chamfer Mill',
    description: 'Edge breaks, V-bevels',
    flutes: [2, 3, 4],
    minDiameter: 0.003,
    maxDiameter: 0.020,
    angle: 45, // degrees
  },
};

// Material → cutting parameters (SFM, IPM, depth of cut multipliers)
const MATERIAL_PARAMS = {
  'Aluminum 6061-T6': {
    surfaceSpeed: 1500,    // SFM (surface feet per minute)
    chipLoad: 0.0001,      // m per tooth at 6mm dia
    depthMultiplier: 1.0,  // x diameter
    coolant: 'flood',
  },
  'Steel AISI 1020': {
    surfaceSpeed: 350,
    chipLoad: 0.00006,
    depthMultiplier: 0.5,
    coolant: 'flood',
  },
  'Steel AISI 4340': {
    surfaceSpeed: 250,
    chipLoad: 0.00005,
    depthMultiplier: 0.3,
    coolant: 'flood',
  },
  'Stainless Steel 316': {
    surfaceSpeed: 200,
    chipLoad: 0.00004,
    depthMultiplier: 0.3,
    coolant: 'flood',
  },
  'Titanium Ti-6Al-4V': {
    surfaceSpeed: 100,
    chipLoad: 0.00003,
    depthMultiplier: 0.2,
    coolant: 'flood',
  },
  'Cast Iron': {
    surfaceSpeed: 600,
    chipLoad: 0.00007,
    depthMultiplier: 0.7,
    coolant: 'air',
  },
  'ABS Plastic': {
    surfaceSpeed: 2500,
    chipLoad: 0.00015,
    depthMultiplier: 1.5,
    coolant: 'air',
  },
  'Carbon Fiber Composite': {
    surfaceSpeed: 800,
    chipLoad: 0.00008,
    depthMultiplier: 0.5,
    coolant: 'vacuum',
  },
};

export { TOOL_TYPES, MATERIAL_PARAMS };

export default class ToolLibrary {

  /**
   * Create a tool definition with geometry and cutting params.
   * @param {string} type - one of TOOL_TYPES keys
   * @param {number} diameter - in meters
   * @param {number} length - in meters (overall length)
   * @param {number} flutes - flute count (2/3/4/etc)
   * @returns {object} tool spec
   */
  static createTool(type, diameter, length = null, flutes = 2) {
    const spec = TOOL_TYPES[type];
    if (!spec) throw new Error(`Unknown tool type: ${type}`);

    const dia = Math.max(spec.minDiameter, Math.min(spec.maxDiameter, diameter));
    const len = length || dia * 4;

    return {
      type,
      typeName: spec.name,
      diameter: dia,
      diameterMm: (dia * 1000).toFixed(3),
      length: len,
      lengthMm: (len * 1000).toFixed(2),
      flutes: spec.flutes.includes(flutes) ? flutes : spec.flutes[0],
      cornerRadius: spec.cornerRadius === null ? dia / 2 : spec.cornerRadius,
      pointAngle: spec.pointAngle || null,
      pitch: spec.pitch || null,
      angle: spec.angle || null,
    };
  }

  /**
   * Compute recommended speeds and feeds for a tool + material combo.
   * @returns {{ rpm, feedRate, plungeFeed, depthOfCut, stepover }}
   */
  static recommendSpeedsFeeds(tool, materialName) {
    const mat = MATERIAL_PARAMS[materialName] || MATERIAL_PARAMS['Aluminum 6061-T6'];

    // SFM → RPM: RPM = SFM × 12 / (π × dia_inches)
    const diaInches = tool.diameter * 39.3701;
    const rpm = Math.min(40000, Math.max(500,
      (mat.surfaceSpeed * 12) / (Math.PI * diaInches)
    ));

    // Feed rate: chipLoad × flutes × RPM × 1000 mm/min
    const feedRate = Math.round(mat.chipLoad * 1000 * tool.flutes * rpm);

    // Depth of cut: typically 0.3-1.0 × diameter (material-dependent)
    const depthOfCut = tool.diameter * mat.depthMultiplier;

    // Stepover: 30-50% of diameter
    const stepover = tool.diameter * 0.4;

    // Plunge: 30% of feed
    const plungeFeed = Math.round(feedRate * 0.3);

    return {
      rpm: Math.round(rpm),
      feedRate,
      plungeFeed,
      depthOfCut,
      depthOfCutMm: (depthOfCut * 1000).toFixed(3),
      stepover,
      stepoverMm: (stepover * 1000).toFixed(3),
      coolant: mat.coolant,
      material: materialName,
    };
  }

  /**
   * Get all available tool types.
   */
  static availableTypes() {
    return Object.keys(TOOL_TYPES);
  }

  /**
   * Get all available materials.
   */
  static availableMaterials() {
    return Object.keys(MATERIAL_PARAMS);
  }
}
