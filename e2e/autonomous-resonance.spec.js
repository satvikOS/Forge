import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { runResonanceAgent, renderAssemblyOrbit } from './agent-runtime.js';

/*
 * Third part archetype — a RESONANCE-AVOIDANCE mount.
 *
 * The agent designs an instrument mount verified by a dynamic analysis,
 * but on a different design driver than the cantilever (stress) or the
 * shaft (critical speed): frequency separation — the mount's natural
 * frequency must sit clear of the machine's excitation frequency. Same
 * closing-loop pattern, a genuinely distinct engineering criterion.
 */

const CRED = path.resolve(__dirname, '..', '.llm-credentials.local.json');
const cred = fs.existsSync(CRED) ? JSON.parse(fs.readFileSync(CRED, 'utf8')) : null;
const OUT = path.resolve(__dirname, '..', 'autonomous-output');

const MATERIAL = { name: 'aluminium 6061', E_MPa: 69000, nu: 0.33, yield_MPa: 276, density: 2700 };
const MOUNT = { name: 'instrument mount bracket', reach_mm: 180, excitationHz: 120 };

test.describe('Autonomous agent — resonance-avoidance archetype', () => {
  test.skip(!cred, 'no .llm-credentials.local.json — skipping live agent test');
  test.setTimeout(300000);

  test('agent designs a mount: build → dynamic analysis → redesign to clear resonance', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    const r = await runResonanceAgent(page, cred, MOUNT, MATERIAL);
    console.log(`\n  MOUNT (${MOUNT.name}, machine excitation ${MOUNT.excitationHz} Hz):`);
    for (const h of r.history) {
      console.log(`   iter ${h.iter}: agent → b=${h.b} h=${h.h} mm | f₁=${h.f1.toFixed(1)} Hz, `
        + `separation ×${h.ratio.toFixed(2)} `
        + `${h.ratio >= 1.5 && h.ratio <= 4.0 ? '✓' : ''} — ${h.reasoning}`);
    }
    console.log(`  → ${r.converged ? 'CONVERGED' : 'did not converge'} in ${r.iterations} iteration(s): `
      + `f₁=${r.final.f1.toFixed(1)} Hz, ×${r.final.ratio.toFixed(2)} clear of ${MOUNT.excitationHz} Hz`);

    const orbit = await renderAssemblyOrbit(page, { frames: 24 });
    if (orbit) {
      fs.writeFileSync(path.join(OUT, 'resonance-mount-3d.mp4'), orbit.mp4);
      fs.writeFileSync(path.join(OUT, 'resonance-mount-still.jpg'), orbit.still);
    }
    console.log(`  rendered: ${orbit ? orbit.frameCount + '-frame mount orbit' : 'render failed'}`);

    // ── proof: a third archetype, a distinct dynamic design driver ──
    expect(r.archetype).toBe('resonance-mount');
    expect(r.history.length).toBeGreaterThan(0);
    for (const h of r.history) expect(h.f1).toBeGreaterThan(0);
    expect(r.converged).toBe(true);
    expect(r.final.ratio).toBeGreaterThanOrEqual(1.5);   // clear of resonance
    expect(r.final.ratio).toBeLessThanOrEqual(4.0);
    expect(orbit).toBeTruthy();
    expect(orbit.frameCount).toBeGreaterThan(10);
  });
});
