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
    '- {"op":"startSketch","plane":"XY"} — open a new sketch (required before sketch entities).',
    '- {"op":"sketchRectangle","cx":N,"cy":N,"w":N,"h":N} — rectangle centred at (cx,cy); w,h > 0.',
    '- {"op":"sketchCircle","cx":N,"cy":N,"r":N} — circle centred at (cx,cy); r > 0.',
    '- {"op":"finishSketch"} — close the sketch into a profile (required before extrude/cut/revolve).',
    '- {"op":"extrude","distance":N} — extrude the finished profile by N mm (>0); adds material.',
    '- {"op":"cut","distance":N} — extrude the finished profile and subtract it (a hole/pocket).',
    '       Use distance GREATER than the material thickness for a clean through-hole.',
    '- {"op":"revolve","segments":N,"degrees":N} — revolve the finished profile into a solid of',
    '       revolution; the profile must lie in the +X half (all x >= 0).',
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
