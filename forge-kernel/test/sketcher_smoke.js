// forge-kernel sketcher smoke test — exercises the planegcs binding.
//
// Scenario 1 (consistent):
//   Two points at (0,0) and (3,4); add a Distance constraint of value 10
//   between them. Initially the distance is 5. Move p1 to (1,1) so it's
//   even further off, then solve. After solve the distance must be 10
//   (± 1e-6) and the solver must return Success.
//
// Scenario 2 (inconsistent):
//   Two points coincident-constrained AND a distance constraint of 10
//   between them. That's impossible. Verify the solver returns
//   `Inconsistent` rather than crashing the process.
//
// Both scenarios exit non-zero on failure so the CI loop can gate on it.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');

let forge;
try {
  forge = require(KERNEL);
} catch (e) {
  console.error(`[sketcher-smoke] failed to load ${KERNEL}: ${e.message}`);
  process.exit(1);
}

assert.ok(forge.sketcher, 'forge.sketcher namespace missing');
const sk = forge.sketcher;
console.log('[sketcher-smoke] kinds =', sk.kinds);
console.log('[sketcher-smoke] statuses =', sk.statuses);

function distance(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  return Math.sqrt(dx*dx + dy*dy);
}

// ---------------------------------- scenario 1: Distance constraint
{
  const before = sk.liveCount();
  const h = sk.createSketch();
  assert.ok(typeof h === 'number' && h > 0, 'createSketch should yield positive handle');
  assert.strictEqual(sk.liveCount(), before + 1, 'liveCount should bump after createSketch');

  const p0 = sk.addPoint(h, 0, 0);
  const p1 = sk.addPoint(h, 3, 4);
  const p0r = sk.readPoint(h, p0);
  const p1r = sk.readPoint(h, p1);
  assert.strictEqual(Math.abs(distance(p0r, p1r) - 5) < 1e-12, true,
    'initial distance should be 5');

  const tag = sk.addConstraint(h, sk.kinds.Distance, [p0, p1], 10);
  assert.ok(typeof tag === 'number', 'addConstraint should return tag id');

  // Move p1 to (1,1) so the solver has actual work to do.
  sk.writePoint(h, p1, 1, 1);
  const before1 = sk.readPoint(h, p1);
  assert.ok(Math.abs(before1.x - 1) < 1e-12 && Math.abs(before1.y - 1) < 1e-12,
    'writePoint should update p1 immediately');

  const r = sk.solve(h);
  console.log('[sketcher-smoke] s1 solve →', r);
  assert.strictEqual(r.status, sk.statuses.Success,
    `solve(s1) should be Success, got ${r.status}`);

  const a = sk.readPoint(h, p0);
  const b = sk.readPoint(h, p1);
  const d = distance(a, b);
  console.log('[sketcher-smoke] s1 post-solve distance =', d);
  assert.ok(Math.abs(d - 10) < 1e-6,
    `post-solve distance should be 10 ± 1e-6, got ${d}`);

  sk.destroySketch(h);
  assert.strictEqual(sk.liveCount(), before,
    'destroySketch should drop liveCount back to baseline');
}

// ---------------------------------- scenario 2: inconsistent system
{
  const h = sk.createSketch();
  const p0 = sk.addPoint(h, 0, 0);
  const p1 = sk.addPoint(h, 1, 0);
  // Coincident AND Distance=10 — impossible.
  sk.addConstraint(h, sk.kinds.Coincident, [p0, p1], 0);
  sk.addConstraint(h, sk.kinds.Distance,   [p0, p1], 10);

  const r = sk.solve(h);
  console.log('[sketcher-smoke] s2 solve →', r);
  assert.notStrictEqual(r.status, sk.statuses.Success,
    'over-constrained sketch must not report Success');
  assert.strictEqual(r.status, sk.statuses.Inconsistent,
    `expected Inconsistent, got ${r.status}`);

  sk.destroySketch(h);
}

// ---------------------------------- scenario 3: lines + parallel + horizontal
// Build a quick rectangle frame: 4 corners + 4 lines, constrain bottom and
// top to be parallel and bottom to be horizontal. Verify solver succeeds.
{
  const h = sk.createSketch();
  const A = sk.addPoint(h, 0, 0);
  const B = sk.addPoint(h, 10, 0.5);  // slightly off horizontal
  const C = sk.addPoint(h, 10, 6);
  const D = sk.addPoint(h, 0, 6.1);

  const bot = sk.addLine(h, A, B);
  const top = sk.addLine(h, D, C);
  sk.addConstraint(h, sk.kinds.Horizontal, [bot], 0);
  sk.addConstraint(h, sk.kinds.Parallel,   [bot, top], 0);

  const r = sk.solve(h);
  console.log('[sketcher-smoke] s3 solve →', r);
  assert.strictEqual(r.status, sk.statuses.Success,
    `solve(s3) should be Success, got ${r.status}`);

  const a = sk.readPoint(h, A);
  const b = sk.readPoint(h, B);
  assert.ok(Math.abs(a.y - b.y) < 1e-6,
    `bottom line should be horizontal post-solve; got Ay=${a.y} By=${b.y}`);

  sk.destroySketch(h);
}

console.log('[sketcher-smoke] ALL PASS');
