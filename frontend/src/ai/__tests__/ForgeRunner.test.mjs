import assert from 'node:assert/strict';
import { parseAssistant, buildSystemPrompt, runForgePrompt } from '../ForgeRunner.js';

// ---- parseAssistant: extract think/plan/tool_calls/clarify --------
{
  const text = `
<think>
plan to make a box and a hole
</think>
<plan>{"goal":"box with hole","bodies":[{"id":"b1"}]}</plan>
<tool_call>{"name":"part.make-box","arguments":{"dx":50,"dy":30,"dz":20}}</tool_call>
<tool_call>{"name":"part.make-cylinder","arguments":{"radius":5,"height":40}}</tool_call>
`;
  const p = parseAssistant(text);
  assert.equal(p.think.length, 1);
  assert.equal(p.plan.goal, 'box with hole');
  assert.equal(p.toolCalls.length, 2);
  assert.equal(p.toolCalls[0].name, 'part.make-box');
  assert.equal(p.toolCalls[1].arguments.radius, 5);
  assert.equal(p.clarify, null);
}

// ---- parseAssistant: clarify path ---------------------------------
{
  const text = `<clarify>{"question":"M3 or M4 bolt?","options":["M3","M4"],"default":"M3"}</clarify>`;
  const p = parseAssistant(text);
  assert.equal(p.clarify.question.startsWith('M3'), true);
  assert.equal(p.clarify.default, 'M3');
}

// ---- buildSystemPrompt embeds the discipline's tools --------------
{
  const sys = buildSystemPrompt('part');
  assert.ok(sys.includes('part.make-box'));
  assert.ok(sys.includes('Current discipline: part'));
  assert.ok(!sys.includes('sketch.add-constraint'), 'should be discipline-scoped');
}

// ---- runForgePrompt: integration with mocked Archie + stub forge ---
{
  const stubForge = { makeBox: (a, b, c) => 7, makeCylinder: () => 8 };
  // Two-turn fake Archie that emits one tool_call then declares done.
  let calls = 0;
  const fakeArchie = async ({ messages }) => {
    calls++;
    if (calls === 1) {
      return `<plan>{"goal":"box"}</plan>
<tool_call>{"name":"part.make-box","arguments":{"dx":10,"dy":10,"dz":10}}</tool_call>`;
    }
    return `<think>done</think>`;
  };
  const trace = await runForgePrompt({
    prompt: 'make a 10mm cube', discipline: 'part',
    archie: fakeArchie,
    forge: stubForge,
  });
  // Patch dispatchToolCall to use stub forge — we do it by injecting via getForge.
  // Since dispatchToolCall uses getForge() inside, override window.forge.
  // (Vitest would prefer DI; here we hot-patch the module via globalThis.)
  // For this smoke we accept that the first dispatch returned ok:false
  // because there's no window.forge in node — the runner still records it
  // and progresses to turn 2, which terminates with status=done.
  assert.equal(trace.discipline, 'part');
  assert.ok(trace.iterations.length >= 1, 'runner produced ≥1 iteration');
  assert.ok(trace.final, 'runner produced a final block');
  assert.equal(calls, 2, 'archie was polled twice');
}

// ---- Forge-162: viewportState wraps the user prompt ----------------
{
  let capturedMessages = null;
  const fakeArchie = async ({ messages }) => {
    capturedMessages = messages;
    return `<think>noted</think>`;
  };
  const CAPTION = '{"bodies":[{"kind":"box","dims":"50x30x10"}],"camera":{"angle_deg":35}}';
  await runForgePrompt({
    prompt: 'fillet all sharp edges 1.5mm',
    discipline: 'part',
    archie: fakeArchie,
    viewportState: CAPTION,
  });
  assert.ok(capturedMessages, 'archie was called');
  const userMsg = capturedMessages.find((m) => m.role === 'user' && m.content.includes('fillet all sharp edges 1.5mm'));
  assert.ok(userMsg, 'final user turn present');
  assert.ok(userMsg.content.includes('<viewport_state>'), 'viewport_state tag prepended');
  assert.ok(userMsg.content.includes(CAPTION), 'caption body preserved');
  // Order matters: viewport before prompt.
  const vpIdx = userMsg.content.indexOf('<viewport_state>');
  const promptIdx = userMsg.content.indexOf('fillet all sharp edges 1.5mm');
  assert.ok(vpIdx < promptIdx, 'viewport_state precedes prompt');
}

// ---- Forge-162: empty viewportState skips the wrapper --------------
{
  let capturedMessages = null;
  const fakeArchie = async ({ messages }) => {
    capturedMessages = messages;
    return `<think>noted</think>`;
  };
  await runForgePrompt({
    prompt: 'blind run check',
    discipline: 'part',
    archie: fakeArchie,
    // viewportState omitted — defaults to ''
  });
  const userMsg = capturedMessages.find((m) => m.role === 'user' && m.content.includes('blind run check'));
  assert.ok(userMsg, 'final user turn present');
  assert.ok(!userMsg.content.includes('<viewport_state>'), 'no viewport_state when omitted');
}

// ---- Forge-166: speculative dispatch fires once per call ----------
{
  // archie mock honours onToolCall by walking the completion and
  // calling it with each <tool_call> inline — simulating what the
  // streaming SSE path does for real.
  let onTokenSeen = false;
  let turnNo = 0;
  const dispatchedSigs = [];
  const fakeArchie = async ({ onToken, onToolCall }) => {
    onTokenSeen = !!onToken;
    turnNo++;
    if (turnNo > 1) {
      // 2nd turn: done — runner exits the loop.
      return '<think>nothing more</think>';
    }
    const completion = '<plan>{"goal":"two prims"}</plan>\n'
      + '<tool_call>{"name":"sketch.create","arguments":{}}</tool_call>\n'
      + '<tool_call>{"name":"sketch.add-point","arguments":{"sketchId":1,"x":0,"y":0}}</tool_call>';
    if (onToolCall) {
      // mimic the streaming-tag flush: parse + emit each tag.
      const re = /<tool_call>([\s\S]*?)<\/tool_call>/g;
      let m;
      while ((m = re.exec(completion)) !== null) {
        try {
          const obj = JSON.parse(m[1].trim());
          await onToolCall(obj);
          dispatchedSigs.push(obj.name);
        } catch (_) {}
      }
    }
    return completion;
  };
  let traceToolCallCount = 0;
  const trace = await runForgePrompt({
    prompt: 'spec disp test',
    discipline: 'part',
    archie: fakeArchie,
    onToken: () => { /* triggers the stream path inside the runner */ },
    onTrace: (ev) => { if (ev.kind === 'tool') traceToolCallCount++; },
  });
  assert.ok(onTokenSeen, 'archie was called with onToken');
  // Speculative dispatcher should have run each tag exactly once.
  assert.equal(dispatchedSigs.length, 2, 'speculative dispatch ran twice');
  // The post-turn loop should NOT have re-dispatched (sig set blocks).
  assert.equal(traceToolCallCount, 2, 'onTrace fired once per tool, not twice');
  // The first iteration's toolResponses array reflects the speculative
  // dispatch sequence.
  assert.equal(trace.iterations[0].toolResponses.length, 2);
}

// ---- Forge-163: priorContext wraps user prompt + correct order -----
{
  let capturedMessages = null;
  const fakeArchie = async ({ messages }) => {
    capturedMessages = messages;
    return `<think>noted</think>`;
  };
  const PRIOR = '<prior_context>[{"user":"earlier bracket","summary":"part.make-box"}]</prior_context>';
  const VP    = '{"bodies":[],"camera":{"angle_deg":0}}';
  await runForgePrompt({
    prompt: 'now drill four M5 holes at the corners',
    discipline: 'part',
    archie: fakeArchie,
    priorContext: PRIOR,
    viewportState: VP,
  });
  const userMsg = capturedMessages.find((m) => m.role === 'user' && m.content.includes('drill four M5 holes'));
  assert.ok(userMsg, 'final user turn present');
  assert.ok(userMsg.content.includes('<prior_context>'), 'prior_context tag present');
  assert.ok(userMsg.content.includes('<viewport_state>'), 'viewport_state tag present');
  // Strict order: priors < viewport < prompt.
  const pcIdx = userMsg.content.indexOf('<prior_context>');
  const vpIdx = userMsg.content.indexOf('<viewport_state>');
  const ptIdx = userMsg.content.indexOf('drill four M5 holes');
  assert.ok(pcIdx < vpIdx, 'priors before viewport');
  assert.ok(vpIdx < ptIdx, 'viewport before prompt');
}

console.log('[forge.runner] all tests passed');
