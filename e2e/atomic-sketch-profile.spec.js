import { test, expect } from '@playwright/test';
import { signedArea, isClockwise, orient } from '../frontend/src/kernel/atomic/SketchProfile.js';

const UNIT_CCW = [[0, 0], [1, 0], [1, 1], [0, 1]];          // counter-clockwise unit square
const UNIT_CW = [[0, 0], [0, 1], [1, 1], [1, 0]];           // clockwise unit square

test.describe('SketchProfile — area and orientation', () => {
  test('signedArea is +1 for a CCW unit square, -1 for a CW one', () => {
    expect(signedArea(UNIT_CCW)).toBeCloseTo(1, 9);
    expect(signedArea(UNIT_CW)).toBeCloseTo(-1, 9);
  });

  test('isClockwise distinguishes the two windings', () => {
    expect(isClockwise(UNIT_CCW)).toBe(false);
    expect(isClockwise(UNIT_CW)).toBe(true);
  });

  test('orient(poly, true) returns a CCW polygon regardless of input winding', () => {
    expect(isClockwise(orient(UNIT_CW, true))).toBe(false);
    expect(isClockwise(orient(UNIT_CCW, true))).toBe(false);
  });

  test('orient(poly, false) returns a CW polygon regardless of input winding', () => {
    expect(isClockwise(orient(UNIT_CW, false))).toBe(true);
    expect(isClockwise(orient(UNIT_CCW, false))).toBe(true);
  });

  test('orient does not mutate the input array', () => {
    const input = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const copy = JSON.stringify(input);
    orient(input, false);
    expect(JSON.stringify(input)).toBe(copy);
  });
});
