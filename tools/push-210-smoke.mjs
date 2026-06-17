// Headless smoke test for surfaceFairingMath (PUSH-210).
//
// Confirms the Pinkall & Polthier 1993 cotangent Laplacian assembler,
// Taubin λ/μ smoother and bi-Laplace conjugate-gradient solver actually
// reduce bending energy on a noisy sphere while pinning boundary
// vertices on the hole variant.
//
// Run: node tools/push-210-smoke.mjs

import {
  makeTestSphere,
  makeTestSphereWithHole,
  makeBufferGeometryLike,
  runFairing,
  assembleCotangentLaplacian,
  bendingEnergy,
} from '../frontend/src/forge-v4/surfaceFairingMath.js';

let pass = 0, fail = 0;
function check(label, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${label}${detail ? `   ${detail}` : ''}`);
  } else {
    fail += 1;
    console.log(`  FAIL  ${label}${detail ? `   ${detail}` : ''}`);
  }
}

console.log('=== Closed noisy sphere (Taubin) ===');
const noisy = makeTestSphere({ R: 25, divisions: 3, noiseAmp: 2.0, noiseSeed: 42 });
const closedGeom = makeBufferGeometryLike(noisy.positions, noisy.indices);
const closedLap = assembleCotangentLaplacian(noisy.positions, noisy.indices);
const closedBdy = Array.from(closedLap.boundaryMask).reduce((a, v) => a + v, 0);
check('closed sphere has zero boundary', closedBdy === 0,
  `count=${closedBdy}`);

const taubin = runFairing(closedGeom, {
  mode: 'smooth', iterations: 20, lambda: 0.6, mu: -0.63,
});
check('Taubin ok', taubin.ok, `reason=${taubin.reason || 'n/a'}`);
check('preEnergy positive', taubin.preEnergy > 0,
  `preE=${taubin.preEnergy.toExponential(3)}`);
check('postEnergy < preEnergy', taubin.postEnergy < taubin.preEnergy,
  `preE=${taubin.preEnergy.toExponential(3)} postE=${taubin.postEnergy.toExponential(3)}`);
check('Taubin reduction > 30 %', taubin.energyReductionPct > 30,
  `red=${taubin.energyReductionPct.toFixed(2)}%`);
check('boundary count on closed = 0', taubin.boundaryCount === 0);
check('max boundary disp (closed) = 0', taubin.maxBoundaryDisplacement === 0);

console.log('\n=== Hole-cut noisy sphere ===');
const hole = makeTestSphereWithHole({
  R: 25, divisions: 3, holeFraction: 0.4, noiseAmp: 0.5, noiseSeed: 17,
});
const holeGeom = makeBufferGeometryLike(hole.positions, hole.indices);
const holeLap = assembleCotangentLaplacian(hole.positions, hole.indices);
const holeBdy = Array.from(holeLap.boundaryMask).reduce((a, v) => a + v, 0);
check('hole variant has boundary vertices', holeBdy > 0, `count=${holeBdy}`);

const holeTaubin = runFairing(holeGeom, {
  mode: 'smooth', iterations: 3, lambda: 0.6, mu: -0.63,
});
check('hole Taubin ok', holeTaubin.ok);
check('hole Taubin: maxBoundaryDisp = 0', holeTaubin.maxBoundaryDisplacement <= 1e-9,
  `bdyDisp=${holeTaubin.maxBoundaryDisplacement.toExponential(3)}`);

const holeFair = runFairing(holeGeom, {
  mode: 'fair', iterations: 3, epsilon: 1e-2,
});
check('hole bi-Laplace ok', holeFair.ok);
check('hole bi-Laplace: maxBoundaryDisp = 0', holeFair.maxBoundaryDisplacement <= 1e-9,
  `bdyDisp=${holeFair.maxBoundaryDisplacement.toExponential(3)}`);
check('hole bi-Laplace preE positive', holeFair.preEnergy > 0,
  `preE=${holeFair.preEnergy.toExponential(3)}`);
check('hole bi-Laplace: energy did not blow up',
  holeFair.postEnergy < holeFair.preEnergy * 1.001,
  `redPct=${holeFair.energyReductionPct.toFixed(2)}%`);

console.log(`\nResult: ${pass} pass · ${fail} fail`);
if (fail > 0) {
  process.exit(1);
}
