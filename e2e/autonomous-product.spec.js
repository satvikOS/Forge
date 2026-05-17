import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  clarifyBrief, decomposeProduct, runSwarm, runSystemTest,
  resolveAssembly, buildAssembly, checkAssemblyCoherence, renderAssemblyOrbit,
} from './agent-runtime.js';

/*
 * Autonomous product run — the full chain, with a PARALLEL agent swarm.
 *
 * GPT-4.1 decomposes a product brief into a part graph; a swarm of agents
 * — each in its own ArchDisc instance — designs the parts concurrently,
 * every part verified by a time-stepped DYNAMIC analysis with its motion
 * rendered; the designed parts are then assembled and the whole product
 * is dynamically system-tested and rendered.
 *
 * Non-engine product on purpose: the system is general.
 */

const CRED = path.resolve(__dirname, '..', '.llm-credentials.local.json');
const cred = fs.existsSync(CRED) ? JSON.parse(fs.readFileSync(CRED, 'utf8')) : null;
const OUT = path.resolve(__dirname, '..', 'autonomous-output');

const MATERIAL = { name: 'aluminium 6061', E_MPa: 69000, nu: 0.33, yield_MPa: 276, density: 2700 };
const BRIEF = 'A wall-mounted equipment shelf rated to hold 60 kg of equipment, aluminium, '
  + 'cantilevered off a vertical wall.';

test.describe('Autonomous product — decompose → parallel swarm → assemble → system test', () => {
  test.skip(!cred, 'no .llm-credentials.local.json — skipping live agent test');
  test.setTimeout(900000);

  test('GPT-4.1 decomposes a product; a swarm designs every part; the system is tested', async ({ browser }) => {
    fs.mkdirSync(OUT, { recursive: true });

    // ── clarify the brief — the AI asks, the user (here, defaults) answers ──
    const clar = await clarifyBrief(cred, BRIEF);
    console.log(`\n  CLARIFIER — ${clar.questions.length} questions asked:`);
    for (const a of clar.answers) console.log(`   Q: ${a.q}\n      → ${a.chosen}`);
    expect(clar.questions.length).toBeGreaterThanOrEqual(4);
    for (const a of clar.answers) {
      expect(a.options.length).toBeGreaterThanOrEqual(2);
      expect(a.chosen).toBeTruthy();
    }

    // ── decompose the clarified product (LLM only — no app needed) ──
    const graph = await decomposeProduct(cred, clar.clarifiedBrief);
    console.log(`\n  PRODUCT: ${graph.product} — decomposed into ${graph.parts.length} parts`);
    for (const p of graph.parts) {
      console.log(`   - ${p.name} [${p.role}]: reach ${p.reach_mm} mm, tip load ${p.tipLoad_N} N`);
    }
    expect(graph.parts.length).toBeGreaterThanOrEqual(3);

    // ── parallel swarm: each agent designs a part in its own ArchDisc ──
    console.log(`\n  SWARM — ${Math.min(3, graph.parts.length)} agents in parallel:`);
    const swarmStart = Date.now();
    const results = await runSwarm(browser, cred, graph.parts, MATERIAL,
      { concurrency: 3, log: (m) => console.log(m) });
    const swarmSec = ((Date.now() - swarmStart) / 1000).toFixed(1);

    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      const slug = r.part.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      if (r.motion) {
        fs.writeFileSync(path.join(OUT, `${slug}-motion.mp4`), r.motion.mp4);
        fs.writeFileSync(path.join(OUT, `${slug}-motion.avi`), r.motion.avi);
      }
      console.log(`  [${r.converged ? 'OK  ' : 'FAIL'}] ${r.part}: ${r.iterations} iter → `
        + `L=${r.final.L} b=${r.final.b} h=${r.final.h} mm | dynamic SF=${r.final.SF.toFixed(2)}, `
        + `f₁=${r.final.freqHz} Hz | ${r.motion ? r.motion.frameCount + '-frame motion' : 'no motion'}`);
    }
    const passed = results.filter((r) => r.converged).length;
    console.log(`\n  swarm: ${passed}/${results.length} parts designed in ${swarmSec}s (parallel)`);

    // ── assemble the verified parts → system-level dynamic test ──
    const designedMembers = graph.parts.map((p, i) => ({
      name: p.name, role: p.role || 'support',
      L_mm: results[i].final.L, b_mm: results[i].final.b, h_mm: results[i].final.h,
    }));
    const totalLoad = graph.totalLoad_N
      || graph.parts.reduce((a, p) => Math.max(a, p.tipLoad_N), 0);

    const sysCtx = await browser.newContext();
    const sysPage = await sysCtx.newPage();
    let sys, plan, coherence, assemblyOrbit;
    try {
      await sysPage.goto('/');
      await sysPage.locator('canvas').first().waitFor({ state: 'visible', timeout: 30000 });
      await sysPage.waitForTimeout(2000);
      sys = await runSystemTest(sysPage, cred, designedMembers, totalLoad, MATERIAL);

      // ── geometric 3-D assembly: deterministic resolver places every
      //    part so they touch by construction, then verify coherence ──
      plan = resolveAssembly(designedMembers);
      await buildAssembly(sysPage, plan);
      coherence = await checkAssemblyCoherence(sysPage);
      assemblyOrbit = await renderAssemblyOrbit(sysPage, { frames: 28 });
    } finally {
      await sysCtx.close();
    }
    if (sys.motion) {
      fs.writeFileSync(path.join(OUT, 'assembled-system-motion.mp4'), sys.motion.mp4);
      fs.writeFileSync(path.join(OUT, 'assembled-system-motion.avi'), sys.motion.avi);
    }
    console.log(`  SYSTEM: ${sys.result.memberCount} members assembled → `
      + `f₁ = ${sys.result.systemNaturalFrequencyHz} Hz, system stiffness `
      + `${sys.result.systemStiffness_N_per_mm} N/mm, peak dynamic deflection `
      + `${sys.result.peakDynamicDeflection_mm} mm | `
      + `${sys.motion ? sys.motion.frameCount + '-frame assembled motion rendered' : 'no motion'}`);
    if (assemblyOrbit) {
      fs.writeFileSync(path.join(OUT, 'assembled-product-3d.mp4'), assemblyOrbit.mp4);
      fs.writeFileSync(path.join(OUT, 'assembled-product-3d.avi'), assemblyOrbit.avi);
      fs.writeFileSync(path.join(OUT, 'assembled-product-still.jpg'), assemblyOrbit.still);
    }
    console.log(`  ASSEMBLY 3D: ${assemblyOrbit ? assemblyOrbit.partCount + ' parts placed + '
      + assemblyOrbit.frameCount + '-frame orbit rendered' : 'render failed'} | `
      + `coherence: ${coherence.coherent ? 'COHERENT' : coherence.components + ' disconnected pieces'} `
      + `(${coherence.bodyCount} bodies, envelope ${coherence.envelope_mm.join('×')} mm)`);

    fs.writeFileSync(path.join(OUT, 'product.json'), JSON.stringify({
      product: graph.product, brief: BRIEF, swarmSeconds: +swarmSec,
      clarification: clar.answers,
      parts: results.map((r) => ({
        part: r.part, converged: r.converged, iterations: r.iterations,
        final: r.final, history: r.history,
      })),
      system: sys.result,
      assembly: { plan: plan.placements, coherence },
    }, null, 2));

    // ── proof: every part verified by a real, dynamic, time-stepped analysis ──
    for (const r of results) {
      expect(r.history.length).toBeGreaterThan(0);
      for (const h of r.history) {
        expect(Number.isFinite(h.SF)).toBe(true);
        expect(h.peakStress).toBeGreaterThan(0);
        expect(h.DAF).toBeGreaterThan(1);
        expect(h.freqHz).toBeGreaterThan(0);
      }
      expect(r.converged).toBe(true);
      expect(r.final.SF).toBeGreaterThanOrEqual(1.5);
      expect(r.final.SF).toBeLessThanOrEqual(3.0);
      expect(r.motion).toBeTruthy();
      expect(r.motion.frameCount).toBeGreaterThan(10);
    }
    // ── the assembled system was dynamically tested + rendered ──
    expect(sys.result.systemNaturalFrequencyHz).toBeGreaterThan(0);
    expect(sys.result.dynamicAmplificationFactor).toBeGreaterThan(1);
    expect(sys.result.memberCount).toBe(graph.parts.length);
    expect(sys.motion).toBeTruthy();
    expect(sys.motion.frameCount).toBeGreaterThan(10);
    // ── the parts were geometrically placed into a COHERENT 3-D product ──
    expect(assemblyOrbit).toBeTruthy();
    expect(assemblyOrbit.partCount).toBe(graph.parts.length);
    expect(assemblyOrbit.frameCount).toBeGreaterThan(10);
    expect(coherence.bodyCount).toBe(graph.parts.length);
    expect(coherence.coherent).toBe(true);            // ONE connected assembly
  });
});
