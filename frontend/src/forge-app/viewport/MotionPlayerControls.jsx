/**
 * MotionPlayerControls — bottom-of-viewport transport bar for the
 * Forge-12b MotionPlayer.
 *
 * Hidden by default; appears when AppState.motionPlayer is non-null
 * (i.e. when an FEA-dynamic or CFD result has been attached to the
 * active body). Provides:
 *   - play / pause
 *   - scrub bar (range input)
 *   - speed slider (0.1× – 4×)
 *   - exaggeration slider (1× – 200×)
 *   - frame index + simulation time readout
 *
 * Calls into MotionPlayer.{play, pause, seek, setExaggeration, tick}
 * (forge-kernel/MotionPlayer.js, Forge-12b).
 */

import React, { useEffect, useRef, useState } from 'react';

export function MotionPlayerControls({ player, speed: speedProp = 1,
                                        exaggeration: exagProp = 1 }) {
  const [t, setT] = useState(0);
  const [frame, setFrame] = useState(0);
  const [speed, setSpeed] = useState(speedProp);
  const [exag, setExag] = useState(exagProp);
  const [playing, setPlaying] = useState(false);

  // Wire onFrame callback to keep the React state in sync.
  useEffect(() => {
    if (!player) return;
    const old = player._onFrame;
    player._onFrame = (info) => {
      setT(info.t);
      setFrame(info.frameIndex);
      if (old) old(info);
    };
    return () => { player._onFrame = old; };
  }, [player]);

  if (!player) return null;

  const duration = player.duration ? player.duration() : 1;

  const togglePlay = () => {
    if (playing) { player.pause(); setPlaying(false); }
    else { player.play({ speed, loop: true }); setPlaying(true); }
  };

  const onScrub = (e) => {
    const v = parseFloat(e.target.value);
    player.seek(v);
    setT(v);
  };

  const onSpeedChange = (e) => {
    const v = parseFloat(e.target.value);
    setSpeed(v);
    if (playing) { player.pause(); player.play({ speed: v, loop: true }); }
  };

  const onExagChange = (e) => {
    const v = parseFloat(e.target.value);
    setExag(v);
    player.setExaggeration(v);
  };

  return (
    <div style={containerStyle}>
      <button onClick={togglePlay} style={btnStyle}>
        {playing ? '❚❚' : '▶'}
      </button>
      <input type="range"
             min={0}
             max={duration}
             step={duration / 1000}
             value={t}
             onChange={onScrub}
             style={{ flex: 1 }} />
      <div style={readoutStyle}>
        frame {frame} · {t.toFixed(3)} s / {duration.toFixed(3)} s
      </div>
      <label style={labelStyle}>
        Speed
        <input type="range" min={0.1} max={4} step={0.1}
               value={speed} onChange={onSpeedChange}
               style={sliderStyle} />
        <span>{speed.toFixed(1)}×</span>
      </label>
      <label style={labelStyle}>
        Exaggerate
        <input type="range" min={1} max={200} step={1}
               value={exag} onChange={onExagChange}
               style={sliderStyle} />
        <span>{exag.toFixed(0)}×</span>
      </label>
    </div>
  );
}

const containerStyle = {
  position: 'absolute',
  bottom: 12,
  left: 12,
  right: 12,
  padding: '6px 10px',
  background: 'rgba(16,18,22,0.85)',
  border: '1px solid #2a2e36',
  borderRadius: 6,
  color: '#ddd',
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  zIndex: 5,
};
const btnStyle = {
  background: '#3a86ff',
  color: 'white',
  border: 'none',
  borderRadius: 4,
  width: 32,
  height: 28,
  cursor: 'pointer',
};
const labelStyle = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  whiteSpace: 'nowrap',
};
const sliderStyle = { width: 80 };
const readoutStyle = {
  fontVariantNumeric: 'tabular-nums',
  color: '#aaa',
  minWidth: 220,
};

export default MotionPlayerControls;
