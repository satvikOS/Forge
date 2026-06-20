#!/usr/bin/env node
/**
 * flagship_sequence_oracle.mjs — record the canonical CUA tool_call sequence for
 * one of the three Forge FLAGSHIP projects (GE9X turbofan / planetary gearbox /
 * centrifugal turbopump) against a FRESH headless kernel, for one parameter set,
 * and emit it as JSON on stdout. Used by archdisc-Models/scripts/synth_forge_flagship.py.
 *
 * WHY a per-call child: the native kernel handle counter is process-global (the
 * module is require-cached, so makeHeadlessForge does NOT reset it). One fresh
 * Node process per recording makes handles restart at 1 — exactly what the model
 * sees at inference for a freshly-built scene. The driver mode forks a child per
 * job; the worker mode (FLAGSHIP_ONE=1) records the single job in argv.
 *
 * Each job: { project, params }. Output (worker): the build result's
 *   { project, params, calls, bodies, assembly, sim }   where:
 *     calls    = the recorded build+assembly {name,arguments} sequence
 *     sim      = the appended simulate.* {name,arguments} calls (cfd / dynamics-
 *                motion / fea-static|fea-modal) with physically-sane SI args,
 *                threaded onto the REAL recorded body handles + instance ids.
 *   The full canonical sequence the corpus trains on = calls.concat(sim).
 *
 *   node flagship_sequence_oracle.mjs <jobsJsonPath>     (driver)
 */
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';
import cp from 'child_process';
import { makeHeadlessForge } from './cadscore_harness.mjs';

const __filename = fileURLToPath(import.meta.url);
const FORGE_V4 = path.resolve(__filename, '..', '..', '..', 'frontend', 'src', 'forge-v4');

const BUILDERS = {
  turbofan: { mod: 'turbofanToolSequence.js', fn: 'buildTurbofanSequence' },
  gearbox: { mod: 'planetaryGearboxToolSequence.js', fn: 'buildGearboxSequence' },
  turbopump: { mod: 'turbopumpToolSequence.js', fn: 'buildTurbopumpSequence' },
};

// Engineering materials (SI) the simulate verbs consume.
const TI = { E: 1.14e11, nu: 0.32, rho: 4430 };       // Ti-6Al-4V (fan/impeller/blades)
const STEEL = { E: 2.1e11, nu: 0.3, rho: 7850 };       // structural steel (shafts/gears)
const NICKEL = { E: 2.0e11, nu: 0.3, rho: 8190 };      // Inconel (turbine/hot section)

/** Find a recorded body handle by name, and a driven instance id, from a build
 *  result. Returns { handle, instance } or nulls. */
function pick(res, name) {
  const b = res.bodies.find((x) => x.name === name);
  return b ? { handle: b.handle } : { handle: null };
}

/** Build the appended simulate.* sequence for a project, threaded on the REAL
 *  recorded handles + the first add-instance id (the motor for the motion study). */
function buildSim(project, res) {
  const sim = [];
  // The first assembly.add-instance in the recorded calls drives the motion study.
  const firstInst = res.calls.find((c) => c.name === 'assembly.add-instance');
  // We re-derive the motor instance id deterministically: instances are numbered
  // in add order starting at 1 (the kernel addInstance counter), so the motor is
  // the FIRST instance = 1 for the rotor we want. Use a known rotating body.
  let rotorInstance = 1;

  if (project === 'turbofan') {
    const fan = pick(res, 'fan_disk');
    const blade = pick(res, 'fan_blade');
    // CFD: incompressible laminar bound through a duct domain (bypass air proxy).
    sim.push({ name: 'simulate.cfd', arguments: {
      domain: [0, 0, 0, 5.2, 3.6, 3.6], grid: 32, rho: 1.225,
      viscosity: 1.5e-5, inletFace: '-x', velocity: [280, 0, 0], maxIter: 120,
    } });
    // Dynamics-motion: spin the fan rotor one full revolution (kinematics-in-motion).
    sim.push({ name: 'simulate.dynamics-motion', arguments: {
      motor: rotorInstance, axis: 1, totalAngle: round(2 * Math.PI), steps: 48,
    } });
    // FEA: centrifugal/aero load on the fan blade (modal + static).
    sim.push({ name: 'simulate.fea-modal', arguments: {
      shape: blade.handle, material: TI, fixedFace: '-y', modes: 6, meshSize: 12,
    } });
    sim.push({ name: 'simulate.fea-static', arguments: {
      shape: fan.handle, material: TI, fixedFace: '-x', loadFace: '+x',
      force: [0, 0, -250000], meshSize: 14,
    } });
  } else if (project === 'gearbox') {
    const sun = pick(res, 's1_sun');
    const planet = pick(res, 's1_planet');
    // Dynamics-motion: drive the sun/carrier through 2+ revolutions (gear motion).
    sim.push({ name: 'simulate.dynamics-motion', arguments: {
      motor: rotorInstance, axis: 1, totalAngle: round(4 * Math.PI), steps: 60,
    } });
    // FEA: tooth-root bending on the most-loaded (sun) gear + planet modal.
    sim.push({ name: 'simulate.fea-static', arguments: {
      shape: sun.handle, material: STEEL, fixedFace: '-x', loadFace: '+y',
      force: [0, -8000, 0], meshSize: 4,
    } });
    sim.push({ name: 'simulate.fea-modal', arguments: {
      shape: planet.handle, material: STEEL, fixedFace: '-x', modes: 6, meshSize: 4,
    } });
  } else if (project === 'turbopump') {
    const vane = pick(res, 'impeller_vane');
    const hub = pick(res, 'impeller_hub');
    // CFD: pumped-fluid (water) flow through the casing domain (head/Reynolds).
    sim.push({ name: 'simulate.cfd', arguments: {
      domain: [0, 0, 0, 0.4, 0.5, 0.5], grid: 32, rho: 1000,
      viscosity: 1.0e-6, inletFace: '-x', velocity: [12, 0, 0], maxIter: 120,
    } });
    // Dynamics-motion: spin the impeller one+ revolution (kinematics-in-motion).
    sim.push({ name: 'simulate.dynamics-motion', arguments: {
      motor: rotorInstance, axis: 1, totalAngle: round(2 * Math.PI), steps: 48,
    } });
    // FEA: pressure + centrifugal load on a vane (static) + hub modal.
    sim.push({ name: 'simulate.fea-static', arguments: {
      shape: vane.handle, material: TI, fixedFace: '-y', loadFace: '+y',
      force: [0, -4000, 0], meshSize: 5,
    } });
    sim.push({ name: 'simulate.fea-modal', arguments: {
      shape: hub.handle, material: STEEL, fixedFace: '-x', modes: 6, meshSize: 6,
    } });
  }
  return sim;
}
function round(v) { return Math.round(v * 1e6) / 1e6; }

async function recordOne(job) {
  const spec = BUILDERS[job.project];
  if (!spec) throw new Error(`unknown project ${job.project}`);
  const forge = makeHeadlessForge();
  const mod = await import(path.join(FORGE_V4, spec.mod));
  const fn = mod[spec.fn] || mod.default;
  const res = await fn(forge, job.params || {});
  const verbErrors = res.verbLog.filter((v) => !v.ok);
  const sim = buildSim(job.project, res);
  return {
    project: job.project,
    params: res.params,
    calls: res.calls,
    sim,
    bodies: res.bodies,
    bodyCount: res.bodyCount,
    assembly: {
      bodies: res.assembly.bodies, instances: res.assembly.instances,
      mates: res.assembly.mates, aabbHits: res.assembly.aabbHits,
      converged: res.assembly.solve && res.assembly.solve.converged === true,
      coherent: res.assembly.coherent === true,
    },
    totalTriangles: res.totalTriangles,
    assembledTriangles: res.assembledTriangles,
    verbErrors: verbErrors.map((e) => ({ name: e.name, error: e.error })),
    ok: verbErrors.length === 0 && res.assembly.coherent === true,
  };
}

async function main() {
  if (process.env.FLAGSHIP_ONE === '1') {
    const job = JSON.parse(process.argv[3]);
    const r = await recordOne(job);
    process.stdout.write(JSON.stringify(r));
    return;
  }
  const jobsPath = process.argv[2];
  if (!jobsPath || !fs.existsSync(jobsPath)) {
    console.error('usage: node flagship_sequence_oracle.mjs <jobs.json>');
    process.exit(2);
  }
  const jobs = JSON.parse(fs.readFileSync(jobsPath, 'utf8'));
  const out = [];
  for (const job of jobs) {
    const r = cp.spawnSync(process.execPath, [process.argv[1], jobsPath, JSON.stringify(job)],
      { env: { ...process.env, FLAGSHIP_ONE: '1' }, encoding: 'utf8', maxBuffer: 1 << 28 });
    if (r.status !== 0) {
      out.push({ project: job.project, params: job.params, ok: false,
        error: (r.stderr || '').slice(0, 600) });
      continue;
    }
    try { out.push(JSON.parse(r.stdout)); }
    catch (e) { out.push({ project: job.project, ok: false, error: 'parse: ' + e.message + ' :: ' + r.stdout.slice(0, 300) }); }
  }
  process.stdout.write(JSON.stringify(out));
}

main().catch((e) => { console.error('[flagship_oracle ERROR]', e.stack || e); process.exit(1); });
