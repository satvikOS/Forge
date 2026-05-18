/**
 * ArchDisc — L2 AI Sculptor.
 *
 * An LLM autonomously decides the sequence of atomic CAD operations that
 * sculpts a part from a plain-text description. This module builds the
 * prompt, parses the LLM's JSON operation plan, validates it, and (Task 2)
 * executes it through the L0 AtomicOps API.
 *
 * The AI does the modeling — no canned recipe, no generator.
 */

/** The atomic operations the sculptor may use, and their required numeric params. */
const OP_SCHEMA = {
  startSketch:     [],
  sketchRectangle: ['cx', 'cy', 'w', 'h'],
  sketchCircle:    ['cx', 'cy', 'r'],
  finishSketch:    [],
  extrude:         ['distance'],
  cut:             ['distance'],
  revolve:         [],
  circularPattern: ['count', 'distance'],
};

/**
 * The system prompt: describes the atomic operation set and the required
 * JSON output schema for the LLM.
 * @returns {string}
 */
export function buildSculptPrompt() {
  return [
    'You are a CAD modeling agent for ArchDisc. Given a description of a',
    'mechanical part, output the sequence of atomic CAD operations that',
    'sculpts it from scratch — the way a human modeler builds it.',
    '',
    'Output ONLY a JSON object: {"operations":[ ... ]}. No prose, no markdown.',
    '',
    'All units are millimetres. Sketches are drawn on the XY plane.',
    'Available operations:',
    '- {"op":"startSketch","plane":"XY"} — open a new sketch on the base plane.',
    '       Use plane "top" instead to sketch on the TOP face of the current solid —',
    '       a following extrude then builds a boss/step standing ON that face.',
    '       (cut and revolve require plane "XY".)',
    '- {"op":"sketchRectangle","cx":N,"cy":N,"w":N,"h":N} — rectangle centred at (cx,cy); w,h > 0.',
    '- {"op":"sketchCircle","cx":N,"cy":N,"r":N} — circle centred at (cx,cy); r > 0.',
    '- {"op":"finishSketch"} — close the sketch into a profile (required before extrude/cut/revolve).',
    '- {"op":"extrude","distance":N} — extrude the finished profile by N mm (>0); adds material.',
    '- {"op":"cut","distance":N} — extrude the finished profile and subtract it (a hole/pocket).',
    '       Use distance GREATER than the material thickness for a clean through-hole.',
    '- {"op":"revolve","segments":N,"degrees":N} — revolve the finished profile into a solid of',
    '       revolution; the profile must lie in the +X half (all x >= 0).',
    '       segments and degrees are optional (defaults: 64 segments, 360 degrees).',
    '- {"op":"circularPattern","mode":"extrude"|"cut","count":N,"distance":N,"angle":N}',
    '       — extrude the finished profile and make `count` copies evenly spaced around',
    '       the Z axis over `angle` degrees (default 360); mode "extrude" adds them (gear',
    '       teeth), mode "cut" subtracts them (a bolt circle of holes). The profile is',
    '       patterned about the origin — sketch the single feature offset from the origin',
    '       (e.g. a hole centred at (bolt_circle_radius, 0)).',
    '',
    'Rules:',
    '- The first feature must be an extrude or a revolve (cut needs existing material).',
    '- Each extrude/cut/revolve consumes one finished sketch; startSketch again for the next feature.',
    '- Choose real millimetre dimensions that match the description.',
  ].join('\n');
}

/**
 * Parse and validate the LLM's response into an array of operation objects.
 * Accepts a bare JSON array, a {"operations":[...]} wrapper, or either wrapped
 * in a ```json markdown fence. Throws on anything invalid.
 *
 * @param {string} text  the raw LLM completion
 * @returns {Array<object>} the validated operation list
 */
export function parseSculptPlan(text) {
  let s = String(text ?? '').trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();

  let data;
  try {
    data = JSON.parse(s);
  } catch {
    throw new Error('parseSculptPlan: could not parse LLM response as JSON');
  }
  const ops = Array.isArray(data) ? data : data?.operations;
  if (!Array.isArray(ops)) {
    throw new Error('parseSculptPlan: expected a JSON array or {"operations":[...]}');
  }
  if (ops.length === 0) {
    throw new Error('parseSculptPlan: the operation plan is empty');
  }
  for (let i = 0; i < ops.length; i++) {
    const o = ops[i];
    const required = OP_SCHEMA[o?.op];
    if (!required) {
      throw new Error(`parseSculptPlan: unknown operation '${o?.op}' at index ${i}`);
    }
    for (const key of required) {
      if (typeof o[key] !== 'number' || !Number.isFinite(o[key])) {
        throw new Error(`parseSculptPlan: operation '${o.op}' at index ${i} needs a numeric '${key}'`);
      }
    }
  }
  return ops;
}

/**
 * Execute a validated operation plan through an AtomicOps-shaped API,
 * building a Part. The `atomicApi` must provide `createPart, startSketch,
 * sketchRectangle, sketchCircle, finishSketch, extrude, cut, revolve`.
 *
 * @param {Array<object>} plan  operations (validated by parseSculptPlan)
 * @param {object} atomicApi    the AtomicOps API
 * @returns {Promise<object>} the sculpted Part
 */
export async function executeSculptPlan(plan, atomicApi) {
  const part = atomicApi.createPart('AI-Sculpted Part');
  for (const o of plan) {
    switch (o.op) {
      case 'startSketch':     await atomicApi.startSketch(part, o.plane ?? 'XY'); break;
      case 'sketchRectangle': atomicApi.sketchRectangle(part, o.cx, o.cy, o.w, o.h); break;
      case 'sketchCircle':    atomicApi.sketchCircle(part, o.cx, o.cy, o.r); break;
      case 'finishSketch':    atomicApi.finishSketch(part); break;
      case 'extrude':         await atomicApi.extrude(part, o.distance); break;
      case 'cut':             await atomicApi.cut(part, o.distance); break;
      case 'revolve':         await atomicApi.revolve(part, o.segments ?? 64, o.degrees ?? 360); break;
      case 'circularPattern': await atomicApi.circularPattern(part, o.mode, o.count, o.distance, o.angle ?? 360); break;
      default: throw new Error(`executeSculptPlan: unknown op '${o.op}'`);
    }
  }
  return part;
}

/**
 * Ask the LLM for an atomic-operation plan and return the validated plan.
 *
 * @param {object} args
 * @param {string} args.description  plain-text part description
 * @param {object} args.llm          { provider, apiKey, baseUrl, model }
 * @param {object} [args.providers]  PROVIDERS map (injected for testing)
 * @returns {Promise<Array<object>>} the validated operation plan
 */
export async function requestSculptPlan({ description, llm, providers }) {
  const PROV = providers ?? (await import('../PlannerProviders.js')).PROVIDERS;
  const provider = PROV[llm?.provider];
  if (!provider) throw new Error(`requestSculptPlan: unknown LLM provider '${llm?.provider}'`);
  const raw = await provider.generate({
    apiKey: llm.apiKey,
    model: llm.model,
    baseUrl: llm.baseUrl,
    system: buildSculptPrompt(),
    userMessage: `Part to sculpt: ${description}`,
  });
  return parseSculptPlan(raw);
}

/**
 * The full L2 sculpt: ask the LLM for an operation plan and execute it.
 *
 * @param {object}   args
 * @param {string}   args.description  plain-text part description
 * @param {object}   args.llm          { provider, apiKey, baseUrl, model }
 * @param {object}   args.atomicApi    the AtomicOps API
 * @param {object}   [args.providers]  PROVIDERS map (injected for testing)
 * @returns {Promise<{part:object, plan:Array}>}
 */
export async function sculptPart({ description, llm, atomicApi, providers }) {
  const plan = await requestSculptPlan({ description, llm, providers });
  const part = await executeSculptPlan(plan, atomicApi);
  return { part, plan };
}

/**
 * The closing L2 loop: produce a plan, execute it, render it, and have a
 * vision LLM verify the render against the description — revising and
 * re-executing when the verdict rejects. All side-effecting steps are
 * injected callbacks so the loop itself is environment-agnostic and
 * unit-testable.
 *
 * @param {object} args
 * @param {string}   args.description       the intended part
 * @param {Function} args.requestPlan       async () => operations array
 * @param {Function} args.executePlan       async (plan) => result handle
 * @param {Function} args.renderAndCapture  async () => image data URL
 * @param {Function} args.verify            async ({description,imageDataUrl})
 *                                          => {matches,feedback,revisedOperations}
 * @param {number}   [args.maxRounds]       max verify rounds (default 3)
 * @returns {Promise<{plan:Array, result:*, rounds:Array, accepted:boolean}>}
 */
export async function sculptAndVerify({
  description, requestPlan, executePlan, renderAndCapture, verify, maxRounds = 3,
}) {
  let plan = await requestPlan();
  let result = await executePlan(plan);
  const rounds = [];
  for (let r = 1; r <= maxRounds; r++) {
    const imageDataUrl = await renderAndCapture();
    const verdict = await verify({ description, imageDataUrl });
    rounds.push({ round: r, matches: verdict.matches, feedback: verdict.feedback });
    if (verdict.matches) {
      return { plan, result, rounds, accepted: true };
    }
    if (!verdict.revisedOperations || r === maxRounds) {
      return { plan, result, rounds, accepted: false };
    }
    plan = verdict.revisedOperations;
    result = await executePlan(plan);
  }
  return { plan, result, rounds, accepted: false };
}
