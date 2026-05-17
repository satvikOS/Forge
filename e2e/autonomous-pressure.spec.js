import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { runPressureAgent, renderAssemblyOrbit } from './agent-runtime.js';

/*
 * Fourth part archetype — a PRESSURE-LOADED PANEL.
 *
 * The agent designs a clamped square cover panel verified by a dynamic
 * analysis under a suddenly-applied uniform pressure — a distinct load
 * case from the beam (point load), shaft (rotation) and mount (vibration)
 * archetypes. Same closing-loop discipline.
 */

const CRED = path.resolve(__dirname, '..', '.llm-credentials.local.json');
const cred = fs.existsSync(CRED) ? JSON.parse(fs.readFileSync(CRED, 'utf8')) : null;
const OUT = path.resolve(__dirname, '..', 'autonomous-output');

const MATERIAL = { name: 'aluminium 6061', E_MPa: 69000, nu: 0.33, yield_MPa: 276, density: 2700 };
const PANEL = { name: 'pressure cover panel', side_mm: 300, pressure_kPa: 250 };

test.describe('Autonomous agent — pressure-panel archetype', () => {
  test.skip(!cred, 'no .llm-credentials.local.json — skipping live agent test');
  test.setTimeout(300000);

  test('agent designs a pressure panel: build → dynamic pressure analysis → redesign', async ({ page }) => {
    fs.mkdirSync(OUT, { recursive: true });
    await page.goto('/');
    await expect(page.locator('canvas').first()).toBeVisible({ timeout: 30000 });
    await page.waitForTimeout(2500);

    const r = await runPressureAgent(page, cred, PANEL, MATERIAL);
    console.log(`\n  PANEL (${PANEL.name}, ${PANEL.side_mm}mm, ${PANEL.pressure_kPa} kPa):`);
    for (const h of r.history) {
      console.log(`   iter ${h.iter}: agent → t=${h.t} mm | peak dynamic σ=${h.peakStress} MPa, `
        + `dynamic SF=${h.SF.toFixed(2)}, f₁=${h.f1} Hz `
        + `${h.SF >= 1.5 && h.SF <= 3.0 ? '✓' : ''} — ${h.reasoning}`);
    }
    console.log(`  → ${r.converged ? 'CONVERGED' : 'did not converge'} in ${r.iterations} iter(s): `
      + `t=${r.final.t} mm, dynamic SF=${r.final.SF.toFixed(2)}`);

    const orbit = await renderAssemblyOrbit(page, { frames: 24 });
    if (orbit) {
      fs.writeFileSync(path.join(OUT, 'pressure-panel-3d.mp4'), orbit.mp4);
      fs.writeFileSync(path.join(OUT, 'pressure-panel-still.jpg'), orbit.still);
    }
    console.log(`  rendered: ${orbit ? orbit.frameCount + '-frame panel orbit' : 'render failed'}`);

    // ── proof: a fourth archetype, a distinct dynamic load case ──
    expect(r.archetype).toBe('pressure-panel');
    expect(r.history.length).toBeGreaterThan(0);
    for (const h of r.history) {
      expect(h.peakStress).toBeGreaterThan(0);
      expect(h.f1).toBeGreaterThan(0);
    }
    expect(r.converged).toBe(true);
    expect(r.final.SF).toBeGreaterThanOrEqual(1.5);
    expect(r.final.SF).toBeLessThanOrEqual(3.0);
    expect(orbit).toBeTruthy();
    expect(orbit.frameCount).toBeGreaterThan(10);
  });
});
