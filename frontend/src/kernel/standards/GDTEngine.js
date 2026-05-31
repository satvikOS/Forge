/**
 * ArchDisc — GD&T Engine (Geometric Dimensioning & Tolerancing)
 * ASME Y14.5 / ISO 1101 compliance.
 *
 * Assigns tolerances to features, validates against specs,
 * performs tolerance stack-up analysis (RSS and Worst-Case).
 */

// Tolerance grades (IT grades per ISO 286)
const IT_GRADES = {
  IT01: [0.3, 0.3, 0.4, 0.4, 0.5, 0.6, 0.6, 0.8, 1.0, 1.0],
  IT0:  [0.5, 0.5, 0.6, 0.6, 0.8, 1.0, 1.0, 1.2, 1.5, 1.5],
  IT1:  [0.8, 0.8, 1.0, 1.0, 1.2, 1.5, 1.5, 2.0, 2.5, 2.5],
  IT5:  [4, 5, 6, 8, 9, 11, 13, 15, 18, 20],
  IT6:  [6, 8, 9, 11, 13, 16, 19, 22, 25, 29],
  IT7:  [10, 12, 15, 18, 21, 25, 30, 35, 40, 46],
  IT8:  [14, 18, 22, 27, 33, 39, 46, 54, 63, 72],
  IT9:  [25, 30, 36, 43, 52, 62, 74, 87, 100, 115],
  IT10: [40, 48, 58, 70, 84, 100, 120, 140, 160, 185],
  IT11: [60, 75, 90, 110, 130, 160, 190, 220, 250, 290],
  IT12: [100, 120, 150, 180, 210, 250, 300, 350, 400, 460],
};

// GD&T Symbol types
const GDT_TYPES = {
  straightness: { symbol: '—', category: 'form', requiresDatum: false },
  flatness: { symbol: '⏥', category: 'form', requiresDatum: false },
  circularity: { symbol: '○', category: 'form', requiresDatum: false },
  cylindricity: { symbol: '⌭', category: 'form', requiresDatum: false },
  profileOfLine: { symbol: '⌒', category: 'profile', requiresDatum: true },
  profileOfSurface: { symbol: '⌓', category: 'profile', requiresDatum: true },
  angularity: { symbol: '∠', category: 'orientation', requiresDatum: true },
  perpendicularity: { symbol: '⊥', category: 'orientation', requiresDatum: true },
  parallelism: { symbol: '∥', category: 'orientation', requiresDatum: true },
  position: { symbol: '⊕', category: 'location', requiresDatum: true },
  concentricity: { symbol: '◎', category: 'location', requiresDatum: true },
  symmetry: { symbol: '≡', category: 'location', requiresDatum: true },
  circularRunout: { symbol: '↗', category: 'runout', requiresDatum: true },
  totalRunout: { symbol: '↗↗', category: 'runout', requiresDatum: true },
};

export { IT_GRADES, GDT_TYPES };

export default class GDTEngine {

  /**
   * Create a GD&T callout for a feature.
   */
  static createCallout(type, tolerance, datumRefs = [], modifier = null) {
    const spec = GDT_TYPES[type];
    if (!spec) throw new Error(`Unknown GD&T type: ${type}`);

    if (spec.requiresDatum && datumRefs.length === 0) {
      throw new Error(`${type} requires at least one datum reference`);
    }

    return {
      type,
      symbol: spec.symbol,
      category: spec.category,
      tolerance, // in meters
      toleranceMm: tolerance * 1000,
      datumRefs, // ['A', 'B', 'C']
      modifier, // 'MMC', 'LMC', 'RFS', null
      frameText: GDTEngine._formatFrame(spec.symbol, tolerance, datumRefs, modifier),
    };
  }

  /**
   * Assign a dimensional tolerance to a measurement.
   * @param {number} nominal - Nominal dimension (meters)
   * @param {string} fit - e.g., 'H7', 'h6', 'H7/g6'
   * @returns {object} { nominal, upper, lower, tolerance, fit }
   */
  static dimensionalTolerance(nominal, fit = 'H7') {
    const nominalMm = nominal * 1000;

    // Simplified IT-grade based tolerance
    const grade = parseInt(fit.replace(/[^0-9]/g, '')) || 7;
    const isHole = fit.charAt(0) === fit.charAt(0).toUpperCase();

    // Approximate tolerance based on nominal size and IT grade
    let tol;
    if (nominalMm <= 3) tol = IT_GRADES[`IT${grade}`]?.[0] || 10;
    else if (nominalMm <= 6) tol = IT_GRADES[`IT${grade}`]?.[1] || 12;
    else if (nominalMm <= 10) tol = IT_GRADES[`IT${grade}`]?.[2] || 15;
    else if (nominalMm <= 18) tol = IT_GRADES[`IT${grade}`]?.[3] || 18;
    else if (nominalMm <= 30) tol = IT_GRADES[`IT${grade}`]?.[4] || 21;
    else if (nominalMm <= 50) tol = IT_GRADES[`IT${grade}`]?.[5] || 25;
    else if (nominalMm <= 80) tol = IT_GRADES[`IT${grade}`]?.[6] || 30;
    else if (nominalMm <= 120) tol = IT_GRADES[`IT${grade}`]?.[7] || 35;
    else if (nominalMm <= 180) tol = IT_GRADES[`IT${grade}`]?.[8] || 40;
    else tol = IT_GRADES[`IT${grade}`]?.[9] || 46;

    const tolMeters = tol * 1e-6; // micrometers to meters

    let upper, lower;
    if (isHole) {
      upper = tolMeters;
      lower = 0;
    } else {
      upper = 0;
      lower = -tolMeters;
    }

    return {
      nominal,
      nominalMm: nominalMm.toFixed(3),
      upper,
      lower,
      upperMm: (upper * 1000).toFixed(4),
      lowerMm: (lower * 1000).toFixed(4),
      tolerance: tolMeters,
      toleranceMm: (tolMeters * 1000).toFixed(4),
      toleranceUm: tol.toFixed(1),
      fit,
      grade: `IT${grade}`,
      displayText: `${nominalMm.toFixed(2)} ${fit} (+${(upper * 1000).toFixed(3)}/${(lower * 1000).toFixed(3)})`,
    };
  }

  /**
   * Tolerance stack-up analysis (1D chain).
   * @param {object[]} dimensions - [{ nominal, tolerance, description }]
   * @param {string} method - 'worstCase' or 'rss' (root sum square)
   */
  static stackUp(dimensions, method = 'rss') {
    const n = dimensions.length;
    let nominalTotal = 0;
    let wcTotal = 0;
    let rssTotal = 0;

    const breakdown = dimensions.map(d => {
      const nom = d.nominal;
      const tol = d.tolerance || d.toleranceMm * 0.001 || 0;
      nominalTotal += nom;
      wcTotal += tol;
      rssTotal += tol * tol;
      return {
        description: d.description || 'Dimension',
        nominal: nom,
        nominalMm: (nom * 1000).toFixed(3),
        tolerance: tol,
        toleranceMm: (tol * 1000).toFixed(4),
      };
    });

    rssTotal = Math.sqrt(rssTotal);

    const result = {
      method,
      dimensionCount: n,
      nominalTotal,
      nominalTotalMm: (nominalTotal * 1000).toFixed(3),
      worstCase: {
        tolerance: wcTotal,
        toleranceMm: (wcTotal * 1000).toFixed(4),
        max: (nominalTotal + wcTotal) * 1000,
        min: (nominalTotal - wcTotal) * 1000,
      },
      rss: {
        tolerance: rssTotal,
        toleranceMm: (rssTotal * 1000).toFixed(4),
        max: (nominalTotal + rssTotal) * 1000,
        min: (nominalTotal - rssTotal) * 1000,
        cpk3sigma: ((nominalTotal + 3 * rssTotal) * 1000).toFixed(4),
      },
      breakdown,
    };

    if (method === 'rss') {
      result.result = result.rss;
    } else {
      result.result = result.worstCase;
    }

    return result;
  }

  /**
   * Check if a measured value is within tolerance.
   */
  static checkTolerance(nominal, measured, tolerance) {
    const deviation = measured - nominal;
    const withinTol = Math.abs(deviation) <= tolerance;
    return {
      nominal, measured, tolerance,
      deviation,
      deviationMm: (deviation * 1000).toFixed(4),
      withinTolerance: withinTol,
      utilizationPercent: ((Math.abs(deviation) / tolerance) * 100).toFixed(1),
      status: withinTol ? 'PASS' : 'FAIL',
    };
  }

  /**
   * Generate a complete tolerance report for a solid.
   */
  static generateReport(solid, features = []) {
    const report = {
      partName: solid.name || 'Part',
      date: new Date().toISOString(),
      standard: 'ASME Y14.5-2018 / ISO 1101:2017',
      features: [],
      summary: { total: 0, pass: 0, fail: 0 },
    };

    // Auto-generate tolerances for each face
    const faces = solid.faces();
    faces.forEach((face, i) => {
      const area = face.area();
      // Flatness tolerance based on surface area (smaller = tighter)
      const flatnessTol = Math.max(0.00001, area * 0.001); // proportional to area

      const callout = GDTEngine.createCallout('flatness', flatnessTol);
      const check = GDTEngine.checkTolerance(0, flatnessTol * 0.3, flatnessTol); // simulated measurement

      report.features.push({
        featureId: `Face_${face.id}`,
        callout,
        measurement: check,
      });

      report.summary.total++;
      if (check.withinTolerance) report.summary.pass++;
      else report.summary.fail++;
    });

    // Add user-specified features
    features.forEach(f => {
      report.features.push(f);
      report.summary.total++;
      if (f.measurement?.withinTolerance) report.summary.pass++;
      else report.summary.fail++;
    });

    return report;
  }

  // --- Internal ---

  static _formatFrame(symbol, tolerance, datumRefs, modifier) {
    const tolStr = (tolerance * 1000).toFixed(3);
    const modStr = modifier ? ` (${modifier})` : '';
    const datumStr = datumRefs.length > 0 ? ` | ${datumRefs.join(' | ')}` : '';
    return `${symbol} ${tolStr}${modStr}${datumStr}`;
  }
}
