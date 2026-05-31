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

import { useCallback, useRef, useState } from 'react';

const ARCHIE_FAKE_REPLY = `I would build that, but the native kernel isn't loaded in this dev shell. ` +
  `When forge-kernel.node is present, this same input runs against Archie at localhost:8080.`;

let _msgSeq = 1;
function nextMsgId() { return `m-${(_msgSeq++).toString(36)}`; }

export function useArchieDriver() {
  const [thread, setThread] = useState([]);
  const [steps, setSteps]   = useState([]);
  const [status, setStatus] = useState('idle');
  const abortRef = useRef(null);

  const pushMsg  = useCallback((m) => {
    setThread((t) => [...t, { id: nextMsgId(), ts: Date.now(), ...m }]);
  }, []);
  const pushStep = useCallback((s) => {
    setSteps((arr) => [...arr, { id: nextMsgId(), ts: Date.now(), ...s }]);
  }, []);

  const cancel = useCallback(() => {
    if (abortRef.current) abortRef.current.abort();
    abortRef.current = null;
    setStatus('idle');
  }, []);

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

  return { thread, steps, status, send, cancel };
}
