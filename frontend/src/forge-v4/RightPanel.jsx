// Forge-65 — right panel (feature tree top, properties bottom).
// Collapsible to a 32 px rail.

import React from 'react';
import { Icon } from './icons/Icon.jsx';

export function RightPanel({ collapsed, onToggle, featureTree, selection }) {
  if (collapsed) {
    return (
      <aside className="forge-right" data-collapsed="true"
             data-testid="forge-right">
        <button type="button"
                onClick={onToggle}
                className="forge-tool"
                aria-label="Expand right panel"
                style={{ margin: 6 }}>
          <Icon name="misc.expand_r" size={16} />
        </button>
      </aside>
    );
  }
  return (
    <aside className="forge-right" data-collapsed="false"
           aria-label="Feature tree and properties"
           data-testid="forge-right">
      <section className="forge-right-section">
        <header className="forge-right-section-header">
          <span>Feature Tree</span>
          <button type="button" onClick={onToggle}
                  className="forge-tool"
                  aria-label="Collapse right panel"
                  style={{ width: 20, height: 20 }}>
            <Icon name="misc.collapse_r" size={14} />
          </button>
        </header>
        <div className="forge-right-section-body">
          {(featureTree?.length ?? 0) === 0 ? (
            <div style={{ color: 'var(--forge-ink-mute)', fontStyle: 'italic' }}>
              No features yet. Start a sketch or run an op.
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {featureTree.map((n) => (
                <li key={n.id}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 6,
                      padding: '3px 0',
                      color: n.suppressed ? 'var(--forge-ink-faint)' : 'var(--forge-ink)',
                    }}>
                  <Icon name={n.icon || 'sketch.point'} size={12} />
                  <span>{n.label}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section className="forge-right-section">
        <header className="forge-right-section-header">Properties</header>
        <div className="forge-right-section-body">
          {selection?.kind === 'none' || !selection ? (
            <div style={{ color: 'var(--forge-ink-mute)', fontStyle: 'italic' }}>
              Select something in the viewport.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '2px 12px' }}>
              <span style={{ color: 'var(--forge-ink-mute)' }}>Kind</span>
              <span>{selection.kind}</span>
              <span style={{ color: 'var(--forge-ink-mute)' }}>Count</span>
              <span>{selection.ids?.length ?? 0}</span>
              <span style={{ color: 'var(--forge-ink-mute)' }}>First id</span>
              <span style={{ fontFamily: 'var(--forge-mono)' }}>{selection.ids?.[0] ?? '-'}</span>
            </div>
          )}
        </div>
      </section>
    </aside>
  );
}
