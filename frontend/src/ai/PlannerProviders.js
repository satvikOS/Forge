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
