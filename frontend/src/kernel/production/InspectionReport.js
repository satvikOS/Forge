/**
 * ArchDisc — Inspection Report Generator
 *
 * Builds a per-part First Article Inspection (FAI) / dimensional
 * inspection report per AS9102 (aerospace) form structure:
 *   Form 1: Part Number Accountability
 *   Form 2: Product Accountability — Materials, Special Processes
 *   Form 3: Characteristic Accountability — every toleranced dim
 *           checked nominal/actual/tolerance/in-or-out
 *
 * Combined with NDT report when applicable (UT, FPI, RT, MT).
 */

const SIM_NOISE = 0.0003;  // ±0.3 mm typical machining variation

function _measuredFor(nominal, lower, upper) {
  // Pseudo-deterministic hash → produces a measurement within tolerance
  // for sim purposes. Real inspection records would have actual numbers.
  const seed = (nominal * 7919 + (upper - lower) * 17.3) % 1;
  const range = upper - lower;
  return lower + (seed * range);
}

export default class InspectionReport {

  /**
   * @param {object} options
   *   partID
   *   partTitle
   *   serialNumber
   *   drawingRev
   *   tolerance       ProductionTolerance instance (source of inspection items)
   *   material
   *   heatLot
   *   inspector       e.g. 'J. Doe (QA-2814)'
   *   date
   *   process         manufacturing process used (CNC, casting, forging, etc.)
   * @returns {object} { json, markdown, html }
   */
  static build(options = {}) {
    const {
      partID = 'PART-XXXX',
      partTitle = '',
      serialNumber = `SN-${Math.floor(Math.random() * 1e6).toString().padStart(6, '0')}`,
      drawingRev = 'A',
      tolerance,
      material = '—',
      heatLot = `HL-${Math.floor(Math.random() * 1e5).toString().padStart(5, '0')}`,
      inspector = 'A. Inspector (QA-1)',
      date = new Date().toISOString().slice(0, 10),
      process = 'CNC 5-axis machining',
    } = options;

    const items = tolerance ? tolerance.inspectionItems() : [];
    const characteristics = items.map((it, i) => {
      let actual = null, status = 'NOT MEASURED';
      if (it.kind === 'dimensional') {
        actual = _measuredFor(it.nominal, it.lower, it.upper);
        status = (actual >= it.lower && actual <= it.upper) ? 'PASS' : 'FAIL';
      } else if (it.kind === 'gdt') {
        // Simulate measured deviation as 60-80% of allowed tolerance
        actual = it.tolerance * (0.6 + ((i * 17 % 20) / 100));
        status = actual <= it.tolerance ? 'PASS' : 'FAIL';
      } else if (it.kind === 'surface') {
        actual = it.Ra_um * (0.7 + ((i * 13 % 20) / 100));
        status = actual <= it.Ra_um ? 'PASS' : 'FAIL';
      }
      return {
        seq: i + 1,
        kind: it.kind,
        feature: it.feature,
        spec: it,
        nominal: it.nominal != null ? it.nominal : (it.tolerance ?? it.Ra_um),
        actual: actual != null ? +actual.toFixed(6) : null,
        status,
        method: it.method || 'CMM',
      };
    });

    const passes = characteristics.filter(c => c.status === 'PASS').length;
    const fails = characteristics.filter(c => c.status === 'FAIL').length;
    const overall = fails === 0 ? 'ACCEPT' : 'REJECT — see non-conformance';

    const json = {
      reportType: 'AS9102 First Article Inspection',
      form1: {
        partNumber: partID, partName: partTitle, serialNumber,
        ferraName: 'ArchDisc',
        revLevel: drawingRev,
        process,
      },
      form2: {
        materialOrProcess: [
          { item: 1, type: 'Material', spec: material, lot: heatLot },
          { item: 2, type: 'Process', spec: process, certNo: `PROC-${Date.now() % 100000}` },
        ],
      },
      form3: {
        characteristics,
        summary: { total: characteristics.length, pass: passes, fail: fails },
      },
      overall,
      inspector,
      date,
    };

    const markdown = InspectionReport._toMarkdown(json);
    return { json, markdown };
  }

  static _toMarkdown(r) {
    const lines = [];
    lines.push(`# AS9102 First Article Inspection Report`);
    lines.push('');
    lines.push(`**Part Number:** ${r.form1.partNumber}  ·  **Title:** ${r.form1.partName}`);
    lines.push(`**Serial:** ${r.form1.serialNumber}  ·  **Drawing Rev:** ${r.form1.revLevel}`);
    lines.push(`**Process:** ${r.form1.process}`);
    lines.push(`**Date:** ${r.date}  ·  **Inspector:** ${r.inspector}`);
    lines.push(`**Overall Status: ${r.overall}**`);
    lines.push('');
    lines.push('## Form 2 — Product Accountability');
    lines.push('| Item | Type | Spec | Lot/Cert |');
    lines.push('|------|------|------|----------|');
    for (const m of r.form2.materialOrProcess) {
      lines.push(`| ${m.item} | ${m.type} | ${m.spec} | ${m.lot || m.certNo} |`);
    }
    lines.push('');
    lines.push('## Form 3 — Characteristic Accountability');
    lines.push(`| # | Feature | Kind | Nominal | Actual | Method | Status |`);
    lines.push(`|---|---------|------|---------|--------|--------|--------|`);
    for (const c of r.form3.characteristics) {
      const nominal = typeof c.nominal === 'number' ? c.nominal.toFixed(4) : c.nominal;
      const actual = c.actual != null ? c.actual.toFixed(4) : '—';
      lines.push(`| ${c.seq} | ${c.feature} | ${c.kind} | ${nominal} | ${actual} | ${c.method} | ${c.status} |`);
    }
    lines.push('');
    lines.push(`**Summary:** ${r.form3.summary.pass} pass / ${r.form3.summary.fail} fail (${r.form3.summary.total} characteristics)`);
    return lines.join('\n');
  }
}
