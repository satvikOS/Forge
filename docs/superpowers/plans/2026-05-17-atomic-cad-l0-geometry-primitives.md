# Atomic-CAD L0 Geometry Primitives — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-math geometry primitives the atomic-CAD sculptor depends on — exact parametric curve evaluators and closed-profile extraction — fully unit-tested.

**Architecture:** Two kernel-free modules under `frontend/src/kernel/atomic/`. `ParametricCurve.js` evaluates curves that need math (involute, spiral, ellipse) into exact point arrays. `SketchProfile.js` chains sketch segments into closed, correctly-oriented 2-D loops ready to feed a feature operation. Both are pure math with no `manifold-3d` / Three.js dependency, so Playwright specs import them directly in Node.

**Tech Stack:** Plain ES modules (JavaScript). Tests are Playwright spec files run in Node mode (no browser `page`), matching the existing repo convention (e.g. the former `e2e/balance-wheel.spec.js`). Test runner: `./node_modules/.bin/playwright` (pinned 1.59 — do **not** use `npx`, which pulls 1.60).

---

## Context for the Engineer

This is **Plan 1 of a multi-plan effort** implementing the design spec at
`docs/superpowers/specs/2026-05-17-autonomous-atomic-cad-sculptor-design.md`.
The full system is an eight-layer (L0–L7) autonomous CAD sculptor. This plan
delivers the lowest, dependency-free piece of L0: the geometry math.

**Why these two modules first:** every higher layer depends on them, they have
zero dependencies themselves, and they are pure functions — the cleanest
possible TDD. `ParametricCurve.js` is also the module most scrutinised in
review: a curve evaluator (involute, spiral) is a *sketch-entity primitive* — the
same atomic level as "line" or "arc" — **not** a premade part. It produces a
curve, never a finished component.

**Repo facts you need:**
- Repo root: `C:\Users\satvi\archdiscv1`, git branch `archdisc`.
- Source lives under `frontend/src/`. Kernel modules under `frontend/src/kernel/`.
- The directory `frontend/src/kernel/atomic/` does **not** exist yet — Task 1 creates it.
- Tests live in `e2e/`. A Node-mode spec looks like:
  ```js
  import { test, expect } from '@playwright/test';
  test('description', () => { expect(2 + 2).toBe(4); });
  ```
  No `async ({ page })` — these never open a browser.
- **Never** `import` from `node:*` in a spec file (Playwright quirk on this
  machine). Use bare specifiers (`import fs from 'fs'`). These two modules need
  no Node builtins anyway.
- Run a single spec: `./node_modules/.bin/playwright test e2e/NAME.spec.js`
  (from the repo root). Append `--reporter=list` for readable output.

---

## File Structure

| File | Responsibility |
|------|----------------|
| `frontend/src/kernel/atomic/ParametricCurve.js` | Exact point evaluators for involute, Archimedean spiral, ellipse arc, circle polyline. Pure math. |
| `frontend/src/kernel/atomic/SketchProfile.js` | Signed area, orientation, and chaining loose segments into closed oriented loops. Pure math. |
| `e2e/atomic-parametric-curve.spec.js` | Unit tests for `ParametricCurve.js`. |
| `e2e/atomic-sketch-profile.spec.js` | Unit tests for `SketchProfile.js`. |

---

## Task 1: Create the `atomic/` directory and `ParametricCurve.js` involute evaluator

**Files:**
- Create: `frontend/src/kernel/atomic/ParametricCurve.js`
- Test: `e2e/atomic-parametric-curve.spec.js`

- [ ] **Step 1: Write the failing test**

Create `e2e/atomic-parametric-curve.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { involute, involuteParamAtRadius } from '../frontend/src/kernel/atomic/ParametricCurve.js';

test.describe('ParametricCurve — involute', () => {
  test('every involute point lies at radius rb·sqrt(1+t^2) from the origin', () => {
    const rb = 5;
    const pts = involute(rb, 0, 1.2, 40);
    expect(pts.length).toBe(41);
    for (let i = 0; i < pts.length; i++) {
      const t = (1.2) * (i / 40);
      const expectedR = rb * Math.sqrt(1 + t * t);
      const actualR = Math.hypot(pts[i][0], pts[i][1]);
      expect(actualR).toBeCloseTo(expectedR, 9);
    }
  });

  test('the involute starts on the base circle (t=0 -> radius rb)', () => {
    const pts = involute(7, 0, 1, 8);
    expect(Math.hypot(pts[0][0], pts[0][1])).toBeCloseTo(7, 9);
  });

  test('involuteParamAtRadius inverts the radius relation', () => {
    const rb = 4;
    const t = involuteParamAtRadius(rb, rb * Math.sqrt(1 + 0.9 * 0.9));
    expect(t).toBeCloseTo(0.9, 9);
  });

  test('involute rejects a non-positive base radius', () => {
    expect(() => involute(0, 0, 1, 8)).toThrow(/baseRadius/);
  });

  test('involuteParamAtRadius rejects a radius below the base circle', () => {
    expect(() => involuteParamAtRadius(5, 4)).toThrow(/baseRadius/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/playwright test e2e/atomic-parametric-curve.spec.js --reporter=list`
Expected: FAIL — `Cannot find module '.../kernel/atomic/ParametricCurve.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/kernel/atomic/ParametricCurve.js`:

```js
/**
 * ArchDisc Kernel — Parametric Curve evaluators.
 *
 * Exact point generators for curves that need math: involute, Archimedean
 * spiral, ellipse. Each returns an array of [x, y] points. Kernel-free pure
 * math so e2e specs can import it directly in Node.
 *
 * A curve evaluator is a SKETCH-ENTITY PRIMITIVE — the same atomic level as a
 * line or an arc — not a premade part. It yields a curve, never a component.
 */

/**
 * Involute of a circle of radius `baseRadius`.
 * Parametric form: x = rb(cos t + t sin t), y = rb(sin t − t cos t).
 * Distance from the origin is rb·sqrt(1 + t²) by construction.
 *
 * @param {number} baseRadius  base circle radius (> 0)
 * @param {number} t0          start unrolling parameter
 * @param {number} t1          end unrolling parameter
 * @param {number} segments    number of segments (>= 1); returns segments+1 pts
 * @returns {Array<[number,number]>}
 */
export function involute(baseRadius, t0, t1, segments = 32) {
  if (!(baseRadius > 0)) throw new Error('involute: baseRadius must be > 0');
  if (!(segments >= 1)) throw new Error('involute: segments must be >= 1');
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const t = t0 + (t1 - t0) * (i / segments);
    pts.push([
      baseRadius * (Math.cos(t) + t * Math.sin(t)),
      baseRadius * (Math.sin(t) - t * Math.cos(t)),
    ]);
  }
  return pts;
}

/**
 * The unrolling parameter t at which the involute reaches radius `r`.
 * Inverts r = rb·sqrt(1 + t²)  ->  t = sqrt((r/rb)² − 1).
 *
 * @param {number} baseRadius  base circle radius (> 0)
 * @param {number} r           target radius (>= baseRadius)
 * @returns {number}
 */
export function involuteParamAtRadius(baseRadius, r) {
  if (!(baseRadius > 0)) throw new Error('involuteParamAtRadius: baseRadius must be > 0');
  if (r < baseRadius) throw new Error('involuteParamAtRadius: r must be >= baseRadius');
  return Math.sqrt((r / baseRadius) ** 2 - 1);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/playwright test e2e/atomic-parametric-curve.spec.js --reporter=list`
Expected: PASS — 5 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/kernel/atomic/ParametricCurve.js e2e/atomic-parametric-curve.spec.js
git commit -m "Add ParametricCurve involute evaluator (atomic-CAD L0)"
```

---

## Task 2: Add the Archimedean spiral evaluator

**Files:**
- Modify: `frontend/src/kernel/atomic/ParametricCurve.js` (append a function)
- Test: `e2e/atomic-parametric-curve.spec.js` (append a `test.describe` block)

- [ ] **Step 1: Write the failing test**

Append to `e2e/atomic-parametric-curve.spec.js` (and add `archimedeanSpiral` to the existing import line at the top so it reads
`import { involute, involuteParamAtRadius, archimedeanSpiral } from '../frontend/src/kernel/atomic/ParametricCurve.js';`):

```js
test.describe('ParametricCurve — Archimedean spiral', () => {
  test('radius grows linearly with angle: r = a + b·theta', () => {
    const a = 1, b = 0.5;
    const pts = archimedeanSpiral(a, b, 0, 4 * Math.PI, 100);
    expect(pts.length).toBe(101);
    for (let i = 0; i < pts.length; i++) {
      const th = (4 * Math.PI) * (i / 100);
      expect(Math.hypot(pts[i][0], pts[i][1])).toBeCloseTo(a + b * th, 9);
    }
  });

  test('the first point sits at radius a along the +x axis', () => {
    const pts = archimedeanSpiral(2, 0.3, 0, Math.PI, 16);
    expect(pts[0][0]).toBeCloseTo(2, 9);
    expect(pts[0][1]).toBeCloseTo(0, 9);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/playwright test e2e/atomic-parametric-curve.spec.js --reporter=list`
Expected: FAIL — `archimedeanSpiral is not a function` (or import undefined).

- [ ] **Step 3: Write minimal implementation**

Append to `frontend/src/kernel/atomic/ParametricCurve.js`:

```js
/**
 * Archimedean spiral r = a + b·θ, sampled over θ ∈ [theta0, theta1].
 * Used for hairspring profiles.
 *
 * @param {number} a         radius at θ = 0
 * @param {number} b         radial growth per radian
 * @param {number} theta0    start angle (radians)
 * @param {number} theta1    end angle (radians)
 * @param {number} segments  number of segments (>= 1); returns segments+1 pts
 * @returns {Array<[number,number]>}
 */
export function archimedeanSpiral(a, b, theta0, theta1, segments = 128) {
  if (!(segments >= 1)) throw new Error('archimedeanSpiral: segments must be >= 1');
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const th = theta0 + (theta1 - theta0) * (i / segments);
    const r = a + b * th;
    pts.push([r * Math.cos(th), r * Math.sin(th)]);
  }
  return pts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/playwright test e2e/atomic-parametric-curve.spec.js --reporter=list`
Expected: PASS — 7 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/kernel/atomic/ParametricCurve.js e2e/atomic-parametric-curve.spec.js
git commit -m "Add Archimedean spiral evaluator (atomic-CAD L0)"
```

---

## Task 3: Add the ellipse arc and circle polyline evaluators

**Files:**
- Modify: `frontend/src/kernel/atomic/ParametricCurve.js` (append two functions)
- Test: `e2e/atomic-parametric-curve.spec.js` (append a `test.describe` block)

- [ ] **Step 1: Write the failing test**

Extend the import line at the top of `e2e/atomic-parametric-curve.spec.js` to:
`import { involute, involuteParamAtRadius, archimedeanSpiral, ellipseArc, circlePolyline } from '../frontend/src/kernel/atomic/ParametricCurve.js';`

Append:

```js
test.describe('ParametricCurve — ellipse and circle', () => {
  test('ellipse arc points satisfy (x/rx)^2 + (y/ry)^2 = 1', () => {
    const rx = 3, ry = 2;
    const pts = ellipseArc(rx, ry, 0, 2 * Math.PI, 50);
    for (const [x, y] of pts) {
      expect((x / rx) ** 2 + (y / ry) ** 2).toBeCloseTo(1, 9);
    }
  });

  test('circlePolyline returns exactly `segments` non-repeating points on the circle', () => {
    const pts = circlePolyline(4, 12);
    expect(pts.length).toBe(12);
    for (const [x, y] of pts) {
      expect(Math.hypot(x, y)).toBeCloseTo(4, 9);
    }
    // first and last must NOT coincide (closed implicitly, not by duplication)
    expect(Math.hypot(pts[0][0] - pts[11][0], pts[0][1] - pts[11][1])).toBeGreaterThan(0.1);
  });

  test('circlePolyline honours a non-origin centre', () => {
    const pts = circlePolyline(1, 8, 10, -5);
    for (const [x, y] of pts) {
      expect(Math.hypot(x - 10, y - (-5))).toBeCloseTo(1, 9);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/playwright test e2e/atomic-parametric-curve.spec.js --reporter=list`
Expected: FAIL — `ellipseArc is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `frontend/src/kernel/atomic/ParametricCurve.js`:

```js
/**
 * Ellipse arc centred at the origin, semi-axes rx and ry, over [a0, a1].
 *
 * @param {number} rx        semi-axis along x (> 0)
 * @param {number} ry        semi-axis along y (> 0)
 * @param {number} a0        start angle (radians)
 * @param {number} a1        end angle (radians)
 * @param {number} segments  number of segments (>= 1); returns segments+1 pts
 * @returns {Array<[number,number]>}
 */
export function ellipseArc(rx, ry, a0, a1, segments = 64) {
  if (!(rx > 0) || !(ry > 0)) throw new Error('ellipseArc: rx and ry must be > 0');
  if (!(segments >= 1)) throw new Error('ellipseArc: segments must be >= 1');
  const pts = [];
  for (let i = 0; i <= segments; i++) {
    const a = a0 + (a1 - a0) * (i / segments);
    pts.push([rx * Math.cos(a), ry * Math.sin(a)]);
  }
  return pts;
}

/**
 * Full circle as a closed polyline of exactly `segments` points (the first
 * point is NOT repeated at the end — the loop closes implicitly).
 *
 * @param {number} radius    circle radius (> 0)
 * @param {number} segments  number of points (>= 3)
 * @param {number} cx        centre x (default 0)
 * @param {number} cy        centre y (default 0)
 * @returns {Array<[number,number]>}
 */
export function circlePolyline(radius, segments = 64, cx = 0, cy = 0) {
  if (!(radius > 0)) throw new Error('circlePolyline: radius must be > 0');
  if (!(segments >= 3)) throw new Error('circlePolyline: segments must be >= 3');
  const pts = [];
  for (let i = 0; i < segments; i++) {
    const a = (2 * Math.PI) * (i / segments);
    pts.push([cx + radius * Math.cos(a), cy + radius * Math.sin(a)]);
  }
  return pts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/playwright test e2e/atomic-parametric-curve.spec.js --reporter=list`
Expected: PASS — 10 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/kernel/atomic/ParametricCurve.js e2e/atomic-parametric-curve.spec.js
git commit -m "Add ellipse arc and circle polyline evaluators (atomic-CAD L0)"
```

---

## Task 4: `SketchProfile.js` — signed area and orientation

**Files:**
- Create: `frontend/src/kernel/atomic/SketchProfile.js`
- Test: `e2e/atomic-sketch-profile.spec.js`

- [ ] **Step 1: Write the failing test**

Create `e2e/atomic-sketch-profile.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { signedArea, isClockwise, orient } from '../frontend/src/kernel/atomic/SketchProfile.js';

const UNIT_CCW = [[0, 0], [1, 0], [1, 1], [0, 1]];          // counter-clockwise unit square
const UNIT_CW = [[0, 0], [0, 1], [1, 1], [1, 0]];           // clockwise unit square

test.describe('SketchProfile — area and orientation', () => {
  test('signedArea is +1 for a CCW unit square, -1 for a CW one', () => {
    expect(signedArea(UNIT_CCW)).toBeCloseTo(1, 9);
    expect(signedArea(UNIT_CW)).toBeCloseTo(-1, 9);
  });

  test('isClockwise distinguishes the two windings', () => {
    expect(isClockwise(UNIT_CCW)).toBe(false);
    expect(isClockwise(UNIT_CW)).toBe(true);
  });

  test('orient(poly, true) returns a CCW polygon regardless of input winding', () => {
    expect(isClockwise(orient(UNIT_CW, true))).toBe(false);
    expect(isClockwise(orient(UNIT_CCW, true))).toBe(false);
  });

  test('orient(poly, false) returns a CW polygon regardless of input winding', () => {
    expect(isClockwise(orient(UNIT_CW, false))).toBe(true);
    expect(isClockwise(orient(UNIT_CCW, false))).toBe(true);
  });

  test('orient does not mutate the input array', () => {
    const input = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const copy = JSON.stringify(input);
    orient(input, false);
    expect(JSON.stringify(input)).toBe(copy);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/playwright test e2e/atomic-sketch-profile.spec.js --reporter=list`
Expected: FAIL — `Cannot find module '.../kernel/atomic/SketchProfile.js'`.

- [ ] **Step 3: Write minimal implementation**

Create `frontend/src/kernel/atomic/SketchProfile.js`:

```js
/**
 * ArchDisc Kernel — Sketch Profile extraction.
 *
 * Turns sketch geometry into closed, correctly-oriented 2-D loops ready to
 * feed a feature operation (extrude, cut, revolve). Kernel-free pure math.
 *
 * Convention: an outer boundary is counter-clockwise (CCW, positive signed
 * area); a hole is clockwise (CW). This matches manifold-3d's
 * CrossSection.ofPolygons([outerCCW, ...holesCW]).
 */

/**
 * Signed area of a closed polygon via the shoelace formula.
 * Positive for counter-clockwise winding, negative for clockwise.
 *
 * @param {Array<[number,number]>} poly  polygon vertices (no repeated first pt)
 * @returns {number}
 */
export function signedArea(poly) {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/**
 * @param {Array<[number,number]>} poly
 * @returns {boolean} true if the polygon is wound clockwise
 */
export function isClockwise(poly) {
  return signedArea(poly) < 0;
}

/**
 * Return a copy of `poly` wound in the requested direction. Never mutates
 * the input.
 *
 * @param {Array<[number,number]>} poly
 * @param {boolean} ccw  true -> counter-clockwise, false -> clockwise
 * @returns {Array<[number,number]>}
 */
export function orient(poly, ccw = true) {
  const cw = isClockwise(poly);
  const needsReverse = (ccw && cw) || (!ccw && !cw);
  return needsReverse ? [...poly].reverse() : [...poly];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/playwright test e2e/atomic-sketch-profile.spec.js --reporter=list`
Expected: PASS — 5 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/kernel/atomic/SketchProfile.js e2e/atomic-sketch-profile.spec.js
git commit -m "Add SketchProfile signed-area and orientation helpers (atomic-CAD L0)"
```

---

## Task 5: `SketchProfile.chainLoops` — chain loose segments into closed loops

**Files:**
- Modify: `frontend/src/kernel/atomic/SketchProfile.js` (append a function)
- Test: `e2e/atomic-sketch-profile.spec.js` (append a `test.describe` block)

- [ ] **Step 1: Write the failing test**

Extend the import line at the top of `e2e/atomic-sketch-profile.spec.js` to:
`import { signedArea, isClockwise, orient, chainLoops } from '../frontend/src/kernel/atomic/SketchProfile.js';`

Append:

```js
test.describe('SketchProfile — chainLoops', () => {
  test('four segments given in shuffled order chain into one 4-point loop', () => {
    // unit square segments, deliberately out of order and with mixed direction
    const segs = [
      [[1, 1], [1, 0]],   // right edge, pointing down
      [[0, 0], [1, 0]],   // bottom edge, pointing right
      [[0, 1], [0, 0]],   // left edge, pointing down
      [[1, 1], [0, 1]],   // top edge, pointing left
    ];
    const loops = chainLoops(segs);
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBe(4);
    // the loop encloses the unit square -> |area| == 1
    expect(Math.abs(signedArea(loops[0]))).toBeCloseTo(1, 9);
  });

  test('two disjoint triangles chain into two separate loops', () => {
    const segs = [
      [[0, 0], [2, 0]], [[2, 0], [1, 2]], [[1, 2], [0, 0]],         // triangle A
      [[10, 0], [12, 0]], [[12, 0], [11, 2]], [[11, 2], [10, 0]],   // triangle B
    ];
    const loops = chainLoops(segs);
    expect(loops.length).toBe(2);
    expect(loops[0].length).toBe(3);
    expect(loops[1].length).toBe(3);
  });

  test('an open chain that cannot close throws', () => {
    const segs = [
      [[0, 0], [1, 0]],
      [[1, 0], [1, 1]],   // ends at (1,1) with no segment back to (0,0)
    ];
    expect(() => chainLoops(segs)).toThrow(/open chain/);
  });

  test('endpoints within tolerance are treated as coincident', () => {
    const segs = [
      [[0, 0], [1, 0]],
      [[1.0000001, 0], [1, 1]],   // start is 1e-7 off the previous end
      [[1, 1], [0, 0]],
    ];
    const loops = chainLoops(segs, 1e-5);
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBe(3);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/playwright test e2e/atomic-sketch-profile.spec.js --reporter=list`
Expected: FAIL — `chainLoops is not a function`.

- [ ] **Step 3: Write minimal implementation**

Append to `frontend/src/kernel/atomic/SketchProfile.js`:

```js
/**
 * Chain a set of loose line segments into closed loops.
 *
 * Each segment is `[[x1,y1],[x2,y2]]`. Segments may be supplied in any order
 * and any direction; chaining walks endpoint-to-endpoint, treating endpoints
 * closer than `tol` as coincident. Every segment must belong to exactly one
 * closed loop or the function throws.
 *
 * @param {Array<[[number,number],[number,number]]>} segments
 * @param {number} tol  endpoint coincidence tolerance (default 1e-6)
 * @returns {Array<Array<[number,number]>>}  closed loops; each loop is a list
 *          of vertices with NO repeated first/last point
 */
export function chainLoops(segments, tol = 1e-6) {
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= tol;
  const pool = segments.map((s) => ({ a: s[0], b: s[1], used: false }));
  const loops = [];

  for (let start = 0; start < pool.length; start++) {
    if (pool[start].used) continue;
    pool[start].used = true;

    const loopStart = pool[start].a;
    const loop = [pool[start].a, pool[start].b];
    let tail = pool[start].b;

    while (true) {
      if (loop.length >= 3 && near(tail, loopStart)) break;  // closed

      let advanced = false;
      for (const seg of pool) {
        if (seg.used) continue;
        if (near(seg.a, tail)) { seg.used = true; tail = seg.b; advanced = true; break; }
        if (near(seg.b, tail)) { seg.used = true; tail = seg.a; advanced = true; break; }
      }
      if (!advanced) throw new Error('chainLoops: open chain — cannot close loop');
      loop.push(tail);
    }

    loop.pop();   // final vertex duplicates loopStart — drop it
    loops.push(loop);
  }

  return loops;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `./node_modules/.bin/playwright test e2e/atomic-sketch-profile.spec.js --reporter=list`
Expected: PASS — 9 passed.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/kernel/atomic/SketchProfile.js e2e/atomic-sketch-profile.spec.js
git commit -m "Add SketchProfile.chainLoops segment chaining (atomic-CAD L0)"
```

---

## Task 6: Cross-module integration test — a sculpted involute tooth profile

This proves the two modules compose into a real, closed, oriented gear-tooth
profile — the geometry an atomic Spur-Gear sculpt will rely on — without any
generator function.

**Files:**
- Test: `e2e/atomic-tooth-profile.spec.js` (new)

- [ ] **Step 1: Write the failing test**

Create `e2e/atomic-tooth-profile.spec.js`:

```js
import { test, expect } from '@playwright/test';
import { involute, involuteParamAtRadius } from '../frontend/src/kernel/atomic/ParametricCurve.js';
import { chainLoops, signedArea, orient } from '../frontend/src/kernel/atomic/SketchProfile.js';

/*
 * Build ONE involute gear-tooth flank pair as a closed profile by composing
 * the L0 primitives — the way the atomic sculptor will, with NO generator:
 *   - one involute flank from base circle to tip,
 *   - the mirror flank,
 *   - a tip segment and a root segment closing the loop.
 */
test('two involute flanks + tip + root chain into one closed CCW tooth loop', () => {
  const baseR = 9.4;          // base circle radius (mm)
  const tipR = 11.0;          // addendum (tip) radius (mm)
  const tEnd = involuteParamAtRadius(baseR, tipR);

  const flankA = involute(baseR, 0, tEnd, 12);
  // mirror flank across the x-axis, reversed so directions chain head-to-tail
  const flankB = flankA.map(([x, y]) => [x, -y]).reverse();

  // segments: flank A, tip (A_end -> B_start), flank B, root (B_end -> A_start)
  const segs = [];
  for (let i = 0; i < flankA.length - 1; i++) segs.push([flankA[i], flankA[i + 1]]);
  segs.push([flankA[flankA.length - 1], flankB[0]]);
  for (let i = 0; i < flankB.length - 1; i++) segs.push([flankB[i], flankB[i + 1]]);
  segs.push([flankB[flankB.length - 1], flankA[0]]);

  const loops = chainLoops(segs, 1e-6);
  expect(loops.length).toBe(1);

  const tooth = orient(loops[0], true);   // outer boundary -> CCW
  expect(signedArea(tooth)).toBeGreaterThan(0);

  // every vertex sits between the base circle and the tip circle (± tol)
  for (const [x, y] of tooth) {
    const r = Math.hypot(x, y);
    expect(r).toBeGreaterThanOrEqual(baseR - 1e-6);
    expect(r).toBeLessThanOrEqual(tipR + 1e-6);
  }
  console.log(`  sculpted tooth loop: ${tooth.length} pts, area ${signedArea(tooth).toFixed(4)} mm^2`);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `./node_modules/.bin/playwright test e2e/atomic-tooth-profile.spec.js --reporter=list`
Expected: FAIL initially only if a module path is wrong; if Tasks 1–5 are done it should PASS immediately. If it FAILS for a logic reason, fix the **test**, not the modules — the modules are already covered. (This task adds no production code; it is a composition guard.)

- [ ] **Step 3: (no implementation — composition test only)**

This task intentionally writes no production code. If Step 2 passed, proceed.

- [ ] **Step 4: Run the full atomic suite to verify nothing regressed**

Run: `./node_modules/.bin/playwright test e2e/atomic-parametric-curve.spec.js e2e/atomic-sketch-profile.spec.js e2e/atomic-tooth-profile.spec.js --reporter=list`
Expected: PASS — 20 passed.

- [ ] **Step 5: Commit**

```bash
git add e2e/atomic-tooth-profile.spec.js
git commit -m "Add cross-module test — sculpted involute tooth profile (atomic-CAD L0)"
```

---

## Self-Review

**Spec coverage:** This plan covers the `ParametricCurve.js` and the
profile-extraction portion of `SketchProfile.js` from spec section L0. The
remaining L0 surface (`AtomicOps.js`, `Part.js`, `TopoNaming.js`,
`FeatureTree.js` extension, `ToolExecutionEngine.js` rewrite) and L1
(`GeometryQuery.js`) are explicitly **out of scope here** — see "Subsequent
Plans" below. No spec requirement assigned to *this* plan is left without a task.

**Placeholder scan:** No `TBD` / `TODO` / "add error handling" placeholders.
Every code step shows complete code; every test step shows complete tests.

**Type consistency:** Function names are consistent across tasks and tests —
`involute`, `involuteParamAtRadius`, `archimedeanSpiral`, `ellipseArc`,
`circlePolyline` (ParametricCurve); `signedArea`, `isClockwise`, `orient`,
`chainLoops` (SketchProfile). `chainLoops` returns loops with no repeated
first/last vertex; `signedArea` assumes exactly that convention — consistent.
Point representation is `[x, y]` arrays throughout.

---

## Subsequent Plans (build order — written when each predecessor lands)

These are **not** part of this plan; listed so the engineer sees the arc.

- **Plan 2 — L0 feature pipeline.** `Part.js`, `AtomicOps.js` (sketch context,
  entities, constraints via `SketchSolver`, `finishSketch`, extrude/cut/revolve
  through manifold-3d), `FeatureTree.js` extension (sketch/cut/pattern feature
  types). Deliverable: a script can sculpt a real bracket and read it back.
- **Plan 3 — L0 reference system + tool wiring.** `TopoNaming.js`, the
  `ToolExecutionEngine.js` rewrite replacing the canned sketch/extrude stubs.
- **Plan 4 — L1 introspection.** `GeometryQuery.js`.
- **Plan 5 — L2/L3 AI Sculptor + verification.** `PartSculptor.js`,
  `PartVerifier.js`.
- **Plan 6 — L4/L5/L6 assembly, dynamics, render.**
- **Plan 7 — L7 orchestration + clarifying-MCQ swarm + closing loop.**
