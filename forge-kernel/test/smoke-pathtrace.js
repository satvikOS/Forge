// Forge-203 — path tracer preview smoke.
//
// Renders a single quad (a floor) lit from above and checks that the
// centre pixel is the floor's diffuse colour times the sun term, and
// the edge pixels are background.

const kernel = require('../build/Release/forge-kernel.node');
const pt = kernel.pathtrace;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };

// Single floor quad at Z=0, 20×20 mm centred at origin, normal +Z.
const mesh = {
  positions: new Float32Array([
    -10, -10, 0,
     10, -10, 0,
     10,  10, 0,
    -10,  10, 0,
  ]),
  normals: new Float32Array([
    0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
  ]),
  indices: new Uint32Array([0, 1, 2,  0, 2, 3]),
  materialIds: new Uint32Array([0, 0]),
  materials: [
    { albedo: [0.8, 0.6, 0.4], emission: [0, 0, 0] },
  ],
};

const camera = {
  position: [0, 0, 30],
  lookAt:   [0, 0, 0],
  up:       [0, 1, 0],
  fovYDegrees: 45,
};

const sun = {
  direction: [0, 0, 1],
  colour:    [1, 1, 1],
};

const r = pt.render({
  mesh, camera, sun,
  ambient: [0.05, 0.05, 0.05],
  background: [0.01, 0.02, 0.03],
  width: 32, height: 32,
  aoSamples: 4, aoStrength: 0.0,        // disable AO for the smoke
  aoMaxDistance: 1e6,
  randomSeed: 1234,
});

ck(r.width === 32 && r.height === 32, `dims ${r.width}×${r.height}`);
ck(r.rgb.length === 32 * 32 * 3, `rgb length ${r.rgb.length}`);
ck(r.rayCount > 0, `rayCount ${r.rayCount}`);
ck(r.elapsedSec > 0 && r.elapsedSec < 30, `elapsed ${r.elapsedSec}`);

// Centre pixel should hit the floor and be roughly the albedo * (ambient + nDotL).
// nDotL with sun pointing +Z and normal +Z = 1.
// Centre col_R ≈ 0.8 * (0.05 + 1·1) = 0.84
const cx = 16, cy = 16;
const idxC = (cy * 32 + cx) * 3;
ck(Math.abs(r.rgb[idxC + 0] - 0.84) < 0.05, `centre R ${r.rgb[idxC+0]}`);

// Edge pixel (0,0) should be background (the camera misses the floor at the corners).
const idxE = 0;
ck(Math.abs(r.rgb[idxE + 0] - 0.01) < 0.01, `edge R ${r.rgb[idxE+0]}`);
ck(Math.abs(r.rgb[idxE + 2] - 0.03) < 0.01, `edge B ${r.rgb[idxE+2]}`);

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-203 path tracer smoke: OK');
console.log(`  ${r.width}×${r.height}px, ${r.rayCount} rays, ${r.elapsedSec.toFixed(3)}s`);
console.log(`  centre RGB = (${r.rgb[idxC+0].toFixed(3)}, ${r.rgb[idxC+1].toFixed(3)}, ${r.rgb[idxC+2].toFixed(3)})`);
console.log(`  edge   RGB = (${r.rgb[idxE+0].toFixed(3)}, ${r.rgb[idxE+1].toFixed(3)}, ${r.rgb[idxE+2].toFixed(3)})`);
