import { test, expect } from '@playwright/test';
import { buildManifestPrompt, parseManifest } from '../frontend/src/ai/sculptor/ComponentManifest.js';

test.describe('ComponentManifest — prompt', () => {
  test('the prompt asks for components with id, name and description', () => {
    const p = buildManifestPrompt();
    expect(p).toContain('components');
    expect(p).toContain('id');
    expect(p).toContain('description');
  });
});

test.describe('ComponentManifest — parseManifest', () => {
  test('parses a valid component manifest', () => {
    const m = parseManifest(JSON.stringify({ components: [
      { id: 'SM-CASE', name: 'case', description: 'a 42 mm watch case body' },
      { id: 'SM-BEZEL', name: 'bezel', description: 'a 42 mm rotating bezel ring' },
    ] }));
    expect(m.length).toBe(2);
    expect(m[0].id).toBe('SM-CASE');
  });

  test('strips a ```json fence', () => {
    const m = parseManifest('```json\n{"components":[{"id":"A","name":"a","description":"d"}]}\n```');
    expect(m.length).toBe(1);
  });

  test('rejects a component with no description', () => {
    expect(() => parseManifest('{"components":[{"id":"A","name":"a"}]}')).toThrow(/description/);
  });

  test('rejects a component with no id', () => {
    expect(() => parseManifest('{"components":[{"name":"a","description":"d"}]}')).toThrow(/id/);
  });

  test('rejects duplicate component ids', () => {
    expect(() => parseManifest('{"components":[{"id":"A","name":"a","description":"d"},{"id":"A","name":"b","description":"e"}]}'))
      .toThrow(/duplicate/);
  });

  test('rejects an empty component list', () => {
    expect(() => parseManifest('{"components":[]}')).toThrow(/components/);
  });

  test('rejects input that is not JSON', () => {
    expect(() => parseManifest('here is the watch')).toThrow(/could not parse/);
  });
});
