// Forge-49 — Archie driver hook for v3.
//
// Wraps ForgeRunner.runForgePrompt so the v3 CommandBar and the
// ArchieSidebar talk to the local fleet without each component knowing
// about the fetch / parser / tool-call plumbing. State shape:
//
//   {
//     thread: [{ id, role: 'user'|'archie'|'tool', text, ts }],
//     steps:  [{ id, label, meta, ts }],
//     status: 'idle'|'running'|'error',
//     send:   (prompt) => Promise<traceFinal>,
//     cancel: () => void,
//   }
//
// The runner runs in the renderer; tool calls go through window.forge
// via ForgeToolBridge. When `window.forge` isn't available (SSR or a
// kernel-less dev shell), `send` short-circuits to an offline echo so
// the UI never freezes.

import { useCallback, useEffect, useRef, useState } from 'react';
import { ArchieThreadStore } from '../archie-portal/ArchieThreadStore.js';

const ARCHIE_FAKE_REPLY = `I would build that, but the native kernel isn't loaded in this dev shell. ` +
  `When forge-kernel.node is present, this same input runs against Archie at localhost:8080.`;

let _msgSeq = 1;
function nextMsgId() { return `m-${(_msgSeq++).toString(36)}`; }

// Forge-51 — persistent thread + step store. Pulled in as a singleton
// so multiple components reading the driver share one persistence
// surface. Backend defaults to localStorage in the renderer, memory
// in SSR/tests.
const _store = new ArchieThreadStore();
const STEPS_KEY = (threadId) => `forge.v3.steps.${threadId}`;

function loadSteps(backend, threadId) {
  try { return backend.get(STEPS_KEY(threadId)) || []; } catch { return []; }
}
function saveSteps(backend, threadId, steps) {
  try { backend.set(STEPS_KEY(threadId), steps); } catch {}
}

export function useArchieDriver({ store = _store } = {}) {
  // Open / create the active thread on mount. We don't use multiple
  // threads in v3 yet (Forge-51b will surface a picker); pick the most
  // recent or create one.
  const [activeThreadId, setActiveThreadId] = useState(null);
  const [thread, setThread] = useState([]);
  const [steps, setSteps]   = useState([]);
  const [status, setStatus] = useState('idle');
  const [activeStepId, setActiveStepId] = useState(null);
  const abortRef = useRef(null);

  useEffect(() => {
    const idx = store.index();
    let t;
    if (idx.length === 0) {
      t = store.create({ discipline: 'part', title: 'Untitled thread' });
    } else {
      t = store.load(idx[0].id) || store.create({ discipline: 'part' });
    }
    setActiveThreadId(t.id);
    // Hydrate UI thread from persisted messages.
    const restored = (t.messages || []).map((m) => ({
      id: m.id,
      role: m.role,
      text: m.text || (m.segments || []).map((s) => s.text || '').join('\n'),
      ts: m.ts,
    }));
    setThread(restored);
    const persistedSteps = loadSteps(store.backend, t.id);
    setSteps(persistedSteps);
    setActiveStepId(persistedSteps.length ? persistedSteps[persistedSteps.length - 1].id : null);
  // store is a stable singleton, intentionally not in deps.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushMsg  = useCallback((m) => {
    const ts = Date.now();
    const id = nextMsgId();
    setThread((t) => [...t, { id, ts, ...m }]);
    // Persist to store best-effort.
    try {
      if (activeThreadId) {
        const dbThread = store.load(activeThreadId);
        if (dbThread) {
          dbThread.messages.push({ id, role: m.role, text: m.text, ts });
          dbThread.updatedAt = ts;
          store._save(dbThread);
        }
      }
    } catch { /* persistence is best-effort */ }
  }, [activeThreadId, store]);
  const pushStep = useCallback((s) => {
    const id = nextMsgId();
    setSteps((arr) => {
      const next = [...arr, { id, ts: Date.now(), ...s }];
      if (activeThreadId) saveSteps(store.backend, activeThreadId, next);
      return next;
    });
    setActiveStepId(id);
    return id;
  }, [activeThreadId, store]);

  const cancel = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;
    setStatus('idle');
  }, []);

  // Forge-50 — rollback the parametric history to the picked step.
  // Truncates the timeline; on a live kernel this would replay only
  // those steps (RebuildEngine.rebuild on the partial tree). In the
  // dev shell it's a visual rollback.
  const rollbackTo = useCallback((stepId) => {
    setSteps((arr) => {
      const idx = arr.findIndex((s) => s.id === stepId);
      if (idx < 0) return arr;
      const kept = arr.slice(0, idx + 1);
      const dropped = arr.length - kept.length;
      if (dropped > 0) {
        setThread((t) => [...t, {
          id: nextMsgId(), ts: Date.now(),
          role: 'archie',
          text: `Rolled back to "${kept[kept.length - 1].label}" (dropped ${dropped} step${dropped === 1 ? '' : 's'}).`,
        }]);
      }
      setActiveStepId(stepId);
      if (activeThreadId) saveSteps(store.backend, activeThreadId, kept);
      if (typeof window !== 'undefined' && window.forge &&
          typeof window.forge.rebuild === 'function') {
        try { window.forge.rebuild({ upToStepId: stepId }); }
        catch { /* best-effort */ }
      }
      return kept;
    });
  }, [activeThreadId, store]);

  // Forge-51 — start a fresh thread (e.g. user wants a clean slate).
  const newThread = useCallback(() => {
    const t = store.create({ discipline: 'part', title: 'Untitled thread' });
    setActiveThreadId(t.id);
    setThread([]); setSteps([]); setActiveStepId(null);
    return t.id;
  }, [store]);

  const send = useCallback(async (prompt) => {
    if (!prompt || typeof prompt !== 'string') return null;
    pushMsg({ role: 'user', text: prompt });
    setStatus('running');

    // Detect renderer-side native kernel.
    const hasForge = typeof window !== 'undefined' &&
                     window.forge && typeof window.forge.isReady === 'function' &&
                     window.forge.isReady();

    if (!hasForge) {
      // Offline / dev shell — echo so the UI demonstrates flow.
      pushMsg({ role: 'archie', text: ARCHIE_FAKE_REPLY });
      pushStep({ label: prompt.length > 28 ? prompt.slice(0, 28) + '…' : prompt,
                 meta: 'offline-echo' });
      setStatus('idle');
      return { status: 'offline' };
    }

    // Lazy import so the runner module doesn't pull fetch / esm-cycle in
    // server-side tests.
    let runForgePrompt;
    try {
      ({ runForgePrompt } = await import('../../ai/ForgeRunner.js'));
    } catch (err) {
      pushMsg({ role: 'archie', text: `Couldn't load Archie runner: ${err.message}` });
      setStatus('error');
      return { status: 'error' };
    }

    const ac = new AbortController();
    abortRef.current = ac;

    try {
      const trace = await runForgePrompt({
        prompt,
        discipline: 'part',
        signal: ac.signal,
        forge: window.forge,
        onTrace: (ev) => {
          if (ev.kind === 'tool') {
            pushMsg({
              role: 'tool',
              text: `${ev.call.name}(${JSON.stringify(ev.call.arguments)}) → ${
                ev.response?.ok === false ? '✗ ' + (ev.response.error || 'err')
                                          : '✓'}`,
            });
            pushStep({ label: ev.call.name,
                       meta: ev.response?.ok === false ? 'fail' : 'ok' });
          }
        },
      });
      // Final assistant turn.
      if (trace.final?.status === 'done' && trace.final.text) {
        pushMsg({ role: 'archie', text: trace.final.text });
      } else if (trace.final?.status === 'clarify') {
        pushMsg({ role: 'archie', text: `Need: ${trace.final.clarify.question || '…'}` });
      } else if (trace.final?.status === 'cancelled') {
        pushMsg({ role: 'archie', text: '(cancelled)' });
      } else if (trace.final?.status === 'maxTurns') {
        pushMsg({ role: 'archie', text: '(maxTurns reached — ask again with a smaller step)' });
      }
      setStatus('idle');
      return trace.final;
    } catch (err) {
      if (err.name === 'AbortError') {
        pushMsg({ role: 'archie', text: '(cancelled)' });
      } else {
        pushMsg({ role: 'archie', text: `Error: ${err.message}` });
      }
      setStatus('error');
      return { status: 'error' };
    } finally {
      abortRef.current = null;
    }
  }, [pushMsg, pushStep]);

  return { thread, steps, status, activeStepId, activeThreadId, send, cancel,
           rollbackTo, setActiveStepId, newThread };
}
