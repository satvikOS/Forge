// Forge selection-aware edit + parametric-adjust proof (tasks #56/#59/#60).
//  #56  re-parametrize a built body (slider adjust) — deterministic, dimension scales.
//  #59  selection → <viewport_state> context Archie reads (forgeSelectionContext).
//  #60  edit the SELECTED body in place (a context-aware agent fillets the right handle).
import { test, _electron as electron } from '@playwright/test';
import { expect } from '@playwright/test';
import path from 'path';

test('Forge selection-aware edit + parametric adjust', async () => {
  test.setTimeout(4 * 60 * 1000);
  const app = await electron.launch({ args: [path.join(__dirname, '..', '..', 'electron', 'main.js'), '--dev'], slowMo: 10 });
  let win = await app.firstWindow();
  if (win.url().startsWith('devtools://')) win = (await app.windows()).find((w) => !w.url().startsWith('devtools://')) || await app.waitForEvent('window', { predicate: (w) => !w.url().startsWith('devtools://') });
  win.on('dialog', (d) => d.dismiss().catch(() => {}));
  await win.waitForLoadState('domcontentloaded');
  await win.reload();
  await win.waitForTimeout(2500);
  await win.waitForFunction(() => !!(window.__forgeEngine && window.forge && window.forge.isReady && window.forge.isReady() && typeof window.__forgeSelectionContext === 'function'), { timeout: 40000 });

  // ---- #56 parametric re-adjust: OD scales deterministically ----
  const reparam = await win.evaluate(async () => {
    const bbx = (h) => { const m = window.forge.tessellate(h, 0.4, 0.5); let mn = 1e9, mx = -1e9; const p = m.positions; for (let i = 0; i < p.length; i += 3) { if (p[i] < mn) mn = p[i]; if (p[i] > mx) mx = p[i]; } return Math.round(mx - mn); };
    const r80 = await window.__forgeEngine.dispatchToolCall({ name: 'asset.make-flange', arguments: { od: 80, thick: 10, bore: 25, bolts: 6 } });
    const r140 = await window.__forgeEngine.dispatchToolCall({ name: 'asset.make-flange', arguments: { od: 140, thick: 10, bore: 25, bolts: 6 } });
    return { od80: bbx(r80.result.shape), od140: bbx(r140.result.shape) };
  });
  console.log('[forge-edit] re-param flange OD: ' + JSON.stringify(reparam));

  // ---- #59 selection context: build 2 bodies, select one, read the context ----
  const ctx = await win.evaluate(async () => {
    const a = await window.__forgeEngine.dispatchToolCall({ name: 'asset.make-flange', arguments: { od: 80, thick: 10, bore: 25, bolts: 6 } });
    const b = await window.__forgeEngine.dispatchToolCall({ name: 'part.make-box', arguments: { dx: 50, dy: 50, dz: 50 } });
    window.__forgeAppendBody({ id: 'b-flange', kind: 'native', handle: a.result.shape, toolId: 'asset.make-flange', params: { od: 80, thick: 10, bore: 25, bolts: 6 }, name: 'Flange' });
    window.__forgeAppendBody({ id: 'b-box', kind: 'native', handle: b.result.shape, toolId: 'part.make-box', params: { dx: 50, dy: 50, dz: 50 }, name: 'Block' });
    await new Promise((r) => setTimeout(r, 300));
    if (typeof window.__forgeSelect === 'function') window.__forgeSelect({ id: 'b-box' });
    await new Promise((r) => setTimeout(r, 200));
    const s = window.__forgeSelectionContext();
    return { context: s, tubeHandle: b.result.shape };
  });
  console.log('[forge-edit] selection context:\n' + ctx.context);

  // ---- #60 edit the SELECTED body: a context-aware agent fillets the right handle ----
  const edited = await win.evaluate(async (tubeHandle) => {
    // stub agent: read the [SELECTED] handle from the injected <viewport_state>
    // and fillet THAT body — proving selection→context→correct-edit plumbing.
    const archie = async ({ messages }) => {
      const userMsg = messages.map((m) => m.content).join('\n');
      const m = userMsg.match(/handle=(\d+)[^\n]*\[SELECTED\]/);
      if (!m) return 'no selection found.';
      return `<plan>{"goal":"fillet selected","discipline":"part"}</plan>\n<tool_call>{"name":"part.fillet","arguments":{"shape":${m[1]},"radius":6}}</tool_call>`;
    };
    let t = 0;
    const seq = async (a) => (t++ === 0 ? archie(a) : 'done.');
    const trace = await window.__forgeEditSelected('round the edges of the selected part', { archie: seq, forge: window.forge, gate: false });
    const tc = trace.iterations.flatMap((it) => (it.toolResponses || []));
    const filletResp = tc.find((r) => r.tool === 'part.fillet');
    return {
      sawSelectedInContext: /\[SELECTED\]/.test(trace.viewportState || ''),
      targetedHandle: filletResp && filletResp.args && filletResp.args.shape,
      filletOk: !!(filletResp && filletResp.ok),
      expectedHandle: tubeHandle,
    };
  }, ctx.tubeHandle);
  console.log('[forge-edit] edit-selected: ' + JSON.stringify(edited));
  console.log(`\n=== FORGE EDIT: re-param OD ${reparam.od80}→${reparam.od140}; selection-context ${/\[SELECTED\]/.test(ctx.context) ? 'OK' : 'MISSING'}; edit selected handle=${edited.targetedHandle} (expected ${edited.expectedHandle}) fillet=${edited.filletOk} ===`);
  await app.close();

  // #56: OD scaled with the param (deterministic re-parametrize)
  expect(reparam.od140).toBeGreaterThan(reparam.od80 + 40);
  // #59: selection reached the context
  expect(ctx.context).toContain('[SELECTED]');
  // #60: the edit targeted the SELECTED body's handle and the fillet applied
  expect(edited.sawSelectedInContext).toBe(true);
  expect(edited.targetedHandle).toBe(edited.expectedHandle);
  expect(edited.filletOk).toBe(true);
});
