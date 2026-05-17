import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { decomposeMechanism, runSwarm } from './agent-runtime.js';

/*
 * Autonomous MULTI-ARCHETYPE product.
 *
 * A powered mechanism decomposes into parts of different types —
 * structural brackets, a rotating shaft, an instrument mount. The
 * decomposer assigns each part a type; the parallel swarm routes each
 * to its archetype agent (structural-stress / rotordynamic / resonance),
 * each closing its own dynamic loop. Proves the system designs a product
 * built from genuinely different kinds of parts — not one repeated type.
 */

const CRED = path.resolve(__dirname, '..', '.llm-credentials.local.json');
const cred = fs.existsSync(CRED) ? JSON.parse(fs.readFileSync(CRED, 'utf8')) : null;
const OUT = path.resolve(__dirname, '..', 'autonomous-output');

const BRIEF = 'A powered cable winch: a motor-driven rotating drum shaft, structural brackets '
  + 'mounting it to a frame, and a control-box mount. Mixed mechanical product.';

test.describe('Autonomous mechanism — multi-archetype swarm', () => {
  test.skip(!cred, 'no .llm-credentials.local.json — skipping live agent test');
  test.setTimeout(600000);

  test('GPT-4.1 decomposes a powered mechanism; the swarm designs every part by its archetype', async ({ browser }) => {
    fs.mkdirSync(OUT, { recursive: true });

    const graph = await decomposeMechanism(cred, BRIEF);
    console.log(`\n  MECHANISM: ${graph.product} — ${graph.parts.length} parts`);
    for (const p of graph.parts) console.log(`   - ${p.name} [type: ${p.type}]`);
    expect(graph.parts.length).toBeGreaterThanOrEqual(3);

    // the swarm routes each typed part to its archetype agent, in parallel
    console.log('\n  SWARM — agents dispatched by part type:');
    const results = await runSwarm(browser, cred, graph.parts, null,
      { concurrency: 3, log: (m) => console.log(m) });

    for (const r of results) {
      console.log(`  [${r.converged ? 'OK  ' : 'FAIL'}] ${r.part} `
        + `<${r.archetype}>: ${r.iterations} iter`);
    }
    const passed = results.filter((r) => r.converged).length;
    const archetypes = [...new Set(results.map((r) => r.archetype))];
    console.log(`\n  ${passed}/${results.length} parts designed across `
      + `${archetypes.length} archetypes: ${archetypes.join(', ')}`);

    fs.writeFileSync(path.join(OUT, 'mechanism.json'), JSON.stringify({
      product: graph.product, brief: BRIEF,
      parts: results.map((r) => ({
        part: r.part, archetype: r.archetype, converged: r.converged,
        iterations: r.iterations, final: r.final,
      })),
    }, null, 2));

    // ── proof: a product designed from multiple genuinely different part types ──
    for (const r of results) {
      expect(r.history.length).toBeGreaterThan(0);
      expect(r.converged).toBe(true);
      expect(['structural-cantilever', 'rotating-shaft', 'resonance-mount'])
        .toContain(r.archetype);
    }
    expect(archetypes.length).toBeGreaterThanOrEqual(2);   // genuinely mixed
  });
});
