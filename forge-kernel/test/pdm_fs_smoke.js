// pdm_fs_smoke — FilesystemPartStore round-trip.
//
// Spins up a temp project directory, commits three versions of a box
// part with varying dimensions through FilesystemPartStore, then
// constructs a fresh store on the same directory and verifies:
//   * the histories were re-hydrated from disk,
//   * loadBody() reproduces the v2 box (10×20×30 → 6000 mm³),
//   * the blob is content-addressed and re-used between identical
//     commits (commit twice → same blob hash → one .brep file).
//
// Runs in plain Node by stubbing globalThis.window.forge with the
// native addon — the forge.js facade is otherwise window-bound.

const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const assert = require('assert');

const kernel = require(path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node'));

// Stub the Electron-style bridge before importing the JS facade.
globalThis.window = {
  forge: {
    isReady:  () => true,
    loadError: () => null,
    massProps: (h) => kernel.massProps(h),
    tessellate: (h, lt, at) => kernel.tessellate(h, lt, at),
    release:    (h) => kernel.release(h),
    io: {
      importStep: (fp) => kernel.io.importStep(fp),
      exportStep: (h, fp) => kernel.io.exportStep(h, fp),
      importBrep: (fp) => kernel.io.importBrep(fp),
      exportBrep: (h, fp) => kernel.io.exportBrep(h, fp),
      importStl:  (fp) => kernel.io.importStl(fp),
      exportStl:  (h, fp, lt, at, asc) => kernel.io.exportStl(h, fp, lt ?? 0.1, at ?? 0.5, !!asc),
    },
  },
};

async function main() {
  const url = require('url').pathToFileURL(
    path.resolve(__dirname, '..', '..', 'frontend', 'src', 'kernel', 'forge', 'FilesystemPartStore.js')).href;
  const { FilesystemPartStore } = await import(url);

  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-fs-pdm-'));
  console.log('[pdm-fs-smoke] tmp root =', tmpRoot);

  // Build three boxes with different dimensions.
  const dims = [
    { x: 10, y: 10, z: 10, vol: 1000 },
    { x: 10, y: 20, z: 30, vol: 6000 },
    { x:  5, y:  5, z: 40, vol: 1000 },   // same volume as v1 but different geometry
  ];

  const store = new FilesystemPartStore({ rootDir: tmpRoot });
  const handles = [];
  const commits = [];
  for (let i = 0; i < dims.length; ++i) {
    const h = kernel.makeBox(dims[i].x, dims[i].y, dims[i].z);
    handles.push(h);
    const v = store.commitPart('shaft-001', {
      bodyHandle: h,
      message: `v${i + 1}: ${dims[i].x}×${dims[i].y}×${dims[i].z}`,
      author: 'satvikOS',
      meta: { dims: dims[i] },
    });
    commits.push(v);
    console.log(`[pdm-fs-smoke] committed v${v.versionNumber} blob=${v.blobHash.slice(0, 12)}…`);
  }
  assert.equal(commits.length, 3);
  assert.notEqual(commits[0].blobHash, commits[1].blobHash, 'distinct geometry → distinct blob hash');

  // On-disk verification: parts/<id>/v1..3.json exist, plus 3 blobs.
  for (let i = 1; i <= 3; ++i) {
    const vp = path.join(tmpRoot, '.forge', 'parts', 'shaft-001', `v${i}.json`);
    assert.ok(fs.existsSync(vp), `expected ${vp}`);
  }
  const blobFiles = fs.readdirSync(path.join(tmpRoot, '.forge', 'blobs')).filter((f) => f.endsWith('.brep'));
  assert.equal(blobFiles.length, 3, `expected 3 unique blobs, got ${blobFiles.length}`);
  console.log(`[pdm-fs-smoke] on-disk: ${blobFiles.length} blobs, 3 v<n>.json files OK`);

  // Content-addressed re-commit: same dims again → same hash → no new file.
  const dupHandle = kernel.makeBox(dims[1].x, dims[1].y, dims[1].z);
  const dupVer = store.commitPart('shaft-001', { bodyHandle: dupHandle, message: 'dup', author: 'satvikOS' });
  assert.equal(dupVer.blobHash, commits[1].blobHash, 'duplicate geometry → same blob hash');
  const blobsAfterDup = fs.readdirSync(path.join(tmpRoot, '.forge', 'blobs')).filter((f) => f.endsWith('.brep'));
  assert.equal(blobsAfterDup.length, 3, 'duplicate commit should NOT add a new blob');
  console.log('[pdm-fs-smoke] content-addressed dedup OK');

  // Reload from a fresh store and verify mass-props of v2 match the source.
  const store2 = new FilesystemPartStore({ rootDir: tmpRoot });
  const h2 = store2.history('shaft-001');
  assert.equal(h2.count(), 4, `expected 4 versions reloaded, got ${h2.count()}`);
  assert.equal(h2.byVersion(2).blobHash, commits[1].blobHash);

  const body = store2.loadBody('shaft-001', 2);
  const mp = kernel.massProps(body.handle);
  console.log(`[pdm-fs-smoke] reload v2: vol=${mp.volume.toFixed(4)} area=${mp.area.toFixed(4)}`);
  assert.ok(Math.abs(mp.volume - dims[1].vol) < 1e-6, `v2 vol ${mp.volume} != ${dims[1].vol}`);
  // 10x20x30 → 2(10·20 + 20·30 + 30·10) = 2·1100 = 2200 mm²
  assert.ok(Math.abs(mp.area - 2200) < 1e-4, `v2 area ${mp.area} != 2200`);
  kernel.release(body.handle);

  // Lifecycle promotion persists across reloads.
  store2.promotePart('shaft-001', 1, 'InReview', { author: 'reviewer' });
  store2.promotePart('shaft-001', 1, 'Released', { author: 'approver' });
  const store3 = new FilesystemPartStore({ rootDir: tmpRoot });
  assert.equal(store3.history('shaft-001').byVersion(1).state, 'Released',
               'lifecycle state should survive reload');
  console.log('[pdm-fs-smoke] lifecycle persistence OK');

  // ECO persistence.
  const eco = store2.fileEco({
    title: 'Lengthen shaft 10→12mm',
    requestedBy: 'engA',
    affectedParts: ['shaft-001'],
    approvers: ['engB'],
  });
  const store4 = new FilesystemPartStore({ rootDir: tmpRoot });
  assert.ok(store4.getEco(eco.id), 'ECO should reload from disk');
  console.log('[pdm-fs-smoke] ECO persistence OK');

  // Cleanup native handles.
  for (const h of handles) kernel.release(h);
  kernel.release(dupHandle);

  console.log('[pdm-fs-smoke] ALL PASS');
}

main().catch((e) => { console.error(e); process.exit(1); });
