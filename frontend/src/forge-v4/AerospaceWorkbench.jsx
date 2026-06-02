// Forge-171 — Aerospace airfoil designer workbench.
//
// Drives the native forge.airfoil kernel surface to build parametric
// 3D wings from NACA 4/5-digit codes or Selig DAT profiles. Generated
// bodies publish into the scene through window.__forgeSetBodies so they
// share rendering, selection, and snapshot infrastructure with every
// other workbench.
//
// Self-mounts via portal. Reachable through Tools > Aero workbench
// (window.__forgeOpenAerospaceWorkbench) or the workbench rail tab.
//
// MANUAL UI NEVER POSTS TO ARCHIE'S THREAD.

import React from 'react';
import { createPortal } from 'react-dom';

// -----------------------------------------------------------------------
// Profile-shape preview (SVG, 2D chord-normalised view).
// -----------------------------------------------------------------------
function ProfilePreview({ profile, width = 380, height = 110 }) {
  if (!profile || !profile.points || profile.points.length < 6) {
    return <div style={{ color: 'var(--forge-ink-mute)', fontSize: 11 }}>
      no profile
    </div>;
  }
  const pts = profile.points;
  const padL = 8, padR = 8, padT = 18, padB = 18;
  const w = width - padL - padR, h = height - padT - padB;
  const xs = []; const ys = [];
  for (let i = 0; i < pts.length / 2; ++i) {
    xs.push(pts[2 * i]); ys.push(pts[2 * i + 1]);
  }
  const yMin = Math.min(...ys), yMax = Math.max(...ys);
  const yRange = Math.max(0.02, yMax - yMin);
  const X = (v) => padL + v * w;
  const Y = (v) => padT + h - ((v - yMin) / yRange) * h;
  const path = xs.map((x, i) =>
    `${i === 0 ? 'M' : 'L'} ${X(x).toFixed(1)} ${Y(ys[i]).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)', display: 'block' }}
         data-testid="forge-aero-profile">
      <line x1={padL} y1={Y(0)} x2={padL + w} y2={Y(0)}
            stroke="var(--forge-rail-edge)" strokeDasharray="2 3" />
      <path d={path} fill="rgba(217,122,59,0.12)"
            stroke="var(--forge-accent)" strokeWidth={1.3} />
      <text x={padL} y={padT - 4} fontSize={10}
            fill="var(--forge-ink-mute)"
            fontFamily="var(--forge-mono)">
        {profile.source}  ·  {pts.length / 2} pts
      </text>
    </svg>
  );
}

// -----------------------------------------------------------------------
// Planform preview (SVG, top view — span × chord trapezoid).
// -----------------------------------------------------------------------
function PlanformPreview({ spec, width = 380, height = 90 }) {
  if (!spec) return null;
  const padL = 30, padR = 6, padT = 8, padB = 14;
  const w = width - padL - padR, h = height - padT - padB;
  const xMax = Math.max(spec.rootChordMm, spec.halfSpanMm * 1.15);
  const yMax = Math.max(spec.rootChordMm, spec.halfSpanMm * 0.6);
  const X = (mm) => padL + (mm / xMax) * w;
  const Y = (mm) => padT + h - (mm / yMax) * h;
  // Quarter-chord sweep offset at tip.
  const tipQcX = (Math.tan(spec.sweepDeg * Math.PI / 180)) * spec.halfSpanMm;
  const tipChord = spec.rootChordMm * spec.taperRatio;
  const rootLe = 0, rootTe = spec.rootChordMm;
  const tipLe  = tipQcX + spec.rootChordMm / 4 - tipChord / 4;
  const tipTe  = tipLe + tipChord;
  const poly = [
    [rootLe, 0], [tipLe, spec.halfSpanMm],
    [tipTe,  spec.halfSpanMm], [rootTe, 0],
  ].map(([x, y]) => `${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join(' ');
  return (
    <svg width={width} height={height}
         style={{ background: 'var(--forge-canvas)' }}
         data-testid="forge-aero-planform">
      <polygon points={poly} fill="rgba(217,122,59,0.18)"
               stroke="var(--forge-accent)" strokeWidth={1.2} />
      <text x={4} y={Y(spec.halfSpanMm / 2)} fontSize={10}
            fill="var(--forge-ink-mute)"
            fontFamily="var(--forge-mono)">y/2</text>
      <text x={padL} y={height - 2} fontSize={10}
            fill="var(--forge-ink-mute)"
            fontFamily="var(--forge-mono)">x (chord) →</text>
    </svg>
  );
}

const panelStyle = {
  position: 'fixed',
  top: 'calc(var(--forge-topbar-h) + var(--forge-qat-h))',
  right: 0, bottom: 'var(--forge-statusbar-h)',
  width: 440, zIndex: 1310,
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
  padding: '4px 6px', fontFamily: 'var(--forge-mono)',
};

// -----------------------------------------------------------------------
// Workbench panel.
// -----------------------------------------------------------------------
export function AerospaceWorkbenchPanel({ open, onClose }) {
  const [nacaCode, setNacaCode] = React.useState('2412');
  const [nacaFamily, setNacaFamily] = React.useState('4');     // '4' or '5'
  const [nPts, setNPts] = React.useState(160);
  const [rootChord, setRootChord] = React.useState(200);
  const [taperRatio, setTaperRatio] = React.useState(0.5);
  const [halfSpan, setHalfSpan] = React.useState(1000);
  const [sweepDeg, setSweepDeg] = React.useState(20);
  const [dihedralDeg, setDihedralDeg] = React.useState(5);
  const [twistDeg, setTwistDeg] = React.useState(-2);
  const [spanStations, setSpanStations] = React.useState(5);
  const [seligText, setSeligText] = React.useState('');
  const [profileSource, setProfileSource] = React.useState('naca');  // 'naca' | 'selig'
  const [profile, setProfile] = React.useState(null);
  const [tipProfile, setTipProfile] = React.useState(null);
  const [status, setStatus] = React.useState({ kind: 'idle', text: 'idle' });
  const [result, setResult] = React.useState(null);   // { handle, mass, metrics }

  // Build the root profile whenever inputs change. We do this synchronously
  // so the preview stays live; kernel calls are cheap (< 1 ms for NACA).
  React.useEffect(() => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.airfoil) { setProfile(null); return; }
    try {
      if (profileSource === 'naca') {
        const p = nacaFamily === '5'
          ? f.airfoil.naca5(nacaCode, nPts)
          : f.airfoil.naca4(nacaCode, nPts);
        setProfile(p);
      } else if (seligText.trim().length > 5) {
        setProfile(f.airfoil.parseSelig(seligText));
      } else {
        setProfile(null);
      }
    } catch (e) {
      setProfile(null);
      setStatus({ kind: 'err', text: `profile: ${e.message}` });
    }
  }, [profileSource, nacaFamily, nacaCode, nPts, seligText]);

  // Tip profile: default to root unless user picks a separate NACA.
  const [tipNacaCode, setTipNacaCode] = React.useState('');
  React.useEffect(() => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.airfoil || !tipNacaCode.trim()) { setTipProfile(null); return; }
    try {
      const code = tipNacaCode.trim();
      const p = code.length === 5
        ? f.airfoil.naca5(code, nPts)
        : f.airfoil.naca4(code, nPts);
      setTipProfile(p);
    } catch (e) {
      setTipProfile(null);
    }
  }, [tipNacaCode, nPts]);

  // Derived planform metrics — recompute via the kernel for parity with
  // what trapezoidalWing() will produce.
  const livePlanform = React.useMemo(() => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.airfoil || !profile) return null;
    try {
      return f.airfoil.planformMetrics({
        rootProfile: profile,
        tipProfile:  tipProfile,
        rootChordMm: rootChord,
        taperRatio,
        halfSpanMm:  halfSpan,
        sweepDeg, dihedralDeg, twistDeg,
        spanStations,
      });
    } catch (e) { return null; }
  }, [profile, tipProfile, rootChord, taperRatio, halfSpan,
      sweepDeg, dihedralDeg, twistDeg, spanStations]);

  const onGenerate = React.useCallback(() => {
    const f = (typeof window !== 'undefined') ? window.forge : null;
    if (!f || !f.airfoil) {
      setStatus({ kind: 'err', text: 'forge.airfoil kernel not available — load the native build' });
      return;
    }
    if (!profile || profile.points.length < 10) {
      setStatus({ kind: 'err', text: 'no profile — set NACA code or paste Selig DAT' });
      return;
    }
    try {
      setStatus({ kind: 'pending', text: 'lofting wing…' });
      const t0 = performance.now();
      const handle = f.airfoil.trapezoidalWing({
        rootProfile: profile,
        tipProfile:  tipProfile,
        rootChordMm: rootChord,
        taperRatio,
        halfSpanMm:  halfSpan,
        sweepDeg, dihedralDeg, twistDeg,
        spanStations,
      });
      const massProps = (typeof f.massProps === 'function')
        ? f.massProps(handle) : null;
      const metrics = f.airfoil.planformMetrics({
        rootProfile: profile, tipProfile,
        rootChordMm: rootChord, taperRatio, halfSpanMm: halfSpan,
        sweepDeg, dihedralDeg, twistDeg, spanStations,
      });
      const elapsedMs = (performance.now() - t0);

      // Publish into the scene. Other workbenches (Arch, CSG, Mesh) follow
      // the same pattern — read window.__forgeBodies, drop our own tagged
      // entries, append the new one, push back via window.__forgeSetBodies.
      if (typeof window !== 'undefined'
          && typeof window.__forgeSetBodies === 'function') {
        const cur = Array.isArray(window.__forgeBodies) ? window.__forgeBodies : [];
        const kept = cur.filter((b) => b.toolId !== 'aero.wing');
        const bodyId = `aero-wing-${Date.now()}`;
        const next = [
          ...kept,
          { id: bodyId, kind: 'native', handle,
            name: `Wing ${profile.source || '?'} c=${rootChord}mm b/2=${halfSpan}mm`,
            toolId: 'aero.wing' },
        ];
        window.__forgeSetBodies(next);
        window.__forgeBodies = next;
      }

      setResult({ handle, mass: massProps, metrics, elapsedMs });
      setStatus({ kind: 'ok', text: `wing #${handle} built in ${elapsedMs.toFixed(0)} ms` });
    } catch (e) {
      setStatus({ kind: 'err', text: `wing build failed: ${e.message}` });
    }
  }, [profile, tipProfile, rootChord, taperRatio, halfSpan,
      sweepDeg, dihedralDeg, twistDeg, spanStations]);

  if (!open) return null;

  return (
    <div style={panelStyle} data-testid="forge-aero-panel">
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--forge-space-2)' }}>
        <strong>Aero · airfoil & wing designer</strong>
        <span style={{ flex: 1 }} />
        <button onClick={onClose}
                style={{ background: 'transparent', border: 'none',
                         color: 'var(--forge-ink)', cursor: 'pointer' }}
                data-testid="forge-aero-close">×</button>
      </header>

      <section>
        <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      marginBottom: 4 }}>Root profile</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 4 }}>
          {['naca', 'selig'].map((src) => (
            <label key={src} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="radio" checked={profileSource === src}
                     onChange={() => setProfileSource(src)}
                     data-testid={`forge-aero-src-${src}`} />
              <span style={{ fontFamily: 'var(--forge-mono)', fontSize: 11 }}>
                {src.toUpperCase()}
              </span>
            </label>
          ))}
        </div>
        {profileSource === 'naca' && (
          <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 100px', gap: 6 }}>
            <select value={nacaFamily}
                    onChange={(e) => setNacaFamily(e.target.value)}
                    style={fieldInputStyle}
                    data-testid="forge-aero-naca-family">
              <option value="4">4-dig</option>
              <option value="5">5-dig</option>
            </select>
            <input value={nacaCode}
                   onChange={(e) => setNacaCode(e.target.value.trim())}
                   placeholder={nacaFamily === '5' ? '23012' : '2412'}
                   style={fieldInputStyle}
                   data-testid="forge-aero-naca-code" />
            <input type="number" value={nPts}
                   min={20} max={400} step={20}
                   onChange={(e) => setNPts(parseInt(e.target.value) || 160)}
                   style={fieldInputStyle}
                   data-testid="forge-aero-naca-npts" />
          </div>
        )}
        {profileSource === 'selig' && (
          <textarea rows={6} value={seligText}
                    onChange={(e) => setSeligText(e.target.value)}
                    placeholder={'NACA-0012\n1.0  0.0\n0.5  0.05\n0.0  0.0\n0.5  -0.05\n1.0  0.0'}
                    style={{ ...fieldInputStyle, resize: 'vertical', fontSize: 11 }}
                    data-testid="forge-aero-selig-text" />
        )}
        <div style={{ marginTop: 6 }}>
          <ProfilePreview profile={profile} />
        </div>
      </section>

      <section>
        <div style={{ fontSize: 11, color: 'var(--forge-ink-mute)',
                      textTransform: 'uppercase', letterSpacing: '0.06em',
                      marginBottom: 4 }}>Tip profile (optional)</div>
        <input value={tipNacaCode}
               onChange={(e) => setTipNacaCode(e.target.value.trim())}
               placeholder="leave blank to reuse root, or '0012' / '23015'"
               style={fieldInputStyle}
               data-testid="forge-aero-tip-naca" />
      </section>

      <section style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 6 }}>
        {[
          { label: 'Root chord [mm]', val: rootChord,   set: setRootChord,   step: 10,   testid: 'forge-aero-rc'  },
          { label: 'Taper ratio',     val: taperRatio,  set: setTaperRatio,  step: 0.05, testid: 'forge-aero-tr'  },
          { label: 'Half-span [mm]',  val: halfSpan,    set: setHalfSpan,    step: 50,   testid: 'forge-aero-hs'  },
          { label: 'Sweep [°]',       val: sweepDeg,    set: setSweepDeg,    step: 1,    testid: 'forge-aero-sw'  },
          { label: 'Dihedral [°]',    val: dihedralDeg, set: setDihedralDeg, step: 1,    testid: 'forge-aero-dh'  },
          { label: 'Twist [°]',       val: twistDeg,    set: setTwistDeg,    step: 0.5,  testid: 'forge-aero-tw'  },
          { label: 'Span stations',   val: spanStations,set: setSpanStations,step: 1,    testid: 'forge-aero-st'  },
        ].map((f) => (
          <label key={f.label}>
            <small style={{ color: 'var(--forge-ink-mute)' }}>{f.label}</small>
            <input type="number" value={f.val} step={f.step}
                   onChange={(e) => f.set(parseFloat(e.target.value) || 0)}
                   style={fieldInputStyle}
                   data-testid={f.testid} />
          </label>
        ))}
      </section>

      <section>
        <PlanformPreview spec={{
          rootChordMm: rootChord, taperRatio, halfSpanMm: halfSpan, sweepDeg,
        }} />
      </section>

      {livePlanform && (
        <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                          background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)' }}
                 data-testid="forge-aero-live-metrics">
          <div>S {livePlanform.areaMm2.toFixed(0)} mm²</div>
          <div>AR {livePlanform.aspectRatio.toFixed(2)} · MAC {livePlanform.meanAeroChordMm.toFixed(1)} mm</div>
          <div>Root c {livePlanform.rootChordMm.toFixed(0)} → Tip c {livePlanform.tipChordMm.toFixed(0)} mm · b/2 {livePlanform.halfSpanMm.toFixed(0)} mm</div>
        </section>
      )}

      <button onClick={onGenerate}
              style={{ background: 'var(--forge-accent)',
                       border: 'none', color: '#0a0e14',
                       padding: '8px 12px', cursor: 'pointer',
                       fontWeight: 600, fontFamily: 'var(--forge-mono)' }}
              data-testid="forge-aero-generate">
        Generate wing
      </button>

      <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        color: status.kind === 'err' ? 'var(--forge-bad, #ff6363)'
                             : status.kind === 'ok'  ? 'var(--forge-ok, #4ec18b)'
                             : 'var(--forge-ink-mute)' }}
               data-testid="forge-aero-status">
        {status.text}
      </section>

      {result && (
        <section style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                          background: 'var(--forge-canvas)',
                          padding: 'var(--forge-space-2)',
                          borderRadius: 'var(--forge-radius)' }}
                 data-testid="forge-aero-result">
          <div>Body handle #{result.handle}</div>
          {result.mass && <>
            <div>Volume {result.mass.volume?.toFixed?.(0) ?? '?'} mm³</div>
            <div>Surface {result.mass.area?.toFixed?.(0) ?? '?'} mm²</div>
          </>}
          <div>Build {result.elapsedMs.toFixed(0)} ms</div>
        </section>
      )}
    </div>
  );
}

// -----------------------------------------------------------------------
// Host — portal mount + window APIs.
// -----------------------------------------------------------------------
export function AerospaceWorkbenchHost() {
  const [open, setOpen] = React.useState(false);
  // Mount-once window-API installer (deps = [] avoids the React #185
  // re-render race that other Forge workbenches have learned the hard way).
  React.useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenAerospaceWorkbench  = () => setOpen(true);
    window.__forgeCloseAerospaceWorkbench = () => setOpen(false);
    const onMenu = (e) => {
      if (e?.detail?.id === 'tools.aero' || e?.detail?.id === 'workbench.aero') {
        setOpen(true);
      }
    };
    window.addEventListener('forge:menu-action', onMenu);
    const syncWb = () => {
      if (window.__forgeActiveWb === 'aero') setOpen(true);
    };
    window.addEventListener('forge:wb-changed', syncWb);
    return () => {
      window.removeEventListener('forge:menu-action', onMenu);
      window.removeEventListener('forge:wb-changed', syncWb);
    };
  }, []);
  if (typeof document === 'undefined') return null;
  return createPortal(
    <AerospaceWorkbenchPanel open={open} onClose={() => setOpen(false)} />,
    document.body,
  );
}

export default AerospaceWorkbenchPanel;
