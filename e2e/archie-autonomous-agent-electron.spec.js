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

const OUT = path.resolve(__dirname, 'screenshots', 'archie-autonomous-agent');
fs.mkdirSync(OUT, { recursive: true });
// 13-entry curriculum → 13 distinct builds, then 2 refine cycles that
// REUSE/improve learned skills (closed learning loop).
const CYCLES = 15;

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

  const tgt = { x: 2.5, y: 0.6, z: 0 };
  const capture = async (label) => {
    const angles = [
      { name: 'iso',  az: 38, el: 18, dist: 9.5 },
      { name: 'front', az: 2, el: 10, dist: 9.0 },
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

  // ── Start Archie via the ribbon (drive its dialog: bounded run + reset)
  await win.locator('[data-ribbon-tool-name="Archie Agent"]').first().dispatchEvent('click');
  const dlg = win.locator('.tpd-dialog');
  await dlg.waitFor({ state: 'visible', timeout: 8000 });
  await win.waitForTimeout(150);
  await dlg.locator('[data-field="maxCycles"]').first().fill(String(CYCLES));
  await dlg.locator('[data-field="cycleDelayMs"]').first().fill('250');
  const resetSel = dlg.locator('[data-field="reset"]').first();
  if (await resetSel.count() > 0) await resetSel.selectOption('yes');
  await win.locator('.tpd-btn-run').dispatchEvent('click');
  await dlg.waitFor({ state: 'hidden', timeout: 8000 });

  // ── Archie now runs hands-free. Wait until the loop finishes its cycles.
  await win.waitForFunction((n) => {
    const a = window.__archdiscAgent;
    return a && a.running === false && a.cycle >= n;
  }, CYCLES, { timeout: 20 * 60 * 1000 });

  const agent = await win.evaluate(() => window.__archdiscAgent);
  const skills = await win.evaluate(() => window.__archdiscAgentSkills || {});
  const memory = await win.evaluate(() => window.__archdiscAgentMemory || {});
  const bodies = await win.evaluate(() => (window.__archdiscRegistry?.list?.() || []).length);
  console.log('ARCHIE agent state:', JSON.stringify(agent, null, 1));
  console.log('ARCHIE skills:', Object.keys(skills));
  console.log('ARCHIE builtIds:', JSON.stringify(memory.builtIds));
  console.log('ARCHIE bodies built:', bodies);

  await capture('99-after');

  // ── Autonomy: ran the full cycle count on its own, no human input
  expect(agent.cycle).toBe(CYCLES);
  expect(agent.running).toBe(false);
  // ── Self-direction: chose many DISTINCT goals grounded in Mech's tools
  expect(memory.builtIds.length).toBeGreaterThanOrEqual(10);
  // ── Actually built geometry hands-free via the real ribbon tools
  expect(bodies).toBeGreaterThanOrEqual(10);
  // ── Self-improvement: auto-created skills from successful runs
  expect(Object.keys(skills).length).toBeGreaterThanOrEqual(10);
  // ── Curated persistent memory + at least one distillation nudge
  expect(memory.learnings.length).toBeGreaterThanOrEqual(1);
  expect(memory.learnings.some(l => l.source === 'nudge')).toBe(true);
  // ── Closed learning loop: the 2 refine cycles (14-15) REUSED learned
  //    skills, so at least one skill has been used more than once.
  const reused = Object.values(skills).some(s => (s.successCount || 0) >= 2);
  console.log('ARCHIE skills:', Object.values(skills).map(s => `${s.name} v${s.version} x${s.successCount} (${s.score})`));
  expect(reused).toBe(true);

  await app.close();
});
