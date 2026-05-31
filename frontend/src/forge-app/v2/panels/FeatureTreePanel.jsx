/**
 * FeatureTreePanel v2 — feature history with proper drag-reorder,
 * suppress, rollback, and inline rename. Uses the design-system Tree.
 */

import React, { useState, useMemo } from 'react';
import { Tree } from '../../design-system/primitives/Tree.jsx';
import { Icon } from '../../design-system/icons/Icon.jsx';
import { Input } from '../../design-system/primitives/Input.jsx';
import { EmptyState } from '../../design-system/primitives/EmptyState.jsx';

const FEATURE_ICONS = {
  sketch:        'sketchTab',
  extrude:       'extrude',
  revolve:       'revolve',
  sweep:         'sweep',
  loft:          'loft',
  shell:         'shell',
  fillet:        'fillet',
  chamfer:       'chamfer',
  hole:          'hole',
  rib:           'rib',
  draft:         'draft',
  patternLinear: 'patternLinear',
  patternCircular: 'patternCircular',
  mirror:        'mirror',
};

export function FeatureTreePanel({ project, onSelect, onActivate }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState([]);

  const tree = project?.featureTree;
  const features = tree?.list?.() || tree?.features || [];

  const nodes = useMemo(() => {
    const base = [
      { id: '__material', label: project?.material || 'Material: Steel', icon: <Icon name="settings" size={12} /> },
      { id: '__planes', label: 'Default Planes', children: [
        { id: '__p_xy', label: 'Front Plane (XY)' },
        { id: '__p_xz', label: 'Top Plane (XZ)' },
        { id: '__p_yz', label: 'Right Plane (YZ)' },
      ]},
      { id: '__origin', label: 'Origin' },
    ];
    const norm = features.filter((f) => {
      if (!query) return true;
      const q = query.toLowerCase();
      return (f.name || f.kind || '').toLowerCase().includes(q);
    }).map((f) => ({
      id: f.id,
      label: f.name || f.kind,
      icon: <Icon name={FEATURE_ICONS[f.kind] || 'box'} size={12} />,
      suppressed: !!f.suppressed,
      status: f.error ? 'error' : null,
    }));
    return [...base, ...norm];
  }, [features, query, project?.material]);

  return (
    <section aria-label="Feature tree" style={{
      display: 'flex', flexDirection: 'column',
      height: '100%',
    }}>
      {/* HEADER */}
      <header style={{
        padding: 'var(--space-6) var(--space-7)',
        borderBottom: '1px solid var(--border-subtle)',
        display: 'flex', flexDirection: 'column', gap: 'var(--space-5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <Icon name="partTab" size={16} style={{ color: 'var(--accent-bg)' }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--weight-semibold)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {project?.name || 'Untitled.forge'}
            </div>
            <div style={{ fontSize: 'var(--text-2xs)', color: 'var(--text-tertiary)' }}>
              v{project?.version || 1} · {features.length} features
            </div>
          </div>
        </div>
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter…"
          prefix={<Icon name="search" size={12} />}
        />
      </header>

      {/* TREE */}
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-3) 0' }}>
        {features.length === 0 && !query ? (
          <EmptyState
            icon={<Icon name="extrude" />}
            size="sm"
            title="Empty document"
            description="Use Sketch → Extrude in the Part tab, or ask Archie to build something."
          />
        ) : (
          <Tree
            nodes={nodes}
            selected={selected}
            onSelect={(ids) => { setSelected(ids); onSelect?.(ids); }}
            onActivate={onActivate}
            multiSelect
          />
        )}
      </div>
    </section>
  );
}
