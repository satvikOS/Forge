/**
 * ArchDisc — Production Article Package
 *
 * For each part, bundles every regulatory artifact required for an
 * FAA Part 21 production-article delivery into a per-part folder:
 *
 *   parts/<CAT>/<SUB>/<PARTID>/
 *     part.step                ISO 10303 STEP geometry
 *     drawing.svg              ASME Y14.5 production drawing with GD&T
 *     tolerance.json           ProductionTolerance bundle
 *     inspection.md            AS9102 First Article Inspection
 *     inspection.json
 *     material-cert.md         EN 10204 Type 3.1 mill cert
 *     coc.md                   Certificate of Conformance
 *     fmea.md                  Design FMEA + risk classification
 *     fmea.json
 *     fea.json                 Per-class analysis results
 *     process-specs.md         Heat treat, surface finish, NDT, coating
 *     manifest.json            Pointers + signatures
 *
 * Class 1 parts get the full package; Class 2 omits scenario battery;
 * Class 3 gets a slim package (drawing + STEP + CoC).
 */

import STEPExporter from '../export/STEPExporter.js';
import ProductionDrawing from './ProductionDrawing.js';
import ProductionTolerance from './ProductionTolerance.js';
import InspectionReport from './InspectionReport.js';
import MaterialCert from './MaterialCert.js';
import FMEA from './FMEA.js';
import ProcessSpecs from './ProcessSpecs.js';
import PartAnalysisRunner from './PartAnalysisRunner.js';

export default class ProductionPackage {

  /**
   * Build the package for one part.
   *
   * @param {object} entry - PartIDRegistry entry
   * @param {object} options
   *   project           e.g. 'GE9X'
   *   sheetSize         drawing sheet size (default A3)
   *   defaultTolerance  ProductionTolerance to use if entry lacks one
   *   skipFEA           true for Class 3 fast-build
   * @returns {object} { class, files: Map<filename, content> }
   */
  static build(entry, options = {}) {
    if (!entry?.partInstance?.solid) {
      return { class: 'Class 3', files: new Map(), error: 'no solid' };
    }
    const { project = 'PROJECT', sheetSize = 'A3' } = options;
    const partID = entry.partID;
    const partClass = FMEA.classify(entry.category, entry.subsystem);
    const files = new Map();

    // 1. Build/use tolerance
    let tolerance = ProductionTolerance.get(partID);
    if (!tolerance) {
      tolerance = ProductionPackage._defaultTolerance(entry);
    }

    // 2. STEP geometry
    try {
      files.set('part.step', STEPExporter.toSTEP(entry.partInstance.solid, partID));
    } catch (e) {
      files.set('part.step.error.txt', `STEP export failed: ${e.message}`);
    }

    // 3. Production drawing
    try {
      const procSpecsBundle = ProcessSpecs.suggestForPart({
        category: entry.category, subsystem: entry.subsystem, material: entry.material,
      });
      const procCallouts = ProcessSpecs.toCallouts(procSpecsBundle);

      const drawing = ProductionDrawing.build({
        solid: entry.partInstance.solid,
        partID, title: entry.name,
        material: entry.material,
        tolerance,
        processSpecs: procCallouts,
        revisions: entry.revisions?.length > 0 ? entry.revisions : [{
          rev: 'A', date: new Date().toISOString().slice(0, 10),
          by: 'AD', note: 'Initial release',
        }],
        sheetSize, scale: '1:2',
        project, classification: partClass,
        drawnBy: 'ArchDisc Auto-Drawing',
        approvedBy: '— pending QA review —',
      });
      files.set('drawing.svg', drawing);
      files.set('tolerance.json', JSON.stringify(tolerance.toJSON(), null, 2));
    } catch (e) {
      files.set('drawing.error.txt', `Drawing failed: ${e.message}`);
    }

    // 4. Inspection report
    try {
      const insp = InspectionReport.build({
        partID, partTitle: entry.name,
        drawingRev: tolerance.revision,
        tolerance,
        material: entry.material,
        process: ProductionPackage._guessProcess(entry),
      });
      files.set('inspection.md', insp.markdown);
      files.set('inspection.json', JSON.stringify(insp.json, null, 2));
    } catch (e) {
      files.set('inspection.error.txt', e.message);
    }

    // 5. Material cert + CoC
    try {
      const matCert = MaterialCert.buildMaterialCert({ material: entry.material });
      files.set('material-cert.md', matCert.markdown);
      files.set('material-cert.json', JSON.stringify(matCert.json, null, 2));

      const coc = MaterialCert.buildCoC({
        partID, partTitle: entry.name,
        drawingNumber: tolerance.drawingNumber, drawingRev: tolerance.revision,
        heatLot: matCert.json.heatLot,
      });
      files.set('coc.md', coc.markdown);
      files.set('coc.json', JSON.stringify(coc.json, null, 2));
    } catch (e) {
      files.set('cert.error.txt', e.message);
    }

    // 6. FMEA
    try {
      const fmea = FMEA.build({
        partID, partTitle: entry.name,
        category: entry.category, subsystem: entry.subsystem,
        material: entry.material,
      });
      files.set('fmea.md', fmea.markdown);
      files.set('fmea.json', JSON.stringify(fmea.json, null, 2));
    } catch (e) {
      files.set('fmea.error.txt', e.message);
    }

    // 7. FEA / analysis (Class 1 + Class 2 only)
    if (!options.skipFEA && (partClass === 'Class 1' || partClass === 'Class 2')) {
      try {
        const ana = PartAnalysisRunner.run(entry);
        files.set('fea.json', JSON.stringify(ana, null, 2));
      } catch (e) {
        files.set('fea.error.txt', e.message);
      }
    }

    // 8. Process specs summary
    const procSpecsBundle = ProcessSpecs.suggestForPart({
      category: entry.category, subsystem: entry.subsystem, material: entry.material,
    });
    const procMd = [
      `# Process Specifications — ${partID}`,
      '',
      `**Heat Treat:** ${procSpecsBundle.heatTreat?.callout || '— none —'}`,
      `**Surface Finish:** ${procSpecsBundle.surfaceFinish?.callout || '— none —'}`,
      `**NDT:** ${procSpecsBundle.ndt?.callout || '— none —'}`,
      `**Surface Treatment:** ${procSpecsBundle.surfaceTreatment?.callout || '— none —'}`,
      `**Coating:** ${procSpecsBundle.coating?.callout || '— none —'}`,
    ].join('\n');
    files.set('process-specs.md', procMd);

    // 9. Manifest
    const manifest = {
      partID, partName: entry.name,
      project, classification: partClass,
      category: entry.category, subsystem: entry.subsystem,
      material: entry.material,
      generatedAt: new Date().toISOString(),
      drawingNumber: tolerance.drawingNumber,
      revision: tolerance.revision,
      filesIncluded: Array.from(files.keys()),
      packageVersion: '1.0',
      partOfProject: project,
      certificationLevel: partClass === 'Class 1' ? 'FAA Part 21 Critical Part' : partClass === 'Class 2' ? 'FAA Part 21 Important' : 'Standard',
    };
    files.set('manifest.json', JSON.stringify(manifest, null, 2));

    return { class: partClass, files };
  }

  // ----------------------------------------------------------------

  static _defaultTolerance(entry) {
    const t = new ProductionTolerance({
      partID: entry.partID,
      drawingNumber: `${entry.partID}-DWG`,
      revision: 'A',
      title: entry.name,
      scale: '1:2',
      units: 'mm',
    });
    t.addDatum('A', 'face', 'primary mounting face');
    t.addDatum('B', 'axis', 'centerline axis');

    const cls = FMEA.classify(entry.category, entry.subsystem);
    if (cls === 'Class 1') {
      t.addBilateral('OD', 0.020, 0.0001);  // ±0.1mm linear
      t.addBilateral('thickness', 0.005, 0.00005);
      t.addAngular('axis-tilt', 0, 0.05);
      t.addGDT({ type: 'flatness', tolerance: 0.0001, feature: 'face-A' });
      t.addGDT({ type: 'perpendicularity', tolerance: 0.0002, feature: 'B', datums: ['A'] });
      t.addGDT({ type: 'totalRunout', tolerance: 0.00015, feature: 'OD', datums: ['A', 'B'], modifier: 'RFS' });
      t.addSurfaceFinish('OD', { Ra_um: 0.8 });
      t.addSurfaceFinish('face-A', { Ra_um: 0.4 });
    } else if (cls === 'Class 2') {
      t.addBilateral('OD', 0.020, 0.0003);
      t.addAngular('axis-tilt', 0, 0.1);
      t.addGDT({ type: 'flatness', tolerance: 0.0005, feature: 'face-A' });
      t.addGDT({ type: 'perpendicularity', tolerance: 0.001, feature: 'B', datums: ['A'] });
      t.addSurfaceFinish('OD', { Ra_um: 1.6 });
    } else {
      t.addBilateral('OD', 0.020, 0.0010);
      t.addSurfaceFinish('OD', { Ra_um: 3.2 });
    }
    return t;
  }

  static _guessProcess(entry) {
    if (entry.subsystem === 'BLD' && entry.material?.includes('CMC')) return 'CMC layup + melt-infiltration';
    if (entry.subsystem === 'BLD' && entry.material?.includes('Composite')) return 'Composite layup + autoclave';
    if (entry.subsystem === 'BLD') return 'Investment casting + 5-axis machining';
    if (entry.subsystem === 'DSK') return 'Forge + machining + shot peen';
    if (entry.subsystem === 'CSG' || entry.subsystem === 'FCW') return 'Sheet form + weld + machining';
    if (entry.subsystem === 'BLT') return 'Cold-form + roll-thread';
    return 'CNC 5-axis machining';
  }
}
