import React, { useMemo } from 'react';
import PropTypes from 'prop-types';
import { useAppState } from './state/AppState.js';

/**
 * Forge ribbon (Forge-26).
 *
 * Workbench-style tabs across the top (Sketch / Part / Assembly / Drawing /
 * Simulate / Manufacture), each holding command groups. Buttons fire the
 * matching command on `commandRegistry` if one is registered; otherwise
 * we still render a disabled-looking button so the user can see the
 * workbench surface area before backing commands ship.
 *
 * The button layout is a static catalogue here — when the registry is
 * authoritative, the same render path overlays whatever's pinned in the
 * user's active workspace config (Engineer / Designer / Reviewer).
 */

export const WORKBENCH_TABS = ['Sketch', 'Part', 'Assembly', 'Drawing', 'Simulate', 'Manufacture'];

const CATALOG = {
  Sketch: [
    { label: 'Sketch', glyph: '◇', items: [
      { id: 'sketch.new',      title: 'New Sketch',    glyph: '✎', shortcut: 'S' },
      { id: 'sketch.line',     title: 'Line',          glyph: '╱', shortcut: 'L' },
      { id: 'sketch.circle',   title: 'Circle',        glyph: '◯', shortcut: 'C' },
      { id: 'sketch.rect',     title: 'Rectangle',     glyph: '▭', shortcut: 'R' },
    ]},
    { label: 'Constrain', glyph: '∣∣', items: [
      { id: 'sketch.coincident', title: 'Coincident', glyph: '⊕' },
      { id: 'sketch.parallel',   title: 'Parallel',   glyph: '∥' },
      { id: 'sketch.dim',        title: 'Dimension',  glyph: '◀▶', shortcut: 'D' },
    ]},
  ],
  Part: [
    { label: 'Features', glyph: '◰', items: [
      { id: 'part.extrude', title: 'Extrude', glyph: '⬒', shortcut: 'E' },
      { id: 'part.revolve', title: 'Revolve', glyph: '⟳', shortcut: 'V' },
      { id: 'part.sweep',   title: 'Sweep',   glyph: '↝' },
      { id: 'part.loft',    title: 'Loft',    glyph: '⇉' },
    ]},
    { label: 'Modify', glyph: '◮', items: [
      { id: 'part.fillet',  title: 'Fillet',  glyph: '◜', shortcut: 'F' },
      { id: 'part.chamfer', title: 'Chamfer', glyph: '◢' },
      { id: 'part.shell',   title: 'Shell',   glyph: '◌' },
      { id: 'part.pattern', title: 'Pattern', glyph: '▦' },
    ]},
  ],
  Assembly: [
    { label: 'Components', glyph: '◫', items: [
      { id: 'assembly.insert', title: 'Insert',   glyph: '↓' },
      { id: 'assembly.mate',   title: 'Mate',     glyph: '⊰⊱', shortcut: 'M' },
      { id: 'assembly.explode', title: 'Explode', glyph: '⊹' },
    ]},
  ],
  Drawing: [
    { label: 'Views', glyph: '◳', items: [
      { id: 'drawing.new',      title: 'New Sheet',  glyph: '▤' },
      { id: 'drawing.standard', title: 'Standard 3', glyph: '◧◨' },
      { id: 'drawing.section',  title: 'Section',    glyph: '⊥' },
    ]},
    { label: 'Annotate', glyph: '✐', items: [
      { id: 'drawing.dim',     title: 'Dimension',  glyph: '⟼' },
      { id: 'drawing.balloon', title: 'Balloon',    glyph: '①' },
      { id: 'drawing.gdt',     title: 'GD&T',       glyph: '⊥▢' },
    ]},
  ],
  Simulate: [
    { label: 'Studies', glyph: '⧉', items: [
      { id: 'sim.static',   title: 'Static',  glyph: '⛌' },
      { id: 'sim.modal',    title: 'Modal',   glyph: '∿' },
      { id: 'sim.thermal',  title: 'Thermal', glyph: '🔥' },
      { id: 'sim.cfd',      title: 'CFD',     glyph: '≋' },
    ]},
  ],
  Manufacture: [
    { label: 'CAM', glyph: '⛏', items: [
      { id: 'cam.profile', title: 'Profile', glyph: '◯' },
      { id: 'cam.pocket',  title: 'Pocket',  glyph: '▢' },
      { id: 'cam.drill',   title: 'Drill',   glyph: '⨀' },
      { id: 'cam.post',    title: 'Post',    glyph: '↳' },
    ]},
  ],
};

function RibbonButton({ item, onInvoke }) {
  return (
    <button
      type="button"
      className="forge-ribbon-button"
      title={item.shortcut ? `${item.title} (${item.shortcut})` : item.title}
      onClick={() => onInvoke(item.id)}
    >
      <span className="glyph" aria-hidden="true">{item.glyph || '◻'}</span>
      <span className="label">{item.title}</span>
      {item.shortcut ? <span className="shortcut">{item.shortcut}</span> : null}
    </button>
  );
}
RibbonButton.propTypes = {
  item: PropTypes.shape({
    id: PropTypes.string.isRequired,
    title: PropTypes.string.isRequired,
    glyph: PropTypes.string,
    shortcut: PropTypes.string,
  }).isRequired,
  onInvoke: PropTypes.func.isRequired,
};

export default function Ribbon() {
  const { state, setRibbonTab, commandRegistry } = useAppState();
  const activeTab = state.activeRibbonTab;
  const groups = useMemo(() => CATALOG[activeTab] || [], [activeTab]);

  function invoke(id) {
    try {
      if (commandRegistry.byId(id)) {
        commandRegistry.invoke(id, { workbench: activeTab });
      } else {
        // No backing command registered yet — log so the user sees the
        // surface area before the slice that wires it up lands.
        // eslint-disable-next-line no-console
        console.info(`[forge.ribbon] no command registered for ${id}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[forge.ribbon]', err);
    }
  }

  return (
    <div className="forge-ribbon" role="toolbar" aria-label="Forge ribbon">
      <div className="forge-ribbon-tabs">
        {WORKBENCH_TABS.map((t) => (
          <button
            type="button"
            key={t}
            className={`forge-ribbon-tab${t === activeTab ? ' active' : ''}`}
            onClick={() => setRibbonTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="forge-ribbon-body">
        {groups.length === 0 ? (
          <div style={{ color: 'var(--muted)' }}>No tools registered for {activeTab}.</div>
        ) : groups.map((g) => (
          <div className="forge-ribbon-group" key={g.label}>
            <div className="forge-ribbon-buttons">
              {g.items.map((it) => (
                <RibbonButton key={it.id} item={it} onInvoke={invoke} />
              ))}
            </div>
            <div className="group-label">{g.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Exported for tests so they don't need to mount the provider.
export { CATALOG as RIBBON_CATALOG };
