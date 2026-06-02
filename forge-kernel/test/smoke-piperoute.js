// Forge-206 — pipe routing smoke.

const kernel = require('../build/Release/forge-kernel.node');
const pr = kernel.piperoute;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };

// (1) Direct route, no obstacles. Start at (0,0,0)+X, end at (10,0,0)+X.
//     Single straight run, length = 10, 0 elbows.
let r = pr.route({
  start: { position: [0, 0, 0],  direction: [1, 0, 0] },
  end:   { position: [10, 0, 0], direction: [1, 0, 0] },
  obstacles: [],
  gridSpacing: 1.0,
  elbowPenalty: 0.5,
  bbMargin: 4.0,
  maxIterations: 50000,
});
ck(r.found === true, `direct route found`);
ck(Math.abs(r.totalLength - 10) < 1e-6, `direct route length ${r.totalLength}`);
ck(r.elbowCount === 0, `direct route elbows ${r.elbowCount}`);

// (2) L-shape: start at (0,0,0), end at (5,5,0). With elbow penalty 0,
//     L should be 10 with 1 elbow.
r = pr.route({
  start: { position: [0, 0, 0], direction: [1, 0, 0] },
  end:   { position: [5, 5, 0], direction: [0, 1, 0] },
  obstacles: [],
  gridSpacing: 1.0,
  elbowPenalty: 0.5,
  bbMargin: 4.0,
  maxIterations: 50000,
});
ck(r.found === true, `L route found`);
ck(Math.abs(r.totalLength - 10) < 1e-6, `L route length ${r.totalLength}`);
ck(r.elbowCount === 1, `L route elbows ${r.elbowCount}`);

// (3) Obstacle in the way: a box from (3,-2,-2) → (7,2,2). Forces a detour.
r = pr.route({
  start: { position: [0, 0, 0],  direction: [1, 0, 0] },
  end:   { position: [10, 0, 0], direction: [1, 0, 0] },
  obstacles: [{ min: [3, -2, -2], max: [7, 2, 2] }],
  gridSpacing: 1.0,
  elbowPenalty: 0.5,
  bbMargin: 6.0,
  maxIterations: 200000,
});
ck(r.found === true, `obstacle route found`);
ck(r.totalLength > 10, `detour longer than direct (got ${r.totalLength})`);
ck(r.elbowCount >= 2, `detour has ≥2 elbows (got ${r.elbowCount})`);

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-206 pipe routing smoke: OK');
console.log(`  direct: L=${r.totalLength.toFixed(2)} elbows=${r.elbowCount}`);
console.log(`  iter used (detour): ${r.iterationsUsed}`);
