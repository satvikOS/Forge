/**
 * ArchDisc — L2 AI Sculptor: visual verification.
 *
 * After the sculptor builds a part, render it and send the image to a
 * vision-capable LLM, which judges whether the result matches the intent
 * and, if not, proposes a corrected operation plan. This is the antidote
 * to "the data checks passed but the result is a blob".
 */

const VERIFY_OP_REFERENCE =
  'Operation schema for revisedOperations: startSketch{plane}, '
  + 'sketchRectangle{cx,cy,w,h}, sketchCircle{cx,cy,r}, finishSketch, '
  + 'extrude{distance}, cut{distance}, revolve{segments,degrees}.';

/**
 * The system prompt for the visual verification call.
 * @returns {string}
 */
export function buildVerifyPrompt() {
  return [
    'You are a CAD design reviewer. You are given a text description of an',
    'intended mechanical part and a rendered image of the part a CAD agent',
    'actually built. Judge whether the rendered part faithfully matches the',
    'description.',
    'You are shown the rendered part from SEVERAL camera angles — judge the',
    'whole 3-D shape, not a single silhouette.',
    '',
    'Output ONLY a JSON object — no prose, no markdown:',
    '{"matches": boolean, "feedback": "one short sentence", "revisedOperations": [...] or null}',
    '',
    '- matches: true only if the rendered part clearly matches the description.',
    '- feedback: one short sentence explaining your judgement.',
    '- revisedOperations: when matches is false, a corrected operation plan',
    '  (a JSON array) that would build the part correctly; otherwise null.',
    '  ' + VERIFY_OP_REFERENCE,
  ].join('\n');
}

/**
 * Parse and normalise the vision LLM's verdict.
 * @param {string} text  the raw LLM completion
 * @returns {{matches:boolean, feedback:string, revisedOperations:Array|null}}
 */
export function parseVerifyResponse(text) {
  let s = String(text ?? '').trim();
  const fence = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  if (fence) s = fence[1].trim();
  let data;
  try {
    data = JSON.parse(s);
  } catch {
    throw new Error('parseVerifyResponse: could not parse LLM response as JSON');
  }
  if (typeof data?.matches !== 'boolean') {
    throw new Error('parseVerifyResponse: response missing a boolean "matches"');
  }
  return {
    matches: data.matches,
    feedback: typeof data.feedback === 'string' ? data.feedback : '',
    revisedOperations: Array.isArray(data.revisedOperations) ? data.revisedOperations : null,
  };
}

/**
 * Ask a vision-capable LLM whether the rendered part matches `description`.
 * Accepts either `imageDataUrls` (an array of data: URLs — multiple camera
 * angles) or a single `imageDataUrl`. All views go in one multimodal message.
 * Assumes an Azure-OpenAI-style v1 chat endpoint.
 *
 * @param {object} args
 * @param {string} args.description
 * @param {string[]} [args.imageDataUrls]  data: URLs, one per camera angle
 * @param {string} [args.imageDataUrl]     a single data: URL (back-compat)
 * @param {object} args.llm                { apiKey, baseUrl, model }
 * @returns {Promise<{matches:boolean, feedback:string, revisedOperations:Array|null}>}
 */
export async function verifyRender({ description, imageDataUrls, imageDataUrl, llm }) {
  if (!llm?.baseUrl) throw new Error('verifyRender: llm.baseUrl is required');
  const urls = Array.isArray(imageDataUrls) && imageDataUrls.length
    ? imageDataUrls
    : (imageDataUrl ? [imageDataUrl] : []);
  if (urls.length === 0) throw new Error('verifyRender: at least one image is required');
  const url = `${llm.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const content = [
    { type: 'text', text: `Intended part: ${description}\n`
      + `You are shown the rendered part from ${urls.length} camera angle(s).` },
    ...urls.map((u) => ({ type: 'image_url', image_url: { url: u } })),
  ];
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': llm.apiKey },
    body: JSON.stringify({
      model: llm.model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: buildVerifyPrompt() },
        { role: 'user', content },
      ],
    }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`verifyRender: LLM ${res.status}: ${t.slice(0, 300)}`);
  }
  const json = await res.json();
  return parseVerifyResponse(json.choices?.[0]?.message?.content ?? '');
}
