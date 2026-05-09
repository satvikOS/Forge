/**
 * ArchDisc — Design FMEA + Risk Classification (FAR 33.70)
 *
 * Per-part Design Failure Mode and Effects Analysis matching SAE J1739
 * /AS13004 aerospace structure:
 *   - Failure mode (how it can fail)
 *   - Effect (what happens to next-higher assembly + end function)
 *   - Severity S (1-10)
 *   - Occurrence O (1-10) given current controls
 *   - Detection D (1-10) given current verification
 *   - RPN = S × O × D  (1-1000)
 *   - Mitigation actions
 *   - Risk classification (Class 1, 2, 3 per FAR 33.70 Critical Parts)
 *
 * Integrated with PartIDRegistry → FMEA stored alongside FEA + tests.
 */

const TYPICAL_FAILURE_MODES = {
  blade: [
    { mode: 'High-cycle fatigue (HCF) crack', effect: 'Blade liberation; FOD downstream; engine shutdown', S: 10 },
    { mode: 'Low-cycle fatigue (LCF) crack at root', effect: 'Disk-blade interface failure', S: 10 },
    { mode: 'Foreign object damage (FOD) leading-edge', effect: 'Reduced efficiency; blade replacement', S: 5 },
    { mode: 'Tip rub against casing', effect: 'Performance loss; possible tip cracking', S: 6 },
    { mode: 'Coating spallation (TBC)', effect: 'Substrate overheat; blade life shortened', S: 7 },
  ],
  disk: [
    { mode: 'Burst at LCF limit (centrifugal)', effect: 'Catastrophic uncontained failure', S: 10 },
    { mode: 'Bore crack from cyclic stress', effect: 'Eventual rim release; engine destruction', S: 10 },
    { mode: 'Slot cracking at blade root', effect: 'Blade liberation', S: 9 },
  ],
  casing: [
    { mode: 'Hoop crack from over-pressure', effect: 'Loss of containment', S: 9 },
    { mode: 'Bolt-hole fatigue', effect: 'Flange separation', S: 8 },
    { mode: 'Heat-affected zone (HAZ) creep', effect: 'Distortion, leak path', S: 6 },
  ],
  shaft: [
    { mode: 'Torsional fatigue at coupling', effect: 'Shaft separation', S: 10 },
    { mode: 'Bearing-journal wear', effect: 'Vibration, eventual seizure', S: 8 },
  ],
  bearing: [
    { mode: 'Spalling on race', effect: 'Vibration, lubrication contamination', S: 7 },
    { mode: 'Cage failure', effect: 'Sudden seizure', S: 9 },
  ],
  fastener: [
    { mode: 'Thread stripping', effect: 'Joint loosening', S: 5 },
    { mode: 'Fatigue at thread root', effect: 'Bolt separation', S: 7 },
  ],
  generic: [
    { mode: 'Material defect', effect: 'Premature failure', S: 6 },
    { mode: 'Manufacturing defect', effect: 'Out-of-tolerance assembly', S: 5 },
  ],
};

/**
 * Classify a part per FAR 33.70 Critical Part rules.
 *
 * Class 1 (LLP — Life-Limited Part):
 *   ROTATING parts whose primary failure mode is uncontained release.
 *   Per real engine cert practice this is essentially the rotor disks
 *   and main shafts. Real GE9X has ~30-50 LLP parts.
 *     - Rotor disks: FAN/DSK, LPC/DSK, HPC/DSK, HPT/DSK, LPT/DSK
 *     - Shafts: SHFT/* (LP, HP)
 *     - Hubs: FAN/HUB
 *     - Spools (rotor drums): if any
 *
 * Class 2 (Important — affects engine integrity but not life-limited):
 *   Blades, vanes, casings, combustor liner, bearings, fasteners on
 *   load-critical paths. These are inspected/replaced on-condition.
 *
 * Class 3 (Standard — replaceable per condition):
 *   Cooling holes, gaskets, sensors, wire harnesses, brackets,
 *   tags, fittings, fasteners on non-critical paths.
 */
function _classifyPart(category, subsystem) {
  const llpSubsystems = ['DSK', 'HUB'];   // rotor disks + hubs
  const llpCategories = ['FAN', 'LPC', 'HPC', 'HPT', 'LPT'];
  const llpAlways = ['SHFT'];              // any shaft is LLP regardless of subsystem
  const importantSubs = ['BLD', 'NGV', 'CSG', 'LIN', 'DOM', 'FIR'];
  const importantCats = ['FAN', 'LPC', 'HPC', 'COMB', 'HPT', 'LPT', 'BRG'];

  if (llpAlways.includes(category)) return 'Class 1';
  if (llpSubsystems.includes(subsystem) && llpCategories.includes(category)) return 'Class 1';
  if (importantSubs.includes(subsystem) && importantCats.includes(category)) return 'Class 2';
  if (subsystem === 'BAL' || subsystem === 'ROL' || subsystem === 'RAC') return 'Class 2';  // bearings
  return 'Class 3';
}

export default class FMEA {

  /** Classify a part as Class 1/2/3. */
  static classify(category, subsystem) {
    return _classifyPart(category, subsystem);
  }

  /**
   * Build a DFMEA for one part.
   *
   * @param {object} options
   *   partID
   *   partTitle
   *   category, subsystem    used to lookup failure mode templates
   *   material
   *   classification         override of auto-classify
   * @returns {object} { json, markdown }
   */
  static build(options = {}) {
    const {
      partID = 'PART-XXXX', partTitle = '',
      category = 'GEN', subsystem = 'PRT',
      material = '—',
      preparedBy = 'Design Engineer', date = new Date().toISOString().slice(0, 10),
    } = options;

    const classification = options.classification || _classifyPart(category, subsystem);
    const subTypeKey = subsystem.includes('BLD') ? 'blade'
      : subsystem.includes('DSK') ? 'disk'
      : subsystem.includes('CSG') || subsystem.includes('LIN') ? 'casing'
      : subsystem.startsWith('LP') || subsystem === 'HP' ? 'shaft'
      : subsystem.startsWith('BAL') || subsystem.startsWith('ROL') ? 'bearing'
      : ['BLT', 'NUT', 'WSH', 'PIN'].includes(subsystem) ? 'fastener'
      : 'generic';

    const templates = TYPICAL_FAILURE_MODES[subTypeKey] || TYPICAL_FAILURE_MODES.generic;

    const items = templates.map((t, i) => {
      // Occurrence + Detection scores from class
      const O = classification === 'Class 1' ? 2 : classification === 'Class 2' ? 3 : 4;
      const D = classification === 'Class 1' ? 2 : classification === 'Class 2' ? 3 : 5;
      const RPN = t.S * O * D;
      const mitigation = classification === 'Class 1'
        ? `Borescope inspection per EM 72-${subsystem}, NDT 100%, LCF cycle tracking`
        : classification === 'Class 2'
          ? `Sample inspection (10%), magnetic particle test`
          : `Visual inspection per receiving QC`;
      return {
        seq: i + 1,
        failureMode: t.mode,
        effect: t.effect,
        severity: t.S,
        occurrence: O,
        detection: D,
        RPN,
        currentControls: mitigation,
        actionRequired: RPN > 100 ? 'Yes' : 'No',
      };
    });

    const summary = {
      total: items.length,
      maxRPN: Math.max(...items.map(i => i.RPN)),
      avgRPN: items.reduce((s, i) => s + i.RPN, 0) / items.length,
      criticalCount: items.filter(i => i.RPN > 100).length,
    };

    const json = {
      partID, partTitle,
      classification,
      ferraName: 'ArchDisc',
      preparedBy, date,
      part: { category, subsystem, material },
      analysisItems: items,
      summary,
    };

    const md = [
      `# Design FMEA — ${partID}`,
      '',
      `**Part:** ${partTitle}`,
      `**Risk Classification:** **${classification}** ${classification === 'Class 1' ? '(LLP — life-limited critical per FAR 33.70)' : ''}`,
      `**Material:** ${material}  ·  **Category:** ${category}  ·  **Subsystem:** ${subsystem}`,
      `**Prepared By:** ${preparedBy}  ·  **Date:** ${date}`,
      '',
      '## Failure-Mode Analysis Items',
      '| # | Failure Mode | Effect | S | O | D | RPN | Action? |',
      '|---|--------------|--------|---|---|---|-----|---------|',
      ...items.map(i => `| ${i.seq} | ${i.failureMode} | ${i.effect} | ${i.severity} | ${i.occurrence} | ${i.detection} | **${i.RPN}** | ${i.actionRequired} |`),
      '',
      '## Summary',
      `- Total items: ${summary.total}`,
      `- Max RPN: ${summary.maxRPN}`,
      `- Avg RPN: ${summary.avgRPN.toFixed(0)}`,
      `- Items requiring action (RPN > 100): ${summary.criticalCount}`,
      '',
      '## Current Controls (per item)',
      ...items.map(i => `- **#${i.seq} ${i.failureMode}** — ${i.currentControls}`),
    ].join('\n');

    return { json, markdown: md };
  }
}
