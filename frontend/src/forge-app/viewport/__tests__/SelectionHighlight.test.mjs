/**
 * SelectionHighlight smoke — verifies the pick-resolution pipeline that
 * sits behind the React component (canvas raycast → ForgeBodyMesh
 * userData → SelectionFilter → emitted selection).
 *
 * We mock the Raycaster by feeding `resolvePicks` a hand-built
 * `intersection[]` (the same shape Three.js Raycaster.intersectObjects
 * returns).
 */

import assert from 'node:assert/strict';

import { SelectionFilter } from '../../../kernel/forge/SelectionFilter.js';
import { ForgeBodyMesh, FORGE_USERDATA_KEY } from '../../../kernel/forge/ForgeBodyMesh.js';
import { resolvePicks, nearestPick, nextSelection } from '../selectionLogic.js';

// ---- THREE stub (matches the one used by ForgeBodyMesh.test) -----------
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

function stubForge() {
  return {
    tessellate() {
      return {
        positions: new Float32Array([0,0,0, 1,0,0, 0,1,0]),
        normals:   new Float32Array([0,0,1, 0,0,1, 0,0,1]),
        indices:   new Uint32Array([0,1,2]),
        triangleCount: 1,
      };
    },
  };
}

// ---- 1. raycast hit highlights the body -------------------------------
{
  const THREE = stubTHREE();
  const fbm = new ForgeBodyMesh(THREE, stubForge());
  const meshA = fbm.meshFor(101);
  const meshB = fbm.meshFor(202);

  // Two-hit intersection list (B closer than A).
  const intersections = [
    { object: meshB, distance: 2.1, point: { x: 0, y: 0, z: 0 } },
    { object: meshA, distance: 7.4, point: { x: 0, y: 0, z: 0 } },
  ];

  const filter = new SelectionFilter();
  const picks = resolvePicks(intersections, fbm, filter);
  assert.equal(picks.length, 2);
  assert.equal(picks[0].handle, 202);
  assert.equal(picks[1].handle, 101);

  const win = nearestPick(picks);
  assert.equal(win.handle, 202, 'nearest hit wins');
  assert.equal(win.kind, 'body');
}

// ---- 2. SelectionFilter blocks the wrong kind -----------------------
{
  const THREE = stubTHREE();
  const fbm = new ForgeBodyMesh(THREE, stubForge());
  const meshA = fbm.meshFor(101);
  // Force a non-body kind onto the userData so we can test gating.
  meshA.userData[FORGE_USERDATA_KEY] = { handle: 101, kind: 'face' };

  const filter = new SelectionFilter();
  filter.only('vertex'); // disables face/body

  const intersections = [{ object: meshA, distance: 1 }];
  const picks = resolvePicks(intersections, fbm, filter);
  assert.equal(picks.length, 0,
    'SelectionFilter.only("vertex") blocks face/body hits');
}

// ---- 3. raycast miss → no selection change ----------------------------
{
  const THREE = stubTHREE();
  const fbm = new ForgeBodyMesh(THREE, stubForge());
  const filter = new SelectionFilter();

  const picks = resolvePicks([], fbm, filter);
  assert.equal(picks.length, 0);
  assert.equal(nearestPick(picks), null);
}

// ---- 4. replace vs add selection mode ---------------------------------
{
  const cur = [{ handle: 1, kind: 'body' }];
  const pick = { handle: 2, kind: 'body' };
  const r = nextSelection(cur, pick, 'replace');
  assert.deepEqual(r, [{ handle: 2, kind: 'body' }]);

  const a = nextSelection(cur, pick, 'add');
  assert.deepEqual(a, [{ handle: 1, kind: 'body' }, { handle: 2, kind: 'body' }]);

  // Toggle off: adding an existing pick removes it.
  const togg = nextSelection(a, pick, 'add');
  assert.deepEqual(togg, [{ handle: 1, kind: 'body' }]);
}

// ---- 5. null pick is safe --------------------------------------------
{
  const r = nextSelection([{ handle: 1, kind: 'body' }], null, 'replace');
  assert.deepEqual(r, []);
  const r2 = nextSelection([{ handle: 1, kind: 'body' }], null, 'add');
  assert.deepEqual(r2, [{ handle: 1, kind: 'body' }]);
}

console.log('[forge.viewport] SelectionHighlight smoke passed');
