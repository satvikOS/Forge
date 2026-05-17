import { test, expect } from '@playwright/test';
import { signedArea, isClockwise, orient, chainLoops } from '../frontend/src/kernel/atomic/SketchProfile.js';

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

test.describe('SketchProfile — chainLoops', () => {
  test('four segments given in shuffled order chain into one 4-point loop', () => {
    // unit square segments, deliberately out of order and with mixed direction
    const segs = [
      [[1, 1], [1, 0]],   // right edge, pointing down
      [[0, 0], [1, 0]],   // bottom edge, pointing right
      [[0, 1], [0, 0]],   // left edge, pointing down
      [[1, 1], [0, 1]],   // top edge, pointing left
    ];
    const loops = chainLoops(segs);
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBe(4);
    // the loop encloses the unit square -> |area| == 1
    expect(Math.abs(signedArea(loops[0]))).toBeCloseTo(1, 9);
  });

  test('two disjoint triangles chain into two separate loops', () => {
    const segs = [
      [[0, 0], [2, 0]], [[2, 0], [1, 2]], [[1, 2], [0, 0]],         // triangle A
      [[10, 0], [12, 0]], [[12, 0], [11, 2]], [[11, 2], [10, 0]],   // triangle B
    ];
    const loops = chainLoops(segs);
    expect(loops.length).toBe(2);
    expect(loops[0].length).toBe(3);
    expect(loops[1].length).toBe(3);
  });

  test('an open chain that cannot close throws', () => {
    const segs = [
      [[0, 0], [1, 0]],
      [[1, 0], [1, 1]],   // ends at (1,1) with no segment back to (0,0)
    ];
    expect(() => chainLoops(segs)).toThrow(/open chain/);
  });

  test('endpoints within tolerance are treated as coincident', () => {
    const segs = [
      [[0, 0], [1, 0]],
      [[1.0000001, 0], [1, 1]],   // start is 1e-7 off the previous end
      [[1, 1], [0, 0]],
    ];
    const loops = chainLoops(segs, 1e-5);
    expect(loops.length).toBe(1);
    expect(loops[0].length).toBe(3);
  });
});
