import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { SELECTION_KINDS } from '../../kernel/forge/SelectionFilter.js';

/**
 * SelectionFilterPanel — chip toggles bound to a SelectionFilter instance.
 *
 * Each KIND (vertex / edge / face / body / component) is a togglable
 * chip; clicking flips the corresponding kind on the filter. The
 * underlying filter notifies subscribers, so e.g. the viewport picker
 * (Forge-27) updates without any prop drilling.
 */
export default function SelectionFilterPanel({ filter }) {
  const [enabled, setEnabled] = useState(() => filter ? new Set(filter.enabledKinds()) : new Set(SELECTION_KINDS));

  useEffect(() => {
    if (!filter) return undefined;
    setEnabled(new Set(filter.enabledKinds()));
    return filter.onChange((kinds) => setEnabled(new Set(kinds)));
  }, [filter]);

  function toggle(k) {
    if (!filter) return;
    if (filter.isPickable(k)) filter.disable(k);
    else                       filter.enable(k);
  }

  return (
    <div className="forge-panel">
      <div className="forge-panel-header">
        Selection Filter
        <div className="spacer" />
        <button
          type="button"
          onClick={() => filter && filter.reset()}
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--muted)', borderRadius: 3, padding: '0 6px', cursor: 'pointer', fontSize: 11 }}
        >
          reset
        </button>
      </div>
      <div className="forge-panel-body">
        <div className="forge-sel-chips">
          {SELECTION_KINDS.map((k) => (
            <button
              key={k}
              type="button"
              className={`forge-sel-chip${enabled.has(k) ? ' on' : ''}`}
              onClick={() => toggle(k)}
              aria-pressed={enabled.has(k)}
            >
              {k}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

SelectionFilterPanel.propTypes = {
  filter: PropTypes.object,
};
