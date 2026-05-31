/**
 * MessageRenderer — render one Archie message safely.
 *
 * No `dangerouslySetInnerHTML`. Tiny hand-rolled markdown for bold,
 * italic, inline `code`, fenced code blocks, lists, links, and headings.
 * Tool-call cards are expandable + status-coloured.
 */

import React, { useState } from 'react';
import { Icon } from '../design-system/icons/Icon.jsx';

// ─────────────────────────────────────────────────────  markdown
function renderInline(text) {
  if (typeof text !== 'string') return text;
  const nodes = [];
  // Sequentially split on the simplest tokens. Each match becomes a styled
  // span; everything else stays plain text. Order matters: code first to
  // protect backticks inside other constructs.
  const RX = /(`[^`]+`)|(\*\*[^*]+\*\*)|(_[^_]+_)|(\[[^\]]+\]\([^)]+\))/g;
  let last = 0;
  let m;
  let key = 0;
  while ((m = RX.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    const tok = m[0];
    if (tok.startsWith('`')) {
      nodes.push(<code key={key++} style={{
        fontFamily: 'var(--font-mono)', fontSize: '0.92em',
        background: 'var(--surface-active)', padding: '0 var(--space-2)',
        borderRadius: 'var(--radius-xs)',
      }}>{tok.slice(1, -1)}</code>);
    } else if (tok.startsWith('**')) {
      nodes.push(<strong key={key++}>{tok.slice(2, -2)}</strong>);
    } else if (tok.startsWith('_')) {
      nodes.push(<em key={key++}>{tok.slice(1, -1)}</em>);
    } else if (tok.startsWith('[')) {
      const linkMatch = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok);
      if (linkMatch) {
        const [, label, href] = linkMatch;
        // Only allow safe schemes.
        const safe = /^(https?:|mailto:|forge:)/.test(href);
        nodes.push(safe
          ? <a key={key++} href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-bg)' }}>{label}</a>
          : <span key={key++}>{label}</span>);
      }
    }
    last = m.index + tok.length;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function renderMarkdown(text) {
  if (typeof text !== 'string') return null;
  const lines = text.split('\n');
  const out = [];
  let i = 0;
  let key = 0;
  while (i < lines.length) {
    const line = lines[i];
    // fenced code
    if (line.startsWith('```')) {
      const codeLines = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i]); i++;
      }
      i++; // skip closing ```
      out.push(
        <pre key={key++} style={{
          fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
          background: 'var(--surface-app)', border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)', padding: 'var(--space-5) var(--space-6)',
          overflow: 'auto', margin: 'var(--space-5) 0',
        }}><code>{codeLines.join('\n')}</code></pre>
      );
      continue;
    }
    // heading
    const h = /^(#{1,3})\s+(.+)$/.exec(line);
    if (h) {
      const level = h[1].length;
      const sizes = { 1: 'var(--text-xl)', 2: 'var(--text-lg)', 3: 'var(--text-base)' };
      out.push(React.createElement(`h${level}`, {
        key: key++,
        style: { margin: 'var(--space-6) 0 var(--space-3)', fontSize: sizes[level], fontWeight: 'var(--weight-semibold)' },
      }, renderInline(h[2])));
      i++; continue;
    }
    // bullet list
    if (/^[\-\*]\s+/.test(line)) {
      const items = [];
      while (i < lines.length && /^[\-\*]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[\-\*]\s+/, ''));
        i++;
      }
      out.push(
        <ul key={key++} style={{ margin: 'var(--space-3) 0', paddingLeft: 'var(--space-9)' }}>
          {items.map((it, j) => <li key={j}>{renderInline(it)}</li>)}
        </ul>
      );
      continue;
    }
    if (line.trim() === '') { i++; continue; }
    out.push(<p key={key++} style={{ margin: 'var(--space-3) 0', lineHeight: 'var(--leading-relaxed)' }}>{renderInline(line)}</p>);
    i++;
  }
  return out;
}

// ─────────────────────────────────────────────────────  tool-call card
function ToolCallCard({ call, status, response, onAllow }) {
  const [open, setOpen] = useState(false);
  const tone = status === 'error' ? 'danger'
              : status === 'awaiting-confirm' ? 'warning'
              : status === 'cancelled' ? 'tertiary'
              : 'success';
  const colors = {
    success: { bg: 'var(--success-soft)', text: 'var(--success-text)', border: 'var(--success-bg)' },
    danger:  { bg: 'var(--danger-soft)',  text: 'var(--danger-text)',  border: 'var(--danger-bg)' },
    warning: { bg: 'var(--warning-soft)', text: 'var(--warning-text)', border: 'var(--warning-bg)' },
    tertiary: { bg: 'var(--surface-active)', text: 'var(--text-tertiary)', border: 'var(--border-default)' },
  }[tone];

  return (
    <div style={{
      margin: 'var(--space-3) 0',
      background: colors.bg, color: colors.text,
      border: `1px solid ${colors.border}`,
      borderRadius: 'var(--radius-md)',
      overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-3)', width: '100%',
          padding: 'var(--space-5) var(--space-6)',
          background: 'transparent', border: 'none', color: 'inherit',
          cursor: 'pointer', textAlign: 'left',
        }}
        aria-expanded={open}
      >
        <Icon name={open ? 'chevronDown' : 'chevronRight'} size={10} />
        <code style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)' }}>{call.name}</code>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 'var(--text-2xs)', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 'var(--weight-semibold)' }}>
          {status}
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 var(--space-6) var(--space-5)' }}>
          <details>
            <summary style={{ cursor: 'pointer', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>arguments</summary>
            <pre style={{
              margin: 'var(--space-3) 0', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
              background: 'var(--surface-app)', padding: 'var(--space-5)', borderRadius: 'var(--radius-sm)',
              maxHeight: '160px', overflow: 'auto', color: 'var(--text-primary)',
            }}>{JSON.stringify(call.arguments, null, 2)}</pre>
          </details>
          {response && (
            <details>
              <summary style={{ cursor: 'pointer', fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>response</summary>
              <pre style={{
                margin: 'var(--space-3) 0', fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
                background: 'var(--surface-app)', padding: 'var(--space-5)', borderRadius: 'var(--radius-sm)',
                maxHeight: '160px', overflow: 'auto', color: 'var(--text-primary)',
              }}>{JSON.stringify(response, null, 2)}</pre>
            </details>
          )}
          {status === 'awaiting-confirm' && onAllow && (
            <div style={{ marginTop: 'var(--space-5)', display: 'flex', gap: 'var(--space-3)' }}>
              <button type="button" onClick={onAllow} style={{
                padding: 'var(--space-3) var(--space-7)', background: 'var(--accent-bg)',
                color: 'var(--accent-text)', border: 'none', borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', cursor: 'pointer',
              }}>Allow this action</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────  message
export function MessageRenderer({ message, onConfirmToolCall }) {
  if (message.role === 'user') {
    return (
      <div style={{
        alignSelf: 'flex-end',
        maxWidth: '85%',
        padding: 'var(--space-5) var(--space-7)',
        background: 'var(--surface-raised)',
        border: '1px solid var(--border-subtle)',
        borderRadius: 'var(--radius-lg) var(--radius-lg) var(--radius-xs) var(--radius-lg)',
        fontSize: 'var(--text-sm)',
        lineHeight: 'var(--leading-relaxed)',
      }}>
        {renderInline(message.text)}
        {message.attachments?.length > 0 && (
          <div style={{
            marginTop: 'var(--space-5)', display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)',
          }}>
            {message.attachments.map((a, i) => (
              <span key={i} style={{
                fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)',
                background: 'var(--surface-active)', padding: '0 var(--space-3)',
                borderRadius: 'var(--radius-full)',
              }}>{a.kind}</span>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', fontSize: 'var(--text-xs)', color: 'var(--accent-bg)' }}>
        <Icon name="archie" size={14} />
        <span style={{ fontWeight: 'var(--weight-semibold)', letterSpacing: '0.04em' }}>ARCHIE</span>
        {message.status === 'streaming' && <span style={{ color: 'var(--text-tertiary)' }}>thinking…</span>}
        {message.status === 'cancelled' && <span style={{ color: 'var(--text-tertiary)' }}>cancelled</span>}
        {message.status === 'error' && <span style={{ color: 'var(--danger-text)' }}>failed</span>}
      </div>
      {message.segments.map((seg, i) => {
        if (seg.kind === 'think') {
          return (
            <details key={i} style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
              <summary style={{ cursor: 'pointer' }}>thinking</summary>
              <div style={{ marginTop: 'var(--space-3)', padding: 'var(--space-5)', background: 'var(--surface-app)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-sm)' }}>
                {seg.text}
              </div>
            </details>
          );
        }
        if (seg.kind === 'plan') {
          return (
            <details key={i} open style={{
              border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)',
              background: 'var(--surface-raised)',
            }}>
              <summary style={{ padding: 'var(--space-5) var(--space-6)', cursor: 'pointer', fontSize: 'var(--text-xs)', color: 'var(--text-secondary)' }}>
                plan — {seg.plan?.goal || 'untitled'}
              </summary>
              <pre style={{
                margin: 0, padding: '0 var(--space-6) var(--space-5)',
                fontFamily: 'var(--font-mono)', fontSize: 'var(--text-xs)',
                color: 'var(--text-primary)', overflow: 'auto',
              }}>{JSON.stringify(seg.plan, null, 2)}</pre>
            </details>
          );
        }
        if (seg.kind === 'tool_call') {
          return (
            <ToolCallCard
              key={i}
              call={seg.call}
              status={seg.status}
              response={seg.response}
              onAllow={seg.status === 'awaiting-confirm' && onConfirmToolCall
                ? () => onConfirmToolCall(message.id, i)
                : null}
            />
          );
        }
        if (seg.kind === 'clarify') {
          return (
            <div key={i} style={{
              padding: 'var(--space-6)', background: 'var(--warning-soft)',
              border: '1px solid var(--warning-bg)', borderRadius: 'var(--radius-md)',
              color: 'var(--warning-text)',
            }}>
              <div style={{ fontWeight: 'var(--weight-semibold)', marginBottom: 'var(--space-3)' }}>
                {seg.clarify?.question}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-3)' }}>
                {(seg.clarify?.options || []).map((opt, j) => (
                  <button key={j} type="button" style={{
                    padding: 'var(--space-3) var(--space-6)',
                    background: 'var(--surface-app)', color: 'var(--text-primary)',
                    border: '1px solid var(--border-default)', borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--text-xs)', cursor: 'pointer',
                  }}>{opt}</button>
                ))}
              </div>
            </div>
          );
        }
        if (seg.kind === 'text') {
          return <div key={i} style={{ fontSize: 'var(--text-sm)', lineHeight: 'var(--leading-relaxed)' }}>{renderMarkdown(seg.text)}</div>;
        }
        if (seg.kind === 'error') {
          return <div key={i} style={{ fontSize: 'var(--text-xs)', color: 'var(--danger-text)' }}>{seg.message}</div>;
        }
        return null;
      })}
    </div>
  );
}
