#pragma once

#include "forge/ShapeRegistry.hpp"

namespace forge {

ShapeHandle makeBox(double dx, double dy, double dz);
ShapeHandle makeCylinder(double radius, double height);
ShapeHandle makeSphere(double radius);
ShapeHandle makeCone(double r1, double r2, double height);
ShapeHandle makeTorus(double majorR, double minorR);

// Task #16 — canonical solid primitives (real OCCT BReps).
//   makePrism:    regular n-gon prism, base on z=0 centred on the Z axis,
//                 extruded +Z by `height` (nSides=6 → hex prism).
//   makeWedge:    BRepPrimAPI_MakeWedge right-angular wedge, min-corner at
//                 the origin; the +Y face is shrunk in X to length `ltx`.
//   makePyramid:  rectangular base centred on the origin (dx×dy on z=0) →
//                 single apex on the +Z axis at `height`.
//   makeEllipsoid: unit sphere scaled non-uniformly by (rx,ry,rz), centred.
//   makeTube:     hollow cylinder (rInner < rOuter), base on z=0, axis +Z.
ShapeHandle makePrism(int nSides, double circumRadius, double height);
ShapeHandle makeWedge(double dx, double dy, double dz, double ltx);
ShapeHandle makePyramid(double dx, double dy, double height);
ShapeHandle makeEllipsoid(double rx, double ry, double rz);
ShapeHandle makeTube(double rOuter, double rInner, double height);

} // namespace forge
