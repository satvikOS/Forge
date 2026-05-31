// Forge v3 — multi-document tabs in the title bar.
//
// Each Archie thread = one design document. Tabs sit between the brand
// mark and the doc name; clicking one switches the active thread,
// middle-click closes (with implicit confirm if dirty), Cmd+N opens a
// new doc. The tab strip overflows horizontally — no truncation needed
// because titles are kept short.

import React from 'react';

export function DocTabs({ tabs, activeId, onSwitch, onClose, onNew }) {
  return (
    <div className="forge-v3-doc-tabs"
         role="tablist"
         aria-label="Open documents"
         data-testid="forge-v3-doc-tabs"
         style={{
           display: 'flex',
           alignItems: 'center',
           gap: 2,
           overflow: 'hidden',
           flex: '0 1 auto',
           minWidth: 0,
         }}>
      {tabs.map((t) => (
        <button key={t.id}
                type="button"
                role="tab"
                aria-selected={t.id === activeId}
                onClick={() => onSwitch?.(t.id)}
                onAuxClick={(e) => { if (e.button === 1) onClose?.(t.id); }}
                title={t.title}
                style={{
                  background: t.id === activeId ? 'var(--forge-v3-accent-mute)' : 'transparent',
                  color: t.id === activeId ? 'var(--forge-v3-ink)' : 'var(--forge-v3-ink-2)',
                  border: 'none',
                  borderBottom: t.id === activeId ? '2px solid var(--forge-v3-accent)' : '2px solid transparent',
                  padding: '4px 10px',
                  fontSize: 11,
                  cursor: 'pointer',
                  WebkitAppRegion: 'no-drag',
                  maxWidth: 160,
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}>
          <span>{t.title}</span>
          {t.dirty && (
            <span aria-label="unsaved"
                  style={{ marginLeft: 6, color: 'var(--forge-v3-accent)' }}>●</span>
          )}
          <span
                onClick={(e) => { e.stopPropagation(); onClose?.(t.id); }}
                aria-label={`Close ${t.title}`}
                role="button"
                tabIndex={-1}
                style={{
                  marginLeft: 8,
                  opacity: 0.5,
                  padding: '0 4px',
                  display: 'inline-block',
                  cursor: 'pointer',
                }}>×</span>
        </button>
      ))}
      <button type="button"
              onClick={onNew}
              aria-label="New document"
              title="New document (⌘N)"
              data-testid="forge-v3-doc-tabs-new"
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--forge-v3-ink-2)', cursor: 'pointer',
                padding: '4px 8px', fontSize: 14,
                WebkitAppRegion: 'no-drag',
              }}>+</button>
    </div>
  );
}
