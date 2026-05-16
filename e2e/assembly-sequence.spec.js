import { test, expect } from '@playwright/test';
import {
  assemblyOrder, generateAssemblySequence, sampleAssemblyFrames,
} from '../frontend/src/foundation/AssemblySequence.js';

// A small gearbox-style assembly.
const ASSEMBLY = {
  parts: [
    { id: 'housing', name: 'Housing', assembledPosition: [0, 0, 0] },
    { id: 'shaft',   name: 'Shaft',   assembledPosition: [0, 0, 30] },
    { id: 'gear',    name: 'Gear',    assembledPosition: [0, 0, 30] },
    { id: 'cover',   name: 'Cover',   assembledPosition: [0, 0, 60] },
  ],
  mates: [
    { a: 'housing', b: 'shaft' },
    { a: 'shaft',   b: 'gear'  },
    { a: 'housing', b: 'cover' },
  ],
};

test.describe('Assembly-sequence animation', () => {
  test.describe.configure({ timeout: 120000 });

  test('assemblyOrder is base-first and respects mate dependencies', () => {
    const order = assemblyOrder(ASSEMBLY.parts, ASSEMBLY.mates, 'housing');
    expect(order[0]).toBe('housing');
    // The gear mates only to the shaft → it must come after the shaft.
    expect(order.indexOf('gear')).toBeGreaterThan(order.indexOf('shaft'));
    // Every part appears exactly once.
    expect([...new Set(order)].length).toBe(ASSEMBLY.parts.length);
  });

  test('Assemble animation: exploded at t=0, fully mated at t=duration', () => {
    const seq = generateAssemblySequence(ASSEMBLY, { baseId: 'housing', explodeGap: 60 });

    const start = seq.sample(0);
    const end = seq.sample(seq.duration);
    for (const part of ASSEMBLY.parts) {
      const assembled = part.assembledPosition;
      // End of the animation → every part at its mated position.
      for (let k = 0; k < 3; k++) expect(end[part.id][k]).toBeCloseTo(assembled[k], 6);
      if (part.id === 'housing') {
        // The base is fixed — placed from the very first frame.
        for (let k = 0; k < 3; k++) expect(start[part.id][k]).toBeCloseTo(assembled[k], 6);
      } else {
        // Others start retracted along the explode axis (+Y) only.
        const sp = seq.parts.find((p) => p.id === part.id);
        expect(start[part.id][0]).toBeCloseTo(assembled[0], 6);   // X unchanged
        expect(start[part.id][2]).toBeCloseTo(assembled[2], 6);   // Z unchanged
        expect(start[part.id][1]).toBeGreaterThan(assembled[1]);  // retracted +Y
        expect(start[part.id][1]).toBeCloseTo(sp.explodedPosition[1], 6);
      }
    }
  });

  test('Each part moves monotonically through its own time slot', () => {
    const seq = generateAssemblySequence(ASSEMBLY, { baseId: 'housing', explodeGap: 60 });
    const shaft = seq.parts.find((p) => p.id === 'shaft');

    // Before its slot → exploded; mid-slot → between; after → assembled.
    const before = seq.sample(shaft.slotStart);
    const mid = seq.sample((shaft.slotStart + shaft.slotEnd) / 2);
    const after = seq.sample(shaft.slotEnd);
    expect(before.shaft[1]).toBeCloseTo(shaft.explodedPosition[1], 6);
    expect(after.shaft[1]).toBeCloseTo(shaft.assembledPosition[1], 6);
    // Mid-slot Y strictly between exploded and assembled.
    expect(mid.shaft[1]).toBeLessThan(shaft.explodedPosition[1]);
    expect(mid.shaft[1]).toBeGreaterThan(shaft.assembledPosition[1]);
  });

  test('Explode mode is the time-reverse of the assemble animation', () => {
    const seq = generateAssemblySequence(ASSEMBLY, { baseId: 'housing', mode: 'explode', explodeGap: 60 });
    const start = seq.sample(0);
    const end = seq.sample(seq.duration);
    // Explode: starts fully assembled, ends fully exploded.
    for (const part of ASSEMBLY.parts) {
      for (let k = 0; k < 3; k++) {
        expect(start[part.id][k]).toBeCloseTo(part.assembledPosition[k], 6);
      }
    }
    const cover = seq.parts.find((p) => p.id === 'cover');
    expect(end.cover[1]).toBeCloseTo(cover.explodedPosition[1], 6);
  });

  test('sampleAssemblyFrames yields a usable flat frame array', () => {
    const seq = generateAssemblySequence(ASSEMBLY, { baseId: 'housing' });
    const frames = sampleAssemblyFrames(seq, 60);
    expect(frames.length).toBe(60);
    expect(frames[0].t).toBeCloseTo(0, 6);
    expect(frames[59].t).toBeCloseTo(seq.duration, 6);
    // Every frame carries a position for every part.
    for (const fr of frames) {
      expect(Object.keys(fr.positions).sort()).toEqual(['cover', 'gear', 'housing', 'shaft']);
    }
  });
});
