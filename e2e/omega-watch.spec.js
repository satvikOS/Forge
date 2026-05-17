import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {
  clarifyBrief, decomposeMechanism, runSwarm,
  resolveStackedAssembly, buildAssembly, checkAssemblyCoherence, renderAssemblyOrbit,
} from './agent-runtime.js';

/*
 * Omega next-gen mechanical wristwatch — built end-to-end by the ArchDisc
 * autonomous design system (GPT-4.1 via the configured BYO-LLM key).
 *
 * HONEST SCOPE: the platform decomposes the watch and designs + verifies
 * each part against its REAL load with the dynamic closing loop — case /
 * caseback / crystal vs water-resistance pressure, the movement holder vs
 * shock, the lugs vs strap loads, the rotor as a rotating part. It does
 * NOT have horological physics — the timekeeping movement (gear ratios,
 * escapement, mainspring, balance frequency) is not engineered, and parts
 * are sized as primitives, not watch-shaped geometry.
 */

const CRED = path.resolve(__dirname, '..', '.llm-credentials.local.json');
const cred = fs.existsSync(CRED) ? JSON.parse(fs.readFileSync(CRED, 'utf8')) : null;
const OUT = path.resolve(__dirname, '..', 'autonomous-output');

const BRIEF = 'A next-generation mechanical wristwatch for Omega — a Seamaster-class automatic '
  + 'dive watch. It needs a stainless-steel case rated for deep-water resistance, a sapphire '
  + 'crystal, a screw-down caseback, the movement mainplate and bridges, an automatic-winding '
  + 'rotor, and lugs carrying the strap. It must survive deep-water pressure, impact/shock, '
  + 'and daily-wear loads.';

test.describe('Omega watch — autonomous end-to-end build on ArchDisc', () => {
  test.skip(!cred, 'no .llm-credentials.local.json — skipping live agent test');
  test.setTimeout(900000);

  test('GPT-4.1 builds the Omega watch: clarify → decompose → swarm → assemble → verify → render', async ({ browser }) => {
    fs.mkdirSync(OUT, { recursive: true });

    // ── clarify ──
    const clar = await clarifyBrief(cred, BRIEF);
    console.log(`\n  CLARIFIER — ${clar.questions.length} questions:`);
    for (const a of clar.answers) console.log(`   Q: ${a.q} → ${a.chosen}`);

    // ── decompose into typed watch parts ──
    const graph = await decomposeMechanism(cred, clar.clarifiedBrief);
    console.log(`\n  WATCH: ${graph.product} — ${graph.parts.length} parts`);
    for (const p of graph.parts) console.log(`   - ${p.name} [type: ${p.type}]`);
    expect(graph.parts.length).toBeGreaterThanOrEqual(4);

    // ── swarm: each part designed by its archetype closing loop ──
    console.log('\n  SWARM — agents designing each part:');
    const results = await runSwarm(browser, cred, graph.parts, null,
      { concurrency: 3, log: (m) => console.log(m) });
    for (const r of results) {
      console.log(`  [${r.converged ? 'OK  ' : 'FAIL'}] ${r.part} <${r.archetype}>: `
        + `${r.iterations} iter`);
    }
    const passed = results.filter((r) => r.converged).length;
    console.log(`\n  ${passed}/${results.length} watch parts designed + dynamically verified`);

    // ── assemble the watch (stacked along the case axis) ──
    const sysCtx = await browser.newContext();
    const sysPage = await sysCtx.newPage();
    let coherence, orbit, plan;
    try {
      await sysPage.goto('/');
      await sysPage.locator('canvas').first().waitFor({ state: 'visible', timeout: 30000 });
      await sysPage.waitForTimeout(2000);
      plan = resolveStackedAssembly(results.map((r) => ({ name: r.part, geometry: r.geometry })));
      await buildAssembly(sysPage, plan);
      coherence = await checkAssemblyCoherence(sysPage);
      orbit = await renderAssemblyOrbit(sysPage, { frames: 28 });
    } finally {
      await sysCtx.close();
    }
    if (orbit) {
      fs.writeFileSync(path.join(OUT, 'omega-watch-3d.mp4'), orbit.mp4);
      fs.writeFileSync(path.join(OUT, 'omega-watch-still.jpg'), orbit.still);
    }
    console.log(`  ASSEMBLY: ${plan.placements.length} parts stacked (${plan.totalHeight_mm} mm tall) | `
      + `coherence: ${coherence.coherent ? 'COHERENT' : coherence.components + ' pieces'} | `
      + `${orbit ? orbit.frameCount + '-frame render' : 'no render'}`);

    fs.writeFileSync(path.join(OUT, 'omega-watch.json'), JSON.stringify({
      product: graph.product, brief: BRIEF,
      scope: 'structural + pressure-boundary parts verified against real loads; '
        + 'horological movement (timekeeping) NOT engineered — platform has no horological physics',
      clarification: clar.answers,
      parts: results.map((r) => ({
        part: r.part, archetype: r.archetype, converged: r.converged,
        iterations: r.iterations, final: r.final, geometry: r.geometry,
      })),
      assembly: { stack: plan.placements.map((p) => p.name), coherence },
    }, null, 2));

    // ── proof: every part designed against a real load + coherent assembly ──
    for (const r of results) {
      expect(r.history.length).toBeGreaterThan(0);
      expect(r.converged).toBe(true);
      expect(r.geometry).toBeTruthy();
    }
    expect(coherence.coherent).toBe(true);
    expect(orbit).toBeTruthy();
    expect(orbit.frameCount).toBeGreaterThan(10);
  });
});
