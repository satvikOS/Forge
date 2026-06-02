// forge-kernel glTF export smoke (Forge-178) — write a small scene with
// 3 primitives, parse the .glb back, verify structure matches the
// glTF 2.0 spec.

const path = require('path');
const fs = require('fs');
const assert = require('assert');

const KERNEL = path.resolve(__dirname, '..', 'build', 'Release', 'forge-kernel.node');
const forge = require(KERNEL);

assert.ok(forge.gltf && typeof forge.gltf.exportGlb === 'function',
          'forge.gltf.exportGlb missing');

const box = forge.makeBox(10, 20, 30);
const cyl = forge.makeCylinder(5, 25);
const sph = forge.makeSphere(7);

const outPath = '/tmp/forge_gltf_smoke.glb';
fs.rmSync(outPath, { force: true });

const summary = forge.gltf.exportGlb(
  [
    { handle: box, name: 'box',     baseColor: [0.85, 0.30, 0.20, 1.0], metallic: 0.20, roughness: 0.55 },
    { handle: cyl, name: 'cylinder',baseColor: [0.20, 0.60, 0.85, 1.0], metallic: 0.40, roughness: 0.35 },
    { handle: sph, name: 'sphere',  baseColor: [0.30, 0.80, 0.40, 1.0], metallic: 0.10, roughness: 0.70 },
  ],
  outPath,
  { deflection: 0.1, angularDeflection: 0.4, computeNormals: true,
    generator: 'Forge MCAD test (Forge-178)' });

assert.strictEqual(summary.bodiesWritten, 3, 'bodies written mismatch');
assert.ok(summary.verticesTotal > 100, `total verts ${summary.verticesTotal} too low`);
assert.ok(summary.trianglesTotal > 50, `total tris ${summary.trianglesTotal} too low`);
assert.ok(summary.fileSizeBytes > 1024, `file size ${summary.fileSizeBytes} too small`);

// Read .glb back as raw bytes.
const buf = fs.readFileSync(outPath);
assert.strictEqual(buf.length, summary.fileSizeBytes,
                   'file size on disk does not match returned summary');

// Header parse.
const magic = buf.readUInt32LE(0);
const version = buf.readUInt32LE(4);
const totalLen = buf.readUInt32LE(8);
assert.strictEqual(magic, 0x46546C67, `magic ${magic.toString(16)} not 'glTF'`);
assert.strictEqual(version, 2, `glTF version ${version} not 2`);
assert.strictEqual(totalLen, buf.length, 'total length header lies');

const jsonLen = buf.readUInt32LE(12);
const jsonType = buf.readUInt32LE(16);
assert.strictEqual(jsonType, 0x4E4F534A, 'JSON chunk type wrong');
const jsonStr = buf.toString('utf8', 20, 20 + jsonLen).trim();
const json = JSON.parse(jsonStr);

assert.strictEqual(json.asset.version, '2.0');
assert.ok(json.asset.generator.includes('Forge'));
assert.strictEqual(json.scenes.length, 1);
assert.strictEqual(json.nodes.length, 3, 'expected 3 nodes');
assert.strictEqual(json.meshes.length, 3, 'expected 3 meshes');
assert.strictEqual(json.materials.length, 3, 'expected 3 materials');

// Check that each mesh primitive points at a valid accessor + material.
for (let i = 0; i < json.meshes.length; ++i) {
  const m = json.meshes[i];
  assert.strictEqual(m.primitives.length, 1, `mesh ${i} primitive count`);
  const p = m.primitives[0];
  assert.ok(typeof p.attributes.POSITION === 'number',
            `mesh ${i} POSITION accessor missing`);
  assert.ok(typeof p.indices === 'number', `mesh ${i} indices accessor missing`);
  assert.strictEqual(p.material, i, `mesh ${i} material idx mismatch`);
}

// Verify the BIN chunk is present + length matches.
const binChunkStart = 20 + jsonLen;
const binLen = buf.readUInt32LE(binChunkStart);
const binType = buf.readUInt32LE(binChunkStart + 4);
assert.strictEqual(binType, 0x004E4942, 'BIN chunk type wrong');
assert.strictEqual(binChunkStart + 8 + binLen, buf.length,
                   'BIN chunk extends beyond file');

// Sample accessor 0 (positions of the first mesh) — read componentType
// + count + verify it falls within the BIN chunk.
const acc0 = json.accessors[0];
assert.strictEqual(acc0.componentType, 5126, 'POSITION componentType not FLOAT');
assert.strictEqual(acc0.type, 'VEC3', 'POSITION type not VEC3');
const bv0 = json.bufferViews[acc0.bufferView];
assert.ok(bv0.byteOffset + bv0.byteLength <= binLen,
          'bufferView extends past BIN chunk');

// Verify a few floats look reasonable (coordinates in mm).
const offset = binChunkStart + 8 + bv0.byteOffset;
const firstX = buf.readFloatLE(offset);
const firstY = buf.readFloatLE(offset + 4);
const firstZ = buf.readFloatLE(offset + 8);
assert.ok(Math.abs(firstX) < 100 && Math.abs(firstY) < 100 && Math.abs(firstZ) < 100,
          `first vertex ${firstX},${firstY},${firstZ} out of plausible range`);

// Per-material PBR check: ensure baseColor + metallic match what we sent.
const m0 = json.materials[0].pbrMetallicRoughness;
assert.ok(Math.abs(m0.baseColorFactor[0] - 0.85) < 1e-3, 'baseColor 0 round-trip');
assert.ok(Math.abs(m0.metallicFactor   - 0.20) < 1e-3, 'metallic 0 round-trip');
assert.ok(Math.abs(m0.roughnessFactor  - 0.55) < 1e-3, 'roughness 0 round-trip');

console.log('✅ glTF export smoke PASSED');
console.log(`   bodies / verts / tris   ${summary.bodiesWritten} / ${summary.verticesTotal} / ${summary.trianglesTotal}`);
console.log(`   .glb size               ${summary.fileSizeBytes} bytes`);
console.log(`   JSON header parsed      asset v${json.asset.version}, ${json.nodes.length} nodes`);
console.log(`   BIN chunk start         ${binChunkStart}, length ${binLen}`);
console.log(`   first vert (box)        (${firstX.toFixed(2)}, ${firstY.toFixed(2)}, ${firstZ.toFixed(2)}) mm`);
console.log(`   PBR materials           round-trip OK`);
