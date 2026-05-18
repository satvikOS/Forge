/**
 * ArchDisc — Component Manifest.
 *
 * The autonomous build's first step: the LLM decomposes a product (e.g. a
 * watch) into an ordered list of its manufacturable components, each with a
 * self-contained part description. The manifest is the work list the build
 * loop grinds through, component by component.
 */

/**
 * The system prompt: asks the LLM to decompose a product into components.
 * @returns {string}
 */
export function buildManifestPrompt() {
  return [
    'You are a CAD product architect for ArchDisc. Given a product to build,',
    'decompose it into an ordered list of its individual manufacturable',
    'components.',
    '',
    'Output ONLY a JSON object: {"components":[ ... ]}. No prose, no markdown.',
    'Each component: {"id":"unique short id", "name":"short name",',
    '"description":"<a self-contained part description with explicit mm',
    'dimensions, suitable for sculpting the part on its own>"}.',
    '',
    'Order components largest/structural first, smallest/detail last. Every id',
    'must be unique. Be concrete and realistic with millimetre dimensions.',
  ].join('\n');
}

/**
 * Parse and validate the LLM's component manifest.
 * @param {string} text  the raw LLM completion
 * @returns {Array<{id:string, name:string, description:string}>}
 */
export function parseManifest(text) {
  let s = String(text ?? '').trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  let data;
  try {
    data = JSON.parse(s);
  } catch {
    throw new Error('parseManifest: could not parse LLM response as JSON');
  }
  const comps = Array.isArray(data) ? data : data?.components;
  if (!Array.isArray(comps) || comps.length === 0) {
    throw new Error('parseManifest: expected a non-empty {"components":[...]}');
  }
  const seen = new Set();
  for (let i = 0; i < comps.length; i++) {
    const c = comps[i];
    if (typeof c?.id !== 'string' || !c.id) {
      throw new Error(`parseManifest: component ${i} needs a non-empty string "id"`);
    }
    if (typeof c?.description !== 'string' || !c.description) {
      throw new Error(`parseManifest: component ${i} needs a non-empty string "description"`);
    }
    if (seen.has(c.id)) {
      throw new Error(`parseManifest: duplicate component id '${c.id}'`);
    }
    seen.add(c.id);
  }
  return comps;
}

/**
 * Ask the LLM to decompose `productDescription` into a component manifest.
 *
 * @param {object} args
 * @param {string} args.productDescription
 * @param {object} args.llm        { provider, apiKey, baseUrl, model }
 * @param {object} [args.providers]  PROVIDERS map (injected for testing)
 * @returns {Promise<Array<{id,name,description}>>}
 */
export async function requestManifest({ productDescription, llm, providers }) {
  const PROV = providers ?? (await import('../PlannerProviders.js')).PROVIDERS;
  const provider = PROV[llm?.provider];
  if (!provider) throw new Error(`requestManifest: unknown LLM provider '${llm?.provider}'`);
  const raw = await provider.generate({
    apiKey: llm.apiKey,
    model: llm.model,
    baseUrl: llm.baseUrl,
    system: buildManifestPrompt(),
    userMessage: `Product to decompose into components: ${productDescription}`,
  });
  return parseManifest(raw);
}
