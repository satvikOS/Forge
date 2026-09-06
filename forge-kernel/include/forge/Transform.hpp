#pragma once

#include "forge/ShapeRegistry.hpp"

namespace forge {

// Translate / rotate produce new handles; the input is untouched.
ShapeHandle translate(ShapeHandle h, double dx, double dy, double dz);
ShapeHandle rotate(ShapeHandle h, double ax, double ay, double az, double angleRad);
ShapeHandle scaleUniform(ShapeHandle h, double factor, double cx = 0, double cy = 0, double cz = 0);

} // namespace forge
