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
  class Matrix4 {
    constructor() { this.elements = new Array(16).fill(0); }
    copy(m) { this.elements = [...m.elements]; return this; }
    makeTranslation(x, y, z) { this.elements = [1,0,0,0, 0,1,0,0, 0,0,1,0, x,y,z,1]; return this; }
  }
  class Mesh {
    constructor(geom, mat) {
      this.geometry = geom; this.material = mat; this.userData = {};
      this.matrix = new Matrix4(); this.matrixAutoUpdate = true;
    }
  }
  class InstancedMesh {
    constructor(geom, mat, count) {
      this.geometry = geom; this.material = mat; this.count = count;
      this.userData = {};
      this._matrices = new Array(count).fill(null).map(() => new Matrix4());
      this.instanceMatrix = { needsUpdate: false };
    }
    setMatrixAt(i, m) { this._matrices[i].copy(m); }
    getMatrixAt(i, dest) { dest.copy(this._matrices[i]); return dest; }
  }
  return { BufferGeometry, BufferAttribute, Mesh, InstancedMesh, MeshStandardMaterial, Matrix4 };
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

// ---- Forge-44: instancedMeshFor for repeated parts ----------------
{
  const THREE = stubTHREE();
  const fbm = new ForgeBodyMesh(THREE, stubForge());
  const ms = [
    new THREE.Matrix4().makeTranslation(0, 0, 0),
    new THREE.Matrix4().makeTranslation(10, 0, 0),
    new THREE.Matrix4().makeTranslation(20, 0, 0),
  ];
  const im = fbm.instancedMeshFor(7, ms, { handles: [101, 102, 103] });
  assert.equal(im.count, 3, 'InstancedMesh count');
  assert.equal(im.instanceMatrix.needsUpdate, true, 'instanceMatrix.needsUpdate set');
  const ud = im.userData[FORGE_USERDATA_KEY];
  assert.equal(ud.kind, 'instanced');
  assert.equal(ud.sourceHandle, 7);
  assert.deepEqual(ud.handles, [101, 102, 103]);
  // Picker resolves instanceId → per-instance handle.
  const hit = fbm.resolveHit({ object: im, instanceId: 1 });
  assert.equal(hit.kind, 'instance');
  assert.equal(hit.handle, 102);
  assert.equal(hit.sourceHandle, 7);
  assert.equal(hit.instanceId, 1);
}

// ---- Forge-44: buildInstancedSceneGraph groups by sourceHandle ----
{
  const THREE = stubTHREE();
  const fbm = new ForgeBodyMesh(THREE, stubForge());
  // 3 bolts (source=7) + 1 plate (source=9) → expect 1 InstancedMesh + 1 Mesh.
  const T = (x) => new THREE.Matrix4().makeTranslation(x, 0, 0);
  const items = [
    { sourceHandle: 7, instanceHandle: 201, transform: T(0) },
    { sourceHandle: 7, instanceHandle: 202, transform: T(10) },
    { sourceHandle: 7, instanceHandle: 203, transform: T(20) },
    { sourceHandle: 9, instanceHandle: 301, transform: T(50) },
  ];
  const graph = fbm.buildInstancedSceneGraph(items);
  assert.equal(graph.length, 2, 'one node per source part');
  const im = graph.find((n) => n.userData[FORGE_USERDATA_KEY].kind === 'instanced');
  const single = graph.find((n) => n.userData[FORGE_USERDATA_KEY].kind === 'body');
  assert.ok(im && single);
  assert.equal(im.count, 3, '3 bolts batched into one draw call');
  assert.equal(single.userData[FORGE_USERDATA_KEY].handle, 301);
}

console.log('[forge.mesh] all tests passed');
