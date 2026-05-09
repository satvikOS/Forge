/**
 * ArchDisc — Real-World Test Runner
 *
 * Coordinates execution of TestScenarios across registered components,
 * attaches results to PartIDRegistry, and records every run in
 * InteractionRecorder so the entire test campaign is reproducible.
 *
 * Usage:
 *   const summary = await RealWorldTestRunner.runCampaign({
 *     scenarios: ['bird_strike', 'rotor_overspeed'],
 *     filter: e => e.subsystem === 'BLD',
 *   });
 *
 * Returns a campaign summary with pass/fail counts and per-part results
 * which are also attached to each part's registry entry.
 */

import PartIDRegistry from '../registry/PartIDRegistry.js';
import InteractionRecorder from '../recording/InteractionRecorder.js';
import TestScenarios from './TestScenarios.js';

export default class RealWorldTestRunner {

  /**
   * Run a campaign: each scenario × each filtered part.
   *
   * @param {object} options
   * @param {string[]} options.scenarios - keys from TestScenarios.list()
   * @param {function(entry):boolean} [options.filter]
   * @param {object} [options.scenarioOptions] - per-scenario options
   * @param {function} [options.onProgress] - (i, total, partID, scenario, result)=>void
   * @param {number}   [options.maxParts] - cap parts processed per scenario
   * @returns {object} campaign summary
   */
  static async runCampaign(options = {}) {
    const {
      scenarios = TestScenarios.list(),
      filter = null,
      scenarioOptions = {},
      onProgress = null,
      maxParts = Infinity,
    } = options;

    const allEntries = PartIDRegistry.all();
    const filtered = filter ? allEntries.filter(filter) : allEntries;
    const targets = filtered.slice(0, maxParts);

    const startedAt = Date.now();
    const results = [];
    let pass = 0, marginal = 0, fail = 0, error = 0;
    let i = 0;
    const total = targets.length * scenarios.length;

    for (const scenario of scenarios) {
      for (const entry of targets) {
        if (!entry.partInstance?.solid) {
          // No solid — skip but record
          const r = {
            scenario, partID: entry.partID, result: 'SKIPPED',
            reason: 'No solid attached', timestamp: new Date().toISOString(),
          };
          results.push(r);
          i++;
          continue;
        }

        const opts = scenarioOptions[scenario] || {};
        const r = TestScenarios.run(scenario, entry.partInstance.solid, entry.material, opts);
        const enriched = { ...r, partID: entry.partID, partName: entry.name };
        results.push(enriched);

        // Attach to registry
        PartIDRegistry.attachTest(entry.partID, enriched);

        // Record
        InteractionRecorder.recordTestRun(scenario, entry.partID, {
          result: r.result,
          metrics: r.metrics,
        });

        if (r.result === 'PASS') pass++;
        else if (r.result === 'MARGINAL') marginal++;
        else if (r.result === 'FAIL') fail++;
        else error++;

        i++;
        if (onProgress) onProgress(i, total, entry.partID, scenario, r);
      }
    }

    const summary = {
      startedAt: new Date(startedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationSec: (Date.now() - startedAt) / 1000,
      scenarios,
      partsTested: targets.length,
      totalRuns: results.length,
      pass,
      marginal,
      fail,
      error,
      passRate: results.length > 0 ? pass / results.length : 0,
      results,
    };

    InteractionRecorder.record('campaign.complete', {
      scenarios: scenarios.length,
      partsTested: targets.length,
      pass, marginal, fail, error,
    });

    return summary;
  }

  /**
   * Quick safety audit — runs the most critical scenarios on the most
   * critical components (high-load parts: blades, disks, casings).
   */
  static async safetyAudit() {
    return RealWorldTestRunner.runCampaign({
      scenarios: ['bird_strike', 'fod_ingestion', 'rotor_overspeed', 'blade_off', 'fatigue_hcf', 'thermal_cycle'],
      filter: e => ['BLD', 'DSK', 'CSG', 'NGV'].includes(e.subsystem),
      maxParts: 50,
    });
  }
}
