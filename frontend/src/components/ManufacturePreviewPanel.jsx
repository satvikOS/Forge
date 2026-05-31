import { useEffect, useMemo, useState } from 'react';

/**
 * Manufacture Preview — full-screen overlay that surfaces the
 * G-code program emitted by the CAM ribbon tools (2.5-Axis Milling
 * / 3-Axis Milling). Symmetric to DrawingPreviewPanel: polls
 * window.__lastCAMProgram, renders the program inline with stats,
 * and offers an explicit Download .nc button.
 *
 * Stats parsed from the G-code:
 *   - line count
 *   - G0 rapid / G1 feed / G2-G3 arc move counts
 *   - cutting distance (sum of G1 deltas)
 *   - estimated time @ each block's F-rate
 */
export default function ManufacturePreviewPanel() {
  const [program, setProgram] = useState(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const tick = () => {
      const next = typeof window !== 'undefined' ? window.__lastCAMProgram : null;
      if (next && next !== program) {
        setProgram(next);
        setVisible(true);
      }
    };
    tick();
    const id = setInterval(tick, 500);
    return () => clearInterval(id);
  }, [program]);

  const stats = useMemo(() => program ? parseStats(program.gcode) : null, [program]);

  if (!visible || !program) return null;

  const handleDownload = () => {
    const blob = new Blob([program.gcode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const stamp = new Date().toISOString().slice(0, 10);
    a.download = `archdisc-${program.source.replace(/\s+/g, '-').toLowerCase()}-${stamp}.nc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="mpp-backdrop" onClick={() => setVisible(false)}>
      <div className="mpp-dialog" onClick={(e) => e.stopPropagation()}>
        <div className="mpp-header">
          <span className="mpp-title">G-code Program — {program.source}</span>
          <button className="mpp-btn" onClick={handleDownload} data-action="mpp-download">Download .nc</button>
          <button className="mpp-close" onClick={() => setVisible(false)} data-action="mpp-close">×</button>
        </div>
        <div className="mpp-stats" data-mpp-stats>
          <Stat label="Lines" value={stats.totalLines} />
          <Stat label="G0 rapid" value={stats.g0} />
          <Stat label="G1 cut"   value={stats.g1} />
          <Stat label="G2/G3 arc" value={stats.g2 + stats.g3} />
          <Stat label="Cut length" value={`${stats.cutMm.toFixed(1)} mm`} />
          <Stat label="Est. time" value={formatTime(stats.timeMin)} />
        </div>
        <pre className="mpp-body" data-mpp-body>{program.gcode}</pre>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="mpp-stat">
      <span className="mpp-stat-value">{value}</span>
      <span className="mpp-stat-label">{label}</span>
    </div>
  );
}

/** Parse the G-code body for basic move-count + length + time stats. */
function parseStats(gcode) {
  const lines = gcode.split('\n');
  let g0 = 0, g1 = 0, g2 = 0, g3 = 0;
  let cutMm = 0, timeMin = 0;
  let x = 0, y = 0, z = 0;
  let feed = 1000; // mm/min, default
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith(';') || line.startsWith('(')) continue;
    const code = /^G(\d+)/i.exec(line);
    if (!code) continue;
    const g = parseInt(code[1], 10);
    const xm = /X(-?\d+\.?\d*)/i.exec(line);
    const ym = /Y(-?\d+\.?\d*)/i.exec(line);
    const zm = /Z(-?\d+\.?\d*)/i.exec(line);
    const fm = /F(\d+\.?\d*)/i.exec(line);
    if (fm) feed = parseFloat(fm[1]);
    const nx = xm ? parseFloat(xm[1]) : x;
    const ny = ym ? parseFloat(ym[1]) : y;
    const nz = zm ? parseFloat(zm[1]) : z;
    const dist = Math.hypot(nx - x, ny - y, nz - z);
    if (g === 0) {
      g0++;
      timeMin += dist / 5000; // rapid at 5 m/min nominal
    } else if (g === 1) {
      g1++;
      cutMm += dist;
      timeMin += dist / Math.max(feed, 1);
    } else if (g === 2) { g2++; cutMm += dist; timeMin += dist / Math.max(feed, 1); }
    else if (g === 3) { g3++; cutMm += dist; timeMin += dist / Math.max(feed, 1); }
    x = nx; y = ny; z = nz;
  }
  return {
    totalLines: lines.length,
    g0, g1, g2, g3,
    cutMm, timeMin,
  };
}

function formatTime(min) {
  if (min < 1) return `${(min * 60).toFixed(1)} s`;
  if (min < 60) return `${min.toFixed(2)} min`;
  return `${Math.floor(min / 60)} h ${(min % 60).toFixed(0)} min`;
}
