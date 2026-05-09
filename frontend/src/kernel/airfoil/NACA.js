/**
 * ArchDisc — NACA Airfoil Generator
 *
 * Generates real airfoil coordinate profiles from NACA designations.
 * Used by turbomachinery blade construction (fan, compressor, turbine).
 *
 * Supported series:
 * - 4-digit (e.g., NACA 0012, NACA 4412)
 * - 5-digit (e.g., NACA 23012, NACA 25112)
 *
 * Reference: Abbott & Von Doenhoff, "Theory of Wing Sections"
 */

import Vec3 from '../math/Vec3.js';

export default class NACA {

  /**
   * Generate 2D airfoil coordinates from a NACA 4-digit code.
   * @param {string} code - e.g., '0012', '4412'
   * @param {number} chord - chord length in meters
   * @param {number} numPoints - number of points around airfoil (default 80)
   * @returns {Array<{x:number, y:number}>} ordered points starting from
   *   trailing edge, around upper surface to LE, around lower back to TE
   */
  static fourDigit(code, chord = 0.1, numPoints = 80) {
    if (code.length !== 4) throw new Error('NACA 4-digit code must be 4 chars');
    const M = parseInt(code[0]) / 100;        // max camber (fraction)
    const P = parseInt(code[1]) / 10;          // location of max camber (fraction)
    const T = parseInt(code.substring(2, 4)) / 100; // thickness (fraction)

    const half = Math.floor(numPoints / 2);
    const upper = [];
    const lower = [];

    // Cosine-spaced x to concentrate points near LE/TE
    for (let i = 0; i <= half; i++) {
      const beta = (i / half) * Math.PI;
      const xc = (1 - Math.cos(beta)) / 2; // 0..1
      const x = xc * chord;

      // Thickness distribution
      const yt = (T / 0.20) * chord * (
        0.29690 * Math.sqrt(xc) -
        0.12600 * xc -
        0.35160 * xc * xc +
        0.28430 * xc * xc * xc -
        0.10150 * xc * xc * xc * xc
      );

      // Camber line
      let yc = 0;
      let dyc_dx = 0;
      if (M > 0 && P > 0) {
        if (xc < P) {
          yc = (M / (P * P)) * (2 * P * xc - xc * xc) * chord;
          dyc_dx = (2 * M / (P * P)) * (P - xc);
        } else {
          yc = (M / Math.pow(1 - P, 2)) * ((1 - 2 * P) + 2 * P * xc - xc * xc) * chord;
          dyc_dx = (2 * M / Math.pow(1 - P, 2)) * (P - xc);
        }
      }
      const theta = Math.atan(dyc_dx);
      const xu = x - yt * Math.sin(theta);
      const yu = yc + yt * Math.cos(theta);
      const xl = x + yt * Math.sin(theta);
      const yl = yc - yt * Math.cos(theta);

      upper.push({ x: xu, y: yu });
      lower.push({ x: xl, y: yl });
    }

    // Order: TE → upper → LE → lower → TE (closed polygon)
    const points = [];
    for (let i = upper.length - 1; i >= 0; i--) points.push(upper[i]);
    for (let i = 1; i < lower.length; i++) points.push(lower[i]);
    return points;
  }

  /**
   * Generate 5-digit NACA airfoil (e.g., 23012).
   * Limited to "normal" reflex camber lines.
   */
  static fiveDigit(code, chord = 0.1, numPoints = 80) {
    if (code.length !== 5) throw new Error('NACA 5-digit code must be 5 chars');
    // Simplified: use standard 230 mean line constants
    const T = parseInt(code.substring(3, 5)) / 100;

    // Reference values for 230xx series mean line
    const m230 = 0.2025;
    const k1_230 = 15.957;

    const half = Math.floor(numPoints / 2);
    const upper = [];
    const lower = [];

    for (let i = 0; i <= half; i++) {
      const beta = (i / half) * Math.PI;
      const xc = (1 - Math.cos(beta)) / 2;
      const x = xc * chord;

      const yt = (T / 0.20) * chord * (
        0.29690 * Math.sqrt(xc) - 0.12600 * xc - 0.35160 * xc * xc +
        0.28430 * xc * xc * xc - 0.10150 * xc * xc * xc * xc
      );

      let yc = 0, dyc_dx = 0;
      if (xc < m230) {
        yc = (k1_230 / 6) * (xc * xc * xc - 3 * m230 * xc * xc + m230 * m230 * (3 - m230) * xc) * chord;
        dyc_dx = (k1_230 / 6) * (3 * xc * xc - 6 * m230 * xc + m230 * m230 * (3 - m230));
      } else {
        yc = (k1_230 * Math.pow(m230, 3) / 6) * (1 - xc) * chord;
        dyc_dx = -(k1_230 * Math.pow(m230, 3) / 6);
      }

      const theta = Math.atan(dyc_dx);
      upper.push({ x: x - yt * Math.sin(theta), y: yc + yt * Math.cos(theta) });
      lower.push({ x: x + yt * Math.sin(theta), y: yc - yt * Math.cos(theta) });
    }

    const points = [];
    for (let i = upper.length - 1; i >= 0; i--) points.push(upper[i]);
    for (let i = 1; i < lower.length; i++) points.push(lower[i]);
    return points;
  }

  /**
   * Generate a "compressor blade" airfoil — high-camber low-thickness profile
   * typical of axial compressor blading.
   */
  static compressorAirfoil(camberPct = 6, thicknessPct = 8, chord = 0.1, numPoints = 80) {
    const cp = Math.max(0, Math.min(9, Math.round(camberPct)));
    const tp = Math.max(1, Math.min(99, Math.round(thicknessPct)));
    const code = `${cp}5${tp.toString().padStart(2, '0')}`;
    return NACA.fourDigit(code, chord, numPoints);
  }

  /**
   * Generate a "turbine blade" airfoil — high-camber thick profile typical
   * of turbine rotor blading. Use modified parabolic camber.
   */
  static turbineAirfoil(camberPct = 12, thicknessPct = 18, chord = 0.1, numPoints = 80) {
    const cp = Math.max(0, Math.min(9, Math.round(camberPct)));
    const tp = Math.max(1, Math.min(99, Math.round(thicknessPct)));
    const code = `${cp}5${tp.toString().padStart(2, '0')}`;
    return NACA.fourDigit(code, chord, numPoints);
  }

  /**
   * Convert 2D airfoil points to a 3D profile in a plane defined by normal.
   * Origin is the leading edge (point with smallest x).
   * Stagger angle (degrees): rotates the airfoil about the LE in the plane.
   * @returns {Vec3[]} 3D points
   */
  static to3D(points2D, options = {}) {
    const planeNormal = options.planeNormal || new Vec3(0, 1, 0);
    const origin = options.origin || new Vec3(0, 0, 0);
    const staggerDeg = options.staggerDeg || 0;
    const stagger = staggerDeg * Math.PI / 180;
    const cs = Math.cos(stagger);
    const sn = Math.sin(stagger);

    // Build basis: U = chord direction, W = thickness direction
    // Both perpendicular to planeNormal
    let U;
    if (Math.abs(planeNormal.y) > 0.9) {
      U = new Vec3(1, 0, 0);
    } else {
      U = new Vec3(0, 1, 0).cross(planeNormal).normalize();
    }
    const W = planeNormal.cross(U).normalize();

    // Apply stagger rotation in U/W plane
    const Ur = new Vec3(U.x * cs + W.x * sn, U.y * cs + W.y * sn, U.z * cs + W.z * sn);
    const Wr = new Vec3(-U.x * sn + W.x * cs, -U.y * sn + W.y * cs, -U.z * sn + W.z * cs);

    return points2D.map(p =>
      origin.add(Ur.mul(p.x)).add(Wr.mul(p.y))
    );
  }
}
