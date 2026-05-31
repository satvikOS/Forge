// Forge v3 — persistent Archie sidebar.
//
// Always-anchored on the right. Collapses to 88px (Cmd+/ to toggle).
// Renders the conversation thread vertically; tool calls are inline.
// The composer lives in the bottom command bar — this panel is
// READ-ONLY for the thread.

import React from 'react';

export function ArchieSidebar({ collapsed, onToggle, thread, running = false, onCancel }) {
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
            <div className="forge-v3-archie-empty">
              Thread is empty. Type at the bottom; Archie answers here.
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
