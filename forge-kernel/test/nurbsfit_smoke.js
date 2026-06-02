// forge-kernel NURBS fit smoke (Forge-194).
// Fit a known synthetic surface, verify residuals collapse.

const path = require('path');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.nurbsfit && typeof forge.nurbsfit.fitSurface === 'function',
          'forge.nurbsfit.fitSurface missing');

// 1. Flat plane z = 0.3·x + 0.2·y + 1.0 over [0,4]² with 16×16 grid.
{
  const pts = [];
  for (let j = 0; j < 16; ++j) {
    for (let i = 0; i < 16; ++i) {
      const x = i / 15 * 4;
      const y = j / 15 * 4;
      const z = 0.3 * x + 0.2 * y + 1.0;
      pts.push(x, y, z);
    }
  }
  const r = forge.nurbsfit.fitSurface({
    points: new Float64Array(pts),
    uCount: 5, vCount: 5,
  });
  assert.strictEqual(r.uCount, 5);
  assert.strictEqual(r.vCount, 5);
  assert.strictEqual(r.controlZ.length, 25);
  assert.ok(r.maxAbsResidual < 1e-9,
            `flat plane fit max residual ${r.maxAbsResidual} should be ~0`);
  assert.ok(r.rmsResidual < 1e-9,
            `flat plane fit RMS ${r.rmsResidual} should be ~0`);
}

// 2. Gaussian hill: needs a higher-degree control net for good fit.
{
  const pts = [];
  const N = 20;
  for (let j = 0; j < N; ++j) {
    for (let i = 0; i < N; ++i) {
      const x = i / (N - 1) * 8 - 4;
      const y = j / (N - 1) * 8 - 4;
      const z = 3 * Math.exp(-(x * x + y * y) / 8);
      pts.push(x, y, z);
    }
  }
  // 7×7 control net → 49 CPs vs 400 samples.
  const r = forge.nurbsfit.fitSurface({
    points: new Float64Array(pts),
    uCount: 7, vCount: 7,
  });
  assert.ok(r.rmsResidual < 0.2,
            `Gaussian fit RMS ${r.rmsResidual.toFixed(4)} should be small`);
  assert.ok(r.maxAbsResidual < 0.5,
            `Gaussian fit max residual ${r.maxAbsResidual.toFixed(3)} should be < 0.5`);
}

// 3. Noisy plane: fit should be close to the noiseless plane.
{
  const pts = [];
  let seed = 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff;
                      return (seed % 1000) / 1000 - 0.5; };
  for (let j = 0; j < 20; ++j) {
    for (let i = 0; i < 20; ++i) {
      const x = i / 19 * 5;
      const y = j / 19 * 5;
      const z = 0.5 * x + 0.3 * y + 1.0 + 0.05 * rnd();
      pts.push(x, y, z);
    }
  }
  const r = forge.nurbsfit.fitSurface({
    points: new Float64Array(pts),
    uCount: 4, vCount: 4,
  });
  // RMS should be in the noise band (~ 0.05/√3 = 0.029 for uniform).
  assert.ok(r.rmsResidual < 0.05,
            `noisy plane RMS ${r.rmsResidual.toFixed(4)} should be ≤ noise band`);
}

console.log('✅ NURBS fit smoke PASSED');
console.log(`   linear plane z = 0.3x + 0.2y + 1.0    → max |r| < 1e-9 (exact)`);
console.log(`   Gaussian hill (20×20, 7×7 CPs)         → RMS < 0.2 of 3 m peak`);
console.log(`   noisy plane (5 cm uniform jitter)      → RMS in noise band`);
