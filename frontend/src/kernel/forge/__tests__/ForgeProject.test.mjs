import assert from 'node:assert/strict';
import { ForgeProject, CURRENT_VERSION } from '../ForgeProject.js';
import { Configuration } from '../Configurations.js';
import { ReferenceAxis } from '../ReferenceGeometry.js';

// ---- empty project round-trip --------------------------------------
{
  const p = new ForgeProject({ name: 'Bracket', units: 'mm', author: 'satvikOS' });
  const json = p.toJSON();
  assert.equal(json.version, CURRENT_VERSION);
  assert.equal(json.meta.name, 'Bracket');
  assert.equal(json.meta.author, 'satvikOS');

  const back = ForgeProject.fromJSON(json);
  assert.equal(back.name, 'Bracket');
  assert.equal(back.featureTree.size(), 0);
  assert.equal(back.configurations.list().length, 1, 'default config restored');
  assert.equal(back.referenceFrame.list().length, 4, '3 default planes + origin csys');
}

// ---- populated project round-trip ----------------------------------
{
  const p = new ForgeProject({ name: 'Shaft' });
  const sketch = p.featureTree.add({ kind: 'sketch' });
  const extrude = p.featureTree.add({ kind: 'extrude', params: { depth: 25 }, dependsOn: [sketch.id] });
  p.featureTree.suppress(extrude.id);

  p.configurations.add(new Configuration({ name: 'Tall', overrides: { 'extrude-1.depth': 50 } }));
  p.referenceFrame.add(new ReferenceAxis({ direction: [0, 0, 1], name: 'Spin' }));

  p.partStore.commitPart('shaft-001', { blobHash: 'h1', message: 'init', author: 'a' });
  p.partStore.commitPart('shaft-001', { blobHash: 'h2', message: 'fillet', author: 'a' });

  p.routes.push({ id: 'r1', kind: 'pipe', diameter: 20 });
  p.molds.push({ id: 'm1', partName: 'Shaft' });

  const json = JSON.parse(JSON.stringify(p.toJSON())); // simulate disk I/O
  const back = ForgeProject.fromJSON(json);

  assert.equal(back.featureTree.size(), 2);
  assert.ok(back.featureTree.byId(extrude.id).suppressed);
  assert.equal(back.featureTree.byId(extrude.id).params.depth, 25);

  assert.ok(back.configurations.byName('Tall'));
  assert.ok(back.referenceFrame.byName('Spin'));
  assert.equal(back.partStore.history('shaft-001').count(), 2);

  assert.equal(back.routes.length, 1);
  assert.equal(back.molds[0].partName, 'Shaft');
}

// ---- migration: unknown version throws ---------------------------
{
  assert.throws(() => ForgeProject.fromJSON({ version: 999 }),
                /newer.*than this build/);
  assert.throws(() => ForgeProject.fromJSON({}),
                /missing version/);
  assert.throws(() => ForgeProject.fromJSON(null),
                /not an object/);
}

// ---- updatedAt advances on touch ---------------------------------
{
  const p = new ForgeProject();
  const t0 = p.updatedAt;
  // Wait long enough for Date.now() to tick (≥1 ms — usually instant).
  for (let i = 0; i < 1e5; i++) { /* burn cycles to advance the clock */ }
  p.touch();
  assert.ok(p.updatedAt >= t0);
}

console.log('[forge.project] all tests passed');
