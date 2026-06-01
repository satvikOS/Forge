// Forge-123 — Master skeleton panel.
//
// Right-anchored 360px panel that lists the named geometric references
// (points / axes / planes / lines). Each row is editable; an "+ Add"
// button creates a new entity in the active tab. The "Dependents: N"
// badge on each row counts the features whose params carry a
// `{ skelRef: '<name>' }` pointing at that entity; clicking it
// publishes a highlight selection to window.__forgeHighlightFeatures
// (consumed by the FeatureTree).
//
// Self-mounts via window.__forgeOpenSkeleton(true|false). Publishes
// live state via window.__forgeSkeleton. On every edit dispatches a
// `forge:skeleton-update` CustomEvent — ForgeShellV4 listens and reruns
// regenerate(featureTree) so downstream bodies follow the change.

import React from 'react';
import { createPortal } from 'react-dom';
import {
  defaultSkeleton, setEntity, removeEntity,
  entitiesDependentOn, loadSkeleton, saveSkeleton,
} from './skeleton.js';

const TAB_DEFS = [
  { id: 'points', label: 'Points' },
  { id: 'axes',   label: 'Axes' },
  { id: 'planes', label: 'Planes' },
  { id: 'lines',  label: 'Lines' },
];

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0,
  width: 360,
  maxWidth: '96vw',
  height: 'calc(100vh - var(--forge-topbar-h) - var(--forge-qat-h) - var(--forge-cmdbar-h))',
  background: 'var(--forge-canvas-3)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  boxShadow: '-12px 0 32px rgba(0,0,0,0.45)',
  display: 'flex', flexDirection: 'column',
  color: 'var(--forge-ink)', fontSize: 12,
  zIndex: 1290,
};
const headerStyle = {
  display: 'flex', alignItems: 'center',
  gap: 'var(--forge-space-2)',
  padding: 'var(--forge-space-3) var(--forge-space-4)',
  borderBottom: '1px solid var(--forge-rail-edge)',
  background: 'var(--forge-canvas)',
  fontWeight: 600, fontSize: 12, flexShrink: 0,
};
const tabsStyle = {
  display: 'flex', flexWrap: 'nowrap',
  borderBottom: '1px solid var(--forge-rail-edge)',
  background: 'var(--forge-canvas)', flexShrink: 0,
};
const tabBtn = (active) => ({
  flex: 1, background: 'transparent', border: 'none',
  color: active ? 'var(--forge-ink)' : 'var(--forge-ink-2)',
  fontSize: 11, padding: '8px 12px', cursor: 'pointer',
  borderBottom: `2px solid ${active ? 'var(--forge-accent)' : 'transparent'}`,
});
const bodyStyle = {
  flex: 1, overflowY: 'auto',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
};
const rowStyle = {
  display: 'flex', flexDirection: 'column',
  gap: 'var(--forge-space-1)',
  padding: 'var(--forge-space-2)',
  border: '1px solid var(--forge-rail-edge)',
  background: 'var(--forge-surface)',
  borderRadius: 'var(--forge-radius)',
};
const rowHeadStyle = {
  display: 'flex', alignItems: 'center', gap: 6,
};
const nameInputStyle = {
  flex: 1, background: 'var(--forge-canvas)',
  border: '1px solid var(--forge-rail-edge)', borderRadius: 3,
  color: 'var(--forge-ink)', padding: '3px 6px',
  font: 'inherit', fontFamily: 'var(--forge-mono)', fontSize: 11,
};
const fieldStyle = {
  flex: 1, background: 'var(--forge-canvas)',
  border: '1px solid var(--forge-rail-edge)', borderRadius: 3,
  color: 'var(--forge-ink)', padding: '3px 6px',
  font: 'inherit', fontFamily: 'var(--forge-mono)', fontSize: 11, minWidth: 0,
};
const fieldsRowStyle = {
  display: 'grid', gridTemplateColumns: '14px 1fr 1fr 1fr',
  gap: 4, alignItems: 'center',
};
const fieldLabelStyle = {
  fontFamily: 'var(--forge-mono)', fontSize: 10,
  color: 'var(--forge-ink-mute)',
};
const badgeStyle = (active, hot) => ({
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '2px 7px', borderRadius: 'var(--forge-radius-pill)',
  border: `1px solid ${hot ? 'var(--forge-accent-rim)' : 'var(--forge-rail-edge)'}`,
  background: active ? 'var(--forge-accent-mute)' :
             (hot ? 'var(--forge-surface-2)' : 'transparent'),
  color: hot ? 'var(--forge-ink)' : 'var(--forge-ink-2)',
  fontSize: 10, fontFamily: 'var(--forge-mono)',
  cursor: 'pointer',
});
const ghostBtn = {
  background: 'transparent', border: '1px solid var(--forge-rail-edge)',
  color: 'var(--forge-ink-2)', borderRadius: 3,
  padding: '2px 6px', cursor: 'pointer', fontSize: 11,
};
const addBtnStyle = {
  marginTop: 'var(--forge-space-2)',
  background: 'var(--forge-accent-mute)',
  border: '1px solid var(--forge-accent-rim)',
  color: 'var(--forge-ink)', borderRadius: 'var(--forge-radius)',
  padding: '6px 10px', cursor: 'pointer', fontSize: 11,
};
const closeBtn = {
  background: 'transparent', border: 'none',
  color: 'var(--forge-ink)', cursor: 'pointer', fontSize: 16,
  width: 22, height: 22,
};

function parseNumber(raw, fallback) {
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

function blankEntity(kind) {
  if (kind === 'points') return [0, 0, 0];
  if (kind === 'axes')   return { origin: [0, 0, 0], dir: [1, 0, 0] };
  if (kind === 'planes') return { origin: [0, 0, 0], normal: [0, 0, 1] };
  if (kind === 'lines')  return { a: [0, 0, 0], b: [10, 0, 0] };
  return null;
}

function nextAvailableName(bucket, prefix) {
  let i = 1;
  while (bucket && bucket[`${prefix}${i}`] !== undefined) i++;
  return `${prefix}${i}`;
}

function PointRow({ name, value, dependents, highlightActive, onName, onChange, onDelete, onHighlight }) {
  const [x, y, z] = Array.isArray(value) ? value : [0, 0, 0];
  return (
    <div style={rowStyle} data-skel-row data-skel-kind="points" data-skel-name={name}>
      <div style={rowHeadStyle}>
        <input style={nameInputStyle} value={name}
               data-testid={`forge-skel-name-points-${name}`}
               onChange={(e) => onName(e.target.value)} />
        <span style={badgeStyle(highlightActive, dependents.length > 0)}
              data-testid={`forge-skel-deps-points-${name}`}
              data-skel-deps={dependents.length}
              onClick={() => onHighlight(dependents)}>
          Dependents: {dependents.length}
        </span>
        <button style={ghostBtn} onClick={onDelete}
                data-testid={`forge-skel-del-points-${name}`}>×</button>
      </div>
      <div style={fieldsRowStyle}>
        <span style={fieldLabelStyle}>xyz</span>
        <input style={fieldStyle} value={x}
               data-testid={`forge-skel-points-${name}-x`}
               onChange={(e) => onChange([parseNumber(e.target.value, x), y, z])} />
        <input style={fieldStyle} value={y}
               data-testid={`forge-skel-points-${name}-y`}
               onChange={(e) => onChange([x, parseNumber(e.target.value, y), z])} />
        <input style={fieldStyle} value={z}
               data-testid={`forge-skel-points-${name}-z`}
               onChange={(e) => onChange([x, y, parseNumber(e.target.value, z)])} />
      </div>
    </div>
  );
}

function VectorRow({ name, value, kind, dependents, highlightActive,
                     onName, onChange, onDelete, onHighlight }) {
  const v = value && typeof value === 'object'
    ? value
    : (kind === 'axes'   ? { origin: [0,0,0], dir: [1,0,0] }
    :  kind === 'planes' ? { origin: [0,0,0], normal: [0,0,1] }
    :                       { a: [0,0,0], b: [10,0,0] });
  const [oKey, vKey] = kind === 'axes'   ? ['origin', 'dir']
                     : kind === 'planes' ? ['origin', 'normal']
                     :                      ['a',      'b'];
  const o = Array.isArray(v[oKey]) ? v[oKey] : [0, 0, 0];
  const d = Array.isArray(v[vKey]) ? v[vKey] : [1, 0, 0];
  const writeO = (next) => onChange({ ...v, [oKey]: next });
  const writeD = (next) => onChange({ ...v, [vKey]: next });
  return (
    <div style={rowStyle} data-skel-row data-skel-kind={kind} data-skel-name={name}>
      <div style={rowHeadStyle}>
        <input style={nameInputStyle} value={name}
               data-testid={`forge-skel-name-${kind}-${name}`}
               onChange={(e) => onName(e.target.value)} />
        <span style={badgeStyle(highlightActive, dependents.length > 0)}
              data-testid={`forge-skel-deps-${kind}-${name}`}
              data-skel-deps={dependents.length}
              onClick={() => onHighlight(dependents)}>
          Dependents: {dependents.length}
        </span>
        <button style={ghostBtn} onClick={onDelete}
                data-testid={`forge-skel-del-${kind}-${name}`}>×</button>
      </div>
      <div style={fieldsRowStyle}>
        <span style={fieldLabelStyle}>{oKey === 'a' ? 'a' : 'org'}</span>
        <input style={fieldStyle} value={o[0]}
               onChange={(e) => writeO([parseNumber(e.target.value, o[0]), o[1], o[2]])} />
        <input style={fieldStyle} value={o[1]}
               onChange={(e) => writeO([o[0], parseNumber(e.target.value, o[1]), o[2]])} />
        <input style={fieldStyle} value={o[2]}
               onChange={(e) => writeO([o[0], o[1], parseNumber(e.target.value, o[2])])} />
      </div>
      <div style={fieldsRowStyle}>
        <span style={fieldLabelStyle}>{vKey === 'b' ? 'b' : (vKey === 'dir' ? 'dir' : 'n')}</span>
        <input style={fieldStyle} value={d[0]}
               onChange={(e) => writeD([parseNumber(e.target.value, d[0]), d[1], d[2]])} />
        <input style={fieldStyle} value={d[1]}
               onChange={(e) => writeD([d[0], parseNumber(e.target.value, d[1]), d[2]])} />
        <input style={fieldStyle} value={d[2]}
               onChange={(e) => writeD([d[0], d[1], parseNumber(e.target.value, d[2])])} />
      </div>
    </div>
  );
}

export function SkeletonPanel({ open, skeleton, featureTree, onChange, onClose }) {
  const [tab, setTab] = React.useState('points');
  const [highlight, setHighlight] = React.useState({ kind: null, name: null });
  if (!open) return null;
  const bucket = skeleton?.[tab] || {};
  const names = Object.keys(bucket);

  const emit = (nextSkel, changedKind, changedName) => {
    onChange(nextSkel, changedKind, changedName);
  };

  const rename = (kind, oldName, newName) => {
    if (!newName.trim() || newName === oldName) return;
    if (skeleton[kind]?.[newName] !== undefined) return; // collision; ignore
    const val = skeleton[kind][oldName];
    let next = setEntity(skeleton, kind, oldName, null);
    next = setEntity(next, kind, newName, val);
    emit(next, kind, newName);
  };

  const setVal = (kind, name, value) => {
    emit(setEntity(skeleton, kind, name, value), kind, name);
  };

  const del = (kind, name) => {
    emit(removeEntity(skeleton, kind, name), kind, name);
  };

  const add = () => {
    const prefix = { points: 'P', axes: 'A', planes: 'PL', lines: 'L' }[tab];
    const name = nextAvailableName(bucket, prefix);
    setVal(tab, name, blankEntity(tab));
  };

  const highlightDeps = (kind, name, ids) => {
    setHighlight({ kind, name });
    if (typeof window !== 'undefined') {
      window.__forgeHighlightFeatures = ids;
      window.dispatchEvent(new CustomEvent('forge:skeleton-highlight',
        { detail: { kind, name, ids } }));
    }
  };

  return (
    <div style={panelStyle} data-testid="forge-skeleton-panel">
      <header style={headerStyle}>
        <span>Skeleton · master references</span>
        <span style={{ flex: 1 }} />
        <button style={closeBtn} onClick={onClose}
                data-testid="forge-skeleton-close">×</button>
      </header>
      <nav style={tabsStyle}>
        {TAB_DEFS.map((t) => (
          <button key={t.id} style={tabBtn(tab === t.id)}
                  data-testid={`forge-skel-tab-${t.id}`}
                  data-active={tab === t.id ? 'true' : 'false'}
                  onClick={() => setTab(t.id)}>
            {t.label} · {Object.keys(skeleton?.[t.id] || {}).length}
          </button>
        ))}
      </nav>
      <div style={bodyStyle}>
        {names.length === 0 && (
          <div style={{ color: 'var(--forge-ink-mute)', textAlign: 'center', padding: 24 }}>
            No {tab} yet — click + Add to create one.
          </div>
        )}
        {names.map((name) => {
          const deps = entitiesDependentOn(featureTree, tab, name);
          const isHot = highlight.kind === tab && highlight.name === name;
          if (tab === 'points') {
            return (
              <PointRow key={name} name={name} value={bucket[name]}
                        dependents={deps} highlightActive={isHot}
                        onName={(v) => rename(tab, name, v)}
                        onChange={(v) => setVal(tab, name, v)}
                        onDelete={() => del(tab, name)}
                        onHighlight={(ids) => highlightDeps(tab, name, ids)} />
            );
          }
          return (
            <VectorRow key={name} name={name} value={bucket[name]} kind={tab}
                       dependents={deps} highlightActive={isHot}
                       onName={(v) => rename(tab, name, v)}
                       onChange={(v) => setVal(tab, name, v)}
                       onDelete={() => del(tab, name)}
                       onHighlight={(ids) => highlightDeps(tab, name, ids)} />
          );
        })}
        <button style={addBtnStyle} onClick={add}
                data-testid={`forge-skel-add-${tab}`}>+ Add {tab.slice(0, -1)}</button>
      </div>
    </div>
  );
}

/**
 * Host element — App.jsx mounts this once as a sibling of the shell.
 * It owns the persisted skeleton state, exposes the window hooks,
 * and rebroadcasts edits as `forge:skeleton-update` so the shell can
 * trigger regenerate(featureTree).
 */
export function SkeletonPanelHost() {
  const [open, setOpen] = React.useState(false);
  const [skeleton, setSkeleton] = React.useState(() => loadSkeleton());
  const [featureTree, setFeatureTree] = React.useState([]);

  // Keep a local mirror of featureTree so the dependents badges update
  // when features are added/removed from the shell.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const sync = () => {
      const t = window.__forgeFeatureTree;
      if (Array.isArray(t)) setFeatureTree(t);
    };
    sync();
    const id = setInterval(sync, 600);
    return () => clearInterval(id);
  }, []);

  // Publish state + window API.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeSkeleton = skeleton;
    window.__forgeOpenSkeleton = (v) => setOpen(typeof v === 'boolean' ? v : !open);
    window.__forgeSetSkeleton = (next, changedKind, changedName) => {
      if (!next) return;
      setSkeleton(next);
      saveSkeleton(next);
      window.dispatchEvent(new CustomEvent('forge:skeleton-update',
        { detail: { skeleton: next, changedKind: changedKind || null,
                    changedName: changedName || null } }));
    };
  }, [skeleton, open]);

  const handleChange = (next, changedKind, changedName) => {
    setSkeleton(next);
    saveSkeleton(next);
    if (typeof window !== 'undefined') {
      window.__forgeSkeleton = next;
      window.dispatchEvent(new CustomEvent('forge:skeleton-update',
        { detail: { skeleton: next, changedKind, changedName } }));
    }
  };

  if (typeof document === 'undefined') return null;
  return createPortal(
    <SkeletonPanel open={open}
                   skeleton={skeleton}
                   featureTree={featureTree}
                   onChange={handleChange}
                   onClose={() => setOpen(false)} />,
    document.body);
}

export default SkeletonPanel;
