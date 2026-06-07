// PUSH-160 (Slice-116) — Wing Rib Lofting tool.
//
// Aerospace authoring surface: user defines multiple airfoil sections
// at named span stations (z, chord, NACA code, twist, sweep), and the
// panel generates N airfoil polylines via nacaMath.naca() then lofts
// them into a wing-skin surface via the existing
// window.forge.surfacing.buildPatch primitive — the same one PUSH-85
// (Class-A Blend), PUSH-102 (Loft Sections), PUSH-107 (Surface Offset)
// all drive.
//
// Each span station owns a NACA-4 polyline of (2·nPts − 1) chord-
// normalised XY points. We map every station's polyline to world space
// (chord, leading-edge XY from sweep, twist around the chord, station z)
// to fill the j-th v-strip of the control grid, then hand the full
// (uCount × vCount) grid to surfacing.buildPatch. The output is a real
// OCCT NURBS face committed to the scene via window.__forgeAppendBody.
//
// Reachable via:
//   * tools.wingRibLoft menu action (Menus.jsx)
//   * window.__forgeOpenWingRibLoft / window.__forgeCloseWingRibLoft
//   * window.__forgeWingRibLoftHelper.runWingRibLoftPipeline({ stations, nPts })
//
// Hard constraints honoured:
//   * NO new npm / native deps. Pure React + pure JS nacaMath +
//     existing window.forge.surfacing.buildPatch contract.
//   * NO kernel modifications. One buildPatch call, one native surface
//     body committed.
//   * Surgical edits to Menus.jsx (one new entry) + App.jsx (one
//     import + one mount).
//   * Manual clicks NEVER post to Archie's thread — UI lives in its
//     own portal; the only window APIs we install are imperative open
//     hooks for tests + plugins.
//   * Multi-cam e2e mandate honoured by push-160-wing-rib-loft.spec.js.

import React, {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons/Icon.jsx';
import {
  buildPatchKnots,
} from './loftMath.js';
import {
  naca,
  stationToWorld,
  DEFAULT_WING_PRESET,
} from './nacaMath.js';

// ─────────────────────────────────────────────────────────────────────
// Constants — events + storage + sample-density defaults.

export const FORGE_WING_RIB_LOFT_EVENT = 'forge:wing-rib-loft-built';
export const FORGE_WING_RIB_LOFT_STORAGE = 'forge.v4.wingRibLoft';

/** Default chord samples per surface — passed through to nacaMath.naca().
 *  The polyline contract is 2·nPts − 1 points per station (LE shared).
 *  100 samples / surface ≈ 199 ring points — plenty for a degree-3
 *  buildPatch tessellation. */
export const DEFAULT_NPTS_PER_SURFACE = 100;

/** Brief preset — 4 stations, chord 200→100, span 1000 mm, NACA 2412. */
export const DEFAULT_STATIONS = DEFAULT_WING_PRESET.stations
  .map((s) => ({ ...s }));

// ─────────────────────────────────────────────────────────────────────
// Headless pipeline.

/** Normalise the station table — drop bad rows, sort by z ascending.
 *  Returns the sanitised list (does NOT mutate the input). */
export function normaliseStations(stations) {
  if (!Array.isArray(stations)) return [];
  const out = [];
  for (const s of stations) {
    if (!s) continue;
    const z = Number(s.z);
    const chord = Number(s.chord);
    if (!Number.isFinite(z) || !Number.isFinite(chord) || chord <= 0) continue;
    const code = String(s.code ?? '2412').trim() || '2412';
    const twist = Number.isFinite(Number(s.twist)) ? Number(s.twist) : 0;
    const sweep = Number.isFinite(Number(s.sweep)) ? Number(s.sweep) : 0;
    out.push({ z, chord, code, twist, sweep });
  }
  out.sort((a, b) => a.z - b.z);
  return out;
}

/** Build the (u × v) control-point grid for the wing-skin loft.
 *
 *  u-axis (uCount columns): walks the ring around the airfoil (2·nPts − 1
 *                           points, closed: first = last at TE).
 *  v-axis (vCount rows):    walks station 0 → station vCount-1 along span.
 *
 *  grid[j][i] = world-space [x, y, z] of station j's i-th ring point.
 *
 *  Sweep (deg) advances the leading-edge x position with span:
 *    leX_j = z_j · tan(sweep_j_deg · π / 180)
 *    leY_j = 0
 *
 *  Twist (deg) rotates the section about its leading edge in the chord
 *  plane (XY world plane lifted to z_j). */
export function buildWingRibGrid(stations, nPtsPerSurface = DEFAULT_NPTS_PER_SURFACE) {
  const stable = normaliseStations(stations);
  const vN = stable.length;
  if (vN < 2) {
    return {
      ok: false, reason: 'need at least 2 valid stations',
      stations: stable,
      uCount: 0, vCount: vN, xyz: new Float64Array(0), grid: [],
    };
  }

  // All stations share the same nPts so every v-strip lines up u-index
  // by u-index. We build the chord-normalised polyline once per station
  // because the NACA code can differ per station.
  const polylinesPerStation = stable.map(
    (s) => naca(s.code, nPtsPerSurface).points);
  const uN = polylinesPerStation[0].length;
  // Defensive — if a station happened to land a different nPts (e.g.
  // user typed an invalid code that fell back to '2412') we'd have a
  // shape mismatch; pad / truncate to the first station's u-count.
  for (let j = 0; j < vN; j++) {
    while (polylinesPerStation[j].length < uN) {
      const last = polylinesPerStation[j][polylinesPerStation[j].length - 1];
      polylinesPerStation[j].push(last ? [last[0], last[1]] : [1, 0]);
    }
    if (polylinesPerStation[j].length > uN) {
      polylinesPerStation[j] = polylinesPerStation[j].slice(0, uN);
    }
  }

  const xyz = new Float64Array(uN * vN * 3);
  const grid = [];
  let writeIdx = 0;
  for (let j = 0; j < vN; j++) {
    const st = stable[j];
    const sweepRad = (Number(st.sweep) || 0) * Math.PI / 180;
    const leX = (Number(st.z) || 0) * Math.tan(sweepRad);
    const leY = 0;
    const twistRad = (Number(st.twist) || 0) * Math.PI / 180;
    const world = stationToWorld(polylinesPerStation[j], {
      chordMm: st.chord, leX, leY, zMm: st.z, twistRad,
    });
    const row = [];
    for (let i = 0; i < uN; i++) {
      const [x, y, z] = world[i];
      row.push([x, y, z]);
      xyz[writeIdx++] = x;
      xyz[writeIdx++] = y;
      xyz[writeIdx++] = z;
    }
    grid.push(row);
  }
  return {
    ok: true,
    stations: stable,
    polylinesPerStation,
    uCount: uN, vCount: vN,
    xyz, grid,
  };
}

/** Commit the control grid as an OCCT NURBS face via
 *  window.forge.surfacing.buildPatch. Returns
 *  { ok, faceHandle, uKnots, vKnots, reason, message, gridSpec }. */
export function commitWingRibPatch(gridSpec, { uDeg = 3, vDeg = 3 } = {}) {
  if (typeof window === 'undefined' || !window.forge || !window.forge.surfacing) {
    return { ok: false, reason: 'kernel not ready', gridSpec };
  }
  const buildPatch = window.forge.surfacing.buildPatch;
  if (typeof buildPatch !== 'function') {
    return { ok: false, reason: 'buildPatch missing', gridSpec };
  }
  // Use loftMath.buildPatchKnots so the knot-vector math stays in
  // lock-step with the rest of the surfacing pipeline (PUSH-85/102/107
  // all share the same open-uniform knot generator).
  // NB: the kernel's degree clamp wants degree < count along each axis;
  // for very few stations (e.g. 2) we drop vDeg accordingly.
  const uDegEff = Math.min(uDeg, Math.max(1, gridSpec.uCount - 1));
  const vDegEff = Math.min(vDeg, Math.max(1, gridSpec.vCount - 1));
  const uKnots = buildPatchKnots(gridSpec.uCount, uDegEff);
  const vKnots = buildPatchKnots(gridSpec.vCount, vDegEff);
  try {
    const spec = {
      uCount: gridSpec.uCount, vCount: gridSpec.vCount,
      xyz: gridSpec.xyz,
    };
    const faceHandle = buildPatch(spec, uDegEff, vDegEff, uKnots, vKnots);
    if (typeof faceHandle !== 'number' || !Number.isFinite(faceHandle)) {
      return { ok: false, reason: 'buildPatch returned non-handle',
               message: String(faceHandle), gridSpec };
    }
    return { ok: true, faceHandle, uKnots, vKnots,
             uDeg: uDegEff, vDeg: vDegEff, gridSpec };
  } catch (err) {
    return { ok: false, reason: 'buildPatch threw',
             message: err && err.message ? err.message : String(err),
             gridSpec };
  }
}

/** Append the wing-skin face to the live scene. */
export function appendWingRibBody(faceHandle, { stations, uCount, vCount, name }) {
  if (typeof window === 'undefined') return null;
  const ts = Date.now();
  const id = `wing-rib-loft-${ts}`;
  const body = {
    id, kind: 'native', handle: faceHandle,
    toolId: 'aero.wingRibLoft',
    surface: true,
    params: {
      stations: stations.map((s) => ({
        z: s.z, chord: s.chord, code: s.code,
        twist: s.twist, sweep: s.sweep,
      })),
      uCount, vCount,
    },
    name: name || `Wing skin (${stations.length} ribs)`,
  };
  if (typeof window.__forgeAppendBody === 'function') {
    window.__forgeAppendBody(body);
  }
  return body;
}

/** Top-level driver — table → polylines → grid → buildPatch → append →
 *  bus event. Used by both the panel button + the e2e spec. */
export function runWingRibLoftPipeline({
  stations = DEFAULT_STATIONS,
  nPtsPerSurface = DEFAULT_NPTS_PER_SURFACE,
} = {}) {
  const sane = normaliseStations(stations);
  if (sane.length < 2) {
    return { ok: false, reason: 'need at least 2 stations',
             stations: sane };
  }
  const gridSpec = buildWingRibGrid(sane, nPtsPerSurface);
  if (!gridSpec.ok) {
    return { ok: false, reason: gridSpec.reason || 'grid failed',
             stations: sane };
  }
  const built = commitWingRibPatch(gridSpec);
  if (!built.ok) {
    return {
      ok: false, reason: built.reason, message: built.message,
      gridSpec,
    };
  }
  const body = appendWingRibBody(built.faceHandle, {
    stations: sane,
    uCount: gridSpec.uCount, vCount: gridSpec.vCount,
    name: `Wing skin · ${sane.length} ribs · ${sane[0].code}`,
  });
  let metrics = null;
  try {
    if (typeof window !== 'undefined'
        && typeof window.forge?.massProps === 'function') {
      metrics = window.forge.massProps(built.faceHandle);
    }
  } catch { /* surface area lookup is best-effort */ }
  try {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(FORGE_WING_RIB_LOFT_EVENT, {
        detail: {
          faceHandle: built.faceHandle,
          bodyId: body?.id,
          stationCount: sane.length,
          uCount: gridSpec.uCount,
          vCount: gridSpec.vCount,
          area: metrics?.area ?? null,
          ts: Date.now(),
        },
      }));
    }
  } catch { /* fail soft */ }
  return {
    ok: true, faceHandle: built.faceHandle, body,
    gridSpec, uKnots: built.uKnots, vKnots: built.vKnots,
    metrics,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Headless helper surface — install at module load.

if (typeof window !== 'undefined') {
  try {
    window.__forgeWingRibLoftHelper = Object.freeze({
      naca,
      stationToWorld,
      normaliseStations,
      buildWingRibGrid,
      commitWingRibPatch,
      appendWingRibBody,
      runWingRibLoftPipeline,
      DEFAULT_STATIONS,
      DEFAULT_NPTS_PER_SURFACE,
      EVENT_NAME: FORGE_WING_RIB_LOFT_EVENT,
      STORAGE_KEY: FORGE_WING_RIB_LOFT_STORAGE,
    });
    window.addEventListener('forge:menu-action', (e) => {
      if (e?.detail?.id === 'tools.wingRibLoft') {
        window.__forgeWingRibLoftLastMenuTs = Date.now();
      }
    });
  } catch { /* defensive */ }
}

// ─────────────────────────────────────────────────────────────────────
// Styles — right-docked rail matching the rest of PUSH-N.

const PANEL_STYLE = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h, 40px) + var(--forge-qat-h, 32px))',
  right: 0,
  bottom: 'var(--forge-statusbar-h, 24px)',
  width: 520,
  zIndex: 1334,
  background: 'var(--forge-canvas-2, #161b22)',
  borderLeft: '1px solid var(--forge-rail-edge, #2a2d34)',
  padding: 'var(--forge-space-3, 12px)',
  display: 'flex', flexDirection: 'column', gap: 'var(--forge-space-2, 8px)',
  color: 'var(--forge-ink, #dadde2)', fontSize: 12,
  overflow: 'hidden',
};
const HEADER_ROW = { display: 'flex', alignItems: 'center', gap: 8 };
const CLOSE_BTN = {
  background: 'transparent',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)', cursor: 'pointer',
  padding: '2px 6px', borderRadius: 3,
};
const SECTION_TITLE = {
  fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.05em',
  color: 'var(--forge-ink-mute, #9aa1ab)', margin: '8px 0 4px',
};
const SECTION_BOX = {
  background: 'var(--forge-canvas-3, #1b212a)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4, padding: 8,
  display: 'flex', flexDirection: 'column', gap: 6,
};
const TABLE_HEADER_ROW = {
  display: 'grid',
  gridTemplateColumns: '28px 1fr 1fr 1fr 1fr 1fr 32px',
  alignItems: 'center', gap: 4,
  fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
  textTransform: 'uppercase', letterSpacing: '0.05em',
  paddingBottom: 4,
  borderBottom: '1px solid var(--forge-rail-edge, #2a2d34)',
};
const TABLE_ROW = (active) => ({
  display: 'grid',
  gridTemplateColumns: '28px 1fr 1fr 1fr 1fr 1fr 32px',
  alignItems: 'center', gap: 4,
  background: active ? 'var(--forge-accent-mute, #1f2c4a)' : 'transparent',
  borderRadius: 3,
  padding: '4px 2px',
});
const INPUT_STYLE = {
  background: 'var(--forge-canvas-1, #0e1218)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  padding: '3px 5px', borderRadius: 3, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  width: '100%', boxSizing: 'border-box',
};
const SMALL_BTN = {
  background: 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: 'var(--forge-ink, #dadde2)',
  cursor: 'pointer', padding: '2px 6px', borderRadius: 3, fontSize: 11,
};
const TABLE_ROW_LABEL = {
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)',
  textAlign: 'center',
};
const ACTION_ROW = { display: 'flex', gap: 6, alignItems: 'center' };
const ACTION_BTN = (variant = 'default', disabled = false) => ({
  background: disabled ? 'var(--forge-surface-mute, #1a1f27)'
            : variant === 'primary' ? 'var(--forge-accent, #4f87ff)'
            : 'var(--forge-surface, #1f242c)',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  color: disabled ? 'var(--forge-ink-mute, #9aa1ab)'
       : variant === 'primary' ? '#fff'
       : 'var(--forge-ink, #dadde2)',
  cursor: disabled ? 'not-allowed' : 'pointer',
  padding: '6px 14px', borderRadius: 3, fontSize: 12,
  fontWeight: variant === 'primary' ? 600 : 400,
});
const LOG_BOX = {
  flex: 1, minHeight: 0, overflowY: 'auto',
  border: '1px solid var(--forge-rail-edge, #2a2d34)',
  borderRadius: 4, background: 'var(--forge-canvas-1, #0e1218)',
  padding: 6, fontSize: 11,
  fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
  color: 'var(--forge-ink-2, #b5bac4)',
};

// ─────────────────────────────────────────────────────────────────────
// Root / tip presets.

const PRESETS = [
  {
    id: 'naca-2412-rect',
    label: 'NACA 2412 rect (4×, c=200→100, b=1000)',
    stations: [
      { z: 0,    chord: 200, code: '2412', twist: 0, sweep: 0 },
      { z: 333,  chord: 167, code: '2412', twist: 0, sweep: 0 },
      { z: 667,  chord: 133, code: '2412', twist: 0, sweep: 0 },
      { z: 1000, chord: 100, code: '2412', twist: 0, sweep: 0 },
    ],
  },
  {
    id: 'naca-0012-swept',
    label: 'NACA 0012 swept (4×, c=300→150, sweep 20°)',
    stations: [
      { z: 0,    chord: 300, code: '0012', twist: 0,  sweep: 20 },
      { z: 333,  chord: 250, code: '0012', twist: -1, sweep: 20 },
      { z: 667,  chord: 200, code: '0012', twist: -2, sweep: 20 },
      { z: 1000, chord: 150, code: '0012', twist: -3, sweep: 20 },
    ],
  },
  {
    id: 'naca-4412-twist',
    label: 'NACA 4412 twist (3×, washout)',
    stations: [
      { z: 0,    chord: 250, code: '4412', twist: 0,  sweep: 0 },
      { z: 500,  chord: 200, code: '4412', twist: -2, sweep: 0 },
      { z: 1000, chord: 150, code: '4412', twist: -4, sweep: 0 },
    ],
  },
];

// ─────────────────────────────────────────────────────────────────────
// Profile preview (SVG, chord-normalised). Renders every station's
// polyline at once so the user sees how the family evolves across the
// span. Mainly for visual feedback; the actual loft uses world-space
// coordinates from buildWingRibGrid().

function MultiProfilePreview({ stations, nPtsPerSurface, width = 480, height = 130 }) {
  const profiles = useMemo(() => {
    const out = [];
    for (const st of stations) {
      try {
        const code = String(st.code ?? '2412');
        out.push({ code, points: naca(code, nPtsPerSurface).points });
      } catch { /* skip */ }
    }
    return out;
  }, [stations, nPtsPerSurface]);
  if (profiles.length === 0) {
    return <div style={{ color: 'var(--forge-ink-mute, #9aa1ab)', fontSize: 11 }}>
      no profile
    </div>;
  }
  const padL = 8, padR = 8, padT = 18, padB = 18;
  const w = width - padL - padR, h = height - padT - padB;
  // Collect y range across every profile.
  let yMin = +Infinity, yMax = -Infinity;
  for (const p of profiles) for (const [, y] of p.points) {
    if (y < yMin) yMin = y;
    if (y > yMax) yMax = y;
  }
  if (!Number.isFinite(yMin) || !Number.isFinite(yMax)) { yMin = -0.1; yMax = 0.1; }
  const yRange = Math.max(0.02, yMax - yMin);
  const X = (v) => padL + v * w;
  const Y = (v) => padT + h - ((v - yMin) / yRange) * h;
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas-1, #0e1218)', display: 'block' }}
         data-testid="forge-wing-rib-profile-preview">
      <line x1={padL} y1={Y(0)} x2={padL + w} y2={Y(0)}
            stroke="var(--forge-rail-edge, #2a2d34)" strokeDasharray="2 3" />
      {profiles.map((p, idx) => {
        const path = p.points.map(([x, y], i) =>
          `${i === 0 ? 'M' : 'L'} ${X(x).toFixed(1)} ${Y(y).toFixed(1)}`).join(' ');
        const hue = 30 + Math.round(180 * idx / Math.max(1, profiles.length - 1));
        return (
          <path key={idx} d={path}
                fill="none"
                stroke={`hsl(${hue}, 70%, 60%)`} strokeWidth={1.2}
                opacity={0.85} />
        );
      })}
      <text x={padL} y={padT - 4} fontSize={10}
            fill="var(--forge-ink-mute, #9aa1ab)"
            fontFamily="var(--forge-mono, monospace)">
        {profiles.length} airfoil section{profiles.length === 1 ? '' : 's'}
        {' · '}{profiles[0]?.points?.length ?? 0} pts/ring
      </text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Planform preview (top view — span × chord).

function PlanformPreview({ stations, width = 480, height = 110 }) {
  if (!stations || stations.length < 2) return null;
  const padL = 30, padR = 6, padT = 8, padB = 14;
  const w = width - padL - padR, h = height - padT - padB;
  // Compute world LE for each station (sweep advances LE in x).
  const pts = stations.map((s) => {
    const sweepRad = (s.sweep || 0) * Math.PI / 180;
    const leX = (s.z || 0) * Math.tan(sweepRad);
    return { z: s.z, leX, te: leX + (s.chord || 0) };
  });
  // Domain.
  let xMin = +Infinity, xMax = -Infinity, zMax = -Infinity;
  for (const p of pts) {
    if (p.leX < xMin) xMin = p.leX;
    if (p.te  > xMax) xMax = p.te;
    if (p.z   > zMax) zMax = p.z;
  }
  if (!Number.isFinite(xMin)) { xMin = 0; xMax = 1; zMax = 1; }
  const xRange = Math.max(1, xMax - xMin);
  const zRange = Math.max(1, zMax);
  const X = (mm) => padL + ((mm - xMin) / xRange) * w;
  const Y = (mm) => padT + h - (mm / zRange) * h;
  // Outline: LE down span then TE back up.
  const leData = pts.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${X(p.leX).toFixed(1)} ${Y(p.z).toFixed(1)}`).join(' ');
  const teData = [...pts].reverse().map((p) =>
    `L ${X(p.te).toFixed(1)} ${Y(p.z).toFixed(1)}`).join(' ');
  const path = `${leData} ${teData} Z`;
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas-1, #0e1218)' }}
         data-testid="forge-wing-rib-planform-preview">
      <path d={path} fill="rgba(217,122,59,0.18)"
            stroke="var(--forge-accent, #4f87ff)" strokeWidth={1.2} />
      {pts.map((p, i) => (
        <line key={i}
              x1={X(p.leX)} y1={Y(p.z)}
              x2={X(p.te)}  y2={Y(p.z)}
              stroke="rgba(255,255,255,0.4)" strokeWidth={0.8} />
      ))}
      <text x={4} y={Y(zMax / 2)} fontSize={10}
            fill="var(--forge-ink-mute, #9aa1ab)"
            fontFamily="var(--forge-mono, monospace)">z</text>
      <text x={padL} y={height - 2} fontSize={10}
            fill="var(--forge-ink-mute, #9aa1ab)"
            fontFamily="var(--forge-mono, monospace)">x (chord) →</text>
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Panel.

function cloneStations(src) {
  return src.map((s) => ({ ...s }));
}

export function WingRibLoftPanel({ open, onClose }) {
  const [stations, setStations] = useState(() => cloneStations(DEFAULT_STATIONS));
  const [nPtsPerSurface, setNPts] = useState(DEFAULT_NPTS_PER_SURFACE);
  const [log, setLog] = useState([]);
  const lastFaceRef = useRef(null);

  // Reset to the preset every time the panel opens so the e2e's
  // "click Generate with default stations" assertion stays deterministic.
  useEffect(() => {
    if (!open) return;
    setStations(cloneStations(DEFAULT_STATIONS));
    setNPts(DEFAULT_NPTS_PER_SURFACE);
    setLog([]);
  }, [open]);

  const onChangeField = useCallback((idx, field, value) => {
    setStations((prev) => prev.map((row, i) => {
      if (i !== idx) return row;
      if (field === 'code') {
        return { ...row, code: String(value) };
      }
      return { ...row, [field]: Number(value) };
    }));
  }, []);

  const onAddRow = useCallback(() => {
    setStations((prev) => {
      const last = prev[prev.length - 1] || { z: 0, chord: 100, code: '2412', twist: 0, sweep: 0 };
      const next = [...prev, {
        z: last.z + 333, chord: Math.max(20, last.chord - 50),
        code: last.code, twist: last.twist, sweep: last.sweep,
      }];
      return next;
    });
  }, []);

  const onRemoveRow = useCallback((idx) => {
    setStations((prev) => {
      if (prev.length <= 2) return prev;
      return prev.filter((_, i) => i !== idx);
    });
  }, []);

  const onResetToPreset = useCallback(() => {
    setStations(cloneStations(DEFAULT_STATIONS));
    setNPts(DEFAULT_NPTS_PER_SURFACE);
  }, []);

  const onApplyPreset = useCallback((presetId) => {
    const preset = PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setStations(cloneStations(preset.stations));
  }, []);

  const sane = useMemo(() => normaliseStations(stations), [stations]);

  const onGenerate = useCallback(() => {
    const r = runWingRibLoftPipeline({
      stations, nPtsPerSurface,
    });
    if (r.ok) lastFaceRef.current = r.faceHandle;
    setLog((l) => [
      ...l.slice(-12),
      {
        ok: r.ok, ts: Date.now(),
        message: r.ok
          ? `Lofted ${sane.length} ribs → face ${r.faceHandle}${
              r.metrics?.area ? ' · area ' + Number(r.metrics.area).toFixed(0) + ' mm²' : ''
            } (${r.gridSpec.uCount}×${r.gridSpec.vCount} grid)`
          : `Generate failed: ${r.reason || 'error'}${r.message ? ' · ' + r.message : ''}`,
      },
    ]);
  }, [stations, nPtsPerSurface, sane.length]);

  if (!open) return null;
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div role="dialog"
         aria-label="Wing rib lofting"
         data-testid="forge-wing-rib-loft-panel"
         data-station-count={sane.length}
         data-npts={nPtsPerSurface}
         data-last-face={lastFaceRef.current == null ? '' : String(lastFaceRef.current)}
         style={PANEL_STYLE}>
      <header style={HEADER_ROW}>
        <Icon name="solid.loft" size={14} />
        <strong style={{ fontSize: 13 }}>Wing Rib Lofting</strong>
        <span style={{
          fontFamily: 'var(--forge-mono, ui-monospace, monospace)',
          fontSize: 10,
          color: 'var(--forge-ink-mute, #9aa1ab)',
          padding: '1px 6px',
          borderRadius: 'var(--forge-radius-pill, 10px)',
          border: '1px solid var(--forge-rail-edge, #2a2d34)',
        }}>
          NACA 4-digit · OCCT NURBS
        </span>
        <span style={{ flex: 1 }} />
        <button type="button"
                onClick={() => onClose?.()}
                aria-label="Close Wing Rib Lofting panel"
                data-testid="forge-wing-rib-loft-close"
                style={CLOSE_BTN}>×</button>
      </header>

      <div style={{ fontSize: 11, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
        Define N airfoil sections at span stations (z, chord, NACA code,
        twist, sweep). Generate samples each NACA-4 profile, transforms
        every station into world space, then lofts the wing skin via the
        same surfacing.buildPatch primitive Class-A Blend + Loft Sections
        use.
      </div>

      <div style={SECTION_TITLE}>Presets</div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {PRESETS.map((p) => (
          <button key={p.id}
                  type="button"
                  onClick={() => onApplyPreset(p.id)}
                  data-testid={`forge-wing-rib-preset-${p.id}`}
                  style={SMALL_BTN}>{p.label}</button>
        ))}
      </div>

      <div style={SECTION_TITLE}>Span stations (z, chord, NACA, twist, sweep)</div>
      <div style={SECTION_BOX}>
        <div style={TABLE_HEADER_ROW}>
          <span style={{ textAlign: 'center' }}>#</span>
          <span>z (mm)</span>
          <span>chord (mm)</span>
          <span>NACA</span>
          <span>twist (°)</span>
          <span>sweep (°)</span>
          <span></span>
        </div>
        <div data-testid="forge-wing-rib-loft-table"
             data-row-count={stations.length}
             style={{ display: 'flex', flexDirection: 'column', gap: 2,
                      maxHeight: 220, overflowY: 'auto' }}>
          {stations.map((row, idx) => (
            <div key={idx}
                 data-testid={`forge-wing-rib-loft-row-${idx}`}
                 style={TABLE_ROW(false)}>
              <span style={TABLE_ROW_LABEL}>{idx + 1}</span>
              <input type="number"
                     step="1"
                     value={row.z}
                     onChange={(e) => onChangeField(idx, 'z', e.target.value)}
                     data-testid={`forge-wing-rib-loft-z-${idx}`}
                     style={INPUT_STYLE} />
              <input type="number"
                     step="1"
                     min="1"
                     value={row.chord}
                     onChange={(e) => onChangeField(idx, 'chord', e.target.value)}
                     data-testid={`forge-wing-rib-loft-chord-${idx}`}
                     style={INPUT_STYLE} />
              <input type="text"
                     value={row.code}
                     onChange={(e) => onChangeField(idx, 'code', e.target.value)}
                     placeholder="2412"
                     data-testid={`forge-wing-rib-loft-code-${idx}`}
                     style={INPUT_STYLE} />
              <input type="number"
                     step="0.5"
                     value={row.twist}
                     onChange={(e) => onChangeField(idx, 'twist', e.target.value)}
                     data-testid={`forge-wing-rib-loft-twist-${idx}`}
                     style={INPUT_STYLE} />
              <input type="number"
                     step="1"
                     value={row.sweep}
                     onChange={(e) => onChangeField(idx, 'sweep', e.target.value)}
                     data-testid={`forge-wing-rib-loft-sweep-${idx}`}
                     style={INPUT_STYLE} />
              <button type="button"
                      onClick={() => onRemoveRow(idx)}
                      data-testid={`forge-wing-rib-loft-remove-${idx}`}
                      aria-label={`Remove station ${idx + 1}`}
                      disabled={stations.length <= 2}
                      style={{
                        ...SMALL_BTN,
                        opacity: stations.length <= 2 ? 0.4 : 1,
                        cursor: stations.length <= 2 ? 'not-allowed' : 'pointer',
                      }}>−</button>
            </div>
          ))}
        </div>
        <div style={ACTION_ROW}>
          <button type="button"
                  onClick={onAddRow}
                  data-testid="forge-wing-rib-loft-add"
                  style={SMALL_BTN}>+ Add station</button>
          <button type="button"
                  onClick={onResetToPreset}
                  data-testid="forge-wing-rib-loft-reset"
                  style={SMALL_BTN}>Reset to preset</button>
          <label style={{ display: 'flex', gap: 4, alignItems: 'center',
                          fontSize: 11, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
            <span>nPts/surface</span>
            <input type="number" min={8} max={300} step={10}
                   value={nPtsPerSurface}
                   onChange={(e) => setNPts(Math.max(8, parseInt(e.target.value, 10) || DEFAULT_NPTS_PER_SURFACE))}
                   data-testid="forge-wing-rib-loft-npts"
                   style={{ ...INPUT_STYLE, width: 60 }} />
          </label>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}
                data-testid="forge-wing-rib-loft-count">
            {sane.length} valid · {2 * nPtsPerSurface - 1}×{sane.length} grid
          </span>
        </div>
      </div>

      <div style={SECTION_TITLE}>Profile preview (chord-normalised)</div>
      <MultiProfilePreview stations={sane} nPtsPerSurface={nPtsPerSurface} />
      <div style={SECTION_TITLE}>Planform preview (top view)</div>
      <PlanformPreview stations={sane} />

      <div style={SECTION_TITLE}>Build</div>
      <div style={SECTION_BOX}>
        <button type="button"
                onClick={onGenerate}
                disabled={sane.length < 2}
                data-testid="forge-wing-rib-loft-generate"
                style={ACTION_BTN('primary', sane.length < 2)}>
          Generate — Build wing skin
        </button>
        <span style={{ fontSize: 10, color: 'var(--forge-ink-mute, #9aa1ab)' }}>
          {`NACA-4 polylines per station → world-space (2·nPts−1)×N grid → forge.surfacing.buildPatch (deg 3,3) → native surface body`}
        </span>
      </div>

      <div style={SECTION_TITLE}>Log</div>
      <div data-testid="forge-wing-rib-loft-log"
           data-log-count={log.length}
           style={LOG_BOX}>
        {log.length === 0 ? (
          <span style={{ color: 'var(--forge-ink-mute, #9aa1ab)' }}>
            no builds yet
          </span>
        ) : log.slice().reverse().map((entry, i) => (
          <div key={`${entry.ts}-${i}`}
               style={{
                 display: 'flex', gap: 6, alignItems: 'baseline',
                 borderBottom: '1px dashed var(--forge-rail-edge, #2a2d34)',
                 padding: '2px 0',
               }}>
            <span style={{ color: entry.ok ? 'var(--forge-ok, #4caf50)'
                                            : 'var(--forge-err, #ef5350)' }}>
              {entry.ok ? 'OK' : 'ER'}
            </span>
            <span style={{ flex: 1 }}>{entry.message}</span>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}

// ─────────────────────────────────────────────────────────────────────
// Host — listens for the `tools.wingRibLoft` menu action, exposes the
// imperative open/close hooks for plugins / e2e / Archie tool calls.

export function WingRibLoftPanelHost() {
  const [open, setOpen] = useState(false);
  const mounted = useRef(false);
  useEffect(() => {
    if (mounted.current) return undefined;
    mounted.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenWingRibLoft  = () => setOpen(true);
    window.__forgeCloseWingRibLoft = () => setOpen(false);
    const onMenu = (e) => {
      const id = e?.detail?.id;
      if (id === 'tools.wingRibLoft') setOpen(true);
    };
    window.addEventListener('forge:menu-action', onMenu);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      try { delete window.__forgeOpenWingRibLoft; } catch {}
      try { delete window.__forgeCloseWingRibLoft; } catch {}
    };
  }, []);
  if (!open) return null;
  return <WingRibLoftPanel open={open} onClose={() => setOpen(false)} />;
}

export default WingRibLoftPanel;
