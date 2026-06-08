/**
 * ForgeRunner — the autonomous-build entry point that wires local Archie
 * (~/archdisc-Models, MLX-LM server on localhost:8080) to Forge's
 * native kernel via ForgeToolBridge.
 *
 * The flow per `__forgeRun({ prompt, discipline })`:
 *   1. Build the Archie system prompt with the discipline's tool slice.
 *   2. Stream a completion from the local mlx_lm.server.
 *   3. Parse each `<tool_call>` as it lands, dispatch via ForgeToolBridge.
 *   4. Send the tool_response back as the next user turn until the model
 *      stops emitting tool_calls.
 *   5. Return the final trace (plan + tool_calls + responses + any
 *      `<clarify>`) so the renderer can surface a recap.
 *
 * This module is small on purpose: it composes existing primitives
 * (ForgeToolBridge.dispatchToolCall, PlannerProviders.compatible) into
 * a runnable loop. The training-side runtime trace captured per call
 * matches the contract at ~/archdisc-Models/runtime/trace.md so nightly
 * retrain folds Forge sessions back into the dataset automatically.
 */

import { dispatchToolCall, systemPromptTools } from './ForgeToolBridge.js';
import { getPersona, normaliseDiscipline } from './disciplinePersonas.js';

const ARCHIE_BASE_URL = 'http://localhost:8080';

const SYSTEM_TEMPLATE = (discipline, toolsJson) => `You are Archie, the autonomous build engine for ArchDisc Forge.
Current discipline: ${discipline}.

Strict rules — non-negotiable:
 R1. Every tool_call.name MUST exist in the <tools> block. Never invent ids.
 R2. Build every component from primitives; no asset imports.
 R3. Coherent geometry: positive dimensions, valid normals, closed solids.
 R4. If you cannot satisfy the request with these tools, emit a single <clarify> block.

Output protocol:
 - Emit one <think>...</think> block to reason.
 - Emit one <plan>{...}</plan> with goal + bodies + expect.
 - Emit one or more <tool_call>{"name":"<id>","arguments":{...}}</tool_call> in order.
 - After each tool_response, continue from the new scene state.

<tools>
${toolsJson}
</tools>`;

const TOOL_CALL_RE = /<tool_call>([\s\S]*?)<\/tool_call>/g;
const CLARIFY_RE   = /<clarify>([\s\S]*?)<\/clarify>/g;
const THINK_RE     = /<think>([\s\S]*?)<\/think>/g;
const PLAN_RE      = /<plan>([\s\S]*?)<\/plan>/g;

export function buildSystemPrompt(discipline) {
  const tools = JSON.stringify(systemPromptTools(discipline), null, 2);
  return SYSTEM_TEMPLATE(discipline, tools);
}

/**
 * Forge-113 — compose the persona + base system prompt + few-shot
 * examples into the OpenAI-compat message array Archie consumes.
 *
 * The persona system message goes FIRST so the model reads "who you
 * are right now" before the strict-rules + <tools> JSON block.
 * Few-shot turns are then injected as alternating user/assistant
 * messages so the conversation pattern matches the LoRA training mix.
 *
 * The composed persona is also exposed on the renderer at
 * `window.__forgeLastPersona` so the e2e suite can introspect which
 * persona actually drove the latest run.
 */
export function buildMessages({ prompt, discipline }) {
  const persona = getPersona(discipline);
  const baseSystem = buildSystemPrompt(discipline);
  const personaSystem = persona.system + '\n\n' + baseSystem;
  const messages = [{ role: 'system', content: personaSystem }];
  for (const ex of persona.examples) {
    messages.push({ role: 'user', content: ex.user });
    messages.push({ role: 'assistant', content: ex.assistant });
  }
  messages.push({ role: 'user', content: prompt });
  if (typeof globalThis !== 'undefined') {
    globalThis.__forgeLastPersona = {
      id: persona.id,
      requested: discipline,
      normalised: normaliseDiscipline(discipline),
      tools: persona.tools,
      exampleCount: persona.examples.length,
      systemHead: personaSystem.slice(0, 240),
      ts: new Date().toISOString(),
    };
  }
  return { messages, persona };
}

/**
 * Parse all complete tool_calls / clarifies / think / plan blocks from
 * a partial assistant turn. Returns the structured pieces in order.
 */
export function parseAssistant(text) {
  const out = { think: [], plan: null, toolCalls: [], clarify: null };
  let m;
  while ((m = THINK_RE.exec(text)) !== null) out.think.push(m[1].trim());
  THINK_RE.lastIndex = 0;
  while ((m = PLAN_RE.exec(text)) !== null) {
    try { out.plan = JSON.parse(m[1]); } catch { /* malformed plan — ignore for now */ }
  }
  PLAN_RE.lastIndex = 0;
  while ((m = TOOL_CALL_RE.exec(text)) !== null) {
    try { out.toolCalls.push(JSON.parse(m[1])); } catch { /* skip malformed */ }
  }
  TOOL_CALL_RE.lastIndex = 0;
  while ((m = CLARIFY_RE.exec(text)) !== null) {
    try { out.clarify = JSON.parse(m[1]); } catch { /* skip */ }
  }
  CLARIFY_RE.lastIndex = 0;
  return out;
}

/**
 * One-shot Archie call. Returns the assistant text. The Archie fleet
 * speaks OpenAI-compat at localhost:8080, so we use plain fetch. The
 * adapter is selected per-discipline (see ~/archdisc-Models adapter
 * layout); the server routes adapters/archie/mech/${discipline}.
 */
async function archieComplete({ messages, discipline, model = 'archie-7b-base',
                                temperature = 0.2, maxTokens = 2048,
                                baseUrl = ARCHIE_BASE_URL, signal }) {
  const adapter = `adapters/archie/mech/${discipline}`;
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, messages, temperature, max_tokens: maxTokens,
      adapters: adapter, // mlx_lm.server hot-swap convention
      stream: false,
    }),
    signal,
  });
  if (!res.ok) {
    throw new Error(`[forge.runner] Archie ${res.status} ${res.statusText}`);
  }
  const j = await res.json();
  return j.choices?.[0]?.message?.content ?? '';
}

/**
 * Drive Archie through one or more tool-call turns. Returns when the
 * model emits no further tool_calls (i.e. it's done or has asked for
 * clarification). `onTrace(event)` lets the caller stream UI updates.
 */
export async function runForgePrompt({
  prompt, discipline = 'part', maxTurns = 8,
  onTrace = () => {},
  autoDefaultClarify = false,
  archie = archieComplete,
  forge,
  signal = null,         // Forge-28: AbortSignal, honoured by archieComplete
  viewportState = '',    // Forge-162: vision caption prepended to user prompt
} = {}) {
  if (!prompt || typeof prompt !== 'string') {
    throw new Error('[forge.runner] prompt required');
  }
  const trace = {
    runId: `forge-${new Date().toISOString().replace(/[:.]/g, '-')}-${Math.random().toString(36).slice(2, 6)}`,
    ts: new Date().toISOString(),
    discipline, prompt,
    iterations: [],
    final: null,
  };

  // Forge-162 — viewport perception. When the UI tier captured a live
  // VL caption it arrives as `viewportState`. Wrap it in the same
  // <viewport_state> tag Studio uses (slice 951q) so the Archie LoRAs
  // see one consistent perception schema across both apps.
  const userPrompt = viewportState
    ? `<viewport_state>${viewportState}</viewport_state>\n\n${prompt}`
    : prompt;
  trace.viewportState = viewportState || null;

  // Forge-113 — persona-aware composition. Replaces the legacy
  // [system, user] pair with [persona+system, ...few-shot, user].
  const { messages, persona } = buildMessages({ prompt: userPrompt, discipline });
  trace.persona = { id: persona.id, exampleCount: persona.examples.length,
                    toolCount: persona.tools.length };

  for (let turn = 0; turn < maxTurns; turn++) {
    if (signal && signal.aborted) {
      trace.final = { status: 'cancelled' };
      await _flushIfEnabled(trace);
      return trace;
    }
    const completion = await archie({ messages, discipline, signal });
    const parsed = parseAssistant(completion);
    const iter = { turn, completion, parsed, toolResponses: [] };

    if (parsed.clarify) {
      iter.clarifyHandled = autoDefaultClarify
        ? { decision: 'default', value: parsed.clarify.default }
        : { decision: 'asked' };
      onTrace({ kind: 'clarify', iter });
      trace.iterations.push(iter);
      trace.final = { status: 'clarify', clarify: parsed.clarify };
      await _flushIfEnabled(trace);
      return trace;
    }

    if (parsed.toolCalls.length === 0) {
      trace.iterations.push(iter);
      trace.final = { status: 'done', text: completion };
      onTrace({ kind: 'done', iter });
      await _flushIfEnabled(trace);
      return trace;
    }

    // Dispatch every tool_call in order; aggregate responses for the next turn.
    for (const call of parsed.toolCalls) {
      const resp = await dispatchToolCall(call, forge ? { forge } : {});
      iter.toolResponses.push(resp);
      onTrace({ kind: 'tool', call, response: resp });
    }
    trace.iterations.push(iter);

    // Feed the responses back as a single tool turn so the next user
    // turn carries scene state.
    messages.push({ role: 'assistant', content: completion });
    messages.push({
      role: 'tool',
      content: iter.toolResponses.map((r) => `<tool_response>${JSON.stringify(r)}</tool_response>`).join('\n'),
    });
  }

  trace.final = { status: 'maxTurns' };
  await _flushIfEnabled(trace);
  return trace;
}

// Forge-46: flush traces to disk at the end of every run. Best-effort —
// failures log but never throw. Importing lazily so unit tests of
// ForgeRunner that don't care about persistence don't pay the import cost.
async function _flushIfEnabled(trace) {
  if (typeof globalThis !== 'undefined' &&
      globalThis.__forgeTraceDisabled === true) return;
  try {
    const { flushTrace } = await import('./ArchieTraceSink.js');
    await flushTrace(trace);
  } catch { /* sink is best-effort */ }
}
export { _flushIfEnabled as flushArchieTrace };

/**
 * Install the autonomous entry point on `window`. Matches Studio's
 * `__archieRun` convention so existing Mech/Studio docs apply.
 */
export function installForgeRunner(globalObj = (typeof window !== 'undefined' ? window : globalThis)) {
  globalObj.__forgeRun = (opts) => runForgePrompt(opts || {});
  globalObj.__forgeEngine = { dispatchToolCall, buildSystemPrompt,
                              parseAssistant, buildMessages, getPersona };
  // Forge-113 — convenience getter so e2e + dev tools can confirm the
  // persona that drove the last completion without grepping the trace.
  globalObj.__forgeGetPersona = (d) => getPersona(d);
}
