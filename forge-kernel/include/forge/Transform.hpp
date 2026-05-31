#pragma once

#include "forge/ShapeRegistry.hpp"

namespace forge {

// Translate / rotate produce new handles; the input is untouched.
ShapeHandle translate(ShapeHandle h, double dx, double dy, double dz);
ShapeHandle rotate(ShapeHandle h, double ax, double ay, double az, double angleRad);

} // namespace forge
