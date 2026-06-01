// Forge-128 — Weldments Workbench.
//
// Overlay panel that renders when the user opens the Weld tab on
// the workbench rail (`data-wb="weld"`). It auto-mounts via the
// shared `forge:open-weldments-panel` event + the imperative
// `window.__forgeOpenWeldments()` entry point — same pattern as
// ManufacturingWorkbenchHost / DrawingsWorkbench so we don't have
// to touch ForgeShellV4.jsx.
//
// Workflow:
//   1. Pick a profile from the dropdown (reads structuralProfileLibrary).
//   2. Click "Member" → places a structural member at a synthetic
//      span. Repeated clicks build a frame.
//   3. Click "Trim" → trims the last two members with the chosen mode.
//   4. Click "Gusset" → adds a gusset at the most recent joint.
//   5. Click "End cap" → caps the last member's open edge.
//   6. Click "Bead" → adds a fillet bead between the last two members.
//   7. Click "Cut list" → opens the CutListPanel.
//
// The panel is testable with clicks only — every interactive
// element carries a stable data-tool/data-testid attribute.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  STRUCTURAL_PROFILES, PROFILE_GROUPS, PROFILE_STANDARDS,
  DEFAULT_PROFILE, getProfile, profileFootprint,
} from './structuralProfileLibrary.js';
import {
  WeldmentsDispatch, TRIM_MODES, BEAD_KINDS,
} from './weldmentsDispatch.js';
import CutListPanel from './CutListPanel.jsx';

/* --------------------------------------------------------------- */
/*  helpers                                                        */
/* --------------------------------------------------------------- */

// Sequence of preset member layouts so each click drops a member
// the human-style test can visually distinguish. We cycle a small
// rectangular-frame layout, then a diagonal brace, then a Z-shape
// — the cut list then has a mix of lengths and angles.
const PLACEMENT_SEQUENCE = [
  // simple frame — bottom rail
  { p0: [-200, 0, 0],   p1: [ 200, 0, 0] },
  // left vertical
  { p0: [-200, 0, 0],   p1: [-200, 0, 300] },
  // right vertical
  { p0: [ 200, 0, 0],   p1: [ 200, 0, 300] },
  // top rail
  { p0: [-200, 0, 300], p1: [ 200, 0, 300] },
  // diagonal brace
  { p0: [-200, 0, 0],   p1: [ 200, 0, 300] },
  // back rail
  { p0: [-200, 200, 0], p1: [ 200, 200, 0] },
  // back left vertical
  { p0: [-200, 200, 0], p1: [-200, 200, 300] },
  // back right vertical
  { p0: [ 200, 200, 0], p1: [ 200, 200, 300] },
];

function pickPlacement(i) {
  return PLACEMENT_SEQUENCE[i % PLACEMENT_SEQUENCE.length];
}

/* --------------------------------------------------------------- */
/*  Profile picker (grouped dropdown)                              */
/* --------------------------------------------------------------- */

function ProfilePicker({ value, onChange, theme }) {
  // Group profiles by `group` then `standard` so the dropdown
  // reads like an engineer's catalogue.
  const grouped = useMemo(() => {
    const buckets = {};
    for (const p of STRUCTURAL_PROFILES) {
      const k = `${p.group}::${p.standard}`;
      if (!buckets[k]) buckets[k] = { group: p.group, standard: p.standard, rows: [] };
      buckets[k].rows.push(p);
    }
    return Object.values(buckets);
  }, []);

  return (
    <label className="forge-weld-picker"
           data-testid="forge-weld-profile-picker"
           style={{ display: 'flex', alignItems: 'center', gap: 8,
                    padding: '6px 10px', fontSize: 12 }}>
      <span style={{ opacity: 0.7 }}>Profile</span>
      <select value={value?.name || ''}
              data-testid="forge-weld-profile-select"
              onChange={(e) => onChange?.(getProfile(e.target.value))}
              style={{
                background: theme === 'dark' ? '#1c1812' : '#f0e6c0',
                color:      theme === 'dark' ? '#e9d9a8' : '#1a1612',
                border:     `1px solid ${theme === 'dark' ? '#5d4f30' : '#b89c5e'}`,
                borderRadius: 4,
                padding:    '4px 8px',
                fontSize:   12,
                minWidth:   200,
              }}>
        {grouped.map((g) => (
          <optgroup key={`${g.group}-${g.standard}`}
                    label={`${g.standard} · ${PROFILE_GROUPS[g.group]}`}>
            {g.rows.map((p) => (
              <option key={p.name} value={p.name}
                      data-profile-name={p.name}>
                {p.name} ({p.mass} kg/m)
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <span data-testid="forge-weld-profile-info"
            style={{ opacity: 0.5, fontSize: 11 }}>
        {value
          ? `${value.standard} · ${PROFILE_GROUPS[value.group]} · ${value.mass} kg/m · ${value.area} cm²`
          : 'no profile'}
      </span>
    </label>
  );
}

/* --------------------------------------------------------------- */
/*  Toolbar — clickable verbs                                      */
/* --------------------------------------------------------------- */

function WeldToolbar({
  onPlaceMember,
  onTrim, trimMode, setTrimMode,
  onGusset, gussetAngle, setGussetAngle,
  onEndCap, endCapChamfer, setEndCapChamfer,
  onBead,   beadKind, setBeadKind,
  onCutList, kernelReady, theme,
}) {
  const btn = (extra) => ({
    ...btnBase(theme), ...(extra || {}),
  });
  const sel = {
    ...selBase(theme),
  };
  return (
    <div className="forge-weld-toolbar"
         data-testid="forge-weld-toolbar"
         style={{ display: 'flex', flexWrap: 'wrap', gap: 6,
                  padding: '6px 10px', alignItems: 'center',
                  borderBottom: `1px solid ${theme === 'dark' ? '#3a3329' : '#bfa66c'}` }}>
      <button type="button" data-tool="weld.member"
              data-testid="forge-weld-tool-member"
              onClick={onPlaceMember} style={btn()}>
        + Member
      </button>
      <span style={{ opacity: 0.3 }}>|</span>
      <button type="button" data-tool="weld.trim"
              data-testid="forge-weld-tool-trim"
              onClick={onTrim} style={btn()}>
        Trim
      </button>
      <select value={trimMode}
              data-testid="forge-weld-trim-mode"
              onChange={(e) => setTrimMode(e.target.value)} style={sel}>
        {TRIM_MODES.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
      <span style={{ opacity: 0.3 }}>|</span>
      <button type="button" data-tool="weld.gusset"
              data-testid="forge-weld-tool-gusset"
              onClick={onGusset} style={btn()}>
        Gusset
      </button>
      <label data-testid="forge-weld-gusset-angle-label"
             style={{ display: 'inline-flex', gap: 4, fontSize: 11, alignItems: 'center' }}>
        <span style={{ opacity: 0.6 }}>angle°</span>
        <input type="number" min={30} max={150} step={5} value={gussetAngle}
               data-testid="forge-weld-gusset-angle"
               onChange={(e) => setGussetAngle(parseFloat(e.target.value) || 90)}
               style={{ ...sel, width: 60 }} />
      </label>
      <span style={{ opacity: 0.3 }}>|</span>
      <button type="button" data-tool="weld.endcap"
              data-testid="forge-weld-tool-endcap"
              onClick={onEndCap} style={btn()}>
        End cap
      </button>
      <label style={{ display: 'inline-flex', gap: 4, fontSize: 11, alignItems: 'center' }}>
        <span style={{ opacity: 0.6 }}>chamfer°</span>
        <input type="number" min={0} max={45} step={1} value={endCapChamfer}
               data-testid="forge-weld-endcap-chamfer"
               onChange={(e) => setEndCapChamfer(parseFloat(e.target.value) || 0)}
               style={{ ...sel, width: 60 }} />
      </label>
      <span style={{ opacity: 0.3 }}>|</span>
      <button type="button" data-tool="weld.bead"
              data-testid="forge-weld-tool-bead"
              onClick={onBead} style={btn()}>
        Bead
      </button>
      <select value={beadKind}
              data-testid="forge-weld-bead-kind"
              onChange={(e) => setBeadKind(e.target.value)} style={sel}>
        {BEAD_KINDS.map((k) => (
          <option key={k} value={k}>{k}</option>
        ))}
      </select>
      <span style={{ flex: 1 }} />
      <span data-testid="forge-weld-kernel-state"
            style={{ fontSize: 11, opacity: 0.6 }}>
        kernel: {kernelReady ? 'ready' : 'not ready'}
      </span>
      <button type="button" data-tool="weld.cutlist"
              data-testid="forge-weld-tool-cutlist"
              onClick={onCutList}
              style={btn({ background: theme === 'dark' ? '#54421a' : '#dec27a',
                           borderColor: theme === 'dark' ? '#a07d2e' : '#8b6b21' })}>
        Cut list
      </button>
    </div>
  );
}

function btnBase(theme) {
  const dark = theme === 'dark';
  return {
    background: dark ? '#2a241b' : '#e7dcb8',
    color:      dark ? '#e9d9a8' : '#1a1612',
    border:     `1px solid ${dark ? '#52462f' : '#b89c5e'}`,
    borderRadius: 4,
    padding:    '5px 12px',
    fontSize:   12,
    cursor:     'pointer',
    letterSpacing: 0.3,
  };
}
function selBase(theme) {
  const dark = theme === 'dark';
  return {
    background: dark ? '#1c1812' : '#f0e6c0',
    color:      dark ? '#e9d9a8' : '#1a1612',
    border:     `1px solid ${dark ? '#52462f' : '#b89c5e'}`,
    borderRadius: 4,
    padding:    '3px 6px',
    fontSize:   11,
  };
}

/* --------------------------------------------------------------- */
/*  Frame preview — SVG centred on each member's segment           */
/* --------------------------------------------------------------- */
//
// 2D projection to YZ plane (front-iso-ish). Members are drawn as
// rectangles whose width = profile footprint, length = edge length.
// Trim, gusset, bead, cap are rendered as overlay glyphs so the
// human can see the workbench updating as each tool runs.

function FramePreview({ members, gussets, caps, beads, theme }) {
  const dark = theme === 'dark';
  const allPts = members.flatMap((m) => [m.p0, m.p1]);
  let minX = -250, maxX = 250, minY = -50, maxY = 350;
  if (allPts.length) {
    minX =  Infinity; maxX = -Infinity;
    minY =  Infinity; maxY = -Infinity;
    for (const p of allPts) {
      // Project YZ-ish: x = world x, y = world z (axis flipped)
      const x = p[0], y = -p[2];
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    const pad = 40;
    minX -= pad; maxX += pad; minY -= pad; maxY += pad;
  }
  const w = maxX - minX, h = maxY - minY;
  const stroke = dark ? '#e9d9a8' : '#1a1612';
  const fill   = dark ? 'rgba(150,108,42,0.35)' : 'rgba(180,130,48,0.45)';
  const beadStroke = '#e6a44b';
  const gussetFill = 'rgba(230,164,75,0.35)';
  const capFill    = 'rgba(140,200,255,0.45)';

  return (
    <svg className="forge-weld-preview"
         data-testid="forge-weld-preview"
         viewBox={`${minX} ${minY} ${w} ${h}`}
         preserveAspectRatio="xMidYMid meet"
         style={{ width: '100%', height: 240, display: 'block',
                  background: dark ? '#0d0a06' : '#f0e6c0' }}>
      {members.map((m, i) => {
        const x0 = m.p0[0], y0 = -m.p0[2];
        const x1 = m.p1[0], y1 = -m.p1[2];
        const fp = profileFootprint(m.profile);
        const halfW = (fp.w || 50) / 2;
        return (
          <g key={`m-${m.handle}`} data-member-handle={m.handle}
             data-testid="forge-weld-member-svg">
            <line x1={x0} y1={y0} x2={x1} y2={y1}
                  stroke={stroke}
                  strokeWidth={Math.max(4, halfW)}
                  strokeLinecap="round"
                  opacity={0.85} />
            <line x1={x0} y1={y0} x2={x1} y2={y1}
                  stroke={fill}
                  strokeWidth={Math.max(2, halfW * 0.6)}
                  strokeLinecap="round" />
            <text x={(x0 + x1) / 2} y={(y0 + y1) / 2 - 10}
                  fontSize={11} fill={stroke}
                  textAnchor="middle">
              M{i + 1} · {m.profile.name}
            </text>
          </g>
        );
      })}
      {gussets.map((g, i) => (
        <circle key={`g-${g.handle}`} cx={g.cx} cy={g.cy}
                r={Math.max(8, g.size / 2)}
                data-gusset-handle={g.handle}
                data-testid="forge-weld-gusset-svg"
                fill={gussetFill} stroke={'#c98735'} />
      ))}
      {caps.map((c) => (
        <rect key={`c-${c.handle}`} x={c.cx - 8} y={c.cy - 8}
              width={16} height={16}
              data-cap-handle={c.handle}
              data-testid="forge-weld-cap-svg"
              fill={capFill} stroke={'#5a8fbb'} />
      ))}
      {beads.map((b) => (
        <line key={`b-${b.handle}`}
              x1={b.x0} y1={b.y0} x2={b.x1} y2={b.y1}
              data-bead-handle={b.handle}
              data-bead-kind={b.kind}
              data-testid="forge-weld-bead-svg"
              stroke={beadStroke} strokeWidth={3}
              strokeDasharray={b.kind === 'V-groove' ? '6 3' :
                              b.kind === 'bevel'    ? '4 2 1 2' :
                              b.kind === 'square-groove' ? '2 2' : 'none'} />
      ))}
    </svg>
  );
}

/* --------------------------------------------------------------- */
/*  Main workbench                                                 */
/* --------------------------------------------------------------- */

export function WeldmentsWorkbench({ open = true, theme = 'dark', onClose }) {
  const [profile, setProfile]       = useState(() => DEFAULT_PROFILE);
  const [members, setMembers]       = useState([]);
  const [gussets, setGussets]       = useState([]);
  const [caps, setCaps]             = useState([]);
  const [beads, setBeads]           = useState([]);
  const [trimMode, setTrimMode]     = useState('miter');
  const [gussetAngle, setGussetAngle] = useState(90);
  const [endCapChamfer, setEndCapChamfer] = useState(0);
  const [beadKind, setBeadKind]     = useState('fillet');
  const [cutListOpen, setCutListOpen] = useState(false);
  const [status, setStatus]         = useState('');

  const kernelReady = useMemo(() => WeldmentsDispatch.kernelReady(), [open, members]);

  // Publish snapshot to window so tests + Archie can read state.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeWeldments = { members, gussets, caps, beads, profile };
  }, [members, gussets, caps, beads, profile]);

  if (!open) return null;

  const placeMember = () => {
    const idx = members.length;
    const layout = pickPlacement(idx);
    const edge = WeldmentsDispatch.makePathEdge(layout.p0, layout.p1);
    const m = WeldmentsDispatch.makeStructuralMember(edge, profile);
    // Carry the geometry so cutList + preview can render.
    setMembers((arr) => [...arr, m]);
    setStatus(`Placed ${m.profile.name}, ${m.length.toFixed(0)} mm`);
  };

  const trim = () => {
    if (members.length < 2) {
      setStatus('Need at least 2 members to trim.');
      return;
    }
    const a = members[members.length - 1];
    const b = members[members.length - 2];
    const t = WeldmentsDispatch.trim(a, b, trimMode);
    setStatus(`Trimmed M${members.length} → M${members.length - 1} (${t.mode})`);
  };

  const gusset = () => {
    if (members.length === 0) {
      setStatus('Place a member before gusseting.');
      return;
    }
    const last = members[members.length - 1];
    const g = WeldmentsDispatch.gussetWithAngle(last, 0, 60, 8, gussetAngle);
    // Place the gusset glyph at the member's start vertex for preview.
    const cx = last.p0[0], cy = -last.p0[2];
    setGussets((arr) => [...arr, { ...g, cx, cy }]);
    setStatus(`Added gusset (${gussetAngle}° joint)`);
  };

  const endCap = () => {
    if (members.length === 0) {
      setStatus('Place a member before capping.');
      return;
    }
    const last = members[members.length - 1];
    const c = WeldmentsDispatch.endCapWithChamfer(last, 0, 6, endCapChamfer);
    const cx = last.p1[0], cy = -last.p1[2];
    setCaps((arr) => [...arr, { ...c, cx, cy }]);
    setStatus(`Capped M${members.length} (chamfer ${endCapChamfer}°)`);
  };

  const bead = () => {
    if (members.length === 0) {
      setStatus('Place a member before beading.');
      return;
    }
    const last = members[members.length - 1];
    // The bead runs along the member's centreline for preview.
    const x0 = last.p0[0], y0 = -last.p0[2];
    const x1 = last.p1[0], y1 = -last.p1[2];
    const verb =
      beadKind === 'V-groove' ? WeldmentsDispatch.weldBeadVGroove :
      beadKind === 'bevel'    ? WeldmentsDispatch.weldBeadBevel  :
      beadKind === 'square-groove' ? WeldmentsDispatch.weldBeadSquareGroove :
                                WeldmentsDispatch.weldBeadFillet;
    const b = verb(last, [0], 5);
    setBeads((arr) => [...arr, { ...b, x0, y0, x1, y1, kind: beadKind }]);
    setStatus(`Bead ${beadKind} ${b.size} mm × ${b.length.toFixed(0)} mm`);
  };

  return (
    <div className="forge-weldments-workbench"
         data-testid="forge-weldments"
         data-theme={theme}
         style={panelOuter(theme)}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 12,
                       padding: '8px 12px',
                       borderBottom: `1px solid ${theme === 'dark' ? '#3a3329' : '#bfa66c'}` }}>
        <span data-testid="forge-weldments-title"
              style={{ fontWeight: 600, letterSpacing: 0.6 }}>Weldments</span>
        <span style={{ flex: 1 }} />
        {onClose ? (
          <button type="button"
                  data-tool="weld.close"
                  data-testid="forge-weldments-close"
                  onClick={onClose} style={btnBase(theme)}>Close</button>
        ) : null}
      </header>

      <ProfilePicker value={profile} onChange={setProfile} theme={theme} />

      <WeldToolbar
        onPlaceMember={placeMember}
        onTrim={trim} trimMode={trimMode} setTrimMode={setTrimMode}
        onGusset={gusset} gussetAngle={gussetAngle} setGussetAngle={setGussetAngle}
        onEndCap={endCap} endCapChamfer={endCapChamfer} setEndCapChamfer={setEndCapChamfer}
        onBead={bead}     beadKind={beadKind}   setBeadKind={setBeadKind}
        onCutList={() => setCutListOpen(true)}
        kernelReady={kernelReady}
        theme={theme} />

      <FramePreview members={members}
                    gussets={gussets} caps={caps} beads={beads}
                    theme={theme} />

      <footer style={{ padding: '6px 12px',
                       borderTop: `1px solid ${theme === 'dark' ? '#3a3329' : '#bfa66c'}`,
                       fontSize: 11, opacity: 0.75,
                       display: 'flex', gap: 16, alignItems: 'center' }}>
        <span data-testid="forge-weld-count-members">
          Members: {members.length}
        </span>
        <span data-testid="forge-weld-count-gussets">
          Gussets: {gussets.length}
        </span>
        <span data-testid="forge-weld-count-caps">
          Caps: {caps.length}
        </span>
        <span data-testid="forge-weld-count-beads">
          Beads: {beads.length}
        </span>
        <span style={{ flex: 1 }} />
        <span data-testid="forge-weld-status">{status}</span>
      </footer>

      {cutListOpen ? (
        <CutListPanel members={members}
                      theme={theme}
                      onClose={() => setCutListOpen(false)} />
      ) : null}
    </div>
  );
}

function panelOuter(theme) {
  const dark = theme === 'dark';
  return {
    position: 'absolute',
    top:      72,
    left:     76,
    right:    16,
    bottom:   48,
    background:  dark ? 'rgba(16,14,11,0.97)' : 'rgba(252,247,232,0.97)',
    color:       dark ? '#e9d9a8' : '#1a1612',
    border:      `1px solid ${dark ? '#3a3329' : '#bfa66c'}`,
    borderRadius: 6,
    boxShadow:   '0 14px 38px rgba(0,0,0,0.5)',
    fontFamily:  'ui-sans-serif, system-ui',
    zIndex:      8500,
    display:     'flex',
    flexDirection: 'column',
    overflow:    'hidden',
  };
}

/* --------------------------------------------------------------- */
/*  Host — auto-opens on weld tab + window event                   */
/* --------------------------------------------------------------- */

const WELDMENTS_PANEL_EVENT = 'forge:open-weldments-panel';

export function WeldmentsWorkbenchHost() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState('dark');
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return;
    mountedRef.current = true;
    if (typeof window === 'undefined') return;
    window.__forgeOpenWeldments = (opts = {}) => {
      if (opts.theme) setTheme(opts.theme);
      setOpen(true);
    };
    window.__forgeCloseWeldments = () => setOpen(false);
    const onEvt = (e) => {
      const d = e?.detail || {};
      if (d.theme) setTheme(d.theme);
      setOpen(true);
    };
    window.addEventListener(WELDMENTS_PANEL_EVENT, onEvt);

    // Auto-open when the user clicks the weld workbench tab.
    const onClick = (e) => {
      const tab = e.target?.closest?.('[data-wb="weld"]');
      if (tab) {
        // Read the shell's theme snapshot if available.
        const t = window.__forgeTheme;
        if (t === 'dark' || t === 'light') setTheme(t);
        setOpen(true);
      }
    };
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener(WELDMENTS_PANEL_EVENT, onEvt);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  return (
    <WeldmentsWorkbench open={open}
                        theme={theme}
                        onClose={() => setOpen(false)} />
  );
}

export default WeldmentsWorkbench;
