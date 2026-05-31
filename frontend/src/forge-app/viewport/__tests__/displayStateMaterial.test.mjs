/**
 * displayStateMaterial smoke — verifies the 5-state material factory.
 */

import assert from 'node:assert/strict';

import { buildDisplayMaterial, applyDisplayState, DISPLAY_STATES,
         DEFAULT_DISPLAY_STATE } from '../displayStateMaterial.js';

function stubTHREE() {
  class MeshStandardMaterial {
    constructor(opts) { Object.assign(this, opts || {}); this.type = 'std'; }
  }
  class MeshBasicMaterial {
    constructor(opts) { Object.assign(this, opts || {}); this.type = 'basic'; }
  }
  return { MeshStandardMaterial, MeshBasicMaterial };
}

// ---- the 5 states all build something --------------------------------
{
  const THREE = stubTHREE();
  for (const s of DISPLAY_STATES) {
    const d = buildDisplayMaterial(THREE, s);
    assert.ok(d.material, `material exists for ${s}`);
    assert.equal(typeof d.wantsEdges, 'boolean');
    assert.equal(typeof d.wantsHLR,   'boolean');
  }
}

// ---- wireframe flag set -----------------------------------------------
{
  const THREE = stubTHREE();
  const d = buildDisplayMaterial(THREE, 'wireframe');
  assert.equal(d.material.wireframe, true);
  assert.equal(d.material.type, 'basic');
}

// ---- hidden-line implies HLR overlay ----------------------------------
{
  const THREE = stubTHREE();
  const d = buildDisplayMaterial(THREE, 'hidden-line');
  assert.equal(d.wantsHLR, true);
  assert.equal(d.wantsEdges, false);
}

// ---- shaded-with-edges implies the edges overlay ----------------------
{
  const THREE = stubTHREE();
  const d = buildDisplayMaterial(THREE, 'shaded-with-edges');
  assert.equal(d.wantsEdges, true);
  assert.equal(d.wantsHLR, false);
}

// ---- transparent uses MeshStandardMaterial with opacity 0.5 -----------
{
  const THREE = stubTHREE();
  const d = buildDisplayMaterial(THREE, 'transparent');
  assert.equal(d.material.transparent, true);
  assert.equal(d.material.opacity, 0.5);
}

// ---- applyDisplayState swaps material across a list of meshes --------
{
  const THREE = stubTHREE();
  const meshes = [
    { material: { type: 'orig' }, userData: {} },
    { material: { type: 'orig' }, userData: {} },
  ];
  applyDisplayState(THREE, meshes, 'wireframe');
  for (const m of meshes) {
    assert.equal(m.material.wireframe, true);
    assert.equal(m.userData.baseMaterial.type, 'orig',
                 'original material preserved as baseMaterial');
    assert.equal(m.userData.displayState, 'wireframe');
  }
}

// ---- default state is shaded ------------------------------------------
{
  assert.equal(DEFAULT_DISPLAY_STATE, 'shaded');
}

console.log('[forge.viewport] displayStateMaterial smoke passed');
