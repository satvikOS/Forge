// Forge-65/79b — right panel. Feature Tree (top) + Properties (bottom).
// Single collapse toggle at the very top; clear visual separation
// between sections (background contrast + section icon).

import React from 'react';
import { Icon } from './icons/Icon.jsx';
import { FeatureTree } from './FeatureTree.jsx';

export function RightPanel({ collapsed, onToggle, featureTree, activeFeatureId,
                             selection, onPickFeature, onReorderFeature,
                             onToggleSuppress, onDeleteFeature, onRenameFeature,
                             bodies = [], onToggleBodyVisible, onRenameBody,
                             onPickBody }) {
  if (collapsed) {
    return (
      <aside className="forge-right" data-collapsed="true"
             data-testid="forge-right">
        <button type="button"
                onClick={onToggle}
                aria-label="Expand right panel"
                style={{
                  margin: '8px auto',
                  width: 28, height: 28,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'transparent',
                  border: '1px solid var(--forge-rail-edge)',
                  borderRadius: 3,
                  color: 'var(--forge-ink-2)',
                  cursor: 'pointer',
                }}>
          <Icon name="misc.expand_r" size={14} />
        </button>
      </aside>
    );
  }
  return (
    <aside className="forge-right" data-collapsed="false"
           aria-label="Feature tree and properties"
           data-testid="forge-right">
      <header style={{
        display: 'flex', alignItems: 'center', gap: 8,
        padding: '8px 12px',
        borderBottom: '1px solid var(--forge-rail-edge)',
        background: 'var(--forge-canvas)',
        fontSize: 11, fontWeight: 600,
        color: 'var(--forge-ink)',
        letterSpacing: '0.02em',
      }}>
        <span>Inspector</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onToggle}
                aria-label="Collapse right panel"
                style={{
                  width: 20, height: 20,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'transparent', border: 'none',
                  color: 'var(--forge-ink-mute)', cursor: 'pointer',
                }}>
          <Icon name="misc.collapse_r" size={12} />
        </button>
      </header>

      <section className="forge-right-section">
        <header className="forge-right-section-header">
          <Icon name="solid.fillet" size={11} />
          <span>Feature Tree · {(featureTree || []).length}</span>
        </header>
        <div className="forge-right-section-body">
          <FeatureTree nodes={featureTree}
                       activeId={activeFeatureId}
                       onPick={onPickFeature}
                       onReorder={onReorderFeature}
                       onToggleSuppress={onToggleSuppress}
                       onDelete={onDeleteFeature}
                       onRename={onRenameFeature} />
        </div>
      </section>

      <section className="forge-right-section" data-testid="forge-bodies-section">
        <header className="forge-right-section-header">
          <Icon name="select.body" size={11} />
          <span>Bodies · {(bodies || []).filter((b) => b && b.kind === 'native').length}</span>
        </header>
        <div className="forge-right-section-body">
          <BodyList bodies={bodies}
                    onToggleVisible={onToggleBodyVisible}
                    onRename={onRenameBody}
                    onPick={onPickBody} />
        </div>
      </section>

      <section className="forge-right-section">
        <header className="forge-right-section-header">
          <Icon name="select.body" size={11} />
          <span>Properties</span>
        </header>
        <div className="forge-right-section-body">
          {selection?.kind === 'none' || !selection ? (
            <div style={{ color: 'var(--forge-ink-mute)', fontStyle: 'italic',
                          padding: '4px 0' }}>
              Select something in the viewport.
            </div>
          ) : (
            <PropertyList selection={selection} />
          )}
        </div>
      </section>
    </aside>
  );
}

function BodyList({ bodies = [], onToggleVisible, onRename, onPick }) {
  const natives = (bodies || []).filter((b) => b && b.kind === 'native');
  if (natives.length === 0) {
    return (
      <div style={{ color: 'var(--forge-ink-mute)', fontStyle: 'italic', padding: '4px 0' }}>
        No bodies yet.
      </div>
    );
  }
  return (
    <ul data-testid="forge-body-list"
        style={{ listStyle: 'none', margin: 0, padding: 0,
                 display: 'flex', flexDirection: 'column', gap: 2 }}>
      {natives.map((b) => {
        const visible = b.visible !== false;
        return (
          <li key={b.id ?? b.handle}
              data-body-id={b.handle}
              data-visible={visible ? 'true' : 'false'}
              style={{ display: 'flex', alignItems: 'center', gap: 6,
                       padding: '2px 4px', borderRadius: 3 }}>
            <button type="button"
                    data-testid={`body-visible-${b.handle}`}
                    title={visible ? 'Hide body' : 'Show body'}
                    onClick={() => onToggleVisible?.(b)}
                    style={{ width: 18, height: 18, display: 'flex',
                             alignItems: 'center', justifyContent: 'center',
                             background: 'transparent', border: 'none',
                             color: visible ? 'var(--forge-ink)' : 'var(--forge-ink-mute)',
                             cursor: 'pointer', opacity: visible ? 1 : 0.5 }}>
              <Icon name={visible ? 'misc.eye' : 'misc.eye_off'} size={12} />
            </button>
            <span data-testid={`body-name-${b.handle}`}
                  onDoubleClick={() => {
                    const next = window.prompt?.('Rename body', b.name || `Body ${b.handle}`);
                    if (next && onRename) onRename(b, next);
                  }}
                  onClick={() => onPick?.(b)}
                  style={{ flex: 1, fontSize: 11, cursor: 'pointer',
                           color: visible ? 'var(--forge-ink)' : 'var(--forge-ink-mute)',
                           textDecoration: visible ? 'none' : 'line-through' }}>
              {b.name || `Body ${b.handle}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function PropertyList({ selection }) {
  const rows = [
    { label: 'Kind',     value: selection.kind },
    { label: 'Count',    value: String(selection.ids?.length ?? 0) },
    { label: 'First id', value: '#' + (selection.ids?.[0] ?? '-') },
  ];
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0,
                 display: 'flex', flexDirection: 'column', gap: 4 }}>
      {rows.map((r) => (
        <li key={r.label}
            style={{
              display: 'grid',
              gridTemplateColumns: '80px 1fr',
              alignItems: 'baseline',
              gap: 8,
              padding: '3px 0',
            }}>
          <span style={{ color: 'var(--forge-ink-mute)', fontSize: 10,
                         textTransform: 'uppercase',
                         letterSpacing: '0.04em' }}>{r.label}</span>
          <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                         color: 'var(--forge-ink)' }}>{r.value}</span>
        </li>
      ))}
    </ul>
  );
}
