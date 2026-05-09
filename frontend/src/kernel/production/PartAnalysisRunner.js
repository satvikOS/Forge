/**
 * ArchDisc — Per-Part Analysis Runner
 *
 * For each part, runs the analysis battery appropriate to its risk class:
 *
 *   Class 1 (LLP):  linear-static FEA + modal + thermal + fatigue + (test scenario battery)
 *   Class 2:        linear-static FEA + modal
 *   Class 3:        skip FEA (not life-critical) — record waiver
 *
 * Results attach to PartIDRegistry entry and are bundled into the
 * production-article package.
 */

import FEAEngine from '../simulation/FEAEngine.js';
import PartIDRegistry from '../registry/PartIDRegistry.js';
import FMEA from './FMEA.js';
import TestScenarios from '../realworld/TestScenarios.js';

export default class PartAnalysisRunner {

  /**
   * Run analyses for one part based on its risk class.
   *
   * @param {object} entry - PartIDRegistry entry
   * @param {object} options
   *   loads      [{ type, value, faceId }]
   *   constraints [{ type, faceId }]
   *   targetCycles  for Class 1 fatigue check
   * @returns {object} { class, results: { fea, modal, thermal, fatigue, scenarios } }
   */
  static run(entry, options = {}) {
    if (!entry?.partInstance?.solid) {
      return { class: 'Class 3', results: {}, error: 'no solid' };
    }
    const partClass = FMEA.classify(entry.category, entry.subsystem);
    const solid = entry.partInstance.solid;
    const material = entry.material || 'Aluminum 6061-T6';

    const results = {};

    if (partClass === 'Class 1' || partClass === 'Class 2') {
      // Linear static
      try {
        const fea = FEAEngine.linearStatic(solid, {
          material,
          loads: options.loads || [{ type: 'pressure', value: 1e6 }],
          constraints: options.constraints || [{ type: 'fixed', faceId: 0 }],
        });
        results.fea = {
          maxStress_MPa: +(fea.maxStress / 1e6).toFixed(2),
          maxDisplacement_mm: +(fea.maxDisplacement * 1000).toFixed(4),
          safetyFactor: +(fea.safetyFactor || 0).toFixed(2),
        };
      } catch (e) {
        results.fea = { error: e.message };
      }

      // Modal
      try {
        const modal = FEAEngine.modal(solid, { material, numModes: 6 });
        results.modal = {
          frequencies_Hz: modal.frequencies?.map(f => +f.toFixed(1)) || [],
          firstMode_Hz: modal.frequencies?.[0] ?? null,
        };
      } catch (e) {
        results.modal = { error: e.message };
      }
    }

    if (partClass === 'Class 1') {
      // Thermal (for hot-section parts)
      const isHot = ['COMB', 'HPT'].includes(entry.category);
      if (isHot) {
        try {
          const thermal = FEAEngine.thermal(solid, {
            material,
            ambientTemp: 25,
            surfaceTemp: entry.category === 'COMB' ? 1500 : 1200,
          });
          results.thermal = {
            maxTemp_C: +(thermal.maxTemp || 0).toFixed(0),
            maxThermalStress_MPa: +((thermal.maxStress || 0) / 1e6).toFixed(2),
          };
        } catch (e) {
          results.thermal = { error: e.message };
        }
      }

      // Fatigue
      try {
        const fatigue = FEAEngine.fatigue(solid, {
          material,
          stressAmplitude: results.fea?.maxStress_MPa ? results.fea.maxStress_MPa * 1e6 * 0.4 : 200e6,
          targetCycles: options.targetCycles || 1e7,
        });
        results.fatigue = {
          life_cycles: fatigue.lifeCycles ?? 0,
          margin: fatigue.margin ?? null,
        };
      } catch (e) {
        results.fatigue = { error: e.message };
      }

      // Scenario battery for class 1: bird strike (blade), overspeed (disk), thermal cycle (hot)
      const scenarios = [];
      if (entry.subsystem === 'BLD' && entry.category === 'FAN') {
        scenarios.push('bird_strike', 'fod_ingestion', 'fatigue_hcf');
      } else if (entry.subsystem === 'BLD' && (entry.category === 'HPT' || entry.category === 'LPT')) {
        scenarios.push('thermal_cycle', 'fatigue_hcf');
      } else if (entry.subsystem === 'DSK') {
        scenarios.push('rotor_overspeed', 'fatigue_hcf');
      } else if (entry.subsystem === 'CSG' && entry.category === 'FAN') {
        scenarios.push('blade_off');
      }
      results.scenarios = {};
      for (const s of scenarios) {
        try {
          results.scenarios[s] = TestScenarios.run(s, solid, material);
        } catch (e) {
          results.scenarios[s] = { error: e.message };
        }
      }
    }

    // Persist on registry entry
    PartIDRegistry.attachAnalysis(entry.partID, {
      type: 'production-package',
      class: partClass,
      ...results,
    });

    return { class: partClass, results };
  }
}
