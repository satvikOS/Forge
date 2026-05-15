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
import { TOOL_PARAM_SCHEMAS, getSchemaForTool } from '../foundation/ToolParamSchemas.js';

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
  'Output shape: a single JSON object {"plan": [{"tool": "<exact name>", "comment": "<one sentence>", "params": {<optional overrides>}}, ...]}.',
  'Tool names MUST match the registry exactly. Order matters.',
  'Keep plans tight — 6-15 steps. Include comments so the user can audit.',
  'For each step you may include a "params" object whose keys match the tool\'s param schema below.',
  'Only override params that the goal+clarifications actually constrain; omit the rest so defaults apply.',
  '',
  'Registry (tab :: category :: tool — description):',
].join('\n');

export const PARAM_SCHEMAS_HEADER = '\n\nParam schemas (per tool — field: type (unit) default [min-max]):';

/** Render the registry as a deterministic string for the prompt. */
export function registryContextBlock() {
  return TOOL_REGISTRY
    .map(t => `${t.tab.padEnd(11)} :: ${t.category.padEnd(14)} :: ${t.name} — ${t.description}`)
    .join('\n');
}

/** Render every tool's param schema. The LLM uses this to know
 * what params it can override per step. Compact form to keep the
 * system prompt cost low.
 */
export function paramSchemasContextBlock() {
  const lines = [];
  for (const [tool, schema] of Object.entries(TOOL_PARAM_SCHEMAS)) {
    const fields = schema.fields
      .map(f => {
        const range = (f.min !== undefined && f.max !== undefined) ? ` [${f.min}-${f.max}]` : '';
        return `    ${f.name}: ${f.type}${f.unit ? ` (${f.unit})` : ''} default=${f.default}${range}`;
      })
      .join('\n');
    lines.push(`${tool}:\n${fields}`);
  }
  return lines.join('\n');
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
 * Returns { ok, errors, normalized, warnings }. `normalized` strips
 * unknown fields, coerces shape, and filters step.params to only
 * the keys declared in the tool's schema. Unknown param keys are
 * surfaced via `warnings` but don't fail validation — the LLM's
 * geometry is usually right even when it hallucinates a side knob.
 */
export function validateAndNormalize(raw) {
  const errors = [];
  const warnings = [];
  if (!Array.isArray(raw)) {
    return { ok: false, errors: ['plan is not an array'], warnings, normalized: null };
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
    const out = {
      tool: step.tool,
      comment: typeof step.comment === 'string' ? step.comment : '',
      ...(Array.isArray(step.dependsOn) ? { dependsOn: step.dependsOn } : {}),
    };
    if (step.params && typeof step.params === 'object') {
      const schema = getSchemaForTool(step.tool);
      const allowed = schema ? new Set(schema.fields.map(f => f.name)) : null;
      const filtered = {};
      for (const [k, v] of Object.entries(step.params)) {
        if (!allowed || allowed.has(k)) filtered[k] = v;
        else warnings.push(`step ${i} (${step.tool}): dropped unknown param "${k}"`);
      }
      if (Object.keys(filtered).length) out.params = filtered;
    }
    normalized.push(out);
  }
  return {
    ok: errors.length === 0,
    errors, warnings,
    normalized: errors.length ? null : normalized,
  };
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
 * @param {function=} args.onToken              streaming callback(chunk)
 * @returns {{plan, source, errors?}}
 *   source ∈ {'llm', 'llm-streamed', 'fallback-canonical', 'fallback-error'}
 */
export async function planFor({ userPrompt, clarifications, domain = 'generic', providerCfg, providerOverride, onToken }) {
  const fallback = FALLBACK_PLANS[domain] ?? FALLBACK_PLANS.generic;

  const cfg = providerCfg ?? null;
  const provider = providerOverride ?? (cfg && PROVIDERS[cfg.provider]);
  if (!provider) {
    return { plan: fallback, source: 'fallback-canonical' };
  }

  try {
    const system = `${SYSTEM_PROMPT}\n${registryContextBlock()}${PARAM_SCHEMAS_HEADER}\n${paramSchemasContextBlock()}`;
    const userMessage = buildUserMessage(userPrompt, clarifications);
    const args = {
      apiKey: cfg?.apiKey, model: cfg?.model, baseUrl: cfg?.baseUrl,
      system, userMessage,
    };
    // Stream when the caller wants tokens AND the provider supports it.
    const streamed = !!onToken && typeof provider.generateStream === 'function';
    const text = streamed
      ? await provider.generateStream({ ...args, onToken })
      : await provider.generate(args);
    const raw = parsePlanFromLLMText(text);
    if (!raw) {
      return { plan: fallback, source: 'fallback-error', errors: ['could not parse JSON from LLM output'] };
    }
    const { ok, errors, warnings, normalized } = validateAndNormalize(raw);
    if (!ok) {
      return { plan: fallback, source: 'fallback-error', errors };
    }
    return { plan: normalized, source: streamed ? 'llm-streamed' : 'llm', warnings };
  } catch (err) {
    return { plan: fallback, source: 'fallback-error', errors: [err.message] };
  }
}

export { FALLBACK_PLANS };
