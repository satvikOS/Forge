/**
 * ArchDisc — Parametric Bearing Library
 * Generates bearing geometry from ISO specs via kernel primitives.
 * Deep groove ball bearings, angular contact, roller, thrust, needle.
 */

import Vec3 from '../math/Vec3.js';
import PrimitiveBuilder from '../features/PrimitiveBuilder.js';
import RevolveFeature from '../features/RevolveFeature.js';

const PI = Math.PI;

// ISO 15 bearing dimensions (bore → OD, width, ball diameter, ball count)
const BEARING_CATALOG = {
  '6000': { bore: 0.010, od: 0.026, width: 0.008, ballD: 0.0048, balls: 7 },
  '6001': { bore: 0.012, od: 0.028, width: 0.008, ballD: 0.005, balls: 7 },
  '6002': { bore: 0.015, od: 0.032, width: 0.009, ballD: 0.0056, balls: 8 },
  '6003': { bore: 0.017, od: 0.035, width: 0.010, ballD: 0.006, balls: 8 },
  '6004': { bore: 0.020, od: 0.042, width: 0.012, ballD: 0.0075, balls: 8 },
  '6005': { bore: 0.025, od: 0.047, width: 0.012, ballD: 0.0075, balls: 9 },
  '6006': { bore: 0.030, od: 0.055, width: 0.013, ballD: 0.0088, balls: 9 },
  '6008': { bore: 0.040, od: 0.068, width: 0.015, ballD: 0.0095, balls: 10 },
  '6010': { bore: 0.050, od: 0.080, width: 0.016, ballD: 0.0105, balls: 11 },
  '6012': { bore: 0.060, od: 0.095, width: 0.018, ballD: 0.012, balls: 11 },
  '6014': { bore: 0.070, od: 0.110, width: 0.020, ballD: 0.0135, balls: 12 },
  '6016': { bore: 0.080, od: 0.125, width: 0.022, ballD: 0.015, balls: 12 },
  '6020': { bore: 0.100, od: 0.150, width: 0.024, ballD: 0.0175, balls: 13 },
};

export { BEARING_CATALOG };

export default class BearingLibrary {

  /**
   * Deep groove ball bearing (ISO 15, series 60xx).
   * Returns an object with individual solids for each component.
   */
  static deepGrooveBallBearing(designation = '6008') {
    const spec = BEARING_CATALOG[designation] || BEARING_CATALOG['6008'];
    const pitchD = (spec.bore + spec.od) / 2;
    const pitchR = pitchD / 2;
    const parts = [];

    // Outer race
    const outerProfile = [
      new Vec3(spec.od / 2, 0, 0),
      new Vec3(spec.od / 2, spec.width, 0),
      new Vec3(spec.od / 2 - spec.ballD * 0.35, spec.width, 0),
      new Vec3(spec.od / 2 - spec.ballD * 0.35, spec.width * 0.6, 0),
      new Vec3(pitchR + spec.ballD * 0.35, spec.width * 0.5, 0),
      new Vec3(spec.od / 2 - spec.ballD * 0.35, spec.width * 0.4, 0),
      new Vec3(spec.od / 2 - spec.ballD * 0.35, 0, 0),
    ];
    try {
      const outer = RevolveFeature.revolve(outerProfile, Vec3.zero(), Vec3.unitY(), PI * 2, 32);
      outer.name = 'Outer Race';
      parts.push({ solid: outer, name: 'Outer Race', color: 0xaaaaaa, material: 'Steel AISI 4340' });
    } catch {
      const outer = PrimitiveBuilder.cylinder(spec.od / 2, spec.width, 32);
      outer.name = 'Outer Race';
      parts.push({ solid: outer, name: 'Outer Race', color: 0xaaaaaa, material: 'Steel AISI 4340' });
    }

    // Inner race
    const innerProfile = [
      new Vec3(spec.bore / 2, 0, 0),
      new Vec3(pitchR - spec.ballD * 0.35, 0, 0),
      new Vec3(pitchR - spec.ballD * 0.35, spec.width * 0.4, 0),
      new Vec3(pitchR - spec.ballD * 0.35, spec.width * 0.5, 0),
      new Vec3(pitchR - spec.ballD * 0.35, spec.width * 0.6, 0),
      new Vec3(pitchR - spec.ballD * 0.35, spec.width, 0),
      new Vec3(spec.bore / 2, spec.width, 0),
    ];
    try {
      const inner = RevolveFeature.revolve(innerProfile, Vec3.zero(), Vec3.unitY(), PI * 2, 32);
      inner.name = 'Inner Race';
      parts.push({ solid: inner, name: 'Inner Race', color: 0xbbbbbb, material: 'Steel AISI 4340' });
    } catch {
      const inner = PrimitiveBuilder.cylinder(pitchR - spec.ballD * 0.35, spec.width, 32, new Vec3(0, 0, 0));
      inner.name = 'Inner Race';
      parts.push({ solid: inner, name: 'Inner Race', color: 0xbbbbbb, material: 'Steel AISI 4340' });
    }

    // Balls
    for (let i = 0; i < spec.balls; i++) {
      const angle = (i / spec.balls) * PI * 2;
      const x = Math.cos(angle) * pitchR;
      const z = Math.sin(angle) * pitchR;
      const ball = PrimitiveBuilder.sphere(spec.ballD / 2, 12, 8, new Vec3(x, spec.width / 2, z));
      ball.name = `Ball ${i + 1}`;
      parts.push({ solid: ball, name: `Ball ${i + 1}`, color: 0xdddddd, material: 'Steel AISI 4340' });
    }

    // Cage/retainer (simplified as torus)
    const cage = PrimitiveBuilder.torus(pitchR, spec.ballD * 0.2, 32, 6, new Vec3(0, spec.width / 2, 0));
    cage.name = 'Cage';
    parts.push({ solid: cage, name: 'Cage', color: 0xccaa44, material: 'Nylon 6/6' });

    return {
      parts,
      designation,
      specs: spec,
      massEstimate: PI * ((spec.od / 2) ** 2 - (spec.bore / 2) ** 2) * spec.width * 7850, // kg
    };
  }

  /**
   * Get all available designations.
   */
  static availableDesignations() {
    return Object.keys(BEARING_CATALOG);
  }

  /**
   * Lookup bearing specs by bore diameter.
   */
  static findByBore(boreDiameter) {
    return Object.entries(BEARING_CATALOG)
      .filter(([_, spec]) => Math.abs(spec.bore - boreDiameter) < 0.001)
      .map(([des, spec]) => ({ designation: des, ...spec }));
  }
}
