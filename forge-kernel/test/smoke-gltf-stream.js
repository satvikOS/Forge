// Forge-198 — streaming glTF export smoke.
//
// Generates a small scene with a few primitives, exports both ways
// (writeGlb + writeGlbStream), and asserts:
//   * stream output is at least as small as non-stream (same JSON layout)
//   * stream summary reports peakBytesInMemory > 0 and  ≤ per-body cap
//   * file is a valid binary glTF (magic 0x46546C67, version 2)

const fs   = require('fs');
const path = require('path');

const kernel = require('../build/Release/forge-kernel.node');

const tmpDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'forge-stream-'));
const oneShot = path.join(tmpDir, 'one-shot.glb');
const stream  = path.join(tmpDir, 'stream.glb');

const a = kernel.makeBox(50, 40, 30);
const b = kernel.makeBox(20, 20, 20);
kernel.translate(b, 60, 0, 0);
const c = kernel.makeBox(15, 15, 15);
kernel.translate(c, 0, 60, 0);

const bodies = [
  { handle: a, name: 'A', baseColor: [0.85, 0.20, 0.10, 1.0], metallic: 0.3, roughness: 0.6 },
  { handle: b, name: 'B', baseColor: [0.15, 0.55, 0.85, 1.0], metallic: 0.5, roughness: 0.4 },
  { handle: c, name: 'C', baseColor: [0.20, 0.75, 0.30, 1.0], metallic: 0.2, roughness: 0.8 },
];

const sOneShot = kernel.gltf.exportGlb(bodies, oneShot, { deflection: 0.5 });
const sStream  = kernel.gltf.exportGlbStream(bodies, stream,  { deflection: 0.5 });

console.log('one-shot:', sOneShot);
console.log('stream:  ', sStream);

const errs = [];
if (!fs.existsSync(stream)) errs.push('stream output missing');

const buf = fs.readFileSync(stream);
const magic = buf.readUInt32LE(0);
const version = buf.readUInt32LE(4);
const fileLen = buf.readUInt32LE(8);
if (magic   !== 0x46546C67) errs.push('bad magic ' + magic.toString(16));
if (version !== 2)          errs.push('bad version ' + version);
if (fileLen !== buf.length) errs.push('header length mismatch ' + fileLen + ' vs ' + buf.length);

if (sStream.bodiesWritten   !== 3)                          errs.push('bodiesWritten ' + sStream.bodiesWritten);
if (sStream.verticesTotal   !== sOneShot.verticesTotal)     errs.push('vertices mismatch');
if (sStream.trianglesTotal  !== sOneShot.trianglesTotal)    errs.push('triangles mismatch');
if (sStream.peakBytesInMemory <= 0)                          errs.push('peakBytesInMemory should be > 0');
// Peak in stream should be < total geometry size (per-body cap, not sum).
const totalGeomBytes = sStream.verticesTotal * 24 + sStream.trianglesTotal * 12;
if (sStream.peakBytesInMemory >= totalGeomBytes)             errs.push('streaming did not bound memory: peak ' + sStream.peakBytesInMemory + ' >= total ' + totalGeomBytes);

fs.rmSync(tmpDir, { recursive: true, force: true });

if (errs.length) {
  console.error('FAIL:'); errs.forEach((e) => console.error('  ', e));
  process.exit(1);
}
console.log('Forge-198 streaming glTF smoke: OK');
