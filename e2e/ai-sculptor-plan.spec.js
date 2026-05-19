import { test, expect } from '@playwright/test';
import { buildSculptPrompt, parseSculptPlan, executeSculptPlan } from '../frontend/src/ai/sculptor/PartSculptor.js';

test.describe('PartSculptor — prompt', () => {
  test('the system prompt names every atomic operation', () => {
    const p = buildSculptPrompt();
    for (const op of ['startSketch', 'sketchRectangle', 'sketchCircle', 'finishSketch', 'extrude', 'cut', 'revolve']) {
      expect(p).toContain(op);
    }
  });

  test('the prompt explains sketching on the top face for a boss', () => {
    const p = buildSculptPrompt();
    expect(p).toContain('top');
    expect(p.toLowerCase()).toContain('boss');
  });
});

test.describe('PartSculptor — parseSculptPlan', () => {
  test('parses a bare JSON array of operations', () => {
    const plan = parseSculptPlan('[{"op":"startSketch","plane":"XY"},{"op":"finishSketch"}]');
    expect(plan.length).toBe(2);
    expect(plan[0].op).toBe('startSketch');
  });

  test('parses a {"operations":[...]} wrapper object', () => {
    const plan = parseSculptPlan('{"operations":[{"op":"startSketch"},{"op":"finishSketch"}]}');
    expect(plan.length).toBe(2);
  });

  test('strips a ```json markdown fence', () => {
    const plan = parseSculptPlan('```json\n[{"op":"startSketch"}]\n```');
    expect(plan.length).toBe(1);
    expect(plan[0].op).toBe('startSketch');
  });

  test('rejects an unknown operation name', () => {
    expect(() => parseSculptPlan('[{"op":"teleport"}]')).toThrow(/unknown operation/);
  });

  test('rejects a sketchRectangle missing a required numeric param', () => {
    expect(() => parseSculptPlan('[{"op":"sketchRectangle","cx":0,"cy":0,"w":10}]')).toThrow(/sketchRectangle/);
  });

  test('rejects an extrude with a non-numeric distance', () => {
    expect(() => parseSculptPlan('[{"op":"extrude","distance":"deep"}]')).toThrow(/extrude/);
  });

  test('rejects input that is not JSON at all', () => {
    expect(() => parseSculptPlan('I cannot help with that.')).toThrow(/could not parse/);
  });

  test('accepts a full valid plate-with-hole plan', () => {
    const plan = parseSculptPlan(JSON.stringify({ operations: [
      { op: 'startSketch', plane: 'XY' },
      { op: 'sketchRectangle', cx: 0, cy: 0, w: 80, h: 60 },
      { op: 'finishSketch' },
      { op: 'extrude', distance: 8 },
      { op: 'startSketch', plane: 'XY' },
      { op: 'sketchCircle', cx: 0, cy: 0, r: 7.5 },
      { op: 'finishSketch' },
      { op: 'cut', distance: 12 },
    ] }));
    expect(plan.length).toBe(8);
  });

  test('accepts a circularPattern op with numeric count and distance', () => {
    const plan = parseSculptPlan(JSON.stringify({ operations: [
      { op: 'circularPattern', mode: 'cut', count: 6, distance: 12 },
    ] }));
    expect(plan.length).toBe(1);
    expect(plan[0].op).toBe('circularPattern');
  });

  test('rejects a circularPattern op missing the numeric count', () => {
    expect(() => parseSculptPlan('[{"op":"circularPattern","mode":"cut","distance":12}]'))
      .toThrow(/circularPattern/);
  });

  test('accepts a linearPattern op with numeric count, distance, dx, dy', () => {
    const plan = parseSculptPlan(JSON.stringify({ operations: [
      { op: 'linearPattern', mode: 'cut', count: 4, distance: 12, dx: 15, dy: 0 },
    ] }));
    expect(plan.length).toBe(1);
    expect(plan[0].op).toBe('linearPattern');
  });

  test('rejects a linearPattern op missing the numeric dx', () => {
    expect(() => parseSculptPlan('[{"op":"linearPattern","mode":"cut","count":4,"distance":12,"dy":0}]'))
      .toThrow(/linearPattern/);
  });

  test('accepts a fillet op with a numeric radius', () => {
    const plan = parseSculptPlan('[{"op":"fillet","radius":2}]');
    expect(plan.length).toBe(1);
    expect(plan[0].op).toBe('fillet');
  });

  test('rejects a fillet op with no numeric radius', () => {
    expect(() => parseSculptPlan('[{"op":"fillet"}]')).toThrow(/fillet/);
  });
});

test.describe('PartSculptor — executeSculptPlan', () => {
  /** A fake AtomicOps API that records every call instead of doing geometry. */
  function fakeAtomicApi() {
    const calls = [];
    const part = { __fake: true };
    return {
      calls, part,
      createPart: (name) => { calls.push(['createPart', name]); return part; },
      startSketch: (p, plane) => calls.push(['startSketch', plane]),
      sketchRectangle: (p, cx, cy, w, h) => calls.push(['sketchRectangle', cx, cy, w, h]),
      sketchCircle: (p, cx, cy, r) => calls.push(['sketchCircle', cx, cy, r]),
      finishSketch: () => calls.push(['finishSketch']),
      extrude: async (p, d) => calls.push(['extrude', d]),
      cut: async (p, d) => calls.push(['cut', d]),
      revolve: async (p, s, deg) => calls.push(['revolve', s, deg]),
      circularPattern: async (p, mode, count, distance, angle) =>
        calls.push(['circularPattern', mode, count, distance, angle]),
    };
  }

  test('executes a plan as the matching sequence of AtomicOps calls', async () => {
    const api = fakeAtomicApi();
    const plan = [
      { op: 'startSketch', plane: 'XY' },
      { op: 'sketchRectangle', cx: 0, cy: 0, w: 80, h: 60 },
      { op: 'finishSketch' },
      { op: 'extrude', distance: 8 },
    ];
    const part = await executeSculptPlan(plan, api);
    expect(part).toBe(api.part);
    expect(api.calls).toEqual([
      ['createPart', 'AI-Sculpted Part'],
      ['startSketch', 'XY'],
      ['sketchRectangle', 0, 0, 80, 60],
      ['finishSketch'],
      ['extrude', 8],
    ]);
  });

  test('revolve uses its segments/degrees, defaulting when absent', async () => {
    const api = fakeAtomicApi();
    await executeSculptPlan([
      { op: 'startSketch' }, { op: 'sketchRectangle', cx: 15, cy: 20, w: 10, h: 40 },
      { op: 'finishSketch' }, { op: 'revolve' },
    ], api);
    expect(api.calls[api.calls.length - 1]).toEqual(['revolve', 64, 360]);
  });

  test('an unknown op in executeSculptPlan throws', async () => {
    const api = fakeAtomicApi();
    await expect(executeSculptPlan([{ op: 'warpDrive' }], api)).rejects.toThrow(/unknown op/);
  });

  test('executeSculptPlan dispatches circularPattern to the atomic api', async () => {
    const api = fakeAtomicApi();
    await executeSculptPlan([
      { op: 'startSketch', plane: 'XY' },
      { op: 'sketchCircle', cx: 20, cy: 0, r: 4 },
      { op: 'finishSketch' },
      { op: 'circularPattern', mode: 'cut', count: 6, distance: 12 },
    ], api);
    expect(api.calls[api.calls.length - 1]).toEqual(['circularPattern', 'cut', 6, 12, 360]);
  });

  test('executeSculptPlan dispatches linearPattern to the atomic api', async () => {
    const calls = [];
    const api = {
      createPart: () => ({}),
      startSketch: () => calls.push(['startSketch']),
      sketchCircle: (p, cx, cy, r) => calls.push(['sketchCircle', cx, cy, r]),
      finishSketch: () => calls.push(['finishSketch']),
      linearPattern: async (p, mode, count, distance, dx, dy) =>
        calls.push(['linearPattern', mode, count, distance, dx, dy]),
    };
    await executeSculptPlan([
      { op: 'startSketch', plane: 'XY' },
      { op: 'sketchCircle', cx: -22.5, cy: 0, r: 3 },
      { op: 'finishSketch' },
      { op: 'linearPattern', mode: 'cut', count: 4, distance: 12, dx: 15, dy: 0 },
    ], api);
    expect(calls[calls.length - 1]).toEqual(['linearPattern', 'cut', 4, 12, 15, 0]);
  });

  test('executeSculptPlan dispatches fillet to the atomic api', async () => {
    const calls = [];
    const api = {
      createPart: () => ({}),
      startSketch: () => calls.push(['startSketch']),
      sketchRectangle: (p, cx, cy, w, h) => calls.push(['sketchRectangle', cx, cy, w, h]),
      finishSketch: () => calls.push(['finishSketch']),
      extrude: async () => calls.push(['extrude']),
      fillet: async (p, radius) => calls.push(['fillet', radius]),
    };
    await executeSculptPlan([
      { op: 'startSketch', plane: 'XY' },
      { op: 'sketchRectangle', cx: 0, cy: 0, w: 40, h: 40 },
      { op: 'finishSketch' },
      { op: 'extrude', distance: 10 },
      { op: 'fillet', radius: 3 },
    ], api);
    expect(calls[calls.length - 1]).toEqual(['fillet', 3]);
  });
});
