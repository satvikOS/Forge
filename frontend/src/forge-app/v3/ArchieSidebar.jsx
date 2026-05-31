// Forge v3 — persistent Archie sidebar.
//
// Always-anchored on the right. Collapses to 88px (Cmd+/ to toggle).
// Renders the conversation thread vertically; tool calls are inline.
// The composer lives in the bottom command bar — this panel is
// READ-ONLY for the thread.

import React from 'react';

const SAMPLE_PROMPTS = [
  { label: 'A 10 mm cube, fillet 2 mm',         prompt: 'a 10mm cube, fillet 2mm' },
  { label: 'Steel L-bracket 80 × 80 × 50 mm',   prompt: 'steel L-bracket 80x80x50mm with 6mm thickness and 4 mounting holes' },
  { label: 'Cylinder Ø20 mm, height 30 mm',     prompt: 'a cylinder diameter 20mm height 30mm' },
  { label: 'Hex bolt M6 × 25 mm',               prompt: 'hex bolt M6 length 25mm' },
  { label: 'Section view of selected body',     prompt: 'section view at the origin along Y axis' },
];

export function ArchieSidebar({ collapsed, onToggle, thread, running = false, onCancel, onTrySample }) {
  return (
    <aside className="forge-v3-archie"
           data-collapsed={String(!!collapsed)}
           data-running={String(!!running)}
           aria-label="Archie thread"
           data-testid="forge-v3-archie">
      <header className="forge-v3-archie-header">
        <span className="forge-v3-archie-header-mark" aria-hidden="true">
          {running ? '◑' : '◐'}
        </span>
        {!collapsed && <span>Archie{running ? ' · working' : ''}</span>}
        <span style={{ flex: 1 }} />
        {running && !collapsed && (
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cancel Archie run"
            data-testid="forge-v3-archie-cancel"
            style={{
              background: 'transparent',
              border: '1px solid var(--forge-v3-rail-edge)',
              color: 'var(--forge-v3-ink-2)',
              cursor: 'pointer',
              padding: '1px 8px',
              borderRadius: 3,
              fontSize: 10,
              marginRight: 6,
            }}
          >
            cancel
          </button>
        )}
        <button
          type="button"
          onClick={onToggle}
          aria-label={collapsed ? 'Expand Archie' : 'Collapse Archie'}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'inherit',
            cursor: 'pointer',
            padding: 2,
            opacity: 0.6,
          }}
        >
          {collapsed ? '◧' : '◨'}
        </button>
      </header>
      {!collapsed && (
        <div className="forge-v3-archie-thread" data-testid="forge-v3-archie-thread">
          {(!thread || thread.length === 0) ? (
            <div className="forge-v3-archie-welcome" data-testid="forge-v3-archie-welcome">
              <h4>Welcome to Forge.</h4>
              <p>Tell me what to build. I drive the kernel — you describe the part.</p>
              <p style={{ fontSize: 11, color: 'var(--forge-v3-ink-mute)' }}>Try one:</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {SAMPLE_PROMPTS.map((s) => (
                  <button key={s.label}
                          type="button"
                          className="forge-v3-archie-welcome-chip"
                          onClick={() => onTrySample?.(s.prompt)}>
                    <code>›</code> {s.label}
                  </button>
                ))}
              </div>
              <p style={{ fontSize: 11, color: 'var(--forge-v3-ink-mute)', marginTop: 8 }}>
                Or press <kbd style={{
                  fontFamily: 'JetBrains Mono, monospace',
                  background: 'var(--forge-v3-surface)',
                  padding: '1px 4px',
                  borderRadius: 3,
                  border: '1px solid var(--forge-v3-rail-edge)',
                }}>⌘K</kbd> and start typing.
              </p>
            </div>
          ) : (
            thread.map((m) => (
              <div key={m.id}
                   className="forge-v3-archie-msg"
                   data-role={m.role}>
                {m.text}
              </div>
            ))
          )}
        </div>
      )}
    </aside>
  );
}
