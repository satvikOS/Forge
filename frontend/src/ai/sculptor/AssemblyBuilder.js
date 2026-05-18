/**
 * ArchDisc — L4 Assembly Builder.
 *
 * The AI decomposes an assembly description into individual parts, each with
 * a position; each part is sculpted on its own (via the L2 PartSculptor) and
 * translated into place. This is the first L4 slice — the AI building more
 * than one part and positioning them together.
 */

import { sculptPart } from './PartSculptor.js';

/**
 * The system prompt: asks the LLM to decompose an assembly into parts.
 * @returns {string}
 */
export function buildAssemblyPrompt() {
  return [
    'You are a CAD assembly planner for ArchDisc. Given a description of a',
    'mechanical assembly, decompose it into its individual parts and give each',
    'part a position in the assembly.',
    '',
    'Output ONLY a JSON object: {"parts":[ ... ]}. No prose, no markdown.',
    'Each part: {"name":"short id", "description":"<a self-contained part',
    'description with explicit mm dimensions>", "position":[x,y,z]}.',
    '',
    '- name: a short identifier for the part.',
    '- description: a complete standalone description of that ONE part — it is',
    '  sculpted on its own, so state every dimension explicitly.',
    '- position: [x,y,z] mm offset to place the finished part at. Each part is',
    '  sculpted at the origin, then translated to its position.',
    '',
    'All units are millimetres. Choose positions so the parts fit together as',
    'the assembly describes.',
  ].join('\n');
}

/**
 * Parse and validate the LLM's assembly decomposition.
 * @param {string} text  the raw LLM completion
 * @returns {Array<{name:string, description:string, position:number[]}>}
 */
export function parseAssemblyPlan(text) {
  let s = String(text ?? '').trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  let data;
  try {
    data = JSON.parse(s);
  } catch {
    throw new Error('parseAssemblyPlan: could not parse LLM response as JSON');
  }
  const parts = Array.isArray(data) ? data : data?.parts;
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error('parseAssemblyPlan: expected a non-empty {"parts":[...]}');
  }
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (typeof p?.description !== 'string' || !p.description) {
      throw new Error(`parseAssemblyPlan: part ${i} needs a non-empty string "description"`);
    }
    if (!Array.isArray(p.position) || p.position.length !== 3
        || !p.position.every((n) => Number.isFinite(n))) {
      throw new Error(`parseAssemblyPlan: part ${i} needs a [x,y,z] numeric "position"`);
    }
  }
  return parts;
}

/**
 * Build a multi-part assembly: ask the LLM to decompose `description` into
 * parts, sculpt each part, translate it to its position, and render it.
 *
 * @param {object}   args
 * @param {string}   args.description     the assembly
 * @param {object}   args.llm             { provider, apiKey, baseUrl, model }
 * @param {object}   args.atomicApi       the AtomicOps API (must include `translate`)
 * @param {Function} args.placeAndRender  async (part, name) => void
 * @param {object}   [args.providers]     PROVIDERS map (injected for testing)
 * @returns {Promise<{parts:Array<{name,position,volume}>}>}
 */
export async function sculptAssembly({ description, llm, atomicApi, placeAndRender, providers }) {
  const PROV = providers ?? (await import('../PlannerProviders.js')).PROVIDERS;
  const provider = PROV[llm?.provider];
  if (!provider) throw new Error(`sculptAssembly: unknown LLM provider '${llm?.provider}'`);
  const raw = await provider.generate({
    apiKey: llm.apiKey,
    model: llm.model,
    baseUrl: llm.baseUrl,
    system: buildAssemblyPrompt(),
    userMessage: `Assembly to build: ${description}`,
  });
  const specs = parseAssemblyPlan(raw);
  const built = [];
  for (const spec of specs) {
    const { part } = await sculptPart({ description: spec.description, llm, atomicApi, providers });
    atomicApi.translate(part, spec.position[0], spec.position[1], spec.position[2]);
    await placeAndRender(part, spec.name);
    built.push({ name: spec.name, position: spec.position, volume: part.solid.volume() });
  }
  return { parts: built };
}
