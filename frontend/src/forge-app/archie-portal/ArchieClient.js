/**
 * ArchieClient — thin wrapper over ForgeRunner that streams structured
 * segments into the ArchieThreadStore.
 *
 *   const client = new ArchieClient({ store, run: runForgePrompt, forge });
 *   await client.send({ threadId, prompt, attachments, signal });
 *
 * Large tool responses (meshes, big arrays) are summarised before storage
 * so localStorage doesn't blow up. Destructive tool calls (delete-file,
 * overwrite-export) are gated through `onConfirmDestructive`.
 */

import { captureForgeViewportCaption } from '../../ai/VisionPerception.js';

const DESTRUCTIVE_TOOLS = new Set([
  'project.delete', 'part.delete', 'config.delete', 'thread.delete',
  'io.exportStep', 'io.exportStl', 'io.exportBrep',  // overwrites
]);

function summariseResponse(resp) {
  if (!resp || typeof resp !== 'object') return resp;
  // Trim huge typed arrays.
  if (resp.result && typeof resp.result === 'object') {
    const result = { ...resp.result };
    for (const k of Object.keys(result)) {
      const v = result[k];
      if (ArrayBuffer.isView(v) && v.length > 64) {
        result[k] = { kind: '__typedArray', length: v.length, dtype: v.constructor.name };
      }
    }
    if (resp.produces === 'mesh' && result.triangleCount) {
      return { ...resp, result: { kind: 'mesh', triangleCount: result.triangleCount, vertexCount: result.vertexCount } };
    }
    return { ...resp, result };
  }
  return resp;
}

export class ArchieClient {
  constructor({ store, run, forge, onConfirmDestructive }) {
    this.store = store;
    this.run = run;          // runForgePrompt
    this.forge = forge;
    this.onConfirmDestructive = onConfirmDestructive
      || (() => true); // approve by default in test environments
  }

  async send({ threadId, prompt, attachments = [], signal }) {
    const thread = this.store.load(threadId);
    if (!thread) throw new Error(`[ArchieClient] unknown thread ${threadId}`);

    this.store.appendUserMessage(thread, prompt, attachments);

    const enriched = this._enrich(prompt, attachments);

    const message = this.store.startArchieMessage(thread);

    const onTrace = (evt) => {
      // Per-iteration trace events from ForgeRunner.
      if (evt.kind === 'tool' && evt.call && evt.response) {
        const isDestructive = DESTRUCTIVE_TOOLS.has(evt.call.name);
        const segIndex = message.segments.length;
        this.store.appendSegment(thread, message.id, {
          kind: 'tool_call',
          call: evt.call,
          status: isDestructive ? 'awaiting-confirm' : (evt.response.ok ? 'done' : 'error'),
          response: summariseResponse(evt.response),
        });
        if (isDestructive && !this.onConfirmDestructive(evt.call)) {
          this.store.patchSegment(thread, message.id, segIndex,
            { status: 'cancelled' });
        }
      } else if (evt.kind === 'clarify') {
        this.store.appendSegment(thread, message.id, {
          kind: 'clarify',
          clarify: evt.iter?.parsed?.clarify,
        });
      } else if (evt.kind === 'done') {
        const parsed = evt.iter?.parsed;
        if (parsed?.think?.length) {
          for (const t of parsed.think) {
            this.store.appendSegment(thread, message.id, { kind: 'think', text: t });
          }
        }
        if (parsed?.plan) {
          this.store.appendSegment(thread, message.id, { kind: 'plan', plan: parsed.plan });
        }
        // Final assistant text — strip the structured blocks already captured.
        const stripped = (evt.iter?.completion || '')
          .replace(/<think>[\s\S]*?<\/think>/g, '')
          .replace(/<plan>[\s\S]*?<\/plan>/g, '')
          .replace(/<tool_call>[\s\S]*?<\/tool_call>/g, '')
          .replace(/<clarify>[\s\S]*?<\/clarify>/g, '')
          .trim();
        if (stripped) {
          this.store.appendSegment(thread, message.id, { kind: 'text', text: stripped });
        }
      }
    };

    // Forge-162 — capture the live viewport caption so Archie sees the
    // current scene state before deciding the next tool_call.
    const viewportState = await captureForgeViewportCaption();

    try {
      const trace = await this.run({
        prompt: enriched, discipline: thread.discipline,
        onTrace, signal, forge: this.forge,
        archie: this._archieFor(thread),
        viewportState,
      });
      this.store.finalizeArchieMessage(thread, message.id,
        trace?.final?.status === 'clarify' ? 'awaiting-clarification' : 'done');
      return trace;
    } catch (e) {
      if (e?.name === 'AbortError') {
        this.store.finalizeArchieMessage(thread, message.id, 'cancelled');
      } else {
        this.store.appendSegment(thread, message.id, {
          kind: 'error',
          message: e?.message || String(e),
        });
        this.store.finalizeArchieMessage(thread, message.id, 'error');
      }
      throw e;
    }
  }

  _enrich(prompt, attachments) {
    if (!attachments.length) return prompt;
    const ctx = attachments.map((a) => `<${a.kind}>${JSON.stringify(a.payload)}</${a.kind}>`).join('\n');
    return `${ctx}\n\n${prompt}`;
  }

  _archieFor(thread) {
    // Optional per-thread Archie endpoint / model override; falls through to
    // the ForgeRunner default if undefined.
    return null;
  }
}
