// frontend/src/ai/SessionMemoryClient.js
//
// Forge mirror of Studio's SessionMemoryClient — same contract, same
// memory store on :8083. The Forge ArchieDock flow calls this from
// ForgeShellV4.runArchie before dispatching to runForgePrompt: recall
// the top-K prior turns (across BOTH apps), then fire-and-forget
// remember the new turn so a Studio session and a Forge session share
// the same long-running design history.
//
// Both modules stay byte-equal so a future extraction into
// @archdisc/memory will be a no-op.

const DEFAULT_BASE_URL = 'http://localhost:8083';

/**
 * Recall the top-K prior turns most similar to `query`. Returns a
 * <prior_context>{json}</prior_context> string ready to splice into
 * the next user message, or '' when the store is unreachable / opted
 * out / has no entries yet.
 */
export async function recallPriorTurns(query, {
  app, k = 3, timeoutMs = 2000, baseUrl = DEFAULT_BASE_URL,
} = {}) {
  if (typeof window !== 'undefined' && window.__archieMemoryOff) return '';
  if (!query || typeof query !== 'string' || !query.trim()) return '';
  const ac = new AbortController();
  const tmo = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl}/recall`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, k, app }),
      signal: ac.signal,
    });
    if (!res.ok) return '';
    const data = await res.json();
    const turns = Array.isArray(data && data.turns) ? data.turns : [];
    if (!turns.length) return '';
    const compact = turns.map((t) => ({
      ts: t.ts,
      app: t.app,
      user: t.user_text,
      summary: t.assistant_summary || null,
      score: t.score,
    }));
    return `<prior_context>${JSON.stringify(compact)}</prior_context>`;
  } catch (_) {
    return '';
  } finally {
    clearTimeout(tmo);
  }
}

/**
 * Persist the just-completed turn. Fire-and-forget — never awaited so
 * a slow store cannot stall the UI.
 */
export function rememberTurn({
  app, user_text, assistant_summary = null, tool_calls = null,
  session_id = null, baseUrl = DEFAULT_BASE_URL,
} = {}) {
  if (typeof window !== 'undefined' && window.__archieMemoryOff) return;
  if (!user_text || typeof user_text !== 'string') return;
  if (app !== 'studio' && app !== 'forge') return;
  const trimmedSummary = typeof assistant_summary === 'string'
    ? assistant_summary.slice(0, 800) : null;
  fetch(`${baseUrl}/remember`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app, user_text, assistant_summary: trimmedSummary,
      tool_calls, session_id,
    }),
  }).catch((e) => {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[mem] remember failed (non-fatal):', e?.message || e);
    }
  });
}
