import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';

/**
 * StatusBar — bottom strip. Reports:
 *   - mouse / cursor world coords (driven by a stub viewport listener;
 *     the viewport slice (Forge-27) will wire pointermove → setStatus).
 *   - active units (from the active ForgeProject; defaults to mm).
 *   - selection count (live from a SelectionFilter listener).
 *   - kernel ready badge (green / red dot).
 */
export default function StatusBar({
  status,
  units = 'mm',
  selectionFilter,
}) {
  const [enabledKinds, setEnabledKinds] = useState(
    selectionFilter ? selectionFilter.enabledKinds() : []
  );

  useEffect(() => {
    if (!selectionFilter) return undefined;
    setEnabledKinds(selectionFilter.enabledKinds());
    return selectionFilter.onChange((k) => setEnabledKinds(k));
  }, [selectionFilter]);

  const { mouse = { x: 0, y: 0, z: 0 }, kernelReady, kernelError } = status || {};
  const dotClass = kernelReady ? 'ok' : (kernelError ? 'error' : 'warn');

  return (
    <div className="forge-statusbar" role="status" aria-live="polite">
      <span className="badge" title="Cursor world coordinates">
        <span>X {mouse.x.toFixed(2)}</span>
        <span>Y {mouse.y.toFixed(2)}</span>
        <span>Z {mouse.z.toFixed(2)}</span>
      </span>
      <span className="badge">Units: {units}</span>
      <span className="badge">
        Selection: {enabledKinds.length}/{enabledKinds.length === 0 ? 0 : enabledKinds.length} kinds
      </span>
      <span className="spacer" />
      <span className="badge" title={kernelError || (kernelReady ? 'Forge kernel ready' : 'Forge kernel not loaded')}>
        <span className={`dot ${dotClass}`} />
        kernel {kernelReady ? 'ready' : (kernelError ? 'failed' : 'detached')}
      </span>
    </div>
  );
}

StatusBar.propTypes = {
  status: PropTypes.object,
  units: PropTypes.string,
  selectionFilter: PropTypes.object,
};
