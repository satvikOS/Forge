// Forge-65/79b — right panel. Feature Tree (top) + Properties (bottom).
// Single collapse toggle at the very top; clear visual separation
// between sections (background contrast + section icon).
//
// UX upgrade (right-props area): the Properties section is now a real
// PropertyManager — a sectioned, collapsible, label+value inspector with
// aligned columns, tabular-numeric values, and unit suffixes for dimensional
// parameters, matching the CATIA / SolidWorks / NX PropertyManager a pro CAD
// user expects. Built entirely on the --fds-* design-system tokens / fds-*
// classes; no ad-hoc colours or sizes. This is a VISUAL + UX upgrade only:
// every data-testid, prop, and handler is preserved verbatim.

import React from 'react';
import { Icon } from './icons/Icon.jsx';
import { FeatureTree } from './FeatureTree.jsx';

export function RightPanel({ collapsed, onToggle, featureTree, activeFeatureId,
                             selection, onPickFeature, onReorderFeature,
                             onToggleSuppress, onDeleteFeature, onRenameFeature,
                             bodies = [], onToggleBodyVisible, onRenameBody,
                             onPickBody }) {
  // Forge-195 (parity ledger: panel resizing) — drag-to-resize on the
  // panel's left edge, width persisted; the Studio V3 pattern ported.
  const W_KEY = 'forge.v4.rightWidth';
  const W_MIN = 260, W_MAX = 640;
  const [width, setWidth] = React.useState(() => {
    const raw = Number(window.localStorage.getItem(W_KEY));
    return Number.isFinite(raw) && raw >= W_MIN && raw <= W_MAX ? raw : 0;
  });
  const dragRef = React.useRef(null);
  React.useEffect(() => {
    if (width) { try { window.localStorage.setItem(W_KEY, String(width)); } catch (_) {} }
  }, [width]);
  const onDragStart = (e) => {
    e.preventDefault();
    const startW = width || (e.currentTarget.parentElement?.getBoundingClientRect()?.width || 340);
    dragRef.current = { startX: e.clientX, startW };
    const onMove = (ev) => {
      const dx = ev.clientX - dragRef.current.startX;
      setWidth(Math.min(W_MAX, Math.max(W_MIN, dragRef.current.startW - dx)));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };
  if (collapsed) {
    return (
      <aside className="forge-right" data-collapsed="true"
             data-testid="forge-right">
        <button type="button"
                onClick={onToggle}
                aria-label="Expand right panel"
                className="fds-icon-btn"
                style={{ margin: '8px auto' }}>
          <Icon name="misc.expand_r" size={14} />
        </button>
      </aside>
    );
  }

  const nativeCount = (bodies || []).filter((b) => b && b.kind === 'native').length;
  const featureCount = (featureTree || []).length;

  return (
    <aside className="forge-right" data-collapsed="false"
           aria-label="Feature tree and properties"
           data-testid="forge-right"
           style={width ? { width, position: 'relative' } : { position: 'relative' }}>
      <div data-testid="forge-right-resize"
           onMouseDown={onDragStart}
           title="Drag to resize"
           style={{ position: 'absolute', left: -3, top: 0, bottom: 0, width: 6,
                    cursor: 'ew-resize', zIndex: 'var(--fds-z-sticky)' }} />

      <header className="forge-right-dock-head">
        <Icon name="misc.settings" size={14} />
        <span className="forge-right-dock-title">Inspector</span>
        <span style={{ flex: 1 }} />
        <button type="button" onClick={onToggle}
                aria-label="Collapse right panel"
                className="fds-icon-btn fds-icon-btn--xs">
          <Icon name="misc.collapse_r" size={12} />
        </button>
      </header>

      <section className="forge-right-section">
        <header className="forge-right-section-header">
          <span className="forge-right-section-title">
            <Icon name="solid.fillet" size={12} />
            <span>Feature Tree</span>
          </span>
          <span className="forge-right-count fds-num">{featureCount}</span>
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
          <span className="forge-right-section-title">
            <Icon name="select.body" size={12} />
            <span>Bodies</span>
          </span>
          <span className="forge-right-count fds-num">{nativeCount}</span>
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
          <span className="forge-right-section-title">
            <Icon name="misc.settings" size={12} />
            <span>Properties</span>
          </span>
          <SelectionBadge selection={selection} />
        </header>
        <div className="forge-right-section-body">
          {selection?.kind === 'none' || !selection ? (
            <div className="forge-right-empty">
              Select an entity in the viewport to inspect its properties.
            </div>
          ) : (
            <PropertyManager selection={selection} bodies={bodies} />
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
      <div className="forge-right-empty">No bodies yet.</div>
    );
  }
  return (
    <ul data-testid="forge-body-list" className="forge-body-list">
      {natives.map((b) => {
        const visible = b.visible !== false;
        return (
          <li key={b.id ?? b.handle}
              data-body-id={b.handle}
              data-visible={visible ? 'true' : 'false'}
              className="forge-body-row">
            <button type="button"
                    data-testid={`body-visible-${b.handle}`}
                    title={visible ? 'Hide body' : 'Show body'}
                    onClick={() => onToggleVisible?.(b)}
                    className="forge-body-eye"
                    data-on={visible ? 'true' : 'false'}>
              <Icon name={visible ? 'misc.eye' : 'misc.eye_off'} size={12} />
            </button>
            <span data-testid={`body-name-${b.handle}`}
                  onDoubleClick={() => {
                    const next = window.prompt?.('Rename body', b.name || `Body ${b.handle}`);
                    if (next && onRename) onRename(b, next);
                  }}
                  onClick={() => onPick?.(b)}
                  className="forge-body-name"
                  data-hidden={visible ? 'false' : 'true'}>
              {b.name || `Body ${b.handle}`}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

// ───────────────────────── PropertyManager ─────────────────────────
// A pro CAD PropertyManager: a small selection-kind badge + collapsible,
// sectioned label/value groups. Resolves the selected body (when the pick is a
// body) from the live `bodies` registry so real engineering parameters show up,
// not just the raw selection ids.

const KIND_LABEL = {
  body: 'Body', face: 'Face', edge: 'Edge', vertex: 'Vertex',
  feature: 'Feature', sketch: 'Sketch', none: 'None',
};

function SelectionBadge({ selection }) {
  if (!selection || selection.kind === 'none') return null;
  const n = selection.ids?.length ?? 0;
  const label = KIND_LABEL[selection.kind] || selection.kind;
  return (
    <span className="forge-prop-badge">
      {label}{n > 1 ? <span className="fds-num"> ×{n}</span> : null}
    </span>
  );
}

// Heuristic units for dimensional params — length-like → mm, angle-like → °.
const ANGLE_KEYS = /(angle|deg|rotation|twist|taper|draft|sweep|bevel|chamferAngle)/i;
const COUNT_KEYS = /(count|num|sides|teeth|instances|copies|segments|rows|cols|divisions)/i;
const LENGTH_KEYS = /(length|width|height|depth|radius|diameter|thickness|distance|offset|size|x|y|z|dx|dy|dz|gap|pitch|fillet|chamfer|extrude|height1|height2)/i;

function unitFor(key, value) {
  if (typeof value !== 'number') return '';
  if (ANGLE_KEYS.test(key)) return '°';
  if (COUNT_KEYS.test(key)) return '';
  if (LENGTH_KEYS.test(key)) return 'mm';
  return '';
}

function fmtNum(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return String(v);
  // Trim to 4 significant decimals, drop trailing zeros — engineering-clean.
  const r = Math.abs(v) >= 1000 ? v.toFixed(1) : v.toFixed(4);
  return r.replace(/\.?0+$/, '');
}

function humanizeKey(key) {
  return String(key)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

// One aligned key/value row. Numeric values are tabular and right-aligned with
// an optional unit suffix; text values stay left-clean.
function PropRow({ label, value, unit, mono = true, title }) {
  return (
    <div className="fds-prop-row" title={title}>
      <span className="fds-prop-key">{label}</span>
      <span className="fds-prop-val" data-mono={mono ? 'true' : 'false'}>
        <span className="forge-prop-num">{value}</span>
        {unit ? <span className="forge-prop-unit">{unit}</span> : null}
      </span>
    </div>
  );
}

// Collapsible parameter group — twisty header, persisted open/closed.
function PropGroup({ id, title, count, defaultOpen = true, children }) {
  const KEY = `forge.v4.props.grp.${id}`;
  const [open, setOpen] = React.useState(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      return raw == null ? defaultOpen : raw === '1';
    } catch (_) { return defaultOpen; }
  });
  const toggle = () => {
    setOpen((o) => {
      const next = !o;
      try { window.localStorage.setItem(KEY, next ? '1' : '0'); } catch (_) {}
      return next;
    });
  };
  return (
    <div className="forge-prop-group" data-open={open ? 'true' : 'false'}>
      <button type="button"
              className="forge-prop-group-head"
              aria-expanded={open}
              onClick={toggle}>
        <span className="forge-prop-twisty" aria-hidden="true" />
        <span className="forge-prop-group-title">{title}</span>
        {count != null
          ? <span className="forge-prop-group-count fds-num">{count}</span>
          : null}
      </button>
      {open ? <div className="forge-prop-group-body">{children}</div> : null}
    </div>
  );
}

function PropertyManager({ selection, bodies = [] }) {
  const kind = selection.kind;
  const ids = selection.ids || [];
  const count = ids.length;

  // Resolve the picked body (single-body picks) for richer parameters.
  const handle = selection.bodyHandle != null ? selection.bodyHandle : ids[0];
  const body = (kind === 'body')
    ? (bodies || []).find((b) => b && (b.handle === handle || b.id === handle))
    : null;

  // ── General group: always present, identity of the selection. ──
  const general = [];
  general.push({ label: 'Type', value: KIND_LABEL[kind] || kind, mono: false });
  if (body) {
    general.push({ label: 'Name', value: body.name || `Body ${body.handle}`, mono: false });
    general.push({ label: 'Handle', value: '#' + body.handle });
    if (body.toolId) general.push({ label: 'Source', value: body.toolId, mono: false });
  } else {
    general.push({ label: 'Count', value: String(count) });
    if (count > 0) general.push({ label: 'First id', value: '#' + ids[0] });
    if (count > 1) general.push({ label: 'Last id', value: '#' + ids[count - 1] });
  }

  // ── Parameters group: the body's authored params, formatted with units. ──
  const params = body && body.params && typeof body.params === 'object'
    ? Object.entries(body.params)
        .filter(([, v]) => v != null && typeof v !== 'object')
        .map(([k, v]) => {
          const num = typeof v === 'number';
          return {
            label: humanizeKey(k),
            value: num ? fmtNum(v) : String(v),
            unit: num ? unitFor(k, v) : '',
            mono: num,
            title: `${k} = ${v}`,
          };
        })
    : [];

  return (
    <div className="forge-prop-manager" data-sel-kind={kind}>
      <PropGroup id="general" title="General" count={general.length}>
        {general.map((r) => (
          <PropRow key={r.label} label={r.label} value={r.value}
                   unit={r.unit} mono={r.mono} title={r.title} />
        ))}
      </PropGroup>

      {params.length > 0 ? (
        <PropGroup id="params" title="Parameters" count={params.length}>
          {params.map((r) => (
            <PropRow key={r.label} label={r.label} value={r.value}
                     unit={r.unit} mono={r.mono} title={r.title} />
          ))}
        </PropGroup>
      ) : null}
    </div>
  );
}
