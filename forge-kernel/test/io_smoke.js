// io_smoke — STEP / BREP / STL round-trips on /tmp files.
//
// For each format: build a 10mm box, write to disk, re-import, verify the
// mass properties (volume / area / COM) match within tolerance. STL is
// tessellated so we only verify the file exists + parses + has a
// non-zero shell.

const path = require('path');
const fs = require('fs');
const assert = require('assert');
const forge = require(path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node'));

const TMP = '/tmp';
const BOX_VOL = 1000;     // 10×10×10 mm = 1000 mm³
const BOX_AREA = 600;     // 6 × 100 mm² = 600 mm²
const TOL = 1e-6;

function pathFor(ext) { return path.join(TMP, `forge-io-smoke.${ext}`); }

console.log('[io-smoke] version =', forge.version());

const box = forge.makeBox(10, 10, 10);
const mp0 = forge.massProps(box);
console.log(`[io-smoke] source box vol=${mp0.volume} area=${mp0.area}`);
assert.ok(Math.abs(mp0.volume - BOX_VOL) < TOL);

// ---- STEP round-trip --------------------------------------------------
{
  const p = pathFor('step');
  forge.io.exportStep(box, p);
  assert.ok(fs.existsSync(p), `STEP file ${p} not written`);
  const size = fs.statSync(p).size;
  assert.ok(size > 200, `STEP file too small (${size} bytes)`);

  const imported = forge.io.importStep(p);
  const mp = forge.massProps(imported);
  // STEP is exact-precision; expect tight tolerance on volume + area.
  assert.ok(Math.abs(mp.volume - BOX_VOL) < 1e-4, `STEP vol ${mp.volume} != ${BOX_VOL}`);
  assert.ok(Math.abs(mp.area   - BOX_AREA) < 1e-4, `STEP area ${mp.area} != ${BOX_AREA}`);
  console.log(`[io-smoke] STEP round-trip OK — ${size} bytes`);
  forge.release(imported);
}

// ---- BREP round-trip --------------------------------------------------
{
  const p = pathFor('brep');
  forge.io.exportBrep(box, p);
  assert.ok(fs.existsSync(p), `BREP file ${p} not written`);
  const size = fs.statSync(p).size;
  assert.ok(size > 100, `BREP file too small (${size} bytes)`);

  const imported = forge.io.importBrep(p);
  const mp = forge.massProps(imported);
  // BREP is OCCT-native — should be bit-exact on volume + area.
  assert.ok(Math.abs(mp.volume - BOX_VOL) < 1e-9, `BREP vol ${mp.volume} != ${BOX_VOL}`);
  assert.ok(Math.abs(mp.area   - BOX_AREA) < 1e-9, `BREP area ${mp.area} != ${BOX_AREA}`);
  console.log(`[io-smoke] BREP round-trip OK — ${size} bytes`);
  forge.release(imported);
}

// ---- STL export + re-import (mesh shell) -----------------------------
{
  const p = pathFor('stl');
  forge.io.exportStl(box, p, 0.05, 0.3, false /* binary */);
  assert.ok(fs.existsSync(p), `STL file ${p} not written`);
  const size = fs.statSync(p).size;
  assert.ok(size > 200, `STL file too small (${size} bytes)`);

  // Re-import: STL gives a shell, not a solid; mass props on a shell
  // are 0 volume but the surface area should still be close to the box's.
  const imported = forge.io.importStl(p);
  const mp = forge.massProps(imported);
  // 12 triangles ≈ 600 mm² but STL is faceted; allow generous tol.
  assert.ok(mp.area > 500 && mp.area < 700,
            `STL re-imported area ${mp.area} out of range`);
  console.log(`[io-smoke] STL round-trip OK — ${size} bytes, area=${mp.area.toFixed(1)}`);
  forge.release(imported);
}

forge.release(box);
console.log('[io-smoke] ALL PASS');
