/**
 * ArchDisc Foundation — 4-bar linkage kinematics.
 *
 * Closed-form forward kinematics for a planar four-bar linkage. The
 * linkage has four links + four revolute joints labelled:
 *
 *      A ───── crank ───── B
 *      │                    \
 *      │                  coupler
 *      │                    \
 *      D ───── rocker ──── C
 *
 *   A — fixed ground pin (at world origin)
 *   D — fixed ground pin (at (L_ground, 0))
 *   B — moving end of crank
 *   C — moving end of rocker; B and C connected by coupler
 *
 * Inputs: link lengths {crank, coupler, rocker, ground} and crank
 * angle θ. Output: positions of B, C and any coupler point.
 *
 * The mathematics:
 *   B = (crank · cos θ, crank · sin θ)
 *   C is on a circle radius coupler around B AND a circle radius rocker
 *     around D. Two intersections exist when |BD| ∈ (|coupler − rocker|,
 *     coupler + rocker).
 *
 * Grashof's condition (rotability):
 *   shortest + longest ≤ other two   →   linkage has a fully-rotating
 *                                        crank (Grashof type I/II/III).
 *   Else: rocker-rocker, no full rotation.
 *
 * The "coupler curve" is the locus of any point fixed to the coupler
 * link as θ varies — these are classic transcendental curves (e.g.
 * Watt's straight-line linkage, Chebyshev's lambda mechanism).
 */

const PI = Math.PI;

export class FourBarLinkage {
  constructor({ crank, coupler, rocker, ground, branch = 'upper' }) {
    this.crank = crank;
    this.coupler = coupler;
    this.rocker = rocker;
    this.ground = ground;
    this.branch = branch;   // 'upper' or 'lower' for circle-intersection
    this.A = [0, 0];
    this.D = [ground, 0];
  }

  /**
   * Grashof type:
   *   'crank-rocker'   — shortest = crank
   *   'double-crank'   — shortest = ground (drag-link)
   *   'double-rocker'  — shortest = coupler
   *   'rocker-rocker'  — non-Grashof (no full rotation)
   */
  grashofType() {
    const lens = [
      { name: 'crank',   v: this.crank   },
      { name: 'coupler', v: this.coupler },
      { name: 'rocker',  v: this.rocker  },
      { name: 'ground',  v: this.ground  },
    ].sort((a, b) => a.v - b.v);
    const shortest = lens[0], longest = lens[3];
    const grashof = shortest.v + longest.v < lens[1].v + lens[2].v;
    if (!grashof) return 'rocker-rocker';
    switch (shortest.name) {
      case 'crank':   return 'crank-rocker';
      case 'ground':  return 'double-crank';
      case 'coupler': return 'double-rocker';
      case 'rocker':  return 'crank-rocker';   // by symmetry
    }
    return 'unknown';
  }

  /**
   * Compute joint positions B and C at the given crank angle.
   * Returns null if the linkage is in an inadmissible configuration
   * (e.g. crank length too short to reach a feasible C).
   */
  pose(thetaCrank) {
    const Bx = this.crank * Math.cos(thetaCrank);
    const By = this.crank * Math.sin(thetaCrank);
    const Dx = this.D[0], Dy = this.D[1];
    const dx = Dx - Bx, dy = Dy - By;
    const distBD = Math.hypot(dx, dy);

    // Circle intersection: C is on circle radius `coupler` around B
    // AND circle radius `rocker` around D.
    const a = (this.coupler ** 2 - this.rocker ** 2 + distBD ** 2) / (2 * distBD);
    const h2 = this.coupler ** 2 - a * a;
    if (h2 < 0) return null;     // out of reach
    const h = Math.sqrt(h2);
    // Foot of perpendicular from C to line BD
    const Px = Bx + a * dx / distBD;
    const Py = By + a * dy / distBD;
    // Two intersections; choose by branch
    const sign = this.branch === 'upper' ? 1 : -1;
    const Cx = Px + sign * h * (-dy) / distBD;
    const Cy = Py + sign * h * (dx) / distBD;
    return { A: [...this.A], B: [Bx, By], C: [Cx, Cy], D: [...this.D] };
  }

  /**
   * Compute the position of a "coupler point" P fixed to the coupler
   * link. P is specified by 2 parameters: (a, b) in the coupler's
   * local frame, where a is along BC and b is perpendicular to BC.
   */
  couplerPoint(pose, a, b) {
    if (!pose) return null;
    const dx = pose.C[0] - pose.B[0], dy = pose.C[1] - pose.B[1];
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const vx = -uy, vy = ux;   // perpendicular (left-hand normal)
    return [pose.B[0] + a * ux + b * vx, pose.B[1] + a * uy + b * vy];
  }

  /**
   * Sweep the crank through θ ∈ [0, 2π] in N steps. Returns an array
   * of poses (some may be null at infeasible angles).
   */
  sweep(N = 36) {
    const out = [];
    for (let i = 0; i < N; i++) {
      const theta = (i / N) * 2 * PI;
      out.push({ theta, pose: this.pose(theta) });
    }
    return out;
  }
}

/**
 * Render a 4-bar linkage sweep + coupler curve to SVG.
 *
 * @param {FourBarLinkage} linkage
 * @param {object} options
 * @param {number} options.N - sweep steps (default 60)
 * @param {[number,number]} options.couplerPoint - (a,b) in coupler local frame
 *                                                 to trace as the coupler curve
 * @param {Array<{cx,cy,r}>} options.obstacles - circular obstacles to test for collision
 * @returns {{ svg, frames, couplerCurve, collisions }}
 */
export function renderFourBarSweep(linkage, options = {}) {
  const N = options.N ?? 60;
  const couplerPt = options.couplerPoint ?? [linkage.coupler / 2, 0];
  const obstacles = options.obstacles ?? [];

  const frames = linkage.sweep(N);
  const valid = frames.filter(f => f.pose !== null);
  // Coupler curve
  const couplerCurve = valid.map(f => linkage.couplerPoint(f.pose, ...couplerPt));

  // Collision check: for each frame test if any link segment intersects
  // any obstacle.
  function segIntersectsCircle(p1, p2, cx, cy, r) {
    // Closest distance from segment to circle center
    const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
    const len2 = dx * dx + dy * dy;
    let t = ((cx - p1[0]) * dx + (cy - p1[1]) * dy) / Math.max(len2, 1e-12);
    t = Math.max(0, Math.min(1, t));
    const fx = p1[0] + t * dx, fy = p1[1] + t * dy;
    const d2 = (cx - fx) ** 2 + (cy - fy) ** 2;
    return d2 <= r * r;
  }
  const collisions = frames.map(f => {
    if (!f.pose) return { theta: f.theta, hits: [] };
    const p = f.pose;
    const segs = [[p.A, p.B, 'crank'], [p.B, p.C, 'coupler'], [p.C, p.D, 'rocker']];
    const hits = [];
    for (const [a, b, name] of segs) {
      for (let i = 0; i < obstacles.length; i++) {
        const o = obstacles[i];
        if (segIntersectsCircle(a, b, o.cx, o.cy, o.r)) hits.push({ link: name, obstacleIdx: i });
      }
    }
    return { theta: f.theta, hits };
  });
  const collisionFreeFrames = collisions.filter(c => c.hits.length === 0).length;

  // SVG
  // Compute bounds
  let xMin = Infinity, xMax = -Infinity, yMin = Infinity, yMax = -Infinity;
  const include = (p) => {
    xMin = Math.min(xMin, p[0]); xMax = Math.max(xMax, p[0]);
    yMin = Math.min(yMin, p[1]); yMax = Math.max(yMax, p[1]);
  };
  for (const f of valid) {
    include(f.pose.A); include(f.pose.B); include(f.pose.C); include(f.pose.D);
  }
  for (const p of couplerCurve) include(p);
  const margin = 12;
  const w = (xMax - xMin) + 2 * margin;
  const h = (yMax - yMin) + 2 * margin;
  const project = (p) => [margin + (p[0] - xMin), margin + (yMax - p[1])];   // flip y for screen

  const lines = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}mm" height="${h}mm">`);
  lines.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="white"/>`);
  // Obstacles (red filled)
  for (const o of obstacles) {
    const [ox, oy] = project([o.cx, o.cy]);
    lines.push(`<circle cx="${ox.toFixed(3)}" cy="${oy.toFixed(3)}" r="${o.r}" fill="rgba(220,80,60,0.25)" stroke="#c44" stroke-width="0.4"/>`);
  }
  // Ghost frames (light grey)
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i];
    if (!f.pose) continue;
    const A = project(f.pose.A), B = project(f.pose.B);
    const C = project(f.pose.C), D = project(f.pose.D);
    const cls = collisions[i].hits.length > 0 ? '#c44' : '#bbb';
    const sw = collisions[i].hits.length > 0 ? 0.4 : 0.15;
    lines.push(`<line x1="${A[0].toFixed(2)}" y1="${A[1].toFixed(2)}" x2="${B[0].toFixed(2)}" y2="${B[1].toFixed(2)}" stroke="${cls}" stroke-width="${sw}"/>`);
    lines.push(`<line x1="${B[0].toFixed(2)}" y1="${B[1].toFixed(2)}" x2="${C[0].toFixed(2)}" y2="${C[1].toFixed(2)}" stroke="${cls}" stroke-width="${sw}"/>`);
    lines.push(`<line x1="${C[0].toFixed(2)}" y1="${C[1].toFixed(2)}" x2="${D[0].toFixed(2)}" y2="${D[1].toFixed(2)}" stroke="${cls}" stroke-width="${sw}"/>`);
  }
  // Highlight frame at θ = 60° (one specific pose) in solid black
  const highlight = frames[Math.floor(frames.length / 6)];
  if (highlight && highlight.pose) {
    const A = project(highlight.pose.A), B = project(highlight.pose.B);
    const C = project(highlight.pose.C), D = project(highlight.pose.D);
    lines.push(`<line x1="${A[0].toFixed(2)}" y1="${A[1].toFixed(2)}" x2="${B[0].toFixed(2)}" y2="${B[1].toFixed(2)}" stroke="black" stroke-width="0.8"/>`);
    lines.push(`<line x1="${B[0].toFixed(2)}" y1="${B[1].toFixed(2)}" x2="${C[0].toFixed(2)}" y2="${C[1].toFixed(2)}" stroke="black" stroke-width="0.8"/>`);
    lines.push(`<line x1="${C[0].toFixed(2)}" y1="${C[1].toFixed(2)}" x2="${D[0].toFixed(2)}" y2="${D[1].toFixed(2)}" stroke="black" stroke-width="0.8"/>`);
    lines.push(`<circle cx="${A[0].toFixed(2)}" cy="${A[1].toFixed(2)}" r="1" fill="#222"/>`);
    lines.push(`<circle cx="${D[0].toFixed(2)}" cy="${D[1].toFixed(2)}" r="1" fill="#222"/>`);
    lines.push(`<circle cx="${B[0].toFixed(2)}" cy="${B[1].toFixed(2)}" r="0.8" fill="white" stroke="black"/>`);
    lines.push(`<circle cx="${C[0].toFixed(2)}" cy="${C[1].toFixed(2)}" r="0.8" fill="white" stroke="black"/>`);
  }
  // Coupler curve
  let pathStr = '';
  for (let i = 0; i < couplerCurve.length; i++) {
    const [cx, cy] = project(couplerCurve[i]);
    pathStr += (i === 0 ? `M ${cx.toFixed(2)} ${cy.toFixed(2)}` : ` L ${cx.toFixed(2)} ${cy.toFixed(2)}`);
  }
  pathStr += ' Z';
  lines.push(`<path d="${pathStr}" fill="none" stroke="#3060c0" stroke-width="0.5" stroke-dasharray="2,1.2"/>`);

  // Title
  lines.push(`<text x="${margin}" y="${h - 2}" font-family="monospace" font-size="3.0">4-bar linkage · ${linkage.grashofType()} · sweep ${frames.length} frames · ${collisionFreeFrames}/${frames.length} collision-free</text>`);
  lines.push(`</svg>`);

  return {
    svg: lines.join('\n'),
    frames,
    couplerCurve,
    collisions,
    collisionFreeFrames,
    grashofType: linkage.grashofType(),
  };
}
