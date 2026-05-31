#pragma once

#include "forge/ShapeRegistry.hpp"

namespace forge {

ShapeHandle fuse(ShapeHandle a, ShapeHandle b);
ShapeHandle cut(ShapeHandle a, ShapeHandle b);
ShapeHandle common(ShapeHandle a, ShapeHandle b);

} // namespace forge
