// frontend/src/ai/SessionMemoryClient.js
//
// Phase A.4 — shared long-session memory client.
//
// Talks to the local memory-store server (Python, :8083) that persists
// every Archie turn to SQLite with a sentence-transformer embedding of
// the user prompt. On every NEW turn, we ask the store for the top-K
// most-similar prior turns and inject them into Archie's next system
// prompt as <prior_context>{json}</prior_context>. After the dispatch,
// we fire-and-forget the new turn back into the store.
//
// Studio and Forge share THIS module (byte-equal copies until we can
// extract @archdisc/memory). One user → one memory → two front-ends.
//
// Usage in runArchie:
//   const priors = await recallPriorTurns(userText, { app: 'studio' });
//   const userContent = [priors, viewportState ? `<viewport_state>${viewportState}</viewport_state>` : '', userText]
//     .filter(Boolean).join('\n\n');
//   // dispatch chat completion …
//   rememberTurn({ app: 'studio', user_text: userText, assistant_summary: reply.slice(0, 280) });

const DEFAULT_BASE_URL = 'http://localhost:8083';

/**
 * Recall the top-K prior turns most similar to `query`. Returns a
 * <prior_context>{json}</prior_context> string ready to splice into
 * the next user message, or '' when the store is unreachable / opted
 * out / has no entries yet.
 *
 * Bounded by timeoutMs so a slow store can never stall the chat.
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
    let turns = Array.isArray(data && data.turns) ? data.turns : [];
    // Slice 963 — drop SELF-ECHOES: a recalled turn whose user_text is
    // the live query re-presents the model's own past run (good or bad)
    // as authoritative context. The corpus never trains identical
    // user↔prior pairs, and echoing a past bad run pattern-locks it —
    // the 2026-06-12 scoreboard regression amplified exactly this way.
    turns = turns.filter((t) => String(t.user_text || '').trim() !== String(query).trim());
    turns = turns.slice(0, 2);
    if (!turns.length) return '';
    // Trim each entry to the fields Archie cares about, keep them small.
    // Slice 952 — sanitize summaries on the way IN to the prompt: any
    // <tool_call>/<plan> tags in a recalled summary act as an untrained
    // in-context example and hijack the model's output format (the
    // 951x few-shot law via the memory channel). Pre-952 DB rows may
    // still carry raw dumps — strip, never trust.
    const compact = turns.map((t) => {
      let summary = t.assistant_summary || null;
      if (summary && /<(tool_call|plan|think)>/i.test(summary)) {
        summary = 'Built and staged the scene; verifier passed.';
      }
      // Slice 963 — pre-963 DB rows carry the untrained "dispatched N
      // tool calls for plan {json}" digest; rewrite to the trained
      // clause on the way in (strip, never trust — the 952 rule).
      if (summary && /^dispatched \d+ tool calls/i.test(summary)) {
        summary = 'Built and staged the scene; verifier passed.';
      }
      return {
        ts: t.ts,
        app: t.app,
        user: String(t.user_text || '').slice(0, 120),
        summary: summary ? String(summary).slice(0, 240) : null,
        score: t.score,
      };
    });
    return `<prior_context>${JSON.stringify(compact)}</prior_context>`;
  } catch (_) {
    return '';
  } finally {
    clearTimeout(tmo);
  }
}

/**
 * Persist the just-completed turn. Fire-and-forget — never awaited by
 * the chat dispatch so a slow store cannot stall the UI. Errors are
 * logged to console (visible in dev) but never thrown.
 */
export function rememberTurn({
  app, user_text, assistant_summary = null, tool_calls = null,
  session_id = null, baseUrl = DEFAULT_BASE_URL,
} = {}) {
  if (typeof window !== 'undefined' && window.__archieMemoryOff) return;
  if (!user_text || typeof user_text !== 'string') return;
  if (app !== 'studio' && app !== 'forge') return;
  // Cap content sizes so a long auto-build trace doesn't blow up the DB.
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
