/**
 * ArchDisc Foundation — motion study.
 *
 * A motion study drives a mechanism through time and records what
 * happens: per-frame poses, velocities and accelerations (by central
 * finite difference), and per-frame interference checks. The frame
 * array it produces is exactly what an animation pipeline consumes —
 * it is the bridge between KinematicsCore and the keyframe engine.
 *
 *   runMotionStudy  — planar mechanisms (closed loops included)
 *   runSpatialMotion — open spatial chains (robot arms)
 *
 * Kernel-free pure math — node-importable for e2e.
 */

import { mat4Apply } from './KinematicsCore.js';

// ── Geometry helpers ───────────────────────────────────────────────

/** Transform a local point by a planar pose. */
function planarPoint(pose, p) {
  const c = Math.cos(pose.theta), s = Math.sin(pose.theta);
  return [pose.x + p[0] * c - p[1] * s, pose.y + p[0] * s + p[1] * c];
}

/** Do segments p1-p2 and p3-p4 intersect? */
function segSeg(p1, p2, p3, p4) {
  const d = (b, a) => [b[0] - a[0], b[1] - a[1]];
  const cross = (u, v) => u[0] * v[1] - u[1] * v[0];
  const r = d(p2, p1), s = d(p4, p3);
  const denom = cross(r, s);
  const qp = d(p3, p1);
  if (Math.abs(denom) < 1e-12) return false;     // parallel
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1;
}

/** Does segment p1-p2 reach within radius r of circle centre c? */
function segCircle(p1, p2, c, r) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 > 1e-12 ? ((c[0] - p1[0]) * dx + (c[1] - p1[1]) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const fx = p1[0] + t * dx, fy = p1[1] + t * dy;
  return (c[0] - fx) ** 2 + (c[1] - fy) ** 2 <= r * r;
}

/** Central-difference time derivative of a per-frame scalar array. */
function derivative(values, dt) {
  const n = values.length;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    if (i === 0) out[i] = n > 1 ? (values[1] - values[0]) / dt : 0;
    else if (i === n - 1) out[i] = (values[n - 1] - values[n - 2]) / dt;
    else out[i] = (values[i + 1] - values[i - 1]) / (2 * dt);
  }
  return out;
}

// ── Planar motion study ────────────────────────────────────────────

/**
 * Run a motion study on a planar mechanism.
 *
 * @param {PlanarMechanism} mechanism  drivers must already be time-based
 * @param {object} opts
 * @param {number=} opts.t0      start time (default 0)
 * @param {number=} opts.t1      end time (default 1)
 * @param {number=} opts.frames  frame count (default 48)
 * @param {Array<Array<[number,number][]>>=} opts.linkSegments
 *        per-link list of local collision segments
 * @param {Array<{cx,cy,r}>=} opts.obstacles  static circular obstacles
 * @param {boolean=} opts.ignoreAdjacent  skip link pairs sharing a joint (default true)
 * @returns {{ frames, summary }}
 */
export function runMotionStudy(mechanism, opts = {}) {
  const t0 = opts.t0 ?? 0;
  const t1 = opts.t1 ?? 1;
  const frameCount = Math.max(2, opts.frames ?? 48);
  const dt = (t1 - t0) / (frameCount - 1);
  const linkSegments = opts.linkSegments ?? [];
  const obstacles = opts.obstacles ?? [];
  const ignoreAdjacent = opts.ignoreAdjacent ?? true;

  // Link pairs that share a joint — excluded from self-collision.
  const adjacent = new Set();
  for (const j of mechanism.joints) {
    const lo = Math.min(j.linkA, j.linkB), hi = Math.max(j.linkA, j.linkB);
    adjacent.add(`${lo},${hi}`);
  }

  const raw = [];
  for (let f = 0; f < frameCount; f++) {
    const t = t0 + f * dt;
    const sol = mechanism.solveAt(t);

    // World-space collision segments per link.
    const worldSegs = sol.links.map((pose, li) =>
      (linkSegments[li] ?? []).map(([a, b]) => [planarPoint(pose, a), planarPoint(pose, b)]));

    const collisions = [];
    for (let a = 0; a < worldSegs.length; a++) {
      for (let b = a + 1; b < worldSegs.length; b++) {
        if (ignoreAdjacent && adjacent.has(`${a},${b}`)) continue;
        let hit = false;
        for (const sa of worldSegs[a]) {
          for (const sb of worldSegs[b]) {
            if (segSeg(sa[0], sa[1], sb[0], sb[1])) { hit = true; break; }
          }
          if (hit) break;
        }
        if (hit) collisions.push({ type: 'link-link', a, b });
      }
    }
    for (let li = 0; li < worldSegs.length; li++) {
      for (let oi = 0; oi < obstacles.length; oi++) {
        const o = obstacles[oi];
        if (worldSegs[li].some((s) => segCircle(s[0], s[1], [o.cx, o.cy], o.r))) {
          collisions.push({ type: 'link-obstacle', link: li, obstacle: oi });
        }
      }
    }

    raw.push({ t, links: sol.links, converged: sol.converged, residualNorm: sol.residualNorm, collisions });
  }

  // Velocities and accelerations per link via central difference.
  const nLinks = raw[0].links.length;
  for (let li = 0; li < nLinks; li++) {
    for (const key of ['x', 'y', 'theta']) {
      const series = raw.map((fr) => fr.links[li][key]);
      const vel = derivative(series, dt);
      const acc = derivative(vel, dt);
      for (let f = 0; f < frameCount; f++) {
        (raw[f].linkVel ??= [])[li] ??= {};
        (raw[f].linkAcc ??= [])[li] ??= {};
        raw[f].linkVel[li][key] = vel[f];
        raw[f].linkAcc[li][key] = acc[f];
      }
    }
  }

  let maxLinearSpeed = 0, maxAngularSpeed = 0, collisionFreeFrames = 0, allConverged = true;
  for (const fr of raw) {
    if (!fr.converged) allConverged = false;
    if (fr.collisions.length === 0) collisionFreeFrames++;
    for (let li = 0; li < nLinks; li++) {
      const v = fr.linkVel[li];
      maxLinearSpeed = Math.max(maxLinearSpeed, Math.hypot(v.x, v.y));
      maxAngularSpeed = Math.max(maxAngularSpeed, Math.abs(v.theta));
    }
  }

  return {
    frames: raw,
    summary: {
      frameCount, t0, t1, dt,
      allConverged,
      collisionFreeFrames,
      collisionFrames: frameCount - collisionFreeFrames,
      maxLinearSpeed, maxAngularSpeed,
    },
  };
}

// ── Spatial motion study ───────────────────────────────────────────

/**
 * Run a motion study on an open spatial chain. Each joint is driven by
 * a function of time; the tip path and its speed are recorded.
 *
 * @param {SpatialChain} chain
 * @param {Array<(t:number)=>number>} jointDrivers  one per joint
 * @param {object} opts  { t0?, t1?, frames?, tipLocal? }
 * @returns {{ frames, summary }}
 */
export function runSpatialMotion(chain, jointDrivers, opts = {}) {
  const t0 = opts.t0 ?? 0;
  const t1 = opts.t1 ?? 1;
  const frameCount = Math.max(2, opts.frames ?? 48);
  const dt = (t1 - t0) / (frameCount - 1);
  const tipLocal = opts.tipLocal ?? [0, 0, 0];

  const raw = [];
  for (let f = 0; f < frameCount; f++) {
    const t = t0 + f * dt;
    const values = jointDrivers.map((fn) => fn(t));
    const { linkTransforms, tip } = chain.fkAt(values, tipLocal);
    raw.push({ t, values, linkTransforms, tip });
  }

  // Tip speed by central difference.
  let maxTipSpeed = 0, pathLength = 0;
  for (let f = 0; f < frameCount; f++) {
    let speed = 0;
    if (f > 0 && f < frameCount - 1) {
      const a = raw[f - 1].tip, b = raw[f + 1].tip;
      speed = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / (2 * dt);
    }
    raw[f].tipSpeed = speed;
    maxTipSpeed = Math.max(maxTipSpeed, speed);
    if (f > 0) {
      const a = raw[f - 1].tip, b = raw[f].tip;
      pathLength += Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    }
  }

  return {
    frames: raw,
    summary: { frameCount, t0, t1, dt, maxTipSpeed, tipPathLength: pathLength },
  };
}

/** Re-export so consumers can transform link frames without a second import. */
export { mat4Apply };
