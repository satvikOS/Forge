/**
 * ArchDisc BYO-LLM provider abstraction.
 *
 * The Planner is provider-agnostic. Each provider object knows
 * how to take a prompt + system message + JSON schema and call
 * the right HTTP endpoint, returning the JSON plan.
 *
 * Built-in providers:
 *   - anthropic  → api.anthropic.com (Claude)
 *   - openai     → api.openai.com (GPT-4 etc.)
 *   - compatible → user-supplied baseUrl (Ollama, LM Studio, vLLM,
 *                  Together, Groq, etc. — any OpenAI-compat /v1/chat/completions)
 *
 * Security: API keys are passed in by the user and only sent to
 * the endpoint they came in for. Never logged, never persisted
 * to disk by ArchDisc itself (the Settings panel uses localStorage
 * only when the user opts in).
 */

/**
 * Read a fetch Response body as Server-Sent Events. For each
 * `data:` line, parse JSON and hand it to `extract(json)` which
 * returns the incremental text chunk (or '' / null to skip).
 * Fires `onToken(chunk)` per non-empty chunk and resolves to the
 * full concatenated text. `[DONE]` sentinels are ignored.
 */
async function readSSE(res, extract, onToken) {
  if (!res.body || !res.body.getReader) {
    // Environment without streaming support — fall back to full text.
    return res.text();
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';   // keep the trailing partial line
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let json;
      try { json = JSON.parse(payload); } catch { continue; }
      const chunk = extract(json);
      if (chunk) { full += chunk; onToken?.(chunk); }
    }
  }
  return full;
}

/** Concrete providers — keep these tiny; ChatGPT-style is the norm. */
export const PROVIDERS = {
  anthropic: {
    label: 'Anthropic (Claude)',
    defaultModel: 'claude-opus-4-7',
    defaultBaseUrl: 'https://api.anthropic.com',
    async generate({ apiKey, model, baseUrl, system, userMessage }) {
      const url = `${baseUrl ?? 'https://api.anthropic.com'}/v1/messages`;
      const body = {
        model: model ?? 'claude-opus-4-7',
        max_tokens: 2048,
        system,
        messages: [{ role: 'user', content: userMessage }],
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Anthropic ${res.status}: ${text.slice(0, 300)}`);
      }
      const json = await res.json();
      const text = (json.content ?? [])
        .filter(p => p.type === 'text')
        .map(p => p.text)
        .join('\n');
      return text;
    },
    async generateStream({ apiKey, model, baseUrl, system, userMessage, onToken }) {
      const url = `${baseUrl ?? 'https://api.anthropic.com'}/v1/messages`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: model ?? 'claude-opus-4-7',
          max_tokens: 2048, system, stream: true,
          messages: [{ role: 'user', content: userMessage }],
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`);
      }
      // content_block_delta events carry {delta:{type:'text_delta',text}}
      return readSSE(res, (j) => j?.delta?.text ?? '', onToken);
    },
  },

  openai: {
    label: 'OpenAI (GPT)',
    defaultModel: 'gpt-4o-mini',
    defaultBaseUrl: 'https://api.openai.com',
    async generate({ apiKey, model, baseUrl, system, userMessage }) {
      const url = `${baseUrl ?? 'https://api.openai.com'}/v1/chat/completions`;
      const body = {
        model: model ?? 'gpt-4o-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: userMessage },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.2,
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`OpenAI ${res.status}: ${text.slice(0, 300)}`);
      }
      const json = await res.json();
      return json.choices?.[0]?.message?.content ?? '';
    },
    async generateStream({ apiKey, model, baseUrl, system, userMessage, onToken }) {
      const url = `${baseUrl ?? 'https://api.openai.com'}/v1/chat/completions`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: model ?? 'gpt-4o-mini',
          messages: [
            { role: 'system', content: system },
            { role: 'user',   content: userMessage },
          ],
          temperature: 0.2, stream: true,
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`OpenAI ${res.status}: ${t.slice(0, 300)}`);
      }
      return readSSE(res, (j) => j?.choices?.[0]?.delta?.content ?? '', onToken);
    },
  },

  google: {
    label: 'Google (Gemini)',
    defaultModel: 'gemini-2.5-pro',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com',
    async generate({ apiKey, model, baseUrl, system, userMessage }) {
      const m = model ?? 'gemini-2.5-pro';
      const url = `${baseUrl ?? 'https://generativelanguage.googleapis.com'}/v1beta/models/${m}:generateContent?key=${apiKey}`;
      const body = {
        contents: [{ parts: [{ text: userMessage }] }],
        systemInstruction: system ? { parts: [{ text: system }] } : undefined,
        generationConfig: { temperature: 0.2, responseMimeType: 'application/json' },
      };
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Google ${res.status}: ${text.slice(0, 300)}`);
      }
      const json = await res.json();
      const parts = json.candidates?.[0]?.content?.parts ?? [];
      return parts.map(p => p.text ?? '').join('\n');
    },
  },

  // OpenAI-compatible endpoints. Covers BOTH local (Ollama, LM Studio,
  // vLLM, llamafile) AND cloud (OpenRouter, Together, Groq, Fireworks,
  // Anyscale, Mistral, DeepInfra). Pick a preset to one-click-fill
  // baseUrl + a sensible model.
  compatible: {
    label: 'OpenAI-compatible (cloud + local)',
    defaultModel: 'llama-3.1-8b-instruct',
    defaultBaseUrl: 'http://localhost:11434',
    async generate({ apiKey, model, baseUrl, system, userMessage }) {
      if (!baseUrl) throw new Error('Compatible provider needs a baseUrl');
      const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
      const body = {
        model: model ?? 'llama-3.1-8b-instruct',
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: userMessage },
        ],
        temperature: 0.2,
      };
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Compatible ${res.status}: ${text.slice(0, 300)}`);
      }
      const json = await res.json();
      return json.choices?.[0]?.message?.content ?? '';
    },
    async generateStream({ apiKey, model, baseUrl, system, userMessage, onToken }) {
      if (!baseUrl) throw new Error('Compatible provider needs a baseUrl');
      const url = `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
      const headers = { 'Content-Type': 'application/json' };
      if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
      const res = await fetch(url, {
        method: 'POST', headers,
        body: JSON.stringify({
          model: model ?? 'llama-3.1-8b-instruct',
          messages: [
            { role: 'system', content: system },
            { role: 'user',   content: userMessage },
          ],
          temperature: 0.2, stream: true,
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Compatible ${res.status}: ${t.slice(0, 300)}`);
      }
      return readSSE(res, (j) => j?.choices?.[0]?.delta?.content ?? '', onToken);
    },
  },

  // Archie local fleet — DeepSeek-R1-Distill-Qwen-7B + per-discipline
  // LoRA adapters, served by mlx_lm.server (localhost:8080 by default).
  // OpenAI-compat /v1/chat/completions, with a per-request `adapters`
  // field that hot-swaps the LoRA path without restarting the server.
  // The caller passes `discipline` and we map it to the adapter dir
  // (e.g. sketch -> adapters/archie/mech/sketch). Falls back to the
  // bare base model if no discipline is supplied.
  archie: {
    label: 'Archie (local fleet, MLX)',
    defaultModel: 'archie-7b-base',
    defaultBaseUrl: 'http://localhost:8080',
    /**
     * Discipline -> filesystem path of the LoRA adapter the server hot-loads.
     * Paths are relative to ~/archdisc-Models per Archie repo layout. Mech
     * disciplines: sketch / part / assembly / simulate / manufacture / drawing.
     */
    adapterFor(discipline) {
      if (!discipline) return null;
      return `adapters/archie/mech/${discipline}`;
    },
    async generate({ model, baseUrl, system, userMessage, discipline, adapters }) {
      const url = `${(baseUrl ?? 'http://localhost:8080').replace(/\/+$/, '')}/v1/chat/completions`;
      const body = {
        model: model ?? 'archie-7b-base',
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: userMessage },
        ],
        temperature: 0.2,
      };
      const adapterPath = adapters ?? this.adapterFor(discipline);
      if (adapterPath) body.adapters = adapterPath;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Archie ${res.status}: ${text.slice(0, 300)}`);
      }
      const json = await res.json();
      return json.choices?.[0]?.message?.content ?? '';
    },
    async generateStream({ model, baseUrl, system, userMessage, discipline, adapters, onToken }) {
      const url = `${(baseUrl ?? 'http://localhost:8080').replace(/\/+$/, '')}/v1/chat/completions`;
      const body = {
        model: model ?? 'archie-7b-base',
        messages: [
          { role: 'system', content: system },
          { role: 'user',   content: userMessage },
        ],
        temperature: 0.2,
        stream: true,
      };
      const adapterPath = adapters ?? this.adapterFor(discipline);
      if (adapterPath) body.adapters = adapterPath;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Archie ${res.status}: ${t.slice(0, 300)}`);
      }
      return readSSE(res, (j) => j?.choices?.[0]?.delta?.content ?? '', onToken);
    },
  },

  // Azure AI Foundry (services.ai.azure.com) — serverless model
  // deployments: DeepSeek, Llama, Mistral, Phi, etc. OpenAI-shaped chat
  // body, but the path is /models/chat/completions, auth is the `api-key`
  // header, and an ?api-version query param is required.
  azureFoundry: {
    label: 'Azure AI Foundry (DeepSeek, Llama, Mistral, …)',
    defaultModel: 'DeepSeek-V4-Flash',
    defaultBaseUrl: '',
    _url(baseUrl, apiVersion) {
      if (!baseUrl) throw new Error('Azure AI Foundry needs an endpoint (baseUrl)');
      return `${baseUrl.replace(/\/+$/, '')}/models/chat/completions`
        + `?api-version=${apiVersion ?? '2024-05-01-preview'}`;
    },
    async generate({ apiKey, model, baseUrl, system, userMessage, apiVersion }) {
      const res = await fetch(this._url(baseUrl, apiVersion), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          model: model ?? 'DeepSeek-V4-Flash',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.2,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Azure AI Foundry ${res.status}: ${text.slice(0, 300)}`);
      }
      const json = await res.json();
      return json.choices?.[0]?.message?.content ?? '';
    },
    async generateStream({ apiKey, model, baseUrl, system, userMessage, apiVersion, onToken }) {
      const res = await fetch(this._url(baseUrl, apiVersion), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          model: model ?? 'DeepSeek-V4-Flash',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.2, stream: true,
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Azure AI Foundry ${res.status}: ${t.slice(0, 300)}`);
      }
      return readSSE(res, (j) => j?.choices?.[0]?.delta?.content ?? '', onToken);
    },
  },

  // Azure OpenAI — the v1 API (project-scoped `/openai/v1/` path on
  // services.ai.azure.com, or the classic resource path). GPT-4.1 /
  // GPT-4o etc. OpenAI-shaped chat body; `api-key` header; no
  // api-version param on the v1 route. `baseUrl` is the …/openai/v1 base.
  azureOpenAI: {
    label: 'Azure OpenAI (v1 — GPT-4.1, GPT-4o, …)',
    defaultModel: 'gpt-4.1',
    defaultBaseUrl: '',
    async generate({ apiKey, model, baseUrl, system, userMessage }) {
      if (!baseUrl) throw new Error('Azure OpenAI needs the v1 endpoint (baseUrl)');
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          model: model ?? 'gpt-4.1',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.2,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Azure OpenAI ${res.status}: ${text.slice(0, 300)}`);
      }
      const json = await res.json();
      return json.choices?.[0]?.message?.content ?? '';
    },
    async generateStream({ apiKey, model, baseUrl, system, userMessage, onToken }) {
      if (!baseUrl) throw new Error('Azure OpenAI needs the v1 endpoint (baseUrl)');
      const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
        body: JSON.stringify({
          model: model ?? 'gpt-4.1',
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: userMessage },
          ],
          temperature: 0.2, stream: true,
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw new Error(`Azure OpenAI ${res.status}: ${t.slice(0, 300)}`);
      }
      return readSSE(res, (j) => j?.choices?.[0]?.delta?.content ?? '', onToken);
    },
  },
};

/**
 * One-click presets for the OpenAI-compatible provider. Selecting
 * a preset fills baseUrl + model. apiKey still comes from the user.
 * Covers the most-used cloud + local OpenAI-format endpoints.
 */
export const COMPATIBLE_PRESETS = [
  { id: 'custom',     label: '— Custom (manual baseUrl) —', baseUrl: '',                                  model: '' },
  // Cloud
  { id: 'openrouter', label: 'OpenRouter (cloud aggregator)', baseUrl: 'https://openrouter.ai/api',         model: 'anthropic/claude-opus-4-7' },
  { id: 'together',   label: 'Together AI (cloud)',           baseUrl: 'https://api.together.xyz',           model: 'meta-llama/Llama-3.1-70B-Instruct' },
  { id: 'groq',       label: 'Groq (cloud, fast)',            baseUrl: 'https://api.groq.com/openai',        model: 'llama-3.1-70b-versatile' },
  { id: 'fireworks',  label: 'Fireworks AI (cloud)',          baseUrl: 'https://api.fireworks.ai/inference', model: 'accounts/fireworks/models/llama-v3p1-70b-instruct' },
  { id: 'mistral',    label: 'Mistral (cloud)',               baseUrl: 'https://api.mistral.ai',             model: 'mistral-large-latest' },
  { id: 'deepinfra',  label: 'DeepInfra (cloud)',             baseUrl: 'https://api.deepinfra.com',          model: 'meta-llama/Meta-Llama-3.1-70B-Instruct' },
  // Local
  { id: 'archie',     label: 'Archie (local fleet, MLX, per-discipline LoRA)', baseUrl: 'http://localhost:8080', model: 'archie-7b-base' },
  { id: 'ollama',     label: 'Ollama (local, default)',       baseUrl: 'http://localhost:11434',             model: 'llama3.1:8b' },
  { id: 'lmstudio',   label: 'LM Studio (local, default)',    baseUrl: 'http://localhost:1234',              model: 'local-model' },
  { id: 'vllm',       label: 'vLLM (local, default)',         baseUrl: 'http://localhost:8000',              model: 'meta-llama/Llama-3.1-8B-Instruct' },
  { id: 'llamafile',  label: 'llamafile (local, default)',    baseUrl: 'http://localhost:8080',              model: 'local-model' },
];

/**
 * Load saved config from localStorage. Returns {provider, apiKey,
 * model, baseUrl} or null if nothing saved.
 */
export function loadProviderConfig() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem('archdisc.llm');
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/** Persist config to localStorage. Pass null to clear. */
export function saveProviderConfig(cfg) {
  if (typeof localStorage === 'undefined') return;
  if (cfg) localStorage.setItem('archdisc.llm', JSON.stringify(cfg));
  else     localStorage.removeItem('archdisc.llm');
}
