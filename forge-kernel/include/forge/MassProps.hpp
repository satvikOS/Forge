#pragma once

#include "forge/ShapeRegistry.hpp"

namespace forge {

struct MassProperties {
    double volume;
    double area;
    double cx, cy, cz;
};

MassProperties massProperties(ShapeHandle h);

} // namespace forge
