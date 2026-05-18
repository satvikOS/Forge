import { test, expect } from '@playwright/test';
import { ComponentLibrary } from '../frontend/src/ai/sculptor/ComponentLibrary.js';

test.describe('ComponentLibrary — registry', () => {
  test('a new library is empty', () => {
    const lib = new ComponentLibrary();
    expect(lib.count()).toBe(0);
    expect(lib.list()).toEqual([]);
  });

  test('saveComponent stores a component and returns its entry', () => {
    const lib = new ComponentLibrary();
    const entry = lib.saveComponent({ id: 'C001', name: 'mainplate', stepText: 'ISO-10303-21;', volume: 1234 });
    expect(entry.id).toBe('C001');
    expect(lib.count()).toBe(1);
    expect(lib.get('C001').name).toBe('mainplate');
  });

  test('saveComponent rejects a duplicate id', () => {
    const lib = new ComponentLibrary();
    lib.saveComponent({ id: 'C001', name: 'a', stepText: 's', volume: 1 });
    expect(() => lib.saveComponent({ id: 'C001', name: 'b', stepText: 's', volume: 2 }))
      .toThrow(/duplicate/);
  });

  test('saveComponent rejects a missing id or empty stepText', () => {
    const lib = new ComponentLibrary();
    expect(() => lib.saveComponent({ name: 'a', stepText: 's', volume: 1 })).toThrow(/id/);
    expect(() => lib.saveComponent({ id: 'C1', name: 'a', stepText: '', volume: 1 })).toThrow(/stepText/);
  });

  test('list returns saved components in insertion order', () => {
    const lib = new ComponentLibrary();
    lib.saveComponent({ id: 'C001', name: 'a', stepText: 's', volume: 1 });
    lib.saveComponent({ id: 'C002', name: 'b', stepText: 's', volume: 2 });
    expect(lib.list().map((c) => c.id)).toEqual(['C001', 'C002']);
  });

  test('get returns null for an unknown id', () => {
    const lib = new ComponentLibrary();
    expect(lib.get('nope')).toBe(null);
  });
});
