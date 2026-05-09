/**
 * ArchDisc — FAR Part 33 / EASA CS-E Compliance Matrix
 *
 * Maps regulatory requirements (14 CFR Part 33 — Aircraft Engines) to
 * the test scenarios in TestScenarios.js. For each subsection, lists:
 *   - The requirement text (paraphrased)
 *   - Which scenario(s) verify it
 *   - Which components must be tested
 *   - Pass criteria
 *
 * Used to produce a compliance report — what fraction of FAR Part 33
 * is verified by tests we've actually run, and against which parts.
 *
 * Source: 14 CFR Part 33 — public regulatory text from the FAA.
 */

const COMPLIANCE_ITEMS = [
  {
    code: '33.15',
    title: 'Materials',
    description: 'Suitability and durability of materials used in the engine must be established.',
    scenarios: ['fatigue_hcf', 'thermal_cycle'],
    targetSubsystems: ['BLD', 'DSK', 'CSG', 'NGV', 'LIN'],
    passCriteria: 'Materials demonstrated to withstand HCF + thermal cycling per service life.',
  },
  {
    code: '33.27',
    title: 'Turbine, compressor, fan, and turbosupercharger rotor overspeed',
    description: 'Rotors must be capable of withstanding overspeed conditions for 5 minutes without burst.',
    scenarios: ['rotor_overspeed'],
    targetSubsystems: ['BLD', 'DSK'],
    passCriteria: 'No rotor burst at 115% red-line for 5 minutes.',
  },
  {
    code: '33.62',
    title: 'Stress analysis',
    description: 'Engine must be subject to stress analysis showing margin of safety on each critical part.',
    scenarios: ['load_static'],
    targetSubsystems: ['BLD', 'DSK', 'CSG', 'NGV', 'HUB', 'LIN'],
    passCriteria: 'All critical parts show SF ≥ 1.0 at limit and ultimate loads.',
  },
  {
    code: '33.63',
    title: 'Vibration',
    description: 'Engine must be designed to function under vibration over the operating range.',
    scenarios: ['vibration_random'],
    targetSubsystems: ['BLD', 'DSK', 'CSG'],
    passCriteria: 'No first-mode resonance in the 20-2000 Hz operating band.',
  },
  {
    code: '33.74',
    title: 'Continued rotation',
    description: 'After shutdown by any cause, engine must continue to rotate or sustain damage limited to that not endangering aircraft.',
    scenarios: ['rotor_overspeed'],
    targetSubsystems: ['BRG', 'SHFT'],
    passCriteria: 'Bearings and shaft accommodate rundown without seizure failure mode.',
  },
  {
    code: '33.76',
    title: 'Bird ingestion',
    description: 'Engine must be capable of ingesting one large bird and one medium bird without unsafe condition.',
    scenarios: ['bird_strike'],
    targetSubsystems: ['BLD'],
    passCriteria: 'Fan blade SF ≥ 1.0 under 1.8 kg bird @ 250 m/s impact.',
  },
  {
    code: '33.77',
    title: 'Foreign object ingestion — FOD',
    description: 'Engine must withstand ingestion of medium FOD.',
    scenarios: ['fod_ingestion'],
    targetSubsystems: ['BLD'],
    passCriteria: 'Fan and compressor blades SF ≥ 1.0 under 0.45 kg @ 200 m/s FOD.',
  },
  {
    code: '33.78',
    title: 'Rain and hail ingestion',
    description: 'Engine must operate during ingestion of rain and hail.',
    scenarios: ['hail_ingestion'],
    targetSubsystems: ['BLD'],
    passCriteria: 'No blade yielding from 25 mm hailstone ingestion.',
  },
  {
    code: '33.83',
    title: 'Vibration test (engine-level)',
    description: 'Endurance vibration test demonstrating no resonance amplification damage.',
    scenarios: ['vibration_random'],
    targetSubsystems: ['BLD', 'DSK', 'CSG'],
    passCriteria: 'No resonant amplification > 4× across operating speed range.',
  },
  {
    code: '33.87',
    title: 'Endurance test',
    description: '150-hour endurance test simulating typical operating cycles.',
    scenarios: ['fatigue_hcf', 'thermal_cycle'],
    targetSubsystems: ['BLD', 'DSK', 'CSG', 'LIN'],
    passCriteria: 'Components survive 150 hr equivalent cycles without crack initiation.',
  },
  {
    code: '33.94',
    title: 'Blade containment and rotor unbalance tests',
    description: 'Engine casing must contain a liberated fan blade (blade-off).',
    scenarios: ['blade_off'],
    targetSubsystems: ['CSG'],
    passCriteria: 'Fan case SF ≥ 1.0 against blade liberation kinetic energy.',
  },
  {
    code: '33.97',
    title: 'Thrust reverser system',
    description: 'Thrust reverser must operate reliably and not pose hazard if it fails.',
    scenarios: ['load_static'],
    targetSubsystems: ['CAS', 'ACT'],
    passCriteria: 'Reverser cascades withstand limit + ultimate loads.',
  },
  {
    code: '33.B-1',
    title: 'Lightning strike (CS-E 800 / DO-160 §22)',
    description: 'Engine must operate after lightning strike per certification spec.',
    scenarios: ['lightning_strike'],
    targetSubsystems: ['CSG', 'NAC'],
    passCriteria: 'No through-burn from 200 kA Zone 1A strike.',
  },
];

export { COMPLIANCE_ITEMS };

export default class ComplianceMatrix {

  /** All compliance items (FAR Part 33 + CS-E equivalents). */
  static items() { return COMPLIANCE_ITEMS; }

  /** Return item by code. */
  static get(code) { return COMPLIANCE_ITEMS.find(c => c.code === code) || null; }

  /**
   * Build a compliance report against the test results currently attached
   * in PartIDRegistry.
   *
   * @param {object} PartIDRegistry
   * @returns {object} { items: [{ code, title, status, evidence: [...] }], summary }
   */
  static buildReport(PartIDRegistry) {
    const items = [];
    let verified = 0, partial = 0, none = 0;

    for (const item of COMPLIANCE_ITEMS) {
      const evidence = [];
      // Find parts whose subsystem matches and which have test results
      // for any of the listed scenarios.
      for (const sub of item.targetSubsystems) {
        const parts = PartIDRegistry.bySubsystem(sub);
        for (const p of parts) {
          for (const t of (p.tests || [])) {
            if (item.scenarios.includes(t.scenario)) {
              evidence.push({
                partID: p.partID, scenario: t.scenario,
                result: t.result, standard: t.standard,
              });
            }
          }
        }
      }

      const passes = evidence.filter(e => e.result === 'PASS');
      const fails = evidence.filter(e => e.result === 'FAIL');
      let status = 'UNVERIFIED';
      if (evidence.length === 0) {
        status = 'UNVERIFIED'; none++;
      } else if (fails.length > 0 && passes.length === 0) {
        status = 'FAILED'; partial++;
      } else if (passes.length > 0 && fails.length === 0) {
        status = 'VERIFIED'; verified++;
      } else if (passes.length > 0 && fails.length > 0) {
        status = 'MIXED'; partial++;
      }

      items.push({
        code: item.code,
        title: item.title,
        description: item.description,
        scenarios: item.scenarios,
        targetSubsystems: item.targetSubsystems,
        passCriteria: item.passCriteria,
        status,
        evidenceCount: evidence.length,
        passes: passes.length,
        fails: fails.length,
        evidence: evidence.slice(0, 10), // cap for size
      });
    }

    return {
      generatedAt: new Date().toISOString(),
      regulation: '14 CFR Part 33 / EASA CS-E',
      totalItems: COMPLIANCE_ITEMS.length,
      verified, partial, unverified: none,
      coveragePercent: ((verified / COMPLIANCE_ITEMS.length) * 100).toFixed(1),
      items,
    };
  }
}
