import { test, expect } from '@playwright/test';
import {
  slabTetMesh, fireSurvival, quenchSurvival, birdStrikeSurvival, runSurvivalSuite,
} from '../frontend/src/foundation/SurvivalSim.js';

/*
 * Survival scenarios — fire, water-quench, bird-strike. Pure-math
 * foundation solvers; no browser needed.
 */

test.describe('SurvivalSim — fire / water / bird-strike', () => {
  test('slabTetMesh tiles a slab into valid tets', () => {
    const m = slabTetMesh(0.05, 0.05, 0.005, 2, 2, 10);
    expect(m.vertices.length).toBe(3 * 3 * 11);
    expect(m.tets.length).toBe(2 * 2 * 10 * 6);          // 6 tets per cube
    expect(m.faceZ0.length).toBe(2 * 2 * 2);             // 2 tris per quad
    expect(m.faceZLz.length).toBe(2 * 2 * 2);
    // Every tet index is in range.
    for (const t of m.tets) for (const i of t) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(m.vertices.length);
    }
  });

  test('fire — Inconel combustor liner heats toward the flame', () => {
    const r = fireSurvival({
      material: 'INCONEL_718', wallThickness: 0.004,
      flameTempC: 1100, durationS: 300,
    });
    console.log(`\n  FIRE: ${r.verdict}`);
    console.log(`  peak wall ${r.peakWallTempC}°C, service limit ${r.serviceLimitC}°C, `
      + `strength retained ${r.strengthRetainedPct}%`);
    // Wall heats up but never exceeds the flame temperature.
    expect(r.peakWallTempC).toBeGreaterThan(100);
    expect(r.peakWallTempC).toBeLessThanOrEqual(1100);
    expect(typeof r.survivesRequiredDuration).toBe('boolean');
    expect(r.strengthRetainedPct).toBeGreaterThan(0);
    expect(r.strengthRetainedPct).toBeLessThanOrEqual(100);
  });

  test('water — hot CMSX-4 blade quench builds a thermal gradient', () => {
    const r = quenchSurvival({
      material: 'CMSX_4', wallThickness: 0.003,
      initialTempC: 950, waterTempC: 18,
    });
    console.log(`\n  WATER: ${r.verdict}`);
    console.log(`  peak ΔT ${r.peakThroughThicknessDeltaTC}°C, shock `
      + `${r.thermalShockStressMPa} MPa vs UTS ${r.utsMPa} MPa (margin ${r.safetyMargin})`);
    expect(r.peakThroughThicknessDeltaTC).toBeGreaterThan(0);
    expect(r.thermalShockStressMPa).toBeGreaterThan(0);
    expect(r.utsMPa).toBeGreaterThan(0);
    expect(typeof r.survives).toBe('boolean');
  });

  test('bird strike — explicit dynamics conserves energy, reports damage', () => {
    const r = birdStrikeSurvival({
      material: 'TI_6AL_4V', birdMassKg: 1.8, impactSpeed: 130,
    });
    console.log(`\n  BIRD: ${r.verdict}`);
    console.log(`  incident ${r.incidentKE_J} J, absorbed ${r.energyAbsorbed_J} J, `
      + `peak ${r.peakContactForce_kN} kN, damage ${r.damagedSpringPct}%`);
    expect(r.incidentKE_J).toBeGreaterThan(0);
    expect(r.peakContactForce_kN).toBeGreaterThan(0);
    // The blade can absorb at most the bird's incident kinetic energy.
    expect(r.energyAbsorbed_J).toBeGreaterThan(0);
    expect(r.energyAbsorbed_J).toBeLessThanOrEqual(r.incidentKE_J);
    expect(typeof r.survives).toBe('boolean');
    expect(r.damagedSpringPct).toBeGreaterThanOrEqual(0);
    expect(r.damagedSpringPct).toBeLessThanOrEqual(100);
  });

  test('runSurvivalSuite rolls up all three verdicts', () => {
    const s = runSurvivalSuite({
      fire: { material: 'INCONEL_718' },
      water: { material: 'CMSX_4' },
      bird: { material: 'TI_6AL_4V' },
    });
    console.log(`\n  SUITE: ${s.overall}`);
    expect(s.total).toBe(3);
    expect(s.passed).toBeGreaterThanOrEqual(0);
    expect(s.passed).toBeLessThanOrEqual(3);
    expect(s.fire.scenario).toBe('fire');
    expect(s.water.scenario).toBe('water-immersion (quench)');
    expect(s.bird.scenario).toBe('bird strike');
  });
});
