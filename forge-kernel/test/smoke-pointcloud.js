// Forge-202 — point cloud smoke.

const kernel = require('../build/Release/forge-kernel.node');
const pc = kernel.pointcloud;

const errs = [];
const ck = (cond, msg) => { if (!cond) errs.push(msg); };

// (1) A 5x5x5 lattice of points spaced 1 mm — 125 points.
const N = 5;
const pts = [];
for (let i = 0; i < N; ++i)
  for (let j = 0; j < N; ++j)
    for (let k = 0; k < N; ++k)
      pts.push(i, j, k);
const cloud = new Float32Array(pts);

const s = pc.stats(cloud);
ck(s.pointCount === 125, `pointCount ${s.pointCount}`);
ck(s.bboxMin[0] === 0 && s.bboxMax[0] === 4, `bbox X [${s.bboxMin[0]},${s.bboxMax[0]}]`);
ck(Math.abs(s.centroid[0] - 2) < 1e-6, `centroid X ${s.centroid[0]}`);

// (2) Voxel downsample at leaf 2: should collapse 8 neighbours per voxel
//     into 1 → roughly 64/8 ≈ 8 voxels for 5x5x5 = depends on rounding.
//     Just assert we got fewer points.
const ds = pc.voxelDownsample(cloud, 2.0);
ck(ds.length / 3 < cloud.length / 3, `downsampled ${ds.length/3} >= ${cloud.length/3}`);
ck(ds.length / 3 > 0, `downsampled is empty`);

// (3) Normals — for a planar Z=0 patch normals should point ±Z. Build a
//     7x7 grid on Z=0 with viewpoint above (+Z): all normals should be ~+Z.
const planar = [];
for (let i = 0; i < 7; ++i)
  for (let j = 0; j < 7; ++j)
    planar.push(i * 0.5, j * 0.5, 0);
const plane = new Float32Array(planar);
const nrm = pc.estimateNormals(plane, 8, [3, 3, 10]);
ck(nrm.length === plane.length, `normals length ${nrm.length}`);
let nzPositive = 0;
for (let i = 0; i < plane.length / 3; ++i) {
  if (nrm[i*3+2] > 0.8) ++nzPositive;
}
ck(nzPositive > 30, `normals oriented +Z: ${nzPositive}/49`);

// (4) Voxel mesh — every cube face emitted as 2 triangles, shared
//     faces between adjacent cubes are skipped.
const m = pc.voxelMesh(cloud, 1.0);
ck(m.positions.length > 0, `voxelMesh has positions`);
ck(m.indices.length % 3 === 0, `voxelMesh indices % 3 = 0`);
// 5x5x5 lattice of voxels: surface = 6 faces × 25 voxels per face = 150
// quads = 300 triangles.
ck(m.indices.length / 3 === 300, `voxelMesh tri count: ${m.indices.length/3} (expected 300)`);

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-202 point cloud smoke: OK');
console.log(`  stats: ${s.pointCount} pts, density ${s.density.toFixed(2)}/mm³`);
console.log(`  downsample leaf=2: ${cloud.length/3} → ${ds.length/3} pts`);
console.log(`  normals on planar 7×7: ${nzPositive}/49 point +Z`);
console.log(`  voxelMesh shell: ${m.positions.length/3} verts, ${m.indices.length/3} tris`);
