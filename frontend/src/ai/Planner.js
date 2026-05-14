/**
 * ArchDisc Planner — turns a user prompt + clarification answers
 * into a validated plan against the ToolRegistry.
 *
 * Strategy:
 *   1. If no provider configured → return the canonical fallback
 *      plan for the detected domain.
 *   2. Build a prompt: registry summary as the system message,
 *      user prompt + clarification answers as the user message.
 *   3. Call the provider, parse the JSON, validate every step
 *      against PLAN_SCHEMA (tool names must exist).
 *   4. On parse/validation failure → fall back to canonical plan.
 *
 * The output shape is identical to JET_ENGINE_PLAN — an array of
 * `{tool, comment?, dependsOn?}` items — so PlanExecutor doesn't
 * need to know whether the plan came from an LLM or a constant.
 */

import { TOOL_REGISTRY, PLAN_SCHEMA, findTool } from './ToolRegistry.js';
import { PROVIDERS } from './PlannerProviders.js';
import { JET_ENGINE_PLAN } from './PlanExecutor.js';

const FALLBACK_PLANS = {
  engine: JET_ENGINE_PLAN,
  structure: [
    { tool: 'Extrude Boss',       comment: 'Build a starter bracket geometry' },
    { tool: 'Linear Static FEA',  comment: 'Stress + safety factor under load' },
    { tool: 'Fatigue Analysis',   comment: 'Cyclic life check' },
    { tool: 'Modal Analysis',     comment: 'Fundamental frequencies' },
    { tool: 'Export STEP',        comment: 'Hand-off to vendor' },
  ],
  gearbox: [
    { tool: 'Gear Mesh',          comment: 'AGMA Lewis bending + Hertz contact' },
    { tool: 'Shaft Sizing',       comment: 'DE-Goodman shaft diameter' },
    { tool: 'Bearing Life',       comment: 'Lundberg-Palmgren L10' },
    { tool: 'Rotordynamics',      comment: 'Critical speed margin' },
  ],
  generic: [
    { tool: 'Extrude Boss',       comment: 'Default geometry start' },
    { tool: 'Mass Properties',    comment: 'Inertia tensor' },
  ],
};

export const SYSTEM_PROMPT = [
  'You are an engineering design planner inside ArchDisc, a CAD/CAE/CAM platform.',
  'Given a user goal + clarifications, emit a JSON plan that ArchDisc will execute.',
  '',
  'Output shape: a single JSON object {"plan": [{"tool": "<exact name>", "comment": "<one sentence>"}, ...]}.',
  'Tool names MUST match the registry exactly. Order matters.',
  'Keep plans tight — 6-15 steps. Include comments so the user can audit.',
  '',
  'Registry (tab :: category :: tool — description):',
].join('\n');

/** Render the registry as a deterministic string for the prompt. */
export function registryContextBlock() {
  return TOOL_REGISTRY
    .map(t => `${t.tab.padEnd(11)} :: ${t.category.padEnd(14)} :: ${t.name} — ${t.description}`)
    .join('\n');
}

/** Build the user-message that gets concatenated with the prompt. */
export function buildUserMessage(userPrompt, clarifications) {
  const lines = [];
  lines.push(`Goal: ${userPrompt}`);
  if (clarifications && Object.keys(clarifications).length) {
    lines.push('');
    lines.push('Clarifications:');
    for (const [k, v] of Object.entries(clarifications)) {
      lines.push(`  - ${k}: ${v}`);
    }
  }
  lines.push('');
  lines.push('Return JSON only, conforming to: {"plan": [{"tool": "<name>", "comment": "<why>"}]}');
  return lines.join('\n');
}

/**
 * Validate an LLM-emitted plan against the tool registry.
 * Returns { ok, errors, normalized }. `normalized` strips unknown
 * fields and coerces shape, so callers can pass it straight to
 * PlanExecutor.
 */
export function validateAndNormalize(raw) {
  const errors = [];
  if (!Array.isArray(raw)) {
    return { ok: false, errors: ['plan is not an array'], normalized: null };
  }
  const normalized = [];
  for (let i = 0; i < raw.length; i++) {
    const step = raw[i];
    if (!step || typeof step !== 'object' || typeof step.tool !== 'string') {
      errors.push(`step ${i}: missing or non-string 'tool'`);
      continue;
    }
    if (!findTool(step.tool)) {
      errors.push(`step ${i}: unknown tool "${step.tool}"`);
      continue;
    }
    normalized.push({
      tool: step.tool,
      comment: typeof step.comment === 'string' ? step.comment : '',
      ...(Array.isArray(step.dependsOn) ? { dependsOn: step.dependsOn } : {}),
    });
  }
  return { ok: errors.length === 0, errors, normalized: errors.length ? null : normalized };
}

/**
 * Parse LLM output (which might be wrapped in markdown ```json fences,
 * have leading prose, etc.) into a plan array. Returns null on failure.
 */
export function parsePlanFromLLMText(text) {
  if (!text || typeof text !== 'string') return null;
  // Strip ```json ... ``` fences if present.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  // Find the first { ... } block.
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const slice = body.slice(start, end + 1);
  try {
    const obj = JSON.parse(slice);
    if (Array.isArray(obj)) return obj;
    if (Array.isArray(obj.plan)) return obj.plan;
    return null;
  } catch { return null; }
}

/**
 * Plan the next steps for `userPrompt`.
 *
 * @param {object} args
 * @param {string} args.userPrompt
 * @param {object=} args.clarifications
 * @param {string=} args.domain                 default 'generic'
 * @param {object=} args.providerCfg            {provider, apiKey, model, baseUrl}
 * @param {function=} args.providerOverride     test/inject a provider object
 * @returns {{plan, source, errors?}}
 *   source ∈ {'llm', 'fallback-canonical', 'fallback-error'}
 */
export async function planFor({ userPrompt, clarifications, domain = 'generic', providerCfg, providerOverride }) {
  const fallback = FALLBACK_PLANS[domain] ?? FALLBACK_PLANS.generic;

  const cfg = providerCfg ?? null;
  const provider = providerOverride ?? (cfg && PROVIDERS[cfg.provider]);
  if (!provider) {
    return { plan: fallback, source: 'fallback-canonical' };
  }

  try {
    const system = `${SYSTEM_PROMPT}\n${registryContextBlock()}`;
    const userMessage = buildUserMessage(userPrompt, clarifications);
    const text = await provider.generate({
      apiKey: cfg?.apiKey,
      model:  cfg?.model,
      baseUrl: cfg?.baseUrl,
      system,
      userMessage,
    });
    const raw = parsePlanFromLLMText(text);
    if (!raw) {
      return { plan: fallback, source: 'fallback-error', errors: ['could not parse JSON from LLM output'] };
    }
    const { ok, errors, normalized } = validateAndNormalize(raw);
    if (!ok) {
      return { plan: fallback, source: 'fallback-error', errors };
    }
    return { plan: normalized, source: 'llm' };
  } catch (err) {
    return { plan: fallback, source: 'fallback-error', errors: [err.message] };
  }
}

export { FALLBACK_PLANS };
