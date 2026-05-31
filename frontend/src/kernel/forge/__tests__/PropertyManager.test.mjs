import assert from 'node:assert/strict';
import { PropertyManager, PropertySchema, PropertyField } from '../PropertyManager.js';

// ---- schema + form -------------------------------------------------
{
  const pm = new PropertyManager();
  pm.register({
    kind: 'extrude',
    title: 'Extrude',
    fields: [
      { key: 'depth', type: 'number', unit: 'mm',
        validate: (v) => v > 0 ? null : 'must be > 0' },
      { key: 'reversed', type: 'boolean' },
    ],
  });

  const feature = { depth: 10, reversed: false };
  pm.setSelection(feature, 'extrude');

  const form = pm.currentForm();
  assert.equal(form.schema.kind, 'extrude');
  assert.equal(form.values.depth, 10);
  assert.deepEqual(form.errors, {});
}

// ---- commit + change notification ----------------------------------
{
  const pm = new PropertyManager();
  pm.register({
    kind: 'box',
    fields: [
      { key: 'x', type: 'number', validate: (v) => v > 0 ? null : 'must be > 0' },
    ],
  });

  const feature = { x: 1 };
  let notified = 0;
  pm.onChange(() => { notified++; });
  pm.setSelection(feature, 'box');
  pm.commit({ x: 5 });
  assert.equal(feature.x, 5);
  assert.equal(notified, 2, 'one for setSelection + one for commit');
}

// ---- validation prevents commit ------------------------------------
{
  const pm = new PropertyManager();
  pm.register({
    kind: 'cyl',
    fields: [
      { key: 'r', type: 'number', validate: (v) => v > 0 ? null : 'r must be > 0' },
    ],
  });
  const feature = { r: 5 };
  pm.setSelection(feature, 'cyl');
  assert.throws(() => pm.commit({ r: -1 }), /r must be > 0/);
  assert.equal(feature.r, 5, 'invalid commit did not mutate');
}

// ---- custom read/write -------------------------------------------
{
  const pm = new PropertyManager();
  pm.register({
    kind: 'ref',
    fields: [
      // Stored under a different internal key; the schema exposes a clean label.
      { key: 'planeName',
        type: 'string',
        read: (e) => e._plane?.name || '',
        write: (e, v) => { e._plane.name = v; } },
    ],
  });
  const entity = { _plane: { name: 'Front' } };
  pm.setSelection(entity, 'ref');
  assert.equal(pm.currentForm().values.planeName, 'Front');
  pm.commit({ planeName: 'XY' });
  assert.equal(entity._plane.name, 'XY');
}

// ---- error paths ---------------------------------------------------
{
  assert.throws(() => new PropertyField({}), /key/);
  assert.throws(() => new PropertyField({ key: 'a' }), /type/);
  assert.throws(() => new PropertySchema({}), /kind/);
}

console.log('[forge.prop] all tests passed');
