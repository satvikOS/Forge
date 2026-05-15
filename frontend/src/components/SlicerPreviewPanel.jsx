import { useEffect, useRef, useState } from 'react';

/**
 * Slicer Preview — full-screen overlay that scrubs through the
 * FDM slice layers the Slice Preview ribbon tool produced.
 *
 * Polls window.__lastSliceLayers. A range slider picks the layer;
 * a Play button animates bottom-to-top. Each layer is drawn as an
 * SVG with outer loops stroked + inner loops as holes (evenodd),
 * on a shared bounding box so the part doesn't jump while scrubbing.
 */
export default function SlicerPreviewPanel() {
  const [data, setData] = useState(null);
  const [visible, setVisible] = useState(false);
  const [idx, setIdx] = useState(0);
  const [playing, setPlaying] = useState(false);
  const playRef = useRef(null);

  useEffect(() => {
    const tick = () => {
      const next = typeof window !== 'undefined' ? window.__lastSliceLayers : null;
      if (next && next !== data) {
        setData(next);
        setIdx(0);
        setVisible(true);
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [data]);

  useEffect(() => {
    if (!playing || !data) return;
    playRef.current = setInterval(() => {
      setIdx((i) => {
        if (i >= data.layers.length - 1) { setPlaying(false); return i; }
        return i + 1;
      });
    }, 60);
    return () => clearInterval(playRef.current);
  }, [playing, data]);

  if (!visible || !data) return null;

  const layer = data.layers[idx];
  const b = data.bounds;
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  const margin = Math.max(w, h) * 0.1 + 5;
  const vbW = w + 2 * margin, vbH = h + 2 * margin;
  const loopPath = (pts) => pts.map(([x, y], i) =>
    `${i === 0 ? 'M' : 'L'} ${(x - b.minX + margin).toFixed(2)} ${(b.maxY - y + margin).toFixed(2)}`
  ).join(' ') + ' Z';

  return (
    <div className="slp-backdrop" onClick={() => { setPlaying(false); setVisible(false); }}>
      <div className="slp-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="slp-header">
          <span className="slp-title">
            Slice Preview — layer {idx + 1} / {data.layers.length}
            {data.sampled < data.layerCount ? ` (of ${data.layerCount} @ ${data.layerHeight} mm)` : ''}
          </span>
          <span className="slp-z" data-slp-z>z = {layer.z.toFixed(2)} mm</span>
          <button className="slp-close" onClick={() => { setPlaying(false); setVisible(false); }}
                  data-action="slp-close">×</button>
        </div>
        <div className="slp-body">
          <svg className="slp-svg" viewBox={`0 0 ${vbW.toFixed(2)} ${vbH.toFixed(2)}`}
               data-slp-svg>
            <rect x="0" y="0" width={vbW.toFixed(2)} height={vbH.toFixed(2)} fill="#0d0d0d" />
            {layer.loops.map((lp, i) => (
              <path key={i}
                    d={loopPath(lp.points)}
                    fill={lp.isOuter ? 'rgba(93,165,255,0.18)' : '#0d0d0d'}
                    stroke={lp.isOuter ? '#5da5ff' : '#ff8a5d'}
                    strokeWidth={Math.max(w, h) * 0.004 + 0.15}
                    fillRule="evenodd" />
            ))}
          </svg>
        </div>
        <div className="slp-controls">
          <button className="slp-play" onClick={() => setPlaying((p) => !p)}
                  data-action="slp-play">{playing ? '❚❚' : '▶'}</button>
          <input className="slp-slider" type="range"
                 min={0} max={data.layers.length - 1} value={idx}
                 onChange={(e) => { setPlaying(false); setIdx(parseInt(e.target.value, 10)); }}
                 data-slp-slider />
          <span className="slp-count">{layer.loops.length} loop{layer.loops.length === 1 ? '' : 's'}</span>
        </div>
      </div>
    </div>
  );
}
