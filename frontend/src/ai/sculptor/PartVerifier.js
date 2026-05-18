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
 * Ask a vision-capable LLM whether `imageDataUrl` matches `description`.
 * Assumes an Azure-OpenAI-style v1 chat endpoint (`api-key` header,
 * multimodal user content).
 *
 * @param {object} args
 * @param {string} args.description    the intended part
 * @param {string} args.imageDataUrl   a data: URL of the rendered part
 * @param {object} args.llm            { apiKey, baseUrl, model }
 * @returns {Promise<{matches:boolean, feedback:string, revisedOperations:Array|null}>}
 */
export async function verifyRender({ description, imageDataUrl, llm }) {
  if (!llm?.baseUrl) throw new Error('verifyRender: llm.baseUrl is required');
  const url = `${llm.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'api-key': llm.apiKey },
    body: JSON.stringify({
      model: llm.model,
      temperature: 0.1,
      messages: [
        { role: 'system', content: buildVerifyPrompt() },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Intended part: ${description}` },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
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
