/**
 * ArchieThreadStore — persistent chat threads with Archie.
 *
 * Each thread carries the conversation, the assembly context it was opened
 * against, and Archie's per-segment trace. Threads are persisted in
 * localStorage by default; injecting a custom `backend` lets unit tests use
 * an in-memory map. A pinned thread reattaches to its project on reopen.
 */

const KEY_INDEX = 'forge.archie.threads.index';
const KEY_THREAD = (id) => `forge.archie.threads.${id}`;

function memoryBackend() {
  const m = new Map();
  return {
    get: (k) => m.has(k) ? JSON.parse(m.get(k)) : null,
    set: (k, v) => m.set(k, JSON.stringify(v)),
    del: (k) => m.delete(k),
  };
}

function localStorageBackend() {
  return {
    get: (k) => {
      const s = localStorage.getItem(k);
      return s ? JSON.parse(s) : null;
    },
    set: (k, v) => localStorage.setItem(k, JSON.stringify(v)),
    del: (k) => localStorage.removeItem(k),
  };
}

let counter = 0;
function uid() {
  const t = Date.now().toString(36);
  return `t-${t}-${(++counter).toString(36)}`;
}

export class ArchieThreadStore {
  constructor({ backend } = {}) {
    this.backend = backend
      || (typeof localStorage !== 'undefined' ? localStorageBackend() : memoryBackend());
    this._listeners = new Set();
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
  _notify() {
    for (const fn of this._listeners) {
      try { fn(); } catch (e) { /* swallow */ }
    }
  }

  index() {
    return this.backend.get(KEY_INDEX) || [];
  }

  load(id) {
    return this.backend.get(KEY_THREAD(id));
  }

  create({ projectId = null, discipline = 'part', model = 'archie-7b-base', title = '' } = {}) {
    const now = Date.now();
    const t = {
      id: uid(),
      projectId, discipline, model,
      title: title || 'New thread',
      pinned: false,
      createdAt: now,
      updatedAt: now,
      messages: [],
    };
    this._save(t);
    const idx = this.index();
    idx.unshift({ id: t.id, projectId, title: t.title, updatedAt: now, pinned: false });
    this.backend.set(KEY_INDEX, idx);
    this._notify();
    return t;
  }

  delete(id) {
    this.backend.del(KEY_THREAD(id));
    this.backend.set(KEY_INDEX, this.index().filter((e) => e.id !== id));
    this._notify();
  }

  appendUserMessage(thread, text, attachments = []) {
    const msg = {
      id: uid(),
      role: 'user',
      text,
      attachments,
      ts: Date.now(),
    };
    thread.messages.push(msg);
    thread.updatedAt = msg.ts;
    if (thread.messages.length === 1 && (!thread.title || thread.title === 'New thread')) {
      thread.title = text.length > 60 ? text.slice(0, 57) + '…' : text;
      this._reindex(thread);
    }
    this._save(thread);
    this._notify();
    return msg;
  }

  startArchieMessage(thread) {
    const msg = {
      id: uid(),
      role: 'archie',
      segments: [], // [{kind:'think'|'plan'|'tool_call'|'tool_response'|'clarify'|'text', ...}]
      status: 'streaming',
      ts: Date.now(),
    };
    thread.messages.push(msg);
    thread.updatedAt = msg.ts;
    this._save(thread);
    this._notify();
    return msg;
  }

  appendSegment(thread, messageId, segment) {
    const msg = thread.messages.find((m) => m.id === messageId);
    if (!msg) return;
    msg.segments.push({ ...segment, ts: Date.now() });
    thread.updatedAt = Date.now();
    this._save(thread);
    this._notify();
  }

  patchSegment(thread, messageId, segIndex, patch) {
    const msg = thread.messages.find((m) => m.id === messageId);
    if (!msg || !msg.segments[segIndex]) return;
    msg.segments[segIndex] = { ...msg.segments[segIndex], ...patch };
    thread.updatedAt = Date.now();
    this._save(thread);
    this._notify();
  }

  finalizeArchieMessage(thread, messageId, status = 'done') {
    const msg = thread.messages.find((m) => m.id === messageId);
    if (!msg) return;
    msg.status = status;
    thread.updatedAt = Date.now();
    this._save(thread);
    this._notify();
  }

  setPinned(thread, pinned) {
    thread.pinned = !!pinned;
    this._save(thread);
    this._reindex(thread);
    this._notify();
  }

  pinnedForProject(projectId) {
    return this.index().filter((e) => e.pinned && e.projectId === projectId);
  }

  exportMarkdown(thread) {
    const out = [`# ${thread.title}`,
      `_Discipline: ${thread.discipline} · Model: ${thread.model}_`,
      ''];
    for (const m of thread.messages) {
      if (m.role === 'user') {
        out.push(`### You`);
        out.push(m.text);
      } else {
        out.push(`### Archie`);
        for (const seg of m.segments) {
          if (seg.kind === 'think') out.push(`<details><summary>think</summary>${seg.text}</details>`);
          else if (seg.kind === 'plan') out.push(`**Plan**\n\n\`\`\`json\n${JSON.stringify(seg.plan, null, 2)}\n\`\`\``);
          else if (seg.kind === 'tool_call') out.push(`- **${seg.call.name}** \`${JSON.stringify(seg.call.arguments || {})}\` → ${seg.response?.ok ? 'ok' : 'error'}`);
          else if (seg.kind === 'clarify') out.push(`**Clarify:** ${seg.clarify.question}`);
          else if (seg.kind === 'text') out.push(seg.text);
        }
      }
      out.push('');
    }
    return out.join('\n');
  }

  _save(thread) {
    this.backend.set(KEY_THREAD(thread.id), thread);
  }

  _reindex(thread) {
    const idx = this.index();
    const entry = idx.find((e) => e.id === thread.id);
    if (entry) {
      entry.title = thread.title;
      entry.updatedAt = thread.updatedAt;
      entry.pinned = thread.pinned;
    }
    this.backend.set(KEY_INDEX, idx);
  }
}
