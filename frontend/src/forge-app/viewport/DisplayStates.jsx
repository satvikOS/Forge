/**
 * DisplayStates — a 5-way radio bar mirroring SolidWorks' "Display
 * Style" buttons.
 *
 * The state lives in AppState.displayState; ForgeViewport's
 * useEffect swaps every mesh's material on every change via
 * `applyDisplayState`. This component is just the chrome.
 */

import React from 'react';

import { DISPLAY_STATES } from './displayStateMaterial.js';

const LABELS = {
  'shaded':             'Shaded',
  'shaded-with-edges':  'Shaded + edges',
  'wireframe':          'Wireframe',
  'hidden-line':        'Hidden line',
  'transparent':        'Transparent',
};

export function DisplayStates({ value = 'shaded', onChange = () => {} }) {
  return (
    <div role="radiogroup" aria-label="Display state"
         style={containerStyle}>
      {DISPLAY_STATES.map((s) => {
        const active = value === s;
        return (
          <button key={s}
                  role="radio"
                  aria-checked={active}
                  onClick={() => onChange(s)}
                  style={{ ...btnStyle,
                           background: active ? '#3a86ff' : 'transparent',
                           color: active ? 'white' : '#bbb' }}>
            {LABELS[s] || s}
          </button>
        );
      })}
    </div>
  );
}

const containerStyle = {
  display: 'inline-flex',
  background: 'rgba(16,18,22,0.7)',
  border: '1px solid #2a2e36',
  borderRadius: 6,
  padding: 2,
  gap: 2,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
};
const btnStyle = {
  border: 'none',
  borderRadius: 4,
  padding: '4px 8px',
  cursor: 'pointer',
};

export default DisplayStates;
