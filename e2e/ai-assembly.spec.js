import { test, expect } from '@playwright/test';
import { buildAssemblyPrompt, parseAssemblyPlan } from '../frontend/src/ai/sculptor/AssemblyBuilder.js';

test.describe('AssemblyBuilder — prompt', () => {
  test('the prompt asks for parts with name, description and position', () => {
    const p = buildAssemblyPrompt();
    expect(p).toContain('parts');
    expect(p).toContain('description');
    expect(p).toContain('position');
  });
});

test.describe('AssemblyBuilder — parseAssemblyPlan', () => {
  test('parses a valid two-part assembly', () => {
    const parts = parseAssemblyPlan(JSON.stringify({ parts: [
      { name: 'base', description: 'a 70 mm disc, 10 mm thick', position: [0, 0, 0] },
      { name: 'pillar', description: 'a 16 mm cylinder, 50 mm tall', position: [0, 0, 10] },
    ] }));
    expect(parts.length).toBe(2);
    expect(parts[1].position).toEqual([0, 0, 10]);
  });

  test('strips a ```json fence', () => {
    const parts = parseAssemblyPlan('```json\n{"parts":[{"name":"a","description":"d","position":[1,2,3]}]}\n```');
    expect(parts.length).toBe(1);
  });

  test('rejects a part with no description', () => {
    expect(() => parseAssemblyPlan('{"parts":[{"name":"a","position":[0,0,0]}]}'))
      .toThrow(/description/);
  });

  test('rejects a part whose position is not a 3-number array', () => {
    expect(() => parseAssemblyPlan('{"parts":[{"name":"a","description":"d","position":[0,0]}]}'))
      .toThrow(/position/);
  });

  test('rejects an empty parts list', () => {
    expect(() => parseAssemblyPlan('{"parts":[]}')).toThrow(/parts/);
  });

  test('rejects input that is not JSON', () => {
    expect(() => parseAssemblyPlan('I will build it for you')).toThrow(/could not parse/);
  });
});
