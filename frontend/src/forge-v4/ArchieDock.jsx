// Forge-65 — collapsible Archie dock. Shows the thread + tool-call cards.

import React from 'react';
import { Icon } from './icons/Icon.jsx';

const SAMPLES = [
  'a 10 mm cube, fillet 2 mm',
  'steel L-bracket 80 × 80 × 50 with 6 mm thickness and 4 holes',
  'hex bolt M6 length 25 mm',
];

export function ArchieDock({ open, thread, running = false, onClose, onTry, onCancel }) {
  if (!open) return null;
  return (
    <aside className="forge-archie"
           role="complementary"
           aria-label="Archie thread"
           data-testid="forge-archie">
      <header className="forge-archie-header">
        <span className="forge-archie-header-spark" aria-hidden="true">
          <Icon name="archie.spark" size={14} />
        </span>
        <span>Archie{running ? ' · working' : ''}</span>
        <span style={{ flex: 1 }} />
        {running && onCancel && (
          <button type="button" onClick={onCancel}
                  aria-label="Cancel Archie run"
                  data-testid="forge-archie-cancel"
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--forge-rail-edge)',
                    color: 'var(--forge-ink-2)',
                    cursor: 'pointer',
                    padding: '1px 8px',
                    borderRadius: 3,
                    fontSize: 10,
                    marginRight: 6,
                  }}>
            cancel
          </button>
        )}
        <button type="button" onClick={onClose}
                aria-label="Close dock"
                style={{
                  background: 'transparent', border: 'none',
                  color: 'inherit', cursor: 'pointer',
                  display: 'inline-flex', alignItems: 'center',
                  opacity: 0.7,
                }}>
          <Icon name="select.clear" size={14} />
        </button>
      </header>
      <div className="forge-archie-body">
        {(!thread || thread.length === 0) ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ fontSize: 12, color: 'var(--forge-ink-2)' }}>
              Tell me what to build. I drive the kernel — you describe the part.
            </div>
            <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)' }}>
              Try one:
            </div>
            {SAMPLES.map((s) => (
              <button key={s} type="button"
                      onClick={() => onTry?.(s)}
                      style={{
                        background: 'var(--forge-surface)',
                        border: '1px solid var(--forge-rail-edge)',
                        borderRadius: 'var(--forge-radius)',
                        padding: '6px 10px',
                        color: 'var(--forge-ink)',
                        font: 'inherit', fontSize: 11,
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}>
                <code style={{ color: 'var(--forge-accent)', marginRight: 6 }}>›</code>
                {s}
              </button>
            ))}
          </div>
        ) : (
          thread.map((m) => (
            <div key={m.id} className="forge-archie-msg" data-role={m.role}>
              {m.text}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
