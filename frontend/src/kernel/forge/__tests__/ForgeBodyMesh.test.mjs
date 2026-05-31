import assert from 'node:assert/strict';
import { ForgeBodyMesh, applyScalarField, PALETTES, FORGE_USERDATA_KEY } from '../ForgeBodyMesh.js';

// ---- minimal THREE stub --------------------------------------------
function stubTHREE() {
  class BufferAttribute {
    constructor(array, itemSize) { this.array = array; this.itemSize = itemSize; this.count = array.length / itemSize; }
  }
  class BufferGeometry {
    constructor() { this.attributes = {}; this.index = null; this.boundingSphere = null; }
    setAttribute(name, attr) { this.attributes[name] = attr; }
    setIndex(attr) { this.index = attr; }
    computeBoundingSphere() { this.boundingSphere = { center: [0,0,0], radius: 1 }; }
  }
  class MeshStandardMaterial { constructor(opts) { Object.assign(this, opts || {}); } }
  class Mesh {
    constructor(geom, mat) { this.geometry = geom; this.material = mat; this.userData = {}; }
  }
  return { BufferGeometry, BufferAttribute, Mesh, MeshStandardMaterial };
}

// ---- stub forge providing a 12-vertex / 4-triangle pyramid --------
function stubForge() {
  return {
    tessellate(handle, linTol, angTol) {
      // tetrahedron: 4 verts, 4 triangles
      const positions = new Float32Array([0,0,0, 1,0,0, 0,1,0, 0,0,1]);
      const normals   = new Float32Array([0,0,1, 0,0,1, 0,0,1, 0,0,1]);
      const indices   = new Uint32Array([0,1,2, 0,2,3, 0,3,1, 1,3,2]);
      return { positions, normals, indices, triangleCount: 4 };
    },
  };
}

// ---- geometry + mesh + userData -----------------------------------
{
  const THREE = stubTHREE();
  const fbm = new ForgeBodyMesh(THREE, stubForge());
  const m = fbm.meshFor(42);
  assert.equal(m.geometry.attributes.position.count, 4);
  assert.equal(m.geometry.index.count, 12);
  assert.equal(m.geometry.boundingSphere.radius, 1);
  assert.equal(m.userData[FORGE_USERDATA_KEY].handle, 42);
  assert.equal(m.userData[FORGE_USERDATA_KEY].kind,   'body');
}

// ---- geometry cache reuses the BufferGeometry ---------------------
{
  const THREE = stubTHREE();
  const forge = stubForge();
  let tessCalls = 0;
  forge.tessellate = ((orig) => (h, l, a) => { tessCalls++; return orig(h, l, a); })(forge.tessellate);
  const fbm = new ForgeBodyMesh(THREE, forge);
  const g1 = fbm.geometryFor(7);
  const g2 = fbm.geometryFor(7);
  assert.strictEqual(g1, g2, 'geometry should be cached');
  assert.equal(tessCalls, 1);
  // Different tolerance → new cache entry.
  fbm.geometryFor(7, { linTol: 0.05 });
  assert.equal(tessCalls, 2);
}

// ---- invalidate drops cache for that handle only ------------------
{
  const THREE = stubTHREE();
  const fbm = new ForgeBodyMesh(THREE, stubForge());
  fbm.geometryFor(7); fbm.geometryFor(8);
  assert.equal(fbm._geomCache.size, 2);
  fbm.invalidate(7);
  assert.equal(fbm._geomCache.size, 1);
}

// ---- resolveHit reverses meshFor ----------------------------------
{
  const THREE = stubTHREE();
  const fbm = new ForgeBodyMesh(THREE, stubForge());
  const m = fbm.meshFor(99);
  const hit = { object: m };
  const r = fbm.resolveHit(hit);
  assert.deepEqual(r, { handle: 99, kind: 'body' });
  assert.equal(fbm.resolveHit({ object: { userData: {} } }), null);
}

// ---- applyScalarField + palettes ----------------------------------
{
  const THREE = stubTHREE();
  const fbm = new ForgeBodyMesh(THREE, stubForge());
  const g = fbm.geometryFor(1);
  const scalars = new Float32Array([0, 0.5, 1, 0.25]);
  const range = applyScalarField(THREE, g, scalars, { palette: PALETTES.viridis });
  assert.equal(range.min, 0); assert.equal(range.max, 1);
  assert.equal(g.attributes.color.count, 4);

  // Throw on mismatched scalar length.
  assert.throws(() => applyScalarField(THREE, g, new Float32Array([0, 1])),
                /scalar length/);
}

// ---- palette outputs are in [0,1] ----------------------------------
for (const name of ['viridis', 'turbo', 'cool', 'gray']) {
  const samples = [0, 0.1, 0.5, 0.9, 1];
  for (const t of samples) {
    const c = PALETTES[name](t);
    for (let i = 0; i < 3; i++) {
      assert.ok(c[i] >= 0 && c[i] <= 1, `${name}(${t})[${i}] = ${c[i]} out of [0,1]`);
    }
  }
}

console.log('[forge.mesh] all tests passed');
