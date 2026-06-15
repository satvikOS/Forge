// Forge STAGED REFINEMENT proof (#67) — runForgePrompt advances blockout → detail →
// validate, re-prompting per stage instead of single-shot. Driven by a stub Archie
// that builds in stage 1, fillets the SAME part in stage 2 (handle read back from the
// tool_response), validates in stage 3 — proving the staged loop + lineage.
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';

test('Forge staged refinement (blockout → detail → validate)', async () => {
  test.setTimeout(4 * 60 * 1000);
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 10 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.reload();
  await win.waitForTimeout(2500);
  await win.waitForFunction(() => typeof window.__forgeRunStaged === 'function' && window.forge && window.forge.isReady && window.forge.isReady(), { timeout: 40000 });

  const r = await win.evaluate(async () => {
    const emitted = new Set();
    const archie = async ({ messages }) => {
      const all = messages.map((m) => m.content).join('\n');
      const sm = [...all.matchAll(/<stage>(\d)\//g)]; // LATEST stage tag (history holds all)
      const stage = sm.length ? Number(sm[sm.length - 1][1]) : 1;
      const handles = [...all.matchAll(/"shape":(\d+)/g)].map((m) => Number(m[1]));
      const lastH = handles.length ? handles[handles.length - 1] : 1;
      if (emitted.has(stage)) return 'stage complete.'; // → no tool_calls → advance
      emitted.add(stage);
      if (stage === 1) return '<plan>{"goal":"bracket","discipline":"part"}</plan>\n<tool_call>{"name":"part.make-box","arguments":{"dx":50,"dy":50,"dz":50}}</tool_call>';
      if (stage === 2) return `<tool_call>{"name":"part.fillet","arguments":{"shape":${lastH},"radius":6}}</tool_call>`;
      return `<tool_call>{"name":"part.check-validity","arguments":{"shape":${lastH}}}</tool_call>`;
    };
    const stageEvents = [];
    const trace = await window.__forgeRunStaged({ prompt: 'a finished mounting block', archie, forge: window.forge, gate: false,
      onTrace: (e) => { if (e && e.kind === 'stage') stageEvents.push(e.stage); } });
    const tools = trace.iterations.flatMap((it) => (it.toolResponses || []).map((t) => ({ tool: t.tool, ok: t.ok })));
    return { stages: trace.final && trace.final.stages, stageEvents, tools };
  });
  console.log('[forge-staged] ' + JSON.stringify(r));
  const names = r.tools.map((t) => t.tool);
  console.log(`\n=== FORGE STAGED: ${r.stages} stages, transitions=${JSON.stringify(r.stageEvents)}, tools=${JSON.stringify(names)} ===`);
  await app.close();

  expect(r.stages).toBe(3);                                  // ran 3 stages
  expect(r.stageEvents).toEqual([1, 2]);                      // advanced into stage 2 then 3
  expect(names).toContain('part.make-box');                   // blockout
  expect(names).toContain('part.fillet');                     // detail (same part)
  expect(names).toContain('part.check-validity');             // validate
});
