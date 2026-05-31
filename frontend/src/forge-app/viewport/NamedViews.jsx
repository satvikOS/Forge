/**
 * NamedViews — drawer of camera presets.
 *
 * Each entry pins a captured `cameraState` + a 256×144 thumbnail
 * (data URL from canvas.toDataURL). Clicking restores the camera +
 * controls.target with `applyCamera`. The list lives in the
 * ViewportStore so it can be picked up by ForgeProject on save (the
 * UI-shell agent will wire that in Forge-26).
 *
 * UI: a horizontal scroll strip of clickable thumbnails + a "Capture
 * current view" button. Each card has a small × to delete. We avoid
 * mountain-styling assumptions — Forge-26 owns theme tokens.
 */

import React, { useRef } from 'react';

import { captureCamera, applyCamera } from './cameraState.js';

const THUMB_W = 256;
const THUMB_H = 144;

/**
 * Capture the current Three.js canvas to a data-URL thumbnail. Pure
 * function so the headless test can call it with a stub canvas.
 */
export function captureThumbnail(canvas, w = THUMB_W, h = THUMB_H) {
  if (!canvas) return null;
  try {
    // Resize-on-snapshot: draw the gl canvas into a 2D canvas of
    // thumbnail size to keep payloads small.
    const off = (typeof document !== 'undefined')
      ? document.createElement('canvas') : null;
    if (!off) return null;
    off.width = w;
    off.height = h;
    const ctx = off.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(canvas, 0, 0, w, h);
    return off.toDataURL('image/png');
  } catch (e) {
    console.warn('[forge.viewport] thumbnail', e);
    return null;
  }
}

/**
 * Capture {state, thumbnail} given a live camera + controls + canvas.
 * Pure, headless-testable.
 */
export function captureNamedView({ camera, controls, canvas, name }) {
  const state = captureCamera(camera, controls);
  const thumbnail = captureThumbnail(canvas);
  return { name: name || `View ${Date.now().toString(36).slice(-4)}`,
           state, thumbnail };
}

/**
 * Apply a stored namedView back onto the live camera.
 */
export function restoreNamedView({ camera, controls, view }) {
  if (!view || !view.state) return null;
  return applyCamera(camera, controls, view.state);
}

/**
 * React drawer component. Reads/writes `namedViews` and exposes a
 * capture button that snapshots the current camera. The camera + controls
 * refs come from the viewport (passed via a context in the shell).
 */
export function NamedViews({ namedViews = [], onCapture = () => {},
                              onRestore = () => {}, onDelete = () => {},
                              onRename = () => {} }) {
  const fileInputRef = useRef(null);

  return (
    <div className="forge-named-views" style={drawerStyle}>
      <button onClick={onCapture}
              style={captureBtnStyle}>
        Capture current view
      </button>

      <div style={listStyle}>
        {namedViews.map((v) => (
          <div key={v.id} style={cardStyle}
               onClick={() => onRestore(v)}>
            {v.thumbnail ? (
              <img src={v.thumbnail}
                   alt={v.name}
                   style={{ width: THUMB_W / 2, height: THUMB_H / 2,
                            display: 'block', borderRadius: 4 }} />
            ) : (
              <div style={{ width: THUMB_W / 2, height: THUMB_H / 2,
                            background: '#23262d', borderRadius: 4 }} />
            )}
            <div style={cardLabelStyle}>
              <input type="text"
                     value={v.name}
                     onClick={(e) => e.stopPropagation()}
                     onChange={(e) => onRename(v.id, e.target.value)}
                     style={inputStyle} />
              <button onClick={(e) => { e.stopPropagation(); onDelete(v.id); }}
                      style={deleteBtnStyle}
                      aria-label="Delete view">×</button>
            </div>
          </div>
        ))}
        {namedViews.length === 0 ? (
          <div style={emptyStyle}>
            No saved views yet. Click "Capture current view" to add one.
          </div>
        ) : null}
      </div>
    </div>
  );
}

const drawerStyle = {
  position: 'absolute',
  bottom: 12,
  left: 12,
  right: 12,
  maxHeight: 200,
  background: 'rgba(16,18,22,0.7)',
  border: '1px solid #2a2e36',
  borderRadius: 6,
  padding: 8,
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  color: '#ddd',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  backdropFilter: 'blur(4px)',
};
const listStyle = {
  display: 'flex',
  gap: 8,
  overflowX: 'auto',
  flexWrap: 'nowrap',
  padding: '4px 0',
};
const cardStyle = {
  flex: '0 0 auto',
  cursor: 'pointer',
  padding: 4,
  border: '1px solid #2a2e36',
  borderRadius: 4,
  background: '#1a1d22',
};
const cardLabelStyle = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  marginTop: 4,
};
const inputStyle = {
  flex: 1,
  background: 'transparent',
  border: 'none',
  color: '#ddd',
  fontSize: 12,
  width: '100%',
};
const deleteBtnStyle = {
  background: 'transparent',
  color: '#888',
  border: 'none',
  cursor: 'pointer',
  fontSize: 14,
};
const captureBtnStyle = {
  alignSelf: 'flex-start',
  background: '#3a86ff',
  color: 'white',
  border: 'none',
  borderRadius: 4,
  padding: '4px 10px',
  fontSize: 12,
  cursor: 'pointer',
};
const emptyStyle = {
  color: '#888',
  fontStyle: 'italic',
  padding: '8px 4px',
};

export default NamedViews;
