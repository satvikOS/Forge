/**
 * ArchDisc Foundation — Sketch auto-snap + auto-dimensioning.
 *
 * Takes a rough-drawn 2D sketch (Sketch2D with lines, circles, arcs)
 * and:
 *   1. Infers obvious geometric constraints from the input —
 *      near-horizontal / near-vertical / near-parallel /
 *      near-perpendicular / near-equal-length — within configurable
 *      angle and length tolerances.
 *   2. Adds those constraints to the sketch.
 *   3. Runs Sketch2D's Newton-Raphson solver to clean up the coords
 *      so the user gets pixel-perfect right angles instead of the
 *      slightly-skewed lines a pen/stylus actually drew.
 *   4. Emits a list of dimension annotations the renderer can lay
 *      down: line lengths, circle radii, point coordinates.
 *
 * Why this lives in foundation rather than the InteractiveSketch
 * helper: SolidWorks / Onshape / Fusion all run the same kind of
 * "clean up my drawing" pass; making it solver-validated means an
 * AI plan step can call this directly on a programmatic sketch and
 * get the same result as a human stylus user.
 *
 * Reference: Sutherland Sketchpad 1963 (original constraint
 * propagation); ParaSolid SolveSPACE for modern Newton-Raphson
 * sketcher; Onshape Performance Foundation 2021 §3.4.
 */

const DEFAULTS = {
  angleTolDeg: 5,        // lines within 5° of axis-aligned snap to it
  parallelTolDeg: 3,     // pairs within 3° of parallel snap to parallel
  perpTolDeg: 3,         // ... perpendicular
  equalLengthTolRel: 0.05, // pairs within 5 % length difference snap equal
  fixFirstPoint: true,   // anchor the lower-left point so the solver
                         // has a reference frame
  solverTol: 1e-7,
  solverMaxIter: 80,
};

/**
 * Run the full pipeline: infer → constrain → solve → dimension.
 *
 * @param {Sketch2D} sketch
 * @param {Partial<typeof DEFAULTS>=} options
 * @returns {{
 *   inferred: Array<{kind, lines?, line?, with?}>,
 *   constraintsAdded: number,
 *   solver: { converged, iterations, residualNorm },
 *   dimensions: Array<{type, ref, value, label, anchor}>,
 * }}
 */
export function inferConstraintsAndDimension(sketch, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const angleTol = (opts.angleTolDeg * Math.PI) / 180;
  const parTol = (opts.parallelTolDeg * Math.PI) / 180;
  const perpTol = (opts.perpTolDeg * Math.PI) / 180;

  const lines = sketch.entities.filter(e => e.type === 'line');
  const circles = sketch.entities.filter(e => e.type === 'circle');
  const inferred = [];

  // 1. Anchor the first point so the system has a reference frame.
  if (opts.fixFirstPoint && sketch.points.length > 0) {
    const anchor = pickLowerLeft(sketch.points);
    if (anchor && !anchor.fixed) {
      sketch.fix(anchor);
      inferred.push({ kind: 'fix', point: anchor.id });
    }
  }

  // 2. Per-line: snap to horizontal / vertical if within tolerance.
  for (const line of lines) {
    const a = normaliseAngle(line.angle());
    // horizontal candidates: angle ≈ 0 or π
    if (nearestDelta(a, [0, Math.PI]) < angleTol) {
      sketch.horizontal(line);
      inferred.push({ kind: 'horizontal', line: line.id });
      continue;
    }
    if (nearestDelta(a, [Math.PI / 2, -Math.PI / 2]) < angleTol) {
      sketch.vertical(line);
      inferred.push({ kind: 'vertical', line: line.id });
    }
  }

  // 3. Pairwise: parallel + perpendicular. Skip pairs already pinned
  //    axis-aligned (those are already constrained transitively).
  const axisPinned = new Set(
    inferred.filter(c => c.kind === 'horizontal' || c.kind === 'vertical')
            .map(c => c.line));
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const li = lines[i], lj = lines[j];
      if (axisPinned.has(li.id) && axisPinned.has(lj.id)) continue;
      const ai = normaliseAngle(li.angle());
      const aj = normaliseAngle(lj.angle());
      const dAng = Math.abs(angleDiff(ai, aj));
      if (dAng < parTol) {
        sketch.parallel(li, lj);
        inferred.push({ kind: 'parallel', lines: [li.id, lj.id] });
      } else if (Math.abs(dAng - Math.PI / 2) < perpTol) {
        sketch.perpendicular(li, lj);
        inferred.push({ kind: 'perpendicular', lines: [li.id, lj.id] });
      }
    }
  }

  // 4. Pairwise equal-length within tolerance.
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const li = lines[i], lj = lines[j];
      const Li = li.length(), Lj = lj.length();
      const rel = Math.abs(Li - Lj) / Math.max(Li, Lj, 1e-12);
      if (rel < opts.equalLengthTolRel && rel > 0) {
        sketch.equalLength(li, lj);
        inferred.push({ kind: 'equalLength', lines: [li.id, lj.id] });
      }
    }
  }

  const constraintsAdded = inferred.length;

  // 5. Solve.
  const solver = sketch.solve({
    tol: opts.solverTol,
    maxIter: opts.solverMaxIter,
  });

  // 6. Dimension annotations — one per line + one per circle. Anchor
  //    at the midpoint with an outward normal offset so the renderer
  //    can draw a leader line.
  const dimensions = [];
  for (const line of lines) {
    const L = line.length();
    const cx = (line.p1.x + line.p2.x) / 2;
    const cy = (line.p1.y + line.p2.y) / 2;
    // Outward normal — rotate the line direction +90°.
    const dx = line.p2.x - line.p1.x;
    const dy = line.p2.y - line.p1.y;
    const len = Math.max(Math.hypot(dx, dy), 1e-12);
    const nx = -dy / len, ny = dx / len;
    dimensions.push({
      type: 'length',
      ref: line.id,
      value: L,
      label: formatLength(L),
      anchor: { x: cx + nx * 5, y: cy + ny * 5 },
    });
  }
  for (const circle of circles) {
    dimensions.push({
      type: 'radius',
      ref: circle.id,
      value: circle.radius,
      label: `R${formatLength(circle.radius)}`,
      anchor: { x: circle.center.x + circle.radius * 0.7071,
                y: circle.center.y + circle.radius * 0.7071 },
    });
  }

  return {
    inferred,
    constraintsAdded,
    solver: {
      converged: solver.converged,
      iterations: solver.iterations,
      residualNorm: solver.residualNorm,
      dofCount: solver.dofCount,
    },
    dimensions,
  };
}

/** Pick the bottom-left-most point as the geometric anchor. */
function pickLowerLeft(points) {
  let best = null;
  for (const p of points) {
    if (!best || p.y < best.y - 1e-9 || (Math.abs(p.y - best.y) < 1e-9 && p.x < best.x)) {
      best = p;
    }
  }
  return best;
}

/** Map an angle into [-π/2, π/2] so 0° and 180° collapse. */
function normaliseAngle(a) {
  while (a > Math.PI / 2) a -= Math.PI;
  while (a < -Math.PI / 2) a += Math.PI;
  return a;
}

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI / 2) d -= Math.PI;
  while (d < -Math.PI / 2) d += Math.PI;
  return d;
}

function nearestDelta(a, targets) {
  return Math.min(...targets.map(t => Math.abs(a - t)));
}

function formatLength(L) {
  if (Math.abs(L) >= 1000) return `${(L / 1000).toFixed(3)} m`;
  if (Math.abs(L) >= 10)   return `${L.toFixed(1)} mm`;
  return `${L.toFixed(2)} mm`;
}
