/**
 * ArchiePortal — the docked panel.
 *
 * Header strip (status + model + discipline), thread body (logged live),
 * composer (attach + text + send). Empty state ships 4 sample prompts so a
 * new user has something to click. The composer's text field captures
 * Cmd/Ctrl+Enter to send and Esc to clear.
 *
 * The Portal is theme-aware, uses only design-system primitives, and
 * presents Archie's brand with our own visual identity (warm copper +
 * graphite, the "archie" icon glyph). No competitor iconography is used.
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Icon } from '../design-system/icons/Icon.jsx';
import { Button, IconButton } from '../design-system/primitives/Button.jsx';
import { EmptyState } from '../design-system/primitives/EmptyState.jsx';
import { Tooltip } from '../design-system/primitives/Modal.jsx';
import { KeyHint } from '../design-system/primitives/KeyHint.jsx';
import { Spinner } from '../design-system/primitives/Spinner.jsx';
import { ArchieThreadStore } from './ArchieThreadStore.js';
import { ArchieClient } from './ArchieClient.js';
import { MessageRenderer } from './MessageRenderer.jsx';

const SUGGESTIONS = [
  { label: 'Build a 100×50×20 mm bracket with 4 mounting holes',
    discipline: 'part' },
  { label: 'Run static FEA on the active part with 1 kN at the tip',
    discipline: 'simulate' },
  { label: 'Generate a profile + drill toolpath for the active body',
    discipline: 'manufacture' },
  { label: 'Export the assembly as STEP AP242 with PMI',
    discipline: 'part' },
];

const DISCIPLINES = [
  { value: 'sketch',      label: 'Sketch' },
  { value: 'part',        label: 'Part' },
  { value: 'assembly',    label: 'Assembly' },
  { value: 'drawing',     label: 'Drawing' },
  { value: 'simulate',    label: 'Simulate' },
  { value: 'manufacture', label: 'Manufacture' },
];

export function ArchiePortal({
  projectId = null,
  store: externalStore,
  run,
  forge,
  status = 'ready',  // 'ready' | 'thinking' | 'offline' | 'error'
  model = 'archie-7b-base',
  defaultDiscipline = 'part',
  height = '100%',
  density = 'comfortable', // 'comfortable' | 'compact'
}) {
  const storeRef = useRef(externalStore || null);
  if (!storeRef.current) storeRef.current = new ArchieThreadStore();
  const store = storeRef.current;

  const clientRef = useRef(null);
  if (!clientRef.current && run) {
    clientRef.current = new ArchieClient({ store, run, forge });
  }

  const [thread, setThread] = useState(null);
  const [, setTick] = useState(0);
  const [discipline, setDiscipline] = useState(defaultDiscipline);
  const [prompt, setPrompt] = useState('');
  const [attachments, setAttachments] = useState([]);
  const [inFlight, setInFlight] = useState(false);
  const abortRef = useRef(null);
  const threadBodyRef = useRef(null);

  // Re-render on any store update so streamed segments appear live.
  useEffect(() => store.onChange(() => setTick((n) => n + 1)), [store]);

  // Ensure there's always a thread.
  useEffect(() => {
    if (!thread) {
      const list = store.index();
      const existing = list.length ? store.load(list[0].id) : null;
      setThread(existing || store.create({ projectId, discipline, model }));
    }
  }, [thread, store, projectId, discipline, model]);

  // Auto-scroll to bottom on new messages.
  useEffect(() => {
    const el = threadBodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.messages?.length, thread?.updatedAt]);

  const newThread = useCallback(() => {
    const t = store.create({ projectId, discipline, model });
    setThread(t);
  }, [store, projectId, discipline, model]);

  const send = useCallback(async (text, extraAtt = []) => {
    if (!text.trim() || inFlight || !clientRef.current) return;
    setInFlight(true);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      await clientRef.current.send({
        threadId: thread.id,
        prompt: text.trim(),
        attachments: [...attachments, ...extraAtt],
        signal: ac.signal,
      });
    } catch (e) {
      // surfaced as a segment in the store
    } finally {
      setInFlight(false);
      abortRef.current = null;
      setPrompt('');
      setAttachments([]);
      setThread(store.load(thread.id));
    }
  }, [thread, attachments, inFlight, store]);

  const cancel = useCallback(() => { abortRef.current?.abort(); }, []);

  const handleKey = (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      send(prompt);
    } else if (e.key === 'Escape' && !inFlight) {
      setPrompt('');
    }
  };

  // ─── chrome
  const headerTone = status === 'ready' ? 'success'
                    : status === 'thinking' ? 'warning'
                    : status === 'offline' ? 'tertiary'
                    : 'danger';
  const headerColor = {
    success: 'var(--success-text)', warning: 'var(--warning-text)',
    danger: 'var(--danger-text)', tertiary: 'var(--text-tertiary)',
  }[headerTone];

  return (
    <aside
      className="forge-archie-portal"
      role="region"
      aria-label="Archie portal"
      style={{
        display: 'flex', flexDirection: 'column',
        height,
        background: 'var(--surface-panel)',
        borderLeft: '1px solid var(--border-subtle)',
        fontSize: 'var(--text-base)',
        color: 'var(--text-primary)',
      }}
    >
      {/* HEADER */}
      <header style={{
        flex: '0 0 auto',
        padding: 'var(--space-6) var(--space-7)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)' }}>
          <div style={{
            width: 28, height: 28, borderRadius: 'var(--radius-full)',
            background: 'var(--accent-soft)', color: 'var(--accent-bg)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Icon name="archie" size={18} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-sm)' }}>Archie</div>
            <div style={{ fontSize: 'var(--text-xs)', color: headerColor }}>
              {status === 'thinking' && <Spinner size={10} label="thinking" />}{' '}
              {status} · <span style={{ fontFamily: 'var(--font-mono)' }}>{model}</span>
            </div>
          </div>
          <Tooltip content="New thread">
            <IconButton icon={<Icon name="plus" />} label="New thread" onClick={newThread} size="sm" />
          </Tooltip>
          <Tooltip content="Pin to project">
            <IconButton
              icon={<Icon name="pin" />}
              label={thread?.pinned ? 'Unpin from project' : 'Pin to project'}
              selected={!!thread?.pinned}
              onClick={() => thread && store.setPinned(thread, !thread.pinned)}
              size="sm"
            />
          </Tooltip>
          <Tooltip content="Export thread as Markdown">
            <IconButton
              icon={<Icon name="fileExport" />}
              label="Export thread"
              onClick={() => thread && exportMarkdown(store.exportMarkdown(thread), thread.title)}
              size="sm"
            />
          </Tooltip>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <label style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>Discipline</label>
          <select
            value={discipline}
            onChange={(e) => setDiscipline(e.target.value)}
            style={{
              background: 'var(--surface-app)', color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-sm)', padding: 'var(--space-2) var(--space-5)',
              fontFamily: 'var(--font-sans)', fontSize: 'var(--text-xs)',
              cursor: 'pointer',
            }}
          >
            {DISCIPLINES.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>
        </div>
      </header>

      {/* THREAD BODY */}
      <div
        ref={threadBodyRef}
        role="log"
        aria-live="polite"
        style={{
          flex: 1,
          overflowY: 'auto',
          padding: 'var(--space-7)',
          display: 'flex', flexDirection: 'column', gap: 'var(--space-7)',
          background: 'var(--surface-app)',
        }}
      >
        {(!thread || thread.messages.length === 0) ? (
          <EmptyState
            icon={<Icon name="archie" size={28} />}
            title="Drive the platform with words"
            description="Archie runs locally. Tell it what to build, simulate, or manufacture — Archie picks the tools and shows its work."
            action={
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)', alignItems: 'stretch' }}>
                {SUGGESTIONS.map((s, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => { setDiscipline(s.discipline); send(s.label); }}
                    style={{
                      padding: 'var(--space-5) var(--space-7)',
                      background: 'var(--surface-raised)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: 'var(--radius-md)',
                      fontSize: 'var(--text-sm)', textAlign: 'left',
                      cursor: 'pointer',
                      transition: 'border-color var(--motion-fast) var(--ease-out)',
                    }}
                    onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent-bg)'; }}
                    onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border-subtle)'; }}
                  >
                    <span style={{
                      display: 'inline-block', fontSize: 'var(--text-2xs)',
                      color: 'var(--accent-bg)', textTransform: 'uppercase',
                      letterSpacing: '0.06em', marginRight: 'var(--space-5)',
                    }}>{s.discipline}</span>
                    {s.label}
                  </button>
                ))}
              </div>
            }
          />
        ) : (
          thread.messages.map((m) => (
            <MessageRenderer
              key={m.id}
              message={m}
              onConfirmToolCall={(messageId, segIndex) => {
                store.patchSegment(thread, messageId, segIndex, { status: 'done' });
                setThread(store.load(thread.id));
              }}
            />
          ))
        )}
      </div>

      {/* COMPOSER */}
      <footer style={{
        flex: '0 0 auto',
        padding: 'var(--space-6) var(--space-7) var(--space-7)',
        borderTop: '1px solid var(--border-subtle)',
        background: 'var(--surface-panel)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-5)',
      }}>
        {attachments.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
            {attachments.map((a, i) => (
              <span key={i} style={{
                display: 'inline-flex', alignItems: 'center', gap: 'var(--space-3)',
                background: 'var(--accent-soft)', color: 'var(--accent-soft-text)',
                padding: '2px var(--space-5)', borderRadius: 'var(--radius-full)',
                fontSize: 'var(--text-xs)',
              }}>
                <Icon name="attach" size={10} />
                {a.kind}
                <button type="button"
                  onClick={() => setAttachments(attachments.filter((_, j) => j !== i))}
                  aria-label="Remove attachment"
                  style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}
                ><Icon name="close" size={10} /></button>
              </span>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-5)', alignItems: 'flex-end' }}>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask Archie — build a bracket, optimise this beam, generate G-code…"
            rows={density === 'compact' ? 2 : 3}
            aria-label="Message Archie"
            style={{
              flex: 1, resize: 'vertical',
              padding: 'var(--space-5) var(--space-6)',
              background: 'var(--surface-app)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border-default)',
              borderRadius: 'var(--radius-md)',
              fontFamily: 'var(--font-sans)', fontSize: 'var(--text-sm)',
              lineHeight: 'var(--leading-snug)',
              outline: 'none',
              minHeight: density === 'compact' ? 40 : 60,
            }}
          />
          {inFlight ? (
            <Button variant="danger" onClick={cancel}>Stop</Button>
          ) : (
            <Button
              variant="primary"
              onClick={() => send(prompt)}
              disabled={!prompt.trim()}
              rightIcon={<Icon name="send" size={12} />}
            >
              Send
            </Button>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-5)', fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
          <button type="button" onClick={() => setAttachments([...attachments, { kind: 'selection', payload: {} }])}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Icon name="attach" size={10} /> Attach selection
          </button>
          <button type="button" onClick={() => setAttachments([...attachments, { kind: 'featureTree', payload: {} }])}
            style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 'inherit', display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <Icon name="drawingTab" size={10} /> Attach feature tree
          </button>
          <span style={{ flex: 1 }} />
          <KeyHint keys={['Cmd', 'Enter']} /><span>to send</span>
        </div>
      </footer>
    </aside>
  );
}

function exportMarkdown(text, title) {
  if (typeof document === 'undefined') return;
  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(title || 'archie-thread').replace(/[^a-z0-9]+/gi, '-')}.md`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}
