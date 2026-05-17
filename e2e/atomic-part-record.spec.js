import { test, expect } from '@playwright/test';
import { Part } from '../frontend/src/kernel/atomic/Part.js';

test.describe('Part — construction-history record', () => {
  test('a new Part is empty and unnamed-safe', () => {
    const p = new Part('Bracket');
    expect(p.name).toBe('Bracket');
    expect(p.featureCount()).toBe(0);
    expect(p.solid).toBe(null);
    expect(p.activeSketch).toBe(null);
  });

  test('addFeature appends to the history in order', () => {
    const p = new Part();
    p.addFeature('startSketch', { plane: 'XY' });
    p.addFeature('sketchRectangle', { w: 10, h: 5 });
    expect(p.featureCount()).toBe(2);
    expect(p.features[0].type).toBe('startSketch');
    expect(p.features[1].type).toBe('sketchRectangle');
  });

  test('addFeature with a solid updates the current solid', () => {
    const p = new Part();
    const fakeSolid = { volume: () => 100 };
    p.addFeature('extrude', { distance: 4 }, fakeSolid);
    expect(p.solid).toBe(fakeSolid);
  });

  test('addFeature without a solid leaves the current solid unchanged', () => {
    const p = new Part();
    const fakeSolid = { volume: () => 100 };
    p.addFeature('extrude', { distance: 4 }, fakeSolid);
    p.addFeature('startSketch', { plane: 'XY' });
    expect(p.solid).toBe(fakeSolid);
  });

  test('addFeature copies params (later mutation of the caller object does not leak in)', () => {
    const p = new Part();
    const params = { w: 10 };
    p.addFeature('sketchRectangle', params);
    params.w = 999;
    expect(p.features[0].params.w).toBe(10);
  });

  test('each feature gets a unique id', () => {
    const p = new Part();
    const a = p.addFeature('startSketch', {});
    const b = p.addFeature('finishSketch', {});
    expect(a.id).not.toBe(b.id);
  });

  test('describe renders the history as an ordered arrow chain', () => {
    const p = new Part();
    p.addFeature('startSketch', {});
    p.addFeature('sketchRectangle', {});
    p.addFeature('extrude', {});
    expect(p.describe()).toBe('1. startSketch -> 2. sketchRectangle -> 3. extrude');
  });
});
