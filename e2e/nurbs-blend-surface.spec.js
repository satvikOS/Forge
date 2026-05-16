import { test, expect } from '@playwright/test';
import { NURBSSurface } from '../frontend/src/foundation/NURBSSurface.js';
import {
  blendArc, dihedralFillet, cylinderGroundFillet, blendLoft, arcEndNormal,
} from '../frontend/src/foundation/BlendSurface.js';

const len = (v) => Math.hypot(v[0], v[1], v[2]);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

test.describe('NURBS surfaces + constructive blend surfaces', () => {
  test.describe.configure({ timeout: 120000 });

  test('NURBS plane: flat, zero second derivatives, constant normal', () => {
    const plane = NURBSSurface.plane([0, 0, 0], [1, 0, 0], [0, 1, 0], 10, 8);
    expect(plane.eval(0.5, 0.5)).toEqual([5, 4, 0]);
    expect(plane.eval(1, 1)).toEqual([10, 8, 0]);
    const d = plane.evalDerivatives2(0.5, 0.5);
    // A plane is linear → all second partials vanish.
    for (const D of [d.Suu, d.Suv, d.Svv]) expect(len(D)).toBeLessThan(1e-9);
    // Normal is +Z everywhere.
    for (const [u, v] of [[0.2, 0.7], [0.9, 0.1]]) {
      const n = plane.evalDerivatives2(u, v).normal;
      expect(Math.abs(n[2])).toBeCloseTo(1, 9);
    }
  });

  test('NURBS cylinder: exact radius, radial normal', () => {
    const R = 15;
    const cyl = NURBSSurface.cylinder(R, 40);
    for (const [u, v] of [[0, 0.5], [0.25, 0], [0.5, 1], [0.7, 0.3]]) {
      const p = cyl.eval(u, v);
      expect(Math.hypot(p[0], p[1])).toBeCloseTo(R, 6);   // exact cylinder
      const n = cyl.evalDerivatives2(u, v).normal;
      // Normal is radial (parallel to the point's xy direction).
      const radial = [p[0] / R, p[1] / R, 0];
      expect(Math.abs(dot(n, radial))).toBeCloseTo(1, 5);
    }
  });

  test('NURBS sphere: every evaluated point lies on the sphere', () => {
    const R = 12;
    const sph = NURBSSurface.sphere(R);
    let maxErr = 0;
    for (let i = 1; i < 8; i++) {
      for (let j = 1; j < 8; j++) {
        const p = sph.eval(i / 8, j / 8);
        maxErr = Math.max(maxErr, Math.abs(len(p) - R));
      }
    }
    console.log(`\nNURBS sphere radius error: ${maxErr.toExponential(2)} mm`);
    expect(maxErr).toBeLessThan(1e-6);
  });

  test('blendArc traces a circular arc between two contact points', () => {
    const r = 8;
    const C = [0, 0, 0];
    const cA = [-r, 0, 0], cB = [0, -r, 0];   // perpendicular contacts
    const arc = blendArc(C, cA, cB, 16);
    expect(arc.radius).toBeCloseTo(r, 9);
    // Every arc point is exactly r from the ball centre.
    for (const p of arc.points) {
      expect(Math.hypot(p[0], p[1], p[2])).toBeCloseTo(r, 6);
    }
    // Endpoints are the contact points; the arc spans a quarter turn.
    expect(arc.points[0]).toEqual(cA);
    const last = arc.points[arc.points.length - 1];
    expect(last[0]).toBeCloseTo(0, 6);
    expect(last[1]).toBeCloseTo(-r, 6);
  });

  test('dihedralFillet is G1-tangent to both planar faces', () => {
    const r = 5;
    // Box-edge fillet: top face normal +Z, side face normal +X.
    const fil = dihedralFillet([0, 0, 0], [0, 1, 0], [0, 0, 1], [1, 0, 0], r, 40, 16, 8);
    for (let s = 0; s < fil.axis.length; s++) {
      const C = fil.axis[s];
      const arc = blendArc(C, fil.contactA[s], fil.contactB[s], 16);
      // Every fillet vertex sits exactly r from the ball-centre axis.
      for (const p of arc.points) {
        expect(Math.hypot(p[0] - C[0], p[1] - C[1], p[2] - C[2])).toBeCloseTo(r, 6);
      }
      // G1: the blend's surface normal at each contact curve is
      // collinear with the corresponding face normal (shared tangent
      // plane). |dot| = 1.
      expect(Math.abs(dot(arcEndNormal(arc, 'start'), [0, 0, 1]))).toBeCloseTo(1, 6);
      expect(Math.abs(dot(arcEndNormal(arc, 'end'), [1, 0, 0]))).toBeCloseTo(1, 6);
    }
    expect(fil.mesh.triangles.length).toBeGreaterThan(0);
  });

  test('cylinderGroundFillet is G1-tangent to the curved cylinder face', () => {
    const R = 20, r = 6;
    const fil = cylinderGroundFillet(R, r, 30, 16, 8);
    const xc = 2 * Math.sqrt(R * r);
    for (let s = 0; s < fil.contactPlane.length; s++) {
      const C = [xc, fil.contactPlane[s][1], r];
      const arc = blendArc(C, fil.contactPlane[s], fil.contactCylinder[s], 16);
      // G1 with the plane (normal +Z) …
      expect(Math.abs(dot(arcEndNormal(arc, 'start'), fil.planeNormal))).toBeCloseTo(1, 6);
      // … and G1 with the CURVED cylinder face — the genuine
      // curved-surface blend case.
      expect(Math.abs(dot(arcEndNormal(arc, 'end'), fil.cylinderNormal))).toBeCloseTo(1, 6);
    }
    expect(fil.mesh.triangles.length).toBeGreaterThan(0);
    expect(fil.mesh.vertices.length).toBeGreaterThan(0);
  });

  test('blendLoft lofts a blend surface through contact stations', () => {
    const stations = [];
    for (let i = 0; i <= 6; i++) {
      const y = i * 5;
      stations.push({ C: [0, y, 0], cA: [-4, y, 0], cB: [0, y, -4] });
    }
    const { mesh } = blendLoft(stations, 12);
    expect(mesh.vertices.length).toBe(7 * 13);
    expect(mesh.triangles.length).toBe(6 * 12 * 2);
  });
});
