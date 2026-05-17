import { test, expect } from '@playwright/test';
import { involute, involuteParamAtRadius, archimedeanSpiral, ellipseArc, circlePolyline } from '../frontend/src/kernel/atomic/ParametricCurve.js';

test.describe('ParametricCurve — involute', () => {
  test('every involute point lies at radius rb·sqrt(1+t^2) from the origin', () => {
    const rb = 5;
    const t0 = 0, t1 = 1.2, segments = 40;
    const pts = involute(rb, t0, t1, segments);
    expect(pts.length).toBe(segments + 1);
    for (let i = 0; i < pts.length; i++) {
      const t = t0 + (t1 - t0) * (i / segments);
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
    expect(() => involuteParamAtRadius(5, 4)).toThrow(/r must be >= baseRadius/);
  });

  test('involuteParamAtRadius rejects a non-positive base radius', () => {
    expect(() => involuteParamAtRadius(0, 5)).toThrow(/baseRadius/);
  });

  test('involuteParamAtRadius returns 0 when r equals baseRadius', () => {
    expect(involuteParamAtRadius(6, 6)).toBe(0);
  });
});

test.describe('ParametricCurve — Archimedean spiral', () => {
  test('radius grows linearly with angle: r = a + b·theta', () => {
    const a = 1, b = 0.5;
    const pts = archimedeanSpiral(a, b, 0, 4 * Math.PI, 100);
    expect(pts.length).toBe(101);
    for (let i = 0; i < pts.length; i++) {
      const th = (4 * Math.PI) * (i / 100);
      expect(Math.hypot(pts[i][0], pts[i][1])).toBeCloseTo(a + b * th, 9);
    }
  });

  test('the first point sits at radius a along the +x axis', () => {
    const pts = archimedeanSpiral(2, 0.3, 0, Math.PI, 16);
    expect(pts[0][0]).toBeCloseTo(2, 9);
    expect(pts[0][1]).toBeCloseTo(0, 9);
  });

  test('archimedeanSpiral rejects a range where the radius goes negative', () => {
    // r at theta1 = 1 + (-1)(4π) ≈ -11.6  -> must throw
    expect(() => archimedeanSpiral(1, -1, 0, 4 * Math.PI, 10)).toThrow(/non-negative/);
  });

  test('archimedeanSpiral accepts a contracting spiral that stays non-negative', () => {
    // r goes from 5 down to 5 - 0.1·(4π) ≈ 3.74, never negative -> ok
    const pts = archimedeanSpiral(5, -0.1, 0, 4 * Math.PI, 10);
    expect(pts.length).toBe(11);
  });
});

test.describe('ParametricCurve — ellipse and circle', () => {
  test('ellipse arc points satisfy (x/rx)^2 + (y/ry)^2 = 1', () => {
    const rx = 3, ry = 2;
    const pts = ellipseArc(rx, ry, 0, 2 * Math.PI, 50);
    for (const [x, y] of pts) {
      expect((x / rx) ** 2 + (y / ry) ** 2).toBeCloseTo(1, 9);
    }
  });

  test('circlePolyline returns exactly `segments` non-repeating points on the circle', () => {
    const pts = circlePolyline(4, 12);
    expect(pts.length).toBe(12);
    for (const [x, y] of pts) {
      expect(Math.hypot(x, y)).toBeCloseTo(4, 9);
    }
    // first and last must NOT coincide (closed implicitly, not by duplication)
    expect(Math.hypot(pts[0][0] - pts[11][0], pts[0][1] - pts[11][1])).toBeGreaterThan(0.1);
  });

  test('circlePolyline honours a non-origin centre', () => {
    const pts = circlePolyline(1, 8, 10, -5);
    for (const [x, y] of pts) {
      expect(Math.hypot(x - 10, y - (-5))).toBeCloseTo(1, 9);
    }
  });

  test('ellipseArc rejects a non-positive semi-axis', () => {
    expect(() => ellipseArc(0, 2, 0, 1, 8)).toThrow(/rx and ry/);
  });
});
