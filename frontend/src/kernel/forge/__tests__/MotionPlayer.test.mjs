// MotionPlayer (Forge-12b) — headless test against a stub Three.js mesh.

import assert from 'node:assert/strict';
import { MotionPlayer, samplePalette } from '../MotionPlayer.js';

// ---------------------------------------------------------- stub Three.js
//
// Minimum surface MotionPlayer needs: BufferAttribute with `.array`,
// `.needsUpdate`, and `.count`.
class StubBufferAttribute {
  constructor(arr, itemSize) {
    this.array = arr;
    this.itemSize = itemSize;
    this.count = arr.length / itemSize;
    this.needsUpdate = false;
  }
}
const THREE = { BufferAttribute: StubBufferAttribute };

function makeStubMesh(N) {
  const pos = new Float32Array(3 * N);
  for (let i = 0; i < N; i++) {
    pos[3*i    ] = i * 0.01;
    pos[3*i + 1] = 0;
    pos[3*i + 2] = 0;
  }
  return {
    geometry: {
      attributes: {
        position: new StubBufferAttribute(pos, 3),
      },
    },
  };
}

// Fake clock so we can drive the player deterministically.
function makeFakeClock() {
  let now = 0;
  return {
    advance: (ms) => { now += ms; },
    set:     (ms) => { now = ms; },
    now:     () => now,
  };
}

// ---- 5-frame ramp on 4 vertices -------------------------------------
{
  const N = 4;
  const mesh = makeStubMesh(N);
  const nFrames = 5;
  const frames = [];
  const scalarFrames = [];
  for (let f = 0; f < nFrames; f++) {
    const d = new Float64Array(3 * N);
    const s = new Float32Array(N);
    for (let v = 0; v < N; v++) {
      // Each frame shifts every vertex by +0.01·f in y.
      d[3*v + 1] = 0.01 * f;
      s[v] = f / (nFrames - 1); // 0..1 ramp
    }
    frames.push(d);
    scalarFrames.push(s);
  }
  const times = [0, 0.1, 0.2, 0.3, 0.4]; // seconds

  const calls = [];
  const clock = makeFakeClock();
  const mp = new MotionPlayer({
    baseMesh: mesh, frames, scalarFrames, times,
    onFrame: (e) => calls.push(e),
    three: THREE,
    clock,
  });

  // play() starts the loop; we drive it manually via tick().
  mp.play({ speed: 1, loop: false });

  // 5 ticks of 100 ms each = 500 ms of simulated time, covering 0 → 0.4 s.
  for (let i = 0; i < 5; i++) {
    mp.tick(100);
  }

  // Five onFrame events recorded.
  assert.equal(calls.length, 5, `expected 5 onFrame calls, got ${calls.length}`);
  // t is monotonically non-decreasing.
  for (let i = 1; i < calls.length; i++) {
    assert.ok(calls[i].t >= calls[i - 1].t,
      `t not monotonic: calls[${i - 1}].t=${calls[i - 1].t}, calls[${i}].t=${calls[i].t}`);
  }
  // displacementScale honoured (default 1) in onFrame payload.
  assert.equal(calls[0].displacementScale, 1);
  // The final tick should land at or past the last frame time.
  assert.ok(calls[4].t >= 0.39, `final t=${calls[4].t} < 0.39 s`);

  // Position attribute mutated — vertex 0's y should equal the rest position
  // plus the interpolated displacement at the final time.
  const finalY = mesh.geometry.attributes.position.array[1];
  assert.ok(Math.abs(finalY - 0.04) < 1e-3,
    `final vertex 0 y = ${finalY}, expected ≈ 0.04 (rest 0 + frame 4 displacement 0.04)`);
  assert.equal(mesh.geometry.attributes.position.needsUpdate, true,
    'position.needsUpdate must be true after tick');

  // Color attribute auto-created and updated.
  const colorAttr = mesh.geometry.attributes.color;
  assert.ok(colorAttr, 'color attribute should be auto-created');
  assert.equal(colorAttr.itemSize, 3);
  assert.equal(colorAttr.needsUpdate, true);
}

// ---- setExaggeration scales displacement -----------------------------
{
  const N = 2;
  const mesh = makeStubMesh(N);
  const frames = [
    new Float64Array([0, 0, 0,   0, 0, 0]),
    new Float64Array([0, 0.01, 0,  0, 0.02, 0]),
  ];
  const mp = new MotionPlayer({
    baseMesh: mesh, frames, three: THREE,
    clock: makeFakeClock(),
  });
  mp.seek(1); // last frame
  // Without exaggeration, vertex 0's y rises 0.01.
  let v0y = mesh.geometry.attributes.position.array[1];
  assert.ok(Math.abs(v0y - 0.01) < 1e-6, `expected 0.01, got ${v0y}`);
  mp.setExaggeration(50);
  v0y = mesh.geometry.attributes.position.array[1];
  assert.ok(Math.abs(v0y - 0.5) < 1e-6,
    `with 50× exaggeration expected 0.5, got ${v0y}`);
}

// ---- seek() before play() doesn't crash -------------------------------
{
  const N = 1;
  const mesh = makeStubMesh(N);
  const frames = [
    new Float64Array([0, 0, 0]),
    new Float64Array([0.1, 0, 0]),
  ];
  const mp = new MotionPlayer({ baseMesh: mesh, frames, three: THREE });
  mp.seek(0.5);
  assert.ok(Math.abs(mp.currentTime() - 0.5) < 1e-9);
}

// ---- bad inputs throw clear errors -----------------------------------
{
  assert.throws(() => new MotionPlayer({ baseMesh: null, frames: [] }),
    /baseMesh requires/);
  const mesh = makeStubMesh(1);
  assert.throws(() => new MotionPlayer({ baseMesh: mesh, frames: [] }),
    /≥ 2/);
  assert.throws(() => new MotionPlayer({
    baseMesh: mesh,
    frames: [new Float64Array([0,0,0]), new Float64Array([0,0])], // wrong length
  }), /each frame must be/);
}

// ---- viridis palette monotonic luminance check -----------------------
{
  const c0 = samplePalette('viridis', 0);
  const cMid = samplePalette('viridis', 0.5);
  const c1 = samplePalette('viridis', 1);
  // Viridis goes dark blue → green → yellow; green channel rises monotonically.
  assert.ok(c1[1] > cMid[1] && cMid[1] > c0[1],
    `viridis green channel not monotonic: ${c0[1]} → ${cMid[1]} → ${c1[1]}`);
  // Plasma fallback still defined.
  assert.ok(samplePalette('plasma', 0.5).length === 3);
  // Unknown palette fallback to viridis.
  assert.deepEqual(samplePalette('nope', 0.5), cMid);
}

console.log('[forge.MotionPlayer] all tests passed');
