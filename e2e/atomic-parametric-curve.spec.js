import { test, expect } from '@playwright/test';
import { involute, involuteParamAtRadius } from '../frontend/src/kernel/atomic/ParametricCurve.js';

test.describe('ParametricCurve — involute', () => {
  test('every involute point lies at radius rb·sqrt(1+t^2) from the origin', () => {
    const rb = 5;
    const pts = involute(rb, 0, 1.2, 40);
    expect(pts.length).toBe(41);
    for (let i = 0; i < pts.length; i++) {
      const t = (1.2) * (i / 40);
      const expectedR = rb * Math.sqrt(1 + t * t);
      const actualR = Math.hypot(pts[i][0], pts[i][1]);
      expect(actualR).toBeCloseTo(expectedR, 9);
    }
  });

  test('the involute starts on the base circle (t=0 -> radius rb)', () => {
    const pts = involute(7, 0, 1, 8);
    expect(Math.hypot(pts[0][0], pts[0][1])).toBeCloseTo(7, 9);
  });

  test('involuteParamAtRadius inverts the radius relation', () => {
    const rb = 4;
    const t = involuteParamAtRadius(rb, rb * Math.sqrt(1 + 0.9 * 0.9));
    expect(t).toBeCloseTo(0.9, 9);
  });

  test('involute rejects a non-positive base radius', () => {
    expect(() => involute(0, 0, 1, 8)).toThrow(/baseRadius/);
  });

  test('involuteParamAtRadius rejects a radius below the base circle', () => {
    expect(() => involuteParamAtRadius(5, 4)).toThrow(/baseRadius/);
  });
});
