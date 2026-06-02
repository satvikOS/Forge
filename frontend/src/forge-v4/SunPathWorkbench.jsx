// Forge-181 — Sun-path + daylight analysis workbench.
//
// Drives forge.sun.{compute, sweepHourly, annualNoon}. UI lets the user
// pick a city preset (15 worldwide locations with lat/lon/tz), set a
// day-of-year scrubber, and visualise:
//   * Current sun altitude/azimuth + sunrise/sunset times,
//   * Hourly altitude polyline across the chosen day,
//   * Stereographic sun-path overlay of monthly noons + the current trace.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

const CITY_PRESETS = [
  { name: 'London',     lat:  51.5074, lon:  -0.1278, tz:  0 },
  { name: 'Paris',      lat:  48.8566, lon:   2.3522, tz:  1 },
  { name: 'Berlin',     lat:  52.5200, lon:  13.4050, tz:  1 },
  { name: 'Moscow',     lat:  55.7558, lon:  37.6173, tz:  3 },
  { name: 'New York',   lat:  40.7128, lon: -74.0060, tz: -5 },
  { name: 'Los Angeles',lat:  34.0522, lon:-118.2437, tz: -8 },
  { name: 'Tokyo',      lat:  35.6762, lon: 139.6503, tz:  9 },
  { name: 'Mumbai',     lat:  19.0760, lon:  72.8777, tz:  5.5 },
  { name: 'Sydney',     lat: -33.8688, lon: 151.2093, tz: 10 },
  { name: 'Cape Town',  lat: -33.9249, lon:  18.4241, tz:  2 },
  { name: 'Singapore',  lat:   1.3521, lon: 103.8198, tz:  8 },
  { name: 'Reykjavík',  lat:  64.1466, lon: -21.9426, tz:  0 },
  { name: 'Tromsø',     lat:  69.6492, lon:  18.9553, tz:  1 },
  { name: 'Ushuaia',    lat: -54.8019, lon: -68.3030, tz: -3 },
  { name: 'Equator',    lat:   0.0,    lon:   0.0,    tz:  0 },
];

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 520, zIndex: 1310,
  background: 'var(--forge-canvas-2)',
  borderLeft: '1px solid var(--forge-rail-edge)',
  padding: 'var(--forge-space-3)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2)',
  color: 'var(--forge-ink)', fontSize: 12,
  overflowY: 'auto',
};

const fieldInputStyle = {
  width: '100%', background: 'var(--forge-canvas)',
  color: 'var(--forge-ink)',
  border: '1px solid var(--forge-rail-edge)',
  padding: '4px 6px', fontFamily: 'var(--forge-mono)', fontSize: 11,
};

function AltitudeChart({ sweep, width = 480, height = 130 }) {
  if (!sweep || !sweep.length) return null;
  const padL = 36, padR = 8, padT = 14, padB = 22;
  const w = width - padL - padR, h = height - padT - padB;
  const X = (hr) => padL + (hr / 24) * w;
  const Y = (alt) => padT + h * (1 - (alt + 90) / 180);
  const d = sweep.map((s, i) =>
    `${i === 0 ? 'M' : 'L'} ${X(s.localHour).toFixed(1)} ${Y(s.pos.altitudeDeg).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-sun-alt-chart">
      <line x1={padL} y1={Y(0)} x2={padL + w} y2={Y(0)}
            stroke="var(--forge-rail-edge)" />
      {[6, 12, 18].map((h0) => (
        <line key={h0} x1={X(h0)} y1={padT} x2={X(h0)} y2={padT + h}
              stroke="var(--forge-rail-edge)" strokeDasharray="2 4" />
      ))}
      <path d={d} fill="none" stroke="var(--forge-accent)" strokeWidth={1.5} />
      <text x={4} y={12} fontSize={10}
            fill="var(--forge-ink-mute)" fontFamily="var(--forge-mono)">
        altitude over local day
      </text>
      <text x={X(6)} y={padT + h + 12} fontSize={9}
            fill="var(--forge-ink-mute)" fontFamily="var(--forge-mono)"
            textAnchor="middle">06</text>
      <text x={X(12)} y={padT + h + 12} fontSize={9}
            fill="var(--forge-ink-mute)" fontFamily="var(--forge-mono)"
            textAnchor="middle">12</text>
      <text x={X(18)} y={padT + h + 12} fontSize={9}
            fill="var(--forge-ink-mute)" fontFamily="var(--forge-mono)"
            textAnchor="middle">18</text>
    </svg>
  );
}

function PolarSunPath({ annualNoon, width = 280, height = 280 }) {
  if (!annualNoon) return null;
  const cx = width / 2, cy = height / 2;
  const r = Math.min(width, height) / 2 - 18;
  // Stereographic: r_proj = R · tan((90 - alt)/2) but for noon altitudes
  // we just use r * (1 - alt/90). North up = azimuth 0.
  const project = (alt, az) => {
    const rho = r * Math.max(0, 1 - alt / 90);
    const theta = (az - 90) * Math.PI / 180; // azimuth 0 (N) → up
    return [cx + rho * Math.cos(theta), cy + rho * Math.sin(theta)];
  };
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-sun-polar">
      <circle cx={cx} cy={cy} r={r}
              fill="rgba(86,168,212,0.06)" stroke="var(--forge-rail-edge)" />
      {[30, 60].map((alt) =>
        <circle key={alt} cx={cx} cy={cy} r={r * (1 - alt / 90)}
                fill="none" stroke="var(--forge-rail-edge)" strokeDasharray="2 3" />)}
      {[0, 90, 180, 270].map((az) => {
        const x = cx + r * Math.cos((az - 90) * Math.PI / 180);
        const y = cy + r * Math.sin((az - 90) * Math.PI / 180);
        return (
          <g key={az}>
            <line x1={cx} y1={cy} x2={x} y2={y}
                  stroke="var(--forge-rail-edge)" strokeDasharray="2 3" />
            <text x={x} y={y - 4} fontSize={11}
                  fill="var(--forge-ink-mute)" textAnchor="middle"
                  fontFamily="var(--forge-mono)">
              {az === 0 ? 'N' : az === 90 ? 'E' : az === 180 ? 'S' : 'W'}
            </text>
          </g>
        );
      })}
      {annualNoon.filter((s) => s.altitudeDeg > 0).map((s) => {
        const [x, y] = project(s.altitudeDeg, s.azimuthDeg);
        return (
          <g key={s.monthOneBased}>
            <circle cx={x} cy={y} r={3} fill="var(--forge-accent)" />
            <text x={x + 6} y={y + 3} fontSize={9}
                  fill="var(--forge-ink)" fontFamily="var(--forge-mono)">
              {s.monthOneBased}
            </text>
          </g>
        );
      })}
      <text x={cx} y={height - 6} fontSize={10}
            fill="var(--forge-ink-mute)" fontFamily="var(--forge-mono)"
            textAnchor="middle">
        monthly noon · stereographic
      </text>
    </svg>
  );
}

export function SunPathWorkbenchPanel({ open, onClose }) {
  const [cityIdx, setCityIdx] = React.useState(0);
  const [year, setYear] = React.useState(2025);
  const [dayOfYear, setDayOfYear] = React.useState(172);  // June 21
  const [localHour, setLocalHour] = React.useState(12.0);
  const [now, setNow] = React.useState(null);
  const [sweep, setSweep] = React.useState(null);
  const [annual, setAnnual] = React.useState(null);
  const [status, setStatus] = React.useState({ kind: 'idle', text: 'idle' });

  const city = CITY_PRESETS[cityIdx];

  const recompute = React.useCallback(() => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.sun) { setStatus({ kind: 'err', text: 'forge.sun unavailable' }); return; }
    try {
      const args = { year, dayOfYear,
                     latitudeDeg: city.lat, longitudeDeg: city.lon,
                     tzOffsetHours: city.tz };
      const nowPos = f.sun.compute({ ...args, localHour });
      const sw     = f.sun.sweepHourly(args);
      const an     = f.sun.annualNoon({
        year, latitudeDeg: city.lat, longitudeDeg: city.lon, tzOffsetHours: city.tz,
      });
      setNow(nowPos); setSweep(sw); setAnnual(an);
      setStatus({ kind: 'ok',
        text: `${city.name}  alt ${nowPos.altitudeDeg.toFixed(1)}°  az ${nowPos.azimuthDeg.toFixed(1)}°  daylight ${nowPos.daylightHours.toFixed(2)} h` });
    } catch (e) {
      setStatus({ kind: 'err', text: e.message });
    }
  }, [cityIdx, year, dayOfYear, localHour, city]);

  React.useEffect(() => { if (open) recompute(); }, [open, recompute]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-sun-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Sun-path · NOAA SPA (Spencer/Iqbal)</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-sun-close">×</button>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: '3fr 1fr 1fr', gap: 4 }}>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>City</small>
          <select value={cityIdx}
                  onChange={(e) => setCityIdx(parseInt(e.target.value) || 0)}
                  style={fieldInputStyle} data-testid="forge-sun-city">
            {CITY_PRESETS.map((c, i) =>
              <option key={i} value={i}>
                {c.name}  ({c.lat.toFixed(1)}°,{c.lon.toFixed(1)}°,UTC{c.tz >= 0 ? '+' : ''}{c.tz})
              </option>)}
          </select>
        </label>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>Year</small>
          <input type="number" value={year}
                 onChange={(e) => setYear(parseInt(e.target.value) || 2025)}
                 style={fieldInputStyle} data-testid="forge-sun-year" />
        </label>
        <label>
          <small style={{ color: 'var(--forge-ink-mute)' }}>DoY</small>
          <input type="number" value={dayOfYear} min={1} max={366}
                 onChange={(e) => setDayOfYear(parseInt(e.target.value) || 1)}
                 style={fieldInputStyle} data-testid="forge-sun-doy" />
        </label>
      </section>

      <label>
        <small style={{ color: 'var(--forge-ink-mute)' }}>Local hour</small>
        <input type="range" value={localHour} step={0.25} min={0} max={23.75}
               onChange={(e) => setLocalHour(parseFloat(e.target.value) || 0)}
               style={fieldInputStyle} data-testid="forge-sun-hour" />
      </label>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        color: status.kind === 'err' ? 'var(--forge-bad, #ff6363)'
                             : status.kind === 'ok'  ? 'var(--forge-ok, #4ec18b)'
                             : 'var(--forge-ink-mute)' }}
               data-testid="forge-sun-status">
        {status.text}
      </section>

      {sweep && <AltitudeChart sweep={sweep} />}
      {annual && <PolarSunPath annualNoon={annual} />}

      {now && (
        <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                          background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)' }}
                 data-testid="forge-sun-result">
          <div>Altitude       {now.altitudeDeg.toFixed(2)}°</div>
          <div>Azimuth        {now.azimuthDeg.toFixed(2)}° (cw from N)</div>
          <div>Zenith         {now.zenithDeg.toFixed(2)}°</div>
          <div>Declination    {now.declinationDeg.toFixed(2)}°</div>
          <div>Eq. of time    {now.eqOfTimeMin.toFixed(2)} min</div>
          <div>Sunrise        {now.sunriseLocalHour.toFixed(2)} h local</div>
          <div>Sunset         {now.sunsetLocalHour.toFixed(2)} h local</div>
          <div>Daylight       {now.daylightHours.toFixed(2)} h</div>
        </section>
      )}
    </div>
  );
}

export function SunPathWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenSunPathWorkbench  = () => setOpen(true);
    window.__forgeCloseSunPathWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.sunpath' || e?.detail?.id === 'workbench.sunpath') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => { if (window.__forgeActiveWb === 'sunpath') setOpen(true); };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <SunPathWorkbenchPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default SunPathWorkbenchPanel;
