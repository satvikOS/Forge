// Forge POST-BUILD COHERENCE GATE proof (program step C) — the live build loop
// (ForgeRunner.runForgePrompt) now runs the kernel's native validity check on every
// body Archie builds, and on failure feeds the defects back for an AutoCorrector
// repair turn instead of silently shipping a broken solid. Driven with a
// deterministic stub Archie so the gate behaviour is provable without the model.
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';

const FLANGE = '<plan>{"goal":"flange","discipline":"part"}</plan>\n'
  + '<tool_call>{"name":"asset.make-flange","arguments":{"od":80,"thick":10,"bore":25,"bolts":6,"bolt_d":8,"bcd":60}}</tool_call>';

test('Forge post-build coherence gate + AutoCorrector', async () => {
  test.setTimeout(4 * 60 * 1000);
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 10 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.reload();
  await win.waitForTimeout(2500);
  await win.waitForFunction(() => typeof window.__forgeRun === 'function' && window.forge && window.forge.isReady && window.forge.isReady(), { timeout: 40000 });

  // CASE 1 — valid build: gate runs, passes, no repair turn.
  const ok = await win.evaluate(async (FLANGE) => {
    let t = 0;
    const archie = async () => (t++ === 0 ? FLANGE : 'all done.');
    const trace = await window.__forgeRun({ prompt: 'a Ø80 flange', discipline: 'part', archie, forge: window.forge, gate: true });
    return { checked: trace.gateChecks && trace.gateChecks.checked, allValid: trace.gateChecks && trace.gateChecks.allValid, status: trace.final && trace.final.status, iters: trace.iterations.length };
  }, FLANGE);
  console.log('[forge-gate] valid-build: ' + JSON.stringify(ok));

  // CASE 2 — forced invalid: gate fires an AutoCorrector repair turn.
  // window.forge is a frozen contextBridge proxy (can't reassign heal.checkValidity),
  // so pass a delegating proxy that overrides ONLY checkValidity → reports invalid.
  const repaired = await win.evaluate(async (FLANGE) => {
    const real = window.forge;
    // Plain shallow copy (contextBridge props are non-configurable → Proxy can't
    // substitute heal; Object.keys enumerates, methods are closures so refs suffice).
    const fakeForge = {}; for (const k of Object.keys(real)) fakeForge[k] = real[k];
    const fakeHeal = {}; for (const k of Object.keys(real.heal)) fakeHeal[k] = real.heal[k];
    fakeHeal.checkValidity = () => ({ ok: false, manifold: false, description: 'forced-invalid (gate test)' });
    fakeForge.heal = fakeHeal;
    let t = 0, gateEvents = 0;
    const archie = async () => (t++ === 0 ? FLANGE : 'all done.');
    const trace = await window.__forgeRun({ prompt: 'a Ø80 flange', discipline: 'part', archie, forge: fakeForge, gate: true, maxGateRepairs: 1,
      onTrace: (e) => { if (e && e.kind === 'gate') gateEvents++; } });
    return { gateEvents, allValid: trace.gateChecks && trace.gateChecks.allValid, defects: trace.gateChecks && trace.gateChecks.defects && trace.gateChecks.defects.length, iters: trace.iterations.length };
  }, FLANGE);
  console.log('[forge-gate] forced-invalid: ' + JSON.stringify(repaired));

  console.log(`\n=== FORGE GATE PROOF: valid build checked=${ok.checked} allValid=${ok.allValid}; forced-invalid fired ${repaired.gateEvents} repair turn(s), ${repaired.defects} defect(s) ===`);
  await app.close();

  // valid build: at least one body checked, all valid, finished done
  expect(ok.checked).toBeGreaterThanOrEqual(1);
  expect(ok.allValid).toBe(true);
  expect(ok.status).toBe('done');
  // forced invalid: gate detected defects and triggered a repair turn
  expect(repaired.allValid).toBe(false);
  expect(repaired.defects).toBeGreaterThanOrEqual(1);
  expect(repaired.gateEvents).toBeGreaterThanOrEqual(1);
});
