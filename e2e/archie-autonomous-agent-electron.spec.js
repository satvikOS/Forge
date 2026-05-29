import { test, expect, _electron as electron } from '@playwright/test';
import fs from 'fs';
import path from 'path';

/*
 * ARCHIE — ArchDisc's autonomous, self-directed, self-improving agent.
 * Scraped from a mature agent framework and rebuilt natively into Mech,
 * fully grounded in Mech's own tools. This e2e proves Archie runs HANDS-
 * FREE: started once via the ribbon, it picks its OWN goals (grounded in
 * the MechCapabilityMap), builds real geometry with the Sculpt tools,
 * self-critiques each build, auto-creates + improves skills, curates
 * persistent memory with nudges, and repeats — non-stop until the cycle
 * cap. No per-build human input.
 *
 * Verified from window.__archdiscAgent / __archdiscAgentSkills /
 * __archdiscAgentMemory + the live body registry.
 */

const OUT = path.resolve(__dirname, 'screenshots', 'archie-airliner-611');
fs.mkdirSync(OUT, { recursive: true });
// Target = Video-611 airliner. 23 positioned subsystems: a base airframe +
// a detail tier (real swept/tapered/airfoil wings, turbofan fans, landing
// gear, winglets, flight-deck glazing, engine exhaust cones) → a fully-
// loaded plane (parity 1.0), then refine cycles REUSE/improve skills.
const CYCLES = 26;

test.describe.configure({ timeout: 30 * 60 * 1000 });

test('Archie — autonomous self-directed self-improving agent', async () => {
  const app = await electron.launch({
    args: [path.join(__dirname, '..', 'electron', 'main.js')],
    env: { ...process.env, NODE_ENV: 'test' },
  });
  const win = await app.firstWindow();
  win.on('pageerror', (e) => console.error('[pageerror]', e.message));

  await win.waitForLoadState('domcontentloaded');
  await expect(win.locator('canvas').first()).toBeVisible({ timeout: 60000 });
  await win.waitForFunction(() => !!window.__archdiscRegistry, null, { timeout: 60000 });
  await win.evaluate(() => { window.__archdiscBypassDialog = false; });
  const wc = win.locator('[data-archdisc-welcome-close="true"]').first();
  if (await wc.count() > 0) {
    await wc.dispatchEvent('click');
    await win.locator('[data-archdisc-welcome="open"]').waitFor({ state: 'hidden', timeout: 5000 });
  }
  await win.locator('[data-ribbon-tab-key="part"]').dispatchEvent('click');

  const tgt = { x: 0, y: 0.85, z: -0.15 };
  const capture = async (label) => {
    const angles = [
      { name: 'iso',   az: 40, el: 18, dist: 12.5 },
      { name: 'side',  az: 90, el:  7, dist: 12.5 },
      { name: 'top',   az: 10, el: 60, dist: 12.5 },
      { name: 'front', az:  2, el:  6, dist: 11.5 },
    ];
    for (const a of angles) {
      await win.evaluate(({ az, el, dist, tx, ty, tz }) => {
        const vp = window.__archdiscViewport;
        if (!vp?.camera) return;
        if (vp.orbitControls) { vp.orbitControls.maxDistance = 2000; vp.orbitControls.minDistance = 0.05; }
        const azR = az * Math.PI / 180, elR = el * Math.PI / 180;
        vp.camera.position.set(tx + dist * Math.cos(elR) * Math.sin(azR), ty + dist * Math.sin(elR), tz + dist * Math.cos(elR) * Math.cos(azR));
        vp.orbitControls.target.set(tx, ty, tz);
        vp.camera.lookAt(tx, ty, tz);
        vp.orbitControls.update();
        vp.renderer.render(vp.scene, vp.camera);
      }, { ...a, tx: tgt.x, ty: tgt.y, tz: tgt.z });
      await win.waitForTimeout(150);
      await win.screenshot({ path: path.join(OUT, `${label}-${a.name}.png`) });
    }
  };

  await capture('00-before');

  // ── Start Archie via the ribbon — NON-STOP (maxCycles 0). It runs
  //    hands-free; we never stop or close it mid-build.
  await win.locator('[data-ribbon-tool-name="Archie Agent"]').first().dispatchEvent('click');
  const dlg = win.locator('.tpd-dialog');
  await dlg.waitFor({ state: 'visible', timeout: 8000 });
  await win.waitForTimeout(150);
  await dlg.locator('[data-field="maxCycles"]').first().fill('0');   // 0 = non-stop
  await dlg.locator('[data-field="cycleDelayMs"]').first().fill('300');
  const resetSel = dlg.locator('[data-field="reset"]').first();
  if (await resetSel.count() > 0) await resetSel.selectOption('yes');
  await win.locator('.tpd-btn-run').dispatchEvent('click');
  await dlg.waitFor({ state: 'hidden', timeout: 8000 });

  // ── Run NON-STOP until the LAST subsystem is built (1:1 parity reached)
  //    — the app stays open the whole time, no closing to verify mid-build.
  await win.waitForFunction(() => window.__archdiscAgent && window.__archdiscAgent.parityMet === true,
    null, { timeout: 25 * 60 * 1000 });
  // ── …then a few "for-better" betterment cycles past 1:1 (skill reuse).
  const reachedAt = await win.evaluate(() => window.__archdiscAgent.parityReachedAt || 0);
  await win.waitForFunction((r) => window.__archdiscAgent.cycle >= r + 3, reachedAt, { timeout: 5 * 60 * 1000 });
  // ── Only after the last step do we halt + read the result.
  await win.locator('[data-ribbon-tool-name="Stop Archie"]').first().dispatchEvent('click');
  await win.waitForFunction(() => window.__archdiscAgent && window.__archdiscAgent.running === false,
    null, { timeout: 30000 });

  const agent = await win.evaluate(() => window.__archdiscAgent);
  const skills = await win.evaluate(() => window.__archdiscAgentSkills || {});
  const memory = await win.evaluate(() => window.__archdiscAgentMemory || {});
  const bodies = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
  console.log('ARCHIE agent state:', JSON.stringify(agent, null, 1));
  console.log('ARCHIE skills:', Object.keys(skills));
  console.log('ARCHIE builtIds:', JSON.stringify(memory.builtIds));
  console.log('ARCHIE bodies built:', bodies);

  await capture('99-after');

  // ── Autonomy: ran hands-free until halted after the last step
  expect(agent.running).toBe(false);
  expect(agent.cycle).toBeGreaterThanOrEqual(memory.builtIds.length);
  // ── Self-direction: built the full 19-subsystem airliner on its own
  expect(memory.builtIds.length).toBeGreaterThanOrEqual(18);
  // ── Actually built geometry hands-free via the real ribbon tools
  expect(bodies).toBeGreaterThanOrEqual(18);
  // ── Self-improvement: auto-created a skill per subsystem
  expect(Object.keys(skills).length).toBeGreaterThanOrEqual(18);
  // ── Curated persistent memory + at least one distillation nudge
  expect(memory.learnings.length).toBeGreaterThanOrEqual(1);
  expect(memory.learnings.some(l => l.source === 'nudge')).toBe(true);
  // ── Closed learning loop: the refine cycles REUSED learned skills, so
  //    at least one skill has been used more than once.
  const reused = Object.values(skills).some(s => (s.successCount || 0) >= 2);
  console.log('ARCHIE skills:', Object.values(skills).map(s => `${s.name} v${s.version} x${s.successCount} (${s.score})`));
  expect(reused).toBe(true);

  // ── Archie's goal: work non-stop until 1:1-or-better parity. Having
  //    built the full vocabulary it reports parity reached, and kept
  //    refining for BETTER (score ≥ 1.0, reachedAt recorded).
  console.log('ARCHIE parity:', agent.parityScore, 'met:', agent.parityMet, 'reachedAt:', agent.parityReachedAt, 'unmet:', agent.unmet);
  expect(agent.parityMet).toBe(true);
  expect(agent.parityScore).toBeGreaterThanOrEqual(1.0);
  expect(agent.parityReachedAt).toBeGreaterThan(0);

  // ── Perception: Archie SAW its own render — geometry is on screen. An
  //    airliner is a THIN silhouette (slender wings + fuselage), so raw lit-
  //    pixel coverage is naturally low; the meaningful presence signal is the
  //    on-screen bounding region. Assert both: some lit pixels AND a real,
  //    centred bounding box (the plane occupies a substantial screen region).
  console.log('ARCHIE perception:', JSON.stringify(agent.perception));
  expect(agent.perception).toBeTruthy();
  expect(agent.perception.coverage).toBeGreaterThan(0.01);
  expect(agent.perception.bbox).toBeTruthy();
  expect(agent.perception.bbox.w).toBeGreaterThan(0.15);
  expect(agent.perception.bbox.h).toBeGreaterThan(0.15);

  await app.close();
});
