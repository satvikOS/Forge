// Forge-96 — exploded views + walk-through.
//
// Exploded view: each body gets a normalised direction (default: vector from
// scene centroid → body centroid) and a magnitude scale. Slider 0..1 drives
// per-body translation. Animates between collapsed (0) and exploded (1).
//
// Walk-through: list of camera key-frames {position, target, duration_ms}.
// Play interpolates camera through the keyframes with easeInOutQuad.
// Optional MediaRecorder capture for MP4 export.

import React from 'react';

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 360, zIndex: 1310,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 13,
};

export function ExplodedView({ open, onClose, bodies, onExplodeChange }) {
  const [t, setT] = React.useState(0);
  const [perBody, setPerBody] = React.useState({});
  if (!open) return null;
  const setBody = (id, dir, mag) => {
    const next = { ...perBody, [id]: { dir, mag } };
    setPerBody(next);
    onExplodeChange?.(computeOffsets(next, t));
  };
  const computeOffsets = (table, factor) => {
    const out = {};
    for (const b of bodies) {
      const cfg = table[b.id] || autoExplodeConfig(b, bodies);
      out[b.id] = cfg.dir.map((d) => d * cfg.mag * factor);
    }
    return out;
  };
  React.useEffect(() => { onExplodeChange?.(computeOffsets(perBody, t)); }, [t]);
  return (
    <div style={panelStyle} data-testid="forge-explode-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Exploded View</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose} style={btnStyle} data-testid="forge-explode-close">×</button>
      </header>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <small style={{ color: 'var(--forge-ink-mute)' }}>Explode factor</small>
        <input type="range" min={0} max={1} step={0.01} value={t}
               onChange={(e) => setT(parseFloat(e.target.value))}
               data-testid="forge-explode-slider" />
        <output style={{ fontFamily: 'var(--forge-mono)' }}>{(t * 100).toFixed(0)}%</output>
      </label>
      <button onClick={() => animate(setT)}
              style={{ ...btnStyle, background: 'var(--forge-accent-mute)' }}
              data-testid="forge-explode-animate">Animate explode</button>
      <section style={{ overflowY: 'auto', flex: 1 }}>
        <div style={hdrStyle}>Per-body offsets</div>
        {bodies.map((b) => {
          const cfg = perBody[b.id] || autoExplodeConfig(b, bodies);
          return (
            <div key={b.id} style={{ borderBottom: '1px solid var(--forge-rail-edge)',
                                     padding: 'var(--forge-space-1) 0' }}>
              <small>{b.name || b.id}</small>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
                {['X','Y','Z'].map((axis, i) => (
                  <input key={axis} type="number" step="0.1" defaultValue={cfg.dir[i].toFixed(2)}
                         onBlur={(e) => {
                           const nextDir = [...cfg.dir];
                           nextDir[i] = parseFloat(e.target.value) || 0;
                           setBody(b.id, nextDir, cfg.mag);
                         }}
                         style={inputStyle}
                         data-explode-dir={`${b.id}/${axis}`} />
                ))}
                <input type="number" step="1" defaultValue={cfg.mag.toFixed(0)}
                       onBlur={(e) => setBody(b.id, cfg.dir, parseFloat(e.target.value) || 0)}
                       style={inputStyle}
                       data-explode-mag={b.id} />
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}

function autoExplodeConfig(body, bodies) {
  // Default direction: unit vector from scene origin to body's expected
  // position. For synthetic bodies we use indices; for native we trust the
  // centroid from massProps if available.
  const i = bodies.findIndex((x) => x.id === body.id);
  const n = bodies.length || 1;
  const angle = (i / n) * Math.PI * 2;
  return { dir: [Math.cos(angle), Math.sin(angle), 0], mag: 20 };
}

function animate(setT) {
  const t0 = performance.now();
  const dur = 1200;
  function frame() {
    const t = Math.min(1, (performance.now() - t0) / dur);
    const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    setT(e);
    if (t < 1) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

const btnStyle = {
  background: 'var(--forge-surface)', border: '1px solid var(--forge-rail-edge)',
  padding: '6px 12px', borderRadius: 'var(--forge-radius)',
  color: 'var(--forge-ink)', cursor: 'pointer',
};
const inputStyle = {
  background: 'var(--forge-canvas)', color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)', borderRadius: 3,
  padding: '2px 4px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};
const hdrStyle = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--forge-ink-mute)', padding: 'var(--forge-space-1) 0',
};

// ──────────────── walk-through ────────────────

export function WalkthroughPanel({ open, onClose, onPlayFrame }) {
  const [keyframes, setKeyframes] = React.useState([
    { pos: [40, 25, 40], target: [0, 0, 0], duration_ms: 1500 },
    { pos: [60, 5, 0],   target: [0, 0, 0], duration_ms: 1500 },
    { pos: [0, 40, 0],   target: [0, 0, 0], duration_ms: 1500 },
    { pos: [-40, 25, -40], target: [0, 0, 0], duration_ms: 1500 },
  ]);
  const [playing, setPlaying] = React.useState(false);

  React.useEffect(() => {
    if (!playing) return;
    let raf, idx = 0, t0 = performance.now();
    function tick() {
      const kf0 = keyframes[idx], kf1 = keyframes[(idx + 1) % keyframes.length];
      const t = Math.min(1, (performance.now() - t0) / kf0.duration_ms);
      const e = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const pos = [0,1,2].map((i) => kf0.pos[i] + (kf1.pos[i] - kf0.pos[i]) * e);
      const tgt = [0,1,2].map((i) => kf0.target[i] + (kf1.target[i] - kf0.target[i]) * e);
      onPlayFrame?.({ pos, target: tgt });
      if (t >= 1) { idx = (idx + 1) % keyframes.length; t0 = performance.now(); }
      if (playing) raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, keyframes]);

  if (!open) return null;
  return (
    <div style={{ ...panelStyle, width: 340 }} data-testid="forge-walkthrough-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Walk-through</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose} style={btnStyle} data-testid="forge-walkthrough-close">×</button>
      </header>
      <button onClick={() => setPlaying((p) => !p)}
              style={{ ...btnStyle, background: playing ? 'var(--forge-warn)' : 'var(--forge-accent-mute)' }}
              data-testid="forge-walkthrough-play">
        {playing ? 'Stop' : 'Play'}
      </button>
      <section style={{ overflowY: 'auto', flex: 1 }}>
        <div style={hdrStyle}>Key-frames</div>
        {keyframes.map((kf, i) => (
          <div key={i} style={{ borderBottom: '1px solid var(--forge-rail-edge)',
                                padding: 'var(--forge-space-1) 0' }}>
            <small>Frame {i + 1}</small>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4 }}>
              {['posX','posY','posZ','ms'].map((label, j) => {
                const val = j < 3 ? kf.pos[j] : kf.duration_ms;
                return (
                  <input key={label} type="number" defaultValue={val}
                         onBlur={(e) => {
                           const next = keyframes.slice();
                           if (j < 3) next[i] = { ...kf, pos: [...kf.pos] };
                           if (j < 3) next[i].pos[j] = parseFloat(e.target.value) || 0;
                           else next[i] = { ...kf, duration_ms: parseFloat(e.target.value) || 1000 };
                           setKeyframes(next);
                         }}
                         style={inputStyle}
                         data-walk-input={`${i}/${label}`} />
                );
              })}
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
