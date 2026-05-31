/**
 * ArchDisc — Production Tolerance Bundle (per part)
 *
 * Per-part tolerance specification matching ASME Y14.5 / ISO 1101 practice:
 *   - Datums (A, B, C) tied to features
 *   - Linear/angular dimensional tolerances
 *   - Geometric tolerances (form, orientation, location, runout, profile)
 *   - Surface finish callouts (Ra) per ASME B46.1
 *   - Material condition modifiers (MMC/LMC/RFS)
 *   - All tolerance frames serializable to SVG for drawing inclusion
 *
 * A `ProductionTolerance` instance is the single source of truth for
 * one part's tolerance scheme. It feeds:
 *   - DrawingEngine (renders frames + dimension chains on sheet)
 *   - InspectionReport (lists each toleranced dim w/ check method)
 *   - StackUp analysis (worst-case + RSS for assembly fits)
 *
 * Usage:
 *   const tol = new ProductionTolerance({ partID, drawingNumber, revision });
 *   tol.addDatum('A', 'face', 'aft mounting face');
 *   tol.addDatum('B', 'axis', 'bore centerline');
 *   tol.addDimensional('OD', { nominal: 0.420, fit: 'h6' });
 *   tol.addGDT({ type: 'flatness', tolerance: 0.0001, feature: 'face-A' });
 *   tol.addGDT({ type: 'perpendicularity', tolerance: 0.0002, feature: 'B', datums: ['A'] });
 *   tol.addSurfaceFinish('OD', { Ra_um: 0.8 });
 *   const svg = tol.toFrameSVG({ x: 100, y: 100 });
 */

import GDTEngine from '../standards/GDTEngine.js';

const _registry = new Map();  // partID → instance

export default class ProductionTolerance {

  constructor(options = {}) {
    this.partID = options.partID || null;
    this.drawingNumber = options.drawingNumber || (this.partID ? `${this.partID}-DWG` : 'DWG-XXX');
    this.revision = options.revision || 'A';
    this.title = options.title || this.partID || 'Untitled Part';
    this.scale = options.scale || '1:1';
    this.units = options.units || 'mm';
    this.datums = [];                  // [{ id, feature, description }]
    this.dimensional = [];             // [{ feature, nominal, fit, ... }]
    this.gdtCallouts = [];             // [{ type, tolerance, datums, feature, modifier }]
    this.surfaceFinishes = [];         // [{ feature, Ra_um, lay, direction }]
    this.processCallouts = [];         // [{ type, spec, applied_to }]
    this.notes = [];                   // free-text notes (e.g., "remove all burrs", "anodize per MIL-A-8625")

    if (this.partID) _registry.set(this.partID, this);
  }

  // ---- Datums ------------------------------------------------------

  addDatum(id, feature, description = '') {
    this.datums.push({ id, feature, description });
    return this;
  }

  // ---- Dimensional tolerances --------------------------------------

  addDimensional(feature, opts) {
    const tol = GDTEngine.dimensionalTolerance(opts.nominal, opts.fit || 'H7');
    this.dimensional.push({
      feature,
      ...tol,
      checkMethod: opts.checkMethod || 'micrometer',
      bilateral: opts.bilateral !== false,
    });
    return this;
  }

  /** Bilateral linear tolerance (e.g. ±0.05 mm). */
  addBilateral(feature, nominal, plusMinus, options = {}) {
    this.dimensional.push({
      feature,
      nominal,
      upper: nominal + plusMinus,
      lower: nominal - plusMinus,
      tolerance: plusMinus * 2,
      bilateral: true,
      checkMethod: options.checkMethod || 'micrometer',
    });
    return this;
  }

  /** Angular tolerance — degrees. */
  addAngular(feature, nominalDeg, plusMinusDeg) {
    this.dimensional.push({
      feature,
      nominal: nominalDeg,
      upper: nominalDeg + plusMinusDeg,
      lower: nominalDeg - plusMinusDeg,
      tolerance: plusMinusDeg * 2,
      kind: 'angular',
      unit: 'degree',
      checkMethod: 'protractor / CMM',
    });
    return this;
  }

  // ---- GD&T --------------------------------------------------------

  addGDT(opts) {
    const callout = GDTEngine.createCallout(
      opts.type, opts.tolerance, opts.datums || [], opts.modifier || null
    );
    callout.feature = opts.feature;
    this.gdtCallouts.push(callout);
    return this;
  }

  // ---- Surface finish ----------------------------------------------

  /**
   * @param {object} opts
   *   Ra_um   surface roughness (Ra in µm)
   *   lay     'parallel'|'perpendicular'|'cross'|'circular'|'radial'|'multi'|'pitted'
   *   direction optional
   */
  addSurfaceFinish(feature, opts) {
    this.surfaceFinishes.push({
      feature,
      Ra_um: opts.Ra_um,
      lay: opts.lay || 'multi',
      direction: opts.direction || null,
      method: opts.method || 'profilometer',
    });
    return this;
  }

  // ---- Process callouts --------------------------------------------

  addProcess(type, spec, appliedTo = 'all surfaces') {
    this.processCallouts.push({ type, spec, applied_to: appliedTo });
    return this;
  }

  addNote(text) {
    this.notes.push(text);
    return this;
  }

  // ---- Reporting ---------------------------------------------------

  /** All toleranced features (for inspection). */
  inspectionItems() {
    const items = [];
    for (const d of this.dimensional) {
      items.push({
        kind: 'dimensional',
        feature: d.feature,
        nominal: d.nominal,
        upper: d.upper, lower: d.lower,
        tolerance: d.tolerance,
        unit: d.unit || this.units,
        method: d.checkMethod,
      });
    }
    for (const g of this.gdtCallouts) {
      items.push({
        kind: 'gdt',
        feature: g.feature,
        type: g.type, symbol: g.symbol,
        tolerance: g.toleranceMm,
        datums: g.datumRefs,
        modifier: g.modifier,
        method: g.type.includes('runout') ? 'lathe with dial indicator' : 'CMM',
      });
    }
    for (const s of this.surfaceFinishes) {
      items.push({
        kind: 'surface',
        feature: s.feature,
        Ra_um: s.Ra_um,
        lay: s.lay,
        method: s.method,
      });
    }
    return items;
  }

  toJSON() {
    return {
      partID: this.partID,
      drawingNumber: this.drawingNumber,
      revision: this.revision,
      title: this.title,
      scale: this.scale,
      units: this.units,
      datums: [...this.datums],
      dimensional: [...this.dimensional],
      gdtCallouts: this.gdtCallouts.map(c => ({ ...c })),
      surfaceFinishes: [...this.surfaceFinishes],
      processCallouts: [...this.processCallouts],
      notes: [...this.notes],
    };
  }

  /** Render a single tolerance frame as SVG snippet. */
  static frameSVG(callout, x, y) {
    const sym = callout.symbol;
    const tolStr = `${callout.toleranceMm.toFixed(3)}`;
    const dRefs = callout.datumRefs.length > 0 ? callout.datumRefs.join(' ') : '';
    const mod = callout.modifier ? ` ${callout.modifier}` : '';
    const cells = [sym, tolStr, dRefs, mod].filter(Boolean);
    let cursor = x;
    const cellW = 28, h = 18;
    const segs = [];
    for (const c of cells) {
      segs.push(`<rect x="${cursor}" y="${y}" width="${cellW}" height="${h}" fill="#fff" stroke="#000" stroke-width="0.6"/>
        <text x="${cursor + cellW / 2}" y="${y + 13}" text-anchor="middle" font-family="serif" font-size="11" fill="#000">${c}</text>`);
      cursor += cellW;
    }
    return segs.join('\n');
  }

  /** Surface finish triangle/check marker as SVG. */
  static surfaceFinishSVG(s, x, y) {
    return `<g transform="translate(${x},${y})">
      <path d="M 0 0 L 8 -14 L 16 0 Z" fill="none" stroke="#000" stroke-width="0.8"/>
      <text x="20" y="-2" font-family="sans-serif" font-size="10" fill="#000">${s.Ra_um.toFixed(2)}</text>
      <text x="8" y="-16" text-anchor="middle" font-family="sans-serif" font-size="8" fill="#000">${s.lay || ''}</text>
    </g>`;
  }

  // ---- Registry ----------------------------------------------------

  static get(partID) { return _registry.get(partID) || null; }
  static all() { return Array.from(_registry.values()); }
  static reset() { _registry.clear(); }
  static count() { return _registry.size; }
}
