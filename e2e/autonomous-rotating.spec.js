import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { runShaftAgent, renderAssemblyOrbit } from './agent-runtime.js';

/*
 * Second part archetype — a ROTATING SHAFT.
 *
 * Proves the autonomous system is not hardcoded to one part type. Here
 * the agent designs a rotating shaft: a Revolve-Boss cylinder verified
 * by a rotordynamic (whirl) analysis. The closing loop runs on a
 * different criterion — the resonance margin (critical speed vs
 * operating speed) — with a different geometry tool and a different
 * dynamic analysis than the structural cantilever archetype.
 */

const CRED = path.resolve(__dirname, '..', '.llm-credentials.local.json');
const cred = fs.existsSync(CRED) ? JSON.parse(fs.readFileSync(CRED, 'utf8')) : null;
const OUT = path.resolve(__dirname, '..', 'autonomous-output');

// Steel shaft.
const MATERIAL = { name: 'AISI 4340 steel', E_MPa: 200000, density_kg_m3: 7850 };
const SHAFT = {
  name: 'high-speed drive shaft',
  length_mm: 600,
  operatingRPM: 5000,
  disk_mass_kg: 5,
};

test.describe('Autonomous agent — rotating-shaft archetype (rotordynamic loop)', () => {
  test.skip(!cred, 'no .llm-credentials.local.json — skipping live agent test');
  test.setTimeout(300000);

  test('agent designs a rotating shaft: build → rotordynamics → redesign for resonance margin', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    const r = await runShaftAgent(page, cred, SHAFT, MATERIAL);
    console.log(`\n  SHAFT (${SHAFT.name}, operating ${SHAFT.operatingRPM} RPM):`);
    for (const h of r.history) {
      console.log(`   iter ${h.iter}: agent → Ø${h.D} mm | critical ${h.crit.toFixed(0)} RPM, `
        + `f₁=${h.f1.toFixed(1)} Hz, margin ×${h.ratio.toFixed(2)} `
        + `${h.ratio >= 1.5 && h.ratio <= 3.0 ? '✓' : ''} — ${h.reasoning}`);
    }
    console.log(`  → ${r.converged ? 'CONVERGED' : 'did not converge'} in ${r.iterations} iteration(s): `
      + `Ø${r.final.D} mm, critical speed ${r.final.crit.toFixed(0)} RPM`);

    // render the designed shaft (real viewport orbit — motion)
    const orbit = await renderAssemblyOrbit(page, { frames: 24 });
    if (orbit) {
      fs.writeFileSync(path.join(OUT, 'rotating-shaft-3d.mp4'), orbit.mp4);
      fs.writeFileSync(path.join(OUT, 'rotating-shaft-still.jpg'), orbit.still);
    }
    console.log(`  rendered: ${orbit ? orbit.frameCount + '-frame shaft orbit' : 'render failed'}`);

    // ── proof: a different archetype, different tool, different dynamic analysis ──
    expect(r.archetype).toBe('rotating-shaft');
    expect(r.history.length).toBeGreaterThan(0);
    for (const h of r.history) {
      expect(h.crit).toBeGreaterThan(0);          // real critical speed every iteration
      expect(h.f1).toBeGreaterThan(0);            // real whirl frequency
    }
    expect(r.converged).toBe(true);
    expect(r.final.ratio).toBeGreaterThanOrEqual(1.5);   // safe resonance margin
    expect(r.final.ratio).toBeLessThanOrEqual(3.0);
    expect(orbit).toBeTruthy();
    expect(orbit.frameCount).toBeGreaterThan(10);
  });
});
