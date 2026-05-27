import { useEffect, useState } from 'react';
import {
  setSectionAxis, setSectionPositionMm, clearSection, attachSectionPlane,
} from '../foundation/SectionPlane.js';
import './SectionPlaneOverlay.css';

/**
 * SectionPlaneOverlay — small viewport top-right control: three axis
 * buttons (X / Y / Z) + a position scrubber + an "Off" toggle. Drives
 * the foundation SectionPlane API. Renders nothing when the section
 * is off; the X/Y/Z buttons are always visible so the user can engage.
 */

export default function SectionPlaneOverlay() {
  const [axis, setAxis] = useState(null);   // 'x' | 'y' | 'z' | null
  const [position, setPosition] = useState(0);  // mm

  // Install foundation API on mount.
  useEffect(() => { attachSectionPlane(); }, []);

  const onAxis = (a) => {
    if (axis === a) {
      // Toggle off when same axis pressed twice.
      clearSection();
      setAxis(null);
      setPosition(0);
    } else {
      setSectionAxis(a);
      setSectionPositionMm(position);
      setAxis(a);
    }
  };
  const onSlider = (e) => {
    const v = Number(e.target.value);
    setPosition(v);
    setSectionPositionMm(v);
  };
  const onClear = () => {
    clearSection();
    setAxis(null);
    setPosition(0);
  };

  return (
    <div className="section-overlay" data-archdisc-section-overlay="active" data-archdisc-section-axis={axis ?? ''}>
      <div className="section-axes">
        {['x', 'y', 'z'].map(a => (
          <button
            key={a}
            className={`section-axis-btn ${axis === a ? 'active' : ''}`}
            onClick={() => onAxis(a)}
            title={`Section along ${a.toUpperCase()} axis`}
            data-archdisc-section-axis-btn={a}
          >
            {a.toUpperCase()}
          </button>
        ))}
        {axis !== null && (
          <button
            className="section-clear-btn"
            onClick={onClear}
            title="Turn section off"
            data-archdisc-section-clear="true"
          >×</button>
        )}
      </div>
      {axis !== null && (
        <input
          type="range"
          className="section-slider"
          min={-200}
          max={200}
          step={1}
          value={position}
          onChange={onSlider}
          aria-label={`Section plane position along ${axis} axis (mm)`}
          data-archdisc-section-slider="true"
        />
      )}
      {axis !== null && (
        <div className="section-readout" data-archdisc-section-readout={position}>
          {axis.toUpperCase()} = {position} mm
        </div>
      )}
    </div>
  );
}
