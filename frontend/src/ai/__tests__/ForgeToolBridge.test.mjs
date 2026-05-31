import assert from 'node:assert/strict';
import {
  FORGE_TOOLS, toolsForDiscipline, getToolSpec,
  validateArguments, dispatchToolCall, systemPromptTools,
} from '../ForgeToolBridge.js';

// ---- registry sanity -----------------------------------------------
{
  assert.ok(FORGE_TOOLS.length >= 25, `expected ≥25 tools, got ${FORGE_TOOLS.length}`);
  const names = new Set(FORGE_TOOLS.map((t) => t.name));
  assert.equal(names.size, FORGE_TOOLS.length, 'tool names must be unique');

  // Each tool must have a discipline from the canonical set.
  const KIND = new Set(['sketch', 'part', 'assembly', 'simulate', 'manufacture', 'drawing']);
  for (const t of FORGE_TOOLS) {
    assert.ok(KIND.has(t.discipline), `${t.name}: bad discipline ${t.discipline}`);
    assert.ok(typeof t.description === 'string' && t.description.length > 5,
              `${t.name}: missing description`);
    assert.equal(typeof t.run, 'function', `${t.name}: missing run()`);
  }
}

// ---- discipline filtering ------------------------------------------
{
  const sketch = toolsForDiscipline('sketch');
  const part = toolsForDiscipline('part');
  assert.ok(sketch.length >= 5);
  assert.ok(part.length   >= 10);
  for (const t of sketch) assert.equal(t.discipline, 'sketch');
}

// ---- validateArguments --------------------------------------------
{
  const spec = getToolSpec('part.make-box');
  assert.deepEqual(validateArguments(spec, { dx: 1, dy: 1, dz: 1 }), { ok: true });
  const missing = validateArguments(spec, { dx: 1, dy: 1 });
  assert.equal(missing.ok, false);
  assert.match(missing.error, /missing required arg/);
}

// ---- dispatchToolCall with a mock forge ---------------------------
{
  // No native forge here — pass a stub.
  const calls = [];
  const stubForge = {
    makeBox: (dx, dy, dz) => { calls.push(['makeBox', dx, dy, dz]); return 42; },
  };

  const ok = await dispatchToolCall(
    { name: 'part.make-box', arguments: { dx: 10, dy: 5, dz: 2 } },
    { forge: stubForge },
  );
  assert.equal(ok.ok, true);
  assert.equal(ok.tool, 'part.make-box');
  assert.equal(ok.result.shape, 42);
  assert.deepEqual(calls, [['makeBox', 10, 5, 2]]);
}

// ---- dispatchToolCall: unknown tool ------------------------------
{
  const r = await dispatchToolCall({ name: 'nope.bogus', arguments: {} }, { forge: {} });
  assert.equal(r.ok, false);
  assert.match(r.error, /unknown tool/);
}

// ---- dispatchToolCall: native throws → ok:false ------------------
{
  const angry = { makeBox: () => { throw new Error('OCCT angry'); } };
  const r = await dispatchToolCall(
    { name: 'part.make-box', arguments: { dx: 1, dy: 1, dz: 1 } },
    { forge: angry },
  );
  assert.equal(r.ok, false);
  assert.match(r.error, /OCCT angry/);
}

// ---- systemPromptTools is JSON-safe (no run field) ---------------
{
  const json = JSON.stringify(systemPromptTools('part'));
  assert.ok(json.length > 0);
  assert.ok(!json.includes('"run"'), 'run() must not be exposed to the model');
  // Round-trip parse.
  const parsed = JSON.parse(json);
  assert.ok(Array.isArray(parsed) && parsed.length > 0);
  for (const t of parsed) {
    assert.ok(t.name && t.description);
    assert.equal(typeof t.parameters, 'object');
  }
}

console.log('[forge.bridge] all tests passed');
