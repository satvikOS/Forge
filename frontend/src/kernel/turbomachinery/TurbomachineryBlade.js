/**
 * ArchDisc — Turbomachinery Blade Builder
 *
 * Creates a real twisted blade by lofting through multiple airfoil stations
 * along the radial span, with stagger angle that varies with radius.
 *
 * Used for: fan blades, compressor blades, turbine blades.
 *
 * Geometry:
 * - Hub radius (r_hub) → tip radius (r_tip)
 * - 5-9 airfoil stations stacked along span
 * - Each station has its own chord, twist, thickness, camber
 * - Lofted into a single solid via skinning
 *
 * Reference: Hill & Peterson "Mechanics and Thermodynamics of Propulsion"
 */

import Vec3 from '../math/Vec3.js';
import NACA from '../airfoil/NACA.js';
import LoftSweep from '../features/LoftSweep.js';

export default class TurbomachineryBlade {

  /**
   * Build a complete blade with realistic twist and taper.
   * @param {object} spec
   * @param {number} spec.rHub - hub radius (m)
   * @param {number} spec.rTip - tip radius (m)
   * @param {number} spec.rootChord - chord at hub (m)
   * @param {number} spec.tipChord - chord at tip (m)
   * @param {number} spec.rootCamberPct
   * @param {number} spec.tipCamberPct
   * @param {number} spec.rootThicknessPct
   * @param {number} spec.tipThicknessPct
   * @param {number} spec.rootStagger - stagger angle at hub (deg)
   * @param {number} spec.tipStagger - stagger angle at tip (deg)
   * @param {number} spec.numStations - number of airfoil cross-sections (5-9)
   * @param {string} spec.bladeType - 'fan' | 'compressor' | 'turbine'
   * @returns {object} { profiles: Vec3[][], spec, sectionTypes }
   */
  static build(spec) {
    const {
      rHub, rTip,
      rootChord, tipChord,
      rootCamberPct = 4, tipCamberPct = 2,
      rootThicknessPct = 12, tipThicknessPct = 6,
      rootStagger = 60, tipStagger = 30,
      numStations = 7,
      bladeType = 'compressor',
    } = spec;

    const profiles = [];
    for (let i = 0; i < numStations; i++) {
      const t = i / (numStations - 1);  // 0 = hub, 1 = tip
      const r = rHub + t * (rTip - rHub);
      const chord = rootChord + t * (tipChord - rootChord);
      const camber = rootCamberPct + t * (tipCamberPct - rootCamberPct);
      const thickness = rootThicknessPct + t * (tipThicknessPct - rootThicknessPct);
      const stagger = rootStagger + t * (tipStagger - rootStagger);

      // Generate 2D airfoil profile. Higher resolution (100 points) for
      // fan blades which are large and viewed at any zoom level.
      let pts2D;
      const resolution = bladeType === 'fan' ? 100 : 60;
      if (bladeType === 'turbine') {
        pts2D = NACA.turbineAirfoil(camber, thickness, chord, resolution);
      } else if (bladeType === 'fan') {
        const c = Math.max(0, Math.min(9, Math.round(camber)));
        const t = Math.max(1, Math.min(99, Math.round(thickness)));
        pts2D = NACA.fourDigit(`${c}5${t.toString().padStart(2, '0')}`, chord, resolution);
      } else {
        pts2D = NACA.compressorAirfoil(camber, thickness, chord, resolution);
      }

      // Place at radius r along Y axis (blade extends in Y, airfoil in XZ)
      const profile3D = NACA.to3D(pts2D, {
        planeNormal: new Vec3(0, 1, 0),
        origin: new Vec3(-chord / 2, r, 0), // center chord on Y axis at radius
        staggerDeg: stagger,
      });
      profiles.push(profile3D);
    }

    return {
      profiles,
      spec,
      sectionType: bladeType,
      stations: numStations,
    };
  }

  /**
   * Build a fan blade — wide chord, low aspect ratio, high twist.
   * Uses 13 stations and high airfoil resolution so the curved surfaces
   * tessellate cleanly even at engine-overview scale.
   */
  static fanBlade(rHub, rTip, rootChord = 0.15) {
    return TurbomachineryBlade.build({
      rHub, rTip,
      rootChord, tipChord: rootChord * 1.4,
      rootCamberPct: 8, tipCamberPct: 2,
      rootThicknessPct: 12, tipThicknessPct: 4,
      rootStagger: 65, tipStagger: 20,
      numStations: 13,  // was 9
      bladeType: 'fan',
    });
  }

  /**
   * Build a compressor rotor blade.
   */
  static compressorBlade(rHub, rTip, chord = 0.04, stage = 1, totalStages = 8) {
    const stageScale = 1 - (stage - 1) / (totalStages * 2);
    return TurbomachineryBlade.build({
      rHub, rTip,
      rootChord: chord * stageScale,
      tipChord: chord * stageScale * 0.85,
      rootCamberPct: 8 - stage * 0.5,
      tipCamberPct: 2,
      rootThicknessPct: 10 - stage * 0.3,
      tipThicknessPct: 4,
      rootStagger: 50 + stage * 2,
      tipStagger: 25 + stage,
      numStations: 7,
      bladeType: 'compressor',
    });
  }

  /**
   * Build a turbine rotor blade — thicker, more curved, often hollow.
   */
  static turbineBlade(rHub, rTip, chord = 0.05, stage = 1, totalStages = 6) {
    return TurbomachineryBlade.build({
      rHub, rTip,
      rootChord: chord,
      tipChord: chord * 1.1,  // turbines often expand
      rootCamberPct: 14,
      tipCamberPct: 8,
      rootThicknessPct: 18,
      tipThicknessPct: 8,
      rootStagger: 35,
      tipStagger: 55,
      numStations: 7,
      bladeType: 'turbine',
    });
  }

  /**
   * Build a stator vane.
   *
   * Stators differ from rotors in real engines:
   *   - Thicker leading edges (more durable, less stress)
   *   - Less twist (only 5-10° hub-to-tip vs 30-40° for rotors)
   *   - Wider chord at tip (constant chord typical)
   *   - Reverse-curve airfoil (deflects flow back to axial)
   *   - Less camber overall (deceleration not acceleration)
   *
   * Compressor stators (IGVs / variable stators): thick LE for FOD,
   * variable pitch in front 4 stages.
   *
   * Turbine stators (NGVs): heavily cooled, often CMC, near-axial
   * exit angle. Thick airfoil for film cooling channels.
   */
  static statorVane(rHub, rTip, chord = 0.04, isCompressor = true) {
    const cps = isCompressor
      ? {
          // Compressor stator: thick LE, gentle camber, mild twist
          rootCamber: 4, tipCamber: 3,
          rootThick: 14, tipThick: 12,    // 14-12% thick (vs 10% for rotor)
          rootStagger: -35, tipStagger: -28,  // Only 7° twist
          rootChord: chord, tipChord: chord,  // Constant chord
        }
      : {
          // Turbine NGV: very thick (cooling), high camber, reverse stagger
          rootCamber: 22, tipCamber: 18,
          rootThick: 22, tipThick: 18,    // 22-18% thick for cooling channels
          rootStagger: -60, tipStagger: -45,  // 15° twist
          rootChord: chord * 1.2, tipChord: chord * 1.1,  // larger than rotor
        };

    return TurbomachineryBlade.build({
      rHub, rTip,
      rootChord: cps.rootChord,
      tipChord: cps.tipChord,
      rootCamberPct: cps.rootCamber,
      tipCamberPct: cps.tipCamber,
      rootThicknessPct: cps.rootThick,
      tipThicknessPct: cps.tipThick,
      rootStagger: cps.rootStagger,
      tipStagger: cps.tipStagger,
      numStations: 5,
      bladeType: isCompressor ? 'compressor' : 'turbine',
    });
  }

  /**
   * Build a fir-tree root profile (3 teeth) for turbine blade attachment.
   * @param {number} width - root width (m)
   * @param {number} depth - root depth into disk (m)
   * @returns {Vec3[]} closed profile in XY plane
   */
  static firTreeRoot(width = 0.025, depth = 0.030) {
    const teeth = 3;
    const points = [];
    const angleStep = Math.PI / 6;  // 30° dovetail angle

    // Right side (going down)
    for (let i = 0; i < teeth; i++) {
      const yTop = -i * (depth / teeth);
      const yBottom = -(i + 1) * (depth / teeth);
      const wTop = width * (1 - i * 0.15);
      const wBottom = width * (1 - (i + 1) * 0.15);
      points.push(new Vec3(wTop / 2, yTop, 0));
      points.push(new Vec3(wTop / 2 + 0.002, yTop - 0.001, 0));
      points.push(new Vec3(wBottom / 2 + 0.002, yBottom + 0.001, 0));
      points.push(new Vec3(wBottom / 2, yBottom, 0));
    }
    // Bottom
    points.push(new Vec3(-width * 0.55 / 2, -depth, 0));
    // Left side (going up — mirror)
    for (let i = teeth - 1; i >= 0; i--) {
      const yTop = -i * (depth / teeth);
      const yBottom = -(i + 1) * (depth / teeth);
      const wTop = width * (1 - i * 0.15);
      const wBottom = width * (1 - (i + 1) * 0.15);
      points.push(new Vec3(-wBottom / 2, yBottom, 0));
      points.push(new Vec3(-wBottom / 2 - 0.002, yBottom + 0.001, 0));
      points.push(new Vec3(-wTop / 2 - 0.002, yTop - 0.001, 0));
      points.push(new Vec3(-wTop / 2, yTop, 0));
    }
    points.push(new Vec3(width / 2, 0, 0));

    return points;
  }

  /**
   * Build a dovetail root profile (single tooth) for fan/compressor blades.
   */
  static dovetailRoot(width = 0.040, depth = 0.025) {
    return [
      new Vec3(-width / 2, 0, 0),
      new Vec3(-width * 0.7 / 2, -depth * 0.5, 0),
      new Vec3(-width * 0.5 / 2, -depth, 0),
      new Vec3(width * 0.5 / 2, -depth, 0),
      new Vec3(width * 0.7 / 2, -depth * 0.5, 0),
      new Vec3(width / 2, 0, 0),
    ];
  }

  /**
   * Build cooling channel profiles for hollow turbine blade.
   * Returns array of small circular profiles distributed inside the airfoil.
   */
  static coolingChannels(chord, numChannels = 5, channelDia = 0.0015) {
    const channels = [];
    for (let i = 0; i < numChannels; i++) {
      const xc = (i + 1) / (numChannels + 1);  // distribute along chord
      const cx = -chord / 2 + xc * chord;
      const cy = 0;
      // Generate circle profile
      const profile = [];
      const segs = 16;
      for (let j = 0; j < segs; j++) {
        const a = (j / segs) * Math.PI * 2;
        profile.push({ x: cx + Math.cos(a) * channelDia / 2, y: cy + Math.sin(a) * channelDia / 2 });
      }
      channels.push(profile);
    }
    return channels;
  }
}
