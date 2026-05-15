import { test, expect } from '@playwright/test';
import { Sketch2D } from '../frontend/src/foundation/Sketch2D.js';
import { inferConstraintsAndDimension } from '../frontend/src/foundation/SketchAutoDim.js';

test.describe('Sketch auto-snap + auto-dimensioning', () => {
  test.describe.configure({ timeout: 60000 });

  test('Rough quadrilateral cleans up to a perfect rectangle + 4 length dims', () => {
    // A user draws a "rectangle" with a pen — corners off by a degree
    // or two and side lengths slightly mismatched. Bottom-left ~origin,
    // intended 50 × 30 mm box.
    const s = new Sketch2D();
    const p1 = s.addPoint(0.4, 0.2);          // BL — should snap to anchor
    const p2 = s.addPoint(50.3, 0.6);          // BR — bottom edge
    const p3 = s.addPoint(50.5, 30.4);         // TR — right edge
    const p4 = s.addPoint(0.6, 30.2);          // TL — top edge
    const bottom = s.addLine(p1, p2);
    const right  = s.addLine(p2, p3);
    const top    = s.addLine(p3, p4);
    const left   = s.addLine(p4, p1);

    // Pre-snap: lines are skewed
    const preBottomAngleDeg = Math.abs(bottom.angle() * 180 / Math.PI);
    const preRightAngleDeg  = Math.abs(right.angle()  * 180 / Math.PI);
    console.log(`\nPre-snap: bottom=${preBottomAngleDeg.toFixed(2)}°, right=${preRightAngleDeg.toFixed(2)}°`);
    expect(preBottomAngleDeg).toBeGreaterThan(0.3);   // visibly tilted
    expect(preBottomAngleDeg).toBeLessThan(2);
    expect(preRightAngleDeg).toBeGreaterThan(88);
    expect(preRightAngleDeg).toBeLessThan(92);

    const result = inferConstraintsAndDimension(s);
    console.log(`Inferred constraints: ${result.constraintsAdded}`);
    for (const c of result.inferred) console.log(`  ${c.kind} ${c.lines ?? c.line ?? c.point ?? ''}`);
    console.log(`Solver: converged=${result.solver.converged}, iters=${result.solver.iterations}, ‖r‖=${result.solver.residualNorm.toExponential(2)}`);

    expect(result.solver.converged).toBe(true);
    expect(result.constraintsAdded).toBeGreaterThanOrEqual(5); // 4 axis snaps + ≥1 equal-length/parallel

    // After-solve assertions: every line snapped to exact horizontal/vertical
    // Horizontal lines may point +X (0°) or -X (180°); both are
    // perfectly horizontal. Vertical lines may point +Y (90°) or -Y (-90°).
    const horizontalErr = (line) => {
      const a = Math.abs(line.angle() * 180 / Math.PI);
      return Math.min(a, Math.abs(180 - a));
    };
    const verticalErr = (line) => {
      const a = Math.abs(line.angle() * 180 / Math.PI);
      return Math.abs(a - 90);
    };
    console.log(`Post-snap horizontals: bottom=${horizontalErr(bottom).toExponential(2)}°, top=${horizontalErr(top).toExponential(2)}°`);
    console.log(`Post-snap verticals:   right=${verticalErr(right).toExponential(2)}°, left=${verticalErr(left).toExponential(2)}°`);
    expect(horizontalErr(bottom)).toBeLessThan(1e-3);
    expect(horizontalErr(top)).toBeLessThan(1e-3);
    expect(verticalErr(right)).toBeLessThan(1e-3);
    expect(verticalErr(left)).toBeLessThan(1e-3);

    // Anchor stayed put
    expect(p1.fixed).toBe(true);
    expect(p1.x).toBeCloseTo(0.4, 5);
    expect(p1.y).toBeCloseTo(0.2, 5);

    // Dimensions: one length per line, formatted
    const lengthDims = result.dimensions.filter(d => d.type === 'length');
    expect(lengthDims).toHaveLength(4);
    for (const d of lengthDims) {
      expect(d.label).toMatch(/^\d+\.\d+ mm$/);
      expect(d.anchor).toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
    }
    console.log('Dimensions:');
    for (const d of result.dimensions) console.log(`  [${d.type}] ${d.ref} = ${d.label} @ (${d.anchor.x.toFixed(1)}, ${d.anchor.y.toFixed(1)})`);
  });

  test('Circle gets a radius dimension; the radius value matches the solved geometry', () => {
    const s = new Sketch2D();
    const center = s.addPoint(20, 20);
    const c = s.addCircle(center, 9.8);
    // Pin the radius so the solver doesn't drift it (no other constraints
    // on a single circle would normally pin radius — solver would leave
    // it as-is, but be explicit).
    s.radius(c, 10);
    const result = inferConstraintsAndDimension(s);
    expect(result.solver.converged).toBe(true);
    // Radius converged to 10 mm
    expect(c.radius).toBeCloseTo(10, 5);
    const rDim = result.dimensions.find(d => d.type === 'radius');
    expect(rDim).toBeTruthy();
    expect(rDim.value).toBeCloseTo(10, 5);
    expect(rDim.label).toMatch(/^R10/);
  });

  test('Two near-parallel lines snap to exact parallel', () => {
    const s = new Sketch2D();
    // Two lines at 30° and 31° (within the 3° parallelTol). Make
    // their lengths visibly different so equal-length doesn't trigger.
    const a1 = s.addPoint(0, 0);
    const a2 = s.addPoint(40, Math.tan(30 * Math.PI / 180) * 40);
    const b1 = s.addPoint(0, 20);
    const b2 = s.addPoint(80, 20 + Math.tan(31 * Math.PI / 180) * 80);  // 2× longer
    const la = s.addLine(a1, a2);
    const lb = s.addLine(b1, b2);
    const pre = (lb.angle() - la.angle()) * 180 / Math.PI;
    console.log(`\nPre-snap: lb-la = ${pre.toFixed(3)}°, la len = ${la.length().toFixed(1)}, lb len = ${lb.length().toFixed(1)}`);
    expect(Math.abs(pre)).toBeGreaterThan(0.5);

    // angleTolDeg=1: axis snap doesn't fire (lines are ~30° off-axis).
    // equalLengthTolRel=0.01: lengths differ by ~50 %, won't snap equal.
    const result = inferConstraintsAndDimension(s, {
      angleTolDeg: 1, equalLengthTolRel: 0.01,
    });
    console.log(`Parallel test: inferred = ${result.inferred.map(c => c.kind).join(', ')}`);
    expect(result.solver.converged).toBe(true);
    expect(result.inferred.some(c => c.kind === 'parallel')).toBe(true);
    const post = (lb.angle() - la.angle()) * 180 / Math.PI;
    expect(Math.abs(post)).toBeLessThan(0.01);
  });
});
