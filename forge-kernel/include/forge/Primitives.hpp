#pragma once

#include "forge/ShapeRegistry.hpp"

namespace forge {

ShapeHandle makeBox(double dx, double dy, double dz);
ShapeHandle makeCylinder(double radius, double height);
ShapeHandle makeSphere(double radius);
ShapeHandle makeCone(double r1, double r2, double height);
ShapeHandle makeTorus(double majorR, double minorR);

} // namespace forge
