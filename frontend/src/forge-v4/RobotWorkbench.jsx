// Forge-152 — Robot Workbench.
//
// Industrial 6-axis robot kinematics workbench. Lets the user:
//
//   - Pick a robot model (KUKA KR6 R900, ABB IRB1200-7/0.7,
//                         FANUC LR Mate 200iD/7L).
//   - Jog each joint individually (J1…J6 sliders, real motor limits).
//   - Jog the TCP in cartesian space (X/Y/Z position + A/B/C orient.).
//   - Record waypoints with full pose / orientation / move-type
//     (PTP / LIN / CIRC) / speed.
//   - Play the program back along the timeline.
//   - Toggle a reachable-workspace voxel cloud overlay.
//   - Export the program as KUKA KRL / ABB RAPID / FANUC TP.
//
// The component is purely declarative; the robot pose is rendered as
// a SVG projection (XZ plane front view + XY plane top-down view).
//
// MANUAL UI never writes to Archie's thread.

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ROBOT_MODELS, getRobotModel, DEG, RAD,
} from './robotModels.js';
import {
  forwardKinematics, inverseKinematics,
  tcpFromT, tFromTcp,
  pickBranchClosestToCurrent,
  reachableWorkspace,
} from './robotKinematics.js';
import {
  postProcess, postExtensionFor,
} from './robotPostProcessors.js';

const ROBOT_PANEL_EVENT = 'forge:open-robot-panel';

// Initial joint pose: all zeros = "home" (straight-up).
function defaultJointPose() { return [0, 0, 0, 0, 0, 0]; }

// ────────────────────────────────────────────────────────────────────
// External-store-style snapshot for the recorded waypoint list.
// Using useState directly works just as well for this UI, but keeping
// the snapshot stable + version-bumped avoids React #185 panics that
// satvikOS specifically called out.
// ────────────────────────────────────────────────────────────────────

function makeWaypoint(jointsDeg, pose, opts = {}) {
  return Object.freeze({
    id:           opts.id ?? cryptoId(),
    name:         opts.name ?? `WP${(opts.idx ?? 0) + 1}`,
    moveType:     opts.moveType ?? 'PTP',
    joints:       jointsDeg.slice(),
    pose:         pose.slice(),
    speed:        opts.speed ?? 250,
    blendRadius:  opts.blendRadius ?? 5,
    accel:        opts.accel ?? 1.0,
  });
}

function cryptoId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `wp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

// ────────────────────────────────────────────────────────────────────
// RobotWorkbench panel
// ────────────────────────────────────────────────────────────────────

export function RobotWorkbench({ open = true, theme = 'dark', onClose }) {
  const [modelId, setModelId]   = useState(ROBOT_MODELS[0].id);
  const model = useMemo(() => getRobotModel(modelId) || ROBOT_MODELS[0],
                        [modelId]);

  // Joint pose & TCP pose (derived from FK).
  const [jointsDeg, setJointsDeg] = useState(() => defaultJointPose());
  const fk = useMemo(() => forwardKinematics(model, jointsDeg),
                     [model, jointsDeg]);
  const tcp = useMemo(() => tcpFromT(fk.T0_6), [fk]);

  // Cartesian inputs (live-edit; only commit on Apply).
  const [cartInput, setCartInput] = useState(() => [...tcp]);
  useEffect(() => { setCartInput([...tcp]); /* sync after every joint move */
                    // eslint-disable-next-line react-hooks/exhaustive-deps
                  }, [tcp[0], tcp[1], tcp[2], tcp[3], tcp[4], tcp[5]]);

  // IK status + selected branch.
  const [ikInfo,   setIkInfo]   = useState({ count: 0, picked: null, error: null });
  const [recordMoveType, setRecordMoveType] = useState('PTP');
  const [recordSpeed,    setRecordSpeed]    = useState(250);  // mm/s for LIN, % for PTP
  const [recordBlend,    setRecordBlend]    = useState(5);    // mm

  const [waypoints, setWaypoints] = useState([]);

  // Playback state.
  const [playing,  setPlaying]  = useState(false);
  const [playIdx,  setPlayIdx]  = useState(0);
  const [playProg, setPlayProg] = useState(0);   // 0..1 within current segment

  // Workspace overlay.
  const [showWorkspace, setShowWorkspace] = useState(false);
  const workspaceVoxels = useMemo(() => {
    if (!showWorkspace) return null;
    return reachableWorkspace(model, { gridStep: 100 });
  }, [model, showWorkspace]);

  // Export modal.
  const [exportOutput, setExportOutput] = useState(null);

  // Publish snapshot to window so tests + Archie introspection works.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.__forgeRobot = Object.freeze({
      modelId, model, jointsDeg: jointsDeg.slice(), tcp: tcp.slice(),
      waypoints, ikInfo,
    });
  }, [modelId, model, jointsDeg, tcp, waypoints, ikInfo]);

  // ── joint jog ────────────────────────────────────────────────────
  const setJoint = useCallback((idx, valDeg) => {
    setJointsDeg((arr) => {
      const next = arr.slice();
      const row = model.dhRows[idx];
      next[idx] = Math.max(row.limit_min, Math.min(row.limit_max, valDeg));
      return next;
    });
  }, [model]);

  // ── cartesian jog (IK) ──────────────────────────────────────────
  const applyCart = useCallback(() => {
    try {
      const T = tFromTcp(cartInput);
      const sols = inverseKinematics(model, T);
      if (sols.length === 0) {
        setIkInfo({ count: 0, picked: null,
                    error: 'No IK solution — pose out of reach or singular.' });
        return;
      }
      const pick = pickBranchClosestToCurrent(sols, jointsDeg);
      setIkInfo({ count: sols.length, picked: pick.branch, error: null });
      setJointsDeg(pick.q);
    } catch (err) {
      setIkInfo({ count: 0, picked: null, error: err.message });
    }
  }, [cartInput, jointsDeg, model]);

  // ── teach pendant: record current pose ──────────────────────────
  const recordPose = useCallback(() => {
    setWaypoints((arr) => {
      const idx = arr.length;
      const wp = makeWaypoint(jointsDeg, tcp, {
        idx,
        moveType:    recordMoveType,
        speed:       recordSpeed,
        blendRadius: recordBlend,
      });
      return [...arr, wp];
    });
  }, [jointsDeg, tcp, recordMoveType, recordSpeed, recordBlend]);

  const deleteWaypoint = useCallback((id) => {
    setWaypoints((arr) => arr.filter((w) => w.id !== id));
  }, []);

  const moveWaypoint = useCallback((id, dir) => {
    setWaypoints((arr) => {
      const i = arr.findIndex((w) => w.id === id);
      if (i < 0) return arr;
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      const next = arr.slice();
      const tmp = next[i]; next[i] = next[j]; next[j] = tmp;
      return next;
    });
  }, []);

  const clearWaypoints = useCallback(() => setWaypoints([]), []);

  // ── playback ─────────────────────────────────────────────────────
  // Drives the robot through the recorded waypoint list. Joint-
  // interpolation for PTP, cartesian-interpolation (with IK every step)
  // for LIN. CIRC reuses LIN interpolation along the 3-point arc.
  const playbackRef = useRef({ rafId: null, lastTime: 0 });

  useEffect(() => {
    if (!playing) return undefined;
    let cancelled = false;
    let segStart = jointsDeg.slice();
    let segIdx = playIdx;

    const tick = (t) => {
      if (cancelled) return;
      const last = playbackRef.current.lastTime || t;
      const dt = (t - last) / 1000;
      playbackRef.current.lastTime = t;
      if (segIdx >= waypoints.length) {
        setPlaying(false);
        return;
      }
      const target = waypoints[segIdx];
      // Segment duration ≈ joint distance / max joint speed.
      let segDur;
      if (target.moveType === 'PTP') {
        const dq = target.joints.map((q, i) => Math.abs(q - segStart[i]));
        const v  = model.dhRows.map((r) => r.vmax);
        segDur = Math.max(...dq.map((d, i) => d / v[i]));
        segDur = Math.max(0.2, segDur * 100 / Math.max(1, target.speed)); // %
      } else {
        // LIN/CIRC — cartesian distance / mm-per-s
        const dx = target.pose[0] - tcp[0];
        const dy = target.pose[1] - tcp[1];
        const dz = target.pose[2] - tcp[2];
        const dist = Math.sqrt(dx*dx + dy*dy + dz*dz);
        segDur = Math.max(0.2, dist / Math.max(1, target.speed));
      }
      setPlayProg((p) => {
        const next = Math.min(1, p + dt / Math.max(0.05, segDur));
        if (target.moveType === 'PTP') {
          const q = segStart.map((s, i) =>
            s + (target.joints[i] - s) * easeInOut(next));
          setJointsDeg(q);
        } else {
          const p0 = tcpFromT(forwardKinematics(model, segStart).T0_6);
          const lerp = (a, b, t) => a + (b - a) * easeInOut(t);
          const pose = [
            lerp(p0[0], target.pose[0], next),
            lerp(p0[1], target.pose[1], next),
            lerp(p0[2], target.pose[2], next),
            lerp(p0[3], target.pose[3], next),
            lerp(p0[4], target.pose[4], next),
            lerp(p0[5], target.pose[5], next),
          ];
          const T = tFromTcp(pose);
          const sols = inverseKinematics(model, T);
          if (sols.length) {
            const pick = pickBranchClosestToCurrent(sols, jointsDeg);
            setJointsDeg(pick.q);
          }
        }
        if (next >= 1) {
          segStart = target.joints.slice();
          segIdx += 1;
          setPlayIdx(segIdx);
          return 0;
        }
        return next;
      });
      playbackRef.current.rafId = requestAnimationFrame(tick);
    };
    playbackRef.current.rafId = requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (playbackRef.current.rafId) cancelAnimationFrame(playbackRef.current.rafId);
      playbackRef.current.lastTime = 0;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  const startPlayback = useCallback(() => {
    if (!waypoints.length) return;
    setPlayIdx(0); setPlayProg(0); setPlaying(true);
  }, [waypoints.length]);
  const stopPlayback = useCallback(() => { setPlaying(false); }, []);

  // ── export ──────────────────────────────────────────────────────
  const doExport = useCallback((format) => {
    try {
      const meta = {
        robotId: model.id,
        programName: `FORGE_${model.vendor}_PROG`,
        author:  'forge-user',
        toolId:  1,
        baseId:  1,
        loadId:  1,
        toolName: 'tGripper',
        baseName: 'wPart',
        load:     model.payload_kg,
      };
      const text = postProcess(format, meta, waypoints);
      const ext = postExtensionFor(format);
      setExportOutput({ format, ext, text });
    } catch (err) {
      setExportOutput({ format, error: err.message });
    }
  }, [model, waypoints]);

  if (!open) return null;

  const dark = theme === 'dark';

  return (
    <div className="forge-robot-workbench"
         data-testid="forge-robot"
         data-theme={theme}
         style={panelOuter(dark)}>
      <RobotStyles />
      <header style={headerStyle(dark)}>
        <span data-testid="forge-robot-title" style={{ fontWeight: 600, letterSpacing: 0.4 }}>
          Robot · {model.vendor} {model.name}
        </span>
        <span style={{ flex: 1 }} />
        <span data-testid="forge-robot-tcp"
              style={{ fontFamily: 'var(--forge-mono)', fontSize: 11,
                        color: dark ? '#9aa' : '#444' }}>
          TCP&nbsp;
          X {fmt(tcp[0])} Y {fmt(tcp[1])} Z {fmt(tcp[2])} ·
          A {fmt(tcp[3])} B {fmt(tcp[4])} C {fmt(tcp[5])}
        </span>
        {onClose && (
          <button type="button"
                  data-testid="forge-robot-close"
                  onClick={onClose}
                  style={btnBase(dark)}>Close</button>
        )}
      </header>

      <div className="forge-robot-body">
        {/* Robot picker */}
        <section className="forge-robot-section"
                 data-testid="forge-robot-picker-section">
          <div className="forge-robot-section-head">Robot</div>
          <div className="forge-robot-section-body">
            <select className="forge-robot-input"
                    data-testid="forge-robot-picker"
                    value={modelId}
                    onChange={(e) => {
                      setModelId(e.target.value);
                      setJointsDeg(defaultJointPose());
                      setWaypoints([]);
                      setIkInfo({ count: 0, picked: null, error: null });
                    }}>
              {ROBOT_MODELS.map((m) => (
                <option key={m.id} value={m.id}
                        data-robot-id={m.id}>
                  {m.vendor} {m.name} · {m.payload_kg} kg · {m.reach_mm} mm
                </option>
              ))}
            </select>
            <div className="forge-robot-meta">
              <span>vendor <b>{model.vendor}</b></span>
              <span>payload <b>{model.payload_kg} kg</b></span>
              <span>reach <b>{model.reach_mm} mm</b></span>
              <span>post <b>{model.postProcessor}</b></span>
            </div>
          </div>
        </section>

        {/* Joint jog */}
        <section className="forge-robot-section"
                 data-testid="forge-robot-joint-section">
          <div className="forge-robot-section-head">Joint jog</div>
          <div className="forge-robot-section-body">
            {jointsDeg.map((q, i) => {
              const row = model.dhRows[i];
              return (
                <div key={i} className="forge-robot-jog-row"
                     data-testid={`forge-robot-joint-row-${i}`}>
                  <span className="forge-robot-jog-label">J{i+1}</span>
                  <input type="range"
                         min={row.limit_min}
                         max={row.limit_max}
                         step={0.5}
                         value={q}
                         data-testid={`forge-robot-joint-slider-${i}`}
                         onChange={(e) => setJoint(i, parseFloat(e.target.value))}
                         style={{ flex: 1 }} />
                  <input type="number"
                         min={row.limit_min}
                         max={row.limit_max}
                         step={0.1}
                         value={q.toFixed(2)}
                         data-testid={`forge-robot-joint-num-${i}`}
                         onChange={(e) => setJoint(i, parseFloat(e.target.value))}
                         className="forge-robot-input forge-robot-jog-num" />
                  <span className="forge-robot-jog-limits"
                        data-testid={`forge-robot-joint-limits-${i}`}>
                    {row.limit_min}°…{row.limit_max}°
                  </span>
                </div>
              );
            })}
            <button type="button"
                    className="forge-robot-btn"
                    data-testid="forge-robot-home"
                    onClick={() => setJointsDeg(defaultJointPose())}>
              Home all joints
            </button>
          </div>
        </section>

        {/* Cartesian jog */}
        <section className="forge-robot-section"
                 data-testid="forge-robot-cart-section">
          <div className="forge-robot-section-head">Cartesian jog (TCP)</div>
          <div className="forge-robot-section-body">
            {['X','Y','Z','A','B','C'].map((axis, i) => (
              <div key={axis} className="forge-robot-cart-row">
                <span className="forge-robot-jog-label">{axis}</span>
                <input type="number"
                       step={i < 3 ? 1 : 0.5}
                       value={Number(cartInput[i] ?? 0).toFixed(i < 3 ? 2 : 3)}
                       data-testid={`forge-robot-cart-${axis.toLowerCase()}`}
                       onChange={(e) => setCartInput((arr) => {
                         const next = arr.slice();
                         next[i] = parseFloat(e.target.value);
                         return next;
                       })}
                       className="forge-robot-input" />
                <span className="forge-robot-jog-limits">
                  {i < 3 ? 'mm' : '°'}
                </span>
              </div>
            ))}
            <button type="button"
                    className="forge-robot-btn"
                    data-testid="forge-robot-cart-apply"
                    onClick={applyCart}>
              Apply (IK)
            </button>
            <div className="forge-robot-ik-info"
                 data-testid="forge-robot-ik-info">
              {ikInfo.error ? (
                <span className="forge-robot-ik-err">{ikInfo.error}</span>
              ) : (
                <span>
                  {ikInfo.count} solution{ikInfo.count === 1 ? '' : 's'}
                  {ikInfo.picked ? ` · branch ${ikInfo.picked}` : ''}
                </span>
              )}
            </div>
          </div>
        </section>

        {/* Robot 3D scene preview */}
        <RobotScene model={model} fk={fk} tcp={tcp}
                    workspace={workspaceVoxels} dark={dark}
                    waypoints={waypoints} />

        {/* Teach pendant */}
        <section className="forge-robot-section"
                 data-testid="forge-robot-teach-section">
          <div className="forge-robot-section-head">Teach pendant</div>
          <div className="forge-robot-section-body">
            <div className="forge-robot-cart-row">
              <span className="forge-robot-jog-label">Move</span>
              <select className="forge-robot-input"
                      data-testid="forge-robot-teach-movetype"
                      value={recordMoveType}
                      onChange={(e) => setRecordMoveType(e.target.value)}>
                <option value="PTP">PTP (joint)</option>
                <option value="LIN">LIN (linear)</option>
                <option value="CIRC">CIRC (circular)</option>
              </select>
            </div>
            <div className="forge-robot-cart-row">
              <span className="forge-robot-jog-label">Speed</span>
              <input type="number" min={1} step={10}
                     value={recordSpeed}
                     data-testid="forge-robot-teach-speed"
                     onChange={(e) => setRecordSpeed(parseFloat(e.target.value))}
                     className="forge-robot-input" />
              <span className="forge-robot-jog-limits">
                {recordMoveType === 'PTP' ? '%' : 'mm/s'}
              </span>
            </div>
            <div className="forge-robot-cart-row">
              <span className="forge-robot-jog-label">Blend</span>
              <input type="number" min={0} step={1}
                     value={recordBlend}
                     data-testid="forge-robot-teach-blend"
                     onChange={(e) => setRecordBlend(parseFloat(e.target.value))}
                     className="forge-robot-input" />
              <span className="forge-robot-jog-limits">mm</span>
            </div>
            <button type="button"
                    className="forge-robot-btn forge-robot-btn-primary"
                    data-testid="forge-robot-record"
                    onClick={recordPose}>
              Record waypoint
            </button>
            <button type="button"
                    className="forge-robot-btn"
                    data-testid="forge-robot-clear-waypoints"
                    onClick={clearWaypoints}>
              Clear all waypoints
            </button>
          </div>
        </section>

        {/* Waypoint list / playback timeline */}
        <section className="forge-robot-section"
                 data-testid="forge-robot-waypoints-section">
          <div className="forge-robot-section-head">
            Waypoints ({waypoints.length})
          </div>
          <div className="forge-robot-section-body">
            <div data-testid="forge-robot-waypoints-list">
              {waypoints.length === 0 ? (
                <div className="forge-robot-empty">
                  Jog the robot to a pose and click "Record waypoint".
                </div>
              ) : (
                waypoints.map((w, i) => (
                  <div key={w.id}
                       className="forge-robot-wp-row"
                       data-active={String(playing && playIdx === i)}
                       data-testid={`forge-robot-wp-${i}`}>
                    <span className="forge-robot-wp-idx">{i + 1}</span>
                    <span className="forge-robot-wp-name"
                          data-testid={`forge-robot-wp-${i}-name`}>{w.name}</span>
                    <span className="forge-robot-wp-type"
                          data-wp-movetype={w.moveType}>{w.moveType}</span>
                    <span className="forge-robot-wp-pose">
                      [{w.pose.slice(0,3).map((v) => v.toFixed(0)).join(', ')}]
                    </span>
                    <span className="forge-robot-wp-speed">
                      {w.speed}{w.moveType === 'PTP' ? '%' : 'mm/s'}
                    </span>
                    <button type="button"
                            className="forge-robot-wp-mini"
                            data-testid={`forge-robot-wp-${i}-up`}
                            onClick={() => moveWaypoint(w.id, -1)}>↑</button>
                    <button type="button"
                            className="forge-robot-wp-mini"
                            data-testid={`forge-robot-wp-${i}-down`}
                            onClick={() => moveWaypoint(w.id, +1)}>↓</button>
                    <button type="button"
                            className="forge-robot-wp-mini"
                            data-testid={`forge-robot-wp-${i}-del`}
                            onClick={() => deleteWaypoint(w.id)}>×</button>
                  </div>
                ))
              )}
            </div>
            <div className="forge-robot-playback">
              <button type="button"
                      className="forge-robot-btn"
                      data-testid="forge-robot-play"
                      disabled={!waypoints.length || playing}
                      onClick={startPlayback}>
                Play
              </button>
              <button type="button"
                      className="forge-robot-btn"
                      data-testid="forge-robot-stop"
                      disabled={!playing}
                      onClick={stopPlayback}>
                Stop
              </button>
              <div className="forge-robot-progress"
                   data-testid="forge-robot-progress">
                <div className="forge-robot-progress-bar"
                     style={{ width: `${((playIdx + playProg) / Math.max(1, waypoints.length)) * 100}%` }} />
              </div>
              <span className="forge-robot-jog-limits"
                    data-testid="forge-robot-progress-label">
                {playing
                  ? `WP ${playIdx + 1}/${waypoints.length}`
                  : 'idle'}
              </span>
            </div>
          </div>
        </section>

        {/* Workspace overlay toggle */}
        <section className="forge-robot-section">
          <div className="forge-robot-section-head">Reachable workspace</div>
          <div className="forge-robot-section-body">
            <label className="forge-robot-cart-row">
              <input type="checkbox"
                     data-testid="forge-robot-workspace-toggle"
                     checked={showWorkspace}
                     onChange={(e) => setShowWorkspace(e.target.checked)} />
              <span className="forge-robot-jog-label">Show voxel cloud</span>
            </label>
            {workspaceVoxels && (
              <div className="forge-robot-meta"
                   data-testid="forge-robot-workspace-info">
                <span>voxels <b>{workspaceVoxels.length}</b></span>
                <span>grid <b>100 mm</b></span>
                <span>tool down (Z↓)</span>
              </div>
            )}
          </div>
        </section>

        {/* Post-processor / export */}
        <section className="forge-robot-section"
                 data-testid="forge-robot-export-section">
          <div className="forge-robot-section-head">Export program</div>
          <div className="forge-robot-section-body">
            <div className="forge-robot-export-row">
              <button type="button"
                      className="forge-robot-btn forge-robot-btn-primary"
                      data-testid="forge-robot-export-krl"
                      disabled={!waypoints.length}
                      onClick={() => doExport('KRL')}>
                KUKA KRL (.src)
              </button>
              <button type="button"
                      className="forge-robot-btn"
                      data-testid="forge-robot-export-rapid"
                      disabled={!waypoints.length}
                      onClick={() => doExport('RAPID')}>
                ABB RAPID (.mod)
              </button>
              <button type="button"
                      className="forge-robot-btn"
                      data-testid="forge-robot-export-tp"
                      disabled={!waypoints.length}
                      onClick={() => doExport('TP')}>
                FANUC TP (.ls)
              </button>
            </div>
            {exportOutput?.error ? (
              <div className="forge-robot-ik-err"
                   data-testid="forge-robot-export-error">
                {exportOutput.error}
              </div>
            ) : exportOutput?.text ? (
              <div data-testid="forge-robot-export-output"
                   data-export-format={exportOutput.format}>
                <div className="forge-robot-meta">
                  <span>format <b>{exportOutput.format}</b></span>
                  <span>extension <b>.{exportOutput.ext}</b></span>
                  <span>lines <b>{exportOutput.text.split('\n').length}</b></span>
                </div>
                <pre className="forge-robot-export-pre"
                     data-testid="forge-robot-export-text">{exportOutput.text}</pre>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────
// Robot scene preview — front-elevation SVG with all link frames.
// ────────────────────────────────────────────────────────────────────

function RobotScene({ model, fk, tcp, workspace, dark, waypoints }) {
  // Project link-frame origins to the XZ plane (front elevation).
  const pts = fk.frames.map((F) => ({ x: F[3], z: F[11], y: F[7] }));
  // Auto-fit viewBox.
  const reach = model.reach_mm;
  const vx0 = -reach * 1.1, vy0 = -50;
  const vw  =  reach * 2.2, vh  =  reach * 1.6;
  const sx = (x) => x;
  const sy = (z) => (vh - 50) - z;   // invert: world +Z up → SVG -y up

  const linkColor = model.linkColor;
  const baseColor = model.baseColor;
  const inkMain = dark ? '#ebecef' : '#1a1a1a';
  const inkMute = dark ? '#9aa' : '#555';

  return (
    <section className="forge-robot-scene"
             data-testid="forge-robot-scene-section"
             style={{ background: dark ? '#0a0b0e' : '#ebecee' }}>
      <svg className="forge-robot-svg"
           data-testid="forge-robot-svg"
           viewBox={`${vx0} ${vy0} ${vw} ${vh}`}
           preserveAspectRatio="xMidYMid meet"
           style={{ width: '100%', height: 300, display: 'block' }}>
        {/* ground line */}
        <line x1={vx0} y1={sy(0)} x2={vx0+vw} y2={sy(0)}
              stroke={inkMute} strokeDasharray="6 6" strokeWidth={1.5} />
        <text x={vx0+12} y={sy(0)-6} fontSize={14} fill={inkMute}>floor</text>
        {/* base pedestal */}
        <rect x={-80} y={sy(model.dhRows[0].d)} width={160}
              height={model.dhRows[0].d} fill={baseColor}
              stroke={inkMain} strokeWidth={1.5} />
        <text x={0} y={sy(model.dhRows[0].d) - 8}
              fontSize={14} fill={inkMute} textAnchor="middle">
          base · {model.dhRows[0].d.toFixed(0)} mm
        </text>
        {/* workspace voxel cloud overlay (if enabled) */}
        {workspace && workspace.map((p, i) => (
          <circle key={`v-${i}`} cx={sx(p.x)} cy={sy(p.z)}
                  r={3} fill={linkColor} fillOpacity={0.07}
                  data-testid={i === 0 ? 'forge-robot-voxel-first' : undefined} />
        ))}
        {/* waypoints (cartesian pose projection) */}
        {waypoints.map((w, i) => (
          <g key={w.id} data-testid={`forge-robot-wp-svg-${i}`}>
            <circle cx={sx(w.pose[0])} cy={sy(w.pose[2])}
                    r={6} fill="none" stroke={linkColor} strokeWidth={1.8} />
            <text x={sx(w.pose[0])} y={sy(w.pose[2]) - 10}
                  fontSize={11} fill={linkColor}
                  textAnchor="middle">{i + 1}</text>
          </g>
        ))}
        {/* link segments — connect consecutive frame origins */}
        {pts.slice(0, -1).map((p, i) => {
          const q = pts[i + 1];
          return (
            <g key={`link-${i}`} data-testid={`forge-robot-link-${i}`}>
              <line x1={sx(p.x)} y1={sy(p.z)}
                    x2={sx(q.x)} y2={sy(q.z)}
                    stroke={linkColor} strokeWidth={14 - i*1.4}
                    strokeLinecap="round" opacity={0.85} />
            </g>
          );
        })}
        {/* joint dots */}
        {pts.map((p, i) => (
          <g key={`j-${i}`} data-testid={`forge-robot-joint-dot-${i}`}>
            <circle cx={sx(p.x)} cy={sy(p.z)} r={8}
                    fill={inkMain} stroke={linkColor} strokeWidth={2} />
            <text x={sx(p.x)+12} y={sy(p.z)+4}
                  fontSize={11} fill={inkMute}>
              {i === 0 ? 'O' : `J${i}`}
            </text>
          </g>
        ))}
        {/* TCP marker */}
        <g data-testid="forge-robot-tcp-marker">
          <circle cx={sx(tcp[0])} cy={sy(tcp[2])} r={10}
                  fill="none" stroke={inkMain} strokeWidth={2.5} />
          <line x1={sx(tcp[0])} y1={sy(tcp[2])-18} x2={sx(tcp[0])} y2={sy(tcp[2])+18}
                stroke={inkMain} strokeWidth={1} />
          <line x1={sx(tcp[0])-18} y1={sy(tcp[2])} x2={sx(tcp[0])+18} y2={sy(tcp[2])}
                stroke={inkMain} strokeWidth={1} />
          <text x={sx(tcp[0])+14} y={sy(tcp[2])-14}
                fontSize={12} fill={inkMain}>TCP</text>
        </g>
      </svg>
    </section>
  );
}

// ────────────────────────────────────────────────────────────────────
// Host — auto-mounts via App.jsx, listens for forge:open-robot-panel
// + window.__forgeOpenRobot + the [data-wb="robot"] tab click.
// ────────────────────────────────────────────────────────────────────

export function RobotWorkbenchHost() {
  const [open, setOpen]   = useState(false);
  const [theme, setTheme] = useState('dark');
  const mountedRef = useRef(false);

  useEffect(() => {
    if (mountedRef.current) return undefined;
    mountedRef.current = true;
    if (typeof window === 'undefined') return undefined;
    window.__forgeOpenRobot = (opts = {}) => {
      if (opts.theme) setTheme(opts.theme);
      setOpen(true);
    };
    window.__forgeCloseRobot = () => setOpen(false);
    const onEvt = (e) => {
      const d = e?.detail || {};
      if (d.theme) setTheme(d.theme);
      setOpen(true);
    };
    window.addEventListener(ROBOT_PANEL_EVENT, onEvt);

    const onClick = (e) => {
      const tab = e.target?.closest?.('[data-wb="robot"]');
      if (tab) {
        const t = window.__forgeTheme;
        if (t === 'dark' || t === 'light') setTheme(t);
        setOpen(true);
      }
    };
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener(ROBOT_PANEL_EVENT, onEvt);
      document.removeEventListener('click', onClick, true);
    };
  }, []);

  return (
    <RobotWorkbench open={open} theme={theme}
                    onClose={() => setOpen(false)} />
  );
}

// ────────────────────────────────────────────────────────────────────
// Styles
// ────────────────────────────────────────────────────────────────────

function panelOuter(dark) {
  return {
    position: 'absolute',
    top:      72,
    left:     76,
    right:    16,
    bottom:   48,
    background:  dark ? 'rgba(10,11,14,0.98)' : 'rgba(248,249,251,0.98)',
    color:       dark ? '#ebecef' : '#1a1a1a',
    border:      `1px solid ${dark ? '#1d2027' : '#c5c8d0'}`,
    borderRadius: 6,
    boxShadow:   '0 14px 38px rgba(0,0,0,0.5)',
    fontFamily:  'ui-sans-serif, system-ui',
    zIndex:      8500,
    display:     'flex',
    flexDirection: 'column',
    overflow:    'hidden',
  };
}

function headerStyle(dark) {
  return {
    display: 'flex', alignItems: 'center', gap: 12,
    padding: '8px 12px',
    background: dark ? '#000' : '#fff',
    borderBottom: `1px solid ${dark ? '#1d2027' : '#c5c8d0'}`,
  };
}

function btnBase(dark) {
  return {
    background: dark ? '#14161b' : '#fff',
    color:      dark ? '#ebecef' : '#1a1a1a',
    border:     `1px solid ${dark ? '#1d2027' : '#c5c8d0'}`,
    borderRadius: 4,
    padding:    '5px 12px',
    fontSize:   12,
    cursor:     'pointer',
  };
}

function easeInOut(t) { return t < 0.5 ? 2*t*t : -1 + (4 - 2*t) * t; }
function fmt(n) { return (typeof n === 'number' && isFinite(n)) ? n.toFixed(2) : '—'; }

function RobotStyles() {
  return (
    <style>{`
      .forge-robot-workbench { font-size: 12px; }
      .forge-robot-body {
        flex: 1; overflow-y: auto;
        display: flex; flex-direction: column; gap: 0;
      }
      .forge-robot-section {
        border-bottom: 1px solid rgba(255,255,255,0.06);
      }
      .forge-robot-section-head {
        padding: 6px 12px;
        font-size: 10px; text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(255,255,255,0.5);
        background: rgba(0,0,0,0.25);
        border-bottom: 1px solid rgba(255,255,255,0.05);
      }
      .forge-robot-workbench[data-theme="light"] .forge-robot-section-head {
        color: rgba(0,0,0,0.55);
        background: rgba(0,0,0,0.04);
      }
      .forge-robot-section-body {
        padding: 8px 12px;
        display: flex; flex-direction: column; gap: 6px;
      }
      .forge-robot-input {
        background: rgba(255,255,255,0.05);
        color: inherit;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 3px;
        padding: 3px 6px;
        font: inherit; font-size: 11px;
      }
      .forge-robot-workbench[data-theme="light"] .forge-robot-input {
        background: #fff;
        border-color: #c5c8d0;
      }
      .forge-robot-meta {
        display: flex; flex-wrap: wrap; gap: 4px 12px;
        font-family: ui-monospace, monospace;
        font-size: 10px; color: rgba(255,255,255,0.5);
      }
      .forge-robot-workbench[data-theme="light"] .forge-robot-meta {
        color: rgba(0,0,0,0.55);
      }
      .forge-robot-meta b { color: inherit; font-weight: 600; margin-left: 3px; }
      .forge-robot-workbench[data-theme="dark"] .forge-robot-meta b {
        color: #ebecef;
      }
      .forge-robot-jog-row {
        display: flex; align-items: center; gap: 8px;
      }
      .forge-robot-jog-label {
        width: 32px; font-weight: 600;
        font-family: ui-monospace, monospace;
      }
      .forge-robot-jog-num { width: 70px; text-align: right; }
      .forge-robot-jog-limits {
        font-family: ui-monospace, monospace;
        font-size: 10px;
        color: rgba(255,255,255,0.4);
        min-width: 90px; text-align: right;
      }
      .forge-robot-workbench[data-theme="light"] .forge-robot-jog-limits {
        color: rgba(0,0,0,0.5);
      }
      .forge-robot-cart-row {
        display: flex; align-items: center; gap: 8px;
      }
      .forge-robot-btn {
        background: rgba(255,255,255,0.06);
        color: inherit;
        border: 1px solid rgba(255,255,255,0.16);
        border-radius: 3px;
        padding: 4px 10px;
        font: inherit; font-size: 11px;
        cursor: pointer;
      }
      .forge-robot-workbench[data-theme="light"] .forge-robot-btn {
        background: #fff; border-color: #c5c8d0;
      }
      .forge-robot-btn:hover:not(:disabled) {
        background: rgba(255,255,255,0.12);
      }
      .forge-robot-workbench[data-theme="light"] .forge-robot-btn:hover:not(:disabled) {
        background: #f0f1f3;
      }
      .forge-robot-btn:disabled {
        opacity: 0.4; cursor: not-allowed;
      }
      .forge-robot-btn-primary {
        background: #ebecef; color: #000;
        border-color: #ebecef;
      }
      .forge-robot-workbench[data-theme="dark"] .forge-robot-btn-primary {
        background: #ebecef; color: #000;
      }
      .forge-robot-workbench[data-theme="light"] .forge-robot-btn-primary {
        background: #1a1a1a; color: #fff;
        border-color: #1a1a1a;
      }
      .forge-robot-ik-info {
        font-family: ui-monospace, monospace;
        font-size: 10px;
        color: rgba(255,255,255,0.55);
      }
      .forge-robot-workbench[data-theme="light"] .forge-robot-ik-info {
        color: rgba(0,0,0,0.6);
      }
      .forge-robot-ik-err {
        color: #e26a6a;
        font-family: ui-monospace, monospace;
        font-size: 11px;
      }
      .forge-robot-empty {
        font-style: italic;
        color: rgba(255,255,255,0.4);
        font-size: 11px;
      }
      .forge-robot-workbench[data-theme="light"] .forge-robot-empty {
        color: rgba(0,0,0,0.5);
      }
      .forge-robot-wp-row {
        display: grid;
        grid-template-columns: 18px 60px 50px 1fr 70px 22px 22px 22px;
        align-items: center; gap: 4px;
        padding: 3px 4px;
        font-size: 11px;
        border-radius: 3px;
      }
      .forge-robot-wp-row[data-active="true"] {
        background: rgba(235, 236, 239, 0.12);
        outline: 1px solid rgba(235, 236, 239, 0.4);
      }
      .forge-robot-wp-idx {
        text-align: right;
        font-family: ui-monospace, monospace;
        color: rgba(255,255,255,0.5);
      }
      .forge-robot-workbench[data-theme="light"] .forge-robot-wp-idx {
        color: rgba(0,0,0,0.5);
      }
      .forge-robot-wp-type {
        font-family: ui-monospace, monospace;
        font-size: 10px;
        color: rgba(255,255,255,0.7);
      }
      .forge-robot-wp-pose, .forge-robot-wp-speed {
        font-family: ui-monospace, monospace;
        font-size: 10px;
        color: rgba(255,255,255,0.55);
      }
      .forge-robot-workbench[data-theme="light"] .forge-robot-wp-type,
      .forge-robot-workbench[data-theme="light"] .forge-robot-wp-pose,
      .forge-robot-workbench[data-theme="light"] .forge-robot-wp-speed {
        color: rgba(0,0,0,0.6);
      }
      .forge-robot-wp-mini {
        background: transparent;
        color: inherit;
        border: 1px solid rgba(255,255,255,0.16);
        border-radius: 3px;
        font: inherit; font-size: 11px;
        padding: 0;
        width: 22px; height: 20px;
        cursor: pointer;
      }
      .forge-robot-workbench[data-theme="light"] .forge-robot-wp-mini {
        border-color: #c5c8d0;
      }
      .forge-robot-playback {
        display: flex; align-items: center; gap: 8px;
        margin-top: 6px;
      }
      .forge-robot-progress {
        flex: 1; height: 8px;
        background: rgba(255,255,255,0.06);
        border-radius: 4px;
        overflow: hidden;
      }
      .forge-robot-workbench[data-theme="light"] .forge-robot-progress {
        background: rgba(0,0,0,0.08);
      }
      .forge-robot-progress-bar {
        height: 100%; background: #ebecef;
        transition: width 0.08s linear;
      }
      .forge-robot-workbench[data-theme="light"] .forge-robot-progress-bar {
        background: #1a1a1a;
      }
      .forge-robot-export-row {
        display: flex; gap: 6px; flex-wrap: wrap;
      }
      .forge-robot-export-pre {
        margin: 6px 0 0;
        background: rgba(0,0,0,0.4);
        color: rgba(235,236,239,0.85);
        font-family: ui-monospace, monospace;
        font-size: 10px;
        padding: 8px 10px;
        border-radius: 4px;
        max-height: 240px;
        overflow: auto;
        white-space: pre;
      }
      .forge-robot-workbench[data-theme="light"] .forge-robot-export-pre {
        background: #fff; color: #1a1a1a;
        border: 1px solid #c5c8d0;
      }
      .forge-robot-scene {
        margin: 0; padding: 0;
        border-top: 1px solid rgba(255,255,255,0.06);
        border-bottom: 1px solid rgba(255,255,255,0.06);
      }
    `}</style>
  );
}

export default RobotWorkbench;
